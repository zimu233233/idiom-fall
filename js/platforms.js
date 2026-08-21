"use strict";
/* 世界：成语文字层生成（每层3个带字平台：1正2误 + 无字平台）、碰撞、碎裂、按进度重建 */
class World {
  constructor(game) {
    this.game = game;
    this.rows = [];
    this.platforms = [];
    this.reset(null);
  }

  reset(firstIdiom) {
    this.rows = [];
    this.platforms = [];
    this.nextY = 300;
    this.sinceChoice = 0;
    this.setIdiom(firstIdiom || IdiomDB.pickIdiom(1), true);
    // 出生平台
    const spawn = {
      x: CFG.W / 2, y: 200, w: 120, h: CFG.PLAT_H,
      char: null, isChoice: false, correct: false, consumed: false,
      dead: false, breaking: 0, bounceT: 0, revealed: false,
    };
    this.platforms.push(spawn);
    this.generateAhead(CFG.H * 1.7);
  }

  setIdiom(idiom) {
    this.idiom = idiom;            // {w,p,e}
    this.progress = 0;             // 已收集 0..4
    this.genIndex = 0;             // 已为当前成语生成的文字层数
    this.perfect = true;           // 本成语是否零失误零停滞
    this.lastChoiceY = 0;          // 当前成语最深文字层位置
  }

  stage() { return this.game.stage(); }

  generateAhead(bottomY) {
    let guard = 0;
    while (this.nextY < bottomY && guard++ < 40) {
      if (this.genIndex < 4 && (this.sinceChoice >= 1 || Utils.chance(0.7))) {
        this.buildChoiceRow();
      } else {
        this.buildBlankRow();
      }
    }
  }

  slotCenters(nSlots) {
    const usable = CFG.W - CFG.MARGIN * 2;
    const centers = [];
    for (let i = 0; i < nSlots; i++) {
      centers.push(CFG.MARGIN + usable * (i + 0.5) / nSlots);
    }
    return Utils.shuffle(centers);
  }

  buildChoiceRow() {
    const y = this.nextY;
    const stage = this.stage();
    const idx = this.genIndex;
    const correctChar = this.idiom.w[idx];
    const wantThree = stage >= 4 && Utils.chance(0.35);
    const distractors = IdiomDB.makeDistractors(correctChar, this.idiom.w.split(""), stage, wantThree ? 3 : 2);
    const chars = Utils.shuffle([correctChar].concat(distractors));
    const centers = this.slotCenters(chars.length + 2);
    const plats = [];
    chars.forEach((ch, i) => {
      const p = this.makePlatform(centers[i], y, CFG.CHAR_PLAT_W);
      p.char = ch;
      p.isChoice = true;
      p.correct = (ch === correctChar);
      plats.push(p);
    });
    // 补充无字平台
    for (let i = chars.length; i < centers.length; i++) {
      if (Utils.chance(0.5)) {
        plats.push(this.makePlatform(centers[i], y, Utils.rand(56, 68)));
      }
    }
    this.rows.push({ y, plats, isChoice: true, charIndex: idx });
    this.platforms.push.apply(this.platforms, plats);
    this.genIndex++;
    this.lastChoiceY = y;
    this.sinceChoice = 0;
    this.nextY += CFG.LAYER_GAP;
  }

  buildBlankRow() {
    const y = this.nextY;
    const centers = this.slotCenters(3);
    const plats = [];
    const n = Utils.chance(0.55) ? 2 : 1;
    for (let i = 0; i < n; i++) {
      plats.push(this.makePlatform(centers[i], y, Utils.rand(76, 98)));
    }
    this.rows.push({ y, plats, isChoice: false, charIndex: -1 });
    this.platforms.push.apply(this.platforms, plats);
    this.sinceChoice++;
    this.nextY += CFG.LAYER_GAP;
  }

  makePlatform(x, y, w) {
    return {
      x, y, w, h: CFG.PLAT_H,
      char: null, isChoice: false, correct: false, consumed: false,
      dead: false, breaking: 0, bounceT: 0, revealed: false,
    };
  }

  /** 单向碰撞：从 prevY 落到 newY 时是否踩上某平台 */
  landingCheck(prevY, newY, x) {
    let best = null;
    for (const p of this.platforms) {
      if (p.dead || p.breaking > 0) continue;
      if (prevY <= p.y + 2 && newY >= p.y) {
        if (Math.abs(x - p.x) <= p.w / 2 + 6) {
          if (!best || p.y < best.y) best = p;
        }
      }
    }
    return best;
  }

  /** 玩家下方是否还有"当前进度字"的有效文字层 */
  upcomingRow(playerY) {
    let best = null;
    for (const r of this.rows) {
      if (!r.isChoice || r.charIndex !== this.progress) continue;
      if (r.y <= playerY - 10) continue;
      const ok = r.plats.some((p) => p.isChoice && !p.consumed && p.breaking <= 0 && !p.dead);
      if (ok && (!best || r.y < best.y)) best = r;
    }
    return best;
  }

  /** 玩家坠落错过当前字的文字层：碎掉下方文字层，从当前进度继续（进度不清零） */
  recoverMissed(playerY) {
    if (this.progress >= 4) return false;
    if (this.upcomingRow(playerY)) return false;
    this.clearBelow(playerY, this.progress);
    return true;
  }

  /** 碎掉玩家下方全部文字层并从 fromIndex 字重建（错过/错选时 fromIndex=当前进度） */
  clearBelow(fromY, fromIndex) {
    const keepRows = [];
    for (const row of this.rows) {
      if (row.y > fromY) {
        for (const p of row.plats) this.breakPlatform(p);
      } else {
        keepRows.push(row);
      }
    }
    this.rows = keepRows;
    this.platforms = this.platforms.filter((p) => !p.dead);
    // 从保留的最深一行之下重新生成（且必须位于玩家下方，避免长空档/倒挂层）
    let deepest = fromY;
    for (const row of keepRows) deepest = Math.max(deepest, row.y);
    this.nextY = Math.max(deepest + CFG.LAYER_GAP, fromY + CFG.LAYER_GAP * 0.9);
    this.lastChoiceY = 0;
    for (const row of keepRows) {
      if (row.isChoice) this.lastChoiceY = Math.max(this.lastChoiceY, row.y);
    }
    this.genIndex = fromIndex;
    this.sinceChoice = 0;
  }

  breakPlatform(p) {
    if (p.dead) return;
    p.breaking = 0.0001;
    Effects.debris(p.x, p.y, p.w, PALETTE.platform);
    if (p.isChoice && p.char && !p.consumed) {
      Effects.floatText(p.x, p.y - 18, p.char, "rgba(200,190,220,0.8)", 14);
    }
  }

  update(dt) {
    for (const p of this.platforms) {
      if (p.bounceT > 0) p.bounceT -= dt * 3;
      if (p.breaking > 0) {
        p.breaking += dt;
        if (p.breaking > 0.6) p.dead = true;
      }
    }
    if (this.platforms.length > 90) {
      this.platforms = this.platforms.filter((p) => !p.dead);
    }
  }

  prune(topY) {
    if (this.rows.length < 6) return;
    const cut = topY - 140;
    this.rows = this.rows.filter((r) => r.y > cut);
    this.platforms = this.platforms.filter((p) => p.y > cut || p.y === 200);
  }

  /** 排雷锤：碎掉下方 N 个文字层中的错误平台 */
  removeWrongBelow(fromY, layers) {
    const choiceRows = this.rows
      .filter((r) => r.isChoice && r.y > fromY)
      .sort((a, b) => a.y - b.y)
      .slice(0, layers);
    let count = 0;
    for (const row of choiceRows) {
      for (const p of row.plats) {
        if (p.isChoice && !p.correct && !p.consumed && p.breaking <= 0) {
          this.breakPlatform(p);
          count++;
        }
      }
    }
    return count;
  }

  /** 下一个目标平台（用于闪烁箭头提示） */
  nextTarget(fromY) {
    if (this.progress >= 4) return null;
    const want = this.idiom.w[this.progress];
    const rows = this.rows.filter((r) => r.isChoice && r.charIndex === this.progress && r.y > fromY - 10)
      .sort((a, b) => a.y - b.y);
    const row = rows[0];
    if (!row) return null;
    for (const p of row.plats) {
      if (p.isChoice && !p.consumed && p.breaking <= 0 && p.char === want) return p;
    }
    return null;
  }

  roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  drawButterfly(ctx, x, y, time) {
    const flap = Math.abs(Math.sin(time * 9));
    ctx.save();
    ctx.translate(x, y + Math.sin(time * 3) * 3);
    ctx.rotate(-0.12);
    // 双翅
    ctx.fillStyle = "#eaa58c";
    ctx.beginPath(); ctx.ellipse(-5, -2, 5.5 * flap + 1.5, 6.5, -0.35, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, -2, 5.5 * flap + 1.5, 6.5, 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f4d3bf";
    ctx.beginPath(); ctx.ellipse(-3.5, -1, 2.6 * flap + 1, 3.6, -0.35, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3.5, -1, 2.6 * flap + 1, 3.6, 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#5a4f45";
    ctx.fillRect(-1, -5, 2, 10);
    ctx.restore();
  }

  draw(ctx, cam, time) {
    const target = this.nextTarget(cam.y - 40);
    for (const p of this.platforms) {
      const sy = p.y - cam.y;
      if (sy < -50 || sy > CFG.H + 50) continue;
      let alpha = 1;
      if (p.breaking > 0) {
        const q = Math.min(1, p.breaking / 0.6);
        alpha = 1 - q;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      const bounce = p.bounceT > 0 ? Math.sin(p.bounceT * Math.PI) : 0;
      const h = p.h + bounce * 3;
      const yOff = p.breaking > 0 ? p.breaking * 90 : 0;
      const py = sy + (p.h - h) + yOff;
      const px = p.x - p.w / 2;

      // 浮石投影
      ctx.globalAlpha = alpha * 0.18;
      ctx.fillStyle = "#5a6a52";
      this.roundRect(ctx, px + 3, py + 5, p.w, h, 8);
      ctx.fill();

      // 浮石主体（圆角渐变石板）
      ctx.globalAlpha = alpha * (p.consumed ? 0.5 : 1);
      const g = ctx.createLinearGradient(0, py, 0, py + h);
      g.addColorStop(0, PALETTE.slabTop);
      g.addColorStop(0.55, PALETTE.slabMid);
      g.addColorStop(1, PALETTE.slabDk);
      ctx.fillStyle = g;
      this.roundRect(ctx, px, py, p.w, h, 8);
      ctx.fill();
      // 顶部高光
      ctx.fillStyle = PALETTE.slabHi;
      ctx.globalAlpha = alpha * (p.consumed ? 0.4 : 0.9);
      this.roundRect(ctx, px + 3, py + 1.5, p.w - 6, 3, 2);
      ctx.fill();
      // 石上草叶
      if (!p.consumed) {
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = PALETTE.grass1;
        this.roundRect(ctx, px + 10, py - 3.5, 16, 5, 3); ctx.fill();
        ctx.fillStyle = PALETTE.grass2;
        this.roundRect(ctx, px + p.w - 28, py - 3, 14, 4.5, 3); ctx.fill();
      }

      // 汉字（书法体 + 白衬影）
      if (p.char && !p.consumed) {
        ctx.globalAlpha = alpha;
        ctx.font = "24px " + FONT_CAL;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,.6)";
        ctx.fillText(p.char, p.x, py - 16 + 1.5 + bounce * 2);
        ctx.fillStyle = PALETTE.ink;
        ctx.fillText(p.char, p.x, py - 16 + bounce * 2);
      }
      ctx.restore();
    }

    // 当前目标：朱批椭圆圈 + 引路蝶
    if (target) {
      const sy = target.y - cam.y;
      const pulse = 0.55 + 0.3 * Math.sin(time * 4);
      ctx.save();
      // 金晕浮石
      ctx.globalAlpha = 0.35 * pulse + 0.2;
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 3.5;
      this.roundRect(ctx, target.x - target.w / 2 - 3, sy - 3, target.w + 6, target.h + 6, 10);
      ctx.stroke();
      // 朱批圈（圈住目标字）
      ctx.globalAlpha = 0.5 + 0.4 * pulse;
      ctx.strokeStyle = PALETTE.cinnabar;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(target.x, sy - 16, 16, 14.5, -0.14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // 引路蝶（上方盘旋）
      this.drawButterfly(ctx, target.x, sy - 44, time);
    }

    // 排雷锤后正确平台金圈提示
    for (const p of this.platforms) {
      if (!(p.isChoice && p.correct && p.revealed && !p.consumed && p.breaking <= 0)) continue;
      const sy = p.y - cam.y;
      if (sy < -40 || sy > CFG.H + 40) continue;
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.25 * Math.sin(time * 5);
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, sy - 16, 16, 14.5, -0.14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

window.World = World;
