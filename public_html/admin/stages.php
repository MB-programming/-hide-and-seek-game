<?php
/**
 * stages.php — manage stages (maps): name/slug, optional uploaded
 * background image, and a JSON config (zones/spawns/bounds) editable
 * either via the visual click-to-draw canvas editor below or directly as
 * raw JSON (power users / scripted stage authoring).
 */
require_once __DIR__ . '/includes/auth.php';
require_login();

$flash = null;

function upload_stage_image($file) {
    if (!isset($file) || $file['error'] === UPLOAD_ERR_NO_FILE) return null;
    if ($file['error'] !== UPLOAD_ERR_OK) throw new Exception('Upload failed (code ' . $file['error'] . ').');
    $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $info = getimagesize($file['tmp_name']);
    if (!$info || !isset($allowed[$info['mime']])) throw new Exception('Only JPG/PNG/WEBP images are allowed.');
    $ext = $allowed[$info['mime']];
    $name = 'stage_' . bin2hex(random_bytes(6)) . '.' . $ext;
    $destDir = PUBLIC_HTML_PATH . STAGE_UPLOAD_REL;
    if (!is_dir($destDir)) mkdir($destDir, 0755, true);
    move_uploaded_file($file['tmp_name'], $destDir . $name);
    return STAGE_UPLOAD_REL . $name;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = $_POST['action'] ?? '';

    try {
        if ($action === 'save') {
            $id = (int) ($_POST['id'] ?? 0);
            $slug = preg_replace('/[^a-z0-9_-]/', '', strtolower(trim($_POST['slug'] ?? '')));
            $name = trim($_POST['name'] ?? '');
            $width = (int) ($_POST['width'] ?? 960);
            $height = (int) ($_POST['height'] ?? 540);
            $configJson = trim($_POST['config_json'] ?? '{}');
            $isActive = isset($_POST['is_active']) ? 1 : 0;
            json_decode($configJson);
            if (json_last_error() !== JSON_ERROR_NONE) throw new Exception('Zone config is not valid JSON.');
            if (!$slug || !$name) throw new Exception('Name and slug are required.');

            $newImage = upload_stage_image($_FILES['background_image'] ?? null);

            if ($id) {
                $sql = 'UPDATE stages SET slug=?, name=?, width=?, height=?, config_json=?, is_active=?';
                $params = [$slug, $name, $width, $height, $configJson, $isActive];
                if ($newImage) { $sql .= ', background_image=?'; $params[] = $newImage; }
                $sql .= ' WHERE id=?';
                $params[] = $id;
                db()->prepare($sql)->execute($params);
            } else {
                db()->prepare('INSERT INTO stages (slug, name, background_image, width, height, config_json, is_active) VALUES (?,?,?,?,?,?,?)')
                    ->execute([$slug, $name, $newImage, $width, $height, $configJson, $isActive]);
            }
            $flash = ['ok', 'Stage saved.'];
        } elseif ($action === 'delete') {
            db()->prepare('DELETE FROM stages WHERE id = ?')->execute([(int) $_POST['id']]);
            $flash = ['ok', 'Stage deleted.'];
        }
    } catch (Exception $e) {
        $flash = ['err', $e->getMessage()];
    }
}

$editId = (int) ($_GET['edit'] ?? 0);
$editing = null;
if ($editId) {
    $stmt = db()->prepare('SELECT * FROM stages WHERE id = ?');
    $stmt->execute([$editId]);
    $editing = $stmt->fetch();
}
$stages = db()->query('SELECT * FROM stages ORDER BY sort_order, id')->fetchAll();

$pageTitle = 'Stages';
$activeNav = 'stages';
require __DIR__ . '/includes/header.php';
?>
<h1>Stages</h1>
<?php if ($flash): ?><div class="flash <?= $flash[0] ?>"><?= htmlspecialchars($flash[1]) ?></div><?php endif; ?>

<div class="card">
  <h2><?= $editing ? 'Edit Stage' : 'Add Stage' ?></h2>
  <form method="post" enctype="multipart/form-data">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="save">
    <input type="hidden" name="id" value="<?= (int) ($editing['id'] ?? 0) ?>">

    <label>Name</label>
    <input type="text" name="name" required value="<?= htmlspecialchars($editing['name'] ?? '') ?>">

    <label>Slug (used in URLs/config, letters/numbers/dashes only)</label>
    <input type="text" name="slug" required value="<?= htmlspecialchars($editing['slug'] ?? '') ?>">

    <label>Width / Height (world px)</label>
    <div style="display:flex; gap:10px;">
      <input type="number" name="width" id="stage-width" value="<?= (int) ($editing['width'] ?? 960) ?>">
      <input type="number" name="height" id="stage-height" value="<?= (int) ($editing['height'] ?? 540) ?>">
    </div>

    <label>Background image (optional — leave empty to keep the built-in procedural background)</label>
    <input type="file" name="background_image" id="bg-file" accept="image/*">
    <?php if (!empty($editing['background_image'])): ?>
      <p class="muted">Current: <?= htmlspecialchars($editing['background_image']) ?></p>
    <?php endif; ?>

    <label><input type="checkbox" name="is_active" style="width:auto" <?= empty($editing) || $editing['is_active'] ? 'checked' : '' ?>> Active (selectable when creating a room)</label>

    <h3>Zone / spawn editor</h3>
    <p class="muted">Mode: draw a <b>zone</b> (camouflage object), or place a <b>hider spawn</b> / <b>seeker spawn</b> point. Click-drag for zones, single-click for spawn points.</p>
    <div>
      <label style="display:inline;width:auto"><input type="radio" name="edit-mode" value="zone" checked style="width:auto"> Zone</label>
      <label style="display:inline;width:auto"><input type="radio" name="edit-mode" value="hider" style="width:auto"> Hider spawn</label>
      <label style="display:inline;width:auto"><input type="radio" name="edit-mode" value="seeker" style="width:auto"> Seeker spawn</label>
      <label style="display:inline;width:auto"><input type="radio" name="edit-mode" value="bounds" style="width:auto"> Bounds</label>
      <button type="button" class="btn secondary" id="btn-undo-zone">Undo last</button>
      <button type="button" class="btn secondary" id="btn-clear-zones">Clear all</button>
    </div>
    <canvas id="zone-canvas" class="zone-editor-canvas" width="<?= (int) ($editing['width'] ?? 960) ?>" height="<?= (int) ($editing['height'] ?? 540) ?>"></canvas>

    <label>Raw config JSON (auto-updated by the editor above; you can also hand-edit)</label>
    <textarea name="config_json" id="config-json" rows="6"><?= htmlspecialchars($editing['config_json'] ?? '{"procedural":"warehouse","bounds":{"x":30,"y":260,"w":900,"h":250},"zones":[],"hiderSpawns":[],"seekerSpawns":[]}') ?></textarea>

    <p><button type="submit" class="btn">Save Stage</button> <a href="stages.php" class="btn secondary">Cancel</a></p>
  </form>
</div>

<div class="card">
  <h2>All Stages</h2>
  <table>
    <tr><th>Name</th><th>Slug</th><th>Size</th><th>Active</th><th>Background</th><th></th></tr>
    <?php foreach ($stages as $s): ?>
    <tr>
      <td><?= htmlspecialchars($s['name']) ?></td>
      <td><?= htmlspecialchars($s['slug']) ?></td>
      <td><?= (int)$s['width'] ?>x<?= (int)$s['height'] ?></td>
      <td><?= $s['is_active'] ? 'Yes' : 'No' ?></td>
      <td><?= $s['background_image'] ? 'Uploaded' : 'Procedural' ?></td>
      <td>
        <a href="stages.php?edit=<?= (int)$s['id'] ?>">Edit</a> &middot;
        <form method="post" style="display:inline" onsubmit="return confirm('Delete this stage?');">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="delete">
          <input type="hidden" name="id" value="<?= (int)$s['id'] ?>">
          <button type="submit" class="btn danger" style="padding:4px 10px;font-size:0.8rem;">Delete</button>
        </form>
      </td>
    </tr>
    <?php endforeach; ?>
  </table>
</div>

<script>
(function () {
  var canvas = document.getElementById('zone-canvas');
  var ctx = canvas.getContext('2d');
  var jsonField = document.getElementById('config-json');
  var bgFile = document.getElementById('bg-file');
  var bgImg = null;
  <?php if (!empty($editing['background_image'])): ?>
  bgImg = new Image();
  bgImg.src = '..<?= htmlspecialchars($editing['background_image']) ?>';
  bgImg.onload = draw;
  <?php endif; ?>

  var config;
  try { config = JSON.parse(jsonField.value || '{}'); } catch (e) { config = {}; }
  config.zones = config.zones || [];
  config.hiderSpawns = config.hiderSpawns || [];
  config.seekerSpawns = config.seekerSpawns || [];
  config.bounds = config.bounds || { x: 30, y: 30, w: canvas.width - 60, h: canvas.height - 60 };

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgImg) ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
    else { ctx.fillStyle = '#444'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    ctx.strokeStyle = '#3ad'; ctx.lineWidth = 2;
    var b = config.bounds;
    if (b) ctx.strokeRect(b.x, b.y, b.w, b.h);

    ctx.fillStyle = 'rgba(255,93,58,0.35)'; ctx.strokeStyle = '#ff5d3a';
    config.zones.forEach(function (z) {
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeRect(z.x, z.y, z.w, z.h);
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
      ctx.fillText(z.label || '', z.x + 4, z.y + 14);
      ctx.fillStyle = 'rgba(255,93,58,0.35)';
    });
    ctx.fillStyle = '#2ecC71';
    config.hiderSpawns.forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#2b6fe0';
    config.seekerSpawns.forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, Math.PI * 2); ctx.fill(); });

    jsonField.value = JSON.stringify(config, null, 2);
  }

  bgFile.addEventListener('change', function () {
    var f = bgFile.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      bgImg = new Image();
      bgImg.onload = draw;
      bgImg.src = e.target.result;
    };
    reader.readAsDataURL(f);
  });

  var dragStart = null;
  canvas.addEventListener('mousedown', function (e) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    dragStart = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  });
  canvas.addEventListener('mouseup', function (e) {
    if (!dragStart) return;
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    var end = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    var mode = document.querySelector('input[name=edit-mode]:checked').value;
    var x = Math.min(dragStart.x, end.x), y = Math.min(dragStart.y, end.y);
    var w = Math.abs(end.x - dragStart.x), h = Math.abs(end.y - dragStart.y);

    if (mode === 'hider') config.hiderSpawns.push([Math.round(dragStart.x), Math.round(dragStart.y)]);
    else if (mode === 'seeker') config.seekerSpawns.push([Math.round(dragStart.x), Math.round(dragStart.y)]);
    else if (mode === 'bounds') config.bounds = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    else if (w > 4 && h > 4) {
      var label = prompt('Zone label (e.g. "Wooden Crate")', 'Zone') || 'Zone';
      config.zones.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), label: label });
    }
    dragStart = null;
    draw();
  });

  document.getElementById('btn-undo-zone').addEventListener('click', function () {
    var mode = document.querySelector('input[name=edit-mode]:checked').value;
    if (mode === 'hider') config.hiderSpawns.pop();
    else if (mode === 'seeker') config.seekerSpawns.pop();
    else if (mode === 'zone') config.zones.pop();
    draw();
  });
  document.getElementById('btn-clear-zones').addEventListener('click', function () {
    if (!confirm('Clear all zones and spawns?')) return;
    config.zones = []; config.hiderSpawns = []; config.seekerSpawns = [];
    draw();
  });

  draw();
})();
</script>

<?php require __DIR__ . '/includes/footer.php'; ?>
