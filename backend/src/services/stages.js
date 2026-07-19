'use strict';
// THE canonical request stage vocabulary. One definition, one order, one set of labels.
//
// Before this module there were THREE divergent stage lists:
//   1. taskRouting.STAGE_ORDER          — 10 stages, the real pipeline the backend enforces.
//   2. the frontend pages               — 7 stages in a DIFFERENT order, containing a ghost stage
//                                         (`custodian_retrieval`) that exists nowhere in the backend, and
//                                         missing exemption_review / ag_review / redaction entirely. The
//                                         "Advance" button drove live stage writes off this list.
//   3. routes/workflow.js VOCAB.stages  — 4 stages, used to prompt the AI workflow-rule builder, so the AI
//                                         could only ever emit a quarter of the pipeline.
//
// Everything now derives from here. The frontend mirror (frontend/src/lib/stages.js) is kept honest by a
// parity check against GET /api/stages, so a divergence fails a test instead of rotting quietly.
var STAGES = [
  { key: 'intake', label: 'Intake Review' },
  { key: 'fee_review', label: 'Fee Review' },
  { key: 'awaiting_payment', label: 'Awaiting Payment' },
  { key: 'record_search', label: 'Record Search' },
  { key: 'exemption_review', label: 'Exemption Review' },
  { key: 'ag_review', label: 'AG Review' },
  { key: 'redaction_review', label: 'Redaction Review' },
  { key: 'redaction', label: 'Redaction' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'closed', label: 'Closed' }
];

var ORDER = STAGES.map(function (s) { return s.key; });
var LABELS = {};
STAGES.forEach(function (s) { LABELS[s.key] = s.label; });

// ⚠️ THE SEQUENCE IS NOT THE VOCABULARY (Kevin's decision, 2026-07-19 — brief §5 decision 1).
//
// All ten stages above are real stages a request can occupy. But TWO of them are not steps on the way to
// anywhere — they are a CONDITIONAL BRANCH, and treating them as sequential was a live defect:
//
//   `exemption_review` and `ag_review` are entered ONLY by asserting an exemption
//   (`POST /requests/:id/assert-exemption`), which reads `jurisdiction_profiles.exemption_model` and picks
//   between them — `pre_clearance` (Texas: AG pre-clearance, statutory clock tolled) vs `self_court` /
//   `self_appeal_court` (internal review). They are left by a legal DECISION, never by advancing:
//   the `legal_review` task resolution and `POST /requests/:id/ag-ruling` share one outcome vocabulary
//   (sustained / partial -> redaction_review, overruled -> delivery).
//
// WHAT THIS FIXES. `next()` used to be purely positional, so `record_search` advanced to `exemption_review`
// and the Advance button offered it. Every ordinary request — nothing withheld, nothing to argue — was
// walked through two legal stages to reach redaction, and in the 19 of 20 seeded jurisdictions that are not
// Texas, `ag_review` is a step that cannot legally apply. It survived because no live request has ever gone
// past `record_search`; the mid-pipeline has no real traffic.
//
// So the linear walk runs over SEQUENCE, and the branch stages are reachable only by the domain action that
// means them.
var BRANCH = ['exemption_review', 'ag_review'];
var SEQUENCE = ORDER.filter(function (k) { return BRANCH.indexOf(k) < 0; });

function isBranch(stage) { return BRANCH.indexOf(stage) >= 0; }

// The next stage in the canonical SEQUENCE, or null at the end.
//
// Returns null for a branch stage as well as for an unknown one, and for the same reason: the frontend then
// renders no Advance button, which is the honest outcome. Leaving a legal review is a legal act with its own
// ceremony and a required note — it must not be reachable by a generic "Advance" that records no reasoning.
function next(stage) {
  if (isBranch(stage)) return null;
  var i = SEQUENCE.indexOf(stage);
  if (i < 0 || i >= SEQUENCE.length - 1) return null;
  return SEQUENCE[i + 1];
}

function isTerminal(stage) { return stage === 'closed'; }

module.exports = { STAGES: STAGES, ORDER: ORDER, LABELS: LABELS, next: next, isTerminal: isTerminal,
                   SEQUENCE: SEQUENCE, BRANCH: BRANCH, isBranch: isBranch };
