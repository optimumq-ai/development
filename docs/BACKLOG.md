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
4. [DONE] Apply redaction server-side - jimp bakes black into page raster (true redaction), pdf-lib reassembles + paints each box a reading-order INDEX NUMBER (white) + appends a VAUGHN INDEX (numbered columnar table: No./Page/Exemption/Legal Authority/Basis-from-rule-description, with wrapping + pagination; box number correlates to index row; per-box numbering; no-rule box -> "Manual redaction"); output saved as redacted request_file. DONE: release recorded into fulfilled_records; searchPublicReady (Tier 1 of searchAll) keyword-matches it so released records surface first (publicReady:true). GET /api/redaction-jobs/released lists the index. Released Records page (/released, elevated, sidebar) lists the index with stat cards, client-side filter, and per-record Download.
5. Auto-suggest (assist, not default) - pattern detection (SSN/DOB/phone) + AI. PRESENT APPROACH BEFORE BUILDING (Replit AI zone-discovery was unreliable -> manual stays the default; auto-suggest is assist-only). [DONE - text layer] AI content detection: POST /api/redaction-jobs/file/:fileId/discover -> zoneDiscovery sends page text + approved/active rules menu to claude-sonnet-4-5, gets exempt {text,rule_id} spans, locates each in the extracted word boxes (exact contiguous normalized match) -> SUGGESTED boxes placed on the real text (coords correct by construction, no guessing; the deleted-Replit-build behavior). Workspace: "Find exempt content (AI)" button, dashed amber suggestion boxes, sidebar Accept/Dismiss/Accept-all -> accepted becomes a real numbered zone. Verified on 1095-A: names/addresses/SSNs found, 0 unmatched, SSN auto-mapped to SSN rule (names/addresses came back ruleless because those rules are still pending-not-active). [DONE] box ADJUSTABILITY: zone bodies are draggable (move) with 4 corner resize handles; live preview, PATCH /zones/:id now accepts x/y/w/h to persist on mouseup (window-level mousemove/mouseup listeners + dragRef). [DONE] LABEL->AI-RULE: per-box "Describe field, AI picks rule" input + POST /api/redaction-jobs/suggest-rule -> claude-sonnet-4-5 maps the description to the best approved+active rule (verified: "driver's license number"->Motor Vehicle Record Info, "patient diagnosis"->Medical, plain "name"->no match as expected). [DONE] SCANNED docs: tesseract-ocr 4.1.1 + eng installed on droplet. docProcessing.js now OCRs any page with a rendered image but no native text layer: pngSize() reads PNG pixel dims, ocrPage() runs `tesseract img stdout --psm 3 tsv`, parses level-5 word rows (conf>=35) into normalized {t,x,y,w,h} word boxes + line-aware text, stores them in document_pages.words/text with new column ocr=1 (added live + in schema.postgres.sql; has_text_layer=1 means "has words" native-or-OCR). Verified end-to-end on a manufactured image-only PDF: both pages OCR'd, AI discover found names/addresses/SSNs with 0 unmatched, addresses->Home Address rule, SSNs->SSN rule, boxes on real OCR'd coordinates. (tesseract prints a harmless "no word list" stderr warning.) Remaining nicety: suggestion boxes are still accept-then-adjust (ephemeral suggestions not draggable until accepted).
6. Layout Profiles application - save zone template for a recurring form, reuse. [STARTED -> Mass Redaction Tool below]

MASS REDACTION TOOL (layout/box path) - build in progress:
- [DONE] Template model on layout_profiles (extended w/ source_file_id, source_filename, layout_fingerprint, safety_threshold, processing_manager_name/email, updated_at). Zones JSON [{page_no,x,y,w,h,rule_id,label}].
- [DONE] API /api/redaction-templates: create (now builds a JSON layout fingerprint {v,name,pages,tokens} - the form's static vocabulary, pure numbers dropped so filled values don't count), list, get, patch, soft-delete, POST /:id/apply {file_id} = single CONSUME path, GET /:id/candidates (PDF files not already redacted), and POST /:id/apply-batch {file_ids,commit}. Single apply refactored into shared applyTemplateToFile helper.
- [DONE] Authoring UI: "Save as Reusable Template" button + modal on the redaction workspace; Mass Redaction page (/mass-redaction, elevated, sidebar) lists/deletes templates.
- [DONE] BATCH PROCESSING + DRIFT CHECK: POST /:id/apply-batch runs the template over many files. safetyScore() = % of the template form's vocabulary present in the target doc (token-overlap); commit:false returns scores (the Safety Check step), commit:true redacts only files at/above safety_threshold and HOLDS the rest. Verified: two 1095-A forms scored 100 (pass), a tax return scored 37 (held); committed run redacted the 1095-A -> Fulfilled Index and held the tax return. UI: "Run batch" on each template (/mass-redaction) -> pick documents -> Run safety check (Match/Mismatch + score) -> Redact N matching -> Results with per-file Download. AI content detection ("Find exempt content") already serves the "discovery assist" role in the workspace.
- [DONE] REQUEST-FULFILLMENT AUTO-APPLY: POST /api/redaction-templates/match {file_id} scores the file against every active template (token-overlap) and returns the best one at/above its safety threshold (else matched:false). POST /:id/stage {job_id,file_id} copies a template's zones onto a draft job WITHOUT releasing (human review path). Workspace: on opening a document with no boxes yet, it calls /match and, if a template fits, shows a banner "Template X matches this document (NN%) - Apply template / Not this form"; Apply pre-places the boxes for review, then the normal Apply Redaction releases to Public Ready. No match -> banner stays hidden, manual redaction as before. Verified: 1095-A matched 100 + staged 2 boxes; tax return returned no match.
- TODO (remaining mass-redaction): Document Processing Manager email alert on held/mismatch; Deep Scan (per-doc AI scan of narrative/free-text -> Pending Review bucket); CANDIDATE detection during schema discovery (fixed layout + fixed-position sensitive fields + NO free text -> suggest as a mass-redaction "opportunity", NOT My Tasks); batch via fresh UPLOAD (current batch runs over files already in the system); record-type filtering of candidates.
- [DONE] Records-list "template available" badge: POST /api/redaction-templates/match-batch (side-effect-free; only scores files that already have document_pages, never processes/OCRs just to render a badge) -> RecordsPanel shows a "Template match: NAME (NN%)" pill on matching PDF records and turns the Redact button into "Auto-redact". Surfaces the auto-apply opportunity where records live, not only after opening the workspace. (Badge appears once a file has been processed - i.e. after it's first opened for redaction; fresh unprocessed files show no badge by design.)
- [DONE backend] FIELD/STRUCTURED path: structuredRedaction service + /api/structured-redaction (preview, apply). CSV intake; field_map [{field,rule_id}] marks exempt columns; exempt values are DROPPED before render so they never enter the output PDF (verified: withheld names/phones/addresses absent from output text while non-exempt fields present); born-redacted PDF + "Fields Withheld" index (rule + citation) -> request_files + request_history + fulfilled_records (Public Ready). [DONE UI] StructuredRedactionFieldsPage at /redact-fields/:fileId - a "Redact fields" button on CSV records (RecordsPanel) opens a column picker (checkbox per column + per-column rule dropdown + sample-value hints); Generate produces the born-redacted PDF + Fields Withheld index with a download. [DONE] reusable FIELDS templates + batch + field-name drift: layout_profiles gained kind ('pages'|'fields') + field_map; create accepts kind='fields' (stores field_map + a fingerprint of the source CSV's columns); list/get expose kind+field_count+field_map; GET /:id/candidates returns CSVs for fields templates (PDFs for pages); POST /:id/apply-batch branches on kind - for fields it scores each file by COLUMN-name overlap vs the template's columns (the field-name drift check), holds files below safety_threshold, and applies via structuredRedaction.applyFieldMap to the rest. Verified: two same-column call logs scored 100, a different-shape salary list scored 0 (held); committed run produced a born-redacted PDF with withheld values absent. match/match-batch still skip no-zone templates so fields templates don't pollute the page-records badge. UI: "Save as reusable template" on the Redact fields page (saves field_map + source CSV); Mass Redaction lists fields templates with a FIELDS badge + field count and runs them via the same Run batch flow (kind-aware candidates show CSVs). TODO: connector-row ingestion adapter; daily scheduled batch; fields auto-apply (match) on opening a CSV record.
- ORIGINAL DESIGN NOTES - FIELD/STRUCTURED path (separate intake mode): for connector/structured data (e.g. 911/CAD), a "field map" template (which fields are exempt) + render-to-PDF (redact data FIRST, render LAST -> output born redacted, value never enters the file); field-name drift check (incoming fields vs approved set); daily scheduled batch -> Public Ready. Reuses pdf-lib + Vaughn Index. Two intake modes (pages vs fields) share one candidate list, rules/citations, Vaughn Index, and Public Ready destination.

### BUILT (2026-06-10): Mass-redaction job queue - durable, resumable, chunked background worker (commits aa9d547 backend, 31c68ac frontend)
Turns mass redaction from a synchronous in-request batch into a real background job system, so a user can drop a large pile of files (or many CSVs), point a template at them, and let the system grind through a chunk per night until done. Co-designed with Kevin (the "human factor" volume conversation): ONE durable resumable chunked job + ONE shared nightly budget + a visible ETA; the after-hours window, cross-department contention, and "capacity reached, scheduled for X" all fall out of that single model as properties.

Backend:
- Tables: mass_redaction_jobs (template_id, kind, file_ids JSON, total/processed cursor, redacted/held/error tallies, chunk_size, window_start/end, priority, status queued|running|paused|completed|canceled|failed, error_log) + mass_job_budget (day PK -> used; the shared nightly counter). system_config seeds: mass_redaction_nightly_budget=500, window 18:00-06:00, after_hours_only=true. Both tables in schema.postgres.sql.
- services/massJobs.js worker: tick() fires every 60s, gates on the processing window (handles overnight wrap; SERVER-LOCAL/UTC time - see TODO) and the shared nightly budget, then advances each active job in priority-then-FIFO order by min(chunk_size, remaining budget, items left). Reuses the EXACT same drift-check + apply engine as the sync batch (pages: ensure processed -> safetyScore -> hold-if-below-threshold else applyTemplateToFile; fields: fieldsScore on column overlap -> hold else structuredRedaction.applyFieldMap). Resumes from the processed_items cursor; in-memory lock prevents overlap. redactionTemplates.js now exposes .engine for this reuse.
- routes/massJobs.js (/api/mass-jobs): POST create, GET list (computed ETA = ceil(remaining / min(chunk,budget)) nights + est date), GET :id, POST :id/pause|resume|cancel, POST :id/run-now (force one chunk now, ignores window, still counts budget). server.js mounts it and calls startWorker() at boot.
- Verified end-to-end: 3-file job, chunk size 2, processed across two ticks (background + forced) with NO double-processing (cursor lock held), two 1095-A redacted + tax return held on drift, budget counted to 3, completed, correct ETA. All test artifacts cleaned.

Frontend:
- MassJobsPanel (top of Mass Redaction page): live monitor - per job a progress bar, X/Y, redacted/held/error tallies, ETA (nights + est date), and Pause/Resume/Cancel + "Run a chunk now"; polls every 8s; header shows the nightly window + shared budget.
- "Schedule job" button on each template -> file picker -> schedule form (job name + docs/night) with a live "N docs -> X/night -> finishes ~date" preview -> creates the job. The existing synchronous "Run batch" flow is unchanged.

REMAINING / next-steps to discuss with Kevin:
- BIG SINGLE STRUCTURED DATASET (the 25k-row 911 CSV case): the queue currently chunks by FILE COUNT (works for a folder of PDFs or many CSVs). Chunking ONE massive dataset at the ROW level needs the data-index output decision we discussed (render rows into a searchable public-ready DATA INDEX with PDFs on demand - NOT one giant PDF, NOT 25k PDFs). Not yet designed/built.
- BENCHMARK to set real budget numbers: budget is currently a raw item count (default 500). Should be measured WORK-UNITS, since field-data is cheap and per-PDF/AI-scan is expensive. Offer: generate ~100k synthetic rows, time field-drop-to-index vs per-record render on the droplet, replace the estimate with real numbers.
- WINDOW TIMEZONE: the after-hours window is evaluated in server-local (UTC) time, not Central. Refinement before customers rely on the exact window (add a tz config / store agency tz).
- Document Processing Manager email alert on held/mismatch (partly blocked: email is test-mode -> only admin@optimumq.ai until the optimumq.ai domain is verified at Resend).
- Connector-row ingestion adapter (live feed -> job items), and record-type filtering of candidates.

### MEASURED (2026-06-10): Mass-redaction throughput benchmark on the live droplet (1 vCPU, serial)
Ran a pure-compute benchmark to replace the placeholder nightly budget with real numbers. Three cost regimes:
- FIELD-DATA transform (drop exempt columns -> index row): ~153,000 rows/sec. Effectively free; a 25k-row 911 file is <1s of compute. Real limit is DB write speed, not CPU -> bulk field-data jobs are NOT compute-bound.
- PDF-PER-RECORD (born-redacted one-pager via pdf-lib): ~142 PDFs/sec (~7ms each). Cheap render-on-demand; confirms we should render on demand, not pre-render millions.
- PER-PAGE RASTER (pdftoppm 150dpi + jimp bake/encode): ~709 ms/page raster + ~1,130 ms bake = ~1.8 sec/page. THE binding constraint. Scanned docs add tesseract OCR on top (heavier still).
Implication: in a 12h window on 1 vCPU, page redaction does ~20k pages/night raw; for typical 5-15pp PDFs that's ~1,400-4,300 files/night. Set default mass_redaction_nightly_budget 500 -> 2000 (conservative, leaves headroom for the live app + OCR overhead). Field-data jobs could safely run far more than 2000/night.
REFINEMENT (proposed, needs Kevin): budget is still a single FILE-count cap, but a page and a record differ ~1000x in cost. Right model = separate lanes/units: a HEAVY lane metered in pages (~15-20k pages/night) for raster/OCR/AI-scan, and a LIGHT lane for field-data that's effectively unmetered. Ties into the big-single-dataset (row-index) design.

### DEFERRED (build LAST, after feature functions are complete): Workflow Routing & Smart Routing
Not defined in detail in any spec beyond a one-line placeholder in TAXONOMY_MODEL_v2.md (record-type -> dept/queue; employee-level "later", granularity open). Captured here from Kevin's verbal spec (2026-06-10) so it's ready for the workflow phase. DECISION: do not build routing now; finish each feature's own function first, then build workflow/routing as the final step.

NORMAL ROUTING (role-based + claim):
- Hardcoded workflow rules route a request to a ROLE defined in workflow (not just a department).
- Exactly one person in that role -> auto-assigned to them.
- Multiple people in the role -> the task shows on ALL their My Tasks lists with a "Click to claim" button; claiming makes that person the owner and drops it off the others' lists.
- This claim/role primitive is REUSABLE for redaction-review tasks and any other assignable work, not just requests.
- Current state: requests carry department_id + a single manual assigned_to; My Tasks = your dept's requests + your assignments. Gaps: role targeting, the claim->owner mechanic.

SMART ROUTING (optional AI overlay, OFF by default):
- A free-text "Specialization" info box on each USER (entered via a button on their Staff Management line), AND the same kind of info box on each DEPARTMENT and each TEAM.
- Flow: hardcoded rules decide the route as usual; THEN, if smart routing is toggled on, the system compares the request description against the specialization text (of people / departments / teams) with AI; on a HIGH-CONFIDENCE match it OVERRIDES the hardcoded decision and routes to that person/dept/team instead.
- Example: a part-time mounted-police barn manager (specialization: "horses, mounted police, barn") is the only one who knows mounted-police records; a matching request overrides the default police-department role routing and goes straight to him.
- Depends on: the normal-routing claim/role primitive, the specialization fields (user + dept + team), a global on/off toggle, and an AI match step at routing time.

BUILD ORDER for this phase: (1) claim + role fan-out primitive; (2) wire redaction-review (and other) tasks onto it; (3) specialization fields on user/dept/team; (4) the AI smart-routing override + toggle. Open decision to settle then: workflow-config granularity (a screen mapping request types -> target roles, vs. a simpler department-default-role).

NOTE: the redaction review screen's `review_stage` (editing -> pending_review -> released, + an "in_review"/in-process state to add) is the per-task status backbone this routing will surface in My Tasks. The review feature can be finished standalone now (begin-review status flip + add/delete/approve panel); only its automatic appearance in My Tasks waits on routing.

### DEFERRED (part of the routing phase): Special Routing (captured 2026-06-15, from Kevin's description)

Purpose: let leadership flag certain sensitive / high-profile request topics so that a matching
incoming request is HELD and a designated high-level person (e.g., the mayor) is notified - so they
can be aware, discuss processing strategy, or direct it (e.g., to litigation) before normal work
proceeds. Neutral framing only: the feature is called "Special Routing"; it is simply a hold-and-
notify-on-match. Keep it simple.

Mechanism: a specific application of the Smart Routing AI-description-matching engine (above). An
incoming request's description is compared by AI against the configured Special Routing entries; a
high-confidence match triggers it.

UI: a "Special Routing" tab on the main screen. Inside, a section to configure individual entries,
each with:
  - a DESCRIPTION of the content to match (the text AI matches an incoming request description
    against), e.g. "xyz contracts, payments, donations";
  - the NAME of the person who requested the special routing (who it's on behalf of);
  - the NAME + EMAIL of the person to notify when it triggers.
  - (active flag implied.)

On trigger (high-confidence AI match):
  - the request PAUSES / is held in Open Records;
  - an email notification is sent to the designated person;
  - further processing requires MANUAL assignment of the additional processing tasks (no automatic
    advance while held).

Worked example (for the leadership demo): an entry created at the mayor's request with text
"xyz contracts, payments, donations" should match a request whose description is
"all donations from xyz corporation mentioned in email, text message, as well as contracts with
xyz, payments to xyz, etc."

Depends on: the Smart Routing AI-match step (shared), a notification email path (Resend - currently
test-mode, domain verification deferred), and a hold/pause state + manual-task-assignment in the
workflow. Build with the routing phase.

### DEFERRED (part of the routing phase): Redaction Handling Routing - tiered, default + exceptions (captured 2026-06-15, from Kevin's description)

Goal: offload redaction + redaction-review from the legal team for the predictable majority of
documents, while keeping legal's attention concentrated on the genuinely sensitive minority. The
failure mode to AVOID is a full per-document-type path matrix (a decision for every type x every
content situation) - cumbersome, confusing, error-prone. The model that stays simple is
"DEFAULT + EXCEPTIONS," not a decision table.

HANDLING TIERS (keep small, ~4; these are the output of the routing decision):
  - Tier 0 - Releasable as-is, no redaction (already flagged on record types via auto_release_eligible).
  - Tier 1 - Team handles fully: a trained team member redacts AND self-reviews; legal never sees it.
  - Tier 2 - Team redacts (best effort), legal does a mandatory FINAL review/sign-off.
  - Tier 3 - Expert from the start: route straight to legal/expert; team effort would be wasted
    (typically: no reusable redaction template exists and content is not predictable).

TWO LAYERS DECIDE THE TIER:
  1. DEFAULT TIER PER DOCUMENT TYPE - but the platform PROPOSES it rather than forcing the city to
     hand-set all ~82 types. Two strong signals already exist: (a) does a reusable redaction TEMPLATE
     exist for the type, (b) the type's sensitivity/predictability profile in the taxonomy. Template +
     predictable -> propose Tier 1; no template + unpredictable -> propose Tier 3. Human reviews and
     adjusts only the edges. This removes most of the config burden.
  2. CONTENT-TRIGGERED ESCALATION RULES (overlay) - the Smart Routing description mechanism applied to
     redaction. A SMALL set of plain-language entries, e.g. "anything involving a police matter",
     "a building permit connected to a sexually-oriented business". When the AI content scan (the same
     zone-discovery scan that finds exempt content) reads a retrieved document and matches a rule, it
     BUMPS the request UP a tier. These handle only the EXCEPTIONS, so they need not be exhaustive.

SAFETY PRINCIPLE (the property that makes automation trustworthy): escalation is FAIL-SAFE and
ONE-DIRECTIONAL - it only ever moves toward MORE review, never less, and any AI uncertainty also
escalates. Worst case of a wrong AI call = "legal reviewed something it didn't strictly need to"
(mild inefficiency), never "sensitive content released without legal review" (catastrophic). This
asymmetry is what lets a city automate the easy ~80% and concentrate legal on the hard ~20%.

TIMING: the type-based DEFAULT tier can be known early (at classification/intake); the CONTENT
escalation can only fire AFTER records are retrieved and scanned - which is the correct time, since
that is when the documents are actually in hand.

CAPABILITY FALLBACK: Tier 1/2 presume the fulfillment team has a member with a "trained redactor"
capability. If the team has no such member, it falls back to legal automatically - another fail-safe.
The redactor capability is a role/skill on the team member (ties to the routing-phase role primitive).

POLICY NOTE: the tier definitions, type defaults, and escalation topics are the CITY's policy to
define (what legal exemptions apply to what content is their legal judgment); the platform only
operationalizes the policy they set - it does not decide the law.

Depends on: Smart Routing AI-match step (shared), the AI content scan (built), reusable redaction
templates (built), taxonomy sensitivity profile (built), the role/capability primitive + task
assignment + hold states (routing phase). Build with the routing phase.
