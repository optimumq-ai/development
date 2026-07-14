const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const tr = require('../services/taskRouting');
const scope = require('../services/requestScope');

function withReq(sql) {
  // A task hangs off the WORK row, but request_number is a PARENT field — the number the citizen quotes.
  // Resolved through the parent (today that IS the row itself, so this is a no-op). See requestScope.js.
  return "SELECT t.*, " + scope.numberExpr('r') + " AS request_number, r.description AS request_description, d.name AS team_name " +
    "FROM tasks t LEFT JOIN requests r ON r.id = t.request_id" + scope.numberJoin('r') + " LEFT JOIN departments d ON d.id = t.team_id " + sql;
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

// Tasks assigned to the current user.
router.get('/mine', requireAuth, async function (req, res) {
  var rows = await all(withReq("WHERE t.assigned_to = ? AND t.status IN ('assigned','in_progress') ORDER BY t.updated_at DESC"), [req.user.sub]);
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
      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      await run("UPDATE requests SET closure_reason = 'no_records' WHERE id = ?", [rid]);
      await tr.applyStageTransition(rid, 'closed', Object.assign({
        action: 'CLOSED_NO_RECORDS',
        notes: 'Closed — no responsive records. Diligent search evidenced by ' + eff.n + ' logged action(s).' + (notes ? ' ' + notes : '')
      }, actor));
      return res.json({ ok: true, outcome: 'no_records', effortEntries: eff.n });
    }

    return res.status(400).json({ error: 'Unknown outcome' });
  } catch (e) {
    console.error('resolve failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
