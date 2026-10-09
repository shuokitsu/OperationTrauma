// 病巣の見た目（試作では画像の代わりに、病巣データの look の層を図形で描く。段階ごとに変わる：P76）
import { AREA, toLogical } from './geometry.js';

const CELL = AREA.cell;

function linePoints(l) {
  const ln = l.hit.find(s => s.type === 'line');
  if (ln) return ln.points;
  return l.path || [];
}
function centerOf(l, at) {
  if (at) return toLogical({ x: l.origin.x + at[0], y: l.origin.y + at[1] });
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
    if (layer.kind === 'line') drawLine(c, linePoints(l), layer);
    else if (layer.kind === 'blob') {
      const p = centerOf(l, layer.at);
      c.fillStyle = layer.color;
      c.beginPath(); c.arc(p.x, p.y, layer.radius * CELL, 0, Math.PI * 2); c.fill();
    } else if (layer.kind === 'ring') {
      const p = toLogical(l.origin);
      c.strokeStyle = layer.color; c.lineWidth = layer.width || 3;
      c.setLineDash(layer.dash || []);
      c.beginPath(); c.arc(p.x, p.y, layer.radius * CELL, 0, Math.PI * 2); c.stroke();
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
  const p = centerOf(l, layer.at), s = (layer.size || 2) * CELL;
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
