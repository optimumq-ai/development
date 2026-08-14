'use strict';
// LEGAL HOURS IN THE ESTIMATE — slice 2: the engine's "Legal review" line
// (DESIGN_legal_hours_estimate.md; Kevin's fork 2: own line on the citizen notice).
//
// WHAT THIS PREVENTS: legal hours priced under rules DIFFERENT from what the city configured for
// review when no legal override exists (the inherit contract); a city's labor.legal override
// silently ignored; a statutory labor bar (billable:false, the TX 50-page all-or-nothing) applying
// to review but not to legal; a purpose override flipping review but not legal; free hours skipping
// legal; the citizen's notice hiding legal time inside the review line (Kevin chose its own line);
// reconciliation double-charging legal (estimated legalHours must be superseded by the measured
// review actuals that already contain the legal work's seconds); and the chargeability boxes
// disagreeing with what the engine will actually price.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var engine = require('/opt/optimumq/backend/src/services/feeEngine');
var feeNotice = require('/opt/optimumq/backend/src/services/feeNotice');
var chargeability = require('/opt/optimumq/backend/src/services/chargeability');
var LA = require('/opt/optimumq/backend/src/services/laborActuals');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function laborItem(out, kind) { return (out.requestLevel.labor || []).filter(function (l) { return l.kind === kind; })[0] || null; }
function comp(q) { return { id: 'c1', quantities: q }; }

// A minimal TX-shaped profile: review $15 @ .25 up, the 50-page paper-only all-or-nothing bar.
function txish() {
  return {
    labor: {
      search: { rate: 15, increment: 0.25, rounding: 'up' },
      review: { rate: 15, increment: 0.25, rounding: 'up',
        billableWhen: { mode: 'all_or_nothing', trigger: 'pages', threshold: 50, paperOnly: true } },
      overheadPct: 20
    },
    duplication: { bw: { rate: 0.10 } },
    requestRules: {}
  };
}

(async function () {
  await db.initDb(); // testEnv sanity only — every check below is engine-direct and pure.

  console.log('\n=== A. INHERITANCE — legal prices EXACTLY as review unless the city diverges ===');
  var out = engine.compute(txish(), { delivery: { method: 'email' }, components: [comp({ reviewHours: 1.5, legalHours: 2 })] });
  var leg = laborItem(out, 'legal_labor'), rev = laborItem(out, 'review_labor');
  ok('A1 legalHours price at review\'s inherited rate, on their own line',
    leg && leg.rate === 15 && leg.amount === 30 && rev && rev.amount === 22.5);
  ok('A2 the line is separate in the labor items AND inside the labor subtotal',
    out.requestLevel.laborSubtotal === 52.5);
  var p2 = txish(); p2.labor.legal = { rate: 40 };
  var out2 = engine.compute(p2, { delivery: { method: 'email' }, components: [comp({ reviewHours: 1, legalHours: 1 })] });
  ok('A3 a city\'s labor.legal.rate override diverges legal while review stays put',
    laborItem(out2, 'legal_labor').rate === 40 && laborItem(out2, 'review_labor').rate === 15);
  var p3 = txish(); p3.labor.legal = { billable: false };
  var out3 = engine.compute(p3, { delivery: { method: 'email' }, components: [comp({ reviewHours: 1, legalHours: 3 })] });
  ok('A4 labor.legal.billable:false zeroes ONLY legal, with the refusal in words',
    laborItem(out3, 'legal_labor').nonBillable === true && laborItem(out3, 'legal_labor').amount === 0 &&
    /Not chargeable/.test(laborItem(out3, 'legal_labor').billabilityNote) && laborItem(out3, 'review_labor').amount === 15);
  var out4 = engine.compute(txish(), { delivery: { method: 'mail' }, components: [comp({ reviewHours: 1, legalHours: 2, bwPages: 8 })] });
  ok('A5 the inherited 50-page PAPER bar bites legal exactly as it bites review (8 paper pages -> both $0)',
    laborItem(out4, 'legal_labor').nonBillable === true && laborItem(out4, 'review_labor').nonBillable === true);
  var out5 = engine.compute(txish(), { delivery: { method: 'mail' }, components: [comp({ reviewHours: 1, legalHours: 2, bwPages: 60 })] });
  ok('A6 …and releases both past the threshold (60 pages -> both priced)',
    laborItem(out5, 'legal_labor').amount === 30 && laborItem(out5, 'review_labor').amount === 15);
  var out6 = engine.compute({ labor: { search: { rate: 15 } }, duplication: {}, requestRules: {} },
    { components: [comp({ legalHours: 2 })] });
  ok('A7 with NO review and NO legal config there is no legal line and no crash (hours stay recorded upstream)',
    laborItem(out6, 'legal_labor') === null && engine.legalLaborConfig({}) === null);

  console.log('\n=== B. PURPOSE + FREE HOURS + ROUNDING ride the same rails ===');
  var p7 = txish();
  p7.labor.review.billable = false; delete p7.labor.review.billableWhen;
  p7.purposeOverrides = { commercial: { labor: { review: { billable: true } } } };
  var std = engine.compute(p7, { purpose: 'standard', delivery: { method: 'email' }, components: [comp({ legalHours: 2 })] });
  var com = engine.compute(p7, { purpose: 'commercial', delivery: { method: 'email' }, components: [comp({ legalHours: 2 })] });
  ok('B1 a commercial override flipping review\'s billability carries to legal through the inherit',
    laborItem(std, 'legal_labor').nonBillable === true && laborItem(com, 'legal_labor').amount === 30);
  var p8 = txish(); p8.requestRules.freeLaborHours = 3;
  var out8 = engine.compute(p8, { delivery: { method: 'email' }, components: [comp({ searchHours: 1, reviewHours: 1, legalHours: 2 })] });
  ok('B2 free hours consume search -> review -> legal in order (3 free eat search+review fully, then 1 of legal)',
    laborItem(out8, 'legal_labor').billableHours === 1 && laborItem(out8, 'legal_labor').amount === 15 &&
    laborItem(out8, 'search_labor').amount === 0 && laborItem(out8, 'review_labor').amount === 0);
  var out9 = engine.compute(txish(), { delivery: { method: 'email' }, components: [comp({ legalHours: 1.1 })] });
  ok('B3 review\'s increment/rounding are inherited (1.1h @ .25 up -> 1.25 billable)',
    laborItem(out9, 'legal_labor').billableHours === 1.25);
  var outOv = engine.compute(txish(), { delivery: { method: 'email' }, rateOverrides: { legal: 22 }, components: [comp({ legalHours: 1 })] });
  ok('B4 a per-request actual-rate override addresses legal by its own key', laborItem(outOv, 'legal_labor').rate === 22);

  console.log('\n=== C. THE CITIZEN\'S NOTICE — legal time is its OWN line (Kevin, from previews) ===');
  var noticed = engine.compute(txish(), { delivery: { method: 'email' }, components: [comp({ searchHours: 2, reviewHours: 1.5, legalHours: 3 })] });
  var notice = feeNotice.buildNotice({ request_number: '2026-000099', requestor_name: 'N' }, noticed, { agencyName: 'Autumn Falls' });
  ok('C1 the notice itemizes "Legal review of the records" separately from the review line',
    /Legal review of the records: 3 hours at \$15\.00\/hour = \$45\.00/.test(notice.text) &&
    /review and prepare records: 1\.5 hours/.test(notice.text));

  console.log('\n=== D. RECONCILIATION — measured review actuals SUPERSEDE the estimated legal hours ===');
  var overlaid = LA.applyMeasuredLabor(
    { components: [{ id: 'a', quantities: { reviewHours: 1, legalHours: 4, bwPages: 10 } }, { id: 'b', quantities: { legalHours: 2 } }] },
    { searchHours: 0, reviewHours: 5.5, programmingHours: 0 });
  ok('D1 applyMeasuredLabor zeroes estimated legalHours on EVERY component (no double-charge) and keeps pages',
    overlaid.components[0].quantities.legalHours === 0 && overlaid.components[1].quantities.legalHours === 0 &&
    overlaid.components[0].quantities.reviewHours === 5.5 && overlaid.components[0].quantities.bwPages === 10);
  var est = LA.estimatedHoursFromInput({ components: [comp({ reviewHours: 1.5, legalHours: 3 })] });
  ok('D2 the estimate-vs-actual readout pairs estimated review+legal against measured review',
    est.reviewHours === 4.5);

  console.log('\n=== E. CHARGEABILITY BOXES agree with the engine ===');
  var kindsInherit = chargeability.fromConfig(txish(), 'TX');
  var legalKind = kindsInherit.filter(function (k) { return k.key === 'legal'; })[0];
  ok('E1 the legal box exists and inherits review\'s conditional bar (same words the builder shows)',
    legalKind && legalKind.field === 'legalHours' && legalKind.reason === 'conditional' && /50/.test(legalKind.text || ''));
  var pF = txish(); pF.labor.legal = { billable: false, citation: 'Hyp. Stat. § 1' };
  var legalForbidden = chargeability.fromConfig(pF, 'TX').filter(function (k) { return k.key === 'legal'; })[0];
  var reviewStill = chargeability.fromConfig(pF, 'TX').filter(function (k) { return k.key === 'review'; })[0];
  ok('E2 a legal-only prohibition forbids the legal box (with its citation) while review stays offered',
    legalForbidden.permitted === false && legalForbidden.citation === 'Hyp. Stat. § 1' && reviewStill.permitted === true);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
