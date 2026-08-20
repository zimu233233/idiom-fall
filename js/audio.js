"use strict";
/* 8-bit 合成音效：WebAudio 实时生成，无外部素材；首次用户手势时初始化 */
const SoundFX = {
  ctx: null,
  muted: false,

  boot() {
    try { this.muted = localStorage.getItem("cydl_muted") === "1"; } catch (e) { }
  },

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    } catch (e) { this.ctx = null; }
    return this.ctx;
  },

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem("cydl_muted", this.muted ? "1" : "0"); } catch (e) { }
    return this.muted;
  },

  /** 单音：freq -> slideTo，方波/三角波 + 包络 */
  tone(freq, dur, opts) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    opts = opts || {};
    const t0 = ctx.currentTime + (opts.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur);
    const vol = (opts.vol != null ? opts.vol : 0.16);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  /** 噪声爆裂（碎裂音） */
  noise(dur, vol) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol || 0.18, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(gain).connect(ctx.destination);
    src.start(t0);
  },

  play(name) {
    switch (name) {
      case "jump": this.tone(320, 0.12, { slideTo: 560, type: "square", vol: 0.10 }); break;
      case "correct":
        this.tone(660, 0.09, { type: "square", vol: 0.12 });
        this.tone(880, 0.12, { type: "square", vol: 0.12, delay: 0.07 });
        break;
      case "wrong":
        this.tone(220, 0.28, { slideTo: 70, type: "sawtooth", vol: 0.16 });
        this.noise(0.18, 0.10);
        break;
      case "stall":
        this.noise(0.3, 0.2);
        this.tone(160, 0.25, { slideTo: 60, type: "triangle", vol: 0.12 });
        break;
      case "coin":
        this.tone(1180, 0.06, { type: "square", vol: 0.09 });
        this.tone(1560, 0.10, { type: "square", vol: 0.09, delay: 0.05 });
        break;
      case "complete":
        [523, 659, 784, 1046].forEach((f, i) =>
          this.tone(f, 0.12, { type: "square", vol: 0.11, delay: i * 0.08 }));
        break;
      case "boost":
        [440, 554, 659, 880, 1108].forEach((f, i) =>
          this.tone(f, 0.16, { type: "triangle", vol: 0.12, delay: i * 0.06 }));
        break;
      case "item": this.tone(700, 0.08, { slideTo: 1000, type: "triangle", vol: 0.11 }); break;
      case "over":
        [392, 311, 233, 155].forEach((f, i) =>
          this.tone(f, 0.3, { type: "square", vol: 0.12, delay: i * 0.22 }));
        break;
      case "click": this.tone(500, 0.05, { type: "square", vol: 0.07 }); break;
    }
  },
};

window.SoundFX = SoundFX;
