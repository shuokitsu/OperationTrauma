// 手術エリアとマス座標（spec/04_surgery_area.md 1章）
// 論理座標：横0〜1920、縦0〜1080 ／ マス座標：横0〜99、縦0〜49（小数は「マスの中の位置」）
export const AREA = { x: 260, y: 190, w: 1400, h: 700 };
export const CELL = 14;
export const COLS = 100;
export const ROWS = 50;

export function toCell(p) {
  return { x: (p.x - AREA.x) / CELL, y: (p.y - AREA.y) / CELL };
}

export function toPx(c) {
  return { x: AREA.x + c.x * CELL, y: AREA.y + c.y * CELL };
}

// データの整数マス [x, y] → そのマスの中心
export function center(cell) {
  return { x: cell[0] + 0.5, y: cell[1] + 0.5 };
}

export function inArea(p) {
  return p.x >= AREA.x && p.x < AREA.x + AREA.w && p.y >= AREA.y && p.y < AREA.y + AREA.h;
}

export function key(x, y) {
  return x + ',' + y;
}

export function inGrid(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

// 正方形の範囲（「隣接 n マス以内」）で測る距離
export function cheb(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// 折れ線が通るマスの集合
export function rasterLine(pts) {
  const cells = new Set();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const n = Math.ceil(dist(a, b) / 0.25);
    for (let j = 0; j <= n; j++) {
      const x = Math.floor(a.x + ((b.x - a.x) * j) / n);
      const y = Math.floor(a.y + ((b.y - a.y) * j) / n);
      if (inGrid(x, y)) cells.add(key(x, y));
    }
  }
  return cells;
}

export function discCells(c, r) {
  const cells = new Set();
  const cx = Math.floor(c.x);
  const cy = Math.floor(c.y);
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy <= r * r && inGrid(cx + dx, cy + dy)) cells.add(key(cx + dx, cy + dy));
    }
  }
  return cells;
}

// 折れ線に沿って一定間隔の点を取る（両端を含む）
export function samplePath(pts, spacing) {
  const out = [{ ...pts[0] }];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = dist(a, b);
    let t = spacing - carry;
    while (t < len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > spacing * 0.4) out.push({ ...last });
  else out[out.length - 1] = { ...last };
  return out;
}

export function pathLength(pts) {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += dist(pts[i], pts[i + 1]);
  return l;
}

export function pointAlong(pts, t) {
  let remain = pathLength(pts) * t;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = dist(pts[i], pts[i + 1]);
    if (remain <= d) {
      const f = d ? remain / d : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
    }
    remain -= d;
  }
  return { ...pts[pts.length - 1] };
}
