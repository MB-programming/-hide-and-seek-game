<?php
require_once __DIR__ . '/includes/auth.php';
require_login();

$totalSessions = (int) db()->query('SELECT COUNT(*) c FROM session_logs')->fetch()['c'];
$totalStages = (int) db()->query('SELECT COUNT(*) c FROM stages WHERE is_active = 1')->fetch()['c'];
$totalSounds = (int) db()->query('SELECT COUNT(*) c FROM sounds')->fetch()['c'];
$recent = db()->query('SELECT * FROM session_logs ORDER BY id DESC LIMIT 5')->fetchAll();

$pageTitle = 'Dashboard';
$activeNav = 'dashboard';
require __DIR__ . '/includes/header.php';
?>
<h1>Dashboard</h1>
<div class="card">
  <p><strong><?= $totalSessions ?></strong> rounds logged &middot; <strong><?= $totalStages ?></strong> active stages &middot; <strong><?= $totalSounds ?></strong> sound assignments</p>
</div>

<div class="card">
  <h2>Recent rounds</h2>
  <table>
    <tr><th>Room</th><th>Map</th><th>Players</th><th>Winner</th><th>Ended</th></tr>
    <?php foreach ($recent as $r): ?>
    <tr>
      <td><?= htmlspecialchars($r['room_code']) ?> <?= $r['is_public'] ? '<span class="badge">public</span>' : '' ?></td>
      <td><?= htmlspecialchars($r['map_slug'] ?? '—') ?></td>
      <td><?= (int)$r['player_count'] ?></td>
      <td><?= htmlspecialchars($r['winner_role'] ?? '—') ?></td>
      <td><?= htmlspecialchars($r['ended_at'] ?? '—') ?></td>
    </tr>
    <?php endforeach; ?>
    <?php if (!$recent): ?><tr><td colspan="5" class="muted">No rounds logged yet.</td></tr><?php endif; ?>
  </table>
  <p><a href="logs.php">View all logs &rarr;</a></p>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
