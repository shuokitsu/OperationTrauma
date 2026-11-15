// 起動、画面の拡大縮小、入力、メインループ。

import { Assets, loadJSON } from './assets.js';
import { Save } from './save.js';
import { W, H, COLOR, text } from './ui.js';
import { TitleScreen } from './screens.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');

export const app = {
  canvas, ctx,
  debug: new URLSearchParams(location.search).has('debug'),
  data: { system: null, instruments: null, lesions: null, stageList: null, stages: {}, training: [] },
  screen: null,
  input: { events: [] },   // { type: 'down'|'move'|'up'|'key', x, y, key }（x, y は論理座標）
  time: 0,

  go(screen) {
    Assets.loopStopAll();
    this.screen = screen;
  },

  update(dt) {
    this.time += dt;
    const events = this.input.events;
    this.input.events = [];
    if (this.screen) this.screen.update(dt, events);
  },

  draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, W, H);
    if (this.screen) this.screen.draw(ctx);
  },

  // 確認用：画面が非表示でも、時間を進めて描ける
  step(sec = 1 / 60) {
    let left = sec;
    while (left > 1e-9) {
      const dt = Math.min(1 / 60, left);
      this.update(dt);
      left -= dt;
    }
    this.draw();
  }
};
window.app = app;

// ---- 画面の大きさに合わせる（縦横比 16:9 を保ち、余りは黒） ----
function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
}
window.addEventListener('resize', fit);
fit();

// ---- 入力（Pointer Events。最初に触れた1本の指だけを扱う） ----
const pointers = new Set();
let activeId = null;

function logical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  Assets.initAudio();
  Assets.resumeAudio();
  const first = pointers.size === 0;
  pointers.add(e.pointerId);
  if (!first || activeId !== null) return;   // 指をすべて離してから次の操作
  activeId = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 何もしない */ }
  app.input.events.push({ type: 'down', ...logical(e) });
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== activeId) return;
  app.input.events.push({ type: 'move', ...logical(e) });
});
function release(e) {
  pointers.delete(e.pointerId);
  if (e.pointerId !== activeId) return;
  activeId = null;
  app.input.events.push({ type: 'up', ...logical(e) });
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('contextmenu', e => e.preventDefault());

// 通知やタブの切り替えなどで中断されたら「離した」扱いにする
function interrupted() {
  pointers.clear();
  if (activeId !== null) {
    activeId = null;
    app.input.events.push({ type: 'up', x: -1, y: -1, cancel: true });
  }
}
window.addEventListener('blur', interrupted);
document.addEventListener('visibilitychange', () => { if (document.hidden) interrupted(); });

window.addEventListener('keydown', e => {
  if (e.repeat) return;
  app.input.events.push({ type: 'key', key: e.key });
});

// ---- メインループ ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    app.update(dt);
    app.draw();
  } catch (e) {
    showError(e);
    throw e;
  }
  requestAnimationFrame(frame);
}

function showError(e) {
  const el = document.getElementById('err');
  el.style.display = 'block';
  el.textContent = 'エラーが起きました。\n' + (e && e.message ? e.message : e);
  console.error(e);
}

// ---- データの読み込みと点検 ----
function validate(d) {
  const errs = [];
  const tools = new Set([...d.instruments.order, 'taping']);
  const drugs = d.instruments.injector.drugs;
  for (const [id, def] of Object.entries(d.lesions)) {
    if (id.startsWith('_')) continue;
    for (const [i, st] of (def.steps || []).entries()) {
      if (!tools.has(st.tool)) errs.push(`lesions.json：「${id}」の段階${i + 1}の機器「${st.tool}」がありません`);
      if (st.drug && !drugs[st.drug]) errs.push(`lesions.json：「${id}」の段階${i + 1}の薬「${st.drug}」が instruments.json にありません`);
      if (st.set && !(def.sets && def.sets[st.set])) errs.push(`lesions.json：「${id}」の段階${i + 1}の点の組「${st.set}」がありません`);
    }
    for (const w of def.with || []) if (!d.lesions[w.lesion]) errs.push(`lesions.json：「${id}」の一緒に出す病巣「${w.lesion}」がありません`);
  }
  const check = (stage, file) => {
    const patients = stage.patients || {};
    for (const step of stage.steps || []) {
      if (step.patient && !patients[step.patient]) errs.push(`${file}：ステップ「${step.id}」の患者「${step.patient}」が patients にありません`);
      for (const pl of step.lesions || []) {
        if (!d.lesions[pl.type]) errs.push(`${file}：ステップ「${step.id}」の病巣の種類「${pl.type}」が lesions.json にありません`);
      }
    }
  };
  for (const s of Object.values(d.stages)) check(s, `stages/${s.id}.json`);
  for (const s of d.training) check(s, `training.json（${s.id}）`);
  if (errs.length) throw new Error('データに誤りがあります。\n' + errs.join('\n'));
}

async function boot() {
  Save.load();
  let progress = 'データを読み込んでいます';
  app.screen = {
    update() {},
    draw(c) { text(c, progress, W / 2, H / 2, { size: 40, align: 'center', color: COLOR.dim }); }
  };
  requestAnimationFrame(frame);

  const d = app.data;
  [d.system, d.instruments, d.lesions, d.stageList, d.training] = await Promise.all([
    loadJSON('data/system.json'), loadJSON('data/instruments.json'), loadJSON('data/lesions.json'),
    loadJSON('data/stages/index.json'), loadJSON('data/training.json').then(t => t.stages)
  ]);
  const stages = await Promise.all(d.stageList.stages.map(s => loadJSON('data/stages/' + s.file)));
  d.stageList.stages.forEach((s, i) => { stages[i].id = s.id; d.stages[s.id] = stages[i]; });
  validate(d);

  const snd = d.system.sounds;
  await Assets.loadSounds(snd.se, snd.bgm, (n, t) => { progress = `音を読み込んでいます ${n}/${t}`; });
  const common = [...d.system.common_images, ...d.instruments.order.map(k => d.instruments[k].icon)];
  await Assets.loadImages(common, (n, t) => { progress = `画像を読み込んでいます ${n}/${t}`; });

  app.go(new TitleScreen(app));
}

boot().catch(showError);
