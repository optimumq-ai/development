# Redaction — Ground-Truth Reference (what is ACTUALLY built)

**Produced:** 2026-07-11, against `main` @ `6d62a8b` (working tree clean).
**Method:** three independent read-only investigations of the *actual backend/frontend code* (not the design docs), each returning file:line evidence. This document exists because the redaction design docs (`SPEC_redaction.md`, `SPEC_redaction_task_screen.md`, `FEATURE_context_aware_redaction.md`, the `workflowModel` node statuses) describe a model that is largely **aspirational** — several behaviors a reader would assume are built are designed-only or absent. Trust THIS doc over those for "what runs today," and reconcile the specs to it as they are revised.

**Legend:** `[BUILT]` runs today · `[PARTIAL]` scaffolded/half-wired · `[DESIGNED-ONLY]` present in a spec/model node but no live code · `[ABSENT]` not in the code at all.

---

## 0. One-screen summary

| Capability | Status | One-line reality |
|---|---|---|
| AI content detection ("Find exempt content") | `[BUILT]` | Real `claude-sonnet-4-5` read of OCR text → box + rule + reason; **ephemeral, manual-trigger** |
| Template / profile match | `[BUILT]` | Deterministic token-overlap vs `safety_threshold` — **not AI**; auto-suggests on canvas open, apply is manual |
| Zone CRUD, rule picker, burn/release (`apply`) | `[BUILT]` | Full per-file redaction canvas works |
| Side-by-side review render | `[BUILT]` | Original vs proposed columns exist (`redact/:fileId/review`) |
| Semantic in-document search ("Search Documents") | `[BUILT]` | `POST /semantic-search/documents` — misnamed in the UI |
| Legal-redaction escalation | `[BUILT]` | Manual (Director) **and** auto-from-intake-flags; spawns `legal_redaction` task |
| **Redaction complexity tier (simple/medium/complex)** | `[ABSENT]` | No such concept for redaction anywhere |
| **Reviewer assignment / second-person review task** | `[ABSENT]` | `review_stage` is a bare status field; no task, no assignment; `apply` ignores it |
| **Clean-record bypass (public-ready / previously-released)** | `[DESIGNED-ONLY]` | Signals populated but **consumed by nothing**; `known-clean` node = `planned` |
| **AI read at record-selection time** | `[ABSENT]` | Both AI steps are lazy — fire only when the canvas opens, never at selection |
| **"No redaction needed" verdict from reading the document** | `[ABSENT]` | Document read emits no clean/needs-redaction flag |

**The shape of it:** the *engine* (AI read, template match, zone→burn→release, legal escalation) is real and reusable. The *automation/orchestration layer* (complexity tiers, review routing, clean-record bypass) is essentially **greenfield** — designed on paper, unwired in code.

---

## 1. The engine — what is real and reusable `[BUILT]`

### 1.1 AI content detection — the document read
- Route `POST /redaction-jobs/file/:fileId/discover` → `zoneDiscovery.discoverZones(fileId)` (`routes/redactionJobs.js:85,92`; comment marks it "ephemeral," `:84`).
- `services/zoneDiscovery.js:43-86`: reads already-OCR'd text from `document_pages.text`/`.words` (`:44` — OCR is done earlier by `docProcessing.processFile`; the route ensures pages exist at `:90`), builds a prompt listing the jurisdiction's `redaction_rules` as a menu + ≤24 000 chars of page text (`:55`), then a **real Anthropic call**: `messages.create({ model:'claude-sonnet-4-5', max_tokens:4096 })` (`:65-66`, SDK `@anthropic-ai/sdk` `:6`, `ANTHROPIC_API_KEY`).
- The model returns exempt spans + chosen `rule_id` + `reason`; the code then locates each string in the word-box data (`findRuns`/`unionBox`, `:21-41`) so **coordinates are exact, not model-guessed**.
- Return per suggestion (`:82`): `{ page_no, x, y, w, h, rule_id, rule_title, category, text, reason }`; envelope `{ suggestions[≤50], scanned_pages, found, unmatched }` (`:85`).
- **Nothing is persisted** — suggestions live only in React state (`RedactionWorkspacePage.js:149`) and are accepted one-by-one into `redaction_zones`.

### 1.2 Template / profile match — NOT AI
- `routes/redactionTemplates.js` over `layout_profiles` (`schema.postgres.sql:278-279`: `layout_fingerprint TEXT`, `safety_threshold INTEGER DEFAULT 80`).
- `buildFingerprint` (`:41-49`): tokenizes the *blank form's* structural words (drops pure numbers so filled data doesn't pollute it) → `{v, name, pages, tokens[≤600]}`.
- `safetyScore` (`:64-71`): `round(100 * intersection / template_terms)` — "what fraction of the template form's vocabulary appears in the target doc."
- `POST /match` (`:261`): best active template with `score >= safety_threshold` → `{ matched, template:{ id, name, zone_count, safety_threshold, score } }`. `POST /match-batch` (`:285`) is side-effect-free (badge only).
- A match **does nothing automatically.** Applying is explicit: `POST /:id/stage` (`:310`) copies zones onto a draft job as `zone_type='template'` for human review; `POST /:id/apply` / `apply-batch` (`:168,196`) burns+releases (batch re-checks score and holds files below threshold, `:245`; supervisor-gated `:197`). A `kind:'fields'` variant handles CSVs via column-name overlap (`fieldsScore`, `:23`).

### 1.3 Zone → burn → release, and the per-file canvas
- `POST /redaction-jobs/file/:fileId/job` ensures OCR + creates/returns a draft job + pages + zones (`RedactionWorkspacePage.js:68`).
- Zone CRUD: `POST/PATCH/DELETE /redaction-jobs/jobs/:jobId/zones` (and `/zones/:id`); rule picker `POST /redaction-jobs/suggest-rule` + `GET /redaction/rules`.
- Burn: `POST /redaction-jobs/jobs/:jobId/apply` → released PDF + documentation sheet → `fulfilled_records`, sets `review_stage='released'`.
- Save template: `POST /redaction-templates`. Page images: `GET /files/page-image/:pageId`.

### 1.4 Side-by-side review render
- `redact/:fileId/review` (`RedactionReviewPage`) renders Original vs Proposed columns and today also carries Add-redaction / Approve & release / Send-for-legal controls (`:200,242,247`).

### 1.5 Semantic in-document search ("Search Documents")
- `DocSearchPanel` → `POST /semantic-search/documents { query, requestId, topN }` (`components/ui/DocSearchPanel.js:15`). Searches *inside* the request's documents by meaning. The tab label "Search Documents" is misleading (reads like record search).

---

## 2. Legal-redaction escalation `[BUILT]` — the one automation that is real

Central logic in `services/taskRouting.js`:
- `STAGE_TASK = { redaction_review:'redaction', redaction:'redaction', … }` (`:271`); `LEGAL_FLAG_VALUES = ['SENSITIVE','LEGAL_HOLD','ONGOING_INVESTIGATION']` (`:275`).
- `requestNeedsLegalRedaction()` (`:279-285`): true if `requests.legal_flag === 1` **OR** the latest `workflow_decisions.flags` contains any `LEGAL_FLAG_VALUES`.
- `spawnForStage()` (`:293`): entering a redaction stage on a flagged request spawns `legal_redaction` (office-level, `teamId=null`, `:301`) instead of `redaction`.

**Path A — manual (Director):** `POST /requests/:id/legal-escalate` (`routes/requests.js:312`), guarded `SYSTEM_ADMIN`/`DIRECTOR` (`:314-315`); sets `legal_flag=1` + `legal_flag_type`, logs `LEGAL_ESCALATED`, supersedes any open `redaction` task and re-spawns it as `legal_redaction` (`:328-333`).

**Path B — automatic from the intake classifier:** `classifier.js:47,91` emits `flags:[LEGAL_HOLD|SENSITIVE|ONGOING_INVESTIGATION]` from reading the **request description**; stored in `workflow_decisions.flags` (`workflowEngine.js:91-92`). Because `requestNeedsLegalRedaction` reads that, an AI-flagged request **auto-escalates to `legal_redaction`** on reaching the redaction stage — no click. Seeded rule `wfr-sensitive` (priority 5) also holds flagged requests at intake (`schema.postgres.sql:412`).

**Caveat — this is triggered by the request TEXT, not the document.** Nothing escalates to legal because a *scanned page* turned out sensitive; `zoneDiscovery` (the document read) emits no legal flag, no complexity, no escalation, no review routing.

---

## 3. The automation layer — designed-only or absent

### 3.1 Redaction complexity tier (simple/medium/complex) — `[ABSENT]`
- No `redaction_level` / redaction-complexity field exists anywhere.
- The only tiering is request-wide `classification` (`simple | standard | complex | redaction_required`), set by the intake LLM reading the description (`classifier.js:40,76`), stored `requests.classification` (`schema.postgres.sql:16`). It drives **only the statutory deadline** `DEADLINE_DAYS = { simple:5, standard:10, complex:20, redaction_required:30 }` (`classifier.js:10`) — **not** redaction routing, review, or legal.
- `workflowModel` node `complexity` (`data/workflowModel.js:34`) describes exactly this intake classifier — not redaction difficulty.

### 3.2 Reviewer assignment / second-person review — `[ABSENT]` (mechanics `[PARTIAL]`)
- `redaction_jobs.review_stage` (`editing → pending_review → in_review → released`) is a **bare status field** stamped with *whoever clicked*:
  - `submit` → `pending_review`, `submitted_by = caller` (`routes/redactionJobs.js:112-116`) — **no task, nobody assigned.**
  - `begin-review` → `in_review`, `reviewed_by = caller` (`:120-128`) — reviewer = "whoever opens it," **no eligibility/assignment.**
  - `return` → `editing` (`:131-135`).
  - `apply` → `released`, `reviewed_by = caller` (`:98-109`), and **does not check `review_stage`** → a job can be released straight from `editing`; **review is optional and bypassable.**
- The redaction **task** (`tasks` table, type `redaction`/`legal_redaction`, routed to `REDACTION_WORKER` via `taskRouting.js`) is a **completely separate mechanism** from the job review lifecycle — clicking "submit for review" triggers **zero** task activity.
- The "second-person approval" gate is `data/workflowModel.js:77` `redaction-approval-required` = `status:'planned'` — designed-only.

### 3.3 Clean-record bypass (public-ready library + previously-released copies) — `[DESIGNED-ONLY]`
**Bottom line: no automatic bypass. Known-clean / public-ready / previously-released records spawn a redaction task and pass through the redaction stages exactly like everything else.**
- `workflowEngine.buildSignals` loads `public_availability` into the signal set (`:37,43`) — but **the 4 seeded rules never reference it** (`schema.postgres.sql:412-415` branch only on `flags`, `record_type_confidence`, `has_owner_team`). Best case for a confident *releasable* record is routing to `record_search` — never skipping redaction. `public_availability` is a **dead signal**.
- `auto_release_eligible` (real column on `record_types`, defaulted `1` on releasable types) is **consumed nowhere** outside taxonomy CRUD. Same for `is_canonical` (schema comment `:75` literally says "cost/public-ready bypass" — aspirational; nothing reads it).
- Model nodes: `known-clean` = `status:'planned'` (needs a "known-clean registry" that **does not exist**); `public-ready` = `status:'partial'` ("code reads flags; human confirms") with an **inert** output.
- **Public-ready library** = the `fulfilled_records` table (`schema.postgres.sql:289-310`), surfaced as search Tier 1 (`recordSearch.js:22-28`). Selecting such a record copies `public_availability` into `request_selected_records` (`publicChat.js:365`), but the only reader is `requests.js:74` — **for display.** No routing effect.
- **Previously-released dedup** — `POST /redaction-jobs/file/:fileId/job` (`routes/redactionJobs.js:21-39`) **unconditionally** creates a draft job; it checks only for an existing *draft* on the same file (`:30`), never for an existing released `fulfilled_records` / released job / `output_file_id`. The index `idx_fulfilled_source ON fulfilled_records(source_file_id)` (`schema.postgres.sql:310`) — exactly the hook a dedup check would use — is **queried by no code.**
- The **only** "release without redaction" paths are manual human overrides: AV "release-as-is" requiring explicit attestation (`routes/avRedaction.js:127-142`) and a staffer manually advancing stage past redaction (`PATCH /requests/:id/stage`). Neither is the system *recognizing* a record is clean.

---

## 4. Trigger timing & order (the corrected mental model)

- **Nothing redaction-AI runs at record-selection / intake.** The selection path (`publicChat.js:363-390`) inserts into `request_selected_records` and classifies/routes the request — but never calls `discoverZones` or `/match`. `recordMetaExtract` runs only *after* a redacted record is released (`redactionApply.js:187`), not at selection.
- **Both AI steps are lazy, at canvas open** (`RedactionWorkspacePage.js:65 init()`):
  1. `POST …/file/:fileId/job` (ensures OCR, draft job, zones).
  2. **Auto — but only if the job has zero zones:** `checkMatch()` → `POST /redaction-templates/match` (`:75,131`); sets a "template available" banner only, apply is manual.
  3. **Manual:** `discover()` (content detection) fires **only** on the "Find exempt content (AI)" button (`:144,279`).
- **Order:** template *match* auto-first (on open, if no zones) → content *detect* later, on click. Independent; neither gates the other.
- **No "needs no redaction" determination comes from reading the document.** The only `redaction_flag` is set by the intake classifier reading the **description** (`classifier.js:86`), flows into `buildSignals` as a routing signal (`workflowEngine.js:45`), and is **not even a stored column** on `requests`. The nearest persisted thing is `classification='redaction_required'` (a 30-day deadline), also from the description.

---

## 5. Signals inventory — present but inert

These are populated in the data model and *look* like a bypass/automation is wired, but **no decision path consumes them** for redaction:

| Signal | Where | Consumed by redaction/routing? |
|---|---|---|
| `record_types.public_availability` | taxonomy; copied to `request_selected_records` | No — display only (`requests.js:74`) |
| `record_types.auto_release_eligible` | taxonomy (default 1 on releasable) | No — taxonomy CRUD only |
| `record_types.is_canonical` | schema `:75` ("cost/public-ready bypass") | No — nothing reads it |
| `fulfilled_records` (public-ready library) + `idx_fulfilled_source` | `schema.postgres.sql:289-310` | No dedup/reuse check at job creation |
| `redaction_flag` (from description) | `classifier.js:86` → `buildSignals` | Routing signal for `workflow_rules` only; not a document read; not a stored column |
| `requests.classification` | intake classifier | Deadline only — not redaction |

---

## 6. Corrections to the prior mental model / design docs

1. **"Known-clean records bypass redaction."** ❌ Not built. Fully designed, partially scaffolded, entirely unwired.
2. **"AI reads the document after selection."** ❌ Both AI steps are lazy at canvas-open, not at selection.
3. **"AI matches a profile OR decides if redaction is needed (unsure of order)."** Match is deterministic token-overlap (auto on open); content-detection is the LLM read (manual click); no ordering dependency; **no "needs redaction?" verdict is produced from the document.**
4. **"Documents are tagged simple/medium/complex for redaction."** ❌ No redaction complexity concept exists; the only `classification` is an intake deadline knob.
5. **"Medium → auto-route to a reviewer on 'finished'; conditions decide."** ❌ `review_stage` has no assignment and spawns no task; `apply` ignores it (review is optional/bypassable).
6. **"Complex/legal auto-routes to legal."** ✅ Legal is real (manual + auto-from-intake-flags) — but triggered by the **request text at intake**, not the document content.

---

## 7. Implications — what is greenfield vs. reuse

**Reuse as-is when building the Redaction UI:** AI content read (box+rule+reason), template match+apply, zone CRUD + rule picker, burn/release (`apply`), side-by-side render, semantic in-doc search, page images, legal escalation.

**Greenfield decisions (design from scratch — nothing to reverse-engineer):**
- **Clean-record bypass:** define *when* a record is provably clean (public-ready library entry / previously-released match) and route it around redaction. Substrate exists (`fulfilled_records`, `source_file_id` index, `public_availability`, `auto_release_eligible`) — needs a consuming decision path + the `known-clean` registry (currently `planned`).
- **Redaction complexity + review routing:** if we want simple→auto-done, medium→route-to-reviewer, complex→…, we define the tiers and their conditions, plus a real reviewer **task** with assignment (today's `review_stage` is a status flip). Open question worth answering first: do we even want a formal complexity tier, or is the signal set already available — *N exempt spans found / known-template matched / sensitive-rule hit* — enough to drive routing directly?

**Cross-refs to reconcile as these are decided:** `SPEC_redaction.md` (Domain 8), `SPEC_redaction_task_screen.md` (§1A upstream gate, §5 review, §9 open decisions), `FEATURE_context_aware_redaction.md`, `data/workflowModel.js` node statuses (`public-ready` partial, `known-clean` planned, `redaction-approval-required` planned), `DOMAIN_MAP.md` Domain 8.
