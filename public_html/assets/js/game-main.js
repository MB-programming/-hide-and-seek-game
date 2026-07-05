/*
 * game-main.js — orchestrates a single game.html session: joining/creating
 * the room, the render/movement loop, phase-driven overlay switching, the
 * painting toolbar, and catch input. This is the file that ties together
 * room.js (network state), player.js (rendering), paint.js (brush engine),
 * input.js (controls) and stages.js (background) into one running game.
 */
(function () {
  'use strict';

  var $ = ZizoUtils.qs;
  var MOVE_SPEED = 160; // world px/sec

  var room = new ZizoRoom.Room();
  var config = null;
  var stage = null;
  var stageBg = null; // offscreen canvas with the rendered background (see stages.js)
  var stageCanvas = $('#stage-canvas');
  var stageCtx = stageCanvas.getContext('2d');

  var playerEntities = {}; // id -> ZizoPlayer.Player
  var localPos = { x: 0, y: 0 };
  var localPose = 'stand';
  var lastFrameTime = null;
  var keyboard = new ZizoInput.KeyboardMovement();
  var joystick = null;
  var paintEngine = null;
  var eyedropperArmed = false;
  var lastPhase = null;
  var currentMapSlug = null;
  var lastKnownRole = null;

  async function main() {
    ZizoLang.apply();
    config = await ZizoConfig.loadGameConfig();
    await ZizoAudio.loadConfig();

    var params = new URLSearchParams(location.search);
    var action = params.get('action');
    var code = params.get('code');
    var spectateParam = params.get('spectate') === '1';

    try {
      if (spectateParam && code) {
        await room.spectate(code);
      } else if (action === 'create') {
        var pending = JSON.parse(sessionStorage.getItem('zizo_pending_create') || 'null');
        if (!pending) throw new Error('No room settings found.');
        sessionStorage.removeItem('zizo_pending_create');
        await room.create(pending);
      } else if (code) {
        var nickname = sessionStorage.getItem('zizo_join_nickname') || 'Player';
        await room.join(code, nickname);
      } else {
        throw new Error('No room specified.');
      }
    } catch (e) {
      alert(e.message || String(e));
      location.href = 'index.html';
      return;
    }

    ZizoLobby.init(room, config);
    ZizoSeeker.init(room);
    wireHud();
    wirePaintToolbar();
    setupJoystickIfTouch();
    bindStageClicks();

    room.on('meta', onMeta);
    room.on('players', onPlayersSnapshot);
    room.on('event', onRoomEvent);

    requestAnimationFrame(loop);
  }

  // ---- stage loading ------------------------------------------------

  async function loadStageIfNeeded(mapSlug) {
    if (mapSlug === currentMapSlug) return;
    currentMapSlug = mapSlug;
    stage = await ZizoStages.loadStage(mapSlug);
    room.stage = stage;
    stageCanvas.width = stage.width;
    stageCanvas.height = stage.height;
    stageBg = ZizoStages.renderBackground(stage, stageCtx);
    ZizoAudio.playAmbient(mapSlug);
  }

  // ---- HUD / overlays -------------------------------------------------

  function wireHud() {
    $('#btn-leave').addEventListener('click', function () {
      room.leave();
      location.href = 'index.html';
    });
    $('#btn-spectate-toggle').addEventListener('click', function () {
      ZizoSpectator.toggle();
    });
    $('#btn-play-again').addEventListener('click', function () {
      room.resetToLobby();
    });
    $('#btn-reposition').addEventListener('click', function () {
      if (room.requestRepaint()) {
        showToolbar(true);
      }
    });
  }

  var OVERLAYS = ['overlay-lobby', 'overlay-starting', 'overlay-seeker-waiting', 'overlay-results'];
  function showOverlay(id) {
    OVERLAYS.forEach(function (o) { $('#' + o).classList.toggle('hidden', o !== id); });
  }

  function onMeta(meta) {
    loadStageIfNeeded(meta.mapSlug);

    var me = room.players[room.uid];
    var myRole = me ? me.role : 'lobby';

    $('#hud-role-badge').textContent = myRole === 'hider' ? ZizoLang.t('role_hider')
      : myRole === 'seeker' ? ZizoLang.t('role_seeker') : '';
    $('#hud-role-badge').className = 'pill role-badge role-' + myRole;
    $('#hud-room-code').textContent = meta.code;

    if (meta.phase !== lastPhase) onPhaseChange(lastPhase, meta.phase, myRole, meta);
    lastPhase = meta.phase;

    switch (meta.phase) {
      case 'lobby':
        showOverlay('overlay-lobby');
        showToolbar(false);
        $('#btn-reposition').classList.add('hidden');
        break;
      case 'starting':
        showOverlay('overlay-starting');
        $('#starting-role-label').textContent = myRole === 'hider'
          ? 'You are a ' + ZizoLang.t('role_hider') + '! Find a spot and blend in.'
          : myRole === 'seeker' ? 'You are a ' + ZizoLang.t('role_seeker') + '! Get ready to hunt.'
          : 'Spectating this round.';
        break;
      case 'painting':
        OVERLAYS.forEach(function (o) { $('#' + o).classList.add('hidden'); });
        if (myRole === 'seeker') showOverlay('overlay-seeker-waiting');
        else if (myRole === 'hider') showToolbar(true);
        break;
      case 'seeking':
        OVERLAYS.forEach(function (o) { $('#' + o).classList.add('hidden'); });
        if (myRole === 'hider' && me.alive) {
          // NOTE: this case re-runs on every meta tick (host heartbeat etc,
          // ~2x/sec), so the toolbar's visibility here must reflect
          // me.isRepainting rather than unconditionally hiding it — a
          // player mid-repaint-window must not have their toolbar slammed
          // shut by the next routine tick.
          showToolbar(!!me.isRepainting);
          var used = me.repaintsUsed || 0;
          var limit = meta.repaintLimit || 0;
          var btn = $('#btn-reposition');
          btn.classList.toggle('hidden', used >= limit || me.isRepainting);
          btn.textContent = ZizoLang.t('role_hider') + ': ' + (limit - used) + ' ↻';
        } else {
          showToolbar(false);
          $('#btn-reposition').classList.add('hidden');
        }
        break;
      case 'results':
        showOverlay('overlay-results');
        $('#btn-reposition').classList.add('hidden');
        showToolbar(false);
        renderResults(meta, myRole);
        break;
    }
  }

  var roundStartedAt = null;

  function onPhaseChange(from, to, myRole, meta) {
    if (to === 'starting') {
      ZizoAudio.play('round_start', currentMapSlug);
      roundStartedAt = meta.phaseStartedAt; // for session-log duration, not room creation time
    }
    if (from === 'painting' && to === 'seeking') {
      ZizoAudio.play('painting_end', currentMapSlug);
      ZizoAudio.play('seeker_released', currentMapSlug);
      // Auto-save whatever the local Hider painted in case they never hit Confirm.
      if (paintEngine && myRole === 'hider') room.syncPaintCheckpoint(paintEngine.exportCompressed());
    }
    if (to === 'results') {
      ZizoAudio.play('round_over', currentMapSlug);
      var won = (meta.winnerRole === 'hiders' && myRole === 'hider') ||
                (meta.winnerRole === 'seekers' && myRole === 'seeker');
      ZizoAudio.play(won ? 'victory' : 'defeat', currentMapSlug);
      // Only the host logs the round summary, so a room of N players
      // doesn't write N duplicate rows to session_logs.
      if (room.isHost) logSessionToServer(meta);
    }
  }

  function logSessionToServer(meta) {
    var ids = Object.keys(room.players);
    var hiders = ids.filter(function (id) { return room.players[id].role === 'hider'; });
    var seekers = ids.filter(function (id) { return room.players[id].role === 'seeker'; });
    var caught = hiders.filter(function (id) { return room.players[id].alive === false; });
    fetch('api/log-session.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_code: meta.code,
        is_public: !!meta.isPublic,
        map_slug: meta.mapSlug,
        player_count: ids.length,
        seeker_count: seekers.length,
        hider_count: hiders.length,
        caught_count: caught.length,
        winner_role: meta.winnerRole || null,
        started_at: roundStartedAt || meta.createdAt,
        ended_at: ZizoFirebase.serverNow()
      })
    }).catch(function () { /* best-effort logging only */ });
  }

  function renderResults(meta, myRole) {
    var title = meta.winnerRole === 'hiders' ? '🏆 Hiders win!' : meta.winnerRole === 'seekers' ? '🏆 Seekers win!' : 'Round over';
    $('#results-title').textContent = title;
    var list = $('#results-list');
    list.innerHTML = '';
    Object.keys(room.players).forEach(function (id) {
      var p = room.players[id];
      if (p.role !== 'hider' && p.role !== 'seeker') return;
      var li = document.createElement('li');
      var status = p.role === 'hider' ? (p.alive ? '🙈 escaped' : '❌ caught') : '🔎 seeker';
      li.innerHTML = '<span>' + escapeHtml(p.nickname) + '</span><span class="role-tag">' + status + '</span>';
      list.appendChild(li);
    });
    $('#btn-play-again').classList.toggle('hidden', !room.isHost);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function onPlayersSnapshot(players) {
    Object.keys(players).forEach(function (id) {
      if (playerEntities[id]) playerEntities[id].update(players[id]);
      else playerEntities[id] = new ZizoPlayer.Player(id, players[id]);
    });
    Object.keys(playerEntities).forEach(function (id) {
      if (!players[id]) delete playerEntities[id];
    });
    // Whenever the server assigns a new role (round start, or a "Play
    // Again" reset), it also writes a fresh spawn x/y — resync our local,
    // optimistically-moved position to that authoritative value so we
    // don't keep rendering ourselves at a stale spot from the previous
    // phase. Outside of that moment, local movement stays authoritative
    // between throttled network writes (see updateMovement/room.js).
    var me = players[room.uid];
    if (me && me.role !== lastKnownRole) {
      localPos.x = me.x;
      localPos.y = me.y;
      lastKnownRole = me.role;
    }
  }

  function onRoomEvent(evt) {
    if (evt.type === 'catch') {
      ZizoAudio.play('catch', currentMapSlug);
      flashCatch();
    }
  }

  function flashCatch() {
    var el = $('#catch-flash');
    el.classList.remove('hidden');
    clearTimeout(flashCatch._t);
    flashCatch._t = setTimeout(function () { el.classList.add('hidden'); }, 400);
  }

  // ---- painting toolbar -------------------------------------------------

  function wirePaintToolbar() {
    paintEngine = new ZizoPaint.PaintEngine($('#paint-canvas'));
    ZizoInput.bindPaintPointer($('#paint-canvas'), paintEngine);

    $('#brush-color').addEventListener('input', function (e) { paintEngine.setColor(e.target.value); });
    $('#brush-size').addEventListener('input', function (e) { paintEngine.setBrushSize(parseInt(e.target.value, 10)); });
    $('#btn-undo').addEventListener('click', function () { paintEngine.undo(); });
    $('#btn-redo').addEventListener('click', function () { paintEngine.redo(); });
    $('#btn-clear').addEventListener('click', function () { paintEngine.clear(); });
    $('#btn-eyedropper').addEventListener('click', function () {
      eyedropperArmed = !eyedropperArmed;
      $('#btn-eyedropper').classList.toggle('active', eyedropperArmed);
    });
    ZizoUtils.qsa('.pose-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pose = btn.getAttribute('data-pose');
        localPose = pose;
        paintEngine.setPose(pose);
        room.setPose(pose);
        ZizoUtils.qsa('.pose-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      });
    });
    $('#btn-confirm-paint').addEventListener('click', function () {
      room.syncPaintCheckpoint(paintEngine.exportCompressed());
      var me = room.players[room.uid];
      if (me && me.isRepainting) {
        room.endRepaintWindow();
        showToolbar(false);
      }
    });
  }

  function showToolbar(show) {
    $('#paint-toolbar').classList.toggle('hidden', !show);
  }

  // ---- stage clicks: eyedropper sampling + seeker catch attempts --------

  function bindStageClicks() {
    ZizoInput.bindStagePick(stageCanvas, function (x, y) {
      if (eyedropperArmed) {
        if (stageBg) {
          var color = ZizoStages.sampleColor(stageBg, x, y);
          paintEngine.setColor(color);
          $('#brush-color').value = rgbToHex(color);
        }
        eyedropperArmed = false;
        $('#btn-eyedropper').classList.remove('active');
        return;
      }
      var me = room.players[room.uid];
      if (!me || me.role !== 'seeker' || !room.meta || room.meta.phase !== 'seeking') return;
      ZizoSeeker.attemptCatchAt(room, playerEntities, x, y, room.meta.wrongCatchPenaltySec);
    });
  }

  function rgbToHex(rgb) {
    var m = /rgb\((\d+),(\d+),(\d+)\)/.exec(rgb);
    if (!m) return '#ffffff';
    return '#' + [m[1], m[2], m[3]].map(function (v) {
      return ('0' + parseInt(v, 10).toString(16)).slice(-2);
    }).join('');
  }

  // ---- touch joystick ---------------------------------------------------

  function setupJoystickIfTouch() {
    if (!('ontouchstart' in window)) return;
    $('#joystick-base').classList.remove('hidden');
    joystick = new ZizoInput.VirtualJoystick($('#joystick-base'), $('#joystick-knob'));
  }

  // ---- movement + render loop -------------------------------------------

  function canMove() {
    var me = room.players[room.uid];
    if (!me || !room.meta || me.alive === false) return false;
    if (me.role === 'hider') {
      return room.meta.phase === 'painting' || (room.meta.phase === 'seeking' && me.isRepainting);
    }
    if (me.role === 'seeker') {
      return room.meta.phase === 'seeking';
    }
    return false;
  }

  function updateMovement(dt) {
    if (!stage || !canMove()) return;
    var v = keyboard.getVector();
    if (joystick) {
      var jv = joystick.getVector();
      if (Math.abs(jv.x) > 0.15 || Math.abs(jv.y) > 0.15) v = jv;
    }
    if (v.x === 0 && v.y === 0) return;

    var b = stage.bounds;
    localPos.x = ZizoUtils.clamp(localPos.x + v.x * MOVE_SPEED * dt, b.x, b.x + b.w);
    localPos.y = ZizoUtils.clamp(localPos.y + v.y * MOVE_SPEED * dt, b.y, b.y + b.h);
    room.updateTransform(localPos.x, localPos.y, localPose);

    var mine = playerEntities[room.uid];
    if (mine) { mine.x = localPos.x; mine.y = localPos.y; }
  }

  function checkRepaintWindowExpiry() {
    var me = room.players[room.uid];
    if (me && me.isRepainting && me.repaintWindowEndsAt && ZizoFirebase.serverNow() >= me.repaintWindowEndsAt) {
      room.endRepaintWindow();
      room.syncPaintCheckpoint(paintEngine.exportCompressed());
      showToolbar(false);
    }
  }

  function updateTimerHud() {
    if (!room.meta) return;
    var phase = room.meta.phase;
    var durations = { starting: ZizoRoom.STARTING_COUNTDOWN_SEC, painting: room.meta.paintDuration, seeking: room.meta.roundDuration };
    var label = { lobby: '', starting: 'Get Ready', painting: 'Painting', seeking: 'Seeking', results: 'Results' };
    $('#hud-phase-label').textContent = label[phase] || '';
    if (!durations[phase]) { $('#hud-timer').textContent = ''; return; }
    var elapsed = (ZizoFirebase.serverNow() - room.meta.phaseStartedAt) / 1000;
    var remaining = Math.max(0, Math.ceil(durations[phase] - elapsed));
    var mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    var ss = String(remaining % 60).padStart(2, '0');
    $('#hud-timer').textContent = mm + ':' + ss;
    if (phase === 'starting') $('#starting-count').textContent = remaining;
    if (phase === 'painting') $('#seeker-wait-timer').textContent = mm + ':' + ss;
  }

  function render() {
    if (!stageBg) return;
    stageCtx.clearRect(0, 0, stageCanvas.width, stageCanvas.height);
    stageCtx.drawImage(stageBg, 0, 0);

    var order = Object.keys(playerEntities).sort(function (a, b) {
      return playerEntities[a].y - playerEntities[b].y;
    });
    order.forEach(function (id) {
      var p = playerEntities[id];
      if (p.role !== 'hider' && p.role !== 'seeker') return;
      p.draw(stageCtx, { showLabel: id === room.uid });
    });
  }

  function loop(t) {
    if (lastFrameTime === null) lastFrameTime = t;
    var dt = Math.min(0.1, (t - lastFrameTime) / 1000);
    lastFrameTime = t;

    updateMovement(dt);
    checkRepaintWindowExpiry();
    updateTimerHud();
    render();

    requestAnimationFrame(loop);
  }

  document.addEventListener('DOMContentLoaded', main);
})();
