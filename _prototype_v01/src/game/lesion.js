// 病巣の実体（配置データ × 種類データ）と描画
import { CELL, center, toPx, rasterLine, discCells, samplePath, pointAlong, key } from './grid.js';
import { text } from '../core/ui.js';

export function createLesion(place, def) {
  const L = {
    id: place.id,
    type: place.type,
    def,
    stepIdx: 0,
    done: false,
    drainAcc: 0,
    flash: 0,
  };
  if (def.shape === 'line' || def.shape === 'points') {
    L.path = place.points.map(center);
    L.gelCells = rasterLine(L.path);
    L.mid = pointAlong(L.path, 0.5);
    if (def.shape === 'points') L.cutPoints = L.path;
  }
  if (def.shape === 'point') {
    L.origin = center(place.point);
    L.objectPos = { ...L.origin };
    L.gelCells = discCells(L.origin, 1.5);
    L.mid = L.origin;
  }
  if (def.shape === 'circle') {
    L.origin = center(place.center);
    L.radius = place.radius;
    L.objectPos = { ...L.origin };
    L.gelCells = discCells(L.origin, L.radius);
    L.mid = L.origin;
    const n = 8;
    const r = L.radius + 1.5;
    L.cutPoints = [];
    for (let i = 0; i <= n; i++) {
      const a = (-Math.PI / 2) + (i / n) * Math.PI * 2;
      L.cutPoints.push({ x: L.origin.x + Math.cos(a) * r, y: L.origin.y + Math.sin(a) * r });
    }
    L.closedCut = true;
  }
  if (def.blood) {
    L.blood = def.blood.initial;
    L.poolR = def.blood.poolRadius;
    L.rebleedAcc = 0;
  }
  if (def.pus) {
    L.pus = def.pus.initial;
    L.poolR = (L.radius || 3) + 1;
  }
  if (L.type === 'laceration') {
    L.suturePoints = samplePath(L.path, 4).map((p) => ({ ...p, done: false }));
  }
  // 「病巣の上」とみなすマス（空振りかどうかの判定用）
  L.areaCells = new Set(L.gelCells);
  if (L.poolR) for (const k of discCells(L.mid, L.poolR)) L.areaCells.add(k);
  return L;
}

export function step(L) {
  return L.def.steps[L.stepIdx];
}

// 血溜まり・膿があると、ドレーン以外の処置は効かない
export function blocked(L) {
  return (L.blood || 0) > 0.02 || (L.pus || 0) > 0.02;
}

export function nearArea(L, c, range) {
  const cx = Math.floor(c.x);
  const cy = Math.floor(c.y);
  const r = Math.ceil(range);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (L.areaCells.has(key(cx + dx, cy + dy))) return true;
  return false;
}

const TOOL_NAME = { gel: 'ヒールゼリー', drain: 'ドレーン', tweezers: 'ピンセット', scalpel: 'メス', suture: '縫合針', syringe: '注射' };

function polyline(c, pts, width, color, dash) {
  c.save();
  c.lineWidth = width;
  c.strokeStyle = color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (dash) c.setLineDash(dash);
  c.beginPath();
  pts.forEach((p, i) => {
    const q = toPx(p);
    if (i) c.lineTo(q.x, q.y);
    else c.moveTo(q.x, q.y);
  });
  c.stroke();
  c.restore();
}

function dot(c, p, r, color) {
  const q = toPx(p);
  c.beginPath();
  c.arc(q.x, q.y, r, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
}

export function drawLesion(c, L, { showHint, heldPos }) {
  if (L.done) return;
  const s = step(L);
  const t = L.type;

  if (t === 'cut') polyline(c, L.path, 6, '#b3262b');

  if (t === 'laceration') {
    polyline(c, L.path, 16, '#6d0e14');
    polyline(c, L.path, 5, '#d1414a');
    if (L.stepIdx >= 2) {
      for (const sp of L.suturePoints) {
        const q = toPx(sp);
        if (sp.done) {
          c.strokeStyle = '#f2ecd0';
          c.lineWidth = 4;
          c.beginPath();
          c.moveTo(q.x - 10, q.y - 10); c.lineTo(q.x + 10, q.y + 10);
          c.moveTo(q.x + 10, q.y - 10); c.lineTo(q.x - 10, q.y + 10);
          c.stroke();
        } else if (s?.action === 'stitch') {
          dot(c, sp, 7, '#7fe0ff');
        }
      }
    }
  }

  if (t === 'fragment') {
    dot(c, L.origin, 10, '#8e1f25');
    if (!L.extracted) {
      const q = toPx(heldPos || L.objectPos);
      c.save();
      c.translate(q.x, q.y);
      c.rotate(0.5);
      c.fillStyle = '#b8bec8';
      c.strokeStyle = '#4b5159';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-16, -6); c.lineTo(4, -14); c.lineTo(18, 2); c.lineTo(-2, 14); c.closePath();
      c.fill(); c.stroke();
      c.restore();
    }
  }

  if (t === 'incision') {
    polyline(c, L.path, 4, L.disinfected ? '#8fe3b0' : '#e7c9b8', [14, 12]);
    for (const p of L.cutPoints) dot(c, p, 9, '#6fe7ff');
  }

  if (t === 'tumor') {
    const o = toPx(L.origin);
    if (!L.extracted) {
      const q = toPx(heldPos || L.objectPos);
      c.beginPath();
      c.arc(q.x, q.y, L.radius * CELL, 0, Math.PI * 2);
      c.fillStyle = '#7a3a8f';
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = L.stepIdx >= 3 ? '#f0d0ff' : '#b06ac8';
      c.stroke();
    } else {
      c.beginPath();
      c.arc(o.x, o.y, L.radius * CELL, 0, Math.PI * 2);
      c.fillStyle = '#4a0c14';
      c.fill();
    }
    if (s?.action === 'cut') for (const p of L.cutPoints.slice(0, -1)) dot(c, p, 8, '#6fe7ff');
    if (s?.action === 'cut') dot(c, L.cutPoints[0], 12, '#ffffff');
  }

  // 血溜まり・膿
  if ((L.blood || 0) > 0.01) {
    const q = toPx(L.mid);
    c.beginPath();
    c.ellipse(q.x, q.y, L.poolR * CELL, L.poolR * CELL * 0.7, 0, 0, Math.PI * 2);
    c.fillStyle = `rgba(110,0,8,${0.25 + 0.65 * L.blood})`;
    c.fill();
  }
  if ((L.pus || 0) > 0.01) {
    const q = toPx(L.mid);
    c.beginPath();
    c.arc(q.x, q.y, L.poolR * CELL, 0, Math.PI * 2);
    c.fillStyle = `rgba(215,200,60,${0.2 + 0.6 * L.pus})`;
    c.fill();
  }

  if (L.flash > 0) {
    for (const k of L.gelCells) {
      const [x, y] = k.split(',').map(Number);
      c.fillStyle = `rgba(120,255,170,${0.5 * L.flash})`;
      c.fillRect(260 + x * CELL, 190 + y * CELL, CELL, CELL);
    }
  }

  // 試作用：次に使う機器の表示（本番で出すかは要検討）
  if (showHint && s) {
    const q = toPx(L.mid);
    const label = `${L.def.name}：${TOOL_NAME[s.tool]}${s.optional ? '（省略可）' : ''}`;
    c.font = '22px sans-serif';
    const w = c.measureText(label).width + 20;
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(q.x - w / 2, q.y - 64, w, 34);
    text(c, label, q.x, q.y - 47, { size: 22, align: 'center', color: '#ffe9a0' });
  }
}
