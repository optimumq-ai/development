'use strict';
// THE USER-TYPE MODEL (v3) — SPEC_user_type_model.md. One catalog: a person holds user types (office-wide,
// or against one fulfillment team); everything else — task menu, authority, permission groups, and during
// the compatibility period the legacy `roles` / `perms` claims — is DERIVED from those types.
//
// The catalog lives in TABLES (user_types, user_type_task_menu, user_type_authority, user_type_permission),
// seeded from schema.postgres.sql; the constants below are the spec's tables in code so the harness can
// assert the seed matches the spec and so the legacy shim (§9.1, deleted in S5) has something to map from.
const { all, get, run } = require('../db');

// §3 — the eleven types. `scope: 'team'` types are held against a departments row with kind='team'.
const CATALOG = [
  { key: 'city_management',    display_name: 'City Management',              scope: 'office', sort_order: 1 },
  { key: 'oro_sysadmin',       display_name: 'ORO System Administrator',     scope: 'office', sort_order: 2 },
  { key: 'oro_director',       display_name: 'ORO Director / Manager',       scope: 'office', sort_order: 3 },
  { key: 'oro_supervisor',     display_name: 'ORO Supervisor',               scope: 'office', sort_order: 4 },
  { key: 'oro_senior_legal',   display_name: 'ORO Senior Legal',             scope: 'office', sort_order: 5 },
  { key: 'oro_legal_associate',display_name: 'ORO Legal Associate',          scope: 'office', sort_order: 6 },
  { key: 'oro_associate',      display_name: 'ORO Associate',                scope: 'office', sort_order: 7 },
  { key: 'oro_finance',        display_name: 'ORO Finance',                  scope: 'office', sort_order: 8 },
  { key: 'team_manager',       display_name: '[Team] Fulfillment Manager',   scope: 'team',   sort_order: 9 },
  { key: 'team_supervisor',    display_name: '[Team] Fulfillment Supervisor',scope: 'team',   sort_order: 10 },
  { key: 'team_staff',         display_name: '[Team] Fulfillment Staff',     scope: 'team',   sort_order: 11 },
];
const TYPE_KEYS = CATALOG.map(function (t) { return t.key; });

// §4 — authority keys per type ("what may I do to work I don't own").
const AUTHORITY = {
  city_management:     [],
  oro_sysadmin:        ['assign_task_subsets_global', 'manage_users', 'system', 'go_live'],
  oro_director:        ['act_any_request', 'reassign_any', 'override_stage', 'escalate', 'financial_approval', 'assign_task_subsets_global', 'manage_users', 'go_live'],
  oro_supervisor:      ['act_any_request', 'reassign_any', 'escalate'],
  oro_senior_legal:    ['legal_decision'],
  oro_legal_associate: [],
  oro_associate:       ['act_any_request'],
  oro_finance:         ['financial_approval'],
  team_manager:        ['reassign_team', 'escalate', 'assign_task_subsets_team'],
  team_supervisor:     ['reassign_team'],
  team_staff:          [],
};
const AUTHORITY_KEYS = ['act_any_request', 'reassign_any', 'reassign_team', 'override_stage', 'escalate', 'legal_decision',
  'financial_approval', 'assign_task_subsets_global', 'assign_task_subsets_team', 'manage_users', 'system', 'go_live'];

// §5 — permission groups (configuration rights; the setup hub's lanes).
const OPERATIONS = ['operations_config', 'fee_configuration'];
const PERMISSION = {
  city_management:     ['reporting'],
  oro_sysadmin:        ['compliance_policy', 'system_admin', 'reporting'].concat(OPERATIONS),
  oro_director:        ['legal_rules', 'compliance_policy', 'reporting'].concat(OPERATIONS),
  oro_supervisor:      ['reporting'].concat(OPERATIONS),
  oro_senior_legal:    ['legal_rules', 'reporting'].concat(OPERATIONS),
  oro_legal_associate: ['reporting'].concat(OPERATIONS),
  oro_associate:       ['reporting'].concat(OPERATIONS),
  oro_finance:         ['reporting'].concat(OPERATIONS),
  team_manager:        ['reporting'].concat(OPERATIONS),
  team_supervisor:     OPERATIONS.slice(),
  team_staff:          [],
};
const PERMISSION_GROUPS = ['legal_rules', 'compliance_policy', 'operations_config', 'fee_configuration', 'system_admin', 'reporting'];
// legal_rules owner (attestation name) vs "may" — §5 "Owner vs may".
const LEGAL_RULES_OWNER = 'oro_senior_legal';

// §6 — task menus. oro_director = '*' (any routable type — oversight).
const TEAM_MENU = ['estimate', 'record_search', 'redaction', 'redaction_qa'];
const TASK_MENU = {
  city_management:     [],
  oro_sysadmin:        [],
  oro_director:        ['*'],
  oro_supervisor:      ['release_review', 'close_approval', 'process_withdrawal'],
  oro_senior_legal:    ['legal_review', 'legal_redaction'],
  oro_legal_associate: ['legal_redaction', 'legal_review'],
  oro_associate:       ['intake_review', 'mrr_management'],
  oro_finance:         ['fee_waiver'],
  team_manager:        TEAM_MENU.slice(),
  team_supervisor:     TEAM_MENU.slice(),
  team_staff:          TEAM_MENU.slice(),
};

// §9.1 — the compatibility shim: legacy `roles` / `perms` claims minted FROM user types, never from the
// legacy assignment tables (which the cutover empties). Deleted in S5 with the last requireRole site.
const ALL_PERMS = ['REQUEST_MANAGER', 'SEARCH_AND_TRIAGE', 'REDACTION_WORKER', 'REDACTION_AUTHORITY', 'FEE_MANAGER', 'FINANCE',
  'CLARIFICATION_SENDER', 'DELIVERY_AND_CLOSURE', 'DENIAL_AND_LEGAL', 'ESCALATION_HANDLER', 'REQUEST_REOPENER'];
const TEAM_PERMS = ['SEARCH_AND_TRIAGE', 'REDACTION_WORKER', 'FEE_MANAGER'];
const LEGACY = {
  city_management:     { roles: [], perms: [] },
  oro_sysadmin:        { roles: ['SYSTEM_ADMIN'], perms: ALL_PERMS.filter(function (p) { return p !== 'FINANCE'; }) },
  oro_director:        { roles: ['DIRECTOR'], perms: ALL_PERMS.slice() },
  oro_supervisor:      { roles: ['SUPERVISOR'], perms: ['REQUEST_MANAGER', 'DELIVERY_AND_CLOSURE', 'CLARIFICATION_SENDER', 'ESCALATION_HANDLER', 'REQUEST_REOPENER'] },
  oro_senior_legal:    { roles: ['ATTORNEY_REVIEWER'], perms: ['DENIAL_AND_LEGAL', 'REDACTION_AUTHORITY'] },
  oro_legal_associate: { roles: [], perms: ['REDACTION_WORKER', 'DENIAL_AND_LEGAL'] },
  oro_associate:       { roles: ['COORDINATOR'], perms: ['REQUEST_MANAGER', 'SEARCH_AND_TRIAGE', 'CLARIFICATION_SENDER'] },
  oro_finance:         { roles: [], perms: ['FINANCE'] },
  team_manager:        { roles: ['DEPT_MANAGER'], perms: TEAM_PERMS.slice() },
  team_supervisor:     { roles: ['SUPERVISOR'], perms: TEAM_PERMS.slice() },
  team_staff:          { roles: [], perms: TEAM_PERMS.slice() },
};

function uniq(arr) { return arr.filter(function (x, i) { return arr.indexOf(x) === i; }); }
function scopeOf(key) { var t = CATALOG.filter(function (c) { return c.key === key; })[0]; return t ? t.scope : null; }

// ---- reads -------------------------------------------------------------------------------------------
// S2b (§6.1): TEAM MEMBERSHIP FOR WORK = the teams a person holds any team-scoped type against.
// `users.department_id` is the home / display department only and gates nothing.
// SQL fragment: true when the user row aliased `<alias>` is a member of the team bound to the next `?`.
function teamMemberSql(alias) {
  alias = alias || 'u';
  return "EXISTS (SELECT 1 FROM user_user_types mm JOIN user_types mt ON mt.id = mm.user_type_id WHERE mm.user_id = " + alias + ".id AND mt.scope = 'team' AND mt.active = 1 AND mm.team_id = ?)";
}
// Subquery of the team ids the user bound to the next `?` is a member of.
function memberTeamsSql() {
  return "SELECT mm.team_id FROM user_user_types mm JOIN user_types mt ON mt.id = mm.user_type_id WHERE mm.user_id = ? AND mt.scope = 'team' AND mt.active = 1 AND mm.team_id IS NOT NULL";
}
async function teamsOf(userId) {
  return (await all(memberTeamsSql(), [userId])).map(function (r) { return r.team_id; });
}

// The person's held types: [{key, teamId, displayName, scope}].
async function typesOf(userId) {
  var rows = await all(
    'SELECT ut.key, ut.display_name, ut.scope, uut.team_id FROM user_user_types uut ' +
    'JOIN user_types ut ON ut.id = uut.user_type_id WHERE uut.user_id = ? AND ut.active = 1 ORDER BY ut.sort_order', [userId]);
  return rows.map(function (r) { return { key: r.key, teamId: r.team_id || null, displayName: r.display_name, scope: r.scope }; });
}

// Everything a token needs, derived once at mint time (§7). Authorities and permission groups come from
// the TABLES (a city may later narrow them); the legacy shim comes from LEGACY above.
async function claimsFor(userId) {
  var types = await typesOf(userId);
  var keys = uniq(types.map(function (t) { return t.key; }));
  var authorities = [], groups = [], roles = [], perms = [];
  if (keys.length) {
    var ph = keys.map(function () { return '?'; }).join(',');
    (await all('SELECT DISTINCT a.authority_key FROM user_type_authority a JOIN user_types ut ON ut.id = a.user_type_id WHERE ut.key IN (' + ph + ')', keys))
      .forEach(function (r) { authorities.push(r.authority_key); });
    (await all('SELECT DISTINCT p.permission_group FROM user_type_permission p JOIN user_types ut ON ut.id = p.user_type_id WHERE ut.key IN (' + ph + ')', keys))
      .forEach(function (r) { groups.push(r.permission_group); });
    keys.forEach(function (k) { var l = LEGACY[k] || { roles: [], perms: [] }; roles = roles.concat(l.roles); perms = perms.concat(l.perms); });
  }
  var inOro = types.some(function (t) { return t.scope === 'office'; });
  // S4: the task-menu union rides the token ('*' = any) so work-competence gates need no DB read.
  var menu = [];
  for (var mi = 0; mi < keys.length; mi++) { var mm = TASK_MENU[keys[mi]] || []; if (mm.indexOf('*') !== -1) { menu = '*'; break; } mm.forEach(function (x) { if (menu.indexOf(x) === -1) menu.push(x); }); }
  return {
    userTypes: types.map(function (t) { return { key: t.key, teamId: t.teamId, displayName: t.displayName }; }),
    taskMenu: menu,
    authorities: uniq(authorities).sort(),
    permissionGroups: uniq(groups).sort(),
    inOro: inOro,
    roles: uniq(roles),
    perms: uniq(perms),
  };
}

// Union of the person's type menus (§6). Returns null for "any routable type" (oro_director).
async function taskMenuFor(userId) {
  var types = await typesOf(userId);
  var menu = [];
  for (var i = 0; i < types.length; i++) {
    var m = TASK_MENU[types[i].key] || [];
    if (m.indexOf('*') !== -1) return null;
    menu = menu.concat(m);
  }
  return uniq(menu);
}

// Legacy-claim holder lookups for the readers that used to JOIN the legacy assignment tables
// (task-pool fallback, objections' supervisor finder, coverage-gap chain, import notify). Derived from
// user types via LEGACY, so an empty legacy table no longer means "nobody".
function typesMinting(kind, names) {
  names = Array.isArray(names) ? names : [names];
  return TYPE_KEYS.filter(function (k) { return LEGACY[k][kind].some(function (n) { return names.indexOf(n) !== -1; }); });
}
async function usersWithLegacy(kind, names, opts) {
  opts = opts || {};
  var keys = typesMinting(kind, names);
  if (!keys.length) return [];
  var ph = keys.map(function () { return '?'; }).join(',');
  var params = keys.slice();
  var sql = 'SELECT DISTINCT u.id, u.display_name, u.email, u.department_id, u.routing_specialization, u.status FROM users u ' +
    'JOIN user_user_types uut ON uut.user_id = u.id JOIN user_types ut ON ut.id = uut.user_type_id ' +
    'WHERE ut.key IN (' + ph + ') AND ut.active = 1';
  // S2b (§6.1): both axes scope by the team the type is held AGAINST. WORK eligibility (perms) = membership
  // of the team (any team-scoped type against it); CHAIN OF COMMAND (function roles) = the team this very
  // type was granted against. users.department_id gates neither.
  if (opts.teamId) {
    if (kind === 'roles') { sql += " AND ut.scope = 'team' AND uut.team_id = ?"; params.push(opts.teamId); }
    else { sql += ' AND ' + teamMemberSql('u'); params.push(opts.teamId); }
  }
  if (opts.status !== 'any') { sql += " AND u.status = 'active'"; }
  if (opts.exclude) { sql += ' AND u.id <> ?'; params.push(opts.exclude); }
  sql += ' ORDER BY u.display_name';
  return await all(sql, params);
}
function usersWithLegacyRole(names, opts) { return usersWithLegacy('roles', names, opts); }
function usersWithLegacyPerm(names, opts) { return usersWithLegacy('perms', names, opts); }
// SQL fragment: user ids that hold the legacy PERMISSION named by the bound parameter. Used inside the
// task-pool eligibility predicate where a subquery is needed rather than a list.
function legacyPermHoldersSql() {
  return 'SELECT uut.user_id FROM user_user_types uut JOIN user_types ut ON ut.id = uut.user_type_id ' +
    'JOIN legacy_perm_map m ON m.user_type_key = ut.key WHERE m.perm = ?';
}

// ---- writes ------------------------------------------------------------------------------------------

// Any change to what a person may do bumps users.auth_version so outstanding tokens die (§7 token freshness).
async function bumpAuthVersion(userId) {
  await run('UPDATE users SET auth_version = COALESCE(auth_version, 1) + 1 WHERE id = ?', [userId]);
}

async function grant(userId, key, teamId, actorId) {
  var scope = scopeOf(key);
  if (!scope) throw new Error('unknown user type: ' + key);
  if (scope === 'team' && !teamId) throw new Error('user type ' + key + ' is team-scoped: teamId required');
  if (scope === 'office') teamId = null;
  var t = await get('SELECT id FROM user_types WHERE key = ?', [key]);
  if (!t) throw new Error('user type not seeded: ' + key);
  var r = await run('INSERT INTO user_user_types (user_id, user_type_id, team_id, assigned_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    [userId, t.id, teamId, actorId || null]);
  if (r.changes) await bumpAuthVersion(userId);
  return r.changes > 0;
}
async function revoke(userId, key, teamId) {
  var r = await run('DELETE FROM user_user_types WHERE user_id = ? AND user_type_id = (SELECT id FROM user_types WHERE key = ?) ' +
    "AND COALESCE(team_id, '') = COALESCE(?, '')", [userId, key, teamId || null]);
  if (r.changes) await bumpAuthVersion(userId);
  return r.changes > 0;
}
async function revokeAll(userId) {
  var r = await run('DELETE FROM user_user_types WHERE user_id = ?', [userId]);
  if (r.changes) await bumpAuthVersion(userId);
  return r.changes;
}

// (legacy_perm_map — the type key -> legacy perm table SQL readers join — is seeded by schema.postgres.sql
// from LEGACY; verify_user_types asserts the two agree.)

module.exports = {
  CATALOG, TYPE_KEYS, AUTHORITY, AUTHORITY_KEYS, PERMISSION, PERMISSION_GROUPS, LEGAL_RULES_OWNER, TASK_MENU, LEGACY, ALL_PERMS,
  typesOf, claimsFor, taskMenuFor, scopeOf, teamMemberSql, memberTeamsSql, teamsOf,
  usersWithLegacyRole, usersWithLegacyPerm, legacyPermHoldersSql, typesMinting,
  grant, revoke, revokeAll, bumpAuthVersion,
};
