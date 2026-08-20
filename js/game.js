"use strict";
/* 游戏主控：状态机（开始/游玩/暂停/结算）、主循环、落字判定、奖惩调度、渲染 */
const Game = {
  state: "start",   // start | play | pause | over
  canvas: null, ctx: null,
  input: null, world: null, player: null, cam: null,
  hud: HUD, scoring: Scoring,
  time: 0, lastT: 0, raf: 0,
  slowT: 0,          // 减速表
  celebrateT: 0,     // 成语通关加速下落
  forcedIdiom: null,
  _rafBound: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.input = Input;
    Input.init(canvas);
    this.cam = new Camera();
    this.player = new Player();
    this.world = new World(this);
    this._rafBound = (t) => this.loop(t);
    this.raf = requestAnimationFrame(this._rafBound);
  },

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = CFG.W * dpr;
    this.canvas.height = CFG.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  },

  stage() {
    return Math.min(99, 1 + Math.floor(this.depthM() / CFG.STAGE_M));
  },

  depthM() {
    return Math.max(0, (this.player ? this.player.y : 0) - 200) / CFG.PX_PER_M;
  },

  fallTerminal() {
    let t = CFG.TERM_BASE + (this.stage() - 1) * CFG.TERM_PER_STAGE;
    t = Math.min(t, CFG.TERM_MAX);
    if (Scoring.boostT > 0) t *= 0.55;
    return Math.max(t, 110);
  },

  hpDrainRate() {
    let r = CFG.HP_DRAIN_BASE + (this.stage() - 1) * CFG.HP_DRAIN_PER_STAGE;
    r = Math.min(r, CFG.HP_DRAIN_MAX);
    if (Scoring.boostT > 0) r *= 0.5;
    return r;
  },

  startRun(forced) {
    SoundFX.ensure();
    Scoring.reset();
    Items.reset();
    Effects.reset();
    this.cam.reset();
    Input.reset();
    this.time = 0;
    this.slowT = 0;
    this.celebrateT = 0;
    const forcedWord = forced || this.forcedIdiom || null;
    const first = IdiomDB.pickIdiom(1, forcedWord);
    this.world.reset(first);
    this.player.reset(CFG.W / 2, 200);
    this.player.grounded = true;
    this.player.ground = this.world.platforms[0];
    this.cam.y = this.player.y - CFG.H * 0.38;
    HUD.setIdiom(this.world.idiom, 0);
    HUD.clearHistory();
    HUD.update(this);
    this.state = "play";
  },

  useItem(kind) {
    if (this.state !== "play") return;
    Items.use(kind, this);
  },

  /** 演示自动驾驶（?demo=play|wrong|idle）：走真实输入/物理链路，用于演示与自动化验收 */
  demoControl() {
    const I = this.input;
    if (this.demoMode === "idle") {
      I.kb.left = I.kb.right = false;
      return;
    }
    const wantCorrect = this.demoMode !== "wrong";
    const expect = this.world.idiom.w[this.world.progress];
    const rows = this.world.rows
      .filter((r) => r.isChoice && r.charIndex === this.world.progress && r.y > this.player.y - 20)
      .sort((a, b) => a.y - b.y);
    const row = rows[0];
    let target = null;
    if (row) {
      for (const p of row.plats) {
        if (p.breaking > 0 || p.dead || p.consumed || !p.isChoice) continue;
        const isCorrect = p.char === expect;
        if (isCorrect === wantCorrect) { target = p; break; }
      }
    }
    if (!target) { I.kb.left = I.kb.right = false; return; }
    const dx = target.x - this.player.x;
    if (this.player.grounded) {
      I.kb.left = I.kb.right = false;
      I.jumps.push({ dir: dx >= 0 ? 1 : -1 });
    } else {
      I.kb.left = dx < -14;
      I.kb.right = dx > 14;
    }
  },

  pause() {
    if (this.state !== "play") return;
    this.state = "pause";
    const ov = document.getElementById("overlay-pause");
    if (ov) ov.classList.remove("hidden");
  },

  resume() {
    if (this.state !== "pause") return;
    this.state = "play";
    const ov = document.getElementById("overlay-pause");
    if (ov) ov.classList.add("hidden");
  },

  update(dt) {
    if (this.state !== "play") return;
    this.time += dt;
    if (this.slowT > 0) this.slowT = Math.max(0, this.slowT - dt);
    if (this.celebrateT > 0) this.celebrateT = Math.max(0, this.celebrateT - dt);
    Scoring.update(dt);

    if (this.demoMode) this.demoControl();
    Input.poll();
    this.player.update(dt, this);
    // 通关庆祝加速期间不做"错过"判定（正常下落追上前方层即可）
    if (this.celebrateT <= 0) this.world.recoverMissed(this.player.y);
    // 生成窗口同时覆盖相机与玩家下方（快速下落时不脱层）
    this.world.generateAhead(Math.max(this.cam.y + CFG.H * 1.7, this.player.y + CFG.H * 0.8));
    this.world.update(dt);
    this.world.prune(this.cam.y);
    Items.update(dt, this.player, this);
    Effects.update(dt);

    // 停滞判定：同一平台停留超过3秒
    if (this.player.grounded && this.player.standT >= CFG.STALL_TIME) {
      this.onStall();
    }

    // 生命随时间/深度消耗
    Scoring.drain(dt, this.hpDrainRate());
    Scoring.maxDepthM = Math.max(Scoring.maxDepthM, this.depthM());
    if (Scoring.hp <= 0) {
      Scoring.hp = 0;
      this.endRun();
      return;
    }

    this.cam.follow(this.player.y, dt);
    HUD.update(this);
  },

  onLand(plat) {
    plat.bounceT = 1;
    if (plat.isChoice && !plat.consumed && plat.breaking <= 0) {
      const expect = this.world.idiom.w[this.world.progress];
      if (plat.char === expect) this.onCorrect(plat);
      else this.onWrong(plat);
    }
  },

  onCorrect(plat) {
    const gain = Scoring.onCorrect();
    plat.consumed = true;
    Effects.burst(plat.x, plat.y - 10, PALETTE.correct, 16, 230);
    Effects.inkDissolve(plat.x, plat.y - 10, plat.char);
    Effects.floatText(plat.x, plat.y - 34, "+" + gain, PALETTE.correct, 15);
    if (Scoring.combo >= 2) {
      Effects.floatText(this.player.x, this.player.y - 52,
        "连击 ×" + Scoring.combo + "（" + Scoring.multiplier().toFixed(2) + "倍）", PALETTE.gold, 13);
    }
    SoundFX.play("correct");
    this.world.breakPlatform(plat);   // 正确字平台墨染消散
    this.player.bounceUp(430);        // 主角小跳一下
    this.world.progress++;
    HUD.setIdiom(this.world.idiom, this.world.progress);
    if (this.world.progress >= 4) this.onIdiomComplete();
  },

  onIdiomComplete() {
    const r = Scoring.onIdiomComplete(this.world.perfect);
    Effects.flash(PALETTE.gold, 0.16, 0.5);
    Effects.burst(this.player.x, this.player.y - 20, PALETTE.gold, 30, 320);
    Effects.floatText(this.player.x, this.player.y - 70,
      this.world.idiom.w + "！ +" + r.base, PALETTE.gold, 19);
    SoundFX.play("complete");
    this.celebrateT = 0.8; // 加速进入下一段落
    Items.maybeDrop(this.player.x, this.player.y);
    HUD.pushHistory(this.world.idiom);
    this.world.setIdiom(IdiomDB.pickIdiom(this.stage()));
    HUD.setIdiom(this.world.idiom, 0);
    if (r.triggerBoost) {
      Effects.flash(PALETTE.gold, 0.32, 0.8);
      Effects.floatText(this.player.x, this.player.y - 100, "学富五车！积分翻倍", PALETTE.gold, 20);
      SoundFX.play("boost");
      this.toast("学富五车：8秒内下落减缓、积分翻倍");
    }
  },

  onWrong(plat) {
    Scoring.onWrong();
    this.world.perfect = false;
    Effects.flash(PALETTE.wrong, 0.3, 0.45);
    Effects.burst(plat.x, plat.y - 10, PALETTE.wrong, 22, 280);
    Effects.floatText(plat.x, plat.y - 36, "错字！-3生命", PALETTE.wrong, 16);
    this.cam.triggerShake(9); // 仅错误时震屏
    SoundFX.play("wrong");
    this.world.breakPlatform(plat);
    this.player.bounceUp(CFG.BOUNCE_V); // 弹回上一层
    // 当前成语进度重置，下方文字层碎裂重建
    this.world.rebuildBelow(this.player.y + 40);
    HUD.setIdiom(this.world.idiom, 0);
  },

  onStall() {
    const plat = this.player.ground;
    Scoring.onStall();
    this.world.perfect = false;
    SoundFX.play("stall");
    if (plat) this.world.breakPlatform(plat);
    this.player.grounded = false;
    this.player.ground = null;
    this.player.standT = 0;
    Effects.floatText(this.player.x, this.player.y - 50, "平台碎裂！-1生命", "#c9b8e8", 15);
    // 停滞只碎平台扣血清连击，成语进度保留，落回下方文字层继续
  },

  endRun() {
    if (this.state === "over") return;
    this.state = "over";
    SoundFX.play("over");
    Effects.flash("#000000", 0.5, 0.9);
    const stats = {
      score: Math.floor(Scoring.score),
      depth: Scoring.maxDepthM,
      idioms: Scoring.idioms,
      corrects: Scoring.corrects,
      wrongs: Scoring.wrongs,
      stalls: Scoring.stalls,
      coins: Scoring.coins,
      bestCombo: Scoring.bestCombo,
      accuracy: Scoring.accuracy(),
    };
    // 最高分
    try {
      const best = parseInt(localStorage.getItem("cydl_best") || "0", 10);
      stats.isBest = stats.score > best;
      if (stats.isBest) localStorage.setItem("cydl_best", String(stats.score));
    } catch (e) { stats.isBest = false; }
    setTimeout(() => Settlement.show(stats), 900);
  },

  toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove("show"), 2200);
  },

  loop(t) {
    if (!this.lastT) this.lastT = t;
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    dt = Math.min(dt, 0.033);
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this._rafBound);
  },

  draw() {
    const ctx = this.ctx, cam = this.cam;
    if (!ctx) return;
    ctx.save();
    ctx.translate(Math.round(cam.ox), Math.round(cam.oy));
    cam.drawBackground(ctx, this.time);
    cam.drawDepthRuler(ctx);
    this.world.draw(ctx, cam, this.time);
    Items.draw(ctx, cam, this.time);
    // 学富五车金色脉动光环（宏观+微观）
    if (Scoring.boostT > 0 && this.player) {
      const px = this.player.x, py = this.player.y - 15 - cam.y;
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 7);
      const g = ctx.createRadialGradient(px, py, 4, px, py, 70);
      g.addColorStop(0, "rgba(255,212,71," + (0.32 * pulse) + ")");
      g.addColorStop(1, "rgba(255,212,71,0)");
      ctx.fillStyle = g;
      ctx.fillRect(px - 70, py - 70, 140, 140);
      // 全屏金光脉动
      ctx.globalAlpha = 0.06 * pulse;
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(-20, -20, CFG.W + 40, CFG.H + 40);
      ctx.globalAlpha = 1;
    }
    // 通关加速金光
    if (this.celebrateT > 0) {
      ctx.globalAlpha = 0.12 * (this.celebrateT / 0.8);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(-20, -20, CFG.W + 40, CFG.H + 40);
      ctx.globalAlpha = 1;
    }
    this.player.draw(ctx, cam, this.time);
    Effects.draw(ctx, cam);
    // 低生命红色警示
    if (this.state === "play" && Scoring.hp < 25) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      const vg = ctx.createRadialGradient(CFG.W / 2, CFG.H / 2, CFG.H * 0.3, CFG.W / 2, CFG.H / 2, CFG.H * 0.72);
      vg.addColorStop(0, "rgba(200,30,60,0)");
      vg.addColorStop(1, "rgba(200,30,60," + (0.35 * pulse) + ")");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, CFG.W, CFG.H);
    }
    ctx.restore();
  },
};

window.GAME = Game;
