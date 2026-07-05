/*
 * firebase-init.js — bootstraps the Firebase compat SDK (loaded via CDN in
 * <head>, see index.html/game.html). We use the "compat" build on purpose:
 * it works with plain <script> tags (no bundler/build step, per project
 * requirements) and runs fine on old Android browsers that don't reliably
 * support ES module <script type="module"> chains.
 *
 * Anonymous Authentication gives every browser tab a stable auth.uid we use
 * as the player id — this lets firebase-rules.json restrict "a player can
 * only write their own players/{uid} node" without any account system.
 */
(function (global) {
  'use strict';

  var app = firebase.initializeApp(global.ZIZO_FIREBASE_CONFIG);
  var db = firebase.database();
  var auth = firebase.auth();

  // Firebase's special '.info/serverTimeOffset' path streams (serverTime -
  // localTime) so every client can compute a server-accurate "now" without
  // needing its own clock to be correct. Phase timers (room.js) are built
  // entirely on serverNow() so a host with a skewed clock doesn't desync
  // everyone else's countdowns.
  var serverTimeOffset = 0;
  db.ref('.info/serverTimeOffset').on('value', function (snap) {
    serverTimeOffset = snap.val() || 0;
  });
  function serverNow() { return Date.now() + serverTimeOffset; }

  function ensureSignedIn() {
    return new Promise(function (resolve, reject) {
      var unsub = auth.onAuthStateChanged(function (user) {
        if (user) {
          unsub();
          resolve(user);
        }
      }, reject);
      if (!auth.currentUser) {
        auth.signInAnonymously().catch(reject);
      }
    });
  }

  global.ZizoFirebase = {
    app: app,
    db: db,
    auth: auth,
    ensureSignedIn: ensureSignedIn,
    serverTimestamp: firebase.database.ServerValue.TIMESTAMP,
    serverNow: serverNow
  };
})(window);
