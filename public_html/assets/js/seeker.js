/*
 * seeker.js — Seeker-side waiting screen + catch-attempt resolution.
 *
 * Catch flow: a Seeker taps/clicks somewhere on the stage; game-main.js
 * resolves that tap into a target player id (or null) via a THREE.Raycaster
 * hit-test against the 3D character meshes, then hands the result here.
 * A resolved Hider id goes through room.attemptCatch's transaction; a null
 * target (empty scenery, another Seeker, an already-caught Hider) is a
 * wrong catch and applies a brief input-freeze penalty so guessing wildly
 * has a real cost.
 */
(function (global) {
  'use strict';

  var $ = ZizoUtils.qs;
  var frozenUntil = 0;

  function initSeekerWaiting(room) {
    room.on('meta', function (meta) {
      if (meta.phase === 'painting' || meta.phase === 'starting') {
        var label = $('#seeker-wait-label');
        if (label) label.textContent = 'Hiders are painting and hiding...';
      }
    });
  }

  function isFrozen() {
    return Date.now() < frozenUntil;
  }

  function freezeMs(ms) {
    frozenUntil = Math.max(frozenUntil, Date.now() + ms);
  }

  // targetId is whatever game-main.js's raycaster resolved the tap/click to
  // (a hider's player id, or null if the ray missed every hider mesh).
  // Returns a Promise resolving to { hit: bool, correct: bool|null }.
  async function resolveCatchAttempt(room, targetId, penaltySec) {
    if (isFrozen()) return { hit: false, correct: null };

    if (!targetId) {
      freezeMs((penaltySec || 3) * 1000);
      return { hit: true, correct: false };
    }

    var result = await room.attemptCatch(targetId);
    if (!result.correct) freezeMs((penaltySec || 3) * 1000);
    return { hit: true, correct: result.correct, targetId: targetId };
  }

  global.ZizoSeeker = {
    init: initSeekerWaiting,
    isFrozen: isFrozen,
    resolveCatchAttempt: resolveCatchAttempt
  };
})(window);
