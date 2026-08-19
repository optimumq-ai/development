'use strict';
// WHO MAY ACT ON A REQUEST — the one answer for every per-request act in routes/requests.js.
//
// Until 2026-08-18 the request domain scoped its LISTS (the queue shows a non-elevated staffer only their
// team's and their own requests) but never its ACTS: advance stage, assign, assert an exemption, record an
// AG ruling, send/resolve a clarification, log effort, resolve a search intent, confirm an eligibility
// finding, confirm identity — all requireAuth only. Any logged-in account, including a reporting-only one,
// could advance any request in the city.
//
// THE RULE (the same shape tasks.js already used for per-task acts — "the assignee, or someone who may
// route"): a staffer may perform an act on a request when ANY of these hold —
//   1. an ACTING function role — SYSTEM_ADMIN, DIRECTOR, SUPERVISOR, DEPT_MANAGER, COORDINATOR (the
//      `canRoute` / `mayRoute` set the domain already uses; plus any act-specific extra role, e.g.
//      ATTORNEY_REVIEWER for legal acts);
//   2. a PERMISSION role that carries the act (act-specific: CLARIFICATION_SENDER for clarifications,
//      DENIAL_AND_LEGAL for exemption acts, ...);
//   3. the work is THEIRS — the request (any row of its parent/child cluster) is assigned to them, or they
//      hold an OPEN task on it (optionally narrowed to given task types). This is what lets an ORO Associate
//      holding an intake_review task send a clarification while holding no permission role at all — the
//      task grant IS the eligibility in v3, and the fee-waiver-decision inline-decider carve-out is the
//      precedent.
//
// The cluster matters because acts are addressed by whatever id the screen holds — a parent's id from the
// workspace, a child's from a task screen — while tasks hang off CHILDREN and `assigned_to` may sit on
// either. "Assigned to you" is answered across parent + every child.
var db = require('../db');

var ACTING_ROLES = ['SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'DEPT_MANAGER', 'COORDINATOR'];

// Resolve an addressed id (or citizen number) to its cluster: the parent row + every child id.
// Returns null when nothing is addressed.
async function cluster(idOrNumber) {
  var addressed = await db.get('SELECT id, master_request_id, assigned_to FROM requests WHERE id = ? OR request_number = ?', [idOrNumber, idOrNumber]);
  if (!addressed) return null;
  var parentId = addressed.master_request_id || addressed.id;
  var rows = await db.all('SELECT id, assigned_to FROM requests WHERE id = ? OR master_request_id = ?', [parentId, parentId]);
  return { addressed: addressed, parentId: parentId, rows: rows, ids: rows.map(function (r) { return r.id; }) };
}

function hasAny(list, wanted) {
  list = list || []; wanted = wanted || [];
  return wanted.some(function (x) { return list.indexOf(x) !== -1; });
}

// Does this user hold an OPEN task on any row of the cluster (optionally of the given types)?
async function holdsOpenTask(userId, ids, taskTypes) {
  if (!userId || !ids || !ids.length) return false;
  var tr = require('./taskRouting');
  var ph = ids.map(function () { return '?'; }).join(',');
  var sph = tr.ACTIONABLE_STATUSES.map(function () { return '?'; }).join(',');
  var sql = 'SELECT 1 AS one FROM tasks WHERE request_id IN (' + ph + ') AND assigned_to = ? AND status IN (' + sph + ')';
  var params = ids.concat([userId], tr.ACTIONABLE_STATUSES);
  if (taskTypes && taskTypes.length) {
    sql += ' AND type IN (' + taskTypes.map(function () { return '?'; }).join(',') + ')';
    params = params.concat(taskTypes);
  }
  var row = await db.get(sql + ' LIMIT 1', params);
  return !!row;
}

// The decision. `opts`: { perms: [], roles: [] (extra acting roles), taskTypes: null | [], label: '...' }
// Returns { ok: true } or { ok: false, error } — never throws on a missing request (that is `found: false`).
async function decide(user, idOrNumber, opts) {
  opts = opts || {};
  var roles = (user && user.roles) || [], perms = (user && user.perms) || [];
  if (hasAny(roles, ACTING_ROLES.concat(opts.roles || []))) return { ok: true, found: true, by: 'role' };
  if (hasAny(perms, opts.perms || [])) return { ok: true, found: true, by: 'perm' };
  var c = await cluster(idOrNumber);
  if (!c) return { ok: false, found: false };
  var uid = user && (user.sub || user.id);
  if (uid && c.rows.some(function (r) { return r.assigned_to === uid; })) return { ok: true, found: true, by: 'assignee' };
  if (await holdsOpenTask(uid, c.ids, opts.taskTypes)) return { ok: true, found: true, by: 'task' };
  return { ok: false, found: true, error: refusal(opts) };
}

function refusal(opts) {
  var what = opts.label || 'do this';
  return 'You can’t ' + what + ' on this request. It takes a supervising role' +
    ((opts.perms && opts.perms.length) ? ' or the ' + opts.perms.join(' / ') + ' permission' : '') +
    ', or the request (or an open task on it) must be assigned to you.';
}

module.exports = { ACTING_ROLES: ACTING_ROLES, cluster: cluster, holdsOpenTask: holdsOpenTask, decide: decide };
