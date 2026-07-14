'use strict';
// Seed the fee-waiver policy for the seven researched jurisdictions (SPEC_parent_child_lifecycle.md §12).
// All seeded enabled:false — DRAFTS pending city review + attestation, like every other policy.
//
// EXCEPT the guardrail. `fee_forfeiture_on_late_response` (IL) is armed by the flag alone, without waiting
// for `enabled` or attestation — see services/feeForfeiture.js for why the fail-safe is deliberately
// inverted there. It is false for every jurisdiction except IL, so this changes nothing for TX (the active
// one) or anyone else.
//
// Run: cd /opt/optimumq/backend && node src/db/seed_fee_waiver_policies.js
require('dotenv').config();
var db = require('../db');
var effectiveConfig = require('../services/effectiveConfig');

function prov(fields, source, citation, confidence) {
  var p = {};
  fields.forEach(function (f) { p[f] = { source: source, citation: citation, confidence: confidence }; });
  return p;
}

var J = [
  {
    id: 'jur-tx', code: 'TX',
    // § 552.267(a): "shall provide a copy ... without charge ... if the governmental body DETERMINES that
    // waiver ... is in the public interest because providing the copy primarily benefits the general
    // public." The "shall" is illusory — it triggers only on the body's own determination, with no standard,
    // no burden and no review. Functionally discretionary. NO indigency waiver. NO news-media waiver.
    policy: {
      enabled: false,
      grounds: ['public_interest', 'cost_exceeds_collection'],
      binding: 'discretionary',
      requestor_must_state_purpose: false,
      denial_requires_written_reasons: true,   // policy, not law — TX is SILENT
      deemed_granted_on_silence: false,
      // ⚠️ THE TEXAS TRIGGER. The window does NOT hang off the waiver denial — it hangs off the money
      // documents: the itemized estimate (§ 552.2615(b)) and the deposit demand (§ 552.263(f)).
      response_window_days: 10,
      response_window_unit: 'business',
      response_window_trigger: 'cost_estimate_sent',
      response_window_expiry: 'deemed_withdrawn',
      tolls_on_waiver_request: false,
      tolls_on_waiver_appeal: false,
      restarts_on_deposit_receipt: true,       // § 552.263(e) — a RESTART, not a toll
      appeal_forum: 'ag_overcharge',
      appeal_window_days: 10,
      appeal_window_unit: 'business',
      appeal_can_order_waiver: false,          // the AG reviews the AMOUNT, not the § 552.267 call
      appeal_reaches_fee_amount: true,
      estimate_required_above: 40,
      deposit_allowed_above: 100,
      deposit_cap_pct: null,
      fee_forfeiture_on_late_response: false,
      extension_grounds_closed_list: false
    },
    src: 'statute', cite: "Tex. Gov't Code § 552.267 (waiver); § 552.2615(b) + § 552.263(f) (10 business days, deemed withdrawn); § 552.263(e) (deposit = re-receipt); § 552.269 (AG overcharge complaint)", conf: 0.85
  },
  {
    id: 'jur-il', code: 'IL',
    // ⚠️ THE FEE-FORFEITURE TRAP. 5 ILCS 140/3(d): a body that answers late "may not impose a fee for such
    // copies." Deciding a waiver is NOT one of the seven § 3(e) extension grounds, so a waiver-pending hold
    // state eats the 5-business-day clock and destroys the fee on day 6.
    policy: {
      enabled: false,
      grounds: ['public_interest'],
      binding: 'discretionary',                // 140/6(c): "as determined by the public body"
      requestor_must_state_purpose: true,      // 140/6(c) requires the specific purpose
      denial_requires_written_reasons: true,   // policy — § 9(a)'s duty is keyed to EXEMPTION denials
      deemed_granted_on_silence: false,        // 140/3(d): silence is a DENIAL
      response_window_days: null,              // SILENT — IL has no pay-or-abandon clock
      response_window_unit: 'business',
      response_window_trigger: 'none',
      response_window_expiry: 'none',
      tolls_on_waiver_request: false,          // NON-OVERRIDABLE — this is what forfeits the fee
      tolls_on_waiver_appeal: false,
      restarts_on_deposit_receipt: false,
      appeal_forum: 'pac',
      appeal_window_days: 60,
      appeal_window_unit: 'calendar',
      appeal_can_order_waiver: false,          // 2017 PAC 47258 — the PAC has NO authority to direct a waiver
      appeal_reaches_fee_amount: true,         // 140/6(d), but only as to (a)/(b) — NOT (c)
      estimate_required_above: null,
      deposit_allowed_above: null,
      deposit_cap_pct: null,
      fee_forfeiture_on_late_response: true,   // ← THE GUARDRAIL
      extension_grounds_closed_list: true      // § 3(e)'s seven grounds are exhaustive
    },
    src: 'statute', cite: '5 ILCS 140/6(c) (waiver, discretionary); 140/3(d) (late response = NO FEE for the copies); 140/3(e) (seven exhaustive extension grounds); 140/9.5(a) (PAC, 60 days); 2017 PAC 47258 (PAC cannot order a waiver)', conf: 0.85
  },
  {
    id: 'jur-ct', code: 'CT',
    // The ONLY mandatory waiver in the researched set — though (d)(3) writes discretion back into the "shall".
    policy: {
      enabled: false,
      grounds: ['indigency', 'exempt_records', 'public_interest', 'elected_official', 'public_defender'],
      binding: 'mandatory',
      requestor_must_state_purpose: false,
      denial_requires_written_reasons: true,
      deemed_granted_on_silence: false,        // § 1-206(a): silence = deemed DENIAL
      response_window_days: null,
      response_window_unit: 'business',
      response_window_trigger: 'none',
      response_window_expiry: 'none',
      tolls_on_waiver_request: false,
      tolls_on_waiver_appeal: false,
      restarts_on_deposit_receipt: false,
      appeal_forum: 'foic',
      appeal_window_days: 30,
      appeal_window_unit: 'calendar',
      appeal_can_order_waiver: true,           // the only forum in the set that can
      appeal_reaches_fee_amount: true,
      estimate_required_above: null,
      deposit_allowed_above: 10,               // § 1-212(c): prepayment only if the fee is $10 or more
      deposit_cap_pct: null,
      fee_forfeiture_on_late_response: false,
      extension_grounds_closed_list: false
    },
    src: 'statute', cite: 'Conn. Gen. Stat. § 1-212(d) (mandatory waiver, 5 grounds); § 1-212(c) ($10 prepayment threshold); § 1-206(b)(1) (FOIC, 30 days); FIC2012-324', conf: 0.8
  },
  {
    id: 'jur-wa', code: 'WA',
    // RCW 42.56.120(4): an agency "may waive any charge ... PURSUANT TO AGENCY RULES AND REGULATIONS."
    // The waiver is delegated to agency policy, not granted by statute. The famous 30 days is a MODEL RULE.
    policy: {
      enabled: false,
      grounds: ['agency_discretion'],
      binding: 'discretionary',
      requestor_must_state_purpose: false,
      denial_requires_written_reasons: true,
      deemed_granted_on_silence: false,
      response_window_days: 30,
      response_window_unit: 'calendar',
      response_window_trigger: 'none',
      response_window_expiry: 'close_request',
      tolls_on_waiver_request: false,
      tolls_on_waiver_appeal: false,
      restarts_on_deposit_receipt: false,
      appeal_forum: 'court_only',
      appeal_window_days: 365,
      appeal_window_unit: 'calendar',
      appeal_can_order_waiver: false,
      appeal_reaches_fee_amount: true,         // RCW 42.56.550(2) expressly reaches the CHARGES
      estimate_required_above: null,
      deposit_allowed_above: null,
      deposit_cap_pct: 10,                     // RCW 42.56.120(4)
      fee_forfeiture_on_late_response: false,
      extension_grounds_closed_list: false
    },
    // ⚠️ agency_policy, NOT statute. WA may NOT tell a requestor "the law gives you 30 days."
    src: 'agency_policy', cite: 'RCW 42.56.120(4) (waiver per agency rules; 10% deposit cap); WAC 44-14-04004 (30-day close/refile — MODEL RULE, not statute); RCW 42.56.550(2) (court review of charges, 1 yr). WA AG model-rules rewrite in flight — re-check.', conf: 0.6
  },
  {
    id: 'jur-ny', code: 'NY',
    // No STATUTORY waiver (POL § 87 is silent; Whitehead v. Morgenthau). But 21 NYCRR 1401.8 grants a
    // permissive one: "An agency may waive a fee in whole or in part." No criteria, no entitlement.
    policy: {
      enabled: false,
      grounds: ['agency_discretion'],
      binding: 'discretionary',
      requestor_must_state_purpose: false,
      denial_requires_written_reasons: true,
      deemed_granted_on_silence: false,        // § 89(4)(a): failure to conform = a DENIAL
      response_window_days: null,              // SILENT — no requestor payment deadline in law
      response_window_unit: 'calendar',
      response_window_trigger: 'none',
      response_window_expiry: 'none',
      tolls_on_waiver_request: false,
      tolls_on_waiver_appeal: false,
      restarts_on_deposit_receipt: false,
      appeal_forum: 'internal',                // § 89(4)(a): 30 days to the agency head, then Article 78
      appeal_window_days: 30,
      appeal_window_unit: 'calendar',
      appeal_can_order_waiver: false,
      appeal_reaches_fee_amount: false,
      estimate_required_above: null,
      deposit_allowed_above: null,
      deposit_cap_pct: null,
      fee_forfeiture_on_late_response: false,
      extension_grounds_closed_list: false
    },
    // ⚠️ REGULATION, not statute.
    src: 'regulation', cite: '21 NYCRR 1401.8 ("An agency may waive a fee in whole or in part"); N.Y. Pub. Off. Law § 87(1)(b)(iii) ($0.25/page cap), § 87(1)(c) (staff time only above 2 hours); § 89(4)(a) (30-day appeal). No statutory waiver — Whitehead v. Morgenthau.', conf: 0.7
  },
  {
    id: 'jur-ca', code: 'CA',
    // The CPRA has NO waiver of any kind. § 7922.530(a) caps fees at "direct costs of duplication";
    // § 7921.300 bars purpose-based distinctions between requesters.
    policy: {
      enabled: false,
      grounds: [],
      binding: 'none',
      requestor_must_state_purpose: false,
      denial_requires_written_reasons: true,
      deemed_granted_on_silence: false,
      response_window_days: null,
      response_window_unit: 'calendar',
      response_window_trigger: 'none',
      response_window_expiry: 'none',
      tolls_on_waiver_request: false,
      tolls_on_waiver_appeal: false,
      restarts_on_deposit_receipt: false,
      appeal_forum: 'court_only',
      appeal_window_days: null,
      appeal_window_unit: 'calendar',
      appeal_can_order_waiver: false,
      appeal_reaches_fee_amount: true,
      estimate_required_above: null,
      deposit_allowed_above: null,
      deposit_cap_pct: null,
      fee_forfeiture_on_late_response: false,
      extension_grounds_closed_list: false
    },
    src: 'statute', cite: "Cal. Gov't Code § 7922.530(a) (direct costs of duplication only); § 7921.300 (no purpose-based distinctions). NO waiver provision exists in the CPRA — SILENT.", conf: 0.75
  },
  {
    id: 'jur-fl', code: 'FL',
    // Ch. 119 has no waiver provision. Agencies MAY waive (AGO 90-81), never must. Indigency is expressly
    // no excuse (Roesch v. State). The common "close after 30 days" rule is agency policy, full stop.
    policy: {
      enabled: false,
      grounds: [],
      binding: 'none',
      requestor_must_state_purpose: false,
      denial_requires_written_reasons: true,
      deemed_granted_on_silence: false,
      response_window_days: null,              // SILENT in statute — any window is agency policy
      response_window_unit: 'calendar',
      response_window_trigger: 'none',
      response_window_expiry: 'none',
      tolls_on_waiver_request: false,
      tolls_on_waiver_appeal: false,
      restarts_on_deposit_receipt: false,
      appeal_forum: 'court_only',
      appeal_window_days: null,
      appeal_window_unit: 'calendar',
      appeal_can_order_waiver: false,
      appeal_reaches_fee_amount: false,
      estimate_required_above: null,
      deposit_allowed_above: null,
      deposit_cap_pct: null,
      fee_forfeiture_on_late_response: false,
      extension_grounds_closed_list: false
    },
    src: 'agency_policy', cite: 'Fla. Stat. ch. 119 has NO waiver provision — SILENT. AGO 90-81 (an agency "is not precluded from choosing to provide informational copies ... without charge"). Roesch v. State, 633 So. 2d 1, 3 (Fla. 1993) (indigency no excuse). § 119.11(1) (immediate hearing); § 16.60 (voluntary AG mediation).', conf: 0.7
  }
];

// Jurisdictions not covered by the 17-state clarification survey.
var PROFILES = {
  CT: { name: 'Connecticut', statute: 'Freedom of Information Act', cite: 'Conn. Gen. Stat. § 1-200 et seq.', exemption: 'self_appeal_court' },
  NY: { name: 'New York', statute: 'Freedom of Information Law', cite: 'N.Y. Pub. Off. Law § 84 et seq.', exemption: 'self_appeal_court' }
};

var ALL_FIELDS = require('../services/feeWaiverPolicy').FIELDS.map(function (f) { return f.key; });

(async function () {
  await db.initDb();
  for (var i = 0; i < J.length; i++) {
    var j = J[i];
    var exists = await db.get('SELECT id FROM jurisdiction_profiles WHERE id = ?', [j.id]);
    if (!exists) {
      // CT and NY were not in the 17-state clarification survey, so they have no profile yet.
      var meta = PROFILES[j.code];
      if (!meta) { console.log('  ' + j.code + '  SKIPPED — no jurisdiction profile'); continue; }
      await db.run("INSERT INTO jurisdiction_profiles (id, code, name, statute_name, statute_citation, status, exemption_model) VALUES (?,?,?,?,?,?,?)",
        [j.id, j.code, meta.name, meta.statute, meta.cite, 'library', meta.exemption]);
    }
    var cfg = Object.assign({}, j.policy, { provenance: prov(ALL_FIELDS, j.src, j.cite, j.conf) });
    await effectiveConfig.applyConfig(j.id, 'fee_waiver', cfg, 'legal-research-seed', 'legal-research-seed',
      'Seeded from the 2026-07-14 fee-waiver research — DRAFT (enabled=false), pending city review + attestation.');
    var flags = [];
    if (j.policy.fee_forfeiture_on_late_response) flags.push('FEE-FORFEITURE GUARDRAIL ARMED');
    if (j.policy.appeal_can_order_waiver) flags.push('forum can order a waiver');
    console.log('  ' + j.code.padEnd(3) + ' grounds=' + (j.policy.grounds.length ? j.policy.grounds.join('+') : 'NONE').padEnd(38) +
      ' window=' + String(j.policy.response_window_days || '-').padEnd(4) + ' trigger=' + j.policy.response_window_trigger.padEnd(19) +
      ' src=' + j.src.padEnd(14) + (flags.length ? '  ⚠ ' + flags.join(', ') : ''));
  }
  var n = await db.get("SELECT COUNT(*) AS n FROM jurisdiction_rules WHERE domain = 'fee_waiver'");
  console.log('\n' + n.n + ' fee-waiver policies seeded. All enabled=false (draft).');
  console.log('The pay-or-abandon clock is STATUTORY in only ONE of seven states (TX).');
  console.log('WA = model rule. FL = agency policy. provenance.source is load-bearing.');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
