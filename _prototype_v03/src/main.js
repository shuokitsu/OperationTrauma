// 起動・画面の切り替え・セーブとの橋渡し
import { View, Sound, loadSave, writeSave, defaultSave } from './core.js';
import { Title, StageSelect, Talk, StartPosition, Result, GameOver, TrainingSelect, TrainingResult } from './screens.js';
import { Surgery } from './surgery.js';

class App {
  constructor(data) {
    this.data = data;
    this.view = new View(document.getElementById('c'));
    this.sound = new Sound();
    this.save = loadSave();
    this.view.handlers = {
      down: p => this.scene.down?.(p),
      move: p => this.scene.move?.(p),
      up: (p, forced) => this.scene.up?.(p, forced),
      hover: p => this.scene.hover?.(p),
    };
    addEventListener('keydown', e => { this.sound.unlock(); this.scene.key?.(e.key); });
    this.go(new Title(this));
    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.scene.update?.(dt);
      const c = this.view.begin();
      this.scene.draw(c);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  go(scene) { this.sound.stopLoops(); this.scene = scene; }
  writeSave() { writeSave(this.save); }
  resetSave() { this.save = defaultSave(); this.writeSave(); }
  unlockAll() { this.save.unlocked = this.data.stages.stages.map(s => s.id); this.writeSave(); }
  toTitle() { this.go(new Title(this)); }

  // ステージ選択 → 難易度 → 会話・ブリーフィング（選択肢）→ 開始位置 → ゲーム（spec/02 3.2・3.3）
  beginStage(stage, diff) {
    const talk = new Talk(this, this.data.talks[stage.talk_before], flags => {
      const pre = [...flags].sort();
      const entries = (this.save.progress[stage.id] || []).filter(e => e.pre.join('|') === pre.join('|'));  // 選んだ分岐で到達した地点だけ
      const startAt = (step, f) => this.startSurgery({ stage, diff, startStep: step, flags: f || pre, preFlags: pre });
      if (!entries.length) return startAt(0);
      const list = [...entries].sort((a, b) => a.step - b.step);
      this.go(new StartPosition(this, stage, list, o => startAt(o.step, o.flags)));
    });
    talk.goals = stage.goals;
    this.go(talk);
  }
  startSurgery(cfg) { this.go(new Surgery(this, cfg)); }
  recordProgress(stageId, pre, step, flags) {
    const list = this.save.progress[stageId] = this.save.progress[stageId] || [];
    const k = pre.join('|');
    let e = list.find(x => x.pre.join('|') === k && x.step === step);
    if (!e) list.push({ pre: [...pre], step, flags: [...flags] }); else e.flags = [...flags];
    this.writeSave();
  }
  onGameOver(sg, cause) {
    if (sg.training) return this.go(new TrainingSelect(this, { diffIdx: sg.training.diffIdx }));   // トレーニングは病巣選択に戻る
    // どの原因でも会話を挟んでからゲームオーバー画面へ（B5）
    const id = (sg.stage.gameover_dialogues || this.data.stages.gameover_dialogues)[cause];
    this.go(new Talk(this, this.data.talks[id], () => this.go(new GameOver(this, sg, cause)), { noSkip: true }));
  }
  onClear(sg) {
    const st = sg.stage, S = this.save, r = sg.result;
    if (!S.cleared.includes(st.id)) S.cleared.push(st.id);
    const order = ['XS', 'S', 'A', 'B', 'C', 'D'];
    if (r.rank && (!S.bestRank[st.id] || order.indexOf(r.rank) < order.indexOf(S.bestRank[st.id]))) S.bestRank[st.id] = r.rank;   // 最高ランク（B4）
    const oc = st.on_clear || {};
    (oc.unlock || []).forEach(id => { if (!S.unlocked.includes(id)) S.unlocked.push(id); });
    (oc.unlock_if || []).forEach(u => { if (sg.flags.has(u.flag) && !S.unlocked.includes(u.stage)) S.unlocked.push(u.stage); });
    // トレーニング：その病巣が出るステージをクリアした時点で記録（A2）
    for (const step of st.steps) for (const p of step.placements || []) if (!S.trained.includes(p.lesion)) S.trained.push(p.lesion);
    this.writeSave();
    this.go(new Result(this, sg, () => this.go(new Talk(this, this.data.talks[st.talk_after], () => this.go(new StageSelect(this))))));
  }
  startTraining(spec) {
    const T = this.data.stages.training;
    const diff = this.data.system.difficulties[spec.diffIdx].id;
    this.go(new Surgery(this, { stage: { ...T, steps: [{}], goals: { effort: [] } }, diff, training: { ...spec, spec } }));
  }
  recordTrainingBest(kind, diff, score) {
    const k = kind + '|' + diff, b = this.save.trainingBest[k];
    const ev = ['Cool', 'Good', 'Fine', 'Bad'];
    if (!b) this.save.trainingBest[k] = { eval: score.eval, time: score.time };
    else { if (ev.indexOf(score.eval) < ev.indexOf(b.eval)) b.eval = score.eval; if (score.time < b.time) b.time = score.time; }
    this.writeSave();
  }
  onTrainingEnd(sg) { this.go(new TrainingResult(this, sg)); }
}

async function boot() {
  const get = n => fetch(`data/${n}.json`).then(r => { if (!r.ok) throw new Error(n); return r.json(); });   // 相対パス（GitHub Pages でも動く）
  try {
    const [instruments, lesions, stages, system, talks] = await Promise.all(['instruments', 'lesions', 'stages', 'system', 'talks'].map(get));
    document.getElementById('boot').remove();
    window.app = new App({ instruments, lesions, stages, system, talks });
  } catch (e) {
    document.getElementById('boot').textContent = 'データの読み込みに失敗しました（index.html を直接開いた場合は、サーバ経由か GitHub Pages で開いてください）：' + e.message;
  }
}
boot();
