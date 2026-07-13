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

export const STAGE_ORDER = STAGES.map(function (s) { return s.key; });

export const STAGE_LABELS = STAGES.reduce(function (m, s) { m[s.key] = s.label; return m; }, {});

// Badge colors. The three stages the frontend never knew about (exemption_review, ag_review, redaction) are
// given colors in the existing palette's idiom — legal review in slate, AG in rose (it is the one stage that
// hands control to an outside authority), redaction sharing the amber family with redaction_review.
export const STAGE_COLORS = {
  intake:           { bg: '#DBEAFE', color: '#1E40AF' },
  fee_review:       { bg: '#D1FAE5', color: '#065F46' },
  awaiting_payment: { bg: '#FFEDD5', color: '#9A3412' },
  record_search:    { bg: '#EDE9FE', color: '#6D28D9' },
  exemption_review: { bg: '#E2E8F0', color: '#334155' },
  ag_review:        { bg: '#FFE4E6', color: '#9F1239' },
  redaction_review: { bg: '#FEF3C7', color: '#92400E' },
  redaction:        { bg: '#FDE68A', color: '#78350F' },
  delivery:         { bg: '#E0E7FF', color: '#3730A3' },
  closed:           { bg: '#F1F5F9', color: '#475569' }
};

// The next stage in the canonical pipeline, or null at the end / for an unknown stage. Returning null for an
// unknown stage is deliberate: the Advance button then does not render, which is the honest outcome — better
// than guessing a destination and writing a bad stage.
export function nextStage(stage) {
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0 || i >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[i + 1];
}

export function nextStageLabel(stage) {
  const n = nextStage(stage);
  return n ? 'Advance to ' + STAGE_LABELS[n] : null;
}

export function isTerminal(stage) { return stage === 'closed'; }
