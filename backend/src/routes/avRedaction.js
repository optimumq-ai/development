const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const avApply = require('../services/avRedactionApply');

const UPLOAD_DIR = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: function(req, file, cb) { cb(null, UPLOAD_DIR); },
  filename: function(req, file, cb) {
    cb(null, uuidv4() + path.extname(file.originalname || ''));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

// GET tasks + candidate files + configured mode for a request
router.get('/request/:requestId', requireAuth, async function(req, res) {
  var requestId = req.params.requestId;
  var tasks = await all(
    'SELECT t.*, ofile.original_name AS original_name, rfile.original_name AS redacted_name ' +
    'FROM av_redaction_tasks t ' +
    'LEFT JOIN request_files ofile ON ofile.id = t.original_file_id ' +
    'LEFT JOIN request_files rfile ON rfile.id = t.redacted_file_id ' +
    'WHERE t.request_id = ? ORDER BY t.started_at DESC', [requestId]);
  var files = await all('SELECT id, original_name, mimetype, size, status, uploaded_at FROM request_files WHERE request_id = ? ORDER BY uploaded_at DESC', [requestId]);
  var modeRow = await get("SELECT value FROM system_config WHERE key = 'av_redaction_mode'", []);
  var heldCount = 0;
  for (var i = 0; i < tasks.length; i++) { if (tasks[i].status === 'out') heldCount++; }
  res.json({ tasks: tasks, files: files, mode: (modeRow ? modeRow.value : 'internal'), held: heldCount > 0 });
});

// POST start: send a file out for external redaction (creates a hold)
router.post('/request/:requestId/start', requireAuth, async function(req, res) {
  var requestId = req.params.requestId;
  var originalFileId = (req.body && req.body.original_file_id) || null;
  var note = (req.body && req.body.note) || null;
  var request = await get('SELECT id FROM requests WHERE id = ?', [requestId]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (originalFileId) {
    var f = await get('SELECT id FROM request_files WHERE id = ? AND request_id = ?', [originalFileId, requestId]);
    if (!f) return res.status(400).json({ error: 'Original file not found on this request' });
    var existing = await get("SELECT id FROM av_redaction_tasks WHERE request_id = ? AND original_file_id = ? AND status = 'out'", [requestId, originalFileId]);
    if (existing) return res.status(409).json({ error: 'This file is already out for redaction' });
  }
  var taskId = uuidv4();
  await run("INSERT INTO av_redaction_tasks (id, request_id, original_file_id, mode, status, note, started_by, started_at) VALUES (?, ?, ?, 'external', 'out', ?, ?, datetime('now'))",
    [taskId, requestId, originalFileId, note, req.user.sub]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), requestId, req.user.sub, req.user.name || 'Staff', 'AV_REDACTION_SENT_OUT', 'Sent media out for external redaction']);
  var task = await get('SELECT * FROM av_redaction_tasks WHERE id = ?', [taskId]);
  res.json({ success: true, task: task });
});

// POST checkin: upload redacted file + attest, clears the hold
router.post('/task/:taskId/checkin', requireAuth, upload.single('file'), async function(req, res) {
  var taskId = req.params.taskId;
  var task = await get('SELECT * FROM av_redaction_tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!req.file) return res.status(400).json({ error: 'No redacted file uploaded' });
  var attested = (req.body && (req.body.attested === '1' || req.body.attested === 'true' || req.body.attested === true)) ? 1 : 0;
  if (!attested) return res.status(400).json({ error: 'Attestation is required to check in a redacted file' });

  var fileId = uuidv4();
  await run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, 'redacted', ?, datetime('now'))",
    [fileId, task.request_id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.sub]);
  await run("UPDATE av_redaction_tasks SET redacted_file_id = ?, status = 'checked_in', attested = 1, checked_in_by = ?, checked_in_at = datetime('now') WHERE id = ?",
    [fileId, req.user.sub, taskId]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), task.request_id, req.user.sub, req.user.name || 'Staff', 'AV_REDACTION_CHECKED_IN', 'Checked in externally redacted media (attested): ' + req.file.originalname]);
  var updated = await get('SELECT * FROM av_redaction_tasks WHERE id = ?', [taskId]);
  res.json({ success: true, task: updated, fileId: fileId });
});

// POST cancel: remove an out task (sent by mistake)
router.post('/task/:taskId/cancel', requireAuth, async function(req, res) {
  var task = await get('SELECT * FROM av_redaction_tasks WHERE id = ?', [req.params.taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'out') return res.status(400).json({ error: 'Only an open task can be cancelled' });
  await run('DELETE FROM av_redaction_tasks WHERE id = ?', [req.params.taskId]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), task.request_id, req.user.sub, req.user.name || 'Staff', 'AV_REDACTION_CANCELLED', 'Cancelled external redaction send-out']);
  res.json({ success: true });
});

// POST apply-internal: run the in-system burn on a stored original, store redacted copy
router.post('/request/:requestId/apply-internal', requireAuth, async function(req, res) {
  var requestId = req.params.requestId;
  var originalFileId = req.body && req.body.original_file_id;
  var zones = (req.body && req.body.zones) || {};
  if (!originalFileId) return res.status(400).json({ error: 'original_file_id is required' });
  var request = await get('SELECT id FROM requests WHERE id = ?', [requestId]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var orig = await get('SELECT * FROM request_files WHERE id = ? AND request_id = ?', [originalFileId, requestId]);
  if (!orig) return res.status(400).json({ error: 'Original file not found on this request' });
  var inputPath = path.join(UPLOAD_DIR, orig.filename);
  if (!fs.existsSync(inputPath)) return res.status(400).json({ error: 'Original file is missing on disk' });
  var outName = uuidv4() + '.mp4';
  var outputPath = path.join(UPLOAD_DIR, outName);
  try {
    var result = await avApply.apply({ inputPath: inputPath, outputPath: outputPath, zones: zones });
    var stat = fs.statSync(outputPath);
    var baseName = (orig.original_name || 'media').replace(/\.[^.]+$/, '');
    var redactedName = baseName + ' (redacted).mp4';
    var fileId = uuidv4();
    await run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, 'video/mp4', ?, 'redacted', ?, datetime('now'))",
      [fileId, requestId, outName, redactedName, stat.size, req.user.sub]);
    var taskId = uuidv4();
    await run("INSERT INTO av_redaction_tasks (id, request_id, original_file_id, mode, status, redacted_file_id, attested, zones_json, started_by, started_at, checked_in_by, checked_in_at) VALUES (?, ?, ?, 'internal', 'checked_in', ?, 1, ?, ?, datetime('now'), ?, datetime('now'))",
      [taskId, requestId, originalFileId, fileId, JSON.stringify(zones), req.user.sub, req.user.sub]);
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), requestId, req.user.sub, req.user.name || 'Staff', 'AV_REDACTION_APPLIED', 'Applied in-system redaction (' + (result.videoCount||0) + ' video, ' + (result.audioCount||0) + ' audio zones): ' + redactedName]);
    var task = await get('SELECT * FROM av_redaction_tasks WHERE id = ?', [taskId]);
    res.json({ success: true, task: task, fileId: fileId, result: result });
  } catch (e) {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (ignore) {}
    res.status(500).json({ error: 'Redaction failed: ' + e.message });
  }
});

// POST release-as-is: reviewer confirms media is releasable without redaction (not_required path)
router.post('/request/:requestId/release-as-is', requireAuth, async function(req, res) {
  var requestId = req.params.requestId;
  var originalFileId = (req.body && req.body.original_file_id) || null;
  var note = (req.body && req.body.note) || null;
  var attested = (req.body && (req.body.attested === true || req.body.attested === '1' || req.body.attested === 'true')) ? 1 : 0;
  if (!attested) return res.status(400).json({ error: 'Attestation is required to release without redaction' });
  var request = await get('SELECT id FROM requests WHERE id = ?', [requestId]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var taskId = uuidv4();
  await run("INSERT INTO av_redaction_tasks (id, request_id, original_file_id, mode, status, attested, note, started_by, started_at, checked_in_by, checked_in_at) VALUES (?, ?, ?, 'not_required', 'checked_in', 1, ?, ?, datetime('now'), ?, datetime('now'))",
    [taskId, requestId, originalFileId, note, req.user.sub, req.user.sub]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), requestId, req.user.sub, req.user.name || 'Staff', 'AV_RELEASED_AS_IS', 'Confirmed media releasable without redaction (attested)' + (note ? (': ' + note) : '')]);
  var task = await get('SELECT * FROM av_redaction_tasks WHERE id = ?', [taskId]);
  res.json({ success: true, task: task });
});

module.exports = router;
