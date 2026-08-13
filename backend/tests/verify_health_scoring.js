'use strict';
// WORKLOAD HEALTH SCORING (#13 — D4 §4, model approved by Kevin 2026-08-13 from mockups).
//
// The scoring layer over the shipped lateness buckets: 1 point per task 1 day over budget, 2 at
// 2 days, 4 past 2 days (the exponential penalty); 0 = on_track, 1–3 = needs_attention,
// 4+ = falling_behind. Paused and unbudgeted tasks never score. One formula, four consumers —
// ops-summary nodes/teams/totals, the My Tasks personal composite, and the workload_health report
// metric — all computed from the same buckets so screen and score can never disagree.
//
// WHAT THIS PREVENTS: a health verdict that drifts from the counts beside it, a paused task
// dragging someone's score, or the report engine telling management a different story than the
// dashboard shows the supervisor.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var WH = require('/opt/optimumq/backend/src/services/workloadHealth');
var opsSummary = require('/opt/optimumq/backend/src/services/opsSummary');
var reportEngine = require('/opt/optimumq/backend/src/services/reportEngine');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'WH-' + Date.now();
var HOUR = 3600000, DAY = 24 * HOUR;
var PORT = Number(process.env.API_PORT) || 3101;
function agoStr(ms) { return new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' '); }
async function req(method, path, tok) {
  var r = await fetch('http://localhost:' + PORT + path, { method: method, headers: { Authorization: 'Bearer ' + tok } });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async function () {
  await db.initDb();

  console.log('\n=== A. THE FORMULA (pure — the one place points and thresholds live) ===');
  ok('A1 points: 1 per 1-day-late, 2 per 2-days, 4 past 2 days',
    WH.pointsFromBuckets({ d1: 1, d2: 1, d2plus: 1 }) === 7 && WH.pointsFromBuckets({ d1: 3 }) === 3 &&
    WH.pointsFromBuckets({ d2plus: 2 }) === 8 && WH.pointsFromBuckets({}) === 0);
  ok('A2 thresholds: 0 on_track · 1 and 3 needs_attention · 4 falling_behind',
    WH.statusOf(0) === 'on_track' && WH.statusOf(1) === 'needs_attention' &&
    WH.statusOf(3) === 'needs_attention' && WH.statusOf(4) === 'falling_behind');
  ok('A3 one task >2 days late alone is RED (the exponential point of the formula)',
    WH.healthOf({ d2plus: 1 }).status === 'falling_behind');
  ok('A4 three slightly-late tasks stay AMBER (contained)',
    WH.healthOf({ d1: 3 }).status === 'needs_attention');
  ok('A5 compositeOf sums node buckets', WH.compositeOf([{ late: { d1: 1 } }, { late: { d2plus: 1 } }]).points === 5);
  ok('A6 bucket edges owned here: 24h→d1 · 24h+1→d2 · 48h→d2 · 48h+1→d2plus',
    WH.bucketOf(24 * HOUR) === 'd1' && WH.bucketOf(24 * HOUR + 1) === 'd2' &&
    WH.bucketOf(48 * HOUR) === 'd2' && WH.bucketOf(48 * HOUR + 1) === 'd2plus');
  ok('A7 bucketsOf skips paused and unbudgeted tasks',
    WH.pointsFromBuckets(WH.bucketsOf(
      [{ id: 'a', paused_at: 'x' }, { id: 'b' }, { id: 'c' }],
      { a: { state: 'over', overMs: 3 * DAY }, c: { state: 'over', overMs: HOUR } })) === 1);

  console.log('\n=== B. OPS-SUMMARY — node, team, and totals all carry the verdict ===');
  var DEPT = 'dept-' + TAG;
  await db.run('INSERT INTO departments (id, name, code) VALUES (?,?,?)', [DEPT, 'Health Harness Team', 'WH' + Date.now() % 100000]);
  async function fixtureTask(id, type, status, elapsedMs, pausedAt, assignee) {
    var rid = 'req-' + id;
    await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id) " +
      "VALUES (?,?,?,?,?,'record_search','active',?)", [rid, rid, 'WH Harness', 'wh@example.com', 'fixture ' + TAG, DEPT]);
    await db.run('INSERT INTO tasks (id, request_id, type, title, team_id, status, paused_at, assigned_to) VALUES (?,?,?,?,?,?,?,?)',
      [id, rid, type, type + ' fixture', DEPT, status, pausedAt || null, assignee || null]);
    await db.run('UPDATE task_events SET at = ? WHERE task_id = ?', [agoStr(elapsedMs), id]);
  }
  // Estimate budget is 2d (seed, untouched by other harnesses). Ledger: d1 + d2 + d2plus + paused + ok.
  await fixtureTask('h1-' + TAG, 'estimate', 'in_progress', 2 * DAY + 12 * HOUR); // over 12h  → d1
  await fixtureTask('h2-' + TAG, 'estimate', 'in_progress', 2 * DAY + 30 * HOUR); // over 30h  → d2
  await fixtureTask('h3-' + TAG, 'estimate', 'in_progress', 5 * DAY);             // over 3d   → d2plus
  await fixtureTask('h4-' + TAG, 'estimate', 'in_progress', 10 * DAY, agoStr(0)); // paused    → never scores
  await fixtureTask('h5-' + TAG, 'redaction', 'in_progress', HOUR);               // in budget → green node

  var sum = await opsSummary.taskNodes({ teamId: DEPT });
  var team = sum.teams[0];
  var est = team.nodes.filter(function (n) { return n.taskType === 'estimate'; })[0];
  var red = team.nodes.filter(function (n) { return n.taskType === 'redaction'; })[0];
  ok('B1 the estimate node scores its buckets: 1+2+4 = 7, falling_behind',
    est && est.health && est.health.points === 7 && est.health.status === 'falling_behind');
  ok('B2 the in-budget node is on_track at 0', red && red.health && red.health.points === 0 && red.health.status === 'on_track');
  ok('B3 the paused over-budget task moved no needle (7, not 11)', est.health.points === 7 && est.paused === 1);
  ok('B4 the team composite sums its nodes (7, falling_behind)',
    team.health && team.health.points === 7 && team.health.status === 'falling_behind');
  var all = await opsSummary.taskNodes({});
  ok('B5 the all-teams totals carry a composite too', all.totals.health && all.totals.health.points >= 7);

  console.log('\n=== C. MY TASKS — the personal composite through the real endpoint ===');
  var who = await db.get("SELECT * FROM users WHERE id = 'u-police-staff'");
  await fixtureTask('h6-' + TAG, 'estimate', 'in_progress', 2 * DAY + 12 * HOUR, null, who.id); // d1 → 1 pt
  await fixtureTask('h7-' + TAG, 'estimate', 'assigned', 2 * DAY + 30 * HOUR, null, who.id);    // d2 → 2 pts
  await fixtureTask('h8-' + TAG, 'estimate', 'assigned', 20 * DAY, agoStr(0), who.id);          // paused → 0
  var mine = await req('GET', '/api/tasks/mine', await auth.signAccessToken(who));
  ok('C1 /tasks/mine carries the personal composite: 3 points, needs_attention',
    mine.status === 200 && mine.body.health && mine.body.health.points === 3 &&
    mine.body.health.status === 'needs_attention');
  ok('C2 ...with the WHY riding along (1 × d1, 1 × d2, paused excluded)',
    mine.body.health.late && mine.body.health.late.d1 === 1 && mine.body.health.late.d2 === 1 &&
    mine.body.health.late.d2plus === 0);

  console.log('\n=== D. THE AI-REPORTING HOOK — workload_health off the same read ===');
  var rep = await reportEngine.runSpec({ metric: 'workload_health' });
  var row = (rep.rows || []).filter(function (r) { return /Health Harness Team/.test(r.label); })[0];
  ok('D1 the report metric exists and finds the fixture team', !!row);
  ok('D2 the team\'s report points match the dashboard (10: node 7 + personal 3)', row && row.value === 10);
  ok('D3 the row says the verdict and the why in words',
    row && /Falling behind/.test(row.label) && /1 day late/.test(row.label));
  ok('D4 the note explains the formula and disclaims the legal clock',
    /1 day over/.test(rep.note) && /not the legal deadline/i.test(rep.note));

  console.log('\n=== E. THE PANE — in the library, first in the elevated defaults ===');
  var admin = await db.get("SELECT * FROM users WHERE id = 'u-kruss'");
  await db.run('DELETE FROM user_dashboard_panes WHERE user_id = ?', [admin.id]);
  var panes = await req('GET', '/api/config/dashboard-panes', await auth.signAccessToken(admin));
  ok('E1 the pane library offers Workload health',
    panes.status === 200 && (panes.body.library || []).some(function (p) { return p.key === 'health'; }));
  ok('E2 org-wide defaults lead with it', panes.body.panes && panes.body.panes[0] && panes.body.panes[0].key === 'health');

  console.log('\n=== F. LEAVE THE WORLD AS FOUND ===');
  await db.run("DELETE FROM requests WHERE description LIKE ?", ['%fixture ' + TAG + '%']);
  await db.run('DELETE FROM departments WHERE id = ?', [DEPT]);
  var left = await db.get("SELECT count(*)::int AS n FROM tasks WHERE id LIKE '%' || ?", [TAG]);
  ok('F1 fixture requests, tasks (cascade), and the team are gone', Number(left.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
