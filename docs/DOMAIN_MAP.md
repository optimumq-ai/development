# Optimum Q — Application Domain Map
Derived 2026-07-08 from a structural scan of ALL backend routes (36), services (40+), connectors (11), and frontend pages (37). This is the master index for domain-by-domain spec consolidation. Structural only — file presence, not verified functionality.

**Spec status:** ✅ ALL 12 DOMAINS CONSOLIDATED (2026-07-08). Specs: SPEC_*.md

## 1. ✅ Public Portal & Intake Agent
Citizen-facing entry: landing, AI chat agent (phases, quick replies, MRR detection, fee capture), form fallback, portal search.
`publicChat.js, requests.js(/public)` · Pages: PublicPortalPage · Related: classify

## 2. ✅ Public Ready Records Library
Public browse/search/map of released records; auto-publish path.
`repositories(public browse), files, semanticSearch(public)` · Pages: PublicLibraryPage, PublicLibraryMapPage, ReleasedRecordsPage

## 3. ✅ Taxonomy & Classification
Record-type taxonomy (84 types), synonyms/intent, AI classifier, routing confidence, schema discovery.
`taxonomy.js, classify.js; classifier, schemaDiscovery, embedIndex, voyageEmbed` · Pages: TaxonomyPage, SchemaDiscoveryPage
Open: variant-level granularity decision (held by Kevin).

## 4. ✅ Tasks, Roles & My Tasks — `SPEC_tasks_roles_mrr_fees.md`
Task lifecycle, routing (smart/pool/load-balance), roles, My Tasks, notifications, health scoring.
`tasks.js, staff.js; taskRouting` · Pages: MyTasksPage, EstimateTaskPage, StaffManagementPage

## 5. ✅ Request Lifecycle & Workflow Engine
Stages, workflow rules/nodes, triage, assignment, history, clocks/deadlines/tolling, tickler.
`requests.js, workflow.js, workflowModel.js, clocks.js, tickler.js; workflowEngine, deadlineCalc, tolling, tickler` · Pages: RequestQueuePage, RequestWorkspacePage, NewRequestPage, WorkflowPage, WorkflowMapPage, WorkflowSimulatorPage, TicklerPage, DashboardPage

## 6. ✅ Fees, Estimates & Payments — `SPEC_tasks_roles_mrr_fees.md` (intake/waiver) 
Fee engine (jurisdiction rules), estimate profiles, notices, accept/decline/deposit, payments/settlement/cash drawer, objections, nonpayment, waiver.
`feeEstimates.js, feeProfiles.js, feeSandbox.js, estimateProfiles.js, objections.js, settlement.js; feeEngine, feeNotice, feeNonpayment, feeRelease, paymentStatus, paymentTiming, erpSettlement, estimateProfile, feePolicyExtract` · Pages: FeeConfigPage, CashDrawerPage
Note: engine/payment/objection internals NOT yet consolidated — only intake/waiver/profile concept covered.

## 7. ✅ Record Search & Fulfillment
Staff-side search across repositories/connectors, semantic search, record selection, fulfillment.
`semanticSearch.js; recordSearch, embedIndex` · Pages: (record-search task screen NOT BUILT — known gap)

## 8. ✅ Redaction
Manual workspace, templates/profiles, rules & exemption library, structured redaction, AV/video redaction, mass redaction jobs, zone discovery, review/approval.
`redactionJobs.js, redactionRules.js, redactionTemplates.js, structuredRedaction.js, avRedaction.js, massJobs.js; redactionApply, avRedactionApply, structuredRedaction, zoneDiscovery, massJobs, ruleDiscovery` · Pages: RedactionWorkspacePage, RedactionReviewPage, RedactionRulesPage, MassRedactionPage, AvWorkbenchPage, StructuredRedactionFieldsPage
**Built-vs-designed reality:** `REDACTION_GROUND_TRUTH.md` (2026-07-11) — engine (AI read, template match, burn/release, legal escalation) is real; complexity tiers, reviewer assignment, and clean-record bypass are designed-only/absent. Trust it over the SPEC_redaction docs for "what runs today."
**Automation model (decided, not built):** `SPEC_redaction_automation.md` (2026-07-11) — per-file disposition (bypass/simple/standard/elevated/legal) derived from read-time signals; mandatory review for elevated+legal; broad auto-bypass; computed eagerly at redaction-stage entry.

## 9. ✅ Sources, Imports & Connectors
Record Sources model, import ingestion (drop-folder/watermark/scheduler), connector registry (11: axon, tyler, laserfiche, nena911, email, filestore, keyword, paperindex, structured, demo, registry), document processing/extraction.
`repositories.js, integrations.js, extract.js; importIngest, docProcessing, recordMetaExtract, connectors/*` · Pages: SourcesPage, IntegrationsPage
Known: import-vs-connector confusion (Kevin flagged; redesign candidate).

## 10. ✅ Jurisdiction & Configuration
Jurisdiction profiles (state law), system config, onboarding wizard, config freshness, agent rules, decision reasons.
`jurisdictionProfile.js, config.js, configFreshness.js, onboarding.js, agentRules.js, decisionReasons.js; jurisdictionProfile, effectiveConfig, configExtractors, configFreshness` · Pages: JurisdictionProfilePage, ConfigurationPage, SetupPage, RuleUpdatesPage

## 11. ✅ Reporting & AI Help
ARIA/AI reports, report engine, dashboards, in-app help agent.
`reports.js, help.js; reportAgent, reportEngine, helpAgent` · Pages: ARIAReportsPage, AIReportingPage, AIDataFlowPage

## 12. ✅ Auth, Security & Platform
Login/auth, secrets, departments/teams, email/Resend, geocode, PM2/nginx/Postgres+pgvector ops.
`auth.js, staff.js, departments.js; auth, secrets, email, emailTemplate, geocode` · Pages: LoginPage, SecurityPage, DepartmentsPage
Existing docs: DOCUMENT_PROCESSING_SECURITY.md, PRE_RELEASE_HARDENING.md.

## Suggested consolidation order (demo-value first)
1. **§5 Request Lifecycle** — the spine everything hangs on
2. **§8 Redaction** — biggest surface, core demo value
3. **§3 Taxonomy** + **§7 Search** — the "find the record" half of the demo
4. **§1 Portal** + **§2 Library** — citizen-facing (recently reworked, likely closest to spec)
5. **§9 Sources/Imports** — known-confused area, needs reconciliation before redesign
6. **§6 Fees deep pass** · **§10 Config** · **§11 Reporting** · **§12 Security**
