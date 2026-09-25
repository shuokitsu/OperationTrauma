// ステージ1回分の流れ：難易度選択後 → 会話（ブリーフィング） → 手術 → リザルト → 会話 → ステージセレクト
import { TalkScene } from './scenes/talk.js';
import { SurgeryScene } from './scenes/surgery.js';
import { ResultScene } from './scenes/result.js';
import { SelectScene } from './scenes/select.js';

export function checkCond(cond, flags) {
  if (!cond) return true;
  return flags[cond.flag] === cond.eq;
}

export class StageRun {
  constructor(game, stageId, difficultyId) {
    this.game = game;
    this.stageId = stageId;
    this.stage = game.data.stages.stages[stageId];
    this.difficultyId = difficultyId;
    // フラグはステージ中はコピーを使い、クリア時にセーブへ書き戻す（仮：TBD-02-8）
    this.flags = { ...game.save.data.flags };
  }

  start() {
    this.game.change(new TalkScene(this.game, {
      lines: this.stage.talkBefore,
      run: this,
      onEnd: () => this.startSurgery(),
    }));
  }

  startSurgery() {
    this.game.change(new SurgeryScene(this.game, this));
  }

  // リトライ：会話は繰り返さず、ゲーム開始時点からやり直す（仮：TBD-02-10）
  retry() {
    this.startSurgery();
  }

  cleared(result) {
    this.game.change(new ResultScene(this.game, this, result));
  }

  afterResult(result) {
    this.game.change(new TalkScene(this.game, {
      lines: this.stage.talkAfter,
      run: this,
      onEnd: () => this.finish(result),
    }));
  }

  finish(result) {
    const save = this.game.save;
    save.data.flags = { ...this.flags };
    save.recordRank(this.stageId, this.difficultyId, result.rank);
    for (const u of this.stage.unlocks || []) {
      if (checkCond(u.if, this.flags)) save.unlock(u.stage);
    }
    save.write();
    this.game.change(new SelectScene(this.game));
  }
}
