const express = require('express');
const router = express.Router();
const { all, get } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const tickler = require('../services/tickler');
const scope = require('../services/requestScope');

// Manually run the sweep (admin/elevated).
router.post('/run', requireAuth, requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'DEPT_MANAGER'), async function (req, res) {
  try { res.json(await tickler.runSweep({ trigger: 'manual' })); }
  catch (e) { res.status(500).json({ error: 'Sweep failed: ' + (e && e.message) }); }
});

// Last run + currently flagged requests.
router.get('/status', requireAuth, async function (req, res) {
  var last = await get("SELECT * FROM tickler_runs ORDER BY ran_at DESC LIMIT 1");
  var flagged = await all(
    "SELECT id, request_number, requestor_name, stage, tickler_flag, tickler_flagged_at " +
    "FROM requests r WHERE r.tickler_flag IS NOT NULL" + scope.andLeaf('r') + " ORDER BY r.tickler_flagged_at DESC LIMIT 100");
  var lastOut = null;
  if (last) { var sum = {}; try { sum = JSON.parse(last.summary_json || '{}'); } catch (e) {} lastOut = { ranAt: last.ran_at, trigger: last.trigger, scanned: last.scanned, flagged: last.flagged, summary: sum }; }
  res.json({ lastRun: lastOut, flagged: flagged });
});

// Clear a flag once a human has handled it.
router.post('/clear/:requestId', requireAuth, async function (req, res) {
  await tickler.clearFlag(req.params.requestId);
  res.json({ cleared: true });
});

module.exports = router;
