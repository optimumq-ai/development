# Consolidated Spec — Domain 8: Redaction
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]`

## 1. Core model — layout vs law `[BUILT]`
The Replit-era design principle is implemented: **Layout Profiles** (`layout_profiles` — WHERE zones appear on a document type) are separate from the **Exemption Reference Library** (`redaction_rules` + `redaction_categories` — the LEGAL basis). A zone links to a rule; the rule carries the exemption citation. Managed on RedactionRulesPage.

## 2. Manual workspace `[BUILT]`
Per-document jobs (`redaction_jobs`) with drag-and-drop zones (`redaction_zones`), each zone attachable to a rule + note. Manual placement is the default working mode (Replit lesson). RedactionWorkspacePage.

## 3. AI zone discovery — suggest-only `[BUILT]`
AI reads the document's extracted text, flags exempt/sensitive spans, maps each to a rule from the library, then locates the words in the already-extracted **word-box data** and returns SUGGESTED boxes — coordinates are correct **by construction** (placed on real text, no coordinate guessing — the fix for the Replit-era unreliability). Suggestions are ephemeral; the user accepts/dismisses in the workspace.

## 4. Review pipeline `[BUILT]`
Job review stages: `pending_review → in_review → released`. **Apply = burn** (server-side): produces the released PDF + a **documentation sheet**, marks the job released, and writes the record into `fulfilled_records` (→ Domain 2 publication model). `review_auto_redaction` task type exists for mass-import output review `[task unrouted — Tasks spec]`. RedactionReviewPage.

## 5. Templates & batch application `[BUILT]`
Redaction **templates** (built from a sample document; `build_redaction_template` task from import ingest): create/edit/sample preview; **match** and **match-batch** (does a doc fit the template?); **apply** and **apply-batch** with candidate listing — the mechanism behind mass redaction of format-static groupings.

## 6. Mass jobs `[BUILT]`
Durable, resumable, **chunked** background queue (`mass_redaction_jobs`): worker ticks every 60s; runs only inside a configured **work window** (start/end time); respects a **daily budget** cap; per-item error isolation with a merged error log. Feeds the review pipeline (§4).

## 7. AV / video redaction `[BUILT]`
Server-side A/V **burn** from zone JSON produced in the AV workbench (`av_redaction_tasks`, AvWorkbenchPage) — server-side by design (Replit lesson; no browser-side shortcut).

## 8. Structured-data redaction `[BUILT]`
FIELDS mode for structured records exported as CSV: officer marks exempt **columns** → values are **dropped** → a clean "born redacted" PDF + a **Fields Withheld index** is rendered. Key property: an exempt value is **never written** to the output. StructuredRedactionFieldsPage.

## 9. Known gaps
- **auto_publish automation** — the record-type flag exists (Domains 2/3), but the mass-job pipeline does NOT auto-publish on release; publishing remains the explicit staff toggle. `[flag present, automation NOT BUILT — resolves the Domain 2 open item]`
- Dedicated redaction **task screen** `[NOT BUILT]` — the redaction task routes but opens request detail; the workspace exists but is not the per-task processing UI (Tasks spec §6).
- **Legal Redaction** role/path for `sensitive` record types `[NOT BUILT]` — Tasks spec §7; sensitive flag existence unverified.
- One `redaction_profile_id` per record type — variant-level profiles blocked on the taxonomy decision (Domain 3).
