# DRAFT — Processing UI, session 1 (screen 2): the Estimate Task Screen

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-28. Not a spec, not for build. Sibling of
`DRAFT_processing_ui_intake_review.md` (Draft 1c); becomes part of `SPEC_processing_ui.md` when the
shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft2_estimate.html` (tracked; a copy lives in the
`/home/optimumq/exchange` drop for WinSCP viewing) — Austin TX / Columbus OH toggle, annotated,
same design language and component vocabulary as Draft 1.

This screen **extends the built `EstimateTaskPage`** (the proven task-screen pattern the precedent
specs mirror) rather than replacing it. The phase-screen inventory already listed the extension
(waiver panel, deposit gate); the 7/28 discussion added the third and largest piece.

---

## 0. The decision this draft encodes (Kevin, 2026-07-28, round 3)

**On the auto-routed path, the estimate task is the first human checkpoint.** The engine already
sequences estimate before record search on `wfr-confident` auto-routes (`workflowEngine.js`:
"Estimate precedes record search"), so under only-when-needed intake (Draft 1c) the estimator is the
first person to read most requests. Therefore:

- The estimate screen carries the **same defect markers** as intake review — Mark Vague / Mark Overly
  Broad on the record item, plus the clarification drawer. Marking a defect **pauses the estimate
  task** and fires the per-state clarification machinery (clock effect per jurisdiction).
- **Vague never waits for an estimate** — you can't price what you can't parse; the estimator who
  can't scope the request has *discovered* the vagueness, and in runs-no-stop states delay burns clock.
- **"Too large" is not a mark anywhere — it IS the estimate.** Most states handle volume economically
  (TX: itemized estimate §552.2615, deposit §552.263, 36-hour cap §552.275 — no burden-denial ground
  exists). The acceptance gate (proceed / narrow / withdraw) is the narrowing conversation. Where a
  burden denial ground exists (IL unduly-burdensome), the conference-before-denial gate belongs on
  **Denial compose**, with this screen's estimate as its evidence.
- **Exemption denial orders the other way** — it is about the records, discovered at
  search/redaction/legal review, possibly after an estimate went out. The needed safeguard is a
  **refund/credit path when withholding shrinks a paid deliverable** (parent financial view — flagged,
  not designed here).

## 1. The shape

- **Queue:** My Tasks → estimate type, [Team] Fulfillment Staff with the *Estimate Creation* subset;
  team-scoped pool + smart routing. Normal traffic, not exceptions.
- **Provenance is a queue column ("Path here")**: `Auto-routed — first human review` vs
  `Via Intake Review (name)` + what was decided there. The estimator's duty changes with it.
- **Task screen zones:** parent strip · clock strip (same ClockChip grammar as Draft 1) ·
  first-look banner (auto-routed only) · record-item expand with defect markers · estimate builder ·
  waiver panel · deposit panel · notice send gate · rail (confer / log / clarification / de-minimis
  waive / what-happens-after).

## 2. Panel → substrate bindings

| Surface | Binds to |
|---|---|
| Queue + task load | `GET /tasks/:taskId`, task type `estimate` (BUILT) |
| "Path here" provenance | intake_review task history for the request (Draft 1c's trigger record; absent = auto-routed) + `workflow_decisions` (rule id, confidence) |
| First-look banner | same: no completed intake_review task ⇒ first human |
| Defect markers + pause | `clarificationAction.send()` (`reason: vague | overly_broad`), `clarification_clock_effect`, `clarification_duty`; NEW: pause/resume of the estimate task itself |
| Estimate builder | `estimateProfile.assess` (automated → "Review auto-generated estimate"), estimate profiles (pre-search predicted basis); per-state chargeability config (fee domain) decides which line kinds exist |
| TX 36-hour cap tracker | ledger class B allowance — config stub, staff-entered value, `recorded` badge |
| Waiver panel (4 states) | `GET /approval-modules` (mode), waiver decision record (decided_by: person/statute), `GET /fee-estimates/request/:id/notice` → `feeWaiverGate` (409 WAIVER_UNDECIDED blocks send) |
| Deposit panel | `GET /ledger/request/:id` → prior-balance trigger (system-computed, citation) or `{anonymous: true}` → panel absent + ledger panel says why |
| Notice | `feeNotice` (BUILT): itemization, deposit demand, waiver fold-in, respond-or-withdrawn window — one communication |
| OH delivery cap | ledger class C config stub — identity-anchored only; anonymous shows no count |
| Acceptance gate after send | existing estimate acceptance flow (proceed / narrow / withdraw); nonpayment/unclaimed window clock (requestor_window chip) |

## 3. Compliance treatments carried over from Draft 1

Same ClockChip grammar (navy statutory / dashed city target / outline requestor window — OH tab shows
a *set* city target this time, dated but never navy); same DecidedByBadge vocabulary (waiver panel
exercises all four values); same three-valued branch gating (OH hides waiver/commercial by explicit
`false`; the deposit panel's absence for anonymous is *ledger* logic, not branch gating — the mockup
note distinguishes the two so a builder doesn't conflate them); anonymous = "does not apply", never
"hidden" (rule e), including the delivery cap showing no count.

New in this draft: **chargeability as cited config** — the builder never offers a line kind the state
forbids (OH: no labor lines, actual cost only, R.C. 149.43(B)(1); TX: personnel time per AG schedule).

## 4. Build implications (if the shape survives)

1. **Defect markers on `EstimateTaskPage`** + estimate-task pause/resume on clarification
   (`CLARIFICATION_REQUESTED` → task paused; reply → resumed). Shares the marker components with
   Draft 1's record-item block and the already-built record-search rail.
2. **Provenance read**: "was there an intake_review stop, and what did it decide" as a small,
   queryable fact (feeds queue column + banner + waiver-panel state).
3. **Waiver-gate surfacing**: the send button renders `feeWaiverGate.blocked` in words; the four
   panel states map to module mode + decision record.
4. **De-minimis waive & advance**: zero-estimate path that skips the notice cycle — person-decided,
   recorded (exists conceptually in fee flows; needs a first-class action here).
5. **Chargeability-aware line builder**: line kinds from per-state fee config, each with citation.
6. **Flagged, not here**: refund/credit on post-estimate denial (parent financial view); IL
   conference-before-burden-denial gate (Denial compose); MRR estimate flow.

## 5. Open questions for Kevin

1. **The first-look banner** — right tone/prominence? It makes "nobody has reviewed this" impossible
   to miss, at the cost of amber real estate on every auto-routed task (which is most of them).
2. ~~**Pause semantics**~~ — **RESOLVED (Kevin, 2026-07-28): stay-and-estimate for overly broad is
   right.** Vague pauses the estimate task; Overly Broad stays on-screen and the estimate itself is
   the response to volume.
3. **De-minimis waive** — keep as a rail action? Threshold config per city, or pure judgment?
4. **"Path here" column** — enough provenance, or should the queue also show what intake decided
   (drafted only on the row that had a waiver denial)?
5. **Estimate profile visibility** — the predicted basis is shown inline ("typical volume 300–600
   pages"). Enough, or should the profile's assessment (automated vs manual) be more prominent?

## 6. Not re-opened

Waiver/commercial module design and sequencing (409 gate, fold-into-notice), ledger MVP scope
(classes B–D as stubs), clock taxonomy, acceptance-gate mechanics, Draft 1c's intake decisions.
