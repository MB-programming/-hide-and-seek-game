/*
 * paint.js — the freehand camouflage brush engine.
 *
 * This is the core mechanic of ZIZO HIDE: each Hider gets a small, FIXED
 * resolution canvas (PAINT_W x PAINT_H) representing their character's
 * body/silhouette. Painting happens on that fixed-size canvas regardless of
 * how big it's displayed on screen, which is what keeps the exported PNG
 * (the thing we sync to every other client via api/game.php) tiny — a few KB
 * at most — no matter how large or small any given player's device screen
 * is. See exportCompressed() at the bottom and room.js's syncPaintCheckpoint
 * for how/when that export actually gets sent over the network.
 *
 * Clipping trick: instead of maintaining a separate clip path for every
 * stroke, we pre-fill the canvas with an opaque white silhouette shape (the
 * "blank"/unpainted look from the real game) and then draw every brush
 * stroke with globalCompositeOperation = 'source-atop'. That composite mode
 * only lets new pixels draw where the destination ALREADY has alpha > 0 —
 * i.e. strokes can never leave the silhouette, no matter how sloppy the
 * player's freehand drawing is. Pose changes (setPose) re-run this same
 * trick to carry existing paint over onto the new silhouette shape.
 */
(function (global) {
  'use strict';

  var PAINT_W = 48;
  var PAINT_H = 64;
  var HISTORY_LIMIT = 20;

  // Appends a rounded-rect subpath to ctx's CURRENT path (does not call
  // beginPath — callers combine this with other shapes into one path so a
  // single fill()/clip() applies to the union of all subpaths).
  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Builds the single combined path (head + body, as one path with two
  // subpaths) for a given pose. Shared by drawSilhouette (fill, used by the
  // paint engine) and clipSilhouette (clip, used by player.js to composite
  // the painted texture onto the stage in the correct body shape).
  function buildSilhouettePath(ctx, pose, w, h) {
    ctx.beginPath();
    if (pose === 'crouch') {
      // Short, wide blob — mimics low, squat objects (crates, bins).
      ctx.arc(w * 0.5, h * 0.42, w * 0.14, 0, Math.PI * 2);
      roundedRectPath(ctx, w * 0.12, h * 0.5, w * 0.76, h * 0.42, w * 0.16);
    } else if (pose === 'lean') {
      // Tilted silhouette — mimics leaning objects (ladders, angled pipes).
      ctx.translate(w * 0.5, h * 0.5);
      ctx.rotate(-0.22);
      ctx.translate(-w * 0.5, -h * 0.5);
      ctx.arc(w * 0.5, h * 0.18, w * 0.15, 0, Math.PI * 2);
      roundedRectPath(ctx, w * 0.28, h * 0.3, w * 0.44, h * 0.62, w * 0.14);
    } else if (pose === 'surrender') {
      // Tall body + two raised-hand bumps at the top corners.
      ctx.arc(w * 0.5, h * 0.16, w * 0.16, 0, Math.PI * 2);
      roundedRectPath(ctx, w * 0.24, h * 0.28, w * 0.52, h * 0.68, w * 0.18);
      ctx.arc(w * 0.14, h * 0.22, w * 0.09, 0, Math.PI * 2);
      ctx.arc(w * 0.86, h * 0.22, w * 0.09, 0, Math.PI * 2);
    } else if (pose === 'sit') {
      // Medium-height body with a wider seated base — between stand and crouch.
      ctx.arc(w * 0.5, h * 0.3, w * 0.15, 0, Math.PI * 2);
      roundedRectPath(ctx, w * 0.18, h * 0.42, w * 0.64, h * 0.5, w * 0.18);
    } else if (pose === 'prone') {
      // Wide, flat shape near the bottom — lying down.
      ctx.arc(w * 0.16, h * 0.78, w * 0.15, 0, Math.PI * 2);
      roundedRectPath(ctx, w * 0.26, h * 0.66, w * 0.66, h * 0.26, w * 0.12);
    } else {
      // 'stand' (default) — tall capsule body + round head.
      ctx.arc(w * 0.5, h * 0.16, w * 0.16, 0, Math.PI * 2);
      roundedRectPath(ctx, w * 0.24, h * 0.28, w * 0.52, h * 0.68, w * 0.18);
    }
  }

  // Draws the body silhouette for a given pose into ctx, filled with
  // fillStyle (caller sets color before calling, default usage is white).
  function drawSilhouette(ctx, pose, w, h) {
    ctx.save();
    buildSilhouettePath(ctx, pose, w, h);
    ctx.fill();
    ctx.restore();
  }

  // Clips ctx to the pose silhouette (caller must ctx.save()/ctx.restore()
  // around this so the clip doesn't leak to later drawing calls).
  function clipSilhouette(ctx, pose, w, h) {
    buildSilhouettePath(ctx, pose, w, h);
    ctx.clip();
  }

  function PaintEngine(canvas) {
    this.canvas = canvas;
    this.canvas.width = PAINT_W;
    this.canvas.height = PAINT_H;
    this.ctx = canvas.getContext('2d');
    this.pose = 'stand';
    this.color = '#ffffff';
    this.brushSize = 6;
    this._history = [];
    this._redoStack = [];
    this._drawing = false;
    this._last = null;

    this._fillBlankSilhouette(this.pose);
    this._pushHistory();
  }

  PaintEngine.prototype._fillBlankSilhouette = function (pose) {
    this.ctx.clearRect(0, 0, PAINT_W, PAINT_H);
    this.ctx.fillStyle = '#ffffff';
    drawSilhouette(this.ctx, pose, PAINT_W, PAINT_H);
  };

  // Switches pose while preserving whatever has been painted so far,
  // remapped onto the new silhouette shape (see file header comment).
  PaintEngine.prototype.setPose = function (pose) {
    if (pose === this.pose) return;
    var tmp = document.createElement('canvas');
    tmp.width = PAINT_W;
    tmp.height = PAINT_H;
    var tctx = tmp.getContext('2d');
    tctx.fillStyle = '#ffffff';
    drawSilhouette(tctx, pose, PAINT_W, PAINT_H);
    tctx.globalCompositeOperation = 'source-atop';
    tctx.drawImage(this.canvas, 0, 0);

    this.ctx.clearRect(0, 0, PAINT_W, PAINT_H);
    this.ctx.drawImage(tmp, 0, 0);
    this.pose = pose;
    this._pushHistory();
  };

  PaintEngine.prototype.setColor = function (color) { this.color = color; };
  PaintEngine.prototype.setBrushSize = function (size) { this.brushSize = size; };

  // Coordinates passed in are already normalized to the PAINT_W x PAINT_H
  // space by the caller (input.js maps pointer position on the visible,
  // scaled-up element back down to this fixed internal resolution).
  PaintEngine.prototype.strokeStart = function (x, y) {
    this._drawing = true;
    this._last = { x: x, y: y };
    this._paintDot(x, y);
  };

  PaintEngine.prototype.strokeMove = function (x, y) {
    if (!this._drawing) return;
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'source-atop';
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(this._last.x, this._last.y);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    this.ctx.restore();
    this._last = { x: x, y: y };
  };

  PaintEngine.prototype._paintDot = function (x, y) {
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'source-atop';
    this.ctx.fillStyle = this.color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.brushSize / 2, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  };

  PaintEngine.prototype.strokeEnd = function () {
    if (!this._drawing) return;
    this._drawing = false;
    this._last = null;
    this._pushHistory();
  };

  PaintEngine.prototype._pushHistory = function () {
    this._history.push(this.canvas.toDataURL('image/png'));
    if (this._history.length > HISTORY_LIMIT) this._history.shift();
    this._redoStack = [];
  };

  PaintEngine.prototype._restoreFrom = function (dataUrl) {
    var img = new Image();
    var self = this;
    img.onload = function () {
      self.ctx.clearRect(0, 0, PAINT_W, PAINT_H);
      self.ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
  };

  PaintEngine.prototype.undo = function () {
    if (this._history.length <= 1) return;
    this._redoStack.push(this._history.pop());
    this._restoreFrom(this._history[this._history.length - 1]);
  };

  PaintEngine.prototype.redo = function () {
    if (!this._redoStack.length) return;
    var next = this._redoStack.pop();
    this._history.push(next);
    this._restoreFrom(next);
  };

  PaintEngine.prototype.clear = function () {
    this._fillBlankSilhouette(this.pose);
    this._pushHistory();
  };

  // Returns the small PNG data URL synced to the server on paint checkpoints.
  // At 48x64px this is typically only a few KB even for a busy painting —
  // see room.js syncPaintCheckpoint() for why we only call this on explicit
  // "confirm/pause painting" actions rather than after every stroke.
  PaintEngine.prototype.exportCompressed = function () {
    return this.canvas.toDataURL('image/png');
  };

  global.ZizoPaint = {
    PAINT_W: PAINT_W,
    PAINT_H: PAINT_H,
    PaintEngine: PaintEngine,
    drawSilhouette: drawSilhouette,
    clipSilhouette: clipSilhouette
  };
})(window);
