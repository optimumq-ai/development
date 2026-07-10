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
