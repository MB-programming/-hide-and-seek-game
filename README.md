# ZIZO HIDE

A web-based multiplayer camouflage/hide-and-seek game (a "Meccha Chameleon"-style
clone): Hiders freehand-paint their character to blend into a real 3D stage, Seekers
hunt for the disguise. Vanilla JS + a genuine WebGL 3D scene (Three.js, loaded via
plain CDN `<script>` tag — no bundler) for the room/characters, a small HTML5 Canvas
for the 2D brush toolbar itself, and **plain PHP + MySQL for everything else,
including multiplayer sync** — no Firebase, no Node.js, no WebSocket server, no
build step. Deployable to any ordinary shared host (Hostinger and similar).

Note on visual fidelity: rooms and props are built from simple textured/colored 3D
boxes with real lighting (see `assets/js/scene3d.js`) rather than licensed 3D art
assets — genuinely 3D and lit, but stylized/low-poly rather than photorealistic.
Admins can upload a real floor photo per stage from the admin panel for a more
grounded look (`admin/stages.php`).

## 1. Folder structure

```
public_html/            <- upload THIS folder's contents to your Hostinger public_html
  index.html             landing page: nickname, public room browser, create/join
  game.html               the game itself (lobby -> painting -> seeking -> results)
  assets/
    css/style.css         all styling (responsive + RTL)
    js/                   vanilla JS modules, loaded as plain <script> tags (no bundler)
  data/stages/*.json       seed stage configs (imported into MySQL by sql/schema.sql;
                           kept here only as a fallback + reference format)
  img/stages/               uploaded stage background images land here (admin panel)
  sfx/                      uploaded sound effects land here (admin panel)
  admin/                   PHP + MySQL admin panel (password protected)
  api/                     public JSON endpoints the frontend calls:
                           get-config.php, log-session.php, and game.php (the
                           entire multiplayer backend — see section 5)
sql/schema.sql            import this once via phpMyAdmin
README.md                  this file
```

Everything under `public_html/` is meant to be uploaded as-is (FTP or Hostinger's File
Manager) directly into your hosting account's `public_html`. Nothing outside that
folder needs to go on the server.

## 2. Hostinger (or any PHP + MySQL shared host) setup

1. **Upload files.** Using Hostinger's File Manager or an FTP client, upload the
   entire contents of this repo's `public_html/` folder into your hosting account's
   `public_html/` (or a subfolder if you want the game at a sub-path — just make sure
   `admin/`, `api/`, `assets/`, `data/`, `img/`, `sfx/` all stay siblings of
   `index.html`/`game.html`).
2. **Create a MySQL database.** In hPanel, go to **Databases > MySQL Databases**,
   create a new database + user, and note the database name, username, password, and
   host (usually `localhost` on Hostinger).
3. **Import the schema.** Open **phpMyAdmin** for that database, go to the **Import**
   tab, choose `sql/schema.sql` from this repo, and run the import. This creates all
   tables and seeds: a default admin login, the 4 starter stages, default gameplay
   settings, and empty sound/log/room tables.
4. **Configure the admin panel's DB connection.** Copy
   `public_html/admin/config.sample.php` to `public_html/admin/config.php` and
   fill in `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` with the values from step
   2. `config.php` is gitignored on purpose (real DB credentials shouldn't sit
   in version control) — **upload it to your host manually**, since a plain
   `git clone`/download of this repo will not include it.
5. **Log in.** Visit `https://yourdomain.com/admin/login.php`.
   - Default login: **admin / zizo-admin-2026**
   - **Change this immediately** — easiest way: generate a new hash locally
     (`php -r "echo password_hash('yournewpassword', PASSWORD_DEFAULT);"`) and update
     the `admins.password_hash` column for the `admin` row via phpMyAdmin.
6. Done — visit `https://yourdomain.com/index.html` to play. No further server
   configuration, no cron jobs, no persistent processes. If a page loads but the map
   list is empty or nothing happens when you click Create/Start, step 2-4 (the MySQL
   connection) is almost always the cause — check that `admin/config.php` actually
   exists on the server and `admin/login.php` loads without a 500 error.

## 3. Using the admin panel

- **Stages** (`admin/stages.php`): add/edit maps. Set the room's wall height and
  floor/wall colors, and optionally upload a floor texture photo (JPG/PNG/WEBP); if
  you don't, the floor uses a built-in procedural checker pattern so the game is
  fully playable with zero art assets. The editor is a top-down 2D *blueprint* of the
  real 3D room built by `assets/js/scene3d.js` — use it to click-drag camouflage zone
  boxes (each with its own height + color, becoming a real lit 3D prop), place
  Hider/Seeker spawn points, and set the movement boundary. This all writes directly
  into the `config_json` column that the frontend reads via `api/get-config.php`
  and that `api/game.php` reads server-side to place spawns when a round starts.
- **Sounds** (`admin/sounds.php`): upload mp3/ogg/wav/m4a files and assign them to an
  event (`round_start`, `painting_end`, `seeker_released`, `catch`, `round_over`,
  `victory`, `defeat`, `ambient`), either globally or overridden per stage. Sounds are
  lazy-loaded client-side — nothing plays until its event actually happens.
- **Room Settings** (`admin/rooms.php`): defaults used to prefill the "Create Room"
  form (Seeker count, painting/round duration, repaint limit, max public rooms, etc).
- **Session Logs** (`admin/logs.php`): every finished round is logged here (room code,
  map, player/seeker/hider/caught counts, winner, duration) via `api/log-session.php`,
  called once by whichever browser happens to be the room's creator when it ends.

Any changes here take effect immediately for new rounds — the frontend always reads
current stage/sound/settings data from MySQL via `api/get-config.php`; it never bakes
stage data into the JS bundle.

## 4. Extending the game yourself

- **New stage**: add it from `admin/stages.php` — no code changes needed. Wall
  height/colors, zone box heights/colors, floor texture, spawns and bounds are all
  data-driven from `config_json` and consumed by `assets/js/scene3d.js` (rendering)
  and `api/game.php`'s `action_start_round` (spawn placement).
- **New pose**: add a shape to `buildSilhouettePath()` in `assets/js/paint.js`, then
  add a matching button (`data-pose="yourpose"`) to the `.pose-buttons` block in
  `game.html`, and add `'yourpose'` to the pose allowlists in `api/game.php`
  (`action_update_transform` and `action_set_pose` both check
  `in_array($pose, ['stand','crouch','lean'], true)`).
- **New sound event**: just upload one from `admin/sounds.php` with a new
  `event_key`, then call `ZizoAudio.play('your_event_key', mapSlug)` from
  `assets/js/game-main.js` wherever that moment happens.

## 5. How multiplayer sync works (read this before touching room.js/api/game.php)

There is **no persistent server process and no external realtime service** — the
entire multiplayer backend is one PHP file, `api/game.php`, storing state in two
MySQL tables (`rooms`, `room_players`). Every client just polls it repeatedly:

- **The client (`assets/js/room.js`)** calls `action=get_state` on a loop —
  every ~700ms during an active round (starting/painting/seeking), backing off to
  ~1500ms while idling in the lobby or looking at results. It's a recursive
  `setTimeout` chain, not `setInterval`, so a slow response can never cause request
  pileup — the next poll only fires after the previous one finishes.
- **The server drives its own phase clock.** Every single `get_state` call also runs
  `tick_room()`, which checks elapsed time (and win conditions) and, if due, advances
  `lobby -> starting -> painting -> seeking -> results` via a plain conditional
  `UPDATE ... WHERE phase = 'x' AND ...` — never a read-then-write. That means *any*
  client's poll can safely advance the room; two clients polling at the same instant
  can't double-process the same transition, because whichever `UPDATE` commits first
  changes the row so the second one's `WHERE phase = 'x'` no longer matches. This is
  strictly simpler than this project's earlier Firebase-based design, which needed a
  single elected "host" browser tab to drive the clock and a failover mechanism for
  when that tab disconnected — none of that exists anymore.
- **Auth is a public `player_id` + a secret `token`**, returned once when you create
  or join a room and kept in `sessionStorage` (see `room.js`). Every mutating request
  (move, paint, ready, catch, etc.) sends both; the server checks the token matches
  before touching that row. `get_state` responses never include other players'
  tokens.
- **Catching** is one atomic conditional `UPDATE room_players SET alive=0 ...
  WHERE ... AND role='hider' AND alive=1`, checked via the affected-row count — the
  same "only the first one wins" guarantee Firebase's transaction used to provide.
- **The old "catch" sound/flash event feed** doesn't exist as a separate mechanism
  anymore either: `room.js` just diffs each poll's player list against the previous
  one and fires a local `'catch'` event the instant a Hider's `alive` flips to false
  — every client detects this independently on its own next poll.
- **Painting**: every Hider paints on a fixed 48x64px canvas
  (`ZizoPaint.PAINT_W/PAINT_H`) regardless of screen size, and that PNG is only ever
  sent to the server on explicit checkpoints (the "Confirm" button, or automatically
  once when the painting phase timer ends) — never per brush stroke. That same PNG
  becomes the 3D character's material texture (`THREE.TextureLoader`, see
  `player.js`).
- **Clock skew**: every `api/game.php` response includes `serverTime` (server epoch
  ms); the client keeps a running `offset` from it (`assets/js/net.js`) so phase
  countdowns stay correct even on a device with a wrong clock, the same purpose
  Firebase's server-time-offset trick used to serve.
- **Disconnects**: there's no realtime presence system, so a player who stops
  polling (closed tab, lost connection) is just detected by staleness — `tick_room()`
  deletes any `room_players` row whose `last_seen` heartbeat is more than 20 seconds
  old. A player who merely refreshes the page resumes their same identity instead
  (see `Room.prototype.resume` in `room.js`, backed by the `sessionStorage` token).

### Load/bandwidth tuning

This design intentionally trades a bit of latency for much lower server load than a
push-based approach — appropriate for ordinary shared hosting, per the project's
requirements. If you need to tune it further:

- `IDLE_POLL_MS` / `ACTIVE_POLL_MS` in `assets/js/room.js` — polling cadence.
- `TRANSFORM_THROTTLE_MS` in `assets/js/room.js` — how often movement updates are
  sent (movement itself stays optimistic/instant on your own screen regardless; this
  only affects how fresh *other* players look).
- `LIST_POLL_MS` in `assets/js/matchmaking.js` — how often the public room browser
  refreshes (not latency-sensitive, kept slow by default).
- Every `room_players` row is one small MySQL UPDATE per poll/action — indexed by
  primary key / the `(room_code, player_id)` unique key, so this scales fine to the
  project's target of small casual rooms (2-10 players) even on modest shared
  hosting, but wasn't designed for hundreds of concurrent rooms.

## 6. Security notes (read before opening this to strangers)

- **Trust model**: because there's no separately-authenticated backend beyond the
  per-player token described above, `api/game.php` allows any player who knows a
  room's code to join it, and any authenticated player-in-that-room to attempt a
  catch on any other player id in that same room (necessary for the catch mechanic
  itself — a Seeker's request has to be able to flip a *different* player's `alive`
  field). Field-level validation (nickname length, enum roles/poses, a hard cap on
  the painted-texture string length, numeric clamps on room settings) bounds what
  can be written, but a technically sophisticated player could still forge their own
  position or catch attempts via devtools. This is an accepted tradeoff for a casual
  party game; real anti-cheat would need a more defensive server design than this
  project's "keep it simple, run anywhere" scope allows for.
- **Admin panel**: password-protected (bcrypt via PHP's `password_hash`), CSRF
  tokens on every form, PDO prepared statements everywhere, upload validation
  (`getimagesize()` + MIME allowlist for images, extension allowlist for audio), and
  `.htaccess` files in `img/stages/` and `sfx/` that refuse to execute anything as
  PHP even if an attacker somehow got a disguised file past validation.
- **Change the default admin password** immediately after first login (see section 2
  step 5) — the seeded hash is public in this repo's `sql/schema.sql`.
- **`admin/config.php`** holds your real database password — it's gitignored
  precisely so it never ends up in a public repo or commit history; don't
  accidentally commit or share it.

## 7. Known limitations

- Sync is poll-based, not push-based: expect up to one polling interval's worth of
  latency (see section 5) before you see another player's new position, a catch, or
  a phase change — a deliberate tradeoff for running well on ordinary shared hosting
  instead of needing a persistent process.
- Disconnect detection is heartbeat/staleness-based (20s timeout), not instant.
- The 4 built-in stages ship as art-free 3D rooms (textured/colored boxes with real
  lighting, no external models/images) so the project has zero binary art
  dependencies out of the box — upload a floor texture photo per stage from the
  admin panel for a more polished/realistic look. Walls and zone props are always
  simple lit boxes, not photorealistic 3D models — a full licensed 3D art pipeline is
  out of scope for this project.
- The camera is a third-person "chase" camera that follows behind the local player;
  drag anywhere on the stage (mouse or touch) to orbit it and look around — a small
  drag-distance threshold (`DRAG_THRESHOLD` in `assets/js/input.js`) disambiguates a
  look-around drag from a tap (catch attempt/eyedropper), so the two never conflict.
  It's a simple yaw-only orbit, not full 6DOF free-look. Seekers get a further-back,
  higher angle than Hiders for a wider search view.
- **Jump** (Spacebar on desktop, the on-screen button on touch) is a purely local
  visual hop — it is *not* synced to other clients, to avoid adding another polled
  field for every player on every tick (see the load-tuning notes above). Other
  players won't see you mid-air.
- WebGL (required for the 3D scene) is broadly supported on phones from roughly the
  last 8+ years, but a truly ancient or very low-end device could still struggle more
  with a lit 3D scene than it would with a flat 2D canvas.

## 8. Local testing without Hostinger

`api/game.php` and the admin panel both need a real MySQL connection (PDO/MySQL) to
do anything — there's no external service to fall back on, since multiplayer sync
is 100% local to your own database now. To test locally: run any MySQL server,
import `sql/schema.sql`, point `admin/config.php` at it, then serve the site with
PHP's built-in server, e.g. `php -S localhost:8000 -t public_html`.
