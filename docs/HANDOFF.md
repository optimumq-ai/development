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

---

## 2026-07-18 — Portal wizard redesign: §0 invariant locked + five gaps resolved (DESIGN, no build)
**This session was design, not build.** Kevin shared 9 Excel wireframes (`uploads/screen*.xls`) + a flow
narrative (`uploads/portal flow and screenshots.doc`) for a **wizard / one-item-at-a-time** portal redesign.
Pulled them from GitHub (org repo `optimumq-ai/development`, `main` — the raw files were reachable via the
contents API + raw URLs even though the local mirror hadn't fetched the web-UI commit; `gh` is not installed),
converted with libreoffice, read all. **No product code changed — docs only, nothing to verify in the app.**

### Committed & merged to main — the §0 invariant (`ce44ee5`)
`SPEC_public_portal_intake.md §0` — **the request is born only at Submit.** The whole intake flow is client-side
state until `POST /public/submit`; the request row, the statutory clock, and every side-effect are created in ONE
transaction there. Verified in code: single birth site (`createRequest`, `publicChat.js:374`), stateless
`/public/chat`, read-only searches, clock starts at creation (`tolling.startClocks`). **Consequence — abandonment
is a NON-EVENT:** a started-but-abandoned session never becomes a row, so there is nothing to identify as
abandoned or "forget" — no `draft` status, no reaper, no orphan cleanup. **Mid-loop writes are BARRED** (a child
routed to a worklist before Submit would strand an orphan the instant the tab closes). Save-and-resume, if ever
adopted, ADDS a clock-less `draft` status + a reaper — `[FUTURE — DEFERRED]`, not to be added implicitly.

### The five gaps I found in the wizard flow, walked one at a time, resolved → SPEC `§2c [DECISION — LOCKED, NOT BUILT]`
The wizard **reuses** the existing intent model (§2.4 PATH a/b fork + §2b R9 dispositions) — it does not invent a
parallel one. Resolutions:
- **G1** — split the misleading single "NO MATCHING RECORDS LOCATED" into **Case A** (not-searchable PATH b — no
  search ran, records may exist, staff search by hand) and **Case B** (searchable PATH a, 0 hits). Chosen
  automatically by the PATH a/b classification + result count; both lead with the team-search CTA.
- **G2** — shared phrase **"Open Records team search"**, two intents: `no_match_search` (no-match) vs
  `search_more` (**"Also search…"** on the match screen — additive). Short **"Team search"** badge.
- **G3** — per-record selection (as built §2b); completion button reworded to **"Use selected records — item
  complete"** (`complete`), enabled at ≥1 checked; a **transparency line** that results may be partial (the
  digitized-vs-paper scenario — select digitized records AND `search_more` for suspected paper ones).
- **G4** — **"Remove item"** on ALL results screens (= the substitute for "revise"); confirm-before-remove;
  **empty-request guard** — Submit disabled until ≥1 kept item. Free under §0 (drops client state only).
- **G5 + comms policy** — **email is the SOLE communication channel; postal = records-DELIVERY only.** Dropped
  Screen 1's self-contradictory "visually verified / no email access" fallback. On-screen **request number is
  authoritative** (email is a copy). **Mandatory link-click verification, STRICT gate (option A), no skip** —
  the round-trip is ALREADY built (`/request-verification` → `/verify/:token` → `/verify-status` poll); the work
  is removing the skip paths, wiring the gate, a "Resend link" button, and a template wording fix. `[FUTURE]`
  Print/Save-PDF confirmation deferred to v1.1. **Assumption to keep conscious:** the city must maintain a real
  non-portal intake channel (equal access) — the email-only portal is defensible *because* that lane exists.

### Reconciliation STILL OPEN — the real next design call
**The wizard (§2c) vs the LIVE split-canvas flow (§2b).** The wizard reuses §2b's R9 intent model but is a
different UI (full-screen, one-item loop) vs. split-canvas (Phase-0 form + chat panel). Cut-over is a separate
design decision, NOT made this session. Until it is, §2c is the wizard's contract, not a replacement of §2b.

### Next
Reconcile wizard vs split-canvas; then the wizard is buildable against §2c (per the UI rule, design is now
agreed — but the reconciliation gates it). **Unchanged from prior sessions:** the dashboard / ARIA / AppLayout
badge / tickler still read PARENT facts off leaf rows (tickler shows suffixed numbers); `verify_stage_bypass` is
a CONFIRMED recurring flake; MRR classification roll-up (§6, unspecified); `source_request_id` toll attribution.

---

## 2026-07-18 (b) — Reconciliation RESOLVED: the wizard is the target shell
**Kevin's call — build the wizard.** Usability-driven, not cost-driven. Ran a reusability audit of the built
split-canvas (`PublicPortalV2Page.js`, 1093 lines, self-contained) against the §2c wizard target first:
- **~⅓ CARRIES** shell-independent — the API layer, the **submit-payload assembly** (`577–635`), selection /
  refine / passed-over logic, verification *data-plumbing*, validators, and the **3-layer design palette** (CSS
  custom properties, portable). The risky core survives untouched.
- **~¼ REWORK** — form fields re-laid into the "Your Information" step; the "another record?" loop → the Item
  1..10 column; the passive stepper → a real progress-bar driver.
- **~40–45% REBUILD** — the morphing canvas / docked chat / 27% selected side-column / scrims / mobile toggle,
  and ~80% of the CSS. Mostly presentation — low risk.
- **NEW (absent today):** progress-bar that *drives* steps, the Item 1..10 color-state column, the agent
  HIDING after search, Case A/B honest no-result screens, whole-item "Remove item".
- **⚠️ Surprise:** today's email verification is a **SOFT gate** — it fires the send but **never polls** and has a
  **"Visually verified" bypass needing no email at all** (`655–672`, `780–795`). §2c's strict link-verify gate is
  therefore new *client* work regardless of shell — but the **backend endpoints already exist** and are uncalled
  (`/verify/:token`, `/verify-status`, `publicChat.js:533–554`). Frontend wiring, not backend build.

Recorded: SPEC §2c intro now marks the wizard as the **ratified target shell**; §2b tagged **SHELL SUPERSEDED**
(logic/palette = reuse substrate), still live at `/portal/request` until the wizard replaces it.

### Next
Per the UI rule, agree the wizard design concretely before building React. Kevin thinks in usability/visual
terms — the proposed next step is a **clickable HTML prototype of the reconciled wizard** (progress bar · Screen 1
with the strict verify gate · Item 1..10 column · results window with the two buttons + Remove · Case A/B ·
Submit-or-Continue · on-screen confirmation number) so he can *see and click* the design, then build for real
against it. **Not started — awaiting his go on scope.**

---

## 2026-07-18 (c) — Clickable wizard prototype built + served at `/prototypes/`
Kevin greenlit the full prototype. **Design-review artifact, not app code.**

**The prototype** — `docs/mockups/portal_wizard_prototype.html`, one self-contained file (no external CSS/JS/fonts;
system + Georgia type; project's 3-layer surface palette + civic blue `#1F4E79`; both themes). Every §2c decision
is wired and clickable: the corrected progress rail (Begin · Your Information · Item Search · **Submitted**),
Screen 1 with the **strict link-verify gate** (email → simulate-link-click → rest unlocks) and email-only comms,
the **Item 1..10 color-state rail** (amber active / green complete), the assistant-then-**hide** item loop, the
**match / Case A (not-searchable) / Case B (no-match)** branches auto-picked, per-record selection + "Also search
with the Open Records team", **Remove item** with confirm, the **empty-request guard**, and the on-screen
confirmation number. A **"Design notes" toggle** annotates each §2c rule (doubles as a review tool). Search
outcomes + email verification are **simulated** (no backend) — the outcome picker is a clearly-labeled backstage
control. Also published as a private Artifact (same file).

**Prototype gallery, served with NO React rebuild.** nginx docroot is `frontend/build/`; dropping static files
there serves them directly (SPA `try_files` yields to real files on disk). Short URLs:
- **`/prototypes/`** — gallery index (add a card per new prototype)
- **`/prototypes/portal-wizard.html`** — the wizard
Live copies live in `frontend/build/prototypes/` (gitignored, ephemeral); **source copies committed in
`frontend/public/prototypes/`** survive future CRA rebuilds. *Adding a nav-panel link would need a full rebuild
each time — rejected for the 30s/repeatable bar; the static gallery scales without rebuilds.* **To add a
prototype:** save HTML to `frontend/public/prototypes/`, drop a live copy into `build/prototypes/`, add a card to
`index.html`. Remove the two `prototypes/` folders to tear the whole thing down.

**Fixes after first look (Kevin's feedback):**
- **Encoding:** the raw-served copy has no `<meta charset>`, so UTF-8 glyphs mojibake'd (`—`→`â€"`, `✅`→`âœ…`).
  Replaced all 67 non-ASCII glyphs with **HTML entities** (ASCII, encoding-agnostic) — renders right whether
  Artifact-wrapped or served raw. Served response verified **0 non-ASCII bytes**. Apply this to every future
  prototype that will be nginx-served.
- **Sim control** split out from the real "Run search" action into a dashed amber **"Prototype control — not
  shown to requestors"** backstage box.
- **Delivery copy:** the records-delivery step now leads with "Communications about your request will always be
  by email" and scopes the radios to records delivery only (reinforces §2c G5).

Commits (all on `main`, pushed): `3a2131f` prototype · `18bf6f9` gallery · `d62265a` encoding+backstage ·
`bcf36f4` delivery copy. **Kevin's verdict: "you nailed it" — screens/flow/layout good.**

### Next
Kevin plans to rebuild/modify several screens against the prototype. Either (a) he marks up screens → fold into
§2c + reflect in the prototype, or (b) green-light the real React build against §2c, reusing the ~⅓ carry-over
core (submit-payload assembly, search/selection logic, verification data-plumbing, palette) from split-canvas.
**Unchanged backlog:** dashboard/ARIA/AppLayout/tickler leaf-fact reads; `verify_stage_bypass` flake; MRR
classification roll-up (§6); `source_request_id` toll attribution.

---

## 2026-07-18 (d) — Prototype APPROVED; wizard build gate cleared
Kevin thumbs-upped the prototype after the completed-progress-node contrast fix (`10b17ac` — boxed bolder-green
`--done-box`). **The UI-rule design gate is CLEARED** — SPEC §2c retagged `[DESIGN APPROVED — build gate cleared,
NOT BUILT]`. He also confirmed the architectural rationale in review: the structured form is easier for humans
AND shrinks the agent's job to descriptions only (fewer turns, no free-text identity parsing, smaller error
surface). Recorded in §2c.

**Next is the real React build of the wizard**, sliced (one bounded slice per session, split-canvas stays LIVE
at `/portal/request` until cutover). Proposed sequence — build behind a new route/flag, cut `/portal/request`
over only when whole:
1. **Shell + progress rail + step routing** — the full-screen stepped shell; palette/tokens carried.
2. **Screen 1 "Your Information" + STRICT verify gate** — port form fields; wire the real link-verify
   (`/request-verification` → poll `/verify-status`), delete the visual-verify bypass, email-only delivery copy.
   *(Biggest new behavior; backend endpoints already exist.)*
3. **Item loop + Item 1..10 color rail** — agent-describe panel that hides after search; wire `/public/chat`.
4. **Results + selection + intents** — match (per-record select, complete/search_more), Case A/B
   (not_searchable/no_match_search), Remove item + confirm. Reuses selection/refine logic + R9 intents.
5. **Submit-or-Continue + confirmation** — empty-guard, carried submit-payload assembly, on-screen number.
Also: enforce the **10-item cap** in `createRequest` (backend, not enforced today); decide whether R9 intent
persistence (`request_search_intents`) lands with slice 4 or later (§0 keeps it client-side until submit anyway).
**Awaiting Kevin's go on slice 1.**

---

## 2026-07-18 (e) — WIZARD BUILT: all 5 React slices shipped at `/portal/wizard`
Built the whole §2c wizard, one bounded+verified slice per turn, behind a NEW route `/portal/wizard`
(`frontend/src/pages/PublicPortalWizardPage.js`, scoped `.pwz`, both themes, palette carried from the prototype).
**The live split-canvas at `/portal/request` is untouched** — cutover is a separate decision, NOT done.
Each slice verified in the running app with Playwright screenshots (public route, no auth needed).

- **Slice 1 (`63a33fb`)** — shell + progress rail (Begin·Your Information·Item Search·**Submitted**; boxed
  higher-contrast green done nodes) + step routing.
- **Slice 2 (`42fdd04`)** — "Your Information" + the **STRICT link-verify gate**: send link →
  poll `/verify-status` → unlock; no visual fallback, no skip (§2c G5). Email-only comms; postal→address gating.
  Caught+fixed a bug in-screenshot (lockfield dim never lifted on verify).
- **Slice 3 (`6688c28`)** — item loop: Item 1–10 color rail + assistant-describe panel (`/public/chat`,
  split_canvas contract); agent HIDES on search.
- **Slice 4 (`65bbaf1`)** — results window: MATCH (per-record select + Selected column + transparency line +
  "Use selected — item complete" / "Also search with the Open Records team"), CASE A (not-searchable) & CASE B
  (0 results) honest screens, "Remove item" + confirm. R9 dispositions/badges.
- **Slice 5 (`6bfaf83`)** — Submit-or-Continue (empty-request guard) + real `/public/submit` + on-screen
  confirmation number. **Live contract proven:** one real submit → HTTP 201, MRR (1 parent + 2 children),
  then surgically purged (live back to 9 requests, untouched). Payload asserted: records=n, isMrr, searchIntents
  [complete,no_match_search], selectedRecords, emailVerificationMethod='link', submissionChannel='portal'.

### 🚨 OPEN / BLOCKERS
- **Anthropic API credits exhausted** — `/public/chat` 500s ("credit balance too low"). This breaks the LIVE
  portal chat (split-canvas AND wizard) and intake classification, not just tests. Slices 3–4 were verified by
  mocking `/public/chat`. **Restore credits before any live portal use/demo.** (Env/billing, not code.)
- **Case-B backend signal** — the wizard reads `searchResults:[] + searchQuery` as "searched, 0 results" (Case B).
  Split-canvas today routes 0-result searches back to chat, so confirm/adjust the backend emits that signal once
  credits are back.
- **10-item cap** not enforced in `createRequest` (backend) — wizard caps the UI only.
- **`emailVerificationMethod:'link'`** is a NEW value (was {attested,visual}); live submit accepted it (no CHECK
  constraint), but note it for the spec.

### Next
Kevin to click `/portal/wizard` end-to-end and mark up anything. Then: the cutover decision (point
`/portal/request` at the wizard), backend Case-B signal + 10-item cap, and restore Anthropic credits.
**Unchanged backlog:** dashboard/ARIA/AppLayout/tickler leaf-fact reads; `verify_stage_bypass` flake; MRR
classification roll-up (§6); `source_request_id` toll attribution.

---

## 2026-07-18 (f) — PORTAL LIVE: cutover + live smoke + go-live hardening. The wizard is done.
The §2c wizard is now **the live public request portal at `/portal/request`**, verified end-to-end against the
real agent. Sequence this session (all on `main`, pushed):
- **Cutover (`03d227b`)** — `/portal/request` → wizard; split-canvas kept at `/portal/split-canvas` for rollback;
  `/portal/wizard` + `/portal/v2` redirect to canonical. Spec §1/§2b/§2c updated.
- **Anthropic credits RESTORED** (Kevin added payment) — `/public/chat` works again; live-confirmed with real
  agent replies. The slice-3/4 blocker is gone.
- **FULL LIVE SMOKE PASSED** at `/portal/request`, no mocks: real verify → real 2-turn agent conversation → real
  search (6 real building-permit records, "Available now · Library" tags) → select → complete → real
  `/public/submit` → request `2026-000003` (n=1) → purged (live back to 9).
- **Live-smoke fix (`6241bcc`)** — the smoke revealed the semantic search **always returns nearest-neighbor
  records (never empty)**, so the auto Case-B (empty `searchResults`) screen rarely fires. The real "no match" is
  the requestor selecting NONE from populated results = R9 `no_match_search`. Match screen now: **0 selected →
  "None of these match — submit for Open Records team search"** (`no_match_search`); ≥1 → complete + search_more.
  Case-B auto-screen kept as a rare fallback.
- **Go-live (`ec21062`)** — server-side **10-item cap** on `/public/submit` (`MAX_PORTAL_ITEMS=10`; 11 → 400;
  scoped to the portal path, not `createRequest`, so staff/connector/import aren't affected) + **removed the
  "Preview build" tag**. Cap-test requests purged (live back to 9).

**⚠️ Process note:** restarting "the API" by `pgrep -f server.js | head -1` killed a CONNECTOR, not the backend —
so the cap test ran against stale code (looked like the cap didn't work). There are FOUR server.js (backend +
3 connector stubs); always target `pgrep -af "backend/server.js"`. Memory [[db-access-workaround]] updated.

### State: the portal is DONE and production-ready
Built (5 slices), cut over, live-verified end-to-end, hardened. Split-canvas remains at `/portal/split-canvas`
for rollback (revert `03d227b` to fully roll back). **Unchanged backlog** (untouched all session): dashboard /
ARIA / AppLayout badge / tickler leaf-fact reads; `verify_stage_bypass` flake; MRR classification roll-up (§6);
`source_request_id` toll attribution. Optional portal follow-ups: retire split-canvas once confident; R9
`request_search_intents` persistence (still client-side-until-submit per §0).

---

## 2026-07-18 (g) — All 4 intake dimensions smoke-tested live; commercial→purpose gap closed
Live end-to-end smokes at `/portal/request` (real agent, real submit, verified in DB, purged after — live steady
at 9 rows throughout). Each drove the wizard through a real 2-turn agent conversation → real search → submit.
- **Email delivery** — covered by (f)'s live smoke.
- **Postal delivery** ✅ — address block gates Proceed (empty → disabled); on submit the parent persisted
  `delivery_method='mail'` + all five `mailing_*` fields (state auto-upper-cased `tx`→`TX`).
- **Fee waiver** ✅ — `fee_waiver_requested=1`, `fee_waiver_reason` captured verbatim, `fee_waiver_status=null`
  (undecided → staff), `requestor_type='individual'`.
- **Commercial** ✅ — `requestor_type='commercial'`, `fee_waiver_requested=0`.

**Gap the commercial smoke found + FIXED (`97a0764`):** the wizard captured `requestor_type='commercial'` but
`purpose` stayed null, so the staff estimate would not default to commercial (§5). Frontend-only couldn't fix it
— `/public/submit` never forwards `purpose`. Fixed at the ONE creation helper: `requestCreate` now derives
`purpose='commercial'` from `requestor_type='commercial'` (explicit `f.purpose` still wins), covering ALL paths
(wizard/form/connectors). Re-verified: commercial→`purpose='commercial'`, individual→null (no regression).
**Full suite GREEN 743/0, live untouched.**

**No portal work remains open.** All four intake dimensions (email/postal delivery, waiver, commercial) are
proven against the live system. Backlog unchanged from (f).

---

## 2026-07-18 (h) — verify_stage_bypass flake DIAGNOSED + FIXED (`5062b67`)
The long-flagged intermittent red (`1: stage = closed, status = closed`, lines 100/152) was NOT a timestamp
compare (the old guess). **Root cause:** `/public/submit` kicks `onIntake` in the BACKGROUND; its classifier
call takes seconds, and `onIntake` applied the routed stage off the request row it read at the TOP of the
function. When the harness closed the request (nonpayment close / tickler withdrawal) *before* that slow intake
landed, the late `onIntake` re-routed it OUT of `closed` — `applyStageTransition` has **no from-closed guard**.
Pure timing-on-classifier-latency, hence "2× in 2 days, passed on reruns."

**Fix (product):** `workflowEngine.onIntake` now re-reads the CURRENT status right before mutating and bails if
the request went `closed` — a terminal request must never be revived or left with claimable tasks by a late
background router. Scoped to the one background router; explicit reopen/reissue paths unaffected.
**Fix (test):** made it DETERMINISTIC — `verify_stage_bypass` now forces the exact late landing (`onIntake` with
a stub matcher, no Anthropic) right after the close and asserts it stays closed with no task spawned. No timing
dependence anymore. **Break-tested:** disabling the guard → the new assertion goes red (9/11); restored.
Suite GREEN **745/0** (verify_stage_bypass 26/26), live untouched.

### Remaining backlog (now one item lighter)
dashboard / ARIA / AppLayout badge / tickler leaf-fact reads; MRR classification roll-up (§6);
`source_request_id` toll attribution. (`verify_stage_bypass` flake — DONE.)

---

## 2026-07-18 (i) — Portal COSMETIC PASS (Kevin-driven), plural cleanup, CLAUDE.md restart fix
Kevin-driven tweak pass across the three public surfaces. No behavior, contract, or schema change — copy, CSS,
and one prompt string. All on `main`, pushed. Suite GREEN **745/0**, live census clean.

- **Begin screen (`2222914`)** — six tweaks in one commit:
  - **Deleted the "Coming in a later slice." box** — slice-1 dev scaffolding that had been shipping to the
    PUBLIC Begin screen since the build. Kevin spotted it; it was never intended UI. Dead `STEP_META.stub`
    fields and `.stub` CSS removed with it.
  - Header left now uses the **`/portal` landing brand block** (OQ mark + agency name + descriptor), replacing
    the Georgia crest. Agency name now READ FROM `/requests/public/config` like the landing/library headers
    instead of the hardcoded `AGENCY` const (the chat greeting uses it too, so a city rename propagates).
  - Header right: **library cross-link** — "Check for records ready for immediate download" + a
    **Public Records Library** button → `/portal/library`, laid out SIDE BY SIDE (the library page stacks
    them, which runs taller than needed). This reciprocates the library's link back, closing the loop between
    the two public surfaces and steering requestors to an instant download before opening a formal request.
  - Progress rail: two-line "Progress Indicator" caption, nodes shifted right.
  - H1 switched serif → the sans stack used by the library headings. Serif retained for the confirmation
    number and modal/bigstate headings.
  - New Begin paragraph steering to the Records Library, carrying the certification caveat.
  - **Implemented against the `.pwz` tokens, NOT the hardcoded hex the other public pages use** (`--civic`
    *is* `#1F4E79`), so light matches `/portal` exactly and the wizard's dark mode still works. Both themes
    screenshotted.
- **Placeholders (`0d86ec2`, `bf609ec`, `663b8e2`)** — name/email/phone used specimen values ("Jordan Rivera",
  "you@example.com", "(555) 555-0134") that read as prefilled data. Now instructions: "First and Last name",
  "Email address", "Phone number". (Address/waiver/chat fields were already instruction-style.) An interim
  "Email address (immediate verification required)" was reverted — the intro copy and the adjacent
  "Send verification link" button already carry that.
- **Landing + library (`2b55bf8`)** — `/portal` welcome H1 orphaned "Portal" on its own line; explicit `<br />`
  after the agency name so it always splits at a meaningful point (break is agency-name-agnostic). Library
  header CTA "Open Records Portal" → **"Open Records Request"** (it opens the request flow, not a chooser).
  Width was the stated worry; the new label is ONE character longer, so the button is unaffected.
- **Plural cleanup (`fd86b96`, `12329f3`)** — wizard greeting "Open Record Search" → "Open Records Search",
  then the **system prompt** in `publicChat.js` ("You are the AI Open Record Assistant") → plural. The prompt
  one matters more: it sits upstream of everything the agent GENERATES, so the singular could surface in live
  replies, not just fixed copy. Prompt text only — no behavior/routing/contract change.
- **CLAUDE.md restart command (`26ca44a`)** — see below.

### 🔧 CLAUDE.md was WRONG about restarting the API — now fixed
`pm2 restart optimumq-api` **does not work** from the `optimumq` shell: the API runs under the **root** PM2
daemon (`/root/.pm2`) and `pm2` as `optimumq` talks to a different PM2 home, so it reports "Process or Namespace
not found"; `sudo` needs a password. Documented command is now
**`kill $(pgrep -f "^node /opt/optimumq/backend/server.js")`** (PM2 respawns in ~5s), with the `^node` anchor —
an UNANCHORED `pgrep -f "backend/server.js"` matches both the shell wrapper running it AND the three connector
stubs (that's how (f)'s cap test ran against stale code). Also recorded: **`pm2 logs optimumq-api` as `optimumq`
silently tails NOTHING rather than erroring** — empty output must not be read as "no errors." Memory
[[db-access-workaround]] updated to match.

### Evidence
Every change screenshotted in the running app (Playwright, both themes where relevant): Begin light+dark,
step 2, landing at 1280+1024, library header, Item Search. Backend change ran the FULL suite (745/0, live
census clean: not one row moved in 12 tables), API restarted, and the running process confirmed to postdate
the edit so the new prompt is actually loaded. **No request was created and nothing was written to live** —
Item Search sits behind the verify gate, so the two verification endpoints were mocked CLIENT-SIDE in
Playwright rather than driving a real round-trip.

### Open / not done
- **Item Search observations, flagged to Kevin but NOT actioned** (his call, not defects): the item rail
  renders all **10 empty slots upfront** (eats the vertical space, implies you should fill them); the
  conversation opens with **two assistant bubbles** where one would do; large dead space in the chat log
  before any conversation exists.
- **Singular "Open Record" remains in `PublicPortalV2Page.js`** (lines 1043/1056) — the retired split-canvas
  at `/portal/split-canvas`, rollback-only. Deliberately untouched.
- **The plural prompt fix was NOT confirmed against a real agent reply** — the prompt forbids revealing its own
  instructions, so there's no clean assertion without burning credits on an ambiguous result. Evidence is that
  the string is loaded, not that a citizen has seen it.
- **Never screened:** Results and Submitted screens (Kevin has not marked them up).
- **Unchanged backlog:** dashboard / ARIA / AppLayout badge / tickler leaf-fact reads; MRR classification
  roll-up (§6); `source_request_id` toll attribution; retire split-canvas once confident; R9
  `request_search_intents` persistence (client-side until submit per §0).

---

## 2026-07-18 (j) — Wizard screen review (Kevin walked all 5); two real defects found + fixed
Continuation of (i). Kevin asked to SEE the remaining wizard screens; each was rendered in the running app and
reviewed. Two genuine defects surfaced out of that review (neither was a cosmetic ask) and both are fixed.
All on `main`, pushed.

### How the gated screens were rendered — no live writes
Item Search / Results / Submitted all sit behind the STRICT verify gate, and Submitted normally requires a real
submit. Rather than create live requests and purge them (the (e)–(g) pattern), the gate was mocked
**client-side in Playwright** (`page.route` on `/public/request-verification` + `/verify-status`), and for the
confirmation, `/public/submit` too. **Nothing was written to live all session.** `/public/chat` was left REAL —
Results was driven through a genuine 2-turn agent conversation and a genuine semantic search. The confirmation
number shown in those screenshots (`2026-000042`) is FAKE; the real submit contract stays proven by (e)/(f).

### Defects found + fixed
- **Postal requestors were told nothing about their confirmation email (`4c9d26b`).** The Submitted screen
  appended "We've also emailed a copy to you" only when `delivery_method === 'email'`. That contradicts §2c G5
  (email is the SOLE comms channel; delivery method governs only how RECORDS ship). **Checked the direction of
  the fix before making it** — `sendSubmissionConfirmation` (`publicChat.js:495`) fires on EVERY submit and has
  no delivery-method branch, so the copy was concealing a real email, not describing a real absence. Had the
  backend actually skipped postal, the correct fix would have been the opposite. Verified by driving the POSTAL
  path end-to-end, asserting the option was genuinely selected (`class="opt checked"`) and gating Proceed on an
  address — otherwise the screenshot would just have been the email path again. Spec §2c G5 updated.
- **Confirmation checkmark was a bare emoji (`166e8a1`).** U+2705 at `font-size:52px` — renders as a different
  platform glyph on macOS/Windows/Android, ignores the palette, and was the one element that looked pasted on.
  Now an inline stroked SVG check in a tinted disc built from the existing `--done` tokens, so it matches the
  rail's completed nodes and flips with the theme (verified in BOTH — the disc uses `--done-bg`/`--done-line`,
  which invert). Also gained `role="img"` + `aria-label="Submitted"`; the emoji was announced as "white heavy
  check mark," a decoration description rather than a status.

### Flagged to Kevin, NOT actioned — his call, not defects
- **Item rail renders all 10 empty slots upfront** (Item Search AND Results AND Submit-or-Continue) — eats the
  vertical space and implies you ought to fill them. Showing active + completed, with the existing "Maximum 10
  items per request" line carrying the cap, would be tighter.
- **Two assistant bubbles open the conversation** ("Thank you for using…" then "Please describe a record…")
  where one would do.
- **Large dead vertical space** in the Item Search / Results panels — records sit in the top third, actions are
  pinned low. Most noticeable when a search returns only 1–2 records.

### Worth knowing before any live demo
**The result set is not stable across runs.** The same query, phrased identically, returned 2 records on one
run and 1 on the next — the agent's generated search query varies slightly, and the search is semantic. Expected
behavior, but do NOT script a demo around a specific record appearing.

### Screens now reviewed
Begin, Your Information, Item Search, Results (both zero-selected and with a selection — the actions swap),
Submit-or-Continue, Submitted (light + dark). **All 5 wizard steps have now been seen and signed off**, versus
(e)–(f) where only the flow was proven.

### Backlog — unchanged
dashboard / ARIA / AppLayout badge / tickler leaf-fact reads; MRR classification roll-up (§6);
`source_request_id` toll attribution; retire split-canvas once confident; R9 `request_search_intents`
persistence (client-side until submit per §0); singular "Open Record" left in `PublicPortalV2Page.js`
(retired split-canvas, rollback-only).

---

## 2026-07-18 (k) — Two of the three (j) observations actioned; one left open
Kevin greenlit two of the three items flagged-not-actioned in (j). Both fixed, verified, pushed.

- **Item rail shows only completed + in-progress (`d5b9401`).** It rendered all 10 slots unconditionally, so a
  one-item request showed nine empty rows — it ate the column and, read as a checklist, implied the requestor
  ought to fill them. Bound to `items.length + 1`, clamped to `MAX_ITEMS`, with the +1 dropped when nothing is
  in progress. **That last clause is the non-obvious part:** a naive `items.length + 1` renders a phantom
  "Item n — in progress…" row on the Submit-or-Continue review screen and at cap. Verified across all FOUR
  states, not just the happy one: initial `1/active`, results `1/active`, submit-or-continue `1/done`
  (no phantom), after Continue `2/done,active`. The cap is still carried by the "Maximum 10 items per request"
  capnote.
- **One opening assistant bubble instead of two (`5f6584e`).** The panel opened with a greeting bubble followed
  immediately by "Please describe a record you're looking for." — two bubbles from the same speaker before the
  citizen has said anything, which reads as a stutter. Merged into one. **Kept the ask** as the closing
  sentence rather than dropping it as redundant with the "Describe a record…" placeholder: the system prompt's
  **ALREADY GREETED** clause asserts the citizen "was shown the opening greeting and asked to enter a
  description," and that clause is what stops the agent greeting again on its first turn. Deleting the ask
  would have falsified it, with a duplicate live greeting as the failure mode — the exact stutter being removed.

### Still open — the one Kevin has NOT called
- **Dead vertical space** in the Item Search / Results panels: records sit in the top third, actions pinned
  low. **Now more pronounced**, since the rail fix shortened the left column while the panel still runs full
  height. This is a LAYOUT change, not copy — per the UI rule, agree the direction BEFORE building.

### Reconfirmed this session
**The agent's result set is not stable across runs.** The first rail-verification run never reached results at
all — more clarifying turns than the previous run, for a byte-identical query. Second sighting (first in (j)).
Any scripted demo must tolerate an extra turn or two and must not depend on a specific record appearing.

### Verification posture (unchanged from (j))
Verify gate mocked client-side in Playwright; `/public/chat` REAL. **No live writes this session at all.**
Frontend-only changes — no suite run needed since (i)'s backend prompt commit (which was GREEN 745/0).

### Backlog — unchanged
dashboard / ARIA / AppLayout badge / tickler leaf-fact reads; MRR classification roll-up (§6);
`source_request_id` toll attribution; retire split-canvas once confident; R9 `request_search_intents`
persistence (client-side until submit per §0); singular "Open Record" in `PublicPortalV2Page.js` (retired
split-canvas, rollback-only).

---

## 2026-07-18 (l) — Item Search guidance modal + agent chrome (`beaaf42`)
Kevin's markup pass on step 3. Explicitly scoped by him as "close enough, revisit later" — NOT a finished
design. One commit, pushed.

- **"Click for detailed explanation" button** on the lede row opens a help modal. **Content was lifted from
  the source markups, not invented** — `uploads/portal flow and screenshots.doc`, the screenshot at the top of
  **p.2**. Covers: searches must be narrow and specific; **ONE description can legitimately return several
  matching records** (the point most likely to confuse a requestor); a second record TYPE must be a separate
  item; plus the honest caveat that paper / video-audio / email / miscellaneous record types cannot show
  immediate results and require Open Records team processing, though they remain submittable. Three typos in
  the source corrected ("othere", "algthogh", "Of courses"). Split into 3 paragraphs, caveat muted so the
  actionable advice leads. **It replaced the "Add up to 10 records" sentence** — the cap is already carried by
  the item rail's capnote, so nothing was lost.
- **Panel head collapsed to one label, "AI Powered Search Assistant"** — the `ASSISTANT` eyebrow plus
  "Open Records Assistant" said the same thing twice.
- **Placeholder → "Enter a description of the requested item…."** in a muted red. NOTE the source mockup used
  "Enter a descrption of the item request", so the wording tracks the original intent.
  **The red is a NEW `--ask` token, deliberately NOT `--danger`:** danger red on an empty input reads as a
  validation error before the requestor has done anything wrong. `--ask` is a desaturated brick that stands out
  from the neutral text without alarming. Themed — `#8C3A32` light / `#E0918A` dark.

**How to read the .doc** (no native reader here): `libreoffice --headless --convert-to pdf` in the scratchpad,
then Read the PDF with a `pages:` range. The instructional content lives in EMBEDDED SCREENSHOTS, not in the
document text, so text extraction alone (antiword/catdoc) would have missed all of it.

### Verification
Both themes. Asserted: panel-head text, placeholder text, **computed placeholder color in each theme**, modal
opens from the button and closes on "Got it". Verify gate mocked client-side — no live writes. Spec §2c updated
in the same commit.

### Open / not done
- **Help modal does NOT auto-open** on first arrival at step 3 — it is button-only. Trivial to change if wanted.
- **Dead space UNRESOLVED and now deliberately parked** — Kevin has **sent the portal to human testers** and
  wants their feedback before any layout change. Measured, annotated, and shown this session: **271px empty
  column** under the item rail (a consequence of (k)'s rail fix — the column did not shrink with its contents)
  and **177px empty panel band** between the greeting and the input row; on Results the panel void sits between
  the last record and the action buttons. Root cause is fixed-height layout (`.card` `min-height:280px`, panel
  sized for a full conversation). Three directions were offered: (1) size the panel to content — smallest,
  honest, but the panel visibly jumps as content lands; (2) keep the height and fill the column with something
  useful (what happens next, timeline, Library link); (3) rebalance the split — narrower rail, wider panel.
  **Do not act on this until the tester feedback is in.**

### Backlog — unchanged
dashboard / ARIA / AppLayout badge / tickler leaf-fact reads; MRR classification roll-up (§6);
`source_request_id` toll attribution; retire split-canvas once confident; R9 `request_search_intents`
persistence (client-side until submit per §0); singular "Open Record" in `PublicPortalV2Page.js` (retired
split-canvas, rollback-only).

---

## 2026-07-18 (m) — SCOPING ONLY: brief for rebuilding the request-processing flow
Kevin's next priority: the v1 processing UI is confusing, the schema moved under it, some task screens exist
and some don't. He proposed starting a new flow and mocking blank "click to approve" screens for the missing
task types. **No code written this session for it** — the deliverable is `docs/BRIEF_request_processing_flow.md`,
built from a LIVE inventory (DB census + backend sweep + staff-screen sweep), deliberately **not** from the
specs, because the specs are badly out of date on this domain.

### Headline: the spine is sound, the surface is not — his instinct checks out
`applyStageTransition` (`taskRouting.js:349`) is genuinely central: an exhaustive grep of `src/`, `server.js`
and `scripts/` found **exactly one `SET stage` in the whole codebase**, and all 16 callers go through it.
Stages have one source of truth with a parity-tested frontend mirror. **So this is a new surface over a working
spine, not a rewrite.**

### The trap in the stub plan — flagged before he starts
**`POST /tasks/:id/complete` has `requireAuth` and nothing else** — no ownership check, no type check, no stage
side-effect. Any authenticated user can mark any task done and strand its stage. It is exactly the endpoint a
click-to-approve stub would reach for, and every stub would *look* like it worked while quietly stranding
requests. **Stubs must go through `applyStageTransition`** so a blank screen is still a real node in the flow.

### Other repairs the brief says must land BEFORE new screens
- **The leaf-fact bug class — the concrete reason processing "feels impossible to sort out."** Parent facts
  (number, is_mrr, requestor, money, clock) are read off CHILD rows in `RequestWorkspacePage`, `MyTasksPage`,
  `RecordSearchTaskPage`, `EstimateTaskPage`; `routes/feeEstimates.js` never imports `requestScope` and
  `routes/clocks.js` has ZERO parent/child scoping though the clock is a parent field. **One backend pass over
  `GET /requests/:id` + `/tasks/mine` + `/tasks/:id` fixes four screens at once** — do it first so new screens
  inherit correct facts by construction.
- **`legal_review` spawns but nothing can ever complete it**; the reconciler keeps re-creating it and it can
  coexist with an open `redaction`.
- **No from-`closed` guard** in the central function (only `workflowEngine` re-reads — the (h) flake fix).
- **Routing split-brain:** `redaction_qa` excluded from `ROUTABLE_TASK_TYPES`; `/tasks/pool` and
  `poolForUser` use DIFFERENT eligibility queries; `review_auto_redaction` spawns with NULL `role_required`
  and NULL means "everyone eligible" — **world-claimable**.
- **Two fragile couplings:** estimate spawning keys on the literal rule id `'wfr-confident'` (reseed it and
  estimates silently stop); `fee_review` is in neither `STAGE_TASK` nor the reconciler sweep.

### ⚠️ LIVE DATA CHANGED — and it is NOT ours
Live is **11 requests, not the 9** recorded since (f). **`2026-000003` is a REAL tester submission** —
`Garrett Hargrove <mkhargrove@gmail.com>`, "code enforcement tickets October November December 2024", portal
channel, created 18:11 today, with a `record_search` task claimed 4 minutes later. Provenance was checked
explicitly: this session's Playwright runs used `Test Requestor`/`test@example.com` with building-permit
queries and intercepted every submit, so **no live write in this session was ours** — the claim stands.
**DO NOT PURGE `2026-000003`.** Prior sessions habitually created-and-purged smoke requests; this one is
genuine tester data and is the ONLY request that has ever reached `record_search` — the natural specimen for
this work. (Kevin has the portal in front of human testers, so expect live to keep growing.)

### Decisions the brief needs from Kevin before Phase 1
(1) Is the 10-stage order the flow he wants, or is v1's being inherited by default — and are
`exemption_review`/`ag_review` always-on or city-configurable? (2) Do stubs auto-approve or require a note?
(3) Single-record first, or the MRR hub too (design-gated)? (4) `commercial_rate`/`mrr_processing` — build or
delete from the catalog (today they're assignable to people and produce permanently empty pools)?
(5) Retire the v1 redaction duplicates (`RedactionWorkspacePage`, `RedactionReviewPage`) now or later?

### Doc debt recorded in the brief §6
Four specs describe a PRE-centralization world. `SPEC_tasks_roles_mrr_fees` §13 still says the centralized
transition is "deferred" and root cause "not isolated" — it describes the absence of the architecture's
centerpiece. `SPEC_request_lifecycle_workflow` §1 says 8 stages, §5 of the SAME doc says 10, code has 10.
`TASK_AND_NOTIFICATION_MODEL` §8 lists `build_redaction_template` as implemented though a test asserts it is
never created. Recommendation: fix them AS each phase touches them, so the same-commit rule does it
incrementally.

### Next session
Start fresh on Phase 0 (foundation repairs, no new screens). Read the brief first.

**Added to the brief after the above — §7 demo/test fixture importer `[SCOPED, NOT BUILT]`.** Kevin wants to
import ~30 requests from a spreadsheet with **overridden submitted/payment dates** so budgets, overdue and
payment state compute normally (he can key 30 rows by hand; he cannot fake dates). **Shape decided:** NOT
spreadsheet→INSERT into mid-pipeline states — derived state wouldn't cohere and the fixture becomes the thing
being debugged. Instead a **replay tool with an injectable clock**: create through the ONE helper, then drive
REAL transitions and payment paths in order with an "as of" timestamp per step. Time travel, not row forgery.
**Check FIRST before estimating:** `task_events` is written by a DB TRIGGER with `assigned_at`/`in_progress_at`/
`done_at` denormalized onto tasks — whether that trigger stamps `now()` or accepts a supplied value decides
the size of the build; same question for tolling clock starts and `request_history`. **Non-negotiables:**
guard it non-live like `tests/testEnv.js` (live now holds real tester data), and keep the spreadsheet IN THE
REPO so the demo DB is reproducible rather than a one-off hour of typing. It doubles as the test corpus for
this effort — only `intake`/`record_search`/`delivery` have ever been reached by real data, so the whole
mid-pipeline currently has no specimen to build screens against.

---

## 2026-07-18 (n) — Phase 0 begins: parent facts on `GET /requests/:id` (`72da033`)
First slice of the processing-flow rebuild. Backend only, no new screens, per the brief's Phase 0.

### The bug was worse than the brief said
Not "the workspace shows a suffixed number" — **there was no id you could pass to `GET /requests/:id` that
returned a correct, complete picture of a request.** Proven live against `2026-000002` (3-child MRR), before
the fix:

| Row addressed | number | `is_mrr` | stage |
|---|---|---|---|
| parent | `2026-000002` ✅ | 1 ✅ | **null** ❌ |
| each child | `2026-000002-N` ❌ | **0** ❌ | `intake` ✅ |

The workspace either knew who the citizen was or knew what the work was, never both. And because
`requestCreate` forces `is_mrr = 0` on every child, **the MRR badge silently vanished on exactly the screens
where staff do the work.** That is a concrete mechanism for "processing feels impossible to sort out."

Fixed by resolving parent-level facts through the parent (new `scope.parentFact()`, the generalisation of
`numberExpr`); description/stage/routing still come from the row addressed, which is the work. `parent_id`
now exposed for later navigation. Verified across **all 11 live rows** — single-record children, the MRR's
three children, and the legacy unwrapped `SYS-`/`LIBRARY` containers (which the COALESCE fallback arm serves
unchanged).

### ⚠️ The test was asserting the bug — read this before trusting a green harness
`verify_stages` finds its request by `description`, which is a **CHILD** field, then waited for
`req.request_number` — the child's suffixed number — to appear on the workspace. **It passed only because the
page was rendering the wrong number.** Fixed to assert the citizen's number and, additionally, that the suffix
is **absent**, so the fix cannot regress silently. This is exactly the CLAUDE.md warning about predicates that
were tautologies before children existed; expect more of it.

Second finding in the same harness: the 20s `waitForSelector` timeout was aborting the whole `try` block, so
**eight downstream assertions never ran** — including "advance works end-to-end through the real endpoint" and
the history check. It reported 16/17, not 24/25. It now runs 25/25. Suite went 745 → 746 for this reason, not
because one test was added.

Also fixed `run_suite.js`: a harness that fails by *throwing* increments `fail` without printing a `FAIL`
line, so the runner said "1 fail" and then listed nothing — the exact blindness that block was added to
remove. It now surfaces `ERR`/`CLEANUP ERR` too.

### Brief §3.1 was mostly wrong — corrected in the same commit
Only **1 of its 6 entries** was a real bug. The list was built from a grep sweep, not from reading the
implementations, and would have sent a session chasing four non-bugs:
- **`routes/clocks.js` is correct as written** — thin passthrough to `tolling.js`, which resolves to the
  parent at *every* entrypoint. Its comment says this is enforced in the engine deliberately, "five call
  sites, one invariant." **Do not "fix" it.**
- **`/tasks/mine`, `/tasks/:id` already resolve the number** via `numberExpr`/`numberJoin`. The real gap is
  smaller: `is_mrr` is not selected at all.
- **`requestor_name` / `deadline_date` on a child are TRUE COPIES by design**, not stale reads —
  `requestCreate` copies citizen identity down, `tolling.writebackDeadline` cascades the deadline down on
  purpose so leaf-scoped worklists can show it. Verified identical on every live row.

### The one it understated — new §3.1b `[OPEN, DESIGN-GATED]`
**Money is keyed on the CHILD.** All 17 `/fee-estimates/request/:requestId` endpoints use the id they are
handed with zero parent resolution (39 raw uses); `paymentStatus.js` has none either; `EstimateTaskPage`
passes `task.request_id` — the child. Money is a PARENT fact. For a 3-child MRR that is **three independent
money pots and a parent that owns none**: three estimates, three deposit ledgers, three payment states, no
request-level total to bill the citizen.

**Deliberately not fixed.** It contains a real design question — how do n children's fees roll up into one
citizen bill? — which is the same question the design-gated MRR hub (§14.3) exists to answer. Patching it
underneath that design would prejudge it. **Latent, not yet damaging:** live money is all zero because nothing
has reached `fee_review`.

### Verification
746/746 green; **live census clean, not one row moved**. Live probed before and after through the real
endpoint with a real token. `2026-000003` (the tester submission) untouched, still at `record_search`.

### Next session
Phase 0 continues — **§3.3** (`POST /tasks/:id/complete` has `requireAuth` and nothing else) plus the
stub-safe advance path, then **§3.2** (`legal_review` spawns but nothing can complete it). §3.3 is the one
that must land before any click-to-approve stub is written.

**Still needs Kevin** (brief §5, unanswered): the 10-stage order; whether stubs auto-approve or require a
note; single-record vs the MRR hub; `commercial_rate`/`mrr_processing` build-or-delete; retire the v1
redaction duplicates now or later.

---

## 2026-07-18 (o) — Phase 0 §3.3: the stranding gun is gone (`6aae6f4`)
Second Phase 0 slice. Backend only, no new screens.

### Removed, not hardened — because it was dead on arrival
`POST /tasks/:id/complete` was three lines behind `requireAuth` and nothing else: no ownership check, no type
check, and no stage side-effect. Any authenticated user could mark ANY task done and the request stayed put —
**task reads done, stage never advances, and no screen shows the discrepancy.**

The investigation changed the fix. `git log -S` traced it to 2026-06-24 (`8bfc555`), added alongside the
estimate screen — but **that screen completes its task by a direct `UPDATE` in `feeEstimates.js` instead**, so
this endpoint had **ZERO callers** in frontend, backend, tests or scripts for the entire four weeks it
existed. Pure unguarded surface area with no user.

So hardening it would only have produced a **better-defended way to finish a task without moving the
request** — exactly what the brief warns a click-to-approve stub must never do. Removed instead, with a
comment in its place pointing at `/:id/resolve` as the pattern to copy: check the type, enforce whatever
"enough to advance" means, then go through `applyStageTransition`.

### The test asserts ABSENCE, and it was break-tested
`verify_task_lifecycle` §D asserts the route returns **404 — gone, not merely guarded** — so re-adding it in
any form fails the suite. Proven to bite: re-adding the endpoint failed D1 and D2, and the break was reverted
with the green state already committed.

**Note D3 passed during the break**, while the task went done. That is not a weak assertion — *that passing
assertion IS the stranding*: the stage genuinely does not move. D1/D2 are what detect the endpoint.

### ⚠️ A NON-BUG that looks identical — do not "fix" it
`feeEstimates.js:270` marks the estimate task done with a **direct UPDATE and no stage transition**. Reading
the sweep, that is the same bug class. It is not. Sending an estimate must NOT advance the request, because
the next move belongs to the **citizen**: the stage advances on their response (`applyStageTransition` at
`feeEstimates.js:296`), and `tickler.js` clock (1) watches for a sent estimate never accepted or declined and
lapses it. **Task-done-with-no-stage-move is only stranding when nothing else is watching.** Here something
is. Recorded in brief §3.3 so the next sweep does not flag it.

This is the second time this session a grep-level inference was wrong on inspection (see (n) on §3.1).
**On this domain, read the implementation before believing the sweep.**

### Verification
749/749 green, live census clean. Break-test performed and reverted; suite re-confirmed green after.

### Next session
**§3.2** — `legal_review` spawns at `exemption_review`/`ag_review`, no route resolves it, the reconciler keeps
re-creating it, and it can coexist with an open `redaction`; they only clear at `closed`. That is the last
Phase 0 repair that needs no decision from Kevin.

**BLOCKED on Kevin** — the stub-safe advance path cannot be built until §5 Q2 is answered (**do stubs
auto-approve, or require a note?**). The brief's own recommendation is that a required note costs nothing now
and leaves an audit trail explaining why a request moved during the skeleton period. The other four §5
questions are still open too: the 10-stage order; single-record vs the MRR hub;
`commercial_rate`/`mrr_processing` build-or-delete; retire the v1 redaction duplicates now or later.

---

## 2026-07-18 (p) — Phase 0 §3.2: legal_review is resolvable; a stage's task dies with its stage (`00e1b85`)
**Phase 0 is COMPLETE.** Backend only, no new screens.

### Kevin's decision, recorded
**§5 Q2 answered: stubs REQUIRE A NOTE**, not auto-approve. Applied immediately to the `legal_review`
resolution below, and it binds every stub screen built from here.

### All four brief claims verified true — one root cause
Unlike §3.1, §3.2's claims all held up on inspection. `legal_review` spawns at `exemption_review`/`ag_review`;
nothing resolved it; the 2-minute reconciler re-created it; only `closed` ever cleared it. The root cause
under all four: **a `legal_review` task had no relationship to the stage that spawned it.**

### Fix 1 — it can be DECIDED, not merely completed
Marking it done was never the answer: that leaves the request at `exemption_review` with no task and no way
forward — precisely what the `/tasks/:id/complete` removed in (o) would have done. **Completing a legal review
IS a stage decision.** `/tasks/:id/resolve` now handles it, marks the task done, and advances through
`applyStageTransition`. The reconciler then correctly declines to resurrect it, because the stage has moved.

**The outcome vocabulary is deliberately identical to `/requests/:id/ag-ruling`** — `sustained`/`partial` →
`redaction_review`, `overruled` → `delivery`. An internal exemption review and an AG pre-clearance ruling
answer the same question (does the withholding stand?); inventing a second vocabulary would be two ways to say
one thing. **A note is required**, per the decision above.

### Fix 2 — the orphan, which is what actually caused the coexistence bug
A task belongs to the stage that implied it, but `legal_review` was only ever cleared by `closed`. So
`/requests/:id/ag-ruling`, which moves `ag_review → redaction_review`, left an **open, pooled** `legal_review`
on a request already in redaction — two open tasks from two different stages, and a legal staffer could claim
and work an exemption review for a decision made and acted on days earlier. The central transition now cancels
the outgoing stage's task when the new stage implies a different one.

**FAMILY-AWARE, and this is the half that could have done real damage:** `redaction_review → redaction`
implies `redaction` on BOTH sides, so an in-flight redaction task must survive that move — a naive
"cancel what you left" would have destroyed live redaction work. Same for `exemption_review → ag_review`.

### Verification
New harness `verify_legal_review`, **18 assertions**, registered in `run_suite`. 767/767 green, live census
clean. **Break-tested:** dropping family-awareness fails **F1** (in-progress redaction cancelled) and **G1**
(escalation destroys and re-creates the review) — the over-correction is caught in two places. Break reverted,
suite re-confirmed green.

### Next session
**Phase 0 is done — Phase 1 is a decision, not a build.** The remaining §5 questions are Kevin's:
the 10-stage order (and whether `exemption_review`/`ag_review` are always-on or city-configurable);
single-record first vs the MRR hub; `commercial_rate`/`mrr_processing` build-or-delete; retire the v1
redaction duplicates now or later.

Once the flow is settled, **§3.2's resolution is the reference implementation for every stub**: type check →
required note → mark done → `applyStageTransition`. Copy that shape and a blank screen is a genuine node in
the flow.

**Phase 0 leftovers, not blocking:** §3.4 (no from-`closed` guard), §3.5 (routing split-brain), §3.6 (estimate
spawning keyed on the literal rule id `'wfr-confident'`; `fee_review` in neither `STAGE_TASK` nor the
reconciler sweep). **None were verified this session.**

### ⚠️ The standing lesson from this session
Three of §3.1's six entries and the `feeEstimates.js:270` "bug" all **evaporated on inspection** — they were
grep-level inferences that the implementations contradicted, usually with a comment explaining exactly why the
code was right. §3.2's claims, by contrast, all held. **Check each remaining claim against the implementation
before building anything on it.**

---

## 2026-07-19 (q) — Parent/child attribute audit, a 7-doc stale sweep, four MRR decisions, and a fresh-install defect
Long session, 16 commits after (p). Two code fixes, one live defect proven, one schema defect fixed, and the
rest is design/doc reconciliation driven by Kevin. Suite **745 → 793**, live census clean throughout.

### ⚠️ THE FINDING THAT MATTERS MOST — dunning is INERT for every wrapped request
**Verified, not inferred** (`tests/verify_nonpayment_scope.js`). Money is a PARENT fact, but every UI path
addresses a **child**: `EstimateTaskPage` passes `task.request_id`, and all 17 `/fee-estimates` endpoints use
the id they are handed with zero parent resolution. `feeNonpayment.sweep()` is **parent**-scoped — deliberately,
because unscoped it would send citizens *duplicate* dunning emails — then hits `if (!sit.hasEstimate) continue;`.
The parent has no estimate, so **every wrapped request is skipped: no dunning email ever sends, and non-payment
auto-close never fires.** The parent-scoping succeeded completely at preventing duplicates, by making dunning
never happen at all.

Latent only because nothing has reached `fee_review`. **The harness is deliberately NOT registered in
`run_suite` — it FAILS today by design.** Register it the moment the money axis moves to the parent; it is that
fix's regression test, already written.

### Two more live facts worth carrying
- **`routing_review` fires PER CHILD.** `onIntake` loops over `childIds`, and its idempotency guard is scoped
  `WHERE request_id = ?` so it cannot dedupe across siblings. **Confirmed in live data: one parent carries 3
  routing_review tasks.** An ORO Associate resolves the same citizen request three times. Also: "routed to ORO"
  is a *staffing convention*, not code — the task is team-agnostic and resolved by eligibility.
- **MRR → ORO routing does not exist.** No `createTask({type:'mrr_processing'})` anywhere. The queue is already
  honest about it, rendering `—` with a comment that inventing an owner "would be a lie."

### The stale-doc sweep — 7 documents corrected at source
The binding spec's own header said **"DESIGNED, NOT BUILT … 0 children"** — true the morning of 07-16, false by
that afternoon. **This had a traceable cost:** it is why (m)'s brief was rebuilt from a live DB inventory
instead of the spec, and why 3 of its 6 §3.1 entries were wrong. `DOMAIN_MAP.md` (the index agents read first)
said the same. Both corrected, plus a precedence rule: **a section's own build tag beats the header.**

Also corrected: `TASK_AND_NOTIFICATION_MODEL.md` §7 (a 07-07 *audit* asserting "'always parent' — **VERIFIED
FALSE**" and "child creation does NOT exist" — dangerous precisely because audit results read as authoritative);
`SPEC_fees_estimates_payments.md` ("MRR-aware fee aggregation exists" — disproved by the dunning test, and the
same file contradicted itself two paragraphs down); two docs citing the retired `PARTIALLY_GRANTED` roll-up;
`WORKFLOW_DECISIONS.md`'s terminal-state table (mapped onto §5.8's eight child dispositions, which surfaced two
the list was missing); a dangling §14.5 → §6.2 pointer *inside* the binding spec, aimed at a section that
forbids building from itself; and four **"waits for #11"** deferrals — #11 shipped 07-16.

`HANDOFF.md` carries the same "#11" language in three places and was **left alone deliberately** — it is a dated
log and those entries were true when written.

### `docs/WORKING_attribute_inventory.md` — Kevin's ask, a scratchpad not a spec
Every `requests` column with where it is actually written, what the spec says, and whether they agree; a dead
list (`actual_fee`, `amount_paid` have **no writers**); the designed-but-unbuilt "overkill" list to prune; and
the four inheritance mechanisms already in ad-hoc use — **copy-down, cascade-down, resolve-through, roll-up
(which does not exist)**. Most defects found are a column using the wrong one.

### §5.10 rewritten — generalized prorata `[NOT BUILT]`
Kevin's scenario killed the old "running cap on cumulative billing" rule: 10 × $6 + 1 × $60, cap $100 — the
expensive record is charged **$60 if it ships first, $40 if it ships last**. Price by processing order. It did
not dissolve the allocation problem, it **relocated it into release order, where it is invisible**.

Investigating it found something larger: **`componentGross` is a naive per-record sum that is NEVER charged.**
The engine prices components with no rounding, gates, allowances or tiers, then discards that and re-prices from
request-level aggregates. **No request-level rule decomposes to components.** Eight vehicles inventoried — and
the cap is not the main one and is **`null` in the live TX profile**, while aggregate labor rounding (0.25, up)
is **live today**. Four vehicles run the *other* way (combining costs MORE), and `laborGate` is a step function,
so any per-vehicle rulebook is wrong for half of them.

Hence one rule: **`componentCharged[i] = componentGross[i] × (total / grossSubtotal)`** — the ERP answer,
order-independent, ignorant of the vehicle, absorbs rules not yet invented. Two guarded edge cases:
`grossSubtotal = 0`, and `rate:'actual'` items contributing 0 (live — `mail` is `'actual'` in TX).

**`componentCharged` is the missing field THREE features are blocked on:** the §5.9 release gate (today a
whole-request test, which §5.9 forbids), `fee_revenue by department` (recorded UNDEFINED on 07-14), and ERP line
items. **Highest-leverage next build.**

### ERP: compute here, send detail
`erpSettlement.emitCharge()` sends a **single scalar amount** — the ERP is never told there are eleven records,
so it cannot allocate anything. "Offload it" collapses into "build it, then also send it." Decided: the
**release-gate allocation and the GL allocation are different questions and need not agree.** Optimum Q owns the
gate (it authorizes a legal act); Finance allocates however their policy dictates; extend the payload to line
items.

### §15 — THE MRR RULE MATRIX, SHIPPED BLANK `[Kevin, and it supersedes four decisions made earlier the same day]`
Mid-session Kevin decided As-Ready default, per-child notices, per-request delivery fee. **Then he pulled back**:
of six calls made, only one (notice *content*) is clearly stated in statute. Where the law is that silent, a
shipped default is **the vendor making policy for a government**, and it runs invisibly.

So: **no values ship.** Six rows — `delivery_mode`, `hold_override`, `delivery_fee_basis`, `notice_packaging`,
`notice_send`, `fee_allocation` — each storing **value + basis + who set it, when**. City fills them with
counsel; **MRR does not unlock until complete.**

**The gate costs nothing: every row is a no-op at n = 1** (one record → one shipment → one notice → one
component). Ordinary requests untouched; the only thing gated is a hub that is not built.

Today's decisions are **not discarded — they became permitted values**, and the seven-state research is
surfaced beside each row as **considerations for the city to weigh, never a recommended value.** §15.4 lists
what may NEVER enter the matrix (sibling-nonpayment withholding, denial-notice content, per-child statutory
deadlines, record/AG-hold scope, appeal scope, parent disposition) — a row there lets a city configure itself
into unlawful conduct.

### Go-live readiness — `docs/DESIGN_go_live_readiness.md` `[BUILD LATER]`
Kevin could not recall where any prior work lived. There is a lot: the wizard is **BUILT** (7 phases, reviewer
flow, live readiness signals), the fee sandbox gate genuinely bites and is version-bound, redaction rule approval
is genuinely enforced at `zoneDiscovery`, attestation is built and verified. **But none of it gates go-live** —
`onboarding_progress` is read by one route and two frontend files, there is **ONE** hard enforcement point in the
codebase, `dev_mode = '1'` bypasses it, and **0 of 180 sections are attested**.

**Recorded disagreement:** gates and wizard have **opposite timing**. A gate is domain-local (only fees knows
what "complete" means) so gates must land WITH each domain — as already happened for fees and redaction. The
wizard is a shell owning no domain knowledge. **Building gates late IS the rebuild Kevin fears.** The MRR matrix
is the first test; it already specifies its own gate.

**Pushed back on "the key will deactivate":** disabling a records system a city relies on for *statutory*
compliance is not ordinary SaaS deactivation — missed deadlines become a harm the vendor plausibly caused, which
inverts the liability posture in `BUSINESS_LEGAL_IP_LOG.md`. Kevin's own 2026-06-25 two-key design is better:
**WITHHOLD ACTIVATION, NEVER REVOKE IT.** His call, but settle wording with counsel before it enters a contract.

### Fresh-install defect FIXED (`9c0cfbc`) — this class has now bitten THREE times
`schema.postgres.sql` seeded **6** phases with no `fees` row, and **nothing in the codebase ever wrote
`requires_review`** — live's 7 phases and 3 gated flags were set **by hand**. A new city install got **no Fees
phase (so no sandbox gate) and ZERO gated phases** — every phase completable by any authenticated user via a
plain PATCH. The opposite of the intended posture, and silent, because the wizard still *looks* configured.

Fixed with all 7 phases seeded plus an `IS DISTINCT FROM`-guarded convergence block (the schema re-applies on
every boot; verified live unchanged). New harness **`verify_fresh_install` (26 assertions)**, registered,
break-tested (reverting fails 8, including "gated phases found 0"). It also asserts `SetupPage`'s `PHASE_META`
can render every seeded phase, catching drift the other way.

**The rule it enforces: THE LIVE DATABASE IS NOT THE SPECIFICATION.** Anything a city needs on day one must come
from the schema. The suite is the *only* place a fresh install is exercised (`reset_test_db.js` builds from
empty) — which is why these sat undetected while the running system looked fine.

### Verification
**793/793 green, live census clean.** Break-tests performed and reverted for `verify_fresh_install` and
`verify_legal_review`; suite re-confirmed green after each. Live probed read-only throughout; `2026-000003`
(tester data) untouched.

### Next session
1. **`componentCharged`** — one field unblocks the release gate, revenue-by-department and ERP line items. Best
   ratio of leverage to risk on the board, and §5.10.2 fully specifies it.
2. **Phase 1 of the processing rebuild is BLOCKED on Kevin** — brief §5: the 10-stage order,
   single-record vs MRR hub, `commercial_rate`/`mrr_processing` build-or-delete, retire v1 redaction duplicates.
3. `WORKING_attribute_inventory.md` **Part H** — 7 remaining items, none with legal exposure (copy-down vs
   resolve-through for citizen identity; `closure_reason`/`tickler_flag` ownership; `legal_flag` scope; Part C
   prune, especially §5.3's ~30 workstream status values).
4. **Left deliberately undone:** `dev_mode = '1'` (belongs on the go-live checklist, not a commit);
   `WORKFLOW_DECISIONS.md`'s `PARTIALLY_GRANTED` notification rows (needs the §4.4 field-design pass);
   the RM hold override's WA-entitlement guard (**do not build the override without resolving it**).

### ⚠️ THE STANDING LESSON — earned twice this session
Three of §3.1's six entries, the `feeEstimates.js:270` "bug", and `laborActuals`' "aggregate lands on the first
component" **all evaporated on inspection** — grep-level inferences the implementations contradicted, usually
with a comment explaining exactly why the code was right. §3.2's claims, by contrast, all held.
**On this domain, read the implementation before believing the sweep — and check the schema before believing
live.**

---

## 2026-07-19 (r) — `componentCharged` + the release gate becomes a coverage test (`b2fb08b`, `5ce7313`, `bd9befa`)
Continuation of (q), same day. Two real code slices, the highest-leverage items on the board.

### `componentCharged` — the per-record price that did not exist under any accounting method
`componentGross` is a naive per-record sum that is **never charged**: components are priced with no rounding,
gates, allowances or tiers, and that figure is discarded while every real rule runs on request-level
aggregates. **No request-level rule decomposes to components**, so the engine emitted gross (pre-everything)
and total (post-everything) with nothing in between.

    componentCharged[i] = componentGross[i] × (total / grossSubtotal)

One ratio, both directions, ignorant of the vehicle — absorbs labor rounding, `laborGate` thresholds, free
allowances, duplication tiers, floor, ceiling, de-minimis, surcharge, delivery, certification, and anything
added later. Kevin's originating scenario verified: 10 × $6 + 1 × $60 against a $100 cap ⇒ the expensive record
is charged **$50 whenever it ships**, shares summing to exactly $100.

Two guards, both reachable: **zero gross** (de-minimis waive, all-`'actual'` rates, no components) returns 0 and
reports `basis: 'nothing_priced'` rather than `NaN`; a component of all-`'actual'` line items is flagged
`hasUnpricedActuals` rather than allocating to 0 and reading as FREE — **`mail` is `'actual'` in the live TX
profile**. Penny residual settles on the **largest** component, not the last, so the result depends on the SET
and not array order.

### ⚠️ I SHIPPED A TEST THAT COULD NOT FAIL — and the break-test caught it
`verify_component_charged` §D claimed to prove **order-independence** — the exact property whose absence killed
the running-cap rule — and proved nothing. Grosses summed to 72 against a $100 cap, so **the cap never fired**:
ratio 1, no residual to misplace. It stayed green with the allocator deliberately sabotaged.

Found only because the green state was committed and then broken on purpose. **A test that cannot fail is worse
than no test — it reports the property as protected.** Replaced with 7/11/13 against a $20 cap (cap fires,
shares leave a real −$0.01 residual), plus **D0 asserting the scenario actually engages the cap** so it cannot
go vacuous again, and D2 matching components by gross rather than position. Fixed in its own commit so the
finding stays legible.

### The release gate — §5.9 is now enforced
It blocked on `!paidInFull`, the whole request's balance. On a multi-record request that **withholds a
finished, fully-paid-for record because a DIFFERENT record's money has not arrived** — which §5.9 forbids
outright ("a child may NEVER be withheld because a SIBLING is unpaid"). Legal, not preference: no state
authorizes it, and TX § 552.221(a) / CA § 7922.500 cut against sitting on finished records.

Now resolves the row's own share and gates on `covered`. **Exact no-op for a single-record request** (one
component ⇒ `componentCharged = total`) — the correct predicate adopted while it is still an identity, the same
technique `requestScope.js` used for the migration.

Three details worth knowing: the covering snapshot is the row's own estimate **or its parent's** (today the
first hits; when money moves to the parent the second does, unchanged); a **reconciliation supersedes on both
axes**, so the share is read from whichever snapshot set the effective total; and an estimate with no
per-component data falls back to the whole-request test as `coverageBasis: 'request_total'` — the **previous**
behaviour, stricter than §5.9 requires and never more permissive.

`verify_release_coverage` (18). §C is the point: $10/$20/$70 children with $30 paid ⇒ the two cheap records
release, the expensive one holds owing **$40** (not the $70 request balance), while C6 asserts the request is
**not** paid in full — the old gate withheld all three. Break-tested: reverting fails C2/C3/C7/E1.

### ⚠️ Required before the money axis moves to the parent
Coverage is per-child today because each child carries its own estimate and therefore its own payment pool.
Once ONE parent-level estimate funds n children from ONE pool, coverage must become **CUMULATIVE over
already-released siblings** (§5.10.3 FIFO) — otherwise three $20 children all release against $50 paid, each
being individually under $50. Not reachable today (needs `delivered_at` / `installment_no`, not built), and
**flagged at the bottom of `feeRelease.js`** where that work will land.

### Verification
**834/834 green, live census clean.** Break-tests performed and reverted for both slices. Specs updated in the
same commits: §5.9 marked BUILT, `componentCharged` marked BUILT in the working inventory. **Pushed** —
`origin/main` at `81bb6f5`; note the branch had been **20 commits unpushed** before this session pushed it.

### Next session
1. **Revenue-by-department** — recorded UNDEFINED on 07-14 because attribution "needs the allocation the law is
   silent on." `componentCharged` now defines it. Small, and it closes a stale open item.
2. **ERP line items** — `emitCharge()` still sends a single scalar `amount`; extend to line items carrying
   `componentCharged` (§5.10.5).
3. **Phase 1 of the processing rebuild is still BLOCKED on Kevin** (brief §5) — the 10-stage order,
   single-record vs MRR hub, `commercial_rate`/`mrr_processing` build-or-delete, retire v1 redaction duplicates.
4. Everything in (q)'s "next session" list still stands, including the deliberately-undone items.

---

## 2026-07-19 (s) — Revenue by department, and the revenue metric that was always $0 (`58aac73`, `c07bfc5`)
Continuation of (r), same day. Item 1 off (r)'s board. **Two defects closed, only one of which was on it.**

### The one I went looking for — `fee_revenue by department` is BUILT
Recorded **UNDEFINED** on 07-14 and refused in code, correctly at the time: revenue is one number on the
parent, a department belongs to the individual records inside it, and a join would double-count one payment
into two departments. It needed an **allocation rule**, and there was none. `componentCharged` (§5.10.2, built
in (r)) is that rule:

    revenue[i] = paid × (componentCharged[i] / Σ componentCharged)

`services/revenueAllocation.js`. Order-independent and vehicle-ignorant for the same reason the pricing rule
is, and **the columns sum to the collected total by construction** — the exact property whose absence made the
cut undefined. **An exact identity at n = 1** (one component takes the whole payment), so ordinary requests are
untouched: the same "adopt the correct predicate while it is still an identity" move as `requestScope.js` and
`feeRelease.js`.

Snapshot resolution mirrors `feeRelease` deliberately — payments off the latest `estimate`, the split off the
latest `reconciliation` if one exists. **The two must agree**, or a record could be released against one split
and booked against another.

**Filters apply to the PAYER, grouping resolves the EARNER.** Time range, status, requestor and month are
parent facts — the citizen paid once, on a date. Department and classification are child facts. Filtering on
the earner would silently under-report the total, which is why §G tests it.

### ⚠️ THE ONE I DIDN'T GO LOOKING FOR — every revenue figure in the product was $0
`reportEngine` summed `requests.amount_paid`. **That column has no writer anywhere in the codebase**, and that
read was its **only reference in the entire repo**. Money is recorded on `request_fee_estimates`
(`deposit_paid_amount` / `final_paid_amount`). So `fee_revenue_ytd` and every revenue number reported **$0
however much a city had collected** — not an error, a plausible empty report.

**`WORKING_attribute_inventory.md` had already recorded this** — "no writer; reports read it and always get 0"
— on 07-19 (q), one day earlier. It was written down and not acted on, because it was filed as a *dead column*
and dead columns read as harmless. **A "💀 dead" verdict means nothing WRITES it; it says nothing about
readers, and a read of a never-written column is silent, plausible and wrong.** A box in the inventory now says
so, and every 💀 row there deserves a reader check. The inventory's "drop, or populate from
`request_fee_estimates`" is resolved to **drop** — populating it would have created a second money source to
keep in sync.

This is also why the department cut could not be built alone: the columns have to sum to a total that is real.

### ⚠️ I SHIPPED A VACUOUS TEST AGAIN — same trap, second session running
`verify_revenue_allocation` §D claimed to prove the residual cent settles on the **largest** share regardless of
input order. Shares of 6.67 / 6.67 / 6.66 against $20 sum to **exactly $20**, so the residual was 0 and the
branch under test **never executed**. It stayed green with the rule deliberately sabotaged to "settle on the
last."

This is the **identical failure** to `verify_component_charged` §D one session earlier (`5ce7313`), and it was
caught the identical way: **commit green, then break on purpose.** Fixed with 7/11/13 against $20 (a real
−$0.01 to place), plus **D0 asserting the shares do not divide evenly** so it cannot go vacuous again, and D2
pinning the cent to the largest share. Fixed in its own commit (`c07bfc5`) so the finding stays legible.

**Worth naming as a pattern:** both vacuous tests were in the *residual/rounding* section, and both were
vacuous for the same reason — the author picked round numbers that happened to divide evenly. **When testing a
rounding remainder, assert the remainder exists.**

### Verification
**857/857 green, live census clean.** Three break-tests performed and reverted: residual-on-last fails D1/D2;
equal-split-instead-of-charged-share fails C2/C4/C5/D1/D2/G1; restoring the `SUM(r.amount_paid)` read fails
A3/C6. Verified in the running app — API restarted, healthy, and the live engine now returns
`Fee revenue by department` with `unavailable: false` (empty rows, because live genuinely has 0 estimates —
honestly $0 rather than falsely $0).

Specs updated: §5.10.4 item 2 marked BUILT, §10.6(b) marked RESOLVED with the reasoning retained, the stale
"reportEngine already refuses" note marked SUPERSEDED, and the inventory's dead-list rows corrected.
⚠️ **Process deviation:** the doc updates landed in a follow-up commit, not the same commit as the code.

### Next session
1. ~~**ERP line items**~~ — **done later the same session, see (t) below.**
2. **Phase 1 of the processing rebuild is still BLOCKED on Kevin** (brief §5) — the 10-stage order,
   single-record vs MRR hub, `commercial_rate`/`mrr_processing` build-or-delete, retire v1 redaction duplicates.
3. **Drop `requests.amount_paid` and `actual_fee`** — now genuinely unreferenced, so this is a clean migration.
4. Everything in (q)/(r)'s lists still stands, including **dunning being inert** (`verify_nonpayment_scope.js`
   is written and waiting) and **`routing_review` firing per child**.

### ⚠️ The standing lesson, restated because it earned another entry
(q) and (r) both ended with "read the implementation before believing the sweep." This session adds the
converse: **a finding that IS written down is not a finding that has been acted on.** The $0-revenue defect sat
in a doc for a day, correctly described, because it was filed under a heading that made it look harmless.

### 🙈 A FALSE ALARM I RAISED, and the cheap check that would have killed it
I flagged "live has 11 requests, not the ~129 the specs reference" as an unexplained anomaly worth chasing.
**It is fully documented and entirely intentional.** `129 → 3` was a deliberate purge — "purge, not migrate;
the 129 requests are test residue" — with the result verified row-by-row across ten tables (this file, the
2026-07-16 entry). It then grew to 11 through real submissions, including `2026-000003`, a genuine tester
request recorded in (q). The "129" in the spec is an explicit **pre-migration snapshot**, which (q)'s own
stale-doc sweep had already reframed as one.

**One `grep` of this file for "129" would have resolved it in seconds, and I ran that grep only after Kevin
questioned the flag.** The cost of a false anomaly is not zero: it lands in a "next session" list and buys a
future agent's time on a settled question. **Before flagging a discrepancy against a dated document, grep the
log — the number in the spec may be a snapshot, and the change may be someone's decision.**

---

## 2026-07-19 (t) — ERP line items; §5.10.4 is closed (`82fce3e`, `86958bb`)
Continuation of (s), same day. The last of the three features `componentCharged` was blocking.

### The charge carries its detail
`emitCharge()` sent a single scalar `amount` — the ERP was never told there were eleven records, so it could
not allocate anything. That is why "let Finance's ERP allocate it" collapsed into "build it, then also send
it." Now `erpSettlement.buildLineItems()` extends the payload, with the city choosing via
`erp_allocation_method` (absent ⇒ `prorata`, confirmed on live).

**The decision that shapes it (§5.10.5): the release-gate allocation and the GL allocation are different
questions and need not agree.** We own the gate because it authorizes a legal act; Finance recognises revenue
by their own policy. So we send detail, not a mandate.

### ⚠️ The design call the spec did not anticipate — `none` uses a DIFFERENT FIELD NAME
Under `none` ("report actual costs only") the line items carry **`actualCost`, and there is no `amount` field
at all.** Raw costs do **not** sum to the charge — that is the entire point of the request-level rules (cap,
free allowance, labor rounding). Had both modes emitted `amount`, **an ERP that naively sums line items would
post more than the city is charging and over-bill a citizen for a statutory fee.** With no `amount` to sum,
that failure is structurally unavailable rather than merely documented. `verify_erp_line_items` §D is that
guard: gross sums to $100 against a $50 charge, and D2 asserts the field's absence.

Two more things worth carrying: **a deposit is a partial charge**, so lines allocate *the charge*, not the
estimate (§B pins a $20 deposit to $2/$4/$14 — billing $50 of detail against a $20 charge is the obvious bug
here); and `buildLineItems` **fails open** — no components, no `componentCharged`, or any error ⇒ no line items
and the charge goes as the scalar it always was. Never fabricated.

Snapshot resolution had reached its **third copy**, so `feeRelease` now exports `pricedSnapshot()` (it already
owned the reconciliation-supersedes rule). §G asserts the gate share and the billed `componentCharged` agree —
a record released on one split and billed on another is a defect neither side would surface alone.

### ⚠️ A THIRD VACUOUS TEST — and this one generalises
§F claimed to prove the reconciliation supersedes the estimate. It proved nothing: the reconciliation re-used
the estimate's 10/20/70 quantities and only lifted the $50 cap. **But a cap scales every component uniformly** —
the capped split 5/10/35 is the SAME RATIO as 10/20/70 — **and prorata allocates by ratio**, so both snapshots
billed identically. Deleting the snapshot resolution outright still passed F1 and F2; only G1 caught it, and
only because `componentCharged` is reported raw.

**THE GENERAL LESSON, worth more than the fix: to prove WHICH snapshot was used, the snapshots must differ in
SHAPE, not merely in total. Anything that rescales uniformly — a cap, a percentage discount, a flat multiplier
— is invisible to a proportional allocator.** Fixed by redistributing the reconciliation (50/20/30), plus F0
pinning the trap shut.

That is **three vacuous tests in three sessions** — `verify_component_charged` §D, `verify_revenue_allocation`
§D, now `verify_erp_line_items` §F — **all three in rounding/allocation sections, and all three caught the same
way: commit green, then break on purpose.** The habit is now load-bearing, not ceremonial. If a session ever
skips it, assume the newest allocation test is vacuous until shown otherwise.

### Verification
**877/877 green, live census clean.** Three break-tests performed and reverted: reusing `amount` in `none` mode
fails D1/D2/D3; billing `componentCharged` instead of the charge share fails B1/B2; dropping the reconciliation
resolution fails F1/G1. API restarted and healthy; `erp_allocation_method` confirmed absent on live and
defaulting to `prorata`, and `buildLineItems` on a request with no estimate returns `null` (the scalar path).
**No ERP charge was emitted** — that would have written an `erp_charges` row to live, and the connector stubs
are off-limits.

### Next session
1. **§5.10.4 IS CLOSED** — release gate, revenue-by-department and ERP line items are all built. The
   `componentCharged` thread is finished.
2. **Phase 1 of the processing rebuild is BLOCKED on Kevin** (brief §5) — the 10-stage order, single-record vs
   MRR hub, `commercial_rate`/`mrr_processing` build-or-delete, retire v1 redaction duplicates. **This is now
   the largest thing on the board and it needs a decision, not a build.**
3. **Drop `requests.amount_paid` and `actual_fee`** — genuinely unreferenced since (s); a clean migration.
4. Still standing: **dunning is inert** (`verify_nonpayment_scope.js` written and waiting), **`routing_review`
   fires per child**, `WORKING_attribute_inventory.md` Part H, and (q)'s deliberately-undone items.

---

## 2026-07-19 (u) — The dead money columns are gone (`016ad30`)
Small, clean slice closing (t)'s item 3. `requests.actual_fee` and `requests.amount_paid` dropped from the
schema and from live.

### Checked before deleting, not after
Neither column ever had a writer — not one line in the codebase set either. **They were not harmless:**
`amount_paid` had exactly one reader in the repo, `reportEngine`'s `fee_revenue` metric, which is why every
revenue figure in the product read $0 however much a city had collected (see (s)). That reader was cut over in
`58aac73`, leaving both genuinely unreferenced.

**Both were 0 in every live row (13/13)** — they only ever held their `DEFAULT 0` — so nothing was destroyed
and the drop is exactly reversible (re-add with `DEFAULT 0`) if a reason ever appears. Verified *before*
running the DDL, because "the inventory says it's dead" is not the same as "the data says it's empty."

Removed from `CREATE TABLE` (fresh installs) plus idempotent `DROP COLUMN IF EXISTS` for existing ones; the
schema re-applies on every boot, so the API restart is what applied it to live. **First `DROP COLUMN` in this
schema**, so the idiom is documented inline for the next one.

### The assertion was inverted rather than deleted
`verify_revenue_allocation` A1 asserted `amount_paid` was still 0. It now asserts against
`information_schema` that **both columns are absent** — because a reinstated column is the defect, not a
curiosity: it would be a second, always-zero money source waiting for a future query to find and believe,
which is precisely how the $0-revenue defect happened. Checked against the catalog, so it covers a fresh
install too.

### Verification
**877/877 green, live census clean** (the suite builds its DB from the schema, so that run exercises both the
fresh-install path and the drop). Applied to live by restarting the API; confirmed `actual_fee` and
`amount_paid` are gone from `information_schema`, `estimated_fee` survives untouched, and **all 13 live rows
are intact**. Read paths re-exercised against live afterwards — four report metrics and `releaseGate` on three
real requests — all clean, confirming nothing selected the columns implicitly.

Left alone deliberately: `src/db/schema.sql` and `src/db/index.sqlite.bak.js` still name both columns. They
are dead sqlite-era files loaded by nothing, and they are history.

### Next session
1. **Phase 1 of the processing rebuild is BLOCKED on Kevin** (brief §5) — the 10-stage order, single-record vs
   MRR hub, `commercial_rate`/`mrr_processing` build-or-delete, retire v1 redaction duplicates. **This is the
   largest item on the board and it needs a decision, not a build.** Three sessions have now ended here.
2. Still standing: **dunning is inert** (`verify_nonpayment_scope.js` written and waiting for the money axis to
   move to the parent), **`routing_review` fires per child**, `WORKING_attribute_inventory.md` Part H, and (q)'s
   deliberately-undone items (`dev_mode = '1'`, the `PARTIALLY_GRANTED` notification rows, the RM hold
   override's WA-entitlement guard).
3. ~~`estimated_fee` was NOT examined~~ — **checked and dropped the same session, see below.**

### Addendum — `estimated_fee` dropped too (`342254e`)
Kevin asked for the check flagged above. It came back **different from the other two, and worse.**

`estimated_fee` had **a writer and no reader**: `routes/feeEstimates.js` set it immediately after inserting the
authoritative `request_fee_estimates` row, and nothing in backend, tests or frontend ever read it back. A
write-only denormalized copy.

**The reason it goes is not tidiness — it was STALE BY DESIGN.** That single write was the only one in the
codebase. Reconciliation, reissue and adjustment each write a **new** `request_fee_estimates` snapshot and
never touched this column, so **the moment a request was reconciled it held a superseded total.** A believable
money number that was wrong — the same trap `amount_paid` set by silently reading $0. It also wrote to the
**addressed row** (a child today), putting a money fact on the work row contrary to §4.3; the inventory had it
flagged as a parent/child conflict, and the resolution turned out to be **deletion, not migration.**

Verified 0 in all 13 live rows before the DDL. `verify_revenue_allocation` A1 now covers all three columns.

**Coverage here is real rather than incidental:** the write lived in `POST /fee-estimates/request/:requestId`,
which `verify_deposit_clock`, `verify_estimate_reconcile` and `verify_fee_waiver` all drive end-to-end through
the API — so the route was proven still working against a schema without the column, not merely assumed.

**877/877 green, live census clean.** Applied to live by restart; all three columns confirmed absent, 13 rows
intact, report and gate read paths re-exercised clean.

**The pattern across all three, worth carrying:** a column with no writer reads as $0; a column with no reader
goes stale. **Both produce a plausible money figure that is wrong, and neither announces itself.** The dead
list in `WORKING_attribute_inventory.md` is now empty of money columns — but the same two questions (who
writes it, who reads it) are the ones that found all three.

---

## 2026-07-19 (v) — The legal stages become a branch (`97b719e`) — brief §5 decision 1
First of the four blocked decisions to land. Kevin chose **option B** after the question was reframed by
reading the code.

### The question answered itself on inspection
Brief §5.1 asked whether `exemption_review` / `ag_review` should be always-on or city-configurable.
**They were already city-configurable everywhere except the order.** `POST /requests/:id/assert-exemption`
reads `jurisdiction_profiles.exemption_model` and picks between them — `pre_clearance` (Texas: AG
pre-clearance, statutory clock tolled) vs `self_court` (13 states) / `self_appeal_court` (6). The exits
already returned to `redaction_review`, and the `legal_review` resolution and `/ag-ruling` already shared one
outcome vocabulary. **Entry was conditional and exit was a return — only the sequence still treated them as
steps.**

So the fix is not a new capability, it is removing a contradiction: `SEQUENCE` (8) is now separate from the
vocabulary `ORDER` (10), and `next()` walks the sequence.

### ⚠️ TWO defects, and the one in the brief was the smaller
1. `next()` was positional, so Advance offered **“Advance to: Exemption Review”** from `record_search`.
2. **Completing a record search advanced to `exemption_review` UNCONDITIONALLY** (`routes/tasks.js`). Every
   request that found records entered a legal stage, spawned a `legal_review` task, and had to be adjudicated
   *(sustained / partial / overruled)* before it could be redacted — **whether or not anyone had asserted an
   exemption over anything.** The Advance button merely *offered* the wrong stage; this one **took it
   automatically**, on the normal path.

Both survived because **no live request has ever gone past `record_search`.** In the 19 of 20 seeded
jurisdictions that are not Texas, `ag_review` is a step that cannot legally apply.

`next()` returns **null** for a branch stage, so no Advance renders there: leaving a legal review is a legal
act with a required note, and must not be reachable by a generic advance that records no reasoning. **No
stranding** — the `legal_review` resolution and `/ag-ruling` are the exits, both already built and tested.
`ORDER` keeps all ten because `applyStageTransition` judges "forward" against it for tickler clearing.

### The test that matters, and a parity gap that was open
`verify_stages` now asserts **no stage in the vocabulary advances into a legal stage** — so this cannot
regress from any direction, rather than pinning one transition.

**A real gap was found while verifying:** parity checked the frontend mirror's stage LIST but not its walk, so
the frontend could carry the identical ten stages and still advance linearly — putting the button straight
back while the backend branched. `GET /api/stages` now serves `sequence` and `branch`, and four new
assertions check the mirror against them. **Break-tested by reverting the frontend mirror alone: it fails.**

### Verification
**884/884 green, live census clean.** Break-tests performed and reverted: restoring the positional `next()`
fails 3 in `verify_stages`; restoring the unconditional search destination fails 4 across
`verify_search_resolve` / `verify_search_intent_gate`; reverting the frontend mirror alone fails the new
parity assertion. API restarted and confirmed serving the 8-stage sequence with both branch stages returning
null. **Frontend rebuilt and redeployed** (`CI=false NODE_OPTIONS=--openssl-legacy-provider npm run build`) —
without that the mirror is a built asset and the fix would have been live in the API but not in the UI.

Three tests had encoded the defect as expected behaviour (`verify_search_intent_gate` C10/G2,
`verify_search_resolve` D2/D4) and were flipped, and `verify_stages`' old assertion said the previous
frontend "jumped straight to redaction_review" — **it had been right about the destination for the wrong
reason.**

### Next session
1. **Three of Kevin's four decisions remain** (brief §5): single-record vs the MRR hub (3),
   `commercial_rate` / `mrr_processing` build-or-delete (4), retire the v1 redaction duplicates (5).
2. **Flagged and NOT decided:** the sequence still puts `fee_review` / `awaiting_payment` **before**
   `record_search` — an estimate and a deposit before the search that reveals what the records are. Coherent
   (reconciliation trues it up) but it means the first number a citizen sees is quoted before anyone has
   looked. **Raised with Kevin, deliberately left open.**
3. Still standing: dunning is inert, `routing_review` fires per child, Part H of the attribute inventory.

---

## 2026-07-19 (w) — The v1 redaction duplicates, retired (`2057e46`) — brief §5 decision 5
Second of Kevin's blocked decisions to land. **The brief was half wrong about what the duplicates were, and
the wrong half is the whole finding.**

### One was never a duplicate
§2.3 said `RedactionWorkspacePage` and `RedactionReviewPage` "do what `RedactionTaskPage` does task-aware."
True of the second, false of the first:

- **`RedactionReviewPage` — DELETED.** Genuinely superseded; `RedactionTaskPage` has its own side-by-side, and
  this page's only inbound link was a button on the v1 workspace.
- **`RedactionWorkspacePage` — KEPT, and scoped.** It is the canvas for redaction **TEMPLATE authoring** —
  sample documents uploaded from `MassRedactionPage` onto `req-template-samples` (`SYS-TEMPLATE-SAMPLES`), a
  **purge-protected pseudo-request carrying zero tasks by design.** `RedactionTaskPage` is keyed on a `taskId`
  and therefore *cannot* open those files. Deleting it on the brief's say-so would have silently removed
  template authoring. A banner at the top of the file now states this, so the next sweep does not repeat the
  read.

### ⚠️ What was actually duplicated was an ENTRY POINT, not a page
The per-record **`Redact` / `Auto-redact` button** on the request workspace (`RecordsPanel`) sent a **citizen
record** into the task-less v1 canvas. That screen carries **no work timer**, so redaction labour on anything
opened that way was **never measured** — and labour is billable, so **the city under-billed for it.** That
button is what needed retiring. Redaction now happens only at `/redaction/:taskId`, reached from My Tasks. The
template-match badge stays: it is information, not a way in.

### What I checked rather than assumed
I expected the v1 screen to bypass the slice-4 Elevated/Legal second-review gate. **It does not** —
`gateApply` is enforced in `POST /redaction-jobs/jobs/:id/apply`, in the route, not the UI. The loss was
measurement, not the gate. Worth recording because the opposite would have been a much louder finding, and
asserting it without looking would have been wrong.

### Verification
**896/896 green, live census clean.** New harness `verify_v1_retirement` (12), registered — a **source scan**
in `verify_stages`' ghost-check idiom, because the defect is a link that exists. **Break-tested twice:**
re-adding the per-record button fails B1/B2 (and names the file:line); resurrecting the deleted page fails
A1/A2. §D is the standing premise — it asserts the holding area still has zero tasks and is still
purge-protected, so **if that ever changes the survivor DOES become a real duplicate and D2 is what notices.**

Frontend rebuilt and redeployed — the deleted import would otherwise have broken the bundle; `Compiled
successfully`, UI serving 200.

### Next session
1. **Two of Kevin's five §5 decisions remain:** 3 — single-record vs the MRR parent hub (§14.3, design-gated);
   4 — `commercial_rate` / `mrr_processing` build-or-delete (currently assignable to people, permanently empty
   pools).
2. **Still open and NOT decided:** the sequence puts `fee_review` / `awaiting_payment` before `record_search`
   — an estimate and a deposit quoted before anyone has looked. Raised in (v), deliberately left.
3. Still standing: dunning is inert, `routing_review` fires per child, Part H of the attribute inventory.

### ⚠️ The standing lesson, third session running
(q), (r) and (v) all ended with "read the implementation before believing the sweep." This session is the
cleanest instance yet: **acting on the brief's §2.3 line alone would have deleted a working feature**, and the
only thing that prevented it was checking what actually linked to the page before removing it. **A document
that lists something as dead is a hypothesis, not a finding.**

---

## 2026-07-19 (x) — `commercial_rate` / `mrr_processing` deleted from the catalog (`ff32305`) — brief §5.4
Third of Kevin's five decisions to land. Small and clean; the interesting part is what it is *adjacent* to.

### The defect was a promise the router could not keep
Both types sat in `ROUTABLE_TASK_TYPES` and in the per-person picker on Staff Management, but **nothing
spawns either** — there is no `createTask({type:'commercial_rate'})` or `'mrr_processing'` anywhere in the
codebase. So a supervisor could grant a person work that can never arrive: a **permanently empty pool**. An
entry in that list is a promise the router can deliver that type, and neither could.

**Checked live before cutting:** zero `user_task_types` rows for both, zero tasks, zero `time_budgets` rows.
Nothing orphaned, no migration. (Only `routing_review` is assigned to anyone at all today.)

### ⚠️ `mrr_processing` deletes a CATALOG ENTRY, not a DESIGN
It is still the designed routing mechanism for the MRR parent hub (§14.3, MASTER §A2) — **which is brief §5
decision 3 and remains OPEN.** Deleting the key does not settle that decision. If the hub is built, re-add it
*alongside the code that spawns it*. Recorded at the removal site in `taskRouting.js` and in the MASTER doc,
so the next agent does not have to rediscover why it vanished — or, worse, read its absence as the hub being
rejected.

### The guard the original problem asked for
Brief §2.2 noted **three catalogs disagreeing** (`TASK_ROLES` 8, `ROUTABLE_TASK_TYPES` 9, `time_budgets` 8) —
and they drifted precisely because nothing ever compared them. `verify_v1_retirement` §E now does:
**E3** asserts the Staff Management picker offers nothing the router cannot route, **E4** stops E3 passing
vacuously on an empty picker, and **E2** asserts nothing spawns the removed types — the premise for removing
them — so if that ever changes the suite says so instead of the pool quietly filling.

**Known and deliberately not fixed:** `redaction_qa` is real but still absent from `ROUTABLE_TASK_TYPES`.
Different defect, and folding it into a deletion slice would have hidden it.

### Verification
**901/901 green, live census clean.** Break-tested both directions: re-adding the type to the picker fails E3
and names it; re-adding it to `ROUTABLE_TASK_TYPES` fails E1. Frontend rebuilt and redeployed
(`Compiled successfully`, UI 200).

### Next session
1. **ONE of Kevin's five §5 decisions remains: 3 — single-record first, or the MRR parent hub too?** (§14.3,
   design-gated.) Everything else in §5 is answered. Note this decision now has a small dependency: building
   the hub means restoring the `mrr_processing` catalog entry.
2. **Open, raised, not decided:** the sequence puts `fee_review` / `awaiting_payment` before `record_search` —
   an estimate and a deposit quoted before anyone has looked (raised in (v)).
3. **`redaction_qa` missing from `ROUTABLE_TASK_TYPES`** — surfaced twice now; a genuinely small slice.
4. Still standing: dunning is inert (`verify_nonpayment_scope.js` written and waiting), `routing_review`
   fires per child, Part H of the attribute inventory.

---

## 2026-07-19 (y) — `redaction_qa` joins the v3 model, and the claim pool stops hiding work (`6b66b84`)
Brief §3.5, the routing split-brain. **"Add `redaction_qa` to the list" would have been wrong twice over**, so
three coupled defects landed together.

### 1. Reviewing a redaction is not the same competence as doing one
`redaction_qa` was excluded from `ROUTABLE_TASK_TYPES`, so it could never be granted to a person and was
pinned to legacy permission-role routing forever — while its Legal sibling (`legal_redaction`) used the v3
model. Worse: an Elevated review resolved through `ROLE_TO_TYPE` to the task type **`redaction`** — the *same
token as doing a redaction*. This task exists precisely because the reviewer must be a different person from
the author; routing it on the author's competence was the wrong axis.

### 2. ⚠️ TWO DIVERGENT CLAIM-POOL QUERIES — already live, already biting legal work
`taskRouting.poolForUser` checked permission roles **or** `user_task_types`. The route `GET /tasks/pool`
checked permission roles **only**. So every task whose `role_required` is a v3 token — `legal_review`,
`legal_redaction`, `routing_review` — was **invisible in the claim pool** while the service happily listed it.
**A task nobody can see is a task nobody claims, and it does not look broken; it looks quiet.** Now one shared
`POOL_ELIGIBILITY_SQL` used by both readers, so they cannot drift again.

This is why the slice grew: switching `redaction_qa` to a v3 token *without* fixing this would have moved it
into the invisible set.

### 3. The cutover that cannot strand the mandatory review
Switching naively would have routed the review to a token **nobody holds** — and an Elevated/Legal redaction
cannot be RELEASED until a different person approves it, so **a stranded review task blocks release of every
Elevated redaction in the system.** The token is therefore chosen at **spawn time** (`hasSeededType`), which
is the per-(team, type) cutover the design already documented, applied where it is safe:

- nobody granted → Elevated review routes to `REDACTION_WORKER`, exactly as today (no behaviour change);
- someone granted → the next review routes on `redaction_qa`, so **the grant actually takes effect**.

That last clause matters: without it, adding the key to the picker would have recreated the empty-promise
defect deleted three commits earlier in (x).

### Verification
**915/915 green, live census clean.** New harness `verify_qa_routing` (14), registered. **§B4 revokes the
token and asserts the task disappears**, so §B cannot pass merely by the predicate being permissive. §C is the
guard (C1 legacy when unseeded, C3 the new token once granted, C4 a task spawned either way). **§D re-asserts
the safety property this slice sits beside** — the author still cannot release their own Elevated redaction —
because a routing change must never loosen that gate.

Break-tested: restoring the route's private pool query fails B2/B3; switching the spawn to the v3 token
unconditionally fails C1. Frontend rebuilt and redeployed.

One self-inflicted stumble worth noting: §C first failed because `spawnReviewTask` is idempotent per request
and §B's task was still open on the same request — it correctly refused to spawn a second one, and my test
would have proved nothing. Fixed by giving §C its own request.

### Next session
1. **ONE §5 decision remains: 3 — single-record first, or the MRR parent hub too?** (§14.3, design-gated.)
   Building the hub also means restoring the `mrr_processing` catalog entry deleted in (x).
2. **⚠️ STILL OPEN from §3.5, and it is a security-shaped hole:** `review_auto_redaction` spawns with
   `role_required` NULL, and NULL is treated as "everyone eligible" — **world-claimable by any authenticated
   user.** Deliberately untouched here to keep the slice bounded, but it is the last bullet of the same
   section and should not sit much longer.
3. Open, raised, not decided: `fee_review` / `awaiting_payment` before `record_search` (from (v)).
4. Still standing: dunning is inert, `routing_review` fires per child, Part H of the attribute inventory.

### Addendum to (y) — the world-claimable task, closed (`1218d67`). §3.5 is now fully fixed.
The last bullet of the routing split-brain, and the one with teeth.

`role_required` NULL meant **"everyone eligible" in BOTH readers**: it was the claim-pool predicate's *first*
branch, so such a task was advertised to every authenticated user, and `claim()` **skipped its eligibility
check outright** (`if (task.role_required && ...)`). `review_auto_redaction` spawned exactly that way — it had
no `TASK_ROLES` entry — so **an auto-redaction batch could be claimed and worked by anyone with a login, in
any department, with no redaction competence at all.**

Fixed at three levels, because fixing only the first would have left the door open:

1. **The instance** — `review_auto_redaction` → `REDACTION_WORKER`.
2. **The class** — `createTask` now **refuses** to create a task whose type resolves no role. Failing at
   *creation* is deliberate: loud, at the point the omission is made, instead of a row that looks ordinary and
   is quietly open to everyone. This matters because `POST /api/tasks` passes `roleRequired` straight from the
   request body, so any future type could have repeated the defect.
3. **Defence in depth** — both readers now treat NULL as *nobody* rather than *everybody*.

**Live carried zero role-less tasks**, verified before and after, so nothing legitimate was hidden. All 5 open
live tasks still carry a role; API restarted and healthy.

**⚠️ E6 is a POSITIVE CONTROL and the most important assertion in the section:** an eligible user can still
claim a properly-roled task. Failing closed is only correct if ordinary work still flows — **a guard that
denied everything would have satisfied every other assertion here while breaking the product.** Any future
fail-closed change in this codebase deserves the same paired control.

**921/921 green, live census clean.** Break-tested all three levels independently: restoring the claim-guard
skip fails E5; restoring NULL as the predicate's first branch fails E4; dropping the creation guard fails E3.

**Board:** brief §3.5 is fully closed. **ONE §5 decision remains — 3, single-record vs the MRR parent hub.**

---

## 2026-07-19 (z) — Single-record first; the MRR hub is deferred — brief §5.3. **ALL FIVE §5 DECISIONS ANSWERED**
Kevin's call, and the last of the decisions that had blocked Phase 1 for three sessions. **Documentation slice,
no code** — the decision is to *not* build something, and the honest work is recording what that does and does
not defer.

### What was decided
**Single-record first. The MRR hub (§14.3) is not being built.** The design is **not withdrawn** — it stands
as the reference for whenever it is picked up. `BUILD_PRIORITY` #11's "blocked on design" note is replaced:
it is not blocked, it is deliberately not being built.

### ⚠️ What it does NOT defer — the part that matters
**Multi-record requests still arrive.** The portal emits n children, the wrap is built, and the queue already
renders parent + indented children (§7). Deferring the hub does not make n > 1 go away; it means **the queue
and the task list are the only staff surfaces for a multi-record request.**

### The finding: a standing board item was mis-recorded, and this decision is what exposes it
`routing_review` fires **per child** — confirmed live, one parent carries **3** (parent `312252fc…`, 3
children). Since (q) this has sat on the board as a defect to squash: "an ORO Associate resolves the same
citizen request three times."

**That framing is wrong.** `department_id` is a **child** field, and each child is classified on its **own**
description — so a 3-child request spanning 3 departments genuinely needs **3 routing decisions**. Three
*decisions* is correct. Three *separate tasks in a worklist* is a presentation problem — **and the designed
answer to that presentation problem was the hub just deferred.**

So it is not a bug awaiting a small fix; it is now an **accepted cost**, until either the hub is built or a
narrower aggregation is designed. Recorded at §14.3 with an explicit warning: **do not "fix" it by deduping to
one task per parent without first deciding where the other two routing decisions get made** — that would
silently drop two departments' routing.

### A coupled question settled for free (§15)
(q) left open: *what a city sees if an MRR arrives while the MRR rule matrix is blank* — "needs deciding before
build." Deferring the hub answers it by observation rather than by decision: **accepted and wrapped normally,
every hub-dependent behaviour inert.** That is what the system does today and, with no hub coming, what it will
keep doing. The matrix's six rows are all no-ops at n = 1 and inert without a hub, so a blank matrix blocks
nothing that exists. **Marked as asserted-from-behaviour, not from a test** — verify before building on it.

### Verification
**921/921 green, live census clean** (docs-only; the suite was run to confirm nothing was disturbed). Live
re-probed read-only to confirm the routing_review claim rather than repeating it from (q).

### Next session — the board is now decision-free
1. **Phase 1 of the processing rebuild is UNBLOCKED.** All five §5 decisions are answered: the 10-stage order
   (v), stub notes (07-18), single-record vs hub (this), the task-catalog deletions (x), the redaction
   duplicates (w). §3.2's resolution remains the reference implementation for every stub: type check →
   required note → mark done → `applyStageTransition`.
2. **Dunning is inert for every wrapped request** — `verify_nonpayment_scope.js` is written and deliberately
   unregistered; it fails today by design. Register it the moment the money axis moves to the parent. This is
   the largest *known live defect* left on the board.
3. **Open, raised, never decided:** `fee_review` / `awaiting_payment` sit before `record_search` — an estimate
   and a deposit quoted before anyone has looked (raised in (v)).
4. Part H of `WORKING_attribute_inventory.md`; (q)'s deliberately-undone items (`dev_mode = '1'`, the
   `PARTIALLY_GRANTED` notification rows, the RM hold override's WA-entitlement guard).

---

## 2026-07-19 (aa) — Dunning was inert for every wrapped request; fixed (`6487e61`) — brief §3.1b
The largest known live defect on the board, open since (q) with its reproduction harness written and
deliberately left failing. **Fixed, registered, green.**

### The defect
Money is a PARENT fact, but every UI path writes the estimate against the CHILD it is looking at.
`feeNonpayment.sweep()` is PARENT-scoped — deliberately, because unscoped it would send the citizen
**duplicate** dunning emails — and then asked `computeSituation(parentId)`, which looked for
`request_fee_estimates WHERE request_id = <parent>`. The parent has none. `hasEstimate` was false, `continue`
fired, and **for every wrapped request in the system no dunning email was ever sent and non-payment
auto-close never fired.** The parent-scoping succeeded completely at preventing duplicates — by making
dunning never happen at all.

### Resolve-through, not a migration
Estimates stay where the UI writes them; the money QUESTION is answered over the whole tree — the same
technique `feeRelease.COVERING` uses for the release gate. **Nothing moves, so there is no backfill to get
wrong**, and at n = 1 every rule is an identity, so ordinary requests are untouched.

Aggregation, each the conservative reading for a citizen: totals/credits/refunds/payments **SUMMED**;
`workComplete` = **EVERY** estimate-bearing row reconciled (one child still being worked must not trigger a
demand for the whole request); `accepted` = **EVERY**; `waived` = **ANY** granted; `delivered` = **EVERY**
leaf. Latest-per-row is preserved before summing so a reissue is not double-counted.

**This also removes a dependency:** §3.1b said the roll-up question "should be decided with the MRR hub."
The hub was deferred that same day (§5.3) — and the roll-up turned out to be a *read* rule, so it did not
need the hub at all.

### ⚠️ THERE WERE TWO HALVES, AND FIXING ONE LOOKED CONVINCING
`clockStart()` — which decides whether the sweep proceeds at all — **also** read `notified_at` off the
PARENT, while `notified_at` is stamped on the CHILD's estimate. With only `computeSituation` fixed, the
harness's §B passed on visibility and **the sweep still sent nothing.**

That is why §C was added to drive the real sweep end-to-end, and §C is what caught it. **Visibility was never
the harm; silence was.** Break-testing confirms the split: reverting `clockStart` alone fails C6/C7 while
every §B assertion still passes.

### A test-isolation lesson worth carrying
§C first asserted `res.actions.dunned === 1`. It passed alone and **failed in the full suite** — the sweep
runs over every active request, so the counter also picks up whatever other harnesses left behind. Rewritten
to judge **its own row** (the parent's `nonpayment_dunning_at` stamp). **A test of a global sweep must assert
about its own data, never a global counter.**

### Verification
**935/935 green, live census clean.** Harness now 14 assertions and REGISTERED. Break-tested both halves
independently. API restarted and healthy; live probed read-only — **all four live parents report
`hasEstimate=false` (there are no estimates yet) and `nonpayment.enabled = false`**, so nothing fires today.

⚠️ **Operational note for go-live:** dunning now *works*, and it emails citizens. A system that accumulated
unpaid wrapped requests while this was inert would dun that backlog the moment it is enabled. Live has none;
check before switching it on. Recorded in brief §3.1b too.

### Next session
1. **Phase 1 of the processing rebuild** — unblocked since (z); all five §5 decisions answered. §3.2's
   resolution is the reference implementation for every stub.
2. **Open, raised, never decided:** `fee_review` / `awaiting_payment` sit before `record_search` — an estimate
   and a deposit quoted before anyone has looked (raised in (v)).
3. Part H of `WORKING_attribute_inventory.md`; (q)'s deliberately-undone items (`dev_mode = '1'`, the
   `PARTIALLY_GRANTED` notification rows, the RM hold override's WA-entitlement guard).
4. Brief §3.4 (no from-`closed` guard) and §3.6 (two fragile couplings) are the last unaddressed §3 items.

---

## 2026-07-19 (ab) — The money stages are a branch too (`d1b04e1`) — the fee-before-search question, answered
The question I raised twice in (v) and (aa) and never got a ruling on. Kevin asked for it to be worked.
**It answered itself on inspection, and my framing of it was wrong both times.**

### The question, and why it dissolved
I asked whether `fee_review` / `awaiting_payment` belong **before** `record_search` — an estimate and a
deposit quoted before anyone has looked at the records. That framing assumed requests pass through them.
**They do not:**

- **`fee_review` is never set by anything.** Not one `applyStageTransition` to it exists in the codebase. It
  is in **neither `STAGE_TASK` nor the reconciler sweep**, so a request advanced into it gets **no task and is
  not swept** — the same shape of stranding §3.2 fixed for `legal_review`. **The Advance button at `intake`
  offered exactly that.**
- **`awaiting_payment` is a real state, but the fee flow moves it, never the button:** entered by the
  non-payment reopen; left by a recorded deposit, a recorded payment, or the ERP settlement webhook — each
  transitioning explicitly to `record_search`.
- The only rule that advances past intake (`wfr-confident`) goes **straight to `record_search`**, and live
  `workflow_decisions` contain only `intake` and `record_search`. **`fee_review` has never been decided once.**

So money is a **branch off the spine**, exactly as legal review is. The real shape is `intake → record_search`,
with the fee flow a detour that rejoins there. **The sequence is now six:**
`intake → record_search → redaction_review → redaction → delivery → closed`.

### The same irony, twice in one day
Two `verify_stages` assertions encoded the old premise. One **mocked the old frontend** for saying
`intake → record_search` and "skipping the money" — **the old frontend was right, for the wrong reason**,
exactly as it was about `redaction_review` in (v). The other asserted the UI must NOT offer Record Search from
intake, calling it "the legacy destination"; it is now the correct one, so it was **inverted rather than
deleted** — what is worth guarding is that the button matches the canonical walk.

**Twice in one session a test encoded a defect as expected behaviour and disparaged the code that was right.**
When an assertion's comment editorialises about what some older component "got wrong", that is worth a second
look.

### ⚠️ Left for Kevin
**`fee_review` has no writer at all.** Kept in the vocabulary for now, but **wire it or delete it** is open —
it is the same question asked of `commercial_rate` / `mrr_processing`, which were deleted in (x). Deleting it
would shrink the vocabulary to nine; wiring it means deciding what puts a request there and what task it
spawns.

### Verification
**937/937 green, live census clean.** Break-tested: putting the money stages back on the linear path fails 5,
including the **Playwright assertion that the real Advance button offers "Record Search"** and the frontend
branch-parity check. Frontend rebuilt and redeployed.

### Next session
1. **Phase 1 of the processing rebuild** — unblocked, all decisions answered. §3.2's resolution is the
   reference implementation for every stub.
2. **`fee_review`: wire or delete** (above) — small, and the last loose thread in the stage vocabulary.
3. Brief **§3.4** (no from-`closed` guard) and **§3.6** (two fragile couplings) are the last unaddressed §3
   items. §3.5 and §3.1b are now closed.
4. Part H of `WORKING_attribute_inventory.md`; (q)'s deliberately-undone items.

### Addendum to (ab) — `fee_review` deleted (`bd7f232`). The vocabulary is nine.
Kevin's call on the thread (ab) left open. Nothing in the codebase ever set it, it was in neither `STAGE_TASK`
nor the reconciler sweep, and **live carried zero of everything**: zero requests at that stage, zero
`request_history` rows naming it in `stage_from`/`stage_to`, zero `workflow_decisions`, zero rules emitting
it. Nothing to migrate, no history to orphan — the same pre-deletion check the three dead money columns got.

**A stage nothing can enter is not a stage.**

**⚠️ The sweep surfaced something better than the deletion itself:** `WorkflowPage.js` carried its **own
private 4-stage label map** — the exact divergent-vocabulary defect `verify_stages` exists to catch, on a page
its private-copy check simply did not name. It also still advertised `fee_review`. It now imports the shared
vocabulary, and **the check covers 6 files instead of 5**, so the gap is closed rather than noted.

That is the second time in two slices that deleting something dead exposed a live gap next to it (the first
being `clockStart()` in (aa)). **Deleting a dead thing is a good excuse to read its neighbours.**

**938/938 green, live census clean.** Break-tested both: reinstating the stage fails 5 (including the frontend
mirror parity, the label/colour count, and the Playwright Advance-button check); restoring the private map
fails the widened check and names the file. Frontend rebuilt; API and UI both 200 on the new vocabulary.

---

## 2026-07-19 (ac) — Phase 2 begins: the legal review has a screen (`5393037`, `643fdd7`, `06fa2eb`, `71d3b88`)
Kevin asked for the legal review screen. Built, verified end-to-end in the running UI, **947/947 green, live
clean.** Building it surfaced three defects that are NOT fixed and are the most valuable thing here.

### What shipped
1. **`5393037` — SPEC §9's tokens move to `lib/theme.js`.** They lived as a private `var C` inside
   `RecordSearchTaskPage.js`, so a second v2 screen could obey §9 only by copying them — the
   divergent-private-copy defect `verify_stages` was widened to catch in (ab). Verbatim move, no pixel change.
   ⚠️ **Not a promotion:** §9's "record-search MOCKUP only" scope decision stands. ⚠️ **It is a TRANSCRIPTION:**
   the tokens originate as CSS custom properties in `PublicPortalV2Page.js` (`.scv`), which is **dark-mode
   aware** and carries seven tokens this subset drops. The two are still not unified.
2. **`643fdd7` — `LegalReviewTaskPage` + `legal-review/:taskId`.** The Phase 2 three-part shape; copy it for
   the remaining stubs. `timeCaptureConfig` `legal` flipped `available: false → true` (that flag is a
   build-status ledger — flip it in the same commit as a screen or the config panel disables real work).
3. **`06fa2eb`, `71d3b88`** — the two corrections below, and the test fix.

### ⚠️ It was resolvable for a full DAY before it was reachable
§3.2 landed `/tasks/:id/resolve` on 07-18 with **18 green assertions**. `TASK_SCREEN` in `MyTasksPage` had no
`legal_review` entry, so the task fell through to `/requests/:id` — a page with no resolution control. **A
legal review was completable only by curl, and the suite was green the whole time**, because the harness
tested the endpoint and never the reachability. `verify_legal_review` §H now closes the **class**: H4 derives
the accepted types from the resolve route's own type guard and fails, naming any that lack a screen.

### ⚠️ THREE DEFECTS FOUND, NOT FIXED — for Kevin
1. ~~**`/tasks/:id/resolve` never checks task STATUS.**~~ **FIXED same session (`818b2d6`).** It checked the
   type and nothing else, so a **cancelled** or **done** task was still resolvable — and resolving runs
   `applyStageTransition`, so it **moved a request**. Observed for real: a cancelled task was decided through
   the UI and advanced the request to `redaction_review`. Nothing stopped a task being resolved **twice**
   either. Now **409 `TASK_NOT_ACTIONABLE`**; `taskRouting.ACTIONABLE_STATUSES` is exported rather than
   re-typed, because that list is duplicated as a SQL literal in ~6 places and **the duplication is how the
   hole survived**. `verify_legal_review` §I (7 assertions) tests it over the API — the load-bearing ones are
   I3/I6, **the request does not move** — plus I7, that an `in_progress` task still resolves (not over-broad).
   Break-tested: removing the guard fails 4, including both did-not-move assertions.
   ⚠️ **The ~6 SQL literals still carry their own copies** — a separate mechanical pass.
2. ~~**`assert-exemption` writes the stage to whichever row it resolves — including a PARENT.**~~
   **FIXED 2026-07-19 (`cbc9e46`) on Kevin's ruling.** It does
   `SELECT ... WHERE id = ? OR request_number = ?` and hands the row straight to `applyStageTransition`, so
   asserting against a parent id moves the **parent** and spawns `legal_review` there, while the **child**
   carrying the real work stage sits at `intake` with its own open `routing_review`. Stage is a CHILD fact
   (CLAUDE.md); a parent carrying one is the legacy pseudo-request shape §2.4 flags. **The screen no longer
   trusts `task.stage`** — it derives the branch from the assertion (`AG_PRECLEARANCE_SUBMITTED` vs
   `EXEMPTION_ASSERTED`), which is the durable fact. The underlying write is untouched.
3. ~~**A late intake routing decision REVERTED an asserted exemption.**~~ **FIXED same session
   (`cdf1845`).** On one child:
   `EXEMPTION_ASSERTED intake → exemption_review`, then `STAGE_ADVANCED exemption_review → intake`
   ("Automatic classification was unavailable. Low match confidence; routed…"). **A legal act, silently
   undone by the workflow engine**, leaving the `legal_review` cancelled behind it. Seen when the assertion
   raced async classification; the same race exists with a *successful* classification.
   **The guard already existed and stopped one field short:** `onIntake` re-reads before applying — its own
   comment says the top read "is stale by now" — but checked only `status === 'closed'` while `stage` still
   came from the stale read. Now **stated as a POSITION, not a race**: the engine may set the opening stage
   only while the request is still AT its opening position (`intake`, or null for a parent). ⚠️ The first cut
   was a lost-update comparison of the two reads and **the harness caught it** — that catches the race only
   when `onIntake` STARTS before the move, and misses a call landing wholly afterwards. Routing metadata is
   still applied; the estimate spawn is not. Declining is recorded (`ROUTING_DEFERRED`) — the overwrite was
   hard to find precisely because standing down left no trace. `verify_stage_bypass` §4 (9 new), including
   **the legal_review task still being live**, which is the real damage. Break-tested: 4 fail without it.

### Lessons worth keeping
- **Break-testing caught a worthless assertion.** H8 first matched the token `ACTIONABLE` anywhere in the
  file and **passed with the guard deleted** — the comment above it said "cancelled". Source scans must strip
  comments and match the guard EXPRESSION. Fixed in `71d3b88`.
- **A green harness over an unreachable feature is the failure mode to watch for.** Test the reachability, not
  just the endpoint.
- **Verifying in the running app is what found all three defects.** None were visible from reading source.
- Verification used a **`--keep` test stack on :3101 with Playwright rerouting `/api/**`** to it — the real
  built SPA against the test DB, live untouched. ⚠️ Kill that API before `npm test` or it holds :3101 and the
  suite's own instance can't bind (cost one spurious `verify_v1_retirement` D1 failure).

### Next session
1. **The three defects above** — (1) is the smallest and the sharpest; (2) and (3) are parent/child + workflow
   engine and want a decision, not just a patch.
2. **Phase 2 continues:** `fee_waiver` and `routing_review` still fall through to `/requests/:id`;
   `review_auto_redaction` links to `/mass-redaction` with no route of its own. Copy `LegalReviewTaskPage`.
3. Brief **§3.4** and **§3.6** are still the last unaddressed §3 items.
4. Part H of `WORKING_attribute_inventory.md`; (q)'s deliberately-undone items.

### Addendum to (ac) — the resolve status guard landed (`818b2d6`)
Kevin's call on defect 1 above, fixed the same session. **954/954 green, live clean**, API restarted and
healthy on the new code. Details in the entry above and in brief §3.3.

**The general lesson is the one to keep:** `/resolve` existed *because* `POST /tasks/:id/complete` was a
loaded gun (§3.3). Its replacement shipped with a narrower version of the same hole — it validated what
*kind* of task it was and never whether the task was still *live*. **Deleting a dangerous endpoint does not
make its successor safe; the successor needs its own audit.** Two defects remain open from (ac): the
`assert-exemption` parent/child stage write, and the workflow engine reverting an asserted exemption.

### Addendum to (ac) — the exemption revert is fixed (`cdf1845`). Two of three defects closed.
**963/963 green, live clean**, API restarted. Details in defect 3 above.

**Both fixes this session were the same shape: a guard that existed and stopped one step short.**
`/resolve` replaced the §3.3 loaded gun and checked the task's TYPE but never its STATUS. `onIntake` re-read
to catch a closed request but checked only STATUS, never STAGE — one field away, in a block whose own comment
explains why the stale read cannot be trusted. **When you find a guard, read what it does NOT cover**; both
holes were inside code written specifically to prevent that class of problem.

**And state invariants as positions, not races.** The first cut of the intake fix was a lost-update check
between two reads, which sounds rigorous and silently missed the case where the whole call lands after the
move. "The engine may only make the opening move while the request is still at its opening position" needs no
reasoning about who read what when — and the harness, not review, is what caught the difference.

**Still open from (ac):** defect 2 — `assert-exemption` writes the stage onto whichever row it resolves,
including a PARENT, so the parent moves while the child carrying the real work stage stays at `intake`. That
one wants a decision about where stage lives for a wrapped request, not a patch.

### Addendum to (ac) — Kevin's parent/child ruling, and the last (ac) defect closed (`cbc9e46`)
**974/974 green, live clean**, API restarted. All three defects from (ac) are now closed.

**THE RULING (Kevin, 2026-07-19) — this is the durable part, not the patch:**

> "the exemption applies to processing a request that has a description of item requested. it's a child
>  record level issue. the parent should be thought of as who requested the information and did he pay for
>  it, etc."

**PARENT** = who asked, the number they quote, the money, the statutory clock.
**CHILD** = the described item and everything about processing it — **stage included**.

This is the rule to apply to every future question of "which row does X hang off?", not just exemptions.

**What was wrong:** `assert-exemption` and its twin `ag-ruling` handed whatever row the CALLER NAMED to
`applyStageTransition`. Naming the parent moved the parent into a legal stage and spawned `legal_review`
there, while the child holding the description sat at `intake`.

⚠️ **Correcting (ac)'s own account:** it said the endpoint "landed on different rows", implying
nondeterminism. **It is deterministic** — it moves whatever row you address; I had passed a child id one time
and a parent id the other. The defect is that naming the parent is possible and *natural*, since the parent
id is the one a caller holds.

**`scope.workRow()` is the piece that was missing.** `requestScope` had SQL predicates for SCOPING a query
and nothing for *"I was handed an id — give me the row this work belongs to"*, so routes improvised by not
resolving at all. A leaf resolves to itself; a parent with one child resolves to that child.
**Ambiguity is refused, not guessed:** a parent with several children gets 409 `AMBIGUOUS_WORK_ROW` with the
candidates, because picking one would attach a legal act to the wrong record.

**The clock stays on the PARENT** — already true in the code (`COALESCE(master_request_id, id)`), and K5 now
asserts it. Same division read from the other side.

~~⚠️ `PATCH /requests/:id/stage` (the Advance button) HAS THE SAME SHAPE and is NOT fixed~~ **FIXED
2026-07-19 (`739670a`)** — see the addendum below.

⚠️ **A test-fixture trap worth remembering:** the first draft of §K built its parent with `mkRequest()`,
whose stage argument defaults to `record_search` when absent — so the "parent" looked like a work row and K3
passed vacuously in the wrong direction. **A parent/child test must build the parent explicitly stage-NULL.**

### Addendum to (ac) — the Advance button, and a route that lied about succeeding (`739670a`)
**981/981 green, live clean**, API restarted. Two defects in the same five lines of `PATCH /requests/:id/stage`.

1. **It advanced whatever row was addressed** — the same shape as `assert-exemption`, on the endpoint the
   workspace Advance button actually calls. Under Kevin's ruling stage is a CHILD fact, so advancing a
   parent-addressed request wrote a work stage onto the parent and left the described record where it was.
   Now resolved through `scope.workRow()`; a multi-record parent is refused (409) rather than advancing an
   arbitrary record. **The release gate moved to the work row too** — `feeRelease.shareFor()` looks for THIS
   row among the estimate's components, so a parent id found no share and degraded to the whole-request test.
   Stricter, never more permissive, so nothing was wrongly released — but it judged a different row than the
   one being advanced.

2. **A failed advance reported success.** The transition sat in a `try/catch` that logged and fell through to
   `{ success: true, stage }`. Any failure — bad stage, DB error, a guard refusing — left the UI showing the
   request as advanced while nothing had moved. **A silent no-op that claims to have worked is worse than an
   error, because nobody goes looking for it.** Now 500 with the message; a missing stage is a 400 up front
   instead of throwing into that swallow. Found while making fix 1 — same five lines, not a separate slice.

**Worth a sweep:** fix 2's pattern — `catch { console.error } ` followed by an unconditional success response
— is not unique to this route. `assert-exemption`'s clock calls use the same swallow (`try {} catch (e) {}`),
deliberately there, but the pattern should be audited wherever a write is followed by an unconditional 200.

### Where (ac) ended
**All four defects raised this session are closed** (`818b2d6`, `cdf1845`, `cbc9e46`, `739670a`), plus the
Phase 2 screen that exposed the first three. 981 assertions green, live untouched throughout, tree clean.

**Next, in order:**
1. **Phase 2 continues** — `fee_waiver`, `routing_review`, `review_auto_redaction` still have no screen.
   `LegalReviewTaskPage` is the template; `verify_legal_review` §H's H4 will fail the moment a resolvable
   type has no screen.
2. **The swallow audit** above.
3. Brief **§3.4** (no from-`closed` guard in the central function) and **§3.6**.
4. Part H of `WORKING_attribute_inventory.md`; (q)'s deliberately-undone items.

---

## 2026-07-19 (ad) — The target process model, written down and diffed (`TARGET_process_model.md`)
Kevin stopped the build to ask whether we were "still rewiring to a design that I don't want." **He was right
to ask, and there is a concrete instance.**

### The failure mode, named
Design intent was being inferred **from the implementation**. Where the implementation is half-built,
"nothing sets this" reads as "this isn't wanted." On 2026-07-19 that reasoning **deleted the `fee_review`
stage** (`bd7f232`) — which Kevin then named as a step in his pipeline. The deletion is trivially reverted;
**the reasoning that produced it is the thing to fix.** `TARGET_process_model.md` inverts the direction: the
model is stated first and the code is measured against it. `DOMAIN_MAP.md` now carries a read-first warning.

### The model (Kevin's words are in the doc verbatim; summary only here)
Four kinds of thing that must not be mixed: **tasks** (work a person does, or that is bypassed with a
recorded basis), **statuses** (conditions that can pause processing — *"Awaiting payment is not work
performed"*), **terminal events** (conditions that stop the flow: non-payment, record not found, no response
to clarification — *"not tasks"*), and **parent-level computation** (fee calculation across children,
triggered by a child task completing). The pipeline belongs to the **child**; flow is driven by **task
completion**; every task type gets its own screen that lets someone *process the task* rather than navigate
to pieces of it.

### The diff — 8 divergences, verified
Aligned already: child-level pipeline, parent = requestor/money/clock/number, one-screen-per-task-type in
progress, terminal conditions exist, payment off the linear walk.

- **D1** engine is **stage-driven**, model is **task-driven** (`STAGE_TASK` — stages spawn tasks). Assessed a
  **thin seam**: screens already call one function on completion; its internals and the source of truth change.
- **D2** **`fee_review` deleted today** — direct collision. Recommend restoring.
- **D3** **no parent-level fee aggregation across children at all** (spec corrected the same day to say so).
  The model makes it **required**, not deferred. **Largest gap.**
- **D4** estimate is a task at intake, not a pipeline step; no data-collection / calculation split.
- **D5** `awaiting_payment` is a **stage value**, but the model calls it a **status that pauses** — i.e. a
  second axis. A child cannot currently be *at* record search *and* paused. **Schema question, not vocabulary.**
- **D6** bypass exists for **redaction only** (`redactionBypass.js` is exactly the right shape — a basis and a
  `System` attribution instead of a user — but it is not general).
- **D7** `intake` and `delivery` spawn **no task**, yet both are steps in the model.
- **D8** terminal events work but are three bespoke paths, not a modelled concept.

### Consequence for work in flight
**Task screens are safe to continue** — the three-part shape survives both models; only what the completion
action calls changes. **Stage-vocabulary and branch modelling should stop** until the model is ratified; that
is exactly where the two bad inferences of 2026-07-19 landed.

### Next session
1. **Kevin's answers to §5** — priority order: is `awaiting_payment` a second axis (D5, schema); does
   parent-level fee aggregation come back on the roadmap (D3); how literal is "driven by task completion"
   (D1); are intake review and delivery tasks (D7); then the legal path (§3, deliberately OPEN).
2. Only then: restore `fee_review` and resume pipeline work.
3. Unblocked meanwhile: the remaining Phase 2 screens (`fee_waiver`, `routing_review`,
   `review_auto_redaction`), and the swallow-audit fixes 1–3 in `BACKLOG.md`.

---

## 2026-07-20 (ae) — Swallow fixes 1–3, and a lost conversation to reconstruct

### ⚠️ READ FIRST — context was lost, and it has not been recovered
Kevin's connection dropped after `f67fda5` (2026-07-19 20:37 UTC, the D5 ruling). **Nothing after that
commit was written to disk** — verified: no commit and no `docs/` mtime later than 2026-07-19.

- **Saved:** the task-vs-stage discussion. `TARGET_process_model.md` holds the model in Kevin's words,
  divergences D1–D8, and D5 ruled.
- **LOST:** everything after — in particular Kevin's request to **research all 50 states and produce a
  comprehensive, parameterized list of the rules the system must consider when processing a request.**
  That discussion left no trace. **Kevin is rewriting it as a doc and uploading it.** Do not try to
  reconstruct it from memory; wait for his doc.

**Prior art that already exists** (both **2026-06-24** — a month old, NOT from that conversation, and
covering **5 states, not 50**): `JURISDICTION_RULES.md` (TX/CA/FL/NY/WA; Part A is 10 axes the
Jurisdiction Profile must parameterize) and `AUTO_CONFIG_DESIGN.md` (governing spec — *"expressiveness
precedes automation"*, PARAMETERS vs STRUCTURE/BEHAVIOR, §6 instruction-set catalog as the completeness
guarantee). **When Kevin's doc lands, reconcile it with these two explicitly** — supersede them or build
on their axis structure. Two competing rule catalogs would be worse than either.

### What was built (`b706c8f`)
Swallow-audit items **1–3**, the set the audit itself called mechanical and said to fix together. Each was
a real write in a log-only or bare catch, inside a handler that then answered 2xx unconditionally.

1. **`PATCH /requests/:id/route`** — request moves teams, tasks may not. Primary write already landed, so
   a 500 would wrongly imply nothing happened: now reports **partial** success (`tasksReassigned:false` +
   warning) **and writes the divergence into the REROUTED history note.** The history row is the durable
   part — a response field is only as good as the UI that renders it.
2. **`POST /fee-estimates/request/:requestId`** and **`.../reconcile`** — the requestor's PURPOSE was
   dropped by a bare `catch (e) {}`; purpose drives the fee basis. Both sites run before anything is
   persisted and both handlers already answer 500 from an outer catch, so **removing the swallow was the
   whole fix.**
3. **`POST /redaction-jobs/jobs/:jobId/submit`** — the author's task never left their queue, so their
   **billable** clock kept running on handed-off work. Same partial-success shape as 1.

**Evidence:** 981 assertions pass, live untouched in all 12 tables, API restarted healthy (200).
**Stated honestly:** that proves **no regression**; it does **not** exercise the new partial-success
paths, which need injected failures.

### Next, in order
1. **Kevin's 50-state rules doc** — reconcile with `JURISDICTION_RULES.md` + `AUTO_CONFIG_DESIGN.md`.
2. **Still-open product questions in `TARGET_process_model.md` §5**, unchanged and still blocking
   pipeline work: D5's follow-on (does an unpaid **deposit** pause the whole request or only the records
   whose share is unpaid? — coupled to D3), **D3** (parent-level fee aggregation), **D1** (how literal is
   "driven by task completion"), **D7** (are intake review and delivery tasks?). Then restore `fee_review`.
3. **Unblocked meanwhile:** Phase 2 screens `fee_waiver`, `routing_review`, `review_auto_redaction`
   (`LegalReviewTaskPage` is the template). Swallow items **4–6** deliberately left: 4 needs a decision on
   what "alert someone" means; 5–6 depend on the city's config posture.
4. **Cheap and worth doing:** register `docs/tests/swallow_scan.js` as a harness so a new
   write-swallow-then-200 fails the suite, plus a harness that injects failures into the three paths above.

---

## 2026-08-11 — Kevin's markup session: the knobs get a grown-up name, Frame C speaks plainly (`c2c7eb5`)

**NOTE THE GAP FIRST:** no handoff entries exist for 2026-07-26 → 2026-08-01, though a lot happened.
The record for that stretch lives in the commit log and the docs themselves: design session 1 produced
`SPEC_processing_ui.md` v1 + ten `DRAFT_processing_ui_*` docs; **BW1–BW7 are ALL BUILT** (their harnesses —
`verify_bw2_catalog` through `verify_bw7_financial` — run green in the suite, 1790 assertions total);
the 2026-08-01 session added identity anchors, the external secure-link substrate, the paper form,
per-citizen acknowledgment, and the 24→10 menu reorg (`048c9dc`..`af71e56`). BW8/BW9 remain, gated on
Draft 9/10 markup.

### This session (design/markup, no pipeline work)
1. **Terminology (Kevin): "Local Policy Settings" replaces "city knobs"** in everything a person reads —
   UI copy, API error strings, integrity findings, attestation label, importer CLI, spec + drafts +
   mockups (both copies). Wire formats deliberately keep their names (`AR.KNOBS`, `/api/dispositions/knobs`,
   `knob_unconfirmed`, template key `knobs`, rules_research corpus). Mapping recorded in
   `SPEC_processing_ui.md` decision log. Suite green, live untouched, bundle verified clean of the old term.
2. **Draft 10 Frame C markup (Kevin):** "Kind" column → **"Use case"**; humanized labels in both columns
   (never snake_case keys — those stay in `request_clocks.clock_type` and the templates); every use case
   carries a plain-language description incl. the run-out consequence. Recorded in
   `DRAFT_processing_ui_rule_editors.md`.
3. **Kevin said "Draft 9 looks good."** Recorded as stated — but whether that ratifies Draft 9 §5's five
   drafted defaults (ORO Supervisor default · narrow two-eyes · resurface-at-end · counts-only metrics ·
   A/S/R keys) was NOT explicitly confirmed. **Get an explicit yes before BW8 builds on it.**

### Next
- Draft 10 §5's five questions are still open (ownership mapping · Director propose-vs-apply · v1 depth ·
  drill-down · re-attest vs drift-warn) — today's markup didn't touch them.
- Then BW8 (release review + power mode) and BW9 (go-live checklist + rule editors).

**Addendum, same session:** Kevin explicitly confirmed — **Draft 9's five drafted defaults are approved
as-is.** §5 → DECIDED in the spec and draft; **BW8 is unblocked.** Draft 10's five §5 questions remain the
only open markup.

---

## 2026-08-11 (b) — BW8: release review has its two paths, and the closure letter follows the citizen (`6d00d2e`..`448feed`)

### What was built (same session as the terminology ruling above)
1. **`fix(notice)` — the citizen-facts fix, found by building the preview.** `closureNotice` used the raw
   WORK row: a released child mailed "Reference: 2026-000003-1" (the component suffix the citizen has
   never seen) and addressed the child row's email copy. `citizenFacts()` resolves number/name/address
   through the parent (requestScope precedence); `build()` and `send()` both read it. Same class as the
   acknowledgment fix `ac1c44b`. Asserted at build() AND on the real send path.
2. **BW8 backend** — `/tasks/release-review-queue` (mine + pool + two-eyes, nearest-deadline-first via the
   parent clock, clockless sorts last and answers null; counts only, NO timing — §5.4 declined) and
   `/tasks/:id/release-package` (`services/releaseReviewPackage.js`: released set · withholding log
   resolved zone → rule → legal-source citation, absence shown as absence · the notice from the REAL
   builder · flags · pipeline state from the same `evaluate()` the approve refuses on).
3. **BW8 frontend** — `PowerQueue` library shell (first instance; close-approval + waivers are future
   customers, NOT built), `ReleaseReviewPackagePanels` (shared by both paths), power-mode page (A/S/R,
   populate-in-place, skip-resurfaces-at-end, return dialog with required note), single-task screen,
   `TASK_SCREEN` entry (the task no longer falls through to /requests/:id), My Tasks group-header
   "Power mode (n) →".

### Evidence
`verify_bw8_release_review` 27/27; **full suite 1817/1817, live untouched**; visual verification against
the TEST stack via the verify_stages route-interception technique (screenshots: power mode Frame B with
the withholding log + citation chips, A-key approve closed the item fulfilled + delivered_at and populated
item 2 in place, My Tasks Frame A with the power-mode button; zero page errors).

### A trap stepped in and out of, recorded so nobody repeats it
`npm run build 2>&1 | tail` reports **tail's exit code, not npm's**. A first build FAILED (this project's
ESLint config lacks `react-hooks/exhaustive-deps`, and a disable-comment naming an unknown rule is itself
a compile error), the pipe said 0, and nginx served 403 from an empty `build/` until `verify_stages`
caught it. Check `build/index.html` exists + `curl localhost` = 200 after every build.

### Where this leaves the waves
BW1–BW8 all BUILT. **BW9 (go-live checklist + rule editors) is the last wave**, gated on Draft 10 §5's
five open questions (ownership mapping · Director propose-vs-apply · v1 depth · drill-down · re-attest
vs drift-warn). The pre-send gate itself remains an unconfirmed ⚠ policy setting on live — correctly:
turning it on is a Director's act, on the go-live checklist BW9 builds.

---

## 2026-08-11 (c) → 08-12 — decisions cleared, BW9a built: the go-live checklist end to end (`ff8f39c`..`1b89add`)

### Decisions (Kevin, all recorded in spec + drafts, two docs commits)
1. **Draft 10 §5 — all five ratified as drafted:** Legal Rules owns `deadline`+`clock_matrix` · Director
   edits on Legal domains route to Senior Legal (no self-apply) · v1 = the high-touch six renderers ·
   research-text drill-down IN · drift-warn only. **BW9 unblocked.**
2. **Draft 6 residuals — all four decided:** Senior Legal attests the Legal sections (ATTEST widens) ·
   gate summary banners the Director's home until ready · go-live gets a **guided ceremony**
   (GateChecklist → typed confirm → SADMIN flip) · unattest keeps confirm-dialog friction, no reason
   note. (Policy-setting evidence drill-down stays later work — not asked.)

### A live-state correction the record needs
The BW8 handoff's claim "the pre-send gate remains an unconfirmed ⚠ policy setting on live" is **stale**:
on live, **every policy setting was confirmed by Kevin on 2026-08-01** (the gap-week session), including
`pre_send_review: confirmed ON` and all 15 sections attested. Live TX reads READY; only dev-mode is still
ON — i.e. live sits exactly at the ceremony this wave built.

### fix(finance) `335e302` — a §552.2615 compliance bug found by the suite going red
`settle()` wrote its own reconciliation BEFORE asking the overage watchdog; since `feeReissue.pending`
reads the NEWEST reconciliation, the settle run's own (nobody-notified) row could shadow the flagged one
and the final invoice would bill the unnotified overage the cap forfeits. Same-second created_at ties
usually hid it; my extra sync reads shifted suite phase and bw7 F4/F5 flipped red in full runs only
(green alone, green in every subset — the stash bisect + prefix run pinned it). Fix: judge the cap on
the pre-settlement state. Lesson recorded: **a harness that fails only in the full suite can be a real
race in PRODUCT code, not test pollution — bisect before blaming the harness.**

### BW9a — the go-live checklist (backend `c7689b7`, frontend `1b89add`)
- **`services/goLive.js`**: `settings()` enumerates every local policy setting by profile section —
  template `city_config` edges, eligibility dimensions, and the CODE-DEFINED knob domains asked from
  their readers (rule d: the row may not exist; a row sweep cannot see the open decision). `confirm()`
  is Draft 6's missing plumbing: value + confirmed + who/when on the setting, never creates one,
  validates before writing. `summary()` computes the gate pills.
- **The whole-template gate now sweeps `release_pipeline` + `fee_de_minimis`** — before this, attest
  could sign a city whose pre-send decision was nobody's. Pending-only in the signature, so a
  fully-confirmed install hashes unchanged (live TX verified: no drift).
- **ATTEST widened**: ATTORNEY_REVIEWER attests exemption/redaction/deadlines only, worded refusal
  elsewhere; same line scopes confirm by domain; READ includes the attorney (can't attest what you
  can't see).
- **Screens**: readiness index (computed pills + StatusChip rows + owner labels) · section detail
  (policy-setting cards, suggestion chip stays after confirm, attest panel refuses in words) · rails
  (proposals → /admin?tab=updates, integrity, enforcement) · **guided ceremony** (typed GO LIVE) ·
  dashboard GoLiveBanner. New primitives: StatusChip, GateChecklist.

### Evidence
`verify_bw9_golive` 35/35 — imports TX fresh and WALKS the checklist with the API's own enumeration;
snapshot/restore so e2e TX/OH are undisturbed. **Full suite 1852/1852, live untouched.** Visual: test
stack via route interception — NOT-READY index, disposition detail (the release-pipeline pair),
de-minimis confirmed through a real UI click (who/when chip renders), banner, ceremony popup, LIVE
state after the flip; zero page errors (`backend/tests/artifacts/bw9_*.png`, untracked).

### Where this leaves the waves
**BW9a BUILT.** The last remaining slice is **BW9b — the rule editors** (Draft 10, fully decided):
section-screen content zones, edit-as-proposal composer (`origin:'editor'`), compose-time WS1–WS3
validators with worded refusals, the high-touch six renderers (exemption · redaction · fee · deadline ·
clock_matrix · clarification; rest read-only pretty views), research-text drill-down. Note for BW9b: the
v1 `/admin?tab=jurisdiction` (JurisdictionProfilePage) still exists alongside the new checklist — retire
or redirect it in that pass.

---

## 2026-08-12 (b) — BW9b: the rule editors — ALL NINE WAVES BUILT (`0d68758`..`dcb42c9`)

### What was built (Draft 10, every §5 question already decided)
1. **The section screens grew their zones** (Content · Local Policy Settings · Provenance ·
   Proposals) over BW9a's detail page. Two kinds of content, one grammar: statute-derived facts
   (navy edge, cited) edit ONLY through the proposal composer; the dashed-amber settings live one
   zone over. Renderers: **deadlines** — the Frame C named-timer table joining the `deadline` +
   `clock_matrix` domains (humanized labels and use cases per Kevin's markup, plain-language
   run-out consequences, ClockChip grammar so a target can never masquerade as statutory);
   **fee** — cited schedule facts; **clarification/payment/fee_waiver** — labeled fields with
   per-field provenance; **exemption/redaction** — the `redaction_rules` + `legal_sources` store
   with honest `wired`/`content-only`; the rest render an honest raw view.
2. **The composer, one audit path.** Citation + note required (editing statute-derived content
   asserts what the law provides); the WS1–WS3 police rules run at COMPOSE time via
   `configIntegrity.validateDomainConfig`/`validateClockMatrix` — **factored pure from check()**,
   so the editor refuses with literally the engine's code and wording (the 46-day response clock
   gets the reconciler band's own sentence) — and run AGAIN at apply (an editedConfig cannot
   smuggle past the second door). Proposals land `source_ref='editor'` in the existing
   review/apply flow; applying writes the `jurisdiction_rules` row + re-syncs → an attested
   section DRIFTS (drift-warn, as decided).
3. **The ownership line holds at every door.** A Director's edit on a Legal Rules domain files and
   routes to Senior Legal — apply-now answers a worded refusal, the review flow refuses the same
   way; Senior Legal (the owner) applies in the same act, and is scoped OFF non-Legal proposals in
   words. Supervisors read, with the reason on the banner. `configFreshness`'s REVIEW gate now
   includes ATTORNEY_REVIEWER.
4. **Research drill-down** (decided IN): `services/rulesResearch.js` resolves
   `docs/rules_research/pruned/pruned_discovery.json` (1117 rules, lazy-indexed) —
   `GET /rules-research/:ruleId` serves the full record incl. VERBATIM statute language; an
   unknown id answers absence in words.

### v1 lines drawn (recorded in spec §6)
- Exemption/redaction ROW edits stay in the Redaction Rules area's existing draft→legal-approval
  flow (its own audit path; Draft 10 §6 not-reopened). The composer here edits the domain configs.
- Editor applies are immediate-only: the scheduler's promotion path applies through adapters,
  which these domains lack.

### Evidence
`verify_bw9b_editors` 35/35 (incl. the WS3 template proposal applying through the untouched
adapter path); **full suite 1887/1887, live untouched**. Visual verification on the test stack
(route interception): Frame C with real TX data · the composer refusing the 46-day clock in the
band's own words · the research drill-down with verbatim §552.221 text · the Proposals zone
carrying an editor proposal · Frame B exemptions with wired badges · fee facts · the Supervisor
read-only banner. Zero page errors (`backend/tests/artifacts/bw9b_*.png`).

### A build trap stepped in and out of
Generated JSX carried literal `←`-style escapes — **JSX text nodes do not interpret unicode
escapes** (JS string literals do), so they rendered as raw text. Caught by LOOKING at the
screenshot, decoded to real characters, rebuilt clean. Screenshots are not optional.

### Where this leaves the project
**BW1–BW9 (a+b): every wave of `SPEC_processing_ui.md` §9 is BUILT.** Live TX sits READY at the
go-live ceremony with dev-mode ON — the flip is Kevin's act, on the Jurisdiction Configuration
screen. Still open elsewhere (spec §10): Kevin's full screen-by-screen pass, Draft 1/2/5/7
residuals, portal identity anchors (WS5), MRR §14 items from the parent/child spec — and the v1
`/admin?tab=jurisdiction` tab, which now duplicates the checklist and should be retired or
redirected in a cleanup pass.

---

## 2026-08-12 (c) — the v1 Jurisdiction Profile tab retired (`597f47e`)

Kevin's call. `JurisdictionProfilePage` DELETED; the Administration tab list drops it; every old
door lands somewhere real — `/jurisdiction-profile` and `/admin?tab=jurisdiction` both redirect to
`/jurisdiction-config` (never a silent fall to the first admin tab); the Setup wizard's
jurisdiction card and the help assistant's menu knowledge now name Jurisdiction Configuration.
`verify_v1_retirement` grew section F in its own source-scan idiom (page gone · no imports · no
`?tab=jurisdiction` links · both redirects asserted). Evidence: retirement harness 22/22; **full
suite 1892/1892, live untouched**; redirects verified in the browser (old tab absent, both legacy
URLs land on the checklist, zero page errors).

---

## 2026-08-12 (d) — the pre-go-live smoke: five beats green, two real bugs caught and fixed (`a7db704`)

### The smoke (Kevin asked; the standing definition: submit → route → estimate → search → deliver)
Request `2026-000005`, created through the REAL portal path on live and **purged after — the live
census matches the pre-smoke counts exactly on all seven touched tables**. Actors were the demo
staff (Steve Russ drove the flow, Kerri Russ approved), never Kevin.
1. **Submit** — parent+child wrapped right; the primary 5-calendar-day `respond` clock +
   `certify_delay` running ON THE PARENT; classified "Building permits" @100% and auto-routed.
2. **Route** — the workflow engine advanced intake → record_search itself; `record_search` +
   `estimate` tasks spawned.
3. **Estimate** — $0.30 (3 pages; TX ≤50-page rule correctly strips labor); **de-minimis waived**
   under the confirmed $25 threshold, reason required, recorded by name.
4. **Search** — real file uploaded, marked Include in Response, the found gate enforced,
   auto-advance to redaction_review.
5. **Deliver** — the pre-send review RAISED, two-eyes approve by a second person, release fired:
   Closed – Delivered, closure letter to the citizen carrying the PARENT's number
   (`mkhargrove+smoke@gmail.com` holds the letter), parent derived Complete.

### The two bugs (`a7db704`) — both invisible to the suite, both day-one landmines
1. **A de-minimis waive never satisfied §5.9.** The waive zeroes the request-level total but
   preserves component pricing as evidence; the release gate read the share off that preserved
   arithmetic — payment_due forever, and a release-review approve refusing to ship a record a
   person had decided owes nothing. Gate now reads the DECISION (recon still supersedes).
2. **The pre-send gate was mute in live's exact configuration.** With `auto_release` OFF the
   pipeline returned before its divert branch, so the review the confirmed knob promises was never
   raised — a finished single-record request sat at delivery forever. The unarmed pipeline now
   raises the review: a task, nothing shipped, no bypasses written, idempotent.
   WHY THE SUITE MISSED BOTH: every harness ran the pipeline armed, and none crossed the waive
   into the release gate. Regression assertions added where each belongs (bw4 G9, bw8 F1–F4).
   **Full suite 1897/1897, live untouched.**

### Noted for a later pass (not fixed here)
`releaseGate.componentCharged` still reports the pre-waive share on a waived estimate; whether
erpSettlement/revenueAllocation should read the waive the same way deserves its own look before
any real money flows through a waived MRR.

### Where this leaves go-live
Every pill green, integrity clean, smoke green end to end. **The one remaining act is Kevin's:
the enforcement flip, via the ceremony on Jurisdiction Configuration.** Next session (Kevin):
things to build in for TESTING and DEMO — his list, to be defined.

---

## 2026-08-12 (e) — waive-accounting: the de-minimis waive writes its decision into the arithmetic (`4b4b2fc`)

### The slice (the item (d) deferred)
(d) noted that `releaseGate.componentCharged` still reported the PRE-WAIVE share on a waived estimate, and
asked whether erpSettlement/revenueAllocation should read the waive too. The look found it was one defect,
not three: the $0 waive snapshot is the GOVERNING priced snapshot for every reader of `componentCharged`,
and it carried pre-waive dollars. a7db704's flag read fixed only the gate's SELF path — the cumulative /
frozen-quote path never looked at the flag (a dormant §5.9-class landmine for the day one accepted quote
prices several records, i.e. the MRR money-axis move), and ERP line items, revenue attribution and the
parent financial view's quoted shares all read the stale arithmetic.

### The fix — at the write, not in four more readers
The waive route now writes the exact shape the engine's own CONFIGURED de-minimis produces (the §5.10.2
ratio at total = 0): every `componentCharged` zeroed, `allocation.ratio` 0. Evidence preserved three ways —
`componentGross` untouched, pre-waive shares recorded in the snapshot's `deMinimisWaive.preWaiveShares`,
and the engine's original snapshot beside it never rewritten. Downstream needed NO changes: revenue
attribution's documented `sum <= 0` branch keeps money whole (`request_total` basis), ERP charges go
scalar-only rather than fabricating a split, the frozen quote freezes at $0 by construction. The gate keeps
the flag read (covers pre-2026-08-12 snapshots) and its reported `componentCharged` now honors the decision.
A reconciliation still supersedes on both axes, so re-priced money is collected and allocated normally.
Spec: `SPEC_parent_child_lifecycle.md` §5.10.2 records the decision, same commit.

### Evidence
`verify_bw4_estimate` G9b–G9f added (the G-case synthetic estimate now carries a priced component as the
engine really writes, backdated so the waive snapshot is strictly latest — same-second `created_at` ties
made "the governing snapshot" arbitrary). **Full suite 1902/1902, live untouched.** Break-test after
committing: with the zeroing line disabled, exactly G9b/G9e/G9f fail (G9d survives on the gate's flag
guard, which is that guard's job) — the assertions bite.

### A trap re-stepped-in (recorded in memory)
`npm test 2>&1 | tail` reports TAIL's exit code — the break-test run "exited 0" with 3 failures. The runner
itself exits 1 correctly (`run_suite.js:166`). Same lesson as the frontend build: never pipe a command whose
exit code matters; read the `SUITE GREEN/NOT GREEN` line.

### Where this leaves go-live
Unchanged from (d): every pill green, smoke green, and the one remaining act is Kevin's enforcement flip on
Jurisdiction Configuration. The (d) list — things to build for TESTING and DEMO — is still to be defined by
Kevin.

---

## 2026-08-12 (f) — the two "lost" portal features: specced, decided, and slice 1 BUILT (`3d72627`..`0eee2c1`)

### Kevin's feature note (exchange/statuscheckandverification.txt): status check + verify authenticity
Research first (two full-codebase sweeps). The big find: **certification is a fee input and a promise** —
the wizard sells "a page attesting the records are true and accurate" that nothing generates; only the fee
estimator reads the opt-in; no hash column exists anywhere; the flag is copied onto every MRR child against
spec §5.1 (which also lets an MRR price certification once per child); two intake paths drop it silently.
Also: `GET /api/public/file/:id` omits the `published=1` gate every sibling applies (contradicts
SPEC_public_library — prerequisite hardening recorded for the verification slice).

### Specs written and DECIDED (all marked in-doc)
`SPEC_portal_status_check.md` + `SPEC_record_verification.md`, registered in DOMAIN_MAP Domain 1.
- **Status gate: number only, names displayable** (Kevin; fact-checked — requests are public records
  essentially everywhere; the narrow lines: no contact PII ever (TX §552.137, NJ 2024), anonymous names
  render gracefully, rate limiting stays, child lines never carry raw request prose).
- **Verification viewer: number + verification code** (content ≠ status metadata; "human reference ≠
  access key" upheld; certified-existence yes/no stays number-only).
- **Certification design**: parent fact; SHA-256 of every release (`content_sha256`, measure-always);
  code = first 16 hex grouped 4×4; sheet generated at parent-Complete regardless of last child's
  disposition (Kevin's assumption ratified); Vaughn-builder precedent.
- **Build order: three slices** (status · certification Part A · verification Part B).

### Slice 1 BUILT (`0eee2c1`)
`POST /api/public/request-status` (rate-limited, read-only, allowlist response, uniform byte-identical
no-match, fail-closed) + portal-home third row + v2-idiom modal (`StatusCheckModal.js`).
Evidence: `verify_status_check` 21/21 via the REAL portal submit path; **full suite 1923/1923, live
untouched**; visuals verified on the deployed build (route interception, zero page errors) and the five
states sent to Kevin; live end-to-end lookup answered correctly after API restart. Harness gotchas
recorded in-file: `db.initDb()` required; don't brute the shared per-IP rate buckets (source-scan idiom);
`requestor_name` is NOT NULL so anonymity = empty string.

### Open
Kevin's design sign-off on the shipped modal (screenshots delivered — iterate on his notes); §6.2 stage
glosses and §2.6/§8.3 page stamping remain OPEN; slices 2–3 next; then his testing/demo list.

---

## 2026-08-12 (g) — slice 2: certification FINISHED (Part A of record verification) (`4a13291`)

### What was built (SPEC_record_verification.md §2, §5, §6 — all decided items)
1. **Parent fact**: children carry a forced `certification_requested = 0` (the is_mrr idiom); the estimate
   context resolves through the parent — a child-keyed estimate no longer silently drops a requested
   certification, and an MRR no longer prices it per child. The legacy inline creator (`server.js`) and
   staff NewRequestPage now carry the opt-in (checkbox added).
2. **Integrity anchor**: `fulfilled_records.content_sha256`, written by all three release writers
   (`services/fileHash.js` owns the rule; the typeable code = first 16 hex, grouped, DERIVED never stored).
   **Live backfilled: 875 released rows hashed, 0 missing files** (`scripts/backfill_content_hash.js`,
   idempotent).
3. **The certification sheet** (`services/certificationSheet.js`, Vaughn-builder idiom): attestation,
   per-record codes + full hashes, non-delivering children listed with their closure labels, portal
   instructions. Generated at parent-Complete via `disposition.deriveParent` — regardless of the last
   child's disposition, idempotent, fails open. Lands as a `request_files` row on the PARENT
   (`status='certification'`), joining the release package like the withholding log.
4. **Staff visibility**: workspace badge CERTIFICATION REQUESTED (parent-resolved).
5. **Hardening**: `GET /api/public/file/:id` now requires `published = 1` — released-to-requestor ≠ public.

### Evidence
`verify_record_verification` 16/16 (real portal submit; real bypass writer, hash asserted against an
independent sha256; sheet-at-completion incl. last-child-no-records and the uncertified control;
published gate 404→200). **Full suite 1939/1939, live untouched.** Deployed: API restarted (schema ALTER
applied at boot), frontend rebuilt/verified. Sample sheet PDF generated by the real service from the test
stack, sent to Kevin (`exchange/sample_certification_sheet.pdf`) — code visibly = first 16 hex of the
printed SHA-256.

### Where this leaves the features
Slice 3 remains: the portal Verify a Certified Record flow (SPEC §3–§4 — lookup state machine, code
verify, the code-gated visual viewer, the second portal-home button). Design decisions all made; the
anchors it needs (hashes, sheet, parent fact) are now live. Also still open: §6.2 stage glosses,
§2.6/§8.3 page stamping, and Kevin's testing/demo list.

---

## 2026-08-12 (h) — slice 3: the verification portal BUILT — both portal features COMPLETE (`98cbb72`)

### What was built (SPEC_record_verification.md §3–§4, §8.1)
Three public doors with three deliberate disclosure levels (all `checkRate`-limited, read-only):
`POST /verify/lookup` (number → certified-existence + record list, the feature note's exact refusal
wordings, never a hash/file-id/name) · `POST /verify/code` (number+code → prefix match on
`content_sha256`, scoped to the request, normalization-tolerant) · `GET /verify-view` (number+code →
streams the certified PDF; §8.1: the code IS the access key, so content — including
certified-but-unpublished records — is never enumerable; non-documents answer in words and point at file
verification). Portal home carries both buttons; `VerifyRecordModal` (v2 idiom) walks
number → gate → file-or-visual → code → verdict or viewer.

### Traps stepped in and recorded
1. **Route shadow**: `GET /verify/view` was captured by the earlier `GET /verify/:token`
   (email verification) — the viewer answered "Invalid Link". Renamed `/verify-view` (the
   `verify-status` idiom). Caught by the harness.
2. **Suite flake**: one full run failed 1935/1936 — the harness closed children while the portal
   submit's background intake-advance was mid-flight. Hardened with the wait-for-workflow-decision
   idiom (verify_mrr_children); two subsequent full runs green.
3. **A session restart orphaned a running suite** — `npm test` survived detached; the fresh session
   must CHECK for a live `run_suite` process before launching another (two suites fight over
   `optimumq_test` and :3101). An until-loop watcher on the log picked up the result.

### Evidence
`verify_record_verification` 28/28; **full suite 1951/1951, live untouched** (twice). Seven UI states
screenshotted on the deployed build, zero page errors, sent to Kevin (`exchange/verify_*.png`; viewer
frame blank in headless shots only — no PDF plugin; the endpoint's 200/%PDF is harness-asserted). Live
after deploy: unknown number → no_match, real uncertified request → not_certified, both with the spec'd
sentences. Kevin approved the status-check visuals earlier; verify visuals delivered.

### Where this leaves things
**Both features from Kevin's note are BUILT, tested, deployed.** The full loop is live: certified
request → release hashes files → sheet at completion → citizen verifies by code or side-by-side view.
Open: §6.2 stage glosses, §2.6/§8.3 page stamping (both OPEN — Kevin), the erpSettlement 'none'-mode
actualCost note, Kevin's screen-by-screen pass, the go-live flip, and his testing/demo list.

---

## 2026-08-12 (i) — the smoke: seven beats green end to end, TWO real bugs caught and fixed (`6514c8c`, `294fac6`)

### The smoke (Kevin asked; the standing definition PLUS today's builds, all live)
Request `2026-000005`, real portal path, WITH the certification opt-in, driven by a scripted harness
(scratchpad smoke.js) at machine speed. Steve Russ drove, Kerri Russ approved. All 27 assertions green:
1. **Submit** — parent+child wrapped; certification parent-only (child forced 0); statutory clocks on the
   parent (respond 5cd primary + certify_delay 10bd).
2. **Route** — the engine advanced intake → record_search itself; both tasks spawned; the PUBLIC STATUS
   CHECK reported the request mid-flight.
3. **Estimate** — $0.30 (3 pages, TX ≤50-page labor strip); de-minimis waived by name; the waived snapshot
   carried componentCharged 0 IN THE ARITHMETIC (slice (e), live).
4. **Search** — real PDF uploaded, Include in Response, found gate, auto-advance.
5. **Redact** — job → apply (0 zones, Vaughn); the release carried `content_sha256` (slice 2, live);
   §5.9 gate read the waive at the delivery advance.
6. **Deliver** — pre-send review RAISED itself; Kerri approved; Closed – Delivered; parent derived
   Complete; closure letter SENT (mkhargrove+smoke@gmail.com); **the CERTIFICATION SHEET generated**.
7. **Verify** — lookup answered certified; the sheet's code VERIFIED the file; number+code opened the
   viewer (%PDF); wrong code never did; status check answered Complete.
Purged after; **census parity on all 21 counted tables** (one manual assist — below).

### The two bugs (both invisible at human speed, both fixed and regression-locked same-day)
1. **`6514c8c` — snapshot order was a coin flip.** created_at is second-granular; the scripted flow wrote
   the estimate and the waive in ONE second, and every latest-snapshot read resolved the tie arbitrarily —
   the pipeline read the PRE-WAIVE snapshot and demanded the waived $0.30 (§5.9 resurrected by timestamp
   collision). `request_fee_estimates.seq` (monotonic, backfilled, sequence bumped) + tiebreak on every
   read. bw4 G9g forces identical timestamps and demands the waive win.
2. **`294fac6` — the triage race duplicated releases.** The redaction triage sweep auto-bypassed the clean
   file in the same second the manual job applied: DELETE-by-source interleaved, both inserted, one file
   carried TWO released records. `ux_fulfilled_source` unique partial index + all three writers upsert ON
   CONFLICT. Harness proves the constraint bites.

### Census learnings (for the next smoke)
- `task_events` (trigger audit) rows do NOT cascade with requests — the purge must delete them by
  request_id first (smoke.js fixed; run 6 needed a surgical 8-row cleanup, ids verified by task lifecycle).
- **Live carries ~74 PRE-EXISTING orphaned task_events** from older deletions (incl. earlier smoke runs'
  purges before this was understood) — harmless audit debris; a cleanup pass candidate, maybe with a
  task_id FK. Recorded, not acted on.
- Smoke runs 1–5 fell to driver bugs (route mounts, races my own script had), each purged before retry;
  only runs 4 and 5 surfaced the real defects above.

### Where this leaves go-live
Every beat green at machine speed, both features from Kevin's note exercised live end to end, suite at
**1954/1954**. The enforcement flip remains Kevin's act. His testing/demo list remains open.

---

## 2026-08-12 (j) — the operational dashboard: verified, decided, BUILT (`f032a30`, `f053fb4`)

### Kevin's enhancement (exchange/dashboardrevision.doc) — verify budgeted time first, then revise the dashboard
**Verification (full sweep):** budgeted time was fully COMPUTED since Slice C (task_events trail,
queue/process math, `time_budgets` keyed (record_type, task_type), ok/warn/over) but had NO editing
surface — "Slice I, the budget brain" was deferred by Kevin 2026-07-15 and never built; the 8 values only
ever existed as a SQL seed. No lateness aggregation existed anywhere (everything "overdue" = statutory).
Kevin's recall was exactly right. Latent find: the decided pause-not-reset budget rule was unimplemented.

### The decided model (Kevin, in-session — recorded in SPEC_operational_dashboard.md §1)
Simple and attention-catching, a go-to-market differentiator: ONE editable budget value per task type;
late = budget overrun bucketed 1d (≤24h) / 2d (≤48h) / >2d; paused tasks excluded from late (own
"waiting" column — simple reading of §757); statutory clock untouched; health scoring (#13) and the AI
brain stay deferred. Refine from customer feedback.

### Built (design approved from mockups; screenshots of the LIVE result delivered)
1. **Budget editor** — Configuration ▸ Task Time Budgets, supervisor+ gated, name recorded
   (`time_budgets.updated_by`). Edits values, never the catalog.
2. **`services/opsSummary` + `GET /api/tasks/ops-summary`** — team × task node grid (queued / in-process /
   in-review / paused / late buckets / unbudgeted) + per-team stage counts + the Finance block
   (outstanding, billed-unpaid, collected, waived), derived on read; teams follow `departments` live.
   Scoping mirrors stats/dashboard; non-elevated never sees another team.
3. **DashboardPage rebuilt** (v2 idiom, per the approved mockups): per-user panes
   (`user_dashboard_panes`, the system's first per-user preference store), role defaults computed
   server-side, customize modal, Recent Requests RETIRED. Legal clock is its own clearly-labeled pane.

### Evidence
`verify_ops_dashboard` 21/21 (editor round-trip/name/refusals; bucket edges at exactly 24h/48h; paused
lands nowhere but paused; unbudgeted never late; scoping; role defaults; layout round-trip; empty layout
refused). **Full suite 1975/1975, live untouched.** Deployed (API restarted, build verified); live
screenshots: the admin view already flags 4 seeded tasks >2 days over budget — the attention layer works
on day one. One verify_stages timeout during a PARALLEL CRA build was CPU contention (green on quiet
rerun) — don't run the suite and a frontend build simultaneously.

### Open
Full-suite runtime is growing (~46 harnesses); Kevin's testing/demo list; the go-live flip; deferred:
health scoring #13, the budget brain, per-record-type budget UI, parent budget roll-up, historical pause
subtraction.

---

## 2026-08-13 (a) — task_events orphan debris: source closed with an FK, live cleaned (`661a87e`)

### The slice (Kevin picked from the session-start options)
The (i) handoff recorded ~74 pre-existing orphaned `task_events` live — bookmark rows whose tasks were
purged with their test/smoke requests, "a cleanup pass candidate, maybe with a task_id FK." Both halves
done: `fk_task_events_task_id -> tasks(id) ON DELETE CASCADE`, added via the same guarded-DO-block
pattern as `fk_tasks_request_id`, with the orphans deleted in the same block (one-time backfill —
otherwise the ALTER itself would fail at boot). Not a new deletion policy: tasks are never deleted by any
production path (they finish as `done`), so this extends the already-decided request->tasks purge cascade
one level down. request -> tasks -> bookmarks is now ONE chain; purge scripts no longer need hand-sweeps
(`purge_test_requests` keeps its two task_events rules as belt-and-braces, expected to delete 0).

### The FK caught its first offender before it ever reached live
First full-suite run: "1 harness did not complete." **`verify_request_timeline` fabricated bookmark rows
for tasks that never existed** — its own comment relied on "no FK on task_events." Exactly the write the
FK exists to refuse. Fixed: the harness creates real task rows, then clears the trigger's wall-clock
bookmarks before laying down its pinned trail (the AFTER-INSERT trigger stamps now(), which would pollute
the pinned timeline). A grep confirmed no other harness or src path inserts task_events directly.

### Process note (self-inflicted, worth remembering)
The first suite run was piped through `tail`, which (a) lied about the exit code and (b) discarded all
but the last 25 lines — so WHICH harness died was unrecoverable and cost a full rerun. The standing
frontend-build rule generalizes: never pipe a verdict-bearing command through tail; redirect to a file.

### Evidence
`verify_task_events_fk` 9/9 (constraint + cascade chain incl. bystander no-over-delete + orphan-insert
refusal + zero orphans at both ends); **full suite 1984/1984, live untouched, exit 0**. Applied live via
API restart: `task_events` 88 -> 14 (the 74 orphans removed, legit rows intact), zero orphans by task_id
AND by request_id, constraint present, health 200.

### Open (unchanged)
Kevin's testing/demo list; the go-live flip; §6.2 stage glosses; §2.6/§8.3 page stamping; the
erpSettlement 'none'-mode actualCost note; Tier 2 backlog (#6 fee-choice intake, #9 role catalog, #10
legal review wiring).

---

## 2026-08-13 (b) — item 9 finished: routing runs on ONE catalog (`2f8d8bb`)

### What "role catalog reconciliation" turned out to mean
Verification first (the dashboard lesson): item 9's second half — FEE_WAIVER_APPROVER→FINANCE + the
financial-authority reconciliation — was BUILT 2026-07-15 (`verify_role_reconciliation` 15/15), and the
full auth/routing one-catalog collapse is a deliberate v3-era deferral (spec §8). The REMAINING substance:
task routing itself still ran on legacy permission-role tags (`FEE_MANAGER`, `SEARCH_AND_TRIAGE`,
`REDACTION_WORKER`, `FINANCE`) with the v3 per-person subset (`user_task_types`) seeded for almost
nothing (ONE grant live). The cutover mechanism existed (per-(team,type) seeding, `hasSeededType`) but
only `redaction_qa`'s spawner ever used it.

### The trap the audit caught BEFORE building
The two eligibility readers treat the role tag differently: `eligibleUsers()` TRANSLATES legacy names
onto the v3 model when seeded, but `POOL_ELIGIBILITY_SQL` matches `role_required` against grants
VERBATIM. So "just seed the grants" — the naive reading of the slice — would have made the pool list and
the claim guard disagree (§3.5 class: work offered to people who cannot take it). The switch and the
seed only work together, which is why they shipped together.

### Built
1. **Spawn-time token switch, central** — `createTask` tags a legacy-mapped type with its own type key
   when the (team, type) is seeded. `redactionReview`'s private copy of the switch removed (it now only
   overrides for the legal path); explicit `roleRequired` always respected.
2. **`src/db/seed_task_type_grants.js`** — one-time 1:1 mirror of legacy holders into grants, THROUGH
   `PATCH /api/staff/:id/task-types` as SYSTEM_ADMIN (real path, replace-semantics honoured by unioning
   with existing grants). Dry-run default; re-run is a no-op. REDACTION_WORKER maps to redaction AND
   redaction_qa because that is what holding it already meant.
3. Docs: spec §7/§8 (the §7 "rename" flags dissolve — the eligibility token IS the task type),
   MASTER doc, BUILD_PRIORITY item 9 struck.

### Suite hygiene lesson (cost one full-suite rerun)
First full run: `verify_qa_routing` 18/20 — MY harness had left mirror grants in the shared test DB, and
qa_routing §C legitimately asserts the UNSEEDED fixture. Harnesses that mutate global state must leave
the world as found: `verify_routing_cutover` §E now deletes its tasks and grants and asserts the fixture
is unseeded again.

### Evidence
`verify_routing_cutover` 18/18; **full suite 2002/2002, live untouched, exit 0.** Applied live through
the deployed API: dry-run plan eyeballed (staff→doer set; supers/admins→full set; Tom Jones kept his
pre-existing routing_review), then --apply → 21 users, 92 grants. Read-only live check: **all 33
(team,type) pairs set-equal legacy vs v3** — nobody gained or lost work. Narrowing anyone's subset is
now a deliberate Staff Management act, exactly where Kevin wants that control.

### Open
Kevin's testing/demo list; go-live flip; §6.2 stage glosses; §2.6/§8.3 page stamping; erpSettlement
'none'-mode actualCost note; Tier 2: #6 fee-choice intake, #10 legal review wiring. The legacy routing
fallback in `eligibleUsers` stays for in-flight tagged tasks + approval-module routed_task role targets
(REQUEST_MANAGER / DENIAL_AND_LEGAL / ESCALATION_HANDLER) — retiring it is the v3-era collapse.

---

## 2026-08-13 (c) — item 10 closed: the legal-redaction gate cities can actually set (`dc88365`)

### Verification first (again the right call)
Item 10 = "Legal Review task wiring; Legal Redaction path for sensitive types". The wiring half was
ALREADY BUILT (routing 2026-07-09; resolution through applyStageTransition with a required note —
`verify_legal_review` 44/44). The spec's "record type sensitive=true (flag to verify)" verified as
NONEXISTENT: no column, no reader. The real gap: legal redaction was reachable only by director
escalation or the classifier's SENSITIVE/LEGAL_HOLD — an AI judgment on request TEXT. A city could not
make "internal-affairs files are ALWAYS legally redacted" a rule; a blandly-worded request would land on
a line redaction clerk.

### Built (config-over-encoding: the city sets it, we don't guess)
`record_types.legal_redaction_required` — a "Legal redaction required" checkbox in the record-type
editor (create AND edit), read by `requestNeedsLegalRedaction` alongside the two existing triggers: the
redaction stage escalates to `legal_redaction` (office-level) and the redaction job's disposition
resolves `legal` from the same fact. Editor row got `flexWrap` so the fifth checkbox wraps instead of
overflowing the 640px modal. Latent fix in passing: a bare `requestNeedsLegalRedaction(requestId)` call
silently skipped the director-escalation branch (the check lived only on the caller-supplied row) — my
harness's C3 caught it; the function now fetches what it needs.

### Observations recorded, deliberately NOT acted on (scope)
- The record-type CREATE route silently drops `auto_publish` and `mappable` (the editor sends them; the
  INSERT ignores them). My new flag does carry through create. Cleanup-pass candidate.
- The editor modal header renders literal `×` / `·` escape strings (pre-existing rendering
  wart, visible in the screenshots). Cleanup-pass candidate.

### Evidence
`verify_rt_legal_gate` 11/11 (API round-trip incl. create; gate fires deterministically on bland text
with NO classifier flag; unflagged untouched; director escalation unchanged; null record type safe;
redaction family idempotency holds; world restored for later harnesses). **Full suite 2013/2013, live
untouched, exit 0.** Deployed: API restarted (health 200), frontend rebuilt (build/index.html + nginx
200), toggle verified rendering live (`exchange/rt_editor_legal_toggle.png`). Live DB: column present,
**all 84 types default 0 — behavior changes only when a city flags a type.**

### Open
Kevin's testing/demo list; go-live flip; §6.2 stage glosses; §2.6/§8.3 page stamping; erpSettlement
'none'-mode actualCost note; Tier 2 remaining: #6 fee-choice intake (needs design direction first),
#7-adjacent cleanups above. Dedicated legal task screens still NOT BUILT (design-gated, v2 UI rule).

---

## 2026-08-13 (d) — item 6 was already built; now it's proven and the docs say so (`b06609f`)

### The finding (verification-first paid for the whole slice)
"Fee-choice intake (default-forward)" — the last unstruck Tier-2 build — was ALREADY LIVE: the wizard's
Your Information step has carried the three-option fee choice since 2026-07-18 (Kevin's approved
mockups), and `requestCreate` has derived `purpose='commercial'` in the one creation helper since the
same day (`97a0764`, comment cites §5). THREE docs still said NOT BUILT / "nothing captures commercial
today" — written for the pre-wizard chat design, whose "just type" + rich-quick-reply framing lapsed
when the wizard became the ratified shell (agent is description-only; the fee choice is a form control).

### What was genuinely missing: the lock
No test covered the capture contract — a payload rename or the derivation moving out of `requestCreate`
would have silently decoupled the portal from the fee engine (citizen declares commercial; request
proceeds standard-rate). `verify_fee_choice_intake` (11/11) drives the REAL `POST /api/public/submit`
three times, asserting on the PARENT per the money-facts rule: default → no purpose, no waiver
machinery; waiver → parent flags + reason + team-agnostic `fee_waiver` task via onIntake; commercial →
`requestor_type` AND `purpose='commercial'`. (First run taught it the submit route returns 201.)

### Docs reconciled (same commit)
Portal spec §5 BUILT + superseding note; §4 form-fallback marked superseded (the wizard IS the form, so
its "no fee-choice field" gap closed by construction); §7: MRR intake (§6) is now THE remaining intake
build. D4 §10 marker; BUILD_PRIORITY #6 struck. Commercial approval stays deferred on customer demand.

### Evidence
`verify_fee_choice_intake` 11/11; **full suite 2024/2024, live untouched, exit 0.** No production code
changed — nothing to deploy.

### Where this leaves the board
**Tier 2 is now fully closed** (#6–#10 all struck: #7 notifications and #8 My Tasks were done earlier;
#9 routing cutover and #10 legal gate shipped today). Remaining open: Kevin's testing/demo list, the
go-live flip, §6.2 stage glosses, §2.6/§8.3 page stamping, erpSettlement 'none'-mode note, and Tier 3
(MRR intake §6 is the next real intake build, design-decided but gated on Kevin's MRR-hub sequencing).

---

## 2026-08-13 (e) — item 12: MRR item-by-item intake, the last missing intake piece (`7cce079`)

### What was actually missing
Spec §13's decided intake contract — "AI proposes, a human decides" (detect-and-propose →
validate-each → "anything else?") — was two-thirds structural already: the wizard's per-item loop IS
validate-each, Submit-or-Continue IS the anything-else, and >1 item ⇒ MRR shipped with parent/child.
The gap was **detect-and-propose**: a citizen writing "the police report, the 911 call, and any emails
about it" in ONE message got one muddled item. The agent's prompt said one-record-at-a-time but had no
behavior for a description that mixes several record types.

### Built (prompt-only; loaded the claude-api skill first per its trigger rule)
`SYSTEM_PROMPT_SPLIT_CANVAS` gains a DETECT AND PROPOSE block: never work a multi-type description as
one item, never split silently — list each type back as a numbered item, confirm via
`[[QUICK_REPLIES: Yes, work through them one at a time | No, I meant one record]]`, work the queue in
order naming the next item at each hand-off; a date/location/person on one type is a DETAIL, not an
item. Combined-vs-separate stays retired. No API-parameter changes.

### Two-layer verification (model output is nondeterministic — the suite must not depend on it)
1. **Prompt contract locked:** `verify_mrr_intake_prompt` 12/12 asserts the load-bearing clauses on the
   newly exported `WIZARD_PROMPT` string — a silent prompt edit now goes red in the suite.
2. **Live probes against the REAL deployed agent** (`/api/public/chat` writes NOTHING until Submit —
   §0 — so probing live is data-safe; Anthropic credits confirmed working): 3-type description →
   3-item proposal with the exact quick replies · single type + qualifiers → NOT split, normal refine
   questions · accept path → starts item 1 ("Let's start with the police report…").

### Evidence
`verify_mrr_intake_prompt` 12/12; **full suite 2036/2036, live untouched, exit 0.** API deployed
before probing (health 200).

### Observation recorded, not acted on
The portal chat agent runs `claude-sonnet-4-5` (a legacy-but-active model). A model upgrade is a
worthwhile future slice but needs its own verification pass over the whole agent behavior — not a
ride-along on a prompt change.

### Where this leaves the board
Intake is DONE: portal spec §7 lists no pending intake builds. Today's five slices: task_events FK,
routing cutover (#9), legal-redaction gate (#10), fee-choice verification lock (#6), MRR intake (#12).
Open: Kevin's testing/demo list, the go-live flip, §6.2 stage glosses, §2.6/§8.3 page stamping, and
Tier 3's big remaining items (MRR hub §14.3 — deferred by Kevin; health scoring #13; taxonomy variants
#14; sources redesign #15).

---

## 2026-08-13 (f) — item 13 un-deferred and SHIPPED: workload health scoring (`c077a24`)

### Kevin's call, design-first
Health scoring was deferred by Kevin yesterday when the dashboard shipped its counting model; today he
called it as the next slice — an un-defer by the person who deferred it. Per the decisions-visual rule,
design led: mockups in the shipped dashboard idiom (`exchange/health_mockups.png`) with two dashboard
variants + the My Tasks composite + the formula spelled out in user-facing words. **Kevin approved BOTH
variants and the formula as proposed, same-day.**

### The model (SPEC_operational_dashboard §2.5 — now the binding spec; D4 §4 points there)
- **Points** (the §4 exponential penalty, expressed in the already-decided buckets): 1 day over budget
  = 1 · 2 days = 2 · >2 days = 4. One badly stuck task outweighs several slightly-late ones.
- **Status**: 0 = On track · 1–3 = Needs attention · 4+ = Falling behind (wire values snake_case;
  display names frontend-side). Thresholds fixed v1 — refine from customer feedback.
- Paused and unbudgeted tasks NEVER score. Bucket edges moved INTO `workloadHealth.bucketOf` so
  ops-summary and the personal composite bucket identically by construction.

### One pure module, four consumers (score and screen can never disagree)
1. **ops-summary** — health on every node, team, and totals.
2. **Dashboard** — Health columns in Late-by-Team + Task Nodes, and the new **Workload health pane**
   (teams × nodes heat grid, composite chip in the header, scopable, FIRST in org-wide and team-lead
   role defaults).
3. **My Tasks** — personal composite off `/tasks/mine` (now returns `health` + buckets); the page says
   the WHY in plain words.
4. **AI reporting** — new `workload_health` report metric (engine + report-agent catalog): per-team
   table off the same read; the note explains the formula and disclaims the legal clock.

### Evidence
`verify_health_scoring` 21/21 (formula boundaries; controlled-ledger ops integration; paused moved no
needle; the real `/tasks/mine`; report number == dashboard number; pane defaults; world restored).
`verify_ops_dashboard` C1 updated for the new default order — first full run caught it (20/21), fixed,
then **full suite 2057/2057, live untouched, exit 0.** Deployed (build + nginx 200, API restart 200).
Live screenshots delivered: `exchange/health_1_dashboard.png` (health pane leads; Falling behind · 32,
matching the 8 known over-budget tasks) · `exchange/health_2_mytasks.png` (Kevin's composite: Falling
behind · 12 points, "3 are more than 2 days over. Start with the oldest.").

### Open
Kevin's testing/demo list; go-live flip; §6.2 stage glosses; §2.6/§8.3 page stamping. Deferred by
design: health-threshold configurability, the AI budget "brain", per-record-type budget UI, parent
budget roll-up. Tier 3 remaining: MRR hub §14.3 (Kevin-deferred) · taxonomy variants #14 · sources
redesign #15.

---

## 2026-08-13 (g) — item 14 decided + slice 1 built: taxonomy variants (`7fb2f50`)

### The design session (this was KEVIN'S open design, parked since July)
Mockups first (`exchange/variant_mockups.png`): nested variants on the Taxonomy page, inheritance in
the editor, and his auto-discovery counting concept with mass-redaction candidate flags. Kevin initially
didn't recognize the jargon-framed ask — plain-words re-explanation ("one catalog entry can have
sub-entries; sub-entries only spell out what's different; the AI can suggest sub-entries from your real
files, with counts") landed, and he approved the direction. **Decided: a variant IS a record type with a
parent** — one new field, no second catalog, one level only.

### Built (slice 1 — the backbone)
- `record_types.parent_record_type_id` + shape guards at the routes (no grandchildren, no
  self-reference, busy buckets can't demote, bucket deletion refused while variants exist, category
  server-aligned to the parent).
- **Inheritance** where behavior attaches: estimate profile (read-time fallback; writes untouched),
  time budgets (variant → parent → generic), the legal gate (parent ON binds variants — never loosens
  silently), classifier owner/fulfiller (COALESCE walk-up).
- **Classifier**: catalog extracted as exported `catalogRows()` (suite-assertable without a model
  call); variants shown as "Bucket — Variant"; instruction: most specific when clear, else the bucket.
- **UI**: nested variant rows + bucket pills on TaxonomyPage; Parent field in the editor with a
  12-year-old-simple explanation; category locks to the parent's.

### Slice 2 — NEXT (design already approved, mockup 3)
Auto-discovery groupings: scan a bucket's real holdings across its linked sources, propose variants
WITH document counts, flag consistent-layout groupings as mass-redaction candidates. Needs its own scan
machinery + verification pass; deliberately its own session.

### Evidence
`verify_taxonomy_variants` 14/14; **full suite 2071/2071, live untouched, exit 0.** Deployed (build +
nginx 200, API restart 200); editor Parent field verified live (`exchange/rt_editor_parent_field.png`).
Live catalog untouched — 84 types, all parentless until Kevin creates variants.

### Open
Kevin's testing/demo list; go-live flip; §6.2 stage glosses; §2.6/§8.3 page stamping; variants slice 2
(discovery groupings); sources redesign #15 (decision pending); MRR hub §14.3 (Kevin-deferred).

---

## 2026-08-13 (h) — item 14 COMPLETE: discovery groupings with honest counts (`17be3a1`)

### Built (slice 2 of the approved design — Kevin's counting concept, mockup 3)
- **`countAll` on the filestore connector** — a real listing, never a sample, so counts are honest.
- **`discoverVariantGroupings`** (read-only): scans a bucket's linked sources, AI groups the samples
  into proposed variants with share, layout consistency, and a mass-redaction flag (consistent-layout
  groupings only). Inserts NOTHING; refusals are honest 422s BEFORE any model call.
- **`applyGroupingProposal`**: one approved proposal → one DRAFT variant (parent + category aligned,
  `source='discovered'`), provenance in the description — "about N documents in the holdings" only
  when the total is real, else "% of the scanned sample". Drafts don't classify.
- **UI**: "Find variants" on every bucket row → the mockup-3 modal (counts, reasoning, ⚡ flags,
  approve-per-card, ungrouped share reported).

### Evidence
`verify_variant_discovery` 12/12 (counting; pre-spend refusals; draft insert + provenance wording;
one-level rule via the apply path; drafts absent from the classifier catalog; world restored).
**Full suite 2083/2083, live untouched, exit 0.** Deployed (build + nginx 200, API 200). **AI path
probed LIVE** on `rt-building-permits`: the mixed demo folder yielded exactly one true permit
(uniform, mass-candidate) with 88% honestly reported ungrouped — behaviorally correct for that
source; real per-type corpora will produce richer groupings. Modal screenshot:
`exchange/variant_discovery_live.png`.

### Where this leaves the board
**Item 14 complete** — the last Tier-3 item that wasn't Kevin-deferred. Remaining build surface:
sources redesign #15 (decision pending, Kevin), MRR hub §14.3 (Kevin-deferred), the recorded
follow-ons (Mass Redaction hand-off; legal task screens; chat-agent model upgrade; v3 full collapse),
and the pre-production hardening list. Everything else is Kevin's: testing/demo, go-live flip,
§6.2 glosses, §2.6/§8.3 stamping.

---

## 2026-08-13 (i) — item 15: the Sources screen reads like English now (`952c0d3`)

### Kevin's July flag, closed
Before/after mockups (`exchange/sources_current.png` / `sources_redesign_mock.png`); Kevin reviewed
from the exchange folder and said build it. Four behavior groups replace the flat connector list —
**Searched the moment someone asks · Watched folders (files brought in on a schedule) · Counted only
(never opened) · Paper & physical (findable, not fetchable)** — each with a plain-sentence group
explanation. Cards say what each source HOLDS by record-type name and show status in words ("Checked
by hand · Last run 2026-07-07 09:39 · 3 files brought in · 0 errors"). "Run ingestion" is now "Check
now" (editor copy aligned). `GET /repositories` gained `linked_types` + `paper_index_count`.

### Honesty decisions
No "last searched" timestamps for live systems — no tracking exists, and the screen never invents
data (follow-on recorded). Paper locations with an empty index warn "No index yet" instead of looking
fine.

### Repo-hook lesson (second occurrence — now understood)
A hook escapes non-ASCII in JSX TEXT to literal `\uXXXX`, which renders as-is (this is what produced
the editor modal's `×` wart, and briefly a `● Connected` chip here). Rule: no non-ASCII
glyphs in JSX text nodes — use CSS shapes (the status dot is a border-radius span) or JS string
expressions.

### Evidence
`verify_sources_list` 3/3; **full suite 2086/2086, live untouched, exit 0.** Deployed; both halves of
the live page screenshotted (`exchange/sources_live_redesigned.png`, `_2.png`).

### Data note for Kevin (not code)
The "Test Import Drop" source's own stored description still says "the ingestion pipeline is being
built" — it shipped weeks ago. Editable via the source's Edit button.

### The board
Items 1–15 are now ALL closed or Kevin-deferred. Remaining: MRR hub §14.3 (Kevin-deferred) ·
follow-ons (Mass-Redaction hand-off, legal task screens, chat-agent model upgrade, v3 collapse,
search-activity tracking) · pre-production hardening · Kevin's testing/demo list · the go-live flip ·
§6.2 glosses · §2.6/§8.3 stamping.

## 2026-08-13 (j) — MRR hub slice: hub verified BUILT; HIGH PRIORITY flag shipped; latent auth bug fixed (`1df974a`)

### What the slice turned into (verify-before-building, again)
"MRR hub" (§14.3) was already BUILT by BW6 — `verify_bw6_mrr` 75/75 covers it. Reconciliation of
§14/CLAUDE.md landed earlier as `2875219`. Kevin chose the one genuinely unbuilt piece
(AskUserQuestion): **the HIGH PRIORITY flag + AI watch report (§14.4 item 6)**. The five Draft-5 §3
residual design questions stay parked with Kevin.

### What shipped
- **Flag**: `POST /api/mrr/:id/priority` (`{on:bool}`), gated by `manages()` — the Request Manager
  (hub-task holder) or oversight. Writes `requests.high_priority/_set_by/_set_at` on the PARENT only
  and a `request_history` row (`HIGH_PRIORITY_SET`/`_CLEARED`). Children never carry it.
- **Surfaces**: hub master header chip + Set/Clear button (manage-gated); overview row tag.
- **Watch report**: `high_priority_mrrs` metric in the report engine + AI catalog — every flagged
  open MRR, one row: items open · estimate readiness · respond-by date · who flagged it, soonest-due
  first. `workload_health` also registered (item 13 follow-through).
- **Latent bug found & fixed (real one)**: the JWT carries the user id as `sub`, but routes have
  repeatedly written `req.user.id` — every such read in `mrr.js` was `undefined`, so
  manager-by-task-holder and assignee gates never matched and "My MRRs" was empty for its own
  manager. Masked in BW6 tests because oversight roles pass every gate; caught when the new harness
  used a PLAIN user as manager. Fixed once in `middleware/auth.js` (alias `id = sub`).
- **Second bug caught by a live check**: the report queried a stored `request_clocks.due_date` —
  no such column exists (due dates are COMPUTED from started_at + duration through tolls). The
  `.catch` swallowed it, so the report showed no deadline and the soonest-due sort no-oped. Now goes
  through `mrrHub.parentClocks` — the same computation the hub master renders — and the harness
  asserts the respond-by date (C1b).

### Evidence
`verify_mrr_priority` 15/15 (submit → wrap → flag gated/recorded → both surfaces → report with
readiness + respond-by → oversight clear → world restored). Full suite green, live untouched.
Live screenshot: `exchange/mrr_priority_live.png` (request 2026-000005, flagged by Kerri).

### LIVE DEMO DATA STILL IN PLACE (deliberate — Kevin wrapping session to view it)
Demo MRR **2026-000005** (parent `e9c0f8dd-28e6-470a-941a-0116d55ed75f`, requestor
mkhargrove+hubdemo@gmail.com) is still live and flagged HIGH PRIORITY. One of its three children
(`3ec53d63-…`, item -1 "Complaints") was already deleted by a mistaken purge that used a stale id, so
the family is INCONSISTENT — purge it before any demo: delete workflow_decisions / notifications /
fee_estimates / clock_tolls+request_clocks / request_history / tasks for the family ids (incl. the
gone child's id — its tasks/history may be orphaned), then children, then parent; verify zero
orphans. task_events cascade via the new FK.

### Spec ownership (RESOLVED in-session)
`docs/SPEC_reporting_ai_help.md` was root-owned; Kevin chowned it to `optimumq` during wrap-up.
The spec now documents the full metric catalog and strikes both its Known Gaps (health dashboard,
high-priority MRR report) as BUILT — included in `1df974a`.

## 2026-08-13 (k) — demo family 2026-000005 purged (Kevin done viewing)

The inconsistent demo MRR family from note (j) is gone. Family-scoped node script (not the corpus
purge): resolved parent `e9c0f8dd` + 2 surviving children + the deleted child's full id
(`3ec53d63-f635-497b-b1c1-e094dd2dc456`) from residue; payment guard passed; one transaction.
Reference sites enumerated from information_schema (all request_id / parent_request_id /
master_request_id columns) — which caught `requestor_request_links`, a site note (j)'s hand-list
missed. Also learned: `notifications` has NO request_id — it scopes by `context_type`/`context_id`.
Post-purge census: every family reference site 0 rows, incl. the gone child's orphaned tasks/history
and task_events/tolls by captured ids. Live DB otherwise untouched.

## 2026-08-13 (l) — Mass Redaction hand-off: the follow-on from item 14 is closed

### The gap and the design (Kevin approved from mockup, `exchange/mass_handoff_mock.png`)
The variant scan's mass-redaction flag survived only as PROSE in the draft variant's description —
machine-unreadable, invisible on /mass-redaction. Now: `applyGroupingProposal` stores it on the
variant (`record_types.mass_redaction_candidate` + `discovery_meta` JSON: estimated_count OR
sample_share, layout, example_files, source repos — the approve call passes the scan's repo names
along — and found_at). The Mass Redaction page grew a **"Waiting for a template"** section
(`GET /redaction-templates/opportunities`): every flagged variant with no un-deleted template naming
it, as a card with the honest count sentence. **Query-driven, zero bookkeeping**: "Start a template"
runs the existing sample-upload flow carrying `?for_type=<variant>` so BOTH save paths (pages +
fields) link the new template to the variant — which clears the card; deleting that template brings
the card honestly back; "Not needed" (elevated-only dismiss) clears the flag and leaves the variant.
Suggestions are cards on the page where the work happens, never tasks (the R10 rule). The
Find-variants modal's approved state now says "suggested on Mass Redaction" for flagged cards.

### One suite guard tripped, correctly
`verify_v1_retirement` C3 pins MassRedactionPage's ONE legitimate `navigate('/redact/'...)` call by
literal regex; adding `+ q` (the for_type carry) broke the literal, not the invariant. Regex updated
to the new single-call-site form.

### Evidence
`verify_mass_handoff` **14/14** (flag machine-readable with honest meta; unflagged stores nothing;
card appears with parent/count/source; sample-share never fabricates a count; linked template clears
the card; deleting it brings the card back; dismiss is elevated-gated, 404s when already gone, and
leaves the variant). **Full suite 2115/2115, live untouched, exit 0** (first run 2114/1 — the C3
literal). Deployed (build + nginx 200, API restart 200). **Live-probed via the real approve path**:
flagged variant → card rendered exactly per mock (`exchange/mass_handoff_live.png`), Start-a-template
modal shows the pre-link banner (`exchange/mass_handoff_live_modal.png`), probe rows deleted via the
API, opportunities back to 0.

### The board
Follow-on list shrinks: Mass-Redaction hand-off DONE. Remaining follow-ons: legal task screens ·
chat-agent model upgrade · v3 collapse · search-activity tracking. Plus pre-production hardening,
Kevin's testing/demo, go-live flip, §6.2 glosses, §2.6/§8.3 stamping. BACKLOG's mass-redaction TODO
still holds: manager email alert on held/mismatch · Deep Scan · batch via fresh upload ·
record-type filtering of batch candidates.

## 2026-08-13 (m) — "legal task screens": verified ALREADY BUILT; three stale records corrected

### Verification-first, fourth time it's paid for a slice
Kevin picked the "legal task screens" follow-on. It traces to item 10's note ("Dedicated legal task
screens remain NOT BUILT") and SPEC_tasks_roles_mrr_fees §7's two `[NOT BUILT]` tags — all three
predate what's on disk:
- **legal_review** has had a DEDICATED screen since 2026-07-19 (ac): LegalReviewTaskPage at
  `/legal-review/:taskId` — assertion evidence trail, AG-vs-internal toll banner derived from the
  assertion (not the stage row), three outcomes, required note, cancelled-task guard, `legal`
  time-capture mode (`available: true` since the same day). Built, and verified end-to-end in the
  running UI, in the (ac) session itself.
- **legal_redaction** opens the full redaction WORKSTATION (`/redaction/:taskId`), which is
  explicitly legal-aware: "Legal (advanced) redaction" header, the `legal` disposition's mandatory
  second-reviewer gate, send-for-legal-review hand-off, `legal_redaction` time-capture mode. One
  workstation for the redaction family is the design — legal redaction is the same work at a higher
  review bar, rendered from the job's disposition.
- Reachability is HARNESS-LOCKED (the lesson that built this screen): verify_legal_review §H fails
  if a resolvable type lacks a TASK_SCREEN entry. Suite ran 2115/2115 green earlier today.

### Corrected (docs only, no code)
SPEC_tasks_roles_mrr_fees §7 (both tags now describe the built screens) · BUILD_PRIORITY item 10
(strikethrough + pointer). No build, no restart needed.

### Observations recorded, NOT acted on
- Time-capture UIS still has `mrr: available: false` — MrrActivityTaskPage exists since BW6, so that
  row may now be wireable. MRR scope, its own slice.
- The genuinely OPEN legal item is §14's "legal hours in the estimate" (Kevin's 2026-07-15 sketch;
  needs a routing/task-spawn design pass before build). THAT is the real successor to this follow-on
  if legal work is to continue.

### The board
Follow-on list shrinks again: legal task screens DONE (was already done). Remaining follow-ons:
chat-agent model upgrade · v3 collapse · search-activity tracking. Plus §14 legal-hours-in-estimate
(open design), pre-production hardening, Kevin's testing/demo, go-live flip, §6.2 glosses,
§2.6/§8.3 stamping.

## 2026-08-13 (n) — legal hours in the estimate: DESIGN PASS DONE (design only, no code)

### What the pass found (mapped the as-built engine before designing)
Kevin's July sketch was half-built already: classifier flags route flagged requests to the
open-records team at intake (`wfr-sensitive`, priority 5) and spawn `intake_review`
(`sensitivity_flag`). The genuinely missing mechanics: (1) no way for legal expertise to contribute
EXPECTED hours to a quote (the estimate snapshot is append-only, one author per POST; the MRR
roll-up rides numbers as prose — the recorded anti-pattern); (2) no legal labor category in the
engine (three drivers; legal ACTUALS fold into `review`); (3) `legal_redaction_required` fires only
at redaction stage, invisible at pricing time.

### The design (docs/DESIGN_legal_hours_estimate.md — the binding record)
Hand-assigned `legal_estimate` task (eligibility = existing `legal_review` token; joins
HAND_ASSIGNED_TASK_TYPES) spawned from the estimate screen ("Ask legal for hours") or the MRR hub
master (parent-level, deliberately not per-child); structured answer in new `legal_estimate_inputs`
+ history row; estimator Accept-pre-fills `legalHours` (stays the single author). Engine: fourth
labor line "Legal review", config inherits the `review` driver parent-ward unless the city sets
`labor.legal.*` (measure-always/gate-chargeability, the variant-inheritance pattern); free-hours
order search → review → legal → programming; reconciliation compares estimated (review+legal) vs
actual review. New deterministic intake trigger `legal_rt` off `legal_redaction_required` with
parent walk-up. Four build slices with named harnesses.

### Kevin's decisions (AskUserQuestion, notice-line previews)
1. **Soft block** — an open legal ask warns but does not stop the estimate send; revisions handle a
   late answer. 2. **Own notice line** — "Legal review (N hrs @ rate)", not folded into review.

### The board
§14's open legal design is now DECIDED (build is 4 slices, unscheduled). Remaining follow-ons:
chat-agent model upgrade · v3 collapse · search-activity tracking. Plus pre-production hardening,
Kevin's testing/demo, go-live flip, §6.2 glosses, §2.6/§8.3 stamping.

## 2026-08-13 (o) — legal hours in the estimate, slice 1 SHIPPED: the ask + the answer

### Built (DESIGN_legal_hours_estimate.md slice 1, as decided)
- **Schema**: `legal_estimate_inputs` — one row per ask+answer exchange (ask_note/asked_* + the
  structured hours/note/entered_* answer; superseded flag). The ask half lives in the same row
  (tasks has no notes column; the question belongs with its answer) — design doc updated in-commit.
- **Task type `legal_estimate`**: hand-assigned (joins HAND_ASSIGNED_TASK_TYPES, own unclaimable
  role key), askable only of `legal_review` token holders. Routes at `/api/legal-estimate`:
  ask (note + named person required; re-ask cancels the open task and supersedes its row),
  panel read (open ask + current answer), answer (assignee-only, hours + note required, 409 on a
  finished task — the resolve-route lesson applied at birth).
- **Screens**: LegalEstimateTaskPage (`/legal-estimate/:taskId`, thin Phase-2 shape) + MyTasksPage
  entries added WITH the spawner (reachability locked in the harness). FeeEstimatePanel: "Ask legal
  for hours" modal (staff picker filtered to legal_review holders), amber pending banner carrying
  Kevin's soft-block sentence, green answer banner. Accept-pre-fill deliberately waits for slice 2's
  `legalHours` field — a control that pretends to apply the answer would be theatre.

### Evidence
`verify_legal_estimate` **21/21** (ask gates incl. NOT_LEGAL in words; structured storage; history
rows; assignee-only answer; 409 re-answer; one live question; supersede chain; notice SENDS with an
open ask — the soft block proven, not asserted; reachability; world restored). **Full suite
2136/2136, live untouched, exit 0.** One re-run was needed: verify_stages 26/27 with a Playwright
timeout — caused by running the frontend build CONCURRENTLY with the suite (harnesses drive the
nginx-served build/, and CRA swaps it mid-run). Lesson memorized; suite alone → 42/42. Deployed
(API restart 200, nginx 200). **Live-probed end-to-end** on a fresh request via real paths: ask →
pending banner (`exchange/legal_ask_pending.png`) → David Okafor's task screen
(`legal_ask_task.png`) → 4-hour answer → green banner (`legal_ask_answered.png`). David's task-type
grants snapshot-restored exactly; probe family purged; zero residue.

### For Kevin (data, not code)
**No live user holds the `legal_review` task type** — the ask picker will say so until you grant it
in Staff Management (David Okafor held it only for the probe, then restored).

### The board
Design slices 2 (engine Legal line + Accept), 3 (`legal_rt` intake trigger), 4 (MRR hub ask) remain.
Follow-ons: chat-agent model upgrade · v3 collapse · search-activity tracking. Plus hardening,
testing/demo, go-live flip, §6.2 glosses, §2.6/§8.3 stamping.

## 2026-08-14 (a) — legal hours in the estimate, slice 2 SHIPPED: the engine's Legal review line

### Built (DESIGN_legal_hours_estimate.md slice 2, both Kevin forks honored)
- **`legalHours`** is a fourth labor driver. `feeEngine.legalLaborConfig` resolves its EFFECTIVE
  config — review's entire config (rate, increment, rounding, billable, billableWhen, citations)
  under any explicit `labor.legal.*` — computed AFTER the purpose merge so commercial flips carry.
  Free-hours order search → review → legal → programming (identical behavior at legalHours 0).
- **Notice**: its own line, "Legal review of the records: N hours at $X/hour = $Y" (Kevin's fork 2).
- **Chargeability**: the `legal` builder box judges the same effective config (shared helper), so
  the boxes never disagree with what the engine prices; a legal-only prohibition hides only legal.
- **Reconciliation pairing**: `applyMeasuredLabor` zeroes estimated `legalHours` on every component
  (legal actuals already arrive inside measured review — leaving them would double-charge);
  `estimatedHoursFromInput` folds legal into the review figure so the readout compares like pairs.
- **Panel**: "Legal review hrs" field (chargeability-filtered) + **Accept into Legal review hrs** on
  the answer banner — fills the FIRST component (mirroring where measured labor lands), estimator
  still calculates and saves. The slice-1 "coming soon" copy is gone.

### Evidence
`verify_legal_line` **16/16** first run (inherit rate; rate/billable overrides diverge only legal;
the TX 50-page paper bar bites and releases legal exactly as review; commercial carry-through;
free-hours order; inherited rounding; per-request rate override by key; the notice line verbatim;
reconcile zeroing + readout pairing; chargeability agreement incl. legal-only prohibition with
citation). **Full suite 2152/2152, live untouched, exit 0** — run ALONE, build sequenced after
(yesterday's lesson applied). Deployed (API 200, build compiled, nginx). **Live-probed**: ask →
answer (4h) → Accept → Calculate → itemized "Legal review labor … $60.00", overhead $12, total $72
(`exchange/legal_line_accepted_priced.png`); live notice text carries the exact line. David's
grants snapshot-restored; probe family purged, zero residue.

### The board
Design slices 3 (`legal_rt` intake trigger) and 4 (MRR hub ask) remain. Then the standing list:
chat-agent model upgrade · v3 collapse · search-activity tracking · hardening · testing/demo ·
go-live flip · §6.2 glosses · §2.6/§8.3 stamping.

## 2026-08-14 (b) — legal hours in the estimate, slice 3 SHIPPED: the deterministic legal_rt trigger

### Built (DESIGN_legal_hours_estimate.md slice 3)
`legal_rt` joins the intake_review trigger enum (now six keys) as the DETERMINISTIC twin of
sensitivity_flag: when classification PINS a record type carrying `legal_redaction_required` — own
flag or inherited from its parent bucket — the request stops for intake review, so legal work is
visible at PRICING time, not first at the redaction stage. The walk-up was extracted from
`requestNeedsLegalRedaction` into `taskRouting.recordTypeLegalGate` so the intake trigger and the
redaction-stage escalation share ONE definition. Spawn site mirrors its twin in
`workflowEngine.onIntake`: MRR excluded, moved-under-us excluded, additive on an open task; fires
off the record-type PIN (confidence >= 70), never off the guess. Labelled for the queue and screen
("… — expect legal hours in the estimate"); no frontend change needed (labels are server-served).

### Two suite guards moved WITH the change (both correct trips)
`verify_bw2_catalog` C0/C1 pin the trigger enum and the wired set — updated to six keys with the
provenance comment (the guard's intent — the list grows WITH its spawners — is exactly what
happened). `verify_bw3_intake_review` gained §G (6 checks): fires deterministically with no AI flag;
walks up from an unflagged variant; ungated type silent; keys JOIN one task with sensitivity_flag;
a low-confidence guess (no pin) triggers nothing; label content.

### CENSUS FALSE POSITIVE, diagnosed and memorized (not a code problem)
First run: "LIVE WAS MODIFIED: request_history 910 -> 930". The 20 rows were `REDACTION_APPLIED` by
**"Scheduled Batch"** at 01:25 — the LIVE API's own mass-redaction nightly worker running a queued
job inside its 18:00–06:00 window DURING the suite. The census counts rows and cannot see who wrote
them. Verified no queued/running mass jobs remained, re-ran: green. Memory note
`census-vs-nightly-worker` records the diagnosis path (read the new rows' actor FIRST).

### Evidence
`verify_bw3_intake_review` **54/54** (§G new) · `verify_bw2_catalog` **55/55** · **full suite
2159/2159, live untouched, exit 0.** API restarted (200). Live posture: all 84 live types still
carry `legal_redaction_required = 0`, so live behavior changes only when Kevin flags a type — the
same city-decides posture the gate itself shipped with.

### The board
Design slice 4 (MRR hub ask) is the last legal-hours slice. Then: chat-agent model upgrade ·
v3 collapse · search-activity tracking · hardening · testing/demo · go-live flip · §6.2 glosses ·
§2.6/§8.3 stamping.

## 2026-08-14 (c) — legal hours in the estimate, slice 4 SHIPPED: the hub's parent-level ask. THE DESIGN IS FULLY BUILT.

### Built (DESIGN_legal_hours_estimate.md slice 4 — the last one)
The MRR hub master's estimate block gained the parent-level "Ask legal for hours" (manage-gated,
hub-grammar modal with the legal-staff picker + required note) and a status line: pending carries
the soft-block sentence; the answer says where it lands ("… as Legal review hrs"). One ask for the
whole request — exemption analysis spans items — so it is deliberately NOT a per-child activity and
`mrr_estimate_data` is untouched; the answer feeds the ONE master estimate through the slice-2
panel. Nothing blocks Generate. Backend unchanged: the slice-1 routes were request-agnostic and the
parent is a request.

### Evidence
`verify_legal_estimate` **26/26** (§G new: real 2-child MRR parent — ask/answer/read on the same
rails; nothing lands on a child, asserted; hub control source-locked). **Full suite 2164/2164, live
untouched, exit 0.** Suite → build → deploy sequenced. **Live-probed on a true 2-item MRR**: hub
master pending state (`exchange/legal_hub_pending.png` — Generate stays readiness-gated only) →
David answers 4h → answer line (`legal_hub_answered.png`). Probe purged, David's grants restored.
Design-doc slice 4 marked BUILT with the harness-ownership note (verify_legal_estimate §G owns it;
the bw6 pointer predated slice 1).

### Where this leaves legal hours
All four slices BUILT in two days, every Kevin fork honored: ask+answer (28d5280) · engine line
(b9f95a5) · legal_rt trigger (8b8140a) · hub ask (this). Standing note for Kevin: nobody on live
holds `legal_review` yet — grant it in Staff Management to activate the pickers.

### The board
Legal-hours design COMPLETE. Remaining: chat-agent model upgrade · v3 collapse · search-activity
tracking · pre-production hardening · Kevin's testing/demo · go-live flip · §6.2 glosses ·
§2.6/§8.3 stamping.

## 2026-08-14 (d) — the "empty identity section" Kevin found: fixed (+ taxonomy, same class)

### The finding (Kevin's, from using the app — the best kind)
The Jurisdiction Configuration index showed identity ATTESTED/configured while its detail said
"No content — import a state template or add the first rule." Root cause: the section detail's
Content zone renders the RULES STORE, and identity's substance lives elsewhere (the jurisdiction
profile row + agency system_config) — the exact sources the index's configured-ness signature
reads. The row and the detail were reading different stores. Probing all sections found ONE more
in the class: taxonomy (substance in record_types). Deadlines/clarification/payment/fee_waiver
render fine (my first probe said otherwise — it read `body` where the payload key is `content`;
probe twice, print the HTTP status).

### Built
`ruleEditors.content` branches for identity (statute cited via chip · state · exemption model ·
agency · contact, read-only, from the SAME sources as the signature) and taxonomy (catalog counts +
pointer to the Taxonomy page). Frontend fields-renderer: the edited-elsewhere note panel (exemption's
pattern, generalized), a third provenance label ("statute-derived" for cited-less statute facts —
"State: Texas · city policy" was wrong), and Propose buttons gated on the section actually having a
rules domain (identity/taxonomy have none; a domain-less compose would have errored).

### Evidence
`verify_bw9b_editors` **37/37** (A9b identity: cited statute + agency + read-only note; A9c
taxonomy: counts + /taxonomy pointer). **Full suite 2166/2166, live untouched, exit 0.** Deployed
(build + API 200); identity verified live (`exchange/jur_identity_fixed.png`). SPEC_processing_ui
BW9b paragraph updated in-commit.

### Context for the record
This came out of demo planning: the magic-screen project (Kevin's magicscreen.doc — benchmark/reset,
aging clock, role switch; state-switching PARKED by Kevin for later). TX jurisdiction config turned
out to be fully attested since 2026-08-01 — the "mock config + attestation" ask was already done;
this display fix was the only real gap found. NEXT: magic screen slice 1 (benchmark + reset + the
date-shifter).

## 2026-08-14 (e) — MAGIC SCREEN slice 1 SHIPPED: benchmark + reset + the date-shifter (`8fcb7dc`)

### The project (new: docs/DESIGN_magic_screen.md — read it first)
Kevin's demo/test mode (magicscreen.doc): /magic screen with Reset-to-benchmark (RELATIVE dates
preserved), a "magic clock" that visibly ages the world, role switch. Two agreed inversions anchor
the design: (1) the clock AGES THE DATA (shift back + poke workers), never moves system time;
(2) the clock is also the AUTHORING tool for the ~10 benchmark scenarios (real portal + real
screens + clock advances, then Benchmark). State-switching (TX→OK) is PARKED by Kevin — the
groundwork facts (32-state research DONE, importer lists 32 templates, TX+OH imported, TX attested)
are recorded in the design doc so nothing is re-learned.

### Built (slice 1)
- `services/magicDemo.js`: **benchmark** (full SQL snapshot, FK-topological order, self-ref tables
  parent-NULLS-first, secrets included, server-local `data/benchmarks/`), **reset** =
  build-beside-swap (schema-from-empty on `<db>_magicbuild` — the reset_test_db pathway — snapshot
  load with tasks triggers held off, sequences re-synced, DATE SHIFT by now−taken_at, then two
  renames; failure before the swap leaves the running db untouched; one `_prereset` undo generation
  survives), **shiftDates** exported alone (slice 2's clock = negative delta).
- Routes `/api/magic/{status,benchmark,reset}`: demo_mode='1' (absent ⇒ 404 — the surface does not
  EXIST off-demo; the key is deliberately NOT settable via any API, server access only) +
  SYSTEM_ADMIN + confirm:true on reset.
- **Stray-table guard**: benchmark REFUSES in words (409 STRAY_TABLES) if the db carries tables the
  schema can't rebuild — found live: `poc_request`/`poc_request_child` (July spike leftovers, zero
  code refs, 9 rows archived to `exchange/poc_tables_archive.json`, then dropped).
- **Product fix that mattered beyond magic**: the db pool had NO 'error' listener — ANY terminated
  idle client (Postgres restart included) killed the whole API process. Found because the reset's
  pg_terminate_backend did exactly that to the test API. Fixed in src/db/index.js (and the index.pg
  twin). ⚠️ The FIRST patch went to index.pg.js — the LEGACY twin; src/db/index.js is the live
  module. Check which db file is actually required before patching "the" pool.

### Evidence
`verify_magic_reset` **17/17** (gate 404/403; stray refusal; snapshot; confirm-required; intruder
gone; counts exact; task_events NOT doubled; created_at shifted exactly +1 day; date-only format
kept; API survives the swap; sequences continue; delta-0 restores byte-exact). **Full suite
2183/2183, live untouched, exit 0.** **LIVE reset probed end-to-end**: benchmark (84 tables, 10,688
rows) → marker submitted → reset 200 in 7.9s (14,681 values shifted across 73 columns) → marker
gone, counts exact, API 200 through the swap. Probe markers purged; a CLEAN benchmark
(13 requests) is in place. demo_mode=1 set on this box (operator write).

### Next (the design doc's slice order)
Slice 2 the magic clock (shiftDates negative + worker pokes + clock/calendar UI) · slice 3 role
switch + the /magic screen shell (MOCKUP FIRST — Kevin decides visually) · then request purge +
scenario authoring + the real benchmark.

## 2026-08-14 (f) — MAGIC CLOCK SHIPPED (slice 2): a day passes = the data ages a day

### Built
`POST /api/magic/clock/advance {days|seconds}` (same gates as reset; bounded 1min–90d):
`shiftDates(appPool, −N)` against the RUNNING demo db, then the date-driven workers run
IMMEDIATELY, each isolated — `tickler.runSweep` (THE funnel: estimate lapse incl. lapsed_at,
deposit overdue/withdraw, stall, chained nonpayment dunning/closure + clarification timeout),
`massJobs.tick`, `effectiveConfig.promoteDue`, `reconcileStageTasks` — so consequences land while
the audience watches. Accumulated `magic_clock_offset` in system_config; `GET /magic/status`
serves `syntheticNow` for the future clock face. **Advance REFUSES 409 NO_BENCHMARK when no
benchmark exists** (aging the world with no undo is data loss, not a demo); **Reset zeroes the
clock** (the key is deleted in the build before the swap).

### The time-behavior map (Kevin asked; verified, in the design doc's terms)
Class 1 request-state consequences — ALL funnel through the tickler (verified: it is lapsed_at's
only writer). Class 2 own-scheduler workers — the clock pokes the demo-relevant ones. Class 3
computed-on-read (statutory clocks, budgets, elapsed, link/session expiry) — correct the instant
the data ages, no poke needed. Stray found: `overdue_alert_days`/`escalation_days` are allowlisted
config keys with ZERO readers (v1 remnant; cleanup candidate).

### Evidence
`verify_magic_reset` **24/24** (adds: NO_BENCHMARK refusal · BAD_ADVANCE bounds · 2-day advance
ages created_at AND the statutory clock anchor exactly · workers poked with tickler actions in the
response · status carries syntheticNow · reset zeroes the offset and restores byte-exact).
**Full suite 2190/2190, live untouched, exit 0.** **LIVE probe**: advance 2d in 1.55s (14,663
values; sample request 07-19 → 07-17; syntheticNow 08-16; tickler swept — zeros on this stale
corpus, honestly), reset restored with offset 0 and the benchmark's relative ages preserved to the
second (+18min = exactly the benchmark's age). API alive throughout.

### Next
Slice 3: the /magic screen shell — role switch + the clock/calendar visuals. MOCKUP FIRST (Kevin
decides visually): hold-the-arrow advance, analog clock + calendar with the date highlighting.
Then: request purge → scenario authoring with the clock → the real benchmark.

## 2026-08-14 (g) — THE MAGIC SCREEN IS COMPLETE (slice 3): /magic live, all three zones

### Built (Kevin approved the mock — exchange/magic_screen_mock.png — same day)
`/magic` (URL-only, NO nav entry — harness-asserted): the dark backstage console. Left: Reset All
(confirm modal, relative-time promise in words) + Benchmark now (the modify-then-benchmark workflow
as one sentence). Center: the clock hero — SVG analog face on syntheticNow, month calendar with
real-today (dashed) vs demo-today (amber), HOLD-to-advance (sequential half-day ticks, each awaits
the server so the workers always keep up — ~2s/day, inside Kevin's envelope), +1/+7 buttons, drift
line, and the "the system noticed" strip rendering tickler actions in plain words with a Tickler
link. Right: Become — curated cast in system_config `magic_cast`, edited ON the screen
(add-from-staff, remove), `POST /magic/become` mints a real session via the login signer, client
swaps localStorage and reloads. Off demo mode the page says "not in demo mode — there is nothing
here"; every API behind it 404s.

### Evidence
`verify_magic_reset` **29/29** (adds: become 403 for non-admin; cast 404 on nobody; cast
round-trip with names joined; Become's token WORKS — /auth/me answers as the target; /magic route
exists, page real, NO nav entry). **Full suite 2195/2195, live untouched, exit 0.** Deployed
(build + API 200); live screenshot `exchange/magic_screen_live.png` — in-sync calendar state,
empty cast with picker.

### THE MAGIC SCREEN PROJECT: slices 1–3 ALL BUILT in one night
Benchmark/Reset (95bddb6) · the clock engine (6e418bf) · the screen (this). What remains is
Kevin's authoring work, with help: purge the current requests (guarded corpus purge) → build the
~10 scenarios through the real app using the clock → press Benchmark. Then rehearse, tune the
cast, adjust. Parked: per-state switching (design doc records the groundwork).

### The wider board
Magic screen DONE · legal-hours design DONE (4 slices) · mass-redaction hand-off DONE · legal_rt
trigger DONE · identity/taxonomy config render DONE. Standing: chat-agent model upgrade · v3
collapse · search-activity tracking · hardening · go-live flip · §6.2 glosses · §2.6/§8.3 stamping.

## 2026-08-14 (h) — the ChatGPT sample corpus is WIRED: 9 department drives, 450 documents

### Built (data/config, no code — Kevin's batches from exchange/new_docs)
Three batches (4A/4B/4C), 450 native-text PDFs across 21 record types with per-batch manifests
(document_id, department, record_type, person, address, redaction_complexity). Organized FLAT per
department (the filestore connector reads flat dirs via pdftotext) into
`/opt/optimumq/demo_sources/<dept>/` (gitignored): development_services 160 · finance 70 ·
utilities 50 · public_works 40 · code_enforcement 40 · fire 40 · police 20 · engineering 15 ·
planning 15. Nine "shared drive" sources created via the REAL repositories API with plain-words
descriptions; seven record types linked ADDITIVELY via the real sources PATCH (building permits ·
certificates of occupancy · inspection reports · business licenses · purchasing/vendor ·
utility billing · fire inspection reports). PW/engineering/planning drives deliberately unlinked
(no honest catalog match). Sources screen verified live: all nine Connected with holdings
(`exchange/sources_dept_drives.png`). Connector verified deterministically: countAll honest
(160/70/50/40 spot-checked), pdftotext extracts real form text. Fresh benchmark taken AFTER the
wiring ("sources wired — 9 dept drives, 450 docs") so Reset preserves it.

### ⚠️ BLOCKED, needs Kevin: THE ANTHROPIC ACCOUNT IS OUT OF CREDITS
The variant-discovery probe (the point of the corpus: 25-doc uniform piles → ⚡ mass-redaction
candidates → the "Waiting for a template" hand-off) reached the model call and got:
"Your credit balance is too low to access the Anthropic API." This blocks EVERY AI feature —
the classifier (tonight's portal submits silently fell back to unclassified defaults), variant
discovery, AI search assists, the portal chat agent. **The demo cannot run its AI story until
billing is topped up.** Once credits exist: POST /taxonomy/record-types/rt-building-permits/
discover-variants should propose Residential/Industrial Building Permit Applications etc. with
honest counts (share × 160) and mass-candidate flags; approve one and the Mass Redaction
"Waiting for a template" card completes the circle. Manifest ground truth to compare against:
25 docs per 4A type, 20 per 4B/4C type.

### The board
Magic screen COMPLETE (3 slices) · sample corpus WIRED (AI probe pending credits) · Kevin's
scenario authoring + real benchmark pending (he's thinking through the script) · state-switching
parked · standing list unchanged.

## 2026-08-14 (i) — credits restored: the discovery test RAN; flags fire with honest quantity

### Evidence (two live scans, API-level)
rt-business-licenses: 78 sampled / 98 total across 3 drives → "Business Licenses" 64%, est 63,
few_layouts, ⚡ MASS CANDIDATE (+ a correct stray "Building Permits" est 4 ⚡ from the old sample
drive; 31% honestly ungrouped). rt-building-permits: 98/208 → three groupings, all ⚡, est 89/75/4.
The corpus does exactly what Kevin bought it for. NOT approved tonight — deliberately: the
benchmark (04:23 wiring snapshot) predates all discovery, so the modal → approve → "Waiting for a
template" → Reset loop is Kevin's REPEATABLE demo moment; approving now would bake tonight's
AI-named variant into his rehearsal space.

### Finding recorded (follow-on candidate, not fixed)
Filestore sampling is ALPHABETICAL (first 50 per drive) and the AI digest caps ~14k chars, so on a
160-file drive the model mostly saw the types that sort first — the Building-permits scan proposed
inspection-report/correction-notice groupings over the actual permits. Counts stay honest
(share × real total); the grouping MENU skews to the alphabetical front of large corpora.
Candidate fix: randomized sampling + larger/varied digest budget. Decide with Kevin before touching
the scan's behavior.

### Also
The classifier is back too (credits) — tonight's earlier submits fell back silently; future portal
submits classify again.

## 2026-08-14 (j) — Public Ready Control Center (nav regroup) + a debugging lesson that must not be lost

### Built (Kevin's last ask of the day)
The sidebar gains a **PUBLIC READY CONTROL CENTER** group — everything that converts
internally-stored records into public-facing ones, in PIPELINE order: Find Same-Format Records
(→ /admin?tab=taxonomy, the variant-discovery entry point) · Mass Redaction · Released Records ·
Public Record Geo Location (label rename of Records Map; ROUTE unchanged — wire formats keep old
names) · Public Records Library (→ /portal/library, the public page linked for internal eyes).
Group is a visible header with indented children, deliberately NOT a popup (nothing hidden behind
hover state). Verified live: `exchange/nav_public_ready.png`. Suite **2194/2194, live untouched.**

### The suite trip after the nav change — and where the real bugs were
verify_magic_reset failed 2 (C6, D2) the moment credits returned. D2 was real-but-shallow: the
bookmark trigger logs status CHANGES, and the arbitrary task pick could grab an already-'assigned'
row (smart routing runs again now) — pick `status='open'`. C6 cost three WRONG fixes (settle waits,
a 12s stability window, a stale-connection sweep) before diagnostics found it: **the harness
captured `aDeadline` from the submit-time row OBJECT** — the pre-classifier +10-day default —
while every other baseline field read fresh. One stale JS field, phantom "shifter is broken."
**Lesson, spelled out in the harness comment: a baseline mixing fresh reads with captured objects
is lying about one of them. And: instrument BEFORE the third guess, not after.**

### Keeper hardening found on the way (real, stays)
`magicDemo.reset` now sweeps connections off the RENAMED old database after the swap — a client
that reconnected in the terminate→rename gap would otherwise keep reading the pre-reset world.
Not tonight's culprit, but a genuine race the swap design had.

### Session close
Kevin is done for the day. Open items for his return: the alphabetical-sampling skew decision ·
request purge + scenario authoring + the real demo benchmark · the parked state-switching ·
the standing board (chat-agent upgrade · v3 collapse · search-activity tracking · hardening ·
go-live flip · glosses/stamping).

### Parked for NEXT SESSION (Kevin, end of day 2026-08-14)
**Discuss: forcing public-ready records into reasonably LIMITED buckets vs a broad range.** The
question behind the Public Ready Control Center pipeline: should the convert-to-public flow steer
cities toward a curated, limited set of record-type buckets (predictable templates, dense
same-format piles, cleaner mass redaction), or stay open to a broad range of types? Touches the
variant scan, mass-redaction templates, the library, and probably taxonomy design. Discussion
first, no build.

## 2026-08-14 (k) — library destination: every released record gets a SHELF a citizen can find

### The discussion that opened the session (the parked limited-vs-broad question)
Kevin's scenario: staff paste an ad-hoc pile somewhere, point mass redaction at it, publish — where
does it land? Traced answer: NOWHERE browsable. fulfilled_records takes record_type_id/department_id
ONLY from the parent request; request-less batches got NULL/NULL → the library's "Other →
Uncategorized" junk drawer, and auto_publish (also read off the request) could never fire. No AI
groups anything at the library — the browse tree is just two FK joins. Decision (Kevin): per-doc AI
placement is the wrong grain; the shelf is a HUMAN decision made once per pile at the point of work,
AI/template supplies the default. This mostly answers limited-vs-broad without new machinery: the
effective public list stays naturally limited because mass output flows through templates bound to
curated types; the internal 77-type taxonomy is untouched. Confirmed separate from the
variant-discovery scan code — only shared object is layout_profiles.record_type_id (read, not changed).

### Built (one slice)
- `mass_redaction_jobs.record_type_id/department_id` (additive schema) + `services/libraryShelf.js`
  (owner-department walk-up: variant → parent, same COALESCE the classifier routes with).
- Job creation defaults the destination from the template's linked type + owner dept; explicit pick
  wins; the job list names the shelf. The immediate apply-batch path takes the same destination.
- `redactionApply.applyRedaction` + `structuredRedaction.applyFieldMap` accept a destination;
  REQUEST VALUES ALWAYS WIN — destination fills only NULLs. auto_publish now reads the effective
  type, so scheduled request-less batches can auto-publish (was structurally dead).
- Publish gate: `POST /released/:id/publish` refuses unshelved records (plain-words 400); body may
  shelve-and-publish in one step (dept resolvable from the type's owner routing). Unpublish free.
  ReleasedRecordsPage: "No library section" pill + picker modal instead of a dead error.
- Public browse rolls VARIANTS up to the parent bucket (`COALESCE(parent_record_type_id, ...)`);
  drilling a bucket includes its variants' records. Processing-artifact names never become shelves.
- UI: Mass Redaction compose gains the "Public library section" block (prefilled, with the honest
  "can't publish without one" consequence line); job cards show their shelf.

### Evidence
`verify_library_destination` **18/18** (job defaults + override; stamp on request-less, request wins
on conflict; auto_publish fires; publish 400 → shelve-and-publish 200; browse shows parent not
variant; drill returns variant-stamped record). **Full suite 2212/2212, LIVE UNTOUCHED, exit 0.**
Deployed (API restarted, build + nginx 200). Screenshots: `exchange/mass_job_destination.png`
(compose modal with the destination block — record type prefilled from the template, dept honestly
"Not set" since 911 Call Records has no owner routing row), `exchange/released_records_live.png`.
Specs updated same commit: SPEC_public_library §2a + §3 roll-up note, SPEC_redaction §mass-queue.

### Open threads
- 911 Call Records (and likely others) have no `record_type_departments` owner row → dept defaults
  to "Not set" in the compose UI. Worth a pass over the catalog's owner routing, or the shelf dept
  default stays blank for those types.
- Kevin will someday revisit the search/comparison (variant discovery) sampling skew — separate code,
  unaffected by this slice.
- Standing board unchanged: request purge + scenario authoring + real benchmark · state-switching
  parked · chat-agent upgrade · v3 collapse · search-activity tracking · hardening · go-live flip ·
  glosses/stamping.

## 2026-08-14 (l) — fingerprint discovery + redaction content audit: the scan is DETERMINISTIC now

### The discussion (Kevin's design session, then "build what you believe should be built")
Kevin proposed replacing the AI-digest matching with code that reads fixed zones/measurements per
document, stores them, groups by tolerant matching (8-of-10), and demotes AI to naming/validation.
Extended it live with: a PERSISTENT index so a later scan of a DIFFERENT location recognizes the
same template (date-split storage → "leverage the same mass redaction template"); semi-fixed
templates via anchor-relative zones; print-driver drift normalization; and a per-item audit that
checks each burned zone covered what its rule names. Build/park decisions were mine (mandated):
BUILT fingerprint census + recognition (slice B) and the deterministic content audit + leak scan
(slice A); PARKED with full designs written into specs: anchor-relative zones (§6b SPEC_redaction —
authoring UI needs a mockup session per the UI rule), vision/image-crop audit for scans, OCR/OpenCV
registration for image-only archives, multi-section/cross-page flow.

### Slice A — redaction content audit (verify_redaction_audit 14/14)
`services/redactionAudit` runs inside EVERY zone apply: covers-no-text (drift), covered-text-
doesn't-contain-a-complete-<kind> (rule title → SSN/phone/email/card/DOB detector; partial-value
catch), and the LEAK SCAN — a value of a redacted kind visible outside every box. Advisory only;
flags persist on redaction_jobs.audit_flags, render per-file in batch results ("Content check:"),
roll into mass job issue logs. Flags NEVER contain covered text (asserted: no PII in logs). Fields
path exempt (no zones).

### Slice B — fingerprint discovery (verify_fingerprint_discovery 18/18)
`services/docFingerprint` + persistent `document_fingerprints` (hash-keyed, extract once ever) +
filestore `listFiles`. The variant scan now: census EVERY file → recognize against approved
variants' stored consensus signatures (discovery_meta.signature, written at approval; cluster docs
stamped matched_record_type_id) → cluster the remainder (union-find, 8/10 threshold, min 3) →
AI names the clusters it is handed (2 excerpts + label set each; no 14k digest, no counting).
Counts EXACT (`counted: true`, modal says "documents (counted)"); layout uniformity MEASURED;
image-only files reported as `unreadable`, not silently skipped. Legacy sample-digest kept only
for connectors without file access. Modal gains the green "Already known — recognized, not
re-proposed" section (template-ready vs needs-template). The alphabetical-skew finding from
2026-08-14 (i) is FIXED by construction — there is no sample.

### Evidence
Suite **2244/2244, LIVE UNTOUCHED, exit 0** (adds 18 + 14). Live probe on the real corpus:
rt-business-licenses → method fingerprint, **98 of 98 read** (~20s incl. first-time pdftotext of
every file + ONE small naming call), clusters **50 + 20 + 20 counted** (Business License
Certificates / Basic / Enhanced Vendor Registration), all ⚡ with measured layouts, 8% honestly
ungrouped. Compare (i): 78 sampled, one grouping "est 63" at 64%, 31% unaccounted. Screenshot
`exchange/fingerprint_discovery_live.png`. NOT approved — same reasoning as (i): approving would
bake variants into Kevin's rehearsal space; the modal → approve → hand-off loop stays his demo.
Deployed (API restarted, build + nginx 200). Synthetic-PDF probe: same-template docs with
different names/numbers score 10/10, different templates 4/10.

### Notes / open threads
- An early mis-clicked probe ran discovery once on a different bucket (first Find-variants button
  on the page) — side effect is only extra rows in the fingerprint index + one model call.
- The naming call keeps the file's existing pinned model — the model upgrade remains Kevin's
  standing board item, deliberately untouched.
- document_fingerprints is LIVE derived data now (~200 rows from probes) — it is an index, safe.
- Standing board otherwise unchanged; parked designs above are written in the specs, not just here.

## 2026-08-14 (m) — DISCUSSION ONLY: two-product split analysis (no build)

Kevin asked what it would take to split the build into two products — (A) open-records request
management and (B) document layout matching / mass redaction / public library — composable when a
customer buys both, standalone otherwise. Full write-up delivered to
`/home/optimumq/exchange/PRODUCT_SPLIT_ANALYSIS.md` (grounded in a three-way code scan; no code
touched). Headlines: the boundary largely already exists (processing side never imports
requestScope; seam = 3 shared tables + 4 function-call crossings + 5 direct `requests` reads + the
synthetic container-request hack); recommendation is one codebase / one installer / two license
keys, phased as (1) bridge-module seam formalization + retire container requests, (2) entitlement
gating (none exists today — the ONBOARDING_TAXONOMY_GATING two-key strategy was never built).
Incidental defects surfaced by the scan, worth fixing regardless: `/api/mass-jobs` has NO role gate
(requireAuth only), and request-less processing work has no audit trail (`request_history.request_id`
is NOT NULL). Product decision parked with Kevin before any build: where redaction lives for an
A-only customer (kernel vs. B-only vs. redaction-lite) — that decision defines the kernel.
Standing board unchanged.

## 2026-08-14 (n) — mass-jobs role gate + processing_history audit trail (the two "fix regardless" defects)

### Scope note (Kevin, mid-session)
Kevin clarified the product split itself is PARKED until after go-live — nothing from the split
plan was built. This slice is only the two security defects the split scan surfaced that exist in
the product as it ships today. Mid-session he also pulled up the (l) fingerprint thread for review:
recap delivered; the open item there is the §6b anchor-relative-zones AUTHORING UI, which needs a
mockup session with him before build (UI rule). Nothing else touched on that thread.

### What was built
- **Role gate**: every `/api/mass-jobs` MUTATION (create, pause/resume/cancel, run-now, 911
  generate/pull/run-now) now requires `requireRoleOrPerm(['DIRECTOR','SUPERVISOR'],
  ['REDACTION_WORKER','REDACTION_AUTHORITY'])` (SYSTEM_ADMIN passes inside). Was requireAuth only —
  any logged-in staffer could burn redactions across an archive or cancel a batch. Reads stay
  requireAuth. REDACTION_AUTHORITY is accepted but is still an orphan nothing else consults.
- **Audit trail**: new `processing_history` table (insert-only; seq BIGSERIAL for true order;
  mirrors request_history's actor columns — that table couldn't serve, request_id NOT NULL).
  `services/processingHistory.record()` never throws (failed audit write logs loudly, never aborts
  the work). Written on: job created/paused/resumed/canceled/run-now (named actor); EVERY worker
  chunk (`chunk_processed` — forcing user on run-now, else 'Scheduled Batch'; counts +
  forced/completed); 911 connector generate/pull/run_pipeline incl. the unattended daily batch.
  details = shape facts only, never covered text (§6a rule). Read-back: `GET /mass-jobs/:id/history`.
  NO UI surface yet (UI rule — needs a design pass; trail is queryable meanwhile).

### Evidence
`verify_processing_audit` **21/21** (403s for a no-role staffer on create/cancel/run-now/911; create
allowed for REDACTION_WORKER perm holder and sysadmin; reads open; 401 with no token; trail rows
with correct per-action actors incl. Scheduled Batch attribution; details counts-only, no-PII scan;
read-back parses). **Full suite 2265/2265, LIVE UNTOUCHED, exit 0.** Deployed: API restarted,
`processing_history` confirmed on live (0 rows), unauth mutation → 401. No frontend change needed —
mutation errors already surface the server message, reads ungated. Spec updated same commit:
SPEC_redaction §6 (gate + trail paragraphs).

### Open threads
- The rest of the processing side (redaction jobs/templates/rules, repositories, taxonomy writes)
  is still requireAuth-only — same class of gap, deliberately NOT swept into this slice. Worth its
  own pass if hardening continues pre-go-live.
- Trail UI (a "history" strip on the job card / released-record page) — design session first.
- Standing board unchanged: request purge + scenario authoring + real benchmark · state-switching
  parked · chat-agent upgrade · v3 collapse · search-activity tracking · hardening · go-live flip ·
  glosses/stamping · product split (parked until after go-live) · §6b anchor-zones mockup session.

## 2026-08-14 (o) — processing-side role-gate sweep (the ring around (n)'s mass-jobs gate)

### What was built ("proceed with what's next" — Kevin)
The rest of the processing surface had the same defect (n) fixed for mass jobs: requireAuth-only
mutations. Now:
- `middleware/auth.js` exports the SHARED gate `requireRedactionWork` (DIRECTOR/SUPERVISOR roles or
  REDACTION_WORKER/REDACTION_AUTHORITY perms; SYSTEM_ADMIN passes); massJobs now imports it.
- Gated with it: redaction workspace (job create, zone CRUD, AI discover/suggest-rule, apply,
  submit/begin-review/return, released-record PUBLISH), template single-apply + stage, rules library
  (create/edit/delete/discover/approve), structured apply, all five AV mutations, repository
  ingest/run.
- Repository CONFIG (create/edit/delete, ai-configure, paper-index import) = SYSTEM_ADMIN/DIRECTOR
  (redactionConfig EDIT precedent).
- Deliberately UNCHANGED: templates' stricter in-handler isElevated bar (create/edit/delete/dismiss/
  apply-batch — includes DEPT_MANAGER, so fronting it with the worker gate could lock out managers);
  rules-approve's own isElevated check; compute-only endpoints (template match/match-batch,
  structured preview); ALL reads. Taxonomy writes left alone (BW9b editors model — its own design).

### Evidence
`verify_processing_gates` **30/30** (no-role 403 across every gated group; worker passes; worker
403 on admin-only repo config; elevated bars unchanged — worker still can't create templates; reads
open; 401-before-403). **Full suite 2295/2295, LIVE UNTOUCHED, exit 0.** Deployed: API restarted,
200; unauth workspace mutation → 401 on live. Seed staff all hold pr-redworker, so no demo flow
changes. No public page touches gated endpoints (checked). Specs same commit: SPEC_redaction §6
(domain-wide gate paragraph), SPEC_sources_imports_connectors §1.

### Open threads
- Should PUBLISH (public library exposure) require more than REDACTION_WORKER? Today it takes the
  shared work gate; a stricter authority tier (e.g. finally giving REDACTION_AUTHORITY a job) is a
  product call for Kevin.
- Rules-library approve keeps its isElevated (supervisor+) bar — if legal review should gate it
  instead (ATTORNEY_REVIEWER, like jurisdictionProfile attest), that's also Kevin's call.
- Remaining requireAuth-only WRITE surfaces outside processing: taxonomy/catalog writes (editors
  model exists — reconcile, don't duplicate), files.js request-side mutations (request-domain roles).
- Standing board unchanged (incl. product split parked until after go-live; §6b anchor-zones mockup
  session pending).

## 2026-08-15 (a) — Open Records OFFICE vs FULFILLMENT TEAM split + Teams-tab rework (Kevin's session)

### The correction (Kevin) and the decisions (his, via Q&A)
Kevin flagged that "Open Records" on the Staff page conflated two real-world entities. Confirmed in
data: dept-openrecords was ONE row serving as both the ORO (his own staff home) and the catch-all
fulfillment team. DESIGN_user_type_role_model.md §7 had specified the distinction in 2026-07; the UI
realized it as the "staffing-only" concept but the DATA was never split. Kevin's decisions: full
split; Michael Hargrove + Tom Jones staff the new fulfillment team; popup comment text; tab renamed
"Teams" with the Office pinned above a "Fulfillment Teams" heading. His MRR nuance recorded in §7:
the Office manages MRRs (associate manages, generates roll-up estimate) — compatible because MRR
child work is hand-assigned, never team-routed.

### What changed
- DATA (live, verified by query): dept-openrecords → "Open Records Office", is_open_records=0,
  serves nothing (staffing-only; Kevin/Kerri/Steve). NEW team-openrecords "Open Records Fulfillment
  Team" (ORF) carries is_open_records=1 (the fallback consumed by classifier/workflowEngine/requests)
  and took Building & Planning, Public Works, PIO, Parks & Rec. Michael + Tom moved to it; Michael's
  title typo ("Clderk") fixed. Seeds updated to produce this on fresh install (seed_teams_provisional
  rewritten — no longer provisional in substance; fulfillment-teams seed comment corrected).
- UI (OrgPage): tab "Fulfillment Teams" → "Teams"; office teams (serve nothing, not fallback) pinned
  on top with "Oversight (not routed)" badge (renamed from "Staffing only"); "FULFILLMENT TEAMS"
  section heading; every team row gains "View staff" → read-only member popup ending "Go to STAFF to
  modify team member list."; guidance copy rewritten around the Office/fulfillment distinction.

### Evidence
Live queries confirm fallback resolution, routing, staff homes. Frontend built (exit 0, nginx 200);
screenshots exchange/org_teams_tab.png + org_view_staff.png (sent to Kevin in-session). Full suite
**2295/2295, LIVE UNTOUCHED, exit 0** (suite runs AFTER the live org change — census compares within
the run, so the intentional pre-run change is invisible to it, as designed).

### Flake found and fixed (test-only)
First full run came back 2294/1: bw6_mrr A3 counted ANY flow task on an MRR child as an
activity-completion side effect, but taskRouting.reconcileStageTasks ticks every 120s on the test API
and legitimately spawns the STAGE task for a child parked in a work stage (§14.2: children live in
the normal engine, activities on top). Green in isolation, then green in the full re-run after A3
now excludes created_by='system-reconciler'. Pre-existing race — my two new harnesses shifted bw6's
start into a tick; unrelated to the org change.

### Open threads
- Publish-tier and rules-approve-tier role questions from (o) still parked with Kevin.
- Standing board unchanged (product split parked until after go-live; §6b anchor-zones mockup
  session pending).

## 2026-08-18 (a) — request-side role-gate sweep: taxonomy writes + request-file mutations

### What was built (the two requireAuth-only WRITE surfaces (o) left open)
- `middleware/auth.js` gains two more SHARED gates beside `requireRedactionWork`:
  - **`requireTaxonomyEdit`** = `requireRole('SYSTEM_ADMIN','DIRECTOR')` — the "Workflow & Taxonomy"
    permission group of DESIGN_user_type_role_model §4–5 (team managers/supervisors hold no global
    config), same bar as redactionConfig / repository EDIT. Applied to EVERY taxonomy write:
    categories CRUD, record types CRUD, department/routing/source/repository links, applying a
    variant proposal, AI `discover` + `discover-scan` (both insert drafts). Reads and the
    compute-only variant scan (`discover-variants` proposes, inserts nothing) stay requireAuth.
  - **`requireRequestWork`** = `requireRoleOrPerm(['DIRECTOR','SUPERVISOR','DEPT_MANAGER','COORDINATOR'],
    ['REQUEST_MANAGER','SEARCH_AND_TRIAGE','REDACTION_WORKER','DELIVERY_AND_CLOSURE'])` — the function
    roles are requests.js's own `canRoute` set. Applied to every `/api/files` MUTATION: upload (gate
    runs BEFORE multer, so a refused upload never touches disk), attach a found record, delete (which
    unlinks the blob), mark responsive/not, render/extract. Reads (list/download/pages/page-image) and
    the compute-only staff record search stay requireAuth. Mass Redaction's template-sample upload
    rides `/files/upload/req-template-samples` — REDACTION_WORKER is in the gate, so unchanged.
- Live users: every account holds REQUEST_MANAGER + SEARCH_AND_TRIAGE + REDACTION_WORKER, so nobody
  loses file work; taxonomy editing narrows to Kevin/Kerri/Steve (SYSTEM_ADMIN) — no DIRECTOR is
  held on live today. Michael (SUPERVISOR/DEPT_MANAGER) is correctly refused on taxonomy writes.
- Frontend honesty (not a redesign): `RecordsPanel` swallowed every file-mutation error and even
  applied the optimistic state on failure — now an error line shows the server refusal;
  `SchemaDiscoveryPage` approve/reject likewise. Task-screen attach already surfaced refusals.
- `verify_search_resolve` now acts as a real SEARCH_AND_TRIAGE holder (was `users LIMIT 1`, which
  could be a role-less fixture user from another harness).

### Evidence
`verify_request_gates` **44/44** (no-role/searcher/supervisor 403 across every taxonomy write;
DIRECTOR + SYSTEM_ADMIN pass; variant scan open; searcher/supervisor/director pass every files
mutation, no-role 403; record search open; reads 200; 401-before-403; nothing written by the
pass-through probes). Break-test: gate removed from one taxonomy + one files route → 42/44 with
exactly those two assertions failing; restored. **Full suite 2339/2339, LIVE UNTOUCHED, exit 0.**
Deployed: frontend built (exit 0, nginx 200), API restarted (200); live probe on nonexistent ids —
Michael taxonomy PATCH 403 / files DELETE 404 (through), Kevin 404/404, Michael taxonomy GET 200.
Specs same commit: SPEC_taxonomy_classification §1, SPEC_record_search_task_screen §4a,
SPEC_auth_security_platform §1 (now lists the shared gates + the remaining requireAuth-only writes).

### Open threads
- Taxonomy tab / "Find Same-Format Records" stay VISIBLE to supervisors & team managers (nav is
  `isElev`); their write attempts get the refusal text. Hiding write controls per role is a UI
  follow-on (UI rule — not touched here).
- ATTORNEY_REVIEWER is not in `requireRequestWork` by function role (mirrors the redaction gate);
  Senior Legal holds the work perms on live so nothing changes in practice — Kevin's call if legal
  should pass by title.
- Remaining requireAuth-only WRITES: `requests.js` per-request acts (`/:id/stage`, `/:id/assign`,
  clarification, effort, intents — the domain scopes LISTS to team/assignee for non-elevated staff
  but never scopes or role-gates these mutations), `onboarding.js` phase writes. Worth its own pass.
- Publish-tier and rules-approve-tier questions from (o) still parked with Kevin. Standing board
  unchanged (product split parked until after go-live; §6b anchor-zones mockup session pending).

## 2026-08-18 (b) — per-request ACT gate: requests.js (the last requireAuth-only surface in that file)

### What was built
- **`services/requestAccess.js`** — the ONE answer to "may this staffer act on this request", the same
  shape tasks.js already used for per-task acts ("the assignee, or someone who may route"): ACTING role
  (SYSTEM_ADMIN/DIRECTOR/SUPERVISOR/DEPT_MANAGER/COORDINATOR — the domain's canRoute/mayRoute set; +
  ATTORNEY_REVIEWER on the legal acts) OR an act-specific PERMISSION role OR **the work is theirs** — the
  request (any row of its parent/child cluster) is assigned to them, or they hold an OPEN task on the
  cluster (narrowable per act by task type). The cluster walk is what makes a parent-addressed act and a
  child-addressed act answer identically (tasks hang off children; the workspace holds the parent id).
- **`middleware/requestAct.requireRequestAct(opts)`** maps that to HTTP: 403 `NOT_YOUR_REQUEST` in plain
  words; a request that does not exist passes THROUGH to the handler's own 404 / ambiguity refusal; a
  failed lookup fails CLOSED (500).
- Applied in `routes/requests.js` (`ACT` table at the top, one bar per act, declared beside the routes):
  stage · assign · assert-exemption · ag-ruling (legal task holders only) · clarification send/resolve ·
  effort · search-intent resolve · eligibility confirm · confirm-identity · staff create
  (`requireRequestWork`). Unchanged: reopen / route / fee-waiver-decision / legal-escalate /
  commercial-classification — they already carried their own authority.
- Why "the work is theirs" is essential (not a nicety): the intake-review, estimate and record-search
  task screens send clarifications / log effort from the TASK, and the design's ORO Associate holds task
  grants and no permission role. A pure role gate would have 403'd the very screens the tasks exist for.
  fee-waiver-decision's inline-decider carve-out was the precedent.
- Live users: everyone holds the work perms, so nobody loses an act. What actually narrows on live:
  assert-exemption / ag-ruling now need DENIAL_AND_LEGAL, ATTORNEY_REVIEWER, an acting role, or holding
  the (legal) task — a custodian staffer without the record's task can no longer submit for AG
  pre-clearance from the workspace.
- Frontend honesty (not a redesign): RequestWorkspacePage set `err` on failures but only RENDERED it when
  the request failed to load — every refusal on advance/close/assign/exemption/identity was invisible. Now
  a dismissible alert at the top of the loaded page shows the server's words. Task screens already flash.

### Evidence
`verify_request_acts` **57/57** (service decisions incl. cluster walk both directions, task-type
narrowing, completed task no longer counts; HTTP: no-role/wrong-perm 403 on real requests, nonexistent →
404 through, act-perm / task holder / assignee / supervisor pass; legal acts: ATTORNEY_REVIEWER passes,
record_search holder 403 on AG ruling; pre-existing authority unchanged; pass-through probes moved no
stage — allowed actors were exercised with bodies the handler rejects AFTER the gate, incl. a two-child
parent → 409 AMBIGUOUS). All 15 harnesses that touch these acts green unchanged. **Full suite 2397/2397,
LIVE UNTOUCHED, exit 0.** Deployed: frontend built (nginx 200), API restarted (200); live probe:
Marcus Bell (custodian, work perms, no legal) → ag-ruling on another team's request **403
NOT_YOUR_REQUEST**, stage 400 (through), nonexistent 404; unauth 401.
Specs same commit: SPEC_request_lifecycle_workflow §5a (new), SPEC_auth_security_platform §1.

### ⚠️ Incident during the live probe — caused by me, reversed, recorded here so it is not repeated
One probe was NOT read-only: `POST /requests/<live id>/ag-ruling {}` as Michael (SUPERVISOR) to show
"not 403". I assumed an empty body would be rejected; the handler DEFAULTS `outcome` to `sustained` and
returned 200 — it recorded a real AG ruling on live request **2026-000004** (child b508c51f…): stage
record_search → redaction_review, an AG_RULING_RECORDED history row, the in-progress record_search task
t-d59d2b75 cancelled, a redaction task t-b789a354 spawned, tickler 'stalled' flag cleared, the primary
clock touched. Found immediately (the 200 was the tell). Reversed in one transaction against evidence
(task_events trail, history stage_from/stage_to, the tickler's REQUEST_STALLED row): stage back to
record_search, updated_at back to the last real write (2026-07-19 06:59:09), tickler flag 'stalled' /
2026-08-09 08:05:49 restored, task t-d59d2b75 back to in_progress (updated_at = its in_progress_at),
t-b789a354 deleted, the AG_RULING_RECORDED row and the two trigger-written task_events (100, 101) deleted,
plus the trigger artifact my own repair minted (102). Whole-DB timestamp scan afterwards: the ONLY
residue is `request_clocks.clk-ff83aaa1.updated_at` (a touch stamp with no functional role; its prior
value is not evidenced, so it was left rather than guessed). No email or notification was produced
(ag-ruling sends none; no notification rows). Kevin should glance at 2026-000004 in the queue.
**Rule going forward (also in my memory): a live probe may only ever target a NONEXISTENT id, or a body
that has been READ IN THE HANDLER to fail before the first write. "It will probably 409" is not evidence.**
Latent defect surfaced: `ag-ruling` accepts an empty body as "withholding sustained" — it should require
`outcome ∈ {sustained, partial, overruled}` (400 otherwise). Not built here (slice discipline); listed below.

### Open threads
- **`clocks.js` (toll/resume/extend/satisfy/start) and `dispositions.js` (close/hold/withdrawal/
  installment) are the SAME class and still requireAuth-only** — closing a request is a per-request act.
  The factory applies directly (~an hour incl. harness). Top of the list.
- `POST /:id/ag-ruling` should REQUIRE `outcome` (see incident) — one validation line + a harness assert.
- `onboarding.js` phase writes still requireAuth-only.
- Should ATTORNEY_REVIEWER be an acting role for ALL request acts (not just legal)? Left out to mirror the
  redaction gate; Senior Legal holds the work perms on live anyway.
- Standing board unchanged (publish-tier / rules-approve-tier parked with Kevin; product split parked;
  §6b anchor-zones mockup pending; taxonomy write controls still visible to supervisors).

## 2026-08-19 (a) — per-request ACT gate extended to clocks.js + dispositions.js

### What was built
- `middleware/requestAct.requireRequestAct` gains `opts.resolve(req)` so a route addressed by something
  other than a request id (a clock id) resolves to its request first; an unknown clock passes through
  to tolling's own "Clock not found".
- **clocks.js**: start / start-one → `REQUEST_MANAGER`; toll / resume / extend / satisfy →
  `REQUEST_MANAGER`, `DENIAL_AND_LEGAL`, `ATTORNEY_REVIEWER` (satisfy also `DELIVERY_AND_CLOSURE`) — plus
  the standard acting roles and "the work is yours" (request / open task on its cluster). Reads open.
- **dispositions.js**: withdrawal-communication + installment-request → `REQUEST_MANAGER`,
  `CLARIFICATION_SENDER`, `DELIVERY_AND_CLOSURE`; RM release hold place / lift → `REQUEST_MANAGER`,
  `DELIVERY_AND_CLOSURE`. UNCHANGED on purpose: the two manual endings (BW5's decided
  `manualEndingRights` — ORO Associate+ / current task-holder), the Director-only knobs, all reads.
- `verify_extend` now acts as a REQUEST_MANAGER holder (was an arbitrary `LIMIT 1` user).
- No frontend change: only RequestWorkspacePage calls the clock writes and (b) made its refusals visible.

### Evidence
`verify_clock_disposition_gates` **36/36** — no-role/wrong-perm 403 on the fixture's real clock and
request; REQUEST_MANAGER / ATTORNEY_REVIEWER / SUPERVISOR / child-task holder pass (cluster walk to the
parent's clock); unknown clock/request pass through; manual endings still answer BW5's NOT_PERMITTED,
knobs still DIRECTOR_REQUIRED; reads open; 401 first; and a "nothing moved" section (clock still
running, no extension, no hold, no history beyond creation) — every positive probe used a body the
service rejects BEFORE its first write (extend days:0, empty withdrawal body, hold without note, lift on
an unheld request), per the (b) incident rule. **Full suite 2433/2433, LIVE UNTOUCHED, exit 0.** Deployed: API restarted (200); live probes on NONEXISTENT ids only — unauth 401; Marcus toll → 500 "Clock not found" (through); hold → 422 NOTE_REQUIRED (through, service check before lookup).
Specs same commit: SPEC_request_lifecycle_workflow §5a (extended), SPEC_auth_security_platform §1.

### Open threads
- `onboarding.js` phase writes — the last requireAuth-only write surface I know of.
- `POST /requests/:id/ag-ruling` should REQUIRE `outcome` (from the (b) incident).
- BW5's `manualEndingRights` task-holder check is on the addressed row only (no cluster walk) — if a
  parent id is ever passed there, a child's task-holder would be refused. Not touched (decided model).
- Standing board unchanged.

## 2026-08-19 (b) — onboarding setup gate + ag-ruling outcome required

### What was built
- **onboarding.js**: assign reviewer / request-review / status patch → `requireRole('SYSTEM_ADMIN','DIRECTOR')`
  (setup is system configuration; the redactionConfig / repository / taxonomy EDIT precedent). Two carve-outs
  keep the review flow honest: `/approve` keeps its own decided authority (designated reviewer OR admin),
  and `/fees/test-result` also admits the Fees phase's DESIGNATED reviewer (`editOrReviewer('fees')`) —
  they run the sandbox test before they can approve. Reads open. SetupPage now shows the server's words on
  a refused reviewer assignment (was a generic alert); FeeSandboxPanel already did.
- **requests.js `POST /:id/ag-ruling` REQUIRES `outcome ∈ {sustained, partial, overruled}`** → 400
  `OUTCOME_REQUIRED` (lists the three). It defaulted to `sustained`, which is how an empty probe recorded a
  real ruling on 2026-08-18. The gate still answers first (403 before the outcome check); the parent/child
  ambiguity check still precedes it (409). Every real caller already sent `outcome`.
- Correction to something I nearly wrote into the auth spec: "no requireAuth-only write surface remains"
  was FALSE — the grep shows 82 middleware-level `requireAuth`-only mutations. SPEC_auth_security_platform
  §1 now carries an honest three-way inventory: (a) own in-handler authority, (b) compute-only / own-record,
  (c) **NOT YET AUDITED**: feeEstimates.js (11 money acts), objections create/assign/resolve, settlement
  charge, departments.js, feeProfiles.js, agentRules.js, tickler clear, legalEstimate ask, several mrr.js
  acts. That (c) list is the next hardening pass.

### Evidence
`verify_onboarding_gates` **25/25** (no-role / SUPERVISOR 403 on setup writes; DIRECTOR + SYSTEM_ADMIN
pass on probes that write nothing — unknown phase 404, invalid status 400, no reviewer 400; fee-test:
stranger 403, designated reviewer passes but still cannot assign reviewers, approve's own check intact;
ag-ruling: empty → 400 OUTCOME_REQUIRED, bogus → 400 with the three outcomes, record did not move, gate
before validation; onboarding rows restored to pre-run values). Affected harnesses green
(verify_request_acts 58, verify_legal_review 44, verify_e2e_tx 36). **Full suite 2458/2458, LIVE UNTOUCHED, exit 0.** Deployed: frontend built (nginx 200), API restarted (200); live probes on NONEXISTENT ids only — Michael (SUPERVISOR) reviewer-assign 403; Kevin 404 through; ag-ruling on a nonexistent request 404; unauth 401.
Specs same commit: SPEC_jurisdiction_configuration §5, SPEC_request_lifecycle_workflow §5a,
SPEC_auth_security_platform §1 (inventory).

### Open threads
- The (c) inventory above — feeEstimates.js first (money acts on a request; FINANCE / FEE_MANAGER via the
  act gate), then departments/feeProfiles/agentRules (config → SYSTEM_ADMIN/DIRECTOR), objections,
  settlement, tickler clear, legalEstimate ask, mrr.js residue.
- Standing board unchanged.

## 2026-08-19 (c) — DISCUSSION + STEP 1 of the fee-library plan: the Fee & Estimate MASTER LIST published (docs only)

### The discussion (Kevin's intent, confirmed in-session)
- Today "fees" lives in FOUR places (screenshots sent): Jurisdiction Configuration → Fee & cost schedule
  (statute-derived FACTS, no numbers), Administration → Fee Configuration (the engine's rate table —
  `fee_profiles`, one hand-seeded TX profile, "Save config" edits in place with no audit trail), Setup step 6
  (checklist + sandbox), and per-record-type estimate calibration on the Taxonomy record-type editor. The state
  template import writes the facts and NEVER touches `fee_profiles` — the rules library does nothing for the
  fee engine today.
- Target model (matches Kevin's 2026-07-21 ruling in DESIGN_master_list_and_city_config.md, plus "pre-fill
  what the statute fixes"): ONE "Fees & Estimates" home; tier 1 = state law auto-generated as a PROPOSAL from
  the pre-built state profile ("Save and initiate auto configuration" — fires ONCE, then locks the state;
  address/identity edits never re-trigger; a separate explicit "Regenerate from state rules" produces
  proposals only); tier 2 = the city uploads a local policy (or a supplement such as an AG rule table) → AI
  extraction → proposal, local wins where the statute leaves room, exceeding a FIXED cap is a compliance flag;
  NO free typing on the computation page — every change is a document upload or a cited proposal (Kevin
  prefers document-only; the cited-proposal path is offered as the traceable correction route). On-screen
  disclaimer for state-derived content (may be outdated/incomplete; review; supplement) — system-wide wording.
- Kevin's follow-on: audit every Jurisdiction Configuration section for "does it drive behavior or just
  display" (preliminary: deadlines/clock matrix drive; clarification/payment/waiver drive but import as
  safe-manual defaults; exemption/redaction = evidence + pointer; fees = evidence only).
- Census of the library (read-only): master_concept_dictionary has 23 canonical fee/payment concepts;
  copy-rate figures present for ~19 states, labor figures ~6, deposit thresholds ~8, estimate-notice 4;
  ~12 states legitimately defer ("actual cost"/"reasonable"); delegation-to-regulation (TX 1 TAC §70.3
  pattern) in ~10 states; NJ has ZERO rules in the pruned corpus. 32 states by Kevin's own cutoff (fine).

### Step 1 built (docs only, no code, no DB)
- `docs/rules_research/FEE_MASTER_LIST.md` + `alignment/fee_master_list.json` + `alignment/fee_master_matrix.csv`,
  generated by `docs/rules_research/scripts/gen_fee_master_list.py`: **36 items** (every fee/estimate/payment
  engine field incl. the payment-clock and fee-waiver policy modules, plus two "not in engine yet" items:
  per-requestor periodic free hours, repeat/aggregation) ← canonical concepts, with a per-state status
  AUTO-DERIVED from rule text (V value present · V* value + delegation · D delegated to regulation · C defers
  to city · A actual-cost/reasonable · R rule without value · silent), each cell carrying rule ids, citations,
  Requirement/Permission, source type, official links, extracted numbers and a snippet. Confidence 'auto'
  everywhere — it is the checklist for step 2, not verified values.
- Recorded in the list: DUPLICATED HOMES (estimate threshold, deposit threshold, deposit cap live in both
  `fee_profiles.requestRules` and `jurisdiction_rules fee_waiver.*`) — one home to be chosen later.
- Mirrored to `~/exchange/FEE_MASTER_LIST_2026-08-19.md` + `.csv`; census at
  `~/exchange/FEE_LIBRARY_CENSUS_2026-08-19.txt`.

### Next (Kevin's sequence)
2. Gap pass: one research+verify run per state over exactly these 36 items (follow every D into its
   regulation; confirm every V belongs to its field; NJ from scratch). 3. Template `fee_schedule` gains
   value/unit/basis/engine_field. 4. Generator (template → proposed fee profile), local-policy validation
   against constraints, one-time auto-configure + lock, the single Fees & Estimates home (mockups first).
   Acceptance: every item per state valued-from-library or explicitly city-deferred; no state-specific code.
- The fees role-gate hardening (feeEstimates.js etc., (b) inventory) is PAUSED behind this redesign at Kevin's
  request. Standing board unchanged.

## 2026-08-19 (d) — STEP 2 fee gap pass LAUNCHED (in flight at session end) — RESUME INSTRUCTIONS

### What ran
- Kevin approved the step-2 prompt with: municipalities only (note agency regimes); recency 2024–2026;
  one discover + one verify agent per state; estimate calibration OUT. Launched over the 32 states.
- Lesson learned mid-run: this 4-CPU box caps a workflow at min(16, cpus-2) = **2 concurrent agents** —
  32 states × 2 agents × ~30 min ≈ 16 h. Cap is PER WORKFLOW, so the run was stopped and relaunched as
  **4 parallel workflows over disjoint 8-state slices** (script: `docs/rules_research/fee_gap/scripts/
  fee-gap-pass-slice.js`; discover AND verify steps SHORT-CIRCUIT when their output file already exists
  and is complete, so re-running a slice never redoes finished work).
- Slices: [AL AZ CA CO CT FL GA ID] · [IL IN KS LA MA MI MN MO] · [NC NE NJ NV NY OH OK OR] · [PA SC TN TX UT VA WA WI].
- Outputs are FILES (so nothing completed is lost when the session ends): discover →
  `docs/rules_research/fee_gap/raw/<ST>.json` (36 resolutions + new 9NNN rule rows + delegations log +
  coverage + negatives); verify → `docs/rules_research/fee_gap/verified/<ST>.json` (verdict per row,
  corrected rows). Inputs: `fee_gap/input/<ST>.json` (committed).
- At session end: raw done for AL, AZ, CA, CO (each 36/36; 9–14 new rule rows; 3–4 delegations followed);
  no verified files yet. Early shape matches step 1: these four are actual-cost / defers-to-city states.

### TO RESUME (next session) — no design decisions needed
1. `ls docs/rules_research/fee_gap/raw docs/rules_research/fee_gap/verified` — see what finished.
2. Re-launch the same 4 slices with `Workflow({scriptPath: 'docs/rules_research/fee_gap/scripts/fee-gap-pass-slice.js',
   args: {states: [...8...]}})` (four calls, disjoint slices as above). Finished states short-circuit;
   unfinished ones run. Kevin has explicitly authorized this run ("run it").
3. When all 32 raw + verified exist: aggregate → `fee_gap/RESULTS.md` (per state: 36/36, C/c/R/U counts,
   delegations followed/unresolved, not-confirmed items) and merge CONFIRMED (and CORRECTED) resolutions
   into `alignment/fee_master_list.json` as a `verified` layer per cell (keep the auto layer). Commit.
   Report to Kevin; then step 3 (template `fee_schedule` gains value/unit/basis/engine_field/applies_to).
4. Watch for: a state with <36 resolutions (re-run that state), verify UNVERIFIABLE-heavy states (source
   access), NJ (no prior rules — researched from scratch here; its NON-fee domains still need the full V2
   chunked discovery — separate task).
- Fees role-gate hardening remains PAUSED behind the redesign. Standing board unchanged.

## 2026-08-19 (e) — Fee gap pass PAUSED at Kevin's direction; 32-state FEE-REGIME REVIEW compiled from existing material (no new research agents)

### What happened
- Resumed from (d): background workflows had kept writing before the old session died — raw now 22/32
  (all 36/36 rows), verified 4/32 (AL AZ CA CO, all clean). Committed (eb070a2). Kevin then REJECTED the
  slice relaunches: no more research agents until he reviews what prior efforts already hold.
- Compiled `fee_gap/STATE_FEE_REGIME_REVIEW.md` (mirrored to ~/exchange/STATE_FEE_REGIME_REVIEW_2026-08-19.md,
  commit 97588cb): all 32 states classified — roll-up tag + item-level statutory exceptions (Kevin's
  mixed-regime rule: a defers state's explicit waiver/deposit/labor rules stay binding), deferral-rule-in-
  library check (all anchored; 19 items across 10 states anchor to new rows awaiting merge), delegated-
  instrument descriptions (municipal-binding: TX→1 TAC 70, TN→OORC schedule, PA→OOR schedule, CO labor cap→
  Leg. Council CPI posting; agency-only list separate), third-party delta check (Kevin's ChatGPT/DeepSeek
  uploads = chatgpt_pilot + desktop_research: leads only — ZERO surviving deltas for the 22 gap-passed
  states), and per-state pending notes. LOUISIANA: R.S. 44:32(C) is LIVE (posted-schedule duty 2023, advance
  payment 2024, labor never, indigent waiver) — the Google "$0.25 state fee" is LAC 4:I.301, agency-only;
  SB 493 (2026, would have set rates) withdrawn. MN is the thinnest state + confirmed recency gap (2025
  subd. 3(g) not in library). NC certification = the one unresolved delegation among the 22.
- Also logged at Kevin's request (same commit): BACKLOG "report a possibly-incorrect state rule" button
  (→ admin@optimumq.com); BUSINESS_LEGAL_IP_LOG [FOR COUNSEL] state-rules-profile provenance/warranty
  disclaimer (manually aggregated, no third-party content, human-web-search reliability).

### State of the run
- raw/: 22 states done (missing MA MI MN MO NY OK OR VA WA WI). verified/: 4 done (18 raw await verify).
- NOTHING is running. Do NOT relaunch the slice workflows without Kevin's explicit go — he has now twice
  rejected launches pending his review of the regime document.

### Next (after Kevin reviews the regime doc)
- His call among: (a) verify-only pass for the 18 discovered states, (b) full gap pass for the 10 pending
  (MN first), (c) merge step (verified layer into fee_master_list.json + the new deferral-anchor rules),
  then step 3 (template fee_schedule value/unit/basis/engine_field). Fees role-gate hardening still PAUSED.
- Standing board unchanged.

## 2026-08-20 (f) — VERIFY-ONLY PASS COMPLETE except SC (session limit); 21/22 discovered states verified

### What ran
- Kevin approved the verify-only pass for the 18 discovered-but-unverified states. New script
  `fee_gap/scripts/fee-gap-verify-slice.js` (04f7fbf): 1 refuter agent per state over the existing
  raw/<ST>.json, short-circuits if verified/<ST>.json exists. Ran as 4 parallel disjoint workflows.
- RESULTS (all committed: fce6e62, af20228, 3d3203c): 17 of 18 verified. 36/36 CONFIRMED: CT? no —
  breakdown: FL IL KS LA NE NJ NV OH PA TN UT all 36/36 confirmed; TX 34+2 corrected (rules.minFee,
  waiver.forfeiture); ID 34+2 corrected (rules.deposit.percent, payment.productionGate); IN 35+1
  (certification), NC 35+1 (av), CT 35+1 (rules.deposit.percent); GA 35 confirmed + 1 UNVERIFIABLE
  (payment.method — source unopenable, manual check). Corrections live in each verified file's
  corrected_row. ZERO REFUTED rows across all 21 verified states.
- **SC is the ONLY gap**: its verify agent died on the session limit (resets 2:10am UTC 2026-08-20).
  To finish: `Workflow({scriptPath: 'docs/rules_research/fee_gap/scripts/fee-gap-verify-slice.js',
  args: {states: ["SC"]}})` — one agent, ~20 min. Kevin approved this pass, so the relaunch is
  pre-authorized once the limit resets.

### State of the corpus
- raw/: 22/32 (missing MA MI MN MO NY OK OR VA WA WI — full gap pass not yet approved for these).
- verified/: 21/22 of discovered (missing SC only).

### Next (Kevin's queue, from the regime-review session)
1. SC verify relaunch (pre-approved, above). 2. Kevin decides: full gap pass for the 10 pending states
   (MN first — thinnest + confirmed 2025 recency gap). 3. Merge step: fold CONFIRMED/CORRECTED
   resolutions + new rule rows into alignment/fee_master_list.json as the verified layer, then RESULTS.md
   aggregate. 4. Step 3 of the fee plan (template fee_schedule gains value/unit/basis/engine_field).
- Fees role-gate hardening still PAUSED. Standing board unchanged.

## Session (g) — 2026-08-20
- SC verify completed (relaunched after limit reset): 32 CONFIRMED, 4 CORRECTED (citation-level: two rows cited § 30-4-30(B) for (C) text; av quote not on its official_link; commercial paraphrase mis-flagged verbatim), 0 REFUTED, 0 UNVERIFIABLE. All four resolutions stand as silent.
- Verify pass is now COMPLETE: 22/22 discovered states, 792 rows, 773 confirmed / 18 corrected / 1 unverifiable (GA payment.method, needs manual browser check of O.C.G.A. § 50-1-6) / 0 refuted.
- Rollup: docs/rules_research/fee_gap/VERIFY_ROLLUP.md
- Parked with Kevin: (a) merge verified layer into alignment/fee_master_list.json; (b) gap pass for the 10 remaining states (MA MI MN MO NY OK OR VA WA WI — MN first). No agent spawns without explicit go.

## Session (g) addendum — 2026-08-20
- Kevin decision: payment.method is OUT OF SCOPE (finance-dept policy, not a records rule) — exclude at merge and in any future gap pass. GA UNVERIFIABLE row resolved by this decision; no § 50-1-6 fetch needed.
- Kevin-supplied Justia 2025 copy of GA § 50-18-71 (exchange PDF) confirms GA fee subsections current through SB 12 (eff. 5/14/2025, non-fee amendment) — noted in verified/GA.json.

## Session (g) close — 2026-08-20 ~4am
- Verify pass COMPLETE and committed: 22/22 states, 792 rows, 0 refuted. Rollup: fee_gap/VERIFY_ROLLUP.md.
- payment.method OUT OF SCOPE (Kevin decision, in memory + rollup) — exclude at merge and in remaining-states research.
- Kevin is hand-gathering official fee statutes for the 10 pending states into exchange/, banked in fee_gap/source_docs/ with provenance: WI ✓ (certified ch.19 through 2025 Act 247), WA ✓ fee-complete (RCW 42.56.120 + certified .070). Remaining: MA (c.66 §10 + 950 CMR 32.07), MI (MCL 15.234), MN (§13.03 subd.3, 2025 amendment!), MO (§610.026), NY (POL §§87/89), OK (51 O.S. §24A.5), OR (ORS 192.324), VA (§2.2-3704 F–J codified only — SB 56 NOT enacted), optional WA 42.56.520.
- NEXT on Kevin return: (1) continue banking his uploads; (2) his call: merge verified layer into alignment/fee_master_list.json (ready, nothing blocking); (3) his call: discover pass for pending states, grounded in source_docs/ first. No agent spawns without explicit go.

## Session (g) continued — 2026-08-20 evening
- Kevin hand-sourced OFFICIAL fee statutes/regs for ALL 10 pending states; banked in fee_gap/source_docs/ (20 files, each with provenance header): WI WA VA OR MN MA MI MO NY OK. Highlights: MN subd.3(g) + MO HB 145 recency gaps closed at source; MA both layers (c.66 §10 + 950 CMR 32.00); OK text includes BOTH 2025 SB 535 and a previously unknown 2026 SB 2184 c.217 §72 amendment (discover must identify what SB 2184 changed); OR flagged 2026 c.93 check; NY agency-only docs banked with CAUTION labels.
- NEXT (Kevin decisions): (1) discover+verify gap pass for the 10 states, grounded in source_docs/ first, web only for gaps — needs explicit go; (2) merge step for the 22 verified states — ready, nothing blocking. payment.method excluded everywhere per standing decision.

## 2026-08-21 — Step 2 fee gap pass COMPLETE (all 32 states) + full merge
- Relaunched the four 10-state workflows after the session-limit reset; file short-circuits skipped the
  8 already-complete discovers + VA verify. All 20 agents finished: 10/10 discovers, 10/10 verifies.
- 10-state verify results: 356 CONFIRMED + 4 CORRECTED, 0 REFUTED (WA media/delivery basis fixed→ceiling;
  MI labor.increment value→floor; NY dup.specialty.rate stale DOS rendering). OK SB 2184 §72 checked:
  no fee change. VA SB 56 correctly not imported.
- MI TLS incident: both MI agents fetched legislature.mi.gov with the site's broken chain bypassed
  (leaf-only, missing DigiCert G2 intermediate). Cleared by re-fetching MCL 15.235 + 408.934 with the
  repaired chain (--cacert w/ intermediate from cacerts.digicert.com); all figures matched; clean texts
  banked as source_docs/MI_mcl_15_235_tlsverified* / MI_mcl_408_934_tlsverified*.
- MERGE DONE (fe0a20d 22-state, 754acfd full 32): fee_master_list.json now carries states[ST].verified on
  every cell — 1120/1120 (35 items × 32 states). payment.method → excluded_items (owner decision
  2026-08-20); 346 new 9NNN rules banked in alignment/fee_gap_new_rules.json (13 payment-only excluded).
  Merge script rebuilds idempotently: fee_gap/scripts/merge-verified-into-master.js.
- Rollup extended to 32 states: fee_gap/VERIFY_ROLLUP.md (grand tally 1129 C / 22 c / 0 R on 1152 rows).
- NEXT: step 3 — template fee_schedule gains value/unit/basis/engine_field/applies_to from the verified
  layer. Also parked: classifier hint on child assign-picker (Draft 5 §3 residuals, with Kevin).

## 2026-08-21 (later) — Step 3 DONE: verified fee layer joined into the config templates
- build_state_templates.js now joins alignment/fee_master_list.json: each template's fee_schedule is
  { items, statutory_evidence } — items = 35 verified rows/state (value/unit/basis/engine_field/applies_to
  + resolution word + authority + verdict), fail-loud on missing cells. All 32 rebuilt, audit clean.
- gen_template_deliverables.js renders the fee table (resolution badges) in each state HTML and adds a
  filterable "Fee schedule" xlsx sheet (1,120 rows). Regenerated to /home/optimumq/exchange/config_templates.
- Shape documented in workflow/README.md (step-3 entry). NEXT: Phase 7 build can now read
  fee_schedule.items directly for engine config defaults.

## 2026-08-21 (checkpoint, usage limit) — composer build WIP at 96a7c31
- DONE+verified: bounds data gen (backend/scripts/gen_state_fee_bounds.js → src/data/state_fee_bounds.json),
  feeBounds.check (live TX profile passes; OK 0.35>0.25 refused; tiers; fixed=authorization-ceiling),
  422 gate on POST/PUT /fee-profiles, GET /fee-profiles/bounds (returns jid+code+bounds).
- WIP not verified: FeeComposerPopup in JurisdictionConfigPage.js (fees section propose → structured rows,
  files DRAFT FR profile with _proposal metadata; JSON fallback remains for exemption/redaction/template
  sections BY SCOPE — their editing semantics differ, revisit after Kevin's setup-shell sketches).
- NEXT: restart API (kill ^node pattern) + curl bounds endpoint; test 422 via API with nonexistent-id-safe
  probe (live-probes memory!) — better: run suite (cd backend && npm test, NOT concurrent with CRA build);
  then CI=false NODE_OPTIONS=--openssl-legacy-provider npm run build; verify nginx 200 + screenshot fees
  composer; spec update (SPEC_fees_estimates_payments.md §1 bounds gate + SPEC_jurisdiction_configuration.md)
  in the finishing commit. Then the jurisdiction-config inventory doc Kevin asked for (15 line items:
  what/where-edited/protected/testing) — docs/WORKING_jurisdiction_config_inventory.md.

## 2026-08-21 (evening) — Composer slice FINISHED (8d89e25): suite green, composer verified in-app
- verify_fee_bounds in the suite (23 assertions): pure feeBounds.check cases + the API gate — POST/PUT
  violations 422 AND provably no row written / stored config untouched; GET /bounds both forms; lawful
  saves and name-only PUT ungated.
- CAUGHT + FIXED a step-3 regression: templates' fee_schedule reshape to {items, statutory_evidence}
  broke stateTemplateImport (importState threw; 7 harnesses red incl. both e2e — suite had not been run
  since 212394f). feeEvidenceOf() consumes either shape. Full suite: 2481/2481 GREEN, live untouched.
  (Transient extra reds during debugging were my own --keep test API holding :3101 with stale code —
  kill any kept stack before re-running the suite.)
- Frontend built + deployed (nginx 200). Composer verified visually (screenshots sent to Kevin):
  bounds + citations beside inputs, amber law-silent rows, inline over-ceiling refusal (overhead 25 vs
  fixed 20 → "0 changes ready · 1 blocked by a state limit", submit disabled), citation required when a
  law-bounded answer changes. No live writes — refusal check is client-side; filing was NOT exercised
  against the live API (covered by the harness against the test stack instead).
- Specs updated in the same commit: Domain 6 §1 bounds gate; Domain 10 §5b composer; processing-UI §6 pointer.
- Live API restarted after the import fix (still supervised by root PM2; kill-^node pattern works).
- NEXT: (1) the jurisdiction-config inventory doc Kevin asked for (15 line items: what/where-edited/
  protected/testing) — docs/WORKING_jurisdiction_config_inventory.md; (2) revisit exemption/redaction/
  template sections' composer scope after Kevin's setup-shell sketches; (3) fees role-gate hardening
  still PAUSED; classifier hint on child assign-picker still parked with Kevin.

## 2026-08-24 — setup-hub redesign: design phase, decisions locked, NO build

Design-only session (Kevin's standing constraint: no build until the revised design is worked
through). A stretch of it ran on a different model (14:55–16:03); the decisions below were
re-verified and confirmed by Kevin afterwards.

**Decisions (Kevin, 2026-08-24):**
1. **Lanes 2 and 3 owners:** anyone in the Open Records Office, plus fulfillment team supervisors.
2. **State rules import is not a hub item.** Saving the agency's state applies the state rule
   profile automatically (lock + import + populate jurisdiction config). Today the importer is
   CLI-only (`import_state_template.js`, no UI door; imports land `status='library'` unactivated)
   — the auto-load wiring is a build item, recorded on inventory item 1.2.
3. **NO STOPGAP on lane gating.** The team-membership derivation of "in the ORO" (proposed as a
   cheap v1 gate) is REJECTED. Sequencing: finish hub design → spec+build the v3 user-type model
   for real (catalog, authority axis, permission groups, migration, ratification) → build the hub
   on it. The gating gaps (ungated fee-profile writes, ungated departments/teams, ungated agent
   rules, unauthenticated settlement webhook) get closed ON the new model, once.

**Artifacts:** `docs/WORKING_setup_inventory.md` (36 hub items + the decisions; copy in exchange/)
· design canvas https://claude.ai/code/artifact/1c473eef-a5f6-47bd-a766-1003e9393060 (5 artboards:
hub, item anatomy/states/dependencies, sign-off options A/B/C) · `DESIGN_user_type_role_model.md`
+ `MASTER_task_types_permission_groups.md` re-surfaced as the role-model base (Word copies in
exchange/); status note added: prerequisite, build is smaller than the July framing (task-subset
axis already live; only 5 of 9 legacy function roles checked anywhere, 46 call sites).

**Open on the canvas for Kevin:** sign-off choice (A/B/C or mix), hard-lock vs open-with-warning
dependencies, plain-language item names, lane-2 split question, two lane-placement flags (go-live
flip is SysAdmin-only but sits in the Legal lane; lane-1 header overstates Legal's ownership).

**NEXT:** Kevin marks up the canvas → fold into inventory → spec the user-type slice.

## 2026-08-24 (closing) — plan-layout drafts added; Kevin picking between them next session

After the earlier note: Kevin asked for the hub content re-drawn as a project plan
(dependencies visible, no dates). Canvas page 2 now has three drafts — Plan A full
gantt (one row per task, phase grouping, arrows), Plan B swimlane map (owner lanes,
12 group cards, sparse arrows), Plan C numbered outline (waits-for chips, complete).
Review-pass fixes committed d0b4cd8; sources in docs/mockups/setup_hub/ (gantt is
generated — regen script pattern lives in the session scratchpad; re-creating it from
the .dc.html is trivial if needed).

**Kevin: "i like two of the mock ups"** — which two is NOT yet said. NEXT SESSION:
ask which two and what to change, fold the choice into WORKING_setup_inventory.md,
then proceed per the locked plan (design → user-type spec/build → hub build; no
stopgap — see the earlier 2026-08-24 note). Canvas:
https://claude.ai/code/artifact/1c473eef-a5f6-47bd-a766-1003e9393060 (page 2).

## 2026-08-24 (later) — Kevin picked Plan A; collapsed gantt row expanded

Kevin chose **Plan A (full gantt)** and asked what the "5 more settings with no prerequisites" row
was: inventory items 2.6 task time budgets, 2.7 time-tracking mode, 2.10 release switches,
2.12 decision reasons library, 2.13 mass-redaction schedule. Expanded into five rows on the
gantt (three marked "no screen yet"); artboard grew 120px; canvas republished to the same URL
(checked first — no GUI saves since last publish). Decision recorded in WORKING_setup_inventory.md.

**NEXT:** remaining canvas-page-1 questions (sign-off A/B/C, hard-lock vs warn, item names,
lane-2 split, two lane-placement flags) → then spec the user-type slice per the locked plan.

## 2026-08-24 (later, b) — Page-1 canvas questions all decided; hub artboard updated

Walked Kevin through the five open page-1 questions. Decisions (full detail in WORKING_setup_inventory.md
"Page-1 decisions"): sign-off = Mark it done (A) for now, may become validation-conditional per item;
dependencies = open with warning; Lane 2 split into Fees/Estimates/Routing + Redaction/Release (five lanes);
go-live stays at bottom of lane 1, ORO SysAdmin OR ORO Director may flip; lane names renamed in Kevin's
words (Compliance and Policies Setup · Request Fulfillment Process Setup · Organization Departments, Teams,
and Staff Setup · Technical Setup); item names accepted as drawn. Main.dc.html + canvas.json updated,
canvas republished (same URL).

**Design phase for the hub is now closed.** NEXT per the locked plan: spec the v3 user-type slice
(catalog, authority axis, permission groups, migration, ratification) — start from
DESIGN_user_type_role_model.md + MASTER_task_types_permission_groups.md; the hub's lane ownership
(ORO membership + fulfillment supervisors; SysAdmin-or-Director for go-live) is now a concrete requirement
for that model. Still no build until the user-type spec is agreed.

## 2026-08-24 (later, c) — User-type model spec DRAFTED (docs only, no build)

`docs/SPEC_user_type_model.md` written as the build contract for the v3 user-type model, from the
design doc + master list + a fresh code survey. Survey findings that drive it: every new user is
granted ALL 11 permission roles at creation (`staff.js:40-41`) so perm gates are no-ops; no route
edits roles after creation; roles ride an 8h JWT; 3 function roles + 1 perm have 0 call sites; two
checked roles exist in no catalog (`mrr.js:22`, `parentFinance.js:22`); no teams table.
Spec: 11-type catalog as data; authority keys (§4) incl. `go_live` = sysadmin OR director; six
permission groups incl. new `operations_config` = "anyone in the ORO + fulfillment supervisors";
gate primitives; route migration map for the hub gaps; migration + compat-shim plan; 6 slices
(S2 unblocks the hub build). §13 lists 5 questions for Kevin before S1.

**NEXT:** Kevin reviews SPEC_user_type_model.md (§13 first) → ratify → S1.

## 2026-08-24 (later, d) — SPEC_user_type_model §13 resolved; ready to ratify

Kevin's answers: **no data migration** — wipe role assignments (keep users' names/logins), bootstrap
the seeded admin with oro_sysadmin + oro_director, re-assign everyone by hand after the build (or
delete+recreate users); supervisor task menu confirmed; operations_config = anyone in the ORO +
team managers/supervisors; SysAdmin bypass removed (technical-only). §9 rewritten (wipe + shim, no
mapping table), §13 marked resolved. **NEXT:** Kevin says go → S1 (tables, seed, wipe/bootstrap,
claim shim, auth_version, verify_user_types) — first code of the user-type build.


## 2026-08-24 (later, e) — SPEC_user_type_model RATIFIED; S1 BUILT and CUT OVER on live (813c377 + this)

Kevin: "go — ratify the spec and build S1". Done end-to-end.

**Built (S1, `SPEC_user_type_model.md` §12):** catalog tables + seed in `schema.postgres.sql` (11 types;
authority / permission-group / task-menu tables; `legacy_perm_map` for the pool SQL; `users.auth_version`);
`services/userTypes.js` (spec tables as constants, `claimsFor` — legacy `roles`/`perms` DERIVED from types
per §9.1, never from the legacy tables; grant/revoke bump `auth_version`); tokens carry
`userTypes/authorities/permissionGroups/inOro/av`; `requireAuth` rejects stale or av-less tokens (60s cache,
1s under test); `POST /staff` no longer grants every permission role (grant-all bug dead); the four non-auth
readers of the legacy tables (`taskRouting`, `objections` — whose supervisor finder was querying the wrong
catalog and always found nobody —, `coverageGap`, `importIngest`) + `seed_task_type_grants` resolve through
types. `db/user_types_cutover.js` (dry-run default). `verify_user_types` 44/44.

**Live cutover APPLIED 2026-08-24 ~21:50:** API restarted (schema landed), `user_types_cutover.js --apply`
removed 219 legacy assignment rows, bootstrapped u-kruss with oro_sysadmin + oro_director, bumped every
auth_version (all pre-existing sessions are dead — everyone signs in again). `seed_user_types_demo_staff.sql`
typed the demo/fixture accounts (testers = sysadmin+director; team supers/managers; Okafor = senior legal;
Cho = team_manager + oro_finance; staff = team_staff). **The five real accounts (mkh@, wjennings@, tjones@,
tjackson@, admin@optimumq.ai) hold NO type** — they log in and see nothing gated until Kevin assigns types
(needs S3's picker; until then only via `userTypes.grant` in a node script). Read-only live probe: u-kruss
`/auth/me` shows both types + go_live etc.; an av-less legacy token → 401; an untyped account → empty claims.

**Suite:** run 2 = 2505 pass / 12 fail in `bw6_mrr` + `external_links` (their "stranger" landed on a team
supervisor after the typed-actor reordering); fixed, re-run 101/101; LIVE UNTOUCHED both runs. Together
they cover every committed file — no third full run. Harness changes worth knowing: 16 harnesses now grant
user types via `tests/userTypeHelpers.js` (`grantLegacy` maps old ids → nearest type); 23 harnesses that
picked "first active user" now prefer a TYPED actor (office admin > supervisor > any type) — the old picks
only worked because every account held every permission role; 5 assertions whose premise was that bug
(e.g. "clarifier lacks SEARCH_AND_TRIAGE", "team_staff holds no FEE_MANAGER") were re-pointed at honest
controls. `usersWithLegacyRole(teamId)` matches the team a team-type was granted AGAINST or the home team;
perms (work eligibility) stay home-team only.

**Fixture:** regenerated from the test DB (old fixture + S1 changes). A regen from live differs only in
`updated_at` timestamps on identical config rows + column order — kept the committed one.

**NEXT:** S2 — gate primitives (`requireAuthority` / `requirePermission`), §8 rows 1–7 (fee-profile,
departments/teams, agent-rules, settlement timing-safe compare, go-live, attest), frontend
`hasPermission/hasAuthority`, `verify_user_types` parts 4–5, 8. S2 unblocks the hub build. Also parked:
the five real accounts need types (S3 picker, or a one-off script if Kevin wants in sooner).

**Addendum (same evening):** Kevin had the five real accounts typed right away (via `userTypes.grant`, actor
`kevin-2026-08-24`): Kevin Hargrove (admin@) = oro_sysadmin + oro_director · Michael Hargrove = oro_supervisor +
oro_associate · Tom Jones = oro_associate · Wayne Jennings = team_manager@team-police · Thomas Jackson =
team_manager@team-clerk-archives. Chosen from titles/legacy roles; adjust with `userTypes.revoke`/`grant` (or S3's picker).

## 2026-08-24 (night) — S2 BUILT and LIVE: gate primitives + hub-gap gates; multi-team added to the spec (S2b)

Before S2, Kevin asked whether one person can be on several fulfillment teams and/or in the ORO too. Answer:
the catalog already stores it (a team type is held *against* a team; office types sit alongside), but WORK
eligibility still reads `users.department_id`. Recorded as **§6.1 + slice S2b** (4420ef0): membership for work
= teams the person holds a team-scoped type against; `department_id` becomes home/display only; eligibility,
pool predicate, claim guard and the legacy fallback move onto it; subset stays per person; picker allows one
chip per team; `verify_user_types` part 9.

**S2 (spec §8 rows 1–9), all live:** `requireAuthority` / `requirePermission` / `requireAnyPermission` in
`middleware/auth.js` (claims-only, no SysAdmin bypass, coded refusals). fee-profile writes →
`fee_configuration`; departments/teams → `operations_config`; agent rules → `system_admin`; staff create /
status / **new `PATCH /staff/:id/user-types`** → `manage_users`; staff profile/team/specialization/task-types →
`operations_config` (+ `assign_task_subsets_global` or `_team` for own team); go-live flip → `go_live`
(**sysadmin OR director now**); attest / confirm / propose → `legal_rules` vs `compliance_policy` by
section/domain — oro_sysadmin is refused on Legal Rules sections (verified, and probed live). Settlement
webhook compare is `timingSafeEqual` over SHA-256 digests. Fresh-install admin (`server.js`) gets
oro_sysadmin + oro_director, not legacy rows. Frontend: `authStore.hasAuthority/hasPermission/inOro`;
jurisdiction-config page + go-live banner gate on them; built + deployed (nginx 200). `AppLayout` menu
checks stay on the legacy shim (S4).

**Suite:** run 4 = 2525 pass / 5 fail — my `secretMatches` export was clobbered by `module.exports = router`,
and the two BW9 harnesses encoded the OLD rules (Director can't flip; "Senior Legal" refusal phrasing).
Fixed export, re-worded the non-legal refusals to still name the Legal Rules line, E2a now asserts
supervisor 403 / Director 200 per spec §4. Re-run of the three: 123/123. LIVE UNTOUCHED every run.
Live probe after restart (pre-write refusals only): supervisor on /enforcement → 403 AUTHORITY_REQUIRED;
team_staff POST /departments → 403 PERMISSION_REQUIRED; senior legal attest `fees` → 403 in words;
u-kruss GET /go-live → 200.

**THE SETUP-HUB BUILD IS UNBLOCKED** (spec §9.2 step 4). Remaining slices: S2b multi-team · S3 Staff
Management picker (writes to the S2 PATCH) + user-types admin page · S4 migrate the ~43 remaining
`requireRole` sites + financial rows + retire the SYSTEM_ADMIN short-circuit · S5 delete shim + legacy tables ·
S6 coverage-gap email. **NEXT:** Kevin's call — hub build vs S2b/S3 first.

## 2026-08-24 (late night) — S2b (multi-team) and S3 (user-type picker + User Types page) BUILT and LIVE

Kevin: "do S2b and S3 before the hub build." Both done, one commit (their edits interleave in `staff.js`/`server.js`).

**S2b — multi-team membership (§6.1):** "on the team" for WORK now means holding a team-scoped type against that
team (`userTypes.teamMemberSql` / `teamsOf`); `users.department_id` is home/display only and gates nothing.
Moved: `eligibleUsers`, the pool predicate (`POOL_ELIGIBILITY_SQL`), `hasSeededType`, the legacy-perm
fallback, and the staff subset-scope "own team" (= a team the caller is team_manager of AND the target is a
member of). Chain-of-command lookups already keyed on the granted team. `verify_user_types` L0–L8: a person
typed on two teams is offered and claims work on both, not a third; home-dept mismatch follows the type;
office-only is eligible on no team. Two harness premises re-pointed (`qa_routing` actor must be a team member;
`bw2_catalog` coverage-gap manager is now the office rung — a typed-on-team manager is legitimately eligible).
Full suite run 8: **2541/2541, live untouched.**

**S3 — the picker and the catalog page (§10):** `GET /api/user-types` (catalog with menus/authorities/groups)
+ `PATCH /api/user-types/:key` display name (`manage_users`); `PATCH /staff/:id/task-types` refuses grants
outside the union of the person's type menus (400 `OUTSIDE_TASK_MENU`) — `seed_task_type_grants` mirror plans
within the menu. Staff Management: user-type picker (office chips; team chips per team, home team first, "Add
another team"), roster shows type chips (+ team name), create = POST + PATCH /user-types, edit modal gates
type edits on `manage_users`, task-type chips filtered to the menu union with held-but-uncovered ones flagged
amber; "Home dept" relabelled. Administration → **User Types** tab: the read-only matrix, Rename for
`manage_users`. Screenshots checked (edit modal, matrix, roster). `verify_user_types` M1–M4 (64/64). Full suite
run 9: 2544/1 — the one red was a harness race with the 1s auth_version cache (a user's OWN subset change
inside the window); `callAs` now waits the window out on a 401 and retries once. Frontend rebuilt + served.
Live API restarted (has `/api/user-types`).

**Noticed on the live roster:** Evelyn Brooks — home dept "Finance Records Team" but typed team_staff on
City Clerk Records & Archives (the seed typed her by her fixture team). Under §6.1 her WORK follows the type
(archives). Fix whichever is wrong via Staff Management.

**Not built (spec says so):** Organization "View staff" per team still lists by `department_id` (§10.3);
the router does not ignore pre-existing uncovered `user_task_types` rows (§9 item 4) — new ones are refused.

**NEXT:** the setup-hub build (unblocked since S2), or S4 (migrate the ~43 `requireRole` sites + financial
rows + retire the SYSTEM_ADMIN short-circuit) — Kevin's call.

## 2026-08-25 (early) — S4 BUILT and LIVE: every gate on the user-type model; SysAdmin bypass retired

Kevin: "do S4 next." Done — the compatibility period is over for gates.

**What moved (35 gates + 25 raw role reads, 17 route files, 3 services):** every `requireRole` /
`requireRoleOrPerm` call and every `req.user.roles` read is gone from routes and services (N1/N2 in
`verify_user_types` grep the tree to keep it so). Two derived helper sets in `middleware/auth.js`:
**ELEVATED** (`act_any_request, reassign_any, reassign_team, override_stage, legal_decision, system` — may SEE
across teams: queue, dashboards, ops summary, rule libraries) and **ROUTING** (`act_any_request, reassign_any,
reassign_team` — may act on / assign work that is not theirs; the old canRoute/ACTING_ROLES set).
`requireRequestAct`'s acting set = ROUTING; its `roles:` extras translate (ATTORNEY_REVIEWER → `legal_decision`).
The three presets are on the new **`taskMenu` token claim** (the §6 union, `'*'` for oro_director):
`requireRedactionWork` = redaction in the menu or legal/acting authority; `requireRequestWork` = any menu or
acting authority; `requireTaxonomyEdit` = `operations_config`. `ruleEditors.mayApplyEditor` now takes the user:
APPLY on a Legal Rules domain is the **owner's** act (oro_senior_legal) — the Director holds `legal_rules` to
attest but a Director's edit there still files for Senior Legal (BW9b C-series kept green on the model).
Dashboard default panes by authority. Frontend `hasAnyRole/hasAnyPerm` consumers moved (AppLayout menu by
ELEVATED; jurisdiction menu by the three configuring groups; approvals by `financial_approval`; Administration's
technical tabs by `system`; workspace Director acts by `override_stage`); the sidebar shows the first user type.

**Behaviour changes worth knowing (all per spec §4/§5):** oro_sysadmin can no longer reopen requests, decide
fee waivers / objections / commercial rate, or read the parent ledger; oro_director can no longer open the
magic demo, integrations, or `POST /config`; supervisors and every ORO type CAN edit taxonomy, workflow rules,
estimate calibration, time budgets, release switches (`operations_config`); legal escalation is the `escalate`
authority (director, ORO supervisor, team manager); statutory updates / clarification policy / onboarding /
profile sync are `compliance_policy`. The `perms` claim survives as the derived **act-permission** axis that
`requireRequestAct({perms})` matches (spec §9.1 as-built note) — the `roles` claim is consulted by nothing and
is deleted in S5.

**Suite:** targeted 16-harness run 694/16 → the 16 were five harness premises from the old rules (supervisor
403 on taxonomy; Director bar on release knobs; synthetic users built with `roles:`; the owner-only legal
apply) — re-pointed; then full run 16: **2557/2557**. LIVE UNTOUCHED every run. Frontend rebuilt + served;
screenshots: team staff sees Dashboard + Queue only; admin sees the full menu + go-live banner. Live API
restarted after green.

**NEXT:** S5 (delete the `roles` claim + the four legacy tables + `FUNCTION_ROLES` frontend constant + the
`requireRole` functions; rewrite ARCHITECTURE §4 / SPEC_tasks_roles §8 as history) is small now. Then the
hub build. S6 (coverage-gap email) any time.

## 2026-08-25 (early) — S5 BUILT and LIVE: the v1 role catalogs are gone

Kevin: "do S5." The user-type model is now the ONLY model in the codebase.

**Deleted:** the `roles` JWT claim and `functionRoles` on `/auth/me` + staff payloads; `requireRole` /
`requireRoleOrPerm`; the four v1 tables (`function_roles`, `permission_roles`, `user_function_roles`,
`user_permission_roles`) — `schema.postgres.sql` now `DROP TABLE IF EXISTS` them idempotently, the fixture
generator and `seed_fixture.sql` no longer carry them; `user_types_cutover.js` (its job is done);
`usersWithLegacyRole` / `typesMinting` / `legacyPermHoldersSql`; frontend `hasRole/hasAnyRole/hasAnyPerm`.
`seed_testers.sql` rewritten on user types; `seed_test_staff.sql` trimmed to accounts only.

**Renamed/kept (the act-permission axis, spec §9.1 as built):** `LEGACY.perms` → `ACT_PERMS` (per-type act
list matched by `requireRequestAct({perms})` and the pool fallback for legacy-tagged tasks); `usersWithLegacyPerm`
→ `usersWithActPerm` (membership-scoped); new `usersWithTypes(keys, {teamId})` for chain-of-command lookups
(coverage-gap chain = team_manager → team_supervisor against the team → oro_director → oro_sysadmin; objections'
escalate = team supervisor → team manager → any ORO supervisor; import notify = sysadmin + director). The
`legacy_perm_map` table keeps its historical name (seeded from `ACT_PERMS`; A4 asserts they agree).

**Live:** before the drop (verified read-only) the two assignment tables held 0 rows and the two catalog tables only their 9 + 11 v1 seed rows; no FK referenced any of them; the API
restart applied the DROPs. Frontend rebuilt + served.

**Suite:** targeted 10 harnesses 369/0 (one census trip = the app's own `Scheduled Batch` REDACTION_APPLIED rows
at 00:57, the known nightly-worker false positive — see memory); full run 18: **2533 + 21 (queue_parent_child re-run after its own role-name lookup was moved to authorities) = 2554/2554**.

**Docs:** spec S5 row + §3.1/§9 notes; ARCHITECTURE §4; SPEC_tasks_roles §8 header; DOMAIN_MAP.

**The user-type build is complete except S6 (coverage-gap email).** NEXT: the setup-hub build, or S6.

## 2026-08-25 — S6 BUILT: coverage-gap email verified; THE USER-TYPE BUILD IS COMPLETE (S1–S6)

Kevin: "do S6 next." The email itself already existed (BW2's `coverageGap.notifyEmptyPool` mails on first raise)
and S5 had put its recipient chain on user types; S6 made it true to the spec and PROVABLE: header rewritten
(chain = every `team_manager` held against the team → `team_supervisor` → `oro_director` → `oro_sysadmin`);
the sender is injectable (`opts.send`) so a harness can capture the message while the real sender stays
guarded off under any `_test` database; `verify_user_types` O1–O5: both managers resolved (not the
supervisor), fallback order, one email to both managers naming the task and the request number, no second
email on the reconciler's re-raise, guard present. 77/77 + bw2 55/55, live untouched. Live restarted.
Not built: per-recipient preference / digest (noted in the spec).

**SPEC_user_type_model.md: all six slices built.** NEXT: the setup-hub build (design closed 2026-08-24;
lane ownership reads off permission groups; go-live off `go_live`).

**Addendum:** the post-S6 full-suite confirmation (run 21) came back 2558/2558, live untouched.

## 2026-08-25 — HUB H1 BUILT and LIVE: the Setup & Configuration hub replaces the wizard as the front door

Kevin: "start the hub build." New binding spec `docs/SPEC_setup_hub.md` (design closed 2026-08-24; canvas +
`WORKING_setup_inventory.md`). Built: `services/setupHub.js` (five lanes; the 36-item catalog with plain names,
doors, deps, owner GROUPS; one counted-evidence reader per item; Option-A sign-offs in `setup_hub_signoffs`),
`routes/setupHub.js` (`GET /api/setup-hub`; `POST|DELETE /:key/done` gated by the lane's permission group,
`legal_rules` on legal sections, go-live never markable), `pages/SetupHubPage.js` on Administration → Setup
(header counts · Start-here agency card · five lane columns · row = button · chip + evidence · Why popup for
waiting rows with "Open it anyway" + "Go to <prerequisite>" · Mark it done / Marked done). The 7-phase
`SetupPage` is no longer mounted (file kept; `/onboarding` API untouched — the fee-test signal still reads it).

**Rules as built:** states counted (ready / in_progress / not_started / needs_attention / waiting); running
on defaults says so; dependencies open-with-warning (never a lock; a row's own progress wins over waiting);
a mark shows by name + date, is reversible, never overrides needs_attention/waiting; every reader is
defensive (a throw → honest "could not read" line, page still renders). Six no-screen items render with a
counted state and no door (H2 builds their screens one at a time, design first).

**Live today (Autumn Falls):** 23 ready · 6 in progress · 2 not started · 4 waiting · 1 needs attention (the redaction-rules section, once its count read correctly); lanes 7/11 · 3/8 · 5/5 · 3/4 · 4/7; zero reader errors after two column fixes found on the live read
(fee-test reads `test_config_ref`/`test_by`/`test_at`; redaction rules read `approval_status`/`is_active`).
Screenshot checked against the artboard.

**Suite:** `verify_setup_hub` 22/22 (catalog shape; deps real; owners are groups only; counted evidence flips
on an unserved department and on a pending proposal; waiting rows keep their door; go-live 400 NOT_MARKABLE;
marks gated per lane/legal/technical; reversible; page builds when a reader throws). Full run 26: **2580/2580** (run 27; run 26 was wrecked by my own live restart mid-suite — the kill pattern also matches the test API; now a memory).
Run 21 (post-S6 confirmation) was 2558/2558.

**NEXT (SPEC_setup_hub §7):** H2 screens for the six no-door items (1.7, 2.9, 2.10, 2.12, 2.13, 4.7) —
design first, one at a time; H3 auto-load the state rule profile on agency-state save; H4 retire the
collisions; H5 validation-conditional Ready on demand.

## 2026-08-25 (closing) — H2 design canvas up, awaiting Kevin's direction; no build

Kevin: "do H2." Per the UI rule (design direction before a new screen) the six no-door items are drafted on a
canvas — one shared "setting panel" pattern + one artboard per screen (clarification policy · automatic
redaction decisions · review-before-release switches · standard denial wording · bulk-redaction schedule ·
finance-system connection): https://claude.ai/code/artifact/bb695abf-d2d1-49a2-b6e5-904ad686dbe6
(working files in the session scratchpad only; re-create from the canvas if needed). Static mockups; copy is
mine. **NEXT:** Kevin approves / marks up → build the six on the pattern one at a time (backend endpoints
where missing: bulk-schedule config keys, settlement provider config + test charge), each committed green;
then H3 (auto-load state rules on agency-state save), H4 (retire collisions).

## 2026-08-25 (design day) — hub → linked screens brainstorm; agency artboard; TX fact bases for Kevin; NO build

Kevin re-ordered the work: H2 (six no-door screens) is DEFERRED. Instead we are designing how each hub row
links to its screen, walking the Plan A gantt (copy in `~/exchange/setup_hub_plan_gantt.{html,png}`). All of
today is in `docs/WORKING_hub_linked_screens.md` (subject to change; not folded into SPEC_setup_hub yet).

**Decided (Kevin):** lock the jurisdiction state via a button ("Lock state and load its rules" = slice H3,
fired by the click, not by save); remove the old Agency tab from /admin Configuration once the new page
exists. **Drafted:** shared "status strip" pattern (state chip = button back to the hub · evidence line ·
Attest, gated on the screen's own completeness) + the agency screen artboards, before/after lock:
https://claude.ai/code/artifact/76a93009-f5d2-4255-94bf-dd9d3ced3b3d (sources `docs/mockups/hub_links/agency/`).
Awaiting Kevin's markup; explicitly NOT building yet — he wants to walk more rows first to see if the
concept revises.

**Facts established (read-only, in the working doc §1, §2, §2a):** phone edits on the config tab DO persist;
no address fields exist anywhere; state save triggers nothing (importer is CLI-only). Jurisdiction sections:
15, fixed by the app not the state (9 core + 6 after the state load); content varies by state, the set never
does; residency is a yes/no inside `eligibility`. Fee flow: the state load writes only the fee SENTENCES to
the Content tab; the 35 verified dollar items per template are read by nothing; Fee Configuration's
template is a hardcoded skeleton over a hand-seeded `fee_profiles` row; Save config overwrites in place
(bounds gate only); the "policy text (AI)" control is a paste box that persists nothing; the 08-21
"Propose change" composer files a draft fee profile that NO screen can activate. Auto-config / regenerate
from the 08-19 design were never built.

**Kevin's emerging direction for fees:** state-entry screen → "State Mandate" window + "Guidelines and
Deferral to Local Policy" window; local policy document → AI → local rules under the mandate → approved →
new fee template version; scope split computation vs estimate/payment/clocks. The template's `basis` field
makes the mandate/deferral split mechanical.

**Handed to Kevin in `~/exchange/`:** `TX_STATE_RULES_SECTIONS_2026-08-25.md` (+ live screenshot),
`TX_RULES_READABLE_2026-08-25.md` (all 37 TX rules by section; source defect: TX-S04 clipped in the template
itself), `TX_FEE_FOUR_BUCKETS_2026-08-25.md` (13 / 9 / 10 / 3; two mandatory items have no engine home —
need a requestor ledger; five numbers live in two places).

Commits today: 3a700a1, 6de7833, 3a11dcb, 1208e24, 6e2f66f (docs + mockup sources only). No code, no DB
writes, no suite run needed. **NEXT:** Kevin's sketches land in `~/exchange/`; react, fold decisions into
the working doc; keep walking rows; build nothing until he says.

## 2026-08-25 (evening) — live config WIPED (backed up) so Kevin can walk setup from zero; reset tool added

Kevin: "delete the rules/jurisdiction configuration (back up first) so I can go through setup and watch the
state rules file come in — I think what I see for fees/estimates/timelines/redaction was forced in during the
build." Correct: it was. Storage map (read-only agent pass) → the config lives in 18 tables + 4 `system_config`
keys, no FKs from operational rows, and `schema.postgres.sql` re-runs every boot and BACKFILLS
`jurisdiction_rules` deadline/clarification from `system_config.deadline_rules`/`clarification_policy` — those
keys had to go too or the wipe silently undoes itself on restart.

**Tool:** `backend/scripts/config_reset.js` — `backup --tag` (copies the tables into schema `backup_<tag>` +
a secrets-redacted JSON in `~/exchange/`) · `wipe --tag` (refuses unless the snapshot matches live) ·
`restore --tag` · `status` · `activate --jid=jur-tx`.

**Done on LIVE:** `backup --tag=20260825` (jurisdiction_profiles 21 · jurisdiction_rules 59 · fee_profiles 1 ·
redaction_rules 26 · record_type_estimate_profiles 10 · sections 201 · proposals 8 · history 111 · system_config
43 …) → `wipe` → API restarted → re-counted: everything 0 except `onboarding_progress` 7 (schema re-seeds it
clean, test_status NULL = fee test not started) and `layout_profiles` 1 (schema default). Hub screenshot:
**15 ready · 3 in progress · 4 not started · 14 waiting · 0 needs attention** (was 23/6/2/4/1); "Which state's
law" = Not started, every compliance row Waiting on it. Agency, departments, record types, users, technical
lane and all requests untouched. **Restore any time:** `node scripts/config_reset.js restore --tag=20260825`.

**The finding that answers Kevin's question:** there is NO screen that loads state rules. The only loader is
the CLI `node src/db/import_state_template.js TX` (dry run confirmed: creates `jur-tx` as status=library and
writes 14 `jurisdiction_rules` domains — branches clarification clock_matrix deadline disposition eligibility
exemption fee fee_waiver intake ledger payment redaction template_import; 26 city knobs arrive unconfirmed;
no statutory response clock for TX → acknowledge/complete become city service targets). Nothing in the UI
sets the active jurisdiction either (`system_config.jurisdiction_profile` — the seed did it by SQL; now
`config_reset.js activate`). The importer does NOT write `fee_profiles` (the rate table the engine reads),
`redaction_rules`, `record_type_estimate_profiles` or `layout_profiles` — those were all hand-seeded; after
an import they stay empty and their hub rows stay not-started. That is the honest picture of what the app
does on its own today, and it is the gap the H3 "Lock state and load its rules" button is meant to close.

**Kevin's walk-through:** 1) Administration → Setup shows the from-zero hub. 2) `! cd /opt/optimumq/backend &&
node src/db/import_state_template.js TX` 3) `! node scripts/config_reset.js activate --jid=jur-tx`
4) reload the hub / Jurisdiction Configuration and see what the import populated. Existing demo requests
with fee estimates now point at a deleted fee profile — readers fall back to null/zero, nothing throws.
No suite run (no code under test changed; the tool is ops-only). Commit follows.

## 2026-08-25 (late) — H3 BUILT: /setup/agency with "Lock state and load its rules"

Kevin, after the wipe: "this is a good place to build the change we discussed — the button that applies the
state jurisdiction rule file." Built to the agency artboards (Main/Locked) and WORKING_hub_linked_screens §0–§1:
- `backend/src/routes/agency.js` — `GET/PUT /api/agency` (agency name/short name/jurisdiction type, street +
  optional mailing address, contact email/phone; the jurisdiction `state` moves with Save only until locked),
  `POST /api/agency/lock-state {state}` → `importState()` + profile active + `system_config.jurisdiction_profile`
  + `state_locked_at/by`, in that order so a failed import never says "locked". 409 on a second lock, 422 for no
  state / no rules file (32 states have one), 403 outside the agency item's groups. Mounted in server.js.
- `services/setupHub.js` — agency door `/setup/agency`; reader counts every required field and says
  `state not locked` until the lock; ready evidence = "… · TX rules loaded by <name>, <date>".
- `frontend/src/pages/AgencySetupPage.js` + route; status strip (chip → hub · hub evidence · Attest = the
  item's own sign-off, enabled only when complete AND locked); confirm dialog; post-lock panel summarising what
  loaded. ConfigurationPage: Agency tab removed (default tab now Authentication).
- `tests/verify_agency_setup.js` (registered in run_suite): 18/18; with verify_setup_hub 22/22; live census
  clean. Frontend rebuilt (exit 0, nginx 200), page screenshot checked against the artboard.

**Live state right now:** config still wiped (backup_20260825); agency fields filled (200 Main Street …);
state TX chosen, NOT locked — the lock click is Kevin's to make on /setup/agency. Full suite NOT run tonight
(subset only); run it next session before anything else lands. Not done: hub reader shows the state code not
name; the Locked panel's "Regenerate from state rules" link just goes to /jurisdiction-config.

## 2026-08-25 (night) — Kevin locked TX live · fee_law row sketched and APPROVED · redaction direction decided

Kevin clicked Lock on /setup/agency: jur-tx active, 15 rule rows; hub 15/7/3/11/0 (agency Ready · "TX rules
loaded by Kevin Hargrove"; jurisdiction/deadlines/exemptions/city-choices In progress; fee_law/deposits/
waiver/clarification still Waiting — importer files those as enabled:false safe defaults; fees check reads
`fee_profiles`). New facts: the import DROPS TX.json's 35 `fee_schedule.items` (blob has 3 sentence concepts);
the rules library has no exemption catalogue (52 Redaction rules are process); the wiped redaction library
was 14 seed + 12 AI-drafted-from-text rules Kevin approved 06-10, with no source document recorded.

**Canvas (approved by Kevin, revised twice):** https://claude.ai/code/artifact/50a65ce5-a37b-4ad4-a9ef-276474b0d4bd
— State mandate window (one ceiling per row + "This city charges", **ceiling rows default to the ceiling for
every state** — Kevin's call) · Deferral window (document → AI → page-referenced proposals → approve) ·
Approve = fee schedule v1. Facts/decisions in WORKING_hub_linked_screens §2b–§2d.

**Decided:** redaction library = document upload → AI drafts → legal approval, or hand-typed; no research pass.
Jurisdiction Configuration screen + many admin links to be retired; hub to be simplified by Kevin; screens link
to the revised hub. **NEXT: build the fee_law canvas** (importer keeps fee_schedule.items · approval writes a
versioned fee_profiles row via engine_field · hub reader = version exists · document→AI with persisted refs),
then decide next step. Full suite still not run since H3 — run it first.

## 2026-08-26 — full suite run (19 fails, all one root cause) · F1 "What the law lets you charge" BUILT

**Full suite run 28: 2519/2538, 19 fails in 8 harnesses (concurrent_tolls, wrap_parent, legal_review,
branch_profile, clock_matrix, bw9_golive, bw9b_editors, e2e_tx); live census clean.** Every failure is the same
fact: live `jur-tx` now comes from Kevin's fresh template import, not the hand seed — it has NO primary
`respond` clock (`complete` has no duration), `exemption_model` NULL, `statute_name` NULL. The backup had
respond primary · complete 10 bd · pre_clearance · "Texas Public Information Act". So: (a) not a code
regression; (b) a REAL gap in the state load that the seed was hiding — a city that locks TX today gets no
statutory due date on new requests. Kevin's call: fix the importer's TX clock reconciliation (the template says
TX's completion clock IS the statutory clock but WS3 leaves it unresolved) and let the lock set
exemption_model/statute_name, or restore those three facts by hand. Until then those 19 stay red.

**F1 built** (commit follows): `/setup/fee-law` to the approved canvas — State mandate (ceiling rows default
to the ceiling, refused above; fixed "as law"; floor at minimum; 2 ledger gaps flagged) · Deferral (figure /
none / actual, or a fee policy text read by `feePolicyExtract` into `document` decisions with references) ·
Approve → `fee_profiles` FR v n active, previous superseded, `config_history` carries the decisions · hub
`fee_law` reader + door. `services/feeLaw.js` reads the 35 items from the state's template file (key set
identical in all 32; parser 0 errors over 1,120 cells). `verify_fee_law` 22/22 (twice), hub + agency 22 + 18
green. Frontend rebuilt (exit 0); screenshots checked. Live: TX fee-law screen shows 22 loaded / 0 of 13
decided / no version — Kevin's to walk. NOT done: PDF extraction, page bands, SS context.
**NEXT:** Kevin walks /setup/fee-law; decide the TX clock/exemption_model gap; then the redaction row (§2c).

## 2026-08-26 (cont.) — fee-law screen split into four tabs; test-estimate sandbox re-homed; statute popup

Kevin, after seeing F1: too much on one screen → **four tabs** (State mandate · City decisions · Fee policy
document · Test an estimate); the live fee calculation test moves here from Fee Configuration (the old
preview stays on that page until the page is retired); keep the title. He also noticed the click-to-view
statute text on the old screen — every authority citation on the new screen now opens the research record
(verbatim statute language; fee-gap ids TX-9xxx honestly "no research record"). Hub `fee_test` door →
`/setup/fee-law?tab=test`. Rebuilt; all four tabs screenshotted; popup verified by click; `verify_fee_law`
22/22 + `verify_setup_hub` 22/22, live clean. Live still has no fee schedule version, so the Test tab shows
its honest "approve v1 first" state — Kevin's walk-through will exercise it.
Kevin: "why do I see nothing on the test tab?" — it was gated on an approved version. Now `POST /api/fee-law/preview`
prices against the unapproved DRAFT (law figures + today's decisions, composed, not saved) or the approved
version, with a radio on the tab; the outcome buttons stay disabled until a version exists. `verify_fee_law`
24/24. Rebuilt; live shows the draft estimate ($82.50 on the 120-page sample).
Kevin's first hands-on: (1) focus lost after one keystroke on City decisions — row renderers were components
defined inside render (remount per keystroke); now called as functions → fixed, verified by typing "2.50"
in one go. (2) citations were in the tab order → tabIndex -1. (3) "actual cost" items: the engine already
prices `actual` as "actual TBD"/$0 + `hasUnpricedActuals` (release checks it), but the ESTIMATE panel has
no field for staff to enter the real amount for such a line (only labor-rate overrides) — Kevin's proposed
flow (blank on schedule → staff enters during estimate → true actuals at billing) needs that estimate-side
input; a postage default-for-estimate would need the delivery config to carry both a default and 'actual'.
Both parked for Kevin. Specialty-reproduction's citation ids are TX-9xxx (fee-gap rows) → no research record.

## 2026-08-26 — actual-amount entry on the estimate screen (Kevin's go)

`feeEngine`: `request.actualAmounts` {dup_bw|dup_color|dup_oversized|media:<type>|delivery → $} prices an
'actual'-rated line at the entered figure on the request-level line, pro-rates it across components by
quantity, clears needsActual/hasUnpricedActuals; blanks/non-numeric/non-actual keys ignored. Routes
`/fee-estimates/request/:id` + `/reconcile` pass it through (persisted in the snapshot input). `FeeEstimatePanel`:
amber "Actual-cost items" box under the itemized estimate, one `$ actual` input per such line, sent on
Calculate and on Reconcile. SPEC_fees_estimates_payments §2a. `verify_actual_amounts` 9/9 (engine + API),
`verify_bw4_estimate` 70/70, live clean. Frontend rebuilt. NOT screenshotted on live: no priced request exists
until Kevin approves fee schedule v1 and runs an estimate — his walk-through will show the box. Not built:
default-for-estimate postage figure.

## 2026-08-26 — ledger: design doc corrected, views sketched; no build

Kevin asked what "portal account" meant — answer: nothing built or wanted; the ledger's real anchor is the
wizard's link-verified email (or staff confirmation). `DESIGN_requestor_ledger.md` decision 1 reworded
(+ addendum on storage shape: per-requestor event SUM, not a scan). Live: 13 requests all unverified, 0
profiles, 27 anonymous links → the built class-A ledger is inert until a real wizard submission lands.
Canvas https://claude.ai/code/artifact/2c16b365-5198-4a1d-bf1e-50096cc3faf0 (ledger card · anonymous state ·
email lookup); WORKING §2e. Awaiting Kevin's markup.

## 2026-08-26 — live smoke with a REAL portal submission (kept, not purged): first real ledger exists

Request **2026-000005** (parent 3e3069d1…, child 2026-000005-1 589026cd…), requestor
`mkhargrove+smoke@gmail.com`, driven at machine speed through the real endpoints (scratchpad smoke*.js):
1. **Verify** — POST /public/request-verification sent the real email (resend: sent:true); the link click
   (GET /public/verify/:token) recorded verified_at. ✅
2. **Submit** — POST /public/submit with the wizard's payload + token → 201; `email_verification_method =
   link_clicked` on BOTH parent and child (the server-side token check, not a claim). ✅
3. **Ledger anchoring** — `requestor_profiles` **rp-8d375b64** created ("created on first verified_email");
   both rows linked `verified_email`; `evaluateEstimate` → identified, no triggers (nothing owed). **The
   built class-A ledger is no longer inert: this is the first real ledger on live.** ✅
4. **Route** — engine advanced intake → record_search itself; record_search + estimate tasks spawned;
   AI classified (simple, council minutes); public status check answers "In Process · Record Search". ✅
5. **Estimate — BLOCKED (expected):** 400 "No fee configuration exists for the active jurisdiction" — no
   fee schedule version has been approved since the wipe. Kevin approving v1 on /setup/fee-law unblocks it.
   Search/redact/deliver not attempted (downstream of the estimate gate). ⛔
6. **Clock gap confirmed on live:** only `certify_delay` runs; NO primary respond clock, `deadline_date`
   NULL on the parent — the fresh-import TX profile has no primary clock (see the full-suite finding).
Minor: a `submissionChannel: 'portal'` request is logged "Submitted via AI chat agent" (publicChat.js
labels only manual_form separately) — cosmetic, unfixed. Kevin receives the verification email.

## 2026-08-26 — TX primary clock: reconciler decision reversed on Kevin's call; live re-reconciled

The "gap" was the reconciler's deliberate reading (TX-0009 → certify_delay, no primary; the old seed had
supplied a legacy 5/10/20/30-day `respond` with no statutory basis). Kevin: fix it. Decision: § 552.221(d)
(produce OR certify a delay by the 10th business day) binds on every request → it is TX's primary RESPONSE
clock (`respond`, 10 bd, label "Produce, or certify a delay"); "promptly" stays a service target.
`clockMatrix.CHECKPOINT_SLOTS` + `SLOT_OVERRIDES['TX-0009']='respond'`; all 32 templates diffed — only TX
changed. Importer also fills `exemption_model` (pre_clearance when Denial.dag is active) and `statute_name`
(known-names table) when empty. Live: re-import staged deadline/fee/template_import proposals; the deadline
one applied via `effectiveConfig.applyConfig` (reviewer path); duplicate `certify_delay` removed from the
live config and the smoke request; `startClocksForRequest` gave 2026-000005 a primary clock →
**deadline_date 2026-09-09** on parent and child. Profile: pre_clearance · "Texas Public Information Act".
**Still pending on live (Kevin to review on the hub's law-updates row): fee + template_import merge
proposals** from the re-import. Harnesses: the 8 formerly red all green (clock_matrix 54/54 with updated
TX assertions, e2e_tx 36/36, tolls 27/27, wrap_parent 43/43, legal_review 44/44, branch_profile 62/62,
golive 35/35, editors 37/37); jurrules 27/27, deadline_rules 25/25, config_integrity 17/17 (alone); live
clean. SPEC_phase7_build addendum. Full suite re-run started after this commit.

## 2026-08-26 (closing) — day summary and the next slice (decided with Kevin)

**Full suite after the clock fix: 2629/2630, live untouched.** The one red is `verify_bw9_golive` E1a ("a
fresh import is honestly NOT ready") — it predates today, and Kevin DEFERRED it: its premise needs a fee
profile and pending proposals that a fresh, unprofiled TX no longer produces. A diagnostics line was added
to the harness (prints ready/unconfirmedSettings/proposalsPending/activeBranchUnconfirmed + what the import
wrote) — the runner's summary did not surface it; read the harness's own stdout in the suite log next time.
Re-visit once fee schedule v1 is approved and the data is in.

**Today, in order:** config wiped behind `backup_20260825` (restore: `node scripts/config_reset.js restore
--tag=20260825`) → H3 /setup/agency + lock built, Kevin locked TX live → F1 /setup/fee-law built (four tabs,
ceiling defaults, draft/approved test estimate, statute popup) → actual-amount entry on the estimate
screen → ledger design corrected (no accounts; verified email) + ledger canvas → live smoke with a real
portal submission (2026-000005: first real ledger profile; estimate blocked pending fee schedule v1) → TX
primary clock fixed in the reconciler (§ 552.221(d) produce-or-certify, 10 bd) and applied on live
(2026-000005 due 2026-09-09).

**Live state to know:** jur-tx active, primary `respond` clock, pre_clearance, statute name set; NO fee
schedule version yet (Kevin to approve v1 on /setup/fee-law — unblocks the estimate beat of the smoke);
two pending merge proposals from the re-import (fee, template_import) on the law-updates hub row; request
2026-000005 kept as the ledger specimen; 12 integrity WARNINGS (unconfirmed imported suggestions) — honest.

**Awaiting Kevin's markup:** ledger canvas (§2e) · fee-law approve-partial / ledger-gap questions (§2b).

**NEXT SLICE (decided):** one screen, three tabs, status-strip pattern, for hub rows **4 Vague requests and
clarification · 7 Exemptions and appeals · 11 Who is allowed to request** (TX_RULES_READABLE §4/§7/§11).
Each tab = what the law says (citations → research popup) · the city's few choices · attest. Specifics:
- §11: attest only; one gated dimension to confirm (incarcerated-requester exclusion, TX-0004).
- §4: 5 knobs (vagueness wording · clarification letter · response window, TX 61 d statutory · close-as-
  withdrawn notice · materially-revised = new request?) AND the tab must switch the clarification policy ON
  (import filed it `enabled:false`) or the hub row never leaves "not configured".
- §7: 4 knobs — "Select reason(s) from config library" IS the redaction/exemption rules library (not
  `decision_reasons`, which is five seeded fee-waiver denial sentences) → show as "comes from the Redaction
  rules library — not loaded yet", confirmable as such; "Legal approval" = designate a permission group;
  denial letter; denial deadline (city policy).
- Letters: NO letter-template store exists (clarification/fee letters are generated in code —
  clarificationAction, feeNotice). Decision: this screen shows each letter as "standard wording" with a
  view of the generated text; an editable template store with per-state required-element checks is its
  OWN later slice (after the redaction library). Keep this screen small. Design canvas first.
Uncommitted at close: the E1a diagnostics line in `verify_bw9_golive.js` — committed with this note.

## 2026-08-26 — clarification/exemptions/eligibility three-tab screen: design canvas drawn; no build

The decided slice, canvas-first per the UI rule. **Canvas
https://claude.ai/code/artifact/ad29b14f-c181-407b-870c-f8045a840b61** (sources
`docs/mockups/hub_links/clar_exempt_elig/`, WORKING_hub_linked_screens §2f). Four artboards: the three tabs
(status strip follows the active tab; tab dots show each row's hub state) + the clarification-letter popup
showing the REAL `buildNotice` text (City of Autumn Falls, graceDays 61). Facts drawn from live: clarification
domain `enabled:false` / section not_configured with 0 settings; exemption section = the 4 `knobs/Denial.*`
unconfirmed; eligibility = 6 dimensions, only `incarceration` gated (TX-0004); NO hub row exists for
eligibility (new-row question drawn as a sticky note). Content from TX_RULES_READABLE §4/§7/§11; exemptions
law panel drawn as the AG-process clock (10th bd / 15th bd / missed → presumed public § 552.302). A review
pass fixed: letter-hint contradiction (standard sentence is softer than the § 552.222(d) withdrawal
consequence — now says so and defers to the letter view), a 220px input clipping its grid column, and the
missing "new 9/1/2025" tag on the § 552.221(g) notice. Committed c7054f8 (docs only, no code, no DB writes,
no suite needed). **Open for Kevin on the canvas:** eligibility hub row placement · three doors → one screen
with preselected tab · strengthen the TX consequence sentence now vs. with the template store. Build waits
for markup.

Addendum: canvas screenshots handed to Kevin in `~/exchange/clartabs_1_clarification.png … _2_exemptions
… _3_eligibility … _4_letter.png` (clarification tab as balanced 62d84f9).

Addendum 2026-08-27: both canvas links (three-tab screen + requestor ledger) handed to Kevin in
`~/exchange/CANVAS_LINKS_2026-08-27.md`, alongside the `clartabs_*` shots; the ledger canvas also carries a
see-also note pointing at the three-tab canvas (46321d4).

## 2026-08-27 — request-rules three-tab screen BUILT (R1); suite 2657/2658 (E1a deferred, as before)

**Kevin's calls (this session):** design approved · new hub row `eligibility` "Requestor eligibility"
(Compliance lane, item 8 of 12) · three doors, each opening its MATCHING tab · letter wording waits for the
letter-template slice.

**Built (b732b43, reworked c6cb21a):** `/setup/request-rules` (`RequestRulesPage.js`; status strip follows
the active tab, tab dots = hub states) · `services/requestRules.js` + `routes/requestRules.js` · shared
`components/StatutePopup.js` (FeeLawPage refactored onto it) · hub doors + eligibility row + readers ·
`verify_request_rules` (28/28) registered in the suite. Law panels walk the locked state's TEMPLATE FILE by
concept domain (TX 4/10/4 = the readable doc's exact lists; all 32 templates parse; statutory reply window
found for TX 61 / MO 90 / VA 30). Clarification master switch materializes the five choices as confirmable
`city_config` knobs and fills the statutory policy fields (61 d + withdrawal closure, § 552.222(d)
provenance); confirms write through reply-window/closing-notice to the policy fields. Exemption tab = the 4
`knobs/Denial.*` settings through the EXISTING Legal-Rules confirm endpoint; reasons = Redaction-rules-library
acknowledgement card; denial letter = standard STRUCTURE view (no generator exists yet). Eligibility posture
= gated + confirmed in one act. SPEC_setup_hub §7 R1 bound in the build commit.

**The first full suite caught a real design fault — worth remembering:** the five choices first lived INSIDE
the `clarification` policy domain, and configIntegrity polices that domain's schema as exactly
enabled + provenance + the 7 fields (the BW9b editors render it the same way) — the extra key read as
corruption (8 reds across 5 harnesses). Fix: the choices live in their OWN domain
**`clarification_screen`** (unpoliced by design); `goLive.settings` folds it into the clarification SECTION
so the hub counts the choices; `clarificationPolicy` reverted byte-identical. Harness made order-proof
(imports TX itself when the fixture lacks the template domains) and residue-free (wholesale jur-tx
snapshot/restore + its own integrity-clean cleanup assertions).

**Full suite after the rework: 2657/2658, live untouched.** The one red is `verify_bw9_golive` E1a — the
SAME deferred red as 2026-08-26 (Kevin: revisit once fee schedule v1 + real proposal data exist). Honesty
note: E1a "passed" in this session's FIRST full run only because my harness's residue accidentally gave the
go-live walk unconfirmed settings; the residue-free cleanup returns it to its known red. The E1a diagnostics
line still does not surface through the runner (its FAIL-line filter) — unchanged from the 2026-08-26 note.

**Live state:** screen live and verified by authenticated screenshots (real TX data); clarification still
switched OFF (Kevin's act to make on the screen — flipping it is what moves the row off Not started),
exemptions 0 of 4, eligibility "one decision to confirm"; `clarification_screen` domain does not exist on
live until the switch is flipped. Fee schedule v1 still unapproved; the two law-updates merge proposals
still pending. Earlier this session: three-tab + ledger canvases handed to Kevin (`~/exchange/clartabs_*`,
`CANVAS_LINKS_2026-08-27.md`); ledger canvas got a see-also note.

**NEXT:** Kevin walks the screen (switch on, record choices, attest) · fee schedule v1 approval unblocks the
smoke's estimate beat and the E1a revisit · then the next hub row or the letter-template / redaction-library
slices per the backlog.

## 2026-08-27 (later) — "Fee rules": the fee-law screen absorbs waivers (F2 BUILT); waiver-content canvases; suite 2664/2665

Started from Kevin reconciling /jurisdiction-config/fee_waiver Content against TX_RULES_READABLE §6 and
finding a wall of pale yellow. **Traced:** yellow = uncited = the national 22-field substrate rendering in
full; for TX, 15 fields are uncited and — except the forfeiture guardrail (wired, off, IL's rule) — read by
NO engine code; the cited estimate/deposit lines are the known twice-homed pair whose real home is the
fee-law screen. **Kevin's design principle confirmed:** mandates render as fixed facts, real local choices
as knobs, everything else off the setup surface. His EXCLUDE-flag idea resolved as INCLUDE-BY-EVIDENCE (the
citation IS the flag; a second flag would drift) plus **negative-finding records** — `{no_provision,
researched, note}` per concept, authored in the research pipeline, imported as provenance, distinguishing
"researched, state silent" from "nobody looked".

**Canvases (sources committed, awaiting markup where noted):**
- Fee-waiver Content pruned, redraw 2: docs/mockups/fee_waiver_content/ →
  https://claude.ai/code/artifact/8a77071f-3c95-4c1b-849e-e61715d2d669 — TX Content = cited cards + pointer
  cards + one silence footer; Provenance zone carries the negative-finding records; Florida artboard = the
  silent-state empty case with the one offer-a-waiver-at-all choice ("no waiver" must count as CONFIGURED —
  open build item, same class as clarification's switch). This slice is NOT built.
- "Fee rules" consolidation: docs/mockups/fee_law_waivers/ →
  https://claude.ai/code/artifact/4286a33e-b35e-488b-9f93-35b7d7acdb46 — superseded by the build below.

**Kevin's decisions (all this session):** everything fee-related, waivers included, lives on the fee-law
screen · title **"Fee rules"** ("Fee Parameter Domain" considered, dropped — register + "domain" overload) ·
NO fifth tab: a "Fee waiver" SECTION on each existing tab · the `waiver_policy` hub row is DELETED · the two
waiver choices gate **Attest, never Approve** · no exchange copies of built-screen screenshots (memory noted).

**BUILT (4475c50 + harness fix c08acee), verified on live:** `feeLaw.waiverRows()` (mandate rows per ground
the state's waiver item names; TX both, generic fallback; new `discretionary` chip; cost-of-collection row
echoes De-minimis, single home unchanged) · `waiverState()/decideWaiver()` + `POST /api/fee-law/waiver`
(who-decides validated + written through to the approvalModules store the engine reads, with the engine's
CURRENT routing as the suggested answer; standard-wording ack; the 5 `decision_reasons` sentences viewable) ·
FeeLawPage retitled with both sections · hub: `waiver_policy` gone (compliance lane 12 → 11, 36 items),
`fee_law` → "Fee rules", evidence appends "waivers: X of 2 decided" · RequestRulesPage lane indexes follow.
SPEC_setup_hub §3 amended + §7 F2; WORKING §2h. Harness lesson worth keeping: verify_fee_law's write-through
residue broke verify_approval_modules (runs LATER in suite order, asserts the shipped default) — snapshot/
restore added; pair green in suite order 91/91.

**Full suite: 2664/2665, live untouched** — the one red is the SAME deferred `verify_bw9_golive` E1a
(needs fee schedule v1; unchanged since 2026-08-26). Live state otherwise unchanged from the morning
handoff: clarification still switched off, fee schedule v1 unapproved, two law-updates proposals pending.

**Open:** fee-waiver Content-tab pruning build (§2g canvas — negative-finding records land in the research
pipeline; "no waiver" as configured; window card from template figures vs reconciler fill) · fee_waiver
profile section still attests on jurisdiction-config (fold-into-fees pending) · the §6↔fee-law mandate-row
work is DONE via F2. **NEXT:** Kevin's walk-through (clarification switch, waiver choices, fee schedule v1 —
which also unblocks the smoke's estimate beat and the E1a revisit) · then the Content-tab pruning slice or
the letter-template / redaction-library slices.

## 2026-08-29 — no build: walk-through decision brief for Kevin (live state re-verified, unchanged)

**Kevin's call:** no slice this session — support the walk-through instead.

**Live re-probed (read-only, node pg scripts):** nothing moved since 2026-08-27 — clarification
still off (`clarification_screen` domain absent, policy `enabled:false`), waiver choices 0/2,
fee schedule versionless (13 deferrals undecided, 2 gaps defaulted), the two 2026-08-26 TX
template merge proposals (`prop-1471997e` fee, `prop-f280e725` template_import) still pending in
`config_proposals`. Confirmed in code: `feeLaw.approve` refuses while any deferral is blank
(422 UNDECIDED) and bounds-checks against state law before minting v1.

**Delivered:** decision brief artifact
https://claude.ai/code/artifact/2b89ea16-4edd-4683-8ae9-fc54554a51a8 — every decision in walk
order (27 acts across 5 stops + the 2 proposals), each with the screen's own label, suggested
answer, and plain-language consequence; data pulled from the live `requestRules.screen()` /
`feeLaw.screen()` readers on 2026-08-29 so it matches the screens exactly. Link handed via
`~/exchange/WALKTHROUGH_BRIEF_2026-08-29.md` (built-screen screenshots deliberately not included,
per the exchange-folder rule). Notable for the walk: the ONE choice with no suggested default is
the denial-letter send deadline (TX silent — needs a number from Kevin); the two actual-cost
deferrals (specialty reproduction, delivery) can't take "none".

**No code, no config, no DB writes. Suite not run (nothing changed).**

**NEXT:** unchanged — Kevin walks the screens (the brief is the map); fee schedule v1 + proposal
review then unblock the smoke's estimate beat and the E1a revisit; after that the Content-tab
pruning slice or the letter-template / redaction-library slices.

## 2026-08-29 (later) — F3 BUILT: Fee rules absorbs the deposit & payment clock; suite 2673/2674 (E1a deferred)

**Session arc:** Kevin verified the F2 waiver migration against TX_RULES_READABLE (§6 complete — his "3+3"
count was §5's, the very section he pointed at next) → canvas mockup approved
(docs/mockups/fee_law_payment_clock/, second-pass fixes dd96c4c) → built same session.

**Kevin's calls:** same F2 treatment (no new tab, `deposits` hub row RETIRED, compliance lane 11 → 10) ·
MASTER SWITCH + individual confirms (the clarification pattern — these settings stop clocks and withdraw
requests) · canvas before code.

**Built (5c45a7f + test fix 6a51b69):** `feeLaw.clockPrefills()` parses the state's six answers from the
SAME template items the mandate rows render (TX: toll_and_restart · 10 business days · withdraw · yes ×3;
32/32 templates parse, 4 carry a clock-effect answer — elsewhere open choices, and OFF is itself the
configured, attestable posture) · `clockState()`/`decideClock()` + `POST /api/fee-law/clock` ({enabled} and
{confirm:{key,value}}, strict policy validation, write-through to the `payment` domain the engine reads
with importer provenance untouched, who/when in `fee_schedule_decisions.clock`) · FeeLawPage: estimates
group retitled "…and their clocks", switch block + six confirm rows, tab badge counts the clock when on,
Attest gate extends (clock off OR 6 confirmed) · hub: `deposits` row deleted, fee_law evidence appends
"payment clock: off｜X of 6 confirmed" · RequestRulesPage lane indexes 4/5/6 of 10. SPEC_setup_hub §3 + §7
F3 in the build commit; WORKING §2i (ce04e97). Verified live read-only (clock payload, hub 10 rows,
evidence line) + authenticated screenshot of the off-state city tab (matches the canvas; the ON state is
exercised only in the test DB — flipping live is Kevin's act).

**Suite: full run 2672/2674 with TWO reds → the deferred `verify_bw9_golive` E1a (unchanged) and MY miss:
verify_setup_hub B3 sums header counts to 36 and only A2 had been updated. Fixed (35), harness re-run
through the runner: 22/22, live clean. Net suite state: 2673/2674, the one red is E1a.** Live census clean
on both runs.

**Open (F3 residue, both noted in the spec):** the `payment` profile section still attests on
jurisdiction-config (same fold-pending class as fee_waiver's) · grace-days provenance mismatch (importer
filed § 552.221(e)/TX-S05 where the answer is § 552.263(f)'s 10 business days) goes to the research
pipeline alongside the negative-finding records.

**NEXT:** Kevin's walk-through now includes the clock switch + six confirms (decision brief artifact from
this morning still current otherwise) · fee schedule v1 + proposals still unblock the smoke estimate beat
and the E1a revisit · then Content-tab pruning or letter-template / redaction-library slices.

## 2026-08-29 (later still) — A1 BUILT: attestation fold into the absorbing screens; suite 2677/2678 (E1a the only red)

**Session arc after F3:** Kevin asked for the request-rules verification (all three tabs 1:1 against the
readable doc — clarification 4+5, exemptions 10+4, eligibility 4+dims; old /clarification-policy page
already gone) → the surviving residue was the SPLIT ATTESTATION (hub done-mark forced rows ready while the
profile sections — the automation gates — stayed un-attested) → Kevin: "fold those section attestations
into their absorbing screens."

**Built (33b9aff):** ITEMS rows carry `foldSections` (clarification/exemption/eligibility on the
request-rules rows; fees + fee_waiver + payment on fee_law). `POST /setup-hub/:key/done` attests each
configured folded section FIRST (real refusal → 422 ATTEST_REFUSED in words, no mark; not_configured →
SKIPPED, so `payment` with the clock off stays un-attested and the enabled+attested automation gate never
half-arms); DELETE unmarks + un-attests. `jurisdictionProfile` sections expose `foldedInto
{item,name,door}`; stale editor strings now point at the absorbing doors. Jurisdiction-config's attest
rail for folded sections = pointer + door (drift/provenance still shown; verified by authenticated
screenshot). `/jurisdiction-profile/attest` route unchanged (mechanism + permission-scope tests live
there). SPEC_setup_hub §7 A1 in the build commit.

**The debugging lesson that cost an hour (now in CLAUDE.md):** the test DB is built from
`src/db/seed_fixture.sql`, NOT cloned from live — the fixture ships the payment domain with the old
`legal-research-seed` researched values where live holds defaults. verify_fee_law's G tests assumed
live-shaped state and only passed in full-suite order; made ORDER-PROOF (reset to shipped defaults at G
start, provenance kept; cleanup verified byte-for-byte against the snapshot). CLAUDE.md's "clone of live"
line corrected. Live's payment domain confirmed untouched throughout (Kevin's 2026-08-25 import stamp).

**Suite: full run 2677/2678, live clean — the one red is the deferred verify_bw9_golive E1a (unchanged
since 2026-08-26).** Fold-touched harnesses inside the run: fee_law 42/42 · request_rules 30/30 ·
setup_hub 22/22 · user_types 77/77 · deposit_clock 35/35 · reissue 24/24 · both e2e walks green.

**NEXT:** Kevin's walk-through — now the screens' Attest buttons are the real section sign-offs, so the
walk covers everything (clarification switch + 5 confirms + attest · exemptions 4 + attest · eligibility
gate + attest · fee rules: 13 figures + approve v1 + 2 waiver + clock switch/6 confirms + attest — which
attests fees/fee_waiver/payment in one act) · the two pending proposals · then E1a revisit, Content-tab
pruning, or letter-template / redaction-library slices.

## 2026-08-29 (third slice) — D1 BUILT: deadlines & tolling as the request-rules 4th tab; suite 2686/2687 (E1a the only red)

**Kevin's calls:** deadlines migrates next, as a 4TH TAB on /setup/request-rules · canvas approved before
build (docs/mockups/request_rules_deadlines/ →
https://claude.ai/code/artifact/405783ad-e235-474d-b09a-3fd1b945c227; second-pass fixes ac7aecc).

**Built (9a56312), verified live + screenshot:** `TAB_CONCEPTS.deadlines = ['production','response']`
(exactly READABLE §3's four rules) · `ruleEditors.timerTable` exported and re-served as the tab's clock
table — 5 statutory clocks as law rows (citations, toll lists, primary marker), § 552.233 suspension as
the honest unlanded line · legal-gated writes: `POST /request-rules/deadlines/target` (operational-target
clocks ONLY — `clockMatrix.kindOf` polices; a statutory clock refuses in words, proposal path) and
`POST /request-rules/deadlines/holidays` (one-act US-federal 2026-27 load onto an EMPTY calendar; a loaded
one refuses 409) · hub deadlines row stays, door → `?tab=deadlines`, A1 fold covers it (`foldSections:
['deadlines']`, legal gate) · frontend 4th tab + red calendar pill; Attest waits only on the holiday
calendar (blank service targets are a valid posture). SPEC_setup_hub §7 D1 in the build commit.

**THE FINDING Kevin should act on during his walk:** live's holiday calendar is EMPTY while every
statutory clock counts business days — deadlines currently land EARLIER than the law requires. The tab's
"Load the US federal set" button is the one-act fix (and now gates Attest of the tab).

**Suite: 2686/2687, live clean — the one red is the deferred verify_bw9_golive E1a (unchanged since
2026-08-26).** Touched harnesses: request_rules 39/39 (DL1–DL9 new, fixture-proof from the start) ·
deadline_rules 25/25 · clock_matrix 54/54 · setup_hub 22/22 · fee_law 42/42.

**Migration scoreboard after today:** request-rules screen owns clarification · exemptions · eligibility ·
deadlines (4 tabs, law 1:1 vs the readable doc); Fee rules owns fees + waivers + deposit/payment clock;
the A1 fold makes every one of those screens' Attest the real section sign-off. Still on
jurisdiction-config: identity, redaction, taxonomy + the template sections (intake, branches, disposition,
ledger, template_import) — each with its own surface or pending slice.

**NEXT:** Kevin's walk-through (now including the holiday-calendar load and the deadlines attest) · fee
schedule v1 + the two pending proposals unblock the smoke estimate beat and the E1a revisit · then
Content-tab pruning or the letter-template / redaction-library slices.

## 2026-08-29 (fourth slice) — I1 BUILT: "Request Intake" 5th tab + the identity fold; suite 2696/2697 (E1a the only red)

**Kevin's calls:** north star = ELIMINATE the jurisdiction-config screen (hub → purpose-built screens →
mark complete; keep it simple during the rebuild) · intake verified un-migrated → 5th tab on
/setup/request-rules, title **"Request Intake"** (his call, mid-canvas) · the identity fold rides in the
same pass · canvas approved before build (docs/mockups/request_rules_intake/ →
https://claude.ai/code/artifact/4a013e52-7194-4e29-a350-b911e1868743).

**Built (ac4eadb), verified live + screenshot:** `TAB_CONCEPTS.intake = ['intake','custody']` (READABLE
§10's TX-0005/0006 exactly) · designated-addresses card reads the AGENCY config (no second place to type
them; TX-0006 rendered as what it legally means) · three confirms via `POST /request-rules/intake/confirm`
riding goLive.confirm on each knob's HOME domain — channels Master.g1 + acknowledgment Master.g4 (intake),
estimate-capture Master.p3 (FEE domain, write-through single home; it was ALREADY confirmed by Kevin
2026-08-25, so the tab opens 1 of 3) · new hub row "Request Intake" (compliance 10 → 11, 36 items,
foldSections intake) · law-named channels get a display-only "(law)" marker derived from the loaded rule
text. **Identity fold:** agency item foldSections ['identity'] (its Attest signs the identity section;
gate deliberately the agency groups), jurisdiction row door → /setup/agency, readiness from the same act.
**Stowaway retired:** stateTemplateImport gains KNOB_SKIP (Master.bv — covered, deliberately unwritten;
single home the clarification tab); the LIVE intake-domain copy removed by a guarded migration write
(actor 'I1 migration…', refuses if the knob carries a recorded decision) — the one deliberate live config
write this session, Kevin-approved on the canvas.

**Suite: 2696/2697, live census clean — the one red is the deferred verify_bw9_golive E1a.** Touched:
request_rules 47/47 (IN1–IN8) · agency_setup 20/20 (C5a/C5b) · setup_hub 22/22 (36 items, [11,8,5,4,7]) ·
fee_law 42/42 · config_integrity, fresh_install, bw9b all green. SPEC_setup_hub §3 + §7 I1.

**Migration scoreboard:** request-rules screen = clarification · exemptions · eligibility · deadlines ·
Request Intake (5 tabs) · Fee rules = fees + waivers + deposit/payment clock · agency screen = identity ·
every screen's Attest is the real section sign-off (A1 fold). **Left on jurisdiction-config: REDACTION
(Kevin: "going to take a lot of planning" — its own future slice) + the go-live flip.** The taxonomy and
the template roll-up sections have their own surfaces (Taxonomy page; city_choices row).

**NEXT:** Kevin's walk-through (brief + clock switch + holiday load + tab attests + waiver choices + fee
schedule v1 + the two proposals) · then redaction planning, or the Content-tab pruning / letter-template
slices.

## 2026-08-29 (closing) — cleanup batch C1–C7; suite 2696/2697 (E1a the only red); redaction DEFERRED to next session

**Kevin's closing calls:** redaction planning waits for next session · seven cleanup items, then end.

**The batch (each verified live + screenshot, committed at green):**
- **C1 (5cdc888):** the `jurisdiction` hub row ("Which state's law this city follows") DELETED — the agency
  card is the one identity surface; its nine dependents rewired to `agency` (fields complete AND state
  locked). Compliance lane 10.
- **C2 (9663574):** ONE email home — new `/setup/email` "Email configuration" screen (provider toggle,
  credentials, sender identity, test send, + the v1 tab's new-request alert recipient) behind the renamed
  hub row; Integrations keeps AI keys only; the v1 Configuration "Email" tab retired (H4's second-email-
  editor collision closed).
- **C3 (6b2211d):** "Integrations & API Keys" admin nav tab removed; screen retitled "AI Service Keys";
  reached via its hub row (hidden-but-routable).
- **C4 (2a8b69c):** "Fee Configuration" admin nav tab removed; the hub's fee_rates row stays the one door
  (rate-table edits still live there per F1 — full migration into Fee rules is future work).
- **C5 (eed1f60):** the dead "Fees & Deadlines" Configuration tab DELETED — its four deadline_* fields had
  ZERO readers (deadline_date comes from the jurisdiction deadline domain via tolling; the 77-day-clock
  class of shadow config) and were never saved on live; the reader-less keys (deadline_*, fee_threshold,
  cost_per_page, labor_rate) dropped from POST /config. H4's deadline-day-counts collision closed.
- **C6 (8a9f8fa):** "User Types" admin nav tab removed; the catalog (informational except renaming a
  type's display name) opens from "View user types" on the Organization Staff tab.
- **C7 (66963e4):** new SIXTH hub lane **"System Features and Options"** (operations_config) — the
  fulfillment lane's "Record types and categories" row moved in renamed **"Taxonomy"** (same key: the
  calibration dep and counted evidence carry over); the admin Taxonomy nav tab retired. Hub lanes
  [10,7,5,4,7,1], still 35 items; SPEC §2 lanes table updated.

**Pattern for all hidden tabs:** the TABS entry gets `hidden: true` — out of the nav, deep link stays
routable (hub doors, section editors, bookmarks), the retired-jurisdiction-tab precedent. Admin strip is
now: Setup · Configuration · Update Configuration · Workflow · Process Map · Sources · Redaction Rules ·
AI Data Flow · Portal Agent Security (Taxonomy/User Types/Fee Config/Integrations hidden).

**Suite: 2696/2697, live census clean — the one red is the deferred verify_bw9_golive E1a (unchanged since
2026-08-26; waits on fee schedule v1 + real proposal data).** setup_hub 22/22 (six lanes) · agency_setup
20/20 · fee_law 42/42 · request_rules 47/47 · fresh_install 26/26.

**Where the rebuild stands after today (4 build slices + the fold + 7 cleanups):** the hub is the one
front door; request-rules (5 tabs) + Fee rules + agency + Email configuration are the purpose-built
screens; every screen's Attest is the real section sign-off; jurisdiction-config's remaining rules-engine
content is REDACTION only (+ the go-live flip). **NEXT SESSION: redaction planning (Kevin: "going to take
a lot of planning").** Kevin's walk-through remains the critical path for E1a and the smoke's estimate
beat (decision brief + clock switch + holiday-calendar load + tab attests + waiver choices + fee schedule
v1 + the two pending proposals).

## 2026-08-30 — cleanup C8–C9: the two fee rows retired from the hub; the v1 Fee Configuration screen deleted; suite 2696/2697 (E1a the only red)

**Kevin's calls:** more cleanup before redaction migrates. C8: the fulfillment lane's top two rows —
"What this city actually charges" (the old screen's pre-migration name; its door loaded blank) and "Try a
test estimate" (a tab on Fee rules) — DELETED. C9: the blank v1 Fee Configuration screen itself RETIRED.

- **C8 (caa74ba):** `fee_rates` + `fee_test` rows gone; `settlement` waits on `fee_law`; the fee_test
  reader survives as `setupHub.testEstimateStatus`, attached to `GET /fee-law` as `testStatus` for the
  "Test an estimate" tab's badge (FeeLawPage no longer scans the hub for it). Hub 33 items, lanes
  [10,5,5,4,7,1]. SPEC §2/§3 updated.
- **runner (de6bc61):** a harness that "did not complete" now prints its
  last 30 lines, not 4 — the first C8 run's `verify_magic_reset` crash tail was just `}` and the Node
  version; the single-harness rerun (`node tests/run_suite.js verify_magic_reset`, the supported way)
  passed 29/29, so it was transient in the slow tail. Cause not identified.
- **C9 (this commit):** `FeeConfigPage.js` deleted, the hidden `fees` admin tab removed; `/fee-config`
  and `/admin?tab=fees` redirect to `/setup/fee-law` (the retired-jurisdiction-tab precedent); the old
  wizard's Fees phase link points at Fee rules. Graduated page bands (the one thing only the rate table
  edited) are API-only (`PUT /api/fee-profiles/:id`) until they get a Fee rules surface — noted on F1.

**Suite: 2696/2697 twice today (C8 run + C9 run), live census clean — the one red is the deferred
verify_bw9_golive E1a (unchanged).** Screenshots: hub lane 2a at 5 rows, counts sum to 33; both redirects
land on Fee rules; "Fee Configuration" absent from the admin strip.

**Memory fix:** the screenshot helper's admin lookup — `user_function_roles` no longer exists; use
`user_user_types` → `user_types.key IN ('oro_director','oro_sysadmin')`.

**NEXT:** Kevin names further cleanup items, or redaction planning begins. Kevin's walk-through remains
the E1a critical path.

## 2026-08-30 (later) — C10: "User Authentication Setup" rename; the admin "Configuration" nav tab hidden; suite 2696/2697 (E1a the only red)

**Kevin's calls:** rename the `auth_policy` hub row "How staff sign in" → **"User Authentication Setup"**;
the admin "Configuration" nav tab opened the same screen (ConfigurationPage, defaulting to its
Authentication section) → tab hidden (`hidden: true`, the C3–C6 pattern; `?tab=config` stays routable).
Admin strip is now: Setup · Update Configuration · Workflow · Process Map · Sources · Redaction Rules ·
AI Data Flow · Portal Agent Security. SPEC §2 lane-4 row notes it.

**Still dooring to `/admin?tab=config` (the v1 Configuration page):** the fulfillment lane's
`time_budgets` (Task Time Budgets section), `time_tracking` (Time Tracking) and `notifications`
(Notifications) rows, plus `auth_policy` itself — none deep-links to its section (the page opens on
Authentication). **Kevin: work through those three one at a time next.** ConfigurationPage also still
carries Redaction and Agent Rules sections.

**Suite: 2696/2697, live census clean — the one red is the deferred verify_bw9_golive E1a (unchanged).**

## 2026-08-30 (C11) — the v1 Configuration page RETIRED: six dedicated /setup screens; suite 2700/2701 (E1a the only red)

**Kevin's calls (verbatim intent):** every Configuration tab becomes its own screen behind a hub row, not a
tab. Time Tracking → **"Task Processing Time Capture"** under System Features and Options · Redaction → NEW
row **"Video Redaction Options"** · Notifications → **"System Notifications"** under System Features and
Options · Task Time Budgets → System Features and Options (name kept) · Agent Rules → System Features and
Options · Authentication → its own screen behind "User Authentication Setup" (Technical Setup).

**Built:** `components/setup/SetupScreen.js` — the shared strip (state pill → hub, evidence, lane, Attest =
the row's done-mark) lifted from the email screen; six pages on it: `/setup/authentication`,
`/setup/notifications`, `/setup/video-redaction`, `/setup/time-capture`, `/setup/time-budgets`,
`/setup/agent-rules`. `ConfigurationPage.js` DELETED; `/config` and `/admin?tab=config` land on the hub.
Hub: 34 items, lanes [10,2,6,4,6,5] — the fulfillment-fees lane is down to calibration + routing.

**Calls I made (flag for Kevin):** (1) "Video Redaction Options" sits in the **Redaction and Release** lane
(Kevin named a lane for every other row but not this one; the redaction lane is where it belongs — move it
to features with a one-line catalog edit if he prefers). (2) The agent-rules row is named **"Portal Agent
Rules"** (no name given). Note the old `agent_rules` row doored to the Portal Agent Security tab while its
reader counted `agent_rules` rows — the two were never the same thing; the security tab now has no hub row.
(3) `POST /api/config` was system-authority for every key, so a Director (operations_config) owning the
notifications/redaction rows would have hit 403 — the four operational keys (`overdue_alert_days`,
`escalation_days`, `ack_email`, `av_redaction_mode`) now accept operations_config; the rest unchanged.
(4) **Bug fixed in passing:** `av_redaction_mode` is read by `routes/avRedaction.js` but was never in the
POST allow-list — the v1 Redaction tab's Save silently dropped it (live still holds the seed `internal`).
(5) The `time_tracking` reader read a config key nothing ever wrote; it now reads the real per-screen
time-capture setting. (6) `auth_policy` evidence said "minute timeout" for an `8h` value — wording fixed.

**Tests:** verify_setup_hub 26/26 (+G1–G4: the config gating), verify_agency_setup D2 now asserts the
ConfigurationPage file is GONE. **Suite: full run 2671 passed / E1a / `verify_magic_reset` did not complete;
the single-harness rerun 29/29 → 2700/2701, live census clean every run.** `verify_magic_reset` crashed in
3 of 5 runs today (a dumped pg Client with `_ending: true` while `_connecting: true` — the harness's own
pool across the DB swap, section D), never twice in a row, never on the C10 tree's run; it does not touch
anything C11 changed. Runner now prints a broken harness's last 30 lines + its error lines, and
`SUITE_DUMP_DIR=<dir>` keeps the whole output — the next crash will name its line.

**Seen on live, not mine:** the time_budgets row shows "marked done by Kevin Hargrove, 2026-08-30".

**NEXT (in flight):** C12 — AI Service Keys gets the same treatment (`/setup/ai-keys`; the hidden
Integrations tab retired). Then the remaining hidden admin tabs (Taxonomy, User Types, Portal Agent
Security's status) and the "How many days a task should take" design pass Kevin deferred.

## 2026-08-30 (C12) — "AI configuration": one hub row, one screen, three tabs; suite 2700/2701 (E1a the only red)

**Kevin's call (supersedes the interim plan of a standalone AI Service Keys screen):** the Technical Setup
lane's "AI Service Keys" and "AI Data Flow and Compliance" items become ONE item, **"AI configuration"**,
opening a screen with three tabs — **AI Service Keys** (the retired IntegrationsPage) · **Deployment Model**
(the AI Data Flow page's "Deployment profile" section, renamed) · **AI Touchpoints Information** (that page's
touchpoint inventory, routed under the selected model). The AI Data Flow admin tab deleted.

**Built:** `pages/AiConfigurationPage.js` (`/setup/ai-configuration?tab=keys|deployment|touchpoints`, on the
shared SetupScreen strip); hub rows `ai_keys` + `ai_deployment` MERGED into `ai_config` with one reader
("both keys set · government deployment model" etc.); `IntegrationsPage.js` and `AIDataFlowPage.js`
DELETED; `/integrations`, `/ai-data-flow`, `?tab=integrations`, `?tab=ai-data` redirect to the right tab.
Hub: 33 items, lanes [10,2,6,4,5,5]. Admin strip now: Setup · Update Configuration · Workflow · Process
Map · Sources · Redaction Rules · Portal Agent Security (hidden: Taxonomy, User Types).

**Suite: 2700/2701, live census clean — the one red is the deferred verify_bw9_golive E1a (unchanged);
`verify_magic_reset` completed this run.** verify_setup_hub 26/26 (the mark test now uses `ai_config`).

**NEXT:** Kevin's remaining cleanup calls (the hidden Taxonomy / User Types tabs; whether Portal Agent
Security wants a hub row now that `agent_rules` is its own screen) · the "How many days a task should take"
design pass he deferred · then redaction planning.

## 2026-08-30 (C13–C14) — Portal Agent Security folded into AI configuration; "Record Sources and Connectors" screen; suite 2701/2702 (E1a the only red)

- **C13 (Kevin):** the Portal Agent Security admin page was informational quick-reference → it is now the AI
  configuration screen's FOURTH tab, **"AI Portal Security Information"** (`components/setup/PortalSecurityInfo.js`,
  the page body without its title). Tab deleted; `/portal-security` and `?tab=security` redirect. Fixed in
  passing: 27 `\uXXXX` escapes sat in JSX text (✓ ↓ ✕ → rendered literally — inherited from v1); real
  characters now. Zones tightened to fit the 860px setup width.
- **C14 (Kevin):** hub row `sources` renamed **"Record Sources and Connectors"** (was "Where the records
  live"), dooring to its own screen `/setup/record-sources` (`RecordSourcesPage` = the SetupScreen strip
  around the unchanged `SourcesConfig`). The admin Sources tab deleted; `/sources` and `?tab=sources`
  redirect; the old wizard's link repointed.

**Admin strip now:** Setup · Update Configuration · Workflow · Process Map · Redaction Rules (hidden:
Taxonomy, User Types). Hub still 33 items, lanes [10,2,6,4,5,5].

**Suite: 2701/2702, live census clean — the one red is the deferred verify_bw9_golive E1a (unchanged).**
(The C13-only run before the escape fix was 2700/2701 on the same red; `verify_magic_reset` completed both.)

**NEXT:** Kevin's remaining cleanup calls (Update Configuration / Workflow / Process Map / Redaction Rules
tabs; the hidden Taxonomy and User Types tabs) · the "How many days a task should take" design pass ·
then redaction planning.

## 2026-08-30 (C15) — Workflow and Process Map tabs → dedicated screens in the fulfillment lane; suite 2701/2702 (E1a the only red)

**Kevin's call:** migrate the admin Workflow and Process Map tabs; both become items in "Request
Fulfillment Process Setup — Fees, Estimates and Routing" (he will rename that lane once its contents settle).

**Built:** `WorkflowPage.js` and `WorkflowMapPage.js` keep their file names (verify_stages lints
`pages/WorkflowPage.js` by path) but now wear the SetupScreen strip (new optional `maxWidth` prop for the
wide map) at `/setup/workflow-rules` and `/setup/process-map`. Hub: `routing_rules` renamed **"Workflow
Rules"** (it already WAS the workflow item — its reader counts `workflow_rules`; I renamed rather than add a
duplicate beside "Who gets which request" — flag for Kevin) and re-doored; `process_map` **"Process Map"**
ADDED with an informational reader ("55 decision points · 21 built · 12 partial · 22 planned"). Tabs deleted;
`/workflow`, `/workflow-map`, `?tab=workflow`, `?tab=map` redirect. Hub 34 items, lanes [10,3,6,4,5,5].

**Admin strip now:** Setup · Update Configuration · Redaction Rules (hidden: Taxonomy, User Types).

**Suite: 2701/2702, live census clean — the one red is the deferred verify_bw9_golive E1a (unchanged).**

**NEXT:** Update Configuration and Redaction Rules tabs; the hidden Taxonomy / User Types tabs; the lane
rename; the "How many days a task should take" design pass; then redaction planning.

## 2026-08-30 (C16) — Update Configuration and Redaction Rules Library → dedicated screens; the admin strip is down to Setup; suite 2701/2702 (E1a the only red)

**Kevin's call:** the hub rows already existed — migrate each tab's content to its own screen behind its
row; rename "Keeping up with changes in the law" → **"Update Configuration"** (the tab's name).

**Built:** `RuleUpdatesPage.js` → `/setup/update-configuration` and `RedactionRulesPage.js` →
`/setup/redaction-rules`, both wearing the SetupScreen strip (bodies unchanged; the library's action
buttons became a right-aligned bar under the intro). Tabs deleted; `/rule-updates`, `/redaction-rules`,
`?tab=updates`, `?tab=redaction` redirect. In-app links repointed: jurisdiction-config's "Open the review
queue", request-rules' library link, `ruleEditors.areaEditor`, `jurisdictionProfile` redaction editor, the
old wizard's link. Hub still 34 items.

**Admin strip now: Setup only** (hidden-but-routable: Taxonomy, User Types). The Administration page is
effectively the hub.

**Incident (mine, ~2 min):** the first wrap of RuleUpdatesPage closed the wrong function (the file holds a
second component, ReviewModal); the CRA build failed and — because CRA empties `build/` first — nginx served
403 until the fix + rebuild. Memory updated: build into `BUILD_PATH=build-next` and swap on success.

**Suite: 2701/2702, live census clean — the one red is the deferred verify_bw9_golive E1a (unchanged).**

**NEXT:** the hidden Taxonomy / User Types tabs; the fulfillment lane rename; the "How many days a task
should take" design pass; then redaction planning.

## 2026-08-30 (C17) — Taxonomy and User Types → dedicated screens; the Administration tab strip is GONE; suite 2701/2702 (E1a the only red)

**Kevin's call:** the straightforward version — Taxonomy and User Types as /setup screens; the three rows
that door to Taxonomy (taxonomy, calibration, record_owners) all keep dooring there; the calibration /
record-ownership question waits for the "How many days a task should take" design pass.

**Built:** `TaxonomyPage.js` → `/setup/taxonomy` (SetupScreen strip, hub row `taxonomy`; the live "N record
types across M categories" line kept in the body); `UserTypesPage.js` → `/setup/user-types` — no hub row, so
SetupScreen gained a **rowless mode** (no `hubKey`: plain "Setup and Configuration" back pill, an optional
`note`, no state/Attest; `can` = true). The two hidden admin tabs deleted; `?tab=taxonomy`, `?tab=user-types`,
`/taxonomy` redirect; Organization → Staff "View user types" and the sidebar's **"Find Same-Format Records"**
entry (which already pointed at the Taxonomy tab — flag for Kevin if it was meant to open something else)
repointed. AdministrationPage renders its tab strip only when more than one visible tab exists — with
Setup alone, none: the Administration page IS the hub. `ruleEditors.areaEditor` stays `/taxonomy` (pinned by
verify_bw9b_editors; the redirect carries it). Build now goes through `BUILD_PATH=build-next` + swap.

**Suite: 2701/2702, live census clean — the one red is the deferred verify_bw9_golive E1a (unchanged).**

**Where the cleanup stands after C8–C17 (10 commits today):** every v1 admin tab is retired; every hub row
doors to a dedicated /setup screen wearing the shared strip (or, for the informational ones, tabs on one).
Hub 34 items, lanes [10,3,6,4,5,5].

**NEXT:** Kevin renames the fulfillment-fees lane · the "How many days a task should take" design pass
(+ calibration / record-ownership doors) · then redaction planning.

## 2026-08-30 (G1) — "Set Up Guide" tab built (Plan A gantt, live); hub tab renamed "Settings and Configuration"; the magic_reset crash ROOT-CAUSED and fixed

**Kevin's process for retiring Jurisdiction Configuration, step 1:** the gantt-style plan as a second
Administration tab. **Correction recorded:** Plan A (`docs/mockups/setup_hub/PlanGantt.dc.html`, chosen
2026-08-24) was a design canvas, never an app screen — the hub was built from its item list, not its layout.
Built now as `pages/SetupGuidePage.js` on the same `GET /api/setup-hub` payload (no second catalog): six
phases from the lanes, STEP = 1 + max(step of deps) computed live (agency 1 · no-deps 2 · go-live last),
bars coloured by counted state, one dependency trunk per source, dashed feeds from last-step leaves into
go-live, row click opens the door. Tabs: **Settings and Configuration** (the hub) · **Set Up Guide**; the
SetupScreen back-pill says "Settings and Configuration". SPEC §3a added.

**Inventory for Kevin's process (agent sweep, 2026-08-30):** what /jurisdiction-config still does that
nothing else does — (1) the go-live flip + return to dev mode (the hub's go_live row doors back to it);
(2) the propose-a-change composer (no /setup screen hosts one); (3) attest for `redaction`, `taxonomy`
(screens exist, no fold) and `branches`/`disposition`/`ledger`/`template_import` (no screen at all — their
editor was the retired /config tab; they also hold the auto-release switches and the de-minimis knob);
(4) config-integrity findings; (5) per-domain provenance; (6) the `city_choices` row's door. Loose ends:
`deadlines` has two live attest paths; AgencySetupPage links a "Regenerate from state rules" control that no
longer exists; the sidebar "Find Same-Format Records" opens the Taxonomy screen.

**verify_magic_reset — root cause, at last.** `SUITE_DUMP_DIR` caught it: "terminating connection due to
administrator command". The harness calls `magic.reset()` service-direct, so the reset's own ad-hoc pools
(benchmark / admin / build in `services/magicDemo.js`) are terminated by its OWN `pg_terminate_backend`;
an unlistened node-pg pool 'error' kills the process. `src/db`'s shared pool already guarded itself
(2026-08-14); the module's private pools did not. Fix: `quietPool()` — all four pools log-and-recover.
Evidence: 3 consecutive single-harness passes on the guarded code (29/29 ×3) after 4 crashes in 7 full
runs today. Live API restarted to load it.

**Suite for G1:** full run 2672 passed / E1a / magic_reset crashed (pre-fix) → single-harness 29/29 →
2701/2702, live census clean every run. The one red is the deferred verify_bw9_golive E1a (unchanged).

**NEXT (Kevin's process):** step 2 onward for retiring Jurisdiction Configuration — the six capabilities
above need homes (go-live flip → the hub/guide; composer placement; folds for redaction/taxonomy; the four
screenless sections; integrity + provenance surfaces). Then the fulfillment lane rename, the task-days
design pass, redaction planning.

## 2026-08-31 (overnight) — the audit Kevin asked for; see docs/AUDIT_2026-08-31.md — COMMITTED, suite 2739/2740 (E1a the only red)

**State when Kevin left:** the working tree holds ~26 uncommitted changes — the audit's fixes, the new
`tests/verify_golden_setup.js` (37/37 alone), `tests/audit/*` tools, `docs/AUDIT_2026-08-31.md`,
`docs/audit/*` (the two triage reports) and doc corrections. A detached chain
`<scratchpad>/night.sh` (pidfile `night.pid`) is finishing the route crawl → staged frontend build (swap on
success only) → full `npm test` with `SUITE_DUMP_DIR` → `night.status` / `night.log` in
`/tmp/claude-998/-opt-optimumq/94a8435b-f829-40d0-9195-9f10f6192337/scratchpad/`.

**Resolved before commit (session resumed ~05:46):** the night chain finished (crawl 495 loads / 9 flags, build swapped, suite 2713 + E1a + `verify_fresh_install` crashed reading the deleted SetupPage.js → its section C retargeted to hub doors, 26/26; golden 37/37, setup_hub 27/27, magic_reset 29/29 in the same run). Live API restarted. The checklist below is what was planned for a fresh session; it is done.

**Morning checklist (done):** (1) read `night.log` — build swapped? suite at baseline (2701+37+1 ≈ 2739/2740, E1a
the only red, LIVE UNTOUCHED)? (2) fill the two `__CRAWL_*__` placeholders and §5 in
`docs/AUDIT_2026-08-31.md` from `audit/crawl_summary.json` (`node tests/audit/crawlsum.js`); (3) restart the
live API (`kill $(pgrep -f "^node /opt/optimumq/backend/server.js")`) so the backend fixes load; (4) commit
everything as one audit commit; (5) walk Kevin through §2 (fixed), §3 (his calls — MFA, the parent/child
notices and the non-cascading auto-close sweeps are the ones that matter), and the golden harness. If the
suite is NOT at baseline, the failing harness's full output is in `failed_<harness>.log` in the scratchpad.

**What the audit found, one line:** the setup flow could not reach go-live through the screens (four
readiness mismatches, now fixed — golden harness green); the app's "not ready / won't price" on live is
otherwise DATA (Kevin's walk-through); and two families of real defects remain for Kevin: MFA is
non-functional, and 21 parent/child-invariant violations (citizen notices quote child numbers; auto-close
sweeps don't cascade).

## 2026-08-31 — parent/child HIGH defects fixed (audit §1e); suite 2758/2759 (E1a the only red)

**Kevin's call:** fix the parent/child defects first. Built: (1) `applyStageTransition` cascades a PARENT close
to every live child (own `CLOSED_CASCADE` history row, tasks cancelled, `closure_reason='cascade'`) and a
parent reopen restores only cascade-closed children to their remembered stage — the nonpayment and
no-clarification sweeps no longer leave children live with claimable tasks; (2) `requestScope.parentFacts()` +
`parentIdOf()` — the estimate panel header (number + MRR badge), the estimate / balance / adjustment notices,
the financial profile and the clarification letter read the parent's number, identity, mailing address and
waiver through the parent; (3) the fee-waiver decision is written on the PARENT whichever row was addressed
(and its task closed across the family). Misleading comments in clarificationTimeout and tickler corrected.
`tests/verify_parent_child_facts.js` (19/19; two-child request end to end) registered before golden.
SPEC_parent_child_lifecycle §6.5 records the rules and the 12 remaining MEDIUM/LOW sites.

**NEXT:** Kevin is walking through how attestation for initial setup should work (design, no build yet) ·
his live walk-through · MFA decision · the Jurisdiction Configuration retirement plan.

## 2026-08-31 — the APPROVAL MODEL (three colours) built, Agency first; Settings tab is navigation only; Go Live on the guide; suite 2765/2766 (E1a the only red)

**Kevin's design (walk-through, this session; mockup docs/mockups/setup_attestation, canvas
https://claude.ai/code/artifact/9a5d1a0f-c396-419e-8bf0-bcad83bc502c):** every setup item shows RED (a required
field is empty) · YELLOW (all saved, awaiting the lane owner's approval — or changed since approval) · GREEN
(approved). The SCREEN owns its indicator; the Set Up Guide's bars only read it. Approval = "Approve — attest as
complete" on the screen, one approver per screen (the existing group gate). A saved change to approved data
drops it to yellow automatically and notifies the approver (my improvement, Kevin accepted). Settings and
Configuration is navigation only; initial setup runs off the guide. Go Live is a button on the guide's header.

**Built:** `setupHub.js` — readers may report `required` + `digest`; `mark()` refused 422 `REQUIRED_MISSING`
while red and stores the digest; `afterChange(key, actor)` notifies lane owners once per change
(`notifications` kind `setup_reapproval`); `build()` emits `approval` / `approvalWhy` / `changedSinceApproval`
per item and page `colours` + `goLiveColour`; schema: `setup_hub_signoffs.content_hash/notified_hash`.
Agency is the first converted reader (9 required fields + the lock) and its route calls `afterChange` after
save and lock. Frontend: AgencySetupPage (required-field lines, three-colour pill, Approve/Re-approve, changed
notice); the shared `SetupScreen` strip does the same for every screen; `SetupGuidePage` bars carry the
colour + state text, Go Live button (red/yellow/green/Live, confirmation, `go_live` authority →
`POST /jurisdiction-profile/enforcement`); `SetupHubPage` rewritten as a grouped navigation list. SPEC §3d.
Tests: `verify_setup_hub` 34/34 (+H1–H7), golden 37/37 (agency save fills every required field; approval
refusal enforced end to end).

**Not yet converted (derive their colour from the counted state):** every other screen. Kevin: one at a time;
list screens (Staff, Taxonomy, Workflow Rules, Record Sources) get a "Complete — submit for approval" act
instead of required fields, then the same green→yellow-on-change rule. Next candidates in guide order:
Record Sources and Connectors, AI configuration, Email, User Authentication (forms) · Departments / Teams /
Staff (lists).

**NEXT:** convert the next screens (Kevin picks) · his live walk-through · MFA decision · Jurisdiction
Configuration retirement (the go-live flip now has its second door on the guide).

## 2026-08-31 — the LIST MODEL ("Ready for approval") built on Record Sources and Connectors; suite 2770/2771 (E1a the only red)

**Kevin's call (with my refinement, accepted):** list screens have no save button and no required fields.
RED = nothing added · YELLOW in progress = one or more items, quiet while the list grows over days/weeks ·
**"Ready for approval"** = a strip button for anyone who may edit the screen — the adder's declaration that
the list is complete, recorded by name, ONE notification to the lane owners, withdrawable, never an approval
· GREEN = the lane owner approves (clears the declaration) · any add/edit/delete after approval → YELLOW
"changed since approval" + one notification. Evidence carries health ("20 connectors · 1 not connected")
without blocking colour.

**Built:** `setupHub` — `list {count, notConnected, noun}` + `digest` on the `sources` reader; `readies()`,
`declareReady()`, `withdrawReady()`; `setup_hub_ready` table; `POST/DELETE /setup-hub/:key/ready` (mayEdit
gate; 422 NOTHING_ADDED while red, 400 ALREADY_APPROVED while green-unchanged); `routes/repositories.js` reports
every mutation through a router-level finish hook. Frontend: `SetupScreen` shows Ready for approval / Ready ·
withdraw on list screens; the guide's bar says IN PROGRESS / READY FOR APPROVAL / RE-APPROVAL / APPROVED.
SPEC §3e. `verify_setup_hub` 39/39 (+I1–I5), golden 37/37.

**NEXT:** the next guide rows (AI configuration, Email, User Authentication are forms → the Agency pattern;
Departments / Teams / Staff → this list pattern) · Kevin's live walk-through · MFA · Jurisdiction
Configuration retirement.

## 2026-08-31 — the TABBED model built on AI configuration; suite 2778/2779 (E1a the only red)

**Kevin's design:** tabs are sections of one item — each configurable tab has its own required set and colour
(tab-label mark); the screen's pill is the worst tab and names tab + field; ONE approval for the screen,
refused while any tab is red; a change on any tab after approval → yellow + one notification. Built on
AI configuration: Service Keys (Anthropic + Voyage — a key from the server environment counts, matching the
screen's "configured") · Deployment Model (a model chosen; Government adds region, Titan model, Bedrock
key + secret). `routes/integrations.js` reports ai/deployment changes to `ai_config` and email changes to
`email`. SPEC §3f. `verify_setup_hub` 46/46 (+J1–J7), golden 38/38 (configures AI before approving).
The three patterns (form / list / tabs) now cover every setup screen; conversion continues one at a time.

**NEXT:** Email configuration and User Authentication Setup (forms) · Departments / Teams / Staff (lists) ·
Kevin's live walk-through · MFA · Jurisdiction Configuration retirement.

## 2026-08-31 — Email configuration + User Authentication Setup converted (forms); suite 2787/2788 (E1a the only red)

Email: required = provider; SMTP host/port/from address or Resend key/from address (the test send stays
evidence). Auth: the four sign-in settings must be SAVED — a shipped default is not a decision; unsaved
selects are outlined red with a line saying so. `routes/config.js` reports saves to `auth_policy`, `email`
(alert address), `notifications` and `av_redaction`. Red wins the button (no "Approved · undo" beside a red
pill). `verify_setup_hub` 54/54 (+K1–K5, L1–L3; C4 configures email first; D6 uses `settlement`), golden
39/39 (+B8). SPEC §3g lists the converted screens.

**NEXT:** City departments / Fulfillment teams / Staff (list pattern) · then the compliance lane's screens
(Fee rules, Request rules tabs — the tabbed pattern with decisions as the required set) · Kevin's live
walk-through · MFA · Jurisdiction Configuration retirement.

## 2026-08-31 — City departments / Fulfillment teams / Staff on the list model; suite 2790/2791 (E1a the only red)

The three organization rows share the Organization screen (`/org?tab=departments|teams|staff`); each tab
wears the strip of its own row (SetupScreen keyed by tab). Readers report `list` + digest: departments (≥1),
teams (health: departments with no team to serve them), staff (health: people with no user type).
`routes/departments.js` (reports departments + teams) and `routes/staff.js` carry finish hooks. Hub harness
57/57 (+M1–M3: supervisor declares departments ready, Director approves, an added department re-opens it with
one notification), golden 39/39, user-types 77/77. SPEC §3g.

**Converted so far (8):** Agency · Record Sources · AI configuration · Email · User Authentication ·
Departments · Teams · Staff. **NEXT:** the compliance lane — Fee rules and the Request rules tabs (decisions
as the required set; the tabbed pattern), Redaction rules library (list), Update Configuration; then
Taxonomy / Workflow Rules / Process Map and the features lane.

## 2026-08-31 — the compliance lane on the decision model (Fee rules + the five Request rules tabs); suite 2791/2792 (E1a the only red)

Decisions are the required set. `sectionRequired(sec)` turns a section's unconfirmed local policy settings
into the row's missing list + a digest — clarification, exemptions, eligibility, intake, deadlines converted
in one move (each tab of Request rules wears its own row's pill and a colour mark). `fee_law` requires exactly
what its screen offers: every deferral decided, both waiver choices, the clock's six when on, an APPROVED
schedule version (the City decisions tab carries the mark); the fees/fee_waiver/payment section knobs the
screen does not surface stay go-live's concern (audit §3-E). Hooks: `routes/feeLaw.js`, `routes/requestRules.js`
(path → item), `policy-settings/confirm` (domain → item). Long missing lists name six and count the rest.
Harness adaptations: fee_law E3 now asserts the refusal while waivers are undecided, decides them, approves,
restores; hub D4 accepts 422-for-readiness as "allowed". Hub 57/57, fee-law 43/43, request-rules 47/47,
golden 39/39. The suite's census flagged one live `request_history` row — Kevin sending a clarification at
12:15, a person on the app, not the run.

**Converted (14):** Agency · Record Sources · AI configuration · Email · Authentication · Departments · Teams
· Staff · Fee rules · Clarification · Exemptions · Eligibility · Intake · Deadlines. **Remaining (derived
colours):** Redaction rules library (list), Update Configuration, Choices the statute left to the city
(→ Jurisdiction Configuration retirement), Taxonomy / calibration / record owners, Workflow Rules, Process Map,
the features lane's screens, and the no-screen rows.

## 2026-08-30 — forms submit themselves (setup_ready on the completing save); STAFF ALERTS screen (§3i); hub 65/65, golden 41/41

**Slice 1 (`27ad3a7`):** a form/tabbed screen's save that fills the LAST required field is the submission —
`afterChange` records it in `setup_hub_ready` under the saver's name and sends the lane owners one `setup_ready`
notice; re-armed if the screen goes red again; approval clears it. Guide text: "submitted by <who>, approver
notified". `emit()` dedupes per user/kind/context while undismissed (harness had to clear C4's leftovers). §3g′.

**Slice 2 (this commit):** Kevin: "System Notifications" was mislabelled and nothing listed the bell's alerts.
Ruling — split by AUDIENCE: requestor correspondence stays under Request rules; **Staff Alerts** (renamed row +
screen, `/setup/staff-alerts`, old URL redirects) = Alerts tab (catalogue from `services/alertCatalog.js`,
`GET /setup-hub/alerts`, read-only, no per-alert toggles — Kevin: not for now) + Deadline alerts tab (overdue +
escalation, both saved; tabbed pattern). `ack_email` moved to Request rules → Request Intake as a counted intake
decision, writable alone by compliance/legal. Mockup approved: canvas
https://claude.ai/code/artifact/30c3dc52-f312-4785-bc6b-934f2f7c891e. Verified by screenshot (both tabs, the
red marks, the redirect). Hub 65/65 (+N1–N4), golden 41/41 (+D5b/D5c), request-rules 47/47; config_integrity
17/17 alone (it reads 15/17 if golden runs BEFORE it in a subset — golden is last in the real suite; not a bug).

**Open for Kevin:** the Intake tab already has "The acknowledgment, and when it goes out" (`Master.g4`) — should
the on/off fold into it as a "Do not send" option instead of the separate switch beneath the three choices?
Also still pending his answer: the parallel Opus agent (worktree, handoff order, harness runs gated through me).

**Converted (15):** + Staff Alerts. **NEXT:** Redaction rules library (list) · Update Configuration · Taxonomy /
Workflow Rules / Process Map · features lane · full suite run.

## 2026-08-30 — the acknowledgement on/off folded into Master.g4 (ack_email retired); hub 64/64, request-rules 48/48

Kevin: fold it. `Master.g4` already offered "No automatic acknowledgment", so the separate switch was a duplicate
decision. `requestCreate.acknowledgementOn()` (exported) reads the intake domain: send unless `no_auto` is
CONFIRMED. Removed: the intake reader's extra requirement, the Intake-tab toggle, `ack_email` from `/config`
(allow-list + operational keys + the compliance carve-out); hub G1 now uses `overdue_alert_days`. Harness order
lesson (cost 20 min): `verify_request_rules` DL1/DL4/DL5 need the state LOCKED (7 clocks come from the state
load) — run it after `verify_agency_setup` as the suite does; alone or after only `verify_setup_hub` it reads
2 clocks and fails. Not a bug. Ran in suite order: hub 64/64, agency 20/20, fee-law 43/43, request-rules 48/48.
The Opus agent (worktree `.claude/worktrees/agent-*`, branch `worktree-agent-*`) has committed Redaction rules
library on the list model; it continues down the handoff order; merge + build + harness runs happen here.
## 2026-08-31 — the conversion finished: every setup screen is on the approval model (worktree, NOT suite-run)

Ten more screens converted in ten commits on branch `worktree-agent-a5d22d1a013755919`, following §3h to the
letter. **Redaction rules library** (list — approved AND in effect is the count, waiting-for-approval is
health; legal_rules declares and approves) · **Update Configuration** (form — the review queue EMPTY plus the
two reminder settings saved; a proposal arriving after approval re-opens the row RED) · **Taxonomy /
calibration / record ownership** (three list rows sharing one body, the door's `?tab=` picks which row the
strip signs off) · **Workflow Rules** (list — enabled rules count, switched-off ones are health) · **Process
Map** (the new §3j ACKNOWLEDGEMENT pattern: an empty required set, so yellow until someone says they read it —
it used to read green before anyone had opened it) · **Task time budgets** (form — a seeded figure is not a
decision; the required set is the screen's own "provisional default, not yet reviewed") · **Task Processing
Time Capture** (form — off everywhere is a decision only once it is SAVED) · **Portal Agent Rules** (list,
system_admin) · **Video Redaction Options** (form — the shipped "internal" is not an answer) · **Redaction
layout templates** (list; `/mass-redaction` now wears the strip — it was the row's only possible approval
home, and without one Go Live could never turn green).

New finish hooks: `redactionRules`, `configFreshness`, `taxonomy` (reports all three taxonomy rows),
`estimateProfiles`, `workflow`, `agentRules`, `redactionTemplates` (library CRUD only — applying a template
is work, not setup); `config.js` PUTs for time-budgets and time-capture.

**Harness (NOT RUN — this worktree may not touch the test DB):** `verify_setup_hub` +26 cases, O1–O5 · P1–P5 ·
Q1–Q6 · R1–R5 · S1–S4 · T1–T3 · U1–U3 · V1–V3 · W1–W3, each saving and restoring every row/config key it
touches and deleting the notifications it creates. **D1–D3's gate test moved from `time_budgets` to
`mass_schedule`** — time_budgets now has a required set and would 422. `verify_golden_setup` +B9 (every task
budget reviewed), +B10 (time capture saved), +B11 (video mode saved), +F2 (reminder settings) — G2 marks every
row, so each newly-required row has to be configurable there. **Someone with the test DB must run
`cd backend && npm test`.**

**Open for Kevin — `docs/WORKING_setup_conversion_questions.md`:** Q1 a proposal minted by the nightly
freshness scan turns Update Configuration red with no notification · Q2 is the reminder cadence really a city
decision · Q3 is "approved" meaningful on a reference screen (Process Map) · Q4 should the templates library
get its own `/setup/redaction-templates` screen instead of putting setup chrome on Mass Redaction.

**Skipped as instructed:** `city_choices` and every `noScreen: true` row.

## 2026-08-30 — the Opus agent's ten screens MERGED and verified here (`6a781b1`); hub 101/101, golden 44/44

Merged `worktree-agent-a5d22d1a013755919` (10 screens, one commit each; only `docs/HANDOFF.md` conflicted — both
entries kept). Verified on this box in suite order: hub 101/101, agency 20/20, fee-law 43/43, request-rules 48/48,
taxonomy-variants 14/14, mass-handoff 14/14, redaction-audit 14/14, golden 44/44, live untouched. Built,
restarted, screenshots of Redaction rules / Update Configuration / Taxonomy / Process Map / Time budgets /
Mass Redaction all wear the strip with the right colour. Two cosmetic follow-ups: (1) Update Configuration's
red line quotes the proposal's raw title (file name + sha from the nightly scan) — use a plain title;
(2) the Mass Redaction strip squeezes its evidence text between "Ready for approval" and "Approve".
Kevin's rulings still wanted on the agent's four questions in `docs/WORKING_setup_conversion_questions.md`.
**Every screen with a door is now on the approval model** except `city_choices` (→ Jurisdiction Configuration
retirement). Full `npm test` not yet run on the merged tree — run it detached before the next slice.

## 2026-08-30 — full suite on the merged tree: golden G3/H1 red traced to a harness race; bw9b restore made race-proof

First full run: 2839/2842 (E1a + golden G3/H1). Bisected by subset (`bw9b_editors → e2e_tx → e2e_oh → golden`
reproduces; green at 726ff77): bw9b's `restore()` died on `duplicate key … jps_jur_section` — the agent's
`routes/configFreshness.js` finish hook fires `afterChange('law_updates')` a few ms AFTER the dismiss response,
the hub reader's `getProfile()` → `sync()` inserts a section row in the gap between restore's DELETE and INSERT,
the restore aborts BEFORE clearing proposals, bw9b's "for scoping test" fee proposal survives, golden F applies
it, and eight fee knobs go unconfirmed → template_import not_configured → go-live not ready. Harness-only race
(production never deletes section rows): restore now clears proposals FIRST and upserts rules + sections.
Note E1a ("known red") passes when bw9b_golive runs alone — it is order-dependent too, not a code fail.
Lesson: `SUITE_DUMP_DIR=<dir> node tests/run_suite.js …` keeps a failed harness's full output (`failed_<h>.log`);
instrumenting golden with probes + a forced fail is the fast way to see mid-run state.
**Full suite after the fix: 2841/2842, live untouched — E1a the only red (the standing one). The merged tree is verified.**

## 2026-08-31 — Process Map DELETED (Kevin: informational, outdated, feeds nothing — verified)

`data/workflowModel.js` was a hand-maintained inventory read only by its own `/api/workflow-model` route, the
screen and the hub reader — no runtime consumer. Removed: hub row + reader, route + mount, data file,
`WorkflowMapPage`; `/setup/process-map`, `/workflow-map`, `?tab=map` → `/setup/workflow-rules`; helpAgent text
trimmed. Hub items 34→33 (lane counts [10,2,6,4,5,5]); harness A2/B3 updated, R4–R5 removed; SPEC §3g row
removed, §3j marked dormant (pattern retained, no screen uses it). Hub 99/99, agency 20/20, golden 44/44.
The templates/calibration investigation report went to Kevin (see session notes): layout_profiles vs
redaction_rules vs record_type_estimate_profiles; the Taxonomy calibration tab is a no-op body; dead columns
`record_types.redaction_profile_id` + `fee_estimate_low/high/note`; Mass Redaction's on-screen authoring
instruction is stale per Kevin (UI rebuilt) — rewrite pending the template-naming decisions.

## 2026-08-31 — record-search task screen: finished state on load, Preview/Remove/include-toggle on attached rows

Kevin's live find on t-d59d2b75 (2026-000004). Diagnosis from live history (read-only): he HAD completed the
search at 06:31:39 — the button was labelled "Found — 1 to include →" and did not read as the complete act,
and after reload the rail showed a live-looking button on a done task (server 409 on click). Also the
"On this request" rows had no preview/remove and the include chip was inert. Fixed (frontend only):
(1) on load, task.status done/cancelled → the rail shows the finished state (mirror of routes/tasks.js
isActionable) and begin-work is not posted; (2) attached rows get Preview (blob open — DocSearchPanel
pattern), Remove (two-click confirm; only while the task is live; attach copies the file so delete is safe),
and the include chip toggles via PATCH /files/:id/status; (3) button relabelled "Mark search complete —
send N record(s) on →" and the flash/banner now say redaction review (it said Exemption Review — wrong stage:
the resolve opens a redaction task). Verified by screenshot on the live task. No backend change; no suite run
(UI-only; the next slice's run covers it).

## 2026-08-31 — portal AI outage diagnosed (Anthropic account out of credits); the screen-key path VERIFIED, not rebuilt

Portal chat's "I had trouble responding" = the Anthropic API refusing with "credit balance is too low" —
reproduced outside the app with the .env key; both current model ids fail identically. Not caused by the setup
work (census: live untouched; hub only reads AI config). My first read ("a key saved on the AI screen is never
used") was WRONG: `services/secrets.applySecrets()` loads saved keys into process.env at boot (server.js:179)
AND on every AI-key save (integrations.js) — saved keys override the .env baseline live, no restart. Live holds
NO saved key rows, so the exhausted key is the .env baseline. FIX FOR KEVIN: paste a funded Anthropic key on
AI configuration → Save; the portal answers on the next message. Added: hub J8 proves applySecrets pushes a
saved key into env (100/100); the screen's "configured" flag now says the source ("saved on this screen" /
"from the server environment") so which key is in use is visible. Frontend rebuilt; no backend runtime change.

## 2026-08-31 — every AI call moved to Sonnet 5 (Kevin: 33% cheaper than 4.5, more capable); the one prefill rewritten

Kevin funded the API account (the outage was an exhausted credit balance; the default-workspace console key is
the platform's — verified by org id, key tail, and the Sonnet-4.5-shaped usage). Then: all 31 call sites in 24
files `claude-sonnet-4-5` → `claude-sonnet-5`. Two API removals handled at `recordSearch.judgeResults`:
`temperature: 0` dropped and the `'['` assistant PREFILL removed (Sonnet 5 rejects both; the "Output ONLY a
JSON array" instruction + existing regex parse carry it — my pre-flight scan missed the prefill, the migration
caught it). Verified: live probe of the rewritten judge on Sonnet 5 kept footage / dropped policy; harnesses
request_create 29/29, form_intake 11/11, search_intents 29/29, search_resolve 32/32; API restarted (200).
Stale model comments in two harnesses + REDACTION_GROUND_TRUTH updated. Haiku question parked: revisit with a
measured classifier eval when volume justifies it (memory: decisions-visual — bring numbers per touchpoint).

## 2026-08-31 — 2026-000006: two live finds fixed — thinking-block text reads (Sonnet 5) and parent-scoped selected records

Kevin's portal request landed with CLASSIFICATION_UNAVAILABLE ("Unexpected end of JSON input") and "no records
attached". (1) Sonnet 5 runs ADAPTIVE THINKING by default, so `content[0]` can be a thinking block — 14 call
sites read `message.content[0].text` and got '' (the classifier died on JSON.parse; the sites that join text
blocks survived). New `services/aiText.textOf(message)` joins every text block; ALL sites converted; sweep
must use `grep -F "content[0]"` (unescaped brackets are a character class — a bogus clean sweep cost a round).
(2) The workspace's selected-records query was `WHERE request_id = ?` on the row addressed — the portal writes
them on the CHILD, the workspace opens the PARENT, so every portal request showed none. Family-scoped via
master_request_id. Verified on 2026-000006: the 7 records render under "Records the Requestor Selected".
Harnesses: request_create 29/29, form_intake 11/11, wrap_parent 43/43, mrr_children 37/37,
parent_child_facts 19/19; API restarted. NOTE for the §4.4 field-design pass: the parent workspace's
"Description of Records Requested" section renders EMPTY (descriptions live on children) — same class, not
fixed here. 2026-000006 itself stays routed to intake review (the classifier failed at submit time, by design).
