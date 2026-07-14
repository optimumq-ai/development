'use strict';
// THE EXPERT SEEDS — Tier 1 #3. The data task that turns the estimate from MANUAL into AUTOMATED.
//
// `estimateProfile.assess()` has been THE decision node all along, and it always returned `manual`, because
// ZERO profiles were ever populated. The engine, the confidence ladder, the dollar bound, the prefill and the
// historical write-back were all built and all unreachable. Ten rows switch them on.
//
// WHY THIS IS TESTED AT ALL, when the build doc calls it "a data task, no code": because a data task with no
// test is exactly the thing that silently regresses. These rows now travel in `seed_fixture.sql`, which is
// REGENERATED FROM LIVE -- so a bad reconcile, a wiped table, or a fixture regenerated against a database
// that never had the seeds would quietly return every record type to manual estimating, and nothing would
// say so. The system would just get slower and no one would know why.
//
// ⚠ PROVENANCE. `seedProfile` stamps source='human-expert'. THE EXPERT WAS NOT A RECORDS CLERK -- these are
// provisional defaults (see scripts/estimateProfiles.seed.js), stamped PROVISIONAL in each profile's notes.
// Test D holds that admission in place: if someone re-seeds these as authoritative without a clerk actually
// confirming the numbers, the note disappears and this goes red.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var ep = require('/opt/optimumq/backend/src/services/estimateProfile');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

// The ten. Police first (the bulk of what a city fields), then the high-volume clerk/permit types.
var SEEDED = [
  'rt-incident-reports', 'rt-crash-reports', 'rt-arrest-booking', 'rt-citations', 'rt-cad-logs',
  'rt-911-recordings', 'rt-police-video', 'rt-building-permits', 'rt-council-minutes', 'rt-official-email'
];

(async function () {
  await db.initDb();

  console.log('\n=== A. THE SEEDS EXIST, AND THEY ARE EXPERT SEEDS ===');
  var rows = await db.all('SELECT * FROM record_type_estimate_profiles ORDER BY record_type_id');
  ok('A1 all ten record types carry a profile', SEEDED.every(function (id) {
    return rows.some(function (r) { return r.record_type_id === id; });
  }));
  ok('A2 every seed is flagged as an expert seed (not stray historical actuals)',
    rows.length > 0 && rows.every(function (r) { return Number(r.has_expert_seed) === 1; }));
  ok('A3 every seeded record type really exists in the catalog', await (async function () {
    for (var id of SEEDED) { if (!await db.get('SELECT id FROM record_types WHERE id = ?', [id])) return false; }
    return true;
  })());

  console.log('\n=== B. THEY FLIP assess() FROM MANUAL TO AUTOMATED ===');
  // This is the whole point of the task. Before the seeds, every one of these returned `manual`.
  var results = {};
  for (var id of SEEDED) results[id] = await ep.assess(id);
  ok('B1 all ten now assess as AUTOMATED', SEEDED.every(function (id) { return results[id].decision === 'automated'; }));
  ok('B2 …on the strength of the human-expert seed', SEEDED.every(function (id) { return results[id].basis === 'human-expert seed'; }));
  ok('B3 …each with a real priced total', SEEDED.every(function (id) { return Number(results[id].estimatedTotal) > 0; }));

  // A record type with NO profile must still return manual — the seeds must not have flipped some global.
  var unseeded = await db.get(
    'SELECT id FROM record_types WHERE id NOT IN (' + SEEDED.map(function () { return '?'; }).join(',') + ') LIMIT 1', SEEDED);
  var un = await ep.assess(unseeded.id);
  ok('B4 an UNSEEDED record type is still manual (nothing was flipped globally)', un.decision === 'manual');
  ok('B5 …and says why', /No estimation profile|No expert seed/.test((un.reasons || []).join(' ')));

  console.log('\n=== C. THE QUANTITIES ARE SANE, AND THEY ARE QUANTITIES — NOT DOLLARS ===');
  var incident = rows.filter(function (r) { return r.record_type_id === 'rt-incident-reports'; })[0];
  var q = JSON.parse(incident.quantities_json || '{}');
  ok('C1 the incident-report seed stores QUANTITIES (§7e), never a dollar figure',
    q.bwPages > 0 && q.searchHours > 0 && !('total' in q) && !('amount' in q) && !('dollars' in q));

  // Council minutes are ALREADY PUBLIC. Seeding review hours against them would bill a citizen for redacting
  // a record that has nothing to redact — the kind of quiet, plausible overcharge nobody audits.
  var minutes = JSON.parse(rows.filter(function (r) { return r.record_type_id === 'rt-council-minutes'; })[0].quantities_json);
  ok('C2 council minutes carry ZERO review hours — already-public material has nothing to redact',
    !Number(minutes.reviewHours));

  // Body-worn camera is review-dominated: video redaction runs slower than real time.
  var bwc = JSON.parse(rows.filter(function (r) { return r.record_type_id === 'rt-police-video'; })[0].quantities_json);
  ok('C3 body-worn camera is REVIEW-dominated (redaction, not lookup, is the cost)',
    Number(bwc.reviewHours) > Number(bwc.searchHours));

  console.log('\n=== D. THE PROVENANCE ADMISSION IS ON THE RECORD ===');
  ok('D1 every seed is stamped PROVISIONAL — not confirmed by a records clerk',
    rows.filter(function (r) { return SEEDED.indexOf(r.record_type_id) >= 0; })
        .every(function (r) { return /PROVISIONAL/i.test(r.notes || ''); }));

  console.log('\n=== E. THE $200 HUMAN-REVIEW BOUND STILL BITES ===');
  // A confident profile is NOT a blank cheque: assess() routes anything over $200 to a human regardless.
  // Proven by pushing a seeded type past the bound rather than trusting the policy constant.
  await ep.seedProfile('rt-council-minutes', { searchHours: 40, reviewHours: 40, bwPages: 2000 }, 'test');
  var big = await ep.assess('rt-council-minutes');
  ok('E1 a seeded type priced over $' + ep.POLICY.highDollar + ' is routed back to a human', big.decision === 'manual');
  ok('E2 …and says the dollar bound is why', /exceeds the \$/.test((big.reasons || []).join(' ')));
  ok('E3 …while still reporting the number it computed', Number(big.estimatedTotal) > ep.POLICY.highDollar);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
