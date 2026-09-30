// 描画の小物
export const FONT = '"Yu Gothic", "Meiryo", sans-serif';
export function font(size, bold = false) { return `${bold ? 'bold ' : ''}${size}px ${FONT}`; }

export function text(c, s, x, y, { size = 32, color = '#fff', align = 'left', base = 'alphabetic', bold = false } = {}) {
  c.font = font(size, bold); c.fillStyle = color; c.textAlign = align; c.textBaseline = base; c.fillText(s, x, y);
}
// 日本語用の折り返し（1文字ずつ幅を測る）
export function wrap(c, s, width, size) {
  c.font = font(size); const lines = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    for (const ch of para) { if (c.measureText(line + ch).width > width && line) { lines.push(line); line = ch; } else line += ch; }
    lines.push(line);
  }
  return lines;
}
export function panel(c, x, y, w, h, { fill = 'rgba(10,14,20,0.85)', stroke = '#5b6b7d', r = 12, lw = 2 } = {}) {
  c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}
export class Button {
  constructor(x, y, w, h, label, onClick, opt = {}) { Object.assign(this, { x, y, w, h, label, onClick, ...opt }); }
  hit(p) { return p.x >= this.x && p.x <= this.x + this.w && p.y >= this.y && p.y <= this.y + this.h; }
  draw(c, hover) {
    panel(c, this.x, this.y, this.w, this.h, { fill: this.active ? '#2f6f8f' : hover ? '#2a3440' : 'rgba(20,26,34,0.9)', stroke: this.active ? '#9fe0ff' : '#5b6b7d' });
    text(c, this.label, this.x + this.w / 2, this.y + this.h / 2 + 2, { size: this.size || 34, align: 'center', base: 'middle', color: this.disabled ? '#666' : '#fff' });
  }
}
// ボタンを並べた画面の共通処理
export class ButtonScene {
  constructor(app) { this.app = app; this.buttons = []; this.hover = null; }
  down(p) { const b = this.buttons.find(b => b.hit(p) && !b.disabled); if (b) { this.app.sound.se('select'); b.onClick(); } }
  hoverAt(p) { this.hover = this.buttons.find(b => b.hit(p)) || null; }
  drawButtons(c) { for (const b of this.buttons) b.draw(c, b === this.hover); }
}
// 画像の読み込み（読めなくても落とさない）
const cache = {};
const JPEG_IMAGES = new Set(['char_assistant', 'char_protagonist', 'patient_skin_0', 'patient_skin_1', 'patient_skin_2']);
export function img(name) {
  if (!cache[name]) { const i = new Image(); const ext = JPEG_IMAGES.has(name) ? 'jpg' : 'svg'; i.src = `assets/images/${name}.${ext}`; cache[name] = i; }
  const i = cache[name]; return i.complete && i.naturalWidth ? i : null;
}
