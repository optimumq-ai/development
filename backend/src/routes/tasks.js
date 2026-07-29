const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const tr = require('../services/taskRouting');
const scope = require('../services/requestScope');
const SI = require('../services/searchIntents');
const laborActuals = require('../services/laborActuals');
const uuidv4 = require('uuid').v4;

function withReq(sql) {
  // A task hangs off the WORK row, but request_number is a PARENT field — the number the citizen quotes.
  // Resolved through the parent (today that IS the row itself, so this is a no-op). See requestScope.js.
  return "SELECT t.*, " + scope.numberExpr('r') + " AS request_number, r.description AS request_description, " +
    "r.requestor_name, r.deadline_date, r.stage, r.created_at AS request_created_at, r.record_type_id, rt.name AS record_type_name, d.name AS team_name " +
    "FROM tasks t LEFT JOIN requests r ON r.id = t.request_id" + scope.numberJoin('r') +
    " LEFT JOIN record_types rt ON rt.id = r.record_type_id LEFT JOIN departments d ON d.id = t.team_id " + sql;
}

// Open tasks the current user can claim (their team + a role they hold).
router.get('/pool', requireAuth, async function (req, res) {
  // Uses the SHARED eligibility predicate (services/taskRouting). This query used to have its own copy that
  // checked permission roles ONLY, so a task whose role_required is a v3 task-type token — legal_review,
  // legal_redaction, routing_review — was invisible here while taskRouting.poolForUser listed it (§3.5).
  var rows = await all(withReq("WHERE " + tr.POOL_ELIGIBILITY_SQL + " ORDER BY t.created_at"),
    [req.user.sub, req.user.sub, req.user.sub]);
  // TWO EYES (BW2): a release review of your own last step is not claimable, so it is not offered here
  // either — the same filter poolForUser applies, so the list and the claim guard cannot disagree.
  res.json({ tasks: await tr.filterTwoEyes(rows, req.user.sub) });
});

// Tasks assigned to the current user, each with its live timing (elapsed in the current state + phase totals,
// Slice B) computed from the bookmark trail.
router.get('/mine', requireAuth, async function (req, res) {
  var rows = await all(withReq("WHERE t.assigned_to = ? AND t.status IN ('assigned','in_progress','returned','awaiting_review') ORDER BY t.updated_at DESC"), [req.user.sub]);
  var timing = await require('../services/taskTiming').forTasks(rows);
  var budget = await require('../services/taskBudget').forTasks(rows, timing);
  rows.forEach(function (t) { t.timing = timing[t.id] || null; t.budget = budget[t.id] || null; });
  res.json({ tasks: rows });
});

// Claim an open task from the pool.
router.post('/:id/claim', requireAuth, async function (req, res) {
  var r = await tr.claim(req.params.id, req.user.sub);
  if (r.error) return res.status(409).json({ error: r.error });
  res.json({ task: r.task });
});

// Smart-routing suggestions for a task (who matches best), for a supervisor deciding assignment.
router.get('/:id/suggest', requireAuth, async function (req, res) {
  var task = await tr.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  var reqRow = await get('SELECT description FROM requests WHERE id = ?', [task.request_id]);
  var suggestions = await tr.suggestAssignee(reqRow ? reqRow.description : '', task.team_id, task.role_required, 5);
  res.json({ taskId: task.id, role: task.role_required, teamId: task.team_id, suggestions: suggestions });
});

// Manually assign a task to a user.
router.post('/:id/assign', requireAuth, requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'DEPT_MANAGER'), async function (req, res) {
  if (!req.body || !req.body.userId) return res.status(400).json({ error: 'userId is required' });
  var task = await tr.assign(req.params.id, req.body.userId, 'manual', null);
  res.json({ task: task });
});

// Create a task and (optionally) route it now: Smart Routing to a person, else leave in the pool.
router.post('/', requireAuth, requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'DEPT_MANAGER'), async function (req, res) {
  var b = req.body || {};
  if (!b.requestId || !b.type) return res.status(400).json({ error: 'requestId and type are required' });
  var task = await tr.createTask({ requestId: b.requestId, type: b.type, title: b.title, teamId: b.teamId, roleRequired: b.roleRequired, createdBy: req.user.sub });
  if (b.autoRoute) {
    var reqRow = await get('SELECT description FROM requests WHERE id = ?', [b.requestId]);
    var routed = await tr.autoRouteOrPool(task.id, reqRow ? reqRow.description : '', {});
    return res.json({ task: routed.task, routing: routed });
  }
  res.json({ task: task });
});

// Task detail (with request + record-type context) for the work screen.
router.get('/:id', requireAuth, async function (req, res) {
  // deadline_date / stage / requestor contact are here for the RECORD-SEARCH task screen
  // (SPEC_record_search_task_screen §6). The deadline is not decoration on that screen: the Overly-Broad
  // marker has to show the RUNNING clock, because in Illinois the burden-denial conference does NOT toll it
  // and letting the deadline pass forfeits the exemption outright.
  var t = await get(
    "SELECT t.*, " + scope.numberExpr('r') + " AS request_number, r.requestor_name, r.requestor_email, " +
    "r.description AS request_description, r.record_type_id, r.stage, r.deadline_date, r.delivery_method, " +
    "rt.name AS record_type_name, rt.formats AS record_type_formats, d.name AS team_name " +
    "FROM tasks t LEFT JOIN requests r ON r.id = t.request_id" + scope.numberJoin('r') + " LEFT JOIN record_types rt ON rt.id = r.record_type_id " +
    "LEFT JOIN departments d ON d.id = t.team_id WHERE t.id = ?", [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json({ task: t });
});

// Begin work on a task (the task-entry contract, Slice A): the owner opening it transitions assigned/returned
// -> in_progress, which the DB trigger bookmarks. Idempotent; a non-owner viewing does not start the clock.
router.post('/:id/begin', requireAuth, async function (req, res) {
  var t = await tr.enterTask(req.params.id, req.user.sub);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json({ task: t });
});

// Work-timer heartbeat (Slice D): the active-work timer posts its running total; store it monotonically so a
// stale/racey beat can never lower it. Ignored once the labor is finalized.
router.post('/:id/work', requireAuth, async function (req, res) {
  var secs = Math.max(0, Math.floor(Number(req.body && req.body.seconds) || 0));
  var t = await get('SELECT work_seconds, work_finalized FROM tasks WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  if (t.work_finalized) return res.json({ work_seconds: t.work_seconds, finalized: true });
  await run("UPDATE tasks SET work_seconds = GREATEST(COALESCE(work_seconds,0), ?), updated_at = datetime('now') WHERE id = ? AND COALESCE(work_finalized,0) = 0", [secs, req.params.id]);
  res.json({ work_seconds: Math.max(t.work_seconds || 0, secs) });
});

// Finalize the labor at completion (Slice D): accept the measured time, or adjust it (a reason is REQUIRED).
// The raw measurement is kept in work_measured_seconds for defensibility.
router.post('/:id/work/finalize', requireAuth, async function (req, res) {
  var t = await get('SELECT assigned_to, request_id, type, work_seconds, work_finalized FROM tasks WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  var roles = req.user.roles || [];
  var elevated = roles.indexOf('SYSTEM_ADMIN') !== -1 || roles.indexOf('DIRECTOR') !== -1 || roles.indexOf('SUPERVISOR') !== -1;
  if (t.assigned_to && t.assigned_to !== req.user.sub && !elevated) return res.status(403).json({ error: 'Only the assignee can log time on this task.' });
  var measured = Math.max(0, Math.floor(Number(req.body && req.body.seconds != null ? req.body.seconds : t.work_seconds) || 0));
  var b = req.body || {};
  var wasFinalized = !!t.work_finalized;
  var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'staff';
  // Slice E · Fork 2 — auto-draft reconciliation when this finalize completes the LAST billable work task on the
  // request. Non-fatal by construction (never throws), and a no-op unless a prior estimate + measured labor exist,
  // so an ordinary finalize on an un-estimated task writes nothing. The revised-notice SEND stays human-gated.
  async function fireAutoDraft() { try { await laborActuals.maybeAutoDraftOnFinalize(t.request_id, req.params.id, t.type, actor, wasFinalized); } catch (e) {} }
  // SKIP (user-discretion mode, Slice E): the assignee chose not to log billable time. Keep the raw measurement
  // for defensibility, but leave work_seconds NULL so no billable actual flows to reconciliation. Finalized so the
  // heartbeat stops and the modal never re-fires.
  if (b.skipped) {
    await run("UPDATE tasks SET work_measured_seconds = ?, work_seconds = NULL, work_adjust_reason = ?, work_finalized = 1, updated_at = datetime('now') WHERE id = ?",
      [measured, 'skipped (user discretion)', req.params.id]);
    await fireAutoDraft();
    return res.json({ task: await tr.getTask(req.params.id), skipped: true });
  }
  var adjusted = b.adjustedSeconds != null && Math.floor(Number(b.adjustedSeconds)) !== measured;
  if (adjusted) {
    var reason = (b.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A short reason is required to adjust the measured time.' });
    await run("UPDATE tasks SET work_measured_seconds = ?, work_seconds = ?, work_adjust_reason = ?, work_finalized = 1, updated_at = datetime('now') WHERE id = ?",
      [measured, Math.max(0, Math.floor(Number(b.adjustedSeconds))), reason, req.params.id]);
  } else {
    await run("UPDATE tasks SET work_measured_seconds = ?, work_seconds = ?, work_finalized = 1, updated_at = datetime('now') WHERE id = ?", [measured, measured, req.params.id]);
  }
  await fireAutoDraft();
  res.json({ task: await tr.getTask(req.params.id) });
});

// ============================================================================================
// `POST /tasks/:id/complete` WAS HERE AND HAS BEEN REMOVED (brief §3.3). DO NOT RE-ADD IT.
//
// It was three lines: `UPDATE tasks SET status='done' WHERE id = ?`, behind `requireAuth` and nothing
// else. No ownership check, no type check, and — the part that mattered — NO STAGE SIDE-EFFECT. Any
// authenticated user could mark ANY task done; the task went green and its stage stayed exactly where it
// was, so the request was stranded with nothing left to move it. Silent, and invisible on every screen.
//
// It was DEAD ON ARRIVAL. Added 2026-06-24 (8bfc555) alongside the estimate screen, but that screen
// completes its task by a direct UPDATE in `routes/feeEstimates.js` instead, so this endpoint never had a
// single caller — frontend, backend, tests or scripts — in the four weeks it existed. It was pure
// unguarded surface area.
//
// WHY REMOVED RATHER THAN HARDENED: it is precisely the endpoint a "click to approve" stub screen would
// reach for, and a hardened version would still be a way to finish a task WITHOUT moving the request.
// Every stub would look like it worked while quietly stranding its request.
//
// COMPLETING A TASK MUST MOVE THE REQUEST. Follow `/:id/resolve` below: check the type, enforce whatever
// "enough to advance" means for it, then call `taskRouting.applyStageTransition` — the ONE central
// transition (ARCHITECTURE item 6), which writes request_history and spawns the next stage's task. A stub
// screen built that way is a genuine node in the flow, and replacing it later is a UI change, not a rewrite.
// ============================================================================================

// ============================================================================================
// RESOLVE A RECORD-SEARCH TASK (SPEC_record_search_task_screen §5d).
//
// Two ways out, and they are not symmetrical.
//
//   found      — at least one record is marked Include in Response. This is the gate the workflow model
//                already DECLARES ("enough-to-advance: at least one record marked Include in Response")
//                and which nothing enforced. Enforce it here: advancing an empty search would hand
//                redaction a request with nothing in it.
//
//   no_records — the request is CLOSED. This is a legal act, not a shrug. It must be EVIDENCED: the
//                effort trail (systems searched, calls logged, clarifications sent) is what the city
//                shows when someone asks whether the search was diligent. And per the BWC research, up
//                to 40% of dispatches that should have body-cam video HAVE NONE -- "no responsive
//                records" is a MODAL outcome, not a failure state. So we refuse to close on NOTHING:
//                a closure with an empty effort trail is indistinguishable from never having looked.
//
// The stage move goes through applyStageTransition -- the ONE central transition (ARCHITECTURE item 6).
// No direct `UPDATE requests SET stage` anywhere.
// ============================================================================================
router.post('/:id/resolve', requireAuth, async function (req, res) {
  try {
    var t = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (t.type !== 'record_search' && t.type !== 'legal_review' && t.type !== 'intake_review') {
      return res.status(400).json({ error: 'This task type has no resolution path here.' });
    }

    // A FINISHED TASK MUST NOT DRIVE A STAGE TRANSITION (found 2026-07-19, brief §3.3's shape again).
    //
    // This route checked the task TYPE and never its STATUS, so a `done` or `cancelled` task could still be
    // resolved — and resolving it runs applyStageTransition, so it MOVES A REQUEST. Two live ways to reach it:
    //
    //   cancelled — §3.2 cancels a stage's task when the request moves on. A legal_review left behind by a
    //               stage change was still resolvable, and doing so dragged the request back into the legal
    //               outcome's destination. Observed for real: a cancelled legal_review advanced a request to
    //               redaction_review days after its stage had moved.
    //   done      — nothing stopped the same task being resolved TWICE, transitioning the request each time.
    //
    // 409, not 400: the request is well-formed, the task's state is what makes it impossible. The UI mirrors
    // this check so the reviewer is not surprised, but THIS is the guard — the screen's is a courtesy.
    if (!tr.isActionable(t.status)) {
      return res.status(409).json({
        error: 'This task is ' + t.status + ' and can no longer be resolved.',
        code: 'TASK_NOT_ACTIONABLE',
        status: t.status
      });
    }

    var outcome = String((req.body && req.body.outcome) || '');
    var notes = String((req.body && req.body.notes) || '').trim();
    var rid = t.request_id;
    var actor = { actorId: req.user && req.user.sub, actorName: (req.user && req.user.name) || 'Staff' };

    // ==========================================================================================
    // RESOLVE A LEGAL REVIEW (brief §3.2).
    //
    // `legal_review` spawns at exemption_review / ag_review and, until now, NOTHING could complete it: no
    // route resolved it, and the 2-minute reconciler re-created it for as long as the request sat at that
    // stage — correctly, since the stage genuinely still needed its task. The removed
    // `POST /tasks/:id/complete` was the only thing that could mark it done, and doing so would have left
    // the request at exemption_review with no task and no way forward. So the fix is not "let it be
    // completed" — it is "let it be DECIDED", because completing a legal review IS a stage decision.
    //
    // THE OUTCOME VOCABULARY IS DELIBERATELY THE SAME AS THE AG RULING'S (`/requests/:id/ag-ruling`):
    // sustained / overruled / partial, with the same destinations. An internal exemption review and an AG
    // pre-clearance ruling answer the SAME question — does the withholding stand? — and giving them two
    // vocabularies would mean two ways to say one thing.
    //
    // A NOTE IS REQUIRED (Kevin, 2026-07-18). Asserting an exemption is a legal act the city may later have
    // to defend; "the reviewer clicked approve" is not a defence. It costs nothing to type and it is the
    // only durable record of WHY the material was withheld or released.
    // ==========================================================================================
    if (t.type === 'legal_review') {
      var LEGAL_OUTCOMES = {
        sustained: { stage: 'redaction_review', label: 'withholding sustained' },
        partial:   { stage: 'redaction_review', label: 'partial release' },
        overruled: { stage: 'delivery',         label: 'must release' }
      };
      var decision = LEGAL_OUTCOMES[outcome];
      if (!decision) {
        return res.status(400).json({ error: 'Outcome must be one of: sustained, partial, overruled.', code: 'UNKNOWN_OUTCOME' });
      }
      if (!notes) {
        return res.status(422).json({
          error: 'A note is required to record a legal review. Say what was withheld or released, and on what basis.',
          code: 'NOTE_REQUIRED'
        });
      }
      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      await tr.applyStageTransition(rid, decision.stage, Object.assign({
        action: 'LEGAL_REVIEW_RECORDED',
        notes: 'Legal review recorded (' + decision.label + '). ' + notes
      }, actor));
      return res.json({ ok: true, outcome: outcome, stage: decision.stage });
    }

    // ==========================================================================================
    // RESOLVE AN INTAKE REVIEW (PHASE 7 / BW3 — DRAFT_processing_ui_intake_review.md §4.6).
    //
    // ONE outcome: `proceed`. That asymmetry is the design, not an omission — every OTHER way an intake
    // review can end already has its own act, and each of them ends the task through the machinery that
    // performs it rather than through here:
    //
    //   marked Vague / Overly Broad  -> clarificationAction holds the request pending the requestor
    //   referred to another custodian -> the custodian-referral act
    //   denied (OH "too vague")       -> Denial compose, an empowered role's act
    //   re-routed to the right team   -> intakeReview.closeForResolvedTrigger('unroutable')
    //
    // There is deliberately NO manual hold (spec §2.4, Kevin 7/29): hold is a system state with a named
    // cause. A "Hold" outcome here would be exactly the unnamed stop that decision removed.
    //
    // THE GATE IS SHARED (services/intakeReview.proceedGate): this route refuses on it and the screen
    // renders it. 422 with a named cause, the record-search Found gate's pattern.
    // ==========================================================================================
    if (t.type === 'intake_review') {
      if (outcome !== 'proceed') {
        return res.status(400).json({
          error: 'An intake review resolves by proceeding. Marking the request vague or overly broad, ' +
                 'referring it to another custodian, or denying it are their own acts and end this task themselves.',
          code: 'UNKNOWN_OUTCOME'
        });
      }
      var IR = require('../services/intakeReview');
      var gate = await IR.proceedGate(rid);
      if (gate.blocked) {
        return res.status(422).json({
          error: gate.reasons.map(function (r) { return r.text; }).join(' '),
          // The FIRST open cause is the code, so a caller that switches on one still gets a true answer;
          // `reasons` carries all of them, because a reviewer should see every stop at once rather than
          // clearing one and discovering the next.
          code: gate.reasons[0].code,
          reasons: gate.reasons
        });
      }
      // Proceed → Fulfillment through the ONE central transition. `record_search` is the fulfillment entry
      // the mockup's Resolve panel names ("Proceed routes the item to Record Search on the … Team").
      //
      // BUT ONLY FORWARD. Two live shapes put an open intake review on a request that is already moving:
      //   * the ordinary `approval_pending` case — the classifier routed it confidently and only the waiver
      //     stopped it, so the request is ALREADY at record_search;
      //   * `always` mode — every non-MRR request gets a stop, including ones that then advance under it.
      // Handing 'record_search' to applyStageTransition in the first case is a harmless no-op (same stage
      // in, `changed:false` out). In the second it would DRAG THE REQUEST BACKWARDS out of redaction or
      // delivery, cancel that stage's task and re-spawn a search — a silent regression of real work. So the
      // stage is only offered when the request has not passed it; otherwise the task completes and says so.
      var STAGE_ORDER = require('../services/stages').ORDER;
      var cur = await get('SELECT stage FROM requests WHERE id = ?', [rid]);
      var curIdx = STAGE_ORDER.indexOf(cur && cur.stage);
      var targetIdx = STAGE_ORDER.indexOf('record_search');
      var behind = curIdx === -1 || curIdx < targetIdx;
      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      var moved = null;
      if (behind) {
        moved = await tr.applyStageTransition(rid, 'record_search', Object.assign({
          action: 'INTAKE_REVIEW_COMPLETE',
          notes: 'Intake review complete — proceeding to fulfillment.' + (notes ? ' ' + notes : '')
        }, actor));
      } else {
        // Still recorded: the review happened and was cleared, which is the fact the audit trail needs. The
        // stage is simply not this task's to change any more.
        await run(
          'INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
          [uuidv4(), rid, actor.actorId || null, actor.actorName, 'INTAKE_REVIEW_COMPLETE',
           'Intake review complete — the request had already advanced to ' + (cur && cur.stage) +
           ', so its stage was left as it was found.' + (notes ? ' ' + notes : '')]);
      }
      return res.json({ ok: true, outcome: 'proceed', stage: behind ? 'record_search' : (cur && cur.stage),
                        stageChanged: !!(moved && moved.changed) });
    }

    if (outcome === 'found') {
      var inc = await get('SELECT count(*)::int AS n FROM request_files WHERE request_id = ? AND responsive = 1', [rid]);
      if (!inc || inc.n < 1) {
        return res.status(422).json({ error: 'Mark at least one record "Include in Response" before completing the search.', code: 'NOTHING_INCLUDED' });
      }

      // THE R9 GATE (Tier 1 #5). The requestor's intent is not a suggestion.
      //
      // Attaching records is NOT the same as having searched. The records the requestor picked in the
      // portal are already sitting on the request -- so without this, a description whose intent says
      // "these match, but ALSO search for MORE" would be satisfied by the requestor's OWN PICKS, and the
      // request would advance to redaction and be fulfilled. We would close, as complete, a request the
      // requestor still considers OPEN. R9 has been able to SAY this since it shipped; nothing acted on it.
      var open = await SI.openIntents(rid);
      if (open.length) {
        return res.status(422).json({
          error: open.length === 1
            ? 'The requestor asked the team to search for “' + open[0].description + '”. Answer that description — record what you found, or that there is nothing more — before completing the search.'
            : open.length + ' descriptions still need an answer from you — record what you found, or that there is nothing more — before completing the search.',
          code: 'UNRESOLVED_SEARCH_INTENT',
          openIntents: open.map(function (i) { return { id: i.id, description: i.description, intent: i.intent }; })
        });
      }

      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      // A COMPLETED SEARCH GOES TO REDACTION REVIEW, NOT TO A LEGAL STAGE (Kevin, 2026-07-19, brief §5).
      //
      // This used to advance to `exemption_review` unconditionally — so EVERY request that found records
      // entered a legal stage, spawned a `legal_review` task and had to be adjudicated
      // (sustained/partial/overruled) before it could be redacted, whether or not anyone had asserted an
      // exemption over anything. It was the larger half of the sequential-vs-branch defect: the Advance
      // button merely OFFERED the wrong stage, this one took it automatically.
      //
      // `exemption_review` / `ag_review` are now entered only by `POST /requests/:id/assert-exemption` —
      // which is where the reviewer says something IS being withheld. Finding records is not that claim.
      // Exempt material is identified during redaction, and asserting it branches from there.
      await tr.applyStageTransition(rid, 'redaction_review', Object.assign({
        action: 'SEARCH_COMPLETE',
        notes: 'Record search complete — ' + inc.n + ' record(s) marked Include in Response.' + (notes ? ' ' + notes : '')
      }, actor));
      return res.json({ ok: true, outcome: 'found', included: inc.n });
    }

    if (outcome === 'no_records') {
      // The effort trail IS the evidence. Refuse to close on an empty one -- not bureaucracy: a closure
      // with no recorded effort cannot be defended, and the searcher would never know until it was.
      var eff = await get(
        "SELECT count(*)::int AS n FROM request_history WHERE request_id = ? AND action IN " +
        "('CONSULT_REQUESTED','CALL_LOGGED','CLARIFICATION_REQUESTED','RECORD_ATTACHED','SEARCH_RUN')", [rid]);
      if (!eff || eff.n < 1) {
        return res.status(422).json({
          error: 'Nothing has been logged on this request. A no-records closure has to be evidenced — run a search, log a call, or confer first.',
          code: 'NO_EFFORT_TRAIL'
        });
      }
      // A no-records closure IS "I searched; there is nothing more" -- asserted about the whole request at
      // once. It does not need the gate (the effort trail above is its evidence), but it must not leave the
      // per-description ledger half-written: every open description is answered BY this closure, and the
      // audit trail should say so rather than showing descriptions that were never dispositioned.
      var closedOut = await SI.resolveAllOpen(rid, {
        actorName: actor.actorName,
        note: 'Closed with the request: no responsive records found.' + (notes ? ' ' + notes : '')
      });

      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      await run("UPDATE requests SET closure_reason = 'no_records' WHERE id = ?", [rid]);
      await tr.applyStageTransition(rid, 'closed', Object.assign({
        action: 'CLOSED_NO_RECORDS',
        notes: 'Closed — no responsive records. Diligent search evidenced by ' + eff.n + ' logged action(s).' + (notes ? ' ' + notes : '')
      }, actor));
      return res.json({ ok: true, outcome: 'no_records', effortEntries: eff.n, intentsClosed: closedOut });
    }

    return res.status(400).json({ error: 'Unknown outcome' });
  } catch (e) {
    console.error('resolve failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
