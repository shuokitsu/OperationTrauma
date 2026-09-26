// 自動セーブ（spec/02 4章）。ブラウザのローカルストレージに保存する
const KEY = 'operationtrauma_v02';
const DEFAULT = {
  unlocked: ['s1'], ranks: {}, lastDifficulty: {}, flags: {},
  options: { side: 'left', seVol: 0.7, bgmVol: 0.5, textSpeed: 'normal', skipTalk: false },
};

export function loadSave() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d) return { ...structuredClone(DEFAULT), ...d, options: { ...DEFAULT.options, ...(d.options || {}) } };
  } catch (e) {}
  return structuredClone(DEFAULT);
}
export function writeSave(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
