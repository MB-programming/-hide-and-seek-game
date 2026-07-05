/*
 * seeker.js — Seeker-side waiting screen + catch-attempt resolution.
 *
 * Catch flow: a Seeker taps/clicks somewhere on the stage. We hit-test that
 * point against every other live player's on-screen bounding box (see
 * player.js containsPoint). Tapping a live Hider resolves as a correct
 * catch through room.attemptCatch's transaction; tapping anything else
 * (empty scenery, another Seeker, an already-caught Hider) is a wrong
 * catch and applies a brief input-freeze penalty so guessing wildly has a
 * real cost.
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

  // playersMap: { id -> ZizoPlayer.Player instance }. Returns a Promise
  // resolving to { hit: bool, correct: bool|null }.
  async function attemptCatchAt(room, playersMap, worldX, worldY, penaltySec) {
    if (isFrozen()) return { hit: false, correct: null };

    var targetId = null;
    Object.keys(playersMap).forEach(function (id) {
      if (id === room.uid) return;
      var p = playersMap[id];
      if (!p.alive || p.role === 'seeker') return;
      if (p.containsPoint(worldX, worldY)) targetId = id;
    });

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
    attemptCatchAt: attemptCatchAt
  };
})(window);
