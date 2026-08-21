"use strict";
/* 动效 · 青绿手卷：墨花软粒子、涟漪（错字温柔反馈）、银杏叶（学富五车）、书法浮字、柔光
   抗疲劳原则：无红闪、无硬爆闪，一切反馈如水墨晕开 */
const Effects = {
  parts: [],      // 软粒子（墨花 / 石屑 / 银杏叶）
  floaters: [],   // 浮动文字（书法体飞升）
  inks: [],       // 墨染消散
  ripples: [],    // 水面涟漪（错字）
  glows: [],      // 柔光晕（通关/boost）
  time: 0,

  reset() {
    this.parts = []; this.floaters = []; this.inks = [];
    this.ripples = []; this.glows = [];
  },

  burst(x, y, color, n, spd) {
    n = n || 12; spd = spd || 200;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = Utils.rand(spd * 0.3, spd);
      this.parts.push({
        type: "dot", x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50,
        life: Utils.rand(0.4, 0.9), t: 0,
        size: Utils.rand(2.5, 5.5), color, grav: 520,
      });
    }
  },

  debris(x, y, w, color) { // 浮石化墨散落（软石屑）
    const n = Math.max(6, Math.floor(w / 12));
    for (let i = 0; i < n; i++) {
      this.parts.push({
        type: "pebble", x: x - w / 2 + Utils.rand(0, w), y: y + Utils.rand(0, 5),
        vx: Utils.rand(-70, 70), vy: Utils.rand(-120, -10),
        life: Utils.rand(0.5, 1.0), t: 0,
        size: Utils.rand(2.5, 5), color: color || PALETTE.slabMid, grav: 760,
      });
    }
  },

  ginkgo(x, y, n) { // 银杏叶飘落
    n = n || 6;
    for (let i = 0; i < n; i++) {
      this.parts.push({
        type: "leaf",
        x: x + Utils.rand(-70, 70), y: y + Utils.rand(-30, 10),
        vx: Utils.rand(-26, 26), vy: Utils.rand(28, 62),
        life: Utils.rand(1.6, 2.8), t: 0,
        size: Utils.rand(4.5, 7.5), color: Utils.chance(0.5) ? "#d9b36c" : PALETTE.gold,
        grav: 6, rot: Utils.rand(0, 6.3), vr: Utils.rand(-2.4, 2.4), ph: Utils.rand(0, 6.3),
      });
    }
  },

  floatText(x, y, text, color, size) {
    this.floaters.push({
      x, y, text, color: color || PALETTE.mineralDk,
      size: size || 18, life: Utils.rand(1.0, 1.3), t: 0,
    });
  },

  inkDissolve(x, y, char) { // 正确字收集：朱圈化作墨花
    this.inks.push({ x, y, char, t: 0, life: 0.9 });
  },

  ripple(x, y) { // 错字：水面涟漪轻荡
    this.ripples.push({ x, y, t: 0, life: 1.0 });
  },

  glow(x, y, color, radius, dur) { // 柔和光晕
    this.glows.push({ x, y, color: color || "rgba(222,186,105,0.5)", r: radius || 90, t: 0, life: dur || 0.8 });
  },

  flash(color, alpha, dur) { // 保留接口：极柔全屏薄纱
    this.glows.push({ x: CFG.W / 2, y: CFG.H / 2, color, r: CFG.H, t: 0, life: dur || 0.4, full: true, alpha: alpha || 0.15 });
  },

  update(dt) {
    this.time += dt;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      if (p.type === "leaf") {
        p.x += (p.vx + Math.sin(this.time * 3 + p.ph) * 22) * dt;
        p.rot += p.vr * dt;
      } else {
        p.x += p.vx * dt;
      }
      p.y += p.vy * dt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t >= f.life) { this.floaters.splice(i, 1); continue; }
      f.y -= 44 * dt;
    }
    for (let i = this.inks.length - 1; i >= 0; i--) {
      const k = this.inks[i];
      k.t += dt;
      if (k.t >= k.life) this.inks.splice(i, 1);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += dt;
      if (r.t >= r.life) this.ripples.splice(i, 1);
    }
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const g = this.glows[i];
      g.t += dt;
      if (g.t >= g.life) this.glows.splice(i, 1);
    }
  },

  drawLeaf(ctx, p, a, camY) {
    ctx.save();
    ctx.translate(p.x, p.y - camY);
    ctx.rotate(p.rot);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(0, p.size * 0.8);
    ctx.arc(0, p.size * 0.2, p.size, Math.PI * 0.15, Math.PI * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#b28a45";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, p.size * 0.9);
    ctx.stroke();
    ctx.restore();
  },

  draw(ctx, cam) {
    // 柔光晕
    for (const g of this.glows) {
      const q = g.t / g.life;
      const a = (g.alpha || 0.4) * (1 - q);
      ctx.save();
      if (g.full) {
        ctx.globalAlpha = a;
        ctx.fillStyle = g.color;
        ctx.fillRect(-20, -20, CFG.W + 40, CFG.H + 40);
      } else {
        const r = g.r * (0.5 + q * 0.7);
        const rg = ctx.createRadialGradient(g.x, g.y - cam.y, 2, g.x, g.y - cam.y, r);
        rg.addColorStop(0, g.color);
        rg.addColorStop(1, "rgba(222,186,105,0)");
        ctx.globalAlpha = a / (g.alpha || 0.4) * 0.4 + a * 0.6;
        ctx.fillStyle = rg;
        ctx.fillRect(g.x - r, g.y - cam.y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
    // 涟漪（错字温柔反馈）
    for (const r of this.ripples) {
      const q = r.t / r.life;
      const sy = r.y - cam.y;
      ctx.save();
      for (let j = 0; j < 3; j++) {
        const rq = Utils.clamp(q * 1.3 - j * 0.18, 0, 1);
        if (rq <= 0) continue;
        ctx.globalAlpha = (1 - rq) * 0.4;
        ctx.strokeStyle = j === 0 ? PALETTE.cinnabar : "#8fa6ad";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(r.x, sy, 8 + rq * (44 + j * 14), (8 + rq * (44 + j * 14)) * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 墨染消散：字渐隐 + 墨花晕开
    for (const k of this.inks) {
      const q = k.t / k.life;
      const sy = k.y - cam.y;
      ctx.save();
      ctx.font = "24px " + FONT_CAL;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.globalAlpha = (1 - q);
      ctx.fillStyle = PALETTE.mineralDk;
      ctx.fillText(k.char, k.x, sy - q * 26);
      // 朱批圈淡去
      ctx.globalAlpha = (1 - q) * 0.7;
      ctx.strokeStyle = PALETTE.cinnabar;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(k.x, sy - q * 26, 16, 14.5, -0.14, 0, Math.PI * 2);
      ctx.stroke();
      // 墨花
      for (let j = 0; j < 3; j++) {
        const rr = 5 + q * (24 + j * 12);
        const ox = Math.sin(j * 2.1 + q * 5) * (5 + q * 13);
        ctx.globalAlpha = (1 - q) * (0.3 - j * 0.07);
        ctx.fillStyle = "#6e7d6e";
        ctx.beginPath();
        ctx.ellipse(k.x + ox, sy - q * 26 - j * 5, rr, rr * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    // 软粒子（墨花点 / 石屑）
    for (const p of this.parts) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = p.color;
      if (p.type === "leaf") {
        this.drawLeaf(ctx, p, a * 0.85, cam.y);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y - cam.y, Math.max(0.8, p.size * a), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // 浮动文字（书法体）
    for (const f of this.floaters) {
      const a = 1 - f.t / f.life;
      ctx.save();
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.font = f.size + "px " + FONT_CAL;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,.65)";
      ctx.fillText(f.text, f.x, f.y - cam.y + 1.5);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - cam.y);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },
};

window.Effects = Effects;
