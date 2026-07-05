<?php
/**
 * api/diagnose.php — a small self-contained health check, safe to leave
 * public (reports booleans/counts only, never secrets). Visit this
 * directly in a browser when something is returning a bare 500 error to
 * find out exactly which step is failing: config.php missing, DB
 * connection refused, or a table missing/empty.
 */

header('Content-Type: application/json; charset=utf-8');

$report = [
    'php_version' => PHP_VERSION,
    'config_file_exists' => false,
    'db_connect_ok' => false,
    'db_error' => null,
    'tables' => [],
];

$configPath = __DIR__ . '/../admin/config.php';
$report['config_file_exists'] = file_exists($configPath);

if (!$report['config_file_exists']) {
    echo json_encode($report, JSON_PRETTY_PRINT);
    exit;
}

try {
    require_once $configPath;
    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $report['db_connect_ok'] = true;

    foreach (['admins', 'stages', 'settings', 'rooms', 'room_players', 'sounds', 'session_logs'] as $table) {
        try {
            $count = $pdo->query('SELECT COUNT(*) FROM `' . $table . '`')->fetchColumn();
            $report['tables'][$table] = (int) $count;
        } catch (Exception $e) {
            $report['tables'][$table] = 'MISSING (' . $e->getMessage() . ')';
        }
    }
} catch (Exception $e) {
    $report['db_error'] = $e->getMessage();
}

echo json_encode($report, JSON_PRETTY_PRINT);
