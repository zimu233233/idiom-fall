"use strict";
/* 主角：撑油纸伞的青衫书生（kimi设计2 SVG 原件转 data-URL 绘制）
   滑翔/站立 = 伞面全开微摆；速降 = 收伞倾斜 */
const ScholarSprite = (() => {
  const BODY = `
    <path d="M14 42 q5 7 1 14 M58 40 q-5 7 -1 14" stroke="#cfc7ae" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".85"/>
    <rect x="24" y="52" width="6" height="2.5" rx="1" fill="#2f2a33"/>
    <rect x="42" y="52" width="6" height="2.5" rx="1" fill="#2f2a33"/>
    <path d="M29 54 Q36 45 43 54 L43 56 L29 56 Z" fill="#2f2a33"/>
    <circle cx="36" cy="61" r="6.5" fill="#f0d3ae"/>
    <circle cx="33.5" cy="64" r="2.6" fill="#f0d3ae"/><circle cx="38.5" cy="64" r="2.6" fill="#f0d3ae"/>
    <path d="M29 67 Q24 66 21 61 L24 58 Q28 62 30 63 Z" fill="#6f93a3"/>
    <path d="M43 67 Q48 66 51 61 L48 58 Q44 62 42 63 Z" fill="#6f93a3"/>
    <path d="M29 66 Q36 62 43 66 L47 82 Q42 90 36 90 Q30 90 25 82 Z" fill="#6f93a3"/>
    <path d="M31 70 Q34 78 33 86 M41 70 Q38 78 39 86" stroke="#557787" stroke-width="1.2" fill="none" opacity=".8"/>
    <path d="M27 74 Q36 71 45 74 L45 77 Q36 74 27 77 Z" fill="#b9905e"/>
    <rect x="31" y="89" width="4" height="3" rx="1" fill="#2f2a33"/>
    <rect x="38" y="89" width="4" height="3" rx="1" fill="#2f2a33"/>`;
  const HANDLE = `<rect x="35" y="30" width="2.5" height="31" rx="1" fill="#8a5a3a"/>`;
  const UMBRELLA_OPEN = `
    <rect x="34.5" y="2" width="3" height="6" rx="1" fill="#8a5a3a"/>
    <path d="M8 30 Q36 6 64 30 Q60 26 56 30 Q52 26 48 30 Q44 26 40 30 Q36 26 32 30 Q28 26 24 30 Q20 26 16 30 Q12 26 8 30 Z" fill="#d9775f" stroke="#b65a46" stroke-width="1.5"/>
    <path d="M36 10 L16 29 M36 10 L26 30 M36 10 L36 30 M36 10 L46 30 M36 10 L56 29" stroke="#b65a46" stroke-width="1" opacity=".7"/>`;
  const UMBRELLA_CLOSED = `
    <rect x="34.5" y="4" width="3" height="6" rx="1" fill="#8a5a3a" transform="rotate(14 36 7)"/>
    <path d="M27 30 Q36 12 45 30 Q41 27 36 30 Q31 27 27 30 Z" fill="#d9775f" stroke="#b65a46" stroke-width="1.4" transform="rotate(14 36 24)"/>`;

  function makeSvg(umbrella) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="96" viewBox="0 0 72 96">' +
      umbrella + HANDLE + BODY + "</svg>");
  }
  function load(src) {
    if (typeof Image === "undefined") {
      // Node 无头测试环境：无 Image，draw() 会跳过绘制
      return { src, complete: false, naturalWidth: 0 };
    }
    const img = new Image();
    img.src = src;
    return img;
  }
  const open = load(makeSvg(UMBRELLA_OPEN));
  const closed = load(makeSvg(UMBRELLA_CLOSED));
  return { open, closed, W: 72, H: 96 };
})();

class Player {
  constructor() {
    this.w = 24; this.h = 30;
    this.reset(CFG.W / 2, 200);
  }

  reset(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.grounded = true; this.ground = null;
    this.standT = 0;
    this.facing = 1;
    this.landSquash = 0;
    this.jumpBufT = 0; this.jumpBufDir = 0;
    this.swayPhase = 0;
    this.alive = true;
  }

  bounceUp(v) {
    this.vy = -v;
    this.grounded = false;
    this.ground = null;
  }

  doJump(dir) {
    this.vy = -CFG.JUMP_V;
    this.vx = dir * CFG.JUMP_H;
    this.facing = dir;
    this.grounded = false;
    this.ground = null;
    this.standT = 0;
    SoundFX.play("jump");
  }

  update(dt, game) {
    const input = game.input;
    const jumps = input.consumeJumps();
    let wantJump = 0;
    for (const j of jumps) wantJump = j.dir;

    if (this.grounded) {
      if (wantJump) {
        this.doJump(wantJump);
      } else if (this.jumpBufT > 0) {
        this.doJump(this.jumpBufDir);
        this.jumpBufT = 0;
      }
    } else if (wantJump) {
      this.jumpBufT = CFG.JUMP_BUFFER;
      this.jumpBufDir = wantJump;
    }
    if (this.jumpBufT > 0) this.jumpBufT -= dt;

    if (!this.grounded) {
      const dir = input.dir();
      if (dir !== 0) {
        this.vx += dir * CFG.AIR_ACC * dt;
        this.vx = Utils.clamp(this.vx, -CFG.AIR_MAX, CFG.AIR_MAX);
        this.facing = dir;
      } else {
        this.vx *= Math.max(0, 1 - 3.2 * dt);
      }
      const gliding = input.glide && this.vy > 0;
      const g = CFG.GRAV * (gliding ? CFG.GLIDE_GRAV : 1);
      this.vy += g * dt;
      let term = game.fallTerminal();
      if (gliding) term = Math.min(term, CFG.GLIDE_TERM);
      if (game.celebrateT > 0) term *= 1.5;
      if (game.slowT > 0) term *= 0.45;
      this.vy = Math.min(this.vy, term);

      const prevY = this.y;
      this.y += this.vy * dt;
      this.x += this.vx * dt;

      if (this.x < 14) { this.x = 14; this.vx = Math.abs(this.vx) * 0.3; }
      if (this.x > CFG.W - 14) { this.x = CFG.W - 14; this.vx = -Math.abs(this.vx) * 0.3; }

      const plat = game.world.landingCheck(prevY, this.y, this.x);
      if (plat) {
        this.y = plat.y;
        this.vy = 0;
        this.vx *= 0.4;
        this.grounded = true;
        this.ground = plat;
        this.standT = 0;
        this.landSquash = 1;
        game.onLand(plat);
      }
    } else {
      const p = this.ground;
      if (!p || p.dead || p.breaking > 0 || Math.abs(this.x - p.x) > p.w / 2 + 4) {
        this.grounded = false;
        this.ground = null;
      } else {
        this.standT += dt;
        this.vx *= Math.max(0, 1 - 8 * dt);
        this.x += this.vx * dt;
      }
    }

    if (this.landSquash > 0) this.landSquash = Math.max(0, this.landSquash - 3.4 * dt);
    this.swayPhase += dt * 5;
  }

  draw(ctx, cam, time) {
    const sy = this.y - cam.y;
    const gliding = !this.grounded && this.vy > -50 && (Input.glide);
    const spr = (gliding || this.grounded) ? ScholarSprite.open : ScholarSprite.closed;
    if (!spr.complete || !spr.naturalWidth) return;

    let scaleX = 1, scaleY = 1;
    if (!this.grounded) {
      scaleY = 1 + Utils.clamp(this.vy / 2600, 0, 0.18);
      scaleX = 1 / scaleY;
    } else if (this.landSquash > 0) {
      scaleY = 1 - 0.28 * this.landSquash;
      scaleX = 1 + 0.26 * this.landSquash;
    }
    const scale = 0.62;
    const dw = ScholarSprite.W * scale * scaleX;
    const dh = ScholarSprite.H * scale * scaleY;
    // 精灵脚底在 y=92/96 处，对齐 this.y（脚底）
    const dx = this.x - dw / 2;
    const dy = sy - dh * (92 / 96);

    ctx.save();
    // 滑翔时伞面随气流轻摆
    let rot = 0;
    if (gliding) rot = Math.sin(this.swayPhase) * 0.07;
    else if (!this.grounded) rot = -this.facing * 0.06;
    ctx.translate(this.x, sy);
    ctx.rotate(rot);
    ctx.scale(this.facing, 1);
    ctx.translate(-this.x, -sy);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(spr, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
    ctx.restore();
  }
}

window.Player = Player;
window.ScholarSprite = ScholarSprite;
