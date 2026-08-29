"use strict";
/* 文思直通：墨池能量（正常玩法选对 +1、选错 -0.5）蓄满 16 触发——
   竖排揭示成语 → 双栏二选一速答（无正确提示）→ 能量按时间耗尽回归正常。
   直通中所有生命扣除（错字惩罚与时间消耗）按 RUSH_HP_MULT 减半；
   生命归零延迟到直通结束再结算。 */
const Rush = {
  energy: 0,
  active: false,
  phase: "idle",       // idle | reveal | await | falling | bounce | beat | ending
  t: 0,
  idiom: null,         // 直通当前成语 {w,p,e}
  charIdx: 0,
  rushPerfect: true,   // 本条直通成语零失误
  baseY: 0,            // 等待线（主角悬停的世界 y）
  rowPlats: null,      // {left, right}
  correctSide: 0,      // -1 左 / 1 右
  drainRate: 0,
  deferredDeath: false,
  _drained: false,     // 能量已归零：等当前成语念完再结束直通

  reset() {
    this.energy = 0; this.active = false; this.phase = "idle";
    this.t = 0; this.idiom = null; this.charIdx = 0; this.rushPerfect = true;
    this.baseY = 0; this.rowPlats = null; this.correctSide = 0;
    this.drainRate = 0; this.deferredDeath = false; this._drained = false;
  },

  /* ---- 正常玩法钩子（game.onCorrect/onWrong 调用） ---- */
  addCorrect() {
    if (this.active) return false;
    this.energy = Math.min(CFG.RUSH_NEED, this.energy + 1);
    return this.energy >= CFG.RUSH_NEED;
  },
  addWrong() {
    if (this.active) return;
    this.energy = Math.max(0, this.energy - CFG.RUSH_ENERGY_WRONG);
  },

  /* ---- 触发直通 ---- */
  start(game) {
    if (this.active) return;
    this.active = true;
    this.deferredDeath = false;
    this._drained = false;
    this.drainRate = CFG.RUSH_NEED / (8 * CFG.RUSH_CHAR_SEC);
    game.celebrateT = 0;
    // 放弃当前未完成成语，换新成语作为直通首条（perfectStreak 不受影响）
    this.idiom = IdiomDB.pickIdiom(game.stage());
    game.world.setIdiom(this.idiom);
    HUD.setIdiom(this.idiom, 0);
    this.charIdx = 0;
    this.rushPerfect = true;
    this._beginReveal(game, false);   // 定等待线、归位主角并清空全部常规平台
    SoundFX.play("boost");
    game.toast("墨池满溢 · 文思直通");
  },

  /* 揭示阶段入场：主角归位等待线，场景冻结 */
  _beginReveal(game, keepBase) {
    this.phase = "reveal";
    this.t = 0;
    this._clearRow(game);
    // 首次揭示：等待线定在画面上方；换条揭示：保持在落字处高度（连续下坠）
    this.baseY = keepBase ? game.player.y : game.cam.y + CFG.H * 0.16;
    this._clearField(game);
    const pl = game.player;
    pl.x = CFG.W / 2; pl.y = this.baseY;
    pl.vx = 0; pl.vy = 0;
    pl.grounded = false; pl.ground = null; pl.standT = 0; pl.jumpBufT = 0;
  },

  /* 直通画面只保留 rush 双栏：常规字层/无字层全部移除；
     nextY 推到画面地平线之外——即使有残留的生成调用也造不出视野内的常规层 */
  _clearField(game) {
    game.world.platforms = game.world.platforms.filter((p) => p.isRush || p.y === 200);
    game.world.rows = [];
    game.world.nextY = this.baseY + CFG.H * 2;
  },

  REVEAL_HOLD: 2,      // 揭示完四字后的停顿时长（秒）

  _revealDur() { return 4 * 0.18 + this.REVEAL_HOLD + 0.3; },

  /* ---- 帧驱动：返回是否放开主角物理（仅 falling/bounce） ---- */
  update(dt, game) {
    // 能量按时间消耗（揭示/收尾阶段暂停）；归零不立即结束——等当前成语念完再收
    if (this.phase === "falling" || this.phase === "bounce" || this.phase === "beat") {
      this.energy -= this.drainRate * dt;
      if (this.energy <= 0) {
        this.energy = 0;
        this._drained = true;
      }
    }
    this.t += dt;
    switch (this.phase) {
      case "reveal":
        if (this.t >= this._revealDur()) {
          this._spawnRow(game);
          this.phase = "falling"; this.t = 0;   // 揭示完即开始下坠（无悬停）
          Effects.glow(game.player.x, game.player.y - 20, "rgba(222,186,105,0.6)", 90, 0.6);
        }
        return false;
      case "falling": {
        // 持续下坠：途中按左右随时横移换栏（不重置垂直速度，不打断下坠）
        const jumps = Input.consumeJumps();
        let dir = 0;
        for (const j of jumps) dir = j.dir;
        if (dir) {
          const side = dir < 0 ? this.rowPlats.left : this.rowPlats.right;
          this._laneShift(game, side);
          SoundFX.play("jump");
        }
        return true;
      }
      case "falling":
        Input.consumeJumps();  // 丢弃坠落途中的误触，落台不缓冲跳跃
        return true;
      case "bounce":
        Input.consumeJumps();
        if (this.t >= CFG.RUSH_BOUNCE_WAIT) {
          const correct = this.correctSide < 0 ? this.rowPlats.left : this.rowPlats.right;
          this._flashTo(game, correct);
          this.phase = "falling"; this.t = 0;
          SoundFX.play("jump");
        }
        return true;
      case "beat":
        if (this.t >= CFG.RUSH_BEAT) {
          // 回中到落字高度，随即继续下坠（无悬停）；下一对生成在下方
          this.baseY = game.player.y;
          this._clearRow(game);
          this._spawnRow(game);
          this._flashTo(game, { x: CFG.W / 2 });
          game.player.y = this.baseY;
          this.phase = "falling"; this.t = 0;
        }
        return false;
      case "ending":
        if (this.t >= 0.6) this._finish(game);
        return false;
    }
    return false;
  },

  /* 闪现：金色光晕双向 + 归位（vy 清零——用于回中/反弹纠正） */
  _flashTo(game, plat) {
    Effects.glow(game.player.x, game.player.y - 16, "rgba(222,186,105,0.45)", 46, 0.35);
    game.player.x = plat.x;
    game.player.vx = 0; game.player.vy = 0;
    game.player.grounded = false; game.player.ground = null;
    Effects.glow(plat.x, game.player.y - 16, "rgba(222,186,105,0.6)", 70, 0.5);
  },

  /* 坠落中换栏：纯横移，保留垂直速度（连按也不会变成悬停） */
  _laneShift(game, plat) {
    if (game.player.x === plat.x) return;
    Effects.glow(game.player.x, game.player.y - 16, "rgba(222,186,105,0.35)", 36, 0.25);
    game.player.x = plat.x;
    game.player.vx = 0;
    game.player.grounded = false; game.player.ground = null;
    Effects.glow(plat.x, game.player.y - 16, "rgba(222,186,105,0.5)", 56, 0.4);
  },

  /* ---- 双栏生成（不入 rows → nextTarget/朱批圈/引路蝶全部失效） ---- */
  _spawnRow(game) {
    const w = game.world;
    const y = this.baseY + CFG.RUSH_DROP;
    const correctChar = this.idiom.w[this.charIdx];
    const dis = IdiomDB.makeDistractors(correctChar, this.idiom.w.split(""), game.stage(), 1);
    let wrongChar = dis[0];
    if (!wrongChar) {
      const alt = IdiomDB.charPool.filter((c) => c !== correctChar);
      wrongChar = alt.length ? Utils.choice(alt) : "之";
    }
    this.correctSide = Utils.chance(0.5) ? -1 : 1;
    // 双栏铺满横面：左右各半幅、边缘贴画布，中间无缝——人物不能从旁边越过去
    const lx = CFG.RUSH_PLAT_W / 2;
    const rx = CFG.W - CFG.RUSH_PLAT_W / 2;
    const mk = (x, ch, ok) => {
      const p = w.makePlatform(x, y, CFG.RUSH_PLAT_W);
      p.char = ch; p.isChoice = true; p.correct = ok; p.isRush = true;
      return p;
    };
    const left = mk(lx, this.correctSide < 0 ? correctChar : wrongChar, this.correctSide < 0);
    const right = mk(rx, this.correctSide > 0 ? correctChar : wrongChar, this.correctSide > 0);
    // 随机入列：无输入坠到中缝时，落到哪一栏 50/50（不偏袒左侧）
    Utils.shuffle([left, right]).forEach((p) => w.platforms.push(p));
    this.rowPlats = { left, right };
  },

  /* ---- 落台判定（game.onLand 在直通中转交于此） ---- */
  onLand(plat, game) {
    game.player.jumpBufT = 0;
    if (plat.correct) this._resolveCorrect(plat, game);
    else this._resolveWrong(plat, game);
  },

  _resolveCorrect(plat, game) {
    const gain = Scoring.onCorrect();
    plat.consumed = true;
    Effects.burst(plat.x, plat.y - 10, PALETTE.mineral, 12, 190);
    Effects.inkDissolve(plat.x, plat.y - 10, plat.char);
    Effects.floatText(plat.x, plat.y - 34, "+" + gain, PALETTE.mineralDk, 19);
    if (Scoring.combo >= 2) {
      Effects.floatText(game.player.x, game.player.y - 52,
        "连击 ×" + Scoring.combo + " · " + Scoring.multiplier().toFixed(2) + "倍", "#9c7a35", 15);
    }
    SoundFX.play("correct");
    game.world.breakPlatform(plat);
    // 同高度的错字平台一同消散（双栏成对碎裂）
    const other = plat === this.rowPlats.left ? this.rowPlats.right : this.rowPlats.left;
    if (other && !other.dead && other.breaking <= 0 && !other.consumed) {
      game.world.breakPlatform(other);
    }
    game.world.progress++;
    this.charIdx++;
    HUD.setIdiom(this.idiom, game.world.progress);
    if (this.charIdx >= 4) this._idiomDone(game);
    else { this.phase = "beat"; this.t = 0; }
  },

  _resolveWrong(plat, game) {
    const pen = Utils.wrongPenalty(game.depthM()) * CFG.RUSH_HP_MULT;
    Scoring.onWrong(pen);
    this.rushPerfect = false;
    Effects.ripple(plat.x, plat.y - 14);
    Effects.burst(plat.x, plat.y - 10, "#8fa6ad", 10, 150);
    const penText = Number.isInteger(pen) ? String(pen) : pen.toFixed(1);
    Effects.floatText(plat.x, plat.y - 36, "涟漪散字 · -" + penText, PALETTE.cinnabar, 16);
    SoundFX.play("wrong");
    game.world.breakPlatform(plat);
    game.player.bounceUp(430);
    this.phase = "bounce"; this.t = 0;
  },

  _idiomDone(game) {
    const r = Scoring.onIdiomComplete(this.rushPerfect);
    Effects.glow(game.player.x, game.player.y - 20, "rgba(222,186,105,0.5)", 130, 0.9);
    Effects.burst(game.player.x, game.player.y - 20, PALETTE.gold, 16, 240);
    Effects.floatText(game.player.x, game.player.y - 70,
      this.idiom.w + "！ +" + r.base, PALETTE.mineralDk, 22);
    SoundFX.play("complete");
    HUD.pushHistory(this.idiom);
    if (r.triggerBoost) {
      // 学富五车与直通叠加：收益翻倍即生效，缓坠/耗减半在直通结束后继续
      Effects.floatText(game.player.x, game.player.y - 100, "学富五车 · 收益翻倍", "#9c7a35", 21);
      SoundFX.play("boost");
    }
    // 能量已尽的最后一条：本条念完即收尾，不再揭示下一条
    if (this._drained) { this._endNow(game); return; }
    this.idiom = IdiomDB.pickIdiom(game.stage());
    game.world.setIdiom(this.idiom);
    HUD.setIdiom(this.idiom, 0);
    this.charIdx = 0;
    this.rushPerfect = true;
    this._beginReveal(game, true);   // 再次竖排揭示下一条
  },

  /* ---- 收尾 ---- */
  _endNow(game) {
    this.phase = "ending";
    this.t = 0;
    Effects.flash("rgba(222,186,105,0.22)", 0.3, 0.6);
    SoundFX.play("item");
  },

  _finish(game) {
    this._clearRow(game);
    const keepY = game.player.y;
    game.world.nextY = keepY + CFG.LAYER_GAP;   // 从主角当前位置重新向下生成
    game.world.clearBelow(keepY + 40, 0);
    game.world.setIdiom(IdiomDB.pickIdiom(game.stage()));
    HUD.setIdiom(game.world.idiom, 0);
    const pl = game.player;
    pl.x = CFG.W / 2; pl.vx = 0; pl.vy = 0;
    pl.grounded = false; pl.ground = null; pl.jumpBufT = 0;
    this.active = false;
    this.phase = "idle";
    this.energy = 0;
    game.toast("文思渐歇 · 落卷续行");
    // 直通中生命曾归零：无论后续答对回血与否，直通结束即结算（终局性）
    if (this.deferredDeath) {
      Scoring.hp = 0;
      game.endRun();
    }
  },

  _clearRow(game) {
    if (this.rowPlats) {
      for (const p of [this.rowPlats.left, this.rowPlats.right]) {
        if (p && !p.dead && p.breaking <= 0) game.world.breakPlatform(p);
      }
    }
    game.world.platforms = game.world.platforms.filter((p) => !p.isRush);
    this.rowPlats = null;
  },

  /* ---- 覆盖层：揭示阶段宣纸薄纱 + 竖排大字；直通中淡金氛围 ---- */
  drawVeil(ctx) {
    if (!this.active) return;
    ctx.save();
    if (this.phase === "reveal" && this.idiom) {
      ctx.fillStyle = "rgba(246,241,229,0.55)";
      ctx.fillRect(-20, -20, CFG.W + 40, CFG.H + 40);
      const dur = 4 * 0.18, hold = this.REVEAL_HOLD, fade = 0.3;
      let alpha = 1;
      if (this.t > dur + hold) alpha = Math.max(0, 1 - (this.t - dur - hold) / fade);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "44px " + FONT_CAL;
      const x = CFG.W / 2, y0 = CFG.H * 0.2, stepY = 64;
      for (let i = 0; i < 4; i++) {
        const t0 = i * 0.18;
        if (this.t < t0) break;
        const ia = Math.min(1, (this.t - t0) / 0.12) * alpha;
        ctx.globalAlpha = ia * 0.55;
        ctx.fillStyle = "#fdf8ee";
        ctx.fillText(this.idiom.w[i], x + 1.5, y0 + i * stepY + 1.5);
        ctx.globalAlpha = ia;
        ctx.fillStyle = PALETTE.ink;
        ctx.fillText(this.idiom.w[i], x, y0 + i * stepY);
        if (i === 3) {   // 句尾朱点
          ctx.globalAlpha = ia * 0.8;
          ctx.fillStyle = PALETTE.cinnabar;
          ctx.fillRect(x - 2, y0 + 3 * stepY + 34, 4, 4);
        }
      }
    } else if (this.phase !== "ending") {
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = "#e9c978";
      ctx.fillRect(-20, -20, CFG.W + 40, CFG.H + 40);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
};

window.Rush = Rush;
