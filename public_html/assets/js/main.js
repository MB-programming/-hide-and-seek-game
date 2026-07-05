/*
 * main.js — landing page (index.html): nickname entry, public room browser,
 * create/join flows. Hands off to game.html via sessionStorage + a ?code=
 * query param once a room is created/joined.
 */
(function () {
  'use strict';

  var $ = ZizoUtils.qs;
  var nicknameInput = $('#nickname');
  var unsubscribeRooms = null;
  var pendingMode = null; // 'public' | 'private'

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, 3200);
  }

  function getNickname() {
    return ZizoUtils.sanitizeNickname(nicknameInput.value || localStorage.getItem('zizo_nickname'));
  }

  function init() {
    ZizoLang.apply();
    nicknameInput.value = localStorage.getItem('zizo_nickname') || '';
    nicknameInput.addEventListener('input', function () {
      localStorage.setItem('zizo_nickname', nicknameInput.value);
    });

    $('#btn-lang').addEventListener('click', function () {
      ZizoLang.setLang(ZizoLang.getLang() === 'ar' ? 'en' : 'ar');
    });

    $('#btn-refresh-rooms').addEventListener('click', subscribeRoomList);
    $('#btn-create-public').addEventListener('click', function () { openCreateModal('public'); });
    $('#btn-create-private').addEventListener('click', function () { openCreateModal('private'); });
    $('#btn-create-cancel').addEventListener('click', closeCreateModal);
    $('#btn-create-confirm').addEventListener('click', onCreateConfirm);
    $('#btn-join-code').addEventListener('click', onJoinCode);

    populateMapSelect();
    subscribeRoomList();
  }

  async function populateMapSelect() {
    var cfg = await ZizoConfig.loadGameConfig();
    var select = $('#create-map-select');
    (cfg.stages || []).forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.slug;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
    var settings = cfg.settings || {};
    if (settings.default_seeker_count) $('#create-seekers').value = settings.default_seeker_count;
    if (settings.default_paint_duration_sec) $('#create-paint-duration').value = settings.default_paint_duration_sec;
    if (settings.default_round_duration_sec) $('#create-round-duration').value = settings.default_round_duration_sec;
    if (settings.default_repaint_limit) $('#create-repaint-limit').value = settings.default_repaint_limit;
  }

  function subscribeRoomList() {
    if (unsubscribeRooms) unsubscribeRooms();
    unsubscribeRooms = ZizoMatchmaking.listPublicRooms(renderRoomList);
  }

  function renderRoomList(rooms) {
    var list = $('#room-list');
    var empty = $('#room-list-empty');
    list.innerHTML = '';
    if (!rooms.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    rooms.forEach(function (r) {
      var li = document.createElement('li');
      li.innerHTML =
        '<span><span class="room-name">' + escapeHtml(r.name) + '</span><br>' +
        '<span class="room-meta">' + escapeHtml(r.mapSlug) + ' &middot; ' + r.playerCount + '/' + r.maxPlayers + '</span></span>' +
        '<span class="btn btn-secondary btn-small">' + ZizoLang.t('join') + '</span>';
      li.addEventListener('click', function () { joinRoom(r.code); });
      list.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function openCreateModal(mode) {
    pendingMode = mode;
    $('#create-room-title').textContent = mode === 'public' ? ZizoLang.t('create_public') : ZizoLang.t('create_private');
    $('#create-room-modal').classList.remove('hidden');
  }
  function closeCreateModal() {
    $('#create-room-modal').classList.add('hidden');
  }

  // IMPORTANT: room creation itself happens on game.html, not here.
  // room.create() kicks off room.js's polling loop (setTimeout chain) for
  // this room, which would be destroyed instantly by the page navigation
  // to game.html if we called it on this page. So all this page does is
  // stash the chosen options and hand off via a query param + sessionStorage.
  async function onCreateConfirm() {
    var cfg = await ZizoConfig.loadGameConfig(); // cached — cheap, just reads admin-configured defaults
    var settings = cfg.settings || {};
    var nickname = getNickname();
    var opts = {
      isPublic: pendingMode === 'public',
      name: nickname + (pendingMode === 'public' ? "'s room" : "'s private room"),
      nickname: nickname,
      mapSlug: $('#create-map-select').value,
      // Clamped to 2-10 (matches the "2-10 players per room" spec) — also
      // enforced server-side in api/game.php's clampInt(), this just avoids
      // sending an obviously-invalid value in the first place.
      maxPlayers: ZizoUtils.clamp(parseInt(settings.max_players_per_room, 10) || 10, 2, 10),
      seekerCount: parseInt($('#create-seekers').value, 10) || 1,
      paintDuration: parseInt($('#create-paint-duration').value, 10) || 60,
      roundDuration: parseInt($('#create-round-duration').value, 10) || 180,
      repaintLimit: parseInt($('#create-repaint-limit').value, 10) || 0,
      wrongCatchPenaltySec: parseInt(settings.wrong_catch_penalty_sec, 10) || 3
    };
    sessionStorage.setItem('zizo_pending_create', JSON.stringify(opts));
    location.href = 'game.html?action=create';
  }

  function onJoinCode() {
    joinRoom($('#join-code-input').value);
  }

  function joinRoom(code) {
    if (!code) { toast('Enter a room code.'); return; }
    sessionStorage.setItem('zizo_join_nickname', getNickname());
    location.href = 'game.html?action=join&code=' + encodeURIComponent(code.toUpperCase().trim());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
