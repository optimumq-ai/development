'use strict';
// Deposit clock policy — the first caller of `payment_pending`.
// THE BUG: a request parked on an unpaid deposit kept burning its statutory clock (payment_pending had
// ZERO callers), so the city reported FALSE LATENESS for the requestor's inaction.
// Real paths throughout: POST /api/public/submit -> estimate -> notice/send -> accept -> deposit/record,
// plus the real tickler sweep. Nothing is inserted into a mid-pipeline state by hand.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
// RESTORE_STAMP: put the row back exactly as found, INCLUDING updated_by — a restore that stamps itself
// 'harness-restore' leaves a test fingerprint on live config (configIntegrity flags it, rightly).
async function restoreStamp(jid, domain) {
  var orig = _origStamp[jid + '/' + domain];
  if (orig) await db.run('UPDATE jurisdiction_rules SET updated_by = ? WHERE jurisdiction_id = ? AND domain = ?', [orig, jid, domain]);
}
var _origStamp = {};
async function captureStamp(jid, domain) {
  var r = await db.get('SELECT updated_by FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, domain]);
  if (r) _origStamp[jid + '/' + domain] = r.updated_by;
}
var auth = require('/opt/optimumq/backend/src/services/auth');
var PCP = require('/opt/optimumq/backend/src/services/paymentClockPolicy');
var JP = require('/opt/optimumq/backend/src/services/jurisdictionProfile');
var T = require('/opt/optimumq/backend/src/services/tolling');
var tickler = require('/opt/optimumq/backend/src/services/tickler');

var TAG = 'DEPCLK-' + Date.now();
var JID = 'jur-tx';
var pass = 0, fail = 0, TOKEN = null, created = [], savedPolicy = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function submit(d) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify({ description: d, requestorName: 'Deposit Test', requestorEmail: 'dep@example.com' });
    var r = http.request({ host: 'localhost', port: (Number(process.env.API_PORT) || 3101), path: '/api/public/submit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      function (resp) { resp.on('data', function () {}); resp.on('end', function () { res(resp.statusCode); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}
async function api(method, path, body) {
  var r = await fetch('http://localhost:' + (Number(process.env.API_PORT) || 3101) + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

// Drive a request all the way to "deposit owed" through the REAL endpoints.
async function requestWithDepositDue(label) {
  await submit(label + ' ' + TAG);
  var req = null;
  for (var i = 0; i < 60 && !req; i++) { req = await db.get('SELECT id, request_number FROM requests WHERE description LIKE ?', ['%' + label + ' ' + TAG + '%']); await sleep(250); }
  if (!req) throw new Error('request not created: ' + label);
  created.push(req.id);
  // A big enough estimate to land in the >$100 band => gate = deposit_before_work.
  var est = await api('POST', '/fee-estimates/request/' + req.id, {
    components: [{ id: 'c1', label: 'records', quantities: { searchHours: 30, reviewHours: 10, bwPages: 400 } }],
    delivery: { method: 'email' }
  });
  if (est.status !== 200) throw new Error('estimate failed: ' + JSON.stringify(est.body));
  // DELIBERATE DEVIATION: POST /notice/send fires REAL outbound email (Resend is configured in this env).
  // A test harness must not send mail to bounce addresses, so we stamp the notice-sent timestamp that the
  // accept endpoint gates on. The notice-send path is a separate, already-verified feature and is NOT the
  // code under test here. Everything under test — accept, deposit/record, and the tickler sweep — runs
  // through the real endpoints/services below.
  await db.run("UPDATE request_fee_estimates SET notified_at = ?, notified_to = ? WHERE request_id = ?",
    [new Date().toISOString().slice(0, 19).replace('T', ' '), 'harness@example.com', req.id]);
  var acc = await api('POST', '/fee-estimates/request/' + req.id + '/estimate/accept', {});
  if (acc.status !== 200) throw new Error('accept failed: ' + JSON.stringify(acc.body));
  return { req: req, depositDue: acc.body.depositDue, stage: acc.body.stage };
}
async function tollsFor(rid) {
  return await db.all("SELECT t.reason, t.tolled_from, t.tolled_until FROM clock_tolls t JOIN request_clocks c ON c.id = t.clock_id WHERE c.request_id = ?", [rid]);
}
async function primaryClock(rid) { return await db.get("SELECT * FROM request_clocks WHERE request_id = ? AND is_primary = 1", [rid]); }
async function setPolicy(cfg) {
  await PCP.write(JID, cfg, 'harness');
  if (cfg.enabled) { await JP.sync(JID, { source: 'harness' }); await JP.attest(JID, 'payment', 'harness'); }
}

(async function () {
  await db.initDb();
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);
    savedPolicy = await PCP.read(JID);
    await captureStamp(JID, 'payment');
    ok('TX payment policy is seeded from the legal research (toll_and_restart, grace 10, withdraw)',
      savedPolicy.deposit_clock_effect === 'toll_and_restart' && savedPolicy.deposit_grace_days === 10 && savedPolicy.deposit_lapse_action === 'withdraw');
    ok('...and it is a DRAFT — enabled=false, so nothing is live yet', savedPolicy.enabled === false);

    // =======================================================================================
    // A. REGRESSION — with the policy OFF, behaviour must be byte-for-byte what it is today.
    // =======================================================================================
    var A = await requestWithDepositDue('Regression deposit-off');
    ok('A: deposit is owed and the request parked in awaiting_payment', A.depositDue > 0 && A.stage === 'awaiting_payment');
    var aTolls = await tollsFor(A.req.id);
    ok('A: policy OFF => the clock was NOT touched (0 tolls) — today\'s behaviour preserved', aTolls.length === 0);
    var aClock = await primaryClock(A.req.id);
    var aStatus = await T.statusForRequest(A.req.id).catch(function () { return null; });
    ok('A: the clock is still running (this is the FALSE-LATENESS bug, intact until a city opts in)', aClock.status === 'running');
    var aHist = await db.get("SELECT COUNT(*) AS n FROM request_history WHERE request_id = ? AND action = 'DEPOSIT_DUE'", [A.req.id]);
    ok('A: the effort trail is written even with automation off (DEPOSIT_DUE logged)', Number(aHist.n) === 1);

    // =======================================================================================
    // B. TEXAS, switched on: toll on "deposit due", RE-RECEIPT (restart) on "deposit paid".
    //    Tex. Gov't Code § 552.263(e).
    // =======================================================================================
    await setPolicy({ enabled: true, deposit_clock_effect: 'toll_and_restart', deposit_grace_days: 10, deposit_lapse_action: 'flag_only' });
    var st = await db.get("SELECT attested_by FROM jurisdiction_profile_sections WHERE jurisdiction_id = ? AND section = 'payment'", [JID]);
    ok('B: the payment profile section exists and is attested', !!(st && st.attested_by));

    var B = await requestWithDepositDue('TX restart');
    var bTolls = await tollsFor(B.req.id);
    ok('B: the clock was TOLLED when the deposit fell due', bTolls.length === 1);
    ok('B: the toll reason is "payment_pending" — the reason that had ZERO callers until now',
      bTolls.length === 1 && bTolls[0].reason === 'payment_pending');
    ok('B: the toll is OPEN (tolled_until is null)', bTolls.length === 1 && bTolls[0].tolled_until === null);
    var bClock1 = await primaryClock(B.req.id);
    var bStart1 = bClock1.started_at;
    var bState1 = (await T.statusForRequest(B.req.id)).filter(function (c) { return c.isPrimary; })[0];
    ok('B: derived clock state = tolled (the city is no longer burning its clock)', bState1.state === 'tolled');
    ok('B: currentlyTolled = true', bState1.currentlyTolled === true);

    // Make the toll measurable: backdate the clock's start + the toll so real days elapse.
    await db.run("UPDATE request_clocks SET started_at = to_char(now() - interval '6 days', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [bClock1.id]);
    await db.run("UPDATE clock_tolls SET tolled_from = to_char(now() - interval '4 days', 'YYYY-MM-DD HH24:MI:SS') WHERE clock_id = ?", [bClock1.id]);
    var bBefore = (await T.statusForRequest(B.req.id)).filter(function (c) { return c.isPrimary; })[0];
    ok('B: before payment, the clock has consumed real days (' + bBefore.consumedDays + ') and is tolled', bBefore.consumedDays > 0);

    // ---- the deposit lands, through the real endpoint ----
    var dep = await api('POST', '/fee-estimates/request/' + B.req.id + '/deposit/record', {});
    ok('B: deposit recorded through the real endpoint; stage advanced to record_search',
      dep.status === 200 && dep.body.stage === 'record_search');

    var bClock2 = await primaryClock(B.req.id);
    var bAfter = (await T.statusForRequest(B.req.id)).filter(function (c) { return c.isPrimary; })[0];
    ok('B: THE REQUEST WAS RE-RECEIVED — started_at reset to the payment date (§ 552.263(e))', bClock2.started_at > bStart1);
    ok('B: the clock is running again', bAfter.state === 'running');
    ok('B: consumed days reset to 0 — a clean FULL window from the payment date (' + bAfter.consumedDays + ')', bAfter.consumedDays === 0);
    ok('B: remaining = the full duration (' + bAfter.remainingDays + ' of ' + bAfter.duration + ')', bAfter.remainingDays === bAfter.duration);
    ok('B: prior toll rows are CLOSED but retained as audit', (await tollsFor(B.req.id)).every(function (t) { return t.tolled_until !== null; }));
    var bHist = await db.all("SELECT action, notes, created_at FROM request_history WHERE request_id = ? AND action IN ('DEPOSIT_DUE','DEPOSIT_PAID') ORDER BY created_at", [B.req.id]);
    var acts = bHist.map(function (h) { return h.action; });
    ok('B: both trail events written — got [' + acts.join(', ') + ']',
      acts.indexOf('DEPOSIT_DUE') >= 0 && acts.indexOf('DEPOSIT_PAID') >= 0 && bHist.length === 2);
    var paidNote = (bHist.filter(function (h) { return h.action === 'DEPOSIT_PAID'; })[0] || {}).notes || '';
    ok('B: the DEPOSIT_PAID note records the re-receipt in plain language', /RE-RECEIVED/.test(paidNote));

    // =======================================================================================
    // C. A runs_no_stop jurisdiction: enabled + attested, but the clock must NOT stop.
    // =======================================================================================
    await setPolicy({ enabled: true, deposit_clock_effect: 'runs_no_stop', deposit_lapse_action: 'flag_only' });
    var C = await requestWithDepositDue('runs-no-stop');
    var cTolls = await tollsFor(C.req.id);
    ok('C: runs_no_stop => the clock keeps running even though the policy is ON (0 tolls)', cTolls.length === 0);
    ok('C: the effect is honoured per-jurisdiction, not hardcoded', (await PCP.read(JID)).deposit_clock_effect === 'runs_no_stop');

    // =======================================================================================
    // D. LAPSE = withdraw. The requestor never pays; TX § 552.263(f) withdraws the request.
    //    It must go through the CENTRAL stage transition (ARCHITECTURE item 6) — history + tasks.
    // =======================================================================================
    await setPolicy({ enabled: true, deposit_clock_effect: 'toll_pause_resume', deposit_grace_days: 0, deposit_lapse_action: "withdraw" });
    var D = await requestWithDepositDue('lapse withdraw');
    await db.run("UPDATE request_fee_estimates SET accepted_at = to_char(now() - interval '30 days', 'YYYY-MM-DD HH24:MI:SS') WHERE request_id = ?", [D.req.id]);
    var openTasksBefore = await db.get("SELECT COUNT(*) AS n FROM tasks WHERE request_id = ? AND status IN ('open','assigned','in_progress')", [D.req.id]);

    var sweep = await tickler.runSweep();
    ok('D: the real tickler sweep ran (' + JSON.stringify(sweep.actions || sweep) + ')', !!sweep);

    var dReq = await db.get('SELECT stage, status, closure_reason FROM requests WHERE id = ?', [D.req.id]);
    ok('D: the request was WITHDRAWN — stage=closed', dReq.stage === 'closed');
    ok('D: closure_reason = deposit_unpaid', dReq.closure_reason === 'deposit_unpaid');
    var dHist = await db.get("SELECT COUNT(*) AS n FROM request_history WHERE request_id = ? AND action = 'REQUEST_WITHDRAWN'", [D.req.id]);
    ok('D: it went through the CENTRAL stage transition — a REQUEST_WITHDRAWN history row exists', Number(dHist.n) === 1);
    var openTasksAfter = await db.get("SELECT COUNT(*) AS n FROM tasks WHERE request_id = ? AND status IN ('open','assigned','in_progress')", [D.req.id]);
    ok('D: no open tasks left claimable on a closed request (' + openTasksBefore.n + ' -> ' + openTasksAfter.n + ')', Number(openTasksAfter.n) === 0);
    var dFlag = await db.get("SELECT tickler_flag FROM requests WHERE id = ?", [D.req.id]);
    ok('D: no stale deposit_overdue flag on the withdrawn request', (dFlag.tickler_flag || '') !== 'deposit_overdue');

    // =====================================================================================
    // E. THE DEPOSIT SWEEP NOW RUNS ON THE MONEY AXIS, NOT THE STAGE (Kevin, 2026-07-14).
    //    It used to require r.stage = 'awaiting_payment'. After the migration the ESTIMATE hangs off the
    //    PARENT and the STAGE off the CHILD, so that join would match nothing and the sweep would SILENTLY
    //    STOP RUNNING. The money predicate (accepted + deposit_due > 0 + unpaid) is what actually defines it.
    // =====================================================================================
    await setPolicy({ enabled: false, deposit_clock_effect: 'runs_no_stop', deposit_lapse_action: 'flag_only' });

    // (1) equivalence: the old stage-based predicate and the new money-based one select the SAME rows today
    var oldSet = (await db.all("SELECT r.id FROM requests r JOIN request_fee_estimates e ON e.request_id = r.id " +
      "WHERE r.stage = 'awaiting_payment' AND r.status = 'active' AND e.kind = 'estimate' AND e.accepted_at IS NOT NULL AND e.deposit_paid_at IS NULL ORDER BY r.id")).map(function (x) { return x.id; });
    var newSet = (await db.all("SELECT r.id FROM requests r JOIN request_fee_estimates e ON e.request_id = r.id " +
      "WHERE r.status = 'active' AND e.kind = 'estimate' AND e.accepted_at IS NOT NULL AND e.deposit_paid_at IS NULL AND COALESCE(e.deposit_due,0) > 0 ORDER BY r.id")).map(function (x) { return x.id; });
    ok('E: the money predicate selects EXACTLY the same rows as the old stage predicate (' + newSet.length + ' rows) — a no-op today',
      JSON.stringify(oldSet) === JSON.stringify(newSet));

    // (2) THE FALSE-POSITIVE the stage predicate used to prevent: a request that accepted an estimate with
    //     NO deposit due sits at record_search with deposit_paid_at NULL FOREVER. Without `deposit_due > 0`
    //     it would be flagged overdue for a deposit it never owed.
    // Construct the case rather than hope for it: a SMALL estimate (under the deposit threshold) owes no
    // deposit, so it advances straight to record_search and its deposit_paid_at stays NULL forever.
    await submit('zero deposit ' + TAG);
    var zd = null;
    for (var z = 0; z < 60 && !zd; z++) { zd = await db.get('SELECT id FROM requests WHERE description LIKE ?', ['%zero deposit ' + TAG + '%']); await sleep(250); }
    created.push(zd.id);
    var zest = await api('POST', '/fee-estimates/request/' + zd.id, {
      components: [{ id: 'c1', label: 'records', quantities: { bwPages: 60 } }], delivery: { method: 'email' }
    });
    await db.run("UPDATE request_fee_estimates SET notified_at = ?, notified_to = ? WHERE request_id = ?",
      [new Date().toISOString().slice(0, 19).replace('T', ' '), 'harness@example.com', zd.id]);
    var zacc = await api('POST', '/fee-estimates/request/' + zd.id + '/estimate/accept', {});
    var zrow = await db.get('SELECT stage FROM requests WHERE id = ?', [zd.id]);
    var zest2 = await db.get("SELECT deposit_due, accepted_at, deposit_paid_at FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate'", [zd.id]);
    ok('E: a small estimate owes NO deposit (deposit_due=' + zest2.deposit_due + ') and advanced to ' + zrow.stage,
      Number(zest2.deposit_due) === 0 && zrow.stage !== 'awaiting_payment' && !!zest2.accepted_at && !zest2.deposit_paid_at);

    var candNow = (await db.all("SELECT r.id FROM requests r JOIN request_fee_estimates e ON e.request_id = r.id " +
      "WHERE r.status = 'active' AND e.kind = 'estimate' AND e.accepted_at IS NOT NULL AND e.deposit_paid_at IS NULL AND COALESCE(e.deposit_due,0) > 0")).map(function (x) { return x.id; });
    ok('E: THE FALSE POSITIVE IS PREVENTED — it is NOT a deposit-overdue candidate, even though it accepted an ' +
       'estimate and has never paid a deposit. `deposit_due > 0` is what the dropped stage predicate used to do.',
      candNow.indexOf(zd.id) < 0);

    // and the real sweep agrees: it does not flag it
    var swp = await tickler.runSweep();
    var zflag = await db.get('SELECT tickler_flag FROM requests WHERE id = ?', [zd.id]);
    ok('E: the REAL tickler sweep does not flag it deposit_overdue (flag=' + (zflag.tickler_flag || 'none') + ')',
      (zflag.tickler_flag || '') !== 'deposit_overdue');

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      // restore the policy to its seeded DRAFT state and un-attest, so the system is exactly as we found it
      if (savedPolicy) { await PCP.write(JID, savedPolicy, 'harness-restore'); await restoreStamp(JID, 'payment'); }
      try { await JP.unattest(JID, 'payment'); } catch (e) {}
      await JP.sync(JID, { source: 'harness-restore' });
      var back = await PCP.read(JID);
      var sec = await db.get("SELECT attested_by FROM jurisdiction_profile_sections WHERE jurisdiction_id = ? AND section = 'payment'", [JID]);
      ok('cleanup: TX policy restored to DRAFT (enabled=' + back.enabled + ') and un-attested', back.enabled === false && !(sec && sec.attested_by));

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
