'use strict';
/*
 * tools/bgm/render.js —— 背景音乐渲染管线
 * 作曲数据 → 音源渲染 → 混响 → 循环尾回卷 → 母带 → WAV（build/，git 忽略）
 *   → ffmpeg 编码 MP3 到 audio/bgm/。
 *
 * 运行：node tools/bgm/render.js            渲染全部 12 首
 *       node tools/bgm/render.js --only=03  只渲染指定曲目（逗号分隔可多首）
 *       node tools/bgm/render.js --no-encode 只出 WAV 不编码 MP3
 *
 * 安全约定：外部进程只允许 PATH 中的字面量 ffmpeg，参数一律数组传递，不经过 shell 拼接。
 */

var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;
var spawnSync = require('child_process').spawnSync;

var ROOT = path.join(__dirname, '..', '..');
var ENGINE = require('./engine.js');
var COMP = require('./compositions.js');
var SB = require('./samplebank.js');

/* ---------- 命令行 ---------- */
var argOnly = null, noEncode = false, useSynth = false;
process.argv.slice(2).forEach(function (a) {
  if (a.indexOf('--only=') === 0) argOnly = a.slice(7).split(',');
  if (a === '--no-encode') noEncode = true;
  if (a === '--synth') useSynth = true;
});

/* 采样库：默认启用（真实音色优先），--synth 强制纯合成 */
var bank = useSynth ? null : SB.createSampleBank(null);
if (bank) console.log('[采样库] 载入 ' + bank.count + ' 条真实音色（' + bank.root + '）');
else if (!useSynth) console.warn('[采样库] 未找到，全部使用程序合成音源');

/* ---------- ffmpeg 探测（仅字面量程序名，无环境变量注入点） ---------- */
function ffmpegAvailable() {
  var r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true });
  return !r.error && r.status === 0;
}

/* 每首目标响度（dBFS RMS）：幽微的慢板轻，宴舞与欢快曲亮 */
var LOUD_DB = {
  '01': -22, '02': -20, '03': -18.5, '04': -18.5, '05': -20,
  '06': -19.5, '07': -21, '08': -18, '09': -22, '10': -18,
  '11': -17.5, '12': -19.5
};

/* ---------- 主流程 ---------- */
var tracks = COMP.TRACKS;
if (argOnly) tracks = tracks.filter(function (t) { return argOnly.indexOf(t.id) >= 0; });
if (!tracks.length) { console.error('没有匹配的曲目；可用 id：', COMP.TRACKS.map(function (t) { return t.id; }).join(',')); process.exit(1); }

var hasFfmpeg = noEncode ? false : ffmpegAvailable();
if (!hasFfmpeg && !noEncode) {
  console.warn('[提示] 未找到 ffmpeg，跳过 MP3 编码，只输出 WAV 到 build/bgm/。');
}

fs.mkdirSync(path.join(ROOT, 'audio', 'bgm'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'build', 'bgm'), { recursive: true });

var manifest = [];
var tAllStart = Date.now();

tracks.forEach(function (t) {
  var t0 = Date.now();
  var loopSec = COMP.loopSecOf(t);
  if (!(loopSec >= 70 && loopSec <= 116)) {
    throw new Error(t.id + ' 循环时长越界：' + loopSec.toFixed(1) + 's（要求 70~116s）');
  }
  var frames = Math.ceil(loopSec * ENGINE.SR);
  var tail = Math.round(9 * ENGINE.SR);

  /* 事件生成（作曲层） */
  var ctx = COMP.buildCtx(t);
  t.gen(ctx, t);

  /* 时间换算为秒并稳定排序（tie 用生成序号保证确定性） */
  var spb = 60 / t.bpm;
  var decorated = ctx.evts.map(function (e, i) {
    var c = Object.assign({}, e);
    delete c.t; delete c.dur;
    c.tS = e.t * spb;
    c.durS = e.dur * spb;
    return { e: c, i: i };
  });
  decorated.sort(function (a, b) {
    return (a.e.tS - b.e.tS) || (a.i - b.i);
  });

  /* 渲染 */
  var mix = ENGINE.newMix(frames + tail);
  var voices = ENGINE.createVoices(ENGINE.mulberry32((t.seed ^ 0x9E3779B9) >>> 0));
  decorated.forEach(function (d) { ENGINE.dispatch(mix, voices, d.e, bank); });

  /* 效果与循环处理 */
  var rev = ENGINE.makeReverb(t.rev.wet, t.rev.size, t.rev.dampAmt);
  rev.process(mix);
  ENGINE.foldWrap(mix, frames, tail);
  var st = ENGINE.master(mix, frames, LOUD_DB[t.id] != null ? LOUD_DB[t.id] : -19.5);
  var seam = ENGINE.seamMetric(mix, frames);

  /* WAV 主档（build/ 目录已被 .gitignore 排除） */
  var wavPath = path.join(ROOT, 'build', 'bgm', t.id + '.wav');
  var wavBytes = ENGINE.writeWav(wavPath, mix, frames, fs);

  /* MP3 编码（字面量 ffmpeg + 数组参数） */
  var mp3Rel = path.join('audio', 'bgm', t.id + '-' + t.slug + '.mp3');
  var mp3Abs = path.join(ROOT, mp3Rel);
  var mp3Bytes = 0;
  if (hasFfmpeg) {
    execFileSync('ffmpeg', [
      '-y', '-i', wavPath,
      '-codec:a', 'libmp3lame', '-q:a', '5',
      '-id3v2_version', '3',
      '-metadata', 'title=' + t.name,
      '-metadata', 'artist=成语下落游戏·自制配乐',
      '-metadata', 'album=背景音乐小样',
      mp3Abs
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    mp3Bytes = fs.statSync(mp3Abs).size;
  }

  var rmsDb = 20 * Math.log10(Math.max(1e-9, st.rms));
  var peakDb = 20 * Math.log10(Math.max(1e-9, st.peak));
  manifest.push({
    id: t.id, slug: t.slug, name: t.name, file: mp3Rel.split('\\').join('/'),
    group: t.group, scene: t.scene, desc: t.desc,
    bpm: t.bpm, bars: t.bars, beatsPerBar: t.beatsPerBar,
    seed: t.seed, events: decorated.length,
    seconds: +(loopSec).toFixed(2),
    rmsDb: +rmsDb.toFixed(1),
    peakDb: +peakDb.toFixed(1),
    seam: +seam.toFixed(4),
    mp3Bytes: mp3Bytes, wavBytes: wavBytes
  });

  console.log(
    '[' + t.id + '] ' + t.name +
    ' · ' + loopSec.toFixed(1) + 's · ' + decorated.length + ' 音符' +
    ' · RMS ' + rmsDb.toFixed(1) + ' / 峰值 ' + peakDb.toFixed(1) + 'dBFS' +
    (mp3Bytes ? ' · MP3 ' + (mp3Bytes / 1048576).toFixed(2) + 'MB' : '') +
    ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'
  );
});

/* ---------- 清单 ---------- */
if (manifest.length === COMP.TRACKS.length) {
  var mf = path.join(ROOT, 'audio', 'bgm', 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify({ generatedAt: new Date().toISOString(), sampleRate: ENGINE.SR, tracks: manifest }, null, 2));
}

console.log('\n共 ' + manifest.length + ' 首，总耗时 ' + ((Date.now() - tAllStart) / 1000).toFixed(1) + 's。');
console.log('产物：audio/bgm/*.mp3（试听）/ build/bgm/*.wav（主档，不入库）');
