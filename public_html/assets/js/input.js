/*
 * input.js — keyboard, touch joystick, brush pointer, and tap-to-catch.
 *
 * All canvases in this game are drawn at a fixed internal resolution but
 * displayed at whatever CSS size fits the device (responsive, full width on
 * phones). Every helper below converts real pointer/touch client coordinates
 * into that fixed internal coordinate space via getBoundingClientRect(), so
 * gameplay logic never has to care about the device's actual screen size.
 */
(function (global) {
  'use strict';

  function toLocal(canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  // ---- Keyboard (WASD / arrows) ----------------------------------------
  function KeyboardMovement() {
    var keys = {};
    window.addEventListener('keydown', function (e) { keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });

    this.getVector = function () {
      var x = 0, y = 0;
      if (keys['a'] || keys['arrowleft']) x -= 1;
      if (keys['d'] || keys['arrowright']) x += 1;
      if (keys['w'] || keys['arrowup']) y -= 1;
      if (keys['s'] || keys['arrowdown']) y += 1;
      var len = Math.sqrt(x * x + y * y);
      if (len > 0) { x /= len; y /= len; }
      return { x: x, y: y };
    };
  }

  // ---- Virtual joystick (bottom-left, touch) ---------------------------
  // baseEl / knobEl are DOM elements (see game.html); this just handles the
  // pointer math and reports a normalized -1..1 vector via getVector().
  function VirtualJoystick(baseEl, knobEl) {
    var active = false;
    var vec = { x: 0, y: 0 };
    var radius = 45;
    var pointerId = null;

    function setKnob(dx, dy) {
      knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }

    function onDown(e) {
      active = true;
      pointerId = e.pointerId;
      baseEl.setPointerCapture(pointerId);
      onMove(e);
    }
    function onMove(e) {
      if (!active || e.pointerId !== pointerId) return;
      var rect = baseEl.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dx = e.clientX - cx;
      var dy = e.clientY - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) { dx = (dx / dist) * radius; dy = (dy / dist) * radius; }
      setKnob(dx, dy);
      vec.x = ZizoUtils.clamp(dx / radius, -1, 1);
      vec.y = ZizoUtils.clamp(dy / radius, -1, 1);
    }
    function onUp(e) {
      if (e.pointerId !== pointerId) return;
      active = false;
      pointerId = null;
      vec.x = 0; vec.y = 0;
      setKnob(0, 0);
    }

    baseEl.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    this.getVector = function () { return vec; };
  }

  // ---- Brush pointer input (paint phase) --------------------------------
  // Wires pointer events on the visible (CSS-scaled) paint canvas to a
  // ZizoPaint.PaintEngine instance, converting to the engine's fixed
  // PAINT_W x PAINT_H internal coordinate space.
  function bindPaintPointer(canvas, paintEngine) {
    var drawing = false;
    function local(e) {
      var p = toLocal(canvas, e.clientX, e.clientY);
      return p;
    }
    canvas.addEventListener('pointerdown', function (e) {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      var p = local(e);
      paintEngine.strokeStart(p.x, p.y);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = local(e);
      paintEngine.strokeMove(p.x, p.y);
      e.preventDefault();
    });
    function end(e) {
      if (!drawing) return;
      drawing = false;
      paintEngine.strokeEnd();
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', end);
  }

  // ---- Stage tap/click (seeker catch attempts, eyedropper sampling) ------
  // onPick(ndcX, ndcY) is called on every click/tap on the stage canvas, with
  // coordinates already converted to Three.js "normalized device" space
  // (-1..1 on each axis, origin at canvas center, +Y up) — exactly what
  // THREE.Raycaster.setFromCamera() expects, since the 3D scene is picked by
  // raycasting rather than 2D pixel math.
  function bindStagePick(canvas, onPick) {
    canvas.addEventListener('pointerdown', function (e) {
      var rect = canvas.getBoundingClientRect();
      var ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      var ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      onPick(ndcX, ndcY, e);
    });
  }

  global.ZizoInput = {
    toLocal: toLocal,
    KeyboardMovement: KeyboardMovement,
    VirtualJoystick: VirtualJoystick,
    bindPaintPointer: bindPaintPointer,
    bindStagePick: bindStagePick
  };
})(window);
