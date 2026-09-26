// 音（仮素材の WAV を Web Audio で鳴らす）
const SE = ['alarm', 'cancel', 'clear', 'cut', 'drain', 'gameover', 'gel', 'grab', 'heal', 'heartbeat', 'inject', 'invalid', 'miss', 'select', 'stitch', 'success', 'text'];
const BGM = ['result', 'surgery', 'talk', 'title'];

export class Sound {
  constructor() {
    this.ac = null; this.buf = {}; this.bgmNode = null; this.bgmName = null;
    this.seVol = 0.7; this.bgmVol = 0.5; this.loops = {};
  }
  // ブラウザの制約で、最初の操作のあとでないと音を出せない
  async unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    this.ac = new AudioContext();
    this.bgmGain = this.ac.createGain(); this.bgmGain.connect(this.ac.destination);
    this.seGain = this.ac.createGain(); this.seGain.connect(this.ac.destination);
    this.setVolume(this.seVol, this.bgmVol);
    const load = async (name, path) => {
      try { const r = await fetch(path); this.buf[name] = await this.ac.decodeAudioData(await r.arrayBuffer()); } catch (e) { /* 仮素材が無くても動かす */ }
    };
    await Promise.all([...SE.map(n => load(n, `assets/sound/se/${n}.wav`)), ...BGM.map(n => load('bgm_' + n, `assets/sound/bgm/${n}.wav`))]);
    if (this.bgmName) { const n = this.bgmName; this.bgmName = null; this.bgm(n); }
  }
  setVolume(se, bgm) {
    this.seVol = se; this.bgmVol = bgm;
    if (this.ac) { this.seGain.gain.value = se; this.bgmGain.gain.value = bgm * 0.6; }
  }
  se(name) {
    if (!name || !this.ac || !this.buf[name]) return;
    const s = this.ac.createBufferSource(); s.buffer = this.buf[name]; s.connect(this.seGain); s.start();
  }
  // 操作中の音（塗る・吸うなど）。押している間だけ繰り返す
  loop(key, name, on) {
    if (!this.ac) return;
    if (on && !this.loops[key] && this.buf[name]) {
      const s = this.ac.createBufferSource(); s.buffer = this.buf[name]; s.loop = true; s.connect(this.seGain); s.start(); this.loops[key] = s;
    } else if (!on && this.loops[key]) { try { this.loops[key].stop(); } catch (e) {} delete this.loops[key]; }
  }
  stopLoops() { for (const k of Object.keys(this.loops)) this.loop(k, null, false); }
  bgm(name) {
    if (this.bgmName === name) return;
    this.bgmName = name;
    if (this.bgmNode) { try { this.bgmNode.stop(); } catch (e) {} this.bgmNode = null; }
    if (!name || !this.ac || !this.buf['bgm_' + name]) return;
    const s = this.ac.createBufferSource(); s.buffer = this.buf['bgm_' + name]; s.loop = true; s.connect(this.bgmGain); s.start(); this.bgmNode = s;
  }
}
