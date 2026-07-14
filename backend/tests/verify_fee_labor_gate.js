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
  // Overhead is now SEEDED and verified: 1 TAC § 70.3(e)(3) = 20% of the labor charge (research 2026-07-14).
  ok('A3 overhead is 20% of LABOR (§ 70.3(e)(3)) — verified, seeded', Number(cfg.labor.overheadPct) === 20);

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
  // $15 labor + 20% overhead ($3.00) + 51 × $0.10 copies ($5.10) = $23.10. Overhead rides on the labor the
  // moment the bar is crossed -- the same coupling section H proves, seen from the charged side.
  ok('C3 …+ 20% overhead ($3.00) + 51 × $0.10 copies ($5.10) → $23.10 total', Number(p51.total).toFixed(2) === '23.10');

  console.log('\n=== D. THE BAR APPLIES TO EVERY DELIVERY METHOD — INCLUDING EMAIL ===');
  // Kevin, 2026-07-14 (reversing the same day's initial paper-only reading): § 552.261(a) reads "pages of
  // PAPER records ... photocopied", but scoping the bar to paper leaves the overcharge LIVE on the path
  // nearly every request takes -- the portal's default delivery is `email`. A 50-page-or-fewer request is the
  // small routine one the bar exists to protect; charging $11.25 of labor on it because we emailed the PDF
  // rather than photocopying it inverts the statute to the city's benefit. THE EMAIL CASE WAS THE REAL ONE.
  ok('D1 paperOnly is FALSE — the bar is not scoped away from electronic delivery',
    cfg.labor.search.billableWhen.paperOnly === false);
  var pEmail = price(cfg, INCIDENT, 'email');
  ok('D2 the same 8-page report by EMAIL charges ZERO labor', Number(pEmail.laborSubtotal) === 0);
  ok('D3 …and prices at $0.80 — the copies, and nothing else', Number(pEmail.total).toFixed(2) === '0.80');
  ok('D4 every delivery method agrees — the bar does not depend on how we hand it over',
    ['email', 'mail', 'pickup'].every(function (m) { return Number(price(cfg, INCIDENT, m).total).toFixed(2) === '0.80'; }));

  console.log('\n=== G. A PAGE BAR CANNOT BITE ON A REQUEST WITH NO PAGES ===');
  // The trap that flipping paperOnly opened, and the reason this section exists: audio and video requests
  // have ZERO pages. Zero is "50 or fewer". So the bar would zero out labor on the MOST EXPENSIVE records a
  // city holds -- body-worn video redaction runs slower than real time -- and hand them over FREE.
  //
  // § 552.261(a) exempts a request "for 50 or fewer PAGES of paper records". A body-cam request is not a
  // request for pages at all, and Texas prices electronic records under separate rules that DO allow
  // personnel time. So: no pages, no page-bar.
  var bwcQ = { searchHours: 0.5, reviewHours: 4.0, bwPages: 0 };   // the real rt-police-video seed
  var pBwc = price(cfg, bwcQ, 'email');
  ok('G1 a body-worn-camera request (0 pages) still charges labor', Number(pBwc.laborSubtotal) > 0);
  ok('G2 …4.5h × $15 = $67.50 labor, + 20% overhead $13.50 = $81.00 total', Number(pBwc.total).toFixed(2) === '81.00');
  var p911 = price(cfg, { searchHours: 0.25, reviewHours: 1.0, bwPages: 0 }, 'email');
  ok('G3 a 911-audio request (0 pages) likewise charges labor + overhead → $22.50', Number(p911.total).toFixed(2) === '22.50');
  // And the bar still bites the moment there IS paper.
  ok('G4 …but ONE page of paper brings the bar straight back',
    Number(price(cfg, { searchHours: 4, reviewHours: 0, bwPages: 1 }, 'email').laborSubtotal) === 0);

  console.log('\n=== H. OVERHEAD — 20% OF LABOR, AND ONLY WHEN LABOR IS CHARGED (§ 70.3(e)) ===');
  // The whole point of the coupling: § 70.3(e)(2) bars overhead on a ≤50-page request "unless the request
  // also qualifies for a labor charge." Because the engine's overhead rides on the GATED labor subtotal, the
  // page bar zeroes labor AND overhead together -- a 20% surcharge on a copies-only bill is unlawful, and
  // cannot happen here by construction.
  var pOvh = price(cfg, bwcQ, 'email');
  ok('H1 overhead is exactly 20% of the labor charge', Number(pOvh.laborOverhead).toFixed(2) === (Number(pOvh.laborSubtotal) * 0.20).toFixed(2));
  ok('H2 …NOT 20% of the total bill (the base is labor alone, § 70.3(e)(3))',
    Number(pOvh.laborOverhead) < Number(pOvh.total) * 0.20 + 0.001 && Number(pOvh.laborOverhead) === Number(pOvh.laborSubtotal) * 0.20);
  var pBar = price(cfg, INCIDENT, 'mail');
  ok('H3 a ≤50-page request pays ZERO overhead — because it pays zero labor (§ 70.3(e)(2))',
    Number(pBar.laborOverhead || 0) === 0 && Number(pBar.laborSubtotal) === 0);
  var pBig = price(cfg, { searchHours: 2, reviewHours: 2, bwPages: 120 }, 'mail');
  ok('H4 a >50-page request pays overhead on its labor', Number(pBig.laborOverhead) > 0);
  ok('H5 a city may waive overhead — overheadPct:0 removes it entirely (§ 70.3(e)(1) is opt-in)', (function () {
    var waived = JSON.parse(JSON.stringify(cfg)); waived.labor.overheadPct = 0;
    return Number(price(waived, bwcQ, 'email').laborOverhead || 0) === 0;
  })());

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
