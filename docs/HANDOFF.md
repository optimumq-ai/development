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

## 2026-07-09 (f) — Clarification/vague-request policy: research digest + config substrate (slice 1)

**Slice:** Kevin supplied two AI research passes (vague/insufficient-description rules) → distilled to a digest,
then built the config SUBSTRATE (slice 1 of 3) so the vagueness-clarification workflow has a slot to hold
per-jurisdiction rules. Design direction agreed live: AI-drafts / city-reviews / attest / or turn-off / manual
— which is already the ratified AUTO_CONFIG trust model; this just adds the missing substrate.

**Produced (docs):**
- `docs/CLARIFICATION_POLICY_SURVEY.md` `[NEW]` — 16-jurisdiction survey, the 7-field `clarification_policy`
  substrate (crux: 6-value `clarification_clock_effect` enum), engine-action mapping, matrices, cross-doc
  discrepancies (MICHIGAN clock model is a flagged conflict), open decisions, and the 3-slice build order.
- `imports/research/{vague_description_rules,claude_vague_description_rules}.pdf` — the two source PDFs (tracked).
- `SPEC_record_search_task_screen.md` §5b — cross-reference: the tolling research is now GATHERED.
- Committed: `73ea0a6` (digest) then `4d729a3` (slice-1 code, which also marked §8 slice 1 BUILT).

**Built (backend, commit 4d729a3):**
- `services/clarificationPolicy.js` — owns schema/defaults(all off)/`enabled` master switch/validation/
  read+write to `system_config 'clarification_policy'`; `automationActive(policy,attested)` gates slice 2.
- `configExtractors.js` `clarification` adapter (applyMode live) → writes ride `effectiveConfig` (history +
  profile sync); slice-3 extractor pre-wired via `genericExtract`.
- `jurisdictionProfile.js` `clarification` section → readiness + attestation gate (off/un-attested = safe/manual).
- `routes/clarificationPolicy.js` + server mount → `GET/POST /api/clarification-policy` (SYSTEM_ADMIN|DIRECTOR).

**Evidence (verified live, API pid 134851 on new code):** GET → defaults (enabled:false, all off, 7 fields);
POST bad enum → HTTP 400 with allowed list; POST valid (toll_and_restart, grace "30"→30, provenance) →
persisted; jurisdiction profile `clarification` section not_configured → configured, version 0→1 (attestation
re-arm), source manual-edit; `config_history` clarification row written; reset {enabled:false} → back to safe
default (version→2). System left OFF/safe-manual.

**Note on restart:** `pm2 restart optimumq-api` fails for the `optimumq` user (process runs under the ROOT PM2
daemon). Restart by `kill <server.js pid>` — the root daemon auto-respawns with new code (confirmed).

**Open items / next slices:**
- **Slice 2 (trigger):** wire the record-search "Contact requestor" button to the tolling engine via
  `clarification_clock_effect` (fires the declared-but-unused `clarification_pending` toll); implement all six
  behaviors incl. restart + start-gate; gate on `automationActive`.
- **Slice 3 (extractor):** point a config-freshness source doc at the `clarification` adapter → review/attest UI.
- **UI editor form** for the 7 fields — DEFERRED pending a design nod (UI rule); backend driven via API today.
- **Michigan clock-model conflict** (survey §5.1) — resolve before MI ships.
- Survey §5.2 open decisions: single vs per-classification grace days; keep `operational_hold` distinct; state→city precedence.
- Per-jurisdiction storage: policy is stored GLOBALLY in `system_config` today (mirrors `deadline_rules`);
  per-jid + precedence stack is future Jurisdiction-Profile work.

## 2026-07-09 (g) — Clarification policy slice 2: the tolling TRIGGER (BUILT)

**Slice:** Wire the record-search "Contact requestor" clarification action to the tolling engine, honoring
all six `clarification_clock_effect` behaviors, gated on `automationActive`. This fires the declared-but-
unused `clarification_pending` toll for the first time. Backend only (the UI button waits on the
record-search screen). Continues on `spec/task-screens` where slices 0–1 live.

**Built (backend):**
- `services/clarificationAction.js` `[NEW]` — `send()` / `resolve()`. Maps the 6 effects → engine actions:
  `no_fixed_clock` / `runs_no_stop` → no pause; `toll_pause_resume` / `operational_hold` → toll on send,
  resume on reply; `toll_and_restart` / `start_gate` → toll on send, **restart** on reply. Always writes the
  effort-trail event (`CLARIFICATION_REQUESTED` / `CLARIFICATION_RECEIVED`, incl. vague flag); touches the
  clock ONLY when `clarificationPolicy.automationActive(policy, attested)` (policy enabled AND jurisdiction
  `clarification` section attested). Effect is read from the live policy at both send and reply (stateless).
- `services/tolling.js` — added `restart(clockId)`: closes open tolls, resets `started_at` to now → clean
  full duration. Plus a `computeStatus` epoch clamp (ignore toll time before `started_at`) so prior toll
  rows are **retained as audit** but don't inflate the due date. Clamp is a no-op for normal (post-start)
  tolls, so existing clocks are unaffected.
- `routes/requests.js` — `POST /api/requests/:id/clarification` and `.../clarification/resolve` (`requireAuth`).

**Evidence (verified):** service harness on a real intake request drove all six effects end-to-end —
OFF path (enabled=false) took no clock action (`automation_inactive_manual`); the four pausing effects tolled
on send; resume vs restart applied correctly on reply; a restarted clock read consumed 0 / tolled 0 /
remaining = full duration (4 toll rows retained as audit); 13 CLARIFICATION history events written with the
right effect + vague flag. System reset to enabled=false / un-attested / safe. Test requests cleaned up.
API restarted (kill pid → root PM2 respawn, new pid 150757, health 200); both new endpoints return **401**
(mounted + auth-gated), matching the control route. Specs updated same-commit (survey §8.2, spec §5b → BUILT).

**Next (slice 3 + siblings):** (a) config-freshness **extractor** → drafts the 7 fields from an uploaded
policy doc → review/attest; (b) **outreach mechanics** (§5b) — email template vs printable postal letter on
`delivery_method` (+ the intake mailing-address gap); (c) **auto-close** `clarification-timeout` node using
`clarification_grace_days` / `abandonment_grace_days`; (d) **UI editor form** for the 7 fields and the
"Contact requestor" **button** (both wait on design nods per the UI rule); (e) Michigan clock-model conflict
(survey §5.1). Note: `/api/requests/public` (server.js direct handler) returned a 500 during testing —
pre-existing, unrelated to this slice, worth a look separately.

**Infra note (this session):** droplet had **no swap** on 3.8 GB RAM → likely OOM-killed the prior session
(the "scrambled text then vanished" symptom; not confirmable — dmesg ring buffer empty, but journald is now
persistent so a recurrence will be logged). Added a persistent 4 GB swapfile + `vm.swappiness=10`
(`/home/optimumq/harden-swap.sh`). Recommended going forward: run Claude Code inside **tmux** (installed,
3.2a) so an SSH drop / terminal scramble can't lose the session. Optional `disable-desktop.sh` reclaims the
Xorg/sddm RAM (headless box).

## 2026-07-09 (h) — Public-submit 500 fix + clarification policy slice 3 (extractor, BUILT)

**Two commits this session after slice 2.**

**(1) Public-submit 500 fix — `0278e42`.** `/api/requests/public` (the `server.js` direct handler)
computed the next request number from the single newest row by `created_at`. That row is a `DEMO-*` seed
(`DEMO-2026-5069`) → `parseInt('DEMO')` is NaN → counter reset to 1 → INSERT `2026-0001` → duplicate-key
23505 → 500, blocking ALL public submissions. Fixed to number within the current-year `'YYYY-%'` series
ordered by `request_number` (same as `routes/requests.js generateRequestNumber`). Verified: `POST
/api/requests/public` → 201 with the correct next number. Pre-existing SELECT-then-INSERT race under
concurrent submits is unchanged — separate follow-up.

**(2) Clarification policy slice 3 — the EXTRACTOR — `<this commit>`.** The `clarification` config-freshness
adapter now uses a dedicated extractor instead of `genericExtract`.
- `services/clarificationPolicyExtract.js` `[NEW]` — sibling of `feePolicyExtract`. Prompts with the exact
  7-field schema + enum vocabularies (built from `clarificationPolicy.FIELDS`/`SOURCES` so it stays in sync),
  returns `{config, provenance keyed by field (source/citation/confidence), summary}`; `clarificationPolicy.
  normalize` guarantees a schema-valid, apply-able proposal even on an off-vocabulary enum (human review +
  strict `validate()` at apply are the real gates). Model/SDK usage matches the codebase (`@anthropic-ai/sdk`,
  `claude-sonnet-4-5`). AI never in the runtime clock path.
- `services/configExtractors.js` — `clarification` adapter `extract` rewired to the new module (one-line swap
  + require). Everything downstream (`stageFromSource` → `config_proposals` → review/attest/apply) already
  existed and is unchanged.

**Evidence (live LLM extraction on an Illinois FOIA §3(g) excerpt):** proposed `runs_no_stop` +
`required_before_burden_denial` + `vague_is_denial_ground=false` + `abandonment_closure=allowed`, with 6
statute-sourced provenance entries (citation + confidence); all enums validated in-vocab; applied via the
REAL apply path (`effectiveConfig.applyConfig`) with no validate throw; live policy reflected the change;
then reset to `enabled=false` / un-attested / safe and all test proposal+snapshot rows deleted. API
restarted (pid 152898, health 200); `POST /api/config-freshness/extract` returns 401 (mounted, new module
loads). Survey §8.3 → BUILT (same commit).

**Clarification-policy status: all three slices BUILT (substrate · trigger · extractor).** Remaining for a
production-ready clarification workflow (each its own slice): **outreach mechanics** (email template vs
printable postal letter on `delivery_method` + the intake mailing-address gap, §5b); **auto-close**
`clarification-timeout` node using `clarification_grace_days`/`abandonment_grace_days`; **UI editor form** for
the 7 fields and the record-search "Contact requestor" **button** (both wait on a design nod per the UI rule);
**Michigan clock-model conflict** (survey §5.1); per-jurisdiction storage + precedence (today global in
`system_config`, mirrors `deadline_rules`).

## 2026-07-09 (i) — Clarification outreach mechanics: email + printable postal letter (BUILT)

**Slice:** The OUTREACH half of the record-search "Contact requestor" action (SPEC_record_search_task_screen.md
§5b). Slice 2 wired the *clock effect* + effort trail but explicitly did NOT send anything. This slice adds the
templated outreach that branches on `delivery_method`. Backend only (the button waits on the record-search
screen). Continues on `spec/task-screens`.

**Built (backend):**
- `services/clarificationNotice.js` `[NEW]` — deterministic, plain-language builder (mirrors `feeNotice.js`).
  `buildNotice(reqRow, ctx)` → `{subject, text}` (greets requestor, cites request number, restates the on-file
  description, asks for specifics, adds a response-window sentence when `clarification_grace_days` is set,
  agency sign-off). `renderLetterHtml()` → print-friendly postal letter (letterhead, date, recipient +
  mailing-address block, `Re:` line, body — NO digital send; staff Ctrl+P). `noticeContext(policy)` pulls
  agency_name/contact_email/contact_phone/grace from `system_config`. No PDF lib (printable HTML by design).
- `services/clarificationAction.js` — `send()` now performs outreach after building the draft: **email** wraps
  the body via `emailTemplate` and sends through `email.js` (`{sent, provider}`); **mail** renders the letter,
  marks `to_be_mailed`. Channel defaults to **email** even when `delivery_method='mail'` (§5b); postal is a
  staff opt-in that **requires an inline `mailingAddress`** — else throws `ADDRESS_REQUIRED` BEFORE any clock/
  log side effect (the address-gap enforcement; address recorded in the note, NOT persisted — no column).
  New read-only `preview()`. Clock effect + always-log unchanged; the note now records channel + outcome.
- `routes/requests.js` — `GET /api/requests/:id/clarification/preview` (draft for the UI) + `POST …/clarification`
  now passes through `channel/to/mailingAddress/subject/text` and maps `ADDRESS_REQUIRED` → HTTP 400.

**Evidence (live harness on real request DEMO-2026-5069, then cleaned up):** (1) preview returned the full
draft (channel=email, addressRequired=false); (2) `mail` with no address → threw `ADDRESS_REQUIRED`; (3) `mail`
+ address → 2177-char printable letter w/ address block + `Re:` line, status `to_be_mailed`, no send; (4)
`email` → **sent via Resend** (id returned, provider=resend) to the requestor address; (5) both
`CLARIFICATION_REQUESTED` effort-trail rows written with channel + outcome in the note; (6) harness rows
deleted, count restored to baseline. Policy left OFF/safe-manual (clock.action=none, automationActive=false
throughout — outreach is independent of the clock gate). API restarted (kill pid → root PM2 respawn, new pid
197217, health 200); `GET …/preview` and `POST …/clarification` both return **401** unauth (mounted +
auth-gated). Spec §5b updated same-commit (outreach block → `[BUILT]`; address gap re-scoped to intake-only).

**Next (clarification workflow, each its own slice):** (a) **auto-close** `clarification-timeout` node using
`clarification_grace_days` / `abandonment_grace_days` (the last backend piece); (b) **intake mailing-address
capture** (portal-side) so postal clarification doesn't need an inline address; (c) **UI editor form** for the
7 policy fields + the record-search "Contact requestor" **button** (design nod pending, UI rule); (d) Michigan
clock-model conflict (survey §5.1); (e) per-jurisdiction policy storage + precedence (today global in
`system_config`). Note: the email path did a real Resend send to an `example.com` demo address (undeliverable,
reserved) — this is the same live-verify pattern as the fee notice; no real person was contacted.

## 2026-07-09 (j) — Auto-close clarification-timeout node (BUILT)

**Slice:** The last backend piece of the clarification workflow — the `clarification-timeout` model node.
A vague request was sent back, the requestor went silent past the grace window → auto-close as "withdrawn
(no clarification)". Continues on `spec/task-screens`.

**Built (backend):**
- `services/clarificationTimeout.js` `[NEW]` — a sweep (sibling of `feeNonpayment.sweep`). Detects OUTSTANDING
  clarifications from `request_history` (latest `CLARIFICATION_REQUESTED` newer than any `CLARIFICATION_RECEIVED`,
  request still active). Auto-closes when elapsed ≥ **threshold = `clarification_grace_days` +
  `abandonment_grace_days`** (requestor window + optional safety buffer). Triple-gated: `automationActive`
  (policy enabled AND jurisdiction attested — same switch as slices 2/3), a **configured positive grace**
  (null/statute-silent ⇒ never), AND `abandonment_closure ∈ {allowed, via_denial}` (`not_allowed`/`unspecified`
  ⇒ never). Closure via the **central** `taskRouting.applyStageTransition(rid,'closed',…)` (history
  `CLOSED_NO_CLARIFICATION` w/ stage_from→stage_to, tickler-flag clear) + `closure_reason='no_clarification'`.
  `closure_notice_required` ⇒ the note flags a written notice is owed (auto-send deferred). `opts.now/config/
  dryRun` for testing.
- `services/tickler.js` — one-line hook next to the nonpayment sweep; surfaces `clarification_timeout_closed`
  in the daily run (+ manual `POST /api/tickler/run`).
- `data/workflowModel.js` — `clarification-timeout` node `status:'planned'` → `'built'`.

**Evidence (live harness on real record_search requests, then fully restored):** (1) sweep with the REAL
policy (system OFF) → `enabled:false, reason:automation_inactive`, 0 closed (safe default). (2) dry-run w/
synthetic active config (grace 30) → listed the two 40-day candidates + the 5-day one, EXCLUDED the replied
one, closed 0. (3) real sweep → closed ONLY the timed-out unreplied requests; verified `stage=closed,
status=closed, closure_reason=no_clarification`, history `CLOSED_NO_CLARIFICATION` with
`stage_from=record_search, stage_to=closed`; the 5-day (under-threshold) and replied requests stayed active.
(4) buffer arithmetic: grace 30 + buffer 7 = threshold 37, a 45-day request closed, note read "grace 30 + 7
buffer days … A written closure notice is required — please send one." (5) `abandonment_closure=not_allowed`
→ `enabled:false, reason:closure_not_permitted`, 0 closed. (6) all subjects restored, 0 leftover harness rows.
No live policy/jurisdiction state was mutated (synthetic config drove the active-path tests). API restarted
(kill pid → root PM2 respawn, pid 198906, health 200); `POST /api/tickler/run` → 401 (auth-gated). Spec §5b +
model node updated same-commit.

**Clarification workflow now BUILT end-to-end (backend):** substrate · trigger · extractor · outreach ·
auto-close. **Remaining (each its own slice):** (a) intake **mailing-address capture** (portal-side) so postal
clarification needs no inline address; (b) **auto-sent closure notice** when `closure_notice_required`; (c) **UI**
— the 7-field policy editor + the record-search "Contact requestor" button (design nod pending, UI rule); (d)
**Michigan** clock-model conflict (survey §5.1); (e) **per-jurisdiction** policy storage + precedence (today
global in `system_config`).

## 2026-07-10 — Split-canvas portal intake design (recovered) + MRR model rewrite (DESIGN ONLY)

**Slice:** A full day of design/spec on the **public portal split-canvas intake**, capped by rewriting the
MRR (multiple-record-request) fee/item model. **No code touched** — all four commits are docs. Still on
`spec/task-screens`; working tree clean after; HEAD `20ff869`.

**Context:** Two prior session drops (the DO console + OOM issues) lost a live brainstorm with Kevin. It was
reconstructed from `imports/.../info_lost_recaptured.pdf` into an authoritative design doc so it can't be lost
again, then refined interactively via a clickable mockup.

**Produced (docs, in commit order):**
- `8938c95` — `docs/DESIGN_split_canvas_intake.md` `[NEW]` — recovered design capture. Chat docks far right;
  the left is a two-phase canvas: **Phase 0** a structured intake *form* (name/email + email-accuracy gate →
  phone/delivery/**mailing address** [the address-gap fix] → Proceed), **Phase 1/2** the chat builds one record
  description at a time → results canvas (results area + ~25% Selected Records column) → "another record?" loop.
- `9a6e936` — **Decisions locked** section + `docs/mockups/split_canvas_intake.html` `[NEW]` clickable prototype.
  Locked: (1) **app-wide surface standard** — 3-layer greys, *white = active/editable*, panel grounds tinted,
  page darker; "temperature-match" rule B−R=16 so greys coordinate. (2) START HERE header/copy. (3) email-accuracy
  gate = inline "Send verification email now" + lower form locked until **Email address verified** (enabled only
  after send) OR **Visually verified** (always available). (4) **Selected Records = per-child attach-and-clear**
  (one description = one item; on Proceed it attaches + both panels clear; loop opens fresh canvas). (5)
  immediate-download records = **tag only** "Available now — Public Records Library" (no inline download;
  per-page-or-free fee; supersedes the old two-option download fork). (6) **certification** = parent-level
  checkbox on the Phase-0 form (fee engine/notice already price it; gaps = requestor capture, cert-page
  generator, verify route+token, spec — a release-stage slice, only the checkbox is on this screen).
- `f46510c` — Phase-2 results instruction banner copy + PROCEED button; mockup synced.
- `20ff869` — **MRR model rewrite** (`SPEC_tasks_roles_mrr_fees.md §12`). Retired the "master/child /
  combined-vs-separate" muddle → clean 3-layer model: **L1 citizen** — one request, one number, one fee, one
  deadline (the only ≥2-item choice is delivery timing); **L2 processing** — request holds items (one per
  record), each flows the same engine, Request Manager coordinates, items roll up; **L3 fees** — computed once
  at request level (per-request minimum/de-minimis/floor-ceiling/deposit/certification apply once = the legal
  "combine into one request, one fee" rule). §12.1 reframed as the open **staff-UI** surface (4 items) off the
  RM workspace hub. `SPEC_public_portal_intake.md` §2/Phase-3/5 + `DESIGN_split_canvas_intake.md` #4 updated.

**Status:** `[DESIGN — not built]`, **PAUSED pending Kevin's confirmation** (UI rule — no screen built until the
direction is agreed; this doc IS that direction). Backend to reuse: `[[VERIFY_EMAIL]]`/Resend, PATH (a)/(b)
fork, native+library+email-count search modes, selected-records persist-at-submit, released-records surfacing.
Two genuinely new builds: the **Phase-0 form panel** (address capture + gate) and the **results canvas**.

**Open questions (`DESIGN_split_canvas_intake.md` §Open questions):** #4 MRR `[RESOLVED]`, #6 green-tag
`[UPDATED→library tag]`. Still open: **#1 verification-gate state machine** (mutual-exclusivity? what re-locks?),
#2 address in the data model (`requests.mailing_address` column shape), #3 fee-choice in Phase-0 vs chat, #5
mobile/narrow (stack vs step-through). Staff-side follow-on: MRR RM workspace hub (`§12.1`, 4 UI items).

**Next:** tackling **#1 the verification gate** this session.

## 2026-07-10 (b) — Split-canvas open questions #1 (email gate) + #2 (address model) resolved (DESIGN)

**Slice:** Resume after a DO-console drop; folded the missing Jul-10 design day into this log (above), then
resolved two open questions on `DESIGN_split_canvas_intake.md`. Design + mockup only, no app code. On
`spec/task-screens`.

**#1 Email-accuracy gate — RESOLVED (commit `dc021a4`).** Decisions (Kevin): **self-attest** trust model (kept
as prototyped — "Email address verified" is a citizen self-assertion, no backend token); **Visually verified =
always available** (equal escape hatch, email round-trip effectively optional); **editing the email after
unlock re-locks the gate.** One `email_confirmed` flag, two paths (records `method ∈ {attested,visual}`), the
winner's button shows ✓ and the other hides. Fixed a real hole in the mockup: editing the email after confirm
did nothing, so a confirmation could go stale against a new address — added `resetGate()` fired from the Email
`input` handler. Design doc: #1 `[RESOLVED]` + new "Email-accuracy gate — state machine" section.

**#2 Mailing address data model — RESOLVED (this commit).** Decisions (Kevin): **structured** columns
`mailing_street1/street2/city/state/zip` (country implicit US) over a freeform block — for validation, clean
letter/envelope rendering, future residency/fee logic; **captured only when `delivery_method='mail'`** (kept
the locked scope). Persisting closes the postal gap (HANDOFF slice i / §5b): postal delivery + postal
clarification read the stored address instead of re-asking; the inline `ADDRESS_REQUIRED` fallback stays for
email/legacy requests. Verified current code: `requests` has no address column; intake collects name/email/
phone only; `clarificationAction.js:87-94` takes the address inline and never persists it. Mockup: `#addrBlock`
now 5 structured fields (street1/city/state/zip required, street2 optional), still postal-gated. Design doc: #2
`[RESOLVED]` + new "Mailing address data model" section incl. a turnkey **build recipe** (5 columns · intake
persist · clarification fallback-to-stored · letter render).

**#3 Fee-choice placement — RESOLVED (this session, separate commit).** Decision (Kevin): the fee-waiver +
commercial-requester opt-ins live in the **Phase-0 form** (with certification), not chat — consistent with the
"structured facts → form" thesis; removes §5's "richer widget than QUICK_REPLIES" chat problem. Default-forward:
standard rates by default; "only if one applies" → **Request a fee waiver** (reveals a reason box) / **I'm a
commercial requester**; the two are mutually exclusive (waiver = non-commercial, contradicts commercial).
Verified code: waiver captured only in chat today; **commercial entirely unbuilt** (no `purpose` column;
`requestor_type` hardcoded `individual` at `publicChat.js:298`). Build recipe (speced): reuse
`fee_waiver_requested` (+ persist `fee_waiver_reason`, currently dropped at INSERT), set
`requestor_type='commercial'` (no new column — supersedes §5's `purpose`), retire the chat Phase-4 waiver
prompt once the form owns it. Mockup: `.fee-choice` block, waiver reason reveal, mutual exclusion, Fees line in
the review summary. Design doc: #3 `[RESOLVED]` + "Fee-choice placement" section.

**#5 Mobile / narrow layout — RESOLVED (this session, separate commit).** Decision (Kevin): **step-through**
(one surface at a time) over stacking — the flow is sequential and a stacked results grid + chat is a long
unfocused scroll. ≤860px: a sticky **Form/Results ↔ Assistant** toggle (new-message dot); Phase 0 canvas
(Assistant tab disabled until PROCEED) → PROCEED switches to chat → results-ready switches to canvas (agent
follow-up lands as an unread dot) → Selected column stacks below results → "search more?" back to chat;
finalize/review scrims force canvas. All behind `@media (max-width:860px)` (`setMobileView()` toggles a
`.m-canvas`/`.m-chat` class on `#stage`) so desktop side-by-side is untouched. Design doc: #5 `[RESOLVED]` +
"Mobile / narrow layout" section.

**Pre-existing mockup bug fixed same commit:** `askMoreOrReview()` was **called** in the no-instant
(email/video, Format-B) path but **never defined** → that path threw a ReferenceError. Defined it to mirror
the "search for more or finish?" prompt (Yes→nextRound / No→finishRequest).

**All six split-canvas design questions now RESOLVED** (#1 gate · #2 address · #3 fee-choice · #4 MRR · #5
mobile · #6 library-tag). **Design is decided end-to-end.** Remaining: staff follow-on MRR RM workspace hub
(`SPEC_tasks_roles_mrr_fees §12.1`). The whole screen is still `[DESIGN — not built]`, **now awaiting Kevin's
go to branch the first build slice** — the two genuinely new builds are the Phase-0 form panel (address + gate
+ fee-choice + cert) and the results canvas; backend to reuse per the design doc's Build note.

**Pushed 2026-07-10:** `spec/task-screens` → `origin` (`20ff869..22ca5bc`), all five session commits (#1 gate,
#2 address, cert-visible, #3 fee-choice, #5 mobile). Branch in sync with `origin/spec/task-screens`; remote is
`github.com/optimumq-ai/development`. No PR opened yet — still design-only, awaiting the go to branch a build slice.

## 2026-07-10 (c) — Split-canvas BUILD slice 1: backend foundation (BUILT + verified)

**Slice:** First build slice of the split-canvas intake — persist the structured fields the Phase-0 form will
collect (address #2, fee-choice #3), so every frontend slice has real storage and the postal-clarification
address gap closes. Strategy (Kevin): **new page alongside** (`/portal/v2` → cut over later); **backend first.**
Continues on `spec/task-screens`. Backend only, no UI.

**Built:**
- `backend/src/db/schema.postgres.sql` — 5 idempotent `ALTER TABLE requests ADD COLUMN IF NOT EXISTS
  mailing_street1/street2/city/state/zip TEXT` (country implicit US; nullable). Applied on boot by
  `initDb()` (`db/index.js:20-23` runs the whole file; the IF-NOT-EXISTS adds are safe every start).
- `backend/src/db/schema.sql` (sqlite reference) — same 5 columns **+ `fee_waiver_reason`** on the `requests`
  CREATE TABLE, fixing pre-existing drift (postgres had it via ALTER, this file didn't).
- `backend/src/routes/publicChat.js` `/public/submit` (the endpoint the v2 page will call) — INSERT now
  persists `mailing_*` + `fee_waiver_reason`; `requestor_type` whitelisted (`=== 'commercial' ? 'commercial'
  : 'individual'`) instead of hardcoded `'individual'`. Commercial capture (§3) + waiver reason now land.
- `backend/server.js` `/api/requests/public` (slice-h direct handler) — mirrored the same INSERT additions
  for parity.

**Deferred to slice 1b:** point `clarificationAction`/`clarificationNotice` at the stored `mailing_*` instead
of the inline address (capture had to exist first; small verifiable follow-up — fully closes the postal gap).

**Evidence (verified live, API restarted kill 1200 → root PM2 respawn pid 168297, health 200, new schema
applied):** (1) `POST /api/public/submit` with commercial + waiver reason + full postal address → 201
(`2026-0044`); row read back shows `requestor_type=commercial`, `fee_waiver_reason` set, all five `mailing_*`
populated. (2) Bare legacy-shape submit (no new fields) → 201 (`2026-0045`), `requestor_type=individual`, new
fields NULL — no regression. (3) Invalid `requestorType:"hacker"` → 201 (`2026-0046`), whitelisted back to
`individual`. All three test requests + every dependent row (across tasks/history/clocks/… — 16 child tables
with `request_id`) deleted; 0 left. JS syntax-checked; both endpoints unbroken.

**Next (frontend slices, on `/portal/v2`):** 2 Phase-0 form panel → 3 chat integration → 4 results canvas →
5 finalize+submit → 6 mobile step-through → cut over `/portal`, retire the chat-first page. Reuse the existing
`/api/public/*` surface (`submit`, `request-verification`, `verify-status/:token`, `chat`, `native-search`,
`sources`). Plus slice 1b (clarification reads stored address).

**No app code touched** — `DESIGN_split_canvas_intake.md`, `docs/mockups/split_canvas_intake.html` (JS
syntax-checked clean, no stray refs), `HANDOFF.md`. The #2 schema + wiring is speced as a turnkey build slice,
not built.

## 2026-07-10 (d) — Split-canvas BUILD slice 2: Phase-0 form panel (BUILT + verified)

**Slice:** Second build slice — the Phase-0 structured intake form, the first frontend surface of the
split-canvas portal. New page **alongside** the chat-first `/portal` (cut over later), route **`/portal/v2`**.
Frontend only; reuses slice-1 backend + the existing `/public/request-verification` send. On `spec/task-screens`.

**Built:**
- `frontend/src/pages/PublicPortalV2Page.js` (new) — split-canvas shell (app bar · 4-step stepper · left
  canvas + right chat) with the **left = fully-functional Phase-0 form** faithful to
  `docs/mockups/split_canvas_intake.html`. Plain-JS React + axios (matches `PublicPortalPage.js`); all CSS
  scoped under a `.scv` root so the mockup's generic class names (`.field`/`.panel`/`.step`/`.btn-primary`)
  can't leak into other client-side routes. Implements, per `DESIGN_split_canvas_intake.md`:
  - **Email-accuracy gate state machine** (#1 RESOLVED): one `emailConfirmed` flag, two paths. **Send
    verification email now** → real POST `/api/public/request-verification` (self-attest: fires the send, no
    poll), then enables **Email address verified** (attested). **Visually verified** always enabled (escape
    hatch). Winner shows ✓ + green, loser hides. **Re-lock on email edit** — editing a sent/confirmed address
    resets the gate (re-dims lower region, unchecks cert, restores buttons) so a confirmation can't go stale.
  - **Locked lower region** — Phone · delivery radio · **postal-gated structured mailing address**
    (street1/street2/city/state/zip, required-when-mail, state auto-uppercased) · certification · fee-choice.
    Dimmed+inert until the gate is satisfied.
  - **Certification** — parent-level checkbox, **visible-but-disabled before the gate** with the "Available
    once your email is confirmed above" hint (discoverability rule); enabled on confirm, unchecked on re-lock.
  - **Fee-choice** (#3 RESOLVED) — default standard rates; **Request a fee waiver** (reveals reason textarea)
    and **I'm a commercial requester**, **mutually exclusive**.
  - **PROCEED** — disabled until Name · valid Email · `emailConfirmed` · (address complete when delivery=mail).
    Click = the **Phase 0→1 trigger**: activates the right chat panel (IDLE→ACTIVE, opening greeting shown) and
    assembles the intake payload (name/email/phone/delivery/`requestorType`/waiver+reason/cert/method/mailing_*)
    for the later submit slice (logged now; wired to `/public/submit` in slice 5).
- `frontend/src/App.js` — registered `<Route path="/portal/v2">` (React Router v6 matches it over `/portal`).

**Evidence (verified live in the running app — `CI=false NODE_OPTIONS=--openssl-legacy-provider npm run build`,
nginx serves `frontend/build`, `GET /portal/v2` → 200):** drove the whole form in headless Chromium —
**35/35 behavior assertions pass** (the one apparent "fail" was a test-script substring artifact: the class
name `locked-region` contains "locked"; the real unlock is proven by lock-note-hidden + cert-enabled + PROCEED
gating). Screenshots confirm: initial locked/dimmed with cert visible-but-disabled → gate satisfies (green,
✓ button, loser hidden) → lower region unlocks → postal reveals address + PROCEED gates on it → fee-choice
mutual exclusion → email edit re-locks → PROCEED activates chat. Screens in scratchpad `01..05`.

**Not touched / deferred:** no backend change (slice-1 storage + the existing verification send cover it); chat
engine (slice 3), results canvas (slice 4), form→`/public/submit` wiring (slice 5), mobile step-through toggle
(slice 6 — page currently just stacks ≤860px) all remain follow-on. Plus slice 1b (clarification reads stored
`mailing_*`). `frontend/build` is git-ignored — only `App.js` + the new page are committed.

## 2026-07-10 (e) — Split-canvas BUILD slice 3: Phase-1 chat conversation engine (BUILT + verified)

**Slice:** Third build slice — the Phase-1 chat engine for `/portal/v2`. A real, backend-driven agent scoped
to record **descriptions + search + the one-record-at-a-time (MRR) loop** only; the Phase-0 form owns
identity/verify/delivery/fee/cert. Backend + frontend. On `spec/task-screens`.

**Built:**
- `backend/src/routes/publicChat.js` — new `SYSTEM_PROMPT_SPLIT_CANVAS` v2 agent prompt + a `mode:"split_canvas"`
  branch on `POST /public/chat`. The v2 agent **never** asks for contact info, email verification, delivery,
  or fees, and **never** emits `[[CONTACT_FORM]]`/`[[VERIFY_EMAIL]]`/`[[FEE_WAIVER_INFO]]`/`[[SUBMIT_READY]]`
  (barred — the form owns them). It reuses the **entire existing search stack** unchanged: `[[SEARCH_QUERY]]`
  → library search + AI relevance judge, `[[EMAIL_SEARCH]]` count-only for email/text, PATH (a)/(b) format
  fork, the result-aware second-pass reply, and `[[QUICK_REPLIES]]`. Result-aware / no-result reply text is
  **mode-aware** (points at "the results view" not chat cards; never re-asks delivery). Default (chat-first)
  `/portal` flow is byte-for-byte unchanged.
- `frontend/src/pages/PublicPortalV2Page.js` — replaced the chat placeholder with a live engine: PROCEED
  activates the panel and dims the form to inert; the verbatim design **opening greeting is seeded client-side**
  (display-only, so it's never sent to the API — Messages API needs a user-first turn); real user/assistant
  bubbles, a typing indicator, tappable quick replies, and a **read-only** in-chat rendering of returned records
  (with a "selecting happens in the results view — next slice" note). Latest `searchResults`/`searchQuery` are
  captured in state for slice 4. App bar + greeting now use the **real agency name** (`/requests/public/config`),
  with a derived crest (e.g. "City of Autumn Falls" → "AF").
- `docs/SPEC_public_portal_intake.md` — new **§2b "Split-canvas v2 intake agent"** documenting the model split,
  the `mode:"split_canvas"` backend flow, the client-seeded greeting, barred markers, and the slice map
  (results canvas / submit / mobile pending). (Design change → spec updated in the same commit, per CLAUDE.md.)

**Evidence (verified live — API restarted via PM2 respawn kill 168297 → pid 174626, health 200; frontend built
+ served by nginx):** (1) Backend probes: v2 mode responds to a description **without** asking for contact,
clarifies one question at a time, offers quick replies; confirms the description ("Your request is as follows…
Is that right?") then on "yes" fires `[[SEARCH_QUERY]]` → **6 real records**; PATH (b) email gathers
senders/recipients (no contact ask). (2) Full browser drive (`drive3.js`) — **14/14 assertions pass**:
form → PROCEED → chat active + greeting → composer enabled + form inert → describe → typing indicator → agent
reply (no contact ask) → confirm → search → 6-record read-only list in chat → match quick-replies. Screens
`06`, `07` in scratchpad. (3) Regression: default `/portal` (no `mode`) still emits `[[CONTACT_FORM]]` and
collects contact — unchanged.

**Boundary / next:** the chat engine is the **right panel** only. Slice 4 = **results canvas** — morph the left
panel from the (inert) form into the interactive results grid + Selected-Records column (per-child
attach-and-clear), consuming the `searchResults` this slice already captures; wire the visual "another record?"
loop. Then slice 5 (form→`/public/submit`), slice 6 (mobile step-through), cut over `/portal`, and slice 1b
(clarification reads stored `mailing_*`). `frontend/build` is git-ignored — committed: the route file, the page,
the spec, this note.

## 2026-07-10 (f) — Split-canvas BUILD slice 4: Phase-2 results canvas (BUILT + verified)

**Slice:** Fourth build slice — the Phase-2 results canvas for `/portal/v2`. On PROCEED the left panel **morphs**
from the form into the interactive results box; search results (from the slice-3 chat agent) render there for
selection, with per-child **attach-and-clear** and the "another record?" loop. Frontend only (reuses the slice-3
backend search unchanged). On `spec/task-screens`.

**Built (`frontend/src/pages/PublicPortalV2Page.js`):**
- **Form → results morph:** phase 0 renders the Phase-0 form; PROCEED → phase 1 **unmounts** the form and mounts
  the results panel (component state — name/email/fee/etc. — persists for slice 5). (Replaced slice-3's
  form-goes-inert stopgap with the proper Phase-2 dissolve.)
- **Results grid:** a chat response carrying `searchResults` now populates the LEFT canvas (not chat). Each real
  record renders with a checkbox, title, **tag** (public-ready → **"Available now · Public Records Library"**
  library tag per locked decision #6; else "Review needed"), a meta line (record type · dept · date · source ·
  pages), and summary. Full-width instruction banner (agreed copy) above; ~27% **Selected Records** column right.
- **Selection + Selected column:** ticking a row moves it to the Selected column (smaller font); the column's ×
  removes it and unticks the row. Count reflects live.
- **Canvas Proceed = per-child attach-and-clear:** attaches the current record's selection to a child
  (`children[]`), clears the grid + Selected column, and sends a "selected N records" turn to the agent (with the
  **cumulative** attached records as `selectedRecords`). The agent then asks "describe another record?" — Yes
  reopens a fresh canvas for the next description; No hands to submit (slice 5). Search turns' "any match?" quick
  replies are suppressed in chat (selection is canvas-driven); zero-result / PATH-(b) searches show no grid and
  stay chat-driven. The superseded "download-now vs submit-all" fork is **not** built (locked decision).
- Stepper tracks state: Describe records (phase 1, no results) → Review results (results shown).

**Evidence (verified live in the running app — frontend built, nginx serves `build`; backend unchanged from
slice 3):** full browser drive (`drive4.js`) — **23/23 assertions pass**: PROCEED removes the form + mounts the
results panel (placeholder) → describe → search → 6-record grid with library/review tags → tick two (Selected
column shows 2, count "2 selected") → × removes one (grid row unticks) → canvas Proceed clears both panels +
sends "selected 1 record" + agent offers "Yes, another record / No, that is everything" → "Yes" → describe a
2nd record → **fresh 3-record grid** (loop) with the Selected column reset (attach-and-clear held). A separate
run also verified the **zero-result** path (a police-report description returned no public-ready matches → no
grid, agent stays chat-driven and offers "another record") — both the with-results and zero-results paths work.
Screens `08` (grid + tags + selected column), `09` (selection), `10` (attach-and-clear + loop), `11` (2nd grid).

**Spec:** `SPEC_public_portal_intake.md §2b` updated — results canvas marked `[BUILT — slice 4]` with the
attach-and-clear/loop/library-tag behavior and the superseded-fork note.

**Next:** slice 5 = form→`/public/submit` wiring (persist the request + all attached `children`/selected records
via the slice-1 storage; retire the read-only end state). Then slice 6 (mobile step-through toggle), cut over
`/portal`, and slice 1b (clarification reads stored `mailing_*`). `frontend/build` git-ignored — committed: the
page + the spec + this note.

## 2026-07-10 (g) — Split-canvas BUILD slice 5: form → submit wiring (BUILT + verified)

**Slice:** Fifth build slice — finalize the `/portal/v2` request: assemble the Phase-0 form data + every
described/selected record and POST to `/public/submit`, with a review scrim + confirmation. Backend (schema +
submit + one new agent marker) and frontend. On `spec/task-screens`.

**Built:**
- **Schema** (`schema.postgres.sql` idempotent ALTERs + `schema.sql` reference): two new `requests` columns —
  `certification_requested INTEGER DEFAULT 0` and `email_verification_method TEXT` (attested|visual). Applied on
  boot by `initDb()`; verified present.
- **`/public/submit`** (`publicChat.js`): the INSERT now persists `certification_requested` and (whitelisted)
  `email_verification_method` alongside the slice-1 fields. Other flows unaffected.
- **v2 agent** (`SYSTEM_PROMPT_SPLIT_CANVAS` + `/chat`): added a `[[RECORD_ADDED:desc]]` marker the agent emits
  for any finalized record the citizen could NOT pick from results (zero-match search or a PATH-(b) format —
  email/audio/photo/paper), so those records still land in the request. Parsed → returned as `recordAdded`,
  stripped from the visible reply. (Records with selectable results are captured at canvas Proceed instead.)
- **Frontend** (`PublicPortalV2Page.js`): `recordAdded` responses append a `{description, records:[]}` child
  (dedup by description). A **"Review & submit request (N records)"** button appears in the results side-panel
  once ≥1 record exists → opens a **review scrim** (name · email + verify method · phone · delivery/address ·
  certified · fees · per-record list w/ selection counts). **Submit** assembles the payload — `description` =
  records joined (`Record N: …` when >1), `selectedRecords` = every child's picks, `isMrr` = >1, plus all Phase-0
  fields (requestorType/waiver/reason/cert/verify-method/mailing) — POSTs `/public/submit`, then shows a
  **confirmation** with the request number (+ "Start a new request"). Error + submitting states handled.

**Evidence (verified live — API restarted via PM2 respawn, new columns confirmed; frontend built + nginx-served):**
(1) Backend probe: a finalized PATH-(b) email conversation returns `recordAdded:"Emails between Mayor Chen and
City Manager Rodriguez…"` + the "another record?" quick replies, marker stripped from the reply. (2) Full browser
drive (`drive5.js`) — **8/8 assertions pass**: Phase-0 (visual verify · postal + address · commercial ·
certification) → PROCEED → describe → search → select 1 → canvas Proceed → **Review & submit** button → review
scrim (summary correct) → **Submit → confirmation `2026-0044`**. Screens `12` (review scrim) `13` (submitted).
(3) **DB row verified**: `requestor_type=commercial`, `delivery_method=mail`, `mailing_* = 88 Birch Lane /
Autumn Falls / TX / 75001`, `certification_requested=1`, `email_verification_method=visual`,
`fee_waiver_requested=0`, `is_mrr=0`, `submission_channel=manual_form`, `description="building permit 221 Oak
Creek Drive"`, 1 `request_selected_records` row. (4) **Cleanup:** the test request + all dependent rows deleted
across 16 request_id tables — 0 request rows, 0 orphans left.

**Spec:** `SPEC_public_portal_intake.md §2b` — submit marked `[BUILT — slice 5]`; header now `[BUILT end-to-end —
mobile toggle + cut-over pending]`; staff-side MRR item-splitting stays separate (§12).

**Next:** slice 6 = **mobile step-through** toggle (≤860px: Form/Results ↔ Assistant, per `DESIGN §Mobile`);
then **cut over `/portal`** to the v2 page; plus slice 1b (clarification reads stored `mailing_*`). Cert→fee-engine
wiring (certification.count) remains a release-stage/fee-domain follow-up. `frontend/build` git-ignored —
committed: schema (×2), publicChat.js, the page, the spec, this note.

## 2026-07-10 (h) — Split-canvas BUILD slice 6: mobile step-through (BUILT + verified)

**Slice:** Sixth build slice — the ≤860px mobile step-through for `/portal/v2`. One surface at a time with a
sticky Form/Results ↔ Assistant toggle, driven by the same phase transitions as desktop. Frontend only
(`PublicPortalV2Page.js`), all behind a media query — desktop side-by-side untouched. On `spec/task-screens`.

**Built:**
- **CSS** (`@media (max-width:860px)`): `.stage` becomes a column; `.stage.m-canvas > .chat` / `.stage.m-chat >
  .canvas` hide the inactive surface (`display:none`); the Selected-Records column drops **below** the results
  list (`results-split` → column, `results-side` bordered-top, own scroll); a sticky `.mtabs` two-button toggle.
  `.mtabs{display:none}` outside the query keeps desktop clean.
- **State/logic:** `mobileView` ('canvas'|'chat') stamps `m-<view>` on `<main class="stage">`; `chatUnread`
  drives the Assistant tab's dot; `setMobileView('chat')` clears the dot. Transitions wired to mirror desktop:
  **PROCEED → chat** (Assistant tab enables, canvas tab relabels "Results"); **search results → canvas** + flag
  unread (the accompanying chat reply is now behind the canvas); **canvas Proceed → chat** (the "another record?"
  prompt); **Review & submit → canvas** (the scrim is absolute within the results panel). The toggle is the
  manual escape hatch; Assistant tab is disabled in phase 0 (chat idle).
- **Cleanup:** removed the now-dead intake-payload assembly + `console.log` from `proceed()` (slice 5's
  `submitRequest` reassembles it); `proceed()` is now just the phase transition + mobile hand-off to chat.

**Evidence (verified live — frontend built + nginx-served):** browser drive (`drive6.js`) at **390×844** —
**21/21 assertions pass**: phase-0 toggle visible with "Form" tab + disabled Assistant, form shown / chat hidden
→ PROCEED switches to chat (Assistant enabled+active, tab relabels "Results") → describe → search → view pulls
to canvas + **Assistant unread dot** + Selected column stacked below → tap Assistant shows chat & clears dot →
tap Results shows canvas → select → canvas Proceed returns to chat → Review forces canvas scrim. **Desktop
(1280px) regression:** toggle hidden, both surfaces visible side-by-side after PROCEED. Screens `14` (form) `15`
(chat) `16` (results + stacked selected column) `17` (review) in scratchpad.

**Spec:** `SPEC_public_portal_intake.md §2b` — mobile marked `[BUILT — slice 6]`; header now `[BUILT end-to-end
incl. mobile — cut-over pending]`.

**The whole split-canvas portal is now built end to end** (form · gate · chat · search · results canvas ·
select · loop · review · submit · confirmation · mobile). **Next / remaining:** cut over `/portal` to the v2
page and retire the chat-first flow (the one open item); plus slice 1b (clarification reads stored `mailing_*`)
and the release-stage cert→fee-engine wiring. `frontend/build` git-ignored — committed: the page, the spec,
this note.

## 2026-07-10 (i) — Split-canvas cut-over: /portal → split-canvas intake (DONE + verified)

**Slice:** Cut over the live public portal to the split-canvas flow. Decision (Kevin): **keep the `/portal`
landing chooser**; its "Create an Open Records Request" now opens the new flow (Library entry preserved); retire
the chat-first request UI. Frontend routing only. On `spec/task-screens`.

**Done:**
- `App.js` — `/portal/request` → `PublicPortalV2Page` (canonical); `/portal/v2` → `<Navigate to="/portal/request"
  replace/>`. `/portal` unchanged (still the landing chooser).
- `PublicPortalPage.js` — `startRequest()` now `navigate('/portal/request')` instead of `setView('request')`
  + kicking off the in-page chat. Both entry points (the landing "Create" button and the `?start=request`
  deep-link) funnel through it, so both now open the split-canvas flow. The chat-first `view==='request'` render
  stays in the file as a **reversible fallback** but is unreachable (retired).

**Evidence (verified live — frontend built + nginx-served):** browser drive (`drive7.js`) — **12/12 pass**:
`/portal` still shows the Welcome chooser with both buttons and NOT the v2 form; **Create → `/portal/request` →
the split-canvas "START HERE" form**; `/portal?start=request` → `/portal/request` form; **`/portal/v2` redirects
to `/portal/request`**; `/portal/request` loads directly; the Library button still → `/portal/library`. Screens
`18` (landing) `19` (create→v2) in scratchpad.

**Spec:** `SPEC_public_portal_intake.md` — §1 notes the Create button/deep-link now open `/portal/request`; §2
header marked `[BACKEND BUILT — chat-first frontend flow RETIRED, superseded by §2b]`; §2b renamed to
`/portal/request` `[LIVE — the default request flow]`, cut-over `[DONE]`.

**The split-canvas portal is now the live public request flow.** Remaining follow-ups (all optional, non-blocking):
delete the retired chat-first render from `PublicPortalPage` (kept as fallback); slice 1b (clarification reads
stored `mailing_*`); release-stage cert→fee-engine wiring (certification.count). `frontend/build` git-ignored —
committed: `App.js`, `PublicPortalPage.js`, the spec, this note.

## 2026-07-10 (j) — Remove the retired chat-first portal render (DONE + verified)

**Slice:** Cleanup — delete the now-unreachable chat-first request UI from `PublicPortalPage`. Frontend only.
On `spec/task-screens`.

**Done:** `frontend/src/pages/PublicPortalPage.js` trimmed **658 → ~72 lines** — now just the landing chooser
(Welcome + Library button + Create-Request button) plus the config fetch and the `?start=request` deep-link
(both request entry points navigate to `/portal/request`). Removed all retired chat-first machinery: the chat
loop (`sendMessage`, messages/quick-replies/typing render), the fallback form (`handleFormSubmit`, formData),
email-verification polling (`resendVerification`/`skipVerification`/verify effects), the contact-form panel,
the native-search modal (`runNativeSearch`/`openNativePanel`/`loadNativeSources`/`pickSource`), the submitted
confirmation view, and their state/refs (`useRef` import dropped). The `/public/chat` backend endpoint +
default prompt are untouched (retained server-side).

**Evidence (verified live — frontend built clean; nginx-served):** re-ran `drive7.js` — **12/12 pass**: `/portal`
still shows the Welcome chooser (both buttons, not the form) → Create → `/portal/request` split-canvas form;
`?start=request` → `/portal/request`; `/portal/v2` → redirect; `/portal/request` direct; Library button →
`/portal/library`. No behavior change — same routes, less code.

**Spec:** `SPEC_public_portal_intake.md` — §2 now "chat-first frontend flow RETIRED and removed"; §2b cleanup
line marked `[DONE]`.

**Remaining (optional, non-blocking):** slice 1b (clarification reads stored `mailing_*`); release-stage
cert→fee-engine wiring (certification.count). `frontend/build` git-ignored — committed: `PublicPortalPage.js`,
the spec, this note.

## 2026-07-10 (k) — Slice 1b: clarification reads the stored mailing address (BUILT + verified)

**Slice:** Close the postal-clarification gap — point `clarificationAction`/`clarificationNotice` at the stored
`mailing_*` columns (split-canvas slices 1/5) instead of always re-asking inline. Backend only. On
`spec/task-screens`.

**Built (`backend/src/services/clarificationAction.js` + `clarificationNotice.js`):**
- New `resolveMailingAddress(reqRow, opts)` — precedence **inline override → stored `mailing_*` → none**;
  formats the structured columns into a clean multi-line block (`street1 / street2 / City, ST ZIP`).
- `findRequest` now SELECTs the five `mailing_*` columns.
- `doOutreach` (postal branch) uses `resolveMailingAddress`; `ADDRESS_REQUIRED` now throws only when **neither**
  an inline nor a stored address exists (legacy/email requests) — postal requests are no longer re-prompted.
- `preview` reports `addressRequired = (channel==='mail' && no stored address)` and returns the on-file
  `mailingAddress` so the staff UI can show it (was always `true` for mail).
- `renderLetterHtml` comment updated (the intake column now exists).

**Evidence (verified live — API restarted, single healthy server on :3001; requests created via the real
`/public/submit` path):** node harness (`verify1b.js`) — **8/8 pass**: (A) postal request WITH a stored address →
`preview.addressRequired=false`, `mailingAddress` = "88 Birch Lane / Autumn Falls, TX 75001"; `send` generates
the postal letter using the stored address, no `ADDRESS_REQUIRED`; letter HTML contains the block. (B) request
with NO stored address → `preview.addressRequired=true`, `mailingAddress=null`; `send` with no inline →
**throws `ADDRESS_REQUIRED`**; `send` with an inline address → uses the inline block (fallback preserved). Both
test requests + all child rows cleaned up (0 left).

**Docs:** `DESIGN_split_canvas_intake.md` build recipe items 3/4 marked `[BUILT — slice 1b]`;
`SPEC_record_search_task_screen.md` "Address gap" `[RESOLVED]`, closure-notice section + capabilities table
updated.

**Remaining (optional, non-blocking):** release-stage cert→fee-engine wiring (certification.count); auto-sent
closure notice (separate, pre-existing). The split-canvas portal work is complete end to end.

## 2026-07-10 (l) — Full split-canvas smoke test + is_mrr fix (verified)

**Smoke test (end-to-end, running app):** landing → **Create** (cut-over) → Phase-0 form (**attested** email —
real `/public/request-verification` send — · postal + address · certification · fee waiver + reason) → chat →
**record 1** PATH-a search + select → **loop** → **record 2** PATH-a search + select (attach-and-clear held) →
**No, that is everything** → **Review** (2 records, address, waiver, certified) → **Submit → `2026-0044`**. UI
drive **15/15 pass** (`smoke.js`). Plus a backend probe of the **PATH-(b) email** sub-path: `EMAIL_SEARCH`
count + `[[RECORD_ADDED]]` fired. Downstream verify (`smoke_verify.js`) **25/25 pass**: all form fields
persisted (attested method, postal `mailing_*`, `certification_requested=1`, `fee_waiver_requested=1` + reason,
`requestor_type=individual`, combined `Record 1/Record 2` description, 2 `request_selected_records`); **routing**
ran (department assigned, classification, deadline, routing_basis; history `CREATED`/`RECORDS_SELECTED`/
`CLASSIFIED`); **workflow onIntake** spawned **3 tasks + 1 deadline clock**; **deliver** — clarification
`preview` returns `addressRequired=false` + the on-file address (slice 1b). Test request + all child rows cleaned
up (0 left).

**Bug found + fixed (`publicChat.js` `/public/submit`):** `is_mrr` was reset to 0 on a 2-record submission —
the auto-classifier's `UPDATE` overwrote the intake-declared `b.isMrr` with its **type-diversity** verdict
(`cls.isMrr`), so two same-type records (two building permits) were downgraded to non-MRR. Fixed:
`is_mrr = (cls.isMrr || b.isMrr) ? 1 : 0` — MRR if the classifier detected multiple types **or** the intake
declared multiple described records. Re-ran the smoke after restart: `is_mrr=1`, **0 failures**.

**Result:** the split-canvas portal passes a full smoke (submit → route → tasks/clocks → deliver) end to end.
Pre-existing out-of-scope items remain (cert→fee-engine `certification.count`; auto-sent closure notice).

## 2026-07-10 (m) — PR opened for `spec/task-screens`

Opened **PR #1** → `main`: **https://github.com/optimumq-ai/development/pull/1** — "Split-canvas public records
portal (end-to-end) + clarification policy & task-screen specs". 30 commits (~4.5k insertions / 1.2k
deletions). Covers the split-canvas portal built slice-by-slice (1→6 · cut-over · retired-render removal · 1b
clarification address · the `is_mrr` fix), the clarification-policy engine + outreach/auto-close, and the
task-screen / MRR specs. Body includes the full-smoke evidence (UI 15/15, downstream 25/25, PATH-(b) probed).
Created via the GitHub API using the stored push credential (`gh` CLI not installed on this host). No reviewers
or labels set yet.

## 2026-07-10 (n) — PR #1 merged; `main` deploy verified clean

**Merge:** PR #1 merged into `main` (merge commit `fa27cac`, `merged_at 2026-07-10T22:50Z`) and closed; branch
`spec/task-screens` deleted on the remote and locally (tracking ref pruned). All split-canvas work + the
clarification-policy engine + specs are now on `main`.

**Deploy verification (from the `main` checkout `fa27cac`, running app):**
- **Clean checkout** — on `main`, no uncommitted tracked changes.
- **Frontend** — fresh build (`rm -rf build` + `CI=false NODE_OPTIONS=--openssl-legacy-provider npm run build`)
  → `Compiled successfully`; nginx serves the new bundle (served hash `main.5a77010c` = just-built hash).
- **Backend** — restarted from `main`; single healthy process (root PM2 respawn, pid 190429 owns :3001),
  `initDb()` applied the schema clean, all merged-slice columns present (`mailing_*`,
  `certification_requested`, `email_verification_method`, `fee_waiver_reason`). Health `200`.
- **Routes** — `/api/health`, `/portal`, `/portal/request`, `/portal/library`, `/portal/v2` all `200`.
- **End-to-end round-trip** — `POST /public/submit` (2-record, postal + cert + visual verify) → `201`; row
  persisted + routed correctly (**`is_mrr=1`** — the merged fix holds, department assigned, classification,
  `certification_requested=1`, `email_verification_method=visual`, address stored). Test data cleaned up
  (0 rows left). The transient multi-pid readings during restart were PM2 respawn overlap, not a crash loop.

**Housekeeping:** a diagnostic `pm2 list`/`pm2 kill` had spawned a stray PM2 God Daemon under the `optimumq`
user (`/home/optimumq/.pm2`, managing nothing); killed via `pm2 kill` (scoped to `~/.pm2`). Only the root PM2
daemon (pid 1136, `/root/.pm2` — the real API manager, backed by `pm2-root.service`) remains; API unaffected.

**Status: split-canvas portal shipped to `main` and verified deploying clean.** Remaining are pre-existing,
out-of-scope follow-ups only (release-stage cert→fee-engine `certification.count`; auto-sent closure notice;
staff-side MRR item-splitting per `SPEC_tasks_roles_mrr_fees §12`).

## 2026-07-10 (o) — Certification intake→fee-engine wiring (BUILT + verified)

**Slice:** Close the long-standing follow-up "release-stage cert→fee-engine wiring (`certification.count`)".
The requestor's intake certification opt-in (`requests.certification_requested`, captured by split-canvas
slice 5) never reached the fee engine — `FeeEstimatePanel` never sent a `certification` block, so a requested
certification was silently dropped from every estimate. Recovered after a mid-session disconnect (the prior
agent's WIP was never saved — clean tree, empty scratchpad — so this was built fresh).

**Built (backend `backend/src/routes/feeEstimates.js`):**
- New `defaultCertification(body, loaded)` — precedence **explicit body block → intake opt-in → none**. When the
  body omits `certification`, defaults `{ count: <#priced components>, source: 'intake' }` iff
  `certification_requested=1` (per_record unit → one per component; an MRR master certifies each child). An
  explicit body block always wins, including `{count:0}` to drop it.
- Wired into **both** `POST /request/:id` (estimate) and `POST /request/:id/reconcile`.
- `GET /request/:id` now returns `certification: { requested, suggestedCount, rate, unit }` so the panel can
  show the opt-in and pre-fill the count.

**Built (frontend `frontend/src/components/ui/FeeEstimatePanel.js`):**
- New `certification` state, hydrated from the GET context (or the latest snapshot's saved input).
- A certification control beside Delivery/Purpose (checkbox defaulted from intake + editable count + rate hint),
  sent on both calculate + reconcile.
- An itemized "Certification (N records)" line in the estimate result.

**Evidence (verified live — API restarted clean, single healthy process on :3001; frontend rebuilt `Compiled
successfully`, nginx serving the new bundle `main.8fa85771`):**
- **Engine** (direct): `certification.count=2 @ rate=5 → $10` line; `count=0`/`null` → no line item.
- **Route** (real `/public/submit` → auth'd fee-estimate API): request WITH intake cert → `GET` returns
  `requested=true, suggestedCount=1`; `POST` with **no** override persists input `certification={count:1,
  source:intake}`; explicit `{count:0}` and `{count:3}` overrides both respected (read back by exact snapshot
  id); request WITHOUT intake cert → `requested=false, suggestedCount=0`, `POST` defaults to **no** cert. All
  cert paths pass; every test request + child row cleaned up (**0 left**).
- NB: the loaded **TX** FR profile has `certification.rate=0`, so the line is $0 there — this wiring feeds the
  count regardless; pricing appears wherever a profile sets a non-zero cert rate.

**Spec:** `SPEC_fees_estimates_payments.md` §1 — certification intake→engine wiring marked `[BUILT]`.

**Housekeeping:** a `pm2 restart` under the `optimumq` user spawned a stray daemon (no `optimumq-api` there —
the real API is root-PM2-managed); killed it (`pm2 kill`, scoped to `~/.pm2`) and restarted the API by killing
its pid (root PM2 respawned it, pid 194830). No sudo available for root PM2.

**Status:** the last open fee follow-up is closed. Remaining pre-existing items: auto-sent closure notice;
staff-side MRR item-splitting (`SPEC_tasks_roles_mrr_fees §12`); estimate profiles unpopulated (§2 automation
never fires). `frontend/build` git-ignored — committed: the two source files, the spec, this note.

## 2026-07-10 (p) — TX cert rate set; PR #2 merged; main deploy verified

**Cert rate:** the illustrative TX FR profile (`feeprof-tx-fr-v1`) shipped with `certification.rate=0`, so a
requested certification priced at $0 even after the (o) wiring. Set to **$1.00 `per_record`** — applied to the
live `fee_profiles` row via the real `PUT /api/fee-profiles/:id` path and synced into
`backend/scripts/feeProfile.seed.js` so it survives a reseed. Figure is illustrative, labeled for verification
against local policy. **Verified live on jur-tx:** a real `/public/submit` with `certificationRequested=true`
now yields a **$1.00 certification line** (count 1, request total $1.10); GET context surfaces `rate=1`. Test
rows cleaned up (0 left). Spec §1 parenthetical updated (was "the loaded TX example is 0").

**PR #2 merged:** the certification intake→fee-engine wiring (o) + the TX cert-rate change — opened as
**PR #2** → `main`, `mergeable_state: clean`, merged (merge commit **`8bf5dbb`**). 3 commits (`dcbf326` wiring ·
`ea153e7` TX rate · merge). Merged via the GitHub API using the stored push credential (`gh` CLI not installed).
Branch `fees/certification-intake-wiring` deleted on the remote and locally; local `main` fast-forwarded.

**Deploy verification (running app, on `main` `8bf5dbb`):** working tree clean (no tracked drift); API healthy
(`/api/health` `200`); nginx serves the built bundle (**served `main.8fa85771` == built**). The backend route
change was already loaded (API restarted during (o)) and the frontend was rebuilt + served then, so main and the
running deploy are consistent — no further restart/rebuild needed.

**Status:** certification intake→fee wiring shipped to `main`, priced live on the default jurisdiction, verified
deploying clean. The last open fee follow-up is closed. Remaining pre-existing items: auto-sent closure notice;
staff-side MRR item-splitting (`SPEC_tasks_roles_mrr_fees §12`); estimate profiles unpopulated (§2 automation
never fires).

## 2026-07-10 (q) — Full smoke test (submit → route → estimate → search → deliver) — 28/28

**On-demand smoke** (backend, real endpoints, running app on `main` `932f111`). One MRR request created via the
real `POST /public/submit` (mail + address · certification · fee waiver + reason · attested email · 2 selected
records · both records in the description), then verified end to end and cleaned up.

**Result: 28/28 pass, 0 fail; 0 rows left.** Coverage:
- **Submit** — 201 + request number (`2026-0044`); all intake fields persisted (delivery=mail + `mailing_*`,
  `certification_requested=1`, `fee_waiver_requested=1` + reason, `email_verification_method=attested`,
  `requestor_type=individual`, `Record 1:/Record 2:` in description).
- **Search/select** — 2 `request_selected_records` persisted.
- **Route/classify** (synchronous in /submit) — department assigned, classification, deadline, routing_basis,
  `is_mrr=1`; history `CREATED` / `RECORDS_SELECTED` / `CLASSIFIED`.
- **Workflow onIntake** (backgrounded) — 1 task + 1 deadline clock spawned.
- **Estimate** (auth'd fee-estimate API) — context loads + surfaces the cert opt-in (`requested:true, rate:1`);
  estimate computed + persisted with a **$1.00 certification line priced from the intake opt-in** (total $17.20).
  Confirms the (o)/(p) certification wiring works inside the full pipeline, not just in isolation.
- **Deliver** — clarification `preview(channel:mail)` → `addressRequired=false` + the on-file postal address
  (slice 1b).

Harness saved at `scratchpad/smoke_full.js` (session ce55a45e). No code changes — verification only.

## 2026-07-10 (r) — Repo cleanup: stray backups + test drops removed; CLAUDE.md checked in

Housekeeping of long-standing untracked cruft in the working tree.

**Deleted:**
- `docs/FEE_ESTIMATE_VARIABLE_MAP.md.bak-20260701` — stale doc backup (original is tracked + present).
- `frontend/build.bak-20260704b2/` (~4.2M) — backup of the git-ignored `frontend/build`.
- `imports/testdrop/` — three test-drop PDFs (`e2e_test_…`, `sample_doc_1/2`) + the now-empty dir.

**Committed:** `CLAUDE.md` — the project-instructions file was untracked; checked into `main` (`96ae3fa`).

**Could NOT delete (needs root):** `frontend/build.stale-root/` — its `static/` subtree (dirs + files) is
**root-owned**, so removing it requires write access to root-owned directories; no sudo available as the
`optimumq` user. Left for someone with root: `sudo rm -rf /opt/optimumq/frontend/build.stale-root`.

**Left intentionally:** `imports/research/` (real content, untouched).

No tracked-code change beyond adding CLAUDE.md; the deletions were all of untracked files.

## 2026-07-10 (s) — main deploy verified clean (post-cleanup)

Full deploy verification from the `main` checkout `ecffe7d` (in sync with `origin/main`, 0 ahead / 0 behind),
running app.

- **Clean checkout** — on `main`, no tracked drift; only leftover is the known root-owned
  `frontend/build.stale-root/` (needs `sudo rm -rf`).
- **Frontend** — fresh build (`rm -rf build` + `CI=false NODE_OPTIONS=--openssl-legacy-provider npm run build`)
  → `Compiled successfully`; nginx serves the just-built bundle (served `main.8fa85771` == built).
- **Backend** — restarted from `main` (killed pid → root-PM2 respawn, pid 198523); single healthy listener on
  :3001; `initDb()` applied the schema clean; health `200`.
- **Schema** — all merged-slice columns present (`mailing_*`, `certification_requested`,
  `email_verification_method`, `fee_waiver_reason`, `is_mrr`, `routing_basis`); `fee_profiles` present.
- **Routes** — `/api/health`, `/portal`, `/portal/request`, `/portal/library`, `/portal/v2` all `200`.
- **End-to-end round-trip** — `POST /public/submit` → `201`; row persisted + **routed** (department
  `dept-openrecords`, classification `complex`, deadline, `routing_basis=general`, history `CLASSIFIED`);
  `is_mrr=1` (fix holds); certification + `email_verification_method` + mailing address stored; onIntake spawned
  1 task + 1 deadline clock. Test data cleaned up (0 rows left).

**Note:** one probe with a deliberately terse 2-line description was left `department_id=null` — the LLM
classifier correctly declined to route a near-empty request to a department ("unassigned for triage"), not a
deploy regression; a real description routes fully (verified). **main deploys clean.**

## 2026-07-10 (t) — Session summary

Session picked up after a mid-task disconnect (the prior agent was wiring the certification page fee; its WIP
was never saved — clean tree, empty scratchpad — so the work was rebuilt fresh). Everything below shipped to
`main` and was verified in the running app.

**Delivered:**
1. **Certification intake → fee-engine wiring** (o) — the requestor's intake opt-in
   (`requests.certification_requested`) now defaults `certification.count` on estimate + reconcile
   (`defaultCertification`, one per priced component; explicit body block including `{count:0}` overrides). GET
   estimate context surfaces the opt-in; `FeeEstimatePanel` gained a certification control + result line. Closed
   the last open fee follow-up.
2. **TX FR certification rate** (p) — set from `0` → `$1.00 per_record` (illustrative) via the real
   `PUT /api/fee-profiles/:id` path + synced into `feeProfile.seed.js`, so the line prices live on the default
   jurisdiction.
3. **PR #2** opened + merged into `main` (merge `8bf5dbb`); branch deleted, `main` fast-forwarded.
4. **Full smoke test** (q) — 28/28, submit → route → estimate (incl. the $1.00 cert line) → search → deliver.
5. **Repo cleanup** (r) — removed stray backups (`*.bak`, `build.bak-20260704b2/`) + `imports/testdrop/` PDFs;
   checked in `CLAUDE.md` (was untracked).
6. **Deploy verification** (s) — `main` deploys clean (fresh FE build served, BE healthy, schema/routes/round-trip
   all green).

**Commit trail on `main`:** `dcbf326` (wiring) · `ea153e7` (TX rate) · `8bf5dbb` (PR #2 merge) · `932f111`
(handoff) · `03588ce` (smoke handoff) · `96ae3fa` (CLAUDE.md) · `ecffe7d` (cleanup handoff) · `a4a5000` (deploy
handoff).

**Outstanding (carry-over):**
- `frontend/build.stale-root/` — root-owned, needs `sudo rm -rf /opt/optimumq/frontend/build.stale-root` (no sudo
  as `optimumq`).
- The $1.00 TX cert rate is illustrative — replace with the jurisdiction's real certification fee before prod.
- Pre-existing, out of scope: auto-sent closure notice; staff-side MRR item-splitting
  (`SPEC_tasks_roles_mrr_fees §12`); estimate profiles unpopulated (`SPEC_fees §2` automation never fires).

## 2026-07-10 (u) — Cleanup complete; working tree fully clean

The one carry-over from (r)/(t) is resolved: `frontend/build.stale-root/` (root-owned) was removed by the user
via `sudo rm -rf` and confirmed gone. Working tree is now **fully clean** — `git status` shows nothing tracked
or untracked; on `main` @ `7447c0f`, 0 ahead / 0 behind `origin/main`. (A transient
`.claude/settings.local.json.tmp.*` seen mid-check was just the harness's atomic write of `settings.local.json`
and cleared itself.) No stray backups, build dirs, or test drops remain.

## 2026-07-10 (v) — Researched the "real" TX certification fee: none exists (kept $1.00 as demo)

Asked to replace the illustrative $1.00 TX cert rate with the real jurisdiction fee. **Researched it against
primary sources** (TX AG public-information cost rules **1 TAC §70.3** via Cornell LII + the Texas state fee
schedule): certification of copies is **not a chargeable category** under the Texas PIA — the rule enumerates
copies ($0.10/pg), labor ($15/hr), programming ($28.50/hr), 20% overhead, media, postage, credit-card fees, but
**no certification fee**. So there is no "real" TX statutory certification figure to look up; the legally-accurate
TX value is **$0 / no charge** (individual bodies may charge to certify vital/court records under separate
statutes — not PIA).

**Decision (Kevin):** keep **$1.00 `per_record`** as an explicit *illustrative demo value* so the certification
line stays exercised on the default jurisdiction. **No config change** — the live `feeprof-tx-fr-v1` row stays at
$1.00. Only tightened the labeling so it is never mistaken for a Texas statutory fee:
- `backend/scripts/feeProfile.seed.js` — comment noting 1 TAC §70.3 authorizes no cert fee; $1.00 is demo-only;
  real TX deployment should use 0 or a specific city's adopted fee.
- `SPEC_fees_estimates_payments.md` §1 — records the §70.3 finding and that the example's $1.00 is illustrative.

Committed: seed comment, spec, this note. No runtime/DB change.

## 2026-07-10 (w) — Full smoke test re-run — 28/28

Re-ran the on-demand full smoke (`scratchpad/smoke_full.js`) after the (v) cert-rate labeling change (which was
docs-only, no runtime change). **Result: 28/28 pass, 0 fail; 0 rows left** — unchanged from (q). Confirms the
full pipeline still green end to end: submit → search/select → route/classify → workflow (1 task + 1 clock) →
estimate (with the **$1.00 certification line** priced from the intake opt-in, total $17.20) → deliver
(clarification reads the stored postal address). No code changes — verification only.

## 2026-07-10 (x) — Session summary (final)

Full session arc (supersedes the interim summary (t)). Session resumed after a mid-task disconnect — the prior
agent was wiring the certification page fee; its WIP was never saved (clean tree, empty scratchpad), so the work
was rebuilt fresh. Everything below shipped to `main` and was verified in the running app.

**Delivered:**
1. **Certification intake → fee-engine wiring** (o) — `requests.certification_requested` now defaults
   `certification.count` on estimate + reconcile (`defaultCertification`: explicit body → intake opt-in → none;
   one per priced component; `{count:0}` override drops it). GET estimate context surfaces the opt-in;
   `FeeEstimatePanel` gained a certification control + itemized result line. Closed the last open fee follow-up.
2. **TX FR certification rate** (p) — set `0 → $1.00 per_record` via the real `PUT /api/fee-profiles/:id` path +
   synced into `feeProfile.seed.js`, so the line prices live on the default jurisdiction.
3. **PR #2** opened + merged into `main` (merge `8bf5dbb`); branch deleted, `main` fast-forwarded.
4. **Full smoke test** — 28/28 (submit → route → estimate incl. the $1.00 cert line → search → deliver); run
   three times across the session (q, w), all green.
5. **Repo cleanup** (r, u) — removed stray backups (`*.bak`, `build.bak-20260704b2/`), `imports/testdrop/` PDFs,
   and the root-owned `build.stale-root/` (via user `sudo`). Checked in `CLAUDE.md` (was untracked). Working tree
   now **fully clean**.
6. **Deploy verification** (s) — `main` deploys clean (fresh FE build served, BE healthy, schema/routes/round-trip
   all green).
7. **TX cert-fee research** (v) — verified against primary sources that **TX PIA (1 TAC §70.3) authorizes no
   certification fee**; there is no statutory figure. Kept $1.00 as an explicit *illustrative demo value*
   (Kevin's call) and labeled it as such in seed + spec so it is never mistaken for a Texas statutory fee.

**Commit trail on `main` (this session):** `dcbf326` wiring · `ea153e7` TX rate · `8bf5dbb` PR #2 merge ·
`932f111` · `03588ce` · `96ae3fa` CLAUDE.md · `ecffe7d` · `a4a5000` · `7447c0f` · `9c851e8` · `4d4e63e` cert-label
· `995500c` (+ this note). All pushed; `main` in sync with origin, tree clean.

**Outstanding / carry-over:**
- The $1.00 TX cert rate is illustrative only — a real deployment sets 0 for TX (per §70.3) or a specific city's
  adopted certified-copy fee.
- Pre-existing, out of scope: auto-sent closure notice; staff-side MRR item-splitting
  (`SPEC_tasks_roles_mrr_fees §12`); estimate profiles unpopulated (`SPEC_fees §2` automation never fires).
- Nothing left in the working tree; no code changes pending.

## 2026-07-10 (y) — TX cert rate set to 0 (legally accurate per 1 TAC §70.3)

Reversed the (v) demo decision: set the TX FR certification rate **$1.00 → 0**, matching the (v) research
finding that TX PIA (1 TAC §70.3) authorizes no certification fee. Applied to the live `feeprof-tx-fr-v1` row via
the real `PUT /api/fee-profiles/:id` path; synced `feeProfile.seed.js` (`rate:0` + comment) and
`SPEC_fees_estimates_payments.md` §1.

**Verified live:** a cert-requested TX request now surfaces the opt-in (`GET` context `requested:true`) but the
estimate produces **no certification line** (`cert=null`, subtotal $0) — the intake→engine wiring still feeds
`certification.count`; it just prices to nothing at rate 0. Test row cleaned up (0 left). Committed: seed, spec,
this note.

## 2026-07-10 (z) — Full smoke re-run after cert rate 0 — 28/28 (harness made rate-aware)

Re-ran the full smoke after the (y) TX cert-rate → 0 change. First pass flagged 1 FAIL — a **stale assertion**,
not a regression: the harness still expected a $1.00 certification line, but TX now correctly prices none at
rate 0 (`cert=null`). Made the smoke's certification check **rate-aware** (`scratchpad/smoke_full.js`): it always
asserts the intake opt-in is surfaced (`requested:true`), then — reading the active profile's `certification.rate`
— expects a priced line when rate>0 and **no line when rate 0** (TX per 1 TAC §70.3). **Re-run: 28/28 pass,
0 fail; 0 rows left.** Full pipeline green end to end (submit → route → workflow 1 task/1 clock → estimate,
opt-in surfaced + no cert line at rate 0, total $16.20 → deliver). Harness-only change; no product code touched.

## 2026-07-10 (aa) — Session summary (final, updated)

Supersedes the interim summaries (t)/(x). Session resumed after a mid-task disconnect — the prior agent was
wiring the certification page fee; its WIP was never saved (clean tree, empty scratchpad), so the work was
rebuilt fresh. Everything below shipped to `main` and was verified in the running app.

**Delivered:**
1. **Certification intake → fee-engine wiring** (o) — `requests.certification_requested` now defaults
   `certification.count` on estimate + reconcile (`defaultCertification`: explicit body → intake opt-in → none;
   one per priced component; `{count:0}` drops it). GET estimate context surfaces the opt-in; `FeeEstimatePanel`
   gained a certification control + itemized result line. Merged via **PR #2** (merge `8bf5dbb`). Closed the last
   open fee follow-up.
2. **TX cert rate — researched to ground truth** — set to $1.00 (p) as a demo value, then **researched against
   primary sources** (v): TX PIA cost rules **1 TAC §70.3 authorize NO certification fee** (not a chargeable
   category). Per that finding, **final value set to 0** (y) — legally accurate, no cert line on TX estimates.
   Applied via the real `PUT /api/fee-profiles/:id` path; seed script + spec kept in sync throughout. The wiring
   still feeds `certification.count` regardless — any jurisdiction with a non-zero rate prices a line.
3. **Repo cleanup** (r, u) — removed stray backups (`*.bak`, `build.bak-20260704b2/`), `imports/testdrop/` PDFs,
   and root-owned `build.stale-root/` (user `sudo`). Checked in `CLAUDE.md` (was untracked). Tree **fully clean**.
4. **Verification** — full smoke run repeatedly across the session, always green; final harness is **rate-aware**
   (asserts opt-in surfaced + no cert line at rate 0 / priced line at rate>0) → **28/28** (q, w, z). `main`
   **deploy verified clean** (s). Slice-level engine + route + rate-0 checks all passed.

**Final state:** TX certification rate **0** (legally accurate); certification intake→engine wiring live and
rate-driven; working tree clean; `main` in sync with origin.

**Commit trail (this session):** `dcbf326` wiring · `ea153e7` TX $1.00 · `8bf5dbb` PR #2 merge · `96ae3fa`
CLAUDE.md · `4d4e63e` cert-label · `ca27b67` TX rate 0 · `f29a5da` rate-aware smoke · plus handoff commits
(`932f111`, `03588ce`, `ecffe7d`, `a4a5000`, `7447c0f`, `9c851e8`, `995500c`, `2d56232`) and this note.

**Outstanding / carry-over:** none in the tree. Product follow-ups (pre-existing, out of scope): auto-sent
closure notice; staff-side MRR item-splitting (`SPEC_tasks_roles_mrr_fees §12`); estimate profiles unpopulated
(`SPEC_fees §2` automation never fires). Any jurisdiction that charges a certification fee just needs a non-zero
`certification.rate` in its FR profile.

## 2026-07-10 (ab) — main deploy verified clean (post cert-rate-0)

Full deploy verification from `main` `906d5b4` (in sync with `origin/main`, 0/0), running app.

- **Clean checkout** — on `main`, no tracked drift, **no untracked files** (tree fully clean).
- **Frontend** — fresh build (`rm -rf build` + `CI=false NODE_OPTIONS=--openssl-legacy-provider npm run build`)
  → `Compiled successfully`; nginx serves the just-built bundle (served `main.8fa85771` == built).
- **Backend** — restarted from `main` (killed pid → root-PM2 respawn, pid 201597); single healthy listener on
  :3001; `initDb()` schema clean; health `200`.
- **Schema** — all merged-slice columns present; `fee_profiles` present.
- **Routes** — `/api/health`, `/portal`, `/portal/request`, `/portal/library`, `/portal/v2` all `200`.
- **End-to-end round-trip** — `POST /public/submit` → `201`; row persisted + routed (department, classification,
  deadline, `routing_basis`); `is_mrr=1`; certification + `email_verification_method` + mailing address stored;
  onIntake spawned tasks + deadline clock. **18/18, 0 fail; 0 rows left.**

**Harness note:** first pass showed 1 FAIL — the same benign case as (s): `deploy_verify.js` used a terse
description the LLM classifier declines to route (`department_id` null, "unassigned for triage"). Hardened the
harness with a routable description → 18/18 clean. Not a deploy regression. **main deploys clean.**

## 2026-07-10 (ac) — Session summary (final)

Supersedes interim summaries (t)/(x)/(aa). Session resumed after a mid-task disconnect (prior agent was wiring
the certification page fee; WIP never saved — clean tree, empty scratchpad — so rebuilt fresh). All shipped to
`main`, verified in the running app.

**Delivered:**
1. **Certification intake → fee-engine wiring** (o) — `requests.certification_requested` defaults
   `certification.count` on estimate + reconcile (`defaultCertification`: explicit body → intake opt-in → none;
   one per priced component; `{count:0}` drops it). GET context surfaces the opt-in; `FeeEstimatePanel` gained a
   certification control + result line. Merged via **PR #2** (`8bf5dbb`). Closed the last open fee follow-up.
2. **TX cert rate → researched to ground truth → 0** — set $1.00 as demo (p), then verified against primary
   sources (v) that **TX PIA 1 TAC §70.3 authorizes no certification fee**; set the legally-accurate **rate 0**
   (y) via the real `PUT /api/fee-profiles/:id` path, seed + spec synced. Wiring stays rate-driven — any
   jurisdiction with a non-zero rate prices a line.
3. **Repo cleanup** (r, u) — removed stray backups + `imports/testdrop/` PDFs + root-owned `build.stale-root/`
   (user `sudo`); checked in `CLAUDE.md`. Tree fully clean.
4. **Verification** — rate-aware full smoke **28/28** (q, w, z); **`main` deploy verified clean twice** (s, ab),
   18/18 round-trip; engine/route/rate-0 slice checks all green. Hardened `deploy_verify.js` with a routable
   description (the LLM classifier declines to route terse ones — benign).

**Final state:** TX certification rate **0** (legally accurate); intake→engine wiring live + rate-driven; working
tree clean; `main` @ `865ebfd`, in sync with origin.

**Key commits:** `dcbf326` wiring · `8bf5dbb` PR #2 merge · `ca27b67` TX rate 0 · `f29a5da` rate-aware smoke
(+ CLAUDE.md `96ae3fa`, cleanup + deploy + summary handoff commits).

**Outstanding:** none in the tree. Pre-existing product follow-ups (out of scope): auto-sent closure notice;
staff-side MRR item-splitting (`SPEC_tasks_roles_mrr_fees §12`); estimate profiles unpopulated (`SPEC_fees §2`).
A jurisdiction that charges to certify just sets a non-zero `certification.rate` in its FR profile.

## 2026-07-10 (ad) — TX FR fee profile promoted draft → active

Bumped `feeprof-tx-fr-v1` (the only TX FR profile) from `draft` to **active** via the real
`PUT /api/fee-profiles/:id` path; synced the status literal in `feeProfile.seed.js` (`'draft'` → `'active'`).
No config/rate change — cert rate stays 0 (ad is status-only). No competing active FR profile, so no conflict
with `pickConfig` (active-first).

**Verified live:** `GET /fee-estimates/request/:id` now reports `configProfile.status='active'`; an estimate
computes against it (test total $15.50). Test row cleaned up (0 left). Committed: seed, this note.

## 2026-07-10 (ae) — Full smoke re-run after profile activation — 28/28

Re-ran the full smoke after (ad) promoted the TX FR profile to active. **Result: 28/28 pass, 0 fail; 0 rows
left** — unchanged. Full pipeline green against the now-active profile: submit → route → workflow (1 task +
1 clock) → estimate (opt-in surfaced, no cert line at rate 0 per 1 TAC §70.3, total $16.20) → deliver. Activation
had no adverse effect. Verification only — no code change.

## 2026-07-10 (af) — Session summary (final)

Supersedes interim summaries (t)/(x)/(aa)/(ac). Session resumed after a mid-task disconnect (prior agent was
wiring the certification page fee; WIP never saved — clean tree, empty scratchpad — so rebuilt fresh). All shipped
to `main`, verified in the running app.

**Delivered:**
1. **Certification intake → fee-engine wiring** (o) — `requests.certification_requested` defaults
   `certification.count` on estimate + reconcile (`defaultCertification`: explicit body → intake opt-in → none;
   one per priced component; `{count:0}` drops it). GET context surfaces the opt-in; `FeeEstimatePanel` gained a
   certification control + result line. Merged via **PR #2** (`8bf5dbb`). Closed the last open fee follow-up.
2. **TX cert rate → researched → 0** — $1.00 demo (p), then verified against primary sources (v) that **TX PIA
   1 TAC §70.3 authorizes no certification fee**; set legally-accurate **rate 0** (y). Wiring stays rate-driven —
   any jurisdiction with a non-zero rate prices a line.
3. **TX FR fee profile promoted draft → active** (ad) — via the real `PUT /api/fee-profiles/:id`; seed synced.
4. **Repo cleanup** (r, u) — removed stray backups + `imports/testdrop/` PDFs + root-owned `build.stale-root/`
   (user `sudo`); checked in `CLAUDE.md`. Tree fully clean.
5. **Verification** — rate-aware full smoke **28/28** run repeatedly (q, w, z, ae), always green; **`main` deploy
   verified clean twice** (s, ab), 18/18 round-trip. Hardened `deploy_verify.js` with a routable description
   (LLM classifier declines terse ones — benign).

**Final state:** TX FR profile **active**, certification rate **0** (legally accurate), intake→engine wiring live
+ rate-driven; working tree clean; `main` @ `079eaa2`, in sync with origin.

**Key commits:** `dcbf326` wiring · `8bf5dbb` PR #2 merge · `ca27b67` TX rate 0 · `fbe1e08` profile active
(+ CLAUDE.md `96ae3fa`, rate-aware smoke `f29a5da`, cleanup/deploy/summary handoff commits).

**Outstanding:** none in the tree. Pre-existing product follow-ups (out of scope): auto-sent closure notice;
staff-side MRR item-splitting (`SPEC_tasks_roles_mrr_fees §12`); estimate profiles unpopulated (`SPEC_fees §2`).
A jurisdiction that charges to certify just sets a non-zero `certification.rate` in its FR profile.

## 2026-07-10 (ag) — main deploy verified clean (post profile-activation)

Full deploy verification from `main` `f859bf7` (in sync with `origin/main`, 0/0), running app.
- **Clean checkout** — no tracked drift, no untracked files.
- **Frontend** — fresh build → `Compiled successfully`; nginx serves the just-built bundle (`main.8fa85771`
  served == built).
- **Backend** — restarted from `main` (pid 202831); single healthy listener on :3001; health `200`.
- **Schema** — all merged-slice columns + `fee_profiles` present.
- **Routes** — `/api/health`, `/portal`, `/portal/request`, `/portal/library`, `/portal/v2` all `200`.
- **End-to-end round-trip** — `POST /public/submit` → `201`; row persisted + routed (department, classification,
  deadline); **18/18, 0 fail; 0 rows left**. No false failure — the (ab) routable-description harness fix held.

**main deploys clean.**

## 2026-07-10 (ah) — Session summary (final)

Supersedes interim summaries (t)/(x)/(aa)/(ac)/(af). Session resumed after a mid-task disconnect (prior agent was
wiring the certification page fee; WIP never saved — clean tree, empty scratchpad — so rebuilt fresh). All shipped
to `main`, verified in the running app.

**Delivered:**
1. **Certification intake → fee-engine wiring** (o) — `requests.certification_requested` defaults
   `certification.count` on estimate + reconcile (`defaultCertification`: explicit body → intake opt-in → none;
   one per priced component; `{count:0}` drops it). GET context surfaces the opt-in; `FeeEstimatePanel` gained a
   certification control + result line. Merged via **PR #2** (`8bf5dbb`). Closed the last open fee follow-up.
2. **TX cert rate → researched → 0** — $1.00 demo (p), then verified against primary sources (v) that **TX PIA
   1 TAC §70.3 authorizes no certification fee**; set legally-accurate **rate 0** (y). Wiring stays rate-driven.
3. **TX FR fee profile promoted draft → active** (ad) — via the real `PUT /api/fee-profiles/:id`; seed synced.
4. **Repo cleanup** (r, u) — removed stray backups + `imports/testdrop/` PDFs + root-owned `build.stale-root/`
   (user `sudo`); checked in `CLAUDE.md`. Tree fully clean.
5. **Verification** — rate-aware full smoke **28/28** run repeatedly (q, w, z, ae), always green; **`main` deploy
   verified clean 3× (s, ab, ag)**, 18/18 round-trip. Hardened `deploy_verify.js` with a routable description.

**Final state:** TX FR profile **active**, certification rate **0** (legally accurate), intake→engine wiring live
+ rate-driven; working tree clean; `main` @ `88ca2b6`, in sync with origin.

**Key commits:** `dcbf326` wiring · `8bf5dbb` PR #2 merge · `ca27b67` TX rate 0 · `fbe1e08` profile active
(+ CLAUDE.md `96ae3fa`, rate-aware smoke `f29a5da`, cleanup/deploy/summary handoff commits).

**Outstanding:** none in the tree. Pre-existing product follow-ups (out of scope): auto-sent closure notice;
staff-side MRR item-splitting (`SPEC_tasks_roles_mrr_fees §12`); estimate profiles unpopulated (`SPEC_fees §2`).
A jurisdiction that charges to certify just sets a non-zero `certification.rate` in its FR profile.

## 2026-07-11 (ai) — Next-slice pick (fee-waiver approval routing) found already BUILT + verified

Picked Tier-1 #4 "Fee-waiver approval task routing" as the next slice. On investigation it was already built
(spec `SPEC_tasks_roles_mrr_fees` §5/§9 `[BUILT 2026-07-09]`); the `BUILD_PRIORITY_SUMMARY.md` doc (compiled
07-08) predated the build and still listed it as NOT BUILT.

**Verified live end-to-end (11/11 pass, `scratchpad/verify_feewaiver.js`):** real `/public/submit` with
`feeWaiverRequested=true` → `onIntake` spawns a `fee_waiver` task with **`role_required='FEE_AUTHORITY'`,
`team_id=NULL`** (team-agnostic pool), status open; **an FEE_AUTHORITY holder (u-finance-super) sees it in
`GET /tasks/pool`, a non-approver (u-legal-staff) does NOT** (pool scopes by `role_required IN user's perms`);
`POST /requests/:id/fee-waiver-decision {decision:'grant'}` → `fee_waiver_status='granted'`, the task marked
**done**, history `FEE_WAIVER_GRANTED`. Test request + child rows cleaned up (0 left).

**Doc corrected:** `BUILD_PRIORITY_SUMMARY.md` item 4 marked `[BUILT 2026-07-09, verified 2026-07-11]`. No code
change — verification + doc only. Interim role stays `FEE_AUTHORITY` pending the Finance rename (item 9).

**Next real slice pending Kevin's pick** (genuine NOT-BUILT Tier-1/2): #3 populate estimate profiles (data),
#2 redaction task→workspace wiring, #5 explicit found/not-found resolution states, or #9 FEE_WAIVER_APPROVER→
Finance rename (decided, touches objections.js/decisionReasons.js/catalog/assignments).

## 2026-07-11 (aj) — ⭐ RESUME HERE (session paused, clean stopping point)

**State:** `main` @ everything shipped + pushed, `origin` in sync (0/0), working tree fully clean (no tracked or
untracked changes). App healthy. Nothing half-finished — safe to start a fresh session.

**What shipped this session:** certification intake→fee-engine wiring (PR #2 merged); TX cert rate researched to
ground truth and set to 0 (1 TAC §70.3 authorizes none); TX FR fee profile promoted draft→active; rate-aware
full smoke 28/28; `main` deploy verified clean; repo cleanup; permission allowlist tuned; and Tier-1 #4
fee-waiver approval routing confirmed already-built + verified live (11/11) with the build-priority doc corrected.

**➡ NEXT ACTION (start of new session):** pick the next slice. Fee-waiver routing (#4) is DONE. Genuinely
NOT-BUILT candidates, Kevin to choose:
- **#2 Redaction task → workspace wiring** (Small) — task click opens the redaction job/workspace, not generic
  request detail. Clean bounded routing slice, no new-screen design fork.
- **#9 FEE_WAIVER_APPROVER → Finance rename** (Small-med) — retires the interim FEE_AUTHORITY role; touches
  objections.js, decisionReasons.js, the role catalog, user assignments.
- **#5 Found/not-found resolution states** (Small) — prerequisite for MRR roll-up.
- **#3 Populate estimate profiles** (Small, data) — needs input on which record types / seed figures.
(#1 Record-search task screen is the top priority but is a NEW screen — agree design direction first.)

Verification harnesses live in scratchpad (session ce55a45e): `smoke_full.js` (rate-aware, 28/28),
`deploy_verify.js` (routable-description, 18/18), `verify_feewaiver.js` (11/11). New session gets a new
scratchpad — re-create as needed from these patterns.

## 2026-07-11 (ak) — Redaction: ground-truth doc, automation model spec, disposition fn (slice 1 BUILT)

**Context:** Kevin picked the redaction task→workspace slice, then pivoted (via a PDF design brief,
`imports`/GitHub `uploads/redaction UI content for discussion.pdf`) to a full **single Redaction UI**
redesign — and flagged he had zero confidence in what redaction automation is actually built. So the
session became: establish ground truth → design the automation model → start building it. All docs +
backend; **no UI built** (screen still needs the mockup pass, UI rule).

**Produced (3 commits):**
- `4d10886` — `docs/REDACTION_GROUND_TRUTH.md` `[NEW]` — what redaction ACTUALLY runs today, from 3
  read-only code investigations (file:line evidence). Headlines: the **engine is real** (AI content read
  `zoneDiscovery` = live claude-sonnet-4-5 over OCR → box+rule+reason, ephemeral/manual-trigger; template
  match = deterministic token-overlap, not AI; zone→burn→release; legal escalation). The **automation layer
  is greenfield**: no redaction complexity tier exists; `review_stage` is a bare status field (no reviewer
  task, no assignment, `apply` ignores it → review is bypassable); **clean-record bypass is designed-only
  and entirely unwired** (public_availability/auto_release_eligible/fulfilled_records/source_file_id index
  all populated but consumed by nothing). Both AI steps are lazy at canvas-open, never at selection. Indexed
  from `DOMAIN_MAP.md` Domain 8.
- `50f4c44` — `docs/SPEC_redaction_automation.md` `[NEW]` — the decided model. Kevin's 4 locked choices:
  **(Q1)** derive the tier from read-time signals, not an intake guess; **(Q2)** mandatory 2nd-person review
  for **elevated + legal only** (simple/standard self-release); **(Q3)** **broad auto-bypass** — provable-
  identity (published public copy / previously-released dedup) PLUS record-type-clean (`auto_release_eligible`
  + zero-span clean read) — the only no-human release path, guarded so a failed read never bypasses;
  **(Q4)** simple keeps one human confirm. One disposition per responsive file
  (bypass/simple/standard/elevated/legal), computed **eagerly at redaction-stage entry** so bypass records
  never reach a redactor. §7 has the 7-slice build order.
- `c549567` — **slice 1 BUILT** — `backend/src/services/redactionDisposition.js`: pure
  `computeDisposition(signals, config) → { disposition, basis }`, first-match-wins ladder. Defaults seeded
  from the `redaction_rules` category vocab (`law_enforcement`/`legal`→legal; `health`/`personnel`/
  `commercial`/`security`→elevated; **`privacy` stays self-release** — ordinary PII is not "sensitive").
  Idempotent `redaction_jobs.disposition` / `disposition_basis` audit columns. **Nothing wires it yet.**

**Evidence:** `scratchpad/verify_disposition.js` — **25/25** synthetic cases (every disposition, every ladder
rule, both guardrails, precedence, config tunability). Columns confirmed live via the real `initDb` boot path
(`scratchpad/verify_columns.js`, run with `NODE_PATH=backend/node_modules`). API restarted (kill 202831 →
root PM2 respawn **pid 260459**, health 200, schema applied).

**Next slices (SPEC_redaction_automation §7):** 2 bypass (identity dedup on `source_file_id` + public-copy
detection + record-type-clean; all-bypass auto-advances via `applyStageTransition`); 3 eager disposition at
stage entry (invoke per responsive file from the redaction orchestrator, suppress task spawn when all bypass);
4 `redaction_qa` reviewer task + `apply` gating for elevated/legal; 5 legal-category trigger; 6 config
(thresholds/categories → `system_config`); 7 the **redaction screen** (full-bleed, 3-box accordion, auto-run-
on-open, informational side-by-side, renamed doc-search) — consumes dispositions; **design a mockup FIRST
per the UI rule** (brief captured in the discussion PDF). §8 lists residual tunables (defaults set).

**State:** `main` @ `c549567`, working tree clean. NOTE: the earlier picked "task→workspace routing" micro-slice
(TaskPoolSection redaction link → `?tab=records`, + `RequestWorkspacePage` tab deep-link) was **NOT** done —
superseded by this full redaction-UI direction; it's obsoleted by slice 7 (the task will open the new screen,
not the old workspace tab).

## 2026-07-11 (al) — Redaction screen mockup + automation slice 2 (identity bypass)

**Two commits after (ak).**

**(1) Redaction screen mockup — `dbdd302`.** Built the clickable design-direction prototype from Kevin's
discussion PDF (`uploads/redaction UI content for discussion.pdf`). `docs/mockups/redaction_screen.html`
(standalone) + published as an **Artifact** (https://claude.ai/code/artifact/c085d7eb-14a0-46eb-b4a3-af1b363bb707).
Full-bleed workstation (no left nav) · AI content-read **auto-runs on open** (amber = proposed, black =
committed) · right-rail **3-box accordion** (AI Redaction: per-item checkbox + select-all + Apply-selected,
replacing Accept/Dismiss · Manual Redaction: draw/select → rule-for-new-boxes → Apply · **Finalize & Release**:
Generate template / Approve & release / Send for legal review) · **informational read-only side-by-side**
(Original vs Proposed, only control = Return to single page) · renamed **"Search inside document"** modal ·
**disposition badge** whose Finalize primary action adapts (Simple/Standard→Approve & release ·
Elevated→Submit for review · Legal→Send for legal review · Bypass→read-only), with a "Preview as" demo selector.
Verified: light renders clean, all interactions work (Playwright, 0 JS errors); dark tokens verified via
getComputedStyle (headless-shell paints light but computed rail=rgb(21,30,40) — real browsers/Artifact render
dark). **Design calls to confirm:** box-3 name "Finalize & Release"; amber-proposed/black-committed;
paper stays white in dark mode. **PENDING Kevin's markup before build (slice 7).**

**(2) Automation slice 2 — identity bypass — `a61e0e1`.** `services/redactionBypass.js` (new, unwired — same
safe pattern as slice 1). The read-independent half of §2 bypass: `findReusableRelease(file)` matches a
responsive file to a released `fulfilled_records` by **`original_name+size+mimetype`** (request_files has NO
content hash — resolved the §8 precision open item; `published=1` match ⇒ `published_public_copy`, else
`previously_released_dedup`), reusing the prior `output_file_id`. `recordBypass` writes the uniform artifact
(`redaction_jobs` row `disposition=bypass`/`review_stage=released` + a request-owned `fulfilled_records`
reusing the output, `published` carried over, + `REDACTION_BYPASSED` history); idempotent. Completion helpers
`allResponsiveReleased` + `advanceIfAllReleased` advance redaction→delivery via the **central**
`applyStageTransition`. Refined the slice 2/3 boundary in the spec: **slice 2 = identity (a/b); slice 3 = eager
stage-entry trigger + record-type-clean (c) read.** Verified **18/18 live** (`scratchpad/verify_bypass.js`:
both cases, negative, idempotency, all-released auto-advance + history, non-redaction-stage no-op; real
`/api/public/submit` for request creation, file/release rows scaffolded then fully cleaned up — 0 left).

**State:** `main` @ `a61e0e1`, working tree clean. Slice 1 (disposition fn) + slice 2 (identity bypass) BUILT,
both unwired. **Next: slice 3** — eager disposition at redaction-stage entry (invoke bypass, else ensure job +
run AI read + computeDisposition per responsive file; case (c); suppress task spawn + auto-advance when all
bypass). Then slice 4 (`redaction_qa` reviewer task + `apply` gating), 5 (legal-category trigger), 6 (config),
7 (the screen — mockup pending Kevin's markup). Harnesses in scratchpad: `verify_disposition.js` (25/25),
`verify_bypass.js` (18/18), `verify_columns.js`; mockup shots `shot_0*.png`.

## 2026-07-11 (am) — Automation slice 3a: identity bypass wired at stage entry (BUILT, first live-path slice)

**First slice with runtime effect.** `taskRouting.spawnForStage` now, on entering a redaction stage
(`redaction_review`/`redaction`), runs `redactionBypass.bypassIdentityForRequest` **before** spawning: clean
responsive files (public-ready / previously released) auto-bypass; if EVERY responsive file is thereby
released, the request advances to `delivery` via the central `applyStageTransition` and **no redaction task
spawns**. Read-independent — no LLM/OCR in the transition path. Legal escalation + normal spawn preserved
otherwise. Added `redactionBypass.bypassIdentityForRequest` (loops responsive files).

**Slice split (spec updated):** the original slice 3 became **3a** (this — identity bypass, synchronous, safe)
+ **3b** (the AI-read case (c) + per-file disposition pre-compute — deferred to its own slice, run OUT of the
sync transition path so LLM latency/failure never blocks a stage advance).

**Evidence — 12/12 live** (`scratchpad/verify_slice3.js`, real `applyStageTransition`): all-clean →
auto-advance to delivery + no task + REDACTION_BYPASSED & STAGE_ADVANCED history; mixed (one clean, one not) →
clean bypassed, task spawned, stays at redaction; no-bypass → unchanged routing (no regression); 0 rows left.
(Harness gotcha fixed: `/api/public/submit` runs `onIntake` async on the server and clobbers the stage — the
harness now `waitIntake`s on a `workflow_decisions` row before moving the stage.) **Server restarted on new
code** (kill 260459 → root PM2 respawn **pid 266292**, health 200, submit 201); smoke request cleaned up.

**State:** `main` @ `6c0291b`, tree clean. Redaction automation: slice 1 (disposition) · 2 (identity bypass) ·
**3a (bypass wired, LIVE)** BUILT. **Next: slice 3b** (async AI read + case (c) + per-file disposition
pre-compute), then 4 (`redaction_qa` reviewer task + `apply` gating), 5 (legal-category trigger), 6 (config),
7 (the screen — mockup `docs/mockups/redaction_screen.html` pending Kevin's markup).

## 2026-07-11 (an) — Automation slice 4: reviewer task + release gating (BUILT)

`services/redactionReview.js` wired into `routes/redactionJobs.js` — the review-routing half of the model
(Q2: mandatory second-person review for **Elevated + Legal only**).
- **`gateApply(job, applier)`** — the hard rule closing today's hole (`apply` ignored `review_stage`): an
  Elevated/Legal job cannot be released via `/apply` unless it was submitted for review (`review_stage ≠
  editing`, else **409**) AND the applier ≠ author/`submitted_by` (else **403**). `null`/`simple`/`standard`
  pass through unchanged → **inert / no regression** until dispositions are populated (slice 3b).
- **`/submit`** spawns a pooled `redaction_qa` task (Elevated → `REDACTION_WORKER` on the request team;
  Legal → `legal_redaction`, office-level), idempotent. **`/apply`** success → `completeReviewTask` (done);
  **`/return`** → `closeReviewTask` (cancelled). Added `redaction_qa` to `TASK_ROLES`.
- Author-exclusion is enforced HARD at the gate; pool-level author-exclusion is a noted refinement (§8).

**Evidence — 18/18 live** (`scratchpad/verify_slice4.js`): `gateApply` unit ×6 + real HTTP with **minted
author/reviewer tokens** (`auth.signAccessToken`) — submit spawns task + idempotent; author-apply → 403;
unsubmitted-apply → 409; return → editing + task cancelled; legal submit → office-level `legal_redaction`
review task; `completeReviewTask` → done; standard/null ungated. 0 rows left. Server restarted on new code
(kill 266292 → root PM2 respawn **pid 267640**, health 200); route mount `/api/redaction-jobs`.

**State:** `main` @ `d909f81`, tree clean. Redaction automation BUILT: 1 (disposition) · 2 (identity bypass) ·
3a (bypass wired, live) · **4 (reviewer task + gating, live)**. Gate is inert until dispositions are set —
which is **slice 3b** (async AI read + case (c) + per-file disposition pre-compute), the natural next slice
(it activates both 3b's triage AND slice 4's gate). Then 5 (legal-category trigger), 6 (config), 7 (screen —
mockup pending Kevin's markup). Harnesses in scratchpad: `verify_disposition.js` 25/25 · `verify_bypass.js`
18/18 · `verify_slice3.js` 12/12 · `verify_slice4.js` 18/18.

## 2026-07-11 (ao) — Automation slice 3b: eager read-triage + record-type-clean bypass (BUILT) — model complete (backend)

`services/redactionTriage.js`, kicked in the **background from `applyStageTransition`** on entering a redaction
stage (once — not on reconciler sweeps, to avoid repeated LLM cost). Per responsive non-identity-bypassed file:
`runRead` (ensure OCR → `zoneDiscovery.discoverZones`; spanCount = `max(located, found)`) → `assembleSignals`
(record-type `auto_release_eligible`/`public_availability` + intake `legalFlag` + read) → `computeDisposition`
→ **persists** `disposition`/`disposition_basis` on the job (screen opens pre-triaged). Case **(c)**
(`auto_release_eligible` + real clean read) → `recordCleanBypass` (releases the original as-is, `published` per
`auto_publish`). Idempotent (disposed file not re-read). After triage → `advanceIfAllReleased` + cancel the
redaction task if all cleared. Added `redactionBypass.recordCleanBypass`; exported
`taskRouting.requestNeedsLegalRedaction`. **This activates slice 4's gate** (elevated/legal dispositions now set).

**Correctness bug found + fixed during verify:** original `runRead` treated a file with **no OCR'd pages** (or a
non-document mimetype) as a *successful clean read* (`readOk:true, 0 spans`) → would have **falsely auto-bypassed
an un-read `auto_release_eligible` document**. Fixed: no readable pages / non-document → `readOk:false` → Simple,
**never** auto-bypassed. (A stale slice-3a harness assertion — "no job for the unique file" — was corrected to
"no *bypass* job", since 3b now legitimately persists a 'simple' disposition/job per file.)

**Template match still deferred** (spec §8): triage omits the template signal, so span-bearing docs default to
**Elevated** (safe: more review, never less). Wiring `redactionTemplates.engine.safetyScore` would let
template-covered docs settle to Standard/Simple — follow-up refinement.

**Evidence — 19/19 live** (`scratchpad/verify_slice3b.js`): injected-read core (case-c bypass released-as-is +
fulfilled_record; failed-read guardrail → simple; elevated/legal by category; legal by intake flag; idempotent
cache); `triageReadForRequest` all-clean → advance + both bypassed + task cancelled; **two real
`claude-sonnet-4-5` reads** (PII text → found≥1; clean agenda → 0); **async hook end-to-end**
(`applyStageTransition` → bg read of a clean auto-eligible doc → case-c bypass → advanced to delivery → task
cancelled). **Regressions clean:** slice 2 18/18 · 3a 12/12 · 4 18/18. Server restarted on new code
(kill 267640 → root PM2 respawn **pid 270000**, health 200).

**State:** `main` @ `31684d3`, tree clean. **Redaction automation model now BUILT end-to-end (backend):**
1 disposition · 2 identity bypass · 3a bypass-wired · 3b read-triage+case-c · 4 reviewer-task+gating — all live
and mutually activating. **Remaining:** 5 (legal-category trigger — extend legal disposition to also fire the
existing legal-escalation task path, mostly done via disposition='legal'; small) · 6 (config — thresholds +
category sets to `system_config`, currently `redactionDisposition.DEFAULT_CONFIG`) · **7 the redaction screen**
(mockup `docs/mockups/redaction_screen.html` + Artifact, **pending Kevin's markup** before build) · template-match
refinement in triage. Harnesses in scratchpad: disposition 25/25 · bypass 18/18 · slice3 12/12 · slice4 18/18 ·
slice3b 19/19.

## 2026-07-11 (ap) — Automation slice 5: legal-category trigger (BUILT)

Extracted the legal escalation into **`taskRouting.escalateToLegal(requestId, opts)`** (sets `legal_flag`, logs
`LEGAL_ESCALATED`, supersedes any open `redaction` task → re-spawns `legal_redaction`; idempotent no-op if
already flagged). The Director endpoint `POST /requests/:id/legal-escalate` now calls it (DRY refactor, unchanged
behavior), and **`redactionTriage` fires it whenever a file's disposition resolves to `legal`** — so a legal
exemption found in the *document read* (not just an intake flag) escalates the whole request's redaction to
legal staff (`flag_type=CONTENT_LEGAL`). Closes the gap where a read-detected legal category only added a
legal *review* task but left the redaction itself on a regular REDACTION_WORKER.

**Evidence — 13/13 live** (`scratchpad/verify_slice5.js`): read law_enforcement category → disposition legal +
escalation (legal_flag=1/CONTENT_LEGAL, LEGAL_ESCALATED history, ordinary redaction task superseded,
legal_redaction task active); idempotent (one legal_redaction task; escalateToLegal no-op when already flagged);
an elevated (non-legal) doc does NOT escalate; Director endpoint 401 unauth / 403 non-director / 200 with a real
minted director token + request flagged. **Regressions clean:** 3a 12/12 · 3b 19/19 · 4 18/18. Server restarted
(kill 270000 → root PM2 respawn **pid 271039**, health 200).

**State:** `main` @ `d121078`, tree clean. Redaction automation slices **1·2·3a·3b·4·5 all BUILT + live**. The
model is complete: clean records auto-release; the document read sets simple/standard/elevated/legal; elevated
needs a 2nd reviewer; legal (by intake flag OR document content) routes the whole redaction to legal staff and
gates release. **Remaining:** **6 config** (thresholds + LEGAL/SENSITIVE category sets → `system_config`, an
editor/attest surface like the clarification policy; currently `redactionDisposition.DEFAULT_CONFIG`) ·
**7 the redaction screen** (mockup pending Kevin's markup) · template-match refinement in triage (§8, span-bearing
docs → Elevated until wired). Harnesses: disposition 25/25 · bypass 18/18 · slice3 12/12 · slice3b 19/19 ·
slice4 18/18 · slice5 13/13.

## 2026-07-11 (aq) — Automation slice 6: tunable config + master switch (BUILT). Backend model COMPLETE.

`services/redactionConfig.js` + `routes/redactionConfig.js` (`GET/POST/POST reset /api/redaction-config`,
`SYSTEM_ADMIN`/`DIRECTOR`). Stores `{ enabled, elevatedSpanThreshold, simpleSpanMax, legalCategories,
sensitiveCategories, restrictedAvailability }` in `system_config` (global key `redaction_disposition_config`),
normalized over `redactionDisposition.DEFAULT_CONFIG`. `redactionTriage` reads it once per request and passes it
to `computeDisposition` — a jurisdiction retunes the model without a code change. Added an **`enabled` master
switch** (default **on**): off disables the two automation hooks (`spawnForStage` identity bypass + the
`applyStageTransition` read-triage kick) → fully manual redaction. Legal escalation / `requestNeedsLegalRedaction`
stay **ungated** (pre-existing path); the slice-4 release gate is unaffected.

**Evidence — 18/18 live** (`scratchpad/verify_slice6.js`): service CRUD + `validate`→400 + normalize/lowercase +
keep-other-defaults; stored `elevatedSpanThreshold=1` flows into a disposition (basis `span_count` vs the default
`spans_without_confident_template`); **master switch** OFF → request stays at redaction + clean file NOT bypassed
+ redaction task spawned, ON → auto-advance to delivery + file bypassed; endpoint 401 unauth / 403 non-admin /
200 admin GET+POST + 400 invalid + reset. **Global config snapshotted + restored** (harness leaves no trace).
**Regressions clean:** 3a 12/12 · 3b 19/19 · 4 18/18 · 5 13/13. Server restarted (kill 271039 → root PM2 respawn
**pid 272261**, health 200).

**State:** `main` @ `99cec79`, tree clean. **REDACTION AUTOMATION MODEL COMPLETE (backend), all live:**
1 disposition · 2 identity bypass · 3a bypass-wired · 3b read-triage+case-c · 4 reviewer-task+gating ·
5 legal-category trigger · 6 config+master-switch. **Remaining for the feature:** **7 the redaction screen**
(`docs/mockups/redaction_screen.html` + Artifact — **pending Kevin's markup** before build; it consumes the
dispositions this backend now produces) · **template-match refinement** in triage (§8 — wire
`redactionTemplates.engine.safetyScore` so template-covered docs settle to Standard/Simple instead of Elevated).
Harnesses in scratchpad: disposition 25/25 · bypass 18/18 · slice3 12/12 · slice3b 19/19 · slice4 18/18 ·
slice5 13/13 · slice6 18/18.

## 2026-07-11 (ar) — Template-match refinement wired into triage (BUILT)

`redactionTriage.templateMatch(file)` — faithful replica of `POST /match` reusing
`redactionTemplates.engine.safetyScore`/`parseZones` (best active page-template with score ≥ its
`safety_threshold`) — now feeds `templateMatched`/`templateScore`/`safetyThreshold` into `assembleSignals`. A
confident template match lets a span-bearing doc settle to **Standard/Simple** instead of defaulting to Elevated,
so Elevated is reserved for genuinely harder work (many spans / sensitive category / restricted type / no
confident template). `templateMatch` supports `ctx.templateOverride` for tests; runs only for document mimetypes
with OCR'd pages.

**Evidence — 7/7 live** (`scratchpad/verify_template.js`): template signal flips a 2-privacy-span doc
Elevated→Simple (`trusted_template_few_spans`) and 5-span→Standard; control (no template) stays Elevated; a real
crafted active `layout_profiles` row matches ≥ threshold, an unrelated doc doesn't; end-to-end real match
downgrades a span-bearing doc off Elevated; template row + rows cleaned up. **Regressions clean across ALL 7
automation harnesses** (disposition 25/25 · bypass 18/18 · slice3 12/12 · slice3b 19/19 · slice4 18/18 ·
slice5 13/13 · slice6 18/18). Server restarted (kill 272261 → root PM2 respawn **pid 273438**, health 200).

**State:** `main` @ `599735a`, tree clean. **Redaction automation model fully complete + tuned (backend).**
The ONLY remaining piece of the feature is **slice 7 — the redaction screen** (`docs/mockups/redaction_screen.html`
+ Artifact https://claude.ai/code/artifact/c085d7eb-14a0-46eb-b4a3-af1b363bb707, **pending Kevin's markup**
before build). It consumes the dispositions (badge + review-required state + auto-run-on-open) this backend now
produces. Harnesses in scratchpad: disposition 25/25 · bypass 18/18 · slice3 12/12 · slice3b 19/19 · slice4 18/18
· slice5 13/13 · slice6 18/18 · template 7/7.

## 2026-07-11 (as) — main deploy verified clean + origin reconciled/pushed; then slice 7 (redaction screen) BUILT

**(1) Deploy verify + origin sync.** Verified `main` deploys clean (22/22 `scratchpad/deploy_verify.js`: clean
tree, fresh FE build served by nginx byte-identical, single healthy :3001 listener, schema incl. disposition
columns, portal + `/api` + new redaction-config/clarification-policy/redaction-jobs routes, submit→route→persist
round-trip, 0 rows left). Origin had diverged (local 19 ahead / 1 behind — `581a221 "Add files via upload"`, the
redaction PDF); **rebased onto `581a221` (clean, no conflicts) and pushed** — local + `origin/main` now in sync.

**(2) Slice 7 — the redaction task screen — BUILT (`8616fe6`).** `frontend/src/pages/RedactionTaskPage.js`,
route **`/redaction/:taskId`** (full-bleed, auth-gated, **outside AppLayout** so it covers the nav).
`TaskPoolSection` now routes `redaction`/`legal_redaction` tasks here (not generic `/requests/:id`); added
`legal_redaction`/`redaction_qa` labels. Implements the agreed mockup on the LIVE engine: task + responsive-file
worklist (top-bar switcher) · per-file reuse of the proven canvas engine (job/pages/zones/discover/apply/
template/draw+rule) · **AI read auto-runs on open** · **disposition badge** (from `redaction_jobs.disposition`) ·
**3-box accordion** (AI Redaction with per-item checkbox + select-all + Apply-selected; Manual Redaction;
Finalize & Release) · **disposition-adaptive Finalize** (elevated/legal → *Submit for review* → `/jobs/:id/submit`;
simple/standard → *Approve & release* → `/jobs/:id/apply`, protected by the slice-4 server gate) · informational
read-only **side-by-side** · renamed **Search inside document** modal (`/semantic-search/documents`).

**Evidence — 9/9** (`scratchpad/verify_slice7.js`, Playwright, screenshot `slice7_screen.png`): a real scaffolded
redaction task loads full-bleed (minted token in `localStorage.oq_token`); command bar shows the request number;
file worklist shows the responsive file; **Elevated** badge; all 3 accordion boxes; Finalize adapts to *Submit
for review*; search control present; **zero runtime errors**; cleaned up. FE **Compiled successfully**, nginx
serves the fresh bundle (`main.ebf1d77e`). `frontend/build` git-ignored — committed source only (page, App.js
route, TaskPoolSection).

**Follow-ups (noted in spec §7):** the canvas **page-image render + zone-draw/apply** reuse the proven
`RedactionWorkspacePage` primitives but need a **real processed PDF** to fully drive (the smoke used text-only
pages → "Loading page…"); the **`redaction_qa` reviewer task** still opens the generic page — a reviewer-mode of
this screen (approve/return controls, not Submit) is a follow-up; the AI-scan **spinner** references an undefined
`spin` keyframe (static, cosmetic); **Kevin's mockup markup** still pending for visual refinements.

**State:** `main` @ `8616fe6` (unpushed — 1 commit ahead of origin after the earlier sync), tree clean, app
healthy. **Redaction automation feature COMPLETE end-to-end (backend model 1–6 + template refinement + the
screen).** Harnesses in scratchpad: disposition 25/25 · bypass 18/18 · slice3 12/12 · slice3b 19/19 · slice4
18/18 · slice5 13/13 · slice6 18/18 · template 7/7 · deploy 22/22 · slice7 9/9.

## 2026-07-13 (at) — Slice 7 verified on a REAL PDF; side-by-side release-preview bug found + FIXED

**(1) Backlog capture (`2ef1b0b`).** Kevin: the redesigned split-canvas portal lets a requestor *select* records
from search results but gives them **no way to say what the selection means** — (a) "nothing matches, but file my
request anyway" and (b) "these match, but keep looking, there should be more" are both inexpressible, so an empty
selection reads as abandonment and a partial selection is indistinguishable from a complete one (a request the
requestor considers open can be fulfilled from the selected set and closed). Captured as **BACKLOG R9** + an
"Open gap" section in `DESIGN_split_canvas_intake.md`. Direction: an explicit per-child **intent**
(complete · partial-search-more · no-match-search) captured on Proceed. **Undesigned — discuss before building.**
**Sequenced AFTER the redaction UI** (Kevin).

**(2) Slice 7 closed the "needs a real processed PDF" follow-up — 17/17** (`scratchpad/verify_slice7_realpdf.js`,
`make_pdf.js` generates a synthetic 2-page Dallas PD incident report with real PII). Whole chain via real paths:
`/api/public/submit` → `/api/files/upload` (multipart) → `PATCH /:id/status` responsive → `POST /:id/process`
(docProcessing: pdftoppm page PNGs + pdftotext 109/218 word boxes) → **central `applyStageTransition(→ redaction)`**
(spawns the task + kicks read-triage). Result: **the canvas renders both real page images** (the thing that had
never been driven — prior smoke used text-only pages → "Loading page…"); the AI read found **17 spans and boxed
them accurately on free-text NARRATIVE PROSE**, not just labelled form fields (the case no template can cover);
the read-triage's **`legal`** disposition (basis `intake_legal_flag`) drove the badge + second-reviewer banner +
*Submit for review* Finalize end-to-end. 0 runtime errors; request cleaned up (0 rows left).

**(3) Real bug the real document exposed — side-by-side FIXED (`06ea128`).** The "Proposed release" pane blacked
out only **applied** zones. With 17 AI proposals pending and none applied, it rendered **byte-identical to the
original** — complainant's SSN / DOB / home address / phone in the clear, under a heading reading PROPOSED
RELEASE. Technically honest (nothing applied → that IS what release would produce) but an operator can read it as
*"the AI found nothing, this document is clean"* and ship it. **Kevin's call: preview pending proposals as black
boxes.** `docImg(page, imgUrls, zones, pending)` now blacks out applied zones AND pending proposals; pending carry
a **dashed amber edge** (committed still distinguishable from proposed) and the caption states exactly what is
shown — incl. the honest empty case ("nothing is redacted on this page, so the release would be identical").
**Verified 10/10** (`scratchpad/verify_sxs.js`: original pane 0 boxes · proposed pane blacks out all 12 pending,
all dashed · caption asserts not-applied · apply one → 1 solid + 11 dashed + caption re-counts · 0 errors).
FE rebuilt (`NODE_OPTIONS=--openssl-legacy-provider npm run build` — required on Node 20), nginx serving fresh
bundle `main.9d5563cd`. Spec updated in the same commit.

**Review artifact for Kevin** (real screenshots + findings):
https://claude.ai/code/artifact/47a546a2-823c-47ee-9576-5c90d01f57d5

**State:** `main` @ `06ea128`, tree clean, app healthy. **Redaction feature complete + now verified on real
documents.** Open follow-ups on the screen: **(a) `redaction_qa` reviewer mode** — the reviewer task the slice-4
gate REQUIRES still opens the generic request page, so the mandatory second reviewer for Elevated/Legal has no
proper screen (Kevin asked; awaiting his call on approve/return mode of this same screen). **(b) AI proposal list
has no page anchor** — document-wide, no page number, no click-to-jump; fine at 2 pages, unusable at 50.
**(c)** spinner `spin` keyframe undefined (cosmetic). **(d)** Kevin's further markup on the screenshots.
Then **BACKLOG R9** (portal search-completeness intent). Harnesses: slice7-realpdf 17/17 · sxs 10/10 · plus the
7 automation harnesses (disposition 25/25 · bypass 18/18 · slice3 12/12 · slice3b 19/19 · slice4 18/18 ·
slice5 13/13 · slice6 18/18 · template 7/7).

## 2026-07-13 (bt) — Slice 8: reviewer mode (`redaction_qa`) — the mandatory second review finally has a screen

**Kevin's call:** reviewer mode as a **variant of the redaction screen**, not a separate screen.

**What shipped (`c7c6920`).** A `redaction_qa` task (the review the slice-4 gate *requires* for Elevated/Legal,
which until now opened the generic request page) routes to the same `/redaction/:taskId`. `RedactionTaskPage`
renders in reviewer shape: same canvas, file picker, side-by-side, in-document search; the right rail swaps
AI/Manual/Finalize for **Proposed redactions** (every zone the author submitted, **page-anchored, click to
jump**, rule cited; explicit warning when the author proposed *none* — approving that releases the document
unchanged) · **Second-pass AI check** (`/discover`, **not** auto-run — the author already made that call;
the reviewer asks deliberately and can add what was missed) · **Decision**. Opening the task calls
`/begin-review` (`pending_review → in_review`). **Approve & release** → `/apply` (slice-4 gate is the hard
rule; the UI also disables it for the author, with the reason). **Return for rework** → `/return`, which now
**requires a reason** (400 without one) — the author has nothing else to work from — written to
`request_history` as `REDACTION_RETURNED`, naming reviewer, author and file.

**Two bugs the slice exposed + fixed.** (a) `completeReviewTask` closed the per-request `redaction_qa` task on
the **first** file's release — with two gated files, approving file 1 **stranded file 2 with no reviewer
tasked**. Now it closes only when no gated job on the request is still `pending_review`/`in_review`.
(b) `apply()` never advanced the local job row, so after a successful release the rail stayed on the
pre-release state (**author mode too**). Also closed the cosmetic `spin`-keyframe follow-up.

**Verified 31/31** (`scratchpad/verify_slice8_reviewer.js`) on the real 2-page incident-report PDF, **two**
responsive files, **two real users**, whole chain through real creation paths: submit → upload ×2 → responsive
→ process → central `applyStageTransition(→ redaction)` → triage (`legal`, `legal`) → author submits → pooled
`redaction_qa` spawns → **author self-release 403** → reviewer's browser shows the review rail (author rail
gone), names the submitter, claims the job → reasonless return blocked in UI **and** API → returned with a
reason → history row + task cancelled → author re-submits (fresh task) → reviewer approves → **released,
credited to the reviewer**, `fulfilled_records` written → review task **stays open** while file 2 is pending,
**completes only when both are released**. 0 runtime errors; 0 rows left. FE rebuilt (`main.7688e831`).

**State:** `main` @ `c7c6920` (unpushed), tree clean, app healthy. **Redaction feature complete: author +
reviewer, verified on real documents.** Remaining follow-ups: **(a)** the **author**-mode AI proposal list still
has no page anchor (reviewer mode's list does — port the same treatment; matters at 50 pages). **(b)** Kevin's
further markup on the screenshots. Then **BACKLOG R9** (portal search-completeness intent — undesigned,
discuss first). Harnesses: slice8-reviewer 31/31 · slice7-realpdf 17/17 · sxs 10/10 · disposition 25/25 ·
bypass 18/18 · slice3 12/12 · slice3b 19/19 · slice4 18/18 · slice5 13/13 · slice6 18/18 · template 7/7.

**Note for next session:** the API is **not** under pm2 in this environment (`pm2 restart optimumq-api` →
"Process not found"). It runs as a bare `node /opt/optimumq/backend/server.js`; restart = kill the pid and
relaunch with `setsid nohup node /opt/optimumq/backend/server.js &`.

## 2026-07-13 (cu) — Page anchors on every proposal list (`e06f5f8`)

Closed the last functional follow-up on the redaction screen. The rail lists are **document-wide**, so an entry
with no page number was a line of text with nowhere to go — fine at 2 pages, unusable at 50. All three lists
(author **AI Redaction**, reviewer **Proposed redactions**, reviewer **Second-pass AI check**) now sort in
**reading order** (page → y → x) and carry a clickable **`p. N` anchor** that jumps the canvas to that page
(shared `PageChip`; the click is swallowed so jumping never ticks the proposal's checkbox).

**Verified 12/12** (`scratchpad/verify_pageanchor.js`, real 2-page incident report through the real chain):
17 proposals ↔ 17 chips · reading order (1×12 then 2×5) · list spans both pages · clicking a `p. 2` anchor
moves the canvas to page 2 **with the page-2 image painted** · Apply-selected still (0) · 0 runtime errors.
**Reviewer regression 31/31.** FE rebuilt.

**State:** `main` @ `e06f5f8` (unpushed), tree clean, app healthy. Redaction feature (author + reviewer) is
complete and verified on real documents. Remaining: **Kevin's markup** on the screenshots, then **BACKLOG R9**
(portal search-completeness intent — undesigned, discuss before building).

## 2026-07-13 (dv) — Parent/child model DESIGNED (`SPEC_parent_child_lifecycle.md`) — no code

**Design session, no build.** Kevin drove a parent/child (MRR) redesign, then paused it to research state law;
two research passes ran in parallel (Texas PIA ch. 552; then FL/CA/IL/WA/NY/CT). He uploaded a status-vocabulary
draft — `uploads/parentchildrecordprocessingstatus.xlsx` (commit `1068b62`, via GitHub) — which is now the
skeleton of the spec.

**The finding that shaped the design.** All seven jurisdictions agree, without exception: **exemptions, denials,
redactions, record-holds and appeals are RECORD-level; the statutory clock, the deadline, fees, and everything
that pauses the clock are REQUEST-level.** Consequence: Kevin's original placement of "AG hold" and "dispute" at
the parent is **wrong and dangerous** — Tex. ORD-664 (2000) holds the 10-business-day AG window "is not a grace
period," so undisputed records must still be produced while disputed ones sit at the AG. A request-level AG
freeze would make a city unlawfully withhold records it was obligated to release. Record-holds therefore mark the
child and **never** stop the parent clock or block a sibling.

**What Kevin got right on his own:** the parent carries the statutory **Due Date**; each child workstream carries
a **Budgeted** due date + days ahead/behind. That split dissolves the Illinois problem (one request-level answer
date, no installment safe harbor) and is the load-bearing idea in the spec. He also ruled (this session):
**child tolling is the BUDGET clock, not the statutory clock** — column named `budget_clock`, never `tolling`.

**Shipped (docs only).** `SPEC_parent_child_lifecycle.md` — the five axes (Stage · Task state · Outcome · Hold ·
Clock), parent + child field lists with Kevin's value lists corrected, roll-up rules, record-hold vs clock-hold,
**three things his sheet was missing that the law requires** (per-record withholding log with statutory citation;
child disposition + delivery/installments; child appeal state distinct from the parent's fee dispute), the
additive migration, 5 open questions, and a cited legal appendix. Cross-refs updated in the same commit:
`ARCHITECTURE.md` item 1 (**amended** — "a child IS a full request row" retired), `SPEC_tasks_roles_mrr_fees.md`
§12 (**superseded in part** — Layers 1 & 3 stand; the `request_items` storage fork is reversed), `DOMAIN_MAP.md`
D5, `BUILD_PRIORITY_SUMMARY.md` item 11.

**Migration shape (measured, not guessed).** 125 requests, `is_mrr`/`master_request_id`/`component_label` written
by **zero** lines of code, **0 children ever created** → clean backfill. The existing `requests` row becomes the
**CHILD and keeps its id**, so the 8 work-level FK tables (tasks, request_files, redaction_jobs,
av_redaction_tasks, document_pages, fulfilled_records, request_selected_records, workflow_decisions) and every
existing deep link keep working untouched; the 7 money/clock tables (request_clocks, request_fee_estimates,
fee_payments, fee_adjustments, erp_charges, request_payment_events, objections) repoint to a new parent row.

**Two live bugs the migration forces us to fix FIRST:** (a) the frontend drives stage advances through a legacy
stage order containing a **ghost stage `custodian_retrieval`** that exists nowhere in the backend;
(b) `feeNonpayment.js:39` and `tickler.js:88` bypass `applyStageTransition` with a raw
`UPDATE requests SET stage='closed'` — no history row, open tasks left claimable (violates ARCHITECTURE item 6;
would silently corrupt roll-up).

**Open (Kevin's call, in spec §9):** parent `Processed` vs `Delivered`/`Closed` · should nonpayment toll (TX
§552.263(e) is stronger — a **re-receipt**, not a toll) · clarification as re-receipt not toll (TX §552.222 +
*City of Dallas v. Abbott*) — `tolling.js` today has **no RE_RECEIPT event type**, only tolls · `delivery_mode`
Hold-All vs As-Ready as a real mode (WA RCW 42.56.080(2) makes installments an entitlement; TX §552.306(c)(2)(B)
requires batch notices).

**State:** `main`, tree clean, app healthy, no code touched. **Nothing is built from this spec — it is the
contract, awaiting Kevin's answers to §9 before any migration or code.**

## 2026-07-13 (ew) — Jurisdiction rule-config audit folded into the spec (§10) — no code

**Kevin's question:** "do we have code that automatically configures where state laws require re-receipt for unpaid
deposit, resetting the clock vs pause? I recall gathering info for several states." **Answered by audit, on paper.**

**The engine exists; the per-state rule SLOT does not.**
- **BUILT and better than the docs said:** `tolling.js:132` **`restart()` — a true clock reset/re-receipt** (closes
  open tolls, resets `started_at`, clamped so pre-restart toll time can't inflate the new due date). **The (dv) spec
  draft wrongly said this was missing — corrected in §4.2.** Also built: the whole **clarification** path, which is
  *the template for every other clock rule* — a validated 6-value enum (`clarificationPolicy.js:29`) → an
  effect→action mapper (`clarificationAction.js:32-42`: `toll_pause_resume` · `toll_and_restart` · `start_gate` ·
  `runs_no_stop` · `operational_hold` · `no_fixed_clock`) → engine primitive → history → attestation gate. Plus a
  real AI statute-extraction pipeline (`configExtractors.js`).
- **ABSENT (4 gaps):** (1) **no per-jurisdiction rules row** — `jurisdiction_profiles` is 7 columns of identity with
  nowhere to put a rule; `deadline_rules` and `clarification_policy` are **global `system_config` singletons**, and
  `clarificationPolicy.read(jid)` *accepts a jurisdiction id and discards it* (`:122`). (2) **no deposit→clock rule**
  — `payment_pending` declared, **zero callers**; the fee/tickler modules don't even import `tolling`, so the
  statutory clock **runs on an unpaid request** (false lateness). (3) **no volume extension, and no primitive that
  could express one** — `toll()` moves the due date by *elapsed wall time*, not "+10 statutory days"; needs
  `extend(clockId, days, reason)`. (4) `tollReasons` is **inert** — declared per clock, never read.

**Live DB reality:** `jurisdiction_profiles` = **1 row (TX)**. `clock_tolls` = **0 rows — no clock has ever been
tolled in production**. All 7 profile sections `attested_by = NULL` → every automation gate closed. Kevin's
**17-state `CLARIFICATION_POLICY_SURVEY.md`** (AL AR OK NC GA PA MI ID FL AZ CA WA NJ RI IL KS MS, with
`clock_effect` / `grace_days` / `abandonment_closure` / citations) is **already in the exact shape the code
validates — but it is markdown, not data.**

**Two false doc claims corrected in this commit:** `SPEC_jurisdiction_configuration.md` said "three state profiles
loaded" (**one**); `CONFIG_FRESHNESS_DESIGN.md` said 4 TX config sources were seeded (**`config_sources` = 0 rows**).

**Build order now on paper (spec §10.4):** (1) `jurisdiction_rules(jurisdiction_id, domain, config_json)` — small
migration, the extractor adapters already take the `jid` they throw away; (2) load the 17 surveyed states as data;
(3) `deposit_nonpayment_effect: pause|reset|withdraw|flag_only` + an `effectPlan` switch in the tickler's deposit
branch (~60 lines, a direct copy of `clarificationAction.js`; TX = `reset`); (4) `extend()`; (5) make `tollReasons`
load-bearing. **All parent-level — independent of the parent/child migration, buildable in either order.**

**State:** `main` @ tree clean, app healthy, **no code touched**. Still awaiting Kevin's answers to spec §9.

## 2026-07-13 (fx) — `jurisdiction_rules`: the per-jurisdiction rule slot — BUILT, 24/24

**The structural gap under every per-state story, closed.** Until now `deadline_rules` and
`clarification_policy` were **global singletons in `system_config`**, and `clarificationPolicy.read(jid)`
*accepted a jurisdiction id and discarded it* (its own comment said so). There was literally nowhere to put a
second state's rules.

**Shipped.** New table `jurisdiction_rules (jurisdiction_id, domain, config_json)` + `services/jurisdictionRules.js`
(read / readActive / write / activeJid). Domain names match the `configExtractors` adapter keys (`deadline`,
`clarification`), so the AI statute-extraction pipeline, config history, and jurisdiction-profile section hashing
all became **per-jurisdiction for free** — the adapters already took a `jid` they were throwing away. Three read
sites rewired: `tolling.js:loadRules()`, `clarificationPolicy.read/write`, `configExtractors.deadline`.
**Read fallback** to the legacy global key, so an un-backfilled install cannot silently lose its clock. Backfill is
an idempotent `INSERT … ON CONFLICT DO NOTHING` in `schema.postgres.sql` (which runs at every boot).

**Verified 24/24** (`verify_jurrules.js` in the job scratchpad). The proofs that matter:
- **THE JID IS LOAD-BEARING** — TX = `toll_and_restart` (clarification RESETS the clock, *City of Dallas v.
  Abbott*) and a second test jurisdiction = `toll_pause_resume`, **held simultaneously, read back distinctly**.
  Impossible before this slice. Per-jurisdiction grace days differ too (61 vs 30).
- **The jurisdiction row WINS over the global key** — set the jurisdiction row to `standard=77` and the legacy
  global key to a `999` decoy: the clock engine returns 77.
- **Fallback works** — a jurisdiction with no row still inherits the legacy global (no silent clock loss).
- **Writes no longer touch `system_config`** — the legacy key still holds the old disabled default.
- **End to end through the real path** — `POST /api/public/submit` → the new request's primary clock took its
  duration from the **jurisdiction** config, not the decoy.
- Cleanup: 0 test requests, 0 test jurisdictions, live TX config byte-identical to before the run.

**ENVIRONMENT CORRECTION (the (bt) note was wrong).** The API **IS** under PM2 — it runs under **root's** PM2
daemon (`/root/.pm2`), which is why `pm2 list` / `pm2 restart optimumq-api` as the `optimumq` user shows nothing
("Process not found"). Killing the pid works only because **PM2 restarts it**. ⚠️ **Do NOT `pkill -f "node .*server.js"`**
— that pattern also matches the three connector stubs (tyler/laserfiche/axon) and kills them (I did this; PM2
brought them back). Use `pkill -f "optimumq/backend/server.js"`.

**Next (spec §10.4 step 2):** load Kevin's **17 surveyed states** from `CLARIFICATION_POLICY_SURVEY.md` as data —
now a pure data task, since the slot exists. Then step 3: `deposit_nonpayment_effect` (pause|reset|withdraw|
flag_only) wired into the tickler's deposit branch, ~60 lines copying `clarificationAction.js`; TX = `reset`.
Then step 4: `extend()` for statutory volume extensions.

**State:** `main`, tree clean, app healthy (API restarted by PM2 with the new schema; table created + backfilled
at boot). Parent/child migration still blocked on Kevin's §9 answers.

## 2026-07-13 (gy) — The 17-state survey is DATA now, not markdown — 35/35

**Spec §10.4 step 2.** `CLARIFICATION_POLICY_SURVEY.md` had held 17 jurisdictions' researched clock rules since
2026-07-09 that **no machine could read** — because until `jurisdiction_rules` landed this morning there was
nowhere to put them. Loaded via `backend/src/db/seed_clarification_policies.js` (idempotent), which writes
through the **real config path** (`effectiveConfig.applyConfig`), so each jurisdiction gets config history + a
synced profile section exactly like a human edit or an AI extraction.

**18 jurisdictions now hold a clarification policy:** AL AR AZ CA FL GA ID IL KS MI MS NC NJ OK PA RI **TX** WA.
TX is not in the survey — it comes from the 2026-07-13 legal research (`toll_and_restart`, 61-day grace,
Tex. Gov't Code § 552.222 + *City of Dallas v. Abbott*, 304 S.W.3d 380 (Tex. 2010)).

**All six clock effects are represented in real data** — `runs_no_stop` 7 · `no_fixed_clock` 4 ·
`toll_pause_resume` 3 · `toll_and_restart` 2 · `start_gate` 1 · `operational_hold` 1. **No single effect covers a
majority**, which is the quantitative case for the field existing at all. Four states now hold four *different*
clock behaviours simultaneously (TX restart / WA pause-resume / IL never-stops / MI start-gate) — read back
distinctly through the real path.

**SAFETY — this changed NO live behaviour, and that is verified, not asserted.** Every policy is seeded
`enabled: false` (a DRAFT). Runtime is double-gated: `automationActive()` needs `enabled === true` **AND** an
attested profile section. Nothing is attested. The harness asserts `automationActive(TX) === false` *and* that it
would still be false even if attested. This honours the survey's own provenance caveat (values "MUST be verified
… by counsel licensed there before a customer relies on them") and the AUTO_CONFIG trust model
(research/AI drafts → city reviews → city attests → live).

**Provenance survives the round trip** — every field carries `source` / `citation` / `confidence`.
**Michigan is seeded at confidence 0.4, the lowest in the set**, because the survey's two research passes
disagree (§5.1: `start_gate` vs `runs_no_stop` + `vague_is_denial_ground`). **Verify against MCL 15.235 before
Michigan ships.** Other low-confidence rows: AR 0.45 (tolling legally unsettled), NJ 0.5 (GRC practice, not
statute, and shifting under litigation).

**Decisions I made under standing approval:** (a) seeded the survey's *city* rows (Birmingham, Tulsa, Miami,
Dearborn…) as their **STATE** profiles, because the state→city precedence stack is not built — Tulsa's EO and
SF's Sunshine Ordinance are city overlays ON TOP of silent/looser state law and are recorded as notes, not as
data; (b) `status = 'library'` for the 17 (a research library — the deployed jurisdiction is still `jur-tx`,
chosen by `system_config['jurisdiction_profile']`; nothing in the code filters on status); (c) seeded TX itself
from the legal research rather than leaving it at defaults.

**Verified 35/35** (`verify_survey_seed.js`, job scratchpad).

**Next (spec §10.4 step 3):** `deposit_nonpayment_effect` (`pause | reset | withdraw | flag_only`) wired into the
tickler's deposit branch — ~60 lines copying `clarificationAction.js`. **This is the one that stops the statutory
clock running on unpaid requests** (today `payment_pending` has zero callers, so an unpaid request reports false
lateness). TX = `reset` (§ 552.263(e): the request is "considered received" on the date the deposit arrives).
Then step 4: `extend()` for statutory volume extensions.

**State:** `main`, tree clean, app healthy. 18 jurisdiction profiles, 18 clarification policies (all drafts),
0 attested. Parent/child migration still blocked on Kevin's spec §9 answers.

## 2026-07-13 (hz) — Deposit clock policy: `payment_pending` finally has a caller — 31/31

**Spec §10.4 step 3.** THE BUG: a request parked on an unpaid deposit **kept burning its statutory clock**.
`payment_pending` had been declared as a toll reason since the clock engine was built and had **ZERO callers**;
`feeNonpayment` / `paymentTiming` / `paymentStatus` / `tickler` never even imported the tolling engine. The city
looked delinquent for the *requestor's* inaction.

**Shipped.** `services/paymentClockPolicy.js` (per-jurisdiction substrate — `deposit_clock_effect` ·
`deposit_grace_days` · `deposit_lapse_action`, same shape/vocabulary as `clarificationPolicy` because "waiting on
the requestor" is one concept whether the wait is for words or for money) + `services/depositAction.js` (the
effect mapper, a deliberate sibling of `clarificationAction`). Wired into **all four real moments**: deposit owed
(`feeEstimates` accept), deposit paid (**three** paths — manual log, counter payment, ERP settlement), and lapse
(`tickler`). Registered as a `payment` domain in `configExtractors` + a `payment` section in
`jurisdictionProfile`, so it inherits AI statute-extraction, config history, and the attestation gate for free.

**TX seeded `toll_and_restart` / grace 10 / `withdraw`** (`seed_payment_clock_policies.js`) from
§ 552.263(e) — a deposit **RE-RECEIVES** the request ("considered to have been received … on the date the
governmental body receives the deposit"), so the clock **restarts from the payment date** rather than merely
resuming — and § 552.263(f) (10 business days, else withdrawn). **The other 17 jurisdictions are deliberately
left at defaults** (`runs_no_stop` + `flag_only` = exactly today's behaviour): deposit rules were not researched
to statute outside TX, and a guessed clock rule is a legal exposure, not a bug.

**Verified 31/31** (`verify_deposit_clock.js`), four scenarios on real paths (submit → estimate → accept →
deposit/record → real tickler sweep):
- **A (regression, policy OFF):** 0 tolls, clock still running, effort trail still written. **Shipping this
  changes NOTHING until a city opts in** — proven, not asserted.
- **B (TX, on + attested):** clock **tolled** with reason `payment_pending`; on payment the request is
  **RE-RECEIVED** — `started_at` reset, consumed 0, remaining = the full window, prior tolls closed but retained
  as audit.
- **C (`runs_no_stop`):** policy ON but the clock correctly never stops — the effect is honoured per
  jurisdiction, not hardcoded.
- **D (lapse = withdraw):** the real tickler sweep closed the request through the **central** stage transition —
  `REQUEST_WITHDRAWN` history row, `closure_reason = deposit_unpaid`, **no open tasks left claimable**.

**TWO REAL BUGS THE HARNESS FOUND (both pre-existing, both fixed):**
1. **`applyStageTransition` never cancelled open tasks when a request closed** (`taskRouting.js`). ANY close —
   delivery, tickler lapse, nonpayment, deposit withdrawal — left its tasks sitting **claimable in the pools**;
   a staffer could pick up and work a task for an already-closed request. Not specific to this slice. Now a
   close cancels them. *(This is half of the bug pair the spec flags at §8; the raw-`UPDATE` bypasses in
   `feeNonpayment.js:39` / `tickler.js:88` are still outstanding.)*
2. **`overdue()` treats a 0-day window as "no window"** (`tickler.js:21`, `if (!days) return false`), so a
   jurisdiction configuring **zero grace** would never lapse. Zero now means *immediately overdue*, not never.

**Harness deviation, stated plainly:** `POST /notice/send` fires **real outbound email** (Resend is configured
here, no suppression switch). A harness must not mail bounce addresses, so it stamps `notified_at` directly.
Everything *under test* — accept, deposit/record, the tickler sweep — runs through the real endpoints.

**Regressions green:** jurisdiction_rules 24/24 · survey seed 35/35.

**Next (spec §10.4 step 4):** `extend(clockId, days, reason)` — the one genuinely new engine primitive.
`toll()` moves the due date by *elapsed wall time* and **cannot** express "+10 statutory days for unusual
volume" (IL § 3(e), CA § 7922.535(b)). Then step 5: make `tollReasons` load-bearing (declared per clock, never
validated — `toll()` accepts any string).

**State:** `main`, tree clean, app healthy (PM2 restarted with the new code). 18 jurisdictions · 18 clarification
policies + 1 payment policy · **all drafts, 0 attested**. Parent/child migration still blocked on Kevin's §9
answers.

## 2026-07-13 (ja) — Clock `extend()` + `tollReasons` validation — 30/30. **§10 of the spec is COMPLETE.**

**Spec §10.4 steps 4 & 5, the last two.**

**(1) `extend()` — the third clock primitive.** A toll suspends a clock and moves the due date by *elapsed
wall time*. That is structurally the wrong shape for a **statutory extension**, which adds a FIXED number of
days no matter how long anyone waited (5 ILCS 140/3(e): one 5-business-day extension; Cal. Gov't Code
§ 7922.535(b): one, max 14 days). `tolling.extend(clockId, days, reason, opts)` lengthens
`request_clocks.duration`; `computeStatus` derives the rest, so no due date is stored-and-mutated. New
`clock_extensions` ledger + `POST /api/clocks/:clockId/extend` + `GET /:clockId/extensions`.

**Caps are the jurisdiction's statute talking, and the ledger enforces them.** Config per clock:
`extension: { maxDays, maxCount, grounds }`. **`maxDays` caps the TOTAL across the clock's life, not each
grant** — otherwise "one extension of not more than 14 days" is evaded by granting 14 twice (asserted:
3 days then 3 more is refused at a 5-day cap, but the remaining 2 ARE grantable). A **reason is mandatory** —
it is the statutory ground — and an undeclared ground is refused. **No cap is seeded for TX on purpose:** the
TPIA has **no** unusual-circumstances extension (§ 552.221(a) — volume extends what is "reasonable" but grants
no extra statutory days), so an extension there is *uncapped-but-recorded* — if a TX city grants itself extra
days, that belongs in the ledger, not silently blocked and not silently allowed.

**(2) `tollReasons` is finally load-bearing.** Declared per clock in config since day one and **never read** —
`toll()` accepted any string, so a typo silently became a new toll reason and no city could constrain what may
stop its clock. Now validated, with an error that names the allowed set.

**⚠️ This nearly broke the AG hold, and that is the finding worth remembering.** `routes/requests.js` has
tolled the **respond** clock with `ag_ruling_pending` since the AG flow was built — but `ag_ruling_pending` was
**NOT** in the seeded `tollReasons` (`[clarification_pending, payment_pending, extension]`). Switching
validation on without backfilling would have silently killed the AG hold. Backfilled by
`src/db/seed_deadline_toll_reasons.js` (idempotent) + added to `DEFAULT_RULES`; the regression is now an
explicit assertion.

**Verified 30/30** (`verify_extend.js`) on real paths: undeclared toll reason rejected with nothing written to
the ledger · **AG hold still tolls** · extension grows duration by exactly N and the due date with it, clock
stays RUNNING with 0 tolled days (extension ≠ pause) · remaining grows by N, not by wall-clock · ledger records
the ground and the actor · `requests.deadline_date` written back · zero-day and reason-less extensions refused
400 · maxCount, maxDays-total, and grounds caps all bind · a clock can be extended AND tolled, and the
extension survives the resume.

**Regressions green:** deposit clock 31/31 · survey seed 35/35 · jurisdiction_rules 24/24. *(jurisdiction_rules
intermittently reports 23/24 when run back-to-back with other harnesses — it waits ≤15s for the AI
classification to land on a freshly-submitted request and occasionally times out under load. Harness timing
sensitivity, NOT a product defect; passes clean on every isolated run.)*

**§10 IS COMPLETE.** The clock subsystem now has all three primitives (**toll · restart · extend**), a
per-jurisdiction rule store, a validated toll vocabulary, and 18 jurisdictions of real rule data — where this
morning it had a global singleton config, one jurisdiction, an unused reset, and zero tolls ever recorded.

**Left in this area (none blocking):** the **state → city precedence stack** (Tulsa's EO / SF's Sunshine
Ordinance are city overlays on looser state law — recorded as notes, not data); deadline configs for the other
17 jurisdictions (only TX has one — the rest fall back to the global default); a **UI editor** for the policy
areas (API-only today); and the still-outstanding raw-`UPDATE` bypasses in `feeNonpayment.js:39` /
`tickler.js:88` (spec §8).

**State:** `main`, tree clean, app healthy. **The parent/child migration is the next real body of work and is
still blocked on Kevin's answers to spec §9.**

## 2026-07-13 (kb) — The raw `UPDATE requests SET stage` bypasses are GONE — 24/24. ARCHITECTURE item 6 holds.

**Kevin: "fix the raw UPDATE bypasses in feeNonpayment and tickler."** Done — and there were **three** sites, not
the two the audit found.

ARCHITECTURE item 6 says: *one* central stage-transition function; every stage advance writes `request_history`
AND spawns/updates the stage task; **no direct `UPDATE requests SET stage` anywhere else.** Three places broke it:

1. **`feeNonpayment.closeForNonpayment`** — the nonpayment auto-close.
2. **`feeNonpayment.reopen`** — *missed by the audit.* Closed → `awaiting_payment` with a raw UPDATE.
3. **`tickler`** estimate-lapse auto-withdraw.

All three now go through `taskRouting.applyStageTransition`. **Zero raw stage writes remain outside
taskRouting** — asserted at the SOURCE level in the harness (a regex over both files), so a future one fails a
test rather than rotting quietly.

**What the fix actually buys** (harness-verified on real paths): every close now writes a history row **carrying
`stage_from` → `stage_to`** (the raw UPDATE recorded neither), and — via the `applyStageTransition` fix from the
(hz) slice — **cancels the request's open tasks**, so a closed request no longer leaves work claimable in the
pools. The tickler's lapse flag and `closure_reason` are preserved (the transition clears `tickler_flag` on a
forward advance, so it is deliberately re-stamped: the lapse reason is what the queue displays).

**A CLAIM I MADE THAT WAS WRONG, corrected here.** I said the `reopen` bypass was "the worst of the three —
a reopened request landed back in awaiting_payment with NO task, live but invisible to every worklist."
**That is false.** `awaiting_payment` is deliberately **not** in `taskRouting.STAGE_TASK` — it is a
WAIT-ON-THE-REQUESTOR state, owned by the tickler + deposit sweeps, not by a staff task. A reopened request
correctly has **no** task and is correctly visible to the sweeps that own that stage. The real defect in
`reopen` was only the missing history row. The harness now asserts the true invariant (no task, but matches the
sweep candidate shape) instead of a fictional one.

**Verified 24/24** (`verify_stage_bypass.js`): source-level check that no raw stage write survives · nonpayment
close writes CLOSED_NONPAYMENT with `intake → closed` and cancels 1 open task · reopen writes
REOPENED_NONPAYMENT with `closed → awaiting_payment`, clears `closure_reason`, and is sweep-visible · the real
tickler sweep's estimate-lapse withdraw writes ESTIMATE_LAPSED with `intake → closed`, preserves
`closure_reason` + `tickler_flag`, and cancels its open task · fee profile restored byte-for-byte.

**The `jurisdiction_rules` flake is FIXED — and it was a TEST bug, not a product bug.** It asserted
`updated_by === 'backfill'` on the TX deadline row; any later write through the real path (a harness restore, an
AI apply, a staff edit) legitimately re-stamps that column, so the test failed **only when another harness had
run first**. It now asserts the row exists and holds real config, which is what actually matters.

**FULL SUITE GREEN, CHAINED BACK-TO-BACK — 144 assertions, 0 failures:** extend 30/30 · deposit clock 31/31 ·
survey seed 35/35 · stage bypass 24/24 · jurisdiction_rules 24/24.

**State:** `main`, tree clean, app healthy. **Spec §8's bug pair is now fully closed** (the ghost
`custodian_retrieval` stage in the frontend's legacy stage order is the one item left from that pair — frontend,
untouched). **The parent/child migration is the next real work and remains blocked on Kevin's spec §9 answers.**

## 2026-07-13 (lc) — ONE stage vocabulary. The ghost is gone, and it was hiding a worse bug — 23/23

**Kevin: "fix the ghost custodian_retrieval stage in the frontend."** The ghost was a symptom. There were
**THREE divergent stage vocabularies**, and the frontend's drove **live stage writes**.

| Where | What it said |
|---|---|
| `taskRouting.STAGE_ORDER` (canonical) | intake · fee_review · awaiting_payment · record_search · exemption_review · ag_review · redaction_review · redaction · delivery · closed |
| **6 frontend files** (each its own copy) | intake → **record_search** → redaction_review → **fee_review** → awaiting_payment → delivery, **+ ghost `custodian_retrieval`**, and **no** exemption_review / ag_review / redaction |
| `routes/workflow.js` VOCAB (AI rule builder) | 4 stages: intake, record_search, redaction_review, fee_review |

**The real bug the ghost was hiding:** `RequestWorkspacePage`'s Advance button wrote stages from the frontend
list. So an operator advancing a request walked a pipeline **the backend does not have** — it went to
record_search *before* fee_review (skipping the money), and **could never reach `redaction`,
`exemption_review` or `ag_review` at all.** Separately, the AI workflow-rule builder was handed a 4-stage
vocabulary, so it could only ever emit a quarter of the pipeline.

**Shipped.** `backend/src/services/stages.js` — ONE definition (order + labels + `next()`), which
`taskRouting` and `routes/workflow.js` now both consume. `GET /api/stages` serves it.
`frontend/src/lib/stages.js` is a static mirror (labels + colours + `nextStage()`); all **6** frontend files
import it and **none keeps a private copy**. The three stages the UI never knew about got badge colours in the
existing palette's idiom (exemption_review slate · ag_review rose — it is the one stage that hands control to
an outside authority · redaction in the amber family with redaction_review). `nextStage()` of an unknown stage
returns **null**, so the Advance button simply does not render rather than guessing a destination.

**Verified 23/23** (`verify_stages.js`, Playwright on the real app): the ghost appears in **no** frontend or
backend code (comments explaining it are allowed; code references are not) · **FRONTEND↔BACKEND PARITY** — the
mirror is compared to `GET /api/stages`, so a future edit to one and not the other **fails a test instead of
rotting** · all 10 stages have a label and a colour · no page keeps a private copy · the workflow VOCAB is
canonical · `next(intake) = fee_review` (not record_search) · redaction is reachable · the **live UI** offers
"Advance to Fee Review", renders the full 10-stage pipeline, shows no Custodian Retrieval, throws no runtime
errors · the advance succeeds through the real endpoint and history records `intake → fee_review`.
Screenshot: `stages_workspace.png`. FE rebuilt (`main.908f1d35`), nginx serving it.

**FULL SUITE GREEN — 167 assertions, 0 failures:** stages 23/23 · stage bypass 24/24 · extend 30/30 ·
deposit clock 31/31 · survey seed 35/35 · jurisdiction_rules 24/24.

**State:** `main`, tree clean, app healthy. **Spec §8's bug pair is now FULLY closed** (both the raw-`UPDATE`
bypasses and the ghost stage). **The parent/child migration is the next real work and remains blocked on
Kevin's spec §9 answers.**

## 2026-07-13 (md) — Deadline rules for IL + CA: the same action, different law — 25/25

**The multi-jurisdiction story is now real, not theoretical.** `tolling.extend()` shipped with per-jurisdiction
caps but only TX had deadline rules, so the caps had nothing to bind to. Seeded **Illinois and California**
from the 2026-07-13 legal research (`src/db/seed_deadline_rules.js`, idempotent).

**The assertion that matters:** the SAME action produces DIFFERENT law.
- **IL** — 5 **business**-day clock (5 ILCS 140/3(d)); extension capped at **one grant of 5 days** on seven
  statutory grounds (§ 3(e)). A second extension is refused. An invented ground is refused.
- **CA** — 10 **calendar**-day clock (§ 7922.535(a)), labelled **"Determine & notify"** — because the CPRA's
  10 days is a *determination* deadline, not production (§ 7922.530(a) is separately "promptly available").
  The label is what an operator reads, so it must not misstate the duty. Extension capped at **one grant of
  14 days** (§ 7922.535(b)); a 15-day grant is refused, 14 is allowed. `cyberattack` is a valid CA ground and
  would be refused in IL.
- **TX** — unchanged, and **no cap**: the TPIA grants no unusual-circumstances extension, so an extension there
  is uncapped-but-recorded.

**Verified 25/25** (`verify_deadline_rules.js`) by making each jurisdiction ACTIVE in turn and watching a real
request's clock change shape: IL → 5 business_days, CA → 10 calendar_days, TX → its by-classification
durations. The active jurisdiction is a global switch, so the harness restores it and asserts the restore.

**⚠️ WHAT I REFUSED TO SEED, AND WHY — new spec §10.5 (Kevin's call).** **FL, WA, NY and CT are deliberately
NOT seeded.** Their short statutory clock is **not a production deadline**: FL has *no* clock at all (only
"reasonable custodial delay" per record, *Tribune Co. v. Cannella*); WA's 5 business days is a duty to
*respond* (RCW 42.56.520) with no final production deadline; NY's 5 is to *acknowledge* (§ 89(3)(a)); CT's 4 is
the deadline for a *denial* (§ 1-206(a)). **Modelling any of them as a produce clock would report FALSE
LATENESS — the exact bug class we fixed this session** (an unpaid deposit burning the statutory clock).

The engine already supports a non-primary **`acknowledge`** clock as pure config (clock types are arbitrary
keys), so no code is needed. **The open PRODUCT question:** when a jurisdiction has no production deadline,
does the request show a **blank deadline_date** (legally honest) or an **internal service target**
(operationally useful, not law)? That is a Kevin decision, and it is why those four are unseeded rather than
guessed.

**FULL SUITE GREEN — 192 assertions, 0 failures:** deadline rules 25/25 · stages 23/23 · stage bypass 24/24 ·
extend 30/30 · deposit clock 31/31 · survey seed 35/35 · jurisdiction_rules 24/24.

**State:** `main`, tree clean, app healthy, active jurisdiction still `jur-tx`. 20 jurisdiction profiles ·
18 clarification policies · 3 deadline rule sets · 1 payment policy. **The parent/child migration is the next
real work and remains blocked on Kevin's spec §9 answers.**

## 2026-07-13 (ne) — ONE request-creation helper + a LIVE intake bug that was already firing — 22/22

**I did NOT start the parent/child migration.** An audit of every `requests` query first (27 LIST/COUNT queries)
showed it is **not safe as one slice**, and three of the failure modes are **destructive**: `feeNonpayment` loops
every active request and would **send duplicate dunning emails to real citizens**; `clarificationTimeout`
**auto-closes** and a parent match is a false positive that closes a live request; the tickler stall sweep would
flag every parent as "stalled" forever. That migration needs its own session with the query rewrite done first.

**What the audit DID find is a bug that is live right now.** ARCHITECTURE item 5 ("one request-creation helper")
was **not true**: 5 INSERT sites, **3 different request-numbering algorithms**, and **5 hardcoded deadline
computations**.

| Path | Numbering | Verdict |
|---|---|---|
| staff create | `MAX(request_number) + 1` | correct |
| `/public` | last row **BY created_at**, +1 | **BROKEN** — the newest row is `DEMO-2026-5069`, whose prefix isn't the year, so it restarts at **`2026-0001`** — a number that already exists. **This route could not create a request at all.** |
| **the live portal** (`/api/public/submit`) | **`COUNT(*) + 1`** | **BROKEN** — delete ANY request below the max and COUNT+1 mints an existing number → UNIQUE violation → **intake 500s**. It worked only by coincidence: COUNT (44) == MAX (44). |

**The harness reproduced the live bug against the running server before the fix landed** (the API was still on
old code): submit → submit → delete the first → third submit returned **500**. Cities purge requests. This was a
landmine.

**Shipped.** `services/requestCreate.js` — ONE helper: one numbering algorithm (`MAX + 1` over well-formed
`YYYY-NNNN` only, so `DEMO-`/`SYS-`/`LIBRARY` rows can't corrupt it), **retried on unique collision** so
concurrent submissions can't mint the same number, one INSERT, one CREATED history row. All three intake paths
now call it; **neither route inserts into `requests` directly any more**. This is also where **wrap-in-parent**
will live when the migration comes — one place instead of three.

**The deadline is now the jurisdiction's, not a hardcoded table.** All three paths carried their own
`{simple:5, standard:10, complex:20, redaction_required:30}` **calendar**-day map, and the classifier then
**overwrote** `deadline_date` with `today + cls.deadlineDays` — a **fifth** source. That silently ignored the
jurisdiction: wrong in IL (which counts **business** days) and in CA (whose clock is a *determination*
deadline). Gone. The helper starts the clocks and `tolling.writebackDeadline()` derives the date; new
`tolling.applyClassification()` re-derives the duration from the jurisdiction's `durationByClassification` when
the AI classifier lands — and **refuses to touch a clock that has been extended**, so a granted statutory
extension can never be silently erased.

**Verified 22/22** (`verify_request_create.js`): both broken algorithms demonstrated against the real DB · no
private numbering or raw INSERT left in either route · the hardcoded deadline table gone · **after a deletion,
intake still succeeds** (`2026-0047` where the old code 500'd) · **5 concurrent submissions → 5 distinct
numbers** · the clock duration comes from the jurisdiction's table · `requests.deadline_date` equals the derived
due date (one source of truth) · exactly one CREATED history row.

**FULL SUITE GREEN — 214 assertions, 0 failures:** request-create 22/22 · deadline rules 25/25 · stages 23/23 ·
stage bypass 24/24 · extend 30/30 · deposit clock 31/31 · survey seed 35/35 · jurisdiction_rules 24/24.

**⚠️ NOTE FOR THE NEXT SESSION — the parent/child migration audit is done and is the map.** 27 LIST/COUNT
queries need a parent/child filter before any rows are migrated. Ranked by risk: `routes/requests.js` (queue +
all 3 dashboard counts), `services/reportEngine.js` (backs EVERY report; `BASE_EXCL` is the hook),
`services/tickler.js` (stall sweep would flag every parent forever), `routes/feeEstimates.js` (14 queries,
nearly all parent-side money), `services/feeNonpayment.js` (**duplicate dunning emails to citizens**),
`services/clarificationTimeout.js` (**destructive — auto-closes**), `routes/tasks.js` (`withReq()` needs a
second join to the parent for `request_number`). Also: `request_number` is `UNIQUE NOT NULL`, so every child
must be given a `-N` suffix — children cannot inherit NULL.

**State:** `main`, tree clean, app healthy (PM2 restarted 23:34 with the new code). **The parent/child migration
remains the next real work and is still blocked on Kevin's spec §9 answers.**

## 2026-07-13 (of) — The query layer is parent/child-aware BEFORE the migration — a PROVEN no-op (13/13)

**The migration's real danger was the query layer, not the schema.** 27 LIST/COUNT queries would double-count
the moment parent rows exist — and three destructively: **duplicate dunning emails to real citizens**
(`feeNonpayment` loops every active request), `clarificationTimeout` **auto-closing** a parent, and the stall
sweep flagging **every parent as stalled forever**.

**The trick that made this safe: predicates that are true BOTH before and after.** `services/requestScope.js`:
- **PARENT** = a ROOT row (`master_request_id IS NULL`) — the citizen's request: number, requestor, money,
  clock, deadline.
- **LEAF/CHILD** = a row with nothing beneath it (`NOT EXISTS (… c.master_request_id = r.id)`) — the unit of
  work: description, stage, routing, tasks, files, redaction.

Today a request **IS its own parent and its own child**, so both are tautologies — **125 roots, 125 leaves,
125 rows** — which makes adopting them a **PROVABLE NO-OP**, not an asserted one. I snapshotted every list,
count, report and sweep-candidate set BEFORE the change and diffed after: dashboard counters (36/31), the
queue's 39 rows, all 7 reports, stall/nonpayment/reconciler candidate sets — **byte-identical, 14/14**. The
migration now flips them automatically, with **no query to rewrite under pressure**.

**Scoped:** dashboard counters (PARENT) + by-stage (LEAF) · request queue (LEAF) · all 4 `reportEngine`
queries · tickler stall sweep (LEAF) + scanned count (PARENT) · **the nonpayment dunning sweep (PARENT — the
duplicate-email bug)** · task reconciler (LEAF) · flagged worklist (LEAF). Index on `master_request_id`.

**A pre-existing bug the equivalence diff exposed:** the queue ordered by `created_at DESC` with **no
tiebreaker**, and reports ordered by `value DESC` with none — so rows with equal timestamps/counts **swapped
places between reloads**. It looked like data churn in a report that had not changed. Deterministic tiebreakers
added (`r.id`, `k`); two consecutive runs are now identical.

**Verified 13/13** (`verify_scope.js`): both predicates are tautologies today · both **discriminate** the moment
a child exists (parent excluded from work lists, child excluded from money/volume) · **the stall sweep does not
see the parent** · **the dunning sweep does not see the child** but does see the parent · `request_count` counts
each citizen request once, not once per child · reports are deterministic.

**⚠️ WHAT I DID NOT GUESS (spec §11.1):** a PARENT metric grouped by a CHILD field (`fee_revenue by
department`) needs a parent↔child JOIN — money is on the parent, department on the child. The tickler's
estimate/deposit joins straddle the split and cannot be scoped until the migration decides which side
`request_fee_estimates` repoints to. `clarificationTimeout` is **left unscoped on purpose**: it auto-closes, and
the law is genuinely split — the clarification is logged on the CHILD but an unanswered one withdraws the WHOLE
request (Tex. Gov't Code § 552.222(d)). That is a roll-up decision (§6), not a scoping one.

**FULL SUITE GREEN — 227 assertions, 0 failures:** scope 13/13 · request-create 22/22 · deadline rules 25/25 ·
stages 23/23 · stage bypass 24/24 · extend 30/30 · deposit clock 31/31 · survey seed 35/35 · jurisdiction_rules
24/24.

**State:** `main`, tree clean, app healthy. **The parent/child migration is now a DATA-ONLY change** — the
schema columns exist, the creation helper is the single wrap point, and every query already knows which side it
wants. It still needs Kevin's spec §9 answers and the §11.1 decisions above.

## 2026-07-13 (pg) — The citizen-facing request number resolves through the parent (15/15)

**Closes the last item of §11.1's display-join work.** Tasks, objections and worklists all hang off the WORK
row, but `request_number` is a **PARENT** field — it is the number the citizen was given and quotes on the
phone. After the migration a child's own number carries a component suffix (`2026-0045-1`); showing that in a
task list would confront staff with a number **the citizen has never seen**.

**Same tautology trick as the scope predicates.** `requestScope.numberJoin()` / `numberExpr()` resolve the
number through the parent — `COALESCE(_p.request_number, r.request_number)` over
`LEFT JOIN requests _p ON _p.id = r.master_request_id`. Today `master_request_id` is NULL, so `_p` is NULL and
it falls back to the row's own number: **a provable no-op**. After the migration it resolves to the parent's
number automatically. Applied to `routes/tasks.js` `withReq()` (both worklists) + the task-detail query, and
all **7** `objections.js` display joins.

**A regression I caught before shipping:** `COALESCE(...)` with no alias returns a column literally named
`coalesce`, not `request_number` — which would have silently blanked the number in every task and objection
list. Aliased; asserted against the live API that rows still carry `request_number` and no `coalesce` column.

**Verified 15/15** (`verify_scope.js`, extended) — including the one that matters: with a parent+child present,
**a task on the CHILD resolves to the PARENT's number** ("SCOPE-P", not "SCOPE-P-1"), while the child row still
carries its own component number for the record. Plus 6/6 against the **live API**: `/tasks/pool`,
`/tasks/mine`, `/tasks/:id`, `/objections/mine`, `/objections/pending-approval` all 200, numbers unchanged
(`2026-0002`).

**FULL SUITE GREEN — 229 assertions, 0 failures.**

**State:** `main`, tree clean, app healthy. **Migration prep is COMPLETE on the query layer**: scope predicates,
the citizen-number resolution, the one creation helper (the single wrap point), and the schema columns all
exist. Remaining before the migration can run: **Kevin's spec §9 answers**, the **§11.1 decisions** still open
(a PARENT metric grouped by a CHILD field needs a join; the tickler estimate joins; `clarificationTimeout`'s
auto-close), and the **UI design direction** for the parent/child queue treatment (UI rule: agree before
building).

## 2026-07-14 (qh) — Fee-waiver substrate + THE ILLINOIS FEE-FORFEITURE GUARDRAIL — 37/37

**Kevin: "build the fee-waiver substrate with the Illinois guardrail."** Built, seeded for 7 states, verified.

**THE GUARDRAIL IS THE POINT.** 5 ILCS 140/3(d): a public body that answers late "**may not impose a fee for
such copies**." A request parked in "awaiting fee-waiver decision" — a hold state any system would model —
keeps aging against IL's 5-business-day clock, and **deciding a waiver is NOT one of the seven § 3(e)
extension grounds**. On day 6 the city has constructively denied the request AND **permanently lost its right
to charge**. The deliberation destroys the fee.

`services/feeForfeiture.js` therefore **REFUSES** — it does not warn. Both doors to charging
(`POST /fee-estimates/request/:id` and `POST /notice/send`) return **409 `FEE_FORFEITED`** with the § 3(d)
citation, and **no estimate row is written**. A warning would let a clerk click past it and bill unlawfully.
There is also a **risk()** warning that fires *before* the block, and names the trap by name.

**⚠️ A DELIBERATE FAIL-SAFE INVERSION — read before "fixing" it.** Every other policy is gated on
`enabled === true AND attested` (AUTO_CONFIG safe-manual default). **This guardrail is armed by the FLAG
ALONE**, without `enabled` or attestation, because the failure directions are asymmetric: blocking an invoice
the city was never entitled to send costs it **nothing** (the law already says it may not charge), while
*failing* to block means it bills unlawfully and loses the fee anyway. **The safe failure is to block.** The
flag is false everywhere except IL, so **nothing changed for TX** (the active jurisdiction) — asserted.

**THE TEXAS TRIGGER — the field that stops us auto-closing live requests.** The obvious design (start the
pay-or-abandon clock on the waiver denial) is **wrong for Texas**. A TX waiver denial does *nothing*
procedurally; the 10-business-day deemed-withdrawal hangs off the **money documents** — the itemized estimate
(§ 552.2615(b)) and the deposit demand (§ 552.263(f)). `response_window_trigger` is an explicit enum and TX is
seeded `cost_estimate_sent`, **not** `waiver_denial`.

**Two invariants a city CANNOT configure around** (`validate()` throws): `deemed_granted_on_silence` (no state
has one — silence is a deemed DENIAL everywhere), and a waiver-pending **toll** in a jurisdiction whose
extension grounds are a closed list (that IS the IL trap).

**Seeded 7 states, all DRAFTS (`enabled: false`):** TX · IL · CT · WA · NY · CA · FL. CT and NY got new
jurisdiction profiles (the 17-state clarification survey never covered them). **The pay-or-abandon clock is
STATUTORY IN ONLY ONE OF SEVEN STATES.** WA's 30 days is a **model rule**; FL's is **pure agency policy**; CA,
IL, NY and CT have none. `provenance.source` is therefore **load-bearing, not cosmetic** — only TX may tell a
requestor "the law gives you 10 business days." A UI that renders every timer as "the legal deadline"
**misleads requestors in four of seven states**.

**The sleeper field — `appeal_can_order_waiver`.** IL's PAC will open a fee-waiver file and then tell the
requestor it was **never empowered to grant one** (2017 PAC 47258). TX's AG reviews the **amount**, not the
§ 552.267 call. **CT's FOIC is the only forum in the set that can actually order a waiver.** Never route a
requestor to a forum that cannot grant what they came for.

**Verified 37/37** (`verify_fee_waiver.js`) — incl. the guardrail firing on a blown IL clock, both doors
refusing with the citation, zero estimate rows written, the at-risk warning naming the trap, and **a TOLLED
clock correctly NOT counting as blown**.

**Two harness bugs fixed (not product bugs):** `verify_survey_seed` hardcoded "18 jurisdiction profiles" and
iterated *every* profile — both broke when CT/NY arrived. It now asserts the invariant (every clarification
policy has a profile) instead of a frozen count.

**FULL SUITE GREEN — 266 assertions, 0 failures** across 10 harnesses.

**State:** `main`, tree clean, app healthy, active jurisdiction still `jur-tx`. 20 jurisdiction profiles ·
18 clarification · 3 deadline · 1 payment · 7 fee-waiver policies — **all drafts, 0 attested**.

## 2026-07-14 (rj) — The "send again" gate + TWO CONFIG-CORRUPTION BUGS the suite exposed — 24/24

**Kevin (2026-07-14): "the rules configuration needs to be able to know when 'send again' is required, for
either re-invoice or a second request for clarification."** Built the re-invoice half; slotted the
clarification half.

**THE GAP.** The 20% variance rule was **already computed** — `reconcile()` sets `renotify_required` when
actuals overrun the accepted estimate. **But it was a flag and nothing else. Nobody read it.** The harness
proves the bug on the live system: a **$40 estimate, $390 in actuals (+875%), "revised notice required"
flagged — and the full $390 collected, status 200.** TX § 552.2615(b)-(c): the updated itemized statement is a
**PRECONDITION to the money** ("a body that does not provide the required itemized statement may not collect
more than $40").

**Shipped.** `services/feeReissue.js` + 3 fields on `paymentClockPolicy` (`reissue_required_on_variance` ·
`reissue_blocks_collection` · `reissue_restarts_response_window`, seeded for TX from § 552.2615). Both money
doors (`/payment/record`, `/final-payment/record`) return **409 `REVISED_ESTIMATE_REQUIRED`** with the
citation, and **no payment row is written**. The **ceiling is what the requestor was LAST TOLD** — collecting
up to the accepted estimate is still allowed; only the *overage* is refused. Sending the revised statement
**cures** it. Clarification half: `second_notice_required` / `second_notice_days` slots exist but are
**deliberately NOT seeded per state** — an unresearched notice duty is the same legal exposure as an
unresearched clock rule.

**⚠️ THIS GATE IS *NOT* FAIL-SAFE-INVERTED, AND THE DIFFERENCE FROM `feeForfeiture` IS DELIBERATE.**
feeForfeiture is armed by its flag alone because in IL the fee is **already lost by law** — blocking costs the
city nothing it still had. Here the fee is **not** lost; the city cures it by sending the statement. Blocking
prematurely would stop a **legitimate** payment with a clerk standing there. So this gate respects the normal
`enabled` gate. **Caught before shipping:** TX is the ACTIVE jurisdiction and I had seeded
`reissue_blocks_collection = true` — flag-only arming would have started blocking payments at the live counter
immediately. *Block for free; never block at a cost the city did not agree to.*

**TWO CONFIG-CORRUPTION BUGS THE SUITE EXPOSED — both were LIVE data damage, not test noise:**
1. **The live TX deadline config held `standard = 77` and a leftover `__probe` marker.** `verify_jurrples`
   mutates the live TX config and restores from whatever it read *at start* — so once an early crashed run
   left the probe value behind, every later "restore" **cemented the corruption**. TX requests were being
   given a **77-day** standard clock.
2. **The live TX clarification policy was `enabled: true` with NO provenance** — same laundering trap, same
   harness, different field. It had been switched ON in production data by a crashed test.

**Both repaired** (re-ran the seeds) and the harness now has a **PRE-FLIGHT GUARD that refuses to run against
a dirty config** rather than laundering it, plus a cleanup assertion that no probe marker survives. This is the
lesson: *a harness that mutates live config must validate the snapshot it is about to trust.*

**Also fixed:** a timestamp-granularity race in the reissue harness (`pending()` asks "was a notice sent AFTER
the reconciliation?", and the harness could re-send inside the same second, which a human never can).

**FULL SUITE GREEN — 293 assertions, 0 failures** across 11 harnesses.

**State:** `main`, tree clean, app healthy, active jurisdiction `jur-tx` with a **repaired** config
(standard=10, clarification a draft with provenance).

## 2026-07-14 (sk) — Config integrity: the corruption class can no longer sit silently — 12/12

**Yesterday's finding needed a systemic answer, not just a repair.** The live TX deadline config had held
`standard = 77` days (real requests on a 77-day statutory clock) and a `__probe` marker; the live TX
clarification policy had been `enabled: true` with no provenance — a policy switched ON in production by a
crashed test. Both persisted **silently for an unknown time**, and both were **cemented** by the harness's own
restore, which trusted whatever snapshot it read.

**Nothing in the system could see it.** The attestation-drift check compares `content_hash` to `attested_hash`
— and nothing is attested, so it had nothing to compare against.

**Shipped.** `services/configIntegrity.js` + `GET /api/config-integrity` + `node src/db/check_config_integrity.js`
(exits non-zero on error, so it can gate a deploy). Five invariants that hold **regardless of attestation**:
1. **No live rule may be stamped by a test** (`updated_by ~ harness|probe|test`).
2. **No config may carry a key its schema does not define** — this is how `__probe` survived.
3. **An ENABLED policy must carry provenance** — a rule a city actually adopted has a citation; one that
   doesn't is a test write.
4. **Clock base durations must be plausible** (1..45 days).
5. The active jurisdiction must have a usable primary clock.

**⚠️ THE CHECK ALMOST MISSED THE BUG IT WAS WRITTEN TO CATCH.** My first plausibility bound was **1..90 days**
— and **77 sits inside it**. The harness caught that immediately. Tightened to **1..45** (the longest base
deadline anywhere in the researched set is TX `redaction_required` at 30). *A bound has to be tight enough to
catch a plausible-looking wrong number, not just an absurd one.*

**The harnesses are fixed at the root, not patched.** Three of them (`verify_deadline_rules`, `verify_reissue`,
`verify_deposit_clock`) restored live config while stamping themselves `harness-restore` — a test fingerprint on
production data, which the new checker flagged on its very first run. They now **capture and restore the
original `updated_by`**, so the row goes back *exactly* as found. `verify_jurrules` additionally **refuses to
run against a dirty config** rather than laundering it.

**Verified 12/12** (`verify_config_integrity.js`) by INJECTING each contamination class and proving it is
caught: the 77-day clock · the `__probe` key · a `harness-restore` stamp · an enabled-with-no-provenance policy
· an invalid clock basis. Every finding carries a `fix` line.

**THE PROOF THAT MATTERS: after the ENTIRE 12-harness suite runs, `check_config_integrity` reports CLEAN.**
The tests no longer damage the data they test.

**FULL SUITE GREEN — 305 assertions, 0 failures** across 12 harnesses.

**State:** `main`, tree clean, app healthy, `jur-tx` active with verified-clean config.

## 2026-07-14 (tm) — clarificationTimeout scoped (the most destructive query in the migration) + two DECISIONS surfaced

**One of the three open §11.1 items was decidable once Kevin answered §6.2. The other two are NOT — and I am
not guessing them. They are design gaps in the spec, not work items.**

**DONE — `clarificationTimeout`.** It **AUTO-CLOSES**, so unscoped it was the single most destructive query in
the migration. Kevin's §6.2 answer settles it: two different rows are involved.
- The clarification **EVENT** is logged on the **CHILD** — that record's description was the vague one.
- The **CLOSURE** is a **PARENT-level terminal event that CASCADES DOWN**. Tex. Gov't Code § 552.222(d)
  withdraws "**the underlying request**," not one record of it. Closing the child would leave the citizen's
  request half-alive.

The sweep now searches LEAF rows and closes `COALESCE(master_request_id, id)`. **Verified no-op today:**
`close_target === id` on all 125 rows.

**⚠️ TWO ITEMS ARE BLOCKED ON A DECISION (spec §11.1). I previously mis-described both as join problems.**

**(a) Where does the PAYMENT GATE live on the parent?** Spec §5.2 says `fee_review`/`awaiting_payment` "move
off the child — they are parent gates." **But the parent has no `stage`** — it has `parent_state`
(Intake · In Process · Processed · Delivered · Closed), and **none of those is a payment gate.** So awaiting-
payment has nowhere to live. **Concrete consequence:** `tickler.js`'s deposit sweep joins
`requests.stage = 'awaiting_payment'` to `request_fee_estimates`. After the migration the **estimate hangs off
the parent** and the **stage off the child** — the join matches nothing and **the deposit sweep silently stops
running**: no dunning, no lapse, no withdrawal. *Recommend: drive the sweep off the parent's `payment_status`
(§4.3) and drop the stage predicate — the money axis already exists on the parent.*

**(b) `fee_revenue by department` is UNDEFINED, not unjoined.** I called this a join problem. **It is not.**
Revenue is ONE number on the parent; a parent with two children in two departments has **one revenue figure and
two departments**. A join would double-count it into both. Attributing it needs an **allocation rule** — the
same allocation **the law is silent on** (§5.10). *Recommend: report revenue only by parent-level groupings
(month, requestor, status) and refuse the child-grouped cut. A wrong revenue-by-department number is worse than
none, and nothing depends on it yet.*

**Suite green; config integrity CLEAN after the run.**

**State:** `main`, tree clean. **Migration prep is complete except for those two decisions**, which are
Kevin's — they cannot be resolved from the code.

## 2026-07-14 (un) — ⚠️ ANTHROPIC CREDITS EXHAUSTED + the silent-orphan bug it exposed

**FIRST, THE OPERATIONAL FACT (Kevin's action):** the Anthropic API credit balance is **exhausted**.
`400 invalid_request_error — "Your credit balance is too low to access the Anthropic API."` **Every AI feature
is down**: intake classification, the redaction AI read, the help agent, the report agent, and the config
extractors all call the same API. This is billing, not code.

**THE BUG IT EXPOSED — a SILENT ORPHAN at intake.** `publicChat` wrapped `classifier.classifyAndRoute()` in a
bare `try/catch` that only logged. So on an AI failure the request was still **created and returned 201 to the
citizen** — but never classified, given no record type, and left at `intake`. And the existing "unroutable"
fallback in `workflowEngine` **did not save it**: that fallback only fires when `teamId` is **null**, and the
rulebook still assigns a DEFAULT team (Open Records). So `teamId` came back non-null, **no routing-review task
spawned**, and the request sat there *looking routed* — in nobody's worklist, with no flag, no alert, and no
error anywhere. **23 active intake requests currently have no routing basis.**

**Fixed.** The catch now spawns a **`routing_review` task** (team-agnostic, pooled) and writes a
`CLASSIFICATION_UNAVAILABLE` history row naming the failure. **An AI outage must degrade to HUMAN WORK, not to
silence.**

**Verified against the REAL outage** (credits are actually out, so this is not a simulated failure):
submit → `HTTP 201` → history `CREATED -> CLASSIFICATION_UNAVAILABLE` → **an open `routing_review` task**.

**Also shipped (a68df67), Kevin's two §11.1 decisions:**
- **Deposit sweep on the MONEY AXIS.** It required `r.stage = 'awaiting_payment'`; after the migration the
  estimate hangs off the parent and the stage off the child, so that join would match nothing and **the deposit
  sweep would silently stop running** — no dunning, no lapse, no withdrawal, no error. Now keyed off
  `accepted + deposit_due > 0 + unpaid`. **`deposit_due > 0` is load-bearing** — without it, a request that
  accepted an estimate owing NO deposit has `deposit_paid_at` NULL forever and would be flagged overdue for a
  deposit it never owed. That false-positive case is now **constructed and asserted**, not hoped for (35/35).
- **`fee_revenue by department` DROPPED, not joined.** Revenue is ONE number on the parent; a parent whose
  records span two departments has one payment and two departments, so any split is an invented allocation —
  and **the law is silent on allocation** (§5.10). A join would double-count it into both columns. The engine
  now refuses the cut and explains why; **counts by department stay exact and are still offered**. The AI
  report agent is taught the constraint so it cannot generate the impossible spec.

**⚠️ NOTE ON THE SUITE:** two harness assertions (`stage_bypass` "has an open task before the close") depend on
the AI classifier succeeding, so they FAIL while credits are out. **They are preconditions, not regressions** —
every assertion about the behaviour under test passes. Re-run them once credits are restored.

**State:** `main`, tree clean, config integrity CLEAN.

---

## 2026-07-14 (vp) — The orphan sweep was a FALSE ALARM. The fix it was based on is REAL and now PROVEN live.

Picked up the handoff's two "do this first" items. One is still blocking. The other **was wrong, and running it
would have polluted a live worklist.**

**1. Credits are STILL exhausted.** Confirmed with a live call: `400 invalid_request_error — "Your credit
balance is too low."` Every AI feature remains down. **This is billing and it is still Kevin's action** — no
code can clear it. It is the only thing blocking the suite's two `verify_stage_bypass` preconditions.

**2. ❌ THE "23 SILENT ORPHANS" DO NOT EXIST. The prescribed sweep was a trap.** The handoff said 23 active
intake requests were "submitted while classification was failing" and told the next session to spawn a
`routing_review` task for each. Every part of that is false, and the dates alone disprove it:

- **The diagnostic query measures the wrong thing.** `routing_basis` was **first populated 2026-06-09**. Rows
  created before that are NULL *by construction* — **112 of 126 requests are NULL**, back to 2026-01-10. NULL
  means "predates the column," **not** "classification failed."
- **The 23 are May demo rows — dated 2026-05-24 → 2026-06-04 — six weeks BEFORE the July 13 outage.** They
  cannot be casualties of it. And **all 23 are already classified** (every one has a `classification`).
- **One of them is `SYS-TEMPLATE-SAMPLES`** — a system row (`system@optimumq.ai`, "Holding area for sample
  records used to build redaction templates"). Spawning a human task on it is exactly the **pseudo-request the
  ARCHITECTURE invariant forbids** ("Passive/heads-up items are Notifications, never fake tasks or
  pseudo-requests").
- **The TRUE silent-orphan signal returns ZERO**: `status='active' AND stage='intake' AND classification IS
  NULL` with no open task → **0 rows**. Nothing is orphaned. Nothing needs sweeping.

Had the sweep run, it would have injected **23 bogus tasks** into a real queue — 22 on already-classified demo
rows and 1 on a system row. **No code depends on the bad query** (grepped); it lived only in the handoff, and
it is now struck out above.

**3. ✅ THE a99e9b3 FIX IS REAL — and I proved it against the ACTUAL outage, not a simulation.** The DB showed
zero `CLASSIFICATION_UNAVAILABLE` rows and all 14 existing `routing_review` tasks were `created_by='workflow'`
(the *old* engine fallback), never `'system'` — so the new path looked like dead code. It isn't. A real submit
through the real creation path, with credits genuinely out:

> `POST /api/public/submit` → **`HTTP 201`** (`2026-0046`) → history **`CREATED` → `CLASSIFICATION_UNAVAILABLE`**
> → **an open `[system] routing_review` task**, titled "Review & route — automatic classification was unavailable."

**An AI outage degrades to human work, exactly as designed.** The earlier absence of markers was simply that
*no request had been submitted since the fix landed* — not a defect. Probe row deleted afterward (no test
residue); **config integrity re-checked: CLEAN.**

**The lesson worth keeping:** the previous session inferred a data catastrophe from a query it never validated
against the column's own history, and wrote the remediation into the handoff as a command. **A NULL is not a
failure until you know when the column started being written.**

**State:** `main`, tree clean, config integrity CLEAN. No code changed — this session corrected the record.

---

## 2026-07-14 (wq) — Credits restored, suite GREEN (309/309) — and the tests were CONTAMINATING LIVE DATA

**AI is back.** The credit balance was in a **different org** than the API key billed to (key → org
`5ab34385…`, sitting at **-$0.06**; the $199.80 Kevin was looking at was subscription-side money an API key
cannot spend). Topped up the correct org. **No key change, no `.env` edit** — the backend was pointed at the
right place all along, the wallet was just empty.

**Verified live, end to end:** `POST /api/public/submit` → **classified** (standard, confidence 100) → matched
`rt-council-minutes` → **routed on `taxonomy` basis** to `team-clerk-archives` → auto-advanced to
`record_search` → spawned `estimate` + `record_search` tasks → deadline 2026-07-24. History reads
`CREATED → CLASSIFIED → STAGE_ADVANCED`, and **no `CLASSIFICATION_UNAVAILABLE` fallback fired** — the degraded
path is correctly dormant now that the AI is healthy.

**THE SUITE IS GREEN: 309/309, 0 failures**, all 12 harnesses chained. `verify_stage_bypass` is **24/24** — the
two assertions the (un) handoff flagged were preconditions waiting on the classifier, exactly as predicted, not
regressions. Config integrity **CLEAN**.

### ⚠️ THE REAL FIND: `tasks.request_id` had NO FOREIGN KEY — and the SUITE was leaking orphans into LIVE DATA

Cleaning up my own test rows surfaced **15 tasks sitting OPEN in real worklists, pointing at requests that no
longer exist.** Two mechanisms, and the second one is the one that matters:

1. Nothing deleted a request's tasks when the request went away — `tasks.request_id` was **completely
   unenforced**.
2. **`workflowEngine.bg()` is fire-and-forget.** A caller can `DELETE` a request while `onIntake` is still in
   flight, and the in-flight insert then manufactures a task for a request that **no longer exists**. **The
   verify suite tripped this on EVERY run** — it creates a request, asserts, deletes the request, and the
   racing `onIntake` leaves one open `routing_review` task behind. **I watched it happen twice, once per run.**
   *The tests were silently contaminating the live database, one orphan at a time.*

**Fixed (27e3436):** FK `fk_tasks_request_id → requests(id) ON DELETE CASCADE`, added idempotently (the schema
re-runs on every boot). CASCADE takes the tasks with the request; the racing insert now **fails loudly** (caught
by `bg`'s handler) instead of silently minting an orphan. **A task for a deleted request is not work anyone can
do.** Proven: the bogus insert is rejected · delete cascades · **suite run TWICE → 0 orphans leaked** (was 1 per
run) · 309/309 still green · integrity CLEAN. The 15 orphans purged (backed up to the job scratchpad first).

### ✅ DECIDED + SHIPPED (ad0e97f) — "If there is a payment history, we should not allow a request to be deleted"

**Kevin's call, made and enforced the same session.** CASCADE is exactly WRONG on the money tables: it would
silently erase the record that money changed hands. Two rules now, deliberately different:

1. **Ordinary children CASCADE.** A clock, task, history row, or file belonging to a request that no longer
   exists is not data — it is litter. It goes when the request goes. **All 16 tables now have an FK.**
2. **A request that TOOK MONEY cannot be deleted at all.** A `BEFORE DELETE` trigger on `requests`
   (`trg_block_delete_of_paid_request`) raises `restrict_violation` and **names the record that blocks it**.
   *If a citizen paid us, that fact outlives the convenience of deleting the row — and the DATABASE, not the
   application, is where that guarantee belongs.*

**Why a trigger and not `ON DELETE RESTRICT`:** `request_payment_events` is a **mixed ledger with a free-text
`type`** (`recordEvent` writes `evt.type || 'event'`), and **nearly every row in it is `estimate_issued`** — an
estimate being *calculated*, which is **not a payment**. RESTRICT there would block deleting any request that
ever got an estimate — broader than the rule. The trigger asks the precise question: **did money actually
MOVE?** It checks `fee_payments`, `fee_adjustments`, **paid** `erp_charges`, and estimates with
`deposit_paid_at` / `final_paid_at`.

**Verified:**
- **Unpaid request** (estimate issued, deposit **due but unpaid**) → **still deletes**, children cascade away.
  **Owing money is not payment history** — this is the over-blocking case, and it is explicitly constructed.
- **Paid deposit** → **REFUSED**, request still present.
- **Counter payment** (`fee_payments`) → **REFUSED**.
- **Suite 309/309, counts before == after** → no residue, no harness trips the guard.
- All 16 tables: **0 dangling, 0 without an FK.** Config integrity CLEAN.

**It was safe to land now precisely because there is ZERO money in the DB today** (`fee_payments`,
`erp_charges`, `fee_adjustments` all empty; no estimate paid) — the rule cannot strand existing data. **This
window closes the moment a real payment lands.** Purged 36 orphaned rows first (clocks 5, payment events 7,
workflow_decisions 24 — all test residue, all `estimate_issued`, no money); backed up to the job scratchpad.

### ⚠️ THE ROOT DISEASE, STILL UNADDRESSED: THE TEST SUITE RUNS AGAINST THE LIVE DATABASE

Everything above is a *symptom*. The 15 orphan tasks, the 36 dangling rows, the config residue that
`check_config_integrity` was built to catch, the 77-day clock a test left in production config — **all of it
comes from one fact: the `verify_*` harnesses create, mutate, and delete real rows in the LIVE database.** The
FKs and the guard now make that *safe*, and the harnesses clean up fully today. But they are one swallowed
`catch` away from doing it again, **and they are not even in the repo** (they live in
`~/.claude/jobs/605a0134/tmp/`, untracked, unreviewed, unversioned).

**The real fix is a test database.** Until then, every hardening is a fence around a problem that should not
exist. Recommend this as a near-term slice.

### 📋 Also noted, not fixed

**The parent/child migration repoints 7 money/clock tables to the parent.** The new FKs point at
`requests(id)`, and the migration keeps the existing row's id (it becomes the child), so the constraints
survive — **but the delete guard will then be asking about the CHILD's payments while the estimate hangs off
the PARENT.** Re-check the guard's four EXISTS clauses against the post-migration shape before running it;
that is the one place this work and the migration can collide.

**Also noticed (not fixed, not my slice):** live `tasks.request_id` is **`NOT NULL`**, but the ARCHITECTURE
invariant says *"Tasks have a NULLABLE request link."* The schema and the invariant disagree. Worth
reconciling before anything relies on standalone tasks.

**State:** `main` @ `27e3436`, tree clean. API healthy (auto-restarted, booted clean on the new schema). Suite
309/309. Config integrity CLEAN. No test residue.

---

## 2026-07-14 (xr) — THE SUITE HAS ITS OWN DATABASE. Building it from empty found TWO RELEASE BLOCKERS.

**`cd backend && npm test`** — the only supported way to run the suite. It rebuilds `optimumq_test` as a
faithful clone of live, boots a **second API on :3101** wired to it, runs all 12 harnesses, then **censuses the
LIVE database before and after and FAILS THE RUN IF A SINGLE ROW MOVED.** That census is the point; everything
else is plumbing. **309/309, live untouched.**

`tests/testEnv.js` **refuses** to run a harness against a non-test database — it does not warn, it exits. *A
test that CAN touch production eventually WILL.* The 12 harnesses now live in **`backend/tests/` (in the repo)**;
the old untracked, unguarded copies in `~/.claude/jobs/` are **deleted**. The second API instance is not
optional: without it the harnesses would drive the **live** API on :3001 while asserting against the test DB.

The full-stack UI assertion in `verify_stages` is **preserved, not skipped** — Playwright now proxies the
page's `/api` calls to the API under test, so the real frontend bundle renders test data.

### 🚨 TWO RELEASE BLOCKERS — both found because this is the FIRST TIME THE SCHEMA WAS EVER BUILT FROM EMPTY

That is precisely what a new city install does. Nothing had ever done it before. Both would have hit the **first
customer**, not us.

1. **`schema.postgres.sql` COULD NOT CREATE A FRESH DATABASE.** It `ALTER`ed `record_types` and
   `fulfilled_records` **before those tables existed** — a harmless no-op against any database that already had
   them (i.e. every environment we own), a **hard failure on an empty one**:
   `ALTER TABLE record_types ... relation "record_types" does not exist`. **A brand-new install died on step
   one.** Statements re-homed after their `CREATE`.
2. **THE SCHEMA HAD DRIFTED FROM LIVE.** An **entire table (`import_review_jobs`) and 20 columns** existed in
   production but **not in the file** — mapping (`latitude`/`longitude`/`geo_address`), import review,
   onboarding review/test tracking. **The code uses all of them.** A fresh install would have come up **missing
   a table and 20 columns** and broken on day one, in features nobody would think to re-test on a "fresh"
   deploy. Schema now matches reality; every addition is `IF NOT EXISTS`, so **live is untouched**.

**The lesson: a schema file that only ever runs against databases that already satisfy it is not a schema file,
it is a no-op.** The test DB is the first thing that ever held it to account.

**Verified:** 309/309 against the test DB · live census clean (not one row moved across 12 tables) · live config
integrity CLEAN · live API healthy. **State:** `main` @ `42fe74b`, tree clean.

**Follow-on worth doing:** the fixture is a *clone of live*, which is pragmatic but means the tests inherit
whatever is in production today. A seeded, deterministic fixture would be better — but note there is **no seed
runner** and the `seed_*` files have drifted, which is its own (smaller) version of blocker #2.

---

## 2026-07-14 (yt) — A DETERMINISTIC fixture replaces the live clone. It caught 3 tests that were faking it.

The test DB was cloned from live at run time (xr). That isolated the tests but left them asserting against
whatever happened to be in production that morning — **no file to review, no diff when config moved, and hidden
dependencies on ambient live state.** The fixture is now a **generated, version-controlled file**.

| file | role |
|---|---|
| **`src/db/seed_fixture.sql`** | the config layer as data — generated, checked in |
| **`src/db/gen_fixture_seed.js`** | regenerates it (`npm run db:fixture`) |
| **`src/db/SEEDS.md`** | what is authoritative, and why the old seeds are not |

**`schema.postgres.sql` + `seed_fixture.sql` = a working system from an EMPTY database.** That is also **the
install path a new city needs, which never existed**: there was no seed runner, and the **30 `seed_*` files had
been applied by hand in an order nobody wrote down, then drifted from live.** They are now marked **LEGACY**,
not deleted (they hold authoring provenance). `record_types_seed.tsv` remains the authoring source for the
taxonomy.

**Regeneration is deterministic** — same config in, **byte-identical file out** — so a diff in
`seed_fixture.sql` always means the config *really changed*. Review it like code.

### 🔍 BUILDING FROM EMPTY EXPOSED 3 TESTS THAT WERE BORROWING LIVE STATE

Each had been **passing for the wrong reason**, and would have gone on doing so forever against a live clone:

1. **`verify_request_create` read the highest EXISTING request number** to demonstrate the numbering-collision
   bug. On an empty DB it crashed on null. It now **creates its own baseline through the real path**.
2. **...and its "ALGORITHM B IS BROKEN" demonstration silently depended on live containing `DEMO-`/`SYS-`/
   `LIBRARY-` rows.** On clean data **the bug could not be demonstrated at all** — the test proved nothing. It
   now **CONSTRUCTS the pathological row** instead of hoping production still has one. *This is the one worth
   remembering: a test that borrows the bug's precondition from production stops being a test the moment
   production is tidied.*
3. **`verify_survey_seed`** asserted `config_history` proved the 18 clarification policies arrived through the
   real config path. That **provenance now travels WITH the config** in the fixture, so the anti-cheat check
   still means something.

**Verified:** **310/310** (309 + the new baseline assertion) against a fixture built **from EMPTY** · suite
**repeatable** across consecutive runs · fixture **byte-stable** across regenerations · **live census clean**
(not one row moved) · live config integrity **CLEAN** · live API healthy.

**No secrets in the fixture.** Password hashes, MFA secrets, and credential-shaped `system_config` values are
redacted (the key survives, the value is blanked, so an installer knows the slot exists). **Verified by scan** —
the only `sk-` hit was `rd-insurance-ri**sk-**…`, a record-type id.

**State:** `main` @ `0daa355`, tree clean.

---

## 2026-07-14 (zu) — The request number had a HARD CEILING at 10,000/year. It was never widened.

Kevin asked whether a prior agent had widened the citizen request number "so the extra digits would be
invisible unless used." **It never did.** What existed was a 4-digit number that **fails at exactly the scale
he was worried about** — and he was right to ask.

### 🚨 THE BUG — intake 500s for the rest of the year at 10,000 requests

The width lived in **two separate literals**: `padStart(4, '0')` and a hardcoded `[0-9]{4}` lookup pattern. At
9,999 requests in a year:

1. the helper mints `2026-10000`, and **the INSERT SUCCEEDS** (`padStart` does not truncate);
2. but the `[0-9]{4}` pattern **cannot see a 5-digit number**, so "the highest so far" still reads **9,999**;
3. so the helper mints `2026-10000` **a second time** → **UNIQUE violation → INTAKE 500s**.

**The city cannot accept another request for the rest of the year.** Constructed and proven in the test DB
*before* the fix; **4 new suite assertions** now hold the boundary so it cannot come back.

### THE FIX — one constant, fixed width

**`SEQ_DIGITS = 6`** (999,999/yr — **Kevin's call**; a large city can exceed 100,000/yr). It drives **both** the
pad and the pattern, so they **can never drift apart again**. The ceiling is now a **loud throw naming the
remedy**, not a silent duplicate-key 500 at the front door.

**FIXED WIDTH IS A CORRECTNESS PROPERTY, NOT A COSMETIC ONE.** `nextRequestNumber` takes the max with
`ORDER BY request_number DESC` — a **LEXICAL** sort. With mixed widths **`2026-9999` sorts ABOVE
`2026-010000`**, which re-introduces the identical collision. Uniform width is what makes that sort correct *by
construction*. So "grow the digits only when needed" was never a safe design, and the **45 existing rows had to
be renumbered**, not left alongside.

`db/renumber_request_numbers.js` — dry-run by default, **refuses on any collision**, touches only well-formed
`YYYY-NNNNNN` citizen numbers (`DEMO-`/`SYS-`/`LIBRARY-` are not citizen numbers and are left alone), verifies
uniformity after. **Safe now because every number is demo data; that window closes the day a real citizen holds
one.**

### ⚠️ DEPLOY ORDER MATTERS — found the hard way

Renumbering while the **old code was still resident** made it mint `2026-0001` **again**: its 4-digit pattern
saw no 4-digit rows left and **restarted the sequence at 1**. **Deploy the code → restart → THEN renumber.**
(Caught on a live probe and cleaned up; no damage.)

**Verified:** suite **314/314** (310 + 4 ceiling assertions), live untouched by tests · 45 live numbers
renumbered, **zero collisions, width uniform** · live intake mints **`2026-000046`**, classified and routed ·
the queue renders uniform-width numbers · config integrity **CLEAN**.

---

## 2026-07-14 (yv) — CORRECTION: the redaction workstation is NOT dark. I was wrong, twice.

**I told Kevin the 678-line `RedactionTaskPage` was unreachable dead code and that wiring it was the highest
value change in the repo. That was false.** A screenshot of the running app disproves it: **My Tasks → task pool
→ the Redaction row → Open → the workstation renders** (page canvas, AI Redaction rail, Manual Redaction,
Finalize & Release, side-by-side, document search), **zero page errors**.

**Where the false claim came from:** a subagent audit grepped for a literal `/redaction/<taskId>` and missed
that `components/ui/TaskPoolSection.js:72` **builds the path by concatenation** (`'/redaction/' + t.id`). I
repeated its confident verdict **without opening the page**. *Second time in one session that an audit's
confident claim did not survive contact with the running system — open the app before believing the grep.*

**So `BUILD_PRIORITY_SUMMARY` item 2 ("a redaction task click should open the workspace") is ALREADY DONE** —
that doc is from 2026-07-08 and predates the work.

**What the workstation actually shows** is the correct gate: *"This request has no responsive records yet. Mark
records responsive in Record Search first."* The loop is **not broken by a missing link** — it is **gated on the
upstream step**, exactly as designed.

**The one genuinely missing Tier 1 piece is the RECORD SEARCH task screen** (that part of the audit holds):
**no page, no route** — a `record_search` task falls through to the generic request workspace, where staff use
the **v1 `RecordsPanel`** (upload, Responsive/Not-Responsive toggle). That is why Kevin has never seen a record
search UI: **there isn't one.** It is a **NEW SCREEN**, so the UI rule applies — **agree the design before
building.** `SPEC_record_search_task_screen.md` drafts one (DRAFT status; Kevin has not seen it).

**Also confirmed NOT built:** portal **R9** (`search_more` / `no_match_search` appear in **zero source files** —
the copy Kevin wants to revise exists only as *proposed* text in `DESIGN_split_canvas_intake.md:171-176`, so
revising it is a doc edit) and **R10** (returned-for-rework surfacing — the reviewer can return work with a
note; the author's task row never says so).

**Standing lesson: `BUILD_PRIORITY_SUMMARY.md` (2026-07-08) is STALE.** Verify each item against the running
app before planning from it.

---

# SESSION CLOSE — 2026-07-14 (evening). START HERE NEXT TIME.

## THE ONE THING WAITING ON KEVIN

**The record-search task screen — the last missing piece of the Tier 1 demo loop — has a clickable mockup
awaiting your mark-up.**

- In repo: **`docs/mockups/record_search_screen.html`** (sibling of `redaction_screen.html` and
  `split_canvas_intake.html`; inherits the redaction token set verbatim, so the task screens read as one system).
- Clickable: **https://claude.ai/code/artifact/62e2e9c2-420b-4f72-92cf-53e2e06ed4e9**

**Two decisions are marked in place on the page (hover the `? #2` / `? #3` chips):**
- **#2 — carried-forward intake results.** Records the requestor *selected* persist today; the ones they were
  **shown and passed on persist NOWHERE**. The screen's top panel needs them. Build that persistence *with* the
  screen, or ship on selected-only and fast-follow?
- **#3 — video scoping.** Does the searcher add a time-range/event note that travels to the AV redaction
  workbench, or stop at "here is the file" and leave all scoping to the redactor?

**Three of the spec's five open items answered themselves since 2026-07-09:** gating (recipe written, spec §1),
build order (**the redaction screen shipped 2026-07-11**), and clarification tolling (**Kevin's 17-state survey
is seeded** — which makes the screen's "Contact requestor" action *the first real caller the clarification
engine has been waiting for*).

**Order of work when it resumes:** fold the mark-up into `SPEC_record_search_task_screen.md` **first** (the spec
is the contract), *then* build `RecordSearchTaskPage.js` + the `record-search/:taskId` route.

## WHAT SHIPPED TODAY (all pushed; `main` == `origin/main` == `4b9e0c9`)

| | |
|---|---|
| **AI restored** | Credits were in a **different org** than the API key bills to — the key was always right, the wallet was empty. Subscription credit **cannot** be spent by an API key. Billing org: `5ab34385-…`. |
| **`tasks.request_id` FK** | 15 orphan tasks sat **OPEN in real worklists** pointing at nothing. FK + `ON DELETE CASCADE`. |
| **Payment-history delete guard** | **A request that took money cannot be deleted** (Kevin's call). A trigger, not `RESTRICT` — the payment ledger is a mixed free-text table where most rows are `estimate_issued`, which is *not* a payment. |
| **The suite has its own DATABASE** | `npm test` → rebuilds `optimumq_test`, boots a test API on :3101, runs 12 harnesses, then **censuses live before/after and fails if one row moved.** The tests had been **silently contaminating live data**, one orphan per run. |
| **Deterministic fixture** | `seed_fixture.sql` (generated, checked in) replaces the run-time clone of live. `schema + fixture` = a working system **from empty**. |
| **Request numbering** | **A hard ceiling at 10,000/year — intake 500s past it.** Now 6 digits (999,999/yr) from **one constant** driving both the pad and the lookup pattern. 45 live numbers renumbered; width uniform. |

**Found only because the fixture builds from EMPTY** (the first thing that ever did): `schema.postgres.sql`
**could not create a fresh database**, and it had **drifted from live by an entire table and 20 columns the code
uses**. Both would have hit **the first new city install**, not us.

## THE SUITE
**`cd backend && npm test`** — the ONLY supported way. **314/314.** Never run a `verify_*.js` bare; `testEnv.js`
refuses. Then `node src/db/check_config_integrity.js` — must report **CLEAN**.

## OPEN DECISIONS FOR KEVIN (nothing is blocked on me)
- **The two mockup questions above (#2, #3).**
- **FKs on the OTHER 15 request-child tables.** `tasks` is done. The rest have no FK. **Should deleting a
  request CASCADE away its payment trail?** That is a policy call, and it wants deciding *with* the
  parent/child migration (which repoints 7 money/clock tables to the parent).
- **Turn on the TX clock rules?** Clarification-restart and deposit-restart are **built, seeded, and disabled**.
  Switching them on **changes reported lateness on live requests**. Deliberate act, not a side effect.
- **`second_notice_required`** slots exist but are **unseeded** — an unresearched notice duty is the same legal
  exposure as an unresearched clock rule.
- **The v2 dashboard** Kevin described (widgets, no request list) + the **health-scoring model** — captured, not
  built, nothing depends on them. **`requests.amount_paid` is a stale denormalized copy** — pick the payment
  tables + estimate paid-stamps as the money source of truth, or the dashboard will disagree with the guard.

## ⚠️ TWO THINGS THAT WILL BITE THE NEXT SESSION
1. **`BUILD_PRIORITY_SUMMARY.md` (2026-07-08) IS STALE.** It says the redaction task screen is unbuilt. **It is
   built and reachable** — I claimed otherwise twice today on the word of a subagent grep that missed a
   concatenated route path, and a screenshot disproved me. **Open the running app before believing an audit.**
2. **DEPLOY ORDER for any numbering change:** ship code → **restart** → *then* renumber. Renumbering while the
   old code is resident makes it **restart the sequence at 1** (its narrow pattern sees no rows).

## STATE
`main` @ **`4b9e0c9`**, tree clean, pushed. API + nginx + the 3 connector stubs healthy. Suite **314/314**.
Config integrity **CLEAN**. 126 requests, **0 dangling rows**, every citizen number a uniform 6 digits.

## THE PARENT/CHILD MIGRATION (parked, deliberately)
Tier 3 in Kevin's own build order. **Not blocked by the UI** — after it, every request has exactly one child and
the queue is a visual no-op. **The real pre-migration task is backend:** `routes/requests.js:43` selects `r.*`
off the **leaf** row, and `deadline_date` / `estimated_fee` / `amount_paid` all become **parent-owned**. Left
alone, the queue would quietly show a deadline and a balance that **stop tracking the parent** — the worst kind
of failure, because it looks fine. The request number already resolves through the parent; the money and the
clock do not.

---

## 2026-07-14 (ab) — Kevin's mark-up folded in. Vague ≠ Overly Broad, and the BWC research says: build the ledger, not the viewer.

**No new screen code.** This session turned Kevin's mark-up into contract, and answered the one question he asked
me to research. Four commits: `e0090fe` (spec) · `d4adf56` (mockup) · `17f3018` (the rename, verified live) ·
`081ede3` (research folded in). Suite **314/314**, live census clean.

### THE BIGGEST THING: "Vague" and "Overly Broad" are NOT one checkbox

Kevin asked for a way to mark a description **Vague or Overly Broad**. The system today has **one boolean**
(`vague`, `routes/requests.js:333`). **His own 17-state survey already documents why that is dangerous:**

> **Illinois.** *Vagueness* → the Act does **not** compel the body to interpret meaning (5 ILCS 140 §3.3).
> *Overbreadth* → the body **shall** offer a conference before invoking the unduly-burdensome exemption, the
> clock **does not stop**, and **"a body that fails to respond on time may not treat the request as unduly
> burdensome AT ALL."**

So marking an overly-broad Chicago request "vague," sending a clarification, and waiting **silently forfeits the
burden defense.** Same class of trap as the Illinois fee-forfeiture guardrail. **The substrate already models the
duty** — `clarification_duty = 'required_before_burden_denial'`, **seeded for IL** — and, exactly like
`clarification_pending` before it, **nothing has ever read it.** This rail is its first caller. Spec §5b-2.

**Two gaps flagged, NOT assumed:** there is no `overbroad_is_denial_ground` sibling to `vague_is_denial_ground`,
and **the overly-burdensome topic is entirely unsurveyed** (the clarification survey names it as shared machinery
it did not cover). Both ship **default-OFF and unseeded**. An unresearched denial ground is the same legal
exposure as an unresearched clock rule.

### Decision #2 — RESOLVED, and it moves the build order

Two accumulating sets, not one: **selected** (visible, right column) and **shown-but-passed-over** (**invisible to
the requestor**, carried with the request so the searcher never re-surfaces a rejected record). Written on **every
results-clear** — each re-search *and* Proceed — because the portal's refine loop lets one description be searched
several times. Selection wins on dedup. New bar: **"Self Service Portal Search Results"** → `Selected (n)` /
`Not Selected (n)`.

> **⚠ SEQUENCING: this data lives in portal R9 (`DESIGN_split_canvas_intake.md` §4b), which is DESIGNED but NOT
> BUILT. R9 is now a PREREQUISITE of the record-search screen, not a parallel track.** Ship the screen first and
> its top panel renders empty for every request. **R9 → screen.**

### Decision #3 — RESOLVED by research. Half of Kevin's model was right; half was backwards.

5 research tracks, ~50 sources (vendor docs, agency SOPs, city class specs, procurement PDFs, cost studies).

**Right:** search and redaction really are often different jobs, and **the split grows with agency size** — a
<50-sworn department fuses them into one clerk; Seattle PD hands redaction to the **Legal Unit** by written
policy. **The IACP model policy is SILENT on who does what.** We cannot hardcode either answer.

**Backwards — the anxiety about having no viewer and no clipper. NOBODY HAS ONE.** Not GovQA, NextRequest,
JustFOIA, FOIAXpress, Laserfiche, GovPilot or Accela. **The video never leaves the evidence system** — redaction
happens *inside* Axon and mints a derivative, and **Axon sells that as the feature.** We will never hold the raw.

**The finding that reframes the product:** **Axon has NO request-intake product.** No clock, no requester
correspondence, no fee ledger, no exemption tracking. And **no open-records platform has ever integrated with a
DEMS** — searched from both sides, found nothing. *The request lives in one system, the video in another, and the
clerk is the integration.* **That gap is us.**

**Decided (spec §4b):** the responsive AV item is an **`ExternalEvidenceReference`, not a file** (nullable file) ·
the searcher outputs a **TIME RANGE, not a clip** — **Kevin's scope box is vindicated**, the research calls it
*"the highest-leverage field on the whole screen"* · **search and redaction are separate tasks that DEFAULT to the
same person** · **"no responsive video" becomes an EVIDENCED disposition** (San Diego's auditor: **up to 40% of
dispatches requiring video HAVE NONE** — a modal outcome, not a failure).

**Two traps, both the forfeiture class:** an **Axon share link expires in 3 DAYS by default — shorter than most
statutory response and appeal windows** (emailing one ships a link dead before the requestor clicks it; host the
derivative ourselves). And **Axon Case IDs are NOT unique** — never key off Case ID alone.

**Honest gaps, recorded not papered over:** Axon's API is not publicly documented (**zero endpoints read**);
**whether it can CREATE A SHARE LINK is the single most important unknown**; and **no citable blanket ban** on us
storing video was found — the constraint looks practical/contractual, **the strong version is UNPROVEN. Do not
repeat it.**

### "Responsive" → "Include in Response" — SHIPPED and verified live

Renamed what a **user reads** (RecordsPanel buttons, counts, the record-search gate, the redaction error,
workflowModel labels). **Deliberately NOT renamed:** `request_files.responsive` (a DB column), workflowModel node
ids (stable keys in seeded rules), and **`MARKED_RESPONSIVE` / `MARKED_NOT_RESPONSIVE` history event codes —
already written into existing `request_history` rows; renaming them would orphan the audit trail on every past
request.**

**One judgment call for Kevin:** the closure notice is still **"No responsive records."** That is the **statutory
name of the notice** — renaming it would misquote the law. Say the word and it changes.

**Verified in the RUNNING app**, not asserted: signed in, opened the Records tab, read the rendered DOM —
"Include in Response" present, zero stray "Responsive" labels, counts read *"482 records · 0 to include."*
(Gotcha for next time: **`auth.signAccessToken` is ASYNC** — forgetting to `await` it mints `[object Promise]` and
you get bounced to /login with no useful error.)

### Mockup — updated, same URL
`docs/mockups/record_search_screen.html` → https://claude.ai/code/artifact/62e2e9c2-420b-4f72-92cf-53e2e06ed4e9
Portal palette (`#D8E0E8` ground / `#F2F6F9` boxes / white fields / `#1E6091` blue), one button color family,
type +1px at every step. **Scope decision: mockup ONLY — the shipped redaction workstation keeps its darker
palette, so the two staff screens DIVERGE until Kevin settles the color.** Also fixed a lie already in the
mockup: the vague checkbox claimed *"clock paused, restarts on reply"* — **that is Texas's rule; the demo is
Illinois = `runs_no_stop`.**

### STATE
`main` @ **`081ede3`**, tree clean, **NOT pushed** (4 commits ahead of `origin/main`). API + nginx + the 3
connector stubs healthy. Suite **314/314**. Frontend rebuilt and serving.

### NEXT
1. **Portal R9** (`DESIGN_split_canvas_intake.md` §4b) — the refine loop + `request_intake_results`. **Prerequisite.**
2. **Then** `RecordSearchTaskPage.js` + the `record-search/:taskId` route.
3. **Kevin's open calls:** the closure-notice wording · the button color · whether the exemption log should live
   in Axon (**a real product fork** — do we *author* the exemption trail or *ingest* it?) · and the unsurveyed
   **overly-burdensome** topic, which the Overly-Broad marker is the reason to go research.

---

## 2026-07-14 (ac) — R9 SHIPPED, and the RECORD-SEARCH SCREEN IS BUILT. Tier 1 loop closes. 403/403.

**Six commits.** `61a9ded` R9 backend · `8be8cb2` R9 portal · `d8be72a` screen slice 1 · `aa5d47d` the two
defects · `86fc244` the rail · `2a5e013` search surface + resolution. Suite **403/403**, live census clean.

### R9 — the refine loop (the prerequisite)
**The accumulation boundary moved: clear on Proceed, not on every search.** Pre-R9 the portal ran
`setSelected([])` on every new result set — **silently throwing away picks the requestor had already made.**
Now a description can be searched several times; the Selected column keeps everything, and two things
accumulate with it: **`queriesTried`** (what the portal already ran — so the searcher doesn't repeat a query the
requestor already rejected) and **`passedOver`** (every record shown and NOT taken — **invisible to the
requestor, forever**, so the searcher never re-surfaces something they declined).

**Intent capture at Proceed.** With records selected, one question: *is this everything?* Because selection
alone could never say what it MEANT — a partial pile was indistinguishable from a complete one, so **a request
the requestor still considered OPEN could be fulfilled from the selection and closed.** With **zero** selected
there is **no popup**: the button itself becomes *"Submit to Open Records team for search"* — an empty selection
is **an instruction to search, not abandonment**.

**SELECTION WINS** across the whole request: a record passed over under description 1 and *selected* under
description 3 is selected **only**. Otherwise the searcher reads *"the requestor declined this"* about a record
they actually asked for — the precise failure the table exists to prevent.

**Verified end to end through the real portal with the real LLM agent** → live request **2026-000046**:
`search_more` · 2 queries recorded in order · 2 selected · 8 passed over · **overlap between the two sets: 0**.

### The record-search screen
`record-search/:taskId`. **My Tasks now routes by task type** — it lists *requests*, so "Open →" had been
dumping every one of them into the generic workspace regardless of the work actually waiting, **including
redaction tasks that already had their own screen**.

- **The bar** (Kevin's mark-up): `Selected Records (2)` / `Records Not Selected (8)` · *"the portal showed them
  10; they took 2."*
- **The intent block**, in amber: *"Requestor asked us to search for MORE — fulfilling from the selection alone
  CLOSES a request the requestor considers OPEN."*
- **The search surface** — **the first staff path to search the source systems at all.** The portal could
  search; the searcher, whose whole job this is, could not.
- **Found / No responsive records**, both through the central stage transition.

### ⚠️ VAGUE ≠ OVERLY BROAD — the first reader of a seeded, never-read duty
The system had **one boolean** (`vague`). Kevin's own 17-state survey says why that is dangerous:

> **Illinois.** *Vagueness* → the Act does **not** compel the body to interpret meaning. *Overbreadth* → the body
> **shall** confer before invoking the unduly-burdensome exemption, **the clock does NOT stop**, and *"a body that
> fails to respond on time **may not treat the request as unduly burdensome AT ALL**."*

So marking an overly-broad Chicago request "vague", sending a clarification and waiting **silently forfeits the
burden defense.** `clarification_duty = 'required_before_burden_denial'` was **seeded for IL and never read by
anything.** The rail is its first reader. It **adapts to the jurisdiction** — Texas (live) shows *no conference
duty*; Illinois shows the conference, the running deadline, and the forfeiture warning.

### THREE LANDMINES DEFUSED (each fails SILENTLY)
1. **Attach shared the blob.** `DELETE /files/:fileId` **unlinks the file from disk** — so removing an attached
   record from one request would have **silently destroyed the released record inside a citizen's already-fulfilled
   request.** The blob is now **copied**. Test C9 proves it.
2. **`found` advanced an EMPTY search.** `workflowModel` has *declared* the gate all along
   ("enough-to-advance: at least one record marked Include in Response") and **nothing enforced it.**
3. **`no_records` closed on NOTHING.** That closure is a legal act. Per the BWC research **up to 40% of
   dispatches that should have body-cam video HAVE NONE** — it is a **modal outcome**, which is exactly why it
   must be **evidenced**. A closure with an empty effort trail is indistinguishable from never having looked.

### THE TESTS BITE — proven, not assumed
All three new harnesses went green on the **first run**, which this project has taught us to distrust. Each was
**deliberately broken** and the suite went red on exactly the guarding assertions: disable selection-wins → 3
fail · collapse `overly_broad` into `vague` → 8 fail · share the blob instead of copying → 6 fail (**including
"THE SOURCE RECORD SURVIVED"**). All restored.

### ⚠️ TWO GOTCHAS
1. **`auth.signAccessToken` is ASYNC.** Forget the `await` and you store `[object Promise]`, the API 401s, and
   you land on `/login` with no useful error. Cost three failed runs.
2. **`npm test --keep` leaves a test API on :3101 that POISONS the next run** — 9 phantom failures against a
   stale DB. Kill it before re-running.

### STATE
`main` @ **`2a5e013`** + docs. Suite **403/403**. App healthy. **Still open on the screen:** §4b audio/video
(needs the `ExternalEvidenceReference` table from the BWC research), §4c paper/scanner, §4d other — the format
toggle is unbuilt and the screen is **digital-only** today.

### PARKED, DELIBERATELY (Kevin)
- **`DESIGN_delegated_av_fulfillment.md`** — the offload toggle. **Position A (full offload) is DEAD:** no DEMS
  emits a completion signal and none exposes its exemption metadata to an external system. Reality forces
  Position B.
- **`DESIGN_av_vaughn_index.md`** — **we have the defect we accused GovQA of.** Document zones cite a statute
  (`redaction_zones.rule_id` → `redaction_rules` → `legal_sources`); **AV zones cite nothing.** WAC 44-14-04004
  requires the basis for each redaction with **no video carve-out**. Specified, not built — *"until I work
  through this build enough to see requests process correctly."*
- **`BRIEF_av_detection_sidecar.md`** — the GPU project, for Kevin's home box. Deliberately scoped as the
  **commodity** half; the Vaughn layer is the moat and needs no GPU.

---

## 2026-07-14 (ad) — THE R9 GATE. Attaching is not searching. Tier 1 #5 closes. 440/440.

**One commit,** `ef69f53`. Suite **440/440** (new harness `verify_search_intent_gate`, 37), live census clean,
verified end-to-end in the running app against a real live request.

### THE HOLE — and it was open in production this morning

R9 recorded what the requestor MEANT per description; the screen showed it in amber. **Nothing enforced it.**
And the only gate `found` had — *"at least one record marked Include in Response"* — **was already satisfied by
the requestor's OWN PORTAL PICKS**, which sit on the request before the searcher does anything at all.

So a request whose requestor explicitly said *"these match, but ALSO search for more"* could be advanced to
redaction, fulfilled, and **closed as COMPLETE — while the requestor still considered it OPEN.** The intent
column said so the whole time. Nothing read it. **Attaching is not searching.**

**Proven on live `2026-000046`** (not asserted): 1 record already Included — the requestor's own pick — so the
OLD gate was *already green*. `POST /tasks/:id/resolve {found}` → **422 `UNRESOLVED_SEARCH_INTENT`**, naming the
description; **stage unchanged.** Before today that call would have advanced it.

### THE UN-GATE IS A SENTENCE: "I searched; there is nothing more."

- **The duty is intent-derived.** `search_more` · `no_match_search` (an instruction to search, NOT abandonment) ·
  `not_searchable` (the portal never searched it) **carry a duty**. **`complete` does not** — the requestor
  already said the selection is everything.
- Per open description the searcher records **`records_added`** (the attached records answer this) or
  **`nothing_further`** — which **REQUIRES A NOTE**, because that is the assertion that closes a description the
  requestor considers open, and unevidenced it is indistinguishable from never having looked.
- 4 additive columns on `request_search_intents` (`searcher_outcome` / `resolution_note` / `resolved_by` /
  `resolved_at`). NULL = unresolved. Live DB migrated.

### ⚠️ THE TWO GATES MUST NOT FEED EACH OTHER

`SEARCH_INTENT_RESOLVED` is **deliberately NOT** in the no-records effort-trail action list. A claim that nothing
exists is **not evidence of a search** — if it counted as effort it would **evidence ITSELF**, and a searcher
could answer *"nothing more"* and use that very answer to clear the **no-records** gate too, **closing a request
having run no search at all.** Test **E** exists solely to hold this line. (Breaking it → 3 red.)

A **no-records closure ANSWERS every open description** (the blanket form of the same sentence), so the ledger is
never left half-written. A request with **no intake provenance is unaffected** — a gate that blocks work it has
nothing to say about is just an outage (test G).

### THE TESTS BITE — five deliberate breaks, each went red on exactly its guard

gate removed → **6 fail** · note not required → **3** · **the claim evidences itself → 3** · no-records leaves the
ledger half-written → **2** · `complete` treated as a duty → **5**. All restored; 440/440.

### VERIFIED IN THE RUNNING APP (screenshots + DOM, not a chat assertion)

The screen renders **"Found — 1 to include →" GREYED OUT** — *with a record to include* — above an amber block:
*"One description is still open… fulfilling from their own selection alone would close a request they consider
OPEN."* Clicking **"I searched — nothing more"** with an empty note is refused **in the UI** with the evidence
sentence; with the note it lands, the amber clears, and **Found goes live**. Ledger row + `SEARCH_INTENT_RESOLVED`
history row both written. `2026-000046` **left in `record_search` deliberately** — the gate was the point.

### ⚠️ GOTCHA THAT COST ME THE WORK ONCE

**`git checkout -- src/` to undo a break-test wipes every UNCOMMITTED source change with it.** I lost the whole
feature mid-session and rewrote it. **Commit the green state BEFORE break-testing**, then restore per-file.
(Also: `run_suite` parses `N/N pass, N fail` — any other summary format reads as "harness did not complete".)

### STATE
`main` @ **`ef69f53`** + this note. Suite **440/440**. API restarted, healthy. Frontend rebuilt and serving.
**Still open on the screen:** §4b audio/video (needs `ExternalEvidenceReference`), §4c paper/scanner, §4d other —
the format toggle is unbuilt and the screen is **digital-only**.

### NEXT
1. **Kevin's open calls are unchanged** (closure-notice wording · button color · exemption log in Axon · the
   unsurveyed **overly-burdensome** topic).
2. The natural next slice is the **format toggle / §4b AV path** — but Kevin **parked** it deliberately *"until I
   work through this build enough to see requests process correctly."* **It needs un-parking explicitly.**
3. Tier 1 item 3 — **populate estimate profiles** for the top ~10 record types. Data task, no code, high leverage.

---

## 2026-07-14 (ae) — Tier 1 #3 seeded — and the task EXPOSED A ~15x UNLAWFUL OVERCHARGE. 475/475.

**Three commits.** `f8a297e` the labor bar · `ed44060` the ten seeds · (+ test hardening). Suite **475/475**,
live census clean. Two new harnesses: `verify_fee_labor_gate` (20) · `verify_estimate_profiles` (15).

### THE BUG THE DATA TASK FOUND — this is the headline, not the seeds

Populating the profiles is what flips a record type from **manual** to **AUTOMATED**. Dry-running the ten
candidate seeds through the real engine before writing anything showed a typical **8-page incident report
pricing at $12.05 — $11.25 of it LABOR.**

> **Tex. Gov't Code § 552.261(a):** *"If a request is for 50 or fewer pages of paper records, the charge …
> **may not include costs of materials, labor, or overhead**, but shall be limited to the charge for each page
> of the paper record that is photocopied."*

**That report may lawfully cost $0.80.** We were charging ~15× over, on the most common request a city
receives — and had been since the fee engine shipped.

**THE ENGINE ALWAYS HAD THE GATE.** `feeEngine.laborGate`'s own comment names Texas. **No seeded fee profile
ever set `billableWhen`. Zero.** A *reader with no config* — the exact mirror of the "seeded but never read"
bugs this project keeps finding (`clarification_duty`, `clarification_pending`), and just as silent.

**Seeding was STOPPED until it was fixed.** Automating the profiles would have turned an overcharge a clerk
might catch into a systematic one — emitted at scale under a *"Review auto-generated estimate"* label that
implies somebody validated it. **The config is now the thing under test:** a reseed from an old script, or a
config copied for a new city, goes RED instead of shipping the overcharge.

### ⚠️ THREE THINGS KEVIN OWNS (all flagged, none guessed)

1. **`paperOnly` — UNVERIFIED and LOAD-BEARING (Kevin's call).** § 552.261(a) says *"pages of **paper**
   records … photocopied"*, so the bar is scoped to `mail`/`pickup`/`paper`. **The demo default delivery is
   `email`, so the bar does NOT fire on most requests** — that same report still prices **$12.05** by email.
   Test **D** pins this exactly so it stays visible. **Needs counsel. One-value flip** (`paperOnly:false`).
2. **The statute's two exceptions are UNCONFIGURED** — records in 2+ unconnected buildings, or remote storage,
   restore the labor charge. **Under-charging is recoverable; unlawful over-charging is not.**
3. **`labor.overheadPct` is UNSEEDED.** The spec mentions a TX **+20%** surcharge; that figure is **NOT in the
   verified-TX research.** **An unresearched charge is the same exposure as an unresearched clock rule.**

### THE TEN SEEDS (Tier 1 #3 — DONE)

Seeded through the **real** `PUT /api/estimate-profiles/:id` path (never a direct insert). Police block first
— incident · crash · arrest/booking · citations · CAD · 911 audio · body-worn video — then **building permits
(Kevin's own §7d worked example)** · council minutes · official email. **All ten assess AUTOMATED.** They now
travel in `seed_fixture.sql`, so a system built from **schema + fixture comes up with estimate automation ON**.

**Verified end-to-end on LIVE `2026-000048`:** a real public submission for a building permit spawned an
estimate task titled **"Review auto-generated estimate."** *(The first attempt — an incident report — correctly
did NOT auto-route: **`wfr-sensitive` outranks `wfr-confident`** and holds investigative material at intake for
a human. Not a bug; the rule working.)*

> **⚠ THE SEEDS ARE PROVISIONAL.** `seedProfile` stamps `source='human-expert'`. **THE EXPERT WAS NOT A RECORDS
> CLERK.** They are plausible defaults; **every profile's `notes` says so verbatim**, and `verify_estimate_profiles`
> **test D holds that admission in place** — re-seed them as clerk-confirmed without a clerk and it goes red.
> **A city's clerk should confirm them: ten numbers, reviewed once.** `recordActuals` corrects them over time
> regardless, and a profile stays a **DEFAULT** — overridable per request, reconciled at delivery.

### THE TESTS BITE — six deliberate breaks

**Labor bar:** drop `billableWhen` (**the original bug**) → **10 red** · engine ignores `paperOnly` → **2** ·
off-by-one at exactly 50 pages → **2**.
**Seeds:** seeds vanish → **9** · provenance re-labelled "clerk-confirmed" → **1** · $200 bound disabled → **2**.

### NOTED, NOT FIXED (out of slice)
- **`assess()` hardcodes `delivery:{method:'email'}`** when pricing (`estimateProfile.js:139`). With `paperOnly`
  that means its preview total is always the **worst case** (labor charged), so the $200 bound stays
  conservative. The real per-request estimate uses the request's actual delivery. Fine, but know it.
- **The `record_search` task spawns with a NULL title** (visible on 2026-000048). Cosmetic, pre-existing.

### STATE
`main` @ `ed44060` + hardening + this note. Suite **475/475**. API + nginx healthy. Live: **2 new requests**
(`2026-000047` intake, `2026-000048` record_search) from the end-to-end verification.

### NEXT
1. **Kevin's three fee calls above** — `paperOnly` is the one that matters; it decides whether most requests
   are lawfully priced.
2. Tier 1 is now **CLOSED** (screen · redaction wiring · profiles · fee-waiver routing · found/not-found gate).
   **Tier 2 opens:** fee-choice intake · notification model · My Tasks restructure · role-catalog reconciliation.
3. Still parked (Kevin): the **§4b AV path** / format toggle — needs explicit un-parking.

---

## 2026-07-14 (af) — Primary-source research folded in: overhead SEEDED, exceptions documented, one finding that MOVED a decision. 484/484.

**One commit,** `0f089f2` (research fold-in). Suite **484/484**, live census clean. `verify_fee_labor_gate` 20→29.

### The research
A deep-research pass (adversarial **3-verifier-per-claim**, ~90 agents, every surviving claim **3-0** against
1 TAC § 70.3 / Tex. Gov't Code Ch. 552 / AG Public Information Handbook). **Honest cost note:** this was the
wrong-sized tool — three narrow known-source legal values didn't need a 90-agent fan-out; targeted WebFetch of
the statute + 1 TAC § 70.3 + the AG Handbook would have done it. Recorded in memory. It was ~95% done when the
cost surfaced, so I let it finish rather than waste it.

### Overhead — was held back as "unresearched"; NOW VERIFIED + SEEDED (`labor.overheadPct: 20`)
- **§ 70.3(e)(3): 20% of the LABOR charge, never the total.** Engine already computed it on the labor subtotal,
  so seeding the value was the whole change.
- **§ 70.3(e)(2): no labor → no overhead.** Overhead rides on the **gated** labor subtotal, so the 50-page bar
  zeroes labor and overhead **together** — a 20% surcharge on a copies-only bill **cannot happen by
  construction**. Tests **H1–H5** lock it; breaking the coupling → 6 red.
- **Opt-in** (§ 70.3(e)(1)): a city waives with `overheadPct: 0`.
- **Effect:** BWC **$67.50 → $81.00**, 911 audio **$18.75 → $22.50**; every copies-only request unchanged.

### Rates CONFIRMED current (1 TAC § 70.3, last amended 2007, no later change)
$0.10/page · $15/hr labor · **$28.50/hr PROGRAMMING ONLY** (not general IT time). Statute sets no figures;
a city may charge less, never over 125% of AG amount or actual cost (§ 552.262). Engine's hardcoded values
all check out.

### The two exceptions — researched, still UNBUILT (each is a per-request assertion, not a config value)
1. **"separate buildings"** — § 552.261(c) gives only a NEGATIVE test (a sidewalk/passageway does NOT make
   buildings separate); **burden on the agency**, AG demands *a building map*, **treble damages** for bad-faith
   overcharge (§ 552.269).
2. **"remote storage"** — § 70.3(g): recover only the storage company's fee, **no** added labor for their
   retrieval; own-staff search after delivery gets $15/hr.

### ⚠️ THE ONE THING THE RESEARCH *MOVED*, NOT CONFIRMED — `paperOnly` (KEVIN, PLEASE READ)
When we flipped `paperOnly: false` earlier today, the story was *"the literal reading is paper-only and we
chose the protective principle."* **The research changed that story.** The AG's *actual* position is that the
50-page bar **is paper-only**: its copies flow-chart sends electronic records straight to *labor + overhead +
media* with **no page gate**, and its worked examples **charge $15/hr + 20% overhead on emailed requests.** So
`paperOnly: false` is **more protective than Texas practice** — for an electronic request the AG allows labor
and we decline it under 50 pages.

The research **supports** the protective reading in exactly one spot: the **genuinely unsettled** case of a
**small emailed PDF with no media cost** (every AG electronic example ships on a CD; no source blesses charging
labor with no media), where the instruction is *don't resolve doubt for city revenue.* **Net: the flip stands
as a documented policy choice, defensible for no-media email, but a real divergence from AG practice for
electronic-with-media. It is now a LIVE decision for you + counsel, not a settled reading.** No code changed on
this — it is flagged in SPEC §8b and §9, not hidden. The `paperOnly` mechanism stays in the engine for the
literal scope.

### STATE
`main` @ `0f089f2` + this note. Suite **484/484**. API + nginx healthy. Config reseeded, fixture regenerated.

### NEXT
1. **Kevin's `paperOnly` call** — the one decision the research reframed (above).
2. The two exceptions are researched but need a **per-request assertion UI** (with a recorded basis / building
   map) to build — deferred until there's a reason.
3. Tier 1 CLOSED. **Tier 2 open:** fee-choice intake · notification model · My Tasks restructure · role catalog.

---

## 2026-07-15 — Kevin's `paperOnly` call: FLIPPED to paper-only (`paperOnly: true`), matching AG practice. 484/484.

**The one fee decision that was waiting on Kevin.** He chose **B**: the 50-page labor bar is now scoped to
**paper deliveries** (`mail`/`pickup`); an **electronic** delivery (`email`, the portal default) falls outside
it and labor is chargeable — exactly what the AG copies flow-chart and worked examples do. This **reverses** the
same-week protective `paperOnly:false`, which the 2026-07-14 primary-source research had shown *over-protects
the requester* relative to Texas practice (§8b).

### What changed (one commit)
- **Config:** `feeProfile.seed.js` `paperOnly: false → true` (+ rationale/`_verified` rewritten), reseeded into
  **live** through its real creation path (`node scripts/feeProfile.seed.js`), fixture regenerated (`npm run
  db:fixture`) — `seed_fixture.sql` now carries `paperOnly:true`, zero `false` left.
- **Engine comment** (`feeEngine.js`) updated to describe the paper-only scope; **no logic change** — the
  `laborGate` scope check and the no-pages guard were already correct.
- **SPEC** §8b (paper-only determination), the G-section guard note, and §9 (now RESOLVED) rewritten.
- **Test** `verify_fee_labor_gate.js`: section D rewritten (D1 paperOnly true; **email now charges labor**;
  paper vs email **diverge** — mail/pickup $0.80, email $14.30) and section **G moved to `mail`** so the
  no-pages guard is exercised where it's actually load-bearing (a body-cam clip on a DVD, mailed). 29/29.

### Evidence
- Suite **484/484**, `verify_fee_labor_gate` 29/29, `verify_estimate_profiles` 15/15, **live census clean —
  not one row moved.**
- **Live, read-only:** 8-page incident report by **EMAIL → labor $11.25, total $14.30**; by **MAIL → labor
  $0.00, total $0.80** (paper protection intact). `assess('rt-incident-reports')` → **automated $14.30**.
- Safety check before flipping: all ten seeds still price **under the $200 bound by email** (highest is
  official-email at **$159**, unchanged — it's >50 pages so it always charged labor), so B1 (all ten automated)
  stays green. The seven page-based ≤50pg types price higher by email now (e.g. incident $0.80→$14.30).

### STATE
`main` + this note. Suite **484/484**. API + nginx healthy. Live fee config reseeded, fixture regenerated.
**Kevin's three fee calls are now all resolved** (paperOnly flipped; overhead seeded 2026-07-14; the two
statutory exceptions researched, still unbuilt pending a per-request assertion UI).

### NEXT
1. Optional: counsel may still weigh the **one unsettled edge** — a small emailed PDF with **no media cost**
   (no AG source blesses labor there). Current setting charges labor on it; a city wanting the protective
   reading on that edge alone sets `paperOnly:false`. Documented in SPEC §8b/§9, not hidden.
2. The two § 552.261(a) exceptions (separate buildings / remote storage) — researched, need a per-request
   assertion UI with a recorded basis (AG demands a building map for #1). Deferred until there's a reason.
3. Tier 1 CLOSED. **Tier 2 open:** fee-choice intake · notification model · My Tasks restructure · role catalog.

---

## 2026-07-15 (pm) — Tier 2 #9: financial-authority role reconciliation. FINANCE unified, a live auth bug fixed. 499/499.

**Scoped then built (Kevin: "build this now").** Tier 2 item 9 (`SPEC_tasks_roles_mrr_fees.md` §8, MASTER doc).
The chosen model (Kevin): **FINANCE as a single permission/capability** — Option A.

### The bug this closed (was LIVE)
The financial-authority concept was split across BOTH role catalogs under two names. Routing + `/fee-waiver-decision`
used permission-role **`FEE_AUTHORITY`**; fee-objection approval (`objections.js`) + the reason library
(`decisionReasons.js`) gated on function-role **`FEE_WAIVER_APPROVER`** — which **no seeded user held** (one in
live, Tom Jones). So the 15 `FEE_AUTHORITY` holders who receive the fee-waiver task **could not approve a fee
objection or see the approval queue** unless they also held DIRECTOR/SYSTEM_ADMIN. `requests.js:254` had already
fixed its half and left a comment naming this exact reconciliation; `objections.js`/`decisionReasons.js` were the
unfinished half.

### The fix (one canonical role)
- **`FEE_AUTHORITY` → `FINANCE`** (permission role `pr-feeauth`→`pr-finance`), gating BOTH routing and every
  financial gate. Orphan function-role **`FEE_WAIVER_APPROVER` retired**.
- New `requireRoleOrPerm(roles, perms)` middleware (auth by function role OR capability; SYSTEM_ADMIN auto).
  `objections.js` ×2 + `decisionReasons.js` now gate on `FINANCE`; `requests.js` perm string → `FINANCE`.
- Routing: `taskRouting.js` `TASK_ROLES.fee_waiver`/`ROLE_TO_TYPE` → `FINANCE`; `workflowEngine.js` comment.
- Catalog/seeds: `schema.sql` (drop orphan, rename perm), `seed_test_staff.sql`, `seed_testers.sql`.
- **Live migration** `scripts/migrate_finance_role.js` (idempotent, committed): renamed the perm + repointed
  15 assignments, carried `tasks.role_required`, dropped the orphan function role + Tom Jones's assignment
  (he keeps authority via FINANCE). Ran on live; fixture regenerated.
- **Frontend** (kept coherent, not a redesign): `authStore` gains `hasAnyPerm` (`/auth/me` already returned
  `permissionRoles`); `ObjectionPanel`/`MyTasksPage` gate the approve button on the `FINANCE` capability;
  `StaffManagementPage` drops the retired function role from its picker. Rebuilt + deployed (nginx serves `build/`).

### Evidence
- Suite **499/499** (new `verify_role_reconciliation` **15/15**), live census clean.
- **Live API (restarted) verified end-to-end:** Robert Cho (`u-finance-super`, holds FINANCE but only
  DEPT_MANAGER) → **200** on `/objections/pending-approval` (**was 403** before) and **404** on approve-with-fake-id
  (gate passed); Marcus Bell (no FINANCE) → **403**. The 15 FINANCE holders can now do the financial work they're
  assigned.
- **Note:** live DATA was migrated before the API restart, briefly leaving old code reading the old role names;
  resolved by restarting the API (killed `backend/server.js` pid → root PM2 God Daemon respawned it in ~1s with
  new code). Sequence code+data together next time.

### Out of scope (named follow-on slices, in MASTER Decision 2/4)
Collapsing the two catalog TABLES into one; the `eligibleUsers` v3 task-type cutover; the parallel **redaction**
cross-catalog split (`REDACTION_REVIEWER/APPROVER` vs `REDACTION_WORKER/AUTHORITY`) — real, no known bug;
`user_types`; `commercial_rate` wiring (deferred).

### STATE
`main` + this note. Suite **499/499**. Live API restarted (new pid, healthy), frontend rebuilt + deployed,
connectors untouched. Config/fixture in sync with live.

### NEXT (Tier 2 remaining)
- #6 Fee-choice intake (default-forward) · #7 Notification model + nullable task-request link · #8 My Tasks
  restructure (+ BACKLOG R10 returned-for-rework surfacing) · #10 Legal Review / Legal Redaction task wiring.
- Role-model follow-ons above when v3 user-types get built.

---

## 2026-07-15 (pm) — Tier 2 #7: Notification model + nullable task/file link. SYS-IMPORT pseudo-request ELIMINATED. 517/517.

**Scoped then built (Kevin: "build this now"), with two decisions Kevin owned:** (1) the import "no template yet"
prompt becomes a **Notification** (not a task); (2) **full elimination** of the `sysimport` row — not just
decoupling — which grew the slice to also make `request_files` nullable and re-anchor import files by repository.

### The wart (was live)
Ingestion hung files + a `build_redaction_template` task on a standing fake request `sysimport-<repo>`
("File Import", stage delivery) because `tasks.request_id` AND `request_files.request_id` were `NOT NULL`. A
task click landed on a fake request's pipeline; the row also leaked into the staff request **queue** (only
report *metrics* excluded `SYS-%`). Root cause: passive heads-ups modeled as tasks-on-a-request.

### The build
- **Schema:** `tasks.request_id` and `request_files.request_id` → **nullable**; `request_files.repository_id`
  added + indexed; new **`notifications`** table (per-user, title/body/link, read/dismiss, optional context for
  dedupe). Canonical schema is `schema.postgres.sql` (SQLite `schema.sql` is legacy/unused — it doesn't even
  define `tasks`).
- **Model:** `services/notifications.js` (emit/list/unreadCount/markRead/dismiss, dedupe per user+kind+context)
  + `routes/notifications.js` (ownership-scoped) + mounted at `/api/notifications`.
- **Import rework:** `importIngest.js` stops creating the pseudo-request; files insert with `repository_id` +
  NULL request_id; no template → **Notification** to the source reviewer (or admins) linking to `/mass-redaction`.
  `massJobs.js` review_auto_redaction task keeps being a task but with **NULL** request_id. `taskRouting.createTask`
  made null-safe. `requests.js` queue now filters `SYS-%` (consistent with report metrics).
- **Frontend:** a header **bell** (`NotificationBell.js`) — unread badge, dropdown list, mark-read/dismiss,
  `hasAnyPerm`-free; `authStore` already had permissionRoles. Minimal surface; full My-Tasks area is #8.
- **Live migration** `scripts/migrate_notifications_deanchor.js` (idempotent, committed): backfilled
  `repository_id` on 13 import files, converted the standing build-template task → a notification to its
  reviewer, nulled request_id on files/tasks/doc_pages/fulfilled_records, **deleted the `sysimport-*` rows**.

### Scope corrections made mid-build (flagged honestly)
- The `reportEngine`/`requestCreate`/`renumber` SYS-exclusions cover **LIBRARY + other SYS- rows too** — NOT
  removed (my scope was wrong); instead aligned the request-queue exclusion.
- `review_auto_redaction` is real QA work with a screen → stayed a **task** (null request_id), not a notification;
  only `build_redaction_template` became a notification. This is what exercises the nullable task link.

### Evidence
- Suite **517/517** (new `verify_notifications` **18/18**), schema builds from EMPTY, live census clean.
- **Live (API restarted, then migrated):** 0 sysimport requests; the standing task converted to a notification
  for its reviewer (Kevin Hargrove → `/mass-redaction`); live `GET /api/notifications` as that user returns it
  (unread=1); another user does not see it (ownership-scoped). Frontend rebuilt + deployed (bell in bundle).
- An id-based map (subagent) confirmed the redaction→library pipeline is entirely file-id/job-based, never
  request-based, so nulling import files' request_id is safe; all import-reachable readers are LEFT JOIN/id-scoped.
- Fixture regen produced one unrelated line (a TX fees config-section version/hash bump from an earlier
  config-freshness recompute) — kept, since the fixture must match live.

### Follow-on / notes
- `build_redaction_template` task type is now unused (retired in favor of the notification); harmless if left.
- **#8 (My Tasks restructure)** folds the notifications area + null-request tasks into per-role boxes.
- Sequenced correctly this time: restarted the API (new code + schema) BEFORE migrating live data.

### STATE
`main` + this note. Suite **517/517**. Live API restarted (new pid, healthy), migration applied, frontend
rebuilt + deployed, connectors untouched.

### NEXT (Tier 2 remaining)
- #6 Fee-choice intake (default-forward) · #8 My Tasks restructure (+ BACKLOG R10 returned-for-rework;
  folds in notifications + null-request tasks) · #10 Legal Review / Legal Redaction task wiring.

---

## 2026-07-15 (pm) — Tier 2 #8a: My Tasks restructure (task-centric). Design-signed-off + verified live. 518/518.

**Scoped → mockup → sign-off → built.** Per the UI rule, produced a visual mockup artifact for Kevin's design
sign-off BEFORE writing screen code; Kevin approved, then I built it. Three decisions Kevin owned: per-**task-type**
boxes (not per-role), R10 returned-for-rework as a **separate fast-follow (8b)**, and a **dedicated notifications
area** on the page (not just the header bell).

### The gap
The old MyTasksPage was **request-centric**: it listed `/requests` where `assigned_to = you` as a flat table,
used request *stage*, bolted on objection sections + a pool, and **silently dropped null-request tasks**
(filtered on `request_id`) — so #7's `review_auto_redaction` tasks would never show.

### What shipped (8a)
- **Rewrote `MyTasksPage.js`** task-centric: sourced from `/tasks/mine` + `/tasks/pool` (+ `/notifications`,
  objections). One box **per task type** the user holds work in (no empty boxes), **Queued** (assigned) then
  **In Process** (in_progress); count + state chips (queued / in process / overdue). Claim pool section
  (green-dot rows + Claim). A **notifications area** (same `/api/notifications` as the bell) with dismiss.
  Deadline-derived summary tiles (Assigned / Overdue / Due ≤3d). Task→screen routing kept; null-request tasks
  route to a sensible home. Fee-objection sections retained (objections aren't tasks).
- **Backend:** enriched `tasks.js` `withReq` to also return `requestor_name, deadline_date, stage,
  record_type_name` (via a `record_types` LEFT JOIN) — benefits `/mine` and `/pool`. No schema change.
- **Deferred, as agreed:** health scores → #13 (tiles stand in); returned-for-rework → 8b.

### Evidence
- Suite **518/518**. One test correctly updated: `verify_stages`' "no private stage vocabulary" guard listed
  MyTasksPage — but the task-centric page shows task STATE not request stage, so it no longer imports
  `lib/stages`; dropped it from the guard's list + added an assertion that it keeps no private copy.
- **Verified live (screenshots):** logged in as Kevin Hargrove (3 assigned tasks + the import notification),
  the page renders the Record Search box (2, 2 overdue), Redaction box (1, 1 overdue) with Queued rows, the
  claim pool, and the Notifications area showing the real "Import source needs a redaction template" note.
  Matches the signed-off mockup. (`shot.js` in scratch; see memory ui-visual-inspection.)
- Mockup artifact (design sign-off): the approved layout.

### STATE
`main` + this note. Suite **518/518**. Live API restarted (loads enriched `withReq`), frontend rebuilt +
deployed, connectors untouched.

### NEXT (Tier 2 remaining)
- **#8b — R10 returned-for-rework** (the natural next slice): task `returned` state + wire
  `POST /redaction-jobs/jobs/:id/return` to set it + emit a push notification (now that #7 exists) + the
  "URGENT CORRECTIONS REQUIRED" row treatment, built as the general pattern (redaction/objection/clarification).
- #6 Fee-choice intake (default-forward) · #10 Legal Review / Legal Redaction task wiring.
- #13 (Tier 3) Workload health scoring — folds the R/Y/G scores into the boxes/tiles built here.

---

## 2026-07-15 (pm) — Tier 2 #8b: returned-for-rework ("your work came back"). R10 RESOLVED. 531/531.

**Scoped (decisions locked) → built.** Design was pre-approved in the 8a mockup (the red "URGENT CORRECTIONS
REQUIRED" row was drawn there as an 8b preview), so no new mockup. Kevin's call: build the general mechanism +
wire **redaction** AND **fee-objection rejection**; clarification deferred.

### The gap (R10)
A reviewer returns a redaction, but the AUTHOR is never told — their `redaction` task (never closed at submit)
sits in My Tasks looking unchanged, reviewer's reason buried in history. Most time-critical item a redactor
holds; was the least visible.

### The build
- **General primitive:** `tasks.return_reason/returned_by/returned_at` (nullable flag). `taskRouting.markTaskReturned(id,{by,reason,link})` sets the flag (task KEEPS its status → stays in My Tasks) **and** emits a `work_returned` notification to the owner; `clearReturned(id)` on re-submit. Flag, not status — because `/tasks/mine` filters `status IN ('assigned','in_progress')`, so a `returned` status would HIDE it (exactly wrong).
- **Redaction wired:** `/redaction-jobs/jobs/:id/return` → finds the author's active redaction task → `markTaskReturned`; `/submit` → `clearReturned`. Author-side "Returned by X — <reason>" banner on the redaction screen (`RedactionTaskPage`).
- **Fee-objection rejection (2nd customer):** `objections.js` reject → `work_returned` notification to `assignee_id` (objections aren't tasks → push only).
- **My Tasks (8a):** returned tasks render the red urgent row (sorted to top of their box) + a "Needs corrections" summary tile + a "N returned" box chip. `/tasks/mine` already returns `t.*`, so no query change.

### Evidence
- Suite **531/531** (new `verify_returned_rework` **13/13** — general primitive, redaction return flow end-to-end, objection-reject push). Live census clean.
- **Verified live (screenshot):** marked Kevin's real redaction task returned via the service → My Tasks showed the "Needs corrections" tile, the "1 returned" chip, and the red "⚠ URGENT CORRECTIONS REQUIRED" row with the reviewer note + red "Fix →"; the bell incremented (pushed notification). **Then restored** live (cleared the flag + deleted the verification notification) — the task wasn't really returned.

### Gotcha found + handled
`tasks.request_id` has a **nullable FK to requests** (`fk_tasks_request_id`) — the earlier "no FK" note (Explore
agent, notifications slice) was stale. The notifications migration happened to null tasks before deleting requests,
so it worked; here the test harness had to create real request rows for its fixtures. Worth remembering for any
future task/request data work.

### STATE
`main` + this note. Suite **531/531**. Live API restarted (return columns applied, 8b code loaded), frontend
rebuilt + deployed, connectors untouched, live restored after the visual check.

### NEXT (Tier 2 remaining)
- #6 Fee-choice intake (default-forward) · #10 Legal Review / Legal Redaction task wiring.
- Future returned-for-rework customer: **clarification rework** (needs a task-return flow first).
- #13 (Tier 3) Workload health scoring — folds R/Y/G into the 8a boxes/tiles.

---

## 2026-07-15 (pm) — Slice A: task timing bookmark trail + begin-work entry contract. 541/541. (Built unattended per Kevin's 1-hr authorization.)

**The foundation for all task timing.** Kevin's model: bookmark system time at every status change, anchored at
submit, never stop the clock — every stretch between two bookmarks is "time in that status." Built in two green,
committed checkpoints; checkpoint 3 (awaiting-review) deliberately deferred (see below).

### Built (checkpoints 1 + 2, commits 050231b, d2d1f5c)
- **`task_events` bookmark trail** — one immutable row per status change (`task_id, request_id, task_type,
  from_status, to_status, at`), written by a DB trigger. Source of truth for elapsed-between-bookmarks. A second
  BEFORE trigger stamps denormalized `assigned_at / in_progress_at / done_at` (in_progress_at once = first start).
- **Begin-work entry contract** — `taskRouting.enterTask()` + `POST /tasks/:id/begin`: owner-gated, idempotent,
  `assigned`/`returned` → `in_progress`. The 3 task screens (record-search, redaction, estimate) call it on open.
  **`in_progress` is finally reachable** — before Slice A it was NEVER set (tasks jumped assigned→done), so no
  queue/process duration could be computed at all.
- **Redaction auto-discover gated** to first entry (`redaction_jobs.discovered_at` + zero-zones) — re-open /
  conveyor-next never re-scans or clobbers committed work (the "does re-entry overwrite my redaction?" concern —
  answer was no, but discover DID re-run wastefully; now gated).
- **`returned` promoted to a first-class status** (was an 8b flag). Widened ~20 "active task" status filters to
  include it so a returned task never vanishes from My Tasks / workload / dedup / cancel / request readouts.
- Anchored to the request's submit time (`requests.created_at`); tolling/resets stay on the legal clock
  (`request_clocks`) — the raw trail is pure and immutable, so any "statutory time in a step" is derived, never
  baked in. (This is the toll/reset concern Kevin raised — resolved by keeping the two layers separate.)

### Evidence
- Suite **541/541** (new `verify_task_lifecycle` 10/10 — the trail is a gap-free chain; begin is owner-gated +
  idempotent; a correction round keeps the original first-start stamp). Live census clean.
- **Live-verified**: restarted the API (schema + triggers applied), ran the idempotent backfill (seeded 31
  bookmarks + stamped existing tasks), and drove a throwaway task open→assigned→in_progress→done live — got the
  full chain `∅→open→assigned→in_progress→done` with all three timestamps, then deleted it (no residue).
  Frontend rebuilt + deployed (the `/begin` call is in the bundle).

### DEFERRED — checkpoint 3 (do next, interactively)
The **awaiting-review** refinement: at redaction submit, move the author's task to a distinct `awaiting_review`
status so its *processing* clock stops (excluding review-wait), reactivating to `returned` on send-back and to
`done` on release. Deferred because it restructures the redaction review round-trip + the task reconciler
(re-spawn risk), which shouldn't be done unattended. **Without it, the separate clocks still largely work** —
the `redaction_qa` task carries a clean review clock; only the author task's processing stretch is coarse
(includes review-wait) until this lands.

### STATE
`main` @ d2d1f5c + this docs commit. Suite **541/541**. Live API restarted (triggers live), backfill applied,
frontend deployed, connectors untouched.

### NEXT
1. **Slice A checkpoint 3** (awaiting-review) — small, interactively-verifiable.
2. **Slice B** — display the clocks (days-in-queue/process per item, bottleneck view) off the `task_events` trail.
3. Then the rest of the timing/actuals plan: D (work timer) · E (est→actual reconciliation) · conveyor & batch.

---

## 2026-07-15 (pm) — Slice A checkpoint 3: awaiting-review status (clean processing vs review clocks). 545/545.

The refinement deferred from the unattended build, now done with live verification. **Review is NOT forced** —
the change rides the existing disposition gate (only Elevated/Legal redactions require review; simple/standard
self-release; provably-clean bypasses redaction entirely).

- **New `awaiting_review` status.** At redaction submit, IF a reviewer is actually tasked (gated), the author's
  task moves `in_progress → awaiting_review`, stopping their **processing** clock while it sits with the reviewer.
  Send-back → `returned` → `in_progress`; the `redaction_qa` task carries the independent **review** clock. So
  processing vs review are two clean, separately-locatable numbers (the whole point of the bookmark trail).
- **Made a peer of the active statuses** across ~15 "is-there-an-active-task" filters (uniform sed, same as
  `returned`) so it can't cause a duplicate spawn and inherits every existing cleanup/terminal path. Deliberately
  NOT added to `enterTask` (an awaiting-review task is with the reviewer — the author can't re-start it).
- **My Tasks** renders it as a passive "Submitted · in review" line (no action) — properly fixing the old
  "looks unchanged during review" complaint.

### Evidence
- Suite **545/545** (verify_returned_rework §D: gated submit → awaiting_review + bookmark `in_progress →
  awaiting_review`; send-back → returned). Live census clean.
- **Live-verified** end-to-end on a throwaway: gated submit → `reviewTask spawned: true`, author task →
  `awaiting_review`, trail `∅→open→assigned→in_progress→awaiting_review`; deleted, no residue. Frontend rebuilt.

### STATE
`main` + this commit. Suite **545/545**. Live API restarted, frontend deployed, connectors untouched.
**Slice A is now complete** (bookmark trail · entry contract · returned status · awaiting-review clocks).

### NEXT
- **Slice B** — put the numbers on screen: days-in-queue / in-process / in-review per item, off the `task_events`
  trail; a bottleneck view. Then D (work timer) · E (est→actual reconciliation) · conveyor & batch.

---

## 2026-07-15 (pm) — Slice B-core: live queue/process/review clocks on My Tasks. 553/553.

Reads the Slice-A bookmark trail and puts the numbers on screen (Kevin: calendar days, B-core first).

- **`taskTiming.js`** — pure compute over `task_events`: elapsed time per state (the stretch between two
  bookmarks belongs to the status it was in; the current state runs to now; correction rounds SUM), rolled up
  into phases (in-queue = open+assigned · in-process · in-review = awaiting_review · returned) + age-since-submit.
- **`/tasks/mine`** carries a `timing` object per task (one events query for the whole list; `withReq` now also
  selects `request_created_at` as the submit anchor).
- **My Tasks** shows a live clock on each row — "In queue 7d 5h · Open Records", "In process 4h" — and the
  passive in-review line shows its review wait. Adaptive format (4h · 3d 2h · 5d).

### Evidence
- Suite **553/553** (new `verify_task_timing` 8/8: the math is exact on synthetic events — stretches, terminal
  states, summed rework rounds, current-state-to-now; `/tasks/mine` carries live timing). Live census clean.
- **Live-verified**: `/tasks/mine` for a real user returns queue/process/age; screenshot of My Tasks shows
  "In queue 7d 5h" under each row (the 7d reflects Slice-A backfill; going-forward bookmarks are exact).

### Deferred (as planned)
- **B-breakdown** — the per-request bottleneck view (horizontal timeline of where an item's time went, stitching
  `task_events` + `request_history`) — a new visualization, needs a mockup + sign-off.
- **Slice C** — budgeted-vs-actual overlay (needs the generic budget file). B shows RAW elapsed only.

### STATE
`main` + this commit. Suite **553/553**. Live API restarted, frontend deployed, connectors untouched.

### NEXT
- **B-breakdown** (bottleneck view, mockup first) · **Slice C** (budget overlay) · then D (work timer) ·
  E (est→actual reconciliation) · conveyor & batch.

---

## 2026-07-15 (pm) — Slice B-breakdown: per-request bottleneck timeline. 561/561.

Design-signed-off via a mockup (dataviz-validated phase palette), then built to it.

- **`requestTimeline.js`** stitches ONE gap-free, submit-anchored phase timeline: the **stage backbone** from
  `request_history` (work stages + holds like awaiting_payment + detours like AG review), with the
  **queue/process/review split** inside each work stage from the Slice-A `task_events` trail. Work stretches are
  gap-filled (uncovered time = "sitting/queue"); holds → a single hold segment; the **bottleneck = the longest
  ACTIONABLE stretch** (holds are the requester's payment/tolled — excluded).
- **`GET /requests/:id/timeline`** feeds **`RequestTimelinePanel`** on the request detail page (Audit History
  tab): a phase-coloured horizontal bar (waiting vs working vs review vs hold), stage brackets, a bottleneck
  callout, legend, and a precise breakdown table.

### Evidence
- Suite **561/561** (new `verify_request_timeline` 8/8: `coverStretch` gap-fills; `build()` stitches stages +
  task phases + a hold gap-free, sums to total, and names the review bottleneck while excluding the hold). Live clean.
- **Live-verified**: `/timeline` on a real request returns the segments; screenshot of the Audit History tab shows
  "6d 14h since submitted · 100% waiting", a big hatched on-hold bar, and the callout correctly naming the 18m
  actionable bottleneck while excluding the 6d 14h payment hold. Matches the mockup.

### STATE
`main` + this commit. Suite **561/561**. Live API restarted, frontend deployed, connectors untouched.
**Slice B complete** (B-core live clocks on My Tasks + B-breakdown per-request bottleneck view).

### NEXT
- **Slice C** — budgeted-vs-actual overlay (generic budget file first) → turns "2d in review" into "1d over budget".
- Then D (work timer) · E (est→actual reconciliation) · conveyor & batch · #13 org-wide bottleneck dashboard.

---

## 2026-07-15 (pm) — Slice C: time-budget overlay ("2d in review" → "over budget"). 572/572.

Turns the Slice-B raw clocks into over/under-budget, off a generic budget file (Kevin: generic now; the brain later).

- **`time_budgets` table** keyed by `(record_type_id, task_type)` — NULL record_type = the GENERIC default,
  seeded provisional per-task-type days (redaction 4 · record_search 3 · estimate 2 · legal 6/4 · qa 2 · …).
  Mirrors the estimate-profile pattern so the future budget "brain" adds per-record-type rows the same way.
- **`taskBudget.js`** compares the budget against the person's OWN active elapsed (queue + process + returned,
  **read from the same Slice-B trail as the displayed clock so the two agree**; in-review excluded — that's the
  reviewer's separately-budgeted step).
- **My Tasks**: a per-row budget chip ("2d left of 3d" green / "4d 6h over budget" red) + an "Over budget" tile.
- **B-breakdown**: each work-stage bracket shows its budget and turns red when the actual exceeds it.

### Evidence
- Suite **572/572** (new `verify_time_budget` 11/11: seed present; the math — on-track / over / warn; lookup
  specific-then-generic; active-elapsed excludes in-review; `/tasks/mine` carries a budget per task). Live clean.
- **Live-verified (screenshot)**: My Tasks shows "Over budget 3" and each row's budget matches its clock —
  "In queue 7d 6h · 4d 6h over budget" (7d6h − 3d). Caught + fixed a divergence mid-build (budget was using
  assigned_at; now uses the trail elapsed so budget and clock always agree).

### STATE
`main` + this commit. Suite **572/572**. Live API restarted, budget seeded (8 generic rows), frontend deployed.
The whole timing arc is now done: **Slice A** (bookmark trail + entry contract + awaiting-review) · **B-core**
(live clocks) · **B-breakdown** (bottleneck timeline) · **C** (budget overlay).

### NEXT
- **Slice I** (budget "brain") — best-guess per-record-type profiles + AI best-fit + supervisor override→template
  + feedback loop — REPLACES the generic file. Deferred (Kevin).
- ~~**D** (per-task work timer / actual labor)~~ BUILT 2026-07-15 · **E** (estimate→actual reconciliation) ·
  conveyor & batch · #13 org-wide bottleneck dashboard.

---

## 2026-07-15 · Slice D — actual-labor work timer (BUILT)

**What changed.** A third, independent time layer — actual hands-on-keyboard labor per task — separate from
the calendar bookmark trail (Slice A/B) and the legal deadline clock. Four `tasks` columns
(`work_seconds` accumulating actual · `work_measured_seconds` raw reading kept even when adjusted ·
`work_adjust_reason` · `work_finalized`). `frontend/src/components/ui/WorkTimer.js` — `useWorkTimer` hook
(active-time only: pauses on blur + 5-min idle, resumes on focus; 30s heartbeats), `WorkTimerBadge` (live
header pill), `WorkTimerCompleteModal` (accept-measured / adjust-with-required-reason). Backend
`POST /tasks/:id/work` (monotonic `GREATEST` heartbeat) + `POST /tasks/:id/work/finalize` (owner-gated;
adjust requires a reason; freezes `work_finalized=1`, later beats ignored). Wired: **redaction /
redaction-review** (badge + finalize on submit/apply) and **record-search** (badge + finalize on resolve).
**Estimate** screen carries the badge only (labor captured via heartbeat) — see open item.

**Evidence.**
- Suite: `node tests/run_suite.js` → **582 passed, 0 failed, LIVE UNTOUCHED**. New harness `verify_work_timer`
  (10/10): heartbeat monotonicity (stale beat can't lower it), accept-finalize freezes + ignores later beats,
  adjust requires a reason (400 without), measurement retained alongside adjusted actual, owner-gating (403).
- Live: schema ALTERs applied to live DB (4 `work_*` columns present); frontend rebuilt (`Compiled
  successfully.`); API restarted (health 200). Playwright screenshots of the **record-search** screen with
  **all mutating POSTs aborted at the network layer** — live-ticking badge (`⏱ 7s`) in the header and the
  completion popup rendered with real task context ("Record search · 2026-000001", hero active-work time,
  "Log time & close"). Post-shot check: the screenshotted task `t-0f15b043` still `assigned`,
  `work_seconds=0`, `in_progress_at=null` — **zero live writes**.

**Open items.**
- **Estimate finalize ceremony (fast-follow).** The estimate screen has the badge but no completion modal:
  its "complete" action is spread across `FeeEstimatePanel`'s several send paths (ERP charge, payment,
  notice send, adjustment notice) with no single interceptable action. Wire the modal once that completion
  action is consolidated. Labor is still captured meanwhile via heartbeat.
- Next: **Slice E** (estimate→actual reconciliation, consumes `work_seconds`), Slice I budget brain, conveyor
  & batch processing, #13 org-wide bottleneck dashboard.

---

## 2026-07-15 · Slice E — estimate→actual reconciliation (SCOPED, NOT BUILT — paused mid-scoping)

Session paused before build (Kevin changing locations). Slice D is done + committed (`30bb4b2`).
This block is the full scoping state so a fresh session resumes without re-deriving it.

### What Slice E is
Bridge Slice D's **measured** actual labor (`tasks.work_seconds`, per task) into the **existing** fee
reconciliation machinery. It is a focused wiring job, NOT a rebuild — most of the reconcile path already exists.

### What ALREADY EXISTS (do NOT rebuild — verified this session)
- `POST /fee-estimates/request/:requestId/reconcile` (`backend/src/routes/feeEstimates.js:355`) already:
  recomputes the fee from ACTUAL quantities in the request body, computes `variance_pct`, flags a revised
  notice when cost rose past the jurisdiction's `estimatePolicy.revisionNotifyPercent` (default 20%), writes a
  `kind='reconciliation'` snapshot into `request_fee_estimates`, and writes actuals back into the record-type
  estimate profiles via `estimateProfile.recordActuals()` (Welford running mean — sharpens future auto-estimates).
- `feeReissue.js` already tracks "revised notice outstanding" (newest reconciliation flagged `renotify_required`
  and no estimate notice sent since).
- `feeEngine.js` already runs in two modes — ESTIMATE (projected) and FINAL (actual) — via the same
  `compute(config, request)` with different quantities (see feeEngine.js:14). Labor drivers are
  `search / review / programming` (`LABOR_ORDER`, feeEngine.js:56). It already handles billing-increment
  rounding, free-hour allowances, and labor billability gates (hard non-billable states CA/NY/OH; all-or-nothing
  triggers TX>50pp, FL/NY hour thresholds; the paper-only 50-page bar).
- `request_fee_estimates` already has `baseline_total`, `variance_pct`, `renotify_required`, `kind`.

### The GAP Slice E closes
The ACTUAL labor hours fed to `/reconcile` are currently TYPED BY HAND. Slice D now measures them
(`work_seconds`), but nothing connects the two. Slice E:
1. **Rollup service** (new, e.g. `backend/src/services/laborActuals.js`): sum finalized `work_seconds` across a
   request's billable work tasks, map task type → fee labor driver, convert to hours. Roll up at the REQUEST
   level (per-component / MRR attribution DEFERRED — parent roll-up waits for #11, consistent with Slice B/C).
2. **Pre-fill** the reconcile inputs from that rollup; staff still confirm/override (same accept/adjust ethos
   as Slice D). Use the FINALIZED `work_seconds` (incl. any clerk adjustment) as the billable number;
   `work_measured_seconds` (raw) retained for audit.
3. **Surface labor estimate-vs-actual** (estimated hours vs measured hours + variance, not just dollars) in the
   EXISTING `frontend/src/components/ui/FeeEstimatePanel.js` — NO new screen (UI rule: a dedicated
   reconciliation screen would need a separate design-direction step first).
4. `backend/tests/verify_estimate_reconcile.js` harness; register in `tests/run_suite.js` ALL array.

### OPEN FORKS — needed before build

**Fork 1 — task-type → labor-driver mapping + billability.** ⚠️ Kevin gave a NEW DIRECTION here, not a pick:
> "perhaps you can review documentation for different jurisdictions to determine what different types of
> labor/tasks are billable. And if it's not always the same across states, make the time-capture toggle
> visible/not-visible depending on the statutes for the state."
So this is now a RESEARCH + DESIGN sub-task, not a one-line default:
  - Research per-jurisdiction: which task/labor types are billable to the requestor (search vs review/redaction
    vs programming), since it varies by state (some states bar labor entirely; some bar redaction/review time
    specifically; some allow all). Use the research approach in [[research-tool-sizing]] — likely the deep
    harness given breadth. Anchor to the states already profiled (TX/FL/NY/CA/OH seen in feeEngine gates).
  - The measured-labor timer's VISIBILITY (and whether that task's time is billable) should be GATED PER
    JURISDICTION STATUTE — a config-driven toggle, not hardcoded. This likely extends the fee profile / jurisdiction
    config (billable-labor-type flags per driver) rather than a code constant. Note the interaction with the
    existing feeEngine `laborGate` (which already zeroes non-billable labor at pricing time) — visibility gating is
    the UPSTREAM twin of that downstream gate.
  - My proposed default mapping (for reference, pending the research): record_search→search;
    redaction+legal_redaction+redaction_qa+legal_review→review; estimate+routing_review+fee_waiver→non-billable.

**Fork 2 — reconcile trigger (UNANSWERED).** When does measured-labor reconciliation fire?
  - (Recommended) Auto-COMPUTE a DRAFT reconciliation when the request's last billable work task finalizes; the
    revised-notice SEND stays human-gated (as it already is via feeReissue). Kevin earlier said "auto-reconcile
    on completion with threshold/waiver bypass," which points here.
  - vs. Manual — pre-fill only when staff open the reconcile action.

### RESUME CHECKLIST for a fresh session
1. Re-read this block + `docs/SPEC_fees_estimates_payments.md` (reconcile/variance §) + `SPEC_tasks_roles_mrr_fees.md`
   §2.1 (Slice A–D timing layers).
2. Resolve Fork 1 via the per-jurisdiction billability RESEARCH Kevin asked for; propose the config-driven
   billable-labor + timer-visibility model; get Kevin's sign-off (product/legal fork).
3. Resolve Fork 2 (trigger) with Kevin.
4. Then build: laborActuals rollup → reconcile pre-fill → labor variance readout in FeeEstimatePanel → harness →
   full suite green (`cd backend && node tests/run_suite.js`, must stay LIVE UNTOUCHED) → live-verify → commit.

---

## 2026-07-15 · Slice E · Fork 1 RESOLVED + BUILT — time-capture visibility config (city-owned toggle). 594/594.

**Kevin killed the statute-research path.** After reviewing 12 states himself he found labor billability too
ambiguous to encode (no consistent "review" concept; vague "reasonable cost"; several states allow legal-dept
labor only "in certain circumstances"). So Fork 1 is NOT a per-jurisdiction table — the **city decides**, per
task UI, via a config panel. The deep-research harness I had queued was cancelled before running.

**Built this session (bounded slice, greenlit):**
- **Config model** — `services/timeCaptureConfig.js`: one global `system_config` JSON key
  `time_capture_visibility = { search, estimate, legal_redaction, mrr, legal }`, each `off|discretion|always`,
  default all **off**; defaults-merge + sanitize-to-off on junk. Endpoints in `routes/config.js`:
  `GET /config/time-capture` (any authed user) + `PUT` (SYSTEM_ADMIN/DIRECTOR).
- **Skip finalize** — new `{skipped:true}` branch of `POST /tasks/:id/work/finalize` (`routes/tasks.js`): raw kept
  in `work_measured_seconds`, **`work_seconds` NULL** (nothing billable), `work_finalized=1`.
- **Frontend** — `WorkTimer.js` gains `useTimeCaptureMode(uiKey)` + `timer.skip()` + a **Skip** button in the
  modal (discretion). Heartbeat ALWAYS runs (raw always captured); mode gates only visibility + finish flow.
  **off** = no badge, Complete forwards; **discretion** = badge + modal w/ Skip; **always** = badge + modal.
  Wired fully on **record-search** (`'search'`) and **redaction** (`'legal_redaction'`); **estimate** honors
  off/always for **badge visibility** only (full modal enforcement waits on the estimate finalize-ceremony
  consolidation — unchanged Slice-D fast-follow). Panel = a **Time Tracking** tab on ConfigurationPage; MRR + Legal
  rows shown **disabled / "Not yet available"** (screens not built).
- **Harness** `verify_timecapture_config.js` (default-off, sanitize/merge, role gate, skip semantics) — 12/12.
  Registered in run_suite ALL. **Full suite 594/594, live untouched.** Frontend compiles (+1.07 KB).
- **Verified live:** API respawned (root PM2), route mounted (401 not 404), authed GET returns all-off + correct
  availability/modes; **panel screenshotted** rendering correctly (Off selected, MRR/Legal greyed).
- **Spec** updated same-commit: `SPEC_tasks_roles_mrr_fees.md` §2.1 (new Slice-E·Fork1 paragraph) + §14 parks the
  **legal-hours-in-estimate / intake-routing** open-design item (Kevin's sketch: ORO intake review; MRR→manual
  assign legal or plug hours; single-child→fulfillment team spawns a legal-estimate task).

**Slice E remainder still open** (the reconcile WIRING itself — this session did Fork 1 only):
- **Fork 2 (trigger) — RESOLVED 2026-07-15 (Kevin):** **auto-draft on last-billable-task finalize; human-gated
  send.** When a request's last billable work task finalizes, auto-COMPUTE a *draft* reconciliation
  (`kind='reconciliation'` snapshot). The revised-notice SEND stays human-gated exactly as it already is via
  `feeReissue.js` — the auto step only computes/stages, never notifies the requestor on its own.
- **BOTH FORKS NOW CLOSED — Slice E reconcile wiring is build-ready (its own bounded slice, next session):**
  1. `services/laborActuals.js` rollup — sum FINALIZED `work_seconds` across a request's billable work tasks,
     map task-type → fee labor driver (search/review/programming), convert to hours. Request-level (parent
     roll-up waits for #11). **Must tolerate NULL `work_seconds`** (skipped/off under the new Fork-1 config) —
     fall back to manual entry, never assume actuals exist.
  2. Trigger per Fork 2: on the last billable task's finalize, auto-compute the draft reconciliation via the
     EXISTING `POST /fee-estimates/request/:id/reconcile` machinery (pre-fill actual hours from the rollup).
  3. Labor estimate-vs-actual readout (hours + variance, not just $) in the EXISTING `FeeEstimatePanel` — no new
     screen (UI rule).
  4. `verify_estimate_reconcile.js` harness → register in run_suite ALL → full suite green (LIVE UNTOUCHED) →
     live-verify → commit.

---

## 2026-07-15 · Slice E — measured-labor → estimate reconciliation wiring (BOTH forks closed → BUILT). 614/614.

Both Slice E forks were resolved last session (Fork 1 built as the city-owned time-capture toggle;
Fork 2 = auto-draft on last-billable-task finalize, human-gated send). This session built the reconcile
wiring itself — the bridge from Slice D's measured labor into the EXISTING reconciliation machinery.
Committed `c57c4c9`.

**Built.**
- **`backend/src/services/laborActuals.js`** (new) — the bridge:
  - `rollup(requestId)`: sums FINALIZED `work_seconds` across a request's billable work tasks, maps
    task type → fee labor driver (`record_search`→search; `redaction`/`legal_redaction`/`redaction_qa`/
    `legal_review`→review; nothing maps to programming — no routed task type produces it), converts to
    hours. **Request-level** (per-component/MRR-child attribution DEFERRED to #11: aggregate lands on the
    first component; request-total stays correct since the engine re-aggregates labor there). **Tolerates
    NULL `work_seconds`** (off/skipped under Fork 1): those tasks are `excluded`, never billed as zero;
    `hasActuals=false` ⇒ caller falls back to manual, never reconciles fabricated zeros.
  - `maybeAutoDraftOnFinalize()` / `autoDraftReconcile()` — Fork 2 trigger: fires only when the finalizing
    task is a billable type AND it's the last one still in flight (`remainingBillableCount()==0`), AND a
    prior estimate + measured actuals exist. Overlays measured labor on the estimate's quoted input (page
    counts carried forward), computes via `feeEngine`, writes a `kind='reconciliation'` DRAFT. **SEND stays
    human-gated** (created_by `(auto-draft)`, `notified_at` NULL, NO Welford write-back — that's the
    staff-confirmed manual path). Wired non-fatally into BOTH branches of `POST /tasks/:id/work/finalize`
    (skip + accept/adjust), guarded so it never fires on re-finalize or a non-billable task.
  - `writeReconciliation()` — ONE shared snapshot writer + variance/renotify math, adopted by BOTH the
    manual `/reconcile` route AND the auto-draft, so the two paths can't drift.
- **`routes/feeEstimates.js`** — manual `/reconcile` now delegates snapshot+variance to the shared writer
  (still does Welford `recordActuals` + history + payment event itself). `GET /request/:id` returns a new
  **`laborActuals`** block: measured vs estimated hours per driver, counted/excluded tasks, and an
  `autoDraft` flag when a draft awaits review.
- **`routes/tasks.js`** — finalize fetches `type`+`request_id`, fires the trigger.
- **`FeeEstimatePanel.js`** — a **Measured labor** readout in the reconcile section (est vs actual hrs per
  driver + Δ, an auto-draft banner, a **Use measured hours** button that drops the rollup into the
  reconcile inputs). No new screen (UI rule).

**Evidence.**
- New harness **`verify_estimate_reconcile` 20/20**: rollup mapping + NULL/skip tolerance + non-billable
  exclusion; auto-draft fires on the LAST billable finalize, NOT before (other billable task still open),
  NOT without an estimate, NOT with no measured actuals, NEVER sends (notified_at NULL); draft carries
  measured labor + carried-forward page counts; exactly one snapshot (no early dup); manual reconcile
  regression through the shared writer. Registered in `run_suite` ALL.
- **Full suite 614/614, LIVE UNTOUCHED.** Frontend rebuilt (`Compiled successfully`, +564 B). API restarted
  (root PM2 respawns `backend/server.js` on kill; health 200, new pid).
- **Live-verified read-only:** deployed `GET /fee-estimates/request/:id` returns the `laborActuals` block
  against a REAL request — its real `record_search` task correctly `excluded` as "not finalized", the real
  estimate's quoted `searchHours:1` surfaced, `hasActuals:false`, `autoDraft:null`. **Zero writes.**

**Open / next.**
- **Estimate finalize ceremony (still the Slice-D fast-follow, unchanged).** The estimate screen has the
  timer badge but no completion modal; its "always/discretion" modal enforcement waits on consolidating the
  estimate-complete action (spread across FeeEstimatePanel's send paths).
- **Per-component / MRR-child labor attribution — deferred to #11** (parent roll-up). Today the rollup is
  request-level; multi-component requests get the aggregate on component[0] (request-total correct, per-
  component split not yet meaningful).
- **Legal hours in the estimate (Fork 1 spillover)** — still OPEN DESIGN (SPEC_tasks_roles_mrr_fees §14):
  ORO intake review; MRR→manual assign/plug; single-child→fulfillment spawns a legal-estimate task.
- Next slices: **Slice I budget brain** (consumes the same measured labor), conveyor & batch processing,
  #13 org-wide bottleneck dashboard.

---

## 2026-07-16 — THE MERGE: parent/child is now ONE binding spec, item 1 RATIFIED. Docs only, no code.

**Session opened on a power-outage recovery and turned into the root-cause of why `BUILD_PRIORITY` item 11 never
got built.** Nothing was lost to the outage: the interrupted session (`e1b17dc9`) ends at Kevin's message
*"delete all request data and let's build the parent/child schema"* (00:06:47) with **no assistant response** —
the delete **never ran**. Live DB verified intact: 129 requests, 723 files, 552 history rows.

### What was actually wrong (all verified, not asserted)
- **Parent/child was NEVER BUILT.** 129 requests, **0 children**, `master_request_id` written by **zero lines of
  code** (6 files read it, none write). `component_label` written on 0/129. 4 rows carry `is_mrr=1` with no
  children — the broken middle state Kevin saw in the portal.
- **§12's rival model was never built either.** `20ff869` touched **3 `.md` files, no code** ("Spec/design only").
  No `request_items` table, no `item_count` anywhere. **Neither model ever reached the codebase — nothing to unwind.**
- **The "two live bugs to fix first" were FIXED on 07-13** (`a9f8d29` ghost stage, `9ba8f32` raw stage writes).
  Both specs still listed them as blockers. Corrected.
- **`ARCHITECTURE.md` contradicted itself:** the header said "pending Kevin's ratification / item 1 is the only
  open judgment call" while item 1's heading read ADOPTED — and `CLAUDE.md` told **every fresh session** item 1 was
  unratified. That is the most likely mechanism for 13 sessions correctly taking smaller, unblocked slices instead.
- **The 07-10 vs 07-13 "spec conflict" was largely a MISREADING.** §12 had *leaned* storage option **(a) child
  rows** — the same choice 07-13 made. The 07-13 supersede header described §12 as having chosen `request_items`.
  It hadn't. The genuine delta was the **field asymmetry** (retiring "a child IS a full request row") + migration
  direction, not storage.
- **The "manual MRR routing" contradiction was MINE, not the specs'.** §9 item 5 and
  `MASTER_task_types_permission_groups.md` §A2 are **MRR-scoped in their own sentences**; neither ever spoke to
  single-child requests. Kevin diagnosed this himself from memory, and his recall was near-exact (ORO Associate,
  `mrr_processing`, the five hand-assigned workstreams).

### Kevin's rulings this session
- **ARCHITECTURE item 1 RATIFIED** — *"this is the model to be used."* All 7 items now ratified.
- **Toll attribution (§4.2.1)** — Kevin's model, **adopted over the spec's**: the clock stays on the parent
  (legally required), but the *trigger* is attributed via a **nullable `source_request_id`** (NULL = parent-level
  event). Attribution ≠ ownership.
- **Child routing (§14.2)** — **suggest-and-confirm**, superseding 07-13's "purely manual": the classifier runs on
  **every** child; **committed** at `child_count = 1`, **suggested** at >1 for the RM to accept/override/bypass.
  Rationale: always-wrap means a single-record request *is* a parent with one child, so children must auto-route
  or every ordinary request would need a human. Engine uniform; only the commit gate differs.
- **Hub ownership (§14.1)** — the ORO Associate owns the **whole tree at the parent**; children are **not**
  individually assigned. Children are dispositioned from inside the hub.
- **Purge, not migrate** — the 129 requests are test residue; delete rather than backfill.

### 🚨 A LIVE BUG FOUND (not migration-gated — reachable TODAY on the flat schema)
`tolling.js` **can only hold ONE open toll**: `toll()` returns `{alreadyTolled:true}` and **silently drops** a
second trigger; `resume()` closes **all** open tolls. Today: clarification open → record goes to the AG → **the AG
hold never registers** → clarification answered → **the clock runs while the request is still legally suspended.**
And the accumulator **SUMS** toll intervals (safe only because of the single-toll guard) — lift it naively and
overlapping tolls double-count (A: Jan 1–10, B: Jan 5–15 → **20 days counted, 15 actually suspended**), extending
the due date beyond law while the dashboard reports compliant. **Required:** concurrent attributed tolls + **UNION
of intervals, never sum** + refcounted resume. **Worth its own slice regardless of the migration.**

### Shipped (docs only — `git diff` confirms zero code files)
- **`SPEC_parent_child_lifecycle.md` is THE single binding spec** (512 → 716 lines). New **§13** (citizen + fee
  layers, folded from §12 Layers 1/3), new **§14** (MRR staff workflow, folded from §12.1 — *never superseded,
  only mis-filed in a tasks/roles/fees doc, which is much of why it was never found*), new **§4.2.1** (toll
  attribution + the two engine bugs), §9 item 5 relaxed → §14.2, §8 blockers cleared.
- **§11.1 (a) + (b) DECIDED — Claude's technical call, NOT Kevin's, reverse freely:** (a) drive the deposit sweep
  off **`payment_status`**, drop the stage predicate — **must be rewritten BEFORE children exist or dunning
  silently stops**; (b) report revenue by **parent-level groupings only**, refuse the child-grouped cut (needs an
  allocation rule the law is silent on).
- **`SPEC_tasks_roles_mrr_fees.md` §12 → a 24-line pointer stub.** Its Terminology paragraph had been instructing
  agents to retire the exact vocabulary the binding spec uses. **One document, one vocabulary: parent + child.**
- `ARCHITECTURE.md` ratified · `CLAUDE.md` updated (item 1 ratified; parent/child designed-not-built) ·
  `BUILD_PRIORITY_SUMMARY.md` item 11 resequenced.

### Next
**No decisions remain on item 11 — it is now work.** Sequence: (1) **purge** the 129 demo requests; (2) rewrite
`tickler.js`'s deposit sweep onto `payment_status` (§11.1a) — *before* children exist; (3) the backfill (§8);
(4) the portal emitting children + retire `mrrChoice`; (5) the §4.2.1 concurrent-toll engine.
**Blocked on DESIGN, not decisions:** the MRR hub (§14.3 — parent line + child lines; UI rule: agree before build).
**Stale sessions still alive and idle:** tmux `claude` (pid 838913, session `efec0a92`), 841259, 278413 — safe, but
they are what a reconnect lands in. Kill when convenient.

---

## 2026-07-16 (b) — THE CONCURRENT-TOLL BUG IS FIXED. 641/641, break-test proven, deployed.

**Kevin's pick after the merge.** The bug found while writing §4.2.1 — **live on the flat schema, no migration
needed to reach it.** Committed `01c3b36`; spec §4.2.1 updated to match (this commit).

### What was broken
1. **`toll()` guarded per CLOCK, not per REASON** — `if (open) return {alreadyTolled:true}`. A record going to the
   AG while a clarification was open **never registered**: no error, no ledger row, nothing.
2. **`resume()` closed EVERY open toll** and flipped the clock to `running`. So answering the clarification **ran
   the clock while the request was still legally suspended at the AG.** The city burns statutory days it was
   entitled to suspend, silently.
3. **`computeStatus` SUMMED toll intervals** — safe *only* because of (1). Allowing concurrency without union math
   double-counts overlap (A Jan 1–10 + B Jan 5–15 → **20 counted, 15 actually suspended**), pushing the due date
   past what the law allows **while the dashboard reports compliant**. Same class as the 10,000 ceiling.

**Both trigger sites were already in the code and already pointed at the same primary clock** —
`routes/requests.js:225` (`ag_ruling_pending`) and `clarificationAction.js:187` (`clarification_pending`). This
was not hypothetical.

### The fix
- `toll()` idempotent **per reason**; different reasons hold concurrently, same reason twice is still a no-op.
- **`resume(clockId, reason)`** closes only that hold; clock resumes **only when the LAST closes** (refcount).
  `resumed` now means **the clock is running again**, never "this reason was closed". Bare `resume()` still clears
  all — the deliberate admin override (`routes/clocks.js` takes an optional `body.reason`).
- **`unionDays()`** — merge overlapping/adjacent spans, then count. Never sum.
- **Every caller passes its own reason** so none can release a sibling hold: `clarificationAction` →
  `clarification_pending`, `depositAction` → `payment_pending`, AG release → `ag_ruling_pending`.

### Evidence
- **`verify_concurrent_tolls` 27/27** (new, registered in `run_suite` ALL). Union math proved **deterministically,
  no DB, no wall-clock**: overlap · disjoint-still-sums · wholly-contained · adjacent-merge · order-independence ·
  pre-epoch clamp regression. Then the real scenario end-to-end: the second hold registers · same reason twice is
  a no-op · **resuming the clarification leaves the clock `tolled` and NOT overdue while the AG holds it** · only
  the last resume runs it · bare `resume()` override · `restart()` still closes everything.
- **FULL SUITE 641/641** (was 614), **LIVE UNTOUCHED** — census confirms not one row moved.
- **BREAK-TEST PROVEN** (committed green first): restoring the per-clock guard → **18/27, 9 fail**; reverting
  union→sum → **23/27, 4 fail**, and *exactly* the four overlap-sensitive assertions, with disjoint/adjacent
  correctly still passing. Restored via `git checkout`, suite re-run green.
- **DEPLOYED + read-only verified.** API restarted (pid 1375150 → 1514951, health 200). Live ledger: 98 tolls,
  29 open, **0 clocks with >1 concurrent hold** — as expected, since the old code made that state unreachable.
  **Zero writes to live.**

### Note
**`source_request_id` attribution (§4.2.1) is deliberately NOT in this slice.** Today every row is its own parent
and child, so the column would record an ambiguous value; it lands with the migration, where "which child" first
means something. The bug fix stands alone and did not need it.

### Next (unchanged)
Item 11 sequence: (1) **purge** the 129 demo requests; (2) rewrite `tickler.js`'s deposit sweep onto
`payment_status` (§11.1a) — **before** children exist, or dunning silently stops; (3) the backfill (§8); (4) the
portal emitting children + retire `mrrChoice`; (5) `source_request_id` attribution.
**Blocked on DESIGN, not decisions:** the MRR hub (§14.3 — UI rule).

---

## 2026-07-16 (c) — THE PURGE. 126 test requests gone, 3 infrastructure rows kept, 270 orphans swept.

**Kevin: "delete all request data" → after I surfaced what was actually in there: "keep the 3, delete the 126."**
Script: `backend/src/db/purge_test_requests.js` (dry-run by default, `--apply` to execute, idempotent).

### 🚨 WHAT THE CENSUS FOUND — why "delete all request data" was NOT safe to take literally
**THREE ROWS ARE NOT REQUESTS.** They use a request row as a container, and between them owned **644 of 723
files — 89% of every file in the system**:

| Row | What it is | Files |
|---|---|---|
| `req-library-files` / `LIBRARY` | *"Internal owner of published public-library document copies (not a real request)"* — **the public library** | **42** |
| `req-911-proactive` / `SYS-911-PROACTIVE` | Standing proactive-disclosure batch | **602** |
| `req-template-samples` / `SYS-TEMPLATE-SAMPLES` | Holding area for redaction-template samples | **0 — empty by design** |

The codebase already agreed: **five** places carve them out (`reportEngine` BASE_EXCL, the request queue,
`clarificationTimeout`, `feeNonpayment`, `renumber_request_numbers`, `requestCreate`) with the same predicate
`request_number != 'LIBRARY' AND NOT LIKE 'SYS-%'`. **The purge uses that exact predicate, inverted**, then
asserts the protected ids are not in the target set. A literal purge would have destroyed the public library.

### 🚨 A PRE-EXISTING BUG THE PURGE EXPOSED — 270 already-orphaned ledger rows
**Every one of the 98 `clock_tolls` and all 172 `clock_extensions` was ALREADY ORPHANED** — not one had a
matching `request_clocks` row. Neither table has a declared FK, so nothing ever cleaned them. They are residue
from `verify_*` harnesses that ran against **LIVE** before the suite got its own database (`42fe74b`,
2026-07-14) — the same contamination class as the 15 orphan tasks. **This also corrects the live verification in
entry (b):** I reported "98 tolls, 29 open" as evidence the toll fix was deployed. That was misleading — those
rows were inert orphans. **No live clock has ever carried a toll.** The fix and its 27/27 harness stand; the
live read-only claim was weaker than I stated.

**Six FK-less ledgers** would have been silently stranded by a naive delete (`clock_tolls`, `clock_extensions`,
`task_events`, `redaction_zones`, and `embeddings` on two owner types). The script sweeps by **ORPHANHOOD after
the cascade**, not by the target predicate — one rule that cleans both historical residue and anything newly
stranded. `embeddings` of `owner_type` `record_type`/`user_spec` are deliberately untouched (they do not hang
off requests).

### Guards (the script REFUSES rather than proceeds)
1. The 3 protected rows must exist **and** must not match the target predicate.
2. **No target request may have taken money** — checks `fee_payments` / `fee_adjustments` / paid `erp_charges` /
   estimates with `deposit_paid_at`/`final_paid_at`. All zero, so Kevin's 2026-07-14 rule never had to fire.
   (The 9 `request_payment_events` were `estimate_issued` entries — that ledger is mixed, which is exactly why
   the DB guard is a trigger and not `ON DELETE RESTRICT`.)
3. Post-purge it **proves** the outcome instead of asserting it (see below).

### Result — verified, not asserted
`requests 129 → 3` · `request_files 723 → 657` (42 library + 602 proactive + 13 pre-existing NULL orphans,
untouched) · `tasks 32 → 0` · `request_history 554 → 301` · `request_clocks 14 → 0` · `clock_tolls 98 → 0` ·
`clock_extensions 172 → 0` · `task_events 32 → 0` · `redaction_zones 48 → 0` (all were per-file boxes on deleted
test documents) · `embeddings 512 → 427` · estimates/payment_events → 0.

- **All post-purge checks OK**, incl. 0 orphaned ledger rows and the redaction template substrate intact
  (`redaction_rules` 26 + `layout_profiles` 1 + `redaction_categories` 8 + `mass_redaction_jobs` 17 = 52).
- **ONE CHECK FAILED ON THE FIRST RUN — and it was MY BAD ASSERTION, not the purge.** I asserted
  `SYS-TEMPLATE-SAMPLES` owned files; it owns 0 and always did (my earlier "644 across the 3" was 602+42+**0**).
  Corrected to assert the ROW survives plus the template substrate. Re-ran clean.
- **SUITE 641/641, LIVE CLEAN.** **Public library VERIFIED SERVING** post-purge: `/public/library/search` returns
  records, `/public/browse` returns the full department tree with counts, `/public/browse/records` returns rows.
- **INTAKE VERIFIED END-TO-END on the empty corpus:** a real `POST /api/public/submit` returned **201** and minted
  **`2026-000001`** — the sequence restarts cleanly, 6-digit width holds, 1 task spawned, 1 clock started. That
  smoke row was then purged, so the slate is genuinely clean (script is idempotent — re-running is a no-op).

### State
**0 citizen requests. 3 infrastructure rows. The parent/child migration now runs against an empty corpus** —
no backfill of 126 junk rows, no renumber, nothing to reconcile. `is_mrr`/`master_request_id`/`component_label`
are all unset and unused, exactly as §8 assumed.

### Next — the migration (§8), in this order
1. **`tickler.js`'s deposit sweep onto `payment_status` (§11.1a) — FIRST.** After the migration the estimate is on
   the parent and the stage on the child, so its `stage='awaiting_payment'` join matches nothing and **dunning
   silently stops**. No error, no notice, no lapse, no withdrawal.
2. The backfill itself — now trivial: 0 rows to convert.
3. The portal emitting children (+ retire the dead `mrrChoice`).
4. `source_request_id` toll attribution (§4.2.1).
**Blocked on DESIGN, not decisions:** the MRR hub (§14.3 — UI rule).

---

## 2026-07-16 (d) — WRAP-IN-PARENT IS BUILT. Every request is now a parent + child. 686/686.

Kevin: *"fix the tickler sweep then build the migration."* The sweep needed no fix (see the correction below);
the migration is **BUILT** — `1739215` (the wrap) + `40ae5a7` (a live bug it exposed). `BUILD_PRIORITY` #11, the
item that had been carrying since 2026-07-13.

### ⚠️ FIRST: a CORRECTION I owe the record (`a17e96c`)
**There was no tickler sweep to fix.** §11.1(a) and (b) were **decided by Kevin on 2026-07-14 and SHIPPED THE
SAME DAY** (`a68df67` — "deposit sweep on the money axis; drop revenue-by-department"). §11.1 was written 07-13
and never updated. I re-presented both as open decisions, **"decided" them as Claude's technical call in the
merged spec**, and put the sweep rewrite at the top of the migration sequence in THREE places. `a68df67`'s title
was in the git log I read at the start of the session. **This is the same staleness class I caught in §8's "two
live bugs to fix first" and missed here.** Already built: the sweep keys off the money axis (accepted estimate +
`deposit_due > 0` + no payment) with **no stage predicate at all** — better than the `payment_status` option
§11.1 recommended; and `reportEngine` already refuses the child-grouped revenue cut.

### The migration
**No backfill.** The purge left 0 citizen requests, so §8's 125-row conversion never had to run. The wrap simply
applies from now on.

`createRequest` creates the **pair**: PARENT (number, requestor, money, statutory clock, deadline) + CHILD
(description, stage, routing, and every FK). **The child keeps the id and is what the helper RETURNS**, so tasks,
files, redaction and every deep link attach exactly where they did. Numbers: `2026-000001` / `2026-000001-1`.
`child_no` is 1..n, **never 0** (§5.1). The three LIBRARY/SYS-* containers are created `wrap:false` and stay bare.

### 🚨 A LIVE BUG THE SUITE MISSED — the reason the live-verification rule exists
The wrap shipped **green at 682/682**. The live smoke then showed **TWO respond clocks on one request** — one on
the CHILD. That is exactly what §2 exists to prevent: one request, one legal deadline; N children with N clocks
is N deadlines (IL 5 ILCS 140/3(d) — one request-level answer date, no installment safe harbor).
**Cause:** `workflowEngine.onIntake` runs on the CHILD (routing comes from the description) and started a clock
there. **The harness missed it because it built its clock fixture with `kickIntake:false` — so the intake path,
the thing that broke it, never ran.** Fixed in the ENGINE (`tolling.parentOf`), not at the five call sites: one
invariant, one place. `writebackDeadline` now cascades `deadline_date` to children (a true derived copy — every
child shares its request's due date) because every work list is LEAF-scoped and would otherwise show a blank.
`request_clocks` stays parent-only. **Verified live: parent 1 clock, child 0, same deadline, tasks on the child.**

### Two things the spec did not account for (both now in §8)
1. **`description` is NOT NULL.** I first copied it up; every description lookup then matched TWO rows — the
   double-count §11 exists to prevent. §5.1 was right. Now `CHECK (child_no IS NULL OR description IS NOT NULL)`
   — the guarantee kept, on the row that carries the work. **`classification` IS copied up** (it drives the
   statutory clock's duration). `[Claude's call — a real spec gap, not Kevin's ruling.]`
2. **History is written at BOTH levels.** Creation happens at both and neither trail may start empty: the parent
   records the citizen's submission, the child records the component.

### Evidence
- **`verify_wrap_parent` 39/39** (new): the pair · the split · **the clock on the parent and NOT the child, after
  FULL INTAKE** · work on the child · scope predicates now DISCRIMINATING instead of tautologous · the CHECK
  constraint · and — asserted rather than left to luck — **a child's composite number can never take part in
  citizen-number sequencing** (a free consequence of the fixed-width fix `efe3c57`).
- **SUITE 686/686** (was 641), **LIVE UNTOUCHED**. **Break-tested** (green committed first): disabling the wrap →
  4/8; re-copying `description` to the parent → exactly the 2 double-count assertions.
- **Live-verified end to end**: real `POST /public/submit` → 201, citizen sees **`2026-000001`** (never a suffix),
  pair created, 1 clock on the parent / 0 on the child, both showing `2026-07-21`, `record_search` + `estimate`
  tasks on the child. Probe rows purged after — **live is back to 3 infrastructure rows, 0 citizen requests.**

### Three harness bugs the wrap exposed (all fixed)
- `verify_request_create` counted with `LIKE '2026-%'`, which matches a CHILD's composite number — the identical
  loose-predicate bug it exists to prove about algorithms B and C.
- Its ALGORITHM C proof simulated on the **ambient corpus** and needed `COUNT == MAX`; that held only because live
  happened to be contiguous. The purge emptied it, so it failed on CORRECT code. Now **constructs** the condition
  in an isolated year.
- Seven harnesses looked for the clock on the row they created. Resolved through the parent.
- **`run_suite` now prints WHICH assertions failed.** It used to say a harness was red but not why, and finding
  out meant re-running by hand against a `--keep`'d DB the run had already dirtied — where it often did not
  reproduce.

### Next
- **The portal emitting n children** (MRR item-by-item intake, `BUILD_PRIORITY` #12) + retire the dead `mrrChoice`.
  Today every request is a parent with exactly ONE child; `createRequest` needs an n-child signature.
- **`source_request_id` toll attribution** (§4.2.1) — now meaningful, since "which child" finally exists.
- **MRR classification roll-up** — the parent copies its single child's `classification` today; MRR needs a
  worst-case rule. **Unspecified (§6).**
- **Blocked on DESIGN, not decisions:** the MRR hub (§14.3 — parent line + child lines; UI rule).

---

## 2026-07-16 (e) — Kevin's field-design call: the PARENT loses disposition/outcome. Docs only.

**Kevin's question — *"do the parent and child have the same fields? I hope not"* — surfaced two real defects.**

**1. Physically they DO share a table.** `requests` is one table, 47 columns, holding both. §1 chose that
deliberately, but for a narrower reason than it reads: a **single-record child and an MRR child** must be the
same row shape or every worklist unions two shapes forever. Parent/child sharing the column set is a *side
effect*, not the goal. The parent populates ~20 of 47, the child ~40. The split is enforced today by convention
in one function plus a single CHECK (`chk_child_has_description`) — **soft, not structural.**

**2. `outcome` vs `disposition` was a LIVE CONTRADICTION in the binding spec.** §4.4 named the field `outcome`
(`Granted` · `Granted in Part` · `Denied` · `No Responsive Records` · `Withdrawn`); §6.2 named the same field
`disposition` (`Fulfilled` · `Partial fulfillment` · `Denied` · `No records located`) — and §4.4 *pointed at §6.2
as its derivation*. Two names, two lists sharing only `Denied`, plus a third set from §6.2's cascade branch
(`Closed – Non-payment` …) in neither. Same class as the §12-vs-§13 mess: two passes days apart, never
reconciled. **Nothing could have been built on it.**

### Kevin's ruling (2026-07-16) — defer rather than arbitrate
- **The PARENT has NO disposition and NO outcome.** Only **`In Process` / `Complete`** (§6.1) — derived, coarse,
  never stored. `Complete` = no further processing; it does **not** mean delivered or granted.
- **The real outcome lives on the CHILD** — §5.8 already carried exactly Kevin's model
  (`Closed – Delivered` · `No records located` · `Denied` · `No response`) plus four the law adds
  (`Non-payment`, `Withdrawn by requestor`, `Previously furnished`, `Not in our custody / referred`).
  **His "there might be others" was right; the child side needed no change at all.**
- **DELIVERY IS A CHILD FACT** — *"mrr types should be delivered asap when fully processed."* A parent-level
  `Delivered` is a lie the moment one child of five is still in redaction, and it invites holding four finished
  records hostage to the fifth — which §5.9's coverage test forbids anyway.
- **STAGE IS A CHILD CONCEPT** (confirmed) — an MRR's children sit at different stages simultaneously, so a
  parent-level stage would have to lie about all but one. This also **corrects my previous entry**: I called the
  parent "stateless" as though nulling `stage` created a gap. It did not — §4.4 always had `parent_state` as
  **derived, not stored**. `stage = NULL` on a parent is correct. Only the derivation is unbuilt, and it needs
  no column.
- **Deliberate deferral:** *"This was all poorly designed in the first build and I don't want to by default carry
  that bad design over… get the new schema working then later make a pass."*

### Shipped (docs only — no columns existed, so no code changed)
§4.4 rewritten (parent = process status only; `outcome` + `withdrawn_reason` DEFERRED) · §6.1 simplified to two
values, with the retired five-value ladder parked and *why* each value went · §6.2 marked **DEFERRED / do not
build**, its design parked intact for the later pass.

**⚠️ §6.2(a) SURVIVES THE DEFERRAL AND IS ALREADY BUILT:** parent-level terminal events (unanswered clarification,
unpaid deposit, withdrawal) still **cascade DOWN** — each open child takes the matching §5.8 disposition and the
parent rolls up to `Complete`. `clarificationTimeout` already closes `COALESCE(master_request_id, id)`. Deferring
the parent's disposition FIELD changes none of that.

### Next (unchanged)
Portal emitting n children (#12) + retire `mrrChoice` · `source_request_id` attribution (§4.2.1) · MRR
classification roll-up (unspecified) · **the field-design pass Kevin parked** · MRR hub (§14.3 — design first).

---

## 2026-07-16 (f) — THE PORTAL EMITS n CHILDREN. MRR is real. 723/723. `20463a0`

`BUILD_PRIORITY` #12, and the payoff for the wrap. **Until now every request was a parent with exactly ONE
child** — a citizen describing body-cam footage AND a building permit got one blob of text in one row, routed to
one department. Now each described record is its own child, finishing independently, while the citizen keeps ONE
number, ONE fee, ONE deadline (§13 Layer 1/3).

### Built
- **`createRequest({ children: [{description, componentLabel}, …] })`.** A single record is **not a special
  case** — it is n = 1 down the identical path. Children numbered `-1..-n`, `child_no` 1..n never 0, each
  carrying `component_label` (a column that had existed unused since the beginning).
- **`is_mrr` is DERIVED** (`child_count > 1`) and lives on the **parent** (§4.1). The classifier's and the
  portal's `isMrr` flag is **advisory only** — what the citizen described decides. `isMrr:true` with one
  description is ignored.
- **`POST /public/submit` accepts `records: [{label, description}]`** (or `descriptions: [...]`, or the old
  single `description`).

### 🚨 THE RETIRED QUESTION WAS STILL LIVE — six days
The agent was **still asking citizens** *"a single combined request or two separate requests?"* The specs retired
it **2026-07-10**, but **that commit changed no code** (`20ff869` — "Spec/design only"), and "separate" performed
no split anyway, so the answer was collected and discarded. Phase 3 now works records **one at a time** and keeps
each description self-contained. `mrrChoice` is gone from the SUBMIT_READY schema. **This is the second time
today a 07-10 spec-only commit turned out to have left live code contradicting the contract.**

### 🚨 THE PORTAL ROUTE WAS THE REAL BUG
It passed `kickIntake:false` and did its own wiring: classify **`b.description` once**, then
`onIntake(made.id)` — **the FIRST child only**. The moment the portal could describe n records, every child after
the first was left **unclassified, unrouted, in nobody's worklist, silently** — the exact silent-orphan shape its
*own* AI-outage fallback exists to prevent (the 2026-07-14 credit-outage fix), reintroduced by a different path.
Classify + `applyClassification` + history + the `routing_review` fallback now all run **per child**, off each
child's own description; one failing child never strands its siblings.

**Intake fires SEQUENTIALLY in one background chain, not n parallel ones.** Each `onIntake` is an Anthropic call;
firing them together rate-limited and **silently lost a child** (observed in the harness). A 10-record MRR would
have fired ten at once.

### Evidence
- **`verify_mrr_children` 36/36** (new): 3 records → 3 children with their own descriptions/labels/numbers ·
  `is_mrr` derived on the parent, 0 on every child · **ONE clock and ONE deadline for all 3, zero clocks on any
  child** · the scope predicates hold at **n=3** (only ever proved at n=1) · the real portal accepts `records`
  and routes both children independently · n=1 is the identical shape · a blank child description is refused
  **naming which one**, with no orphan parent.
- **SUITE 723/723, GREEN TWICE CONSECUTIVELY, LIVE UNTOUCHED.** **Break-tested:** ignoring the `children` array
  → red; routing only the first child → reproduces the live bug exactly (`1 / 0`).
- **LIVE-VERIFIED, real `POST /public/submit` with 3 records:** parent `2026-000001` (`is_mrr=1`, no stage,
  **1 clock**, 0 tasks) + children `-1/-2/-3` (`permits` / `body-cam` / `minutes`, `is_mrr=0`, **0 clocks each**,
  **1 task each**, all showing the same deadline `2026-07-26`), each keeping its own description. Purged after —
  live is back to 3 infrastructure rows, 0 citizen requests.

### ⚠️ TEST-DESIGN DEFECTS FOUND IN MY OWN HARNESSES
- **`classifier.js` calls Anthropic (`claude-sonnet-4-5`)**, so whether a description routes *confidently* — and
  whether a task spawns — **varies run to run**. `verify_wrap_parent` passed 39/39 and then failed on identical
  code. Both harnesses now assert what is true on **every** path: intake ran per child, and everything it
  produced landed on a child, never the parent. **Do not assert on classifier confidence.**
- **An intermittent red, now fixed:** `verify_deposit_clock`'s re-receipt assertion is `started_at > bStart1`, a
  **strict** compare on **second-granularity** timestamps (`nowStr()` truncates). Inside one second the restarted
  value came back byte-identical and it failed on correct code. Waits out the second rather than weakening to
  `>=`. (`verify_stage_bypass` flaked once too and was **not** diagnosed — watch it.)

### KNOWN, FLAGGED, NOT FIXED
**n children = n sequential classifier calls before the 201.** Fine at n=1; a large MRR means minutes of spinner.
Needs batch classification or classification moved behind the response. **This is a design input for Kevin's
portal redesign, not a backend fix to guess at.**

### Next — KEVIN IS DESIGNING THE PORTAL UI (his call, 2026-07-16)
He is redesigning the portal to be friendlier and to let AI pass a request with **a large number of child
records**. Per the UI rule, that design comes before any more portal work. The backend is the substrate and is
done. **Do not build portal UI until the design is agreed.**
Also open: `source_request_id` toll attribution (§4.2.1 — now meaningful) · MRR **classification roll-up**
(the parent copies its single child's `classification`; MRR needs a worst-case rule — **unspecified**, §6) ·
the MRR hub (§14.3) · Kevin's parked **field-design pass**.

---

## 2026-07-16 — The queue speaks parent/child (§7 BUILT). `f2ca778`

**Slice:** rebuild the request queue to render the new schema, and move the `Open` control to the left of the
parent line (Kevin, "for the moment").

**§7 was already the ratified contract** — "every request renders as a parent line with its children indented
beneath it; when `child_count = 1` the pair collapses to a single line and the `-1` suffix is hidden." This slice
built it; it was not a new design.

### The bug this exposed — the queue was LEAF-scoped and still wrong
Yesterday's scope predicates made the queue list the right ROWS. It then read four **PARENT** facts straight off
them. That was invisible until children actually existed, because `andLeaf`/`andParent` were tautologies against
a childless table. **A query that looks correct against pre-migration data can still be wrong now** — this is the
general lesson, and the dashboard/ARIA/AppLayout/tickler have not been checked for it.

- **`request_number`** — a child's number carries the component suffix. The queue showed staff **a number the
  citizen has never seen and cannot quote on the phone.** Resolved through the parent; the child's own number
  survives as **`component_number`**.
- **`is_mrr`** — DERIVED and PARENT-level (§4.1), and `requestCreate` forces `is_mrr = 0` on **every** child. The
  MRR badge **could not render. Not rarely — never.** Resolved through the parent.
- Added **`parent_id`** (grouping key) and **`child_count`** (the collapse test).
- **Order** now keys on the PARENT's recency then `child_no` ASC. The children of one request are inserted in a
  single loop milliseconds apart, so ordering by the child's own `created_at` put an MRR's records on screen
  **backwards (-3, -2, -1)** — seen in the first screenshot, not reasoned about.
- **Search** matches the citizen's number and returns the whole request.

### Frontend
Parent line + indented children, collapsing at `n = 1`. Counts are of **requests** (a 3-record MRR is one request,
not three); stage pills stay per-child on purpose. The parent line carries only what a parent HAS — number,
requestor, deadline, and the two-value process status (§6.1). **Classification / team / assignee render `—`**:
they are child facts and an MRR's records differ on all three, so the parent line must not pick one child and
imply it speaks for the rest.

### The one thing left open — `Open` on an MRR parent `[NEEDS KEVIN]`
At `n = 1` (collapsed) `Open` targets the child, exactly as before the wrap. **On an MRR parent line there is
nothing to open yet**: the hub (§14.3) is design-gated and unbuilt, and the v1 workspace expects a WORK row —
pointing it at a parent renders a screen with no stage, no description and no team. It is a **disabled `Hub —`
placeholder**. §14.3 says the hub and the queue "must be designed together"; this is the queue half, and the hub
half is Kevin's next call.

### Verified
- `verify_queue_parent_child` (21) — new, registered in `run_suite.js`. Pins the shape, and the **implicit** bit:
  `r.*` emits `request_number`/`is_mrr` and the parent-resolved aliases win **only** because node-pg keeps the
  LAST duplicate column. Real driver behaviour, but implicit — asserted, not trusted.
- **Suite 744/744, live untouched.** Green before and after the break-test.
- **Break-tested both bugs** (committed green first): reading `request_number` off the child → 3 reds naming the
  leaked `2026-010054-1`; reading `is_mrr` off the child → exactly 1 red, the MRR badge. Restored, no diff.
- Screenshotted the rendered queue.

### Live data — I ADDED TWO REQUESTS
Kevin purged all test data yesterday; the queue was empty and could not be verified against nothing. I seeded
**through the real path only** (`POST /api/public/submit`, per the seed rule): **`2026-000001`** (n=1, permits) and
**`2026-000002`** (n=3 MRR — body-cam / use-of-force / overtime). Live is now **2 parents + 4 children + the 3
infrastructure rows**. Purge with `backend/src/db/purge_test_requests.js` (dry-run by default, `--apply` to
commit) if they are not wanted.

### Flagged, NOT fixed (out of slice)
- **`verify_stage_bypass` is a CONFIRMED recurring flake** — `1: stage = closed, status = closed` (line 100) and
  line 152. It flaked once on 2026-07-15 (undiagnosed) and again today during a break-test run, then passed on
  the next two runs of identical code. **Twice in two days is a pattern, not a one-off.** Undiagnosed; likely the
  same class as the `verify_deposit_clock` red fixed in `9a363ed` (a strict compare on second-granularity
  timestamps). Deserves its own slice — a suite that goes red at random trains people to re-run it, which is how
  a real red gets waved through.
- **The dashboard, ARIA reports, the AppLayout badge and the tickler all still read parent facts off leaf rows.**
  They consume the same `GET /requests` (so they inherit the number/`is_mrr` fix for free) but **none of them
  group by parent** — the dashboard's recent-requests table will show a 3-record MRR as three lines. The tickler
  is independent (`GET /tickler/status`, `routes/tickler.js`) and selects `request_number` straight off the leaf,
  so **it still shows suffixed numbers.** Not touched — one bounded slice.
- `CLAUDE.md` said "Parent/child is DESIGNED, NOT BUILT" — **fixed in this commit** (it was actively lying to
  every fresh session, which is the exact failure that cost 13 sessions). Now records what is built and adds the
  read-through-the-parent rule.
- Still open from yesterday, unchanged: the three record-list representations in the submit payload
  (`description` / `records` / `searchIntents`), `searchIntents.persist` writing every intent against the FIRST
  child, `source_request_id` toll attribution (§4.2.1), MRR classification roll-up (§6), suggest-vs-commit
  routing (§14.2 — children currently auto-commit).

### Environment note
**PM2 runs as ROOT** (`/root/.pm2`), so `pm2 list` as `optimumq` prints an empty table and `pm2 logs` is
unreadable without sudo (which needs a password). Killing the `server.js` pid IS a valid restart — PM2 respawns
it within ~2s with fresh code. Don't `nohup node server.js` after killing: you race PM2 and lose to `EADDRINUSE`.
