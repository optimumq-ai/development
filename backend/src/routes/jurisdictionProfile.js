'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { get } = require('../db');
const JP = require('../services/jurisdictionProfile');
const enforcement = require('../services/enforcement');
const ROLE = requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'DEPT_MANAGER');
const ATTEST = requireRole('SYSTEM_ADMIN', 'DIRECTOR');
const SADMIN = requireRole('SYSTEM_ADMIN');

async function activeJid() { var r = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'"); return (r && r.value) || null; }

// --- literal routes FIRST (must precede the /:jid wildcard) ---
router.get('/status', requireAuth, async function (req, res) {
  try { res.json(await JP.getProfile(await activeJid())); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/sync', requireAuth, ROLE, async function (req, res) {
  try { var jid = await activeJid(); await JP.sync(jid, { actor: req.user && req.user.name }); res.json(await JP.getProfile(jid)); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/attest', requireAuth, ATTEST, async function (req, res) {
  try { var jid = await activeJid(); await JP.attest(jid, req.body && req.body.section, req.user && req.user.name); res.json(await JP.getProfile(jid)); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/unattest', requireAuth, ATTEST, async function (req, res) {
  try { var jid = await activeJid(); await JP.unattest(jid, req.body && req.body.section); res.json(await JP.getProfile(jid)); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/enforcement', requireAuth, async function (req, res) {
  try { res.json({ devMode: await enforcement.devMode() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/enforcement', requireAuth, SADMIN, async function (req, res) {
  try { var on = !!(req.body && (req.body.devMode === true || req.body.devMode === '1' || req.body.on === true)); var v = await enforcement.setDevMode(on); res.json({ devMode: v }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// PHASE 7 / WS2 — the state's branch profile and eligibility gate, as the ENGINE sees them. Read-only:
// what a config surface holds is edited through its own domain, and what an operator needs here is the
// resolved answer — which of the 25 ▲ branches this state has, which capabilities that switches on or off,
// and which eligibility dimensions would actually refuse a request today versus merely advise.
router.get('/branch-profile', requireAuth, async function (req, res) {
  try {
    var BP = require('../services/branchProfile');
    var jid = req.query.jid || await activeJid();
    var p = await BP.profile(jid);
    res.json({ profile: p, capabilities: BP.CAPABILITIES, stageCapability: BP.STAGE_CAPABILITY,
               unavailableStages: (await Promise.all(require('../services/stages').ORDER.map(async function (s) {
                 return (await BP.stageBlocked(jid, s)) ? s : null; }))).filter(Boolean) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/eligibility', requireAuth, async function (req, res) {
  try {
    var EG = require('../services/eligibilityGate');
    var jid = req.query.jid || await activeJid();
    var cfg = await EG.config(jid);
    var enforcing = Object.keys(cfg.dimensions).filter(function (d) {
      var x = cfg.dimensions[d]; return x.gated && x.confirmed && x.action !== 'advise';
    });
    res.json({ config: cfg, dimensions: EG.DIMENSIONS, actions: EG.ACTIONS, enforcing: enforcing });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PHASE 7 / WS4 — the fee-waiver and commercial-rate approval modules. GET shows the effective config
// (including the statutory-mandatory categories, which fire regardless of the toggle); PUT saves it and
// REFUSES a routed_task pointed at a role nobody holds — that task would sit in an empty pool and block
// every estimate behind it.
router.get('/approval-modules', requireAuth, async function (req, res) {
  try {
    var AM = require('../services/approvalModules');
    var jid = req.query.jid || await activeJid();
    res.json({ config: await AM.config(jid), modes: AM.MODES, routableRoles: AM.ROUTABLE_ROLES });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/approval-modules', requireAuth, ROLE, async function (req, res) {
  try {
    var AM = require('../services/approvalModules');
    var jid = await activeJid();
    await AM.write(jid, req.body || {}, (req.user && req.user.name) || 'staff');
    res.json({ config: await AM.config(jid) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PHASE 7 / WS5 — the requestor-ledger. GET shows the effective config (the state's prior-balance rule,
// its threshold, and whether the city has elected the permissive authority at all); PUT saves the knobs
// while preserving the imported statutory evidence underneath.
router.get('/ledger', requireAuth, async function (req, res) {
  try {
    var RL = require('../services/requestorLedger');
    var jid = req.query.jid || await activeJid();
    res.json({ config: await RL.config(jid), rules: RL.PRIOR_BALANCE_RULES, gates: RL.GATES });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/ledger', requireAuth, ROLE, async function (req, res) {
  try {
    var RL = require('../services/requestorLedger');
    var jid = await activeJid();
    await RL.writeConfig(jid, req.body || {}, (req.user && req.user.name) || 'staff');
    res.json({ config: await RL.config(jid) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// What the ledger holds for the requestor behind a given request — balance, flags, and the identity
// basis it was anchored on. Returns `anonymous` rather than a balance when there is no affirmative
// anchor, which is the answer for an ordinary anonymous request and must stay the answer.
router.get('/ledger/request/:requestId', requireAuth, async function (req, res) {
  try {
    var RL = require('../services/requestorLedger');
    var pid = await RL.profileForRequest(req.params.requestId);
    if (!pid) return res.json({ anonymous: true, reason: 'no affirmative identity anchor — no adverse trigger can fire', balance: null, flags: [] });
    res.json({ anonymous: false, profileId: pid, balance: await RL.balance(pid), flags: await RL.activeFlags(pid) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- wildcard LAST ---
router.get('/:jid', requireAuth, async function (req, res) {
  try { res.json(await JP.getProfile(req.params.jid)); } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
