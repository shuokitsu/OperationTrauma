// 会話の表示（会話画面と、ゲーム画面に重ねる会話の共通部品。spec/02 3.3・3.4）
// 立ち絵は左右、下に名前欄付きの会話ウィンドウ。選択肢はフラグを立てる
import { W, H, text, roundRect, wrapText, Button } from './core.js';

const SPEED = { slow: 18, normal: 40, fast: 90 };   // 1秒あたりの文字数

export class TalkBox {
  // talk：{ bg, bgm, lines:[...] }、opt：{ overlay, skip, flags, onDone, briefing:()=>info }
  constructor(app, talk, opt = {}) {
    this.app = app;
    this.opt = opt;
    this.flags = opt.flags || {};
    this.bg = talk && talk.bg;
    this.left = null; this.right = null;
    let lines = (talk && talk.lines) || [];
    // 会話画面全スキップ：ブリーフィングと選択肢だけを残す（spec/02 3.1、H1 の推奨案）
    if (opt.skip) lines = lines.map(l => {
      if (l.briefing || l.choice) return l;
      // セリフは飛ばし、背景・立ち絵・BGM の指定だけ残す
      const { text: _t, speaker: _s, side: _d, se: _e, ...rest } = l;
      return Object.keys(rest).length ? rest : null;
    }).filter(Boolean);
    this.lines = lines;
    this.index = -1;
    this.done = false;
    this.buttons = [];
    if (talk && talk.bgm && !opt.overlay) app.sound.bgm(talk.bgm);
    this.next();
  }
  get speed() { return SPEED[this.app.save.options.textSpeed] || SPEED.normal; }
  next() {
    this.buttons = [];
    for (;;) {
      this.index++;
      if (this.index >= this.lines.length) { this.finish(); return; }
      const l = this.lines[this.index];
      if (l.bg !== undefined) this.bg = l.bg;
      if (l.bgm) this.app.sound.bgm(l.bgm);
      if (l.left !== undefined) this.left = l.left;
      if (l.right !== undefined) this.right = l.right;
      if (l.se) this.app.sound.se(l.se);
      if (l.text || l.choice || l.briefing) break;
    }
    const l = this.lines[this.index];
    this.cur = l;
    this.shown = 0;
    this.full = l.text ? l.text.length : 0;
    if (l.speaker) {
      const ch = this.app.data.talks.characters[l.speaker];
      if (ch && l.side !== 'none') {
        if ((l.side || 'left') === 'left') this.left = l.speaker; else this.right = l.speaker;
      }
    }
    if (l.briefing) this.app.sound.se('select');
  }
  finish() {
    if (this.done) return;
    this.done = true;
    // 空の会話でも、作った直後ではなく次の更新で次へ移る（bug_list B3）
    this.pendingDone = true;
  }
  makeChoiceButtons() {
    const opts = this.cur.choice.options;
    const w = 760, h = 86, gap = 22;
    const y0 = 380 - (opts.length * (h + gap)) / 2;
    this.buttons = opts.map((o, i) => new Button(W / 2 - w / 2, y0 + i * (h + gap), w, h, o.label, () => {
      this.flags[this.cur.choice.flag] = o.value;
      this.app.sound.se('select');
      this.next();
    }));
  }
  update(dt, input) {
    if (this.pendingDone) {
      this.pendingDone = false;
      this.opt.onDone && this.opt.onDone(this.flags);
      return;
    }
    if (this.done) return;
    const l = this.cur;
    if (l.text && this.shown < this.full) {
      const before = Math.floor(this.shown);
      this.shown = Math.min(this.full, this.shown + dt * this.speed);
      if (Math.floor(this.shown) !== before && Math.floor(this.shown) % 3 === 0) this.app.sound.se('text', { vol: 0.5 });
    }
    if (l.choice && this.shown >= this.full && !this.buttons.length) this.makeChoiceButtons();
    for (const e of input.ev) {
      if (e.type !== 'down') continue;
      if (this.buttons.length) {
        const b = this.buttons.find(b => b.hit(e));
        if (b) { b.onClick(); return; }
        continue;
      }
      if (l.text && this.shown < this.full) { this.shown = this.full; continue; }   // 途中でタップすると、その行を全部出す
      if (!l.choice) { this.app.sound.se('text', { vol: 0.7 }); this.next(); }
    }
    for (const k of input.keys) {
      if ((k === 'Enter' || k === ' ') && !this.buttons.length) {
        if (l.text && this.shown < this.full) this.shown = this.full; else if (!l.choice) this.next();
      }
    }
  }
  draw(c) {
    const app = this.app;
    if (!this.opt.overlay) {
      const bg = this.bg && app.img(this.bg);
      if (bg) drawCover(c, bg, 0, 0, W, H); else { c.fillStyle = '#1b2026'; c.fillRect(0, 0, W, H); }
    }
    if (this.done) return;
    const l = this.cur;
    // 立ち絵（話していない側は少し暗く）
    const drawChar = (id, side) => {
      if (!id) return;
      const ch = app.data.talks.characters[id];
      const im = ch && app.img(ch.image);
      if (!im) return;
      const h = 900, w = im.width * h / im.height;
      const x = side === 'left' ? 120 : W - 120 - w;
      c.save();
      if (l.speaker && l.speaker !== id) c.globalAlpha = 0.55;
      c.drawImage(im, x, H - h - 40, w, h);
      c.restore();
    };
    drawChar(this.left, 'left'); drawChar(this.right, 'right');
    if (l.briefing) { this.drawBriefing(c); return; }
    // 会話ウィンドウ
    const wx = 140, wy = H - 300, ww = W - 280, wh = 260;
    roundRect(c, wx, wy, ww, wh, 18);
    c.fillStyle = 'rgba(10,14,20,0.9)'; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#8fa3b8'; c.stroke();
    if (l.speaker) {
      const ch = app.data.talks.characters[l.speaker];
      const name = ch ? ch.name : l.speaker;
      roundRect(c, wx + 30, wy - 34, 300, 60, 12);
      c.fillStyle = '#24405a'; c.fill(); c.stroke();
      text(c, name, wx + 180, wy - 2, { size: 34, align: 'center', base: 'middle', weight: 'bold' });
    }
    if (l.text) wrapText(c, l.text.slice(0, Math.floor(this.shown)), wx + 50, wy + 80, ww - 100, 56, { size: 38 });
    if (l.text && this.shown >= this.full && !l.choice) text(c, '▼', wx + ww - 50, wy + wh - 30, { size: 30, color: '#9fb', align: 'center' });
    for (const b of this.buttons) b.draw(c);
  }
  drawBriefing(c) {
    const info = this.opt.briefing ? this.opt.briefing() : null;
    const x = 260, y = 140, w = W - 520, h = 700;
    roundRect(c, x, y, w, h, 20);
    c.fillStyle = 'rgba(8,20,30,0.94)'; c.fill();
    c.lineWidth = 4; c.strokeStyle = '#5fb3d9'; c.stroke();
    text(c, 'ブリーフィング', x + w / 2, y + 80, { size: 54, align: 'center', weight: 'bold', color: '#9fe3ff' });
    let yy = y + 170;
    if (info) {
      if (info.text) { yy += wrapText(c, info.text, x + 70, yy, w - 140, 50, { size: 36 }) * 50 + 20; }
      text(c, 'クリア目標', x + 70, yy, { size: 36, weight: 'bold', color: '#ffd27a' }); yy += 56;
      yy += wrapText(c, '・' + info.clear, x + 100, yy, w - 200, 48, { size: 34 }) * 48 + 16;
      if (info.effort && info.effort.length) {
        text(c, '努力目標（達成するとボーナス点）', x + 70, yy, { size: 36, weight: 'bold', color: '#ffd27a' }); yy += 56;
        for (const e of info.effort) yy += wrapText(c, `・${e.text}（+${e.bonus_points}点）`, x + 100, yy, w - 200, 48, { size: 34 }) * 48;
      }
    }
    text(c, 'タップで次へ', x + w / 2, y + h - 40, { size: 30, align: 'center', color: '#9ab' });
  }
}

export function drawCover(c, im, x, y, w, h) {
  const s = Math.max(w / im.width, h / im.height);
  const iw = im.width * s, ih = im.height * s;
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  c.restore();
}
