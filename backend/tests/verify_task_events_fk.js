'use strict';
// TASK_EVENTS FK (fk_task_events_task_id). The bookmark trail's task_id was an unenforced reference:
// request purges cascaded tasks away (fk_tasks_request_id) but left the tasks' bookmarks behind — 74
// orphans had accumulated live by 2026-08-12, and every purge script swept them by hand. The FK takes
// the bookmarks with their task: request -> tasks -> task_events is now one cascade chain, and a
// bookmark can never be written for a task that doesn't exist.
//
// WHAT THIS PREVENTS: audit debris that silently accumulates on every test/smoke purge and breaks
// census parity, plus any future writer inserting bookmarks that point at nothing.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'TEFK-' + Date.now();
async function mkRequest(id) {
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?, 'record_search', 'active') ON CONFLICT (id) DO NOTHING",
    [id, id, 'Test', 't@example.com', 'test ' + TAG]);
}

(async function () {
  await db.initDb();

  console.log('\n=== A. THE CONSTRAINT EXISTS AND THE BACKFILL RAN ===');
  var con = await db.get(
    "SELECT confdeltype FROM pg_constraint WHERE conrelid = 'task_events'::regclass AND conname = 'fk_task_events_task_id'");
  ok('A1 fk_task_events_task_id exists with ON DELETE CASCADE', !!con && con.confdeltype === 'c');
  var orph = await db.get(
    'SELECT count(*)::int AS n FROM task_events te WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = te.task_id)');
  ok('A2 zero orphaned bookmarks after schema (the guarded backfill leaves none behind)', orph.n === 0);

  console.log('\n=== B. THE FK BITES — no bookmark for a task that does not exist ===');
  var refused = false;
  try {
    await db.run("INSERT INTO task_events (task_id, to_status) VALUES (?, 'open')", ['no-such-task-' + TAG]);
  } catch (e) { refused = true; }
  ok('B1 inserting a bookmark for a nonexistent task is refused', refused);

  console.log('\n=== C. THE CASCADE CHAIN — request -> tasks -> task_events ===');
  var reqId = 'req-' + TAG;
  await mkRequest(reqId);
  var t1 = await tr.createTask({ type: 'record_search', requestId: reqId, createdBy: 'test' });
  await tr.assign(t1.id, 'u-police-staff', 'manual');
  var n1 = (await db.get('SELECT count(*)::int AS n FROM task_events WHERE task_id = ?', [t1.id])).n;
  ok('C1 the task accumulated bookmarks through its real lifecycle (' + n1 + ')', n1 >= 2);

  // A bystander on a DIFFERENT request, to prove the cascade does not over-delete.
  var reqId2 = 'req2-' + TAG;
  await mkRequest(reqId2);
  var t2 = await tr.createTask({ type: 'record_search', requestId: reqId2, createdBy: 'test' });
  var n2 = (await db.get('SELECT count(*)::int AS n FROM task_events WHERE task_id = ?', [t2.id])).n;

  await db.run('DELETE FROM requests WHERE id = ?', [reqId]);
  var taskGone = !(await db.get('SELECT 1 AS x FROM tasks WHERE id = ?', [t1.id]));
  var evGone = (await db.get('SELECT count(*)::int AS n FROM task_events WHERE task_id = ?', [t1.id])).n === 0;
  ok('C2 deleting the request cascades its tasks away (fk_tasks_request_id, unchanged)', taskGone);
  ok('C3 ... and the tasks take their bookmarks with them (the new link)', evGone);
  var n2After = (await db.get('SELECT count(*)::int AS n FROM task_events WHERE task_id = ?', [t2.id])).n;
  ok('C4 the bystander task on another request kept all its bookmarks', n2After === n2 && n2 >= 1);

  console.log('\n=== D. NO NEW ORPHAN SOURCE SURVIVES ===');
  await db.run('DELETE FROM tasks WHERE id = ?', [t2.id]);
  var evGone2 = (await db.get('SELECT count(*)::int AS n FROM task_events WHERE task_id = ?', [t2.id])).n === 0;
  ok('D1 deleting a task directly also takes its bookmarks', evGone2);
  await db.run('DELETE FROM requests WHERE id = ?', [reqId2]);
  var orphEnd = await db.get(
    'SELECT count(*)::int AS n FROM task_events te WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = te.task_id)');
  ok('D2 zero orphaned bookmarks at end — the debris source is closed', orphEnd.n === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
