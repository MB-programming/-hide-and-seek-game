<?php
/**
 * rooms.php — global matchmaking/room defaults (settings table). These
 * feed api/get-config.php, which the landing page (index.html) reads to
 * prefill the "Create Room" form.
 */
require_once __DIR__ . '/includes/auth.php';
require_login();

$FIELDS = [
    'max_public_rooms' => 'Max concurrent public rooms (browser list cap)',
    'max_players_per_room' => 'Max players per room (2-10; also validated server-side in api/game.php)',
    'default_seeker_count' => 'Default Seeker count',
    'default_paint_duration_sec' => 'Default painting duration (sec)',
    'default_round_duration_sec' => 'Default round duration (sec)',
    'default_repaint_limit' => 'Default repaint/reposition limit',
    'wrong_catch_penalty_sec' => 'Wrong-catch freeze penalty (sec)',
    'site_name' => 'Site name',
];

$flash = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $stmt = db()->prepare('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)');
    foreach ($FIELDS as $key => $label) {
        if (isset($_POST[$key])) {
            $stmt->execute([$key, trim($_POST[$key])]);
        }
    }
    $flash = ['ok', 'Settings saved.'];
}

$rows = db()->query('SELECT setting_key, setting_value FROM settings')->fetchAll();
$settings = [];
foreach ($rows as $r) $settings[$r['setting_key']] = $r['setting_value'];

$pageTitle = 'Room Settings';
$activeNav = 'rooms';
require __DIR__ . '/includes/header.php';
?>
<h1>Room Settings</h1>
<?php if ($flash): ?><div class="flash <?= $flash[0] ?>"><?= htmlspecialchars($flash[1]) ?></div><?php endif; ?>
<div class="card">
  <form method="post">
    <?= csrf_field() ?>
    <?php foreach ($FIELDS as $key => $label): ?>
      <label for="<?= $key ?>"><?= htmlspecialchars($label) ?></label>
      <input type="text" id="<?= $key ?>" name="<?= $key ?>" value="<?= htmlspecialchars($settings[$key] ?? '') ?>">
    <?php endforeach; ?>
    <p><button type="submit" class="btn">Save Settings</button></p>
  </form>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
