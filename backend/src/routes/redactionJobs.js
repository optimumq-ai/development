// Redaction workspace API: one job per file, zones (boxes linked to a rule), and apply.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');
const docProcessing = require('../services/docProcessing');
const redactionApply = require('../services/redactionApply');

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
    res.json(Object.assign({ success: true }, r));
  } catch (e) { console.error('[zone discover]', e.message); res.status(500).json({ error: e.message }); }
});

// POST /jobs/:jobId/apply -> burn redactions, produce released PDF + documentation sheet
router.post('/jobs/:jobId/apply', requireAuth, async function(req, res) {
  var job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [req.params.jobId]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  try {
    var result = await redactionApply.applyRedaction(req.params.jobId, req.user.name || 'Staff');
    await run("UPDATE redaction_jobs SET review_stage = 'released', reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [req.user.name || req.user.sub, req.params.jobId]);
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
  res.json({ success: true, review_stage: 'pending_review' });
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

// Send a job back to editing (reviewer returns it to the redactor).
router.post('/jobs/:jobId/return', requireAuth, async function(req, res) {
  var job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [req.params.jobId]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  await run("UPDATE redaction_jobs SET review_stage = 'editing', updated_at = datetime('now') WHERE id = ?", [req.params.jobId]);
  res.json({ success: true, review_stage: 'editing' });
});

// GET /released -> the Fulfilled Request Index (Released Records Library)
router.get('/released', requireAuth, async function(req, res) {
  var rows = await all("SELECT fr.id, fr.title, fr.summary, fr.public_availability, fr.page_count, fr.released_at, fr.output_file_id, rt.name AS record_type_name, d.name AS department_name FROM fulfilled_records fr LEFT JOIN record_types rt ON rt.id = fr.record_type_id LEFT JOIN departments d ON d.id = fr.department_id WHERE fr.status = 'released' ORDER BY fr.released_at DESC");
  res.json({ records: rows });
});

module.exports = router;
