"use strict";
/* 相机与画卷场景：段落取色的天空三段渐变、太阳、柔云、三重远山（视差）、飞鸟、山岚、顶底雾、竖排深度与诗句 */
class Camera {
  constructor() { this.reset(); }

  reset() {
    this.y = 0;
    this.depth = 0;          // 当前深度（由 Game 每帧写入）
    this.shakeT = 0; this.shakeMag = 0;
    this.ox = 0; this.oy = 0;
    // 柔云 / 星点 / 飞鸟（屏幕空间 + 轻视差）
    this.clouds = [
      { x: 60, y: 118, w: 130, h: 24, a: 0.7, v: 5 },
      { x: 296, y: 58, w: 92, h: 17, a: 0.5, v: 8 },
      { x: 180, y: 206, w: 110, h: 19, a: 0.35, v: 6 },
    ];
    this.stars = [];
    for (let i = 0; i < 40; i++) {
      this.stars.push({ x: Utils.rand(0, CFG.W), y: Utils.rand(0, CFG.H), s: Utils.chance(0.3) ? 2 : 1, ph: Utils.rand(0, 6.3) });
    }
    this.birds = [
      { x: 250, y: 96, v: 12, ph: 0 },
      { x: 90, y: 160, v: 9, ph: 2 },
    ];
  }

  triggerShake(mag) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = 0.4;
  }

  follow(playerY, dt) {
    const desired = playerY - CFG.H * 0.38;
    const k = desired > this.y ? 7.5 : 4.5;
    this.y += (desired - this.y) * Math.min(1, k * dt);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const decay = Math.max(0, this.shakeT / 0.4);
      this.ox = Utils.rand(-1, 1) * this.shakeMag * decay;
      this.oy = Utils.rand(-1, 1) * this.shakeMag * decay;
    } else { this.ox = 0; this.oy = 0; this.shakeMag = 0; }
  }

  /* ---- 远山脊线（按段配色，纵向平铺 + 视差上移） ---- */
  drawRidge(ctx, pts, color, alpha, factor) {
    const T = 240, W = CFG.W, H = CFG.H;
    const off = (this.y * factor) % T;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let j = -1; j <= H / T + 1; j++) {
      const base = j * T - off + T;   // 该行脊线基线
      if (base < -40 || base > H + 40) continue;
      ctx.beginPath();
      ctx.moveTo(0, base + T + 4);
      for (let k = 0; k < pts.length; k += 2) {
        ctx.lineTo(pts[k] * (W / 460), base + pts[k + 1]);
      }
      ctx.lineTo(W, base + T + 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawBackground(ctx, time) {
    const W = CFG.W, H = CFG.H;
    const seg = Utils.segmentAt(this.depth);

    // 天空三段
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, seg.sky[0]);
    g.addColorStop(0.45, seg.sky[1]);
    g.addColorStop(1, seg.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 星点（深潭段淡入）
    const starA = Utils.clamp((this.depth - CFG.SEGMENTS[2].from - 120) / 200, 0, 1);
    if (starA > 0) {
      for (const s of this.stars) {
        ctx.globalAlpha = starA * (0.4 + 0.35 * Math.sin(time * 2 + s.ph));
        ctx.fillStyle = "#f4f1e6";
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }
      ctx.globalAlpha = 1;
    }

    // 太阳（暮色转暖、深潭化作淡月）
    const sunX = 64, sunY = 62;
    const sunCore = seg.index >= 3 ? "#e9edf2" : (seg.index >= 2 ? "#eec27e" : "#f3e2ac");
    const sg = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 42);
    sg.addColorStop(0, sunCore);
    sg.addColorStop(0.42, sunCore);
    sg.addColorStop(1, "rgba(243,226,172,0)");
    ctx.globalAlpha = seg.index >= 3 ? 0.5 : 0.85;
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(sunX, sunY, 42, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "rgba(214,178,94,.45)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sunX, sunY, 50, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;

    // 柔云（缓慢漂移 + 轻视差）
    for (const c of this.clouds) {
      const cx = ((c.x + time * c.v) % (W + 160)) - 80;
      const cy = c.y - ((this.y * 0.04) % 40);
      const cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, c.w / 2);
      cg.addColorStop(0, "rgba(255,255,255," + (0.8 * c.a) + ")");
      cg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = cg;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, c.h / c.w * 2.2);
      ctx.beginPath(); ctx.arc(0, 0, c.w / 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 飞鸟（两笔弧线）
    ctx.strokeStyle = "#9aa294";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    for (const b of this.birds) {
      const bx = ((b.x + time * b.v) % (W + 90)) - 45;
      const by = b.y + Math.sin(time * 0.7 + b.ph) * 8;
      const flap = Math.sin(time * 6 + b.ph) * 2;
      ctx.beginPath();
      ctx.moveTo(bx - 8, by); ctx.quadraticCurveTo(bx - 4, by - 4 - flap, bx, by);
      ctx.quadraticCurveTo(bx + 4, by - 4 - flap, bx + 8, by);
      ctx.stroke();
    }

    // 三重远山（远→近，纵向视差上移；颜色随段落）
    this.drawRidge(ctx,
      [0, 120, 50, 84, 96, 118, 150, 66, 210, 116, 268, 88, 320, 124, 380, 78, 430, 116, 460, 100],
      seg.mtn[0], 0.55, 0.10);
    this.drawRidge(ctx,
      [0, 160, 60, 128, 120, 168, 190, 118, 250, 164, 320, 132, 390, 172, 460, 140],
      seg.mtn[1], 0.7, 0.22);
    // 近山脊上的小松
    this.drawPines(ctx, seg.mtn[2], 0.34);
    this.drawRidge(ctx,
      [0, 200, 80, 168, 160, 208, 240, 172, 330, 212, 410, 180, 460, 206],
      seg.mtn[2], 0.95, 0.34);

    // 山岚横带（画面中部柔白）
    const mg = ctx.createLinearGradient(0, H * 0.56, 0, H * 0.56 + 84);
    mg.addColorStop(0, "rgba(247,244,233,0)");
    mg.addColorStop(0.5, "rgba(247,244,233,.7)");
    mg.addColorStop(1, "rgba(247,244,233,0)");
    ctx.fillStyle = mg;
    ctx.fillRect(0, H * 0.56, W, 84);

    // 暖色内晕
    const bg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
    bg.addColorStop(0, "rgba(222,186,105,0)");
    bg.addColorStop(1, "rgba(222,186,105,.16)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 顶雾 / 底雾
    let fg = ctx.createLinearGradient(0, 0, 0, 64);
    fg.addColorStop(0, "rgba(249,245,232,.9)");
    fg.addColorStop(1, "rgba(249,245,232,0)");
    ctx.fillStyle = fg; ctx.fillRect(0, 0, W, 64);
    fg = ctx.createLinearGradient(0, H - 150, 0, H);
    fg.addColorStop(0, "rgba(242,240,228,0)");
    fg.addColorStop(0.55, "rgba(242,240,228,.75)");
    fg.addColorStop(1, "#f3efe0");
    ctx.fillStyle = fg; ctx.fillRect(0, H - 150, W, 150);
  }

  drawPines(ctx, color, factor) {
    const T = 240;
    const off = (this.y * factor) % T;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#5f7f70";
    for (let j = -1; j <= CFG.H / T + 1; j++) {
      const base = j * T - off + T;
      if (base < -40 || base > CFG.H + 40) continue;
      [70, 155, 300, 396].forEach((x, i) => {
        const px = x * (CFG.W / 460) + (i % 2) * 14;
        const py = base + 172 + (i % 3) * 6;
        ctx.beginPath();
        ctx.moveTo(px - 5, py); ctx.lineTo(px, py - 12); ctx.lineTo(px + 5, py);
        ctx.closePath(); ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
  }

  /* ---- 竖排深度（右）与诗句（左） ---- */
  drawDepthRuler(ctx) {
    const W = CFG.W;
    ctx.save();
    // 右：已坠·X丈
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "13px " + FONT_CAL;
    ctx.fillStyle = "#8d8672";
    const chars = ("已坠·" + Math.max(0, this.depth).toFixed(0) + "丈").split("");
    const x0 = W - 20, y0 = 126, step = 19;
    ctx.strokeStyle = "#d8cdb0";
    ctx.beginPath(); ctx.moveTo(x0 + 8, y0 - 12); ctx.lineTo(x0 + 8, y0 + chars.length * step); ctx.stroke();
    chars.forEach((ch, i) => ctx.fillText(ch, x0, y0 + i * step));
    ctx.fillStyle = PALETTE.cinnabar;
    ctx.beginPath(); ctx.arc(x0 + 8, y0 - 14, 3.5, 0, Math.PI * 2); ctx.fill();
    // 左：竖排诗句
    ctx.fillStyle = "rgba(152,160,145,.8)";
    ctx.font = "12px " + FONT_CAL;
    const poem = "书山有路坠墨成章";
    poem.split("").forEach((ch, i) => ctx.fillText(ch, 22, 230 + i * 20));
    ctx.restore();
  }
}

window.Camera = Camera;
