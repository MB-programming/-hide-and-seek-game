/*
 * lobby.js — the pre-round lobby overlay: player list, ready check, and
 * (host-only) room settings. Purely reactive to room 'meta'/'players'
 * events; game-main.js decides when to show/hide this overlay based on
 * meta.phase.
 */
(function (global) {
  'use strict';

  var $ = ZizoUtils.qs;

  function initLobby(room, config) {
    var mapSelect = $('#lobby-map-select');
    (config.stages || []).forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.slug;
      opt.textContent = s.name;
      mapSelect.appendChild(opt);
    });

    var settingsPopulated = false;
    var hostInputs = {
      map: mapSelect,
      seekers: $('#lobby-seekers'),
      paintDuration: $('#lobby-paint-duration'),
      roundDuration: $('#lobby-round-duration'),
      repaintLimit: $('#lobby-repaint-limit')
    };

    function applyHostVisibility() {
      $('#lobby-host-settings').classList.toggle('hidden', !room.isHost);
      $('#btn-start-round').classList.toggle('hidden', !room.isHost);
      $('#lobby-waiting-msg').classList.toggle('hidden', room.isHost);
      Object.keys(hostInputs).forEach(function (k) {
        hostInputs[k].disabled = !room.isHost;
      });
    }

    room.on('meta', function (meta) {
      $('#lobby-room-code-display').textContent = meta.code;
      applyHostVisibility();
      // Only set input values once (or when not host) so we don't fight
      // the host's own in-progress edits with every realtime update.
      if (!settingsPopulated || !room.isHost) {
        mapSelect.value = meta.mapSlug;
        hostInputs.seekers.value = meta.seekerCount;
        hostInputs.paintDuration.value = meta.paintDuration;
        hostInputs.roundDuration.value = meta.roundDuration;
        hostInputs.repaintLimit.value = meta.repaintLimit;
        settingsPopulated = true;
      }
    });

    Object.keys(hostInputs).forEach(function (key) {
      hostInputs[key].addEventListener('change', function () {
        if (!room.isHost) return;
        room.updateSettings({
          mapSlug: mapSelect.value,
          seekerCount: parseInt(hostInputs.seekers.value, 10) || 1,
          paintDuration: parseInt(hostInputs.paintDuration.value, 10) || 60,
          roundDuration: parseInt(hostInputs.roundDuration.value, 10) || 180,
          repaintLimit: parseInt(hostInputs.repaintLimit.value, 10) || 0
        });
      });
    });

    var ready = false;
    $('#btn-ready').addEventListener('click', function () {
      ready = !ready;
      room.setReady(ready);
      $('#btn-ready').textContent = ready ? ZizoLang.t('not_ready') : ZizoLang.t('ready');
    });

    $('#btn-start-round').addEventListener('click', function () {
      room.startRound().catch(function (e) { alert(e.message); });
    });

    room.on('players', function (players) {
      var list = $('#lobby-player-list');
      list.innerHTML = '';
      Object.keys(players).forEach(function (id) {
        var p = players[id];
        var li = document.createElement('li');
        li.innerHTML = '<span>' + escapeHtml(p.nickname) + (id === room.uid ? ' (you)' : '') + '</span>' +
          '<span class="ready-badge">' + (p.ready ? '✓ ' + ZizoLang.t('ready') : '') + '</span>';
        list.appendChild(li);
      });
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.ZizoLobby = { init: initLobby };
})(window);
