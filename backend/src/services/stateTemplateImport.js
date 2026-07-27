'use strict';
// PHASE 7 / WS1 — STATE TEMPLATE IMPORTER.
//
// Translates a Phase-6 per-state config template (docs/rules_research/workflow/templates/<ST>.json)
// into the app's existing jurisdiction-config machinery: `jurisdiction_profiles` + one
// `jurisdiction_rules` row per domain + `jurisdiction_profile_sections` rows for the attestation gate.
// See docs/SPEC_phase7_build.md (WS1) and templates/README.md for the template shape.
//
// FOUR RULES, from the spec, and each one is load-bearing:
//
//   (a) STATUTORY EVIDENCE IS NEVER DROPPED. Every domain config carries the rule ids it was built from
//       (`source_rule_ids`) plus the rule text itself. Where a domain's schema is closed (see (e)) the
//       ids ride in `provenance[field].source_rule_ids`, and anything that maps to no field at all is
//       recorded in the `template_import` manifest under `unmapped` AND printed by the CLI. The one
//       thing this importer will not do is silently discard a statute.
//
//   (b) CITY-CONFIG KNOBS ARRIVE UNCONFIRMED. The template's ⚠ config-not-law edges are local policy,
//       not statute. Each one is written as a config key with the suggested default from
//       node_concept_map.json and `confirmed: false`, and the surface carrying it gets a
//       `jurisdiction_profile_sections` row that cannot reach `configured` — and therefore cannot be
//       attested — until a human has confirmed every knob on it.
//
//   (c) RE-IMPORT NEVER OVERWRITES. A domain that already holds a config is diffed, and any difference
//       is staged as a `config_proposals` row for human review. The live config is not touched. Only a
//       domain with NO existing row is written directly (there is nothing to overwrite, and a state
//       arriving with no config at all is the case this importer exists for).
//
//   (d) IDEMPOTENT. Same template + same database = no writes, no proposals, on the second run. The
//       configs carry no timestamps and every object is built with sorted keys so the comparison is
//       stable.
//
//   (e) THE POLICED DOMAINS GET VALUES FROM A HUMAN, NOT FROM PROSE. `clarification`, `payment` and
//       `fee_waiver` are closed schemas owned by their policy modules, and configIntegrity.js rejects
//       any key those schemas do not define. More importantly their fields are legal enum choices
//       ("what does the clock do when a clarification is sent?") that cannot be derived from a statute
//       summary without guessing. So the importer writes the modules' SAFE-MANUAL defaults
//       (`enabled: false` — no automated action) and files the statutory evidence against the fields it
//       bears on, as provenance. The city sets the values and attests them. Importing a guessed enum
//       here would be exactly the "fully automated but non-compliant" trade the project has refused.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var { get, run } = require('../db');
var JR = require('./jurisdictionRules');
var clarificationPolicy = require('./clarificationPolicy');
var paymentClockPolicy = require('./paymentClockPolicy');
var feeWaiverPolicy = require('./feeWaiverPolicy');
var CM = require('./clockMatrix');

var IMPORTER = 'stateTemplateImport@1';
var TEMPLATE_DIR = path.join(__dirname, '..', '..', '..', 'docs', 'rules_research', 'workflow', 'templates');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function today() { return new Date().toISOString().slice(0, 10); }
function uid(pfx) { return pfx + '-' + require('uuid').v4().slice(0, 8); }

// Deterministic stringify (sorted keys), so "did anything change?" is a string compare and re-import is
// genuinely a no-op rather than a diff of key order.
function stable(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o === undefined ? null : o);
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}';
}
function same(a, b) { return stable(a) === stable(b); }
function uniqSorted(a) { var s = {}; (a || []).forEach(function (x) { if (x) s[x] = 1; }); return Object.keys(s).sort(); }

// ---------------------------------------------------------------------------------------------------
// NODE -> DOMAIN. Every one of the template's 30 ◆ knob nodes has exactly one home domain; the 25 ▲
// branch nodes all land in `branches` (the on/off profile) and some ALSO feed a detail domain. The
// importer asserts full coverage and fails loud on an unassigned node — same discipline as the Phase-6
// generator's audit. A silently unhomed knob is a config surface nobody will ever be asked to fill in.
// ---------------------------------------------------------------------------------------------------
var KNOB_DOMAIN = {
  'Master.g1': 'intake',            // submission channels / required fields
  'Master.g4': 'intake',            // acknowledgment
  'Master.bv': 'intake',            // reasonably-describes screen
  'Master.p3': 'fee',               // estimate data capture
  'Master.f2': 'fee',               // estimate review threshold
  'Master.dd': 'payment',           // deposit-before gate
  'Master.bn': 'exemption',         // no responsive records / neither confirm nor deny
  'Clarification.n2': 'clarification',
  'Clarification.n3': 'clarification',
  'Clarification.close': 'clarification',
  'Clarification.d4': 'clarification',
  'Estimate-Fee.dreq': 'fee',
  'Estimate-Fee.addt': 'fee',
  'Estimate-Fee.frev': 'fee',
  'Estimate-Fee.fcom': 'fee',
  'Estimate-Fee.drsp': 'fee',
  'Estimate-Fee.optout': 'fee',
  'Estimate-Fee.ddep': 'payment',
  'Estimate-Fee.cnp': 'payment',
  'Denial.nreason': 'exemption',
  'Denial.dlegal': 'exemption',
  'Denial.ncomm': 'exemption',
  'Denial.ddl': 'exemption',
  'Records-Search.bn': 'exemption',
  'Records-Search.inst': 'disposition',   // installment / partial production
  'Redaction.r1': 'redaction',
  'Redaction.pii': 'redaction',
  'Redaction.r2': 'redaction',
  'Redaction.d3': 'redaction',
  'Disposition.fmt': 'disposition'
};

// Branch nodes that also feed a detail domain beyond the branch profile itself.
var BRANCH_DETAIL_DOMAIN = {
  'Master.g2': 'eligibility',
  'Master.s1': 'fee_waiver',
  'Estimate-Fee.dwv': 'fee_waiver',
  'Estimate-Fee.wrev': 'fee_waiver',
  'Disposition.hold': 'disposition',
  'Disposition.caps': 'ledger'
};

// The suggested defaults for ⚠ city-config knobs, taken VERBATIM from the "recommend ..." notes in
// docs/rules_research/workflow/node_concept_map.json. A knob with no recommendation there gets no
// suggested value here — the note is carried through and the human supplies the value.
var SUGGESTED_DEFAULTS = {
  'Master.g4': { key: 'acknowledgment_send_timing', value: 'same_business_day' },
  'Master.f2': { key: 'estimate_review_threshold_usd', value: 50 },
  'Estimate-Fee.frev': { key: 'estimate_review_threshold_usd', value: 50 },
  'Estimate-Fee.dreq': { key: 'estimate_required_trigger', value: 'above_free_allowance' },
  'Estimate-Fee.drsp': { key: 'requester_response_days', value: 30 },
  'Estimate-Fee.optout': { key: 'no_response_action', value: 'close_as_withdrawn' },
  'Estimate-Fee.cnp': { key: 'nonpayment_close_days', value: 60 },
  'Clarification.n3': { key: 'requester_response_days', value: 30 },
  'Clarification.d4': { key: 'materially_revised_treatment', value: 'new_request' },
  'Redaction.d3': { key: 'legal_review_trigger', value: 'novel_exemption_or_protected_person' }
};

// CONCEPT -> FIELD, for the three closed-schema policy modules. This is the whole of rule (e): the
// concept says WHICH field the statute bears on; it does not say what the field's value is. Anything a
// state carries that is not in this table is reported as unmapped rather than dropped.
var POLICED_FIELD_MAP = {
  clarification: {
    'clarification.toll_on_clarification': ['clarification_clock_effect'],
    'clarification.duty_to_assist': ['clarification_duty'],
    'clarification.confer_to_narrow': ['clarification_duty'],
    'clarification.duty_satisfied': ['clarification_duty'],
    'intake.reasonably_describes': ['vague_is_denial_ground'],
    'search.burden_limit': ['vague_is_denial_ground'],
    'clarification.nonresponse_withdrawal': ['clarification_grace_days', 'abandonment_closure']
  },
  payment: {
    'payment.deposit': ['deposit_clock_effect'],
    'payment.deposit_threshold': ['deposit_clock_effect'],
    'payment.deposit_ceiling': ['deposit_clock_effect'],
    'payment.advance_payment': ['deposit_clock_effect'],
    'payment.production_conditioned_on_payment': ['deposit_clock_effect'],
    'payment.nonpayment_consequence': ['deposit_grace_days', 'deposit_lapse_action'],
    'fee.estimate_and_notice': ['reissue_required_on_variance', 'reissue_blocks_collection', 'reissue_restarts_response_window']
  },
  fee_waiver: {
    'fee.waiver': ['grounds', 'binding'],
    'fee.estimate_and_notice': ['estimate_required_above'],
    'payment.deposit_threshold': ['deposit_allowed_above'],
    'payment.deposit_ceiling': ['deposit_cap_pct'],
    'payment.nonpayment_consequence': ['response_window_days', 'response_window_trigger', 'response_window_expiry']
  }
};
var POLICED = {
  clarification: clarificationPolicy,
  payment: paymentClockPolicy,
  fee_waiver: feeWaiverPolicy
};

// Engine defaults, NOT statutory findings: which pause reasons the clock engine may honour. Each one is
// separately gated by its own policy module's `enabled` flag (false on import), so listing them here is
// inert until a city turns that policy on and attests it.
var ENGINE_TOLL_REASONS = ['clarification_pending', 'payment_pending', 'extension', 'ag_ruling_pending'];

// ---------------------------------------------------------------------------------------------------
// Template reading
// ---------------------------------------------------------------------------------------------------
function templatePath(code) { return path.join(TEMPLATE_DIR, String(code).toUpperCase() + '.json'); }

function loadTemplate(code) {
  var p = templatePath(code);
  if (!fs.existsSync(p)) throw new Error('No Phase-6 template for "' + code + '" at ' + p);
  var raw = fs.readFileSync(p, 'utf8');
  var tpl;
  try { tpl = JSON.parse(raw); } catch (e) { throw new Error('Template ' + p + ' is not valid JSON: ' + e.message); }
  if (!tpl.code || !tpl.state) throw new Error('Template ' + p + ' has no state/code.');
  return { tpl: tpl, sha256: crypto.createHash('sha256').update(raw, 'utf8').digest('hex'), file: path.basename(p) };
}

function listTemplates() {
  return fs.readdirSync(TEMPLATE_DIR)
    .filter(function (f) { return /^[A-Z]{2}\.json$/.test(f); })
    .map(function (f) { return f.slice(0, 2); }).sort();
}

// A template `statutory` block ({concept: [rule, ...]}) -> a normalized, key-sorted evidence object plus
// the flat rule-id list. Rule fields are re-emitted in a fixed order so the stable hash does not depend
// on how the generator happened to serialize them.
function evidence(statutory) {
  var concepts = {}, ids = [];
  Object.keys(statutory || {}).sort().forEach(function (c) {
    var rules = (statutory[c] || []).map(function (r) {
      var out = { rule_id: r.rule_id, authority: r.authority, summary: r.summary };
      if (r.clock_spec) out.clock_spec = r.clock_spec;
      if (r.clock_effect) out.clock_effect = r.clock_effect;
      ids.push(r.rule_id);
      return out;
    });
    if (rules.length) concepts[c] = rules;
  });
  return { concepts: concepts, source_rule_ids: uniqSorted(ids) };
}

// The ⚠ city-config edge on a node -> an unconfirmed config key. `confirmed: false` is what the
// attestation gate reads; `suggested_default` is a starting point, never an answer.
function cityConfig(node, nodeKey) {
  if (!node || !node.city_config) return null;
  var sug = SUGGESTED_DEFAULTS[nodeKey] || null;
  var out = { note: String(node.city_config), confirmed: false, value: null };
  if (sug) { out.suggested_key = sug.key; out.suggested_default = sug.value; }
  else { out.suggested_default = null; }
  // A knob that also carries statute is not a free choice: the statutory value governs and the suggested
  // default must not quietly displace it. Flagged so the confirmation screen can say so.
  if (node.statutory && Object.keys(node.statutory).length) out.statutory_evidence_present = true;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// clock_spec parsing. The specs are prose written by the Phase-6 generator ("10 business-days from
// request receipt", "undefined-soft: \"promptly\" from request receipt", "ceiling: 5 business-days ...").
// This reads the number and the day-basis and nothing else; interpretation is WS3's job.
// ---------------------------------------------------------------------------------------------------
var SOFT_RE = /^\s*undefined-soft\b/i;
var QUAL_RE = /^\s*(undefined-soft|fixed terminal|fixed|ceiling|terminal|tolls?|pauses?|restarts?)\s*:/i;
var NUM_RE = /(\d+)\s*(business|working|calendar|court)?[\s-]*(day|hour)/i;

function parseClockSpec(spec) {
  var s = String(spec || '');
  if (!s) return null;
  var out = { raw: s, soft: SOFT_RE.test(s), days: null, basis: null };
  var q = QUAL_RE.exec(s); if (q) out.qualifier = q[1].toLowerCase();
  var m = NUM_RE.exec(s);
  if (m && m[3].toLowerCase() === 'day') {
    out.days = Number(m[1]);
    var unit = (m[2] || '').toLowerCase();
    out.basis = (unit === 'business' || unit === 'working') ? 'business_days' : 'calendar_days';
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Domain builders
// ---------------------------------------------------------------------------------------------------
function importStamp(meta) {
  return { template: meta.file, state: meta.tpl.state, code: meta.tpl.code, template_sha256: meta.sha256, importer: IMPORTER };
}

// Group the template's knob nodes by their home domain, carrying evidence + city-config through.
function knobsByDomain(tpl, report) {
  var byDomain = {};
  Object.keys(tpl.knobs || {}).sort().forEach(function (k) {
    var domain = KNOB_DOMAIN[k];
    if (!domain) throw new Error('Knob node "' + k + '" has no home domain in KNOB_DOMAIN. ' +
      'Add it (and say why) rather than letting a config surface go unowned.');
    var node = tpl.knobs[k];
    var e = evidence(node.statutory);
    var entry = { label: node.label || k, concepts: e.concepts, source_rule_ids: e.source_rule_ids };
    var cc = cityConfig(node, k);
    if (cc) { entry.city_config = cc; report.cityKnobs.push({ domain: domain, node: k, label: entry.label }); }
    (byDomain[domain] = byDomain[domain] || {})[k] = entry;
  });
  return byDomain;
}

function branchEntry(key, b) {
  var act = evidence(b.activated_by);
  var ctx = evidence(b.context);
  var entry = {
    label: b.label || key,
    active: b.active === true,
    activated_by: act.concepts,
    context: ctx.concepts,
    source_rule_ids: uniqSorted(act.source_rule_ids.concat(ctx.source_rule_ids))
  };
  if (b.states_override) entry.states_override = b.states_override;
  if (b.complement_of) entry.complement_of = b.complement_of;
  var cc = cityConfig(b, key);
  if (cc) entry.city_config = cc;
  return entry;
}

// A generic evidence-bearing domain: the knob nodes that live here, plus whatever extra the section
// carries, plus the union of every rule id underneath it.
function evidenceDomain(meta, knobs, extra) {
  var cfg = { _import: importStamp(meta) };
  if (knobs && Object.keys(knobs).length) cfg.knobs = knobs;
  Object.keys(extra || {}).sort().forEach(function (k) { cfg[k] = extra[k]; });
  var ids = [];
  Object.keys(knobs || {}).forEach(function (k) { ids = ids.concat(knobs[k].source_rule_ids || []); });
  collectIds(extra, ids);
  cfg.source_rule_ids = uniqSorted(ids);
  return cfg;
}
function collectIds(o, into) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(function (x) { collectIds(x, into); }); return; }
  Object.keys(o).forEach(function (k) {
    if (k === 'source_rule_ids' && Array.isArray(o[k])) { o[k].forEach(function (x) { into.push(x); }); return; }
    if (k === 'rule_id' && typeof o[k] === 'string') { into.push(o[k]); return; }
    collectIds(o[k], into);
  });
}

// The 25 ▲ on/off profile. WS2 consults this to decide whether a branch's stages/tasks may spawn.
function branchesDomain(meta, tpl) {
  var branches = {}, active = [], inactive = [];
  Object.keys(tpl.branches || {}).sort().forEach(function (k) {
    var e = branchEntry(k, tpl.branches[k]);
    branches[k] = e;
    (e.active ? active : inactive).push(k);
  });
  return evidenceDomain(meta, null, { branches: branches, active: active, inactive: inactive, active_count: active.length });
}

// The g2 gate, decomposed into the requester-class dimensions that are CONFIG DIMENSIONS rather than
// per-state exceptions (residency · identity · purpose · class · incarceration · vexatious). Presence is
// read off the branch's `activated_by` concepts — derived, never asserted. WS2 turns these into gating.
var ELIGIBILITY_DIMENSIONS = {
  residency: ['eligibility.proof_of_residency', 'eligibility.resident_definition', 'intake.residency_attestation'],
  identity: ['intake.identity_requirement'],
  purpose: ['intake.purpose_and_certification'],
  requester_class: ['eligibility.requester_class_restriction', 'eligibility.out_of_class_discretionary', 'eligibility.record_subject_self_access'],
  incarceration: ['eligibility.incarcerated_requester_exclusion'],
  vexatious: ['eligibility.vexatious_requester_gate']
};
function eligibilityDomain(meta, tpl) {
  var b = (tpl.branches || {})['Master.g2'] || {};
  var e = branchEntry('Master.g2', b);
  var dims = {};
  Object.keys(ELIGIBILITY_DIMENSIONS).sort().forEach(function (d) {
    var ids = [], present = [];
    ELIGIBILITY_DIMENSIONS[d].forEach(function (c) {
      if (e.activated_by[c]) { present.push(c); e.activated_by[c].forEach(function (r) { ids.push(r.rule_id); }); }
    });
    dims[d] = { gated: present.length > 0, concepts: present, source_rule_ids: uniqSorted(ids), confirmed: false };
  });
  return evidenceDomain(meta, null, {
    gate_active: e.active,
    activated_by: e.activated_by,
    context: e.context,
    dimensions: dims
  });
}

// The 10 named timers, imported verbatim plus a parse of each clock_spec. This is WS3's input: the
// `deadline` domain below takes only what is unambiguously a base response deadline.
function clockMatrixDomain(meta, tpl, report) {
  var timers = {};
  Object.keys(tpl.clock_matrix || {}).sort().forEach(function (name) {
    var t = tpl.clock_matrix[name] || {};
    var e = evidence(t.statutory);
    var entry = { present: t.present === true, concepts: e.concepts, source_rule_ids: e.source_rule_ids, parsed: [] };
    if (t.note) entry.note = t.note;
    // present:false = soft standard: no statutory timer, city operational target only (S-002). WS3 turns
    // this flag into an aging target that is explicitly NOT a legal deadline.
    if (!entry.present) entry.operational_target = true;
    Object.keys(e.concepts).forEach(function (c) {
      e.concepts[c].forEach(function (r) {
        if (!r.clock_spec) return;
        var p = parseClockSpec(r.clock_spec);
        if (p) entry.parsed.push({ rule_id: r.rule_id, days: p.days, basis: p.basis, soft: p.soft, qualifier: p.qualifier || null, effect: r.clock_effect || null });
      });
    });
    entry.parsed.sort(function (a, b) { return a.rule_id < b.rule_id ? -1 : 1; });
    timers[name] = entry;
    if (entry.present && !entry.parsed.some(function (p) { return p.days != null; })) {
      report.softTimers.push(name);
    }
  });
  return evidenceDomain(meta, null, { timers: timers });
}

// The `deadline` config. WS1 derived this itself, conservatively and by hand; WS3 replaced that with the
// real named-timer taxonomy in services/clockMatrix.js, so there is ONE reconciler and the importer and
// the re-reconcile CLI cannot drift apart. Everything about how a timer becomes a clock — the four kinds,
// the slot assignment, exposures, the soft-standard service targets — lives there.
function deadlineDomain(meta, clockMatrixDomainCfg, holidays, report) {
  var built = CM.deadlineConfig(clockMatrixDomainCfg, { holidays: holidays || [], tollReasons: ENGINE_TOLL_REASONS });
  (built.report.unresolved || []).forEach(function (u) { report.unresolvedTimers.push(u); });
  report.targets = (built.report.targets || []).slice();
  report.exposures = (built.report.exposures || []).slice();
  report.primaryClock = built.report.primary || null;
  if (!Object.keys(built.config.clocks).length) return null;
  built.config.note = 'Reconciled from ' + meta.file + ' (' + IMPORTER + '). ' + built.config.note;
  return built.config;
}

// A closed-schema policy domain. Values stay at the module's safe-manual defaults (`enabled: false`);
// the statute rides as provenance on the fields it bears on. See rule (e) in the header.
function policedDomain(domain, mod, tpl, report) {
  var map = POLICED_FIELD_MAP[domain] || {};
  var byField = {};
  // Every statutory block anywhere in the template can bear on these fields, so sweep the lot: knobs,
  // branches and the clock matrix all carry concept-keyed evidence.
  var blocks = [];
  Object.keys(tpl.knobs || {}).forEach(function (k) { blocks.push(tpl.knobs[k].statutory); });
  Object.keys(tpl.branches || {}).forEach(function (k) { blocks.push(tpl.branches[k].activated_by); });
  Object.keys(tpl.clock_matrix || {}).forEach(function (k) { blocks.push(tpl.clock_matrix[k].statutory); });
  blocks.push(tpl.fee_schedule); blocks.push(tpl.ledger);

  var relevant = {};
  Object.keys(map).forEach(function (c) { relevant[c] = 1; });
  blocks.forEach(function (b) {
    Object.keys(b || {}).forEach(function (concept) {
      var fields = map[concept];
      if (!fields) return;
      (b[concept] || []).forEach(function (r) {
        fields.forEach(function (f) {
          var slot = byField[f] = byField[f] || { cites: [], ids: [] };
          slot.cites.push(r.authority); slot.ids.push(r.rule_id);
        });
      });
    });
  });

  var cfg = mod.defaults();
  cfg.provenance = {};
  Object.keys(byField).sort().forEach(function (f) {
    cfg.provenance[f] = {
      source: 'statute',
      citation: uniqSorted(byField[f].cites).join('; ').slice(0, 500),
      // Confidence is 0 on purpose: the citation says the statute bears on this field, NOT that the
      // field's value has been determined. A human sets the value and attests it.
      confidence: 0,
      source_rule_ids: uniqSorted(byField[f].ids)
    };
  });
  var clean = mod.validate(cfg);
  if (!Object.keys(clean.provenance || {}).length) report.emptyPoliced.push(domain);
  return clean;
}

// Everything the template carries that no domain field claimed. Recorded, printed, never dropped.
function unmappedConcepts(tpl) {
  var out = {};
  Object.keys(POLICED_FIELD_MAP).forEach(function (domain) {
    var map = POLICED_FIELD_MAP[domain];
    var miss = {};
    // Only concepts that the domain's own source nodes carry are "missing" for that domain; a global
    // sweep would report every unrelated concept in the state. Source nodes = the knob/branch nodes
    // homed to this domain.
    Object.keys(KNOB_DOMAIN).forEach(function (k) {
      if (KNOB_DOMAIN[k] !== domain) return;
      var n = (tpl.knobs || {})[k]; if (!n) return;
      Object.keys(n.statutory || {}).forEach(function (c) {
        if (!map[c]) { miss[c] = uniqSorted((miss[c] || []).concat((n.statutory[c] || []).map(function (r) { return r.rule_id; }))); }
      });
    });
    Object.keys(BRANCH_DETAIL_DOMAIN).forEach(function (k) {
      if (BRANCH_DETAIL_DOMAIN[k] !== domain) return;
      var n = (tpl.branches || {})[k]; if (!n) return;
      Object.keys(n.activated_by || {}).forEach(function (c) {
        if (!map[c]) { miss[c] = uniqSorted((miss[c] || []).concat((n.activated_by[c] || []).map(function (r) { return r.rule_id; }))); }
      });
    });
    if (Object.keys(miss).length) out[domain] = miss;
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Build every domain config for a template. Pure: no database, no clock, no randomness — so the same
// template always produces byte-identical configs, which is what makes re-import a no-op.
// ---------------------------------------------------------------------------------------------------
function buildConfigs(meta, opts) {
  opts = opts || {};
  var tpl = meta.tpl;
  var report = { cityKnobs: [], softTimers: [], unresolvedTimers: [], outOfBand: [], emptyPoliced: [], targets: [], exposures: [], primaryClock: null };
  var knobs = knobsByDomain(tpl, report);
  var domains = {};

  domains.intake = evidenceDomain(meta, knobs.intake || {}, {});
  domains.eligibility = eligibilityDomain(meta, tpl);
  domains.branches = branchesDomain(meta, tpl);
  domains.clock_matrix = clockMatrixDomain(meta, tpl, report);
  domains.fee = evidenceDomain(meta, knobs.fee || {}, {
    // The statutory fee CONSTRAINTS. The live rate table stays in `fee_profiles` — this is the evidence
    // a city's fee schedule has to sit inside, not a replacement for it.
    fee_schedule: evidence(tpl.fee_schedule).concepts
  });
  domains.exemption = evidenceDomain(meta, knobs.exemption || {}, {});
  domains.redaction = evidenceDomain(meta, knobs.redaction || {}, {});
  domains.disposition = evidenceDomain(meta, knobs.disposition || {}, {
    hold: branchEntry('Disposition.hold', (tpl.branches || {})['Disposition.hold'] || {})
  });
  domains.ledger = evidenceDomain(meta, null, {
    // MVP is class A (DESIGN_requestor_ledger.md); B–D are config stubs with manual counters (WS5).
    mvp_class: 'A',
    triggers: evidence(tpl.ledger).concepts,
    caps_branch: branchEntry('Disposition.caps', (tpl.branches || {})['Disposition.caps'] || {})
  });

  Object.keys(POLICED).forEach(function (d) { domains[d] = policedDomain(d, POLICED[d], tpl, report); });

  var dl = deadlineDomain(meta, domains.clock_matrix, opts.holidays, report);
  if (dl) domains.deadline = dl;

  // The manifest: what came in, what it hashed to, and everything that did NOT map cleanly.
  domains.template_import = {
    _import: importStamp(meta),
    audit: tpl.audit || {},
    domains: Object.keys(domains).sort(),
    city_config_knobs: report.cityKnobs.map(function (c) { return c.domain + '/' + c.node; }).sort(),
    unmapped: unmappedConcepts(tpl),
    unresolved_timers: report.unresolvedTimers,
    // WS3: what the clock matrix reconciled into. `service_targets` are the soft standards a city must
    // supply a number for; `exposures` are deemed-denial / deemed-disclosure consequences, recorded as
    // warnings against the duty they hang off and never run as clocks.
    primary_clock: report.primaryClock,
    service_targets: report.targets,
    exposures: report.exposures,
    soft_standard_timers: report.softTimers.slice().sort(),
    program_setup: evidence(tpl.program_setup).concepts
  };

  return { domains: domains, report: report };
}

// ---------------------------------------------------------------------------------------------------
// MERGE-ON-RE-IMPORT.
//
// Rule (c) stages a difference as a proposal rather than overwriting — but a proposal a reviewer might
// reasonably approve must not be a booby trap. A raw template config proposed against a jurisdiction
// that a human has already worked on would, if approved, reset every researched enum to its safe
// default, wipe TX's hand-seeded clocks, and un-confirm every city knob somebody had answered.
//
// So what gets proposed against an EXISTING config is the merge, not the import: the template's
// evidence added on top of the city's values, with the city's values winning every time. If that merge
// is identical to what is already stored, no proposal is raised at all — which is what makes re-import
// a no-op (rule (d)).
// ---------------------------------------------------------------------------------------------------

// Re-importing evidence must never silently un-answer a question the city has answered.
function carryConfirmations(current, proposed) {
  if (!current || typeof current !== 'object') return proposed;
  var keep = function (cur, prop) {
    if (!cur || !prop) return;
    var cc = cur.city_config, pc = prop.city_config;
    if (cc && pc) {
      if (cc.confirmed === true) pc.confirmed = true;
      if (cc.value !== undefined && cc.value !== null) pc.value = cc.value;
    }
  };
  ['knobs', 'branches'].forEach(function (sec) {
    Object.keys(proposed[sec] || {}).forEach(function (k) { keep(((current[sec] || {})[k]) || null, proposed[sec][k]); });
  });
  ['hold', 'caps_branch'].forEach(function (k) { keep(current[k] || null, proposed[k] || null); });
  Object.keys(proposed.dimensions || {}).forEach(function (d) {
    var cd = (current.dimensions || {})[d];
    if (cd && cd.confirmed === true) proposed.dimensions[d].confirmed = true;
  });
  keep(current, proposed);
  return proposed;
}

// The city's enum values are kept exactly as they are; only the citation trail grows.
function mergePoliced(mod, current, proposed) {
  var out = mod.normalize(current || {});
  out.provenance = out.provenance || {};
  Object.keys(proposed.provenance || {}).sort().forEach(function (f) {
    var imp = proposed.provenance[f];
    var cur = out.provenance[f];
    if (!cur || !cur.citation) { out.provenance[f] = imp; return; }
    // A citation a human (or the legal-research seed) already wrote is the authority; the import only
    // contributes the rule ids behind it.
    out.provenance[f] = {
      source: cur.source, citation: cur.citation, confidence: cur.confidence,
      source_rule_ids: uniqSorted((cur.source_rule_ids || []).concat(imp.source_rule_ids || []))
    };
  });
  return mod.validate(out);
}

// Existing clocks are never re-timed by an importer. A derived clock the config does not have is added
// (never as primary if something is already primary — two primary clocks is a broken config); a clock it
// does have only gains the citation it was missing.
function mergeDeadline(current, proposed) {
  var out = JSON.parse(JSON.stringify(current || {}));
  out.clocks = out.clocks || {};
  var hasPrimary = Object.keys(out.clocks).some(function (k) { return out.clocks[k] && out.clocks[k].primary; });
  Object.keys(proposed.clocks || {}).sort().forEach(function (k) {
    var p = proposed.clocks[k];
    var c = out.clocks[k];
    if (!c) {
      var add = {}; Object.keys(p).sort().forEach(function (x) { add[x] = p[x]; });
      add.primary = hasPrimary ? false : !!p.primary;
      if (add.primary) hasPrimary = true;
      out.clocks[k] = add;
      return;
    }
    if (!c.timer && p.timer) c.timer = p.timer;
    if (!c.citation && p.citation) c.citation = p.citation;
    if (!c.source_rule_ids && p.source_rule_ids) c.source_rule_ids = p.source_rule_ids;
    // WS3: a clock written before the kind taxonomy existed defaults to `response`, which is the strict
    // reading. Where the reconciler knows better (ag_ruling is an agency_action, not a response deadline)
    // adopt its kind — it changes no duration, only what the clock is understood to BE.
    if (!c.kind && p.kind) c.kind = p.kind;
    if (!c.exposures && p.exposures) c.exposures = p.exposures;
  });
  return out;
}

// What to PROPOSE for a domain that already holds a config.
//
// `current` is deep-copied first, and that is not defensive habit: paymentClockPolicy.normalize() and
// feeWaiverPolicy.normalize() both return the caller's own `provenance` object BY REFERENCE, so merging
// into the normalized copy silently rewrote `current` as well — and the "did anything change?" compare
// then found the two identical and staged no proposal. The evidence was computed, merged, and dropped
// on the floor, silently, for exactly the two domains where TX already had researched values.
function mergeForDomain(domain, current, proposed) {
  var cur = JSON.parse(JSON.stringify(current || {}));
  if (POLICED[domain]) return mergePoliced(POLICED[domain], cur, proposed);
  if (domain === 'deadline') return mergeDeadline(cur, proposed);
  return carryConfirmations(cur, proposed);
}

// ---------------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------------

// The statute citation, derived from the template's own rule authorities — the code name plus chapter,
// e.g. "Ohio Rev. Code § 149.43(B)(1)" -> "Ohio Rev. Code ch. 149". Derived, never invented: the statute
// NAME ("Ohio Public Records Act") is a fact this importer does not have, so it is left for a human.
function deriveCitation(tpl) {
  var counts = {};
  var walk = function (o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o.authority === 'string') {
      var m = /^(.*?)\s*§+\s*(\d+)[.\-]/.exec(o.authority);
      if (m) { var k = m[1].trim() + ' ch. ' + m[2]; counts[k] = (counts[k] || 0) + 1; }
    }
    Object.keys(o).forEach(function (k) { walk(o[k]); });
  };
  walk(tpl);
  var best = null;
  Object.keys(counts).sort().forEach(function (k) { if (!best || counts[k] > counts[best]) best = k; });
  return best;
}

async function upsertProfile(jid, tpl, actor) {
  var existing = await get('SELECT id, code, name, statute_citation, status FROM jurisdiction_profiles WHERE id = ?', [jid]);
  var cite = deriveCitation(tpl);
  if (!existing) {
    // `library`, never `active`: importing a template makes a state AVAILABLE, it does not switch the
    // city over to it. That is a deliberate, separate act.
    await run('INSERT INTO jurisdiction_profiles (id, code, name, statute_citation, status) VALUES (?,?,?,?,?)',
      [jid, tpl.code, tpl.state, cite, 'library']);
    return { created: true, statuteNameMissing: true };
  }
  // Never touch `status` (the active jurisdiction must stay active) and never overwrite a citation a
  // human already set.
  if (!existing.statute_citation && cite) {
    await run('UPDATE jurisdiction_profiles SET statute_citation = ? WHERE id = ?', [cite, jid]);
  }
  var nm = await get('SELECT statute_name FROM jurisdiction_profiles WHERE id = ?', [jid]);
  return { created: false, statuteNameMissing: !(nm && nm.statute_name) };
}

async function recordHistory(jid, domain, cfg, summary) {
  await run('UPDATE config_history SET effective_to = ? WHERE jurisdiction_id = ? AND domain = ? AND effective_to IS NULL', [today(), jid, domain]);
  await run('INSERT INTO config_history (id, jurisdiction_id, domain, config_json, summary, effective_from, effective_to, source, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [uid('ch'), jid, domain, JSON.stringify(cfg), summary, today(), null, 'template_import', nowStr()]);
}

// Rule (c): a domain that already holds a config is never overwritten — the difference is staged for
// review. Rule (d): an identical pending proposal is not staged twice, so re-import stays a no-op.
async function stageProposal(jid, domain, proposed, current, meta, actor) {
  var proposedJson = JSON.stringify(proposed);
  var dupe = await get(
    "SELECT id FROM config_proposals WHERE jurisdiction_id = ? AND domain = ? AND status = 'pending' AND proposed_json = ?",
    [jid, domain, proposedJson]
  );
  if (dupe) return { proposalId: dupe.id, deduped: true };
  var pid = uid('prop');
  await run('INSERT INTO config_proposals (id, jurisdiction_id, domain, status, summary, proposed_json, current_json, source_ref, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [pid, jid, domain, 'pending',
     'Phase-6 state template ' + meta.file + ' (sha ' + meta.sha256.slice(0, 12) + ') adds to the live ' +
     domain + ' config. The proposal is the MERGE — every value already stored is preserved, the template ' +
     'contributes statutory evidence (citations, rule ids) and any surface the config did not have. ' +
     'The live config was not changed.',
     proposedJson, JSON.stringify(current || {}), 'template:' + meta.tpl.code + '@' + meta.sha256.slice(0, 12),
     actor || 'template-import', nowStr()]);
  return { proposalId: pid, deduped: false };
}

async function importState(code, opts) {
  opts = opts || {};
  var actor = opts.actor || 'template-import';
  var meta = loadTemplate(code);
  var jid = 'jur-' + String(meta.tpl.code).toLowerCase();

  // Holiday calendars are not in the template. Inherit the active jurisdiction's set (same precedent as
  // seed_deadline_rules.js) so business-day arithmetic is not silently wrong, and say so in the note.
  var holidays = [];
  try {
    var activeJid = await JR.activeJid();
    var act = activeJid ? await JR.read(activeJid, 'deadline') : null;
    if (act && Array.isArray(act.holidays)) holidays = act.holidays;
  } catch (e) { /* no active jurisdiction yet — an empty calendar is honest */ }

  var built = buildConfigs(meta, { holidays: holidays });
  var profile = opts.dryRun
    ? await (async function () {
        var ex = await get('SELECT statute_name FROM jurisdiction_profiles WHERE id = ?', [jid]);
        return { created: !ex, statuteNameMissing: !(ex && ex.statute_name) };
      })()
    : await upsertProfile(jid, meta.tpl, actor);

  var result = {
    code: meta.tpl.code, state: meta.tpl.state, jid: jid, template: meta.file, sha256: meta.sha256,
    profileCreated: profile.created, statuteNameMissing: profile.statuteNameMissing,
    written: [], proposed: [], unchanged: [], report: built.report, sections: []
  };

  var names = Object.keys(built.domains).sort();
  for (var i = 0; i < names.length; i++) {
    var domain = names[i];
    var proposed = built.domains[domain];
    var row = await get('SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, domain]);
    if (!row) {
      if (!opts.dryRun) {
        await JR.write(jid, domain, proposed, actor);
        await recordHistory(jid, domain, proposed, 'Imported from Phase-6 template ' + meta.file);
      }
      result.written.push(domain);
      continue;
    }
    var current = {};
    try { current = JSON.parse(row.config_json || '{}'); } catch (e) { current = {}; }
    var merged = mergeForDomain(domain, current, proposed);
    if (same(current, merged)) { result.unchanged.push(domain); continue; }
    var p = opts.dryRun ? { proposalId: '(dry-run)', deduped: false } : await stageProposal(jid, domain, merged, current, meta, actor);
    result.proposed.push({ domain: domain, proposalId: p.proposalId, deduped: p.deduped });
  }

  // Rule (b): the attestation index. sync() recomputes every section from its live store, so the
  // template sections appear (and read not_configured) the moment the template_import row exists.
  if (!opts.dryRun) {
    try {
      var JP = require('./jurisdictionProfile');
      result.sections = await JP.sync(jid, { source: 'template_import', actor: actor });
    } catch (e) { result.sectionError = e && e.message; }
  }
  return result;
}

module.exports = {
  IMPORTER: IMPORTER, TEMPLATE_DIR: TEMPLATE_DIR,
  KNOB_DOMAIN: KNOB_DOMAIN, BRANCH_DETAIL_DOMAIN: BRANCH_DETAIL_DOMAIN,
  POLICED_FIELD_MAP: POLICED_FIELD_MAP, SUGGESTED_DEFAULTS: SUGGESTED_DEFAULTS,
  listTemplates: listTemplates, loadTemplate: loadTemplate, parseClockSpec: parseClockSpec,
  buildConfigs: buildConfigs, importState: importState, stable: stable
};
