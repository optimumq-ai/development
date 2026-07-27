'use strict';
// PHASE 7 / WS2 — THE REQUESTER-ELIGIBILITY GATE.
//
// Six dimensions, not thirty-two state exceptions. Residency (AL · ID · VA · TN · PA), identity, purpose,
// requester class, incarceration, and the vexatious-litigator gate are CONFIG DIMENSIONS: the same gate
// with different settings, not per-state code. Alabama is a residency gate, not a "show ID" state, and
// modelling it as the latter is how a config dimension turns into a per-state fork.
//
// WS1 imported which dimensions a state's statutes touch (jurisdiction_rules domain `eligibility`,
// `dimensions[*].gated` + the rule ids behind it). This module decides what the engine DOES about it.
//
// ══ IT DOES NOT BLOCK ANYONE UNTIL A HUMAN SAYS SO ══
//
// "This state's statute mentions residency" is not "refuse this citizen's request." Turning imported
// evidence straight into a rejection would be the automated-but-non-compliant trade this project has
// refused, and it fails in the worst direction: a wrongly-refused request is a denial of a statutory
// right, and the citizen has no way to tell it from a bug.
//
// So a dimension blocks only when ALL of these hold:
//   1. `gated`     — the state's statutes actually reach this dimension (imported evidence), AND
//   2. `confirmed` — a human reviewed it (the same confirmation that releases the profile section), AND
//   3. `action: 'block'` — the city chose to refuse rather than flag, AND
//   4. the requester actually fails the check on the facts submitted.
//
// Anything short of all four produces an ADVISORY: recorded on the request, surfaced to intake staff,
// and otherwise inert. Freshly imported states are therefore advisory-only by construction — which is
// exactly the acceptance criterion "the eligibility gate blocks only where configured."
//
// The stored config is never rewritten to add these fields: `normalizeDimension` supplies the defaults at
// READ time, so WS1's imported rows stay valid and there is no migration.
var JR = require('./jurisdictionRules');
var BP = require('./branchProfile');

var DOMAIN = 'eligibility';

// advise      — record it, let the request through (the default, and the only safe import-time value)
// route_review — let it through but make a human look before it moves on
// block       — refuse at intake
var ACTIONS = ['advise', 'route_review', 'block'];

// dimension -> how a submitted request is tested against it. `field` is the requester fact that answers
// the question; `missing` says what to do when the submission simply does not carry that fact, which is
// the normal case for a portal that has not been asked to collect it yet.
var DIMENSIONS = {
  residency: {
    label: 'Residency',
    field: 'residency',
    help: 'AL · ID · VA · TN · PA restrict to residents (or to residents plus enumerated classes). ' +
          'The gate is "is this requester in the class the statute admits", NOT "show identification".',
    test: function (v) { return v === 'resident' || v === true; }
  },
  identity: {
    label: 'Identity',
    field: 'identityVerified',
    help: 'Whether the requester must be identified at all. Most states forbid requiring it; where a state ' +
          'permits it, an anonymous request is still a request until the city says otherwise.',
    test: function (v) { return v === true; }
  },
  purpose: {
    label: 'Stated purpose',
    // ⚠ FIELD COLLISION, for whoever wires the portal. `requests.purpose` already exists and means
    // something else — a processing track that defaults to 'standard'. If the submission form is ever
    // wired to send that column's value here, every requester in a purpose-gating state passes without
    // having stated anything. The failure is in the SAFE direction (nobody is wrongly refused), which is
    // exactly why it would go unnoticed. Give this dimension its own field before enforcing it anywhere.
    field: 'purpose',
    help: 'Nearly every state forbids asking. Where a state conditions access on purpose or certification, ' +
          'this is that condition — never a general "why do you want it?".',
    test: function (v) { return !!v && String(v).trim().length > 0 && String(v) !== 'standard'; }
  },
  requester_class: {
    label: 'Requester class',
    field: 'requesterClass',
    help: 'Class restrictions and their discretionary out-of-class release, plus record-subject self-access.',
    test: function (v) { return !!v; }
  },
  incarceration: {
    label: 'Incarcerated requester',
    field: 'incarcerated',
    // The test is INVERTED relative to the others: the statute EXCLUDES this class, so failing means
    // being in it. TX § 552.028 is the model.
    inverted: true,
    help: 'TX § 552.028 and its analogues: the body need not comply with a request from a confined person ' +
          '(their attorney is not excluded). An exclusion, so the check passes when the flag is absent.',
    test: function (v) { return v !== true; }
  },
  vexatious: {
    label: 'Vexatious-litigator gate',
    field: 'vexatiousLeave',
    help: 'OH R.C. 2323.52(J) (HB 265, eff. 2025-04-09): a vexatious litigator needs leave of court plus an ' +
          'order specifying the records. Requires an affirmative identity match — never a fuzzy one.',
    test: function (v) { return v === true; }
  }
};

function normalizeDimension(d, raw) {
  raw = raw || {};
  var action = ACTIONS.indexOf(raw.action) >= 0 ? raw.action : 'advise';
  return {
    dimension: d,
    label: DIMENSIONS[d].label,
    gated: raw.gated === true,
    confirmed: raw.confirmed === true,
    action: action,
    // Which requester classes the rule reaches. Empty = all.
    applies_to: Array.isArray(raw.applies_to) ? raw.applies_to.slice() : [],
    concepts: Array.isArray(raw.concepts) ? raw.concepts.slice() : [],
    source_rule_ids: Array.isArray(raw.source_rule_ids) ? raw.source_rule_ids.slice() : []
  };
}

// The effective gate config for a jurisdiction. Never throws: an unreadable config degrades to "no gate".
async function config(jid) {
  if (!jid) jid = await JR.activeJid();
  var cfg = null;
  try { cfg = jid ? await JR.read(jid, DOMAIN) : null; } catch (e) { cfg = null; }
  var dims = {};
  Object.keys(DIMENSIONS).forEach(function (d) { dims[d] = normalizeDimension(d, (cfg && cfg.dimensions || {})[d]); });
  return {
    jurisdictionId: jid,
    imported: !!(cfg && cfg._import),
    gateActive: !!(cfg && cfg.gate_active === true),
    dimensions: dims
  };
}

// Does this dimension reach this requester? An empty `applies_to` reaches everyone.
function reaches(dim, requester) {
  if (!dim.applies_to.length) return true;
  return dim.applies_to.indexOf((requester && requester.requesterClass) || '') >= 0;
}

// Evaluate a submission. Returns blocks (refuse), reviews (let through, flag for a human), and advisories
// (record only). `requester` carries whatever facts the submission actually holds; an absent fact is
// UNKNOWN, and unknown never blocks — it advises. Refusing a citizen because a portal field does not
// exist yet would be a defect wearing a compliance costume.
async function evaluate(jid, requester) {
  requester = requester || {};
  var cfg = await config(jid);
  var out = { jurisdictionId: cfg.jurisdictionId, gateActive: cfg.gateActive, blocked: false, blocks: [], reviews: [], advisories: [] };

  // The branch profile is the outer switch: a state whose g2 gate is off has no eligibility gate at all.
  // Unknown (un-imported) is NOT off — see branchProfile's fallback rule — so this only ever silences a
  // state that has actually been researched and come back "any person may request".
  if (await BP.blocked(cfg.jurisdictionId, 'eligibility_gate')) {
    out.gateOff = true;
    return out;
  }

  Object.keys(DIMENSIONS).forEach(function (d) {
    var dim = cfg.dimensions[d];
    if (!dim.gated || !reaches(dim, requester)) return;
    var spec = DIMENSIONS[d];
    var value = requester[spec.field];
    var known = value !== undefined && value !== null && value !== '';
    // An exclusion (incarceration) is answered by the ABSENCE of the flag, so "unknown" is a pass there
    // and only there.
    var passes = spec.inverted ? spec.test(value) : (known && spec.test(value));
    var item = {
      dimension: d, label: dim.label, action: dim.action, confirmed: dim.confirmed,
      known: known, passes: passes, source_rule_ids: dim.source_rule_ids,
      note: spec.help
    };
    if (passes) return;

    if (!dim.confirmed) {
      item.why = 'Imported from the state template but not yet confirmed by this city, so it advises only.';
      out.advisories.push(item);
      return;
    }
    if (dim.action === 'block' && known) {
      item.why = 'This city has confirmed the ' + dim.label.toLowerCase() + ' condition and chosen to refuse.';
      out.blocks.push(item);
      return;
    }
    if (dim.action === 'block' && !known) {
      // Configured to block, but the submission does not carry the fact. Refusing on an unasked question
      // is not a gate, it is a coin flip — send it to a human instead.
      item.why = 'Configured to refuse, but this submission does not say. Routed for a human decision ' +
                 'rather than refused on an unanswered question.';
      out.reviews.push(item);
      return;
    }
    if (dim.action === 'route_review') {
      item.why = 'This city has confirmed the condition and routes it for review.';
      out.reviews.push(item);
      return;
    }
    item.why = 'Confirmed, but set to advise only.';
    out.advisories.push(item);
  });

  out.blocked = out.blocks.length > 0;
  return out;
}

// A single plain-language sentence for a refusal, naming the statutes behind it. This text can reach a
// citizen, so it says what the condition is — never "you are not eligible" with no reason.
function refusalMessage(result) {
  var parts = (result.blocks || []).map(function (b) {
    return b.label.toLowerCase() + (b.source_rule_ids.length ? ' (' + b.source_rule_ids.join(', ') + ')' : '');
  });
  return 'This jurisdiction restricts who may make a public-records request, and this submission does not ' +
         'meet the condition on: ' + parts.join('; ') + '. If that is wrong, say so — a person will review it.';
}

module.exports = {
  DOMAIN: DOMAIN, DIMENSIONS: DIMENSIONS, ACTIONS: ACTIONS,
  config: config, evaluate: evaluate, refusalMessage: refusalMessage, normalizeDimension: normalizeDimension
};
