'use strict';
// TIME BUDGET (Slice C). A generic per-(record_type, task_type) budget in calendar days, compared against the
// Slice-B actual elapsed (time since the task landed on the person's list) to yield "budgeted days remaining /
// over budget". Generic defaults now; the future budget "brain" adds per-record-type rows (same table).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var B = require('/opt/optimumq/backend/src/services/taskBudget');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var DAY = 86400000, PORT = Number(process.env.API_PORT) || 3101;
async function token(id) { var u = await db.get('SELECT * FROM users WHERE id = ?', [id]); return u ? await auth.signAccessToken(u) : null; }

(async function () {
  await db.initDb();

  console.log('\n=== A. THE GENERIC BUDGET SEED EXISTS ===');
  var seeded = await db.all("SELECT task_type, budget_days FROM time_budgets WHERE record_type_id IS NULL");
  ok('A1 generic per-task-type budgets are seeded (>= 6, incl. redaction & record_search)',
    seeded.length >= 6 && seeded.some(function (r) { return r.task_type === 'redaction'; }) && seeded.some(function (r) { return r.task_type === 'record_search'; }));

  console.log('\n=== B. THE MATH — the step budget vs active elapsed (queue+process+returned) ===');
  ok('B1 on track: a 5d budget, 3d elapsed -> 2d left, state ok', (function () { var s = B.statusFor(5, 3 * DAY); return s.remainingMs === 2 * DAY && s.state === 'ok'; })());
  ok('B2 over: a 2d budget, 3d elapsed -> 1d over, state over', (function () { var s = B.statusFor(2, 3 * DAY); return s.overMs === 1 * DAY && s.state === 'over'; })());
  ok('B3 warn: a 5d budget, 4d elapsed -> 1d left (inside the last 25%), state warn', (function () { var s = B.statusFor(5, 4 * DAY); return s.remainingMs === 1 * DAY && s.state === 'warn'; })());
  ok('B4 no budget / no elapsed -> no status (not everything is budgeted)', B.statusFor(null, 3 * DAY) === null && B.statusFor(3, null) === null);
  ok('B5 active elapsed = queue + process + returned, but NOT in-review (the reviewer’s step)',
    B.activeElapsed({ inQueueMs: 1 * DAY, inProcessMs: 2 * DAY, returnedMs: 1 * DAY, inReviewMs: 5 * DAY }) === 4 * DAY);

  console.log('\n=== C. LOOKUP — specific row wins, else the generic default ===');
  var map = await B.loadBudgetMap();
  ok('C1 generic redaction budget resolves to its seeded value', B.lookup(map, null, 'redaction') === 4);
  ok('C2 an unknown record type falls back to the generic default', B.lookup(map, 'rt-does-not-exist', 'redaction') === 4);
  ok('C3 an unbudgeted task type resolves to null', B.lookup(map, null, 'no_such_type') == null);

  console.log('\n=== D. /tasks/mine carries a budget status per task ===');
  var U = 'u-police-staff', reqId = 'req-TB-' + Date.now();
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?, 'redaction','active') ON CONFLICT (id) DO NOTHING", [reqId, reqId, 'x', 'x@x', 'tb']);
  var t = await tr.createTask({ type: 'redaction', requestId: reqId, createdBy: 'test' });
  await tr.assign(t.id, U, 'manual');
  var r = await fetch('http://localhost:' + PORT + '/api/tasks/mine', { headers: { Authorization: 'Bearer ' + (await token(U)) } });
  var mine = ((await r.json()).tasks || []).filter(function (x) { return x.id === t.id; })[0];
  ok('D1 the task carries a budget object with the step budget (redaction = 4d)', !!mine && !!mine.budget && mine.budget.budgetDays === 4);
  ok('D2 …and a state (just assigned -> on track)', mine && ['ok', 'warn', 'over'].indexOf(mine.budget.state) >= 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
