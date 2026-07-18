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

### 3.1 The leaf-fact bug class — ~~fix this first~~ **DONE 2026-07-18 (n), and the list below was wrong**

> **CORRECTION.** The table in the original brief was assembled from a grep sweep, not from reading the
> implementations. Checked against the code, **only one of its six entries was a real bug** — and it was worse
> than described, while a seventh problem it barely mentioned turned out to be the serious one. Recorded here
> because the wrong version of this list would have sent a session chasing four non-bugs.

**REAL — and now fixed.** `GET /requests/:id` was a raw `SELECT r.*` with no parent resolution. The
consequence was sharper than "shows a suffixed number": **there was no id you could pass that returned a
correct, complete picture of a request.** Proven live against `2026-000002` (a 3-child MRR):

| Row addressed | `request_number` | `is_mrr` | `stage` |
|---|---|---|---|
| the parent | `2026-000002` ✅ | `1` ✅ | **`null`** ❌ |
| each child | `2026-000002-N` ❌ | **`0`** ❌ | `intake` ✅ |

So the workspace either knew who the citizen was or knew what the work was, never both — and the **MRR badge
silently vanished** on exactly the screens where staff do the work, because `requestCreate` forces
`is_mrr = 0` on every child. Fixed by resolving parent-level facts through the parent
(`scope.parentFact`), leaving description/stage/routing on the row addressed. Verified across all 11 live
rows including the legacy unwrapped `SYS-`/`LIBRARY` containers.

**NOT BUGS — the brief was mistaken:**
- **`routes/clocks.js`** is a thin passthrough to `tolling.js`, which resolves to the parent at **every**
  entrypoint (`parentOf` / `RESOLVE_SQL`). Its own comment says this is enforced in the engine *deliberately*,
  "because there are five call sites and only one invariant." Correct as written — do not "fix" it.
- **`/tasks/mine`, `/tasks/:id`** already resolve `request_number` through the parent via
  `numberExpr`/`numberJoin`. Real gap is smaller and different: `is_mrr` is not selected at all.
- **`requestor_name` / `deadline_date` read off a child** are **true copies by design**, not stale reads.
  `requestCreate` copies citizen identity down to every child, and `tolling.writebackDeadline` cascades the
  deadline to children *on purpose* so leaf-scoped worklists can display it. Verified identical on all live rows.

### 3.1b Money is keyed on the CHILD — the real leaf-fact bug `[OPEN, DESIGN-GATED]`
The one the original brief reduced to a parenthetical. **All 17 `/fee-estimates/request/:requestId`
endpoints** use the id they are handed with **zero** parent resolution (39 raw uses), `paymentStatus.js` has
none either, and `EstimateTaskPage` passes **`task.request_id` — the child**. Money is a PARENT fact
(CLAUDE.md, `SPEC_parent_child_lifecycle` §4.2).

For the 3-child MRR above that means **three independent money pots and a parent that owns none**: three
estimates, three deposit ledgers, three payment states, and no request-level total to bill the citizen for.
Not fixed here because it contains a genuine design question — **how do n children's fees roll up into one
citizen bill?** — which is the same question the design-gated MRR hub (§14.3) exists to answer. It should be
decided with that, not patched underneath it. Note this is latent, not yet damaging: live money is all zero
because no request has reached `fee_review`.

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

**Phase 0 — foundation (no new screens).** ~~§3.1 leaf-fact pass~~ **DONE (n)**; lock down §3.3 and add the
stub-safe advance path; §3.2 `legal_review` resolution route. Small, high-leverage, and everything after
inherits it. §3.1b (money on the child) is deferred to the MRR-hub design, not to Phase 0.

**Phase 1 — decide the canonical flow (§5.1).** Which stages are in the v2 path. Cheap now, expensive once
ten screens hang off it.

**Phase 2 — the skeleton.** One screen per task type in stage order, each with the same three parts:
*(a)* a request-context header reading **parent** facts, *(b)* whatever evidence the task needs, *(c)* one
primary action that calls the central transition. Blank-but-real is the goal.

**Phase 3 — thicken by priority**, replacing stubs with real screens; retire the v1 duplicates (§2.3).

**Parallel track — the demo fixture importer (§7).** Independent of the phases and useful from Phase 2 onward,
since it is what puts requests at stages the system has never reached.

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

---

## 7. Demo/test fixture importer `[SCOPED, NOT BUILT]`

**Ask** (Kevin, 2026-07-18): a tool to import ~30 requests from a spreadsheet, **overriding the submitted
date** — and payment dates — so time budgets, overdue status, and payment state compute normally. He can enter
30 requests by hand in an hour; what he cannot do by hand is fake the dates.

### The shape matters more than the tool

**Rejected: spreadsheet → INSERT into mid-pipeline states with chosen dates.** This is what the project rule
against direct inserts exists to prevent, and the reason is not purity — it is that **derived state would not
cohere**. Deadlines, tolling, `task_events`, budget burn and `request_history` would each be computed from a
different notion of "now," producing statuses that cannot actually arise in the product. The fixture would
then be the thing being debugged.

**Adopted: a replay tool with an injectable clock.** Each row is created through the ONE creation helper and
then driven through **real** transitions and real payment paths in order, with an "as of" timestamp supplied
to each step. Time travel, not row forgery. Every fixture request therefore carries authentic history,
clocks and task events — it genuinely *is* a request submitted 40 days ago, so overdue and budget burn are
correct because they are computed from real facts rather than asserted.

### The one hard part: a settable time source

The code currently takes "now" from whatever writes it. Known obstacle to check FIRST, before estimating:
**`task_events` is written by a DB trigger**, with `assigned_at` / `in_progress_at` / `done_at` denormalized
onto `tasks` (`SPEC_tasks_roles_mrr_fees.md` §2.1). Whether that trigger stamps `now()` or accepts a supplied
value decides the size of this build. Same question for `tolling` clock starts and `request_history`.

### Spreadsheet shape (sketch)

Per row: submitted date · requestor · description · record type · delivery/fee choices · then an **event
script** — e.g. `routed +2d`, `estimate sent +5d`, `deposit paid +9d`, `search complete +21d` — with amounts.
The tool walks the script, advancing the injected clock per step.

### Non-negotiables

1. **Structurally incapable of running against live.** Guard it the way `tests/testEnv.js` already guards the
   harnesses — a tool whose entire purpose is manufacturing backdated requests must not be able to point at
   production. (See the (m) note: live now contains real tester data.)
2. **The spreadsheet lives in the repo.** The win is not the saved hour, it is **reproducibility** — rebuild
   the demo DB on demand, tweak one scenario, get identical output. Thirty hand-entered requests evaporate
   the next time the schema moves.

### Why it pays for itself here

It is also the **test corpus for this whole effort**: it puts requests at stages the system has never
reached. Today only `intake`, `record_search` and `delivery` have ever been exercised by real data (§2.1),
so the entire mid-pipeline — fee review, awaiting payment, the legal branches, redaction — has no specimen to
build a screen against.
