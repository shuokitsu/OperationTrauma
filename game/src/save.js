// セーブデータ（spec/02 4章、spec/07 8章）。自動セーブ。ブラウザのローカルストレージに保存する。

const KEY = 'operation_trauma_save_v1';

function defaults() {
  return {
    version: 1,
    options: { side: 'left', se: 0.8, bgm: 0.6, textSpeed: 'normal', skipTalk: false, guide: true },
    unlocked: [],        // 開放済みのステージ
    cleared: {},         // ステージごとの最高ランク { stageId: { rank, ratio } }
    flags: [],           // フラグ（選択肢の結果、ゲーム中の結果、クリア状況）
    continuePoints: {},  // { stageId: { 選択の組み合わせ: { stepId: { name, flags } } } }
    treated: [],         // 治療したことのある病巣の種類
    best: {},            // トレーニングのベスト記録 { 病巣の種類: { 難易度: { score, time } } }
    lastDifficulty: {}   // ステージごとに、前回選んだ難易度
  };
}

export const Save = {
  data: defaults(),

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const base = defaults();
        this.data = { ...base, ...d, options: { ...base.options, ...(d.options || {}) } };
      }
    } catch (e) {
      console.warn('セーブデータを読めませんでした', e);
      this.data = defaults();
    }
  },

  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('セーブできませんでした', e);
    }
  },

  // 確認用（?debug=1 のときだけ画面に出す）
  erase() {
    const options = this.data.options;
    this.data = defaults();
    this.data.options = options;
    this.write();
  },

  hasFlag(f) { return this.data.flags.includes(f); },

  recordClear(stageId, rank, ratio) {
    const cur = this.data.cleared[stageId];
    if (!cur || (rank !== null && (cur.rank === null || ratio > cur.ratio))) {
      this.data.cleared[stageId] = { rank, ratio };
    }
  },

  recordTreated(types) {
    for (const t of types) if (!this.data.treated.includes(t)) this.data.treated.push(t);
  },

  recordBest(type, difficulty, score, time) {
    const b = (this.data.best[type] ||= {});
    const cur = b[difficulty];
    b[difficulty] = {
      score: cur ? Math.max(cur.score, score) : score,
      time: cur ? Math.min(cur.time, time) : time
    };
  }
};
