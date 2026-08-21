"use strict";
/* 计分与生命：连击倍率、通关积分、生命增减、学富五车（连续3次完美成语） */
const Scoring = {
  reset() {
    this.score = 0;
    this.combo = 0;          // 连续选对字数
    this.bestCombo = 0;
    this.idioms = 0;         // 完成成语数
    this.corrects = 0;       // 正确字数
    this.wrongs = 0;         // 错字次数
    this.stalls = 0;         // 停滞碎裂次数
    this.coins = 0;
    this.hp = CFG.HP_MAX;
    this.boostT = 0;         // 学富五车剩余时间
    this.perfectStreak = 0;  // 连续完美成语数
    this.maxDepthM = 0;
  },

  multiplier() {
    return Math.min(CFG.COMBO_MAX, 1 + this.combo * CFG.COMBO_STEP);
  },

  /** 选对一字：基础分 × 倍率（学富五车期间翻倍），生命 +0.5 */
  onCorrect() {
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const dbl = this.boostT > 0 ? 2 : 1;
    const gain = Math.round(CFG.SCORE_CHAR * this.multiplier() * dbl);
    this.score += gain;
    this.corrects++;
    this.hp = Math.min(CFG.HP_MAX, this.hp + CFG.HP_CORRECT);
    return gain;
  },

  /** 完成成语：高额通关积分；连续3次完美触发学富五车 */
  onIdiomComplete(worldPerfect) {
    const dbl = this.boostT > 0 ? 2 : 1;
    const base = Math.round(CFG.SCORE_IDIOM * this.multiplier() * dbl);
    this.score += base;
    this.idioms++;
    let triggerBoost = false;
    if (worldPerfect) {
      this.perfectStreak++;
      if (this.perfectStreak >= CFG.BOOST_NEED) {
        this.perfectStreak = 0;
        this.boostT = CFG.BOOST_TIME;
        triggerBoost = true;
      }
    } else {
      this.perfectStreak = 0;
    }
    return { base, triggerBoost };
  },

  /** 落在错字上：连击清零、扣血（随深度 1→3 渐增，由调用方按深度算好传入） */
  onWrong(pen) {
    this.combo = 0;
    this.wrongs++;
    this.hp -= pen || CFG.HP_WRONG_MIN;
  },

  /** 停滞碎裂：连击清零、-1生命 */
  onStall() {
    this.combo = 0;
    this.stalls++;
    this.hp -= CFG.HP_STALL;
  },

  /** 随时间/深度消耗生命 */
  drain(dt, rate) {
    this.hp -= rate * dt;
  },

  heal(v) {
    this.hp = Math.min(CFG.HP_MAX, this.hp + v);
  },

  addCoin() {
    this.coins++;
    this.score += CFG.SCORE_COIN;
  },

  accuracy() {
    const total = this.corrects + this.wrongs;
    return total ? this.corrects / total : 0;
  },

  update(dt) {
    if (this.boostT > 0) this.boostT = Math.max(0, this.boostT - dt);
  },
};

window.Scoring = Scoring;
