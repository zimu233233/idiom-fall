"use strict";
/* 道具系统：金币掉落 + 减速表/排雷锤/生命树叶；右栏库存使用 */
const Items = {
  DEFS: {
    clock: { name: "减速表", desc: "下落减速 5 秒", color: "#7ec8ff" },
    hammer: { name: "排雷锤", desc: "清除下方4层错误平台", color: "#ffb347" },
    leaf: { name: "生命树叶", desc: "立即恢复 30 生命", color: "#3ddc84" },
  },

  inv: { clock: 0, hammer: 0, leaf: 0 },
  drops: [],

  reset() {
    this.inv = { clock: 0, hammer: 0, leaf: 0 };
    this.drops = [];
  },

  /** 成语通关时在主角下方掉落金币/道具 */
  maybeDrop(x, y) {
    const coins = Utils.randInt(1, 2);
    for (let i = 0; i < coins; i++) {
      this.drops.push(this.makeDrop(x + Utils.rand(-30, 30), y + 30, "coin"));
    }
    if (Utils.chance(CFG.ITEM_CHANCE)) {
      const kind = Utils.choice(["clock", "hammer", "leaf"]);
      this.drops.push(this.makeDrop(x + Utils.rand(-20, 20), y + 46, kind));
    }
  },

  makeDrop(x, y, kind) {
    return { x, y, vy: 40, kind, t: 0 };
  },

  update(dt, player, game) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      d.vy = Math.min(d.vy + 500 * dt, 230);
      d.y += d.vy * dt;
      d.x += Math.sin(d.t * 4) * 12 * dt;
      // 与主角碰撞（捡拾）
      if (Math.abs(d.x - player.x) < 24 && Math.abs(d.y - (player.y - 14)) < 30) {
        this.collect(d, game);
        this.drops.splice(i, 1);
        continue;
      }
      // 掉出视野销毁
      if (d.y - game.cam.y > CFG.H + 60) this.drops.splice(i, 1);
    }
  },

  collect(d, game) {
    if (d.kind === "coin") {
      Scoring.addCoin();
      Effects.burst(d.x, d.y, PALETTE.gold, 8, 150);
      Effects.floatText(d.x, d.y - 12, "+" + CFG.SCORE_COIN, PALETTE.gold, 13);
      SoundFX.play("coin");
    } else {
      this.inv[d.kind]++;
      const def = this.DEFS[d.kind];
      Effects.burst(d.x, d.y, def.color, 14, 200);
      Effects.floatText(d.x, d.y - 12, def.name + " ×1", def.color, 14);
      SoundFX.play("item");
    }
    game.hud.update(game);
  },

  use(kind, game) {
    if (this.inv[kind] <= 0) return false;
    const def = this.DEFS[kind];
    if (kind === "clock") {
      game.slowT = CFG.SLOW_TIME;
      Effects.flash("#7ec8ff", 0.18, 0.4);
      Effects.floatText(game.player.x, game.player.y - 60, "时间凝滞！", def.color, 15);
    } else if (kind === "hammer") {
      const n = game.world.removeWrongBelow(game.player.y, CFG.HAMMER_LAYERS);
      game.world.rows.forEach((r) => {
        if (r.isChoice) r.plats.forEach((p) => { if (p.isChoice && p.correct && !p.consumed) p.revealed = true; });
      });
      game.cam.triggerShake(4);
      Effects.floatText(game.player.x, game.player.y - 60, "排雷锤！扫除" + n + "个错字", def.color, 15);
    } else if (kind === "leaf") {
      Scoring.heal(CFG.HP_LEAF);
      Effects.burst(game.player.x, game.player.y - 20, "#3ddc84", 18, 200);
      Effects.floatText(game.player.x, game.player.y - 60, "+" + CFG.HP_LEAF + " 生命", "#3ddc84", 15);
    }
    this.inv[kind]--;
    SoundFX.play("item");
    game.hud.update(game);
    return true;
  },

  draw(ctx, cam, time) {
    for (const d of this.drops) {
      const sy = d.y - cam.y;
      if (sy < -30 || sy > CFG.H + 30) continue;
      const bob = Math.sin(time * 5 + d.x) * 2;
      ctx.save();
      ctx.translate(d.x, sy + bob);
      if (d.kind === "coin") {
        // 方孔铜钱
        ctx.fillStyle = "#b28a45";
        ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#d9b36c";
        ctx.beginPath(); ctx.arc(0, 0, 5.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fdfaf2";
        ctx.fillRect(-1.8, -1.8, 3.6, 3.6);
        ctx.strokeStyle = "#b28a45"; ctx.lineWidth = 0.8;
        ctx.strokeRect(-1.8, -1.8, 3.6, 3.6);
      } else if (d.kind === "clock") {
        ctx.fillStyle = "#274068";
        ctx.fillRect(-7, -7, 14, 14);
        ctx.fillStyle = "#7ec8ff";
        ctx.fillRect(-5, -5, 10, 10);
        ctx.fillStyle = "#12233c";
        ctx.fillRect(-1, -4, 1, 4); ctx.fillRect(-1, -1, 3, 1);
      } else if (d.kind === "hammer") {
        ctx.fillStyle = "#8a5a2a";
        ctx.fillRect(-1, -2, 3, 9);
        ctx.fillStyle = "#ffb347";
        ctx.fillRect(-7, -8, 15, 7);
        ctx.fillStyle = "#c88430";
        ctx.fillRect(-7, -3, 15, 2);
      } else if (d.kind === "leaf") {
        ctx.fillStyle = "#2a8a56";
        ctx.beginPath();
        ctx.ellipse(0, 0, 8, 4, Math.sin(time * 2) * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#3ddc84";
        ctx.fillRect(-6, -1, 12, 1.6);
      }
      ctx.restore();
    }
  },
};

window.Items = Items;
