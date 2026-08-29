'use strict';
/*
 * tools/bgm/compositions.js —— 十二首背景音乐的作曲数据与生成器
 *
 * 作曲体系：五声宫调集（宫商角徵羽）为骨架，调式色彩由 finalIdx（收束倾向的阶名下标）
 * 与乐句走向决定；所有旋律为程序原创，仅 04/06 借鉴公有领域古谱（《酒狂》《平沙落雁》）
 * 的节拍律动与意象形态，不使用任何近现代记谱改编旋律线。
 *
 * 事件模型：{inst, t(拍), dur(拍), vel, ...payload}，渲染层换算成秒并派发合成。
 * 全部生成器只用确定性随机，同一种子两次生成结果逐位一致。
 */

const E = require('./engine.js');
const mulberry32 = E.mulberry32;
const midiToFreq = E.midiToFreq;

/* 五声音集：宫商角徵羽（相对主音的半音数） */
const PENT = [0, 2, 4, 7, 9];
const PENT_NAME = ['宫', '商', '角', '徵', '羽'];

function degToMidi(root, i) {
  const k = ((i % 5) + 5) % 5;
  const oct = Math.floor(i / 5);
  return root + PENT[k] + 12 * oct;
}

/* 各乐器常用音域（MIDI），越界按八度折回 */
const REG = {
  qin: [41, 81],
  qharm: [62, 96],
  zheng: [46, 92],
  xiao: [58, 86],
  di: [62, 90],
  erhu: [54, 92],
  zhong: [34, 76],
  qing: [77, 99]
};
function instFreq(inst, midi) {
  let m = midi;
  const rg = REG[inst] || [40, 96];
  while (m < rg[0]) m += 12;
  while (m > rg[1]) m -= 12;
  return midiToFreq(m);
}

/* ---------- 作曲上下文 ---------- */
function buildCtx(track) {
  const rng = mulberry32(track.seed);
  const root = track.root;
  const faceBeats = track.bars * track.beatsPerBar;
  const ctx = {
    rng: rng,
    root: root,
    spb: 60 / track.bpm,
    evts: [],
    /* 主音在 finalIdx 调式上的锚点（度数索引空间） */
    home: track.finalIdx,
    push: function (inst, t, dur, pay) {
      pay = pay || {};
      /* 循环面守卫：起始拍取模回卷到 [0, face)，非法时间直接丢弃 */
      if (!isFinite(t)) return;
      t = ((t % faceBeats) + faceBeats) % faceBeats;
      const vel = pay.vel != null ? pay.vel : 0.8;
      const rec = Object.assign({}, pay);
      const e = Object.assign({ inst: inst, t: t, dur: dur, vel: vel }, rec);
      if (pay.midi != null) e.freq = instFreq(inst, pay.midi);
      else if (pay.deg != null) e.freq = instFreq(inst, degToMidi(root, pay.deg));
      ctx.evts.push(e);
      return e;
    },
    deg: function (i) { return degToMidi(root, i); },
    rint: function (lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); },
    pick: function (arr) { return arr[Math.floor(rng() * arr.length)]; },
    chance: function (p) { return rng() < p; }
  };
  return ctx;
}

function loopSecOf(track) {
  return track.bars * track.beatsPerBar * (60 / track.bpm);
}

/* ---------- 共享乐句原料 ---------- */
/* 动机音级差（程序生成的细胞，含起收吸附） */
function makeCells(c, n) {
  const cells = [];
  for (let k = 0; k < n; k++) {
    const len = c.rint(4, 6);
    const cur0 = c.home + c.pick([-2, -1, 0, 1]);
    const d = [];
    let cur = cur0;
    for (let j = 0; j < len - 1; j++) {
      let st = c.pick([-2, -1, -1, 1, 1, 2]);
      if (c.chance(0.14)) st += st > 0 ? 2 : -2;
      cur += st;
      /* 向 home 回归，防漂移 */
      if (cur > c.home + 7) cur -= 2;
      if (cur < c.home - 6) cur += 2;
      d.push(st);
    }
    cells.push({ d: d });
  }
  return cells;
}

/* 节奏库（单位：拍），每项总和约 2~4 拍 */
const RHY = {
  sparse: [
    [3],
    [2, 2],
    [1.5, 2.5],
    [1, 1, 2],
    [0.5, 0.5, 1, 2],
    [2, 1, 1]
  ],
  mid: [
    [1, 1, 2],
    [0.5, 1, 0.5, 2],
    [1, 0.5, 0.5, 2],
    [2, 0.5, 0.5, 1],
    [0.5, 0.5, 1, 0.5, 0.5, 1],
    [1.5, 0.5, 1, 1]
  ],
  flow: [
    [0.5, 0.5, 0.5, 0.5, 1, 1],
    [0.5, 0.5, 1, 0.5, 0.5, 1],
    [1, 0.5, 0.5, 0.5, 0.5, 1],
    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1],
    [0.5, 0.5, 0.5, 1.25, 1]
  ]
};

/* 标准铺底：低音持续链 + 可选风底；铺满整曲且跨越循环边界自然衔接 */
function layBed(c, tc, loopSec) {
  const span = 8 * tc.bpb;                    /* 每 8 小节一段持续音 */
  const totalBeats = tc.bars * tc.bpb;
  const nSeg = Math.ceil(totalBeats / span);
  for (let s = 0; s < nSeg; s++) {
    const inten = tc.profile(Math.min(0.999, (s * span) / totalBeats));
    c.push('drone', s * span, span * 0.98, {
      midi: E.fitReg(c.deg(c.home) - 12, 31, 47),
      vel: 0.17 + 0.16 * inten,
      level: tc.droneLevel != null ? tc.droneLevel : 1
    });
  }
  if (tc.wind) {
    c.push('wind', 0, totalBeats, { vel: tc.wind * 0.7, level: 0.16, noFade: true });
  }
}

/* 引路蝶式的零星水滴（幽谷等曲目专用） */
function layDrops(c, tc) {
  const totalBeats = tc.bars * tc.bpb;
  let t = c.rng() * 8;
  while (t < totalBeats - 4) {
    c.push('drop', t, 0.3, {
      freq: midiToFreq(84 + c.rint(-7, 5)),
      vel: 0.3 + c.rng() * 0.35,
      pan: (c.rng() * 2 - 1) * 0.55
    });
    t += 6 + c.rng() * 16;
  }
}

/* 古筝琶音织体 */
function layArp(c, tc) {
  const pat = [0, 1, 2, 1];                  /* 上-中-下-中 的连珠走向 */
  for (let b = 0; b < tc.bars; b++) {
    const tb = b * tc.bpb;
    const inten = tc.profile((b + 0.5) / tc.bars);
    if (!c.chance(tc.arpP != null ? tc.arpP : 0.5 + inten * 0.4)) continue;
    const anchor = c.home - 5 + c.rint(0, 3) - (inten > 0.6 ? 2 : 0);
    const tones = [anchor, anchor + 2, anchor + 4];
    const gt = tb + (c.chance(0.3) ? 1 : 0);
    for (let k = 0; k < pat.length; k++) {
      c.push('zheng', gt + k * 0.5, 0.9, {
        deg: tones[pat[k]],
        vel: (0.34 + inten * 0.3) * (1 - k * 0.08),
        mute: !!tc.zhengMut && c.chance(0.5)
      });
    }
  }
}

/* 木鱼轻击 / 软鼓骨架 */
function layPerc(c, tc) {
  for (let b = 0; b < tc.bars; b++) {
    const inten = tc.profile((b + 0.5) / tc.bars);
    if (tc.muyu && ((b % 2 === 1) || c.chance(0.25))) {
      c.push('muyu', b * tc.bpb + c.pick([1, 1.5, 2.5]), 0.3, {
        fBody: 560 + c.rng() * 220,
        vel: (tc.muyuBase || 0.16) * (0.6 + inten * 0.6),
        pan: 0.15 + c.rng() * 0.2 - 0.1
      });
    }
    if (tc.kickEvery && b % tc.kickEvery === (tc.kickPhase || 0)) {
      c.push('kick', b * tc.bpb, 0.4, { vel: (tc.kickVel || 0.16) * (0.7 + inten * 0.5) });
    }
  }
}

/* 标准旋律走句：动机细胞 + 流式节奏展开 + 收束规则 + 问答应答 */
function layLead(c, tc) {
  const cells = makeCells(c, 4);
  const order = [0, 0, 1, 2];               /* A A' B C 的发展序 */
  let cur = c.home;
  let oi = 0;
  for (let ph = 0; ph * 4 < tc.bars; ph++) {
    const pb = ph * 4;                       /* 乐句起始小节 */
    const endB = Math.min(pb + 4, tc.bars) * tc.bpb;
    const inten = tc.profile(Math.min(0.999, (pb + 2) / (tc.bars * tc.bpb)));
    const cell = cells[order[oi++ % order.length]];
    let tt = pb * tc.bpb + (ph === 0 ? tc.leadInBeats || 0 : c.chance(0.35) ? 0.5 : 0);
    let rhy = tc.rhyByIntensity
      ? c.pick(inten > 0.55 ? RHY.flow : RHY.sparse)
      : c.pick(RHY[tc.rhy || 'mid']);
    let ri = 0, ci = 0;
    let degNow = cur;

    /* 流式展开：节奏组用尽则呼吸或续段，直到乐句尾 */
    while (tt < endB - 1.3) {
      if (ri >= rhy.length) {
        if (c.chance(tc.restP != null ? tc.restP : 0.3)) {
          tt += c.pick([1, 1.5]);
          ci = 0;
        } else {
          rhy = tc.rhyByIntensity
            ? c.pick(inten > 0.55 ? RHY.flow : RHY.sparse)
            : c.pick(RHY[tc.rhy || 'mid']);
          ri = 0;
        }
        continue;
      }
      const d = rhy[ri++];
      if (tt + d > endB - 0.4) break;
      const degAt = ci === 0 ? degNow : (degNow = degNow + cell.d[(ci - 1) % cell.d.length] * c.pick([1, 1, 1, -1]));
      const useQinHarmonic = tc.inst === 'qin' && degAt >= 9 && c.chance(0.3);
      c.push(useQinHarmonic ? 'qharm' : tc.inst, tt, d, {
        deg: degAt,
        vel: (0.48 + 0.44 * inten) * (ci === 0 ? 1 : 0.88),
        slide: tc.slides && ci === 0 && c.chance(0.35),
        pan: tc.pan
      });
      if (tc.graceP && c.chance(tc.graceP) && !useQinHarmonic) {
        c.push(tc.inst, Math.max(0, tt - 0.11), 0.12, {
          deg: degAt + c.pick([-1, 1]),
          vel: 0.28 + 0.22 * inten, pan: tc.pan
        });
      }
      /* 低八度垫音（古琴独走时给一点骨头） */
      if ((tc.compLow || (tc.rhy !== 'sparse')) && d >= 1 && c.chance(0.22)) {
        c.push('qin', tt, d, { deg: Math.max(degAt - 8, c.home - 7), vel: 0.18 + 0.1 * inten, pan: -0.32 });
      }
      tt += d; ci++;
    }

    /* 句尾收束：滑向调式锚点 */
    if (ph % 2 === 1 && tt < endB + 1) {
      const settleT = Math.min(tt, endB - 2.2);
      const pull = c.home + (tc.finalOct || 0);
      degNow = degNow + Math.sign(pull - degNow) * 1;
      c.push(tc.inst, settleT, 2.6, { deg: degNow, vel: 0.42 + 0.22 * inten, pan: tc.pan });
      cur = degNow;
      /* 收束闪音：一组高八度下坠的小晶粒 */
      if (c.chance(0.5)) {
        c.push('qharm', settleT + 0.5, 0.5, { deg: pull + 9, vel: 0.2 + 0.08 * inten, pan: 0.15 });
        c.push('qharm', settleT + 1.0, 0.5, { deg: pull + 7, vel: 0.16, pan: -0.1 });
      }
      /* 应答声部（每个偶数句答一次，接住话头） */
      if (tc.answer && ph % 2 === 1) {
        c.push(tc.answer.inst, settleT + 0.75, 3.0, {
          deg: Math.max(pull - 6, degNow - 3), vel: 0.34, pan: tc.answer.pan
        });
        if (c.chance(0.7)) {
          c.push(tc.answer.inst, settleT + 2.25, 2.8, {
            deg: Math.max(pull - 7, degNow - 4), vel: 0.27, pan: tc.answer.pan
          });
        }
      }
    } else {
      cur = degNow;
    }
  }
}

/* =====================================================================
 * 十二首曲目
 * ===================================================================== */
const TRACKS = [];

TRACKS.push({
  id: '01', slug: 'opening-scroll',
  name: '展卷·梦入青山', file: 'audio/bgm/01-opening-scroll.mp3',
  group: '卷首', scene: '卷首加载 · 极简留白',
  desc: '古琴与箫一问一答，梦的第一口气。',
  bpm: 54, beatsPerBar: 4, bars: 23, seed: 20260101,
  root: 62, finalIdx: 0,
  rev: { wet: 0.44, size: 1.3, dampAmt: 0.52 },
  gen: function (c, tc) {
    layBed(c, Object.assign({}, tc, { wind: 0.25 }), loopSecOf(tc));
    layLead(c, Object.assign({}, tc.baseLead(), { graceP: 0.12, restP: 0.22, rhy: 'mid' }));
  },
  profileSelf: [0.35, 0.55, 0.72, 0.55, 0.32],
  baseLead: function () {
    const self = this;
    return {
      bars: self.bars, bpb: self.beatsPerBar, inst: 'qin', pan: -0.25,
      rhy: 'sparse', slides: true, graceP: 0.12,
      profile: function (u) { return prof(self.profileSelf, u); },
      answer: { inst: 'xiao', pan: -0.45 }
    };
  }
});

TRACKS.push({
  id: '02', slug: 'cloud-sea',
  name: '云海泛墨', file: 'audio/bgm/02-cloud-sea.mp3',
  group: '第一段 · 云海', scene: '晨雾 · 箫主导',
  desc: '箫声浮在弦底之上，像墨在水面化开。',
  bpm: 56, beatsPerBar: 4, bars: 25, seed: 20260102,
  root: 67, finalIdx: 3,
  rev: { wet: 0.46, size: 1.45, dampAmt: 0.5 },
  gen: function (c, tc) {
    layBed(c, tc, loopSecOf(tc));
    layLead(c, Object.assign({}, tc.baseLead(), {
      inst: 'xiao', pan: -0.42, rhyByIntensity: true, graceP: 0.06,
      answer: { inst: 'qin', pan: -0.2 }, leadInBeats: 4
    }));
  },
  profileSelf: [0.3, 0.5, 0.65, 0.55, 0.35],
  baseLead: function () {
    const self = this;
    return {
      bars: self.bars, bpb: self.beatsPerBar, inst: 'qin', pan: -0.25,
      rhy: 'sparse', slides: true, graceP: 0.1,
      profile: function (u) { return prof(self.profileSelf, u); },
      answer: null
    };
  }
});

TRACKS.push({
  id: '03', slug: 'pine-noon',
  name: '松间清昼', file: 'audio/bgm/03-pine-noon.mp3',
  group: '第二段 · 松涛', scene: '午晴 · 古筝琶音',
  desc: '筝珠滚过松针，晌午的风把光摇碎。',
  bpm: 66, beatsPerBar: 4, bars: 28, seed: 20260103,
  root: 60, finalIdx: 0,
  rev: { wet: 0.30, size: 1.0, dampAmt: 0.58 },
  gen: function (c, tc) {
    layBed(c, tc, loopSecOf(tc));
    layArp(c, Object.assign({ arpP: 0.62 }, tc.arpcfg()));
    layPerc(c, { bars: tc.bars, bpb: tc.beatsPerBar, muyu: true, muyuBase: 0.13, profile: tc.profFn() });
    layLead(c, Object.assign({}, tc.baseLead(), {
      inst: 'qin', pan: -0.22, rhy: 'mid', graceP: 0.2,
      answer: { inst: 'di', pan: 0.42 }
    }));
  },
  profileSelf: [0.4, 0.62, 0.8, 0.62, 0.42],
  arpcfg: function () {
    const self = this;
    return { bars: self.bars, bpb: self.beatsPerBar, profile: self.profFn() };
  },
  profFn: function () {
    const self = this;
    return function (u) { return prof(self.profileSelf, u); };
  },
  baseLead: function () {
    const self = this;
    return {
      bars: self.bars, bpb: self.beatsPerBar, inst: 'qin', pan: -0.25,
      rhy: 'mid', slides: false, graceP: 0.16,
      profile: function (u) { return prof(self.profileSelf, u); },
      answer: { inst: 'di', pan: 0.42 }
    };
  }
});

/* 04 取《酒狂》三拍摇摆律动的自由变奏（公有领域古谱节拍语汇） */
TRACKS.push({
  id: '04', slug: 'tipsy-steps',
  name: '微醺行步', file: 'audio/bgm/04-tipsy-steps.mp3',
  group: '全卷通用', scene: '答题行进 · 微醺三拍',
  desc: '借《酒狂》跛行的三拍醉意，一步一顿地走路。',
  bpm: 88, beatsPerBar: 3, bars: 42, seed: 20260104,
  root: 57, finalIdx: 4,
  rev: { wet: 0.26, size: 0.95, dampAmt: 0.6 },
  gen: function (c, tc) {
    layBed(c, tc, loopSecOf(tc));
    const totalBeats = tc.bars * tc.bpb;
    const cells = makeCells(c, 3);
    let oi = 0;
    for (let b = 0; b < tc.bars; b++) {
      const tb = b * tc.bpb;
      const inten = tc.profile((b + 0.5) / tc.bars);
      /* 低音拨弦（强拍落在弱位置——跛行的关键） */
      c.push('qin', tb, 1.6, { deg: c.home - 7, vel: 0.5 + 0.2 * inten, pan: -0.3 });
      if (b % 2 === 1) c.push('qin', tb + 2, 1.0, { deg: c.home - 5, vel: 0.36, pan: -0.3 });
      /* 弱拍上的闷击筝——踉跄感 */
      if (c.chance(0.55)) c.push('zheng', tb + 2.5, 0.4, { deg: c.home - 3, vel: 0.26, mute: true });
      if (b % 2 === 0) c.push('muyu', tb + 1.5, 0.3, { fBody: 600 + c.rng() * 160, vel: 0.2 });
      /* 三音上行/下行小句 */
      if (c.chance(0.8) && tb + 2 < totalBeats) {
        const cell = cells[oi++ % cells.length];
        const rr = c.pick([[0, 0.5, 1], [0, 1, 1.5], [0.5, 1, 1.75]]);
        let dg = c.home + c.pick([-1, 0, 1]);
        for (let k = 0; k < 3; k++) {
          if (k > 0) dg += (k === 2 ? -(cell.d[0] > 0 ? 1 : -1) : cell.d[Math.min(k - 1, cell.d.length - 1)]);
          c.push(k === 2 && dg >= 9 ? 'qharm' : 'zheng', tb + rr[k], 0.55, {
            deg: dg, vel: 0.4 + 0.3 * inten, mute: c.chance(0.25)
          });
        }
      }
    }
  },
  profileSelf: [0.35, 0.55, 0.7, 0.55, 0.4]
});

/* 05 幽谷闻泉 */
TRACKS.push({
  id: '05', slug: 'valley-spring',
  name: '幽谷闻泉', file: 'audio/bgm/05-valley-spring.mp3',
  group: '第三段 · 幽谷', scene: '暮色 · 古琴泛音与泉声',
  desc: '泛音是溅起的泉花，水声一直走在深处。',
  bpm: 58, beatsPerBar: 4, bars: 26, seed: 20260105,
  root: 55, finalIdx: 3,
  rev: { wet: 0.42, size: 1.35, dampAmt: 0.52 },
  gen: function (c, tc) {
    layBed(c, tc, loopSecOf(tc));
    layDrops(c, tc);
    layPerc(c, { bars: tc.bars, bpb: tc.beatsPerBar, muyu: c.chance(0) , profile: tc.profFn() });
    layLead(c, Object.assign({}, tc.baseLead(), {
      inst: 'qin', pan: -0.2, rhy: 'sparse', graceP: 0.08,
      answer: { inst: 'xiao', pan: -0.5 }
    }));
  },
  profileSelf: [0.3, 0.5, 0.68, 0.52, 0.32],
  profFn: function () { const s = this; return function (u) { return prof(s.profileSelf, u); }; },
  baseLead: function () {
    const self = this;
    return {
      bars: self.bars, bpb: self.beatsPerBar, inst: 'qin', pan: -0.25,
      rhy: 'sparse', slides: true, graceP: 0.1,
      profile: function (u) { return prof(self.profileSelf, u); },
      answer: { inst: 'xiao', pan: -0.45 }
    };
  }
});

/* 06 《平沙落雁》意象的自由变奏：下行雁阵与二胡长弓 */
TRACKS.push({
  id: '06', slug: 'geese-at-dusk',
  name: '暮色归雁', file: 'audio/bgm/06-geese-at-dusk.mp3',
  group: '第三段 · 幽谷', scene: '幽谷深处 · 二胡长弓',
  desc: '雁阵一行行落下，二胡替它们喊出余音。',
  bpm: 50, beatsPerBar: 4, bars: 22, seed: 20260106,
  root: 62, finalIdx: 4,
  rev: { wet: 0.5, size: 1.5, dampAmt: 0.46 },
  gen: function (c, tc) {
    layBed(c, tc, loopSecOf(tc));
    const banks = [
      [4, 3, 2, 1],
      [5, 4, 2, 1, 0],
      [7, 5, 4, 2],
      [4, 2, 1, 0]
    ];
    let bi = 0;
    for (let ph = 0; ph * 4 < tc.bars; ph++) {
      const pb = ph * 4;
      const inten = tc.profile((pb + 2) / tc.bars);
      /* 一声雁唳下滑入，然后阵型渐降 */
      const bank = banks[(bi++) % banks.length];
      let tt = pb * tc.bpb + 0.5;
      let dg = c.home + 3 + bank[0];
      for (let k = 0; k < bank.length; k++) {
        const d = k === 0 ? 2.4 : 1.6;
        c.push('erhu', tt, d, {
          deg: dg, vel: (k === 0 ? 0.62 : 0.44) + 0.2 * inten,
          slide: k === 0, pan: 0.2
        });
        dg -= c.pick([1, 1, 2]);
        tt += d + 0.4;
        if (tt > (pb + 4) * tc.bpb - 0.6) break;
      }
      /* 空弦琴应和（双音） */
      c.push('qin', pb * tc.bpb + 2.5, 2, { deg: c.home - 5, vel: 0.3, pan: -0.3 });
      c.push('qin', pb * tc.bpb + 2.5, 2, { deg: c.home - 2, vel: 0.26, pan: -0.3 });
      if (c.chance(0.5)) {
        c.push('qin', pb * tc.bpb + 3.5, 1.5, { deg: c.home, vel: 0.3, pan: -0.3 });
      }
    }
  },
  profileSelf: [0.35, 0.55, 0.72, 0.6, 0.4]
});

/* 07 星垂深潭 */
TRACKS.push({
  id: '07', slug: 'stars-deep-pool',
  name: '星垂深潭', file: 'audio/bgm/07-stars-deep-pool.mp3',
  group: '第四段 · 深潭', scene: '星蓝夜潭 · 磬点低吟',
  desc: '低音沉在潭底，磬声是偶尔眨眼的星。',
  bpm: 46, beatsPerBar: 4, bars: 20, seed: 20260107,
  root: 53, finalIdx: 0,
  rev: { wet: 0.5, size: 1.55, dampAmt: 0.42 },
  gen: function (c, tc) {
    layBed(c, Object.assign({}, tc, { wind: 0.3 }), loopSecOf(tc));
    const totalBeats = tc.bars * tc.bpb;
    /* 远处的箫，很淡 */
    let tt = 2;
    while (tt < totalBeats - 6) {
      c.push('xiao', tt, 4 + c.rng() * 3, {
        deg: c.home + c.pick([0, 1, 2, 4]), vel: 0.2 + c.rng() * 0.12, pan: -0.5
      });
      tt += 10 + c.rng() * 12;
    }
    /* 星星=磬 */
    tt = 3;
    while (tt < totalBeats - 4) {
      c.push(c.chance(0.75) ? 'qing' : 'qharm', tt, 0.5, {
        deg: c.home + 16 + c.rint(0, 7),
        vel: 0.22 + c.rng() * 0.3,
        pan: (c.rng() * 2 - 1) * 0.6
      });
      tt += 4 + c.rng() * 14;
    }
    /* 零星古琴低语 */
    tt = 0;
    while (tt < totalBeats - 5) {
      c.push('qin', tt, 4, { deg: c.home - c.rint(4, 7), vel: 0.3 + c.rng() * 0.15, pan: -0.25 });
      tt += 7 + c.rng() * 9;
    }
  },
  profileSelf: [0.3, 0.45, 0.6, 0.45, 0.3]
});

/* 08 细雨题笺 */
TRACKS.push({
  id: '08', slug: 'rain-notes',
  name: '细雨题笺', file: 'audio/bgm/08-rain-notes.mp3',
  group: '全卷通用', scene: '连击愉悦 · 俏皮短句',
  desc: '雨点打在笺纸上，写对一笔就亮一下。',
  bpm: 72, beatsPerBar: 4, bars: 30, seed: 20260108,
  root: 63, finalIdx: 0,
  rev: { wet: 0.24, size: 0.9, dampAmt: 0.62 },
  gen: function (c, tc) {
    layBed(c, Object.assign({}, tc, { wind: 0 }), loopSecOf(tc));
    layDrops(c, tc);
    layPerc(c, { bars: tc.bars, bpb: tc.beatsPerBar, muyu: true, muyuBase: 0.2, kickEvery: 2, kickVel: 0.13, profile: tc.profFn() });
    layArp(c, Object.assign({ arpP: 0.55, zhengMut: true }, tc.arpcfg()));
    /* 俏皮主题：短连珠 + 上挑收音 */
    const cells = makeCells(c, 4);
    let oi = 0;
    for (let ph = 0; ph * 4 < tc.bars; ph++) {
      const pb = ph * 4;
      const inten = tc.profile((pb + 2) / tc.bars);
      const cell = cells[oi++ % cells.length];
      const rr = c.pick([
        [0.5, 0.5, 1],
        [0.5, 0.5, 0.5, 0.5, 1],
        [1, 0.5, 0.5],
        [0.5, 1, 0.5]
      ]);
      let tt = pb * tc.bpb + c.pick([0, 0.5]);
      let dg = c.home + c.pick([-1, 0, 1]);
      for (let k = 0; k < rr.length; k++) {
        if (k > 0) dg += cell.d[Math.min(k - 1, cell.d.length - 1)];
        c.push('zheng', tt, rr[k], {
          deg: dg, vel: 0.42 + 0.3 * inten,
          mute: c.chance(0.3), pan: 0.28 + (k % 2) * 0.12 - 0.06
        });
        tt += rr[k];
      }
      /* 上挑小尾巴 */
      if (c.chance(0.6)) c.push('zheng', tt + 0.25, 1, { deg: dg + 3, vel: 0.3 + 0.2 * inten, pan: 0.4 });
      if (ph % 2 === 1) {
        c.push('drop', tt + 1, 0.3, { freq: midiToFreq(88 + c.rint(-4, 4)), vel: 0.3, pan: 0.3 });
      }
    }
  },
  profileSelf: [0.45, 0.62, 0.8, 0.62, 0.45],
  arpcfg: function () { const s = this; return { bars: s.bars, bpb: s.beatsPerBar, profile: function (u) { return prof(s.profileSelf, u); } }; },
  profFn: function () { const s = this; return function (u) { return prof(s.profileSelf, u); }; }
});

/* 09 空山新雪 */
TRACKS.push({
  id: '09', slug: 'snow-empty-mountain',
  name: '空山新雪', file: 'audio/bgm/09-snow-empty-mountain.mp3',
  group: '全卷通用', scene: '结算气质 · 古琴独奏慢板',
  desc: '一场慢板的独白，冷，但干净。',
  bpm: 44, beatsPerBar: 4, bars: 20, seed: 20260109,
  root: 60, finalIdx: 1,
  rev: { wet: 0.48, size: 1.6, dampAmt: 0.4 },
  gen: function (c, tc) {
    layBed(c, Object.assign({}, tc, { wind: 0.22, droneLevel: 0.7 }), loopSecOf(tc));
    const totalBeats = tc.bars * tc.bpb;
    /* 慢板单线条，大量留白；偶尔一片泛音雪光 */
    let tt = 0;
    let dg = c.home + 2;
    while (tt < totalBeats - 4) {
      c.push('qin', tt, 3.5, { deg: dg, vel: 0.42 + c.rng() * 0.2, pan: -0.22 });
      if (dg >= 10 && c.chance(0.3)) {
        c.push('qharm', tt + 1.75, 1.8, { deg: dg + 2, vel: 0.26, pan: -0.15 });
      }
      /* 下行缓步或静滞 */
      dg += c.pick([-1, -1, -2, 1, 2, 0]);
      if (dg > c.home + 6) dg -= 3;
      if (dg < c.home - 5) dg += 3;
      tt += 3 + c.rng() * 5;
      if (c.chance(0.3)) tt += 2;   /* 呼吸留白 */
    }
  },
  profileSelf: [0.35, 0.5, 0.62, 0.5, 0.35]
});

/* 10 千卷长河：多动机交织的主题重奏 */
TRACKS.push({
  id: '10', slug: 'long-river-of-scrolls',
  name: '千卷长河', file: 'audio/bgm/10-long-river-of-scrolls.mp3',
  group: '全卷通用', scene: '主题收束 · 层次最丰',
  desc: '云海、松风、人声、钟鸣汇成一条长河。',
  bpm: 63, beatsPerBar: 4, bars: 28, seed: 20260110,
  root: 62, finalIdx: 0,
  rev: { wet: 0.4, size: 1.3, dampAmt: 0.5 },
  gen: function (c, tc) {
    layBed(c, tc, loopSecOf(tc));
    const secBars = 7;                        /* 四个乐章各 7 小节 */
    const prof = tc.profFn();
    /* 甲章：云海主题（箫长音，承接 02 的气质） */
    for (let b = 0; b < secBars; b++) {
      const inten = prof((b + 0.5) / tc.bars);
      if (b % 2 === 0) {
        c.push('xiao', b * tc.bpb, 5, {
          deg: c.home + c.pick([0, 2, 4]), vel: 0.3 + 0.15 * inten, pan: -0.42
        });
      }
      if (b % 3 === 2) c.push('qin', b * tc.bpb + 1, 2.5, { deg: c.home - 5, vel: 0.3, pan: -0.2 });
    }
    /* 乙章：松涛筝流（承接 03） */
    for (let b = 0; b < secBars; b++) {
      const inten = prof((secBars + b + 0.5) / tc.bars);
      if (c.chance(0.8)) {
        const anchor = c.home - 4 + c.rint(0, 2);
        const tones = [anchor, anchor + 2, anchor + 4];
        for (let k = 0; k < 4; k++) {
          c.push('zheng', (secBars + b) * tc.bpb + k * 0.75, 0.6, {
            deg: tones[[0, 1, 2, 1][k]], vel: 0.3 + 0.3 * inten, mute: c.chance(0.2)
          });
        }
      }
      if (b % 2 === 1) c.push('muyu', (secBars + b) * tc.bpb + 2, 0.3, { fBody: 640, vel: 0.15 });
    }
    /* 丙章：书生行吟（二胡与琴对答，承接 04/06） */
    for (let b = 0; b < secBars; b += 2) {
      const inten = prof((secBars * 2 + b + 1) / tc.bars);
      c.push('erhu', (secBars * 2 + b) * tc.bpb, 3.4, {
        deg: c.home + 1 + c.pick([-1, 0, 1]), vel: 0.4 + 0.2 * inten,
        slide: c.chance(0.5), pan: 0.22
      });
      c.push('qin', (secBars * 2 + b + 1) * tc.bpb + 1.5, 2, {
        deg: c.home - 4, vel: 0.34 + 0.12 * inten, pan: -0.25
      });
    }
    /* 丁章：诸器同流，推向顶点后回落入海 */
    for (let b = 0; b < secBars; b++) {
      const inten = prof((secBars * 3 + b + 0.5) / tc.bars);
      const swell = b < 3 ? b / 3 : Math.max(0.2, (secBars - b) / 4);
      if (b % 2 === 0) {
        c.push('xiao', (secBars * 3 + b) * tc.bpb, 4, { deg: c.home + 2, vel: 0.26 + 0.25 * swell, pan: -0.4 });
      }
      c.push('erhu', (secBars * 3 + b) * tc.bpb + 0.5, 2.6, {
        deg: c.home + c.pick([0, 1, 2]), vel: 0.3 + 0.3 * swell, slide: c.chance(0.3), pan: 0.25
      });
      if (c.chance(0.9)) {
        const anchor = c.home - 4;
        c.push('zheng', (secBars * 3 + b) * tc.bpb + (b % 2) * 0.5, 0.8, { deg: anchor, vel: 0.3 + 0.25 * swell });
        c.push('zheng', (secBars * 3 + b) * tc.bpb + 1.25, 0.8, { deg: anchor + 2, vel: 0.26 + 0.25 * swell });
        c.push('zheng', (secBars * 3 + b) * tc.bpb + 2, 0.8, { deg: anchor + 4, vel: 0.24 + 0.25 * swell });
      }
      if (b === secBars - 1) {
        /* 归位：以宫音长鸣收束，回到开头的静谧，循环自然 */
        c.push('qin', (tc.bars - 1) * tc.bpb, 3.8, { deg: c.home, vel: 0.5, pan: -0.22 });
        c.push('zhong', (tc.bars - 1) * tc.bpb, 0.6, { midi: c.deg(c.home) - 12, vel: 0.3, tauBase: 1.6 });
      }
    }
  },
  profileSelf: [0.32, 0.52, 0.68, 0.82, 0.5, 0.3],
  profFn: function () { const s = this; return function (u) { return prof(s.profileSelf, u); }; }
});

/* 11 金殿醉花阴：编钟主奏的华美宴舞（其一·华美） */
TRACKS.push({
  id: '11', slug: 'golden-hall-bloom',
  name: '金殿醉花阴', file: 'audio/bgm/11-golden-hall-bloom.mp3',
  group: '编钟两曲', scene: '编钟其一 · 华美宴舞',
  desc: '金石铿锵，丝竹缠绵，殿上灯影流转如醉。',
  bpm: 76, beatsPerBar: 4, bars: 28, seed: 20260111,
  root: 62, finalIdx: 0,
  rev: { wet: 0.42, size: 1.25, dampAmt: 0.5 },
  gen: function (c, tc) {
    const chords = [[0, 2, 4], [-3, -1, 1], [-1, 1, 3], [0, 2, 4]];
    for (let b = 0; b < tc.bars; b++) {
      const tb = b * tc.bpb;
      const inten = tc.profile((b + 0.5) / tc.bars);
      const ch = chords[Math.floor(b / 4) % chords.length];
      /* 弦乐群衬底（和弦换色），时长=4 小节 */
      if (b % 4 === 0) {
        c.push('padstr', tb, 16 * 0.98, {
          freqs: ch.map(function (d) { return midiToFreq(E.fitReg(c.deg(c.home + d) + 12, 52, 76)); }),
          vel: 0.16 + 0.1 * inten
        });
      }
      /* 编钟点唱 */
      if (b % 4 === 0 || b % 4 === 2) {
        c.push('zhong', tb, 0.5, {
          deg: c.home + ch[0] - 7, vel: b % 8 === 0 ? 0.72 : 0.5,
          grand: b % 8 === 0, tauBase: 2.0
        });
      }
      if (b % 4 === 1 && c.chance(0.7)) {
        c.push('zhong', tb + 2, 0.4, { deg: c.home + ch[2] - 7, vel: 0.4, tauBase: 1.4 });
      }
      /* 华彩流水钟（小节尾的三连闪） */
      if (c.chance(0.5 + inten * 0.3)) {
        for (let k = 0; k < 3; k++) {
          c.push('zhong', tb + 2.75 + k * 0.28, 0.3, {
            deg: c.home + 5 + c.rint(0, 4), vel: 0.3, tauBase: 0.9
          });
        }
      }
      /* 编钟齐鸣（每 8 小节的金色标点） */
      if (b % 8 === 7) {
        [0, 4, 7].forEach(function (semiOff, ix) {
          c.push('zhong', tb + 0.05 * ix, 0.5, {
            midi: c.deg(c.home) - 12 + semiOff, vel: 0.7 - ix * 0.1,
            grand: ix === 0, tauBase: 2.2
          });
        });
      }
      /* 鼓与木鱼的宴会骨架 */
      if (b % 2 === 0) c.push('kick', tb, 0.4, { vel: 0.2 + 0.14 * inten });
      c.push('muyu', tb + 1, 0.3, { fBody: 700, vel: 0.16 });
      if (c.chance(0.6)) c.push('muyu', tb + 2, 0.3, { fBody: 720, vel: 0.13, pan: -0.05 });
      /* 筝的华彩过门 */
      if (b % 2 === 1) {
        const anchor = c.home - 4;
        for (let k = 0; k < 4; k++) {
          c.push('zheng', tb + 0.5 + k * 0.6, 0.5, {
            deg: [anchor, anchor + 2, anchor + 4, anchor + 5][k],
            vel: 0.3 + 0.2 * inten, mute: c.chance(0.2)
          });
        }
      }
      /* 笛子领舞段（后三分之一加入） */
      if (b >= 18 && b % 2 === 0) {
        c.push('di', tb, 3, {
          deg: c.home + 2 + c.pick([-2, 0, 1]), vel: 0.34 + 0.2 * inten, pan: 0.4
        });
      }
    }
  },
  profileSelf: [0.5, 0.66, 0.8, 0.95, 0.85, 0.55],
  profFn: function () { const s = this; return function (u) { return prof(s.profileSelf, u); }; }
});

/* 12 夜宴迷楼：编钟幽鸣的暧昧夜宴（其二·幽艳） */
TRACKS.push({
  id: '12', slug: 'night-banquet-labyrinth',
  name: '夜宴迷楼', file: 'audio/bgm/12-night-banquet-labyrinth.mp3',
  group: '编钟两曲', scene: '编钟其二 · 幽艳幻境',
  desc: '钟声在回廊里拐了几个弯才到你耳边，半音里藏着醉意。',
  bpm: 61, beatsPerBar: 4, bars: 24, seed: 20260112,
  root: 56, finalIdx: 4,
  rev: { wet: 0.56, size: 1.7, dampAmt: 0.38 },
  gen: function (c, tc) {
    const totalBeats = tc.bars * tc.bpb;
    /* 巨大的低频心跳（很少但贴着大地） */
    for (let b = 0; b < tc.bars; b += 8) {
      c.push('kick', b * tc.bpb, 0.5, { vel: 0.13 });
    }
    /* 幽深的编钟——不规则的钟摆位置 */
    let bt = 0;
    let tollCount = 0;
    while (bt < totalBeats - 6) {
      const low = tollCount % 2 === 0;
      c.push('zhong', bt, 0.6, {
        midi: low ? c.deg(c.home) - 17 : c.deg(c.home) - 8,
        vel: low ? 0.62 : 0.4,
        grand: low, tauBase: low ? 2.4 : 1.6
      });
      /* 磬的回声——迟一点、高一点、更飘 */
      if (c.chance(0.8)) {
        c.push('qing', bt + 1.4, 0.5, {
          midi: c.deg(c.home) + 19 + c.rint(0, 5), vel: 0.2 + c.rng() * 0.16,
          pan: (c.rng() * 2 - 1) * 0.6
        });
        if (c.chance(0.5)) {
          c.push('qing', bt + 2.6, 0.5, {
            midi: c.deg(c.home) + 22 + c.rint(0, 4), vel: 0.12 + c.rng() * 0.1,
            pan: (c.rng() * 2 - 1) * 0.6
          });
        }
      }
      tollCount++;
      bt += 6 + Math.floor(c.rng() * 5) + (low ? 1 : 0);
    }
    /* 弦群幻影——两个声部的缓慢移动 */
    const drift = [[0, 4], [1, 4], [2, 5], [0, 4]];
    for (let s = 0; s < tc.bars / 4; s++) {
      const tb = s * 4 * tc.bpb;
      const d = drift[s % drift.length];
      c.push('padstr', tb, 4 * tc.bpb * 0.98, {
        freqs: d.map(function (dd) { return midiToFreq(E.fitReg(c.deg(c.home + dd) + 12, 52, 78)); }),
        vel: 0.14
      });
    }
    /* 醉的二胡——二度、三度的缠绵与半音滑靠 */
    let et = 2;
    let ed = c.home + 1;
    while (et < totalBeats - 6) {
      const d = c.pick([2.5, 3, 3.5]);
      c.push('erhu', et, d, {
        deg: ed, vel: 0.34 + c.rng() * 0.16,
        slide: c.chance(0.55), chroma: c.chance(0.35), pan: 0.25
      });
      /* 半音邻音的魅影（装饰性偏音，只擦边不停留） */
      if (c.chance(0.4)) {
        c.push('erhu', et + d + 0.15, 0.4, {
          midi: c.deg(ed) + (c.chance(0.5) ? 1 : -1) / 1, /* 半音侧影 */
          vel: 0.2, pan: 0.3
        });
      }
      ed += c.pick([-3, -2, -1, 2, 3, 1, -1]);
      if (ed > c.home + 6) ed -= 4;
      if (ed < c.home - 5) ed += 4;
      et += d + 1.5 + c.rng() * 2;
    }
    /* 水滴般的磬铃点缀回声通道 */
    let qt = 5;
    while (qt < totalBeats - 4) {
      c.push('qing', qt, 0.5, {
        midi: c.deg(c.home) + 24 + c.rint(-4, 7), vel: 0.14 + c.rng() * 0.14,
        pan: (c.rng() * 2 - 1) * 0.7
      });
      qt += 9 + c.rng() * 13;
    }
  },
  profileSelf: [0.4, 0.52, 0.62, 0.7, 0.6, 0.42],
  profFn: function () { const s = this; return function (u) { return prof(s.profileSelf, u); }; }
});

/* ---------- 强度曲线工具：折线插值 ---------- */
function prof(pts, u) {
  u = Math.max(0, Math.min(1, u));
  const seg = 1 / (pts.length - 1);
  const fi = Math.min(pts.length - 2, Math.floor(u / seg));
  const f = (u - fi * seg) / seg;
  return pts[fi] * (1 - f) + pts[fi + 1] * f;
}

/* 为没有自定义 profiler 的标准轨道补齐基础回调；并统一 bpb 别名 */
TRACKS.forEach(function (t) {
  t.bpb = t.beatsPerBar;
  t.profile = function (u) { return prof(t.profileSelf, u); };
  if (!t.profFn) t.profFn = function () { return t.profile; };
  if (!t.arpcfg) t.arpcfg = function () {
    return { bars: t.bars, bpb: t.beatsPerBar, profile: t.profile };
  };
});

module.exports = {
  TRACKS: TRACKS,
  buildCtx: buildCtx,
  loopSecOf: loopSecOf,
  prof: prof,
  PENT: PENT,
  PENT_NAME: PENT_NAME
};
