'use strict';
// THE RELEASE GATE IS A COVERAGE TEST, NOT A WHOLE-REQUEST BALANCE TEST (SPEC §5.9).
//
// THE RULE, and it is legal rather than a preference:
//     "A child may NEVER be withheld because a SIBLING is unpaid."
// No state authorizes conditioning release of one record on payment for a different record.
//
// WHAT THIS PREVENTS. The gate used to block on `!paidInFull` — the whole request's balance. On a
// multi-record request that withholds a finished, fully-paid-for record because a DIFFERENT record's money
// has not arrived. It was invisible because no per-record price existed to compare against; `componentCharged`
// (§5.10.2) is what made the correct test expressible.
//
// SECTION C IS THE POINT. Everything else guards the no-op.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var engine = require('/opt/optimumq/backend/src/services/feeEngine');
var gate = require('/opt/optimumq/backend/src/services/feeRelease');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'RC-' + Date.now();

function profile(rules) {
  return { context: 'FR', version: 1, duplication: { bw: { rate: 1 } }, labor: {}, media: {}, av: {},
           delivery: {}, certification: {},
           // Force the "pay in full before release" gate on, so `requiresPaymentBeforeRelease` is true.
           paymentTiming: { bands: [{ upTo: null, gate: 'pay_in_full_before_release' }] },
           requestRules: rules || {} };
}
async function mkRequest(id, master) {
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, master_request_id) VALUES (?,?,?,?,?, 'redaction', 'active', ?) ON CONFLICT (id) DO NOTHING",
    [id, id, 'Test', 't@example.com', 'release coverage ' + TAG, master || null]);
}
// Write an estimate exactly as the real path does: engine output stored as fee_context_json.
async function writeEstimate(estId, requestId, prof, components, depositPaid, finalPaid) {
  var fc = engine.compute(prof, { components: components });
  await db.run(
    "INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, deposit_paid_amount, final_paid_amount) " +
    "VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), ?, ?)",
    [estId, requestId, 'estimate', '{}', JSON.stringify(fc), fc.requestLevel.total, 0, 0, 'harness',
     depositPaid || 0, finalPaid || 0]);
  return fc;
}

(async function () {
  await db.initDb();

  console.log('\n=== A. SINGLE-RECORD REQUEST — the new test must be an EXACT no-op ===');
  // One component ⇒ componentCharged === total, so coverage and paid-in-full are the same number.
  var a = 'req-' + TAG + '-A';
  await mkRequest(a);
  await writeEstimate('fe-' + TAG + '-a', a, profile({}), [{ id: a, label: 'R', quantities: { bwPages: 40 } }], 0, 0);
  var ga = await gate.releaseGate(a);
  ok('A1 the share resolves from the component, not a fallback', ga.coverageBasis === 'component');
  ok('A2 componentCharged equals the whole total ($40) when there is one record', ga.componentCharged === 40);
  ok('A3 unpaid ⇒ NOT covered, and covered agrees with paidInFull', ga.covered === false && ga.covered === ga.paidInFull);
  ok('A4 the shortfall is the full $40', ga.balanceDue === 40);

  var a2 = 'req-' + TAG + '-A2';
  await mkRequest(a2);
  await writeEstimate('fe-' + TAG + '-a2', a2, profile({}), [{ id: a2, label: 'R', quantities: { bwPages: 40 } }], 40, 0);
  var ga2 = await gate.releaseGate(a2);
  ok('A5 paid in full ⇒ covered, still agreeing with paidInFull', ga2.covered === true && ga2.covered === ga2.paidInFull);

  console.log('\n=== B. NO ESTIMATE — nothing to settle, nothing to gate ===');
  var b = 'req-' + TAG + '-B';
  await mkRequest(b);
  var gb = await gate.releaseGate(b);
  ok('B1 no estimate ⇒ covered and not gated', gb.hasEstimate === false && gb.covered === true);

  console.log('\n=== C. ⚠️ THE BUG — a paid record must not be withheld for a SIBLING\'s money ===');
  // One parent-level estimate over three children: $10, $20, $70 = $100 gross, no cap ⇒ charged = gross.
  // The citizen has paid $30 — enough for the two cheap records, not the expensive one.
  var p = 'req-' + TAG + '-P';
  var c1 = 'req-' + TAG + '-C1', c2 = 'req-' + TAG + '-C2', c3 = 'req-' + TAG + '-C3';
  await mkRequest(p);
  await mkRequest(c1, p); await mkRequest(c2, p); await mkRequest(c3, p);
  var fc = await writeEstimate('fe-' + TAG + '-p', p, profile({}), [
    { id: c1, label: 'Cheap A', quantities: { bwPages: 10 } },
    { id: c2, label: 'Cheap B', quantities: { bwPages: 20 } },
    { id: c3, label: 'Expensive', quantities: { bwPages: 70 } }
  ], 30, 0);
  ok('C0 the estimate totals $100 across three children', fc.requestLevel.total === 100);

  var g1 = await gate.releaseGate(c1);
  var g2 = await gate.releaseGate(c2);
  var g3 = await gate.releaseGate(c3);
  ok('C1 the $10 child resolves ITS OWN share, found on the PARENT\'s estimate',
    g1.coverageBasis === 'component' && g1.componentCharged === 10);
  ok('C2 the $10 child is COVERED by the $30 paid — released', g1.covered === true);
  ok('C3 the $20 child is COVERED — released', g2.covered === true && g2.componentCharged === 20);
  ok('C4 the $70 child is NOT covered — correctly held', g3.covered === false && g3.componentCharged === 70);
  ok('C5 the held child owes $40, not the request balance of $70', g3.balanceDue === 40);
  // The regression assertion: under the OLD rule every one of these was blocked, because the REQUEST was not
  // paid in full. Two finished, paid-for records were withheld for a sibling's money.
  ok('C6 ⚠️ the request is NOT paid in full — the old gate would have withheld ALL THREE',
    g1.paidInFull === false && g2.paidInFull === false && g3.paidInFull === false);
  ok('C7 …yet coverage releases the two that are paid for', g1.covered === true && g2.covered === true);

  console.log('\n=== D. FALLBACK — an estimate with no per-component data ===');
  // Estimates priced before componentCharged existed. Falls back to the whole-request test: stricter than
  // §5.9 requires, never more permissive.
  var d = 'req-' + TAG + '-D';
  await mkRequest(d);
  await db.run("INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, deposit_paid_amount, final_paid_amount) VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), ?, ?)",
    ['fe-' + TAG + '-d', d, 'estimate', '{}', JSON.stringify({ requestLevel: { total: 55 } }), 55, 0, 0, 'harness', 0, 0]);
  var gd = await gate.releaseGate(d);
  ok('D1 no components ⇒ falls back to the request total, and says so', gd.coverageBasis === 'request_total');
  ok('D2 the fallback is the OLD behaviour — covered tracks paidInFull', gd.covered === gd.paidInFull && gd.covered === false);

  console.log('\n=== E. CENT TOLERANCE — a rounding artefact must not withhold a record ===');
  var e = 'req-' + TAG + '-E';
  await mkRequest(e);
  // 3 × $10 against a $20 cap: shares are 6.67 / 6.67 / 6.66 and sum exactly to $20.
  var ec1 = e + '-1', ec2 = e + '-2', ec3 = e + '-3';
  await mkRequest(ec1, e); await mkRequest(ec2, e); await mkRequest(ec3, e);
  var efc = await writeEstimate('fe-' + TAG + '-e', e, profile({ maxFee: 20 }), [
    { id: ec1, label: '1', quantities: { bwPages: 10 } },
    { id: ec2, label: '2', quantities: { bwPages: 10 } },
    { id: ec3, label: '3', quantities: { bwPages: 10 } }
  ], 6.67, 0);
  ok('E0 the cap fired and shares sum to the total',
    efc.requestLevel.total === 20 &&
    Math.round(efc.components.reduce(function (s, c) { return s + c.componentCharged; }, 0) * 100) / 100 === 20);
  var ge = await gate.releaseGate(ec1);
  ok('E1 a child paid to the exact cent is covered', ge.covered === true);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
