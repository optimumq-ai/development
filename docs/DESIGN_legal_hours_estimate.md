# DESIGN — Legal hours in the estimate (decided 2026-08-13, not built)

**Provenance.** SPEC_tasks_roles_mrr_fees §14 open item; Kevin's sketch 2026-07-15 ("rely on
open-records-office expertise — route such requests for intake review to ORO; MRR defaults to ORO
with manual task assignment — assign a legal estimate task, or plug legal hours directly; a
single-child request leans on the fulfillment team to recognize the need and spawn a legal-estimate
task"). Design pass run 2026-08-13 against the as-built fee engine; the two product forks below were
decided by Kevin the same day (AskUserQuestion, with notice-line previews).

## The problem
An estimate should include legal labor when it can reasonably be *expected*, but "does this request
need legal work" is a judgment (the 12-state review that produced the time-capture config found legal
labor billability too ambiguous to encode — no consistent "review" concept; several states allow
legal-department labor only in certain circumstances). So neither the trigger nor the chargeability
can be a fixed rule. Today the fee engine has three labor drivers (search/review/programming), legal
ACTUALS already reconcile under `review` (`laborActuals.TASK_DRIVER`), and nothing lets legal
expertise contribute expected hours to a quote.

## Principles (all three are established patterns, not new law)
1. **Expertise, not rules, decides the trigger** — people route the question; the system only makes
   sure the question reaches the right people (Kevin's sketch).
2. **Measure always, gate chargeability** — legal hours are always *recorded* on the estimate; the
   city's fee profile decides whether they *price* (the time-capture Fork-1 / laborGate pattern).
3. **One author per estimate snapshot** — `request_fee_estimates` is append-only with a single
   author per POST. Legal contributes an INPUT the estimator accepts, never a competing estimate.

## Part A — Getting the question to legal-aware eyes (mostly BUILT)
- BUILT: classifier flags (SENSITIVE / LEGAL_HOLD / ONGOING_INVESTIGATION) already route the request
  to the open-records team at intake (`wfr-sensitive`, priority 5, `team:'open_records'`, stop) and
  spawn an `intake_review` with trigger `sensitivity_flag`. This IS "route might-need-legal to ORO."
- **ADD (deterministic half):** a request whose classified record type carries
  `legal_redaction_required = 1` (walking up to the parent type — the gate never loosens at a more
  specific level) also spawns `intake_review`, new trigger key **`legal_rt`**. Today that flag fires
  only at redaction-stage; a type the city marked "always legal work" is exactly the "can reasonably
  be expected" case and should be visible at pricing time. Idempotent-additive like every other
  trigger (a second trigger adds its key to the open task).

## Part B — The `legal_estimate` ask
- **New task type `legal_estimate`.** Hand-assigned only (join `HAND_ASSIGNED_TASK_TYPES`, like the
  MRR activities — no pool claims it); eligibility = the existing **`legal_review`** token (the
  office's legal staff; no new grant to administer). NULLABLE request link stays NOT NULL here — the
  ask is always about a request.
- **Spawn paths** (both from Kevin's sketch):
  - **Single-child:** an "Ask legal for hours" action on the ESTIMATE task screen (pricing is where
    the need is recognized). Opens an assignee picker filtered to `legal_review` holders + a
    required "what should legal look at" note.
  - **MRR:** the same ask from the hub master (parent-level — exemption analysis spans items;
    deliberately NOT a per-child activity), OR the manager just types hours directly into the
    estimate's `legalHours` field. Both of the sketch's routes exist; neither is forced.
- **The answer is structured, not prose** (the MRR roll-up's numbers-as-prose is the recorded
  anti-pattern): new table **`legal_estimate_inputs`** — one row per ASK+ANSWER exchange
  `(id, request_id, task_id, ask_note NOT NULL, asked_by/_name/_at, hours NUMERIC, note TEXT,
  entered_by/_name/_at, superseded INTEGER DEFAULT 0)` `[as built, slice 1: the ask half lives in
  the same row — tasks has no notes column, and the question belongs with its answer]`. Completing
  the task fills the answer half (+ `request_history` `LEGAL_HOURS_ESTIMATED`); a re-ask cancels the
  open task and supersedes its row; a new answer supersedes the previous one. The legal_estimate
  task gets a thin dedicated screen (context header · request description · hours + required note ·
  complete) — **with its MyTasksPage `TASK_SCREEN` entry in the same slice** (the reachability
  lesson: a backend path with no screen entry is unreachable work, verify_legal_review §H class).
- **The estimator stays the author:** the estimate panel shows the answer as a banner
  ("Legal's answer: 3.0h — Dana Whitfield: '…'"). The one-click **Accept** that fills `legalHours`
  ships WITH the engine's Legal line in slice 2 — in slice 1 there is no `legalHours` field to fill,
  and a control that pretends to apply the answer would be theatre; until then the banner feeds the
  estimator's judgment. Accepting is an act, not an automatic merge.

## Part C — Pricing (`feeEngine`)
- New per-component quantity **`legalHours`** in `input_json.quantities`, priced as a fourth labor
  line **"Legal review"**.
- **Config inherits parent-ward** (the variant-inheritance pattern): absent `labor.legal` in the fee
  profile, legal hours take the **`review`** driver's entire config — rate, increment, rounding,
  `billable`, `billableWhen`, citations. A city whose statute treats legal time differently sets
  `labor.legal.{rate|billable|billableWhen|citation}` to diverge. Purpose overrides
  (commercial/inspection) apply the same way. Free-hours consumption order becomes
  search → review → **legal** → programming.
- Actuals stay as they are (legal_review/legal_redaction seconds → `review`); reconciliation
  compares estimated **(review + legal)** against actual review so the variance is apples-to-apples.
  No change to `laborActuals.TASK_DRIVER`.

## The two decided forks (Kevin, 2026-08-13)
1. **Soft block.** An open legal ask does NOT stop the estimate going to the citizen — the statutory
   clock keeps pressure on. The send flow shows a "legal hours pending" warning; if legal's later
   answer changes the price, the existing revision/renotify machinery
   (`estimatePolicy.revisionNotifyPercent`) handles it. No new mechanism.
2. **Own notice line.** The citizen's estimate shows "Legal review (N hrs @ rate)" as its own line,
   not folded into Review & redaction. (Chosen from previews.)

## Build slices (each with its own harness; order matters)
1. **The ask + the answer** `[BUILT 2026-08-13 — verify_legal_estimate]`: schema
   (`legal_estimate_inputs`), task type + hand-assign spawn route (`/api/legal-estimate`), the thin
   task screen + TASK_SCREEN entry, estimate-panel ask modal + pending/answer banners, soft
   pending-ask warning (display only — Accept waits for slice 2's `legalHours` field).
2. **The engine line** `[BUILT 2026-08-13 — verify_legal_line]`: `legalHours` quantity priced as
   `legal_labor` ("Legal review of the records" on the notice); `feeEngine.legalLaborConfig`
   inherit-with-override (shared with chargeability so the builder's boxes agree with the engine);
   free-hours order search → review → legal → programming; reconciliation pairing (applyMeasuredLabor
   zeroes estimated legalHours; estimatedHoursFromInput folds legal into the review figure); panel
   field + Accept-into-legalHours on the answer banner (first component, mirroring where measured
   labor lands).
3. **The deterministic trigger:** `legal_rt` intake_review trigger off `legal_redaction_required`
   with parent walk-up. (extend `verify_bw3_intake_review`)
4. **MRR hub wiring:** parent-level ask button; `legalHours` on the master estimate form.
   (extend `verify_bw6_mrr`)

## Out of scope (recorded so they aren't rediscovered)
- Attorney-rate schedules: no separate legal rate unless the city sets `labor.legal.rate`.
- Auto-detecting "needs legal" beyond the existing flags + the record-type gate — expertise routes
  the question; the system doesn't guess.
- Time-capture for the legal_estimate task itself (it's minutes of judgment, not billable
  production work; it stays out of `laborActuals.TASK_DRIVER`).
