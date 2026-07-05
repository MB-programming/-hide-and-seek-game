/*
 * matchmaking.js — the public room BROWSER LIST shown on index.html.
 *
 * Reads the lightweight publicRooms/ index (see room.js header for the full
 * schema) rather than the full rooms/ tree, so browsing available matches
 * stays cheap even with many rooms open. Each room's own host keeps its
 * publicRooms/{code} mirror (playerCount/phase) fresh every host tick.
 */
(function (global) {
  'use strict';

  function listPublicRooms(onChange) {
    var ref = ZizoFirebase.db.ref('publicRooms').orderByChild('createdAt').limitToLast(30);
    var cb = ref.on('value', function (snap) {
      var rooms = [];
      snap.forEach(function (child) {
        var r = child.val();
        if (r.phase === 'lobby' && r.playerCount < r.maxPlayers) rooms.push(r);
      });
      rooms.reverse(); // newest first
      onChange(rooms);
    });
    return function unsubscribe() { ref.off('value', cb); };
  }

  global.ZizoMatchmaking = { listPublicRooms: listPublicRooms };
})(window);
