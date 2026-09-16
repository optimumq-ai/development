// Redaction Templates (the reusable "definition" authored in the Mass Redaction Tool).
// A template lives in layout_profiles: named, optionally tied to a record type, with zones
// (normalized boxes + the rule each cites) and a layout fingerprint. The SAME template is
// consumed two ways: batch processing, and on-demand when a request pulls a not-yet-public record.
const express = require('express');
const router = express.Router();
// The templates library is a LIST screen (approval model, SPEC_setup_hub §3e) behind the hub's
// `layout_templates` row. Only the library's own CRUD reports a change — applying, staging, matching and
// batch-running a template is WORK, not setup, and must not touch the row. Best effort, after the response.
router.use(function (req, res, next) {
  var p = req.path || '';
  var crud = (req.method === 'POST' && p === '/') || ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/[^/]+$/.test(p));
  if (crud) {
    res.on('finish', function () { if (res.statusCode < 300) { try { require('../services/setupHub').afterChange('layout_templates', req.user && (req.user.name || req.user.email)).catch(function () {}); } catch (e) {} } });
  }
  next();
});
const { requireAuth, requireRedactionWork, isElevated } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');
const UPLOAD_DIR = require('path').join(__dirname, '../../../uploads'); // same landing dir routes/files.js uses
const docProcessing = require('../services/docProcessing');
const redactionApply = require('../services/redactionApply');
const structuredRedaction = require('../services/structuredRedaction');
const libraryShelf = require('../services/libraryShelf');
const seeding = require('../services/templateSeeding');   // item 7 S1: census signature gate, pile vocabulary, classes
const processingHistory = require('../services/processingHistory');

function isElevatedReq(req) { return isElevated(req.user); }   // S4: authority-based (see middleware/auth ELEVATED)
async function activeJurisdiction() {
  var row = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  return (row && row.value) || 'jur-tx';
}
function parseZones(t) { try { return JSON.parse(t.zones || '[]'); } catch (e) { return []; } }
function parseFieldMap(t) { try { return JSON.parse(t.field_map || '[]'); } catch (e) { return []; } }
function fpColumns(fp) { try { var o = JSON.parse(fp); return (o && o.kind === 'fields' && Array.isArray(o.columns)) ? o.columns : null; } catch (e) { return null; } }
async function fieldsScore(cols, fileId) {
  if (!cols || !cols.length) return { score: null };
  var pv; try { pv = await structuredRedaction.preview(fileId); } catch (e) { return { score: 0, rowCount: 0 }; }
  var have = {}; (pv.columns || []).forEach(function (c) { have[String(c).trim().toLowerCase()] = 1; });
  var inter = 0; cols.forEach(function (c) { if (have[String(c).trim().toLowerCase()]) inter++; });
  return { score: Math.round(100 * inter / cols.length), rowCount: pv.rowCount, file_columns: pv.columns };
}

// Tokenizer shared with templateSeeding (the pile vocabulary must use the SAME word rule as the target).
var tokenize = seeding.tokenize;
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
// ITEM 7 §7 RULE: a template that carries a census signature matches only when the target's census fingerprint
// isMatch()es it AND the vocabulary clears the threshold. A veto returns score 0 with the reason, so every
// consumer (match, apply-batch, the mass-job worker) HOLDS the document without knowing why. Legacy templates
// (no signature) keep vocabulary-only matching and are labelled provisional on the inventory row.
async function safetyScore(template, fileId) {
  var gate = await seeding.signatureGate(template, fileId);
  var tt = tokensFromFingerprint(template.layout_fingerprint);
  var keys = Object.keys(tt);
  var ft = await fileTokens(fileId);
  if (gate.applies && !gate.pass) return { score: 0, gate: gate.reason || 'fingerprint_veto', file_pages: ft.pages, template_pages: fpPages(template.layout_fingerprint), matched: 0, template_terms: keys.length };
  if (!keys.length) return { score: null, file_pages: ft.pages, template_pages: fpPages(template.layout_fingerprint), matched: 0, template_terms: 0, gate: gate.applies ? 'fingerprint_match' : null };
  var inter = 0; keys.forEach(function (k) { if (ft.tokens[k]) inter++; });
  return { score: Math.round(100 * inter / keys.length), file_pages: ft.pages, template_pages: fpPages(template.layout_fingerprint), matched: inter, template_terms: keys.length, gate: gate.applies ? 'fingerprint_match' : null };
}
// Apply a template's zones to one file -> released redacted copy (shared by single + batch apply).
async function applyTemplateToFile(t, file, zones, actorName, actorSub, destination) {
  var pc = await get('SELECT count(*) AS c FROM document_pages WHERE file_id = ?', [file.id]);
  if (!pc || !pc.c) await docProcessing.processFile(file.id);
  if (!destination) destination = await libraryShelf.resolveDestination(null, t.record_type_id);
  var jobId = uuidv4();
  var jur = await activeJurisdiction();
  await run('INSERT INTO redaction_jobs (id, file_id, request_id, jurisdiction_id, status, created_by) VALUES (?,?,?,?,?,?)',
    [jobId, file.id, file.request_id, jur, 'draft', actorSub]);
  for (var i = 0; i < zones.length; i++) {
    var z = zones[i];
    await run('INSERT INTO redaction_zones (id, job_id, file_id, page_no, x, y, w, h, rule_id, note, zone_type, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [uuidv4(), jobId, file.id, z.page_no || 1, z.x, z.y, z.w, z.h, z.rule_id || null, z.label || null, 'template', actorSub]);
  }
  var result = await redactionApply.applyRedaction(jobId, actorName, { destination: destination });
  return Object.assign({ jobId: jobId }, result);
}

// POST / -> create a template. Three kinds: 'pages' (zones), 'fields' (a field map), 'content' (item 7 §3: no
// zones, the rules an ad-hoc type's redactions cite — never mass-applies). Who may write what (Kevin D1):
//   supervisor+ ............ saves directly (status 'active'), or 'proposed' if the body asks for it
//   redaction worker ....... PROPOSES (status forced to 'proposed'; a supervisor approves from the inventory row)
//   a 'content' profile .... activates directly for anyone allowed here (it burns nothing)
// When the type has a census grouping the template takes the grouping's SIGNATURE and PILE VOCABULARY (§7);
// otherwise it keeps the one-file vocabulary and is labelled provisional. `layout_class` in the body is the
// human's confirmation of the census's proposal (§2a) and is written to the record type (Kevin D7).
function redactionWorkOrElevated(req, res, next) { if (isElevatedReq(req)) return next(); return requireRedactionWork(req, res, next); }
router.post('/', requireAuth, redactionWorkOrElevated, async function(req, res) {
  var elevated = isElevatedReq(req);
  var b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  var kind = b.kind === 'fields' ? 'fields' : (b.kind === 'content' ? 'content' : 'pages');
  if (kind !== 'content' && !elevated && b.status !== 'proposed' && b.propose !== true) {
    return res.status(403).json({ error: 'Only a supervisor can save a template directly — propose it instead (status "proposed") and a supervisor approves it from the inventory.', code: 'PROPOSE_ONLY' });
  }
  var rt = b.record_type_id ? await get('SELECT id, name, layout_class, parent_record_type_id FROM record_types WHERE id = ?', [b.record_type_id]) : null;
  if (b.record_type_id && !rt) return res.status(422).json({ error: 'Record type not found' });
  if (b.layout_class !== undefined && b.layout_class !== null && seeding.LAYOUT_CLASSES.indexOf(b.layout_class) === -1) return res.status(422).json({ error: 'layout_class must be static, floating or adhoc' });
  var zonesJson = '[]', fieldMapJson = null, fingerprint = null, ruleIdsJson = null, contentClass = null, censusSig = null, vocab = null;
  var srcFile = b.source_file_id ? await get('SELECT original_name, filename, request_id FROM request_files WHERE id = ?', [b.source_file_id]) : null;
  var layoutClass = b.layout_class || (rt && rt.layout_class) || null;
  if (kind === 'fields') {
    if (!Array.isArray(b.field_map) || !b.field_map.length) return res.status(400).json({ error: 'field_map with at least one field is required' });
    fieldMapJson = JSON.stringify(b.field_map.map(function(f){ return { field: f.field, rule_id: f.rule_id || null }; }));
    var cols = [];
    if (b.source_file_id) { try { var pv = await structuredRedaction.preview(b.source_file_id); cols = pv.columns || []; } catch (e) {} }
    fingerprint = JSON.stringify({ v: 1, kind: 'fields', columns: cols });
  } else if (kind === 'content') {
    var rids = Array.isArray(b.rule_ids) ? b.rule_ids.filter(Boolean) : [];
    if (!rids.length && Array.isArray(b.zones)) b.zones.forEach(function (z) { if (z.rule_id && rids.indexOf(z.rule_id) === -1) rids.push(z.rule_id); });
    if (!rids.length) return res.status(400).json({ error: 'A content profile needs the rules the redactions cited (rule_ids)' });
    ruleIdsJson = JSON.stringify(rids);
    var titles = await seeding.ruleTitlesFor(rids.map(function (r) { return { rule_id: r }; }));
    contentClass = seeding.contentClass(rids.map(function (r) { return { rule_id: r }; }), titles, null);
    layoutClass = layoutClass || 'adhoc';
  } else {
    if (!Array.isArray(b.zones) || !b.zones.length) return res.status(400).json({ error: 'name and at least one zone are required' });
    var zones = b.zones.map(function(z){ return { page_no: z.page_no || 1, x: z.x, y: z.y, w: z.w, h: z.h, rule_id: z.rule_id || null, label: z.label || null }; });
    zonesJson = JSON.stringify(zones);
    if (!layoutClass && rt) layoutClass = (await seeding.proposedLayoutClass(rt.id)).layout_class;
    contentClass = seeding.contentClass(zones, await seeding.ruleTitlesFor(zones), layoutClass);
    var pile = rt ? await seeding.pileVocabulary(rt.id) : null;
    if (pile) {
      fingerprint = JSON.stringify({ v: 2, name: srcFile ? (srcFile.original_name || srcFile.filename) : 'pile', pages: pile.pages, tokens: pile.tokens, pile_members: pile.members, grouping_id: pile.grouping_id });
      censusSig = pile.signature ? JSON.stringify(pile.signature) : null; vocab = 'pile';
    } else {
      fingerprint = await buildFingerprint(b.source_file_id);
      var ctx = rt ? await seeding.censusContext(rt.id) : null;
      censusSig = ctx && ctx.signature ? JSON.stringify(ctx.signature) : null; vocab = fingerprint ? 'file' : null;
    }
  }
  var status = kind === 'content' ? 'active' : ((!elevated || b.status === 'proposed' || b.propose === true) ? 'proposed' : 'active');
  var source = b.source === 'sample' || status === 'proposed' ? 'sample' : 'manual';
  var id = uuidv4();
  await run('INSERT INTO layout_profiles (id, name, record_type_id, description, zones, kind, field_map, source, status, source_file_id, source_filename, layout_fingerprint, safety_threshold, processing_manager_name, processing_manager_email, created_by, content_class, census_signature, vocabulary_source, rule_ids, proposed_by, proposed_from_request_id, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))',
    [id, b.name, rt ? rt.id : null, b.description || null, zonesJson, kind, fieldMapJson, source, status,
     b.source_file_id || null, srcFile ? (srcFile.original_name || srcFile.filename) : null,
     fingerprint, b.safety_threshold != null ? b.safety_threshold : 80,
     b.processing_manager_name || null, b.processing_manager_email || null, req.user.sub,
     contentClass, censusSig, vocab, ruleIdsJson,
     status === 'proposed' ? (req.user.name || req.user.email || req.user.sub) : null,
     status === 'proposed' ? ((srcFile && srcFile.request_id) || b.request_id || null) : null]);
  if (rt && b.layout_class !== undefined && (b.layout_class || null) !== (rt.layout_class || null)) {
    await run("UPDATE record_types SET layout_class = ?, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [b.layout_class || null, rt.id]);
  }
  var saved = await get('SELECT * FROM layout_profiles WHERE id = ?', [id]);
  await processingHistory.record('layout_profile', id, status === 'proposed' ? 'template_proposed_from_sample' : 'template_created', req.user,
    { kind: kind, record_type_id: rt ? rt.id : null, zones: kind === 'pages' ? JSON.parse(zonesJson).length : 0, content_class: contentClass, layout_class: layoutClass, vocabulary: vocab, request_id: saved.proposed_from_request_id || null });
  res.json({ success: true, status: status, template: saved, layout_class: layoutClass, content_class: contentClass, provisional: kind === 'pages' && !censusSig });
});

// POST /:id/approve — a supervisor+ activates a proposed template (from the inventory row or Mass Redaction).
router.post('/:id/approve', requireAuth, async function (req, res) {
  if (!isElevatedReq(req)) return res.status(403).json({ error: 'Only a supervisor can approve a proposed template' });
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  if (t.status !== 'proposed') return res.status(409).json({ error: 'Only a proposed template can be approved (this one is ' + t.status + ')' });
  await run("UPDATE layout_profiles SET status = 'active', updated_at = datetime('now') WHERE id = ?", [t.id]);
  await processingHistory.record('layout_profile', t.id, 'template_approved', req.user, { record_type_id: t.record_type_id, proposed_by: t.proposed_by });
  try { require('../services/setupHub').afterChange('layout_templates', req.user && (req.user.name || req.user.email)).catch(function () {}); } catch (e) {}
  res.json({ success: true, template: await get('SELECT * FROM layout_profiles WHERE id = ?', [t.id]) });
});
// POST /:id/return — a supervisor+ sends a proposal back with a note; the row stays for the record, never matches.
router.post('/:id/return', requireAuth, async function (req, res) {
  if (!isElevatedReq(req)) return res.status(403).json({ error: 'Only a supervisor can return a proposed template' });
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  if (t.status !== 'proposed') return res.status(409).json({ error: 'Only a proposed template can be returned' });
  var note = ((req.body || {}).note || '').trim();
  await run("UPDATE layout_profiles SET status = 'returned', review_note = ?, updated_at = datetime('now') WHERE id = ?", [note || null, t.id]);
  await processingHistory.record('layout_profile', t.id, 'template_returned', req.user, { record_type_id: t.record_type_id, note: note || null });
  res.json({ success: true });
});

// GET / -> list templates
router.get('/', requireAuth, async function(req, res) {
  var rows = await all(
    "SELECT lp.*, rt.name AS record_type_name, " +
    "COALESCE((SELECT department_id FROM record_type_departments WHERE record_type_id = rt.id AND role = 'owner' ORDER BY sort_order LIMIT 1), " +
    "(SELECT department_id FROM record_type_departments WHERE record_type_id = rt.parent_record_type_id AND role = 'owner' ORDER BY sort_order LIMIT 1)) AS owner_department_id " +
    "FROM layout_profiles lp LEFT JOIN record_types rt ON rt.id = lp.record_type_id WHERE lp.status != 'deleted' ORDER BY lp.created_at DESC");
  res.json({ templates: rows.map(function(t){ return { id: t.id, name: t.name, description: t.description, kind: t.kind || 'pages', record_type_id: t.record_type_id, record_type_name: t.record_type_name, owner_department_id: t.owner_department_id, zone_count: parseZones(t).length, field_count: parseFieldMap(t).length, source_filename: t.source_filename, safety_threshold: t.safety_threshold, status: t.status, created_at: t.created_at, content_class: t.content_class || null, provisional: (t.kind || 'pages') === 'pages' && !t.census_signature, vocabulary_source: t.vocabulary_source || null, proposed_by: t.proposed_by || null, proposed_from_request_id: t.proposed_from_request_id || null, review_note: t.review_note || null }; }) });
});

// GET /opportunities -> variants the discovery scan flagged as mass-redaction candidates that still
// have NO template. Query-driven: a card exists exactly while the flag is set and no un-deleted
// layout_profile names the record type — saving a linked template clears it with no bookkeeping.
// (Registered before /:id so the literal path isn't swallowed by the param route.)
router.get('/opportunities', requireAuth, async function(req, res) {
  var rows = await all(
    "SELECT rt.id, rt.name, rt.discovery_meta, p.name AS parent_name FROM record_types rt " +
    "LEFT JOIN record_types p ON p.id = rt.parent_record_type_id " +
    "WHERE rt.mass_redaction_candidate = 1 " +
    "AND NOT EXISTS (SELECT 1 FROM layout_profiles lp WHERE lp.record_type_id = rt.id AND lp.status != 'deleted') " +
    "ORDER BY rt.name");
  res.json({ opportunities: rows.map(function (r) {
    var meta = {}; try { meta = JSON.parse(r.discovery_meta || '{}') || {}; } catch (e) {}
    return { record_type_id: r.id, name: r.name, parent_name: r.parent_name,
      estimated_count: meta.estimated_count != null ? meta.estimated_count : null,
      sample_share: meta.sample_share || null, layout: meta.layout || null,
      example_files: meta.example_files || [], repos: meta.repos || [], found_at: meta.found_at || null };
  }) });
});

// POST /opportunities/:recordTypeId/dismiss -> "Not needed": clear the flag by hand (elevated, same
// bar as creating a template). The variant itself is untouched — only the suggestion goes away.
router.post('/opportunities/:recordTypeId/dismiss', requireAuth, async function(req, res) {
  if (!isElevatedReq(req)) return res.status(403).json({ error: 'Only a supervisor can dismiss a suggestion' });
  var rt = await get('SELECT id, mass_redaction_candidate FROM record_types WHERE id = ?', [req.params.recordTypeId]);
  if (!rt || !rt.mass_redaction_candidate) return res.status(404).json({ error: 'No open suggestion for that record type' });
  await run('UPDATE record_types SET mass_redaction_candidate = 0 WHERE id = ?', [rt.id]);
  res.json({ success: true });
});

// GET /:id -> full template incl zones
router.get('/:id', requireAuth, async function(req, res) {
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json({ template: Object.assign({}, t, { zones: parseZones(t), field_map: parseFieldMap(t) }) });
});

// GET /:id/sample -> a recently released record produced for this template's record type, so staff
// can preview what the born-redacted output actually looks like.
router.get('/:id/sample', requireAuth, async function(req, res) {
  try {
    var t = await get('SELECT record_type_id FROM layout_profiles WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    var fr = t.record_type_id ? await get("SELECT id, title, output_file_id FROM fulfilled_records WHERE record_type_id = ? AND status = 'released' AND output_file_id IS NOT NULL ORDER BY released_at DESC LIMIT 1", [t.record_type_id]) : null;
    res.json({ sample: fr ? { title: fr.title, output_file_id: fr.output_file_id } : null });
  } catch (e) { res.status(500).json({ error: 'Could not load a sample.' }); }
});

// PATCH /:id -> update (elevated)
router.patch('/:id', requireAuth, async function(req, res) {
  if (!isElevatedReq(req)) return res.status(403).json({ error: 'Only a supervisor can edit templates' });
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  var b = req.body || {};
  var sets = [], params = [];
  ['name', 'description', 'record_type_id', 'status', 'processing_manager_name', 'processing_manager_email'].forEach(function(k){
    if (b[k] !== undefined) { sets.push(k + ' = ?'); params.push(b[k]); }
  });
  if (b.safety_threshold !== undefined) { sets.push('safety_threshold = ?'); params.push(b.safety_threshold); }
  if (Array.isArray(b.zones)) {
    sets.push('zones = ?'); params.push(JSON.stringify(b.zones));
    var rtl = t.record_type_id ? await get('SELECT layout_class FROM record_types WHERE id = ?', [t.record_type_id]) : null;
    sets.push('content_class = ?'); params.push(seeding.contentClass(b.zones, await seeding.ruleTitlesFor(b.zones), rtl ? rtl.layout_class : null));
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push("updated_at = datetime('now')");
  params.push(req.params.id);
  await run('UPDATE layout_profiles SET ' + sets.join(', ') + ' WHERE id = ?', params);
  res.json({ success: true });
});

// DELETE /:id (soft delete; elevated)
router.delete('/:id', requireAuth, async function(req, res) {
  if (!isElevatedReq(req)) return res.status(403).json({ error: 'Only a supervisor can delete templates' });
  await run("UPDATE layout_profiles SET status = 'deleted', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// POST /:id/apply -> apply this template to a document (the consume path). Body: { file_id }
router.post('/:id/apply', requireAuth, requireRedactionWork, async function(req, res) {
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
  var t = await get('SELECT kind FROM layout_profiles WHERE id = ?', [req.params.id]);
  var isFields = t && t.kind === 'fields';
  var where = isFields ? "(rf.mimetype ILIKE '%csv%' OR rf.filename ILIKE '%.csv')" : "(rf.mimetype = 'application/pdf' OR rf.filename ILIKE '%.pdf')";
  var rows = await all("SELECT rf.id, rf.original_name, rf.filename, rf.request_id, rf.status, r.description AS request_desc FROM request_files rf LEFT JOIN requests r ON r.id = rf.request_id WHERE " + where + " AND COALESCE(rf.status,'') <> 'redacted' ORDER BY rf.original_name");
  res.json({ kind: isFields ? 'fields' : 'pages', candidates: rows.map(function(f){ return { id: f.id, name: f.original_name || f.filename, request_id: f.request_id, request_desc: f.request_desc ? String(f.request_desc).slice(0, 70) : null, status: f.status }; }) });
});

// POST /:id/apply-batch -> safety check (commit:false) or process (commit:true) over many files. Body: { file_ids:[], commit }
router.post('/:id/apply-batch', requireAuth, async function(req, res) {
  if (!isElevatedReq(req)) return res.status(403).json({ error: 'Only a supervisor can run batch redaction' });
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  var b = req.body || {};
  var ids = Array.isArray(b.file_ids) ? b.file_ids : [];
  if (!ids.length) return res.status(400).json({ error: 'file_ids is required' });
  var commit = !!b.commit;
  var threshold = t.safety_threshold != null ? t.safety_threshold : 80;
  // Library destination for request-less files in this batch: caller's pick, else the template's
  // linked record type with its owner department. Resolved once for the whole batch.
  var destination = await libraryShelf.resolveDestination({ record_type_id: b.record_type_id, department_id: b.department_id }, t.record_type_id);

  if (t.kind === 'fields') {
    var fmap = parseFieldMap(t);
    if (!fmap.length) return res.status(400).json({ error: 'Template has no fields' });
    var fcols = fpColumns(t.layout_fingerprint) || [];
    var fres = [];
    for (var fi = 0; fi < ids.length; fi++) {
      var ffid = ids[fi];
      var ffile = await get('SELECT * FROM request_files WHERE id = ?', [ffid]);
      if (!ffile) { fres.push({ file_id: ffid, status: 'error', error: 'File not found' }); continue; }
      var fnm = ffile.original_name || ffile.filename;
      try {
        var fsc = await fieldsScore(fcols, ffid);
        var fpass = fsc.score == null ? null : fsc.score >= threshold;
        if (!commit) { fres.push({ file_id: ffid, name: fnm, status: 'checked', score: fsc.score, pass: fpass, file_pages: fsc.rowCount }); continue; }
        if (fsc.score != null && fsc.score < threshold) { fres.push({ file_id: ffid, name: fnm, status: 'held', score: fsc.score, reason: 'Field match ' + fsc.score + '% is below the ' + threshold + '% safety threshold' }); continue; }
        var fout = await structuredRedaction.applyFieldMap(ffid, fmap, req.user.name || 'Mass Redaction', req.user.sub, destination);
        fres.push({ file_id: ffid, name: fnm, status: 'redacted', score: fsc.score, outputFileId: fout.outputFileId, fileName: fout.fileName, zoneCount: fout.withheldFields.length });
      } catch (e) { fres.push({ file_id: ffid, name: fnm, status: 'error', error: e.message }); }
    }
    return res.json({ success: true, template_id: t.id, kind: 'fields', threshold: threshold, committed: commit, results: fres, summary: { total: ids.length, redacted: fres.filter(function(r){return r.status==='redacted';}).length, held: fres.filter(function(r){return r.status==='held';}).length, errors: fres.filter(function(r){return r.status==='error';}).length, passing: fres.filter(function(r){return r.pass===true;}).length } });
  }

  var zones = parseZones(t);
  if (!zones.length) return res.status(400).json({ error: 'Template has no zones' });
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
      var out = await applyTemplateToFile(t, file, zones, req.user.name || 'Mass Redaction', req.user.sub, destination);
      results.push({ file_id: fid, name: nm, status: 'redacted', score: s.score, outputFileId: out.outputFileId, fileName: out.fileName, zoneCount: out.zoneCount, jobId: out.jobId, audit_flags: out.auditFlags || [] });
    } catch (e) {
      results.push({ file_id: fid, name: nm, status: 'error', error: e.message });
    }
  }
  function count(st) { return results.filter(function(r){ return r.status === st; }).length; }
  var summary = { total: ids.length, redacted: count('redacted'), held: count('held'), errors: count('error'), passing: results.filter(function(r){ return r.pass === true; }).length };
  res.json({ success: true, template_id: t.id, threshold: threshold, committed: commit, results: results, summary: summary });
});

// POST /match -> the best active template whose layout matches this file (>= its safety threshold), or none.
router.post('/match', requireAuth, async function(req, res) {
  var fileId = (req.body || {}).file_id;
  if (!fileId) return res.status(400).json({ error: 'file_id is required' });
  var file = await get('SELECT * FROM request_files WHERE id = ?', [fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  try {
    var pc = await get('SELECT count(*) AS c FROM document_pages WHERE file_id = ?', [fileId]);
    if (!pc || !pc.c) await docProcessing.processFile(fileId);
    var tpls = await all("SELECT * FROM layout_profiles WHERE status = 'active'");
    var best = null;
    for (var i = 0; i < tpls.length; i++) {
      var z = parseZones(tpls[i]); if (!z.length) continue;
      var s = await safetyScore(tpls[i], fileId);
      var thr = tpls[i].safety_threshold != null ? tpls[i].safety_threshold : 80;
      if (s.score != null && s.score >= thr && (!best || s.score > best.score)) {
        best = { id: tpls[i].id, name: tpls[i].name, zone_count: z.length, safety_threshold: thr, score: s.score };
      }
    }
    res.json({ matched: !!best, template: best });
  } catch (e) { console.error('[template match]', e.message); res.status(500).json({ error: e.message }); }
});

// POST /match-batch -> for each file, the best matching active template. Side-effect-free: only scores
// files that are ALREADY processed (won't trigger OCR/processing just to render a badge).
router.post('/match-batch', requireAuth, async function(req, res) {
  var ids = Array.isArray((req.body || {}).file_ids) ? req.body.file_ids : [];
  if (!ids.length) return res.json({ matches: {} });
  var tpls = await all("SELECT * FROM layout_profiles WHERE status = 'active'");
  var withZones = tpls.map(function(t){ return { t: t, zones: parseZones(t), thr: t.safety_threshold != null ? t.safety_threshold : 80 }; }).filter(function(x){ return x.zones.length; });
  var matches = {};
  for (var i = 0; i < ids.length; i++) {
    var fid = ids[i];
    var pc = await get('SELECT count(*) AS c FROM document_pages WHERE file_id = ?', [fid]);
    if (!pc || !pc.c) { matches[fid] = { processed: false }; continue; }
    var ft = await fileTokens(fid);
    var best = null;
    for (var j = 0; j < withZones.length; j++) {
      if (withZones[j].t.census_signature) { var g = await seeding.signatureGate(withZones[j].t, fid); if (g.applies && !g.pass) continue; }   // §7 gate
      var tt = tokensFromFingerprint(withZones[j].t.layout_fingerprint);
      var keys = Object.keys(tt); if (!keys.length) continue;
      var inter = 0; for (var k = 0; k < keys.length; k++) { if (ft.tokens[keys[k]]) inter++; }
      var score = Math.round(100 * inter / keys.length);
      if (score >= withZones[j].thr && (!best || score > best.score)) best = { id: withZones[j].t.id, name: withZones[j].t.name, score: score };
    }
    matches[fid] = best ? { matched: true, template: best } : { matched: false };
  }
  res.json({ matches: matches });
});

// POST /:id/stage -> copy this template's zones onto an existing draft job for human review (no release). Body: { job_id, file_id }
router.post('/:id/stage', requireAuth, requireRedactionWork, async function(req, res) {
  var t = await get('SELECT * FROM layout_profiles WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  var b = req.body || {};
  if (!b.job_id || !b.file_id) return res.status(400).json({ error: 'job_id and file_id are required' });
  var zones = parseZones(t);
  if (!zones.length) return res.status(400).json({ error: 'Template has no zones' });
  var created = [];
  for (var i = 0; i < zones.length; i++) {
    var z = zones[i]; var zid = uuidv4();
    await run('INSERT INTO redaction_zones (id, job_id, file_id, page_no, x, y, w, h, rule_id, note, zone_type, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [zid, b.job_id, b.file_id, z.page_no || 1, z.x, z.y, z.w, z.h, z.rule_id || null, z.label || null, 'template', req.user.sub]);
    created.push({ id: zid, job_id: b.job_id, file_id: b.file_id, page_no: z.page_no || 1, x: z.x, y: z.y, w: z.w, h: z.h, rule_id: z.rule_id || null, note: z.label || null, zone_type: 'template' });
  }
  res.json({ success: true, template_id: t.id, zones: created });
});

// STAGE A REAL EXAMPLE (Kevin 2026-09-04): "Create a Template" on a waiting card must not ask for an
// upload — the census already knows every document in the pile (approval stamps them
// matched_record_type_id). Copy one stamped example from its source drive into the standing
// req-template-samples request — the same landing spot the manual upload uses — and return the fileId
// the redaction workspace opens. Path guards mirror /taxonomy/preview-source-file; PDF only.
router.post('/opportunities/:recordTypeId/stage-example', requireAuth, requireRedactionWork, async function (req, res) {
  var pathMod = require('path'), fsMod = require('fs');
  var rt = await get('SELECT id, name FROM record_types WHERE id = ?', [req.params.recordTypeId]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  var candidates = await all('SELECT repository_id, filename FROM document_fingerprints WHERE matched_record_type_id = ? ORDER BY filename LIMIT 8', [rt.id]);
  if (!candidates.length) return res.status(404).json({ error: 'No indexed example documents for this variant yet — upload a sample instead.' });
  for (var i = 0; i < candidates.length; i++) {
    var ex = candidates[i];
    if (ex.filename !== pathMod.basename(ex.filename) || ex.filename.indexOf('..') !== -1 || !/\.pdf$/i.test(ex.filename)) continue;
    var repo = await get('SELECT config FROM record_repositories WHERE id = ?', [ex.repository_id]);
    if (!repo) continue;
    var cfg = {}; try { cfg = JSON.parse(repo.config || '{}'); } catch (e) {}
    if (!cfg.path) continue;
    var base = pathMod.resolve(cfg.path);
    var full = pathMod.resolve(base, ex.filename);
    if (full.indexOf(base + pathMod.sep) !== 0 || !fsMod.existsSync(full)) continue;
    var newName = uuidv4() + '.pdf';
    fsMod.copyFileSync(full, pathMod.join(UPLOAD_DIR, newName));
    var fid = uuidv4();
    await run('INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, responsive, uploaded_by) VALUES (?,?,?,?,?,?,?,?)',
      [fid, 'req-template-samples', newName, ex.filename, 'application/pdf', fsMod.statSync(full).size, 0, req.user.sub]);
    return res.json({ fileId: fid, originalName: ex.filename, sourceRepository: ex.repository_id });
  }
  return res.status(404).json({ error: 'The example documents could not be read from their source drive — upload a sample instead.' });
});

module.exports = router;
// Expose the engine internals so the mass-job worker reuses the exact same drift-check + apply logic.
module.exports.engine = {
  applyTemplateToFile: applyTemplateToFile,
  safetyScore: safetyScore,
  fieldsScore: fieldsScore,
  parseZones: parseZones,
  parseFieldMap: parseFieldMap,
  fpColumns: fpColumns,
  buildFingerprint: buildFingerprint
};
