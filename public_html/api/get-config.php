<?php
/**
 * api/get-config.php — the ONLY bridge between the static frontend and
 * MySQL/admin panel. Public, read-only, no auth (it's just game config:
 * stage list, sound assignments, gameplay defaults). Kept intentionally
 * small and cheap so it can be called on every page load.
 */
require_once __DIR__ . '/../admin/includes/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, max-age=0');

try {
    $settingsRows = db()->query('SELECT setting_key, setting_value FROM settings')->fetchAll();
    $settings = [];
    foreach ($settingsRows as $r) {
        $v = $r['setting_value'];
        $settings[$r['setting_key']] = is_numeric($v) ? $v + 0 : $v;
    }

    $stageRows = db()->query('SELECT slug, name, background_image, width, height, config_json FROM stages WHERE is_active = 1 ORDER BY sort_order, id')->fetchAll();
    $stages = [];
    foreach ($stageRows as $s) {
        $cfg = json_decode($s['config_json'], true) ?: [];
        $cfg['slug'] = $s['slug'];
        $cfg['name'] = $s['name'];
        $cfg['width'] = (int) $s['width'];
        $cfg['height'] = (int) $s['height'];
        $cfg['backgroundImage'] = $s['background_image'] ? ('.' . $s['background_image']) : null;
        $stages[] = $cfg;
    }

    $soundRows = db()->query('
        SELECT sounds.event_key, sounds.file_path, stages.slug AS stage_slug
        FROM sounds LEFT JOIN stages ON stages.id = sounds.stage_id
    ')->fetchAll();
    $sounds = [];
    foreach ($soundRows as $s) {
        $key = $s['event_key'];
        if (!isset($sounds[$key])) $sounds[$key] = ['default' => null, 'byStage' => new stdClass()];
        $path = '.' . $s['file_path'];
        if ($s['stage_slug']) {
            $sounds[$key]['byStage']->{$s['stage_slug']} = $path;
        } else {
            $sounds[$key]['default'] = $path;
        }
    }

    echo json_encode([
        'settings' => $settings,
        'stages' => $stages,
        'sounds' => $sounds,
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'config_unavailable']);
}
