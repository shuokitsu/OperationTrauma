import { text, Buttons } from '../core/ui.js';

export class GameOverScene {
  constructor(game, run, reason) {
    this.game = game;
    this.run = run;
    this.reason = reason;
    this.buttons = new Buttons(game.audio);
    // コンティニューは無く、リトライに統一（spec/02_screens.md 3.5）
    this.buttons.add({ x: 560, y: 700, w: 360, h: 100, label: 'リトライ', onClick: () => this.run.retry() });
    this.buttons.add({ x: 1000, y: 700, w: 360, h: 100, label: 'タイトルに戻る', se: 'cancel', onClick: () => import('./title.js').then((m) => this.game.change(new m.TitleScene(this.game))) });
  }

  enter() {
    this.game.audio.bgm(null);
    this.game.audio.se('gameover');
  }

  draw(c) {
    c.fillStyle = '#1a0606';
    c.fillRect(0, 0, 1920, 1080);
    text(c, 'GAME OVER', 960, 360, { size: 120, align: 'center', weight: 'bold', color: '#e05050' });
    text(c, this.reason === 'time' ? '制限時間が切れた' : 'バイタルが 0 になった', 960, 500, { size: 40, align: 'center', color: '#d0b0b0' });
    this.buttons.draw(c);
  }

  pointerDown(p) { this.buttons.down(p); }
  pointerUp(p) { this.buttons.up(p); }
}
