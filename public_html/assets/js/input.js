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

  // ---- Stage pointer handling: tap-to-pick vs drag-to-look-around --------
  // A single pointerdown/move/up sequence on the stage canvas serves two
  // different purposes, disambiguated by how far the pointer moved before
  // release:
  //   - barely moved  -> a "tap" -> onPick(ndcX, ndcY) (seeker catch
  //     attempts, eyedropper sampling), coordinates already converted to
  //     Three.js "normalized device" space (-1..1, +Y up) for
  //     THREE.Raycaster.setFromCamera().
  //   - moved past DRAG_THRESHOLD px -> a "drag" -> onDrag(dxPixels,
  //     dyPixels) fires continuously as the pointer moves, driving the
  //     look-around camera orbit in game-main.js. onDrag is optional.
  var DRAG_THRESHOLD = 8;

  function bindStagePick(canvas, onPick, onDrag) {
    var down = null; // { x, y, pointerId }
    var dragging = false;
    var last = null;

    canvas.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      last = { x: e.clientX, y: e.clientY };
      dragging = false;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== down.pointerId) return;
      var totalDx = e.clientX - down.x, totalDy = e.clientY - down.y;
      if (!dragging && Math.sqrt(totalDx * totalDx + totalDy * totalDy) > DRAG_THRESHOLD) dragging = true;
      if (dragging && onDrag) {
        onDrag(e.clientX - last.x, e.clientY - last.y);
      }
      last = { x: e.clientX, y: e.clientY };
    });

    function end(e) {
      if (!down || e.pointerId !== down.pointerId) return;
      if (!dragging) {
        var rect = canvas.getBoundingClientRect();
        var ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        var ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        onPick(ndcX, ndcY, e);
      }
      down = null;
      dragging = false;
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  global.ZizoInput = {
    toLocal: toLocal,
    KeyboardMovement: KeyboardMovement,
    VirtualJoystick: VirtualJoystick,
    bindPaintPointer: bindPaintPointer,
    bindStagePick: bindStagePick
  };
})(window);
