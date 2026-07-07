const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all, get, run } = require('../db');
const catalog = require('../services/connectors/registry');

const fs = require('fs');
const path = require('path');
const IMPORT_BASE = path.join(__dirname, '../../../imports');
function nid(){ return 'repo-' + Math.random().toString(36).slice(2, 10); }

// For Import sources: user provides a subdirectory NAME; we prepend a managed base,
// sanitize (no traversal), create the folder, and set config.path. Push targets this folder.
function prepImportConfig(connectorType, cfg){
  if (connectorType !== 'import') return cfg;
  cfg = cfg || {};
  var raw = String(cfg.subdir || '').trim();
  var safe = raw.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\\s+/g, '-');
  if (safe) {
    var full = path.join(IMPORT_BASE, safe);
    if (full.indexOf(IMPORT_BASE + path.sep) === 0) {
      try { fs.mkdirSync(full, { recursive: true }); } catch(e){ /* dir create best-effort */ }
      cfg.path = full;
      cfg.subdir = safe;
    }
  }
  return cfg;
}

function slugify(x){ return String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40); }
// Create a new record type inline (if requested) and set cfg.record_type_id; clear the new_* fields.
async function resolveImportType(connectorType, cfg){
  if (connectorType !== 'import') return cfg;
  cfg = cfg || {};
  if (!cfg.record_type_id && cfg.new_record_type_name) {
    var newId = 'rt-' + Math.random().toString(36).slice(2,10);
    var code = slugify(cfg.new_record_type_name) + '-' + Math.random().toString(36).slice(2,6);
    var catId = cfg.new_record_type_category || 'cat-governance';
    try {
      await run("INSERT INTO record_types (id, category_id, name, code, description, synonyms, disambiguators, keywords, identifying_facets, formats, is_structured_data, public_availability, auto_release_eligible, status, source, sort_order, fulfillment_method, medium) VALUES (?,?,?,?,?, '[]','[]','[]','[]','[]', 0, 'review_required', 0, 'active', 'import', 100, 'electronic_search', 'electronic')",
        [newId, catId, String(cfg.new_record_type_name).slice(0,200), code, cfg.new_record_type_description || null]);
      cfg.record_type_id = newId;
    } catch(e){ console.error('[import type create]', e && e.message); }
  }
  delete cfg.new_record_type_name; delete cfg.new_record_type_description; delete cfg.new_record_type_category;
  return cfg;
}
// Ensure the source<->record-type link exists.
async function linkImportType(repoId, connectorType, cfg){
  if (connectorType !== 'import' || !cfg || !cfg.record_type_id || !repoId) return;
  var ex = await get("SELECT id FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?", [cfg.record_type_id, repoId]);
  if (!ex) { try { await run("INSERT INTO record_type_repositories (id, record_type_id, repository_id, format, filter_spec, sort_order) VALUES (?,?,?,?,?,?)", ['rr-' + Math.random().toString(36).slice(2,10), cfg.record_type_id, repoId, null, '{}', 100]); } catch(e){ console.error('[import type link]', e && e.message); } }
}

router.get('/catalog', requireAuth, function(req, res){ res.json({ catalog: catalog }); });

router.get('/', requireAuth, async function(req, res){
  var rows = await all('SELECT * FROM record_repositories ORDER BY sort_order, name');
  rows.forEach(function(r){ try { r.config = r.config ? JSON.parse(r.config) : {}; } catch(e){ r.config = {}; } });
  res.json({ repositories: rows });
});

router.post('/', requireAuth, async function(req, res){
  var b = req.body || {};
  if (!b.name || !b.connector_type) return res.status(400).json({ error: 'name and connector_type are required' });
  var id = b.id || nid();
  var cfgObj = typeof b.config === 'string' ? (function(){ try { return JSON.parse(b.config||'{}'); } catch(e){ return {}; } })() : (b.config || {});
  cfgObj = prepImportConfig(b.connector_type, cfgObj);
  cfgObj = await resolveImportType(b.connector_type, cfgObj);
  if (b.connector_type === 'import' && cfgObj.end_to_end && !cfgObj.review_assignee && req.user && req.user.sub) cfgObj.review_assignee = req.user.sub; // default reviewer to the saver
  var config = JSON.stringify(cfgObj);
  try {
    await run('INSERT INTO record_repositories (id, name, connector_type, status, config, sort_order, description) VALUES (?,?,?,?,?,?,?)', [id, b.name, b.connector_type, b.status || 'active', config, b.sort_order || 50, b.description || '']);
  } catch(e){ return res.status(400).json({ error: String(e.message || e) }); }
  await linkImportType(id, b.connector_type, cfgObj);
  var row = await get('SELECT * FROM record_repositories WHERE id = ?', [id]);
  res.json({ repository: row });
});

router.patch('/:id', requireAuth, async function(req, res){
  var b = req.body || {};
  var sets = [], vals = [];
  ['name','connector_type','status','sort_order','description'].forEach(function(f){ if (b.hasOwnProperty(f)) { sets.push(f + ' = ?'); vals.push(b[f]); } });
  if (b.hasOwnProperty('config')) {
    var ctype = b.connector_type;
    if (!ctype) { var exr = await get('SELECT connector_type FROM record_repositories WHERE id = ?', [req.params.id]); ctype = exr && exr.connector_type; }
    var cfgO = typeof b.config === 'string' ? (function(){ try { return JSON.parse(b.config||'{}'); } catch(e){ return {}; } })() : (b.config || {});
    cfgO = prepImportConfig(ctype, cfgO);
    cfgO = await resolveImportType(ctype, cfgO);
    if (ctype === 'import' && cfgO.end_to_end && !cfgO.review_assignee && req.user && req.user.sub) cfgO.review_assignee = req.user.sub; // default reviewer to the saver
    await linkImportType(req.params.id, ctype, cfgO);
    sets.push('config = ?'); vals.push(JSON.stringify(cfgO));
  }
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  await run('UPDATE record_repositories SET ' + sets.join(', ') + ' WHERE id = ?', vals);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, async function(req, res){
  await run('DELETE FROM record_repositories WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.post('/ai-configure', requireAuth, async function(req, res) {
  var b = req.body || {};
  var desc = (b.description || '').toString().trim();
  if (!desc) return res.status(400).json({ error: 'description is required' });
  var docs = (b.documentation || '').toString().substring(0, 12000);
  var keys = catalog.map(function(c){ return c.key; });
  var catalogText = catalog.map(function(c){ return c.key + ': ' + c.label + ' - ' + c.description + ' | fields: ' + (c.fields||[]).map(function(f){ return f.key; }).join(', ') + ' | capabilities: ' + (c.capabilities||[]).join(','); }).join('\n');
  var prompt = 'You help configure a data-source connector for a public-records system. Based on the description and any documentation of the system, choose the best connector type from the catalog and propose a configuration. Return ONLY a JSON object, no other text.\n\nConnector catalog:\n' + catalogText + '\n\nReturn JSON: {"connector_type":"<key>","name":"<suggested name>","config":{},"reasoning":"<one or two sentences>","missing":[]}\n\nRules:\n- connector_type MUST be one of: ' + keys.join(', ') + '.\n- Fill config fields you can infer; leave unknown ones out and list their keys in missing.\n- NEVER invent credentials or secrets; leave api_key or password-like fields empty and list them in missing.\n\nSystem description:\n' + desc + (docs ? ('\n\nDocumentation:\n' + docs) : '');
  try {
    var Anthropic = require('@anthropic-ai/sdk');
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var message = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] });
    var raw = message.content[0].text.trim().replace(/```json|```/g, '').trim();
    var p = JSON.parse(raw);
    if (keys.indexOf(p.connector_type) < 0) p.connector_type = keys[0];
    if (!p.config || typeof p.config !== 'object') p.config = {};
    if (!Array.isArray(p.missing)) p.missing = [];
    res.json({ proposal: p });
  } catch (e) {
    res.status(500).json({ error: 'AI configuration failed', details: e.message });
  }
});

// --- Paper Records Index import/list ---
function parseCsv(text) {
  var rows = [], field = '', row = [], inQ = false, i = 0;
  text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < text.length) {
    var ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i+1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function(r){ return r.length && !(r.length === 1 && r[0].trim() === ''); });
}

function piId(){ return 'pi-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

router.post('/:id/paper-index/import', requireAuth, async function(req, res){
  var repoId = req.params.id;
  var repo = await get('SELECT id, connector_type FROM record_repositories WHERE id = ?', [repoId]);
  if (!repo) return res.status(404).json({ error: 'source not found' });
  var items = [];
  if (Array.isArray(req.body.items)) {
    items = req.body.items;
  } else if (req.body.csv) {
    var rows = parseCsv(req.body.csv);
    if (rows.length < 2) return res.status(400).json({ error: 'CSV needs a header row and at least one data row' });
    var headers = rows[0].map(function(h){ return h.trim().toLowerCase(); });
    function col(r, names){ for (var j = 0; j < names.length; j++){ var idx = headers.indexOf(names[j]); if (idx >= 0 && r[idx] != null) return String(r[idx]).trim(); } return ''; }
    for (var k = 1; k < rows.length; k++) {
      var r = rows[k];
      items.push({
        title: col(r, ['title','file title','name','record']),
        description: col(r, ['description','desc','summary','contents']),
        location: col(r, ['location','storage location','shelf']),
        record_date: col(r, ['date','record_date','year','record date']),
        box: col(r, ['box','box number','box #','carton']),
        folder: col(r, ['folder','file','folder number','file number']),
        tags: col(r, ['tags','keywords'])
      });
    }
  } else {
    return res.status(400).json({ error: 'provide csv text or an items array' });
  }
  items = items.filter(function(it){ return it && (it.title || it.description); });
  await run('DELETE FROM paper_index_items WHERE repository_id = ?', [repoId]);
  var now = new Date().toISOString();
  for (var x = 0; x < items.length; x++) {
    var it = items[x];
    await run('INSERT INTO paper_index_items (id, repository_id, title, description, location, record_date, box, folder, tags, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [piId(), repoId, it.title||'', it.description||'', it.location||'', it.record_date||'', it.box||'', it.folder||'', it.tags||'', now]);
  }
  res.json({ success: true, imported: items.length });
});

router.get('/:id/paper-index', requireAuth, async function(req, res){
  var repoId = req.params.id;
  var cnt = await get('SELECT COUNT(*) AS n FROM paper_index_items WHERE repository_id = ?', [repoId]);
  var items = await all('SELECT id, title, description, location, record_date, box, folder, tags FROM paper_index_items WHERE repository_id = ? ORDER BY title LIMIT 20', [repoId]);
  res.json({ count: cnt ? Number(cnt.n) : 0, items: items });
});

var importIngest = require('../services/importIngest');
// Import ingestion (increment 3): run-now + status for Import sources
router.post('/:id/ingest/run', requireAuth, async function(req, res){
  try { res.json(await importIngest.runIngest(req.params.id)); }
  catch(e){ console.error('[ingest/run]', e && e.message); res.status(500).json({ error: 'Ingestion failed to run.' }); }
});
router.get('/:id/ingest/status', requireAuth, async function(req, res){
  try { res.json(await importIngest.status(req.params.id)); }
  catch(e){ res.status(500).json({ error: 'Could not load ingestion status.' }); }
});

module.exports = router;
