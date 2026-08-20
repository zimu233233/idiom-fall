"use strict";
/* 相机：平滑跟随 + 错误震屏 + 视差背景（星点/远山/墨雾/地火余烬） */
class Camera {
  constructor() { this.reset(); }

  reset() {
    this.y = 0;
    this.shakeT = 0; this.shakeMag = 0;
    this.ox = 0; this.oy = 0;
    // 视差层预生成
    this.stars = [];
    for (let i = 0; i < 46; i++) {
      this.stars.push({ x: Utils.rand(0, CFG.W), y: Utils.rand(0, CFG.H * 2), s: Utils.chance(0.3) ? 2 : 1 });
    }
    this.mist = [];
    for (let i = 0; i < 12; i++) {
      this.mist.push({ x: Utils.rand(0, CFG.W), y: Utils.rand(0, CFG.H * 2), r: Utils.rand(30, 90) });
    }
    this.embers = [];
    for (let i = 0; i < 16; i++) {
      this.embers.push({ x: Utils.rand(0, CFG.W), y: Utils.rand(0, CFG.H), s: Utils.rand(1, 2.4), v: Utils.rand(24, 60), ph: Utils.rand(0, 6.3) });
    }
  }

  triggerShake(mag) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = 0.4;
  }

  follow(playerY, dt) {
    const desired = playerY - CFG.H * 0.38;
    // 下落追帧要快（避免主角出屏），上移慢一些
    const k = desired > this.y ? 7.5 : 4.5;
    this.y += (desired - this.y) * Math.min(1, k * dt);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const decay = Math.max(0, this.shakeT / 0.4);
      this.ox = Utils.rand(-1, 1) * this.shakeMag * decay;
      this.oy = Utils.rand(-1, 1) * this.shakeMag * decay;
    } else { this.ox = 0; this.oy = 0; this.shakeMag = 0; }
  }

  drawBackground(ctx, time) {
    const W = CFG.W, H = CFG.H;
    // 中式地狱底色渐变
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#170b14");
    g.addColorStop(0.55, "#22101d");
    g.addColorStop(1, "#2e1322");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 远山剪影（水墨，慢速视差）
    ctx.fillStyle = "rgba(16,8,18,0.85)";
    const mOff = (this.y * 0.18) % 620;
    for (let rep = -1; rep < 2; rep++) {
      const base = rep * 620 - mOff + 80;
      ctx.beginPath();
      ctx.moveTo(0, base + 260);
      ctx.quadraticCurveTo(60, base + 90, 150, base + 210);
      ctx.quadraticCurveTo(230, base + 40, 330, base + 190);
      ctx.quadraticCurveTo(390, base + 110, W, base + 240);
      ctx.lineTo(W, H); ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();
    }

    // 星点（两层视差）
    for (const s of this.stars) {
      const yy = ((s.y - this.y * 0.32) % (H * 2) + H * 2) % (H * 2) - H * 0.5;
      if (yy < -10 || yy > H + 10) continue;
      ctx.globalAlpha = 0.28 + 0.2 * Math.sin(time * 2 + s.x);
      ctx.fillStyle = "#cbb8e8";
      ctx.fillRect(s.x, yy, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // 墨雾
    for (const m of this.mist) {
      const yy = ((m.y - this.y * 0.55) % (H * 2) + H * 2) % (H * 2) - H * 0.5;
      if (yy < -m.r || yy > H + m.r) continue;
      const grad = ctx.createRadialGradient(m.x, yy, 0, m.x, yy, m.r);
      grad.addColorStop(0, "rgba(58,30,60,0.22)");
      grad.addColorStop(1, "rgba(58,30,60,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(m.x, yy, m.r, 0, Math.PI * 2); ctx.fill();
    }

    // 地火余烬（上升）
    ctx.fillStyle = "#ff9a4a";
    for (const e of this.embers) {
      const yy = ((e.y - time * e.v) % (H + 40) + (H + 40)) % (H + 40) - 20;
      const xx = e.x + Math.sin(time * 1.6 + e.ph) * 8;
      ctx.globalAlpha = 0.25 + 0.3 * Math.sin(time * 3 + e.ph);
      ctx.fillRect(xx, yy, e.s, e.s);
    }
    ctx.globalAlpha = 1;
  }

  drawDepthRuler(ctx) {
    const W = CFG.W;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const pxPerM = CFG.PX_PER_M;
    const topM = Math.floor(this.y / pxPerM / 10) * 10;
    const bottomM = Math.ceil((this.y + CFG.H) / pxPerM / 10) * 10;
    ctx.font = "10px 'Courier New', monospace";
    for (let m = topM; m <= bottomM; m += 10) {
      const sy = m * pxPerM - this.y;
      const major = m % 50 === 0;
      ctx.fillStyle = major ? "rgba(255,212,71,0.75)" : "rgba(160,150,190,0.35)";
      ctx.fillRect(W - (major ? 16 : 8), sy, major ? 16 : 8, 1);
      if (major && m > 0) {
        ctx.fillStyle = "rgba(255,212,71,0.65)";
        ctx.fillText(m + "m", W - 20, sy);
      }
    }
  }
}

window.Camera = Camera;
