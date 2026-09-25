import { text, panel, Buttons } from '../core/ui.js';
import { SelectScene } from './select.js';

const SPEEDS = [['slow', '遅い'], ['normal', '普通'], ['fast', '速い']];

export class TitleScene {
  constructor(game) {
    this.game = game;
    this.showOptions = false;
    this.buttons = new Buttons(game.audio);
    this.build();
  }

  enter() {
    this.game.audio.bgm('title');
  }

  get o() {
    return this.game.save.data.options;
  }

  changed() {
    this.game.audio.setVolume(this.o.se, this.o.bgm);
    this.game.save.write();
  }

  build() {
    const b = this.buttons;
    b.clear();
    if (!this.showOptions) {
      b.add({ x: 710, y: 620, w: 500, h: 100, label: 'ステージセレクト', onClick: () => this.game.change(new SelectScene(this.game)) });
      b.add({ x: 710, y: 750, w: 500, h: 100, label: 'オプション', onClick: () => { this.showOptions = true; this.build(); } });
      return;
    }
    // オプションはタイトル画面のまま表示する（spec/02_screens.md 3.1）
    const o = this.o;
    const row = (i) => 330 + i * 110;
    const step = (v, d) => Math.round(Math.min(1, Math.max(0, v + d)) * 10) / 10;
    b.add({ x: 1100, y: row(0), w: 360, h: 80, label: () => (o.side === 'left' ? '左' : '右'), onClick: () => { o.side = o.side === 'left' ? 'right' : 'left'; this.changed(); } });
    for (const [i, key] of [[1, 'se'], [2, 'bgm']]) {
      b.add({ x: 1100, y: row(i), w: 80, h: 80, label: '－', onClick: () => { o[key] = step(o[key], -0.1); this.changed(); } });
      b.add({ x: 1380, y: row(i), w: 80, h: 80, label: '＋', onClick: () => { o[key] = step(o[key], 0.1); this.changed(); } });
    }
    SPEEDS.forEach(([k, name], j) => {
      b.add({ x: 1100 + j * 124, y: row(3), w: 112, h: 80, label: name, active: () => o.textSpeed === k, onClick: () => { o.textSpeed = k; this.changed(); } });
    });
    b.add({ x: 1100, y: row(4), w: 360, h: 80, label: () => (o.skipTalk ? 'ON' : 'OFF'), onClick: () => { o.skipTalk = !o.skipTalk; this.changed(); } });
    b.add({ x: 760, y: 900, w: 400, h: 90, label: '戻る', se: 'cancel', onClick: () => { this.showOptions = false; this.build(); } });
  }

  draw(c) {
    const bg = this.game.images.bg_title;
    if (bg) c.drawImage(bg, 0, 0, 1920, 1080);
    if (!this.showOptions) {
      text(c, 'OperationTrauma', 960, 300, { size: 120, align: 'center', weight: 'bold', color: '#e8eef6' });
      text(c, '― 試作版（仕様の課題洗い出し用） ―', 960, 420, { size: 36, align: 'center', color: '#9fb3c8' });
    } else {
      text(c, 'オプション', 960, 200, { size: 56, align: 'center', weight: 'bold' });
      panel(c, 420, 280, 1080, 720);
      const o = this.o;
      const labels = ['医療機器の配置', 'SE 音量（ボイス含む）', 'BGM 音量', '文字送り速度', '会話画面全スキップ'];
      labels.forEach((l, i) => text(c, l, 480, 370 + i * 110, { size: 36 }));
      text(c, `${Math.round(o.se * 100)}%`, 1280, 480, { size: 36, align: 'center' });
      text(c, `${Math.round(o.bgm * 100)}%`, 1280, 590, { size: 36, align: 'center' });
    }
    this.buttons.draw(c);
  }

  pointerDown(p) { this.buttons.down(p); }
  pointerUp(p) { this.buttons.up(p); }
}
