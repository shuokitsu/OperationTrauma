// ゲーム画面（spec/02 3.4、spec/03）。1ステージにつき1つ。ステージの中のステップはこの画面の中で進める。

import { Assets } from './assets.js';
import { Save } from './save.js';
import { W, H, COLOR, text, wrap, panel, Button, clickButtons, drawImage, dim, roundRect } from './ui.js';
import { AREA, toCell, toLogical, inArea } from './geometry.js';
import { Lesion } from './lesion.js';
import { beginOp, moveOp, holdOp, endOp } from './tools.js';
import { drawLesion, drawGuide, drawTrail, drawCarried } from './draw.js';
import { TalkPlayer, condOk } from './talk.js';

const COL_W = 260, MENU_H = 180, ICON_H = 150;
const RATE_COLOR = { Cool: '#6fe3ff', Good: '#5ad67d', Fine: '#f2c14e', Bad: '#e5484d', OK: '#ffffff', MISS: '#e5484d' };

export class Surgery {
  // cfg: { stage, difficulty, flags(Set), startAfter(ステップID。そのコンティニューポイントから始める), choiceKey,
  //        training, onClear(result), onGameOver(cause), onRetry(), onQuit() }
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.stage = cfg.stage;
    this.sys = app.data.system;
    this.inst = app.data.instruments;
    this.flags = cfg.flags;
    this.initialFlags = [...cfg.flags];
    this.steps = this.stage.steps;

    const I = this.inst;
    this.vital = Math.min(99, this.stage.start_vital * this.coef('start_vital'));
    this.minVital = this.vital;
    const tl = this.stage.time_limit_sec;
    this.timeLeft = (cfg.training || !tl) ? null
      : tl * (this.stage.time_limit_fixed ? (this.stage.coefficients?.time_limit ?? 1) : this.coef('time_limit'));
    this.natT = 0;
    this.stock = I.healjelly.stock_max;
    this.stockT = 0;
    this.drugs = this.listDrugs();
    this.gauges = Object.fromEntries(Object.keys(I.injector.drugs).map(d => [d, 100]));
    this.anes = 0;
    this.doses = {};
    this.tool = 'healjelly';
    this.drug = I.injector.initial_drug;
    this.drugOpen = true;
    this.injecting = null;

    this.lesions = [];
    this.pending = [];
    this.records = [];        // 治療が終わった病巣の点数（全ステップ分）
    this.skippedMax = 0;      // コンティニューポイントより前の病巣の数（最大点に数え、0点とする）
    this.totalMisses = 0;
    this.treated = new Set();
    this.lastCP = cfg.startAfter ? { id: cfg.startAfter, flags: [...cfg.flags] } : null;

    this.phase = 'init';      // 'talk' | 'play' | 'flat' | 'ended'
    this.talk = null;
    this.menu = null;
    this.subs = null;         // 字幕 { lines, k, t }
    this.op = null;
    this.pressing = false;
    this.pressTape = false;
    this.lastCell = [0, 0];
    this.pointer = { x: 0, y: 0 };
    this.tray = { show: false, t: 0 };
    this.tapeT = 0;
    this.tapeLifted = false;
    this.prevTool = null;
    this.popups = [];
    this.trails = [];
    this.loop = null;
    this.clock = 0;           // ゲーム内の時間（一時停止で止まる）
    this.flash = 0;
    this.stepDoneT = null;
    this.message = null;
    this.patient = null;
    this.patientId = null;
    this.showGrid = false;
    this.showHint = false;

    // 心電図
    this.bpm = this.targetBpm();
    this.beat = 0;
    this.wave = new Array(360).fill(0);
    this.waveAcc = 0;
    this.flat = false;
    this.flatTone = null;
    this.flatT = 0;
    this.breath = 0;

    Assets.playBgm(this.stage.bgm || 'surgery');

    // 始めるステップを決める
    let first = 0;
    if (cfg.startAfter) {
      const at = this.steps.findIndex(s => s.id === cfg.startAfter);
      for (let i = 0; i <= at; i++) if (condOk(this.steps[i], this.flags)) this.skippedMax += (this.steps[i].lesions || []).length;
      first = at + 1;
    }
    const idx = this.findNext(first);
    if (idx < 0) this.clear(); else this.enterStep(idx);
  }

  // ---------------- 値の計算 ----------------
  coef(key) {
    return (this.stage.coefficients?.[key] ?? 1) * (this.cfg.difficulty.coef?.[key] ?? 1);
  }
  random() { return Math.random(); }
  active() { return this.lesions.filter(L => !L.done); }
  get displayVital() { return Math.min(99, Math.max(0, Math.ceil(this.vital - 1e-9))); }

  // このステージで使う薬（回復剤・麻酔と、病巣が使う薬）
  listDrugs() {
    const I = this.inst.injector, list = [...I.default_drugs];
    for (const step of this.steps) for (const pl of step.lesions || []) {
      for (const st of this.app.data.lesions[pl.type].steps) if (st.drug && !list.includes(st.drug)) list.push(st.drug);
    }
    for (const d of this.stage.drugs || []) if (!list.includes(d)) list.push(d);
    return list;
  }

  anesthesiaStretch() {
    if (this.anes <= 0) return 1;
    return Math.max(1, this.inst.injector.drugs.anesthesia.decay_interval_stretch * this.coef('anesthesia_stretch'));
  }
  resetDecayTimers() {   // 麻酔の効き始め・切れ目には、減少のタイマーを計り直す
    this.natT = 0;
    for (const L of this.lesions) L.drainT = 0;
  }
  addAnesthesia(sec) {
    const off = this.anes <= 0;
    this.anes += sec * this.coef('anesthesia_duration');
    if (off) this.resetDecayTimers();
  }
  addDose(drug, amount) {
    const p = (this.doses[this.patientId] ||= {});
    p[drug] = (p[drug] || 0) + amount;
    const limit = this.doseLimit(drug);
    if (limit !== null && p[drug] > limit) this.over('dose');
  }
  doseLimit(drug) {
    const base = this.patient?.dose_limits?.[drug] ?? this.inst.injector.drugs[drug].dose_limit ?? null;
    return base === null ? null : base * this.coef('dose_limit');
  }
  doseRatio(drug) {
    const limit = this.doseLimit(drug);
    return limit === null ? 0 : Math.min(1, (this.doses[this.patientId]?.[drug] || 0) / limit);
  }

  damage(n) {
    this.vital -= n * this.coef('damage');
    this.flash = 0.25;
  }
  heal(n) { this.vital = Math.min(99, this.vital + n * this.coef('heal')); }
  vitalDown(n) { this.vital -= n; }

  se(name) { Assets.se(name); }
  loopStart(name) { if (this.loop !== name) { this.loopStop(); this.loop = name; Assets.loopStart(name); } }
  loopStop() { if (this.loop) { Assets.loopStop(this.loop); this.loop = null; } }
  countUse(tool) { this.stepUses[tool] = (this.stepUses[tool] || 0) + 1; }
  addTrail(tool, pts) { this.trails.push({ tool, pts, t: 0 }); }

  popup(L, label) {
    const [x, y] = toLogical(L.center());
    this.popups.push({ x, y: y - 40, label, t: 0 });
    if (label === 'OK') this.se('rate_ok');
  }

  // ---------------- 病巣 ----------------
  spawn(type, o = {}) {
    const L = new Lesion(this, type, o);
    this.lesions.push(L);
    if (L.origin === 'placed') this.se('lesion_appear');
    for (const w of L.def.with || []) {
      const at = w.at === 'points' ? L.sets.main : [L.center()];
      for (const p of at) this.spawnChild(L, { lesion: w.lesion, at: p, overrides: w.overrides });
    }
    this.emit('appear', L);
    return L;
  }
  spawnChild(parent, spec) {
    const pos = Array.isArray(spec.at) ? spec.at : parent.center();
    return this.spawn(spec.lesion, { pos, origin: 'spawned', parent, overrides: spec.overrides });
  }

  onLesionDone(L) {
    this.treated.add(L.type);
    this.totalMisses += L.misses;
    if (L.unscored) {
      this.popup(L, 'OK');
    } else {
      const score = L.score();
      const rating = this.sys.ratings.find(r => score >= r.min).name;
      this.records.push({ type: L.type, name: L.def.name, score, rating, time: L.doneAge });
      const [x, y] = toLogical(L.center());
      this.popups.push({ x, y: y - 40, label: rating, t: 0, big: true });
      this.se('rate_' + rating.toLowerCase());
    }
    this.emit('done', L);
  }

  // ---------------- ステップ ----------------
  findNext(from) {
    for (let i = from; i < this.steps.length; i++) if (condOk(this.steps[i], this.flags)) return i;
    return -1;
  }

  enterStep(idx) {
    const step = this.steps[idx];
    this.stepIdx = idx;
    this.step = step;
    this.lesions = [];
    this.stepTime = 0;
    this.stepInjected = {};
    this.stepUses = {};
    this.stepDoneT = null;
    if (step.patient || !this.patient) {
      this.patientId = step.patient || Object.keys(this.stage.patients)[0];
      this.patient = this.stage.patients[this.patientId];
    }
    this.pending = (step.lesions || []).map(pl => ({ pl, done: false }));
    this.startTalk(step.talk_before, () => {
      this.phase = 'play';
      this.emit('step_start', null);
      this.spawnPending();
    });
  }

  spawnPending() {
    for (const pd of this.pending) {
      if (pd.done) continue;
      const ap = pd.pl.appear || 'start';
      let ok = ap === 'start';
      if (ap.after_sec !== undefined) ok = this.stepTime >= ap.after_sec;
      if (ap.after !== undefined) ok = [].concat(ap.after).every(id => this.lesions.some(L => L.id === id && L.done));
      if (!ok) continue;
      pd.done = true;
      const pl = pd.pl;
      this.spawn(pl.type, { id: pl.id, pos: pl.pos, points: pl.points, scale: pl.scale, rotate: pl.rotate, overrides: pl.overrides });
    }
  }

  stepCleared() {
    if (this.pending.some(pd => !pd.done) || this.active().length) return false;
    const c = this.step.clear;
    if (!c || c.type === 'all_lesions') return true;
    if (c.type === 'inject') return (this.stepInjected[c.drug] || 0) >= c.amount;
    if (c.type === 'use') return (this.stepUses[c.tool] || 0) >= c.count;
    return true;
  }

  applyFlags(o) {
    for (const f of o?.clear_flags || []) this.flags.delete(f);
    for (const f of o?.set_flags || []) this.flags.add(f);
  }

  finishStep() {
    const step = this.step;
    this.applyFlags(step.on_done);
    this.startTalk(step.talk_after, () => {
      if (step.continue_point && !this.cfg.training) this.saveContinuePoint(step);
      const next = this.findNext(this.stepIdx + 1);
      if (next < 0) this.clear(); else this.enterStep(next);
    });
  }

  saveContinuePoint(step) {
    this.lastCP = { id: step.id, flags: [...this.flags] };
    const all = (Save.data.continuePoints[this.stage.id] ||= {});
    const mine = (all[this.cfg.choiceKey] ||= {});
    mine[step.id] = { name: step.continue_point.name, flags: [...this.flags] };   // 最後に到達したときのフラグで上書き
    Save.write();
    this.se('checkpoint');
  }

  // 治療を止める会話（キャラクター絵つきの会話）。出している間は進行をすべて止める
  startTalk(lines, then, o = {}) {
    const list = (lines || []).filter(l => condOk(l, this.flags));
    if (!list.length) { then(); return; }
    this.releasePointer();
    this.subs = null;                 // 表示中の字幕は打ち切る
    this.phase = 'talk';
    this.talk = new TalkPlayer(this.app, lines, {
      overlay: true, flags: this.flags, skip: Save.data.options.skipTalk, dim: o.dim,
      onEnd: () => { this.talk = null; then(); }
    });
  }

  releasePointer() {
    if (this.pressing) { this.pressing = false; endOp(this, this.lastCell, -1, -1); }
    this.pressTape = false;
    this.loopStop();
  }

  // 字幕のきっかけ
  emit(event, L) {
    for (const s of this.step?.subtitles || []) {
      if (!condOk(s, this.flags)) continue;
      const at = s.at;
      let ok = false;
      if (at === 'start') ok = event === 'step_start';
      else if (L && (at.lesion ? L.id === at.lesion : at.type ? L.type === at.type : false)) {
        if (at.event) ok = at.event === event;
        else if (at.stage !== undefined) ok = (event === 'stage' && L.stage === at.stage) || (event === 'appear' && at.stage === 0);
      }
      if (ok) { this.subs = { lines: s.lines, k: 0, t: 0 }; return; }
    }
  }

  // ---------------- 終わり ----------------
  over(cause) {
    if (this.phase !== 'play') return;
    this.releasePointer();
    this.subs = null;
    this.menu = null;
    Assets.stopBgm();
    if (cause === 'timeout') {
      this.bpm = 0;                                    // 心電図を止める（平坦にはしない）
      this.stopped = true;
      this.overTalk(cause);
    } else {
      this.phase = 'flat';                             // 平坦の波形と「ピー」だけを見せてから会話
      this.flat = true;
      this.flatT = 0;
      this.flatCause = cause;
      this.flatTone = Assets.tone('ecg_flatline');
    }
  }

  overTalk(cause) {
    this.phase = 'ended';
    if (this.cfg.training) {   // トレーニング：会話は出さず、短く表示して病巣選択に戻る
      this.message = { text: 'ゲームオーバー', t: 0, then: () => { this.stopTone(); this.cfg.onGameOver(cause); } };
      return;
    }
    Assets.playBgm('gameover');
    const lines = this.stage.gameover_talks?.[cause] || this.sys.default_gameover_talks[cause];
    this.overTalking = true;
    this.startTalk(lines, () => { this.phase = 'ended'; this.stopTone(); this.cfg.onGameOver(cause); }, { dim: 0.55 });
  }

  stopTone() {
    if (this.flatTone) { this.flatTone.stop(); this.flatTone = null; }
  }

  // 時間切れで終えるステージ（spec/03 2章）
  timeoutEnd() {
    this.releasePointer();
    this.applyFlags(this.stage.on_timeout);
    for (const L of this.active()) {   // ランクを付けるステージでは、治療が終わっていない病巣を0点として数える
      if (!L.unscored && !this.stage.no_rank) this.records.push({ type: L.type, name: L.def.name, score: 0, rating: 'Bad', time: L.age, unfinished: true });
    }
    this.lesions = [];
    this.startTalk(this.step.talk_after, () => this.clear());
  }

  clear() {
    this.phase = 'ended';
    this.loopStop();
    const st = this.stage;
    const effort = (st.goals?.effort || []).map(e => {
      const c = e.condition || {};
      const ok = c.type === 'miss_count_max' ? this.totalMisses <= c.value
        : c.type === 'vital_min' ? this.minVital >= c.value
        : c.type === 'time_left_min' ? (this.timeLeft ?? 0) >= c.value : false;
      return { text: e.text, ok, bonus: e.bonus_points || 0 };
    });
    const max = 100 * (this.records.length + this.skippedMax) + effort.reduce((a, e) => a + e.bonus, 0);
    const got = this.records.reduce((a, r) => a + r.score, 0) + effort.reduce((a, e) => a + (e.ok ? e.bonus : 0), 0);
    const ratio = max > 0 ? got / max : 0;
    const rank = (max === 0 || st.no_rank) ? null : this.sys.ranks.find(r => ratio >= r.min).name;
    this.cfg.onClear({ records: this.records, effort, max, got, ratio, rank, flags: this.flags, treated: [...this.treated], misses: this.totalMisses });
  }

  // ---------------- 更新 ----------------
  update(dt, events) {
    if (this.message) {
      this.message.t += dt;
      if (this.message.t >= 1.5) { const m = this.message; this.message = null; m.then(); }
      return;
    }
    if (this.talk) {
      if (this.overTalking && this.flatTone) {         // 平坦の音は、会話の間に小さくして消す
        this.flatT += dt;
        this.flatTone.set(Math.max(0, 1 - this.flatT / 3));
        if (this.flatT >= 3) this.stopTone();
      }
      this.talk.update(dt, events);
      return;
    }
    if (this.phase === 'flat') {
      this.flatT += dt;
      this.advanceEcg(dt);
      if (this.flatT >= this.sys.gameover_wait_sec) { this.flatT = 0; this.overTalk(this.flatCause); }
      return;
    }
    if (this.phase !== 'play') return;

    this.handleInput(events);
    if (this.menu || this.phase !== 'play') return;      // メニュー中は、ゲーム内の時間に関わるものをすべて止める

    this.clock += dt;
    this.stepTime += dt;
    this.flash = Math.max(0, this.flash - dt);

    // 操作
    this.injecting = null;
    holdOp(this, dt);

    // 麻酔
    if (this.anes > 0) { this.anes -= dt; if (this.anes <= 0) { this.anes = 0; this.resetDecayTimers(); } }

    // 自然減少
    const nd = this.stage.natural_decay;
    if (nd) {
      this.natT += dt;
      const interval = nd.interval_sec / this.coef('decay') * this.anesthesiaStretch();
      while (this.natT >= interval) { this.natT -= interval; this.vitalDown(nd.amount); }
    }

    // 病巣
    this.spawnPending();
    for (const L of [...this.lesions]) {
      L.carried = !!(this.op && this.op.mode === 'carry' && this.op.lesion === L);
      L.update(dt);
    }

    // ヒールゼリーのストック（1つずつ順番に戻る）と、注射のゲージ（薬ごと）
    const I = this.inst;
    if (this.stock < I.healjelly.stock_max) {
      this.stockT += dt;
      const ret = I.healjelly.stock_return_sec / this.coef('recover');
      if (this.stockT >= ret) { this.stockT = 0; this.stock++; }
    } else this.stockT = 0;
    const rate = 100 / (I.injector.gauge_recover_sec / this.coef('recover'));
    for (const d of Object.keys(this.gauges)) {
      if (d !== this.injecting) this.gauges[d] = Math.min(100, this.gauges[d] + rate * dt);
    }

    // 字幕（約5秒ごとに次のセリフへ。最後のセリフは出したまま）
    if (this.subs && this.subs.k < this.subs.lines.length - 1) {
      this.subs.t += dt;
      if (this.subs.t >= this.sys.subtitle_next_sec) { this.subs.t = 0; this.subs.k++; }
    }

    // 演出
    this.tray.t = Math.max(0, Math.min(1, this.tray.t + (this.tray.show ? dt : -dt) * 5));
    this.tapeT = Math.max(0, Math.min(1, this.tapeT + (this.tapeVisible() ? dt : -dt) * 4));
    if (!this.tapeVisible()) this.tapeLifted = false;
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter(p => p.t < 1.4);
    for (const t of this.trails) t.t += dt;
    this.trails = this.trails.filter(t => t.t < 1.2);
    this.advanceEcg(dt);

    // 残り時間
    if (this.timeLeft !== null) this.timeLeft -= dt;
    this.minVital = Math.min(this.minVital, this.vital);

    // 終了条件（同時に成り立ったときは バイタル0 ＞ 限度量の超過 ＞ 時間切れ ＞ クリア）
    if (this.phase !== 'play') return;                   // 限度量の超過は addDose が判定する
    if (this.vital <= 0) { this.vital = 0; this.over('vital'); return; }
    if (this.timeLeft !== null && this.timeLeft <= 0) {
      this.timeLeft = 0;
      if (this.stage.on_timeout?.type === 'end_stage') this.timeoutEnd(); else this.over('timeout');
      return;
    }
    if (this.stepDoneT === null && this.stepCleared()) this.stepDoneT = 0;
    if (this.stepDoneT !== null) {
      this.stepDoneT += dt;
      if (this.stepDoneT >= 0.7) { this.releasePointer(); this.finishStep(); }
    }
  }

  targetBpm() {
    const e = this.sys.ecg;
    if (this.flat || this.stopped) return 0;
    if (this.anes > 0) return e.bpm_anesthesia;
    const v = this.displayVital;
    return v > 50 ? e.bpm_green : v > 25 ? e.bpm_yellow : e.bpm_red;
  }

  advanceEcg(dt) {
    const e = this.sys.ecg, target = this.targetBpm();
    if (this.flat || this.stopped) this.bpm = 0;
    else {
      const rate = 120 / e.transition_sec * dt;           // 数秒かけてテンポを移す
      this.bpm += Math.max(-rate, Math.min(rate, target - this.bpm));
    }
    const before = this.beat;
    this.beat += this.bpm / 60 * dt;
    this.breath += this.bpm / 60 * dt / 4;
    if (Math.floor(this.beat) > Math.floor(before)) this.se('ecg_beep');
    this.waveAcc += dt * 120;
    while (this.waveAcc >= 1) {
      this.waveAcc -= 1;
      const p = this.beat % 1;
      let v = 0;
      if (this.bpm > 0) {
        if (p < 0.04) v = -0.15; else if (p < 0.08) v = 1; else if (p < 0.12) v = -0.3;
        else if (p > 0.25 && p < 0.45) v = 0.22 * Math.sin((p - 0.25) / 0.2 * Math.PI);
      }
      this.wave.push(v); this.wave.shift();
    }
  }

  // ---------------- 入力 ----------------
  get side() { return Save.data.options.side; }
  get colX() { return this.side === 'left' ? 0 : W - COL_W; }
  get blankX() { return this.side === 'left' ? W - COL_W : 0; }
  trayRect() { return { x: this.blankX + 25, y: 380, w: 210, h: 440 }; }
  tapeRect() { return { x: this.blankX + 40, y: 500, w: 180, h: 200 }; }
  iconRect(i) { return { x: this.colX, y: MENU_H + ICON_H * i, w: COL_W, h: ICON_H }; }
  drugRect(k) {
    const x = this.side === 'left' ? COL_W + 10 : W - COL_W - 250;
    return { x, y: MENU_H + ICON_H * 5 + ICON_H - 100 - k * 104, w: 240, h: 96 };
  }
  tapeVisible() {
    return this.active().some(L => L.accepts('taping') >= 0 && !L.blocked());
  }

  selectTool(tool) {
    if (this.tapeLifted) this.tapeLifted = false;       // 持ち替えると、テープの持ち上げを解除する
    if (tool === 'injector') this.drugOpen = this.tool === 'injector' ? !this.drugOpen : true;
    this.tool = tool;
    this.se('select');
  }

  handleInput(events) {
    const hit = (r, e) => e.x >= r.x && e.x <= r.x + r.w && e.y >= r.y && e.y <= r.y + r.h;
    for (const e of events) {
      if (this.phase !== 'play') return;
      if (e.type === 'key') {
        if (this.pressing) continue;                    // 押している間のキー入力は無視
        const n = '123456'.indexOf(e.key);
        if (this.menu) { if (e.key === 'Escape') this.menu = null; continue; }
        if (n >= 0) this.selectTool(this.inst.order[n]);
        else if (e.key === 'Escape') this.openMenu();
        else if (this.app.debug && e.key.toLowerCase() === 'g') this.showGrid = !this.showGrid;
        else if (this.app.debug && e.key.toLowerCase() === 'h') this.showHint = !this.showHint;
        continue;
      }
      if (this.menu) {
        if (e.type === 'down') clickButtons(this.menu, e.x, e.y);
        continue;
      }
      this.pointer = { x: e.x, y: e.y };
      const cell = toCell(e.x, e.y);
      if (e.type === 'down') {
        // 薬ボタン（手術エリアより優先）
        if (this.tool === 'injector' && this.drugOpen) {
          const k = this.drugs.findIndex((d, i) => hit(this.drugRect(i), e));
          if (k >= 0) { this.drug = this.drugs[k]; this.se('select'); continue; }
        }
        if (hit({ x: this.colX, y: 0, w: COL_W, h: MENU_H }, e)) { this.openMenu(); continue; }
        const ti = this.inst.order.findIndex((t, i) => hit(this.iconRect(i), e));
        if (ti >= 0) { this.selectTool(this.inst.order[ti]); continue; }
        if (this.tapeT > 0.5 && hit(this.tapeRect(), e)) {
          if (this.tapeLifted) { this.tapeLifted = false; this.tool = this.prevTool || this.tool; this.se('put'); }   // 置く（戻す）
          else this.pressTape = true;
          continue;
        }
        if (inArea(cell)) {
          this.pressing = true;
          this.lastCell = cell;
          beginOp(this, cell);
        }
      } else if (e.type === 'move') {
        if (this.pressing) { moveOp(this, this.lastCell, cell); this.lastCell = cell; }
      } else if (e.type === 'up') {
        if (this.pressing) {
          this.pressing = false;
          const c = e.cancel ? this.lastCell : cell;
          if (!e.cancel) moveOp(this, this.lastCell, c);
          endOp(this, c, e.x, e.y);
        }
        if (this.pressTape) {                            // 指を離した時点で持ち上げる
          this.pressTape = false;
          this.tapeLifted = true;
          this.prevTool = this.tool;
          this.se(this.inst.special.taping.sounds.lift);
        }
      }
    }
  }

  openMenu() {
    if (this.pressing || this.phase !== 'play') return;   // 手術エリアを押している最中は反応しない
    this.se('select');
    const items = this.cfg.training
      ? [['再開', () => { this.menu = null; }], ['病巣選択に戻る', () => this.cfg.onQuit()]]
      : [['再開', () => { this.menu = null; }], ['リトライ', () => this.cfg.onRetry()], ['タイトルに戻る', () => this.cfg.onQuit()]];
    const bw = 560, bh = 110, y0 = H / 2 - (items.length * (bh + 30)) / 2 + 30;
    this.menu = items.map(([label, fn], k) => new Button((W - bw) / 2, y0 + k * (bh + 30), bw, bh, label, fn));
    this.loopStop();
  }

  // ---------------- 描画 ----------------
  draw(ctx) {
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(0, 0, W, H);
    this.drawArea(ctx);
    this.drawVital(ctx);
    this.drawTime(ctx);
    this.drawBlank(ctx);
    this.drawSubtitle(ctx);
    this.drawColumn(ctx);
    if (this.tool === 'injector' && this.drugOpen) this.drawDrugs(ctx);
    // ピンセットで掴んでいる物は最上位に描く
    if (this.op && this.op.mode === 'carry') drawCarried(ctx, this.op.lesion, this.pointer.x, this.pointer.y);
    if (this.flash > 0) { ctx.fillStyle = `rgba(229,72,77,${this.flash * 1.2})`; ctx.fillRect(0, 0, W, H); }
    if (this.talk) this.talk.draw(ctx);
    if (this.menu) {
      dim(ctx, 0.6);
      panel(ctx, W / 2 - 360, H / 2 - 290, 720, 580);
      text(ctx, '一時停止', W / 2, H / 2 - 225, { size: 44, align: 'center', bold: true });
      this.menu.forEach(b => b.draw(ctx));
    }
    if (this.message) {
      dim(ctx, 0.6);
      text(ctx, this.message.text, W / 2, H / 2, { size: 110, align: 'center', bold: true, color: COLOR.bad, stroke: '#000' });
    }
  }

  drawArea(ctx) {
    const A = AREA;
    ctx.save();
    ctx.beginPath(); ctx.rect(A.x, A.y, A.w, A.h); ctx.clip();
    ctx.fillStyle = '#000'; ctx.fillRect(A.x, A.y, A.w, A.h);
    // 患者（呼吸・拍動で画像を切り替える）
    const imgs = (this.patient?.images || []).filter(n => Assets.img(n));
    const list = imgs.length ? imgs : (this.patient?.fallback_images || []);
    if (list.length) {
      const name = list.length >= 3 ? list[[0, 1, 2, 1][Math.floor(this.breath * 4) % 4]] : list[0];
      const img = Assets.img(name);
      const near2 = img && Math.abs(img.width / img.height - 2) < 0.12;
      drawImage(ctx, name, A.x, A.y, A.w, A.h, near2 ? 'stretch' : 'contain');
    }
    if (this.showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
      for (let x = 0; x <= 100; x += 5) { ctx.beginPath(); ctx.moveTo(A.x + x * 14, A.y); ctx.lineTo(A.x + x * 14, A.y + A.h); ctx.stroke(); }
      for (let y = 0; y <= 50; y += 5) { ctx.beginPath(); ctx.moveTo(A.x, A.y + y * 14); ctx.lineTo(A.x + A.w, A.y + y * 14); ctx.stroke(); }
    }
    const order = [...this.lesions].sort((a, b) => a.serial - b.serial);
    for (const L of order) drawLesion(ctx, L, this);
    for (const t of this.trails) drawTrail(ctx, t.tool, t.pts, 1 - t.t / 1.2);
    if (this.op && this.op.trail) drawTrail(ctx, this.op.tool, this.op.trail, 1);
    // 操作ガイド
    const tool = this.tapeLifted ? 'taping' : this.tool;
    if (Save.data.options.guide && this.phase === 'play' && !this.pressing) {
      for (const L of this.active()) drawGuide(ctx, L, this, tool);
    }
    this.drawOp(ctx);
    if (this.showHint) {
      for (const L of this.active()) {
        const [x, y] = toLogical(L.center());
        const name = L.step.tool === 'taping' ? 'テーピング' : this.inst[L.step.tool].name;
        text(ctx, name + (L.step.optional ? '（省略可）' : ''), x, y + 44, { size: 24, align: 'center', color: '#fff', stroke: '#000', strokeWidth: 5 });
      }
    }
    for (const p of this.popups) {
      const a = Math.min(1, (1.4 - p.t) * 2.5);
      ctx.globalAlpha = a;
      text(ctx, p.label, p.x, p.y - p.t * 50, { size: p.big ? 64 : 44, align: 'center', bold: true, color: RATE_COLOR[p.label] || '#fff', stroke: '#000', strokeWidth: 8 });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.strokeStyle = '#2c3540'; ctx.lineWidth = 2; ctx.strokeRect(A.x, A.y, A.w, A.h);
  }

  // 操作中の機器の範囲（見た目だけ。判定には使わない）
  drawOp(ctx) {
    if (!this.pressing) return;
    const { x, y } = this.pointer, tool = this.tapeLifted ? 'taping' : this.tool;
    ctx.lineWidth = 3;
    if (tool === 'healjelly' && this.op) {
      ctx.beginPath(); ctx.arc(x, y, this.inst.healjelly.brush_radius * 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,220,160,0.3)'; ctx.fill(); ctx.strokeStyle = 'rgba(160,255,200,0.9)'; ctx.stroke();
    } else if (tool === 'drain') {
      ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(200,230,255,0.9)'; ctx.stroke();
    } else if (tool === 'injector' && this.op) {
      ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.strokeStyle = '#7fe0ff'; ctx.stroke();
    } else if (tool === 'taping' && this.op) {
      const [sx, sy] = toLogical(this.op.start);
      ctx.strokeStyle = 'rgba(240,232,208,0.65)'; ctx.lineWidth = this.inst.special.taping.band_width * 14; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x, y); ctx.stroke();
    } else if (tool === 'tweezers' && this.op && this.op.mode === 'connect') {
      const [sx, sy] = toLogical(this.op.from);
      ctx.strokeStyle = '#d0465a'; ctx.lineWidth = 13; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x, y); ctx.stroke();
    } else if (tool === 'needle' && this.op) {
      text(ctx, String(this.op.count), x + 40, y - 40, { size: 40, bold: true, color: '#fff', stroke: '#000' });
    }
  }

  drawVital(ctx) {
    const x = 260, w = 1400, h = 180, v = this.displayVital;
    const color = v > 50 ? COLOR.good : v > 25 ? COLOR.warn : COLOR.bad;
    ctx.fillStyle = '#0e1318'; ctx.fillRect(x, 0, w, h);
    // 心電図（ゲージの後ろに流す）
    ctx.beginPath();
    const n = this.wave.length;
    for (let i = 0; i < n; i++) {
      const px = x + 40 + (w - 80) * i / (n - 1), py = 78 - this.wave[i] * 56;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.strokeStyle = color; ctx.globalAlpha = 0.55; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
    // ゲージ
    const gx = x + 200, gw = w - 260, gy = 118, gh = 36;
    roundRect(ctx, gx, gy, gw, gh, 8); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    roundRect(ctx, gx, gy, Math.max(8, gw * v / 99), gh, 8); ctx.fillStyle = color; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
    roundRect(ctx, gx, gy, gw, gh, 8); ctx.strokeStyle = '#55616e'; ctx.lineWidth = 2; ctx.stroke();
    text(ctx, 'VITAL', x + 40, 96, { size: 24, color: COLOR.dim, bold: true });
    text(ctx, String(v), x + 180, 136, { size: 64, align: 'right', bold: true, color });
    if (this.anes > 0) text(ctx, `麻酔 ${Math.ceil(this.anes)}秒`, x + w - 60, 30, { size: 26, align: 'right', color: '#b9a7ff' });
  }

  drawTime(ctx) {
    const x = this.blankX;
    ctx.fillStyle = '#0e1318'; ctx.fillRect(x, 0, COL_W, MENU_H);
    if (this.timeLeft === null) {
      text(ctx, this.cfg.training ? 'TRAINING' : '時間制限なし', x + COL_W / 2, 90, { size: 32, align: 'center', color: COLOR.dim, bold: true });
      return;
    }
    const t = Math.max(0, Math.ceil(this.timeLeft));
    text(ctx, '残り時間', x + COL_W / 2, 50, { size: 26, align: 'center', color: COLOR.dim });
    text(ctx, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, x + COL_W / 2, 112,
      { size: 68, align: 'center', bold: true, color: t <= 30 ? COLOR.bad : COLOR.text });
  }

  // 空白エリア（トレイとテープは、画面の枠外から出てくる）
  drawBlank(ctx) {
    const x = this.blankX, out = this.side === 'left' ? 1 : -1;
    ctx.fillStyle = '#0a0c0f'; ctx.fillRect(x, MENU_H, COL_W, H - MENU_H);
    if (this.tray.t > 0) {
      const r = this.trayRect(), ox = out * (1 - this.tray.t) * 300;
      roundRect(ctx, r.x + ox, r.y, r.w, r.h, 26); ctx.fillStyle = '#9aa5b1'; ctx.fill();
      roundRect(ctx, r.x + ox + 16, r.y + 16, r.w - 32, r.h - 32, 18); ctx.fillStyle = '#c7d0d9'; ctx.fill();
      text(ctx, 'トレイ', r.x + ox + r.w / 2, r.y + r.h / 2, { size: 30, align: 'center', color: '#5b6672', bold: true });
    }
    if (this.tapeT > 0) {
      const r = this.tapeRect(), ox = out * (1 - this.tapeT) * 300, cx = r.x + ox + r.w / 2, cy = r.y + r.h / 2;
      if (this.tapeLifted) { roundRect(ctx, r.x + ox, r.y, r.w, r.h, 18); ctx.strokeStyle = COLOR.accent; ctx.lineWidth = 5; ctx.stroke(); }
      ctx.globalAlpha = this.tapeLifted ? 0.35 : 1;
      ctx.beginPath(); ctx.arc(cx, cy - 10, 62, 0, Math.PI * 2); ctx.fillStyle = '#efe7cf'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy - 10, 26, 0, Math.PI * 2); ctx.fillStyle = '#0a0c0f'; ctx.fill();
      ctx.globalAlpha = 1;
      text(ctx, this.tapeLifted ? '使用中' : 'テープ', cx, r.y + r.h - 22, { size: 26, align: 'center', color: COLOR.text });
    }
  }

  drawSubtitle(ctx) {
    const x = 260, y = 880, w = 1400, h = 200;
    ctx.fillStyle = '#0e1318'; ctx.fillRect(x, y, w, h);
    if (!this.subs || this.talk) return;
    const ln = this.subs.lines[this.subs.k];
    const ch = this.sys.characters[ln.who];
    let tx = x + 60;
    if (ch && (ch.face || ch.stand)) {   // 顔画像（素材ができるまで、立ち絵の上の部分を使う）
      ctx.save();
      ctx.beginPath(); ctx.arc(x + 110, y + 100, 84, 0, Math.PI * 2); ctx.clip();
      drawImage(ctx, ch.face || ch.stand, x + 26, y + 16, 168, 168, 'cover', 0);
      ctx.restore();
      tx = x + 230;
    }
    if (ln.who) text(ctx, ln.who, tx, y + 36, { size: 26, color: COLOR.accent, bold: true });
    const lines = wrap(ctx, ln.text, x + w - 40 - tx, 38);
    lines.slice(0, 3).forEach((l, k) => text(ctx, l, tx, y + 84 + k * 50, { size: 38 }));
  }

  highlights() {
    const strong = new Set(), weak = new Set(), drugs = new Set();
    for (const L of this.active()) {
      if (L.blocked()) continue;
      const st = L.step;
      if (st.tool === 'taping') continue;
      strong.add(st.tool);
      if (st.drug) drugs.add(st.drug);
      if (st.optional) {
        const nx = L.steps[L.stage + 1];
        if (nx && nx.tool !== 'taping') weak.add(nx.tool);
      }
    }
    const c = this.step?.clear;
    if (c && c.type === 'inject' && (this.stepInjected[c.drug] || 0) < c.amount) { strong.add('injector'); drugs.add(c.drug); }
    if (c && c.type === 'use') strong.add(c.tool);
    return { strong, weak, drugs };
  }

  drawColumn(ctx) {
    const x = this.colX, I = this.inst;
    ctx.fillStyle = '#07090b'; ctx.fillRect(x, 0, COL_W, H);
    // Menu
    roundRect(ctx, x + 14, 14, COL_W - 28, MENU_H - 28, 14); ctx.fillStyle = '#161b22'; ctx.fill();
    ctx.strokeStyle = COLOR.buttonLine; ctx.lineWidth = 3; ctx.stroke();
    text(ctx, 'MENU', x + COL_W / 2, MENU_H / 2, { size: 40, align: 'center', bold: true });
    const hl = this.phase === 'play' ? this.highlights() : { strong: new Set(), weak: new Set(), drugs: new Set() };
    const ph = this.clock % 2.5, blink = ph < 1 || (ph >= 1.5 && ph < 2);   // 1秒表示 → 0.5秒非表示 → 0.5秒表示 → 0.5秒非表示
    I.order.forEach((key, i) => {
      const r = this.iconRect(i), sel = this.tool === key && !this.tapeLifted;
      roundRect(ctx, r.x + 10, r.y + 6, r.w - 20, r.h - 12, 14);
      ctx.fillStyle = sel ? '#243446' : '#11161c'; ctx.fill();
      if (blink && (hl.strong.has(key) || hl.weak.has(key))) {
        ctx.fillStyle = hl.strong.has(key) ? 'rgba(255,210,63,0.5)' : 'rgba(255,240,180,0.2)'; ctx.fill();
      }
      // 残りが減るほど赤くする（ヒールゼリーはストック、注射は限度量）
      const red = key === 'healjelly' ? 1 - this.stock / I.healjelly.stock_max : key === 'injector' ? this.doseRatio(this.drug) : 0;
      if (red > 0) { ctx.fillStyle = `rgba(229,72,77,${red * 0.55})`; ctx.fill(); }
      ctx.strokeStyle = sel ? '#ffffff' : '#2f3945'; ctx.lineWidth = sel ? 5 : 2; ctx.stroke();
      drawImage(ctx, I[key].icon, r.x + 30, r.y + 16, 110, 110, 'contain');
      text(ctx, String(i + 1), r.x + 26, r.y + 28, { size: 22, color: COLOR.dim });
      text(ctx, I[key].name, r.x + r.w - 22, r.y + r.h - 28, { size: 22, align: 'right', color: sel ? '#fff' : COLOR.dim });
      if (key === 'healjelly') {
        // ストック：小さな瓶を5つ。戻り待ちの1つが下から満ちていく
        for (let k = 0; k < I.healjelly.stock_max; k++) {
          const bx = r.x + 152 + (k % 3) * 30, by = r.y + 22 + Math.floor(k / 3) * 46, bw = 22, bh = 36;
          ctx.fillStyle = '#0a0c0f'; ctx.fillRect(bx, by, bw, bh);
          const fill = k < this.stock ? 1 : k === this.stock ? this.stockT / (I.healjelly.stock_return_sec / this.coef('recover')) : 0;
          ctx.fillStyle = k < this.stock ? '#6fe0a0' : '#3d7a5a';
          ctx.fillRect(bx, by + bh * (1 - fill), bw, bh * fill);
          ctx.strokeStyle = '#8fa0b0'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
        }
      }
      if (key === 'injector') this.drawGauge(ctx, r.x + 168, r.y + 20, 26, 84, this.drug);
    });
  }

  drawGauge(ctx, x, y, w, h, drug) {
    const D = this.inst.injector.drugs[drug], v = this.gauges[drug] / 100;
    ctx.fillStyle = '#0a0c0f'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = D.color || '#7fe0ff'; ctx.fillRect(x, y + h * (1 - v), w, h * v);
    ctx.strokeStyle = '#8fa0b0'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  }

  drawDrugs(ctx) {
    const hl = this.highlights(), ph = this.clock % 2.5, blink = ph < 1 || (ph >= 1.5 && ph < 2);
    this.drugs.forEach((d, k) => {
      const r = this.drugRect(k), D = this.inst.injector.drugs[d], sel = this.drug === d;
      roundRect(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.fillStyle = sel ? '#243446' : '#11161c'; ctx.fill();
      if (blink && hl.drugs.has(d)) { ctx.fillStyle = 'rgba(255,210,63,0.5)'; ctx.fill(); }
      const red = this.doseRatio(d);
      if (red > 0) { ctx.fillStyle = `rgba(229,72,77,${red * 0.55})`; ctx.fill(); }
      ctx.strokeStyle = sel ? '#ffffff' : '#3a4553'; ctx.lineWidth = sel ? 5 : 2; ctx.stroke();
      ctx.fillStyle = D.color || '#7fe0ff'; ctx.beginPath(); ctx.arc(r.x + 34, r.y + r.h / 2, 12, 0, Math.PI * 2); ctx.fill();
      text(ctx, D.name, r.x + 60, r.y + r.h / 2, { size: 30, color: '#fff' });
      this.drawGauge(ctx, r.x + r.w - 32, r.y + 10, 18, r.h - 20, d);
    });
  }
}
