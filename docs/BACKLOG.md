# Backlog / Ideas to Consider

Running list of enhancement ideas captured during build sessions. Not yet scheduled.

## Discovery -> Redaction integration (captured 2025-06-08)

Enhance AI Discovery so record-type discovery and redaction setup go hand in hand:

- When discovery runs, create a **snapshot of the record types** found (point-in-time record of what was discovered/proposed).
- During the **review** step (approve/reject of discovered drafts), add two options per record type:
  1. **Generate a redaction template** for that record type, derived from its structure, expected content, and sensitivity (public_availability / auto_release_eligible). The type already encodes which exemptions are plausible, so a starter template can be proposed automatically.
  2. **Generate a mass auto-redaction process + scheduling** for records of that type - a recurring/bulk redaction job.

Rationale: once a record type is approved, we know its structure and sensitivity - exactly what is needed to draft a redaction template and configure scheduled bulk redaction. These pair naturally with the approval step rather than being separate later work.

Related: docs/FEATURE_context_aware_redaction.md.

## Native Source Search / Portal Fallback Search (captured 2025-06-08, from Replit prototype design)

When the public-portal AI search returns no results - OR the user reviews AI results and finds no match - a "Search Connected Systems" button appears. It opens an in-portal search panel that queries each connected source system DIRECTLY via that system's own (keyword-level) search mechanism, NOT Optimum Q's AI semantic index. Results display inside the portal (no leaving the app), grouped by source, each with record title, date, and a brief description where available.

Behavior:
- Covers all active connected sources (e.g. Building Permits, Police Reports, Council Minutes).
- Record found -> user can view/download directly. Still no results -> prompt to submit a formal records request.
- Rationale: the semantic index can miss records that are not semantically similar to the query, are awaiting re-indexing, or use terminology the user recognizes on sight but did not phrase the same way. A direct keyword-level fallback catches those gaps before the user gives up or files an unnecessary formal request.
- Production: each source exposes a search API (Tyler, Accela, police RMS) called through its registered connector. Prototype: queries the file-based local repositories.

Reconciliation with current build:
- This is the "native per-connector keyword search" mode, distinct from the (future) pgvector AI semantic index. Three search modes total: AI semantic index (future, blocked on pgvector+Voyage), native per-connector keyword search (this feature), and the current portal chat path.
- recordSearch.searchAll() already fans a query across active connectors and is wired into the public portal chat (publicChat.js) - the natural host for the button.
- To build: portal "Search Connected Systems" button + results-grouped-by-source panel + empty-state CTA to submit a formal request; expose connector search explicitly as a keyword fallback (separate from the AI-ranked path); real per-source search() in each connector for production systems.

Audience clarification (2025-06-08): the original wording ("a user reviews the AI results", "a search panel within the Optimum Q interface") spans BOTH a public-portal citizen AND an internal staff user - not citizen-only. Treat as one shared search capability with two contexts:
- Portal/citizen: found -> view/download; none -> CTA to file a formal records request.
- Internal/staff (in the request workspace): found -> mark responsive / attach to the request being fulfilled; none -> continue fulfillment.
Same engine (recordSearch native keyword mode across connectors) and same results-grouped-by-source panel; differing entry point, permissions, and what happens to a found record. Build as one shared search component with two thin wrappers.

### STATUS UPDATE (2025-06-08): Native Source Search - PORTAL CONTEXT BUILT (commit e24bcac)
- BUILT: shared keyword matcher (connectors/keyword.js); nativeSearch() on demo, filestore, tyler, axon; recordSearch.nativeSearchAll() (grouped by source, relevance floor 30); public endpoint POST /api/public/native-search; portal UI on PublicPortalPage.js (trigger appears after any AI search via lastSearchQuery; overlay panel with refine-keywords input, results grouped by source, view/download + include-in-request reusing toggleRecord/selectedRecords, empty-state CTA to file a formal request). Tested across all sources via curl + nginx; frontend compiled + live.
- REMAINING: (1) internal/staff wrapper in RequestWorkspacePage (same engine; outcome = mark responsive/attach to the request; staff permissions). (2) Real view/download wiring (placeholder alert, shared with AI cards). (3) structured connector has no nativeSearch yet (skipped gracefully).

### UPDATE (2025-06-08): Native Source Search - source-picker model (commit 8d7bf28)
Panel now opens to a MENU of connected systems (each with a public, citizen-facing description) plus an "All connected systems" option; requestor picks the system that fits, then keyword-searches within it (change-system back step). Dissolves the data-vs-DMS tension - interaction is uniform (pick then search); only the description text differs per source. Added record_repositories.description; public GET /api/public/sources (falls back to connector-type description when blank); optional sourceId on /native-search. Admin Sources screen has a "Public description" field with an amber callout stressing the text is requestor-facing. NOTE: sources show the connector-type fallback text until an admin fills in real public descriptions.

### BUILT (2025-06-08): Paper Records Index connector + record-type medium/fulfillment dimension (commits c254090, c350a9f)
Answers the "things you cannot search for" + "paper records" design questions.

Paper Records Index (commit c254090):
- New connector type `paper-index` (registry.js). Admin adds the source, then imports a CSV index of physical files (Sources screen -> "Import index", paste CSV; columns title/description/location/box/folder/date/tags, title required, re-import replaces). Backend: paper_index_items table; connectors/paperindex.js nativeSearch returns each record's physical LOCATION (facility/box/shelf) with publicAvailability='paper' (no download; retrieved on request); recordSearch.nativeSearchAll injects repo id into config + includes paper-index in the connector map; import/list routes at /repositories/:id/paper-index (requireAuth). Portal cards render a PAPER badge + location line. Appears in the source picker like any other source. Seed: seed_paper_archive.sql (repo-paper-archive, 5 sample items).

Medium / fulfillment dimension (commit c350a9f):
- record_types.fulfillment_method (electronic_search | paper_index | manual_collection | bulk_export) and medium (electronic | paper | mixed). Existing non-searchable types classified (email/texts/memos/legal opinions/911 audio/body+dash video -> manual_collection; GIS + system data exports -> bulk_export). Added example types mobile-device-data (manual_collection) and forensic-images (bulk_export). Taxonomy page shows a fulfillment pill for non-electronic types; RecordTypeEditor has Fulfillment method + Medium dropdowns; taxonomy POST/PATCH accept the fields. Seed: seed_rt_fulfillment.sql.

REMAINING / follow-ups:
- AI handling: the portal agent / classification does not yet USE fulfillment_method to set citizen expectations (e.g. "these are paper records in storage - retrieval takes longer, copy fees may apply" or "text messages are collected from devices, handled as a manual collection"). This depends on taxonomy-first routing (the agent mapping a request to a record type). Highest-value next step for this dimension.
- Real view/download wiring is still a placeholder alert on electronic result cards (paper correctly shows none).
- structured connector still has no nativeSearch (skipped gracefully in native search).
- paper-index has no scan() (not discoverable for record-type discovery yet).

### BUILT (2025-06-08): Portal agent sets expectations for non-searchable records (commit ea976ad)
Closes the top follow-up from the fulfillment/medium work. publicChat.js builds a "setting expectations" section from the live taxonomy each turn (record_types with manual_collection/bulk_export + active paper-index sources) and appends it to the agent system prompt. The agent now proactively, warmly tells citizens what to expect: manually-collected records (email, texts, 911 audio, body/dash cam) take longer; bulk data exports are generated by staff with possible fees; older PAPER records are in the records center and retrieved by hand (longer turnaround, modest copy fees, + a pointer to the "Search connected systems" option); sensitive/confidential records get a redaction review. Verified to trigger for texts/emails and ~1990 paper permits and to stay quiet for ordinary current digital records. Stays in sync as admins reclassify record types. Note: agent occasionally uses markdown bold in replies - consider a no-markdown tone rule if the portal renders raw text.

## Document Processing & Redaction (in progress)
Build sequence (grounded in Replit lessons: manual drag-drop is the DEFAULT, server-side processing, Layout Profiles separate from Exemption Reference Library):
1. [DONE] Document-processing foundation - render pages to PNG (pdftoppm 150dpi) + extract text/word boxes (pdftotext -bbox, normalized 0-1). Table document_pages; routes POST /files/:fileId/process, GET /files/:fileId/pages, GET /files/page-image/:pageId. needsOcr flag set when a page has an image but no text layer (scanned -> tesseract later).
2. [DONE] Redaction data model + Redaction Rules Library (rules + 8 categories + legal_sources many-to-many + pending->approved workflow; API at /api/redaction; aligned to prototype spec (approval_status + is_active separate, 8 category codes, source_document/effective/expiration fields, semicolon-split legal basis stored normalized, activate/deactivate/delete). AI auto-population DONE (on-demand): POST /api/redaction/discover asks the model for jurisdiction-appropriate exemptions not already present, inserts as source=ai/pending_review/inactive drafts with legal_sources.statute_text; UI "Check for Updates" button + AI-suggested badge. STILL TODO: periodic scheduler gated by auto_redaction_rules_update, 6-month reminder emails (redaction_update_reminder_days), and ordinance-upload extraction mode.). Original line: - redaction_jobs, redaction_zones (page, normalized x/y/w/h, exemption_id, type manual|auto), exemption_reference_library (legal bases), layout_profiles (zone templates, positions only).
3. [DONE] Manual redaction workspace UI - /redact/:fileId: render page, drag boxes, attach rule per box, page nav; Redact button on PDF files in RecordsPanel.
4. [DONE] Apply redaction server-side - jimp bakes black into page raster (true redaction), pdf-lib reassembles + white category labels + Documentation Sheet; output saved as redacted request_file. TODO: record release into Fulfilled Request Index (Tier 1 search seam still returns []).
5. Auto-suggest (assist, not default) - pattern detection (SSN/DOB/phone) + AI. INSTALL tesseract here for scanned docs (needs sudo apt; archive.ubuntu.com allowed).
6. Layout Profiles application - save zone template for a recurring form, reuse.
