'use strict';
// PER-REQUEST ACT GATE — routes/clocks.js + routes/dispositions.js (2026-08-19), the follow-on to
// verify_request_acts. The statutory clock and the release hold are the citizen's request; touching them
// was requireAuth-only. Now: clocks start / toll / resume / extend / satisfy, and dispositions
// withdrawal-communication / hold / lift / installment-request take requireRequestAct → requestAccess
// (acting role OR act permission OR the work is yours). Clock-addressed routes resolve clock → request
// first; an unknown clock passes through to tolling's own error. Unchanged: the two manual endings (BW5's
// manualEndingRights), the Director-only knobs, all reads.
//
// PASS-THROUGH PROBES WRITE NOTHING: extend days:0 → 400 before any write; withdrawal with an empty body
// → 422 BODY_REQUIRED; hold with no note → 422 NOTE_REQUIRED; lift on an unheld request → 409 NOT_HELD;
// toll/resume/satisfy positive cases use a NONEXISTENT clock (500 "Clock not found" from tolling).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var UT = require(__dirname + '/userTypeHelpers');
var auth = require('/opt/optimumq/backend/src/services/auth');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'CD' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function call(token, method, path2, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path2, {
    method: method,
    headers: Object.assign(token ? { Authorization: 'Bearer ' + token } : {}, { 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
function gated(r) { return r.status === 403; }
function through(r) { return r.status !== 403 && r.status !== 401; }

var U = {
  none: 'u-cd-none-' + TAG,      // no roles
  reqmgr: 'u-cd-reqmgr-' + TAG,  // REQUEST_MANAGER perm
  search: 'u-cd-search-' + TAG,  // SEARCH_AND_TRIAGE perm (not a clock perm)
  legal: 'u-cd-legal-' + TAG,    // ATTORNEY_REVIEWER role
  super: 'u-cd-super-' + TAG,    // SUPERVISOR role
  holder: 'u-cd-holder-' + TAG   // no roles; holds an open task on the fixture
};

(async function () {
  await db.initDb();
  for (var k in U) {
    await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [U[k], k + '-' + TAG + '@test.optimumq.ai', 'CD ' + k, 'Test ' + TAG]);
  }
  // v3 user types (legacy claims derive from them): oro_associate mints REQUEST_MANAGER, team_staff SEARCH_AND_TRIAGE, ...
  await UT.grantLegacy(U.reqmgr, 'pr-reqmgr');
  await UT.grantLegacy(U.search, 'pr-searchtriage', 'team-police');
  await UT.grantLegacy(U.legal, 'fr-attorney');
  await UT.grantLegacy(U.super, 'fr-supervisor');
  var T = {};
  for (var k2 in U) T[k2] = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [U[k2]]));

  var made = await RC.createRequest(
    { requestorName: 'CD Fixture', requestorEmail: 'cd-' + TAG + '@test.optimumq.ai', description: 'CD fixture ' + TAG, deliveryMethod: 'email' },
    { actorId: 'test', actorName: 'Test', historyAction: 'CREATED', kickIntake: false, sendConfirmation: false });
  var P = made.parentId, C = made.childId;
  var clk = await db.get('SELECT id FROM request_clocks WHERE request_id = ? ORDER BY is_primary DESC, created_at LIMIT 1', [P]);
  ok('F0 fixture: parent has a clock', !!clk);
  var task = await tr.createTask({ requestId: C, type: 'record_search', title: 'CD search', createdBy: 'test' });
  await db.run("UPDATE tasks SET assigned_to = ?, status = 'assigned' WHERE id = ?", [U.holder, task.id]);
  var NX = 'cd-nonexistent-' + TAG;

  console.log('\n=== A. CLOCKS — start / toll / resume / extend / satisfy ===');
  ok('A1 start clocks: no-role 403 on a real request', gated(await call(T.none, 'POST', '/clocks/request/' + P + '/start')));
  ok('A2 start clocks: nonexistent request → passes through (not 403)', through(await call(T.none, 'POST', '/clocks/request/' + NX + '/start')));
  ok('A3 start a specific clock: no-role 403', gated(await call(T.none, 'POST', '/clocks/request/' + P + '/clock', { type: 'x' })));
  ok('A4 toll: no-role 403 on the fixture’s real clock', gated(await call(T.none, 'POST', '/clocks/' + clk.id + '/toll', { reason: 'x' })));
  ok('A5 toll: searcher 403 (SEARCH_AND_TRIAGE is not a clock permission, and not their work)', gated(await call(T.search, 'POST', '/clocks/' + clk.id + '/toll', { reason: 'x' })));
  ok('A6 toll: unknown clock → passes through to tolling’s own error (not 403)', through(await call(T.none, 'POST', '/clocks/' + NX + '/toll', { reason: 'x' })));
  ok('A7 resume: no-role 403', gated(await call(T.none, 'POST', '/clocks/' + clk.id + '/resume', {})));
  ok('A8 satisfy: no-role 403', gated(await call(T.none, 'POST', '/clocks/' + clk.id + '/satisfy')));
  ok('A9 extend: no-role 403', gated(await call(T.none, 'POST', '/clocks/' + clk.id + '/extend', { days: 0 })));
  var ex;
  ex = await call(T.reqmgr, 'POST', '/clocks/' + clk.id + '/extend', { days: 0 });
  ok('A10 extend: REQUEST_MANAGER passes the gate (400: positive days required — nothing written)', ex.status === 400 && /positive number/.test((ex.body && ex.body.error) || ''));
  ex = await call(T.legal, 'POST', '/clocks/' + clk.id + '/extend', { days: 0 });
  ok('A11 extend: ATTORNEY_REVIEWER passes the gate', ex.status === 400);
  ex = await call(T.super, 'POST', '/clocks/' + clk.id + '/extend', { days: 0 });
  ok('A12 extend: SUPERVISOR passes the gate', ex.status === 400);
  ex = await call(T.holder, 'POST', '/clocks/' + clk.id + '/extend', { days: 0 });
  ok('A13 extend: holder of an open task on the CHILD acts on the PARENT’s clock (cluster walk)', ex.status === 400);
  ok('A14 satisfy: REQUEST_MANAGER passes (unknown clock → through)', through(await call(T.reqmgr, 'POST', '/clocks/' + NX + '/satisfy')));
  ok('A15 clock reads stay open (statusForRequest 200)', (await call(T.none, 'GET', '/clocks/request/' + P)).status === 200);
  ok('A16 extensions read stays open', (await call(T.none, 'GET', '/clocks/' + clk.id + '/extensions')).status === 200);

  console.log('\n=== B. DISPOSITIONS — withdrawal / hold / lift / installment ===');
  ok('B1 withdrawal communication: no-role 403', gated(await call(T.none, 'POST', '/dispositions/' + C + '/withdrawal-communication', { body: 'x' })));
  var wd = await call(T.reqmgr, 'POST', '/dispositions/' + C + '/withdrawal-communication', {});
  ok('B2 withdrawal communication: REQUEST_MANAGER passes (422 BODY_REQUIRED — nothing written)', wd.status === 422 && wd.body && wd.body.code === 'BODY_REQUIRED');
  ok('B3 withdrawal communication: task holder passes', (await call(T.holder, 'POST', '/dispositions/' + C + '/withdrawal-communication', {})).status === 422);
  ok('B4 place hold: no-role 403', gated(await call(T.none, 'POST', '/dispositions/' + C + '/hold', { note: 'x' })));
  ok('B5 place hold: searcher 403 (not RM/delivery, not their work)', gated(await call(T.search, 'POST', '/dispositions/' + C + '/hold', { note: 'x' })));
  var hd = await call(T.reqmgr, 'POST', '/dispositions/' + C + '/hold', {});
  ok('B6 place hold: REQUEST_MANAGER passes (422 NOTE_REQUIRED — nothing written)', hd.status === 422 && hd.body && hd.body.code === 'NOTE_REQUIRED');
  ok('B7 lift hold: no-role 403', gated(await call(T.none, 'DELETE', '/dispositions/' + C + '/hold')));
  var lf = await call(T.super, 'DELETE', '/dispositions/' + C + '/hold');
  ok('B8 lift hold: SUPERVISOR passes (409 NOT_HELD — nothing written)', lf.status === 409 && lf.body && lf.body.code === 'NOT_HELD');
  ok('B9 installment request: no-role 403', gated(await call(T.none, 'POST', '/dispositions/' + C + '/installment-request', {})));
  ok('B10 installment request: nonexistent → through (404)', (await call(T.none, 'POST', '/dispositions/' + NX + '/installment-request', {})).status === 404);
  ok('B11 disposition record read stays open', (await call(T.none, 'GET', '/dispositions/' + C)).status === 200);
  ok('B12 knobs keep their Director bar (REQUEST_MANAGER 403 DIRECTOR_REQUIRED)', (await call(T.reqmgr, 'PUT', '/dispositions/knobs/auto_release', {})).body.code === 'DIRECTOR_REQUIRED');
  var cl = await call(T.none, 'POST', '/dispositions/' + C + '/close/withdrawn', {});
  ok('B13 manual endings keep BW5’s own rights (no-role 403 NOT_PERMITTED, not NOT_YOUR_REQUEST)', cl.status === 403 && cl.body && cl.body.code === 'NOT_PERMITTED');
  ok('B14 no token → 401 before any gate', (await call(null, 'POST', '/clocks/' + clk.id + '/toll', {})).status === 401);

  console.log('\n=== C. NOTHING MOVED ===');
  var st = await db.get('SELECT status FROM request_clocks WHERE id = ?', [clk.id]);
  ok('C1 the fixture clock is still running (no toll/satisfy landed)', st && st.status === 'running');
  ok('C2 no extension recorded', Number((await db.get('SELECT count(*)::int n FROM clock_extensions WHERE clock_id = ?', [clk.id])).n) === 0);
  ok('C3 no hold placed', Number((await db.get('SELECT COALESCE(release_hold,0)::int h FROM requests WHERE id = ?', [C])).h) === 0);
  ok('C4 no history beyond creation', Number((await db.get("SELECT count(*)::int n FROM request_history WHERE request_id IN (?, ?) AND action NOT IN ('CREATED','RECORDS_SELECTED')", [P, C])).n) === 0);

  console.log('\n=== D. CLEANUP ===');
  var ids = Object.keys(U).map(function (k) { return U[k]; });
  var ph = ids.map(function () { return '?'; }).join(',');
  await UT.revokeAll(ids);
  await db.run('DELETE FROM users WHERE id IN (' + ph + ')', ids);
  var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
  for (var ti = 0; ti < tabs.length; ti++) for (var rid of [P, C]) {
    try { await db.run('DELETE FROM ' + tabs[ti].table_name + ' WHERE request_id = ?', [rid]); } catch (e) {}
  }
  await db.run('DELETE FROM requests WHERE master_request_id = ?', [P]);
  await db.run('DELETE FROM requests WHERE id = ?', [P]);
  ok('D1 fixture users and requests are gone',
    Number((await db.get("SELECT count(*)::int n FROM users WHERE title = 'Test ' || ?", [TAG])).n) === 0 &&
    Number((await db.get('SELECT count(*)::int n FROM requests WHERE id IN (?,?)', [P, C])).n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
