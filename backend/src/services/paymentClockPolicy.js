'use strict';
// Deposit / payment CLOCK policy — the per-jurisdiction config substrate for what an unpaid deposit does
// to the STATUTORY clock, and what happens when the requestor never pays.
//
// WHY: until now `payment_pending` was declared as a toll reason in tolling.js and had ZERO callers. The
// fee and tickler modules did not even import the tolling engine. So a request sitting on an unpaid deposit
// kept burning its statutory clock and reported FALSE LATENESS — the city looked delinquent for the
// requestor's inaction. See SPEC_parent_child_lifecycle.md §10.2 gap 2.
//
// This is deliberately the SAME SHAPE as clarificationPolicy.js — enum + provenance + master switch, read
// and written per jurisdiction via jurisdiction_rules — because the two questions are the same question:
// "what does the statutory clock do while we are waiting on the requestor?" Reusing the vocabulary means
// one mental model, one attestation gate, one extractor pattern.
//
// SAFE-MANUAL DEFAULT: every field defaults to off/no-effect and `enabled` defaults to false. With the
// policy disabled (or its jurisdiction-profile section un-attested) NOTHING automated happens — the effort
// trail is still written, but the clock is never touched. Matches AUTO_CONFIG §2.3.
var JR = require('./jurisdictionRules');

var DOMAIN = 'payment';

// Same vocabulary as the clarification clock effect — one mental model for "waiting on the requestor".
// TEXAS is `toll_and_restart`: Gov't Code § 552.263(e) — the request is "considered to have been received
// ... on the date the governmental body receives the deposit". That is a RE-RECEIPT (a full clock restart),
// which is stronger than a toll.
var CLOCK_EFFECTS = ['runs_no_stop', 'toll_pause_resume', 'toll_and_restart', 'operational_hold'];
// What happens when the grace window lapses with the deposit still unpaid.
var LAPSE_ACTIONS = ['flag_only', 'withdraw'];
var SOURCES = ['statute', 'ordinance', 'ag_guidance', 'established_practice', 'default_off'];

var FIELDS = [
  { key: 'deposit_clock_effect', type: 'enum', values: CLOCK_EFFECTS, default: 'runs_no_stop',
    label: 'Clock effect while a deposit is unpaid',
    help: 'What the statutory response clock does between "deposit due" and "deposit paid". TX = toll_and_restart (§ 552.263(e): the request is re-received on the date the deposit arrives).' },
  { key: 'deposit_grace_days', type: 'int_or_null', default: null,
    label: 'Deposit grace period (days)',
    help: 'Days the requestor has to pay before the request may lapse. Blank = fall back to the fee profile\'s payment band window (existing behaviour). TX = 10 business days (§ 552.263(f)).' },
  { key: 'deposit_lapse_action', type: 'enum', values: LAPSE_ACTIONS, default: 'flag_only',
    label: 'On lapse',
    help: 'What happens when the grace window passes unpaid. flag_only = today\'s behaviour (raise a tickler flag). withdraw = the request is considered withdrawn (TX § 552.263(f) / § 552.221(e)).' },

  // ---- THE "SEND AGAIN" RULE (Kevin, 2026-07-14). When the cost rises past the variance threshold, does
  // the jurisdiction REQUIRE a fresh itemized statement before the city may collect the higher amount?
  { key: 'reissue_required_on_variance', type: 'bool', default: false,
    label: 'A cost overrun requires a REVISED estimate to be re-sent',
    help: 'TX § 552.2615(c): if actual charges will exceed the itemized estimate by more than 20%, the body "shall send to the requestor an updated itemized statement," and the requestor gets a fresh response window.' },
  { key: 'reissue_blocks_collection', type: 'bool', default: false,
    label: 'Until it is re-sent, the city may not collect the overrun',
    help: 'TX § 552.2615(b): a body that does not provide the required itemized statement "may not collect more than $40." The statement is a PRECONDITION to the money — so the system refuses payment above the amount the requestor was last actually told about.' },
  { key: 'reissue_restarts_response_window', type: 'bool', default: false,
    label: 'Re-sending restarts the requestor response window',
    help: 'TX: the updated statement gives the requestor a fresh 10 business days to accept, narrow, or complain — or the request is withdrawn (§ 552.2615(c)).' }
];

function defaults() {
  var d = { enabled: false, provenance: {} };
  FIELDS.forEach(function (f) { d[f.key] = f.default; });
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
  return v;
}

// Lenient: whatever is in the store, over defaults. Never throws — a malformed stored value degrades to
// the safe default rather than breaking a request.
function normalize(raw) {
  raw = raw || {};
  var out = defaults();
  out.enabled = raw.enabled === true;
  FIELDS.forEach(function (f) { out[f.key] = coerceField(f, raw[f.key], false); });
  if (raw.provenance && typeof raw.provenance === 'object') out.provenance = raw.provenance;
  return out;
}

// Strict: used on write. An invalid enum is a 400, not a silent downgrade.
function validate(raw) {
  raw = raw || {};
  var out = { enabled: raw.enabled === true, provenance: {} };
  FIELDS.forEach(function (f) { out[f.key] = coerceField(f, raw[f.key], true); });
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

// The clock is touched ONLY when the city has switched the policy on AND attested the profile section.
// Same double gate as clarification. An un-attested city gets the effort trail and nothing else.
function automationActive(policy, attested) { return !!(policy && policy.enabled === true && attested === true); }

module.exports = {
  DOMAIN: DOMAIN, CLOCK_EFFECTS: CLOCK_EFFECTS, LAPSE_ACTIONS: LAPSE_ACTIONS, SOURCES: SOURCES, FIELDS: FIELDS,
  defaults: defaults, normalize: normalize, validate: validate, read: read, write: write,
  isConfigured: isConfigured, automationActive: automationActive
};
