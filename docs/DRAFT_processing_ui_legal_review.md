# DRAFT — Processing UI, session 1 (screen 4): Legal Review / the AG Band

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-28. Not a spec, not for build. Sibling of
drafts 1c (intake review), 2 (estimate), 3 (denial compose); becomes part of `SPEC_processing_ui.md`
when the shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft4_legal_review.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — TX tab is the AG band, OH tab is the staff-denial decision point.

The phase-screen inventory's extend item: "LegalReviewTaskPage (extend: legal-denial, TX AG band
branch-gated)". The TX band's **backend is BUILT and E2E-verified** (`verify_e2e_tx.js`):
assert-exemption → stage `ag_review` + `legal_review` task + respond clock tolled
(`ag_ruling_pending`) + 10-bd `ag_ruling` clock; ag-ruling → clock satisfied, respond resumed,
stage advances, task closes. This draft is the screen over that machinery.

---

## 1. The shape

- **One task type (`legal_review`), office-level, team-agnostic** (routing built) — Senior Legal +
  Legal Associate by task subset. Same screen serves both spawning stages, work surface swapping by
  stage + branch profile: `ag_review` (TX — the band tracker) and `exemption_review` (both states).
- **TX: the band is a statutory tracker, not a to-do list.** Steps = §552.301 duties with dates,
  evidence, history: ruling request (10 bd, (b)) → requestor notice ((d)) → briefing package (15 bd,
  (e); required-contents checklist; requestor copy (e-1)) → await ruling (respond stays tolled) →
  record ruling. Met steps show met-and-when; a cleared exposure says cleared rather than vanishing.
- **OH: the same task is the staff-denial decision point.** Escalation provenance (who, why, which
  task is paused waiting) → per-record proposed treatment → decide: uphold (opens Draft 3's compose,
  grounds carried in) / release (back to redaction) / **return-with-guidance** (answer the question
  without manufacturing a determination — most escalations are questions).
- **Release is never blocked**: withdraw-assertion-and-release is always one click, no gate.
- **Clock strip does the compliance narration**: respond rendered TOLLED with reason; duty clocks
  navy with citations; §552.302 exposure as a warning on its clock (cleared state shown); and a new
  fourth treatment — **informational** (dashed, "the AG's clock", §552.306 45 bd) for dates that are
  someone else's duty.
- **Decided-by grows one badge:** `Decided by · external authority` (purple-tinted) for the AG
  ruling — recorded here, decided there, ruling number + letter attached. Same pattern as the OH
  vexatious list (the court's).

## 2. Bindings

| Surface | Binds to |
|---|---|
| Queue + task | `legal_review` tasks (BUILT, team-agnostic); stage from request; duty-clock column from `computeStatus` (exposures included) |
| Band state | `POST /requests/:id/assert-exemption` (already fired upstream), `request_clocks` (`ag_ruling`, `ag_submission`), toll state (`ag_ruling_pending`), history rows for each band step |
| Record ruling | `POST /requests/:id/ag-ruling {outcome}` (BUILT: sustained/overruled → resume + advance + task close); NEW: ruling number/letter attachment, external-decider record |
| Briefing package | NEW: package assembly (attach + label + submitted-date record); contents checklist from state config |
| Third-party notice | capability `third_party_notice` (branch-gated panel); NEW: third-party record + notice letter (outreach pattern) |
| OH decision | escalation note (from redaction task), per-record treatments → Denial compose handoff (Draft 3) or `applyStageTransition` back to redaction |
| Return-with-guidance | NEW: close task with a guidance note landing on the paused redaction task (CONSULT-style history row) |

## 3. Compliance treatments

Rule (a): tolled-with-reason treatment; duty vs informational clocks; exposure-on-clock incl. the
**cleared** state. Rule (b): the whole band exists only where `ag_referral` is true; OH's tab shows
absence-not-hiding (`unavailableStages`); third-party panel gated separately; null renders. Rule (c):
the ruling is an external decision recorded by a person — new `by-external` badge; assertions and
decisions carry named people. Rule (e): untouched here (no adverse matching).

## 4. Build implications (if the shape survives)

1. `LegalReviewTaskPage` (route `legal-review/:taskId` + My Tasks `Legal →` routing) with the
   stage-switched work surface.
2. **Band-step evidence model**: history rows exist; the letter/package artifacts and per-step dates
   need first-class storage (the §552.301 trail).
3. **Ruling record**: outcome + ruling number + letter file + external-decider attribution; feeds
   Draft 3's previous-determination lookup (a sustained ruling IS a previous determination for
   identical information — capture it once, search it later).
4. **Third-party notice object** (first consumer of the wired=false capability).
5. **Return-with-guidance** close path (task closes, guidance note lands on the paused task).
6. **ClockChip additions**: tolled treatment + informational treatment + exposure cleared state.

## 5. Open questions for Kevin

1. **Briefing-package depth** — attach-and-check (drafted) vs a real assembler (document picker,
   labeling, generated cover)? The (e) contents are load-bearing; how much should the system hold?
2. **Who records the ruling** — Senior Legal only, or can a Legal Associate record it (the decision
   is the AG's; recording is clerical-plus)?
3. **Return-with-guidance** — right to have it? It deliberately lets legal answer without deciding;
   confirm that matches how your reviewers actually work.
4. **The informational clock treatment** (AG's 45 bd) — worth the fourth visual, or noise?
5. **OH per-record "Adjust per record…"** — drafted as a modal-level detail; should the per-record
   treatment editor be the primary surface instead of the three big buttons?

## 6. Not re-opened

The AG band's backend mechanics (WS2/WS3, E2E-verified), branch-gating rules, Draft 3's compose
ownership of the letter, clock taxonomy, no-auto-denial.
