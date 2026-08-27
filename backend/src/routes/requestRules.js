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
      eligibility: HUB.mayEdit(HUB.BY_KEY.eligibility, req.user)
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

module.exports = router;
