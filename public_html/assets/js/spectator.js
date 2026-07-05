/*
 * spectator.js — clean, overlay-free viewing mode.
 *
 * Toggled by the HUD "Spectate" button for anyone watching (including a
 * Hider who has already been caught). It simply hides the HUD/toolbar/
 * buttons so the canvas fills the screen — useful for streaming/screen
 * recording without extra chrome. It does NOT change the player's role in
 * Firebase; it's a purely local rendering preference.
 */
(function (global) {
  'use strict';

  var $ = ZizoUtils.qs;
  var active = false;

  function isActive() { return active; }

  function toggle() {
    active = !active;
    apply();
  }

  function apply() {
    document.body.classList.toggle('spectator-clean', active);
    ['#hud', '#paint-toolbar', '#btn-reposition', '#joystick-base'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.classList.toggle('force-hidden', active);
    });
  }

  global.ZizoSpectator = { isActive: isActive, toggle: toggle };
})(window);
