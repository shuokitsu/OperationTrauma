// 描画とボタンの共通部品
export const FONT = '"Yu Gothic UI", "Yu Gothic", "Meiryo", sans-serif';

export function font(size, weight = 'normal') {
  return `${weight} ${size}px ${FONT}`;
}

export function text(c, str, x, y, { size = 32, color = '#fff', align = 'left', base = 'middle', weight = 'normal' } = {}) {
  c.font = font(size, weight);
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = base;
  c.fillText(str, x, y);
}

// 幅に合わせて折り返した行の配列を返す（日本語は1文字単位）
export function wrap(c, str, width, size) {
  c.font = font(size);
  const lines = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (c.measureText(line + ch).width > width && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function panel(c, x, y, w, h, { fill = 'rgba(10,14,20,0.88)', stroke = '#5a6b80', radius = 12 } = {}) {
  c.beginPath();
  c.roundRect(x, y, w, h, radius);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = stroke;
  c.stroke();
}

export class Buttons {
  constructor(audio) {
    this.audio = audio;
    this.list = [];
    this.pressed = null;
  }

  add(b) {
    this.list.push(b);
    return b;
  }

  clear() {
    this.list = [];
    this.pressed = null;
  }

  hit(p) {
    return this.list.find((b) => b.visible !== false && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
  }

  down(p) {
    this.pressed = this.hit(p) || null;
    return !!this.pressed;
  }

  up(p) {
    const b = this.hit(p);
    const pressed = this.pressed;
    this.pressed = null;
    if (b && b === pressed && b.enabled !== false) {
      this.audio?.se(b.se || 'select');
      b.onClick();
      return true;
    }
    return false;
  }

  draw(c) {
    for (const b of this.list) {
      if (b.visible === false) continue;
      const active = b.active?.();
      panel(c, b.x, b.y, b.w, b.h, {
        fill: b.enabled === false ? 'rgba(40,40,40,0.8)' : active ? 'rgba(40,90,150,0.95)' : this.pressed === b ? 'rgba(60,80,110,0.95)' : 'rgba(20,28,40,0.9)',
        stroke: active ? '#9fd0ff' : '#5a6b80',
      });
      const label = typeof b.label === 'function' ? b.label() : b.label;
      text(c, label, b.x + b.w / 2, b.y + b.h / 2, { size: b.size || 34, align: 'center', color: b.enabled === false ? '#777' : '#fff' });
    }
  }
}
