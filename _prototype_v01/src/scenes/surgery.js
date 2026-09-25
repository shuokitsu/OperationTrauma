// ゲーム画面（手術）。仕様が未決の部分は仮の動きにしてあり、_records の試作の記録に一覧を残している。
import { text, panel, wrap, Buttons } from '../core/ui.js';
import { AREA, CELL, COLS, ROWS, toCell, toPx, inArea, inGrid, key, cheb, dist, distToSeg, discCells } from '../game/grid.js';
import { createLesion, drawLesion, step, blocked, nearArea } from '../game/lesion.js';
import { checkCond } from '../flow.js';
import { TalkBox } from './talkbox.js';
import { TalkScene } from './talk.js';
import { GameOverScene } from './gameover.js';

const TOOL_KEYS = { 1: 'gel', 2: 'drain', 3: 'tweezers', 4: 'scalpel', 5: 'suture', 6: 'syringe' };
const SIDE_W = 260;
const TOP_H = 190;
const TOOL_H = (1080 - TOP_H) / 6;
const TEMPO = { normal: 1.4, fast: 0.8, danger: 0.5, anesthesia: 2.2 }; // 1拍の秒数（仮：TBD-04-4）
const FRAMES = [0, 1, 2, 1];

export function rankOf(score) {
  if (score >= 100) return 'XS';
  if (score >= 95) return 'S';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

export class SurgeryScene {
  constructor(game, run) {
    this.game = game;
    this.run = run;
    this.stage = run.stage;
    this.inst = game.data.instruments.list;
    this.types = game.data.lesions.types;
    this.coefStage = this.stage.coef || {};
    this.coefDiff = game.data.difficulty.list[run.difficultyId].coef || {};

    this.timeLimit = this.stage.timeLimitSec * this.k('timeLimit');
    this.timeLeft = this.timeLimit;
    this.vital = this.stage.startVital;
    this.misses = 0;
    this.gelSkipped = false;
    this.naturalAcc = 0;
    this.stepIndex = -1;
    this.lesions = [];
    this.pending = [];
    this.spawnCount = 0;

    // ゲーム開始時はヒールゼリーを選択した状態（spec/01_overview.md 3.2）
    this.tool = 'gel';
    this.gelStock = this.inst.gel.stock;
    this.gelRegen = 0;
    this.gauge = 1;
    this.drugIdx = 0;
    this.anesthesia = 0;

    this.subtitleQueue = [];
    this.subtitle = null;
    this.overlay = null;
    this.menu = false;
    this.finished = false;
    this.stroke = null;
    this.pointer = null;
    this.floats = [];
    this.beatT = 0;
    this.showHint = true;
    this.showGrid = false;
    this.drainSe = 0;
    this.clearDelay = -1;

    this.menuButtons = new Buttons(game.audio);
    this.menuButtons.add({ x: 760, y: 380, w: 400, h: 100, label: 'リトライ', onClick: () => this.run.retry() });
    this.menuButtons.add({ x: 760, y: 510, w: 400, h: 100, label: 'タイトルに戻る', se: 'cancel', onClick: () => import('./title.js').then((m) => this.game.change(new m.TitleScene(this.game))) });
    this.menuButtons.add({ x: 760, y: 640, w: 400, h: 100, label: '閉じる', se: 'cancel', onClick: () => { this.menu = false; } });

    this.nextStep();
  }

  enter() {
    this.game.audio.bgm('surgery');
  }

  // 係数：実際の値 = 基本値 × ステージ係数 × 難易度係数（spec/03_game_rules.md 6章）
  k(kind) {
    return (this.coefStage[kind] ?? 1) * (this.coefDiff[kind] ?? 1);
  }

  get side() {
    return this.game.save.data.options.side;
  }

  get toolX() {
    return this.side === 'left' ? 0 : 1920 - SIDE_W;
  }

  get otherX() {
    return this.side === 'left' ? 1920 - SIDE_W : 0;
  }

  // ---- ステップ・病巣の出現 ------------------------------------------------
  nextStep() {
    this.stepIndex++;
    const steps = this.stage.steps;
    if (this.stepIndex >= steps.length) {
      this.clear();
      return;
    }
    const st = steps[this.stepIndex];
    let placements = st.lesions;
    if (st.variants) {
      // 処置内容の分岐：条件に合う最初のものを使う（spec/07_data_format.md 3.4）
      const v = st.variants.find((x) => checkCond(x.if, this.run.flags));
      placements = v ? v.lesions : [];
    }
    this.pending = (placements || []).map((p) => ({ ...p }));
    this.lesions = [];
    this.stepElapsed = 0;
    this.events = (st.events || []).map((e) => ({ ...e, fired: false }));
    this.background = st.background || 'skin';
    this.clearDelay = -1;
  }

  spawnPending() {
    this.pending = this.pending.filter((p) => {
      const a = p.appear || { type: 'start' };
      const ok =
        a.type === 'start' ||
        (a.type === 'time' && this.stepElapsed >= a.sec) ||
        (a.type === 'after' && this.lesions.some((L) => L.id === a.id && L.done));
      if (ok) this.lesions.push(createLesion(p, this.types[p.type]));
      return !ok;
    });
  }

  fireEvents(trigger) {
    for (const e of this.events) {
      if (e.fired) continue;
      const hit = trigger ? e.onClear === trigger : e.at !== undefined && this.stepElapsed >= e.at;
      if (!hit) continue;
      e.fired = true;
      if (e.subtitle) this.subtitleQueue.push(e.subtitle);
      if (e.talk) this.openTalk(e.talk);
    }
  }

  // ゲーム中のキャラクター絵つき会話。表示中は一時停止する（仮：TBD-02-7）
  openTalk(lines) {
    this.stroke = null;
    this.overlay = new TalkBox(this.game, { lines, run: this.run, overlay: true, onEnd: () => { this.overlay = null; } });
    this.overlay.start();
  }

  // ---- 結果 ---------------------------------------------------------------
  float(msg, c, color) {
    const p = c ? toPx(c) : { x: 960, y: 540 };
    this.floats.push({ msg, x: p.x, y: p.y, t: 1.2, color });
  }

  damage(n, c, msg = 'ミス') {
    const d = n * this.k('damage');
    this.vital -= d;
    this.misses++;
    this.game.audio.se('miss');
    this.float(`${msg} -${round1(d)}`, c, '#ff6b6b');
  }

  heal(n, c, msg = '') {
    const h = n * this.k('heal');
    if (h <= 0) return;
    this.vital = Math.min(99, this.vital + h);
    this.game.audio.se('heal');
    this.float(`${msg}+${round1(h)}`, c, '#7cf0a4');
  }

  invalid(c, msg) {
    this.game.audio.se('invalid');
    this.float(`無効：${msg}`, c, '#b8c2cc');
  }

  success(L) {
    L.stepIdx++;
    L.flash = 1;
    if (L.stepIdx >= L.def.steps.length) {
      L.done = true;
      this.game.audio.se('success');
      this.float(`${L.def.name} 完了`, L.mid, '#ffe27a');
      this.heal(L.def.successHeal || 0, { x: L.mid.x, y: L.mid.y + 3 });
      this.fireEvents(L.id);
    } else {
      this.game.audio.se('success');
      this.float('成功', L.mid, '#ffe27a');
    }
  }

  gameOver(reason) {
    this.finished = true;
    this.game.change(new GameOverScene(this.game, this.run, reason));
  }

  timeUp() {
    // 時間切れは会話を表示してからゲームオーバー（spec/03_game_rules.md 2章）
    this.finished = true;
    this.game.audio.se('alarm');
    this.game.change(new TalkScene(this.game, {
      lines: this.stage.timeUpTalk || [],
      run: this.run,
      onEnd: () => this.game.change(new GameOverScene(this.game, this.run, 'time')),
    }));
  }

  clear() {
    this.finished = true;
    const efforts = (this.stage.briefing.effort || []).map((e) => ({
      ...e,
      ok: e.type === 'noMiss' ? this.misses === 0
        : e.type === 'noGelSkip' ? !this.gelSkipped
        : e.type === 'timeLeftRatio' ? this.timeLeft / this.timeLimit >= e.value
        : false,
    }));
    const items = (this.stage.score || []).map((s) => {
      let ok = false;
      let label = '';
      if (s.cond === 'clear') { ok = true; label = 'クリア'; }
      if (s.cond === 'effort') { const e = efforts.find((x) => x.id === s.id); ok = !!e?.ok; label = `努力目標：${e?.text}`; }
      if (s.cond === 'vitalAtLeast') { ok = this.vital >= s.value; label = `残りバイタル ${s.value} 以上`; }
      if (s.cond === 'timeLeftRatio') { ok = this.timeLeft / this.timeLimit >= s.value; label = `残り時間 ${Math.round(s.value * 100)}% 以上`; }
      return { label, ok, points: s.points };
    });
    const score = Math.min(100, items.reduce((a, it) => a + (it.ok ? it.points : 0), 0));
    this.run.cleared({ items, efforts, score, rank: rankOf(score), vital: this.vital, timeLeft: this.timeLeft, misses: this.misses });
  }

  // ---- 毎フレームの処理 ----------------------------------------------------
  update(dt) {
    this.floats = this.floats.filter((f) => (f.t -= dt) > 0);
    if (this.finished) return;
    if (this.overlay) {
      this.overlay.update(dt);
      return;
    }
    if (this.menu) return;

    this.stepElapsed += dt;
    this.timeLeft -= dt;
    this.anesthesia = Math.max(0, this.anesthesia - dt);
    const drainMul = this.anesthesia > 0 ? this.inst.syringe.drugs.find((d) => d.id === 'anesthesia').drainRate : 1;

    // 自然減少と病巣による減少は、それぞれ独立したタイマーで処理する（spec/03_game_rules.md 1.2）
    const nd = this.stage.naturalDrain;
    this.naturalAcc += dt;
    while (this.naturalAcc >= nd.intervalSec) {
      this.naturalAcc -= nd.intervalSec;
      this.vital -= nd.amount * this.k('drain') * drainMul;
    }
    for (const L of this.lesions) {
      L.flash = Math.max(0, L.flash - dt * 2);
      if (L.done) continue;
      if (L.def.drain) {
        L.drainAcc += dt;
        while (L.drainAcc >= L.def.drain.intervalSec) {
          L.drainAcc -= L.def.drain.intervalSec;
          this.vital -= L.def.drain.amount * this.k('drain') * drainMul;
        }
      }
      // 裂傷は縫合するまで、一定時間ごとに再出血する（仮の値）
      if (L.def.blood && L.stepIdx <= 2) {
        if (L.blood <= 0.02) {
          L.rebleedAcc += dt;
          if (L.rebleedAcc >= L.def.blood.rebleedSec) {
            L.blood = 0.6;
            L.rebleedAcc = 0;
            this.float('再出血', L.mid, '#ff8080');
          }
        } else {
          L.rebleedAcc = 0;
        }
      }
    }

    const gel = this.inst.gel;
    if (this.gelStock < gel.stock) {
      this.gelRegen += dt;
      if (this.gelRegen >= gel.stockRegenSec) { this.gelStock++; this.gelRegen = 0; }
    } else {
      this.gelRegen = 0;
    }
    this.gauge = Math.min(1, this.gauge + dt / this.inst.syringe.gaugeRefillSec);

    if (this.stroke?.tool === 'drain' && this.pointer) this.drainAt(toCell(this.pointer), dt);

    this.spawnPending();
    this.fireEvents(null);
    if (!this.subtitle && this.subtitleQueue.length) this.subtitle = { ...this.subtitleQueue.shift(), t: 4 };
    if (this.subtitle && (this.subtitle.t -= dt) <= 0) this.subtitle = null;

    // テンポ（拍動アニメーション）
    const band = this.band();
    const prevBeat = Math.floor(this.beatT / TEMPO[band]);
    this.beatT += dt;
    if (band === 'danger' && Math.floor(this.beatT / TEMPO[band]) !== prevBeat) this.game.audio.se('heartbeat');

    if (this.vital <= 0) { this.vital = 0; this.gameOver('vital'); return; }
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.timeUp(); return; }

    if (!this.pending.length && this.lesions.every((L) => L.done)) {
      if (this.clearDelay < 0) this.clearDelay = 1.0;
      this.clearDelay -= dt;
      if (this.clearDelay <= 0) this.nextStep();
    }
  }

  band() {
    if (this.anesthesia > 0) return 'anesthesia';
    if (this.vital <= 25) return 'danger';
    if (this.vital <= 50) return 'fast';
    return 'normal';
  }

  // ---- 入力 ---------------------------------------------------------------
  selectTool(t) {
    if (this.tool === t && t === 'syringe') {
      // 注射をもう一度選ぶと薬を切り替える（仮：TBD-05-7）
      this.drugIdx = (this.drugIdx + 1) % this.inst.syringe.drugs.length;
    }
    this.tool = t;
    this.game.audio.se('select');
  }

  keyDown(k) {
    if (this.finished) return;
    if (this.overlay) { if (k === 'Enter' || k === ' ') this.overlay.pointerUp({ x: -1, y: -1 }); return; }
    if (k === 'Escape') { this.menu = !this.menu; this.stroke = null; return; }
    if (this.menu) return;
    if (TOOL_KEYS[k]) this.selectTool(TOOL_KEYS[k]);
    if (k === 'h') this.showHint = !this.showHint;
    if (k === 'g') this.showGrid = !this.showGrid;
  }

  pointerDown(p) {
    if (this.finished) return;
    if (this.overlay) { this.overlay.pointerDown(p); return; }
    if (this.menu) { this.menuButtons.down(p); return; }
    this.pointer = p;
    const x = this.toolX;
    if (p.x >= x && p.x < x + SIDE_W) {
      if (p.y < TOP_H) { this.menu = true; this.game.audio.se('select'); return; }
      const i = Math.floor((p.y - TOP_H) / TOOL_H);
      const t = this.game.data.instruments.order[i];
      if (t) this.selectTool(t);
      return;
    }
    if (!inArea(p)) return;
    this.stroke = { tool: this.tool, start: toCell(p), last: toCell(p) };
    this.toolDown(this.stroke, toCell(p));
  }

  pointerMove(p) {
    this.pointer = p;
    if (!this.stroke || this.overlay || this.menu) return;
    this.toolMove(this.stroke, toCell(p), p);
    this.stroke.last = toCell(p);
  }

  pointerUp(p) {
    if (this.finished) return;
    if (this.overlay) { this.overlay.pointerUp(p); return; }
    if (this.menu) { this.menuButtons.up(p); return; }
    this.pointer = null;
    if (!this.stroke) return;
    const s = this.stroke;
    this.stroke = null;
    this.toolUp(s, toCell(p), p);
  }

  active() {
    return this.lesions.filter((L) => !L.done);
  }

  lesionNear(c, range) {
    return this.active().find((L) => nearArea(L, c, range));
  }

  // ---- 医療機器ごとの操作 ---------------------------------------------------
  toolDown(s, c) {
    const T = this.inst;
    if (s.tool === 'gel') {
      if (this.gelStock <= 0) { this.invalid(c, 'ストック切れ'); s.dead = true; return; }
      s.painted = new Set();
      this.paint(s, c, c);
    }
    if (s.tool === 'tweezers') {
      const range = T.tweezers.grabRange;
      const grab = this.active().find((L) => step(L).action === 'extract' && cheb(c, L.objectPos) <= range + (L.radius || 0));
      if (grab) {
        if (blocked(grab)) { this.invalid(c, '血・膿がある'); s.dead = true; return; }
        s.grab = grab;
        this.game.audio.se('grab');
        return;
      }
      const pinch = this.active().find((L) => step(L).action === 'pinch' && L.path.some((q, i) => i < L.path.length - 1 && distToSeg(c, q, L.path[i + 1]) <= range));
      if (pinch) {
        if (blocked(pinch)) { this.invalid(c, '血・膿がある'); return; }
        this.game.audio.se('grab');
        this.success(pinch);
        return;
      }
      const other = this.lesionNear(c, 1);
      if (other) this.invalid(c, '手順が違う');
    }
    if (s.tool === 'scalpel') {
      const range = T.scalpel.passRange * this.k('tolerance');
      for (const L of this.active()) {
        const st = step(L);
        const cutNow = st.action === 'cut' || (st.optional && L.def.steps[L.stepIdx + 1]?.action === 'cut');
        if (!cutNow || !L.cutPoints) continue;
        let pts = null;
        if (cheb(c, L.cutPoints[0]) <= range) pts = L.cutPoints;
        else if (!L.closedCut && cheb(c, L.cutPoints[L.cutPoints.length - 1]) <= range) pts = [...L.cutPoints].reverse();
        if (!pts) continue;
        if (blocked(L)) { this.invalid(c, '血・膿がある'); s.dead = true; return; }
        s.cut = { L, pts, next: 1, skipped: st.optional };
        this.game.audio.se('cut');
        return;
      }
      if (this.lesionNear(c, 1)) {
        this.damage(T.scalpel.failDamage, c, '手順が違う');
        s.dead = true;
        return;
      }
      s.whiff = true;
    }
    if (s.tool === 'suture') {
      const range = T.suture.passRange;
      for (const L of this.active()) {
        if (step(L).action !== 'stitch') continue;
        const sp = L.suturePoints.find((q) => !q.done && cheb(c, q) <= range);
        if (!sp) continue;
        if (blocked(L)) { this.invalid(c, '血・膿がある'); return; }
        sp.done = true;
        this.game.audio.se('stitch');
        if (L.suturePoints.every((q) => q.done)) this.success(L);
        return;
      }
      if (this.lesionNear(c, 1)) { this.damage(T.suture.failDamage, c, '手順が違う'); return; }
      this.damage(T.suture.whiff.damage, c, '空振り');
    }
    if (s.tool === 'syringe') {
      const drug = T.syringe.drugs[this.drugIdx];
      const amt = this.gauge;
      if (amt < 0.05) { this.invalid(c, 'ゲージ不足'); return; }
      this.gauge = 0;
      this.game.audio.se('inject');
      // 効果は注入量（ゲージの残り）に比例する（spec/05_instruments.md 3.6）
      if (drug.id === 'stim') this.heal(drug.heal * amt, c, '回復剤 ');
      if (drug.id === 'anesthesia') {
        this.anesthesia = Math.max(this.anesthesia, drug.durationSec * amt * this.k('anesthesia'));
        this.float(`麻酔 ${round1(this.anesthesia)}秒`, c, '#9fd0ff');
      }
    }
  }

  toolMove(s, c, p) {
    if (s.dead) return;
    if (s.tool === 'gel') this.paint(s, s.last, c);
    if (s.tool === 'tweezers' && s.grab) s.grab.held = c;
    if (s.tool === 'scalpel' && s.cut) {
      const T = this.inst.scalpel;
      const tol = T.tolerance * this.k('tolerance');
      const range = T.passRange * this.k('tolerance');
      const { pts } = s.cut;
      const a = pts[s.cut.next - 1];
      const b = pts[s.cut.next];
      if (distToSeg(c, a, b) > tol) {
        this.damage(T.failDamage, c, '線を外れた');
        s.dead = true;
        return;
      }
      if (cheb(c, b) <= range) {
        s.cut.next++;
        this.game.audio.se('stitch');
        if (s.cut.next >= pts.length) this.finishCut(s);
      }
    }
  }

  finishCut(s) {
    const { L, skipped } = s.cut;
    s.dead = true;
    if (skipped) {
      // 消毒（ヒールゼリー）を省略した切開：成功してもダメージ（spec/06_lesions.md 3.5）
      L.stepIdx++;
      this.gelSkipped = true;
      const pen = L.def.steps[0].skipPenalty * this.k('damage');
      this.vital -= pen;
      this.float(`消毒省略 -${round1(pen)}`, L.mid, '#ff9b6b');
    }
    this.success(L);
  }

  toolUp(s, c, p) {
    const T = this.inst;
    if (s.tool === 'gel' && !s.dead) this.applyGel(s, c);
    if (s.tool === 'tweezers' && s.grab) {
      const L = s.grab;
      L.held = null;
      if (!inArea(p)) {
        L.extracted = true;
        this.success(L);
      } else {
        this.damage(T.tweezers.failDamage, c, '落とした');
      }
    }
    if (s.tool === 'scalpel') {
      if (s.cut && !s.dead) this.invalid(c, '途中で離した');
      if (s.whiff) {
        // 病巣の無い場所を切ると裂傷が発生する（spec/05_instruments.md 3.4）
        this.damage(T.scalpel.whiff.damage, c, '空振り');
        const a = s.start;
        let b = { x: Math.max(0, Math.min(COLS - 1, c.x)), y: Math.max(0, Math.min(ROWS - 1, c.y)) };
        if (dist(a, b) < 2) b = { x: Math.min(COLS - 1, a.x + 3), y: Math.min(ROWS - 1, a.y + 1) };
        const place = { id: `spawn${++this.spawnCount}`, type: T.scalpel.whiff.spawn, points: [[Math.floor(a.x), Math.floor(a.y)], [Math.floor(b.x), Math.floor(b.y)]] };
        this.lesions.push(createLesion(place, this.types[place.type]));
        this.float('裂傷が発生', a, '#ff6b6b');
      }
    }
  }

  paint(s, from, to) {
    const r = this.inst.gel.brushRadius;
    const n = Math.max(1, Math.ceil(dist(from, to) / 0.5));
    for (let i = 0; i <= n; i++) {
      const q = { x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n };
      for (const k of discCells(q, r)) s.painted.add(k);
    }
  }

  applyGel(s, c) {
    const gel = this.inst.gel;
    this.gelStock--;
    this.game.audio.se('gel');
    // 1回の塗布ごとにバイタル回復（病巣の有無によらない：仮。E4 のバランス懸念あり）
    this.heal(gel.healPerUse, c, 'ゼリー ');
    for (const L of this.active()) {
      const touched = [...L.areaCells].some((k) => s.painted.has(k));
      if (!touched) continue;
      const st = step(L);
      if (st.tool !== 'gel') { this.invalid(L.mid, '手順が違う'); continue; }
      if (blocked(L)) { this.invalid(L.mid, '血・膿で効かない'); continue; }
      const covered = [...L.gelCells].every((k) => s.painted.has(k));
      if (!covered) { this.invalid(L.mid, '覆いきれていない'); continue; }
      if (st.optional) L.disinfected = true;
      this.success(L);
    }
  }

  drainAt(c, dt) {
    const T = this.inst.drain;
    let sucking = false;
    for (const L of this.active()) {
      if (!L.poolR) continue;
      if (dist(c, L.mid) > L.poolR + T.radius) continue;
      for (const kind of ['blood', 'pus']) {
        if (!(L[kind] > 0)) continue;
        sucking = true;
        L[kind] = Math.max(0, L[kind] - T.ratePerSec * dt);
        const act = kind === 'blood' ? 'suckBlood' : 'suckPus';
        if (L[kind] === 0 && step(L).action === act) this.success(L);
      }
    }
    this.drainSe -= dt;
    if (sucking && this.drainSe <= 0) { this.game.audio.se('drain'); this.drainSe = 0.3; }
  }

  // ---- 描画 ---------------------------------------------------------------
  draw(c) {
    c.fillStyle = '#0a0d12';
    c.fillRect(0, 0, 1920, 1080);

    const frame = FRAMES[Math.floor((this.beatT / TEMPO[this.band()]) * 4) % 4];
    const bg = this.game.images[`patient_${this.background}_${frame}`];
    if (bg) c.drawImage(bg, AREA.x, AREA.y, AREA.w, AREA.h);

    if (this.showGrid) this.drawGrid(c);

    c.save();
    c.beginPath();
    c.rect(0, 0, 1920, 1080);
    c.clip();
    for (const L of this.lesions) drawLesion(c, L, { showHint: this.showHint, heldPos: L.held });
    c.restore();

    if (this.stroke?.painted) {
      c.fillStyle = 'rgba(120,255,170,0.25)';
      for (const k of this.stroke.painted) {
        const [x, y] = k.split(',').map(Number);
        c.fillRect(AREA.x + x * CELL, AREA.y + y * CELL, CELL, CELL);
      }
    }
    if (this.stroke?.cut && !this.stroke.dead) this.drawCutGuide(c);

    c.lineWidth = 3;
    c.strokeStyle = '#2f6fb5';
    c.strokeRect(AREA.x, AREA.y, AREA.w, AREA.h);

    this.drawCursor(c);
    this.drawTools(c);
    this.drawTop(c);
    this.drawOther(c);
    this.drawSubtitle(c);

    if (this.vital <= 25) {
      c.fillStyle = `rgba(255,0,0,${0.08 + 0.06 * Math.sin(this.beatT * 8)})`;
      c.fillRect(0, 0, 1920, 1080);
    }
    for (const f of this.floats) {
      c.globalAlpha = Math.min(1, f.t * 2);
      text(c, f.msg, f.x, f.y - (1.2 - f.t) * 60, { size: 30, align: 'center', color: f.color, weight: 'bold' });
      c.globalAlpha = 1;
    }
    if (this.overlay) this.overlay.draw(c);
    if (this.menu) {
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(0, 0, 1920, 1080);
      panel(c, 700, 270, 520, 520);
      text(c, 'メニュー（一時停止中）', 960, 325, { size: 36, align: 'center' });
      this.menuButtons.draw(c);
    }
  }

  drawGrid(c) {
    c.lineWidth = 1;
    for (let i = 0; i <= COLS; i++) {
      c.strokeStyle = i % 10 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.25)';
      c.beginPath(); c.moveTo(AREA.x + i * CELL, AREA.y); c.lineTo(AREA.x + i * CELL, AREA.y + AREA.h); c.stroke();
    }
    for (let j = 0; j <= ROWS; j++) {
      c.strokeStyle = j % 10 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.25)';
      c.beginPath(); c.moveTo(AREA.x, AREA.y + j * CELL); c.lineTo(AREA.x + AREA.w, AREA.y + j * CELL); c.stroke();
    }
  }

  drawCutGuide(c) {
    const { pts, next } = this.stroke.cut;
    const tol = this.inst.scalpel.tolerance * this.k('tolerance');
    c.save();
    c.strokeStyle = 'rgba(111,231,255,0.25)';
    c.lineWidth = tol * 2 * CELL;
    c.lineCap = 'round';
    c.beginPath();
    const a = toPx(pts[next - 1]);
    const b = toPx(pts[Math.min(next, pts.length - 1)]);
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.restore();
  }

  drawCursor(c) {
    const p = this.pointer;
    if (!p || !inArea(p)) return;
    const r = { gel: this.inst.gel.brushRadius, drain: this.inst.drain.radius }[this.tool];
    if (r) {
      c.beginPath();
      c.arc(p.x, p.y, r * CELL, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = 2;
      c.stroke();
    }
    const img = this.game.images['icon_' + this.tool];
    if (img) c.drawImage(img, p.x + 10, p.y - 70, 60, 60);
  }

  drawTools(c) {
    const x = this.toolX;
    c.fillStyle = '#121821';
    c.fillRect(x, 0, SIDE_W, 1080);
    panel(c, x + 10, 10, SIDE_W - 20, TOP_H - 20, { fill: '#1d2733' });
    text(c, 'Menu', x + SIDE_W / 2, TOP_H / 2, { size: 40, align: 'center', weight: 'bold' });
    this.game.data.instruments.order.forEach((t, i) => {
      const y = TOP_H + i * TOOL_H;
      const sel = this.tool === t;
      panel(c, x + 10, y + 6, SIDE_W - 20, TOOL_H - 12, { fill: sel ? '#24476e' : '#1a222d', stroke: sel ? '#9fd0ff' : '#3c4a5a' });
      const img = this.game.images['icon_' + t];
      if (img) c.drawImage(img, x + 18, y + 20, 90, 90);
      text(c, `${i + 1}`, x + 30, y + 30, { size: 22, color: '#8a9bb0' });
      text(c, this.inst[t].name, x + 116, y + 50, { size: 26 });
      if (t === 'gel') {
        for (let j = 0; j < this.inst.gel.stock; j++) {
          c.fillStyle = j < this.gelStock ? '#6fd39a' : '#2a3a33';
          c.fillRect(x + 116 + j * 24, y + 86, 18, 26);
        }
      }
      if (t === 'syringe') {
        c.fillStyle = '#2a3440';
        c.fillRect(x + 116, y + 86, 120, 20);
        c.fillStyle = '#7fc4ff';
        c.fillRect(x + 116, y + 86, 120 * this.gauge, 20);
        text(c, this.inst.syringe.drugs[this.drugIdx].name, x + 116, y + 122, { size: 22, color: '#bfe0ff' });
      }
    });
  }

  drawTop(c) {
    const x = AREA.x;
    const band = this.vital <= 25 ? '#e04848' : this.vital <= 50 ? '#e0c048' : '#48c078';
    text(c, 'VITAL', x + 30, 60, { size: 36, weight: 'bold', color: '#c8d6e6' });
    text(c, String(Math.ceil(this.vital)), x + 200, 60, { size: 64, weight: 'bold', color: band });
    c.fillStyle = '#20262e';
    c.fillRect(x + 30, 110, AREA.w - 60, 40);
    c.fillStyle = band;
    c.fillRect(x + 30, 110, (AREA.w - 60) * (this.vital / 99), 40);
    if (this.anesthesia > 0) text(c, `麻酔 ${this.anesthesia.toFixed(1)}秒`, x + AREA.w - 30, 60, { size: 32, align: 'right', color: '#9fd0ff' });
  }

  drawOther(c) {
    const x = this.otherX;
    const t = Math.max(0, Math.ceil(this.timeLeft));
    text(c, '残り時間', x + SIDE_W / 2, 50, { size: 28, align: 'center', color: '#c8d6e6' });
    text(c, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, x + SIDE_W / 2, 120, { size: 56, align: 'center', weight: 'bold' });
    // 本来は空白（背景のみ）。試作では確認用の情報を出す
    const lines = [
      '（試作用の情報）',
      `難易度：${this.game.data.difficulty.list[this.run.difficultyId].name}`,
      `ステップ：${this.stepIndex + 1}/${this.stage.steps.length}`,
      `ミス：${this.misses}`,
      `テンポ：${this.band()}`,
      '',
      'H：ヒント表示',
      'G：マス目表示',
      'Esc：メニュー',
      '1〜6：機器切替',
    ];
    lines.forEach((l, i) => text(c, l, x + 20, 260 + i * 40, { size: 22, color: '#6f8196' }));
  }

  drawSubtitle(c) {
    const s = this.subtitle;
    if (!s) return;
    c.globalAlpha = Math.min(1, s.t * 2);
    if (s.name) text(c, s.name, AREA.x + 30, AREA.y + AREA.h + 50, { size: 30, color: '#9fd0ff', weight: 'bold' });
    wrap(c, s.text, AREA.w - 60, 34).forEach((l, i) => text(c, l, AREA.x + 30, AREA.y + AREA.h + 100 + i * 44, { size: 34 }));
    c.globalAlpha = 1;
  }
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
