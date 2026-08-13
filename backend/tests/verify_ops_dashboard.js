'use strict';
// OPERATIONAL DASHBOARD (SPEC_operational_dashboard.md, decided 2026-08-12). What this harness asserts:
//
//   A. THE BUDGET EDITOR (slice 1). The measurement machinery has existed since Slice C; this is the
//      editing surface the deferred "budget brain" never delivered. One value per task type: GET lists
//      the generic rows; PUT records the change WITH the editor's name; refusals in words for an unknown
//      type (the editor never grows the catalog), a non-number, and a non-supervisor caller.
//   B. THE LATENESS BUCKETS (slice 2). bucketOf edges (exactly 24h over = 1 day late; 24h+1ms = 2 days;
//      48h+1ms = >2 days); the ops-summary endpoint groups team × task node with queued / in-process /
//      paused / late counts; a PAUSED over-budget task lands in `paused` and NOWHERE else (one task, one
//      column — an attention tool that cries wolf gets ignored); an unbudgeted type is counted, never
//      late; per-team stage counts ride along. SCOPING: a non-elevated user never sees another team.
//   C. THE PANE LAYOUT (slice 3). Role defaults computed when no row exists (supervisor → team panes,
//      org-wide → attention map + finance, clerical → generic); a saved layout round-trips; junk pane
//      keys are dropped; an empty layout is refused in words.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ops = require('/opt/optimumq/backend/src/services/opsSummary');

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'OPS-' + Date.now();
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function req(method, p, body, token) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j }); });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}
async function userWithRole(role, needDept) {
  return await db.get(
    "SELECT u.* FROM users u JOIN user_function_roles ufr ON ufr.user_id = u.id " +
    "JOIN function_roles fr ON fr.id = ufr.function_role_id WHERE fr.name = ? AND u.status = 'active'" +
    (needDept ? ' AND u.department_id IS NOT NULL' : '') + ' LIMIT 1', [role]);
}
async function plainUser() {
  return await db.get(
    "SELECT u.* FROM users u WHERE u.status = 'active' AND u.department_id IS NOT NULL AND NOT EXISTS (" +
    "  SELECT 1 FROM user_function_roles ufr JOIN function_roles fr ON fr.id = ufr.function_role_id " +
    "  WHERE ufr.user_id = u.id AND fr.name IN ('SUPERVISOR','DIRECTOR','SYSTEM_ADMIN','DEPT_MANAGER','ATTORNEY_REVIEWER')) LIMIT 1");
}
var HOUR = 3600000, DAY = 24 * HOUR;
function agoStr(ms) { return new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' '); }

(async function () {
  try {
    await db.initDb();
    var sup = await userWithRole('SUPERVISOR', true); // C1 needs a supervisor WITH a team
    var dir = await userWithRole('SYSTEM_ADMIN');     // the org-wide actor (the seed has no DIRECTOR user)
    var plain = await plainUser();
    ok('actors exist (supervisor, org-wide admin, non-elevated)', !!sup && !!dir && !!plain);
    var T_SUP = await auth.signAccessToken(sup);
    var T_DIR = await auth.signAccessToken(dir);
    var T_PLAIN = await auth.signAccessToken(plain);

    console.log('\n=== A. THE BUDGET EDITOR ===');
    var list = await req('GET', '/api/config/time-budgets', null, T_PLAIN);
    ok('A1 any staff member can READ the budgets (' + (list.body.budgets || []).length + ' generic rows)',
      list.status === 200 && (list.body.budgets || []).length >= 6 &&
      list.body.budgets.every(function (b) { return b.task_type && b.budget_days != null; }));
    var put = await req('PUT', '/api/config/time-budgets', { taskType: 'record_search', budgetDays: 5 }, T_SUP);
    ok('A2 a supervisor changes a budget, and the change carries their NAME',
      put.status === 200 && Number(put.body.budget.budget_days) === 5 &&
      put.body.budget.updated_by === sup.display_name && put.body.budget.source === 'supervisor');
    var putHalf = await req('PUT', '/api/config/time-budgets', { taskType: 'fee_waiver', budgetDays: 0.5 }, T_SUP);
    ok('A3 fractions are fine (half a day)', putHalf.status === 200 && Number(putHalf.body.budget.budget_days) === 0.5);
    var putBogus = await req('PUT', '/api/config/time-budgets', { taskType: 'coffee_run', budgetDays: 2 }, T_SUP);
    ok('A4 an unknown task type is refused in words — the editor never grows the catalog',
      putBogus.status === 404 && /task catalog/.test(putBogus.body.error));
    var putBad = await req('PUT', '/api/config/time-budgets', { taskType: 'estimate', budgetDays: -1 }, T_SUP);
    ok('A5 a non-positive budget is refused in words', putBad.status === 422 && /greater than 0/.test(putBad.body.error));
    var putPlain = await req('PUT', '/api/config/time-budgets', { taskType: 'estimate', budgetDays: 9 }, T_PLAIN);
    ok('A6 a non-supervisor cannot edit budgets (403)', putPlain.status === 403);

    console.log('\n=== B. THE LATENESS BUCKETS ===');
    ok('B1 bucket edges: exactly 24h over = 1 day late; +1ms = 2 days; 48h+1ms = >2 days',
      ops.bucketOf(24 * HOUR) === 'd1' && ops.bucketOf(24 * HOUR + 1) === 'd2' &&
      ops.bucketOf(48 * HOUR) === 'd2' && ops.bucketOf(48 * HOUR + 1) === 'd2plus');

    // Fixture team with a controlled task ledger. Estimate budget is 2d (seed).
    var DEPT = 'dept-' + TAG;
    await db.run("INSERT INTO departments (id, name, code) VALUES (?,?,?)", [DEPT, 'Ops Harness Team', 'OPS' + Date.now() % 100000]);
    async function fixtureTask(id, type, status, elapsedMs, pausedAt) {
      var rid = 'req-' + id;
      await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id) " +
        "VALUES (?,?,?,?,?,'record_search','active',?)", [rid, rid, 'Ops Harness', 'ops@example.com', 'fixture ' + TAG, DEPT]);
      await db.run("INSERT INTO tasks (id, request_id, type, title, team_id, status, paused_at) VALUES (?,?,?,?,?,?,?)",
        [id, rid, type, type + ' fixture', DEPT, status, pausedAt || null]);
      // The insert trigger just wrote the task's first bookmark at NOW — backdate it so the elapsed
      // clock reads the scenario we mean. Fixture manipulation, test DB only.
      await db.run('UPDATE task_events SET at = ? WHERE task_id = ?', [agoStr(elapsedMs), id]);
    }
    await fixtureTask('t1-' + TAG, 'estimate', 'in_progress', 2.5 * DAY);            // over 12h  → d1
    await fixtureTask('t2-' + TAG, 'estimate', 'in_progress', 5 * DAY);              // over 3d   → d2plus
    await fixtureTask('t3-' + TAG, 'estimate', 'open', 2 * DAY + 25 * HOUR);         // over 25h  → d2 (queue time burns budget)
    await fixtureTask('t4-' + TAG, 'record_search', 'in_progress', 1 * DAY);         // ok (budget now 5d)
    await fixtureTask('t5-' + TAG, 'estimate', 'in_progress', 10 * DAY, agoStr(0));  // paused — never late
    await fixtureTask('t6-' + TAG, 'close_approval', 'open', 3 * DAY);               // unbudgeted type

    var sum = await ops.taskNodes({ teamId: DEPT });
    var team = sum.teams[0];
    var est = team.nodes.filter(function (n) { return n.taskType === 'estimate'; })[0];
    var rs = team.nodes.filter(function (n) { return n.taskType === 'record_search'; })[0];
    var ca = team.nodes.filter(function (n) { return n.taskType === 'close_approval'; })[0];
    ok('B2 the estimate node buckets the ledger exactly: queued 1 · in process 2 · paused 1 · late 1/1/1',
      est && est.queued === 1 && est.inProcess === 2 && est.paused === 1 &&
      est.late.d1 === 1 && est.late.d2 === 1 && est.late.d2plus === 1);
    ok('B3 a PAUSED over-budget task is paused and NOTHING else — one task, one column',
      est && (est.queued + est.inProcess + est.inReview) === 3);
    ok('B4 an in-budget task counts as work, not lateness', rs && rs.inProcess === 1 &&
      rs.late.d1 + rs.late.d2 + rs.late.d2plus === 0);
    ok('B5 an unbudgeted task type is counted and honest, never late',
      ca && ca.queued === 1 && ca.unbudgeted === 1 && ca.late.d1 + ca.late.d2 + ca.late.d2plus === 0);
    ok('B6 per-team stage counts ride along (' + (team.stages.record_search || 0) + ' at record_search)',
      team.stages && team.stages.record_search === 6 && team.activeRequests === 6);

    var apiSum = await req('GET', '/api/tasks/ops-summary', null, T_DIR);
    ok('B7 an org-wide role sees the fixture team through the endpoint',
      apiSum.status === 200 && apiSum.body.teams.some(function (t) { return t.teamId === DEPT; }) &&
      apiSum.body.finance && typeof apiSum.body.finance.outstandingBalances === 'number');
    var plainSum = await req('GET', '/api/tasks/ops-summary', null, T_PLAIN);
    ok('B8 a non-elevated user NEVER sees another team\'s rows',
      plainSum.status === 200 && !plainSum.body.teams.some(function (t) { return t.teamId === DEPT; }));

    console.log('\n=== C. THE PANE LAYOUT ===');
    var supPanes = await req('GET', '/api/config/dashboard-panes', null, T_SUP);
    ok('C1 a supervisor with a team defaults to team panes, led by workload health (#13)',
      supPanes.status === 200 && supPanes.body.defaultsApplied === true &&
      supPanes.body.panes[0].key === 'health' && supPanes.body.panes[0].scope === 'own' &&
      supPanes.body.panes[1].key === 'teamInProcess' && supPanes.body.panes[1].scope === 'own');
    var dirPanes = await req('GET', '/api/config/dashboard-panes', null, T_DIR);
    ok('C2 an org-wide role defaults to the attention map and finance',
      dirPanes.body.panes.some(function (p) { return p.key === 'lateByTeam'; }) &&
      dirPanes.body.panes.some(function (p) { return p.key === 'finance'; }));
    var plainPanes = await req('GET', '/api/config/dashboard-panes', null, T_PLAIN);
    ok('C3 everyone else defaults to the generic view',
      plainPanes.body.panes[0].key === 'generic');
    var putPanes = await req('PUT', '/api/config/dashboard-panes',
      { panes: [{ key: 'finance' }, { key: 'nonsense' }, { key: 'taskNodes', scope: 'all' }] }, T_SUP);
    ok('C4 a saved layout keeps known panes, drops junk, and normalizes scope',
      putPanes.status === 200 && putPanes.body.panes.length === 2 &&
      putPanes.body.panes[1].key === 'taskNodes' && putPanes.body.panes[1].scope === 'all');
    var supAgain = await req('GET', '/api/config/dashboard-panes', null, T_SUP);
    ok('C5 …and round-trips as the user\'s own layout, defaults no longer applied',
      supAgain.body.defaultsApplied === false && supAgain.body.panes.length === 2);
    var putEmpty = await req('PUT', '/api/config/dashboard-panes', { panes: [] }, T_SUP);
    ok('C6 an empty dashboard is refused in words', putEmpty.status === 422 && /at least one pane/.test(putEmpty.body.error));
  } catch (e) {
    fail++; console.log('  ERR  ' + (e && e.stack || e));
  } finally {
    console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  }
})();
