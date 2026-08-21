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
    [100, ["已在字渊中落出百丈，墨风扑面。", "百丈之下，字影初现。"]],
    [300, ["三百丈深处，字影渐密、灯影渐稀。", "三百丈处，连回声都带着墨味。"]],
    [600, ["六百丈！此处的成语已开始生僻。", "六百丈深处，古字在暗中发光。"]],
    [1000, ["千丈之下，唯闻笔锋破空之声。", "千丈之渊，人间灯火已成传说。"]],
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
    "小贴士：连击每添一字都会提升积分倍率（有上限），别让连击断掉。",
    "小贴士：连续多条成语零失误零停滞，可触发「学富五车」双倍积分。",
    "小贴士：平台上停留过久浮石会碎裂，果断决策。",
    "小贴士：选对一字可回复生命，选错则损耗生命——坠得越深，代价越重。",
    "小贴士：金币与道具会在通关成语后掉落，顺路接住，也会停靠在无字平台上。",
    "小贴士：排雷锤能扫掉下方数层的错字平台。",
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
      "深度 " + s.depth.toFixed(0) + " 丈 · 成语 " + s.idioms + " 个 · 积分 " + s.score,
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
    set("over-depth", stats.depth.toFixed(0) + " 丈");
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

  /** 生成分享卡片：宣纸书签竖条（画卷裁条） */
  buildShareCard(stats, comment) {
    const W = 600, H = 900;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const roundRect = (x, y, w, h, r) => {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    };
    // 宣纸底 + 边框
    g.fillStyle = "#f6f1e5"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#e0d6bd"; g.lineWidth = 3;
    roundRect(18, 18, W - 36, H - 36, 20); g.stroke();
    // 顶部朱砂印章（成语下落 2x2）
    g.save();
    g.translate(84, 84); g.rotate(-0.045);
    const sg = g.createRadialGradient(0, 0, 4, 0, 0, 46);
    sg.addColorStop(0, "#cf6f5e"); sg.addColorStop(0.6, "#c0574b"); sg.addColorStop(1, "#a84339");
    g.fillStyle = sg;
    roundRect(-46, -46, 92, 92, 10); g.fill();
    g.fillStyle = "#fdf8ee";
    g.font = "34px " + FONT_CAL; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("成", -20, -20); g.fillText("语", 20, -20);
    g.fillText("下", -20, 20); g.fillText("落", 20, 20);
    g.restore();
    // 竖排主标题
    g.fillStyle = "#3a3f44";
    g.font = "52px " + FONT_CAL; g.textAlign = "center"; g.textBaseline = "middle";
    "成语下落".split("").forEach((ch, i) => g.fillText(ch, W - 96, 120 + i * 62));
    g.strokeStyle = "#d8cdb0"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(W - 148, 112); g.lineTo(W - 148, 400); g.stroke();
    g.fillStyle = "#c0574b";
    g.beginPath(); g.arc(W - 148, 104, 4, 0, Math.PI * 2); g.fill();
    // 品第
    g.fillStyle = "#9c7a35";
    g.font = "26px " + FONT_CAL;
    g.fillText("【" + comment.title + "】", W / 2, 260);
    // 数据（行书横排）
    const rows = [
      ["坠 深", stats.depth.toFixed(0) + " 丈"],
      ["成语", stats.idioms + " 卷"],
      ["分数", String(stats.score)],
      ["正确", (stats.accuracy * 100).toFixed(0) + "%"],
    ];
    rows.forEach((r, i) => {
      const y = 330 + i * 76;
      g.fillStyle = "#8d8672"; g.font = "22px " + FONT_BODY; g.textAlign = "right";
      g.fillText(r[0], W / 2 - 24, y);
      g.fillStyle = "#3a3f44"; g.font = "34px " + FONT_CAL; g.textAlign = "left";
      g.fillText(r[1], W / 2 + 12, y);
    });
    // 题跋两句
    g.fillStyle = "#6b7076"; g.font = "21px " + FONT_BODY; g.textAlign = "center";
    comment.lines.slice(1, 3).forEach((l, i) => {
      g.fillText(l, W / 2, 660 + i * 40);
    });
    // 底部落款印
    g.save();
    g.translate(W - 108, H - 116); g.rotate(0.06);
    g.fillStyle = "#c0574b";
    roundRect(-34, -34, 68, 68, 8); g.fill();
    g.fillStyle = "#fdf8ee";
    g.font = "24px " + FONT_CAL; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("落", 0, -13); g.fillText("卷", 0, 13);
    g.restore();
    g.fillStyle = "#a9a294"; g.font = "17px " + FONT_BODY; g.textAlign = "center";
    g.fillText("青绿手卷 · 一滴墨的旅程", W / 2, H - 52);

    this._shareCanvas = c;
  },

  async share() {
    const stats = this.lastStats;
    if (!stats) return;
    const c = this._shareCanvas;
    const text = "我在《成语下落》落到 " + stats.depth.toFixed(0) + " 丈深处，拼出 " +
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
