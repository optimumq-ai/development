# Target — the request-processing model

**Status: DRAFT FOR KEVIN'S CORRECTION. Not ratified, not a build order.**
Drafted 2026-07-19 from Kevin's description, to be diffed against what exists before any more pipeline work.

**Why this document exists.** Design intent was being inferred *from the implementation*. Where the
implementation was half-built, "nothing sets this" was read as "this isn't wanted" — and on 2026-07-19 that
reasoning **deleted the `fee_review` stage** (`bd7f232`), which Kevin then named as a step in the pipeline.
One deletion is trivially reverted; the reasoning that produced it is the problem. This document inverts the
direction: **the model is stated first, and the code is measured against it.**

Where Kevin's description is silent, this document says **OPEN** rather than filling the gap.

---

## 1. Kevin's statement (verbatim, 2026-07-19)

> My intent was to have specific ui for every task type with possible exceptions no yet thought through. The
> first build used what appeared to me to be something like a single global workspace with links to "sub ui"
> screens to do certain things, but not grouped together in a way that allowed a user to process a task. My
> concept of a process pipeline appliess to the child record, and would basically show the sequence of intake
> review, estimate data collected (processing estimate happens at parent level, so when data collection is
> complete/submitted it triggers fee calculation which upon completion triggers fee review, when complete it
> triggers record search, when complete that triggers redaction which triggers delivery. this is a high level
> description that does not consider legal redaction or legal review, but i'm just trying to illustrate my
> concept. the prior design had a pipeline on the queue that attempted to combine taask processing performed
> with payment. Awaiting payment is not work performed it is a status which could pause processing. I want
> the process flow to be driven by task completion (which could in some cases be considered completed
> automatically/bypassed..such as where a record does not require redaction...so instead of logging the user
> performing the task, logging would show a description related to why bypass occurred. The task process flow
> would be stopped by terminal events such as non payment, record not found, no response to request for
> clarification, etc. Those are not tasks, they are conditions that trigger a terminal event.

---

## 2. The model as stated

### 2.1 Four kinds of thing, and they must not be mixed

| | What it is | Who/what advances it |
|---|---|---|
| **Task** | A unit of work a person performs | Completed by a person — **or bypassed automatically** |
| **Status** | A condition the request is in | Set by circumstance; **can pause processing** |
| **Terminal event** | A condition that ends processing | Triggered by a condition, never "completed" |
| **Parent computation** | Work the system does across the whole request | Triggered by a child task completing |

**The stated defect in the prior design is a category error:** the queue pipeline "attempted to combine task
processing performed with payment." *"Awaiting payment is not work performed it is a status which could pause
processing."*

### 2.2 The pipeline is the CHILD's

The process pipeline belongs to the **child record** (the described item). The **parent** is who requested the
information, whether they paid, and — per Kevin's ruling the same day — the number they quote and the
statutory clock.

### 2.3 The sequence (high level, as illustrated)

```
intake review
     ↓ (task complete)
estimate data collection            ← CHILD-level work
     ↓ (complete/submitted TRIGGERS)
fee calculation                     ← PARENT-level computation, across children
     ↓ (completion triggers)
fee review
     ↓ (complete)
record search
     ↓ (complete)
redaction
     ↓ (triggers)
delivery
```

⚠️ Kevin's own caveat: *"this is a high level description that does not consider legal redaction or legal
review."* The legal path is **OPEN** — see §3.

### 2.4 Completion drives the flow

*"I want the process flow to be driven by task completion."* A task completing is the **event**; the
pipeline's position is what that event produces — not an independently-set value that tasks are derived from.

### 2.5 Bypass is a first-class completion

A task may be *"considered completed automatically/bypassed… such as where a record does not require
redaction."* When that happens the log records **why the bypass occurred instead of which user performed it**.

So a completion carries either an **actor** or a **basis**, and both are legitimate.

### 2.6 Terminal events are conditions, not steps

Named: **non-payment**, **record not found**, **no response to a request for clarification**, *"etc."*
*"Those are not tasks, they are conditions that trigger a terminal event."* They stop the flow; they are not
positions in it, and nobody "completes" one.

### 2.7 One screen per task type

*"specific ui for every task type with possible exceptions no yet thought through."* The rejected alternative
is explicitly named: *"a single global workspace with links to 'sub ui' screens… not grouped together in a way
that allowed a user to process a task."* A screen must let someone **process the task**, not navigate to
pieces of it.

---

## 3. Deliberately OPEN — do not infer these

1. **Legal review / legal redaction / AG pre-clearance.** Explicitly excluded from the illustration. How the
   legal path relates to the spine — branch, insert, or parallel — is undecided.
2. **The "possible exceptions" to one-screen-per-task-type.** Named as not yet thought through.
3. **Multi-record (n > 1) behaviour of the pipeline.** §2.3 describes one child's walk. What the parent shows
   when children are at different positions is not addressed here.
4. **What "fee review" reviews**, who performs it, and whether it can be bypassed.
5. **Whether intake review and estimate data collection are one task or two.**
6. **Re-entry.** Whether a terminal event can be reversed (a reopen exists in code today) is not addressed.

---

## 4. Diff against what exists (verified 2026-07-19)

### 4.1 Already aligned

| Model | Code | Evidence |
|---|---|---|
| Pipeline belongs to the child | Enforced | `scope.workRow()`; `cbc9e46`, `739670a` |
| Parent = requestor, money, clock, number | Enforced | `requestScope`, parent-scoped clocks |
| One screen per task type | In progress | Brief §4 Phase 2; `LegalReviewTaskPage` is the first |
| Terminal conditions exist | Partially | `closure_reason` ∈ `nonpayment`, `no_records`, `deposit_unpaid`; clarification timeout closes via `clarificationTimeout.sweep()` |
| Payment is not a step on the walk | Done 2026-07-19 | `awaiting_payment` removed from `SEQUENCE` (`d1b04e1`) |

### 4.2 Divergent

**D1 — The engine is stage-driven; the model is task-driven.**
`STAGE_TASK = { record_search, redaction_review, redaction, exemption_review, ag_review }` — **stages spawn
tasks**, and `applyStageTransition` is the centre of gravity. Task completion currently *calls* a stage
transition, so the flow is task-*triggered* but stage-*authoritative*. The model inverts this.
**Assessed as a thin seam, not a rewrite:** screens already call one function on completion; what changes is
that function's internals and which value is the source of truth.

**D2 — `fee_review` does not exist. Deleted 2026-07-19 (`bd7f232`).**
Direct collision with §2.3. Deleted on the reasoning that nothing set it — true of the code, and the wrong
question. **Recommend restoring it** as part of adopting this model.

**D3 — No parent-level fee calculation across children.** The model requires it (§2.3). The spec was
corrected the same day to state the opposite of what it used to claim:
> *"There is no aggregation across children at all. All 17 `/fee-estimates/request/:requestId` endpoints use
> the id they are given."*
Currently deferred under the "single-record first" decision (brief §5.3). **The model makes it required, not
optional** — this is the largest gap in the diff.

**D4 — Estimate is a task at intake, not a step in the pipeline.** The `estimate` task is spawned by the
workflow engine when rule `wfr-confident` matches; there is no estimate stage, and no separation between
*data collection* (child) and *calculation* (parent) as §2.3 describes.

**D5 — `awaiting_payment` is a stage, not a status. ✅ RULED 2026-07-19 (Kevin): _"awaiting_payment should be
a status that pauses, not a stage."_**
It was taken off the linear sequence (good) but remains a value in the same `stage` column as real work
positions. A child cannot be *at* record search *and* paused for payment — the column holds one value.

**⚠️ THE CODEBASE ALREADY IMPLEMENTS THIS MODEL — for the other payment gate.** There are two:

| Gate | Question | How it is implemented | Verdict |
|---|---|---|---|
| **Release** (pay before delivery) | may these records go out? | a **condition evaluated at the transition** — `feeRelease.releaseGate()` returns 409 at `delivery`, per-child coverage. **Not a stage.** | ✅ already the target model |
| **Deposit** (pay before work) | may work begin? | a **stage** — `paymentTiming.gateToStage()` maps the gate to `awaiting_payment` | ❌ the one to change |

So this is not a new mechanism to invent: **make the deposit gate look like the release gate.**

**And a pause vocabulary already exists**, in a third place: the tolling engine holds the statutory clock with
named reasons (`ag_ruling_pending`, `clarification_pending`, the deposit holds in `depositAction`). The system
already says *"processing is paused because X"* — it just says it to the **clock** rather than to the **work**,
and never displays it as a status.

**Recommended shape (derived, not stored):** express the pause the way `releaseGate` does — computed from
whether money is owed — rather than as a new `paused_reason` column. A stored flag is a second copy of a fact
the fee tables already hold and can drift from it; a derived one cannot. This makes the change smaller than
"schema change" implies: **no migration, no new column.**

**Migration risk: none.** Live carries **zero** requests at `awaiting_payment` and **zero** history rows
naming it (checked 2026-07-19) — the same pre-deletion check the dead money columns and `fee_review` got.

**OPEN — the one product question this raises (§5.1).** The release gate is deliberately **per-child**:
*"a child may never be withheld because a SIBLING is unpaid."* Is an unpaid **deposit** the same — pausing
only the records whose own share is unpaid — or is it a single up-front payment that pauses the **whole
request**? Consistency argues per-child; how deposits are actually collected may argue whole-request.

**D6 — Bypass exists for redaction only.** `redactionBypass.js` is exactly the model's shape: a released job
with `disposition = 'bypass'`, a `basis`, and a `REDACTION_BYPASSED` history row attributed to `System`
rather than a user. **It is not general** — no other task type can be bypassed, and there is no shared notion
of "completed with a basis instead of an actor."

**D7 — Intake review and delivery spawn no task.** `STAGE_TASK` has no entry for `intake` or `delivery`, so
neither is a unit of work anyone completes. Both are steps in §2.3. In a task-driven model both need to be
real tasks — or explicitly declared not to be.

**D8 — Terminal events are closures, not a modelled concept.** They work, but each is implemented in its own
place (`feeNonpayment`, `clarificationTimeout`, the no-records branch of `/tasks/:id/resolve`) and is
expressed as *a stage of `closed` plus a reason string*. There is no shared "terminal event" mechanism, so
adding one means writing another bespoke path.

### 4.3 Consequence for work in flight

- **Task screens are safe to continue.** The three-part shape (context / evidence / one action that completes
  the task) holds in both models; only what the action calls changes.
- **Stage-vocabulary and branch-modelling work should stop** until this is ratified. That is where the two
  bad inferences of 2026-07-19 landed.

---

## 5. Questions this document cannot answer

For Kevin, in rough priority:

1. ~~**D5 — is `awaiting_payment` a second axis?**~~ **✅ RULED: yes, a status that pauses.** One question
   follows from it: **does an unpaid deposit pause the whole request, or only the records whose own share is
   unpaid?** The release gate is already per-child by design; deposits may be collected whole-request.
2. **D3 — does parent-level fee aggregation come back on the roadmap now?** The model requires it; it is
   currently deferred. ⚠️ **Coupled to D5's open question** — "whose share is unpaid" is only answerable
   per-child once fees aggregate across children.
3. **D1 — how literal is "driven by task completion"?** Does `stage` remain as a derived, readable position,
   or does the pipeline become genuinely task-list-driven with no stage column?
4. **D7 — are intake review and delivery tasks?**
5. **§3 — the legal path**, once the spine is settled.
