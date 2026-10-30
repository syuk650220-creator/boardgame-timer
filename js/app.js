'use strict';
/* =========================================================
 * ボドゲタイマー 本体
 *  - メインメニュー：制限時間とお知らせ方法を決める
 *  - タイマー画面　：大きなボタン1つで「スタート」と「リセット」をくり返す
 *    （メニューに戻るまで、同じ制限時間のタイマーとして使い続ける）
 * ========================================================= */

/** 光の色（color は点滅する色、ink はその上の文字色） */
const LIGHT_COLORS = [
  { id: 'red', name: '赤', color: '#ff2a3c', ink: '#ffffff' },
  { id: 'white', name: '白', color: '#ffffff', ink: '#0b0f14' },
  { id: 'yellow', name: '黄', color: '#ffd60a', ink: '#1d1600' },
  { id: 'green', name: '緑', color: '#30e070', ink: '#002611' },
  { id: 'blue', name: '青', color: '#2d7dff', ink: '#ffffff' },
  { id: 'rainbow', name: '虹', color: 'conic-gradient(#ff3b30, #ff9500, #ffd60a, #34c759, #0a84ff, #bf5af2, #ff3b30)', ink: '#ffffff' },
];

const MODE_TEXT = { sound: '音', light: '光', both: '音＋光' };
const RING_LENGTH = 2 * Math.PI * 108; // index.html のリング（r="108"）の円周
const PRESS_GUARD_MS = 280;            // うっかり2回押してしまったときの連打防止
const LONG_PRESS_MS = 550;             // プリセット削除の長押し時間

const hasSound = mode => mode !== 'light';
const hasLight = mode => mode !== 'sound';

const App = {
  settings: null,
  sound: new SoundEngine(),
  screen: 'menu',
  timer: null,
  run: null,          // タイマー画面で使う設定（メニューに戻るまで固定）
  els: {},
  minPicker: null,
  secPicker: null,

  _view: {},          // 画面に表示中の値（同じなら書き換えない）
  _fraction: 1,
  _ringAnim: null,
  _raf: 0,
  _lastPress: 0,
  _flashMode: null,   // 'timeup'（時間切れ） / 'test'（テスト） / null
  _alarmTimer: 0,
  _flashHideTimer: 0,
  _testTimer: 0,
  _previewTimer: 0,
  _audioCheckTimer: 0,
  _saveTimer: 0,
  _toastTimer: 0,
  _sheetResolve: null,
  _suppressChipClick: false,

  init() {
    const s = Settings.load();
    if (!SoundEngine.has(s.soundId)) s.soundId = Settings.DEFAULTS.soundId;
    if (!LIGHT_COLORS.some(c => c.id === s.lightColor)) s.lightColor = Settings.DEFAULTS.lightColor;
    this.settings = s;

    this.sound.setVolume(s.volume);
    this.sound.setIgnoreSilent(s.ignoreSilent);
    this.sound.onStateChange = () => this.updateAudioStatus();
    Haptics.enabled = s.haptics;
    ScreenWake.init(() => this.updateWakeStatus());

    this.collectElements();
    this.buildMenu();
    this.bindMenu();
    this.bindTimerScreen();
    this.bindCommon();
    this.syncMenu();
    this.registerServiceWorker();
  },

  collectElements() {
    const byId = id => document.getElementById(id);
    this.els = {
      menu: byId('screen-menu'),
      timerScreen: byId('screen-timer'),
      presets: byId('presets'),
      soundGrid: byId('sound-grid'),
      volume: byId('volume'),
      swatches: byId('swatches'),
      btnTest: byId('btn-test'),
      btnTestLabel: byId('btn-test-label'),
      btnGo: byId('btn-go'),
      goSummary: byId('go-summary'),
      optSilent: byId('opt-silent'),
      optHaptics: byId('opt-haptics'),
      installTip: byId('install-tip'),
      installTipClose: byId('install-tip-close'),
      btnBack: byId('btn-back'),
      metaDuration: byId('meta-duration'),
      metaModes: byId('meta-modes'),
      wakeNotice: byId('wake-notice'),
      wakeNoticeText: byId('wake-notice-text'),
      wakeNoticeClose: byId('wake-notice-close'),
      audioNotice: byId('audio-notice'),
      dial: byId('dial'),
      ringProgress: byId('ring-progress'),
      ringKnob: byId('ring-knob'),
      dialLabel: byId('dial-label'),
      dialTime: byId('dial-time'),
      dialSub: byId('dial-sub'),
      timerFoot: byId('timer-foot'),
      vignette: byId('vignette'),
      flash: byId('flash'),
      flashTitle: byId('flash-title'),
      flashSub: byId('flash-sub'),
      flashHint: byId('flash-hint'),
      sheet: byId('sheet'),
      sheetTitle: byId('sheet-title'),
      sheetMsg: byId('sheet-msg'),
      sheetOk: byId('sheet-ok'),
      sheetCancel: byId('sheet-cancel'),
      toast: byId('toast'),
      srLive: byId('sr-live'),
    };
  },

  /* =======================================================
   * メインメニュー
   * ======================================================= */

  buildMenu() {
    const s = this.settings;
    this.minPicker = new WheelPicker(document.getElementById('wheel-min'), {
      min: 0, max: 99, value: Math.floor(s.durationSec / 60), label: '分',
      onChange: () => this.onDurationPicked(),
    });
    this.secPicker = new WheelPicker(document.getElementById('wheel-sec'), {
      min: 0, max: 59, value: s.durationSec % 60, label: '秒',
      onChange: () => this.onDurationPicked(),
    });

    for (const [id, sound] of Object.entries(SOUNDS)) {
      const label = document.createElement('label');
      label.className = 'sound-opt';
      label.dataset.sound = id;
      label.innerHTML =
        `<input type="radio" name="soundId" value="${id}">` +
        '<span class="sound-card">' +
        `<span class="sound-name">${sound.name}</span>` +
        `<span class="sound-desc">${sound.desc}</span>` +
        '<span class="sound-eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '</span>';
      this.els.soundGrid.append(label);
    }

    for (const c of LIGHT_COLORS) {
      const label = document.createElement('label');
      label.className = 'swatch';
      label.innerHTML =
        `<input type="radio" name="lightColor" value="${c.id}">` +
        '<span class="swatch-dot"></span>' +
        `<span class="swatch-name">${c.name}</span>`;
      label.querySelector('.swatch-dot').style.setProperty('--sw', c.color);
      this.els.swatches.append(label);
    }

    this.els.ringProgress.style.strokeDasharray = RING_LENGTH.toFixed(2);
    this.renderPresets();
  },

  bindMenu() {
    const els = this.els;

    // ラジオボタン（お知らせ方法・音・光の色・長さ・予告）
    els.menu.addEventListener('change', e => {
      const input = e.target;
      switch (input.name) {
        case 'alertMode': this.update({ alertMode: input.value }); break;
        case 'soundId': this.update({ soundId: input.value }); break;
        case 'lightColor': this.update({ lightColor: input.value }); this.pulse(input.nextElementSibling); break;
        case 'alertLength': this.update({ alertLength: Number(input.value) }); break;
        case 'warnSec': this.update({ warnSec: Number(input.value) }); break;
      }
    });

    // 音はタップするたびに試聴（選択中の音をもう一度押しても鳴る）
    els.soundGrid.addEventListener('click', e => {
      const input = e.target.closest('input[name="soundId"]');
      if (input) this.previewSound(input.value);
    });

    els.volume.addEventListener('input', () => {
      const volume = Number(els.volume.value) / 100;
      this.sound.setVolume(volume);
      this.paintVolume();
      this.update({ volume }, { render: false });
    });
    els.volume.addEventListener('change', () => this.previewSound(this.settings.soundId));

    els.optSilent.addEventListener('change', () => {
      this.sound.setIgnoreSilent(els.optSilent.checked);
      this.update({ ignoreSilent: els.optSilent.checked }, { render: false });
    });
    els.optHaptics.addEventListener('change', () => {
      Haptics.enabled = els.optHaptics.checked;
      this.update({ haptics: els.optHaptics.checked }, { render: false });
      Haptics.tap();
    });

    els.btnTest.addEventListener('click', () => (this._testTimer ? this.stopTest() : this.startTest()));
    els.btnGo.addEventListener('click', () => this.enterTimer());
    els.installTipClose.addEventListener('click', () => {
      els.installTip.hidden = true;
      this.update({ installTipClosed: true }, { render: false });
    });

    this.bindPresets();
  },

  /** プリセット：タップで選択、長押しで削除 */
  bindPresets() {
    const wrap = this.els.presets;
    let press = null;

    const cancel = () => {
      if (!press) return;
      clearTimeout(press.timer);
      clearTimeout(press.hint);
      press.chip.classList.remove('is-pressing');
      press = null;
    };

    wrap.addEventListener('pointerdown', e => {
      this._suppressChipClick = false;
      const chip = e.target.closest('.chip[data-sec]');
      if (!chip) return;
      cancel();
      const sec = Number(chip.dataset.sec);
      press = {
        chip,
        x: e.clientX,
        y: e.clientY,
        // 押し続けていると赤くなり「離すと削除」を予告する
        hint: setTimeout(() => chip.classList.add('is-pressing'), 160),
        timer: setTimeout(() => {
          cancel();
          this._suppressChipClick = true;
          this.askDeletePreset(sec);
        }, LONG_PRESS_MS),
      };
    });
    wrap.addEventListener('pointermove', e => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancel();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      wrap.addEventListener(type, cancel);
    }
    wrap.addEventListener('contextmenu', e => e.preventDefault());

    wrap.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      if (this._suppressChipClick) {
        this._suppressChipClick = false;
        return;
      }
      if (chip.dataset.action === 'add') this.addPreset();
      else this.setDuration(Number(chip.dataset.sec), { smooth: true });
    });
  },

  /** 設定を変更して保存する */
  update(patch, { render = true } = {}) {
    Object.assign(this.settings, patch);
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => Settings.save(this.settings), 150);
    if (render) this.syncMenu();
  },

  flushSave() {
    clearTimeout(this._saveTimer);
    Settings.save(this.settings);
  },

  /** 設定の内容をメニューの見た目に反映する */
  syncMenu() {
    const s = this.settings;
    const els = this.els;
    const check = (name, value) => {
      const input = els.menu.querySelector(`input[name="${name}"][value="${value}"]`);
      if (input) input.checked = true;
    };
    check('alertMode', s.alertMode);
    check('soundId', s.soundId);
    check('lightColor', s.lightColor);
    check('alertLength', s.alertLength);
    check('warnSec', s.warnSec);

    for (const el of $$('[data-requires="sound"]', els.menu)) el.hidden = !hasSound(s.alertMode);
    for (const el of $$('[data-requires="light"]', els.menu)) el.hidden = !hasLight(s.alertMode);

    els.optSilent.checked = s.ignoreSilent;
    els.optHaptics.checked = s.haptics;
    els.volume.value = String(Math.round(s.volume * 100));
    this.paintVolume();
    els.installTip.hidden = s.installTipClosed || !isIOS() || isStandalone();
    this.syncDuration();
  },

  paintVolume() {
    this.els.volume.style.setProperty('--fill', this.els.volume.value + '%');
  },

  pickedSeconds() {
    return this.minPicker.value * 60 + this.secPicker.value;
  },

  onDurationPicked() {
    const sec = this.pickedSeconds();
    if (sec > 0) this.update({ durationSec: sec }, { render: false });
    this.syncDuration();
  },

  setDuration(sec, { smooth = false } = {}) {
    this.minPicker.setValue(Math.floor(sec / 60), { smooth, silent: true });
    this.secPicker.setValue(sec % 60, { smooth, silent: true });
    this.onDurationPicked();
  },

  syncDuration() {
    const sec = this.pickedSeconds();
    for (const chip of $$('.chip[data-sec]', this.els.presets)) {
      chip.classList.toggle('is-current', Number(chip.dataset.sec) === sec);
    }
    const ok = sec > 0;
    this.els.btnGo.classList.toggle('is-disabled', !ok);
    this.els.goSummary.textContent = ok
      ? `${formatJa(sec)} ・ ${MODE_TEXT[this.settings.alertMode]}でお知らせ`
      : '時間を設定してください';
  },

  renderPresets() {
    const wrap = this.els.presets;
    wrap.textContent = '';
    for (const sec of this.settings.presets) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.sec = String(sec);
      chip.textContent = formatJa(sec);
      wrap.append(chip);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'chip chip-add';
    add.dataset.action = 'add';
    add.setAttribute('aria-label', '今の時間をプリセットに追加');
    add.innerHTML = '<svg class="icon"><use href="#i-plus"/></svg><span>追加</span>';
    wrap.append(add);
    this.syncDuration();
  },

  addPreset() {
    const sec = this.pickedSeconds();
    const list = this.settings.presets;
    if (sec <= 0) return this.toast('先に時間を設定してください');
    if (list.includes(sec)) return this.toast(`${formatJa(sec)} は登録済みです`);
    if (list.length >= Settings.MAX_PRESETS) return this.toast(`登録できるのは${Settings.MAX_PRESETS}個までです`);
    this.update({ presets: Settings.sanitizePresets([...list, sec]) }, { render: false });
    this.renderPresets();
    this.toast(`${formatJa(sec)} を登録しました`);
  },

  async askDeletePreset(sec) {
    const ok = await this.confirm({
      title: 'プリセットを削除',
      message: `「${formatJa(sec)}」を一覧から削除しますか？`,
      ok: '削除',
      danger: true,
    });
    if (!ok) return;
    this.update({ presets: this.settings.presets.filter(v => v !== sec) }, { render: false });
    this.renderPresets();
    this.toast(`${formatJa(sec)} を削除しました`);
  },

  previewSound(id) {
    this.stopTest();
    this.sound.unlock();
    const seconds = this.sound.preview(id);
    clearTimeout(this._previewTimer);
    for (const el of $$('.sound-opt', this.els.soundGrid)) {
      el.classList.toggle('is-playing', el.dataset.sound === id);
    }
    this._previewTimer = setTimeout(() => {
      for (const el of $$('.sound-opt.is-playing', this.els.soundGrid)) el.classList.remove('is-playing');
    }, Math.max(700, seconds * 1000));
  },

  /** 「お知らせをテスト」：今の設定で数秒だけ鳴らす・光らせる */
  startTest() {
    const s = this.settings;
    this.stopTest();
    this.sound.unlock();
    const seconds = s.alertLength > 0 ? Math.min(s.alertLength, 3) : 3;
    if (hasSound(s.alertMode)) this.sound.startAlarm(s.soundId, seconds);
    if (hasLight(s.alertMode)) this.showFlash(s.lightColor, 'test');
    this.els.btnTest.classList.add('is-active');
    this.els.btnTestLabel.textContent = 'テストを止める';
    this._testTimer = setTimeout(() => this.stopTest(), seconds * 1000);
  },

  stopTest() {
    if (!this._testTimer) return;
    clearTimeout(this._testTimer);
    this._testTimer = 0;
    this.sound.stopAlarm();
    if (this._flashMode === 'test') this.hideFlash();
    this.els.btnTest.classList.remove('is-active');
    this.els.btnTestLabel.textContent = 'お知らせをテスト';
  },

  /* =======================================================
   * タイマー画面
   * ======================================================= */

  enterTimer() {
    const sec = this.pickedSeconds();
    if (sec <= 0) {
      this.toast('制限時間を設定してください');
      return;
    }
    this.stopTest();
    this.sound.stopPreview();
    this.sound.unlock();
    this.update({ durationSec: sec }, { render: false });
    this.flushSave();

    const s = this.settings;
    this.run = {
      durationSec: sec,
      alertMode: s.alertMode,
      soundId: s.soundId,
      lightColor: s.lightColor,
      alertLength: s.alertLength,
      warnSec: s.warnSec,
    };
    this.timer = new CountdownTimer({
      durationMs: sec * 1000,
      warnSec: s.warnSec,
      onChange: state => this.onTimerChange(state),
      onWarn: secLeft => this.onWarn(secLeft),
      onFinish: () => this.onFinish(),
    });

    this._view = {};
    this._fraction = 1;
    this._ringAnim = null;
    this.els.metaDuration.textContent = formatClock(sec);
    this.renderModeIcons();
    this.showScreen('timer');
    this.onTimerChange('ready', { silent: true });
    ScreenWake.enable();
    this.updateWakeStatus();
  },

  async leaveTimer() {
    if (!this.timer) return;
    if (this.timer.state !== 'ready') {
      const ok = await this.confirm({
        title: 'メニューに戻りますか？',
        message: '動いているタイマーはリセットされます。',
        ok: 'メニューへ',
      });
      if (!ok || !this.timer) return;
    }
    this.stopAlarm();
    this.stopLoop();
    this.timer.dispose();
    this.timer = null;
    this.run = null;
    this._ringAnim = null;
    ScreenWake.disable();
    this.showScreen('menu');
    this.updateWakeStatus();
    this.updateAudioStatus();
  },

  showScreen(name) {
    this.screen = name;
    this.els.menu.classList.toggle('is-active', name === 'menu');
    this.els.timerScreen.classList.toggle('is-active', name === 'timer');
    if (name === 'menu') {
      this.minPicker.refresh();
      this.secPicker.refresh();
    }
  },

  bindTimerScreen() {
    const els = this.els;
    els.dial.addEventListener('click', () => this.pressDial());
    els.btnBack.addEventListener('click', () => this.leaveTimer());
    els.flash.addEventListener('click', () => {
      if (this._flashMode === 'test') this.stopTest();
      else if (this._flashMode === 'timeup') this.pressDial();
    });
    els.wakeNoticeClose.addEventListener('click', () => {
      els.wakeNotice.hidden = true;
      this.update({ wakeNoticeClosed: true }, { render: false });
    });
    // 止まった音をタップで戻す（タイマーには触らない）
    els.audioNotice.addEventListener('click', () => {
      Haptics.tap();
      this.sound.unlock();
      this.updateAudioStatus();
    });
  },

  /** 大きなボタンが押された：待機中ならスタート、動作中・時間切れならリセット */
  pressDial() {
    if (!this.timer || !this.els.sheet.hidden) return;
    const now = performance.now();
    if (now - this._lastPress < PRESS_GUARD_MS) return;
    this._lastPress = now;
    this.sound.unlock();
    Haptics.tap();
    ScreenWake.enable();
    this.timer.press();
  },

  onTimerChange(state, { silent = false } = {}) {
    const els = this.els;
    els.timerScreen.dataset.state = state;

    if (state === 'ready') {
      this.stopAlarm();
      els.timerScreen.dataset.level = '';
      this._view.level = '';
      els.dialLabel.textContent = 'READY';
      this.setDialSub('i-play', 'タップでスタート');
      els.timerFoot.textContent = `押すと ${formatJa(this.run.durationSec)} のカウントダウンが始まります`;
      els.dial.setAttribute('aria-label', 'スタート');
      this.animateRing(1);
      if (!silent) this.announce('リセットしました');
    } else if (state === 'running') {
      this._ringAnim = null;
      els.dialLabel.textContent = '残り';
      this.setDialSub('i-reset', 'タップでリセット');
      els.timerFoot.textContent = '時間内にもう一度押すとリセットされます';
      els.dial.setAttribute('aria-label', 'リセット');
      this.announce('スタート');
    } else {
      els.dialLabel.textContent = 'TIME UP';
      els.timerFoot.textContent = '押すとリセットされます';
      els.dial.setAttribute('aria-label', 'リセット');
      this.announce('時間切れです');
    }
    this.renderTimer();
    this.startLoop();
    this.updateAudioStatus();
  },

  onWarn(secLeft) {
    const run = this.run;
    if (hasSound(run.alertMode)) this.sound.tick(secLeft <= 3);
    if (hasLight(run.alertMode) && this.els.vignette.animate) {
      this.els.vignette.animate(
        [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }],
        { duration: 700, easing: 'ease-out' }
      );
    }
    if (this.els.dialTime.animate) {
      this.els.dialTime.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.07)', offset: 0.3 }, { transform: 'scale(1)' }],
        { duration: 380, easing: 'ease-out' }
      );
    }
  },

  onFinish() {
    const run = this.run;
    clearTimeout(this._alarmTimer);
    // 音が止まっていて鳴らせないときは、「音」だけの設定でも光で知らせる
    const soundBlocked = hasSound(run.alertMode) && !this.sound.ready;
    if (hasSound(run.alertMode)) this.sound.startAlarm(run.soundId, run.alertLength);
    if (hasLight(run.alertMode) || soundBlocked) this.showFlash(run.lightColor, 'timeup');
    if (run.alertLength > 0) {
      this._alarmTimer = setTimeout(() => {
        if (this._flashMode === 'timeup') this.hideFlash();
      }, run.alertLength * 1000);
    }
  },

  stopAlarm() {
    clearTimeout(this._alarmTimer);
    this.sound.stopAlarm();
    if (this._flashMode === 'timeup') this.hideFlash();
  },

  /* ---------- 描画 ---------- */

  startLoop() {
    if (this._raf) return;
    const step = () => {
      this._raf = 0;
      if (!this.timer) return;
      this.renderTimer();
      if (this.timer && (this.timer.state !== 'ready' || this._ringAnim)) {
        this._raf = requestAnimationFrame(step);
      }
    };
    this._raf = requestAnimationFrame(step);
  },

  stopLoop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  },

  renderTimer() {
    const t = this.timer;
    if (!t) return;
    t.sync(); // ここで時間切れになると onTimerChange が先に呼ばれる
    if (!this.timer) return;

    const run = this.run;
    let fraction;
    let clock;

    if (t.state === 'running') {
      const rem = t.remainingMs;
      const secLeft = Math.ceil(rem / 1000);
      fraction = rem / t.durationMs;
      clock = formatClock(secLeft);
      const dangerSec = Math.max(run.warnSec, Math.min(10, Math.ceil(run.durationSec * 0.1)));
      const level = secLeft <= dangerSec ? 'danger' : fraction <= 0.3 ? 'caution' : '';
      this.setView('level', level, v => { this.els.timerScreen.dataset.level = v; });
    } else if (t.state === 'ready') {
      fraction = this._ringAnim ? this.ringAnimValue() : 1;
      clock = formatClock(run.durationSec);
    } else {
      fraction = 0;
      clock = formatClock(0);
      const over = Math.floor(t.overtimeMs / 1000);
      this.setDialSub('i-reset', `+${formatClock(over)} ・ タップでリセット`);
    }

    this.setRing(fraction);
    this.setView('clock', clock, v => {
      this.els.dialTime.textContent = v;
      this.els.dialTime.classList.toggle('is-long', v.length > 4);
    });
  },

  setView(key, value, apply) {
    if (this._view[key] === value) return;
    this._view[key] = value;
    apply(value);
  },

  setDialSub(icon, text) {
    this.setView('sub', icon + '|' + text, () => {
      this.els.dialSub.innerHTML = `<svg class="icon"><use href="#${icon}"/></svg><span></span>`;
      this.els.dialSub.lastChild.textContent = text;
    });
  },

  setRing(fraction) {
    const f = clamp(fraction, 0, 1);
    this._fraction = f;
    const ring = this.els.ringProgress;
    ring.style.strokeDashoffset = (RING_LENGTH * (1 - f)).toFixed(2);
    ring.style.opacity = f < 0.002 ? '0' : '1';
    this.els.ringKnob.setAttribute('transform', `rotate(${(f * 360).toFixed(2)} 120 120)`);
  },

  /** リセットしたとき、リングがすっと満タンに戻るアニメーション */
  animateRing(to) {
    if (Math.abs(this._fraction - to) < 0.001) {
      this._ringAnim = null;
      return;
    }
    this._ringAnim = { from: this._fraction, to, start: performance.now(), duration: 480 };
  },

  ringAnimValue() {
    const a = this._ringAnim;
    const p = clamp((performance.now() - a.start) / a.duration, 0, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    if (p >= 1) this._ringAnim = null;
    return a.from + (a.to - a.from) * eased;
  },

  renderModeIcons() {
    const run = this.run;
    const icon = (id, extra, title) =>
      `<span class="mode-icon ${extra}" title="${title}" aria-label="${title}"><svg class="icon"><use href="#${id}"/></svg></span>`;
    let html = '';
    if (hasSound(run.alertMode)) html += icon('i-sound', '', '音でお知らせ');
    if (hasLight(run.alertMode)) html += icon('i-light', '', '光でお知らせ');
    if (ScreenWake.supported) html += icon('i-sun', 'mode-wake', '画面スリープ防止');
    this.els.metaModes.innerHTML = html;
  },

  /** 画面スリープ防止の状態を表示する */
  updateWakeStatus() {
    const els = this.els;
    if (!els.metaModes) return;
    const wake = els.metaModes.querySelector('.mode-wake');
    if (wake) wake.classList.toggle('is-on', ScreenWake.active);

    let text = '';
    if (this.screen === 'timer' && !this.settings.wakeNoticeClosed) {
      if (!ScreenWake.supported) {
        text = 'この開き方では画面の自動ロックを止められません。ゲーム中は［設定］→［画面表示と明るさ］→［自動ロック］を「なし」にしてください。';
      } else if (ScreenWake.failed) {
        text = '画面の自動ロックを止められませんでした（低電力モード中など）。画面が消えるとタイマーも止まるのでご注意ください。';
      }
    }
    els.wakeNoticeText.textContent = text;
    els.wakeNotice.hidden = !text;
  },

  /**
   * カウントダウン中に音が止まっていないか確かめ、止まっていたら「タップで戻す」案内を出す
   * （iPhone はアプリを切り替えたり電話が来たりすると、音を止めたままにすることがある）
   */
  updateAudioStatus() {
    const notice = this.els.audioNotice;
    if (!notice) return;
    clearTimeout(this._audioCheckTimer);
    const stalled = () =>
      this.screen === 'timer' && !!this.timer && this.timer.state === 'running' &&
      hasSound(this.run.alertMode) && SoundEngine.supported && !this.sound.ready;
    if (!stalled()) {
      notice.hidden = true;
      return;
    }
    // 再開の途中で一瞬だけ出るのを防ぐため、少し待っても戻らないときだけ表示する
    this._audioCheckTimer = setTimeout(() => {
      notice.hidden = !stalled();
    }, 900);
  },

  /* ---------- 光（画面全体の点滅） ---------- */

  showFlash(colorId, mode) {
    const f = this.els.flash;
    const color = LIGHT_COLORS.find(c => c.id === colorId) || LIGHT_COLORS[0];
    const isTest = mode === 'test';
    f.dataset.color = color.id;
    f.style.setProperty('--on', color.id === 'rainbow' ? '#ff3b30' : color.color);
    f.style.setProperty('--on-ink', color.ink);
    this.els.flashTitle.textContent = isTest ? 'TEST' : 'TIME UP';
    this.els.flashSub.textContent = isTest ? 'お知らせのテスト' : '時間切れ';
    this.els.flashHint.textContent = isTest ? 'タップで止める' : 'タップでリセット';
    clearTimeout(this._flashHideTimer);
    f.classList.remove('is-leaving');
    f.hidden = false;
    // 点滅を最初の「光る」から始める
    f.style.animation = 'none';
    void f.offsetWidth;
    f.style.animation = '';
    this._flashMode = mode;
  },

  hideFlash() {
    const f = this.els.flash;
    this._flashMode = null;
    if (f.hidden) return;
    f.classList.add('is-leaving');
    clearTimeout(this._flashHideTimer);
    this._flashHideTimer = setTimeout(() => {
      f.hidden = true;
      f.classList.remove('is-leaving');
    }, 320);
  },

  /* =======================================================
   * 共通
   * ======================================================= */

  bindCommon() {
    const els = this.els;

    // iPhone はタップの瞬間にしか音を有効にできないので、操作のたびに準備しておく
    const unlock = () => this.sound.unlock();
    document.addEventListener('touchend', unlock, { capture: true, passive: true });
    document.addEventListener('click', unlock, { capture: true });

    // ピンチやダブルタップでの拡大を防ぐ（iOS Safari）
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('dblclick', e => e.preventDefault());

    document.addEventListener('keydown', e => this.onKeyDown(e));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flushSave();
      } else if (this.timer) {
        // 戻ってきたら、離れていた間の時間を反映し、止まった音の再開も試みる
        this.sound.resume();
        this.renderTimer();
        this.startLoop();
        this.updateAudioStatus();
      }
    });
    window.addEventListener('pagehide', () => this.flushSave());

    els.sheetOk.addEventListener('click', () => this.closeSheet(true));
    els.sheetCancel.addEventListener('click', () => this.closeSheet(false));
    els.sheet.addEventListener('click', e => {
      if (e.target === els.sheet) this.closeSheet(false);
    });
  },

  onKeyDown(e) {
    if (!this.els.sheet.hidden) {
      if (e.key === 'Escape') this.closeSheet(false);
      return;
    }
    if (this.screen !== 'timer') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.leaveTimer();
    } else if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('button, input, [tabindex]')) {
      // PC で試すとき用：スペースキーでもボタンを押せる
      e.preventDefault();
      this.pressDial();
    }
  },

  /** 確認ダイアログ。OK なら true を返す */
  confirm({ title, message = '', ok = 'OK', cancel = 'キャンセル', danger = false }) {
    const els = this.els;
    this.closeSheet(false);
    els.sheetTitle.textContent = title;
    els.sheetMsg.textContent = message;
    els.sheetMsg.hidden = !message;
    els.sheetOk.textContent = ok;
    els.sheetCancel.textContent = cancel;
    els.sheetOk.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    els.sheet.hidden = false;
    return new Promise(resolve => {
      this._sheetResolve = resolve;
    });
  },

  closeSheet(result) {
    const resolve = this._sheetResolve;
    if (!resolve) return;
    this._sheetResolve = null;
    this.els.sheet.hidden = true;
    resolve(result);
  },

  toast(message) {
    const t = this.els.toast;
    t.textContent = message;
    t.classList.add('is-show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('is-show'), 2200);
  },

  announce(text) {
    this.els.srLive.textContent = text;
  },

  pulse(el) {
    if (el && el.animate) {
      el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 300, easing: 'ease-out' }
      );
    }
  },

  /** https で公開したときだけ、オフラインでも開けるようにする */
  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker の登録に失敗しました', err));
    });
  },
};

App.init();
