"use strict";
/* 相机与画卷场景：段落取色的天空三段渐变、太阳、柔云、四重层峦（远淡近浓叠压）、飞鸟、山岚、顶底雾、竖排深度与诗句 */
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
    // 幽谷流萤 / 深潭微泡（段落标志物）
    this.flies = [];
    for (let i = 0; i < 10; i++) {
      this.flies.push({ x: Utils.rand(20, CFG.W - 20), y: Utils.rand(CFG.H * 0.55, CFG.H * 0.9), ph: Utils.rand(0, 6.3) });
    }
    this.bubbles = [];
    for (let i = 0; i < 7; i++) {
      this.bubbles.push({ x: Utils.rand(CFG.W * 0.12, CFG.W * 0.88), r: Utils.rand(1.5, 3.4), v: Utils.rand(14, 26), ph: Utils.rand(0, 6.3) });
    }
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

  /* ---- 横向山峦：平滑峰形（中点二次贝塞尔），山体向下渐实没入岚霭 ---- */
  drawRange(ctx, pts, colorTop, colorBody, alpha, baseY, fillTo) {
    const sx = CFG.W / 460;
    const P = [];
    for (let k = 0; k < pts.length; k += 2) P.push([pts[k] * sx, baseY - pts[k + 1]]);
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, baseY - 140, 0, fillTo);
    g.addColorStop(0, colorTop);
    g.addColorStop(1, colorBody);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-4, baseY + 6);
    ctx.lineTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length - 1; i++) {
      const mx = (P[i][0] + P[i + 1][0]) / 2;
      const my = (P[i][1] + P[i + 1][1]) / 2;
      ctx.quadraticCurveTo(P[i][0], P[i][1], mx, my);
    }
    ctx.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
    ctx.lineTo(CFG.W + 4, baseY + 6);
    ctx.lineTo(CFG.W + 4, fillTo);
    ctx.lineTo(-4, fillTo);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    return P; // 供山脊点定位（画松）
  }

  /* 山脊小松：两三层塔状冠 + 细干 + 落影；成簇错落（确定性伪随机，不闪烁） */
  drawPine(ctx, x, y, s, lean, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);
    ctx.fillStyle = color;
    // 落影贴地
    ctx.globalAlpha = alpha * 0.22;
    ctx.beginPath(); ctx.ellipse(0, 1.5, s * 0.75, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    // 细干
    ctx.globalAlpha = alpha;
    ctx.fillRect(-s * 0.05, -s * 0.3, s * 0.1, s * 0.36);
    // 三层塔冠（底宽顶窄，侧边微弧）
    const tiers = [[0.62, 0.30], [0.47, 0.18], [0.32, 0.06]];
    for (let t = 0; t < 3; t++) {
      const hw = tiers[t][0] * s, hy = tiers[t][1] * s;
      ctx.beginPath();
      ctx.moveTo(-hw, -hy);
      ctx.quadraticCurveTo(-hw * 0.3, -hy - 0.30 * s, 0, -hy - 0.38 * s);
      ctx.quadraticCurveTo(hw * 0.3, -hy - 0.30 * s, hw, -hy);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  drawPineGrove(ctx, spots, color, alpha, baseS) {
    const hash = (a, n) => {
      const v = Math.sin(a * 12.9898 + n * 78.233) * 43758.5453;
      return v - Math.floor(v); // 0..1 确定性伪随机（不闪烁）
    };
    for (const [gx, gy] of spots) {
      const n = 2 + (Math.round(gx) % 3 === 0 ? 1 : 0);   // 2-3 棵一簇
      for (let k = 0; k < n; k++) {
        const s = baseS * (0.72 + hash(gx, k * 3 + 1) * 0.56); // 大小 ±30%
        const dx = (k - (n - 1) / 2) * (s * 0.9 + 3) + (hash(gx, k * 3 + 2) - 0.5) * 6;
        const lean = (hash(gx, k * 3 + 3) - 0.5) * 0.22;
        this.drawPine(ctx, gx + dx, gy - 2, s, lean, color, alpha * (0.82 + hash(gx, k * 7) * 0.18));
      }
    }
  }

  drawBackground(ctx, time) {
    const W = CFG.W, H = CFG.H;
    const seg = Utils.segmentAt(this.depth);
    // 四段标志物权重（边界交叉淡入淡出）
    const w = [0, 1, 2, 3].map((i) => Utils.segWeight(this.depth, i));

    // 天空三段
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, seg.sky[0]);
    g.addColorStop(0.45, seg.sky[1]);
    g.addColorStop(1, seg.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 星点（幽谷段 40% 处起、段宽 2/3 内淡入，跨入深潭后全亮——随段界缩放）
    const gw = CFG.SEGMENTS[3].from - CFG.SEGMENTS[2].from;
    const starA = Utils.clamp((this.depth - CFG.SEGMENTS[2].from - gw * 0.4) / (gw * 2 / 3), 0, 1);
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
    ctx.globalAlpha = seg.index >= 3 ? 0.5 : 0.85 + 0.15 * w[1];
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
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, c.h / c.w * 2.2);
      // 渐变须在变换后的局部坐标创建（圆心 0,0），否则渐变中心随 CTM 偏移出圆、整朵云透明
      const cg = ctx.createRadialGradient(0, 0, 2, 0, 0, c.w / 2);
      cg.addColorStop(0, "rgba(255,255,255," + (0.8 * c.a) + ")");
      cg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(0, 0, c.w / 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 飞鸟（两笔弧线）；松涛段添飞鸟、幽谷段添归鸟
    ctx.strokeStyle = "#9aa294";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    const birdList = this.birds.map((b) => ({ b, a: 1 }));
    if (w[1] > 0.02) birdList.push({ b: { x: 160, y: 72, v: 10, ph: 1.2 }, a: w[1] });
    if (w[2] > 0.02) {
      birdList.push({ b: { x: 330, y: 112, v: 8, ph: 4 }, a: w[2] });
      birdList.push({ b: { x: 40, y: 138, v: 9, ph: 5.1 }, a: w[2] });
    }
    for (const { b, a } of birdList) {
      const bx = ((b.x + time * b.v) % (W + 90)) - 45;
      const by = b.y + Math.sin(time * 0.7 + b.ph) * 8;
      const flap = Math.sin(time * 6 + b.ph) * 2;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(bx - 8, by); ctx.quadraticCurveTo(bx - 4, by - 4 - flap, bx, by);
      ctx.quadraticCurveTo(bx + 4, by - 4 - flap, bx + 8, by);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 层峦叠嶂：四重横向山峦远→近叠压（远淡小、近浓大），山脚没入山岚
    // 轻微异相位摆动代替平铺视差——层与层缓慢错动，无拼缝
    const FILL = H * 0.62;
    const bob = (i) => Math.sin(this.y * 0.004 + i * 1.9) * (2 + i * 2);
    // 远峦（最小最淡）
    this.drawRange(ctx,
      [0, 30, 55, 48, 110, 26, 165, 52, 225, 34, 285, 56, 345, 28, 405, 50, 460, 32],
      Utils.lerpColor(seg.mtn[0], seg.sky[1], 0.5), seg.mtn[0], 0.5, 152 + bob(0), FILL);
    // 次远峦
    this.drawRange(ctx,
      [0, 52, 70, 74, 140, 44, 210, 80, 280, 50, 350, 84, 460, 56],
      Utils.lerpColor(Utils.lerpColor(seg.mtn[0], seg.mtn[1], 0.5), seg.sky[1], 0.3),
      Utils.lerpColor(seg.mtn[0], seg.mtn[1], 0.5), 0.66, 198 + bob(1), FILL);
    // 中峦（脊上松林：小而淡，颜色随段换）
    const p3 = this.drawRange(ctx,
      [0, 66, 85, 98, 170, 58, 255, 104, 340, 70, 425, 100, 460, 80],
      Utils.lerpColor(seg.mtn[1], seg.sky[1], 0.2), seg.mtn[1], 0.8, 248 + bob(2), FILL + 10);
    this.drawPineGrove(ctx, [p3[1], p3[3], p3[5]].map((p) => [p[0], p[1] + 4]),
      Utils.lerpColor(seg.mtn[1], "#33403a", 0.35), 0.85, 8);
    // 近峦（最浓最大，压住前层层脚；松林更大更浓）
    const nearBody = Utils.lerpColor(seg.mtn[2], "#3f4a42", 0.25);
    const p4 = this.drawRange(ctx,
      [0, 84, 100, 126, 200, 74, 300, 132, 395, 92, 460, 110],
      seg.mtn[2], nearBody, 0.95, 308 + bob(3), FILL + 20);
    this.drawPineGrove(ctx, [p4[1], p4[3], p4[4]].map((p) => [p[0], p[1] + 5]),
      Utils.lerpColor(nearBody, "#33403a", 0.3), 0.9, 12);

    // 云海·晨雾：山腰云毯（压在群峦之上、没入岚霭）
    if (w[0] > 0.02) {
      const banks = [[210, 272, 250], [120, 338, 300], [265, 400, 220]];
      for (let i = 0; i < banks.length; i++) {
        const cx = ((banks[i][0] + time * (6 + i * 2)) % (W + 260)) - 130;
        const by = banks[i][1] + bob(1) * 0.5;
        const bw = banks[i][2];
        ctx.save();
        ctx.translate(cx, by);
        ctx.scale(1, 0.16);
        const cg = ctx.createRadialGradient(0, 0, 4, 0, 0, bw / 2);
        cg.addColorStop(0, "rgba(252,250,242," + (0.6 * w[0]).toFixed(3) + ")");
        cg.addColorStop(1, "rgba(252,250,242,0)");
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(0, 0, bw / 2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    // 松涛·午晴：天际风痕（细弧缓扫）
    if (w[1] > 0.02) {
      ctx.strokeStyle = "rgba(255,255,255," + (0.38 * w[1]).toFixed(3) + ")";
      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const sy = 34 + i * 26 + Math.sin(time * 0.5 + i) * 4;
        const sx = ((time * (16 + i * 6) + i * 190) % (W + 200)) - 100;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + 46, sy - 7, sx + 96, sy);
        ctx.quadraticCurveTo(sx + 130, sy + 5, sx + 160, sy - 2);
        ctx.stroke();
      }
    }

    // 山岚横带（画面中部，按段染色：晨雾白/午晴暖白/暮色微玫/深潭蓝灰）
    const MISTC = [[247, 244, 233], [249, 242, 223], [243, 228, 216], [220, 228, 234]];
    let mr = 247, mgv = 244, mb = 233, msum = 0, tr = 0, tg = 0, tb = 0;
    for (let i = 0; i < 4; i++) {
      if (w[i] <= 0) continue;
      tr += MISTC[i][0] * w[i]; tg += MISTC[i][1] * w[i]; tb += MISTC[i][2] * w[i]; msum += w[i];
    }
    if (msum > 0) { mr = tr / msum; mgv = tg / msum; mb = tb / msum; }
    const mist = (a) => "rgba(" + Math.round(mr) + "," + Math.round(mgv) + "," + Math.round(mb) + "," + a + ")";
    // 静态雾带调淡（漂浮岚带会叠加遮罩，避免过白）
    const mg = ctx.createLinearGradient(0, H * 0.56, 0, H * 0.56 + 84);
    mg.addColorStop(0, mist(0));
    mg.addColorStop(0.5, mist(0.55));
    mg.addColorStop(1, mist(0));
    ctx.fillStyle = mg;
    ctx.fillRect(0, H * 0.56, W, 84);

    // 横向漂浮岚带：半遮山腰/山脚与"山体→下方"的过渡（软圆串、各自漂速、边缘不规则）
    const sr = Math.round(mr + (255 - mr) * 0.55);
    const sg2 = Math.round(mgv + (255 - mgv) * 0.55);
    const sb = Math.round(mb + (255 - mb) * 0.55);
    const soft = (a) => "rgba(" + sr + "," + sg2 + "," + sb + "," + a + ")";
    const BANDS = [
      { y: 318, len: 300, h: 40, a: 0.34, v: 8 },
      { y: 392, len: 340, h: 50, a: 0.45, v: 13 },
      { y: 458, len: 280, h: 46, a: 0.5, v: 17 },
      { y: 512, len: 360, h: 44, a: 0.4, v: 10 },
    ];
    BANDS.forEach((bd, i) => {
      const cx = ((time * bd.v + i * 173) % (W + bd.len)) - bd.len / 2;
      const cy = bd.y + Math.sin(time * 0.3 + i * 1.7) * 4;
      const n = 5;
      for (let k = 0; k < n; k++) {
        const h1 = Math.sin(i * 12.9898 + k * 3 + 1) * 43758.5453;
        const h2 = Math.sin(i * 12.9898 + k * 3 + 2) * 43758.5453;
        const h3 = Math.sin(i * 12.9898 + k * 3 + 3) * 43758.5453;
        const fr1 = h1 - Math.floor(h1), fr2 = h2 - Math.floor(h2), fr3 = h3 - Math.floor(h3);
        const endK = (k === 0 || k === n - 1) ? 0.68 : 1;   // 两端收小成云头云尾
        const px = cx + (k - (n - 1) / 2) * (bd.len / n) * (0.78 + fr1 * 0.44);
        const py = cy + (fr2 - 0.5) * bd.h * 0.6;
        const pr = bd.h * (0.85 + fr3 * 0.7) * endK;
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(1, 0.36);
        const cg = ctx.createRadialGradient(0, 0, 2, 0, 0, pr);
        cg.addColorStop(0, soft(bd.a));
        cg.addColorStop(1, soft(0));
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(0, 0, pr, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    });

    // 幽谷·暮色：流萤（暖金浮沉闪烁）
    if (w[2] > 0.02) {
      ctx.fillStyle = "#e8c47a";
      for (const f of this.flies) {
        const fx = f.x + Math.sin(time * 0.8 + f.ph) * 10;
        const fy = f.y + Math.sin(time * 1.3 + f.ph * 2) * 8;
        const fa = w[2] * (0.3 + 0.45 * Math.max(0, Math.sin(time * 2.6 + f.ph)));
        ctx.globalAlpha = fa * 0.35;
        ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = fa;
        ctx.beginPath(); ctx.arc(fx, fy, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 深潭·星蓝：自底缓升的微泡
    if (w[3] > 0.02) {
      ctx.strokeStyle = "rgba(214,230,238," + (0.3 * w[3]).toFixed(3) + ")";
      ctx.lineWidth = 1;
      for (const bb of this.bubbles) {
        const by = H - 20 - ((time * bb.v + bb.ph * 60) % (H * 0.5));
        const bx = bb.x + Math.sin(time * 1.4 + bb.ph) * 8;
        ctx.beginPath(); ctx.arc(bx, by, bb.r, 0, Math.PI * 2); ctx.stroke();
      }
    }

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
    fg.addColorStop(0, mist(0));
    fg.addColorStop(0.55, mist(0.75));
    fg.addColorStop(1, mist(1));
    ctx.fillStyle = fg; ctx.fillRect(0, H - 150, W, 150);
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
