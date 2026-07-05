/*
 * audio.js — lazy sound effects.
 *
 * Sound files are uploaded/assigned to events from the admin panel and
 * exposed to the frontend via api/get-config.php (so the game never needs
 * direct MySQL access). Files are only fetched from the network the first
 * time their event actually fires, keeping initial page weight small.
 */
(function (global) {
  'use strict';

  var config = null;   // { sounds: { event_key: { default: path, byStage: {slug: path} } } } (via config.js)
  var cache = {};       // path -> HTMLAudioElement
  var unlocked = false;
  var ambientEl = null;

  function unlockOnFirstGesture() {
    if (unlocked) return;
    unlocked = true;
    // Mobile browsers block audio until a user gesture; play+pause a silent
    // buffer here so later programmatic play() calls aren't blocked.
    try {
      var a = new Audio();
      a.play().catch(function () {});
    } catch (e) { /* no-op */ }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
    document.addEventListener(evt, unlockOnFirstGesture, { once: true, passive: true });
  });

  async function loadConfig() {
    if (config) return config;
    config = await global.ZizoConfig.loadGameConfig();
    return config;
  }

  function resolvePath(eventKey, stageSlug) {
    if (!config || !config.sounds || !config.sounds[eventKey]) return null;
    var entry = config.sounds[eventKey];
    if (stageSlug && entry.byStage && entry.byStage[stageSlug]) return entry.byStage[stageSlug];
    return entry.default || null;
  }

  function getAudio(path) {
    if (!cache[path]) {
      var a = new Audio(path);
      a.preload = 'none';
      cache[path] = a;
    }
    return cache[path];
  }

  function play(eventKey, stageSlug) {
    var path = resolvePath(eventKey, stageSlug);
    if (!path) return;
    var a = getAudio(path);
    try {
      a.currentTime = 0;
      a.play().catch(function () {});
    } catch (e) { /* ignore playback errors (autoplay policies, etc) */ }
  }

  function playAmbient(stageSlug) {
    stopAmbient();
    var path = resolvePath('ambient', stageSlug);
    if (!path) return;
    ambientEl = getAudio(path);
    ambientEl.loop = true;
    ambientEl.volume = 0.35;
    ambientEl.play().catch(function () {});
  }

  function stopAmbient() {
    if (ambientEl) {
      ambientEl.pause();
      ambientEl = null;
    }
  }

  global.ZizoAudio = {
    loadConfig: loadConfig,
    play: play,
    playAmbient: playAmbient,
    stopAmbient: stopAmbient
  };
})(window);
