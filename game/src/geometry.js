// 座標と図形の計算（spec/04）。マス座標は [x, y]（横, 縦）。整数の座標はマスの中心を表す。

export const AREA = { x: 260, y: 180, w: 1400, h: 700, cell: 14, cols: 100, rows: 50 };

// 論理座標 → 実数のマス座標
export function toCell(lx, ly) {
  return [(lx - AREA.x) / AREA.cell - 0.5, (ly - AREA.y) / AREA.cell - 0.5];
}
// マス座標 → 論理座標（マスの中心）
export function toLogical(c) {
  return [AREA.x + AREA.cell * (c[0] + 0.5), AREA.y + AREA.cell * (c[1] + 0.5)];
}
export function inArea(c) {
  return c[0] >= -0.5 && c[0] < 99.5 && c[1] >= -0.5 && c[1] < 49.5;
}
export function clampToArea(c) {
  return [Math.min(99, Math.max(0, c[0])), Math.min(49, Math.max(0, c[1]))];
}

export function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// 点 p と線分 a-b の距離
export function distPointSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// 点 p と折れ線の距離（closed なら最後の点と最初の点も結ぶ）
export function distPointPolyline(p, pts, closed = false) {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return dist(p, pts[0]);
  let d = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    d = Math.min(d, distPointSeg(p, pts[i], pts[(i + 1) % pts.length]));
  }
  return d;
}

// 線分 a-b と c-d が交わるか（端がちょうど触れるだけの場合も交差に数える）
export function segIntersect(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0) || (d1 === 0 && d2 !== 0) || (d2 === 0 && d1 !== 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0) || d3 === 0 || d4 === 0);
}

export function polylineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

// 相対座標の点に、大きさ（倍率）と向き（度）を掛けて、位置を足す
export function placePoints(points, pos, scale = 1, rotateDeg = 0) {
  const r = rotateDeg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  return points.map(p => {
    const x = p[0] * scale, y = p[1] * scale;
    return [pos[0] + x * cs - y * sn, pos[1] + x * sn + y * cs];
  });
}

// 折れ線から width マス以内に中心があるマスの一覧（手術エリアの中だけ）
export function cellsNearPolyline(pts, width, closed = false) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const out = [];
  for (let y = Math.max(0, Math.floor(y0 - width)); y <= Math.min(49, Math.ceil(y1 + width)); y++) {
    for (let x = Math.max(0, Math.floor(x0 - width)); x <= Math.min(99, Math.ceil(x1 + width)); x++) {
      if (distPointPolyline([x, y], pts, closed) <= width) out.push([x, y]);
    }
  }
  return out;
}

// 軌跡を間引く（step マスごとに1点）。maxLen を超えた分は切り捨てる
export function thinTrail(trail, step, maxLen) {
  if (trail.length === 0) return [];
  const out = [trail[0]];
  let total = 0;
  for (let i = 1; i < trail.length; i++) {
    const last = out[out.length - 1];
    const d = dist(last, trail[i]);
    if (d >= step || i === trail.length - 1) {
      if (total + d > maxLen) {
        const t = (maxLen - total) / d;
        out.push([last[0] + (trail[i][0] - last[0]) * t, last[1] + (trail[i][1] - last[1]) * t]);
        break;
      }
      total += d;
      out.push(trail[i]);
    }
  }
  return out.map(clampToArea);
}

// 線分 a-b を、間隔 step 以下の点に分ける（a は含まず、b を含む）
export function subdivide(a, b, step = 0.4) {
  const n = Math.max(1, Math.ceil(dist(a, b) / step));
  const out = [];
  for (let i = 1; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  return out;
}

export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
