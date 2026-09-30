// タイトル、ステージセレクト、会話、リザルト、ゲームオーバー（spec/02 3章）
import { W, H } from '../core/view.js';
import { text, wrap, panel, img, Button, ButtonScene } from '../core/ui.js';

// ---- タイトル（ステージセレクトとオプションのみ）----
export class Title extends ButtonScene {
  constructor(app) {
    super(app); this.showOpt = false; this.build();
    app.sound.bgm('title');
  }
  build() {
    const a = this.app, o = a.save.options;
    this.buttons = [
      new Button(760, 620, 400, 90, 'ステージセレクト', () => a.toSelect()),
      new Button(760, 730, 400, 90, 'オプション', () => { this.showOpt = !this.showOpt; this.build(); }, { active: this.showOpt }),
    ];
    if (!this.showOpt) return;
    const row = (y, label, opts, get, set) => opts.forEach(([v, l], k) =>
      this.buttons.push(new Button(1330 + k * 170, y, 160, 64, l, () => { set(v); a.applyOptions(); this.build(); }, { active: get() === v, size: 26 })));
    this.optRows = [['医療機器の配置', 250], ['SE 音量', 340], ['BGM 音量', 430], ['文字送り速度', 520], ['会話画面全スキップ', 610]];
    row(250, '', [['left', '左'], ['right', '右']], () => o.side, v => o.side = v);
    row(340, '', [[0, '0'], [0.4, '40'], [0.7, '70'], [1, '100']], () => o.seVol, v => o.seVol = v);
    row(430, '', [[0, '0'], [0.3, '30'], [0.5, '50'], [0.8, '80']], () => o.bgmVol, v => o.bgmVol = v);
    row(520, '', [['slow', '遅い'], ['normal', '普通'], ['fast', '速い']], () => o.textSpeed, v => o.textSpeed = v);
    row(610, '', [[false, 'OFF'], [true, 'ON']], () => o.skipTalk, v => o.skipTalk = v);
  }
  draw(c) {
    const bg = img('bg_title'); if (bg) c.drawImage(bg, 0, 0, W, H); else { c.fillStyle = '#111'; c.fillRect(0, 0, W, H); }
    text(c, 'OperationTrauma', W / 2, 380, { size: 110, align: 'center', bold: true });
    text(c, '試作 v02（2026-09-26 時点の仕様）', W / 2, 460, { size: 32, align: 'center', color: '#9ab' });
    if (this.showOpt) {
      panel(c, 1010, 200, 880, 500);
      for (const [l, y] of this.optRows) text(c, l, 1040, y + 42, { size: 28 });
    }
    this.drawButtons(c);
  }
}

// ---- ステージセレクト（フローチャートを兼ねる。開放済みだけ表示）----
export class Select extends ButtonScene {
  constructor(app) { super(app); this.pick = null; this.build(); app.sound.bgm('title'); }
  build() {
    const a = this.app, S = a.data.stages;
    this.buttons = [new Button(40, 960, 300, 80, 'タイトルへ', () => a.toTitle())];
    if (this.pick) {
      const last = a.save.lastDifficulty[this.pick] || 'normal';
      a.data.system.difficulties.forEach((d, k) => this.buttons.push(new Button(660 + k * 210, 560, 190, 90, d.name, () => a.startStage(this.pick, d.id), { active: d.id === last })));
      this.buttons.push(new Button(860, 690, 200, 70, 'やめる', () => { this.pick = null; this.build(); }, { size: 28 }));
      return;
    }
    for (const id of S.order) if (a.save.unlocked.includes(id)) {
      const m = S.map[id];
      this.buttons.push(new Button(m.x - 130, m.y - 60, 260, 120, S.stages[id].name, () => { this.pick = id; this.build(); }));
    }
  }
  draw(c) {
    const a = this.app, S = a.data.stages;
    c.fillStyle = '#0e1319'; c.fillRect(0, 0, W, H);
    text(c, 'ステージセレクト', 60, 100, { size: 56, bold: true });
    // 流れと分岐の線
    c.strokeStyle = '#5b6b7d'; c.lineWidth = 6;
    for (const id of S.order) for (const n of S.stages[id].next) if (a.save.unlocked.includes(id) && a.save.unlocked.includes(n.stage)) {
      const p = S.map[id], q = S.map[n.stage]; c.beginPath(); c.moveTo(p.x + 130, p.y); c.lineTo(q.x - 130, q.y); c.stroke();
    }
    this.drawButtons(c);
    for (const id of S.order) if (a.save.unlocked.includes(id) && !this.pick) {
      const m = S.map[id], st = S.stages[id], r = a.save.ranks[id];
      text(c, st.title, m.x, m.y + 95, { size: 24, align: 'center', color: '#9ab' });
      if (r) text(c, `最高 ${r.rank}`, m.x, m.y - 80, { size: 30, align: 'center', color: '#ffe08a', bold: true });
      if (st.hasChoice) text(c, '◆選択肢あり', m.x, m.y + 130, { size: 22, align: 'center', color: '#f0a0ff' });
    }
    if (this.pick) {
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, W, H);
      panel(c, 600, 380, 720, 420);
      text(c, `${S.stages[this.pick].name}　難易度を選ぶ`, W / 2, 470, { size: 40, align: 'center' });
      text(c, '（枠つきは前回選んだ難易度）', W / 2, 520, { size: 24, align: 'center', color: '#9ab' });
      this.drawButtons(c);
    }
  }
}

// ---- 会話（ブリーフィング、選択肢）----
export class Talk {
  constructor(app, talkId, onDone, { briefing } = {}) {
    this.app = app; this.onDone = onDone; this.briefInfo = briefing;
    const T = app.data.talks; this.T = T; this.talk = T.talks[talkId] || { lines: [] };
    this.i = -1; this.left = this.talk.left; this.right = this.talk.right; this.inBrief = false; this.shown = 0; this.choice = null;
    this.speed = { slow: 20, normal: 45, fast: 100 }[app.save.options.textSpeed] || 45;
    app.sound.bgm('talk');
    this.next();
  }
  get line() { return this.talk.lines[this.i]; }
  next() {
    const skip = this.app.save.options.skipTalk;
    for (; ;) {
      this.i += 1;
      const l = this.line;
      if (!l) { this.onDone(); return; }
      if (l.left) this.left = l.left; if (l.right) this.right = l.right;
      if (l.briefing) { this.inBrief = true; this.app.sound.se('select'); if (skip) { this.briefHold = true; return; } continue; }
      if (l.choice) { this.choice = l.choice.map((ch, k) => new Button(560, 380 + k * 120, 800, 96, ch.label, () => { this.app.run.flags[ch.flag] = ch.value; this.choice = null; this.next(); })); return; }
      // 会話画面全スキップ：選択肢とブリーフィングだけ止まる
      if (skip) continue;
      this.shown = 0; this.full = l.text ?? l.narr; return;
    }
  }
  down(p) {
    this.app.sound.unlock();
    if (this.choice) { const b = this.choice.find(b => b.hit(p)); if (b) { this.app.sound.se('select'); b.onClick(); } return; }
    if (this.briefHold) { this.briefHold = false; this.next(); return; }
    if (this.shown < this.full.length) { this.shown = this.full.length; return; }
    this.next();
  }
  key(k) { if (k === 'Enter' || k === ' ') this.down({ x: -1, y: -1 }); }
  update(dt) { if (this.full && this.shown < this.full.length) this.shown = Math.min(this.full.length, this.shown + this.speed * dt); }
  draw(c) {
    const bg = img('bg_clinic'); if (bg) c.drawImage(bg, 0, 0, W, H); else { c.fillStyle = '#1b1f24'; c.fillRect(0, 0, W, H); }
    if (this.inBrief) { c.fillStyle = 'rgba(0,30,60,0.6)'; c.fillRect(0, 0, W, H); }
    const l = this.line || {};
    const ch = (id, x) => {
      const im = id && img(this.T.chars[id]); if (!im) return;
      const scale = Math.min(520 / im.naturalWidth, 780 / im.naturalHeight);
      const drawWidth = im.naturalWidth * scale, drawHeight = im.naturalHeight * scale;
      c.globalAlpha = l.who && l.who !== id ? 0.55 : 1;
      c.drawImage(im, x + (520 - drawWidth) / 2, 120 + (780 - drawHeight) / 2, drawWidth, drawHeight);
      c.globalAlpha = 1;
    };
    ch(this.left, 120); ch(this.right, W - 640);
    if (this.inBrief && this.briefInfo) {
      panel(c, 560, 60, 800, 330, { fill: 'rgba(5,20,40,0.92)', stroke: '#6fb0e0' });
      text(c, 'ブリーフィング', 600, 120, { size: 40, bold: true, color: '#9fe0ff' });
      text(c, `クリア目標：${this.briefInfo.goal}`, 600, 180, { size: 30 });
      text(c, '努力目標：', 600, 235, { size: 28 });
      this.briefInfo.efforts.forEach((e, k) => text(c, `・${e}`, 640, 280 + k * 36, { size: 26, color: '#cde' }));
    }
    if (this.choice) { for (const b of this.choice) b.draw(c, false); return; }
    panel(c, 120, 800, W - 240, 240);
    if (this.briefHold) { text(c, '（会話スキップ中：目標を確認してタップ）', W / 2, 930, { size: 32, align: 'center' }); return; }
    if (l.who) { panel(c, 150, 760, 300, 60, { fill: '#2a3440' }); text(c, this.T.names[l.who], 300, 792, { size: 30, align: 'center', base: 'middle' }); }
    const s = (this.full || '').slice(0, Math.floor(this.shown));
    wrap(c, s, W - 340, 40).forEach((t, k) => text(c, t, 170, 880 + k * 54, { size: 40, color: l.narr ? '#bcd' : '#fff' }));
  }
}

// ---- リザルト ----
export class Result extends ButtonScene {
  constructor(app, res) { super(app); this.res = res; this.buttons = [new Button(760, 900, 400, 90, '次へ', () => app.afterResult())]; app.sound.bgm('result'); }
  draw(c) {
    const r = this.res; c.fillStyle = '#0e1319'; c.fillRect(0, 0, W, H);
    text(c, '手術成功', W / 2, 150, { size: 72, align: 'center', bold: true, color: '#9fe0ff' });
    r.lines.forEach((l, k) => { text(c, l.label, 620, 280 + k * 60, { size: 34, color: l.ok ? '#fff' : '#678' }); text(c, `${l.ok ? l.pts : 0} 点`, 1300, 280 + k * 60, { size: 34, align: 'right', color: l.ok ? '#ffe08a' : '#678' }); });
    text(c, `合計 ${r.score} 点`, 1300, 280 + r.lines.length * 60 + 30, { size: 40, align: 'right', bold: true });
    text(c, r.rank, W / 2, 800, { size: 140, align: 'center', bold: true, color: '#ffe08a' });
    this.drawButtons(c);
  }
}

// ---- ゲームオーバー（リトライかタイトルに戻る）----
export class GameOver extends ButtonScene {
  constructor(app, why) {
    super(app); this.why = why;
    this.buttons = [new Button(560, 700, 360, 90, 'リトライ', () => app.retry()), new Button(1000, 700, 360, 90, 'タイトルに戻る', () => app.toTitle())];
    app.sound.bgm(null);
  }
  draw(c) {
    c.fillStyle = '#1a0808'; c.fillRect(0, 0, W, H);
    text(c, 'GAME OVER', W / 2, 400, { size: 110, align: 'center', bold: true, color: '#ff6060' });
    text(c, this.why, W / 2, 500, { size: 36, align: 'center' });
    this.drawButtons(c);
  }
}
