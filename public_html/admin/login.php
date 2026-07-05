<?php
require_once __DIR__ . '/includes/auth.php';

if (current_admin()) {
    header('Location: index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    if (attempt_login($username, $password)) {
        header('Location: index.php');
        exit;
    }
    $error = 'Invalid username or password.';
}

$pageTitle = 'Login';
require __DIR__ . '/includes/header.php';
?>
<div class="login-wrap card">
  <h1>ZIZO HIDE Admin</h1>
  <?php if ($error): ?><div class="flash err"><?= htmlspecialchars($error) ?></div><?php endif; ?>
  <form method="post">
    <?= csrf_field() ?>
    <label for="username">Username</label>
    <input type="text" id="username" name="username" required autofocus>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>
    <p><button type="submit" class="btn">Log in</button></p>
  </form>
  <p class="muted">Default: admin / zizo-admin-2026 — change this immediately after first login by updating the admins table (or add an account-settings page).</p>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
