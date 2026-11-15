// 医療機器の操作と判定（spec/05）。1回の操作（押してから離すまで）を op として持つ。
// 結果は 成功・失敗・無効・空振り の4つ。分類は押した位置で決める。

import { dist, distPointSeg, distPointPolyline, segIntersect, subdivide, thinTrail, inArea } from './geometry.js';

// 押した位置にある病巣を調べる
function hitFor(g, L, p, tool) {
  if (L.isPool) return L.contains(p);
  const idx = L.accepts(tool);
  if (idx >= 0) {
    const st = L.steps[idx];
    if (st.action === 'cut' || st.action === 'stitch') {
      if (distPointPolyline(p, L.pts(st), !!st.closed) <= g.inst[tool].tolerance) return true;
    } else if (st.action === 'tap' || st.action === 'connect' || st.action === 'inject') {
      if (L.pts(st).some(q => dist(p, q) <= (st.radius ?? 3))) return true;
    }
  }
  return L.contains(p);
}

// 戻り値 kind：'miss'（空振り）、'invalid'（無効）、'hit'（今の段階に合う病巣）、'wrong'（手順違い）
function pick(g, p, tool) {
  const hits = g.active().filter(L => hitFor(g, L, p, tool)).sort((a, b) => b.serial - a.serial);
  if (!hits.length) return { kind: 'miss' };
  if (hits.some(L => L.isPool)) return { kind: 'invalid' };   // 血溜まり・膿の上は、ドレーン以外すべて無効
  const acc = hits.filter(L => L.accepts(tool) >= 0);
  const L = acc[0] || hits[0];
  if (L.blocked()) return { kind: 'invalid' };
  return acc.length ? { kind: 'hit', lesion: L, idx: L.accepts(tool) } : { kind: 'wrong', lesion: L };
}

function invalid(g, tool) { g.se(g.inst[tool].sounds.invalid); }

// ---------------- 押した ----------------
export function beginOp(g, p) {
  const tool = g.tapeLifted ? 'taping' : g.tool;
  g.op = null;
  switch (tool) {
    case 'healjelly': return beginJelly(g, p);
    case 'drain': g.op = { tool, pos: p, tick: 0, frozen: new Map() }; return;
    case 'tweezers': return beginTweezers(g, p);
    case 'scalpel': return beginScalpel(g, p);
    case 'needle': return beginNeedle(g, p);
    case 'injector': return beginInject(g, p);
    case 'taping': g.op = { tool, start: p, pos: p }; return;
  }
}

// ---------------- 動かした（a → b） ----------------
export function moveOp(g, a, b) {
  const op = g.op;
  if (!op) return;
  op.pos = b;
  if (op.tool === 'healjelly') paint(g, a, b);
  else if (op.tool === 'scalpel') moveScalpel(g, a, b);
  else if (op.tool === 'needle') moveNeedle(g, a, b);
  if (g.op && op.trail) op.trail.push(b);
}

// ---------------- 押している間（毎フレーム） ----------------
export function holdOp(g, dt) {
  const op = g.op;
  if (!op) return;
  if (op.tool === 'healjelly') holdJelly(g, dt);
  else if (op.tool === 'drain') holdDrain(g, dt);
  else if (op.tool === 'injector') holdInject(g, dt);
}

// ---------------- 離した ----------------
export function endOp(g, p, lx, ly) {
  const op = g.op;
  g.op = null;
  g.loopStop();
  if (!op) return;
  if (op.tool === 'healjelly') endJelly(g, op);
  else if (op.tool === 'tweezers') endTweezers(g, op, p, lx, ly);
  else if (op.tool === 'scalpel') endScalpel(g, op);
  else if (op.tool === 'needle') endNeedle(g, op);
  else if (op.tool === 'taping') endTape(g, op, p);
  if (op.trail && op.trail.length > 1) g.addTrail(op.tool, op.trail);
}

// ================= ヒールゼリー =================
function beginJelly(g, p) {
  const I = g.inst.healjelly;
  if (g.stock <= 0) { invalid(g, 'healjelly'); return; }   // ストック0：無効。塗っている間の回復も起きない
  g.stock--;
  g.op = { tool: 'healjelly', pos: p, trail: [p], covered: new Map(), healed: 0, t: 0 };
  jellyHeal(g, I.paint_heal.first);
  g.loopStart(I.sounds.use);
  paint(g, p, p);
}

function jellyHeal(g, n) {
  const I = g.inst.healjelly, op = g.op;
  const add = Math.min(n, I.paint_heal.cap - op.healed);   // 上限にも回復量にも同じ係数が掛かる
  if (add > 0) { op.healed += add; g.heal(add); }
}

function holdJelly(g, dt) {
  const I = g.inst.healjelly, op = g.op;
  op.t += dt;
  while (op.t >= I.paint_heal.every_sec) { op.t -= I.paint_heal.every_sec; jellyHeal(g, I.paint_heal.step); }
}

// 筆の円が通ったマスを、病巣ごとに記録する
function paint(g, a, b) {
  const r = g.inst.healjelly.brush_radius, op = g.op;
  for (const L of g.active()) {
    const idx = L.accepts('healjelly');
    if (idx < 0 || L.steps[idx].action !== 'cover') continue;
    const cells = L.coverCells(idx);
    let set = op.covered.get(L);
    if (!set) op.covered.set(L, set = new Set());
    cells.forEach((c, i) => { if (!set.has(i) && distPointSeg(c, a, b) <= r) set.add(i); });
  }
}

function endJelly(g, op) {
  const I = g.inst.healjelly;
  let any = false, touched = false;
  for (const [L, set] of op.covered) {
    if (L.done || set.size === 0) continue;
    touched = true;
    const idx = L.accepts('healjelly');
    if (idx < 0 || L.blocked()) continue;                      // 手順違い・血溜まりが重なっている：無効
    const ratio = set.size / L.coverCells(idx).length;
    const thr = L.steps[idx].cover_threshold ?? L.def.cover_threshold ?? I.cover_threshold;
    if (ratio >= thr) {
      L.penalty += Math.round((1 - ratio) * 100);              // 覆いきらなかった分は減点
      L.advance(idx);
      any = true;
    }
  }
  if (any) g.se(I.sounds.success);
  else if (touched) invalid(g, 'healjelly');
}

// ================= ドレーン =================
function holdDrain(g, dt) {
  const op = g.op, I = g.inst.drain;
  op.tick += dt;
  let sucking = false;
  const pools = g.active().filter(L => L.isPool);
  // 押している間は、最初に触れた時点の範囲で吸える（吸って縮んでも、離すまでは範囲から外れない）
  const inRange = L => dist(op.pos, L.sets.main[0]) <= Math.max(L.radius, op.frozen.get(L) ?? 0) + 0.5;
  for (const L of pools) {
    if (!inRange(L)) continue;
    if (!op.frozen.has(L)) op.frozen.set(L, L.radius);
    sucking = true;
  }
  const step = 1 / I.suck_per_sec;
  while (op.tick >= step) {
    op.tick -= step;
    for (const L of pools) {
      if (L.done || !inRange(L)) continue;
      L.amount -= 1;
      if (L.amount <= 0) { L.amount = 0; L.advance(L.stage); }
    }
  }
  if (sucking) g.loopStart(I.sounds.use); else g.loopStop();
}

// ================= ピンセット =================
function beginTweezers(g, p) {
  const I = g.inst.tweezers, r = pick(g, p, 'tweezers');
  if (r.kind === 'miss') return;                               // 空振り：何も起きない
  if (r.kind !== 'hit') { invalid(g, 'tweezers'); return; }
  const L = r.lesion, st = L.steps[r.idx];
  if (st.action === 'carry') {
    g.op = { tool: 'tweezers', mode: 'carry', lesion: L, idx: r.idx, pos: p, grab: p };
    if ((st.dest ?? 'tray') === 'tray') g.tray.show = true;
    g.se(I.sounds.grab);
  } else if (st.action === 'tap') {
    // 点をタップして閉じる（順番は問わない）
    const pts = L.pts(st), rad = st.radius ?? 3;
    let best = -1, bd = Infinity;
    pts.forEach((q, i) => { const d = dist(p, q); if (!L.tapped.has(i) && d <= rad && d < bd) { bd = d; best = i; } });
    if (best < 0) { invalid(g, 'tweezers'); return; }
    L.tapped.add(best);
    g.se(I.sounds.put);
    if (L.tapped.size >= pts.length) L.advance(r.idx);
  } else if (st.action === 'connect') {
    const pts = L.pts(st), a = pts[0], b = pts[pts.length - 1], rad = st.radius ?? 3;
    const fromA = dist(p, a) <= rad, fromB = dist(p, b) <= rad;
    if (!fromA && !fromB) { invalid(g, 'tweezers'); return; }
    g.op = { tool: 'tweezers', mode: 'connect', lesion: L, idx: r.idx, pos: p, from: fromA ? a : b, to: fromA ? b : a };
    g.se(I.sounds.grab);
  } else {
    invalid(g, 'tweezers');
  }
}

function endTweezers(g, op, p, lx, ly) {
  const I = g.inst.tweezers, L = op.lesion, st = L.steps[op.idx];
  g.tray.show = false;
  let ok;
  if (op.mode === 'carry') {
    if ((st.dest ?? 'tray') === 'tray') {
      const t = g.trayRect();
      ok = lx >= t.x && lx <= t.x + t.w && ly >= t.y && ly <= t.y + t.h;
    } else {
      ok = dist(p, [L.pos[0] + st.dest[0], L.pos[1] + st.dest[1]]) <= I.dest_radius;
    }
  } else {
    ok = dist(p, op.to) <= (st.radius ?? 3);
  }
  if (ok) { g.se(I.sounds.put); L.advance(op.idx); }
  else { g.se(I.sounds.fail); L.fail(st.fail_damage ?? I.default_fail_damage); }   // 物は元の位置に戻る
}

// ================= メス =================
function beginScalpel(g, p) {
  const I = g.inst.scalpel, r = pick(g, p, 'scalpel');
  if (r.kind === 'invalid') { invalid(g, 'scalpel'); return; }
  if (r.kind === 'miss') {
    g.op = { tool: 'scalpel', mode: 'miss', pos: p, trail: [p], len: 0, cut: false };
    g.loopStart(I.sounds.use);
    return;
  }
  if (r.kind === 'wrong') { g.se(I.sounds.fail); r.lesion.fail(I.default_fail_damage); return; }   // 手順違い：失敗
  const L = r.lesion, st = L.steps[r.idx], pts = L.pts(st), n = pts.length, R = I.pass_radius;
  const failNow = () => { g.se(I.sounds.fail); L.fail(st.fail_damage ?? I.default_fail_damage); };
  let orders, passed, prev;
  if (!st.closed) {
    // 線状：どちらかの端から切り始める
    const seq = [...Array(n).keys()];
    if (dist(p, pts[0]) <= R) { orders = [seq.slice(1)]; passed = new Set([0]); prev = pts[0]; }
    else if (dist(p, pts[n - 1]) <= R) { orders = [seq.slice(0, n - 1).reverse()]; passed = new Set([n - 1]); prev = pts[n - 1]; }
    else { failNow(); return; }                                // 端以外から切り始めた
  } else {
    // 円形：どの通過点からでもよい。点と点の間から始めてもよい
    let s = -1, sd = Infinity;
    pts.forEach((q, i) => { const d = dist(p, q); if (d <= R && d < sd) { sd = d; s = i; } });
    const fwd = [], back = [];
    if (s >= 0) {
      for (let k = 1; k <= n; k++) { fwd.push((s + k) % n); back.push((s - k + n * 2) % n); }
      passed = new Set([s]); prev = pts[s];
    } else {
      let seg = -1, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = distPointSeg(p, pts[i], pts[(i + 1) % n]); if (d < bd) { bd = d; seg = i; } }
      if (bd > I.tolerance) { failNow(); return; }
      for (let k = 1; k <= n; k++) { fwd.push((seg + k) % n); back.push((seg + 1 - k + n * 2) % n); }
      fwd.push('P'); back.push('P');                           // 一周して、始めた位置に戻る
      passed = new Set(); prev = p;
    }
    orders = [fwd, back];
  }
  g.op = { tool: 'scalpel', mode: 'cut', lesion: L, idx: r.idx, pos: p, press: p, trail: [p], orders, k: 0, passed, prev };
  g.loopStart(I.sounds.use);
}

function moveScalpel(g, a, b) {
  const I = g.inst.scalpel, op = g.op;
  if (op.mode === 'miss') {
    op.len += dist(a, b);
    if (!op.cut && op.len >= I.min_cut_length) { op.cut = true; g.se(I.sounds.miss); g.damage(I.miss_damage); }
    if (op.len >= I.miss_max_length) { op.trail.push(b); g.op = null; g.loopStop(); endScalpel(g, op); g.addTrail('scalpel', op.trail); }
    return;
  }
  const L = op.lesion, st = L.steps[op.idx], pts = L.pts(st), R = I.pass_radius;
  const pt = t => (t === 'P' ? op.press : pts[t]);
  const fail = () => {
    g.op = null; g.loopStop();
    g.se(I.sounds.fail);
    L.fail(st.fail_damage ?? I.default_fail_damage);
    op.trail.push(b); g.addTrail('scalpel', op.trail);
  };
  for (const q of subdivide(a, b)) {
    // 目標の通過点に着いたか
    for (const o of op.orders) {
      const t = o[op.k];
      if (dist(q, pt(t)) <= R) {
        op.orders = [o];
        if (t !== 'P') op.passed.add(t);
        op.prev = pt(t);
        op.k++;
        break;
      }
    }
    if (op.k >= op.orders[0].length) {                         // 最後の通過点に着いた：成功（離さなくてよい）
      g.op = null; g.loopStop();
      op.trail.push(q); g.addTrail('scalpel', op.trail);
      L.advance(op.idx);
      return;
    }
    // 通過点を飛ばしたか（目標以外の、まだ通っていない点の判定範囲に入った）
    const targets = op.orders.map(o => o[op.k]);
    for (let i = 0; i < pts.length; i++) {
      if (op.passed.has(i) || targets.includes(i)) continue;
      if (dist(q, pts[i]) <= R) { fail(); return; }
    }
    // 猶予幅を外れたか
    let d = Infinity;
    for (const o of op.orders) d = Math.min(d, distPointSeg(q, op.prev, pt(o[op.k])));
    if (d > I.tolerance) { fail(); return; }
  }
}

function endScalpel(g, op) {
  // 途中で離した：無効（やり直せる）。空振りで切っていたら、切った場所に切り傷を出す
  if (op.mode !== 'miss' || !op.cut) return;
  const I = g.inst.scalpel;
  const pts = thinTrail(op.trail, 2, I.miss_max_length);
  if (pts.length >= 2) g.spawn(I.miss_spawn, { pos: [0, 0], points: pts, origin: 'miss' });
}

// ================= 縫合針 =================
function beginNeedle(g, p) {
  const I = g.inst.needle;
  let best = null, bd = Infinity;
  for (const L of g.active()) {
    if (L.isPool) continue;
    const idx = L.accepts('needle');
    if (idx < 0 || L.steps[idx].action !== 'stitch') continue;
    const d = distPointPolyline(p, L.pts(L.steps[idx]));
    if (d <= I.tolerance && d < bd) { bd = d; best = { L, idx }; }   // 押した位置に最も近い線
  }
  if (best) {
    if (best.L.blocked()) { invalid(g, 'needle'); return; }
    g.op = { tool: 'needle', lesion: best.L, idx: best.idx, pos: p, trail: [p], count: 0, armed: bd > 0.3 };
    return;
  }
  if (pick(g, p, 'needle').kind === 'invalid') { invalid(g, 'needle'); return; }
  g.se(I.sounds.miss);
  g.damage(I.miss_damage);   // 空振り（縫う段階ではない病巣の上も同じ）。押した瞬間に1回
}

function moveNeedle(g, a, b) {
  const I = g.inst.needle, op = g.op, L = op.lesion, st = L.steps[op.idx], pts = L.pts(st);
  let prev = a;
  for (const q of subdivide(a, b)) {
    if (op.armed) {
      for (let i = 0; i < pts.length - 1; i++) {
        if (segIntersect(prev, q, pts[i], pts[i + 1])) { op.count++; op.armed = false; g.se(I.sounds.cross); break; }
      }
    }
    const d = distPointPolyline(q, pts);
    if (!op.armed && d >= I.tolerance * I.recross_ratio) op.armed = true;   // 手ぶれ対策：線から離れてから戻ったら数える
    if (d > I.tolerance) {
      g.op = null;
      g.se(I.sounds.fail);
      L.fail(st.fail_damage ?? I.default_fail_damage);
      op.trail.push(q); g.addTrail('needle', op.trail);
      return;
    }
    prev = q;
  }
}

export function stitchNeed(L, idx) {
  const st = L.steps[idx];
  return st.count ?? L.pts(st).length;
}

function endNeedle(g, op) {
  if (op.count >= stitchNeed(op.lesion, op.idx)) op.lesion.advance(op.idx);
  else invalid(g, 'needle');   // 回数が足りない：無効（回数は0に戻る）
}

// ================= 注射 =================
function beginInject(g, p) {
  const I = g.inst.injector, drug = g.drug, D = I.drugs[drug];
  if (g.gauges[drug] <= 0) { invalid(g, 'injector'); return; }
  // この薬を打つ段階の病巣（患部に打つ）
  let target = null;
  for (const L of g.active().sort((a, b) => b.serial - a.serial)) {
    if (L.isPool) continue;
    const idx = L.accepts('injector');
    if (idx < 0 || L.steps[idx].drug !== drug) continue;
    if (L.pts(L.steps[idx]).some(q => dist(p, q) <= (L.steps[idx].radius ?? I.inject_point_radius))) { target = { L, idx }; break; }
  }
  if (target) {
    if (target.L.blocked()) { invalid(g, 'injector'); return; }
    g.op = { tool: 'injector', pos: p, lesion: target.L, idx: target.idx };
    g.loopStart(I.sounds.use);
    return;
  }
  if (!D.target) {                                            // 回復剤・麻酔：どこに打っても効く
    g.op = { tool: 'injector', pos: p, lesion: null };
    g.loopStart(I.sounds.use);
    return;
  }
  // 特定の病巣用の薬
  const r = pick(g, p, 'injector');
  if (r.kind === 'invalid') { invalid(g, 'injector'); return; }
  const wrongStage = r.kind !== 'miss' && r.lesion.steps.some(s => s.tool === 'injector' && s.drug === drug);
  if (wrongStage) {                                           // 対象の病巣の別の段階：薬ごとに無効か失敗
    const w = D.wrong_step || { type: 'invalid' };
    if (w.type === 'fail') { g.se(I.sounds.miss); r.lesion.fail(w.damage ?? 1); }
    else invalid(g, 'injector');
    return;
  }
  g.se(I.sounds.miss);
  g.damage(D.miss_damage ?? 1);                               // 空振り：注入しない。ゲージも減らない
}

function holdInject(g, dt) {
  const I = g.inst.injector, op = g.op, drug = g.drug, D = I.drugs[drug];
  const amount = Math.min(I.inject_per_sec * dt, g.gauges[drug]);
  if (amount <= 0) { g.loopStop(); return; }
  g.gauges[drug] -= amount;
  g.injecting = drug;
  if (op.lesion) {
    const L = op.lesion, st = L.steps[op.idx];
    L.injected += amount;
    if (D.target) g.addDose(drug, amount);                    // 患部に打つ麻酔などは限度量に数えない
    if (L.injected >= st.amount) { g.op = null; g.loopStop(); L.advance(op.idx); }
    return;
  }
  if (D.heal_full_gauge) g.heal(D.heal_full_gauge * amount / 100);
  if (D.duration_sec) g.addAnesthesia(D.duration_sec * amount / 100);
  g.addDose(drug, amount);
  g.stepInjected[drug] = (g.stepInjected[drug] || 0) + amount;
}

// ================= テーピング（特別機器） =================
function endTape(g, op, p) {
  const I = g.inst.special.taping;
  if (!inArea(op.start) || dist(op.start, p) < 1) return;
  let best = null;
  for (const L of g.active()) {
    const idx = L.accepts('taping');
    if (idx < 0) continue;
    const cells = L.coverCells(idx);
    const n = cells.filter(c => distPointSeg(c, op.start, p) <= I.band_width / 2).length;
    const ratio = n / cells.length;
    if (!best || ratio > best.ratio) best = { L, idx, ratio };
  }
  if (best && best.ratio >= I.success_ratio) {
    best.L.penalty += Math.round((1 - best.ratio) * 100);      // はみ出た分は減点
    best.L.tape = [op.start, p];
    g.se(I.sounds.stick);
    g.tapeLifted = false;
    best.L.advance(best.idx);
  } else {
    g.se(I.sounds.invalid);                                    // 3割に足りない：無効（テープは持ち上げたまま）
  }
}
