const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const tr = require('../services/taskRouting');

function withReq(sql) {
  return "SELECT t.*, r.request_number, r.description AS request_description, d.name AS team_name " +
    "FROM tasks t LEFT JOIN requests r ON r.id = t.request_id LEFT JOIN departments d ON d.id = t.team_id " + sql;
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

module.exports = router;
