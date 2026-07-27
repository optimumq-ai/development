'use strict';
// PHASE 7 / WS3 — CLOCK-MATRIX RECONCILIATION.
//
// WS1 imported the Phase-6 clock matrix verbatim: ten NAMED TIMERS per state, each carrying its statutory
// rules, a parsed duration where the clock_spec had a number, and a `present` flag. That is research. This
// module turns it into ENGINE CONFIG — `jurisdiction_rules` domain `deadline`, whose `clocks` keys are the
// `request_clocks.clock_type` values the tolling engine already runs on.
//
// ══ THE FOUR KINDS, and why one flag is not enough ══
//
// Before WS3 a clock was a clock: a label, a duration, a basis. That vocabulary cannot express the
// difference between "Texas must ask the Attorney General within 10 business days" and "the requestor has
// 60 days to collect the records", and it has no way at all to say "this state's production duty is
// 'promptly' and the 10-day number on your screen is your own service target, not the law." Every one of
// those rendered identically as a deadline, and a UI that calls a city target "the legal deadline"
// misstates the law to the citizen reading it.
//
//   response            a base statutory response / production deadline. The only kind that may be
//                       PRIMARY (the request's legal due date). configIntegrity polices it hardest —
//                       1..45 days — because this is where a 77-day probe value once lived.
//   agency_action       a hard statutory duty on the agency that is NOT the response deadline: the AG
//                       referral, the AG briefing, a certification of delay. Real, dated, enforceable.
//   requestor_window    a window belonging to the REQUESTOR — 61 days to answer a clarification, 60 days
//                       to collect. Long by nature; lapsing is an outcome the agency ACTS on (withdrawn),
//                       not a duty the agency missed.
//   operational_target  NOT A LEGAL DEADLINE (pattern S-002). Either the statute states a duty with no
//                       number ("promptly", "within a reasonable period of time") or it states none at
//                       all. The city sets a service target so My Tasks can age the work. It can never be
//                       primary, and everything that renders it must say what it is.
//
// ══ EXPOSURE IS NOT A CLOCK ══
//
// Texas § 552.302: miss the 10-business-day AG deadline and the information is PRESUMED PUBLIC. Sixteen
// states have the mirror-image deemed-denial rule. It is tempting to model those as timers, and it is
// wrong: the system's job is to respond in time, not to run a countdown to its own default. A deemed
// consequence is recorded against the duty clock it hangs off as an `exposure` — surfaced as a WARNING on
// that clock's status, never a separate clock, never a task, never a due date of its own.
//
// ══ WHAT IT WILL NOT DO ══
//
// A timer whose statutes produce more distinct durations than this module has named slots for is reported
// UNRESOLVED, not squeezed into an invented clock name. Same discipline as the Phase-6 generator: fail
// loud rather than guess, because a guessed clock is a wrong date on a citizen's letter.
var JR = require('./jurisdictionRules');

var DOMAIN = 'clock_matrix';
var DEADLINE_DOMAIN = 'deadline';

var KINDS = ['response', 'agency_action', 'requestor_window', 'operational_target'];

// A rule's `clock_effect`, classified. Duty rules become clocks; terminal rules become either a clock (on
// a requestor window — the lapse is the point of the window) or an exposure (on an agency duty — the lapse
// is what the agency suffers). Tolling effects describe how an existing clock behaves and never create one.
var DUTY_EFFECTS = { 'sets-deadline': 1, 'deadline': 1 };
var TERMINAL_EFFECTS = { 'terminal': 1 };
var TOLL_EFFECTS = { 'tolls': 1, 'pauses': 1, 'pause': 1, 'restarts': 1 };

// ---------------------------------------------------------------------------------------------------
// THE NAMED-TIMER TAXONOMY. Ten template timers -> the clock_type vocabulary the engine runs on.
//
// `slots` are filled by ASCENDING DURATION, so a timer that yields two statutory durations lands them in
// a stable, meaningful order (Texas: the 10-business-day AG referral, then the 15-business-day briefing).
// Existing clock_type names are REUSED where the engine already has one — `respond` and `ag_ruling` are
// live keys with live rows, and inventing a synonym for them would give one duty two clocks.
// ---------------------------------------------------------------------------------------------------
var TIMERS = {
  acknowledgment: {
    duty: 'agency', startOn: 'intake', target: true,
    slots: [{ key: 'acknowledge', label: 'Acknowledge receipt', kind: 'agency_action' }]
  },
  initial_decision: {
    duty: 'agency', startOn: 'intake', target: true,
    slots: [{ key: 'respond', label: 'Determine & respond', kind: 'response', primary: true }]
  },
  completion: {
    duty: 'agency', startOn: 'intake', target: true,
    slots: [
      { key: 'complete', label: 'Complete / produce', kind: 'response', primary: true },
      { key: 'certify_delay', label: 'Certify a production delay', kind: 'agency_action' }
    ]
  },
  denial_deadline: {
    duty: 'agency', startOn: 'intake', target: false,
    // NOT a `response` clock, and this is a decision the codebase already made once: seed_deadline_rules.js
    // refuses to seed Connecticut because "the 4 business days is the deadline for a DENIAL, not for
    // production. Modelling any of those as a `respond` (produce) clock would report FALSE LATENESS." A
    // denial deadline binds only if you are denying; it is a real, dated agency duty and it is not the
    // date by which the request must be answered.
    slots: [{ key: 'deny', label: 'Issue the denial', kind: 'agency_action' }]
  },
  ag_referral: {
    duty: 'agency', startOn: 'demand', target: false,
    slots: [
      { key: 'ag_ruling', label: 'Request AG ruling', kind: 'agency_action' },
      { key: 'ag_submission', label: 'Submit briefing to the Attorney General', kind: 'agency_action' }
    ]
  },
  clarification_response: {
    duty: 'requestor', startOn: 'demand', target: false,
    slots: [{ key: 'clarification_window', label: 'Requestor response to a clarification', kind: 'requestor_window' }]
  },
  nonpayment_close: {
    duty: 'requestor', startOn: 'demand', target: false,
    slots: [{ key: 'nonpayment_window', label: 'Requestor payment / collection window', kind: 'requestor_window' }]
  },
  special_windows: {
    duty: 'agency', startOn: 'demand', target: false,
    slots: [{ key: 'special_window', label: 'Special-record window', kind: 'agency_action' }]
  },
  // Not clocks. An extension GROWS the response clock's duration (see tolling.extend) and a suspension
  // PAUSES it — neither is a countdown of its own, and modelling them as one is how you get a due date
  // that moves for the wrong reason.
  extension: { duty: 'agency', slots: [], extensionOf: true },
  suspension: { duty: 'agency', slots: [], suspensionOf: true }
};

// The primary clock, in preference order: the request-level answer date beats the production date. Only a
// `response`-kind clock with a real statutory duration is eligible, which is why `deny` is not on this
// list — Utah's initial-decision window is unresolved (its statutes disagree, 5 vs 10 business days), and
// with `deny` eligible its 5-business-day DENIAL deadline would quietly have become the due date on every
// Utah request, including the ones nobody is denying.
var PRIMARY_PREFERENCE = ['respond', 'complete'];

// RULE-ID-LEVEL SLOT OVERRIDES — the same auditable, rerunnable device the Phase-6 pipeline uses for
// rule-homing (alignment/build_master_dictionary.js RULE_OVERRIDES).
//
// TX-0009 is the one case in the researched set where ascending-duration assignment gets it wrong. It is
// the ONLY numeric rule under Texas's `completion` timer, so the generic rule would make it slot 1 and
// declare a 10-business-day statutory production deadline for Texas. Texas has no such deadline: its
// production duty is § 552.221(a)-(b) "promptly ... within a reasonable time", undefined-soft. § 552.221(d)
// is a CHECKPOINT INSIDE that duty — if you cannot produce within 10 business days you must certify that
// in writing and give a date. Getting this wrong would put a fabricated statutory deadline on Texas
// requests, which is the same class of error as the 77-day clock configIntegrity was written to catch.
var SLOT_OVERRIDES = {
  'TX-0009': 'certify_delay'
};

function uniqSorted(a) { var s = {}; (a || []).forEach(function (x) { if (x) s[x] = 1; }); return Object.keys(s).sort(); }

// ---------------------------------------------------------------------------------------------------
// Reconciliation — pure. Takes the imported clock_matrix config object, returns clocks + everything that
// did not become one. No DB, no clock, no randomness, so the same matrix always yields the same config.
// ---------------------------------------------------------------------------------------------------
function reconcile(matrix, opts) {
  opts = opts || {};
  var out = { clocks: {}, targets: [], exposures: [], tolling: [], unresolved: [], suspension: null, extension: null };
  var timers = (matrix && matrix.timers) || {};
  var candidates = [];

  Object.keys(TIMERS).forEach(function (name) {
    var spec = TIMERS[name];
    var t = timers[name];
    if (!t) { out.unresolved.push({ timer: name, why: 'the imported clock matrix does not carry this timer' }); return; }

    // Index the statutory rules by id so a parsed entry can be described with its authority.
    var byId = {};
    Object.keys(t.concepts || {}).forEach(function (c) {
      (t.concepts[c] || []).forEach(function (r) { byId[r.rule_id] = { concept: c, authority: r.authority, summary: r.summary }; });
    });
    var describe = function (p) {
      var m = byId[p.rule_id] || {};
      return { rule_id: p.rule_id, authority: m.authority || null, concept: m.concept || null, days: p.days, basis: p.basis, effect: p.effect };
    };

    var parsed = t.parsed || [];
    var duties = parsed.filter(function (p) { return DUTY_EFFECTS[p.effect] && !p.soft && p.days != null && p.basis; });
    var softDuties = parsed.filter(function (p) { return DUTY_EFFECTS[p.effect] && p.soft; });
    var terminals = parsed.filter(function (p) { return TERMINAL_EFFECTS[p.effect]; });
    var tolls = parsed.filter(function (p) { return TOLL_EFFECTS[p.effect]; });

    tolls.forEach(function (p) { out.tolling.push(Object.assign({ timer: name }, describe(p))); });

    // A requestor window's terminal rule IS the window — that lapse is the whole point of running it.
    // An agency duty's terminal rule is an EXPOSURE, and exposures never become clocks.
    if (spec.duty === 'requestor') {
      terminals.forEach(function (p) { if (p.days != null && p.basis) duties.push(p); });
    } else {
      terminals.forEach(function (p) { out.exposures.push(Object.assign({ timer: name, warningOnly: true }, describe(p))); });
    }

    if (spec.suspensionOf && parsed.length) { out.suspension = { timer: name, rules: parsed.map(describe) }; }
    if (spec.extensionOf && parsed.length) { out.extension = { timer: name, rules: parsed.map(describe) }; }
    if (!spec.slots.length) return;

    // Group by (days, basis) — several sections of the same statute commonly set the SAME deadline
    // (Texas has four rules at 10 business days), and that is one clock, not four.
    var groups = {};
    duties.forEach(function (p) {
      var k = p.days + ':' + p.basis;
      (groups[k] = groups[k] || { days: p.days, basis: p.basis, rules: [] }).rules.push(p);
    });

    // Pull out anything a rule-id override assigns to a named slot before ordering the rest.
    var assigned = {}, remaining = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      var ov = null;
      g.rules.forEach(function (p) { if (SLOT_OVERRIDES[p.rule_id]) ov = SLOT_OVERRIDES[p.rule_id]; });
      if (ov) { assigned[ov] = g; } else { remaining.push(g); }
    });
    remaining.sort(function (a, b) { return a.days - b.days || (a.basis < b.basis ? -1 : 1); });

    var free = spec.slots.filter(function (s) { return !assigned[s.key]; });
    if (remaining.length > free.length) {
      out.unresolved.push({
        timer: name,
        why: remaining.length + ' distinct statutory durations (' +
             remaining.map(function (g) { return g.days + ' ' + g.basis; }).join(', ') + ') but only ' +
             free.length + ' named slot(s). Name the extra duty in TIMERS rather than letting it be guessed.'
      });
      return;
    }
    free.forEach(function (s, i) { if (remaining[i]) assigned[s.key] = remaining[i]; });

    spec.slots.forEach(function (s) {
      var g = assigned[s.key];
      if (!g) return;
      out.clocks[s.key] = {
        label: s.label, kind: s.kind, timer: name, duty: spec.duty,
        basis: g.basis, duration: g.days,
        startOn: spec.startOn,
        primary: false, // decided once, below — a state can have only one
        tollReasons: (opts.tollReasons || []).slice(),
        citation: uniqSorted(g.rules.map(function (p) { return (byId[p.rule_id] || {}).authority; })).join('; ').slice(0, 500),
        source_rule_ids: uniqSorted(g.rules.map(function (p) { return p.rule_id; }))
      };
    });

    // Remember what this timer needs for the service-target pass below — it cannot be decided here,
    // because `initial_decision` and `completion` compete for the same target and only one should win.
    if (spec.target && !out.clocks[spec.slots[0].key]) {
      candidates.push({ timer: name, spec: spec, present: !!t.present, softDuties: softDuties.slice() });
    }
  });

  // ---- THE SOFT STANDARD (S-002). Two shapes, one outcome: a target, not a deadline.
  //   present:true  + no number -> the statute states a DUTY with no time ("promptly")
  //   present:false             -> the statute states no duty at all
  //
  // ONE RESPONSE-FAMILY TARGET PER STATE. `initial_decision` and `completion` both fill a `response`
  // slot, and a state that resolved neither would otherwise get two service targets for one duty — the
  // operator would be pacing the same work twice. The stated-but-undefined duty wins where there is one,
  // because that is the obligation the state actually imposes: Texas has no separate initial-decision
  // window (its clock IS the production clock, § 552.221(a)-(b) "promptly"), and Ohio is the mirror
  // image — a stated initial-decision duty, "within a reasonable period of time", and nothing else.
  var RESPONSE_FAMILY = { initial_decision: 1, completion: 1 };
  var famChosen = null;
  candidates.filter(function (c) { return RESPONSE_FAMILY[c.timer]; })
    .forEach(function (c) { if (!famChosen || (c.present && !famChosen.present)) famChosen = c; });
  candidates.forEach(function (c) {
    if (RESPONSE_FAMILY[c.timer] && c !== famChosen) return;
    var slot = c.spec.slots[0];
    out.clocks[slot.key] = {
      label: slot.label + ' (service target)',
      kind: 'operational_target', timer: c.timer, duty: c.spec.duty,
      // NOT A LEGAL DEADLINE. There is no statutory number to import, so there is no number here: the
      // city supplies one. A default invented at import time would be indistinguishable, on screen,
      // from a statute — which is precisely pattern S-002's failure mode.
      basis: 'business_days', duration: null,
      // `none` keeps startClocksForRequest from creating a countdown with no agreed length.
      startOn: 'none', primary: false, configured: false,
      operational_target: true,
      note: c.present
        ? 'This state states the duty but sets no time limit (' +
          (c.softDuties[0] ? c.softDuties[0].rule_id + ': ' : '') +
          'undefined-soft). Set a city service target — it paces My Tasks and is NOT a legal deadline.'
        : 'This state sets no statutory timer here at all. A city service target may be set for work ' +
          'pacing; it is NOT a legal deadline and must never be presented as one.',
      source_rule_ids: uniqSorted(c.softDuties.map(function (p) { return p.rule_id; }))
    };
    out.targets.push({ timer: c.timer, clock: slot.key, statutoryDutyPresent: c.present });
  });

  // ---- exactly one primary, and only a real statutory response clock may be it.
  for (var i = 0; i < PRIMARY_PREFERENCE.length; i++) {
    var k = PRIMARY_PREFERENCE[i];
    var c = out.clocks[k];
    if (c && c.kind === 'response' && c.duration != null) { c.primary = true; out.primary = k; break; }
  }
  if (!out.primary) {
    out.noPrimary = 'No statutory response deadline resolved. This state\'s response duty is a soft ' +
      'standard, so any due date shown for it is a CITY SERVICE TARGET — never describe it to a requestor ' +
      'as the deadline the law sets.';
  }
  return out;
}

// The `deadline` domain config for a jurisdiction, built from its imported clock matrix. Shape is the
// existing one (configIntegrity policices these five keys and nothing else): version/note/weekend/
// holidays/clocks.
function deadlineConfig(matrix, opts) {
  opts = opts || {};
  var r = reconcile(matrix, opts);
  var clocks = {};
  Object.keys(r.clocks).sort().forEach(function (k) { clocks[k] = r.clocks[k]; });
  // Exposures ride on the duty clock they hang off — warning-only, never their own countdown.
  r.exposures.forEach(function (e) {
    var owner = null;
    Object.keys(clocks).forEach(function (k) { if (clocks[k].timer === e.timer && !owner) owner = k; });
    if (!owner) return;
    (clocks[owner].exposures = clocks[owner].exposures || []).push({
      rule_id: e.rule_id, authority: e.authority, days: e.days, basis: e.basis,
      effect: e.effect, warningOnly: true
    });
  });
  return {
    config: {
      version: 1,
      note: 'Reconciled from the Phase-6 clock matrix (WS3). Kinds: response = the legal due date; ' +
            'agency_action = a hard statutory duty that is not the response deadline; requestor_window = ' +
            'a window belonging to the requestor; operational_target = a CITY SERVICE TARGET and NOT a ' +
            'legal deadline (S-002). Deemed-denial / deemed-disclosure consequences are recorded as ' +
            '`exposures` on the duty they hang off — warnings, never clocks. ' +
            (r.noPrimary || ('Primary clock: ' + r.primary + '.')) +
            ' Holiday set inherited at reconciliation time — VERIFY it against the state calendar before ' +
            'relying on business-day arithmetic.',
      weekend: [0, 6],
      holidays: (opts.holidays || []).slice(),
      clocks: clocks
    },
    report: r
  };
}

// Read a jurisdiction's imported matrix and reconcile it. Null when the state has never been imported.
async function forJurisdiction(jid, opts) {
  opts = opts || {};
  if (!jid) jid = await JR.activeJid();
  var matrix = null;
  try { matrix = jid ? await JR.read(jid, DOMAIN) : null; } catch (e) { matrix = null; }
  if (!matrix || !matrix.timers) return null;
  if (!opts.holidays) {
    var cur = null;
    try { cur = await JR.read(jid, DEADLINE_DOMAIN); } catch (e) {}
    opts.holidays = (cur && Array.isArray(cur.holidays)) ? cur.holidays : [];
  }
  return deadlineConfig(matrix, opts);
}

// ---- helpers the engine and the UI read -----------------------------------------------------------

// A clock definition's kind, defaulting to `response`. THE DEFAULT MATTERS: every config written before
// WS3 carries no `kind`, and treating those as `response` keeps configIntegrity's tight 1..45 band — the
// band that catches a 77 — applied to exactly the clocks it was written for.
function kindOf(def) {
  var k = def && def.kind;
  return KINDS.indexOf(k) >= 0 ? k : 'response';
}
function isOperationalTarget(def) { return kindOf(def) === 'operational_target' || !!(def && def.operational_target); }
// Is this clock a LEGAL deadline the agency can be judged against? A service target is not, and neither
// is a window that belongs to the requestor.
function isLegalDeadline(def) { var k = kindOf(def); return k === 'response' || k === 'agency_action'; }

module.exports = {
  DOMAIN: DOMAIN, KINDS: KINDS, TIMERS: TIMERS, SLOT_OVERRIDES: SLOT_OVERRIDES,
  PRIMARY_PREFERENCE: PRIMARY_PREFERENCE,
  reconcile: reconcile, deadlineConfig: deadlineConfig, forJurisdiction: forJurisdiction,
  kindOf: kindOf, isOperationalTarget: isOperationalTarget, isLegalDeadline: isLegalDeadline
};
