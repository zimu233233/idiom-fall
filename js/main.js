"use strict";
/* 启动：初始化词库/HUD/游戏，绑定按钮与全局按键 */
(function () {
  function dom(id) { return document.getElementById(id); }
  function show(id) { dom(id).classList.remove("hidden"); }
  function hide(id) { dom(id).classList.add("hidden"); }

  // 运行时错误可视化：便于发现与定位问题
  window.addEventListener("error", (e) => {
    const el = dom("toast");
    if (el) {
      el.textContent = "运行错误：" + (e.message || "unknown");
      el.classList.add("show");
    }
    console.error(e.error || e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const el = dom("toast");
    if (el) {
      el.textContent = "异步错误：" + (e.reason && e.reason.message ? e.reason.message : e.reason);
      el.classList.add("show");
    }
  });

  function refreshBest() {
    try {
      const best = parseInt(localStorage.getItem("cydl_best") || "0", 10);
      const el = dom("start-best");
      if (el) el.textContent = best > 0 ? "最高积分：" + best : "";
    } catch (e) { }
  }

  function refreshMute() {
    const label = SoundFX.muted ? "音效：关" : "音效：开";
    const b1 = dom("btn-mute-start"), b2 = dom("btn-mute-game");
    if (b1) b1.textContent = label;
    if (b2) b2.textContent = label;
  }

  function toStart() {
    hide("screen-over");
    hide("screen-game");
    hide("overlay-pause");
    show("screen-start");
    GAME.state = "start";
    refreshBest();
  }

  function boot() {
    SoundFX.boot();
    IdiomDB.init();

    // 调试：?q=画龙点睛 指定首个成语；?debug=1 输出词库抽样
    // ?autostart=1 自动开局；?demo=play|wrong|idle 演示自动驾驶（自动化验收用）
    const params = new URLSearchParams(location.search);
    const q = params.get("q");
    if (q && q.length === 4) GAME.forcedIdiom = q;
    const demoMode = params.get("demo");
    if (demoMode === "play" || demoMode === "wrong" || demoMode === "idle") {
      GAME.demoMode = demoMode;
    }
    if (params.get("debug") === "1") {
      for (let i = 0; i < 10; i++) {
        const e = Utils.choice(IdiomDB.all);
        console.log("[词库抽样]", e[0], e[1], e[2]);
      }
      console.log("[词库] 全量", IdiomDB.all.length, "常用", IdiomDB.common.length,
        "字池", IdiomDB.charPool.length);
    }
    const autostart = params.get("autostart") === "1";

    HUD.init();
    const canvas = dom("game-canvas");
    GAME.init(canvas);
    GAME.hud = HUD;
    refreshBest();
    refreshMute();

    // 开始
    dom("btn-start").addEventListener("click", () => {
      SoundFX.ensure();
      SoundFX.play("click");
      hide("screen-start");
      hide("screen-over");
      show("screen-game");
      GAME.startRun();
    });

    // 暂停/继续
    dom("btn-pause").addEventListener("click", () => {
      if (GAME.state === "play") { GAME.pause(); SoundFX.play("click"); }
      else if (GAME.state === "pause") { GAME.resume(); SoundFX.play("click"); }
    });
    dom("btn-resume").addEventListener("click", () => { GAME.resume(); SoundFX.play("click"); });
    dom("btn-quit").addEventListener("click", () => { SoundFX.play("click"); toStart(); });

    // 结算
    dom("btn-again").addEventListener("click", () => {
      SoundFX.play("click");
      Settlement.hide();
      hide("screen-start");
      show("screen-game");
      GAME.startRun();
    });
    dom("btn-share").addEventListener("click", () => Settlement.share());
    dom("btn-back-start").addEventListener("click", () => { SoundFX.play("click"); toStart(); });

    // 静音
    dom("btn-mute-start").addEventListener("click", () => { SoundFX.toggleMute(); refreshMute(); });
    dom("btn-mute-game").addEventListener("click", () => { SoundFX.toggleMute(); refreshMute(); });

    // 全局按键
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyP" || e.code === "Escape") {
        if (GAME.state === "play") GAME.pause();
        else if (GAME.state === "pause") GAME.resume();
      } else if (e.code === "KeyM") {
        SoundFX.toggleMute(); refreshMute();
      } else if (e.code === "Digit1") GAME.useItem("clock");
      else if (e.code === "Digit2") GAME.useItem("hammer");
      else if (e.code === "Digit3") GAME.useItem("leaf");
      else if (e.code === "Enter") {
        if (GAME.state === "start" && !dom("screen-start").classList.contains("hidden")) {
          dom("btn-start").click();
        } else if (GAME.state === "over" && !dom("screen-over").classList.contains("hidden")) {
          Settlement.hide();
          show("screen-game");
          GAME.startRun();
        }
      }
    });

    // 按键视觉响应（底部提示高亮）
    window.addEventListener("keydown", (e) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") HUD.flashDir(true, false);
      if (e.code === "ArrowRight" || e.code === "KeyD") HUD.flashDir(false, true);
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") HUD.flashDir(false, Input.held.right);
      if (e.code === "ArrowRight" || e.code === "KeyD") HUD.flashDir(Input.held.left, false);
    });

    // 切后台自动暂停（演示模式除外）
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && GAME.state === "play" && !GAME.demoMode) GAME.pause();
    });

    // 自动开局（演示/自动化验收）
    if (autostart) {
      setTimeout(() => {
        if (GAME.state === "start" && !dom("screen-start").classList.contains("hidden")) {
          SoundFX.muted = true;
          hide("screen-start");
          show("screen-game");
          GAME.startRun();
        }
      }, 400);
    }

    console.log("《成语下落》已启动 · 词库", IdiomDB.all.length, "条");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
