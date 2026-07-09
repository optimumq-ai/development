# Spec — Redaction Task Screen (single-request)

**Status:** DRAFT for build. Drafted 2026-07-09 from a design session with Kevin. Sibling to `SPEC_record_search_task_screen.md`. Companion to `SPEC_redaction.md` (Domain 8) and `MASTER_task_types_permission_groups.md` (task types `redaction` / `legal_redaction`, screens `[NOT BUILT]`).
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[NEW]` (introduced by this spec).

**Scope.** The screen a redaction worker sees when they click a `redaction` (or `legal_redaction`) task in **My Tasks**. Its job is **not** to be another redaction canvas — the canvases already exist per file. It is a **task hub**: show the request's responsive files, each file's redaction-job status, and route each file to the correct existing tool. Tier 1 #2 ("a redaction task click should open the job/workspace, not generic request detail").

Route: `redaction/:taskId` → new `RedactionTaskPage.js` (parallels `estimate/:taskId`). Same `MyTasksPage` per-task-type routing change as the record-search screen. Covers both `redaction` and `legal_redaction` — same screen, the task's `type` + eligibility differ (legal escalation, §5).

---

## 1. What already exists (the building blocks)

Unlike record search, most of this domain is `[BUILT]` — the gap is purely the task-level entry point.

**Data model**
- `request_files` — source files (`mimetype`, `responsive` flag). The redaction worklist = responsive files.
- `redaction_jobs` — **one job per file** (`file_id`, `request_id`, `status` draft/…, `review_stage` editing→review→released, `output_file_id`, `reviewed_by/at`, `submitted_by/at`).
- `redaction_zones` — boxes per job/page (coords, `rule_id`, `zone_type` manual/auto, `review_state`).
- `layout_profiles` — reusable zone templates per record type (`kind` pages/fields).
- `av_redaction_tasks` — audio/video work (`mode` external/internal, `status` out/checked-in, `attested`).
- `fulfilled_records` — the released output of `apply` → publishable to the public library.

**Backend routes (`redactionJobs.js`) `[BUILT]`**
- `POST /file/:fileId/job` — ensure the doc is processed, create/return the draft job + pages + zones.
- `POST /jobs/:jobId/zones` — add a zone. `POST /jobs/:jobId/apply` — burn → released PDF + documentation sheet → `fulfilled_records`; sets `review_stage='released'`.
- `POST /jobs/:jobId/begin-review` · `/submit` · `/return` — the review workflow.
- `GET /released` · `POST /released/:id/publish` — library publishing.

**Per-file UI surfaces `[BUILT]` (all reached per-file today, never per-task):**
| Tool | Route | For |
|---|---|---|
| Document redaction canvas | `redact/:fileId` (`RedactionWorkspacePage`) | PDFs / images (page zones) |
| Redaction review | `redact/:fileId/review` (`RedactionReviewPage`) | reviewer pass |
| A/V workbench | `av-redact/:requestId/:fileId` (`AvWorkbenchPage`) | audio / video |
| Structured-field redaction | `redact-fields/:fileId` (`StructuredRedactionFieldsPage`) | structured-data records |
| Mass redaction | `mass-redaction` (`MassRedactionPage`) | batch (not per-request; out of scope) |

**Task routing `[BUILT]`:** `STAGE_TASK` maps `redaction_review`|`redaction` → task type `redaction`, escalating to `legal_redaction` when the request is legally flagged (`taskRouting.js`; redaction + legal_redaction are one idempotent family).

**Today's entry point:** the central `RequestWorkspacePage` has a "Redaction for Audio/Video" tab (only when `av_applicable`) + `RecordsPanel`, and a legal-escalation button — but no focused, file-by-file redaction worklist tied to the task.

---

## 1A. Upstream gate — is redaction even required, and can existing redaction be reused? `[RESEARCH]`

Before the hub routes a file to a canvas, two upstream questions decide whether redaction work is needed at all, and whether prior work can be reused. **This is a required research/verification task before build** — findings so far (verified against code 2026-07-09):

**(a) "Is redaction required?" — signals BUILT, skip-gate NOT wired.**
- Captured today: `record_types.public_availability` (`releasable | review_required | restricted | confidential`) + `auto_release_eligible` (set to 1 only if *every* plausible exemption is detectable from content itself); per-request `redaction_flag` (classifier/extractor) + `classification = redaction_required`. All exist, but **nothing uses them to skip the redaction stage/task.**
- Designed, not built: `workflowModel` nodes `public-ready` (status **partial** — "code reads public_availability + redaction flag; human confirms") and `known-clean` (status **planned**, decider code — "add the type to the known-clean registry to bypass redaction entirely"). **No known-clean registry exists; no rule routes around redaction.**
- Public-ready / library selections do **not** skip redaction — selection gates nothing (cross-ref `SPEC_record_search_task_screen.md` §1). `recordMetaExtract` reads already-cleared (public) docs but there is no skip gate.

**(b) "Does redaction already exist for this?" — template reuse substantially BUILT, but only wired into mass jobs.**
- `layout_profiles` = redaction templates: zones (normalized boxes + the cited rule) + a **layout fingerprint** (the form's static vocabulary + page count). `redactionTemplates.js` provides `buildFingerprint(fileId)`, `POST /match` (best active template whose layout matches a file ≥ its `safety_threshold`, default 80), `POST /match-batch` (side-effect-free scoring), and `applyTemplateToFile` (auto-apply the template's zones).
- **Gap:** `applyTemplateToFile` / `/match` are invoked by the **mass-redaction** worker only. The single-file job open (`POST /file/:fileId/job`) does **not** auto-run the match — so on the per-file / task path, template reuse is manual.

**Task-screen implications (fold into §2 behavior):**
1. **"May not require redaction" banner** — when the record type is `releasable` / `auto_release_eligible` with no `redaction_flag`, surface this and offer a **human-confirmed skip** (until the `known-clean` / `public-ready` gate is actually built, the skip stays human-confirmed, not automatic).
2. **Template-reuse prompt** — on opening a file, call `POST /match`; if a template scores ≥ threshold, show "existing redaction template available (N% match)" with one-click `applyTemplateToFile`. This wires the built-but-unused reuse into the task flow.

**Residual research TODO (before/at build):**
- Pin down exactly what the `public-ready` "partial" status already does — is *any* code reading `public_availability`/`redaction_flag` to route around redaction, or only surfacing the flags?
- Decide + (separately) build the **known-clean registry** — the real skip gate; owner + criteria.
- **Dedup:** is there any check against an existing `released` `redaction_job` / `fulfilled_record` for the same `file_id` to avoid re-redacting? (Not found — verify; a file already released shouldn't spawn fresh redaction work.)
- Confirm whether the doc canvas already auto-runs `/match` on load (if so, the hub just needs to surface it, not trigger it).

---

## 2. The task screen — a routing hub, not a canvas

Mirror `EstimateTaskPage`: load the task via `GET /tasks/:taskId`, header (task type + status badge), request-context line. Then the work surface is a **responsive-file worklist**:

For each responsive `request_file`:
- **File row** — name, type icon, page/size, and its **redaction-job status** (no job yet · draft/editing · in review · released) derived from `redaction_jobs` + `review_stage`.
- **Primary action routes to the right tool by type** (§3): "Redact" → the matching canvas; "Review" when a job is in review; "Released ✓" when done (link to view output).
- Auto-zone hint: if a `layout_profile` matches the record type, note "template available" (the canvas applies it).

Completion (§6): when every responsive file has a `released` job, the task can be marked done and the request advances toward delivery.

---

## 3. File-type → tool routing `[NEW glue]`

The hub decides the destination from `request_files.mimetype` (+ record-type structured flag). The tools all exist; this mapping is the new glue.

| File kind | Detection | Routes to |
|---|---|---|
| **Document** | `application/pdf`, `image/*` | `redact/:fileId` (ensure job via `POST /file/:fileId/job`) |
| **Audio / Video** | `audio/*`, `video/*` | `av-redact/:requestId/:fileId` |
| **Structured data** | record type `is_structured_data`, or `layout_profile.kind='fields'`, or CSV/data export mimetype | `redact-fields/:fileId` |
| **Other / unknown** | anything else | default to document canvas after processing; if processing fails, surface "manual handling" |

> Verify during build: the exact mimetypes `docProcessing` accepts, and how `av_applicable` / structured detection is currently computed, so the hub's detection matches what each tool expects.

---

## 4. Legal redaction escalation `[BUILT routing]`

- If the task `type` is `legal_redaction` (request legally flagged — Director escalation or `SENSITIVE`/`LEGAL_HOLD`), the same hub is used but eligibility is office-level legal staff (per `MASTER`), and the header shows the legal-flag reason.
- The existing "Escalate for Legal Redaction" action (workspace) reassigns an active redaction task to legal staff — the hub should surface the same escalate control (or link to it) so a worker who spots sensitivity mid-task can escalate.

---

## 5. Review workflow surfaced `[BUILT ops, NEW visibility]`

The job review lifecycle already exists (`begin-review` → `submit` → `return` → `apply`/`released`). The hub should make it legible per file: who has it, what stage (`editing`/`review`/`released`), and the reviewer. Whether redaction + review are the **same** person/task or a **separate reviewer task** is an open decision (§8) — today `review_stage` lives on the job, not as its own routed task.

---

## 6. Completion & stage advance `[NEW]`

- Task done when all responsive files have `review_stage='released'`.
- On completion, advance the request through the central `applyStageTransition` toward delivery (release gate at delivery still enforces any balance, `[BUILT]`).
- **Flag — stage-order discrepancy to reconcile:** `RequestWorkspacePage` uses a legacy linear order (`…record_search → redaction_review → fee_review → awaiting_payment → delivery`), while `taskRouting.STAGE_ORDER` is `…record_search → exemption_review → ag_review → redaction_review → redaction → delivery`. The task screen must advance via the canonical `STAGE_ORDER`, and the two should be reconciled (not in this screen's scope, but it can't paper over it).

---

## 7. Layout (three zones)

1. **Context** — header (task type + legal badge if applicable) · request line (number, requestor, record type) · overall progress (`n of m files released`).
2. **File worklist** — one row per responsive file: type, job status, primary action → the matching tool (§3).
3. **Actions** — escalate-to-legal (if not already) · mark task complete (enabled when all released) · link back to full request.

---

## 8. Data-model & routing changes

| Change | Where | Status |
|---|---|---|
| Route `redaction/:taskId` + `RedactionTaskPage.js` | `App.js`, new page | `[NEW]` |
| `MyTasksPage` routes by task type (shared with record-search work) | `MyTasksPage.js` | `[NEW]` |
| Task hub: responsive-file worklist + per-file job status + type→tool routing | new page, reads existing `request_files`/`redaction_jobs` | `[NEW]` glue over `[BUILT]` |
| Task-done detection (all responsive files released) + advance via `applyStageTransition` | new page + existing central fn | `[NEW]` |
| Reconcile stage-order between workspace and `STAGE_ORDER` | `RequestWorkspacePage` / `taskRouting` | `[NOT BUILT]` (flagged, separate) |
| "May not require redaction" banner + human-confirmed skip (§1A) | new page, reads `public_availability`/`auto_release_eligible`/`redaction_flag` | `[NEW]` |
| Auto-run template `POST /match` on file open + one-click `applyTemplateToFile` (§1A) | new page over `[BUILT]` `redactionTemplates.js` | `[NEW]` glue |
| Known-clean registry — the actual skip-redaction gate | `workflowModel` `known-clean` (planned) + rulebook/taxonomy | `[NOT BUILT]` (separate slice) |
| Dedup vs. existing released job/`fulfilled_record` for the same file | verify in job creation path | `[RESEARCH]` |

---

## 9. Open decisions / to confirm

1. **Redaction vs. review — one task or two?** Today `review_stage` is a field on the job (same worker can edit then release). Do we want a separate routed **reviewer** task (second person), or keep single-worker with an in-screen review step? (Affects §5 and whether a `redaction_review` *task type* is needed vs. the current stage name.)
2. **Which files are in scope for the task?** All `responsive` files, or only files at/after record search selected as responsive? Confirm the worklist source query.
3. **Structured-data detection** — is `is_structured_data` / `layout_profile.kind` reliably set at this point, or does the hub need a mimetype fallback?
4. **Stage-order reconciliation** (§6) — confirm the canonical path redaction advances into (`redaction → delivery`) and schedule the workspace/`STAGE_ORDER` reconciliation as its own slice.
5. **Build order** — this screen relative to the record-search screen (record-search is the larger Tier 1 #1; this is Tier 1 #2 and smaller since the tools exist).
6. **Upstream "is redaction required?" gate (§1A)** — scope for this build: ship the human-confirmed skip banner now, and treat the `known-clean` registry + `public-ready` auto-gate as a separate upstream slice? Confirm owner + criteria for known-clean.
7. **Template auto-match on task open (§1A)** — wire `POST /match` into the file worklist now (built but currently mass-jobs-only), or defer? Confirm the doc canvas isn't already doing it to avoid double-invocation.
8. **Re-redaction dedup (§1A)** — confirm whether a file with an existing `released` job should be excluded from the worklist / short-circuited; no dedup check found today.
</content>
