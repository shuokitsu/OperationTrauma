// 病巣（種類＋配置）。spec/06、spec/07 4章
import { shapeCells, ring, key, dist, distToPolyline, COLS, ROWS } from './geometry.js';

let ORDER = 0;

export class Lesion {
  constructor(def, place, kind) {
    this.def = def; this.kind = kind;
    this.id = place.id; this.name = def.name; this.color = def.color;
    this.ox = place.pos[0]; this.oy = place.pos[1];
    this.order = ++ORDER;                  // あとから出た病巣ほど大きい（重なりの優先：spec/05 2.1）
    this.steps = def.steps.map(s => ({ ...s }));
    this.stepIdx = 0; this.done = false;
    this.runtime = !!def.runtime;          // メスの空振りで出る小さな切り傷
    this.isPool = !!def.pool;              // 血溜まり・膿（独立した病巣：F1）
    this.appearT = 0; this.doneT = 0;
    this.fails = 0; this.skips = 0; this.coverPenalty = 0; this.skipPenaltySum = 0;
    this.score = null; this.evalName = null;
    this.drainAcc = 0; this.injected = 0;
    const ov = place.overrides || {};
    if (this.isPool) {
      this.amount = ov.amount ?? def.amount; this.max = ov.max ?? def.max; this.grow = ov.grow_per_sec ?? def.grow_per_sec;
    }
    if (place.points) {                   // 実行時に作る形（小さな切り傷）
      this.path = place.points.map(p => ({ x: p[0], y: p[1] }));
      this.cells = shapeCells([{ type: 'line', points: place.points, width: 1 }]);
    } else if (def.hit) {
      this.cells = shapeCells(def.hit, this.ox, this.oy);
    } else this.cells = [];
    if (typeof def.path === 'string' && def.path.startsWith('ring:')) {
      const [, r, n] = def.path.split(':').map(Number);
      this.path = ring(this.ox, this.oy, r, n).map(p => ({ x: p[0], y: p[1] }));
    } else if (Array.isArray(def.path)) {
      this.path = def.path.map(p => ({ x: p[0] + this.ox, y: p[1] + this.oy }));
    }
    this.closed = !!def.closed;
    // 描画用の線（ヒットエリアの線の図形から作る。判定には使わない）
    const ln = (def.hit || []).find(h => h.type === 'line');
    this.drawPts = this.path || (ln ? ln.points.map(p => ({ x: p[0] + this.ox, y: p[1] + this.oy })) : null);
    this.cellSet = new Set(this.cells.map(c => key(c.x, c.y)));
  }
  get step() { return this.steps[this.stepIdx]; }
  get active() { return !this.done; }
  radius() { return this.def.radius_base + this.def.radius_per_amount * Math.max(0, this.amount); }
  // マス座標の点が判定領域の中か（血溜まりは円、ほかはヒットエリアのマス）
  contains(c) {
    if (this.isPool) return dist(c, { x: this.ox, y: this.oy }) <= this.radius();
    return this.cellSet.has(key(Math.round(c.x), Math.round(c.y)));
  }
  nearPath(c, tol) { return this.path ? distToPolyline(c, this.path, this.closed) <= tol : false; }
  // 血溜まり・膿が重なっているか（重なっている病巣はドレーン以外すべて無効：D19）
  overlappedBy(pool) {
    if (this.isPool || pool === this || pool.done || pool.amount <= 0) return false;
    const r = pool.radius(), cx = pool.ox, cy = pool.oy;
    for (const c of this.cells) if (Math.hypot(c.x - cx, c.y - cy) <= r) return true;
    if (this.path) for (const p of this.path) if (Math.hypot(p.x - cx, p.y - cy) <= r) return true;
    return false;
  }
  center() {
    if (this.isPool || !this.cells.length) return { x: this.ox, y: this.oy };
    let x = 0, y = 0; for (const c of this.cells) { x += c.x; y += c.y; }
    return { x: x / this.cells.length, y: y / this.cells.length };
  }
}

// 病巣の点数（100点満点。spec/03 5.1）
export function scoreLesion(l, sys, scoreDefault, coefTime) {
  const sc = { ...scoreDefault, ...(l.def.score || {}) };
  sc.time = { ...scoreDefault.time, ...((l.def.score || {}).time || {}) };
  const t = l.doneT - l.appearT;
  const full = sc.time.full_within_sec * coefTime, zero = sc.time.zero_after_sec * coefTime; // 難易度で短くなる（× 係数）
  let timePts = t <= full ? sc.time.points : t >= zero ? 0 : sc.time.points * (zero - t) / (zero - full);
  let total = timePts + (l.fails === 0 ? sc.no_miss : 0) + (l.skips === 0 ? sc.no_skip : 0)
    - l.fails * sc.fail_penalty - l.skips * sc.skip_penalty - l.coverPenalty;
  total = Math.round(Math.max(0, Math.min(100, total)));
  const ev = sys.eval.find(([th]) => total >= th)[1];
  return { total, eval: ev, time: t, timePts: Math.round(timePts) };
}

export function makeSmallCut(def, pts) {
  // 軌跡を間引き、長さの上限で切る（spec/06 3.6）。手術エリアの外は切り捨て
  const out = [];
  for (const p of pts) {
    const q = [Math.max(0, Math.min(COLS - 1, Math.round(p.x))), Math.max(0, Math.min(ROWS - 1, Math.round(p.y)))];
    if (!out.length || Math.hypot(q[0] - out[out.length - 1][0], q[1] - out[out.length - 1][1]) >= 2) out.push(q);
  }
  if (out.length < 2) out.push([out[0][0] + 1, out[0][1]]);
  return new Lesion(def, { id: 'cut' + Math.random().toString(36).slice(2, 7), pos: out[0], points: out }, 'small_cut');
}
