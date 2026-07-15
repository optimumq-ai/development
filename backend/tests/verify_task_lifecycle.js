'use strict';
// TASK LIFECYCLE + BOOKMARK TRAIL (Slice A). Every task status change drops a bookmark (task_events row) and
// stamps the denormalized assigned_at/in_progress_at/done_at, so "elapsed between bookmarks" (days in queue, in
// process, …) is derivable. And "begin work" is one owner-gated, idempotent entry: assigned/returned ->
// in_progress. This is the foundation the timing display (Slice B) and the work timer (D) hang off.
//
// WHAT THIS PREVENTS: the state where in_progress is never set (tasks jumped assigned->done, no start time) and
// nothing recorded transitions — so no queue/process duration could ever be computed.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'TL-' + Date.now();
async function mkRequest(id) {
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?, 'redaction', 'active') ON CONFLICT (id) DO NOTHING",
    [id, id, 'Test', 't@example.com', 'test ' + TAG]);
}
async function events(taskId) { return await db.all("SELECT from_status, to_status, at FROM task_events WHERE task_id = ? ORDER BY id", [taskId]); }

(async function () {
  await db.initDb();
  var U = 'u-police-staff', V = 'u-legal-super';
  var reqId = 'req-' + TAG;
  await mkRequest(reqId);

  console.log('\n=== A. THE BOOKMARK TRAIL — one row per status change, with stamps ===');
  var t = await tr.createTask({ type: 'record_search', requestId: reqId, createdBy: 'test' });
  var ev0 = await events(t.id);
  ok('A1 creating a task drops the first bookmark (-> open)', ev0.length === 1 && ev0[0].from_status === null && ev0[0].to_status === 'open');

  await tr.assign(t.id, U, 'manual');
  var rowA = await db.get('SELECT status, assigned_at, in_progress_at, done_at FROM tasks WHERE id = ?', [t.id]);
  var evA = await events(t.id);
  ok('A2 assigning stamps assigned_at + bookmarks open->assigned', !!rowA.assigned_at && evA.some(function (e) { return e.from_status === 'open' && e.to_status === 'assigned'; }));

  await tr.enterTask(t.id, U);
  var rowB = await db.get('SELECT status, in_progress_at FROM tasks WHERE id = ?', [t.id]);
  var evB = await events(t.id);
  ok('A3 begin-work -> in_progress, stamps in_progress_at, bookmarks assigned->in_progress',
    rowB.status === 'in_progress' && !!rowB.in_progress_at && evB.some(function (e) { return e.from_status === 'assigned' && e.to_status === 'in_progress'; }));

  await db.run("UPDATE tasks SET status = 'done' WHERE id = ?", [t.id]);
  var rowC = await db.get('SELECT status, done_at FROM tasks WHERE id = ?', [t.id]);
  var evC = await events(t.id);
  ok('A4 completing stamps done_at + bookmarks in_progress->done', rowC.status === 'done' && !!rowC.done_at && evC.some(function (e) { return e.from_status === 'in_progress' && e.to_status === 'done'; }));

  // The trail is a coherent chain: each bookmark's from_status equals the previous to_status.
  var chained = true;
  for (var i = 1; i < evC.length; i++) { if (evC[i].from_status !== evC[i - 1].to_status) chained = false; }
  ok('A5 the trail is a gap-free chain (open->assigned->in_progress->done), so any elapsed stretch is derivable',
    evC.length === 4 && chained && evC.map(function (e) { return e.to_status; }).join(',') === 'open,assigned,in_progress,done');

  console.log('\n=== B. THE ENTRY CONTRACT — owner-gated, idempotent, first-start preserved ===');
  var t2 = await tr.createTask({ type: 'redaction', requestId: reqId, createdBy: 'test' });
  await tr.assign(t2.id, U, 'manual');
  await tr.enterTask(t2.id, V); // V is NOT the owner
  ok('B1 a non-owner opening the task does NOT begin work (no clock start)',
    (await db.get('SELECT status FROM tasks WHERE id = ?', [t2.id])).status === 'assigned');

  await tr.enterTask(t2.id, U);
  var firstStart = (await db.get('SELECT in_progress_at FROM tasks WHERE id = ?', [t2.id])).in_progress_at;
  await tr.enterTask(t2.id, U); // again
  var afterAgain = await db.get('SELECT status, in_progress_at FROM tasks WHERE id = ?', [t2.id]);
  ok('B2 the owner beginning twice is idempotent (still in_progress, same start time)',
    afterAgain.status === 'in_progress' && afterAgain.in_progress_at === firstStart);

  // A correction round (returned -> in_progress) must NOT reset "when work first started".
  await db.run("UPDATE tasks SET status = 'returned' WHERE id = ?", [t2.id]);
  await tr.enterTask(t2.id, U);
  var afterRework = await db.get('SELECT status, in_progress_at FROM tasks WHERE id = ?', [t2.id]);
  ok('B3 re-entering after a return resumes in_progress but keeps the original first-start stamp',
    afterRework.status === 'in_progress' && afterRework.in_progress_at === firstStart);

  console.log('\n=== C. THE TIMING IS ANCHORED TO THE REQUEST (submit anchor) ===');
  var reqRow = await db.get('SELECT created_at FROM requests WHERE id = ?', [reqId]);
  var firstEv = (await events(t.id))[0];
  ok('C1 the request carries a submit anchor (created_at) the task trail ties back to', !!reqRow.created_at && !!firstEv.at);
  ok('C2 events carry request_id so a request-level timeline can be stitched from its tasks',
    (await db.get("SELECT COUNT(*)::int c FROM task_events WHERE request_id = ?", [reqId])).c >= 8);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
