# SPEC — Processing UI (per-user-type screens, session 1)

**Status:** SPEC v1, 2026-07-29. Consolidates design-session-1's ten drafts
(`DRAFT_processing_ui_*.md` + `docs/mockups/PROCESSING_UI_draft*.html`) and every decision from
Kevin's 2026-07-28 markup and the 2026-07-29 item-by-item session. Normative on everything marked
DECIDED; items in §10 (open register) are PROVISIONAL and may be revised by Kevin's full
screen-by-screen pass and his Draft 9/10 markup without renegotiating the rest.
**Authority chain:** this spec > the draft docs (which keep the reasoning) > the mockups (which
keep the layouts). Where this spec is silent, the draft doc governs.
**Do not start building until Kevin green-lights the build phase.**

---

## 1. Architecture (all DECIDED)

- **A UI (with subscreens) per USER TYPE** — no global work hub, no shared task-screen shell.
  `RequestWorkspacePage` retires. Shared pieces ship as a **component library**, never a shared
  screen. Role definitions: `DESIGN_user_type_role_model.md` (v3).
- **My Tasks is the only router.** Screens are reached from task groups (or the request header
  for informational surfaces); per-task-type "power" surfaces are accelerators, never
  replacements.
- **One code path for MRR vs single-item** (single-item = parent with one child; parent chrome
  collapses to a header strip). Two paths in UX, one in code.
- **The five Phase-7 rules are UI contract** (handoff §2, `DESIGN_processing_ui_notes.md`):
  (a) clock kinds get irreconcilable visual grammars — navy solid + citation = statutory; grey
  dashed = city service target, labeled "not a legal deadline"; thin outline = requestor window;
  copy always from `computeStatus.overdueMeaning`, never hardcoded; no invented dates (OH).
  (b) branch capabilities `true|false|null` — **only explicit `false` hides a panel**.
  (c) advisory ≠ automatic — DecidedByBadge vocabulary on every decision surface: `a person`
  (named) · `by statute` · `system · statute-triggered` · `recorded only`; external deciders
  named with citation.
  (d) unconfirmed ⚠ knobs block attest; the go-live checklist is their surface.
  (e) anonymous = "does not apply", never "hidden".

## 2. Global layout rules (Kevin 7/28–29, all DECIDED, applied to mockups)

1. **Request Description as Submitted**: the requestor's verbatim text is the first element of
   any record-item surface — bold, larger, under that small uppercase title. Collapsed states
   show a truncation of the same verbatim text; no paraphrase or AI summary anywhere.
2. **Mark Vague / Mark Overly Broad** sit stacked in a small box to the LEFT of the description
   (component: the descrow/defectbox pair) — on intake review, estimate, and MRR child views.
3. Labels: **"Classified as:"** (never "Classified:"); the rail action panel is **"Actions"**
   (never "Work the request"); Request-clarification and Refer-to-proper-custodian list as
   Actions with no sub-headings.
4. **No manual hold anywhere.** Hold is a system state with a named cause: marking Vague/Overly
   Broad auto-holds pending the requestor's response; every other stop condition blocks the
   relevant gate with its reason.
5. **"Will route to (on Proceed):"** — routing lines always distinguish the classifier's proposed
   downstream destination from the task's own routing.

## 3. Screens (normative summary; detail in the named draft + mockup)

| # | Screen | Role | Draft |
|---|---|---|---|
| 1 | Intake Review (+ My Tasks exceptions queue) | ORO Associate | `DRAFT_processing_ui_intake_review.md` (1c + 0b) |
| 2 | Estimate | [Team] Fulfillment Staff | `DRAFT_processing_ui_estimate.md` |
| 3 | Denial compose | empowered roles | `DRAFT_processing_ui_denial_compose.md` (no changes — Kevin) |
| 4 | Legal Review / AG band | Sr. Legal | `DRAFT_processing_ui_legal_review.md` (no changes — Kevin) |
| 5 | MRR Management (4-level: group → overview → master → child) | ORO Associate | `DRAFT_processing_ui_mrr_hub.md` (5b + 0b) |
| 6 | Go-live checklist (readiness index; knob cards fold into Draft 10) | Director | `DRAFT_processing_ui_golive_checklist.md` |
| 7 | Parent financial view | RM read / ORO Finance act | `DRAFT_processing_ui_parent_financial.md` (MRR settlement method §0) |
| 8 | Disposition record + distributed closes | (see §5) | `DRAFT_processing_ui_disposition_close.md` (rev 2 + §3 decisions) |
| 9 | Release Review + power mode | ORO Supervisor (suggested) | `DRAFT_processing_ui_release_review.md` — PROVISIONAL |
| 10 | Rule-content editors (section screens) | per permission group | `DRAFT_processing_ui_rule_editors.md` — PROVISIONAL |

Screen-level decisions worth restating normatively:

- **Intake review** (1): a real routable task type `intake_review`, parent-level, non-MRR only,
  **only-when-needed by default** (`intake_review_mode: when_needed | always`). Trigger list:
  (i) team undeterminable (absorbs + retires `routing_review`) · (ii) eligibility review ·
  (iii) waiver/commercial pending in `intake_review` mode · (iv) sensitivity flag ·
  (v) Director's reopen sent for re-triage. Queue and screen always surface the trigger.
  Auto-complete when the portal requestor marked a selection as fulfilling. The **EditInfoFrame**
  (Classified-as / Record owner / Will-route-to as dropdowns from taxonomy / Departments /
  Fulfillment Teams) replaces Change-route; corrections feed smart routing.
- **Estimate** (2): first human checkpoint on auto-routed paths (first-look banner, "Path here"
  provenance column); defect markers pause the task via clarification; **"too large" is not a
  mark — it IS the estimate**; waiver panel renders only when there is something to show
  (statutory-mandatory categories stay armed and surface it regardless); estimate send blocked
  409 `WAIVER_UNDECIDED`; de-minimis waive-and-advance is a person's recorded rail act;
  chargeability is cited per-state config — the builder never offers a forbidden line kind.
- **MRR** (5): task type `mrr_management`, always-ORO routing triggered by MRR status
  (`child_count > 1`), smart-routing/pool assignment, my-MRRs-only scope; child MRR tasks
  (`mrr_search` / `mrr_estimate` / `mrr_redaction`) are hand-assigned and **never advance a
  stage**; estimate-readiness meter arms one Generate Estimate; denial designation → Legal
  Review, never a denial itself; verbatim descriptions at master and child; per-item requestor
  attachments (📎 counts on bars; a fulfills-marked library record auto-completes that item's
  search).
- **Parent financial** (7): **the MRR settlement method is decided** — quoted shares frozen at
  acceptance; release gate = running funds balance (cumulative FIFO); the last record settles the
  request (aggregate actuals once; refund-or-zero releases immediately); 20% overage watchdog is
  the only mid-flight running number and caps final collection; credits are quoted-number events;
  refunds exist only when credits exceed balance, Finance-issued, never automatic. Reconciliation
  auto-drafts on the last billable task and is visible on screen; sending it is a person's act.

## 4. The disposition model (Draft 8 rev 2 — all DECIDED 7/29)

**Closing happens where the evidence lives.** The eight §5.8 endings and their evidence gates are
unchanged; only *where* moved:

| Ending | Finalized | Actor |
|---|---|---|
| No records located | Record Search popup (full gate: effort trail + descriptions answered + required note; gates never feed each other) | task-holder, per `close_approval` |
| Not in custody / referred | Record Search popup (custodian + referral letter) | task-holder, per `close_approval` |
| Denied | Legal Review / Denial compose — deny+close+notify, one act | empowered role |
| Delivered | auto release event (§4.1) or MRR manual release | system / RM |
| No response · Non-payment | **sweeps only** — manual path removed | system (numeric basis + notice) |
| Withdrawn | Disposition record popup | ORO Associate+ **and** current task-holder |
| Previously furnished (TX §552.232) | Disposition record popup | ORO Associate+ only |

- **`close_approval`** per department (per evidence-gated ending): `direct | either |
  approval_required` — **default `either`**; pending-approval is a visible state; on approval the
  close is the approver's recorded act.
- **Every close = one act**: disposition + notice, blocked-with-reason; never silent.
- **§4.1 Auto-release pipeline** (non-MRR): fires when (i) every flow task terminal — completed
  or **auto-bypassed with recorded basis** (by-statute / system-condition / recorded badges;
  never a silent skip) · (ii) balance ≤ 0 · (iii) pre-send gate off or its review passed ·
  (iv) non-MRR. Payment due ⇒ pending until balance clears, then ships untouched.
- **Pre-send review gate**: default OFF, shipped as an unconfirmed ⚠ go-live knob a named person
  must confirm; when ON, spawns `release_review` (§ Draft 9). Statutory pre-release steps already
  ride the flow as tasks — the gate is city policy.
- **Process-withdrawal spawner**: a communication logged as a withdrawal spawns a small task to
  the RM/ORO pool (no standing task type; exists only when one arrives).
- **Reopen (hybrid)**: Director + required note; popup picks resume point — **prior stage
  (default)** or intake review re-triage (trigger v). Silent reopen; the outcome speaks. Clocks
  never reset (exposures show); a reopened child un-derives the parent (reactivates MRR
  Management where ended). The from-closed transition guard builds with this.
- **RM-hold guard — RATIFIED with prevention refinement**: note always required; under an
  entitlement + installment request the hold control is disabled with reason + citation; an
  installment request arriving mid-hold auto-lifts it and notifies the RM. Never a payment hold
  (§5.9). Builds now.
- **Disposition record screen**: informational (who/where/evidence per ending); reached from the
  request header; read-only for anyone with the request; **no task type**.

## 5. Release Review & power mode (Draft 9 — PROVISIONAL pending Kevin's markup)

- Task type `release_review`: spawned by the pipeline's gate branch; approval-modules routing
  pattern; suggested default ORO Supervisor; **two-eyes rule** (never the item's last flow-task
  completer, enforced at assignment). Approve fires the release event, approver recorded.
- **Power mode**: populate-in-place queue walker — Approve&next / Skip / Return-with-note
  (A/S/R), clock-aware order, progress strip, substance (withholding log w/ citations, notice,
  flags) on the surface; per-item recorded acts; **no bulk approve**. PowerQueue is a
  component-library shell instanced per task type; release review is the first instance (future:
  close-approval queue, routed waivers — not v1).

## 6. Rule-content editors (Draft 10 — PROVISIONAL pending Kevin's markup)

- Section screen per `jurisdiction_rules` domain: Content · City knobs (Draft 6's confirm cards
  fold in — one surface) · Provenance (incl. research-text drill-down) · Pending proposals.
- **THE RULE:** statute-derived facts (navy edge, cited) edit **only via proposal** (citation +
  note required) through the existing review/apply flow; applying recomputes `content_hash` →
  attested sections drift → re-attest. City-policy knobs (dashed amber) set-and-confirm freely.
- Ownership = permission groups (drafted: Legal Rules — exemption/redaction/deadline/clock_matrix;
  Fee Configuration — fee/payment/fee_waiver/approval_modules/ledger; Workflow & Taxonomy —
  intake/branches/disposition/clarification/eligibility; template_import read-only).
- **The editor refuses what the engine would refuse** — WS1–WS3 police rules at compose time,
  worded refusals. Empty domains render honestly, never alarm, never fabricate.

## 7. Component library (build once, instance per screen)

ClockChip (4 kinds + exposures) · DecidedByBadge (4 values) · ParentStrip · RecordItemExpand +
descrow/defectbox (§2.1–2) · EditInfoFrame · TriggerBadge ("why it's here") · PortalResultsBar ·
GateChecklist + ConfirmPopup (the close/gate popup pattern) · PowerQueue shell · statuschips +
fact/knob row treatments (Draft 10) · filerow/clip (attachments).

## 8. Catalog & config deltas (consolidated)

**Task types — new:** `intake_review` (routable, ORO Associate) · `mrr_management` (routable,
ORO) · `mrr_redaction` (hand-assigned, joins `mrr_search`/`mrr_estimate`) · `release_review`
(routable, config role) · process-withdrawal (spawned ad hoc) · close-approval (lightweight,
spawned by `close_approval` routing). **Retired:** `routing_review` (becomes trigger i).
MASTER task-type list updates at ratification.

**Config knobs — new:** `intake_review_mode` (`when_needed` default) · `close_approval`
(`either` default) · pre-send review gate (`off`, mandatory go-live confirmation) · the two MRR
matrix rows stay blank-by-design (`delivery_mode`, `notice_packaging`; WA constraint).

**Endpoints/plumbing the drafts force** (each named in its draft's build-implications): knob
confirm setter (Draft 6) · structured eligibility findings read (Draft 1) · intake-provenance
read (Draft 2) · estimate-task pause/resume (Draft 2) · close popups + approval flow (Draft 8) ·
auto-release condition watcher + auto-bypass writer (Draft 8) · release-event preview (Draft 9) ·
editor proposal composer (`origin:'editor'`) + compose-time validators (Draft 10) · credit
events + FINANCE refund route + cumulative-FIFO coverage (Draft 7) · from-closed guard +
resume-point transition (Draft 8) · RM-hold prevention guard (Draft 8) · withdrawal spawner ·
coverage-gap manager email (role model §6, unbuilt).

## 9. Suggested build order (when Kevin green-lights; small commits, one workstream at a time)

1. **BW1 — Component library + global layout retrofit** (§2 + §7; includes the two built task
   screens adopting descrow/Actions).
2. **BW2 — Catalog & routing**: new task types, `routing_review` retirement, `close_approval` +
   `intake_review_mode` knobs, two-eyes rule, coverage-gap email.
3. **BW3 — Intake Review** (screen + triggers + auto-complete + EditInfoFrame + structured
   eligibility read).
4. **BW4 — Estimate extensions** (defect markers/pause, provenance, waiver gate surfacing,
   de-minimis, chargeable line builder).
5. **BW5 — Close & pipeline** (popups, approval flow, sweeps manual-path removal, auto-release +
   bypass writer, disposition record, reopen + guards, RM-hold guard, withdrawal spawner).
6. **BW6 — MRR hub** (screens + `mrr_tasks` substrate + attachments strip).
7. **BW7 — Parent financial** (statement, allocation table w/ settlement method, credits/refunds,
   reconciliation surfacing).
8. **BW8 — Release review + power mode** (after Draft 9 markup).
9. **BW9 — Admin: go-live checklist + rule editors** (after Draft 10 markup).
BW3–BW7 depend on BW1+BW2; BW8/BW9 gate on markup. Never hand-edit generated templates — the
live `jurisdiction_rules` config is what BW9's editors edit; the Phase-6 pipeline stays the
source for templates.

## 10. Open register (everything PROVISIONAL, in one place)

| Item | Where |
|---|---|
| Kevin's full screen-by-screen pass (docx was pre-review notes) | all drafts |
| Draft 9 markup: role default · two-eyes scope · skip resurfacing · metrics (counts-only drafted) · A/S/R keys | Draft 9 §5 |
| Draft 10 markup: ownership mapping · Director-may propose-vs-apply · v1 depth (all 15 vs high-touch 6) · drill-down in v1 · strict re-attest vs drift-warn | Draft 10 §5 |
| Draft 1 residuals: trigger-list completeness · visual grammars confirmation · inline-waiver conditional · default expand state · queue columns | Draft 1 §5 |
| Draft 2 residuals: first-look banner tone · de-minimis threshold config vs judgment · "Path here" depth · profile visibility | Draft 2 §5 |
| Draft 5 residuals: classifier hint on child assign · activity ordering enforcement · per-child release control location · estimate-data entry form location · MRR task label set | Draft 5 §3 |
| Draft 6 residuals: who attests legal sections · dashboard banner · dev-mode ceremony · re-open friction | Draft 6 §5 |
| Draft 7 residuals: revised-notice home · refund execution record-only · item-hold two doors · requestor-facing allocation · IL forfeiture hard-disable | Draft 7 §5 |
| Portal identity anchors (WS5 blocker — ledger inert until it ships; separate workstream, not this spec) | `requestorLedger.js` header |

---

*Decision log: 2026-07-28 Kevin docx markup (steps 1–4 applied `8ce9965`→`06b329e`) ·
2026-07-29 item-by-item session (five rev-2 decisions, `7eccebe`) · 2026-07-29 Draft 6 scope
(editors drafted now, `4beb375`) · this spec v1.*
