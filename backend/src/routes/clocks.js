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
router.post('/:clockId/resume', requireAuth, async function (req, res) {
  try { res.json(await T.resume(req.params.clockId)); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/:clockId/satisfy', requireAuth, async function (req, res) {
  try { res.json(await T.satisfy(req.params.clockId)); } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
