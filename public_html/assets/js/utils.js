/*
 * utils.js — small shared helpers, no dependencies.
 */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function dist(x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Short human-friendly room codes, e.g. "K7F2Q9" — avoids ambiguous
  // characters (0/O, 1/I) so players can read codes aloud/type them easily.
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function randomRoomCode(len) {
    len = len || 6;
    var out = '';
    for (var i = 0; i < len; i++) {
      out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return out;
  }

  function sanitizeNickname(name) {
    return String(name || '').trim().slice(0, 20) || 'Player';
  }

  // Basic throttle: returns a wrapped fn that runs at most once per `ms`,
  // always firing on the trailing edge so the last call isn't dropped.
  // Used to cap Firebase writes for continuous things like player movement.
  function throttle(fn, ms) {
    var last = 0, timer = null, pendingArgs = null;
    function run() {
      last = Date.now();
      timer = null;
      var args = pendingArgs;
      pendingArgs = null;
      fn.apply(null, args);
    }
    return function () {
      pendingArgs = arguments;
      var remaining = ms - (Date.now() - last);
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        run();
      } else if (!timer) {
        timer = setTimeout(run, remaining);
      }
    };
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  global.ZizoUtils = {
    clamp: clamp,
    dist: dist,
    randomRoomCode: randomRoomCode,
    sanitizeNickname: sanitizeNickname,
    throttle: throttle,
    qs: qs,
    qsa: qsa,
    el: el
  };
})(window);
