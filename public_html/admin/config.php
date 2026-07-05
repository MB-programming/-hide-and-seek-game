<?php
/**
 * config.php — EDIT THESE VALUES for your Hostinger MySQL database.
 * Find them in hPanel > Databases > Management (or when you create the DB).
 */

define('DB_HOST', 'localhost');
define('DB_NAME', 'PASTE_YOUR_DB_NAME');
define('DB_USER', 'PASTE_YOUR_DB_USER');
define('DB_PASS', 'PASTE_YOUR_DB_PASSWORD');
define('DB_CHARSET', 'utf8mb4');

// Absolute filesystem path to public_html, used to resolve upload targets.
// On Hostinger this is normally correct as-is (admin/ lives directly under
// public_html/), but adjust if your folder layout differs.
define('PUBLIC_HTML_PATH', dirname(__DIR__));
define('STAGE_UPLOAD_REL', '/img/stages/');
define('SFX_UPLOAD_REL', '/sfx/');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

date_default_timezone_set('UTC');
