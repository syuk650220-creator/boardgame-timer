'use strict';
/* =========================================================
 * 設定の保存・読み込み
 *  - 設定は端末のブラウザ（localStorage）に保存されます
 *  - 壊れた値が入っていても、ここで正しい値に直してから使います
 * ========================================================= */

const Settings = (() => {
  const STORAGE_KEY = 'bgtimer.settings.v1';
  const MAX_SEC = 99 * 60 + 59;          // 99分59秒まで
  const MAX_PRESETS = 12;

  const ALERT_MODES = ['sound', 'light', 'both'];
  const ALERT_LENGTHS = [3, 5, 10, 0];    // 秒（0 = 止めるまで）
  const WARN_SECS = [0, 3, 5, 10];        // 秒（0 = 予告なし）
  const FLAGS = ['ignoreSilent', 'haptics', 'installTipClosed', 'wakeNoticeClosed'];

  const DEFAULTS = Object.freeze({
    durationSec: 60,
    alertMode: 'both',       // 'sound' 音 / 'light' 光 / 'both' 音＋光
    soundId: 'digital',
    volume: 0.9,             // 0〜1
    lightColor: 'red',
    alertLength: 5,
    warnSec: 0,
    ignoreSilent: true,      // マナーモードでも鳴らす
    haptics: true,           // ボタンを押したときに振動
    presets: Object.freeze([30, 60, 90, 120, 180, 300]),
    installTipClosed: false,
    wakeNoticeClosed: false,
  });

  function sanitizePresets(list) {
    if (!Array.isArray(list)) return DEFAULTS.presets.slice();
    const unique = new Set(list.filter(v => Number.isInteger(v) && v >= 1 && v <= MAX_SEC));
    return Array.from(unique).sort((a, b) => a - b).slice(0, MAX_PRESETS);
  }

  function sanitize(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = { ...DEFAULTS, presets: DEFAULTS.presets.slice() };

    if (Number.isInteger(src.durationSec) && src.durationSec >= 1 && src.durationSec <= MAX_SEC) {
      out.durationSec = src.durationSec;
    }
    if (ALERT_MODES.includes(src.alertMode)) out.alertMode = src.alertMode;
    if (typeof src.soundId === 'string') out.soundId = src.soundId;
    if (typeof src.volume === 'number' && src.volume >= 0 && src.volume <= 1) out.volume = src.volume;
    if (typeof src.lightColor === 'string') out.lightColor = src.lightColor;
    if (ALERT_LENGTHS.includes(src.alertLength)) out.alertLength = src.alertLength;
    if (WARN_SECS.includes(src.warnSec)) out.warnSec = src.warnSec;
    for (const key of FLAGS) {
      if (typeof src[key] === 'boolean') out[key] = src[key];
    }
    if ('presets' in src) out.presets = sanitizePresets(src.presets);
    return out;
  }

  function load() {
    try {
      return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (e) {
      return sanitize(null);
    }
  }

  function save(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      // プライベートブラウズなどで保存できなくても、タイマー自体はそのまま使える
    }
  }

  return { DEFAULTS, MAX_SEC, MAX_PRESETS, ALERT_MODES, ALERT_LENGTHS, WARN_SECS, load, save, sanitize, sanitizePresets };
})();
