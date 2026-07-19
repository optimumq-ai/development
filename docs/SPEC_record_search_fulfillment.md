# Consolidated Spec — Domain 7: Record Search & Fulfillment
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]`

## 1. Search engine (recordSearch) `[BUILT]`
Layered pipeline, shared by the portal agent, public library, and staff document search:
1. **Public-ready first** — keyword search over released+published `fulfilled_records`, always runs, never taxonomy-narrowed, with a **relevance floor** (min token matches) to kill false positives; results carry `publicReady:true` and sort to top.
2. **Semantic** — pgvector cosine over embeddings joined to released+published records.
3. **Hybrid taxonomy router** — maps the query to the most likely record type to narrow scope: cheap keyword pass for clear matches → AI classifier for ambiguous ones (toggle `portal_search_ai_routing`, default ON); **soft prioritization, never hard exclusion**.
4. **Live connectors** — queries fan out to connectors with the `search` capability (Tyler Munis, Laserfiche, Axon Evidence, demo). Axon results labeled as body-worn/in-car camera footage; the full body-cam path verified end-to-end against the live Axon stub.
5. **AI relevance judge** (`judgeResults`) — post-search pass (temperature 0) drops wrong-kind results; results carry `semantic`/`relevanceNote` markers.

## 2. Connector capability model `[BUILT]`
Registry declares per-connector **capabilities**: `scan` (record-type discovery — filestore, structured) vs `search` (queryable for records — tyler, laserfiche, axon). Purposes: storage / live / av. Config fields defined per connector (endpoint, api_key, path). Full connector inventory: Domain 9 spec.

## 3. Staff-facing search surfaces `[PARTIAL]`
- **Workspace "Search Documents" tab** `[BUILT]` — `/semantic-search/documents` (query, optional requestId, topN) inside RequestWorkspacePage.
- **Record-type semantic match** `[BUILT]` — `/semantic-search/record-types`.
- **Dedicated record-search TASK screen** `[NOT BUILT]` — the record_search task exists and routes (Domain 5), but opening it lands on the generic request-detail view. The task screen (search → review results → select record → mark found/not-found → hand off to redaction/delivery) is the known build. Much of the machinery it needs (§1) already exists.

## 4. Selection → fulfillment path `[PARTIAL]`
- Citizen-side: records selected during portal intake are persisted on the request (Domain 1 §2.5) `[BUILT]`.
- Staff-side: found records flow to redaction (job → burn → released PDF + doc sheet → `fulfilled_records`) `[BUILT — Domain 8]`.
- **Release gate at delivery** `[BUILT]` — entering `delivery` checks the pre-release balance (feeRelease); holds records until settled; fails open.
- Formal per-record **found / not-found resolution** ~~(feeding the MRR Partially-Granted roll-up)~~ `[BUILT 2026-07-14 — see SPEC_record_search_task_screen §5d]` — `POST /tasks/:id/resolve` enforces `found` (at least one record included, all R9 intents answered) or `no_records` (requires an evidenced effort trail), then advances through the central transition.
  > ⛔ **The MRR Partially-Granted roll-up it once fed was RETIRED 2026-07-16 by Kevin** `[corrected 2026-07-19]` — the parent has **no disposition and no outcome**. The per-record resolution states stand on their own; the terminal outcome lives on the CHILD (`SPEC_parent_child_lifecycle.md` §5.8).

## 5. Known gaps
- Record-search task screen `[NOT BUILT]` — the domain's one big build; demo-minimal version = request context + §1 search + select + mark found/complete.
- Explicit found/not-found resolution states `[NOT BUILT]` — prerequisite for MRR roll-up.
- Email count-only search exists at intake (Domain 1); staff-side email search surface `[to verify in Domain 9 email connector]`.
