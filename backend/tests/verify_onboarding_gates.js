'use strict';
// SETUP (onboarding.js) ROLE GATE + AG-RULING OUTCOME VALIDATION (2026-08-19).
//   onboarding: reviewer assign / request-review / status patch → SYSTEM_ADMIN or DIRECTOR (setup is system
//   configuration); fees/test-result → the same OR the Fees phase's DESIGNATED reviewer (they run the sandbox
//   test before they may approve); /approve keeps its own decided authority (designated reviewer or admin);
//   reads open. Previously all requireAuth-only.
//   ag-ruling: `outcome` is REQUIRED (sustained | partial | overruled). It used to default to 'sustained', so
//   an empty POST recorded a real ruling (HANDOFF 2026-08-18 (b) incident).
//
// PROBES WRITE NOTHING that outlives the harness: onboarding rows are restored to their pre-run values;
// the ag-ruling probes use a two-child parent (409 AMBIGUOUS before the outcome check) and a single-record
// request with a MISSING/INVALID outcome (400 before any write).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var UT = require(__dirname + '/userTypeHelpers');
var auth = require('/opt/optimumq/backend/src/services/auth');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'OB' + Date.now();
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

var U = { none: 'u-ob-none-' + TAG, super: 'u-ob-super-' + TAG, dir: 'u-ob-dir-' + TAG, reviewer: 'u-ob-rev-' + TAG, legal: 'u-ob-legal-' + TAG };

(async function () {
  await db.initDb();
  for (var k in U) {
    await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [U[k], k + '-' + TAG + '@test.optimumq.ai', 'OB ' + k, 'Test ' + TAG]);
  }
  await UT.grantLegacy(U.super, 'fr-supervisor');
  await UT.grantLegacy(U.dir, 'fr-director');
  await UT.grantLegacy(U.legal, 'fr-attorney');
  var T = {};
  for (var k2 in U) T[k2] = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [U[k2]]));
  T.admin = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));

  // Snapshot the two phases the probes touch, to restore exactly.
  var before = {};
  for (var ph of ['fees', 'departments']) before[ph] = await db.get('SELECT * FROM onboarding_progress WHERE phase_key = ?', [ph]);
  ok('F0 fixture: fees + departments phases exist', !!before.fees && !!before.departments);
  var NX = 'ob-nonexistent-' + TAG;

  console.log('\n=== A. SETUP WRITES — SYSTEM_ADMIN / DIRECTOR ===');
  ok('A1 assign reviewer: no-role 403', gated(await call(T.none, 'PATCH', '/onboarding/fees/reviewer', { reviewerId: null })));
  ok('A2 assign reviewer: SUPERVISOR 403 (setup is not an oversight act)', gated(await call(T.super, 'PATCH', '/onboarding/fees/reviewer', { reviewerId: null })));
  ok('A3 assign reviewer: DIRECTOR passes (404 on an unknown phase — nothing written)', (await call(T.dir, 'PATCH', '/onboarding/' + NX + '/reviewer', { reviewerId: null })).status === 404);
  ok('A4 assign reviewer: SYSTEM_ADMIN passes', (await call(T.admin, 'PATCH', '/onboarding/' + NX + '/reviewer', { reviewerId: null })).status === 404);
  ok('A5 request review: no-role 403', gated(await call(T.none, 'POST', '/onboarding/fees/request-review')));
  ok('A6 request review: DIRECTOR passes (400: no reviewer with an email yet — nothing sent)', (await call(T.dir, 'POST', '/onboarding/departments/request-review')).status === 400);
  ok('A7 status patch: no-role 403', gated(await call(T.none, 'PATCH', '/onboarding/departments', { status: 'in_progress' })));
  ok('A8 status patch: SUPERVISOR 403', gated(await call(T.super, 'PATCH', '/onboarding/departments', { status: 'in_progress' })));
  ok('A9 status patch: DIRECTOR passes (400 on an invalid status — nothing written)', (await call(T.dir, 'PATCH', '/onboarding/departments', { status: 'bogus' })).status === 400);
  ok('A10 progress read stays open (200)', (await call(T.none, 'GET', '/onboarding')).status === 200);
  ok('A11 no token → 401', (await call(null, 'PATCH', '/onboarding/departments', { status: 'in_progress' })).status === 401);

  console.log('\n=== B. FEE-TEST OUTCOME — admin/director OR the designated Fees reviewer ===');
  ok('B1 test-result: no-role 403', gated(await call(T.none, 'POST', '/onboarding/fees/test-result', { outcome: 'confirmed' })));
  ok('B2 test-result: not-yet-designated reviewer 403', gated(await call(T.reviewer, 'POST', '/onboarding/fees/test-result', { outcome: 'confirmed' })));
  ok('B3 test-result: DIRECTOR passes the gate (400 on a bad outcome — nothing written)', (await call(T.dir, 'POST', '/onboarding/fees/test-result', { outcome: 'bogus' })).status === 400);
  await db.run('UPDATE onboarding_progress SET reviewer_id = ? WHERE phase_key = ?', [U.reviewer, 'fees']);
  ok('B4 test-result: the DESIGNATED Fees reviewer passes the gate (400 on a bad outcome)', (await call(T.reviewer, 'POST', '/onboarding/fees/test-result', { outcome: 'bogus' })).status === 400);
  ok('B5 ...but that reviewer still cannot ASSIGN reviewers (403)', gated(await call(T.reviewer, 'PATCH', '/onboarding/fees/reviewer', { reviewerId: null })));
  var ap = await call(T.reviewer, 'POST', '/onboarding/fees/approve');
  ok('B6 approve keeps its own authority: designated reviewer reaches it (400: fee test not confirmed — nothing written)', ap.status === 400 && /fee\/estimate test/i.test((ap.body && ap.body.error) || ''));
  ok('B7 approve: a stranger is still refused by the pre-existing check (403)', gated(await call(T.none, 'POST', '/onboarding/fees/approve')));

  console.log('\n=== C. AG RULING — outcome is REQUIRED ===');
  var r1 = await RC.createRequest(
    { requestorName: 'OB Fixture', requestorEmail: 'ob-' + TAG + '@test.optimumq.ai', description: 'OB single ' + TAG, deliveryMethod: 'email' },
    { actorId: 'test', actorName: 'Test', historyAction: 'CREATED', kickIntake: false, sendConfirmation: false });
  var P1 = r1.parentId, C1 = r1.childId;
  var e0 = await call(T.legal, 'POST', '/requests/' + P1 + '/ag-ruling', {});
  ok('C1 empty body → 400 OUTCOME_REQUIRED (was: recorded "sustained")', e0.status === 400 && e0.body && e0.body.code === 'OUTCOME_REQUIRED');
  var e1 = await call(T.legal, 'POST', '/requests/' + P1 + '/ag-ruling', { outcome: 'bogus' });
  ok('C2 unknown outcome → 400 OUTCOME_REQUIRED, lists the three', e1.status === 400 && Array.isArray(e1.body.outcomes) && e1.body.outcomes.length === 3);
  ok('C3 the record did not move (still intake, no AG_RULING_RECORDED row)',
    (await db.get('SELECT stage FROM requests WHERE id = ?', [C1])).stage === 'intake' &&
    Number((await db.get("SELECT count(*)::int n FROM request_history WHERE request_id = ? AND action = 'AG_RULING_RECORDED'", [C1])).n) === 0);
  ok('C4 the gate still answers first: no-role 403 before the outcome check', gated(await call(T.none, 'POST', '/requests/' + P1 + '/ag-ruling', {})));

  console.log('\n=== D. CLEANUP / RESTORE ===');
  for (var ph2 of ['fees', 'departments']) {
    var b = before[ph2];
    await db.run('UPDATE onboarding_progress SET reviewer_id = ?, status = ?, test_status = ?, test_by = ?, test_at = ?, test_notes = ?, test_config_ref = ?, review_requested_at = ?, updated_at = ? WHERE phase_key = ?',
      [b.reviewer_id, b.status, b.test_status, b.test_by, b.test_at, b.test_notes, b.test_config_ref, b.review_requested_at, b.updated_at, ph2]);
  }
  var after = await db.get('SELECT reviewer_id, status, test_status FROM onboarding_progress WHERE phase_key = ?', ['fees']);
  ok('D1 onboarding rows restored', after.reviewer_id === before.fees.reviewer_id && after.status === before.fees.status && after.test_status === before.fees.test_status);
  var ids = Object.keys(U).map(function (k) { return U[k]; });
  var ph3 = ids.map(function () { return '?'; }).join(',');
  await UT.revokeAll(ids);
  await db.run('DELETE FROM users WHERE id IN (' + ph3 + ')', ids);
  var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
  for (var ti = 0; ti < tabs.length; ti++) for (var rid of [P1, C1]) { try { await db.run('DELETE FROM ' + tabs[ti].table_name + ' WHERE request_id = ?', [rid]); } catch (e) {} }
  await db.run('DELETE FROM requests WHERE master_request_id = ?', [P1]);
  await db.run('DELETE FROM requests WHERE id = ?', [P1]);
  ok('D2 fixture users and request are gone',
    Number((await db.get("SELECT count(*)::int n FROM users WHERE title = 'Test ' || ?", [TAG])).n) === 0 &&
    Number((await db.get('SELECT count(*)::int n FROM requests WHERE id IN (?,?)', [P1, C1])).n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
