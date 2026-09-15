# Consolidated Spec — Domain 9: Sources, Imports & Connectors
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DECISION]`

## 1. Record Sources model `[BUILT]`
One unified table — `record_repositories` (id, **free-text name**, connector_type, status, config JSON, description) — is the single source of truth for ALL sources; `record_type_repositories` links sources ↔ record types (many-to-many). The four-attribute design (name / location / access method / linked types): name is first-class; location + access method live in `connector_type` + `config`; SourcesPage foregrounds the free-text name with a purpose-grouped access-method dropdown.

**Role gates `[BUILT 2026-08-14]`:** repository CONFIG mutations (create/edit/delete, ai-configure, paper-index import) require `SYSTEM_ADMIN`/`DIRECTOR` (the redactionConfig EDIT precedent — connecting an archive is system configuration). Running an ingest sweep (`POST /:id/ingest/run`) is processing work and takes the shared redaction gate (`middleware/auth.requireRedactionWork` — see `SPEC_redaction.md` §6). Reads stay `requireAuth`. Previously all `requireAuth` only.

## 2. Connector registry `[BUILT]` (11 connectors)
Declared **capabilities**: `scan` (record-type discovery) vs `search` (queryable). Purposes: storage / live / av. Inventory: **filestore** (folder path; scan), **structured** (schema+samples JSON; scan), **tyler** (ERP; search), **laserfiche** (ECM; search), **axon** (AV evidence; search), **email** (count-only), **paperindex**, **nena911**, **keyword** (shared keyword engine), **demo**, **registry**.
- **email** — returns ONLY a count, never content/subjects/senders: raw email is unreviewed, and even a subject or sender address can itself be exempt. Deliberate privacy stance (backs the intake count-then-narrow).
- **paperindex** — searches an imported index of **physical/paper records**; a hit returns the physical LOCATION (facility, etc.). This IS the paper-records distinction: paper is findable, not retrievable digitally.
- **nena911** — demonstrates the **incremental-pull** pattern: the external system accumulates records in its own store; a scheduler pulls new ones (ensureSetup + startScheduler on boot).

## 3. Import ingestion pipeline `[BUILT]`
For drop-folder (import) sources: **discovery** filters allowed extensions + a settle time; **watermark dedup** via file key (name:size:mtime) against a seen-table; **COPY, never move** (source untouched); per-file error isolation. **Both** a daily scheduler (started on boot, per-source config) **and** a manual "Run Ingestion" run-now endpoint + status exist. Managed drop-folder creation includes path-traversal sanitization.

## 4. End-to-end processing `[BUILT, with a structural wart]`
After ingest, `routeEndToEnd`: if a matching **redaction template** exists → auto-create the redaction job (→ mass path → review → library); else → spawn a **build_redaction_template** task. Record-type enrichment from ingested files (`recordMetaExtract`/docProcessing pipeline).
**The wart — ELIMINATED `[2026-07-15, D4/D9 #7]`.** Ingestion used to hang work on a standing **pseudo-request** (`sysimport-<repo>` / `SYS-IMPORT-...`, requestor "File Import", stage `delivery`) because `tasks.request_id` (and `request_files.request_id`) were `NOT NULL` — so a task click landed on a fake request's pipeline. **Fix:** both columns are now nullable; `request_files` gained a `repository_id` so import files anchor to their **source repository** (not a request); the "no template yet" prompt is a **Notification** to the source reviewer (Tasks spec §2.2), and the auto-redaction review stays a task with a **null** request_id. Migration re-anchored the 13 existing import files, converted the standing task to a notification, and **deleted the `sysimport-*` rows**. The request-queue now also filters `SYS-%` (was inconsistent with report metrics). `verify_notifications` 18/18.

## 6. Source census `[BUILT 2026-09-15 — slice 1 of the inventory build; verify_source_census 51/51]`
Design: `DESIGN_setup_flow_map.md` §3 step 2, `mockups/inventory_census`, HANDOFF 2026-09-04 (three rounds) + 2026-09-15 (Kevin's calls).
**What it is.** One census per source, ONE source at a time (in-process queue; a second request queues behind and reports its
position), as a background job with progress (`source_census_runs`: status queued → running → done | failed, `phase`
text → ocr → grouping, done/total files). **Taxonomy-free** — no record type has to be linked first (flow-map decision 1).
`services/sourceCensus.js`; connector capability = `listAll` (filestore only today; search-only systems answer
`available:false` with the reason — decision 5).
**What it reads.** EVERY file under the source root, **sub-folders included** (`filestore.listFiles/listAll` walk
recursively; `document_fingerprints.filename` is the path relative to the root, top-level files keep their bare name;
decision 4). Two passes: (1) PDFs with a text layer are fingerprinted from pdftotext word boxes; (2) scanned PDFs are
rendered and read by **local tesseract** (`docFingerprint.extractFeaturesOcr`, the same `docProcessing.ocrPage` the request
pipeline uses) and fingerprinted from the OCR word boxes — automatic, no opt-in, no fee, time only (Kevin 2026-09-15). OCR
features carry no title veto (glyph-box heights are content-dependent). What OCR cannot read is `kind='unreadable'`;
non-PDF files are `kind='unsupported'` — counted and listed, never skipped. **Incremental:** unchanged files (same hash,
current feature shape) are kept without re-reading (`kept_files`); new/changed/removed are counted; removed files leave the
index. `GET /repositories/:id/census` also reports **drift** (disk vs index by name and size, no hashing): "6 new, 2 changed".
**Groupings** (`census_groupings`): recognition first — a document matching ANY approved variant's stored signature (or already
stamped) is counted under that record type (an *associated* grouping); the rest are clustered at 8-of-10 (min 3) into
*unassociated* groupings. Ids are **stable** across runs (prior membership, then signature) so a grouping keeps its ordinal
("Unnamed grouping 4") and later its association. Each grouping carries exact `member_count`, `layout`, folder hints (a hint,
never a rule), and example fingerprints. Redaction posture of an associated grouping is DERIVED from its record type at read
time (`template_ready` · `no_redaction` = auto-release eligible + releasable · `redact_by_hand` = `discovery_meta.redact_by_hand`
· `waiting` = mass-redaction candidate without a template · `none`); nothing about redaction is stored on the grouping.
**The census writes nothing into taxonomy** — no record type, no link, no template (harness C11). Association is slice 3.
**API.** `POST /repositories/:id/census` (source-config gate; 202 + run id + queue position; 409 when one is open; 422 when not
censusable) · `GET /repositories/:id/census` (availability, current run + progress, last run, drift) · `GET /repositories/:id/inventory`
(the Inventory Information payload: totals, file types, groupings, the ungrouped file list, linked types with counts here,
history) · `GET /repositories/:id/inventory/file/:fp` (stream one indexed PDF; 415 for other types) · `GET /repositories` carries
`census` per source. On boot, runs left queued/running by a previous process are marked failed ("interrupted by a server
restart") — never resumed silently. Taxonomy's `preview-source-file` accepts sub-folder relative paths (still refuses `..`).
**Not yet:** the screens (slice 2), association + the three doors (slice 3), Find variants on the census store + Scan source
retirement (slice 4), data-system census (slice 5); extractor registry beyond PDF (docx/xlsx/images/CAD metadata) — every
other type is counted as unsupported today.

## 5. Known gaps / decisions
- **Source deletion is unguarded** (found 2026-09-14, `docs/DESIGN_setup_interdependencies.md` §2/§5): `DELETE /repositories/:id` is a bare row delete — `record_type_repositories`, `document_fingerprints`, `paper_index_items`, `request_files.repository_id` and `import_ingest_log` are left dangling. Proposed: the `orgRemoval` pattern (check → delete when clean, refuse/retire otherwise). Awaiting Kevin's go.
- ~~**Import-vs-connector presentation**~~ `[REDESIGNED 2026-08-13 — Kevin approved from before/after mockups (`exchange/sources_current.png` / `sources_redesign_mock.png`); verify_sources_list 3/3]`. The Sources screen now groups every source by BEHAVIOR, in plain sentences: **Searched the moment someone asks** (live systems) · **Watched folders — files brought in on a schedule** (imports, with "Checked nightly / Watching / Checked by hand" from config.schedule, last-run line, and a "Check now" button) · **Counted only — never opened** (email, the privacy stance stated on the group) · **Paper & physical — findable, not fetchable** (index size shown; "No index yet" warns). Every card says what the source HOLDS (linked record types by name) — `GET /repositories` now carries `linked_types` + `paper_index_count` via two grouped queries. Same data, same buttons; the editor and its config surface are untouched. NOT shown deliberately: "last searched" timestamps for live systems — no search-activity tracking exists, and the screen never invents data (recorded as a possible follow-on).
- ~~**Pseudo-request elimination** (§4) — blocked on the Notification model build (Tasks spec).~~ **DONE 2026-07-15** (§4): Notification model built, `tasks`/`request_files` request_id nullable, import files anchored by `repository_id`, `sysimport-*` rows deleted.
- "Run Ingestion" button: scheduler automation EXISTS; the button is a supplementary run-now. If fully-automatic-only is desired, hide the button per source config `[small change]`.
- Email connector is a demo stub; production email-system integration `[NOT BUILT]`.
