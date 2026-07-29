'use strict';
// PHASE 7 / BW4 — CHARGEABILITY AS CITED CONFIG (DRAFT_processing_ui_estimate.md §3, §4.5).
//
// "The builder never offers a line kind the state forbids — OH: no labor lines, actual cost only,
// R.C. 149.43(B)(1); TX: personnel time per AG schedule."
//
// THE FACT ALREADY EXISTS. feeEngine.laborGate has always refused to charge a driver whose config says
// `billable: false`, and the itemized estimate has always printed "Labor not chargeable" afterwards. What
// nobody could see was the refusal BEFORE typing: the builder offered a Search-hours box in Ohio, a clerk
// filled it in, and the engine silently zeroed it. This module answers the same question up front, from the
// same config, so the screen can decline to offer what the engine will decline to charge.
//
// ══ WHAT IS FILTERED, AND WHAT DELIBERATELY IS NOT ══
//
// Only an EXPLICIT prohibition removes a line kind: `labor.<driver>.billable === false`, or
// `chargeable === false` on a duplication/media kind. An UNCONFIGURED kind — no rate in the profile — is
// reported as `unconfigured` and still offered.
//
// That asymmetry is deliberate and conservative. "The statute forbids this" and "nobody has entered a rate
// yet" are different facts, and the seeded profiles are incomplete in ordinary ways (the live Texas profile
// carries no `av` block at all). Hiding every unconfigured kind would silently remove working inputs from
// every existing install on the day this ships, in the name of a prohibition nobody declared. Hiding only
// the declared prohibitions removes exactly the boxes that were already lies.
//
// ══ CITATIONS ══
//
// Preferred source is the profile itself: the imported configs carry `_statute` beside the rule it belongs
// to (the live TX labor bar carries "Tex. Gov't Code § 552.261(a)"), which is the citation that was
// actually researched for that city. FALLBACKS below are the same device as approvalModules'
// MANDATORY_CATEGORIES — a decided research finding copied into code where it can be read, tested and
// cited — and are used ONLY when the config records no citation of its own. A prohibition with no citation
// anywhere says so; it does not borrow one.
var JR = require('./jurisdictionRules');

// Decided research, per Draft 2 §3. Keyed by state code + line kind. Used only as a fallback label.
var FALLBACK_CITATIONS = {
  OH: { search: 'R.C. 149.43(B)(1)', review: 'R.C. 149.43(B)(1)', programming: 'R.C. 149.43(B)(1)' },
  TX: { search: "Tex. Gov't Code § 552.261(a)", review: "Tex. Gov't Code § 552.261(a)", programming: "Tex. Gov't Code § 552.261(a)" }
};
var FALLBACK_NOTES = {
  OH: 'Ohio permits only the ACTUAL COST of the medium — no labor, staff time or search charge of any kind.'
};

var LABOR_DRIVERS = [
  { key: 'search', field: 'searchHours', label: 'Search hours' },
  { key: 'review', field: 'reviewHours', label: 'Review / redaction hours' },
  { key: 'programming', field: 'programmingHours', label: 'Programming hours' }
];
var DUP_KINDS = [
  { key: 'bw', field: 'bwPages', label: 'B&W pages' },
  { key: 'color', field: 'colorPages', label: 'Color pages' },
  { key: 'oversized', field: 'oversizedPages', label: 'Oversized pages' }
];

function citationFor(code, key, cfgCitation) {
  if (cfgCitation) return cfgCitation;
  var m = FALLBACK_CITATIONS[String(code || '').toUpperCase()];
  return (m && m[key]) || null;
}

// Build the line-kind list from a parsed fee-profile config. Pure — the caller supplies the config and the
// state code, so this is trivially testable and never reaches for an active jurisdiction of its own.
function fromConfig(config, code) {
  config = config || {};
  var labor = config.labor || {};
  var dup = config.duplication || {};
  var kinds = [];

  LABOR_DRIVERS.forEach(function (d) {
    var c = labor[d.key];
    if (c && c.billable === false) {
      kinds.push({
        key: d.key, field: d.field, group: 'labor', label: d.label, permitted: false, reason: 'forbidden',
        citation: citationFor(code, d.key, c._statute || c.citation),
        text: (FALLBACK_NOTES[String(code || '').toUpperCase()] ||
          'This jurisdiction does not permit a charge for this labor.')
      });
      return;
    }
    if (!c) {
      kinds.push({ key: d.key, field: d.field, group: 'labor', label: d.label, permitted: true, reason: 'unconfigured',
        citation: null, text: 'No rate is configured for this driver, so it will price at $0.00. That is a gap in ' +
          'this city’s fee configuration, not a legal prohibition.' });
      return;
    }
    var bw = c.billableWhen;
    var conditional = !!(bw && bw.mode === 'all_or_nothing' && bw.trigger && bw.trigger !== 'none');
    kinds.push({
      key: d.key, field: d.field, group: 'labor', label: d.label, permitted: true,
      reason: conditional ? 'conditional' : 'permitted',
      rate: c.rate != null ? c.rate : null,
      citation: citationFor(code, d.key, (bw && bw._statute) || c._statute || c.citation),
      text: conditional
        ? 'Chargeable only once ' + bw.trigger + ' exceed ' + bw.threshold +
          (bw.paperOnly ? ' on a PAPER delivery — an electronic delivery falls outside the bar and is chargeable' : '') +
          '. The engine applies the bar; enter the hours either way.'
        : null
    });
  });

  DUP_KINDS.forEach(function (d) {
    var c = dup[d.key];
    if (c && c.chargeable === false) {
      kinds.push({ key: d.key, field: d.field, group: 'duplication', label: d.label, permitted: false, reason: 'forbidden',
        citation: citationFor(code, d.key, c._statute || c.citation),
        text: 'This jurisdiction does not permit a charge for this copy type.' });
      return;
    }
    kinds.push({ key: d.key, field: d.field, group: 'duplication', label: d.label,
      permitted: true, reason: c ? 'permitted' : 'unconfigured',
      rate: c ? (c.rate != null ? c.rate : null) : null,
      citation: citationFor(code, d.key, c && (c._statute || c.citation)),
      text: c ? null : 'No rate is configured for this copy type, so it will price at $0.00.' });
  });

  return kinds;
}

// The line kinds for the ACTIVE jurisdiction's selected fee profile. Never throws: an unreadable config
// answers "everything permitted, nothing cited", which leaves the builder exactly as it was before BW4.
async function forActiveJurisdiction(jid) {
  var db = require('../db');
  try {
    if (!jid) { try { jid = await JR.activeJid(); } catch (e) { jid = null; } }
    var code = null;
    try {
      var jrow = jid ? await db.get('SELECT code FROM jurisdiction_profiles WHERE id = ?', [jid]) : null;
      code = jrow && jrow.code;
    } catch (e) {}
    var row = await db.get("SELECT id, name, config_json FROM fee_profiles WHERE status = 'active' ORDER BY created_at DESC LIMIT 1");
    if (!row) row = await db.get('SELECT id, name, config_json FROM fee_profiles ORDER BY created_at DESC LIMIT 1');
    var cfg = {}; try { cfg = JSON.parse((row && row.config_json) || '{}'); } catch (e) { cfg = {}; }
    var kinds = fromConfig(cfg, code);
    return {
      jurisdictionId: jid || null, code: code || null,
      profile: row ? { id: row.id, name: row.name } : null,
      kinds: kinds,
      forbidden: kinds.filter(function (k) { return !k.permitted; })
    };
  } catch (e) {
    console.error('[chargeability]', e && e.message);
    return { jurisdictionId: jid || null, code: null, profile: null, kinds: [], forbidden: [], unreadable: true };
  }
}

module.exports = {
  LABOR_DRIVERS: LABOR_DRIVERS, DUP_KINDS: DUP_KINDS, FALLBACK_CITATIONS: FALLBACK_CITATIONS,
  fromConfig: fromConfig, forActiveJurisdiction: forActiveJurisdiction
};
