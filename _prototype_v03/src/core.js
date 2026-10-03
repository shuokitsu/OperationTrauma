// 画面の拡大縮小・入力・音・セーブ・描画の共通部品
// 論理座標 1920×1080（spec/04 1.3〜1.4）。縦横比を保ち、余りは黒塗り。範囲外のタッチは無視する。
export const W = 1920, H = 1080;

export class View {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.handlers = null;
    this.primary = null; // 最初の1本の指だけ扱う（spec/05 2.5）
    addEventListener('resize', () => this.resize());
    this.resize();
    const opt = { passive: false };
    canvas.addEventListener('pointerdown', e => this.down(e), opt);
    addEventListener('pointermove', e => this.move(e), opt);
    addEventListener('pointerup', e => this.up(e), opt);
    addEventListener('pointercancel', e => this.cancel(e), opt);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // OS の通知・アプリやタブの切り替えなどで中断されたら「離した」扱い（spec/05 2.5）
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.forceRelease(); });
    addEventListener('blur', () => this.forceRelease());
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const s = Math.min(innerWidth / W, innerHeight / H);
    this.scale = s;
    const cw = Math.round(W * s), ch = Math.round(H * s);
    this.ox = Math.floor((innerWidth - cw) / 2); this.oy = Math.floor((innerHeight - ch) / 2);
    Object.assign(this.cv.style, { left: this.ox + 'px', top: this.oy + 'px', width: cw + 'px', height: ch + 'px' });
    this.cv.width = Math.round(cw * dpr); this.cv.height = Math.round(ch * dpr);
    this.pixel = s * dpr;
  }
  toLogical(e) {
    return { x: (e.clientX - this.ox) / this.scale, y: (e.clientY - this.oy) / this.scale };
  }
  inside(p) { return p.x >= 0 && p.x < W && p.y >= 0 && p.y < H; }
  down(e) {
    e.preventDefault();
    if (this.primary !== null) return; // 2本目以降は無視
    const p = this.toLogical(e);
    if (!this.inside(p)) return;       // 黒塗りの余りは無視（spec/04 1.4）
    this.primary = e.pointerId;
    try { this.cv.setPointerCapture(e.pointerId); } catch (_) {}
    this.handlers?.down?.(p);
  }
  move(e) {
    const p = this.toLogical(e);
    this.hover = p;
    if (e.pointerId !== this.primary) { if (this.primary === null) this.handlers?.hover?.(p); return; }
    e.preventDefault();
    this.handlers?.move?.(p);
  }
  up(e) {
    if (e.pointerId !== this.primary) return;
    e.preventDefault();
    this.primary = null;
    this.handlers?.up?.(this.toLogical(e));
  }
  cancel(e) { if (e.pointerId === this.primary) this.forceRelease(); }
  forceRelease() {
    if (this.primary === null) return;
    this.primary = null;
    this.handlers?.up?.(this.hover || { x: -1, y: -1 }, true);
  }
  get pressing() { return this.primary !== null; }
  begin() {
    const c = this.ctx;
    c.setTransform(this.pixel, 0, 0, this.pixel, 0, 0);
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    return c;
  }
}

// ---------------- 音 ----------------
export class Sound {
  constructor() { this.ac = null; this.buf = {}; this.bgmNode = null; this.bgmName = null; this.loops = {}; this.vol = { se: 0.6, bgm: 0.35 }; }
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return; }
    const se = ['alarm','cancel','clear','cut','drain','gameover','gel','grab','heal','heartbeat','inject','invalid','miss','select','stitch','success','text'];
    se.forEach(n => this.load(n, `assets/sound/se/${n}.wav`));
    ['result','surgery','talk','title'].forEach(n => this.load('bgm_' + n, `assets/sound/bgm/${n}.wav`));
  }
  async load(name, path) {
    try { const r = await fetch(path); this.buf[name] = await this.ac.decodeAudioData(await r.arrayBuffer()); if (this.pendingBgm === name) this.bgm(name.slice(4)); } catch (_) {}
  }
  se(name, rate = 1) {
    if (!this.ac || !this.buf[name]) return;
    const s = this.ac.createBufferSource(); s.buffer = this.buf[name]; s.playbackRate.value = rate;
    const g = this.ac.createGain(); g.gain.value = this.vol.se; s.connect(g).connect(this.ac.destination); s.start();
  }
  loop(name, on) {
    if (!this.ac) return;
    if (on && !this.loops[name] && this.buf[name]) {
      const s = this.ac.createBufferSource(); s.buffer = this.buf[name]; s.loop = true;
      const g = this.ac.createGain(); g.gain.value = this.vol.se * 0.6; s.connect(g).connect(this.ac.destination); s.start();
      this.loops[name] = s;
    } else if (!on && this.loops[name]) { try { this.loops[name].stop(); } catch (_) {} delete this.loops[name]; }
  }
  // オプションの音量（0〜100）を反映する。BGM は再生中のものにもすぐ反映
  setVolume(se, bgm) {
    this.vol.se = se / 100; this.vol.bgm = bgm / 100 * 0.6;
    if (this.bgmGain) this.bgmGain.gain.value = this.vol.bgm;
  }
  stopLoops() { Object.keys(this.loops).forEach(k => this.loop(k, false)); }
  bgm(name) {
    if (this.bgmName === name) return;
    if (this.bgmNode) { try { this.bgmNode.stop(); } catch (_) {} this.bgmNode = null; }
    this.bgmName = name;
    if (!this.ac || !name) return;
    const b = this.buf['bgm_' + name];
    if (!b) { this.pendingBgm = 'bgm_' + name; this.bgmName = null; return; }
    const s = this.ac.createBufferSource(); s.buffer = b; s.loop = true;
    const g = this.ac.createGain(); g.gain.value = this.vol.bgm; s.connect(g).connect(this.ac.destination); s.start();
    this.bgmNode = s; this.bgmGain = g;
  }
}

// ---------------- セーブ ----------------
const KEY = 'operation_trauma_v03';
export function defaultSave() {
  return {
    unlocked: ['s1'], cleared: [], bestRank: {}, flags: [],
    progress: {},          // ステージごとの到達コンティニューポイント（分岐ごと）
    trained: [],           // トレーニングで練習できる病巣の種類
    trainingBest: {},      // 病巣の種類 × 難易度：最高評価と最短時間
    options: { side: 'left', se: 70, bgm: 50, textSpeed: 'normal', skipTalk: false },
  };
}
export function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) { const d = defaultSave(); const r = Object.assign(d, s); r.options = Object.assign(defaultSave().options, s.options || {}); return r; } } catch (_) {}
  return defaultSave();
}
export function writeSave(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} }

// ---------------- 描画の部品 ----------------
export const FONT = '"Yu Gothic UI","Yu Gothic","Hiragino Sans","Noto Sans JP",Meiryo,sans-serif';
export function text(c, s, x, y, o = {}) {
  c.font = `${o.bold ? 'bold ' : ''}${o.size || 28}px ${FONT}`;
  c.fillStyle = o.color || '#fff';
  c.textAlign = o.align || 'left';
  c.textBaseline = o.base || 'alphabetic';
  if (o.stroke) { c.lineWidth = o.stroke; c.strokeStyle = o.strokeColor || '#000'; c.strokeText(s, x, y); }
  c.fillText(s, x, y);
}
export function wrap(c, s, maxW, size = 28) {
  c.font = `${size}px ${FONT}`;
  const out = []; let line = '';
  for (const ch of s) {
    if (ch === '\n') { out.push(line); line = ''; continue; }
    if (c.measureText(line + ch).width > maxW) { out.push(line); line = ch; } else line += ch;
  }
  if (line) out.push(line);
  return out;
}
export function panel(c, x, y, w, h, o = {}) {
  c.fillStyle = o.fill || 'rgba(20,24,32,0.92)';
  c.strokeStyle = o.stroke || '#7f8a99'; c.lineWidth = o.lw || 2;
  roundRect(c, x, y, w, h, o.r ?? 12); c.fill(); if (o.stroke !== null) c.stroke();
}
export function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
const imgCache = {};
export function img(name) {
  if (!imgCache[name]) { const i = new Image(); i.src = 'assets/images/' + name; imgCache[name] = i; }
  return imgCache[name];
}
export function drawImg(c, name, x, y, w, h, fit = 'cover') {
  const i = img(name);
  if (!i.complete || !i.naturalWidth) return false;
  if (fit === 'stretch') { c.drawImage(i, x, y, w, h); return true; }
  if (fit === 'face') {   // 立ち絵の上の部分を切り抜いて顔画像の代わりにする（試作用。本来は別素材：E1）
    const sw = i.naturalWidth * 0.62, sx = (i.naturalWidth - sw) / 2;
    c.drawImage(i, sx, i.naturalHeight * 0.02, sw, sw, x, y, w, h); return true;
  }
  const s = fit === 'cover' ? Math.max(w / i.naturalWidth, h / i.naturalHeight) : Math.min(w / i.naturalWidth, h / i.naturalHeight);
  const dw = i.naturalWidth * s, dh = i.naturalHeight * s;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.drawImage(i, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  c.restore();
  return true;
}

export class Button {
  constructor(x, y, w, h, label, onClick, o = {}) { Object.assign(this, { x, y, w, h, label, onClick, o }); }
  hit(p) { return p && p.x >= this.x && p.x < this.x + this.w && p.y >= this.y && p.y < this.y + this.h; }
  draw(c, hover) {
    const dis = this.o.disabled;
    panel(c, this.x, this.y, this.w, this.h, { fill: dis ? '#2a2d33' : hover ? '#3d5f8f' : (this.o.fill || '#26364d'), stroke: this.o.active ? (this.o.activeColor || '#ffd24a') : '#8fa3c0', lw: this.o.active ? 4 : 2 });
    text(c, this.label, this.x + this.w / 2, this.y + this.h / 2 + 1, { size: this.o.size || 32, align: 'center', base: 'middle', color: dis ? '#777' : '#fff', bold: this.o.bold });
    if (this.o.sub) text(c, this.o.sub, this.x + this.w / 2, this.y + this.h - 14, { size: 20, align: 'center', color: '#c8d3e3' });
  }
}

// 文字送り（会話画面・止める会話）。速さはオプションの「文字送り速度」
export const TEXT_SPEED = { slow: 18, normal: 40, fast: 90 };   // 1秒あたりの文字数（試作の仮の値）
export class Typer {
  constructor(speed) { this.cps = TEXT_SPEED[speed] || TEXT_SPEED.normal; this.reset(''); }
  reset(s) { this.s = s || ''; this.n = 0; }
  update(dt) { this.n = Math.min(this.s.length, this.n + this.cps * dt); }
  get done() { return this.n >= this.s.length; }
  finish() { this.n = this.s.length; }
  get shown() { return this.s.slice(0, Math.floor(this.n)); }
}
