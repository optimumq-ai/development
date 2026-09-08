'use strict';
// ORGANIZATION REMOVAL — departments, fulfillment teams, staff (Kevin 2026-09-08: "I see no way to delete a
// city department, a fulfillment team, or a staff member").
//
// Nothing in the org model carries a foreign key, so a bare DELETE would strand routing, ownership, pools and
// people. Deletion is therefore a PROCESS: check() names every prerequisite as a step with a count and the
// screen where it is cleared; remove() re-runs the check and refuses (409, the same list) while anything is
// left. Two outcomes once clear:
//   · DELETE — the row has no footprint anywhere → the row goes.
//   · RETIRE — closed requests, released records, finished tasks or history still point at it → the row stays,
//     hidden from every list, pool and routing query (departments.active = 0 / users.status = 'removed'), and
//     stripped of anything that could still act (a retired person loses their user types, task subset,
//     routing profile and notifications; their tokens die within the cache window). The record keeps its name.
// The caller never chooses the outcome; the footprint does. Both report to the setup hub through the routes'
// existing finish hooks, so an approved list drops to yellow and the lane owners hear once.
var db = require('../db');
var all = db.all, get = db.get, run = db.run;

var ACTIVE_TASK = "('open','assigned','in_progress','returned','awaiting_review')";
function n(row) { return row ? Number(row.n) || 0 : 0; }
async function count(sql, params) { return n(await get(sql, params || [])); }
function step(code, cnt, text, where) { return { code: code, count: cnt, text: text, where: where || null }; }

// ---------------------------------------------------------------------------------------------------
async function checkDepartment(row) {
  var id = row.id, blockers = [], keeps = [];
  if (row.is_open_records) blockers.push(step('open_records_flag', 1, 'This department is flagged as the Open Records hub — intake and routing rely on that flag. Move the flag to another department (Edit) first.', { label: 'City Departments', href: '/org?tab=departments' }));
  if (row.is_catch_all) blockers.push(step('catch_all', 1, 'This is the catch-all department — requests nobody else claims land here. Make another department the catch-all first.', { label: 'City Departments', href: '/org?tab=departments' }));
  var rt = await count('SELECT COUNT(DISTINCT record_type_id) n FROM record_type_departments WHERE department_id = ?', [id]);
  if (rt) blockers.push(step('record_types', rt, rt + ' record type' + (rt > 1 ? 's name' : ' names') + ' this department as owner or fulfiller. Move ' + (rt > 1 ? 'them' : 'it') + ' to another department first.', { label: 'Which department owns which records', href: '/setup/taxonomy?tab=owners' }));
  var openReq = await count("SELECT COUNT(*) n FROM requests WHERE record_owner_department_id = ? AND stage <> 'closed'", [id]);
  if (openReq) blockers.push(step('open_requests', openReq, openReq + ' open request' + (openReq > 1 ? 's are' : ' is') + ' owned by this department. Close or re-own ' + (openReq > 1 ? 'them' : 'it') + ' first.', { label: 'Request Queue', href: '/requests' }));
  var home = await count("SELECT COUNT(*) n FROM users WHERE department_id = ? AND status = 'active'", [id]);
  if (home) blockers.push(step('staff_home', home, home + ' active staff member' + (home > 1 ? 's list' : ' lists') + ' this as ' + (home > 1 ? 'their' : 'their') + ' home. Move ' + (home > 1 ? 'them' : 'them') + ' first.', { label: 'Staff', href: '/org?tab=staff' }));
  var closedReq = await count("SELECT COUNT(*) n FROM requests WHERE (record_owner_department_id = ? OR department_id = ?) AND stage = 'closed'", [id, id]);
  if (closedReq) keeps.push(step('closed_requests', closedReq, closedReq + ' closed request' + (closedReq > 1 ? 's' : '') + ' record this department'));
  var rel = await count('SELECT COUNT(*) n FROM fulfilled_records WHERE department_id = ?', [id]);
  if (rel) keeps.push(step('released_records', rel, rel + ' released record' + (rel > 1 ? 's' : '') + ' came from it'));
  var mrj = await count('SELECT COUNT(*) n FROM mass_redaction_jobs WHERE department_id = ?', [id]);
  if (mrj) keeps.push(step('mass_jobs', mrj, mrj + ' mass-redaction job' + (mrj > 1 ? 's' : '') + ' ran for it'));
  return { blockers: blockers, keeps: keeps };
}

async function checkTeam(row) {
  var id = row.id, blockers = [], keeps = [];
  if (row.is_open_records) blockers.push(step('open_records_flag', 1, 'This team is flagged as the Open Records hub\'s own team — routing relies on that flag. Move the flag to another team (Edit) first.', { label: 'Teams', href: '/org?tab=teams' }));
  var serves = await all("SELECT name FROM departments WHERE processed_by = ? AND active = 1 ORDER BY name", [id]);
  if (serves.length) blockers.push(step('serves', serves.length, 'This team fulfills ' + serves.length + ' department' + (serves.length > 1 ? 's' : '') + ' (' + serves.map(function (d) { return d.name; }).join(', ') + '). Edit another team to take ' + (serves.length > 1 ? 'them' : 'it') + ' over first.', { label: 'Teams', href: '/org?tab=teams' }));
  var openTasks = await count('SELECT COUNT(*) n FROM tasks WHERE team_id = ? AND status IN ' + ACTIVE_TASK, [id]);
  if (openTasks) blockers.push(step('open_tasks', openTasks, openTasks + ' open task' + (openTasks > 1 ? 's sit' : ' sits') + ' in this team\'s pool. Reassign or finish ' + (openTasks > 1 ? 'them' : 'it') + ' first.', { label: 'Request Queue', href: '/requests' }));
  var openReq = await count("SELECT COUNT(*) n FROM requests WHERE department_id = ? AND stage <> 'closed'", [id]);
  if (openReq) blockers.push(step('open_requests', openReq, openReq + ' open request' + (openReq > 1 ? 's are' : ' is') + ' routed to this team. Reassign ' + (openReq > 1 ? 'them' : 'it') + ' first.', { label: 'Request Queue', href: '/requests' }));
  var members = await count("SELECT COUNT(*) n FROM users WHERE department_id = ? AND status = 'active'", [id]);
  if (members) blockers.push(step('members', members, members + ' active staff member' + (members > 1 ? 's belong' : ' belongs') + ' to this team. Move ' + (members > 1 ? 'them' : 'them') + ' to another team first.', { label: 'Staff', href: '/org?tab=staff' }));
  var scoped = await count('SELECT COUNT(*) n FROM user_user_types uut JOIN users u ON u.id = uut.user_id WHERE uut.team_id = ? AND u.status = \'active\'', [id]);
  if (scoped) blockers.push(step('team_types', scoped, scoped + ' team-scoped user type' + (scoped > 1 ? 's are' : ' is') + ' held on this team (supervisor, manager, staff). Change ' + (scoped > 1 ? 'them' : 'it') + ' on the person\'s record first.', { label: 'Staff', href: '/org?tab=staff' }));
  var closedReq = await count("SELECT COUNT(*) n FROM requests WHERE department_id = ? AND stage = 'closed'", [id]);
  if (closedReq) keeps.push(step('closed_requests', closedReq, closedReq + ' closed request' + (closedReq > 1 ? 's were' : ' was') + ' worked by this team'));
  var doneTasks = await count('SELECT COUNT(*) n FROM tasks WHERE team_id = ? AND status NOT IN ' + ACTIVE_TASK, [id]);
  if (doneTasks) keeps.push(step('finished_tasks', doneTasks, doneTasks + ' finished task' + (doneTasks > 1 ? 's' : '') + ' record it'));
  var wd = await count('SELECT COUNT(*) n FROM workflow_decisions WHERE decided_team_id = ?', [id]);
  if (wd) keeps.push(step('routing_decisions', wd, wd + ' routing decision' + (wd > 1 ? 's' : '') + ' named it'));
  return { blockers: blockers, keeps: keeps };
}

// Does anyone ELSE who is active hold the authority? (the last account that can manage users must stay)
async function otherActiveHolders(authority, exceptUserId) {
  return await count("SELECT COUNT(DISTINCT u.id) n FROM users u JOIN user_user_types uut ON uut.user_id = u.id JOIN user_type_authority a ON a.user_type_id = uut.user_type_id WHERE a.authority_key = ? AND u.status = 'active' AND u.id <> ?", [authority, exceptUserId]);
}
async function holds(authority, userId) {
  return !!(await count('SELECT COUNT(*) n FROM user_user_types uut JOIN user_type_authority a ON a.user_type_id = uut.user_type_id WHERE a.authority_key = ? AND uut.user_id = ?', [authority, userId]));
}

async function checkStaff(row, actor) {
  var id = row.id, blockers = [], keeps = [];
  if (actor && (actor.sub === id || actor.id === id)) blockers.push(step('self', 1, 'You cannot delete your own account. Another administrator has to do it.', null));
  if (row.status === 'active') blockers.push(step('active', 1, 'The account is still active. Deactivate it first — that ends any signed-in session within a minute.', { label: 'Deactivate now', action: { method: 'PATCH', path: '/staff/' + id + '/status', body: { status: 'inactive' } } }));
  var openTasks = await count('SELECT COUNT(*) n FROM tasks WHERE assigned_to = ? AND status IN ' + ACTIVE_TASK, [id]);
  if (openTasks) blockers.push(step('open_tasks', openTasks, openTasks + ' open task' + (openTasks > 1 ? 's are' : ' is') + ' assigned to this person. Reassign ' + (openTasks > 1 ? 'them' : 'it') + ' first.', { label: 'Request Queue', href: '/requests' }));
  var openReq = await count("SELECT COUNT(*) n FROM requests WHERE assigned_to = ? AND stage <> 'closed'", [id]);
  if (openReq) blockers.push(step('open_requests', openReq, openReq + ' open request' + (openReq > 1 ? 's are' : ' is') + ' assigned to this person. Reassign ' + (openReq > 1 ? 'them' : 'it') + ' first.', { label: 'Request Queue', href: '/requests' }));
  if (await holds('manage_users', id) && !(await otherActiveHolders('manage_users', id))) blockers.push(step('last_manager', 1, 'This is the only account that can manage users. Give another active person a user type with that authority first.', { label: 'Staff', href: '/org?tab=staff' }));
  var doneTasks = await count('SELECT COUNT(*) n FROM tasks WHERE (assigned_to = ? OR created_by = ?) AND status NOT IN ' + ACTIVE_TASK, [id, id]);
  if (doneTasks) keeps.push(step('finished_tasks', doneTasks, doneTasks + ' finished task' + (doneTasks > 1 ? 's' : '') + ' record this person'));
  var hist = await count('SELECT COUNT(*) n FROM request_history WHERE actor_id = ?', [id]);
  if (hist) keeps.push(step('history', hist, hist + ' request-history entr' + (hist > 1 ? 'ies' : 'y') + ' name this person'));
  var closedReq = await count("SELECT COUNT(*) n FROM requests WHERE assigned_to = ? AND stage = 'closed'", [id]);
  if (closedReq) keeps.push(step('closed_requests', closedReq, closedReq + ' closed request' + (closedReq > 1 ? 's were' : ' was') + ' assigned to this person'));
  var signoffs = await count('SELECT COUNT(*) n FROM setup_hub_signoffs WHERE marked_by = ?', [id]);
  if (signoffs) keeps.push(step('approvals', signoffs, signoffs + ' setup approval' + (signoffs > 1 ? 's carry' : ' carries') + ' this person\'s name'));
  return { blockers: blockers, keeps: keeps };
}

// ---------------------------------------------------------------------------------------------------
async function load(kind, id) {
  if (kind === 'staff') return await get('SELECT id, display_name AS name, email, status, department_id FROM users WHERE id = ?', [id]);
  var row = await get('SELECT * FROM departments WHERE id = ?', [id]);
  if (!row) return null;
  var isTeam = row.kind === 'team';
  if ((kind === 'team') !== isTeam) return null;   // a department id offered as a team (or vice versa) is "not found"
  return row;
}

// The process, as the screen shows it.
async function check(kind, id, actor) {
  var row = await load(kind, id);
  if (!row) return null;
  var r = kind === 'staff' ? await checkStaff(row, actor) : kind === 'team' ? await checkTeam(row) : await checkDepartment(row);
  var mode = r.keeps.length ? 'retire' : 'delete';
  var noun = kind === 'staff' ? 'person' : kind;
  return {
    kind: kind, id: id, name: row.name, status: row.status || (row.active ? 'active' : 'retired'),
    blockers: r.blockers, keeps: r.keeps, canDelete: r.blockers.length === 0, mode: mode,
    outcome: r.blockers.length ? 'Clear every step above, then delete.'
      : mode === 'delete' ? 'Nothing else refers to this ' + noun + '. Deleting removes it completely.'
      : 'This ' + noun + ' is removed from every list' + (kind === 'staff' ? ', cannot sign in, and can no longer be assigned anything' : ' and from routing') + '. The past work listed below keeps its name on the record.'
  };
}

async function remove(kind, id, actor) {
  var c = await check(kind, id, actor);
  if (!c) { var nf = new Error('Not found.'); nf.status = 404; throw nf; }
  if (!c.canDelete) { var e = new Error('Not ready to delete — ' + c.blockers.length + ' step' + (c.blockers.length > 1 ? 's' : '') + ' still open.'); e.status = 409; e.code = 'REMOVAL_BLOCKED'; e.check = c; throw e; }
  if (kind === 'staff') {
    // strip everything that could still act, whichever outcome
    await run('DELETE FROM user_user_types WHERE user_id = ?', [id]);
    await run('DELETE FROM user_task_types WHERE user_id = ?', [id]);
    await run('DELETE FROM notifications WHERE user_id = ?', [id]);
    await run("DELETE FROM embeddings WHERE owner_type = 'user_spec' AND owner_id = ?", [id]);
    if (c.mode === 'delete') await run('DELETE FROM users WHERE id = ?', [id]);
    else {
      await run("UPDATE users SET status = 'removed', routing_specialization = NULL, department_id = NULL, temp_password = NULL WHERE id = ?", [id]);
      try { await require('./userTypes').bumpAuthVersion(id); } catch (e2) { /* the row is already refused at login */ }
    }
  } else {
    if (c.mode === 'delete') await run('DELETE FROM departments WHERE id = ?', [id]);
    else await run('UPDATE departments SET active = 0, processed_by = NULL, is_catch_all = 0 WHERE id = ?', [id]);
  }
  return { removed: true, mode: c.mode, kind: kind, id: id, name: c.name, keeps: c.keeps };
}

module.exports = { check: check, remove: remove };
