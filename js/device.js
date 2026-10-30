'use strict';
/* =========================================================
 * 端末の機能
 *  - ScreenWake : タイマー画面を開いている間、画面が自動で消えないようにする
 *  - Haptics    : ボタンを押したときに軽く振動させる
 * ========================================================= */

/**
 * 画面のスリープ防止（Screen Wake Lock API）
 *  - iPhone では iOS 16.4 以降・https で開いたときに使えます
 *  - アプリを切り替えると OS が自動で解除するので、戻ってきたら取り直します
 */
const ScreenWake = {
  _sentinel: null,
  _pending: null,
  _wanted: false,
  failed: false,
  onChange: () => {},

  get supported() {
    return 'wakeLock' in navigator && window.isSecureContext;
  },

  get active() {
    return !!this._sentinel && !this._sentinel.released;
  },

  init(onChange) {
    this.onChange = onChange || this.onChange;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this._wanted) this._acquire();
    });
  },

  /** スリープ防止を始める（すでに有効なら何もしない） */
  enable() {
    this._wanted = true;
    return this._acquire();
  },

  async _acquire() {
    if (!this.supported || this.active || document.visibilityState !== 'visible') return;
    if (this._pending) return this._pending;
    this._pending = (async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (!this._wanted) {
          sentinel.release();
          return;
        }
        this._sentinel = sentinel;
        this.failed = false;
        sentinel.addEventListener('release', () => {
          if (this._sentinel === sentinel) this._sentinel = null;
          this.onChange();
        });
      } catch (e) {
        this.failed = true;
      } finally {
        this._pending = null;
        this.onChange();
      }
    })();
    return this._pending;
  },

  async disable() {
    this._wanted = false;
    const sentinel = this._sentinel;
    this._sentinel = null;
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch (e) {
        // すでに解除されている
      }
    }
    this.onChange();
  },
};

/**
 * 振動
 *  - Android など：Vibration API
 *  - iPhone（iOS 18 以降）：見えないスイッチ部品を切り替えたときの触覚フィードバックを利用
 *    ※ ボタンを押した瞬間（ユーザー操作の中）でしか振動しません
 */
const Haptics = {
  enabled: true,

  tap() {
    if (!this.enabled) return;
    try {
      if (typeof navigator.vibrate === 'function' && !isIOS()) {
        navigator.vibrate(12);
        return;
      }
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.append(input);
      document.head.append(label);
      label.click();
      label.remove();
    } catch (e) {
      // 振動できない端末では何もしない
    }
  },
};
