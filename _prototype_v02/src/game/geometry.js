// マス座標の計算。距離はすべて円（まっすぐな距離）で測る（spec/05 2.4）
// 座標はマス単位の実数。マス (i, j) の中心は (i + 0.5, j + 0.5)。
export const COLS = 100, ROWS = 50;

export function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

export function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToPolyline(p, pts, closed = false) {
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) d = Math.min(d, distToSeg(p, pts[i], pts[i + 1]));
  if (closed && n > 2) d = Math.min(d, distToSeg(p, pts[n - 1], pts[0]));
  if (n === 1) d = dist(p, pts[0]);
  return d;
}

// 線分 p1-p2 と q1-q2 が交わるか。u は q 側の位置（0〜1）
export function segCross(p1, p2, q1, q2) {
  const r = [p2[0] - p1[0], p2[1] - p1[1]], s = [q2[0] - q1[0], q2[1] - q1[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const qp = [q1[0] - p1[0], q1[1] - p1[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: p1[0] + t * r[0], y: p1[1] + t * r[1] };
}

// 軌跡の1区間が折れ線を何回またいだか（頂点で2回数えないよう、最後の線分以外は終点を含めない）
export function countCrossings(a, b, pts) {
  const hits = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const c = segCross(a, b, pts[i], pts[i + 1]);
    if (!c) continue;
    if (c.u >= 1 - 1e-9 && i < pts.length - 2) continue;
    hits.push([c.x, c.y]);
  }
  return hits;
}

export const key = (i, j) => i + ',' + j;

// 病巣のヒットエリア（マスの集合）
export function cellsOfLine(pts, width) {
  const set = new Set();
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.floor(Math.min(...xs) - width - 1), x1 = Math.ceil(Math.max(...xs) + width + 1);
  const y0 = Math.floor(Math.min(...ys) - width - 1), y1 = Math.ceil(Math.max(...ys) + width + 1);
  for (let i = Math.max(0, x0); i <= Math.min(COLS - 1, x1); i++)
    for (let j = Math.max(0, y0); j <= Math.min(ROWS - 1, y1); j++)
      if (distToPolyline([i + 0.5, j + 0.5], pts) <= width) set.add(key(i, j));
  return set;
}
export function cellsOfCircle(c, r) {
  const set = new Set();
  for (let i = Math.max(0, Math.floor(c[0] - r - 1)); i <= Math.min(COLS - 1, Math.ceil(c[0] + r + 1)); i++)
    for (let j = Math.max(0, Math.floor(c[1] - r - 1)); j <= Math.min(ROWS - 1, Math.ceil(c[1] + r + 1)); j++)
      if (dist([i + 0.5, j + 0.5], c) <= r) set.add(key(i, j));
  return set;
}
export function ring(c, r, n = 8) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  return pts;
}
export function pathLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; }
