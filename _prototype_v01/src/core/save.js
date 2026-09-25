// 自動セーブ（ローカルストレージ）。読み書きに失敗してもゲームは続ける。
const KEY = 'operationtrauma_proto_v1';

const RANK_ORDER = ['D', 'C', 'B', 'A', 'S', 'XS'];

function defaults(firstStage) {
  return {
    unlocked: [firstStage],
    ranks: {},            // ranks[stageId][difficultyId] = 最高ランク
    flags: {},
    lastDifficulty: {},   // ステージごとに前回選んだ難易度
    options: { side: 'left', se: 0.8, bgm: 0.6, textSpeed: 'normal', skipTalk: false },
  };
}

export class Save {
  constructor(firstStage) {
    this.data = defaults(firstStage);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = { ...this.data, ...d, options: { ...this.data.options, ...(d.options || {}) } };
      }
    } catch (e) {
      console.warn('save load failed', e);
    }
  }

  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('save write failed', e);
    }
  }

  unlock(stageId) {
    if (!this.data.unlocked.includes(stageId)) this.data.unlocked.push(stageId);
  }

  recordRank(stageId, diff, rank) {
    const r = (this.data.ranks[stageId] ||= {});
    if (!r[diff] || RANK_ORDER.indexOf(rank) > RANK_ORDER.indexOf(r[diff])) r[diff] = rank;
  }

  bestRank(stageId) {
    const r = this.data.ranks[stageId];
    if (!r) return null;
    return Object.values(r).sort((a, b) => RANK_ORDER.indexOf(b) - RANK_ORDER.indexOf(a))[0];
  }
}
