'use strict';
// Seed the deposit/payment CLOCK policy. Only TEXAS is seeded with researched values — it is the only
// jurisdiction whose deposit rules were researched to statute (2026-07-13 legal review). The other 17
// jurisdictions are deliberately LEFT AT DEFAULTS (`runs_no_stop` + `flag_only`), which is byte-for-byte
// today's behaviour: the clock keeps running and an overdue deposit only raises a tickler flag. Seeding a
// guess there would be worse than seeding nothing — a wrong clock rule is a legal exposure, not a bug.
//
// TX (all citations Tex. Gov't Code):
//   § 552.263(e) — "a request for a copy of public information is considered to have been received ... on
//                   the date the governmental body receives the deposit or bond."  => toll_and_restart
//                   (a RE-RECEIPT: the clock restarts from the payment date, stronger than a pause)
//   § 552.263(f) — failure to deposit by the 10th business day withdraws the request  => grace 10, withdraw
//   § 552.221(e) — 60-day failure to pay/inspect also withdraws (a longer backstop, not modeled here)
//
// Seeded enabled:false — a DRAFT. Runtime is double-gated (enabled AND the profile section attested), so
// this changes NOTHING until a city switches it on. Idempotent.
//
// Run: cd /opt/optimumq/backend && node src/db/seed_payment_clock_policies.js
require('dotenv').config();
var db = require('../db');
var effectiveConfig = require('../services/effectiveConfig');

var CITE = "Tex. Gov't Code § 552.263(e) (deposit = re-receipt of the request); § 552.263(f) (10 business days, else withdrawn)";

var TX = {
  enabled: false, // DRAFT — the city switches it on after review + attestation.
  deposit_clock_effect: 'toll_and_restart',
  deposit_grace_days: 10,
  deposit_lapse_action: 'withdraw',
  // THE "SEND AGAIN" RULE. § 552.2615(c): if the actual charges will exceed the itemized estimate by more
  // than 20%, the body "shall send to the requestor an updated itemized statement," and the requestor gets a
  // fresh 10-business-day window. § 552.2615(b): a body that does not provide the required statement "may
  // not collect more than $40" — the statement is a PRECONDITION to the money.
  reissue_required_on_variance: true,
  reissue_blocks_collection: true,
  reissue_restarts_response_window: true,
  provenance: {
    deposit_clock_effect: { source: 'statute', citation: CITE, confidence: 0.85 },
    deposit_grace_days: { source: 'statute', citation: "Tex. Gov't Code § 552.263(f)", confidence: 0.85 },
    deposit_lapse_action: { source: 'statute', citation: "Tex. Gov't Code § 552.263(f); § 552.221(e)", confidence: 0.8 },
    reissue_required_on_variance: { source: 'statute', citation: "Tex. Gov't Code § 552.2615(c) (updated itemized statement required when actual charges exceed the estimate by more than 20%)", confidence: 0.85 },
    reissue_blocks_collection: { source: 'statute', citation: "Tex. Gov't Code § 552.2615(b) (no required itemized statement => may not collect more than $40)", confidence: 0.85 },
    reissue_restarts_response_window: { source: 'statute', citation: "Tex. Gov't Code § 552.2615(c) (fresh 10 business days to respond to the updated statement)", confidence: 0.85 }
  }
};

(async function () {
  await db.initDb();
  await effectiveConfig.applyConfig('jur-tx', 'payment', TX, 'legal-research-seed', 'legal-research-seed',
    'Seeded from the 2026-07-13 TX PIA review — DRAFT (enabled=false), pending city review + attestation.');
  console.log('  TX   toll_and_restart   grace=10   lapse=withdraw   conf=0.85   (DRAFT, enabled=false)');
  var n = await db.get("SELECT COUNT(*) AS n FROM jurisdiction_rules WHERE domain = 'payment'");
  console.log('\n' + n.n + ' payment clock policy row(s). The other 17 jurisdictions read DEFAULTS');
  console.log('(runs_no_stop + flag_only) = exactly today\'s behaviour. Deposit rules were not researched');
  console.log('to statute outside TX; a guessed clock rule is a legal exposure, so none is seeded.');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
