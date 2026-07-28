'use strict';
// PHASE 7 / WS4 — FEE-WAIVER & COMMERCIAL-RATE APPROVAL MODULES, v1.
//
// Implements docs/rules_research/workflow/DESIGN_fee_waiver_commercial.md, decided with Kevin
// 2026-07-26. That document is settled: this module encodes it, it does not re-open it. The v2
// criteria-based approver matrix ($ thresholds, requester class, owning department, ledger history) is
// explicitly deferred there and is not built here.
//
// Per module (`fee_waiver`, `commercial_rate`) a city configures three things:
//
//   enabled                on/off — governs the DISCRETIONARY program only (see the asymmetry below)
//   mode                   'intake_review'  the intake reviewer decides inline, no extra hop
//                          'routed_task'    a task is spawned to a designated role with a designated name
//   routed_task            { assignee_role, task_name } — only read in routed_task mode
//
// ══ THE ASYMMETRY THAT GOVERNS THIS WHOLE MODULE ══
//
// A statutorily MANDATORY waiver fires regardless of `enabled` — and, unlike every other Phase-7 gate,
// regardless of whether a human has confirmed it.
//
// That is the opposite of the eligibility gate (WS2), which refuses to block anyone until a human has
// confirmed the dimension, and the difference is deliberate. The two errors are not symmetric:
//
//   erring toward BLOCKING a requester      -> denies a statutory right; the citizen cannot tell it from a bug
//   erring toward GRANTING a mandatory waiver -> costs the city money it was probably not entitled to anyway
//
// Connecticut "shall waive" for an indigent requester (§ 1-212(d)); Michigan waives the first $20 on an
// indigency affidavit. Withholding those because nobody clicked a confirmation box would charge a
// citizen a fee the legislature forbade. So confirmation is TRACKED (it drives readiness and
// attestation) and it does not gate the grant.
//
// Mandatory does NOT mean automatic-on-request: it fires on VERIFIED EVIDENCE — the affidavit, the
// appointment letter, the certification the statute names. No evidence, no auto-grant; it falls through
// to the discretionary path like any other request.
//
// ══ SEQUENCING (design doc §Sequencing) ══
//
//   commercial_rate decides at INTAKE. It has to: New Jersey gives commercial requests a 14-business-day
//   window and Illinois a separate recurrent/commercial track, so the classification changes the deadline
//   and must land before the clock is quoted. Arizona additionally requires a purpose certification at
//   intake.
//   fee_waiver decides at ESTIMATE, and always BEFORE the estimate is communicated: compute -> decide ->
//   adjust -> send. A waiver is therefore resolved before any amount is invoiced, and the denial folds
//   into the estimate notice rather than becoming its own letter.
//
// Processing NEVER stops on a denial. A denied waiver goes to the ordinary estimate-acceptance gate,
// where the requester keeps control (proceed / narrow / withdraw). Nothing closes silently.
var JR = require('./jurisdictionRules');
var BP = require('./branchProfile');

var DOMAIN = 'approval_modules';
var MODULES = ['fee_waiver', 'commercial_rate'];
var MODES = ['intake_review', 'routed_task'];

// Roles the router can ACTUALLY deliver work to. A `routed_task` pointed at anything else spawns a task
// into an empty pool — the failure mode taskRouting's ROUTABLE_TASK_TYPES comment describes ("an entry
// here is a PROMISE that the router can deliver that type"), except this one would be silent: the waiver
// task exists, nobody is eligible, and the estimate is blocked behind it forever.
var ROUTABLE_ROLES = ['FINANCE', 'FEE_MANAGER', 'REQUEST_MANAGER', 'DENIAL_AND_LEGAL', 'ESCALATION_HANDLER'];

// ---------------------------------------------------------------------------------------------------
// STATUTORY-MANDATORY WAIVER CATEGORIES.
//
// Transcribed from DESIGN_fee_waiver_commercial.md §"Legal ground", which is itself the decided reading
// of the working rule set. Same device as WS1's SUGGESTED_DEFAULTS: a decided research document copied
// into code where it can be read, tested and cited — NOT prose re-parsed at runtime, and not a judgment
// this module makes for itself.
//
// `evidence` is what must be VERIFIED before the category fires. It is the whole safety mechanism: a
// category with no evidence on the request never auto-grants.
// ---------------------------------------------------------------------------------------------------
var MANDATORY_CATEGORIES = {
  CT: [
    { key: 'indigent', label: 'Indigent requester', evidence: 'indigency_affidavit', citation: 'Conn. Gen. Stat. § 1-212(d)' },
    { key: 'elected_official', label: 'Elected official', evidence: 'official_status', citation: 'Conn. Gen. Stat. § 1-212(d)' },
    { key: 'public_defender', label: 'Public-defender counsel', evidence: 'appointment_letter', citation: 'Conn. Gen. Stat. § 1-212(d)' }
  ],
  ID: [{ key: 'public_understanding', label: 'Public-understanding / cannot-afford test', evidence: 'indigency_affidavit', citation: 'Idaho Code § 74-102' }],
  MI: [
    { key: 'first_20', label: 'First $20 waived', evidence: 'indigency_affidavit', citation: 'MCL § 15.234(1)(a)' },
    { key: 'indigent', label: 'Indigent requester (affidavit)', evidence: 'indigency_affidavit', citation: 'MCL § 15.234(1)(a)' }
  ],
  AZ: [
    { key: 'us_claim', label: 'Records for a claim against the United States', evidence: 'claim_documentation', citation: 'A.R.S. § 39-121.01' },
    { key: 'crime_victim', label: 'Crime victim', evidence: 'victim_status', citation: 'A.R.S. § 39-121.01' }
  ],
  NV: [{ key: 'va_benefit', label: 'VA-benefit records', evidence: 'va_benefit_documentation', citation: 'NRS § 239.052' }],
  NJ: [{ key: 'crime_victim', label: 'Crime victim', evidence: 'victim_status', citation: 'N.J.S.A. 47:1A-5' }],
  SC: [{ key: 'legislator', label: 'Member of the General Assembly', evidence: 'official_status', citation: 'S.C. Code § 30-4-30' }],
  VA: [{ key: 'ferpa_parent', label: 'Parent under FERPA', evidence: 'parent_status', citation: 'Va. Code § 2.2-3704' }],
  OK: [{ key: 'public_interest_no_search_fee', label: 'No search fee on a public-interest release', evidence: 'public_interest_statement', citation: '51 O.S. § 24A.5' }],
  // TX is the HYBRID the design doc calls out: § 552.267(a) is a discretionary determination, but once the
  // body determines the copy primarily benefits the general public the waiver is mandatory. So it is not
  // seeded as an auto-firing category — there is no evidence a requester can supply that MAKES the
  // determination. It reaches the discretionary path, and once granted it binds.
  TX: []
};

// EACH MODULE DEFAULTS TO WHATEVER PRESERVES TODAY'S BEHAVIOUR, and the two differ.
//
// The reflex from WS1-WS3 is `enabled: false` — safe-manual, nothing acts until a city says so. That is
// right for a rule that ACTS ON a requester (tolls their clock, refuses their request). It is exactly
// wrong here. Today a requester who ticks "I request a fee waiver" gets a FINANCE approval task; the
// discretionary program is de facto ON in the shipped product. Defaulting it off would mean waiver
// requests silently stop reaching anyone — a duty dropped, invisibly, on every existing install.
//
//   fee_waiver       enabled: true, mode: routed_task  — reproduces the existing spawn EXACTLY: same task
//                                    type, same FINANCE role, same title. `mode` matters as much as
//                                    `enabled` here: defaulting to intake_review would have stopped that
//                                    task just as dead, one layer down, with the toggle still reading
//                                    "on". "Off" must be a city deciding it has no discretionary program,
//                                    never an accident of a default.
//   commercial_rate  enabled: false  preserves the existing behaviour too — NOTHING spawns commercial
//                                    work today. The `commercial_rate` task type was deleted on
//                                    2026-07-19 precisely because it pooled to nobody (taskRouting's
//                                    ROUTABLE_TASK_TYPES comment), so on is the change, not off. Its mode
//                                    defaults to intake_review: nothing existed to preserve, and inline is
//                                    the lighter of the two for a module a city is newly turning on.
//
// The branch profile still overrides both: a state whose research says it has no waiver program cannot
// have a discretionary one, whatever the toggle says.
function defaultsFor(mod) {
  return {
    enabled: mod === 'fee_waiver',
    mode: mod === 'fee_waiver' ? 'routed_task' : 'intake_review',
    routed_task: { assignee_role: mod === 'fee_waiver' ? 'FINANCE' : 'FINANCE', task_name: mod === 'fee_waiver' ? 'Decide fee-waiver request' : 'Decide commercial-rate classification' },
    // City policy, ⚠ config-not-law: no state requires a waiver-denial notice and none stops processing
    // on denial (design doc). The recommended default folds the denial into the estimate notice — one
    // communication that also satisfies the 13-state itemized-estimate duties, no new document type.
    denial_notice: 'fold_into_estimate'   // | 'separate_letter'
  };
}

function normalizeModule(mod, raw) {
  raw = raw || {};
  var d = defaultsFor(mod);
  var rt = raw.routed_task || {};
  var role = ROUTABLE_ROLES.indexOf(rt.assignee_role) >= 0 ? rt.assignee_role : d.routed_task.assignee_role;
  return {
    module: mod,
    // `undefined` means "never configured" and takes the module's own default (see defaultsFor). Reading
    // it as `=== true` would have made every unconfigured install fall to false — which for fee_waiver is
    // exactly the silent duty-drop the defaults exist to prevent.
    enabled: raw.enabled === undefined || raw.enabled === null ? defaultsFor(mod).enabled : raw.enabled === true,
    mode: MODES.indexOf(raw.mode) >= 0 ? raw.mode : d.mode,
    routed_task: {
      assignee_role: role,
      task_name: (typeof rt.task_name === 'string' && rt.task_name.trim()) ? rt.task_name.trim().slice(0, 120) : d.routed_task.task_name
    },
    denial_notice: ['fold_into_estimate', 'separate_letter'].indexOf(raw.denial_notice) >= 0 ? raw.denial_notice : d.denial_notice,
    // A role the router cannot deliver to is recorded rather than silently corrected — configIntegrity
    // reports it, so a city sees why its task would never have reached anyone.
    unroutableRole: (rt.assignee_role && ROUTABLE_ROLES.indexOf(rt.assignee_role) < 0) ? rt.assignee_role : null
  };
}

// Statutory-mandatory categories for a state, each carrying whatever the imported template says about
// `fee.waiver`. Read-time; nothing is written, so there is no migration and no drift.
async function mandatoryCategories(jid, code, stored) {
  var cats = (MANDATORY_CATEGORIES[String(code || '').toUpperCase()] || []).map(function (c) {
    var saved = ((stored || {})[c.key]) || {};
    return {
      key: c.key, label: c.label, evidence: c.evidence, citation: c.citation,
      // Confirmation is TRACKED for readiness. It does NOT gate the grant — see the asymmetry in the
      // header. A city that has not reviewed its mandatory categories still honours them.
      confirmed: saved.confirmed === true,
      source_rule_ids: Array.isArray(saved.source_rule_ids) ? saved.source_rule_ids.slice() : []
    };
  });
  // Attach the state's own fee.waiver evidence so a reviewer sees the rules behind the category list.
  if (cats.length) {
    try {
      var fw = await JR.read(jid, 'fee_waiver');
      var ids = (fw && fw.provenance && fw.provenance.grounds && fw.provenance.grounds.source_rule_ids) || [];
      cats.forEach(function (c) { if (!c.source_rule_ids.length) c.source_rule_ids = ids.slice(); });
    } catch (e) { /* evidence is a nicety; the category list is the fact */ }
  }
  return cats;
}

// The effective module configuration for a jurisdiction. Never throws.
async function config(jid) {
  if (!jid) jid = await JR.activeJid();
  var raw = null;
  try { raw = jid ? await JR.read(jid, DOMAIN) : null; } catch (e) { raw = null; }
  raw = raw || {};
  var code = null;
  try {
    var { get } = require('../db');
    var row = jid ? await get('SELECT code FROM jurisdiction_profiles WHERE id = ?', [jid]) : null;
    code = row && row.code;
  } catch (e) {}
  var out = { jurisdictionId: jid, code: code, modules: {} };
  for (var i = 0; i < MODULES.length; i++) {
    var m = MODULES[i];
    out.modules[m] = normalizeModule(m, raw[m]);
    // The branch profile is the outer switch: a state whose research says it has no waiver program (OH)
    // cannot have a discretionary one, whatever the toggle says. UNKNOWN is not off — nineteen seeded
    // jurisdictions have no profile and keep behaving as before (branchProfile's fallback rule).
    out.modules[m].branchAvailable = await BP.isActive(jid, m);
    if (out.modules[m].branchAvailable === false) out.modules[m].enabled = false;
  }
  out.mandatory = await mandatoryCategories(jid, code, raw.mandatory);
  return out;
}

async function write(jid, cfg, actor) {
  if (!jid) jid = await JR.activeJid();
  var clean = {};
  MODULES.forEach(function (m) {
    var n = normalizeModule(m, (cfg || {})[m]);
    if (n.unroutableRole) {
      throw new Error('Cannot route the ' + m + ' task to "' + n.unroutableRole + '": no one is eligible for that role, ' +
        'so the task would sit in an empty pool and block the estimate behind it. Allowed: ' + ROUTABLE_ROLES.join(', ') + '.');
    }
    clean[m] = { enabled: n.enabled, mode: n.mode, routed_task: n.routed_task, denial_notice: n.denial_notice };
  });
  clean.mandatory = {};
  Object.keys((cfg || {}).mandatory || {}).forEach(function (k) {
    var v = cfg.mandatory[k] || {};
    clean.mandatory[k] = { confirmed: v.confirmed === true, source_rule_ids: Array.isArray(v.source_rule_ids) ? v.source_rule_ids : [] };
  });
  return await JR.write(jid, DOMAIN, clean, actor || 'staff');
}

// ---------------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------------

// What evidence has this request actually verified? v1 reads an explicit, staff- or portal-set list; it
// does NOT infer indigency from free text. `verifiedEvidence` is an array of the evidence keys above.
function verifiedEvidence(request) {
  if (!request) return [];
  var e = request.verifiedEvidence || request.verified_evidence;
  if (Array.isArray(e)) return e.map(String);
  if (typeof e === 'string' && e.trim()) { try { var p = JSON.parse(e); return Array.isArray(p) ? p.map(String) : []; } catch (x) { return e.split(',').map(function (s) { return s.trim(); }).filter(Boolean); } }
  return [];
}

// THE WAIVER DECISION POINT (design doc: at estimate, before communication).
//
//   auto_granted    a mandatory category matched verified evidence. Fires regardless of `enabled`.
//   needs_decision  the discretionary program is on; route it per `mode`.
//   not_offered     the discretionary program is off (or the state has none). The request PROCEEDS —
//                   the requester is told, and nothing stops.
async function evaluateWaiver(jid, request, opts) {
  opts = opts || {};
  // `opts.config` lets one caller read the module config ONCE and use it for both decisions. Intake runs
  // on every single request, so a second identical read is pure latency on the front door.
  var cfg = opts.config || await config(jid);
  var mod = cfg.modules.fee_waiver;
  var out = {
    module: 'fee_waiver', enabled: mod.enabled, mode: mod.mode, branchAvailable: mod.branchAvailable,
    requested: !!(request && (request.fee_waiver_requested || request.feeWaiverRequested)),
    mandatoryFired: null, outcome: 'not_offered', route: null, reason: null
  };

  var have = verifiedEvidence(request).concat(opts.verifiedEvidence || []);
  var hit = cfg.mandatory.filter(function (c) { return have.indexOf(c.evidence) >= 0; })[0] || null;
  if (hit) {
    // Fires whether or not the discretionary program is enabled, and whether or not anyone confirmed the
    // category. See the asymmetry in the header — this is the one place in Phase 7 where unconfirmed
    // config still acts, because acting costs the city money and NOT acting costs a citizen a right.
    out.mandatoryFired = hit;
    out.outcome = 'auto_granted';
    out.reason = hit.label + ' — waived by statute (' + hit.citation + ') on verified ' + hit.evidence.replace(/_/g, ' ') + '.';
    return out;
  }

  if (!out.requested) { out.outcome = 'not_requested'; return out; }
  if (!mod.enabled) {
    out.outcome = 'not_offered';
    out.reason = mod.branchAvailable === false
      ? 'This state has no statutory fee-waiver program, so there is no discretionary waiver to decide. The request continues to the ordinary estimate.'
      : 'This city has not switched on its discretionary fee-waiver program. The request continues to the ordinary estimate.';
    return out;
  }
  out.outcome = 'needs_decision';
  out.route = mod.mode === 'routed_task'
    ? { mode: 'routed_task', assignee_role: mod.routed_task.assignee_role, task_name: mod.routed_task.task_name }
    : { mode: 'intake_review' };
  return out;
}

// THE COMMERCIAL DECISION POINT (design doc: at intake — clock effects lock the deadline).
//
// `declared` is what the requester said; `classified` is what the city concludes. Overriding a
// self-declaration is ALWAYS communicated, because it changes the invoice and can change the deadline.
async function evaluateCommercial(jid, request, opts) {
  opts = opts || {};
  var cfg = opts.config || await config(jid);
  var mod = cfg.modules.commercial_rate;
  var declared = (request && (request.purpose || request.requestorType || request.requestor_type)) || 'standard';
  var proposed = opts.classifyAs || null;
  var out = {
    module: 'commercial_rate', enabled: mod.enabled, mode: mod.mode, branchAvailable: mod.branchAvailable,
    declared: declared, classified: null, overridesDeclaration: false, mustCommunicate: false,
    outcome: 'not_offered', route: null, clockEffect: null
  };
  if (!mod.enabled) {
    out.reason = mod.branchAvailable === false
      ? 'This state has no statutory commercial rate, so there is nothing to classify.'
      : 'This city has not switched on commercial-rate classification.';
    return out;
  }
  // NJ (14-business-day commercial window) and IL (recurrent/commercial track) change the RESPONSE CLOCK
  // on classification. WS4 does not invent those durations — that is deadline config (WS3) — but it
  // reports that this state has a clock effect so nothing quotes a deadline before the classification
  // lands. Modelling the duration here would put a number on a citizen's letter from the wrong module.
  if (['NJ', 'IL'].indexOf(String(cfg.code || '').toUpperCase()) >= 0) {
    out.clockEffect = 'This state changes the response clock for commercial requests. Classify BEFORE quoting a deadline.';
  }
  out.classified = proposed || (declared === 'commercial' ? 'commercial' : null);
  out.overridesDeclaration = !!(proposed && proposed !== declared);
  out.mustCommunicate = out.overridesDeclaration;
  out.outcome = proposed ? 'classified' : 'needs_decision';
  out.route = mod.mode === 'routed_task'
    ? { mode: 'routed_task', assignee_role: mod.routed_task.assignee_role, task_name: mod.routed_task.task_name }
    : { mode: 'intake_review' };
  return out;
}

// Is the estimate allowed to be COMMUNICATED yet? The design's ordering constraint, enforced at the one
// place it matters: a requester must never receive an amount that a pending waiver decision could change.
// Returns { blocked, reason, code }.
async function estimateCommunicationGate(jid, request) {
  var requested = !!(request && request.fee_waiver_requested);
  var status = request && request.fee_waiver_status;
  if (!requested) return { blocked: false };
  if (status === 'granted' || status === 'denied') return { blocked: false };
  var cfg = await config(jid);
  var mod = cfg.modules.fee_waiver;
  // The program is off, so there is no decision coming and nothing to wait for. The requester is told in
  // the notice that the waiver was not available; processing does not stop.
  if (!mod.enabled) return { blocked: false, notOffered: true };
  return {
    blocked: true,
    code: 'WAIVER_UNDECIDED',
    reason: 'A fee waiver was requested and has not been decided. The estimate cannot be sent first — a ' +
            'waiver changes the amount, and a requester must not receive one figure and then another. ' +
            (mod.mode === 'routed_task'
              ? 'The "' + mod.routed_task.task_name + '" task (' + mod.routed_task.assignee_role + ') has to close first.'
              : 'Decide it inline at Intake Review first.')
  };
}

// The waiver paragraph that folds into the estimate notice (design doc: one communication, no new
// document type). Returns null when there is nothing to say.
function denialNoticeText(request, mod) {
  if (!request || request.fee_waiver_status !== 'denied') return null;
  if (mod && mod.denial_notice === 'separate_letter') return null;
  var reason = (request.fee_waiver_reason || '').trim();
  return 'You asked us to waive the fees for this request. We reviewed that request and were not able to ' +
         'grant it' + (reason ? ': ' + reason : '') + '. This does not stop your request — the estimate ' +
         'below stands, and you can proceed, narrow your request to reduce the cost, or withdraw it.';
}

module.exports = {
  DOMAIN: DOMAIN, MODULES: MODULES, MODES: MODES, ROUTABLE_ROLES: ROUTABLE_ROLES,
  MANDATORY_CATEGORIES: MANDATORY_CATEGORIES,
  defaultsFor: defaultsFor, normalizeModule: normalizeModule,
  config: config, write: write,
  verifiedEvidence: verifiedEvidence,
  evaluateWaiver: evaluateWaiver, evaluateCommercial: evaluateCommercial,
  estimateCommunicationGate: estimateCommunicationGate, denialNoticeText: denialNoticeText
};
