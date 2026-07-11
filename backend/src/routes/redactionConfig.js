'use strict';
// Redaction automation config editor (SPEC_redaction_automation.md slice 6). SYSTEM_ADMIN / DIRECTOR only.
var express = require('express');
var router = express.Router();
var { requireAuth, requireRole } = require('../middleware/auth');
var cfg = require('../services/redactionConfig');
var EDIT = requireRole('SYSTEM_ADMIN', 'DIRECTOR');

router.get('/', requireAuth, EDIT, async function (req, res) {
  res.json({ config: await cfg.read(), defaults: cfg.normalize({}) });
});

router.post('/', requireAuth, EDIT, async function (req, res) {
  try { res.json({ config: await cfg.write(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/reset', requireAuth, EDIT, async function (req, res) {
  res.json({ config: await cfg.reset() });
});

module.exports = router;
