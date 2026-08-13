# Consolidated Spec — Domain 11: Reporting & AI Help
**Current design only.** Verified against code + DB on 2026-07-08; metrics updated 2026-08-13.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]`

## 1. Deterministic report engine `[BUILT]`
Takes a bounded query SPEC and **computes the numbers in code — the model never writes SQL**. Read-only, fixed table/column whitelist; same spec → same result. Returns title/viz/columns/rows/note.

Metric catalog (`reportEngine.js` METRICS): `request_count`, `fee_revenue`, `overdue_count`,
`avg_processing_days`, `compliance_rate`, `self_service_rate`, and two added 2026-08-13:
- `workload_health` — the same 1/2/4 lateness scoring the dashboard heat grid uses
  (`services/workloadHealth.js`, Tasks spec §4); grouped by team or task node.
- `high_priority_mrrs` — every open MRR a Request Manager has flagged HIGH PRIORITY
  (parent-child spec §14.4 item 6). One row per flagged parent: items open · estimate readiness ·
  statutory respond-by date · who flagged it; sorted soonest-due first. Point-in-time, no grouping.
  Due dates come through `mrrHub.parentClocks` (computed from started_at + duration through tolls) —
  never from a stored column, so the report can never disagree with the hub master screen.

## 2. ARIA — NL → spec translator `[BUILT]`
Natural-language ask → the model ONLY **chooses from a catalog** (metrics, groupings, time presets, filters) to produce the bounded spec; the engine computes. Pre-built reports use the same spec path (`/prebuilt/:key`). Pages: ARIAReportsPage, AIReportingPage, AIDataFlowPage.

## 3. In-app AI help assistant `[BUILT]`
Grounded in a curated, accurate description of the app's real features/navigation with anti-hallucination guardrails. Stated upgrade path: swap the static context for retrieval over a real documentation corpus (Voyage/pgvector) once docs exist — the twelve domain specs are that corpus `[upgrade NOT BUILT]`.

## 4. Known gaps
- ~~Management dashboard of task-node health per team~~ `[BUILT 2026-08-13 — health scoring shipped (Tasks spec §4); dashboard heat-grid pane + `workload_health` metric]`.
- ~~High-priority MRR monitoring report~~ `[BUILT 2026-08-13 — `high_priority_mrrs` metric, §1 above; flag itself in parent-child spec §14.4]`.
- Help-agent retrieval upgrade `[NOT BUILT]`.
