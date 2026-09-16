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
**Screens `[BUILT 2026-09-15 — slice 2]`.** Record Sources cards carry the census line (last census · files · groupings ·
scans read by OCR · drift "n new, m changed since — refresh from Inventory" · running progress with the two passes · "No census
yet" · "Census not available for this connector") and ONE **Inventory** door (Kevin); Delete is disabled while a census reads
the source; the list polls every 3 s while any census is open. `/setup/record-sources/:id/inventory` (`SourceInventoryPage`):
header with Perform/Refresh census (the only place a census starts), progress + phase text, drift; never-censused state; stat
row (files · fingerprinted with text/OCR split · unreadable · unsupported by type · groupings + ungrouped); file-type bar;
Identical groupings table (name or "Unnamed grouping N" + folder hints · exact count · layout · record type › variant with
draft note, or "Not yet associated" · redaction-template posture pill + the three doors — "Start a redaction template" WORKS
today via the Mass Redaction stage-example path, "Redact by hand" / "No redaction needed" / "Associate" are drawn disabled
until slice 3 · View sample); "Everything else" expands to a plain file list with unreadable/unsupported tags; linked record
types as a bucket › variants tree with per-source counts; census history with pass timings; the layout-not-meaning note.
**View sample** modal: the document's first page rendered server-side (`GET …/inventory/file/:fp/preview.png`, pdftoppm,
cached under `uploads/processed/census`), previous/next through the grouping's examples, the label set, where they live,
status, the doors, and "Open the full PDF".
**Association + the three doors `[BUILT 2026-09-15 — slice 3; verify_census_association 31/31]`.** `services/censusAssociate.js`, routes under
`/repositories/:id/groupings/:gid/…`, source-config gate for every write. **Associate** (an unassociated grouping): `suggest` is the
ONE paid step of the inventory flow — one small claude-sonnet-5 call with two first-page excerpts + the label set + the count against the
active catalog, answering `match` (an existing type/variant, or null) and `propose` (a new variant under a bucket); it writes nothing.
`associate` is the human approval and the only writer: mode `existing` stamps the documents, links the type to this source, and stores
the signature on the type if it has none (marked `signature_source`); mode `new_variant` goes through `applyGroupingProposal` (draft
variant, counted, mass-redaction candidate by layout, stamps, link, signature). `DELETE …/associate` undoes: unstamps, drops the source
link when nothing else here carries the type, and FORGETS the signature this association taught (otherwise the next census would
quietly re-associate by recognition — found by the harness). **Redact by hand** (`POST/DELETE …/redact-by-hand`): the Mass Redaction
dismiss, honestly named — `discovery_meta.redact_by_hand = {by, at}`, `mass_redaction_candidate = 0`; undo restores the flag by layout.
**No redaction needed** (`GET …/no-redaction/check`, `POST/DELETE …/no-redaction {reason}`): a RELEASE decision written to the variant
(`public_availability = releasable`, `auto_release_eligible = 1`), guarded — the parent bucket's `legal_redaction_required` must be off
(a legal gate never loosens at a more specific level), the bucket must not be restricted/confidential, not already decided, reason ≥ 10
chars; who/when/reason and the previous posture are kept in `discovery_meta.no_redaction` and `taxonomy_audit`; undo restores the
previous posture exactly. The existing record-type-clean bypass (`redactionBypass` case c) then releases a document as-is only when the
automatic clean read finds nothing — no new release path. All writes report the taxonomy hub rows (`setupHub.afterChange`). **UI:** the
Inventory page's Associate modal (recognition → "Ask the AI what these documents are" → decision: new variant under a bucket · existing
type/variant · leave · the "on Approve" note), the No-redaction modal (release-decision banner · what still happens · the checks · "you
have viewed n of N samples" · required reason · the "on Confirm" note), Redact by hand with confirm, Undo links on decided groupings,
"Associate differently" (undo association), and the same doors inside View sample.
**Find variants reads this store and Scan source is retired `[slice 4, 2026-09-15]`** — see `SPEC_taxonomy_classification.md` §1/§4.
**Data-system census `[BUILT 2026-09-15 — slice 5; verify_kind_census]`.** For connectors that expose `listKinds` (today: `structured`, from its
JSON definition), the census enumerates record KINDS instead of files (`census_kinds`, one row per kind, stable across runs; runs carry
`census_kind = 'kinds'`): name, description, typed fields (id · number · date · text · prose — from the field name and the sample value),
sample row, `row_count` and `date_range` ONLY where the connector reports them (null otherwise — never invented). A kind whose name matches
an active bucket is associated **by name** at census time (`match_basis = 'by_name'`, shown on the row); the rest are associated by hand
(`POST/DELETE /repositories/:id/kinds/:kid/associate`, source-config gate; writes the type↔source link with format `structured_data`).
**Rendering:** a data record is not read, it is rendered — `renderRecord` composes the kind's name and up to five non-id fields into one
sentence; the values a **field redaction template** (`layout_profiles.kind = 'fields'`, `field_map` of the associated type) withholds are
blacked out BEFORE the render, so what would embed never carries them. **Embed tiers** computed per kind: 1 kind description only ·
2 prose fields present (row embedding a priced opt-in, later) · 3 never (all fields ids/dates/numbers). Row embedding itself is NOT built —
the tier is recorded and shown. Inventory answers `mode: 'data'` with `kinds[]` (fields, counts, date range, record type + basis, field
template + withheld fields, tier + prose fields, `rendered`), totals (kinds · rows where known · fields · kinds with a field template), and
the same census history; the Inventory screen shows the DataSystem artboard (kinds table, "View a rendered record", per-kind associate
dropdown, "Create one ›" to Mass Redaction for the field template). Search-only systems (Laserfiche, Tyler, Axon, 911 emulator, email,
paper index) remain not censusable until their APIs enumerate.
**Not yet:** row-level (tier 2) embedding of data kinds; extractor registry beyond PDF (docx/xlsx/images/CAD metadata) — every other file
type is counted as unsupported today; a census for search-only systems.

**Inventory row — item 7 S1 `[BUILT 2026-09-16]`.** Each associated grouping row now also carries: `redaction` widened to
`proposed` (a worker's template awaits a supervisor — Approve › / Return › on the row), `holds` (active template on a
`floating` variant; S4 pre-places, never burns), `assisted` (an active `content` profile); `redaction_detail` (the template
behind the posture: id, kind, `provisional`, proposer, request); `layout_class` (confirmed on the variant) and
`layout_class_proposed` (what the census would say, shown as "Static?" until confirmed); and `estimate` — the second status
column (`none` · `seeded` · `learned` n, `inherited` from the parent when the variant has no row). The Taxonomy list carries the
same `estimate` chip on every row (`attachEstimate`) so "which types still need an estimate" needs no click-through.

## 5. Known gaps / decisions
- **Source deletion is unguarded** (found 2026-09-14, `docs/DESIGN_setup_interdependencies.md` §2/§5): `DELETE /repositories/:id` is a bare row delete — `record_type_repositories`, `document_fingerprints`, `paper_index_items`, `request_files.repository_id` and `import_ingest_log` are left dangling. Proposed: the `orgRemoval` pattern (check → delete when clean, refuse/retire otherwise). Awaiting Kevin's go.
- ~~**Import-vs-connector presentation**~~ `[REDESIGNED 2026-08-13 — Kevin approved from before/after mockups (`exchange/sources_current.png` / `sources_redesign_mock.png`); verify_sources_list 3/3]`. The Sources screen now groups every source by BEHAVIOR, in plain sentences: **Searched the moment someone asks** (live systems) · **Watched folders — files brought in on a schedule** (imports, with "Checked nightly / Watching / Checked by hand" from config.schedule, last-run line, and a "Check now" button) · **Counted only — never opened** (email, the privacy stance stated on the group) · **Paper & physical — findable, not fetchable** (index size shown; "No index yet" warns). Every card says what the source HOLDS (linked record types by name) — `GET /repositories` now carries `linked_types` + `paper_index_count` via two grouped queries. Same data, same buttons; the editor and its config surface are untouched. NOT shown deliberately: "last searched" timestamps for live systems — no search-activity tracking exists, and the screen never invents data (recorded as a possible follow-on).
- ~~**Pseudo-request elimination** (§4) — blocked on the Notification model build (Tasks spec).~~ **DONE 2026-07-15** (§4): Notification model built, `tasks`/`request_files` request_id nullable, import files anchored by `repository_id`, `sysimport-*` rows deleted.
- "Run Ingestion" button: scheduler automation EXISTS; the button is a supplementary run-now. If fully-automatic-only is desired, hide the button per source config `[small change]`.
- Email connector is a demo stub; production email-system integration `[NOT BUILT]`.
