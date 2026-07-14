'use strict';
// THE 50-PAGE LABOR BAR — Tex. Gov't Code § 552.261(a).
//
//   "If a request is for 50 or fewer pages of paper records, the charge for providing the copy of the
//    public information may not include costs of materials, labor, or overhead, but shall be limited to
//    the charge for each page of the paper record that is photocopied."
//
// WHAT THIS HARNESS EXISTS TO PREVENT — and it is not hypothetical; it was LIVE until 2026-07-14:
//
//   The engine has ALWAYS had this gate. `feeEngine.laborGate`'s own comment names Texas by name. But NO
//   SEEDED CONFIG EVER SET IT -- `billableWhen` appeared in zero fee profiles. So the mechanism sat there,
//   correct and unreachable, while every Texas estimate charged labor: a typical 8-page incident report
//   priced at $12.05 where the statute allows $0.80. A reader with no config -- the exact mirror of the
//   "seeded but never read" bugs this project keeps finding, and just as silent.
//
//   It surfaced only because populating the record-type estimate profiles (Tier 1 #3) would have turned
//   that overcharge from a thing a clerk might catch into an AUTOMATED one, emitted at scale under a
//   "Review auto-generated estimate" label that implies somebody validated it.
//
// So: the config is now the thing under test. A future edit that drops `billableWhen` -- a reseed from an
// old script, a hand-tuned profile, a copied config for a new city -- must go RED here, not ship.
//
// ⚠ THE paperOnly SCOPE IS UNVERIFIED (Kevin's call 2026-07-14). § 552.261(a) says "pages of PAPER records"
// and "photocopied", so the bar is configured to apply only to paper deliveries. It is LOAD-BEARING: the
// demo's default delivery is `email`, so the bar does NOT fire on most requests today. Test D pins that
// behavior EXACTLY SO IT IS VISIBLE -- if counsel reads the statute as reaching electronic copies, D is the
// test that must be changed, deliberately, by a human who has read this paragraph.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var engine = require('/opt/optimumq/backend/src/services/feeEngine');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

// One typical 8-page incident report — THE case the bug fired on, and the most common request a city gets.
var INCIDENT = { searchHours: 0.25, reviewHours: 0.5, bwPages: 8 };

function price(cfg, quantities, deliveryMethod) {
  return engine.compute(cfg, {
    components: [{ id: 'c1', recordType: 'rt-test', quantities: quantities }],
    delivery: { method: deliveryMethod }
  }).requestLevel;
}

(async function () {
  await db.initDb();

  var row = await db.get("SELECT config_json FROM fee_profiles WHERE jurisdiction_id = 'jur-tx' AND context = 'FR' AND status = 'active'");
  ok('A1 the active TX fee profile exists', !!row);
  var cfg = JSON.parse(row.config_json);

  console.log('\n=== A. THE CONFIG ITSELF — the thing that was missing ===');
  ['search', 'review', 'programming'].forEach(function (k) {
    var bw = cfg.labor && cfg.labor[k] && cfg.labor[k].billableWhen;
    ok('A2 labor.' + k + ' declares the 50-page bar (§ 552.261(a))',
      !!bw && bw.mode === 'all_or_nothing' && bw.trigger === 'pages' && Number(bw.threshold) === 50);
  });
  ok('A3 no overhead % is invented — unseeded until researched',
    !cfg.labor || !cfg.labor.overheadPct);

  console.log('\n=== B. PAPER, AT OR UNDER 50 PAGES → COPIES ONLY. NO LABOR. ===');
  var p8 = price(cfg, INCIDENT, 'mail');
  ok('B1 an 8-page incident report on paper charges ZERO labor', Number(p8.laborSubtotal) === 0);
  ok('B2 …and is limited to the per-page charge: 8 × $0.10 = $0.80', Number(p8.total).toFixed(2) === '0.80');
  ok('B3 …no overhead rides along either', !p8.laborOverhead || Number(p8.laborOverhead) === 0);
  // The regression, stated as money: this is what the request cost yesterday.
  ok('B4 THE BUG: it is NOT the $12.05 the unconfigured engine charged', Number(p8.total) !== 12.05);

  var p50 = price(cfg, { searchHours: 3, reviewHours: 3, bwPages: 50 }, 'mail');
  ok('B5 EXACTLY 50 pages is still barred — the statute says "50 or fewer"', Number(p50.laborSubtotal) === 0);
  ok('B6 …and 50 pages costs exactly $5.00', Number(p50.total).toFixed(2) === '5.00');

  console.log('\n=== C. OVER 50 PAGES → LABOR IS CHARGEABLE ===');
  var p51 = price(cfg, { searchHours: 1, reviewHours: 0, bwPages: 51 }, 'mail');
  ok('C1 51 pages crosses the bar and labor is charged', Number(p51.laborSubtotal) > 0);
  ok('C2 …at the configured $15/hr → $15.00 labor', Number(p51.laborSubtotal).toFixed(2) === '15.00');
  ok('C3 …plus 51 × $0.10 in copies → $20.10 total', Number(p51.total).toFixed(2) === '20.10');

  console.log('\n=== D. THE paperOnly SCOPE — UNVERIFIED, AND PINNED SO IT IS VISIBLE ===');
  // Kevin's reading, 2026-07-14: § 552.261(a) is scoped to "pages of PAPER records ... photocopied", so an
  // electronic delivery falls outside the bar. This is the load-bearing consequence, in money:
  var pEmail = price(cfg, INCIDENT, 'email');
  ok('D1 the SAME 8-page report by EMAIL is outside the bar — labor IS charged', Number(pEmail.laborSubtotal) > 0);
  ok('D2 …so it prices at $12.05, not $0.80 — the demo default is email, so this is MOST requests',
    Number(pEmail.total).toFixed(2) === '12.05');
  ok('D3 pickup counts as paper — barred', Number(price(cfg, INCIDENT, 'pickup').laborSubtotal) === 0);
  ok('D4 mail counts as paper — barred', Number(price(cfg, INCIDENT, 'mail').laborSubtotal) === 0);

  console.log('\n=== E. THE GATE IS ADDITIVE — a config without it is unchanged ===');
  // Every other jurisdiction's profile has no billableWhen. Those must keep charging labor normally: a gate
  // that silently applied everywhere would UNDER-charge cities whose statutes allow the labor.
  var bare = JSON.parse(JSON.stringify(cfg));
  ['search', 'review', 'programming'].forEach(function (k) { delete bare.labor[k].billableWhen; });
  ok('E1 with no billableWhen, an 8-page paper request charges labor normally',
    Number(price(bare, INCIDENT, 'mail').laborSubtotal) > 0);

  console.log('\n=== F. THE EXCEPTIONS ARE DELIBERATELY UNCONFIGURED ===');
  // § 552.261(a) restores the labor charge when the records sit in 2+ unconnected buildings or in remote
  // storage. Encoding that needs a way for the city to ASSERT the condition per request, which is a design
  // question, not a data one. Under-charging is recoverable; unlawful over-charging is not.
  // Guarded: if the bar has been dropped entirely (the original bug), this must read as a clean FAIL on the
  // assertions above — not a TypeError that masks them.
  var bwCfg = (cfg.labor && cfg.labor.search && cfg.labor.search.billableWhen) || {};
  ok('F1 no building/remote-storage exception is encoded (flagged, not guessed)',
    !bwCfg.exceptions && !bwCfg.remoteStorage && !bwCfg.separateBuildings);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
