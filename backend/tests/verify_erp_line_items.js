'use strict';
// THE ERP CHARGE CARRIES ITS DETAIL (SPEC §5.10.5).
//
// `emitCharge()` sent a single scalar `amount`. The ERP was never told there were eleven records, so it could
// not allocate anything — which is why "let Finance's ERP allocate it" collapsed into "build it, then also
// send it." `componentCharged` (§5.10.2) exists now, so the charge carries line items.
//
// THE DECISION UNDER TEST: the release-gate allocation and the GL allocation are DIFFERENT QUESTIONS AND NEED
// NOT AGREE. We send Finance detail, not a mandate. The city picks via `erp_allocation_method`:
//   'prorata' (default) — line items carry `amount`, summing to the charge.
//   'none'              — line items carry `actualCost` and NO `amount`, for a city with its own policy.
//
// SECTION D IS THE ONE THAT PREVENTS A CITIZEN BEING OVER-BILLED. Raw costs do not sum to the charge; if
// 'none' reused the field name `amount`, an ERP that sums line items would post more than the city is
// charging. The field is absent, so that failure is structurally unavailable, not merely documented.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var engine = require('/opt/optimumq/backend/src/services/feeEngine');
var erp = require('/opt/optimumq/backend/src/services/erpSettlement');
var gate = require('/opt/optimumq/backend/src/services/feeRelease');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'EL-' + Date.now();

function profile(rules) {
  return { context: 'FR', version: 1, duplication: { bw: { rate: 1 } }, labor: {}, media: {}, av: {},
           delivery: {}, certification: {}, requestRules: rules || {} };
}
async function mkRequest(id, master) {
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, master_request_id) " +
    "VALUES (?,?,?,?,?, 'redaction', 'active', ?) ON CONFLICT (id) DO NOTHING",
    [id, id, 'Test', 't@example.com', 'erp lines ' + TAG, master || null]);
}
async function writeSnap(estId, requestId, kind, prof, components) {
  var fc = engine.compute(prof, { components: components });
  await db.run(
    "INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, deposit_paid_amount, final_paid_amount) " +
    "VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), 0, 0)",
    [estId, requestId, kind, '{}', JSON.stringify(fc), fc.requestLevel.total, 0, 0, 'harness']);
  return fc;
}
function sum(items, field) {
  return Math.round(items.reduce(function (s, x) { return s + (Number(x[field]) || 0); }, 0) * 100) / 100;
}
function itemFor(d, id) { return d.lineItems.filter(function (x) { return x.recordId === id; })[0]; }

(async function () {
  await db.initDb();

  console.log('\n=== A. PRORATA — line items sum to THE CHARGE, not to the estimate ===');
  // $10 / $20 / $70 against a $50 cap ⇒ charged shares 5 / 10 / 35.
  var a = 'req-' + TAG + '-A', a1 = a + '-1', a2 = a + '-2', a3 = a + '-3';
  await mkRequest(a); await mkRequest(a1, a); await mkRequest(a2, a); await mkRequest(a3, a);
  var fcA = await writeSnap('fe-' + TAG + '-a', a, 'estimate', profile({ maxFee: 50 }), [
    { id: a1, label: 'One', quantities: { bwPages: 10 } },
    { id: a2, label: 'Two', quantities: { bwPages: 20 } },
    { id: a3, label: 'Three', quantities: { bwPages: 70 } }
  ]);
  // A0 guards against a vacuous scenario: if the cap never fired, charged would equal gross and the
  // allocation would never be exercised. (Same trap as verify_component_charged §D and
  // verify_revenue_allocation §D — both shipped vacuous.)
  ok('A0 the cap actually fired (gross $100 → total $50)',
    fcA.requestLevel.grossSubtotal === 100 && fcA.requestLevel.total === 50);
  var full = await erp.buildLineItems({ requestId: a, estimateId: 'fe-' + TAG + '-a', amount: 50 }, 'prorata');
  ok('A1 three records produce three line items', full.lineItems.length === 3);
  ok('A2 each carries its charged share ($5 / $10 / $35)',
    itemFor(full, a1).amount === 5 && itemFor(full, a2).amount === 10 && itemFor(full, a3).amount === 35);
  ok('A3 they sum to the charge amount', sum(full.lineItems, 'amount') === 50);
  ok('A4 the payload declares its allocation method', full.allocation === 'prorata');

  console.log('\n=== B. A DEPOSIT IS A PARTIAL CHARGE — lines must sum to the DEPOSIT, not the total ===');
  // The bug this prevents: allocating the estimate total onto a 40% deposit charge, billing $50 of detail
  // against a $20 charge.
  var dep = await erp.buildLineItems({ requestId: a, estimateId: 'fe-' + TAG + '-a', amount: 20 }, 'prorata');
  ok('B1 the lines sum to the deposit ($20), not the estimate ($50)', sum(dep.lineItems, 'amount') === 20);
  ok('B2 and the split keeps its proportions ($2 / $4 / $14)',
    itemFor(dep, a1).amount === 2 && itemFor(dep, a2).amount === 4 && itemFor(dep, a3).amount === 14);
  ok('B3 componentCharged is still reported at full value, so Finance can see the price behind the deposit',
    itemFor(dep, a3).componentCharged === 35);

  console.log('\n=== C. n = 1 — an ordinary request gets one line worth the whole charge ===');
  var c = 'req-' + TAG + '-C';
  await mkRequest(c);
  await writeSnap('fe-' + TAG + '-c', c, 'estimate', profile({}), [{ id: c, label: 'R', quantities: { bwPages: 40 } }]);
  var one = await erp.buildLineItems({ requestId: c, estimateId: 'fe-' + TAG + '-c', amount: 40 }, 'prorata');
  ok('C1 a single-record request yields exactly one line item', one.lineItems.length === 1);
  ok('C2 worth the entire charge', one.lineItems[0].amount === 40 && sum(one.lineItems, 'amount') === 40);

  console.log('\n=== D. \'none\' MODE — THE OVER-BILLING GUARD ===');
  var none = await erp.buildLineItems({ requestId: a, estimateId: 'fe-' + TAG + '-a', amount: 50 }, 'none');
  ok('D1 line items carry the ACTUAL per-record cost (gross: $10 / $20 / $70)',
    itemFor(none, a1).actualCost === 10 && itemFor(none, a2).actualCost === 20 && itemFor(none, a3).actualCost === 70);
  // THE POINT. Gross sums to $100 against a $50 charge — an ERP summing `amount` would double-bill.
  ok('D2 NO line item carries an `amount` field, so a naive sum cannot over-bill',
    none.lineItems.every(function (x) { return !('amount' in x); }));
  ok('D3 the actual costs deliberately do NOT sum to the charge ($100 vs $50)',
    sum(none.lineItems, 'actualCost') === 100);
  ok('D4 the payload declares the method and says so in words',
    none.allocation === 'none' && /do NOT sum/i.test(none.note));

  console.log('\n=== E. NEVER FABRICATE A SPLIT ===');
  // An estimate with no components at all: the charge must go as the scalar it always was.
  var e = 'req-' + TAG + '-E';
  await mkRequest(e);
  await db.run("INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, deposit_paid_amount, final_paid_amount) " +
    "VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), 0, 0)",
    ['fe-' + TAG + '-e', e, 'estimate', '{}', JSON.stringify({ components: [] }), 25, 0, 0, 'harness']);
  var nil = await erp.buildLineItems({ requestId: e, estimateId: 'fe-' + TAG + '-e', amount: 25 }, 'prorata');
  ok('E1 no components ⇒ no line items, not an invented one', nil === null);
  var missing = await erp.buildLineItems({ requestId: 'req-' + TAG + '-nope', amount: 10 }, 'prorata');
  ok('E2 no estimate at all ⇒ no line items', missing === null);

  console.log('\n=== F. A RECONCILIATION SUPERSEDES THE ESTIMATE ===');
  // Bill against the figures that actually govern, or a record is released on one split and billed on another.
  await writeSnap('fe-' + TAG + '-a2', a, 'reconciliation', profile({ maxFee: 100 }), [
    { id: a1, label: 'One', quantities: { bwPages: 10 } },
    { id: a2, label: 'Two', quantities: { bwPages: 20 } },
    { id: a3, label: 'Three', quantities: { bwPages: 70 } }
  ]);
  var afterRecon = await erp.buildLineItems({ requestId: a, estimateId: 'fe-' + TAG + '-a', amount: 100 }, 'prorata');
  ok('F1 the reconciliation\'s uncapped split is billed ($10 / $20 / $70), not the estimate\'s capped one',
    itemFor(afterRecon, a1).amount === 10 && itemFor(afterRecon, a3).amount === 70);
  ok('F2 and it still sums to the charge', sum(afterRecon.lineItems, 'amount') === 100);

  console.log('\n=== G. THE ERP AND THE RELEASE GATE MUST TELL ONE STORY ===');
  // Different questions (§5.10.5), but under the default prorata method they resolve the same snapshot with
  // the same allocator — so a record's billed price and its gate share must not disagree by a cent.
  var g = await gate.releaseGate(a3);
  ok('G1 the gate share and the billed componentCharged agree',
    g.componentCharged === itemFor(afterRecon, a3).componentCharged);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
