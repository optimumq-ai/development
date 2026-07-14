// Seeds ONE example Formal-Request fee config for the demo jurisdiction (jur-tx) and proves the
// end-to-end path: config persisted in DB -> loaded -> deterministic engine -> itemized result.
// Figures are illustrative (Texas-flavored) and labeled for verification. Idempotent.
require('dotenv').config();
var db = require('../src/db');
var engine = require('../src/services/feeEngine');

var ID = 'feeprof-tx-fr-v1';

// THE 50-PAGE LABOR BAR — Tex. Gov't Code § 552.261(a).
//
//   "If a request is for 50 or fewer pages of paper records, the charge ... may not include costs of
//    materials, labor, or overhead, but shall be limited to the charge for each page of the paper record
//    that is photocopied" -- i.e. the 1 TAC § 70.3 per-page rate ($0.10), which is `duplication.bw.rate`.
//
// The ENGINE has always had this gate (feeEngine.laborGate, whose comment literally names Texas). THE
// CONFIG NEVER SET IT. So every TX estimate charged labor -- a typical 8-page incident report priced at
// $12.05 when the statute allows $0.80. A reader with no config; the mirror of the bugs this project keeps
// finding. Populating the estimate profiles would have AUTOMATED that overcharge across the ten most
// common record types, which is how it was caught.
//
// paperOnly: FALSE — the bar applies to EVERY delivery method (Kevin's call, 2026-07-14, reversing the
// same day's initial paper-only reading). The literal text of § 552.261(a) is paper-shaped ("pages of PAPER
// records ... photocopied"), but scoping the bar to paper would have left the overcharge LIVE on the path
// almost every request actually takes: the portal's default delivery is `email`. A 50-page-or-fewer request
// is the small routine request the legislature was protecting; charging $11.25 of labor on it because we
// emailed the PDF instead of photocopying it inverts the statute's purpose to the city's benefit. Where the
// reading is genuinely uncertain, do not resolve the doubt in favour of the government's own revenue.
//
// ⚠ ONE THING DELIBERATELY NOT ENCODED: THE STATUTE'S TWO EXCEPTIONS -- records in two or more unconnected
// buildings, or in a remote storage facility, restore the labor charge. Left off deliberately: under-charging
// is recoverable, unlawful over-charging is not. Asserting the condition per request is a design question.
//
// NOT SET: `labor.overheadPct`. The spec mentions a TX +20% overhead surcharge; that figure is NOT in the
// verified-TX section of FEE_ESTIMATE_KNOWLEDGE.md, and inventing an overhead % would over-charge. Unseeded
// until researched -- an unresearched charge is the same exposure as an unresearched clock rule.
var LABOR_BAR = {
  mode: 'all_or_nothing', trigger: 'pages', threshold: 50,
  paperOnly: false,
  _statute: "Tex. Gov't Code § 552.261(a)",
  _verified: 'threshold + bar: VERIFIED against statute text. Scope: applied to ALL delivery methods — the ' +
             'statute reads "paper", but the protective reading governs (Kevin, 2026-07-14). Counsel to confirm.'
};

var cfg = {
  context: 'FR', version: 1,
  labor: {
    search: { rate: 15, increment: 0.25, rounding: 'up', billableWhen: LABOR_BAR },
    review: { rate: 15, increment: 0.25, rounding: 'up', billableWhen: LABOR_BAR },
    programming: { rate: 28.5, increment: 0.25, rounding: 'up', billableWhen: LABOR_BAR }
  },
  duplication: { bw: { rate: 0.10 }, color: { rate: 0.50 }, oversized: { rate: 0.50 }, specialty: { rate: 'actual' } },
  media: { cd: 1.00, dvd: 3.00, usb: 'actual' },
  delivery: { email: 0, pickup: 0, mail: 'actual', handling: 0 },
  // TX PIA cost rules (1 TAC 70.3) authorize NO certification fee - it is not a chargeable category, so the
  // legally-accurate TX rate is 0. (A city that charges to certify specific documents under separate statute
  // would set its own figure here.)
  certification: { rate: 0, unit: 'per_record' },
  requestRules: { freePageAllowance: 0, freeLaborHours: 0, deMinimis: 0, minFee: 0, maxFee: null, deposit: { threshold: 100, percent: 50 }, estimateNotifyThreshold: 40 }
};

(async function () {
  await db.initDb();
  var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await db.run('DELETE FROM fee_profiles WHERE id = ?', [ID]);
  await db.run(
    'INSERT INTO fee_profiles (id, jurisdiction_id, context, version, status, name, config_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [ID, 'jur-tx', 'FR', 1, 'active', 'Texas FR (example - illustrative figures, verify)', JSON.stringify(cfg), 'system', now, now]
  );
  var row = await db.get('SELECT * FROM fee_profiles WHERE id = ?', [ID]);
  console.log('Loaded from DB: ' + row.name + ' [' + row.context + ' v' + row.version + ', ' + row.status + ']');
  var profile = JSON.parse(row.config_json);

  // sample multi-component request to show the itemized result end-to-end
  var req = { components: [
    { label: 'Incident report', recordType: 'police_incident', quantities: { searchHours: 0.6, bwPages: 12 } },
    { label: 'Permit + blueprints', recordType: 'building_permit', quantities: { searchHours: 1, bwPages: 3, oversizedPages: 20, media: [{ type: 'usb', count: 1 }] } }
  ], delivery: { method: 'email' } };

  var ctx = engine.compute(profile, req);
  console.log('\n--- ITEMIZED feeContext (estimate mode) ---');
  ctx.components.forEach(function (c) {
    console.log('  [' + c.label + ']  component gross $' + c.componentGross.toFixed(2));
    c.lineItems.forEach(function (li) { console.log('      ' + li.description + ': ' + li.quantity + ' ' + li.unit + ' @ ' + li.rate + ' = $' + Number(li.amount).toFixed(2) + (li.needsActual ? '  (actual cost TBD)' : '')); });
  });
  var R = ctx.requestLevel;
  console.log('  Request-level:');
  console.log('    gross subtotal     $' + R.grossSubtotal.toFixed(2));
  console.log('    labor              $' + R.laborSubtotal.toFixed(2) + '   duplication $' + R.duplicationSubtotal.toFixed(2) + '   media $' + R.mediaSubtotal.toFixed(2));
  console.log('    adjusted subtotal  $' + R.adjustedSubtotal.toFixed(2));
  console.log('    TOTAL              $' + R.total.toFixed(2));
  console.log('    deposit due        $' + R.depositDue.toFixed(2) + (R.depositBasis ? '  (' + R.depositBasis + ')' : ''));
  console.log('    notify requestor?  ' + R.estimateNotifyTriggered);
  process.exit(0);
})().catch(function (e) { console.error('ERROR', e); process.exit(1); });
