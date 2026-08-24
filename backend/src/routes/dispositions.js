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
var { requireAuth, hasPermission } = require('../middleware/auth');
var { all, get, run } = require('../db');
var DISP = require('../services/disposition');
var AR = require('../services/autoRelease');
// PER-REQUEST ACT GATE (2026-08-19) for the three writes that had NO rights model: logging a withdrawal
// communication, the RM release hold (place / lift), and recording an installment request. The two manual
// endings keep BW5's own decided rights (manualEndingRights: ORO Associate+ / current task-holder); the
// knobs keep their Director bar. services/requestAccess: acting role OR act permission OR the work is yours.
var { requireRequestAct } = require('../middleware/requestAct');
var ACT = {
  withdrawal: requireRequestAct({ label: 'log a withdrawal communication', param: 'requestId', perms: ['REQUEST_MANAGER', 'CLARIFICATION_SENDER', 'DELIVERY_AND_CLOSURE'] }),
  hold:       requireRequestAct({ label: 'place a release hold', param: 'requestId', perms: ['REQUEST_MANAGER', 'DELIVERY_AND_CLOSURE'] }),
  lift:       requireRequestAct({ label: 'lift a release hold', param: 'requestId', perms: ['REQUEST_MANAGER', 'DELIVERY_AND_CLOSURE'] }),
  installment: requireRequestAct({ label: 'record an installment request', param: 'requestId', perms: ['REQUEST_MANAGER', 'CLARIFICATION_SENDER', 'DELIVERY_AND_CLOSURE'] })
};

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
  // S4: release switches are Lane 2b — the operations_config group (SPEC_user_type_model §5, item 2.10).
  if (!hasPermission(req.user, 'operations_config')) {
    return res.status(403).json({
      error: 'Confirming a release policy setting needs the Operations Configuration permission group — the confirming act IS the decision to automate.',
      code: 'PERMISSION_REQUIRED' });
  }
  try {
    if (!AR.KNOBS[req.params.knob]) return res.status(404).json({ error: 'No such release-pipeline policy setting.' });
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

// ── THE DISPOSITION RECORD (Frame C) ──────────────────────────────────────────────────────────────
//
// Read-only for anyone who can see the request. It also carries the RIGHTS answer for the two manual
// endings, so the screen renders the same permission the write endpoints enforce.
router.get('/:requestId', requireAuth, async function (req, res) {
  try {
    var rec = await DISP.record(req.params.requestId);
    if (!rec) return res.status(404).json({ error: 'Request not found' });
    rec.rights = await DISP.manualEndingRights(req.params.requestId, req.user);
    res.json(rec);
  } catch (e) {
    console.error('[disposition record]', e && e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── THE TWO MANUAL ENDINGS — the only writes on this screen ───────────────────────────────────────
//
// Everything else closes where it happens. These two have no machinery of their own, which is exactly
// Kevin's "perhaps manually clicking on this page is the only way".
//
// Rights (decided 7/29): Withdrawn — ORO Associate+ OR the item's current task-holder. Previously
// furnished — ORO Associate+ only, because certifying that a DIFFERENT request already produced these
// records is an office-level act a searcher has no way to verify.
router.post('/:requestId/close/:ending', requireAuth, async function (req, res) {
  try {
    var ending = req.params.ending;
    if (DISP.MANUAL_RECORD_ENDINGS.indexOf(ending) < 0) {
      return res.status(400).json({
        error: 'Only Withdrawn and Previously furnished are closed from the disposition record. Everything else ' +
               'closes where its evidence lives.', code: 'UNKNOWN_ENDING' });
    }
    var rights = await DISP.manualEndingRights(req.params.requestId, req.user);
    if (!rights[ending].allowed) {
      return res.status(403).json({ error: rights[ending].reason, code: 'NOT_PERMITTED', rights: rights[ending] });
    }
    var b = req.body || {};
    var out = await DISP.close(req.params.requestId, ending, {
      actorId: req.user.sub, actorName: req.user.name || 'Staff',
      payload: {
        note: b.note, withdrawalCommunicationId: b.withdrawalCommunicationId,
        priorRequestNumber: b.priorRequestNumber, priorRequestDate: b.priorRequestDate,
        matchAttested: b.matchAttested === true
      }
    });
    res.json(Object.assign({ rights: rights[ending] }, out));
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message, code: e.code, reasons: e.reasons, gate: e.gate });
    console.error('[manual ending]', e && e.message);
    res.status(500).json({ error: e.message });
  }
});

// The gate as it stands, for the manual-ending popups — same evaluator the write refuses on.
router.get('/:requestId/gate/:ending', requireAuth, async function (req, res) {
  try {
    var gate = await DISP.gateFor(req.params.requestId, req.params.ending, {
      note: req.query.note, withdrawalCommunicationId: req.query.withdrawalCommunicationId,
      priorRequestNumber: req.query.priorRequestNumber, priorRequestDate: req.query.priorRequestDate,
      matchAttested: req.query.matchAttested === 'true'
    });
    res.json({ gate: gate, rights: await DISP.manualEndingRights(req.params.requestId, req.user),
               approval: await DISP.approvalModeFor(req.params.requestId, req.params.ending) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── THE WITHDRAWAL COMMUNICATION + ITS SPAWNER ────────────────────────────────────────────────────
//
// Logging one is both the evidence the Withdrawn gate demands and the trigger for the "Process withdrawal"
// task — a withdrawal can never sit unprocessed while the clock runs.
router.post('/:requestId/withdrawal-communication', requireAuth, ACT.withdrawal, async function (req, res) {
  try {
    res.json(await DISP.logWithdrawalCommunication(req.params.requestId, {
      actorId: req.user.sub, actorName: req.user.name || 'Staff',
      body: (req.body && req.body.body) || '', channel: (req.body && req.body.channel) || ''
    }));
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

// ── THE RM HOLD, AND THE PREVENTION GUARD ─────────────────────────────────────────────────────────
//
// Never a payment hold (§5.9) — services/feeRelease owns money gating and is not double-gated here.
var RH = require('../services/releaseHold');

router.get('/:requestId/hold', requireAuth, async function (req, res) {
  try {
    var st = await RH.holdState(req.params.requestId);
    if (!st.known) return res.status(404).json({ error: 'Request not found' });
    res.json(st);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:requestId/hold', requireAuth, ACT.hold, async function (req, res) {
  try {
    res.json(await RH.hold(req.params.requestId, {
      actorId: req.user.sub, actorName: req.user.name || 'Request Manager', note: (req.body && req.body.note) || '' }));
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message, code: e.code, citation: e.citation });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:requestId/hold', requireAuth, ACT.lift, async function (req, res) {
  try {
    res.json(await RH.lift(req.params.requestId, {
      actorId: req.user.sub, actorName: req.user.name || 'Request Manager', note: (req.body && req.body.note) || '' }));
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

// An installment request arriving. Recorded always; auto-lifts a standing hold only where the state's own
// imported research says the entitlement exists — the one true override, and the RM is notified.
router.post('/:requestId/installment-request', requireAuth, ACT.installment, async function (req, res) {
  try {
    res.json(await RH.onInstallmentRequest(req.params.requestId, {
      actorId: req.user.sub, actorName: req.user.name || 'Staff', note: (req.body && req.body.note) || '' }));
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
