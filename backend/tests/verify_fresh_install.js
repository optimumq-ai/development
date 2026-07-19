'use strict';
// FRESH-INSTALL FIDELITY — does `schema.postgres.sql` alone produce a correctly configured system?
//
// WHY THIS EXISTS. The test database is rebuilt FROM EMPTY using only `schema.postgres.sql` + the fixture
// (`reset_test_db.js`), which makes this suite the only place a fresh city install is ever exercised. Nobody
// looking at the running live system can see these defects, because live has been hand-patched over months.
//
// This class has now bitten THREE times:
//   * 2026-07-14 (xr) — a fresh install was missing the onboarding review/test tracking columns entirely.
//   * 2026-07-19 — `schema.postgres.sql` seeded SIX onboarding phases with NO `fees` row, while live had
//     seven. A new city came up with no Fees & Estimates phase, and therefore no fee sandbox gate — the
//     strongest configuration gate in the product.
//   * 2026-07-19 — `requires_review` was added with DEFAULT false and NOTHING in the codebase ever wrote it.
//     Live carried it as true on three phases because a human set it by hand. A fresh install came up with
//     ZERO gated phases: every phase completable by any authenticated user via a plain PATCH, no designated
//     reviewer, no approval. The exact opposite of the intended posture.
//
// The rule this harness enforces: **the live database is not the specification.** Anything a city needs on
// day one must come from the schema, not from someone remembering to run an UPDATE.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

// The onboarding wizard a brand-new city must receive. Gated phases are the ones carrying legal weight the
// city must own: statutory deadlines + exemption basis (jurisdiction), what a citizen is lawfully charged
// (fees), and what is withheld (redaction).
var EXPECTED = [
  { key: 'jurisdiction', order: 0, gated: true },
  { key: 'departments', order: 1, gated: false },
  { key: 'teams', order: 2, gated: false },
  { key: 'ownership', order: 3, gated: false },
  { key: 'repositories', order: 4, gated: false },
  { key: 'fees', order: 5, gated: true },
  { key: 'redaction', order: 6, gated: true }
];

(async function () {
  await db.initDb();

  console.log('\n=== A. THE ONBOARDING WIZARD IS FULLY SEEDED BY THE SCHEMA ===');
  var rows = await db.all('SELECT phase_key, phase_order, title, requires_review FROM onboarding_progress ORDER BY phase_order');
  ok('A1 the schema alone seeds all ' + EXPECTED.length + ' onboarding phases (got ' + rows.length + ')',
    rows.length === EXPECTED.length);

  for (var i = 0; i < EXPECTED.length; i++) {
    var e = EXPECTED[i];
    var got = rows.filter(function (r) { return r.phase_key === e.key; })[0];
    ok('A2.' + i + ' phase "' + e.key + '" exists at order ' + e.order,
      !!got && Number(got.phase_order) === e.order);
    // The gate is the whole point — a phase that should require review but does not is silently completable
    // by anyone, which is worse than the phase being absent because it LOOKS configured.
    ok('A3.' + i + ' phase "' + e.key + '" requires_review = ' + e.gated,
      !!got && !!got.requires_review === e.gated);
  }

  var orders = rows.map(function (r) { return Number(r.phase_order); });
  ok('A4 phase_order values are unique (no two phases claim the same slot)',
    new Set(orders).size === orders.length);
  ok('A5 every seeded phase carries a title', rows.every(function (r) { return !!(r.title || '').trim(); }));

  console.log('\n=== B. AT LEAST ONE PHASE IS GATED — the posture, not the specific list ===');
  var gated = rows.filter(function (r) { return !!r.requires_review; });
  ok('B1 a fresh install has gated phases (found ' + gated.length + ')', gated.length > 0);
  ok('B2 the FEES phase is present and gated — it carries the version-bound sandbox gate',
    gated.some(function (r) { return r.phase_key === 'fees'; }));

  console.log('\n=== C. THE FRONTEND CAN RENDER EVERY SEEDED PHASE ===');
  // A phase seeded in the DB with no PHASE_META entry renders with no guide text and no deep link — a dead
  // row in the wizard. This catches the schema and the UI drifting apart in either direction.
  var fs = require('fs');
  var setup = fs.readFileSync('/opt/optimumq/frontend/src/pages/SetupPage.js', 'utf8');
  var meta = setup.slice(setup.indexOf('const PHASE_META'), setup.indexOf('};', setup.indexOf('const PHASE_META')));
  for (var j = 0; j < rows.length; j++) {
    var k = rows[j].phase_key;
    ok('C1.' + j + ' SetupPage PHASE_META has an entry for "' + k + '" (guide + deep link)',
      new RegExp('(^|[^A-Za-z_])' + k + '\\s*:').test(meta));
  }

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
