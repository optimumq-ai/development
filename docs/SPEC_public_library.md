# Consolidated Spec — Domain 2: Public Ready Records Library
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DEFERRED]`

## 1. Library page (citizen) `[BUILT — redesigned 2026-07-07]`
Header: title + subtitle, top-right CTA "Didn't find what you were looking for?…" with **Open Records Portal** button → `/portal?start=request` (straight into the intake chat). Body order: "Click to browse Records Library" heading → departments in a fixed-height **scroll well** (click-to-drill, chevrons, count pills) → search block ("Enter a description and click Search…") → map section ("View public records by location on map" + **View Map** button). Text scaled to portal weight. Drill-down: department → record types → records → record detail (download link if a file is attached), breadcrumbs throughout; scroll-well pattern at every level; year-filter chips on record lists.

## 2. Publication model (staff) `[BUILT]`
`fulfilled_records` is the released index (Fulfilled Request Index). A record enters it when a redaction job is applied ("burn" → released PDF + documentation sheet, `review_stage='released'`). **Publishing is a separate, explicit toggle** (`published` flag, with published_at/by): released-to-requestor ≠ public. Unpublishing removes public discovery only. Staff manage this on ReleasedRecordsPage (`GET /released`, `POST /released/:id/publish`). Record types carry an `auto_publish` flag surfaced alongside `[flag exists; auto-publish automation to verify in Domain 8 pass]`.

## 3. Public endpoints (no auth — public reading room) `[BUILT]`
All under `/api/public/*`: `/browse` (dept → type tree with counts; only `status='released' AND published=1`), `/browse/records` (records for a type, optional year), `/library/search` (public search), `/library/map` (map pins), `/file/:id` (download of the released output file). Every public query is gated on released+published.

## 4. Public search pipeline `[BUILT]`
Keyword + semantic (pgvector/voyage) over published records with a score floor; post-search **AI relevance judge** (`recordSearch.judgeResults`) drops wrong-kind matches; results carry `semantic`/`relevanceNote` markers. Same engine backs the intake agent's Phase 2.5 search.

## 5. Map view `[BUILT]`
`/library/map` returns pins only for records that are released AND published AND of a **mappable** record type AND geocoded (lat/long present) — the mappable flag + publish gate is the deliberate surveillance guardrail. Includes map anchor config (geocode service). Pin popup: title/summary/date + "View record" file link. Page: PublicLibraryMapPage.

## 6. Known gaps / notes
- Library page department boxes will scroll at ~15 departments as designed; drill-down levels reuse the scroll-well.
- `auto_publish` automation path not yet verified end-to-end (Domain 8: mass redaction → library).
- No public-facing pagination on large record lists `[to verify under load]`.
