'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { all, get, run } = require('../db');
const { v4: uuidv4 } = require('uuid');
const F = require('../services/configFreshness');
const CE = require('../services/configExtractors');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
const ROLE = requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'DEPT_MANAGER');

router.get('/status', requireAuth, async function (req, res) {
  try {
    var jid = await F.activeJurisdiction();
    var sources = jid ? await all("SELECT * FROM config_sources WHERE jurisdiction_id = ? ORDER BY domain, label", [jid]) : [];
    var pending = await F.pendingSummary(jid);
    var lastRun = await get("SELECT * FROM config_freshness_runs ORDER BY created_at DESC LIMIT 1");
    if (lastRun && lastRun.summary_json) { try { lastRun.summary = JSON.parse(lastRun.summary_json); } catch (e) {} }
    var toRow = await get("SELECT value FROM system_config WHERE key = 'freshness_reminder_to'");
    var contact = await get("SELECT value FROM system_config WHERE key = 'contact_email'");
    res.json({ jurisdiction: jid, sources: sources || [], pending: pending, lastRun: lastRun || null, cadenceDays: await F.cadenceDays(), recipient: (toRow && toRow.value) || (contact && contact.value) || 'admin@optimumq.ai' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/run', requireAuth, ROLE, async function (req, res) {
  try { res.json(await F.runScan({ trigger: 'manual', actor: req.user && req.user.name })); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/sources', requireAuth, async function (req, res) {
  try { var jid = await F.activeJurisdiction(); res.json({ sources: jid ? await all("SELECT * FROM config_sources WHERE jurisdiction_id = ? ORDER BY domain, label", [jid]) : [] }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sources', requireAuth, ROLE, async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.domain || !b.label) return res.status(400).json({ error: 'domain and label are required' });
    if (b.id) { await run("UPDATE config_sources SET domain=?, label=?, url=?, active=?, notes=? WHERE id=?", [b.domain, b.label, b.url || null, b.active === false ? 0 : 1, b.notes || null, b.id]); return res.json({ id: b.id, updated: true }); }
    var jid = await F.activeJurisdiction();
    var id = 'src-' + uuidv4().slice(0, 8);
    await run("INSERT INTO config_sources (id, jurisdiction_id, domain, label, url, active, notes, created_at) VALUES (?,?,?,?,?,?,?,?)", [id, jid, b.domain, b.label, b.url || null, b.active === false ? 0 : 1, b.notes || null, nowStr()]);
    res.json({ id: id, created: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/sources/:id', requireAuth, ROLE, async function (req, res) {
  try { await run("DELETE FROM config_sources WHERE id = ?", [req.params.id]); res.json({ deleted: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/proposals', requireAuth, async function (req, res) {
  try {
    var jid = await F.activeJurisdiction();
    var status = req.query.status || 'pending';
    var rows = await all("SELECT * FROM config_proposals WHERE jurisdiction_id = ? AND status = ? ORDER BY created_at DESC", [jid, status]);
    res.json({ proposals: rows || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/proposals/:id/dismiss', requireAuth, ROLE, async function (req, res) {
  try { await run("UPDATE config_proposals SET status='dismissed', reviewed_by=?, reviewed_at=? WHERE id=?", [(req.user && req.user.name) || 'staff', nowStr(), req.params.id]); res.json({ dismissed: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

async function runCheck(jid, source, rawText, domain, actor) {
  domain = domain || (source && source.domain);
  var ad = CE.adapter(domain);
  if (!ad) throw new Error('Unknown domain: ' + domain);
  var fr = await CE.fetchSource(source || {}, rawText);
  if (!fr.ok) return { ok: false, error: fr.error };
  var hash = CE.hashText(fr.text);
  var changed = !(source && source.last_version_hash && source.last_version_hash === hash);
  var snapId = 'snap-' + uuidv4().slice(0, 8);
  await run("INSERT INTO config_source_snapshots (id, source_id, jurisdiction_id, domain, hash, text, fetched_at) VALUES (?,?,?,?,?,?,?)", [snapId, source ? source.id : null, jid, domain, hash, fr.text.slice(0, 100000), nowStr()]);
  if (source) await run("UPDATE config_sources SET last_checked_at = ?, last_version_hash = ?" + (changed ? ", last_change_at = ?" : "") + " WHERE id = ?", changed ? [nowStr(), hash, nowStr(), source.id] : [nowStr(), hash, source.id]);
  var ex = await ad.extract(jid, fr.text);
  var current = await ad.current(jid);
  var pid = 'prop-' + uuidv4().slice(0, 8);
  await run("INSERT INTO config_proposals (id, jurisdiction_id, domain, status, summary, proposed_json, current_json, source_ref, snapshot_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [pid, jid, domain, 'pending', ex.summary, JSON.stringify(ex.proposed), JSON.stringify(current), source ? source.id : '(pasted)', snapId, actor || 'scan', nowStr()]);
  return { ok: true, proposalId: pid, changed: changed, via: fr.via, summary: ex.summary };
}

router.post('/sources/:id/check', requireAuth, ROLE, async function (req, res) {
  try {
    var jid = await F.activeJurisdiction();
    var src = await get("SELECT * FROM config_sources WHERE id = ?", [req.params.id]);
    if (!src) return res.status(404).json({ error: 'source not found' });
    res.json(await runCheck(jid, src, (req.body && req.body.rawText) || null, src.domain, req.user && req.user.name));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/extract', requireAuth, ROLE, async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.domain || !b.rawText) return res.status(400).json({ error: 'domain and rawText are required' });
    var jid = await F.activeJurisdiction();
    res.json(await runCheck(jid, null, b.rawText, b.domain, req.user && req.user.name));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/proposals/:id', requireAuth, async function (req, res) {
  try {
    var pr = await get("SELECT * FROM config_proposals WHERE id = ?", [req.params.id]);
    if (!pr) return res.status(404).json({ error: 'not found' });
    var snap = pr.snapshot_id ? await get("SELECT text, hash, fetched_at FROM config_source_snapshots WHERE id = ?", [pr.snapshot_id]) : null;
    var ad = CE.adapter(pr.domain);
    var proposed = {}, current = {};
    try { proposed = JSON.parse(pr.proposed_json || '{}'); } catch (e) {}
    try { current = JSON.parse(pr.current_json || '{}'); } catch (e) {}
    res.json({ proposal: pr, proposed: proposed, current: current, snapshot: snap || null, applyTarget: ad ? ad.applyTarget : null, reviewOnly: !!(ad && !ad.apply), reviewOnlyNote: ad ? ad.reviewOnlyNote : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/proposals/:id/apply', requireAuth, ROLE, async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.attested) return res.status(400).json({ error: 'attestation is required before applying' });
    var pr = await get("SELECT * FROM config_proposals WHERE id = ?", [req.params.id]);
    if (!pr) return res.status(404).json({ error: 'not found' });
    if (pr.status !== 'pending') return res.status(400).json({ error: 'proposal already ' + pr.status });
    var ad = CE.adapter(pr.domain);
    if (!ad || !ad.apply) return res.status(400).json({ error: 'This domain is review-only; apply the change in its area editor.', reviewOnly: true });
    var cfg = b.editedConfig; if (cfg == null) { try { cfg = JSON.parse(pr.proposed_json || '{}'); } catch (e) { cfg = {}; } }
    var result = await ad.apply(pr.jurisdiction_id, cfg, req.user && req.user.name);
    var actor = (req.user && req.user.name) || 'staff';
    await run("UPDATE config_proposals SET status='applied', applied_json=?, attested_by=?, attested_at=?, reviewed_by=?, reviewed_at=? WHERE id=?", [JSON.stringify(cfg), actor, nowStr(), actor, nowStr(), pr.id]);
    res.json({ applied: true, target: result && result.target });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
