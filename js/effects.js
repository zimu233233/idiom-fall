"use strict";
/* 动效：像素粒子、浮动文字、墨染消散、全屏闪光（宏观/中观/微观反馈层） */
const Effects = {
  parts: [],      // 像素粒子
  floaters: [],   // 浮动文字（飞升）
  inks: [],       // 墨染消散
  flashes: [],    // 全屏闪光
  time: 0,

  reset() {
    this.parts = []; this.floaters = []; this.inks = []; this.flashes = [];
  },

  burst(x, y, color, n, spd) {
    n = n || 14; spd = spd || 220;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = Utils.rand(spd * 0.3, spd);
      this.parts.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        life: Utils.rand(0.35, 0.8), t: 0,
        size: Utils.rand(2, 4.5),
        color,
        grav: 620,
      });
    }
  },

  debris(x, y, w, color) { // 平台碎裂碎块
    const n = Math.max(8, Math.floor(w / 8));
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: x - w / 2 + Utils.rand(0, w), y: y + Utils.rand(0, 6),
        vx: Utils.rand(-90, 90), vy: Utils.rand(-160, -20),
        life: Utils.rand(0.5, 1.0), t: 0,
        size: Utils.rand(3, 6), color, grav: 900,
      });
    }
  },

  floatText(x, y, text, color, size) {
    this.floaters.push({
      x, y, text, color: color || PALETTE.text,
      size: size || 16, life: Utils.rand(0.9, 1.2), t: 0,
    });
  },

  inkDissolve(x, y, char) { // 正确字收集：墨染消散
    this.inks.push({ x, y, char, t: 0, life: 0.9 });
  },

  flash(color, alpha, dur) {
    this.flashes.push({ color, alpha: alpha || 0.3, t: 0, life: dur || 0.35 });
  },

  update(dt) {
    this.time += dt;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t >= f.life) { this.floaters.splice(i, 1); continue; }
      f.y -= 46 * dt;
    }
    for (let i = this.inks.length - 1; i >= 0; i--) {
      const k = this.inks[i];
      k.t += dt;
      if (k.t >= k.life) this.inks.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      if (f.t >= f.life) this.flashes.splice(i, 1);
    }
  },

  draw(ctx, cam) {
    // 墨染消散：字渐隐 + 墨团扩散
    for (const k of this.inks) {
      const q = k.t / k.life;
      const sy = k.y - cam.y;
      ctx.save();
      ctx.globalAlpha = (1 - q) * 0.9;
      ctx.fillStyle = "#0d0a10";
      for (let j = 0; j < 3; j++) {
        const r = 6 + q * (26 + j * 14);
        const ox = Math.sin(j * 2.1 + q * 5) * (6 + q * 16);
        ctx.beginPath();
        ctx.arc(k.x + ox, sy - q * 30 - j * 6, r, 0, Math.PI * 2);
        ctx.globalAlpha = (1 - q) * (0.5 - j * 0.13);
        ctx.fill();
      }
      ctx.globalAlpha = (1 - q);
      ctx.font = "bold 22px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = PALETTE.correct;
      ctx.fillText(k.char, k.x, sy - q * 34);
      ctx.restore();
    }
    // 像素粒子
    for (const p of this.parts) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const s = Math.max(1, p.size * a);
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - cam.y - s / 2), s, s);
    }
    ctx.globalAlpha = 1;
    // 浮动文字
    for (const f of this.floaters) {
      const a = 1 - f.t / f.life;
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.font = "bold " + f.size + "px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,6,14,0.8)";
      ctx.strokeText(f.text, f.x, f.y - cam.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - cam.y);
    }
    ctx.globalAlpha = 1;
    // 全屏闪光
    for (const f of this.flashes) {
      const a = f.alpha * (1 - f.t / f.life);
      ctx.fillStyle = f.color;
      ctx.globalAlpha = a;
      ctx.fillRect(0, 0, CFG.W, CFG.H);
    }
    ctx.globalAlpha = 1;
  },
};

window.Effects = Effects;
