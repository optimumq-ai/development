'use strict';
// PER-COMPONENT CHARGED AMOUNT — generalized prorata (SPEC_parent_child_lifecycle.md §5.10.2).
//
// WHAT THIS EXISTS FOR. `componentGross` is a naive per-record sum that is NEVER what gets charged: the engine
// prices components with no rounding, gates, allowances or tiers, then discards that and re-prices everything
// from request-level aggregates. So `Σ componentGross ≠ total`, and until now there was NO per-record price
// anywhere in the system — which is exactly what the §5.9 per-child release gate needs to answer "may this
// finished record ship?", and what revenue-by-department and ERP line items were both blocked on.
//
// THE PROPERTY THAT MATTERS MOST is D: ORDER-INDEPENDENCE. The rule this replaced ("the ceiling is a running
// cap on cumulative billing") charged a record $60 if it shipped first and $40 if it shipped last — the price
// depended on processing order, an operational accident. If D ever fails, this rule has regressed into that
// one, and the release gate becomes non-deterministic.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var engine = require('/opt/optimumq/backend/src/services/feeEngine');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sum(cs) { return Math.round(cs.reduce(function (a, c) { return a + c.componentCharged; }, 0) * 100) / 100; }

// A deliberately plain profile: one priced axis (B&W pages at $1) so componentGross is trivially predictable
// and the request-level rules under test are the only thing moving the total.
function profile(rules) {
  return { context: 'FR', version: 1, duplication: { bw: { rate: 1 } }, labor: {}, media: {}, av: {},
           delivery: {}, certification: {}, requestRules: rules || {} };
}
function comps(pages) {
  return pages.map(function (p, i) { return { id: 'c' + (i + 1), label: 'Record ' + (i + 1), quantities: { bwPages: p } }; });
}

(function () {
  console.log('\n=== A. KEVIN\'S SCENARIO — the one that killed the running-cap rule ===');
  // 10 records at $6 + one at $60 = $120 gross; maxFee $100. Under the retired rule the expensive record was
  // charged $60 or $40 depending on when it shipped. Under prorata it is $50 whenever it ships.
  var A = engine.compute(profile({ maxFee: 100 }), { components: comps([6,6,6,6,6,6,6,6,6,6,60]) });
  ok('A1 grossSubtotal is the naive sum ($120)', A.requestLevel.grossSubtotal === 120);
  ok('A2 total is capped at $100', A.requestLevel.total === 100);
  ok('A3 the $60 record is charged $50 (60 × 100/120)', A.components[10].componentCharged === 50);
  ok('A4 each $6 record is charged $5', A.components[0].componentCharged === 5);
  ok('A5 the charges sum EXACTLY to the total', sum(A.components) === 100);
  ok('A6 allocation basis reported as prorata', A.allocation && A.allocation.basis === 'prorata');

  console.log('\n=== B. NO REQUEST-LEVEL EFFECT — charged must equal gross ===');
  var B = engine.compute(profile({}), { components: comps([10, 20, 30]) });
  ok('B1 total equals grossSubtotal when no rule fires', B.requestLevel.total === B.requestLevel.grossSubtotal);
  ok('B2 every componentCharged equals its componentGross',
    B.components.every(function (c) { return c.componentCharged === c.componentGross; }));

  console.log('\n=== C. IT WORKS UPWARD TOO — a floor is a surcharge, not a saving ===');
  // The half of the problem a per-vehicle rulebook gets wrong: sometimes the delta is POSITIVE.
  var C = engine.compute(profile({ minFee: 60 }), { components: comps([10, 20]) });
  ok('C1 the floor lifted the total to $60 from a $30 gross', C.requestLevel.total === 60);
  ok('C2 components scale UP proportionally ($20 / $40)',
    C.components[0].componentCharged === 20 && C.components[1].componentCharged === 40);
  ok('C3 the charges still sum exactly to the total', sum(C.components) === 60);

  console.log('\n=== D. ⚠️ ORDER-INDEPENDENCE — the property the old rule lacked ===');
  var fwd = engine.compute(profile({ maxFee: 100 }), { components: comps([6, 60, 6]) });
  var rev = engine.compute(profile({ maxFee: 100 }), { components: comps([6, 6, 60]) });
  var big = function (r) { return r.components.filter(function (c) { return c.componentGross === 60; })[0].componentCharged; };
  ok('D1 the expensive record is charged the same regardless of its position (' + big(fwd) + ')', big(fwd) === big(rev));
  ok('D2 …and the same regardless of which component absorbs the rounding residual', sum(fwd.components) === sum(rev.components));

  console.log('\n=== E. PENNY RECONCILIATION — an off-by-a-cent shortfall would withhold a record ===');
  // 3 equal components against a cap that does not divide evenly: 100/3 = 33.333…
  var E = engine.compute(profile({ maxFee: 100 }), { components: comps([50, 50, 50]) });
  ok('E1 charges sum EXACTLY to the total with an indivisible split', sum(E.components) === 100);
  ok('E2 no component is NaN or undefined',
    E.components.every(function (c) { return typeof c.componentCharged === 'number' && isFinite(c.componentCharged); }));

  console.log('\n=== F. ZERO-GROSS GUARD — de-minimis waive and unpriced requests ===');
  var F = engine.compute(profile({ deMinimis: 500 }), { components: comps([10, 20]) });
  ok('F1 de-minimis waived the request to $0', F.requestLevel.total === 0 && F.requestLevel.deMinimisWaived === true);
  ok('F2 every component is charged 0 (not NaN)',
    F.components.every(function (c) { return c.componentCharged === 0; }));

  var G = engine.compute(profile({}), { components: comps([0, 0]) });
  ok('F3 a zero-gross request does not divide by zero', G.components.every(function (c) { return c.componentCharged === 0; }));
  ok('F4 …and reports the basis as nothing_priced', G.allocation.basis === 'nothing_priced');

  console.log('\n=== G. UNPRICED ACTUALS ARE FLAGGED, NOT SILENTLY FREE ===');
  // A component priced at `rate: 'actual'` contributes 0 to gross and would allocate to 0 — reading as free
  // while potentially being the most expensive record. `mail` delivery is 'actual' in the live TX profile.
  var actualProf = { context: 'FR', version: 1, duplication: { bw: { rate: 'actual' } }, labor: {}, media: {},
                     av: {}, delivery: {}, certification: {}, requestRules: {} };
  var H = engine.compute(actualProf, { components: comps([25]) });
  ok('G1 a component with an unpriced actual is flagged', H.components[0].hasUnpricedActuals === true);
  ok('G2 a fully-priced component is not flagged', B.components[0].hasUnpricedActuals === false);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
