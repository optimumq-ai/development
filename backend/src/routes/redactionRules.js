// Redaction Rules Library API. Rules (what to redact) + categories + legal sources (many-to-many),
// scoped to the active jurisdiction. approval_status (approved|pending_review|rejected) is separate
// from is_active (in effect). New rules enter pending_review + inactive; a supervisor approves them.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');

async function activeJurisdiction() {
  var row = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  return (row && row.value) || 'jur-tx';
}

function isElevated(req) {
  var roles = req.user.roles || [];
  return ['SUPERVISOR','DIRECTOR','SYSTEM_ADMIN'].some(function(r){ return roles.indexOf(r) !== -1; });
}

async function sourcesForRules(ruleIds) {
  if (!ruleIds.length) return {};
  var ph = ruleIds.map(function(){ return '?'; }).join(',');
  var rows = await all('SELECT rls.rule_id, ls.id, ls.name, ls.citation, ls.source_type FROM rule_legal_sources rls JOIN legal_sources ls ON ls.id = rls.legal_source_id WHERE rls.rule_id IN (' + ph + ')', ruleIds);
  var map = {};
  rows.forEach(function(r){ (map[r.rule_id] = map[r.rule_id] || []).push({ id: r.id, name: r.name, citation: r.citation, source_type: r.source_type }); });
  return map;
}

async function categoryLabels() {
  var rows = await all('SELECT key, label FROM redaction_categories');
  var m = {}; rows.forEach(function(r){ m[r.key] = r.label; }); return m;
}

// GET /rules -> rules (filterable) + library stats
router.get('/rules', requireAuth, async function(req, res) {
  var jur = await activeJurisdiction();
  var where = 'WHERE jurisdiction_id = ?'; var params = [jur];
  if (req.query.category) { where += ' AND category = ?'; params.push(req.query.category); }
  if (req.query.status) { where += ' AND approval_status = ?'; params.push(req.query.status); }
  if (req.query.pending === '1') { where += " AND approval_status = 'pending_review'"; }
  var rules = await all('SELECT * FROM redaction_rules ' + where + ' ORDER BY category, sort_order, title', params);
  var labels = await categoryLabels();
  var srcMap = await sourcesForRules(rules.map(function(r){ return r.id; }));
  var out = rules.map(function(r){
    return {
      id: r.id, title: r.title, description: r.description,
      category: r.category, category_label: labels[r.category] || r.category,
      approval_status: r.approval_status, is_active: !!r.is_active,
      source: r.source, approved_by: r.approved_by, approved_at: r.approved_at,
      effective_date: r.effective_date, expiration_date: r.expiration_date,
      source_document: r.source_document,
      legal_sources: srcMap[r.id] || []
    };
  });
  var allRules = await all('SELECT approval_status, is_active, category FROM redaction_rules WHERE jurisdiction_id = ?', [jur]);
  var cats = {}; allRules.forEach(function(x){ if (x.category) cats[x.category] = 1; });
  var stats = {
    total: allRules.length,
    active: allRules.filter(function(x){ return !!x.is_active; }).length,
    pending: allRules.filter(function(x){ return x.approval_status === 'pending_review'; }).length,
    categories: Object.keys(cats).length
  };
  res.json({ jurisdiction: jur, stats: stats, rules: out });
});

// GET /categories -> the standard category set
router.get('/categories', requireAuth, async function(req, res) {
  var cats = await all('SELECT id, key, label, sort_order FROM redaction_categories ORDER BY sort_order');
  res.json({ categories: cats });
});

// GET /legal-sources -> Legal Source Index: each source with the rules that cite it
router.get('/legal-sources', requireAuth, async function(req, res) {
  var jur = await activeJurisdiction();
  var sources = await all('SELECT id, name, citation, source_type, description FROM legal_sources WHERE jurisdiction_id = ? ORDER BY name', [jur]);
  var links = await all('SELECT rls.legal_source_id, rr.id, rr.title, rr.category, rr.approval_status, rr.is_active FROM rule_legal_sources rls JOIN redaction_rules rr ON rr.id = rls.rule_id WHERE rr.jurisdiction_id = ?', [jur]);
  var map = {};
  links.forEach(function(l){ (map[l.legal_source_id] = map[l.legal_source_id] || []).push({ id: l.id, title: l.title, category: l.category, approval_status: l.approval_status, is_active: !!l.is_active }); });
  var out = sources.map(function(s){ return Object.assign({}, s, { rules: map[s.id] || [] }); });
  res.json({ total_sources: sources.length, total_rules: (await all('SELECT id FROM redaction_rules WHERE jurisdiction_id = ?', [jur])).length, sources: out });
});

// POST /rules -> add a rule (enters pending_review + inactive). legal_basis may be ';'-separated.
router.post('/rules', requireAuth, async function(req, res) {
  var b = req.body || {};
  if (!b.title || !b.description) return res.status(400).json({ error: 'title and description are required' });
  var jur = await activeJurisdiction();
  var ruleId = uuidv4();
  await run('INSERT INTO redaction_rules (id, jurisdiction_id, title, description, category, approval_status, is_active, source) VALUES (?,?,?,?,?,?,?,?)',
    [ruleId, jur, b.title, b.description, b.category || 'administrative', 'pending_review', 0, 'manual']);
  var citations = (b.legal_basis || '').split(';').map(function(s){ return s.trim(); }).filter(Boolean);
  for (var i = 0; i < citations.length; i++) {
    var c = citations[i];
    var existing = await get('SELECT id FROM legal_sources WHERE jurisdiction_id = ? AND citation = ?', [jur, c]);
    var sourceId = existing ? existing.id : uuidv4();
    if (!existing) await run('INSERT INTO legal_sources (id, jurisdiction_id, name, citation, source_type, source) VALUES (?,?,?,?,?,?)', [sourceId, jur, c, c, 'statute', 'manual']);
    await run('INSERT INTO rule_legal_sources (id, rule_id, legal_source_id) VALUES (?,?,?)', [uuidv4(), ruleId, sourceId]);
  }
  res.json({ success: true, id: ruleId, approval_status: 'pending_review', is_active: false });
});

// PATCH /rules/:id/approve -> approve a pending rule (elevated)
router.patch('/rules/:id/approve', requireAuth, async function(req, res) {
  if (!isElevated(req)) return res.status(403).json({ error: 'Only a supervisor can approve redaction rules' });
  var rule = await get('SELECT id FROM redaction_rules WHERE id = ?', [req.params.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  await run("UPDATE redaction_rules SET approval_status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [req.user.name || req.user.sub, req.params.id]);
  res.json({ success: true, approval_status: 'approved' });
});

// PATCH /rules/:id -> general field update incl. activate/deactivate (elevated)
router.patch('/rules/:id', requireAuth, async function(req, res) {
  if (!isElevated(req)) return res.status(403).json({ error: 'Only a supervisor can modify redaction rules' });
  var rule = await get('SELECT id FROM redaction_rules WHERE id = ?', [req.params.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  var b = req.body || {};
  var allowed = ['title','description','category','approval_status','source_document','effective_date','expiration_date'];
  var sets = [], params = [];
  allowed.forEach(function(f){ if (b[f] !== undefined) { sets.push(f + ' = ?'); params.push(b[f]); } });
  if (b.is_active !== undefined) { sets.push('is_active = ?'); params.push(b.is_active ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: 'no updatable fields provided' });
  sets.push("updated_at = datetime('now')");
  params.push(req.params.id);
  await run('UPDATE redaction_rules SET ' + sets.join(', ') + ' WHERE id = ?', params);
  res.json({ success: true });
});

// DELETE /rules/:id -> permanent delete (elevated)
router.delete('/rules/:id', requireAuth, async function(req, res) {
  if (!isElevated(req)) return res.status(403).json({ error: 'Only a supervisor can delete redaction rules' });
  await run('DELETE FROM rule_legal_sources WHERE rule_id = ?', [req.params.id]);
  await run('DELETE FROM redaction_rules WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
