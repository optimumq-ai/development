'use strict';
var express = require('express');
var router = express.Router();
var { requireAuth } = require('../middleware/auth');
var reportEngine = require('../services/reportEngine');
var reportAgent = require('../services/reportAgent');

// POST /api/reports/ask { question } -> { title, viz, columns, rows, note, spec } | { error }
router.post('/ask', requireAuth, async function (req, res) {
  try { res.json(await reportAgent.ask(req.body && req.body.question)); }
  catch (e) { console.error('[reports/ask]', e && e.message); res.status(500).json({ error: 'The reporting agent is unavailable right now.' }); }
});

// GET /api/reports/prebuilt/:key -> run a canned report
router.get('/prebuilt/:key', requireAuth, async function (req, res) {
  try {
    var spec = reportEngine.PREBUILT[req.params.key];
    if (!spec) return res.status(404).json({ error: 'Unknown report.' });
    var r = await reportEngine.run(spec); r.spec = spec;
    res.json(r);
  } catch (e) { console.error('[reports/prebuilt]', e && e.message); res.status(500).json({ error: 'Could not run that report.' }); }
});
module.exports = router;
