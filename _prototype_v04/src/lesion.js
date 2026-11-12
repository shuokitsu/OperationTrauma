// 病巣（種類＋配置）と、病巣の点数（spec/06、07 4章、03 5.1）
import { placeShapes, placePath, shapeCells, shapesBounds, dist, inShapes } from './geometry.js';
import { clamp } from './core.js';

let serial = 0;

export class Lesion {
  // type：病巣データ（種類）、placement：配置（id, position, overrides）
  constructor(typeId, type, placement, now) {
    this.uid = ++serial;
    this.id = placement.id || ('L' + this.uid);
    this.typeId = typeId;
    this.type = type;
    this.origin = { x: placement.position[0], y: placement.position[1] };
    this.overrides = placement.overrides || {};
    this.stepIndex = 0;
    this.done = false;
    this.appearedAt = now;
    this.doneAt = null;
    this.misses = 0;
    this.skipped = false;
    this.penalty = 0;          // 失敗・省略以外の減点（ヒールゼリーで覆いきらなかった分、テープのはみ出し）
    this.trainingOnly = !!placement.training;
    this.generated = !!placement.generated;   // 実行時に生成された病巣（空振りの切り傷など）
    this.counted = !this.generated;           // 最大点に数えるか（実行時に生成された病巣は数えない）
    this.tapped = new Set();   // ピンセットでタップした点（今の段階の分。段階が進むと空にする）
    this.bleedTimer = 0;
    this.decayTimer = 0;
    this.marks = [];           // 処置の跡（縫い目・テープ・切開の跡）
    // 形：病巣データは判定の仕方と初期の点を持ち、配置で点・大きさ・向きを書き換えられる（P99）
    // 病巣データの座標に "points" と書くと、病巣の点（配置で書き換えた点）を使う
    this.scale = placement.scale ?? 1;
    const rot = (placement.rotate ?? 0) * Math.PI / 180, cs = Math.cos(rot), sn = Math.sin(rot);
    this.relPoints = placement.shapes ? null : (placement.points || type.points || null);
    this.abs = q => { const x = q[0] * this.scale, y = q[1] * this.scale; return { x: this.origin.x + x * cs - y * sn, y: this.origin.y + x * sn + y * cs }; };
    const ref = v => v === 'points' ? this.relPoints : v;
    const absList = v => { v = ref(v); return v ? v.map(this.abs) : null; };
    this.absList = absList;
    if (placement.shapes) {    // 実行時に形を作る病巣
      this.hit = placement.shapes;
      this.path = placement.path || null;
    } else {
      this.hit = (type.hit_area || []).map(sh => {
        if (sh.type === 'circle') return { type: 'circle', center: this.abs(sh.center), radius: sh.radius * this.scale };
        if (sh.type === 'line') return { type: 'line', points: absList(sh.points), width: sh.width };
        if (sh.type === 'cells') return { type: 'cells', cells: sh.cells.map(this.abs) };
        return sh;
      });
      this.path = absList(type.path);
    }
    // 段階ごとの点・線
    this.stepGeo = type.steps.map(s => ({
      path: absList(s.path),
      tap: absList(s.tap),
      connect: absList(s.connect),
      inject: s.inject_at ? this.abs(s.inject_at === 'first_point' ? this.relPoints[0] : s.inject_at) : null,   // 注射を打つ点（P100。"first_point" は病巣の最初の点）
    }));
    this.points = absList(type.points ? 'points' : null);
    // 移動する病巣（マイクロマシン。試作の仮の動き。TBD-06-11）
    this.vel = { x: 0, y: 0 };
    this.moveT = 0;
    // 血溜まり・膿（独立した病巣。量に応じて広がる）
    if (type.pool) {
      this.amount = this.overrides.amount ?? type.pool.amount;
      this.poolMax = type.pool.max;
      this.growAcc = 0;
      this.grabRadius = null;  // 押している間は、最初に触れた時点の範囲で吸える（P62）
    }
    this.refreshCells();
  }
  get isPool() { return !!this.type.pool; }
  get step() { return this.type.steps[this.stepIndex] || null; }
  get nextStep() { return this.type.steps[this.stepIndex + 1] || null; }
  get instrument() { return this.step ? this.step.instrument : null; }
  // 今の段階で使う線（段階が線を持てばそれ、無ければ病巣の線）
  get curPath() { const g = this.stepGeo[this.stepIndex]; return (g && g.path) || this.path; }
  get curClosed() { const s = this.step; return s && s.path ? !!s.path_closed : !!this.type.path_closed; }
  get curTap() { const g = this.stepGeo[this.stepIndex]; return g && g.tap; }
  get curConnect() { const g = this.stepGeo[this.stepIndex]; return g && g.connect; }
  get curInject() { const g = this.stepGeo[this.stepIndex]; return g && g.inject; }
  // 病巣の点として描く印（P98）：点 → 線の通過点 → 線のヒットエリアの点 → 円の中心
  get markPoints() {
    if (this.isPool || this.type.move) return [];
    if (this.points) return this.points;
    if (this.path) return this.path;
    const pts = [];
    for (const h of this.hit) { if (h.type === 'line') pts.push(...h.points); else if (h.type === 'circle') pts.push(h.center); }
    return pts;
  }
  // 位置を動かす（形をまるごと平行移動）
  moveBy(dx, dy) {
    const mv = q => { if (q) { q.x += dx; q.y += dy; } };
    this.origin.x += dx; this.origin.y += dy;
    for (const h of this.hit) { if (h.center) mv(h.center); (h.points || []).forEach(mv); (h.cells || []).forEach(mv); }
    if (this.path) this.path.forEach(mv);
    for (const g of this.stepGeo) { (g.path || []).forEach(mv); (g.tap || []).forEach(mv); (g.connect || []).forEach(mv); mv(g.inject); }
    if (this.points) this.points.forEach(mv);
  }
  get radius() {
    const p = this.type.pool;
    return p.base_radius + Math.sqrt(Math.max(0, this.amount)) * p.radius_per_sqrt_amount;
  }
  refreshCells() {
    if (this.isPool) this.hit = [{ type: 'circle', center: { ...this.origin }, radius: this.radius }];
    this.cells = shapeCells(this.hit);
    this.cellSet = new Set(this.cells.map(c => c.x + ',' + c.y));
    this.bounds = shapesBounds(this.hit);
  }
  contains(p, extra = 0) {
    if (this.isPool && this.grabRadius != null) return dist(p, this.origin) <= this.grabRadius + extra;
    return inShapes(p, this.hit, extra);
  }
  // 血溜まり・膿が重なっているか
  overlapsPool(pool) {
    if (pool === this || pool.done || !pool.isPool) return false;
    const r = pool.radius;
    for (const c of this.cells) if (dist(c, pool.origin) <= r) return true;
    return false;
  }
  advance() {
    this.stepIndex++;
    this.tapped = new Set();
    if (this.stepIndex >= this.type.steps.length) this.done = true;
    return this.done;
  }
  // 病巣の点数（100点満点。spec/03 5.1）
  computeScore(coefTime) {
    const s = Object.assign({ time: { points: 60, full_within_sec: 10, zero_after_sec: 40 }, no_miss: 20, no_skip: 20, fail_penalty: 10, skip_penalty: 0 }, this.type.score || {});
    const t = this.doneAt - this.appearedAt;
    const full = s.time.full_within_sec * coefTime, zero = s.time.zero_after_sec * coefTime;
    let timePts = t <= full ? s.time.points : t >= zero ? 0 : s.time.points * (zero - t) / (zero - full);
    let pts = timePts + (this.misses === 0 ? s.no_miss : 0) + (this.skipped ? 0 : s.no_skip);
    pts -= this.misses * s.fail_penalty;
    if (this.skipped) pts -= s.skip_penalty;
    pts -= this.penalty;
    this.score = Math.ceil(clamp(pts, 0, 100) - 1e-9);   // 端数は切り上げ（H7）
    this.grade = gradeOf(this.score);
    this.time = t;
    return this.score;
  }
  // 今の段階の見た目（P76：段階ごとに見た目を持つ）
  get look() {
    if (this.done) return this.type.done_look || null;
    return (this.step && this.step.look) || this.type.look || null;
  }
}

export function gradeOf(score) {
  return score >= 90 ? 'Cool' : score >= 70 ? 'Good' : score >= 40 ? 'Fine' : 'Bad';
}
const GRADE_ORDER = ['Bad', 'Fine', 'Good', 'Cool'];
export function betterGrade(a, b) { return GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? a : b; }

// ステージのランク（最大点に対する割合。spec/03 5章）
export function rankOf(points, max) {
  if (max <= 0) return null;
  const r = points / max;
  return r >= 1 ? 'XS' : r >= 0.95 ? 'S' : r >= 0.8 ? 'A' : r >= 0.6 ? 'B' : r >= 0.4 ? 'C' : 'D';
}
const RANK_ORDER = ['D', 'C', 'B', 'A', 'S', 'XS'];
export function betterRank(a, b) {
  if (!a) return b; if (!b) return a;
  return RANK_ORDER.indexOf(a) >= RANK_ORDER.indexOf(b) ? a : b;
}
