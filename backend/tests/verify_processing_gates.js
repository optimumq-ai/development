'use strict';
// PROCESSING-SIDE ROLE-GATE SWEEP — follow-up to verify_processing_audit's mass-jobs gate: the rest
// of the processing surface was requireAuth-only. Now every redaction-work mutation (workspace jobs/
// zones/apply/QA, templates apply+stage, rules library, structured apply, AV, publish) takes the
// SHARED gate middleware/auth.requireRedactionWork (DIRECTOR/SUPERVISOR roles or REDACTION_WORKER/
// REDACTION_AUTHORITY perms; SYSTEM_ADMIN passes). Repository config takes SYSTEM_ADMIN/DIRECTOR
// (the redactionConfig EDIT precedent); ingest runs take the redaction gate. Deliberately unchanged:
// templates' stricter in-handler isElevated bar (create/edit/delete/dismiss/apply-batch), compute-only
// endpoints (match, preview), and ALL reads.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'PG' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function call(token, method, path2, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path2, {
    method: method,
    headers: Object.assign(token ? { Authorization: 'Bearer ' + token } : {}, { 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined
  });
  return r.status;
}
// The gate answers 403; anything else (404/400/500 on garbage fixtures) means the gate LET US THROUGH,
// which is what these "allowed" assertions test — functional coverage lives in the flow harnesses.
function gated(s) { return s === 403; }
function through(s) { return s !== 403 && s !== 401; }

(async function () {
  await db.initDb();
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", ['u-pg-none-' + TAG, 'pgn-' + TAG + '@test.optimumq.ai', 'PG NoRoles', 'Test ' + TAG]);
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", ['u-pg-red-' + TAG, 'pgr-' + TAG + '@test.optimumq.ai', 'PG Worker', 'Test ' + TAG]);
  await db.run("INSERT INTO user_permission_roles (user_id, permission_role_id) VALUES (?, 'pr-redworker')", ['u-pg-red-' + TAG]);
  var tNone = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', ['u-pg-none-' + TAG]));
  var tRed = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', ['u-pg-red-' + TAG]));
  var tAdmin = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var NX = 'pg-nonexistent-' + TAG;

  console.log('\n=== A. WORKSPACE + QA + PUBLISH — redaction work needs the redaction gate ===');
  ok('A1 create job: no-role 403', gated(await call(tNone, 'POST', '/redaction-jobs/file/' + NX + '/job')));
  ok('A2 create job: worker passes the gate', through(await call(tRed, 'POST', '/redaction-jobs/file/' + NX + '/job')));
  ok('A3 add zone: no-role 403', gated(await call(tNone, 'POST', '/redaction-jobs/jobs/' + NX + '/zones', {})));
  ok('A4 apply (burn): no-role 403', gated(await call(tNone, 'POST', '/redaction-jobs/jobs/' + NX + '/apply')));
  ok('A5 submit for review: no-role 403', gated(await call(tNone, 'POST', '/redaction-jobs/jobs/' + NX + '/submit')));
  ok('A6 return from review: no-role 403', gated(await call(tNone, 'POST', '/redaction-jobs/jobs/' + NX + '/return', { note: 'x' })));
  ok('A7 publish a released record: no-role 403', gated(await call(tNone, 'POST', '/redaction-jobs/released/' + NX + '/publish')));
  ok('A8 publish: worker passes the gate', through(await call(tRed, 'POST', '/redaction-jobs/released/' + NX + '/publish')));

  console.log('\n=== B. TEMPLATES — new gate only where nothing stood; the stricter elevated bar unchanged ===');
  ok('B1 single apply: no-role 403', gated(await call(tNone, 'POST', '/redaction-templates/' + NX + '/apply', {})));
  ok('B2 single apply: worker passes the gate', through(await call(tRed, 'POST', '/redaction-templates/' + NX + '/apply', {})));
  ok('B3 stage zones: no-role 403', gated(await call(tNone, 'POST', '/redaction-templates/' + NX + '/stage', {})));
  ok('B4 create template: worker still 403 (isElevated bar unchanged — supervisors only)', gated(await call(tRed, 'POST', '/redaction-templates', { name: 'x' })));
  ok('B5 match stays open (compute-only)', through(await call(tNone, 'POST', '/redaction-templates/match', {})));

  console.log('\n=== C. RULES LIBRARY + STRUCTURED + AV ===');
  ok('C1 create rule: no-role 403', gated(await call(tNone, 'POST', '/redaction/rules', {})));
  ok('C2 approve rule: no-role 403', gated(await call(tNone, 'PATCH', '/redaction/rules/' + NX + '/approve')));
  ok('C3 create rule: worker passes the gate', through(await call(tRed, 'POST', '/redaction/rules', { title: 'PG rule ' + TAG })));
  ok('C4 structured apply: no-role 403', gated(await call(tNone, 'POST', '/structured-redaction/apply', {})));
  ok('C5 structured preview stays open (compute-only)', through(await call(tNone, 'POST', '/structured-redaction/preview', {})));
  ok('C6 AV start: no-role 403', gated(await call(tNone, 'POST', '/av-redaction/request/' + NX + '/start', {})));
  ok('C7 AV release-as-is: no-role 403', gated(await call(tNone, 'POST', '/av-redaction/request/' + NX + '/release-as-is', {})));

  console.log('\n=== D. REPOSITORIES — config is admin territory; ingest runs are redaction work ===');
  ok('D1 connect repository: redaction worker 403 (SYSTEM_ADMIN/DIRECTOR only)', gated(await call(tRed, 'POST', '/repositories', { name: 'x' })));
  ok('D2 connect repository: admin passes', through(await call(tAdmin, 'PATCH', '/repositories/' + NX, { name: 'x' })));
  ok('D3 ai-configure: no-role 403', gated(await call(tNone, 'POST', '/repositories/ai-configure', {})));
  ok('D4 ingest run: no-role 403', gated(await call(tNone, 'POST', '/repositories/' + NX + '/ingest/run')));
  ok('D5 ingest run: worker passes the gate', through(await call(tRed, 'POST', '/repositories/' + NX + '/ingest/run')));

  console.log('\n=== E. READS STAY OPEN to any authenticated staffer ===');
  ok('E1 templates list 200', (await call(tNone, 'GET', '/redaction-templates')) === 200);
  ok('E2 rules list 200', (await call(tNone, 'GET', '/redaction/rules')) === 200);
  ok('E3 repositories list 200', (await call(tNone, 'GET', '/repositories')) === 200);
  ok('E4 no token is 401 not 403 (auth before role)', (await call(null, 'POST', '/redaction/rules', {})) === 401);

  console.log('\n=== F. CLEANUP ===');
  await db.run("DELETE FROM redaction_rules WHERE title = 'PG rule ' || ?", [TAG]);
  await db.run("DELETE FROM redaction_jobs WHERE created_by IN (?, ?)", ['PG Worker', 'u-pg-red-' + TAG]);
  await db.run('DELETE FROM user_permission_roles WHERE user_id IN (?,?)', ['u-pg-none-' + TAG, 'u-pg-red-' + TAG]);
  await db.run('DELETE FROM users WHERE id IN (?,?)', ['u-pg-none-' + TAG, 'u-pg-red-' + TAG]);
  var left = await db.get("SELECT count(*)::int AS n FROM users WHERE title = 'Test ' || ?", [TAG]);
  ok('F1 fixture users are gone', Number(left.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
