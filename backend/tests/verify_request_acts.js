'use strict';
// PER-REQUEST ACT GATE — routes/requests.js (2026-08-18). The request domain scoped its LISTS but never its
// ACTS: stage advance, assign, assert-exemption, AG ruling, clarification send/resolve, effort, search-intent
// resolve, eligibility confirm, confirm-identity, staff create — all requireAuth only. Now each takes
// middleware/requestAct.requireRequestAct(...) → services/requestAccess.decide:
//   acting role (SYSTEM_ADMIN/DIRECTOR/SUPERVISOR/DEPT_MANAGER/COORDINATOR, + ATTORNEY_REVIEWER for legal acts)
//   OR an act-specific permission role
//   OR the work is yours (the request, or an open task on its parent/child cluster, is assigned to you).
// A missing request passes THROUGH to the handler's own 404. Acts with pre-existing in-handler authority
// (reopen, route, fee-waiver-decision, legal-escalate, commercial-classification) are unchanged.
//
// PASS-THROUGH PROBES WRITE NOTHING: allowed actors are exercised with bodies the handler rejects AFTER the
// gate (missing stage → 400; bogus effort action → 400; postal clarification with no address → 400
// ADDRESS_REQUIRED before any side effect; a two-child parent → 409 AMBIGUOUS_WORK_ROW for stage/exemption/
// ruling). Two exceptions on our OWN fixture (assign, confirm-identity) — plain rows, no outreach.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var access = require('/opt/optimumq/backend/src/services/requestAccess');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'RA' + Date.now();
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
  none: 'u-ra-none-' + TAG,       // logged in, no roles at all
  search: 'u-ra-search-' + TAG,   // SEARCH_AND_TRIAGE perm only
  clarify: 'u-ra-clarify-' + TAG, // CLARIFICATION_SENDER perm only
  reqmgr: 'u-ra-reqmgr-' + TAG,   // REQUEST_MANAGER perm only
  legal: 'u-ra-legal-' + TAG,     // ATTORNEY_REVIEWER function role only
  super: 'u-ra-super-' + TAG,     // SUPERVISOR function role only
  holder: 'u-ra-holder-' + TAG,   // no roles; will HOLD an open record_search task on the fixture
  owner: 'u-ra-owner-' + TAG      // no roles; the fixture request will be ASSIGNED to them
};

(async function () {
  await db.initDb();
  for (var k in U) {
    await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [U[k], k + '-' + TAG + '@test.optimumq.ai', 'RA ' + k, 'Test ' + TAG]);
  }
  await db.run("INSERT INTO user_permission_roles (user_id, permission_role_id) VALUES (?, 'pr-searchtriage')", [U.search]);
  await db.run("INSERT INTO user_permission_roles (user_id, permission_role_id) VALUES (?, 'pr-clarify')", [U.clarify]);
  await db.run("INSERT INTO user_permission_roles (user_id, permission_role_id) VALUES (?, 'pr-reqmgr')", [U.reqmgr]);
  await db.run("INSERT INTO user_function_roles (user_id, function_role_id) VALUES (?, 'fr-attorney')", [U.legal]);
  await db.run("INSERT INTO user_function_roles (user_id, function_role_id) VALUES (?, 'fr-supervisor')", [U.super]);
  var T = {};
  for (var k2 in U) T[k2] = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [U[k2]]));

  // Fixtures through the ONE creation helper. R1: a single-record request (n = 1); R2: a two-child parent
  // whose stage-bearing acts are AMBIGUOUS from the parent id (the 409 that lets allowed actors pass the
  // gate without moving anything).
  var r1 = await RC.createRequest(
    { requestorName: 'RA Fixture', requestorEmail: 'ra-' + TAG + '@test.optimumq.ai', description: 'RA single ' + TAG, deliveryMethod: 'email' },
    { actorId: 'test', actorName: 'Test', historyAction: 'CREATED', kickIntake: false, sendConfirmation: false });
  var r2 = await RC.createRequest(
    { requestorName: 'RA Fixture', requestorEmail: 'ra-' + TAG + '@test.optimumq.ai', deliveryMethod: 'email',
      children: [{ description: 'RA child A ' + TAG }, { description: 'RA child B ' + TAG }] },
    { actorId: 'test', actorName: 'Test', historyAction: 'CREATED', kickIntake: false, sendConfirmation: false });
  // createRequest returns id = the first CHILD; the parent is parentId. Name them so no probe addresses the
  // wrong row: P1/C1 = the single-record request's parent/child, P2 = the two-child parent.
  var P1 = r1.parentId, C1 = r1.childId, P2 = r2.parentId;
  ok('F0 fixtures: P1 has one child, P2 has two',
    Number((await db.get('SELECT count(*)::int n FROM requests WHERE master_request_id = ?', [P1])).n) === 1 &&
    Number((await db.get('SELECT count(*)::int n FROM requests WHERE master_request_id = ?', [P2])).n) === 2);
  // The holder's task lives on the CHILD; the acts below address the PARENT — the cluster walk is the point.
  var task = await tr.createTask({ requestId: C1, type: 'record_search', title: 'RA search', createdBy: 'test' });
  await db.run("UPDATE tasks SET assigned_to = ?, status = 'assigned' WHERE id = ?", [U.holder, task.id]);
  await db.run('UPDATE requests SET assigned_to = ? WHERE id = ?', [U.owner, P1]);
  var NX = 'ra-nonexistent-' + TAG;

  console.log('\n=== A. THE DECISION (service) ===');
  var d;
  d = await access.decide({ sub: U.none, roles: [], perms: [] }, P1, { perms: ['REQUEST_MANAGER'] });
  ok('A1 no roles, not yours → refused (found)', !d.ok && d.found === true && /supervising role/.test(d.error));
  d = await access.decide({ sub: U.none, roles: [], perms: [] }, NX, { perms: [] });
  ok('A2 nonexistent request → not found (handler owns the 404)', !d.ok && d.found === false);
  d = await access.decide({ sub: U.holder, roles: [], perms: [] }, P1, {});
  ok('A3 holder of an open task on the CHILD acts on the PARENT id (by task)', d.ok && d.by === 'task');
  d = await access.decide({ sub: U.holder, roles: [], perms: [] }, C1, {});
  ok('A4 ...and on the child id', d.ok && d.by === 'task');
  d = await access.decide({ sub: U.holder, roles: [], perms: [] }, P1, { taskTypes: ['legal_review'] });
  ok('A5 task-type narrowing: a record_search holder is not a legal_review holder', !d.ok);
  d = await access.decide({ sub: U.owner, roles: [], perms: [] }, C1, {});
  ok('A6 request assigned to you on the parent → acts on the child id (by assignee)', d.ok && d.by === 'assignee');
  d = await access.decide({ sub: 'x', roles: ['COORDINATOR'], perms: [] }, P1, {});
  ok('A7 acting role passes without a lookup', d.ok && d.by === 'role');
  d = await access.decide({ sub: 'x', roles: [], perms: ['CLARIFICATION_SENDER'] }, P1, { perms: ['CLARIFICATION_SENDER'] });
  ok('A8 act permission passes', d.ok && d.by === 'perm');
  d = await access.decide({ sub: 'x', roles: ['ATTORNEY_REVIEWER'], perms: [] }, P1, { roles: ['ATTORNEY_REVIEWER'] });
  ok('A9 extra acting role (ATTORNEY_REVIEWER for legal acts) passes', d.ok && d.by === 'role');
  d = await access.decide({ sub: 'x', roles: ['ATTORNEY_REVIEWER'], perms: [] }, P1, {});
  ok('A10 ...but ATTORNEY_REVIEWER is not a general acting role', !d.ok);
  await db.run("UPDATE tasks SET status = 'completed' WHERE id = ?", [task.id]);
  d = await access.decide({ sub: U.holder, roles: [], perms: [] }, P1, {});
  ok('A11 a COMPLETED task no longer makes the work yours', !d.ok);
  await db.run("UPDATE tasks SET status = 'assigned' WHERE id = ?", [task.id]);

  console.log('\n=== B. STAGE / ASSIGN ===');
  ok('B1 stage: no-role 403 on a real request', gated(await call(T.none, 'PATCH', '/requests/' + P1 + '/stage', {})));
  ok('B2 stage: refusal is worded, coded NOT_YOUR_REQUEST', (await call(T.none, 'PATCH', '/requests/' + P1 + '/stage', {})).body.code === 'NOT_YOUR_REQUEST');
  ok('B3 stage: nonexistent id → 404 (passed through), not 403', (await call(T.none, 'PATCH', '/requests/' + NX + '/stage', {})).status === 404);
  ok('B4 stage: searcher passes (400: a stage is required)', (await call(T.search, 'PATCH', '/requests/' + P1 + '/stage', {})).status === 400);
  ok('B5 stage: task holder passes', through(await call(T.holder, 'PATCH', '/requests/' + P1 + '/stage', {})));
  ok('B6 stage: request assignee passes', through(await call(T.owner, 'PATCH', '/requests/' + P1 + '/stage', {})));
  ok('B7 stage: supervisor passes', through(await call(T.super, 'PATCH', '/requests/' + P1 + '/stage', {})));
  ok('B8 stage: two-child parent → allowed actor gets 409 AMBIGUOUS, not 403', (await call(T.super, 'PATCH', '/requests/' + P2 + '/stage', { stage: 'record_search' })).status === 409);
  ok('B9 assign: no-role 403', gated(await call(T.none, 'PATCH', '/requests/' + P1 + '/assign', { assignTo: null })));
  ok('B10 assign: searcher 403 (SEARCH_AND_TRIAGE does not carry assign)', gated(await call(T.search, 'PATCH', '/requests/' + P1 + '/assign', { assignTo: null })));
  ok('B11 assign: task holder passes (the work is theirs)', through(await call(T.holder, 'PATCH', '/requests/' + P1 + '/assign', { assignTo: U.owner })));
  ok('B12 assign: REQUEST_MANAGER passes', through(await call(T.reqmgr, 'PATCH', '/requests/' + P1 + '/assign', { assignTo: U.owner })));

  console.log('\n=== C. LEGAL ACTS ===');
  ok('C1 assert-exemption: no-role 403', gated(await call(T.none, 'POST', '/requests/' + P2 + '/assert-exemption', {})));
  ok('C2 assert-exemption: searcher 403 (not legal, not their work)', gated(await call(T.search, 'POST', '/requests/' + P2 + '/assert-exemption', {})));
  ok('C3 assert-exemption: ATTORNEY_REVIEWER passes (409 ambiguous on the two-child parent)', (await call(T.legal, 'POST', '/requests/' + P2 + '/assert-exemption', {})).status === 409);
  ok('C4 assert-exemption: supervisor passes', (await call(T.super, 'POST', '/requests/' + P2 + '/assert-exemption', {})).status === 409);
  ok('C5 ag-ruling: no-role 403', gated(await call(T.none, 'POST', '/requests/' + P2 + '/ag-ruling', {})));
  ok('C6 ag-ruling: ATTORNEY_REVIEWER passes', (await call(T.legal, 'POST', '/requests/' + P2 + '/ag-ruling', {})).status === 409);
  ok('C7 ag-ruling: a record_search task holder is NOT a legal holder → 403', gated(await call(T.holder, 'POST', '/requests/' + P1 + '/ag-ruling', {})));
  ok('C8 assert-exemption: task holder 403 on a request that is NOT theirs (r2)', gated(await call(T.holder, 'POST', '/requests/' + P2 + '/assert-exemption', {})));
  // ...and MAY raise one about their own work: A3 proved the service says yes on r1 with no taskTypes
  // narrowing (the route's exemption gate sets none). Not exercised over HTTP because it would MOVE r1.

  console.log('\n=== D. CLARIFICATION / EFFORT / INTENTS / ELIGIBILITY / IDENTITY / CREATE ===');
  var postal = { channel: 'mail' }; // no mailing address on the fixture → ADDRESS_REQUIRED before any side effect
  ok('D1 clarification send: no-role 403', gated(await call(T.none, 'POST', '/requests/' + P1 + '/clarification', postal)));
  ok('D2 clarification send: searcher 403 (SEARCH_AND_TRIAGE is not CLARIFICATION_SENDER)', gated(await call(T.search, 'POST', '/requests/' + P1 + '/clarification', postal)));
  var cs = await call(T.clarify, 'POST', '/requests/' + P1 + '/clarification', postal);
  ok('D3 clarification send: CLARIFICATION_SENDER passes (400 ADDRESS_REQUIRED, nothing sent)', cs.status === 400 && cs.body && cs.body.code === 'ADDRESS_REQUIRED');
  ok('D4 clarification send: task holder passes (the intake/search screens send from the task)', (await call(T.holder, 'POST', '/requests/' + P1 + '/clarification', postal)).status === 400);
  ok('D5 clarification resolve: no-role 403', gated(await call(T.none, 'POST', '/requests/' + P1 + '/clarification/resolve', {})));
  ok('D6 clarification resolve: nonexistent → 404 through', (await call(T.none, 'POST', '/requests/' + NX + '/clarification/resolve', {})).status === 404);
  ok('D7 effort: no-role 403', gated(await call(T.none, 'POST', '/requests/' + P1 + '/effort', { action: 'CALL_LOGGED' })));
  ok('D8 effort: searcher passes (400 on a bogus action)', (await call(T.search, 'POST', '/requests/' + P1 + '/effort', { action: 'BOGUS' })).status === 400);
  ok('D9 effort: task holder passes', (await call(T.holder, 'POST', '/requests/' + P1 + '/effort', { action: 'BOGUS' })).status === 400);
  ok('D10 search-intent resolve: no-role 403', gated(await call(T.none, 'POST', '/requests/' + P1 + '/search-intents/' + NX + '/resolve', {})));
  ok('D11 search-intent resolve: clarifier 403 (not SEARCH_AND_TRIAGE)', gated(await call(T.clarify, 'POST', '/requests/' + P1 + '/search-intents/' + NX + '/resolve', {})));
  ok('D12 search-intent resolve: searcher passes', through(await call(T.search, 'POST', '/requests/' + P1 + '/search-intents/' + NX + '/resolve', {})));
  ok('D13 eligibility confirm: no-role 403', gated(await call(T.none, 'POST', '/requests/' + P1 + '/eligibility-findings/' + NX + '/confirm', {})));
  ok('D14 eligibility confirm: REQUEST_MANAGER passes', through(await call(T.reqmgr, 'POST', '/requests/' + P1 + '/eligibility-findings/' + NX + '/confirm', {})));
  ok('D15 confirm-identity: no-role 403', gated(await call(T.none, 'POST', '/requests/' + P1 + '/confirm-identity', {})));
  ok('D16 confirm-identity: REQUEST_MANAGER passes', through(await call(T.reqmgr, 'POST', '/requests/' + P1 + '/confirm-identity', {})));
  ok('D17 staff create: no-role 403', gated(await call(T.none, 'POST', '/requests', {})));
  ok('D18 staff create: searcher passes the gate (400 on an empty body)', (await call(T.search, 'POST', '/requests', {})).status === 400);
  ok('D19 no token → 401 before any gate', (await call(null, 'PATCH', '/requests/' + P1 + '/stage', {})).status === 401);

  console.log('\n=== E. PRE-EXISTING AUTHORITY UNCHANGED ===');
  ok('E1 reopen stays a Director act (supervisor 403)', gated(await call(T.super, 'POST', '/requests/' + P1 + '/reopen', { note: 'x' })));
  ok('E2 route stays canRoute (supervisor passes)', through(await call(T.super, 'PATCH', '/requests/' + P1 + '/route', {})));
  ok('E3 legal-escalate stays Director-only (ATTORNEY_REVIEWER 403)', gated(await call(T.legal, 'POST', '/requests/' + P1 + '/legal-escalate', {})));

  console.log('\n=== F. CLEANUP ===');
  // The confirm-identity probe (D16) re-anchors the fixture through requestorLedger.linkRequest and MINTS a
  // requestor profile. Take it back out with everything hanging off it, then the fixture requests — the
  // ledger harness sweeps for stray profiles and must not find ours.
  var profs = await db.all("SELECT id FROM requestor_profiles WHERE primary_email = ?", ['ra-' + TAG + '@test.optimumq.ai']);
  for (var pi = 0; pi < profs.length; pi++) {
    for (var tb of ['requestor_ledger_events', 'requestor_allowances', 'requestor_counters', 'requestor_flags', 'requestor_request_links']) {
      try { await db.run('DELETE FROM ' + tb + ' WHERE profile_id = ?', [profs[pi].id]); } catch (e) {}
    }
    try { await db.run('DELETE FROM requestor_profiles WHERE id = ?', [profs[pi].id]); } catch (e) {}
  }
  var fixIds = [P1, C1, P2].concat(r2.childIds || []);
  var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
  for (var ti = 0; ti < tabs.length; ti++) for (var fi = 0; fi < fixIds.length; fi++) {
    try { await db.run('DELETE FROM ' + tabs[ti].table_name + ' WHERE request_id = ?', [fixIds[fi]]); } catch (e) {}
  }
  var ids = Object.keys(U).map(function (k) { return U[k]; });
  var ph = ids.map(function () { return '?'; }).join(',');
  await db.run('DELETE FROM user_permission_roles WHERE user_id IN (' + ph + ')', ids);
  await db.run('DELETE FROM user_function_roles WHERE user_id IN (' + ph + ')', ids);
  await db.run('DELETE FROM users WHERE id IN (' + ph + ')', ids);
  var left = await db.get("SELECT count(*)::int AS n FROM users WHERE title = 'Test ' || ?", [TAG]);
  ok('F1 fixture users are gone', Number(left.n) === 0);
  var moved = await db.get('SELECT stage FROM requests WHERE id = ?', [C1]);
  ok('F2 the pass-through probes moved no stage (fixture still at intake)', moved && moved.stage === 'intake');
  var moved2 = await db.get("SELECT count(*)::int n FROM requests WHERE master_request_id = ? AND stage <> 'intake'", [P2]);
  ok('F3 ...and neither of the two-child parent’s children moved (409 refused before any write)', Number(moved2.n) === 0);
  await db.run("DELETE FROM requests WHERE master_request_id IN (?, ?)", [P1, P2]);
  await db.run("DELETE FROM requests WHERE id IN (?, ?)", [P1, P2]);
  ok('F4 fixture requests and profile are gone',
    Number((await db.get('SELECT count(*)::int n FROM requests WHERE id IN (?,?) OR master_request_id IN (?,?)', [P1, P2, P1, P2])).n) === 0 &&
    Number((await db.get("SELECT count(*)::int n FROM requestor_profiles WHERE primary_email = ?", ['ra-' + TAG + '@test.optimumq.ai'])).n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
