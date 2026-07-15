'use strict';
// RETURNED-FOR-REWORK — "your work came back" (BACKLOG R10, slice 8b).
//
// WHAT THIS PREVENTS: a reviewer sends a redaction back, but the AUTHOR is never told — their redaction task
// sits in My Tasks looking exactly as before, and the reviewer's reason is buried in request history. A
// returned redaction is the most time-critical item a redactor holds (a deadline runs, a release is blocked)
// and was the least visible. The fix: a general task `returned` FLAG (the task keeps its status + place in My
// Tasks, so it renders "URGENT CORRECTIONS REQUIRED") PLUS a push notification. Redaction returns are the first
// customer; fee-objection rejections use the notification alone (they aren't tasks).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'RR-' + Date.now();
async function token(id) { var u = await db.get('SELECT * FROM users WHERE id = ?', [id]); return u ? await auth.signAccessToken(u) : null; }
async function api(method, path, tok, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: Object.assign(tok ? { Authorization: 'Bearer ' + tok } : {}, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
}
async function noteFor(userId, contextId) { return await db.get("SELECT * FROM notifications WHERE user_id = ? AND kind = 'work_returned' AND context_id = ?", [userId, contextId]); }
async function mkRequest(id) { // tasks.request_id has a (nullable) FK to requests — the row must exist.
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?, 'redaction', 'active') ON CONFLICT (id) DO NOTHING",
    [id, id, 'Test Requestor', 'test@example.com', 'test request ' + TAG]);
}
async function mkTask(id, reqId, assignedTo) {
  await mkRequest(reqId);
  await db.run("INSERT INTO tasks (id, request_id, type, title, status, assigned_to, created_by) VALUES (?,?,?,?,?,?, 'test')",
    [id, reqId, 'redaction', 'Redact ' + TAG, 'assigned', assignedTo]);
}

(async function () {
  await db.initDb();
  var U = 'u-police-staff', REV = 'u-legal-super', APR = 'u-kruss';
  ok('S0 test users exist', !!(await db.get('SELECT id FROM users WHERE id = ?', [U])) && !!(await db.get('SELECT id FROM users WHERE id = ?', [APR])));

  console.log('\n=== A. THE GENERAL PRIMITIVE — markTaskReturned flags + pushes; clearReturned clears ===');
  var T = 't-' + TAG + '-a';
  await mkTask(T, 'req-' + TAG + '-a', U);
  await tr.markTaskReturned(T, { by: 'Sam Park', reason: 'Mask the minor at 04:12', link: '/redaction/' + T, title: 'A redaction you submitted was returned' });
  var row = await db.get('SELECT return_reason, returned_by, returned_at, status FROM tasks WHERE id = ?', [T]);
  ok('A1 the task is FLAGGED returned (reason + who + when), status unchanged', row && row.return_reason === 'Mask the minor at 04:12' && row.returned_by === 'Sam Park' && !!row.returned_at && row.status === 'assigned');
  ok('A2 a work_returned notification was pushed to the owner', !!(await noteFor(U, T)));
  var mineU = await api('GET', '/tasks/mine', await token(U));
  ok('A3 the flagged task still appears in the owner’s My Tasks, carrying the reason',
    (mineU.body.tasks || []).some(function (x) { return x.id === T && x.return_reason === 'Mask the minor at 04:12'; }));
  await tr.clearReturned(T);
  ok('A4 clearReturned wipes the flag (author re-submitted)', !(await db.get('SELECT return_reason FROM tasks WHERE id = ?', [T])).return_reason);
  var T0 = 't-' + TAG + '-un';
  await mkRequest('req-' + TAG + '-un');
  await db.run("INSERT INTO tasks (id, request_id, type, status, created_by) VALUES (?,?,?, 'open', 'test')", [T0, 'req-' + TAG + '-un', 'redaction']);
  await tr.markTaskReturned(T0, { by: 'X', reason: 'y' });
  ok('A5 an unassigned (pool) task is flagged but pushes no notification (no owner)',
    !!(await db.get('SELECT return_reason FROM tasks WHERE id = ?', [T0])).return_reason && !(await db.get("SELECT 1 FROM notifications WHERE context_id = ?", [T0])));

  console.log('\n=== B. REDACTION RETURN wires the primitive end-to-end ===');
  var reqB = 'req-' + TAG + '-b', T2 = 't-' + TAG + '-b', J = 'job-' + TAG;
  await mkTask(T2, reqB, U);
  await db.run("INSERT INTO redaction_jobs (id, file_id, request_id, review_stage, submitted_by, status) VALUES (?,?,?,?,?, 'draft')",
    [J, 'file-' + TAG, reqB, 'in_review', 'Marcus Bell']);
  var ret = await api('POST', '/redaction-jobs/jobs/' + J + '/return', await token(REV), { note: 'Redo the plate at 01:50' });
  ok('B1 the return endpoint accepts a reason', ret.status === 200);
  var t2 = await db.get('SELECT return_reason, returned_by FROM tasks WHERE id = ?', [T2]);
  ok('B2 the AUTHOR’s redaction task is now flagged with the reviewer’s note', t2 && t2.return_reason === 'Redo the plate at 01:50' && !!t2.returned_by);
  ok('B3 …and the author got a work_returned notification', !!(await noteFor(U, T2)));
  await api('POST', '/redaction-jobs/jobs/' + J + '/submit', await token(U));
  ok('B4 re-submitting the corrected work clears the returned flag', !(await db.get('SELECT return_reason FROM tasks WHERE id = ?', [T2])).return_reason);

  console.log('\n=== C. FEE-OBJECTION REJECTION uses the same "your work came back" push (no task) ===');
  var reqC = 'req-' + TAG + '-c', O = 'obj-' + TAG;
  await mkRequest(reqC);
  await db.run("INSERT INTO objections (id, request_id, status, reason, assignee_id, assignee_name, resolution_type, resolution_amount, approval_status, created_at) VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))",
    [O, reqC, 'tentative', 'Requestor disputes the copy count', U, 'Marcus Bell', 'reduction', 12.5, 'pending']);
  var rej = await api('POST', '/objections/' + O + '/approve', await token(APR), { decision: 'reject' });
  ok('C1 the reject is recorded', rej.status === 200);
  ok('C2 the objection owner got a work_returned notification (push only — objections aren’t tasks)', !!(await noteFor(U, O)));
  ok('C3 …of the objection kind', (await noteFor(U, O)).context_type === 'objection');

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
