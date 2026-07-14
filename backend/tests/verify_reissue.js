'use strict';
// THE "SEND AGAIN" GATE (Kevin, 2026-07-14: "the rules configuration needs to be able to know when
// 'send again' is required, for either re-invoice or a second request for clarification").
//
// THE GAP: the 20% variance rule was already COMPUTED — reconcile() sets `renotify_required` when actuals
// overrun the accepted estimate — but it was a FLAG AND NOTHING ELSE. Nobody read it. A clerk could
// reconcile a $400 job against a $100 estimate, see "revised notice required", ignore it, and collect $400.
// TX § 552.2615(b)-(c): the updated itemized statement is a PRECONDITION to the money.
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
var CP = require('/opt/optimumq/backend/src/services/clarificationPolicy');
var RI = require('/opt/optimumq/backend/src/services/feeReissue');

var TAG = 'REISSUE-' + Date.now();
var pass = 0, fail = 0, TOKEN = null, created = [], savedPolicy = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function submit(d) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify({ description: d, requestorName: 'RI Test', requestorEmail: 'ri@example.com' });
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
// Drive a request to "estimate accepted at $X, actuals came in far higher" through the real endpoints.
async function overrunRequest(label, smallQty, bigQty) {
  await submit(label + ' ' + TAG);
  var req = null;
  for (var i = 0; i < 60 && !req; i++) { req = await db.get('SELECT id, request_number FROM requests WHERE description LIKE ?', ['%' + label + ' ' + TAG + '%']); await sleep(250); }
  if (!req) throw new Error('not created');
  created.push(req.id);

  var est = await api('POST', '/fee-estimates/request/' + req.id, {
    components: [{ id: 'c1', label: 'records', quantities: smallQty }], delivery: { method: 'email' }
  });
  if (est.status !== 200) throw new Error('estimate failed: ' + JSON.stringify(est.body));
  // Stamp notified_at (the real notice/send fires outbound email; see the other harnesses).
  await db.run("UPDATE request_fee_estimates SET notified_at = ?, notified_to = ? WHERE request_id = ? AND kind = 'estimate'",
    [nowStr(), 'harness@example.com', req.id]);
  await api('POST', '/fee-estimates/request/' + req.id + '/estimate/accept', {});

  // Actuals come in much higher -> reconcile through the REAL endpoint, which sets renotify_required.
  var rec = await api('POST', '/fee-estimates/request/' + req.id + '/reconcile', {
    components: [{ id: 'c1', label: 'records', quantities: bigQty }], delivery: { method: 'email' }
  });
  if (rec.status !== 200) throw new Error('reconcile failed: ' + JSON.stringify(rec.body));
  return { req: req, estimateTotal: est.body.estimate.total, actualTotal: rec.body.actualTotal, variancePct: rec.body.variancePct, reNotify: rec.body.reNotifyRequired };
}

(async function () {
  await db.initDb();
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);
    savedPolicy = await PCP.read('jur-tx');
    await captureStamp('jur-tx', 'payment');

    // ---- 1. the config slots exist, and TX carries the researched rule
    ok('TX: a cost overrun REQUIRES a revised estimate (§ 552.2615(c))', savedPolicy.reissue_required_on_variance === true);
    ok('TX: until it is re-sent, the city may not collect the overrun (§ 552.2615(b))', savedPolicy.reissue_blocks_collection === true);
    ok('TX: re-sending restarts the requestor response window', savedPolicy.reissue_restarts_response_window === true);
    ok('...and the rule is still a DRAFT (enabled=false) — nothing is live', savedPolicy.enabled === false);
    var clar = await CP.read('jur-tx');
    ok('the clarification half of "send again" has slots too (second_notice_required / _days)',
      clar.second_notice_required === false && clar.second_notice_days === null);
    ok('...and they are deliberately NOT seeded per state — an unresearched notice duty is a legal exposure',
      !clar.provenance.second_notice_required || clar.provenance.second_notice_required.source === 'default_off');

    // =====================================================================================
    // 2. POLICY OFF (today's live state): the overrun is computed but NOT enforced.
    //    This is the bug as it exists right now.
    // =====================================================================================
    var A = await overrunRequest('overrun policy off', { searchHours: 2, bwPages: 100 }, { searchHours: 20, bwPages: 900 });
    ok('A: the estimate was $' + A.estimateTotal.toFixed(2) + ', actuals came in at $' + A.actualTotal.toFixed(2) +
       ' (+' + A.variancePct + '%)', A.actualTotal > A.estimateTotal);
    ok('A: reconcile FLAGGED that a revised notice is required', A.reNotify === true);
    var pendA = await RI.pending(A.req.id);
    ok('A: a revised notice is outstanding', pendA.pending === true);
    var offCheck = await RI.checkCollection(A.req.id, A.actualTotal);
    ok('A: policy OFF => collection is NOT blocked — today the flag is computed and IGNORED', offCheck.blocked === false);
    var payOff = await api('POST', '/fee-estimates/request/' + A.req.id + '/payment/record',
      { target: 'balance', method: 'cash', amount: A.actualTotal });
    ok('A: the full overrun can be collected with no revised notice (status ' + payOff.status + ') — the bug, intact until a city opts in',
      payOff.status === 200);

    // =====================================================================================
    // 3. POLICY ON: the gate refuses the overage, and names the cure.
    // =====================================================================================
    await PCP.write('jur-tx', Object.assign({}, savedPolicy, { enabled: true }), 'harness');
    var B = await overrunRequest('overrun policy on', { searchHours: 2, bwPages: 100 }, { searchHours: 20, bwPages: 900 });
    ok('B: estimate $' + B.estimateTotal.toFixed(2) + ' -> actual $' + B.actualTotal.toFixed(2) + ' (+' + B.variancePct + '%)', B.reNotify === true);

    var chk = await RI.checkCollection(B.req.id, B.actualTotal);
    ok('B: policy ON => collecting the full actual is BLOCKED', chk.blocked === true);
    ok('B: the ceiling is what the requestor was LAST TOLD ($' + chk.ceiling.toFixed(2) + '), not what the city recomputed',
      Math.abs(chk.ceiling - B.estimateTotal) < 0.01);
    ok('B: it cites § 552.2615', /552\.2615/.test(chk.citation || ''));
    ok('B: and it names the cure ("Send the revised estimate first")', /Send the revised estimate first/.test(chk.reason));

    var payBlocked = await api('POST', '/fee-estimates/request/' + B.req.id + '/payment/record',
      { target: 'balance', method: 'cash', amount: B.actualTotal });
    ok('B: POST /payment/record REFUSES with 409 REVISED_ESTIMATE_REQUIRED',
      payBlocked.status === 409 && payBlocked.body.code === 'REVISED_ESTIMATE_REQUIRED');
    var finBlocked = await api('POST', '/fee-estimates/request/' + B.req.id + '/final-payment/record', { amount: B.actualTotal });
    ok('B: the OTHER door — /final-payment/record — is refused too. Both money doors are shut.',
      finBlocked.status === 409 && finBlocked.body.code === 'REVISED_ESTIMATE_REQUIRED');
    var payRows = await db.get("SELECT COUNT(*) AS n FROM fee_payments WHERE request_id = ?", [B.req.id]);
    ok('B: NO payment row was written (' + payRows.n + ') — a refusal, not a warning', Number(payRows.n) === 0);

    // ---- the requestor still owes what they DID agree to: collecting up to the ceiling is fine
    var payOk = await api('POST', '/fee-estimates/request/' + B.req.id + '/payment/record',
      { target: 'balance', method: 'cash', amount: B.estimateTotal });
    ok('B: collecting UP TO the accepted estimate ($' + B.estimateTotal.toFixed(2) + ') IS allowed — ' +
       'the gate blocks the overage, not the agreed amount', payOk.status === 200);

    // ---- 4. sending the revised statement CURES it
    // NOTE: timestamps are second-precision, and pending() asks "was a notice sent AFTER the reconciliation?"
    // The harness can re-send inside the same second, which a human never can. Wait past the boundary so the
    // assertion tests the product's logic, not the clock's resolution.
    await sleep(1500);
    await db.run("UPDATE request_fee_estimates SET notified_at = ?, notified_to = ? WHERE request_id = ? AND kind = 'estimate'",
      [nowStr(), 'harness@example.com', B.req.id]);
    var pendAfter = await RI.pending(B.req.id);
    ok('B: after the revised statement is sent, nothing is outstanding', pendAfter.pending === false);
    var chkAfter = await RI.checkCollection(B.req.id, B.actualTotal);
    ok('B: ...and the overrun becomes collectable — the gate is a precondition, not a penalty', chkAfter.blocked === false);

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      if (savedPolicy) { await PCP.write('jur-tx', savedPolicy, 'harness-restore'); await restoreStamp('jur-tx', 'payment'); }
      var back = await PCP.read('jur-tx');
      ok('cleanup: the TX payment policy is restored to DRAFT (enabled=' + back.enabled + ')', back.enabled === false);
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
