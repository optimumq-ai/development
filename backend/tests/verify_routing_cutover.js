'use strict';
// V3 ROUTING CUTOVER (D4 §8, item 9 — the remaining half of "one task-routing role catalog").
//
// Live routing ran on TWO tokens per concept: tasks tagged with legacy permission-role names
// (FEE_MANAGER, SEARCH_AND_TRIAGE, REDACTION_WORKER, FINANCE) while the v3 model (user_task_types)
// waited, seeded for almost nothing. The two eligibility READERS treated the tag differently:
// eligibleUsers() translated legacy names onto the v3 model when seeded, but POOL_ELIGIBILITY_SQL
// matched the tag against grants VERBATIM — so seeding grants without switching the spawn tag would
// make the pool list and the claim guard DISAGREE (the §3.5 class: work offered to people who cannot
// take it, or takeable by people never shown it).
//
// The cutover is two halves, and this harness proves they only work TOGETHER:
//   (1) createTask's spawn-time token switch — a legacy-mapped type on a SEEDED (team, type) is tagged
//       with its own type key (generalizing what redaction_qa already did);
//   (2) seed_task_type_grants — the one-time 1:1 mirror of legacy holders into grants, via the real
//       staff API, so the v3 eligible set is EXACTLY the legacy set (behavior-preserving).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var spawnSync = require('child_process').spawnSync;
var db = require('/opt/optimumq/backend/src/db');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var seed = require('/opt/optimumq/backend/src/db/seed_task_type_grants');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var FOUR = ['estimate', 'record_search', 'redaction', 'redaction_qa', 'fee_waiver'];
var LEGACY_OF = { estimate: 'FEE_MANAGER', record_search: 'SEARCH_AND_TRIAGE', redaction: 'REDACTION_WORKER', redaction_qa: 'REDACTION_WORKER', fee_waiver: 'FINANCE' };

async function legacyHolders(teamId, roleName) {
  var p = [roleName]; var dc = '';
  if (teamId) { dc = ' AND u.department_id = ?'; p.push(teamId); }
  return (await db.all(
    "SELECT u.id FROM users u JOIN user_permission_roles upr ON upr.user_id = u.id " +
    "JOIN permission_roles pr ON pr.id = upr.permission_role_id WHERE pr.name = ? AND u.status='active'" + dc, p))
    .map(function (r) { return r.id; }).sort();
}
function ids(users) { return users.map(function (u) { return u.id; }).sort(); }
function sameSet(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
function runSeed(args) {
  return spawnSync(process.execPath, ['src/db/seed_task_type_grants.js'].concat(args || []),
    { cwd: '/opt/optimumq/backend', env: process.env, encoding: 'utf8' });
}

(async function () {
  await db.initDb();
  var TEAM = 'team-police', SUPER = 'u-police-super', STAFF = 'u-police-staff';

  console.log('\n=== A. PRE-CUTOVER — legacy tags, legacy pools, pool/claim agreement ===');
  await db.run('DELETE FROM user_task_types WHERE task_type IN (?,?,?,?,?)', FOUR);
  var tA = await tr.createTask({ type: 'estimate', requestId: null, teamId: TEAM, createdBy: 'test' });
  ok('A1 unseeded spawn keeps the legacy tag (role_required=FEE_MANAGER)', tA.role_required === 'FEE_MANAGER');
  var poolA = await tr.poolForUser(SUPER);
  var seesA = poolA.some(function (t) { return t.id === tA.id; });
  var eligA = ids(await tr.eligibleUsers(TEAM, 'FEE_MANAGER'));
  ok('A2 the legacy holder is offered the task AND is claim-eligible (readers agree)',
    seesA && eligA.indexOf(SUPER) >= 0);
  ok('A3 pre-cutover eligibility IS the legacy holder set', sameSet(eligA, await legacyHolders(TEAM, 'FEE_MANAGER')));

  console.log('\n=== B. THE MIRROR — dry run plans, apply executes via the real API, re-run is a no-op ===');
  var dry = runSeed([]);
  ok('B1 dry run exits 0 and changes nothing', dry.status === 0 &&
    Number((await db.get('SELECT count(*)::int AS n FROM user_task_types WHERE task_type = ?', ['estimate'])).n) === 0);
  var ap = runSeed(['--apply']);
  ok('B2 --apply exits 0 (grants written through PATCH /api/staff/:id/task-types)', ap.status === 0);
  if (ap.status !== 0) console.log(ap.stdout + ap.stderr);
  var again = runSeed(['--apply']);
  ok('B3 re-run is a no-op ("Nothing to do")', again.status === 0 && /Nothing to do/.test(again.stdout));

  console.log('\n=== C. BEHAVIOR-PRESERVING — for every (team, type), the v3 set equals the legacy set ===');
  var teams = (await db.all("SELECT DISTINCT department_id AS d FROM users WHERE department_id IS NOT NULL AND status='active'"))
    .map(function (r) { return r.d; });
  var mismatches = [];
  for (var ty of ['estimate', 'record_search', 'redaction']) {
    for (var tm of teams) {
      var legacy = await legacyHolders(tm, LEGACY_OF[ty]);
      var v3 = ids(await tr.eligibleUsers(tm, ty));
      if (!sameSet(legacy, v3)) mismatches.push(tm + '/' + ty);
    }
  }
  ok('C1 team-scoped types: v3 eligible set == legacy holder set on every team (' + teams.length + ' teams x 3 types)',
    mismatches.length === 0);
  if (mismatches.length) console.log('    mismatches: ' + mismatches.join(', '));
  ok('C2 team-agnostic fee_waiver: v3 set == FINANCE holder set',
    sameSet(await legacyHolders(null, 'FINANCE'), ids(await tr.eligibleUsers(null, 'fee_waiver'))));
  ok('C3 redaction_qa mirrors REDACTION_WORKER (every redactor is an eligible reviewer, as today)',
    sameSet(await legacyHolders(TEAM, 'REDACTION_WORKER'), ids(await tr.eligibleUsers(TEAM, 'redaction_qa'))));

  console.log('\n=== D. POST-CUTOVER SPAWN — type-key tags, and the readers still agree ===');
  var tD = await tr.createTask({ type: 'estimate', requestId: null, teamId: TEAM, createdBy: 'test' });
  ok('D1 seeded spawn carries the type key (role_required=estimate)', tD.role_required === 'estimate');
  var poolD = await tr.poolForUser(SUPER);
  ok('D2 the grantee is offered the type-key task', poolD.some(function (t) { return t.id === tD.id; }));
  var claimD = await tr.claim(tD.id, SUPER);
  ok('D3 ...and can claim it', !!claimD.task && claimD.task.assigned_to === SUPER);
  var poolStaff = await tr.poolForUser(STAFF);
  var claimStaff = await tr.claim(tA.id, STAFF); // tA is open; STAFF holds no FEE_MANAGER and no estimate grant
  ok('D4 a non-holder is neither offered estimate work nor able to claim it (both readers refuse)',
    !poolStaff.some(function (t) { return t.id === tD.id; }) && !!claimStaff.error);
  var poolSuperA = await tr.poolForUser(SUPER);
  var claimA = await tr.claim(tA.id, SUPER);
  ok('D5 the IN-FLIGHT legacy-tagged task from A stays visible and claimable by the mirrored holder',
    poolSuperA.some(function (t) { return t.id === tA.id; }) && !!claimA.task && claimA.task.assigned_to === SUPER);
  var tqa = await tr.createTask({ type: 'redaction_qa', requestId: null, teamId: TEAM, createdBy: 'test' });
  ok('D6 redaction_qa spawns on its own key once seeded (the old per-spawner switch, now central)', tqa.role_required === 'redaction_qa');
  var tleg = await tr.createTask({ type: 'redaction_qa', requestId: null, roleRequired: 'legal_redaction', teamId: null, createdBy: 'test' });
  ok('D7 an explicit roleRequired override (legal path) is respected, never switched', tleg.role_required === 'legal_redaction');
  var tfw = await tr.createTask({ type: 'fee_waiver', requestId: null, teamId: null, createdBy: 'test' });
  var claimFw = await tr.claim(tfw.id, SUPER); // SUPER holds FINANCE -> mirrored fee_waiver grant
  ok('D8 team-agnostic fee_waiver spawns on its key and a mirrored FINANCE holder claims it',
    tfw.role_required === 'fee_waiver' && !!claimFw.task && claimFw.task.assigned_to === SUPER);

  console.log('\n=== E. LEAVE THE WORLD AS FOUND — later harnesses assert the UNSEEDED fixture ===');
  // verify_qa_routing §C proves the unseeded->seeded transition from a grantless team; the mirror this
  // harness applied must not leak into that precondition (it did once: C0/C1 went red suite-wide).
  for (var tid of [tA.id, tD.id, tqa.id, tleg.id, tfw.id]) { await db.run('DELETE FROM tasks WHERE id = ?', [tid]); }
  await db.run('DELETE FROM user_task_types WHERE task_type IN (?,?,?,?,?)', FOUR);
  ok('E1 grants and tasks from this harness are gone (the fixture is unseeded again)',
    (await tr.hasSeededType('redaction_qa', TEAM)) === false &&
    Number((await db.get('SELECT count(*)::int AS n FROM user_task_types WHERE task_type IN (?,?,?,?,?)', FOUR)).n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
