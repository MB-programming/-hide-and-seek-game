<?php
/**
 * api/game.php — the ENTIRE multiplayer backend, plain PHP + MySQL, polled
 * by every client instead of a realtime push connection. There is no
 * persistent server process here (works on ordinary shared hosting): each
 * client calls action=get_state repeatedly (see room.js), and that same
 * call also runs the server-authoritative phase clock (tick_room() below)
 * so ANY client's poll can safely advance a room from lobby -> starting ->
 * painting -> seeking -> results. MySQL's atomic conditional UPDATE ... WHERE
 * statements (not read-then-write) make it safe for many clients to poll
 * concurrently without double-processing a transition — see tick_room().
 *
 * Every request is POST with a JSON body: {"action": "...", ...params}.
 * Response is always JSON: {"ok": true, ...} or {"ok": false, "error": "..."}.
 *
 * Auth model: there's no login system — a room's players are identified by
 * a public `player_id` (safe to show to other clients, e.g. as a catch
 * target) plus a secret `token` proving a request really came from that
 * player's own browser tab (returned once at create/join time, then kept in
 * sessionStorage by the client — see room.js). This is the same trust level
 * the project's earlier Firebase-based design used (see git history / the
 * README's Security notes): good enough for a casual party game, not a
 * hardened anti-cheat system.
 */

require_once __DIR__ . '/../admin/includes/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const STARTING_COUNTDOWN_SEC = 3;
const REPAINT_WINDOW_SEC = 12;
const STALE_PLAYER_SEC = 20; // no heartbeat for this long = treated as disconnected
const MAX_PAINT_CHARS = 60000;
const VALID_POSES = ['stand', 'crouch', 'lean', 'surrender', 'sit', 'prone'];

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------

function json_out($data) {
    echo json_encode($data);
    exit;
}
function json_err($message, $httpCode = 400) {
    http_response_code($httpCode);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}
function rand_token($bytes = 32) { return bin2hex(random_bytes($bytes)); }

function sanitize_nickname($s) {
    $s = trim((string) $s);
    if ($s === '') return 'Player';
    // mb_substr keeps this safe for Arabic/multi-byte nicknames.
    return mb_substr($s, 0, 20);
}

function random_room_code($pdo, $len = 6) {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
    for ($attempt = 0; $attempt < 8; $attempt++) {
        $code = '';
        for ($i = 0; $i < $len; $i++) $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        $stmt = $pdo->prepare('SELECT 1 FROM rooms WHERE code = ?');
        $stmt->execute([$code]);
        if (!$stmt->fetch()) return $code;
    }
    throw new Exception('Could not allocate a room code, please try again.');
}

function clampInt($v, $min, $max, $default) {
    $v = (int) $v;
    if ($v < $min || $v > $max) return $default;
    return $v;
}

// Verifies (room_code, player_id, token) match a real row and returns it,
// or fails the whole request with a 403. Used by every mutating action.
function require_player($pdo, $code, $playerId, $token) {
    $stmt = $pdo->prepare('SELECT * FROM room_players WHERE room_code = ? AND player_id = ? LIMIT 1');
    $stmt->execute([$code, $playerId]);
    $row = $stmt->fetch();
    if (!$row || !hash_equals($row['token'], (string) $token)) {
        json_err('Not authorized for this player.', 403);
    }
    return $row;
}

function require_room($pdo, $code) {
    // phase_started_ms is computed here (not in a separate query from
    // public_meta) since get_state is polled very frequently by every
    // client — worth avoiding an extra round-trip per poll on shared hosting.
    $stmt = $pdo->prepare('SELECT *, UNIX_TIMESTAMP(phase_started_at) * 1000 AS phase_started_ms FROM rooms WHERE code = ? LIMIT 1');
    $stmt->execute([$code]);
    $row = $stmt->fetch();
    if (!$row) json_err('Room not found.', 404);
    return $row;
}

// ---------------------------------------------------------------------
// server-authoritative phase clock — see file header. Pure conditional
// UPDATEs (never read-then-write), so concurrent polls from different
// clients can't double-advance the same transition.
// ---------------------------------------------------------------------
function tick_room($pdo, $code) {
    $pdo->prepare('DELETE FROM room_players WHERE room_code = ? AND last_seen < (NOW(3) - INTERVAL ' . STALE_PLAYER_SEC . ' SECOND)')
        ->execute([$code]);

    $pdo->prepare("
        UPDATE rooms SET phase = 'painting', phase_started_at = NOW(3)
        WHERE code = ? AND phase = 'starting'
          AND phase_started_at <= NOW(3) - INTERVAL " . STARTING_COUNTDOWN_SEC . ' SECOND
    ')->execute([$code]);

    $pdo->prepare("
        UPDATE rooms SET phase = 'seeking', phase_started_at = NOW(3)
        WHERE code = ? AND phase = 'painting'
          AND phase_started_at <= NOW(3) - INTERVAL paint_duration SECOND
    ")->execute([$code]);

    // Seekers win: at least one hider exists and none are still alive.
    $pdo->prepare("
        UPDATE rooms r SET phase = 'results', phase_started_at = NOW(3), winner_role = 'seekers'
        WHERE r.code = ? AND r.phase = 'seeking'
          AND EXISTS (SELECT 1 FROM room_players p WHERE p.room_code = r.code AND p.role = 'hider')
          AND NOT EXISTS (SELECT 1 FROM room_players p WHERE p.room_code = r.code AND p.role = 'hider' AND p.alive = 1)
    ")->execute([$code]);

    // Hiders win: round timer ran out first (only fires if the above didn't
    // already flip phase to 'results', since this WHERE also requires
    // phase='seeking').
    $pdo->prepare("
        UPDATE rooms SET phase = 'results', phase_started_at = NOW(3), winner_role = 'hiders'
        WHERE code = ? AND phase = 'seeking'
          AND phase_started_at <= NOW(3) - INTERVAL round_duration SECOND
    ")->execute([$code]);
}

// Shapes a DB row into the exact camelCase JSON shape the frontend expects
// (kept identical to this project's earlier Firebase Realtime Database
// snapshot shape, so room.js/lobby.js/game-main.js/player.js needed no
// field-name changes when the transport moved from Firebase to plain
// PHP+MySQL polling).
function public_meta($room) {
    return [
        'code' => $room['code'],
        'isPublic' => (bool) $room['is_public'],
        'name' => $room['name'],
        'mapSlug' => $room['map_slug'],
        'maxPlayers' => (int) $room['max_players'],
        'seekerCount' => (int) $room['seeker_count'],
        'paintDuration' => (int) $room['paint_duration'],
        'roundDuration' => (int) $room['round_duration'],
        'repaintLimit' => (int) $room['repaint_limit'],
        'wrongCatchPenaltySec' => (int) $room['wrong_catch_penalty_sec'],
        'phase' => $room['phase'],
        'phaseStartedAt' => round((float) $room['phase_started_ms']),
        'winnerRole' => $room['winner_role'],
        'createdBy' => $room['created_by'],
    ];
}

function public_player($row) {
    $out = [
        'nickname' => $row['nickname'],
        'role' => $row['role'],
        'ready' => (bool) $row['ready'],
        'alive' => (bool) $row['alive'],
        'pose' => $row['pose'],
        'x' => (float) $row['x'],
        'y' => (float) $row['y'],
        'repaintsUsed' => (int) $row['repaints_used'],
        'isRepainting' => (bool) $row['is_repainting'],
    ];
    // repaint_ends_ms is only present when the caller's SELECT computed it
    // (action_get_state) — see UNIX_TIMESTAMP(repaint_window_ends_at) there.
    if ($row['repaint_window_ends_at'] !== null && isset($row['repaint_ends_ms'])) {
        $out['repaintWindowEndsAt'] = round((float) $row['repaint_ends_ms']);
    }
    if ($row['paint_rev'] > 0) {
        $out['paint'] = ['data' => $row['paint_data'], 'rev' => (int) $row['paint_rev']];
    }
    return $out;
}

// ---------------------------------------------------------------------
// action handlers
// ---------------------------------------------------------------------

function action_create_room($pdo, $in) {
    $code = random_room_code($pdo);
    $playerId = rand_token(12);
    $token = rand_token(32);

    $isPublic = !empty($in['isPublic']) ? 1 : 0;
    $maxPlayers = clampInt($in['maxPlayers'] ?? 10, 2, 10, 10);
    $seekerCount = clampInt($in['seekerCount'] ?? 1, 1, 5, 1);
    $paintDuration = clampInt($in['paintDuration'] ?? 60, 10, 600, 60);
    $roundDuration = clampInt($in['roundDuration'] ?? 180, 30, 1800, 180);
    // Capped at 250 (not a true "unlimited" flag) so the value still fits
    // the room_players.repaints_used TINYINT UNSIGNED column without a DB
    // migration — 250 repaints in one round is effectively unlimited for
    // any realistic match length anyway.
    $repaintLimit = clampInt($in['repaintLimit'] ?? 2, 0, 250, 2);
    $wrongCatchPenaltySec = clampInt($in['wrongCatchPenaltySec'] ?? 3, 1, 30, 3);
    $name = mb_substr(trim((string) ($in['name'] ?? ($code . "'s room"))), 0, 60);
    $mapSlug = mb_substr(trim((string) ($in['mapSlug'] ?? '')), 0, 50);

    $pdo->prepare('
        INSERT INTO rooms (code, is_public, name, map_slug, max_players, seeker_count, paint_duration, round_duration, repaint_limit, wrong_catch_penalty_sec, phase, phase_started_at, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?, \'lobby\', NOW(3), ?)
    ')->execute([$code, $isPublic, $name, $mapSlug, $maxPlayers, $seekerCount, $paintDuration, $roundDuration, $repaintLimit, $wrongCatchPenaltySec, $playerId]);

    $pdo->prepare('
        INSERT INTO room_players (room_code, player_id, token, nickname, role, x, y, last_seen, joined_at)
        VALUES (?,?,?,?,\'lobby\',0,0,NOW(3),NOW(3))
    ')->execute([$code, $playerId, $token, sanitize_nickname($in['nickname'] ?? '')]);

    json_out(['ok' => true, 'code' => $code, 'playerId' => $playerId, 'token' => $token, 'isCreator' => true]);
}

function action_join_room($pdo, $in) {
    $code = strtoupper(trim((string) ($in['code'] ?? '')));
    $room = require_room($pdo, $code);
    if ($room['phase'] !== 'lobby') json_err('Round already in progress.', 409);

    $stmt = $pdo->prepare('SELECT COUNT(*) FROM room_players WHERE room_code = ?');
    $stmt->execute([$code]);
    if ((int) $stmt->fetchColumn() >= (int) $room['max_players']) json_err('Room is full.', 409);

    $playerId = rand_token(12);
    $token = rand_token(32);
    $pdo->prepare('
        INSERT INTO room_players (room_code, player_id, token, nickname, role, x, y, last_seen, joined_at)
        VALUES (?,?,?,?,\'lobby\',0,0,NOW(3),NOW(3))
    ')->execute([$code, $playerId, $token, sanitize_nickname($in['nickname'] ?? '')]);

    json_out(['ok' => true, 'code' => $code, 'playerId' => $playerId, 'token' => $token, 'isCreator' => ($room['created_by'] === $playerId)]);
}

function action_spectate_room($pdo, $in) {
    $code = strtoupper(trim((string) ($in['code'] ?? '')));
    require_room($pdo, $code);
    json_out(['ok' => true, 'code' => $code]);
}

function action_leave_room($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $pdo->prepare('DELETE FROM room_players WHERE room_code = ? AND player_id = ?')->execute([$in['code'], $p['player_id']]);
    json_out(['ok' => true]);
}

function action_set_ready($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $pdo->prepare('UPDATE room_players SET ready = ? WHERE room_code = ? AND player_id = ?')
        ->execute([!empty($in['ready']) ? 1 : 0, $in['code'], $p['player_id']]);
    json_out(['ok' => true]);
}

function action_update_settings($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $room = require_room($pdo, $in['code']);
    if ($room['created_by'] !== $p['player_id'] || $room['phase'] !== 'lobby') json_err('Not allowed.', 403);

    $mapSlug = mb_substr(trim((string) ($in['mapSlug'] ?? $room['map_slug'])), 0, 50);
    $seekerCount = clampInt($in['seekerCount'] ?? $room['seeker_count'], 1, 5, $room['seeker_count']);
    $paintDuration = clampInt($in['paintDuration'] ?? $room['paint_duration'], 10, 600, $room['paint_duration']);
    $roundDuration = clampInt($in['roundDuration'] ?? $room['round_duration'], 30, 1800, $room['round_duration']);
    $repaintLimit = clampInt($in['repaintLimit'] ?? $room['repaint_limit'], 0, 250, $room['repaint_limit']);

    $pdo->prepare('UPDATE rooms SET map_slug=?, seeker_count=?, paint_duration=?, round_duration=?, repaint_limit=? WHERE code=?')
        ->execute([$mapSlug, $seekerCount, $paintDuration, $roundDuration, $repaintLimit, $in['code']]);
    json_out(['ok' => true]);
}

function action_start_round($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $room = require_room($pdo, $in['code']);
    if ($room['created_by'] !== $p['player_id']) json_err('Only the host can start the round.', 403);
    if ($room['phase'] !== 'lobby') json_err('Round already started.', 409);

    $stmt = $pdo->prepare('SELECT player_id FROM room_players WHERE room_code = ?');
    $stmt->execute([$in['code']]);
    $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $seekerCount = min((int) $room['seeker_count'], max(1, count($ids) - 1));
    if (count($ids) < $seekerCount + 1) {
        json_err('Need at least ' . ($seekerCount + 1) . ' players to start.', 409);
    }

    // Look up this stage's spawn points from the stages table (same MySQL
    // instance, no separate service to call).
    $stageStmt = $pdo->prepare('SELECT config_json FROM stages WHERE slug = ? LIMIT 1');
    $stageStmt->execute([$room['map_slug']]);
    $stageCfg = json_decode((string) $stageStmt->fetchColumn(), true) ?: [];
    $hiderSpawns = !empty($stageCfg['hiderSpawns']) ? $stageCfg['hiderSpawns'] : [[100, 400]];
    $seekerSpawns = !empty($stageCfg['seekerSpawns']) ? $stageCfg['seekerSpawns'] : [[480, 480]];

    shuffle($ids);
    $seekerIds = array_slice($ids, 0, $seekerCount);
    $hiderIdx = 0;

    $update = $pdo->prepare('
        UPDATE room_players SET role=?, alive=1, ready=0, pose=\'stand\', x=?, y=?, repaints_used=0, is_repainting=0
        WHERE room_code = ? AND player_id = ?
    ');
    foreach ($ids as $id) {
        $isSeeker = in_array($id, $seekerIds, true);
        if ($isSeeker) {
            $spawn = $seekerSpawns[0];
        } else {
            $spawn = $hiderSpawns[$hiderIdx % count($hiderSpawns)];
            $hiderIdx++;
        }
        $update->execute([$isSeeker ? 'seeker' : 'hider', $spawn[0], $spawn[1], $in['code'], $id]);
    }

    $pdo->prepare("UPDATE rooms SET phase='starting', phase_started_at=NOW(3), winner_role=NULL WHERE code=?")
        ->execute([$in['code']]);

    json_out(['ok' => true]);
}

function action_update_transform($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $pose = in_array($in['pose'] ?? 'stand', VALID_POSES, true) ? $in['pose'] : 'stand';
    $pdo->prepare('UPDATE room_players SET x=?, y=?, pose=? WHERE room_code=? AND player_id=?')
        ->execute([(float) ($in['x'] ?? 0), (float) ($in['y'] ?? 0), $pose, $in['code'], $p['player_id']]);
    json_out(['ok' => true]);
}

function action_set_pose($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $pose = in_array($in['pose'] ?? 'stand', VALID_POSES, true) ? $in['pose'] : 'stand';
    $pdo->prepare('UPDATE room_players SET pose=? WHERE room_code=? AND player_id=?')->execute([$pose, $in['code'], $p['player_id']]);
    json_out(['ok' => true]);
}

function action_sync_paint($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $data = (string) ($in['data'] ?? '');
    if (strlen($data) > MAX_PAINT_CHARS) json_err('Painted texture too large.', 413);
    $pdo->prepare('UPDATE room_players SET paint_data=?, paint_rev=paint_rev+1 WHERE room_code=? AND player_id=?')
        ->execute([$data, $in['code'], $p['player_id']]);
    json_out(['ok' => true]);
}

function action_request_repaint($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $room = require_room($pdo, $in['code']);
    if ($p['role'] !== 'hider' || !$p['alive'] || (int) $p['repaints_used'] >= (int) $room['repaint_limit']) {
        json_out(['ok' => true, 'granted' => false]);
    }
    $pdo->prepare("
        UPDATE room_players SET repaints_used = repaints_used + 1, is_repainting = 1,
            repaint_window_ends_at = NOW(3) + INTERVAL " . REPAINT_WINDOW_SEC . ' SECOND
        WHERE room_code = ? AND player_id = ?
    ')->execute([$in['code'], $p['player_id']]);
    json_out(['ok' => true, 'granted' => true]);
}

function action_end_repaint($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $pdo->prepare('UPDATE room_players SET is_repainting=0 WHERE room_code=? AND player_id=?')->execute([$in['code'], $p['player_id']]);
    json_out(['ok' => true]);
}

function action_attempt_catch($pdo, $in) {
    require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $targetId = (string) ($in['targetId'] ?? '');
    if ($targetId === '') json_out(['ok' => true, 'correct' => false]);

    // Atomic conditional UPDATE — only succeeds (rowCount 1) if the target
    // is still a live hider, so two Seekers tapping the same Hider at once
    // can't both "win" the catch (mirrors the old Firebase transaction).
    $stmt = $pdo->prepare("
        UPDATE room_players SET alive=0, caught_by=?, caught_at=NOW(3)
        WHERE room_code=? AND player_id=? AND role='hider' AND alive=1
    ");
    $stmt->execute([$in['playerId'], $in['code'], $targetId]);
    json_out(['ok' => true, 'correct' => $stmt->rowCount() === 1]);
}

function action_reset_to_lobby($pdo, $in) {
    $p = require_player($pdo, $in['code'], $in['playerId'], $in['token']);
    $room = require_room($pdo, $in['code']);
    if ($room['created_by'] !== $p['player_id']) json_err('Only the host can do this.', 403);

    $pdo->prepare("UPDATE room_players SET role='lobby', alive=1, ready=0, pose='stand', repaints_used=0, is_repainting=0 WHERE room_code=?")
        ->execute([$in['code']]);
    $pdo->prepare("UPDATE rooms SET phase='lobby', phase_started_at=NOW(3), winner_role=NULL WHERE code=?")
        ->execute([$in['code']]);
    json_out(['ok' => true]);
}

function action_get_state($pdo, $in) {
    $code = strtoupper(trim((string) ($in['code'] ?? '')));
    if ($code === '') json_err('Missing room code.', 400);

    tick_room($pdo, $code);

    if (!empty($in['playerId'])) {
        $pdo->prepare('UPDATE room_players SET last_seen = NOW(3) WHERE room_code = ? AND player_id = ?')
            ->execute([$code, $in['playerId']]);
    }

    $room = require_room($pdo, $code);
    $meta = public_meta($room);

    $stmt = $pdo->prepare('SELECT *, UNIX_TIMESTAMP(repaint_window_ends_at) * 1000 AS repaint_ends_ms FROM room_players WHERE room_code = ?');
    $stmt->execute([$code]);
    $players = [];
    foreach ($stmt->fetchAll() as $row) {
        $players[$row['player_id']] = public_player($row);
    }

    json_out(['ok' => true, 'serverTime' => round(microtime(true) * 1000), 'meta' => $meta, 'players' => $players]);
}

function action_list_public_rooms($pdo) {
    $stmt = $pdo->query("
        SELECT r.*, (SELECT COUNT(*) FROM room_players p WHERE p.room_code = r.code) AS player_count
        FROM rooms r
        WHERE r.is_public = 1 AND r.phase = 'lobby'
        ORDER BY r.created_at DESC
        LIMIT 30
    ");
    $rooms = [];
    foreach ($stmt->fetchAll() as $row) {
        if ((int) $row['player_count'] >= (int) $row['max_players']) continue;
        $rooms[] = [
            'code' => $row['code'],
            'name' => $row['name'],
            'mapSlug' => $row['map_slug'],
            'playerCount' => (int) $row['player_count'],
            'maxPlayers' => (int) $row['max_players'],
            'phase' => $row['phase'],
        ];
    }
    json_out(['ok' => true, 'rooms' => $rooms]);
}

// ---------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('Method not allowed.', 405);

$raw = file_get_contents('php://input');
$in = json_decode($raw, true);
if (!is_array($in) || empty($in['action'])) json_err('Invalid request.', 400);

try {
    $pdo = db();
    switch ($in['action']) {
        case 'create_room': action_create_room($pdo, $in); break;
        case 'join_room': action_join_room($pdo, $in); break;
        case 'spectate_room': action_spectate_room($pdo, $in); break;
        case 'leave_room': action_leave_room($pdo, $in); break;
        case 'set_ready': action_set_ready($pdo, $in); break;
        case 'update_settings': action_update_settings($pdo, $in); break;
        case 'start_round': action_start_round($pdo, $in); break;
        case 'update_transform': action_update_transform($pdo, $in); break;
        case 'set_pose': action_set_pose($pdo, $in); break;
        case 'sync_paint': action_sync_paint($pdo, $in); break;
        case 'request_repaint': action_request_repaint($pdo, $in); break;
        case 'end_repaint': action_end_repaint($pdo, $in); break;
        case 'attempt_catch': action_attempt_catch($pdo, $in); break;
        case 'reset_to_lobby': action_reset_to_lobby($pdo, $in); break;
        case 'get_state': action_get_state($pdo, $in); break;
        case 'list_public_rooms': action_list_public_rooms($pdo); break;
        default: json_err('Unknown action.', 400);
    }
} catch (Exception $e) {
    json_err($e->getMessage(), 500);
}
