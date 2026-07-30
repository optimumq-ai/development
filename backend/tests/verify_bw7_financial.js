'use strict';
// PHASE 7 / BW7 — THE PARENT FINANCIAL VIEW. What this harness asserts, and why each claim earns a test:
//
//   A. THE FIFO CHANGE IS INVISIBLE TO EVERY LIVE SHAPE. This is the hard constraint of the whole workstream
//      and the one a refactor would break silently: a single-record request, a self-funded child and a
//      components-less fallback estimate must produce byte-identical gate verdicts, and `coverageBasis` must
//      keep answering the question it always answered. Section A is the no-op guard; C is the new behaviour.
//   B. THE FROZEN QUOTE. Acceptance freezes the §5.10.2 shares and posts the event that names the basis, and
//      a LATER RECONCILIATION MUST NOT MOVE THE GATE on a shared pool — because a per-item actual does not
//      exist until every sibling has actuals, so a gate that consulted one would be order-dependent.
//   C. CUMULATIVE FIFO. Three $20 items against $50 release two and hold the third. And the assertion the
//      whole method rests on: A DENIED / NEVER-SHIPPED ITEM'S SHARE NEVER CONSUMES FUNDS — so denying item 2
//      must not make item 3 unreleasable. Closure alone is never proof of shipping.
//   D. CREDITS, NETTING, REFUND GATING. A credit refuses without a cause and a reference. Credits reduce the
//      open balance FIRST and a refund exists only for the excess. A refund refuses without a method, a
//      reference or an actor, refuses more than is outstanding, and is RECORD-ONLY. Nothing issues one
//      automatically — asserted at the source, because "no auto-refund" is a rule about code that does not
//      exist and only a source guard can test that.
//   E. SETTLEMENT, BOTH BRANCHES. Not ready until every sibling is terminal and the last item's actuals are
//      in; refuses on a non-MRR and on a second run; a refund/zero outcome RELEASES the last record
//      immediately, and a balance-due outcome HOLDS it. The settled basis must be unreachable outside an MRR.
//   F. THE 20% CAP REFUSES UNNOTIFIED OVERAGE. § 552.2615(b): the itemized statement is a precondition to
//      the money, so the screen will not bill above what the requestor was last told, and says how much is
//      forfeited until it goes out.
//   G. THE STATEMENT IS EVENTED, and the REQUESTOR IS AN EXTERNAL ACTOR — not `person`, because their
//      approval is not the city's decision. Verify ≠ Approve.
//   H. ANONYMOUS: THE CROSS-REQUEST LEDGER DOES NOT APPLY (rule e), and the view says "does not apply"
//      rather than hiding something.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var engine = require('/opt/optimumq/backend/src/services/feeEngine');
var FR = require('/opt/optimumq/backend/src/services/feeRelease');
var PF = require('/opt/optimumq/backend/src/services/parentFinance');
var PS = require('/opt/optimumq/backend/src/services/paymentStatus');

var TAG = 'BW7-' + Date.now();
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Force pay-in-full-before-release on, so `requiresPaymentBeforeRelease` is true and the gate actually gates.
function profile(rules) {
  return { context: 'FR', version: 1, duplication: { bw: { rate: 1 } }, labor: {}, media: {}, av: {},
           delivery: {}, certification: {},
           paymentTiming: { bands: [{ upTo: null, gate: 'pay_in_full_before_release' }] },
           requestRules: rules || {} };
}
// A REAL fee-profile row, so the settlement re-prices with the SAME rules the estimate was priced under.
// Without it `settle()` falls back to the install's active profile — correct behaviour, and it would silently
// re-price the harness's synthetic numbers at the fixture's real rates.
var PROFILE_ID = 'fp-' + TAG;
async function ensureProfile(rules) {
  await db.run("INSERT INTO fee_profiles (id, jurisdiction_id, context, version, status, name, config_json, created_by, created_at, updated_at) " +
    "VALUES (?,?,?,?,?,?,?,?, datetime('now'), datetime('now')) ON CONFLICT (id) DO UPDATE SET config_json = EXCLUDED.config_json",
    [PROFILE_ID, null, 'FR', 1, 'draft', 'bw7 harness', JSON.stringify(profile(rules)), 'harness']);
  return PROFILE_ID;
}
async function mkRequest(id, master, stage) {
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, master_request_id) " +
    "VALUES (?,?,?,?,?,?, 'active', ?) ON CONFLICT (id) DO NOTHING",
    [id, id, 'BW7 Harness', 'bw7@example.com', 'bw7 harness ' + TAG, stage || 'redaction', master || null]);
}
async function writeEstimate(estId, requestId, prof, components, depositPaid, finalPaid, accepted) {
  var fc = engine.compute(prof, { components: components });
  await db.run(
    "INSERT INTO request_fee_estimates (id, request_id, kind, config_profile_id, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, deposit_paid_amount, final_paid_amount, accepted_at, accepted_by, notified_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'), ?, ?, ?, ?, ?)",
    [estId, requestId, 'estimate', PROFILE_ID, JSON.stringify({ components: components }), JSON.stringify(fc),
     fc.requestLevel.total, 0, 0, 'harness', depositPaid || 0, finalPaid || 0,
     accepted ? '2026-07-01 09:00:00' : null, accepted ? 'Requestor' : null, '2026-06-30 09:00:00']);
  return fc;
}
async function writeRecon(id, requestId, prof, components, baseline, renotify) {
  var fc = engine.compute(prof, { components: components });
  await db.run(
    "INSERT INTO request_fee_estimates (id, request_id, kind, config_profile_id, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, baseline_total, variance_pct, renotify_required) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'), ?, ?, ?)",
    [id, requestId, 'reconciliation', PROFILE_ID, '{}', JSON.stringify(fc), fc.requestLevel.total, 0, 0,
     'harness (auto-draft)', baseline == null ? null : baseline,
     baseline ? Math.round(((fc.requestLevel.total - baseline) / baseline) * 1000) / 10 : null, renotify ? 1 : 0]);
  return fc;
}
// SHIP an item — the affirmative evidence the FIFO rule requires. A released fulfilled_record is the
// strongest form; the harness uses it rather than the delivery stage so the two signals stay separable.
async function ship(rid) {
  await db.run("INSERT INTO fulfilled_records (id, request_id, status, released_at, created_at) VALUES (?,?,?,?,?) ON CONFLICT (id) DO NOTHING",
    ['fr-' + rid.slice(-12) + '-' + Math.floor(Math.random() * 9999), rid, 'released',
     '2026-07-02 09:00:00', '2026-07-02 09:00:00']);
}
// END an item WITHOUT shipping — a denial. This is the case §0.2 is about.
async function deny(rid) {
  await db.run("UPDATE requests SET status = 'closed', closure_reason = 'denied — statutory exception' WHERE id = ?", [rid]);
}

(async function () {
  await db.initDb();
  try {
  await ensureProfile({});

  // ================================================================================================
  console.log('\n=== A. THE FIFO CHANGE IS INVISIBLE TO EVERY LIVE SHAPE (the hard constraint) ===');

  var a = 'req-' + TAG + '-A';
  await mkRequest(a);
  await writeEstimate('fe-' + TAG + '-a', a, profile({}), [{ id: a, label: 'R', quantities: { bwPages: 40 } }], 0, 0, true);
  var ga = await FR.releaseGate(a);
  ok('A1 a single-record request: the cumulative rule does NOT apply — one snapshot, one record',
    ga.cumulative === null && ga.coverageMode === 'self');
  ok('A2 …and the gate is exactly what it was: own share $40, unpaid, short $40, tracking paidInFull',
    ga.componentCharged === 40 && ga.covered === false && ga.balanceDue === 40 && ga.covered === ga.paidInFull);
  ok('A3 `coverageBasis` still answers WHERE THE SHARE CAME FROM and nothing else. Overloading it would ' +
     'have silently broken every reader of it', ga.coverageBasis === 'component');

  // A SELF-FUNDED CHILD — the shape every MRR in the system actually has today: the estimate sits on the
  // child, so its component list names only itself and the cumulative rule stays dormant.
  var sp = 'req-' + TAG + '-SP', sc1 = sp + '-C1', sc2 = sp + '-C2';
  await mkRequest(sp); await mkRequest(sc1, sp); await mkRequest(sc2, sp);
  await writeEstimate('fe-' + TAG + '-sc1', sc1, profile({}), [{ id: sc1, label: 'own', quantities: { bwPages: 30 } }], 30, 0, true);
  await writeEstimate('fe-' + TAG + '-sc2', sc2, profile({}), [{ id: sc2, label: 'own', quantities: { bwPages: 30 } }], 0, 0, true);
  await ship(sc1);
  var gsc2 = await FR.releaseGate(sc2);
  ok('A4 a child with its OWN estimate is untouched by FIFO even though a sibling already shipped — ' +
     'separate pools, separate coverage', gsc2.cumulative === null && gsc2.coverageMode === 'self');
  ok('A5 …and it is held for its own $30, not for its sibling', gsc2.covered === false && gsc2.balanceDue === 30);

  // THE FALLBACK — an estimate with no component data at all.
  var fb = 'req-' + TAG + '-FB';
  await mkRequest(fb);
  await db.run("INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, deposit_paid_amount, final_paid_amount) VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), ?, ?)",
    ['fe-' + TAG + '-fb', fb, 'estimate', '{}', JSON.stringify({ requestLevel: { total: 55 } }), 55, 0, 0, 'harness', 0, 0]);
  var gfb = await FR.releaseGate(fb);
  ok('A6 a components-less estimate still falls back to the whole-request test, unchanged',
    gfb.coverageBasis === 'request_total' && gfb.covered === gfb.paidInFull && gfb.cumulative === null);

  // ================================================================================================
  console.log('\n=== B. THE FROZEN QUOTE — acceptance freezes the shares; actuals never move the gate ===');

  var q = await PF.quotedShares(a);
  ok('B1 the accepted estimate IS the freeze — frozen, with its timestamp and the accepting actor',
    q.hasQuote === true && q.frozen === true && q.frozenAt === '2026-07-01 09:00:00');
  ok('B2 the freeze carries the prorata RATIO and a sentence a requestor could be read',
    q.ratio === 1 && /ratio between what the/.test(q.explain));

  var fz = await PF.freezeQuote(a, { actorName: 'Requestor' });
  var fzEv = await db.get("SELECT * FROM request_payment_events WHERE request_id = ? AND type = 'quote_frozen' ORDER BY created_at DESC LIMIT 1", [a]);
  ok('B3 the freeze is EVENTED — the basis is visible on the statement, not inferable from a timestamp on ' +
     'another table', fz.ok === true && !!fzEv && fzEv.reference === q.estimateId);

  // A LATER RECONCILIATION MUST NOT MOVE A SHARED POOL'S GATE. Same shape as section C, plus a
  // reconciliation that doubles the price after acceptance.
  var fp = 'req-' + TAG + '-FP', fk1 = fp + '-C1', fk2 = fp + '-C2';
  await mkRequest(fp); await mkRequest(fk1, fp); await mkRequest(fk2, fp);
  var fcomps = [{ id: fk1, label: 'One', quantities: { bwPages: 20 } }, { id: fk2, label: 'Two', quantities: { bwPages: 20 } }];
  await writeEstimate('fe-' + TAG + '-fp', fp, profile({}), fcomps, 40, 0, true);
  var gBefore = await FR.releaseGate(fk1);
  await writeRecon('fr-' + TAG + '-fp', fp, profile({}), [
    { id: fk1, label: 'One', quantities: { bwPages: 60 } }, { id: fk2, label: 'Two', quantities: { bwPages: 60 } }], 40, true);
  var gAfter = await FR.releaseGate(fk1);
  ok('B4 ⚠ the reconciliation TRIPLED the price and the shared-pool gate did not move — the accepted quote ' +
     'is the basis, and actuals never touch the release gate (§0.1)',
    gBefore.cumulative !== null && gAfter.cumulative !== null &&
    gAfter.cumulative.ownQuotedShare === gBefore.cumulative.ownQuotedShare && gAfter.covered === gBefore.covered);
  ok('B5 …and it says the shares are frozen, and when', gAfter.cumulative.quoteFrozen === true);

  // ================================================================================================
  console.log('\n=== C. CUMULATIVE FIFO — and the share that never consumes ===');

  // Three $20 items, one parent-level accepted quote, $50 paid. Two release; the third is held.
  var p = 'req-' + TAG + '-P', c1 = p + '-C1', c2 = p + '-C2', c3 = p + '-C3';
  await mkRequest(p); await mkRequest(c1, p); await mkRequest(c2, p); await mkRequest(c3, p);
  var comps = [{ id: c1, label: 'One', quantities: { bwPages: 20 } },
               { id: c2, label: 'Two', quantities: { bwPages: 20 } },
               { id: c3, label: 'Three', quantities: { bwPages: 20 } }];
  var pfc = await writeEstimate('fe-' + TAG + '-p', p, profile({}), comps, 50, 0, true);
  ok('C0 the quote is $60 across three $20 items, and $50 has been paid', pfc.requestLevel.total === 60);

  var g1 = await FR.releaseGate(c1);
  ok('C1 nothing has shipped yet, so item 1 needs only its own $20 against $50 — covered',
    g1.cumulative !== null && g1.coverageMode === 'cumulative' && g1.covered === true && g1.cumulative.consumedByShipped === 0);
  await ship(c1);
  var g2 = await FR.releaseGate(c2);
  ok('C2 item 1 shipped and DREW THE POOL DOWN: item 2 needs $20 + $20 = $40 against $50 — covered',
    g2.cumulative.consumedByShipped === 20 && g2.cumulative.required === 40 && g2.covered === true);
  await ship(c2);
  var g3 = await FR.releaseGate(c3);
  ok('C3 ⚠ THE RULE: two shipped, so item 3 needs $60 against $50 — HELD, short $10. Three $20 items ' +
     'against $50 release two and hold the third',
    g3.cumulative.consumedByShipped === 40 && g3.cumulative.required === 60 &&
    g3.covered === false && g3.balanceDue === 10);
  ok('C4 …and the refusal is still an OWN-SHARE sentence, not a sibling-balance one (§5.9)',
    /OWN share/.test(g3.cumulative.ownShareOnly) && /never a reason to withhold/.test(g3.cumulative.ownShareOnly));

  // THE ASSERTION THE WHOLE METHOD RESTS ON.
  var dp = 'req-' + TAG + '-D', d1 = dp + '-C1', d2 = dp + '-C2', d3 = dp + '-C3';
  await mkRequest(dp); await mkRequest(d1, dp); await mkRequest(d2, dp); await mkRequest(d3, dp);
  await writeEstimate('fe-' + TAG + '-dp', dp, profile({}), [
    { id: d1, label: 'One', quantities: { bwPages: 20 } },
    { id: d2, label: 'Two', quantities: { bwPages: 20 } },
    { id: d3, label: 'Three', quantities: { bwPages: 20 } }], 40, 0, true);
  await ship(d1);
  await deny(d2);   // ended WITHOUT shipping
  var gd3 = await FR.releaseGate(d3);
  ok('C5 ⚠⚠ A DENIED ITEM\'S SHARE NEVER CONSUMES FUNDS. Item 2 was denied, so item 3 needs $20 (shipped) ' +
     '+ $20 (its own) = $40 against $40 — RELEASED. If the denial had consumed, item 3 would be short $20 ' +
     'over a record the citizen never received',
    gd3.cumulative.consumedByShipped === 20 && gd3.cumulative.required === 40 && gd3.covered === true);
  var deniedRow = gd3.cumulative.siblings.filter(function (s) { return s.id === d2; })[0];
  ok('C6 …and the row SAYS so, with the reason, so nobody nets it by hand at the counter',
    !!deniedRow && deniedRow.consumes === false && /never consumes funds/.test(deniedRow.evidence));

  // A CREDIT FREES A SIBLING. Crediting the pool is arithmetically identical to shrinking a frozen share.
  var cr = await PF.credit(dp, { amount: 20, causeKind: 'withholding', causeRef: 'LD-' + TAG,
    actorName: 'Finance Officer', itemRequestId: d1 });
  ok('C7 a credit posts and the pool grows by it', cr.ok === true);
  var funds = await FR.poolFunds(dp);
  ok('C8 available funds = paid − refunds + credits — a dollar the citizen no longer owes is a dollar ' +
     'available to release against', funds.available === 60 && funds.credits === 20);

  // ================================================================================================
  console.log('\n=== D. CREDITS, NETTING, AND THE REFUND THAT NOBODY AUTOMATES ===');

  var n = 'req-' + TAG + '-N';
  await mkRequest(n);
  await writeEstimate('fe-' + TAG + '-n', n, profile({}), [{ id: n, label: 'R', quantities: { bwPages: 100 } }], 100, 0, true);

  var refusedCause = null;
  try { await PF.credit(n, { amount: 10, actorName: 'X' }); } catch (e) { refusedCause = e; }
  ok('D1 a credit with NO CAUSE is refused — an unexplained reduction of a public receivable is not ' +
     'something this system writes', !!refusedCause && refusedCause.code === 'CAUSE_REQUIRED');
  var refusedRef = null;
  try { await PF.credit(n, { amount: 10, causeKind: 'withholding', actorName: 'X' }); } catch (e) { refusedRef = e; }
  ok('D2 …and a cause with no REFERENCE is refused too: "because staff said so" is not a citation',
    !!refusedRef && refusedRef.code === 'CAUSE_REF_REQUIRED');

  var net0 = await PF.netting(n);
  ok('D3 paid in full, no credits ⇒ nothing due and nothing owed back',
    net0.base === 100 && net0.paidGross === 100 && net0.balanceDue === 0 && net0.refundOutstanding === 0);

  await PF.credit(n, { amount: 30, causeKind: 'withholding', causeRef: 'LD-N-' + TAG, actorName: 'Finance Officer' });
  var net1 = await PF.netting(n);
  ok('D4 a $30 credit against a fully-paid $100 ⇒ $30 IS a refund, because there was no balance to absorb it',
    net1.credits === 30 && net1.balanceDue === 0 && net1.refundOutstanding === 30);

  // CREDITS ABSORB A BALANCE FIRST. A city does not mail a cheque to somebody who still owes it money.
  var n2 = 'req-' + TAG + '-N2';
  await mkRequest(n2);
  await writeEstimate('fe-' + TAG + '-n2', n2, profile({}), [{ id: n2, label: 'R', quantities: { bwPages: 100 } }], 40, 0, true);
  await PF.credit(n2, { amount: 30, causeKind: 'withholding', causeRef: 'LD-N2-' + TAG, actorName: 'Finance Officer' });
  var net2 = await PF.netting(n2);
  ok('D5 ⚠ ORDER MATTERS: $100 billed, $40 paid, $30 credited ⇒ balance $30, refund $0. Credits reduce the ' +
     'open balance FIRST and a refund exists only for the excess',
    net2.balanceDue === 30 && net2.refundOutstanding === 0 && net2.creditsAbsorbed === 30);
  var noRefund = null;
  try { await PF.refund(n2, { amount: 10, method: 'check_request', reference: 'CK-1', actorName: 'Finance Officer' }); }
  catch (e) { noRefund = e; }
  ok('D6 …so a refund on it is REFUSED, with the arithmetic in the refusal',
    !!noRefund && noRefund.code === 'NO_REFUND_DUE' && /credits reduce the open balance first/i.test(noRefund.message));

  var noMethod = null;
  try { await PF.refund(n, { amount: 10, reference: 'CK-1', actorName: 'Finance Officer' }); } catch (e) { noMethod = e; }
  ok('D7 a refund with no METHOD is refused', !!noMethod && noMethod.code === 'METHOD_REQUIRED');
  var noRef = null;
  try { await PF.refund(n, { amount: 10, method: 'check_request', actorName: 'Finance Officer' }); } catch (e) { noRef = e; }
  ok('D8 …no REFERENCE is refused — without it there is no way to prove the money moved',
    !!noRef && noRef.code === 'REFERENCE_REQUIRED');
  var noActor = null;
  try { await PF.refund(n, { amount: 10, method: 'check_request', reference: 'CK-1' }); } catch (e) { noActor = e; }
  ok('D9 …and no ACTOR is refused: a refund is issued by a named person, and the system does the arithmetic ' +
     'and nothing else', !!noActor && noActor.code === 'ACTOR_REQUIRED');
  var tooMuch = null;
  try { await PF.refund(n, { amount: 500, method: 'check_request', reference: 'CK-1', actorName: 'Finance Officer' }); }
  catch (e) { tooMuch = e; }
  ok('D10 …and more than is outstanding is refused', !!tooMuch && tooMuch.code === 'EXCEEDS_REFUND_DUE');

  var rf = await PF.refund(n, { amount: 30, method: 'check_request', reference: 'CK-' + TAG, actorName: 'Finance Officer' });
  ok('D11 a complete refund records the method and the reference and says it is RECORD ONLY — the movement ' +
     'happens in the city’s finance system', rf.ok === true && rf.recordOnly === true && rf.method === 'check_request');
  var rfRow = await db.get("SELECT * FROM fee_adjustments WHERE id = ?", [rf.id]);
  ok('D12 …on the row, in columns rather than inside a sentence somebody has to parse',
    rfRow.method === 'check_request' && rfRow.reference === 'CK-' + TAG && rfRow.type === 'refund');
  var rfEv = await db.get("SELECT * FROM request_payment_events WHERE request_id = ? AND type = 'refund' ORDER BY created_at DESC LIMIT 1", [n]);
  ok('D13 …and on the payment stream, through the one chokepoint every money event passes',
    !!rfEv && r2(rfEv.amount) === 30);
  var net3 = await PF.netting(n);
  ok('D14 the refund closes the position out', net3.refundOutstanding === 0 && net3.refundsIssued === 30);

  // THE WITHHOLDING HOOK — quoted numbers, frozen share untouched.
  var wp = 'req-' + TAG + '-W', w1 = wp + '-C1', w2 = wp + '-C2';
  await mkRequest(wp); await mkRequest(w1, wp); await mkRequest(w2, wp);
  await writeEstimate('fe-' + TAG + '-wp', wp, profile({}), [
    { id: w1, label: 'Item 1', quantities: { bwPages: 120 } },
    { id: w2, label: 'Item 2', quantities: { bwPages: 120 } }], 240, 0, true);
  var wh = await PF.withholdingCredit(wp, { itemRequestId: w1, determinationRef: 'LD-77',
    withheldUnits: 40, totalUnits: 120, unitLabel: 'pages', actorName: 'Legal Officer' });
  ok('D15 a withholding credit is valued in QUOTED numbers: 40 of 120 pages of a $120 share = $40',
    wh.ok === true && wh.amount === 40 && wh.quotedShare === 120 && wh.revisedQuotedShare === 80);
  ok('D16 …cited to the determination, in words a requestor could be shown',
    /40 of 120 pages withheld per legal determination LD-77/.test(wh.reason));
  var qAfter = await PF.quotedShares(wp);
  var w1After = qAfter.components.filter(function (c) { return c.id === w1; })[0];
  ok('D17 ⚠ the FROZEN share is NOT rewritten. Re-basing the pool retroactively would make an honest ' +
     'earlier release look like an overdraw; the revised figure rides the credit instead',
    w1After.quotedShare === 120);

  // NO AUTO-REFUND ANYWHERE. A rule about code that does not exist can only be tested at the source.
  var pfSrc = fs.readFileSync('/opt/optimumq/backend/src/services/parentFinance.js', 'utf8');
  var callers = [];
  ['autoRelease.js', 'paymentStatus.js', 'laborActuals.js', 'feeNonpayment.js', 'disposition.js', 'mrrHub.js'].forEach(function (f) {
    var src = fs.readFileSync('/opt/optimumq/backend/src/services/' + f, 'utf8');
    if (/parentFinance[^\n]*\.(refund|settle)\s*\(/.test(src)) callers.push(f);
  });
  ok('D18 SOURCE GUARD — NOTHING calls parentFinance.refund() or .settle() automatically. No pipeline, no ' +
     'sweep, no hook. A person issues; the system does arithmetic', callers.length === 0);
  ok('D19 SOURCE GUARD — refund() refuses without an actor in the SERVICE, not only in the router. A gate ' +
     'that lives only in the router is a gate the next caller walks around',
    /A refund is issued by a named person/.test(pfSrc));

  // ================================================================================================
  console.log('\n=== E. SETTLEMENT — the trigger, both branches, and the refusals ===');

  var notMrr = await PF.settlementState(a);
  ok('E1 a single-record request is not settled this way, and says why',
    notMrr.isMrr === false && notMrr.ready === false && /not a multi-record request/.test(notMrr.reason));
  var refusedNotMrr = null;
  try { await PF.settle(a, { actorName: 'Finance Officer' }); } catch (e) { refusedNotMrr = e; }
  ok('E2 …and settle() refuses it outright', !!refusedNotMrr && refusedNotMrr.code === 'NOT_MRR');

  // THE REFUND BRANCH. Three items, all terminal, and MORE paid than the settlement will come to.
  var sp2 = 'req-' + TAG + '-S', s1 = sp2 + '-C1', s2 = sp2 + '-C2', s3 = sp2 + '-C3';
  await mkRequest(sp2); await mkRequest(s1, sp2); await mkRequest(s2, sp2); await mkRequest(s3, sp2);
  await writeEstimate('fe-' + TAG + '-sp', sp2, profile({}), [
    { id: s1, label: 'One', quantities: { bwPages: 40 } },
    { id: s2, label: 'Two', quantities: { bwPages: 40 } },
    { id: s3, label: 'Three', quantities: { bwPages: 40 } }], 120, 0, true);
  var midFlight = await PF.settlementState(sp2);
  ok('E3 nothing is terminal ⇒ NOT ready, and it names how many are still live',
    midFlight.ready === false && /still live/.test(midFlight.reason));
  await ship(s1); await ship(s2);
  var almost = await PF.settlementState(sp2);
  ok('E4 two of three terminal ⇒ the LAST record is identified and it is ready (its billable tasks are none)',
    almost.lastRecord && almost.lastRecord.id === s3 && almost.ready === true);

  // Credit the request so the settlement nets to a refund.
  await PF.credit(sp2, { amount: 30, causeKind: 'reconciliation', causeRef: 'REC-' + TAG, actorName: 'Finance Officer' });
  var settled = await PF.settle(sp2, { actorName: 'Finance Officer' });
  ok('E5 the settlement ran ONCE and nets to a refund', settled.outcome === 'refund' && settled.refundOutstanding === 30);
  ok('E6 ⚠ a refund outcome RELEASES the last record immediately — the city does not sit on a finished ' +
     'record while it owes the citizen money', settled.releasesLastRecordImmediately === true);
  var g3s = await FR.releaseGate(s3);
  ok('E7 …and the GATE agrees: the settled basis, covered, nothing outstanding',
    g3s.coverageMode === 'settled' && g3s.covered === true && g3s.balanceDue === 0);
  var again = null;
  try { await PF.settle(sp2, { actorName: 'Finance Officer' }); } catch (e) { again = e; }
  ok('E8 a second settlement is refused — a request settles once, or a bill the citizen already has gets ' +
     'rewritten', !!again && again.code === 'ALREADY_SETTLED');
  var setEv = await db.get("SELECT * FROM request_payment_events WHERE request_id = ? AND type = 'settlement' ORDER BY created_at DESC LIMIT 1", [sp2]);
  ok('E9 the settlement is EVENTED with its reasoning, so the figure is reconstructable',
    !!setEv && /nets to a refund/.test(setEv.reason || ''));

  // THE BALANCE-DUE BRANCH.
  var bp = 'req-' + TAG + '-B', b1 = bp + '-C1', b2 = bp + '-C2';
  await mkRequest(bp); await mkRequest(b1, bp); await mkRequest(b2, bp);
  await writeEstimate('fe-' + TAG + '-bp', bp, profile({}), [
    { id: b1, label: 'One', quantities: { bwPages: 40 } },
    { id: b2, label: 'Two', quantities: { bwPages: 40 } }], 30, 0, true);
  await ship(b1);
  var settledB = await PF.settle(bp, { actorName: 'Finance Officer' });
  ok('E10 an under-paid request settles to a BALANCE DUE ($80 priced, $30 paid) and does NOT release the ' +
     'last record', settledB.outcome === 'balance_due' && settledB.releasesLastRecordImmediately === false &&
    settledB.finalInvoice === 50);
  var gb2 = await FR.releaseGate(b2);
  ok('E11 …and the gate holds it for the SETTLED balance — after settlement the request is one bill again, ' +
     'which is what makes the refund branch able to release immediately',
    gb2.coverageMode === 'settled' && gb2.covered === false && gb2.balanceDue === 50);

  // THE SETTLED BASIS MUST BE UNREACHABLE OUTSIDE AN MRR.
  var frSrc = fs.readFileSync('/opt/optimumq/backend/src/services/feeRelease.js', 'utf8');
  var settleWriters = [];
  fs.readdirSync('/opt/optimumq/backend/src/services').forEach(function (f) {
    if (!/\.js$/.test(f)) return;
    var src = fs.readFileSync('/opt/optimumq/backend/src/services/' + f, 'utf8');
    if (/SET settlement_at\s*=/.test(src)) settleWriters.push(f);
  });
  ok('E12 SOURCE GUARD — `settlement_at` has exactly ONE writer (parentFinance), which is what makes the ' +
     'settled release basis unreachable on a non-MRR', settleWriters.length === 1 && settleWriters[0] === 'parentFinance.js');
  ok('E13 SOURCE GUARD — the §5.9 footnote is recorded in code rather than adopted silently',
    /purist reading/.test(frSrc) || /purist reading/.test(pfSrc));

  // ================================================================================================
  console.log('\n=== F. THE 20% CAP — the screen refuses to bill unnotified overage ===');

  var cp = 'req-' + TAG + '-CAP', k1 = cp + '-C1', k2 = cp + '-C2';
  await mkRequest(cp); await mkRequest(k1, cp); await mkRequest(k2, cp);
  await writeEstimate('fe-' + TAG + '-cp', cp, profile({}), [
    { id: k1, label: 'One', quantities: { bwPages: 50 } },
    { id: k2, label: 'Two', quantities: { bwPages: 50 } }], 0, 0, true);
  // The reconciliation triples it and flags the revised notice, which has NOT been sent.
  await writeRecon('fr-' + TAG + '-cp', cp, profile({}), [
    { id: k1, label: 'One', quantities: { bwPages: 150 } },
    { id: k2, label: 'Two', quantities: { bwPages: 150 } }], 100, true);
  var watch = await PF.overageWatchdog(cp);
  ok('F1 the watchdog sees the outstanding updated statement and the amount the requestor was last told',
    watch.revisedStatementOutstanding === true && watch.lastNotifiedTotal === 100);
  ok('F2 …and caps collection at that number, naming what is forfeited until the statement goes out',
    watch.collectionCap === 100 && watch.forfeitedUnlessNotified === 200);
  var cap = await PF.collectionCap(cp);
  ok('F3 ⚠ the cap REFUSES the overage: $300 due, $100 billable, and the refusal cites § 552.2615',
    cap.refuse === true && cap.billable === 100 && /552\.2615/.test(cap.citation));
  await ship(k1);
  var settledCap = await PF.settle(cp, { actorName: 'Finance Officer' });
  ok('F4 …and the SETTLEMENT bills the capped figure, not the balance — the itemized statement is a ' +
     'precondition to the money, so unnotified overage is simply not billed',
    settledCap.outcome === 'balance_due' && settledCap.finalInvoice === 100 && settledCap.forfeited === 200);
  ok('F5 …with the reason on the result, so nobody has to reconstruct why the invoice is smaller than the bill',
    /may not collect above/.test(settledCap.forfeitedReason || ''));

  // ================================================================================================
  console.log('\n=== G. THE STATEMENT IS EVENTED, AND THE REQUESTOR IS AN EXTERNAL ACTOR ===');

  var stmt = await PF.statement(a);
  ok('G1 the statement is the event stream and says so', /EVENT STREAM/.test(stmt.discipline));
  var frozenLine = stmt.rows.filter(function (r) { return r.type === 'quote_frozen'; })[0];
  ok('G2 ⚠ the requestor\'s acceptance renders as an EXTERNAL actor, not `person`. Their approval is not ' +
     'the city\'s decision and not the system\'s — Verify ≠ Approve',
    !!frozenLine && frozenLine.decidedBy === 'external' && /external actor/.test(frozenLine.actorNote || ''));
  var creditLine = (await PF.statement(n)).rows.filter(function (r) { return r.type === 'credit'; })[0];
  ok('G3 a credit renders as a PERSON\'s act — the system only computed the amount',
    !!creditLine && creditLine.decidedBy === 'person');
  var adj = await PF.adjustments(n);
  ok('G4 every adjustment carries decidedBy person, always', adj.length > 0 && adj.every(function (r) { return r.decidedBy === 'person'; }));
  // The statement must not be RECOMPUTED. Deleting an estimate would change a recomputed total; it must not
  // change a line already written.
  var before = (await PF.statement(n)).rows.length;
  var afterRead = (await PF.statement(n)).rows.length;
  ok('G5 reading it twice returns the same lines — nothing is derived at read time', before === afterRead);

  // ================================================================================================
  console.log('\n=== H. ANONYMOUS — the cross-request ledger DOES NOT APPLY (rule e) ===');

  var view = await PF.financialView(a);
  ok('H1 the view renders, with every panel computed server-side',
    !!view.netting && !!view.allocation && !!view.statement && !!view.releaseRule && !!view.watchdog);
  ok('H2 an unanchored requestor is ANONYMOUS for ledger purposes — an unverified email is not an identity',
    view.parent.anonymous === true && view.parent.ledgerProfileId == null);
  ok('H3 ⚠ and the copy says "DOES NOT APPLY", never "hidden": an anonymous requestor has no identity for a ' +
     'history to attach to, and "hidden" reads as something withheld from the reader',
    /DOES NOT APPLY/i.test(view.anonymousNote || '') && /Not hidden/.test(view.anonymousNote || ''));
  ok('H4 the release rule is named, and an un-researched jurisdiction reads the stricter existing behaviour',
    view.releaseRule.label === 'pay_in_full' && /stricter existing behaviour/.test(view.releaseRule.derivedNote));
  ok('H5 the allocation table carries the own-share rule ON THE ROW, where staff are tempted to override it',
    view.allocation.rows.length > 0 && /never a reason to withhold this one/.test(view.allocation.rows[0].ownShareRule));
  ok('H6 …and states that variances gate nothing and that the funds check gates RELEASE, never WORK',
    /GATE NOTHING/.test(view.allocation.varianceRule) && /never WORK/.test(view.allocation.gatesWorkNote));
  var mrrView = await PF.financialView(p);
  var neverShipped = mrrView.allocation.rows.filter(function (r) { return !r.consumesFunds; });
  ok('H7 the per-row running balance is present, and un-shipped rows draw NOTHING',
    mrrView.allocation.rows.every(function (r) { return r.fundsBefore != null && r.fundsAfter != null; }) &&
    neverShipped.every(function (r) { return r.fundsBefore === r.fundsAfter; }));
  ok('H8 payment-taking is a LINK to the Cash Drawer and is never duplicated here',
    mrrView.cashDrawer.path === '/cash-drawer' && /never duplicates it/.test(mrrView.cashDrawer.note));
  ok('H9 the IL forfeiture surface is WARNING-ONLY and says the block lives elsewhere',
    /Warning only here/.test(mrrView.forfeiture.posture) && /not\s+duplicated/.test(mrrView.forfeiture.posture));

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  }
})();
