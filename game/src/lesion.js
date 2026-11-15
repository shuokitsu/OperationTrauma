// 病巣（spec/06）。病巣データ（種類）と配置から、手術エリアに出ている病巣1つを作る。

import { dist, distPointPolyline, placePoints, centroid, cellsNearPolyline } from './geometry.js';

let serial = 0;

// 1段だけ深く混ぜる（{ pool: { amount: 10 } } のような上書き用）
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? { ...base[k], ...v } : v;
  }
  return out;
}

export class Lesion {
  // o: { id, pos, points, scale, rotate, overrides, origin: 'placed'|'spawned'|'miss', parent }
  constructor(game, type, o = {}) {
    const base = game.app.data.lesions[type];
    let def = base;
    const origin = o.origin || 'placed';
    if (origin !== 'placed' && base.when_spawned) def = merge(def, base.when_spawned);
    if (o.overrides) def = merge(def, o.overrides);
    this.game = game;
    this.type = type;
    this.def = def;
    this.id = o.id || null;
    this.serial = ++serial;
    this.origin = origin;
    this.parent = o.parent || null;
    this.pos = o.pos || [0, 0];
    const scale = o.scale ?? 1, rotate = o.rotate ?? 0;
    this.sets = { main: placePoints(o.points || def.points, this.pos, scale, rotate) };
    for (const [k, pts] of Object.entries(def.sets || {})) this.sets[k] = placePoints(pts, this.pos, scale, rotate);
    this.isPool = def.kind === 'pool';
    this.stage = 0;
    this.done = false;
    this.age = 0;          // 出現からの時間（秒）
    this.doneAge = 0;
    this.fade = 0;         // 治療が終わってからの時間（見た目を消すのに使う）
    this.misses = 0;
    this.skipped = false;
    this.penalty = 0;      // 省略・覆いきらなかった分などの減点
    this.tapped = new Set();
    this.injected = 0;
    this.drainT = 0;
    this.respawnT = 0;
    this.removed = false;  // ピンセットで物を取り除いた
    this.unscored = origin !== 'placed' || !!def.unscored;
    if (this.isPool) { this.amount = def.pool.amount; this.growAcc = 0; }
    this.cellCache = new Map();
  }

  get steps() { return this.def.steps; }
  get step() { return this.def.steps[this.stage]; }
  pts(step) { return this.sets[(step && step.set) || 'main']; }
  center() { return this.isPool ? this.sets.main[0] : centroid(this.sets.main); }
  get radius() { return 1.5 + 0.5 * Math.sqrt(Math.max(0, this.amount)); }
  get ringRadius() { return dist(this.center(), this.sets.main[0]); }

  // この機器が今使える段階の番号（省略できる段階は飛ばしてよい）。使えなければ -1
  accepts(tool) {
    for (let i = this.stage; i < this.steps.length; i++) {
      if (this.steps[i].tool === tool) return i;
      if (!this.steps[i].optional) return -1;
    }
    return -1;
  }

  // 病巣の形までの距離（内側は 0 以下）
  bodyDist(p) {
    const m = this.sets.main;
    if (this.isPool) return dist(p, m[0]) - this.radius;
    if (this.def.shape === 'ring') return dist(p, this.center()) - this.ringRadius;
    if (this.def.shape === 'line') return distPointPolyline(p, m);
    return dist(p, m[0]);
  }
  contains(p) {
    return this.bodyDist(p) <= (this.isPool || this.def.shape === 'ring' ? 0.5 : (this.def.body_radius ?? 2));
  }

  // 血溜まり・膿が重なっているか（重なっている間は、ドレーン以外の操作がすべて無効）
  blocked() {
    if (this.isPool) return false;
    for (const q of this.game.lesions) {
      if (q.done || !q.isPool) continue;
      if (this.bodyDist(q.sets.main[0]) <= q.radius + 0.5) return true;
    }
    return false;
  }

  children() {
    return this.game.lesions.filter(q => q.parent === this && !q.done);
  }

  // ヒールゼリー・テーピングで「覆う」対象のマス
  coverCells(idx) {
    if (this.cellCache.has(idx)) return this.cellCache.get(idx);
    const st = this.steps[idx], pts = this.pts(st);
    const cells = cellsNearPolyline(pts, st.width ?? this.def.width ?? 1, false);
    this.cellCache.set(idx, cells);
    return cells;
  }

  // 段階 idx が成功した
  advance(idx) {
    const g = this.game;
    for (let k = this.stage; k < idx; k++) {       // 省略した段階
      const sk = this.steps[k];
      this.skipped = true;
      if (sk.tool === 'needle') this.needleSkipped = true;
      this.penalty += sk.skip_penalty ?? 0;
      if (sk.skip_damage) g.damage(sk.skip_damage);
    }
    const st = this.steps[idx];
    const heal = st.heal ?? (st.tool === 'healjelly' ? g.inst.healjelly.default_success_heal : 0);
    if (heal) g.heal(heal);
    if (st.action === 'carry') this.removed = true;
    if (st.spawn) g.spawnChild(this, st.spawn);
    this.stage = idx + 1;
    this.tapped = new Set();
    this.injected = 0;
    g.countUse(st.tool);
    if (this.stage >= this.steps.length) this.finish();
    else { g.popup(this, 'OK'); g.emit('stage', this); }
  }

  finish() {
    this.done = true;
    this.doneAge = this.age;
    this.game.onLesionDone(this);
  }

  // 失敗（ダメージ。ミスに数える）
  fail(damage) {
    this.misses++;
    this.game.damage(damage);
    this.game.popup(this, 'MISS');
    if (this.def.on_fail === 'reset') { this.stage = 0; this.tapped = new Set(); }
  }

  // 病巣の点数（100点満点。spec/03 5.1）
  score() {
    const g = this.game, d = g.app.data.system.default_score, s = this.def.score || {};
    const time = { ...d.time, ...(s.time || {}) };
    const k = g.coef('score_time');
    const full = time.full_within_sec * k, zero = time.zero_after_sec * k, t = this.doneAge;
    const tp = t <= full ? time.points : t >= zero ? 0 : time.points * (zero - t) / (zero - full);
    const v = tp + (this.misses ? 0 : (s.no_miss ?? d.no_miss)) + (this.skipped ? 0 : (s.no_skip ?? d.no_skip))
      - this.misses * (s.fail_penalty ?? d.fail_penalty) - this.penalty;
    return Math.max(0, Math.min(100, Math.ceil(v - 1e-9)));
  }

  update(dt) {
    if (this.done) { this.fade += dt; return; }
    const g = this.game;
    this.age += dt;

    // 病巣があるあいだのバイタル減少（病巣ごとに独立したタイマー）
    const vd = this.def.vital_drain;
    if (vd) {
      this.drainT += dt;
      const interval = vd.interval_sec / g.coef('decay') * g.anesthesiaStretch();
      while (this.drainT >= interval) { this.drainT -= interval; g.vitalDown(vd.amount); }
    }

    // 量の自然増
    if (this.isPool && this.def.pool.grow_per_sec) {
      this.growAcc += this.def.pool.grow_per_sec * dt;
      const add = Math.floor(this.growAcc);
      if (add > 0) { this.growAcc -= add; this.amount = Math.min(this.def.pool.max ?? Infinity, this.amount + add); }
    }

    // 「出ている血溜まり・膿を吸い切る」段階は、吸い切ったら自動で進む
    if (this.step && this.step.action === 'pools' && this.children().length === 0) this.advance(this.stage);
    if (this.done) return;

    // 時間がかかると血溜まりが出る（裂傷）。血溜まりが残っている間は計らない
    const rs = this.def.respawn;
    if (rs && this.stage < rs.before_step) {
      if (this.children().length === 0) {
        this.respawnT += dt;
        if (this.respawnT >= rs.after_sec) {
          this.respawnT = 0;
          const m = this.sets.main;
          g.spawnChild(this, { lesion: rs.lesion, at: m[Math.floor(g.random() * m.length)], overrides: rs.overrides });
        }
      } else {
        this.respawnT = 0;
      }
    }
  }
}
