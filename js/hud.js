"use strict";
/* HUD · 青绿手卷：印章进度、气息战绩、连击珠、旅程里程碑、多宝阁、词笺、成语图鉴、手机数据带与抽屉 */
const HUD = {
  els: {},
  _curWord: null,
  _segIdx: -1,

  init() {
    const ids = [
      "idiom-slots", "idiom-pinyin", "idiom-expl",
      "stat-score", "stat-combo", "stat-mult", "stat-depth", "stat-idioms", "stat-coins",
      "hp-fill", "hp-num",
      "inv-clock", "inv-hammer", "inv-leaf", "inv-clock-row", "inv-hammer-row", "inv-leaf-row",
      "history-list", "boost-pill", "boost-pill-t", "slow-pill",
      "m-hp-fill", "m-score", "m-combo", "m-depth", "m-idioms",
      "m-clock", "m-hammer", "m-leaf",
      "combo-beads", "mult-ribbon", "mult-next", "seg-sub", "milenote",
      "album-count", "album-bar", "album-note",
      "slip-cur", "slip-cur-prog",
      "hint-left", "hint-right",
    ];
    ids.forEach((id) => { this.els[id] = document.getElementById(id); });
    this.mileNodes = Array.prototype.slice.call(
      document.querySelectorAll("#mile-list .ms"));

    // 道具点击使用（桌面 + 手机）
    [["inv-clock-row", "clock"], ["inv-hammer-row", "hammer"], ["inv-leaf-row", "leaf"],
     ["m-clock", "clock"], ["m-hammer", "hammer"], ["m-leaf", "leaf"]]
      .forEach(([id, kind]) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("click", () => {
          if (window.GAME && GAME.state === "play") GAME.useItem(kind);
        });
      });

    // 手机抽屉
    const panel = document.getElementById("panel-right");
    const scrim = document.getElementById("drawer-scrim");
    const openBtn = document.getElementById("btn-drawer");
    const closeBtn = document.getElementById("btn-drawer-close");
    const open = (v) => {
      if (!panel) return;
      panel.classList.toggle("open", v);
      if (scrim) scrim.classList.toggle("hidden", !v);
      if (closeBtn) closeBtn.classList.toggle("show", v);
    };
    if (openBtn) openBtn.addEventListener("click", () => open(true));
    if (closeBtn) closeBtn.addEventListener("click", () => open(false));
    if (scrim) scrim.addEventListener("click", () => open(false));
    this.closeDrawer = () => open(false);
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
    // 拼音分色：已收=石绿 · 当前=朱砂下划线 · 未收=灰
    const py = this.els["idiom-pinyin"];
    if (py) {
      const syls = (idiom.p || "").split(/\s+/).filter(Boolean);
      if (syls.length === 4) {
        py.innerHTML = "";
        syls.forEach((s, i) => {
          const sp = document.createElement("span");
          sp.className = i < progress ? "py-d" : (i === progress ? "py-c" : "py-f");
          sp.textContent = s;
          py.appendChild(sp);
          if (i < 3) py.appendChild(document.createTextNode(" "));
        });
      } else {
        py.textContent = idiom.p || "";
      }
    }
    if (this.els["idiom-expl"]) {
      this.els["idiom-expl"].textContent = idiom.e ? idiom.e : "";
    }
    // 词笺当前条
    this.set("slip-cur", idiom.w);
    this.set("slip-cur-prog", progress + " / 4…");
  },

  set(id, v) {
    const el = this.els[id];
    if (el && el.textContent !== String(v)) el.textContent = v;
  },

  update(game) {
    const S = game.scoring, W = game.world;
    this.set("stat-score", Math.floor(S.score));
    this.set("stat-combo", S.combo);
    this.set("stat-mult", "×" + S.multiplier().toFixed(2));
    this.set("stat-depth", game.depthM().toFixed(0));
    this.set("stat-idioms", S.idioms);
    this.set("stat-coins", S.coins);
    this.set("inv-clock", Items.inv.clock);
    this.set("inv-hammer", Items.inv.hammer);
    this.set("inv-leaf", Items.inv.leaf);
    this.set("m-clock", "⏱×" + Items.inv.clock);
    this.set("m-hammer", "🔨×" + Items.inv.hammer);
    this.set("m-leaf", "🌿×" + Items.inv.leaf);
    this.set("m-score", Math.floor(S.score));
    this.set("m-combo", "×" + S.multiplier().toFixed(2));
    this.set("m-depth", game.depthM().toFixed(0) + "丈");
    this.set("m-idioms", S.idioms + "语");
    // 道具槽有无量显示
    [["inv-clock-row", "clock"], ["inv-hammer-row", "hammer"], ["inv-leaf-row", "leaf"]]
      .forEach(([id, k]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("has", Items.inv[k] > 0);
      });

    // 气息：血越少条色连续趋向朱砂（绿→赭→红两段插值）
    const pct = Utils.clamp(S.hp / CFG.HP_MAX, 0, 1);
    const t = 1 - pct;
    const c1 = t <= 0.5
      ? Utils.lerpColor("#8fb08a", "#d9b36c", t / 0.5)
      : Utils.lerpColor("#d9b36c", "#c0574b", (t - 0.5) / 0.5);
    const c2 = t <= 0.5
      ? Utils.lerpColor("#b7d0a0", "#e6c98d", t / 0.5)
      : Utils.lerpColor("#e6c98d", "#d3776b", (t - 0.5) / 0.5);
    const color = "linear-gradient(90deg," + c1 + "," + c2 + ")";
    const fill = this.els["hp-fill"];
    if (fill) { fill.style.width = (pct * 100).toFixed(1) + "%"; fill.style.background = color; }
    const mfill = this.els["m-hp-fill"];
    if (mfill) { mfill.style.width = (pct * 100).toFixed(1) + "%"; mfill.style.background = color; }
    this.set("hp-num", Math.ceil(Math.max(0, S.hp)));

    // 连击珠 + 倍率绶带
    const beads = this.els["combo-beads"];
    if (beads) {
      const n = beads.children.length;
      for (let i = 0; i < n; i++) beads.children[i].classList.toggle("on", i < Math.min(S.combo, n));
    }
    const rib = this.els["mult-ribbon"];
    if (rib) rib.style.width = (((S.multiplier() - 1) / (CFG.COMBO_MAX - 1)) * 100).toFixed(1) + "%";
    this.set("mult-next", S.multiplier() >= CFG.COMBO_MAX ? "已达上限 ×3.50"
      : "再连1字 ×" + Math.min(CFG.COMBO_MAX, 1 + (S.combo + 1) * CFG.COMBO_STEP).toFixed(2));

    // 状态：学富五车金印 / 减速
    const bp = this.els["boost-pill"], bt = this.els["boost-pill-t"];
    if (bp) bp.classList.toggle("hidden", !(S.boostT > 0));
    if (bt) {
      bt.classList.toggle("hidden", !(S.boostT > 0));
      this.set("boost-pill-t", "收益 ×2 · " + S.boostT.toFixed(0).padStart(2, "0") + "s");
    }
    const sp = this.els["slow-pill"];
    if (sp) {
      if (game.slowT > 0) { sp.classList.remove("hidden"); this.set("slow-pill", "减速中 " + game.slowT.toFixed(1) + "s"); }
      else sp.classList.add("hidden");
    }

    // 旅程段落 + 段落副题 + 里程碑
    const seg = Utils.segmentAt(game.depthM());
    this.set("seg-sub", "青绿手卷 · " + seg.sub);
    if (this._segIdx !== seg.index) {
      this._segIdx = seg.index;
      this.mileNodes.forEach((nd) => {
        const i = parseInt(nd.getAttribute("data-i"), 10);
        nd.classList.toggle("done", i < seg.index);
        nd.classList.toggle("now", i === seg.index);
      });
      const next = CFG.SEGMENTS[seg.index + 1];
      this.set("milenote", next
        ? "深入「" + next.name + "」后，画卷将染" + next.sub + " ✦"
        : "已至「深潭」，星蓝尽收眼底 ✦");
    }

    // 成语图鉴（本局收录 / 108）
    this.set("album-count", S.idioms);
    const bar = this.els["album-bar"];
    if (bar) bar.style.width = Math.min(100, (S.idioms / CFG.ALBUM_TOTAL) * 100).toFixed(1) + "%";

    // 进度条同步
    if (W && W.idiom) this.setIdiom(W.idiom, W.progress);
  },

  pushHistory(idiom) {
    const list = this.els["history-list"];
    if (list) {
      const li = document.createElement("li");
      li.className = "history-item slide-in";
      const w = document.createElement("span");
      w.className = "hw"; w.textContent = idiom.w + " ✓";
      const p = document.createElement("span");
      p.className = "hp"; p.textContent = idiom.p;
      li.appendChild(w); li.appendChild(p);
      list.insertBefore(li, list.firstChild);
      while (list.childElementCount > 9) list.removeChild(list.lastChild);
    }
    this.set("album-note", "收录「" + idiom.w + "」入卷");
  },

  clearHistory() {
    const list = this.els["history-list"];
    if (list) list.innerHTML = "";
    this.set("album-note", "集齐四字，成语入卷");
  },

  flashDir(left, right) {
    const l = this.els["hint-left"], r = this.els["hint-right"];
    if (l) l.classList.toggle("active", !!left);
    if (r) r.classList.toggle("active", !!right);
  },
};

window.HUD = HUD;
