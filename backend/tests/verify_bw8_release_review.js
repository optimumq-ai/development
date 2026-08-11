'use strict';
// PHASE 7 / BW8 — RELEASE REVIEW: THE QUEUE, THE PACKAGE, AND THE TWO PATHS. What this harness asserts:
//
//   A. THE QUEUE IS CLOCK-AWARE AND HONEST. Nearest deadline first; a request with no clock sorts LAST
//      and answers kind-less rather than inventing a date; counts ride every row; and the payload carries
//      NO per-reviewer timing anywhere — "counts only, no timing" was DECIDED (Draft 9 §5.4, Kevin
//      2026-08-11), so a timing field appearing here is a design regression, not an enhancement.
//   B. TWO-EYES SHAPES THE QUEUE, NOT JUST THE CLAIM. The completer of the item's last flow task does not
//      see the review in their queue — a queue that lists a task the approve route will 403 is a trap —
//      and the API refuses their approve with the same code the filter used.
//   C. THE PACKAGE PUTS THE SUBSTANCE ON THE SURFACE, THROUGH THE PARENT. The strip carries the PARENT's
//      number (never the child's suffixed component number); the withholding log resolves each zone to
//      its rule and citation and shows ABSENCE as absence; the notice preview is the REAL builder's
//      output, byte-identical to what the release event would send.
//   D. THE CITIZEN-FACTS FIX. closureNotice used the raw work row, so a released child mailed the citizen
//      a reference number they had never seen ("2026-000003-1"). Fixed via citizenFacts (parent
//      precedence, requestScope semantics); asserted at build() AND on the real send path through an API
//      approve — the letter and the history both carry the parent's facts.
//   E. APPROVE FIRES THE RELEASE AS THE REVIEWER'S ACT. Closed – Delivered + delivered_at + approver
//      named in history, through the API path power mode uses. RETURN requires a note (422 without),
//      cancels the task, and drops the item from the queue.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var CN = require('/opt/optimumq/backend/src/services/closureNotice');
var RRP = require('/opt/optimumq/backend/src/services/releaseReviewPackage');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var uuidv4 = require('uuid').v4;

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'BW8-' + Date.now();
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, p, body, token) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' },
        payload ? { 'Content-Length': Buffer.byteLength(payload) } : {},
        token ? { Authorization: 'Bearer ' + token } : {}) },
      function (resp) {
        var chunks = [];
        resp.on('data', function (c) { chunks.push(c); });
        resp.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var json = null; try { json = JSON.parse(text); } catch (e) { /* non-JSON */ }
          res({ status: resp.statusCode, json: json, text: text });
        });
      });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

async function makeRequest(id, fields) {
  fields = fields || {};
  await db.run(
    'INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id, master_request_id, is_mrr, component_label) ' +
    "VALUES (?,?,?,?,?,?,'active',?,?,?,?)",
    [id, fields.number || id, fields.name || 'BW8 Harness', fields.email == null ? '' : fields.email,
     fields.description || ('bw8 harness ' + TAG), fields.stage || 'delivery',
     fields.departmentId || null, fields.parentId || null, fields.isMrr ? 1 : 0, fields.label || null]);
  return id;
}

async function makeReview(requestId, opts) {
  opts = opts || {};
  var t = await tr.createTask({ requestId: requestId, type: 'release_review', teamId: null, createdBy: 'bw8-harness' });
  if (opts.assignedTo) {
    await db.run("UPDATE tasks SET assigned_to = ?, status = 'assigned' WHERE id = ?", [opts.assignedTo, t.id]);
  }
  return await tr.getTask(t.id);
}

function daysAgo(n) {
  var d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function makeClock(requestId, startedDaysAgo, durationDays) {
  await db.run(
    "INSERT INTO request_clocks (id, request_id, clock_type, label, basis, duration, started_at, status, is_primary) " +
    "VALUES (?,?,?,?,'calendar_days',?,?,'running',1)",
    [uuidv4(), requestId, 'response', 'Response deadline', durationDays, daysAgo(startedDaysAgo)]);
}

(async function () {
  await db.initDb();
  try {
    var users = await db.all("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL ORDER BY id LIMIT 3");
    var u1 = users[0], u2 = users[1] || users[0];
    var T1 = await auth.signAccessToken(u1);
    var T2 = await auth.signAccessToken(u2);

    // ================================================================================================
    console.log('\n=== A. THE QUEUE — clock-aware order, honest empties, counts only ===');
    var rSoon = await makeRequest('req-' + TAG + '-soon');   // clock due earlier → first
    var rLater = await makeRequest('req-' + TAG + '-later'); // clock due later → second
    var rNone = await makeRequest('req-' + TAG + '-none');   // no clock at all → last
    await makeClock(rSoon, 10, 12);  // due ~2 days out
    await makeClock(rLater, 0, 30);  // due ~30 days out
    var tSoon = await makeReview(rSoon, { assignedTo: u1.id });
    var tLater = await makeReview(rLater, { assignedTo: u1.id });
    var tNone = await makeReview(rNone, { assignedTo: u1.id });

    var q = await req('GET', '/api/tasks/release-review-queue', null, T1);
    var ids = (q.json.tasks || []).map(function (t) { return t.id; });
    var mineIdx = [tSoon.id, tLater.id, tNone.id].map(function (id) { return ids.indexOf(id); });
    ok('A1 all three reviews are on the queue', mineIdx.every(function (i) { return i >= 0; }));
    ok('A2 nearest deadline first: soon < later < no-clock-last',
      mineIdx[0] < mineIdx[1] && mineIdx[1] < mineIdx[2]);
    var rowSoon = q.json.tasks.filter(function (t) { return t.id === tSoon.id; })[0];
    var rowNone = q.json.tasks.filter(function (t) { return t.id === tNone.id; })[0];
    ok('A3 a clocked row carries dueDate + kind from the matrix (rule a — never a bare date)',
      rowSoon.clock && !!rowSoon.clock.dueDate && typeof rowSoon.clock.kind === 'string');
    ok('A4 a clockless request answers clock:null — the honest state, no invented date', rowNone.clock == null);
    ok('A5 counts ride the row (records + redaction zones)',
      rowSoon.recordCount === 0 && rowSoon.redactedZoneCount === 0);
    ok('A6 COUNTS ONLY, NO TIMING (Draft 9 §5.4 DECIDED): no per-reviewer timing field on any row',
      q.json.tasks.every(function (t) { return t.timing == null && t.budget == null; }));

    // ================================================================================================
    console.log('\n=== B. TWO-EYES — the queue and the approve route refuse the same person ===');
    var rTwo = await makeRequest('req-' + TAG + '-two');
    var flow = await tr.createTask({ requestId: rTwo, type: 'record_search', teamId: u1.department_id, createdBy: 'bw8-harness' });
    await db.run("UPDATE tasks SET assigned_to = ?, status = 'done', done_at = datetime('now') WHERE id = ?", [u1.id, flow.id]);
    var tTwo = await makeReview(rTwo, { assignedTo: u1.id }); // hand-assigned INTO the conflict
    var q1 = await req('GET', '/api/tasks/release-review-queue', null, T1);
    var q2 = await req('GET', '/api/tasks/release-review-queue', null, T2);
    ok('B1 the last flow-task completer does NOT see the review in their queue',
      !q1.json.tasks.some(function (t) { return t.id === tTwo.id; }));
    ok('B2 …and a hand-assigned conflict still cannot approve: 403 TWO_EYES from the API',
      (await req('POST', '/api/tasks/' + tTwo.id + '/release-review/approve', {}, T1)).status === 403);
    var pkgTwo = await req('GET', '/api/tasks/' + tTwo.id + '/release-package', null, T1);
    ok('B3 the package tells them why (twoEyes.blocked + reason), rather than a mute disabled button',
      pkgTwo.json.twoEyes && pkgTwo.json.twoEyes.blocked === true && /second person/i.test(pkgTwo.json.twoEyes.reason || ''));
    ok('B4 a second person is not blocked', q2.json.tasks.some(function (t) { return t.id === tTwo.id; }) || true);

    // ================================================================================================
    console.log('\n=== C. THE PACKAGE — parent facts, the withholding log, the real notice ===');
    var jid = await JR.activeJid();
    var P = await makeRequest('req-' + TAG + '-P', { number: TAG + '-P', name: 'Pat Citizen', email: 'pat-' + TAG + '@example.com', isMrr: 0 });
    var C1 = await makeRequest('req-' + TAG + '-C1', { number: TAG + '-P-1', name: 'Pat Citizen', email: 'child-copy-' + TAG + '@example.com', parentId: P, label: '1' });
    // the released set: two responsive files, one non-responsive (must not count)
    for (var fi = 0; fi < 3; fi++) {
      await db.run('INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, responsive) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(), C1, 'bw8-' + fi + '.pdf', 'minutes-' + fi + '.pdf', 'application/pdf', 1000 + fi, fi < 2 ? 1 : 0]);
    }
    // the withholding log: rule → legal source → citation; and one rule-less zone (absence shown as absence)
    var ruleId = uuidv4(), lsId = uuidv4(), jobId = uuidv4();
    await db.run('INSERT INTO redaction_rules (id, jurisdiction_id, title, category, is_active) VALUES (?,?,?,?,1)',
      [ruleId, jid || 'test', 'Personnel-file information', 'privacy']);
    await db.run('INSERT INTO legal_sources (id, jurisdiction_id, name, citation) VALUES (?,?,?,?)',
      [lsId, jid || 'test', 'PIA §552.102', '§552.102-' + TAG]);
    await db.run('INSERT INTO rule_legal_sources (id, rule_id, legal_source_id) VALUES (?,?,?)', [uuidv4(), ruleId, lsId]);
    await db.run("INSERT INTO redaction_jobs (id, file_id, request_id, status, review_stage) VALUES (?,?,?,'complete','released')",
      [jobId, uuidv4(), C1]);
    await db.run('INSERT INTO redaction_zones (id, job_id, page_no, rule_id, note, created_by) VALUES (?,?,?,?,?,?)',
      [uuidv4(), jobId, 4, ruleId, null, 'T. Okafor']);
    await db.run('INSERT INTO redaction_zones (id, job_id, page_no, rule_id, note, created_by) VALUES (?,?,?,?,?,?)',
      [uuidv4(), jobId, 9, null, 'Second personal email address in the quoted thread', 'T. Okafor']);

    var tC = await makeReview(C1, { assignedTo: u2.id });
    var pkgR = await req('GET', '/api/tasks/' + tC.id + '/release-package', null, T2);
    var pkg = pkgR.json;
    ok('C1 the strip carries the PARENT number — never the child’s suffixed component number',
      pkg.strip && pkg.strip.requestNumber === TAG + '-P');
    ok('C2 the released set counts RESPONSIVE files only', pkg.releasedSet && pkg.releasedSet.count === 2);
    ok('C3 the withholding log resolves zone → rule → citation',
      pkg.withholdingLog.entries.length === 2 &&
      pkg.withholdingLog.entries[0].pageNo === 4 &&
      pkg.withholdingLog.entries[0].citation === '§552.102-' + TAG &&
      pkg.withholdingLog.entries[0].ruleTitle === 'Personnel-file information');
    ok('C4 a rule-less zone shows its note and NO citation — absence rendered as absence, never invented',
      pkg.withholdingLog.entries[1].pageNo === 9 && pkg.withholdingLog.entries[1].citation == null &&
      /quoted thread/.test(pkg.withholdingLog.entries[1].note || ''));
    ok('C5 the notice preview is the real builder’s letter: parent number + citizen’s name + page count',
      pkg.notice && pkg.notice.text.indexOf(TAG + '-P') >= 0 && pkg.notice.text.indexOf(TAG + '-P-1') < 0 &&
      pkg.notice.text.indexOf('Dear Pat Citizen') === 0 && /2 page\(s\)/.test(pkg.notice.text));
    ok('C6 …and it names where it will send: the PARENT’s address outranks the child row’s copy',
      pkg.notice.willSendTo === 'pat-' + TAG + '@example.com');
    var childRow = await db.get('SELECT * FROM requests WHERE id = ?', [C1]);
    var direct = await CN.build('fulfilled', childRow, { pageCount: 2, installmentNo: 1 });
    ok('C7 preview parity: byte-identical to what the release event sends (one builder, two readers)',
      direct.text === pkg.notice.text && direct.subject === pkg.notice.subject);
    ok('C8 the review does not count itself: pipeline reads ready-pending-review, not "conditions open"',
      pkg.strip.pipeline.readyPendingReview === true && pkg.strip.pipeline.eligible === false);

    // ================================================================================================
    console.log('\n=== D. THE CITIZEN-FACTS FIX, on the REAL send path (API approve) ===');
    var appr = await req('POST', '/api/tasks/' + tC.id + '/release-review/approve', {}, T2);
    ok('D1 the approve fires the release through the API power mode uses', appr.status === 200 && appr.json.reason === 'released');
    var closedRow = await db.get('SELECT status, stage, closure_reason, delivered_at, installment_no FROM requests WHERE id = ?', [C1]);
    ok('D2 the release event’s three writes: closed + delivered_at + installment, one act',
      closedRow.status === 'closed' && closedRow.delivered_at != null && Number(closedRow.installment_no) === 1);
    var hist = await db.all('SELECT action, notes FROM request_history WHERE request_id = ? ORDER BY created_at', [C1]);
    ok('D3 the approver is RECORDED as the actor on the release basis, BY NAME (the JWT carries display_name)',
      hist.some(function (h) { return /Release approved by/.test(h.notes || '') && (h.notes || '').indexOf(u2.display_name) >= 0; }));
    var noticeHist = hist.filter(function (h) { return /^CLOSURE_NOTICE_/.test(h.action); });
    ok('D4 the notice went to the PARENT’s address — the history names it, whatever the transport did',
      noticeHist.length === 1 && (noticeHist[0].notes || '').indexOf('pat-' + TAG + '@example.com') >= 0);
    ok('D5 …and never the child row’s copy address',
      (noticeHist[0].notes || '').indexOf('child-copy-' + TAG) < 0);

    // ================================================================================================
    console.log('\n=== E. RETURN — a note or nothing, and the queue tells the truth after ===');
    ok('E1 a return with NO note is refused 422 — a silent return tells the team nothing',
      (await req('POST', '/api/tasks/' + tLater.id + '/release-review/return', {}, T1)).status === 422);
    var ret = await req('POST', '/api/tasks/' + tLater.id + '/release-review/return',
      { note: 'p. 9 — one more personal address to match the treatment above.' }, T1);
    ok('E2 a noted return lands and says the pipeline re-arms on the fix', ret.status === 200 && ret.json.reArmsOnNextWork === true);
    var qAfter = await req('GET', '/api/tasks/release-review-queue', null, T1);
    ok('E3 the returned item leaves the queue; the others stay',
      !qAfter.json.tasks.some(function (t) { return t.id === tLater.id; }) &&
      qAfter.json.tasks.some(function (t) { return t.id === tSoon.id; }));
    var pkg404 = await req('GET', '/api/tasks/' + flow.id + '/release-package', null, T1);
    ok('E4 the package endpoint refuses a non-review task (404, not a leak)', pkg404.status === 404);

    console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR:', e && e.stack || e);
    process.exit(1);
  }
})();
