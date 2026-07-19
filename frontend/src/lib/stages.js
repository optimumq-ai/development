// THE canonical request stage vocabulary — a static mirror of backend/src/services/stages.js.
//
// Why this file exists: six pages each carried their OWN copy of a 7-stage list that was WRONG. It was in a
// different order from the backend pipeline, it omitted exemption_review / ag_review / redaction entirely,
// and it contained a ghost stage — `custodian_retrieval` — that exists nowhere in the backend. Worse, the
// RequestWorkspacePage "Advance" button drove LIVE stage writes off that list, so an operator advancing a
// request walked a pipeline the backend does not have and could never reach the redaction stages.
//
// This mirror is checked against GET /api/stages by a parity test, so a future divergence fails a test
// rather than silently corrupting stage data. If you add a stage, add it in the BACKEND module first.
export const STAGES = [
  { key: 'intake', label: 'Intake Review' },
  { key: 'awaiting_payment', label: 'Awaiting Payment' },
  { key: 'record_search', label: 'Record Search' },
  { key: 'exemption_review', label: 'Exemption Review' },
  { key: 'ag_review', label: 'AG Review' },
  { key: 'redaction_review', label: 'Redaction Review' },
  { key: 'redaction', label: 'Redaction' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'closed', label: 'Closed' }
];

export const STAGE_ORDER = STAGES.map(function (s) { return s.key; });

export const STAGE_LABELS = STAGES.reduce(function (m, s) { m[s.key] = s.label; return m; }, {});

// Badge colors. The three stages the frontend never knew about (exemption_review, ag_review, redaction) are
// given colors in the existing palette's idiom — legal review in slate, AG in rose (it is the one stage that
// hands control to an outside authority), redaction sharing the amber family with redaction_review.
export const STAGE_COLORS = {
  intake:           { bg: '#DBEAFE', color: '#1E40AF' },
  awaiting_payment: { bg: '#FFEDD5', color: '#9A3412' },
  record_search:    { bg: '#EDE9FE', color: '#6D28D9' },
  exemption_review: { bg: '#E2E8F0', color: '#334155' },
  ag_review:        { bg: '#FFE4E6', color: '#9F1239' },
  redaction_review: { bg: '#FEF3C7', color: '#92400E' },
  redaction:        { bg: '#FDE68A', color: '#78350F' },
  delivery:         { bg: '#E0E7FF', color: '#3730A3' },
  closed:           { bg: '#F1F5F9', color: '#475569' }
};

// ⚠️ THE SEQUENCE IS NOT THE VOCABULARY — mirrors backend/src/services/stages.js (Kevin, 2026-07-19).
//
// `exemption_review` and `ag_review` are real stages, but they are a CONDITIONAL BRANCH, not steps on the
// way to anywhere. They are entered only by asserting an exemption (the jurisdiction profile decides which
// of the two), and left only by a legal decision that carries a required note. The linear walk used to run
// over all ten, so this button offered "Advance to Exemption Review" from `record_search` — routing ordinary
// requests with nothing withheld into legal review.
// The MONEY stages are a branch for the same reason (2026-07-19): nothing ever sets `fee_review`, and
// `awaiting_payment` is entered and left by the fee flow, never by advancing. The Advance button at `intake`
// used to offer "Advance to: Fee Review" — a stage with no task and no reconciler sweep.
export const BRANCH_STAGES = ['awaiting_payment', 'exemption_review', 'ag_review'];
export const STAGE_SEQUENCE = STAGE_ORDER.filter((k) => !BRANCH_STAGES.includes(k));

// The next stage in the canonical SEQUENCE, or null at the end / for a branch or unknown stage. Returning
// null means the Advance button does not render, which is the honest outcome in all three cases — better
// than guessing a destination and writing a bad stage, and a legal review must be left by its own ceremony.
export function nextStage(stage) {
  if (BRANCH_STAGES.includes(stage)) return null;
  const i = STAGE_SEQUENCE.indexOf(stage);
  if (i < 0 || i >= STAGE_SEQUENCE.length - 1) return null;
  return STAGE_SEQUENCE[i + 1];
}

export function nextStageLabel(stage) {
  const n = nextStage(stage);
  return n ? 'Advance to ' + STAGE_LABELS[n] : null;
}

export function isTerminal(stage) { return stage === 'closed'; }
