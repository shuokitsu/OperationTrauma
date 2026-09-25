// 論理座標（1920×1080）で描画し、実際の画面へは描画時の変換だけで合わせる。
// 幅と高さのうち余裕の少ないほうに合わせ、余りは黒塗り（spec/01_overview.md 2.1）。
export const W = 1920;
export const H = 1080;

export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = innerWidth;
    const ch = innerHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.dpr = dpr;
    this.scale = Math.min(this.canvas.width / W, this.canvas.height / H);
    this.ox = (this.canvas.width - W * this.scale) / 2;
    this.oy = (this.canvas.height - H * this.scale) / 2;
  }

  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    c.save();
    c.beginPath();
    c.rect(0, 0, W, H);
    c.clip();
  }

  end() {
    this.ctx.restore();
  }

  // 実際の画面の座標 → 論理座標
  toLogical(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = (clientX - r.left) * this.dpr;
    const y = (clientY - r.top) * this.dpr;
    return { x: (x - this.ox) / this.scale, y: (y - this.oy) / this.scale };
  }
}
