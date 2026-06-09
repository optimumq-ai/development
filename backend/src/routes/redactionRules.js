// Redaction Rules Library API: rules (what to redact) + categories + legal sources (many-to-many),
// scoped to the active jurisdiction, with a pending-review -> approved workflow.
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

// GET / -> rules (optionally filtered by category/status) + library stats
router.get('/rules', requireAuth, async function(req, res) {
  var jur = await activeJurisdiction();
  var where = 'WHERE jurisdiction_id = ?'; var params = [jur];
  if (req.query.category) { where += ' AND category = ?'; params.push(req.query.category); }
  if (req.query.status) { where += ' AND status = ?'; params.push(req.query.status); }
  var rules = await all('SELECT * FROM redaction_rules ' + where + ' ORDER BY sort_order, title', params);
  var labels = await categoryLabels();
  var srcMap = await sourcesForRules(rules.map(function(r){ return r.id; }));
  var out = rules.map(function(r){
    return {
      id: r.id, title: r.title, description: r.description,
      category: r.category, category_label: labels[r.category] || r.category,
      status: r.status, source: r.source,
      approved_by: r.approved_by, approved_at: r.approved_at,
      legal_sources: srcMap[r.id] || []
    };
  });
  var allRules = await all('SELECT status FROM redaction_rules WHERE jurisdiction_id = ?', [jur]);
  var catCount = await get('SELECT count(*) AS c FROM redaction_categories');
  var stats = {
    total: allRules.length,
    active: allRules.filter(function(x){ return x.status === 'approved'; }).length,
    pending: allRules.filter(function(x){ return x.status === 'pending_review'; }).length,
    categories: catCount ? catCount.c : 0
  };
  res.json({ jurisdiction: jur, stats: stats, rules: out });
});

// GET /categories -> the standard category set
router.get('/categories', requireAuth, async function(req, res) {
  var cats = await all('SELECT id, key, label, sort_order FROM redaction_categories ORDER BY sort_order');
  res.json({ categories: cats });
});

// GET /legal-sources -> Legal Source Index: each source with the rules it backs
router.get('/legal-sources', requireAuth, async function(req, res) {
  var jur = await activeJurisdiction();
  var sources = await all('SELECT id, name, citation, source_type, description FROM legal_sources WHERE jurisdiction_id = ? ORDER BY name', [jur]);
  var links = await all('SELECT rls.legal_source_id, rr.id, rr.title, rr.category, rr.status FROM rule_legal_sources rls JOIN redaction_rules rr ON rr.id = rls.rule_id WHERE rr.jurisdiction_id = ?', [jur]);
  var map = {};
  links.forEach(function(l){ (map[l.legal_source_id] = map[l.legal_source_id] || []).push({ id: l.id, title: l.title, category: l.category, status: l.status }); });
  var out = sources.map(function(s){ return Object.assign({}, s, { rules: map[s.id] || [] }); });
  res.json({ total_sources: sources.length, total_rules: (await all('SELECT id FROM redaction_rules WHERE jurisdiction_id = ?', [jur])).length, sources: out });
});

// POST /rules -> add a rule (enters as pending_review); optional single legal basis citation
router.post('/rules', requireAuth, async function(req, res) {
  var b = req.body || {};
  if (!b.title || !b.description) return res.status(400).json({ error: 'title and description are required' });
  var jur = await activeJurisdiction();
  var ruleId = uuidv4();
  await run('INSERT INTO redaction_rules (id, jurisdiction_id, title, description, category, status, source) VALUES (?,?,?,?,?,?,?)',
    [ruleId, jur, b.title, b.description, b.category || 'administrative', 'pending_review', 'manual']);
  if (b.legal_basis) {
    var existing = await get('SELECT id FROM legal_sources WHERE jurisdiction_id = ? AND citation = ?', [jur, b.legal_basis]);
    var sourceId = existing ? existing.id : uuidv4();
    if (!existing) {
      await run('INSERT INTO legal_sources (id, jurisdiction_id, name, citation, source_type, source) VALUES (?,?,?,?,?,?)',
        [sourceId, jur, b.legal_basis, b.legal_basis, 'statute', 'manual']);
    }
    await run('INSERT INTO rule_legal_sources (id, rule_id, legal_source_id) VALUES (?,?,?)', [uuidv4(), ruleId, sourceId]);
  }
  res.json({ success: true, id: ruleId, status: 'pending_review' });
});

// PATCH /rules/:id/approve -> approve a pending rule (elevated roles only)
router.patch('/rules/:id/approve', requireAuth, async function(req, res) {
  if (!isElevated(req)) return res.status(403).json({ error: 'Only a supervisor can approve redaction rules' });
  var rule = await get('SELECT id FROM redaction_rules WHERE id = ?', [req.params.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  await run("UPDATE redaction_rules SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [req.user.sub, req.params.id]);
  res.json({ success: true, status: 'approved' });
});

module.exports = router;
