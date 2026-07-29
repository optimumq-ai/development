'use strict';
// PHASE 7 / BW2 — THE PROCESSING-UI CITY KNOBS (docs/SPEC_processing_ui.md §8, "Config knobs — new").
//
// Two settings, one `jurisdiction_rules` domain (`processing`), following the WS1/WS2/WS4 convention
// exactly: defaults are supplied at READ time by the normalizers, never written into the stored config, so
// an install that has never been configured needs no migration and a stored row never goes stale against a
// new field.
//
//   intake_review_mode   'when_needed' (default) | 'always'
//                        when_needed — the intake stop is raised only when a trigger fires (the trigger
//                                      list lives in services/intakeReview.js). This is what the product
//                                      does today: `routing_review` fired on exactly one trigger and
//                                      nothing else stopped at intake, so `when_needed` IS the shipped
//                                      behaviour and defaulting to it changes nothing.
//                        always      — every non-MRR request pauses at intake review (cities that want
//                                      day-1 defect review). Draft decision 5.
//
//   close_approval       'direct' | 'either' (default) | 'approval_required'
//                        Per DEPARTMENT, per evidence-gated ENDING — the two axes a city actually varies:
//                        Police may want a second signature on a denial while Parks does not, and the same
//                        department may want one on a denial but not on a delivery.
//                        direct            — the person who did the work closes it, no approval step
//                        either            — both doors are open; the closer chooses (DEFAULT)
//                        approval_required — the close raises an approval before it takes effect
//
// WHY `either` IS THE SAFE DEFAULT. Today every close is direct: nothing anywhere raises a close approval.
// `direct` would be the exact reproduction of that, but it would also mean a city that turns the approval
// flow on has to revisit every department to allow it. `either` preserves the live behaviour — the direct
// door is still open, and every existing close still works unchanged — while leaving the second door
// available the moment BW5 builds it. `approval_required` is the only value that can STOP a close, and
// nothing defaults to it.
//
// NOTHING READS `close_approval` YET. BW5 owns the close/approval pipeline (SPEC §9 build order). This
// module is the store and the resolver, so the pipeline lands on settled config rather than inventing its
// own shape — the same sequencing WS4's approval modules used.
var JR = require('./jurisdictionRules');

var DOMAIN = 'processing';

var INTAKE_REVIEW_MODES = ['when_needed', 'always'];
var DEFAULT_INTAKE_REVIEW_MODE = 'when_needed';

var CLOSE_APPROVAL_MODES = ['direct', 'either', 'approval_required'];
var DEFAULT_CLOSE_APPROVAL = 'either';

// THE EVIDENCE-GATED ENDINGS a request can reach — each one a close whose defensibility rests on a record
// the system already holds. The keys are the closure reasons the code actually writes today (plus
// `denial` and `withdrawn`, which are real endings that carry no closure_reason string yet), so the knob
// addresses endings that exist rather than a vocabulary invented ahead of them.
//
// ⚠️ BW5 owns the full disposition model (Draft 8 rev 2, SPEC §4) and may add to this list. Adding a key
// is additive by construction: an ending with no stored setting resolves to the department default, and
// then to the office default — so a new ending is never silently `approval_required`.
var ENDINGS = {
  no_records: { label: 'No responsive records', evidence: 'The diligent-search effort trail (already enforced at resolve: a no-records close is refused on an empty one).' },
  denial: { label: 'Denied / withheld', evidence: 'The asserted exemption, its citation, and the legal review that recorded it.' },
  fulfilled: { label: 'Fulfilled and delivered', evidence: 'The delivery record for the released files.' },
  withdrawn: { label: 'Withdrawn by the requester', evidence: "The requester's instruction, recorded on the request." },
  nonpayment: { label: 'Closed for nonpayment', evidence: 'The unpaid invoice and the dunning trail.' },
  deposit_unpaid: { label: 'Closed — deposit never paid', evidence: 'The deposit clock and the unpaid deposit record.' },
  no_clarification: { label: 'Closed — clarification never answered', evidence: 'The clarification sent, and the elapsed response window.' },
  estimate_lapsed: { label: 'Closed — estimate lapsed', evidence: 'The estimate sent, and the elapsed acceptance window.' },
  abandoned: { label: 'Abandoned', evidence: 'The tickler trail showing the request went unanswered.' }
};
var ENDING_KEYS = Object.keys(ENDINGS);

function oneOf(list, v, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }

// Normalize the per-ending map of ONE scope (office-wide, or one department). Unknown ending keys and
// unknown modes are dropped rather than corrected: a value nobody can act on must not read as a setting.
function normalizeEndings(raw) {
  var out = {};
  Object.keys(raw || {}).forEach(function (k) {
    if (ENDING_KEYS.indexOf(k) < 0) return;
    if (CLOSE_APPROVAL_MODES.indexOf(raw[k]) < 0) return;
    out[k] = raw[k];
  });
  return out;
}

function normalizeCloseApproval(raw) {
  raw = raw || {};
  var depts = {};
  Object.keys(raw.departments || {}).forEach(function (deptId) {
    var d = raw.departments[deptId] || {};
    var n = { endings: normalizeEndings(d.endings) };
    if (CLOSE_APPROVAL_MODES.indexOf(d.default) >= 0) n.default = d.default;
    // A department entry that says nothing is not a setting — drop it so `departments` lists only real
    // overrides and the resolver's "is this department configured" question has an honest answer.
    if (n.default || Object.keys(n.endings).length) depts[deptId] = n;
  });
  return {
    default: oneOf(CLOSE_APPROVAL_MODES, raw.default, DEFAULT_CLOSE_APPROVAL),
    endings: normalizeEndings(raw.endings),
    departments: depts
  };
}

function normalize(raw) {
  raw = raw || {};
  return {
    intake_review_mode: oneOf(INTAKE_REVIEW_MODES, raw.intake_review_mode, DEFAULT_INTAKE_REVIEW_MODE),
    close_approval: normalizeCloseApproval(raw.close_approval)
  };
}

// The effective processing config for a jurisdiction. Never throws — a missing or corrupt config must
// degrade to the defaults, which are the shipped behaviour, not to a 500 on the front door.
async function config(jid) {
  var raw = null;
  try {
    if (!jid) jid = await JR.activeJid();
    raw = jid ? await JR.read(jid, DOMAIN) : null;
  } catch (e) { raw = null; }
  var out = normalize(raw);
  out.jurisdictionId = jid || null;
  return out;
}

async function write(jid, cfg, actor) {
  if (!jid) jid = await JR.activeJid();
  var clean = normalize(cfg);
  return await JR.write(jid, DOMAIN, clean, actor || 'staff');
}

// ── Resolvers — the ONE place each knob is interpreted ─────────────────────────────────────────────

// Is the intake stop raised for every request, or only on a trigger?
async function intakeReviewMode(jid) { return (await config(jid)).intake_review_mode; }
async function intakeReviewAlways(jid) { return (await intakeReviewMode(jid)) === 'always'; }

// How may THIS department close THIS ending? Most specific wins, and each fallback is a real setting
// before it reaches the shipped default:
//   department + ending  ->  department default  ->  office ending  ->  office default ('either')
function resolveCloseApproval(cfg, departmentId, ending) {
  var ca = (cfg && cfg.close_approval) || normalizeCloseApproval(null);
  var d = departmentId ? ca.departments[departmentId] : null;
  if (d && ending && d.endings[ending]) return { mode: d.endings[ending], source: 'department_ending' };
  if (d && d.default) return { mode: d.default, source: 'department_default' };
  if (ending && ca.endings[ending]) return { mode: ca.endings[ending], source: 'office_ending' };
  return { mode: ca.default, source: 'office_default' };
}

async function closeApprovalFor(jid, departmentId, ending) {
  return resolveCloseApproval(await config(jid), departmentId, ending);
}

module.exports = {
  DOMAIN: DOMAIN,
  INTAKE_REVIEW_MODES: INTAKE_REVIEW_MODES,
  DEFAULT_INTAKE_REVIEW_MODE: DEFAULT_INTAKE_REVIEW_MODE,
  CLOSE_APPROVAL_MODES: CLOSE_APPROVAL_MODES,
  DEFAULT_CLOSE_APPROVAL: DEFAULT_CLOSE_APPROVAL,
  ENDINGS: ENDINGS,
  ENDING_KEYS: ENDING_KEYS,
  normalize: normalize,
  normalizeCloseApproval: normalizeCloseApproval,
  config: config,
  write: write,
  intakeReviewMode: intakeReviewMode,
  intakeReviewAlways: intakeReviewAlways,
  resolveCloseApproval: resolveCloseApproval,
  closeApprovalFor: closeApprovalFor
};
