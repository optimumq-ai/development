'use strict';
// FEE REVENUE IS REAL MONEY, AND IT CAN BE ATTRIBUTED TO A DEPARTMENT (SPEC §5.10.2, §5.10.4).
//
// TWO DEFECTS ARE UNDER TEST HERE, and they are independent:
//
//   1. REVENUE WAS STRUCTURALLY $0. `reportEngine` summed `requests.amount_paid`, a column with NO WRITER
//      anywhere in the codebase — that read was its only reference in the entire repo. Money is recorded on
//      `request_fee_estimates.deposit_paid_amount` / `final_paid_amount`. So the `fee_revenue_ytd` button and
//      every revenue figure reported $0 no matter how much a city had collected. Section A.
//
//   2. REVENUE BY DEPARTMENT WAS REFUSED as UNDEFINED (HANDOFF 2026-07-14 (tm)) — correctly, at the time. A
//      request whose records span two departments has ONE payment and TWO departments, and a join would
//      double-count it into both. `componentCharged` (§5.10.2) supplies the missing allocation. Section C.
//
// SECTION C IS THE POINT. A and B guard the foundation, D–G guard the edges.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var engine = require('/opt/optimumq/backend/src/services/feeEngine');
var alloc = require('/opt/optimumq/backend/src/services/revenueAllocation');
var reports = require('/opt/optimumq/backend/src/services/reportEngine');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'RV-' + Date.now();

function profile(rules) {
  return { context: 'FR', version: 1, duplication: { bw: { rate: 1 } }, labor: {}, media: {}, av: {},
           delivery: {}, certification: {}, requestRules: rules || {} };
}
async function mkDept(id, name) {
  await db.run("INSERT INTO departments (id, name, code) VALUES (?,?,?) ON CONFLICT (id) DO NOTHING", [id, name, id]);
}
async function mkRequest(id, master, deptId) {
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, master_request_id, department_id, classification) " +
    "VALUES (?,?,?,?,?, 'redaction', 'active', ?, ?, 'standard') ON CONFLICT (id) DO NOTHING",
    [id, id, 'Test', 't@example.com', 'revenue ' + TAG, master || null, deptId || null]);
}
async function writeEstimate(estId, requestId, prof, components, depositPaid, finalPaid) {
  var fc = engine.compute(prof, { components: components });
  await db.run(
    "INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, deposit_paid_amount, final_paid_amount) " +
    "VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), ?, ?)",
    [estId, requestId, 'estimate', '{}', JSON.stringify(fc), fc.requestLevel.total, 0, 0, 'harness',
     depositPaid || 0, finalPaid || 0]);
  return fc;
}
// Revenue attributed to one request id, out of a full allocation run.
function amountFor(parts, rid) {
  return Math.round(parts.filter(function (p) { return p.requestId === rid; })
    .reduce(function (s, p) { return s + p.amount; }, 0) * 100) / 100;
}
function rowFor(rep, label) {
  var r = rep.rows.filter(function (x) { return x.label === label; })[0];
  return r ? r.value : null;
}

(async function () {
  await db.initDb();
  await mkDept('dep-' + TAG + '-police', 'Police ' + TAG);
  await mkDept('dep-' + TAG + '-fire', 'Fire ' + TAG);
  var POLICE = 'Police ' + TAG, FIRE = 'Fire ' + TAG;

  console.log('\n=== A. THE ROOT DEFECT — revenue comes from payments, not from a column nobody writes ===');
  var a = 'req-' + TAG + '-A';
  await mkRequest(a, null, 'dep-' + TAG + '-police');
  await writeEstimate('fe-' + TAG + '-a', a, profile({}), [{ id: a, label: 'R', quantities: { bwPages: 40 } }], 25, 15);
  // A1 used to assert `requests.amount_paid` was still 0. The columns were DROPPED 2026-07-19 once the last
  // reader was cut over, so the stronger assertion is that they cannot come back: a reinstated column is a
  // second, always-zero money source waiting for a future query to find and believe — which is exactly how
  // the $0-revenue defect happened. Checked against the catalog, so it also covers a fresh install.
  var deadCols = await db.all(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'requests' AND column_name IN ('actual_fee','amount_paid')");
  ok('A1 the dead money columns are gone and stay gone', (deadCols || []).length === 0);
  var partsA = await alloc.collected();
  ok('A2 deposit + final are BOTH counted ($25 + $15 = $40)', amountFor(partsA, a) === 40);
  var repA = await reports.run({ metric: 'fee_revenue' });
  ok('A3 the ungrouped revenue report is non-zero', repA.rows[0].value !== '$0' && repA.rows[0].value !== 0);

  console.log('\n=== B. n = 1 — allocation must be an EXACT identity for an ordinary request ===');
  ok('B1 a single-record request attributes 100% of its payment to itself',
    amountFor(partsA, a) === 40 && partsA.filter(function (p) { return p.paidForRequestId === a; }).length === 1);
  ok('B2 and it is a real allocation, not the fallback',
    partsA.filter(function (p) { return p.paidForRequestId === a; })[0].basis === 'component');
  var repB = await reports.run({ metric: 'fee_revenue', group_by: 'department' });
  ok('B3 it lands wholly on its own department', rowFor(repB, POLICE) >= 40);

  console.log('\n=== C. THE POINT — one payment, two departments, and the columns still sum ===');
  // Parent with three children: $10 Police, $20 Fire, $70 Police, against a $50 cap.
  // The cap fires, so charged shares (10/20/70 × 50/100 = 5/10/35) are NOT the gross figures — which is
  // exactly why a naive join on componentGross would have been wrong too.
  var c = 'req-' + TAG + '-C';
  var c1 = c + '-1', c2 = c + '-2', c3 = c + '-3';
  await mkRequest(c, null, 'dep-' + TAG + '-police');
  await mkRequest(c1, c, 'dep-' + TAG + '-police');
  await mkRequest(c2, c, 'dep-' + TAG + '-fire');
  await mkRequest(c3, c, 'dep-' + TAG + '-police');
  var fcC = await writeEstimate('fe-' + TAG + '-c', c, profile({ maxFee: 50 }), [
    { id: c1, label: '1', quantities: { bwPages: 10 } },
    { id: c2, label: '2', quantities: { bwPages: 20 } },
    { id: c3, label: '3', quantities: { bwPages: 70 } }
  ], 50, 0);
  // C0 guards against the VACUOUS-TEST failure of verify_component_charged §D: if the cap never fires the
  // ratio is 1, every share equals its gross, and the allocation is never actually exercised.
  ok('C0 the cap actually fired (gross $100 → total $50), so allocation is under test',
    fcC.requestLevel.grossSubtotal === 100 && fcC.requestLevel.total === 50);
  var partsC = (await alloc.collected()).filter(function (p) { return p.paidForRequestId === c; });
  ok('C1 the payment is split three ways, not attributed once', partsC.length === 3);
  ok('C2 each child gets its charged share ($5 / $10 / $35)',
    amountFor(partsC, c1) === 5 && amountFor(partsC, c2) === 10 && amountFor(partsC, c3) === 35);
  ok('C3 the shares sum to exactly what was collected ($50)',
    Math.round(partsC.reduce(function (s, p) { return s + p.amount; }, 0) * 100) / 100 === 50);
  var repC = await reports.run({ metric: 'fee_revenue', group_by: 'department' });
  ok('C4 Fire is credited its $10 — the department that earned it, not the one that was billed',
    rowFor(repC, FIRE) === 10);
  ok('C5 Police is credited $5 + $35 from this request, plus $40 from A', rowFor(repC, POLICE) === 80);
  // The property whose absence made this cut UNDEFINED.
  var repTotal = await reports.run({ metric: 'fee_revenue' });
  var colSum = Math.round(repC.rows.reduce(function (s, r) { return s + r.value; }, 0) * 100) / 100;
  var grand = Number(String(repTotal.rows[0].value).replace(/[$,]/g, ''));
  ok('C6 THE COLUMNS SUM TO THE TOTAL — no money invented, none lost', colSum === grand);

  console.log('\n=== D. ORDER-INDEPENDENCE — a report that reorders its input must not move a cent ===');
  // ⚠️ THIS SECTION WAS VACUOUS ON FIRST WRITE, exactly as verify_component_charged §D was, and a break-test
  // caught it: shares of 6.67 / 6.67 / 6.66 against $20 sum to EXACTLY $20, so there was no residual and the
  // residual branch never ran. It stayed green with the rule deliberately sabotaged to "settle on the last".
  // 7 / 11 / 13 against $20 rounds to 4.52 + 7.10 + 8.39 = $20.01 — a real −$0.01 to misplace.
  var comps = [{ id: 'x1', componentCharged: 7 }, { id: 'x2', componentCharged: 11 }, { id: 'x3', componentCharged: 13 }];
  var PAID = 20;
  // D0 asserts the scenario ENGAGES the residual path, so this section cannot silently go vacuous again.
  var naive = comps.reduce(function (s, c) {
    return Math.round((s + Math.round(PAID * (c.componentCharged / 31) * 100) / 100) * 100) / 100;
  }, 0);
  ok('D0 the shares do NOT divide evenly, so a residual exists to be placed', naive !== PAID);
  var fwd = alloc.splitOne('p', PAID, comps);
  var rev = alloc.splitOne('p', PAID, comps.slice().reverse());
  ok('D1 the residual settles on the largest share, so reversing the input changes nothing',
    amountFor(fwd, 'x1') === amountFor(rev, 'x1') &&
    amountFor(fwd, 'x2') === amountFor(rev, 'x2') &&
    amountFor(fwd, 'x3') === amountFor(rev, 'x3'));
  ok('D2 the cent came off the largest share, not the last one listed', amountFor(fwd, 'x3') === 8.38);
  ok('D3 and both orders still sum to the payment',
    Math.round(fwd.reduce(function (s, p) { return s + p.amount; }, 0) * 100) / 100 === PAID &&
    Math.round(rev.reduce(function (s, p) { return s + p.amount; }, 0) * 100) / 100 === PAID);

  console.log('\n=== E. FALLBACK — an estimate with no per-record pricing is disclosed, never guessed ===');
  var e1 = alloc.splitOne('req-E', 30, [{ id: 'k1' }, { id: 'k2' }]);   // no componentCharged at all
  ok('E1 money stays whole on the request it was collected against', e1.length === 1 && e1[0].amount === 30);
  ok('E2 and it is reported as request_total, not passed off as an allocation', e1[0].basis === 'request_total');

  console.log('\n=== F. NOTHING PRICED — a waived request must not produce NaN ===');
  // Reachable, not defensive: a full waiver / de-minimis prices every component at 0.
  var f1 = alloc.splitOne('req-F', 12, [{ id: 'z1', componentCharged: 0 }, { id: 'z2', componentCharged: 0 }]);
  ok('F1 a zero-priced split does not divide by zero', f1.every(function (p) { return isFinite(p.amount); }));
  ok('F2 it falls back whole rather than allocating NaN across departments',
    f1.length === 1 && f1[0].amount === 12 && f1[0].basis === 'request_total');

  console.log('\n=== G. FILTERS APPLY TO THE PAYER, NOT THE EARNER ===');
  // The citizen paid once, on a date, with a status — parent facts. Filtering on the child would silently
  // drop revenue whose parent matched and under-report the total.
  var repG = await reports.run({ metric: 'fee_revenue', group_by: 'department', filters: { status: 'active' } });
  ok('G1 an active-status filter keeps the split intact (the children are what carry departments)',
    rowFor(repG, FIRE) === 10);
  var repG2 = await reports.run({ metric: 'fee_revenue', group_by: 'department', filters: { status: 'closed' } });
  ok('G2 filtering to a status no payer has yields no revenue, not unfiltered revenue',
    repG2.rows.length === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
