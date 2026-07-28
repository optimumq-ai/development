'use strict';
// PHASE 7 / WS2 — THE STATE BRANCH PROFILE, as the engine reads it.
//
// The Phase-6 research says 25 things about a state's workflow that are on/off rather than a value: does
// this state have an AG-referral band? a third-party notice duty? a website-referral answer? an
// eligibility gate? WS1 imported that profile into `jurisdiction_rules` domain `branches`. This module
// is how the engine asks about it, and it exists so that no engine code ever has to know a node id like
// `Denial.agclk`.
//
// CAPABILITIES, NOT NODES. The diagram's node ids are a research artifact. What the engine needs is a
// small vocabulary of things a request can DO — `ag_referral`, `third_party_notice`, `custodian_referral`
// — each backed by the branch nodes that switch it on. Adding a node to a band is then a one-line change
// here rather than a hunt through routes.
//
// ══ THE FALLBACK RULE, and it is the whole safety story ══
//
// `isActive()` returns THREE values: true, false, and **null for "this jurisdiction has no branch
// profile"**. Nineteen of the twenty seeded jurisdictions have never been imported, and the engine must
// behave for them exactly as it did before this module existed.
//
// So every gate in the engine is written as `blocked()` — which is true ONLY for an explicit `false`.
// An unknown capability is never suppressed. WS2 can therefore only ever REMOVE work that a state's own
// research says cannot happen there; it can never invent a restriction out of a missing config. A
// silently-restrictive default here would strand live requests in cities nobody has researched yet.
var JR = require('./jurisdictionRules');

var DOMAIN = 'branches';

// capability -> the branch nodes that switch it on. A capability is ACTIVE if ANY of its nodes is active:
// the nodes of a band are the steps within it, and the band exists as soon as the state has any of them.
//
// `wired` is deliberately explicit, and it says which capabilities the engine actually ACTS on today:
// `ag_referral` (WS2 — the AG band owns the `ag_review` stage and its legal_review task) and the two
// approval modules (WS4 — the outer switch on the discretionary waiver / commercial programs). The rest
// are steps in the Phase-6 flow design that the engine does not model yet — there is no
// third-party-notice object to suppress — so here they are READ-ONLY facts: correct, queryable, and
// consumed by later workstreams and the processing UI as those get built. A table that implied the
// profile enforces fourteen things when it enforces three would be the more comfortable lie and the more
// expensive one.
var CAPABILITIES = {
  ag_referral: {
    label: 'Attorney-General referral band',
    nodes: ['Denial.dag', 'Denial.dprev', 'Denial.ag1', 'Denial.agclk', 'Denial.agnot', 'Denial.agwait', 'Denial.agdec', 'Denial.agrel'],
    gates: 'The `ag_review` stage and its legal_review task. In a pre-clearance state (TX) this band ' +
           'REPLACES staff denial; where it is inactive (OH) the stage does not exist at all.',
    wired: true
  },
  eligibility_gate: {
    label: 'Requester-eligibility gate',
    nodes: ['Master.g2'],
    gates: 'Whether intake evaluates requester class / residency / identity / purpose at all. See eligibilityGate.js.',
    wired: false
  },
  custodian_referral: {
    label: 'Referral to the proper custodian',
    nodes: ['Master.br'],
    gates: 'The "not ours -> proper custodian" answer.',
    wired: false
  },
  fee_waiver: {
    label: 'Fee-waiver program',
    nodes: ['Master.s1', 'Estimate-Fee.dwv', 'Estimate-Fee.wrev'],
    gates: 'Whether the state HAS a statutory waiver at all. WS4 reads it as the OUTER switch on the ' +
           'discretionary program: a state whose research says it has no waiver cannot have a ' +
           'discretionary one, whatever the city toggle says. It still does not suppress the task blindly ' +
           '— services/approvalModules.js decides that, and a mandatory statutory category fires either way.',
    wired: true
  },
  commercial_rate: {
    label: 'Commercial-rate classification',
    nodes: ['Master.s2'],
    gates: 'Commercial classification at intake (NJ/IL clock effects). Read by approvalModules.config() as ' +
           'the outer switch on the commercial-rate module.',
    wired: true
  },
  third_party_notice: {
    label: 'Third-party notice / proprietary claim',
    nodes: ['Redaction.tp'],
    gates: 'The third-party notice step inside redaction.',
    wired: false
  },
  website_referral: {
    label: 'Website posting satisfies the request',
    nodes: ['Records-Search.web'],
    gates: 'The "it is already published, here is the link" answer during record search.',
    wired: false
  },
  special_records: {
    label: 'Special-record regimes',
    nodes: ['Records-Search.spec'],
    gates: 'Court / election / law-enforcement special handling.',
    wired: false
  },
  programming_loop: {
    label: 'Programming / data-compilation loop',
    nodes: ['Records-Search.prog'],
    gates: 'The TX programming-and-manipulation path (no general duty to create).',
    wired: false
  },
  clarification_denial: {
    label: 'Vagueness is itself a denial ground',
    nodes: ['Clarification.deny'],
    gates: 'Whether a vague request can be denied rather than only clarified (TN/NJ/OH/OK).',
    wired: false
  },
  clarification_toll: {
    label: 'Clarification tolls the response clock',
    nodes: ['Clarification.d2'],
    gates: 'Advisory to the clock engine; the clarification POLICY still governs (its own enabled flag).',
    wired: false
  },
  release_hold: {
    label: 'Production conditioned on payment',
    nodes: ['Disposition.hold'],
    gates: 'Holding delivery until the balance is paid.',
    wired: false
  },
  collect_at_end: {
    label: 'Collect at the end rather than prepay',
    nodes: ['Estimate-Fee.proc'],
    gates: 'Advisory: this state does not make prepayment statutory. Does not gate a stage.',
    wired: false
  },
  delivery_caps: {
    label: 'Delivery-volume caps / recurrent-requester tracks',
    nodes: ['Disposition.caps'],
    gates: 'The requestor-ledger triggers. WS5.',
    wired: false
  }
};

// The stages a branch profile can suppress. Deliberately short: a stage only appears here when a state's
// research can say the state does not have it AT ALL. `awaiting_payment` is NOT here — `collect_at_end`
// says a state does not make prepayment statutory, which is a long way from "this city never invoices".
var STAGE_CAPABILITY = { ag_review: 'ag_referral' };

function nodeMap(cfg) {
  var out = {};
  Object.keys((cfg && cfg.branches) || {}).forEach(function (k) { out[k] = cfg.branches[k].active === true; });
  return out;
}

// The whole profile for a jurisdiction. `imported` false = no branch row, and every capability is null.
async function profile(jid) {
  if (!jid) jid = await JR.activeJid();
  var cfg = null;
  try { cfg = jid ? await JR.read(jid, DOMAIN) : null; } catch (e) { cfg = null; }
  var imported = !!(cfg && cfg.branches);
  var nodes = nodeMap(cfg);
  var caps = {};
  Object.keys(CAPABILITIES).forEach(function (c) {
    if (!imported) { caps[c] = null; return; }
    var known = CAPABILITIES[c].nodes.filter(function (n) { return Object.prototype.hasOwnProperty.call(nodes, n); });
    // A capability whose nodes this template does not carry is UNKNOWN, not off — the same reasoning as a
    // missing profile, one level down.
    caps[c] = known.length ? known.some(function (n) { return nodes[n]; }) : null;
  });
  return { jurisdictionId: jid, imported: imported, nodes: nodes, capabilities: caps };
}

// true | false | null (unknown — no profile, or the template does not carry this capability's nodes).
async function isActive(jid, capability) {
  if (!CAPABILITIES[capability]) throw new Error('Unknown branch capability: ' + capability);
  var p = await profile(jid);
  return p.capabilities[capability];
}

// THE GATE every caller should use. True only for an explicit false — see the fallback rule in the header.
async function blocked(jid, capability) {
  return (await isActive(jid, capability)) === false;
}

// Is this STAGE unavailable in this jurisdiction? Unknown stages and un-gated stages are never blocked.
async function stageBlocked(jid, stage) {
  var cap = STAGE_CAPABILITY[stage];
  if (!cap) return false;
  return await blocked(jid, cap);
}

// The stage vocabulary this jurisdiction actually has. Used by the API so the UI never offers an advance
// into a stage the state's law does not contain.
async function stagesFor(jid) {
  var stages = require('./stages').STAGES;
  var out = [];
  for (var i = 0; i < stages.length; i++) {
    if (!(await stageBlocked(jid, stages[i].key))) out.push(stages[i]);
  }
  return out;
}

// A one-line reason for a refusal, so an operator is told WHY rather than just "no".
function reason(capability) {
  var c = CAPABILITIES[capability];
  return c ? (c.label + ' is not part of this state\'s workflow (the imported branch profile has it off). ' + c.gates)
           : 'This step is not part of this state\'s workflow.';
}

module.exports = {
  DOMAIN: DOMAIN, CAPABILITIES: CAPABILITIES, STAGE_CAPABILITY: STAGE_CAPABILITY,
  profile: profile, isActive: isActive, blocked: blocked,
  stageBlocked: stageBlocked, stagesFor: stagesFor, reason: reason
};
