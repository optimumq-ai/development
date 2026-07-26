# Processing UI direction — notes (pre-draft, decided points only)

Captured 2026-07-26 from discussion with Kevin. Details to be worked through in a dedicated
design session AFTER the Phase-7 backend build (see sequencing below). Not a spec yet.

## Decided direction

- **UI (with subscreens) per USER TYPE**, each allowing completion of that role's tasks
  logically grouped into a general flow — NOT a single global work hub, and NOT a generic
  shared task screen everyone uses. Role definitions anchor to `DESIGN_user_type_role_model.md`.
- **Shared task-screen shell: caution.** A shared shell was problematic in the first build.
  If reused at all, draft it and tune until it makes sense — do not assume it as foundation.
- The first build's `RequestWorkspacePage` global-hub pattern is confirmed for retirement:
  request-centric hub ≠ how users think ("I'm doing intake review", "I'm redacting").
- **One code path for MRR vs single-item** (single-item = parent with one child; parent chrome
  collapses to a header strip). Two paths in UX, one in code.

## Raw material for the design session (from 2026-07-26 discussion)

- Phase-screen inventory mapped to the child Process Status machine — exists/extend/build:
  My Tasks (exists, becomes the only router) · Intake Review w/ prelim search (BUILD; hosts
  waiver/commercial inline approve/deny when module mode = intake_review) · Clarification
  (small: drawer + tickler) · EstimateTaskPage (extend: waiver panel, deposit gate) ·
  RecordSearchTaskPage (exists) · RedactionTaskPage (exists; serves legal redaction) ·
  LegalReviewTaskPage (extend: legal-denial, TX AG band branch-gated) · Denial compose (BUILD:
  reason library + letter + routing) · Disposition/close (BUILD) · Parent financial view
  (BUILD; CashDrawerPage covers payment-taking).
  Under the per-user-type model these become the SUBSCREENS, grouped by role.
- Branch-gating flows into the UI: the state branch profile (Phase-7 WS2) decides which panels
  render — OH users never see an AG-referral panel.
- Cross-cutting elements every role UI needs somewhere: child header, clock strip (incl.
  operational-target timers), requestor-ledger flags, communications log, legal-escalation
  spawners. Whether these ship as a shared component library (not a shared screen) is a
  design-session question.

## Sequencing (recommended)

Phase-7 backend build (WS1–WS6) FIRST — it has no UI dependency, and WS1/WS2 produce the real
config + branch-profile shapes the UI design needs to bind to. Then the UI design session
(fresh budget, Fable-level design work): per-user-type screen drafts → tune with Kevin →
spec → build as the follow-on workstream.
