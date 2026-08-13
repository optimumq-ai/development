// LEGAL HOURS IN THE ESTIMATE — slice 1: the ask + the answer (DESIGN_legal_hours_estimate.md).
//
// The estimator (or the MRR hub manager) ASKS a named legal_review token holder how many hours of
// legal work a request can be expected to need; legal ANSWERS with hours + a required note. The
// exchange is one structured row in legal_estimate_inputs — never prose — and the estimator stays
// the single author of the estimate snapshot: the answer is an input they read (Accept-pre-fill
// arrives with the engine's Legal line in slice 2).
//
// An open ask NEVER blocks the estimate notice (Kevin, 2026-08-13: soft block — the statutory clock
// keeps pressure on; a late answer rides the normal revision/renotify machinery). The warning is
// rendered by the panel from GET /request/:requestId; no send gate exists here or in feeEstimates.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');
const tr = require('../services/taskRouting');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
async function history(requestId, req, action, notes) {
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), requestId, req.user.id, req.user.name || req.user.display_name || 'Staff', action, notes, nowStr()]);
}
function rowShape(r) {
  if (!r) return null;
  return { id: r.id, request_id: r.request_id, task_id: r.task_id,
    ask_note: r.ask_note, asked_by_name: r.asked_by_name, asked_at: r.asked_at,
    hours: r.hours != null ? Number(r.hours) : null, note: r.note,
    entered_by_name: r.entered_by_name, entered_at: r.entered_at, superseded: !!r.superseded };
}

// POST /request/:requestId/ask { assignee_id, note } -> hand-assign a legal_estimate task.
router.post('/request/:requestId/ask', requireAuth, async function (req, res) {
  try {
    var request = await get('SELECT id, request_number FROM requests WHERE id = ?', [req.params.requestId]);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    var b = req.body || {};
    var note = String(b.note || '').trim();
    if (!note) {
      return res.status(422).json({ error: 'Say what legal should look at. The ask is a question, not a ping.', code: 'NOTE_REQUIRED' });
    }
    if (!b.assignee_id) {
      return res.status(422).json({ error: 'A legal-hours ask is hand-assigned: name the person.', code: 'ASSIGNEE_REQUIRED' });
    }
    var u = await get('SELECT id, display_name FROM users WHERE id = ?', [b.assignee_id]);
    if (!u) return res.status(404).json({ error: 'No such person.' });
    // The eligibility bar: the answer is a legal judgment, so only the office's legal staff
    // (the existing legal_review token — no new grant to administer) can be asked.
    var holds = await get("SELECT 1 AS x FROM user_task_types WHERE user_id = ? AND task_type = 'legal_review'", [u.id]);
    if (!holds) {
      return res.status(422).json({ error: u.display_name + ' does not hold the Legal Review task type. Ask someone on the legal staff.', code: 'NOT_LEGAL' });
    }

    // A re-ask supersedes: cancel the previous open ask's task rather than leaving two questions live.
    var prior = await get(
      "SELECT * FROM legal_estimate_inputs WHERE request_id = ? AND superseded = 0 AND hours IS NULL ORDER BY asked_at DESC LIMIT 1",
      [request.id]);
    if (prior && prior.task_id) {
      await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('done','cancelled')", [prior.task_id]);
      await run('UPDATE legal_estimate_inputs SET superseded = 1 WHERE id = ?', [prior.id]);
    }

    var t = await tr.createTask({
      requestId: request.id, type: 'legal_estimate',
      title: 'Estimate legal hours — ' + request.request_number,
      teamId: null, createdBy: req.user.id
    });
    await tr.assign(t.id, u.id, 'manual', null);

    var id = uuidv4();
    await run('INSERT INTO legal_estimate_inputs (id, request_id, task_id, ask_note, asked_by, asked_by_name, asked_at) VALUES (?,?,?,?,?,?,?)',
      [id, request.id, t.id, note, req.user.id, req.user.name || req.user.display_name || 'Staff', nowStr()]);
    await history(request.id, req, 'LEGAL_HOURS_REQUESTED',
      'Legal hours asked of ' + u.display_name + ': "' + note + '". The estimate can still be sent; a later answer rides the normal revision rules.');
    res.json({ ask: rowShape(await get('SELECT * FROM legal_estimate_inputs WHERE id = ?', [id])), task_id: t.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /request/:requestId -> what the estimate panel renders: the open ask and/or the latest answer.
router.get('/request/:requestId', requireAuth, async function (req, res) {
  try {
    var rows = await all('SELECT * FROM legal_estimate_inputs WHERE request_id = ? AND superseded = 0 ORDER BY asked_at DESC', [req.params.requestId]);
    var open = rows.find(function (r) { return r.hours == null; }) || null;
    var answer = rows.find(function (r) { return r.hours != null; }) || null;
    // The open ask's task may have been cancelled out-of-band; an ask whose task is dead is not pending.
    var assigneeName = null;
    if (open && open.task_id) {
      var t = await get('SELECT t.status, u.display_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?', [open.task_id]);
      if (!t || !tr.isActionable(t.status)) open = null;
      else assigneeName = t.display_name || null;
    }
    var openOut = rowShape(open);
    if (openOut) openOut.assignee_name = assigneeName;
    res.json({ open: openOut, answer: rowShape(answer) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /task/:taskId -> the thin screen's ask row (task context itself comes from GET /tasks/:id,
// which resolves the PARENT's request number/description — do not rebuild that here).
router.get('/task/:taskId', requireAuth, async function (req, res) {
  try {
    var row = await get('SELECT * FROM legal_estimate_inputs WHERE task_id = ?', [req.params.taskId]);
    if (!row) return res.status(404).json({ error: 'No legal-hours ask is attached to this task.' });
    res.json({ ask: rowShape(row) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /task/:taskId/complete { hours, note } -> legal's structured answer; closes the task.
router.post('/task/:taskId/complete', requireAuth, async function (req, res) {
  try {
    var t = await get('SELECT * FROM tasks WHERE id = ?', [req.params.taskId]);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (t.type !== 'legal_estimate') return res.status(400).json({ error: 'This task is not a legal-hours ask.' });
    // The resolve-route lesson (brief §3.3): a finished task must not be answerable again.
    if (!tr.isActionable(t.status)) {
      return res.status(409).json({ error: 'This task is ' + t.status + ' and can no longer be answered.', code: 'TASK_NOT_ACTIONABLE', status: t.status });
    }
    if (t.assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'This ask belongs to its assignee.', code: 'NOT_YOURS' });
    }
    var b = req.body || {};
    var hours = Number(b.hours);
    if (!isFinite(hours) || hours <= 0) {
      return res.status(422).json({ error: 'Enter the expected legal hours (more than zero).', code: 'HOURS_REQUIRED' });
    }
    var note = String(b.note || '').trim();
    if (!note) {
      return res.status(422).json({ error: 'A note is required. Say what the hours cover — this is a judgment the city may have to defend.', code: 'NOTE_REQUIRED' });
    }
    var row = await get('SELECT * FROM legal_estimate_inputs WHERE task_id = ?', [t.id]);
    if (!row) return res.status(404).json({ error: 'No legal-hours ask is attached to this task.' });

    // The new answer supersedes every other live row for the request (one current answer at a time).
    await run('UPDATE legal_estimate_inputs SET superseded = 1 WHERE request_id = ? AND id != ? AND superseded = 0', [row.request_id, row.id]);
    await run('UPDATE legal_estimate_inputs SET hours = ?, note = ?, entered_by = ?, entered_by_name = ?, entered_at = ? WHERE id = ?',
      [hours, note, req.user.id, req.user.name || req.user.display_name || 'Legal', nowStr(), row.id]);
    await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [t.id]);
    await history(row.request_id, req, 'LEGAL_HOURS_ESTIMATED',
      'Legal estimates ' + hours + ' hour' + (hours === 1 ? '' : 's') + ': "' + note + '". Recorded as an estimate input — it advances no stage.');
    res.json({ input: rowShape(await get('SELECT * FROM legal_estimate_inputs WHERE id = ?', [row.id])) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
