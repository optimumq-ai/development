// Redaction Templates (the reusable "definition" authored in the Mass Redaction Tool).
// A template lives in layout_profiles: named, optionally tied to a record type, with zones
// (normalized boxes + the rule each cites) and a layout fingerprint. The SAME template is
// consumed two ways: batch processing, and on-demand when a request pulls a not-yet-public record.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');
const docProcessing = require('../services/docProcessing');
const redactionApply = require('../services/redactionApply');

var ELEVATED = ['SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN', 'DEPT_MANAGER'];
function isElevated(req) { return (req.user.roles || []).some(function(r){ return ELEVATED.indexOf(r) >= 0; }); }
async function activeJurisdiction() {
  var row = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  return (row && row.value) || 'jur-tx';
}
function parseZones(t) { try { return JSON.parse(t.zones || '[]'); } catch (e) { return []; } }

// Tokenize text into the set of "structural" words (labels/captions), dropping pure numbers
// (which are the variable filled-in values), so the fingerprint reflects the FORM, not the data.
function tokenize(text) {
  var set = {};
  (text || '').toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) {
    if (w.length >= 3 && w.length <= 24 && /[a-z]/.test(w)) set[w] = 1;
  });
  return set;
}
// Layout fingerprint = the form's static vocabulary + page count, stored as JSON so two docs can be compared.
async function buildFingerprint(fileId) {
  if (!fileId) return null;
  var file = await get('SELECT original_name, filename FROM request_files WHERE id = ?', [fileId]);
  var pages = await all('SELECT text FROM document_pages WHERE file_id = ? ORDER BY page_no', [fileId]);
  var set = {};
  pages.forEach(function (p) { var t = tokenize(p.text); for (var k in t) set[k] = 1; });
  var name = file ? (file.original_name || file.filename) : 'document';
  return JSON.stringify({ v: 1, name: name, pages: pages.length, tokens: Object.keys(set).sort().slice(0, 600) });
}
function tokensFromFingerprint(fp) {
  if (!fp) return {};
  try { var o = JSON.parse(fp); if (o && Array.isArray(o.tokens)) { var s = {}; o.tokens.forEach(function (t) { s[t] = 1; }); return s; } } catch (e) {}
  return tokenize(fp); // old plain-text fingerprint
}
function fpPages(fp) { try { var o = JSON.parse(fp); return (o && o.pages) || null; } catch (e) { return null; } }
async function fileTokens(fileId) {
  var pages = await all('SELECT text FROM document_pages WHERE file_id = ? ORDER BY page_no', [fileId]);
  var set = {};
  pages.forEach(function (p) { var t = tokenize(p.text); for (var k in t) set[k] = 1; });
  return { tokens: set, pages: pages.length };
}
// Safety score 0-100 = what fraction of the template form's vocabulary appears in the target doc.
// Same-form docs score high; a different form scores low (so we don't redact blind coordinates onto it).
async function safetyScore(template, fileId) {
  var tt = tokensFromFingerprint(template.layout_fingerprint);
  var keys = Object.keys(tt);
  var ft = await fileTokens(fileId);
  if (!keys.length) return { score: null, file_pages: ft.pages, template_pages: fpPages(template.layout_fingerprint), matched: 0, template_terms: 0 };
  var inter = 0; keys.forEach(function (k) { if (ft.tokens[k]) inter++; });
  return { score: Math.round(100 * inter / keys.length), file_pages: ft.pages, template_pages: fpPages(template.layout_fingerprint), matched: inter, template_terms: keys.length };
}
// Apply a template's zones to one file -> released redacted copy (shared by single + batch apply).
async function applyTemplateToFile(t, file, zones, actorName, actorSub) {
  var pc = await get('SELECT count(*) AS c FROM document_pages WHERE file_id = ?', [file.id]);
  if (!pc || !pc.c) await docProcessing.processFile(file.id);
  var jobId = uuidv4();
  var jur = await activeJurisdiction();
  await run('INSERT INTO redaction_jobs (id, file_id, request_id, jurisdiction_id, status, created_by) VALUES (?,?,?,?,?,?)',
    [jobId, file.id, file.request_id, jur, 'draft', actorSub]);
  for (var i = 0; i < zones.length; i++) {
    var z = zones[i];
    await run('INSERT INTO redaction_zones (id, job_id, file_id, page_no, x, y, w, h, rule_id, note, zone_type, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [uuidv4(), jobId, file.id, z.page_no || 1, z.x, z.y, z.w, z.h, z.rule_id || null, z.label || null, 'template', actorSub]);
  }
  var result = await redactionApply.applyRedaction(jobId, actorName);
  return Object.assign({ jobId: jobId }, result);
}

// POST / -> create a template from zones (elevated)
router.post('/', requireAuth, async function(req, res) {
  if (!isElevated(req)) return res.status(403).json({ error: 'Only a supervisor can create templates' });
  var b = req.body || {};
  if (!b.name || !Array.isArray(b.zones) || !b.zones.length) return res.status(400).json({ error: 'name and at least one zone are required' });
  var zones = b.zones.map(function(z){ return { page_no: z.page_no || 1, x: z.x, y: z.y, w: z.w, h: z.h, rule_id: z.rule_id || null, label: z.label || null }; });
  var srcFile = b.source_file_id ? await get('SELECT original_name, filename FROM request_files WHERE id = ?', [b.source_file_id]) : null;
  var id = uuidv4();
  await run('INSERT INTO layout_profiles (id, name, record_type_id, description, zones, source, status, source_file_id, source_filename, layout_fingerprint, safety_threshold, processing_manager_name, processing_manager_email, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))',
    [id, b.name, b.record_type_id || null, b.description || null, JSON.stringify(zones), 'manual', 'active',
     b.source_file_id || null, srcFile ? (srcFile.original_name || srcFile.filename) : null,
     await buildFingerprint(b.source_file_id), b.safety_threshold != null ? b.safety_threshold : 80,
     b.processing_manager_name || null, b.processing_manager_email || null, req.user.sub]);
  res.json({ success: true, template: await get('SELECT * FROM layout_profiles WHERE id = ?', [id]) });
});

// GET / -> list templates
router.get('/', requireAuth, async function(req, res) {
  var rows = await all("SELECT lp.*, rt.name AS record_type_name FROM layout_profiles lp LEFT JOIN record_types rt ON rt.id = lp.record_type_id WHERE lp.status != 'deleted' ORDER BY lp.created_at DESC");
  res.json({ templates: rows.map(function(t){ return { id: t.id, name: t.name, description: t.description, record_type_id: t.record_type_id, record_type_name: t.record_type_name, zone_count: parseZones(t).length, source_filename: t.source_filename, safety_threshold: t.safety_threshold, status: t.status, created_at: t.created_at }; }) });
});

// GET /:id -> full template incl zones
router.get('/:id', requireAuth, async function(req, res) {
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json({ template: Object.assign({}, t, { zones: parseZones(t) }) });
});

// PATCH /:id -> update (elevated)
router.patch('/:id', requireAuth, async function(req, res) {
  if (!isElevated(req)) return res.status(403).json({ error: 'Only a supervisor can edit templates' });
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  var b = req.body || {};
  var sets = [], params = [];
  ['name', 'description', 'record_type_id', 'status', 'processing_manager_name', 'processing_manager_email'].forEach(function(k){
    if (b[k] !== undefined) { sets.push(k + ' = ?'); params.push(b[k]); }
  });
  if (b.safety_threshold !== undefined) { sets.push('safety_threshold = ?'); params.push(b.safety_threshold); }
  if (Array.isArray(b.zones)) { sets.push('zones = ?'); params.push(JSON.stringify(b.zones)); }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push("updated_at = datetime('now')");
  params.push(req.params.id);
  await run('UPDATE layout_profiles SET ' + sets.join(', ') + ' WHERE id = ?', params);
  res.json({ success: true });
});

// DELETE /:id (soft delete; elevated)
router.delete('/:id', requireAuth, async function(req, res) {
  if (!isElevated(req)) return res.status(403).json({ error: 'Only a supervisor can delete templates' });
  await run("UPDATE layout_profiles SET status = 'deleted', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// POST /:id/apply -> apply this template to a document (the consume path). Body: { file_id }
router.post('/:id/apply', requireAuth, async function(req, res) {
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  var fileId = (req.body || {}).file_id;
  if (!fileId) return res.status(400).json({ error: 'file_id is required' });
  var file = await get('SELECT * FROM request_files WHERE id = ?', [fileId]);
  if (!file) return res.status(404).json({ error: 'Target file not found' });
  var zones = parseZones(t);
  if (!zones.length) return res.status(400).json({ error: 'Template has no zones' });
  try {
    var out = await applyTemplateToFile(t, file, zones, req.user.name || 'Mass Redaction', req.user.sub);
    res.json(Object.assign({ success: true, templateId: t.id }, out));
  } catch (e) {
    console.error('[template apply]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/candidates -> PDF files that could be batch-processed with this template
router.get('/:id/candidates', requireAuth, async function(req, res) {
  var rows = await all("SELECT rf.id, rf.original_name, rf.filename, rf.request_id, rf.status, r.description AS request_desc FROM request_files rf LEFT JOIN requests r ON r.id = rf.request_id WHERE (rf.mimetype = 'application/pdf' OR rf.filename ILIKE '%.pdf') AND COALESCE(rf.status,'') <> 'redacted' ORDER BY rf.original_name");
  res.json({ candidates: rows.map(function(f){ return { id: f.id, name: f.original_name || f.filename, request_id: f.request_id, request_desc: f.request_desc ? String(f.request_desc).slice(0, 70) : null, status: f.status }; }) });
});

// POST /:id/apply-batch -> safety check (commit:false) or process (commit:true) over many files. Body: { file_ids:[], commit }
router.post('/:id/apply-batch', requireAuth, async function(req, res) {
  if (!isElevated(req)) return res.status(403).json({ error: 'Only a supervisor can run batch redaction' });
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  var zones = parseZones(t);
  if (!zones.length) return res.status(400).json({ error: 'Template has no zones' });
  var b = req.body || {};
  var ids = Array.isArray(b.file_ids) ? b.file_ids : [];
  if (!ids.length) return res.status(400).json({ error: 'file_ids is required' });
  var commit = !!b.commit;
  var threshold = t.safety_threshold != null ? t.safety_threshold : 80;
  var results = [];
  for (var i = 0; i < ids.length; i++) {
    var fid = ids[i];
    var file = await get('SELECT * FROM request_files WHERE id = ?', [fid]);
    if (!file) { results.push({ file_id: fid, status: 'error', error: 'File not found' }); continue; }
    var nm = file.original_name || file.filename;
    try {
      var pc = await get('SELECT count(*) AS c FROM document_pages WHERE file_id = ?', [fid]);
      if (!pc || !pc.c) await docProcessing.processFile(fid);
      var s = await safetyScore(t, fid);
      var pass = s.score == null ? null : s.score >= threshold;
      if (!commit) {
        results.push({ file_id: fid, name: nm, status: 'checked', score: s.score, pass: pass, file_pages: s.file_pages, template_pages: s.template_pages });
        continue;
      }
      if (s.score != null && s.score < threshold) {
        results.push({ file_id: fid, name: nm, status: 'held', score: s.score, reason: 'Layout match ' + s.score + '% is below the ' + threshold + '% safety threshold' });
        continue;
      }
      var out = await applyTemplateToFile(t, file, zones, req.user.name || 'Mass Redaction', req.user.sub);
      results.push({ file_id: fid, name: nm, status: 'redacted', score: s.score, outputFileId: out.outputFileId, fileName: out.fileName, zoneCount: out.zoneCount, jobId: out.jobId });
    } catch (e) {
      results.push({ file_id: fid, name: nm, status: 'error', error: e.message });
    }
  }
  function count(st) { return results.filter(function(r){ return r.status === st; }).length; }
  var summary = { total: ids.length, redacted: count('redacted'), held: count('held'), errors: count('error'), passing: results.filter(function(r){ return r.pass === true; }).length };
  res.json({ success: true, template_id: t.id, threshold: threshold, committed: commit, results: results, summary: summary });
});

module.exports = router;
