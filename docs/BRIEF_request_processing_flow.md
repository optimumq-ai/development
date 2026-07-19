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

### 2.1 Stages (10 in the vocabulary, 8 in the sequence) — `services/stages.js`
**Sequence** (the linear walk, what Advance follows):
`intake → fee_review → awaiting_payment → record_search → redaction_review → redaction → delivery → closed`

**Branch** (`[revised 2026-07-19]`): `exemption_review` / `ag_review` are real stages but are **not steps** —
entered by asserting an exemption, left by a legal decision. `next()` returns null for both, so no Advance
button renders on them.

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

**Duplicates (v1, superseded):** ~~`RedactionWorkspacePage` (`/redact/:fileId`) and `RedactionReviewPage`
(`/redact/:fileId/review`) do what `RedactionTaskPage` does task-aware. Both still reachable.~~
**RESOLVED 2026-07-19 (`2057e46`) — and this entry was HALF WRONG, which is the useful part:**

- `RedactionReviewPage` — genuinely superseded, **DELETED**. Its only inbound link was a button on the v1
  workspace; `RedactionTaskPage` has its own side-by-side.
- `RedactionWorkspacePage` — **NOT a duplicate, KEPT.** It is the canvas for redaction **TEMPLATE authoring**:
  samples uploaded from `MassRedactionPage` onto `req-template-samples` (`SYS-TEMPLATE-SAMPLES`), a protected
  pseudo-request with **zero tasks by design**. `RedactionTaskPage` is keyed on a `taskId` and cannot serve
  it. A banner in the file now says so, so the next sweep does not delete it on this entry's say-so.
- **What was actually duplicated was an ENTRY POINT, not a page:** the per-record `Redact` button on the
  request workspace (`RecordsPanel`) sent a **citizen record** into the task-less canvas, which carries no
  work timer — so redaction labour went unmeasured and **the city under-billed for it**. That button is
  retired; redaction happens at `/redaction/:taskId`.

Guarded by `verify_v1_retirement` (12). The backend Elevated/Legal second-review gate was **never** bypassed
by the v1 screen — `gateApply` is enforced in the route, not the UI. Checked, not assumed.

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

### 3.2 `legal_review` spawns but can never complete — **DONE 2026-07-18 (p)**
`spawnForStage` creates it at `exemption_review`/`ag_review`; **no route resolves it**; the reconciler keeps
re-creating it; the redaction-family idempotency guard ignores it, so a request can carry an open
`legal_review` *and* an open `redaction` at once. They only clear when the request hits `closed`.

All four claims verified true against the implementation. **One root cause: a `legal_review` task had no
relationship to the stage that spawned it.** Two fixes:

1. **It can be DECIDED, not merely completed.** Marking it done was never the answer — that would leave the
   request at `exemption_review` with no task and no way forward, which is exactly what the removed
   `/tasks/:id/complete` would have done. Completing a legal review **is a stage decision**, so
   `/tasks/:id/resolve` now handles it and advances through `applyStageTransition`. The reconciler then
   correctly declines to resurrect it, because the stage has moved.
   **Outcome vocabulary is deliberately identical to `/requests/:id/ag-ruling`** — `sustained`/`partial` →
   `redaction_review`, `overruled` → `delivery`. An internal exemption review and an AG pre-clearance ruling
   answer the same question; two vocabularies would be two ways to say one thing.
   **A note is REQUIRED** (Kevin, 2026-07-18 — see §5 Q2): asserting an exemption is a legal act the city may
   have to defend, and "the reviewer clicked approve" is not a defence.
2. **A stage's task now dies with its stage.** The central transition cancels the outgoing stage's task when
   the new stage implies a different one. This is what actually fixes the coexistence bug: `/ag-ruling` moved
   `ag_review → redaction_review` while leaving an **open, pooled** `legal_review` behind, so a legal staffer
   could claim an exemption review for a decision made and acted on days earlier.
   **Family-aware, which is the subtle half:** `redaction_review → redaction` implies `redaction` on *both*
   sides, so an in-flight redaction task survives that move — cancelling there would destroy real work. Same
   for `exemption_review → ag_review`. Break-tested: dropping family-awareness fails F1 and G1.

### 3.3 `POST /tasks/:id/complete` was a loaded gun — **REMOVED 2026-07-18 (n)**
`requireAuth` only. **No ownership check, no type check, no stage side-effect.** Any authenticated user could
mark any task done, stranding its stage.

> **This is precisely the endpoint a "click to approve" stub would reach for.** If the stubs call it, every
> stub will *look* like it works and will quietly strand the request. **Stubs must go through
> `applyStageTransition`** so they write history and spawn the next task like the real thing. Then a blank
> screen is a genuine node in the flow and replacing it later is a UI change, not a rewrite.

**Resolution: removed, not hardened.** It turned out to be **dead on arrival** — added 2026-06-24 (`8bfc555`)
alongside the estimate screen, but that screen completes its task by a direct `UPDATE` in `feeEstimates.js`
instead, so the endpoint had **zero callers** in frontend, backend, tests or scripts for the four weeks it
existed. Hardening it would have left a better-defended way to finish a task *without moving the request*,
which is exactly what a stub must never do. A comment in its place points at `/:id/resolve` as the pattern.
`verify_task_lifecycle` §D asserts the route is **absent (404), not merely guarded**, so re-adding it in any
form fails the suite. Break-tested: restoring the endpoint fails D1/D2.

**A NON-BUG that looks exactly like this one — do not "fix" it.** `feeEstimates.js:270` marks the estimate
task done with a direct `UPDATE` and **no stage transition**. That is correct: sending an estimate does not
advance the request, because the next move belongs to the **citizen**. The stage advances on their response
(`applyStageTransition` at `feeEstimates.js:296`), and `tickler.js` (1) watches for a sent estimate that is
never accepted or declined and lapses it. Task-done-with-no-stage-move is only stranding when **nothing else
is watching**; here something is.

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

**Phase 0 — foundation (no new screens). ✅ COMPLETE 2026-07-18.** ~~§3.1 leaf-fact pass~~ **(n)**;
~~§3.3 lock down~~ **(n) — removed**; ~~§3.2 `legal_review` resolution~~ **(p)**. §5 Q2 answered, so the
stub-safe advance path is unblocked — and §3.2's resolution **is the reference implementation** for it:
type check → required note → mark done → `applyStageTransition`. Copy that shape. §3.1b (money on the child)
is deferred to the MRR-hub design, not to Phase 0.

**Phase 0 leftovers, not blocking.** §3.4 (no from-`closed` guard in the central function), §3.5 (routing
split-brain: `redaction_qa` excluded from `ROUTABLE_TASK_TYPES`; two divergent pool queries;
`review_auto_redaction` world-claimable on NULL `role_required`), §3.6 (estimate spawning keyed on the
literal rule id `'wfr-confident'`; `fee_review` in neither `STAGE_TASK` nor the reconciler sweep). None were
verified this session — **check them against the implementation before believing them**, as three §3.1
entries and the `feeEstimates.js:270` "bug" all evaporated on inspection.

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

1. ~~**Is the 10-stage order the flow you want**~~ **ANSWERED 2026-07-19 — the legal stages are a BRANCH**
   (`97b719e`). Kevin chose option B. The sequence is now **eight**:
   `intake → fee_review → awaiting_payment → record_search → redaction_review → redaction → delivery → closed`.
   `exemption_review` / `ag_review` stay in the vocabulary but leave the linear walk — entered only by
   `POST /requests/:id/assert-exemption`, which already read `jurisdiction_profiles.exemption_model`
   (`pre_clearance` = TX/AG, else internal), and left only by a legal decision carrying a required note.
   **The question answered itself on inspection: the branch was already city-configurable everywhere except
   the order.** Two defects fell out — Advance offered `exemption_review` from `record_search`, and (the
   larger) completing a record search advanced there UNCONDITIONALLY, so every request that found records was
   adjudicated before it could be redacted.
2. ~~**Do stubs auto-approve, or require a note?**~~ **ANSWERED 2026-07-18 — REQUIRE A NOTE.** It costs
   nothing now and leaves an audit trail explaining why a request moved during the skeleton period. Already
   applied to the `legal_review` resolution (§3.2); **every stub screen must follow it.**
3. **Single-record first, or the MRR parent hub too?** The hub (§14.3) is design-gated and the queue's
   parent line is deliberately inert today.
4. **`commercial_rate` / `mrr_processing`** — build, or remove from the catalog? They are currently
   assignable to people and produce permanently empty pools.
5. ~~**The v1 redaction duplicates** — retire now or leave until the flow settles?~~ **ANSWERED 2026-07-19 —
   retired** (`2057e46`). See §2.3: one page deleted, one kept because it was never a duplicate, and the
   thing actually duplicated turned out to be an entry point that cost billable labour. **Two of Kevin's five
   §5 decisions now remain: 3 (single-record vs the MRR hub) and 4 (`commercial_rate` / `mrr_processing`).**

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
