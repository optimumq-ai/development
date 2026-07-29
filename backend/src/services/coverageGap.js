'use strict';
// PHASE 7 / BW2 — THE COVERAGE GAP: a task spawned into an empty pool.
//
// A task whose eligible-user set is EMPTY is not a task. It is a request stopping, silently, at a stage
// nobody in the city can act on — and it does not look broken from any screen: the request has a task, the
// task has a role, the pool is simply empty, and the only symptom is a deadline that arrives with nothing
// done. This is the same failure class the 2026-07-19 catalog deletions were about ("an entry in
// ROUTABLE_TASK_TYPES is a promise the router can deliver that type"), except it happens at RUNTIME, from
// staffing rather than from configuration: one person leaves, or nobody on this team was ever granted this
// task type, and the pool goes empty without anything changing in code.
//
// SPEC_processing_ui §8 lists the "coverage-gap manager email" as unbuilt plumbing the role model (§6)
// forces. This is it: when a stage spawns work nobody is eligible for, the team's Fulfillment Manager is
// told, by name, which request is stuck and why.
//
// ══ WHO IS "THE TEAM'S FULFILLMENT MANAGER" ══
//
// The v3 user-type model is not built (MASTER Part C is a design, the code still carries function roles),
// so the recipient is resolved through a documented fallback chain rather than a column that does not
// exist. Each step is a real person with real authority over the gap, and the chain ends at someone who
// always exists — because the ONE outcome this module refuses is "nobody was told":
//
//   1. DEPT_MANAGER on the owning team        — the Fulfillment Manager in everything but name
//   2. SUPERVISOR on the owning team          — the team's other staffing authority
//   3. DIRECTOR (office-level)                — team-agnostic work has no team manager to tell
//   4. SYSTEM_ADMIN (office-level)            — last resort; a gap nobody owns is still a gap
//
// When the v3 types land, step 1 becomes "the [Team] Fulfillment Manager" and the rest stays as fallback.
var db = require('../db');
var all = db.all, get = db.get;

var KIND = 'coverage_gap';

// The escalation chain above, in order. Function-role names as seeded in schema.sql.
var TEAM_ROLES = ['DEPT_MANAGER', 'SUPERVISOR'];
var OFFICE_ROLES = ['DIRECTOR', 'SYSTEM_ADMIN'];

async function usersWithRole(roleName, teamId) {
  var params = [roleName];
  var clause = '';
  if (teamId) { clause = ' AND u.department_id = ?'; params.push(teamId); }
  return await all(
    'SELECT u.id, u.display_name, u.email FROM users u ' +
    'JOIN user_function_roles ufr ON ufr.user_id = u.id ' +
    'JOIN function_roles fr ON fr.id = ufr.function_role_id ' +
    "WHERE fr.name = ? AND u.status = 'active'" + clause,
    params);
}

// The first non-empty rung of the chain. Returns [] only if the install has no active manager, supervisor,
// director or sysadmin at all — in which case the console log below is the last line of defence.
async function managersFor(teamId) {
  var i;
  if (teamId) {
    for (i = 0; i < TEAM_ROLES.length; i++) {
      var team = await usersWithRole(TEAM_ROLES[i], teamId);
      if (team.length) return { users: team, via: TEAM_ROLES[i] + '@team' };
    }
  }
  for (i = 0; i < OFFICE_ROLES.length; i++) {
    var office = await usersWithRole(OFFICE_ROLES[i], null);
    if (office.length) return { users: office, via: OFFICE_ROLES[i] + '@office' };
  }
  return { users: [], via: null };
}

function messageFor(task, reqRow, teamRow) {
  var what = (task.title || task.type) + (reqRow && reqRow.request_number ? ' on request ' + reqRow.request_number : '');
  return {
    title: 'Nobody can pick up "' + (task.title || task.type) + '"',
    body: what + ' was created for ' + (teamRow ? teamRow.name : 'the office') + ', but no active person is ' +
          'eligible for ' + task.type + ' work there, so it is in nobody\'s queue. Assign the task type to ' +
          'someone on the team, or hand the task to a person directly — until then this request is stopped.'
  };
}

// Tell the team's manager that this task landed in an empty pool.
//
// Idempotent per task: the notification dedupes on (user, kind, context_id), and the EMAIL is sent only on
// the first raise — a gap that persists for a week must not mail the manager on every reconciler sweep
// (spawnForStage runs every 2 minutes), while a genuinely new gap always mails.
//
// Never throws. A notification failure must not roll back the task the notification is about.
async function notifyEmptyPool(task, opts) {
  opts = opts || {};
  if (!task) return null;
  try {
    var reqRow = task.request_id ? await get('SELECT id, request_number FROM requests WHERE id = ?', [task.request_id]) : null;
    var teamRow = task.team_id ? await get('SELECT id, name FROM departments WHERE id = ?', [task.team_id]) : null;
    var who = await managersFor(task.team_id);
    var msg = messageFor(task, reqRow, teamRow);

    if (!who.users.length) {
      // Nothing to escalate TO. Still say it out loud — silence is the failure mode this module exists for.
      console.error('[coverageGap] ' + task.type + ' task ' + task.id + ' has an empty pool AND no manager, ' +
        'supervisor, director or sysadmin to tell.');
      return { notified: 0, emailed: 0, via: null };
    }

    var N = require('./notifications');
    var notified = 0, emailed = 0, firstRaise = [];
    for (var i = 0; i < who.users.length; i++) {
      var u = who.users[i];
      var existing = await get(
        'SELECT id FROM notifications WHERE user_id = ? AND kind = ? AND context_id = ? AND dismissed_at IS NULL',
        [u.id, KIND, task.id]);
      await N.emit({
        userId: u.id, kind: KIND, contextType: 'task', contextId: task.id,
        title: msg.title, body: msg.body,
        link: task.request_id ? '/requests/' + task.request_id : '/staff',
        createdBy: 'system'
      });
      notified++;
      if (!existing) firstRaise.push(u);
    }

    // THE EMAIL. A manager who is not logged in does not see an in-app notification, and an empty pool is
    // precisely the situation where nobody is looking at the queue. The sender already exists
    // (services/email.js — Resend or SMTP); when neither is configured it returns { sent:false } and this
    // degrades to the in-app notification alone, which is the correct behaviour, not an error.
    if (opts.email !== false && firstRaise.length) {
      var to = firstRaise.map(function (u) { return u.email; }).filter(Boolean);
      if (to.length) {
        try {
          var mail = require('./email');
          var r = await mail.send({
            to: to.join(', '), subject: msg.title,
            text: msg.body + (reqRow ? '\n\nRequest: ' + reqRow.request_number : ''),
            html: '<p>' + msg.body + '</p>' + (reqRow ? '<p>Request: <strong>' + reqRow.request_number + '</strong></p>' : '')
          });
          if (r && r.sent) emailed = to.length;
          // ⚠️ TODO (BW-later): there is no per-recipient email PREFERENCE and no digest. Every first-raise
          // gap mails immediately. If a city reports noise, batch these — the dedupe above already means one
          // mail per task, not per sweep.
        } catch (e) { console.error('[coverageGap email]', e && e.message); }
      }
    }
    console.warn('[coverageGap] ' + task.type + ' task ' + task.id + ' spawned into an EMPTY POOL — told ' +
      notified + ' ' + (who.via || 'recipient') + (emailed ? ', emailed ' + emailed : ''));
    return { notified: notified, emailed: emailed, via: who.via, users: who.users.map(function (u) { return u.id; }) };
  } catch (e) {
    console.error('[coverageGap notifyEmptyPool]', e && e.message);
    return null;
  }
}

module.exports = { KIND: KIND, TEAM_ROLES: TEAM_ROLES, OFFICE_ROLES: OFFICE_ROLES,
  usersWithRole: usersWithRole, managersFor: managersFor, notifyEmptyPool: notifyEmptyPool };
