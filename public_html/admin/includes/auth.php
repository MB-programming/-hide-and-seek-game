<?php
/**
 * auth.php — session-based admin login (password_hash/password_verify),
 * plus a small CSRF token helper used by every form in the admin panel.
 */
require_once __DIR__ . '/db.php';

function current_admin() {
    return isset($_SESSION['admin_id']) ? [
        'id' => $_SESSION['admin_id'],
        'username' => $_SESSION['admin_username'],
    ] : null;
}

function require_login() {
    if (!current_admin()) {
        header('Location: login.php');
        exit;
    }
}

function attempt_login($username, $password) {
    $stmt = db()->prepare('SELECT id, username, password_hash FROM admins WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $row = $stmt->fetch();
    if ($row && password_verify($password, $row['password_hash'])) {
        session_regenerate_id(true);
        $_SESSION['admin_id'] = $row['id'];
        $_SESSION['admin_username'] = $row['username'];
        return true;
    }
    return false;
}

function admin_logout() {
    $_SESSION = [];
    session_destroy();
}

function csrf_token() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function csrf_field() {
    return '<input type="hidden" name="csrf_token" value="' . htmlspecialchars(csrf_token()) . '">';
}

function csrf_check() {
    $token = $_POST['csrf_token'] ?? '';
    if (!hash_equals($_SESSION['csrf_token'] ?? '', $token)) {
        http_response_code(403);
        exit('Invalid CSRF token. Please go back and try again.');
    }
}
