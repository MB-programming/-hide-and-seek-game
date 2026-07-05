-- ZIZO HIDE - Database schema
-- Import this file via phpMyAdmin (Hostinger: hPanel -> Databases -> phpMyAdmin -> Import)
-- Charset utf8mb4 for full Arabic/emoji support in nicknames, room names, etc.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- admins: who can log into /admin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Default admin: username "admin", password "zizo-admin-2026".
-- CHANGE THIS PASSWORD IMMEDIATELY after first login (Admin Panel > Account).
-- Hash below was generated with PHP password_hash('zizo-admin-2026', PASSWORD_DEFAULT).
INSERT INTO admins (username, password_hash) VALUES
  ('admin', '$2y$12$4vH9gV2WknQbdOfFscfGQerJ.bGgdSEPdnKptq1uHvTtbVWSL8R5O')
ON DUPLICATE KEY UPDATE username = username;

-- ---------------------------------------------------------------------------
-- stages: maps/scenes, each with a JSON config (zones, spawns, bounds)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  background_image VARCHAR(255) NULL COMMENT 'relative path under /img/stages, empty = use built-in procedural background',
  width INT UNSIGNED NOT NULL DEFAULT 960,
  height INT UNSIGNED NOT NULL DEFAULT 540,
  config_json MEDIUMTEXT NOT NULL COMMENT 'zones/spawns/bounds JSON, see data/stages/*.json for shape',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- config_json mirrors public_html/data/stages/*.json (3D room dimensions,
-- floor/wall colors, camouflage zone boxes with height+color, spawn points,
-- movement bounds) minus the fields that already have their own columns
-- (slug/name/width/height/background image) — see api/get-config.php, which
-- merges those columns back in before handing the config to the frontend.
-- Keep these two in sync if you edit the seed stages by hand instead of
-- through the admin panel's editor.
INSERT INTO stages (slug, name, background_image, width, height, config_json, sort_order) VALUES
('warehouse', 'Warehouse', NULL, 960, 540, '{"wallHeight":220,"floorColor":"#8a8f78","wallColor":"#5b5f66","bounds":{"x":30,"y":260,"w":900,"h":250},"zones":[{"x":60,"y":300,"w":120,"h":90,"height":90,"color":"#8a5a2b","label":"Wooden Crate"},{"x":220,"y":330,"w":160,"h":60,"height":70,"color":"#c9b27a","label":"Cardboard Boxes"},{"x":430,"y":290,"w":90,"h":140,"height":180,"color":"#5c6570","label":"Steel Pipe Rack"},{"x":580,"y":320,"w":140,"h":70,"height":100,"color":"#3d3a35","label":"Oil Drum Row"},{"x":770,"y":300,"w":110,"h":100,"height":60,"color":"#a9724f","label":"Loading Pallet"}],"hiderSpawns":[[80,470],[260,470],[440,470],[620,470],[800,470]],"seekerSpawns":[[480,480]]}', 1),
('classroom', 'Classroom', NULL, 960, 540, '{"wallHeight":220,"floorColor":"#b98650","wallColor":"#e7dcc2","bounds":{"x":30,"y":260,"w":900,"h":250},"zones":[{"x":70,"y":300,"w":100,"h":130,"height":170,"color":"#6b4a2f","label":"Bookshelf"},{"x":230,"y":340,"w":150,"h":70,"height":75,"color":"#caa96b","label":"Student Desk Row"},{"x":430,"y":280,"w":100,"h":60,"height":130,"color":"#2f6b4f","label":"Green Chalkboard"},{"x":590,"y":330,"w":130,"h":80,"height":140,"color":"#8c8f92","label":"Storage Cabinet"},{"x":780,"y":310,"w":100,"h":100,"height":190,"color":"#c94f4f","label":"Window Curtain"}],"hiderSpawns":[[100,470],[280,470],[460,470],[640,470],[820,470]],"seekerSpawns":[[480,480]]}', 2),
('office', 'Office', NULL, 960, 540, '{"wallHeight":220,"floorColor":"#9aa0a6","wallColor":"#dfe3e6","bounds":{"x":30,"y":260,"w":900,"h":250},"zones":[{"x":60,"y":320,"w":130,"h":70,"height":110,"color":"#4a4f57","label":"Filing Cabinet"},{"x":240,"y":300,"w":110,"h":110,"height":170,"color":"#2c2f33","label":"Server Rack"},{"x":420,"y":340,"w":150,"h":60,"height":70,"color":"#c7b299","label":"Meeting Table"},{"x":600,"y":290,"w":90,"h":120,"height":150,"color":"#4f7d4a","label":"Potted Plant Wall"},{"x":760,"y":310,"w":120,"h":90,"height":100,"color":"#5a7fa6","label":"Water Cooler Nook"}],"hiderSpawns":[[90,470],[270,470],[450,470],[630,470],[810,470]],"seekerSpawns":[[480,480]]}', 3),
('street', 'Street', NULL, 960, 540, '{"wallHeight":260,"floorColor":"#59595c","wallColor":"#7691a8","bounds":{"x":30,"y":260,"w":900,"h":250},"zones":[{"x":60,"y":300,"w":100,"h":130,"height":150,"color":"#a3402f","label":"Brick Wall Mural"},{"x":230,"y":340,"w":120,"h":70,"height":80,"color":"#4a7a4f","label":"Trash Bin Row"},{"x":420,"y":290,"w":90,"h":130,"height":220,"color":"#3a3a3d","label":"Street Lamp Post"},{"x":580,"y":320,"w":140,"h":70,"height":70,"color":"#7a6a54","label":"Bus Stop Bench"},{"x":770,"y":300,"w":110,"h":100,"height":100,"color":"#c9c2ab","label":"Newspaper Stand"}],"hiderSpawns":[[80,470],[260,470],[440,470],[620,470],[800,470]],"seekerSpawns":[[480,480]]}', 4)
ON DUPLICATE KEY UPDATE slug = slug;

-- ---------------------------------------------------------------------------
-- sounds: uploaded sound effects, assignable per event / per stage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sounds (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_key VARCHAR(50) NOT NULL COMMENT 'round_start|painting_end|seeker_released|catch|round_over|victory|defeat|ambient',
  stage_id INT UNSIGNED NULL COMMENT 'NULL = applies globally to all stages',
  file_path VARCHAR(255) NOT NULL COMMENT 'relative path under /sfx',
  label VARCHAR(100) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- settings: global game / matchmaking defaults, editable from admin panel
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(80) NOT NULL UNIQUE,
  setting_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (setting_key, setting_value) VALUES
('max_public_rooms', '20'),
('max_players_per_room', '10'),
('default_seeker_count', '1'),
('default_paint_duration_sec', '60'),
('default_round_duration_sec', '180'),
('default_repaint_limit', '2'),
('wrong_catch_penalty_sec', '3'),
('site_name', 'ZIZO HIDE')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- ---------------------------------------------------------------------------
-- rooms / room_players: live multiplayer state, driven entirely by
-- api/game.php. There is no persistent server process (plain PHP shared
-- hosting) — every client polls get_state repeatedly, and that same
-- endpoint also runs the server-authoritative phase clock (see
-- api/game.php's tick_room()) so any client's poll can safely advance the
-- room; MySQL's atomic conditional UPDATEs prevent two simultaneous polls
-- from double-processing the same transition.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  code VARCHAR(10) NOT NULL PRIMARY KEY,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  name VARCHAR(60) NOT NULL,
  map_slug VARCHAR(50) NOT NULL,
  max_players TINYINT UNSIGNED NOT NULL DEFAULT 10,
  seeker_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
  paint_duration INT UNSIGNED NOT NULL DEFAULT 60,
  round_duration INT UNSIGNED NOT NULL DEFAULT 180,
  repaint_limit TINYINT UNSIGNED NOT NULL DEFAULT 2,
  wrong_catch_penalty_sec TINYINT UNSIGNED NOT NULL DEFAULT 3,
  phase VARCHAR(20) NOT NULL DEFAULT 'lobby' COMMENT 'lobby|starting|painting|seeking|results',
  phase_started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  winner_role VARCHAR(20) NULL COMMENT 'hiders|seekers',
  created_by VARCHAR(40) NOT NULL COMMENT 'player_id of the room creator (client-side "isCreator" gate for host-only UI)',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_public_lobby (is_public, phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS room_players (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_code VARCHAR(10) NOT NULL,
  player_id VARCHAR(40) NOT NULL COMMENT 'public id, safe to send to other clients (catch targets etc)',
  token VARCHAR(64) NOT NULL COMMENT 'secret, proves a request came from this player — never sent to other clients',
  nickname VARCHAR(20) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'lobby' COMMENT 'lobby|hider|seeker',
  ready TINYINT(1) NOT NULL DEFAULT 0,
  alive TINYINT(1) NOT NULL DEFAULT 1,
  pose VARCHAR(20) NOT NULL DEFAULT 'stand',
  x FLOAT NOT NULL DEFAULT 0,
  y FLOAT NOT NULL DEFAULT 0,
  repaints_used TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_repainting TINYINT(1) NOT NULL DEFAULT 0,
  repaint_window_ends_at DATETIME(3) NULL,
  paint_data LONGTEXT NULL,
  paint_rev BIGINT UNSIGNED NOT NULL DEFAULT 0,
  caught_by VARCHAR(40) NULL,
  caught_at DATETIME(3) NULL,
  last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_room_player (room_code, player_id),
  FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- session_logs: one row per finished round, written by api/log-session.php
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_code VARCHAR(20) NOT NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  map_slug VARCHAR(50) NULL,
  player_count INT UNSIGNED NOT NULL DEFAULT 0,
  seeker_count INT UNSIGNED NOT NULL DEFAULT 0,
  hider_count INT UNSIGNED NOT NULL DEFAULT 0,
  caught_count INT UNSIGNED NOT NULL DEFAULT 0,
  winner_role VARCHAR(20) NULL COMMENT 'hiders|seekers|none',
  started_at DATETIME NULL,
  ended_at DATETIME NULL,
  duration_sec INT UNSIGNED NULL,
  meta_json MEDIUMTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
