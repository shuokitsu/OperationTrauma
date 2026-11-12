// 病巣の見た目（試作では画像の代わりに、病巣データの look の層を図形で描く。段階ごとに変わる：P76）
import { AREA, toLogical } from './geometry.js';

const CELL = AREA.cell;

function linePoints(l, layer) {
  let pts;
  if (layer && layer.pts === 'points') pts = l.points;
  else if (layer && layer.pts === 'body') pts = l.body;
  else if (layer && layer.pts) pts = layer.pts.map(l.abs);   // 層ごとに線の位置を書ける
  else { const ln = l.hit.find(s => s.type === 'line'); pts = ln ? ln.points : (l.path || []); }
  if (!pts || pts.length < 2 || !(layer && layer.extend)) return pts || [];
  // 線の両端を少し延ばす（傷の端）
  const e = layer.extend * (l.scale || 1), a = pts[0], b = pts[1], y = pts[pts.length - 2], z = pts[pts.length - 1];
  const ext = (p, q) => { const d = Math.hypot(p.x - q.x, p.y - q.y) || 1; return { x: p.x + (p.x - q.x) / d * e, y: p.y + (p.y - q.y) / d * e }; };
  return [ext(a, b), ...pts, ext(z, y)];
}
function centerOf(l, at) {
  if (at) return toLogical(l.abs(at));
  return toLogical({ x: l.bounds.cx, y: l.bounds.cy });
}

export function drawLesion(c, l, opt = {}) {
  const look = l.look || [];
  c.save();
  for (const layer of look) {
    const isObj = layer.kind === 'object';
    if (opt.objectOnly && !isObj) continue;
    if (isObj && opt.hideObject) {
      c.globalAlpha = 0.25; drawObject(c, l, layer); c.globalAlpha = 1;   // 元の位置に薄い影を残す（P52）
      continue;
    }
    if (layer.kind === 'line') drawLine(c, linePoints(l, layer), layer);
    else if (layer.kind === 'lens') drawLens(c, linePoints(l, layer), layer.width * (l.scale || 1), layer.color);
    else if (layer.kind in MICRO) MICRO[layer.kind](c, l, layer);
    else if (layer.kind === 'taps') {
      // ピンセットでタップする点（タップ済みは塗りつぶす）
      (l.curTap || []).forEach((q, i) => {
        const p = toLogical(q), done = l.tapped.has(i);
        c.beginPath(); c.arc(p.x, p.y, (layer.radius || 0.9) * CELL, 0, Math.PI * 2);
        if (done) { c.fillStyle = layer.done_color || '#e0202c'; c.fill(); }
        else { c.fillStyle = layer.color || 'rgba(255,230,120,0.35)'; c.fill(); c.strokeStyle = layer.stroke || '#ffe27a'; c.lineWidth = 3; c.stroke(); }
      });
    } else if (layer.kind === 'dots') {
      // 病巣の点（裂傷・大型破片痕の点など）
      const pts = layer.pts ? layer.pts.map(l.abs) : (l.points || []);
      for (const q of pts) {
        const p = toLogical(q);
        c.fillStyle = layer.color; c.beginPath(); c.arc(p.x, p.y, (layer.radius || 0.8) * CELL, 0, Math.PI * 2); c.fill();
      }
    }
    else if (layer.kind === 'blob') {
      const p = centerOf(l, layer.at);
      c.fillStyle = layer.color;
      c.beginPath(); c.arc(p.x, p.y, layer.radius * (l.scale || 1) * CELL, 0, Math.PI * 2); c.fill();
    } else if (layer.kind === 'ring') {
      const p = toLogical(l.origin);
      c.strokeStyle = layer.color; c.lineWidth = layer.width || 3;
      c.setLineDash(layer.dash || []);
      c.beginPath(); c.arc(p.x, p.y, layer.radius * (l.scale || 1) * CELL, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
    } else if (layer.kind === 'pool') {
      const p = toLogical(l.origin), r = l.radius * CELL;
      const g = c.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
      g.addColorStop(0, layer.color); g.addColorStop(1, layer.color.replace(/[\d.]+\)$/, '0.35)'));
      c.fillStyle = g;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
      if (l.grabRadius != null) {
        c.strokeStyle = 'rgba(255,255,255,0.5)'; c.setLineDash([8, 8]); c.lineWidth = 2;
        c.beginPath(); c.arc(p.x, p.y, l.grabRadius * CELL, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      }
    } else if (isObj) drawObject(c, l, layer);
  }
  if (!opt.objectOnly && !l.done) {
    // 病巣の点（P98）：点を描く層（taps・dots）が無い病巣だけ、小さな印で描く
    if (!look.some(ly => ly.kind === 'taps' || ly.kind === 'dots')) {
      for (const q of l.markPoints) {
        const p = toLogical(q);
        c.beginPath(); c.arc(p.x, p.y, 0.45 * CELL, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill(); c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 2; c.stroke();
      }
    }
    // 注射を打つ点の的（P100）
    const ip = l.curInject;
    if (ip) {
      const p = toLogical(ip);
      c.strokeStyle = '#7fe0ff'; c.lineWidth = 4;
      c.beginPath(); c.arc(p.x, p.y, 1.6 * CELL, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(p.x, p.y, 0.7 * CELL, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#7fe0ff'; c.beginPath(); c.arc(p.x, p.y, 0.2 * CELL, 0, Math.PI * 2); c.fill();
    }
  }
  if (!opt.objectOnly) {
    for (const m of l.marks) {
      if (m.kind === 'cut') drawLine(c, m.pts, { color: 'rgba(90,10,15,0.55)', width: 3 });
      if (m.kind === 'stitch') drawLine(c, m.pts, { color: 'rgba(25,25,30,0.9)', width: 3 });
      if (m.kind === 'tape') {
        const a = toLogical(m.a), b = toLogical(m.b);
        c.save(); c.globalAlpha = 0.85; c.strokeStyle = '#efe3c2'; c.lineWidth = m.half * 2 * CELL; c.lineCap = 'butt';
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x + 0.01, b.y); c.stroke();
        c.globalAlpha = 0.4; c.strokeStyle = '#b8a77c'; c.lineWidth = 2; c.setLineDash([6, 10]);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.restore();
      }
    }
  }
  c.restore();
}

function drawLine(c, pts, layer) {
  if (!pts || pts.length < 2) return;
  c.strokeStyle = layer.color; c.lineWidth = layer.width || 4;
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.setLineDash(layer.dash || []);
  c.beginPath();
  pts.forEach((q, i) => { const p = toLogical(q); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); });
  c.stroke();
  c.setLineDash([]);
}

function drawObject(c, l, layer) {
  const p = centerOf(l, layer.at), s = (layer.size || 2) * (l.scale || 1) * CELL;
  if (layer.shape === 'shard') drawShard(c, p.x, p.y, s, layer.color);
  else {
    c.fillStyle = layer.color;
    c.beginPath(); c.arc(p.x, p.y, s, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2; c.stroke();
  }
}
export function drawShard(c, x, y, s, color) {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x - s, y - s * 0.3); c.lineTo(x - s * 0.2, y - s); c.lineTo(x + s, y - s * 0.4);
  c.lineTo(x + s * 0.5, y + s * 0.8); c.lineTo(x - s * 0.6, y + s * 0.6); c.closePath();
  c.fill();
  c.strokeStyle = '#5c6670'; c.lineWidth = 2; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.beginPath(); c.moveTo(x - s * 0.5, y - s * 0.3); c.lineTo(x - s * 0.1, y - s * 0.7); c.lineTo(x + s * 0.1, y - s * 0.3); c.closePath(); c.fill();
}

// 開いた傷（線のまわりのレンズ形。中央が太く、端が細い）
function drawLens(c, pts, width, color) {
  if (!pts || pts.length < 2) return;
  const P = pts.map(toLogical);
  const len = [0];
  for (let i = 1; i < P.length; i++) len.push(len[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
  const total = len[len.length - 1] || 1, half = width * CELL / 2;
  const left = [], right = [];
  const N = 24;
  for (let k = 0; k <= N; k++) {
    const d = total * k / N;
    let i = 1; while (i < P.length - 1 && len[i] < d) i++;
    const a = P[i - 1], b = P[i], t = (d - len[i - 1]) / ((len[i] - len[i - 1]) || 1);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / dl, ny = (b.x - a.x) / dl;
    const w = half * Math.sin(Math.PI * k / N);
    left.push({ x: x + nx * w, y: y + ny * w }); right.push({ x: x - nx * w, y: y - ny * w });
  }
  c.fillStyle = color;
  c.beginPath();
  left.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y));
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i].x, right[i].y);
  c.closePath(); c.fill();
}

// マイクロマシン（試作の仮の見た目。P96）
const MICRO = {
  fish(c, l, layer) {
    const p = toLogical(l.origin), s = CELL * 1.8, f = l.face || { x: 1, y: 0 }, ang = Math.atan2(f.y, f.x);
    c.save(); c.translate(p.x, p.y); c.rotate(ang);
    c.fillStyle = layer.dead ? '#6b737b' : '#d8e1ea'; c.strokeStyle = '#34404c'; c.lineWidth = 2;
    c.beginPath(); c.ellipse(0, 0, s * 1.2, s * 0.6, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-s * 1.1, 0); c.lineTo(-s * 1.9, -s * 0.6); c.lineTo(-s * 1.9, s * 0.6); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = layer.dead ? '#333' : '#ff4a4a'; c.beginPath(); c.arc(s * 0.6, -s * 0.15, s * 0.16, 0, Math.PI * 2); c.fill();
    c.restore();
    if (l.frozenLeft > 0) ringTimer(c, p, CELL * 2.6, l.frozenLeft / l.type.move.freeze_sec, '#7fd8ff');
  },
  snake(c, l, layer) {
    const b = (l.body || []).map(toLogical);
    if (b.length < 2) return;
    c.save(); c.globalAlpha = layer.inside ? 0.55 : 1;
    c.strokeStyle = '#2f3b46'; c.lineWidth = CELL * 1.6; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); b.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.stroke();
    c.strokeStyle = '#a7b6c4'; c.lineWidth = CELL * 0.9; c.setLineDash([6, 6]);
    c.beginPath(); b.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#ff4a4a'; c.beginPath(); c.arc(b[0].x, b[0].y, CELL * 0.35, 0, Math.PI * 2); c.fill();
    c.restore();
    if (layer.inside) text0(c, layer.pinned ? '体内（足止め）' : '体内', b[0].x, b[0].y - 22);
  },
  butterfly(c, l, layer) {
    const p = toLogical(l.origin), s = CELL * 1.5, fl = Math.sin(l.flap || 0) * 0.35 + 0.75;
    const wings = l.wings ?? 4;
    c.save(); c.translate(p.x, p.y);
    const wing = (dx, dy, k) => { c.save(); c.scale(dx * fl, 1); c.fillStyle = 'rgba(190,120,230,0.85)'; c.strokeStyle = '#4b2a5c'; c.lineWidth = 2; c.beginPath(); c.ellipse(s * 0.9, dy * s * 0.55, s * 0.9, s * 0.6 * k, dy * 0.4, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore(); };
    if (wings >= 1) wing(1, -1, 1);
    if (wings >= 2) wing(-1, -1, 1);
    if (wings >= 3) wing(1, 1, 0.8);
    if (wings >= 4) wing(-1, 1, 0.8);
    c.fillStyle = '#2f2238'; c.beginPath(); c.ellipse(0, 0, s * 0.25, s * 0.9, 0, 0, Math.PI * 2); c.fill();
    c.restore();
    if (l.producing > 0) text0(c, '鱗粉を生産中', p.x, p.y - CELL * 3);
  },
  scale(c, l) {
    const p = toLogical(l.origin);
    c.fillStyle = 'rgba(230,200,255,0.8)';
    for (let i = 0; i < 6; i++) { const a = i * 1.05 + (l.uid % 7); c.beginPath(); c.arc(p.x + Math.cos(a) * CELL * 0.8, p.y + Math.sin(a) * CELL * 0.8, CELL * 0.35, 0, Math.PI * 2); c.fill(); }
  },
  flower(c, l, layer) {
    const p = toLogical(l.origin);
    for (const pe of l.petals || []) {
      const q = toLogical(petalPos(l, pe));
      c.fillStyle = DRUG_COLOR[pe.drug]; c.globalAlpha = pe.hard ? 1 : 0.8;
      c.beginPath(); c.ellipse(q.x, q.y, CELL * 1.5, CELL * 0.9, pe.ang, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
      c.strokeStyle = pe.hard ? '#fff' : 'rgba(0,0,0,0.4)'; c.lineWidth = pe.hard ? 4 : 2; c.stroke();
      if (pe.hard) text0(c, '硬', q.x, q.y + 8);
      else if (pe.injected) ringTimer(c, q, CELL * 1.8, pe.injected / l.type.petals.need, '#fff');
    }
    c.fillStyle = layer.dead ? '#6b5a3a' : '#e8c64a'; c.strokeStyle = '#5c4a12'; c.lineWidth = 3;
    c.beginPath(); c.arc(p.x, p.y, CELL * 2, 0, Math.PI * 2); c.fill(); c.stroke();
  },
  factory(c, l, layer) {
    const p = toLogical(l.origin), r = CELL * 4.2;
    c.fillStyle = layer.dead ? '#4a4f55' : '#59626c'; c.strokeStyle = '#1e242a'; c.lineWidth = 4;
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r; i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = layer.dead ? '#333' : (Math.sin((l.spin || 0) * 4) > 0 ? '#ff5a5a' : '#ffb15a');
    c.beginPath(); c.arc(p.x, p.y, r * 0.3, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < (l.hitsDone || 0); i++) { c.strokeStyle = '#1a0a0a'; c.lineWidth = 3; c.beginPath(); c.moveTo(p.x - r * 0.6 + i * 12, p.y - r * 0.5); c.lineTo(p.x - r * 0.2 + i * 12, p.y + r * 0.5); c.stroke(); }
    if (layer.cracked) text0(c, '傷に抗菌剤を注射', p.x, p.y - r - 10);
    if (!layer.dead && !layer.cracked && l.produceLeft != null) ringTimer(c, p, r + 8, 1 - l.produceLeft / l.type.produce.every_sec, '#ffb15a');
  },
};
export const DRUG_COLOR = { recovery: '#5fd27a', anesthesia: '#5aa8ff', antibiotic: '#ff9a3a' };
export function petalPos(l, pe) { const R = l.type.petals.radius; return { x: l.origin.x + Math.cos(pe.ang) * R, y: l.origin.y + Math.sin(pe.ang) * R }; }
function ringTimer(c, p, r, f, col) {
  c.strokeStyle = col; c.lineWidth = 4;
  c.beginPath(); c.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, f))); c.stroke();
}
function text0(c, s, x, y) {
  c.save(); c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 4;
  c.strokeText(s, x, y); c.fillText(s, x, y); c.restore();
}
