// マス座標の計算（spec/04 1.4・2章）
// 手術エリア：横100×縦50マス、1マス14px、左上は論理座標 (260, 180)。
// 実数のマス座標：整数 [x, y] はマスの中心。距離はユークリッド距離で「N以内」は N を含む。
export const COLS = 100, ROWS = 50, CELL = 14;
export const AREA = { x: 260, y: 180, w: COLS * CELL, h: ROWS * CELL };

export const toCell = p => ({ x: (p.x - AREA.x) / CELL - 0.5, y: (p.y - AREA.y) / CELL - 0.5 });
export const toPx = c => ({ x: AREA.x + (c.x + 0.5) * CELL, y: AREA.y + (c.y + 0.5) * CELL });
export const inArea = c => c.x >= -0.5 && c.x < COLS - 0.5 && c.y >= -0.5 && c.y < ROWS - 0.5;
export const key = (x, y) => x + ',' + y;

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
export function distToPolyline(p, pts, closed = false) {
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) d = Math.min(d, distToSeg(p, pts[i], pts[i + 1]));
  if (closed && n > 2) d = Math.min(d, distToSeg(p, pts[n - 1], pts[0]));
  if (n === 1) d = dist(p, pts[0]);
  return d;
}
// 線分 ab と cd が交差するか（端点を含まない厳密な交差）
export function segCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}
export function pathLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; }
export function ring(cx, cy, r, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; out.push([Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))]); }
  return out;
}

// ヒットエリアの図形（円・太さのある線・マスの集まり。四角は使わない：D2）→ マスの集合
// マスの中心がいずれかの図形の中にあるマスを数える。
export function shapeCells(shapes, ox = 0, oy = 0) {
  const set = new Map();
  const add = (x, y) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) set.set(key(x, y), { x, y }); };
  for (const s of shapes) {
    if (s.type === 'circle') {
      const cx = s.center[0] + ox, cy = s.center[1] + oy, r = s.radius;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
          if (Math.hypot(x - cx, y - cy) <= r) add(x, y);
    } else if (s.type === 'line') {
      const pts = s.points.map(p => ({ x: p[0] + ox, y: p[1] + oy }));
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y), w = s.width;
      for (let y = Math.floor(Math.min(...ys) - w); y <= Math.ceil(Math.max(...ys) + w); y++)
        for (let x = Math.floor(Math.min(...xs) - w); x <= Math.ceil(Math.max(...xs) + w); x++)
          if (distToPolyline({ x, y }, pts) <= w) add(x, y);
    } else if (s.type === 'cells') {
      for (const [x, y] of s.cells) add(x + ox, y + oy);
    }
  }
  return [...set.values()];
}
