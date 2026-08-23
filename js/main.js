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
    if (q && q.length === 4) {
      GAME.forcedIdiom = q;
      IdiomDB.ensureFull();  // 强制词可能只在全量库，立即按需加载
    }
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
    if (window.Tuning) Tuning.init();

    // 首次加载门：书法字体等资源全部就绪才放行开局（弱网 8 秒兜底）
    // 加载句轮换：或备笔墨，或点卷首故事的起笔
    const LOAD_TIPS = [
      "展卷中 · 备好笔墨纸砚",
      "那一夜，书生从梦里跌了出去。",
      "别急，一个字一个字来。",
    ];
    const loadTip = dom("load-tip");
    if (loadTip) loadTip.textContent = Utils.choice(LOAD_TIPS);
    const LoadGate = window.LoadGate = {
      done: false,
      _queue: [],
      whenReady(fn) { this.done ? fn() : this._queue.push(fn); },
      finish() {
        if (this.done) return;
        this.done = true;
        const ov = dom("load-overlay");
        if (ov) ov.classList.add("done");
        const q = this._queue; this._queue = [];
        q.forEach((fn) => { try { fn(); } catch (e) { } });
      },
    };
    (function waitLoad() {
      let fin = () => LoadGate.finish();
      try {
        if (document.fonts && document.fonts.load) {
          // 显式请求书法字体（开始界面文字用到它，触发加载），完成后再等全部字体就绪
          Promise.all([document.fonts.load("1em 'Ma Shan Zheng'")])
            .then(() => document.fonts.ready)
            .then(fin, fin);
        } else {
          setTimeout(fin, 0);
        }
      } catch (e) { setTimeout(fin, 0); }
      window.addEventListener("load", fin); // 其余资源兜底
      setTimeout(fin, 8000);                // 弱网兜底：最多等 8 秒
      // 开局就绪后后台预热全量书法字体（预热字来自 build 生成的 js/data/font-warm.js，属 B−A 生僻字，
      // 触发第二条 @font-face 的 unicode-range 分支下载全量子集）
      LoadGate.whenReady(() => {
        setTimeout(() => {
          try {
            if (document.fonts && document.fonts.load && window.FONT_WARM_CHAR) {
              document.fonts.load("1em 'Ma Shan Zheng'", window.FONT_WARM_CHAR);
            }
          } catch (e) { }
        }, 2500);
      });
    })();
    const canvas = dom("game-canvas");
    GAME.init(canvas);
    GAME.hud = HUD;
    refreshBest();
    refreshMute();

    // 开始（加载完成前禁止开局）
    dom("btn-start").addEventListener("click", () => {
      if (!LoadGate.done) return;
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

    // 卷首缘起（世界背景）
    dom("btn-lore").addEventListener("click", () => { SoundFX.play("click"); show("overlay-lore"); });
    dom("btn-lore-close").addEventListener("click", () => { SoundFX.play("click"); hide("overlay-lore"); });

    // 全局按键
    window.addEventListener("keydown", (e) => {
      // 缘起卡开着时，Esc / Enter 先合上卷首（避免回车穿透开局）
      const lore = dom("overlay-lore");
      if (lore && !lore.classList.contains("hidden") &&
        (e.code === "Escape" || e.code === "Enter")) {
        hide("overlay-lore");
        return;
      }
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

    // 自动开局（演示/自动化验收）——等加载门放行
    if (autostart) {
      LoadGate.whenReady(() => {
        setTimeout(() => {
          if (GAME.state === "start" && !dom("screen-start").classList.contains("hidden")) {
            SoundFX.muted = true;
            hide("screen-start");
            show("screen-game");
            GAME.startRun();
          }
        }, 200);
      });
    }

    console.log("《成语下落》已启动 · 词库", IdiomDB.all.length, "条");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
