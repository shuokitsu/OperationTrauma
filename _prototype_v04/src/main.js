// 起動、画面の切り替え、セーブとの橋渡し
import { Screen, Input, Sound, loadImages, loadSave, newSave, writeSave, clearSave } from './core.js';
import { Loading, Title, StageSelect, TalkScene, StartPosition, Result, GameOver, TrainingSelect, TrainingResult } from './screens.js';
import { Surgery } from './surgery.js';
import { rankOf, betterRank, betterGrade } from './lesion.js';

const SE = ['alarm', 'cancel', 'checkpoint', 'clear', 'cut', 'dose_warn', 'drain', 'ecg_beep', 'ecg_flatline', 'gameover', 'gel', 'grab', 'heal', 'heartbeat', 'inject', 'invalid', 'lesion_appear', 'miss', 'put', 'rank', 'rate_bad', 'rate_cool', 'rate_fine', 'rate_good', 'rate_ok', 'select', 'stitch', 'success', 'tape_lift', 'tape_stick', 'text'];
const BGM = ['briefing', 'gameover', 'result', 'surgery', 'talk', 'title'];

class App {
  constructor() {
    this.screen = new Screen(document.getElementById('game'));
    this.sound = new Sound();
    this.input = new Input(this.screen, () => { this.sound.unlock(); this.sound.resumePendingBgm(); });
    this.save = loadSave();
    this.applyOptions(false);
    this.scene = new Loading(this);
    this.images = {};
    this.last = performance.now();
    this.debugNames = false; this.debugGrid = false;
    requestAnimationFrame(t => this.frame(t));
    this.boot();
  }
  async boot() {
    const names = ['instruments', 'lesions', 'stages', 'system', 'talks'];
    const data = {};
    await Promise.all(names.map(async n => { data[n] = await (await fetch(`data/${n}.json`, { cache: 'no-cache' })).json(); }));
    this.data = data;
    // 起動時に、データに出てくる画像をすべて読み込んで展開まで済ませる（試作の簡略。本実装はステージごと：spec/08 3.3）
    const imgs = new Set(['bg_title.svg', 'bg_clinic.svg']);
    for (const id of data.instruments.order) imgs.add(data.instruments[id].icon);
    for (const p of Object.values(data.stages.patients)) p.images.forEach(i => imgs.add(i));
    for (const ch of Object.values(data.talks.characters)) imgs.add(ch.image);
    for (const t of Object.values(data.talks)) if (t && t.lines) { if (t.bg) imgs.add(t.bg); t.lines.forEach(l => l.bg && imgs.add(l.bg)); }
    const urls = [...imgs].map(n => 'assets/images/' + n);
    this.scene.total = urls.length + 1;
    const soundList = [...SE.map(n => ({ key: 'se/' + n, url: `assets/sound/se/${n}.wav` })), ...BGM.map(n => ({ key: 'bgm/' + n, url: `assets/sound/bgm/${n}.wav` }))];
    const [images] = await Promise.all([loadImages(urls, d => { this.scene.done = d; }), this.sound.load(soundList)]);
    this.images = images;
    this.toTitle();
  }
  img(name) { return name ? this.images['assets/images/' + name] : null; }
  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.step(dt);
    requestAnimationFrame(t2 => this.frame(t2));
  }
  // 確認用：プレビューが非表示だと requestAnimationFrame が止まるので、外から回せるようにする（prototype_carryover）
  step(dt) {
    const input = this.input.take();
    this.scene.update(dt, input);
    const c = this.screen.ctx;
    this.screen.begin();
    this.scene.draw(c);
    this.screen.end();
  }
  persist() { writeSave(this.save); }
  applyOptions(save = true) {
    const o = this.save.options;
    this.sound.setVolume(o.se / 100, o.bgm / 100);
    if (save) this.persist();
  }
  // ---------- 画面の切り替え ----------
  toTitle() { this.scene = new Title(this); }
  toStageSelect() { this.scene = new StageSelect(this); }
  toTrainingSelect() { this.scene = new TrainingSelect(this); }
  isUnlocked(id) {
    const s = this.data.stages.stages.find(s => s.id === id);
    return !!(this.save.allUnlocked || (s && s.unlock && s.unlock.initial) || this.save.unlocked.includes(id));
  }
  unlockAll() { this.save.allUnlocked = true; this.persist(); }
  resetSave() { clearSave(); const o = this.save.options; this.save = newSave(); this.save.options = o; this.persist(); }
  stageHasChoice(s) {
    const has = id => { const t = this.data.talks[id]; return !!(t && t.lines.some(l => l.choice)); };
    return has(s.dialogue_before) || s.steps.some(st => st.dialogue_before && has(st.dialogue_before));
  }
  briefingInfo(stage) {
    return { text: stage.briefing_text, clear: stage.goals.clear.text, effort: stage.goals.effort || [] };
  }
  // ステージ選択 → 難易度 → 会話・ブリーフィング（選択肢）→ 開始位置 → ゲーム（spec/02 3.2）
  startStage(stage, diff) {
    this.save.lastDifficulty[stage.id] = diff.id; this.persist();
    const run = { stage, difficulty: diff, flags: { ...this.save.flags } };
    const talk = this.data.talks[stage.dialogue_before];
    const scene = new TalkScene(this, talk, {
      flags: { ...run.flags }, skip: this.save.options.skipTalk, briefing: () => this.briefingInfo(stage),
      onDone: flags => {
        run.flags = { ...flags };
        // 分岐（ゲーム前の会話で選んだ選択肢の組み合わせ）ごとに到達点を持つ（spec/07 8章）
        const pre = {};
        for (const [k, v] of Object.entries(flags)) if (this.save.flags[k] !== v) pre[k] = v;
        run.choiceKey = JSON.stringify(Object.keys(pre).sort().map(k => [k, pre[k]]));
        const reached = ((this.save.continues[stage.id] || {})[run.choiceKey]) || {};
        const points = Object.entries(reached).map(([step, r]) => ({ step: +step, name: r.name, flags: r.flags })).sort((a, b) => a.step - b.step);
        if (points.length) this.scene = new StartPosition(this, scene, points, p => this.beginSurgery(run, p.step, p.flags));
        else this.beginSurgery(run, 0);
      },
    });
    this.scene = scene;
  }
  beginSurgery(run, step, cpFlags) {
    run.lastCP = step;
    run.lastCPFlags = cpFlags ? { ...cpFlags } : { ...run.flags };
    this.scene = new Surgery(this, { stage: run.stage, difficulty: run.difficulty, flags: { ...run.lastCPFlags }, startStep: step, run });
  }
  // コンティニューポイントを通過した（spec/02 3.5）
  reachContinue(ctx, nextStep, flags) {
    const run = ctx.run, st = run.stage;
    const prev = st.steps[nextStep - 1];
    const byStage = this.save.continues[st.id] || (this.save.continues[st.id] = {});
    const byKey = byStage[run.choiceKey] || (byStage[run.choiceKey] = {});
    byKey[nextStep] = { name: prev.continue_point_after.name, flags: { ...flags } };   // 同じ地点は最後に到達したときのフラグで上書き（H5）
    this.persist();
    run.lastCP = nextStep; run.lastCPFlags = { ...flags };
    this.sound.se('checkpoint');
  }
  retry(sg) {
    if (sg.training) { this.startTraining(sg.training.mode, sg.training.queue, sg.diff.id); return; }
    const run = sg.ctx.run;
    this.beginSurgery(run, run.lastCP, run.lastCP ? run.lastCPFlags : run.flags);
  }
  gameOverScreen(sg, cause) { this.scene = new GameOver(this, cause, () => this.retry(sg)); }
  stageClear(sg) {
    const st = sg.stage, s = this.save;
    const lesions = sg.history.map(l => ({ name: l.type.name, grade: l.grade, score: l.score, time: l.time, type: l.typeId }));
    const effort = (st.goals.effort || []).map(e => {
      const c = e.condition, v = Math.ceil(sg.vital);
      const ok = c.type === 'miss_count_max' ? sg.misses <= c.value : c.type === 'vital_min_at_clear' ? v >= c.value : c.type === 'time_left_min' ? sg.remain >= c.value : false;
      return { ...e, ok };
    });
    const bonus = effort.reduce((a, e) => a + e.bonus_points, 0);
    const points = lesions.reduce((a, l) => a + l.score, 0) + effort.filter(e => e.ok).reduce((a, e) => a + e.bonus_points, 0);
    const max = 100 * (lesions.length + sg.preCount) + bonus;
    const rank = rankOf(points, max);
    // セーブ：ランク（最高）、フラグ、開放、トレーニングで練習できる病巣
    const cl = s.cleared[st.id] || (s.cleared[st.id] = {});
    cl.bestRank = betterRank(cl.bestRank, rank);
    Object.assign(s.flags, sg.flags);
    const oc = st.on_clear || {};
    for (const id of oc.unlock_stages || []) if (!s.unlocked.includes(id)) s.unlocked.push(id);
    for (const u of oc.unlock_if || []) if (Object.entries(u.flags).every(([k, v]) => sg.flags[k] === v) && !s.unlocked.includes(u.stage)) s.unlocked.push(u.stage);
    for (const l of lesions) if (!s.training.treated.includes(l.type)) s.training.treated.push(l.type);
    this.persist();
    const r = { stageName: st.name, diffName: sg.diff.name, lesions, effort, points, max, rank, preCount: sg.preCount };
    this.scene = new Result(this, r, () => {
      const talk = this.data.talks[st.dialogue_after];
      this.scene = new TalkScene(this, talk, { skip: this.save.options.skipTalk, flags: { ...s.flags }, onDone: () => this.toStageSelect() });
    });
  }
  // ---------- トレーニング ----------
  trainableTypes() {
    const all = Object.keys(this.data.lesions).filter(k => !k.startsWith('_') && !this.data.lesions[k].generated && !this.data.lesions[k].unscored);
    if (this.save.training.all) return all;
    return all.filter(k => this.save.training.treated.includes(k));
  }
  startTraining(mode, queue, diffId) {
    const diff = this.data.system.difficulties.find(d => d.id === diffId);
    this.scene = new Surgery(this, { stage: this.data.stages.training, difficulty: diff, flags: {}, training: { mode, queue: queue.slice(), index: 0 } });
  }
  trainingDone(sg) {
    const diff = sg.diff.id, best = this.save.training.best;
    const list = sg.history.map(l => {
      const b = (best[l.typeId] || (best[l.typeId] = {}));
      const cur = b[diff];
      let improved = false;
      if (!cur) { b[diff] = { grade: l.grade, time: l.time }; improved = true; }
      else {
        const g = betterGrade(l.grade, cur.grade);
        if (g !== cur.grade || l.time < cur.time) improved = true;
        b[diff] = { grade: g, time: Math.min(cur.time, l.time) };
      }
      return { name: l.type.name, grade: l.grade, score: l.score, time: l.time, best: improved };
    });
    this.persist();
    this.scene = new TrainingResult(this, list, sg.diff.name);
  }
}

window.app = new App();
