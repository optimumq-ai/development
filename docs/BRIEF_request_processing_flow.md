# Brief — Rebuilding the request-processing flow

**Status:** SCOPING ONLY — nothing here is built. Written 2026-07-18 from a live inventory of the running
system (DB census + backend sweep + staff-screen sweep), not from the specs — **the specs are substantially
out of date on this domain** (§6).

**The ask** (Kevin, 2026-07-18): the v1 processing UI is confusing; the schema changed under it; some task
screens exist, some don't. Start a new process flow, and to move fast, mock blank "click to approve" screens
for task types that have no UI yet. This brief establishes what actually exists so that decision is made
against facts rather than memory.

---

## 1. The headline: the spine is sound, the surface is not

The instinct to keep the backend and restart the flow is **well-founded by the evidence**:

- **`applyStageTransition` (`services/taskRouting.js:349`) is genuinely central.** An exhaustive grep of
  `src/`, `server.js` and `scripts/` found **exactly one** `SET stage` in the entire codebase — inside that
  function. All 16 call sites route through it. It writes `request_history`, spawns the stage task, cancels
  open tasks on close, and clears the tickler flag on forward moves.
- **Stages have one source of truth** (`services/stages.js`), 10 of them, with the frontend mirror
  parity-tested (`tests/verify_stages.js`). The old ghost stage is grep-enforced to zero.
- **The suite is green at 745/0** and censuses live before/after.

So this is **not** a rewrite. It is a new surface over a working spine, plus a bounded set of repairs
(§3) that must land first or the new surface inherits the same confusion.

---

## 2. What exists, honestly

### 2.1 Stages (10) — `services/stages.js`
`intake → fee_review → awaiting_payment → record_search → exemption_review → ag_review →
redaction_review → redaction → delivery → closed`

Only `intake`, `record_search`, `delivery` have ever been reached in live data. The mid-pipeline is
**untested by real traffic**.

### 2.2 Task types — 11 spawnable, and three disagreeing catalogs

| Task type | Backend complete? | Staff screen | Verdict |
|---|---|---|---|
| `record_search` | **Yes** — strongest gating in the codebase | `RecordSearchTaskPage` — most complete screen | Real |
| `redaction` / `legal_redaction` | **Yes** | `RedactionTaskPage` — full workstation | Real |
| `redaction_qa` | **Yes** | `RedactionTaskPage` | Real, but mis-catalogued (§3.5) |
| `estimate` | **Yes** — most complete backend suite | `EstimateTaskPage` — **47-line wrapper, no completion ceremony** | Semi-stub |
| `fee_waiver` | **Yes** | none — falls through to `/requests/:id` | Needs screen |
| `routing_review` | **Yes** | none — falls through | Needs screen |
| `legal_review` | **NO — spawns, nothing completes it** | none | **Broken** (§3.2) |
| `review_auto_redaction` | **NO route** | links to `/mass-redaction` | Half-built |
| `commercial_rate` | nothing spawns it | **invisible on My Tasks** | Dead catalog entry |
| `mrr_processing` | nothing spawns it | **invisible on My Tasks** | Dead catalog entry |
| `mrr_estimate`, `mrr_search` | not built | — | Not built |

Three catalogs disagree: `TASK_ROLES` (8), `ROUTABLE_TASK_TYPES` (9), and the `time_budgets` seed (8, and it
is the one that matches reality). `redaction_qa` is real but absent from `ROUTABLE_TASK_TYPES`;
`commercial_rate`/`mrr_processing` are in it but unspawnable.

### 2.3 Screens
**Real and working:** `RequestQueuePage` (best parent/child handling in the repo), `DashboardPage`,
`MyTasksPage`, `TicklerPage`, `RecordSearchTaskPage`, `RedactionTaskPage`, `MassRedactionPage`,
`ReleasedRecordsPage`, `StructuredRedactionFieldsPage`, `AvWorkbenchPage`, and every workspace panel.

**Duplicates (v1, superseded):** `RedactionWorkspacePage` (`/redact/:fileId`) and `RedactionReviewPage`
(`/redact/:fileId/review`) do what `RedactionTaskPage` does task-aware. Both still reachable.

**Orphan:** `components/ui/TaskPoolSection.js` — imported nowhere; its link map would misroute record-search
tasks. `App.js:54-62` defines a `Soon()` component that is never referenced.

### 2.4 Live data (2026-07-18)
11 requests (6 parents / 5 children), 6 tasks, 0 orphans, 0 dangling FKs, 0 null request links.
**`2026-000003` is a real tester submission** (portal, 18:11 today) and the only request ever to reach
`record_search`, with a live claimed task on it. **Do not purge it** — prior sessions habitually
created-and-purged smoke requests; this one is genuine and is the natural specimen for this work.

Three legacy `SYS-`/`LIBRARY` pseudo-requests carry a stage directly on a parent with no children. They
predate parent/child and **any parent→child join silently drops them**.

---

## 3. Repairs that must land before new screens

These are why processing "feels impossible to sort out." Each is small; together they are the difference
between a new flow that clarifies and one that inherits the fog.

### 3.1 The leaf-fact bug class — *fix this first*
Parent facts (`request_number`, `is_mrr`, requestor, money, statutory clock) are being read off **child**
rows, so screens show a citizen-invisible suffixed number and duplicated facts:

| Screen | Reads off the child |
|---|---|
| `RequestWorkspacePage` | `request_number`, `is_mrr`, requestor, `deadline_date`, `fee_waiver_requested` — `GET /requests/:id` is a raw `SELECT r.*` with no parent resolution |
| `MyTasksPage` | `requestor_name`, `deadline_date` (number is correct) |
| `RecordSearchTaskPage` | requestor, `deadline_date` |
| `EstimateTaskPage` | requestor; money keyed on child id |
| `routes/feeEstimates.js` | never imports `requestScope` at all |
| `routes/clocks.js` | **zero** parent/child scoping, though the clock is a parent field |

**One backend pass over `GET /requests/:id`, `/tasks/mine` and `/tasks/:id` fixes four screens at once.**
Do it before building anything new, so new screens inherit correct facts by construction. (This is the
long-standing "leaf-fact reads" backlog item, now enumerated.)

### 3.2 `legal_review` spawns but can never complete
`spawnForStage` creates it at `exemption_review`/`ag_review`; **no route resolves it**; the reconciler keeps
re-creating it; the redaction-family idempotency guard ignores it, so a request can carry an open
`legal_review` *and* an open `redaction` at once. They only clear when the request hits `closed`.

### 3.3 `POST /tasks/:id/complete` is a loaded gun — **and it is the trap for the stub plan**
`requireAuth` only. **No ownership check, no type check, no stage side-effect.** Any authenticated user can
mark any task done, stranding its stage.

> **This is precisely the endpoint a "click to approve" stub would reach for.** If the stubs call it, every
> stub will *look* like it works and will quietly strand the request. **Stubs must go through
> `applyStageTransition`** so they write history and spawn the next task like the real thing. Then a blank
> screen is a genuine node in the flow and replacing it later is a UI change, not a rewrite.

### 3.4 No from-`closed` guard
`applyStageTransition` will revive a closed request. The only defense is an ad-hoc re-read in
`workflowEngine` (added when the `verify_stage_bypass` flake was fixed). Any other caller can resurrect a
terminal request. Consider hoisting that guard into the central function.

### 3.5 Routing split-brain
- `redaction_qa` is excluded from `ROUTABLE_TASK_TYPES`, so it is pinned to legacy permission-role routing
  forever, while its Legal sibling routes on the new model.
- `GET /tasks/pool` checks only `user_permission_roles`; `taskRouting.poolForUser` checks both that and
  `user_task_types`. **Two divergent pool queries** — a user whose eligibility comes only from the v3 subset
  sees an empty claim pool.
- `review_auto_redaction` spawns with `role_required` NULL, and NULL is treated as "everyone eligible" —
  **world-claimable by any authenticated user.**

### 3.6 Two fragile couplings
- Estimate spawning keys on the **literal rule id `'wfr-confident'`**. Reseed or rename that row and estimate
  tasks silently stop being created — no error, no log.
- `fee_review` is task-bearing in practice but is in **neither** `STAGE_TASK` **nor** the reconciler's sweep
  list, so a request stranded there with no estimate task is invisible to self-healing forever.

---

## 4. Proposed sequence

**Phase 0 — foundation (no new screens).** §3.1 leaf-fact pass; lock down §3.3 and add the stub-safe
advance path; §3.2 `legal_review` resolution route. Small, high-leverage, and everything after inherits it.

**Phase 1 — decide the canonical flow (§5.1).** Which stages are in the v2 path. Cheap now, expensive once
ten screens hang off it.

**Phase 2 — the skeleton.** One screen per task type in stage order, each with the same three parts:
*(a)* a request-context header reading **parent** facts, *(b)* whatever evidence the task needs, *(c)* one
primary action that calls the central transition. Blank-but-real is the goal.

**Phase 3 — thicken by priority**, replacing stubs with real screens; retire the v1 duplicates (§2.3).

---

## 5. Decisions needed from Kevin

1. **Is the 10-stage order the flow you want**, or is v1's sequence being inherited by default? In
   particular whether `exemption_review` / `ag_review` are always-on or city-configurable.
2. **Do stubs auto-approve, or require a note?** A required note costs nothing now and leaves an audit trail
   that explains why a request moved during the skeleton period.
3. **Single-record first, or the MRR parent hub too?** The hub (§14.3) is design-gated and the queue's
   parent line is deliberately inert today.
4. **`commercial_rate` / `mrr_processing`** — build, or remove from the catalog? They are currently
   assignable to people and produce permanently empty pools.
5. **The v1 redaction duplicates** — retire now or leave until the flow settles?

---

## 6. Doc debt (project rule: specs are the contract)

The specs describe a **pre-centralization world** and will actively mislead anyone building from them:

- `SPEC_tasks_roles_mrr_fees.md` §13 says the centralized-transition fix is *deferred* and root cause *not
  isolated* — it describes the absence of what is now the architecture's centerpiece. Single most
  out-of-date sentence in the docs.
- `SPEC_request_lifecycle_workflow.md` §1 lists **8** stages; §5 of the same document lists 10. Code has 10.
- `TASK_AND_NOTIFICATION_MODEL.md` §8 lists `build_redaction_template` as implemented; it exists nowhere in
  `src/` and a test asserts it is **never** created. It omits four live task types.
- `MASTER_task_types_permission_groups.md` decision #1 says the legal stages spawn no task; line 23 of the
  same file says `[BUILT]`.
- **No doc records** that `applyStageTransition` emits **no notifications**, mass-cancels tasks on close, or
  has no from-`closed` guard. All three are load-bearing.

Recommend correcting these **as each phase touches them** rather than in one pass — the same-commit rule
then does the work incrementally.
