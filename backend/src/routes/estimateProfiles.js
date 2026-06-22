const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const ep = require('../services/estimateProfile');

// View a record type's estimation profile + confidence (for the Taxonomy panel).
router.get('/:recordTypeId', requireAuth, async function (req, res) {
  try { res.json(await ep.getProfile(req.params.recordTypeId)); }
  catch (e) { res.status(500).json({ error: 'Could not load estimate profile: ' + (e && e.message) }); }
});

// Expert seed: set the expected quantities for this record type (configure once).
router.put('/:recordTypeId', requireAuth, requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR'), async function (req, res) {
  try {
    var b = req.body || {};
    var name = (req.user && req.user.name) || (req.user && req.user.sub) || 'system';
    res.json(await ep.seedProfile(req.params.recordTypeId, b.quantities || {}, name, b.notes));
  } catch (e) { res.status(500).json({ error: 'Could not save estimate profile: ' + (e && e.message) }); }
});

// Fold a completed request's actual quantities into the running profile (historical learning).
router.post('/:recordTypeId/actuals', requireAuth, requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR'), async function (req, res) {
  try { res.json(await ep.recordActuals(req.params.recordTypeId, (req.body && req.body.quantities) || {})); }
  catch (e) { res.status(500).json({ error: 'Could not record actuals: ' + (e && e.message) }); }
});

// Clear a profile.
router.delete('/:recordTypeId', requireAuth, requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR'), async function (req, res) {
  try { var { run } = require('../db'); await run('DELETE FROM record_type_estimate_profiles WHERE record_type_id = ?', [req.params.recordTypeId]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: 'Could not clear profile: ' + (e && e.message) }); }
});

// THE decision: automated estimate or manual? (consumed by the estimate panel, workflow, simulator)
router.post('/assess', requireAuth, async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.recordTypeId) return res.status(400).json({ error: 'recordTypeId is required' });
    res.json(await ep.assess(b.recordTypeId, { jurisdictionId: b.jurisdictionId }));
  } catch (e) { res.status(500).json({ error: 'Could not assess: ' + (e && e.message) }); }
});

module.exports = router;
