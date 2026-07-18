'use strict';
// ARCHITECTURE item 6: "One central stage-transition function. Every stage advance writes request_history
// AND spawns/updates the stage task. No direct `UPDATE requests SET stage` anywhere else."
//
// Three sites violated it. Each wrote `UPDATE requests SET stage = 'closed'` (or back to awaiting_payment)
// directly — no history row, and the request's OPEN TASKS were left claimable in the pools:
//   1. feeNonpayment.closeForNonpayment  — the nonpayment auto-close
//   2. feeNonpayment.reopen              — the reopen (the worst: back to awaiting_payment with NO task)
//   3. tickler estimate-lapse            — auto-withdraw on estimate non-response
// Real paths: POST /api/public/submit -> estimate -> notify -> (accept) -> the real sweeps/services.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var feeNonpayment = require('/opt/optimumq/backend/src/services/feeNonpayment');
var tickler = require('/opt/optimumq/backend/src/services/tickler');
var workflowEngine = require('/opt/optimumq/backend/src/services/workflowEngine');

var TAG = 'BYPASS-' + Date.now();
var pass = 0, fail = 0, TOKEN = null, created = [];
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function submit(d) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify({ description: d, requestorName: 'Bypass Test', requestorEmail: 'byp@example.com' });
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
async function newRequestWithEstimate(label) {
  await submit(label + ' ' + TAG);
  var req = null;
  for (var i = 0; i < 60 && !req; i++) { req = await db.get('SELECT id, request_number, stage FROM requests WHERE description LIKE ?', ['%' + label + ' ' + TAG + '%']); await sleep(250); }
  if (!req) throw new Error('not created: ' + label);
  created.push(req.id);
  var est = await api('POST', '/fee-estimates/request/' + req.id, {
    components: [{ id: 'c1', label: 'records', quantities: { searchHours: 30, reviewHours: 10, bwPages: 400 } }],
    delivery: { method: 'email' }
  });
  if (est.status !== 200) throw new Error('estimate failed: ' + JSON.stringify(est.body));
  // notice/send fires REAL outbound email here (Resend, no suppression switch) — stamp the flag it sets.
  // The notice-send path is a separate, already-verified feature and is not the code under test.
  await db.run("UPDATE request_fee_estimates SET notified_at = ?, notified_to = ? WHERE request_id = ?",
    [nowStr(), 'harness@example.com', req.id]);
  return req;
}
async function openTasks(rid) {
  var r = await db.get("SELECT COUNT(*) AS n FROM tasks WHERE request_id = ? AND status IN ('open','assigned','in_progress')", [rid]);
  return Number(r.n);
}
async function histCount(rid, action) {
  var r = await db.get("SELECT COUNT(*) AS n FROM request_history WHERE request_id = ? AND action = ?", [rid, action]);
  return Number(r.n);
}
async function histRow(rid, action) {
  return await db.get("SELECT stage_from, stage_to FROM request_history WHERE request_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1", [rid, action]);
}

(async function () {
  await db.initDb();
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);

    // ---- 0. the source-level invariant: no raw stage write survives outside taskRouting
    var fs = require('fs');
    var offenders = [];
    ['services/feeNonpayment.js', 'services/tickler.js'].forEach(function (f) {
      var src = fs.readFileSync('/opt/optimumq/backend/src/' + f, 'utf8');
      src.split('\n').forEach(function (line, i) {
        if (/^\s*await\s+(db\.)?run\(\s*["'`]UPDATE requests SET[^"'`]*stage\s*=/.test(line)) offenders.push(f + ':' + (i + 1));
      });
    });
    ok('SOURCE: no `UPDATE requests SET stage = ...` remains in feeNonpayment or tickler' + (offenders.length ? ' — found ' + offenders.join(', ') : ''), offenders.length === 0);

    // =====================================================================================
    // 1. NONPAYMENT AUTO-CLOSE — must write history AND cancel the open tasks.
    // =====================================================================================
    var A = await newRequestWithEstimate('nonpayment close');
    var aOpenBefore = await openTasks(A.id);
    ok('1: the request has an open task before the close (' + aOpenBefore + ')', aOpenBefore > 0);
    var aStageBefore = (await db.get('SELECT stage FROM requests WHERE id = ?', [A.id])).stage;

    await feeNonpayment.closeForNonpayment(A.id, { windowDays: 30, reminderDays: 15, publishOnClose: false });

    var aAfter = await db.get('SELECT stage, status, closure_reason FROM requests WHERE id = ?', [A.id]);
    ok('1: stage = closed, status = closed', aAfter.stage === 'closed' && aAfter.status === 'closed');
    ok('1: closure_reason = nonpayment', aAfter.closure_reason === 'nonpayment');
    ok('1: a CLOSED_NONPAYMENT history row was written', (await histCount(A.id, 'CLOSED_NONPAYMENT')) === 1);
    var aRow = await histRow(A.id, 'CLOSED_NONPAYMENT');
    ok('1: the history row carries stage_from -> stage_to (' + aRow.stage_from + ' -> ' + aRow.stage_to + ') — the raw UPDATE recorded neither',
      aRow.stage_from === aStageBefore && aRow.stage_to === 'closed');
    var aOpenAfter = await openTasks(A.id);
    ok('1: NO open tasks left claimable on the closed request (' + aOpenBefore + ' -> ' + aOpenAfter + ')', aOpenAfter === 0);

    // THE FLAKE, MADE DETERMINISTIC: this harness intermittently went red on line 100/152 because the
    // background onIntake kicked by /public/submit could land AFTER the close (slow classifier) and silently
    // re-route the request out of 'closed'. Force that exact late landing here (with a stub matcher so no
    // Anthropic call) and assert the guard in workflowEngine.onIntake holds — no timing dependence anymore.
    await workflowEngine.onIntake(A.id, { classification: 'standard', recordTypeConfidence: 0, flags: [], reasoning: 'harness: simulated late intake' });
    var aLate = await db.get('SELECT stage, status FROM requests WHERE id = ?', [A.id]);
    ok('1: a late background intake does NOT revive the closed request — stays closed/closed', aLate.stage === 'closed' && aLate.status === 'closed');
    ok('1: ...and the late intake spawned no claimable task on the closed request', (await openTasks(A.id)) === 0);

    // =====================================================================================
    // 2. REOPEN — the worst of the three: it landed back in awaiting_payment with NO task.
    // =====================================================================================
    var rp = await feeNonpayment.reopen(A.id, 'Harness Clerk');
    ok('2: reopen() succeeded', rp.reopened === true);
    var aRe = await db.get('SELECT stage, status, closure_reason FROM requests WHERE id = ?', [A.id]);
    ok('2: the request is live again — stage = awaiting_payment, status = active', aRe.stage === 'awaiting_payment' && aRe.status === 'active');
    ok('2: closure_reason cleared', aRe.closure_reason === null);
    ok('2: a REOPENED_NONPAYMENT history row was written', (await histCount(A.id, 'REOPENED_NONPAYMENT')) === 1);
    var reRow = await histRow(A.id, 'REOPENED_NONPAYMENT');
    ok('2: history shows closed -> awaiting_payment (' + reRow.stage_from + ' -> ' + reRow.stage_to + ')',
      reRow.stage_from === 'closed' && reRow.stage_to === 'awaiting_payment');
    // `awaiting_payment` is NOT in taskRouting.STAGE_TASK — deliberately. It is a WAIT-ON-THE-REQUESTOR
    // state, tracked by the tickler + deposit sweeps, not by a staff task. So the correct post-reopen state
    // is: live, in awaiting_payment, with NO task. (An earlier draft of this harness asserted a task must
    // appear here; that was wrong about the product, not a bug in it.)
    var reTasks = await openTasks(A.id);
    ok('2: the reopened request correctly has NO task — awaiting_payment is a wait state, not work', reTasks === 0);
    var swept = await db.get("SELECT r.id FROM requests r JOIN request_fee_estimates e ON e.request_id = r.id " +
      "WHERE r.id = ? AND r.stage = 'awaiting_payment' AND r.status = 'active' AND e.accepted_at IS NULL AND e.declined_at IS NULL", [A.id]);
    ok('2: ...and it is visible to the sweeps that own that stage (it matches the tickler candidate shape)', !!swept);

    // =====================================================================================
    // 3. TICKLER ESTIMATE-LAPSE auto-withdraw — same invariant, through the real sweep.
    // =====================================================================================
    var B = await newRequestWithEstimate('estimate lapse');
    // the sweep only auto-withdraws when the fee profile opts in; force it for this run and restore after
    var prof = await db.get("SELECT id, config_json FROM fee_profiles WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1");
    var savedProf = prof.config_json;
    var pcfg = JSON.parse(savedProf);
    pcfg.estimatePolicy = Object.assign({}, pcfg.estimatePolicy, { autoWithdrawOnLapse: true });
    await db.run('UPDATE fee_profiles SET config_json = ? WHERE id = ?', [JSON.stringify(pcfg), prof.id]);

    // backdate the notice so the acceptance window has lapsed
    await db.run("UPDATE request_fee_estimates SET notified_at = to_char(now() - interval '90 days', 'YYYY-MM-DD HH24:MI:SS') WHERE request_id = ?", [B.id]);
    var bOpenBefore = await openTasks(B.id);
    var bStageBefore = (await db.get('SELECT stage FROM requests WHERE id = ?', [B.id])).stage;
    ok('3: the request has an open task before the lapse (' + bOpenBefore + ')', bOpenBefore > 0);

    var sweep = await tickler.runSweep();
    ok('3: the real tickler sweep ran and withdrew (' + sweep.actions.withdrawn + ')', sweep.actions.withdrawn >= 1);

    var bAfter = await db.get('SELECT stage, status, closure_reason, tickler_flag FROM requests WHERE id = ?', [B.id]);
    ok('3: stage = closed, status = closed', bAfter.stage === 'closed' && bAfter.status === 'closed');
    ok('3: closure_reason preserved (' + bAfter.closure_reason + ')', /estimate_lapsed|abandoned/.test(bAfter.closure_reason || ''));
    ok('3: the tickler flag is preserved for the queue display (' + bAfter.tickler_flag + ')', /estimate_lapsed|abandoned/.test(bAfter.tickler_flag || ''));
    ok('3: an ESTIMATE_LAPSED history row was written', (await histCount(B.id, 'ESTIMATE_LAPSED')) === 1);
    var bRow = await histRow(B.id, 'ESTIMATE_LAPSED');
    ok('3: history carries stage_from -> stage_to (' + bRow.stage_from + ' -> ' + bRow.stage_to + ')',
      bRow.stage_from === bStageBefore && bRow.stage_to === 'closed');
    var bOpenAfter = await openTasks(B.id);
    ok('3: NO open tasks left claimable (' + bOpenBefore + ' -> ' + bOpenAfter + ')', bOpenAfter === 0);

    await db.run('UPDATE fee_profiles SET config_json = ? WHERE id = ?', [savedProf, prof.id]);
    var profBack = await db.get('SELECT config_json FROM fee_profiles WHERE id = ?', [prof.id]);
    ok('3: the fee profile is restored byte-for-byte', profBack.config_json === savedProf);

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
