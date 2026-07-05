/*
 * matchmaking.js — the public room BROWSER LIST shown on index.html.
 * Polls api/game.php's list_public_rooms action (open rooms still in their
 * lobby phase with a free slot) instead of subscribing to a realtime feed.
 */
(function (global) {
  'use strict';

  var LIST_POLL_MS = 4000; // browsing the lobby list isn't latency-sensitive

  function listPublicRooms(onChange) {
    var stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        var data = await ZizoNet.call('list_public_rooms', {});
        onChange(data.rooms || []);
      } catch (e) {
        // transient network hiccup — just retry on the next tick
      }
      if (!stopped) setTimeout(poll, LIST_POLL_MS);
    }
    poll();

    return function unsubscribe() { stopped = true; };
  }

  global.ZizoMatchmaking = { listPublicRooms: listPublicRooms };
})(window);
