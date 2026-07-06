/*
 * sw.js — minimal service worker: caches the static app "shell" (HTML/CSS/
 * JS/icons) so the game loads instantly and semi-offline, while NEVER
 * caching api/*.php calls (live room state must always be fresh) or the
 * Three.js CDN request (left to the browser's own HTTP cache). This is
 * what makes the game installable as a home-screen/PWA app.
 *
 * Bump CACHE_NAME whenever shell files change so returning visitors pick up
 * the new version instead of a stale cached copy.
 */
var CACHE_NAME = 'zizo-hide-v1';
var SHELL_ASSETS = [
  './index.html', './game.html', './manifest.json',
  './assets/css/style.css',
  './assets/js/utils.js', './assets/js/lang.js', './assets/js/config.js',
  './assets/js/net.js', './assets/js/stages.js', './assets/js/scene3d.js',
  './assets/js/paint.js', './assets/js/player.js', './assets/js/input.js',
  './assets/js/room.js', './assets/js/lobby.js', './assets/js/seeker.js',
  './assets/js/spectator.js', './assets/js/game-main.js', './assets/js/main.js',
  './assets/js/audio.js', './assets/js/matchmaking.js',
  './assets/img/icon-192.png', './assets/img/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(SHELL_ASSETS); })
      .catch(function () { /* best-effort — a missing asset shouldn't block install */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  // Live game state and any cross-origin request (Three.js CDN) always go
  // straight to the network — never served from or written to our cache.
  if (url.pathname.indexOf('/api/') !== -1 || url.origin !== location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networked = fetch(event.request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      // Cache-first for instant loads; falls back to network if not cached yet.
      return cached || networked;
    })
  );
});
