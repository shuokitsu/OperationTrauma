// 病巣・操作ガイド・操作の跡の描画。病巣の見た目は、画像の素材ができるまで図形で描く（仮）。

import { toLogical, centroid, AREA } from './geometry.js';
import { stitchNeed } from './tools.js';

const C = AREA.cell;
const P = c => toLogical(c);

function line(ctx, pts, color, width, closed = false, dash = null) {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((c, i) => { const [x, y] = P(c); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  if (closed) ctx.closePath();
  ctx.setLineDash(dash || []);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
}

function circle(ctx, c, r, fill, stroke = null, lw = 3) {
  const [x, y] = P(c);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

// 病巣の点の印（閉じた点は塗りつぶし）
function marks(ctx, pts, filled = () => false) {
  pts.forEach((c, i) => circle(ctx, c, 7, filled(i) ? '#fff' : 'rgba(0,0,0,0.35)', '#fff', 2.5));
}

// 縫い目（線に沿って短い横線を並べる）
function stitches(ctx, pts, color = '#e9e2c8') {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = P(pts[i]), [bx, by] = P(pts[i + 1]);
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / 22));
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    for (let k = 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
      ctx.beginPath(); ctx.moveTo(x - nx * 9, y - ny * 9); ctx.lineTo(x + nx * 9, y + ny * 9); ctx.stroke();
    }
  }
}

// 開いた傷（太い暗い線の中に赤）と、閉じた傷（細い線）
function wound(ctx, pts, open) {
  if (open) { line(ctx, pts, '#5a0a12', 20); line(ctx, pts, '#c2283a', 10); }
  else line(ctx, pts, '#8a1c28', 5);
}

function stepIndex(L, tool, nth = 0) {
  let n = 0;
  for (let i = 0; i < L.steps.length; i++) if (L.steps[i].tool === tool && n++ === nth) return i;
  return -1;
}

const LOOKS = {
  scratch(ctx, L) {
    line(ctx, L.sets.main, '#7a1420', 7);
    line(ctx, L.sets.main, '#d8404f', 3);
  },

  pool(ctx, L) {
    const pus = L.def.color === 'pus';
    const [x, y] = P(L.sets.main[0]), r = L.radius * C;
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
    g.addColorStop(0, pus ? 'rgba(232,226,140,0.95)' : 'rgba(190,30,48,0.95)');
    g.addColorStop(1, pus ? 'rgba(160,150,60,0.85)' : 'rgba(110,8,22,0.88)');
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
  },

  // 裂傷・大型破片痕（切って取り出したあとは裂傷と同じ見た目）
  laceration(ctx, L) {
    const m = L.sets.main;
    const tapIdx = L.steps.findIndex(s => s.action === 'tap');
    const needleIdx = stepIndex(L, 'needle');
    const cutIdx = stepIndex(L, 'scalpel');
    if (cutIdx >= 0 && L.stage <= cutIdx) {
      // まだ切っていない：皮膚の下に大きな破片がある
      line(ctx, m, 'rgba(60,20,30,0.55)', 18);
      line(ctx, m, '#b9c2cc', 3, false, [10, 8]);
      marks(ctx, m);
      return;
    }
    const closed = L.stage > tapIdx;
    wound(ctx, m, !closed);
    if (L.steps.some(s => s.action === 'carry') && !L.removed) {
      line(ctx, [m[0], m[m.length - 1]], '#c9d2db', 9);
      line(ctx, [m[0], m[m.length - 1]], '#7d8893', 3);
    }
    if (needleIdx >= 0 && L.stage > needleIdx && !L.needleSkipped) stitches(ctx, m);
    marks(ctx, m, i => closed || L.tapped.has(i));
  },

  shard(ctx, L) {
    const c = L.sets.main[0], [x, y] = P(c);
    circle(ctx, c, 13, '#7a1420');
    circle(ctx, c, 6, '#c2283a');
    if (!L.removed && !L.carried) drawShard(ctx, x, y);
  },

  incision(ctx, L) {
    const m = L.sets.main;
    const scalpelIdx = stepIndex(L, 'scalpel');
    if (L.stage > scalpelIdx || L.done) { line(ctx, m, '#3a060c', 16); line(ctx, m, '#a81e2e', 6); return; }
    const jellyIdx = stepIndex(L, 'healjelly');
    if (jellyIdx >= 0 && L.stage > jellyIdx && !L.skipped) line(ctx, m, 'rgba(120,220,160,0.35)', 26);   // 消毒した
    line(ctx, m, '#ffffff', 3, false, [12, 9]);
    m.forEach(c => circle(ctx, c, 5, '#fff'));
  },

  closure(ctx, L) {
    const m = L.sets.main;
    const needleIdx = stepIndex(L, 'needle');
    wound(ctx, m, L.stage <= needleIdx && !L.done);
    if (L.stage > needleIdx || L.done) stitches(ctx, m);
    if (L.tape) {
      const [a, b] = L.tape, [ax, ay] = P(a), [bx, by] = P(b);
      ctx.strokeStyle = 'rgba(240,232,208,0.9)'; ctx.lineWidth = 7 * C; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  },

  hematoma(ctx, L) {
    const pus = L.def.color === 'pus';
    const c = centroid(L.sets.main), [x, y] = P(c);
    ctx.save();
    ctx.translate(x, y); ctx.scale(1.5, 1);
    ctx.beginPath(); ctx.arc(0, 0, 3.2 * C, 0, Math.PI * 2);
    ctx.fillStyle = pus ? 'rgba(200,190,90,0.6)' : 'rgba(90,30,110,0.6)'; ctx.fill();
    ctx.restore();
    if (L.stage > 0) line(ctx, L.sets.main, '#8a1c28', 5);
    else { line(ctx, L.sets.main, '#fff', 3, false, [10, 8]); marks(ctx, L.sets.main); }
  },

  tumor(ctx, L) {
    const c = L.center(), r = L.ringRadius * C, [x, y] = P(c), s = L.stage;
    if (s <= 1 && !L.carried) {                                  // 腫瘍のかたまり
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r * 0.85);
      g.addColorStop(0, '#e9a3b0'); g.addColorStop(1, '#8c4a63');
      ctx.beginPath(); ctx.arc(x, y, r * 0.82, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    }
    if (s === 0) { line(ctx, L.sets.main, '#fff', 3, true, [10, 8]); L.sets.main.forEach(q => circle(ctx, q, 5, '#fff')); return; }
    if (s === 1) { line(ctx, L.sets.main, '#7a1420', 5, true); return; }
    // 取り除いたあとの穴。左右を縫うと縦長に、上下を縫うと十字の傷あとになる
    ctx.save(); ctx.translate(x, y);
    if (s <= 3) { ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.fillStyle = '#3a060c'; ctx.fill(); ctx.strokeStyle = '#a81e2e'; ctx.lineWidth = 5; ctx.stroke(); }
    else if (s <= 5 && !L.done) { ctx.scale(0.28, 1); ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.fillStyle = '#3a060c'; ctx.fill(); }
    ctx.restore();
    if (s >= 4 || L.done) { line(ctx, L.sets.lr_line, '#8a1c28', 5); stitches(ctx, L.sets.lr_line); }
    if (L.done) { line(ctx, L.sets.ud_line, '#8a1c28', 5); stitches(ctx, L.sets.ud_line); }
    if (s === 2 || s === 3) marks(ctx, L.sets.lr, i => s > 2 || L.tapped.has(i));
    if (s === 4 || s === 5) marks(ctx, L.sets.ud, i => s > 4 || L.tapped.has(i));
  },

  vessel(ctx, L) {
    const [a, b] = L.sets.main, [ax, ay] = P(a), [bx, by] = P(b);
    const dx = (bx - ax), dy = (by - ay), len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const tube = (x0, y0, x1, y1) => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#5a0a12'; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = '#d0465a'; ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    };
    if (L.stage === 0) {
      tube(ax - ux * 60, ay - uy * 60, ax + ux * len * 0.25, ay + uy * len * 0.25);
      tube(bx + ux * 60, by + uy * 60, bx - ux * len * 0.25, by - uy * len * 0.25);
      marks(ctx, [a, b]);
    } else {
      tube(ax - ux * 60, ay - uy * 60, bx + ux * 60, by + uy * 60);
      if (L.done) stitches(ctx, [a, b]);
      else marks(ctx, [a, b], () => true);
    }
  },

  inject(ctx, L, g) {
    const c = L.sets.main[0];
    const pulse = 1 + 0.12 * Math.sin(g.clock * 6);
    circle(ctx, c, 26 * pulse, 'rgba(255,255,255,0.12)', '#fff', 3);
    circle(ctx, c, 11, null, '#fff', 3);
    if (L.injected > 0) {
      const [x, y] = P(c), st = L.step;
      ctx.beginPath(); ctx.arc(x, y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, L.injected / st.amount));
      ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 6; ctx.stroke();
    }
  }
};

function drawShard(ctx, x, y) {
  ctx.beginPath();
  ctx.moveTo(x - 16, y + 4); ctx.lineTo(x - 4, y - 15); ctx.lineTo(x + 15, y - 6); ctx.lineTo(x + 9, y + 13); ctx.closePath();
  ctx.fillStyle = '#c9d2db'; ctx.fill();
  ctx.strokeStyle = '#59636e'; ctx.lineWidth = 3; ctx.stroke();
}

export function drawLesion(ctx, L, g) {
  const keep = L.def.keep_after_done;
  if (L.done && !keep && L.fade >= 1.2) return;
  ctx.save();
  if (L.done && !keep) ctx.globalAlpha = Math.max(0, 1 - L.fade / 1.2);
  (LOOKS[L.def.look] || LOOKS.scratch)(ctx, L, g);
  // 患部に打つ注射の的（切開の麻酔など）
  const st = L.step;
  if (!L.done && st && st.action === 'inject' && L.def.look !== 'inject') {
    const c = L.pts(st)[0];
    circle(ctx, c, 22, 'rgba(255,255,255,0.12)', '#fff', 3);
    circle(ctx, c, 9, null, '#fff', 3);
    if (L.injected > 0) {
      const [x, y] = P(c);
      ctx.beginPath(); ctx.arc(x, y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, L.injected / st.amount));
      ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 6; ctx.stroke();
    }
  }
  ctx.restore();
}

// ピンセットで掴んでいる物（最上位レイヤーに描く）
export function drawCarried(ctx, L, x, y) {
  if (L.def.look === 'tumor') {
    const r = L.ringRadius * C * 0.82;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#e9a3b0'); g.addColorStop(1, '#8c4a63');
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  } else if (L.def.look === 'laceration') {
    const m = L.sets.main, [ax, ay] = P(m[0]), [bx, by] = P(m[m.length - 1]);
    const dx = (bx - ax) / 2, dy = (by - ay) / 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#c9d2db'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    ctx.strokeStyle = '#7d8893'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
  } else {
    drawShard(ctx, x, y);
  }
}

// ---------------- 操作ガイドの矢印・印（spec/05 2.9） ----------------
function arrow(ctx, x0, y0, x1, y1, color) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(a) * 14, y1 - Math.sin(a) * 14); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(a - 0.45) * 30, y1 - Math.sin(a - 0.45) * 30);
  ctx.lineTo(x1 - Math.cos(a + 0.45) * 30, y1 - Math.sin(a + 0.45) * 30);
  ctx.closePath(); ctx.fill();
}

function pointer(ctx, c, color, bob) {
  const [x, y] = P(c), top = y - 46 - bob;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, top + 26); ctx.lineTo(x - 17, top); ctx.lineTo(x + 17, top); ctx.closePath(); ctx.fill();
}

export function drawGuide(ctx, L, g, tool) {
  const idx = L.accepts(tool);
  if (idx < 0 || L.blocked()) return;
  const st = L.steps[idx], pts = L.pts(st);
  const a = 0.6 + 0.3 * Math.sin(g.clock * 5), color = `rgba(255,210,63,${a})`, bob = 6 * Math.sin(g.clock * 5);
  switch (st.action) {
    case 'cut': {
      const [x0, y0] = P(pts[0]), [x1, y1] = P(pts[1]);
      const d = Math.hypot(x1 - x0, y1 - y0), off = st.closed ? 0 : 26;
      const nx = -(y1 - y0) / d * off, ny = (x1 - x0) / d * off;
      arrow(ctx, x0 + nx, y0 + ny, x1 + nx, y1 + ny, color);
      break;
    }
    case 'stitch': {
      // 線をまたぐジグザグ
      const [x0, y0] = P(pts[0]), [x1, y1] = P(pts[pts.length - 1]);
      const d = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / d, uy = (y1 - y0) / d, nx = -uy, ny = ux;
      const n = stitchNeed(L, idx), span = Math.min(d, n * 34), sx = (x0 + x1) / 2 - ux * span / 2, sy = (y0 + y1) / 2 - uy * span / 2;
      ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let k = 0; k <= n; k++) {
        const s = k % 2 ? 1 : -1, x = sx + ux * span * k / n + nx * 34 * s, y = sy + uy * span * k / n + ny * 34 * s;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case 'carry': {
      const [x, y] = P(L.center()), t = g.trayRect(), tx = t.x + t.w / 2, ty = t.y + t.h / 2;
      const d = Math.hypot(tx - x, ty - y);
      arrow(ctx, x + (tx - x) / d * 30, y + (ty - y) / d * 30, x + (tx - x) / d * 150, y + (ty - y) / d * 150, color);
      break;
    }
    case 'tap':
      pts.forEach((c, i) => { if (!L.tapped.has(i)) pointer(ctx, c, color, bob); });
      break;
    case 'connect': {
      const [x0, y0] = P(pts[0]), [x1, y1] = P(pts[pts.length - 1]);
      arrow(ctx, x0, y0 - 30, x1, y1 - 30, color);
      break;
    }
    case 'tape': {
      const [x0, y0] = P(pts[0]), [x1, y1] = P(pts[pts.length - 1]);
      arrow(ctx, x0, y0 - 40, x1, y1 - 40, color);
      break;
    }
    case 'pools': break;
    default:
      pointer(ctx, st.action === 'inject' ? pts[0] : L.center(), color, bob);
  }
}

// 操作の跡（離した後もしばらく残す）
const TRAIL_COLOR = { scalpel: '255,90,90', needle: '233,226,200', healjelly: '120,220,160' };
export function drawTrail(ctx, tool, pts, alpha) {
  const c = TRAIL_COLOR[tool];
  if (!c || pts.length < 2) return;
  line(ctx, pts, `rgba(${c},${alpha * (tool === 'healjelly' ? 0.35 : 0.8)})`, tool === 'healjelly' ? 3 * 2 * C : 4);
}
