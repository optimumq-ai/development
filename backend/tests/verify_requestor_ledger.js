'use strict';
// PHASE 7 / WS5 — the requestor-ledger, MVP class A.
//
// The claims under test, from docs/SPEC_phase7_build.md and the decided
// docs/rules_research/workflow/DESIGN_requestor_ledger.md:
//   1. TX § 552.263(c): an unpaid prior balance over $100 fires the deposit trigger on a fixture.
//   2. OK § 24A.5(4): outstanding fees fire the advance-payment gate — and so does an estimate over $75.
//   3. ANONYMOUS REQUESTS NEVER ADVERSE-MATCH. An unverified email is not an identity, so a requester who
//      shares an address string with a debtor is never gated on that debt.
//   4. The balance is EVENTED from the parent financial processor, not re-summed from request rows: a
//      reconciliation supersedes its estimate rather than adding to it, a granted waiver removes what was
//      invoiced, and the same money event replayed twice does not double the debt.
//   5. Classes B/C/D exist as stubs a human fills, and a recorded flag is applied but never decided here.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var RL = require('/opt/optimumq/backend/src/services/requestorLedger');
var PS = require('/opt/optimumq/backend/src/services/paymentStatus');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var CI = require('/opt/optimumq/backend/src/services/configIntegrity');

var TAG = 'LEDGER-' + Date.now();
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function realErrors(f) { return (f || []).filter(function (x) { return x.severity === 'error' && !/A harness has leaked into production config/.test(x.issue); }); }
async function setActive(jid) {
  await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [jid]);
}
// A request created through the real path. `verified` decides whether it gets an identity anchor at all.
// Uses the STAFF-CONFIRMED anchor, because it is the only one the product can currently produce: the
// portal's two "verified" buttons are clicked by the requester themselves and are self-assertions, not
// verifications — see VERIFIED_EMAIL_METHODS in services/requestorLedger.js.
async function makeRequest(email, verified, label, created) {
  var made = await RC.createRequest({
    requestorName: 'Ledger Harness', requestorEmail: email,
    description: label + ' ' + TAG
  }, { actorName: 'harness', kickIntake: false, startClocks: false, identityConfirmed: !!verified });
  created.push(made.parentId, made.childId);
  return made;
}
async function enablePriorBalance(jid, on, patch) {
  await RL.writeConfig(jid, { prior_balance: Object.assign({ enabled: on }, patch || {}) }, 'harness-ws5');
}

(async function () {
  await db.initDb();
  var savedActive = null, created = [], profiles = [];
  try {
    savedActive = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
    ok('active jurisdiction resolves (' + savedActive + ')', !!savedActive);

    // ---- 0. the schema landed
    for (var tname of ['requestor_profiles', 'requestor_request_links', 'requestor_ledger_events', 'requestor_allowances', 'requestor_counters', 'requestor_flags']) {
      var t = await db.get("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ?", [tname]);
      ok('table ' + tname + ' exists', !!t);
    }

    // ---- 1. IDENTITY: the anchor test, in isolation
    ok('a bare unverified email is NOT an anchor',
      RL.anchorFor({ requestor_email: 'someone@example.com' }) === null);
    ok('the portal\'s self-service "verified" buttons are NOT anchors — the requester clicks them',
      RL.anchorFor({ requestor_email: 'a@b.c', email_verification_method: 'attested' }) === null &&
      RL.anchorFor({ requestor_email: 'a@b.c', email_verification_method: 'visual' }) === null);
    ok('a genuinely verified email IS an anchor',
      (RL.anchorFor({ requestor_email: 'someone@example.com', email_verification_method: 'staff_verified' }) || {}).basis === 'verified_email');
    ok('a portal account is the strongest anchor',
      (RL.anchorFor({ portal_account_id: 'pa-1', requestor_email: 'x@y.z' }) || {}).basis === 'portal_account');
    ok('a staff-confirmed walk-in is an anchor',
      (RL.anchorFor({ requestor_name: 'Walk In', identity_confirmed: true }) || {}).basis === 'staff_confirmed');
    ok('nothing at all is not an anchor', RL.anchorFor({}) === null && RL.anchorFor(null) === null);

    // ---- 2. TEXAS § 552.263(c) — the acceptance criterion
    await setActive('jur-tx');
    var txCfg = await RL.config('jur-tx');
    ok('TX carries the prior-balance rule', txCfg.prior_balance.applies === true && txCfg.prior_balance.rule_id === 'TX-0035');
    ok('...at the statutory $100 threshold', txCfg.prior_balance.threshold_usd === 100);
    ok('...citing § 552.263(c)', /552\.263\(c\)/.test(txCfg.prior_balance.citation || ''));
    ok('...as a DEPOSIT demand, computed automatically', txCfg.prior_balance.action === 'deposit' && txCfg.prior_balance.automatic === true);
    ok('...and OFF until the city elects it (it is permissive authority — "may require")', txCfg.prior_balance.enabled === false);

    // an identified requester with an old unpaid request
    var oldReq = await makeRequest('debtor@example.com', true, 'TX old unpaid', created);
    var link = await db.get('SELECT profile_id, identity_basis FROM requestor_request_links WHERE request_id = ?', [oldReq.childId]);
    ok('an identified request is anchored at creation', !!link && !!link.profile_id && link.identity_basis === 'staff_confirmed');
    profiles.push(link.profile_id);

    await PS.recordEvent(oldReq.childId, { type: 'estimate_issued', amount: 250, reason: 'estimate', actor: 'harness' });
    await PS.recordEvent(oldReq.childId, { type: 'payment', amount: 100, reason: 'partial', actor: 'harness' });
    var bal = await RL.balance(link.profile_id);
    ok('the balance is evented from the parent processor (250 invoiced, 100 paid)', bal.invoiced === 250 && bal.paid === 100);
    ok('...leaving $150 outstanding', bal.outstanding === 150);
    ok('...with a per-request breakdown', bal.byRequest.length === 1 && bal.byRequest[0].outstanding === 150);

    // the NEW request from the same identified requester
    var newReq = await makeRequest('debtor@example.com', true, 'TX new request', created);
    var offRes = await RL.evaluateEstimate('jur-tx', newReq.childId, { estimateTotal: 40 });
    ok('with the program OFF, nothing fires even at $150 outstanding', offRes.triggers.length === 0);

    await enablePriorBalance('jur-tx', true);
    var txRes = await RL.evaluateEstimate('jur-tx', newReq.childId, { estimateTotal: 40 });
    ok('THE CRITERION: $150 unpaid > $100 fires the TX deposit trigger', txRes.triggers.length === 1 && txRes.triggers[0].action === 'deposit');
    ok('...citing § 552.263(c) and TX-0035',
      /552\.263\(c\)/.test(txRes.triggers[0].citation || '') && txRes.triggers[0].rule_id === 'TX-0035');
    ok('...reporting the balance it rests on', txRes.triggers[0].outstanding === 150 && txRes.triggers[0].threshold_usd === 100);
    ok('...naming the identity basis it matched on', txRes.triggers[0].identityBasis === 'staff_confirmed');
    ok('...and which prior requests are unpaid', txRes.triggers[0].requests.length === 1);

    // below the threshold it must NOT fire — the $100 is a floor, not a formality
    await PS.recordEvent(oldReq.childId, { type: 'payment', amount: 100, reason: 'more', actor: 'harness' });
    var below = await RL.evaluateEstimate('jur-tx', newReq.childId, { estimateTotal: 40 });
    ok('paying down to $50 outstanding stops the trigger (the threshold is real)', below.triggers.length === 0);
    ok('...and the balance still reads $50', (below.balance || {}).outstanding === 50);

    // ---- 3. ANONYMOUS NEVER ADVERSE-MATCHES — the other acceptance criterion
    await PS.recordEvent(oldReq.childId, { type: 'estimate_issued', amount: 500, reason: 're-estimate', actor: 'harness' });
    var anonReq = await makeRequest('debtor@example.com', false, 'TX anonymous same email', created);
    var anonLink = await db.get('SELECT profile_id, reason FROM requestor_request_links WHERE request_id = ?', [anonReq.childId]);
    ok('an unverified request is linked as ANONYMOUS, and the reason is recorded',
      !!anonLink && anonLink.profile_id === null && /no affirmative identity anchor/.test(anonLink.reason || ''));
    var anonRes = await RL.evaluateEstimate('jur-tx', anonReq.childId, { estimateTotal: 400 });
    ok('THE CRITERION: an anonymous request with the SAME email string fires nothing',
      anonRes.anonymous === true && anonRes.triggers.length === 0 && anonRes.advisories.length === 0);
    ok('...and no balance is disclosed for it', anonRes.balance === null);
    var anonIntake = await RL.evaluateIntake('jur-tx', anonReq.childId);
    ok('...at the intake gate either', anonIntake.anonymous === true && anonIntake.triggers.length === 0);
    // and the identified requester IS still gated — proving the anonymous result is the anchor, not a bug
    var stillGated = await RL.evaluateEstimate('jur-tx', newReq.childId, { estimateTotal: 40 });
    ok('...while the IDENTIFIED requester on the same email is still gated', stillGated.triggers.length === 1);

    // ---- 4. OKLAHOMA § 24A.5(4) — the second acceptance criterion
    await setActive('jur-ok');
    await enablePriorBalance('jur-ok', true);
    var okCfg = await RL.config('jur-ok');
    ok('OK carries the advance-payment rule', okCfg.prior_balance.rule_id === 'OK-S03' && okCfg.prior_balance.action === 'advance_payment');
    ok('...with the $75 estimate trigger', okCfg.prior_balance.estimate_over_usd === 75);
    var okDebt = await makeRequest('okdebtor@example.com', true, 'OK old unpaid', created);
    var okLink = await db.get('SELECT profile_id FROM requestor_request_links WHERE request_id = ?', [okDebt.childId]);
    profiles.push(okLink.profile_id);
    await PS.recordEvent(okDebt.childId, { type: 'estimate_issued', amount: 30, reason: 'estimate', actor: 'harness' });
    var okNew = await makeRequest('okdebtor@example.com', true, 'OK new request', created);
    var okRes = await RL.evaluateEstimate('jur-ok', okNew.childId, { estimateTotal: 10 });
    ok('THE CRITERION: outstanding fees fire the OK advance-payment gate',
      okRes.triggers.length === 1 && okRes.triggers[0].action === 'advance_payment' && okRes.triggers[0].rule_id === 'OK-S03');
    ok('...on ANY outstanding amount (OK has no dollar floor, unlike TX)', okRes.triggers[0].outstanding === 30 && okRes.triggers[0].threshold_usd === 0);
    // the second OK limb: a big estimate triggers it even with a clean balance
    var okClean = await makeRequest('okclean@example.com', true, 'OK clean', created);
    var okCleanLink = await db.get('SELECT profile_id FROM requestor_request_links WHERE request_id = ?', [okClean.childId]);
    profiles.push(okCleanLink.profile_id);
    var okBig = await RL.evaluateEstimate('jur-ok', okClean.childId, { estimateTotal: 120 });
    ok('a clean requester with an estimate over $75 also triggers advance payment',
      okBig.triggers.length === 1 && /estimate over 75/.test(okBig.triggers[0].triggeredBy));
    var okSmall = await RL.evaluateEstimate('jur-ok', okClean.childId, { estimateTotal: 20 });
    ok('...but a small estimate on a clean balance does not', okSmall.triggers.length === 0);

    // ---- 5. DENIAL-SHAPED TRIGGERS ARE ADVISORIES, NOT AUTOMATIC (Massachusetts)
    var maCfg = RL.normalizeConfig('MA', { prior_balance: { enabled: true } });
    ok('MA may DENY on an unpaid balance', maCfg.prior_balance.action === 'advisory_deny');
    ok('...but it is NOT automatic — a person confirms a denial', maCfg.prior_balance.automatic === false);

    // ---- 6. THE BALANCE IS EVENTED, and the arithmetic is the conservative reading
    await setActive('jur-tx');
    var recon = await makeRequest('recon@example.com', true, 'recon', created);
    var rLink = await db.get('SELECT profile_id FROM requestor_request_links WHERE request_id = ?', [recon.childId]);
    profiles.push(rLink.profile_id);
    await PS.recordEvent(recon.childId, { type: 'estimate_issued', amount: 200, reason: 'estimate', actor: 'harness' });
    await PS.recordEvent(recon.childId, { type: 'reconciliation', amount: 120, reason: 'actuals', actor: 'harness' });
    var rBal = await RL.balance(rLink.profile_id);
    ok('a reconciliation SUPERSEDES its estimate rather than adding to it (120, not 320)', rBal.invoiced === 120);
    await PS.recordEvent(recon.childId, { type: 'dunning', reason: 'reminder', actor: 'system' });
    var rBal2 = await RL.balance(rLink.profile_id);
    ok('a workflow event that moves no money changes nothing', rBal2.invoiced === 120 && rBal2.outstanding === 120);
    await RL.onWaiverGranted(recon.childId, 'waived');
    var rBal3 = await RL.balance(rLink.profile_id);
    ok('a granted waiver removes what was invoiced — the city is not owed it', rBal3.outstanding === 0);
    ok('...so it can never trigger a deposit demand on the NEXT request', (await RL.evaluateEstimate('jur-tx', recon.childId, {})).triggers.length === 0);
    // idempotency: the same payment event replayed must not double the debt
    var dupeReq = await makeRequest('dupe@example.com', true, 'dupe', created);
    var dLink = await db.get('SELECT profile_id FROM requestor_request_links WHERE request_id = ?', [dupeReq.childId]);
    profiles.push(dLink.profile_id);
    await RL.onMoneyEvent(dupeReq.childId, { type: 'estimate_issued', amount: 90 }, 'pe-fixed-id');
    await RL.onMoneyEvent(dupeReq.childId, { type: 'estimate_issued', amount: 90 }, 'pe-fixed-id');
    ok('the same money event replayed does not double the debt', (await RL.balance(dLink.profile_id)).invoiced === 90);
    // a credit balance is not a debt
    await RL.onMoneyEvent(dupeReq.childId, { type: 'payment', amount: 200 }, 'pe-overpay');
    ok('an overpayment reads as zero outstanding, never a negative debt', (await RL.balance(dLink.profile_id)).outstanding === 0);

    // ---- 7. CLASSES B/C/D — stubs a human fills; a flag is applied, never decided
    var pid = dLink.profile_id;
    var al = await RL.setAllowance(pid, 'personnel_time', { unit: 'hours', window: 'rolling_12_months', allowance: 36, consumed: 10 }, 'harness');
    ok('class B: an allowance can be entered by hand (TX § 552.275 floors)', Number(al.allowance) === 36 && Number(al.consumed) === 10);
    ok('...and is marked manual, not counted', al.source === 'manual');
    var ct = await RL.setCounter(pid, 'physical_deliveries', { window: 'calendar_month', count: 9 }, 'harness');
    ok('class C: a counter can be entered by hand (OH 10/month)', Number(ct.count) === 9 && ct.source === 'manual');
    var fl = await RL.setFlag(pid, 'vexatious', { source: 'court_order', citation: 'Ohio R.C. § 2323.52(J)', note: 'leave required' }, 'harness');
    ok('class D: a flag records WHOSE decision it was', fl.flag === 'vexatious' && fl.source === 'court_order');
    var intakeAdv = await RL.evaluateIntake('jur-tx', dupeReq.childId);
    ok('...and the intake gate surfaces it as an advisory to confirm, not an automatic refusal',
      intakeAdv.advisories.some(function (a) { return a.flag === 'vexatious' && /confirm before acting/.test(a.summary); }));
    ok('...with no automatic trigger attached to it', intakeAdv.triggers.length === 0);
    await RL.clearFlag(pid, 'vexatious', 'court order vacated');
    ok('a flag can be cleared by its clearing event', (await RL.activeFlags(pid)).length === 0);
    var delAdv = await RL.evaluateDelivery('jur-tx', dupeReq.childId);
    ok('the delivery gate reports the manual counter and says it is manual',
      delAdv.advisories.some(function (a) { return a.counter === 'physical_deliveries' && /manual stub/.test(a.summary); }));

    // ---- 8. A state with no prior-balance rule has no gate at all
    var ohCfg = RL.normalizeConfig('OH', { prior_balance: { enabled: true } });
    ok('OH has no unpaid-prior-balance rule, so the gate does not exist there', ohCfg.prior_balance.applies === false);

    var ci = await CI.check();
    ok('config integrity is clean (' + realErrors(ci.findings).length + ' errors)', realErrors(ci.findings).length === 0);

  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack);
    fail++;
  } finally {
    try {
      if (savedActive) await setActive(savedActive);
      await db.run("DELETE FROM jurisdiction_rules WHERE domain = 'ledger' AND updated_by = 'harness-ws5'");
      for (var p = 0; p < profiles.length; p++) {
        if (!profiles[p]) continue;
        for (var tb of ['requestor_ledger_events', 'requestor_allowances', 'requestor_counters', 'requestor_flags', 'requestor_request_links']) {
          try { await db.run('DELETE FROM ' + tb + ' WHERE profile_id = ?', [profiles[p]]); } catch (e) {}
        }
        try { await db.run('DELETE FROM requestor_profiles WHERE id = ?', [profiles[p]]); } catch (e) {}
      }
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t2 = 0; t2 < tabs.length; t2++) for (var c = 0; c < created.length; c++) {
        if (!created[c]) continue;
        try { await db.run('DELETE FROM ' + tabs[t2].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c2 = 0; c2 < created.length; c2++) { if (created[c2]) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c2]]); } catch (e) {} } }
      var left = await db.get('SELECT COUNT(*)::int AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 harness requests left', Number(left.n) === 0);
      var leftP = await db.get("SELECT COUNT(*)::int AS n FROM requestor_profiles WHERE primary_email LIKE '%@example.com'");
      ok('cleanup: 0 harness profiles left', Number(leftP.n) === 0);
      var back = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
      ok('cleanup: active jurisdiction restored to ' + savedActive, back === savedActive);
    } catch (e) { console.error('CLEANUP ERR', e && e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
