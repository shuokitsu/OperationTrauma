// データ・画像・音の読み込み。すべて相対パス（GitHub Pages でも動く）。

import { Save } from './save.js';

const images = new Map();   // ファイル名 → HTMLImageElement（読めなかったものは null）
const buffers = new Map();  // 音の名前 → AudioBuffer
let actx = null;
let seGain = null, bgmGain = null;
let bgm = { name: null, node: null };
const loops = new Map();    // 鳴らしっぱなしの SE（操作中の音）

// JSON を読む。手で編集しやすいよう、行頭が // の行は読み飛ばす。
export async function loadJSON(path) {
  let text;
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    throw new Error(`データファイルを読めません：${path}\n${e.message}`);
  }
  try {
    return JSON.parse(text.split('\n').filter(l => !l.trim().startsWith('//')).join('\n'));
  } catch (e) {
    throw new Error(`データファイルの書き方に誤りがあります：${path}\n${e.message}`);
  }
}

function loadImage(name) {
  if (images.has(name)) return Promise.resolve();
  return new Promise(resolve => {
    const img = new Image();
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      images.set(name, ok ? img : null);
      if (!ok) console.warn('画像を読めません：' + name);
      resolve();
    };
    img.onload = () => {
      // 表示できる形への展開まで済ませる。画面が非表示だと終わらないことがあるので時間で打ち切る
      const t = setTimeout(() => finish(true), 1500);
      (img.decode ? img.decode() : Promise.resolve()).then(() => { clearTimeout(t); finish(true); }, () => { clearTimeout(t); finish(true); });
    };
    img.onerror = () => finish(false);
    img.src = 'assets/images/' + name;
  });
}

export const Assets = {
  async loadImages(names, onProgress) {
    const list = [...new Set(names.filter(Boolean))];
    let n = 0;
    await Promise.all(list.map(name => loadImage(name).then(() => { n++; onProgress && onProgress(n, list.length); })));
  },

  img(name) { return images.get(name) || null; },

  // 音
  initAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    seGain = actx.createGain(); seGain.connect(actx.destination);
    bgmGain = actx.createGain(); bgmGain.connect(actx.destination);
    this.applyVolume();
  },

  resumeAudio() {
    if (actx && actx.state === 'suspended') actx.resume();
  },

  applyVolume() {
    if (!actx) return;
    seGain.gain.value = Save.data.options.se;
    bgmGain.gain.value = Save.data.options.bgm * 0.6;
  },

  async loadSound(name, path) {
    if (!actx || buffers.has(name)) return;
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await actx.decodeAudioData(await res.arrayBuffer());
      buffers.set(name, buf);
    } catch (e) {
      console.warn('音を読めません：' + path, e.message);
    }
  },

  async loadSounds(seNames, bgmNames, onProgress) {
    this.initAudio();
    let n = 0;
    const total = seNames.length;
    await Promise.all(seNames.map(s => this.loadSound(s, `assets/sound/se/${s}.wav`).then(() => { n++; onProgress && onProgress(n, total); })));
    // BGM は待たずに裏で読む（読めたら鳴らせる）
    for (const b of bgmNames) {
      this.loadSound('bgm_' + b, `assets/sound/bgm/${b}.wav`).then(() => {
        if (bgm.name === b && !bgm.node) { bgm.name = null; this.playBgm(b); }
      });
    }
  },

  se(name, volume = 1) {
    if (!actx || !name) return;
    const buf = buffers.get(name);
    if (!buf) return;
    const src = actx.createBufferSource();
    src.buffer = buf;
    if (volume !== 1) {
      const g = actx.createGain(); g.gain.value = volume;
      src.connect(g); g.connect(seGain);
    } else {
      src.connect(seGain);
    }
    src.start();
  },

  // 操作中の音（押している間だけ鳴らす）
  loopStart(name) {
    if (!actx || !name || loops.has(name)) return;
    const buf = buffers.get(name);
    if (!buf) return;
    const src = actx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(seGain); src.start();
    loops.set(name, src);
  },
  loopStop(name) {
    const src = loops.get(name);
    if (src) { try { src.stop(); } catch (e) { /* 止まっていれば何もしない */ } loops.delete(name); }
  },
  loopStopAll() {
    for (const name of [...loops.keys()]) this.loopStop(name);
  },

  // 鳴り続ける音（平坦の「ピー」）。gain を返すので、呼んだ側で小さくして消せる
  tone(name) {
    if (!actx) return null;
    const buf = buffers.get(name);
    if (!buf) return null;
    const src = actx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = actx.createGain();
    src.connect(g); g.connect(seGain); src.start();
    return {
      set(v) { g.gain.value = v; },
      stop() { try { src.stop(); } catch (e) { /* 何もしない */ } }
    };
  },

  playBgm(name) {
    if (bgm.name === name) return;
    this.stopBgm();
    bgm.name = name;
    if (!actx || !name) return;
    const buf = buffers.get('bgm_' + name);
    if (!buf) return;   // まだ読めていない。読めたら loadSounds が鳴らす
    const src = actx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(bgmGain); src.start();
    bgm.node = src;
  },
  stopBgm() {
    if (bgm.node) { try { bgm.node.stop(); } catch (e) { /* 何もしない */ } }
    bgm = { name: null, node: null };
  }
};
