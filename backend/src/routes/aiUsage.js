'use strict';
// GET /api/ai-usage?days=30 — what the application spent on model calls, by feature and by day (from `ai_calls`).
// System-administration read: the AI configuration screen's "AI Usage" tab. Nothing here changes anything.
var express = require('express');
var router = express.Router();
var { requireAuth, requirePermission } = require('../middleware/auth');
var aiClient = require('../services/aiClient');

router.get('/', requireAuth, requirePermission('system_admin'), async function (req, res) {
  try { res.json(await aiClient.summary(req.query.days)); }
  catch (e) { res.status(500).json({ error: 'Could not read the AI call log: ' + (e && e.message) }); }
});

module.exports = router;
