"use strict";
/* 全局配置与工具函数 —— 青绿手卷（矿物颜料 × 宣纸） */
const CFG = {
  W: 420, H: 760,                 // 逻辑画布尺寸
  PX_PER_M: 10,                   // 10px = 1米（深度）
  DEPTH_UNIT: "丈",               // 深度显示单位
  GRAV: 1600,
  JUMP_V: 640, JUMP_H: 250,       // 平台上起跳：垂直/水平速度
  JUMP_BUFFER: 0.12,              // 空中按键缓冲
  AIR_ACC: 1150, AIR_MAX: 340,    // 空中水平控制
  GLIDE_GRAV: 0.22, GLIDE_TERM: 150, // 按住撑伞：重力倍率与限速
  TERM_BASE: 520, TERM_PER_STAGE: 26, TERM_MAX: 980,
  BOUNCE_V: 980,                  // 错字弹回上一层
  LAYER_GAP: 190,
  MARGIN: 26,
  PLAT_H: 16, CHAR_PLAT_W: 72,
  STALL_TIME: 3.0,
  HP_MAX: 100,
  HP_DRAIN_MIN: 0.1, HP_DRAIN_MAX: 1, HP_DRAIN_FULL: 900, HP_DRAIN_SHAPE: 1, // 生命消耗 S 曲线：0.1→1/秒，900丈封顶
  HP_CORRECT: 0.5, HP_STALL: 1, HP_LEAF: 30,
  HP_WRONG_MIN: 1, HP_WRONG_MAX: 3, WRONG_DEPTH_FULL: 900, // 错字扣血：1→3 渐增，900丈(深潭)封顶
  SCORE_CHAR: 10, SCORE_IDIOM: 150, SCORE_COIN: 20,
  COMBO_STEP: 0.25, COMBO_MAX: 3.5,
  BOOST_TIME: 8, BOOST_NEED: 3,       // 学富五车
  SLOW_TIME: 5,                       // 减速表
  ITEM_CHANCE: 0.28,
  HAMMER_LAYERS: 4,
  STAGE_M: 60,                        // 每60米深度 = 1难度段
  COMMON_UNTIL_STAGE: 3,              // 前3关用常用词库
  ALBUM_TOTAL: 108,                   // 成语图鉴分母（主题化目标）
  SEG_BLEND: 40,                      // 段落边界颜色过渡宽度（深度单位）
};

/* 画卷四段：云海(晨雾)→松涛(午晴)→幽谷(暮色)→深潭(星蓝)
   晨雾/暮色取自设计文档原值；午晴/星蓝按同一色彩逻辑设计 */
CFG.SEGMENTS = [
  {
    name: "云海", sub: "晨雾", from: 0, stars: false,
    sky: ["#f9f4e6", "#eef0e2", "#dfe8dc"],
    mtn: ["#b9c8bf", "#93aba0", "#718f80"],
  },
  {
    name: "松涛", sub: "午晴", from: 300, stars: false,
    sky: ["#fbf3d9", "#f2eed0", "#dcead0"],
    mtn: ["#b3cbb2", "#8cae8e", "#6d9172"],
  },
  {
    name: "幽谷", sub: "暮色", from: 600, stars: false,
    sky: ["#f6e3c8", "#eccfb4", "#d9b6a4"],
    mtn: ["#c4a48e", "#a3806d", "#7d5f52"],
  },
  {
    name: "深潭", sub: "星蓝", from: 900, stars: true,
    sky: ["#e9edf3", "#dbe3ec", "#c9d6df"],
    mtn: ["#a9bfcb", "#8aa4b2", "#6c8797"],
  },
];

/* 矿物色板 */
const PALETTE = {
  paper: "#f6f1e5", paper2: "#f1ead9", card: "#fdfaf2", line: "#e5ddc8",
  ink: "#3a3f44", inkSoft: "#6b7076", faint: "#a9a294",
  azurite: "#4a7a8c",            // 石青：书生衫、次级信息
  mineral: "#6f9e7f", mineralDk: "#55826a", // 石绿：正确反馈、生命
  ochre: "#b9905f",              // 赭石：伞骨、木柄
  cinnabar: "#c0574b",           // 朱砂：印章、朱批（克制使用）
  gold: "#c2a163",               // 金泥：学富五车、目标描边
  // 平台浮石
  slabTop: "#aeb9a6", slabMid: "#8fa189", slabDk: "#76896f", slabHi: "#c6cfba",
  grass1: "#7fa889", grass2: "#8fb08a",
  // 兼容旧引用名
  text: "#3a3f44",
  correct: "#55826a",
  wrong: "#c0574b",
  hp: "#8fb08a", hpWarn: "#d9b36c", hpBad: "#c0574b",
  platform: "#8fa189", platformEdge: "#76896f", platformLit: "#c6cfba",
  bloom: "rgba(110,125,110,0.45)",
};

const FONT_CAL = "'Ma Shan Zheng','KaiTi','STKaiti','DFKai-SB',serif";      // 书法
const FONT_BODY = "'Noto Serif SC','SimSun','Songti SC',serif";             // 正文衬线

const Utils = {
  clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
  lerp(a, b, t) { return a + (b - a) * t; },
  rand(a, b) { return a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(Utils.rand(a, b + 1)); },
  choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  chance(p) { return Math.random() < p; },
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  },
  hexToRgb(h) {
    const s = h.replace("#", "");
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  },
  rgbToHex(r, g, b) {
    const c = (v) => ("0" + Math.round(Utils.clamp(v, 0, 255)).toString(16)).slice(-2);
    return "#" + c(r) + c(g) + c(b);
  },
  lerpColor(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const ca = Utils.hexToRgb(a), cb = Utils.hexToRgb(b);
    return Utils.rgbToHex(Utils.lerp(ca[0], cb[0], t), Utils.lerp(ca[1], cb[1], t), Utils.lerp(ca[2], cb[2], t));
  },

  /** 错字扣血：深度 0 → 1，900丈 → 3；幂 1.6 让初期增长慢、深潭封顶 */
  wrongPenalty(depth) {
    const t = Utils.clamp(depth / CFG.WRONG_DEPTH_FULL, 0, 1);
    return CFG.HP_WRONG_MIN + (CFG.HP_WRONG_MAX - CFG.HP_WRONG_MIN) * Math.pow(t, 1.6);
  },

  /** 生命消耗速率：S 曲线（前缓-中陡-后缓），≥封顶深度恒为最大值
      SHAPE 先对 t 乘方再 smoothstep：>1 前期更缓、<1 更早爬升 */
  drainRate(depth) {
    let t = Utils.clamp(depth / CFG.HP_DRAIN_FULL, 0, 1);
    t = Math.pow(t, Math.max(0.1, CFG.HP_DRAIN_SHAPE));
    const s = t * t * (3 - 2 * t);
    return CFG.HP_DRAIN_MIN + (CFG.HP_DRAIN_MAX - CFG.HP_DRAIN_MIN) * s;
  },

  /** 按深度取画卷段落（含边界颜色渐变过渡） */
  segmentAt(depth) {
    const segs = CFG.SEGMENTS;
    let idx = 0;
    for (let i = 0; i < segs.length; i++) if (depth >= segs[i].from) idx = i;
    const cur = segs[idx];
    const next = segs[idx + 1];
    const out = {
      name: cur.name, sub: cur.sub, index: idx, stars: cur.stars,
      sky: cur.sky.slice(), mtn: cur.mtn.slice(),
    };
    if (next) {
      const dist = next.from - depth;
      const t = 1 - Utils.clamp(dist / CFG.SEG_BLEND, 0, 1);
      if (t > 0) {
        for (let k = 0; k < 3; k++) {
          out.sky[k] = Utils.lerpColor(cur.sky[k], next.sky[k], t);
          out.mtn[k] = Utils.lerpColor(cur.mtn[k], next.mtn[k], t);
        }
        if (t >= 1) { out.name = next.name; out.sub = next.sub; out.index = idx + 1; out.stars = next.stars; }
      }
    }
    return out;
  },
};

window.CFG = CFG;
window.PALETTE = PALETTE;
window.FONT_CAL = FONT_CAL;
window.FONT_BODY = FONT_BODY;
window.Utils = Utils;
