'use strict';
// Deadline rules for the researched comparison jurisdictions.
//
// SEEDED: Illinois and California only. Both have an unambiguous, single, statutory response/determination
// deadline WITH a capped extension — exactly the shape the clock engine models, and the two jurisdictions
// whose extension caps make tolling.extend() real rather than theoretical.
//
// DELIBERATELY NOT SEEDED — FL, WA, NY, CT. Their short statutory clock is NOT a production deadline:
//   FL  — no statutory clock at all. Only "reasonable custodial delay" per record (Tribune Co. v. Cannella,
//         458 So. 2d 1075 (Fla. 1984)). Modelling any number here would be inventing law.
//   WA  — RCW 42.56.520: 5 business days to RESPOND (produce, link, acknowledge with a reasonable estimate,
//         seek clarification, or deny). There is no final production deadline; the "reasonable estimate" is
//         revised per installment.
//   NY  — Pub. Off. Law § 89(3)(a): 5 business days to ACKNOWLEDGE, then a "date certain within a reasonable
//         period". The 20 business days is a benchmark, not a hard cap.
//   CT  — Conn. Gen. Stat. § 1-206(a): the 4 business days is the deadline for a DENIAL, not for production.
//
// Modelling any of those as a `respond` (produce) clock would report FALSE LATENESS — the exact bug class
// fixed elsewhere in this codebase (an unpaid deposit burning the statutory clock). What they actually need
// is a second, non-primary `acknowledge` clock type — which the engine already supports as pure config
// (clocks are arbitrary keys), but WHETHER a jurisdiction with no production deadline should show a blank
// deadline_date, or an internal service target, is a PRODUCT decision. Recorded as an open question in
// SPEC_parent_child_lifecycle.md §10.5 — do not guess it.
//
// Neither IL nor CA is the active jurisdiction (that is jur-tx), so this changes NOTHING live. Idempotent.
//
// Run: cd /opt/optimumq/backend && node src/db/seed_deadline_rules.js
require('dotenv').config();
var db = require('../db');
var JR = require('../services/jurisdictionRules');

var TOLL_REASONS = ['clarification_pending', 'payment_pending', 'ag_ruling_pending', 'extension'];

// Holidays: inherited from the active jurisdiction's set (US federal observed). Business-day arithmetic in
// IL needs a holiday set; the state's own list MUST be verified by the city before it relies on this.
async function holidays() {
  var tx = await JR.read('jur-tx', 'deadline');
  return (tx && tx.holidays) || [];
}

var JURISDICTIONS = [
  {
    id: 'jur-il', code: 'IL', name: 'Illinois', statute: 'Freedom of Information Act', cite: '5 ILCS 140',
    exemption: 'self_appeal_court',
    clock: {
      label: 'Respond / produce', basis: 'business_days', default: 5, startOn: 'intake', primary: true,
      tollReasons: TOLL_REASONS,
      // 5 ILCS 140/3(e): ONE extension of not more than 5 business days, on seven enumerated grounds.
      extension: {
        maxDays: 5, maxCount: 1,
        grounds: ['offsite_records', 'voluminous', 'categorical_request', 'not_located_after_search',
                  'exemption_review', 'undue_burden', 'consultation']
      }
    },
    note: 'THE UNITARY OUTLIER: one request-level answer date, NO installment safe harbor. A blown deadline is a constructive denial of the whole request (§ 9(c)).'
  },
  {
    id: 'jur-ca', code: 'CA', name: 'California', statute: 'California Public Records Act', cite: "Cal. Gov't Code § 7920 et seq.",
    exemption: 'self_court',
    clock: {
      // NOTE THE LABEL. CA's 10 days is a DETERMINATION deadline (§ 7922.535(a)), not a production deadline —
      // production is separately "promptly available" (§ 7922.530(a)). Calling this "Respond / produce" would
      // misstate the duty; the label is what an operator reads.
      label: 'Determine & notify', basis: 'calendar_days', default: 10, startOn: 'intake', primary: true,
      tollReasons: TOLL_REASONS,
      // § 7922.535(b): ONE extension, "shall not specify a date that would result in an extension for more
      // than 14 days". Grounds are the § 7922.535(c) enumerated set.
      extension: {
        maxDays: 14, maxCount: 1,
        grounds: ['field_facilities', 'voluminous', 'consultation', 'data_compilation',
                  'cyberattack', 'emergency_staffing']
      }
    },
    note: 'The 10-day clock is a DETERMINATION deadline, not production. The CPRA has NO clarification tolling and no requestor-non-response tolling — the 14-day extension is the only elasticity.'
  }
];

(async function () {
  await db.initDb();
  var hol = await holidays();
  for (var i = 0; i < JURISDICTIONS.length; i++) {
    var j = JURISDICTIONS[i];
    var existing = await db.get('SELECT id FROM jurisdiction_profiles WHERE id = ?', [j.id]);
    if (!existing) {
      await db.run("INSERT INTO jurisdiction_profiles (id, code, name, statute_name, statute_citation, status, exemption_model) VALUES (?,?,?,?,?,?,?)",
        [j.id, j.code, j.name, j.statute, j.cite, 'library', j.exemption]);
    }
    var cfg = {
      version: 1,
      note: j.note + ' Holidays are the US federal (observed) set inherited at seed time — VERIFY against the state calendar before a city relies on this.',
      weekend: [0, 6],
      holidays: hol,
      clocks: { respond: j.clock }
    };
    await JR.write(j.id, 'deadline', cfg, 'legal-research-seed');
    var e = j.clock.extension;
    console.log('  ' + j.code + '  ' + j.clock.default + ' ' + j.clock.basis +
      '  extension: max ' + e.maxDays + 'd / ' + e.maxCount + ' grant' + (e.maxCount === 1 ? '' : 's') +
      ', ' + e.grounds.length + ' grounds   [' + j.clock.label + ']');
  }
  var n = await db.all("SELECT jurisdiction_id FROM jurisdiction_rules WHERE domain = 'deadline' ORDER BY jurisdiction_id");
  console.log('\n' + n.length + ' jurisdictions now hold deadline rules: ' +
    n.map(function (r) { return r.jurisdiction_id.replace('jur-', '').toUpperCase(); }).join(' '));
  console.log('FL / WA / NY / CT deliberately NOT seeded — their short clock is an acknowledge/deny clock,');
  console.log('not a production deadline. Modelling it as one would report false lateness. See the header.');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
