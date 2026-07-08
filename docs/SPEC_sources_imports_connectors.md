# Consolidated Spec — Domain 9: Sources, Imports & Connectors
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DECISION]`

## 1. Record Sources model `[BUILT]`
One unified table — `record_repositories` (id, **free-text name**, connector_type, status, config JSON, description) — is the single source of truth for ALL sources; `record_type_repositories` links sources ↔ record types (many-to-many). The four-attribute design (name / location / access method / linked types): name is first-class; location + access method live in `connector_type` + `config`; SourcesPage foregrounds the free-text name with a purpose-grouped access-method dropdown.

## 2. Connector registry `[BUILT]` (11 connectors)
Declared **capabilities**: `scan` (record-type discovery) vs `search` (queryable). Purposes: storage / live / av. Inventory: **filestore** (folder path; scan), **structured** (schema+samples JSON; scan), **tyler** (ERP; search), **laserfiche** (ECM; search), **axon** (AV evidence; search), **email** (count-only), **paperindex**, **nena911**, **keyword** (shared keyword engine), **demo**, **registry**.
- **email** — returns ONLY a count, never content/subjects/senders: raw email is unreviewed, and even a subject or sender address can itself be exempt. Deliberate privacy stance (backs the intake count-then-narrow).
- **paperindex** — searches an imported index of **physical/paper records**; a hit returns the physical LOCATION (facility, etc.). This IS the paper-records distinction: paper is findable, not retrievable digitally.
- **nena911** — demonstrates the **incremental-pull** pattern: the external system accumulates records in its own store; a scheduler pulls new ones (ensureSetup + startScheduler on boot).

## 3. Import ingestion pipeline `[BUILT]`
For drop-folder (import) sources: **discovery** filters allowed extensions + a settle time; **watermark dedup** via file key (name:size:mtime) against a seen-table; **COPY, never move** (source untouched); per-file error isolation. **Both** a daily scheduler (started on boot, per-source config) **and** a manual "Run Ingestion" run-now endpoint + status exist. Managed drop-folder creation includes path-traversal sanitization.

## 4. End-to-end processing `[BUILT, with a structural wart]`
After ingest, `routeEndToEnd`: if a matching **redaction template** exists → auto-create the redaction job (→ mass path → review → library); else → spawn a **build_redaction_template** task. Record-type enrichment from ingested files (`recordMetaExtract`/docProcessing pipeline).
**The wart:** ingestion requires a request to hang work on, so each import source gets a standing **pseudo-request** (`sysimport-<repo>` / `SYS-IMPORT-...`, requestor "File Import", stage `delivery`) — the direct cause of the incomprehensible task-open experience (task click lands on a fake request's pipeline). Root cause: `tasks.request_id NOT NULL` (Tasks spec §2.2). `[DECISION: replace with request-independent Notifications + nullable task link]`

## 5. Known gaps / decisions
- **Import-vs-connector presentation** — data model is sound (one table, connector_type distinguishes; paper covered by paperindex), but the UI/concept presentation reads as "connector tweaks"; Kevin flagged a redesign of the Sources screen presentation `[DECISION pending]`.
- **Pseudo-request elimination** (§4) — blocked on the Notification model build (Tasks spec).
- "Run Ingestion" button: scheduler automation EXISTS; the button is a supplementary run-now. If fully-automatic-only is desired, hide the button per source config `[small change]`.
- Email connector is a demo stub; production email-system integration `[NOT BUILT]`.
