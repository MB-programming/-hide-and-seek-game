/*
 * net.js — thin wrapper around the one PHP endpoint (api/game.php) that
 * powers all multiplayer state. Replaces this project's earlier Firebase
 * Realtime Database transport: no push connection, no persistent server —
 * every call is a plain POST with a JSON {action, ...} body, polled
 * repeatedly by room.js instead of subscribed to.
 *
 * Also tracks a server-time offset (server_time returned on every response
 * minus our local Date.now()) so countdowns stay correct even if a
 * player's device clock is wrong — the same purpose Firebase's
 * '.info/serverTimeOffset' trick served before.
 */
(function (global) {
  'use strict';

  var serverTimeOffset = 0;

  async function call(action, params) {
    var body = Object.assign({ action: action }, params || {});
    var res = await fetch('api/game.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data;
    try { data = await res.json(); } catch (e) { data = { ok: false, error: 'Invalid server response.' }; }
    if (typeof data.serverTime === 'number') serverTimeOffset = data.serverTime - Date.now();
    if (!data.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  function serverNow() { return Date.now() + serverTimeOffset; }

  global.ZizoNet = { call: call, serverNow: serverNow };
})(window);
