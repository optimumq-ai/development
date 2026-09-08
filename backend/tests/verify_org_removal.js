'use strict';
// ORGANIZATION REMOVAL (Kevin 2026-09-08): deleting a department, a fulfillment team or a staff member is a
// PROCESS — the server names every prerequisite as a step, refuses while one is open, and then either deletes
// the row outright or retires it when past work still points at it. services/orgRemoval + the routes.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ut = require('/opt/optimumq/backend/src/services/userTypes');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');

var pass = 0, fail = 0;
function ok(l, c, extra) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !extra ? '' : '  -> ' + extra)); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'rm' + Date.now().toString().slice(-6);
var seq = 0;
async function mk(key, teamId, status) {
  var id = 'u-' + TAG + '-' + key + '-' + (++seq);
  await db.run("INSERT INTO users (id, email, display_name, title, status, department_id, password_hash) VALUES (?,?,?,?,?,?,?)", [id, id + '@test.optimumq.ai', 'RM ' + key, 'Test ' + TAG, status || 'active', teamId || null, 'x']);
  if (key !== 'none') await ut.grant(id, key, teamId || null, 'harness');
  return id;
}
async function callAs(id, method, path, body) {
  var t = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [id]));
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
function codes(c) { return (c.blockers || []).map(function (b) { return b.code; }).sort().join(','); }

(async function () {
  await db.initDb();
  var made = { users: [], depts: [], rt: [], tasks: [], reqs: [], hist: [] };
  try {
    var SA = await mk('oro_sysadmin'); made.users.push(SA);
    var STAFF = await mk('team_staff', 'team-police'); made.users.push(STAFF);

    console.log('\n=== A. DEPARTMENT ===');
    var dA = (await callAs(SA, 'POST', '/departments', { name: 'Removal Dept ' + TAG, code: 'RD' + TAG.slice(-3), kind: 'department' })).body.department; made.depts.push(dA.id);
    var cA = await callAs(SA, 'GET', '/departments/' + dA.id + '/removal');
    ok('A1 a fresh department: no steps, outcome DELETE', cA.status === 200 && cA.body.canDelete === true && cA.body.mode === 'delete' && cA.body.blockers.length === 0, JSON.stringify(cA.body));
    var rt = await db.get('SELECT id FROM record_types ORDER BY id LIMIT 1');
    var rtdId = 'rtd-' + TAG; await db.run("INSERT INTO record_type_departments (id, record_type_id, department_id, role) VALUES (?,?,?,'owner')", [rtdId, rt.id, dA.id]); made.rt.push(rtdId);
    var U1 = await mk('none', dA.id); made.users.push(U1);
    await db.run('UPDATE departments SET is_catch_all = 1 WHERE id = ?', [dA.id]);
    var cA2 = await callAs(SA, 'GET', '/departments/' + dA.id + '/removal');
    ok('A2 catch-all + a record type naming it + an active person calling it home → three named steps, each with a place to fix it', codes(cA2.body) === 'catch_all,record_types,staff_home' && cA2.body.blockers.every(function (b) { return b.where && b.where.href; }) && cA2.body.canDelete === false, codes(cA2.body));
    var refused = await callAs(SA, 'DELETE', '/departments/' + dA.id);
    ok('A3 DELETE while steps are open is refused 409 and returns the same list', refused.status === 409 && refused.body.code === 'REMOVAL_BLOCKED' && codes(refused.body.check) === 'catch_all,record_types,staff_home', refused.status + ' ' + JSON.stringify(refused.body).slice(0, 100));
    ok('A3b …and the department is still there', !!(await db.get('SELECT id FROM departments WHERE id = ?', [dA.id])));
    await db.run('UPDATE departments SET is_catch_all = 0 WHERE id = ?', [dA.id]);
    await db.run('DELETE FROM record_type_departments WHERE id = ?', [rtdId]);
    await db.run("UPDATE users SET department_id = NULL WHERE id = ?", [U1]);
    var staffOnly = await callAs(STAFF, 'DELETE', '/departments/' + dA.id);
    ok('A4 team staff may not delete a department (403 — operations_config)', staffOnly.status === 403);
    var delA = await callAs(SA, 'DELETE', '/departments/' + dA.id);
    ok('A5 steps cleared → deleted outright; the row is gone', delA.status === 200 && delA.body.mode === 'delete' && !(await db.get('SELECT id FROM departments WHERE id = ?', [dA.id])), JSON.stringify(delA.body));

    // a department with history RETIRES instead of vanishing
    var dB = (await callAs(SA, 'POST', '/departments', { name: 'Removal Hist ' + TAG, code: 'RH' + TAG.slice(-3), kind: 'department' })).body.department; made.depts.push(dB.id);
    // a harness request, made through the real creation path, then CLOSED and owned by dB (a footprint, not a pipeline state under test)
    var madeReq = await RC.createRequest({ requestorName: 'RM Harness', requestorEmail: 'rm-' + TAG + '@example.com', description: 'org removal footprint ' + TAG }, { actorName: 'harness', kickIntake: false, startClocks: false });
    made.reqs.push(madeReq.parentId, madeReq.childId);
    await db.run("UPDATE requests SET stage = 'closed', record_owner_department_id = ? WHERE id IN (?, ?)", [dB.id, madeReq.parentId, madeReq.childId]);
    var anyClosed = { id: madeReq.parentId };
    var cB = await callAs(SA, 'GET', '/departments/' + dB.id + '/removal');
    ok('A6 a department a CLOSED request records: no step blocks it, but the outcome is RETIRE (kept on the record)', !!anyClosed && cB.body.canDelete === true && cB.body.mode === 'retire' && cB.body.keeps.some(function (k) { return k.code === 'closed_requests'; }), JSON.stringify(cB.body && { mode: cB.body.mode, keeps: cB.body.keeps }));
    var delB = await callAs(SA, 'DELETE', '/departments/' + dB.id);
    var rowB = await db.get('SELECT active, name FROM departments WHERE id = ?', [dB.id]);
    ok('A7 …DELETE retires it: row kept with its name, active = 0, off the department list', delB.status === 200 && delB.body.mode === 'retire' && rowB && Number(rowB.active) === 0 && !(await callAs(SA, 'GET', '/departments')).body.departments.some(function (d) { return d.id === dB.id; }));

    console.log('\n=== B. FULFILLMENT TEAM ===');
    var tA = (await callAs(SA, 'POST', '/departments', { name: 'Removal Team ' + TAG, code: 'RT' + TAG.slice(-3), kind: 'team' })).body.department; made.depts.push(tA.id);
    var dC = (await callAs(SA, 'POST', '/departments', { name: 'Served Dept ' + TAG, code: 'SD' + TAG.slice(-3), kind: 'department' })).body.department; made.depts.push(dC.id);
    await callAs(SA, 'POST', '/departments/' + tA.id + '/fulfills', { departmentIds: [dC.id] });
    var M1 = await mk('team_staff', tA.id); made.users.push(M1);
    var tid = 't-' + TAG; await db.run("INSERT INTO tasks (id, request_id, type, title, team_id, status) VALUES (?, NULL, 'record_search', 'rm harness', ?, 'open')", [tid, tA.id]); made.tasks.push(tid);
    var cT = await callAs(SA, 'GET', '/departments/' + tA.id + '/removal');
    ok('B1 a team that serves a department, has a member (with a team-scoped type) and an open pool task → four steps', codes(cT.body) === 'members,open_tasks,serves,team_types' && /Served Dept/.test(cT.body.blockers.filter(function (b) { return b.code === 'serves'; })[0].text), codes(cT.body));
    ok('B2 the team flagged as the Open Records hub\'s own carries that flag as a step (routing relies on it)', (await callAs(SA, 'GET', '/departments/' + (await db.get("SELECT id FROM departments WHERE kind = 'team' AND is_open_records = 1 LIMIT 1")).id + '/removal')).body.blockers.some(function (b) { return b.code === 'open_records_flag'; }));
    await callAs(SA, 'POST', '/departments/' + tA.id + '/fulfills', { departmentIds: [] });
    await db.run("UPDATE tasks SET status = 'completed' WHERE id = ?", [tid]);
    await ut.revokeAll(M1); await db.run('UPDATE users SET department_id = NULL WHERE id = ?', [M1]);
    var cT2 = await callAs(SA, 'GET', '/departments/' + tA.id + '/removal');
    ok('B3 served department re-pointed, task finished, member moved and un-typed → clear; the finished task keeps it on the record (RETIRE)', cT2.body.canDelete === true && cT2.body.mode === 'retire' && cT2.body.keeps.some(function (k) { return k.code === 'finished_tasks'; }), JSON.stringify(cT2.body && { blockers: cT2.body.blockers, mode: cT2.body.mode }));
    var delT = await callAs(SA, 'DELETE', '/departments/' + tA.id);
    ok('B4 …retired: active = 0, no longer offered as a team', delT.status === 200 && Number((await db.get('SELECT active FROM departments WHERE id = ?', [tA.id])).active) === 0);
    await db.run('DELETE FROM tasks WHERE id = ?', [tid]);
    var delC = await callAs(SA, 'DELETE', '/departments/' + dC.id);
    ok('B5 the served department, now unserved and unreferenced, deletes outright', delC.status === 200 && delC.body.mode === 'delete');

    console.log('\n=== C. STAFF ===');
    var P = await mk('team_staff', 'team-police'); made.users.push(P);
    var cP = await callAs(SA, 'GET', '/staff/' + P + '/removal');
    var actStep = cP.body && (cP.body.blockers || []).filter(function (b) { return b.code === 'active'; })[0];
    ok('C1 an ACTIVE person: the first step is to deactivate, offered as an inline action', cP.status === 200 && codes(cP.body) === 'active' && actStep && actStep.where && actStep.where.action && actStep.where.action.path === '/staff/' + P + '/status', cP.status + ' ' + JSON.stringify(cP.body));
    var self = await callAs(SA, 'GET', '/staff/' + SA + '/removal');
    ok('C2 nobody may delete their own account', self.body.blockers.some(function (b) { return b.code === 'self'; }));
    var t2 = 't2-' + TAG; await db.run("INSERT INTO tasks (id, request_id, type, title, team_id, status, assigned_to) VALUES (?, NULL, 'record_search', 'rm harness', 'team-police', 'assigned', ?)", [t2, P]); made.tasks.push(t2);
    await callAs(SA, 'PATCH', '/staff/' + P + '/status', { status: 'inactive' });
    var cP2 = await callAs(SA, 'GET', '/staff/' + P + '/removal');
    ok('C3 deactivated, but an open task is still assigned → that is the remaining step', codes(cP2.body) === 'open_tasks' && cP2.body.blockers[0].count === 1, codes(cP2.body));
    var opsOnly = await callAs(STAFF, 'DELETE', '/staff/' + P);
    ok('C4 deleting a person needs manage_users (team staff: 403)', opsOnly.status === 403);
    await db.run('DELETE FROM tasks WHERE id = ?', [t2]);
    var delP = await callAs(SA, 'DELETE', '/staff/' + P);
    ok('C5 no footprint → deleted outright; user row and user types gone', delP.status === 200 && delP.body.mode === 'delete' && !(await db.get('SELECT id FROM users WHERE id = ?', [P])) && !(await db.get('SELECT 1 FROM user_user_types WHERE user_id = ?', [P])));

    // a person with history RETIRES: hidden, cannot sign in, holds nothing
    var Q = await mk('team_staff', 'team-police', 'inactive'); made.users.push(Q);
    var hid = 'h-' + TAG; var anyReq = await db.get('SELECT id FROM requests ORDER BY created_at DESC LIMIT 1');
    await db.run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action) VALUES (?, ?, ?, 'RM Q', 'rm harness')", [hid, anyReq.id, Q]); made.hist.push(hid);
    await db.run('INSERT INTO user_task_types (user_id, task_type) VALUES (?, ?)', [Q, 'record_search']);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [require('crypto').createHash('sha256').update('pw').digest('hex'), Q]);
    var cQ = await callAs(SA, 'GET', '/staff/' + Q + '/removal');
    ok('C6 history names the person → no step blocks, outcome RETIRE', cQ.body.canDelete === true && cQ.body.mode === 'retire' && cQ.body.keeps.some(function (k) { return k.code === 'history'; }), JSON.stringify(cQ.body && { blockers: cQ.body.blockers, keeps: cQ.body.keeps }));
    var delQ = await callAs(SA, 'DELETE', '/staff/' + Q);
    var rowQ = await db.get('SELECT status, department_id FROM users WHERE id = ?', [Q]);
    ok('C7 …retired: status removed, row kept, types and task subset stripped, home team cleared', delQ.status === 200 && delQ.body.mode === 'retire' && rowQ && rowQ.status === 'removed' && rowQ.department_id === null && !(await db.get('SELECT 1 FROM user_user_types WHERE user_id = ?', [Q])) && !(await db.get('SELECT 1 FROM user_task_types WHERE user_id = ?', [Q])));
    ok('C8 …off the staff list', !(await callAs(SA, 'GET', '/staff')).body.staff.some(function (s) { return s.id === Q; }));
    var login = await auth.localLogin(Q + '@test.optimumq.ai', 'pw');
    ok('C9 …and a removed account cannot sign in (login refuses anything but active)', login && login.code === 401);
    var histRow = await db.get('SELECT actor_name FROM request_history WHERE id = ?', [hid]);
    ok('C10 the history entry keeps its name', histRow && histRow.actor_name === 'RM Q');

    // the last account that can manage users is protected
    var holders = await db.all("SELECT DISTINCT u.id FROM users u JOIN user_user_types uut ON uut.user_id = u.id JOIN user_type_authority a ON a.user_type_id = uut.user_type_id WHERE a.authority_key = 'manage_users' AND u.status = 'active' AND u.id <> ?", [SA]);
    var ids = holders.map(function (h) { return h.id; });
    if (ids.length) await db.run("UPDATE users SET status = 'inactive' WHERE id IN (" + ids.map(function () { return '?'; }).join(',') + ")", ids);
    var SA2 = await mk('oro_director', null, 'inactive'); made.users.push(SA2);   // another holder, but INACTIVE — does not count
    var cLast = await callAs(SA, 'GET', '/staff/' + SA2 + '/removal');
    var lastOk = !cLast.body.blockers.some(function (b) { return b.code === 'last_manager'; });
    await db.run("UPDATE users SET status = 'active' WHERE id = ?", [SA]);
    var selfLast = await callAs(SA, 'GET', '/staff/' + SA + '/removal');
    if (ids.length) await db.run("UPDATE users SET status = 'active' WHERE id IN (" + ids.map(function () { return '?'; }).join(',') + ")", ids);
    ok('C11 with every other manager inactive, the last ACTIVE manage_users account is a named step (and an inactive holder does not count as cover)', lastOk && selfLast.body.blockers.some(function (b) { return b.code === 'last_manager'; }), codes(selfLast.body));
    var afterRestore = await callAs(SA, 'GET', '/staff/' + SA + '/removal');
    ok('C12 …and once another manager is active again, that step is gone', !afterRestore.body.blockers.some(function (b) { return b.code === 'last_manager'; }));
  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack); fail++;
  } finally {
    for (var h of made.hist) await db.run('DELETE FROM request_history WHERE id = ?', [h]);
    if (made.reqs.length) {
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id' AND table_schema='public'");
      for (var ti = 0; ti < tabs.length; ti++) for (var ri = 0; ri < made.reqs.length; ri++) { try { await db.run('DELETE FROM ' + tabs[ti].table_name + ' WHERE request_id = ?', [made.reqs[ri]]); } catch (e) {} }
      for (var ri2 = 0; ri2 < made.reqs.length; ri2++) { try { await db.run('DELETE FROM requests WHERE id = ?', [made.reqs[ri2]]); } catch (e) {} }
    }
    for (var t of made.tasks) await db.run('DELETE FROM tasks WHERE id = ?', [t]);
    for (var r of made.rt) await db.run('DELETE FROM record_type_departments WHERE id = ?', [r]);
    for (var u of made.users) { await db.run('DELETE FROM user_user_types WHERE user_id = ?', [u]); await db.run('DELETE FROM user_task_types WHERE user_id = ?', [u]); await db.run('DELETE FROM notifications WHERE user_id = ?', [u]); await db.run('DELETE FROM users WHERE id = ?', [u]); }
    for (var d of made.depts) await db.run('DELETE FROM departments WHERE id = ?', [d]);
    await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id IN ('departments','teams','staff') AND created_at >= ?", [new Date(Date.now() - 600000).toISOString().slice(0, 19).replace('T', ' ')]);
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
