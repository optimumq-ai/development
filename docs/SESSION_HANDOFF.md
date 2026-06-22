# Session Handoff Note

**Last updated:** 2026-06-02 (end of long planning session)

## Where the project stands

Optimum Q is functional and demo-ready as baseline. Tonight committed to **big bang v1 build** — full taxonomy + AI-assisted discovery + document indexing + vector search + FRI + Postgres migration, BEFORE sales motion. ~80-120 hours, ~15 sessions over 2-3 weeks.

## Decisions locked

- Postgres migration: do it now (Session 2)
- Embeddings: Voyage AI
- Taxonomy architecture: Choice C (Repositories + Record Types separate, linked)
- Search routing: Design 3 (two-stage — taxonomy-first, broad fallback)
- Template seeding: ~55 record types across 13 categories
- One codebase, no state-specific forks. Jurisdiction Profile data per state
- Email connector: stub for v1, real M365/Google in v2
- AI-assisted schema discovery + approval queue: INCLUDED in v1

## Decisions still open

- **Fulfilled Request Index in v1:** leaning yes (Kevin reviewing Replit doc before confirming)
- **Build sequence:** proposed sequence below pending Kevin's review

## Proposed build sequence

1. **Session 1** — Lock decisions, update design doc, create taxonomy-v1 branch, master acceptance test plan
2. **Sessions 2-3** — Postgres migration
3. **Sessions 4-7** — Foundation taxonomy + document indexing pipeline
4. **Sessions 8-10** — AI-assisted discovery + approval queue
5. **Sessions 11-13** — Search integration + FRI + email stub
6. **Sessions 14-15** — Polish + acceptance testing + demo prep

## Replit prototype documents in hand

Kevin shared three documents from his Replit prototype:
- OCR + text extraction pipeline
- Vector indexing + semantic search architecture
- Redaction workflow (request-driven + proactive batch)

Still pending from Replit: RCS Engine description, chat agent / search intake description.

## Lessons from prototype work

- AI zone discovery for redaction was unreliable in testing; manual drag-and-drop is the practical default. Design Optimum Q with manual primary, AI as experimental assist.
- Browser-side redaction processing in Replit was unintended. For Optimum Q, server-side is preferred.
- Layout Profiles (where zones sit) are separate from Exemption Reference Library (legal basis). Both deserve first-class status.

## To start the next session

1. Read this handoff doc (SESSION_HANDOFF.md)
2. Read TAXONOMY_DESIGN.md for full architecture
3. Check in with Kevin to lock Decisions 3 and 4
4. Then start Session 2 (Postgres migration)

## Tools available in next session

- SSH MCP server: optimumq-ssh:exec for commands on droplet
- Claude in Chrome: browser interaction if needed
- 1000-char command length limit on SSH MCP — write longer scripts via multiple echo appends or temp files

---

## CURRENT STATUS (2026-06-20) - supersedes the 2026-06-02 plan above

DONE since the big-bang plan: Postgres migration; taxonomy + AI schema discovery + approval queue; Agent Rules; document redaction subsystem (rules library, adjustable boxes, templates, mass-redaction queue, review screen); native per-connector keyword search (portal + paper-index + fulfillment dimension); FEE/ESTIMATE subsystem (deterministic engine, config screen, AI policy extraction, per-request estimates, projection rung 1, requestor notice + branded email template); A/V REDACTION Phase 1 (parked - see VIDEO_REDACTION.md).

BIGGEST REMAINING v1 ITEM: document indexing + AI SEMANTIC SEARCH (OCR -> chunking -> embeddings -> pgvector vector search, embeddings via Voyage AI). Blocked on a Voyage API key. This is the headline "AI-powered" differentiator and the main unbuilt piece of the original big-bang scope.

OTHER OPEN THREADS:
- MRR component-split (a master request holding child components; makes parent/child fee aggregation demonstrable; 0 children exist today).
- Workflow routing phase (Normal/Smart/Special/Redaction-handling routing; route redaction-review into My Tasks - see BACKLOG.md). The "configurable workflow engine" vision.
- Fee polish: projection rungs 2/3, accounting wrap (deposits/payments/ledger), estimate/final reconciliation, fee_profiles versioning-on-activate, AI extraction from uploaded ordinance PDF (paste-only today), manual estimate-creation screen.

SECURITY: Anthropic API key ALREADY ROTATED after the Docker exposure (done) - no longer pending.

## 2026-06-21 - pgvector enabled + semantic search wired into UI
- pgvector now LIVE (details in MIGRATION_STATUS.md). embeddings table has a real vector(1024) column + HNSW cosine index; semanticSearch.js uses the native <=> operator.
- Record-type semantic search: POST /api/semantic-search/record-types. UI = "AI semantic search" panel on the Taxonomy page (plain-language query -> ranked record types, click to open).
- Document-content semantic search (last major v1 piece): document_pages.text embedded per page via scripts/indexDocumentPages.js (22 pages indexed, owner_type='document_page'). Endpoint POST /api/semantic-search/documents { query, requestId?, topN }. UI = "Search Documents" tab on RequestWorkspacePage (components/ui/DocSearchPanel.js), scoped to the open request; shows ranked page hits w/ snippet + similarity bar + View (opens the PDF via authenticated blob).
- Re-index commands (manual/batch for now): `cd backend && node scripts/indexRecordTypes.js` and `node scripts/indexDocumentPages.js`. Both populate vec (TEXT) + embedding (vector) and use INSERT ... ?::vector.
- Real cosine ranges: strong record-type match ~0.55-0.66; strong doc-page match ~0.5-0.6. Calibrate any confidence thresholds to THESE ranges (the taxonomy design's 0.8 is too high for this model).
- NEXT / remaining: (1) two-stage routing (taxonomy-first, doc-content fallback) with a calibrated threshold; (2) optional: upgrade the public portal/agent record matching to use this same engine; (3) auto-index new uploads + new/edited record types (today indexing is a manual batch run).

## 2026-06-21 (cont.) - automatic (incremental) indexing [CLOSES the manual-index gap]
- New service backend/src/services/embedIndex.js keeps `embeddings` current automatically:
  - record types: reindexed on create / edit / single-discover (routes/taxonomy.js) and on bulk discovery scan (services/schemaDiscovery.js); embedding pruned on delete and when a type is archived.
  - document pages: reindexed whenever services/docProcessing.processFile() runs - this is the single chokepoint for ALL upload/redaction/mass-job paths, so every new document gets embedded once its text is extracted.
- All hooks are fire-and-forget via embedIndex.bg(promise,label): a Voyage outage logs an error but never breaks a save or upload.
- Batch scripts (scripts/indexRecordTypes.js, scripts/indexDocumentPages.js) remain as one-shot backfill/repair tools.
- Verified live: create -> auto-embedded + searchable (0.68); delete -> record + embedding both gone (no orphans); doc reindex idempotent.
- NEXT remaining: two-stage routing (taxonomy-first, doc-content fallback, calibrated threshold ~0.5-0.66); optional portal/agent upgrade to use this engine.

## Workflow Engine (BUILT - balanced AI + deterministic) - 2026-06-22
The routing brain. AI does what it's good at (matching + authoring); a deterministic engine executes the rulebook so routing is reproducible, auditable, explainable.
- DB: `workflow_rules` (conditions[json]/actions[json]/priority/enabled/source) + `workflow_decisions` (per-request trail). In schema.postgres.sql w/ 4 seed rules (ON CONFLICT DO NOTHING).
- `backend/src/services/workflowEngine.js`: buildSignals(request,matcher) -> evaluate(signals) first-match-by-priority -> onIntake() applies stage+team to the request and logs a decision. cmp() ops: gte/gt/lte/lt/eq/neq/in/contains/contains_any/is_true/is_false. Fire-and-forget via bg(); catch-all fallback rule => nothing is ever unrouted. Engine sets ONLY stage + department_id (does not touch classification/deadline set at creation).
- `backend/src/routes/workflow.js` (/api/workflow): GET/POST/PATCH/DELETE /rules; POST /rules/draft (AI: plain English -> structured rule, vocab-constrained); GET /decisions/:requestId.
- Wired fire-and-forget into ALL 3 intake paths: requests.js POST '/' (manual) + POST '/public', publicChat.js (passes existing `cls` to avoid a 2nd matcher call).
- Frontend: `components/ui/WorkflowDecisionPanel.js` -> "Routing" tab on RequestWorkspacePage (per-request "how this was routed" + why). `pages/WorkflowPage.js` (nav "Workflow", isElev): rulebook list w/ enable toggle + editable priority + delete, and "Add a rule in plain English" -> AI draft preview (When/Then/warnings) -> Save.
- Seed rulebook: P5 sensitive->intake (flags), P20 confident+has team->record_search/matched, P30 low conf->intake/open_records, P100 fallback->intake/open_records. TAXONOMY_CONFIDENCE=70 threshold.
- VERIFIED end-to-end: manual "body-worn camera from a traffic stop" -> matched 100% -> Confident rule -> record_search @ Police Records Unit, full trail logged. AI draft tested (mrr->hold at intake). Commit 7476555.

### Workflow follow-ons (not yet built)
- State-transition hooks: fire AI auto-redaction when a request ENTERS the redaction stage (not on a human click), since confident routing may skip record_search.
- Calibrated two-stage match (record-type first, doc-content fallback). Optionally route portal/agent matching through the same engine signals.
- More action types if needed (assign function-role, set flag, deadline override). Specialization text (already captured on users/teams) -> promote to a specific individual via pgvector match.
