// 画面の部品（文字、ボタン、パネル）。座標はすべて論理座標（1920×1080）。

import { Assets } from './assets.js';

export const W = 1920, H = 1080;
export const FONT = '"Yu Gothic UI", "Yu Gothic", Meiryo, "Hiragino Sans", sans-serif';

export const COLOR = {
  bg: '#0d1014', panel: '#161b22', panelLine: '#3a4553', text: '#e8edf2', dim: '#8a96a3',
  accent: '#ffd23f', accentWeak: '#8a7a3a', good: '#5ad67d', warn: '#f2c14e', bad: '#e5484d',
  button: '#222a34', buttonHover: '#2f3a48', buttonLine: '#5b6b7d'
};

export function setFont(ctx, size, bold = false) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
}

export function text(ctx, str, x, y, o = {}) {
  setFont(ctx, o.size || 32, o.bold);
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'middle';
  if (o.stroke) {
    ctx.lineWidth = o.strokeWidth || 6;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = o.stroke;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = o.color || COLOR.text;
  ctx.fillText(str, x, y);
}

// 文字列を幅に合わせて折り返す（\n は改行。日本語なので1文字ずつ見る）
export function wrap(ctx, str, maxWidth, size, bold = false) {
  setFont(ctx, size, bold);
  const lines = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
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

export function textBlock(ctx, str, x, y, maxWidth, o = {}) {
  const size = o.size || 32;
  const lh = o.lineHeight || Math.round(size * 1.5);
  const lines = wrap(ctx, str, maxWidth, size, o.bold);
  lines.forEach((l, i) => text(ctx, l, x, y + i * lh, { ...o, baseline: 'top' }));
  return lines.length * lh;
}

export function roundRect(ctx, x, y, w, h, r = 12) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function panel(ctx, x, y, w, h, o = {}) {
  roundRect(ctx, x, y, w, h, o.r ?? 14);
  ctx.fillStyle = o.fill || COLOR.panel;
  ctx.globalAlpha = o.alpha ?? 0.94;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = o.lineWidth || 3;
  ctx.strokeStyle = o.line || COLOR.panelLine;
  ctx.stroke();
}

export class Button {
  constructor(x, y, w, h, label, onClick, o = {}) {
    Object.assign(this, { x, y, w, h, label, onClick, o });
    this.disabled = false;
    this.selected = false;
  }
  hit(px, py) {
    return !this.disabled && px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h;
  }
  draw(ctx) {
    const o = this.o;
    roundRect(ctx, this.x, this.y, this.w, this.h, o.r ?? 12);
    ctx.fillStyle = this.selected ? '#4a5a2a' : (o.fill || COLOR.button);
    ctx.globalAlpha = this.disabled ? 0.4 : 1;
    ctx.fill();
    ctx.lineWidth = this.selected ? 5 : 3;
    ctx.strokeStyle = this.selected ? COLOR.accent : (o.line || COLOR.buttonLine);
    ctx.stroke();
    const lines = String(this.label).split('\n');
    const size = o.size || 36;
    const lh = Math.round(size * 1.35);
    lines.forEach((l, i) => text(ctx, l, this.x + this.w / 2, this.y + this.h / 2 + (i - (lines.length - 1) / 2) * lh,
      { size, align: 'center', color: o.color || COLOR.text, bold: o.bold }));
    ctx.globalAlpha = 1;
  }
}

// ボタンの配列に押した位置を渡し、当たったら onClick を呼ぶ
export function clickButtons(buttons, x, y) {
  for (const b of buttons) {
    if (b.hit(x, y)) { Assets.se(b.o.se === undefined ? 'select' : b.o.se); b.onClick(); return true; }
  }
  return false;
}

// 画像を枠に収めて描く。mode: 'stretch'（引き伸ばす）、'contain'（全体を収める）、'cover'（枠を埋める）
export function drawImage(ctx, name, x, y, w, h, mode = 'contain', alignY = 0.5) {
  const img = Assets.img(name);
  if (!img || !img.width) {
    ctx.fillStyle = '#2a3037';
    ctx.fillRect(x, y, w, h);
    return;
  }
  if (mode === 'stretch') { ctx.drawImage(img, x, y, w, h); return; }
  const s = mode === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * alignY, dw, dh);
  ctx.restore();
}

export function dim(ctx, alpha = 0.6) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, W, H);
}
