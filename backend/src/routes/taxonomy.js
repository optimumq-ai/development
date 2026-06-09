const express = require('express');
const router = express.Router();
const { get, all, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

var ARRAY_FIELDS = ['synonyms','disambiguators','keywords','identifying_facets','formats'];
var BOOL_FIELDS = ['is_structured_data','auto_release_eligible','is_canonical'];

function nid(prefix) { return prefix + '-' + uuidv4().substring(0, 8); }

async function audit(entityType, entityId, action, req, details) {
  await run('INSERT INTO taxonomy_audit (id, entity_type, entity_id, action, actor_id, actor_name, details) VALUES (?,?,?,?,?,?,?)',
    [nid('aud'), entityType, entityId, action, (req.user && (req.user.sub || req.user.id)) || null, (req.user && req.user.email) || 'system', details ? JSON.stringify(details) : null]);
}

function hydrate(rt) {
  if (!rt) return rt;
  ARRAY_FIELDS.forEach(function(f) {
    try { rt[f] = JSON.parse(rt[f] || '[]'); } catch (e) { rt[f] = []; }
  });
  return rt;
}

async function attachRouting(list) {
  if (!list || !list.length) return;
  var links = await all("SELECT record_type_id, department_id, role FROM record_type_departments WHERE role IN ('owner','fulfiller') ORDER BY sort_order");
  var depts = await all("SELECT id, name, kind, processed_by FROM departments");
  var dById = {}; depts.forEach(function(d){ dById[d.id] = d; });
  var ownerOf = {}, fulfillerOf = {};
  links.forEach(function(l){
    if (l.role === 'owner' && !ownerOf[l.record_type_id]) ownerOf[l.record_type_id] = l.department_id;
    if (l.role === 'fulfiller' && !fulfillerOf[l.record_type_id]) fulfillerOf[l.record_type_id] = l.department_id;
  });
  list.forEach(function(rt){
    var ownerId = ownerOf[rt.id] || null;
    var ownerDept = ownerId ? dById[ownerId] : null;
    rt.owner_department_id = ownerId;
    rt.owner_department_name = ownerDept ? ownerDept.name : null;
    var overrideId = fulfillerOf[rt.id] || null;
    var teamId = overrideId || (ownerDept ? ownerDept.processed_by : null);
    var team = teamId ? dById[teamId] : null;
    rt.fulfillment_team_id = teamId || null;
    rt.fulfillment_team_name = team ? team.name : null;
    rt.fulfillment_team_is_override = !!overrideId;
  });
}

function packArray(v) {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string') return v;
  return JSON.stringify([]);
}

// ===== CATEGORIES =====
router.get('/categories', requireAuth, async function(req, res) {
  var rows = await all('SELECT * FROM categories ORDER BY sort_order, name');
  res.json({ categories: rows });
});

router.post('/categories', requireAuth, async function(req, res) {
  var name = (req.body.name || '').trim();
  var code = (req.body.code || '').trim();
  if (!name || !code) return res.status(400).json({ error: 'name and code are required' });
  var dup = await get('SELECT id FROM categories WHERE code = ?', [code]);
  if (dup) return res.status(400).json({ error: 'A category with that code already exists' });
  var id = nid('cat');
  await run('INSERT INTO categories (id, name, code, description, sort_order, active) VALUES (?,?,?,?,?,?)',
    [id, name, code, req.body.description || null, req.body.sort_order || 100, req.body.active === 0 ? 0 : 1]);
  await audit('category', id, 'create', req, { name: name, code: code });
  res.json(await get('SELECT * FROM categories WHERE id = ?', [id]));
});

router.patch('/categories/:id', requireAuth, async function(req, res) {
  var row = await get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Category not found' });
  var b = req.body;
  var name = b.name !== undefined ? String(b.name).trim() : row.name;
  var code = b.code !== undefined ? String(b.code).trim() : row.code;
  var desc = b.description !== undefined ? b.description : row.description;
  var sort = b.sort_order !== undefined ? b.sort_order : row.sort_order;
  var active = b.active !== undefined ? (b.active ? 1 : 0) : row.active;
  await run('UPDATE categories SET name=?, code=?, description=?, sort_order=?, active=? WHERE id=?',
    [name, code, desc, sort, active, row.id]);
  await audit('category', row.id, 'update', req, b);
  res.json(await get('SELECT * FROM categories WHERE id = ?', [row.id]));
});

router.delete('/categories/:id', requireAuth, async function(req, res) {
  var row = await get('SELECT id FROM categories WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Category not found' });
  var used = await get('SELECT COUNT(*) as c FROM record_types WHERE category_id = ?', [req.params.id]);
  if (used && used.c > 0) return res.status(400).json({ error: 'Category has ' + used.c + ' record type(s); reassign or delete those first' });
  await run('DELETE FROM categories WHERE id = ?', [req.params.id]);
  await audit('category', req.params.id, 'delete', req, null);
  res.json({ success: true });
});

// ===== RECORD TYPES =====
router.get('/record-types', requireAuth, async function(req, res) {
  var clauses = [], params = [];
  if (req.query.category_id) { clauses.push('rt.category_id = ?'); params.push(req.query.category_id); }
  if (req.query.status) { clauses.push('rt.status = ?'); params.push(req.query.status); }
  var where = clauses.length ? (' WHERE ' + clauses.join(' AND ')) : '';
  var rows = await all('SELECT rt.*, c.name AS category_name FROM record_types rt LEFT JOIN categories c ON c.id = rt.category_id' + where + ' ORDER BY rt.sort_order, rt.name', params);
  var out = rows.map(hydrate);
  await attachRouting(out);
  res.json({ record_types: out });
});

router.get('/record-types/:id', requireAuth, async function(req, res) {
  var rt = await get('SELECT rt.*, c.name AS category_name FROM record_types rt LEFT JOIN categories c ON c.id = rt.category_id WHERE rt.id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  hydrate(rt);
  rt.departments = await all('SELECT rd.*, d.name AS department_name FROM record_type_departments rd LEFT JOIN departments d ON d.id = rd.department_id WHERE rd.record_type_id = ? ORDER BY rd.role, rd.sort_order', [rt.id]);
  rt.repositories = await all('SELECT rr.*, rp.name AS repository_name FROM record_type_repositories rr LEFT JOIN record_repositories rp ON rp.id = rr.repository_id WHERE rr.record_type_id = ? ORDER BY rr.sort_order', [rt.id]);
  await attachRouting([rt]);
  res.json(rt);
});

router.post('/record-types', requireAuth, async function(req, res) {
  var b = req.body;
  var name = (b.name || '').trim();
  var code = (b.code || '').trim();
  if (!b.category_id || !name || !code) return res.status(400).json({ error: 'category_id, name and code are required' });
  var cat = await get('SELECT id FROM categories WHERE id = ?', [b.category_id]);
  if (!cat) return res.status(400).json({ error: 'category_id does not exist' });
  var dup = await get('SELECT id FROM record_types WHERE code = ?', [code]);
  if (dup) return res.status(400).json({ error: 'A record type with that code already exists' });
  var id = nid('rt');
  var cols = 'id, category_id, name, code, description, intent, expected_content, typical_request_reason, synonyms, disambiguators, keywords, identifying_facets, formats, is_structured_data, public_availability, auto_release_eligible, redaction_profile_id, fee_estimate_low, fee_estimate_high, fee_estimate_note, is_canonical, status, source, confidence, sort_order, fulfillment_method, medium';
  var ph = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';
  var vals = [id, b.category_id, name, code, b.description || null, b.intent || null, b.expected_content || null, b.typical_request_reason || null,
    packArray(b.synonyms) || '[]', packArray(b.disambiguators) || '[]', packArray(b.keywords) || '[]', packArray(b.identifying_facets) || '[]', packArray(b.formats) || '[]',
    b.is_structured_data ? 1 : 0, b.public_availability || 'review_required', b.auto_release_eligible ? 1 : 0, b.redaction_profile_id || null,
    b.fee_estimate_low || 0, b.fee_estimate_high || 0, b.fee_estimate_note || null, b.is_canonical ? 1 : 0,
    b.status || 'active', b.source || 'manual', b.confidence !== undefined ? b.confidence : null, b.sort_order || 100,
    b.fulfillment_method || 'electronic_search', b.medium || 'electronic'];
  await run('INSERT INTO record_types (' + cols + ') VALUES (' + ph + ')', vals);
  await audit('record_type', id, 'create', req, { name: name, code: code, source: b.source || 'manual' });
  res.json(hydrate(await get('SELECT * FROM record_types WHERE id = ?', [id])));
});

router.patch('/record-types/:id', requireAuth, async function(req, res) {
  var rt = await get('SELECT * FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  var b = req.body;
  var fields = ['category_id','name','code','description','intent','expected_content','typical_request_reason','public_availability','redaction_profile_id','fee_estimate_note','status','source','confidence','sort_order','fee_estimate_low','fee_estimate_high','fulfillment_method','medium'];
  var sets = [], params = [];
  fields.forEach(function(f) { if (b[f] !== undefined) { sets.push(f + ' = ?'); params.push(b[f]); } });
  ARRAY_FIELDS.forEach(function(f) { if (b[f] !== undefined) { sets.push(f + ' = ?'); params.push(packArray(b[f])); } });
  BOOL_FIELDS.forEach(function(f) { if (b[f] !== undefined) { sets.push(f + ' = ?'); params.push(b[f] ? 1 : 0); } });
  if (!sets.length) return res.status(400).json({ error: 'No updatable fields supplied' });
  sets.push("updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')");
  params.push(rt.id);
  await run('UPDATE record_types SET ' + sets.join(', ') + ' WHERE id = ?', params);
  await audit('record_type', rt.id, 'update', req, b);
  res.json(hydrate(await get('SELECT * FROM record_types WHERE id = ?', [rt.id])));
});

router.delete('/record-types/:id', requireAuth, async function(req, res) {
  var rt = await get('SELECT id FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  await run('DELETE FROM record_type_departments WHERE record_type_id = ?', [req.params.id]);
  await run('DELETE FROM record_type_repositories WHERE record_type_id = ?', [req.params.id]);
  await run('DELETE FROM record_types WHERE id = ?', [req.params.id]);
  await audit('record_type', req.params.id, 'delete', req, null);
  res.json({ success: true });
});

// ===== LINKS: departments (owner/fulfiller) =====
router.post('/record-types/:id/departments', requireAuth, async function(req, res) {
  var rt = await get('SELECT id FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  if (!req.body.department_id) return res.status(400).json({ error: 'department_id is required' });
  var role = req.body.role === 'fulfiller' ? 'fulfiller' : 'owner';
  var dup = await get('SELECT id FROM record_type_departments WHERE record_type_id=? AND department_id=? AND role=?', [req.params.id, req.body.department_id, role]);
  if (dup) return res.status(400).json({ error: 'That department link already exists' });
  var id = nid('rd');
  await run('INSERT INTO record_type_departments (id, record_type_id, department_id, role, sort_order) VALUES (?,?,?,?,?)',
    [id, req.params.id, req.body.department_id, role, req.body.sort_order || 100]);
  await audit('rt_department', id, 'create', req, { record_type_id: req.params.id, department_id: req.body.department_id, role: role });
  res.json(await get('SELECT * FROM record_type_departments WHERE id = ?', [id]));
});

router.delete('/record-types/:id/departments/:linkId', requireAuth, async function(req, res) {
  var link = await get('SELECT id FROM record_type_departments WHERE id = ? AND record_type_id = ?', [req.params.linkId, req.params.id]);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  await run('DELETE FROM record_type_departments WHERE id = ?', [req.params.linkId]);
  await audit('rt_department', req.params.linkId, 'delete', req, null);
  res.json({ success: true });
});

// ===== ROUTING: owning department + optional fulfillment team override =====
router.patch('/record-types/:id/routing', requireAuth, async function(req, res) {
  var rt = await get('SELECT id FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  var ownId = req.body.owning_department_id || null;
  var teamId = req.body.fulfillment_team_id || null;
  if (ownId) {
    var od = await get("SELECT id FROM departments WHERE id = ? AND (kind <> 'team' OR kind IS NULL)", [ownId]);
    if (!od) return res.status(400).json({ error: 'owning_department_id must be a business department' });
  }
  if (teamId) {
    var tm = await get("SELECT id FROM departments WHERE id = ? AND kind = 'team'", [teamId]);
    if (!tm) return res.status(400).json({ error: 'fulfillment_team_id must be a fulfillment team' });
  }
  await run("DELETE FROM record_type_departments WHERE record_type_id = ? AND role IN ('owner','fulfiller')", [req.params.id]);
  if (ownId) await run('INSERT INTO record_type_departments (id, record_type_id, department_id, role, sort_order) VALUES (?,?,?,?,?)', [nid('rd'), req.params.id, ownId, 'owner', 100]);
  if (teamId) await run('INSERT INTO record_type_departments (id, record_type_id, department_id, role, sort_order) VALUES (?,?,?,?,?)', [nid('rd'), req.params.id, teamId, 'fulfiller', 100]);
  await audit('rt_routing', req.params.id, 'update', req, { owning_department_id: ownId, fulfillment_team_id: teamId });
  res.json({ success: true, owning_department_id: ownId, fulfillment_team_id: teamId });
});

// ===== LINKS: repositories (where it lives) =====
router.post('/record-types/:id/repositories', requireAuth, async function(req, res) {
  var rt = await get('SELECT id FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  if (!req.body.repository_id) return res.status(400).json({ error: 'repository_id is required' });
  var fs = req.body.filter_spec ? (typeof req.body.filter_spec === 'string' ? req.body.filter_spec : JSON.stringify(req.body.filter_spec)) : '{}';
  var id = nid('rr');
  await run('INSERT INTO record_type_repositories (id, record_type_id, repository_id, format, filter_spec, sort_order) VALUES (?,?,?,?,?,?)',
    [id, req.params.id, req.body.repository_id, req.body.format || null, fs, req.body.sort_order || 100]);
  await audit('rt_repository', id, 'create', req, { record_type_id: req.params.id, repository_id: req.body.repository_id });
  res.json(await get('SELECT * FROM record_type_repositories WHERE id = ?', [id]));
});

router.delete('/record-types/:id/repositories/:linkId', requireAuth, async function(req, res) {
  var link = await get('SELECT id FROM record_type_repositories WHERE id = ? AND record_type_id = ?', [req.params.linkId, req.params.id]);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  await run('DELETE FROM record_type_repositories WHERE id = ?', [req.params.linkId]);
  await audit('rt_repository', req.params.linkId, 'delete', req, null);
  res.json({ success: true });
});

// ===== AI-ASSISTED SCHEMA DISCOVERY =====
router.post('/discover', requireAuth, async function(req, res) {
  var text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 16000) text = text.substring(0, 16000);
  var Anthropic = require('@anthropic-ai/sdk');
  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var cats = await all('SELECT id, name FROM categories WHERE active = 1 ORDER BY sort_order');
  var existing = await all('SELECT code, name FROM record_types ORDER BY name');
  var catList = cats.map(function(c){ return c.id + ' = ' + c.name; }).join('\n');
  var existingList = existing.map(function(r){ return r.code + ' (' + r.name + ')'; }).join('; ');
  var prompt = 'You are a records-management taxonomy expert for a local government public-records system. '
    + 'Analyze the document or description below and propose ONE record type for the agency taxonomy. '
    + 'Return ONLY a JSON object, no other text.\n\n'
    + 'Choose category_id from EXACTLY one of these:\n' + catList + '\n\n'
    + 'Existing record types (if the input clearly matches one, set matches_existing true and matched_code to its code):\n' + existingList + '\n\n'
    + 'Rules:\n'
    + '- public_availability is one of: releasable, review_required, restricted, confidential. Be conservative; default review_required.\n';
  prompt += '- auto_release_eligible is 1 ONLY if every plausible exemption is detectable from the document content itself (e.g. SSN, DOB, phone). Set 0 if any context-dependent exemption could apply (ongoing investigation, minors, privilege, medical, security).\n'
    + '- code: short kebab-case, unique, not in the existing list.\n'
    + '- formats: array drawn from document, video, audio, structured_data.\n\n'
    + 'JSON shape:\n'
    + '{"matches_existing": false, "matched_code": null, "name": "", "code": "", "category_id": "", '
    + '"intent": "", "expected_content": "", "typical_request_reason": "", '
    + '"synonyms": [], "disambiguators": [], "keywords": [], "identifying_facets": [], "formats": [], '
    + '"public_availability": "review_required", "auto_release_eligible": 0, "confidence": 0, "reasoning": ""}\n\n'
    + 'DOCUMENT OR DESCRIPTION:\n' + text;
  try {
    var message = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
    var raw = message.content[0].text.trim().replace(/```json|```/g, '').trim();
    var p = JSON.parse(raw);
    if (!p.category_id || !cats.find(function(c){ return c.id === p.category_id; })) {
      p.category_id = cats.length ? cats[cats.length - 1].id : null;
    }
    var matchedRow = p.matched_code ? existing.find(function(r){ return r.code === p.matched_code; }) : null;
    if (p.matches_existing && matchedRow) {
      return res.json({ matched_existing: true, matched_code: matchedRow.code, matched_name: matchedRow.name, proposal: p });
    }
    var code = (p.code || 'discovered-type').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 48) || 'discovered-type';
    var dup = await get('SELECT id FROM record_types WHERE code = ?', [code]);
    if (dup) code = code + '-' + uuidv4().substring(0, 4);
    var id = nid('rt');
    var av = ['releasable','review_required','restricted','confidential'].indexOf(p.public_availability) >= 0 ? p.public_availability : 'review_required';
    var cols = 'id, category_id, name, code, intent, expected_content, typical_request_reason, synonyms, disambiguators, keywords, identifying_facets, formats, is_structured_data, public_availability, auto_release_eligible, status, source, confidence, sort_order';
    var ph = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';
    await run('INSERT INTO record_types (' + cols + ') VALUES (' + ph + ')', [
      id, p.category_id, (p.name || 'Discovered type').toString().substring(0, 200), code,
      p.intent || null, p.expected_content || null, p.typical_request_reason || null,
      packArray(p.synonyms) || '[]', packArray(p.disambiguators) || '[]', packArray(p.keywords) || '[]',
      packArray(p.identifying_facets) || '[]', packArray(p.formats) || '[]',
      (p.formats && p.formats.indexOf('structured_data') >= 0) ? 1 : 0,
      av, p.auto_release_eligible ? 1 : 0, 'draft', 'discovered',
      (typeof p.confidence === 'number' ? p.confidence : null), 900
    ]);
    await audit('record_type', id, 'discover', req, { name: p.name, code: code, confidence: p.confidence });
    res.json({ matched_existing: false, draft: hydrate(await get('SELECT * FROM record_types WHERE id = ?', [id])), reasoning: p.reasoning || null });
  } catch (e) {
    console.error('Discover error:', e.message);
    res.status(500).json({ error: 'Schema discovery failed', details: e.message });
  }
});

router.post('/discover-scan', requireAuth, async function(req, res) {
  var repoId = req.body && req.body.repository_id;
  if (!repoId) return res.status(400).json({ error: 'repository_id is required' });
  var repo = await get('SELECT id, name, connector_type, config FROM record_repositories WHERE id = ?', [repoId]);
  if (!repo) return res.status(404).json({ error: 'Repository not found' });
  try {
    var result = await require('../services/schemaDiscovery').scanRepository(repo);
    if (result.error) return res.status(400).json(result);
    await audit('repository', repo.id, 'discover-scan', req, { scanned: result.scanned, created: result.created.length, matched: result.matched.length });
    res.json(Object.assign({ repository: repo.name }, result));
  } catch (e) {
    res.status(500).json({ error: 'Repository scan failed', details: e.message });
  }
});

router.get('/repositories', requireAuth, async function(req, res) {
  var repos = await all("SELECT id, name, connector_type, status FROM record_repositories ORDER BY sort_order, name");
  res.json({ repositories: repos });
});

module.exports = router;
