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
  full: false,        // 全量库（45410 条）是否已挂载
  _loading: false,
  _waiters: [],
  _loader: null,      // 测试注入的加载器（浏览器走 <script> 注入）

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

  /** 解析 "词|拼音|释义\n…" 原始串 → 条目数组 */
  _parseRaw(raw) {
    const out = [];
    const lines = String(raw || "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const a = line.indexOf("|"), b = line.indexOf("|", a + 1);
      if (a < 0 || b < 0) continue;
      out.push([line.slice(0, a), line.slice(a + 1, b), line.slice(b + 1)]);
    }
    return out;
  },

  /** 由条目数组重建查询表（首访=常用池；全量到达后整体重建） */
  _rebuild(entries) {
    this.all = entries;
    this.byWord = new Map();
    this.charSyl = new Map();
    this.sylChars = new Map();
    const sylSets = new Map();
    const poolSet = new Set();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const w = entry[0], p = entry[1];
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
    this.charPool = Array.from(poolSet);
  },

  init() {
    // 首访只载常用完整记录；全量（IDIOM_RAW）存在则直接挂载（如 Node 测试静态 require）
    const commonEntries = this._parseRaw((typeof COMMON_RAW === "string") ? COMMON_RAW : "");
    let fullEntries = [];
    if (typeof IDIOM_RAW === "string" && IDIOM_RAW) fullEntries = this._parseRaw(IDIOM_RAW);
    // 兼容旧数据路径：COMMON_WORDS 词表 + 全量库查表
    if (!commonEntries.length && typeof COMMON_WORDS !== "undefined" && Array.isArray(COMMON_WORDS) && fullEntries.length) {
      const byW = new Map(fullEntries.map((e) => [e[0], e]));
      for (const w of COMMON_WORDS) {
        const e = byW.get(w);
        if (e) commonEntries.push(e);
      }
    }
    this.common = commonEntries;
    if (fullEntries.length) {
      this._rebuild(fullEntries);
      this.full = true;
    } else {
      this._rebuild(this.common);
      this.full = false;
    }
    if (!this.common.length) this.common = this.all.slice(0, 500);
    return this;
  },

  /** 全量库挂载并重建字表（script 载入后 / 测试直调） */
  attachFull(raw) {
    const entries = this._parseRaw(raw);
    if (!entries.length) return false;
    this._rebuild(entries);
    this.full = true;
    return true;
  },

  /** 按需加载全量库（file:// 兼容的 <script> 注入）；返回是否已就绪 */
  ensureFull(cb) {
    if (this.full) { if (cb) cb(true); return true; }
    if (cb) this._waiters.push(cb);
    if (this._loading) return false;
    this._loading = true;
    const done = (ok) => {
      this._loading = false;
      const ws = this._waiters;
      this._waiters = [];
      ws.forEach((f) => { try { f(ok); } catch (e) { } });
    };
    const raw = (typeof IDIOM_RAW === "string") ? IDIOM_RAW : "";
    if (raw) { done(this.attachFull(raw)); return false; }  // 数据已在（静态引入场景）
    if (this._loader) { this._loader(done); return false; } // 测试注入
    if (typeof document === "undefined" || !document.createElement) { done(false); return false; }
    const s = document.createElement("script");
    s.src = "js/data/idioms.js";
    s.onload = () => {
      const r = (typeof IDIOM_RAW === "string") ? IDIOM_RAW : "";
      done(this.attachFull(r));
    };
    s.onerror = () => done(false);
    document.body.appendChild(s);
    return false;
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
    let useCommon = stage <= CFG.COMMON_UNTIL_STAGE && this.common.length > 50;
    if (!useCommon && !this.full) {
      this.ensureFull();   // 触发按需加载，未就绪期间暂用常用池（不空转）
      useCommon = true;
    }
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
