const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { all, get, run } = require('../db');
const { createUser, getFunctionRoles, hashPassword } = require('../services/auth');
const { v4: uuidv4 } = require('uuid');

router.get('/', requireAuth, async function(req, res) {
  var staff = await all('SELECT u.*, d.name as department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.display_name');
  var staffOut = [];
  for (var s of staff) {
    staffOut.push(Object.assign({}, s, { functionRoles: await getFunctionRoles(s.id), password_hash: undefined }));
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
  var row = await get('SELECT id, routing_specialization FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true, routing_specialization: row ? row.routing_specialization : null });
});

module.exports = router;
