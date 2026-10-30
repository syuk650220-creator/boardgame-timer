'use strict';
/* =========================================================
 * カウントダウンの中身（画面とは切り離したロジック）
 *
 *   ready（待機） ──press──▶ running（計測中） ──時間切れ──▶ finished（時間切れ）
 *        ▲                        │                               │
 *        └────────press（リセット）┴───────────press（リセット）────┘
 *
 *  - 残り時間は「終了予定時刻 − 現在時刻」で毎回計算するので、
 *    処理が遅れたりアプリを切り替えたりしても時間はずれません
 *  - now / setTimer / clearTimer を差し替えるとテストできます（tools/test-timer.js）
 * ========================================================= */

class CountdownTimer {
  /**
   * @param {object} options
   * @param {number} options.durationMs 制限時間（ミリ秒）
   * @param {number} [options.warnSec] 残り何秒から毎秒予告するか（0 = なし）
   * @param {(state: string) => void} [options.onChange] 状態が変わったとき
   * @param {(secLeft: number) => void} [options.onWarn] 予告のタイミング（残り秒数つき）
   * @param {(lateMs: number) => void} [options.onFinish] 時間切れになったとき
   */
  constructor({
    durationMs,
    warnSec = 0,
    onChange = () => {},
    onWarn = () => {},
    onFinish = () => {},
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
  }) {
    this.durationMs = durationMs;
    this.warnSec = warnSec;
    this.onChange = onChange;
    this.onWarn = onWarn;
    this.onFinish = onFinish;
    this._now = now;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;

    this.state = 'ready';
    this.endAt = 0;
    this._nextWarn = 0;
    this._timerId = null;
  }

  /** 残り時間（ミリ秒） */
  get remainingMs() {
    if (this.state === 'running') return Math.max(0, this.endAt - this._now());
    return this.state === 'ready' ? this.durationMs : 0;
  }

  /** 時間切れになってからの経過時間（ミリ秒） */
  get overtimeMs() {
    return this.state === 'finished' ? Math.max(0, this._now() - this.endAt) : 0;
  }

  /** ボタンが押されたとき：待機中ならスタート、それ以外ならリセット */
  press() {
    if (this.state === 'ready') this.start();
    else this.reset();
    return this.state;
  }

  start() {
    if (this.state !== 'ready') return;
    this.endAt = this._now() + this.durationMs;
    // スタートした瞬間には鳴らさない（制限時間ぴったりの秒は予告しない）
    this._nextWarn = Math.min(this.warnSec, Math.ceil(this.durationMs / 1000) - 1);
    this._setState('running');
    this._schedule();
  }

  reset() {
    this._cancel();
    if (this.state === 'ready') return;
    this._setState('ready');
  }

  /** 時刻を確認して、予告や時間切れを発生させる（何回呼んでも安全） */
  sync() {
    if (this.state !== 'running') return;
    const rem = this.endAt - this._now();

    if (rem > 0 && this._nextWarn > 0) {
      // 残り N 秒の予告は「表示が N 秒に変わった瞬間（rem が N*1000 を切った瞬間）」
      const n = Math.ceil(rem / 1000);
      if (n <= this._nextWarn) {
        // アプリを離れていたなどで大きく遅れた予告は、まとめて鳴らさず捨てる
        if (n * 1000 - rem < 400) this.onWarn(n);
        this._nextWarn = n - 1;
      }
    }

    if (rem <= 0) {
      this._cancel();
      this._setState('finished');
      this.onFinish(-rem);
    }
  }

  dispose() {
    this._cancel();
    this.onChange = this.onWarn = this.onFinish = () => {};
  }

  _setState(state) {
    this.state = state;
    this.onChange(state);
  }

  /** 次の予告・時間切れの時刻にあわせてタイマーを予約する */
  _schedule() {
    this._cancel();
    if (this.state !== 'running') return;
    let target = this.endAt;
    if (this._nextWarn > 0) target = Math.min(target, this.endAt - this._nextWarn * 1000);
    const delay = Math.max(0, target - this._now());
    this._timerId = this._setTimer(() => {
      this._timerId = null;
      this.sync();
      this._schedule();
    }, delay);
  }

  _cancel() {
    if (this._timerId !== null) {
      this._clearTimer(this._timerId);
      this._timerId = null;
    }
  }
}
