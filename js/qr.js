"use strict";
/* 轻量二维码生成器：字节模式 · 纠错级 M · 版本 1-3（最长 42 字节，覆盖游戏地址）。
   纯前端零依赖；正确性由 test/run-tests.js 的往返解码测试兜底（码字回读 + RS 校验子全零）。
   实现参照 ISO/IEC 18004：GF(256) 里德-所罗门纠错、功能图形、格式位 BCH、8 掩码择优。 */
const QR = {
  // [模块边长, 数据码字数, 纠错码字数]（M 级单码块）
  VERSIONS: { 1: [21, 16, 10], 2: [25, 28, 16], 3: [29, 44, 26] },
  CAPS: [14, 26, 42], // 各版本字节模式容量（M 级）

  /* ---------- GF(256)，本原多项式 0x11D ---------- */
  _exp: null,
  _log: null,
  _initGF() {
    if (this._exp) return;
    const e = new Uint8Array(512), l = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) { e[i] = x; l[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) e[i] = e[i - 255];
    this._exp = e; this._log = l;
  },
  _gmul(a, b) { if (a === 0 || b === 0) return 0; return this._exp[this._log[a] + this._log[b]]; },

  // 生成多项式 ∏(x+α^i)，低次在前
  _rsGen(deg) {
    let poly = [1];
    for (let i = 0; i < deg; i++) {
      const a = this._exp[i];
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j + 1] ^= poly[j];
        next[j] ^= this._gmul(poly[j], a);
      }
      poly = next;
    }
    return poly;
  },

  // 数据码字 → 纠错码字（多项式除法取余）
  _rsEC(data, deg) {
    const gen = this._rsGen(deg);
    const res = data.concat(new Array(deg).fill(0));
    for (let i = 0; i < data.length; i++) {
      const f = res[i];
      if (f !== 0) {
        for (let j = 0; j < gen.length; j++) res[i + j] ^= this._gmul(gen[gen.length - 1 - j], f);
      }
    }
    return res.slice(data.length);
  },

  _utf8(text) {
    const out = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return out;
  },

  /* ---------- 码字装配 ---------- */
  _codewords(bytes, version) {
    const spec = this.VERSIONS[version];
    const cap = spec[1];
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);                 // 模式：字节
    push(bytes.length, 8);      // 计数（版本 1-9 为 8 位）
    bytes.forEach((b) => push(b, 8));
    const capBits = cap * 8;
    push(0, Math.min(4, capBits - bits.length));  // 终止符
    while (bits.length % 8 !== 0) bits.push(0);   // 补齐字节
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    for (let pad = 0; data.length < cap; pad ^= 1) data.push(pad === 0 ? 0xec : 0x11);
    return data;
  },

  /* ---------- 功能图形 ---------- */
  _newGrids(version) {
    const n = this.VERSIONS[version][0];
    const m = [], f = [];
    for (let y = 0; y < n; y++) { m.push(new Array(n).fill(false)); f.push(new Array(n).fill(false)); }
    return { n, m, f };
  },
  _set(g, x, y, dark) { g.m[y][x] = dark; g.f[y][x] = true; },
  _finder(g, x, y) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const gx = x + dx, gy = y + dy;
        if (gx < 0 || gy < 0 || gx >= g.n || gy >= g.n) continue;
        const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 &&
          (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        this._set(g, gx, gy, dark);
      }
    }
  },
  _alignment(g, cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
        this._set(g, cx + dx, cy + dy, dark);
      }
    }
  },
  _functionModules(version) {
    const g = this._newGrids(version);
    const n = g.n;
    this._finder(g, 0, 0); this._finder(g, n - 7, 0); this._finder(g, 0, n - 7);
    for (let i = 8; i < n - 8; i++) { // 时序线（仅画定位角分隔符之间）
      this._set(g, 6, i, i % 2 === 0);
      this._set(g, i, 6, i % 2 === 0);
    }
    if (version >= 2) this._alignment(g, n - 7, n - 7); // V2/V3 单个定位图形
    // 保留格式位区域（稍后按掩码写入）
    for (let i = 0; i <= 8; i++) {
      if (!g.f[8][i]) this._set(g, i, 8, false);
      if (!g.f[i][8]) this._set(g, 8, i, false);
    }
    for (let i = 0; i < 8; i++) {
      if (!g.f[8][n - 1 - i]) this._set(g, n - 1 - i, 8, false);
      if (!g.f[n - 1 - i][8]) this._set(g, 8, n - 1 - i, false);
    }
    return g;
  },
  _format(g, mask) {
    const data = (0 << 3) | mask; // 纠错级 M = 0b00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => (bits >>> i) & 1;
    const n = g.n;
    for (let i = 0; i <= 5; i++) this._set(g, 8, i, bit(i) === 1); // 列 8 上段（0-5 位）
    this._set(g, 8, 7, bit(6) === 1);
    this._set(g, 8, 8, bit(7) === 1);
    this._set(g, 7, 8, bit(8) === 1);
    for (let i = 9; i < 15; i++) this._set(g, 14 - i, 8, bit(i) === 1); // 行 8 左段（9-14 位）
    for (let i = 0; i < 8; i++) this._set(g, n - 1 - i, 8, bit(i) === 1);
    for (let i = 8; i < 15; i++) this._set(g, 8, n - 15 + i, bit(i) === 1);
    this._set(g, 8, n - 8, true); // 固定暗模块
  },

  /* ---------- 数据铺设（之字形）与掩码 ---------- */
  _placeData(g, codewords) {
    const bits = [];
    codewords.forEach((b) => { for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1); });
    let i = 0;
    for (let right = g.n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < g.n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? g.n - 1 - vert : vert;
          if (!g.f[y][x] && i < bits.length) { g.m[y][x] = bits[i] === 1; i++; }
        }
      }
    }
  },
  _applyMask(g, mask) {
    const n = g.n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (g.f[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: invert = (((x + y) % 2) + (x * y) % 3) % 2 === 0; break;
        }
        if (invert) g.m[y][x] = !g.m[y][x];
      }
    }
  },
  _penalty(g) {
    const n = g.n, m = g.m;
    let p = 0;
    // N1 行/列连续同色 ≥5
    for (let y = 0; y < n; y++) {
      let run = 1;
      for (let x = 1; x < n; x++) {
        if (m[y][x] === m[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
        else run = 1;
      }
    }
    for (let x = 0; x < n; x++) {
      let run = 1;
      for (let y = 1; y < n; y++) {
        if (m[y][x] === m[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
        else run = 1;
      }
    }
    // N2 2×2 同色块
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
    }
    // N3 类定位图形 1:1:3:1:1
    const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    const matchRow = (y, x, pat) => pat.every((v, i) => m[y][x + i] === v);
    const matchCol = (x, y, pat) => pat.every((v, i) => m[y + i][x] === v);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x + 10 < n; x++) {
        if (matchRow(y, x, pat1) || matchRow(y, x, pat2)) p += 40;
      }
    }
    for (let y = 0; y + 10 < n; y++) {
      for (let x = 0; x < n; x++) {
        if (matchCol(x, y, pat1) || matchCol(x, y, pat2)) p += 40;
      }
    }
    // N4 暗模块占比偏离
    let dark = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) dark++;
    const total = n * n;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  },

  /* ---------- 对外入口 ---------- */
  /** 生成二维码矩阵。返回 { version, size, mask, modules(bool[][]), funcs(bool[][]) } */
  gen(text) {
    this._initGF();
    const bytes = this._utf8(String(text));
    let version = 0;
    for (let v = 1; v <= 3; v++) { if (bytes.length <= this.CAPS[v - 1]) { version = v; break; } }
    if (!version) throw new Error("QR 文本超长（最多 42 字节）");
    const data = this._codewords(bytes, version);
    const ec = this._rsEC(data, this.VERSIONS[version][2]);
    const codewords = data.concat(ec);

    let best = null, bestScore = Infinity, bestMask = 0;
    for (let mask = 0; mask < 8; mask++) {
      const g = this._functionModules(version);
      this._placeData(g, codewords);
      this._applyMask(g, mask);
      this._format(g, mask);
      const score = this._penalty(g);
      if (score < bestScore) { bestScore = score; best = g; bestMask = mask; }
    }
    return { version, size: best.n, mask: bestMask, modules: best.m, funcs: best.f };
  },

  /** 画到 canvas：darker 深色 / lighter 浅色，quiet 为四周静区模块数，mod 为单模块像素 */
  draw(ctx, text, x, y, mod, darker, lighter, quiet) {
    const q = QR.gen(text);
    const n = q.size;
    const off = (quiet || 0) * mod;
    ctx.fillStyle = lighter;
    ctx.fillRect(x, y, n * mod + off * 2, n * mod + off * 2);
    ctx.fillStyle = darker;
    for (let ry = 0; ry < n; ry++) {
      for (let rx = 0; rx < n; rx++) {
        if (q.modules[ry][rx]) ctx.fillRect(x + off + rx * mod, y + off + ry * mod, mod, mod);
      }
    }
    return q;
  },
};

window.QR = QR;
