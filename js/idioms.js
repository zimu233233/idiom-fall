"use strict";
/* 成语词库：解析数据、按难度抽取目标成语、生成干扰字 */
const IdiomDB = {
  all: [],            // [ [word, pinyin, expl], ... ]
  byWord: null,       // word -> entry
  common: [],         // 常用成语条目
  charPool: [],       // 全量单字池（用于随机干扰字）
  charSyl: null,      // 字 -> 拼音音节
  sylChars: null,     // 音节 -> [字]
  recent: [],         // 最近用过的成语，避免短时间重复

  // 经典形近字对照（用于高难度干扰）
  LOOKALIKE: {
    "己": ["已", "巳"], "已": ["己", "巳"], "巳": ["己", "已"],
    "未": ["末"], "末": ["未"],
    "曰": ["日"], "日": ["曰", "目", "白"], "目": ["日", "月", "自"], "白": ["日", "百"],
    "本": ["木", "体"], "木": ["本", "术"], "士": ["土", "干"], "土": ["士", "王"],
    "王": ["玉", "主"], "玉": ["王"], "主": ["王", "住"],
    "人": ["入", "八"], "入": ["人", "八"],
    "千": ["干", "于"], "干": ["千", "于"], "于": ["干", "千"],
    "力": ["刀", "办"], "刀": ["力", "刃"],
    "大": ["太", "天", "犬"], "太": ["大", "犬"], "天": ["大", "夫"], "犬": ["大", "太"],
    "乌": ["鸟", "马"], "鸟": ["乌", "岛"], "岛": ["鸟"],
    "兔": ["免", "鬼"], "免": ["兔"], "风": ["凤", "凡"], "凤": ["风"],
    "侍": ["待", "持"], "待": ["侍", "持"], "持": ["待", "特"],
    "拆": ["折", "析"], "折": ["拆"], "治": ["冶"], "冶": ["治"],
    "崇": ["祟"], "祟": ["崇"], "燥": ["躁"], "躁": ["燥"],
    "盲": ["肓"], "肓": ["盲"],
    "戍": ["戌", "戊"], "戌": ["戍", "戊"], "戊": ["戌", "戍"],
    "微": ["徽"], "徽": ["微"], "撒": ["撤"], "撤": ["撒"],
    "竟": ["境", "兢"], "境": ["竟"], "兢": ["竟"],
    "厉": ["历", "励"], "历": ["厉", "励"], "励": ["厉", "历"],
    "川": ["州"], "州": ["川"],
    "陈": ["阵"], "阵": ["陈"],
    "籍": ["藉"], "藉": ["籍"],
    "壁": ["璧"], "璧": ["壁"],
    "母": ["毋"], "毋": ["母"],
    "问": ["间"], "间": ["问"],
    "贷": ["货"], "货": ["贷"],
    "管": ["菅"], "菅": ["管"],
    "徒": ["徙"], "徙": ["徒"],
  },

  init() {
    const raw = (typeof IDIOM_RAW === "string") ? IDIOM_RAW : "";
    const lines = raw.split("\n");
    const all = [];
    this.byWord = new Map();
    this.charSyl = new Map();
    this.sylChars = new Map();
    const sylSets = new Map();
    const poolSet = new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const a = line.indexOf("|"), b = line.indexOf("|", a + 1);
      if (a < 0 || b < 0) continue;
      const w = line.slice(0, a), p = line.slice(a + 1, b), e = line.slice(b + 1);
      const entry = [w, p, e];
      all.push(entry);
      this.byWord.set(w, entry);
      // 字 -> 音节 映射（拼音为4音节时逐字对应）
      const syls = p.split(/\s+/);
      if (syls.length === 4) {
        for (let k = 0; k < 4; k++) {
          const ch = w[k];
          if (!ch) continue;
          poolSet.add(ch);
          if (!this.charSyl.has(ch)) this.charSyl.set(ch, syls[k]);
          let set = sylSets.get(syls[k]);
          if (!set) { set = new Set(); sylSets.set(syls[k], set); }
          if (set.size < 60) set.add(ch);
        }
      } else {
        for (let k = 0; k < w.length; k++) poolSet.add(w[k]);
      }
    }
    sylSets.forEach((set, syl) => this.sylChars.set(syl, Array.from(set)));
    this.all = all;
    this.charPool = Array.from(poolSet);

    this.common = [];
    if (typeof COMMON_WORDS !== "undefined" && Array.isArray(COMMON_WORDS)) {
      for (const w of COMMON_WORDS) {
        const entry = this.byWord.get(w);
        if (entry) this.common.push(entry);
      }
    }
    if (!this.common.length) this.common = all.slice(0, 500);
    return this;
  },

  /** 按难度阶段抽取成语：低阶段用常用表，高阶段用全量表 */
  pickIdiom(stage, forcedWord) {
    if (forcedWord) {
      const e = this.byWord.get(forcedWord);
      if (e) {
        this.recent.push(forcedWord);
        if (this.recent.length > 24) this.recent.shift();
        return { w: e[0], p: e[1], e: e[2], common: true };
      }
    }
    const useCommon = stage <= CFG.COMMON_UNTIL_STAGE && this.common.length > 50;
    const pool = useCommon ? this.common : this.all;
    for (let tries = 0; tries < 24; tries++) {
      const entry = Utils.choice(pool);
      if (this.recent.indexOf(entry[0]) < 0) {
        this.recent.push(entry[0]);
        if (this.recent.length > 24) this.recent.shift();
        return { w: entry[0], p: entry[1], e: entry[2], common: useCommon };
      }
    }
    const entry = Utils.choice(pool);
    return { w: entry[0], p: entry[1], e: entry[2], common: useCommon };
  },

  /** 为正确字生成 2-3 个干扰字：高阶段倾向形近字/同音字 */
  makeDistractors(correctChar, idiomChars, stage, count) {
    const n = count || 2;
    const excl = new Set(idiomChars);
    excl.add(correctChar);
    const res = [];
    const pushIfOk = (ch) => {
      if (!ch || res.length >= n) return false;
      if (excl.has(ch) || res.indexOf(ch) >= 0) return false;
      res.push(ch);
      excl.add(ch);
      return true;
    };
    // 高难度：形近字
    if (stage >= 3) {
      const la = this.LOOKALIKE[correctChar];
      if (la) Utils.shuffle(la.slice()).some(pushIfOk);
    }
    // 中高难度：同音/近音字（阶段越高越倾向；单次抽到已排除字时重选）
    let attempt = 0;
    const gate = stage >= 5 ? 0.85 : (stage >= 2 ? 0.65 : 0.25);
    while (res.length < n && attempt < 6 && Utils.chance(gate)) {
      attempt++;
      const syl = this.charSyl.get(correctChar);
      if (!syl) break;
      const list = this.sylChars.get(syl);
      if (!list || !list.length) break;
      for (let t = 0; t < 3; t++) {
        if (pushIfOk(Utils.choice(list))) break;
      }
    }
    // 兜底：随机字
    let guard = 0;
    while (res.length < n && guard++ < 60) {
      pushIfOk(Utils.choice(this.charPool));
    }
    return res;
  },
};

window.IdiomDB = IdiomDB;
