# SPEC — Redaction Automation Model (disposition, review routing, bypass)

**Status:** `[DESIGN — decided, not built]`. Decisions locked with Kevin 2026-07-11.
**Companion to:** `REDACTION_GROUND_TRUTH.md` (what runs today) and `SPEC_redaction_task_screen.md` (the UI). This spec defines the **orchestration layer** the ground-truth doc found to be greenfield: how each record is triaged toward bypass / self-release / review / legal, and what gets built to enforce it.
**Legend:** `[BUILT]` reuse as-is · `[NEW]` this spec introduces · `[TUNABLE]` policy default, jurisdiction-configurable.

---

## 1. Core idea — one disposition per responsive file

Every responsive file resolves to exactly **one disposition**, derived from signals we already produce. The disposition decides the redaction path, whether a second-person review is mandatory, and whether release is gated.

| Disposition | Redaction work | Review before release | Human touches |
|---|---|---|---|
| **Bypass** | none (released by reuse / clean auto-release) | n/a | **zero** |
| **Simple** | author glances at AI result, applies | none | one (author) |
| **Standard** | author redacts | optional (supervisor may require) | one (author) |
| **Elevated** | author redacts | **mandatory, 2nd person** | two |
| **Legal** | legal staff redact (`legal_redaction`) | **mandatory, legal** | two (legal) |

Decided model (the four locked choices):
- **Q1 → derive from read-time signals** (§3), not an intake guess.
- **Q2 → mandatory review for Elevated + Legal only**; Simple/Standard self-release (§4).
- **Q3 → broad auto-bypass**: provable-identity **or** record-type-clean (§2).
- **Q4 → Simple keeps one human** confirm-&-apply; no fully-automatic template release.

---

## 2. Bypass — skip redaction entirely `[NEW]`

A file bypasses redaction when ANY of these hold (checked in this order):

- **(a) Published public copy** — the selected file *is* a published public-ready library record (`fulfilled_records`, published). It is already the public artifact; deliver it as-is.
- **(b) Previously-released dedup** — the file is identical to a file that already has a **released** redaction output (match on the existing `idx_fulfilled_source ON fulfilled_records(source_file_id)`). Reuse that released output; do not re-redact.
- **(c) Record-type-clean** — the record type is `auto_release_eligible = 1` **AND** a **successful** AI content read found **zero** exempt spans.

**(a)/(b) need no AI read** (identity checks, done at stage entry / job creation). **(c) requires the read** and is the model's only no-human release.

**Guardrails on (c):** bypass requires the read to have **completed without error**. A read that errors, times out, or returns "unmatched > 0 with no rule" does **not** bypass — it downgrades to **Simple** (one human confirm). `auto_release_eligible` is a deliberate per-record-type attestation (taxonomy) that *all* plausible exemptions are content-detectable; bypass-(c) trusts that flag **plus** a clean read, nothing softer.

**Uniform audit:** every bypass still writes a `redaction_job` stamped `disposition='bypass'`, `review_stage='released'`, with `disposition_basis` (which of a/b/c, + the signal snapshot) and a `fulfilled_records` row (born-public or reused output), so the file worklist + completion logic (§6) treat it identically to a redacted file.

---

## 3. Disposition function `[NEW]` — `services/redactionDisposition.js`

`computeDisposition(file, signals) → { disposition, basis }`, evaluated **first-match-wins**:

1. **Bypass** — §2 (a) or (b) or (c).
2. **Legal** — request carries an intake legal flag (`SENSITIVE`/`LEGAL_HOLD`/`ONGOING_INVESTIGATION` — already `[BUILT]` via `taskRouting.requestNeedsLegalRedaction`), **OR** the AI read hit an exemption category in `LEGAL_CATEGORIES` `[TUNABLE]`.
3. **Elevated** — any of: span count ≥ `ELEVATED_SPAN_THRESHOLD` (default **8**) `[TUNABLE]`; any category in `SENSITIVE_CATEGORIES` `[TUNABLE]`; record-type `public_availability ∈ {restricted, confidential}`; spans present with **no** confident template match (< `safety_threshold`).
4. **Standard** — spans present, ordinary categories, reasonable confidence, not `auto_release_eligible`.
5. **Simple** — a trusted template match covers the form, **OR** a `releasable` (not `auto_release_eligible`) type read clean, **OR** only a few low-sensitivity spans on a confident template. (Also the fallback when bypass-(c)'s read failed.)

**Inputs — all already produced today** (`REDACTION_GROUND_TRUTH.md` §1): AI read span count + exemption `category` per span (`zoneDiscovery`); template-match `score` vs `safety_threshold` (`redactionTemplates`); record-type `public_availability` / `auto_release_eligible` (taxonomy); intake flags (`workflow_decisions.flags`).

`LEGAL_CATEGORIES` / `SENSITIVE_CATEGORIES` are seeded from the `redaction_rules` category vocabulary and stored in config so a jurisdiction can retune without code. Defaults proposed at build time from the seeded catalog.

---

## 4. Review routing `[NEW]` — build a real reviewer task

Today `redaction_jobs.review_stage` is a bare status field that spawns no task and assigns no one (`GROUND_TRUTH` §3.2). This spec builds the missing routing:

- **Simple / Standard** → the author's "Approve & Release" burns and releases directly. Standard **may** be flagged review-required by a supervisor policy `[TUNABLE]`; if so it behaves like Elevated.
- **Elevated** → on "Mark finished," the redaction task completes and a **`redaction_qa` review task** `[NEW]` is spawned and routed to a **different** holder of the redaction role (never the author). Reviewer approves → release; returns → back to the author (task reopens).
- **Legal** → handled on the `legal_redaction` task by legal staff `[BUILT routing]`; release additionally requires sign-off by a **different** legal-staff member (same `redaction_qa` task, legal role).

**Reviewer eligibility** `[TUNABLE]` — default: any other holder of the relevant role (`REDACTION_WORKER` for Elevated, legal role for Legal), author excluded. A jurisdiction may restrict to a lead/supervisor.

**Release gating** `[NEW]` — `POST /redaction-jobs/jobs/:id/apply` must refuse to release an **Elevated/Legal** job whose review has not passed (`review_stage='released'` reached via an approved `redaction_qa`). This closes today's hole where `apply` ignores `review_stage` entirely.

Reviewer task uses the existing task machinery (`taskRouting`) — one routing role catalog, nullable request link honored, no new insert site. Review completion advances the request via the **central** `applyStageTransition` only.

---

## 5. When disposition is computed — eager, at redaction-stage entry `[NEW]`

To let Bypass records **never burden a redactor**, disposition is computed **when the request enters the redaction stage** (in the redaction orchestrator invoked from `spawnForStage`), per responsive file — not lazily at canvas open:

1. On entering `redaction_review`/`redaction`: for each responsive file, run identity checks (bypass a/b); for the rest ensure a job + run the AI read; compute the disposition (§3).
2. **All files Bypass** → the request auto-advances past redaction toward delivery via `applyStageTransition` (release gate at delivery still enforces any balance) — **no redaction task ever spawns.**
3. **Otherwise** → spawn the redaction (or `legal_redaction`) task carrying the per-file dispositions; Bypass files among them are auto-released and shown as done.
4. The redactor's screen (`SPEC_redaction_task_screen.md`) opens with the **read already run and files pre-triaged** (Simple / Standard / Elevated badges) — fast, no per-file waiting. The manual "Find exempt content (AI)" re-run button remains for when a worker clears the AI set.

**Cost / failure:** one AI read per responsive non-identity-clean file at stage entry (~<1s each). Reads run per-file and may be async; a failed read → the file is **not** bypassed (falls to Simple, §2 guardrail). Reads are not re-run on canvas open if a fresh result exists.

---

## 6. Completion & release

- A redaction (or `redaction_qa`) task is complete when every responsive file reaches `review_stage='released'` (via bypass, self-release, or approved review).
- On completion the request advances via the central `applyStageTransition` (no direct stage writes).
- Delivery's existing balance/release gate is unchanged `[BUILT]`.

---

## 7. Build slices (proposed order)

1. **Disposition function** `[BUILT 2026-07-11]` `services/redactionDisposition.js` (pure `computeDisposition(signals, config) → { disposition, basis }`, first-match-wins ladder) + idempotent `redaction_jobs.disposition` / `disposition_basis` columns. Verified: 25/25 synthetic cases (every disposition, every ladder rule, both guardrails, precedence, config tunability); columns confirmed live via the real `initDb` boot path. Nothing wires it yet — slices 2–3 assemble the signals and persist the result.
2. **Identity bypass (a/b)** `[BUILT 2026-07-11]` `services/redactionBypass.js` — the read-independent half of bypass. `findReusableRelease(file)` matches a responsive file to a released `fulfilled_records` by **`original_name + size + mimetype`** (no content hash exists — this resolves §8 "id-linkage vs hash"; a `published=1` match ⇒ `published_public_copy` §2a, else `previously_released_dedup` §2b), reusing its `output_file_id`. `recordBypass` writes the uniform artifact (a `redaction_jobs` row `disposition='bypass'`/`review_stage='released'` + a request-owned `fulfilled_records` reusing the output, `published` carried over + a `REDACTION_BYPASSED` history row); idempotent. Plus completion helpers `allResponsiveReleased` and `advanceIfAllReleased` (redaction→delivery via the central `applyStageTransition`). **Not wired yet** — slice 3 invokes it. Verified 18/18 live (both bypass cases, negative no-match, idempotency, all-released auto-advance + history, non-redaction-stage no-op, 0 rows left).
3a. **Identity bypass wired at stage entry** `[BUILT 2026-07-11]` — `taskRouting.spawnForStage` now, on entering a redaction stage, runs `redactionBypass.bypassIdentityForRequest` **before** spawning: provably-clean responsive files (public-ready / previously released) are auto-bypassed; if **every** responsive file is thereby released, the request advances to `delivery` via the central `applyStageTransition` and **no redaction task spawns**. Read-independent (no LLM/OCR in the transition path). Legal escalation + normal spawn preserved for the not-all-clean case. Verified 12/12 live via real `applyStageTransition`: all-clean → auto-advance + no task + bypass/advance history; mixed → clean file bypassed, task spawned, stays at redaction; no-bypass → unchanged routing (no regression). (Split from the original slice 3 because putting LLM/OCR in the synchronous transition path is a risk to isolate.)
3b. **Eager AI read + record-type-clean (c) + per-file disposition pre-compute** `[BUILT 2026-07-11]` `services/redactionTriage.js`, kicked in the **background from `applyStageTransition`** on entering a redaction stage (once, not on reconciler sweeps). Per responsive non-identity-bypassed file: `runRead` (ensures OCR then `zoneDiscovery.discoverZones`; span count = `max(located, found)` so an unlocated finding never reads as clean) → `assembleSignals` (record-type `auto_release_eligible`/`public_availability` + intake `legalFlag` + read) → `computeDisposition` → **persist** `disposition`/`disposition_basis` on the file's job (so the screen opens pre-triaged). Case **(c)** (`auto_release_eligible` + a real clean read) → `recordCleanBypass` (releases the original as-is, `published` per record-type `auto_publish`). Idempotent (a disposed file is not re-read). After triage, if everything cleared → `advanceIfAllReleased` + cancel the now-unneeded redaction task. **Guardrail (fixed during build):** a non-document mimetype or a file with no OCR'd pages returns `readOk:false` → Simple, **never auto-bypassed** (it was never actually read). Verified 19/19 live incl. two real `claude-sonnet-4-5` reads (PII → findings; clean agenda → 0) and the async hook end-to-end (transition → bg read → case-c bypass → advance → task cancel); regressions clean (slices 2/3a/4). **Template match still deferred** (§8) — span-bearing docs default to Elevated until wired.
4. **Reviewer task + gating** `[BUILT 2026-07-11]` `services/redactionReview.js` wired into `routes/redactionJobs.js`. `gateApply(job, applier)` — the hard rule: an **Elevated/Legal** job's `apply` (release) is refused unless it was submitted for review (`review_stage ≠ editing`, else **409**) **and** the applier ≠ the author/`submitted_by` (else **403**); `null`/`simple`/`standard` pass through (no regression), so it is inert until dispositions are populated. `submit` spawns a pooled `redaction_qa` task (Elevated → `REDACTION_WORKER` on the request team; Legal → `legal_redaction`, office-level), idempotent; `apply` success → `completeReviewTask` (task done); `return` → `closeReviewTask` (cancelled). Author-exclusion is enforced at the gate (hard); pooling to a *different* reviewer is best-effort — see §8. Verified 18/18 live (gate unit ×6 + HTTP with minted author/reviewer tokens: submit-spawns-task/idempotent, author-apply 403, unsubmitted-apply 409, return-cancels, legal office-level task, completeReviewTask done; 0 rows left).
5. **Legal category trigger** `[BUILT 2026-07-11]` — extracted the escalation into `taskRouting.escalateToLegal(requestId, opts)` (sets `legal_flag`, logs `LEGAL_ESCALATED`, supersedes any open `redaction` task → re-spawns `legal_redaction`; idempotent). The Director endpoint `POST /requests/:id/legal-escalate` now calls it (DRY, unchanged behavior), and **`redactionTriage` fires it whenever a file's disposition is `legal`** — so a legal exemption found in the *document* (not just an intake flag) routes the whole request's redaction to legal staff, `flag_type=CONTENT_LEGAL`. Verified 13/13 live (read legal-category → escalation + superseded/legal_redaction; idempotent; non-legal doesn't escalate; endpoint 401/403/200 with a real director token; regressions clean 3a/3b/4).
6. **Config** `[BUILT 2026-07-11]` `services/redactionConfig.js` + `routes/redactionConfig.js` (`GET/POST/POST reset /api/redaction-config`, `SYSTEM_ADMIN`/`DIRECTOR`). Stores `{ enabled, elevatedSpanThreshold, simpleSpanMax, legalCategories, sensitiveCategories, restrictedAvailability }` in `system_config` (global key `redaction_disposition_config`), normalized over `redactionDisposition.DEFAULT_CONFIG`; `redactionTriage` reads it (once per request) and passes it to `computeDisposition`. Adds an **`enabled` master switch** (default **on**) — off disables the two automation hooks (`spawnForStage` identity bypass + the `applyStageTransition` read-triage kick) so a jurisdiction falls back to fully manual redaction; the slice-4 release gate is unaffected (inert with no dispositions). Verified 18/18 live (CRUD + validate 400 + normalize/lowercase; stored threshold flows into a disposition; master switch OFF→manual / ON→auto-advance; endpoint 401/403/200; global config snapshotted+restored). Legal escalation stays ungated (pre-existing path).
7. **UI — the redaction task screen** `[BUILT 2026-07-11]` `frontend/src/pages/RedactionTaskPage.js`, route **`/redaction/:taskId`** (full-bleed, auth-gated, outside AppLayout so it covers the nav). `TaskPoolSection` routes `redaction`/`legal_redaction` tasks here (not the generic request page). Loads the task + responsive-file worklist (top-bar switcher); per file reuses the proven canvas engine (ensure job / pages / zones / discover / apply / template / draw+rule) restructured to the mockup: **AI read auto-runs on open**, a **disposition badge** (from the persisted `redaction_jobs.disposition`), the **3-box accordion** (AI Redaction with per-item checkbox + select-all + Apply-selected · Manual Redaction · Finalize & Release), **disposition-adaptive Finalize** (elevated/legal → *Submit for review* wired to `/jobs/:id/submit`; simple/standard → *Approve & release* wired to `/jobs/:id/apply`, which the slice-4 server gate protects), informational read-only **side-by-side**, and the renamed **Search inside document** modal (`/semantic-search/documents`). Verified 9/9 (Playwright: real task loads full-bleed, request # + file worklist + Elevated badge + 3 accordion boxes + adaptive Finalize + search control render, zero runtime errors, cleaned up). **Verified on a real processed PDF `[2026-07-13]`** — the follow-up above is closed. A genuine 2-page police incident report was driven through the real chain (`/api/public/submit` → `/api/files/upload` → `PATCH /status` responsive → `POST /process` (pdftoppm page PNGs + 109/218 pdftotext word boxes) → `applyStageTransition(→ redaction)` → read-triage → `legal`): the canvas **renders both real page images**, the AI read found **17 spans and boxed them accurately on free-text narrative prose** (not just labelled form fields), and the `legal` disposition drove the badge, the second-reviewer banner, and the *Submit for review* Finalize action end-to-end. 17/17 (`scratchpad/verify_slice7_realpdf.js`).

**Side-by-side = a true release preview `[FIXED 2026-07-13, Kevin's call]`.** The pane previously blacked out only **applied** zones, so with AI proposals pending and nothing applied it rendered the right pane **identical to the original** — full SSN/DOB/address in the clear under a "PROPOSED RELEASE" heading. An operator could read that as *"the AI found nothing, this document is clean."* The right pane now blacks out **applied zones AND pending AI proposals** (`docImg(page, imgUrls, pageZones, pageSuggestions)`); pending boxes carry a **dashed amber edge** so committed is still distinguishable from proposed, and the caption states exactly what is shown (`N applied and M proposed (dashed)… not applied yet — approve them under AI Redaction to commit them`, or, when the page is genuinely clean, *"nothing is redacted on this page, so the release would be identical to the original"*). Verified 10/10 (`scratchpad/verify_sxs.js`: original pane 0 boxes; proposed pane blacks out all 12 pending with dashed edges; caption asserts not-applied; applying one → 1 solid + 11 dashed and the caption re-counts; 0 runtime errors).

8. **UI — reviewer mode (`redaction_qa`)** `[BUILT 2026-07-13]` — the mandatory second review the slice-4 gate *requires* for Elevated/Legal now has a screen. **Kevin's call: a variant of the redaction screen, not a separate one.** A `redaction_qa` task routes to the same `/redaction/:taskId` (`TaskPoolSection`), and `RedactionTaskPage` renders in reviewer shape: same canvas, file picker, side-by-side and in-document search; the right rail swaps AI/Manual/Finalize for **Proposed redactions** (every zone the author submitted, **page-anchored — click to jump**, rule cited, with an explicit warning when the author proposed *none*, since approving that releases the document unchanged) · **Second-pass AI check** (`/discover`, **not** auto-run — the author already made that call; the reviewer asks for it deliberately, and can add anything missed) · **Decision**. Opening the task calls `/begin-review` (`pending_review → in_review`), so a claimed review is visible. **Approve & release** → `/apply` (the slice-4 gate is the hard rule; the UI additionally disables it for the author with the reason). **Return for rework** → `/return`, which now **requires a reason** (400 without one): the author has nothing else to work from, so the note is written to `request_history` as `REDACTION_RETURNED`, attributed to the reviewer and naming the author and the file. Verified 31/31 on the real 2-page PDF (`scratchpad/verify_slice8_reviewer.js`), two responsive files, two real users, whole chain through real paths: triage → `legal` on both → author submits → pooled `redaction_qa` spawns → author self-release **403** → reviewer's browser shows the review rail (no author rail), names the submitter, claims the job → return-without-reason blocked in UI *and* API → returned with a reason → history row + task cancelled → author re-submits (fresh task) → reviewer approves → released, credited to the reviewer, `fulfilled_records` written.

   **Two bugs this slice exposed and fixed:** (a) `completeReviewTask` closed the per-request `redaction_qa` task on the **first** file's release — with two gated files, approving file 1 stranded file 2 with no reviewer tasked. It now closes only when **no** gated job on the request is still `pending_review`/`in_review`. (b) `apply()` never advanced the local job row, so after a successful release the rail stayed on the pre-release state (affected author mode too).

**Page anchors everywhere `[BUILT 2026-07-13]`.** Every rail list is document-wide, so an entry with no page was a line of text with nowhere to go — unusable past a handful of pages. All three lists (author **AI Redaction**, reviewer **Proposed redactions**, reviewer **Second-pass AI check**) now sort in **reading order** (page → y → x) and carry a clickable **`p. N` anchor** that jumps the canvas to that page (shared `PageChip`; the click is swallowed so it never ticks the proposal's checkbox). Verified 12/12 on the real 2-page PDF (`scratchpad/verify_pageanchor.js`: 17 proposals ↔ 17 chips, reading order 1×12 then 2×5, spans both pages, `p. 2` click → canvas on page 2 with the page-2 image painted, Apply-selected still (0), 0 runtime errors) + reviewer regression 31/31.

**Design confirmed on the screenshots (Kevin, 2026-07-13):** the reviewer gets **the same UI**, may **correct the redaction themselves** or **return it with notes** — both built. Second-pass AI check stays **optional** (not auto-run). The empty case (author proposed nothing) — a **warning is adequate**; do not block approval.

**Follow-ups:** **the author is never told their redaction came back.** On return the job drops to `editing` and the review task is cancelled, but the author's original `redaction` task was never closed at submit — it sits in My Tasks looking untouched, with the reviewer's reason reachable only via the request history. Kevin's direction: the work returns to **the same task name** carrying an **URGENT CORRECTIONS REQUIRED** banner/button. **Deferred to the My Tasks restructure** (`BUILD_PRIORITY_SUMMARY` item 8) so the row treatment is designed once, not twice — captured as **`BACKLOG` R10** with the open decisions (task state vs. new task · where the note renders · pull vs. push, noting **no notifications table exists**). **Left as-is for now.** Also pending: Kevin's further markup for visual refinements. (The AI-scan spinner's undefined `spin` keyframe is `[FIXED 2026-07-13]`.) Design mockup: `docs/mockups/redaction_screen.html` (from Kevin's discussion PDF) — full-bleed workstation (no left nav), auto-run AI on open, 3-box accordion (AI Redaction with checkbox-select + apply-selected · Manual Redaction with rule-for-new-boxes · Finalize & Release), informational side-by-side (Original vs Proposed, read-only), renamed "Search inside document" modal, and a disposition badge whose Finalize primary action adapts (Simple/Standard → Approve & Release · Elevated → Submit for Review · Legal → Send for Legal Review). Pending Kevin's markup before build.

---

## 8. Open / residual (defaults set, retune on review)

- **Numeric + category defaults (proposed from the seeded `redaction_rules` catalog, live in `redactionDisposition.DEFAULT_CONFIG`, Kevin to retune):** `elevatedSpanThreshold=8`; `simpleSpanMax=3`; `legalCategories=[law_enforcement, legal]`; `sensitiveCategories=[health, personnel, commercial, security]`; `restrictedAvailability=[restricted, confidential]`. The seeded category vocabulary is `privacy | personnel | law_enforcement | health | legal | commercial | security` — note **`privacy` (SSN/cards/addresses/emails) is intentionally NOT sensitive**, so ordinary PII lands in the self-release band, not Elevated.
- **Reviewer eligibility** — any other role-holder (default) vs. lead/supervisor only. (Slice 4: author-exclusion is enforced HARD at the apply gate; the `redaction_qa` task pools to all role-holders incl. the author, who simply can't be the one to release. Routing-level author-exclusion from the pool is a follow-up refinement.)
- **Standard review policy** — off by default; expose the supervisor "require review on Standard" switch?
- **Template match in triage** — `[BUILT 2026-07-11]` `redactionTriage.templateMatch(file)` (faithful replica of `POST /match` reusing `redactionTemplates.engine.safetyScore`/`parseZones`: best active page-template with score ≥ its `safety_threshold`) now feeds `templateMatched`/`templateScore`/`safetyThreshold` into `assembleSignals`. A confident match lets a span-bearing doc settle to **Standard/Simple** instead of Elevated. Verified 7/7 (template signal flips 2-span privacy doc Elevated→Simple, 5-span→Standard, control stays Elevated; real crafted template matches ≥ threshold, unrelated doesn't; regressions clean across all 7 automation harnesses).
- **Async vs. sync reads at stage entry** — slice 3b runs the reads in the **background** (`embedIndex.bg` from `applyStageTransition`), one file at a time in-process. Fine for a handful of files; a real queue is the scale path if many-file requests bite.
- **Public-copy detection precision** — RESOLVED (slice 2): identity is `original_name + size + mimetype` matched to a released `fulfilled_records.source_file_id` (no content hash exists on `request_files`). A `published=1` match is the public copy. Future hardening: add a content hash for exact-byte identity.
- **Reconcile** `SPEC_redaction.md`, `SPEC_redaction_task_screen.md` §1A/§5/§9, and `data/workflowModel.js` node statuses (`public-ready` partial, `known-clean` planned, `redaction-approval-required` planned) as slices land.
