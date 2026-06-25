'use strict';
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { get } = require('../db');
const JP = require('../services/jurisdictionProfile');
const enforcement = require('../services/enforcement');
const ROLE = requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'DEPT_MANAGER');
const ATTEST = requireRole('SYSTEM_ADMIN', 'DIRECTOR');
const SADMIN = requireRole('SYSTEM_ADMIN');

async function activeJid() { var r = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'"); return (r && r.value) || null; }

// --- literal routes FIRST (must precede the /:jid wildcard) ---
router.get('/status', requireAuth, async function (req, res) {
  try { res.json(await JP.getProfile(await activeJid())); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/sync', requireAuth, ROLE, async function (req, res) {
  try { var jid = await activeJid(); await JP.sync(jid, { actor: req.user && req.user.name }); res.json(await JP.getProfile(jid)); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/attest', requireAuth, ATTEST, async function (req, res) {
  try { var jid = await activeJid(); await JP.attest(jid, req.body && req.body.section, req.user && req.user.name); res.json(await JP.getProfile(jid)); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/unattest', requireAuth, ATTEST, async function (req, res) {
  try { var jid = await activeJid(); await JP.unattest(jid, req.body && req.body.section); res.json(await JP.getProfile(jid)); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/enforcement', requireAuth, async function (req, res) {
  try { res.json({ devMode: await enforcement.devMode() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/enforcement', requireAuth, SADMIN, async function (req, res) {
  try { var on = !!(req.body && (req.body.devMode === true || req.body.devMode === '1' || req.body.on === true)); var v = await enforcement.setDevMode(on); res.json({ devMode: v }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- wildcard LAST ---
router.get('/:jid', requireAuth, async function (req, res) {
  try { res.json(await JP.getProfile(req.params.jid)); } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
