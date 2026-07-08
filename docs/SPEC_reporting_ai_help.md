# Consolidated Spec — Domain 11: Reporting & AI Help
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]`

## 1. Deterministic report engine `[BUILT]`
Takes a bounded query SPEC and **computes the numbers in code — the model never writes SQL**. Read-only, fixed table/column whitelist; same spec → same result. Returns title/viz/columns/rows/note.

## 2. ARIA — NL → spec translator `[BUILT]`
Natural-language ask → the model ONLY **chooses from a catalog** (metrics, groupings, time presets, filters) to produce the bounded spec; the engine computes. Pre-built reports use the same spec path (`/prebuilt/:key`). Pages: ARIAReportsPage, AIReportingPage, AIDataFlowPage.

## 3. In-app AI help assistant `[BUILT]`
Grounded in a curated, accurate description of the app's real features/navigation with anti-hallucination guardrails. Stated upgrade path: swap the static context for retrieval over a real documentation corpus (Voyage/pgvector) once docs exist — the twelve domain specs are that corpus `[upgrade NOT BUILT]`.

## 4. Known gaps
- Management dashboard of task-node health per team `[NOT BUILT — depends on health scoring, Tasks spec §4]`.
- High-priority MRR monitoring report `[NOT BUILT — MRR spec §12.1]`.
- Help-agent retrieval upgrade `[NOT BUILT]`.
