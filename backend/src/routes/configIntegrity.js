'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const CI = require('../services/configIntegrity');

// Is the live jurisdiction config trustworthy, or does it carry test residue / implausible values?
router.get('/', requireAuth, async function (req, res) {
  try { res.json(await CI.check()); } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
