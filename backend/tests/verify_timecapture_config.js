'use strict';
// TIME-CAPTURE VISIBILITY CONFIG (Slice E · Fork 1). The city owns, per task UI, whether staff SEE the labor
// timer and are asked to confirm their time on finish: off | discretion | always. Time is always measured in the
// background; this only gates visibility + the finalize flow. Plus the SKIP finalize path (discretion / off):
// keep the raw measurement for audit but leave work_seconds NULL so nothing billable flows to reconciliation.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var PORT = Number(process.env.API_PORT) || 3101, TAG = 'TC-' + Date.now();
async function token(id) { var u = await db.get('SELECT * FROM users WHERE id = ?', [id]); return u ? await auth.signAccessToken(u) : null; }
async function api(method, path, tok, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: Object.assign(tok ? { Authorization: 'Bearer ' + tok } : {}, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
}
async function newTask(reqSuffix, owner) {
  var rid = 'req-' + TAG + '-' + reqSuffix;
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?, 'redaction','active') ON CONFLICT (id) DO NOTHING", [rid, rid, 'x', 'x@x', 'tc']);
  var t = await tr.createTask({ type: 'redaction', requestId: rid, createdBy: 'test' });
  await tr.assign(t.id, owner, 'manual');
  return t.id;
}
async function work(id) { return await db.get('SELECT work_seconds, work_measured_seconds, work_adjust_reason, work_finalized FROM tasks WHERE id = ?', [id]); }

(async function () {
  await db.initDb();
  var ADMIN = 'u-kruss', STAFF = 'u-police-staff';
  var tA = await token(ADMIN), tS = await token(STAFF);

  console.log('\n=== A. DEFAULT — nothing appears until the city opts in (all off) ===');
  var g0 = await api('GET', '/config/time-capture', tS);
  var c0 = g0.body && g0.body.config;
  ok('A1 GET is readable by ordinary staff (200)', g0.status === 200 && !!c0);
  ok('A2 every UI defaults to off', c0 && ['search', 'estimate', 'legal_redaction', 'mrr', 'legal'].every(function (k) { return c0[k] === 'off'; }));
  var uis = (g0.body && g0.body.uis) || [];
  ok('A3 built UIs marked available, unbuilt (mrr/legal) not', uis.length === 5 &&
    uis.filter(function (u) { return u.available; }).map(function (u) { return u.key; }).sort().join(',') === 'estimate,legal_redaction,search' &&
    uis.filter(function (u) { return !u.available; }).map(function (u) { return u.key; }).sort().join(',') === 'legal,mrr');

  console.log('\n=== B. SAVE — valid modes stick; junk is sanitized; partials MERGE ===');
  var put1 = await api('PUT', '/config/time-capture', tA, { config: { search: 'always', estimate: 'discretion', legal: 'always', mrr: 'nonsense', bogus_key: 'always' } });
  var c1 = put1.body && put1.body.config;
  ok('B1 admin can save (200)', put1.status === 200 && !!c1);
  ok('B2 valid modes are stored', c1 && c1.search === 'always' && c1.estimate === 'discretion' && c1.legal === 'always');
  ok('B3 an invalid mode falls back to off', c1 && c1.mrr === 'off');
  ok('B4 an unknown UI key is dropped', c1 && c1.bogus_key === undefined);
  var put2 = await api('PUT', '/config/time-capture', tA, { config: { search: 'off' } });
  var c2 = put2.body && put2.body.config;
  ok('B5 a partial update merges (search off, estimate KEPT at discretion)', c2 && c2.search === 'off' && c2.estimate === 'discretion');

  console.log('\n=== C. ROLE GATE — only admins/directors may change it ===');
  var putStaff = await api('PUT', '/config/time-capture', tS, { config: { search: 'always' } });
  ok('C1 ordinary staff cannot save (403)', putStaff.status === 403);
  ok('C2 …and the setting is unchanged', ((await api('GET', '/config/time-capture', tS)).body.config || {}).search === 'off');

  console.log('\n=== D. SKIP FINALIZE — raw kept for audit, nothing billable (work_seconds NULL) ===');
  var t1 = await newTask('skip', STAFF);
  await api('POST', '/tasks/' + t1 + '/work', tS, { seconds: 180 });
  var sk = await api('POST', '/tasks/' + t1 + '/work/finalize', tS, { skipped: true });
  var w1 = await work(t1);
  ok('D1 skip finalizes with NO billable time (work_seconds NULL), raw measured kept, reason recorded',
    sk.status === 200 && sk.body.skipped === true && w1.work_finalized === 1 && w1.work_seconds === null && w1.work_measured_seconds === 180 && /skipped/.test(w1.work_adjust_reason || ''));
  await api('POST', '/tasks/' + t1 + '/work', tS, { seconds: 999 });
  ok('D2 heartbeats after a skip are ignored (stays finalized, still no billable time)', (await work(t1)).work_seconds === null);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
