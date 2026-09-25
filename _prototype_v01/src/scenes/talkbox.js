// 会話の表示部品。会話画面とゲーム中の会話（一時停止あり）の両方で使う。
import { text, wrap, panel, Buttons } from '../core/ui.js';

const SPEED = { slow: 20, normal: 45, fast: 90 }; // 1秒あたりの文字数

export class TalkBox {
  constructor(game, { lines, run, onEnd, overlay = false }) {
    this.game = game;
    this.lines = lines || [];
    this.run = run;
    this.onEnd = onEnd;
    this.overlay = overlay;
    this.index = -1;
    this.state = { bg: null, left: null, right: null };
    this.buttons = new Buttons(game.audio);
    this.done = false;
  }

  // シーンが有効になってから呼ぶ（スキップで即終了してもシーン切り替えが正しく動くように）
  start() {
    this.next();
  }

  get options() {
    return this.game.save.data.options;
  }

  next() {
    this.index++;
    this.buttons.clear();
    if (this.index >= this.lines.length) {
      this.done = true;
      this.onEnd?.();
      return;
    }
    const line = this.lines[this.index];
    for (const k of ['bg', 'left', 'right']) if (k in line) this.state[k] = line[k];
    if (line.bgm) this.game.audio.bgm(line.bgm);
    if (line.se) this.game.audio.se(line.se);
    this.shown = 0;

    if (line.choice) {
      line.choice.forEach((ch, i) => {
        this.buttons.add({
          x: 460, y: 330 + i * 120, w: 1000, h: 90, label: ch.text, size: 32,
          onClick: () => {
            Object.assign(this.run.flags, ch.set || {});
            this.next();
          },
        });
      });
      return;
    }
    if (line.briefing) {
      this.game.audio.bgm(null);
      return;
    }
    // オプション「会話画面全スキップ」：選択肢とブリーフィング以外は飛ばす（仮）
    if (this.options.skipTalk) this.next();
  }

  get line() {
    return this.lines[this.index];
  }

  update(dt) {
    const l = this.line;
    if (!l || !l.text) return;
    const before = Math.floor(this.shown);
    this.shown = Math.min(l.text.length, this.shown + dt * (SPEED[this.options.textSpeed] || SPEED.normal));
    if (Math.floor(this.shown) > before && Math.floor(this.shown) % 3 === 0) this.game.audio.se('text');
  }

  pointerDown(p) {
    this.buttons.down(p);
  }

  pointerUp(p) {
    if (this.done) return;
    const l = this.line;
    if (l.choice) {
      this.buttons.up(p);
      return;
    }
    if (l.text && this.shown < l.text.length) {
      this.shown = l.text.length;
      return;
    }
    this.next();
  }

  draw(c) {
    const imgs = this.game.images;
    if (!this.overlay) {
      const bg = imgs['bg_' + this.state.bg];
      if (bg) c.drawImage(bg, 0, 0, 1920, 1080);
      else { c.fillStyle = '#111'; c.fillRect(0, 0, 1920, 1080); }
    } else {
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(0, 0, 1920, 1080);
    }
    const l = this.line;
    if (!l) return;

    if (l.briefing) {
      this.drawBriefing(c);
      return;
    }

    const speaker = l.speaker;
    for (const side of ['left', 'right']) {
      const img = imgs['char_' + this.state[side]];
      if (!img) continue;
      c.globalAlpha = speaker && speaker !== side ? 0.5 : 1;
      c.drawImage(img, side === 'left' ? 120 : 1200, 140, 600, 900);
      c.globalAlpha = 1;
    }

    if (l.choice) {
      panel(c, 400, 220, 1120, 120 + l.choice.length * 120);
      text(c, '選択してください', 960, 270, { size: 34, align: 'center', color: '#9fd0ff' });
      this.buttons.draw(c);
      return;
    }

    panel(c, 80, 760, 1760, 280);
    if (l.name) {
      panel(c, 110, 715, 320, 70, { fill: 'rgba(30,60,100,0.95)' });
      text(c, l.name, 270, 750, { size: 34, align: 'center', weight: 'bold' });
    }
    const shown = (l.text || '').slice(0, Math.floor(this.shown));
    wrap(c, shown, 1660, 40).forEach((s, i) => text(c, s, 130, 830 + i * 56, { size: 40 }));
    if (this.shown >= (l.text || '').length) text(c, '▼', 1790, 1000, { size: 30, color: '#9fd0ff', align: 'center' });
  }

  drawBriefing(c) {
    const st = this.run.stage;
    const b = st.briefing;
    const d = this.game.data.difficulty.list[this.run.difficultyId];
    c.fillStyle = 'rgba(5,20,40,0.92)';
    c.fillRect(0, 0, 1920, 1080);
    text(c, 'BRIEFING', 960, 130, { size: 64, align: 'center', color: '#6fb6ff', weight: 'bold' });
    text(c, `${st.title}　／　難易度：${d.name}`, 960, 220, { size: 36, align: 'center' });
    wrap(c, b.text, 1400, 36).forEach((s, i) => text(c, s, 260, 320 + i * 50, { size: 36 }));
    text(c, 'クリア目標', 260, 470, { size: 36, color: '#ffd36f', weight: 'bold' });
    text(c, '・' + b.clear, 300, 530, { size: 36 });
    text(c, '努力目標（達成すると高ランク）', 260, 620, { size: 36, color: '#9fe39f', weight: 'bold' });
    (b.effort || []).forEach((e, i) => text(c, '・' + e.text, 300, 680 + i * 56, { size: 36 }));
    text(c, 'クリック／タップで手術開始', 960, 980, { size: 32, align: 'center', color: '#9fd0ff' });
  }
}
