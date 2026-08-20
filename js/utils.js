"use strict";
/* 全局配置与工具函数 */
const CFG = {
  W: 420, H: 760,                 // 逻辑画布尺寸
  PX_PER_M: 10,                   // 10px = 1米（深度）
  GRAV: 1600,
  JUMP_V: 640, JUMP_H: 250,       // 平台上起跳：垂直/水平速度
  JUMP_BUFFER: 0.12,              // 空中按键缓冲
  AIR_ACC: 1150, AIR_MAX: 340,    // 空中水平控制
  GLIDE_GRAV: 0.22, GLIDE_TERM: 150, // 按住滑翔：重力倍率与限速
  TERM_BASE: 520, TERM_PER_STAGE: 26, TERM_MAX: 980,
  BOUNCE_V: 980,                  // 错字弹回上一层
  LAYER_GAP: 190,
  MARGIN: 26,
  PLAT_H: 16, CHAR_PLAT_W: 72,
  STALL_TIME: 3.0,
  HP_MAX: 100, HP_DRAIN_BASE: 0.75, HP_DRAIN_PER_STAGE: 0.06, HP_DRAIN_MAX: 3.2,
  HP_CORRECT: 0.5, HP_WRONG: 3, HP_STALL: 1, HP_LEAF: 30,
  SCORE_CHAR: 10, SCORE_IDIOM: 150, SCORE_COIN: 20,
  COMBO_STEP: 0.25, COMBO_MAX: 3.5,
  BOOST_TIME: 8, BOOST_NEED: 3,       // 学富五车
  SLOW_TIME: 5,                       // 减速表
  ITEM_CHANCE: 0.28,
  HAMMER_LAYERS: 4,
  STAGE_M: 60,                        // 每60米深度 = 1难度段
  COMMON_UNTIL_STAGE: 3,              // 前3关用常用词库
};

const PALETTE = {
  bgTop: "#170b14", bgBottom: "#2a1020",
  platform: "#3a4a8c", platformEdge: "#222c54", platformLit: "#5568b8",
  text: "#f3ecd8", correct: "#3ddc84", wrong: "#e84a6f",
  gold: "#ffd447", robe: "#e8b830", ink: "#0d0a10",
  hp: "#4be08a", hpWarn: "#ffb347", hpBad: "#ff5a6e",
};

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
};

window.CFG = CFG;
window.PALETTE = PALETTE;
window.Utils = Utils;
