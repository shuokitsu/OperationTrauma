// タイトル・ステージセレクト・会話・リザルト・ゲームオーバー・トレーニング（spec/02）
import { W, H, text, wrap, panel, drawImg, Button, Typer } from './core.js';

class ButtonScene {
  constructor(app) { this.app = app; this.buttons = []; }
  down(p) {
    this.app.sound.unlock();
    const b = this.buttons.find(b => b.hit(p) && !b.o.disabled);
    if (b) { this.app.sound.se('select'); b.onClick(); }
  }
  hover(p) { this.hoverP = p; }
  move(p) { this.hoverP = p; }
  up() {}
  key() {}
  update() {}
  drawButtons(c) { for (const b of this.buttons) b.draw(c, b.hit(this.hoverP)); }
}

export class Title extends ButtonScene {
  constructor(app, o = {}) {
    super(app);
    this.showOptions = !!o.showOptions;   // オプションはタイトル画面のまま表示する（画面遷移しない：spec/02 3.1）
    this.build();
    app.sound.bgm('title');
  }
  build() {
    const app = this.app, opt = app.save.options;
    this.buttons = [
      new Button(120, 640, 460, 100, 'ステージセレクト', () => app.go(new StageSelect(app)), { size: 36 }),
      new Button(120, 760, 460, 100, 'トレーニング', () => app.go(new TrainingSelect(app)), { size: 36 }),
      new Button(120, 880, 460, 100, 'オプション', () => { this.showOptions = !this.showOptions; this.build(); }, { size: 36, active: this.showOptions, activeColor: '#9fd3ff', fill: this.showOptions ? '#3d6e96' : undefined }),
      new Button(1560, 1000, 320, 60, '試作：セーブ消去', () => { app.resetSave(); app.go(new Title(app)); }, { size: 22, fill: '#4a2a2a' }),
      new Button(1220, 1000, 320, 60, '試作：全ステージ開放', () => { app.unlockAll(); app.go(new Title(app)); }, { size: 22, fill: '#2a3a4a' }),
    ];
    this.rows = []; this.panel = null;
    if (!this.showOptions) return;
    const rows = [
      ['医療機器の配置', 'side', [['左', 'left'], ['右', 'right']]],
      ['SE 音量', 'se', [['0', 0], ['40', 40], ['70', 70], ['100', 100]]],
      ['BGM 音量', 'bgm', [['0', 0], ['30', 30], ['50', 50], ['80', 80]]],
      ['文字送り速度', 'textSpeed', [['遅い', 'slow'], ['普通', 'normal'], ['速い', 'fast']]],
      ['会話画面全スキップ', 'skipTalk', [['OFF', false], ['ON', true]]],
    ];
    // パネルの幅は、いちばん多いボタンの数から計算する（はみ出さない）
    const BW = 200, BH = 84, GAP = 20, LABEL = 330, PAD = 50;
    const maxN = Math.max(...rows.map(r => r[2].length));
    const pw = PAD + LABEL + maxN * BW + (maxN - 1) * GAP + PAD;
    const px = 1880 - pw, py = 60, rowH = 116;
    this.panel = { x: px, y: py, w: pw, h: PAD + rows.length * rowH - (rowH - BH) + PAD };
    rows.forEach(([label, keyName, vals], i) => {
      const y = py + PAD + i * rowH;
      this.rows.push({ label, y: y + BH / 2 });
      vals.forEach(([t, v], k) => {
        this.buttons.push(new Button(px + PAD + LABEL + k * (BW + GAP), y, BW, BH, t, () => {
          opt[keyName] = v; app.writeSave(); app.applyOptions(); this.build();
        }, { size: 30, active: opt[keyName] === v, activeColor: '#9fd3ff', fill: opt[keyName] === v ? '#3d6e96' : '#1b2330' }));
      });
    });
  }
  draw(c) {
    if (!drawImg(c, 'bg_title.svg', 0, 0, W, H)) { c.fillStyle = '#123'; c.fillRect(0, 0, W, H); }
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 0, W, H);
    text(c, 'OperationTrauma', 80, 330, { size: 140, bold: true, stroke: 6 });
    text(c, '試作 v03（2026-10-03 時点の仕様）', 300, 440, { size: 36, color: '#9aa7b8' });
    if (this.panel) {
      const p = this.panel;
      panel(c, p.x, p.y, p.w, p.h, { fill: 'rgba(12,16,22,0.94)', stroke: '#5b6878' });
      for (const r of this.rows) text(c, r.label, p.x + 50, r.y + 2, { size: 32, base: 'middle' });
    }
    this.drawButtons(c);
  }
}

export class StageSelect extends ButtonScene {
  constructor(app) {
    super(app);
    const S = app.save;
    // ステージのつながり（クリアで開放されるステージ）をステージデータから作り、フローチャートとして並べる（spec/02 3.2）
    const all = app.data.stages.stages, byId = Object.fromEntries(all.map(s => [s.id, s]));
    const next = id => { const oc = byId[id].on_clear || {}; return [...(oc.unlock || []), ...(oc.unlock_if || []).map(u => u.stage)].filter(n => byId[n]); };
    const depth = { [all[0].id]: 0 }, queue = [all[0].id];
    while (queue.length) { const id = queue.shift(); for (const n of next(id)) if (depth[n] === undefined) { depth[n] = depth[id] + 1; queue.push(n); } }
    const cols = {}; all.forEach(s => { const d = depth[s.id] ?? 0; (cols[d] = cols[d] || []).push(s.id); });
    const NW = 320, NH = 150, GX = 360, CY = 560, GY = 210;
    this.pos = {};
    Object.entries(cols).forEach(([d, ids]) => ids.forEach((id, k) => { this.pos[id] = { x: 100 + d * GX, y: CY + (k - (ids.length - 1) / 2) * GY - NH / 2 }; }));
    this.edges = [];
    all.forEach(s => next(s.id).forEach(n => this.edges.push([s.id, n])));
    this.unlocked = new Set(S.unlocked);
    all.filter(s => S.unlocked.includes(s.id)).forEach(s => {
      const best = S.bestRank[s.id], p = this.pos[s.id];
      const choice = (app.data.talks[s.talk_before] || []).some(l => l.choice) || s.steps.some(st => st.dialogue_before && (app.data.talks[st.dialogue_before] || []).some(l => l.choice));
      this.buttons.push(new Button(p.x, p.y, NW, NH, s.name, () => this.pick(s),
        { size: 36, bold: true, active: S.cleared.includes(s.id), activeColor: '#7fd18f', sub: `${choice ? '◆選択肢あり　' : ''}${best ? `最高ランク ${best}` : S.cleared.includes(s.id) ? 'クリア' : '未クリア'}` }));
    });
    this.NW = NW; this.NH = NH;
    this.buttons.push(new Button(60, 960, 300, 80, 'タイトルへ', () => app.toTitle()));
    app.sound.bgm('title');
  }
  pick(s) {
    // 難易度はステージ選択の直後に、ステージごとに選ぶ（spec/02 3.2）
    const app = this.app;
    this.popup = app.data.system.difficulties.map((d, i) => new Button(610 + i * 240, 520, 220, 110, d.name, () => {
      this.popup = null; app.beginStage(s, d.id);
    }, { size: 32 }));
    this.popup.push(new Button(810, 680, 300, 80, 'やめる', () => { this.popup = null; }, { size: 26 }));
    this.popupStage = s;
  }
  down(p) {
    if (this.popup) { const b = this.popup.find(b => b.hit(p)); if (b) { this.app.sound.se('select'); b.onClick(); } return; }
    super.down(p);
  }
  draw(c) {
    c.fillStyle = '#18202b'; c.fillRect(0, 0, W, H);
    text(c, 'ステージセレクト', 80, 120, { size: 56, bold: true });
    text(c, '開放済みのステージだけを表示。線はクリアで開放されるつながり（分岐を含む）', 80, 175, { size: 24, color: '#aab' });
    // つながりの線（両端とも開放済みのものだけ）。分岐は折れ線
    c.strokeStyle = '#5b6b7d'; c.lineWidth = 6; c.lineJoin = 'round';
    for (const [a, b] of this.edges) {
      if (!this.unlocked.has(a) || !this.unlocked.has(b)) continue;
      const p = this.pos[a], q = this.pos[b], x1 = p.x + this.NW, y1 = p.y + this.NH / 2, x2 = q.x, y2 = q.y + this.NH / 2, mx = (x1 + x2) / 2;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(mx, y1); c.lineTo(mx, y2); c.lineTo(x2, y2); c.stroke();
    }
    this.drawButtons(c);
    if (this.popup) {
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, W, H);
      panel(c, 560, 380, 800, 420);
      text(c, `${this.popupStage.name}：難易度を選ぶ`, W / 2, 460, { size: 36, align: 'center' });
      this.popup.forEach(b => b.draw(c, b.hit(this.hoverP)));
    }
  }
}

// 会話画面（ブリーフィング込み）。背景は会話の途中で差し替えられる（B1）
export class Talk extends ButtonScene {
  constructor(app, lines, then, o = {}) {
    super(app);
    this.then = then; this.flags = o.flags || new Set();
    const skip = app.save.options.skipTalk && !o.noSkip;
    // 会話画面全スキップ：ブリーフィングは飛ばさない。選択肢はブリーフィングでまとめて出す
    let ls = lines || [];
    if (skip) {
      const choices = ls.filter(l => l.choice), brief = ls.filter(l => l.briefing);
      ls = brief.length ? [...brief.slice(0, 1), ...choices.map(ch => ({ ...ch, bg: brief[0].bg, briefing: true })), ...brief.slice(1)] : choices;
    }
    this.lines = ls; this.i = -1; this.bg = 'bg_clinic.svg'; this.left = null; this.right = null;
    this.title = o.title || '';
    this.typer = new Typer(app.save.options.textSpeed);
    app.sound.bgm('talk');
    this.next();
    this.started = true;
  }
  next() {
    this.i++;
    const ln = this.lines[this.i];
    if (!ln) { this.done = true; if (this.started) this.then(this.flags); else this.finishLater = true; return; }
    if (ln.bg) this.bg = ln.bg;
    if ('left' in ln) this.left = ln.left; if ('right' in ln) this.right = ln.right;
    this.typer.reset(ln.t);
    this.buttons = ln.choice ? ln.choice.map((ch, k) => new Button(460, 260 + k * 130, 1000, 104, ch.t, () => { this.flags.add(ch.flag); this.next(); }, { size: 30 })) : [];
  }
  down(p) {
    this.app.sound.unlock();
    if (this.done) return;
    if (!this.typer.done) { this.typer.finish(); return; }   // 表示の途中でタップしたら、その行を全部出す
    if (this.buttons.length) return super.down(p);
    this.app.sound.se('text'); this.next();
  }
  update(dt) { if (this.finishLater) { this.finishLater = false; this.then(this.flags); return; } this.typer.update(dt);
  }
  draw(c) {
    const ln = this.lines[this.i] || {};
    if (!drawImg(c, this.bg, 0, 0, W, H)) { c.fillStyle = '#222'; c.fillRect(0, 0, W, H); }
    const ch = this.app.data.talks.characters;
    if (this.left && ch[this.left]) drawImg(c, ch[this.left].image, 120, 60, 520, 820, 'contain');
    if (this.right && ch[this.right]) drawImg(c, ch[this.right].image, 1280, 60, 520, 820, 'contain');
    if (ln.briefing) {
      panel(c, 560, 60, 800, 150, { fill: 'rgba(10,30,50,0.9)', stroke: '#5fa8ff' });
      text(c, 'ブリーフィング', W / 2, 115, { size: 30, align: 'center', color: '#9fd0ff', bold: true });
      if (this.goals) {
        text(c, `クリア目標：${this.goals.clear}`, W / 2, 158, { size: 24, align: 'center' });
        text(c, `努力目標：${(this.goals.effort || []).map(e => `${e.text}（+${e.bonus}）`).join('、') || 'なし'}`, W / 2, 192, { size: 22, align: 'center', color: '#ffe08a' });
      }
    }
    panel(c, 120, 760, 1680, 280);
    if (ln.who) text(c, ln.who, 160, 815, { size: 32, color: '#9fc6ff', bold: true });
    wrap(c, this.typer.shown, 1580, 38).forEach((s, i) => text(c, s, 160, 880 + i * 52, { size: 38 }));
    if (this.buttons.length) { if (this.typer.done) this.drawButtons(c); }   // 選択肢は文字が出きってから
    else text(c, '▼ タップで次へ', 1770, 1015, { size: 22, align: 'right', color: '#aaa' });
  }
}

// 開始位置の選択（ブリーフィングのあと。到達済みのコンティニューポイントがあるときだけ：spec/02 3.3）
export class StartPosition extends ButtonScene {
  constructor(app, stage, entries, onPick) {
    super(app);
    this.stage = stage;
    const opts = [{ label: 'ステージの最初から', step: 0, flags: null }].concat(entries.map(e => ({ label: `ステップ ${e.step + 1} から再開（コンティニューポイント）`, step: e.step, flags: e.flags })));
    this.buttons = opts.map((o, i) => new Button(560, 360 + i * 130, 800, 104, o.label, () => onPick(o), { size: 30 }));
  }
  draw(c) {
    c.fillStyle = '#10161f'; c.fillRect(0, 0, W, H);
    panel(c, 480, 200, 960, 700);
    text(c, `${this.stage.name}：開始位置を選ぶ`, W / 2, 280, { size: 40, align: 'center', bold: true });
    text(c, 'コンティニューポイントから始めると、状態はステージ開始時に戻り、点数も 0 から（それより前の病巣は 0 点）', W / 2, 330, { size: 20, align: 'center', color: '#ffd28a' });
    this.drawButtons(c);
  }
}

export class Result extends ButtonScene {
  constructor(app, sg, then) {
    super(app);
    this.r = sg.result; this.stage = sg.stage;
    this.buttons = [new Button(760, 960, 400, 90, '次へ', then, { size: 34 })];
    app.sound.bgm('result');
  }
  draw(c) {
    const r = this.r;
    c.fillStyle = '#141b26'; c.fillRect(0, 0, W, H);
    text(c, `${this.stage.name}　リザルト`, 100, 110, { size: 56, bold: true });
    text(c, r.rank ? r.rank : '（ランクなし）', 1500, 200, { size: r.rank ? 140 : 40, align: 'center', bold: true, color: '#ffd24a', stroke: 6 });
    text(c, `点数 ${r.score} / 最大 ${r.max}（${r.ratio === null ? '-' : Math.round(r.ratio * 1000) / 10 + '%'}）`, 1500, 290, { size: 30, align: 'center' });
    if (r.startStep) text(c, `ステップ ${r.startStep + 1} から開始：それより前の病巣 ${r.pre} 個は 0 点`, 1500, 340, { size: 22, align: 'center', color: '#ffb080' });
    text(c, `バイタル ${r.vital}　ミス ${r.fails}　時間 ${Math.floor(r.time)}秒`, 100, 180, { size: 30, color: '#cde' });
    let y = 250;
    text(c, '病巣の評価', 100, y, { size: 32, color: '#9fc6ff' }); y += 46;
    for (const l of r.lesions.slice(0, 14)) {
      const s = l.score || { total: 0, eval: '-' };
      text(c, `${l.name}`, 120, y, { size: 26 });
      text(c, `${s.eval}`, 520, y, { size: 26, bold: true, color: { Cool: '#7ff0ff', Good: '#8fff8f', Fine: '#ffe36b', Bad: '#ff8a8a' }[s.eval] || '#aaa' });
      text(c, `${s.total}点（時間 ${s.timePts ?? 0}・ミス ${l.fails}・省略 ${l.skips}${l.coverPenalty ? `・塗り残し -${l.coverPenalty}` : ''}）`, 680, y, { size: 22, color: '#bbb' });
      y += 38;
    }
    y += 10;
    text(c, '努力目標', 100, y, { size: 32, color: '#9fc6ff' }); y += 44;
    if (!r.bonus.length) text(c, 'なし', 120, y, { size: 24, color: '#aaa' });
    for (const b of r.bonus) { text(c, `${b.ok ? '達成' : '未達成'}　${b.text}（+${b.bonus}）`, 120, y, { size: 26, color: b.ok ? '#8fff8f' : '#aaa' }); y += 38; }
    this.drawButtons(c);
  }
}

export class GameOver extends ButtonScene {
  constructor(app, sg, cause) {
    super(app);
    this.cause = cause;
    this.buttons = [
      new Button(560, 620, 380, 100, 'リトライ', () => sg.retry(), { size: 34, sub: sg.lastCP ? `ステップ ${sg.lastCP + 1} から` : '最初から' }),
      new Button(980, 620, 380, 100, 'タイトルに戻る', () => app.toTitle(), { size: 34 }),
    ];
  }
  draw(c) {
    c.fillStyle = '#200'; c.fillRect(0, 0, W, H);
    text(c, 'GAME OVER', W / 2, 380, { size: 120, align: 'center', bold: true, color: '#f55' });
    text(c, { vital_zero: 'バイタルが 0 になった', dose_limit: '薬の限度量を超えた', timeout: '時間切れ' }[this.cause], W / 2, 470, { size: 36, align: 'center' });
    this.drawButtons(c);
  }
}

export class TrainingSelect extends ButtonScene {
  constructor(app, o = {}) {
    super(app);
    this.diffIdx = o.diffIdx ?? 1;
    const L = app.data.lesions;
    const kinds = app.save.trained.filter(k => L[k]);
    this.buttons = [];
    kinds.forEach((k, i) => {
      const best = app.save.trainingBest[k + '|' + this.diffId()];
      this.buttons.push(new Button(120 + (i % 4) * 430, 300 + Math.floor(i / 4) * 150, 400, 120, L[k].name, () => app.startTraining({ mode: 'pick', kinds: [k], diffIdx: this.diffIdx }),
        { size: 32, sub: best ? `最高 ${best.eval}・最短 ${best.time.toFixed(1)}秒` : '' }));
    });
    this.buttons.push(new Button(1300, 140, 520, 100, `ランダム（${app.data.stages.training.random_count}つ連続）`, () => {
      if (!kinds.length) return;
      const q = Array.from({ length: app.data.stages.training.random_count }, () => kinds[Math.floor(Math.random() * kinds.length)]);
      app.startTraining({ mode: 'random', kinds: q, diffIdx: this.diffIdx });
    }, { size: 30, disabled: !kinds.length }));
    // 難易度の切り替えを常に表示（A8）
    this.buttons.push(new Button(700, 140, 520, 100, `難易度：${app.data.system.difficulties[this.diffIdx].name}（切り替え）`, () => app.go(new TrainingSelect(app, { diffIdx: (this.diffIdx + 1) % 3 })), { size: 28 }));
    this.buttons.push(new Button(60, 960, 300, 80, 'タイトルへ', () => app.toTitle()));
    this.buttons.push(new Button(1480, 980, 400, 70, '試作：全病巣を練習可能に', () => { app.save.trained = Object.keys(L).filter(k => !k.startsWith('_') && !L[k].runtime); app.writeSave(); app.go(new TrainingSelect(app, { diffIdx: this.diffIdx })); }, { size: 22, fill: '#2a3a4a' }));
    this.kinds = kinds;
    app.sound.bgm('title');
  }
  diffId() { return this.app.data.system.difficulties[this.diffIdx].id; }
  draw(c) {
    c.fillStyle = '#16212b'; c.fillRect(0, 0, W, H);
    text(c, 'トレーニング：病巣選択', 80, 110, { size: 52, bold: true });
    if (!this.kinds.length) text(c, 'まだ練習できる病巣がありません（その病巣が出るステージをクリアすると増えます）', 120, 360, { size: 30, color: '#aab' });
    this.drawButtons(c);
  }
}

export class TrainingResult extends ButtonScene {
  constructor(app, sg) {
    super(app);
    this.ls = sg.allLesions().filter(l => !l.runtime);
    this.buttons = [new Button(760, 940, 400, 90, '病巣選択へ', () => app.go(new TrainingSelect(app, { diffIdx: sg.training.diffIdx })), { size: 32 })];
  }
  draw(c) {
    c.fillStyle = '#14202a'; c.fillRect(0, 0, W, H);
    text(c, 'トレーニング　リザルト（暫定）', 100, 120, { size: 52, bold: true });
    let y = 220;
    for (const l of this.ls) {
      const s = l.score || { total: 0, eval: '-', time: 0 };
      text(c, `${l.name}　${s.eval}　${s.total}点　${s.time.toFixed(1)}秒　ミス ${l.fails}`, 140, y, { size: 32 }); y += 56;
    }
    this.drawButtons(c);
  }
}
