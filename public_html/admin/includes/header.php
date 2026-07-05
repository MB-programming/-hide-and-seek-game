<?php
/** header.php — shared admin layout top. Expects $pageTitle and $activeNav (optional). */
$activeNav = $activeNav ?? '';
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= htmlspecialchars($pageTitle ?? 'Admin') ?> — ZIZO HIDE Admin</title>
<link rel="stylesheet" href="assets/admin.css">
</head>
<body>
<?php $admin = current_admin(); if ($admin): ?>
<header class="admin-header">
  <a href="index.php" class="brand">ZIZO <span>HIDE</span> Admin</a>
  <nav class="admin-nav">
    <a href="index.php" class="<?= $activeNav === 'dashboard' ? 'active' : '' ?>">Dashboard</a>
    <a href="stages.php" class="<?= $activeNav === 'stages' ? 'active' : '' ?>">Stages</a>
    <a href="sounds.php" class="<?= $activeNav === 'sounds' ? 'active' : '' ?>">Sounds</a>
    <a href="rooms.php" class="<?= $activeNav === 'rooms' ? 'active' : '' ?>">Room Settings</a>
    <a href="logs.php" class="<?= $activeNav === 'logs' ? 'active' : '' ?>">Session Logs</a>
    <a href="logout.php">Logout (<?= htmlspecialchars($admin['username']) ?>)</a>
  </nav>
</header>
<?php endif; ?>
<div class="admin-wrap">
