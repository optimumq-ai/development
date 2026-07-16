'use strict';
// CONCURRENT TOLLS — the statutory clock may be held by more than one reason at a time.
//
// The bug this harness locks shut (found 2026-07-16, live on the flat schema):
//   1. toll() guarded per CLOCK, not per REASON: `if (open) return {alreadyTolled:true}`. A record going to
//      the AG while a clarification was open NEVER REGISTERED — silently, no error, no ledger row.
//   2. resume() closed EVERY open toll and flipped the clock to 'running'. So answering the clarification
//      ran the clock while the request was still legally suspended at the AG. The city burns statutory days
//      it was entitled to suspend, and nothing records that it happened.
//   3. computeStatus SUMMED toll intervals — safe only because of (1). Allowing concurrency without union
//      math double-counts the overlap and pushes the due date PAST what the law allows, while the dashboard
//      still reports compliant. Same class as the 10,000 numbering ceiling: a wrong number that looks right.
//
// Required shape (SPEC_parent_child_lifecycle.md §4.2.1): concurrent tolls, idempotent PER REASON,
// tolled_days = UNION of intervals (never the sum), and the clock resumes only when the LAST toll closes.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var T = require('/opt/optimumq/backend/src/services/tolling');

var TAG = 'CTOLL-' + Date.now();
var pass = 0, fail = 0, created = [];
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function submit(d) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify({ description: d, requestorName: 'CToll Test', requestorEmail: 'ctoll@example.com' });
    var r = http.request({ host: 'localhost', port: (Number(process.env.API_PORT) || 3101), path: '/api/public/submit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      function (resp) { resp.on('data', function () {}); resp.on('end', function () { res(resp.statusCode); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}
async function newRequest(label) {
  await submit(label + ' ' + TAG);
  var req = null;
  for (var i = 0; i < 60 && !req; i++) { req = await db.get('SELECT id FROM requests WHERE description LIKE ?', ['%' + label + ' ' + TAG + '%']); await sleep(250); }
  if (!req) throw new Error('not created: ' + label);
  created.push(req.id);
  var clk = null;
  for (var j = 0; j < 40 && !clk; j++) { clk = await db.get("SELECT * FROM request_clocks WHERE request_id = (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?) AND is_primary = 1", [req.id]); await sleep(250); }
  return { req: req, clock: clk };
}
async function primaryState(rid) {
  return (await T.statusForRequest(rid)).filter(function (c) { return c.isPrimary; })[0];
}
async function openCount(clockId) {
  var r = await db.get("SELECT COUNT(*) AS n FROM clock_tolls WHERE clock_id = ? AND tolled_until IS NULL", [clockId]);
  return Number(r.n);
}
// Synthetic clock for the pure union math — no DB, no wall-clock, fully deterministic.
function synth(tolls, startedAt) {
  return T.computeStatus(
    { id: 'c', request_id: 'r', clock_type: 'respond', label: 'x', basis: 'calendar_days', duration: 10,
      started_at: startedAt || '2026-01-01 00:00:00', status: 'running', is_primary: 1, satisfied_at: null },
    tolls, { weekend: [], holidays: [] } // no weekends/holidays: calendar days == raw days, so the math is readable
  );
}

(async function () {
  await db.initDb();
  try {
    // ============ 1. THE UNION MATH (deterministic, no DB) ============
    // Overlap: A Jan 1-10, B Jan 5-15. Summed = 20. Actually suspended = 15 (Jan 1 -> Jan 15).
    var overlap = synth([
      { tolled_from: '2026-01-01 00:00:00', tolled_until: '2026-01-11 00:00:00' }, // 10 days
      { tolled_from: '2026-01-06 00:00:00', tolled_until: '2026-01-16 00:00:00' }  // 10 days, 5 overlapping
    ]);
    ok('OVERLAPPING tolls count the UNION (15), not the sum (20) — got ' + overlap.tolledDays, overlap.tolledDays === 15);
    ok('...so the due date is NOT pushed past what the law allows', overlap.tolledDays < 20);

    // Disjoint spans must still add up — the fix must not under-count either.
    var disjoint = synth([
      { tolled_from: '2026-01-01 00:00:00', tolled_until: '2026-01-06 00:00:00' }, // 5
      { tolled_from: '2026-02-01 00:00:00', tolled_until: '2026-02-04 00:00:00' }  // 3
    ]);
    ok('DISJOINT tolls still SUM (5 + 3 = 8) — the union must not under-count', disjoint.tolledDays === 8);

    // Fully-contained interval contributes nothing extra.
    var contained = synth([
      { tolled_from: '2026-01-01 00:00:00', tolled_until: '2026-01-21 00:00:00' }, // 20
      { tolled_from: '2026-01-05 00:00:00', tolled_until: '2026-01-09 00:00:00' }  // wholly inside
    ]);
    ok('a toll wholly CONTAINED in another adds nothing (20)', contained.tolledDays === 20);

    // Adjacent (touching) spans merge into one continuous suspension.
    var adjacent = synth([
      { tolled_from: '2026-01-01 00:00:00', tolled_until: '2026-01-06 00:00:00' },
      { tolled_from: '2026-01-06 00:00:00', tolled_until: '2026-01-11 00:00:00' }
    ]);
    ok('ADJACENT tolls merge into one span (10)', adjacent.tolledDays === 10);

    // Order must not matter — the merge sorts first.
    var reversed = synth([
      { tolled_from: '2026-01-06 00:00:00', tolled_until: '2026-01-16 00:00:00' },
      { tolled_from: '2026-01-01 00:00:00', tolled_until: '2026-01-11 00:00:00' }
    ]);
    ok('ledger ORDER does not change the answer (15 either way)', reversed.tolledDays === 15);

    // The restart clamp must still hold with union math (pre-epoch toll time does not count).
    var clamped = synth([{ tolled_from: '2025-12-01 00:00:00', tolled_until: '2026-01-06 00:00:00' }], '2026-01-01 00:00:00');
    ok('REGRESSION: toll time BEFORE the clock epoch is still clamped away (5, not 36)', clamped.tolledDays === 5);

    // ============ 2. CONCURRENCY — the bug itself ============
    var A = await newRequest('ag plus clarification');
    ok('setup: a primary respond clock exists', !!A.clock);

    var t1 = await T.toll(A.clock.id, 'clarification_pending', 'requestor asked to narrow');
    ok('first hold (clarification) tolls the clock', !!t1.tolled);

    // THE BUG: this used to return {alreadyTolled:true} and write nothing.
    var t2 = await T.toll(A.clock.id, 'ag_ruling_pending', 'record 2 sent to the AG');
    ok('a SECOND hold with a DIFFERENT reason REGISTERS (this was silently dropped)', !!t2.tolled);
    ok('...and the clock now knows it is held by TWO reasons', t2.openTolls === 2);
    ok('...and both are really in the ledger', (await openCount(A.clock.id)) === 2);

    // Same reason twice is still a no-op — idempotency is per reason, not abandoned.
    var dup = await T.toll(A.clock.id, 'clarification_pending', 'again');
    ok('the SAME reason twice is still an idempotent no-op', dup.alreadyTolled === true && !dup.tolled);
    ok('...and wrote no duplicate ledger row', (await openCount(A.clock.id)) === 2);

    // ============ 3. THE KILLER: resuming one hold must not release the other ============
    var r1 = await T.resume(A.clock.id, 'clarification_pending');
    ok('answering the clarification closes ONLY that hold', r1.openTolls === 1);
    ok('...the clock is NOT reported resumed while the AG still holds it', r1.resumed === false && r1.stillTolled === true);
    var st = await primaryState(A.req.id);
    ok('...and the clock STATE is still tolled (it used to start running here — the bug)', st.state === 'tolled');
    ok('...and it is not counted overdue while legally suspended', st.isOverdue === false);
    var row = await db.get("SELECT status FROM request_clocks WHERE id = ?", [A.clock.id]);
    ok('...the persisted row agrees with the derived view', row.status === 'tolled');

    var r2 = await T.resume(A.clock.id, 'ag_ruling_pending');
    ok('closing the LAST hold finally resumes the clock', r2.resumed === true && r2.openTolls === 0);
    var st2 = await primaryState(A.req.id);
    ok('...and the clock is running again', st2.state === 'running');

    // ============ 4. The bare resume() override still clears everything ============
    var B = await newRequest('manual override');
    await T.toll(B.clock.id, 'clarification_pending', 'x');
    await T.toll(B.clock.id, 'ag_ruling_pending', 'y');
    ok('setup: two concurrent holds', (await openCount(B.clock.id)) === 2);
    var rAll = await T.resume(B.clock.id); // no reason = deliberate admin override
    ok('resume() with NO reason clears every hold (the manual override)', rAll.resumed === true && rAll.openTolls === 0);
    ok('...and the clock runs', (await primaryState(B.req.id)).state === 'running');

    // ============ 5. restart() still closes everything (a re-receipt is a fresh clock) ============
    var C = await newRequest('restart closes all');
    await T.toll(C.clock.id, 'clarification_pending', 'x');
    await T.toll(C.clock.id, 'ag_ruling_pending', 'y');
    var rs = await T.restart(C.clock.id);
    ok('REGRESSION: restart() closes ALL holds — a re-receipt is a clean full clock', !!rs.restarted && (await openCount(C.clock.id)) === 0);
    var st3 = await primaryState(C.req.id);
    ok('...and the restarted clock is running with 0 tolled days counted', st3.state === 'running' && st3.tolledDays === 0);

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t = 0; t < tabs.length; t++) for (var c = 0; c < created.length; c++) {
        try { await db.run('DELETE FROM ' + tabs[t].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c2 = 0; c2 < created.length; c2++) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c2]]); } catch (e) {} }
      var left = await db.get('SELECT COUNT(*) AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 test requests remain', Number(left.n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
