// 画面の拡大縮小・入力・音・素材・セーブ・描画の部品（spec/01 2.1、04 1.4、05 2.5）
export const W = 1920, H = 1080;
export const FONT = '"Yu Gothic", "Hiragino Sans", Meiryo, sans-serif';

// ---------- 画面 ----------
export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  // 縦横比を保ち、幅と高さのうち余裕の少ないほうに合わせる。余りは黒塗り（spec/01 2.1）
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = innerWidth, ch = innerHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.scale = Math.min(cw / W, ch / H);
    this.ox = (cw - W * this.scale) / 2;
    this.oy = (ch - H * this.scale) / 2;
    this.dpr = dpr;
  }
  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.scale * this.dpr, 0, 0, this.scale * this.dpr, this.ox * this.dpr, this.oy * this.dpr);
    c.save();
    c.beginPath(); c.rect(0, 0, W, H); c.clip();
  }
  end() { this.ctx.restore(); }
  toLogical(clientX, clientY) {
    return { x: (clientX - this.ox) / this.scale, y: (clientY - this.oy) / this.scale };
  }
}

// ---------- 入力（最初の1本の指だけ。spec/05 2.5） ----------
export class Input {
  constructor(screen, onFirstGesture) {
    this.screen = screen;
    this.pointerId = null;
    this.down = false;
    this.pos = { x: 0, y: 0 };
    this.events = [];          // {type:'down'|'move'|'up', x, y, cancel?}
    this.keys = [];            // 押されたキー（この更新の分）
    this.waitAllUp = false;    // 最初の指が離れたら、すべて離すまで新しい操作を受けない
    this.activePointers = new Set();
    const cv = screen.canvas;
    const opt = { passive: false };
    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      onFirstGesture && onFirstGesture();
      this.activePointers.add(e.pointerId);
      if (this.pointerId !== null || this.waitAllUp) return;
      const p = screen.toLogical(e.clientX, e.clientY);
      if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return;   // 論理座標の外は無視（spec/04 1.4）
      this.pointerId = e.pointerId;
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      this.down = true; this.pos = p;
      this.events.push({ type: 'down', x: p.x, y: p.y });
    }, opt);
    cv.addEventListener('pointermove', e => {
      if (e.pointerId !== this.pointerId) return;
      e.preventDefault();
      const p = screen.toLogical(e.clientX, e.clientY);
      this.pos = p;
      this.events.push({ type: 'move', x: p.x, y: p.y });
    }, opt);
    const up = (e, cancel) => {
      this.activePointers.delete(e.pointerId);
      if (e.pointerId !== this.pointerId) {
        if (this.activePointers.size === 0) this.waitAllUp = false;
        return;
      }
      const p = screen.toLogical(e.clientX, e.clientY);
      this.pointerId = null; this.down = false;
      this.waitAllUp = this.activePointers.size > 0;
      this.events.push({ type: 'up', x: p.x, y: p.y, cancel });
    };
    cv.addEventListener('pointerup', e => up(e, false));
    cv.addEventListener('pointercancel', e => up(e, true));   // 中断は「離した」扱い（spec/05 2.5）
    addEventListener('blur', () => {
      if (this.pointerId !== null) {
        this.pointerId = null; this.down = false;
        this.events.push({ type: 'up', x: this.pos.x, y: this.pos.y, cancel: true });
      }
      this.activePointers.clear(); this.waitAllUp = false;
    });
    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.push(e.key);
      if (['1', '2', '3', '4', '5', '6', ' ', 'Escape'].includes(e.key)) e.preventDefault();
    });
    cv.addEventListener('contextmenu', e => e.preventDefault());
  }
  take() {
    const ev = this.events, keys = this.keys;
    this.events = []; this.keys = [];
    return { ev, keys };
  }
  // 会話などで操作を打ち切るとき（押していた操作は「離した」扱い）
  forceRelease() {
    if (this.pointerId !== null) {
      this.pointerId = null; this.down = false;
      this.waitAllUp = true;
    }
  }
}

// ---------- 音 ----------
export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.seVol = 0.7; this.bgmVol = 0.5;
    this.bgmNode = null; this.bgmName = null;
  }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.seGain = this.ctx.createGain(); this.seGain.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain(); this.bgmGain.connect(this.ctx.destination);
      this.applyVolume();
      this.decodePending();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setVolume(se, bgm) { this.seVol = se; this.bgmVol = bgm; this.applyVolume(); }
  applyVolume() {
    if (!this.ctx) return;
    this.seGain.gain.value = this.seVol;
    this.bgmGain.gain.value = this.bgmVol;
  }
  async load(list) {     // list: [{key, url}]
    this.raw = this.raw || {};
    await Promise.all(list.map(async ({ key, url }) => {
      try {
        const r = await fetch(url);
        this.raw[key] = await r.arrayBuffer();
      } catch (_) {}
    }));
    if (this.ctx) await this.decodePending();
  }
  async decodePending() {
    if (!this.ctx || !this.raw) return;
    const ps = [];
    for (const [k, ab] of Object.entries(this.raw)) {
      if (this.buffers[k] || !ab) continue;
      ps.push(this.ctx.decodeAudioData(ab.slice(0)).then(b => { this.buffers[k] = b; }).catch(() => {}));
    }
    await Promise.all(ps);
  }
  // SE を鳴らす。戻り値で止めたり音量を変えたりできる
  se(name, { loop = false, vol = 1, rate = 1 } = {}) {
    if (!this.ctx || !name) return null;
    const b = this.buffers['se/' + name];
    if (!b) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = b; src.loop = loop; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(this.seGain);
    src.start();
    const ctx = this.ctx;
    return {
      stop() { try { src.stop(); } catch (_) {} },
      fade(sec) {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + sec);
        try { src.stop(t + sec + 0.05); } catch (_) {}
      },
      setVol(v) { g.gain.value = v; },
    };
  }
  bgm(name) {
    if (!this.ctx) { this.pendingBgm = name; return; }
    if (this.bgmName === name) return;
    if (this.bgmNode) { const n = this.bgmNode; try { n.g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.4); n.src.stop(this.ctx.currentTime + 0.45); } catch (_) {} }
    this.bgmNode = null; this.bgmName = name;
    if (!name) return;
    const b = this.buffers['bgm/' + name];
    if (!b) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.4);
    src.connect(g); g.connect(this.bgmGain); src.start();
    this.bgmNode = { src, g };
  }
  resumePendingBgm() {
    if (this.pendingBgm !== undefined && this.ctx) { const n = this.pendingBgm; this.pendingBgm = undefined; this.bgmName = null; this.bgm(n); }
  }
}

// ---------- 画像の先読み（起動時にすべて読み込み、展開まで済ませる。prototype_carryover） ----------
export async function loadImages(urls, onProgress) {
  const images = {};
  let done = 0;
  await Promise.all(urls.map(url => new Promise(resolve => {
    const img = new Image();
    const finish = () => { done++; onProgress && onProgress(done, urls.length); resolve(); };
    img.onload = () => {
      images[url] = img;
      // 展開は画面が非表示だと終わらないことがあるので、2秒で打ち切る（bug_list B4）
      const dec = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
      Promise.race([dec, new Promise(r => setTimeout(r, 2000))]).then(finish);
    };
    img.onerror = finish;
    img.src = url;
  })));
  return images;
}

// ---------- セーブ（ローカルストレージ。spec/02 4章） ----------
const SAVE_KEY = 'operation_trauma_v04';
export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && s.version === 1) return s;
  } catch (_) {}
  return newSave();
}
export function newSave() {
  return {
    version: 1,
    unlocked: [], cleared: {},          // cleared[stageId] = { bestRank }
    flags: {},
    options: { side: 'left', se: 70, bgm: 50, textSpeed: 'normal', skipTalk: false },
    continues: {},                      // continues[stageId][choiceKey] = { stepIndex, flags }
    lastDifficulty: {},
    training: { treated: [], best: {} },// best[lesionType][difficulty] = { grade, time }
  };
}
export function writeSave(s) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (_) {}
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
}

// ---------- 描画の部品 ----------
export function font(size, weight = 'normal') { return `${weight} ${size}px ${FONT}`; }
export function text(c, str, x, y, { size = 32, color = '#fff', align = 'left', base = 'alphabetic', weight = 'normal', shadow = false, maxWidth } = {}) {
  c.font = font(size, weight);
  c.textAlign = align; c.textBaseline = base;
  if (shadow) { c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillText(str, x + 2, y + 2, maxWidth); }
  c.fillStyle = color;
  c.fillText(str, x, y, maxWidth);
}
export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
// 文字を折り返して描く（日本語は1文字ずつ）
export function wrapText(c, str, x, y, maxW, lineH, opt = {}) {
  c.font = font(opt.size || 32, opt.weight || 'normal');
  const lines = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (c.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
      else line += ch;
    }
    lines.push(line);
  }
  lines.forEach((l, i) => text(c, l, x, y + i * lineH, opt));
  return lines.length;
}
export class Button {
  constructor(x, y, w, h, label, onClick, opt = {}) {
    Object.assign(this, { x, y, w, h, label, onClick }, opt);
  }
  hit(p) { return p.x >= this.x && p.x < this.x + this.w && p.y >= this.y && p.y < this.y + this.h; }
  draw(c, hover = false) {
    const on = this.selected;
    roundRect(c, this.x, this.y, this.w, this.h, 12);
    c.fillStyle = this.disabled ? 'rgba(40,40,40,0.8)' : on ? '#2f7d5b' : hover ? 'rgba(70,90,110,0.95)' : (this.bg || 'rgba(20,28,38,0.9)');
    c.fill();
    c.lineWidth = 3; c.strokeStyle = on ? '#9fe0bf' : (this.border || '#7d8da0'); c.stroke();
    text(c, this.label, this.x + this.w / 2, this.y + this.h / 2 + 2, { size: this.size || 34, align: 'center', base: 'middle', color: this.disabled ? '#777' : '#fff', maxWidth: this.w - 16 });
  }
}
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
