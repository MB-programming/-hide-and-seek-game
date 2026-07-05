/*
 * stages.js — stage loading + background rendering
 *
 * Stage data (zones/spawns/bounds/optional uploaded background image) is
 * authored in the admin panel and stored in MySQL; the frontend only ever
 * reads it back through api/get-config.php (see config.js), so an admin's
 * edits take effect immediately with no code changes. The data/stages/*.json
 * files in this repo are just the seed content the SQL import ships with —
 * once imported into `stages.config_json`, MySQL is the source of truth and
 * those static files are no longer read by the running game. If MySQL is
 * ever unreachable, we fall back to fetching the matching static JSON file
 * directly so the game degrades gracefully instead of hard-failing.
 *
 * Each stage either points at a real uploaded background image
 * (backgroundImage, set from the admin panel) or falls back to a
 * "procedural" renderer defined below — flat-colored shapes drawn straight
 * into a canvas. This means the game never *requires* bitmap art to be
 * playable: it ships zero binary image assets, keeps page weight tiny, and
 * still gives the eyedropper tool real distinct colors to sample per zone
 * (crate wood, pipe steel, etc).
 *
 * IMPORTANT: procedural renderers must be 100% deterministic (no Math.random)
 * because every client draws the background independently and the eyedropper
 * samples pixels from that local drawing — if two clients drew different
 * pixels, camouflage would desync between the painter and the seekers judging
 * it.
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

  // ---- flat helpers ---------------------------------------------------
  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  function stripes(ctx, x, y, w, h, color, gap) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (var i = x; i < x + w; i += gap) {
      ctx.beginPath();
      ctx.moveTo(i, y);
      ctx.lineTo(i, y + h);
      ctx.stroke();
    }
  }

  // Each renderer draws: sky/back-wall band, floor band, then the zone
  // props described in the stage JSON (drawn with a fixed palette keyed by
  // zone index so it lines up with data/stages/*.json ordering).
  var RENDERERS = {
    warehouse: function (ctx, w, h, zones) {
      rect(ctx, 0, 0, w, h, '#5b5f66');
      rect(ctx, 0, h * 0.48, w, h * 0.52, '#8a8f78');
      stripes(ctx, 0, 0, w, h * 0.48, 'rgba(0,0,0,0.06)', 40);
      var palette = ['#8a5a2b', '#c9b27a', '#5c6570', '#3d3a35', '#a9724f'];
      zones.forEach(function (z, i) {
        rect(ctx, z.x, z.y, z.w, z.h, palette[i % palette.length]);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(z.x, z.y, z.w, z.h);
      });
    },
    classroom: function (ctx, w, h, zones) {
      rect(ctx, 0, 0, w, h, '#e7dcc2');
      rect(ctx, 0, h * 0.48, w, h * 0.52, '#b98650');
      stripes(ctx, 0, h * 0.48, w, h * 0.52, 'rgba(0,0,0,0.08)', 60);
      var palette = ['#6b4a2f', '#caa96b', '#2f6b4f', '#8c8f92', '#c94f4f'];
      zones.forEach(function (z, i) {
        rect(ctx, z.x, z.y, z.w, z.h, palette[i % palette.length]);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(z.x, z.y, z.w, z.h);
      });
    },
    office: function (ctx, w, h, zones) {
      rect(ctx, 0, 0, w, h, '#dfe3e6');
      rect(ctx, 0, h * 0.48, w, h * 0.52, '#9aa0a6');
      var palette = ['#4a4f57', '#2c2f33', '#c7b299', '#4f7d4a', '#5a7fa6'];
      zones.forEach(function (z, i) {
        rect(ctx, z.x, z.y, z.w, z.h, palette[i % palette.length]);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(z.x, z.y, z.w, z.h);
      });
    },
    street: function (ctx, w, h, zones) {
      rect(ctx, 0, 0, w, h, '#7691a8');
      rect(ctx, 0, h * 0.48, w, h * 0.52, '#59595c');
      stripes(ctx, 0, h * 0.48, w, h * 0.52, 'rgba(255,255,255,0.10)', 90);
      var palette = ['#a3402f', '#4a7a4f', '#3a3a3d', '#7a6a54', '#c9c2ab'];
      zones.forEach(function (z, i) {
        rect(ctx, z.x, z.y, z.w, z.h, palette[i % palette.length]);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(z.x, z.y, z.w, z.h);
      });
    }
  };

  // Renders the stage background into ctx (a real, visible canvas context)
  // AND returns an offscreen canvas holding the identical pixels, used by
  // the eyedropper tool to sample exact colors regardless of what's been
  // drawn on top (players, UI, zone outlines) since it's drawn in isolation.
  function renderBackground(stage, ctx) {
    var w = stage.width, h = stage.height;
    var off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    var octx = off.getContext('2d');

    if (stage.backgroundImage) {
      // Real uploaded image (set via admin panel). Drawn synchronously if
      // already cached by the browser; caller should await imageReady().
      var img = new Image();
      img.src = stage.backgroundImage;
      var draw = function () {
        octx.drawImage(img, 0, 0, w, h);
        ctx.drawImage(off, 0, 0);
      };
      if (img.complete) draw();
      else img.onload = draw;
      renderBackground._pending = img;
    } else {
      var renderer = RENDERERS[stage.procedural] || RENDERERS.warehouse;
      renderer(octx, w, h, stage.zones || []);
      ctx.drawImage(off, 0, 0);
    }
    return off;
  }

  function sampleColor(offscreenCanvas, x, y) {
    var octx = offscreenCanvas.getContext('2d');
    var xi = Math.max(0, Math.min(offscreenCanvas.width - 1, Math.round(x)));
    var yi = Math.max(0, Math.min(offscreenCanvas.height - 1, Math.round(y)));
    var d = octx.getImageData(xi, yi, 1, 1).data;
    return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
  }

  global.ZizoStages = {
    loadStage: loadStage,
    renderBackground: renderBackground,
    sampleColor: sampleColor
  };
})(window);
