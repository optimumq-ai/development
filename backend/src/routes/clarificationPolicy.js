'use strict';
// Clarification / vague-request policy editor API — the manual + off configuration surface (slice 1).
// Reads/writes the per-jurisdiction substrate defined in services/clarificationPolicy.js. Writes go
// through effectiveConfig.applyConfig('clarification', ...) so each change records config history and
// re-syncs the jurisdiction profile section (re-arming attestation on drift), exactly like other areas.
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { get } = require('../db');
const CP = require('../services/clarificationPolicy');
const effectiveConfig = require('../services/effectiveConfig');

const EDIT = requireRole('SYSTEM_ADMIN', 'DIRECTOR');

async function activeJid() { var r = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'"); return (r && r.value) || null; }

// Current policy + the field/enum catalog the editor renders from.
router.get('/', requireAuth, async function (req, res) {
  try {
    var jid = await activeJid();
    res.json({
      policy: await CP.read(jid),
      fields: CP.FIELDS,
      enums: { clock_effect: CP.CLOCK_EFFECTS, duty: CP.DUTIES, closure: CP.CLOSURES, source: CP.SOURCES }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Save the policy. Invalid enum values are rejected (400) with a clear message.
router.post('/', requireAuth, EDIT, async function (req, res) {
  try {
    var jid = await activeJid();
    var actor = (req.user && req.user.name) || 'staff';
    await effectiveConfig.applyConfig(jid, 'clarification', req.body || {}, actor, 'manual-edit', 'Clarification policy edited');
    res.json({ policy: await CP.read(jid) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
