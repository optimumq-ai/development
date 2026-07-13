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

// The next stage in the canonical pipeline, or null at the end. A stage the vocabulary does not know
// returns null rather than guessing — the frontend then shows no Advance button, which is the honest
// outcome for an unknown stage.
function next(stage) {
  var i = ORDER.indexOf(stage);
  if (i < 0 || i >= ORDER.length - 1) return null;
  return ORDER[i + 1];
}

function isTerminal(stage) { return stage === 'closed'; }

module.exports = { STAGES: STAGES, ORDER: ORDER, LABELS: LABELS, next: next, isTerminal: isTerminal };
