'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth, requireAuthority, requirePermission, requireAnyPermission, hasPermission } = require('../middleware/auth');
const { get } = require('../db');
const JP = require('../services/jurisdictionProfile');
const enforcement = require('../services/enforcement');
const ROLE = requirePermission('compliance_policy');   // S4: profile sync is a Lane-1 act
// BW9a (Kevin 2026-08-11): Senior Legal — function role ATTORNEY_REVIEWER — attests the Legal
// Rules sections (exemption, redaction, deadlines); everything else stays Director | System
// Admin. requireRole lets SYSTEM_ADMIN through unconditionally, so the per-section line is drawn
// by attestScopeError below, and the refusal is worded, not just a 403.
// v3 (S2, SPEC_user_type_model §8 rows 7–9): attestation and confirmation are PERMISSION GROUPS read off the
// user's types — legal_rules for the Legal Rules sections/domains (owner: ORO Senior Legal; the Director may),
// compliance_policy for everything else (Director, System Administrator). No role name is consulted and there
// is no SysAdmin bypass: oro_sysadmin does NOT hold legal_rules, so it cannot attest a legal section.
const ATTEST = requireAnyPermission('legal_rules', 'compliance_policy');
const GL = require('../services/goLive');
function attestScopeError(req, section) {
  var legal = !!(section && GL.LEGAL_SECTIONS[section]);
  if (legal && hasPermission(req.user, 'legal_rules')) return null;
  if (!legal && hasPermission(req.user, 'compliance_policy')) return null;
  return legal
    ? 'The ' + section + ' section is a Legal Rules section: it is attested by ORO Senior Legal (or the Director) — the legal_rules permission group.'
    : 'The ' + (section || 'requested') + ' section is not one of the Legal Rules sections (exemption, redaction, deadlines): it is attested by the Director or a System Administrator — the compliance_policy permission group.';
}
// Confirming a local policy setting follows the same ownership line, by DOMAIN: Senior Legal
// confirms settings on the Legal Rules domains; the Director everywhere.
var LEGAL_DOMAINS = { exemption: 1, redaction: 1, deadline: 1, clock_matrix: 1 };
function confirmScopeError(req, domain) {
  var legal = !!(domain && LEGAL_DOMAINS[domain]);
  if (legal && hasPermission(req.user, 'legal_rules')) return null;
  if (!legal && hasPermission(req.user, 'compliance_policy')) return null;
  return legal
    ? 'Settings on the ' + domain + ' domain are Legal Rules: confirmed by ORO Senior Legal (or the Director) — the legal_rules permission group.'
    : 'Settings on ' + (domain || 'this domain') + ' are not Legal Rules: they are confirmed by the Director or a System Administrator — the compliance_policy permission group.';
}

async function activeJid() { var r = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'"); return (r && r.value) || null; }

// --- literal routes FIRST (must precede the /:jid wildcard) ---
router.get('/status', requireAuth, async function (req, res) {
  try { res.json(await JP.getProfile(await activeJid())); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/sync', requireAuth, ROLE, async function (req, res) {
  try { var jid = await activeJid(); await JP.sync(jid, { actor: req.user && req.user.name }); res.json(await JP.getProfile(jid)); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/attest', requireAuth, ATTEST, async function (req, res) {
  var scope = attestScopeError(req, req.body && req.body.section);
  if (scope) return res.status(403).json({ error: scope });
  try { var jid = await activeJid(); await JP.attest(jid, req.body && req.body.section, req.user && req.user.name); res.json(await JP.getProfile(jid)); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/unattest', requireAuth, ATTEST, async function (req, res) {
  var scope = attestScopeError(req, req.body && req.body.section);
  if (scope) return res.status(403).json({ error: scope });
  try { var jid = await activeJid(); await JP.unattest(jid, req.body && req.body.section); res.json(await JP.getProfile(jid)); } catch (e) { res.status(400).json({ error: e.message }); }
});
// BW9a — the go-live checklist's three reads/writes (Draft 6, residuals decided 2026-08-11).
// READ includes ATTORNEY_REVIEWER: Senior Legal attests the Legal sections, and nobody can attest
// a checklist they cannot see.
const READ = requireAnyPermission('compliance_policy', 'legal_rules', 'operations_config');   // S4: anyone who configures may read the checklist
// Every local policy setting, grouped by profile section, with who/when on the confirmed ones.
router.get('/policy-settings', requireAuth, READ, async function (req, res) {
  try { res.json(await GL.settings(await activeJid())); } catch (e) { res.status(500).json({ error: e.message }); }
});
// The one genuinely missing piece of plumbing Draft 6 named: set value + confirmed + who/when.
// Never creates a setting — an unknown path is refused in words.
// DECISION MODEL (2026-08-31): a confirmed setting is a change on the hub row that owns its domain.
var ITEM_FOR_DOMAIN = { exemption: 'exemptions', clarification: 'clarification', clarification_screen: 'clarification', eligibility: 'eligibility', intake: 'intake', deadline: 'deadlines', clock_matrix: 'deadlines', fee: 'fee_law', fee_waiver: 'fee_law', payment: 'fee_law', fee_de_minimis: 'fee_law', redaction: 'redaction_rules', release_pipeline: 'release_review' };
router.use('/policy-settings/confirm', function (req, res, next) {
  res.on('finish', function () { if (res.statusCode < 300 && req.body && ITEM_FOR_DOMAIN[req.body.domain]) { try { require('../services/setupHub').afterChange(ITEM_FOR_DOMAIN[req.body.domain], req.user && (req.user.name || req.user.email)).catch(function () {}); } catch (e) {} } });
  next();
});
router.post('/policy-settings/confirm', requireAuth, ATTEST, async function (req, res) {
  var b = req.body || {};
  var scope = confirmScopeError(req, b.domain);
  if (scope) return res.status(403).json({ error: scope });
  try {
    var jid = await activeJid();
    var out = await GL.confirm(jid, b.domain, b.path, b.value, req.user && req.user.name);
    res.json({ confirmed: out, settings: await GL.settings(jid) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// BW9b — the rule-content editors (Draft 10, all five §5 questions decided 2026-08-11).
// The section screen's Content + Provenance + Proposals zones, assembled server-side.
router.get('/rules/:section', requireAuth, READ, async function (req, res) {
  try { res.json(await require('../services/ruleEditors').content(await activeJid(), req.params.section)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// Research-text drill-down (decided IN): the full record behind a cited fact — verbatim statute
// language included. Read-only; the gather's output is never edited here.
router.get('/rules-research/:ruleId', requireAuth, READ, async function (req, res) {
  try {
    var r = require('../services/rulesResearch').rule(req.params.ruleId);
    if (!r) return res.status(404).json({ error: 'No research record for ' + req.params.ruleId + ' — the citation and summary on the fact are all the corpus carries for it.' });
    res.json({ rule: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// The proposal composer: every content edit lands as a proposal — citation + note required, the
// WS1–WS3 police rules run BEFORE anything is written, and the owner may apply in the same act
// (a Director's edit on a Legal Rules domain files for Senior Legal instead — never self-applied).
router.post('/rules/:section/propose', requireAuth, ATTEST, async function (req, res) {
  var b = req.body || {};
  var scopeP = confirmScopeError(req, b.domain);   // same ownership line as confirm, by domain (v3 permission groups)
  if (scopeP) return res.status(403).json({ error: scopeP.replace('confirmed by', 'proposed by') });
  try {
    var out = await require('../services/ruleEditors').propose(await activeJid(), req.params.section, b.domain, b.config, {
      citation: b.citation, note: b.note, applyNow: b.applyNow === true,
      actor: req.user && req.user.name, user: req.user
    });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message, refusals: e.refusals || undefined }); }
});
// The computed gate summary — the checklist's headline and the Director's dashboard banner.
router.get('/go-live', requireAuth, READ, async function (req, res) {
  try { res.json(await GL.summary(await activeJid())); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/enforcement', requireAuth, async function (req, res) {
  try { res.json({ devMode: await enforcement.devMode() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
// v3 (S2, §8 row 7): the go-live flip is the go_live AUTHORITY — oro_sysadmin OR oro_director (Kevin 2026-08-24).
router.post('/enforcement', requireAuth, requireAuthority('go_live'), async function (req, res) {
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
    var gate = await RL.evaluateIntake(null, req.params.requestId);
    res.json({ anonymous: false, profileId: pid, balance: await RL.balance(pid), flags: await RL.activeFlags(pid), allowance: gate.allowance, sameDay: gate.sameDay, advisories: gate.advisories });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- wildcard LAST ---
router.get('/:jid', requireAuth, async function (req, res) {
  try { res.json(await JP.getProfile(req.params.jid)); } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
