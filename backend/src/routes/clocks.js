const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const T = require('../services/tolling');

router.get('/overdue', requireAuth, async function (req, res) {
  try { res.json({ overdue: await T.overdue() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/request/:requestId', requireAuth, async function (req, res) {
  try { res.json({ clocks: await T.statusForRequest(req.params.requestId) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/request/:requestId/start', requireAuth, async function (req, res) {
  try { res.json(await T.startClocksForRequest(req.params.requestId)); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/request/:requestId/clock', requireAuth, async function (req, res) {
  try { var b = req.body || {}; res.json({ clockId: await T.startClock(req.params.requestId, b.type, b.opts || {}) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/:clockId/toll', requireAuth, async function (req, res) {
  try { var b = req.body || {}; res.json(await T.toll(req.params.clockId, b.reason, b.note)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// `reason` closes only that hold and leaves any sibling hold running (the clock resumes only when the last
// one closes). Omitting it closes EVERY open toll — the deliberate manual override. SPEC §4.2.1.
router.post('/:clockId/resume', requireAuth, async function (req, res) {
  try { var b = req.body || {}; res.json(await T.resume(req.params.clockId, b.reason)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// A STATUTORY extension: add a fixed number of days to the clock (IL 5 ILCS 140/3(e); CA § 7922.535(b)).
// Not a toll — see tolling.extend(). Caps come from the jurisdiction's rules, so a 400 here is the city's
// own statute talking, not a system error.
router.post('/:clockId/extend', requireAuth, async function (req, res) {
  try {
    var b = req.body || {};
    var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'staff';
    res.json(await T.extend(req.params.clockId, b.days, b.reason, { note: b.note, actor: actor }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/:clockId/extensions', requireAuth, async function (req, res) {
  try { res.json({ extensions: await T.extensionsFor(req.params.clockId) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/:clockId/satisfy', requireAuth, async function (req, res) {
  try { res.json(await T.satisfy(req.params.clockId)); } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
