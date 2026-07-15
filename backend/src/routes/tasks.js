const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const tr = require('../services/taskRouting');
const scope = require('../services/requestScope');
const SI = require('../services/searchIntents');

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
  var rows = await all(withReq(
    "WHERE t.status = 'open' AND t.assigned_to IS NULL " +
    "AND (t.team_id IS NULL OR t.team_id = (SELECT department_id FROM users WHERE id = ?)) " +
    "AND (t.role_required IS NULL OR t.role_required IN (" +
    "  SELECT pr.name FROM user_permission_roles upr JOIN permission_roles pr ON pr.id = upr.permission_role_id WHERE upr.user_id = ?)) " +
    "ORDER BY t.created_at"), [req.user.sub, req.user.sub]);
  res.json({ tasks: rows });
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
  var t = await get('SELECT assigned_to, work_seconds, work_finalized FROM tasks WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  var roles = req.user.roles || [];
  var elevated = roles.indexOf('SYSTEM_ADMIN') !== -1 || roles.indexOf('DIRECTOR') !== -1 || roles.indexOf('SUPERVISOR') !== -1;
  if (t.assigned_to && t.assigned_to !== req.user.sub && !elevated) return res.status(403).json({ error: 'Only the assignee can log time on this task.' });
  var measured = Math.max(0, Math.floor(Number(req.body && req.body.seconds != null ? req.body.seconds : t.work_seconds) || 0));
  var b = req.body || {};
  // SKIP (user-discretion mode, Slice E): the assignee chose not to log billable time. Keep the raw measurement
  // for defensibility, but leave work_seconds NULL so no billable actual flows to reconciliation. Finalized so the
  // heartbeat stops and the modal never re-fires.
  if (b.skipped) {
    await run("UPDATE tasks SET work_measured_seconds = ?, work_seconds = NULL, work_adjust_reason = ?, work_finalized = 1, updated_at = datetime('now') WHERE id = ?",
      [measured, 'skipped (user discretion)', req.params.id]);
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
  res.json({ task: await tr.getTask(req.params.id) });
});

// Mark a task complete.
router.post('/:id/complete', requireAuth, async function (req, res) {
  await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
  res.json({ task: await tr.getTask(req.params.id) });
});

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
    if (t.type !== 'record_search') return res.status(400).json({ error: 'Not a record-search task' });

    var outcome = String((req.body && req.body.outcome) || '');
    var notes = String((req.body && req.body.notes) || '').trim();
    var rid = t.request_id;
    var actor = { actorId: req.user && req.user.sub, actorName: (req.user && req.user.name) || 'Staff' };

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
      await tr.applyStageTransition(rid, 'exemption_review', Object.assign({
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
