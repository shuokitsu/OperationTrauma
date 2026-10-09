// ゲーム画面（spec/02 3.4、03、05）
import { W, H, text, roundRect, Button, clamp } from './core.js';
import { AREA, toCell, toLogical, inArea, dist, distSeg, distPolyline, polylineCross, shapeCells } from './geometry.js';
import { Lesion, rankOf } from './lesion.js';
import { Ecg } from './ecg.js';
import { TalkBox } from './talk.js';
import { drawLesion, drawShard } from './draw_lesion.js';

const COL_W = 260, MENU_H = 180, ICON_H = 150;
const TRAY = { w: 220, h: 300 };
const TAPE = { w: 200, h: 120 };

export class Surgery {
  // ctx：{ stage, difficulty, flags, startStep, training:{ types:[...], mode } }
  constructor(app, ctx) {
    this.app = app;
    this.data = app.data;
    this.ins = app.data.instruments;
    this.ctx = ctx;
    this.stage = ctx.stage;
    this.training = ctx.training || null;
    this.diff = ctx.difficulty;
    this.flags = ctx.flags;            // この回のフラグ（ゲーム前の選択を含む）
    this.side = app.save.options.side;
    this.colX = this.side === 'left' ? 0 : W - COL_W;
    this.oppX = this.side === 'left' ? W - COL_W : 0;
    this.ecg = new Ecg(app.sound, app.data.system.ecg);
    this.resetState(ctx.startStep || 0);
    app.sound.bgm('surgery');
  }
  coef(key) {
    const s = (this.stage.coefficients || {})[key] ?? 1;
    const d = (this.diff.coef || {})[key] ?? 1;
    return s * d;
  }
  resetState(startStep) {
    this.time = 0;                                     // ゲーム内の経過時間
    this.timeLimit = this.training ? null : this.stage.time_limit_sec * this.coef('time_limit');
    this.remain = this.timeLimit;
    this.vital = Math.min(99, this.stage.start_vital * this.coef('start_vital'));
    this.decayAcc = 0;
    this.anesthesia = 0;
    this.stock = this.ins.healjelly.stock_max; this.stockAcc = 0;
    this.gauge = 100;
    this.dose = {};                                    // dose[患者][薬]
    this.selected = 'healjelly';
    this.drug = this.ins.injector.initial_drug;
    this.drugMenu = false;
    this.lesions = [];
    this.history = [];                                 // 出た病巣（リザルト用）
    this.preCount = 0;                                 // コンティニューポイントより前の病巣の数（0点で最大点に数える）
    this.op = null;
    this.trails = []; this.popups = []; this.subs = []; this.subCur = null;
    this.tray = { show: false, anim: 0 };
    this.tape = { show: false, anim: 0, lifted: false };
    this.menu = null;
    this.overlay = null;
    this.end = null;
    this.flashAcc = 0;
    this.misses = 0;
    this.startStep = startStep;
    this.ecg.reset(this.vital);
    // コンティニューポイントより前の病巣は、0点として最大点に数える（spec/03 5章）
    if (!this.training) for (let i = 0; i < startStep; i++) this.preCount += this.placementsOf(this.stage.steps[i]).filter(p => !this.data.lesions[p.lesion].unscored).length;
    this.stepIndex = -1;
    this.enterStep(startStep, true);
  }
  // 処置内容の分岐：フラグで処置データを選ぶ（試作の仮の書き方。TBD-07-5）
  treatmentOf(step) {
    const t = step.treatment;
    if (!Array.isArray(t)) return t || { placements: [] };
    for (const v of t) {
      if (!v.when) return v;
      if (Object.entries(v.when).every(([k, val]) => this.flags[k] === val)) return v;
    }
    return t[t.length - 1];
  }
  placementsOf(step) { return this.treatmentOf(step).placements || []; }

  enterStep(i, first = false) {
    this.stepIndex = i;
    if (this.training) { this.enterTrainingStep(); return; }
    const step = this.stage.steps[i];
    this.step = step;
    this.patientId = step.patient;
    this.patient = this.data.stages.patients[step.patient];
    this.lesions = [];
    this.pending = this.placementsOf(step).map(p => ({ ...p }));
    this.stepTime = 0;
    this.stepInject = {};
    this.subs = []; this.subCur = null;
    this.spoken = new Set();
    // 途中のステップの治療前の会話は、ゲーム画面に重ねて出す（止める会話。spec/02 3.4）
    if (step.dialogue_before && !(first && i === 0)) this.startOverlayTalk(step.dialogue_before, 'stop', () => this.beginStep());
    else this.beginStep();
  }
  beginStep() {
    const t = this.treatmentOf(this.step || {});
    this.during = (t.dialogue_during || []).slice();
    this.trigger('step_start');
    this.spawnPending();
  }
  enterTrainingStep() {
    const tr = this.training;
    this.step = { id: 'training' };
    this.patientId = this.stage.patient;
    this.patient = this.data.stages.patients[this.stage.patient];
    this.lesions = [];
    const typeId = tr.queue[tr.index];
    const type = this.data.lesions[typeId];
    const tmp = new Lesion(typeId, type, { position: [0, 0] }, 0);
    let pos;
    if (tr.mode === 'pick') pos = [Math.round(49.5 - tmp.bounds.cx), Math.round(24.5 - tmp.bounds.cy)];   // 形の外枠の中心を中央に（H17 の推奨案）
    else {
      const b = tmp.bounds;
      const x0 = Math.ceil(-b.x0) + 2, x1 = Math.floor(99 - b.x1) - 2, y0 = Math.ceil(-b.y0) + 2, y1 = Math.floor(49 - b.y1) - 2;
      pos = [x0 + Math.floor(Math.random() * Math.max(1, x1 - x0)), y0 + Math.floor(Math.random() * Math.max(1, y1 - y0))];
    }
    this.pending = [{ id: 'T' + tr.index, lesion: typeId, position: pos, appear: { type: 'start' } }];
    this.during = [];
    this.stepTime = 0; this.stepInject = {};
    this.spawnPending();
  }
  spawnPending() {
    const keep = [];
    for (const p of this.pending) {
      const a = p.appear || { type: 'start' };
      let ok = a.type === 'start' || (a.type === 'after_sec' && this.stepTime >= a.value);
      if (a.type === 'after_done') { const l = this.lesions.find(l => l.id === a.value); ok = !!(l && l.done); }
      if (ok) this.spawn(p); else keep.push(p);
    }
    this.pending = keep;
  }
  spawn(p, generated = false) {
    const type = this.data.lesions[p.lesion];
    const l = new Lesion(p.lesion, type, p, this.time);
    l.generated = generated || !!type.generated;
    l.counted = !l.generated && !type.unscored;
    this.lesions.push(l);
    if (l.counted) this.history.push(l);
    if (!generated) this.app.sound.se('lesion_appear', { vol: 0.6 });
    this.trigger('lesion_appear', l.id);
    return l;
  }
  // 字幕（処置中の会話）
  trigger(type, value) {
    for (const d of this.during) {
      if (d._done) continue;
      if (d.at.type === type && (d.at.value === undefined || d.at.value === value)) { d._done = true; this.subs.push(d); }
    }
  }
  startOverlayTalk(id, kind, onDone) {
    const talk = this.data.talks[id];
    // 指を押していたら「離した」扱いにして会話を出す（spec/02 3.4）
    if (this.op) this.release(this.app.input.pos, true);
    this.app.input.forceRelease();
    this.subs = []; this.subCur = null;   // 表示中の字幕は打ち切る
    const skip = this.app.save.options.skipTalk;
    this.overlay = { kind, box: new TalkBox(this.app, talk, { overlay: true, skip, flags: this.flags, onDone: () => { this.overlay = null; onDone && onDone(); } }) };
  }

  // ---------------- 更新 ----------------
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    if (this.menu) { this.updateMenu(input); return; }
    if (this.overlay) { this.overlay.box.update(dt, input); return; }
    if (this.end) { this.updateEnd(dt, input); return; }
    this.handleKeys(input.keys);
    this.time += dt; this.stepTime += dt;
    if (this.remain !== null) this.remain = Math.max(0, this.remain - dt);
    for (const e of input.ev) this.handleEvent(e);
    if (this.menu || this.overlay) return;
    this.continuous(dt);
    this.decay(dt);
    this.recover(dt);
    for (const l of this.lesions) if (l.isPool && !l.done) this.growPool(l, dt);
    this.spawnPending();
    this.updateSubs(dt);
    this.ecg.update(dt, Math.ceil(this.vital), this.anesthesia > 0);
    this.trails = this.trails.filter(t => (t.t += dt) < 1.8 || t.keep);
    this.popups = this.popups.filter(p => (p.t += dt) < 1.6);
    this.tray.anim = clamp(this.tray.anim + (this.tray.show ? dt : -dt) * 5, 0, 1);
    this.tape.show = this.tapeNeeded();
    if (!this.tape.show) this.tape.lifted = false;
    this.tape.anim = clamp(this.tape.anim + (this.tape.show ? dt : -dt) * 4, 0, 1);
    this.flashAcc += dt;
    this.checkEnd();
  }
  handleKeys(keys) {
    for (const k of keys) {
      if (k === 'Escape') { if (!this.op) this.openMenu(); continue; }
      if (k === 'h' || k === 'H') this.app.debugNames = !this.app.debugNames;
      if (k === 'g' || k === 'G') this.app.debugGrid = !this.app.debugGrid;
      const n = '123456'.indexOf(k);
      if (n >= 0 && !this.app.input.down) {          // 押している間のキー入力は無視（spec/05 2.5）
        const id = this.ins.order[n];
        if (id === 'injector' && this.selected === 'injector') this.drugMenu = !this.drugMenu;
        else this.select(id, true);
      }
    }
  }
  select(id, fromKey = false) {
    if (this.selected !== id) this.app.sound.se('select', { vol: 0.6 });
    this.selected = id;
    this.tape.lifted = false;                         // 持ち替えで持ち上げを解除（P64）
    this.drugMenu = id === 'injector';
  }
  // ---------------- 入力 ----------------
  handleEvent(e) {
    const p = { x: e.x, y: e.y };
    if (e.type === 'down') {
      // 薬ボタン（手術エリアより優先）
      if (this.drugMenu) {
        const b = this.drugButtons().find(b => b.hit(p));
        if (b) { this.drug = b.id; this.app.sound.se('select', { vol: 0.6 }); this.op = { type: 'ui' }; return; }
      }
      // メニューボタン
      if (p.x >= this.colX && p.x < this.colX + COL_W && p.y < MENU_H) { this.openMenu(); this.op = { type: 'ui' }; return; }
      // 医療機器の列
      if (p.x >= this.colX && p.x < this.colX + COL_W && p.y >= MENU_H) {
        const n = Math.floor((p.y - MENU_H) / ICON_H);
        const id = this.ins.order[n];
        if (id) { if (id === 'injector' && this.selected === 'injector') this.drugMenu = !this.drugMenu; else this.select(id); }
        this.op = { type: 'ui' }; return;
      }
      // テープ（空白エリア）
      if (this.tape.show && this.inTape(p)) {
        if (this.tape.lifted) { this.tape.lifted = false; this.app.sound.se('cancel', { vol: 0.6 }); this.op = { type: 'ui' }; }   // 出現位置をもう一度押すと置く
        else this.op = { type: 'tapepress' };
        return;
      }
      const c = toCell(p);
      if (!inArea(c)) { this.op = { type: 'none' }; return; }
      if (this.tape.lifted) { this.op = { type: 'tapeswipe', start: c, last: c }; this.trailStart(c, '#f2e7c9', 7 * AREA.cell, 0.35); return; }
      this.press(c);
    } else if (e.type === 'move') {
      if (!this.op) return;
      if (this.op.type === 'grab') { this.op.pos = p; return; }
      const c = toCell(p);
      this.drag(c, p);
    } else if (e.type === 'up') {
      if (!this.op) return;
      this.release(p, e.cancel);
    }
  }
  trailStart(c, color, width = 6, alpha = 0.9) {
    const t = { pts: [c], color, width, alpha, t: 0, keep: true };
    this.trails.push(t);
    if (this.op) this.op.trail = t;
    return t;
  }
  // 押した位置の病巣を選ぶ（spec/05 2.1 の重なりの決まり）
  candidates(c, extraFor = null) {
    const list = [];
    for (const l of this.lesions) {
      if (l.done) continue;
      let hit = l.contains(c);
      if (!hit && extraFor && l.path) hit = distPolyline(c, l.path) <= extraFor;
      if (hit) list.push(l);
    }
    return list;
  }
  isBlocked(l) {
    if (l.isPool) return false;
    for (const p of this.lesions) if (p.isPool && !p.done && l.overlapsPool(p)) return true;
    return false;
  }
  // 今の段階が instrument か（省略できる段階の次の段階を含む）
  stepFor(l, instrument) {
    const s = l.step;
    if (!s) return null;
    if (s.instrument === instrument) return { skip: false };
    if (s.optional && l.nextStep && l.nextStep.instrument === instrument) return { skip: true };
    return null;
  }
  pick(c, instrument, extra = null) {
    const cands = this.candidates(c, extra);
    if (!cands.length) return { kind: 'miss' };
    // 血溜まり・膿そのもの、または重なっている病巣：ドレーン以外は無効
    if (instrument !== 'drain' && cands.some(l => l.isPool || this.isBlocked(l))) return { kind: 'blocked' };
    const ok = cands.filter(l => this.stepFor(l, instrument));
    if (ok.length) return { kind: 'target', lesion: ok[ok.length - 1], skip: this.stepFor(ok[ok.length - 1], instrument).skip };
    return { kind: 'wrong', lesion: cands[cands.length - 1] };
  }
  press(c) {
    const id = this.selected, I = this.ins[id];
    if (id === 'healjelly') {
      if (this.stock < 1) { this.snd(I, 'invalid'); this.op = { type: 'none' }; return; }   // ストック0：無効（塗っている間の回復も無し）
      this.stock -= 1;
      this.op = { type: 'gel', cells: new Set(), last: c, healed: 0, timer: 0, snd: this.app.sound.se('gel', { loop: true, vol: 0.5 }) };
      this.trailStart(c, 'rgba(120,220,255,0.9)', I.brush_radius * 2 * AREA.cell, 0.28);
      this.paint(c, c);
      this.gelHeal();
      return;
    }
    if (id === 'drain') {
      this.op = { type: 'drain', pos: c, snd: this.app.sound.se('drain', { loop: true, vol: 0.4 }), invalidPlayed: false };
      this.drainTouch(c);
      return;
    }
    if (id === 'tweezers') {
      const r = this.pick(c, 'tweezers');
      if (r.kind === 'target') {
        const l = r.lesion;
        this.op = { type: 'grab', lesion: l, pos: toLogical(c), from: toLogical(c) };
        if (l.step.dest === 'tray') this.tray.show = true;
        this.snd(I, 'grab');
      } else if (r.kind === 'blocked' || r.kind === 'wrong') { this.snd(I, 'invalid'); this.op = { type: 'none' }; }
      else this.op = { type: 'none' };
      return;
    }
    if (id === 'scalpel') { this.pressScalpel(c); return; }
    if (id === 'needle') { this.pressNeedle(c); return; }
    if (id === 'injector') { this.pressInjector(c); return; }
  }
  drag(c, p) {
    const op = this.op;
    if (op.trail) op.trail.pts.push(c);
    if (op.type === 'gel') { this.paint(op.last, c); op.last = c; }
    else if (op.type === 'drain') { op.pos = c; this.drainTouch(c); }
    else if (op.type === 'cut') this.dragScalpel(c);
    else if (op.type === 'cutmiss') this.dragCutMiss(c);
    else if (op.type === 'stitch') this.dragNeedle(c);
    else if (op.type === 'tapeswipe') op.last = c;
    else if (op.type === 'inject') { /* 判定の位置は最初に押した位置で固定（P44） */ }
  }
  release(p, cancel) {
    const op = this.op; this.op = null;
    if (!op) return;
    if (op.trail) op.trail.keep = false;
    if (op.snd) op.snd.stop();
    switch (op.type) {
      case 'gel': this.releaseGel(op); break;
      case 'drain': for (const l of this.lesions) if (l.isPool) { l.grabRadius = null; l.refreshCells(); } break;
      case 'grab': this.releaseGrab(op, p); break;
      case 'cut': this.app.sound.se('invalid', { vol: 0.5 }); break;               // すべての通過点を通る前に離した：無効
      case 'cutmiss': this.releaseCutMiss(op); break;
      case 'stitch': this.releaseNeedle(op); break;
      case 'tapepress': if (!cancel) { this.tape.lifted = true; this.app.sound.se('tape_lift'); } break;
      case 'tapeswipe': this.releaseTape(op); break;
    }
  }
  // ---------------- 押している間の処理 ----------------
  continuous(dt) {
    const op = this.op;
    if (!op) return;
    if (op.type === 'gel') {
      op.timer += dt;
      while (op.timer >= this.ins.healjelly.paint_heal.every_sec) { op.timer -= this.ins.healjelly.paint_heal.every_sec; this.gelHeal(); }
    }
    if (op.type === 'drain') this.suck(dt);
    if (op.type === 'inject') this.inject(dt);
  }
  // ---------------- ヒールゼリー（spec/05 3.1） ----------------
  gelHeal() {
    const ph = this.ins.healjelly.paint_heal, k = this.coef('heal');
    const cap = ph.cap * k;
    const add = Math.min(ph.step * k, cap - this.op.healed);
    if (add > 0) { this.op.healed += add; this.heal(add); }
  }
  paint(a, b) {
    const r = this.ins.healjelly.brush_radius;
    const x0 = Math.floor(Math.min(a.x, b.x) - r), x1 = Math.ceil(Math.max(a.x, b.x) + r);
    const y0 = Math.floor(Math.min(a.y, b.y) - r), y1 = Math.ceil(Math.max(a.y, b.y) + r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (distSeg({ x, y }, a, b) <= r) this.op.cells.add(x + ',' + y);
  }
  releaseGel(op) {
    const I = this.ins.healjelly;
    let any = false, invalid = false;
    for (const l of this.lesions.slice()) {
      if (l.done || !l.cells.length) continue;
      let n = 0;
      for (const c of l.cells) if (op.cells.has(c.x + ',' + c.y)) n++;
      if (!n) continue;
      const ratio = n / l.cells.length;
      const sf = this.stepFor(l, 'healjelly');
      if (!sf || sf.skip || this.isBlocked(l) || l.isPool) { invalid = true; continue; }   // 手順違い・血溜まりの重なり：無効
      const th = l.step.cover_threshold ?? I.cover_threshold;
      if (ratio + 1e-9 < th) { invalid = true; continue; }
      l.penalty += Math.round((1 - ratio) * 100 * (l.type.cover_penalty_scale ?? 1));   // 覆いきらなかった分の減点
      this.succeed(l, l.step.heal ?? I.default_success_heal);
      any = true;
    }
    if (!any && invalid) this.snd(I, 'invalid');
  }
  // ---------------- ドレーン（spec/05 3.2） ----------------
  drainTouch(c) {
    for (const l of this.lesions) {
      if (!l.isPool || l.done) continue;
      if (l.grabRadius == null && dist(c, l.origin) <= l.radius) l.grabRadius = l.radius;   // 最初に触れた時点の範囲（P62）
    }
  }
  suck(dt) {
    const op = this.op, c = op.pos;
    let sucking = false;
    for (const l of this.lesions) {
      if (!l.isPool || l.done) continue;
      if (l.grabRadius != null && dist(c, l.origin) <= l.grabRadius) {
        sucking = true;
        l.amount -= this.ins.drain.suck_per_sec * dt;
        if (l.amount <= 0) { l.amount = 0; l.grabRadius = null; this.succeed(l, l.step.heal ?? 0); }
        else if ((l._r = (l._r || 0) + dt) > 0.2) { l._r = 0; l.refreshCells(); }
      }
    }
    if (!sucking && !op.invalidPlayed) {
      const on = this.lesions.find(l => !l.done && !l.isPool && l.contains(c));
      if (on) { op.invalidPlayed = true; this.snd(this.ins.drain, 'invalid'); }   // 吸う物が無い病巣の上：無効
    }
  }
  growPool(l, dt) {
    const p = l.type.pool;
    if (l.amount < p.max) {
      l.amount = Math.min(p.max, l.amount + p.grow_per_sec * dt);
      if ((l._g = (l._g || 0) + dt) > 0.5) { l._g = 0; if (l.grabRadius == null) l.refreshCells(); }
    }
  }
  // ---------------- ピンセット（spec/05 3.3） ----------------
  trayRect() {
    const x = this.oppX + (COL_W - TRAY.w) / 2;
    const slide = (1 - this.tray.anim) * (this.side === 'left' ? 1 : -1) * (COL_W + 40);
    return { x: x + slide, y: 400, w: TRAY.w, h: TRAY.h };
  }
  releaseGrab(op, p) {
    const l = op.lesion, s = l.step, I = this.ins.tweezers;
    let ok = false;
    if (s.dest === 'tray') {
      const r = this.trayRect();
      ok = p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
    } else if (s.dest && s.dest.position) {
      const d = { x: l.origin.x + s.dest.position[0], y: l.origin.y + s.dest.position[1] };
      ok = dist(toCell(p), d) <= (s.dest.radius ?? I.dest_radius);
    }
    this.tray.show = false;
    if (ok) { this.snd(I, 'put'); this.succeed(l, s.heal); }
    else this.fail(l, s.fail_damage ?? I.default_fail_damage, I);   // 物は元の位置に戻る
  }
  // ---------------- メス（spec/05 3.4） ----------------
  pressScalpel(c) {
    const I = this.ins.scalpel;
    const r = this.pick(c, 'scalpel', I.tolerance);
    if (r.kind === 'blocked') { this.snd(I, 'invalid'); this.op = { type: 'none' }; return; }
    if (r.kind === 'wrong') { this.fail(r.lesion, I.default_fail_damage, I, true); this.op = { type: 'none' }; return; }   // 手順違い：失敗（既定値）
    if (r.kind === 'miss') { this.op = { type: 'cutmiss', pts: [c], len: 0, hit: false }; this.trailStart(c, 'rgba(255,90,90,0.9)', 4); return; }
    const l = r.lesion, path = l.path;
    if (!path) { this.op = { type: 'none' }; return; }
    const op = { type: 'cut', lesion: l, skip: r.skip, passed: new Set(), last: c, closed: !!l.type.path_closed };
    if (!op.closed) {
      const d0 = dist(c, path[0]), d1 = dist(c, path[path.length - 1]);
      if (Math.min(d0, d1) > I.pass_radius) { this.fail(l, this.failDamage(l, I, r.skip), I); this.op = { type: 'none' }; return; }   // 端以外から切り始めた
      op.order = d0 <= d1 ? path.map((_, i) => i) : path.map((_, i) => path.length - 1 - i);
      op.passed.add(op.order[0]); op.k = 1; op.prev = path[op.order[0]];
    } else {
      // 円形：どの通過点からでも、線の途中からでもよい。向きは次に通った点で決まる
      const n = path.length;
      let near = -1;
      for (let i = 0; i < n; i++) if (dist(c, path[i]) <= I.pass_radius) { near = i; break; }
      if (near >= 0) { op.start = near; op.passed.add(near); op.startPos = path[near]; op.cand = [(near + 1) % n, (near - 1 + n) % n]; op.prev = path[near]; }
      else {
        let best = 0, bd = Infinity;
        for (let i = 0; i < n; i++) { const d = distSeg(c, path[i], path[(i + 1) % n]); if (d < bd) { bd = d; best = i; } }
        op.start = null; op.startPos = c; op.cand = [best, (best + 1) % n]; op.prev = c;
      }
      op.dir = 0;
    }
    this.op = op;
    this.trailStart(c, 'rgba(255,60,60,0.95)', 5);
    this.app.sound.se('cut', { vol: 0.5 });
  }
  failDamage(l, I, wrong) { return wrong ? I.default_fail_damage : (l.step && l.step.instrument === 'scalpel' ? l.step.fail_damage : l.nextStep && l.nextStep.fail_damage) ?? I.default_fail_damage; }
  dragScalpel(c) {
    const op = this.op, I = this.ins.scalpel, l = op.lesion, path = l.path;
    const a = op.last; op.last = c;
    const steps = Math.max(1, Math.ceil(dist(a, c) / 0.4));
    for (let s = 1; s <= steps; s++) {
      const q = { x: a.x + (c.x - a.x) * s / steps, y: a.y + (c.y - a.y) * s / steps };
      if (!this.cutStep(q)) return;
    }
  }
  // 1点ずつ調べる。false を返したら操作は終わり
  cutStep(q) {
    const op = this.op, I = this.ins.scalpel, l = op.lesion, path = l.path, n = path.length;
    const failNow = () => { this.op = null; if (op.trail) op.trail.keep = false; this.fail(l, this.failDamage(l, I, false), I); return false; };
    if (!op.closed) {
      const target = op.order[op.k];
      if (distSeg(q, op.prev, path[target]) > I.tolerance) return failNow();         // 猶予幅を外れた
      for (let j = op.k + 1; j < n; j++) if (dist(q, path[op.order[j]]) <= I.pass_radius) return failNow();   // 飛ばした
      if (dist(q, path[target]) <= I.pass_radius) {
        op.passed.add(target); op.prev = path[target]; op.k++;
        if (op.k >= n) { this.op = null; if (op.trail) op.trail.keep = false; this.cutSuccess(l, op); return false; }
      }
      return true;
    }
    // 円形
    if (!op.dir) {
      const dmin = Math.min(...op.cand.map(t => distSeg(q, op.prev, path[t])));
      if (dmin > I.tolerance) return failNow();
      for (let i = 0; i < n; i++) if (!op.cand.includes(i) && i !== op.start && dist(q, path[i]) <= I.pass_radius) return failNow();
      for (const t of op.cand) if (dist(q, path[t]) <= I.pass_radius) {
        // 向きが決まる
        if (op.start !== null) op.dir = t === (op.start + 1) % n ? 1 : -1;
        else op.dir = t === op.cand[1] ? 1 : -1;
        op.passed.add(t); op.cur = t; op.prev = path[t];
        return true;
      }
      return true;
    }
    const next = (op.cur + op.dir + n) % n;
    const allPassed = op.passed.size >= n;
    const goal = allPassed ? op.startPos : path[next];
    if (distSeg(q, op.prev, goal) > I.tolerance) return failNow();
    if (!allPassed) {
      for (let i = 0; i < n; i++) if (i !== next && !op.passed.has(i) && dist(q, path[i]) <= I.pass_radius) return failNow();
      if (dist(q, path[next]) <= I.pass_radius) { op.passed.add(next); op.cur = next; op.prev = path[next]; }
    } else if (dist(q, op.startPos) <= I.pass_radius) {
      this.op = null; if (op.trail) op.trail.keep = false; this.cutSuccess(l, op); return false;
    }
    return true;
  }
  cutSuccess(l, op) {
    l.marks.push({ kind: 'cut', pts: op.trail ? op.trail.pts.slice() : [] });
    if (op.skip) this.skipStep(l);
    this.succeed(l, l.step.heal ?? 0);
  }
  dragCutMiss(c) {
    const op = this.op, I = this.ins.scalpel;
    const last = op.pts[op.pts.length - 1];
    op.len += dist(last, c); op.pts.push(c);
    if (!op.hit && op.len >= I.min_cut_length) {        // 「切った」とみなす長さに達した時点で、ダメージ（spec/05 2.1）
      op.hit = true;
      this.damage(I.miss_damage);
      this.snd(I, 'miss');
    }
  }
  releaseCutMiss(op) {
    if (!op.hit) return;
    // 切った場所に小さな切り傷（間引いた折れ線、長さの上限 10マス、手術エリアの外は切り捨て。spec/06 3.6）
    const pts = [];
    let len = 0;
    for (const q of op.pts) {
      if (!inArea(q)) continue;
      const last = pts[pts.length - 1];
      if (last) { const d = dist(last, q); if (d < 1.5) continue; if (len + d > 10) break; len += d; }
      pts.push({ x: q.x, y: q.y });
    }
    if (pts.length < 2) return;
    const shapes = [{ type: 'line', points: pts, width: 1 }];
    this.spawn({ id: 'cut' + Math.floor(this.time * 1000), lesion: this.ins.scalpel.miss_spawn, position: [0, 0], shapes }, true);
  }
  // ---------------- 縫合針（spec/05 3.5） ----------------
  pressNeedle(c) {
    const I = this.ins.needle;
    const cands = this.candidates(c, I.tolerance);
    if (cands.some(l => l.isPool || this.isBlocked(l))) { this.snd(I, 'invalid'); this.op = { type: 'none' }; return; }
    const sew = cands.filter(l => this.stepFor(l, 'needle') && l.path && distPolyline(c, l.path) <= I.tolerance);
    if (!sew.length) { this.damage(I.miss_damage); this.snd(I, 'miss'); this.op = { type: 'none' }; return; }   // 空振り：押した瞬間にダメージ
    sew.sort((a, b) => distPolyline(c, a.path) - distPolyline(c, b.path));   // 押した位置に最も近い線
    const l = sew[0];
    const leave = I.tolerance * I.recross_ratio;
    this.op = { type: 'stitch', lesion: l, skip: this.stepFor(l, 'needle').skip, count: 0, last: c, armed: distPolyline(c, l.path) > leave };
    this.trailStart(c, 'rgba(40,40,40,0.95)', 4);
  }
  dragNeedle(c) {
    const op = this.op, I = this.ins.needle, l = op.lesion;
    const leave = I.tolerance * I.recross_ratio;
    const a = op.last; op.last = c;
    const d = distPolyline(c, l.path);
    if (d > I.tolerance) {                             // 猶予幅の外に出た：失敗
      this.op = null; if (op.trail) op.trail.keep = false;
      this.fail(l, l.step.fail_damage ?? I.default_fail_damage, I);
      return;
    }
    if (op.armed && polylineCross(a, c, l.path)) { op.count++; op.armed = false; this.app.sound.se('stitch', { vol: 0.7 }); }
    else if (!op.armed && d >= leave) op.armed = true;  // 線から一定の距離離れてから戻ったら、また数える
  }
  releaseNeedle(op) {
    const l = op.lesion, I = this.ins.needle;
    if (op.count >= l.path.length) {
      l.marks.push({ kind: 'stitch', pts: op.trail ? op.trail.pts.slice() : [] });
      if (op.trail) op.trail.t = 99;
      if (op.skip) this.skipStep(l);
      this.succeed(l, l.step.heal ?? 0);
    } else this.snd(I, 'invalid');                     // 回数が足りない：無効
  }
  // ---------------- 注射（spec/05 3.6） ----------------
  drugInfo(id = this.drug) { return this.ins.injector.drugs[id]; }
  doseLimit(drug) {
    const p = this.patient || {};
    const base = (p.dose_limits || {})[drug] ?? this.drugInfo(drug).dose_limit;
    return base == null ? null : base * this.coef('dose_limit');
  }
  pressInjector(c) {
    const I = this.ins.injector, D = this.drugInfo();
    if (this.gauge <= 0.01) { this.snd(I, 'invalid'); this.op = { type: 'none' }; return; }
    if (D.target) {
      const r = this.pick(c, 'injector');
      if (r.kind === 'blocked') { this.snd(I, 'invalid'); this.op = { type: 'none' }; return; }
      if (r.kind === 'target' && r.lesion.step.drug === this.drug) {
        this.op = { type: 'inject', lesion: r.lesion, snd: this.app.sound.se('inject', { vol: 0.5 }) }; return;
      }
      if (r.kind === 'wrong' && r.lesion.type.steps.some(s => s.drug === this.drug)) {   // 対象の病巣の別の段階：薬ごとに無効か失敗
        if (D.wrong_step && D.wrong_step.type === 'fail') this.fail(r.lesion, D.wrong_step.damage, I, true); else this.snd(I, 'invalid');
        this.op = { type: 'none' }; return;
      }
      this.damage(D.miss_damage ?? 1); this.snd(I, 'miss');   // 空振り：押した時点でダメージ、注入しない
      this.op = { type: 'none' }; return;
    }
    this.op = { type: 'inject', snd: this.app.sound.se('inject', { vol: 0.5 }) };
  }
  inject(dt) {
    const op = this.op, I = this.ins.injector, drug = this.drug, D = this.drugInfo();
    const amt = Math.min(this.gauge, I.inject_per_sec * dt);
    if (amt <= 0) return;
    this.gauge -= amt;
    const pd = this.dose[this.patientId] || (this.dose[this.patientId] = {});
    pd[drug] = (pd[drug] || 0) + amt;
    this.stepInject[drug] = (this.stepInject[drug] || 0) + amt;
    if (drug === 'recovery') this.heal(D.heal_full_gauge * amt / 100 * this.coef('heal'));
    if (drug === 'anesthesia') this.anesthesia += D.duration_sec * this.coef('anesthesia_duration') * amt / 100;
    if (op.lesion) {
      op.lesion.injected = (op.lesion.injected || 0) + amt;
      if (op.lesion.injected >= (op.lesion.step.need || 1)) { op.lesion.injected = 0; const l = op.lesion; op.lesion = null; this.succeed(l, l.step.heal ?? 0); }
    }
    const lim = this.doseLimit(drug);
    if (lim != null && pd[drug] > lim) this.doseOver = true;   // 限度量を上回った瞬間にゲームオーバー
  }
  drugButtons() {
    const ids = Object.keys(this.ins.injector.drugs);
    const iconY = MENU_H + ICON_H * 5;
    const bx = this.side === 'left' ? COL_W + 10 : W - COL_W - 10 - 170;
    return ids.map((id, i) => Object.assign(new Button(bx, iconY + ICON_H - 110 - i * 120, 170, 100, this.drugInfo(id).short, null, { size: 34 }), { id }));
  }
  // ---------------- テーピング（spec/05 4.1） ----------------
  tapeNeeded() {
    return this.lesions.some(l => !l.done && l.step && (l.step.instrument === 'taping' || (l.step.optional && l.nextStep && l.nextStep.instrument === 'taping')));
  }
  tapeRect() {
    const x = this.oppX + (COL_W - TAPE.w) / 2;
    const slide = (1 - this.tape.anim) * (this.side === 'left' ? 1 : -1) * (COL_W + 40);
    return { x: x + slide, y: 780, w: TAPE.w, h: TAPE.h };
  }
  inTape(p) { const r = this.tapeRect(); return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h; }
  releaseTape(op) {
    const T = this.ins.special.taping, half = T.band_width / 2;
    const a = op.start, b = op.last;
    let any = false;
    for (const l of this.lesions.slice()) {
      if (l.done) continue;
      const sf = this.stepFor(l, 'taping');
      if (!sf || this.isBlocked(l)) continue;
      let n = 0;
      for (const c of l.cells) if (distSeg(c, a, b) <= half) n++;
      const ratio = l.cells.length ? n / l.cells.length : 0;
      if (ratio + 1e-9 < T.success_ratio) continue;
      l.penalty += Math.round((1 - ratio) * 100);       // はみ出た分の減点（仮案 TBD-05-26）
      l.marks.push({ kind: 'tape', a, b, half });
      if (sf.skip) this.skipStep(l);
      this.succeed(l, l.step.heal ?? 0);
      any = true;
    }
    if (op.trail) op.trail.t = 99;
    if (any) { this.tape.lifted = false; this.app.sound.se('tape_stick'); }
    else this.app.sound.se('invalid');                  // 3割に足りない：無効（テープは持ち上げたまま）
  }
  // ---------------- 結果の処理 ----------------
  snd(I, key) { const n = I.sounds && I.sounds[key]; if (n) this.app.sound.se(n, { vol: 0.8 }); }
  heal(v) { this.vital = Math.min(99, this.vital + v); }
  damage(v) { this.vital -= v * this.coef('damage'); this.popup('-' + (Math.round(v * this.coef('damage') * 10) / 10), this.app.input.pos, '#ff6b6b'); }
  // 省略：次の段階が成功した時点でダメージ（ミスには数えない）
  skipStep(l) {
    const s = l.step;
    l.skipped = true;
    if (s.skip_damage) this.vital -= s.skip_damage * this.coef('damage');
    l.stepIndex++;
  }
  succeed(l, heal) {
    if (heal) this.heal(heal * this.coef('heal'));
    const done = l.advance();
    const at = toLogical({ x: l.bounds.cx, y: l.bounds.y0 });
    if (done) {
      l.doneAt = this.time;
      if (l.counted) {
        l.computeScore(this.coef('score_time'));
        this.popup(l.grade, at, gradeColor(l.grade), 64);
        this.app.sound.se('rate_' + l.grade.toLowerCase());
      } else { this.popup('OK', at, '#bdf', 40); this.app.sound.se('rate_ok', { vol: 0.6 }); }
      this.trigger('lesion_done', l.id);
    } else {
      if (l.isPool) l.refreshCells();
      this.popup('OK', at, '#bdf', 44);
      this.app.sound.se('rate_ok', { vol: 0.7 });
    }
  }
  fail(l, dmg, I, wrongStep = false) {
    this.damage(dmg ?? 0);
    l.misses++; this.misses++;
    this.snd(I, 'fail');
    if (!wrongStep && l.type.on_fail === 'reset') l.stepIndex = 0;   // 失敗で最初に戻るタイプ
  }
  popup(str, at, color, size = 44) { this.popups.push({ text: str, x: at.x, y: at.y, color, size, t: 0 }); }
  // ---------------- バイタルの減少と回復（spec/03 1.2・1.3） ----------------
  decay(dt) {
    const stretch = this.anesthesia > 0 ? Math.max(1, this.drugInfo('anesthesia').decay_interval_stretch * this.coef('anesthesia_stretch')) : 1;
    if (this.anesthesia > 0) this.anesthesia = Math.max(0, this.anesthesia - dt);
    const nd = this.stage.natural_decay;
    if (nd) {
      // 経過を割合で持つので、麻酔の効き始め・切れ目は割合で引き継ぐ（H10 の推奨案）
      this.decayAcc += dt / (nd.interval_sec / this.coef('decay') * stretch);
      while (this.decayAcc >= 1) { this.decayAcc -= 1; this.vital -= nd.amount; }
    }
    for (const l of this.lesions) {
      const vd = l.type.vital_drain;
      if (!vd || l.done) continue;
      l.decayTimer += dt / (vd.interval_sec / this.coef('decay') * stretch);
      while (l.decayTimer >= 1) { l.decayTimer -= 1; this.vital -= vd.amount; }
    }
  }
  recover(dt) {
    const hj = this.ins.healjelly;
    const painting = this.op && this.op.type === 'gel';
    if (this.stock < hj.stock_max && !painting) {      // 塗っている間は止める（経過は保持。H11 の推奨案）
      this.stockAcc += dt;
      const need = hj.stock_recover_sec / this.coef('recover');
      if (this.stockAcc >= need) { this.stockAcc -= need; this.stock++; }
    } else if (this.stock >= hj.stock_max) this.stockAcc = 0;
    const injecting = this.op && this.op.type === 'inject';
    if (!injecting) this.gauge = Math.min(100, this.gauge + dt * 100 / (this.ins.injector.gauge_recover_sec / this.coef('recover')));
  }
  // ---------------- 字幕 ----------------
  updateSubs(dt) {
    if (this.subCur) { this.subCur.t += dt; if (this.subCur.t > this.subCur.dur) this.subCur = null; }
    if (!this.subCur && this.subs.length) {
      const s = this.subs.shift();
      this.subCur = { ...s, t: 0, dur: Math.max(3.5, s.text.length * 0.16) };
    }
  }
  // ---------------- 終了条件（spec/03 3.1） ----------------
  stepCleared() {
    const cc = (this.step && this.step.clear_condition) || { type: 'all_lesions_done' };
    if (cc.type === 'inject') return (this.stepInject[cc.drug] || 0) >= cc.amount;
    return this.pending.length === 0 && this.lesions.every(l => l.done);
  }
  checkEnd() {
    // 優先順位：バイタル0 ＞ 限度量の超過 ＞ 時間切れ ＞ クリア
    if (this.vital <= 0) return this.gameOver('vital_zero');
    if (this.doseOver) return this.gameOver('dose_limit');
    if (this.remain !== null && this.remain <= 0) return this.gameOver('timeout');
    if (this.stepCleared()) this.nextStep();
  }
  nextStep() {
    if (this.op) this.release(this.app.input.pos, true);
    this.app.input.forceRelease();
    if (this.training) {
      const tr = this.training;
      tr.index++;
      if (tr.index >= tr.queue.length) { this.end = { kind: 'clear', t: 0 }; return; }
      this.enterTrainingStep();
      return;
    }
    const step = this.step, i = this.stepIndex;
    const last = i >= this.stage.steps.length - 1;
    const proceed = () => {
      if (step.continue_point_after && !last) this.app.reachContinue(this.ctx, i + 1, this.flags);
      if (last) { this.end = { kind: 'clear', t: 0 }; this.app.sound.se('clear'); return; }
      this.enterStep(i + 1);
    };
    // 途中のステップの治療後の会話は、止める会話としてステップの間に出す（H2 の推奨案）
    if (step.dialogue_after_step && !last) this.startOverlayTalk(step.dialogue_after_step, 'stop', proceed);
    else proceed();
  }
  gameOver(cause) {
    if (this.op) this.release(this.app.input.pos, true);
    this.app.input.forceRelease();
    if (cause !== 'timeout') this.ecg.flatline();       // 平坦はバイタル0と限度量の超過（時間切れでは平坦にしない）
    this.app.sound.bgm(null);
    this.end = { kind: 'gameover', cause, t: 0 };
  }
  updateEnd(dt, input) {
    const e = this.end;
    e.t += dt;
    if (e.kind === 'clear') {
      if (e.t > 1.2) this.training ? this.app.trainingDone(this) : this.app.stageClear(this);
      return;
    }
    // ゲームオーバー：約1.5秒、平坦の波形と音を見せてから会話（H3 の推奨案）
    if (e.cause !== 'timeout') this.ecg.update(dt, 0, false);
    if (this.training && e.t > 3) { this.app.toTrainingSelect(); return; }   // トレーニングは会話を挟まずに戻る（H4 の推奨案）
    if (e.t > 1.5 && !e.talked) {
      e.talked = true;
      if (this.training) { this.ecg.fadeFlatline(1); return; }
      this.ecg.fadeFlatline(3);
      const id = (this.stage.gameover_dialogues || this.data.stages.default_gameover_dialogues)[e.cause];
      this.app.sound.bgm('gameover');
      if (this.app.save.options.skipTalk) { this.app.gameOverScreen(this, e.cause); return; }
      this.startOverlayTalk(id, 'gameover', () => this.app.gameOverScreen(this, e.cause));
    }
  }
  // ---------------- メニュー ----------------
  openMenu() {
    if (this.app.input.down && this.op && this.op.type !== 'ui') return;   // 押している最中は反応しない
    this.menu = { buttons: [] };
    const labels = this.training ? [['再開', 'resume'], ['病巣選択に戻る', 'back']] : [['再開', 'resume'], ['リトライ', 'retry'], ['タイトルに戻る', 'title']];
    this.menu.buttons = labels.map(([l, k], i) => new Button(W / 2 - 260, 330 + i * 130, 520, 100, l, () => this.menuAction(k)));
    this.app.sound.se('select');
  }
  menuAction(k) {
    this.menu = null;
    if (k === 'retry') this.app.retry(this);
    if (k === 'title') this.app.toTitle();
    if (k === 'back') this.app.toTrainingSelect();
  }
  updateMenu(input) {
    for (const e of input.ev) if (e.type === 'down') { const b = this.menu.buttons.find(b => b.hit(e)); if (b) { b.onClick(); return; } }
    for (const k of input.keys) if (k === 'Escape') this.menu = null;
  }

  // ---------------- 描画 ----------------
  draw(c) {
    this.drawArea(c);
    this.drawVital(c);
    this.drawColumn(c);
    this.drawOpposite(c);
    this.drawSubtitle(c);
    if (this.drugMenu) this.drawDrugMenu(c);
    // ピンセットで掴んでいる物は最上位レイヤー
    if (this.op && this.op.type === 'grab') {
      const l = this.op.lesion, dx = this.op.pos.x - this.op.from.x, dy = this.op.pos.y - this.op.from.y;
      c.save(); c.translate(dx, dy); drawLesion(c, l, { objectOnly: true }); c.restore();
    }
    for (const p of this.popups) {
      const a = 1 - Math.max(0, p.t - 1) / 0.6;
      c.save(); c.globalAlpha = clamp(a, 0, 1);
      text(c, p.text, p.x, p.y - 20 - p.t * 40, { size: p.size, color: p.color, align: 'center', weight: 'bold', shadow: true });
      c.restore();
    }
    if (this.end && this.end.kind === 'clear') {
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(AREA.x, AREA.y, AREA.w, AREA.h);
      text(c, this.training ? '治療完了' : 'CLEAR', W / 2, 560, { size: 110, align: 'center', weight: 'bold', color: '#9fffd0', shadow: true });
    }
    if (this.end && this.end.kind === 'gameover' && this.training) {
      text(c, 'ゲームオーバー', W / 2, 560, { size: 90, align: 'center', weight: 'bold', color: '#ff8080', shadow: true });
    }
    if (this.overlay) {
      // 止める会話・ゲームオーバーの会話は、少しだけ暗くしたゲーム画面に重ねる（spec/02 3.4）
      c.fillStyle = this.overlay.kind === 'gameover' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)';
      c.fillRect(0, 0, W, H);
      this.overlay.box.draw(c);
    }
    if (this.menu) {
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, W, H);
      text(c, 'メニュー（一時停止中）', W / 2, 260, { size: 56, align: 'center', weight: 'bold' });
      this.menu.buttons.forEach(b => b.draw(c));
    }
  }
  drawArea(c) {
    const imgs = this.patient ? this.patient.images : [];
    // 患者画像の拍動：心電図と同じテンポ（spec/04 3.2）
    const ph = this.ecg.beatPhase;
    const frame = ph < 0.12 ? 1 : ph < 0.24 ? 2 : 0;
    const im = this.app.img(imgs[frame] || imgs[0]);
    c.save();
    c.beginPath(); c.rect(AREA.x, AREA.y, AREA.w, AREA.h); c.clip();
    if (im) {
      const s = Math.max(AREA.w / im.width, AREA.h / im.height);
      c.drawImage(im, AREA.x + (AREA.w - im.width * s) / 2, AREA.y + (AREA.h - im.height * s) / 2, im.width * s, im.height * s);
    } else { c.fillStyle = '#2a3440'; c.fillRect(AREA.x, AREA.y, AREA.w, AREA.h); }
    if (this.app.debugGrid) {
      c.strokeStyle = 'rgba(255,255,255,0.15)'; c.lineWidth = 1;
      for (let x = 0; x <= 100; x++) { c.beginPath(); c.moveTo(AREA.x + x * 14, AREA.y); c.lineTo(AREA.x + x * 14, AREA.y + AREA.h); c.stroke(); }
      for (let y = 0; y <= 50; y++) { c.beginPath(); c.moveTo(AREA.x, AREA.y + y * 14); c.lineTo(AREA.x + AREA.w, AREA.y + y * 14); c.stroke(); }
    }
    // 治療済み → 処置中 → 血溜まり・膿（上）の順に描く
    const layer = l => l.done ? 0 : l.isPool ? 2 : 1;
    const order = this.lesions.slice().sort((a, b) => layer(a) - layer(b));
    for (const l of order) {
      const grabbing = this.op && this.op.type === 'grab' && this.op.lesion === l;
      drawLesion(c, l, { hideObject: grabbing, shadow: grabbing });
      if (this.app.debugNames && !l.done) {
        const at = toLogical({ x: l.bounds.cx, y: l.bounds.y1 });
        const nm = l.step ? (l.step.instrument === 'taping' ? 'テーピング' : this.ins[l.step.instrument].name) + (l.step.optional ? '（省略可）' : '') : '';
        text(c, (this.isBlocked(l) ? '［血溜まり］' : '') + nm, at.x, at.y + 30, { size: 24, align: 'center', color: '#ff0', shadow: true });
      }
    }
    // 操作の跡
    for (const t of this.trails) {
      const a = t.keep ? 1 : clamp(1 - (t.t - 1.0) / 0.8, 0, 1);
      if (a <= 0 || t.pts.length < 1) continue;
      c.save(); c.globalAlpha = a * t.alpha;
      c.strokeStyle = t.color; c.lineWidth = t.width; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      t.pts.forEach((q, i) => { const p = toLogical(q); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); });
      if (t.pts.length === 1) { const p = toLogical(t.pts[0]); c.lineTo(p.x + 0.1, p.y); }
      c.stroke(); c.restore();
    }
    // テープを貼るときのガイド
    if (this.op && this.op.type === 'tapeswipe') {
      const a = toLogical(this.op.start), b = toLogical(this.op.last);
      c.save(); c.globalAlpha = 0.55; c.strokeStyle = '#f2e7c9'; c.lineWidth = this.ins.special.taping.band_width * AREA.cell; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.restore();
    }
    // 機器の範囲（見た目だけ。spec/04 2章）
    if (this.app.input.down && this.op && ['gel', 'drain', 'inject'].includes(this.op.type)) {
      const p = this.app.input.pos;
      const r = this.op.type === 'gel' ? this.ins.healjelly.brush_radius * AREA.cell : 30;
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
    c.strokeStyle = '#000'; c.lineWidth = 2; c.strokeRect(AREA.x, AREA.y, AREA.w, AREA.h);
  }
  drawVital(c) {
    const x = COL_W, y = 0, w = W - COL_W * 2, h = MENU_H;
    // 心電図（ゲージの後ろ。spec/03 1.4）
    this.ecg.draw(c, x, y, w, h);
    const v = Math.max(0, Math.ceil(this.vital - 1e-9));
    const color = v >= 51 ? '#3fd37a' : v >= 26 ? '#f2c94c' : '#ff5a5a';
    // ゲージ
    const gx = x + 230, gy = y + 120, gw = w - 260, gh = 38;
    roundRect(c, gx, gy, gw, gh, 10); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fill();
    roundRect(c, gx, gy, gw * clamp(v / 99, 0, 1), gh, 10); c.fillStyle = color; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2; roundRect(c, gx, gy, gw, gh, 10); c.stroke();
    text(c, 'VITAL', x + 30, y + 52, { size: 30, color: '#cfe', weight: 'bold' });
    text(c, String(v), x + 30, y + 150, { size: 96, color, weight: 'bold', shadow: true });
    if (this.anesthesia > 0) text(c, `麻酔 ${this.anesthesia.toFixed(1)}秒`, x + w - 30, y + 52, { size: 30, align: 'right', color: '#9fd8ff', weight: 'bold', shadow: true });
  }
  drawColumn(c) {
    const x = this.colX;
    c.fillStyle = '#0d0f12'; c.fillRect(x, 0, COL_W, H);
    // メニュー
    roundRect(c, x + 20, 30, COL_W - 40, MENU_H - 60, 14); c.fillStyle = '#1d232b'; c.fill();
    c.strokeStyle = '#56606c'; c.lineWidth = 2; c.stroke();
    text(c, 'Menu', x + COL_W / 2, MENU_H / 2 + 2, { size: 44, align: 'center', base: 'middle', weight: 'bold' });
    // 強調表示（spec/05 2.8）：1秒表示 → 0.5秒非表示 → 0.5秒表示 → 0.5秒非表示
    const hl = this.highlights();
    const ph = this.flashAcc % 2.5;
    const blinkOn = ph < 1 || (ph >= 1.5 && ph < 2);
    this.ins.order.forEach((id, i) => {
      const y = MENU_H + i * ICON_H;
      const I = this.ins[id];
      const sel = this.selected === id;
      c.fillStyle = sel ? '#2a3a4c' : '#14181d'; c.fillRect(x + 6, y + 6, COL_W - 12, ICON_H - 12);
      // ストック・限度量で徐々に赤く（P67）
      let red = 0;
      if (id === 'healjelly') red = 1 - this.stock / I.stock_max;
      if (id === 'injector') {
        const pd = this.dose[this.patientId] || {};
        for (const d of Object.keys(I.drugs)) { const lim = this.doseLimit(d); if (lim) red = Math.max(red, (pd[d] || 0) / lim); }
      }
      if (red > 0) { c.fillStyle = `rgba(220,30,30,${0.55 * clamp(red, 0, 1)})`; c.fillRect(x + 6, y + 6, COL_W - 12, ICON_H - 12); }
      if (hl[id] && blinkOn) {
        c.strokeStyle = hl[id] === 'main' ? '#ffd23f' : 'rgba(255,210,63,0.45)';
        c.lineWidth = 8; c.strokeRect(x + 10, y + 10, COL_W - 20, ICON_H - 20);
      }
      if (sel) { c.strokeStyle = '#7fd0ff'; c.lineWidth = 4; c.strokeRect(x + 6, y + 6, COL_W - 12, ICON_H - 12); }
      const im = this.app.img(I.icon);
      if (im) c.drawImage(im, x + 18, y + 20, 110, 110);
      text(c, `${i + 1}`, x + 22, y + 40, { size: 24, color: '#8a96a3' });
      text(c, I.name, x + 140, y + 70, { size: 26, color: '#e8eef4', maxWidth: 112 });
      if (id === 'healjelly') text(c, `${this.stock}/${I.stock_max}`, x + 140, y + 110, { size: 28, color: '#9fe' });
      if (id === 'injector') {
        c.fillStyle = '#333'; c.fillRect(x + 140, y + 92, 100, 16);
        c.fillStyle = '#6cf'; c.fillRect(x + 140, y + 92, this.gauge, 16);
        text(c, this.drugInfo().short, x + 140, y + 132, { size: 24, color: '#9cf' });
      }
    });
  }
  highlights() {
    const hl = {};
    const set = (id, kind) => { if (id && id !== 'taping' && hl[id] !== 'main') hl[id] = kind; };
    for (const l of this.lesions) {
      if (l.done || !l.step) continue;
      if (this.isBlocked(l)) { set('drain', 'main'); continue; }
      set(l.step.instrument, 'main');
      if (l.step.optional && l.nextStep) set(l.nextStep.instrument, 'sub');
    }
    return hl;
  }
  drawDrugMenu(c) {
    const pd = this.dose[this.patientId] || {};
    const need = new Set(this.lesions.filter(l => !l.done && l.step && l.step.instrument === 'injector').map(l => l.step.drug));
    const cc = this.step && this.step.clear_condition;
    if (cc && cc.type === 'inject') need.add(cc.drug);
    for (const b of this.drugButtons()) {
      b.selected = b.id === this.drug;
      const lim = this.doseLimit(b.id);
      b.bg = lim ? `rgba(${Math.round(20 + 200 * clamp((pd[b.id] || 0) / lim, 0, 1))},28,38,0.95)` : undefined;
      b.border = need.has(b.id) ? '#ffd23f' : undefined;
      b.draw(c);
      if (lim) text(c, `${Math.round(pd[b.id] || 0)}/${Math.round(lim)}`, b.x + b.w / 2, b.y + b.h - 8, { size: 18, align: 'center', color: '#fcc' });
    }
  }
  drawOpposite(c) {
    const x = this.oppX;
    c.fillStyle = '#0d0f12'; c.fillRect(x, 0, COL_W, H);
    if (this.remain !== null) {
      const r = Math.ceil(this.remain);
      text(c, 'TIME', x + COL_W / 2, 60, { size: 30, align: 'center', color: '#9ab', weight: 'bold' });
      text(c, `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`, x + COL_W / 2, 140, { size: 68, align: 'center', weight: 'bold', color: r <= 30 ? '#ff6b6b' : '#fff' });
    } else text(c, 'TRAINING', x + COL_W / 2, 110, { size: 32, align: 'center', color: '#9ab', weight: 'bold' });
    // トレイ（掴んでいる間だけ、枠外から出てくる）
    if (this.tray.anim > 0) {
      const r = this.trayRect();
      roundRect(c, r.x, r.y, r.w, r.h, 18); c.fillStyle = '#9aa7b3'; c.fill();
      roundRect(c, r.x + 14, r.y + 14, r.w - 28, r.h - 28, 12); c.fillStyle = '#c7d0d8'; c.fill();
      text(c, 'トレイ', r.x + r.w / 2, r.y + r.h / 2, { size: 34, align: 'center', base: 'middle', color: '#334' });
    }
    // テープ
    if (this.tape.anim > 0) {
      const r = this.tapeRect();
      c.save();
      if (this.tape.lifted) { c.globalAlpha = 0.35; }
      roundRect(c, r.x, r.y, r.w, r.h, 10); c.fillStyle = '#efe3c2'; c.fill();
      c.strokeStyle = '#b8a77c'; c.lineWidth = 3; c.stroke();
      text(c, 'テープ', r.x + r.w / 2, r.y + r.h / 2, { size: 32, align: 'center', base: 'middle', color: '#654' });
      c.restore();
      if (this.tape.lifted) text(c, '持ち上げ中', r.x + r.w / 2, r.y - 20, { size: 28, align: 'center', color: '#ffe9a8', weight: 'bold' });
    }
  }
  drawSubtitle(c) {
    const x = COL_W, y = 880, w = W - COL_W * 2, h = 200;
    c.fillStyle = 'rgba(8,10,14,0.92)'; c.fillRect(x, y, w, h);
    const s = this.subCur;
    if (!s) return;
    const ch = this.data.talks.characters[s.speaker];
    const im = ch && this.app.img(ch.image);
    if (im) {
      // 顔画像の代わりに、立ち絵の上の部分を切り抜く（本来は別素材）
      const sw = im.width * 0.5, sh = sw;
      c.save(); c.beginPath(); c.rect(x + 20, y + 10, 180, 180); c.clip();
      c.drawImage(im, im.width * 0.25, 0, sw, sh, x + 20, y + 10, 180, 180);
      c.restore();
    }
    if (ch) text(c, ch.name, x + 230, y + 50, { size: 30, color: '#9fd8ff', weight: 'bold' });
    text(c, s.text, x + 230, y + 115, { size: 40, maxWidth: w - 260 });
  }
}

function gradeColor(g) { return { Cool: '#5ff0ff', Good: '#7dff8a', Fine: '#ffe36b', Bad: '#ff7a7a' }[g] || '#fff'; }
