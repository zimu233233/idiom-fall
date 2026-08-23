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
    // 难度段 = 按深度累计 + 分区加成（每跨越一个画卷分区额外 +SEG_DIFF_STEP 段，0=关闭梯度）
    let segIdx = 0;
    const segs = CFG.SEGMENTS;
    for (let i = 0; i < segs.length; i++) if (this.depthM() >= segs[i].from) segIdx = i;
    return Math.min(99, 1 + Math.floor(this.depthM() / CFG.STAGE_M) + segIdx * (CFG.SEG_DIFF_STEP || 0));
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
    let r = Utils.drainRate(this.depthM());
    if (Scoring.boostT > 0) r *= 0.5;
    return r;
  },

  startRun(forced) {
    SoundFX.ensure();
    Scoring.reset();
    Items.reset();
    Effects.reset();
    this.cam.reset();
    this.cam.depth = 0;
    Input.reset();
    this.time = 0;
    this.slowT = 0;
    this.celebrateT = 0;
    if (HUD.closeDrawer) HUD.closeDrawer();
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
    // 游戏进行中、或"抽屉冻结"期间可用道具（多宝阁就在抽屉里）；手动暂停/结算不可用
    if (this.state !== "play" && this._drawerPause !== true) return;
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

  pause(silent) {
    if (this.state !== "play") return;
    this.state = "pause";
    if (silent) return; // 静默冻结（手机抽屉）：不弹暂停遮罩
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
    this.cam.depth = this.depthM();

    // 进入最后常用段即预载全量词库（按需加载，休闲玩家不触达则不下载）
    if (!IdiomDB.full && this.stage() >= CFG.COMMON_UNTIL_STAGE) IdiomDB.ensureFull();

    // 学富五车期间银杏叶随行飘落
    if (Scoring.boostT > 0 && Utils.chance(dt * 2.2)) {
      Effects.ginkgo(this.player.x + Utils.rand(-30, 30), this.cam.y + Utils.rand(20, 120), 1);
    }

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
    Effects.burst(plat.x, plat.y - 10, PALETTE.mineral, 12, 190);
    Effects.inkDissolve(plat.x, plat.y - 10, plat.char);
    Effects.floatText(plat.x, plat.y - 34, "+" + gain, PALETTE.mineralDk, 19);
    if (Scoring.combo >= 2) {
      Effects.floatText(this.player.x, this.player.y - 52,
        "连击 ×" + Scoring.combo + " · " + Scoring.multiplier().toFixed(2) + "倍", "#9c7a35", 15);
    }
    SoundFX.play("correct");
    this.world.breakPlatform(plat);   // 正确字平台化作墨花消散
    this.player.bounceUp(430);        // 主角小跳一下
    this.world.progress++;
    HUD.setIdiom(this.world.idiom, this.world.progress);
    if (this.world.progress >= 4) this.onIdiomComplete();
  },

  onIdiomComplete() {
    const r = Scoring.onIdiomComplete(this.world.perfect);
    Effects.glow(this.player.x, this.player.y - 20, "rgba(222,186,105,0.5)", 130, 0.9);
    Effects.ginkgo(this.player.x, this.player.y - 30, 10);
    Effects.burst(this.player.x, this.player.y - 20, PALETTE.gold, 16, 240);
    Effects.floatText(this.player.x, this.player.y - 70,
      this.world.idiom.w + "！ +" + r.base, PALETTE.mineralDk, 22);
    SoundFX.play("complete");
    this.celebrateT = 0.8; // 加速进入下一段落
    Items.maybeDrop(this.player.x, this.player.y);
    HUD.pushHistory(this.world.idiom);
    this.world.setIdiom(IdiomDB.pickIdiom(this.stage()));
    HUD.setIdiom(this.world.idiom, 0);
    if (r.triggerBoost) {
      Effects.glow(this.player.x, this.player.y - 20, "rgba(233,201,120,0.55)", 220, 1.2);
      Effects.ginkgo(this.player.x, this.player.y - 40, 16);
      Effects.floatText(this.player.x, this.player.y - 100, "学富五车 · 收益翻倍", "#9c7a35", 21);
      SoundFX.play("boost");
      this.toast("学富五车：短时间内下坠减缓、收益翻倍");
    }
  },

  onWrong(plat) {
    const pen = Utils.wrongPenalty(this.depthM());
    Scoring.onWrong(pen);
    this.world.perfect = false;
    // 柔化反馈：涟漪轻荡，无红闪无震屏
    Effects.ripple(plat.x, plat.y - 14);
    Effects.burst(plat.x, plat.y - 10, "#8fa6ad", 10, 150);
    const penText = Number.isInteger(pen) ? String(pen) : pen.toFixed(1);
    Effects.floatText(plat.x, plat.y - 36, "涟漪散字 · -" + penText, PALETTE.cinnabar, 16);
    SoundFX.play("wrong");
    this.world.breakPlatform(plat);
    this.player.bounceUp(CFG.BOUNCE_V); // 弹回上一层
    // 成语进度保留：碎掉下方文字层，从当前进度字重建（与错过层同机制）
    this.world.clearBelow(this.player.y + 40, this.world.progress);
    HUD.setIdiom(this.world.idiom, this.world.progress);
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
    Effects.ripple(this.player.x, this.player.y - 6);
    Effects.floatText(this.player.x, this.player.y - 50, "浮石自沉 · -" + CFG.HP_STALL, "#8d8672", 15);
    // 停滞只碎平台扣血清连击，成语进度保留，落回下方文字层继续
  },

  endRun() {
    if (this.state === "over") return;
    this.state = "over";
    SoundFX.play("over");
    Effects.flash("rgba(120,100,60,0.35)", 0.4, 0.9);
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
    // 学富五车：暖金光晕环随行（无全屏爆闪）
    if (Scoring.boostT > 0 && this.player) {
      const px = this.player.x, py = this.player.y - 26 - cam.y;
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 5);
      const g = ctx.createRadialGradient(px, py, 6, px, py, 78);
      g.addColorStop(0, "rgba(233,201,120," + (0.34 * pulse) + ")");
      g.addColorStop(1, "rgba(233,201,120,0)");
      ctx.fillStyle = g;
      ctx.fillRect(px - 78, py - 78, 156, 156);
      ctx.globalAlpha = 0.35 * pulse;
      ctx.strokeStyle = "rgba(194,161,99,.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, 62, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 通关加速：淡淡暖光
    if (this.celebrateT > 0) {
      ctx.globalAlpha = 0.07 * (this.celebrateT / 0.8);
      ctx.fillStyle = "#e9c978";
      ctx.fillRect(-20, -20, CFG.W + 40, CFG.H + 40);
      ctx.globalAlpha = 1;
    }
    this.player.draw(ctx, cam, this.time);
    Effects.draw(ctx, cam);
    // 低生命：极淡朱砂脉动提示（克制的呼吸感）
    if (this.state === "play" && Scoring.hp < 25) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      const vg = ctx.createRadialGradient(CFG.W / 2, CFG.H / 2, CFG.H * 0.34, CFG.W / 2, CFG.H / 2, CFG.H * 0.72);
      vg.addColorStop(0, "rgba(192,87,75,0)");
      vg.addColorStop(1, "rgba(192,87,75," + (0.16 * pulse) + ")");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, CFG.W, CFG.H);
    }
    ctx.restore();
  },
};

window.GAME = Game;
