const express = require('express');
const router = express.Router();
// LIST MODEL (approval, 2026-08-31): every mutation reports a change so an approved list drops to yellow and the
// lane owners hear once. After the response — best effort.
router.use(function (req, res, next) {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].indexOf(req.method) !== -1) {
    res.on('finish', function () { if (res.statusCode < 300) { try { var HUBr = require('../services/setupHub'); ['staff'].forEach(function (k) { HUBr.afterChange(k, req.user && (req.user.name || req.user.email)).catch(function () {}); }); } catch (e) {} } });
  }
  next();
});
const { requireAuth, requireAuthority, requirePermission, hasAuthority } = require('../middleware/auth');
// v3 (S2, SPEC_user_type_model §5 "Staff records split", §8 rows 3–4): creating/deactivating accounts and assigning
// USER TYPES is the manage_users authority (sysadmin, director); editing a person's profile / team / specialization /
// task subset is the operations_config group, with the subset additionally scoped by assign_task_subsets_global
// or assign_task_subsets_team (own team).
const MANAGE_USERS = requireAuthority('manage_users');
const OPS = requirePermission('operations_config');
const { all, get, run } = require('../db');
const { createUser, hashPassword } = require('../services/auth');
const { ROUTABLE_TASK_TYPES } = require('../services/taskRouting');
const userTypes = require('../services/userTypes');
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
    staffOut.push(Object.assign({}, s, { userTypes: await userTypes.typesOf(s.id), taskTypes: await getTaskTypes(s.id), taskMenu: await userTypes.taskMenuFor(s.id), password_hash: undefined, mfa_secret: undefined }));
  }
  res.json({ staff: staffOut });
});

router.post('/', requireAuth, MANAGE_USERS, async function(req, res) {
  var b = req.body;
  if (!b.displayName || !b.email || !b.tempPassword) return res.status(400).json({ error: 'Name, email and password required' });
  var existing = await get('SELECT id FROM users WHERE email = ?', [b.email]);
  if (existing) return res.status(400).json({ error: 'A user with this email already exists' });
  try {
    var userId = uuidv4();
    var hash = hashPassword(b.tempPassword);
    await run('INSERT INTO users (id, email, display_name, title, department_id, password_hash, temp_password) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [userId, b.email, b.displayName, b.title || '', b.departmentId || null, hash]);
    // v3 user-type model (S1): a new account holds NO user types until a manage_users holder assigns them
    // (SPEC_user_type_model §9). The legacy grant-every-permission-role loop that lived here is gone —
    // legacy roles/perms are now derived from user types, and `functionRoles` in the body is ignored.
    res.status(201).json({ success: true, userId: userId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/status', requireAuth, MANAGE_USERS, async function(req, res) {
  var status = req.body.status;
  if (status !== 'active' && status !== 'inactive') return res.status(400).json({ error: 'Invalid status' });
  await run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
  await userTypes.bumpAuthVersion(req.params.id);   // a deactivated account's live tokens die within the cache window
  res.json({ success: true });
});

router.patch('/:id/team', requireAuth, OPS, async function(req, res) {
  await run('UPDATE users SET department_id = ? WHERE id = ?', [req.body.departmentId || null, req.params.id]);
  res.json({ success: true });
});

router.patch('/:id/specialization', requireAuth, OPS, async function(req, res) {
  await run('UPDATE users SET routing_specialization = ? WHERE id = ?', [req.body.routingSpecialization || null, req.params.id]);
  try { require('../services/taskRouting').embedUserSpec(req.params.id, req.body.routingSpecialization || '').catch(function(e){ console.error('[spec embed]', e.message); }); } catch (e) {}
  var row = await get('SELECT id, routing_specialization FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true, routing_specialization: row ? row.routing_specialization : null });
});

// One staff member with roles + task-type subset (for the edit screen).
router.get('/:id', requireAuth, async function(req, res) {
  var u = await get('SELECT u.*, d.name as department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'Staff member not found' });
  u.password_hash = undefined; u.mfa_secret = undefined;
  var menuU = await userTypes.taskMenuFor(u.id);
  res.json({ user: Object.assign({}, u, { userTypes: await userTypes.typesOf(u.id), taskTypes: await getTaskTypes(u.id), taskMenu: menuU, memberTeams: await userTypes.teamsOf(u.id) }) });
});

// Edit profile fields (name, title, email, team). Only the provided fields are changed.
router.patch('/:id', requireAuth, OPS, async function(req, res) {
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
router.patch('/:id/task-types', requireAuth, OPS, async function(req, res) {
  // Subset scope: global authority, or team authority for a person on the caller's own team.
  if (!hasAuthority(req.user, 'assign_task_subsets_global')) {
    // S2b (§6.1): "own team" = a team the caller holds team_manager against AND the target is a member of.
    var myMgrTeams = (req.user.userTypes || []).filter(function (t) { return t.key === 'team_manager' && t.teamId; }).map(function (t) { return t.teamId; });
    var targetTeams = await userTypes.teamsOf(req.params.id);
    var sameTeam = targetTeams.some(function (t) { return myMgrTeams.indexOf(t) !== -1; });
    if (!(hasAuthority(req.user, 'assign_task_subsets_team') && sameTeam)) {
      return res.status(403).json({ error: 'Setting a task subset needs assign_task_subsets_global, or assign_task_subsets_team for someone on your own team.', code: 'AUTHORITY_REQUIRED' });
    }
  }
  var incoming = Array.isArray(req.body.taskTypes) ? req.body.taskTypes : [];
  var types = incoming.filter(function(t) { return ROUTABLE_TASK_TYPES.indexOf(t) !== -1; });
  // §6 picker constraint (S3): only task types inside the union of the person's type menus may be granted.
  // No types held => empty menu => nothing grantable; oro_director => any (menu null).
  var menu = await userTypes.taskMenuFor(req.params.id);
  if (menu !== null) {
    var outside = types.filter(function (t) { return menu.indexOf(t) === -1; });
    if (outside.length) {
      return res.status(400).json({ error: 'Not covered by this person\'s user types: ' + outside.join(', ') + '. Assign a user type whose task menu includes it first.', code: 'OUTSIDE_TASK_MENU', outside: outside, menu: menu });
    }
  }
  await run('DELETE FROM user_task_types WHERE user_id = ?', [req.params.id]);
  for (var t of types) { await run('INSERT OR IGNORE INTO user_task_types (user_id, task_type) VALUES (?, ?)', [req.params.id, t]); }
  await userTypes.bumpAuthVersion(req.params.id);
  res.json({ success: true, taskTypes: types });
});

// Replace a user's USER TYPES (SPEC_user_type_model §10.1 — the picker's write; UI lands in S3).
// Body: { userTypes: [{ key, teamId }] }. Team-scoped types need a teamId (a departments row, kind='team');
// office types ignore it. Every change bumps auth_version, so the person's live sessions re-mint.
router.patch('/:id/user-types', requireAuth, MANAGE_USERS, async function(req, res) {
  var target = await get('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Staff member not found' });
  var incoming = Array.isArray(req.body.userTypes) ? req.body.userTypes : [];
  var wanted = [];
  for (var i = 0; i < incoming.length; i++) {
    var t = incoming[i] || {};
    var scope = userTypes.scopeOf(t.key);
    if (!scope) return res.status(400).json({ error: 'Unknown user type: ' + t.key });
    var teamId = scope === 'team' ? (t.teamId || null) : null;
    if (scope === 'team') {
      if (!teamId) return res.status(400).json({ error: userTypes.CATALOG.filter(function (c) { return c.key === t.key; })[0].display_name + ' is held against a team — teamId is required.' });
      var team = await get("SELECT id FROM departments WHERE id = ? AND kind = 'team' AND active = 1", [teamId]);
      if (!team) return res.status(400).json({ error: 'Unknown team: ' + teamId });
    }
    wanted.push({ key: t.key, teamId: teamId });
  }
  var current = await userTypes.typesOf(req.params.id);
  var same = function (a, b) { return a.key === b.key && (a.teamId || null) === (b.teamId || null); };
  for (var c of current) { if (!wanted.some(function (w) { return same(w, c); })) await userTypes.revoke(req.params.id, c.key, c.teamId); }
  for (var w of wanted) { if (!current.some(function (c) { return same(w, c); })) await userTypes.grant(req.params.id, w.key, w.teamId, req.user.sub); }
  res.json({ success: true, userTypes: await userTypes.typesOf(req.params.id) });
});

module.exports = router;
