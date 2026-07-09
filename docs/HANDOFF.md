# OptimumQ — Session Handoff Log

Newest entries at the bottom. One short block per session: what changed, evidence, open items.

---

## 2026-07-08 — Central stage-transition function; onIntake unlogged-advance fix

**Slice:** Root-cause the reconciler's stranded requests (Architecture item 6).

**Changed**
- `backend/src/services/taskRouting.js` — new `applyStageTransition(requestId, toStage, opts)`: the ONE stage-advance path. Updates stage, writes the `request_history` advance row (`stage_from → stage_to`), and calls `spawnForStage`. No-op when stage is unchanged. Exported.
- `backend/src/services/workflowEngine.js` — `onIntake` no longer does a raw `UPDATE requests SET stage`. It now sets only routing columns (`department_id`, `record_type_id`), then applies the decided stage through `applyStageTransition`. This was the unlogged advance.
- `backend/src/routes/publicChat.js` — `/submit`: `cls` is now declared `var cls = null;` **before** the classification `try`, so the outside-the-try `onIntake(id, cls)` call never receives `undefined` when classification throws (onIntake then falls back to its own classification).
- `docs/SPEC_request_lifecycle_workflow.md` — §2, §5, §9 updated (same commit).

**Evidence (verified in the running app)**
- Broken repro **2026-0039**: no `STAGE_ADVANCED` history row (only CREATED + CLASSIFIED); at `record_search` with two open tasks — `estimate` (`created_by: workflow`) **and** `record_search` (`created_by: system-reconciler`, i.e. patched in 2 min late).
- Fresh submit **2026-0040** via `POST /api/public/submit` (real creation path): `request_history` now has `STAGE_ADVANCED  intake → record_search` (actor "Workflow Engine", reasoning captured); the `record_search` task is `created_by: workflow` — spawned deterministically at intake, not by the reconciler.

**Open items / for Kevin**
- **Rulebook decision — fee_review vs record_search.** `wfr-confident.actions.stage` is `record_search`, so a confident match still spawns BOTH an `estimate` task and a `record_search` task on the same request (now both `created_by: workflow`, deterministic and logged — but still two tasks for one request). Estimate is meant to precede record search, so the decided stage likely should be `fee_review` (or `intake`) so only the estimate task exists at intake. Left unchanged per instruction — this is a `workflow_rules` data change, not code. Flagged in SPEC §2.
- **Follow-up slice:** migrate the other stage-change call sites onto `applyStageTransition` — `requests.js PATCH /:id/stage`, `feeEstimates.js` (3 sites), `settlement.js`. They already log + spawn, but via their own `UPDATE`+`spawnForStage`; folding them in enforces item 6 everywhere. Reconciler stays as the safety net.

**Note:** API restarted by terminating the `optimumq`-owned `server.js` (root PM2 daemon auto-respawned it with the new code); `pm2 restart optimumq-api` needs the root PM2 daemon, not the `optimumq` user's.

## 2026-07-09 — Migrate all remaining stage-change sites onto applyStageTransition

**Slice:** Complete the 2026-07-08 follow-up — enforce Architecture item 6 (no direct `UPDATE requests SET stage`) at every remaining call site. Reconciler stays as the net.

**Changed**
- `backend/src/services/taskRouting.js` — `applyStageTransition` gains an `opts.clearTickler` flag: on a real transition it also nulls `tickler_flag`/`tickler_flagged_at` in the same UPDATE. Kept per-caller (only the reactivation sites pass it), NOT universal — see open item.
- `backend/src/routes/requests.js` — `PATCH /:id/stage`, `assert-exemption` (ag_review / exemption_review), and `ag-ruling` (delivery / redaction_review) now route through `applyStageTransition`. Their `UPDATE`+`logHistory`(+`spawnForStage`) trios deleted.
- `backend/src/routes/feeEstimates.js` — estimate-accept, deposit/record, and cashier payment/record (deposit branch) migrated; each passes its domain action (`ESTIMATE_ACCEPTED`/`DEPOSIT_RECORDED`) + `clearTickler:true`. The non-transition else-branch (deposit while not awaiting_payment) keeps its plain `hist()`.
- `backend/src/routes/settlement.js` — ERP `payment-applied` deposit branch migrated (`actorName:'ERP'`, `clearTickler:true`).
- `docs/SPEC_request_lifecycle_workflow.md` — §5 rewritten (migration completed + opts documented); §9 open item closed. Same commit.
- Only `tickler.js`'s closure (`→ closed`, sets `closure_reason`+`tickler_flag`) still writes stage directly — deliberately out of scope (different semantics).

**Two intended behavior changes (flagged before building, confirmed):**
1. Domain detail text now lands in `request_history.notes` (which the workspace UI renders) instead of the unread `details` column — those events were previously invisible in the audit tab.
2. `ag-ruling → redaction_review` now spawns the redaction task deterministically at ruling time; previously it was left for the 2-min reconciler.

**Evidence (verified in the running app, API pid 12744 on new code)**
- Real submit **2026-0041** via `POST /api/public/submit`.
- `PATCH /:id/stage record_search → redaction_review` (authenticated): `request_history` got `STAGE_ADVANCED record_search → redaction_review` and a `redaction` task spawned + routed (confirmed via app DB module: tasks = record_search/estimate/redaction).
- `clearTickler` branch driven through the real `applyStageTransition` (harness): request at `awaiting_payment` with `tickler_flag='awaiting deposit'` → after transition, stage `record_search`, status `active`, `tickler_flag`/`tickler_flagged_at` both NULL, history row `DEPOSIT_RECORDED awaiting_payment → record_search` with notes captured.
- Grep confirms no direct `UPDATE requests SET stage` remains except `tickler.js:88` (closure) and the one write inside `applyStageTransition`.

**Open items / for Kevin**
- **Tickler semantics (own future slice):** we kept `clearTickler` per-caller to preserve behavior exactly. Open question: should ANY active-stage advance clear the tickler flag (make it universal in `applyStageTransition`), rather than only the reactivation sites? Decide against the tickler service, not as a drive-by.
- **`tickler.js` closure** still writes stage directly; folding it in needs `applyStageTransition` to carry `closure_reason` + a "set (not clear) tickler_flag" mode. Small follow-up.
- Prior open item still stands: `wfr-confident` decided stage spawns estimate + record_search together (rulebook data decision, §2).

## 2026-07-09 (b) — Tickler flag clears automatically on any forward stage advance

**Slice:** Resolve the open tickler-clearing question from slice (a). Decision (Kevin): **every forward move clears the flag** — direction-based, not per-caller.

**Changed**
- `backend/src/services/taskRouting.js` — added canonical `STAGE_ORDER` (`intake → fee_review → awaiting_payment → record_search → exemption_review → ag_review → redaction_review → redaction → delivery → closed`) and `isForwardStage(from,to)`. `applyStageTransition` now nulls `tickler_flag`/`tickler_flagged_at` automatically whenever the transition is forward; backward/lateral moves leave the flag; an unknown stage is treated as not-forward and logged. The per-caller `clearTickler` opt is **removed** — the logic lives entirely in the one central function.
- `feeEstimates.js` (3 sites) + `settlement.js` — dropped the now-redundant `clearTickler: true`.
- `docs/SPEC_request_lifecycle_workflow.md` — §5 tickler-clearing note rewritten; §9 open question marked DECIDED. Same commit.

**Evidence (verified against the running app, API pid 16979 on new code)**
- FORWARD `awaiting_payment → record_search`: flag CLEARED ✓
- BACKWARD `record_search → awaiting_payment`: flag KEPT ✓
- FORWARD into a branch `record_search → ag_review`: flag CLEARED ✓ (confirms "every forward move", incl. into review/AG branches)

**Note:** `STAGE_ORDER` is now the single source of truth for "forward." If a new stage value is added to the pipeline, add it here too (an unknown stage logs a warn and is treated as not-forward, so flags simply won't auto-clear on those transitions until it's listed).

## 2026-07-09 (c) — Fee-waiver approval task routing (Tier 1 #4, interim role)

**Slice:** Wire the intake `fee_waiver_requested` flag → an approval task on the approver's list, and let the approver resolve it (BUILD_PRIORITY Tier 1 #4 / D4 §5, §9).

**Design note / decision (Kevin):** The summary's "role exists" premise was false. OptimumQ has TWO role systems — **permission roles** (task routing, e.g. `FEE_AUTHORITY`) and **function roles** (`requireRole`, e.g. `SUPERVISOR`). `FEE_WAIVER_APPROVER` exists in neither as a routable role, and the spec's intended `Finance` role is `[DECISION/NOT BUILT]` (§8, tied to the catalog reconciliation, item 9). Kevin chose the **interim**: route to the existing `FEE_AUTHORITY` permission role now, re-point when Finance lands.

**Changed**
- `taskRouting.js` — `TASK_ROLES.fee_waiver = 'FEE_AUTHORITY'`.
- `workflowEngine.js` — `onIntake` now spawns a `fee_waiver` task ("Decide fee-waiver request") when `fee_waiver_requested` is set and no decision recorded yet. Team-agnostic (`team_id=NULL`) so it pools to every `FEE_AUTHORITY` holder; idempotent; independent of the estimate task (a granted waiver zeroes fees at notice time).
- `requests.js` `POST /:id/fee-waiver-decision` — replaced the broken `requireRole('...FEE_WAIVER_APPROVER')` (gated a nonexistent role) with an inline check: function `SYSTEM_ADMIN/DIRECTOR/SUPERVISOR` OR permission `FEE_AUTHORITY` (so whoever receives the task can act). Both grant + deny now mark the open `fee_waiver` task `done`. Dropped the now-unused `requireRole` import.
- `docs/SPEC_tasks_roles_mrr_fees.md` §5 + §9 updated same commit.

**Evidence (verified in the running app, API pid 21637)**
- Submit **2026-0042** via `POST /api/public/submit` with `feeWaiverRequested:true` → `fee_waiver` task spawned (`role_required=FEE_AUTHORITY`, `team_id=NULL`), Smart-Routed to a FEE_AUTHORITY holder; a non-authority user does NOT see it in pool.
- Non-authority user (pnair) `POST .../fee-waiver-decision` → **HTTP 403**.
- FEE_AUTHORITY holder (dfoster) grants → `fee_waiver_status='granted'`, `decided_by='Diane Foster'`, task `status='done'`, `FEE_WAIVER_GRANTED` history row.

**Open items / for Kevin**
- **Interim role** — re-point `TASK_ROLES.fee_waiver` and the decision-endpoint auth from `FEE_AUTHORITY` to `Finance` when item 9 (catalog reconciliation + `FEE_WAIVER_APPROVER→Finance` rename) lands.
- **Smart-routing vs pool for approvals** — the task auto-assigned to one approver by specialization text-match. Functionally on an approver's list, but a shared approval arguably belongs in the pool for any approver to claim. Small refinement if desired (spawn without `autoRouteOrPool`, or a "pool-only" task flag).
- **Commercial-rate trigger** (`purpose='commercial'`) not wired — same task type, different trigger. Follow-up.
- No My-Tasks *screen* work here (per UI rule — needs design agreement); this is backend routing only.

## 2026-07-09 (d) — Record-search task screen: design spec drafted (PAUSED, awaiting Kevin markup + research)

**Slice:** Design the dedicated **record-search task screen** (Tier 1 #1, `[NOT BUILT]`) — what a Fulfillment Staff (Record Search) member sees when clicking a `record_search` My-Task. No code written yet; this session was design + investigation, captured in a new spec.

**Produced**
- `docs/SPEC_record_search_task_screen.md` `[NEW]` — full design spec (companion to `SPEC_record_search_fulfillment.md` §3 and `MASTER_task_types_permission_groups.md`). Untracked (not committed — will branch off `main` after markup). Covers: gating rules (§1), carried-forward intake context (§2), one-screen **format toggle** Digital/AV/Paper/Other auto-defaulted from `record_types.formats` (§3), per-format behavior (§4), effort-trail actions rail — confer/contact/log-call + found/no-responsive resolution (§5), three-zone layout (§6), data-model/routing changes (§7), open decisions (§8).

**Key investigation findings (verified against code 2026-07-09)**
- **Format IS stored** by the taxonomy: `record_types.formats` (JSON `video|pdf|structured_data|email|physical|mixed`) + per-repo `record_type_repositories.format`. Classifier assigns one record type per request → clean default for the toggle.
- **Template exists:** `EstimateTaskPage.js` (route `estimate/:taskId`) is the proven task-screen pattern to mirror. **`MyTasksPage` currently routes every task to the generic `/requests/:id`** (needs per-task-type routing).
- **Search engine `[BUILT]`:** `recordSearch.js` (connectors demo/Tyler/Axon/Laserfiche, public-ready tier, keyword+semantic). Record-search screen is mostly UI over an existing engine.
- **Carried-forward results half-built:** selected records persist to `request_selected_records` `[BUILT]`; **shown-but-unselected candidates are NOT persisted anywhere** `[NOT BUILT]` — needs a submit-side addition (`request_intake_results` or a flag) in `publicChat.js`.
- **§1 gating VERIFIED unbuilt:** selection has zero effect on routing — `request_selected_records` is read by no service; `workflowEngine.buildSignals` has no "selected" signal; the 4 seeded `workflow_rules` only route to `intake`/`record_search`. Build recipe (2 `buildSignals` fields + 2 rulebook rows, no engine change) documented in spec §1. **§8 #4 RESOLVED.**
- **Tolling engine `[BUILT]`, un-triggered:** `services/tolling.js` + `routes/clocks.js` (mounted `server.js:47` `/api/clocks`) fully support pause/resume; **`clarification_pending` is a declared toll reason but nothing ever fires it** (only `ag_ruling_pending` is invoked, `requests.js:229`). The screen's "Contact requestor" button is the natural first caller. Rules are per-jurisdiction via `deadline_rules`/Jurisdiction Profile. Spec §5b captures this + a 6-dimension research checklist.
- **Address gap:** no mailing address is captured anywhere (intake collects name/email/phone only; `requests` has no address column) → postal clarification/delivery can't produce a mailable letter. Flagged in §5b as a separate intake-side fix.

**PAUSED here — resume checklist**
1. **Kevin** is marking up `SPEC_record_search_task_screen.md` and assembling jurisdiction tolling research (~12 cities, per the estimate-engine process) — the 6 dimensions in §5b.
2. On return: fold Kevin's markup into the spec; then **branch off `main`** (e.g. `spec/record-search-task-screen`) and commit the spec.
3. Resolve remaining §8 open decisions: build order (#1), intake-results persistence scope (#2), video scoping (#3), tolling research (#5).
4. Then build: `RecordSearchTaskPage.js` + route + `MyTasksPage` per-task-type routing, per the spec.

**No code changed this session — docs only** (`SPEC_record_search_task_screen.md` new; this handoff entry). Working tree otherwise unchanged; `main` still at `d8d6b36`.

## 2026-07-09 (e) — Redaction task screen: design spec drafted (PAUSED, awaiting Kevin markup)

**Slice:** Spec the **redaction task screen** (Tier 1 #2, sibling to the record-search screen) — what a redaction worker sees when clicking a `redaction` / `legal_redaction` My-Task. Design only, no code.

**Produced**
- `docs/SPEC_redaction_task_screen.md` `[NEW]` — sibling to `SPEC_record_search_task_screen.md`; companion to `SPEC_redaction.md` (Domain 8). Untracked (commit with the record-search spec after markup).

**Key framing / findings (verified against code 2026-07-09)**
- Unlike record search, the redaction domain is **mostly `[BUILT]`** — the gap is only the **task-level entry point**. Today a redaction task lands on the generic `/requests/:id` workspace.
- Per-file tools all exist: doc canvas `redact/:fileId` (`RedactionWorkspacePage`), review `redact/:fileId/review`, A/V `av-redact/:requestId/:fileId` (`AvWorkbenchPage`), structured `redact-fields/:fileId`. Job/zone/apply lifecycle + release→`fulfilled_records`→publish all built (`redactionJobs.js`, `redactionApply.js`). Task routing built (`STAGE_TASK`: redaction_review|redaction → `redaction`, escalates to `legal_redaction` when legally flagged).
- The screen = a **task hub**: responsive-file worklist + per-file job status + route-each-file-to-the-right-tool-by-`mimetype` (§3), legal escalation (§4), review visibility (§5), completion when all files `released` → advance via `applyStageTransition` (§6).
- **Discrepancy found (flagged, not fixed):** `RequestWorkspacePage` uses a legacy stage order (`…record_search → redaction_review → fee_review → awaiting_payment → delivery`) that differs from `taskRouting.STAGE_ORDER` (`…record_search → exemption_review → ag_review → redaction_review → redaction → delivery`). Task screen must advance via canonical `STAGE_ORDER`; reconcile the two as a separate slice.
- Open decisions in §9: redaction-vs-review one task or two (#1); worklist source query (#2); structured-data detection reliability (#3); stage-order reconciliation (#4); build order vs record-search (#5).

**Upstream "is redaction required?" research added (spec §1A):** verified 2026-07-09 —
- Redaction-required *signals* exist (`public_availability`, `auto_release_eligible`, `redaction_flag`, `classification=redaction_required`) but **nothing skips the redaction stage** on them. Skip-gate nodes `public-ready` (status *partial*) and `known-clean` (status *planned*, needs a "known-clean registry") are designed, not wired. Library/public-ready selections don't skip redaction (selection gates nothing — cross-ref record-search §1).
- **Template reuse is substantially BUILT** (`layout_profiles` + `redactionTemplates.js`: `buildFingerprint`, `POST /match` ≥ `safety_threshold`, `/match-batch`, `applyTemplateToFile`) **but wired only into mass jobs** — the single-file job open (`POST /file/:fileId/job`) does not auto-run `/match`. Task screen should call it on file open + one-click apply.
- Residual research TODOs in §1A: what `public-ready` "partial" already does; build the known-clean registry (skip gate); re-redaction dedup vs existing released job/`fulfilled_record` (none found); whether the canvas already auto-matches.

**Both specs (d + e) are PAUSED awaiting Kevin's markup, then branch off `main` and commit together.** No code changed; `main` still at `d8d6b36`.
