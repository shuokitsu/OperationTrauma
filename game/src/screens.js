// タイトル、オプション、ステージセレクト、読み込み、リザルト、ゲームオーバー、トレーニング、エンディングと、ステージの進行。

import { Assets } from './assets.js';
import { Save } from './save.js';
import { W, H, COLOR, text, textBlock, panel, Button, clickButtons, drawImage, dim } from './ui.js';
import { TalkScreen, condOk } from './talk.js';
import { Surgery } from './surgery.js';

const RATE_COLOR = { Cool: '#6fe3ff', Good: '#5ad67d', Fine: '#f2c14e', Bad: '#e5484d' };

function taps(events) { return events.filter(e => e.type === 'down'); }

// ================= タイトル =================
export class TitleScreen {
  constructor(app) {
    this.app = app;
    this.options = null;
    Assets.playBgm('title');
    const bw = 520, bh = 100, x = (W - bw) / 2;
    this.buttons = [
      new Button(x, 560, bw, bh, 'ステージセレクト', () => app.go(new StageSelectScreen(app))),
      new Button(x, 690, bw, bh, 'トレーニング', () => app.go(new TrainingScreen(app))),
      new Button(x, 820, bw, bh, 'オプション', () => { this.options = this.options ? null : new OptionsPanel(() => { this.options = null; }); })
    ];
    if (app.debug) {
      this.buttons.push(
        new Button(60, 940, 380, 70, '確認用：セーブ消去', () => { Save.erase(); }, { size: 26 }),
        new Button(60, 850, 380, 70, '確認用：全ステージ開放', () => {
          Save.data.unlocked = app.data.stageList.stages.map(s => s.id); Save.write();
        }, { size: 26 })
      );
    }
  }
  update(dt, events) {
    for (const e of taps(events)) {
      if (this.options) { this.options.click(e.x, e.y); continue; }
      clickButtons(this.buttons, e.x, e.y);
    }
  }
  draw(ctx) {
    drawImage(ctx, this.app.data.system.title_bg, 0, 0, W, H, 'cover');
    dim(ctx, 0.25);
    text(ctx, 'OperationTrauma', W / 2, 300, { size: 130, align: 'center', bold: true, stroke: '#000', strokeWidth: 10 });
    this.buttons.forEach(b => b.draw(ctx));
    if (this.options) this.options.draw(ctx);
  }
}

// ================= オプション（タイトル画面に重ねる） =================
class OptionsPanel {
  constructor(onClose) {
    const o = Save.data.options;
    const vols = [0, 0.2, 0.4, 0.6, 0.8, 1];
    this.rows = [
      { label: '医療機器の配置', key: 'side', values: [['left', '左'], ['right', '右']] },
      { label: 'SE 音量', key: 'se', values: vols.map(v => [v, String(Math.round(v * 100))]) },
      { label: 'BGM 音量', key: 'bgm', values: vols.map(v => [v, String(Math.round(v * 100))]) },
      { label: '文字送り速度', key: 'textSpeed', values: [['slow', '遅い'], ['normal', 'ふつう'], ['fast', '速い']] },
      { label: '会話画面全スキップ', key: 'skipTalk', values: [[false, 'OFF'], [true, 'ON']] },
      { label: '操作ガイド', key: 'guide', values: [[true, 'ON'], [false, 'OFF']] }
    ];
    // パネルの幅はボタンの数から決める（画面からはみ出さない）
    const bw = 130, bh = 72, gap = 14, labelW = 430, most = Math.max(...this.rows.map(r => r.values.length));
    this.w = labelW + most * (bw + gap) + 80;
    this.h = 110 + this.rows.length * 96 + 130;
    this.x = (W - this.w) / 2; this.y = (H - this.h) / 2;
    this.buttons = [];
    this.rows.forEach((r, i) => r.values.forEach(([v, label], k) => {
      const b = new Button(this.x + 40 + labelW + k * (bw + gap), this.y + 110 + i * 96, bw, bh, label, () => {
        o[r.key] = v; Save.write(); Assets.applyVolume(); this.sync();
      }, { size: 30 });
      b.row = r; b.value = v;
      this.buttons.push(b);
    }));
    this.close = new Button(this.x + this.w / 2 - 160, this.y + this.h - 110, 320, 80, '閉じる', onClose);
    this.sync();
  }
  sync() {
    for (const b of this.buttons) b.selected = Math.abs((Save.data.options[b.row.key] ?? 0) - b.value) < 1e-9 || Save.data.options[b.row.key] === b.value;
  }
  click(x, y) { clickButtons([...this.buttons, this.close], x, y); }
  draw(ctx) {
    dim(ctx, 0.6);
    panel(ctx, this.x, this.y, this.w, this.h);
    text(ctx, 'オプション', this.x + this.w / 2, this.y + 58, { size: 44, align: 'center', bold: true });
    this.rows.forEach((r, i) => text(ctx, r.label, this.x + 50, this.y + 146 + i * 96, { size: 34 }));
    this.buttons.forEach(b => b.draw(ctx));
    this.close.draw(ctx);
  }
}

// ================= ステージセレクト（シナリオのフローチャートを兼ねる） =================
function isUnlocked(app, id) {
  if (Save.data.unlocked.includes(id)) return true;
  const u = app.data.stages[id].unlock || {};
  return (u.cleared || []).every(c => Save.data.cleared[c]) && (u.flags || []).every(f => Save.hasFlag(f));
}

function hasChoice(stage) {
  const all = [...(stage.talk_before || []), ...(stage.briefing || []), ...(stage.steps || []).flatMap(s => [...(s.talk_before || []), ...(s.talk_after || [])])];
  return all.some(l => l.choice);
}

export class StageSelectScreen {
  constructor(app) {
    this.app = app;
    this.popup = null;
    Assets.playBgm('title');
    let changed = false;
    this.nodes = app.data.stageList.stages.filter(s => {
      const ok = isUnlocked(app, s.id);
      if (ok && !Save.data.unlocked.includes(s.id)) { Save.data.unlocked.push(s.id); changed = true; }   // 開放済みのステージは閉じない
      return ok;
    });
    if (changed) Save.write();
    this.buttons = this.nodes.map(n => new Button(n.x, n.y, 380, 190, '', () => this.pick(n.id)));
    this.back = new Button(60, 960, 300, 80, 'タイトルに戻る', () => app.go(new TitleScreen(app)), { size: 30 });
  }
  pick(id) {
    const sys = this.app.data.system;
    const last = Save.data.lastDifficulty[id] || sys.default_difficulty;
    const bw = 380, x0 = W / 2 - (sys.difficulties.length * (bw + 30) - 30) / 2;
    const btns = sys.difficulties.map((d, k) => {
      const b = new Button(x0 + k * (bw + 30), 500, bw, 130, d.name, () => startStage(this.app, id, d.id), { size: 44 });
      b.selected = d.id === last;
      return b;
    });
    btns.push(new Button(W / 2 - 160, 690, 320, 80, 'やめる', () => { this.popup = null; }, { size: 30, se: 'cancel' }));
    this.popup = { id, btns };
  }
  update(dt, events) {
    for (const e of taps(events)) {
      if (this.popup) { clickButtons(this.popup.btns, e.x, e.y); continue; }
      clickButtons([...this.buttons, this.back], e.x, e.y);
    }
  }
  draw(ctx) {
    drawImage(ctx, this.app.data.system.title_bg, 0, 0, W, H, 'cover');
    dim(ctx, 0.55);
    text(ctx, 'ステージセレクト', 80, 80, { size: 54, bold: true });
    // ステージどうしを線で結ぶ
    ctx.strokeStyle = '#6b7b8d'; ctx.lineWidth = 6;
    for (const n of this.nodes) for (const nx of n.next || []) {
      const m = this.nodes.find(q => q.id === nx);
      if (!m) continue;
      ctx.beginPath(); ctx.moveTo(n.x + 190, n.y + 95); ctx.lineTo(m.x + 190, m.y + 95); ctx.stroke();
    }
    this.nodes.forEach((n, i) => {
      const b = this.buttons[i], st = this.app.data.stages[n.id], cl = Save.data.cleared[n.id];
      b.draw(ctx);
      text(ctx, st.name, n.x + 24, n.y + 40, { size: 36, bold: true });
      textBlock(ctx, st.title || '', n.x + 24, n.y + 72, 250, { size: 26, color: COLOR.dim, lineHeight: 34 });
      if (hasChoice(st)) text(ctx, '選択肢あり', n.x + 24, n.y + 162, { size: 22, color: COLOR.accent });
      if (cl) {
        if (cl.rank) text(ctx, cl.rank, n.x + 318, n.y + 100, { size: 76, align: 'center', bold: true, color: COLOR.accent });
        else text(ctx, 'CLEAR', n.x + 310, n.y + 100, { size: 28, align: 'center', bold: true, color: COLOR.good });
      }
    });
    this.back.draw(ctx);
    if (this.popup) {
      dim(ctx, 0.65);
      panel(ctx, 260, 330, 1400, 500);
      text(ctx, this.app.data.stages[this.popup.id].name + '　難易度を選んでください', W / 2, 410, { size: 44, align: 'center', bold: true });
      this.popup.btns.forEach(b => b.draw(ctx));
    }
  }
}

// ================= 読み込み（そのステージの素材をまとめて読む） =================
class LoadingScreen {
  constructor(app, stage, then) {
    this.msg = '読み込んでいます';
    const names = [];
    for (const p of Object.values(stage.patients || {})) names.push(...(p.images || []), ...(p.fallback_images || []));
    const talks = [stage.talk_before, stage.briefing, stage.talk_after, ...Object.values(stage.gameover_talks || {}),
      ...(stage.steps || []).flatMap(s => [s.talk_before, s.talk_after])];
    for (const t of talks) for (const l of t || []) if (l.bg) names.push(l.bg);
    Assets.loadImages(names, (n, t) => { this.msg = `読み込んでいます ${n}/${t}`; }).then(() => { this.ready = then; });
  }
  update() { if (this.ready) { const f = this.ready; this.ready = null; f(); } }
  draw(ctx) { text(ctx, this.msg, W / 2, H / 2, { size: 40, align: 'center', color: COLOR.dim }); }
}

// ================= ステージの進行 =================
// ステージ選択 → 難易度 → 会話・ブリーフィング（選択肢）→ 開始位置 → ゲーム → リザルト → 手術後の会話
export function startStage(app, stageId, diffId) {
  const stage = app.data.stages[stageId];
  const diff = app.data.system.difficulties.find(d => d.id === diffId);
  Save.data.lastDifficulty[stageId] = diffId;
  Save.write();
  app.go(new LoadingScreen(app, stage, () => {
    const flags = new Set(Save.data.flags);
    const lines = [...(stage.talk_before || [])];
    if (stage.briefing) lines.push({ briefing: true }, ...stage.briefing);
    const talk = new TalkScreen(app, lines, {
      flags, skip: Save.data.options.skipTalk, bgm: 'talk',
      goals: { clear: stage.goals?.clear, effort: stage.goals?.effort },
      onEnd: () => {
        const key = talk.player.picked.join('+') || 'default';
        const reached = Save.data.continuePoints[stage.id]?.[key] || {};
        const list = stage.steps.filter(s => reached[s.id]);
        const run = (startAfter) => runSurgery(app, {
          stage, diff, choiceKey: key, startAfter,
          flags: startAfter ? new Set(reached[startAfter].flags) : flags
        });
        if (!list.length) run(null);
        else app.go(new StartSelectScreen(talk, list.map(s => [s.id, reached[s.id].name]), run));
      }
    });
    app.go(talk);
  }));
}

// 開始位置の選択（到達済みのコンティニューポイントがあるとき。会話画面の上に出す）
class StartSelectScreen {
  constructor(under, list, run) {
    this.under = under;
    const items = [[null, '最初から'], ...list];
    const bw = 900, bh = 100, y0 = H / 2 - (items.length * (bh + 24)) / 2 + 40;
    this.buttons = items.map(([id, name], k) => new Button((W - bw) / 2, y0 + k * (bh + 24), bw, bh, name, () => run(id)));
    this.top = y0;
  }
  update(dt, events) { for (const e of taps(events)) clickButtons(this.buttons, e.x, e.y); }
  draw(ctx) {
    this.under.draw(ctx);
    dim(ctx, 0.6);
    text(ctx, 'どこから始めますか', W / 2, this.top - 70, { size: 46, align: 'center', bold: true });
    this.buttons.forEach(b => b.draw(ctx));
  }
}

function runSurgery(app, c) {
  const game = new Surgery(app, {
    stage: c.stage, difficulty: c.diff, flags: c.flags, startAfter: c.startAfter, choiceKey: c.choiceKey,
    onClear: r => finishStage(app, c, r),
    onGameOver: () => app.go(new GameOverScreen(app, retry)),
    onRetry: () => retry(),
    onQuit: () => app.go(new TitleScreen(app))
  });
  // リトライ：最後に通過したコンティニューポイントから。状態はステージ開始時に戻る
  function retry() {
    const cp = game.lastCP;
    runSurgery(app, { ...c, startAfter: cp ? cp.id : null, flags: new Set(cp ? cp.flags : game.initialFlags) });
  }
  app.go(game);
}

function finishStage(app, c, r) {
  const stage = c.stage, flags = r.flags;
  // クリア後の処理（フラグ・開放するステージ。結果のフラグで分けて書ける）
  for (const oc of [].concat(stage.on_clear || [])) {
    if (!condOk(oc, flags)) continue;
    for (const f of oc.clear_flags || []) flags.delete(f);
    for (const f of oc.set_flags || []) flags.add(f);
    for (const s of oc.unlock_stages || []) if (!Save.data.unlocked.includes(s)) Save.data.unlocked.push(s);
  }
  Save.data.flags = [...flags];
  Save.recordClear(stage.id, r.rank, r.ratio);
  Save.recordTreated(r.treated);
  Save.write();
  app.go(new ResultScreen(app, stage.name, r, () => {
    app.go(new TalkScreen(app, stage.talk_after || [], {
      flags, skip: Save.data.options.skipTalk, bgm: 'talk',
      onEnd: () => app.go(stage.ending ? new EndingScreen(app, stage.ending) : new StageSelectScreen(app))
    }));
  }));
}

// ================= リザルト =================
class ResultScreen {
  constructor(app, title, r, next) {
    Object.assign(this, { app, title, r, next, t: 0 });
    Assets.playBgm('result');
    Assets.se(r.rank ? 'rank' : 'clear');
  }
  update(dt, events) {
    this.t += dt;
    if (this.t > 0.6 && taps(events).length) { const n = this.next; this.next = () => {}; n(); }
  }
  draw(ctx) {
    const r = this.r;
    ctx.fillStyle = '#0d1014'; ctx.fillRect(0, 0, W, H);
    text(ctx, this.title + '　リザルト', 100, 90, { size: 54, bold: true });
    // 病巣ごとの評価
    const rows = r.records, cols = rows.length > 10 ? 2 : 1, per = Math.ceil(rows.length / cols) || 1;
    const lh = Math.min(64, 640 / per);
    rows.forEach((rec, i) => {
      const cx = 100 + Math.floor(i / per) * 560, y = 190 + (i % per) * lh;
      text(ctx, rec.name + (rec.unfinished ? '（未治療）' : ''), cx, y, { size: 30 });
      text(ctx, rec.rating, cx + 330, y, { size: 32, bold: true, color: RATE_COLOR[rec.rating] });
      text(ctx, `${rec.score}点`, cx + 520, y, { size: 30, align: 'right', color: COLOR.dim });
    });
    if (!rows.length) text(ctx, '採点する病巣はありません', 100, 200, { size: 30, color: COLOR.dim });
    // 努力目標
    r.effort.forEach((e, k) => {
      text(ctx, (e.ok ? '達成　' : '未達成　') + e.text + `（+${e.bonus}点）`, 100, 880 + k * 46, { size: 30, color: e.ok ? COLOR.good : COLOR.dim });
    });
    // ランク
    panel(ctx, 1300, 180, 520, 560);
    if (r.rank) {
      text(ctx, 'RANK', 1560, 250, { size: 40, align: 'center', color: COLOR.dim, bold: true });
      text(ctx, r.rank, 1560, 440, { size: 240, align: 'center', bold: true, color: COLOR.accent });
      text(ctx, `${r.got} / ${r.max} 点`, 1560, 640, { size: 40, align: 'center' });
      text(ctx, `${Math.floor(r.ratio * 1000) / 10}%`, 1560, 695, { size: 30, align: 'center', color: COLOR.dim });
    } else {
      text(ctx, 'CLEAR', 1560, 440, { size: 120, align: 'center', bold: true, color: COLOR.good });
    }
    if (this.t > 0.6 && Math.floor(this.app.time * 2) % 2 === 0) text(ctx, 'タップで次へ', W / 2, 1020, { size: 34, align: 'center', color: COLOR.dim });
  }
}

// ================= ゲームオーバー =================
class GameOverScreen {
  constructor(app, retry) {
    this.app = app;
    Assets.playBgm('gameover');
    const bw = 520, x = (W - bw) / 2;
    this.buttons = [
      new Button(x, 620, bw, 110, 'リトライ', retry),
      new Button(x, 770, bw, 110, 'タイトルに戻る', () => app.go(new TitleScreen(app)))
    ];
  }
  update(dt, events) { for (const e of taps(events)) clickButtons(this.buttons, e.x, e.y); }
  draw(ctx) {
    ctx.fillStyle = '#120608'; ctx.fillRect(0, 0, W, H);
    text(ctx, 'GAME OVER', W / 2, 360, { size: 170, align: 'center', bold: true, color: COLOR.bad });
    this.buttons.forEach(b => b.draw(ctx));
  }
}

// ================= エンディング =================
class EndingScreen {
  constructor(app, ending) {
    Object.assign(this, { app, ending, t: 0 });
    Assets.playBgm(ending.bgm || 'result');
  }
  update(dt, events) {
    this.t += dt;
    if (this.t > 1.5 && taps(events).length) this.app.go(new TitleScreen(this.app));
  }
  draw(ctx) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, this.t / 1.5);
    text(ctx, this.ending.title, W / 2, 420, { size: 150, align: 'center', bold: true });
    const lines = (this.ending.text || '').split('\n');
    lines.forEach((l, k) => text(ctx, l, W / 2, 600 + k * 56, { size: 38, align: 'center', color: COLOR.dim }));
    ctx.globalAlpha = 1;
    if (this.t > 1.5) text(ctx, 'タップでタイトルへ', W / 2, 1000, { size: 30, align: 'center', color: COLOR.dim });
  }
}

// ================= トレーニングモード（病巣選択画面） =================
function trainingTypes(app, st) {
  return [...new Set(st.steps.flatMap(s => (s.lesions || []).map(l => l.type)))];
}

export class TrainingScreen {
  constructor(app, diffId) {
    this.app = app;
    this.diffId = diffId || app.data.system.default_difficulty;
    this.all = false;
    Assets.playBgm('title');
    this.build();
  }
  available() {
    return this.app.data.training.filter(st => this.all || trainingTypes(this.app, st).every(t => Save.data.treated.includes(t)));
  }
  build() {
    const app = this.app, sys = app.data.system;
    this.items = this.available();
    this.buttons = this.items.map((st, i) =>
      new Button(100 + (i % 4) * 435, 300 + Math.floor(i / 4) * 150, 415, 130, '', () => this.play([st]), { size: 30 }));
    this.diffButtons = sys.difficulties.map((d, k) => {
      const b = new Button(1000 + k * 280, 150, 260, 80, d.name, () => { this.diffId = d.id; this.build(); }, { size: 32 });
      b.selected = d.id === this.diffId;
      return b;
    });
    this.others = [
      new Button(60, 960, 300, 80, 'タイトルに戻る', () => app.go(new TitleScreen(app)), { size: 30 }),
      new Button(1400, 960, 420, 80, `ランダムモード（${sys.training_random_count}つ）`, () => {
        const pool = this.available(), seq = [];
        for (let k = 0; k < sys.training_random_count; k++) seq.push(pool[Math.floor(Math.random() * pool.length)]);
        this.play(seq);
      }, { size: 30 })
    ];
    this.others[1].disabled = this.items.length === 0;
    if (app.debug) this.others.push(new Button(420, 960, 460, 80, '確認用：全病巣を練習可能に', () => { this.all = true; this.build(); }, { size: 26 }));
  }
  // 並べたトレーニング用ステージを、1つずつ続けて遊ぶ
  play(seq, done = []) {
    const app = this.app, st = seq[0], back = () => app.go(new TrainingScreen(app, this.diffId));
    const diff = app.data.system.difficulties.find(d => d.id === this.diffId);
    app.go(new LoadingScreen(app, st, () => app.go(new Surgery(app, {
      stage: st, difficulty: diff, flags: new Set(), training: true, choiceKey: 'default',
      onClear: r => {
        for (const rec of r.records) Save.recordBest(rec.type, this.diffId, rec.score, rec.time);   // 病巣1つずつ記録する
        Save.write();
        const all = [...done, ...r.records];
        if (seq.length > 1) this.play(seq.slice(1), all);
        else app.go(new ResultScreen(app, 'トレーニング', { records: all, effort: [], rank: null, max: 0, got: 0, ratio: 0 }, back));
      },
      onGameOver: back, onRetry: back, onQuit: back
    }))));
  }
  update(dt, events) {
    for (const e of taps(events)) clickButtons([...this.buttons, ...this.diffButtons, ...this.others], e.x, e.y);
  }
  draw(ctx) {
    const app = this.app;
    drawImage(ctx, app.data.system.title_bg, 0, 0, W, H, 'cover');
    dim(ctx, 0.6);
    text(ctx, 'トレーニング', 80, 80, { size: 54, bold: true });
    text(ctx, '治療したことのある病巣を練習できます', 80, 190, { size: 30, color: COLOR.dim });
    text(ctx, '難易度', 870, 190, { size: 30, color: COLOR.dim });
    this.diffButtons.forEach(b => b.draw(ctx));
    if (!this.items.length) text(ctx, 'まだ練習できる病巣がありません（ステージをクリアすると増えます）', W / 2, 560, { size: 34, align: 'center', color: COLOR.dim });
    this.items.forEach((st, i) => {
      const b = this.buttons[i];
      b.draw(ctx);
      text(ctx, st.name, b.x + 20, b.y + 42, { size: 30, bold: true });
      const best = Save.data.best[trainingTypes(app, st)[0]]?.[this.diffId];
      if (best) {
        const rating = app.data.system.ratings.find(r => best.score >= r.min).name;
        text(ctx, `ベスト ${rating}　${best.time.toFixed(1)}秒`, b.x + 20, b.y + 94, { size: 24, color: RATE_COLOR[rating] });
      } else text(ctx, '記録なし', b.x + 20, b.y + 94, { size: 24, color: COLOR.dim });
    });
    this.others.forEach(b => b.draw(ctx));
  }
}
