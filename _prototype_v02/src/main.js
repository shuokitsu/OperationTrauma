// 起動と画面の流れ（spec/02 2章）
import { View } from './core/view.js';
import { Sound } from './core/sound.js';
import { loadSave, writeSave } from './core/save.js';
import { Title, Select, Talk, Result, GameOver } from './scenes/screens.js';
import { Surgery } from './scenes/surgery.js';

class App {
  async start() {
    this.view = new View(document.getElementById('screen'));
    this.sound = new Sound();
    const get = n => fetch(`data/${n}.json`).then(r => r.json());
    const [instruments, lesions, stages, talks, system] = await Promise.all(['instruments', 'lesions', 'stages', 'talks', 'system'].map(get));
    this.data = { instruments, lesions, stages, talks, system };
    this.save = loadSave();
    this.applyOptions();
    this.toTitle();
    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.scene.update?.(dt);
      this.view.begin(); this.scene.draw(this.view.ctx); this.view.end();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  setScene(s) {
    this.scene = s;
    this.view.handlers = {
      down: p => { this.sound.unlock(); s.down?.(p); },
      move: p => s.move?.(p), up: p => s.up?.(p), hover: p => s.hoverAt?.(p), key: k => s.key?.(k),
    };
  }
  applyOptions() { const o = this.save.options; this.sound.setVolume(o.seVol, o.bgmVol); writeSave(this.save); }
  toTitle() { this.run = null; this.sound.stopLoops(); this.setScene(new Title(this)); }
  toSelect() { this.setScene(new Select(this)); }

  // ステージ中はフラグの複製を使い、クリアしたときにセーブへ書き戻す（試作の仮）
  startStage(id, diffId) {
    const stage = this.data.stages.stages[id];
    const difficulty = this.data.system.difficulties.find(d => d.id === diffId);
    this.save.lastDifficulty[id] = diffId; writeSave(this.save);
    this.run = { id, stage, difficulty, flags: { ...this.save.flags } };
    const briefing = { goal: stage.clearGoal, efforts: stage.score.filter(s => s.label).map(s => s.label) };
    this.setScene(new Talk(this, stage.talkBefore, () => this.toSurgery(), { briefing }));
  }
  toSurgery() { this.setScene(new Surgery(this, this.run)); }
  retry() { this.sound.stopLoops(); this.toSurgery(); }     // 会話は繰り返さない（試作の仮）
  surgeryEnded(reason, st) {
    const stage = this.run.stage;
    if (reason === 'clear') {
      const lines = stage.score.map(s => ({
        label: s.type === 'clear' ? 'クリア' : s.label, pts: s.pts,
        ok: s.type === 'clear' || (s.type === 'noMiss' && st.misses === 0) || (s.type === 'timeLeft' && st.timeLeft >= s.sec) || (s.type === 'vital' && st.vital >= s.min),
      }));
      const score = lines.reduce((a, l) => a + (l.ok ? l.pts : 0), 0);
      const rank = this.data.system.ranks.find(r => score >= r.min).rank;
      this.result = { lines, score, rank };
      this.setScene(new Result(this, this.result));
    } else if (reason === 'time') {
      this.setScene(new Talk(this, stage.timeUpTalk, () => this.setScene(new GameOver(this, '時間切れ'))));
    } else {
      this.setScene(new GameOver(this, reason === 'overdose' ? st.detail : 'バイタルが 0 になった'));
    }
  }
  afterResult() {
    const { id, stage, flags } = this.run;
    const best = this.save.ranks[id];
    if (!best || this.result.score > best.score) this.save.ranks[id] = { rank: this.result.rank, score: this.result.score };
    this.save.flags = { ...flags };
    for (const n of stage.next) if (!n.cond || flags[n.cond.flag] === n.cond.eq) if (!this.save.unlocked.includes(n.stage)) this.save.unlocked.push(n.stage);
    writeSave(this.save);
    this.setScene(new Talk(this, stage.talkAfter, () => this.toSelect()));
  }
}

window.app = new App();   // 試作の確認用に公開する
window.app.start();
