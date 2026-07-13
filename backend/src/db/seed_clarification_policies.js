'use strict';
// Seed the 17 surveyed jurisdictions from docs/CLARIFICATION_POLICY_SURVEY.md §4.1 into the per-jurisdiction
// rule store (jurisdiction_rules, domain 'clarification'), plus Texas from the 2026-07-13 legal research.
//
// WHY THIS EXISTS: the survey has been markdown since 2026-07-09 — 17 jurisdictions' worth of researched
// clock rules that no machine could read, because until jurisdiction_rules landed there was nowhere to put
// them (clarificationPolicy.read(jid) discarded its jid). This turns the research into data.
//
// EVERY POLICY IS SEEDED WITH enabled:false — a DRAFT, not a live rule. That is deliberate and matches both
// the survey's own provenance caveat ("MUST be verified against each jurisdiction's current statute...by
// counsel licensed there before a customer relies on them") and the AUTO_CONFIG trust model
// (AI/research drafts -> city reviews -> city attests -> live). Runtime is double-gated anyway:
// clarificationPolicy.automationActive() needs enabled === true AND the profile section attested.
//
// Writes go through effectiveConfig.applyConfig(), the same path a human edit or an AI extraction takes, so
// each jurisdiction gets config_history + a synced profile section for free.
//
// Idempotent: re-running overwrites the same rows with the same values.
//
// Run: cd /opt/optimumq/backend && node src/db/seed_clarification_policies.js
require('dotenv').config();
var db = require('../db');
var effectiveConfig = require('../services/effectiveConfig');

// clock_effect vocabulary: no_fixed_clock | runs_no_stop | toll_pause_resume | toll_and_restart |
//                          start_gate | operational_hold
// duty:      none | required_before_denial | required_before_burden_denial
// closure:   allowed | via_denial | not_allowed | unspecified
// source:    statute | ordinance | ag_guidance | established_practice | default_off
var JURISDICTIONS = [
  { code: 'TX', name: 'Texas', statute: 'Texas Public Information Act', cite: "Tex. Gov't Code Ch. 552", exemption: 'pre_clearance',
    effect: 'toll_and_restart', duty: 'none', vague: false, grace: 61, closure: 'allowed', notice: false,
    src: 'statute', fieldCite: "Tex. Gov't Code § 552.222; City of Dallas v. Abbott, 304 S.W.3d 380 (Tex. 2010)", conf: 0.8,
    note: 'Clarification RESETS the 10-business-day clock (measured from the date the request is clarified). No response in 61 days = request withdrawn, § 552.222(d).' },

  { code: 'AL', name: 'Alabama', statute: 'Alabama Public Records Law', cite: 'Ala. Code § 36-12-40 et seq.', exemption: 'self_court',
    effect: 'toll_and_restart', duty: 'none', vague: true, grace: null, closure: 'allowed', notice: false,
    src: 'statute', fieldCite: 'Ala. Code § 36-12-43/44', conf: 0.6 },

  { code: 'AR', name: 'Arkansas', statute: 'Arkansas Freedom of Information Act', cite: 'Ark. Code § 25-19-101 et seq.', exemption: 'self_court',
    effect: 'operational_hold', duty: 'none', vague: false, grace: null, closure: 'unspecified', notice: false,
    src: 'established_practice', fieldCite: 'Arkansas FOIA — tolling legally unsettled; held as an operational (non-statutory) hold.', conf: 0.45 },

  { code: 'OK', name: 'Oklahoma', statute: 'Oklahoma Open Records Act', cite: '51 O.S. § 24A.5', exemption: 'self_court',
    effect: 'no_fixed_clock', duty: 'none', vague: true, grace: null, closure: 'via_denial', notice: false,
    src: 'statute', fieldCite: '51 O.S. § 24A.5 (promptness standard, no fixed clock)', conf: 0.55,
    note: 'Tulsa layers a City EO with specificity requirements + deny-if-still-vague ON TOP of a silent state statute. That is a CITY override; the state->city precedence stack is NOT built (SPEC_parent_child_lifecycle §10.2).' },

  { code: 'NC', name: 'North Carolina', statute: 'North Carolina Public Records Law', cite: 'N.C.G.S. Ch. 132', exemption: 'self_court',
    effect: 'no_fixed_clock', duty: 'none', vague: false, grace: null, closure: 'unspecified', notice: false,
    src: 'statute', fieldCite: 'N.C.G.S. Ch. 132 (no fixed statutory clock)', conf: 0.6 },

  { code: 'GA', name: 'Georgia', statute: 'Georgia Open Records Act', cite: 'O.C.G.A. § 50-18-70 et seq.', exemption: 'self_court',
    effect: 'runs_no_stop', duty: 'none', vague: false, grace: null, closure: 'unspecified', notice: false,
    src: 'statute', fieldCite: 'O.C.G.A. § 50-18-71 (3 business days)', conf: 0.6 },

  { code: 'PA', name: 'Pennsylvania', statute: 'Right-to-Know Law', cite: '65 P.S. § 67.101 et seq.', exemption: 'self_appeal_court',
    effect: 'runs_no_stop', duty: 'none', vague: true, grace: null, closure: 'via_denial', notice: true,
    src: 'statute', fieldCite: '65 P.S. § 67.901/.903 (5 business days; written denial required)', conf: 0.7,
    note: 'Appeals go to the Office of Open Records (OOR) — self_appeal_court.' },

  { code: 'MI', name: 'Michigan', statute: 'Michigan Freedom of Information Act', cite: 'MCL 15.231 et seq.', exemption: 'self_appeal_court',
    effect: 'start_gate', duty: 'none', vague: true, grace: null, closure: 'via_denial', notice: true,
    src: 'statute', fieldCite: 'MCL 15.233; MCL 15.235 (5 business days)', conf: 0.4,
    note: 'CONTESTED — the two research passes disagree (survey §5.1). City pass: start_gate (the clock starts only on a sufficient request). State pass: a fixed 5-business-day clock on which an insufficient request is DENIED (runs_no_stop + vague_is_denial_ground). LOWEST CONFIDENCE IN THE SET — verify against MCL 15.235 before Michigan ships.' },

  { code: 'ID', name: 'Idaho', statute: 'Idaho Public Records Act', cite: 'Idaho Code § 74-101 et seq.', exemption: 'self_court',
    effect: 'runs_no_stop', duty: 'none', vague: true, grace: null, closure: 'unspecified', notice: false,
    src: 'statute', fieldCite: 'Idaho Code § 74-103 (3 working days / 10 if extended)', conf: 0.6 },

  { code: 'FL', name: 'Florida', statute: 'Florida Public Records Act', cite: 'Fla. Stat. Ch. 119', exemption: 'self_court',
    effect: 'no_fixed_clock', duty: 'none', vague: false, grace: 30, closure: 'allowed', notice: false,
    src: 'established_practice', fieldCite: 'Fla. Stat. § 119.07(1)(c); Tribune Co. v. Cannella, 458 So. 2d 1075 (Fla. 1984) — "reasonable custodial delay"; the 30-day grace is agency PRACTICE, not statute.', conf: 0.6,
    note: 'No statutory clock at all. Delay is measured per record (retrieve + review + redact).' },

  { code: 'AZ', name: 'Arizona', statute: 'Arizona Public Records Law', cite: 'A.R.S. § 39-121 et seq.', exemption: 'self_court',
    effect: 'no_fixed_clock', duty: 'none', vague: false, grace: null, closure: 'unspecified', notice: false,
    src: 'statute', fieldCite: 'A.R.S. § 39-121.01 (promptly; no fixed clock)', conf: 0.6 },

  { code: 'CA', name: 'California', statute: 'California Public Records Act', cite: "Cal. Gov't Code § 7920 et seq.", exemption: 'self_court',
    effect: 'runs_no_stop', duty: 'none', vague: false, grace: null, closure: 'unspecified', notice: false,
    src: 'statute', fieldCite: "Cal. Gov't Code § 7922.535 (10-day determination + one 14-day extension); § 7922.500 bars using process to delay.", conf: 0.65,
    note: 'The CPRA has NO clarification tolling and no requestor-non-response tolling. The only elasticity is the single 14-day unusual-circumstances extension.' },

  { code: 'WA', name: 'Washington', statute: 'Public Records Act', cite: 'RCW 42.56', exemption: 'self_court',
    effect: 'toll_pause_resume', duty: 'none', vague: false, grace: 30, closure: 'allowed', notice: false,
    src: 'ag_guidance', fieldCite: 'RCW 42.56.520 (5 business days; may request clarification); WAC 44-14-04003(8) — no requestor response in 30 days => the request may be deemed abandoned.', conf: 0.75,
    note: 'The strongest installment regime in the country (RCW 42.56.080(2)) — production is per-record/per-installment.' },

  { code: 'NJ', name: 'New Jersey', statute: 'Open Public Records Act', cite: 'N.J.S.A. 47:1A-1 et seq. (2024 c.16)', exemption: 'self_appeal_court',
    effect: 'toll_pause_resume', duty: 'none', vague: true, grace: null, closure: 'via_denial', notice: true,
    src: 'established_practice', fieldCite: 'OPRA as amended 2024 c.16; tolling on clarification is GRC PRACTICE, not explicit statute.', conf: 0.5,
    note: 'Post-2024 practice is unsettled and shifting under litigation (survey provenance caveat). Appeals go to the Government Records Council — self_appeal_court.' },

  { code: 'RI', name: 'Rhode Island', statute: 'Access to Public Records Act', cite: 'R.I. Gen. Laws § 38-2-1 et seq.', exemption: 'self_court',
    effect: 'toll_pause_resume', duty: 'none', vague: false, grace: null, closure: 'unspecified', notice: true,
    src: 'statute', fieldCite: 'R.I. Gen. Laws § 38-2-7(b)', conf: 0.65 },

  { code: 'IL', name: 'Illinois', statute: 'Freedom of Information Act', cite: '5 ILCS 140', exemption: 'self_appeal_court',
    effect: 'runs_no_stop', duty: 'required_before_burden_denial', vague: false, grace: null, closure: 'via_denial', notice: true,
    src: 'statute', fieldCite: '5 ILCS 140/3(d)-(g) (5 business days + one 5-day extension; § 3(g) requires an opportunity to narrow before an unduly-burdensome denial); § 9(b) denial content; § 9.5 PAC review.', conf: 0.75,
    note: 'The unitary outlier: ONE request-level answer date, NO installment safe harbor. A blown deadline is a constructive denial of the whole request (§ 9(c)). The duty to offer narrowing is a BURDEN rule, not a vagueness rule.' },

  { code: 'KS', name: 'Kansas', statute: 'Kansas Open Records Act', cite: 'K.S.A. 45-215 et seq.', exemption: 'self_court',
    effect: 'runs_no_stop', duty: 'none', vague: true, grace: null, closure: 'via_denial', notice: false,
    src: 'statute', fieldCite: 'K.S.A. 45-218 / 45-220 (3 business days; written denial on request)', conf: 0.6 },

  { code: 'MS', name: 'Mississippi', statute: 'Mississippi Public Records Act', cite: 'Miss. Code § 25-61-1 et seq.', exemption: 'self_court',
    effect: 'runs_no_stop', duty: 'none', vague: false, grace: null, closure: 'unspecified', notice: true,
    src: 'statute', fieldCite: 'Miss. Code § 25-61-5', conf: 0.6 }
];

function policyFor(j) {
  var prov = {};
  var p = {
    enabled: false, // DRAFT — the city switches it on after review + attestation.
    clarification_clock_effect: j.effect,
    clarification_duty: j.duty,
    vague_is_denial_ground: j.vague,
    clarification_grace_days: j.grace,
    abandonment_grace_days: null, // internal safety buffer — a city choice, never a legal value.
    abandonment_closure: j.closure,
    closure_notice_required: j.notice
  };
  ['clarification_clock_effect', 'clarification_duty', 'vague_is_denial_ground', 'clarification_grace_days', 'abandonment_closure', 'closure_notice_required'].forEach(function (k) {
    prov[k] = { source: j.src, citation: j.fieldCite, confidence: j.conf };
  });
  p.provenance = prov;
  return p;
}

(async function () {
  await db.initDb();
  var made = 0, updated = 0;
  for (var i = 0; i < JURISDICTIONS.length; i++) {
    var j = JURISDICTIONS[i];
    var jid = 'jur-' + j.code.toLowerCase();
    var existing = await db.get('SELECT id FROM jurisdiction_profiles WHERE id = ?', [jid]);
    if (!existing) {
      // Seeded jurisdictions are a RESEARCH LIBRARY, not the deployed jurisdiction. The active one is
      // chosen by system_config['jurisdiction_profile']; nothing in the code filters on status.
      await db.run("INSERT INTO jurisdiction_profiles (id, code, name, statute_name, statute_citation, status, exemption_model) VALUES (?,?,?,?,?,?,?)",
        [jid, j.code, j.name, j.statute, j.cite, 'library', j.exemption]);
      made++;
    } else {
      updated++;
    }
    await effectiveConfig.applyConfig(jid, 'clarification', policyFor(j), 'survey-seed', 'survey-seed',
      'Seeded from CLARIFICATION_POLICY_SURVEY.md §4.1 — DRAFT (enabled=false), pending city review + attestation.');
    console.log('  ' + j.code.padEnd(3) + '  ' + String(j.effect).padEnd(18) + ' grace=' + String(j.grace === null ? '-' : j.grace).padEnd(4) + ' conf=' + j.conf + (j.note ? '  *' : ''));
  }
  var n = await db.get('SELECT COUNT(*) AS n FROM jurisdiction_rules WHERE domain = ?', ['clarification']);
  console.log('\n' + made + ' jurisdiction profiles created, ' + updated + ' already existed.');
  console.log(n.n + ' clarification policies now in jurisdiction_rules. All enabled=false (draft).');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
