# WORKING — Parent/Child attribute inventory (snapshot)

> **THIS IS A SCRATCHPAD, NOT A SPEC.** Snapshot of **2026-07-19**. It exists so Kevin can see, in one place,
> what actually exists today, where it is used, whether it is currently treated as parent or child, and what
> has only ever been *discussed*. It is expected to be marked up, argued with, and **thrown away** once the
> decisions it supports land in `SPEC_parent_child_lifecycle.md`.
>
> **Do not cite this document as authority.** If it disagrees with the code, the code is right; if it
> disagrees with the spec, that disagreement is the point and is flagged below.

**How the columns are meant to be read**

- **Exists?** — is there a real DB column / table today?
- **Written on** — which row(s) actually get a value, from the code, today.
- **Spec** — what `SPEC_parent_child_lifecycle.md` says it should be.
- **Verdict** — ✅ agree · ⚠️ code and spec disagree · ❓ nobody has said · 💀 dead · 🕐 designed, not built.

**Confidence.** Column ownership comes from reading `requestCreate.js` (`COLUMNS` / `PARENT_NULL` /
`CHILD_FIELDS`) plus every `UPDATE requests SET` site. Three items were verified by running code, and are
marked **[verified]**. One inference is marked **[unverified]** and says so.

---

## Part A — `requests` columns that exist AND are used

### A1. Identity

| Attribute | Written on | Spec | Verdict | Notes |
|---|---|---|---|---|
| `id` | both | both | ✅ | |
| `request_number` | both, **different values** | PARENT (`:75`) | ✅ | Child = `2026-0045-1`. Resolved through parent in queue + `/tasks/*` + `GET /requests/:id` (fixed 07-18). Suffix hidden when `child_count=1` |
| `master_request_id` | child only | structural | ✅ | No FK, no trigger. Index only |
| `child_no` | child only | CHILD (`:206`) | ✅ | `1..n`, never 0 — a zero would make single-record a different shape |
| `component_label` | child only | CHILD | ✅ | Human label ("body-cam footage") |
| `is_mrr` | **parent 1 / child forced 0** | PARENT, derived `child_count>1` (`:79`) | ✅ | Never hand-set. Reading it off a child always gave 0 — the MRR badge bug, fixed 07-18 |

### A2. Citizen identity — parent-owned, physically copied to children

| Attribute | Written on | Spec | Verdict | Notes |
|---|---|---|---|---|
| `requestor_name / _email / _phone / _type` | both (copy-down at creation) | PARENT only (`:76`) | ⚠️ **wording** | Spec says "children never carry requestor identity"; code copies it to every child. Not a bug — a deliberate **copy-down** — but the spec sentence is false as written. Decide: keep copy-down, or resolve-through and delete the child copies |
| `delivery_method` | both | PARENT (`:77`) | ⚠️ same | Governs how records ship |
| `purpose` | both | PARENT | ⚠️ same | Also updated by fee endpoints on the addressed row |
| `mailing_street1/2`, `_city`, `_state`, `_zip` | both | PARENT | ⚠️ same | Your "gibberish address → intake review" case lives here |
| `certification_requested` | both | PARENT | ⚠️ same | |
| `submission_channel` | both | PARENT | ⚠️ same | |
| `email_verification_method` | both | PARENT | ⚠️ same | |
| `created_at` | both | PARENT = statutory trigger (`:79`) | ⚠️ | Parent's is the legal submit date; children have their own, which is what once ordered MRRs backwards in the queue |

> **The whole A2 block is one decision, not eight.** Today these are copy-down duplicates that nothing keeps
> in sync — no code updates a child's requestor when the parent's changes. It is correct *today* only because
> nothing ever edits them.

### A3. Work — child-owned, uncontested

| Attribute | Written on | Spec | Verdict | Notes |
|---|---|---|---|---|
| `description` | **child only** (parent NULL) | CHILD (`:212`) | ✅ | Copying it up was tried and **broke things** — every description lookup matched two rows (`:425`). Now guarded by `chk_child_has_description` |
| `record_types` | child only | CHILD | ✅ | |
| `department_id` | child only | CHILD (`:214`) | ✅ | Written by `workflowEngine`, `publicChat`, `PATCH /route` — all child-addressed |
| `record_type_id` | child only | CHILD | ✅ | Also the key for time budgets |
| `assigned_to` | child only | CHILD, **except** parent's `mrr_manager` (`:80`) | ⚠️ | Spec reserves the parent's `assigned_to` for the MRR manager. Nothing writes it — MRR routing is not built |
| `classification_confidence` | child only | CHILD | ✅ | |
| `routing_basis` | child only | CHILD | ✅ | |
| `legal_flag`, `legal_flag_type` | child only | — (not in spec) | ❓ | Only writer is `escalateToLegal`, on the addressed work row. Drives `redaction`→`legal_redaction`. **Is a legal escalation a property of one record or of the whole matter?** Not stated anywhere |
| `stage` | **child only** (parent NULL) | CHILD (`:194`) | ⚠️ **see Part E** | Correct that it is child-level. Wrong that two of its ten *values* are parent concerns |

### A4. Clock — parent-owned, cascaded down

| Attribute | Written on | Spec | Verdict | Notes |
|---|---|---|---|---|
| `deadline_date` | **both, by explicit cascade** | PARENT (`:85` "the only legal deadline") | ✅ | `tolling.js:106` writes `WHERE id = ? OR master_request_id = ?` on purpose, so leaf-scoped worklists can display it. The child's copy is a **derived copy, not a second deadline** |
| `request_clocks` (table) | **parent only** | PARENT | ✅ **[verified]** | Every `tolling.js` entrypoint resolves to parent via `parentOf`. The one thing that must never be duplicated |
| `classification` | **both** — but only the child is ever updated | CHILD for routing, **copied up** for clock duration (`:428`) | ⚠️ **live gap** | Drives `tolling.durationFor`, so the parent needs it. Re-classifying a child never refreshes the parent's copy → **the statutory deadline can go stale**. MRR worst-case roll-up **unspecified** (`:429`), and the code comment marks this as *Claude's* call, **not Kevin's** |

### A5. Money — spec says parent, code says child

| Attribute | Written on | Spec | Verdict | Notes |
|---|---|---|---|---|
| `estimated_fee` | **child in practice** | PARENT (§4.3) | ⚠️ **conflict** | Written to whatever id the endpoint got; every UI path passes a child |
| `fee_waiver_requested` | both (copy-down) | PARENT (`:167` "already built") | ⚠️ | |
| `fee_waiver_status`, `_reason`, `_decided_by`, `_decided_at` | **child in practice** | PARENT | ⚠️ **conflict** | Money-axis facts landing on the work row |
| `nonpayment_dunning_at` | **parent** | PARENT | ✅ | The one money column that is correctly parent-scoped |
| `request_fee_estimates` (table) | **child** | PARENT | ⚠️ **live defect** **[verified]** | See box below |
| `actual_fee` | **nothing writes it** | — | 💀 | Delete candidate |
| `amount_paid` | **nothing writes it** | — | 💀 | Delete candidate. Payments live in `request_fee_estimates` |

> ### ⚠️ The money split is not theoretical — dunning is inert **[verified 2026-07-19]**
> `feeNonpayment.sweep()` is **parent**-scoped (deliberately — unscoped it would send citizens duplicate
> dunning emails). It then asks `computeSituation(parentId)`, which looks for estimates on the parent. Estimates
> are written on the **child**. So `if (!sit.hasEstimate) continue;` skips **every wrapped request**: no dunning
> email is ever sent and non-payment auto-close never fires.
>
> Proven by `tests/verify_nonpayment_scope.js` (deliberately **not** registered in the suite — it fails today;
> it is the regression test for the fix, already written). Latent only because nothing has reached `fee_review`.

### A6. Status, closure, dormancy — the ambiguous ones

| Attribute | Written on | Spec | Verdict | Notes |
|---|---|---|---|---|
| `status` | both, **independently** | parent = `parent_state`, derived (`:194`) | ⚠️ | Values in use: `active`, `closed`. **Single writer** — `applyStageTransition`, as a pure function of stage. `withdrawn`/`abandoned` are read but **unreachable**; one live row has `completed`, which no code can produce |
| `closure_reason` | **mixed** — 6 writers, some parent, some child | spec retires it (`:388`) — but inside `[DEFERRED]` §6.2 | ⚠️ **no owner** | `nonpayment`→parent, clarification timeout→parent, `no_records`→child, deposit/estimate paths→whichever row holds the estimate |
| `tickler_flag`, `tickler_flagged_at` | **mixed** — 5 writers | **never scoped in any doc** | ❓ | Stall sweep is leaf-scoped; estimate/deposit paths follow the estimate's row. Cleared on forward stage moves (child) |

> Contrast: `stage` and `status` have **exactly one writer each**. `closure_reason` has six and `tickler_flag`
> five. **That is where the next ambiguity bites.**

---

## Part B — 💀 Dead: exists but nothing uses it

| Thing | Evidence | Suggested |
|---|---|---|
| `requests.actual_fee` | no writer anywhere | drop |
| `requests.amount_paid` | no writer; reports read it and always get 0 | drop, or populate from `request_fee_estimates` |
| `status = 'withdrawn'` / `'abandoned'` | read in `paymentStatus.js:71`, never written — withdrawal paths write `closed` + a `closure_reason` | delete the dead branch |
| `status = 'completed'` | 1 live row, no code path produces it | legacy import; clean up |
| task type `commercial_rate` | nothing spawns it; assignable to people; permanently empty pool | **your call** — build or delete |
| task type `mrr_processing` | nothing spawns it; same | **your call** — it is the MRR parent routing that isn't built |
| `TaskPoolSection.js` | imported nowhere; its link map would misroute record-search tasks | delete |
| `Soon()` in `App.js` | never referenced | delete |

---

## Part C — 🕐 Designed in the spec, NOT built (your "overkill?" review list)

These are the terms you'll hit in the docs that have **no code behind them**. This is the list to prune.

| Field / object | Level | Spec | What it's for | Worth building? |
|---|---|---|---|---|
| `parent_state` (`In Process` · `Complete`) | parent | `:194` | Derived roll-up. **Queue already computes it client-side** at render | Probably just formalize what the queue does |
| ~~`outcome`~~ | parent | `:195` | **You deferred this 07-16** — "don't carry the bad v1 design over" | Deferred by you |
| ~~`withdrawn_reason`~~ | parent | `:196` | Deferred with `outcome` | Deferred by you |
| `estimate_status` | parent | §4.3 | `Pre-estimate` · `Estimate delivered` · `Resolved – Adjustment Applied` | ? |
| `payment_status` (7 values) | parent | §4.3 | Incl. two `HOLD` values that are clock-holds | **This is where "awaiting payment" should live** — see Part E |
| `fee_dispute` (4 values) | parent | `:168` | Fee/estimate objection. **Explicitly not the same object** as a records appeal | ? |
| `clock_state`, `tolled_days`, `budget_variance` | parent | §4.2 | Derived; `tolling.js` already computes the first two | Mostly display of existing data |
| `budget_clock` | child | `:243` | **Your 07-13 ruling**: child tolling is the BUDGET clock, never the statutory one. Name it `budget_clock`, never `tolling` | Naming rule matters even if field waits |
| `record_hold` (5 values) | child | §5.5 | Blocks release of **this child only**. Never stops parent clock, never blocks a sibling | Legally required |
| `appeal_state` (6 values) | child | §5.6 | Distinct from parent's `fee_dispute` | Legally required |
| `child_exemptions` (table) | child | §5.7 | Per-record exemption + citation + explanation. Spec: **"the field that gets a city sued if it's missing"** | Legally required |
| `disposition` (8 values) | child | §5.8 | The real terminal outcome, incl. `Previously furnished`, `Not in our custody` | Core |
| `installment_no`, `delivered_at` | child | §5.8 | Per-child release batching | Tied to release-policy fork |
| `delivery_mode` (`Hold-All` / `As-Ready`) | parent | §5.8 | Operator default | Tied to release-policy fork |
| 5 workstream status vocabularies | child | §5.3 | Estimate collection, record search, redaction, legal redaction, legal review — ~30 values total | **Biggest overkill candidate.** Much overlaps `tasks.status` + stage |
| `source_request_id` on `clock_tolls` | — | §4.2.1 | Which child's event tolled the parent clock. "**Attribution is not ownership**" | Decided, deferred |
| `mrr_manager` | parent | `:80` | Parent's `assigned_to`, only when `is_mrr` | Blocked on MRR hub |

---

## Part D — Processes / tasks

| Process | Level today | Spec | Notes |
|---|---|---|---|
| Intake classification + routing | **CHILD, per child** **[verified]** | child | **A 3-child request produces 3 `routing_review` tasks** — confirmed on live data. Idempotency guard is per-child so it cannot dedupe across siblings |
| Routing review → ORO | CHILD | child | "ORO" is a **staffing convention, not code** — task is team-agnostic, resolved by eligibility |
| Intake review for MRR | n/a | **bypassed** (`:726`) — "the parent is already with an Open Records team member" | Matches your instinct exactly |
| MRR parent → ORO at intake | **NOT BUILT** | parent | No `mrr_processing` task is ever created. Queue renders `—` and says inventing an owner "would be a lie" |
| Estimate **data entry** | child (in principle) | CHILD, rolling up (`:782`) | 🕐 not built |
| Estimate **computation** | child (in practice ⚠️) | **PARENT** (`:394`) — "children contribute quantities; the parent applies waiver, minimums, deposit **once**. **A child is a unit of work, never a unit of billing**" | Your framing matches the spec verbatim |
| Estimate review / verify | — | PARENT | 🕐. Note `:791`: **Verify ≠ Approve** — staff *verify*, the requestor *approves*. "Collapsing the two words into one button would corrupt a statutory trigger" |
| Fee waiver decision | child in practice ⚠️ | PARENT | Backend built, **no screen** |
| Payment / non-payment hold | parent | PARENT | Sweep is parent-scoped but inert (Part A5) |
| Record search | CHILD | child | ✅ |
| Exemption / legal review | CHILD | child | ✅ resolvable as of 07-18 |
| Redaction, legal redaction, QA | CHILD | child | ✅ |
| Delivery | CHILD | **child** (`:188` "DELIVERY IS A CHILD FACT") | ✅ matches your "the parent isn't shipped" |
| Time budget | **per TASK** **[verified]** | child | Keyed `(record_type_id, task_type)`; never touches `requests`. Built 07-15, **one day before** the wrap, never revisited — but survives because task-scoped is already child-scoped |

---

## Part E — Stages: the one structural change

`stage` is correctly a **child** column. But two of its ten values describe the **parent**:

| Stage | Axis | |
|---|---|---|
| `intake` | **both** | Child: team assignment. Parent: your gibberish-address case. **Nothing routes a parent to intake today** |
| `fee_review` | **PARENT** | ⚠️ money |
| `awaiting_payment` | **PARENT** | ⚠️ money |
| `record_search` → `delivery` (6 stages) | CHILD | ✅ |
| `closed` | **both** | Child terminal; parent needs a roll-up that **does not exist** |

`SPEC:194` already says *"`fee_review` and `awaiting_payment` **move off the child** — they are parent gates."*
But **the parent has no `stage`**, so §11.1a (`:609`) records this as still-open with three options and a
recommendation: **(iii) drive the payment gate off `payment_status` and drop the stage predicate.**

> **Consequence today** **[verified]**: accepting an estimate moves a **child** into `awaiting_payment`. On a
> 3-child MRR, one child sits in `awaiting_payment` for one indivisible parent payment while its siblings sit
> elsewhere.

---

## Part F — The four inheritance mechanisms

All four are already in use. None are named in code. **Most defects found are a column using the wrong one.**

| Mechanism | Means | Used by | Risk |
|---|---|---|---|
| **Copy-down** | value written to children at creation, never re-synced | requestor identity, delivery, mailing, purpose, fee_waiver_requested | Silent divergence the moment anything edits the parent |
| **Cascade-down** | parent writes, children updated on every change | `deadline_date` only | Correct, but hand-rolled in one function |
| **Resolve-through** | never stored on child; read via join | `request_number`, `is_mrr` (`scope.parentFact`) | Cheapest to keep correct |
| **Roll-up** | parent derived from children | **only** `parentState()`, client-side at render, never stored | Everything needing it (money, status, classification) is missing it |

---

## Part G — Anti-cascade rules (do not break these)

The highest-consequence rules in the model. All legal, all currently unenforced in code because the fields don't exist:

- `:42` — "A system that models 'AG hold' as a request-level freeze will cause a city to **unlawfully withhold records it was obligated to release**. **This is the highest-consequence modeling decision in the document.**"
- `:64` — record-hold "**Never stops the parent clock. Never blocks a sibling.**"
- `:263` — an appeal on one child "**must not freeze the parent or its siblings**"
- `:300` — "**A child may NEVER be withheld because a *sibling* is unpaid.**"
- `:43` — "**A per-child *statutory* deadline does not exist.**" Children carry budget dates only
- `:349` — but terminal parent events (unpaid deposit, withdrawal, unanswered clarification) **do** cascade: each open child takes the matching disposition
- `:155` — a clarification on **one** child restarts the **whole parent clock**, siblings included. Recorded as a deliberate decision, not an accident

---

## Part H — What actually needs your call

1. **Payment gate's home** (§11.1a) — parent has no stage. Spec recommends driving it off `payment_status`. This is the formal version of your "awaiting payment is a parent status."
2. **Release policy — the spec contradicts itself.** `:297` says per-child release is "first-class, not an MRR override" (WA makes installment delivery a requestor *entitlement*); `:794` says "nothing releases until the whole request completes" and flags itself "⚠️ Reconcile with §5.9."
3. **MRR classification worst-case roll-up** — unspecified; today nothing decides which child sets the parent's legal deadline.
4. **Money roll-up** — design-gated on the MRR hub. Not latent: dunning is inert now.
5. **Copy-down vs resolve-through for citizen identity** (all of A2 as one decision).
6. **`closure_reason` and `tickler_flag`** — no owner, 6 and 5 writers.
7. **`legal_flag`** — record-level or matter-level? Never stated.
8. **Prune Part C** — especially the ~30 workstream status values in §5.3, which overlap `tasks.status` and `stage`.
9. **`commercial_rate` / `mrr_processing`** — build or delete.

---

## Appendix — docs that will actively mislead you

| Doc | Problem |
|---|---|
| `SPEC_parent_child_lifecycle.md:6-8` | **Header says "DESIGNED, NOT BUILT"** — contradicted by its own §7/§8 tagged `[BUILT 2026-07-16]`. The most-read part of the binding spec disclaims its own existence |
| `DOMAIN_MAP.md:24` | Same — "DESIGNED 2026-07-13, NOT BUILT". This is the index agents read first |
| `TASK_AND_NOTIFICATION_MODEL.md` §7 | Asserts *"'always parent, every request a child' — **VERIFIED FALSE**"* and "child creation does NOT exist". Every claim now false. Also still carries the retired `PARTIALLY GRANTED` roll-up |
| `SPEC_fees_estimates_payments.md:21` | "MRR-aware fee aggregation across children **exists**" — disproved by the dunning test |
| `SPEC_record_search_task_screen.md:406` | Still cites the retired Partially-Granted roll-up |
| `SPEC_tasks_roles_mrr_fees.md:22,24` | "Parent roll-up waits for #11" — #11 shipped 07-16, never revisited |
| `SPEC_parent_child_lifecycle.md:800` | §14.5 points mixed-outcome resolution at §6.2 — which §6.2 itself forbids building from |
