'use strict';
/*
 * tools/bgm/engine.js —— 背景音乐合成音源库
 * 纯 Node DSP 实现，无第三方依赖；被 tools/bgm/render.js 与 test/bgm-check.js 引用。
 *
 * 音源：Karplus-Strong 拨弦（古琴/古筝）、箫/笛（正弦泛音+气声）、二胡（加法合成+共振峰）、
 *       编钟/编磬（非谐分音）、木鱼/软鼓/水滴、风声水声铺底、弦乐群衬底。
 * 效果：自由场混响（freeverb 式梳齿+全通），循环尾回卷，直流阻断+柔和低通母带。
 * 全部运算由传入种子驱动，可复现。
 */

var SR = 44100;

/* 真实采样库（可选）：render.js 传入时，映射内乐器优先用采样回放，失败回退合成 */
var SB = require('./samplebank.js');

/* ---------------- 确定性随机 ---------------- */
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function fitReg(midi, lo, hi) {
  while (midi < lo) midi += 12;
  while (midi > hi) midi -= 12;
  return midi;
}

function newMix(frames) {
  return { frames: frames, L: new Float64Array(frames), R: new Float64Array(frames) };
}
function panGains(pan) {
  var a = (clamp(pan, -1, 1) + 1) * Math.PI / 4;
  return [Math.cos(a), Math.sin(a)];
}

/* 把一段已渲染的单声道采样按声像写入立体声总线 */
function blit(mix, n0, sig, g, pan) {
  var pg = panGains(pan), gl = pg[0] * g, gr = pg[1] * g;
  var L = mix.L, R = mix.R, n = sig.length;
  var total = mix.frames - n0;
  if (total <= 0) return;
  if (n > total) n = total;
  for (var i = 0; i < n; i++) {
    L[n0 + i] += sig[i] * gl;
    R[n0 + i] += sig[i] * gr;
  }
}

/* ---------------- 音源工厂（绑定一个确定性噪声源） ---------------- */
function createVoices(rand) {
  function nz() { return rand() * 2 - 1; }

  /* Karplus-Strong 拨弦：qin(暗长)、zheng(亮短)、mute(止音跳短) */
  function ksPluck(mix, n0, freq, vel, o) {
    var tau = o.tau || 1.6;
    var damp = o.damp || 0.996;
    var bright = clamp(o.bright != null ? o.bright : 0.35, 0.02, 0.98);
    var level = (o.level || 1) * Math.pow(clamp(vel, 0, 1), o.vexp || 1.2);
    var N = Math.max(2, Math.round(SR / freq));
    var len = Math.min(mix.frames - n0, Math.ceil((o.tail || tau * 5.5) * SR));
    if (len <= 8) return null;
    var line = new Float64Array(N);
    var lp = 0, i;
    for (i = 0; i < N; i++) {
      lp += (nz() - lp) * (0.05 + 0.9 * bright);
      line[i] = lp * level;
    }
    var out = new Float64Array(len);
    var prev = 0, idx = 0, de = Math.exp(-1 / (SR * tau));
    var env = 1;
    var atk = Math.max(4, Math.round(SR * 0.0012));
    for (i = 0; i < len; i++) {
      var cur = line[idx];
      line[idx] = damp * 0.5 * (cur + prev);
      prev = cur;
      var s = cur * env;
      if (i < atk) s *= i / atk;
      out[i] = s;
      env *= de;
      idx++; if (idx >= N) idx = 0;
    }
    return out;
  }

  /* 箫：正弦基波+衰减高次泛音+气声带通噪声；glide 自下滑入，vibrato 延迟渐入 */
  function flute(mix, n0, freq, durS, vel, o) {
    var harm = o.harm || [1, 0.30, 0.10];
    var noiseAmt = o.noise != null ? o.noise : 0.16;
    var level = (o.level || 1) * Math.pow(clamp(vel, 0, 1), 1.15);
    var glideS = Math.min(o.glideS != null ? o.glideS : 0.09, durS * 0.4);
    var atkS = Math.min(o.atkS != null ? o.atkS : 0.075, durS * 0.45);
    var relS = Math.min(o.relS != null ? o.relS : 0.26, durS * 0.5);
    var totalS = durS + relS;
    var len = Math.min(mix.frames - n0, Math.ceil(totalS * SR));
    if (len <= 16) return null;
    var sig = new Float64Array(len);
    var f1 = freq * (o.fromRatio || 0.965);
    var dg = (freq - f1) / Math.max(1, glideS * SR);
    var vibRate = o.vibRate || 4.6, vibDepth = o.vibDepth != null ? o.vibDepth : 0.0045;
    var vibDelayS = Math.min(durS * 0.22, 1.2), vibRampS = Math.max(0.4, durS * 0.3);
    var ph1 = 0, ph2 = Math.PI * 0.31, ph3 = Math.PI * 0.67, phV = rand() * 6.28;
    var pv1 = 2 * Math.PI * f1 / SR, inc2 = 2 * Math.PI * 2 / SR, inc3 = 2 * Math.PI * 3 / SR;
    var pvRate = 2 * Math.PI * vibRate / SR;
    var atkN = Math.max(4, atkS * SR), relN = Math.max(8, relS * SR);
    var bodyN = Math.round(durS * SR);
    var inhale = Math.max(0, Math.min(atkN * 1.6, 0.18 * SR)); /* 起音吐气稍重 */
    /* 气声噪声：一个简单的带通（对白噪做单极低通+减法高通近似） */
    var nb = 0, nbPrev = 0;
    var k = 0, eEnv = 1, eDec = Math.exp(-1 / (SR * 0.055));
    for (k = 0; k < len; k++) {
      var fi = f1;
      if (k < bodyN && k < glideS * SR) fi = f1 + dg * k;
      var ve = 0;
      if (k > vibDelayS * SR) {
        ve = vibDepth * Math.min(1, (k - vibDelayS * SR) / (vibRampS * SR));
      }
      phV += pvRate;
      var fm = 1 + ve * Math.sin(phV);
      var w1 = 2 * Math.PI * fi * fm / SR;
      ph1 += w1; ph2 += w1; ph3 += w1;
      if (ph1 > 6.283185307179586) ph1 -= 6.283185307179586;
      if (ph2 > 12.566370614359172) ph2 -= 12.566370614359172;
      if (ph3 > 18.84955592153876) ph3 -= 18.84955592153876;
      var tone = Math.sin(ph1) * harm[0];
      if (harm.length > 1) tone += Math.sin(ph2) * harm[1];
      if (harm.length > 2) tone += Math.sin(ph3) * harm[2];
      var wnv = nz();
      nb += (wnv - nb) * 0.32;                 /* 低通 */
      var bp = wnv - nb;                        /* 高通分量 */
      var breathe = bp * noiseAmt * (k < inhale ? 1.8 : 1.0);
      var amp = level;
      if (k < atkN) amp *= k / atkN;
      else if (k > bodyN) amp *= Math.exp(-(k - bodyN) / (relN * 0.42));
      else amp *= 0.86 + 0.14 * Math.sin(k / SR * 2.2); /* 弱呼吸起伏 */
      eEnv *= eDec; /* 保留供扩展 */
      var j = nbPrev; nbPrev = breathe;
      sig[k] = (tone + breathe) * amp * 0.5 + j * 0.0001; /* 微量串气 */
    }
    return sig;
  }

  /* 二胡：加法谐波+琴筒共振峰双峰+弓压颤动+延迟揉弦，支持滑音起手 */
  function erhu(mix, n0, freq, durS, vel, o) {
    var level = (o.level || 1) * Math.pow(clamp(vel, 0, 1), 1.1);
    var K = 14;
    var harm = new Float64Array(K + 1);
    for (var kk = 1; kk <= K; kk++) harm[kk] = (1 / kk) * Math.exp(-(kk - 1) / 6.5);
    /* 归一 */
    var hsum = 0; for (kk = 1; kk <= K; kk++) hsum += harm[kk];
    for (kk = 1; kk <= K; kk++) harm[kk] /= hsum / 1.9;
    var fromRatio = o.fromRatio != null ? o.fromRatio : (o.slide ? 0.93 : 1.0);
    var glideS = Math.min(o.slide ? 0.13 : (o.glideS || 0), durS * 0.35);
    var atkN = Math.max(64, Math.round(Math.min(0.15, durS * 0.3) * SR));
    var relN = Math.max(128, Math.round(Math.min(0.30, durS * 0.45) * SR));
    var bodyN = Math.round(durS * SR);
    var len = Math.min(mix.frames - n0, bodyN + relN);
    if (len <= 64) return null;
    /* 共振峰两处峰值滤波（RBJ peaking EQ，直接 I 型） */
    function biq(f0, Q, gainDb) {
      var A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * f0 / SR, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Q);
      var b0 = 1 + al * A, b1 = -2 * cs, b2 = 1 - al * A;
      var a0 = 1 + al / A, a1 = -2 * cs, a2 = 1 - al / A;
      return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    }
    var fq1 = biq(560, 3.2, 7), fq2 = biq(1020, 3.6, 5.5);
    var f1x1 = 0, f1x2 = 0, f1y1 = 0, f1y2 = 0;
    var f2x1 = 0, f2x2 = 0, f2y1 = 0, f2y2 = 0;
    var wk = new Float64Array(K + 1);
    for (kk = 1; kk <= K; kk++) wk[kk] = 2 * Math.PI * freq * kk / SR;
    var phk = new Float64Array(K + 1);
    var phV = rand() * 6.28, pvV = 2 * Math.PI * 5.2 / SR;
    var phF = 0, pvF = 2 * Math.PI * 5.0 / SR;
    var vibDelay = Math.min(bodyN * 0.3, SR * 1.1);
    var vibReach = Math.max(SR * 0.5, bodyN * 0.5);
    var out = new Float64Array(len);
    var df0 = freq * fromRatio, dfg = (freq - df0) / Math.max(1, glideS * SR);
    for (var i = 0; i < len; i++) {
      var fi = freq;
      if (i < glideS * SR) fi = df0 + dfg * i;
      phV += pvV; phF += pvF;
      var flut = 1 + 0.05 * Math.sin(phF);
      var vmag = i > vibDelay ? Math.min(1, (i - vibDelay) / vibReach) : 0;
      var fv = fi * flut * (1 + 0.011 * vmag * Math.sin(phV));
      var y = 0;
      for (var h = 1; h <= K; h++) {
        phk[h] += wk[h] * fv / freq;
        if (phk[h] > 6.283185307179586 * 1.6) phk[h] -= 6.283185307179586 * 1.6;
        y += Math.sin(phk[h]) * harm[h];
      }
      /* 双共振峰串联（直接 I 型） */
      var t1 = fq1[0] * y + fq1[1] * f1x1 + fq1[2] * f1x2 - fq1[3] * f1y1 - fq1[4] * f1y2;
      f1x2 = f1x1; f1x1 = y; f1y2 = f1y1; f1y1 = t1;
      var t2 = fq2[0] * t1 + fq2[1] * f2x1 + fq2[2] * f2x2 - fq2[3] * f2y1 - fq2[4] * f2y2;
      f2x2 = f2x1; f2x1 = t1; f2y2 = f2y1; f2y1 = t2;
      var smp = t2 * 0.8;
      /* 起弓摩擦 */
      if (i < atkN * 0.4) smp += nz() * 0.05 * (1 - i / (atkN * 0.4));
      var amp = level;
      if (i < atkN) amp *= i / atkN;
      else if (i > bodyN) amp *= Math.exp(-(i - bodyN) / (relN * 0.5));
      out[i] = smp * amp;
    }
    return out;
  }

  /* 编钟：非谐分音簇，双耳去相关（正负音分双层）；grand 时附加低八度嗡音 */
  function zhong(mix, n0, freq, vel, o) {
    var level = (o.level || 1) * Math.pow(clamp(vel, 0, 1), 1.35);
    var reg = Math.pow(clamp(280 / freq, 0.4, 2.6), 0.42); /* 越低余韵越长 */
    var tauBase = (o.tauBase || 2.2) * reg;
    var pr = o.partials || [1, 1.59, 2.52, 3.36, 4.31];
    var pa = o.pamps || [1, 0.55, 0.38, 0.22, 0.13];
    var extra = [];
    if (o.grand) extra.push({ r: 0.5, a: 0.4, tm: 1.9 });
    var layers = [
      { det: 1.0016, lw: 0.62, rw: 0.42 },
      { det: 0.9984, lw: 0.42, rw: 0.62 }
    ];
    var tauMax = 0, li, pi;
    for (pi = 0; pi < pr.length; pi++) tauMax = Math.max(tauMax, tauBase / (1 + pi * 0.55));
    if (extra.length) for (li = 0; li < extra.length; li++) tauMax = Math.max(tauMax, tauBase * extra[li].tm);
    var len = Math.min(mix.frames - n0, Math.ceil(tauMax * 4.2 * SR));
    if (len <= 32) return null;
    /* 敲击瞬态（高频微分噪声） */
    var st = new Float64Array(len);
    var sn = Math.min(len, Math.round(SR * 0.004));
    var sd = 0;
    for (li = 0; li < sn; li++) {
      var w2 = nz(); sd += (w2 - sd) * 0.6;
      st[li] = (w2 - sd) * 1.4 * (1 - li / sn);
    }
    var outs = [];
    for (li = 0; li < layers.length; li++) outs.push(new Float64Array(len));
    for (var ly = 0; ly < layers.length; ly++) {
      var Ly = layers[ly], buf = outs[ly];
      var phArr = [], decArr = [], amArr = [], idxO = 0;
      for (pi = 0; pi < pr.length; pi++) {
        var tauPi = tauBase / (1 + pi * 0.55);
        phArr.push(0);
        decArr.push(Math.exp(-1 / (SR * Math.max(0.05, tauPi))));
        amArr.push(pa[pi]);
      }
      for (pi = 0; pi < extra.length; pi++) {
        phArr.push(0);
        decArr.push(Math.exp(-1 / (SR * tauBase * extra[pi].tm)));
        amArr.push(extra[pi].a);
      }
      var rateMul = [];
      for (pi = 0; pi < pr.length; pi++) rateMul.push(2 * Math.PI * freq * pr[pi] * Ly.det / SR);
      if (extra.length) rateMul.push(2 * Math.PI * freq * extra[0].r * Ly.det / SR);
      var eN = [], eV = [];
      for (pi = 0; pi < decArr.length; pi++) { eN.push(1); eV.push(decArr[pi]); }
      for (var i2 = 0; i2 < len; i2++) {
        var sm = 0;
        for (pi = 0; pi < rateMul.length; pi++) {
          phArr[pi] += rateMul[pi];
          if (phArr[pi] > 19.0) phArr[pi] -= 6.283185307179586 * 2;
          sm += Math.sin(phArr[pi]) * eN[pi] * amArr[pi];
          eN[pi] *= eV[pi];
        }
        buf[i2] += sm * level * 0.5;
      }
      for (var j2 = 0; j2 < sn; j2++) buf[j2] += st[j2] * level * 0.35;
    }
    return { ch: outs, lw: layers[0].lw, rw: layers[0].rw };
  }

  /* 编磬：清亮短鸣 */
  function qing(mix, n0, freq, vel, o) {
    var level = (o.level || 1) * Math.pow(clamp(vel, 0, 1), 1.3);
    var tau = (o.tau || 1.15) * Math.pow(clamp(1600 / freq, 0.5, 1.6), 0.5);
    var pr = [1, 2.756, 5.404], pa = [1, 0.26, 0.09];
    var len = Math.min(mix.frames - n0, Math.ceil(tau * 3.6 * SR));
    if (len <= 16) return null;
    var sig = new Float64Array(len);
    var ph = [0, 0, 0], en = [1, 1, 1];
    var rt = [pr[0], pr[1], pr[2]].map(function (r) { return 2 * Math.PI * freq * r / SR; });
    var dc = [1, 2, 3].map(function (k) { return Math.exp(-1 / (SR * tau / k)); });
    for (var i = 0; i < len; i++) {
      var s = 0;
      for (var p = 0; p < 3; p++) { ph[p] += rt[p]; if (ph[p] > 19) ph[p] -= 12.566; s += Math.sin(ph[p]) * en[p] * pa[p]; en[p] *= dc[p]; }
      if (i < 8) s *= i / 8;
      sig[i] = s * level * 0.6;
    }
    return sig;
  }

  /* 木鱼 */
  function muyu(mix, n0, fBody, vel) {
    var level = 0.5 * Math.pow(clamp(vel, 0, 1), 1.5);
    var len = Math.min(mix.frames - n0, Math.round(SR * 0.14));
    if (len <= 16) return null;
    var sig = new Float64Array(len);
    var ph = 0, wr = 2 * Math.PI * fBody / SR;
    var nd = 0;
    for (var i = 0; i < len; i++) {
      ph += wr; if (ph > 6.283) ph -= 6.283;
      var w = nz();
      var lpN = (nd += (w - nd) * 0.35);
      var e = Math.exp(-i / (SR * 0.038));
      sig[i] = (Math.sin(ph) * 0.8 + (w - lpN) * 0.5 * (i < SR * 0.006 ? 1 : 0.15)) * e * level;
      if (i < 6) sig[i] *= i / 6;
    }
    return sig;
  }

  /* 软鼓：短促下沉的鼓心，几乎贴地不被听见但撑住骨架 */
  function kick(mix, n0, vel) {
    var level = 0.6 * Math.pow(clamp(vel, 0, 1), 1.4);
    var len = Math.min(mix.frames - n0, Math.round(SR * 0.24));
    if (len <= 16) return null;
    var sig = new Float64Array(len);
    var ph = 0;
    var f0 = 150, f1 = 58, durN = Math.round(SR * 0.075);
    for (var i = 0; i < len; i++) {
      var fr = i < durN ? f0 * Math.exp(Math.log(f1 / f0) * (i / durN)) : f1;
      ph += 2 * Math.PI * fr / SR;
      var e = Math.exp(-i / (SR * 0.07));
      var click = i < SR * 0.004 ? nz() * 0.25 * (1 - i / (SR * 0.004)) : 0;
      sig[i] = (Math.sin(ph) + click) * e * level;
      if (i < 5) sig[i] *= i / 5;
    }
    return sig;
  }

  /* 水滴：快速上滑的正弦，清凌凌一点 */
  function drop(mix, n0, f0, vel) {
    var level = 0.34 * Math.pow(clamp(vel, 0, 1), 1.2);
    var len = Math.min(mix.frames - n0, Math.round(SR * 0.30));
    if (len <= 16) return null;
    var sig = new Float64Array(len);
    var ph = 0, riseN = Math.round(SR * 0.07);
    for (var i = 0; i < len; i++) {
      var fr = f0 * (i < riseN ? Math.exp(Math.log(1.75) * (i / riseN)) : 1.75);
      ph += 2 * Math.PI * fr / SR;
      var e = Math.exp(-i / (SR * 0.075));
      sig[i] = Math.sin(ph) * e * level;
      if (i < 4) sig[i] *= i / 4;
    }
    return sig;
  }

  /* 风声铺底：粉噪 + 缓动低通 + 极慢呼吸包络，左右独立；
     整曲长度的风底用 noFade 让循环回卷自然衔接 */
  function windBed(mix, n0, durS, vel, o) {
    var level = (o.level || 1) * vel;
    var cut = o.cut || 480, wob = o.wob != null ? o.wob : 0.55;
    var noFade = !!o.noFade;
    var len = Math.min(mix.frames - n0, Math.round(durS * SR));
    if (len <= 64) return;
    var fade = noFade ? 0 : Math.round(Math.min(3, durS / 4) * SR);
    var chans = [mix.L, mix.R];
    for (var c = 0; c < 2; c++) {
      var dst = chans[c];
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      var lpState = 0;
      var phSlow = rand() * 6.28, phSlow2 = rand() * 6.28;
      var wk = 2 * Math.PI * 0.045 / SR, wk2 = 2 * Math.PI * 0.13 / SR;
      for (var i = 0; i < len; i++) {
        var wn = rand() * 2 - 1;
        b0 = 0.99886 * b0 + wn * 0.0555179;
        b1 = 0.99332 * b1 + wn * 0.0750759;
        b2 = 0.96900 * b2 + wn * 0.1538520;
        b3 = 0.86650 * b3 + wn * 0.3104856;
        b4 = 0.55000 * b4 + wn * 0.5329522;
        b5 = -0.7616 * b5 - wn * 0.0168980;
        var pnk = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + wn * 0.5362) * 0.11;
        b6 = wn * 0.115926;
        phSlow += wk; phSlow2 += wk2;
        var alpha = clamp((cut * (1 + wob * 0.5 * Math.sin(phSlow) + 0.25 * wob * Math.sin(phSlow2))) / (SR * 0.5), 0.008, 0.9);
        lpState += (pnk - lpState) * alpha;
        var g = level * (0.9 + 0.3 * Math.sin(phSlow2 * 0.37));
        if (i < fade) g *= i / fade;
        else if (i > len - fade) g *= (len - i) / fade;
        dst[n0 + i] += lpState * g * 0.5;
      }
    }
  }

  /* 低音持续（根音+五度）弦底 */
  function drone(mix, n0, freq, durS, vel, o) {
    var level = (o.level || 1) * vel;
    var len = Math.min(mix.frames - n0, Math.round(durS * SR));
    if (len <= 64) return;
    var att = Math.round(Math.min(4, durS / 4) * SR);
    var phs = [0, 0.9, 2.1, 3.3];
    var fr = [freq / 2, freq * 3 / 4, freq, freq / 2 * 1.0022];
    var am = [0.5, 0.22, 0.3, 0.3];
    var phSlow = rand() * 6.28;
    var wk = 2 * Math.PI * 0.07 / SR;
    for (var i = 0; i < len; i++) {
      phSlow += wk;
      var s = 0;
      for (var v = 0; v < fr.length; v++) {
        phs[v] += 2 * Math.PI * fr[v] / SR;
        if (phs[v] > 6.2832) phs[v] -= 6.2832;
        s += Math.sin(phs[v]) * am[v];
      }
      var g = level * (0.85 + 0.15 * Math.sin(phSlow)) * 0.38;
      if (i < att) g *= i / att;
      else if (i > len - att) g *= (len - i) / att;
      mix.L[n0 + i] += s * g;
      mix.R[n0 + i] += s * g;
    }
  }

  /* 宫廷弦乐群衬底：多音叠加、奇偶次谐波弱化、缓慢起伏 */
  function padstr(mix, n0, freqs, durS, vel, o) {
    var level = (o.level || 1) * vel;
    var len = Math.min(mix.frames - n0, Math.round(durS * SR));
    if (len <= 64) return;
    var att = Math.round(Math.min(2.5, durS / 4) * SR);
    var parts = [0.55, 0.3, 0.18, 0.10, 0.06];
    var voices = [];
    for (var v = 0; v < freqs.length; v++) {
      voices.push({
        f: freqs[v],
        det: [0.9992, 1.0009],
        ph: [rand() * 6.28, rand() * 6.28],
        wo: rand() * 6.28,
        g: (0.8 + 0.4 * ((v % 3) / 3))
      });
    }
    var wk = 2 * Math.PI * 0.09 / SR;
    for (var i = 0; i < len; i++) {
      var sL = 0, sR = 0;
      for (v = 0; v < voices.length; v++) {
        var vo = voices[v];
        vo.wo += wk;
        var sw = 0.82 + 0.18 * Math.sin(vo.wo);
        for (var d = 0; d < 2; d++) {
          var fpitch = vo.f * vo.det[d];
          var s = 0;
          for (var h = 0; h < parts.length; h++) {
            vo.ph[d] += 2 * Math.PI * fpitch * (h + 1) / SR;
            if (vo.ph[d] > 18.85) vo.ph[d] -= 12.566;
            s += Math.sin(vo.ph[d]) * parts[h];
          }
          if (d === 0) sL += s * vo.g; else sR += s * vo.g;
        }
      }
      var g = level * sw * 0.30;
      if (i < att) g *= i / att;
      else if (i > len - att) g *= (len - i) / att;
      mix.L[n0 + i] += sL * g;
      mix.R[n0 + i] += sR * g;
    }
  }

  return {
    ksPluck: ksPluck,
    flute: flute,
    erhu: erhu,
    zhong: zhong,
    qing: qing,
    muyu: muyu,
    kick: kick,
    drop: drop,
    windBed: windBed,
    drone: drone,
    padstr: padstr
  };
}

/* 事件分发：把作曲层的事件渲染进混音总线（有采样库时优先采样，失败回退合成） */
function dispatch(mix, voices, ev, bank) {
  var n0 = Math.max(0, Math.floor(ev.tS * SR));
  if (n0 >= mix.frames - 16) return;
  /* 频率防御：非有限/超低频的乐器事件直接丢弃，避免污染混音 */
  if (ev.freq != null && (!isFinite(ev.freq) || ev.freq < 20)) return;
  /* 真实采样优先 */
  if (bank && SB.SAMPLE_MAP[ev.inst]) {
    var ssig = SB.sampleRender(bank, ev);
    if (ssig) {
      blit(mix, n0, ssig, 1, ev.pan != null ? ev.pan : 0);
      return;
    }
  }
  switch (ev.inst) {
    case 'qin':
      blit(mix, n0, voices.ksPluck(mix, n0, ev.freq, ev.vel, { tau: ev.durS > 4 ? 2.4 : 1.7, damp: 0.9965, bright: 0.22 + ev.vel * 0.12, tail: Math.min(ev.durS * 2.2 + 1.2, 12), level: 0.66 }), 1, ev.pan != null ? ev.pan : -0.25);
      break;
    case 'qharm': /* 古琴泛音 */
      blit(mix, n0, voices.qing(mix, n0, ev.freq, ev.vel, { tau: 0.65, level: 0.5 }), 1, ev.pan != null ? ev.pan : -0.2);
      break;
    case 'zheng':
      blit(mix, n0, voices.ksPluck(mix, n0, ev.freq, ev.vel, { tau: ev.mute ? 0.22 : 1.15, damp: ev.mute ? 0.985 : 0.997, bright: 0.55, tail: ev.mute ? 0.4 : 3.2, level: 0.6 }), 1, ev.pan != null ? ev.pan : 0.3);
      break;
    case 'xiao':
      blit(mix, n0, voices.flute(mix, n0, ev.freq, ev.durS, ev.vel, { harm: [1, 0.30, 0.10], noise: 0.17, level: 0.60, fromRatio: 0.968 }), 1, ev.pan != null ? ev.pan : -0.42);
      break;
    case 'di':
      blit(mix, n0, voices.flute(mix, n0, ev.freq, ev.durS, ev.vel, { harm: [1, 0.5, 0.24], noise: 0.13, vibRate: 5.4, level: 0.52, fromRatio: 0.975 }), 1, ev.pan != null ? ev.pan : 0.4);
      break;
    case 'erhu':
      blit(mix, n0, voices.erhu(mix, n0, ev.freq, ev.durS, ev.vel, { slide: !!ev.slide, chroma: !!ev.chroma, level: 0.62 }), 1, ev.pan != null ? ev.pan : 0.22);
      break;
    case 'zhong': {
      var res = voices.zhong(mix, n0, ev.freq, ev.vel, { grand: !!ev.grand, tauBase: ev.tauBase });
      if (res) {
        var n0b = Math.max(0, Math.floor(ev.tS * SR));
        for (var c = 0; c < 2; c++) {
          var sg = res.ch[c], gg = c === 0 ? res.lw : res.rw, dst = c === 0 ? mix.L : mix.R;
          var lim = Math.min(sg.length, mix.frames - n0b);
          for (var i = 0; i < lim; i++) dst[n0b + i] += sg[i] * gg;
        }
      }
      break;
    }
    case 'qing':
      blit(mix, n0, voices.qing(mix, n0, ev.freq, ev.vel, {}), 1, ev.pan != null ? ev.pan : 0.38);
      break;
    case 'muyu':
      blit(mix, n0, voices.muyu(mix, n0, ev.fBody || 640, ev.vel), 1, ev.pan != null ? ev.pan : 0.15);
      break;
    case 'kick':
      blit(mix, n0, voices.kick(mix, n0, ev.vel), 1, 0);
      break;
    case 'drop':
      blit(mix, n0, voices.drop(mix, n0, ev.freq, ev.vel), 1, ev.pan != null ? ev.pan : 0);
      break;
    case 'wind':
      voices.windBed(mix, n0, ev.durS, ev.vel, { noFade: !!ev.noFade });
      break;
    case 'drone':
      voices.drone(mix, n0, ev.freq, ev.durS, ev.vel, {});
      break;
    case 'padstr': {
      /* 宫廷弦乐群衬底：有笙采样时改为逐音叠真实笙长音 */
      if (bank && bank.byKey['sheng/sustain'] && ev.freqs && ev.freqs.length) {
        var shengOk = false;
        for (var si = 0; si < ev.freqs.length; si++) {
          var shg = SB.sampleRender(bank, { inst: 'sheng', freq: ev.freqs[si], durS: ev.durS, vel: ev.vel });
          if (shg) {
            blit(mix, n0, shg, 0.5, (si % 2 === 0 ? -0.18 : 0.18));
            shengOk = true;
          }
        }
        if (shengOk) break;
      }
      voices.padstr(mix, n0, ev.freqs, ev.durS, ev.vel, {});
      break;
    }
    default:
      break;
  }
}

/* ---------------- 混响（freeverb 式） ---------------- */
function makeReverb(wet, size, dampAmt) {
  wet = clamp(wet, 0, 0.9); size = clamp(size || 1, 0.5, 2); dampAmt = clamp(dampAmt != null ? dampAmt : 0.5, 0, 0.95);
  var sc = size * SR / 44100;
  var combMs = [29.7, 37.1, 41.1, 43.7];
  var sides = [];
  for (var s = 0; s < 2; s++) {
    var combs = [];
    for (var ci = 0; ci < combMs.length; ci++) {
      var off = s === 0 ? 0 : 23 * (ci + 1);
      combs.push({
        buf: new Float64Array(Math.max(4, Math.round(combMs[ci] * sc + off))),
        idx: 0, filt: 0
      });
    }
    var aps = [];
    for (ci = 0; ci < 2; ci++) {
      var ms = (ci === 0 ? 5.0 : 1.7) + (s === 1 ? 0.4 : 0);
      aps.push({ buf: new Float64Array(Math.max(4, Math.round(ms * sc))), idx: 0 });
    }
    sides.push({ combs: combs, aps: aps });
  }
  var fb = 0.80, damp = 1 - dampAmt; /* damp 大→更亮 */
  function process(mix) {
    var F = mix.frames, srcs = [mix.L, mix.R];
    for (var c = 0; c < 2; c++) {
      var src = srcs[c], sd = sides[c];
      for (var i = 0; i < F; i++) {
        var inp = src[i] * 0.5;
        var acc = 0;
        for (var k = 0; k < sd.combs.length; k++) {
          var cb = sd.combs[k];
          var outc = cb.buf[cb.idx];
          cb.filt = outc * damp + cb.filt * (1 - damp);
          cb.buf[cb.idx] = inp + cb.filt * fb;
          if (++cb.idx >= cb.buf.length) cb.idx = 0;
          acc += outc;
        }
        for (k = 0; k < sd.aps.length; k++) {
          var ap = sd.aps[k];
          var bufin = acc, bufout = ap.buf[ap.idx];
          acc = -acc + bufout;
          ap.buf[ap.idx] = bufin + bufout * 0.5;
          if (++ap.idx >= ap.buf.length) ap.idx = 0;
        }
        var dry = src[i];
        src[i] = dry * (1 - wet) + acc * 0.28 * wet * 2.0;
      }
    }
  }
  return { process: process };
}

/* ---------------- 循环尾回卷：把 [loop, loop+tail) 折回头部 ---------------- */
function foldWrap(mix, loopLen, tailLen) {
  var lim = Math.min(loopLen, tailLen);
  for (var f = 0; f < lim; f++) {
    mix.L[f] += mix.L[loopLen + f];
    mix.R[f] += mix.R[loopLen + f];
    mix.L[loopLen + f] = 0; mix.R[loopLen + f] = 0;
  }
  return lim;
}

/* ---------------- 母带：软压缩 + 直流阻断 + 柔和低通 + 响度匹配 ---------------- */
function master(mix, loopLen, targetDb) {
  /* 轻压拨弦瞬态、抬整体响度：包络检波 + 下行压缩 */
  var env = 0, aAtk = Math.exp(-1 / (SR * 0.004)), aRel = Math.exp(-1 / (SR * 0.11));
  var thr = 0.14, ratio = 4;
  for (var i0 = 0; i0 < loopLen; i0++) {
    var m0 = Math.max(Math.abs(mix.L[i0]), Math.abs(mix.R[i0]));
    env = m0 > env ? aAtk * env + (1 - aAtk) * m0 : aRel * env + (1 - aRel) * m0;
    var gain = env > thr ? (thr + (env - thr) / ratio) / env : 1;
    mix.L[i0] *= gain; mix.R[i0] *= gain;
  }
  /* 直流阻断 + 两级柔和低通 */
  var lx = 0, rx = 0, ly = 0, ry = 0;
  var ld1 = 0, rd1 = 0, ld2 = 0, rd2 = 0;
  var aLP = 1 - Math.exp(-2 * Math.PI * 8200 / SR);
  var peak = 0;
  for (var i = 0; i < loopLen; i++) {
    var xl = mix.L[i], xr = mix.R[i];
    ly = xl - lx + 0.9985 * ly; lx = xl;
    ry = xr - rx + 0.9985 * ry; rx = xr;
    ld1 += (ly - ld1) * aLP; ld2 += (ld1 - ld2) * aLP;
    rd1 += (ry - rd1) * aLP; rd2 += (rd1 - rd2) * aLP;
    mix.L[i] = ld2; mix.R[i] = rd2;
    var al = Math.abs(ld2), ar = Math.abs(rd2);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
  }
  /* 响度匹配：把整曲 RMS 拉向目标（限制增益范围），随后只做峰值安全上限 */
  var curRms = 0, cnt = 0;
  for (i = 0; i < loopLen; i += 7) {
    var v1 = mix.L[i], v2 = mix.R[i];
    curRms += v1 * v1 + v2 * v2; cnt++;
  }
  curRms = Math.sqrt(curRms / cnt / 2);
  if (targetDb && curRms > 1e-9) {
    var want = Math.pow(10, targetDb / 20);
    var gm = Math.max(0.45, Math.min(4.5, want / curRms));
    var safePk = 0;
    if (gm !== 1) {
      for (i = 0; i < loopLen; i++) { mix.L[i] *= gm; mix.R[i] *= gm; }
      for (i = 0; i < loopLen; i++) {
        var b1v = Math.abs(mix.L[i]); if (b1v > safePk) safePk = b1v;
        var b2v = Math.abs(mix.R[i]); if (b2v > safePk) safePk = b2v;
      }
      peak = safePk;
    }
  }
  if (peak > 0.95) {
    var gd = 0.95 / peak;
    for (i = 0; i < loopLen; i++) { mix.L[i] *= gd; mix.R[i] *= gd; }
    peak = 0.95;
  }
  /* 统计最终响度 */
  var rms = 0, cn = 0;
  for (i = 0; i < loopLen; i += 7) {
    var vl = mix.L[i], vr = mix.R[i];
    rms += vl * vl + vr * vr; cn++;
  }
  rms = Math.sqrt(rms / cn / 2);
  return { peakBefore: peak, peak: peak, rms: rms };
}

/* 接缝连续性度量：边界处二阶差分估计（越小越无缝） */
function seamMetric(mix, loopLen) {
  var s = 0, n = 0;
  for (var c = 0; c < 2; c++) {
    var d = c === 0 ? mix.L : mix.R;
    for (var k = 3; k < 64; k += 7) {
      var pred = 3 * d[(loopLen - k + loopLen) % loopLen] - 3 * d[(loopLen - 2 * k + 2 * loopLen) % loopLen] + d[(loopLen - 3 * k + 3 * loopLen) % loopLen];
      s += Math.abs(pred - d[k]); n++;
    }
  }
  return s / Math.max(1, n);
}

/* ---------------- WAV 写出（16bit PCM 立体声） ---------------- */
function writeWav(path, mix, loopLen, fs) {
  var dataBytes = loopLen * 4;
  var buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
  for (var i = 0; i < loopLen; i++) {
    var l = Math.max(-1, Math.min(1, mix.L[i]));
    var r = Math.max(-1, Math.min(1, mix.R[i]));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 44 + i * 4 + 2);
  }
  fs.writeFileSync(path, buf);
  return buf.length;
}

module.exports = {
  SR: SR,
  mulberry32: mulberry32,
  midiToFreq: midiToFreq,
  fitReg: fitReg,
  newMix: newMix,
  createVoices: createVoices,
  dispatch: dispatch,
  makeReverb: makeReverb,
  foldWrap: foldWrap,
  master: master,
  seamMetric: seamMetric,
  writeWav: writeWav
};
