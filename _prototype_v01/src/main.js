import { Screen } from './core/screen.js';
import { Input } from './core/input.js';
import { AudioSys } from './core/audio.js';
import { Save } from './core/save.js';
import { text } from './core/ui.js';
import { TitleScene } from './scenes/title.js';

const IMAGES = [
  'bg_title', 'bg_clinic',
  'patient_skin_0', 'patient_skin_1', 'patient_skin_2',
  'patient_internal_0', 'patient_internal_1', 'patient_internal_2',
  'char_protagonist', 'char_assistant', 'char_broker', 'char_patient',
  'icon_gel', 'icon_drain', 'icon_tweezers', 'icon_scalpel', 'icon_suture', 'icon_syringe',
];
const SE = ['select', 'cancel', 'text', 'success', 'miss', 'invalid', 'heal', 'gel', 'cut', 'stitch', 'grab', 'inject', 'drain', 'heartbeat', 'alarm', 'clear', 'gameover'];
const BGM = ['title', 'talk', 'surgery', 'result'];

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { console.warn('image load failed', src); resolve(null); };
    img.src = src;
  });
}

async function loadJson(url) {
  return (await fetch(url)).json();
}

const canvas = document.getElementById('screen');
const screen = new Screen(canvas);
const audio = new AudioSys();

const game = {
  screen,
  audio,
  scene: null,
  images: {},
  data: {},
  save: null,
  change(scene) {
    this.scene = scene;
    scene.enter?.();
  },
};
window.game = game; // デバッグ用

new Input(canvas, screen, () => game.scene, () => audio.unlock());

async function boot() {
  const [instruments, lesions, difficulty, stages] = await Promise.all([
    loadJson('data/instruments.json'),
    loadJson('data/lesions.json'),
    loadJson('data/difficulty.json'),
    loadJson('data/stages.json'),
  ]);
  game.data = { instruments, lesions, difficulty, stages };
  game.save = new Save(stages.first);
  const o = game.save.data.options;
  audio.setVolume(o.se, o.bgm);

  const imgs = await Promise.all(IMAGES.map((k) => loadImage(`assets/images/${k}.svg`)));
  IMAGES.forEach((k, i) => { game.images[k] = imgs[i]; });

  const sounds = {};
  SE.forEach((k) => { sounds['se_' + k] = `assets/sound/se/${k}.wav`; });
  BGM.forEach((k) => { sounds['bgm_' + k] = `assets/sound/bgm/${k}.wav`; });
  await audio.preload(sounds);

  game.change(new TitleScene(game));
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const c = screen.ctx;
  screen.begin();
  if (game.scene) {
    game.scene.update?.(dt);
    game.scene.draw(c);
  } else {
    text(c, '読み込み中…', 960, 540, { size: 48, align: 'center' });
  }
  screen.end();
  requestAnimationFrame(frame);
}

boot();
requestAnimationFrame(frame);
