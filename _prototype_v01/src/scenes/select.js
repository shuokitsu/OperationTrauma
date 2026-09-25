import { text, panel, Buttons } from '../core/ui.js';
import { StageRun } from '../flow.js';

const NODE_W = 360;
const NODE_H = 150;

export class SelectScene {
  constructor(game) {
    this.game = game;
    this.buttons = new Buttons(game.audio);
    this.popup = null; // 難易度選択中のステージ ID
    this.build();
  }

  enter() {
    this.game.audio.bgm('title');
  }

  build() {
    const b = this.buttons;
    b.clear();
    const { stages } = this.game.data.stages;
    const save = this.game.save;

    if (this.popup) {
      const diff = this.game.data.difficulty;
      const last = save.data.lastDifficulty[this.popup] || 'normal';
      diff.order.forEach((id, i) => {
        b.add({
          x: 560 + i * 280, y: 520, w: 250, h: 100, label: diff.list[id].name,
          active: () => id === last,
          onClick: () => {
            save.data.lastDifficulty[this.popup] = id;
            save.write();
            new StageRun(this.game, this.popup, id).start();
          },
        });
      });
      b.add({ x: 810, y: 680, w: 300, h: 80, label: 'やめる', se: 'cancel', onClick: () => { this.popup = null; this.build(); } });
      return;
    }

    // 開放済みのステージだけを表示する（spec/02_screens.md 3.2）
    for (const id of save.data.unlocked) {
      const s = stages[id];
      if (!s) continue;
      b.add({
        x: s.map.x - NODE_W / 2, y: s.map.y - NODE_H / 2, w: NODE_W, h: NODE_H, label: '',
        onClick: () => { this.popup = id; this.build(); },
        stageId: id,
      });
    }
    b.add({ x: 40, y: 960, w: 300, h: 80, label: 'タイトルへ', se: 'cancel', onClick: () => import('./title.js').then((m) => this.game.change(new m.TitleScene(this.game))) });
  }

  draw(c) {
    c.fillStyle = '#0d1219';
    c.fillRect(0, 0, 1920, 1080);
    text(c, 'ステージセレクト', 80, 80, { size: 56, weight: 'bold' });
    text(c, '（シナリオのフローチャートを兼ねる。開放済みのステージのみ表示）', 80, 150, { size: 28, color: '#8a9bb0' });

    const { stages } = this.game.data.stages;
    const save = this.game.save;
    const unlocked = new Set(save.data.unlocked);

    // 両端が開放済みのつながりだけ線で結ぶ
    c.strokeStyle = '#5a7fa8';
    c.lineWidth = 6;
    for (const id of unlocked) {
      for (const u of stages[id]?.unlocks || []) {
        if (!unlocked.has(u.stage)) continue;
        const a = stages[id].map;
        const t = stages[u.stage].map;
        c.beginPath();
        c.moveTo(a.x + NODE_W / 2, a.y);
        c.lineTo(t.x - NODE_W / 2, t.y);
        c.stroke();
      }
    }

    this.buttons.draw(c);
    for (const btn of this.buttons.list) {
      if (!btn.stageId) continue;
      const s = stages[btn.stageId];
      text(c, s.title, btn.x + 24, btn.y + 42, { size: 30, weight: 'bold' });
      if (s.hasChoice) text(c, '◆ 選択肢あり', btn.x + 24, btn.y + 92, { size: 26, color: '#ffd36f' });
      const best = save.bestRank(btn.stageId);
      text(c, best ? `最高ランク ${best}` : '未クリア', btn.x + NODE_W - 24, btn.y + 124, { size: 26, align: 'right', color: best ? '#9fe39f' : '#8a9bb0' });
    }

    if (this.popup) {
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(0, 0, 1920, 1080);
      panel(c, 500, 360, 920, 440);
      text(c, `${stages[this.popup].title}　難易度を選択`, 960, 440, { size: 40, align: 'center' });
      const r = save.data.ranks[this.popup] || {};
      const diff = this.game.data.difficulty;
      diff.order.forEach((id, i) => {
        if (r[id]) text(c, `最高 ${r[id]}`, 685 + i * 280, 645, { size: 24, align: 'center', color: '#9fe39f' });
      });
      this.buttons.draw(c);
    }
  }

  pointerDown(p) { this.buttons.down(p); }
  pointerUp(p) { this.buttons.up(p); }
}
