'use strict';
// THE ONE REQUEST-CREATION HELPER (ARCHITECTURE item 5), and the live numbering bug it fixes.
//
// Before: THREE intake paths, THREE numbering algorithms, FIVE hardcoded deadline computations.
//   A. staff create      — MAX + 1                     (correct)
//   B. /public           — last row BY created_at, +1   (restarts at 0001 when the newest row carries a
//                                                        non-standard number like 'DEMO-2026-5069')
//   C. the live portal   — COUNT(*) + 1                (mints an EXISTING number the moment any request
//                                                        below the max is deleted → UNIQUE violation → 500)
// This harness DEMONSTRATES both broken algorithms against the real database, then proves the helper is
// immune — including under concurrency, which none of the three ever handled.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');

var TAG = 'RCREATE-' + Date.now();
var pass = 0, fail = 0, TOKEN = null, created = [];
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function submit(d, extra) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify(Object.assign({ description: d, requestorName: 'RC Test', requestorEmail: 'rc@example.com' }, extra || {}));
    var r = http.request({ host: 'localhost', port: (Number(process.env.API_PORT) || 3101), path: '/api/public/submit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      function (resp) { var body = ''; resp.on('data', function (c) { body += c; }); resp.on('end', function () { res({ status: resp.statusCode, body: body }); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}
async function findByTag(t) {
  var r = null;
  for (var i = 0; i < 60 && !r; i++) { r = await db.get('SELECT id, request_number FROM requests WHERE description LIKE ?', ['%' + t + '%']); await sleep(250); }
  if (r) created.push(r.id);
  return r;
}
var year = new Date().getFullYear();

(async function () {
  await db.initDb();
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);

    // =====================================================================================
    // 0. SOURCE: the drift is gone. One helper, no private numbering, no hardcoded deadlines.
    // =====================================================================================
    var reqSrc = fs.readFileSync('/opt/optimumq/backend/src/routes/requests.js', 'utf8');
    var chatSrc = fs.readFileSync('/opt/optimumq/backend/src/routes/publicChat.js', 'utf8');
    ok('routes/requests.js has NO private numbering function left', !/generateRequestNumber/.test(reqSrc));
    ok('routes/publicChat.js no longer mints numbers with COUNT(*) + 1', !/COUNT\(\*\) as n FROM requests WHERE request_number LIKE/.test(chatSrc));
    var inserts = (reqSrc + chatSrc).match(/INSERT INTO requests\s*\(/g) || [];
    ok('NEITHER intake route inserts into `requests` directly any more (' + inserts.length + ' raw inserts)', inserts.length === 0);
    var hardDeadlines = ((reqSrc + chatSrc).match(/simple:\s*5,\s*standard:\s*10/g) || []).length;
    ok('the hardcoded {simple:5, standard:10, complex:20, redaction_required:30} deadline table is gone from both routes (' + hardDeadlines + ' left)', hardDeadlines === 0);
    ok('deadline_date is no longer hand-written by the classifier path', !/deadline_date = \?[^]*cls\.deadlineDays/.test(chatSrc) && !/dl\.setDate\(dl\.getDate\(\) \+ \(cls\.deadlineDays/.test(chatSrc));

    // =====================================================================================
    // 1. THE BUG IS REAL — demonstrate BOTH broken algorithms against real numbered requests.
    // =====================================================================================
    // This used to read whatever requests HAPPENED to be in the live database, which meant the test was
    // silently borrowing state it did not create — and it crashed outright on an empty database (the fixture),
    // because `maxRow` came back null. A test must build the state it depends on. Create the baseline through
    // the REAL creation path if the numbering space for this year is empty.
    var haveRow = await db.get("SELECT COUNT(*) AS n FROM requests WHERE request_number LIKE ?", [year + '-%']);
    if (Number(haveRow.n) === 0) {
      // findByTag (not submit) is what REGISTERS the row for cleanup — submit only returns an HTTP status.
      for (var s = 0; s < 3; s++) {
        await submit('Numbering baseline ' + TAG + ' #' + s);
        await findByTag(TAG + ' #' + s);
      }
    }

    var maxRow = await db.get("SELECT request_number FROM requests WHERE request_number ~ ('^' || ? || '-[0-9]{" + RC.SEQ_DIGITS + "}$') ORDER BY request_number DESC LIMIT 1", [String(year)]);
    // WRAP-IN-PARENT: count only CITIZEN numbers, with the SAME strict pattern the helper sequences on.
    // `LIKE '2026-%'` also matches a CHILD's composite number (`2026-000001-1`), which doubles the count and
    // makes this simulation overshoot the max. That loose predicate is the identical class of bug this harness
    // exists to prove about algorithms B and C — the strict `^YYYY-[0-9]{6}$` is what excludes children.
    var countRow = await db.get("SELECT COUNT(*) AS n FROM requests WHERE request_number ~ ('^' || ? || '-[0-9]{" + RC.SEQ_DIGITS + "}$')", [String(year)]);
    ok('a numbering baseline exists to test against (' + countRow.n + ' requests this year)', !!maxRow);
    var maxSeq = parseInt(maxRow.request_number.split('-')[1], 10);
    var countSeq = Number(countRow.n);

    // Algorithm C (COUNT+1) is only safe while COUNT == MAX — i.e. only while the numbers are contiguous with
    // no gaps. This used to simulate the arithmetic on the AMBIENT corpus, which worked only because live
    // happened to hold 44 contiguous requests ("it works today only by coincidence: COUNT == MAX"). The
    // 2026-07-16 purge emptied the corpus and harness cleanup punches gaps in it, so the premise evaporated and
    // the assertion started failing on CORRECT code. CONSTRUCT the condition instead of hoping for it — in an
    // isolated far-future year so no other harness, fixture row, or purge can move it.
    var CY = '2999';
    await db.run("DELETE FROM requests WHERE request_number LIKE ?", [CY + '-%']);
    var cIds = [];
    for (var ci = 1; ci <= 3; ci++) {
      var cid = 'algoc-' + ci + '-' + Date.now();
      cIds.push(cid);
      await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description) VALUES (?,?,?,?,?)",
        [cid, CY + '-' + String(ci).padStart(RC.SEQ_DIGITS, '0'), 'AlgoC', 'algoc@example.com', 'algorithm C probe ' + TAG]);
    }
    var cMax = await db.get("SELECT request_number FROM requests WHERE request_number ~ ('^' || ? || '-[0-9]{" + RC.SEQ_DIGITS + "}$') ORDER BY request_number DESC LIMIT 1", [CY]);
    var cCount = await db.get("SELECT COUNT(*) AS n FROM requests WHERE request_number ~ ('^' || ? || '-[0-9]{" + RC.SEQ_DIGITS + "}$')", [CY]);
    ok('constructed a contiguous 3-request year: COUNT(' + cCount.n + ') == MAX(' + cMax.request_number + ') — the ONLY state where C is safe',
      Number(cCount.n) === 3 && cMax.request_number === CY + '-000003');
    // Delete the MIDDLE one. MAX is untouched at 3; COUNT drops to 2; C therefore mints 3 — which exists.
    await db.run("DELETE FROM requests WHERE request_number = ?", [CY + '-' + String(2).padStart(RC.SEQ_DIGITS, '0')]);
    var cCount2 = await db.get("SELECT COUNT(*) AS n FROM requests WHERE request_number ~ ('^' || ? || '-[0-9]{" + RC.SEQ_DIGITS + "}$')", [CY]);
    var cWould = CY + '-' + String(Number(cCount2.n) + 1).padStart(RC.SEQ_DIGITS, '0'); // C mints COUNT+1
    var cCollide = await db.get('SELECT id FROM requests WHERE request_number = ?', [cWould]);
    ok('ALGORITHM C IS BROKEN: delete the middle request and COUNT+1 = ' + cWould +
       ' — a number that ALREADY EXISTS (UNIQUE violation → intake 500s)', !!cCollide);
    // ...and the helper, on the same data, is right: MAX+1 = 4, which is free.
    var cNext = await RC.nextRequestNumber(CY);
    ok('...while the helper mints ' + cNext + ' — MAX+1, immune to the gap', cNext === CY + '-000004');
    await db.run("DELETE FROM requests WHERE request_number LIKE ?", [CY + '-%']);

    // Algorithm B (last row by created_at) restarts at 0001 when the newest row has a non-standard number.
    //
    // That pathological condition used to be BORROWED from the live database, which happened to contain
    // DEMO-/SYS-/LIBRARY- rows. On a clean fixture it does not exist, and the demonstration silently stopped
    // demonstrating anything (B would mint the next free number and the assertion failed). A test must
    // CONSTRUCT the state its bug needs. So: plant a non-standard-numbered row as the NEWEST request — the
    // library/demo shape that broke B in the first place — instead of hoping production still has one.
    var legacyId = require('uuid').v4();
    await db.run(
      "INSERT INTO requests (id, request_number, requestor_name, requestor_email, description) VALUES (?,?,?,?,?)",
      [legacyId, 'LIBRARY-' + TAG, 'Library Import', 'library@fixture.test',
       'A non-standard-numbered row (public library import), newest by created_at — this is what broke algorithm B.']
    );
    created.push(legacyId);

    var lastByCreated = await db.get('SELECT request_number FROM requests ORDER BY created_at DESC LIMIT 1');
    var parts = String(lastByCreated.request_number).split('-');
    var bWould = (parts[0] == year) ? (parseInt(parts[1], 10) + 1) : 1;
    var bCollides = await db.get('SELECT id FROM requests WHERE request_number = ?', [year + '-' + String(bWould).padStart(RC.SEQ_DIGITS, '0')]);
    ok('ALGORITHM B IS BROKEN: the newest row is "' + lastByCreated.request_number + '", so B would mint ' +
       year + '-' + String(bWould).padStart(RC.SEQ_DIGITS, '0') + ' — which ALREADY EXISTS', !!bCollides);

    // The helper's algorithm ignores non-standard numbers entirely and takes the true max.
    var next = await RC.nextRequestNumber();
    ok('the helper mints ' + next + ' — MAX(' + maxRow.request_number + ') + 1, ignoring DEMO-/SYS-/LIBRARY rows',
      next === year + '-' + String(maxSeq + 1).padStart(RC.SEQ_DIGITS, '0'));
    var clash = await db.get('SELECT id FROM requests WHERE request_number = ?', [next]);
    ok('...and that number does NOT already exist', !clash);

    // =====================================================================================
    // 1b. THE 10,000-REQUEST CEILING — the failure a large city would have hit in production.
    // =====================================================================================
    // The width used to be TWO separate literals: `padStart(4)` and a hardcoded `[0-9]{4}` lookup pattern. At
    // 9,999 requests the helper minted 2026-10000 and the INSERT succeeded (padStart does not truncate) — but
    // the 4-digit pattern COULD NOT SEE the 5-digit number, so "the highest so far" still read 9,999 and the
    // helper minted 2026-10000 a SECOND time. UNIQUE violation -> INTAKE 500s -> the city could not accept
    // another request for the rest of the year. Width now comes from ONE constant (RC.SEQ_DIGITS) so the pad
    // and the pattern cannot drift apart again. Construct the boundary; never borrow it.
    var CEIL = 'CEILTEST-' + Date.now();
    var atLimit = Math.pow(10, RC.SEQ_DIGITS - 2) - 1; // 9,999 when SEQ_DIGITS = 6
    var nines = require('uuid').v4();
    await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description) VALUES (?,?,?,?,?)",
      [nines, year + '-' + String(atLimit).padStart(RC.SEQ_DIGITS, '0'), 'Scale', 'scale@fixture.test',
       'the ' + atLimit + 'th request of the year ' + CEIL]);
    created.push(nines);

    var over1 = await RC.nextRequestNumber();
    var overId = require('uuid').v4();
    await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description) VALUES (?,?,?,?,?)",
      [overId, over1, 'Scale', 'scale@fixture.test', 'the request that crosses the old ceiling ' + CEIL]);
    created.push(overId);
    ok('crossing ' + atLimit + ': the helper mints ' + over1 + ' (' + RC.SEQ_DIGITS + '-digit, fixed width)',
      over1 === year + '-' + String(atLimit + 1).padStart(RC.SEQ_DIGITS, '0'));

    var over2 = await RC.nextRequestNumber();
    ok('THE OLD KILLER IS DEAD: the NEXT number is ' + over2 + ', not a repeat of ' + over1 +
       ' (the old code re-minted it and intake 500d on a UNIQUE violation)', over2 !== over1);

    var stillMax = await db.get("SELECT request_number FROM requests WHERE request_number ~ ('^' || ? || '-[0-9]{" + RC.SEQ_DIGITS + "}$') ORDER BY request_number DESC LIMIT 1", [String(year)]);
    ok('the LEXICAL max sort still returns the true highest (' + stillMax.request_number + ') across the ' +
       'boundary — this is WHY the width is fixed, not grow-as-needed', stillMax.request_number === over1);

    var widths = await db.all("SELECT DISTINCT length(request_number) AS n FROM requests WHERE request_number ~ '^[0-9]{4}-[0-9]+$'");
    ok('EVERY citizen number in the table is one uniform width (' + widths.map(function (w) { return w.n; }).join(', ') + ' chars)',
      widths.length === 1 && Number(widths[0].n) === 5 + RC.SEQ_DIGITS);

    // =====================================================================================
    // 2. THE HELPER SURVIVES WHAT BROKE ALGORITHM C: create, delete below the max, create again.
    // =====================================================================================
    var r1 = await submit('helper first ' + TAG);
    var q1 = await findByTag('helper first ' + TAG);
    ok('intake #1 through the real portal path succeeds (' + q1.request_number + ')', r1.status === 201 && !!q1);

    var r2 = await submit('helper second ' + TAG);
    var q2 = await findByTag('helper second ' + TAG);
    ok('intake #2 succeeds and does NOT reuse the number (' + q1.request_number + ' → ' + q2.request_number + ')',
      r2.status === 201 && q2.request_number !== q1.request_number);

    // delete the FIRST one — this is the exact move that breaks COUNT-based numbering
    await db.run('DELETE FROM request_history WHERE request_id = ?', [q1.id]);
    await db.run('DELETE FROM request_clocks WHERE request_id = ?', [q1.id]);
    await db.run('DELETE FROM requests WHERE id = ?', [q1.id]);
    created = created.filter(function (c) { return c !== q1.id; });

    var r3 = await submit('helper third ' + TAG);
    if (r3.status !== 201) console.log('    intake #3 response: ' + r3.status + ' ' + r3.body.slice(0, 200));
    var q3 = await findByTag('helper third ' + TAG);
    ok('AFTER A DELETION, intake #3 still succeeds — the bug that would have 500\'d the old portal (' +
      (q3 ? q3.request_number : 'NOT CREATED — ' + r3.status) + ')', r3.status === 201 && !!q3);
    if (!q3) throw new Error('intake #3 did not create a request: ' + r3.status + ' ' + r3.body.slice(0, 300));
    ok('...and it did NOT reuse the surviving request\'s number', q3.request_number !== q2.request_number);

    // =====================================================================================
    // 3. CONCURRENCY — two simultaneous submissions. No algorithm here ever handled this.
    // =====================================================================================
    var burst = await Promise.all([
      submit('burst A ' + TAG), submit('burst B ' + TAG), submit('burst C ' + TAG),
      submit('burst D ' + TAG), submit('burst E ' + TAG)
    ]);
    ok('5 CONCURRENT submissions all returned 201 (the retry-on-collision path held)',
      burst.every(function (b) { return b.status === 201; }));
    await sleep(1500);
    var burstRows = await db.all("SELECT id, request_number FROM requests WHERE description LIKE ?", ['%burst%' + TAG + '%']);
    burstRows.forEach(function (r) { created.push(r.id); });
    ok('all 5 were created (' + burstRows.length + ')', burstRows.length === 5);
    var nums = burstRows.map(function (r) { return r.request_number; });
    ok('all 5 numbers are DISTINCT — no duplicate minted under concurrency: ' + nums.sort().join(' '),
      new Set(nums).size === 5);

    // =====================================================================================
    // 4. THE DEADLINE NOW COMES FROM THE JURISDICTION, not a hardcoded table.
    // =====================================================================================
    var q3full = await db.get('SELECT deadline_date, classification FROM requests WHERE id = ?', [q3.id]);
    ok('the new request has a deadline_date', !!q3full.deadline_date);
    var clk = await db.get("SELECT duration, basis FROM request_clocks WHERE request_id = ? AND is_primary = 1", [q3.id]);
    ok('a primary clock was started by the helper (' + clk.duration + ' ' + clk.basis + ')', !!clk);
    var T = require('/opt/optimumq/backend/src/services/tolling');
    var rules = await T.loadRules();
    var expected = rules.clocks.respond.durationByClassification[q3full.classification || 'standard'];
    ok('the clock duration came from the JURISDICTION\'s durationByClassification (' + q3full.classification + ' → ' + expected + ')',
      Number(clk.duration) === Number(expected));
    var st = (await T.statusForRequest(q3.id)).filter(function (c) { return c.isPrimary; })[0];
    ok('requests.deadline_date equals the DERIVED due date — one source of truth', q3full.deadline_date === st.dueDate);

    // =====================================================================================
    // 5. HISTORY: exactly one CREATED row per request, from the one helper.
    // =====================================================================================
    var hist = await db.all("SELECT action FROM request_history WHERE request_id = ? AND action IN ('CREATED','REQUEST_CREATED')", [q3.id]);
    ok('exactly one creation history row was written (' + hist.length + ')', hist.length === 1);

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
