// ゲーム画面（spec/02 3.4、03、05）
import { W, H, text, roundRect, wrapText, Button, clamp } from './core.js';
import { AREA, toCell, toLogical, inArea, dist, distSeg, distPolyline, polylineCross, shapeCells } from './geometry.js';
import { Lesion, rankOf } from './lesion.js';
import { Ecg } from './ecg.js';
import { TalkBox } from './talk.js';
import { drawLesion, drawShard, DRUG_COLOR, petalPos } from './draw_lesion.js';

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
    this.anesthesia = 0; this.anesOn = false;
    this.stock = this.ins.healjelly.stock_max; this.stockTimer = 0;   // 使ったストックは1つずつ順番に戻る（P101）
    this.gauges = {};                                  // 注射のゲージは薬ごと（P102）
    for (const d of Object.keys(this.ins.injector.drugs)) this.gauges[d] = 100;
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
    for (let i = 0; i < startStep; i++) this.preCount += this.placementsOf(this.stage.steps[i]).filter(p => !this.data.lesions[p.lesion].unscored).length;
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
    // 最初のステップの dialogue_before は、ゲーム画面に入った直後に出す（scenario.md の【ゲーム画面】の最初の「会話」）
    if (step.dialogue_before) this.startOverlayTalk(step.dialogue_before, 'stop', () => this.beginStep());
    else this.beginStep();
  }
  beginStep() {
    const t = this.treatmentOf(this.step || {});
    this.during = (t.dialogue_during || []).slice();
    this.trigger('step_start');
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
    this.initMicro(l);
    // 一緒に出す病巣（病巣データに書く。P85。"each_point" は病巣の点それぞれ）
    for (const w of type.with || []) {
      const ats = w.at === 'each_point' ? (l.points || []) : [l.abs(w.at)];
      ats.forEach((q, k) => this.spawn({ id: l.id + '_' + w.lesion + '_' + k, lesion: w.lesion, position: [q.x, q.y] }, true));
    }
    this.trigger('lesion_appear', l.id);
    return l;
  }
  // 字幕（処置中の会話）
  // きっかけごとにまとめて出す。新しいきっかけの字幕が来たら、出している途中・待っている字幕は打ち切る
  trigger(type, value, extra) {
    const group = [];
    for (const d of this.during) {
      if (d._done) continue;
      if (d.at.type === type && (d.at.value === undefined || d.at.value === value) && (d.at.step === undefined || d.at.step === extra)) { d._done = true; group.push(d); }
    }
    if (!group.length) return;
    this.subCur = { ...group[0], t: 0 };
    this.subs = group.slice(1);
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
    for (const l of this.lesions.slice()) if (l.type.bleed && !l.done) this.bleed(l, dt);
    for (const l of this.lesions.slice()) if (!l.done) this.micro(l, dt);
    this.spawnPending();
    // 字幕：血溜まり・膿が無くなって、下の病巣を処置できるようになった
    for (const l of this.lesions) {
      if (l.done || l.isPool) continue;
      const b = this.isBlocked(l);
      if (l._blocked && !b) this.trigger('lesion_unblocked', l.id);
      l._blocked = b;
    }
    this.updateSubs(dt);
    this.ecg.update(dt, Math.ceil(this.vital), this.anesthesia > 0);
    this.trails = this.trails.filter(t => (t.t += dt) < 1.8 || t.keep);
    this.popups = this.popups.filter(p => (p.t += dt) < 1.6);
    this.tray.anim = clamp(this.tray.anim + (this.tray.show ? dt : -dt) * 5, 0, 1);
    this.tape.show = this.tapeNeeded();
    if (!this.tape.show && this.tape.lifted) this.putTape();
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
    this.tape.lifted = false; this.tape.prev = null;  // 持ち替えで持ち上げを解除（P64）
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
        if (this.tape.lifted) { this.putTape(); this.app.sound.se('cancel', { vol: 0.6 }); this.op = { type: 'ui' }; }   // 出現位置をもう一度押すと置く
        else this.op = { type: 'tapepress' };
        return;
      }
      const c = toCell(p);
      if (!inArea(c)) { this.op = { type: 'none' }; return; }
      if (this.tape.lifted) { this.op = { type: 'tapeswipe', start: c, last: c }; this.trailStart(c, '#f2e7c9', 7 * AREA.cell, 0.35); return; }
      this.scare(c);
      this.press(c);
    } else if (e.type === 'move') {
      if (!this.op) return;
      if (this.op.type === 'grab') { this.op.pos = p; return; }
      const c = toCell(p);
      if (this.op.type !== 'ui' && this.op.type !== 'none') this.scare(c);
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
      const lp = this.pathOf(l);
      if (!hit && extraFor && lp) hit = distPolyline(c, lp) <= extraFor;
      if (hit) list.push(l);
    }
    return list;
  }
  isBlocked(l) {
    if (l.isPool) return false;
    for (const p of this.lesions) if (p.isPool && !p.done && l.overlapsPool(p)) return true;
    return false;
  }
  // 今の段階（省略できる段階なら、その次の段階も）で使う線
  pathOf(l, skip = false) {
    if (skip) { const g = l.stepGeo[l.stepIndex + 1]; return (g && g.path) || l.path; }
    return l.curPath;
  }
  // 今の段階が instrument か（省略できる段階の次の段階を含む）
  stepFor(l, instrument) {
    const s = l.step;
    if (!s) return null;
    if (s.instrument === instrument) return { skip: false };
    if (s.instrument === 'petals' && (instrument === 'injector' || instrument === 'tweezers')) return { skip: false };   // 花型の花びら
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
      this.stock -= 1;                                   // 押した時点で消費する。戻るのは1つずつ順番（P101）
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
      const pe = this.petalAt(c);
      if (pe) {
        if (pe.petal.hard) { pe.lesion.petals.splice(pe.lesion.petals.indexOf(pe.petal), 1); this.snd(I, 'put'); if (!pe.lesion.petals.length) this.succeed(pe.lesion, 0); }
        else this.snd(I, 'invalid');                     // 硬化していない花びら：無効（試作の仮）
        this.op = { type: 'none' }; return;
      }
      const r = this.pick(c, 'tweezers');
      if (r.kind === 'target' && r.lesion.curTap) { this.tapPoint(r.lesion, c); this.op = { type: 'none' }; return; }
      if (r.kind === 'target' && r.lesion.curConnect) {
        // 2点を繋ぐ（血管接合）：どちらかの端を掴んで、もう片方へ運ぶ（A→B でも B→A でもよい）
        const l = r.lesion, [a, b] = l.curConnect, R = l.step.radius ?? I.dest_radius + 1;
        const from = dist(c, a) <= dist(c, b) ? a : b;
        if (dist(c, from) > R) { this.snd(I, 'invalid'); this.op = { type: 'none' }; return; }
        this.op = { type: 'grab', lesion: l, connect: { from, to: from === a ? b : a }, pos: toLogical(c), from: toLogical(c) };
        this.snd(I, 'grab');
        return;
      }
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
    else if (op.type === 'slash') this.dragSlash(c);
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
      case 'slash': if (!op.hit) this.app.sound.se('invalid', { vol: 0.5 }); break;
      case 'stitch': this.releaseNeedle(op); break;
      case 'tapepress': if (!cancel) this.liftTape(); break;
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
      if (!sf || this.isBlocked(l) || l.isPool) { invalid = true; continue; }   // 手順違い・血溜まりの重なり：無効
      const th = l.step.cover_threshold ?? I.cover_threshold;
      if (ratio + 1e-9 < th) { invalid = true; continue; }
      l.penalty += (1 - ratio) * 100 * (l.type.cover_penalty_scale ?? 1);   // 覆いきらなかった分の減点
      if (sf.skip) this.skipStep(l);                     // 省略できる段階（裂傷の縫合針など）を飛ばしてヒールゼリー
      if (l.step.freeze) l.frozenLeft = l.type.move.freeze_sec;   // 魚型の足止め（試作の仮）
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
    for (const l of this.lesions) {
      if (l.isPool || l.done || !l.step || l.step.instrument !== 'drain' || this.isBlocked(l) || !l.contains(c, 0.8)) continue;
      sucking = true;
      l.sucked = (l.sucked || 0) + this.ins.drain.suck_per_sec * dt;
      if (l.sucked >= (l.step.suck || 10)) { l.sucked = 0; this.succeed(l, l.step.heal ?? 0); }
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
  // 点をタップして閉じる・つまむ（裂傷・大型破片痕・腫瘍。順番は問わない（試作の仮。TBD-06-11））
  tapPoint(l, c) {
    const I = this.ins.tweezers, R = l.step.radius ?? I.dest_radius + 1;
    const pts = l.curTap;
    let best = -1, bd = Infinity;
    pts.forEach((q, i) => { if (!l.tapped.has(i)) { const d = dist(c, q); if (d < bd) { bd = d; best = i; } } });
    if (best < 0 || bd > R) { this.snd(I, 'invalid'); return; }   // 点の外：無効（ダメージなし）
    l.tapped.add(best);
    this.snd(I, 'put');
    if (l.tapped.size >= pts.length) this.succeed(l, l.step.heal ?? 0);
  }
  releaseGrab(op, p) {
    const l = op.lesion, s = l.step, I = this.ins.tweezers;
    let ok = false;
    if (op.connect) {
      ok = dist(toCell(p), op.connect.to) <= (s.radius ?? I.dest_radius + 1);
    } else if (s.dest === 'tray') {
      const r = this.trayRect();
      ok = p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
    } else if (s.dest && s.dest.position) {
      const d = l.abs(s.dest.position);
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
    if (r.lesion.step.slash) { this.op = { type: 'slash', lesion: r.lesion, len: 0, last: c, hit: false }; this.trailStart(c, 'rgba(255,60,60,0.95)', 5); this.app.sound.se('cut', { vol: 0.5 }); return; }
    const l = r.lesion, path = this.pathOf(l, r.skip);
    if (!path) { this.op = { type: 'none' }; return; }
    const closed = r.skip ? !!(l.nextStep.path ? l.nextStep.path_closed : l.type.path_closed) : l.curClosed;
    const op = { type: 'cut', lesion: l, path, skip: r.skip, passed: new Set(), last: c, closed };
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
    const op = this.op, I = this.ins.scalpel, l = op.lesion, path = op.path;
    const a = op.last; op.last = c;
    const steps = Math.max(1, Math.ceil(dist(a, c) / 0.4));
    for (let s = 1; s <= steps; s++) {
      const q = { x: a.x + (c.x - a.x) * s / steps, y: a.y + (c.y - a.y) * s / steps };
      if (!this.cutStep(q)) return;
    }
  }
  // 1点ずつ調べる。false を返したら操作は終わり
  cutStep(q) {
    const op = this.op, I = this.ins.scalpel, l = op.lesion, path = op.path, n = path.length;
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
    const spawns = l.step.spawn_on_success || [];
    this.succeed(l, l.step.heal ?? 0);
    // 切開で血・膿が出る（血腫・粉瘤。spec/06 3.7）
    for (const w of spawns) { const q = l.abs(w.at); this.spawn({ id: l.id + '_' + w.lesion, lesion: w.lesion, position: [q.x, q.y] }, true); }
  }
  // 動く病巣への攻撃：なぞった線が病巣を通ったら1回（試作の仮。TBD-06-11）
  dragSlash(c) {
    const op = this.op;
    op.len += dist(op.last, c); op.last = c;
    if (op.hit || op.len < this.ins.scalpel.min_cut_length) return;
    const l = op.lesion;
    if (l.done || !l.step || !l.step.slash || l.fleeT > 0 || !l.contains(c, 1)) return;   // 逃げている間は当たらない
    op.hit = true;
    this.slashHit(l);
  }
  slashHit(l) {
    const s = l.step;
    l.hitsDone = (l.hitsDone || 0) + 1; l.cracks = (l.cracks || 0) + 1;
    if (s.wings) l.wings = Math.max(0, (l.wings ?? 4) - 1);
    if (l.hitsDone >= (s.hits || 1)) { l.hitsDone = 0; this.succeed(l, s.heal ?? 0); }
    else { this.popup(s.wings ? '羽 -1' : 'HIT', toLogical(l.origin), '#ffd27a', 40); this.app.sound.se('rate_ok', { vol: 0.6 }); }
  }
  dragCutMiss(c) {
    const op = this.op, I = this.ins.scalpel;
    const last = op.pts[op.pts.length - 1];
    op.len += dist(last, c); op.pts.push(c);
    // 空振りの途中で、動く病巣を通った：攻撃に切り替える（ダメージは取り消さない）
    const t = this.lesions.find(l => !l.done && l.step && l.step.slash && !(l.fleeT > 0) && !this.isBlocked(l) && l.contains(c, 1));
    if (t && op.len >= I.min_cut_length) { this.op = { type: 'slash', lesion: t, len: op.len, last: c, hit: true, trail: op.trail }; this.slashHit(t); return; }
    if (!op.hit && op.len >= I.min_cut_length) {        // 「切った」とみなす長さに達した時点で、ダメージ（spec/05 2.1）
      op.hit = true;
      this.damage(I.miss_damage);
      this.snd(I, 'miss');
    }
  }
  releaseCutMiss(op) {
    if (!op.hit) return;
    // 切った場所に切り傷（空振りの切り傷。間引いた折れ線、長さの上限 10マス、手術エリアの外は切り捨て。spec/06 3.1）
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
    const sew = cands.filter(l => { const sf = this.stepFor(l, 'needle'); const lp = sf && this.pathOf(l, sf.skip); return lp && distPolyline(c, lp) <= I.tolerance; });
    if (!sew.length) { this.damage(I.miss_damage); this.snd(I, 'miss'); this.op = { type: 'none' }; return; }   // 空振り：押した瞬間にダメージ
    const pathOfN = l => this.pathOf(l, this.stepFor(l, 'needle').skip);
    sew.sort((a, b) => distPolyline(c, pathOfN(a)) - distPolyline(c, pathOfN(b)));   // 押した位置に最も近い線
    const l = sew[0], path = pathOfN(l);
    const leave = I.tolerance * I.recross_ratio;
    this.op = { type: 'stitch', lesion: l, path, skip: this.stepFor(l, 'needle').skip, count: 0, last: c, armed: distPolyline(c, path) > leave };
    this.trailStart(c, 'rgba(40,40,40,0.95)', 4);
  }
  dragNeedle(c) {
    const op = this.op, I = this.ins.needle, l = op.lesion;
    const leave = I.tolerance * I.recross_ratio;
    const a = op.last; op.last = c;
    const d = distPolyline(c, op.path);
    if (d > I.tolerance) {                             // 猶予幅の外に出た：失敗
      this.op = null; if (op.trail) op.trail.keep = false;
      this.fail(l, l.step.fail_damage ?? I.default_fail_damage, I);
      return;
    }
    if (op.armed && polylineCross(a, c, op.path)) { op.count++; op.armed = false; this.app.sound.se('stitch', { vol: 0.7 }); }
    else if (!op.armed && d >= leave) op.armed = true;  // 線から一定の距離離れてから戻ったら、また数える
  }
  releaseNeedle(op) {
    const l = op.lesion, I = this.ins.needle;
    if (op.count >= op.path.length) {
      l.marks.push({ kind: 'stitch', pts: op.trail ? op.trail.pts.slice() : [] });
      if (op.trail) op.trail.t = 99;
      if (op.skip) this.skipStep(l);
      if (l.step.freeze) l.pinned = true;               // 蛇型の足止め（以後動かない。試作の仮）
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
  get gauge() { return this.gauges[this.drug]; }
  pressInjector(c) {
    const I = this.ins.injector, D = this.drugInfo();
    if (this.gauge <= 0.01) { this.snd(I, 'invalid'); this.op = { type: 'none' }; return; }
    // 花型の花びら：同じ色の薬で硬化させる（試作の仮。違う色は無効）
    const pe = this.petalAt(c);
    if (pe) {
      if (pe.petal.hard || pe.petal.drug !== this.drug) { this.snd(I, 'invalid'); this.op = { type: 'none' }; return; }
      this.op = { type: 'inject', petal: pe.petal, noEffect: true, snd: this.app.sound.se('inject', { vol: 0.5 }) }; return;
    }
    // 患部に打つ段階（切開の麻酔など）：注射を打つ点から3マス以内なら、その段階に数える。いつもの効果は出さない（P89・P100）
    const R = this.ins.injector.inject_point_radius ?? 3;
    const at = this.lesions.find(l => !l.done && l.curInject && l.step.drug === this.drug && !this.isBlocked(l) && dist(c, l.curInject) <= R);
    if (at) { this.op = { type: 'inject', lesion: at, noEffect: true, atPoint: true, snd: this.app.sound.se('inject', { vol: 0.5 }) }; return; }
    if (D.target) {
      const r = this.pick(c, 'injector');
      if (r.kind === 'blocked') { this.snd(I, 'invalid'); this.op = { type: 'none' }; return; }
      if (r.kind === 'target' && r.lesion.step.drug === this.drug && !r.lesion.curInject) {
        this.op = { type: 'inject', lesion: r.lesion, snd: this.app.sound.se('inject', { vol: 0.5 }) }; return;
      }
      if (r.kind === 'wrong' && r.lesion.type.steps.some(s => s.drug === this.drug)) {   // 対象の病巣の別の段階：薬ごとに無効か失敗
        if (D.wrong_step && D.wrong_step.type === 'fail') this.fail(r.lesion, D.wrong_step.damage, I, true); else this.snd(I, 'invalid');
        this.op = { type: 'none' }; return;
      }
      this.damage(D.miss_damage ?? 1); this.snd(I, 'miss');   // 空振り：押した時点でダメージ、注入しない
      this.op = { type: 'none' }; return;
    }
    // 麻酔などどこでも効く薬：手術エリアのどこでも、いつもの効果（打つ点の外に打ったときも、段階は進まず効果だけ出る）
    this.op = { type: 'inject', lesion: null, snd: this.app.sound.se('inject', { vol: 0.5 }) };
  }
  inject(dt) {
    const op = this.op, I = this.ins.injector, drug = this.drug, D = this.drugInfo();
    const amt = Math.min(this.gauges[drug], I.inject_per_sec * dt);
    if (amt <= 0) return;
    this.gauges[drug] -= amt;
    const pd = this.dose[this.patientId] || (this.dose[this.patientId] = {});
    if (!op.atPoint) pd[drug] = (pd[drug] || 0) + amt;   // 患部に打つ段階の量は限度量に数えない（P108）
    this.stepInject[drug] = (this.stepInject[drug] || 0) + amt;
    if (!op.noEffect) {
      if (drug === 'recovery') this.heal(D.heal_full_gauge * amt / 100 * this.coef('heal'));
      if (drug === 'anesthesia') this.anesthesia += D.duration_sec * this.coef('anesthesia_duration') * amt / 100;
    }
    if (op.petal) {
      op.petal.injected = (op.petal.injected || 0) + amt;
      if (op.petal.injected >= this.flowerOf(op.petal).type.petals.need) { op.petal.hard = true; op.petal = null; this.app.sound.se('rate_ok', { vol: 0.6 }); }
    }
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
  // 持ち上げた時点で、選択中の機器をテープ扱いにする（機器の列は6つとも未選択の表示。H13）
  liftTape() {
    this.tape.lifted = true; this.tape.prev = this.selected;
    this.selected = 'tape'; this.drugMenu = false;
    this.app.sound.se('tape_lift');
  }
  // 置いたとき（貼り終えたときも）は、持ち上げる前の機器に戻す
  putTape() {
    this.tape.lifted = false;
    if (this.selected === 'tape') this.selected = this.tape.prev || 'healjelly';
    this.tape.prev = null;
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
      l.penalty += (1 - ratio) * 100;                   // はみ出た分の減点（端数は点数の計算の最後に切り上げる）
      l.marks.push({ kind: 'tape', a, b, half });
      if (sf.skip) this.skipStep(l);
      this.succeed(l, l.step.heal ?? 0);
      any = true;
    }
    if (op.trail) op.trail.t = 99;
    if (any) { this.putTape(); this.app.sound.se('tape_stick'); }
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
    l.tapped = new Set();
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
      this.trigger('lesion_step', l.id, l.stepIndex);   // 字幕：病巣が N 番目の段階（0から数える）に進んだ
    }
  }
  fail(l, dmg, I, wrongStep = false) {
    this.damage(dmg ?? 0);
    l.misses++; this.misses++;
    this.snd(I, 'fail');
    if (!wrongStep && l.type.on_fail === 'reset') l.stepIndex = 0;   // 失敗で最初に戻るタイプ
  }
  popup(str, at, color, size = 44) { this.popups.push({ text: str, x: at.x, y: at.y, color, size, t: 0 }); }
  // 縫合前に時間がかかると血溜まりが出る（裂傷。spec/06 3.2。間隔は試作の仮の値）
  bleed(l, dt) {
    const b = l.type.bleed;
    if (l.stepIndex >= b.until_step) return;
    if (this.isBlocked(l)) { l.bleedTimer = 0; return; }   // 血溜まりが残っている間は計らない（試作の仮）
    l.bleedTimer += dt;
    if (l.bleedTimer < b.every_sec) return;
    l.bleedTimer = 0;
    const pts = l.points || [l.origin];
    const free = pts.filter(q => !this.lesions.some(o => o.isPool && !o.done && dist(o.origin, q) < 1));
    if (!free.length) return;
    const q = free[Math.floor(Math.random() * free.length)];
    this.spawn({ id: l.id + '_bleed' + Math.floor(this.time * 1000), lesion: b.lesion || 'blood', position: [q.x, q.y] }, true);
    this.app.sound.se('lesion_appear', { vol: 0.5 });
  }
  // ---------------- マイクロマシン（試作の仮の動き。P96、TBD-06-11） ----------------
  initMicro(l) {
    const t = l.type;
    if (t.move && t.move.kind === 'snake') {
      const n = t.move.segments, g = t.move.seg_len;
      l.dir = Math.random() * Math.PI * 2;
      l.body = []; for (let k = 0; k < n; k++) l.body.push({ x: l.origin.x - Math.cos(l.dir) * g * k, y: l.origin.y - Math.sin(l.dir) * g * k });
      this.snakeShape(l);
    }
    if (t.move) { l.face = { x: 1, y: 0 }; l.moveT = Math.random(); }
    if (t.petals) { l.petals = []; for (let k = 0; k < t.petals.start; k++) this.addPetal(l); l.petalT = 0; }
    if (t.scales) { l.wings = 4; l.scaleT = 0; l.dropped = 0; l.producing = 0; }
    if (t.produce) { l.produceLeft = t.produce.every_sec; l.spawned = []; }
    if (t.attack) l.attackT = 0;
  }
  snakeShape(l) {
    const b = l.body;
    l.hit = [{ type: 'line', points: b.map(q => ({ ...q })), width: 2 }];
    l.path = [b[0], b[Math.floor((b.length - 1) / 2)], b[b.length - 1]].map(q => ({ ...q }));
    l.stepGeo.forEach(g => { g.path = null; });
    l.refreshCells();
  }
  addPetal(l) {
    const P = l.type.petals;
    l.petals.push({ drug: P.drugs[Math.floor(Math.random() * P.drugs.length)], hard: false, injected: 0 });
    l.petals.forEach((pe, k) => { pe.ang = Math.PI * 2 * k / l.petals.length - Math.PI / 2; });
  }
  petalAt(c) {
    for (const l of this.lesions) {
      if (l.done || !l.petals || !l.step || l.step.instrument !== 'petals' || this.isBlocked(l)) continue;
      for (const pe of l.petals) if (dist(c, petalPos(l, pe)) <= l.type.petals.hit) return { lesion: l, petal: pe };
    }
    return null;
  }
  flowerOf(pe) { return this.lesions.find(l => l.petals && l.petals.includes(pe)); }
  // 蝶型は、機器を当てようとすると逃げる（鱗粉の生産中は逃げない）
  scare(c) {
    if (this.selected === 'drain') return;
    for (const l of this.lesions) {
      const m = l.type.move;
      if (l.done || !l.type.scales || !m || l.producing > 0 || l.stepIndex > 0 || l.fleeT > 0) continue;
      const d = dist(c, l.origin);
      if (d > m.flee_radius) continue;
      const ux = (l.origin.x - c.x) / (d || 1), uy = (l.origin.y - c.y) / (d || 1);
      l.vel = { x: ux * m.flee_speed, y: uy * m.flee_speed }; l.fleeT = m.flee_sec;
      if (this.op && this.op.type === 'slash' && this.op.lesion === l && !this.op.hit) this.op.lesion = { done: true };   // 逃げたので当たらない
    }
  }
  moveWithin(l, dx, dy) {
    const b = l.bounds, m = 1;
    if (b.x0 + dx < m || b.x1 + dx > 99 - m) { dx = 0; l.vel.x = -l.vel.x; }
    if (b.y0 + dy < m || b.y1 + dy > 49 - m) { dy = 0; l.vel.y = -l.vel.y; }
    if (!dx && !dy) return;
    l.moveBy(dx, dy);
    if (Math.hypot(dx, dy) > 1e-6) l.face = { x: dx, y: dy };
    if ((l._mc = (l._mc || 0) + Math.hypot(dx, dy)) > 0.6) { l._mc = 0; l.refreshCells(); }
    else l.bounds = { ...l.bounds, x0: l.bounds.x0 + dx, x1: l.bounds.x1 + dx, y0: l.bounds.y0 + dy, y1: l.bounds.y1 + dy, cx: l.bounds.cx + dx, cy: l.bounds.cy + dy };
  }
  micro(l, dt) {
    const t = l.type, m = t.move;
    l.spin = (l.spin || 0) + dt;
    // 魚型：停止と移動をくり返す。ヒールゼリーで足止め（時間が切れたら元に戻る）
    if (m && m.kind === 'dash') {
      if (l.frozenLeft > 0) {
        l.frozenLeft -= dt;
        if (l.frozenLeft <= 0 && l.stepIndex === 1) { l.stepIndex = 0; l.tapped = new Set(); this.popup('足止めが切れた', toLogical(l.origin), '#ffb0b0', 32); }
      }
      if (l.stepIndex === 0 && !(l.frozenLeft > 0)) {
        l.moveT += dt;
        const cyc = m.stop_sec + m.dash_sec, ph = l.moveT % cyc;
        if (ph < m.stop_sec) l.vel = { x: 0, y: 0 };
        else if (!l.dashing) { const a = Math.random() * Math.PI * 2; l.vel = { x: Math.cos(a) * m.speed, y: Math.sin(a) * m.speed }; }
        l.dashing = ph >= m.stop_sec;
        this.moveWithin(l, l.vel.x * dt, l.vel.y * dt);
        // 攻撃：定期的に切り傷を作る
        if (t.attack && (l.attackT += dt) >= t.attack.every_sec) {
          l.attackT = 0;
          const f = l.face, d = Math.hypot(f.x, f.y) || 1, L = t.attack.length;
          const a = { x: l.origin.x, y: l.origin.y }, b = { x: a.x - f.x / d * L, y: a.y - f.y / d * L };
          const pts = [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b].filter(inArea);
          if (pts.length >= 2) { this.spawn({ id: 'fishcut' + Math.floor(this.time * 1000), lesion: t.attack.lesion, position: [0, 0], shapes: [{ type: 'line', points: pts, width: 1 }] }, true); this.app.sound.se('miss', { vol: 0.5 }); }
        }
      }
    }
    // 蛇型：体内をうねって進む。縫合針で足止めすると止まる
    if (m && m.kind === 'snake' && !l.pinned && l.stepIndex === 0) {
      l.dir += (Math.random() - 0.5) * m.turn * dt * 4;
      const h = l.body[0], sp = m.speed * dt;
      let nx = h.x + Math.cos(l.dir) * sp, ny = h.y + Math.sin(l.dir) * sp;
      if (nx < 3 || nx > 96) { l.dir = Math.PI - l.dir; nx = h.x; }
      if (ny < 3 || ny > 46) { l.dir = -l.dir; ny = h.y; }
      l.body[0] = { x: nx, y: ny };
      for (let k = 1; k < l.body.length; k++) {
        const a = l.body[k - 1], b = l.body[k], d = dist(a, b) || 1;
        l.body[k] = { x: a.x + (b.x - a.x) / d * m.seg_len, y: a.y + (b.y - a.y) / d * m.seg_len };
      }
      l.origin.x = nx; l.origin.y = ny;
      if ((l._sc = (l._sc || 0) + dt) > 0.15) { l._sc = 0; this.snakeShape(l); }
    }
    // 蝶型・鱗粉：ゆっくり漂う。蝶型は羽が減るほど遅くなる
    if (m && m.kind === 'drift') {
      const still = t.scales && (l.producing > 0 || l.stepIndex > 0);
      if (l.fleeT > 0) l.fleeT -= dt;
      else if (!still) {
        l.wander = (l.wander ?? Math.random() * 6.28) + (Math.random() - 0.5) * dt * 3;
        const sp = m.speed * (t.scales ? Math.max(0.2, 1 - (m.slow_per_wing || 0) * (4 - l.wings)) : 1);
        l.vel = { x: Math.cos(l.wander) * sp, y: Math.sin(l.wander) * sp };
      } else l.vel = { x: 0, y: 0 };
      this.moveWithin(l, l.vel.x * dt, l.vel.y * dt);
      if (t.scales) l.flap = (l.flap || 0) + dt * (still ? 3 : 10);
    }
    // 蝶型：鱗粉をまく。何度かまくと止まって鱗粉を生産する（羽が減るほどペースが落ちる）
    if (t.scales && l.stepIndex === 0) {
      const S = t.scales;
      if (l.producing > 0) {
        l.producing -= dt;
        if (l.producing <= 0) for (let k = 0; k < 2; k++) this.spawn({ id: l.id + '_sc' + Math.floor(this.time * 1000) + k, lesion: S.lesion, position: [l.origin.x + (k ? 2 : -2), l.origin.y + 2] }, true);
      } else if ((l.scaleT += dt) >= S.every_sec * (1 + (S.slow_per_wing || 0) * (4 - l.wings) / 4)) {
        l.scaleT = 0;
        this.spawn({ id: l.id + '_sc' + Math.floor(this.time * 1000), lesion: S.lesion, position: [l.origin.x, l.origin.y + 2] }, true);
        if (++l.dropped >= S.produce_after) { l.dropped = 0; l.producing = S.produce_sec; }
      }
    }
    // 花型：花びらが時間で増える
    if (t.petals && l.stepIndex === 0 && l.petals.length < t.petals.max && (l.petalT += dt) >= t.petals.grow_sec) { l.petalT = 0; this.addPetal(l); }
    // 製造基地：一定時間ごとにマイクロマシンを出す（倒し方は未定。TBD-06-12。試作の仮）
    if (t.produce && l.stepIndex < t.steps.length - 1) {
      l.spawned = l.spawned.filter(x => !x.done);
      if ((l.produceLeft -= dt) <= 0) {
        l.produceLeft = t.produce.every_sec;
        if (l.spawned.length < t.produce.max_alive) {
          const kind = t.produce.kinds[Math.floor(Math.random() * t.produce.kinds.length)];
          const a = Math.random() * Math.PI * 2;
          const q = { x: clamp(l.origin.x + Math.cos(a) * 9, 6, 93), y: clamp(l.origin.y + Math.sin(a) * 9, 6, 43) };
          l.spawned.push(this.spawn({ id: l.id + '_mm' + Math.floor(this.time * 1000), lesion: kind, position: [q.x, q.y] }, true));
          this.app.sound.se('lesion_appear', { vol: 0.6 });
        }
      }
    }
  }
  // ---------------- バイタルの減少と回復（spec/03 1.2・1.3） ----------------
  decay(dt) {
    const stretch = this.anesthesia > 0 ? Math.max(1, this.drugInfo('anesthesia').decay_interval_stretch * this.coef('anesthesia_stretch')) : 1;
    // 麻酔の効き始め・切れ目は、減少のタイマーを計り直す（H10）
    const on = this.anesthesia > 0;
    if (on !== this.anesOn) { this.anesOn = on; this.decayAcc = 0; for (const l of this.lesions) l.decayTimer = 0; }
    if (this.anesthesia > 0) this.anesthesia = Math.max(0, this.anesthesia - dt);
    const nd = this.stage.natural_decay;
    if (nd) {
      this.decayAcc += dt / (nd.interval_sec / this.coef('decay') * stretch);
      while (this.decayAcc >= 1) { this.decayAcc -= 1; this.vital -= nd.amount; }
    }
    for (const l of this.lesions) {
      const vd = l.type.vital_drain;
      if (!vd || l.done || l.generated) continue;   // 実行時に生成された病巣（空振りの切り傷など）はバイタル減少を持たない
      l.decayTimer += dt / (vd.interval_sec / this.coef('decay') * stretch);
      while (l.decayTimer >= 1) { l.decayTimer -= 1; this.vital -= vd.amount; }
    }
  }
  recover(dt) {
    const hj = this.ins.healjelly;
    // 使ったストックは1つずつ順番に戻る（1つあたり10秒（仮）。塗っている間も止めない。P101）
    if (this.stock < hj.stock_max) {
      this.stockTimer += dt;
      const T = hj.stock_return_sec / this.coef('recover');
      if (this.stockTimer >= T) { this.stockTimer -= T; this.stock++; if (this.stock >= hj.stock_max) this.stockTimer = 0; }
    } else this.stockTimer = 0;
    // 注射のゲージは薬ごとに回復する（空から満タンまで30秒。注入中の薬だけ止める。P102）
    const injecting = this.op && this.op.type === 'inject' ? this.drug : null;
    for (const d of Object.keys(this.gauges)) if (d !== injecting) this.gauges[d] = Math.min(100, this.gauges[d] + dt * 100 / (this.ins.injector.gauge_recover_sec / this.coef('recover')));
  }
  // ---------------- 字幕 ----------------
  // 複数のセリフは約5秒ごとに次へ。最後のセリフは次のきっかけまで出したまま（P103・P104）
  updateSubs(dt) {
    if (!this.subCur) return;
    this.subCur.t += dt;
    if (this.subs.length && this.subCur.t >= (this.data.system.subtitle_next_sec ?? 5)) this.subCur = { ...this.subs.shift(), t: 0 };
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
    const step = this.step, i = this.stepIndex;
    if (this.training) {
      if (i < this.stage.steps.length - 1) { this.enterStep(i + 1); return; }
      const tr = this.training;
      tr.index++;
      if (tr.index >= tr.queue.length) { this.end = { kind: 'clear', t: 0 }; return; }
      this.stage = this.app.trainingStage(tr.queue[tr.index]);   // ランダムモード：次の項目へ（バイタルなどは引き継ぐ）
      this.enterStep(0);
      return;
    }
    const last = i >= this.stage.steps.length - 1;
    const proceed = () => {
      if (step.continue_point_after && !last) this.app.reachContinue(this.ctx, i + 1, this.flags);
      if (last) { this.end = { kind: 'clear', t: 0 }; this.app.sound.se('clear'); return; }
      this.enterStep(i + 1);
    };
    // 途中のステップの治療後の会話は、止める会話としてステップの間に出す（H2）
    // 最後のステップの後の会話も、クリアの前に出す（試作の仮。scenario.md の最後の「会話」）
    if (step.dialogue_after_step) this.startOverlayTalk(step.dialogue_after_step, 'stop', proceed);
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
    // ゲームオーバー：約1.5秒、平坦の波形と音を見せてから会話（H3）
    if (e.cause !== 'timeout') this.ecg.update(dt, 0, false);
    if (this.training && e.t > 3) { this.app.toTrainingSelect(); return; }   // トレーニングは会話を挟まずに戻る（H4）
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
    if (this.op && this.op.type === 'grab' && this.op.connect) {
      // 血管の端を持ち上げて引っ張る（血管接合）
      const a = toLogical(this.op.connect.from), p = this.op.pos;
      c.save(); c.strokeStyle = '#b3202a'; c.lineWidth = 16; c.lineCap = 'round';
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(p.x, p.y); c.stroke();
      c.strokeStyle = 'rgba(255,170,170,0.6)'; c.lineWidth = 5; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(p.x, p.y); c.stroke(); c.restore();
    } else if (this.op && this.op.type === 'grab') {
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
    const fb = (this.patient && this.patient.fallback_images) || [];   // 画像が無いとき（公開しない画像など）は代わりの画像
    const im = this.app.img(imgs[frame] || imgs[0]) || this.app.img(fb[frame] || fb[0]);
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
        const nm = l.step ? (l.step.instrument === 'taping' ? 'テーピング' : l.step.instrument === 'petals' ? '注射・ピンセット（花びら）' : this.ins[l.step.instrument].name) + (l.step.optional ? '（省略可）' : '') : '';
        text(c, (this.isBlocked(l) ? '［血溜まり］' : '') + nm, at.x, at.y + 30, { size: 24, align: 'center', color: '#ff0', shadow: true });
      }
    }
    if (this.app.save.options.guide !== false && !this.end) this.drawGuides(c);
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
  // 操作ガイドの矢印（spec/05 2.9）：選んでいる機器で、今の段階を処置できる病巣だけに出す。病巣のデータから自動で決める
  drawGuides(c) {
    const inst = this.selected === 'tape' ? 'taping' : this.selected;
    const pulse = 0.55 + 0.45 * Math.sin(this.flashAcc * 5);
    const col = `rgba(255,226,122,${0.55 + 0.35 * pulse})`;
    const L = q => toLogical(q);
    const ring = (q, r) => { const p = L(q); c.strokeStyle = col; c.lineWidth = 4; c.setLineDash([10, 8]); c.beginPath(); c.arc(p.x, p.y, r * AREA.cell * (0.9 + 0.2 * pulse), 0, Math.PI * 2); c.stroke(); c.setLineDash([]); };
    c.save();
    for (const l of this.lesions) {
      if (l.done) continue;
      if (inst === 'drain') { if (l.isPool) ring(l.origin, l.radius + 1); else if (l.step && l.step.instrument === 'drain' && !this.isBlocked(l)) ring(l.origin, 2.5); continue; }
      if (l.step && l.step.instrument === 'petals') {    // 花びら：同じ色の薬を選んでいれば注射する花びら、ピンセットなら硬化した花びら
        for (const pe of l.petals) if (inst === 'injector' ? (!pe.hard && pe.drug === this.drug) : (inst === 'tweezers' && pe.hard)) ring(petalPos(l, pe), 2);
        continue;
      }
      if (inst === 'injector' && l.curInject && l.step.drug === this.drug) { ring(l.curInject, 2.2); continue; }
      if (l.isPool || this.isBlocked(l)) continue;
      const sf = this.stepFor(l, inst);
      if (!sf) continue;
      const k = l.stepIndex + (sf.skip ? 1 : 0), step = l.type.steps[k], geo = l.stepGeo[k] || {};
      const path = this.pathOf(l, sf.skip);
      if (inst === 'scalpel' && path) {
        const closed = step.path ? !!step.path_closed : !!l.type.path_closed;
        const pts = closed ? [...path, path[0]] : path;
        this.guideArrow(c, pts.map(L), col);
        ring(pts[0], 1);                                  // 切り始めの位置
      } else if (inst === 'needle' && path) {
        this.guideArrow(c, zigzag(path, this.ins.needle.tolerance * 0.6).map(L), col);
      } else if (inst === 'tweezers') {
        if (geo.tap) geo.tap.forEach((q, i) => { if (!(k === l.stepIndex && l.tapped.has(i))) ring(q, 1.4); });
        else if (geo.connect) this.guideArrow(c, geo.connect.map(L), col);
        else if (step.dest === 'tray') {
          const from = L({ x: l.bounds.cx, y: l.bounds.cy }), to = { x: this.oppX + COL_W / 2, y: 550 };
          this.guideArrow(c, [from, to], col);
        }
      } else if (inst === 'taping') {
        const ln = path || (l.hit.find(h => h.type === 'line') || {}).points;
        if (ln) this.guideArrow(c, [L(ln[0]), L(ln[ln.length - 1])], col, 10);
      } else {
        ring({ x: l.bounds.cx, y: l.bounds.cy }, Math.max(2, (l.bounds.x1 - l.bounds.x0) / 2 + 0.5));   // ヒールゼリー・注射：使う場所を指す印
      }
    }
    c.restore();
  }
  guideArrow(c, pts, col, width = 5) {
    if (pts.length < 2) return;
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
    c.setLineDash([16, 10]); c.lineDashOffset = -this.flashAcc * 40;
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke();
    c.setLineDash([]); c.lineDashOffset = 0;
    const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x), s = 14 + width * 2;
    c.beginPath(); c.moveTo(b.x, b.y);
    c.lineTo(b.x - s * Math.cos(ang - 0.45), b.y - s * Math.sin(ang - 0.45));
    c.lineTo(b.x - s * Math.cos(ang + 0.45), b.y - s * Math.sin(ang + 0.45)); c.closePath(); c.fill();
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
      if (id === 'injector') {                       // 選んでいる薬の限度量に合わせる（P102）
        const pd = this.dose[this.patientId] || {}, lim = this.doseLimit(this.drug);
        if (lim) red = (pd[this.drug] || 0) / lim;
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
      if (id === 'healjelly') {
        // ストックを瓶で表す（■＝使える、□＝戻り待ち。いま計っている瓶は下から満ちていく。P101）
        const T = I.stock_return_sec / this.coef('recover');
        for (let k = 0; k < I.stock_max; k++) {
          const f = k < this.stock ? 1 : k === this.stock ? this.stockTimer / T : 0;
          drawBottle(c, x + 140 + k * 21, y + 88, 16, 34, f, '#7fe8ff');
        }
      }
      if (id === 'injector') {
        drawBottle(c, x + 214, y + 84, 22, 46, this.gauge / 100, DRUG_COLOR[this.drug]);   // 選んでいる薬のゲージ（P102）
        text(c, this.drugInfo().short, x + 140, y + 118, { size: 24, color: '#9cf' });
      }
    });
  }
  highlights() {
    const hl = {};
    const set = (id, kind) => { if (id && id !== 'taping' && hl[id] !== 'main') hl[id] = kind; };
    for (const l of this.lesions) {
      if (l.done || !l.step) continue;
      if (this.isBlocked(l)) { set('drain', 'main'); continue; }
      if (l.step.instrument === 'petals') { set('injector', 'main'); set('tweezers', 'main'); continue; }
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
      drawBottle(c, b.x + b.w - 26, b.y + 12, 16, b.h - 24, this.gauges[b.id] / 100, DRUG_COLOR[b.id]);   // 薬ごとのゲージ（P102）
      if (lim) text(c, `${Math.round(pd[b.id] || 0)}/${Math.round(lim)}`, b.x + b.w / 2 - 12, b.y + b.h - 8, { size: 18, align: 'center', color: '#fcc' });
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
    wrapText(c, s.text, x + 230, y + (s.text.includes('\n') ? 100 : 115), w - 260, 50, { size: 40 });
  }
}

// 線に沿ったジグザグ（縫合針のガイド）
function zigzag(path, amp) {
  const out = [];
  let side = 1;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], len = dist(a, b), n = Math.max(1, Math.round(len / 2));
    const nx = -(b.y - a.y) / (len || 1), ny = (b.x - a.x) / (len || 1);
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      out.push({ x: a.x + (b.x - a.x) * t + nx * amp * side, y: a.y + (b.y - a.y) * t + ny * amp * side });
      side = -side;
    }
  }
  return out;
}

function gradeColor(g) { return { Cool: '#5ff0ff', Good: '#7dff8a', Fine: '#ffe36b', Bad: '#ff7a7a' }[g] || '#fff'; }

// ストックの瓶・薬のゲージ（下から満ちていく。P101・P102）
function drawBottle(c, x, y, w, h, f, color) {
  roundRect(c, x, y, w, h, 4); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
  const fh = h * clamp(f, 0, 1);
  if (fh > 0) { c.save(); roundRect(c, x, y, w, h, 4); c.clip(); c.fillStyle = color; c.globalAlpha = f >= 1 ? 1 : 0.55; c.fillRect(x, y + h - fh, w, fh); c.restore(); }
  c.strokeStyle = f >= 1 ? '#fff' : 'rgba(255,255,255,0.6)'; c.lineWidth = 2; roundRect(c, x, y, w, h, 4); c.stroke();
}
