"use strict";
/* 主角：像素书生。平台按左右=向该侧跳起；按住=滑翔减速；支持落地 squash & 拉伸 */
const PlayerSprite = (() => {
  // 12x16 像素网格：h发/s肤/r袍金/R袍影/b腰带/f鞋/.透明
  const ROWS = [
    "..hhhhhhhh..",
    ".hhhhhhhhhh.",
    "...hssssh...",
    "...ssssss...",
    "....ssss....",
    "..srrrrrrs..",
    "..srRRRRrs..",
    "...rbbbbr...",
    "...rrrrrr...",
    "...rRRRRr...",
    "...rrrrrr...",
    "...rr..rr...",
    "...rr..rr...",
    "..fff..fff..",
  ];
  const COLORS = {
    h: "#241a20", s: "#f6d8ac", r: "#e8b830", R: "#b8871a", b: "#c04048", f: "#4a3020",
  };
  let canvas = null;
  function build() {
    const c = document.createElement("canvas");
    c.width = 12; c.height = ROWS.length;
    const g = c.getContext("2d");
    for (let y = 0; y < ROWS.length; y++) {
      for (let x = 0; x < 12; x++) {
        const ch = ROWS[y][x];
        if (ch && ch !== ".") { g.fillStyle = COLORS[ch]; g.fillRect(x, y, 1, 1); }
      }
    }
    canvas = c;
    return c;
  }
  return { get() { return canvas || build(); }, W: 12, H: ROWS.length };
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
    this.capePhase = 0;
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
      // 空中水平控制
      const dir = input.dir();
      if (dir !== 0) {
        this.vx += dir * CFG.AIR_ACC * dt;
        this.vx = Utils.clamp(this.vx, -CFG.AIR_MAX, CFG.AIR_MAX);
        this.facing = dir;
      } else {
        this.vx *= Math.max(0, 1 - 3.2 * dt);
      }
      // 重力与滑翔
      const gliding = input.glide && this.vy > 0;
      const g = CFG.GRAV * (gliding ? CFG.GLIDE_GRAV : 1);
      this.vy += g * dt;
      let term = game.fallTerminal();
      if (gliding) term = Math.min(term, CFG.GLIDE_TERM);
      if (game.celebrateT > 0) term *= 1.5; // 成语通关后的加速下落
      if (game.slowT > 0) term *= 0.45;     // 减速表
      this.vy = Math.min(this.vy, term);

      const prevY = this.y;
      this.y += this.vy * dt;
      this.x += this.vx * dt;

      // 边界
      if (this.x < 14) { this.x = 14; this.vx = Math.abs(this.vx) * 0.3; }
      if (this.x > CFG.W - 14) { this.x = CFG.W - 14; this.vx = -Math.abs(this.vx) * 0.3; }

      // 单向平台碰撞
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
      // 站立：检查是否走出平台边缘
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
    this.capePhase += dt * 9;
  }

  draw(ctx, cam, time) {
    const sy = this.y - cam.y;
    // squash & stretch：下落拉伸、落地压扁
    let scaleX = 1, scaleY = 1;
    if (!this.grounded) {
      scaleY = 1 + Utils.clamp(this.vy / 2600, 0, 0.22);
      scaleX = 1 / scaleY;
    } else if (this.landSquash > 0) {
      scaleY = 1 - 0.32 * this.landSquash;
      scaleX = 1 + 0.3 * this.landSquash;
    }
    const spr = PlayerSprite.get();
    const scale = 2;
    const dw = PlayerSprite.W * scale * scaleX;
    const dh = PlayerSprite.H * scale * scaleY;
    const dx = this.x - dw / 2;
    const dy = sy - dh; // y为脚底

    // 披风（身后飘动，微观反馈）
    ctx.save();
    const capeSide = -this.facing;
    const cx = this.x + capeSide * (dw / 2 - 2);
    for (let i = 0; i < 5; i++) {
      const fl = Math.sin(this.capePhase + i * 0.9) * 2.2;
      const segH = (dh / 5) * 0.96;
      ctx.fillStyle = i % 2 ? "#2c7a6a" : "#1e5a4e";
      ctx.fillRect(cx + capeSide * (i * 0.8), sy - dh + 8 + i * segH + fl * 0.4,
        capeSide < 0 ? -(4 - i * 0.4) : (4 - i * 0.4), segH + 1);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, sy);
    ctx.scale(this.facing, 1);
    ctx.translate(-this.x, -sy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
    ctx.restore();
  }
}

window.Player = Player;
window.PlayerSprite = PlayerSprite;
