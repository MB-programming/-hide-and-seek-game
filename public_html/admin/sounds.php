<?php
/**
 * sounds.php — upload sound effects and assign them to game events,
 * either globally or for one specific stage (overrides the global default
 * for that stage — see api/get-config.php for how the frontend resolves
 * which file actually plays).
 */
require_once __DIR__ . '/includes/auth.php';
require_login();

$EVENTS = ['round_start', 'painting_end', 'seeker_released', 'catch', 'round_over', 'victory', 'defeat', 'ambient'];
$flash = null;

function upload_sound_file($file) {
    if (!isset($file) || $file['error'] === UPLOAD_ERR_NO_FILE) throw new Exception('Please choose a sound file.');
    if ($file['error'] !== UPLOAD_ERR_OK) throw new Exception('Upload failed (code ' . $file['error'] . ').');
    $allowed = ['mp3' => true, 'ogg' => true, 'wav' => true, 'm4a' => true];
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!isset($allowed[$ext])) throw new Exception('Only mp3/ogg/wav/m4a files are allowed.');
    $name = 'sfx_' . bin2hex(random_bytes(6)) . '.' . $ext;
    $destDir = PUBLIC_HTML_PATH . SFX_UPLOAD_REL;
    if (!is_dir($destDir)) mkdir($destDir, 0755, true);
    move_uploaded_file($file['tmp_name'], $destDir . $name);
    return SFX_UPLOAD_REL . $name;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = $_POST['action'] ?? '';
    try {
        if ($action === 'upload') {
            $eventKey = $_POST['event_key'] ?? '';
            if (!in_array($eventKey, $EVENTS, true)) throw new Exception('Invalid event.');
            $stageId = ($_POST['stage_id'] ?? '') !== '' ? (int) $_POST['stage_id'] : null;
            $path = upload_sound_file($_FILES['sound_file'] ?? null);
            $label = trim($_POST['label'] ?? '') ?: null;
            db()->prepare('INSERT INTO sounds (event_key, stage_id, file_path, label) VALUES (?,?,?,?)')
                ->execute([$eventKey, $stageId, $path, $label]);
            $flash = ['ok', 'Sound uploaded and assigned.'];
        } elseif ($action === 'delete') {
            db()->prepare('DELETE FROM sounds WHERE id = ?')->execute([(int) $_POST['id']]);
            $flash = ['ok', 'Sound removed.'];
        }
    } catch (Exception $e) {
        $flash = ['err', $e->getMessage()];
    }
}

$stages = db()->query('SELECT id, name FROM stages ORDER BY sort_order, id')->fetchAll();
$sounds = db()->query('
    SELECT sounds.*, stages.name AS stage_name
    FROM sounds LEFT JOIN stages ON stages.id = sounds.stage_id
    ORDER BY event_key, stage_id IS NULL DESC
')->fetchAll();

$pageTitle = 'Sounds';
$activeNav = 'sounds';
require __DIR__ . '/includes/header.php';
?>
<h1>Sounds</h1>
<?php if ($flash): ?><div class="flash <?= $flash[0] ?>"><?= htmlspecialchars($flash[1]) ?></div><?php endif; ?>

<div class="card">
  <h2>Upload / Assign Sound</h2>
  <form method="post" enctype="multipart/form-data">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="upload">
    <label>Event</label>
    <select name="event_key" required>
      <?php foreach ($EVENTS as $ev): ?><option value="<?= $ev ?>"><?= $ev ?></option><?php endforeach; ?>
    </select>
    <label>Stage (leave as "Global" to use for every stage that has no specific override)</label>
    <select name="stage_id">
      <option value="">Global (all stages)</option>
      <?php foreach ($stages as $s): ?><option value="<?= (int)$s['id'] ?>"><?= htmlspecialchars($s['name']) ?></option><?php endforeach; ?>
    </select>
    <label>Sound file (mp3/ogg/wav/m4a)</label>
    <input type="file" name="sound_file" accept="audio/*" required>
    <label>Label (optional, for your own reference)</label>
    <input type="text" name="label">
    <p><button type="submit" class="btn">Upload</button></p>
  </form>
</div>

<div class="card">
  <h2>Assigned Sounds</h2>
  <table>
    <tr><th>Event</th><th>Scope</th><th>File</th><th>Label</th><th></th></tr>
    <?php foreach ($sounds as $s): ?>
    <tr>
      <td><?= htmlspecialchars($s['event_key']) ?></td>
      <td><?= $s['stage_name'] ? htmlspecialchars($s['stage_name']) : '<span class="badge">Global</span>' ?></td>
      <td><audio controls preload="none" src="..<?= htmlspecialchars($s['file_path']) ?>" style="height:28px"></audio></td>
      <td><?= htmlspecialchars($s['label'] ?? '') ?></td>
      <td>
        <form method="post" onsubmit="return confirm('Remove this sound assignment?');">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="delete">
          <input type="hidden" name="id" value="<?= (int)$s['id'] ?>">
          <button type="submit" class="btn danger" style="padding:4px 10px;font-size:0.8rem;">Remove</button>
        </form>
      </td>
    </tr>
    <?php endforeach; ?>
    <?php if (!$sounds): ?><tr><td colspan="5" class="muted">No sounds uploaded yet — the game will simply play silently until you add some.</td></tr><?php endif; ?>
  </table>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
