const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const T = require('../services/tolling');
// PER-REQUEST ACT GATE (2026-08-19) — the statutory clock is the citizen's; touching it is a request act.
// services/requestAccess: acting role OR act permission OR the work is yours (request / open task on its
// cluster assigned to you). Clock-addressed routes resolve the clock to its request first; an unknown
// clock passes through to tolling's own "Clock not found". Reads stay requireAuth.
const { requireRequestAct } = require('../middleware/requestAct');
const { get } = require('../db');
async function byClock(req) { var c = await get('SELECT request_id FROM request_clocks WHERE id = ?', [req.params.clockId]); return c ? c.request_id : null; }
const CLOCK_PERMS = ['REQUEST_MANAGER', 'DENIAL_AND_LEGAL'];      // the RM and legal holds; + task holder / assignee
const LEGAL = ['ATTORNEY_REVIEWER'];
const ACT = {
  start:   requireRequestAct({ label: 'start the clocks', param: 'requestId', perms: ['REQUEST_MANAGER'] }),
  toll:    requireRequestAct({ label: 'toll the clock', resolve: byClock, perms: CLOCK_PERMS, roles: LEGAL }),
  resume:  requireRequestAct({ label: 'resume the clock', resolve: byClock, perms: CLOCK_PERMS, roles: LEGAL }),
  extend:  requireRequestAct({ label: 'extend the deadline', resolve: byClock, perms: CLOCK_PERMS, roles: LEGAL }),
  satisfy: requireRequestAct({ label: 'mark the clock satisfied', resolve: byClock, perms: CLOCK_PERMS.concat(['DELIVERY_AND_CLOSURE']), roles: LEGAL })
};

router.get('/overdue', requireAuth, async function (req, res) {
  try { res.json({ overdue: await T.overdue() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/request/:requestId', requireAuth, async function (req, res) {
  try { res.json({ clocks: await T.statusForRequest(req.params.requestId) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/request/:requestId/start', requireAuth, ACT.start, async function (req, res) {
  try { res.json(await T.startClocksForRequest(req.params.requestId)); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/request/:requestId/clock', requireAuth, ACT.start, async function (req, res) {
  try { var b = req.body || {}; res.json({ clockId: await T.startClock(req.params.requestId, b.type, b.opts || {}) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/:clockId/toll', requireAuth, ACT.toll, async function (req, res) {
  try { var b = req.body || {}; res.json(await T.toll(req.params.clockId, b.reason, b.note)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// `reason` closes only that hold and leaves any sibling hold running (the clock resumes only when the last
// one closes). Omitting it closes EVERY open toll — the deliberate manual override. SPEC §4.2.1.
router.post('/:clockId/resume', requireAuth, ACT.resume, async function (req, res) {
  try { var b = req.body || {}; res.json(await T.resume(req.params.clockId, b.reason)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// A STATUTORY extension: add a fixed number of days to the clock (IL 5 ILCS 140/3(e); CA § 7922.535(b)).
// Not a toll — see tolling.extend(). Caps come from the jurisdiction's rules, so a 400 here is the city's
// own statute talking, not a system error.
router.post('/:clockId/extend', requireAuth, ACT.extend, async function (req, res) {
  try {
    var b = req.body || {};
    var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'staff';
    res.json(await T.extend(req.params.clockId, b.days, b.reason, { note: b.note, actor: actor }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/:clockId/extensions', requireAuth, async function (req, res) {
  try { res.json({ extensions: await T.extensionsFor(req.params.clockId) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/:clockId/satisfy', requireAuth, ACT.satisfy, async function (req, res) {
  try { res.json(await T.satisfy(req.params.clockId)); } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
