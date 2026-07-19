# WORKING — Parent/Child attribute inventory (snapshot)

> **THIS IS A SCRATCHPAD, NOT A SPEC.** Snapshot of **2026-07-19** *(revised same day, after the stale-doc
> sweep — see the Appendix; the docs this was built to route around are now mostly corrected at source)*.
> It exists so Kevin can see, in one place,
> what actually exists today, where it is used, whether it is currently treated as parent or child, and what
> has only ever been *discussed*. It is expected to be marked up, argued with, and **thrown away** once the
> decisions it supports land in `SPEC_parent_child_lifecycle.md`.
>
> **Do not cite this document as authority.** If it disagrees with the code, the code is right; if it
> disagrees with the spec, that disagreement is the point and is flagged below.

**Start with Part 0** if the question is "what changed between the old and new data model."

**How the columns are meant to be read**

- **Exists?** — is there a real DB column / table today?
- **Written on** — which row(s) actually get a value, from the code, today.
- **Spec** — what `SPEC_parent_child_lifecycle.md` says it should be.
- **Verdict** — ✅ agree · ⚠️ code and spec disagree · ❓ nobody has said · 💀 dead · 🕐 designed, not built.

**Confidence.** Column ownership comes from reading `requestCreate.js` (`COLUMNS` / `PARENT_NULL` /
`CHILD_FIELDS`) plus every `UPDATE requests SET` site. Three items were verified by running code, and are
marked **[verified]**. One inference is marked **[unverified]** and says so.

---

## Part 0 — "Old schema" vs "new schema": there is only ONE

**This answers the question that prompted the document, and the answer is counter-intuitive.** There is no old
attribute set and a new one to reconcile. **The parent/child migration was ADDITIVE — one `requests` table
before and after, and the column list barely moved.**

| | |
|---|---|
| **Already in the original `CREATE TABLE`, dormant** | `is_mrr`, `master_request_id`, `component_label` — present from the start and **written by zero lines of code** until 2026-07-16 |
| **Added by the wrap** (`1739215`) | **`child_no` only** — plus `CHECK (child_no IS NULL OR description IS NOT NULL)` and an index on `master_request_id` |
| **Retired or renamed** | **None.** Nothing was dropped, nothing renamed |

**So the "old schema attribute list" IS the Part A list.** Every column below existed before the migration too.
What changed is not *which columns exist* but **which rows carry meaningful values in them** — i.e. row
semantics, not schema.

**What the migration actually changed, per column:**

| Column | Before 2026-07-16 | After |
|---|---|---|
| *(every row)* | A standalone request | A **parent** OR a **child** |
| `master_request_id` | always NULL | NULL on parents, set on children |
| `child_no` | did not exist | NULL on parents, `1..n` on children |
| `is_mrr` | hand-set flag, meaningless | **derived** (`child_count > 1`), parent only, **forced 0 on every child** |
| `request_number` | one number per row | parent keeps the citizen's number; child gets a **`-N` suffix the citizen has never seen** |
| `stage` | on every row | **child only** — parents are `NULL` |
| `description`, `record_types`, `department_id`, `record_type_id`, `component_label` | on every row | **child only** — NULLed on the parent |
| requestor identity, delivery, mailing, `purpose`, `fee_waiver_requested` | on every row | **copied down** to children (see A2) |
| `deadline_date` | on every row | parent-owned, **cascaded down** as a derived copy |
| everything else | on every row | unchanged — still written wherever it was |

> ### ⚠️ Why this is the dangerous kind of migration
> Because no column changed, **every pre-migration query still runs.** It just may now answer a different
> question. `services/requestScope.js`'s predicates were deliberately chosen to be **tautologies against
> pre-migration data** so they could be adopted as a provable no-op — which means they were invisible until
> children existed, and are **load-bearing now**.
>
> **A query that looks correct, and that WAS correct against old data, can be wrong today.** Every defect in
> Part A5 and A6 is an instance: the code did not change, the data underneath it did. This is also why the
> "old vs new schema" framing does not find them — there is no schema diff to read. The diff is in meaning.

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
| task type `build_redaction_template` | **[verified 2026-07-19]** appears nowhere in `src/`; `verify_notifications.js:75` asserts it is **never** created. Existed only as a doc claim tagged `[code-verified]` | already corrected in `TASK_AND_NOTIFICATION_MODEL.md`; nothing to delete in code |
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
| `delivery_mode` (`as_ready` / `hold_all`) | parent | §5.8 | Release timing | **DECIDED 2026-07-19 — `as_ready` is the default**; `hold_all` unavailable in entitlement jurisdictions (WA). Build it |
| `delivery_fee_basis` (`per_request` / `per_installment`) | parent | §5.10.6 | Whether N shipments cost N delivery charges | **DECIDED 2026-07-19 — `per_request` default.** ⚠️ Undecided for `rate: 'actual'` delivery (live in TX profile) |
| `componentCharged` | child | §5.10.2 | Per-record price after request-level rules | **DECIDED 2026-07-19 — generalized prorata.** The field three features are blocked on |
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
10b+10c. ~~**Release policy (was item 2) and notice packaging (was item 10)**~~ → **RESOLVED 2026-07-19 by
    becoming the MRR RULE MATRIX, SHIPPED BLANK** (`SPEC §15`). Kevin's call: where the law is this silent, a
    shipped default is the vendor making policy for a government — and it runs invisibly, so a wrong default
    stays wrong for years. **No values ship.** The city answers each row with counsel; **MRR does not unlock
    until the matrix is complete.**
    Rows: `delivery_mode` · `hold_override` · `delivery_fee_basis` · `notice_packaging` · `notice_send` ·
    `fee_allocation`. Each stores **value + basis (statute/ordinance/city policy) + who set it, when**.
    **The gate costs nothing: every row is a no-op at n = 1** (one record → one shipment → one notice → one
    component), so ordinary requests are untouched and the un-built hub is the only thing gated.
    Our seven-state research is surfaced beside each row as **considerations for the city to weigh, never as a
    recommended value** — that keeps the research valuable without turning it into vendor policy.
    ⚠️ **Still open:** what a city sees if an MRR arrives while the matrix is blank (a citizen submits when they
    choose — "locked" must not mean "submission fails"). Likely: accept and wrap normally, hub and per-child
    release/notices inert until answered. **Needs deciding before build.**
10a. ~~**Fee allocation across children**~~ **DECIDED 2026-07-19 — generalized prorata** (`SPEC §5.10.2`):
    `componentCharged[i] = componentGross[i] × (total / grossSubtotal)`. Replaces the running-cap rule, which
    made a record's price depend on **release order**. `[NOT BUILT]` — `componentCharged` does not exist under
    any method today, and it is what the §5.9 release gate, `fee_revenue by department` and ERP line items are
    all blocked on. Also decided: compute here, send Finance line items rather than totals (§5.10.5).
10. **Which notice goes out when children disagree?** `[surfaced 2026-07-19 by the doc sweep]` Retiring the
    parent `PARTIALLY_GRANTED` roll-up removed a *status*, but the **compliance artefact it implied is still
    owed**: one child delivered + one child denied is a single citizen who must receive both the records and a
    citable denial. Options, none evaluated: one combined notice per parent · per-child notices · a notice per
    delivery installment. **Interacts with item 2** (Hold-All vs As-Ready), because installment delivery and
    per-installment notices are the same decision seen twice. Belongs to the §4.4 field-design pass.

---

## Appendix — the stale-doc sweep `[all but one CORRECTED 2026-07-19]`

### ✅ Fixed

| Doc | What it said | What it says now |
|---|---|---|
| `SPEC_parent_child_lifecycle.md:6-8` | "**DESIGNED, NOT BUILT** … 129 requests, 0 children" — the most-read part of the binding spec disclaiming its own existence | "**BUILT — the storage model is live**", split into what's live / what isn't / the one money divergence. Adds the rule that **a section's own build tag beats the header** — it is closer to the code |
| `DOMAIN_MAP.md:24` | "DESIGNED 2026-07-13, NOT BUILT" — in the index agents read first | Built, plus the warning that `andParent`/`andLeaf` are now load-bearing rather than tautological |
| `SPEC_parent_child_lifecycle.md:461` | "there are 125 requests and **0 children have ever been created**" — inside §8, the section describing the migration that falsified it | Reframed as an explicit pre-migration "before" snapshot |
| `TASK_AND_NOTIFICATION_MODEL.md` §7.1–7.5 | A 2026-07-07 **audit**: "'always parent' — **VERIFIED FALSE**", "child creation does NOT exist", "a child IS a full request row", the `PARTIALLY GRANTED` roll-up | Corrected inline, originals retained as history. §7.4's blast-radius estimate flagged as **too optimistic for a traceable reason** — "point-lookups by id are UNAFFECTED" is exactly the false premise that produced the `GET /requests/:id` bug |
| `TASK_AND_NOTIFICATION_MODEL.md:51` | Task catalog tagged `[code-verified]`, listing `build_redaction_template` as implemented | **It exists nowhere in `src/`**, and `verify_notifications.js:75` asserts it is *never* created. Also added the five omitted live task types |
| `SPEC_fees_estimates_payments.md:21` | "MRR-aware fee aggregation across children **exists**" | Retired, with the verified dunning consequence. §4a in the same file said the opposite ("Request-level only") — the file contradicted itself, with the accurate sentence buried below the false one |
| `SPEC_fees_estimates_payments.md:45` + `SPEC_tasks_roles_mrr_fees.md` ×3 | "deferred to **#11**" / "waits for #11" — **#11 shipped 2026-07-16**, so these read as *blocked* when they are **unblocked and unbuilt** | Corrected. The labor rollup's "aggregate lands on the first component" was verified false: `rollup()` has no parent/child scoping and its caller passes a child id, so an MRR gets per-child rollups and **no parent total** |
| `SPEC_record_search_task_screen.md:406` | Per-record states justified as "the prerequisite for the MRR Partially-Granted roll-up" | Reframed to stand on their own — the searcher's answer to each description, the enforcement half of R9 |
| `SPEC_record_search_fulfillment.md:25` | Same retired roll-up, **and** marked the resolution step `[NOT BUILT]` | Both corrected — it shipped 2026-07-14 |
| `WORKFLOW_DECISIONS.md` Part 4 + scenarios B/E/F | "A request ends in exactly one terminal state", incl. `PARTIALLY_GRANTED` | Mapped onto §5.8's eight **child** dispositions. Surfaced two the list was missing (`Previously furnished`, `Not in our custody`). Deposit-overrun paths gained a caution: "deliver what the deposit covers" must not become "withhold child B because child A is unpaid" |
| `SPEC_parent_child_lifecycle.md` §14.5 | Routed mixed-outcome resolution to **§6.2** — which says "do not build from this section" | No mixed-outcome resolution exists to perform; each child keeps its own disposition |

### ⚠️ Still stale — deliberately not fixed

| Doc | Why left alone |
|---|---|
| `HANDOFF.md:3810, 3892, 3953` | Carries the same "deferred to #11" language, but **HANDOFF is a dated historical log** — those entries were true when written. Editing them would falsify the record of what was known when. The specs they describe are corrected |

### What the sweep did NOT change

**No code was touched, and no design was invented.** Where correcting a doc exposed a real question rather than
a stale fact, it was flagged `[OPEN]` and left for you — see Part H items 2 and 10.
