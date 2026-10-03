// ゲーム画面（spec/02 3.4、spec/03、spec/05）
import { W, H, text, wrap, panel, drawImg, Button, roundRect } from './core.js';
import { AREA, CELL, COLS, ROWS, toCell, toPx, inArea, dist, distToSeg, distToPolyline, segCross, pathLength, key } from './geometry.js';
import { Lesion, scoreLesion, makeSmallCut } from './lesion.js';

const COL_W = 260, MENU_H = 180, INST_H = 150;
const SUB = { x: 260, y: 880, w: 1400, h: 200 };

export class Surgery {
  // cfg: { stage, diff, startStep, flags, training }
  constructor(app, cfg) {
    this.app = app; this.cfg = cfg; this.D = app.data;
    this.stage = cfg.stage; this.diff = cfg.diff;
    this.training = cfg.training || null;
    this.side = app.save.options.side;
    this.flags = new Set(cfg.flags || []);
    this.preFlags = [...(cfg.preFlags || cfg.flags || [])];
    const st = this.stage;
    this.vitalMax = 99;
    this.vital = Math.min(99, st.start_vital * this.coef('start_vital'));        // 開始時のバイタルにも係数（C2）
    this.timeLimit = st.time_limit_sec ? st.time_limit_sec * this.coef('time') : null;
    this.timeLeft = this.timeLimit;
    this.t = 0; this.real = 0; this.stepT = 0;
    this.decayAcc = 0;
    // 医療機器の状態（リトライ・コンティニューポイントからの開始はステージ開始時の状態：B14）
    const I = this.D.instruments;
    this.sel = 'healjelly'; this.drug = I.injector.initial_drug; this.drugOpen = false;
    this.stock = I.healjelly.stock; this.stockAcc = 0;
    this.gauge = 100; this.anesthesia = 0;
    this.dose = {};          // 患者ごとの投与量の累計
    this.injectTotals = {};  // ステップのクリア条件（回復剤を一定量など）
    this.lesions = []; this.pending = [];
    this.op = null; this.tapeLifted = false;
    this.fx = []; this.subQueue = []; this.sub = null;
    this.talk = null; this.menu = false; this.ended = false;
    this.totalFails = 0;
    this.trayShownAt = -1; this.tapeShownAt = -1;
    this.grid = false; this.hint = false;
    this.lastCP = cfg.startStep || 0;     // リトライで戻るステップ
    this.cpFlags = [...this.flags];
    this.stepIdx = -1;
    this.patient = null;
    this.layout();
    this.menuButtons = [
      new Button(760, 380, 400, 100, '再開', () => { this.menu = false; }),
      new Button(760, 510, 400, 100, 'リトライ', () => this.retry()),
      new Button(760, 640, 400, 100, 'タイトルに戻る', () => app.toTitle()),
    ];
    if (this.training) this.startTraining();
    else {
      // コンティニューポイントより前の病巣も最大点に数える（0点。F3）
      this.preCount = 0;
      for (let i = 0; i < (cfg.startStep || 0); i++) this.preCount += this.placementsOf(st.steps[i]).filter(p => !this.D.lesions[p.lesion].runtime).length;
      // 開始ステップより前の最後の患者を引き継ぐ
      for (let i = 0; i <= (cfg.startStep || 0); i++) if (st.steps[i].patient) this.patient = st.steps[i].patient;
      // 最初のステップの会話は会話画面で済んでいる。コンティニューポイントから始めるときは、そのあとの会話（開始ステップの治療前の会話）から出す（F6）
      this.beginStep(cfg.startStep || 0, !cfg.startStep);
    }
    app.sound.bgm('surgery');
  }
  coef(name) {
    const d = this.D.system.difficulties.find(x => x.id === this.diff) || {};
    const sc = (this.stage.coefficients || {})[name] ?? 1;
    return sc * ((d.coef || {})[name] ?? 1);
  }
  layout() {
    const left = this.side === 'left';
    this.instX = left ? 0 : W - COL_W;
    this.oppX = left ? W - COL_W : 0;
    this.instRects = this.D.instruments.order.map((id, i) => ({ id, x: this.instX, y: MENU_H + i * INST_H, w: COL_W, h: INST_H }));
    this.menuRect = { x: this.instX, y: 0, w: COL_W, h: MENU_H };
    this.tray = { x: this.oppX + 30, y: 330, w: 200, h: 520 };   // トレイの当たり範囲＝トレイの画像（D9）
    this.tape = { x: this.oppX + 40, y: 470, w: 180, h: 180 };
    const drugs = Object.keys(this.D.instruments.injector.drugs);
    const inj = this.instRects[5];
    this.drugRects = drugs.map((id, k) => ({ id, x: left ? COL_W + 10 : W - COL_W - 10 - 230, y: inj.y + INST_H - 100 - k * 104, w: 230, h: 92 }));
  }
  placementsOf(step) {
    return (step.placements || []).filter(p => (!p.if_flag || this.flags.has(p.if_flag)) && (!p.unless_flag || !this.flags.has(p.unless_flag)));
  }
  patientDef() { return this.D.stages.patients[this.patient || 'skin']; }

  // ---------------- ステップ ----------------
  beginStep(i, first = false) {
    this.stepIdx = i; this.stepT = 0;
    const step = this.stage.steps[i];
    this.injectTotals = {};
    if (step.patient) this.patient = step.patient;   // ステップの間で患者を差し替え（B1）
    this.pending = this.placementsOf(step).map(p => ({ ...p }));
    this.subFired = new Set();
    const go = () => { this.spawnReady(); this.fireSubs({ type: 'step_start' }); };
    // ステップの間のキャラクター絵つきの会話（止める会話）。最初のステップの会話は会話画面で済んでいる
    if (!first && step.dialogue_before) this.openTalk(step.dialogue_before, go);
    else go();
  }
  spawnReady() {
    const L = this.D.lesions;
    for (const p of [...this.pending]) {
      const a = p.appear || { type: 'start' };
      let ok = a.type === 'start' || (a.type === 'after_sec' && this.stepT >= a.value) ||
        (a.type === 'after_done' && this.lesions.some(l => l.id === a.value && l.done));
      if (!ok) continue;
      this.pending.splice(this.pending.indexOf(p), 1);
      const l = new Lesion(L[p.lesion], p, p.lesion); l.appearT = this.t;
      this.lesions.push(l);
      this.fireSubs({ type: 'lesion_appear', value: p.id });
    }
  }
  stepComplete() {
    const step = this.training ? null : this.stage.steps[this.stepIdx];
    if (step && step.clear_condition && step.clear_condition.type === 'inject')
      return (this.injectTotals[step.clear_condition.drug] || 0) >= step.clear_condition.amount;
    return this.pending.length === 0 && this.lesions.every(l => l.done);
  }
  nextStep() {
    const st = this.stage, step = st.steps[this.stepIdx];
    if (step.continue_point_after) {             // コンティニューポイントを通過：到達点を保存（B14・B15）
      this.lastCP = this.stepIdx + 1; this.cpFlags = [...this.flags];
      this.app.recordProgress(st.id, this.preFlags, this.lastCP, this.cpFlags);
      this.addFx(W / 2, AREA.y + 60, 'コンティニューポイント', '#9fe0ff', 34);
    }
    this.archive = (this.archive || []).concat(this.lesions.filter(l => l.done));
    this.lesions = this.lesions.filter(l => !l.done);
    this.beginStep(this.stepIdx + 1);
  }
  fireSubs(ev) {
    if (this.training) return;
    const step = this.stage.steps[this.stepIdx];
    (step.subtitles || []).forEach((s, i) => {
      if (this.subFired.has(i)) return;
      const a = s.at; let hit = false;
      if (a.type === ev.type && (a.value === undefined || a.value === ev.value)) hit = true;
      if (a.type === 'lesions_done' && ev.type === 'lesion_done') hit = a.value.every(id => this.lesions.some(l => l.id === id && l.done));
      if (!hit) return;
      this.subFired.add(i); this.subQueue.push(s);
    });
  }

  // ---------------- 止める会話 ----------------
  openTalk(id, then) {
    this.forceRelease();          // 押している最中なら「離した」扱い（spec/05 2.5）
    this.sub = null; this.subQueue = [];   // 表示中の字幕は打ち切る（spec/02 3.4）
    this.talk = { lines: this.D.talks[id] || [], i: 0, then, left: null, right: null, choiceButtons: null };
    this.prepTalkLine();
  }
  prepTalkLine() {
    const tk = this.talk, ln = tk.lines[tk.i];
    if (!ln) { const f = tk.then; this.talk = null; f && f(); return; }
    if ('left' in ln) tk.left = ln.left; if ('right' in ln) tk.right = ln.right;
    tk.choiceButtons = ln.choice ? ln.choice.map((c, k) => new Button(560, 300 + k * 120, 800, 96, c.t, () => { this.flags.add(c.flag); tk.i++; this.prepTalkLine(); }, { size: 30 })) : null;
  }
  talkClick(p) {
    const tk = this.talk;
    if (tk.choiceButtons) { const b = tk.choiceButtons.find(b => b.hit(p)); if (b) { this.app.sound.se('select'); b.onClick(); } return; }
    this.app.sound.se('text'); tk.i++; this.prepTalkLine();
  }

  // ---------------- 更新 ----------------
  update(dt) {
    this.real += dt;
    if (this.ended || this.menu || this.talk) return;
    this.t += dt; this.stepT += dt;
    const I = this.D.instruments;
    if (this.timeLimit) this.timeLeft -= dt;
    if (this.anesthesia > 0) this.anesthesia = Math.max(0, this.anesthesia - dt);
    // ストックの回復（塗っている間は止める：D7）
    const painting = this.op && this.op.type === 'healjelly' && !this.op.noStock;
    if (this.stock < I.healjelly.stock && !painting) {
      this.stockAcc += dt * this.coef('recover');
      if (this.stockAcc >= I.healjelly.recover_sec) { this.stockAcc -= I.healjelly.recover_sec; this.stock++; }
    } else if (this.stock >= I.healjelly.stock) this.stockAcc = 0;
    // 注射のゲージ（ゼロから満タンまで10秒）
    this.gauge = Math.min(100, this.gauge + dt * 100 / I.injector.gauge_recover_sec * this.coef('recover'));
    // バイタルの減少（自然減少と病巣ごと。それぞれ独立したタイマー。麻酔は間隔を伸ばす：F4）
    const stretch = this.anesthesia > 0 ? I.injector.drugs.anesthesia.decay_interval_stretch * this.coef('anesthesia') : 1;
    const nd = this.stage.natural_decay;
    if (nd) {
      const iv = nd.interval_sec / this.coef('decay') * stretch;
      this.decayAcc += dt; while (this.decayAcc >= iv) { this.decayAcc -= iv; this.vital -= nd.amount; }
    }
    for (const l of this.lesions) {
      if (l.done) continue;
      const vd = l.def.vital_drain;
      if (vd) { const iv = vd.interval_sec / this.coef('decay') * stretch; l.drainAcc += dt; while (l.drainAcc >= iv) { l.drainAcc -= iv; this.vital -= vd.amount; } }
      if (l.isPool && l.grow > 0) l.amount = Math.min(l.max, l.amount + l.grow * dt);   // 血溜まりは量に応じて広がる
    }
    this.spawnReady();
    // 操作中の処理（ドレーン・塗る・注射）
    if (this.op && this.op.tick) this.op.tick(dt);
    // 字幕
    if (this.sub) { this.sub.left -= dt; if (this.sub.left <= 0) this.sub = null; }
    if (!this.sub && this.subQueue.length) { const s = this.subQueue.shift(); this.sub = { ...s, left: Math.max(3.5, s.t.length * 0.16) }; }
    this.fx = this.fx.filter(f => (f.life -= dt) > 0);
    this.checkEnd();
  }
  checkEnd() {
    if (this.ended) return;
    const vitalZero = this.vital <= 0, timeout = this.timeLimit !== null && this.timeLeft <= 0;
    const stepDone = this.stepComplete();
    const lastStep = this.training ? this.trainingDone() : this.stepIdx >= this.stage.steps.length - 1;
    // 同時に成り立ったら バイタル0 ＞ 限度量超過 ＞ 時間切れ ＞ クリア（B6）
    if (vitalZero) return this.gameOver('vital_zero');
    if (this.doseOver) return this.gameOver('dose_limit');
    if (timeout) return this.gameOver('timeout');
    if (stepDone) {
      if (this.training) return this.trainingNext();
      if (lastStep) return this.clear();
      this.nextStep();
    }
  }
  gameOver(cause) {
    this.ended = true; this.forceRelease(); this.app.sound.stopLoops();
    this.app.sound.se('gameover');
    setTimeout(() => this.app.onGameOver(this, cause), 900);
  }
  clear() {
    this.ended = true; this.forceRelease(); this.app.sound.stopLoops(); this.app.sound.se('clear');
    // 結果の集計
    const R = this.result = { lesions: [], score: 0, max: 0, bonus: [] };
    for (const l of this.allLesions()) if (!l.runtime) { R.lesions.push(l); R.score += l.score ? l.score.total : 0; R.max += 100; }
    R.pre = this.preCount || 0; R.max += 100 * R.pre;
    for (const g of (this.stage.goals.effort || [])) {
      const ok = g.type === 'miss_max' ? this.totalFails <= g.value : g.type === 'vital_min_at_clear' ? this.dispVital() >= g.value : false;
      R.bonus.push({ ...g, ok }); R.max += g.bonus; if (ok) R.score += g.bonus;
    }
    R.ratio = R.max > 0 ? R.score / R.max : null;   // 最大点 0 ならランクなし（F5）
    R.rank = R.ratio === null ? null : this.D.system.rank.find(([th]) => R.ratio >= th - 1e-9)[1];
    R.fails = this.totalFails; R.vital = this.dispVital(); R.time = this.t; R.startStep = this.cfg.startStep || 0;
    setTimeout(() => this.app.onClear(this), 1100);
  }
  allLesions() { return (this.archive || []).concat(this.lesions); }
  retry() {
    if (this.training) return this.app.startTraining(this.training.spec);
    // 最後に通過したコンティニューポイントから。状態はステージ開始時に戻す（点数も 0 から）
    this.app.startSurgery({ stage: this.stage, diff: this.diff, startStep: this.lastCP, flags: this.cpFlags, preFlags: this.preFlags });
  }
  dispVital() { return Math.max(0, Math.min(99, Math.ceil(this.vital - 1e-9))); }   // 切り上げ（C3）

  // ---------------- 結果の反映 ----------------
  damage(v, c) { const d = v * this.coef('damage'); this.vital -= d; if (c) this.addFxCell(c, '-' + (Math.round(d * 10) / 10), '#ff6060', 30); }
  heal(v) { this.vital = Math.min(this.vitalMax, this.vital + v * this.coef('heal')); }
  fail(l, c, dmg) { if (l) { l.fails++; this.totalFails++; } this.damage(dmg, c); this.addFxCell(c, 'NG', '#ff5050', 40); this.app.sound.se('miss'); }
  miss(c, dmg) { if (dmg) this.damage(dmg, c); this.addFxCell(c, 'MISS', '#ffb050', 34); this.app.sound.se('miss'); }
  invalid() { this.app.sound.se('invalid'); }    // 無効：画面にメッセージは出さない（P49）
  // 手順の1段階が成功
  stepSuccess(l, opt = {}) {
    let s = l.step;
    if (opt.skipped) {           // 省略できる段階を飛ばした（省略：失敗にしない。ダメージは成功の時点で）
      const sk = l.step; l.skips++;
      if (sk.skip_damage) this.damage(sk.skip_damage, l.center());
      l.stepIdx++; s = l.step;
    }
    this.heal(s.heal ?? (s.instrument === 'healjelly' ? this.D.instruments.healjelly.default_success_heal : 0));
    l.stepIdx++;
    const c = opt.at || l.center();
    if (l.stepIdx >= l.steps.length) {
      l.done = true; l.doneT = this.t;
      if (!l.runtime) {
        l.score = scoreLesion(l, this.D.system, this.D.lesions._score_default, this.coef('time'));
        this.addFxCell(c, l.score.eval, { Cool: '#7ff0ff', Good: '#8fff8f', Fine: '#ffe36b', Bad: '#ff8a8a' }[l.score.eval], 46, 1.6);
        if (this.training) this.app.recordTrainingBest(l.kind, this.diff, l.score);
      } else this.addFxCell(c, 'OK', '#c0ffc0', 34);
      this.app.sound.se('success');
      this.fireSubs({ type: 'lesion_done', value: l.id });
      this.spawnReady();
    } else { this.addFxCell(c, 'OK', '#c0ffc0', 36); this.app.sound.se('heal'); }
  }
  addFx(x, y, s, color, size = 34, life = 1.2) { this.fx.push({ x, y, s, color, size, life, max: life }); }
  addFxCell(c, s, color, size, life) { const p = toPx(c); this.addFx(p.x, p.y - 20, s, color, size, life); }

  // ---------------- 判定の補助 ----------------
  pools() { return this.lesions.filter(l => l.isPool && !l.done && l.amount > 0); }
  blocked(l) { return !l.isPool && this.pools().some(p => l.overlappedBy(p)); }
  // 押した位置にある病巣（あとから出た順）
  lesionsAt(c, extraTol = 0) {
    return this.lesions.filter(l => !l.done && (l.contains(c) || (extraTol && l.nearPath(c, extraTol)))).sort((a, b) => b.order - a.order);
  }
  // 今の段階（省略できる段階を飛ばした先も含む）がその機器か
  stepFor(l, inst) {
    if (l.done) return null;
    if (l.step.instrument === inst) return { skipped: false };
    if (l.step.optional && l.steps[l.stepIdx + 1] && l.steps[l.stepIdx + 1].instrument === inst) return { skipped: true };
    return null;
  }

  // ---------------- 入力 ----------------
  hit(r, p) { return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h; }
  down(p) {
    this.app.sound.unlock();
    if (this.ended) return;
    if (this.talk) return this.talkClick(p);
    if (this.menu) { const b = this.menuButtons.find(b => b.hit(p)); if (b) { this.app.sound.se('select'); b.onClick(); } return; }
    if (this.hit(this.menuRect, p)) { this.menu = true; this.app.sound.se('select'); this.app.sound.stopLoops(); return; }
    // 薬ボタンは手術エリアより優先（F8）
    if (this.sel === 'injector' && this.drugOpen) {
      const d = this.drugRects.find(r => this.hit(r, p));
      if (d) { this.drug = d.id; this.app.sound.se('select'); return; }
    }
    const ir = this.instRects.find(r => this.hit(r, p));
    if (ir) { this.select(ir.id); return; }
    if (this.tapeVisible() && this.hit(this.tape, p)) { this.op = { type: 'tapelift', up: (q, qp, forced) => { if (!forced && qp && this.hit(this.tape, qp)) { this.tapeLifted = true; this.app.sound.se('grab'); } } }; return; }
    const c = toCell(p);
    if (!inArea(c)) return;
    this.startOp(c, p);
  }
  move(p) { if (this.op && this.op.move) this.op.move(toCell(p), p); this.hoverP = p; }
  up(p, forced) { const op = this.op; this.op = null; if (op && op.up) op.up(toCell(p), p, forced); this.app.sound.stopLoops(); }
  hover(p) { this.hoverP = p; }
  forceRelease() { if (this.op) { const op = this.op; this.op = null; op.up && op.up(op.last || { x: -99, y: -99 }, null, true); } this.app.sound.stopLoops(); this.app.view.primary = null; }
  key(k) {
    if (this.talk || this.ended) return;
    if (k === 'Escape') { this.menu = !this.menu; return; }
    if (this.menu || this.app.view.pressing) return;   // 押している間のキー入力は無視（spec/05 2.5）
    if (k === 'g' || k === 'G') this.grid = !this.grid;
    if (k === 'h' || k === 'H') this.hint = !this.hint;
    const n = parseInt(k, 10);
    if (n >= 1 && n <= 6) {
      const id = this.D.instruments.order[n - 1];
      if (id === 'injector' && this.sel === 'injector') { this.drugOpen = !this.drugOpen; return; }   // 6キーをもう一度で閉じる
      this.select(id);
    }
  }
  select(id) {
    if (this.sel !== id) this.app.sound.se('select');
    this.sel = id; this.tapeLifted = false;
    this.drugOpen = id === 'injector';           // 注射を選ぶと薬ボタンを展開する（D13）
  }
  tapeVisible() {
    return this.lesions.some(l => !l.done && !this.blocked(l) && this.stepFor(l, 'taping'));
  }

  startOp(c, p) {
    if (this.tapeLifted) return this.opTaping(c);
    const f = { healjelly: this.opJelly, drain: this.opDrain, tweezers: this.opTweezers, scalpel: this.opScalpel, needle: this.opNeedle, injector: this.opInject }[this.sel];
    f.call(this, c, p);
  }

  // ヒールゼリー（spec/05 3.1）
  opJelly(c) {
    const J = this.D.instruments.healjelly, S = this.app.sound;
    if (this.stock < 1) { this.invalid(); this.op = { type: 'healjelly', noStock: true }; return; }   // ストック0なら塗っている間の回復も無し（D21）
    this.stock--;
    const op = { type: 'healjelly', covered: new Set(), prev: c, last: c, healed: 0, acc: 0 };
    const paint = (a, b) => {
      const r = J.brush_radius, n = Math.max(1, Math.ceil(dist(a, b) / 0.5));
      for (let i = 0; i <= n; i++) {           // 前の位置と今の位置を結んだ線分も塗る（F7）
        const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
        for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++)
          if (Math.hypot(xx - x, yy - y) <= r) op.covered.add(key(xx, yy));
      }
    };
    const giveHeal = v => { const cap = J.paint_heal.cap; const g = Math.min(v, cap - op.healed); if (g > 0) { op.healed += g; this.heal(g); } };
    giveHeal(J.paint_heal.first);
    paint(c, c);
    S.loop('gel', true);
    op.move = q => { paint(op.prev, q); op.prev = q; op.last = q; };
    op.tick = dt => { op.acc += dt; while (op.acc >= J.paint_heal.every_sec) { op.acc -= J.paint_heal.every_sec; giveHeal(J.paint_heal.step); } };
    op.up = () => {
      S.loop('gel', false);
      let any = false;
      for (const l of [...this.lesions]) {
        if (l.done || l.isPool || !l.cells.length) continue;
        const n = l.cells.filter(cc => op.covered.has(key(cc.x, cc.y))).length;
        if (n === 0) continue;
        any = true;
        const ratio = n / l.cells.length;
        const sf = this.stepFor(l, 'healjelly');
        if (ratio < J.cover_threshold || !sf || sf.skipped || this.blocked(l)) { this.invalid(); continue; }
        l.coverPenalty += Math.round((1 - ratio) * 100);   // 覆いきらない分は減点（D20）
        this.stepSuccess(l);
      }
    };
    this.op = op;
  }

  // ドレーン（spec/05 3.2）。重なった血溜まり・膿は同時に吸う
  opDrain(c) {
    const DR = this.D.instruments.drain, S = this.app.sound;
    const op = { type: 'drain', cur: c, last: c, acc: 0 };
    S.loop('drain', true);
    op.move = q => { op.cur = q; op.last = q; };
    op.tick = dt => {
      op.acc += dt;
      while (op.acc >= DR.tick_sec) {
        op.acc -= DR.tick_sec;
        const under = this.pools().filter(pl => pl.contains(op.cur));
        for (const pl of under) {
          pl.amount = Math.max(0, Math.floor(pl.amount) - DR.per_tick);
          if (pl.amount <= 0) this.stepSuccess(pl, { at: op.cur });
        }
      }
    };
    op.up = () => S.loop('drain', false);
    this.op = op;
  }

  // ピンセット（spec/05 3.3）
  opTweezers(c, p) {
    const T = this.D.instruments.tweezers;
    const at = this.lesionsAt(c);
    const target = at.find(l => !l.isPool && this.stepFor(l, 'tweezers') && !this.stepFor(l, 'tweezers').skipped && !this.blocked(l));
    if (!target) { if (at.length) this.invalid(); return; }   // 掴めない物の上は無効、何も無い場所は何も起きない
    this.app.sound.se('grab');
    this.trayShownAt = this.real;
    const op = { type: 'tweezers', l: target, from: p, cur: p, last: c };
    op.move = (q, qp) => { op.cur = qp; op.last = q; };
    op.up = (q, qp, forced) => {
      this.trayShownAt = -1;
      if (!forced && qp && this.hit(this.tray, qp)) this.stepSuccess(target);
      else this.fail(target, target.center(), target.step.fail_damage ?? T.default_fail_damage);   // 物は元の位置に戻る
    };
    this.op = op;
  }

  // メス（spec/05 3.4）
  opScalpel(c) {
    const SC = this.D.instruments.scalpel;
    const cands = this.lesions.filter(l => !l.done && l.path && this.stepFor(l, 'scalpel') && l.nearPath(c, SC.tolerance)).sort((a, b) => b.order - a.order);
    const blockedHere = this.lesions.filter(l => !l.done && !l.isPool && (l.contains(c) || l.nearPath(c, SC.tolerance)) && this.blocked(l));
    if (blockedHere.length) { this.invalid(); return; }   // 血溜まり・膿が重なっている病巣の上は無効
    const target = cands.find(l => !this.blocked(l));
    if (target) return this.cutStart(target, c, this.stepFor(target, 'scalpel').skipped);
    const at = this.lesionsAt(c, SC.tolerance);
    const solid = at.filter(l => !l.isPool);
    if (solid.length) { const l = solid[0]; this.fail(l, c, SC.default_fail_damage); return; }   // 手順違い：失敗
    if (at.length) { this.invalid(); return; }             // 血溜まりだけの場所：無効
    // 空振り：最短の長さに達したらダメージと小さな切り傷（1回だけ）
    const op = { type: 'scalpel-miss', pts: [c], last: c, hit: false };
    op.move = q => { op.pts.push(q); op.last = q; if (!op.hit && pathLength(op.pts) >= SC.min_cut) { op.hit = true; this.miss(q, SC.miss_damage); this.app.sound.se('cut'); } };
    op.up = () => {
      if (!op.hit) return;
      const pts = []; let len = 0;
      for (let i = 0; i < op.pts.length; i++) { if (i) len += dist(op.pts[i - 1], op.pts[i]); if (len > SC.small_cut_max_len) break; pts.push(op.pts[i]); }
      const cut = makeSmallCut(this.D.lesions.small_cut, pts); cut.appearT = this.t;
      this.lesions.push(cut);
    };
    this.op = op;
  }
  cutStart(l, c, skipped) {
    const SC = this.D.instruments.scalpel, P = l.path, n = P.length, R = SC.pass_radius, TOL = SC.tolerance;
    const fd = l.step.fail_damage ?? SC.default_fail_damage;
    // st.from：直前に通過した位置。st.target：次の通過点（null＝向きが未確定、'home'＝始めた位置へ戻る）
    const st = { type: 'scalpel', l, last: c, prev: c, passed: new Set(), dir: 0, target: null, cands: [], done: false };
    if (!l.closed) {
      if (dist(c, P[0]) <= R) { st.dir = 1; st.passed.add(0); st.from = P[0]; st.target = 1; }
      else if (dist(c, P[n - 1]) <= R) { st.dir = -1; st.passed.add(n - 1); st.from = P[n - 1]; st.target = n - 2; }
      else { this.fail(l, c, fd); return; }     // 端以外から切り始めた（線の猶予幅の中）
    } else {
      const k = P.findIndex(q => dist(c, q) <= R);
      if (k >= 0) { st.passed.add(k); st.from = P[k]; st.home = P[k]; st.startIdx = k; st.cands = [(k + 1) % n, (k - 1 + n) % n]; }
      else {                                    // 線の途中から始めた（P41）：その線の両端のどちらかへ進み、一周して戻る
        let best = 0, bd = Infinity;
        for (let i = 0; i < n; i++) { const d = distToSeg(c, P[i], P[(i + 1) % n]); if (d < bd) { bd = d; best = i; } }
        st.from = c; st.home = c; st.startSeg = best; st.cands = [best, (best + 1) % n];
      }
    }
    const S = this.app.sound; S.loop('cut', true);
    const finish = ok => { st.done = true; S.loop('cut', false); if (ok) this.stepSuccess(l, { skipped }); else this.fail(l, st.last, fd); };
    const stepTo = q => {
      // 猶予幅：直前に通過した位置から次の通過点への直線から外れたら失敗
      let dev;
      if (st.target === null) dev = Math.min(...st.cands.map(t => distToSeg(q, st.from, P[t])));
      else if (st.target === 'home') dev = distToSeg(q, st.from, st.home);
      else dev = distToSeg(q, st.from, P[st.target]);
      if (dev > TOL) { st.last = q; finish(false); return; }
      if (st.target === 'home') { if (dist(q, st.home) <= R && dist(q, st.from) > R) { st.last = q; finish(true); } return; }
      for (let i = 0; i < n; i++) {
        if (dist(q, P[i]) > R || st.passed.has(i)) continue;
        const ok = st.target === null ? st.cands.includes(i) : st.target === i;
        if (!ok) { st.last = q; finish(false); return; }   // 目標以外の通過点に入った＝飛ばした
        if (st.target === null) {                // 2点目で向きが決まる
          st.dir = st.startIdx !== undefined ? (i === (st.startIdx + 1) % n ? 1 : -1) : (i === (st.startSeg + 1) % n ? 1 : -1);
        }
        st.passed.add(i); st.from = P[i];
        if (st.passed.size === n) {
          if (!l.closed) { st.last = q; finish(true); return; }
          st.target = 'home';
        } else st.target = (i + st.dir + n) % n;
        return;
      }
    };
    st.move = q => {
      const nn = Math.max(1, Math.ceil(dist(st.prev, q) / 0.4));   // 素早く動かしても線分で判定（F7）
      for (let i = 1; i <= nn && !st.done; i++) stepTo({ x: st.prev.x + (q.x - st.prev.x) * i / nn, y: st.prev.y + (q.y - st.prev.y) * i / nn });
      st.prev = q; if (!st.done) st.last = q;
      if (st.done) this.op = null;
    };
    st.up = () => { S.loop('cut', false); if (!st.done) this.invalid(); };   // 途中で離したら無効
    this.op = st;
  }

  // 縫合針（spec/05 3.5）
  opNeedle(c) {
    const N = this.D.instruments.needle;
    const near = this.lesions.filter(l => !l.done && l.path && this.stepFor(l, 'needle') && !this.stepFor(l, 'needle').skipped && l.nearPath(c, N.tolerance));
    if (near.some(l => this.blocked(l))) { this.invalid(); return; }
    near.sort((a, b) => distToPolyline(c, a.path) - distToPolyline(c, b.path));   // 押した位置に最も近い線（P38）
    const l = near[0];
    if (!l) {
      const at = this.lesionsAt(c);
      if (at.length && at.every(x => x.isPool || this.blocked(x))) { this.invalid(); return; }
      this.miss(c, N.miss_damage); return;      // 押した瞬間に空振り（P37）
    }
    const op = { type: 'needle', l, count: 0, armed: true, prev: c, last: c, failed: false };
    this.app.sound.se('stitch');
    op.move = q => {
      if (op.failed) return;
      if (distToPolyline(q, l.path) > N.tolerance) { op.failed = true; this.fail(l, q, l.step.fail_damage ?? N.default_fail_damage); this.op = null; return; }
      let crossed = false;
      for (let i = 0; i < l.path.length - 1; i++) if (segCross(op.prev, q, l.path[i], l.path[i + 1])) crossed = true;
      if (crossed && op.armed) { op.count++; op.armed = false; this.app.sound.se('stitch', 1.2); }
      if (!op.armed && distToPolyline(q, l.path) >= N.tolerance / 3) op.armed = true;   // 手ぶれ対策
      op.prev = q; op.last = q;
    };
    op.up = (q, qp, forced) => {
      if (op.failed) return;
      if (!forced && op.count >= l.path.length) this.stepSuccess(l, { at: q });
      else this.invalid();
    };
    this.op = op;
  }

  // 注射（spec/05 3.6）
  opInject(c) {
    const IJ = this.D.instruments.injector, drug = IJ.drugs[this.drug], S = this.app.sound;
    if (this.gauge <= 0.5) { this.invalid(); return; }
    let target = null;
    if (drug.specific) {
      const at = this.lesionsAt(c);
      const hit = at.find(l => !l.isPool && l.steps.some(s => s.drug === this.drug));
      if (hit && this.blocked(hit)) { this.invalid(); return; }
      if (hit && hit.step.instrument === 'injector' && hit.step.drug === this.drug) target = hit;
      else if (hit) { if (drug.wrong_step === 'invalid') this.invalid(); else this.fail(hit, c, drug.wrong_step_damage || 1); return; }
      else { this.miss(c, drug.miss_damage); return; }   // タップした時点でダメージ、注入しない
    }
    S.loop('inject', true);
    const op = { type: 'inject', last: c };
    op.tick = dt => {
      const amt = Math.min(this.gauge, IJ.rate_per_sec * dt);
      if (amt <= 0) return;
      this.gauge -= amt;
      this.injectTotals[this.drug] = (this.injectTotals[this.drug] || 0) + amt;
      const pid = this.patient || 'skin';
      this.dose[pid] = this.dose[pid] || {};
      this.dose[pid][this.drug] = (this.dose[pid][this.drug] || 0) + amt;
      if (this.drug === 'recovery') this.heal(drug.heal_full_gauge * amt / 100);
      if (this.drug === 'anesthesia') this.anesthesia += drug.duration_full_gauge * amt / 100 * this.coef('anesthesia');
      if (target) { target.injected += amt; if (target.injected >= target.step.need) { target.injected = 0; this.stepSuccess(target, { at: c }); target = null; } }
      const lim = this.doseLimit(this.drug);
      if (lim !== null && this.dose[pid][this.drug] > lim) this.doseOver = true;   // 上回った瞬間にゲームオーバー
    };
    op.up = () => S.loop('inject', false);
    this.op = op;
  }
  doseLimit(drug) {
    const pl = (this.patientDef().dose_limits || {})[drug] ?? this.D.instruments.injector.drugs[drug].dose_limit;
    return pl == null ? null : pl * this.coef('dose_limit');
  }

  // テーピング（spec/05 4.1。失敗・無効の扱いは未定のため、試作では外れたら無効）
  opTaping(c) {
    const TP = this.D.instruments.special.taping;
    const l = this.lesions.find(x => !x.done && x.path && this.stepFor(x, 'taping') && !this.blocked(x) && (dist(c, x.path[0]) <= TP.pass_radius || dist(c, x.path[x.path.length - 1]) <= TP.pass_radius));
    if (!l) { this.invalid(); return; }
    const skipped = this.stepFor(l, 'taping').skipped;
    const P = l.path, n = P.length; const fromEnd = dist(c, P[0]) <= TP.pass_radius ? 0 : n - 1; const dir = fromEnd === 0 ? 1 : -1;
    const op = { type: 'taping', idx: fromEnd, prev: c, last: c, done: false };
    op.move = q => {
      if (op.done) return;
      const nxt = op.idx + dir;
      if (distToSeg(q, P[op.idx], P[nxt]) > TP.tolerance) { op.done = true; this.invalid(); return; }
      if (dist(q, P[nxt]) <= TP.pass_radius) { op.idx = nxt; if (op.idx === (dir > 0 ? n - 1 : 0)) { op.done = true; this.tapeLifted = false; this.stepSuccess(l, { skipped }); } }
      op.last = q;
    };
    op.up = () => { if (!op.done) this.invalid(); };
    this.op = op;
  }

  // ---------------- トレーニング ----------------
  startTraining() {
    const tr = this.training, T = this.D.stages.training;
    this.patient = T.patient; this.preCount = 0;
    this.trainQueue = tr.kinds.slice(); this.trainIndex = 0; this.stepIdx = 0; this.pending = []; this.subFired = new Set();
    this.trainSpawn();
  }
  trainSpawn() {
    const kind = this.trainQueue[this.trainIndex];
    const def = this.D.lesions[kind];
    let pos = [44, 24];
    if (this.training.mode === 'random') pos = [15 + Math.floor(Math.random() * 55), 8 + Math.floor(Math.random() * 30)];
    const l = new Lesion(def, { id: 'tr' + this.trainIndex, pos }, kind); l.appearT = this.t;
    this.lesions = [l];
    if (kind === 'laceration' || kind === 'tumor') { /* 練習では単体で出す（血溜まり・膿は別の種類） */ }
  }
  trainingDone() { return this.trainIndex >= this.trainQueue.length - 1; }
  trainingNext() {
    this.archive = (this.archive || []).concat(this.lesions);
    if (this.trainingDone()) { this.ended = true; this.app.sound.se('clear'); setTimeout(() => this.app.onTrainingEnd(this), 1000); return; }
    this.trainIndex++; this.trainSpawn();
  }

  // ---------------- 描画 ----------------
  draw(c) {
    this.drawArea(c);
    this.drawColumns(c);
    this.drawTop(c);
    this.drawSubtitle(c);
    this.drawOpp(c);
    if (this.sel === 'injector' && this.drugOpen) this.drawDrugs(c);
    this.drawHeld(c);
    for (const f of this.fx) { const a = Math.min(1, f.life / f.max * 2); c.globalAlpha = a; text(c, f.s, f.x, f.y - (1 - f.life / f.max) * 40, { size: f.size, align: 'center', bold: true, color: f.color, stroke: 5 }); c.globalAlpha = 1; }
    if (this.talk) this.drawTalk(c);
    if (this.menu) {
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, W, H);
      text(c, 'メニュー（一時停止中）', W / 2, 320, { size: 48, align: 'center' });
      for (const b of this.menuButtons) b.draw(c, b.hit(this.hoverP));
    }
  }
  tempo() {
    if (this.anesthesia > 0) return 1.6;
    const v = this.dispVital(); return v > 50 ? 1.0 : v > 25 ? 0.6 : 0.35;
  }
  drawArea(c) {
    const A = AREA, pd = this.patientDef();
    c.save(); c.beginPath(); c.rect(A.x, A.y, A.w, A.h); c.clip();
    const frames = pd.images, f = frames[Math.floor(((this.real / this.tempo()) * 2) % frames.length)];
    if (!drawImg(c, f, A.x, A.y, A.w, A.h, 'cover')) { c.fillStyle = '#e8c3a8'; c.fillRect(A.x, A.y, A.w, A.h); }
    c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(A.x, A.y, A.w, A.h);
    if (this.grid) {
      c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1;
      for (let x = 0; x <= COLS; x++) { c.beginPath(); c.moveTo(A.x + x * CELL, A.y); c.lineTo(A.x + x * CELL, A.y + A.h); c.stroke(); }
      for (let y = 0; y <= ROWS; y++) { c.beginPath(); c.moveTo(A.x, A.y + y * CELL); c.lineTo(A.x + A.w, A.y + y * CELL); c.stroke(); }
    }
    const ls = this.lesions.slice().sort((a, b) => a.order - b.order);
    for (const l of ls) if (!l.isPool) this.drawLesion(c, l);
    for (const l of ls) if (l.isPool && !l.done) this.drawPool(c, l);
    // 塗った範囲・軌跡
    const op = this.op;
    if (op && op.type === 'healjelly' && op.covered) {
      c.fillStyle = 'rgba(120,200,255,0.28)';
      for (const k of op.covered) { const [x, y] = k.split(',').map(Number); c.fillRect(A.x + x * CELL, A.y + y * CELL, CELL, CELL); }
    }
    if (op && op.type === 'needle') text(c, `${op.count} / ${op.l.path.length}`, toPx(op.last).x, toPx(op.last).y - 50, { size: 30, align: 'center', bold: true, stroke: 4 });
    // 指のまわりに機器の範囲を表示（見た目だけ）
    if (this.app.view.pressing && this.hoverP && !this.op?.type?.startsWith('tweezers')) {
      const r = this.sel === 'healjelly' && !this.tapeLifted ? this.D.instruments.healjelly.brush_radius * CELL : 26;
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2; c.beginPath(); c.arc(this.hoverP.x, this.hoverP.y, r, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
    c.strokeStyle = '#2f6fb5'; c.lineWidth = 3; c.strokeRect(A.x, A.y, A.w, A.h);
  }
  drawLesion(c, l) {
    if (this.op && this.op.type === 'tweezers' && this.op.l === l) {   // 掴んでいる間は元の位置に薄い影
      c.globalAlpha = 0.25; this.drawLesionShape(c, l, 0, 0); c.globalAlpha = 1; return;
    }
    if (l.done) {
      if (l.def.draw === 'object' || l.def.draw === 'tumor') return;      // 取り除いた物は消える
      c.globalAlpha = 0.25; this.drawLesionShape(c, l, 0, 0); c.globalAlpha = 1; return;
    }
    this.drawLesionShape(c, l, 0, 0);
    const blocked = this.blocked(l);
    if (this.hint || blocked) {
      const p = toPx(l.center());
      const s = l.step; const label = blocked ? '血溜まり' : (this.D.instruments[s.instrument]?.name || (s.instrument === 'taping' ? 'テーピング' : s.instrument)) + (s.optional ? '（省略可）' : '');
      text(c, label, p.x, p.y - 30, { size: 20, align: 'center', color: blocked ? '#ffb0b0' : '#fff', stroke: 4 });
    }
    if (l.step.instrument === 'injector' && l.injected > 0) { const p = toPx(l.center()); text(c, `${Math.round(l.injected)}/${l.step.need}`, p.x, p.y + 40, { size: 22, align: 'center', stroke: 4 }); }
  }
  drawLesionShape(c, l, dx, dy) {
    const col = l.color;
    const P = (q) => { const p = toPx(q); return { x: p.x + dx, y: p.y + dy }; };
    const d = l.def.draw;
    if (d === 'line' || d === 'cutline') {
      if (l.drawPts) {
        c.strokeStyle = col; c.lineWidth = l.def.thick ? 12 : 7; c.lineCap = 'round'; c.lineJoin = 'round';
        if (d === 'cutline') c.setLineDash([14, 10]);
        c.beginPath(); l.drawPts.forEach((q, i) => { const p = P(q); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.stroke(); c.setLineDash([]);
        if (l.path && l.steps.some(s => ['scalpel', 'needle', 'taping'].includes(s.instrument)) && !l.done) {
          c.fillStyle = '#fff'; for (const q of l.path) { const p = P(q); c.beginPath(); c.arc(p.x, p.y, 5, 0, Math.PI * 2); c.fill(); }
        }
      } else {
        c.fillStyle = col; for (const q of l.cells) { const p = P(q); c.fillRect(p.x - 6, p.y - 3, 12, 6); }
      }
      if (l.step && l.step.instrument === 'taping' && !l.done) { c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2; c.setLineDash([6, 6]); c.beginPath(); l.path.forEach((q, i) => { const p = P(q); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.stroke(); c.setLineDash([]); }
    } else if (d === 'object') {
      c.fillStyle = col; c.strokeStyle = '#222'; c.lineWidth = 2;
      for (const q of l.cells) { const p = P(q); c.fillRect(p.x - 7, p.y - 7, 14, 14); c.strokeRect(p.x - 7, p.y - 7, 14, 14); }
    } else if (d === 'tumor' || d === 'blob') {
      const ctr = P(l.center());
      c.fillStyle = col; c.beginPath(); c.arc(ctr.x, ctr.y, (l.def.hit[0].radius + 0.5) * CELL, 0, Math.PI * 2); c.fill();
      if (l.path && l.step && l.step.instrument === 'scalpel' && !l.done) {
        c.strokeStyle = '#2e86c1'; c.lineWidth = 4; c.setLineDash([10, 8]); c.beginPath();
        l.path.forEach((q, i) => { const p = P(q); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#fff'; for (const q of l.path) { const p = P(q); c.beginPath(); c.arc(p.x, p.y, 5, 0, Math.PI * 2); c.fill(); }
      }
    }
  }
  drawPool(c, l) {
    const p = toPx({ x: l.ox, y: l.oy }), r = l.radius() * CELL;
    c.fillStyle = l.color; c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
    text(c, String(Math.ceil(l.amount)), p.x, p.y + 8, { size: 22, align: 'center', color: '#fff', stroke: 4 });
  }
  drawHeld(c) {
    const op = this.op;
    if (op && op.type === 'tweezers') {    // 掴んでいる物は最上位レイヤー
      const dx = op.cur.x - op.from.x, dy = op.cur.y - op.from.y;
      this.drawLesionShape(c, op.l, dx, dy);
    }
    if (this.tapeLifted && this.hoverP) { c.fillStyle = 'rgba(245,235,200,0.9)'; c.fillRect(this.hoverP.x - 40, this.hoverP.y - 12, 80, 24); }
  }
  highlights() {
    const normal = new Set(), light = new Set(), drugs = new Set();
    for (const l of this.lesions) {
      if (l.done) continue;
      if (this.blocked(l)) continue;   // 重なった血溜まりのドレーンが強調される
      const s = l.step;
      if (s.instrument !== 'taping') normal.add(s.instrument);
      if (s.instrument === 'injector' && s.drug) drugs.add(s.drug);
      if (s.optional) { const nx = l.steps[l.stepIdx + 1]; if (nx && nx.instrument !== 'taping') { if (!normal.has(nx.instrument)) light.add(nx.instrument); } }
    }
    if (!this.training) { const st = this.stage.steps[this.stepIdx]; if (st && st.clear_condition && st.clear_condition.type === 'inject') { normal.add('injector'); drugs.add(st.clear_condition.drug); } }
    return { normal, light, drugs };
  }
  blinkOn() { const ph = this.real % 2.5; return ph < 1 || (ph >= 1.5 && ph < 2); }
  drawColumns(c) {
    const I = this.D.instruments, hl = this.highlights(), on = this.blinkOn();
    panel(c, this.menuRect.x, 0, COL_W, MENU_H, { fill: '#e3e6eb', r: 0, stroke: '#8a8f99' });
    text(c, 'Menu', this.menuRect.x + COL_W / 2, MENU_H / 2, { size: 40, align: 'center', base: 'middle', color: '#222', bold: true });
    this.instRects.forEach((r, i) => {
      const sel = this.sel === r.id && !this.tapeLifted;
      c.fillStyle = sel ? '#fff3c4' : '#ffffff'; c.fillRect(r.x, r.y, r.w, r.h);
      if (on && (hl.normal.has(r.id) || hl.light.has(r.id))) { c.fillStyle = hl.normal.has(r.id) ? 'rgba(255,170,0,0.55)' : 'rgba(255,200,80,0.25)'; c.fillRect(r.x, r.y, r.w, r.h); }
      c.strokeStyle = sel ? '#e0a000' : '#8a8f99'; c.lineWidth = sel ? 6 : 2; c.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      drawImg(c, I[r.id].icon, r.x + 20, r.y + 18, 90, 90, 'contain');
      text(c, String(i + 1), r.x + 14, r.y + 30, { size: 22, color: '#888' });
      text(c, I[r.id].name, r.x + 120, r.y + 70, { size: 26, color: '#222', bold: sel });
      if (r.id === 'healjelly') {
        for (let k = 0; k < I.healjelly.stock; k++) { c.fillStyle = k < this.stock ? '#3d9be9' : '#ccd'; c.beginPath(); c.arc(r.x + 130 + k * 24, r.y + 112, 9, 0, Math.PI * 2); c.fill(); }
        if (this.stock < I.healjelly.stock) { c.fillStyle = '#3d9be9'; c.fillRect(r.x + 120, r.y + 130, 120 * this.stockAcc / I.healjelly.recover_sec, 6); }
      }
      if (r.id === 'injector') {
        c.fillStyle = '#ddd'; c.fillRect(r.x + 120, r.y + 100, 120, 16);
        c.fillStyle = I.injector.drugs[this.drug].color; c.fillRect(r.x + 120, r.y + 100, 120 * this.gauge / 100, 16);
        text(c, I.injector.drugs[this.drug].name, r.x + 120, r.y + 140, { size: 20, color: '#333' });
      }
    });
    this.hlDrugs = hl.drugs;
  }
  drawDrugs(c) {
    const I = this.D.instruments.injector, on = this.blinkOn();
    for (const r of this.drugRects) {
      const d = I.drugs[r.id], cur = this.drug === r.id;
      panel(c, r.x, r.y, r.w, r.h, { fill: cur ? '#fff3c4' : '#f4f4f4', stroke: cur ? '#e0a000' : '#777', lw: cur ? 5 : 2 });
      if (on && this.hlDrugs && this.hlDrugs.has(r.id)) { c.fillStyle = 'rgba(255,170,0,0.45)'; roundRect(c, r.x, r.y, r.w, r.h, 12); c.fill(); }
      c.fillStyle = d.color; c.fillRect(r.x + 14, r.y + 30, 32, 32);
      text(c, d.name, r.x + 60, r.y + 58, { size: 28, color: '#222', bold: cur });
      const lim = this.doseLimit(r.id);
      if (lim) { const used = ((this.dose[this.patient || 'skin'] || {})[r.id] || 0); text(c, `${Math.round(used)}/${Math.round(lim)}`, r.x + r.w - 10, r.y + 84, { size: 18, color: used > lim * 0.8 ? '#d00' : '#555', align: 'right' }); }
    }
  }
  drawTop(c) {
    panel(c, 260, 0, 1400, MENU_H, { fill: '#1a1f27', r: 0, stroke: '#444' });
    const v = this.dispVital();
    const col = v > 50 ? '#3fae6a' : v > 25 ? '#e6c229' : '#e04444';
    text(c, 'バイタル', 300, 70, { size: 30, color: '#ccc' });
    c.fillStyle = '#333'; c.fillRect(440, 40, 1000, 44);
    c.fillStyle = col; c.fillRect(440, 40, 1000 * v / 99, 44);
    text(c, String(v), 1480, 76, { size: 48, bold: true, color: col });
    if (this.anesthesia > 0) text(c, `麻酔 ${this.anesthesia.toFixed(1)}秒`, 440, 130, { size: 26, color: '#8fb4ff' });
    const total = this.allLesions().filter(l => !l.runtime && l.score).reduce((s, l) => s + l.score.total, 0);
    if (!this.training) text(c, `ステップ ${this.stepIdx + 1}/${this.stage.steps.length}　点数 ${total}　ミス ${this.totalFails}`, 800, 130, { size: 24, color: '#aab' });
    else text(c, `トレーニング ${this.trainIndex + 1}/${this.trainQueue.length}　（制限時間なし）`, 800, 130, { size: 24, color: '#aab' });
  }
  drawOpp(c) {
    const x = this.oppX;
    panel(c, x, 0, COL_W, MENU_H, { fill: '#e3e6eb', r: 0, stroke: '#8a8f99' });
    if (this.timeLimit) {
      const s = Math.max(0, Math.ceil(this.timeLeft)); const mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
      text(c, '残り時間', x + COL_W / 2, 60, { size: 26, align: 'center', color: '#444' });
      text(c, `${mm}:${ss}`, x + COL_W / 2, 130, { size: 54, align: 'center', bold: true, color: s <= 30 ? '#d00' : '#222' });
    } else text(c, '制限時間なし', x + COL_W / 2, 100, { size: 26, align: 'center', color: '#444' });
    c.fillStyle = '#2b3038'; c.fillRect(x, MENU_H, COL_W, H - MENU_H);
    // トレイ：掴んだ時点で枠外から出てくる
    if (this.trayShownAt >= 0) {
      const k = Math.min(1, (this.real - this.trayShownAt) / 0.25), off = (1 - k) * 300 * (this.side === 'left' ? 1 : -1);
      const r = this.tray;
      panel(c, r.x + off, r.y, r.w, r.h, { fill: '#c9d3dc', stroke: '#6b7a88', lw: 4 });
      text(c, 'トレイ', r.x + off + r.w / 2, r.y + r.h / 2, { size: 30, align: 'center', base: 'middle', color: '#333' });
    }
    if (this.tapeVisible()) {
      if (this.tapeShownAt < 0) this.tapeShownAt = this.real;
      const k = Math.min(1, (this.real - this.tapeShownAt) / 0.3), off = (1 - k) * 300 * (this.side === 'left' ? 1 : -1);
      const r = this.tape;
      c.globalAlpha = this.tapeLifted ? 0.35 : 1;
      panel(c, r.x + off, r.y, r.w, r.h, { fill: '#f5ebc8', stroke: '#a89060', lw: 4, r: 90 });
      text(c, 'テープ', r.x + off + r.w / 2, r.y + r.h / 2, { size: 30, align: 'center', base: 'middle', color: '#6b5a30' });
      c.globalAlpha = 1;
      text(c, this.tapeLifted ? '傷の端から端へなぞる' : 'タップして持ち上げる', x + COL_W / 2, r.y + r.h + 40, { size: 20, align: 'center', color: '#ddd' });
    } else this.tapeShownAt = -1;
  }
  drawSubtitle(c) {
    panel(c, SUB.x, SUB.y, SUB.w, SUB.h, { fill: 'rgba(10,12,16,0.92)', r: 0, stroke: '#444' });
    if (!this.sub) return;
    const ch = this.D.talks.characters[this.sub.who];
    if (ch) drawImg(c, ch.face, SUB.x + 20, SUB.y + 10, 180, 180, 'face');
    text(c, this.sub.who || '', SUB.x + 230, SUB.y + 50, { size: 26, color: '#9fc6ff' });
    wrap(c, this.sub.t, SUB.w - 270, 34).slice(0, 3).forEach((ln, i) => text(c, ln, SUB.x + 230, SUB.y + 100 + i * 44, { size: 34 }));
  }
  drawTalk(c) {
    const tk = this.talk, ln = tk.lines[tk.i] || {};
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, W, H);
    const chars = this.D.talks.characters;
    if (tk.left && chars[tk.left]) drawImg(c, chars[tk.left].image, 140, 120, 480, 760, 'contain');
    if (tk.right && chars[tk.right]) drawImg(c, chars[tk.right].image, 1300, 120, 480, 760, 'contain');
    panel(c, 160, 760, 1600, 280);
    if (ln.who) text(c, ln.who, 200, 815, { size: 32, color: '#9fc6ff', bold: true });
    wrap(c, ln.t || '', 1500, 38).forEach((s, i) => text(c, s, 200, 880 + i * 52, { size: 38 }));
    if (tk.choiceButtons) tk.choiceButtons.forEach(b => b.draw(c, b.hit(this.hoverP)));
    else text(c, '▼ タップで次へ', 1720, 1015, { size: 22, align: 'right', color: '#aaa' });
  }
}
