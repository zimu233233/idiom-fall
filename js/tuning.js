"use strict";
/* 调参台：实时修改 CFG 数值。每项参数附作用说明（含义/单位/默认值/调节影响），
   改动立即写入 CFG 生效（进行中的对局同样生效）；曲线预览随改随绘；
   可保存到本机 localStorage，或导出 JSON 交给开发者固化为默认值。 */
const Tuning = {
  KEY: "cydl_tune",
  FACTORY: {},      // 出厂值快照（脚本加载时、套用本地覆盖之前记录）
  overrides: {},    // 用户改动 {key: value}
  _built: false,

  GROUPS: [
    { name: "物理 · 下落与跳跃", items: [
      { k: "GRAV", label: "重力加速度", unit: "像素/秒²", desc: "离台后下落的加速快慢；调大落得更急、跳跃回落更快，调小更飘。" },
      { k: "JUMP_V", label: "起跳速度", unit: "像素/秒", desc: "平台上首次按键垂直跳起的初速，越大跳得越高。" },
      { k: "JUMP_H", label: "起跳横速", unit: "像素/秒", desc: "起跳瞬间向左/右获得的水平速度，越大一次跳跃横移越远。" },
      { k: "JUMP_BUFFER", label: "跳跃缓冲", unit: "秒", desc: "落地前提前按键仍算起跳的容忍窗口；调大手感更宽容。" },
      { k: "AIR_ACC", label: "空中横移加速", unit: "像素/秒²", desc: "下落中按左右键横向加速的快慢。" },
      { k: "AIR_MAX", label: "空中横移上限", unit: "像素/秒", desc: "空中水平速度封顶，越大越快横穿到对岸平台。" },
      { k: "GLIDE_GRAV", label: "撑伞重力倍率", unit: "0~1", desc: "按住不放（撑伞）时重力乘该系数；越小伞降越缓，0.5 即半重力。" },
      { k: "GLIDE_TERM", label: "撑伞限速", unit: "像素/秒", desc: "撑伞状态下落的最大速度，越小悬停感越强。" },
      { k: "TERM_BASE", label: "基础极速", unit: "像素/秒", desc: "不撑伞自由下落的起始极限速度。" },
      { k: "TERM_PER_STAGE", label: "每段极速加量", unit: "像素/秒", desc: "每深入一个难度段（见「难度段长」）极速提高多少；越大后期坠得越猛。" },
      { k: "TERM_MAX", label: "极速封顶", unit: "像素/秒", desc: "自由下落速度的绝对上限。" },
      { k: "BOUNCE_V", label: "错字弹回速度", unit: "像素/秒", desc: "落错字被弹回上一层的向上初速，越大弹得越高。" },
    ]},
    { name: "平台与节奏", items: [
      { k: "LAYER_GAP", label: "层间距", unit: "像素", desc: "相邻两层平台的垂直距离；调小节奏更密、选择更急，调大更从容。" },
      { k: "MARGIN", label: "左右边距", unit: "像素", desc: "平台可分布区域距画布两边的留白。" },
      { k: "PLAT_H", label: "平台厚度", unit: "像素", desc: "浮石石板的碰撞与视觉厚度。" },
      { k: "CHAR_PLAT_W", label: "字台宽度", unit: "像素", desc: "带汉字平台的宽度，越窄落字越考验精度。" },
      { k: "STALL_TIME", label: "停留时限", unit: "秒", desc: "站在同一平台超过该时长即「浮石自沉」：扣血、清连击，但成语进度保留。" },
    ]},
    { name: "生命与惩罚", items: [
      { k: "HP_MAX", label: "生命上限", unit: "点", desc: "气息条的满值。" },
      { k: "HP_DRAIN_MIN", label: "消耗起始", unit: "点/秒", desc: "最浅处（深度 0）每秒流失的生命，即消耗曲线的起点。" },
      { k: "HP_DRAIN_MAX", label: "消耗封顶", unit: "点/秒", desc: "最深处每秒流失的生命，即消耗曲线的最高值。" },
      { k: "HP_DRAIN_FULL", label: "消耗封顶深度", unit: "丈", desc: "下坠到该深度时消耗达到最大值，此后恒定不变（900 丈 = 深潭段起点）。" },
      { k: "HP_DRAIN_SHAPE", label: "消耗曲线形态", unit: "指数", desc: "1 = 标准 S 形（前缓-中陡-后缓）；调大于 1 前期涨得更慢、陡段后移；调小更早开始爬升。配合上方预览图调整。" },
      { k: "HP_CORRECT", label: "答对回复", unit: "点", desc: "每选对一字恢复的生命。" },
      { k: "HP_STALL", label: "停滞扣血", unit: "点", desc: "浮石自沉一次扣的生命。" },
      { k: "HP_LEAF", label: "树叶回复", unit: "点", desc: "使用道具「生命树叶」恢复的生命。" },
      { k: "HP_WRONG_MIN", label: "错字扣血起始", unit: "点", desc: "最浅处落错字扣的生命（扣血曲线起点）。" },
      { k: "HP_WRONG_MAX", label: "错字扣血封顶", unit: "点", desc: "最深处落错字扣的生命（扣血曲线最高值）。" },
      { k: "WRONG_DEPTH_FULL", label: "扣血封顶深度", unit: "丈", desc: "下坠到该深度时错字扣血达到最大值，此后恒定。" },
    ]},
    { name: "计分与连击", items: [
      { k: "SCORE_CHAR", label: "单字分", unit: "分", desc: "选对一字的基础分（实际 = 基础分 × 连击倍率 × 学富五车翻倍）。" },
      { k: "SCORE_IDIOM", label: "成语通关分", unit: "分", desc: "拼完整条成语的基础通关分。" },
      { k: "SCORE_COIN", label: "铜钱分", unit: "分", desc: "每枚方孔铜钱加的分。" },
      { k: "COMBO_STEP", label: "连击步长", unit: "倍", desc: "每连对一字积分倍率提升多少（倍率 = 1 + 连击数 × 步长）。" },
      { k: "COMBO_MAX", label: "倍率上限", unit: "倍", desc: "连击倍率的封顶值。" },
    ]},
    { name: "学富五车与道具", items: [
      { k: "BOOST_NEED", label: "触发需求", unit: "条", desc: "连续多少条「零失误零停滞」成语触发学富五车。" },
      { k: "BOOST_TIME", label: "持续时长", unit: "秒", desc: "学富五车持续时间：下坠减缓、积分翻倍、生命消耗减半。" },
      { k: "ITEM_CHANCE", label: "道具掉率", unit: "0~1", desc: "每条成语通关后掉落道具的概率（0.28 = 28%）。" },
      { k: "SLOW_TIME", label: "减速表时长", unit: "秒", desc: "使用道具「减速表」后下落减缓的时长。" },
      { k: "HAMMER_LAYERS", label: "排雷锤层数", unit: "层", desc: "使用「排雷锤」清除下方几层文字层中的错误平台。" },
    ]},
    { name: "难度与词库", items: [
      { k: "STAGE_M", label: "难度段长", unit: "深度", desc: "每深入多少算一个难度段：影响极速成长、干扰字策略与词库切换。" },
      { k: "COMMON_UNTIL_STAGE", label: "常用词段数", unit: "段", desc: "前几个难度段只用 1017 条常用成语，之后进入全量 45410 条词库。" },
      { k: "ALBUM_TOTAL", label: "图鉴分母", unit: "条", desc: "右栏「成语图鉴 x/108」的分母，仅作展示目标。" },
      { k: "SEG_BLEND", label: "段落过渡宽", unit: "深度", desc: "四段山水色调（晨雾/午晴/暮色/星蓝）在边界处渐变过渡的宽度。" },
    ]},
  ],

  keys() {
    const out = [];
    this.GROUPS.forEach((g) => g.items.forEach((it) => out.push(it.k)));
    return out;
  },

  /* ---------- 开发者门 ----------
     线上部署默认对玩家隐藏：本地 file:// 始终可用；
     线上首次访问 带 ?dev=密钥 解锁并记住本机（cydl_dev），?dev=0 退出。
     密钥仅作入口隐藏，纯前端挡不住翻源码的人——介意可自行改 DEV_KEY。 */
  DEV_KEY: "砚",
  DEV_STORE: "cydl_dev",

  isDev() {
    try {
      if (typeof location !== "undefined" && location.protocol === "file:") return true;
      return localStorage.getItem(this.DEV_STORE) === "1";
    } catch (e) { return false; }
  },

  init() {
    // 出厂值快照（仅首次）
    if (!this.FACTORY.__done) {
      this.keys().forEach((k) => { this.FACTORY[k] = CFG[k]; });
      this.FACTORY.__done = true;
    }
    // ?dev=密钥 解锁 / ?dev=0 退出
    let devParam = null;
    try {
      devParam = new URLSearchParams(location.search || "").get("dev");
    } catch (e) { devParam = null; }
    try {
      if (devParam === this.DEV_KEY) localStorage.setItem(this.DEV_STORE, "1");
      else if (devParam === "0") localStorage.removeItem(this.DEV_STORE);
    } catch (e) { }
    const dev = this.isDev();

    // 读本机覆盖值并套用
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) this.overrides = JSON.parse(raw) || {};
    } catch (e) { this.overrides = {}; }
    this.applyOverrides();
    // 入口按钮：仅开发者可见
    const btn = document.getElementById("btn-tune");
    if (btn) {
      btn.classList.toggle("hidden", !dev);
      btn.addEventListener("click", () => this.toggle());
    }
    // ?tune=1 直接打开（同样仅开发者）
    if (dev && /(?:^|[?&])tune=1(?:&|$)/.test(location.search || "")) {
      this.open();
    }
  },

  applyOverrides(ov) {
    const src = ov || this.overrides;
    Object.keys(src).forEach((k) => {
      const v = src[k];
      if (k in CFG && typeof v === "number" && isFinite(v)) CFG[k] = v;
    });
  },

  applyFactory() {
    this.keys().forEach((k) => { if (k in this.FACTORY) CFG[k] = this.FACTORY[k]; });
  },

  /* ---------- 面板 ---------- */
  toggle() { this._open ? this.close() : this.open(); },
  open() {
    if (!this._built) this.build();
    this.panel.classList.remove("hidden");
    this._open = true;
    this.redrawCurves();
  },
  close() {
    if (this.panel) this.panel.classList.add("hidden");
    this._open = false;
  },

  build() {
    this._built = true;
    const panel = document.createElement("div");
    panel.id = "tune-panel";
    panel.className = "tune-panel hidden";

    // 头部
    const head = document.createElement("div");
    head.className = "tune-head";
    head.innerHTML = "<b>调参台</b><span>改动立即生效 · 进行中的对局同样生效</span>";
    const closeBtn = document.createElement("button");
    closeBtn.className = "round-btn";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());
    head.appendChild(closeBtn);
    panel.appendChild(head);

    // 曲线预览
    const curves = document.createElement("div");
    curves.className = "tune-curves";
    curves.appendChild(this.makeCurveBox("tune-curve-drain", "生命消耗 / 秒 · 随深度"));
    curves.appendChild(this.makeCurveBox("tune-curve-wrong", "错字扣血 · 随深度"));
    panel.appendChild(curves);

    // 分组参数
    const wrap = document.createElement("div");
    wrap.className = "tune-groups";
    this.GROUPS.forEach((g) => {
      const h = document.createElement("h4");
      h.textContent = g.name;
      wrap.appendChild(h);
      g.items.forEach((it) => wrap.appendChild(this.makeRow(it)));
    });
    panel.appendChild(wrap);

    // 底部操作
    const foot = document.createElement("div");
    foot.className = "tune-foot";
    const mkBtn = (id, text) => {
      const b = document.createElement("button");
      b.className = "mini-btn"; b.id = id; b.textContent = text;
      foot.appendChild(b); return b;
    };
    const saveB = mkBtn("tune-save", "保存本机");
    const resetB = mkBtn("tune-reset", "恢复默认");
    const expB = mkBtn("tune-export", "导出 JSON");
    saveB.addEventListener("click", () => this.save(saveB));
    resetB.addEventListener("click", () => this.reset(resetB));
    expB.addEventListener("click", () => this.exportJSON());
    panel.appendChild(foot);

    const box = document.createElement("textarea");
    box.id = "tune-export-box";
    box.className = "hidden";
    box.readOnly = true;
    panel.appendChild(box);

    document.body.appendChild(panel);
    this.panel = panel;
    this.inputs = panel.querySelectorAll("input[data-k]");
  },

  makeCurveBox(id, title) {
    const d = document.createElement("div");
    d.className = "tune-curve";
    const s = document.createElement("span");
    s.textContent = title;
    const c = document.createElement("canvas");
    c.id = id; c.width = 236; c.height = 100;
    d.appendChild(s); d.appendChild(c);
    return d;
  },

  makeRow(it) {
    const row = document.createElement("div");
    row.className = "tune-row";
    const lab = document.createElement("label");
    lab.innerHTML = it.label + " <small>" + it.k + "</small>";
    const box = document.createElement("div");
    box.className = "tune-in";
    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.setAttribute("data-k", it.k);
    input.value = CFG[it.k];
    const unit = document.createElement("small");
    unit.textContent = it.unit;
    box.appendChild(input); box.appendChild(unit);
    const desc = document.createElement("p");
    desc.textContent = it.desc + "（默认 " + this.FACTORY[it.k] + "）";
    row.appendChild(lab); row.appendChild(box); row.appendChild(desc);
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      if (isFinite(v)) {
        CFG[it.k] = v;
        this.overrides[it.k] = v;
        this.redrawCurves();
      }
    });
    return row;
  },

  refreshInputs() {
    if (!this.inputs) return;
    for (let i = 0; i < this.inputs.length; i++) {
      const inp = this.inputs[i];
      inp.value = CFG[inp.getAttribute("data-k")];
    }
  },

  /* ---------- 曲线预览 ---------- */
  redrawCurves() {
    if (!this.panel) return;
    this.drawCurve("tune-curve-drain", (d) => Utils.drainRate(d), CFG.HP_DRAIN_MAX, CFG.HP_DRAIN_FULL);
    this.drawCurve("tune-curve-wrong", (d) => Utils.wrongPenalty(d), CFG.HP_WRONG_MAX, CFG.WRONG_DEPTH_FULL);
  },

  drawCurve(id, fn, yMax, fullDepth) {
    const c = document.getElementById(id);
    if (!c || !c.getContext) return;
    const ctx = c.getContext();
    const W = c.width, H = c.height, XMAX = 1200;
    ctx.clearRect(0, 0, W, H);
    // 底与边框
    ctx.fillStyle = "#fdfaf2";
    ctx.fillRect(0, 0, W, H);
    // 900 丈封顶参考线
    if (fullDepth <= XMAX) {
      const gx = (fullDepth / XMAX) * (W - 8) + 4;
      ctx.strokeStyle = "rgba(58,63,68,0.25)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(gx, 4); ctx.lineTo(gx, H - 4); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 曲线
    ctx.strokeStyle = "#c0574b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const n = 80;
    for (let i = 0; i <= n; i++) {
      const d = (i / n) * XMAX;
      const x = 4 + (d / XMAX) * (W - 8);
      const y = (H - 8) - (fn(d) / yMax) * (H - 16);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 端点数值
    ctx.fillStyle = "#3a3f44";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(fn(0).toFixed(2), 6, H - 2);
    ctx.textAlign = "right";
    ctx.fillText(fn(XMAX).toFixed(2) + " (1200丈)", W - 4, H - 2);
  },

  /* ---------- 持久化 ---------- */
  save(btn) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.overrides));
      if (btn) { btn.textContent = "已保存 ✓"; setTimeout(() => { btn.textContent = "保存本机"; }, 1200); }
    } catch (e) {
      if (btn) { btn.textContent = "保存失败"; setTimeout(() => { btn.textContent = "保存本机"; }, 1200); }
    }
  },

  reset(btn) {
    this.overrides = {};
    this.applyFactory();
    try { localStorage.removeItem(this.KEY); } catch (e) {}
    this.refreshInputs();
    this.redrawCurves();
    if (btn) { btn.textContent = "已恢复 ✓"; setTimeout(() => { btn.textContent = "恢复默认"; }, 1200); }
  },

  exportJSON() {
    const box = document.getElementById("tune-export-box");
    if (!box) return;
    const diff = {};
    Object.keys(this.overrides).forEach((k) => {
      if (this.overrides[k] !== this.FACTORY[k]) diff[k] = this.overrides[k];
    });
    box.value = Object.keys(diff).length
      ? JSON.stringify(diff, null, 2) + "\n\n// 可把这段 JSON 发给开发者，固化为游戏默认值"
      : "（尚未改动任何参数）";
    box.classList.remove("hidden");
    box.select();
  },
};

window.Tuning = Tuning;
