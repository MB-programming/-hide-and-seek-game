/*
 * config.js — single cached fetch of api/get-config.php.
 *
 * Bridges the PHP/MySQL admin panel to the static frontend: stage list,
 * sound assignments, and gameplay defaults (seeker count, durations, etc.)
 * all live in MySQL and are edited from /admin, but the frontend never
 * talks to MySQL directly — it just reads this one public JSON endpoint.
 */
(function (global) {
  'use strict';

  var promise = null;

  function loadGameConfig() {
    if (!promise) {
      promise = fetch('api/get-config.php', { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .catch(function () {
          return { settings: {}, sounds: {}, stages: [] };
        });
    }
    return promise;
  }

  global.ZizoConfig = { loadGameConfig: loadGameConfig };
})(window);
