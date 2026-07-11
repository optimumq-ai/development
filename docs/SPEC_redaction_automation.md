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
3b. **Eager AI read + record-type-clean (c) + per-file disposition pre-compute** `[NEW]` — for responsive files with no identity match, ensure a job + run the AI read and `computeDisposition`, persisting `disposition`/`disposition_basis` per file so the screen opens pre-triaged; case **(c)** (`auto_release_eligible` + clean read) bypasses here. Runs **out of** the synchronous transition path (async/queued or at first task-open) so the read's latency/failure never blocks a stage advance; a failed read never bypasses (→ Simple).
4. **Reviewer task + gating** `[NEW]` — `redaction_qa` task type, routing (author-excluded), `apply` gate for Elevated/Legal, approve/return flow onto the central transition.
5. **Legal category trigger** `[NEW]` — extend the built legal path to also fire on `LEGAL_CATEGORIES` from the read (not just intake flags).
6. **Config** `[TUNABLE]` — thresholds + category sets in `system_config`, defaults seeded from the rule catalog.
7. **UI** — the redaction task screen (`SPEC_redaction_task_screen.md`) consumes dispositions (badges, review-required state, auto-run-on-open). **Design direction mocked up 2026-07-11: `docs/mockups/redaction_screen.html`** (from Kevin's discussion PDF) — full-bleed workstation (no left nav), auto-run AI on open, 3-box accordion (AI Redaction with checkbox-select + apply-selected · Manual Redaction with rule-for-new-boxes · Finalize & Release), informational side-by-side (Original vs Proposed, read-only), renamed "Search inside document" modal, and a disposition badge whose Finalize primary action adapts (Simple/Standard → Approve & Release · Elevated → Submit for Review · Legal → Send for Legal Review). Pending Kevin's markup before build.

---

## 8. Open / residual (defaults set, retune on review)

- **Numeric + category defaults (proposed from the seeded `redaction_rules` catalog, live in `redactionDisposition.DEFAULT_CONFIG`, Kevin to retune):** `elevatedSpanThreshold=8`; `simpleSpanMax=3`; `legalCategories=[law_enforcement, legal]`; `sensitiveCategories=[health, personnel, commercial, security]`; `restrictedAvailability=[restricted, confidential]`. The seeded category vocabulary is `privacy | personnel | law_enforcement | health | legal | commercial | security` — note **`privacy` (SSN/cards/addresses/emails) is intentionally NOT sensitive**, so ordinary PII lands in the self-release band, not Elevated.
- **Reviewer eligibility** — any other role-holder (default) vs. lead/supervisor only.
- **Standard review policy** — off by default; expose the supervisor "require review on Standard" switch?
- **Async vs. sync reads at stage entry** — sync per-file (simple) vs. queued (scales for many-file requests). Start sync; revisit if latency bites.
- **Public-copy detection precision** — RESOLVED (slice 2): identity is `original_name + size + mimetype` matched to a released `fulfilled_records.source_file_id` (no content hash exists on `request_files`). A `published=1` match is the public copy. Future hardening: add a content hash for exact-byte identity.
- **Reconcile** `SPEC_redaction.md`, `SPEC_redaction_task_screen.md` §1A/§5/§9, and `data/workflowModel.js` node statuses (`public-ready` partial, `known-clean` planned, `redaction-approval-required` planned) as slices land.
