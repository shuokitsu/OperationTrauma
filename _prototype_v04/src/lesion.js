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
    this.generated = !!placement.generated;   // 実行時に生成された病巣（小さな切り傷）
    this.counted = !this.generated;           // 最大点に数えるか（小さな切り傷は数えない）
    this.decayTimer = 0;
    this.marks = [];           // 処置の跡（縫い目・テープ・切開の跡）
    if (placement.shapes) {    // 実行時に形を作る病巣
      this.hit = placement.shapes;
      this.path = placement.path || null;
    } else {
      this.hit = placeShapes(type.hit_area, this.origin);
      this.path = placePath(type.path, this.origin);
    }
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
    this.score = Math.round(clamp(pts, 0, 100));
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
