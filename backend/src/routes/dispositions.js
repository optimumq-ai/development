'use strict';
// PHASE 7 / BW5 — THE DISPOSITION SURFACE (Draft 8 rev 2 Frame C + Frame B's pipeline read).
//
// Draft 8's screen became INFORMATIONAL: dispositions are written where the evidence lives and DISPLAYED
// here. So this router is mostly reads. The three writes it does carry are the ones with no task to live
// in — the two manual endings and the hold controls — plus the pipeline's city knobs.
//
// Access (decided 7/28): reached from the request header, read-only for anyone who can see the request.
// No task type; nothing queues here.
var express = require('express');
var router = express.Router();
var { requireAuth } = require('../middleware/auth');
var { all, get, run } = require('../db');
var DISP = require('../services/disposition');
var AR = require('../services/autoRelease');

// ── THE PIPELINE'S CITY KNOBS (rule d) ────────────────────────────────────────────────────────────
//
// Read is open to any authenticated user — a Director cannot decide a knob they cannot see, and neither
// value reveals anything sensitive. The SETTER is a Director's act: confirming a knob IS the human decision
// to automate (Kevin's words about the pre-send gate), and BW9's go-live checklist is its real surface.
router.get('/knobs', requireAuth, async function (req, res) {
  try {
    res.json({
      auto_release: await AR.knob('auto_release'),
      pre_send_review: await AR.knob('pre_send_review')
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/knobs/:knob', requireAuth, async function (req, res) {
  var roles = req.user.roles || [];
  if (['SYSTEM_ADMIN', 'DIRECTOR'].every(function (r) { return roles.indexOf(r) === -1; })) {
    return res.status(403).json({
      error: 'Confirming a release knob is a Director’s act — the confirming act IS the decision to automate.',
      code: 'DIRECTOR_REQUIRED' });
  }
  try {
    if (!AR.KNOBS[req.params.knob]) return res.status(404).json({ error: 'No such release-pipeline knob.' });
    var out = await AR.writeKnob(req.params.knob, req.body || {}, null, req.user.name || 'Director');
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── THE PIPELINE, AS IT STANDS FOR ONE REQUEST ────────────────────────────────────────────────────
//
// Read-only, and it NEVER acts. Frame B's four-condition panel renders straight off this: each condition
// with its own sentence and its DecidedByBadge value, plus what WOULD happen — which is the question a
// Director evaluating the knob is actually asking.
router.get('/:requestId/pipeline', requireAuth, async function (req, res) {
  try {
    var ev = await AR.evaluate(req.params.requestId);
    if (!ev.known) return res.status(404).json({ error: 'Request not found' });
    res.json(ev);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
