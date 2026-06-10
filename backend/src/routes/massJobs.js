// Mass-redaction job queue API. A job points a template at a list of files and lets the background
// worker grind through them a chunk per night until complete. Create / monitor / pause / resume /
// cancel, plus run-now (force one chunk immediately, ignoring the after-hours window) for urgent jobs.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');
const worker = require('../services/massJobs');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
async function getConfig(key, def) { var r = await get("SELECT value FROM system_config WHERE key = ?", [key]); return (r && r.value != null) ? r.value : def; }

// Settings the UI shows when composing a job (defaults + shared nightly budget).
router.get('/config', requireAuth, async function (req, res) {
  res.json({
    nightly_budget: parseInt(await getConfig('mass_redaction_nightly_budget', '500'), 10) || 500,
    window_start: await getConfig('mass_redaction_window_start', '18:00'),
    window_end: await getConfig('mass_redaction_window_end', '06:00'),
    after_hours_only: (await getConfig('mass_redaction_after_hours_only', 'true')) === 'true'
  });
});

function withEta(job, budget) {
  var remaining = Math.max(0, job.total_items - job.processed_items);
  var effChunk = Math.max(1, Math.min(job.chunk_size || 500, budget || 500));
  var nights = remaining > 0 ? Math.ceil(remaining / effChunk) : 0;
  var est = null;
  if (nights > 0) { var d = new Date(); d.setDate(d.getDate() + nights); est = d.toISOString().slice(0, 10); }
  job.remaining_items = remaining;
  job.nights_remaining = nights;
  job.est_completion = est;
  job.pct = job.total_items ? Math.round((job.processed_items / job.total_items) * 100) : 0;
  try { job.error_log = JSON.parse(job.error_log || '[]'); } catch (e) { job.error_log = []; }
  return job;
}

router.get('/', requireAuth, async function (req, res) {
  var budget = parseInt(await getConfig('mass_redaction_nightly_budget', '500'), 10) || 500;
  var rows = await all("SELECT * FROM mass_redaction_jobs ORDER BY (status IN ('running','queued')) DESC, priority ASC, created_at DESC");
  res.json(rows.map(function (j) { return withEta(j, budget); }));
});

router.get('/:id', requireAuth, async function (req, res) {
  var budget = parseInt(await getConfig('mass_redaction_nightly_budget', '500'), 10) || 500;
  var job = await get("SELECT * FROM mass_redaction_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(withEta(job, budget));
});

router.post('/', requireAuth, async function (req, res) {
  var b = req.body || {};
  if (!b.template_id) return res.status(400).json({ error: 'template_id required' });
  var fileIds = Array.isArray(b.file_ids) ? b.file_ids.filter(Boolean) : [];
  if (!fileIds.length) return res.status(400).json({ error: 'file_ids required' });
  var t = await get("SELECT id, kind FROM layout_profiles WHERE id = ?", [b.template_id]);
  if (!t) return res.status(404).json({ error: 'template not found' });
  var id = uuidv4();
  await run(
    "INSERT INTO mass_redaction_jobs (id, name, template_id, kind, file_ids, total_items, chunk_size, window_start, window_end, priority, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'queued', ?, ?, ?)",
    [id, b.name || 'Untitled batch', t.id, t.kind || 'pages', JSON.stringify(fileIds), fileIds.length,
     b.chunk_size || 500, b.window_start || '18:00', b.window_end || '06:00', b.priority != null ? b.priority : 100,
     req.user.name || req.user.sub, nowStr(), nowStr()]);
  var budget = parseInt(await getConfig('mass_redaction_nightly_budget', '500'), 10) || 500;
  res.json(withEta(await get("SELECT * FROM mass_redaction_jobs WHERE id = ?", [id]), budget));
});

async function setStatus(req, res, status, fromStatuses) {
  var job = await get("SELECT * FROM mass_redaction_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (fromStatuses && fromStatuses.indexOf(job.status) < 0) return res.status(400).json({ error: 'cannot ' + status + ' a ' + job.status + ' job' });
  await run("UPDATE mass_redaction_jobs SET status = ?, updated_at = ? WHERE id = ?", [status, nowStr(), req.params.id]);
  res.json({ ok: true, status: status });
}
router.post('/:id/pause', requireAuth, function (req, res) { setStatus(req, res, 'paused', ['queued', 'running']); });
router.post('/:id/resume', requireAuth, function (req, res) { setStatus(req, res, 'queued', ['paused']); });
router.post('/:id/cancel', requireAuth, function (req, res) { setStatus(req, res, 'canceled', ['queued', 'running', 'paused']); });

// Force one chunk now (ignores the after-hours window; still counts against the shared nightly budget).
router.post('/:id/run-now', requireAuth, async function (req, res) {
  var job = await get("SELECT * FROM mass_redaction_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (['completed', 'canceled'].indexOf(job.status) >= 0) return res.status(400).json({ error: 'job is ' + job.status });
  var out = await worker.tick({ force: true, jobId: req.params.id, actor: req.user.name, actorSub: req.user.sub });
  var budget = parseInt(await getConfig('mass_redaction_nightly_budget', '500'), 10) || 500;
  res.json({ result: out, job: withEta(await get("SELECT * FROM mass_redaction_jobs WHERE id = ?", [req.params.id]), budget) });
});

module.exports = router;
