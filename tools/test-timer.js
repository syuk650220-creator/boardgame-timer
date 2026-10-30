'use strict';
/* =========================================================
 * タイマーの動作テスト
 *  実行: npm test（または node tools/test-timer.js）
 *  - 時計を自由に進められる「にせの時計」を使って、
 *    スタート・リセット・予告・時間切れの動きを確かめます
 * ========================================================= */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ブラウザ用のファイルをそのまま読み込む
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'timer.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(code + '\nthis.CountdownTimer = CountdownTimer;', context);
const { CountdownTimer } = context;

/** 好きなだけ進められる時計 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: id => timers.delete(id),
    /** ms ミリ秒進める（途中で予約されたタイマーも順番に実行） */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (!next || t.at < next.t.at)) next = { id, t };
        }
        if (!next) break;
        timers.delete(next.id);
        now = next.t.at;
        next.t.fn();
      }
      now = target;
    },
    /** タイマーを動かさずに時計だけ進める（アプリを離れていた状況） */
    jump(ms) {
      now += ms;
    },
    get pending() {
      return timers.size;
    },
  };
}

function setup({ seconds, warnSec = 0 }) {
  const clock = fakeClock();
  const events = [];
  const timer = new CountdownTimer({
    durationMs: seconds * 1000,
    warnSec,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onChange: state => events.push(`state:${state}`),
    onWarn: n => events.push(`warn:${n}@${clock.now()}`),
    onFinish: late => events.push(`finish@${clock.now()}+${late}`),
  });
  return { clock, events, timer };
}

test('押すとスタートし、制限時間ちょうどで時間切れになる', () => {
  const { clock, events, timer } = setup({ seconds: 10 });
  assert.equal(timer.state, 'ready');
  assert.equal(timer.remainingMs, 10000);

  assert.equal(timer.press(), 'running');
  clock.advance(9999);
  assert.equal(timer.state, 'running');
  assert.equal(timer.remainingMs, 1);

  clock.advance(1);
  assert.equal(timer.state, 'finished');
  assert.equal(timer.remainingMs, 0);
  assert.deepEqual(events, ['state:running', 'state:finished', 'finish@10000+0']);
});

test('時間内に押すとリセットされ、もう一度押すと同じ時間で再スタートする', () => {
  const { clock, events, timer } = setup({ seconds: 30 });
  timer.press();
  clock.advance(12000);
  assert.equal(timer.remainingMs, 18000);

  assert.equal(timer.press(), 'ready');
  assert.equal(timer.remainingMs, 30000, 'リセットすると満タンに戻る');
  assert.equal(clock.pending, 0, 'リセット後に予約が残らない');

  clock.advance(60000);
  assert.equal(timer.state, 'ready', '待機中は時間が進まない');

  assert.equal(timer.press(), 'running');
  clock.advance(29999);
  assert.equal(timer.state, 'running', '再スタート後は満タンから数える');
  clock.advance(1);
  assert.equal(timer.state, 'finished');
  assert.deepEqual(events, ['state:running', 'state:ready', 'state:running', 'state:finished', 'finish@102000+0']);
});

test('時間切れのあとに押すとリセットされ、超過時間が数えられている', () => {
  const { clock, timer } = setup({ seconds: 5 });
  timer.press();
  clock.advance(5000);
  clock.advance(7300);
  assert.equal(timer.state, 'finished');
  assert.equal(timer.overtimeMs, 7300);

  assert.equal(timer.press(), 'ready');
  assert.equal(timer.overtimeMs, 0);
  assert.equal(timer.remainingMs, 5000);
});

test('残り時間の予告は残り N 秒になった瞬間に1回ずつ鳴る', () => {
  const { clock, events, timer } = setup({ seconds: 10, warnSec: 3 });
  timer.press();
  clock.advance(10000);
  assert.deepEqual(events, [
    'state:running',
    'warn:3@7000',
    'warn:2@8000',
    'warn:1@9000',
    'state:finished',
    'finish@10000+0',
  ]);
});

test('制限時間が予告より短いとき、スタートの瞬間には予告しない', () => {
  const { clock, events, timer } = setup({ seconds: 3, warnSec: 10 });
  timer.press();
  clock.advance(3000);
  assert.deepEqual(events, ['state:running', 'warn:2@1000', 'warn:1@2000', 'state:finished', 'finish@3000+0']);
});

test('予告の途中でリセットすると、次のスタートでまた最初から予告する', () => {
  const { clock, events, timer } = setup({ seconds: 5, warnSec: 3 });
  timer.press();
  clock.advance(3500); // warn:3 と warn:2 が鳴った直後
  timer.press();
  events.length = 0;
  timer.press();
  clock.advance(5000);
  assert.deepEqual(events, ['state:running', 'warn:3@5500', 'warn:2@6500', 'warn:1@7500', 'state:finished', 'finish@8500+0']);
});

test('アプリを離れていて遅れた予告はまとめて鳴らさず、戻ったときに時間切れにする', () => {
  const { clock, events, timer } = setup({ seconds: 10, warnSec: 5 });
  timer.press();
  clock.jump(12000); // 画面を消していた間はタイマーが動かない想定
  timer.sync();
  assert.equal(timer.state, 'finished');
  assert.deepEqual(events, ['state:running', 'state:finished', 'finish@12000+2000']);
});

test('少しだけ遅れた予告は鳴らす（処理が混んでいたとき）', () => {
  const { clock, events, timer } = setup({ seconds: 10, warnSec: 3 });
  timer.press();
  clock.jump(7150);
  timer.sync();
  assert.deepEqual(events, ['state:running', 'warn:3@7150']);
});

test('sync を何度呼んでも、予告や時間切れが重複しない', () => {
  const { clock, events, timer } = setup({ seconds: 4, warnSec: 2 });
  timer.press();
  for (let i = 0; i < 400; i++) {
    clock.advance(16); // 画面の書き換え（約60fps）のたびに sync する
    timer.sync();
  }
  assert.deepEqual(events, ['state:running', 'warn:2@2000', 'warn:1@3000', 'state:finished', 'finish@4000+0']);
});

test('dispose 後は予約もコールバックも残らない', () => {
  const { clock, events, timer } = setup({ seconds: 2 });
  timer.press();
  timer.dispose();
  clock.advance(5000);
  assert.deepEqual(events, ['state:running']);
});
