'use strict';
/* =========================================================
 * 共通の小さな道具
 * ========================================================= */

/** 秒数を「1:30」の形にする */
function formatClock(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/** 秒数を「1分30秒」の形にする */
function formatJa(totalSec) {
  const sec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0 && s > 0) return m + '分' + s + '秒';
  if (m > 0) return m + '分';
  return s + '秒';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function $(selector, root) {
  return (root || document).querySelector(selector);
}

function $$(selector, root) {
  return Array.from((root || document).querySelectorAll(selector));
}

/** iPhone / iPad で開いているか */
function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** ホーム画面に追加したアプリとして起動しているか */
function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}
