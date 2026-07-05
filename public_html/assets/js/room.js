/*
 * room.js — realtime multiplayer room: schema, phase state machine, and
 * matchmaking-adjacent per-room operations (create/join/leave, host
 * authority, catch resolution). See matchmaking.js for the public room
 * BROWSER LIST (separate from a single room's own state, handled here).
 *
 * ---------------------------------------------------------------------
 * Firebase Realtime Database layout (all under one project, free tier):
 *
 *   publicRooms/{code}            lightweight index for the room browser
 *     { code, isPublic, name, mapSlug, playerCount, maxPlayers, phase, createdAt }
 *
 *   rooms/{code}/meta             one room's settings + phase clock
 *     { hostId, code, isPublic, name, mapSlug, maxPlayers, seekerCount,
 *       paintDuration, roundDuration, repaintLimit, wrongCatchPenaltySec,
 *       phase, phaseStartedAt, hostHeartbeat, createdAt, winnerRole }
 *
 *   rooms/{code}/players/{uid}    one node per connected player
 *     { nickname, role: 'lobby'|'hider'|'seeker', ready, x, y, pose,
 *       alive, repaintsUsed, isRepainting, paint: { data, rev } }
 *
 *   rooms/{code}/events/{pushId}  append-only feed (catches, etc) for UI toasts
 *     { type, actorId, targetId, ts }
 *
 * We use the room CODE itself as the database key (not a random push id) so
 * "join by code" is a direct, single-location read — no query needed.
 *
 * HOST AUTHORITY: there is no persistent server process (static hosting +
 * Firebase only), so one connected browser — the "host" — is elected to
 * drive the phase clock (lobby -> starting -> painting -> seeking ->
 * results) and write the transitions everyone else just reacts to. All
 * timing math uses ZizoFirebase.serverNow() so client clock skew can't
 * desync countdowns. If the host disconnects, the longest-connected
 * remaining player promotes itself (see _watchHostFailover). This is a
 * best-effort failover appropriate for small casual-party rooms, not a
 * hard consensus protocol.
 * ---------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var PHASES = ['lobby', 'starting', 'painting', 'seeking', 'results'];
  var STARTING_COUNTDOWN_SEC = 3;
  var HOST_TICK_MS = 500;
  var HOST_HEARTBEAT_STALE_MS = 4500;
  var TRANSFORM_THROTTLE_MS = 120;
  var REPAINT_WINDOW_SEC = 12; // time given per repaint/reposition use

  function Room() {
    this.code = null;
    this.uid = null;
    this.isHost = false;
    this.meta = null;
    this.players = {};
    this.stage = null;
    this._hostTimer = null;
    this._watchdogTimer = null;
    this._listeners = [];
    this._handlers = { meta: [], players: [], event: [], removed: [] };

    // Instance-level throttle (not a shared prototype closure) so each
    // Room's movement writes are rate-limited independently. See file
    // header: capped at one write per TRANSFORM_THROTTLE_MS.
    var self = this;
    this.updateTransform = ZizoUtils.throttle(function (x, y, pose) {
      ZizoFirebase.db.ref('rooms/' + self.code + '/players/' + self.uid).update({
        x: Math.round(x), y: Math.round(y), pose: pose
      });
    }, TRANSFORM_THROTTLE_MS);
  }

  Room.prototype.on = function (kind, fn) {
    this._handlers[kind].push(fn);
    return this;
  };
  Room.prototype._emit = function (kind, payload) {
    this._handlers[kind].forEach(function (fn) { fn(payload); });
  };

  // ---- create / join ----------------------------------------------------

  Room.prototype.create = async function (opts) {
    var user = await ZizoFirebase.ensureSignedIn();
    this.uid = user.uid;
    var db = ZizoFirebase.db;

    var code = ZizoUtils.randomRoomCode(6);
    for (var attempts = 0; attempts < 5; attempts++) {
      var snap = await db.ref('rooms/' + code + '/meta').get();
      if (!snap.exists()) break;
      code = ZizoUtils.randomRoomCode(6);
    }
    this.code = code;

    var meta = {
      hostId: this.uid,
      code: code,
      isPublic: !!opts.isPublic,
      name: opts.name || (code + "'s room"),
      mapSlug: opts.mapSlug,
      maxPlayers: opts.maxPlayers,
      seekerCount: opts.seekerCount,
      paintDuration: opts.paintDuration,
      roundDuration: opts.roundDuration,
      repaintLimit: opts.repaintLimit,
      wrongCatchPenaltySec: opts.wrongCatchPenaltySec || 3,
      phase: 'lobby',
      phaseStartedAt: ZizoFirebase.serverTimestamp,
      hostHeartbeat: ZizoFirebase.serverTimestamp,
      createdAt: ZizoFirebase.serverTimestamp
    };
    await db.ref('rooms/' + code + '/meta').set(meta);

    if (meta.isPublic) {
      await db.ref('publicRooms/' + code).set({
        code: code,
        isPublic: true,
        name: meta.name,
        mapSlug: meta.mapSlug,
        playerCount: 0,
        maxPlayers: meta.maxPlayers,
        phase: 'lobby',
        createdAt: ZizoFirebase.serverTimestamp
      });
    }

    await this._joinPlayerNode(opts.nickname);
    this.isHost = true;
    this._subscribe();
    this._startHostLoop();
    return code;
  };

  Room.prototype.join = async function (code, nickname) {
    var user = await ZizoFirebase.ensureSignedIn();
    this.uid = user.uid;
    code = String(code || '').toUpperCase().trim();
    var db = ZizoFirebase.db;

    var metaSnap = await db.ref('rooms/' + code + '/meta').get();
    if (!metaSnap.exists()) throw new Error('Room not found.');
    var meta = metaSnap.val();
    if (meta.phase !== 'lobby') throw new Error('Round already in progress.');

    var playersSnap = await db.ref('rooms/' + code + '/players').get();
    var count = playersSnap.exists() ? Object.keys(playersSnap.val()).length : 0;
    if (count >= meta.maxPlayers) throw new Error('Room is full.');

    this.code = code;
    await this._joinPlayerNode(nickname);
    this.isHost = (meta.hostId === this.uid);
    this._subscribe();
    // Reconnecting as the original host (e.g. page refresh, same anon uid
    // persisted in this browser) resumes driving the clock; anyone else
    // just watches the heartbeat in case the real host never comes back.
    if (this.isHost) this._startHostLoop();
    else this._watchHostFailover();
    return code;
  };

  // Spectators observe a room's state without occupying a player slot —
  // no write to players/, so they never count toward maxPlayers.
  Room.prototype.spectate = async function (code) {
    var user = await ZizoFirebase.ensureSignedIn();
    this.uid = user.uid;
    this.code = String(code || '').toUpperCase().trim();
    this.isHost = false;
    this._subscribe();
    return this.code;
  };

  Room.prototype._joinPlayerNode = async function (nickname) {
    var db = ZizoFirebase.db;
    var ref = db.ref('rooms/' + this.code + '/players/' + this.uid);
    await ref.set({
      nickname: ZizoUtils.sanitizeNickname(nickname),
      role: 'lobby',
      ready: false,
      alive: true,
      pose: 'stand',
      x: 0,
      y: 0,
      repaintsUsed: 0,
      joinedAt: ZizoFirebase.serverTimestamp
    });
    ref.onDisconnect().remove();
  };

  // Lets the host tweak map/seeker-count/durations/repaint-limit from the
  // lobby (not just at room-creation time), as long as the round hasn't
  // started yet.
  Room.prototype.updateSettings = function (partial) {
    if (!this.isHost || !this.meta || this.meta.phase !== 'lobby') return;
    ZizoFirebase.db.ref('rooms/' + this.code + '/meta').update(partial);
  };

  Room.prototype.setReady = function (ready) {
    ZizoFirebase.db.ref('rooms/' + this.code + '/players/' + this.uid + '/ready').set(!!ready);
  };

  Room.prototype.leave = function () {
    if (!this.code || !this.uid) return;
    ZizoFirebase.db.ref('rooms/' + this.code + '/players/' + this.uid).remove();
    this._teardown();
  };

  // ---- subscriptions ------------------------------------------------

  Room.prototype._subscribe = function () {
    var self = this;
    var db = ZizoFirebase.db;

    var metaRef = db.ref('rooms/' + this.code + '/meta');
    var metaCb = metaRef.on('value', function (snap) {
      self.meta = snap.val();
      if (self.meta) self._emit('meta', self.meta);
    });
    this._listeners.push({ ref: metaRef, cb: metaCb });

    var playersRef = db.ref('rooms/' + this.code + '/players');
    var playersCb = playersRef.on('value', function (snap) {
      self.players = snap.val() || {};
      self._emit('players', self.players);
    });
    this._listeners.push({ ref: playersRef, cb: playersCb });

    var eventsRef = db.ref('rooms/' + this.code + '/events').limitToLast(20);
    var eventsCb = eventsRef.on('child_added', function (snap) {
      self._emit('event', snap.val());
    });
    this._listeners.push({ ref: eventsRef, cb: eventsCb });
  };

  Room.prototype._teardown = function () {
    this._listeners.forEach(function (l) { l.ref.off('value', l.cb); l.ref.off('child_added', l.cb); });
    this._listeners = [];
    if (this._hostTimer) clearInterval(this._hostTimer);
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);
  };

  // ---- movement / paint sync -----------------------------------------
  // (updateTransform itself is set up per-instance in the constructor above)

  // Called ONLY on explicit checkpoints ("Confirm Paint" / pause painting),
  // never per-stroke — this is the single biggest bandwidth control in the
  // whole app. A busy painting session can involve hundreds of brush
  // strokes; syncing all of them would multiply Firebase writes/bandwidth
  // for no visual benefit, since only the *result* matters to Seekers.
  Room.prototype.syncPaintCheckpoint = function (dataUrl) {
    return ZizoFirebase.db.ref('rooms/' + this.code + '/players/' + this.uid + '/paint').set({
      data: dataUrl,
      rev: ZizoFirebase.serverNow()
    });
  };

  Room.prototype.setPose = function (pose) {
    ZizoFirebase.db.ref('rooms/' + this.code + '/players/' + this.uid + '/pose').set(pose);
  };

  // Consumes one repaint/reposition credit (capped by meta.repaintLimit).
  // Returns true if granted. The "cost" is the REPAINT_WINDOW_SEC of being
  // openly repositionable/repaintable again rather than frozen in place.
  Room.prototype.requestRepaint = function () {
    var me = this.players[this.uid];
    if (!me || me.role !== 'hider' || !me.alive) return false;
    var limit = (this.meta && this.meta.repaintLimit) || 0;
    if ((me.repaintsUsed || 0) >= limit) return false;
    ZizoFirebase.db.ref('rooms/' + this.code + '/players/' + this.uid).update({
      repaintsUsed: (me.repaintsUsed || 0) + 1,
      isRepainting: true,
      repaintWindowEndsAt: ZizoFirebase.serverNow() + REPAINT_WINDOW_SEC * 1000
    });
    return true;
  };

  Room.prototype.endRepaintWindow = function () {
    ZizoFirebase.db.ref('rooms/' + this.code + '/players/' + this.uid).update({ isRepainting: false });
  };

  // ---- catching -------------------------------------------------------

  // A Seeker attempts to catch a suspected Hider. Resolved via a Firebase
  // transaction on the TARGET's node so two Seekers clicking the same
  // Hider at once can't both "win" the catch — only the first transaction
  // to commit flips alive=false; the second sees alive already false and
  // aborts. Returns { correct: bool } to the caller so the UI/audio can
  // react (catch sound + spectator switch, or a brief wrong-catch penalty).
  Room.prototype.attemptCatch = async function (targetId) {
    var self = this;
    var ref = ZizoFirebase.db.ref('rooms/' + this.code + '/players/' + targetId);
    var result = await ref.transaction(function (player) {
      if (!player) return player; // nothing there — abort, no-op
      if (player.role !== 'hider' || player.alive === false) return; // abort: not a valid catch
      player.alive = false;
      player.caughtBy = self.uid;
      player.caughtAt = ZizoFirebase.serverNow();
      return player;
    });

    var correct = result.committed && result.snapshot.exists() && result.snapshot.val().role === 'hider';
    ZizoFirebase.db.ref('rooms/' + this.code + '/events').push({
      type: correct ? 'catch' : 'wrongCatch',
      actorId: this.uid,
      targetId: targetId,
      ts: ZizoFirebase.serverNow()
    });
    return { correct: correct };
  };

  // ---- host authority: phase clock + role assignment -------------------

  // Called by the host (UI only shows the Start button to meta.hostId) to
  // move the room out of the lobby. Everything after this is driven by the
  // host's tick loop below, purely off elapsed serverNow() time.
  Room.prototype.startRound = async function () {
    if (!this.isHost) return;
    var count = Object.keys(this.players).length;
    if (count < this.meta.seekerCount + 1) {
      throw new Error('Need at least ' + (this.meta.seekerCount + 1) + ' players to start (1 Hider + ' + this.meta.seekerCount + ' Seeker(s)).');
    }
    this._assignRoles();
    await ZizoFirebase.db.ref('rooms/' + this.code + '/meta').update({
      phase: 'starting',
      phaseStartedAt: ZizoFirebase.serverTimestamp
    });
  };

  // Host-only "Play Again": returns the same room to the lobby phase so
  // the group can start a fresh round without re-sharing the room code.
  Room.prototype.resetToLobby = async function () {
    if (!this.isHost) return;
    var db = ZizoFirebase.db;
    var updates = {};
    Object.keys(this.players).forEach(function (id) {
      updates[id] = {
        role: 'lobby', alive: true, ready: false, pose: 'stand',
        repaintsUsed: 0, isRepainting: false
      };
    });
    await Promise.all(Object.keys(updates).map(function (id) {
      return db.ref('rooms/' + this.code + '/players/' + id).update(updates[id]);
    }, this));
    await db.ref('rooms/' + this.code + '/meta').update({
      phase: 'lobby',
      phaseStartedAt: ZizoFirebase.serverTimestamp,
      winnerRole: null
    });
  };

  Room.prototype._assignRoles = function () {
    var db = ZizoFirebase.db;
    var ids = Object.keys(this.players);
    var seekerCount = Math.max(1, Math.min(this.meta.seekerCount, ids.length - 1));

    // Deterministic-enough shuffle: only the host computes this, and it
    // writes the final result once — no risk of clients disagreeing.
    var shuffled = ids.slice().sort(function () { return Math.random() - 0.5; });
    var seekerIds = shuffled.slice(0, seekerCount);
    var stage = this.stage;
    var hiderSpawns = (stage && stage.hiderSpawns) || [[100, 400]];
    var seekerSpawns = (stage && stage.seekerSpawns) || [[480, 480]];

    var hiderIdx = 0;
    var updates = {};
    shuffled.forEach(function (id) {
      var isSeeker = seekerIds.indexOf(id) !== -1;
      var spawn = isSeeker
        ? seekerSpawns[0]
        : hiderSpawns[hiderIdx++ % hiderSpawns.length];
      updates[id] = {
        role: isSeeker ? 'seeker' : 'hider',
        alive: true,
        ready: false,
        pose: 'stand',
        x: spawn[0],
        y: spawn[1],
        repaintsUsed: 0,
        isRepainting: false
      };
    });
    Object.keys(updates).forEach(function (id) {
      db.ref('rooms/' + this.code + '/players/' + id).update(updates[id]);
    }, this);
  };

  Room.prototype._winnerRole = function () {
    var ids = Object.keys(this.players);
    var hiders = ids.filter(function (id) { return this.players[id].role === 'hider'; }, this);
    if (!hiders.length) return null;
    var allCaught = hiders.every(function (id) { return this.players[id].alive === false; }, this);
    return allCaught ? 'seekers' : null;
  };

  Room.prototype._startHostLoop = function () {
    var self = this;
    this._hostTimer = setInterval(function () { self._hostTick(); }, HOST_TICK_MS);
  };

  Room.prototype._hostTick = function () {
    if (!this.meta) return;
    var db = ZizoFirebase.db;
    var now = ZizoFirebase.serverNow();
    var metaRef = db.ref('rooms/' + this.code + '/meta');

    metaRef.child('hostHeartbeat').set(ZizoFirebase.serverTimestamp);

    var elapsed = (now - (this.meta.phaseStartedAt || now)) / 1000;
    var phase = this.meta.phase;

    if (phase === 'starting' && elapsed >= STARTING_COUNTDOWN_SEC) {
      metaRef.update({ phase: 'painting', phaseStartedAt: ZizoFirebase.serverTimestamp });
    } else if (phase === 'painting' && elapsed >= this.meta.paintDuration) {
      metaRef.update({ phase: 'seeking', phaseStartedAt: ZizoFirebase.serverTimestamp });
    } else if (phase === 'seeking') {
      var winner = this._winnerRole();
      if (winner) {
        metaRef.update({ phase: 'results', phaseStartedAt: ZizoFirebase.serverTimestamp, winnerRole: winner });
      } else if (elapsed >= this.meta.roundDuration) {
        metaRef.update({ phase: 'results', phaseStartedAt: ZizoFirebase.serverTimestamp, winnerRole: 'hiders' });
      }
    }

    if (this.meta.isPublic) {
      db.ref('publicRooms/' + this.code).update({
        playerCount: Object.keys(this.players).length,
        phase: this.meta.phase
      });
    }
  };

  // Best-effort host failover: every non-host client polls the heartbeat;
  // if it goes stale, whichever remaining player joined earliest promotes
  // itself. Not a strict consensus algorithm, but sufficient for small
  // casual rooms where the odds of a genuine tie are negligible.
  Room.prototype._watchHostFailover = function () {
    var self = this;
    this._watchdogTimer = setInterval(function () {
      if (self.isHost || !self.meta) return;
      var now = ZizoFirebase.serverNow();
      var stale = now - (self.meta.hostHeartbeat || 0) > HOST_HEARTBEAT_STALE_MS;
      if (!stale) return;

      var ids = Object.keys(self.players);
      if (!ids.length) return;
      var oldest = ids.reduce(function (a, b) {
        return (self.players[a].joinedAt || 0) <= (self.players[b].joinedAt || 0) ? a : b;
      });
      if (oldest === self.uid) {
        self.isHost = true;
        ZizoFirebase.db.ref('rooms/' + self.code + '/meta/hostId').set(self.uid);
        self._startHostLoop();
      }
    }, 2000);
  };

  global.ZizoRoom = {
    Room: Room,
    PHASES: PHASES,
    STARTING_COUNTDOWN_SEC: STARTING_COUNTDOWN_SEC,
    REPAINT_WINDOW_SEC: REPAINT_WINDOW_SEC
  };
})(window);
