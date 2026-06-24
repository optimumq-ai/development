'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { all, get, run } = require('../db');
const { v4: uuidv4 } = require('uuid');
const F = require('../services/configFreshness');

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

module.exports = router;
