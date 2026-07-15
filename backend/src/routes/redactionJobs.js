// Redaction workspace API: one job per file, zones (boxes linked to a rule), and apply.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');
const docProcessing = require('../services/docProcessing');
const redactionApply = require('../services/redactionApply');
const redactionReview = require('../services/redactionReview');

async function activeJurisdiction() {
  var row = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  return (row && row.value) || 'jur-tx';
}

async function pagesPayload(fileId) {
  var rows = await all('SELECT id, page_no, width, height, image_width, image_height FROM document_pages WHERE file_id = ? ORDER BY page_no', [fileId]);
  return rows.map(function(r){ return { id: r.id, page_no: r.page_no, width: r.width, height: r.height, image_width: r.image_width, image_height: r.image_height, image_url: '/api/files/page-image/' + r.id }; });
}

// POST /file/:fileId/job -> ensure processed, create or return the draft job, with pages + zones
router.post('/file/:fileId/job', requireAuth, async function(req, res) {
  var fileId = req.params.fileId;
  var file = await get('SELECT * FROM request_files WHERE id = ?', [fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  try {
    var pageCount = await get('SELECT count(*) AS c FROM document_pages WHERE file_id = ?', [fileId]);
    if (!pageCount || !pageCount.c) { await docProcessing.processFile(fileId); }
  } catch (e) { return res.status(500).json({ error: 'Could not process document: ' + e.message }); }

  var job = await get("SELECT * FROM redaction_jobs WHERE file_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1", [fileId]);
  if (!job) {
    var jobId = uuidv4();
    await run('INSERT INTO redaction_jobs (id, file_id, request_id, jurisdiction_id, status, created_by) VALUES (?,?,?,?,?,?)',
      [jobId, fileId, file.request_id, await activeJurisdiction(), 'draft', req.user.sub]);
    job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [jobId]);
  }
  var zones = await all('SELECT * FROM redaction_zones WHERE job_id = ? ORDER BY page_no', [job.id]);
  res.json({ job: job, pages: await pagesPayload(fileId), zones: zones });
});

// POST /jobs/:jobId/zones -> add a zone
router.post('/jobs/:jobId/zones', requireAuth, async function(req, res) {
  var job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [req.params.jobId]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  var b = req.body || {};
  if (b.page_no == null || b.x == null || b.y == null || b.w == null || b.h == null) return res.status(400).json({ error: 'page_no and x/y/w/h are required' });
  var id = uuidv4();
  await run('INSERT INTO redaction_zones (id, job_id, file_id, page_no, x, y, w, h, rule_id, note, zone_type, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, job.id, job.file_id, b.page_no, b.x, b.y, b.w, b.h, b.rule_id || null, b.note || null, b.zone_type || 'manual', req.user.sub]);
  res.json({ success: true, zone: await get('SELECT * FROM redaction_zones WHERE id = ?', [id]) });
});

// PATCH /zones/:zoneId -> change attached rule / note
router.patch('/zones/:zoneId', requireAuth, async function(req, res) {
  var z = await get('SELECT * FROM redaction_zones WHERE id = ?', [req.params.zoneId]);
  if (!z) return res.status(404).json({ error: 'Zone not found' });
  var b = req.body || {};
  var sets = [], params = [];
  if (b.rule_id !== undefined) { sets.push('rule_id = ?'); params.push(b.rule_id || null); }
  if (b.note !== undefined) { sets.push('note = ?'); params.push(b.note || null); }
  if (b.review_state !== undefined) { var rv = b.review_state; if (['proposed','approved','rejected'].indexOf(rv) < 0) rv = null; sets.push('review_state = ?'); params.push(rv); }
  ['x', 'y', 'w', 'h'].forEach(function (k) { if (b[k] !== undefined && b[k] !== null && !isNaN(b[k])) { sets.push(k + ' = ?'); params.push(Number(b[k])); } });
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  params.push(req.params.zoneId);
  await run('UPDATE redaction_zones SET ' + sets.join(', ') + ' WHERE id = ?', params);
  res.json({ success: true });
});

// DELETE /zones/:zoneId
router.delete('/zones/:zoneId', requireAuth, async function(req, res) {
  await run('DELETE FROM redaction_zones WHERE id = ?', [req.params.zoneId]);
  res.json({ success: true });
});

// POST /suggest-rule -> given a field description, AI picks the best rule from the library
router.post('/suggest-rule', requireAuth, async function(req, res) {
  try {
    var zd = require('../services/zoneDiscovery');
    var r = await zd.suggestRule(req.body && req.body.label);
    res.json(r);
  } catch (e) { console.error('[suggest-rule]', e.message); res.status(500).json({ error: e.message }); }
});

// POST /file/:fileId/discover -> AI suggests redaction boxes from document content (ephemeral)
router.post('/file/:fileId/discover', requireAuth, async function(req, res) {
  var file = await get('SELECT * FROM request_files WHERE id = ?', [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  try {
    var pc = await get('SELECT count(*) AS c FROM document_pages WHERE file_id = ?', [req.params.fileId]);
    if (!pc || !pc.c) await docProcessing.processFile(req.params.fileId);
    var zoneDiscovery = require('../services/zoneDiscovery');
    var r = await zoneDiscovery.discoverZones(req.params.fileId);
    // Mark discovery as run for this job so the entry-contract gate never auto-re-scans (Slice A).
    try { await run("UPDATE redaction_jobs SET discovered_at = datetime('now') WHERE file_id = ? AND status = 'draft' AND discovered_at IS NULL", [req.params.fileId]); } catch (e2) {}
    res.json(Object.assign({ success: true }, r));
  } catch (e) { console.error('[zone discover]', e.message); res.status(500).json({ error: e.message }); }
});

// POST /jobs/:jobId/apply -> burn redactions, produce released PDF + documentation sheet
router.post('/jobs/:jobId/apply', requireAuth, async function(req, res) {
  var job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [req.params.jobId]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  // Slice 4: Elevated/Legal jobs require a second-person review before release (author cannot self-release).
  var gate = redactionReview.gateApply(job, req.user.name || req.user.sub);
  if (!gate.allowed) return res.status(gate.code).json({ error: gate.reason });
  try {
    var result = await redactionApply.applyRedaction(req.params.jobId, req.user.name || 'Staff');
    await run("UPDATE redaction_jobs SET review_stage = 'released', reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [req.user.name || req.user.sub, req.params.jobId]);
    await redactionReview.completeReviewTask(job.request_id); // reviewer approved & released -> close the review task
    res.json(Object.assign({ success: true }, result));
  } catch (e) {
    console.error('[redaction apply]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Submit a job for review (redactor hands off to an approver/legal).
router.post('/jobs/:jobId/submit', requireAuth, async function(req, res) {
  var job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [req.params.jobId]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  await run("UPDATE redaction_jobs SET review_stage = 'pending_review', submitted_by = ?, submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [req.user.name || req.user.sub, req.params.jobId]);
  // Slice 4: for an Elevated/Legal job, spawn a routed redaction_qa task so a different reviewer is tasked.
  var reviewTask = await redactionReview.spawnReviewTask(Object.assign({}, job, { submitted_by: req.user.name || req.user.sub }), { actor: req.user.name || req.user.sub });
  // Re-submitting corrected work clears any "returned for corrections" flag on the author's task (R10, 8b).
  try {
    var tr = require('../services/taskRouting');
    var authTask = await get("SELECT id FROM tasks WHERE request_id = ? AND type IN ('redaction','legal_redaction') AND status IN ('open','assigned','in_progress') AND return_reason IS NOT NULL ORDER BY updated_at DESC LIMIT 1", [job.request_id]);
    if (authTask) await tr.clearReturned(authTask.id);
  } catch (e) { console.error('[redaction submit -> clearReturned]', e && e.message); }
  res.json({ success: true, review_stage: 'pending_review', reviewTask: reviewTask ? reviewTask.id : null });
});

// Begin review (reviewer opens a submitted doc -> moves Awaiting review to Review in process).
router.post('/jobs/:jobId/begin-review', requireAuth, async function(req, res) {
  var job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [req.params.jobId]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.review_stage === 'pending_review') {
    await run("UPDATE redaction_jobs SET review_stage = 'in_review', reviewed_by = ?, updated_at = datetime('now') WHERE id = ?", [req.user.name || req.user.sub, req.params.jobId]);
    return res.json({ success: true, review_stage: 'in_review' });
  }
  res.json({ success: true, review_stage: job.review_stage });
});

// Send a job back to editing (reviewer returns it to the redactor). A reason is required: the author
// only learns what to fix from it, so it is recorded on the request's history.
router.post('/jobs/:jobId/return', requireAuth, async function(req, res) {
  var job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [req.params.jobId]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  var note = (req.body && req.body.note ? String(req.body.note) : '').trim();
  if (!note) return res.status(400).json({ error: 'Say what needs to change before returning this redaction to the author.' });
  var reviewer = req.user.name || req.user.sub;
  await run("UPDATE redaction_jobs SET review_stage = 'editing', updated_at = datetime('now') WHERE id = ?", [req.params.jobId]);
  var file = await get('SELECT original_name FROM request_files WHERE id = ?', [job.file_id]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
    [uuidv4(), job.request_id, req.user.sub || null, reviewer, 'REDACTION_RETURNED',
     'Returned to ' + (job.submitted_by || 'the author') + ' for rework — ' + ((file && file.original_name) || 'document') + ': ' + note]);
  await redactionReview.closeReviewTask(job.request_id); // reviewer returned it -> cancel the review task
  // Surface the return to the AUTHOR (R10, 8b): flag their still-open redaction task "URGENT CORRECTIONS
  // REQUIRED" + push a notification, so they aren't left staring at a task that looks unchanged.
  try {
    var tr = require('../services/taskRouting');
    var authTask = await get("SELECT id FROM tasks WHERE request_id = ? AND type IN ('redaction','legal_redaction') AND status IN ('open','assigned','in_progress') ORDER BY updated_at DESC LIMIT 1", [job.request_id]);
    if (authTask) await tr.markTaskReturned(authTask.id, { by: reviewer, reason: note, link: '/redaction/' + authTask.id, title: 'A redaction you submitted was returned' });
  } catch (e) { console.error('[redaction return -> markTaskReturned]', e && e.message); }
  res.json({ success: true, review_stage: 'editing', note: note });
});

// GET /released -> the Fulfilled Request Index (Released Records Library)
router.get('/released', requireAuth, async function(req, res) {
  var rows = await all("SELECT fr.id, fr.title, fr.summary, fr.public_availability, fr.page_count, fr.released_at, fr.output_file_id, COALESCE(fr.published,0) AS published, rt.name AS record_type_name, rt.auto_publish AS rt_auto_publish, d.name AS department_name FROM fulfilled_records fr LEFT JOIN record_types rt ON rt.id = fr.record_type_id LEFT JOIN departments d ON d.id = fr.department_id WHERE fr.status = 'released' ORDER BY fr.released_at DESC");
  res.json({ records: rows });
});

// Toggle whether a released record is PUBLISHED to the open public library (searchable/browsable).
// Independent of delivery to the requestor - unpublishing removes it from public discovery only.
router.post('/released/:id/publish', requireAuth, async function(req, res) {
  try {
    var pub = (req.body && req.body.published) ? 1 : 0;
    var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'staff';
    await run("UPDATE fulfilled_records SET published = ?, published_at = CASE WHEN ? = 1 THEN datetime('now') ELSE published_at END, published_by = ? WHERE id = ?", [pub, pub, actor, req.params.id]);
    res.json({ id: req.params.id, published: !!pub });
  } catch (e) { res.status(500).json({ error: 'Could not update publication.' }); }
});

module.exports = router;
