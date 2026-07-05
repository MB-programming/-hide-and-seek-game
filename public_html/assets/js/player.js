/*
 * player.js — a remote or local player's world state + how to draw it.
 *
 * Painted texture handling: `paint.data` (a small PNG data URL, see
 * paint.js) arrives from Firebase as a plain string. We only decode it into
 * an <img> when its revision number changes (paint.rev), never on every
 * render frame — decoding a data URL is comparatively expensive and rev
 * numbers only bump on explicit paint checkpoints (see room.js).
 */
(function (global) {
  'use strict';

  var DISPLAY_W = 56;  // on-stage rendered size in world px (independent of PAINT_W/H)
  var DISPLAY_H = 76;

  function Player(id, data) {
    this.id = id;
    this._img = null;
    this._imgRev = null;
    this.update(data);
  }

  Player.prototype.update = function (data) {
    if (!data) return;
    this.nickname = data.nickname || '?';
    this.role = data.role || 'hider';
    this.x = typeof data.x === 'number' ? data.x : (this.x || 0);
    this.y = typeof data.y === 'number' ? data.y : (this.y || 0);
    this.pose = data.pose || 'stand';
    this.alive = data.alive !== false;
    this.ready = !!data.ready;

    var rev = data.paint && data.paint.rev;
    if (rev !== undefined && rev !== this._imgRev && data.paint.data) {
      this._imgRev = rev;
      var img = new Image();
      img.src = data.paint.data;
      this._img = img;
    }
  };

  // Draws this player onto the stage canvas at world coordinates.
  // `revealAll` is used in spectator/results view where hiders should be
  // visible regardless of camouflage (e.g. a light outline), and for
  // caught players who are shown as translucent ghosts.
  Player.prototype.draw = function (ctx, opts) {
    opts = opts || {};
    var x = this.x - DISPLAY_W / 2;
    var y = this.y - DISPLAY_H;

    ctx.save();
    if (!this.alive) ctx.globalAlpha = 0.35;

    if (this.role === 'seeker') {
      this._drawSeekerSprite(ctx, x, y);
    } else {
      this._drawHiderSprite(ctx, x, y);
    }

    if (opts.showLabel) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.nickname, this.x, y - 4);
    }
    ctx.restore();
  };

  Player.prototype._drawHiderSprite = function (ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ZizoPaint.clipSilhouette(ctx, this.pose, DISPLAY_W, DISPLAY_H);
    if (this._img && this._img.complete) {
      ctx.drawImage(this._img, 0, 0, DISPLAY_W, DISPLAY_H);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);
    }
    ctx.restore();
  };

  Player.prototype._drawSeekerSprite = function (ctx, x, y) {
    // Seekers are never camouflaged — always a clearly visible character.
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#2b6fe0';
    ctx.beginPath();
    ctx.arc(DISPLAY_W * 0.5, DISPLAY_H * 0.16, DISPLAY_W * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(DISPLAY_W * 0.24, DISPLAY_H * 0.28, DISPLAY_W * 0.52, DISPLAY_H * 0.68);
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(DISPLAY_W * 0.3, DISPLAY_H * 0.05, DISPLAY_W * 0.4, DISPLAY_H * 0.1);
    ctx.restore();
  };

  // Hit-test used by seekers tapping/clicking to catch: true if (px,py) in
  // world coords lands within this player's on-screen bounding box.
  Player.prototype.containsPoint = function (px, py) {
    var x = this.x - DISPLAY_W / 2;
    var y = this.y - DISPLAY_H;
    return px >= x && px <= x + DISPLAY_W && py >= y && py <= y + DISPLAY_H;
  };

  global.ZizoPlayer = {
    Player: Player,
    DISPLAY_W: DISPLAY_W,
    DISPLAY_H: DISPLAY_H
  };
})(window);
