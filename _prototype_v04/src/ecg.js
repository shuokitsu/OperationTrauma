// 心電図（spec/03 1.4、04 3.3。2026-10-09 決定）
// - テンポはバイタルに応じてなめらかに変える（例：99 で 60拍/分 → 1 で 150拍/分）
// - 麻酔中はバイタルに関係なく安静（ゆっくり）。効き始め・切れ目は数秒かけて移す
// - バイタル0と限度量の超過で平坦になり「ピー」と鳴り続ける。ゲームオーバーの会話で数秒かけて消す
// - 一時停止・止める会話の間は、波形も音も止める（update を呼ばなければ止まる）
// - 患者画像の拍動アニメーションも同じテンポ（beatPhase を使う）
import { clamp, lerp } from './core.js';

const WINDOW_SEC = 4;      // 画面に出す長さ（秒）
const RATE = 90;           // 1秒あたりの点の数

export class Ecg {
  constructor(sound, cfg = {}) {
    this.sound = sound;
    this.cfg = Object.assign({ bpm_at_99: 60, bpm_at_1: 150, bpm_anesthesia: 48, transition_sec: 3 }, cfg);
    this.reset(99);
  }
  reset(vital) {
    this.bpm = this.targetBpm(vital, false);
    this.phase = 0.6;
    this.samples = new Array(WINDOW_SEC * RATE).fill(0);
    this.acc = 0;
    this.flat = false;
    this.flatHandle && this.flatHandle.stop();
    this.flatHandle = null;
    this.lastBeatAt = -1;
  }
  targetBpm(vital, anesthesia) {
    if (anesthesia) return this.cfg.bpm_anesthesia;
    const t = clamp((vital - 1) / 98, 0, 1);
    return lerp(this.cfg.bpm_at_1, this.cfg.bpm_at_99, t);
  }
  // dt：ゲーム内の経過時間（止まっている間は呼ばない）
  update(dt, vital, anesthesia) {
    if (!this.flat) {
      const target = this.targetBpm(vital, anesthesia);
      // 数秒かけてなめらかに移す（指数的に近づける。3秒でほぼ追いつく）
      const k = 1 - Math.exp(-dt * 3 / this.cfg.transition_sec);
      this.bpm += (target - this.bpm) * k;
      const before = this.phase;
      this.phase += dt * this.bpm / 60;
      if (Math.floor(this.phase) !== Math.floor(before)) {
        this.sound.se('ecg_beep', { vol: 0.55 });
        this.lastBeatAt = 0;
      }
    }
    if (this.lastBeatAt >= 0) this.lastBeatAt += dt;
    // 波形の点を足す
    this.acc += dt * RATE;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.samples.shift();
      this.samples.push(this.flat ? 0 : wave(this.phase - this.acc / RATE * this.bpm / 60));
    }
  }
  flatline() {
    if (this.flat) return;
    this.flat = true;
    this.flatHandle = this.sound.se('ecg_flatline', { loop: true, vol: 0.5 });
  }
  // ゲームオーバーの会話が始まったら、数秒かけて小さくして消す
  fadeFlatline(sec = 3) {
    if (this.flatHandle) { this.flatHandle.fade(sec); this.flatHandle = null; }
  }
  stopSound() { if (this.flatHandle) { this.flatHandle.stop(); this.flatHandle = null; } }
  // 拍の中の位置（0〜1。0 が R 波）。患者画像の拍動に使う
  get beatPhase() { return this.flat ? 0.99 : this.phase - Math.floor(this.phase); }

  draw(c, x, y, w, h, color = '#3dff8a') {
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = '#050b08'; c.fillRect(x, y, w, h);
    // 方眼
    c.strokeStyle = 'rgba(60,140,90,0.18)'; c.lineWidth = 1;
    for (let gx = x; gx < x + w; gx += 35) { c.beginPath(); c.moveTo(gx, y); c.lineTo(gx, y + h); c.stroke(); }
    for (let gy = y; gy < y + h; gy += 35) { c.beginPath(); c.moveTo(x, gy); c.lineTo(x + w, gy); c.stroke(); }
    const n = this.samples.length;
    const mid = y + h * 0.62, amp = h * 0.42;
    c.strokeStyle = this.flat ? '#ff5050' : color;
    c.lineWidth = 4; c.lineJoin = 'round';
    c.shadowColor = c.strokeStyle; c.shadowBlur = 10;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + (i / (n - 1)) * w;
      const py = mid - this.samples[i] * amp;
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.stroke();
    c.restore();
  }
}

// 1拍の波形（phase の小数部。0 が R 波の頂点）
function wave(phase) {
  let p = phase - Math.floor(phase);
  p = (p + 0.25) % 1;              // R 波を 0.25 の位置に
  const g = (c, wdt, a) => a * Math.exp(-((p - c) * (p - c)) / (2 * wdt * wdt));
  return g(0.12, 0.025, 0.12)      // P
    + g(0.215, 0.008, -0.15)       // Q
    + g(0.25, 0.011, 1.0)          // R
    + g(0.285, 0.01, -0.25)        // S
    + g(0.48, 0.045, 0.22);        // T
}
