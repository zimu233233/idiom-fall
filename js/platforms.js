"use strict";
/* 世界：成语文字层生成（每层3个带字平台：1正2误 + 无字平台）、碰撞、碎裂、进度重置重建 */
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

  /** 碎掉玩家下方全部文字层并从 fromIndex 字重建（错误时 fromIndex=0，错过时=当前进度） */
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

  /** 选错字：进度归零并碎掉下方文字层重建 */
  rebuildBelow(fromY) {
    this.progress = 0;
    this.clearBelow(fromY, 0);
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

  draw(ctx, cam, time) {
    const target = this.nextTarget(cam.y - 40);
    for (const p of this.platforms) {
      const sy = p.y - cam.y;
      if (sy < -40 || sy > CFG.H + 40) continue;
      let alpha = 1;
      if (p.breaking > 0) {
        const q = Math.min(1, p.breaking / 0.6);
        alpha = 1 - q;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      // 落地压弹（中观反馈）
      const bounce = p.bounceT > 0 ? Math.sin(p.bounceT * Math.PI) : 0;
      const h = p.h + bounce * 4;
      const yOff = p.breaking > 0 ? p.breaking * 140 : 0;
      const py = sy + (p.h - h) + yOff;

      // 平台主体（靛蓝 + 像素描边）
      ctx.fillStyle = PALETTE.platformEdge;
      ctx.fillRect(Math.round(p.x - p.w / 2) - 2, Math.round(py) - 2, Math.round(p.w) + 4, Math.round(h) + 4);
      ctx.fillStyle = p.consumed ? "#2a3260" : PALETTE.platform;
      ctx.fillRect(Math.round(p.x - p.w / 2), Math.round(py), Math.round(p.w), Math.round(h));
      ctx.fillStyle = p.consumed ? "#39406e" : PALETTE.platformLit;
      ctx.fillRect(Math.round(p.x - p.w / 2), Math.round(py), Math.round(p.w), 3);
      // 像素方角缺口
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.clearRect(Math.round(p.x - p.w / 2) - 2, Math.round(py) - 2, 3, 3);
      ctx.clearRect(Math.round(p.x + p.w / 2) - 1, Math.round(py) - 2, 3, 3);

      // 汉字
      if (p.char && !p.consumed) {
        ctx.font = "bold 21px 'Microsoft YaHei', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = PALETTE.text;
        ctx.fillText(p.char, p.x, py - 12 + bounce * 2);
      }
      // 排雷锤后正确平台泛光提示
      if (p.isChoice && p.correct && p.revealed && !p.consumed) {
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 6);
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 2;
        ctx.strokeRect(Math.round(p.x - p.w / 2) - 3, Math.round(py) - 20, Math.round(p.w) + 6, 20);
      }
      ctx.restore();
    }
    // 目标平台闪烁箭头（可玩性提示）
    if (target) {
      const sy = target.y - cam.y;
      const blink = 0.45 + 0.4 * Math.sin(time * 5);
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.fillStyle = PALETTE.gold;
      const ax = target.x, ay = sy - 34 + Math.sin(time * 5) * 3;
      ctx.beginPath();
      ctx.moveTo(ax - 7, ay - 8); ctx.lineTo(ax + 7, ay - 8); ctx.lineTo(ax, ay + 2);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(ax - 2, ay - 16, 4, 8);
      ctx.restore();
    }
  }
}

window.World = World;
