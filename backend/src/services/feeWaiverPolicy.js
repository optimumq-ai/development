'use strict';
// Fee-waiver policy — the per-jurisdiction config substrate for how a fee waiver / reduction is requested,
// decided, appealed, and what happens when it is denied.
//
// Researched 2026-07-14 across TX · CA · IL · WA · FL · NY · CT (SPEC_parent_child_lifecycle.md §12).
// Two findings drove this schema, and both are landmines:
//
//   1. THE ILLINOIS FEE-FORFEITURE TRAP (5 ILCS 140/3(d)). A request parked in "awaiting fee-waiver
//      decision" keeps aging against IL's 5-business-day clock — and deciding a waiver is NOT one of the
//      seven enumerated grounds for an extension. On day 6 the body has constructively DENIED the request
//      AND "may not impose a fee for such copies" — permanently. The deliberation destroys the fee.
//      => `fee_forfeiture_on_late_response`. See services/feeForfeiture.js.
//
//   2. THE TEXAS TRIGGER-EVENT. The obvious design — start the pay-or-abandon clock when the waiver is
//      denied — is WRONG for Texas and would auto-close live requests. In TX a waiver denial does nothing
//      procedurally; the 10-business-day deemed-withdrawal hangs off the MONEY DOCUMENTS: the itemized
//      estimate (§ 552.2615(b)) and the deposit demand (§ 552.263(f)).
//      => `response_window_trigger` is an explicit enum, and `waiver_denial` is only ONE of its values.
//
// Uniform across all seven states, and encoded as defaults here:
//   - NO state has a "deemed granted" rule. Silence is always a deemed DENIAL.
//   - NO state requires a waiver denial in writing with reasons (that duty attaches to exemption denials
//     only). We default `denial_requires_written_reasons` to TRUE anyway — it is good practice and no state
//     forbids it. That is a POLICY default, not a legal finding; provenance records it as such.
//   - NO state tolls the response clock for a pending waiver request or appeal.
//
// `provenance.source` is LOAD-BEARING here, not cosmetic. The pay-or-abandon clock is STATUTORY IN ONLY ONE
// OF SEVEN STATES (TX). WA's 30 days is a model rule; FL's is pure agency policy. Only TX may tell a
// requestor "the law gives you 10 business days." A UI that renders every timer as "the legal deadline"
// misleads requestors in four of seven states.
var JR = require('./jurisdictionRules');

var DOMAIN = 'fee_waiver';

var GROUNDS = ['public_interest', 'indigency', 'news_media', 'exempt_records', 'elected_official',
               'public_defender', 'cost_exceeds_collection', 'agency_discretion'];
var BINDING = ['mandatory', 'discretionary', 'none'];
// THE TEXAS FIELD. Getting this wrong auto-closes live requests.
var TRIGGERS = ['none', 'waiver_denial', 'cost_estimate_sent', 'deposit_demanded'];
var EXPIRY = ['none', 'deemed_withdrawn', 'close_request'];
var FORUMS = ['none', 'court_only', 'internal', 'ag_overcharge', 'pac', 'foic', 'ombudsman'];
var UNITS = ['business', 'calendar'];
var SOURCES = ['statute', 'regulation', 'agency_policy', 'established_practice', 'default_off'];

var FIELDS = [
  { key: 'grounds', type: 'enum_list', values: GROUNDS, default: [],
    label: 'Waiver grounds', help: 'The grounds on which a fee may be waived or reduced. Empty = this jurisdiction has no waiver.' },
  { key: 'binding', type: 'enum', values: BINDING, default: 'none',
    label: 'Is the waiver mandatory?', help: 'CT is the only MANDATORY waiver in the researched set (§ 1-212(d)). TX § 552.267(a) says "shall" but triggers only on the body\'s own determination — functionally discretionary.' },
  { key: 'requestor_must_state_purpose', type: 'bool', default: false,
    label: 'Requestor must state a purpose', help: 'IL: true — 5 ILCS 140/6(c) requires the requestor to state the specific purpose and why the waiver is in the public interest.' },
  { key: 'denial_requires_written_reasons', type: 'bool', default: true,
    label: 'Denial must be written, with reasons', help: 'NO state statutorily requires this for a WAIVER denial (only for exemption denials). Defaulted true as POLICY — no state forbids it.' },
  { key: 'deemed_granted_on_silence', type: 'bool', default: false,
    label: 'Silence = waiver granted', help: 'FALSE in all seven states. Every state that addresses agency silence makes it a deemed DENIAL. Do not set this true without a citation.' },

  { key: 'response_window_days', type: 'int_or_null', default: null,
    label: 'Pay-or-abandon window (days)', help: 'TX = 10 business days. STATUTORY IN ONLY ONE OF SEVEN STATES — WA\'s 30 days is a model rule, FL\'s is agency policy. Blank = no window.' },
  { key: 'response_window_unit', type: 'enum', values: UNITS, default: 'business',
    label: 'Window unit', help: '' },
  { key: 'response_window_trigger', type: 'enum', values: TRIGGERS, default: 'none',
    label: 'What STARTS that window', help: 'TX = cost_estimate_sent / deposit_demanded, NOT waiver_denial. A waiver denial by itself does nothing procedurally in Texas. Getting this wrong auto-closes live requests.' },
  { key: 'response_window_expiry', type: 'enum', values: EXPIRY, default: 'none',
    label: 'On expiry', help: 'TX = deemed_withdrawn (§ 552.2615(b), § 552.263(f)).' },

  { key: 'tolls_on_waiver_request', type: 'bool', default: false,
    label: 'Clock pauses while the waiver is pending', help: 'FALSE in all seven states. NON-OVERRIDABLE in IL — a pending waiver is not one of the seven § 3(e) extension grounds, and letting it pause the clock is what destroys the fee.' },
  { key: 'tolls_on_waiver_appeal', type: 'bool', default: false,
    label: 'Clock pauses while a waiver denial is appealed', help: 'FALSE in all seven states.' },
  { key: 'restarts_on_deposit_receipt', type: 'bool', default: false,
    label: 'Clock RESTARTS when the deposit arrives', help: 'TX ONLY (§ 552.263(e)): the request is "considered to have been received … on the date the governmental body receives the deposit." A RESTART, not a toll — modelling it as a toll produces wrong due dates.' },

  { key: 'appeal_forum', type: 'enum', values: FORUMS, default: 'none',
    label: 'Where a denial is appealed', help: '' },
  { key: 'appeal_window_days', type: 'int_or_null', default: null,
    label: 'Appeal window (days)', help: '' },
  { key: 'appeal_window_unit', type: 'enum', values: UNITS, default: 'calendar',
    label: 'Appeal window unit', help: '' },
  { key: 'appeal_can_order_waiver', type: 'bool', default: false,
    label: 'Can that forum actually ORDER the waiver?', help: 'THE SLEEPER FIELD. IL\'s PAC will open a fee-waiver file and then say it has no authority to direct a waiver (2017 PAC 47258). TX\'s AG reviews the AMOUNT, not the § 552.267 call. CT\'s FOIC is the only forum in the set that can order one. Never route a requestor to a forum that cannot grant what they came for.' },
  { key: 'appeal_reaches_fee_amount', type: 'bool', default: false,
    label: 'That forum can review the fee AMOUNT', help: 'Distinct from ordering a waiver. TX (overcharge complaint), WA (RCW 42.56.550(2)), IL (§ 6(d), but only as to (a)/(b)).' },

  { key: 'estimate_required_above', type: 'int_or_null', default: null,
    label: 'Itemized estimate required above ($)', help: 'TX = $40 (§ 552.2615(a)).' },
  { key: 'deposit_allowed_above', type: 'int_or_null', default: null,
    label: 'Deposit allowed above ($)', help: 'TX = $100 (>15 FTE) / $50 (<16 FTE) (§ 552.263).' },
  { key: 'deposit_cap_pct', type: 'int_or_null', default: null,
    label: 'Deposit capped at (% of estimate)', help: 'WA = 10% (RCW 42.56.120(4)).' },

  // ---- GUARDRAILS: these protect the CITY from a legal loss. ----
  { key: 'fee_forfeiture_on_late_response', type: 'bool', default: false,
    label: 'A blown response clock FORFEITS the fee', help: 'IL ONLY (5 ILCS 140/3(d)): a body that misses the deadline but later provides copies "may not impose a fee for such copies." When true and the clock is blown, the system HARD-DISABLES fee assessment — it refuses to invoice, it does not merely warn.' },
  { key: 'extension_grounds_closed_list', type: 'bool', default: false,
    label: 'Extension grounds are a closed statutory list', help: 'IL = true: § 3(e)\'s seven grounds are exhaustive, and "deciding the fee waiver" is not one of them.' }
];

function defaults() {
  var d = { enabled: false, provenance: {} };
  FIELDS.forEach(function (f) { d[f.key] = Array.isArray(f.default) ? f.default.slice() : f.default; });
  return d;
}

function toIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  if (!isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function coerceField(f, v, strict) {
  if (f.type === 'bool') return v === true || v === 'true' || v === 1 || v === '1';
  if (f.type === 'int_or_null') return toIntOrNull(v);
  if (f.type === 'enum') {
    if (v === undefined || v === null || v === '') return f.default;
    if (f.values.indexOf(v) >= 0) return v;
    if (strict) throw new Error('Invalid value for ' + f.key + ': "' + v + '". Allowed: ' + f.values.join(', '));
    return f.default;
  }
  if (f.type === 'enum_list') {
    if (!Array.isArray(v)) return f.default.slice();
    var out = [];
    v.forEach(function (x) {
      if (f.values.indexOf(x) >= 0) { if (out.indexOf(x) < 0) out.push(x); }
      else if (strict) throw new Error('Invalid value for ' + f.key + ': "' + x + '". Allowed: ' + f.values.join(', '));
    });
    return out;
  }
  return v;
}

function normalize(raw) {
  raw = raw || {};
  var out = defaults();
  out.enabled = raw.enabled === true;
  FIELDS.forEach(function (f) { out[f.key] = coerceField(f, raw[f.key], false); });
  if (raw.provenance && typeof raw.provenance === 'object') out.provenance = raw.provenance;
  return out;
}

function validate(raw) {
  raw = raw || {};
  var out = { enabled: raw.enabled === true, provenance: {} };
  FIELDS.forEach(function (f) { out[f.key] = coerceField(f, raw[f.key], true); });

  // Two invariants the research makes non-negotiable. A city cannot configure its way into them.
  if (out.deemed_granted_on_silence === true) {
    throw new Error('No researched jurisdiction has a "deemed granted" rule — silence is a deemed DENIAL everywhere. Provide a citation before enabling this.');
  }
  if (out.extension_grounds_closed_list === true && out.tolls_on_waiver_request === true) {
    throw new Error('A pending fee-waiver decision cannot pause the response clock in a jurisdiction whose extension grounds are a closed statutory list (5 ILCS 140/3(e)) — that is exactly what forfeits the fee under § 3(d).');
  }

  var prov = raw.provenance || {};
  FIELDS.forEach(function (f) {
    var p = prov[f.key];
    if (p && typeof p === 'object') {
      if (p.source !== undefined && p.source !== null && p.source !== '' && SOURCES.indexOf(p.source) < 0) {
        throw new Error('Invalid provenance source for ' + f.key + ': "' + p.source + '". Allowed: ' + SOURCES.join(', '));
      }
      out.provenance[f.key] = {
        source: SOURCES.indexOf(p.source) >= 0 ? p.source : 'default_off',
        citation: p.citation ? String(p.citation).slice(0, 500) : '',
        confidence: (typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1) ? p.confidence : 0
      };
      // WS1 (Phase 7): the state-template importer files the statutory RULE IDS that bear on this field
      // next to the citation, so an imported config can be traced back to the rules it came from. Written
      // only when non-empty, so configs that predate the importer normalize byte-identically.
      if (Array.isArray(p.source_rule_ids) && p.source_rule_ids.length) {
        out.provenance[f.key].source_rule_ids = p.source_rule_ids.map(String).slice(0, 200);
      }
    }
  });
  return out;
}

async function read(jid) {
  if (!jid) jid = await JR.activeJid();
  return normalize(await JR.read(jid, DOMAIN) || {});
}

async function write(jid, cfg, actor) {
  var clean = validate(cfg);
  if (!jid) jid = await JR.activeJid();
  var r = await JR.write(jid, DOMAIN, clean, actor);
  return { target: r.target, policy: clean };
}

function isConfigured(policy) { return !!(policy && policy.enabled === true); }
function automationActive(policy, attested) { return !!(policy && policy.enabled === true && attested === true); }

// Is the pay-or-abandon window started by this event? TX: the estimate/deposit, NOT the waiver denial.
function windowStartsOn(policy, event) {
  return !!(policy && policy.response_window_days && policy.response_window_trigger === event);
}

module.exports = {
  DOMAIN: DOMAIN, GROUNDS: GROUNDS, BINDING: BINDING, TRIGGERS: TRIGGERS, EXPIRY: EXPIRY,
  FORUMS: FORUMS, UNITS: UNITS, SOURCES: SOURCES, FIELDS: FIELDS,
  defaults: defaults, normalize: normalize, validate: validate, read: read, write: write,
  isConfigured: isConfigured, automationActive: automationActive, windowStartsOn: windowStartsOn
};
