'use strict';
// WHAT THE LAW LETS YOU CHARGE — the screen behind the hub's `fee_law` row (services/feeLaw.js).
//   GET  /api/fee-law                 both windows: every item with the law's figure and this city's value
//   PUT  /api/fee-law/decisions       { items: { key: { value, ref } } } — hand decisions (null = clear)
//   POST /api/fee-law/read-document   { text, name } — a fee policy, read by the extractor, filed as
//                                     'document' decisions with references; charges nothing until approved
//   POST /api/fee-law/approve         compose every figure → fee schedule version n (fee_profiles, active)
// Edit gate = the hub's own gate for the fee_law item (compliance lane groups).
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const HUB = require('../services/setupHub');
const FL = require('../services/feeLaw');
const JR = require('../services/jurisdictionRules');

function mayEdit(user) { return HUB.mayEdit(HUB.BY_KEY.fee_law, user); }
function fail(res, e, fallback) {
  var status = e && e.status ? e.status : 500;
  var body = { error: (e && e.message) || fallback };
  if (e && e.code) body.code = e.code;
  if (e && e.violations) body.violations = e.violations;
  if (e && e.undecided) body.undecided = e.undecided;
  res.status(status).json(body);
}

router.get('/', requireAuth, async function (req, res) {
  try {
    var jid = await JR.activeJid();
    var s = await FL.screen(jid);
    s.canEdit = mayEdit(req.user);
    res.json(s);
  } catch (e) { fail(res, e, 'The fee-law screen could not be read.'); }
});

router.put('/decisions', requireAuth, async function (req, res) {
  if (!mayEdit(req.user)) return res.status(403).json({ error: 'Deciding fee figures needs the compliance_policy or legal_rules permission group.', code: 'PERMISSION_REQUIRED' });
  try {
    var jid = await JR.activeJid();
    var r = await FL.decide(jid, (req.body && req.body.items) || {}, req.user);
    r.screen.canEdit = true;
    res.json(r);
  } catch (e) { fail(res, e, 'The decisions could not be saved.'); }
});

router.post('/read-document', requireAuth, async function (req, res) {
  if (!mayEdit(req.user)) return res.status(403).json({ error: 'Reading a fee policy needs the compliance_policy or legal_rules permission group.', code: 'PERMISSION_REQUIRED' });
  var text = String((req.body && req.body.text) || '');
  if (!text.trim()) return res.status(422).json({ error: 'The document has no readable text.', code: 'NO_TEXT' });
  try {
    var jid = await JR.activeJid();
    var r = await FL.readDocument(jid, text, (req.body && req.body.name) || null, req.user);
    r.screen.canEdit = true;
    res.json(r);
  } catch (e) { fail(res, e, 'The document could not be read.'); }
});

router.post('/approve', requireAuth, async function (req, res) {
  if (!mayEdit(req.user)) return res.status(403).json({ error: 'Approving the fee schedule needs the compliance_policy or legal_rules permission group.', code: 'PERMISSION_REQUIRED' });
  try {
    var jid = await JR.activeJid();
    var r = await FL.approve(jid, req.user, {});
    r.screen.canEdit = true;
    res.json(r);
  } catch (e) { fail(res, e, 'The fee schedule could not be approved.'); }
});

module.exports = router;
