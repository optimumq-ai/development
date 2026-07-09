const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { all, get, run } = require('../db');
const { createUser, getFunctionRoles, hashPassword } = require('../services/auth');
const { ROUTABLE_TASK_TYPES } = require('../services/taskRouting');
const { v4: uuidv4 } = require('uuid');

// A user's per-person routable task-type subset (v3 role model).
async function getTaskTypes(userId) {
  var rows = await all('SELECT task_type FROM user_task_types WHERE user_id = ? ORDER BY task_type', [userId]);
  return rows.map(function(r) { return r.task_type; });
}

router.get('/', requireAuth, async function(req, res) {
  var staff = await all('SELECT u.*, d.name as department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.display_name');
  var staffOut = [];
  for (var s of staff) {
    staffOut.push(Object.assign({}, s, { functionRoles: await getFunctionRoles(s.id), taskTypes: await getTaskTypes(s.id), password_hash: undefined }));
  }
  res.json({ staff: staffOut });
});

router.post('/', requireAuth, requireRole('SYSTEM_ADMIN','DIRECTOR','SUPERVISOR'), async function(req, res) {
  var b = req.body;
  if (!b.displayName || !b.email || !b.tempPassword) return res.status(400).json({ error: 'Name, email and password required' });
  var existing = await get('SELECT id FROM users WHERE email = ?', [b.email]);
  if (existing) return res.status(400).json({ error: 'A user with this email already exists' });
  try {
    var userId = uuidv4();
    var hash = hashPassword(b.tempPassword);
    await run('INSERT INTO users (id, email, display_name, title, department_id, password_hash, temp_password) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [userId, b.email, b.displayName, b.title || '', b.departmentId || null, hash]);
    if (b.functionRoles && b.functionRoles.length > 0) {
      for (var roleName of b.functionRoles) {
        var role = await get('SELECT id FROM function_roles WHERE name = ?', [roleName]);
        if (role) await run('INSERT OR IGNORE INTO user_function_roles (user_id, function_role_id) VALUES (?, ?)', [userId, role.id]);
      }
    }
    var allPerms = await all('SELECT id FROM permission_roles');
    for (var p of allPerms) { await run('INSERT OR IGNORE INTO user_permission_roles (user_id, permission_role_id) VALUES (?, ?)', [userId, p.id]); }
    res.status(201).json({ success: true, userId: userId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/status', requireAuth, requireRole('SYSTEM_ADMIN','DIRECTOR'), async function(req, res) {
  var status = req.body.status;
  if (status !== 'active' && status !== 'inactive') return res.status(400).json({ error: 'Invalid status' });
  await run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
});

router.patch('/:id/team', requireAuth, requireRole('SYSTEM_ADMIN','DIRECTOR','SUPERVISOR'), async function(req, res) {
  await run('UPDATE users SET department_id = ? WHERE id = ?', [req.body.departmentId || null, req.params.id]);
  res.json({ success: true });
});

router.patch('/:id/specialization', requireAuth, requireRole('SYSTEM_ADMIN','DIRECTOR','SUPERVISOR'), async function(req, res) {
  await run('UPDATE users SET routing_specialization = ? WHERE id = ?', [req.body.routingSpecialization || null, req.params.id]);
  try { require('../services/taskRouting').embedUserSpec(req.params.id, req.body.routingSpecialization || '').catch(function(e){ console.error('[spec embed]', e.message); }); } catch (e) {}
  var row = await get('SELECT id, routing_specialization FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true, routing_specialization: row ? row.routing_specialization : null });
});

// One staff member with roles + task-type subset (for the edit screen).
router.get('/:id', requireAuth, async function(req, res) {
  var u = await get('SELECT u.*, d.name as department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'Staff member not found' });
  u.password_hash = undefined;
  res.json({ user: Object.assign({}, u, { functionRoles: await getFunctionRoles(u.id), taskTypes: await getTaskTypes(u.id) }) });
});

// Edit profile fields (name, title, email, team). Only the provided fields are changed.
router.patch('/:id', requireAuth, requireRole('SYSTEM_ADMIN','DIRECTOR','SUPERVISOR'), async function(req, res) {
  var b = req.body || {};
  var fields = [], params = [];
  if (typeof b.displayName === 'string' && b.displayName.trim()) { fields.push('display_name = ?'); params.push(b.displayName.trim()); }
  if (typeof b.title === 'string') { fields.push('title = ?'); params.push(b.title); }
  if (typeof b.departmentId !== 'undefined') { fields.push('department_id = ?'); params.push(b.departmentId || null); }
  if (typeof b.email === 'string' && b.email.trim()) {
    var other = await get('SELECT id FROM users WHERE email = ? AND id != ?', [b.email.trim(), req.params.id]);
    if (other) return res.status(400).json({ error: 'A user with this email already exists' });
    fields.push('email = ?'); params.push(b.email.trim());
  }
  if (!fields.length) return res.json({ success: true });
  params.push(req.params.id);
  await run('UPDATE users SET ' + fields.join(', ') + ' WHERE id = ?', params);
  res.json({ success: true });
});

// Replace a user's per-person task-type subset (the routable task types they can be assigned).
router.patch('/:id/task-types', requireAuth, requireRole('SYSTEM_ADMIN','DIRECTOR','SUPERVISOR'), async function(req, res) {
  var incoming = Array.isArray(req.body.taskTypes) ? req.body.taskTypes : [];
  var types = incoming.filter(function(t) { return ROUTABLE_TASK_TYPES.indexOf(t) !== -1; });
  await run('DELETE FROM user_task_types WHERE user_id = ?', [req.params.id]);
  for (var t of types) { await run('INSERT OR IGNORE INTO user_task_types (user_id, task_type) VALUES (?, ?)', [req.params.id, t]); }
  res.json({ success: true, taskTypes: types });
});

module.exports = router;
