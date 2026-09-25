// Web Audio で SE と BGM を鳴らす。ブラウザの制約で、最初の操作までは音を出せない。
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.raw = {};
    this.buf = {};
    this.vol = { se: 0.8, bgm: 0.6 };
    this.wanted = null;
    this.current = null;
    this.currentName = null;
  }

  async preload(map) {
    await Promise.all(Object.entries(map).map(async ([key, url]) => {
      try {
        this.raw[key] = await (await fetch(url)).arrayBuffer();
      } catch (e) {
        console.warn('audio load failed', key, e);
      }
    }));
  }

  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.seGain = this.ctx.createGain();
    this.seGain.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.connect(this.ctx.destination);
    this.applyVolume();
    await Promise.all(Object.entries(this.raw).map(async ([key, ab]) => {
      try {
        this.buf[key] = await this.ctx.decodeAudioData(ab.slice(0));
      } catch (e) {
        console.warn('audio decode failed', key, e);
      }
    }));
    if (this.wanted) {
      const name = this.wanted;
      this.wanted = null;
      this.bgm(name);
    }
  }

  setVolume(se, bgm) {
    this.vol = { se, bgm };
    this.applyVolume();
  }

  applyVolume() {
    if (!this.ctx) return;
    this.seGain.gain.value = this.vol.se;
    this.bgmGain.gain.value = this.vol.bgm * 0.5;
  }

  se(name) {
    const b = this.buf['se_' + name];
    if (!this.ctx || !b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.seGain);
    s.start();
  }

  bgm(name) {
    if (name === this.currentName) return;
    this.stopBgm();
    if (!name) return;
    const b = this.buf['bgm_' + name];
    if (!this.ctx || !b) {
      this.wanted = name;
      return;
    }
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.connect(this.bgmGain);
    s.start();
    this.current = s;
    this.currentName = name;
  }

  stopBgm() {
    if (this.current) {
      try { this.current.stop(); } catch (e) { /* 既に停止済み */ }
    }
    this.current = null;
    this.currentName = null;
    this.wanted = null;
  }
}
