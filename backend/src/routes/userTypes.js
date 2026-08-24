'use strict';
// USER TYPES — the catalog as the UI sees it (SPEC_user_type_model §10.2, S3).
//   GET  /api/user-types          every type with its task menu, authorities, permission groups, display name
//   PATCH /api/user-types/:key    { displayName } — the one editable thing in v1 (§3: "model terms, not job
//                                 titles"; a city renames, never re-wires). manage_users authority.
// The key set, menus, authorities and groups are the spec's tables; editing THOSE is out of v1.
const express = require('express');
const router = express.Router();
const { requireAuth, requireAuthority } = require('../middleware/auth');
const { all, get, run } = require('../db');
const UT = require('../services/userTypes');

router.get('/', requireAuth, async function (req, res) {
  var types = await all('SELECT id, key, display_name, scope, sort_order, active FROM user_types ORDER BY sort_order');
  var menus = await all('SELECT user_type_id, task_type FROM user_type_task_menu');
  var auths = await all('SELECT user_type_id, authority_key FROM user_type_authority');
  var perms = await all('SELECT user_type_id, permission_group FROM user_type_permission');
  var by = function (rows, col) { var m = {}; rows.forEach(function (r) { (m[r.user_type_id] = m[r.user_type_id] || []).push(r[col]); }); return m; };
  var M = by(menus, 'task_type'), A = by(auths, 'authority_key'), P = by(perms, 'permission_group');
  res.json({
    userTypes: types.map(function (t) {
      return { key: t.key, displayName: t.display_name, scope: t.scope, active: t.active === 1, sortOrder: t.sort_order,
        taskMenu: (M[t.id] || []).slice().sort(), authorities: (A[t.id] || []).slice().sort(), permissionGroups: (P[t.id] || []).slice().sort(),
        legalRulesOwner: t.key === UT.LEGAL_RULES_OWNER };
    }),
    authorityKeys: UT.AUTHORITY_KEYS,
    permissionGroups: UT.PERMISSION_GROUPS,
  });
});

router.patch('/:key', requireAuth, requireAuthority('manage_users'), async function (req, res) {
  var t = await get('SELECT id, key FROM user_types WHERE key = ?', [req.params.key]);
  if (!t) return res.status(404).json({ error: 'Unknown user type: ' + req.params.key });
  var name = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : '';
  if (!name || name.length > 80) return res.status(400).json({ error: 'A display name of 1–80 characters is required.' });
  await run('UPDATE user_types SET display_name = ? WHERE id = ?', [name, t.id]);
  res.json({ success: true, key: t.key, displayName: name });
});

module.exports = router;
