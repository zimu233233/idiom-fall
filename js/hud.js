"use strict";
/* HUD：顶部成语进度条（4格+拼音释义）、左栏战绩、右栏道具与历史、移动端浮动面板 */
const HUD = {
  els: {},
  _lastSlots: -1,

  init() {
    const ids = [
      "idiom-slots", "idiom-pinyin", "idiom-expl",
      "stat-score", "stat-combo", "stat-mult", "stat-depth", "stat-idioms", "stat-coins",
      "hp-fill", "hp-num",
      "inv-clock", "inv-hammer", "inv-leaf", "history-list",
      "boost-pill", "slow-pill",
      "m-stat", "m-items", "m-hp-fill", "m-score", "m-combo", "m-depth",
      "hint-left", "hint-right",
    ];
    ids.forEach((id) => {
      this.els[id] = document.getElementById(id);
    });
    // 道具点击使用
    const bindUse = (id, kind) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", () => {
        if (window.GAME && GAME.state === "play") GAME.useItem(kind);
      });
    };
    bindUse("inv-clock", "clock");
    bindUse("inv-hammer", "hammer");
    bindUse("inv-leaf", "leaf");
    const bindUseM = (id, kind) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", () => {
        if (window.GAME && GAME.state === "play") GAME.useItem(kind);
      });
    };
    bindUseM("m-clock", "clock");
    bindUseM("m-hammer", "hammer");
    bindUseM("m-leaf", "leaf");
  },

  setIdiom(idiom, progress) {
    const slots = this.els["idiom-slots"];
    if (!slots) return;
    if (this._curWord !== idiom.w || slots.childElementCount !== 4) {
      slots.innerHTML = "";
      for (let i = 0; i < 4; i++) {
        const d = document.createElement("div");
        d.className = "idiom-slot";
        slots.appendChild(d);
      }
      this._curWord = idiom.w;
    }
    const kids = slots.children;
    for (let i = 0; i < 4; i++) {
      const el = kids[i];
      el.textContent = i < progress ? idiom.w[i] : "";
      el.className = "idiom-slot" +
        (i < progress ? " lit" : "") +
        (i === progress ? " next" : "");
    }
    if (this.els["idiom-pinyin"]) {
      this.els["idiom-pinyin"].textContent = idiom.p || "";
    }
    if (this.els["idiom-expl"]) {
      this.els["idiom-expl"].textContent = idiom.e ? "释义：" + idiom.e : "";
    }
  },

  update(game) {
    const S = game.scoring, W = game.world;
    const set = (id, v) => {
      const el = this.els[id];
      if (el && el.textContent !== String(v)) el.textContent = v;
    };
    set("stat-score", Math.floor(S.score));
    set("stat-combo", S.combo);
    set("stat-mult", "×" + S.multiplier().toFixed(2));
    set("stat-depth", game.depthM().toFixed(0) + " m");
    set("stat-idioms", S.idioms);
    set("stat-coins", S.coins);
    set("inv-clock", Items.inv.clock);
    set("inv-hammer", Items.inv.hammer);
    set("inv-leaf", Items.inv.leaf);
    set("m-clock", Items.inv.clock);
    set("m-hammer", Items.inv.hammer);
    set("m-leaf", Items.inv.leaf);
    set("m-score", Math.floor(S.score));
    set("m-combo", "×" + S.multiplier().toFixed(2));
    set("m-depth", game.depthM().toFixed(0) + "m");

    // 生命条
    const pct = Utils.clamp(S.hp / CFG.HP_MAX, 0, 1);
    const color = pct > 0.5 ? PALETTE.hp : (pct > 0.25 ? PALETTE.hpWarn : PALETTE.hpBad);
    const fill = this.els["hp-fill"];
    if (fill) {
      fill.style.width = (pct * 100).toFixed(1) + "%";
      fill.style.background = color;
    }
    const mfill = this.els["m-hp-fill"];
    if (mfill) {
      mfill.style.width = (pct * 100).toFixed(1) + "%";
      mfill.style.background = color;
    }
    set("hp-num", Math.ceil(Math.max(0, S.hp)));

    // 状态胶囊
    const bp = this.els["boost-pill"];
    if (bp) {
      if (S.boostT > 0) {
        bp.classList.remove("hidden");
        set("boost-pill", "学富五车 ×2 " + S.boostT.toFixed(1) + "s");
      } else bp.classList.add("hidden");
    }
    const sp = this.els["slow-pill"];
    if (sp) {
      if (game.slowT > 0) {
        sp.classList.remove("hidden");
        set("slow-pill", "减速中 " + game.slowT.toFixed(1) + "s");
      } else sp.classList.add("hidden");
    }

    // 进度条槽位同步
    if (W && W.idiom) this.setIdiom(W.idiom, W.progress);
  },

  pushHistory(idiom) {
    const list = this.els["history-list"];
    if (!list) return;
    const li = document.createElement("li");
    li.className = "history-item slide-in";
    const w = document.createElement("span");
    w.className = "hw"; w.textContent = idiom.w;
    const p = document.createElement("span");
    p.className = "hp"; p.textContent = idiom.p;
    li.appendChild(w); li.appendChild(p);
    list.insertBefore(li, list.firstChild);
    while (list.childElementCount > 12) list.removeChild(list.lastChild);
  },

  clearHistory() {
    const list = this.els["history-list"];
    if (list) list.innerHTML = "";
  },

  flashDir(left, right) {
    const l = this.els["hint-left"], r = this.els["hint-right"];
    if (l) l.classList.toggle("active", !!left);
    if (r) r.classList.toggle("active", !!right);
  },
};

window.HUD = HUD;
