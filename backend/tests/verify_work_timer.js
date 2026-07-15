'use strict';
// WORK TIMER — actual labor capture (Slice D). The active-work timer heartbeats its running total (stored
// MONOTONICALLY so a racey beat can't lower it), then finalizes at completion — accepted, or adjusted with a
// REQUIRED reason, keeping the raw measurement for defensibility. Actual labor, separate from the calendar clocks.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var PORT = Number(process.env.API_PORT) || 3101, TAG = 'WT-' + Date.now();
async function token(id) { var u = await db.get('SELECT * FROM users WHERE id = ?', [id]); return u ? await auth.signAccessToken(u) : null; }
async function api(method, path, tok, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: Object.assign(tok ? { Authorization: 'Bearer ' + tok } : {}, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
}
async function newTask(reqSuffix, owner) {
  var rid = 'req-' + TAG + '-' + reqSuffix;
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?, 'redaction','active') ON CONFLICT (id) DO NOTHING", [rid, rid, 'x', 'x@x', 'wt']);
  var t = await tr.createTask({ type: 'redaction', requestId: rid, createdBy: 'test' });
  await tr.assign(t.id, owner, 'manual');
  return t.id;
}
async function work(id) { return await db.get('SELECT work_seconds, work_measured_seconds, work_adjust_reason, work_finalized FROM tasks WHERE id = ?', [id]); }

(async function () {
  await db.initDb();
  var U = 'u-police-staff', V = 'u-legal-super';
  var tU = await token(U), tV = await token(V);

  console.log('\n=== A. HEARTBEAT — monotonic (a stale/racey beat can never lower it) ===');
  var t1 = await newTask('a', U);
  await api('POST', '/tasks/' + t1 + '/work', tU, { seconds: 100 });
  ok('A1 first beat records the running total', (await work(t1)).work_seconds === 100);
  await api('POST', '/tasks/' + t1 + '/work', tU, { seconds: 50 });
  ok('A2 a lower (stale) beat does NOT reduce it', (await work(t1)).work_seconds === 100);
  await api('POST', '/tasks/' + t1 + '/work', tU, { seconds: 250 });
  ok('A3 a higher beat advances it', (await work(t1)).work_seconds === 250);

  console.log('\n=== B. FINALIZE — accept the measured time ===');
  var fin = await api('POST', '/tasks/' + t1 + '/work/finalize', tU, { seconds: 260 });
  var w1 = await work(t1);
  ok('B1 finalize accepts the measured time and freezes it', fin.status === 200 && w1.work_finalized === 1 && w1.work_seconds === 260 && w1.work_measured_seconds === 260 && !w1.work_adjust_reason);
  await api('POST', '/tasks/' + t1 + '/work', tU, { seconds: 999 });
  ok('B2 heartbeats after finalize are ignored', (await work(t1)).work_seconds === 260);

  console.log('\n=== C. FINALIZE — adjust (a reason is required; the measurement is kept) ===');
  var t2 = await newTask('c', U);
  await api('POST', '/tasks/' + t2 + '/work', tU, { seconds: 300 }); // measured 5m
  var noReason = await api('POST', '/tasks/' + t2 + '/work/finalize', tU, { seconds: 300, adjustedSeconds: 660 });
  ok('C1 adjusting WITHOUT a reason is refused (400)', noReason.status === 400);
  ok('C2 …and the task is not finalized', (await work(t2)).work_finalized !== 1);
  var adj = await api('POST', '/tasks/' + t2 + '/work/finalize', tU, { seconds: 300, adjustedSeconds: 660, reason: 'Also ~6 min on a phone call the timer missed.' });
  var w2 = await work(t2);
  ok('C3 with a reason it adjusts: actual = 660, measured kept = 300, reason recorded', adj.status === 200 && w2.work_seconds === 660 && w2.work_measured_seconds === 300 && /phone call/.test(w2.work_adjust_reason) && w2.work_finalized === 1);

  console.log('\n=== D. ONLY THE ASSIGNEE MAY LOG TIME ===');
  var t3 = await newTask('d', U);
  await api('POST', '/tasks/' + t3 + '/work', tU, { seconds: 120 });
  ok('D1 a non-owner cannot finalize (403)', (await api('POST', '/tasks/' + t3 + '/work/finalize', tV, { seconds: 120 })).status === 403);
  ok('D2 …and it stays un-finalized', (await work(t3)).work_finalized !== 1);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
