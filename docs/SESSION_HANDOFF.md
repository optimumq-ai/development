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

## Estimate Automation - record-type estimation profiles (BUILT) - 2026-06-22
The "manual vs automated estimate" decision (see WORKFLOW_DECISIONS.md Part 6) is now real.
- DB: `record_type_estimate_profiles` (record_type_id PK, quantities_json, stats_json [Welford per-driver {n,mean,M2}], sample_size, has_expert_seed, source, notes). In schema.postgres.sql.
- `backend/src/services/estimateProfile.js`: getProfile, seedProfile (expert seed), recordActuals (Welford running mean+variance), confidenceOf (none/seeded/low/high), assess(recordTypeId) -> {decision automated|manual, confidence, basis, quantities, estimatedTotal, depositDue, reasons[], drivers}. Prices via feeEngine.compute with the active jurisdiction's FR fee config. POLICY knobs (defaults, destined for the Jurisdiction Profile): minSample=3, maxCV=0.5, highDollar=$200. Estimates over the dollar bound force manual.
- `backend/src/routes/estimateProfiles.js` (/api/estimate-profiles): GET/:id, PUT/:id (seed, elevated), POST/:id/actuals (elevated), DELETE/:id, POST /assess.
- Wired: feeEstimates.js GET /request/:requestId attaches `autoEstimate` (assess result) per component. Frontend: components/EstimateProfilePanel.js inside RecordTypeEditor (existing types) - auto/manual banner + est $, editable typical quantities (search/review hrs; b&w/color/oversized pages), seed save, sample-size note.
- Decision ladder realized: expert seed -> automated(seeded); >=3 consistent actuals -> automated(high); noisy (CV>0.5) or <3 -> manual(low); none -> manual; over $200 -> manual. VERIFIED: service unit tests (all 5 paths) + API + estimate-context wiring.
- PENDING: historical writeback hook (call recordActuals at final/reconciliation - that step is itself PLANNED, and must use ACTUAL not projected quantities); sampling-at-discovery (7b); wire POLICY knobs to the Jurisdiction Profile UI; media quantities in the seed form.

## Workflow visualization - the model + Process Map (BUILT, foundation for the simulator) - 2026-06-22
The machine-readable form of WORKFLOW_DECISIONS.md, and the first visual surface.
- `backend/src/data/workflowModel.js`: 56 decision nodes across 10 phases + 7 terminal states + 12 policy knobs. Each node: {id, phase, label(question), decider(ai|code|human|policy|hybrid), status(built|partial|planned), trigger(event|time), criteria[], outcomes[{label,to?}], automatedBy, note}. legend carries decider colors + status colors. This is the single source the Process Map (now) and the interactive Simulator + config views (later) all read.
- `backend/src/routes/workflowModel.js` (/api/workflow-model): GET / (whole model), GET /node/:id.
- Frontend `pages/WorkflowMapPage.js` (nav "Process Map", route /workflow-map, isElev): renders all phases as cards color-coded by decider, badged built/partial/planned, clock on time-driven nodes; click a node -> detail panel (criteria, outcomes with click-through via `to`, "Configure once -> automatic" from automatedBy, note). Terminal states shown as pills (hover = notice).
- NEXT layer (the interactive simulator): walk a hypothetical request node-by-node, answer Human nodes, auto-resolve Code nodes (wire to the real engine + estimateProfile.assess for built ones), show AI proposals; backtrack & re-answer to branch; "advance the clock N days" to exercise the time-driven stall/exit nodes. The model's `outcomes[].to` edges are the spine for this.

## Workflow Simulator + enriched model descriptions (BUILT) - 2026-06-22
- Model: every one of the 56 nodes now has a plain-language `description` (merged into src/data/workflowModel.js). Surfaced in the Process Map detail panel and the Simulator.
- Read-only sim endpoint: `POST /api/workflow-model/simulate` {description, feeWaiver, sensitive} runs the REAL classifier + workflowEngine.buildSignals/evaluate + estimateProfile.assess WITHOUT persisting; returns {match, signals, rule, routedTeam, assess}.
- Frontend `pages/WorkflowSimulatorPage.js` (nav "Simulator", route /workflow-sim, isElev): enter a hypothetical request -> walks node-by-node. Built decisions resolve for real (classify-type, sensitivity, dept-confidence, route-sensitive/confident/uncertain, fee-waiver-requested, estimate-auto-manual via resolve()); the chosen outcome is tagged "what the system does" but the user can click any outcome to branch. Path trail with click-to-rewind (backtrack & change a decision). Time-driven nodes show "Advance the clock". Terminal states end the walk. Traversal: happyOrder (non-stall/cross, model order) + outcome.to edges; t- ids = terminal.
- VERIFIED sim branching: body-cam->sensitive rule; building permit 100%->confident; vague->uncertain.
- NEXT: deeper clock model for the stall/exit nodes (multi-step reminders->close using policy offsets); wire more nodes to real resolution as they get built; optional "Apply to live config" + scenario saving (spec 15.9).

## Fee-waiver grant/deny decision + reusable reason library (BUILT) - 2026-06-22
Behavior (per Kevin): deny -> send mandatory denial notice -> request CONTINUES like any normal inbound request (NOT closed). Grant -> fees waived, continues.
- DB: requests gained fee_waiver_status / fee_waiver_reason / fee_waiver_decided_by / fee_waiver_decided_at. New `decision_reasons` table (id, category, text, is_active, usage_count, created_by) seeded with 5 'fee_waiver_denial' reasons. In schema.postgres.sql.
- email.js: sendFeeWaiverDenial(req, reasonText) - branded notice, states the request remains open. (Resend test mode still only delivers to admin@optimumq.ai until optimumq.ai domain verified.)
- `backend/src/routes/decisionReasons.js` (/api/decision-reasons): GET ?category=, POST (add - dedupes, returns existing), DELETE (soft is_active=0). Reusable across categories (future: request_denial).
- requests.js: POST /:id/fee-waiver-decision {decision:'grant'|'deny', reasonId?|reasonText?} (requireRole incl. FEE_WAIVER_APPROVER). Deny: resolves reason (existing id bumps usage_count; new text is inserted into the library), sets fee_waiver_status='denied', logs FEE_WAIVER_DENIED, sends notice, keeps status active. Grant: status='granted', logs, continues.
- Frontend `components/ui/FeeWaiverDecisionPanel.js` in the Fees tab (RequestWorkspacePage): shows when fee_waiver_requested. Pending -> Grant / Deny; Deny reveals a saved-reason dropdown + an "add a new reason" textarea (new ones persist). Resolved -> shows decision + reason + "request remains open / fees waived".
- workflowModel fee-waiver-grant node -> status built, outcomes (granted/denied), description updated.
- VERIFIED end-to-end: deny with a new typed reason -> emailed=true, status stays active, library grew 5->6; library/grant paths tested.
- PENDING follow-ons: grant should make the estimate path skip fees (estimate engine could read fee_waiver_status='granted'); reuse the reason-library component on the request-denial (t-denied) path with statutory citations; optional grant-confirmation email.

## Simulator redesign: flowchart step-box + node merge (BUILT) - 2026-06-23
Per Kevin's screen-by-screen review. The step box is no longer clickable radio answers (which invited users to try non-real paths and get confused). New per-step box:
- Decider + status chips, PLUS a plain-language sentence explaining the decider type (DECIDER_EXPLAIN map: ai/code/human/policy/hybrid) - e.g. code = "An automated step - the software applies a fixed rule to the request's data and computes the answer".
- Title + description.
- Two-column "What it checks" | "This request": left = the rule criteria, right = the ACTUAL signal values from this simulated request (node-specific, only the signals that rule reads). Makes the computation transparent.
- A one-line verdict (e.g. "Confident match.", "A sensitivity flag took priority - held at Open Records.").
- ALL possible path boxes rendered side by side; the computed one highlighted (navy "SYSTEM PATH"), others muted "NOT TAKEN". NONE clickable.
- A single Continue -> button advances down the computed path only. (Trail cards still clickable to rewind.)
- Planned nodes (no live computation) show an amber "not built yet - path shown is illustrative" note and default to the primary path.
- resolve(nodeId) now returns { idx, rule[], values[{k,v}], verdict } per built node; route-confident is sensitivity-aware (shows flags + explains when wfr-sensitive took priority).

NODE MERGE (was batched tweak #4, folded in because the deterministic Continue-only walk requires coherent forward links): route-confident + route-uncertain merged into ONE node id 'route-confident', label "Can we confidently assign a team?", status partial (Smart Routing not yet wired). Outcomes: Yes -> auto-advance to Record Search at assigned team (to: fee-waiver-requested); No -> route to Open Records for manual team assignment (to: route-fallback). classify-type BOTH outcomes now -> route-confident. route-uncertain node + description removed. This matches the real engine better (one pass -> one outcome) and removes the contradictory "low confidence?" step that appeared after a confident match.

STILL PENDING (batched, NOT done): verify-email "Yes" -> "Yes . Proceed" label; connector lines darker/wider; MRR check moved ahead of record-type match (branch to Open Records, Coordinator role, specialization-or-claim); Smart Routing semantic team/user match (the shared dependency - next focused build after review). NOTE: simulator currently skips route-sensitive on the classify->assign jump, so the "Mark sensitive" checkbox surfaces only at the assign node's verdict, not its own step - candidate future tweak.
