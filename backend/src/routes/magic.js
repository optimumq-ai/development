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
  try { res.json(await magic.status()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// The magic clock (slice 2): the world ages by `days`/`seconds`, then the date-driven workers run
// immediately so consequences land while the audience watches. Undo = Reset; hence NO_BENCHMARK 409.
router.post('/clock/advance', requireAuth, requireRole('SYSTEM_ADMIN'), demoMode, async function (req, res) {
  try {
    var b = req.body || {};
    var seconds = b.seconds != null ? Number(b.seconds) : Number(b.days || 0) * 86400;
    res.json(await magic.clockAdvance({ seconds: seconds }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
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

// ── BECOME (role switch) + the curated cast ─────────────────────────────────────────────────────
// The cast is a system_config list (`magic_cast`), edited on the screen itself — Kevin expects to
// tune it as he rehearses. Become mints a REAL session token for the chosen person via the same
// signer login uses; the client swaps it into localStorage and reloads. Demo-gated like everything
// here: on a production install none of this exists (404).
router.get('/cast', requireAuth, requireRole('SYSTEM_ADMIN'), demoMode, async function (req, res) {
  try {
    var row = await get("SELECT value FROM system_config WHERE key = 'magic_cast'");
    var cast = []; try { cast = JSON.parse((row && row.value) || '[]') || []; } catch (e) {}
    var out = [];
    for (var i = 0; i < cast.length; i++) {
      var u = await get("SELECT id, display_name, title, status FROM users WHERE id = ?", [cast[i].user_id]);
      if (u && u.status !== 'inactive') out.push({ user_id: u.id, display_name: u.display_name, title: u.title, caption: cast[i].caption || u.title || '' });
    }
    res.json({ cast: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/cast', requireAuth, requireRole('SYSTEM_ADMIN'), demoMode, async function (req, res) {
  try {
    var cast = Array.isArray((req.body || {}).cast) ? req.body.cast : null;
    if (!cast) return res.status(422).json({ error: 'Send { cast: [{ user_id, caption }] }.' });
    var clean = [];
    for (var i = 0; i < cast.length; i++) {
      var u = await get('SELECT id FROM users WHERE id = ?', [cast[i].user_id]);
      if (!u) return res.status(404).json({ error: 'No such person: ' + cast[i].user_id });
      clean.push({ user_id: cast[i].user_id, caption: String(cast[i].caption || '').slice(0, 60) });
    }
    var { run } = require('../db');
    await run("INSERT INTO system_config (key, value) VALUES ('magic_cast', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(clean)]);
    res.json({ cast: clean });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/become', requireAuth, requireRole('SYSTEM_ADMIN'), demoMode, async function (req, res) {
  try {
    var u = await get('SELECT * FROM users WHERE id = ?', [(req.body || {}).user_id]);
    if (!u) return res.status(404).json({ error: 'No such person.' });
    if (u.status === 'inactive') return res.status(422).json({ error: u.display_name + ' is inactive.' });
    var token = await require('../services/auth').signAccessToken(u);
    res.json({ token: token, user: { id: u.id, display_name: u.display_name } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
