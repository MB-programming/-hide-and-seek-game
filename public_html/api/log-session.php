<?php
/**
 * api/log-session.php — records one finished round into session_logs.
 * Called by the room HOST client only (see game-main.js logSessionToServer)
 * so a room of N players doesn't write N duplicate rows. Public endpoint,
 * no auth — this is just anonymous gameplay telemetry for the admin's
 * dashboard/logs pages, deliberately kept minimal (no PII beyond a room
 * code and map name).
 */
require_once __DIR__ . '/../admin/includes/db.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_json']);
    exit;
}

function int_or_null($v) { return $v === null ? null : (int) $v; }
function ms_to_datetime($ms) {
    if (!$ms) return null;
    return gmdate('Y-m-d H:i:s', (int) ($ms / 1000));
}

$roomCode = substr((string) ($data['room_code'] ?? ''), 0, 20);
$mapSlug = substr((string) ($data['map_slug'] ?? ''), 0, 50);
$winnerRole = in_array($data['winner_role'] ?? null, ['hiders', 'seekers'], true) ? $data['winner_role'] : null;
$startedAt = ms_to_datetime($data['started_at'] ?? null);
$endedAt = ms_to_datetime($data['ended_at'] ?? null);
$duration = ($data['started_at'] ?? null) && ($data['ended_at'] ?? null)
    ? max(0, (int) round(($data['ended_at'] - $data['started_at']) / 1000))
    : null;

if (!$roomCode) {
    http_response_code(400);
    echo json_encode(['error' => 'missing_room_code']);
    exit;
}

try {
    db()->prepare('
        INSERT INTO session_logs
            (room_code, is_public, map_slug, player_count, seeker_count, hider_count, caught_count, winner_role, started_at, ended_at, duration_sec, meta_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ')->execute([
        $roomCode,
        !empty($data['is_public']) ? 1 : 0,
        $mapSlug ?: null,
        int_or_null($data['player_count'] ?? 0),
        int_or_null($data['seeker_count'] ?? 0),
        int_or_null($data['hider_count'] ?? 0),
        int_or_null($data['caught_count'] ?? 0),
        $winnerRole,
        $startedAt,
        $endedAt,
        $duration,
        json_encode($data),
    ]);
    echo json_encode(['ok' => true]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'log_failed']);
}
