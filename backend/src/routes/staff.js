const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { all, get, run } = require('../db');
const { createUser, getFunctionRoles, hashPassword } = require('../services/auth');
const { v4: uuidv4 } = require('uuid');

router.get('/', requireAuth, function(req, res) {
  var staff = all('SELECT u.*, d.name as department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.display_name');
  staff = staff.map(function(s) {
    return Object.assign({}, s, { functionRoles: getFunctionRoles(s.id), password_hash: undefined });
  });
  res.json({ staff: staff });
});

router.post('/', requireAuth, requireRole('SYSTEM_ADMIN','DIRECTOR','SUPERVISOR'), async function(req, res) {
  var b = req.body;
  if (!b.displayName || !b.email || !b.tempPassword) return res.status(400).json({ error: 'Name, email and password required' });
  var existing = get('SELECT id FROM users WHERE email = ?', [b.email]);
  if (existing) return res.status(400).json({ error: 'A user with this email already exists' });
  try {
    var userId = uuidv4();
    var hash = hashPassword(b.tempPassword);
    run('INSERT INTO users (id, email, display_name, title, department_id, password_hash, temp_password) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [userId, b.email, b.displayName, b.title || '', b.departmentId || null, hash]);
    if (b.functionRoles && b.functionRoles.length > 0) {
      b.functionRoles.forEach(function(roleName) {
        var role = get('SELECT id FROM function_roles WHERE name = ?', [roleName]);
        if (role) run('INSERT OR IGNORE INTO user_function_roles (user_id, function_role_id) VALUES (?, ?)', [userId, role.id]);
      });
    }
    var allPerms = all('SELECT id FROM permission_roles');
    allPerms.forEach(function(p) { run('INSERT OR IGNORE INTO user_permission_roles (user_id, permission_role_id) VALUES (?, ?)', [userId, p.id]); });
    res.status(201).json({ success: true, userId: userId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/status', requireAuth, requireRole('SYSTEM_ADMIN','DIRECTOR'), function(req, res) {
  var status = req.body.status;
  if (status !== 'active' && status !== 'inactive') return res.status(400).json({ error: 'Invalid status' });
  run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
});

module.exports = router;
