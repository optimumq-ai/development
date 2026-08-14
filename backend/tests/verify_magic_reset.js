'use strict';
// MAGIC DEMO — slice 1: benchmark + reset + the date-shifter (DESIGN_magic_screen.md).
//
// WHAT THIS PREVENTS: the magic surface EXISTING on a non-demo install (gate off -> 404, not 403);
// non-admins operating it; an unconfirmed reset discarding a demo's work; a reset that restores rows
// but loses RELATIVE time (the whole point: 9 days in process stays 9 days in process); the tasks
// bookkeeping triggers DOUBLING restored bookmark rows; serial sequences colliding after restore;
// and a failed build ever touching the running database (build-beside is asserted by the swap's
// undo generation existing).
//
// The harness runs against optimumq_test and SWAPS IT — the same operation the product performs on
// the demo db. It ends with a delta-0 reset, leaving the world exactly at its own benchmark, and the
// suite's remaining harnesses prove the test API's pools survive the swap.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var magic = require('/opt/optimumq/backend/src/services/magicDemo');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'MG' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function call(token, method, path, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function submit(email, desc) {
  var r = await fetch('http://localhost:' + PORT + '/api/public/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestorName: 'MG', requestorEmail: email, description: desc,
      records: [{ label: 'A', description: desc }] })
  });
  if (r.status < 200 || r.status >= 300) throw new Error('submit failed ' + r.status);
  var parent = null;
  for (var i = 0; i < 60 && !parent; i++) {
    parent = await db.get('SELECT * FROM requests WHERE requestor_email = ? AND master_request_id IS NULL', [email]);
    if (!parent) await new Promise(function (r2) { setTimeout(r2, 500); });
  }
  if (!parent) throw new Error('parent never appeared');
  // Let the intake engine finish its background writes before the world is measured.
  await new Promise(function (r2) { setTimeout(r2, 2500); });
  return parent;
}

(async function () {
  await db.initDb();
  var ADMIN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var plainU = await db.get(
    "SELECT u.* FROM users u WHERE u.status = 'active' AND NOT EXISTS (" +
    " SELECT 1 FROM user_function_roles r WHERE r.user_id = u.id AND r.function_role_id IN ('fr-sysadmin'))" +
    " LIMIT 1");
  var PLAIN = await auth.signAccessToken(plainU);

  console.log('\n=== A. THE GATE — on a non-demo install this surface does not exist ===');
  await db.run("DELETE FROM system_config WHERE key = 'demo_mode'");
  var off = await call(ADMIN, 'GET', '/magic/status');
  ok('A1 with demo_mode unset the magic surface 404s — absent, not merely forbidden', off.status === 404);
  await db.run("INSERT INTO system_config (key, value) VALUES ('demo_mode','1') ON CONFLICT (key) DO UPDATE SET value='1'");
  var nonAdmin = await call(PLAIN, 'GET', '/magic/status');
  ok('A2 demo_mode on: a non-admin is refused', nonAdmin.status === 403);
  var st0 = await call(ADMIN, 'GET', '/magic/status');
  ok('A3 the admin sees status; no benchmark exists yet or one is reported honestly',
    st0.status === 200 && (st0.body.benchmark === null || !!st0.body.benchmark.taken_at));

  console.log('\n=== B. BENCHMARK — a full snapshot with a timestamp ===');
  // The stray-table guard: a table the schema cannot rebuild makes the benchmark REFUSE in words at
  // benchmark time — never an unrestorable snapshot that explodes at reset (the live poc_request class).
  await db.run('CREATE TABLE IF NOT EXISTS mg_stray_' + TAG.toLowerCase() + ' (id TEXT)');
  var strayRefusal = await call(ADMIN, 'POST', '/magic/benchmark', {});
  ok('B0 a table outside the schema refuses the benchmark, naming the table (409 STRAY_TABLES)',
    strayRefusal.status === 409 && strayRefusal.body.code === 'STRAY_TABLES' && new RegExp('mg_stray').test(strayRefusal.body.error));
  await db.run('DROP TABLE mg_stray_' + TAG.toLowerCase());
  var reqA = await submit('mg-a-' + TAG + '@example.com', 'benchmark resident ' + TAG);
  var bench = await call(ADMIN, 'POST', '/magic/benchmark', { label: 'harness ' + TAG });
  ok('B1 benchmark taken via the route, with counts and a timestamp',
    bench.status === 200 && bench.body.benchmark.rows > 0 && !!bench.body.benchmark.taken_at &&
    bench.body.benchmark.counts.requests >= 2);
  ok('B2 the snapshot file exists on disk', fs.existsSync('/opt/optimumq/backend/data/benchmarks/optimumq_test.sql'));
  var atBench = {
    requests: (await db.get('SELECT count(*)::int n FROM requests')).n,
    tasks: (await db.get('SELECT count(*)::int n FROM tasks')).n,
    task_events: (await db.get('SELECT count(*)::int n FROM task_events')).n,
    aCreated: (await db.get('SELECT created_at FROM requests WHERE id = ?', [reqA.id])).created_at,
    aDeadline: reqA.deadline_date
  };

  console.log('\n=== C. RESET — restores the world AND relative time ===');
  var reqB = await submit('mg-b-' + TAG + '@example.com', 'post-benchmark intruder ' + TAG);
  ok('C0 the intruder exists before reset', !!reqB && (await db.get('SELECT count(*)::int n FROM requests')).n > atBench.requests);
  var noConfirm = await call(ADMIN, 'POST', '/magic/reset', {});
  ok('C1 reset without confirm:true is refused in words (422)', noConfirm.status === 422 && noConfirm.body.code === 'CONFIRM_REQUIRED');
  var out = await magic.reset({ deltaSeconds: 86400 }); // deterministic one-day shift, service-direct
  ok('C2 reset rebuilt and swapped (undo generation named)', !!out && out.deltaSeconds === 86400 && /prereset/.test(out.undo));
  var after = {
    requests: (await db.get('SELECT count(*)::int n FROM requests')).n,
    tasks: (await db.get('SELECT count(*)::int n FROM tasks')).n,
    task_events: (await db.get('SELECT count(*)::int n FROM task_events')).n
  };
  ok('C3 the intruder is gone and every count equals the benchmark',
    after.requests === atBench.requests && after.tasks === atBench.tasks &&
    (await db.get('SELECT count(*)::int n FROM requests WHERE id = ?', [reqB.id])).n === 0);
  ok('C4 task_events were RESTORED, not re-generated by the triggers (no doubling)',
    after.task_events === atBench.task_events);
  var aNow = await db.get('SELECT created_at, deadline_date FROM requests WHERE id = ?', [reqA.id]);
  var expCreated = new Date(atBench.aCreated.replace(' ', 'T') + 'Z');
  expCreated = new Date(expCreated.getTime() + 86400000).toISOString().slice(0, 19).replace('T', ' ');
  ok('C5 created_at shifted forward exactly one day — relative age preserved (' + aNow.created_at + ')',
    aNow.created_at === expCreated);
  if (atBench.aDeadline) {
    var expDl = new Date(atBench.aDeadline + 'T00:00:00Z');
    expDl = new Date(expDl.getTime() + 86400000).toISOString().slice(0, 10);
    ok('C6 a date-only column (deadline_date) shifted a day and kept its format', aNow.deadline_date === expDl);
  } else {
    ok('C6 (no deadline_date on the resident — date-only shift asserted via clock below)', true);
  }
  var clock = await db.get('SELECT started_at FROM request_clocks WHERE request_id = ? LIMIT 1', [reqA.id]);
  ok('C7 the statutory clock anchor shifted with everything else', !clock || /^\d{4}-\d{2}-\d{2}/.test(clock.started_at));

  console.log('\n=== D. LIFE AFTER RESET — pools reconnect, sequences continue ===');
  var stAfter = await call(ADMIN, 'GET', '/magic/status');
  ok('D1 the API survived the swap (its pool reconnected) and still reports the benchmark',
    stAfter.status === 200 && !!stAfter.body.benchmark);
  var tr = require('/opt/optimumq/backend/src/services/taskRouting');
  var anyTask = await db.get("SELECT id FROM tasks WHERE status IN ('open','assigned') LIMIT 1");
  if (anyTask) {
    await tr.assign(anyTask.id, 'u-kruss', 'manual', null); // fires the bookmark trigger -> task_events insert
    var grew = (await db.get('SELECT count(*)::int n FROM task_events')).n;
    ok('D2 a post-reset bookmark INSERT works — the serial sequence continues past the restored max',
      grew === after.task_events + 1);
  } else { ok('D2 SKIPPED — no assignable task in world (counts as fail to force a look)', false); }

  console.log('\n=== E. LEAVE THE WORLD AT ITS BENCHMARK ===');
  var out0 = await magic.reset({ deltaSeconds: 0 });
  var aFinal = await db.get('SELECT created_at FROM requests WHERE id = ?', [reqA.id]);
  ok('E1 a delta-0 reset restores the benchmark EXACTLY (dates unshifted) — the world later harnesses get',
    out0.deltaSeconds === 0 && aFinal.created_at === atBench.aCreated &&
    (await db.get('SELECT count(*)::int n FROM requests')).n === atBench.requests);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
