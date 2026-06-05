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
  var rows = await all('SELECT rt.*, c.name AS category_name, (SELECT d.name FROM record_type_departments rd JOIN departments d ON d.id = rd.department_id WHERE rd.record_type_id = rt.id AND rd.role = \'owner\' ORDER BY rd.sort_order LIMIT 1) AS owner_department_name FROM record_types rt LEFT JOIN categories c ON c.id = rt.category_id' + where + ' ORDER BY rt.sort_order, rt.name', params);
  res.json({ record_types: rows.map(hydrate) });
});

router.get('/record-types/:id', requireAuth, async function(req, res) {
  var rt = await get('SELECT rt.*, c.name AS category_name FROM record_types rt LEFT JOIN categories c ON c.id = rt.category_id WHERE rt.id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  hydrate(rt);
  rt.departments = await all('SELECT rd.*, d.name AS department_name FROM record_type_departments rd LEFT JOIN departments d ON d.id = rd.department_id WHERE rd.record_type_id = ? ORDER BY rd.role, rd.sort_order', [rt.id]);
  rt.repositories = await all('SELECT rr.*, rp.name AS repository_name FROM record_type_repositories rr LEFT JOIN record_repositories rp ON rp.id = rr.repository_id WHERE rr.record_type_id = ? ORDER BY rr.sort_order', [rt.id]);
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
  var cols = 'id, category_id, name, code, description, intent, expected_content, typical_request_reason, synonyms, disambiguators, keywords, identifying_facets, formats, is_structured_data, public_availability, auto_release_eligible, redaction_profile_id, fee_estimate_low, fee_estimate_high, fee_estimate_note, is_canonical, status, source, confidence, sort_order';
  var ph = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';
  var vals = [id, b.category_id, name, code, b.description || null, b.intent || null, b.expected_content || null, b.typical_request_reason || null,
    packArray(b.synonyms) || '[]', packArray(b.disambiguators) || '[]', packArray(b.keywords) || '[]', packArray(b.identifying_facets) || '[]', packArray(b.formats) || '[]',
    b.is_structured_data ? 1 : 0, b.public_availability || 'review_required', b.auto_release_eligible ? 1 : 0, b.redaction_profile_id || null,
    b.fee_estimate_low || 0, b.fee_estimate_high || 0, b.fee_estimate_note || null, b.is_canonical ? 1 : 0,
    b.status || 'active', b.source || 'manual', b.confidence !== undefined ? b.confidence : null, b.sort_order || 100];
  await run('INSERT INTO record_types (' + cols + ') VALUES (' + ph + ')', vals);
  await audit('record_type', id, 'create', req, { name: name, code: code, source: b.source || 'manual' });
  res.json(hydrate(await get('SELECT * FROM record_types WHERE id = ?', [id])));
});

router.patch('/record-types/:id', requireAuth, async function(req, res) {
  var rt = await get('SELECT * FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  var b = req.body;
  var fields = ['category_id','name','code','description','intent','expected_content','typical_request_reason','public_availability','redaction_profile_id','fee_estimate_note','status','source','confidence','sort_order','fee_estimate_low','fee_estimate_high'];
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

module.exports = router;
