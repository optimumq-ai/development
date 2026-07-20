# Optimum Q — Application Domain Map

> ⚠️ **2026-07-20 — PIPELINE/STAGE DEVELOPMENT IS STOPPED** pending a design session (Kevin: *"before more
> development takes place as I believe we've been applying changes that might break when code is revised"*).
> Read `KEVIN_2026-07-20_revised_architecture_and_rules_project.md` FIRST. Task **screens** remain safe.

Derived 2026-07-08 from a structural scan of ALL backend routes (36), services (40+), connectors (11), and frontend pages (37). This is the master index for domain-by-domain spec consolidation. Structural only — file presence, not verified functionality.

**Spec status:** ✅ ALL 12 DOMAINS CONSOLIDATED (2026-07-08). Specs: SPEC_*.md

> ⚠️ **READ FIRST BEFORE ANY PROCESSING-PIPELINE WORK — `TARGET_process_model.md` (2026-07-19, DRAFT).**
> The specs below describe the pipeline **as built**. Kevin's stated target model differs on several points
> (task-driven rather than stage-driven flow, `fee_review` as a real step, payment as a *status* rather than a
> position, bypass as a first-class completion, parent-level fee calculation across children). Until that
> document is ratified, **do not infer design intent from what the code currently implements** — that
> reasoning deleted a wanted stage on 2026-07-19. Task screens are safe to continue; stage-vocabulary and
> branch modelling are not.

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
**Go-live readiness / setup wizard / configuration gating (CAPTURED 2026-07-19, BUILD LATER):** `DESIGN_go_live_readiness.md` — what exists (wizard BUILT but gates nothing outside itself; attestation mechanism BUILT with ZERO attestations; `dev_mode=1` bypassing the one enforcement point), Kevin's go-live checklist requirement, and the gates-vs-wizard timing split. Reads with `AUTO_CONFIG_DESIGN.md` (trust model, go-live gate decided HARD), `ONBOARDING_TAXONOMY_GATING.md` (two-key licensing), `JURISDICTION_PROFILE_DESIGN.md` (attestation build + why hard-gating was deferred), and `BUSINESS_LEGAL_IP_LOG.md` (contract checklist, [FOR COUNSEL]). ⚠️ Records a fresh-install defect: the schema seeds 6 phases without `fees` and never writes `requires_review`, so a new install does NOT reproduce the live wizard.

**Parent/child model + lifecycle vocabulary (STORAGE MODEL BUILT 2026-07-16; corrected here 2026-07-19):** `SPEC_parent_child_lifecycle.md` — always-wrap parent/child with an asymmetric field split; the five axes (Stage · Task state · Outcome · Hold · Clock); **record-hold (child) vs clock-hold (parent)**; per-record withholding log. Reconciles `ARCHITECTURE.md` item 1 with `SPEC_tasks_roles_mrr_fees.md` §12, which contradicted each other. **Read it before touching stages, clocks, holds, or closure.** Live data now contains real children, so `andParent`/`andLeaf` are load-bearing rather than tautological — a query that looks correct against pre-migration data can be wrong now. **Still open:** the MRR hub (§14.3, design-gated), suggest-vs-commit child routing (§14.2 — children auto-commit today), the parent field-design pass (§4.4), and the MRR classification roll-up (§6). **Known spec-vs-code divergence:** §4.3 puts money at the parent; the code keys it on the child, which makes non-payment dunning inert for wrapped requests — see `WORKING_attribute_inventory.md` (working snapshot of what is actually built).

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
