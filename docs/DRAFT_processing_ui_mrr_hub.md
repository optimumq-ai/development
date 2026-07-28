# DRAFT — Processing UI, session 1 (screen 5): MRR Management

**Status:** DESIGN DRAFT rev 5b for Kevin's markup, 2026-07-28. Not a spec, not for build.
**Mockup:** `docs/mockups/PROCESSING_UI_draft5_mrr_hub.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — four screens: My Tasks MRR grouping · MRR overview · master record
view · child record view. Single city (Austin TX; OH is one annotation).

> **Rev 5b supersedes 5a entirely.** 5a was drafted against `SPEC_parent_child_lifecycle.md`
> §14.2–14.3, including a "Kevin's shape (2026-07-16)" attribution Kevin does not recognize —
> **his 2026-07-28 message is the first actual MRR UI direction on record**, and this rev encodes
> it. The §14.3 attribution and §14.2's suggest-and-confirm emphasis are flagged for correction in
> the spec when this design is ratified. (What survives from §14: parent-line + child-lines shape,
> external contributor, Verify ≠ Approve, one-voice, statutory-clock-on-parent, hold-not-early-
> release, no parent disposition.)

## 0. Kevin's direction — 2026-07-28 (verbatim intent, structured)

1. **Task type: MRR Management.** Routes to ORO; pool-assigns to an **eligible ORO Associate**;
   lands in a **My Tasks MRR grouping**. (Replaces the never-built `mrr_processing` key — new
   name, added together with its spawner.)
2. **The parent stays assigned until all child records are terminal.**
3. **The MRR screen allows an overview of all records in process.** Clicking into a master record
   summarizes master-level info at the top, with **a line item for each child below, as a bar**
   with task statuses and tags (vague, denied, …).
4. **Clicking into a child record** lets the manager **do or assign** Record Search — same for
   Estimate data gathering and Redaction.
5. **These are distinct from the non-MRR estimate/search/redaction tasks.** They **do not move
   forward in a process**: the assignee sees e.g. **"MRR REDACTION"** on their My Tasks; completion
   updates the MRR screen, which shows **"Assigned to"** and **Queued / In Process / Complete**.
6. **Child-level manager powers:** Mark Vague; **designate denial at the child level AND submit
   for Legal Review**.
7. **Parent-level estimate readiness:** the screen indicates whether all child estimate data is
   complete, and then the **Generate Estimate button becomes active and highlighted**.

## 1. Design choices made in the draft (first pass, per "design what you feel is best")

- **Four-level navigation:** My Tasks group → overview (all MRRs, manager column — oversight roles
  read-only) → master record → child record.
- **Bar anatomy:** label · description · three activity chips (Search / Estimate / Redaction, each
  `Not started · Queued · In Process · Complete · Not required`) · assignee · tags
  (`Vague`, `Denial designated → Legal Review`, `External`). Click = child view.
- **Child view = three activity blocks**, each with status + assignee + Reassign / Do-it-myself;
  an inset shows what the assignee sees, to make "never advances a stage" visible.
- **Estimate readiness meter** on the master card ("2 of 4"), disabled Generate button, and a
  ghost strip showing the active+highlighted state; one estimate for the master through the
  standard engine; Verify (staff) ≠ Approve (requestor).
- **Denial designation is not a denial:** it sends the item to Legal Review (Draft 4) with grounds
  attached; upheld → Denial Compose (Draft 3). Tag on the bar meanwhile.
- **Kept from standing design:** external contributor token link (bar shows link state);
  requestor-level chips on the master card (no intake review for MRR); one-voice (contact-requestor
  only on MRR screens; assignees get "email the Request Manager"); statutory clock master-only.
- **Catalog impact:** new keys `mrr_management` (routable, eligibility) and `mrr_redaction`
  (hand-assigned, joining `mrr_estimate` / `mrr_search`); MASTER A2 updated at ratification.

## 2. Bindings

| Surface | Binds to |
|---|---|
| MRR Management task | NEW type + spawner on `child_count > 1` at intake; eligibility via `user_task_types`; long-lived (closes when all children terminal) |
| My Tasks grouping | My Tasks grouped by task type; MRR child tasks appear under their own names incl. the manager's own |
| Overview | all parents with `child_count > 1` and `parent_state = In Process` + manager (task assignee) |
| Bars / statuses | child activity records: NEW lightweight `mrr_tasks` (type search/estimate/redaction, assignee, status Queued/InProcess/Complete) — deliberately NOT `applyStageTransition` consumers |
| Estimate readiness | per-child estimate-data records → n/m meter → Generate Estimate → standard engine (§6.4), Verify vs requestor-approval acceptance gate |
| Mark Vague | `clarificationAction` (reason vague), outreach via the RM (one voice) |
| Denial designation | NEW: child flag + grounds → spawns `legal_review` (Draft 4) → Denial Compose (Draft 3) |
| External contributor | token substrate (secure, expiring, single-use; state on the bar) |
| Master card chips | Draft 1 bindings, parent-scoped (eligibility findings, `/ledger/request/:id`, `/approval-modules`) |

## 3. Open questions for Kevin

1. **Overview scope** — drafted as *all* MRRs in process with a manager column (oversight sees the
   same screen read-only). Or should it be my-MRRs-only with an explicit all-office toggle?
2. **Does the classifier still suggest?** The draft drops suggest-and-confirm as the centerpiece;
   should the child assign-picker at least show the classifier's team/person hint, or stay clean?
3. **Activity ordering** — drafted with no enforced order (manager orchestrates; Redaction shows
   "Queued … when search completes" as convention, not a gate). Should the system enforce
   search-before-redaction on MRR items, or trust the manager?
4. **Delivery/release per child** — `as_ready` release of completed children (standing §5.8): does
   the child view need an explicit release/hold control, or is that the parent financial view's job?
5. **Estimate data entry** — child view shows "entered by / view-edit"; is the entry form itself a
   drawer here, or part of the Generate Estimate worksheet at the master level?
6. **`mrr_estimate` vs estimate data gathering naming** — the task the assignee sees is drafted as
   "MRR ESTIMATE"; confirm the label set (MRR SEARCH / MRR ESTIMATE / MRR REDACTION).

## 4. Not re-opened

Child eight-disposition vocabulary; no parent disposition (`In Process`/`Complete` derived);
statutory clock parent-only; §5.9 coverage rule; Verify ≠ Approve; one-voice; no auto-denial.
