'use strict';
// Clarification / vague-request policy — the per-jurisdiction config SUBSTRATE.
// Defines how OptimumQ handles a vague/insufficient-description request: whether/how the statutory
// response clock reacts to a clarification, whether vagueness is itself a denial ground, and the
// grace windows before a non-responding request may be closed. This module OWNS the schema, defaults,
// validation, and read/write; the config-freshness adapter (configExtractors 'clarification') and the
// jurisdiction-profile section are thin layers over it.
//
// Design basis: docs/CLARIFICATION_POLICY_SURVEY.md §2 (the 7-field substrate). Per AUTO_CONFIG §1
// (expressiveness precedes automation) this is step 1 — the slot the rule lives in — before any AI
// extractor (slice 3) or tolling trigger (slice 2) is wired.
//
// SAFE-MANUAL DEFAULT: every field defaults to off/unspecified and `enabled` defaults to false. With
// the policy disabled (or its jurisdiction-profile section un-attested) the clarification workflow takes
// NO automated action — matching AUTO_CONFIG §2.3 (un-attested area = safe/manual) and Kevin's explicit
// "turn the model off" requirement.
var { get, run } = require('../db');
var JR = require('./jurisdictionRules');

var DOMAIN = 'clarification';           // jurisdiction_rules domain (matches the configExtractors adapter key)
var STORE_KEY = 'clarification_policy'; // legacy global system_config key — read-fallback only, no longer written

// The crux variable: what the statutory response clock does when a clarification is sent. See survey §2.1.
var CLOCK_EFFECTS = ['no_fixed_clock', 'runs_no_stop', 'toll_pause_resume', 'toll_and_restart', 'start_gate', 'operational_hold'];
var DUTIES = ['none', 'required_before_denial', 'required_before_burden_denial'];
var CLOSURES = ['allowed', 'via_denial', 'not_allowed', 'unspecified'];
var SOURCES = ['statute', 'ordinance', 'ag_guidance', 'established_practice', 'default_off'];

// Field catalog — drives validation AND the (future) editor form. type: enum | bool | int_or_null.
var FIELDS = [
  { key: 'clarification_clock_effect', type: 'enum', values: CLOCK_EFFECTS, default: 'no_fixed_clock',
    label: 'Clock effect on clarification', help: 'What the statutory response clock does when a clarification is sent.' },
  { key: 'clarification_duty', type: 'enum', values: DUTIES, default: 'none',
    label: 'Duty to offer clarification', help: 'Whether the agency must offer clarification before acting (IL: required before a burden denial).' },
  { key: 'vague_is_denial_ground', type: 'bool', default: false,
    label: 'Vagueness is a denial ground', help: 'Whether "insufficiently specific" can itself justify a denial.' },
  { key: 'clarification_grace_days', type: 'int_or_null', default: null,
    label: 'Requestor grace period (days)', help: 'Days the requestor has to respond to a clarification before the request may be abandoned/closed. Blank = statute silent → agency choice.' },
  { key: 'abandonment_grace_days', type: 'int_or_null', default: null,
    label: 'Auto-close safety buffer (days)', help: 'Optional internal buffer after the grace period lapses before the system auto-closes, so staff can intervene. Not a legal value — a product-safety margin.' },
  { key: 'abandonment_closure', type: 'enum', values: CLOSURES, default: 'unspecified',
    label: 'Closure on non-response', help: 'Whether / how a non-responding request may be closed.' },
  { key: 'closure_notice_required', type: 'bool', default: false,
    label: 'Written closure notice required', help: 'Whether a written denial/closure notice must be sent when a vague request is closed.' }
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

// Coerce/validate a raw field value. strict=true throws on an invalid enum; strict=false clamps to default.
function coerceField(f, v, strict) {
  if (f.type === 'bool') return v === true || v === 'true' || v === 1 || v === '1';
  if (f.type === 'int_or_null') return toIntOrNull(v);
  if (f.type === 'enum') {
    if (v === undefined || v === null || v === '') return f.default;
    if (f.values.indexOf(v) >= 0) return v;
    if (strict) throw new Error('Invalid ' + f.key + ': "' + v + '". Allowed: ' + f.values.join(', '));
    return f.default;
  }
  return v;
}

// Merge stored config over defaults, coercing every field. Lenient (never throws) — for reads.
function normalize(raw) {
  raw = (raw && typeof raw === 'object') ? raw : {};
  var out = defaults();
  out.enabled = raw.enabled === true || raw.enabled === 'true' || raw.enabled === 1 || raw.enabled === '1';
  FIELDS.forEach(function (f) { out[f.key] = coerceField(f, raw[f.key], false); });
  // provenance: keep only known fields with a sane source
  var prov = (raw.provenance && typeof raw.provenance === 'object') ? raw.provenance : {};
  FIELDS.forEach(function (f) {
    var p = prov[f.key];
    if (p && typeof p === 'object') {
      out.provenance[f.key] = {
        source: SOURCES.indexOf(p.source) >= 0 ? p.source : 'default_off',
        citation: p.citation ? String(p.citation).slice(0, 500) : '',
        confidence: (typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1) ? p.confidence : 0
      };
    }
  });
  return out;
}

// Strict validation for writes — throws on a bad enum so the editor/API gets clear feedback.
function validate(raw) {
  raw = (raw && typeof raw === 'object') ? raw : {};
  var out = defaults();
  out.enabled = raw.enabled === true || raw.enabled === 'true' || raw.enabled === 1 || raw.enabled === '1';
  FIELDS.forEach(function (f) { out[f.key] = coerceField(f, raw[f.key], true); });
  var prov = (raw.provenance && typeof raw.provenance === 'object') ? raw.provenance : {};
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
    }
  });
  return out;
}

// The effective policy for a jurisdiction (stored over defaults). Storage is now PER-JURISDICTION
// (jurisdiction_rules), with a fallback to the legacy global key for installs not yet backfilled.
// The jid is finally load-bearing — it used to be accepted and discarded.
async function read(jid) {
  if (!jid) jid = await JR.activeJid();
  return normalize(await JR.read(jid, DOMAIN) || {});
}

// Persist a validated policy for a jurisdiction. Returns the store target (for effectiveConfig history).
async function write(jid, cfg, actor) {
  var clean = validate(cfg);
  if (!jid) jid = await JR.activeJid();
  var r = await JR.write(jid, DOMAIN, clean, actor);
  return { target: r.target, policy: clean };
}

// Configured = the city has switched the model on. An off policy behaves identically to unconfigured
// (no automated action), so readiness treats only enabled=true as configured.
function isConfigured(policy) { return !!(policy && policy.enabled === true); }

// For slice 2: automated tolling/closure may act only when the policy is enabled AND its profile section
// is attested. Callers pass the attested flag from the jurisdiction profile.
function automationActive(policy, attested) { return !!(policy && policy.enabled === true && attested === true); }

module.exports = {
  STORE_KEY: STORE_KEY, CLOCK_EFFECTS: CLOCK_EFFECTS, DUTIES: DUTIES, CLOSURES: CLOSURES, SOURCES: SOURCES,
  FIELDS: FIELDS, defaults: defaults, normalize: normalize, validate: validate,
  read: read, write: write, isConfigured: isConfigured, automationActive: automationActive
};
