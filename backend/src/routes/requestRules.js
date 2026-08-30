'use strict';
// REQUEST RULES — the screen behind the hub's clarification / exemptions / eligibility rows
// (services/requestRules.js; WORKING_hub_linked_screens §2f).
//   GET  /api/request-rules                        the three tabs: law rules, choices, letter previews
//   POST /api/request-rules/clarification/enabled  { enabled } — the master switch (materializes choices)
//   POST /api/request-rules/clarification/confirm  { path, value } — one clarification decision, recorded
//   POST /api/request-rules/eligibility/posture    { dimension, gated } — the one eligibility decision
// Exemption-tab choices are Legal Rules content: the screen confirms them through the EXISTING
// /api/jurisdiction-profile/policy-settings/confirm endpoint, whose Legal-Rules scoping already
// draws the right line. Clarification and eligibility are compliance-lane acts (hub mayEdit).
const express = require('express');
const router = express.Router();
// LIST/DECISION MODEL hook (approval, 2026-08-31): every write reports a change so an approved row drops to yellow.
router.use(function (req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(req.method) !== -1) {
    res.on('finish', function () { if (res.statusCode < 300) { try { var HUBr = require('../services/setupHub'); var keyR = ({ clarification: 'clarification', eligibility: 'eligibility', intake: 'intake', deadlines: 'deadlines', exemptions: 'exemptions' })[String(req.path).split('/')[1]]; if (keyR) HUBr.afterChange(keyR, req.user && (req.user.name || req.user.email)).catch(function () {}); } catch (e) {} } });
  }
  next();
});
const { requireAuth } = require('../middleware/auth');
const HUB = require('../services/setupHub');
const RR = require('../services/requestRules');
const JR = require('../services/jurisdictionRules');

function fail(res, e, fallback) {
  res.status((e && e.status) || 500).json({ error: (e && e.message) || fallback });
}
function gate(req, res, hubKey, act) {
  if (HUB.mayEdit(HUB.BY_KEY[hubKey], req.user)) return true;
  res.status(403).json({ error: act + ' needs the compliance_policy or legal_rules permission group.', code: 'PERMISSION_REQUIRED' });
  return false;
}

router.get('/', requireAuth, async function (req, res) {
  try {
    var s = await RR.screen(await JR.activeJid());
    s.canEdit = {
      clarification: HUB.mayEdit(HUB.BY_KEY.clarification, req.user),
      exemptions: HUB.mayEdit(HUB.BY_KEY.exemptions, req.user),
      eligibility: HUB.mayEdit(HUB.BY_KEY.eligibility, req.user),
      deadlines: HUB.mayEdit(HUB.BY_KEY.deadlines, req.user),
      intake: HUB.mayEdit(HUB.BY_KEY.intake, req.user)
    };
    res.json(s);
  } catch (e) { fail(res, e, 'The request-rules screen could not be read.'); }
});

router.post('/clarification/enabled', requireAuth, async function (req, res) {
  if (!gate(req, res, 'clarification', 'Switching clarification on or off')) return;
  try {
    var r = await RR.setEnabled(await JR.activeJid(), req.body && req.body.enabled === true, req.user);
    r.screen = await RR.screen(await JR.activeJid());
    res.json(r);
  } catch (e) { fail(res, e, 'The clarification switch could not be changed.'); }
});

router.post('/clarification/confirm', requireAuth, async function (req, res) {
  if (!gate(req, res, 'clarification', 'Recording a clarification decision')) return;
  var b = req.body || {};
  if (!b.path || b.value === undefined || b.value === null || b.value === '') {
    return res.status(422).json({ error: 'Confirming records a decision — send the setting and the value the city chose.' });
  }
  try {
    var out = await RR.confirmChoice(await JR.activeJid(), String(b.path), b.value, req.user);
    out.screen = await RR.screen(await JR.activeJid());
    res.json(out);
  } catch (e) { fail(res, e, 'The decision could not be recorded.'); }
});

router.post('/eligibility/posture', requireAuth, async function (req, res) {
  if (!gate(req, res, 'eligibility', 'Deciding the eligibility posture')) return;
  var b = req.body || {};
  if (!b.dimension || typeof b.gated !== 'boolean') {
    return res.status(422).json({ error: 'Send the dimension and the posture the city chose (gated true or false).' });
  }
  try {
    var out = await RR.setPosture(await JR.activeJid(), String(b.dimension), b.gated, req.user);
    out.screen = await RR.screen(await JR.activeJid());
    res.json(out);
  } catch (e) { fail(res, e, 'The posture could not be recorded.'); }
});

// D1 (Kevin 2026-08-29): the deadlines tab. A LEGAL section — the hub row's gate (legal_rules) draws
// the line for both acts. Service targets are the city's own numbers on operational-target clocks;
// statutory figures are refused here by the service (they change by proposal). The holiday load is the
// one-act fix for the empty-calendar case.
function legalGate(req, res, act) {
  if (HUB.mayEdit(HUB.BY_KEY.deadlines, req.user)) return true;
  res.status(403).json({ error: act + ' needs the legal_rules permission group — Senior Legal or the Director owns the deadlines section.', code: 'PERMISSION_REQUIRED' });
  return false;
}
// I1 (Kevin 2026-08-29): the Request Intake tab's three confirms — channels + acknowledgment (intake
// domain) and estimate capture (fee domain, write-through). Compliance-lane gate, like clarification.
router.post('/intake/confirm', requireAuth, async function (req, res) {
  if (!gate(req, res, 'intake', 'Recording a Request Intake choice')) return;
  var b = req.body || {};
  if (!b.path || b.value === undefined || b.value === null || b.value === '') {
    return res.status(422).json({ error: 'Confirming records a decision — send the setting and the value the city chose.' });
  }
  try {
    var out = await RR.confirmIntake(await JR.activeJid(), String(b.path), b.value, req.user);
    out.screen = await RR.screen(await JR.activeJid());
    res.json(out);
  } catch (e) { fail(res, e, 'The choice could not be recorded.'); }
});

router.post('/deadlines/target', requireAuth, async function (req, res) {
  if (!legalGate(req, res, 'Setting a service target')) return;
  var b = req.body || {};
  if (!b.clock) return res.status(422).json({ error: 'Send the clock the target is for.' });
  try {
    var out = await RR.setServiceTarget(await JR.activeJid(), String(b.clock), b.days, req.user);
    out.screen = await RR.screen(await JR.activeJid());
    res.json(out);
  } catch (e) { fail(res, e, 'The service target could not be recorded.'); }
});
router.post('/deadlines/holidays', requireAuth, async function (req, res) {
  if (!legalGate(req, res, 'Loading the holiday calendar')) return;
  try {
    var out = await RR.loadHolidaySet(await JR.activeJid(), req.user);
    out.screen = await RR.screen(await JR.activeJid());
    res.json(out);
  } catch (e) { fail(res, e, 'The holiday calendar could not be loaded.'); }
});

module.exports = router;
