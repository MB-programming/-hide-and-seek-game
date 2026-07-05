/*
 * room.js — one multiplayer room session, backed by plain PHP + MySQL
 * polling (api/game.php) instead of a realtime push service. There is no
 * persistent server process here — see api/game.php's file header for how
 * the phase clock (lobby -> starting -> painting -> seeking -> results) is
 * driven server-side by whichever client happens to poll next, rather than
 * by a single elected "host" browser tab. That server-side design is what
 * let this rewrite drop the old host-election/failover logic entirely.
 *
 * Public API is kept deliberately identical to this project's previous
 * Firebase-backed version (create/join/spectate/setReady/startRound/
 * updateTransform/syncPaintCheckpoint/setPose/requestRepaint/
 * endRepaintWindow/attemptCatch/resetToLobby/leave, plus room.on('meta'|
 * 'players'|'event', fn) and room.uid/room.isHost/room.meta/room.players)
 * so lobby.js, seeker.js and game-main.js needed only the smallest of
 * changes (requestRepaint became async — see game-main.js) when the
 * transport swapped from Firebase to this.
 *
 * Bandwidth/load note: polling interval adapts to the room's phase — slow
 * (1500ms) while sitting in the lobby or looking at results, faster
 * (700ms) during an active round. Movement itself stays optimistic on the
 * local client (see game-main.js) so your own motion never waits on a
 * round-trip; only *other* players' positions are only as fresh as the
 * last poll. Tune IDLE_POLL_MS/ACTIVE_POLL_MS below if your host needs it
 * slower, or your players want it snappier.
 */
(function (global) {
  'use strict';

  var PHASES = ['lobby', 'starting', 'painting', 'seeking', 'results'];
  var STARTING_COUNTDOWN_SEC = 3; // mirrors api/game.php's STARTING_COUNTDOWN_SEC
  var REPAINT_WINDOW_SEC = 12; // mirrors api/game.php's REPAINT_WINDOW_SEC
  var TRANSFORM_THROTTLE_MS = 200;
  var IDLE_POLL_MS = 1500; // lobby / results
  var ACTIVE_POLL_MS = 700; // starting / painting / seeking

  function Room() {
    this.code = null;
    this.uid = null; // == playerId; kept as "uid" for continuity with the old API
    this.token = null;
    this.isHost = false; // == "isCreator" — the player who created the room
    this.isSpectator = false;
    this.meta = null;
    this.players = {};
    this.stage = null; // unused by room.js itself now (spawn assignment moved server-side) but game-main.js still sets it for its own rendering needs
    this._polling = false;
    this._pollTimeout = null;
    this._handlers = { meta: [], players: [], event: [] };

    var self = this;
    this.updateTransform = ZizoUtils.throttle(function (x, y, pose) {
      if (!self.code || !self.uid) return;
      ZizoNet.call('update_transform', { code: self.code, playerId: self.uid, token: self.token, x: x, y: y, pose: pose }).catch(function () {});
    }, TRANSFORM_THROTTLE_MS);
  }

  Room.prototype.on = function (kind, fn) { this._handlers[kind].push(fn); return this; };
  Room.prototype._emit = function (kind, payload) { this._handlers[kind].forEach(function (fn) { fn(payload); }); };

  function sessionKey(code) { return 'zizo_session_' + code; }
  function saveSession(code, uid, token, isHost) {
    try { sessionStorage.setItem(sessionKey(code), JSON.stringify({ uid: uid, token: token, isHost: isHost })); } catch (e) { /* ignore (private mode etc) */ }
  }

  // ---- create / join / spectate -----------------------------------------

  Room.prototype.create = async function (opts) {
    var res = await ZizoNet.call('create_room', opts);
    this.code = res.code;
    this.uid = res.playerId;
    this.token = res.token;
    this.isHost = res.isCreator;
    saveSession(this.code, this.uid, this.token, this.isHost);
    this._startPolling();
    return this.code;
  };

  // Resumes an existing session (e.g. after an accidental page refresh)
  // instead of joining fresh as a new player, if we recognize this room
  // code from a prior create()/join() this tab. Returns true if resumed.
  Room.prototype.resume = function (code) {
    code = String(code || '').toUpperCase().trim();
    var raw;
    try { raw = sessionStorage.getItem(sessionKey(code)); } catch (e) { raw = null; }
    if (!raw) return false;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return false; }
    if (!saved || !saved.uid || !saved.token) return false;
    this.code = code;
    this.uid = saved.uid;
    this.token = saved.token;
    this.isHost = !!saved.isHost;
    this._startPolling();
    return true;
  };

  Room.prototype.join = async function (code, nickname) {
    code = String(code || '').toUpperCase().trim();
    var res = await ZizoNet.call('join_room', { code: code, nickname: nickname });
    this.code = res.code;
    this.uid = res.playerId;
    this.token = res.token;
    this.isHost = res.isCreator;
    saveSession(this.code, this.uid, this.token, this.isHost);
    this._startPolling();
    return this.code;
  };

  // Spectators watch without occupying a player slot — no player row is
  // created, so they never count toward maxPlayers (see api/game.php).
  Room.prototype.spectate = async function (code) {
    code = String(code || '').toUpperCase().trim();
    var res = await ZizoNet.call('spectate_room', { code: code });
    this.code = res.code;
    this.uid = null;
    this.token = null;
    this.isHost = false;
    this.isSpectator = true;
    this._startPolling();
    return this.code;
  };

  Room.prototype.leave = function () {
    this._stopPolling();
    if (this.code && this.uid) {
      ZizoNet.call('leave_room', { code: this.code, playerId: this.uid, token: this.token }).catch(function () {});
      try { sessionStorage.removeItem(sessionKey(this.code)); } catch (e) { /* ignore */ }
    }
  };

  // ---- polling loop -------------------------------------------------
  // Recursive setTimeout (not setInterval) so we never fire a new poll
  // before the previous one's response has come back — important on a
  // shared host where a slow response shouldn't cause request pileup.

  Room.prototype._startPolling = function () {
    this._polling = true;
    this._pollLoop();
  };
  Room.prototype._stopPolling = function () {
    this._polling = false;
    if (this._pollTimeout) clearTimeout(this._pollTimeout);
  };

  Room.prototype._pollLoop = async function () {
    if (!this._polling) return;
    try {
      var data = await ZizoNet.call('get_state', { code: this.code, playerId: this.uid || undefined });
      this._detectCatchEvents(data.players);
      this.meta = data.meta;
      this.players = data.players;
      this._emit('meta', this.meta);
      this._emit('players', this.players);
    } catch (e) {
      // Transient network/server hiccup — just try again next tick rather
      // than tearing down the whole session over one failed poll.
    }
    if (!this._polling) return;
    var active = this.meta && (this.meta.phase === 'starting' || this.meta.phase === 'painting' || this.meta.phase === 'seeking');
    var delay = active ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    var self = this;
    this._pollTimeout = setTimeout(function () { self._pollLoop(); }, delay);
  };

  // Replaces the old Firebase "events" push feed: diff alive-flags between
  // polls and emit a local 'catch' event when a Hider flips alive -> caught.
  // Every polling client (not just the Seeker who made the catch) detects
  // this on its own next poll, which is what drives the catch sound/flash
  // in game-main.js for everyone in the room.
  Room.prototype._detectCatchEvents = function (newPlayers) {
    var old = this.players || {};
    var self = this;
    Object.keys(newPlayers).forEach(function (id) {
      var was = old[id];
      var now = newPlayers[id];
      if (now.role === 'hider' && now.alive === false && (!was || was.alive !== false)) {
        self._emit('event', { type: 'catch', targetId: id });
      }
    });
  };

  // ---- lobby / settings -----------------------------------------------

  Room.prototype.setReady = function (ready) {
    ZizoNet.call('set_ready', { code: this.code, playerId: this.uid, token: this.token, ready: !!ready }).catch(function () {});
  };

  Room.prototype.updateSettings = function (partial) {
    if (!this.isHost || !this.meta || this.meta.phase !== 'lobby') return;
    var payload = Object.assign({ code: this.code, playerId: this.uid, token: this.token }, partial);
    ZizoNet.call('update_settings', payload).catch(function () {});
  };

  Room.prototype.startRound = async function () {
    if (!this.isHost) return;
    await ZizoNet.call('start_round', { code: this.code, playerId: this.uid, token: this.token });
  };

  Room.prototype.resetToLobby = async function () {
    if (!this.isHost) return;
    await ZizoNet.call('reset_to_lobby', { code: this.code, playerId: this.uid, token: this.token });
  };

  // ---- paint / pose / repaint -------------------------------------------

  // Called ONLY on explicit checkpoints (the "Confirm" button, or once
  // automatically when the painting phase timer ends) — never per brush
  // stroke. See paint.js's file header for why that matters for bandwidth.
  Room.prototype.syncPaintCheckpoint = function (dataUrl) {
    return ZizoNet.call('sync_paint', { code: this.code, playerId: this.uid, token: this.token, data: dataUrl }).catch(function () {});
  };

  Room.prototype.setPose = function (pose) {
    ZizoNet.call('set_pose', { code: this.code, playerId: this.uid, token: this.token, pose: pose }).catch(function () {});
  };

  // Unlike the old Firebase version, this now has to ask the SERVER whether
  // a repaint is allowed (repaint_limit is enforced there, not just
  // trusted from the client), so it returns a Promise<boolean> instead of
  // a plain boolean — see the corresponding await in game-main.js.
  Room.prototype.requestRepaint = async function () {
    try {
      var res = await ZizoNet.call('request_repaint', { code: this.code, playerId: this.uid, token: this.token });
      return !!res.granted;
    } catch (e) {
      return false;
    }
  };

  Room.prototype.endRepaintWindow = function () {
    ZizoNet.call('end_repaint', { code: this.code, playerId: this.uid, token: this.token }).catch(function () {});
  };

  // ---- catching -------------------------------------------------------

  // Resolved via an atomic conditional UPDATE server-side (api/game.php's
  // action_attempt_catch) so two Seekers tapping the same Hider at once
  // can't both "win" the catch — mirrors the old Firebase transaction.
  Room.prototype.attemptCatch = async function (targetId) {
    var res = await ZizoNet.call('attempt_catch', { code: this.code, playerId: this.uid, token: this.token, targetId: targetId });
    return { correct: !!res.correct };
  };

  global.ZizoRoom = {
    Room: Room,
    PHASES: PHASES,
    STARTING_COUNTDOWN_SEC: STARTING_COUNTDOWN_SEC,
    REPAINT_WINDOW_SEC: REPAINT_WINDOW_SEC
  };
})(window);
