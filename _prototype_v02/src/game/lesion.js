// 病巣の実体（種類 ＋ 配置）。手順の段階を進める
import { cellsOfLine, cellsOfCircle, ring, key } from './geometry.js';

export class Lesion {
  constructor(placement, def) {
    this.id = placement.id; this.typeId = placement.type; this.def = def; this.placement = placement;
    const s = placement.shape;
    if (s.line) {
      this.kind = 'line'; this.pts = s.line.map(p => [p[0] + 0.5, p[1] + 0.5]);
      this.cells = cellsOfLine(this.pts, placement.width ?? def.width ?? 1.2);
      const n = this.pts.length;
      this.center = [this.pts.reduce((a, p) => a + p[0], 0) / n, this.pts.reduce((a, p) => a + p[1], 0) / n];
    } else {
      this.kind = 'circle'; this.center = [s.circle[0] + 0.5, s.circle[1] + 0.5];
      this.radius = placement.radius ?? def.radius ?? 2;
      this.cells = cellsOfCircle(this.center, this.radius);
      this.pts = [this.center];
    }
    this.dest = placement.dest ? [placement.dest[0] + 0.5, placement.dest[1] + 0.5] : null;
    this.stepIdx = 0; this.done = false; this.declineT = 0; this.sucking = false;
    this.stitches = []; this.cutDone = false; this.objectGone = false;
    this.initStep();
  }
  get step() { return this.def.steps[this.stepIdx]; }
  // 今使える機器。省略できる段階なら、次の段階の機器も使える
  activeTools() {
    if (this.done) return [];
    const t = [this.step.tool];
    if (this.step.optional && this.def.steps[this.stepIdx + 1]) t.push(this.def.steps[this.stepIdx + 1].tool);
    return t;
  }
  // tool を使うときの段階（省略できる段階を飛ばす場合は、その次の段階）
  stepFor(tool) {
    if (this.done) return null;
    if (this.step.tool === tool) return { step: this.step, skip: false };
    if (this.step.optional && this.def.steps[this.stepIdx + 1]?.tool === tool) return { step: this.def.steps[this.stepIdx + 1], skip: true };
    return null;
  }
  initStep() {
    const st = this.step; if (!st) return;
    if (st.tool === 'drain') this.amount = st.amount;
    if (st.tool === 'syringe') this.injected = 0;
    if (st.tool === 'scalpel') this.cutPts = st.closed ? ring(this.center, this.radius + 2, 8) : this.pts;
    if (st.tool === 'suture') this.stitches = [];
  }
  advance(skip = false) {
    const done = skip ? this.def.steps[this.stepIdx + 1] : this.step;
    if (done.tool === 'scalpel') this.cutDone = true;
    if (done.tool === 'tweezers' && done.dest === 'tray') this.objectGone = true;
    this.stepIdx += skip ? 2 : 1;
    if (this.stepIdx >= this.def.steps.length) { this.done = true; return; }
    this.initStep();
  }
  // マスが病巣のヒットエリア内か
  has(i, j) { return this.cells.has(key(i, j)); }
}
