// 会話の表示（spec/02 3.3・3.4）。会話画面と、ゲーム画面に重ねる会話（治療を止める会話・ゲームオーバーの会話）で共通に使う。
//
// 行の書き方（ステージデータの中に書く）：
//   { "who": "ラーゼ", "text": "セリフ" }            セリフ（who が system.json の characters にあれば立ち絵を出す）
//   { "bg": "bg_clinic.svg" }                        背景を変える（会話画面では暗転が入る）
//   { "fade": true }                                 同じ背景のまま暗転する（時間経過）
//   { "bgm": "talk" } / { "se": "alarm" }            音
//   { "hide": "left" | "right" | "all" }             立ち絵を消す
//   { "briefing": true }                             ここからブリーフィング（暗転して、目標を表示する）
//   { "choice": [ { "text": "…", "set": "フラグ名" }, … ] }   選択肢
//   どの行にも "if": "フラグ名"（または配列）、"if_not": "フラグ名" を付けられる

import { Assets } from './assets.js';
import { Save } from './save.js';
import { W, H, COLOR, text, wrap, panel, Button, clickButtons, drawImage, dim } from './ui.js';

export function condOk(line, flags) {
  const need = line.if === undefined ? [] : [].concat(line.if);
  const not = line.if_not === undefined ? [] : [].concat(line.if_not);
  return need.every(f => flags.has(f)) && !not.some(f => flags.has(f));
}

export class TalkPlayer {
  // o: { overlay, flags(Set), skip, goals, onEnd, bgm }
  constructor(app, lines, o = {}) {
    this.app = app;
    this.sys = app.data.system;
    this.lines = lines || [];
    this.o = o;
    this.flags = o.flags || new Set();
    this.i = 0;
    this.cur = null;         // 表示中のセリフ
    this.chars = 0;
    this.choice = null;      // 選択肢のボタン
    this.deferred = [];      // 会話画面全スキップで、ブリーフィングまで持ち越した選択肢
    this.picked = [];        // 選んだ選択肢（コンティニューポイントの保存の単位に使う）
    this.fade = null;        // { phase: 'out'|'hold'|'in', t, apply, then }
    this.bg = null;
    this.slots = { left: null, right: null };
    this.speaker = null;
    this.inBriefing = false;
    this.shownAny = false;
    this.ended = false;
    this.started = false;
  }

  get skipText() { return !!this.o.skip && (this.o.overlay || !this.inBriefing); }

  end() {
    if (this.ended) return;
    this.ended = true;
    if (this.o.onEnd) this.o.onEnd();
  }

  startFade(apply, then) {
    const f = this.sys.talk_fade;
    // 何も表示していないうちの暗転は、黒から明ける
    this.fade = { phase: this.shownAny || this.bg ? 'out' : 'hold', t: 0, apply, then, f };
    if (this.fade.phase === 'hold') { apply(); this.fade.applied = true; }
  }

  next() {
    this.cur = null;
    while (this.i < this.lines.length) {
      const ln = this.lines[this.i++];
      if (!condOk(ln, this.flags)) continue;
      const needFade = !this.o.overlay && (ln.briefing || ln.fade || (ln.bg && this.bg && ln.bg !== this.bg));
      if (needFade) {
        this.startFade(() => this.applyDirectives(ln), () => { if (!this.present(ln)) this.next(); });
        return;
      }
      this.applyDirectives(ln);
      if (this.present(ln)) return;
    }
    this.end();
  }

  applyDirectives(ln) {
    if (ln.briefing) {
      this.inBriefing = true;
      this.slots = { left: null, right: null };
      this.speaker = null;
      if (this.sys.briefing.bg) this.bg = this.sys.briefing.bg;
      if (this.sys.briefing.bgm) Assets.playBgm(this.sys.briefing.bgm);
    }
    if (ln.bg) this.bg = ln.bg;
    if (ln.bgm) Assets.playBgm(ln.bgm);
    if (ln.se) Assets.se(ln.se);
    if (ln.hide) {
      if (ln.hide === 'all') this.slots = { left: null, right: null };
      else this.slots[ln.hide] = null;
    }
  }

  // セリフ・選択肢を出したら true（タップ待ちになる）
  present(ln) {
    if (ln.briefing && this.deferred.length) {
      // 持ち越した選択肢を、ブリーフィングの最初にまとめて出す
      this.lines.splice(this.i, 0, ...this.deferred);
      this.deferred = [];
    }
    if (ln.choice) {
      const later = this.lines.slice(this.i).some(l => l.briefing);
      if (this.o.skip && !this.o.overlay && !this.inBriefing && later) { this.deferred.push(ln); return false; }
      this.showChoice(ln);
      return true;
    }
    if (ln.text === undefined || this.skipText) return false;
    this.cur = ln;
    this.chars = 0;
    this.shownAny = true;
    const ch = this.sys.characters[ln.who];
    if (ch && ch.stand) { this.slots[ch.side] = ch.stand; this.speaker = ch.side; }
    else this.speaker = null;
    return true;
  }

  showChoice(ln) {
    const n = ln.choice.length, bw = 1100, bh = 110, gap = 30;
    const y0 = (H - 300) / 2 - (n * bh + (n - 1) * gap) / 2;
    this.choice = ln.choice.map((c, k) => new Button((W - bw) / 2, y0 + k * (bh + gap), bw, bh, c.text.replace(/\\n/g, '\n'), () => {
      for (const other of ln.choice) if (other.set) this.flags.delete(other.set);
      if (c.set) this.flags.add(c.set);
      this.picked.push(c.set || c.text);
      this.choice = null;
      this.next();
    }, { size: 38 }));
    this.shownAny = true;
  }

  update(dt, events) {
    if (!this.started) { this.started = true; if (this.o.bgm) Assets.playBgm(this.o.bgm); this.next(); }
    if (this.ended) return;
    if (this.fade) {
      const fd = this.fade, f = fd.f;
      fd.t += dt;
      const len = fd.phase === 'out' ? f.out_sec : fd.phase === 'hold' ? f.hold_sec : f.in_sec;
      if (fd.t >= len) {
        fd.t = 0;
        if (fd.phase === 'out') { fd.phase = 'hold'; fd.apply(); fd.applied = true; }
        else if (fd.phase === 'hold') fd.phase = 'in';
        else { this.fade = null; fd.then(); }
      }
      return;   // 暗転の間はタップを受け付けない
    }
    if (this.cur) {
      const speed = this.sys.text_speed[Save.data.options.textSpeed] || 40;
      const before = Math.floor(this.chars);
      this.chars = Math.min(this.cur.text.length, this.chars + speed * dt);
      if (Math.floor(this.chars) > before && Math.floor(this.chars) % 3 === 0) Assets.se('text', 0.5);
    }
    for (const e of events) {
      const tap = e.type === 'down' || (e.type === 'key' && (e.key === 'Enter' || e.key === ' '));
      if (!tap || this.fade || this.ended) continue;
      if (this.choice) { if (e.type === 'down') clickButtons(this.choice, e.x, e.y); continue; }
      if (this.cur && this.chars < this.cur.text.length) this.chars = this.cur.text.length;
      else this.next();
    }
  }

  draw(ctx) {
    if (!this.o.overlay) {
      if (this.bg) drawImage(ctx, this.bg, 0, 0, W, H, 'cover');
      else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    } else {
      dim(ctx, this.o.dim ?? 0.45);
    }
    // 立ち絵（話していないほうは暗くする）
    for (const side of ['left', 'right']) {
      const name = this.slots[side];
      if (!name) continue;
      ctx.globalAlpha = this.speaker === side || this.speaker === null ? 1 : 0.5;
      drawImage(ctx, name, side === 'left' ? 140 : W - 140 - 560, 150, 560, 930, 'contain', 1);
      ctx.globalAlpha = 1;
    }
    // ブリーフィング：目標
    if (this.inBriefing && this.o.goals) {
      const g = this.o.goals, effort = g.effort || [];
      const h = 110 + effort.length * 56;
      panel(ctx, 360, 60, 1200, h);
      text(ctx, 'クリア目標', 400, 112, { size: 30, color: COLOR.accent, bold: true });
      text(ctx, g.clear || 'すべての処置を終える', 600, 112, { size: 36 });
      effort.forEach((e, k) => {
        text(ctx, '努力目標', 400, 172 + k * 56, { size: 30, color: COLOR.good, bold: true });
        text(ctx, e.text, 600, 172 + k * 56, { size: 34 });
      });
    }
    // 会話ウィンドウ
    if (this.cur) {
      const x = 160, y = 800, w = 1600, h = 240;
      panel(ctx, x, y, w, h);
      if (this.cur.who) {
        panel(ctx, x + 30, y - 52, 340, 68, { fill: '#243040' });
        text(ctx, this.cur.who, x + 200, y - 18, { size: 36, align: 'center', bold: true });
      }
      const shown = this.cur.text.slice(0, Math.floor(this.chars));
      const lines = wrap(ctx, shown, w - 100, 42);
      lines.forEach((l, k) => text(ctx, l, x + 50, y + 62 + k * 62, { size: 42 }));
      if (this.chars >= this.cur.text.length && Math.floor(this.app.time * 2) % 2 === 0) {
        text(ctx, '▼', x + w - 60, y + h - 40, { size: 30, align: 'center', color: COLOR.accent });
      }
    }
    if (this.choice) {
      dim(ctx, 0.35);
      this.choice.forEach(b => b.draw(ctx));
    }
    // 暗転
    if (this.fade) {
      const fd = this.fade, f = fd.f;
      const a = fd.phase === 'out' ? fd.t / f.out_sec : fd.phase === 'hold' ? 1 : 1 - fd.t / f.in_sec;
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, a))})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

// 会話画面
export class TalkScreen {
  constructor(app, lines, o) {
    this.player = new TalkPlayer(app, lines, o);
  }
  update(dt, events) { this.player.update(dt, events); }
  draw(ctx) { this.player.draw(ctx); }
}
