# Consolidated Spec — Domain 2: Public Ready Records Library
**Current design only.** Verified against code + DB on 2026-07-08; §2a/§3 library-destination pass 2026-08-14.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DEFERRED]`

## 1. Library page (citizen) `[BUILT — redesigned 2026-07-07]`
Header: title + subtitle, top-right CTA "Didn't find what you were looking for?…" with **Open Records Portal** button → `/portal?start=request` (straight into the intake chat). Body order: "Click to browse Records Library" heading → departments in a fixed-height **scroll well** (click-to-drill, chevrons, count pills) → search block ("Enter a description and click Search…") → map section ("View public records by location on map" + **View Map** button). Text scaled to portal weight. Drill-down: department → record types → records → record detail (download link if a file is attached), breadcrumbs throughout; scroll-well pattern at every level; year-filter chips on record lists.

## 2. Publication model (staff) `[BUILT]`
`fulfilled_records` is the released index (Fulfilled Request Index). A record enters it when a redaction job is applied ("burn" → released PDF + documentation sheet, `review_stage='released'`). **Publishing is a separate, explicit toggle** (`published` flag, with published_at/by): released-to-requestor ≠ public. Unpublishing removes public discovery only. Staff manage this on ReleasedRecordsPage (`GET /released`, `POST /released/:id/publish`). Record types carry an `auto_publish` flag surfaced alongside `[flag exists; auto-publish automation to verify in Domain 8 pass]`.

## 2a. Library destination ("shelf") for request-less records `[BUILT 2026-08-14 — verify_library_destination 18/18]`
The browse tree runs on `fulfilled_records.record_type_id + department_id`, which historically came ONLY from the parent request — an ad-hoc mass batch (files pasted somewhere, pointed at a template) released records with NULL in both, i.e. an unbrowsable "Other/Uncategorized" pile, and `auto_publish` could never fire for them. Decision (Kevin 2026-08-14): **the shelf is a human decision made once per pile at the point of work, not a per-document AI guess.**
- **Mass jobs carry a destination** (`mass_redaction_jobs.record_type_id/department_id`), defaulted at creation from the template's linked record type + that type's owner department (owner walk-up: variant → parent, `record_type_departments role='owner'` — `services/libraryShelf.js`), editable in the compose UI, inherited by every chunk including resumes. The immediate `apply-batch` path takes the same optional destination; the templates list exposes `owner_department_id` for prefill.
- **The apply path stamps it**: `redactionApply.applyRedaction` and `structuredRedaction.applyFieldMap` accept a destination; **request values always win when the file belongs to a request** — the destination fills only NULLs. `auto_publish` now reads the effective record type, so scheduled request-less batches can auto-publish.
- **Publish gate**: `POST /released/:id/publish` refuses to publish a record with NULL type or department (plain-words 400); the body may carry `record_type_id`/`department_id` to shelve-and-publish in one step (department resolvable from the type's owner routing). Unpublish never needs a shelf. ReleasedRecordsPage shows a "No library section" pill and opens a picker instead of failing.

## 3. Public endpoints (no auth — public reading room) `[BUILT]`
All under `/api/public/*`: `/browse` (dept → type tree with counts; only `status='released' AND published=1`), `/browse/records` (records for a type, optional year), `/library/search` (public search), `/library/map` (map pins), `/file/:id` (download of the released output file). Every public query is gated on released+published. **Variant roll-up `[BUILT 2026-08-14]`:** `/browse` groups variant-stamped records under the PARENT bucket (`COALESCE(rt.parent_record_type_id, fr.record_type_id)`) and `/browse/records` for a bucket includes its variants' records — processing-level variant names ("Residential Building Permit Applications") never appear as public shelves; read the public identity through the parent, same principle as request numbering.

## 4. Public search pipeline `[BUILT]`
Keyword + semantic (pgvector/voyage) over published records with a score floor; post-search **AI relevance judge** (`recordSearch.judgeResults`) drops wrong-kind matches; results carry `semantic`/`relevanceNote` markers. Same engine backs the intake agent's Phase 2.5 search.

## 5. Map view `[BUILT]`
`/library/map` returns pins only for records that are released AND published AND of a **mappable** record type AND geocoded (lat/long present) — the mappable flag + publish gate is the deliberate surveillance guardrail. Includes map anchor config (geocode service). Pin popup: title/summary/date + "View record" file link. Page: PublicLibraryMapPage.

## 6. Known gaps / notes
- Library page department boxes will scroll at ~15 departments as designed; drill-down levels reuse the scroll-well.
- `auto_publish` automation path not yet verified end-to-end (Domain 8: mass redaction → library).
- No public-facing pagination on large record lists `[to verify under load]`.
