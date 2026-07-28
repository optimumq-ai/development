---
description: Start the processing-UI design session with the Phase-7 handoff loaded
argument-hint: "[optional: a role or screen to focus on, e.g. 'intake reviewer']"
model: claude-fable-5
---

You are starting the **processing-UI design session** for OptimumQ. This is DESIGN work, not a build:
the deliverable is screen drafts and a spec Kevin can react to, not code.

Focus for this session, if given: $ARGUMENTS

## Read these first, in this order

**1. The direction and the handoff — read in full, both are short:**
- `/opt/optimumq/docs/DESIGN_processing_ui_notes.md` — Kevin's decided direction, the phase-screen
  inventory, and (second half) the **PHASE-7 HANDOFF**: the six endpoints the UI binds to, a TX-vs-OH
  worked capability table, the live-install state, and FIVE RULES. Three of those five are compliance
  constraints, not preferences. This is the single most important document for this session.
- `/opt/optimumq/docs/DESIGN_user_type_role_model.md` — the role definitions the per-user-type UIs
  organise around.

**2. Precedent — two task screens that already exist and work.** Read these before drafting anything
new, so the drafts match what is already good rather than reinventing it:
- `/opt/optimumq/docs/SPEC_record_search_task_screen.md`
- `/opt/optimumq/docs/SPEC_redaction_task_screen.md`

**3. Reference — read as the design needs them, not up front:**
- `/opt/optimumq/docs/SPEC_phase7_build.md` — what the six backend workstreams delivered.
- The service headers carry the reasoning in place, and are the best short explanation of each rule:
  `backend/src/services/branchProfile.js` (why `null` means unknown and only `false` hides a panel) ·
  `clockMatrix.js` (the four clock kinds; why a service target is not a deadline) ·
  `eligibilityGate.js` · `approvalModules.js` (the two modes; mandatory-fires-anyway) ·
  `requestorLedger.js` (the identity constraint).
- `backend/tests/verify_e2e_tx.js` and `verify_e2e_oh.js` read like a script of the two states —
  Texas with a hard clock and an AG band, Ohio with neither. Useful for grounding a draft in a
  concrete request.
- Decided and NOT to be re-opened: `docs/rules_research/workflow/DESIGN_fee_waiver_commercial.md`,
  `DESIGN_requestor_ledger.md`.

## What is already decided — do not re-litigate

- **A UI (with subscreens) per USER TYPE.** Not a single global work hub; the first build's
  request-centric `RequestWorkspacePage` is confirmed for retirement.
- **A shared task-screen shell was problematic in the first build.** If you propose one at all, propose
  it as draft-and-tune — never assume it as the foundation. Shared pieces ship as a component library,
  not a shared screen.
- **One code path for MRR vs single-item** (single-item = a parent with one child; parent chrome
  collapses to a header strip). Two paths in UX, one in code.
- The approval-module modes, the requestor-ledger classes, and the clock taxonomy are settled. Design
  against them.

## The three constraints a draft can get wrong without anyone noticing

1. An `operational_target` clock is a **CITY SERVICE TARGET, not a legal deadline**. Fifteen of the
   thirty-two researched states have no statutory response clock at all, so in those states every date
   on the screen is a city target. A screen that renders it like a statutory deadline misstates the law
   to the citizen reading it. `computeStatus` returns `legalDeadline` and a ready-made `overdueMeaning`.
2. Branch capabilities are `true | false | null`. **`null` means UNKNOWN — only an explicit `false` may
   hide a panel.** Nineteen seeded jurisdictions are `null`, and a draft that hides on falsy would strip
   panels from every city nobody has researched yet.
3. **Advisory is not automatic.** Eligibility returns blocks / reviews / advisories; the ledger returns
   triggers (money, automatic) versus advisories (denial-shaped, a person confirms). A flag is recorded
   and applied but never decided by the system — show whose decision it was. These need a visual
   language that does not read as "the system already did this".

## How to work this session

Draft, then check with Kevin — he is the decider on look and flow. Start with ONE role end to end
rather than a thin sketch of all of them; the intake reviewer is the densest (it hosts the inline
waiver/commercial approve-deny when a module is in `intake_review` mode) and the best first test of the
per-user-type shape. Ask before widening scope.

Deliverable: screen drafts plus a spec written to `docs/SPEC_processing_ui.md` when the shape settles.
Do not start building until Kevin says the design is right.
