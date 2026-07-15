'use strict';
// TASK TIMING DISPLAY (Slice B). Reads the Slice-A bookmark trail and computes elapsed CALENDAR time in each
// state — the stretch between two bookmarks belongs to the status it was in; the current state runs to now;
// re-work rounds sum. This is the math behind the "In queue 3d / In process 4h / In review 1d" clocks on My Tasks.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var T = require('/opt/optimumq/backend/src/services/taskTiming');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var PORT = Number(process.env.API_PORT) || 3101;
var H = 3600000, BASE = Date.parse('2026-01-01T00:00:00Z');
function at(h) { return new Date(BASE + h * H).toISOString().slice(0, 19).replace('T', ' '); }
async function token(id) { var u = await db.get('SELECT * FROM users WHERE id = ?', [id]); return u ? await auth.signAccessToken(u) : null; }

(async function () {
  await db.initDb();

  console.log('\n=== A. THE MATH — elapsed between bookmarks, current state runs to now, rounds sum ===');
  // open@0 -> assigned@1h -> in_progress@3h -> done@5h, "now" = 6h.
  var d1 = T.durationsFromEvents([
    { to_status: 'open', at: at(0) }, { to_status: 'assigned', at: at(1) },
    { to_status: 'in_progress', at: at(3) }, { to_status: 'done', at: at(5) }
  ], BASE + 6 * H);
  ok('A1 time-in-status is the stretch between bookmarks (open 1h, assigned 2h, in_process 2h)',
    d1.totals.open === 1 * H && d1.totals.assigned === 2 * H && d1.totals.in_progress === 2 * H);
  ok('A2 a terminal state (done) has no running clock', (d1.totals.done || 0) === 0 && d1.currentStatus === 'done' && d1.currentSinceMs === 0);
  var p1 = T.phases(d1.totals);
  ok('A3 phases roll up: in-queue = open + assigned = 3h, in-process = 2h', p1.inQueueMs === 3 * H && p1.inProcessMs === 2 * H);

  // A correction round: in_progress@1h -> returned@2h -> in_progress@3h, still going, "now" = 4h.
  var d2 = T.durationsFromEvents([
    { to_status: 'open', at: at(0) }, { to_status: 'assigned', at: at(0.5) },
    { to_status: 'in_progress', at: at(1) }, { to_status: 'returned', at: at(2) }, { to_status: 'in_progress', at: at(3) }
  ], BASE + 4 * H);
  ok('A4 processing time SUMS across correction rounds (1h + 1h = 2h)', d2.totals.in_progress === 2 * H && d2.totals.returned === 1 * H);
  ok('A5 the current (non-terminal) state clock runs to now (in_process, 1h in this round)',
    d2.currentStatus === 'in_progress' && d2.currentSinceMs === 1 * H);

  console.log('\n=== B. /tasks/mine carries live timing per task ===');
  var U = 'u-police-staff', reqId = 'req-TT-' + Date.now();
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?, 'redaction','active') ON CONFLICT (id) DO NOTHING", [reqId, reqId, 'x', 'x@x', 'tt']);
  var t = await tr.createTask({ type: 'record_search', requestId: reqId, createdBy: 'test' });
  await tr.assign(t.id, U, 'manual');
  await tr.enterTask(t.id, U); // -> in_progress
  var r = await fetch('http://localhost:' + PORT + '/api/tasks/mine', { headers: { Authorization: 'Bearer ' + (await token(U)) } });
  var body = await r.json();
  var mine = (body.tasks || []).filter(function (x) { return x.id === t.id; })[0];
  ok('B1 the task carries a timing object', !!mine && !!mine.timing);
  ok('B2 …reflecting the current state (in_process) with a non-negative clock', mine && mine.timing.currentStatus === 'in_progress' && mine.timing.currentSinceMs >= 0);
  ok('B3 …and the phase totals + age-since-submit are present', mine && typeof mine.timing.inProcessMs === 'number' && typeof mine.timing.inQueueMs === 'number' && mine.timing.ageMs != null);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
