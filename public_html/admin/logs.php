<?php
/**
 * logs.php — paginated view of session_logs, written by api/log-session.php
 * whenever a round finishes.
 */
require_once __DIR__ . '/includes/auth.php';
require_login();

$page = max(1, (int) ($_GET['page'] ?? 1));
$perPage = 25;
$offset = ($page - 1) * $perPage;

$total = (int) db()->query('SELECT COUNT(*) c FROM session_logs')->fetch()['c'];
$stmt = db()->prepare('SELECT * FROM session_logs ORDER BY id DESC LIMIT ? OFFSET ?');
$stmt->bindValue(1, $perPage, PDO::PARAM_INT);
$stmt->bindValue(2, $offset, PDO::PARAM_INT);
$stmt->execute();
$logs = $stmt->fetchAll();
$totalPages = max(1, ceil($total / $perPage));

$pageTitle = 'Session Logs';
$activeNav = 'logs';
require __DIR__ . '/includes/header.php';
?>
<h1>Session Logs</h1>
<div class="card">
  <table>
    <tr><th>Room</th><th>Map</th><th>Players</th><th>Seekers</th><th>Hiders</th><th>Caught</th><th>Winner</th><th>Duration</th><th>Ended</th></tr>
    <?php foreach ($logs as $l): ?>
    <tr>
      <td><?= htmlspecialchars($l['room_code']) ?> <?= $l['is_public'] ? '<span class="badge">public</span>' : '' ?></td>
      <td><?= htmlspecialchars($l['map_slug'] ?? '—') ?></td>
      <td><?= (int)$l['player_count'] ?></td>
      <td><?= (int)$l['seeker_count'] ?></td>
      <td><?= (int)$l['hider_count'] ?></td>
      <td><?= (int)$l['caught_count'] ?></td>
      <td><?= htmlspecialchars($l['winner_role'] ?? '—') ?></td>
      <td><?= $l['duration_sec'] !== null ? ((int)$l['duration_sec'] . 's') : '—' ?></td>
      <td><?= htmlspecialchars($l['ended_at'] ?? '—') ?></td>
    </tr>
    <?php endforeach; ?>
    <?php if (!$logs): ?><tr><td colspan="9" class="muted">No rounds logged yet.</td></tr><?php endif; ?>
  </table>
  <?php if ($totalPages > 1): ?>
  <p class="muted">
    <?php for ($p = 1; $p <= $totalPages; $p++): ?>
      <?php if ($p === $page): ?><b><?= $p ?></b><?php else: ?><a href="logs.php?page=<?= $p ?>"><?= $p ?></a><?php endif; ?>
    <?php endfor; ?>
  </p>
  <?php endif; ?>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
