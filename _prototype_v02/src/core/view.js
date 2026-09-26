// 画面の拡大縮小と入力（spec/01 2.1、spec/04 1.4、spec/05 2.5）
// 論理座標 1920×1080 で描画し、余裕の少ないほうに合わせて拡大縮小する。余りは黒塗り。
export const W = 1920, H = 1080;

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.handlers = null;      // {down, move, up, hover, key}
    this.pointerId = null;     // 最初に触れた1本の指だけを扱う（M4）
    window.addEventListener('resize', () => this.resize());
    this.resize();
    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => this.onUp(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.handlers?.key?.(e.key));
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = window.innerWidth, ch = window.innerHeight;
    this.canvas.width = Math.round(cw * dpr); this.canvas.height = Math.round(ch * dpr);
    this.canvas.style.width = cw + 'px'; this.canvas.style.height = ch + 'px';
    this.scale = Math.min(cw / W, ch / H) * dpr;
    this.ox = (cw * dpr - W * this.scale) / 2;
    this.oy = (ch * dpr - H * this.scale) / 2;
  }
  toLogical(e) {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: ((e.clientX - r.left) * dpr - this.ox) / this.scale, y: ((e.clientY - r.top) * dpr - this.oy) / this.scale };
  }
  onDown(e) {
    if (this.pointerId !== null) return;          // 2本目以降は無視
    this.pointerId = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    this.handlers?.down?.(this.toLogical(e));
  }
  onMove(e) {
    const p = this.toLogical(e);
    if (this.pointerId === null) { this.handlers?.hover?.(p); return; }
    if (e.pointerId !== this.pointerId) return;
    this.handlers?.move?.(p);
  }
  onUp(e) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.handlers?.up?.(this.toLogical(e));
  }
  get pressing() { return this.pointerId !== null; }
  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    c.save(); c.beginPath(); c.rect(0, 0, W, H); c.clip();
  }
  end() { this.ctx.restore(); }
}
