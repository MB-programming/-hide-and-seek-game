# ZIZO HIDE

A web-based multiplayer camouflage/hide-and-seek game (a "Meccha Chameleon"-style
clone): Hiders freehand-paint their character to blend into the stage, Seekers hunt
for the disguise. Vanilla JS + HTML5 Canvas frontend, Firebase Realtime Database for
multiplayer sync, PHP + MySQL admin panel — all deployable to plain shared hosting
(Hostinger) with **no Node.js / WebSocket server / build step**.

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
  api/                     tiny public JSON endpoints the frontend calls
                           (get-config.php, log-session.php)
sql/schema.sql            import this once via phpMyAdmin
firebase-rules.json        paste into Firebase console > Realtime Database > Rules
README.md                  this file
```

Everything under `public_html/` is meant to be uploaded as-is (FTP or Hostinger's File
Manager) directly into your hosting account's `public_html`. Nothing outside that
folder needs to go on the server.

## 2. Firebase setup guide (free tier)

1. Go to https://console.firebase.google.com and click **Add project**. Name it
   anything (e.g. "zizo-hide"). You can disable Google Analytics for this project —
   it isn't used.
2. Once the project is created, click the **</>** (web) icon on the project overview
   page to register a web app. Give it any nickname and click **Register app**. Firebase
   will show you a `firebaseConfig` object — copy it.
3. Open `public_html/assets/js/firebase-config.js` and paste your values into the
   placeholders (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`).
4. In the Firebase console left sidebar, go to **Build > Realtime Database** and click
   **Create Database**. Choose any location close to your players, and start in
   **locked mode** (we'll paste our own rules next).
5. Still in Realtime Database, click the **Rules** tab, delete everything there, and
   paste the entire contents of `firebase-rules.json` from this repo. Click **Publish**.
6. Go to **Build > Authentication > Sign-in method** and enable **Anonymous**
   sign-in. This is the only auth method the game uses — every browser tab gets a
   stable anonymous `uid` used to identify "who owns which player" in the database
   (see `firebase-rules.json` and `assets/js/room.js` for how that's used).
7. That's it — no Cloud Functions, no paid tier required. The free "Spark" plan's
   Realtime Database quota (1 GB stored, 10 GB/month downloaded) comfortably covers
   casual play; see "Bandwidth notes" below for why.

## 3. Hostinger (or any PHP + MySQL shared host) setup

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
   settings, and empty sound/log tables.
4. **Configure the admin panel's DB connection.** Copy
   `public_html/admin/config.sample.php` to `public_html/admin/config.php` and
   fill in `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` with the values from step
   2. `config.php` is gitignored on purpose (real DB credentials shouldn't sit
   in version control) — upload it to your host manually alongside everything
   else.
5. **Log in.** Visit `https://yourdomain.com/admin/login.php`.
   - Default login: **admin / zizo-admin-2026**
   - **Change this immediately** — easiest way: generate a new hash locally
     (`php -r "echo password_hash('yournewpassword', PASSWORD_DEFAULT);"`) and update
     the `admins.password_hash` column for the `admin` row via phpMyAdmin.
6. Done — visit `https://yourdomain.com/index.html` to play. No further server
   configuration, no cron jobs, no persistent processes.

## 4. Using the admin panel

- **Stages** (`admin/stages.php`): add/edit maps. Optionally upload a background
  image (JPG/PNG/WEBP); if you don't, the stage uses one of the built-in
  procedurally-drawn backgrounds (see `assets/js/stages.js`) so the game is fully
  playable with zero art assets. Use the click-to-draw canvas editor to place
  camouflage zones (labeled rectangles), Hider/Seeker spawn points, and the movement
  boundary — this writes directly into the `config_json` column that the frontend
  reads via `api/get-config.php`.
- **Sounds** (`admin/sounds.php`): upload mp3/ogg/wav/m4a files and assign them to an
  event (`round_start`, `painting_end`, `seeker_released`, `catch`, `round_over`,
  `victory`, `defeat`, `ambient`), either globally or overridden per stage. Sounds are
  lazy-loaded client-side — nothing plays until its event actually happens.
- **Room Settings** (`admin/rooms.php`): defaults used to prefill the "Create Room"
  form (Seeker count, painting/round duration, repaint limit, max public rooms, etc).
- **Session Logs** (`admin/logs.php`): every finished round is logged here (room code,
  map, player/seeker/hider/caught counts, winner, duration) via `api/log-session.php`,
  called once by whichever browser is currently the room's host.

Any changes here take effect immediately for new rounds — the frontend always reads
current stage/sound/settings data from MySQL via `api/get-config.php`; it never bakes
stage data into the JS bundle.

## 5. Extending the game yourself

- **New stage**: add it from `admin/stages.php` — no code changes needed unless you
  want a new *procedural* (art-free) background style, in which case add a new
  renderer function to the `RENDERERS` map in `assets/js/stages.js` and reference its
  key as `"procedural"` in the stage's JSON config.
- **New pose**: add a shape to `buildSilhouettePath()` in `assets/js/paint.js`, then
  add a matching button (`data-pose="yourpose"`) to the `.pose-buttons` block in
  `game.html`. The Firebase rule `players/$playerId/pose` also needs the new value
  added to its `.validate` enum in `firebase-rules.json`.
- **New sound event**: just upload one from `admin/sounds.php` with a new
  `event_key`, then call `ZizoAudio.play('your_event_key', mapSlug)` from
  `assets/js/game-main.js` wherever that moment happens.

## 6. How the painting/sync mechanic works (read this before touching paint.js/room.js)

- Every Hider paints on a **fixed 48x64px canvas** regardless of their screen size
  (`ZizoPaint.PAINT_W/PAINT_H`). Painting big on a phone or small on a monitor
  produces the exact same small PNG.
- The brush is confined to the body silhouette using
  `globalCompositeOperation = 'source-atop'` rather than a clip path per stroke — see
  the big comment at the top of `assets/js/paint.js`.
- **The painted PNG is only sent over the network on explicit checkpoints** (the
  "Confirm" button, or automatically once when the painting phase timer ends) — never
  per brush stroke. This is the single biggest bandwidth control in the app; see
  `Room.prototype.syncPaintCheckpoint` in `assets/js/room.js`.
- There is **no persistent server process**. One connected browser (the room
  "host") drives the phase clock (`lobby -> starting -> painting -> seeking ->
  results`) off `ZizoFirebase.serverNow()` (Firebase's server-time-offset trick, so
  client clock skew can't desync countdowns) and writes phase transitions everyone
  else just reacts to. If the host disconnects, the longest-connected remaining
  player promotes itself after a few seconds — see `_watchHostFailover` in `room.js`.
  This is best-effort, appropriate for small casual rooms, not a formal consensus
  protocol.

## 7. Security notes (read before opening this to strangers)

- **Trust model**: because there's no backend game server, catch resolution
  (`Room.prototype.attemptCatch`) needs a Seeker's browser to be able to flip a
  Hider's `alive` field. The Firebase rules therefore allow any signed-in room
  participant to write any player's node (see the comment above
  `players/$playerId` in `firebase-rules.json`), rather than only their own uid.
  Field-level `.validate` rules bound the *shape and size* of what can be written
  (nickname length, enum roles/poses, a hard cap on the painted-texture string
  length), but a technically sophisticated player could use devtools to forge
  another player's position or catch status. This is an accepted tradeoff for a
  casual party game; if you need real anti-cheat, that logic would need to move into
  a small authoritative backend (e.g. a Cloud Function) that this project
  deliberately avoids to stay on plain PHP shared hosting.
- **Admin panel**: password-protected (bcrypt via PHP's `password_hash`), CSRF
  tokens on every form, PDO prepared statements everywhere, upload validation
  (`getimagesize()` + MIME allowlist for images, extension allowlist for audio), and
  `.htaccess` files in `img/stages/` and `sfx/` that refuse to execute anything as
  PHP even if an attacker somehow got a disguised file past validation.
- **Change the default admin password** immediately after first login (see step 5
  above) — the seeded hash is public in this repo's `sql/schema.sql`.

## 8. Known limitations

- Host failover, painted-texture sync, and phase timing are all best-effort
  client-driven mechanisms appropriate for a casual browser game — not a
  competitive-integrity guarantee.
- A player who force-quits mid-round is simply removed from the room
  (`onDisconnect().remove()`); their painted sprite disappears rather than lingering.
- The 4 built-in stages ship as art-free procedural backgrounds (flat shapes/colors)
  so the project has zero binary art dependencies out of the box — upload your own
  background images from the admin panel for a more polished look.

## 9. Local testing without Hostinger

You can serve `public_html/` with any static file server for frontend testing (e.g.
`php -S localhost:8000 -t public_html`), but the **admin panel and `api/*.php`
endpoints need a real MySQL connection** (PDO/MySQL), and Firebase always talks to the
real cloud project regardless of where you host the static files — there is no local
emulation configured in this project. Firebase's free Realtime Database emulator
suite can be used instead if you want fully offline testing, but that's not covered
here.
