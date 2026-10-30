'use strict';
/* =========================================================
 * iPhone 風のドラムロール式ピッカー
 *  - スクロールスナップで実装しているので、指で弾くと慣性で回ります
 *  - 数字をタップしたり、キーボードの ↑↓ でも選べます
 * ========================================================= */

class WheelPicker {
  /**
   * @param {HTMLElement} el 入れ物（.wheel）
   * @param {object} options
   * @param {number} options.min
   * @param {number} options.max
   * @param {number} options.value
   * @param {string} options.label 読み上げ用（「分」など）
   * @param {(value: number) => void} options.onChange
   */
  constructor(el, { min, max, value, label = '', onChange = () => {} }) {
    this.el = el;
    this.min = min;
    this.max = max;
    this.label = label;
    this.onChange = onChange;
    this.value = clamp(value, min, max);
    this.items = [];
    this._styled = new Set();
    this._raf = 0;
    this._settleTimer = 0;
    this._anim = null; // プログラムで回している最中のアニメーション

    this._build();
    this._bind();
    this.setValue(this.value, { silent: true });
  }

  get rowHeight() {
    return (this.items[0] && this.items[0].offsetHeight) || 46;
  }

  /**
   * 値を変える
   * @param {number} value
   * @param {{ smooth?: boolean, silent?: boolean }} [options] smooth: くるっと回す / silent: onChange を呼ばない
   */
  setValue(value, { smooth = false, silent = false } = {}) {
    const v = clamp(Math.round(value), this.min, this.max);
    const top = (v - this.min) * this.rowHeight;
    const changed = v !== this.value;
    this.value = v;
    this._updateAria();
    this._stopAnimation(false);
    if (smooth && Math.abs(this.el.scrollTop - top) > 1) {
      this._animateTo(top);
    } else {
      this.el.scrollTop = top;
      this._render();
    }
    if (changed && !silent) this.onChange(v);
  }

  /** 見た目を作り直す（画面サイズが変わったときなど） */
  refresh() {
    this.setValue(this.value, { silent: true });
  }

  _build() {
    const el = this.el;
    el.tabIndex = 0;
    el.setAttribute('role', 'spinbutton');
    el.setAttribute('aria-label', this.label);
    el.setAttribute('aria-valuemin', String(this.min));
    el.setAttribute('aria-valuemax', String(this.max));

    const frag = document.createDocumentFragment();
    const padTop = document.createElement('div');
    padTop.className = 'wheel-pad';
    frag.append(padTop);
    for (let v = this.min; v <= this.max; v++) {
      const item = document.createElement('div');
      item.className = 'wheel-item';
      item.textContent = String(v);
      item.dataset.value = String(v);
      frag.append(item);
      this.items.push(item);
    }
    const padBottom = document.createElement('div');
    padBottom.className = 'wheel-pad';
    frag.append(padBottom);
    el.append(frag);
  }

  _bind() {
    const el = this.el;
    el.addEventListener('scroll', () => this._onScroll(), { passive: true });

    // 指やマウスで触ったら、自動で回している途中でも止めて操作を優先する
    const takeOver = () => this._stopAnimation(false);
    el.addEventListener('touchstart', takeOver, { passive: true });
    el.addEventListener('wheel', takeOver, { passive: true });
    el.addEventListener('pointerdown', takeOver);

    el.addEventListener('click', e => {
      const item = e.target.closest('.wheel-item');
      if (item) this.setValue(Number(item.dataset.value), { smooth: true });
    });

    el.addEventListener('keydown', e => {
      const steps = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
      if (e.key in steps) {
        e.preventDefault();
        this.setValue(this.value + steps[e.key], { smooth: true });
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        this.setValue(e.key === 'Home' ? this.min : this.max, { smooth: true });
      }
    });

    window.addEventListener('resize', () => this.refresh());
  }

  /** 目標の位置まで、なめらかに回す（途中はスナップを切っておく） */
  _animateTo(top) {
    const el = this.el;
    const from = el.scrollTop;
    const distance = top - from;
    const duration = clamp(220 + Math.sqrt(Math.abs(distance)) * 6, 240, 460);
    const start = performance.now();
    el.style.scrollSnapType = 'none';
    const anim = { top, raf: 0, fallback: 0 };
    const step = now => {
      if (this._anim !== anim) return;
      const p = clamp((now - start) / duration, 0, 1);
      el.scrollTop = from + distance * (1 - Math.pow(1 - p, 3));
      if (p < 1) anim.raf = requestAnimationFrame(step);
      else this._stopAnimation(true);
    };
    anim.raf = requestAnimationFrame(step);
    // 画面が描画されない状況でも、最後は必ず目標の位置にそろえる
    anim.fallback = setTimeout(() => this._stopAnimation(true), duration + 300);
    this._anim = anim;
  }

  _stopAnimation(complete) {
    const anim = this._anim;
    if (!anim) return;
    this._anim = null;
    cancelAnimationFrame(anim.raf);
    clearTimeout(anim.fallback);
    if (complete) this.el.scrollTop = anim.top;
    this.el.style.scrollSnapType = '';
    this._render();
  }

  _onScroll() {
    if (!this._raf) {
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._render();
        this._commit(this.min + this._indexFromScroll());
      });
    }
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => this._settle(), 140);
  }

  /** 指を離してスクロールが止まったとき、ぴったりの位置にそろえる */
  _settle() {
    if (this._anim) return;
    const index = this._indexFromScroll();
    const top = index * this.rowHeight;
    if (Math.abs(this.el.scrollTop - top) > 1) {
      this.el.scrollTo({ top, behavior: 'smooth' });
    }
    this._commit(this.min + index);
  }

  _indexFromScroll() {
    return clamp(Math.round(this.el.scrollTop / this.rowHeight), 0, this.items.length - 1);
  }

  _commit(v) {
    if (this._anim || v === this.value) return; // 自動で回している途中の値は無視
    this.value = v;
    this._updateAria();
    this.onChange(v);
  }

  /** 中央からの距離に応じて、ドラムのように傾けて薄くする */
  _render() {
    const h = this.rowHeight;
    const pos = this.el.scrollTop / h;
    const first = Math.max(0, Math.floor(pos) - 3);
    const last = Math.min(this.items.length - 1, Math.ceil(pos) + 3);
    const nextStyled = new Set();

    for (let i = first; i <= last; i++) {
      const item = this.items[i];
      const d = i - pos;
      const ad = Math.min(Math.abs(d), 3);
      item.style.transform = `rotateX(${(-d * 21).toFixed(2)}deg) scale(${(1 - ad * 0.045).toFixed(3)})`;
      item.style.opacity = String(Math.max(0.16, 1 - ad * 0.3).toFixed(3));
      item.classList.toggle('is-center', Math.abs(d) < 0.5);
      nextStyled.add(item);
    }
    for (const item of this._styled) {
      if (!nextStyled.has(item)) {
        item.style.transform = '';
        item.style.opacity = '0.16';
        item.classList.remove('is-center');
      }
    }
    this._styled = nextStyled;
  }

  _updateAria() {
    this.el.setAttribute('aria-valuenow', String(this.value));
    this.el.setAttribute('aria-valuetext', this.value + this.label);
  }
}
