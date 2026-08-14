// MAGIC DEMO SCREEN routes — slice 1: benchmark + reset (DESIGN_magic_screen.md).
//
// DOUBLE-GATED, both required:
//   1. system_config demo_mode = '1' — a production install never carries this key ON, and turning
//      it off is on the go-live checklist (PRE_RELEASE_HARDENING note). Without it every route here
//      404s: on a real install the magic surface does not exist, it isn't merely forbidden.
//   2. SYSTEM_ADMIN — the operator's screen, nobody else's.
// Reset additionally requires an explicit confirm:true — it discards everything since the benchmark.
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { get } = require('../db');
const magic = require('../services/magicDemo');

async function demoMode(req, res, next) {
  var row = await get("SELECT value FROM system_config WHERE key = 'demo_mode'");
  if (!row || row.value !== '1') return res.status(404).json({ error: 'Not found' });
  next();
}

router.get('/status', requireAuth, requireRole('SYSTEM_ADMIN'), demoMode, async function (req, res) {
  try { res.json(magic.status()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/benchmark', requireAuth, requireRole('SYSTEM_ADMIN'), demoMode, async function (req, res) {
  try {
    var meta = await magic.benchmark({ actorName: req.user.name || req.user.display_name || null, label: (req.body || {}).label || null });
    res.json({ benchmark: meta });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

router.post('/reset', requireAuth, requireRole('SYSTEM_ADMIN'), demoMode, async function (req, res) {
  try {
    if ((req.body || {}).confirm !== true) {
      return res.status(422).json({ error: 'Reset discards everything done since the benchmark. Pass confirm:true.', code: 'CONFIRM_REQUIRED' });
    }
    var out = await magic.reset({});
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

module.exports = router;
