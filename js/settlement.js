"use strict";
/* 结算：按深度/成语数/正确率生成动态评语（组合约千种变体）、分享（Web Share / 截图下载降级） */
const Settlement = {
  // 每档含多条备选文案，随机组合 → 变体规模约数十万种
  TITLES: [
    [0, "白丁书生", ["初入字渊，墨色未沾衣。", "字渊浅浅，先湿了鞋。"]],
    [500, "童生初试", ["认得半卷字，前路犹可期。", "笔下生涩，眼力尚浅。"]],
    [1500, "县学秀才", ["笔下渐有墨香，渊中渐闻书声。", "落字成阶，步步生风。"]],
    [3000, "乡试举人", ["一字一阶，落出了气魄。", "深渊回望，皆是来路。"]],
    [6000, "贡士登科", ["深渊见底不敢言，君落深处字自成行。", "墨浪翻涌处，书生自巍然。"]],
    [12000, "进士及第", ["满纸成语如星落，书生踏字若平地。", "字渊千丈，不过书房一隅。"]],
    [25000, "翰林大学士", ["字渊之主，从今日换人做了。", "此后深渊见君，须称先生。"]],
  ],
  DEPTH_LINES: [
    [0, ["不过刚沾了沾深渊的墨气。", "渊口的风还在耳边。"]],
    [100, ["已在字渊中落出百米，墨风扑面。", "百米之下，字影初现。"]],
    [300, ["三百米深处，字影渐密、灯影渐稀。", "三百米处，连回声都带着墨味。"]],
    [600, ["六百米！此处的成语已开始生僻。", "六百米深处，古字在暗中发光。"]],
    [1000, ["千米之下，唯闻笔锋破空之声。", "千米之渊，人间灯火已成传说。"]],
  ],
  ACC_LINES: [
    [0, ["字字皆险，全凭运气护体。", "落点豪放，命运起伏。"]],
    [0.6, ["眼力尚可，偶有失足。", "十字之中，偶有一失。"]],
    [0.8, ["认字精准，落点沉稳。", "目之所及，皆是我字。"]],
    [0.93, ["火眼金睛，几无错字！", "错字见君，绕道而行。"]],
  ],
  EXTRA_LINES: [
    "字渊传闻：深处有以「之乎者也」为食的墨鱼。",
    "字渊传闻：曾有人在此拼出《康熙字典》全文。",
    "字渊传闻：每落对一个字，深渊便亮一分。",
    "书生日记：今日又少写了三斤错别字。",
    "深渊公告：连击越高，墨光照越远。",
    "书生心得：先读拼音，再落脚下。",
    "深渊公告：停滞者的平台，由墨蚁搬运工负责拆除。",
    "书生心得：滑翔时记得欣赏两边的字壁。",
    "字渊传闻：排雷锤的锤柄取自仓颉的笔杆。",
    "深渊公告：连续完美者，将获得渊主的金光加持。",
    "书生心得：生僻字也是字，别怕它。",
    "字渊传闻：渊底什么都没有，但有回程的电梯（并没有）。",
  ],
  TIPS: [
    "小贴士：按住左右键（或持续滑动）可张开书卷滑翔减速。",
    "小贴士：连击每 +1 提升 0.25 倍积分，上限 3.5 倍，别让连击断掉。",
    "小贴士：连续 3 个成语零失误零停滞，触发「学富五车」双倍积分。",
    "小贴士：平台上停留超过 3 秒会碎裂，果断决策。",
    "小贴士：选对一字 +0.5 生命，选错 -3，时间就是生命。",
    "小贴士：金币与道具会在通关成语后掉落，下落时顺路接住。",
    "小贴士：排雷锤能扫掉下方四层的全部错字平台。",
    "小贴士：顶部进度条有拼音和释义，先读题再落笔。",
  ],

  lastStats: null,
  shareBlobUrl: null,

  pickTier(list, v) {
    let idx = 0;
    for (let i = 0; i < list.length; i++) if (v >= list[i][0]) idx = i;
    return list[idx];
  },

  genComment(s) {
    const title = this.pickTier(this.TITLES, s.score);
    const depth = this.pickTier(this.DEPTH_LINES, s.depth);
    const acc = this.pickTier(this.ACC_LINES, s.accuracy);
    const tip = Utils.choice(this.TIPS);
    const lines = [
      "深度 " + s.depth.toFixed(0) + " 米 · 成语 " + s.idioms + " 个 · 积分 " + s.score,
      Utils.choice(title[2]),
      Utils.choice(depth[1]),
      Utils.choice(acc[1]),
    ];
    if (Utils.chance(0.7)) lines.push(Utils.choice(this.EXTRA_LINES));
    lines.push(tip);
    return { title: title[1], lines };
  },

  show(stats) {
    this.lastStats = stats;
    const screen = document.getElementById("screen-over");
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(v);
    };
    set("over-score", stats.score);
    set("over-depth", stats.depth.toFixed(0) + " m");
    set("over-idioms", stats.idioms + " 个");
    set("over-acc", (stats.accuracy * 100).toFixed(0) + "%");
    set("over-wrong", stats.wrongs + " 次");
    set("over-combo", "×" + stats.bestCombo);
    set("over-coins", stats.coins);
    const c = this.genComment(stats);
    set("over-title", "【" + c.title + "】");
    const body = document.getElementById("over-comment");
    if (body) body.innerHTML = c.lines.map((l) => "<p>" + l + "</p>").join("");
    const bestEl = document.getElementById("over-best");
    if (bestEl) bestEl.classList.toggle("hidden", !stats.isBest);
    // 关闭暂停遮罩（若开着）
    const ov = document.getElementById("overlay-pause");
    if (ov) ov.classList.add("hidden");
    if (screen) screen.classList.remove("hidden");
    this.buildShareCard(stats, c);
  },

  hide() {
    const screen = document.getElementById("screen-over");
    if (screen) screen.classList.add("hidden");
  },

  /** 生成分享卡片（Canvas 绘制结算画面） */
  buildShareCard(stats, comment) {
    const W = 600, H = 860;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    // 背景
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#170b14");
    grad.addColorStop(1, "#321426");
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#3a4a8c"; g.lineWidth = 4;
    g.strokeRect(14, 14, W - 28, H - 28);
    g.textAlign = "center";
    g.fillStyle = "#ffd447";
    g.font = "bold 52px 'Microsoft YaHei', sans-serif";
    g.fillText("成语下落", W / 2, 96);
    g.fillStyle = "#cbb8e8";
    g.font = "22px 'Microsoft YaHei', sans-serif";
    g.fillText(comment.title, W / 2, 140);
    // 数据块
    const rows = [
      ["积分", String(stats.score)], ["深度", stats.depth.toFixed(0) + " m"],
      ["成语", stats.idioms + " 个"], ["正确率", (stats.accuracy * 100).toFixed(0) + "%"],
    ];
    g.font = "bold 30px 'Microsoft YaHei', sans-serif";
    rows.forEach((r, i) => {
      const x = W / 2 + (i % 2 === 0 ? -140 : 140);
      const y = 220 + Math.floor(i / 2) * 90;
      g.fillStyle = "#8f86b8"; g.font = "20px 'Microsoft YaHei', sans-serif";
      g.fillText(r[0], x, y);
      g.fillStyle = "#f3ecd8"; g.font = "bold 34px 'Microsoft YaHei', sans-serif";
      g.fillText(r[1], x, y + 40);
    });
    // 评语
    g.textAlign = "left";
    g.fillStyle = "#cbb8e8";
    g.font = "22px 'Microsoft YaHei', sans-serif";
    comment.lines.forEach((l, i) => {
      g.fillText(l, 60, 460 + i * 38);
    });
    g.textAlign = "center";
    g.fillStyle = "#6a5f8a";
    g.font = "18px 'Microsoft YaHei', sans-serif";
    g.fillText("—— 在「成语深渊」落下你的名字 ——", W / 2, H - 60);

    this._shareCanvas = c;
  },

  async share() {
    const stats = this.lastStats;
    if (!stats) return;
    const c = this._shareCanvas;
    const text = "我在《成语下落》落到 " + stats.depth.toFixed(0) + " 米深处，拼出 " +
      stats.idioms + " 个成语，积分 " + stats.score + "！来挑战我吧！";
    // 优先 Web Share API（可带图）
    try {
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      const file = new File([blob], "成语下落-结算.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "成语下落", text });
        this.toastMsg("已调起系统分享");
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "成语下落", text });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return; // 用户取消
      // 落入降级路径
    }
    // 降级：下载结算图 + 复制文案（file:// 或不支持 Web Share）
    try {
      const a = document.createElement("a");
      a.download = "成语下落-结算.png";
      a.href = c.toDataURL("image/png");
      a.click();
    } catch (e) { }
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e2) { copied = false; }
    }
    this.toastMsg(copied ? "结算图已下载，文案已复制，去粘贴分享吧！" : "结算图已下载，快分享给好友！");
  },

  toastMsg(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2400);
  },
};

window.Settlement = Settlement;
