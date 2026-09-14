const express = require('express');
const router = express.Router();
// The Taxonomy screen is a LIST screen and carries THREE hub rows (approval model, SPEC_setup_hub §3e/§3g):
// Taxonomy, calibration, and record ownership all read the same record types, so every mutation here reports
// all three. Router-level finish hook, after the response — best effort.
router.use(function (req, res, next) {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].indexOf(req.method) !== -1) {
    res.on('finish', function () { if (res.statusCode < 300) { try { var HUBt = require('../services/setupHub'); ['taxonomy', 'calibration', 'record_owners'].forEach(function (k) { HUBt.afterChange(k, req.user && (req.user.name || req.user.email)).catch(function () {}); }); } catch (e) {} } });
  }
  next();
});
const { get, all, run } = require('../db');
const { requireAuth, requireTaxonomyEdit } = require('../middleware/auth');
// EDIT = the taxonomy-edit gate (SYSTEM_ADMIN/DIRECTOR). Every write below takes it; reads and the
// compute-only variant scan (discover-variants proposes, inserts nothing) stay requireAuth.
const EDIT = requireTaxonomyEdit;
const { v4: uuidv4 } = require('uuid');
const embedIndex = require('../services/embedIndex');

var ARRAY_FIELDS = ['synonyms','disambiguators','keywords','identifying_facets','formats'];
// auto_publish + mappable moved here from the PATCH fields list (2026-09-04): they are INTEGER columns,
// and the editor sends booleans — a raw `false` bound into an integer column 500'd every record-type save.
var BOOL_FIELDS = ['is_structured_data','auto_release_eligible','is_canonical','legal_redaction_required','auto_publish','mappable'];

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
    // A variant follows its PARENT's routing (Kevin 2026-09-13) — the same walk-up the classifier catalog,
    // the library shelf and redaction templates already do; the list used to show "No owning dept" for it.
    var inherit = !!(rt.parent_record_type_id && !ownerOf[rt.id] && !fulfillerOf[rt.id]);
    var src = inherit ? rt.parent_record_type_id : rt.id;
    rt.routing_inherited = inherit;
    var ownerId = ownerOf[src] || null;
    var ownerDept = ownerId ? dById[ownerId] : null;
    rt.owner_department_id = ownerId;
    rt.owner_department_name = ownerDept ? ownerDept.name : null;
    var overrideId = fulfillerOf[src] || null;
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

router.post('/categories', requireAuth, EDIT, async function(req, res) {
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

router.patch('/categories/:id', requireAuth, EDIT, async function(req, res) {
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

router.delete('/categories/:id', requireAuth, EDIT, async function(req, res) {
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

// TAXONOMY VARIANTS (#14): a record type may name a parent, becoming a VARIANT of that bucket.
// One level only, no self-reference, and a bucket with variants cannot itself become a variant.
// A variant always sits in its parent's category — aligned here, not trusted from the client.
// Returns: undefined (field untouched) · null (explicit clear) · the parent row.
async function resolveParent(b, selfId) {
  if (b.parent_record_type_id === undefined) return undefined;
  if (!b.parent_record_type_id) return null;
  var p = await get('SELECT id, category_id, parent_record_type_id FROM record_types WHERE id = ?', [b.parent_record_type_id]);
  if (!p) throw new Error('Parent record type not found');
  if (selfId && p.id === selfId) throw new Error('A record type cannot be its own parent');
  if (p.parent_record_type_id) throw new Error('That type is itself a variant — variants go one level deep, so pick its parent instead');
  if (selfId) {
    var kid = await get('SELECT id FROM record_types WHERE parent_record_type_id = ? LIMIT 1', [selfId]);
    if (kid) throw new Error('This type has variants of its own — a bucket cannot also become a variant');
  }
  return p;
}

router.post('/record-types', requireAuth, EDIT, async function(req, res) {
  var b = req.body;
  var name = (b.name || '').trim();
  var code = (b.code || '').trim();
  if (!b.category_id && !b.parent_record_type_id) return res.status(400).json({ error: 'category_id, name and code are required' });
  if (!name || !code) return res.status(400).json({ error: 'category_id, name and code are required' });
  var parent;
  try { parent = await resolveParent(b, null); } catch (pe) { return res.status(422).json({ error: pe.message }); }
  if (parent) b.category_id = parent.category_id; // a variant lives in its parent's category
  var cat = await get('SELECT id FROM categories WHERE id = ?', [b.category_id]);
  if (!cat) return res.status(400).json({ error: 'category_id does not exist' });
  var dup = await get('SELECT id FROM record_types WHERE code = ?', [code]);
  if (dup) return res.status(400).json({ error: 'A record type with that code already exists' });
  var id = nid('rt');
  var cols = 'id, category_id, name, code, description, intent, expected_content, typical_request_reason, synonyms, disambiguators, keywords, identifying_facets, formats, is_structured_data, public_availability, auto_release_eligible, redaction_profile_id, fee_estimate_low, fee_estimate_high, fee_estimate_note, is_canonical, status, source, confidence, sort_order, fulfillment_method, medium, legal_redaction_required, parent_record_type_id';
  var ph = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';
  var vals = [id, b.category_id, name, code, b.description || null, b.intent || null, b.expected_content || null, b.typical_request_reason || null,
    packArray(b.synonyms) || '[]', packArray(b.disambiguators) || '[]', packArray(b.keywords) || '[]', packArray(b.identifying_facets) || '[]', packArray(b.formats) || '[]',
    b.is_structured_data ? 1 : 0, b.public_availability || 'review_required', b.auto_release_eligible ? 1 : 0, b.redaction_profile_id || null,
    b.fee_estimate_low || 0, b.fee_estimate_high || 0, b.fee_estimate_note || null, b.is_canonical ? 1 : 0,
    b.status || 'active', b.source || 'manual', b.confidence !== undefined ? b.confidence : null, b.sort_order || 100,
    b.fulfillment_method || 'electronic_search', b.medium || 'electronic', b.legal_redaction_required ? 1 : 0,
    parent ? parent.id : null];
  await run('INSERT INTO record_types (' + cols + ') VALUES (' + ph + ')', vals);
  await audit('record_type', id, 'create', req, { name: name, code: code, source: b.source || 'manual' });
  embedIndex.bg(embedIndex.reindexRecordType(id), 'rt-create ' + id);
  res.json(hydrate(await get('SELECT * FROM record_types WHERE id = ?', [id])));
});

router.patch('/record-types/:id', requireAuth, EDIT, async function(req, res) {
  var rt = await get('SELECT * FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  var b = req.body;
  var fields = ['category_id','name','code','description','intent','expected_content','typical_request_reason','public_availability','redaction_profile_id','fee_estimate_note','status','source','confidence','sort_order','fee_estimate_low','fee_estimate_high','fulfillment_method','medium'];
  var sets = [], params = [];
  // #14 — parent changes are validated, never blind-set; a variant follows its parent's category.
  try {
    var parent = await resolveParent(b, rt.id);
    if (parent !== undefined) {
      sets.push('parent_record_type_id = ?'); params.push(parent ? parent.id : null);
      if (parent) { b.category_id = parent.category_id; }
    }
  } catch (pe) { return res.status(422).json({ error: pe.message }); }
  fields.forEach(function(f) { if (b[f] !== undefined) { sets.push(f + ' = ?'); params.push(b[f]); } });
  ARRAY_FIELDS.forEach(function(f) { if (b[f] !== undefined) { sets.push(f + ' = ?'); params.push(packArray(b[f])); } });
  BOOL_FIELDS.forEach(function(f) { if (b[f] !== undefined) { sets.push(f + ' = ?'); params.push(b[f] ? 1 : 0); } });
  if (!sets.length) return res.status(400).json({ error: 'No updatable fields supplied' });
  sets.push("updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')");
  params.push(rt.id);
  await run('UPDATE record_types SET ' + sets.join(', ') + ' WHERE id = ?', params);
  await audit('record_type', rt.id, 'update', req, b);
  embedIndex.bg(embedIndex.reindexRecordType(rt.id), 'rt-update ' + rt.id);
  res.json(hydrate(await get('SELECT * FROM record_types WHERE id = ?', [rt.id])));
});

// ===== EXAMPLE PREVIEW (Kevin 2026-09-04): open a REAL document behind a discovery proposal =====
// Streams a source-drive file so the proposals panel can show what a pile actually looks like.
// Guards, in order: taxonomy-edit gate (these are unredacted source documents — never citizen-facing);
// only files the fingerprint census has already indexed for that source (no free-range disk reads);
// bare basename only; the resolved path must stay inside the source's configured folder; PDF only
// (all a census pile can contain today — the inventory function's other formats will download, not preview).
router.get('/preview-source-file', requireAuth, EDIT, async function(req, res) {
  var pathMod = require('path'), fsMod = require('fs');
  var repoId = String(req.query.repository_id || ''), filename = String(req.query.filename || '');
  if (!repoId || !filename) return res.status(400).json({ error: 'repository_id and filename are required' });
  if (filename !== pathMod.basename(filename) || filename.indexOf('..') !== -1) return res.status(400).json({ error: 'Invalid filename' });
  if (!/\.pdf$/i.test(filename)) return res.status(415).json({ error: 'Only PDF examples can be previewed.' });
  var indexed = await get('SELECT id FROM document_fingerprints WHERE repository_id = ? AND filename = ?', [repoId, filename]);
  if (!indexed) return res.status(404).json({ error: 'That file is not in the discovery index for this source.' });
  var repo = await get('SELECT * FROM record_repositories WHERE id = ?', [repoId]);
  if (!repo) return res.status(404).json({ error: 'Source not found' });
  var cfg = {}; try { cfg = JSON.parse(repo.config || '{}'); } catch (e) {}
  if (!cfg.path) return res.status(400).json({ error: 'This source has no readable folder.' });
  var base = pathMod.resolve(cfg.path);
  var full = pathMod.resolve(base, filename);
  if (full !== pathMod.join(base, filename) || full.indexOf(base + pathMod.sep) !== 0) return res.status(400).json({ error: 'Invalid path' });
  if (!fsMod.existsSync(full)) return res.status(404).json({ error: 'File not found on the source' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="' + filename.replace(/"/g, '') + '"');
  fsMod.createReadStream(full).pipe(res);
});

router.delete('/record-types/:id', requireAuth, EDIT, async function(req, res) {
  var rt = await get('SELECT id FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  // #14 — deleting a bucket would orphan its variants' inheritance; refuse in words.
  var kids = await get('SELECT count(*)::int AS n FROM record_types WHERE parent_record_type_id = ?', [req.params.id]);
  if (kids && Number(kids.n) > 0) {
    return res.status(422).json({ error: 'This type has ' + kids.n + ' variant' + (Number(kids.n) === 1 ? '' : 's') + ' — remove or reassign them first.' });
  }
  await run('DELETE FROM record_type_departments WHERE record_type_id = ?', [req.params.id]);
  await run('DELETE FROM record_type_repositories WHERE record_type_id = ?', [req.params.id]);
  await run('DELETE FROM record_types WHERE id = ?', [req.params.id]);
  await audit('record_type', req.params.id, 'delete', req, null);
  embedIndex.bg(embedIndex.removeEmbedding('record_type', req.params.id), 'rt-delete ' + req.params.id);
  res.json({ success: true });
});

// ===== LINKS: departments (owner/fulfiller) =====
// A variant has no routing of its own (Kevin 2026-09-13): the owner and fulfilment team are its parent's.
var VARIANT_ROUTING_MSG = 'A variant follows its parent record type\'s routing — set the owning department and fulfillment team on the parent.';
router.post('/record-types/:id/departments', requireAuth, EDIT, async function(req, res) {
  var rt = await get('SELECT id, parent_record_type_id FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  if (rt.parent_record_type_id && (req.body.role === 'owner' || req.body.role === 'fulfiller' || !req.body.role)) return res.status(422).json({ error: VARIANT_ROUTING_MSG });
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

router.delete('/record-types/:id/departments/:linkId', requireAuth, EDIT, async function(req, res) {
  var link = await get('SELECT id FROM record_type_departments WHERE id = ? AND record_type_id = ?', [req.params.linkId, req.params.id]);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  await run('DELETE FROM record_type_departments WHERE id = ?', [req.params.linkId]);
  await audit('rt_department', req.params.linkId, 'delete', req, null);
  res.json({ success: true });
});

// ===== ROUTING: owning department + optional fulfillment team override =====
router.patch('/record-types/:id/routing', requireAuth, EDIT, async function(req, res) {
  var rt = await get('SELECT id, parent_record_type_id FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  if (rt.parent_record_type_id) return res.status(422).json({ error: VARIANT_ROUTING_MSG });
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

// ===== SOURCES: bulk-set which sources hold this record type =====
router.patch('/record-types/:id/sources', requireAuth, EDIT, async function(req, res) {
  var rt = await get('SELECT id FROM record_types WHERE id = ?', [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'Record type not found' });
  var ids = Array.isArray(req.body.repository_ids) ? req.body.repository_ids : [];
  await run('DELETE FROM record_type_repositories WHERE record_type_id = ?', [req.params.id]);
  for (var i = 0; i < ids.length; i++) {
    var repo = await get('SELECT id FROM record_repositories WHERE id = ?', [ids[i]]);
    if (repo) await run('INSERT INTO record_type_repositories (id, record_type_id, repository_id, format, filter_spec, sort_order) VALUES (?,?,?,?,?,?)', [nid('rr'), req.params.id, ids[i], null, '{}', 100]);
  }
  await audit('rt_sources', req.params.id, 'update', req, { repository_ids: ids });
  res.json({ success: true, repository_ids: ids });
});

// ===== LINKS: repositories (where it lives) =====
router.post('/record-types/:id/repositories', requireAuth, EDIT, async function(req, res) {
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

router.delete('/record-types/:id/repositories/:linkId', requireAuth, EDIT, async function(req, res) {
  var link = await get('SELECT id FROM record_type_repositories WHERE id = ? AND record_type_id = ?', [req.params.linkId, req.params.id]);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  await run('DELETE FROM record_type_repositories WHERE id = ?', [req.params.linkId]);
  await audit('rt_repository', req.params.linkId, 'delete', req, null);
  res.json({ success: true });
});

// ===== AI-ASSISTED SCHEMA DISCOVERY =====
// VARIANT GROUPINGS (#14 slice 2). Scan is READ-ONLY — it proposes, a human approves; nothing is
// inserted until the apply endpoint is called with one approved proposal.
router.post('/record-types/:id/discover-variants', requireAuth, async function(req, res) {
  try {
    var out = await require('../services/schemaDiscovery').discoverVariantGroupings(req.params.id);
    if (out.error) return res.status(422).json(out);
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Variant discovery failed: ' + (e && e.message) }); }
});
router.post('/record-types/:id/variants', requireAuth, EDIT, async function(req, res) {
  try {
    var rt = await require('../services/schemaDiscovery').applyGroupingProposal(req.params.id, req.body || {});
    await audit('record_type', rt.id, 'discover_variant', req, { name: rt.name, code: rt.code, parent: req.params.id });
    res.json(hydrate(rt));
  } catch (e) { res.status(422).json({ error: e.message }); }
});

router.post('/discover', requireAuth, EDIT, async function(req, res) {
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
    var message = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
    var raw = require('../services/aiText').textOf(message).replace(/```json|```/g, '').trim();
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
    embedIndex.bg(embedIndex.reindexRecordType(id), 'rt-discover ' + id);
    res.json({ matched_existing: false, draft: hydrate(await get('SELECT * FROM record_types WHERE id = ?', [id])), reasoning: p.reasoning || null });
  } catch (e) {
    console.error('Discover error:', e.message);
    res.status(500).json({ error: 'Schema discovery failed', details: e.message });
  }
});

router.post('/discover-scan', requireAuth, EDIT, async function(req, res) {
  var repoId = req.body && req.body.repository_id;
  if (!repoId) return res.status(400).json({ error: 'repository_id is required' });
  var repo = await get('SELECT id, name, connector_type, config FROM record_repositories WHERE id = ?', [repoId]);
  if (!repo) return res.status(404).json({ error: 'Repository not found' });
  try {
    var result = await require('../services/schemaDiscovery').scanRepository(repo);
    if (result.error) return res.status(400).json(result);
    await audit('repository', repo.id, 'discover-scan', req, { scanned: result.scanned, created: result.created.length, matched: result.matched.length, linked: result.linked });
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
