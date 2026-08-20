"use strict";
/* 输入：键盘（←→/AD）+ 触屏滑动；平台上的首次按键触发起跳，按住=滑翔减速 */
const Input = {
  kb: { left: false, right: false },   // 键盘按住状态
  held: { left: false, right: false }, // 每帧合成的有效方向
  glide: false,
  jumps: [],          // 待消费的起跳事件 {dir}
  touch: { active: false, sx: 0, dx: 0, jumped: false },

  init(canvasEl) {
    this.canvas = canvasEl;
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    const opt = { passive: false };
    canvasEl.addEventListener("touchstart", (e) => this.onTouchStart(e), opt);
    canvasEl.addEventListener("touchmove", (e) => this.onTouchMove(e), opt);
    canvasEl.addEventListener("touchend", (e) => this.onTouchEnd(e), opt);
    canvasEl.addEventListener("touchcancel", (e) => this.onTouchEnd(e), opt);
    // 鼠标按住画面左右半区（桌面备用操作方式）
    canvasEl.addEventListener("mousedown", (e) => this.onMouse(e, true));
    window.addEventListener("mouseup", (e) => this.onMouse(e, false));
  },

  onKey(e, down) {
    const code = e.code;
    const isLeft = code === "ArrowLeft" || code === "KeyA";
    const isRight = code === "ArrowRight" || code === "KeyD";
    if (isLeft || isRight) {
      if (down && !e.repeat) this.jumps.push({ dir: isLeft ? -1 : 1 });
      if (isLeft) this.kb.left = down; else this.kb.right = down;
      e.preventDefault();
    }
  },

  onTouchStart(e) {
    if (e.touches.length) {
      const t = e.touches[0];
      this.touch.active = true;
      this.touch.sx = t.clientX;
      this.touch.dx = 0;
      this.touch.jumped = false;
    }
    e.preventDefault();
  },

  onTouchMove(e) {
    if (!this.touch.active || !e.touches.length) return;
    const t = e.touches[0];
    this.touch.dx = t.clientX - this.touch.sx;
    if (!this.touch.jumped && Math.abs(this.touch.dx) > 16) {
      this.touch.jumped = true;
      this.jumps.push({ dir: this.touch.dx > 0 ? 1 : -1 });
    }
    e.preventDefault();
  },

  onTouchEnd(e) {
    this.touch.active = false;
    this.touch.dx = 0;
    if (e && e.preventDefault) e.preventDefault();
  },

  onMouse(e, down) {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    this.mouseDir = 0;
    if (down && x < r.width / 2) this.mouseDir = -1;
    else if (down) this.mouseDir = 1;
    if (down && this.mouseDir && !this._mouseJumped) {
      this._mouseJumped = true;
      this.jumps.push({ dir: this.mouseDir });
    }
    if (!down) this._mouseJumped = false;
  },

  /** 主循环每帧调用：合成键盘/触摸/鼠标输入 */
  poll() {
    let left = this.kb.left, right = this.kb.right;
    if (this.touch.active && Math.abs(this.touch.dx) > 10) {
      if (this.touch.dx < 0) left = true; else right = true;
    }
    if (this.mouseDir === -1) left = true;
    else if (this.mouseDir === 1) right = true;
    this.held.left = left;
    this.held.right = right;
    this.glide = left || right || this.touch.active;
  },

  dir() {
    return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
  },

  consumeJumps() {
    const j = this.jumps;
    this.jumps = [];
    return j;
  },

  reset() {
    this.kb.left = this.kb.right = false;
    this.held.left = this.held.right = false;
    this.glide = false;
    this.jumps = [];
    this.mouseDir = 0;
    this.touch.active = false;
    this.touch.dx = 0;
    this.touch.jumped = false;
  },
};

window.Input = Input;
