// 医療機器ごとの操作（spec/05 3章）。1回の操作＝押してから離すまで
// S は手術シーン。S.damage / S.heal / S.succeed / S.invalid / S.fx などを使う
import { dist, distToSeg, distToPolyline, countCrossings, pathLength, ring, key } from './geometry.js';

// ---- 3.1 ヒールゼリー --------------------------------------------------------
class Gel {
  constructor(S, p, pc) {
    this.S = S; this.cfg = S.inst.gel; this.t = 0; this.healed = 0; this.covered = new Set(); this.alive = true;
    if (S.gelStock < 1) { S.invalid('gel', pc, 'ストックが0'); this.alive = false; return; }
    S.gelStock -= 1;                               // 押した時点で消費する（M11）
    this.heal();                                   // 押した瞬間に1回復（M29）
    S.sound.loop('tool', this.cfg.sounds.use, true);
    this.paint(pc);
  }
  heal() { this.healed += 1; this.S.heal(this.cfg.healOnPress, null, true); }
  paint(pc) {
    const r = this.cfg.brushRadius;
    for (let i = Math.floor(pc[0] - r); i <= Math.ceil(pc[0] + r); i++)
      for (let j = Math.floor(pc[1] - r); j <= Math.ceil(pc[1] + r); j++)
        if (Math.hypot(i + 0.5 - pc[0], j + 0.5 - pc[1]) <= r) this.covered.add(key(i, j));
  }
  move(p, pc) { if (this.alive) this.paint(pc); }
  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    // 2秒ごとに1回復、ストック1回分で最大10
    while (this.healed < this.cfg.healCapPerStock && this.t >= this.healed * this.cfg.healIntervalSec) this.heal();
  }
  end(p, pc) {
    const S = this.S; S.sound.loop('tool', null, false);
    if (!this.alive) return;
    for (const l of S.lesions) {
      if (l.done) continue;
      const touched = [...l.cells].some(k => this.covered.has(k));
      if (!touched) continue;
      const sf = l.stepFor('gel');
      if (!sf) { S.invalid('gel', l.center, '手順違い'); continue; }
      const all = [...l.cells].every(k => this.covered.has(k));
      if (all) S.succeed(l, sf.skip, l.center); else S.invalid('gel', l.center, '覆いきれていない');
    }
  }
  drawCursor(c, S, p) { S.drawBrush(c, p, this.cfg.brushRadius, 'rgba(120,220,255,0.35)', this.covered); }
}

// ---- 3.2 ドレーン ------------------------------------------------------------
class Drain {
  constructor(S, p, pc) { this.S = S; this.cfg = S.inst.drain; this.pc = pc; this.acc = 0; this.warned = new Set(); S.sound.loop('tool', this.cfg.sounds.use, true); }
  move(p, pc) { this.pc = pc; }
  update(dt) {
    const S = this.S, l = S.lesionAt(this.pc);
    if (!l) return;
    if (l.step.tool !== 'drain') { if (!this.warned.has(l.id)) { this.warned.add(l.id); S.invalid('drain', this.pc, '吸う物が無い'); } return; }
    l.sucking = true;
    this.acc += dt;
    while (this.acc >= this.cfg.tickSec) { this.acc -= this.cfg.tickSec; l.amount -= this.cfg.suckPerTick; }
    if (l.amount <= 0) { l.amount = 0; S.succeed(l, false, l.center); }
  }
  end() { this.S.sound.loop('tool', null, false); }
  drawCursor(c, S, p) { S.drawBrush(c, p, 1.5, 'rgba(255,255,255,0.35)'); }
}

// ---- 3.3 ピンセット ----------------------------------------------------------
class Tweezers {
  constructor(S, p, pc) {
    this.S = S; this.cfg = S.inst.tweezers; this.hold = null; this.p = p; this.pc = pc;
    const l = S.lesionAt(pc);
    if (!l) return;                                              // 空振り：何も起きない
    const sf = l.stepFor('tweezers');
    if (!sf || sf.skip) { S.invalid('tweezers', pc, '掴めない'); return; }
    this.hold = l; this.off = [l.center[0] - pc[0], l.center[1] - pc[1]];
    l.held = true; S.sound.se(this.cfg.sounds.use);
    S.showTray = l.step.dest === 'tray';
  }
  move(p, pc) { this.p = p; this.pc = pc; if (this.hold) this.hold.heldAt = [pc[0] + this.off[0], pc[1] + this.off[1]]; }
  update() {}
  end(p, pc) {
    const S = this.S, l = this.hold; S.showTray = false;
    if (!l) return;
    l.held = false; l.heldAt = null;                             // 失敗したら元の位置に戻る（M15）
    const ok = l.step.dest === 'tray' ? S.inTray(p) : dist(pc, l.dest) <= this.cfg.destRange;
    if (ok) {
      if (l.step.dest === 'fixed') S.decor.push({ kind: 'vessel', at: l.dest, r: l.radius, color: l.def.color });
      S.succeed(l, false, l.center);
    } else S.damage(l.step.failDamage ?? this.cfg.failDamageDefault, 'fail', 'tweezers', pc, '落とした');
  }
  drawCursor(c, S, p) { S.drawBrush(c, p, 1, 'rgba(255,255,255,0.4)'); }
}

// ---- 3.4 メス ----------------------------------------------------------------
function cutPath(l, step) { return step.closed ? ring(l.center, l.radius + 2, 8) : l.pts; }

class Scalpel {
  constructor(S, p, pc) {
    this.S = S; this.cfg = S.inst.scalpel; this.trail = [pc]; this.over = false;
    const range = this.cfg.pointRange, tol = this.cfg.tolerance;
    // 切開の対象（今の段階がメス、または消毒を省略してメス）
    for (const l of S.lesions) {
      const sf = l.stepFor('scalpel'); if (!sf) continue;
      const pts = cutPath(l, sf.step), n = pts.length;
      if (sf.step.closed) {
        if (distToPolyline(pc, pts, true) > tol) continue;
        // 円形：どこから始めてもよく、向きも自由（M19）
        const near = pts.findIndex(q => dist(q, pc) <= range);
        this.eng = { l, sf, pts, closed: true, visited: [], dir: 0, startPos: pc };
        if (near >= 0) { this.eng.visited = [near]; this.eng.startPos = pts[near]; this.eng.cand = [(near + n - 1) % n, (near + 1) % n]; }
        else {
          let best = 0, bd = Infinity;
          for (let i = 0; i < n; i++) { const d = distToSeg(pc, pts[i], pts[(i + 1) % n]); if (d < bd) { bd = d; best = i; } }
          this.eng.cand = [best, (best + 1) % n];
        }
        break;
      } else {
        if (dist(pts[0], pc) <= range) { this.eng = { l, sf, pts, closed: false, visited: [0], dir: 1 }; break; }
        if (dist(pts[n - 1], pc) <= range) { this.eng = { l, sf, pts, closed: false, visited: [n - 1], dir: -1 }; break; }
        if (distToPolyline(pc, pts) <= tol) { this.failOn(l, sf, pc, '端から切っていない'); return; }   // M18
      }
    }
    if (this.eng) { S.sound.se(this.cfg.sounds.use); return; }
    // 対象でない病巣の上：手順違い（失敗）
    const other = S.lesionAt(pc);
    if (other) { this.failOn(other, { step: other.step }, pc, '手順違い'); return; }
    this.missing = true;                                          // 空振りの候補（軌跡が短ければ何も起きない）
  }
  failOn(l, sf, pc, why) { this.over = true; this.S.damage(sf.step.failDamage ?? this.cfg.failDamageDefault, 'fail', 'scalpel', pc, why); }
  move(p, pc) {
    if (this.over) return;
    this.trail.push(pc);
    const S = this.S;
    if (this.missing) {
      if (!this.missHit && pathLength(this.trail) >= this.cfg.minCutLength) { this.missHit = true; S.damage(this.cfg.missDamage, 'miss', 'scalpel', pc, '空振り'); }
      return;
    }
    const e = this.eng; if (!e) return;
    const n = e.pts.length, range = this.cfg.pointRange, tol = this.cfg.tolerance;
    const last = e.visited.length ? e.pts[e.visited[e.visited.length - 1]] : e.startPos;
    // 次に通る点
    let expected = null;
    if (e.closed) {
      if (e.visited.length === n) expected = 'start';
      else if (e.dir) expected = (e.visited[e.visited.length - 1] + e.dir + n) % n;
    } else expected = e.visited[e.visited.length - 1] + e.dir;
    // 猶予幅の判定
    const off = expected === 'start' ? distToSeg(pc, last, e.startPos)
      : expected === null ? distToPolyline(pc, e.pts, true)
      : distToSeg(pc, last, e.pts[expected]);
    if (off > tol) { this.failOn(e.l, e.sf, pc, '猶予幅を外れた'); return; }
    if (expected === 'start') { if (dist(pc, e.startPos) <= range) this.success(pc); return; }
    // 点に着いたか
    for (let i = 0; i < n; i++) {
      if (e.visited.includes(i) || dist(e.pts[i], pc) > range) continue;
      if (expected === null) {                                     // 円形で向きがまだ決まっていない
        if (!e.cand.includes(i)) { this.failOn(e.l, e.sf, pc, '通過点を飛ばした'); return; }
        // 通過点から始めた場合は隣の点、線の途中から始めた場合はその線の両端のどちらか
        if (e.visited.length) e.dir = i === (e.visited[0] + 1) % n ? 1 : -1;
        else e.dir = i === e.cand[1] ? 1 : -1;
        e.visited.push(i);
        return;
      } else if (i === expected) {
        e.visited.push(i);
        if (!e.closed && e.visited.length === n) { this.success(pc); return; }
        return;
      } else { this.failOn(e.l, e.sf, pc, '通過点を飛ばした'); return; }   // M18
    }
  }
  success(pc) {
    this.over = true; const e = this.eng, S = this.S;
    if (e.sf.skip) S.damage(e.l.step.skipDamage ?? 0, 'skip', 'scalpel', pc, '消毒を省略');
    S.succeed(e.l, e.sf.skip, pc);
  }
  update() {}
  end(p, pc) {
    const S = this.S;
    if (this.missing && this.missHit) S.spawnSmallCut(this.trail);
    else if (this.eng && !this.over) S.invalid('scalpel', pc, '途中で離した');
  }
  drawCursor(c, S, p) {
    S.drawTrail(c, this.trail, this.over ? 'rgba(255,90,90,0.6)' : 'rgba(255,255,255,0.8)');
    if (this.eng) S.drawVisited(c, this.eng);
  }
}

// ---- 3.5 縫合針 --------------------------------------------------------------
class Suture {
  constructor(S, p, pc) {
    this.S = S; this.cfg = S.inst.suture; this.trail = [pc]; this.over = false; this.count = 0; this.marks = [];
    let best = null, bd = Infinity;
    for (const l of S.lesions) {
      if (!l.stepFor('suture') || l.stepFor('suture').skip) continue;
      const d = distToPolyline(pc, l.pts); if (d <= this.cfg.tolerance && d < bd) { bd = d; best = l; }
    }
    if (best) { this.l = best; return; }
    // 縫う段階ではない病巣の上、何も無い場所：空振り（ダメージ）（M22、M31、M33）
    this.over = true;
    S.damage(this.cfg.missDamage, 'miss', 'suture', pc, S.lesionAt(pc) ? '縫う段階ではない' : '空振り');
  }
  move(p, pc) {
    if (this.over) return;
    const a = this.trail[this.trail.length - 1]; this.trail.push(pc);
    const l = this.l;
    if (distToPolyline(pc, l.pts) > this.cfg.tolerance) {
      this.over = true; this.marks = [];
      this.S.damage(l.step.failDamage ?? this.cfg.failDamageDefault, 'fail', 'suture', pc, '猶予幅を外れた'); return;
    }
    const hits = countCrossings(a, pc, l.pts);
    if (hits.length) {
      this.count += hits.length; this.marks.push(...hits); this.S.sound.se(this.cfg.sounds.use);
      if (this.count >= l.pts.length) { this.over = true; l.stitches = [...this.marks]; this.S.succeed(l, false, pc); }   // 通過点の数だけまたいだ
    }
  }
  update() {}
  end(p, pc) { if (!this.over && this.l) this.S.invalid('suture', pc, `${this.count}/${this.l.pts.length} で離した`); }
  drawCursor(c, S, p) {
    S.drawTrail(c, this.trail, 'rgba(255,240,200,0.8)');
    for (const m of this.marks) S.drawMark(c, m);
    if (this.l && !this.over) S.fxAt(c, p, `${this.count}/${this.l.pts.length}`);
  }
}

// ---- 3.6 注射 ----------------------------------------------------------------
class Syringe {
  constructor(S, p, pc) {
    this.S = S; this.cfg = S.inst.syringe; this.drugId = S.drug; this.drug = this.cfg.drugs[this.drugId]; this.alive = true;
    if (S.gauge <= 0) { S.invalid('syringe', pc, 'ゲージが0'); this.alive = false; return; }
    if (this.drug.targeted) {
      const l = S.lesionAt(pc);
      const ok = l && l.step.tool === 'syringe' && l.step.drug === this.drugId;
      // 空振り・対象外の病巣：タップした時点でダメージ、注入はしない（M24、M32、M33）
      if (!ok) { S.damage(this.drug.missDamage ?? 1, 'miss', 'syringe', pc, l ? '対象外の病巣' : '空振り'); this.alive = false; return; }
      this.l = l;
    }
    S.sound.loop('tool', this.cfg.sounds.use, true);
  }
  move() {}
  update(dt) {
    if (!this.alive) return;
    const S = this.S;
    const amt = Math.min(S.gauge, this.cfg.injectPerSec * dt);
    if (amt <= 0) { S.sound.loop('tool', null, false); return; }
    S.gauge -= amt;
    S.addDose(this.drugId, amt);
    if (this.drugId === 'recovery') S.heal(this.drug.healPerFull * amt / this.cfg.gaugeMax, null, true);
    if (this.drugId === 'anesthesia') S.anesthesia += this.drug.secPerFull * amt / this.cfg.gaugeMax;   // 重ねがけ（M26）
    if (this.l) {
      this.l.injected += amt;
      if (this.l.injected >= this.l.step.need) { this.alive = false; S.sound.loop('tool', null, false); S.succeed(this.l, false, this.l.center); }
    }
  }
  end() { this.S.sound.loop('tool', null, false); }
  drawCursor(c, S, p) { S.drawBrush(c, p, 0.8, 'rgba(160,255,160,0.5)'); }
}

export const TOOLS = { gel: Gel, drain: Drain, tweezers: Tweezers, scalpel: Scalpel, suture: Suture, syringe: Syringe };
