// ゲーム画面以外の画面（spec/02）
import { W, H, text, roundRect, Button, wrapText } from './core.js';
import { TalkBox, drawCover } from './talk.js';
import { betterGrade } from './lesion.js';

class ButtonScene {
  constructor(app) { this.app = app; this.buttons = []; }
  update(dt, input) {
    for (const e of input.ev) {
      if (e.type !== 'down') continue;
      const b = this.buttons.find(b => !b.disabled && b.hit(e));
      if (b) { this.app.sound.se('select'); b.onClick(); return; }
    }
  }
  drawButtons(c) { const p = this.app.input.pos; this.buttons.forEach(b => b.draw(c, b.hit(p))); }
}

// ---------- 読み込み中 ----------
export class Loading {
  constructor(app) { this.app = app; this.done = 0; this.total = 1; }
  update() {}
  draw(c) {
    c.fillStyle = '#0b0f14'; c.fillRect(0, 0, W, H);
    text(c, '読み込み中…', W / 2, 500, { size: 60, align: 'center' });
    text(c, `${this.done} / ${this.total}`, W / 2, 590, { size: 40, align: 'center', color: '#9ab' });
  }
}

// ---------- タイトル（spec/02 3.1） ----------
export class Title extends ButtonScene {
  constructor(app) {
    super(app);
    app.sound.bgm('title');
    this.options = null;
    this.msg = null;
    const bx = W / 2 - 300;
    this.buttons = [
      new Button(bx, 520, 600, 100, 'ステージセレクト', () => app.toStageSelect()),
      new Button(bx, 640, 600, 100, 'トレーニング', () => app.toTrainingSelect()),
      new Button(bx, 760, 600, 100, 'オプション', () => { this.options = this.options ? null : new Options(app); }),
      new Button(60, 960, 420, 80, '試作：全ステージ開放', () => { app.unlockAll(); this.flash('全ステージを開放しました'); }, { size: 28, bg: 'rgba(60,40,20,0.9)' }),
      new Button(500, 960, 380, 80, '試作：セーブ消去', () => { app.resetSave(); this.flash('セーブを消去しました'); }, { size: 28, bg: 'rgba(60,20,20,0.9)' }),
    ];
  }
  flash(m) { this.msg = { text: m, t: 2 }; }
  update(dt, input) {
    if (this.msg && (this.msg.t -= dt) <= 0) this.msg = null;
    if (this.options) {
      // オプションのパネル上の操作。オプションボタン（閉じる）だけはパネルの外でも受ける
      for (const e of input.ev) {
        if (e.type !== 'down') continue;
        if (this.buttons[2].hit(e)) { this.app.sound.se('cancel'); this.options = null; return; }
        this.options.click(e);
      }
      return;
    }
    super.update(dt, input);
  }
  draw(c) {
    const bg = this.app.img('bg_title.svg');
    if (bg) drawCover(c, bg, 0, 0, W, H); else { c.fillStyle = '#101820'; c.fillRect(0, 0, W, H); }
    text(c, 'OperationTrauma', W / 2, 300, { size: 120, align: 'center', weight: 'bold', shadow: true });
    text(c, '試作 v04（2026-10-09 時点の仕様）', W / 2, 390, { size: 36, align: 'center', color: '#bcd', shadow: true });
    this.drawButtons(c);
    if (this.options) this.options.draw(c);
    if (this.msg) text(c, this.msg.text, W / 2, 920, { size: 36, align: 'center', color: '#ffd27a', shadow: true });
  }
}

// オプション（試作 v02 と同じ形：タイトルの上にパネルを重ね、項目ごとに値のボタンを並べる。prototype_carryover）
class Options {
  constructor(app) {
    this.app = app;
    const o = app.save.options;
    this.rows = [
      { label: '医療機器の配置', key: 'side', values: [['left', '左'], ['right', '右']] },
      { label: 'SE 音量', key: 'se', values: [[0, '0'], [40, '40'], [70, '70'], [100, '100']] },
      { label: 'BGM 音量', key: 'bgm', values: [[0, '0'], [30, '30'], [50, '50'], [80, '80']] },
      { label: '文字送り速度', key: 'textSpeed', values: [['slow', '遅い'], ['normal', '普通'], ['fast', '速い']] },
      { label: '会話画面全スキップ', key: 'skipTalk', values: [[false, 'OFF'], [true, 'ON']] },
    ];
    const maxN = Math.max(...this.rows.map(r => r.values.length));
    this.bw = 150; this.gap = 14; this.labelW = 420;
    this.w = Math.min(W - 80, this.labelW + maxN * (this.bw + this.gap) + 60);   // 画面からはみ出さない（bug_list B1）
    this.x = (W - this.w) / 2; this.y = 140; this.h = 110 + this.rows.length * 110;
    this.layout();
  }
  layout() {
    const o = this.app.save.options;
    this.buttons = [];
    this.rows.forEach((r, i) => {
      const y = this.y + 100 + i * 110;
      r.values.forEach(([v, l], j) => {
        const b = new Button(this.x + this.labelW + j * (this.bw + this.gap), y, this.bw, 80, l, () => {
          o[r.key] = v; this.app.applyOptions(); this.layout();
        }, { size: 30 });
        b.selected = o[r.key] === v;
        this.buttons.push(b);
      });
    });
  }
  click(p) { const b = this.buttons.find(b => b.hit(p)); if (b) { this.app.sound.se('select'); b.onClick(); } }
  draw(c) {
    roundRect(c, this.x, this.y, this.w, this.h, 20);
    c.fillStyle = 'rgba(8,14,22,0.96)'; c.fill(); c.strokeStyle = '#6e8aa6'; c.lineWidth = 3; c.stroke();
    text(c, 'オプション', this.x + 40, this.y + 64, { size: 44, weight: 'bold' });
    this.rows.forEach((r, i) => text(c, r.label, this.x + 40, this.y + 152 + i * 110, { size: 32 }));
    this.buttons.forEach(b => b.draw(c));
  }
}

// ---------- ステージセレクト（フローチャート。spec/02 3.2） ----------
export class StageSelect extends ButtonScene {
  constructor(app) {
    super(app);
    app.sound.bgm('title');
    this.diff = null;
    const stages = app.data.stages.stages;
    // つながり：クリア後の処理（unlock_stages・unlock_if）から作る
    this.edges = [];
    for (const s of stages) {
      const oc = s.on_clear || {};
      for (const t of oc.unlock_stages || []) this.edges.push([s.id, t]);
      for (const u of oc.unlock_if || []) this.edges.push([s.id, u.stage]);
    }
    const depth = { [app.data.stages.first_stage]: 0 };
    let changed = true;
    while (changed) { changed = false; for (const [a, b] of this.edges) if (depth[a] !== undefined && (depth[b] === undefined || depth[b] < depth[a] + 1)) { depth[b] = depth[a] + 1; changed = true; } }
    const cols = {};
    for (const s of stages) { const d = depth[s.id] ?? 0; (cols[d] = cols[d] || []).push(s); }
    this.nodes = {};
    const nd = Object.keys(cols).length;
    for (const [d, list] of Object.entries(cols)) {
      list.forEach((s, i) => {
        const x = 120 + d * ((W - 240 - 300) / Math.max(1, nd - 1));
        const y = 540 - (list.length - 1) * 150 + i * 300 - 70;
        this.nodes[s.id] = { s, x, y, w: 300, h: 140 };
      });
    }
    this.buttons = [new Button(40, 40, 260, 80, '← タイトル', () => app.toTitle(), { size: 30 })];
    for (const n of Object.values(this.nodes)) {
      if (!app.isUnlocked(n.s.id)) continue;
      this.buttons.push(Object.assign(new Button(n.x, n.y, n.w, n.h, '', () => this.openDiff(n.s)), { node: n }));
    }
  }
  openDiff(stage) {
    const app = this.app;
    const diffs = app.data.system.difficulties;
    const last = app.save.lastDifficulty[stage.id] || app.data.system.default_difficulty;
    this.diff = { stage, buttons: diffs.map((d, i) => Object.assign(new Button(W / 2 - 260, 360 + i * 120, 520, 96, d.name, () => { this.diff = null; app.startStage(stage, d); }), { selected: d.id === last })) };
    this.diff.buttons.push(new Button(W / 2 - 260, 360 + diffs.length * 120 + 20, 520, 80, 'やめる', () => { this.diff = null; }, { size: 30 }));
  }
  update(dt, input) {
    if (this.diff) {
      for (const e of input.ev) if (e.type === 'down') { const b = this.diff.buttons.find(b => b.hit(e)); if (b) { this.app.sound.se('select'); b.onClick(); return; } }
      return;
    }
    super.update(dt, input);
  }
  draw(c) {
    c.fillStyle = '#0e141b'; c.fillRect(0, 0, W, H);
    text(c, 'ステージセレクト', W / 2, 100, { size: 56, align: 'center', weight: 'bold' });
    const app = this.app;
    // 線（両端とも開放済みのものだけ）
    c.strokeStyle = '#5b7894'; c.lineWidth = 6;
    for (const [a, b] of this.edges) {
      const A = this.nodes[a], B = this.nodes[b];
      if (!A || !B || !app.isUnlocked(a) || !app.isUnlocked(b)) continue;
      const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2, mx = (x1 + x2) / 2;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(mx, y1); c.lineTo(mx, y2); c.lineTo(x2, y2); c.stroke();
    }
    for (const b of this.buttons) {
      if (!b.node) continue;
      const n = b.node, s = n.s, cl = app.save.cleared[s.id];
      roundRect(c, n.x, n.y, n.w, n.h, 16);
      c.fillStyle = b.hit(app.input.pos) ? '#2c4258' : '#1a2836'; c.fill();
      c.lineWidth = 5; c.strokeStyle = cl ? '#59d18c' : '#7d8da0'; c.stroke();
      text(c, s.name, n.x + 20, n.y + 50, { size: 36, weight: 'bold' });
      text(c, s.subtitle || '', n.x + 20, n.y + 92, { size: 24, color: '#bcd', maxWidth: n.w - 40 });
      if (cl && cl.bestRank) text(c, cl.bestRank, n.x + n.w - 20, n.y + 50, { size: 40, align: 'right', weight: 'bold', color: '#ffd27a' });
      if (app.stageHasChoice(s)) text(c, '選択肢あり', n.x + 20, n.y + 126, { size: 22, color: '#ffb36b' });
    }
    this.buttons.filter(b => !b.node).forEach(b => b.draw(c, b.hit(app.input.pos)));
    if (this.diff) {
      c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(0, 0, W, H);
      text(c, `${this.diff.stage.name}：難易度を選ぶ`, W / 2, 290, { size: 48, align: 'center', weight: 'bold' });
      this.diff.buttons.forEach(b => b.draw(c, b.hit(app.input.pos)));
    }
  }
}

// ---------- 会話画面（spec/02 3.3） ----------
export class TalkScene {
  constructor(app, talk, opt) {
    this.app = app;
    this.box = new TalkBox(app, talk, opt);
  }
  update(dt, input) { this.box.update(dt, input); }
  draw(c) { this.box.draw(c); }
}

// ---------- 開始位置の選択（ブリーフィングのあと。会話画面の上のポップアップ。spec/02 3.3） ----------
export class StartPosition extends ButtonScene {
  constructor(app, under, points, onPick) {
    super(app);
    this.under = under;
    const all = [{ step: 0, name: '最初から' }, ...points];
    this.buttons = all.map((p, i) => new Button(W / 2 - 380, 330 + i * 120, 760, 96, p.name, () => onPick(p)));
  }
  draw(c) {
    if (this.under) this.under.draw(c);
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, W, H);
    text(c, 'どこから始めますか', W / 2, 260, { size: 50, align: 'center', weight: 'bold' });
    this.drawButtons(c);
  }
}

// ---------- リザルト（spec/02 3.6） ----------
export class Result extends ButtonScene {
  constructor(app, r, onNext) {
    super(app);
    this.r = r;
    app.sound.bgm('result');
    app.sound.se('rank');
    this.buttons = [new Button(W - 420, H - 140, 360, 96, '次へ', onNext)];
  }
  draw(c) {
    const r = this.r;
    c.fillStyle = '#0f1620'; c.fillRect(0, 0, W, H);
    text(c, `${r.stageName}　リザルト（${r.diffName}）`, 80, 110, { size: 52, weight: 'bold' });
    let y = 200;
    text(c, '病巣', 100, y, { size: 30, color: '#9ab' }); text(c, '評価', 620, y, { size: 30, color: '#9ab' }); text(c, '点数', 800, y, { size: 30, color: '#9ab' }); text(c, '時間', 960, y, { size: 30, color: '#9ab' });
    y += 50;
    for (const l of r.lesions.slice(0, 12)) {
      text(c, l.name, 100, y, { size: 32 });
      text(c, l.grade, 620, y, { size: 32, weight: 'bold', color: gradeColor(l.grade) });
      text(c, String(l.score), 800, y, { size: 32 });
      text(c, l.time != null ? l.time.toFixed(1) + '秒' : '-', 960, y, { size: 32 });
      y += 46;
    }
    if (r.preCount) { text(c, `コンティニューポイントより前の病巣 ${r.preCount}個（0点）`, 100, y, { size: 30, color: '#f9b' }); y += 46; }
    let ey = 250;
    text(c, '努力目標', 1240, 200, { size: 30, color: '#9ab' });
    if (!r.effort.length) { text(c, 'なし', 1240, ey, { size: 30 }); ey += 46; }
    for (const e of r.effort) { text(c, `${e.ok ? '達成' : '未達成'}　${e.text}（+${e.bonus_points}）`, 1240, ey, { size: 28, color: e.ok ? '#9fe' : '#aaa', maxWidth: 640 }); ey += 46; }
    text(c, `合計 ${r.points} / ${r.max} 点`, 1240, ey + 60, { size: 40 });
    if (r.rank) text(c, r.rank, 1500, ey + 260, { size: 200, weight: 'bold', align: 'center', color: '#ffd27a', shadow: true });
    else text(c, 'クリア', 1500, ey + 220, { size: 90, weight: 'bold', align: 'center', color: '#9fe' });
    this.drawButtons(c);
  }
}
function gradeColor(g) { return { Cool: '#5ff0ff', Good: '#7dff8a', Fine: '#ffe36b', Bad: '#ff7a7a' }[g] || '#fff'; }

// ---------- ゲームオーバー（spec/02 3.5） ----------
export class GameOver extends ButtonScene {
  constructor(app, cause, onRetry) {
    super(app);
    this.cause = cause;
    this.buttons = [
      new Button(W / 2 - 300, 560, 600, 100, 'リトライ', onRetry),
      new Button(W / 2 - 300, 690, 600, 100, 'タイトルに戻る', () => app.toTitle()),
    ];
  }
  draw(c) {
    c.fillStyle = '#140808'; c.fillRect(0, 0, W, H);
    text(c, 'GAME OVER', W / 2, 330, { size: 130, align: 'center', weight: 'bold', color: '#ff6b6b' });
    const why = { vital_zero: 'バイタルが 0 になった', dose_limit: '薬の限度量を超えた', timeout: '時間切れ' }[this.cause];
    text(c, why, W / 2, 440, { size: 44, align: 'center', color: '#fcc' });
    text(c, 'リトライは、最後に通過したコンティニューポイントから', W / 2, 500, { size: 28, align: 'center', color: '#a88' });
    this.drawButtons(c);
  }
}

// ---------- トレーニング（spec/02 3.7） ----------
export class TrainingSelect extends ButtonScene {
  constructor(app) {
    super(app);
    app.sound.bgm('title');
    this.diffId = app.save.lastDifficulty.__training || app.data.system.default_difficulty;
    this.build();
  }
  build() {
    const app = this.app;
    const types = app.trainableTypes();
    this.types = types;
    this.buttons = [new Button(40, 40, 260, 80, '← タイトル', () => app.toTitle(), { size: 30 })];
    // 難易度の切り替え（常に表示）
    app.data.system.difficulties.forEach((d, i) => this.buttons.push(Object.assign(new Button(1180 + i * 230, 40, 210, 80, d.name, () => { this.diffId = d.id; app.save.lastDifficulty.__training = d.id; app.persist(); this.build(); }, { size: 30 }), { selected: d.id === this.diffId })));
    types.forEach((t, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      this.buttons.push(Object.assign(new Button(100 + col * 580, 250 + row * 150, 540, 120, app.data.lesions[t].name, () => app.startTraining('pick', [t], this.diffId)), { type: t }));
    });
    this.buttons.push(new Button(W / 2 - 300, 880, 600, 100, `ランダム（${app.data.stages.training.random_count}つ）`, () => {
      const n = app.data.stages.training.random_count, q = [];
      for (let i = 0; i < n; i++) q.push(types[Math.floor(Math.random() * types.length)]);   // 重複あり（P72）
      app.startTraining('random', q, this.diffId);
    }, { disabled: !types.length }));
    this.buttons.push(new Button(1380, 960, 500, 80, '試作：全病巣を練習可能に', () => { app.save.training.all = true; app.persist(); this.build(); }, { size: 26, bg: 'rgba(60,40,20,0.9)' }));
  }
  draw(c) {
    c.fillStyle = '#0e1a16'; c.fillRect(0, 0, W, H);
    text(c, 'トレーニング：病巣を選ぶ', 360, 100, { size: 50, weight: 'bold' });
    if (!this.types.length) text(c, 'ステージをクリアすると、出てきた病巣を練習できるようになります', W / 2, 500, { size: 34, align: 'center', color: '#9ab' });
    const p = this.app.input.pos;
    for (const b of this.buttons) {
      b.draw(c, b.hit(p));
      if (b.type) {
        const best = ((this.app.save.training.best[b.type] || {})[this.diffId]);
        if (best) text(c, `ベスト：${best.grade}　${best.time.toFixed(1)}秒`, b.x + 20, b.y + b.h - 14, { size: 22, color: '#ffd27a' });
      }
    }
  }
}
export class TrainingResult extends ButtonScene {
  constructor(app, list, diffName) {
    super(app);
    this.list = list; this.diffName = diffName;
    app.sound.se('rank');
    this.buttons = [new Button(W / 2 - 250, 900, 500, 96, '病巣選択に戻る', () => app.toTrainingSelect())];
  }
  draw(c) {
    c.fillStyle = '#0e1a16'; c.fillRect(0, 0, W, H);
    text(c, `トレーニングのリザルト（暫定・${this.diffName}）`, W / 2, 140, { size: 50, align: 'center', weight: 'bold' });
    let y = 260;
    for (const l of this.list) {
      text(c, l.name, 500, y, { size: 38 });
      text(c, l.grade, 980, y, { size: 38, weight: 'bold', color: gradeColor(l.grade) });
      text(c, `${l.score}点`, 1160, y, { size: 38 });
      text(c, `${l.time.toFixed(1)}秒${l.best ? '　ベスト更新！' : ''}`, 1320, y, { size: 34, color: l.best ? '#ffd27a' : '#fff' });
      y += 70;
    }
    this.drawButtons(c);
  }
}
export { betterGrade };
