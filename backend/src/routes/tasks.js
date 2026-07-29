const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const tr = require('../services/taskRouting');
const scope = require('../services/requestScope');
const SI = require('../services/searchIntents');
const laborActuals = require('../services/laborActuals');
const DISP = require('../services/disposition');
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
  // PHASE 7 / BW4 — "PATH HERE" on the estimate rows only (Draft 2 §1). The estimator's duty changes with
  // the answer: `Auto-routed — first human review` means nobody has read this request yet, because the
  // engine sequences estimate before record search on a confident auto-route. It is computed HERE rather
  // than in a queue endpoint of its own because it is two indexed reads per row and only estimate rows ask
  // for it — unlike the intake queue's per-request clock resolution, which earned its own endpoint.
  try {
    var IRp = require('../services/intakeReview');
    var est = rows.filter(function (t) { return t.type === 'estimate' || t.type === 'mrr_estimate'; });
    for (var i = 0; i < est.length; i++) {
      est[i].pathHere = await IRp.provenance(est[i].request_id);
      est[i].paused = require('../services/taskPause').stateOf(est[i]);
    }
  } catch (e) { console.error('[tasks/mine pathHere]', e && e.message); }
  res.json({ tasks: rows });
});

// ============================================================================================
// THE INTAKE EXCEPTIONS QUEUE (PHASE 7 / BW3 — DRAFT_processing_ui_intake_review.md §1, mockup screen 1).
//
// Under `when_needed` (the default) intake review is not a stage everything passes through — it is the
// EXCEPTIONS. A confidently-classified, clean request routes straight to its team and never appears here.
// So the queue's first job is answering "which exception?", and its second is showing an HONEST clock.
//
// WHY ITS OWN ENDPOINT rather than enriching /tasks/mine. Two of the three columns need work no other task
// type wants: the trigger keys have to be labelled, and each row needs its request's PARENT clock resolved
// through the clock matrix (kind + citation + overdueMeaning). Doing that for every redaction and estimate
// row on My Tasks would be per-request clock computation on a page that never renders it.
//
// ⚠ RULE (a) IS ENFORCED BY WHAT THIS RETURNS, not by the frontend's taste. `kind` comes from
// tolling.computeStatus via the clock matrix, `citation` is present only where the definition carries one,
// and the words come from `overdueMeaning`. A city service target and a statutory deadline are different
// `kind` values here, and a request with no clock at all comes back `kind: 'none'` with a null date — the
// honest Ohio state. Nothing in this payload lets a screen dress a target up as law, and nothing in it
// invents a date.
// ============================================================================================
router.get('/intake-queue', requireAuth, async function (req, res) {
  try {
    var IR = require('../services/intakeReview');
    var mine = await all(withReq("WHERE t.type = 'intake_review' AND t.assigned_to = ? AND t.status IN ('assigned','in_progress','returned','awaiting_review') ORDER BY t.created_at"), [req.user.sub]);
    // The pool half: the same eligibility predicate /tasks/pool uses, so the queue and the claim guard
    // cannot disagree about what this person may take.
    var pool = await all(withReq("WHERE t.type = 'intake_review' AND " + tr.POOL_ELIGIBILITY_SQL + " ORDER BY t.created_at"),
      [req.user.sub, req.user.sub, req.user.sub]);
    var rows = mine.map(function (t) { t.mine = true; return t; })
      .concat(pool.filter(function (p) { return !mine.some(function (m) { return m.id === p.id; }); })
        .map(function (t) { t.mine = false; return t; }));

    var rules = null;
    try { rules = await require('../services/tolling').loadRules(); } catch (e) { rules = null; }

    for (var i = 0; i < rows.length; i++) {
      var t = rows[i];
      var keys = IR.triggersOf(t);
      t.triggers = keys.map(function (k) { return { key: k, label: IR.TRIGGER_LABELS[k] || k }; });
      // The three states of "why it's here", and they are NOT the same thing:
      //   triggers      — a trigger fired and named itself
      //   always mode   — the city asked for a stop on every request (spawn_triggers = '[]')
      //   unrecorded    — a row that predates the column. "No recorded trigger" must never read as
      //                   "some trigger I do not know about", so it says exactly what it knows.
      t.alwaysMode = !keys.length && t.spawn_triggers != null;
      t.triggerUnrecorded = !keys.length && t.spawn_triggers == null;
      t.clock = null;
      try {
        var pr = await get('SELECT master_request_id FROM requests WHERE id = ?', [t.request_id]);
        var clockOwner = (pr && pr.master_request_id) || t.request_id; // clocks are PARENT objects (§4.2)
        var clocks = rules ? await all("SELECT * FROM request_clocks WHERE request_id = ? AND status <> 'satisfied' ORDER BY is_primary DESC, created_at", [clockOwner]) : [];
        if (clocks.length) {
          var tolls = await all('SELECT * FROM clock_tolls WHERE clock_id = ? ORDER BY created_at', [clocks[0].id]);
          var st = require('../services/tolling').computeStatus(clocks[0], tolls, rules);
          t.clock = { kind: st.kind, label: st.label, dueDate: st.dueDate, citation: st.citation,
                      legalDeadline: st.legalDeadline, operationalTarget: st.operationalTarget,
                      isOverdue: st.isOverdue, overdueMeaning: st.overdueMeaning, exposures: st.exposures,
                      remainingDays: st.remainingDays, state: st.state, more: clocks.length - 1 };
        }
      } catch (e) { console.error('[intake-queue clock]', t.id, e && e.message); }
    }
    res.json({ tasks: await tr.filterTwoEyes(rows, req.user.sub) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================================================
// THE INTAKE REVIEW SCREEN'S CONTEXT (PHASE 7 / BW3 — mockup screen 2).
//
// Everything the screen needs that is NOT already a general-purpose endpoint, in one read. The general ones
// stay general and the screen calls them directly: `/requests/:id`, `/requests/:id/eligibility-findings`,
// `/requests/:id/search-intents`, `/jurisdiction-profile/ledger/request/:id`,
// `/jurisdiction-profile/branch-profile`. What is HERE is the part that is specific to this task:
//
//   * the trigger keys, LABELLED (the "Here because:" line)
//   * the PARENT (the screen is parent-scoped; the task hangs off the work row, which for a non-MRR
//     request is the single child — see SPEC_parent_child_lifecycle §4.1)
//   * the PROCEED GATE, from the same function the resolve route refuses on, so the Resolve panel's words
//     and the 422's words cannot drift
//   * the two approval modules' evaluations, so the inline panels know whether they exist AT ALL
//
// THE INLINE PANEL'S EXISTENCE RULE (rule b + draft §2): a panel exists only when the module's `mode` is
// `intake_review` AND the branch capability is not explicitly `false`. `null` (unknown — 19 of 21 seeded
// cities) RENDERS. approvalModules.config already folds `branchAvailable` in, and it is passed through
// verbatim rather than re-derived here.
// ============================================================================================
router.get('/:id/intake-context', requireAuth, async function (req, res) {
  try {
    var t = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (t.type !== 'intake_review') return res.status(400).json({ error: 'Not an intake review task.' });
    var IR = require('../services/intakeReview');
    var keys = IR.triggersOf(t);
    var reqRow = await get('SELECT * FROM requests WHERE id = ?', [t.request_id]);
    var parent = (reqRow && reqRow.master_request_id) ? await get('SELECT * FROM requests WHERE id = ?', [reqRow.master_request_id]) : null;

    var waiver = null, commercial = null;
    try {
      var AM = require('../services/approvalModules');
      var amCfg = await AM.config(null);
      waiver = await AM.evaluateWaiver(null, reqRow, { config: amCfg });
      commercial = await AM.evaluateCommercial(null, reqRow, { config: amCfg });
    } catch (e) { console.error('[intake-context approval modules]', e && e.message); }

    // Clocks, all of them, in the clock strip's own vocabulary. Read-only and computed from the PARENT,
    // which is where the statutory clock lives (§4.2 — one legal deadline per citizen request).
    var clocks = [];
    try {
      var owner = (reqRow && reqRow.master_request_id) || t.request_id;
      var rules = await require('../services/tolling').loadRules();
      var rows = await all('SELECT * FROM request_clocks WHERE request_id = ? ORDER BY is_primary DESC, created_at', [owner]);
      for (var i = 0; i < rows.length; i++) {
        var tolls = await all('SELECT * FROM clock_tolls WHERE clock_id = ? ORDER BY created_at', [rows[i].id]);
        var st = require('../services/tolling').computeStatus(rows[i], tolls, rules);
        clocks.push({ kind: st.kind, label: st.label, dueDate: st.dueDate, citation: st.citation,
          legalDeadline: st.legalDeadline, operationalTarget: st.operationalTarget, isOverdue: st.isOverdue,
          overdueMeaning: st.overdueMeaning, exposures: st.exposures, state: st.state, isPrimary: st.isPrimary });
      }
    } catch (e) { console.error('[intake-context clocks]', e && e.message); }

    res.json({
      task: t,
      triggers: keys.map(function (k) { return { key: k, label: IR.TRIGGER_LABELS[k] || k }; }),
      alwaysMode: !keys.length && t.spawn_triggers != null,
      triggerUnrecorded: !keys.length && t.spawn_triggers == null,
      request: reqRow, parent: parent,
      clocks: clocks,
      gate: await IR.proceedGate(t.request_id),
      waiver: waiver, commercial: commercial
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// THE EDIT-INFO FRAME'S WRITE (draft §0b.5). Three AI-produced facts, corrected in place: classification,
// record owner, and the team the item will route to on Proceed.
//
// WHY NOT `PATCH /requests/:id/route`. That endpoint does a re-routing CONSOLIDATION — moves every open work
// task onto the new team, re-runs Smart Routing on each, spawns an estimate if none exists, and closes the
// unroutable trigger. At intake there is no open work task to move (the unroutable path spawns none), and
// the stop is about to be closed by Proceed anyway; running that machinery here would spawn an estimate task
// the reviewer never asked for. Proceed's applyStageTransition spawns the fulfillment task onto whatever
// team this wrote, which is the correction actually taking effect.
//
// Authorized to the TASK'S ASSIGNEE (this is their job — trigger (i) is literally "you decide the team") or
// to the roles that could already re-route. The task must be actionable: correcting the routing of a request
// through a finished task is the stale-task class of bug the resolve route's 409 exists for.
// ============================================================================================
// THE ESTIMATE TASK SCREEN'S CONTEXT (PHASE 7 / BW4 — DRAFT_processing_ui_estimate.md).
//
// Same device as `/intake-context`: one read for the facts that are specific to THIS task, while the
// general-purpose endpoints the screen already calls stay general (`/fee-estimates/request/:id` builds the
// estimate itself and is untouched here).
//
// What is here:
//   * PROVENANCE — "was there an intake stop on this request, and what did it decide" (§4.2). This is the
//     fact the whole screen's tone hangs on: on the auto-routed path the estimator is the FIRST person to
//     read the request, and their duty is different from an estimator picking up a request an ORO Associate
//     has already scoped.
//   * the COMMERCIAL classification, evaluated + as recorded (BW4 stage 1)
//   * the WAIVER panel's state and the send gate, in the server's words (BW4 stage 4)
//   * the estimate task's PAUSE state (BW4 stage 2)
//   * CHARGEABILITY — which line kinds this state's fee config permits, each with its citation (stage 5)
// ============================================================================================
router.get('/:id/estimate-context', requireAuth, async function (req, res) {
  try {
    var t = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (t.type !== 'estimate' && t.type !== 'mrr_estimate') return res.status(400).json({ error: 'Not an estimate task.' });
    var reqRow = await get('SELECT * FROM requests WHERE id = ?', [t.request_id]);
    var parent = (reqRow && reqRow.master_request_id) ? await get('SELECT * FROM requests WHERE id = ?', [reqRow.master_request_id]) : null;

    var commercial = null, waiver = null;
    try {
      var AM = require('../services/approvalModules');
      var amCfg = await AM.config(null);
      commercial = await AM.evaluateCommercial(null, reqRow, { config: amCfg });
      waiver = await AM.evaluateWaiver(null, reqRow, { config: amCfg });
    } catch (e) { console.error('[estimate-context approval modules]', e && e.message); }

    var provenance = null;
    try { provenance = await require('../services/intakeReview').provenance(t.request_id); }
    catch (e) { console.error('[estimate-context provenance]', e && e.message); }

    var waiverGate = { blocked: false };
    try { waiverGate = await require('../services/approvalModules').estimateCommunicationGate(null, reqRow); }
    catch (e) { console.error('[estimate-context waiver gate]', e && e.message); }

    // The de-minimis threshold knob, evaluated against the latest saved estimate — the SAME function the
    // waive route refuses on, so the rail cannot offer an action the endpoint will reject.
    var deMinimis = null;
    try {
      var lastSnap = await get("SELECT total FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [t.request_id]);
      deMinimis = await require('../services/deMinimisPolicy').offerFor(lastSnap ? lastSnap.total : null, null);
    } catch (e) { console.error('[estimate-context de minimis]', e && e.message); }

    res.json({
      task: t, request: reqRow, parent: parent,
      paused: require('../services/taskPause').stateOf(t),
      provenance: provenance,
      commercial: commercial,
      waiver: waiver,
      // The panel's states, decided server-side. A screen that derived "is a mandatory waiver armed here"
      // for itself would be a second reading of the statute list, free to disagree with the one that acts.
      waiverPanel: require('../services/approvalModules').waiverPanelState(waiver, reqRow),
      waiverGate: waiverGate.blocked ? { blocked: true, code: waiverGate.code, reason: waiverGate.reason }
        : { blocked: false, notOffered: !!waiverGate.notOffered },
      deMinimis: deMinimis
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/intake-routing', requireAuth, async function (req, res) {
  try {
    var t = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (t.type !== 'intake_review') return res.status(400).json({ error: 'Not an intake review task.' });
    if (!tr.isActionable(t.status)) {
      return res.status(409).json({ error: 'This task is ' + t.status + ' and can no longer be edited.', code: 'TASK_NOT_ACTIONABLE' });
    }
    var roles = (req.user && req.user.roles) || [];
    var mayRoute = ['SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN', 'DEPT_MANAGER', 'COORDINATOR'].some(function (r) { return roles.indexOf(r) !== -1; });
    if (t.assigned_to !== (req.user && req.user.sub) && !mayRoute) {
      return res.status(403).json({ error: 'This intake review is not yours.' });
    }
    var b = req.body || {};
    var reqRow = await get('SELECT * FROM requests WHERE id = ?', [t.request_id]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });

    var sets = [], vals = [], said = [];
    // Each field is validated against the list it claims to come from — the taxonomy, City Departments,
    // Fulfillment Teams. A dropdown is not a guarantee; a request routed to a department id that is not a
    // team would sit in a pool that cannot exist.
    if (Object.prototype.hasOwnProperty.call(b, 'recordTypeId')) {
      var rt = b.recordTypeId ? await get('SELECT id, name FROM record_types WHERE id = ?', [b.recordTypeId]) : null;
      if (b.recordTypeId && !rt) return res.status(400).json({ error: 'That is not a record type in this taxonomy.' });
      sets.push('record_type_id = ?'); vals.push(rt ? rt.id : null);
      if ((reqRow.record_type_id || null) !== (rt ? rt.id : null)) said.push('classified as ' + (rt ? rt.name : 'unclassified'));
    }
    if (Object.prototype.hasOwnProperty.call(b, 'ownerDepartmentId')) {
      var od = b.ownerDepartmentId ? await get("SELECT id, name FROM departments WHERE id = ? AND active = 1", [b.ownerDepartmentId]) : null;
      if (b.ownerDepartmentId && !od) return res.status(400).json({ error: 'That is not an active city department.' });
      sets.push('record_owner_department_id = ?'); vals.push(od ? od.id : null);
      if ((reqRow.record_owner_department_id || null) !== (od ? od.id : null)) said.push('record owner ' + (od ? od.name : 'cleared'));
    }
    if (Object.prototype.hasOwnProperty.call(b, 'teamId')) {
      var tm = b.teamId ? await get("SELECT id, name FROM departments WHERE id = ? AND kind = 'team' AND active = 1", [b.teamId]) : null;
      if (b.teamId && !tm) return res.status(400).json({ error: 'That is not an active fulfillment team.' });
      sets.push('department_id = ?'); vals.push(tm ? tm.id : null);
      if ((reqRow.department_id || null) !== (tm ? tm.id : null)) said.push('will route to ' + (tm ? tm.name : 'no team'));
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
    vals.push(t.request_id);
    await run("UPDATE requests SET " + sets.join(', ') + ", updated_at = datetime('now') WHERE id = ?", vals);
    // Only when something actually MOVED. A history row saying a reviewer confirmed what the AI already
    // said is noise in the trail the city may one day have to read.
    if (said.length) {
      await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
        [uuidv4(), t.request_id, req.user && req.user.sub, (req.user && req.user.name) || 'Staff', 'INTAKE_INFO_CORRECTED',
         'Intake review corrected the item: ' + said.join('; ') + '.']);
    }
    res.json({ ok: true, changed: said, request: await get('SELECT * FROM requests WHERE id = ?', [t.request_id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      if (!decision && outcome !== 'denied') {
        return res.status(400).json({ error: 'Outcome must be one of: sustained, partial, overruled, denied.', code: 'UNKNOWN_OUTCOME' });
      }
      if (!notes) {
        return res.status(422).json({
          error: 'A note is required to record a legal review. Say what was withheld or released, and on what basis.',
          code: 'NOTE_REQUIRED'
        });
      }

      // ══ PHASE 7 / BW5 — DENY-CLOSE-NOTIFY IS ONE ACT, IN THE DECIDING FLOW ══
      //
      // Kevin's 7/28 direction item 3: "denial finalizes in the deciding UI — no extra hop." The three
      // outcomes above all move the request ONWARD; none of them ENDS it, so a determination that the whole
      // item is withheld had nowhere to land and the disposition was never written. This is that landing.
      //
      // NO NEW SCREEN. The vocabulary the deciding flow already uses gains a fourth value, and the
      // disposition write is wired into the send — deny + `Closed – Denied` + the determination notice, one
      // act, blocked-with-reason. The letter's CONTENT still belongs to Denial compose (Draft 3, unchanged
      // by Kevin); what could not exist before was the ENDING.
      //
      // close_approval IS HONOURED, BUT ONLY WHERE IT CAN STOP SOMETHING. A department configured
      // `approval_required` for `denial` routes instead of closing — ignoring that would let a city's own
      // policy be walked around. `direct` and `either` close directly, which is exactly today's behaviour
      // (nothing anywhere routes a close today), so no install changes by deploying this.
      if (outcome === 'denied') {
        var dApproval = await DISP.approvalModeFor(rid, 'denial');
        await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
        if (dApproval.mode === 'approval_required') {
          var dRouted = await DISP.requestApproval(rid, 'denial', Object.assign({ payload: { note: notes }, taskId: req.params.id }, actor));
          await run("UPDATE tasks SET status = 'awaiting_review', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
          return res.json(Object.assign({ ok: true, outcome: 'denied', approval: dApproval }, dRouted));
        }
        var denied = await DISP.close(rid, 'denial', Object.assign({
          payload: { note: notes },
          basisText: 'Denied on legal review: ' + notes
        }, actor));
        return res.json(Object.assign({ ok: true, outcome: 'denied', approval: dApproval }, denied));
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
      //
      // ══ BW5: THIS IS NOW THE LEGACY DOOR, AND IT KEEPS ITS EXACT PRE-BW5 GATE ══
      //
      // Draft 8 rev 2 puts the FULL gate on the popup — effort trail AND every duty-carrying description
      // answered AND a required closure note, three independent conditions that never feed each other. That
      // gate lives on `POST /tasks/:id/close` below, which is what the Record Search rail calls.
      //
      // This path is deliberately NOT tightened to match. It has two live semantics the popup deliberately
      // reverses — open descriptions are ANSWERED BY the closure here rather than blocking it, and no note
      // is demanded — and changing them would refuse closures that work today, from an endpoint whose
      // callers we do not control. What it DOES gain is the half that is a compliance rule rather than a
      // gate: the close now goes through `disposition.close`, so it writes the ending through the ONE close
      // act, SENDS THE CLOSURE NOTICE (rule 1: every close owes one — this path sent nothing before), and
      // derives the parent. Strictly additive; nothing that closed before stops closing.
      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      var legacyClose = await DISP.close(rid, 'no_records', Object.assign({
        skipGate: true, payload: { note: notes }
      }, actor));
      return res.json({ ok: true, outcome: 'no_records', effortEntries: eff.n,
                        intentsClosed: legacyClose.intentsClosed, notice: legacyClose.notice });
    }

    return res.status(400).json({ error: 'Unknown outcome' });
  } catch (e) {
    console.error('resolve failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================================
// PHASE 7 / BW5 — CLOSING FROM THE TASK (DRAFT_processing_ui_disposition_close.md rev 2, Frame A/A′).
//
// Kevin's 7/28 direction: the person doing the work ends the item from their OWN task UI, via a small
// confirm popup that states what will be written and sent. Two endings live on the Record Search rail —
// "No records found — close…" and "Not our records — refer & close…" — and both are one act.
//
// THE GATE IS READ AND ENFORCED BY THE SAME FUNCTION. `GET /close-gate` renders the popup's checklist,
// `POST /close` refuses on it. One evaluator, two readers (services/disposition.gateFor) — the rule the
// proceed gate and the Found gate already follow, because a screen that permits what the endpoint refuses
// is a screen that lies.
// ============================================================================================

// What the popup needs to draw itself: the gate rows AS THEY STAND, and which commit buttons exist.
router.get('/:id/close-gate', requireAuth, async function (req, res) {
  try {
    var t = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    var ending = String(req.query.ending || 'no_records');
    if (DISP.TASK_CLOSE_ENDINGS.indexOf(ending) < 0) {
      return res.status(400).json({ error: 'That ending is not finalized from a task rail.', code: 'UNKNOWN_ENDING' });
    }
    // The gate is evaluated against the payload the popup has SO FAR, so the note/custodian rows tick live
    // as the closer types. Passed as query params; absent means "not yet supplied", which reads as open.
    var payload = { note: req.query.note, custodianName: req.query.custodianName,
                    custodianContact: req.query.custodianContact, referralNote: req.query.referralNote };
    var gate = await DISP.gateFor(t.request_id, ending, payload);
    var approval = await DISP.approvalModeFor(t.request_id, ending);
    var pend = await DISP.pending(t.request_id);
    res.json({
      taskId: t.id, requestId: t.request_id, ending: ending, gate: gate, approval: approval,
      pendingApproval: pend ? { id: pend.id, ending: pend.ending, requestedByName: pend.requested_by_name,
                                requestedAt: pend.requested_at } : null,
      effortTrail: await DISP.effortTrail(t.request_id)
    });
  } catch (e) {
    console.error('close-gate failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// THE CLOSE ITSELF. `mode` picks the door the department's `close_approval` config left open:
//   submit — the closer closes it (allowed under `direct` and `either`)
//   route  — a lightweight approval task goes to the supervisor and the item shows "Close pending
//            approval" (allowed under `approval_required` and `either`)
// A door the config did not open is refused 403 with the resolved mode named, so a stale screen cannot
// close around a city's policy.
router.post('/:id/close', requireAuth, async function (req, res) {
  try {
    var t = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (!tr.isActionable(t.status)) {
      return res.status(409).json({ error: 'This task is ' + t.status + ' and can no longer close its item.',
                                    code: 'TASK_NOT_ACTIONABLE', status: t.status });
    }
    var b = req.body || {};
    var ending = String(b.ending || '');
    if (DISP.TASK_CLOSE_ENDINGS.indexOf(ending) < 0) {
      return res.status(400).json({
        error: 'That ending is not finalized from a task rail. A denial goes to Legal Review; delivery is written by the release event.',
        code: 'UNKNOWN_ENDING' });
    }
    var mode = String(b.mode || 'submit');
    var actor = { actorId: req.user && req.user.sub, actorName: (req.user && req.user.name) || 'Staff' };
    var payload = { note: b.note, custodianName: b.custodianName, custodianContact: b.custodianContact,
                    referralNote: b.referralNote };
    var approval = await DISP.approvalModeFor(t.request_id, ending);

    if (mode === 'route') {
      if (!approval.canRoute) {
        return res.status(403).json({ error: 'This department closes ' + ending + ' directly (close_approval = ' +
          approval.mode + '), so there is no approval to route to.', code: 'ROUTE_NOT_ALLOWED', approval: approval });
      }
      var routed = await DISP.requestApproval(t.request_id, ending, Object.assign({ payload: payload, taskId: t.id }, actor));
      // The originating task goes to awaiting_review, not done: the work is not finished until someone
      // approves, and a done task would drop the item out of its owner's list while it still needs them.
      await run("UPDATE tasks SET status = 'awaiting_review', updated_at = datetime('now') WHERE id = ?", [t.id]);
      return res.json(Object.assign({ mode: 'route', approval: approval }, routed));
    }

    if (!approval.canSubmit) {
      return res.status(403).json({ error: 'This department requires a supervisor’s approval to close ' + ending +
        ' (close_approval = ' + approval.mode + '). Route it for approval instead.', code: 'APPROVAL_REQUIRED', approval: approval });
    }
    var out = await DISP.close(t.request_id, ending, Object.assign({ payload: payload, taskId: t.id }, actor));
    await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [t.id]);
    return res.json(Object.assign({ mode: 'submit', approval: approval }, out));
  } catch (e) {
    if (e && e.status) {
      return res.status(e.status).json({ error: e.message, code: e.code, reasons: e.reasons, gate: e.gate });
    }
    console.error('close failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// The supervisor's side. The approval task carries the pending row; approving EXECUTES the close and it is
// recorded as the approver's act (rev 2). Refusing needs a note — the closer has to know what to do next.
router.get('/:id/close-approval', requireAuth, async function (req, res) {
  try {
    var row = await DISP.byApprovalTask(req.params.id);
    if (!row) return res.status(404).json({ error: 'This task is not a close approval.' });
    var gate = {}; try { gate = JSON.parse(row.gate_json || '{}'); } catch (e) {}
    var payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch (e) {}
    var def = DISP.ENDINGS[row.ending] || {};
    res.json({
      approvalId: row.id, requestId: row.request_id, ending: row.ending, label: def.label,
      evidence: def.evidence, status: row.status, gate: gate, payload: payload,
      requestedBy: row.requested_by, requestedByName: row.requested_by_name, requestedAt: row.requested_at,
      // The one conflict rule that applies here — self-approval. NOT two-eyes (see disposition.js).
      selfApproval: DISP.selfApproval(row, req.user && req.user.sub)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/close-approval/:decision', requireAuth, async function (req, res) {
  try {
    var row = await DISP.byApprovalTask(req.params.id);
    if (!row) return res.status(404).json({ error: 'This task is not a close approval.' });
    var actor = { actorId: req.user && req.user.sub, actorName: (req.user && req.user.name) || 'Staff',
                  note: (req.body && req.body.note) || '' };
    if (req.params.decision === 'approve') return res.json(await DISP.approve(row.id, actor));
    if (req.params.decision === 'reject') return res.json(await DISP.reject(row.id, actor));
    return res.status(400).json({ error: 'Decision must be approve or reject.' });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message, code: e.code, reasons: e.reasons });
    console.error('close-approval failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================================
// PHASE 7 / BW5 — RELEASE REVIEW (the pipeline's gate branch; SPEC §5 / Draft 9's task type).
//
// BW2 registered `release_review` and said outright it was "a routable type nothing spawns" until BW5.
// Here is the other half: the pipeline raises it instead of shipping when the city's pre-send knob is ON,
// and APPROVING IT FIRES THE RELEASE — the approver recorded on the event.
//
// TWO-EYES IS REAL HERE (unlike close approval). taskRouting.TWO_EYES_TYPES already excludes the person who
// completed the item's last flow task at assignment and in the pool; this route re-asks the same question
// rather than trusting that the assignment was made under the rule, because a task can be hand-assigned.
//
// The full power-mode surface is Draft 9 / BW8. These three endpoints are its substrate.
// ============================================================================================
router.get('/:id/release-review', requireAuth, async function (req, res) {
  try {
    var t = await get("SELECT * FROM tasks WHERE id = ? AND type = 'release_review'", [req.params.id]);
    if (!t) return res.status(404).json({ error: 'This task is not a release review.' });
    var AR = require('../services/autoRelease');
    var blocked = await tr.assignmentBlocked(t, req.user && req.user.sub);
    res.json({
      taskId: t.id, requestId: t.request_id, status: t.status,
      twoEyes: blocked,
      evaluation: await AR.evaluate(t.request_id)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/release-review/:decision', requireAuth, async function (req, res) {
  try {
    var t = await get("SELECT * FROM tasks WHERE id = ? AND type = 'release_review'", [req.params.id]);
    if (!t) return res.status(404).json({ error: 'This task is not a release review.' });
    if (!tr.isActionable(t.status)) {
      return res.status(409).json({ error: 'This release review is ' + t.status + ' and can no longer be decided.',
                                    code: 'TASK_NOT_ACTIONABLE' });
    }
    var AR = require('../services/autoRelease');
    var actor = { actorId: req.user && req.user.sub, actorName: (req.user && req.user.name) || 'Staff',
                  note: (req.body && req.body.note) || '' };

    if (req.params.decision === 'return') return res.json(await AR.returnReview(t.id, actor));

    if (req.params.decision === 'approve') {
      var blocked = await tr.assignmentBlocked(t, actor.actorId);
      if (blocked.blocked) return res.status(403).json({ error: blocked.reason, code: blocked.code });
      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [t.id]);
      // `force`: the knob asks whether releases fire WITH NOBODY TOUCHING THEM. Somebody just touched this
      // one — a named person approved the package — so the release proceeds on their act, not on the
      // automation setting. The conditions are still re-evaluated: an approval is not a bypass of the
      // funds gate or the hold.
      var out = await AR.run(t.request_id, { force: true, actorId: actor.actorId,
                                             actorName: actor.actorName, approverName: actor.actorName });
      if (!out.acted || out.reason !== 'released') {
        // Put the review back: approving something that could not ship must not silently consume the task.
        await run("UPDATE tasks SET status = 'open', updated_at = datetime('now') WHERE id = ?", [t.id]);
        return res.status(409).json({ error: 'The release could not fire: ' + (out.text || out.reason) + '.',
                                      code: 'RELEASE_BLOCKED', result: out });
      }
      return res.json(Object.assign({ approvedBy: actor.actorName }, out));
    }
    return res.status(400).json({ error: 'Decision must be approve or return.' });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error('release-review failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
