import { text, panel } from '../core/ui.js';

export class ResultScene {
  constructor(game, run, result) {
    this.game = game;
    this.run = run;
    this.result = result;
    this.t = 0;
  }

  enter() {
    this.game.audio.bgm('result');
    this.game.audio.se('clear');
  }

  update(dt) {
    this.t += dt;
  }

  draw(c) {
    const r = this.result;
    c.fillStyle = '#0b1622';
    c.fillRect(0, 0, 1920, 1080);
    text(c, 'RESULT', 960, 110, { size: 72, align: 'center', weight: 'bold', color: '#6fb6ff' });
    text(c, `${this.run.stage.title}　／　難易度：${this.game.data.difficulty.list[this.run.difficultyId].name}`, 960, 190, { size: 34, align: 'center' });

    panel(c, 260, 250, 900, 620);
    r.items.forEach((it, i) => {
      const y = 310 + i * 70;
      text(c, it.label, 300, y, { size: 34, color: it.ok ? '#fff' : '#777' });
      text(c, it.ok ? `+${it.points}` : '0', 1120, y, { size: 34, align: 'right', color: it.ok ? '#9fe39f' : '#777' });
    });
    text(c, `残りバイタル ${Math.ceil(r.vital)}　／　残り時間 ${Math.ceil(r.timeLeft)}秒　／　ミス ${r.misses}回`, 300, 820, { size: 28, color: '#9fb3c8' });

    panel(c, 1240, 250, 420, 620);
    text(c, '努力目標', 1450, 310, { size: 34, align: 'center', color: '#9fe39f', weight: 'bold' });
    r.efforts.forEach((e, i) => {
      text(c, `${e.ok ? '達成' : '未達成'}：${e.text}`, 1270, 380 + i * 60, { size: 24, color: e.ok ? '#fff' : '#777' });
    });
    if (this.t > 0.6) {
      text(c, `${r.score}点`, 1450, 620, { size: 64, align: 'center' });
      text(c, r.rank, 1450, 760, { size: 140, align: 'center', weight: 'bold', color: '#ffd36f' });
    }
    if (this.t > 1.2) text(c, 'クリック／タップで次へ', 960, 980, { size: 32, align: 'center', color: '#9fd0ff' });
  }

  pointerUp() {
    if (this.t > 1.2) this.run.afterResult(this.result);
  }
}
