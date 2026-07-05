/*
 * stages.js — stage config loading.
 *
 * Stage data (3D room dimensions/colors, zones/spawns/bounds, optional
 * uploaded floor texture) is authored in the admin panel and stored in
 * MySQL; the frontend only ever reads it back through api/get-config.php
 * (see config.js), so an admin's edits take effect immediately with no code
 * changes. The actual 3D scene is built from this data by scene3d.js.
 *
 * The data/stages/*.json files in this repo are just the seed content the
 * SQL import ships with — once imported into `stages.config_json`, MySQL is
 * the source of truth and those static files are no longer read by the
 * running game. If MySQL/api/get-config.php is ever unreachable, we fall
 * back to fetching the matching static JSON file directly so the game
 * degrades gracefully instead of hard-failing.
 */
(function (global) {
  'use strict';

  var cache = {};

  async function loadStage(slug) {
    if (cache[slug]) return cache[slug];
    var cfg = await global.ZizoConfig.loadGameConfig();
    var fromDb = (cfg.stages || []).filter(function (s) { return s.slug === slug; })[0];
    var stage = fromDb || await loadStageFallback(slug);
    cache[slug] = stage;
    return stage;
  }

  // Only used if the stage isn't present in the MySQL-backed config above
  // (e.g. api/get-config.php unreachable) — reads the static seed JSON.
  async function loadStageFallback(slug) {
    var res = await fetch('data/stages/' + slug + '.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load stage: ' + slug);
    return res.json();
  }

  global.ZizoStages = { loadStage: loadStage };
})(window);
