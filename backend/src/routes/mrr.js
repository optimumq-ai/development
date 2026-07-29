'use strict';
// PHASE 7 / BW6 — THE MRR MANAGEMENT HUB'S API.
// (docs/DRAFT_processing_ui_mrr_hub.md rev 5b + §0b · docs/SPEC_processing_ui.md §3 screen 5)
//
// Four levels of screen, one router: the overview (my MRRs), the master record, the child record, and the
// thin per-activity view the ASSIGNEE opens from their My Tasks.
//
// ONE-VOICE IS ENFORCED HERE, NOT ONLY DRAWN. "Contact requestor exists ONLY on the MRR screens; assignees
// see 'email the Request Manager'." A rule that lives only in JSX is a rule one careless render removes, so
// the clarification/outreach write below refuses anybody who is not the MRR manager — and it says who the
// Request Manager is, so the refusal is useful rather than merely correct.
var express = require('express');
var router = express.Router();
var { requireAuth } = require('../middleware/auth');
var { all, get, run } = require('../db');
var HUB = require('../services/mrrHub');

// ── WHO MAY WORK THIS HUB ────────────────────────────────────────────────────────────────────────
//
// The manager of an MRR is the holder of its `mrr_management` task. Oversight roles may READ (the
// all-office view is theirs by authority — it is simply not built as a tab here).
var OVERSIGHT = ['SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'ORO_SUPERVISOR', 'RECORDS_MANAGER'];

function hasOversight(user) {
  var roles = (user && user.roles) || [];
  return OVERSIGHT.some(function (r) { return roles.indexOf(r) >= 0; });
}

async function hubTaskFor(parentId) {
  return await get("SELECT * FROM tasks WHERE request_id = ? AND type = 'mrr_management' ORDER BY created_at DESC LIMIT 1", [parentId]);
}

// Resolve a route param that may be the mrr_management TASK id (how My Tasks reaches the screen) or the
// parent REQUEST id (how the request header would). One screen, two honest doors.
async function resolveParent(idOrTaskId) {
  var t = await get("SELECT * FROM tasks WHERE id = ?", [idOrTaskId]);
  if (t && t.type === 'mrr_management') return { parentId: t.request_id, task: t };
  var r = await get('SELECT id FROM requests WHERE id = ?', [idOrTaskId]);
  if (r) return { parentId: r.id, task: await hubTaskFor(r.id) };
  return { parentId: null, task: null };
}

async function manages(user, parentId) {
  if (hasOversight(user)) return { ok: true, readOnly: false, oversight: true };
  var t = await hubTaskFor(parentId);
  if (t && t.assigned_to === user.id) return { ok: true, readOnly: false, manager: true };
  return { ok: false, readOnly: true, managerName: t && t.assigned_to ? await displayName(t.assigned_to) : null };
}

async function displayName(userId) {
  var u = await get('SELECT display_name FROM users WHERE id = ?', [userId]);
  return u ? u.display_name : null;
}

// ── THE OVERVIEW — MY MRRs ───────────────────────────────────────────────────────────────────────
router.get('/overview', requireAuth, async function (req, res) {
  try { res.json(await HUB.overview(req.user.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── THE MASTER RECORD ────────────────────────────────────────────────────────────────────────────
router.get('/:id/master', requireAuth, async function (req, res) {
  try {
    var r = await resolveParent(req.params.id);
    if (!r.parentId) return res.status(404).json({ error: 'Master record not found.' });
    var m = await HUB.master(r.parentId);
    if (!m.known) return res.status(404).json({ error: 'Master record not found.' });
    var auth = await manages(req.user, r.parentId);
    m.task = r.task || null;
    m.canManage = auth.ok;
    m.managerName = r.task && r.task.assigned_to ? await displayName(r.task.assigned_to) : null;
    // ONE VOICE, said by the server. The screen renders the contact controls only when this is true.
    m.oneVoice = {
      contactRequestorHere: auth.ok,
      note: auth.ok
        ? 'You are the Request Manager for this record. Contact-requestor lives here and nowhere else — every ' +
          'assignee-facing MRR task offers “email the Request Manager” instead.'
        : 'One request, one voice: contact-requestor belongs to this record’s Request Manager' +
          (m.managerName ? ' (' + m.managerName + ')' : '') + '. Email them rather than the requestor.'
    };
    res.json(m);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── THE CHILD RECORD ─────────────────────────────────────────────────────────────────────────────
router.get('/item/:childId', requireAuth, async function (req, res) {
  try {
    var child = await get('SELECT * FROM requests WHERE id = ?', [req.params.childId]);
    if (!child) return res.status(404).json({ error: 'Item not found.' });
    var parent = child.master_request_id ? await get('SELECT * FROM requests WHERE id = ?', [child.master_request_id]) : null;
    if (!parent) return res.status(400).json({ error: 'This record is not an item of a multi-record request.' });
    var auth = await manages(req.user, parent.id);
    var hubTask = await hubTaskFor(parent.id);
    var sibs = await all('SELECT id, component_label FROM requests WHERE master_request_id = ? ORDER BY component_label, created_at', [parent.id]);
    var idx = sibs.map(function (x) { return x.id; }).indexOf(child.id);
    res.json({
      item: {
        id: child.id, requestNumber: child.request_number,
        label: child.component_label || ('Item ' + (idx + 1)),
        position: idx + 1, of: sibs.length,
        // VERBATIM, always. §0b: "the child view leads with that item's submitted wording."
        description: child.description,
        classification: child.classification, status: child.status, stage: child.stage,
        recordTypes: child.record_types || null
      },
      parent: { id: parent.id, requestNumber: parent.request_number, description: parent.description,
        requestorName: parent.requestor_name },
      hubTaskId: hubTask ? hubTask.id : null,
      activities: await HUB.activities(child.id),
      estimateData: await HUB.estimateData(child.id),
      attachments: await HUB.attachments(child.id),
      defect: await HUB.defectOf(child.id),
      denial: Number(child.mrr_denial_designated) === 1
        ? { designated: true, grounds: child.mrr_denial_grounds, by: child.mrr_denial_by,
            at: child.mrr_denial_at, legalTaskId: child.mrr_denial_legal_task_id }
        : { designated: false },
      release: await HUB.releaseState(child.id),
      canManage: auth.ok,
      managerName: hubTask && hubTask.assigned_to ? await displayName(hubTask.assigned_to) : null,
      // THE STATUTORY CLOCK IS NOT HERE. §4.2: one legal deadline per citizen request, on the master.
      // Said explicitly so a child screen never renders one and nobody has to wonder why it is missing.
      clockNote: 'The statutory clock lives on the master record — one legal deadline per citizen request, never one per item.',
      // The sentence the assignee-inset prints. It is the whole structural claim, in the server's words.
      assigneeInset: 'Completing an MRR activity updates this screen and nothing else. MRR tasks never advance a ' +
        'stage: on a multi-record request the pipeline (search → redaction → delivery) is the Request Manager’s ' +
        'orchestration, not the workflow engine’s.'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ACTIVITY WRITES — all manager-only ───────────────────────────────────────────────────────────
async function requireManager(req, res, childId) {
  var child = await get('SELECT master_request_id FROM requests WHERE id = ?', [childId]);
  if (!child || !child.master_request_id) { res.status(404).json({ error: 'Item not found.' }); return null; }
  var auth = await manages(req.user, child.master_request_id);
  if (!auth.ok) {
    res.status(403).json({
      error: 'Only this record’s Request Manager orchestrates its items' +
        (auth.managerName ? ' (' + auth.managerName + ')' : '') + '.',
      code: 'NOT_THE_MANAGER' });
    return null;
  }
  return child.master_request_id;
}

function actor(req) { return { actorId: req.user.id, actorName: req.user.name || req.user.display_name || 'Request Manager' }; }

router.post('/item/:childId/activity/:activity/assign', requireAuth, async function (req, res) {
  try {
    if (!(await requireManager(req, res, req.params.childId))) return;
    var b = req.body || {};
    var opts = Object.assign(actor(req), { assigneeId: b.assigneeId || null, externalEmail: b.externalEmail || null });
    // "Do it myself" is not a special path — it is the manager naming themselves, and it produces a REAL
    // task on their own My Tasks. Annotation 2: everything worked has a task; nothing is invisible.
    if (b.self) opts.assigneeId = req.user.id;
    res.json({ activities: await HUB.spawnActivity(req.params.childId, req.params.activity, opts) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

router.post('/item/:childId/activity/:activity/not-required', requireAuth, async function (req, res) {
  try {
    if (!(await requireManager(req, res, req.params.childId))) return;
    res.json({ activities: await HUB.setNotRequired(req.params.childId, req.params.activity,
      Object.assign(actor(req), { reason: (req.body || {}).reason })) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

// COMPLETION IS THE ASSIGNEE'S ACT, so this one is NOT manager-gated — it is gated on holding the task (or
// managing the record, for the do-it-myself and correction cases).
router.post('/item/:childId/activity/:activity/complete', requireAuth, async function (req, res) {
  try {
    var childId = req.params.childId;
    var row = await HUB.getActivity(childId, req.params.activity);
    var child = await get('SELECT master_request_id FROM requests WHERE id = ?', [childId]);
    if (!child) return res.status(404).json({ error: 'Item not found.' });
    var isAssignee = row && row.assignee_id === req.user.id;
    var auth = await manages(req.user, child.master_request_id);
    if (!isAssignee && !auth.ok) {
      return res.status(403).json({ error: 'This activity belongs to its assignee or to the Request Manager.', code: 'NOT_YOURS' });
    }
    var out = await HUB.completeActivity(childId, req.params.activity,
      Object.assign(actor(req), { note: (req.body || {}).note }));
    res.json({
      activities: out,
      // The completion's own words, so the assignee's screen cannot imply it moved anything.
      advanced: false,
      note: 'Recorded. This updates the MRR hub for the Request Manager. It advances no stage.'
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

router.post('/item/:childId/activity/:activity/start', requireAuth, async function (req, res) {
  try {
    res.json({ activities: await HUB.startActivity(req.params.childId, req.params.activity, actor(req)) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

// ── THE ASSIGNEE'S THIN ACTIVITY VIEW ────────────────────────────────────────────────────────────
//
// Reached from My Tasks by the person holding an `mrr_search` / `mrr_estimate` / `mrr_redaction` task. It
// is deliberately THIN: the item's verbatim wording, the requestor's attachments (which RIDE the item —
// §0b), the one completion control, and the one-voice line. No contact-requestor control exists on it, and
// none may be added: this is the surface the one-voice rule is FOR.
router.get('/activity-task/:taskId', requireAuth, async function (req, res) {
  try {
    var t = await get('SELECT * FROM tasks WHERE id = ?', [req.params.taskId]);
    if (!t) return res.status(404).json({ error: 'Task not found.' });
    if (['mrr_search', 'mrr_estimate', 'mrr_redaction'].indexOf(t.type) < 0) {
      return res.status(400).json({ error: 'Not an MRR activity task.' });
    }
    var child = await get('SELECT * FROM requests WHERE id = ?', [t.request_id]);
    var parent = child && child.master_request_id ? await get('SELECT * FROM requests WHERE id = ?', [child.master_request_id]) : null;
    var row = await get('SELECT * FROM mrr_tasks WHERE task_id = ?', [t.id]);
    var hubTask = parent ? await hubTaskFor(parent.id) : null;
    var mgr = hubTask && hubTask.assigned_to ? await get('SELECT display_name, email FROM users WHERE id = ?', [hubTask.assigned_to]) : null;
    res.json({
      task: t,
      activity: row ? { id: row.id, activity: row.activity, status: row.status,
        label: HUB.LABEL[row.activity], name: HUB.ACTIVITY_NAME[row.activity] } : null,
      item: child ? { id: child.id, label: child.component_label || 'Item', description: child.description,
        requestNumber: child.request_number } : null,
      parent: parent ? { id: parent.id, requestNumber: parent.request_number } : null,
      attachments: child ? await HUB.attachments(child.id) : null,
      // ONE VOICE, on the surface the rule exists for. There is no contact-requestor here, ever.
      requestManager: mgr ? { name: mgr.display_name, email: mgr.email } : null,
      oneVoice: 'One request, one voice. Everything the requestor hears about this record comes from its Request ' +
        'Manager' + (mgr ? ' (' + mgr.display_name + ')' : '') + ' — email them; do not contact the requestor from here.',
      neverAdvances: 'Completing this updates the Request Manager’s MRR screen. It advances no stage — the manager ' +
        'orchestrates a multi-record request, the workflow engine does not.'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ESTIMATE DATA + READINESS ────────────────────────────────────────────────────────────────────
router.put('/item/:childId/estimate-data', requireAuth, async function (req, res) {
  try {
    var childId = req.params.childId;
    var row = await HUB.getActivity(childId, 'estimate');
    var child = await get('SELECT master_request_id FROM requests WHERE id = ?', [childId]);
    if (!child) return res.status(404).json({ error: 'Item not found.' });
    var auth = await manages(req.user, child.master_request_id);
    if (!(row && row.assignee_id === req.user.id) && !auth.ok) {
      return res.status(403).json({ error: 'Estimate data is entered by the item’s assignee or the Request Manager.', code: 'NOT_YOURS' });
    }
    var data = await HUB.saveEstimateData(childId, req.body || {}, actor(req));
    res.json({ estimateData: data, readiness: await HUB.readiness(child.master_request_id),
      activities: await HUB.activities(childId) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

router.get('/:id/readiness', requireAuth, async function (req, res) {
  try {
    var r = await resolveParent(req.params.id);
    if (!r.parentId) return res.status(404).json({ error: 'Master record not found.' });
    res.json(await HUB.readiness(r.parentId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GENERATE ESTIMATE — THE ONE BUTTON READINESS ARMS ────────────────────────────────────────────
//
// Kevin 7/28 item 7: at m of m, Generate estimate "becomes active and highlighted". What it does is ARM THE
// STANDARD ENGINE on the MASTER record — one estimate for the whole request, not a sum of item prices.
//
// IT DELIBERATELY DOES NOT PRICE ANYTHING HERE. The fee engine (routes/feeEstimates) owns pricing: the
// jurisdiction's config, the Illinois forfeiture guardrail, the component split, the notice. A second
// pricing path in this router would be a second answer to "what does this cost", and the two would
// disagree the first time a rate changed. So this finds-or-raises the parent's ORDINARY `estimate` task
// and hands the manager to it — the gathered per-item figures ride along in the history as the worksheet's
// starting facts.
//
// VERIFY ≠ APPROVE survives untouched because it was never this endpoint's: staff VERIFY on the estimate
// screen, the REQUESTOR approves through the acceptance gate. Two acts, two actors — requestor approval is
// a statutory trigger in some states, and collapsing them here would forge one.
router.post('/:id/generate-estimate', requireAuth, async function (req, res) {
  try {
    var r = await resolveParent(req.params.id);
    if (!r.parentId) return res.status(404).json({ error: 'Master record not found.' });
    var auth = await manages(req.user, r.parentId);
    if (!auth.ok) return res.status(403).json({ error: 'Only this record’s Request Manager generates its estimate.', code: 'NOT_THE_MANAGER' });

    var ready = await HUB.readiness(r.parentId);
    if (!ready.ready) {
      return res.status(409).json({
        error: 'Estimate data is complete for ' + ready.n + ' of ' + ready.m + ' items. One estimate is generated ' +
               'for the master record, so it waits until every item’s data is in.',
        code: 'NOT_READY', readiness: ready });
    }

    var tr = require('../services/taskRouting');
    var existing = await get("SELECT * FROM tasks WHERE request_id = ? AND type = 'estimate' AND status NOT IN ('done','cancelled') ORDER BY created_at DESC LIMIT 1", [r.parentId]);
    var task = existing;
    if (!task) {
      task = await tr.createTask({ requestId: r.parentId, type: 'estimate',
        title: 'Estimate — multi-record request (' + ready.m + ' items)', teamId: null, createdBy: req.user.id });
      await tr.assign(task.id, req.user.id, 'manual', null);
    }

    var data = await all('SELECT * FROM mrr_estimate_data WHERE parent_request_id = ?', [r.parentId]);
    var lines = data.map(function (d) {
      return '· item ' + d.request_id + ': ' + (d.page_count || 0) + ' pages, ' + (d.labor_minutes || 0) +
        ' min labour' + (d.estimated_cost != null ? ', est. $' + d.estimated_cost : '') +
        ' (entered by ' + (d.entered_by_name || 'unknown') + ')';
    }).join('\n');
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
      [require('uuid').v4(), r.parentId, req.user.id, req.user.name || 'Request Manager', 'MRR_ESTIMATE_ARMED',
       'Estimate data complete for all ' + ready.m + ' items; one estimate generated for the master record through ' +
       'the standard engine. Gathered figures:\n' + lines +
       '\nStaff VERIFY this estimate; the REQUESTOR approves it — two acts by two people.',
       new Date().toISOString().slice(0, 19).replace('T', ' ')]);

    res.json({ armed: true, estimateTaskId: task.id, readiness: ready,
      note: 'One estimate for the master record, through the standard engine. Staff verify it; the requestor approves it.' });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

// ── DENIAL DESIGNATION ───────────────────────────────────────────────────────────────────────────
router.post('/item/:childId/designate-denial', requireAuth, async function (req, res) {
  try {
    if (!(await requireManager(req, res, req.params.childId))) return;
    var out = await HUB.designateDenial(req.params.childId, Object.assign(actor(req), { grounds: (req.body || {}).grounds }));
    res.json(Object.assign(out, {
      // Said back to the caller in the words the screen must show. Nothing is denied by this call.
      note: 'Designated and sent to Legal Review with your grounds. This is NOT a denial: legal decides, and only a ' +
        'legal decision closes this item as denied. The bar carries the tag meanwhile.'
    }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

router.post('/item/:childId/withdraw-designation', requireAuth, async function (req, res) {
  try {
    if (!(await requireManager(req, res, req.params.childId))) return;
    res.json(await HUB.withdrawDesignation(req.params.childId, Object.assign(actor(req), { note: (req.body || {}).note })));
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

// ── MARK VAGUE / OVERLY BROAD — THROUGH THE EXISTING CLARIFICATION MACHINERY ─────────────────────
//
// Not a new defect store and not a new outreach path: `clarificationAction.send` already renders the
// templated request, resolves the channel, applies the jurisdiction's clock effect, records the defect and
// pauses the estimate task on `vague`. It is called here with the CHILD's id, because on an MRR the defect
// is the ITEM's — and it is manager-only, which IS the one-voice rule: the requestor hears one person.
router.post('/item/:childId/mark-defect', requireAuth, async function (req, res) {
  try {
    if (!(await requireManager(req, res, req.params.childId))) return;
    var b = req.body || {};
    var reason = b.reason === 'overly_broad' ? 'overly_broad' : 'vague';
    var CA = require('../services/clarificationAction');
    var out = await CA.send(req.params.childId, Object.assign(actor(req), {
      reason: reason, note: b.note, subject: b.subject, text: b.text, channel: b.channel
    }));
    res.json(Object.assign(out, { defect: await HUB.defectOf(req.params.childId) }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

// ── PER-CHILD RELEASE — READ, AND THE ACT, BOTH THROUGH THE EXISTING GATES ───────────────────────
//
// Draft 5 §3 question 4 drafted both ways and Kevin has not answered; the control ships on the child view
// because that is where the manager is looking at the finished item, and it is gated rather than
// permissive. It NEVER widens the auto-release pipeline: MRR stays excluded there (NON_MRR), and this is
// the manual orchestration that exclusion reserves for the Request Manager.
router.get('/item/:childId/release', requireAuth, async function (req, res) {
  try { res.json(await HUB.releaseState(req.params.childId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/item/:childId/hold', requireAuth, async function (req, res) {
  try {
    if (!(await requireManager(req, res, req.params.childId))) return;
    var RH = require('../services/releaseHold');
    var out = await RH.hold(req.params.childId, Object.assign(actor(req), { note: (req.body || {}).note }));
    res.json(out);
  } catch (e) {
    // VERBATIM. The hold guard's refusal is a legal sentence with a citation; paraphrasing it would make it
    // a different refusal, and the whole point of the prevention design is that the screen and the API say
    // exactly the same words.
    res.status(e.status || 500).json({ error: e.message, code: e.code, citation: e.citation || null });
  }
});

router.post('/item/:childId/lift-hold', requireAuth, async function (req, res) {
  try {
    if (!(await requireManager(req, res, req.params.childId))) return;
    var RH = require('../services/releaseHold');
    res.json(await RH.lift(req.params.childId, Object.assign(actor(req), { note: (req.body || {}).note })));
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code, citation: e.citation || null }); }
});

// The manual per-item release. It asks BOTH gates and refuses in THEIR words.
router.post('/item/:childId/release', requireAuth, async function (req, res) {
  try {
    if (!(await requireManager(req, res, req.params.childId))) return;
    var st = await HUB.releaseState(req.params.childId);
    if (!st.canRelease) {
      return res.status(409).json({ error: st.blockedReason, code: st.blockedBy === 'hold' ? 'RELEASE_HELD' : 'FUNDS_GATE',
        gate: st.gate, hold: st.hold });
    }
    // The shipping act is BW5's `autoRelease.release` — the ONE writer of `Closed – Delivered`, which
    // records the delivery, the installment number and the notice in one act. This router owns no second
    // notion of "delivered".
    //
    // ⚠️ NOTE WHICH FUNCTION THIS IS. `autoRelease.run()` is the PIPELINE, and its NON_MRR condition refuses
    // an MRR outright — that exclusion is untouched and must stay untouched. `release()` is the act the
    // pipeline performs when it is allowed to, and it is equally the act a Request Manager performs by hand.
    // Calling it here is the manual orchestration the NON_MRR condition RESERVES for the manager; it is not
    // the pipeline reaching an MRR by a side door, and nothing here arms the pipeline for anything.
    var AR = require('../services/autoRelease');
    var out = await AR.release(req.params.childId, Object.assign(actor(req), {
      note: (req.body || {}).note || 'Released by the Request Manager from the MRR hub.'
    }));
    // The parent's state follows its items and is NEVER asserted here (§5.8).
    try { await require('../services/disposition').deriveParent(req.params.childId); }
    catch (e) { console.error('[mrr release deriveParent]', e && e.message); }
    res.json(Object.assign(out, {
      parentStateNote: 'The master record’s state was re-derived from its items. A parent is never closed by hand.'
    }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

module.exports = router;
