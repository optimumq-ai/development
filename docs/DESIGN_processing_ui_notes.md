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

---

# PHASE-7 HANDOFF — what the UI can now bind to (written 2026-07-28)

Phase 7 (`docs/SPEC_phase7_build.md`, WS1–WS6) is COMPLETE and on `main`:
`603505d` importer · `2bf2ab0` branch profile + eligibility · `384a4c9` clock matrix ·
`e77219e` approval modules · `4d65f92` requestor ledger · `01ddbec` integrity + E2E.
Suite: 48 harnesses, 1289 assertions, 0 failures (`e4456cd`).

The sequencing note above said the backend must come first because "WS1/WS2 produce the real config
+ branch-profile shapes the UI design needs to bind to." Those shapes now exist. This section is what
they are, and the five rules the UI has to honour. **Read this before drafting screens** — three of the
five are compliance constraints, not preferences: getting them wrong misstates the law to a citizen.

## 1. The config the UI reads (all under `/api/jurisdiction-profile`, all read-only GETs)

| Endpoint | Answers |
|---|---|
| `/status` | the section readiness index — which surfaces are configured / attested / drifted |
| `/branch-profile` | which of the 25 ▲ branches this state has, as 14 named **capabilities**, plus `unavailableStages` |
| `/eligibility` | the 6 requester-eligibility dimensions, which are gated, which actually enforce |
| `/approval-modules` | fee-waiver + commercial-rate module config, and the statutory-mandatory categories |
| `/ledger` and `/ledger/request/:requestId` | the cross-request balance rule; per-request: balance, flags, or `anonymous: true` |
| `/api/stages` | the stage vocabulary — `order` (universal) plus `available` / `unavailable` (this state) |

Domain configs themselves live in `jurisdiction_rules` (one row per jurisdiction × domain):
`intake · eligibility · branches · disposition · ledger · clock_matrix · deadline · fee · exemption ·
redaction · clarification · payment · fee_waiver · approval_modules · template_import`.

## 2. THE FIVE RULES (three are compliance constraints)

**(a) A due date is not automatically a deadline.** Every clock now carries `kind`, and clock status
(`tolling.computeStatus`) returns `kind`, `legalDeadline`, `operationalTarget`, `overdueMeaning`,
`citation`, `exposures`. Four kinds: `response` (the legal due date — the only one that may be primary),
`agency_action` (a hard statutory duty that is not the response deadline), `requestor_window` (belongs to
the requestor), `operational_target` (**a CITY SERVICE TARGET and NOT a legal deadline**).
→ *The UI must never render an `operational_target` with the same treatment as a statutory deadline, and
must never put the words "the law requires" beside one.* Fifteen of the thirty-two researched states have
NO statutory response clock at all; in those states every date on the screen is a city target.
`overdueMeaning` gives ready-made language: "past a STATUTORY deadline" vs "past the CITY SERVICE TARGET
— not a legal deadline".

**(b) Panels are branch-gated.** `GET /branch-profile` returns `capabilities` as `true | false | null`.
**`null` means UNKNOWN (this state was never imported), and unknown must render as it does today** — only
an explicit `false` hides anything. Nineteen seeded jurisdictions are `null`. Worked examples:

| | TX | OH |
|---|---|---|
| `ag_referral` | **true** — AG band replaces staff denial | **false** — `ag_review` does not exist; the API lists it in `unavailableStages` |
| `fee_waiver` | true | false — no statutory waiver program |
| `commercial_rate` | false | false |
| `clarification_denial` | false | **true** — vagueness is itself a denial ground |
| `delivery_caps` | false | true |
| eligibility dims gated | incarceration | identity, incarceration, vexatious |

Only three capabilities are `wired` (the engine acts on them today): `ag_referral`, `fee_waiver`,
`commercial_rate`. The other eleven are correct, queryable facts with no engine object yet — they are
exactly the ones the UI would gate panels on, so **the UI is the first consumer of most of this table**.

**(c) Advisory ≠ automatic.** Several results carry findings a HUMAN must confirm rather than actions the
system takes. This distinction is load-bearing and needs a visual language:
- eligibility → `blocks` (refuse) / `reviews` (let through, flag) / `advisories` (record only). Freshly
  imported states are advisory-only by construction.
- ledger → `triggers` (money demands: compute and issue) vs `advisories` (denial-shaped: MA's
  unpaid-balance denial, vexatious flags — a person confirms; auto-denial is out of scope by decision).
- a class-D ledger flag is **recorded and applied, never decided here** — the OH vexatious list is the
  court's, the UT designation is the director's. Show whose decision it was (`source`, `citation`).

**(d) Unconfirmed knobs block go-live.** Every ⚠ city-config knob imported from the template carries
`confirmed: false` + a `suggested_default`. A section cannot reach `configured` — and `attest()` refuses
it — while any knob on it is unconfirmed. `configIntegrity` reports them per domain. **TX currently has 9
such warnings and OH 9** (see §4). The UI needs a confirm-each-knob surface; it is the go-live checklist.

**(e) Anonymous requests are never adverse-matched.** `/ledger/request/:id` returns `{anonymous: true}`
when there is no affirmative identity anchor, and no balance is disclosed. Do not design a screen that
implies a balance exists but is hidden — for those requests it genuinely does not apply.

## 3. Approval-module modes drive two different screens

Per module (`fee_waiver`, `commercial_rate`): `{enabled, mode, routed_task: {assignee_role, task_name}}`.
- `intake_review` → the Intake Review screen carries approve/deny **inline**; no separate task. This is
  the "no extra hop" mode and the reason Intake Review is a BUILD item above.
- `routed_task` → a task appears, named by config, routed to the configured role. Live default for
  fee_waiver, reproducing today's behaviour.
- **Statutory-mandatory categories fire regardless of `enabled` and regardless of confirmation** (CT
  indigency, MI first $20, AZ crime victim …) on verified evidence. The UI must show a waiver granted BY
  STATUTE differently from one granted by a person — `fee_waiver_decided_by = 'statute'`.
- Sequencing the UI must enforce: **the estimate cannot be SENT while a waiver is undecided** (409
  `WAIVER_UNDECIDED`). The waiver denial then FOLDS INTO the estimate notice — one communication, no
  separate letter. `GET /fee-estimates/request/:id/notice` returns `feeWaiverGate`.

## 4. State of the live install (so the design session is not surprised)

- **TX's WS3 clock proposal is still PENDING review.** Live TX runs its pre-Phase-7 clocks
  (`respond` primary with `durationByClassification`, `ag_ruling` 10 bd) and neither carries a `kind`, so
  both read as `response` by the safe default. The reconciled AG-briefing / 61-day clarification / 60-day
  unclaimed clocks exist in the proposal, not in the live config. Approving it is a one-click act through
  the existing config-proposal review flow.
- Pending template proposals on live: `jur-tx` clarification, deadline (×2), fee_waiver, payment,
  template_import; `jur-oh` template_import.
- **OH is imported and inert-by-design**: operational targets only, no clock starts, no `deadline_date`
  is written. A request there genuinely has no due date until the city sets a service target. The UI must
  render that state without inventing one.
- **The requestor ledger is built and INERT.** It needs an affirmative identity anchor (portal account,
  genuinely verified email, or staff-confirmed) and the product currently produces NONE of them — the
  portal's two "verified" buttons are clicked by the requester. So `/ledger/request/:id` answers
  `anonymous: true` for every live request today. Design the ledger surfaces, but expect no data until
  identity ships. See `services/requestorLedger.js` header.

## 5. Where to read the reasoning

Each service header carries the decision and why, in place: `branchProfile.js` (the null-is-unknown
fallback rule) · `clockMatrix.js` (the four kinds, exposure-is-not-a-clock) · `eligibilityGate.js` (why
blocking needs confirmation) · `approvalModules.js` (the mandatory-fires-anyway asymmetry) ·
`requestorLedger.js` (the identity constraint). Two worked scenarios read like a script of the two
states: `tests/verify_e2e_tx.js` (hard clock + AG band) and `tests/verify_e2e_oh.js` (soft standard +
staff denial).
