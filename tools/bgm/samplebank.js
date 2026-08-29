'use strict';
/*
 * tools/bgm/samplebank.js —— 真实乐器采样库（Stable Audio 3 生成的音色）
 * 读取 samples/<乐器>/<技巧>_<音名>.wav，按最近音高匹配回放，供 engine.js 优先于合成音源使用。
 * 目录约定见 D:\music-Stable Audio\build_samples.py（seed=42 可复现）。
 */

var SR = 44100;
var SAMPLES_DEFAULT_DIR = 'D:/music-Stable Audio/samples';

var NOTE_OFFSET = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
var NOTE_RX = /^([A-G])(s|b)?([0-9])$/;
var FILE_RX = /^([A-Za-z]+)_(.+)\.wav$/;

function noteToMidi(name) {
  var m = String(name).match(NOTE_RX);
  if (!m) return null;
  var v = NOTE_OFFSET[m[1]] + (m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0);
  return 12 * (parseInt(m[3], 10) + 1) + v;
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* 解析 WAV（PCM16 / float32，多声道取平均），返回 {sr, data:Float64Array} */
function parseWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  var pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    var id = buf.toString('ascii', pos, pos + 4);
    var sz = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(pos + 8),
        ch: buf.readUInt16LE(pos + 10),
        sr: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22)
      };
    } else if (id === 'data') {
      data = buf.slice(pos + 8, Math.min(pos + 8 + sz, buf.length));
    }
    pos += 8 + sz + (sz % 2);
    if (sz <= 0) break;
  }
  if (!fmt || !data) return null;
  var ch = fmt.ch || 1;
  var out, i, c, s;
  if (fmt.format === 3 && fmt.bits === 32) {
    var frames32 = Math.floor(data.length / 4 / ch);
    out = new Float64Array(frames32);
    for (i = 0; i < frames32; i++) {
      s = 0;
      for (c = 0; c < ch; c++) s += data.readFloatLE(i * ch * 4 + c * 4);
      out[i] = s / ch;
    }
  } else if (fmt.format === 1 && fmt.bits === 16) {
    var frames16 = Math.floor(data.length / 2 / ch);
    out = new Float64Array(frames16);
    for (i = 0; i < frames16; i++) {
      s = 0;
      for (c = 0; c < ch; c++) s += data.readInt16LE(i * ch * 2 + c * 2);
      out[i] = s / ch / 32768;
    }
  } else {
    return null;
  }
  return { sr: fmt.sr, data: out };
}

/* 采样加载时的调理：去直流 → 一阶高通(约40Hz) → RMS 归一到 -20dBFS（峰值不超 0dB）
 * 目的：统一各采样响度，避免母带增益放大低电平采样里的气息噪声 */
function condition(data) {
  var n = data.length, i;
  var mean = 0;
  for (i = 0; i < n; i++) mean += data[i];
  mean /= n;
  var hpA = Math.exp(-2 * Math.PI * 40 / SR);
  var x1 = 0, y1 = 0;
  var rms = 0;
  for (i = 0; i < n; i++) {
    var x = data[i] - mean;
    y1 = hpA * (y1 + x - x1);
    x1 = x;
    data[i] = y1;
    rms += y1 * y1;
  }
  rms = Math.sqrt(rms / Math.max(1, n));
  if (rms > 1e-6) {
    var g = 0.1 / rms;                       /* -20dBFS RMS */
    var peak = 0;
    for (i = 0; i < n; i++) { var v = Math.abs(data[i]); if (v > peak) peak = v; }
    if (peak * g > 0.98) g = 0.98 / peak;    /* 峰值保护 */
    for (i = 0; i < n; i++) data[i] *= g;
  }
  return data;
}

/* sustain 类采样做成可循环：截取 30%~85% 段，**尾段**淡出同时混入**开头**同相位内容，
 * 使 循环末尾→循环开头 连续（旧版方向写反导致每个循环点周期性跳变=听感一断一断） */
function makeLoopable(data) {
  var a = Math.floor(data.length * 0.30), b = Math.floor(data.length * 0.85);
  var seg = data.slice(a, b);
  var L = seg.length;
  var xf = Math.min(Math.floor(L * 0.2), Math.floor(0.30 * SR));
  for (var i = 0; i < xf; i++) {
    var w = i / xf;
    seg[L - xf + i] = seg[L - xf + i] * (1 - w) + seg[i] * w;
  }
  return seg;
}

/* 事件乐器 → 采样库 (乐器, 技巧) 映射；sustain 标记可循环延长 */
var SAMPLE_MAP = {
  qin: { inst: 'guqin', tech: 'pluck' },
  qharm: { inst: 'guqin', tech: 'harmonic' },
  zheng: { inst: 'guzheng', tech: 'pluck' },
  xiao: { inst: 'xiao', tech: 'sustain', sustain: true },
  di: { inst: 'dizi', tech: 'sustain', sustain: true },
  erhu: { inst: 'erhu', tech: 'longbow', sustain: true },
  sheng: { inst: 'sheng', tech: 'sustain', sustain: true },
  zhong: { inst: 'bianzhong', tech: 'strike' },
  qing: { inst: 'qing', tech: 'strike' },
  muyu: { inst: 'muyu', tech: 'hit' }
};

function createSampleBank(dir) {
  var fsMod = require('fs');
  var pathMod = require('path');
  var root = dir || SAMPLES_DEFAULT_DIR;
  var bank = { byKey: {}, root: root, count: 0 };
  try {
    var insts = fsMod.readdirSync(root);
    for (var ii = 0; ii < insts.length; ii++) {
      var inst = insts[ii];
      var idir = pathMod.join(root, inst);
      if (!fsMod.statSync(idir).isDirectory()) continue;
      var files = fsMod.readdirSync(idir);
      for (var fi = 0; fi < files.length; fi++) {
        var m = String(files[fi]).match(FILE_RX);
        if (!m) continue;
        var midi = noteToMidi(m[2]);
        if (midi == null) continue;
        var parsed = parseWav(fsMod.readFileSync(pathMod.join(idir, files[fi])));
        if (!parsed) continue;
        condition(parsed.data);
        var key = inst + '/' + m[1];
        (bank.byKey[key] = bank.byKey[key] || []).push({
          midi: midi, freq: 440 * Math.pow(2, (midi - 69) / 12),
          data: parsed.data, sr: parsed.sr
        });
        bank.count++;
      }
    }
  } catch (e) {
    return null;
  }
  Object.keys(bank.byKey).forEach(function (k) {
    bank.byKey[k].sort(function (a, b) { return a.freq - b.freq; });
  });
  return bank;
}

/* 采样回放：最近音高 + 线性插值重采样；sustain 不足长时循环延展；失败返回 null */
function sampleRender(bank, ev) {
  var map = SAMPLE_MAP[ev.inst];
  if (!map) return null;
  var list = bank.byKey[map.inst + '/' + map.tech];
  if (!list || !list.length) return null;
  var best, bd;
  if (!ev.freq) {
    best = list[Math.floor(list.length / 2)];      /* 无音高打击乐：取中位采样 */
    bd = 0;
  } else {
    best = list[0]; bd = 1e9;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(Math.log(ev.freq / list[i].freq));
      if (d < bd) { bd = d; best = list[i]; }
    }
    if (bd > Math.LN2 * 1.01) return null;         /* 超一个八度回退合成 */
  }
  var ratio = ((ev.freq ? ev.freq / best.freq : 1) * best.sr) / SR;
  var loop = map.sustain ? makeLoopable(best.data) : null;
  var src = loop || best.data;
  var wantN = Math.ceil(((ev.durS || 1) + (map.sustain ? 0.35 : 1.4)) * SR);
  var outN = loop ? wantN : Math.min(wantN, Math.ceil(src.length / ratio) + Math.round(SR * 0.5));
  if (outN <= 16) return null;
  var out = new Float64Array(outN);
  var amp = Math.pow(clamp(ev.vel, 0, 1), 1.05);
  var atk = Math.max(4, Math.round(SR * 0.004));
  var pos = 0;
  for (var j = 0; j < outN; j++) {
    if (pos >= src.length) {
      if (!loop) break;
      pos -= loop.length;
    }
    var i0 = Math.floor(pos), frac = pos - i0;
    var s0 = src[i0], s1 = src[i0 + 1 < src.length ? i0 + 1 : i0];
    var s = s0 + (s1 - s0) * frac;
    var g = amp;
    if (j < atk) g *= j / atk;
    if (loop && j > outN - atk * 20) g *= Math.max(0, (outN - j) / (atk * 20));
    out[j] = s * g;
    pos += ratio;
  }
  return out;
}

module.exports = {
  SAMPLE_MAP: SAMPLE_MAP,
  SAMPLES_DEFAULT_DIR: SAMPLES_DEFAULT_DIR,
  createSampleBank: createSampleBank,
  sampleRender: sampleRender,
  noteToMidi: noteToMidi,
  parseWav: parseWav
};
