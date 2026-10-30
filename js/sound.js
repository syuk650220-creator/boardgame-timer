'use strict';
/* =========================================================
 * 音の再生
 *  - Web Audio API で音をその場で合成するので、音声ファイルは不要です
 *  - iPhone は「画面をタップした瞬間」でないと音を有効にできないため、
 *    タップのたびに unlock() を呼んでいます（app.js）
 *  - 新しい音を作るときは、下の SOUNDS に1つ追加するだけでOKです
 * ========================================================= */

/** 1回分の音を組み立てる小さなシンセサイザー */
class Synth {
  constructor(ctx, output) {
    this.ctx = ctx;
    this.output = output;
    this.sources = new Set();
  }

  _track(source) {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
  }

  /** 叩く音（ベル・木琴など）。decay 秒ほどで自然に消える */
  strike(t, freq, { type = 'sine', gain = 0.3, attack = 0.002, decay = 0.6, detune = 0 } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (detune) osc.detune.setValueAtTime(detune, t);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + attack);
    amp.gain.setTargetAtTime(0, t + attack, decay / 5);
    osc.connect(amp).connect(this.output);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
    this._track(osc);
  }

  /** 決まった長さだけ鳴る音（電子音・ブザーなど） */
  tone(t, freq, { type = 'sine', gain = 0.3, dur = 0.1, attack = 0.004, release = 0.02, lowpass = 0 } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    let node = osc;
    if (lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lowpass;
      lp.Q.value = 0.7;
      node = node.connect(lp);
    }
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + attack);
    amp.gain.setValueAtTime(gain, t + dur);
    amp.gain.linearRampToValueAtTime(0, t + dur + release);
    node.connect(amp).connect(this.output);
    osc.start(t);
    osc.stop(t + dur + release + 0.02);
    this._track(osc);
  }

  /** 金属を叩いた瞬間の「カッ」というノイズ */
  noise(t, { gain = 0.15, dur = 0.03, freq = 4000, q = 0.8 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = Synth.noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.setTargetAtTime(0, t, dur / 4);
    src.connect(bp).connect(amp).connect(this.output);
    src.start(t);
    src.stop(t + dur * 2 + 0.02);
    this._track(src);
  }

  stopAll() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch (e) {
        // すでに止まっている
      }
    }
    this.sources.clear();
  }

  static noiseBuffer(ctx) {
    if (!Synth._noise || Synth._noise.sampleRate !== ctx.sampleRate) {
      const length = Math.floor(ctx.sampleRate * 0.25);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      Synth._noise = buffer;
    }
    return Synth._noise;
  }
}

/**
 * 音のカタログ
 *  name / desc : メニューに表示する名前と説明
 *  cycle       : 1回分の長さ（秒）。アラーム中はこの間隔でくり返す
 *  level       : 音ごとの音量の補正。スマホのスピーカーで聞いたときの
 *                大きさがそろうように測定して決めた値（音を作り変えたら要調整）
 *  play(s, t)  : 時刻 t から1回分の音を鳴らす
 */
const SOUNDS = {
  digital: {
    name: 'デジタル',
    desc: 'ピピピピッ',
    cycle: 1.0,
    level: 1.78,
    play(s, t) {
      for (let i = 0; i < 4; i++) {
        s.tone(t + i * 0.125, 2093, { type: 'square', gain: 0.16, dur: 0.075, attack: 0.002, release: 0.01, lowpass: 6000 });
      }
    },
  },

  bell: {
    name: 'ベル',
    desc: 'チーン',
    cycle: 1.25,
    level: 1.17,
    play(s, t) {
      const f = 1567.98; // ソ
      s.strike(t, f, { gain: 0.36, decay: 2.4, attack: 0.001 });
      s.strike(t, f * 1.0035, { gain: 0.16, decay: 2.0, attack: 0.001 }); // わずかなうなり
      s.strike(t, f * 2.0, { gain: 0.12, decay: 1.2 });
      s.strike(t, f * 2.76, { gain: 0.14, decay: 0.9 });
      s.strike(t, f * 4.07, { gain: 0.07, decay: 0.5 });
      s.strike(t, f * 5.4, { gain: 0.05, decay: 0.35 });
      s.noise(t, { gain: 0.06, dur: 0.012, freq: 7000 });
    },
  },

  chime: {
    name: 'チャイム',
    desc: 'ピンポーン',
    cycle: 2.0,
    level: 1.35,
    play(s, t) {
      const hit = (time, f, decay) => {
        s.strike(time, f, { gain: 0.42, decay, attack: 0.003 });
        s.strike(time, f * 2, { gain: 0.07, decay: decay * 0.5 });
        s.strike(time, f * 3.93, { gain: 0.05, decay: decay * 0.25 });
      };
      hit(t, 987.77, 1.3);        // ピン（シ）
      hit(t + 0.48, 783.99, 1.9); // ポーン（ソ）
    },
  },

  marimba: {
    name: 'マリンバ',
    desc: 'ポロロン',
    cycle: 1.5,
    level: 1.33,
    play(s, t) {
      [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => {
        const time = t + i * 0.11;
        s.strike(time, f, { gain: 0.42, decay: 0.6, attack: 0.002 });
        s.strike(time, f * 3.99, { gain: 0.06, decay: 0.09, attack: 0.001 });
      });
    },
  },

  buzzer: {
    name: 'ブザー',
    desc: 'ブーッ',
    cycle: 1.3,
    level: 2.37,
    play(s, t) {
      // スマホのスピーカーは低音が出にくいので、倍音を足して聞こえやすくしている
      s.tone(t, 233.08, { type: 'sawtooth', gain: 0.2, dur: 0.8, attack: 0.006, release: 0.04, lowpass: 4500 });
      s.tone(t, 234.7, { type: 'square', gain: 0.1, dur: 0.8, attack: 0.006, release: 0.04, lowpass: 4500 });
      s.tone(t, 466.16, { type: 'sawtooth', gain: 0.06, dur: 0.8, attack: 0.006, release: 0.04, lowpass: 4500 });
    },
  },

  gong: {
    name: 'ゴング',
    desc: 'カンカンカン',
    cycle: 1.5,
    level: 1.64,
    play(s, t) {
      const f = 698.46; // ファ
      for (let i = 0; i < 3; i++) {
        const time = t + i * 0.16;
        s.strike(time, f, { gain: 0.26, decay: 1.0, attack: 0.001 });
        s.strike(time, f * 1.51, { gain: 0.16, decay: 0.8 });
        s.strike(time, f * 2.43, { gain: 0.14, decay: 0.6 });
        s.strike(time, f * 2.95, { gain: 0.1, decay: 0.45 });
        s.strike(time, f * 4.13, { gain: 0.06, decay: 0.3 });
        s.noise(time, { gain: 0.12, dur: 0.02, freq: 3500, q: 0.6 });
      }
    },
  },
};

/** アプリ全体の音を管理する */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.8;
    this.onStateChange = () => {}; // 音が止まった／戻ったときに呼ばれる
    this._alarm = null;
    this._preview = null;
    this._primed = false;
  }

  static get supported() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  static has(id) {
    return Object.prototype.hasOwnProperty.call(SOUNDS, id);
  }

  /** 音を鳴らせる状態か */
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    if (this.master) {
      this.master.gain.setTargetAtTime(this._curve(this.volume), this.ctx.currentTime, 0.015);
    }
  }

  /** iPhone のマナーモード中でも鳴らすか（Audio Session API: iOS 16.4 以降） */
  setIgnoreSilent(on) {
    try {
      if (navigator.audioSession) navigator.audioSession.type = on ? 'playback' : 'auto';
    } catch (e) {
      // 対応していないブラウザでは何もしない
    }
  }

  /** タップなどの操作の中で呼ぶと、音を出せる状態にする */
  unlock() {
    if (!SoundEngine.supported) return;
    try {
      if (!this.ctx) this._setup();
      const ctx = this.ctx;
      this.resume();
      if (!this._primed) {
        // 無音をほんの一瞬鳴らして、iPhone のオーディオを起こしておく
        this._primed = true;
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start();
      }
    } catch (e) {
      // 音が出せなくても、タイマー自体は動かし続ける
      console.warn('音の準備に失敗しました', e);
    }
  }

  /**
   * 電話やアプリの切り替えで止まった音を再開する
   * （iPhone では 'interrupted' という状態になる。タップ以外の時は再開できないこともある）
   */
  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  _setup() {
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      this.ctx = new AC();
    }
    const ctx = this.ctx;
    ctx.onstatechange = () => this.onStateChange(ctx.state);
    // 音割れ防止のリミッター（ふだんは素通しで、大きすぎる瞬間だけ抑える）
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 1;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    this.master = ctx.createGain();
    this.master.gain.value = this._curve(this.volume);
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
  }

  /** 音量スライダーの値を、耳の感じ方に近いカーブに変換する */
  _curve(v) {
    return v * v;
  }

  _bus(level) {
    const bus = this.ctx.createGain();
    bus.gain.value = level;
    bus.connect(this.master);
    return bus;
  }

  /** プツッというノイズが出ないよう、すばやく小さくしてから止める */
  _release(player) {
    clearInterval(player.pump);
    clearTimeout(player.cleanup);
    const t = this.ctx.currentTime;
    player.bus.gain.cancelScheduledValues(t);
    player.bus.gain.setTargetAtTime(0, t, 0.012);
    setTimeout(() => {
      player.synth.stopAll();
      player.bus.disconnect();
    }, 120);
  }

  /**
   * アラームを鳴らす
   * @param {string} id 音の種類
   * @param {number} lengthSec 鳴らす秒数（0 = stopAlarm() まで鳴らし続ける）
   */
  startAlarm(id, lengthSec) {
    this.stopAlarm();
    this.stopPreview();
    if (!this.ctx) return;
    try {
      this.resume();
      this._startAlarm(id, lengthSec);
    } catch (e) {
      console.warn('アラームを鳴らせませんでした', e);
    }
  }

  _startAlarm(id, lengthSec) {
    const ctx = this.ctx;
    const sound = SOUNDS[id] || SOUNDS.digital;
    const bus = this._bus(sound.level);
    const synth = new Synth(ctx, bus);
    const start = ctx.currentTime + 0.02;
    const end = lengthSec > 0 ? start + lengthSec : Infinity;
    const player = { bus, synth, pump: 0, cleanup: 0 };
    let next = start;

    // 少し先の分まで予約しておくことで、処理が混んでも音が途切れない
    const pump = () => {
      while (next < ctx.currentTime + 0.8 && next < end - 0.05) {
        sound.play(synth, next);
        next += sound.cycle;
      }
      if (next >= end - 0.05) clearInterval(player.pump);
    };
    player.pump = setInterval(pump, 200);
    pump();

    if (Number.isFinite(end)) {
      // 決めた長さになったら、余韻を残しつつすっと消す
      bus.gain.setValueAtTime(sound.level, end);
      bus.gain.setTargetAtTime(0, end, 0.08);
      player.cleanup = setTimeout(() => {
        if (this._alarm === player) this._alarm = null;
        clearInterval(player.pump);
        bus.disconnect();
      }, (lengthSec + sound.cycle + 3) * 1000);
    }
    this._alarm = player;
  }

  stopAlarm() {
    const player = this._alarm;
    if (!player) return;
    this._alarm = null;
    this._release(player);
  }

  /** メニューでの試聴（1回分）。鳴る長さ（秒）を返す */
  preview(id) {
    this.stopPreview();
    if (!this.ctx) return 0;
    try {
      const sound = SOUNDS[id] || SOUNDS.digital;
      const bus = this._bus(sound.level);
      const synth = new Synth(this.ctx, bus);
      sound.play(synth, this.ctx.currentTime + 0.02);
      const player = { bus, synth, pump: 0, cleanup: 0 };
      player.cleanup = setTimeout(() => {
        if (this._preview === player) this._preview = null;
        bus.disconnect();
      }, (sound.cycle + 2.5) * 1000);
      this._preview = player;
      return sound.cycle;
    } catch (e) {
      console.warn('試聴できませんでした', e);
      return 0;
    }
  }

  stopPreview() {
    const player = this._preview;
    if (!player) return;
    this._preview = null;
    this._release(player);
  }

  /** 残り時間の予告音「ピッ」。strong = 最後の3秒 */
  tick(strong) {
    if (!this.ctx) return;
    try {
      const bus = this._bus(1);
      const synth = new Synth(this.ctx, bus);
      const t = this.ctx.currentTime + 0.005;
      const f = strong ? 1567.98 : 1174.66;
      const dur = strong ? 0.1 : 0.065;
      synth.tone(t, f, { gain: strong ? 0.62 : 0.52, dur, attack: 0.002, release: 0.03 });
      synth.tone(t, f * 2, { gain: 0.09, dur, attack: 0.002, release: 0.03 });
      setTimeout(() => bus.disconnect(), 500);
    } catch (e) {
      console.warn('予告音を鳴らせませんでした', e);
    }
  }
}
