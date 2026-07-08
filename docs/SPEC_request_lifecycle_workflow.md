# Consolidated Spec — Domain 5: Request Lifecycle & Workflow Engine
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]`

## 1. Stages & statuses `[BUILT]`
Stages in use: `intake → fee_review → awaiting_payment → record_search → redaction_review → delivery` plus legal branches `exemption_review` / `ag_review`. Status: `active | closed | completed`. Full audit trail in `request_history` (actor, action, notes, stage_from/to).

## 2. Intake pipeline (onIntake) `[BUILT + fixed 2026-07-08]`
Classify (Domain 3) → build **signals** (classification, record-type confidence, flags) → evaluate the **rulebook** → set routing columns (`department_id`, `record_type_id`) → apply the decided stage **through the one central stage-transition function** (item 6 / §5), which writes the `request_history` advance row (`stage_from → stage_to`) AND spawns/updates the stage's task. onIntake NEVER writes `UPDATE requests SET stage` directly. Confidence ≥ 70 pins `record_type_id`. Every decision persisted to `workflow_decisions` (rule hit, reasoning, flags) for audit. On rule `wfr-confident` with an owning team: additionally spawn the **estimate task** and route it (title becomes "Review auto-generated estimate" when an estimate profile can automate).
> **Open rulebook question (Kevin):** `wfr-confident.actions.stage` is currently `record_search`, so a confident match spawns BOTH an estimate task and (from the record_search transition) a record_search task on the same request. Estimate is meant to precede record search — the decided stage likely should be `fee_review` (or `intake`) so only the estimate task exists at intake. Rulebook data change, tracked in HANDOFF; not a code change.

## 3. Rulebook `[BUILT]`
Human-authored, deterministic rules (`workflow_rules`): ordered by priority, each = conditions over signals → actions {stage, team, note}. Live set: **wfr-sensitive** (sensitive matters stay with a person), **wfr-confident** (straight to the right team), **wfr-uncertain** (→ Open Records), **wfr-fallback**. CRUD gated to SYSTEM_ADMIN/DIRECTOR/SUPERVISOR; `/rules/draft` endpoint for drafting; per-request decision audit endpoint.

## 4. Triage `[BUILT]`
Classifier abstain → request left **Unassigned** (`department_id NULL`); visible to the Open Records team via a needs-triage filter. **Reassigning/routing an Unassigned request spawns and routes its first work task on the new team.**

## 5. Central stage transition & task spawning `[BUILT + fixed 2026-07-08]`
**`applyStageTransition(requestId, toStage, opts)`** (in `taskRouting.js`) is the ONE path for every stage advance (Architecture item 6): it updates the stage, writes the `request_history` advance row (`stage_from → stage_to`), and calls `spawnForStage`. No-op when the stage is unchanged. `spawnForStage` (idempotent) creates the stage's task (record_search / redaction) and routes it (Smart Routing → else pool) — shared by estimate-accept, deposit, payment, settlement, and manual stage change. **Self-healing reconciler** (boot + every 2 min) remains as a belt-and-suspenders net for any active request still stranded at a task-bearing stage.
> **Root cause fixed:** onIntake previously applied the rulebook stage with a raw `UPDATE requests SET stage`, writing no history and spawning no stage task — producing an unlogged jump that stranded the request until the reconciler patched a task in (reproduced on 2026-0039: no STAGE_ADVANCED row, record_search task `created_by: system-reconciler`). Routing onIntake through `applyStageTransition` closes it (verified on 2026-0040: STAGE_ADVANCED `intake → record_search` logged, record_search task `created_by: workflow`). Remaining migration: `requests.js PATCH /:id/stage`, `feeEstimates.js`, and `settlement.js` still transition via their own `UPDATE`+`spawnForStage`; fold them into `applyStageTransition` in a follow-up slice.

## 6. Deadlines, clocks & tolling `[BUILT / PARTIAL]`
Primary **respond clock** starts at intake: calendar days by classification — simple 5, standard 10, complex 20, redaction_required 30. Toll reasons: clarification_pending, payment_pending, extension; AG pre-clearance flow tolls the primary clock and opens an `ag_ruling` clock (satisfied + resumed on ruling; outcome overruled→delivery, sustained→redaction_review). Clock ops (start/toll/resume/satisfy/overdue) via clocks routes; deadlineCalc handles calendar/business-day math. `[PARTIAL — clock durations are in-code defaults; jurisdiction-profile linkage to these durations not verified]`

## 7. Tickler `[BUILT]`
Time-driven sweep that **flags** (never auto-closes by default): (1) estimate-response lapse, (2) deposit overdue, (3) general stall. Business/calendar-day aware; due windows can come from the payment plan. Scheduler + manual `/run` (manager+). Flags set `tickler_flag` on the request; TicklerPage fronts it.

## 8. Workflow model, map & simulator `[BUILT]`
Static workflow model with node detail (`workflowModel`), a visual WorkflowMapPage, and a **simulator** endpoint/page to test how a hypothetical request would classify + route. RequestQueuePage (filters incl. triage), RequestWorkspacePage (detail + pipeline), NewRequestPage, DashboardPage front the lifecycle.

## 9. Known gaps
- Most stages spawn NO task (only record_search/redaction/estimate do) — the full task catalog is the Tasks spec's build plan (SPEC_tasks_roles_mrr_fees §7).
- Clock-duration ↔ jurisdiction profile linkage to verify (see §6).
- ~~Unlogged stage-advance path (one instance) not isolated~~ **ROOT-CAUSED & FIXED 2026-07-08** — onIntake now transitions through `applyStageTransition` (§5). Reconciler retained as a net.
- `wfr-confident` decided stage (`record_search`) spawns estimate + record_search tasks together — open rulebook decision, see §2.
- Other stage-change call sites not yet migrated onto `applyStageTransition` (§5).
