// ゲーム画面（spec/02 3.4、spec/03、spec/04、spec/05）
import { W, H } from '../core/view.js';
import { text, wrap, panel, img, Button, font } from '../core/ui.js';
import { Lesion } from '../game/lesion.js';
import { TOOLS } from '../game/tools.js';
import { COLS, ROWS, key, pathLength, dist } from '../game/geometry.js';

const CELL = 14, TOP = 190, SIDE = 260, AREA_W = 1400, AREA_H = 700;
const TOOL_H = (H - TOP) / 6;

export class Surgery {
  constructor(app, run) {
    this.app = app; this.run = run; this.sound = app.sound;
    this.inst = app.data.instruments; this.lesionDefs = app.data.lesions;
    this.stage = structuredClone(run.stage); this.diff = run.difficulty;   // 字幕の表示済みの印を付けるので複製する
    this.left = app.save.options.side === 'left';
    this.areaX = this.left ? SIDE : W - SIDE - AREA_W;
    this.colX = this.left ? 0 : W - SIDE;
    this.blankX = this.left ? W - SIDE : 0;
    // 状態
    this.vital = this.stage.vitalStart;
    this.timeLeft = this.stage.timeLimit * this.coef('timeLimit');
    this.tool = 'gel';                                          // 開始時はヒールゼリー
    this.drug = this.inst.syringe.defaultDrug;                  // 開始直後は回復剤（M25）
    this.gelStock = this.inst.gel.stock; this.gelRegen = 0;
    this.gauge = this.inst.syringe.gaugeMax;
    this.anesthesia = 0; this.doses = {}; this.warned = {};
    this.misses = 0; this.lesions = []; this.decor = []; this.fxs = []; this.subs = []; this.sub = null;
    this.highlight = null; this.stepIdx = -1; this.declineT = 0; this.elapsed = 0;
    this.paused = false; this.over = false; this.showTray = false; this.op = null; this.hint = true; this.grid = false;
    this.hoverP = { x: -1, y: -1 }; this.beat = 0;
    this.menuButtons = [
      new Button(760, 420, 400, 90, '再開', () => { this.paused = false; }),
      new Button(760, 530, 400, 90, 'リトライ', () => app.retry()),
      new Button(760, 640, 400, 90, 'タイトルに戻る', () => app.toTitle()),
    ];
    this.nextStep();
    this.sound.bgm('surgery');
  }
  // 係数：基本値 × ステージ係数 × 難易度係数（spec/03 6章）
  coef(k) { return (this.stage.coef?.[k] ?? 1) * (this.diff.coef?.[k] ?? 1); }

  // ---- 座標 ----
  toCell(p) { return [(p.x - this.areaX) / CELL, (p.y - TOP) / CELL]; }
  toPx(c) { return { x: this.areaX + c[0] * CELL, y: TOP + c[1] * CELL }; }
  inArea(p) { return p.x >= this.areaX && p.x < this.areaX + AREA_W && p.y >= TOP && p.y < TOP + AREA_H; }
  trayRect() { return { x: this.blankX + 20, y: TOP + 240, w: SIDE - 40, h: 420 }; }
  inTray(p) { const r = this.trayRect(); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }
  toolRect(i) { return { x: this.colX + 10, y: TOP + i * TOOL_H + 6, w: SIDE - 20, h: TOOL_H - 12 }; }
  drugButtons() {
    if (this.tool !== 'syringe') return [];
    const r = this.toolRect(5), ids = Object.keys(this.inst.syringe.drugs);
    return ids.map((id, k) => ({ id, x: this.left ? r.x + r.w + 16 + k * 130 : r.x - 16 - (k + 1) * 130, y: r.y + r.h / 2 - 34, w: 120, h: 68 }));
  }
  lesionAt(pc) {
    const i = Math.floor(pc[0]), j = Math.floor(pc[1]);
    return this.lesions.find(l => !l.done && !l.held && l.has(i, j)) || null;
  }

  // ---- 結果の処理 ----
  damage(amount, kind, tool, pc, why) {
    const v = amount * this.coef('damage');
    if (v <= 0) return;
    this.vital -= v;
    if (kind !== 'skip') this.misses += 1;
    const s = this.inst[tool].sounds; this.sound.se(kind === 'miss' ? (s.miss || s.fail) : s.fail);
    this.fx(`${why}  -${fmt(v)}`, pc, '#ff7070');
  }
  heal(amount, pc, quiet = false) {
    const v = amount * this.coef('heal');
    this.vital = Math.min(99, this.vital + v);
    if (!quiet && pc) this.fx(`+${fmt(v)}`, pc, '#7dff9a');
  }
  invalid(tool, pc, why) { this.sound.se(this.inst[tool].sounds.invalid); this.fx(`無効：${why}`, pc, '#c8c8c8'); }
  succeed(l, skip, pc) {
    const st = skip ? l.def.steps[l.stepIdx + 1] : l.step;
    const heal = st.heal ?? (st.tool === 'gel' ? this.inst.gel.successHealDefault : 0);
    if (heal) this.heal(heal, pc); else this.fx('成功', pc, '#9fe0ff');
    l.advance(skip);
    this.sound.se(l.done ? l.def.sounds.done : l.def.sounds.step);
    this.fireTexts(l.done ? { on: 'done', id: l.id } : { on: 'step', id: l.id, step: l.stepIdx });
  }
  addDose(drug, amt) {
    this.doses[drug] = (this.doses[drug] || 0) + amt;
    const lim = this.limitOf(drug); if (lim == null) return;
    const d = this.inst.syringe.drugs[drug];
    if (!this.warned[drug] && this.doses[drug] >= lim * (d.warnRatio ?? 0.7)) {
      this.warned[drug] = true; this.sound.se('alarm');
      this.say(`（警告）${d.name}の投与量が限度に近い`);
    }
    if (this.doses[drug] > lim) this.finish('overdose', `${d.name}の投与量が限度を超えた`);
  }
  // 限度量：医療機器データの既定値を、ステージデータの患者ごとに上書き（M35）
  limitOf(drug) { return this.stage.patient?.drugLimits?.[drug] ?? this.inst.syringe.drugs[drug].defaultLimit ?? null; }
  spawnSmallCut(trail) {
    // 空振りの軌跡に沿って小さな切り傷を出す。ほかの病巣と重なる場所には出さない（M17）
    const pts = [trail[0]]; let len = 0;
    for (let i = 1; i < trail.length && len < this.inst.scalpel.missSpawnMaxLength; i++) {
      len += dist(trail[i - 1], trail[i]);
      if (dist(pts[pts.length - 1], trail[i]) >= 3) pts.push(trail[i]);
    }
    if (pts.length < 2) pts.push(trail[trail.length - 1]);
    const pl = { id: 'cut' + Math.random().toString(36).slice(2, 7), type: this.inst.scalpel.missSpawn, shape: { line: pts.map(p => [p[0] - 0.5, p[1] - 0.5]) } };
    const l = new Lesion(pl, this.lesionDefs[pl.type]);
    for (const o of this.lesions) if (!o.done && [...l.cells].some(k => o.cells.has(k))) return;
    if ([...l.cells].length === 0) return;
    this.lesions.push(l); this.sound.se(l.def.sounds.appear);
    this.say('（切り傷ができた）');
  }
  fx(t, pc, color) { const p = pc ? this.toPx(pc) : { x: this.areaX + AREA_W / 2, y: TOP + 40 }; this.fxs.push({ t, x: p.x, y: p.y, color, life: 1.6 }); }

  // ---- ステップと病巣の出現 ----
  cond(c) { return !c || this.run.flags[c.flag] === c.eq; }
  nextStep() {
    this.stepIdx += 1; this.stepT = 0; this.stepClearT = null;
    const st = this.stage.steps[this.stepIdx];
    this.bg = st.bg; this.lesions = []; this.decor = [];
    this.pending = st.lesions.filter(p => this.cond(p.cond));
    this.texts = st.texts || [];
    this.fireTexts({ on: 'start' });
    this.checkAppear();
  }
  checkAppear() {
    const doneIds = new Set(this.lesions.filter(l => l.done).map(l => l.id));
    const ready = this.pending.filter(p => p.appear === 'start' || (p.appear.afterSec != null && this.stepT >= p.appear.afterSec)
      || (p.appear.after && p.appear.after.every(id => doneIds.has(id) || !this.stage.steps[this.stepIdx].lesions.find(q => q.id === id && this.cond(q.cond)))));
    for (const p of ready) {
      this.pending.splice(this.pending.indexOf(p), 1);
      const l = new Lesion(p, this.lesionDefs[p.type]); this.lesions.push(l);
      this.sound.se(l.def.sounds.appear);
      this.fireTexts({ on: 'appear', id: p.id });
    }
  }
  fireTexts(ev) {
    for (const t of this.texts) if (t.on === ev.on && (t.id == null || t.id === ev.id) && (t.step == null || t.step === ev.step) && !t._fired) {
      t._fired = true; this.say(t.text, t.highlight);
    }
  }
  say(s, highlight) { this.subs.push({ s, highlight }); }

  // ---- 入力 ----
  down(p) {
    if (this.over) return;
    this.sound.unlock();
    if (this.paused) { const b = this.menuButtons.find(b => b.hit(p)); if (b) { this.sound.se('select'); b.onClick(); } return; }
    // メニュー
    if (p.x >= this.colX && p.x < this.colX + SIDE && p.y < TOP) { this.paused = true; this.sound.se('select'); this.sound.stopLoops(); return; }
    // 薬のボタン（注射アイコンの横。M25）
    const db = this.drugButtons().find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (db) { this.drug = db.id; this.sound.se('select'); return; }
    // 医療機器の持ち替え
    if (p.x >= this.colX && p.x < this.colX + SIDE) {
      const i = Math.floor((p.y - TOP) / TOOL_H);
      if (i >= 0 && i < 6) this.selectTool(this.inst.order[i]);
      return;
    }
    // 手術エリアの外（空白エリア、バイタル、字幕）では何も起きない（M3）
    if (!this.inArea(p)) return;
    this.op = new TOOLS[this.tool](this, p, this.toCell(p));
    this.opP = p;
  }
  move(p) { this.hoverP = p; if (this.op) { this.opP = p; this.op.move(p, this.toCell(p)); } }
  hoverAt(p) { this.hoverP = p; }
  up(p) { if (this.op) { const op = this.op; this.op = null; op.end(p, this.toCell(p)); } }
  selectTool(id) {
    if (this.op || this.app.view.pressing && this.op) return;    // 操作中は持ち替えない（M6）
    this.tool = id; this.sound.se('select');
    if (this.highlight === id) this.highlight = null;
  }
  key(k) {
    if (this.over) return;
    if (k === 'Escape') { this.paused = !this.paused; this.sound.stopLoops(); return; }
    if (this.paused) return;
    if (k >= '1' && k <= '6' && !this.op) this.selectTool(this.inst.order[+k - 1]);
    if (k === 'h' || k === 'H') this.hint = !this.hint;
    if (k === 'g' || k === 'G') this.grid = !this.grid;
  }

  // ---- 更新 ----
  update(dt) {
    for (const f of this.fxs) { f.life -= dt; f.y -= 30 * dt; }
    this.fxs = this.fxs.filter(f => f.life > 0);
    if (this.paused || this.over) return;
    this.elapsed += dt; this.stepT += dt;
    this.timeLeft -= dt;
    // バイタルの減少（自然減少と病巣ごとに独立したタイマー。麻酔中は緩和）
    const rate = this.anesthesia > 0 ? this.inst.syringe.drugs.anesthesia.declineRate : 1;
    this.declineT += dt;
    const d = this.stage.decline;
    while (this.declineT >= d.intervalSec) { this.declineT -= d.intervalSec; this.vital -= d.amount * this.coef('decline') * rate; }
    for (const l of this.lesions) {
      if (l.done || !l.def.decline) continue;
      l.declineT += dt;
      while (l.declineT >= l.def.decline.intervalSec) { l.declineT -= l.def.decline.intervalSec; this.vital -= l.def.decline.amount * this.coef('decline') * rate; }
    }
    this.anesthesia = Math.max(0, this.anesthesia - dt);
    // ストック・ゲージの回復
    if (this.gelStock < this.inst.gel.stock) {
      this.gelRegen += dt;
      if (this.gelRegen >= this.inst.gel.stockRegenSec) { this.gelRegen = 0; this.gelStock += 1; }
    } else this.gelRegen = 0;
    const sy = this.inst.syringe;
    if (!(this.op && this.tool === 'syringe')) this.gauge = Math.min(sy.gaugeMax, this.gauge + sy.gaugeMax / sy.gaugeRegenSec * dt);
    // 操作
    for (const l of this.lesions) l.sucking = false;
    this.op?.update(dt);
    // 血溜まり・膿の自然増（吸っていないとき）
    for (const l of this.lesions) if (!l.done && l.step.tool === 'drain' && !l.sucking) l.amount = Math.min(l.step.max, l.amount + (l.step.regenPerSec || 0) * dt);
    // 字幕
    if (this.sub) { this.sub.t -= dt; if (this.sub.t <= 0) this.sub = null; }
    if (!this.sub && this.subs.length) {
      const s = this.subs.shift(); this.sub = { ...s, t: Math.max(2.5, s.s.length * 0.14) };
      if (s.highlight) this.highlight = s.highlight;
      this.sound.se('text');
    }
    // 出現とステップのクリア
    this.checkAppear();
    if (!this.pending.length && this.lesions.every(l => l.done)) {
      if (this.stepClearT == null) this.stepClearT = 1.5;
      this.stepClearT -= dt;
      if (this.stepClearT <= 0) {
        if (this.stepIdx + 1 < this.stage.steps.length) this.nextStep(); else this.finish('clear');
      }
    }
    // 終了条件
    if (this.vital <= 0) { this.vital = 0; this.finish('vital'); }
    else if (this.timeLeft <= 0) { this.timeLeft = 0; this.finish('time'); }
  }
  finish(reason, detail) {
    if (this.over) return;
    this.over = true; this.op = null; this.sound.stopLoops();
    this.sound.se(reason === 'clear' ? 'clear' : 'gameover');
    setTimeout(() => this.app.surgeryEnded(reason, {
      vital: Math.ceil(this.vital), timeLeft: this.timeLeft, misses: this.misses, detail,
    }), 900);
  }

  // ---- 描画 ----
  draw(c) {
    c.fillStyle = '#0d1116'; c.fillRect(0, 0, W, H);
    this.drawArea(c);
    this.drawTools(c);
    this.drawVital(c);
    this.drawTimer(c);
    this.drawBlank(c);
    this.drawSubtitle(c);
    this.drawDrugButtons(c);
    for (const f of this.fxs) text(c, f.t, f.x, f.y, { size: 30, color: f.color, align: 'center', bold: true });
    if (this.paused) {
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, W, H);
      text(c, 'メニュー（一時停止中）', W / 2, 360, { size: 48, align: 'center' });
      for (const b of this.menuButtons) b.draw(c, b.hit(this.hoverP));
    }
  }
  drawArea(c) {
    const x = this.areaX;
    c.save(); c.beginPath(); c.rect(x, TOP, AREA_W, AREA_H); c.clip();
    // 呼吸・拍動のアニメーション（バイタルと麻酔でテンポが変わる）
    const tempo = this.anesthesia > 0 ? 0.6 : this.vital > 50 ? 1 : this.vital > 25 ? 1.6 : 2.4;
    this.beat += 0.016 * tempo;
    const frame = [0, 1, 2, 1][Math.floor(this.beat * 2.5) % 4];
    const bg = img(`patient_${this.bg === 'internal' ? 'internal' : 'skin'}_${frame}`);
    if (bg) c.drawImage(bg, x, TOP, AREA_W, AREA_H); else { c.fillStyle = '#3a2a26'; c.fillRect(x, TOP, AREA_W, AREA_H); }
    if (this.grid) {
      c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1;
      for (let i = 0; i <= COLS; i++) { c.beginPath(); c.moveTo(x + i * CELL, TOP); c.lineTo(x + i * CELL, TOP + AREA_H); c.stroke(); }
      for (let j = 0; j <= ROWS; j++) { c.beginPath(); c.moveTo(x, TOP + j * CELL); c.lineTo(x + AREA_W, TOP + j * CELL); c.stroke(); }
    }
    for (const d of this.decor) this.drawCircle(c, d.at, d.r, d.color, 0.9);
    for (const l of this.lesions) this.drawLesion(c, l);
    c.restore();
    // 持っている物・操作の表示（手術エリアの外まで描く）
    for (const l of this.lesions) if (l.held && l.heldAt) this.drawObject(c, l, l.heldAt);
    if (this.op && this.opP) this.op.drawCursor(c, this, this.opP);
    else if (this.inArea(this.hoverP) && !this.app.view.pressing) this.drawBrush(c, this.hoverP, this.tool === 'gel' ? this.inst.gel.brushRadius : 1, 'rgba(255,255,255,0.18)');
    c.strokeStyle = '#2d3a48'; c.lineWidth = 3; c.strokeRect(x, TOP, AREA_W, AREA_H);
  }
  drawLesion(c, l) {
    if (l.done) return;
    const st = l.step, col = l.def.color;
    // ヒットエリア（掴んでいる間は薄く表示する）
    c.fillStyle = hexA(col, l.held ? 0.15 : 0.55);
    for (const k of l.cells) { const [i, j] = k.split(',').map(Number); c.fillRect(this.areaX + i * CELL, TOP + j * CELL, CELL, CELL); }
    if (l.kind === 'line') this.drawLine(c, l.pts, col, 4);
    if (l.cutDone) this.drawLine(c, l.pts, '#300', 3);
    // 段階ごとの表示
    if (st.tool === 'drain') {
      const a = l.amount / st.max;
      c.fillStyle = `rgba(150,0,0,${0.35 + 0.5 * a})`;
      for (const k of l.cells) { const [i, j] = k.split(',').map(Number); c.fillRect(this.areaX + i * CELL, TOP + j * CELL, CELL, CELL); }
      const p = this.toPx(l.center); this.bar(c, p.x - 40, p.y - 40, 80, 10, a, '#ff5050');
    }
    if (st.tool === 'tweezers' && !l.held) this.drawObject(c, l, l.center);
    if (st.tool === 'tweezers' && st.dest === 'fixed' && l.held) { this.drawCircle(c, l.dest, this.inst.tweezers.destRange, '#ffffff', 0.25); const p = this.toPx(l.dest); text(c, 'ここへ', p.x, p.y - 34, { size: 24, align: 'center' }); }
    const sc = l.stepFor('scalpel');
    if (sc) {
      const pts = sc.step.closed ? ringPts(l) : l.pts;
      c.setLineDash([8, 8]); this.drawLine(c, sc.step.closed ? [...pts, pts[0]] : pts, '#ffffff', 2); c.setLineDash([]);
      pts.forEach((q, i) => {
        const end = !sc.step.closed && (i === 0 || i === pts.length - 1);
        this.drawCircle(c, q, this.inst.scalpel.pointRange, end ? '#ffe08a' : '#ffffff', end ? 0.45 : 0.25);
      });
    }
    if (st.tool === 'suture') {
      c.setLineDash([4, 6]); this.drawLine(c, l.pts, '#fff2c8', 2); c.setLineDash([]);
      for (const q of l.pts) this.drawCircle(c, q, 0.6, '#fff2c8', 0.7);
    }
    for (const m of l.stitches) this.drawMark(c, m);
    if (st.tool === 'syringe') { const p = this.toPx(l.center); this.bar(c, p.x - 40, p.y - 50, 80, 10, l.injected / st.need, '#7dff9a'); }
    if (this.hint) {
      const p = this.toPx(l.kind === 'line' ? l.pts[0] : l.center);
      const tools = l.activeTools().map(t => this.inst[t].name).join(' / ');
      text(c, `${l.def.name}：${st.label ? st.label + '・' : ''}${tools}`, p.x, p.y - (l.radius || 1) * CELL - 14, { size: 22, color: '#ffffff', align: 'center' });
    }
  }
  drawObject(c, l, at) {
    const p = this.toPx(at), r = (l.radius || 1.4) * CELL;
    c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.fillStyle = l.typeId === 'vessel' ? '#d04060' : l.typeId === 'tumor' ? '#8fa04a' : '#b8c2cc'; c.fill();
    c.strokeStyle = '#222'; c.lineWidth = 2; c.stroke();
  }
  drawLine(c, pts, color, w) {
    c.beginPath(); pts.forEach((q, i) => { const p = this.toPx(q); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); });
    c.strokeStyle = color; c.lineWidth = w; c.stroke();
  }
  drawCircle(c, at, r, color, alpha) {
    const p = this.toPx(at); c.beginPath(); c.arc(p.x, p.y, r * CELL, 0, Math.PI * 2); c.fillStyle = hexA(color, alpha); c.fill();
  }
  drawBrush(c, p, r, color, covered) {
    if (covered) { c.fillStyle = 'rgba(120,220,255,0.25)'; for (const k of covered) { const [i, j] = k.split(',').map(Number); if (i >= 0 && j >= 0 && i < COLS && j < ROWS) c.fillRect(this.areaX + i * CELL, TOP + j * CELL, CELL, CELL); } }
    c.beginPath(); c.arc(p.x, p.y, r * CELL, 0, Math.PI * 2); c.fillStyle = color; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2; c.stroke();
  }
  drawTrail(c, trail, color) { this.drawLine(c, trail, color, 3); }
  drawVisited(c, e) { for (const i of e.visited) this.drawCircle(c, e.pts[i], 0.9, '#7dff9a', 0.9); }
  drawMark(c, m) { const p = this.toPx(m); c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(p.x - 7, p.y - 7); c.lineTo(p.x + 7, p.y + 7); c.moveTo(p.x + 7, p.y - 7); c.lineTo(p.x - 7, p.y + 7); c.stroke(); }
  fxAt(c, p, s) { text(c, s, p.x + 30, p.y - 30, { size: 30, bold: true }); }
  bar(c, x, y, w, h, r, color) { c.fillStyle = '#111'; c.fillRect(x, y, w, h); c.fillStyle = color; c.fillRect(x, y, w * Math.max(0, Math.min(1, r)), h); }

  drawTools(c) {
    const x = this.colX;
    c.fillStyle = '#151b22'; c.fillRect(x, 0, SIDE, H);
    panel(c, x + 10, 10, SIDE - 20, TOP - 20, { fill: '#1f2833' });
    text(c, 'Menu', x + SIDE / 2, TOP / 2 + 4, { size: 40, align: 'center', base: 'middle' });
    const blink = Math.floor(this.elapsed * 3) % 2 === 0;
    this.inst.order.forEach((id, i) => {
      const r = this.toolRect(i), sel = this.tool === id, hl = this.highlight === id;
      panel(c, r.x, r.y, r.w, r.h, { fill: sel ? '#2f6f8f' : '#1f2833', stroke: hl && blink ? '#ffe08a' : sel ? '#9fe0ff' : '#3a4756', lw: hl ? 6 : 2 });
      const ic = img(this.inst[id].icon); if (ic) c.drawImage(ic, r.x + 8, r.y + (r.h - 90) / 2, 90, 90);
      text(c, `${i + 1}`, r.x + 12, r.y + 26, { size: 20, color: '#8aa' });
      text(c, this.inst[id].name, r.x + 106, r.y + 42, { size: 24 });
      if (id === 'gel') { for (let k = 0; k < this.inst.gel.stock; k++) this.drawDot(c, r.x + 116 + k * 22, r.y + 80, k < this.gelStock); if (this.gelStock < this.inst.gel.stock) this.bar(c, r.x + 106, r.y + 100, 110, 6, this.gelRegen / this.inst.gel.stockRegenSec, '#9fe0ff'); }
      if (id === 'syringe') { this.bar(c, r.x + 106, r.y + 70, 120, 14, this.gauge / this.inst.syringe.gaugeMax, '#7dff9a'); text(c, this.inst.syringe.drugs[this.drug].name, r.x + 106, r.y + 112, { size: 22, color: '#cfe' }); }
    });
  }
  // 薬のボタン（M25）。注射アイコンの横（字幕エリアの上に重なる）
  drawDrugButtons(c) {
    for (const b of this.drugButtons()) {
      const d = this.inst.syringe.drugs[b.id], lim = this.limitOf(b.id), used = this.doses[b.id] || 0;
      const warn = lim != null && used >= lim * (d.warnRatio ?? 0.7);
      panel(c, b.x, b.y, b.w, b.h, { fill: b.id === this.drug ? '#2f6f8f' : 'rgba(20,26,34,0.92)', stroke: warn ? '#ff6060' : b.id === this.drug ? '#9fe0ff' : '#5b6b7d', lw: b.id === this.drug ? 4 : 2 });
      text(c, d.short, b.x + b.w / 2, b.y + 30, { size: 26, align: 'center', base: 'middle' });
      if (lim != null) this.bar(c, b.x + 10, b.y + b.h - 16, b.w - 20, 6, used / lim, warn ? '#ff6060' : '#ffe08a');
    }
  }
  drawDot(c, x, y, on) { c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.fillStyle = on ? '#9fe0ff' : '#334'; c.fill(); }
  drawVital(c) {
    const x = this.areaX, v = Math.max(0, this.vital);
    c.fillStyle = '#10151b'; c.fillRect(x, 0, AREA_W, TOP);
    const color = v > 50 ? '#3fcf6a' : v > 25 ? '#e0c040' : '#e04545';
    text(c, 'VITAL', x + 40, 70, { size: 30, color: '#8aa' });
    text(c, String(Math.ceil(v)), x + 40, 150, { size: 72, color, bold: true });
    this.bar(c, x + 220, 80, 1120, 50, v / 99, color);
    if (this.anesthesia > 0) text(c, `麻酔 ${this.anesthesia.toFixed(1)}秒`, x + 220, 60, { size: 26, color: '#b0a0ff' });
    text(c, `${this.stage.name}　${this.diff.name}　ステップ ${this.stepIdx + 1}/${this.stage.steps.length}`, x + AREA_W - 20, 60, { size: 24, color: '#8aa', align: 'right' });
  }
  drawTimer(c) {
    const x = this.blankX;
    c.fillStyle = '#10151b'; c.fillRect(x, 0, SIDE, TOP);
    const t = Math.max(0, Math.ceil(this.timeLeft));
    text(c, 'TIME', x + SIDE / 2, 60, { size: 26, color: '#8aa', align: 'center' });
    text(c, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, x + SIDE / 2, 140, { size: 60, align: 'center', color: t <= 30 ? '#ff7070' : '#fff' });
  }
  drawBlank(c) {
    const x = this.blankX;
    c.fillStyle = '#0f1318'; c.fillRect(x, TOP, SIDE, H - TOP);
    if (this.showTray) {
      const r = this.trayRect(); const on = this.op && this.inTray(this.opP);
      panel(c, r.x, r.y, r.w, r.h, { fill: on ? '#35506a' : '#26313d', stroke: on ? '#9fe0ff' : '#8aa', lw: 4, r: 20 });
      text(c, 'トレイ', r.x + r.w / 2, r.y + r.h / 2, { size: 36, align: 'center', base: 'middle' });
      text(c, 'ここで離す', r.x + r.w / 2, r.y + r.h / 2 + 50, { size: 22, align: 'center', color: '#cde' });
      return;
    }
    // 試作用の確認情報
    let y = TOP + 40;
    const line = (s, col = '#9ab') => { text(c, s, x + 16, y, { size: 21, color: col }); y += 32; };
    line('【試作用の情報】', '#678');
    line(`ミス：${this.misses}`);
    line(`ゼリー：${this.gelStock}/${this.inst.gel.stock}`);
    line(`ゲージ：${Math.floor(this.gauge)}`);
    line('投与量／限度量', '#678');
    for (const id of Object.keys(this.inst.syringe.drugs)) {
      const lim = this.limitOf(id), used = this.doses[id] || 0;
      line(`${this.inst.syringe.drugs[id].name}：${Math.floor(used)}${lim != null ? ' / ' + lim : ''}`, lim != null && used >= lim * 0.7 ? '#ff8080' : '#9ab');
    }
    y += 16;
    line('H：ヒント表示', '#567'); line('G：マス目表示', '#567'); line('1〜6：持ち替え', '#567'); line('Esc：メニュー', '#567');
  }
  drawSubtitle(c) {
    const x = this.areaX, y = TOP + AREA_H;
    c.fillStyle = '#0b0e12'; c.fillRect(x, y, AREA_W, H - y);
    if (!this.sub) return;
    const lines = wrap(c, this.sub.s, AREA_W - 120, 38).slice(0, 2);
    lines.forEach((s, i) => text(c, s, x + AREA_W / 2, y + 80 + i * 52, { size: 38, align: 'center' }));
  }
}

function ringPts(l) { const out = []; for (let k = 0; k < 8; k++) { const a = -Math.PI / 2 + k * Math.PI / 4; out.push([l.center[0] + (l.radius + 2) * Math.cos(a), l.center[1] + (l.radius + 2) * Math.sin(a)]); } return out; }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function fmt(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }
