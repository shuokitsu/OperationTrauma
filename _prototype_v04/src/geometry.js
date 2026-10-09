// マス座標の計算（spec/04 1.4・2章）
// 手術エリア：論理座標 (260,180)〜(1660,880)、1マス 14×14、横100×縦50
export const AREA = { x: 260, y: 180, w: 1400, h: 700, cell: 14, cols: 100, rows: 50 };

// 論理座標 → 実数のマス座標（整数の [x, y] はマスの中心）
export function toCell(p) {
  return { x: (p.x - AREA.x) / AREA.cell - 0.5, y: (p.y - AREA.y) / AREA.cell - 0.5 };
}
// マス座標 → 論理座標（マスの中心）
export function toLogical(c) {
  return { x: AREA.x + (c.x + 0.5) * AREA.cell, y: AREA.y + (c.y + 0.5) * AREA.cell };
}
export function inArea(c) {
  return c.x >= -0.5 && c.x < AREA.cols - 0.5 && c.y >= -0.5 && c.y < AREA.rows - 0.5;
}
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// 点と線分の距離
export function distSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
export function distPolyline(p, pts) {
  if (pts.length === 1) return dist(p, pts[0]);
  let m = Infinity;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, distSeg(p, pts[i], pts[i + 1]));
  return m;
}
// 線分 a-b と c-d が交わるか
export function segCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0;
}
export function polylineCross(a, b, pts) {
  for (let i = 0; i < pts.length - 1; i++) if (segCross(a, b, pts[i], pts[i + 1])) return true;
  return false;
}
const P = a => ({ x: a[0], y: a[1] });

// ヒットエリア（図形のリスト。相対座標を配置の位置で絶対座標にする）
export function placeShapes(shapes, origin) {
  return (shapes || []).map(s => {
    if (s.type === 'circle') return { type: 'circle', center: { x: s.center[0] + origin.x, y: s.center[1] + origin.y }, radius: s.radius };
    if (s.type === 'line') return { type: 'line', points: s.points.map(q => ({ x: q[0] + origin.x, y: q[1] + origin.y })), width: s.width };
    if (s.type === 'cells') return { type: 'cells', cells: s.cells.map(q => ({ x: q[0] + origin.x, y: q[1] + origin.y })) };
    return s;
  });
}
export function placePath(path, origin) {
  return path ? path.map(q => ({ x: q[0] + origin.x, y: q[1] + origin.y })) : null;
}
// 点が図形の中にあるか（N マス以内は N 以下。spec/04 2章）
export function inShape(p, s, extra = 0) {
  if (s.type === 'circle') return dist(p, s.center) <= s.radius + extra;
  if (s.type === 'line') return distPolyline(p, s.points) <= s.width + extra;
  if (s.type === 'cells') {
    for (const c of s.cells) if (Math.abs(p.x - c.x) <= 0.5 + extra && Math.abs(p.y - c.y) <= 0.5 + extra) return true;
    return false;
  }
  return false;
}
export function inShapes(p, shapes, extra = 0) {
  for (const s of shapes) if (inShape(p, s, extra)) return true;
  return false;
}
// ヒットエリアのマス（マスの中心が図形の中にあるマス）
export function shapeCells(shapes) {
  const out = new Map();
  for (const s of shapes) {
    let x0, x1, y0, y1;
    if (s.type === 'circle') { x0 = s.center.x - s.radius; x1 = s.center.x + s.radius; y0 = s.center.y - s.radius; y1 = s.center.y + s.radius; }
    else if (s.type === 'line') {
      const xs = s.points.map(q => q.x), ys = s.points.map(q => q.y);
      x0 = Math.min(...xs) - s.width; x1 = Math.max(...xs) + s.width; y0 = Math.min(...ys) - s.width; y1 = Math.max(...ys) + s.width;
    } else if (s.type === 'cells') {
      for (const c of s.cells) { const k = Math.round(c.x) + ',' + Math.round(c.y); out.set(k, { x: Math.round(c.x), y: Math.round(c.y) }); }
      continue;
    }
    for (let y = Math.ceil(y0); y <= Math.floor(y1); y++) for (let x = Math.ceil(x0); x <= Math.floor(x1); x++) {
      if (x < 0 || y < 0 || x >= AREA.cols || y >= AREA.rows) continue;
      if (inShape({ x, y }, s)) out.set(x + ',' + y, { x, y });
    }
  }
  return [...out.values()];
}
// 図形の外接（描画用）
export function shapesBounds(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, r) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  for (const s of shapes) {
    if (s.type === 'circle') add(s.center.x, s.center.y, s.radius);
    else if (s.type === 'line') s.points.forEach(q => add(q.x, q.y, s.width));
    else if (s.type === 'cells') s.cells.forEach(q => add(q.x, q.y, 0.5));
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
export { P as pt };
