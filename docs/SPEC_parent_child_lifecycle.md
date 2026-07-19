# SPEC — Parent/Child Request Model & Lifecycle Vocabulary
**Status: RATIFIED 2026-07-16 by Kevin — THE single binding document for the parent/child model.**
`SPEC_tasks_roles_mrr_fees.md` §12 is now a pointer stub to this file; its citizen layer, fee layer and staff-workflow
design (§12.1) are folded in here as **§13** and **§14**. `ARCHITECTURE.md` item 1 is ratified in the same commit.

**BUILT — the storage model is live. `[corrected 2026-07-19]`**

> ⚠️ This paragraph until 2026-07-19 read **"DESIGNED, NOT BUILT … 129 requests, 0 children, zero lines of code
> write `master_request_id`."** That was true when written, on the morning of 2026-07-16, and **false by that
> afternoon** — §7 and §8 shipped the same day and are tagged `[BUILT 2026-07-16]` two hundred lines below.
> It is corrected here because the top of the binding document is the part everyone actually reads: at least
> one later work session skipped this spec entirely and re-derived the model from a live DB inventory,
> producing a brief whose central claims were wrong. **If a section header and this header disagree, the
> section header wins — it is closer to the code.**

**What is live.** Every request is now a parent with 1..n children. The wrap (§8), the parent/child-aware query
layer (§11), the portal emitting n children, and the queue (§7) are all built and covered by
`verify_wrap_parent`, `verify_mrr_children` and `verify_queue_parent_child`. Live data contains real children,
so **every predicate in §11 is now load-bearing rather than tautological** — a query that looks correct against
pre-migration data can be wrong now.

**What is NOT built** (each tagged at its own section): the MRR hub §14.3 `[NOT SCOPED — design direction
required first]` and the staff surfaces within it §14.4; suggest-vs-commit child routing §14.2 `[DECIDED, not
built — children auto-commit today]`; the parent field-design pass §4.4, which parks `outcome`,
`withdrawn_reason` and `closure_reason`; the MRR `classification` worst-case roll-up (§6); fee-waiver policy
§12; and parent `disposition` §6.2, which is `[DEFERRED]` and must not be built from.

**One known divergence between this spec and the code.** §4.3 places money at the parent. The implementation
keys estimates, fee-waiver decisions and `estimated_fee` on the **child** — every fee endpoint uses the id it
is handed, and every UI path hands it a child. Verified consequence (2026-07-19): non-payment dunning is
**inert for every wrapped request**, because the sweep is parent-scoped and the money is not. Reproduction:
`backend/tests/verify_nonpayment_scope.js`. Resolving this is gated on the same question as the hub — how n
children's fees roll up into one citizen bill. See `WORKING_attribute_inventory.md` (working snapshot).

**Merged 2026-07-16** from the two documents below plus Kevin's rulings of that date (toll attribution §4.2.1;
child routing §14.2; hub ownership §14.1). Supersedes, on the storage/lifecycle question, the two incompatible
prior designs:
- `ARCHITECTURE.md` item 1 ("every request is wrapped in a parent"; "a child IS a full request row") — **directionally right, wrong on the field split.**
- `SPEC_tasks_roles_mrr_fees.md` §12 ("one request, many items"; master/child "retired") — **right on the citizen and fee layers, wrong to retire the parent row.**

Both are reconciled in §1. Source inputs: Kevin's `uploads/parentchildrecordprocessingstatus.xlsx` (the status vocabulary), and two legal research passes (Texas PIA; FL/CA/IL/WA/NY/CT) recorded in **Appendix A**, which is what decides where each lifecycle event lives.

---

## 1. The reconciliation

`ARCHITECTURE.md` item 1 and `SPEC_tasks_roles_mrr_fees.md` §12 have been in open contradiction since 2026-07-10. Neither is wholly right.

§12 was correct that **the citizen sees one request, one number, one fee, one deadline** and is never asked "combined vs separate." Nothing here changes that. §12 was also correct that **fees are computed once at the request level** and that per-request thresholds (minimum, de-minimis, floor/ceiling, deposit, certification) apply **once** no matter how many records are described.

§12 was wrong to conclude that the parent row should therefore disappear into a `request_items` side table. The reason is operational, and it is Kevin's: **a report of "everything currently in redaction" must list single-record requests and multi-record children in one uniform list.** If a single-record request is a `requests` row and a multi-record component is a `request_items` row, every query, filter, task list, queue view and report has to union two shapes forever. That is the single-vs-multi special-casing item 1 exists to kill.

**Resolution — always-wrap, with an asymmetric field split.** Every request is a **parent** with **1..n children**. A child is *not* "a full request row" (item 1's error): parent and child carry **different fields**, because the law assigns different things to the request and to the record. The child is the unit of *work*. The parent is the unit of *citizen relationship, money, and the statutory clock*.

Terminology: use **parent** and **child** in code and in staff-facing UI. §12's "item" is the same object; the rename buys nothing and the docs already use both.

---

## 2. Why the split falls where it does (the legal constraint)

Full citations in Appendix A. The short version, and it is unusually clean — all seven jurisdictions researched agree:

> **Exemptions, denials, redactions, record-holds, and appeals are RECORD-level. The statutory clock, the deadline, fees, and everything that pauses the clock are REQUEST-level.**

Two consequences drive this whole design:

1. **A record-hold must never stop the parent clock or block a sibling.** Texas ORD-664 (2000) holds that the 10-business-day window to seek an AG decision "is not a grace period" — records *not* in dispute must still be produced promptly while the disputed ones sit at the AG. A system that models "AG hold" as a request-level freeze will cause a city to unlawfully withhold records it was obligated to release. This is the highest-consequence modeling decision in the document.
2. **A per-child *statutory* deadline does not exist.** Illinois has one request-level answer date and no installment safe harbor (5 ILCS 140/3(d)); a child that slips past the parent deadline is a *constructive denial of the request* (§9(c)). So children may carry **budget** dates (internal SLA) but never legal ones.

Kevin's spreadsheet already made distinction (2) on its own — the parent carries the **Due Date**, each child workstream carries a **Budgeted Due Date** plus a days ahead/behind delta. That separation is the load-bearing idea and is adopted verbatim.

---

## 3. The five axes

The vocabulary was vague because five independent things were being packed into "status." They are:

| Axis | Lives on | What it answers |
|---|---|---|
| **Stage** | child | Where is this record in the work pipeline? |
| **Task state** | task | Is the work item queued, claimed, in process, done? |
| **Outcome** | child (rolled up to parent) | What finally happened to this record? |
| **Hold** | **both — two different kinds** | What is blocking, and what does it block? |
| **Clock** | parent (statutory) · child (budget) | Are we late, and against which clock? |

**Hold is two distinct objects and must never be one field:**

- **Clock-hold (parent).** Stops or restarts the *statutory* clock. Reasons: clarification pending, deposit/prepayment pending, volume extension, catastrophe suspension, nonpayment. Work may or may not continue; the clock does not run.
- **Record-hold (child).** Blocks *release of that child only*. Reasons: AG ruling pending, litigation, active investigation, third-party notice/injunction. **Never stops the parent clock. Never blocks a sibling.**

---

## 4. Parent — fields and value lists

Kevin's sheet, corrected and extended. (The sheet's last three payment values landed in the Dispute column; they are payment values and are placed here accordingly.)

### 4.1 Identity and citizen relationship
| Field | Notes |
|---|---|
| `request_number` | `2026-0045`. The number the citizen knows. Assigned at the parent, always. |
| `requestor_name / _email / _phone / _type` | Parent only. Children never carry requestor identity. |
| `purpose`, `delivery_method`, `mailing_*`, `certification_requested`, `submission_channel` | Parent only. |
| `submit_date` (`created_at`) | Parent only. The statutory trigger. |
| `is_mrr` | **Derived**, not a mode: `child_count > 1`. Never hand-set. (§12 was right about this.) |
| `mrr_manager` (`assigned_to`) | Populated **only when `is_mrr`**. The parent has no routing otherwise. |

### 4.2 Clock (statutory)
| Field | Values |
|---|---|
| `due_date` | The statutory deadline. Derived from `submit_date` + jurisdiction rules. **The only legal deadline in the system.** |
| `clock_state` | `Running` · `Tolled` · `Stopped` (closed/withdrawn) |
| `tolled_days` | Kevin's "Tolling {N} Days" — the accumulated suspension, already computed by the built `tolling.js` derived clock. |
| `budget_variance` | Kevin's "Budget Date +/-" — days ahead/late, **calculated from child data** (see §6.3). Management signal, not legal. |

**Two kinds of clock event — and both primitives already exist.** (Corrected 2026-07-13 after the audit in §10; an earlier draft of this section wrongly said the reset primitive was missing.)
- **Toll** — suspend, then resume. `tolling.js:108` `toll()` / `:119` `resume()`.
- **Re-receipt / restart** — reset the clock's epoch so it runs a clean full duration from now. **`tolling.js:132` `restart()` is BUILT** (closes any open toll, resets `started_at`, and `computeStatus`'s clamp at `:37` prevents pre-restart toll time from inflating the new due date). One caller today (`clarificationAction.js:200`); no route, no UI.

Texas needs the second kind in three places:
- §552.222 clarification: the 10-day clock is *measured from the date the request is clarified* (*City of Dallas v. Abbott*, 304 S.W.3d 380 (Tex. 2010)) — a **reset**, not a pause. Already expressible: the `clarification_clock_effect` enum value `toll_and_restart` maps to exactly this (`clarificationAction.js:32-42`).
- §552.263(e) deposit: the request is "considered … received on the date the governmental body receives the deposit" — a **reset**. **No rule slot exists** (§10).
- §552.2325 catastrophe suspension is the *only true toll* in the Texas Act (max 14 days).

**A third primitive, `extend()`** — `toll()` pushes the due date out by *elapsed wall time*, which cannot express
"+10 statutory days for unusual volume" (IL §3(e), CA §7922.535(b)). **BUILT 2026-07-13** (`0ef868d`, 30/30),
together with `tollReasons` validation. *(This line previously read "genuinely absent" — stale since 07-13.)*

### 4.2.1 Toll attribution — WHERE the trigger is recorded `[DECIDED 2026-07-16 by Kevin]`

**The clock lives on the parent. The trigger is attributed to whatever caused it.** Attribution is not ownership:
recording that child 3's clarification tolled the parent clock does **not** give child 3 a clock. This keeps the
model legally compliant (§2) while answering the question the current schema cannot: *which record is holding up
this request?*

`clock_tolls` today is `id, clock_id, reason, tolled_from, tolled_until, note` — `reason` says **why**, nothing
says **which child**. On a five-child request that is a real operational hole. Add:

| Field | Notes |
|---|---|
| `source_request_id` | **Nullable.** The CHILD whose event triggered the toll. **NULL = a parent-level event** (deposit nonpayment/re-receipt, volume extension, catastrophe suspension). One ledger, both sources, full visibility. |

This generalises a pattern the spec already uses in exactly one place (§11.1): the clarification **EVENT** is
logged on the child, the **CLOSURE** lands on the parent. Kevin re-derived it independently on 2026-07-16, which
is why it is now the general rule rather than a special case.

> ✅ **BOTH ENGINE BUGS BELOW ARE FIXED — `01c3b36`, 2026-07-16, `verify_concurrent_tolls` 27/27, suite 641/641,
> live untouched, deployed and read-only verified.** `toll()` is now idempotent **per reason** (different reasons
> may hold the clock at once); `resume(clockId, reason)` closes only that hold and the clock resumes **only when
> the last one closes** (refcount, not flag); `unionDays()` merges overlapping/adjacent spans before counting.
> Callers pass their own reason (`clarificationAction` → `clarification_pending`, `depositAction` →
> `payment_pending`, the AG release in `routes/requests.js` → `ag_ruling_pending`) so none can release a sibling
> hold. **Proven by break-test:** restoring the per-clock guard fails 9/27; reverting union→sum fails exactly the
> 4 overlap-sensitive assertions while disjoint/adjacent correctly still pass.
> **Still outstanding from this section: `source_request_id` attribution** — deferred to the migration slice,
> where "which child" first means something (today every row is its own parent and child, so the column would
> record an ambiguous value). The bug fix stands alone and did not need it.
>
> *The two bugs, retained for the record:*
>
> ⚠️ **TWO ENGINE BUGS BLOCKED THIS — AND THE FIRST WAS LIVE, ON THE FLAT SCHEMA.**
>
> **1. Only one toll may be open at a time — a second trigger is SILENTLY DROPPED.**
> `tolling.js` `toll()`: `SELECT id FROM clock_tolls WHERE clock_id = ? AND tolled_until IS NULL` →
> `if (open) return { alreadyTolled: true }`. No error, no log. And `resume()` closes **every** open toll at once.
> Live consequence today: a clarification is open → a record goes to the AG → the AG hold **never registers** →
> the clarification is answered → `resume()` → **the clock runs while the request is still legally suspended at
> the AG.** The city burns statutory days it was entitled to suspend, and nothing records that it happened.
> Latent today only because concurrent tolls are rare; **this model makes them routine.**
>
> **2. The accumulator SUMS toll intervals** — `tolled += calc.basisDaysBetween(from, until, basis, H, W)` —
> which is safe *only* because of bug 1. Lift the single-toll guard naively and overlapping tolls double-count:
> child A tolls Jan 1–10 (10d), child B Jan 5–15 (10d) → **summed 20 days, actually suspended 15**. The due date
> extends five days beyond what the law allows and the dashboard reports **compliant while the city is late** —
> the same class of failure as the 10,000 numbering ceiling: a wrong number that presents as a right one.

**Required engine shape — BUILT `01c3b36`:** multiple **concurrent open tolls**; `tolled_days` = the **UNION of
intervals, NEVER the sum**; the clock resumes only when the **last** open toll closes (a refcount, not a flag).
*(Attribution via `source_request_id` is the one piece deferred — see the note above.)*

**A child-triggered restart restarts the WHOLE parent clock**, including siblings that were never at fault. That
is the law — §552.222(d) re-receipts "the underlying request," not one record — and it follows §6.2's rule that
parent-level terminal events cascade down. It is operationally generous (one vague child hands the city a fresh
full clock on four innocent ones) and is recorded here so that it is a **decision**, not a surprise in a report.

### 4.3 Money
| Field | Values |
|---|---|
| `estimate_status` | `Pre-estimate` · `Estimate delivered` · `Resolved – Adjustment Applied` |
| `fee_dispute` | `None` · `Active` · `Denied` · `Resolved Pending Approval` |
| `payment_status` | `Estimate Invoiced` · `Estimate Payment Received` · `Estimate Payment Late` · `Late HOLD` · `Final Payment Invoiced` · `Outstanding Balance HOLD` · `Paid in Full` |
| `fee_waiver_*` | Parent level (already built). |

`fee_dispute` is the **fee/estimate objection** — correctly parent-level in every jurisdiction. It is *not* the same object as a records appeal (§5.6), which is child-level. Two fields, never one.

The two `HOLD` payment values are **clock-holds** (§3). Today `awaiting_payment` does **not** toll (`payment_pending` is declared in `tolling.js` and never invoked) — see §9, open question 2.

### 4.4 Rolled-up state
| Field | Values |
|---|---|
> **SIMPLIFIED 2026-07-16 by Kevin — the parent carries PROCESS STATUS ONLY. No disposition, no outcome.**
> *"Perhaps for now it's best to not include disposition/outcome at the parent and have a description of process
> status, which would be in process, or complete. Shipped or delivered would belong at the child record… This was
> all poorly designed in the first build and I don't want to by default carry that bad design over to the new
> schema… get the new schema working then later make a pass."*
>
> This **dissolves** the `outcome`-vs-`disposition` contradiction below rather than arbitrating it: §4.4 called the
> field `outcome` (`Granted` · `Granted in Part` · …) and §6.2 called the same field `disposition`
> (`Fulfilled` · `Partial fulfillment` · …) — two names, two value lists sharing only `Denied`, plus a third set
> from §6.2's cascade branch that appeared in neither. **Nothing could be built on that.** The field with two
> definitions now has none, and the real outcome lives where Kevin says it belongs: on the CHILD (§5.8), which
> already carries `Closed – Delivered` / `No records located` / `Denied` / `No response` and four more.
>
> **DELIVERY IS A CHILD FACT** (Kevin, 2026-07-16): *"mrr types should be delivered asap when fully processed."*
> A parent-level `Delivered` state would be a lie the moment one child of five is still in redaction — and it
> would invite holding four finished records hostage to the fifth, which §5.9's coverage test forbids anyway.

| Field | Values |
|---|---|
| `parent_state` | **`In Process` · `Complete`** — **derived** (§6.1). Deliberately coarse. The parent does not track *where* work is (that is the child's `stage`, and an MRR's children are at different stages simultaneously) — only whether it is all done. |
| ~~`outcome`~~ | **DEFERRED 2026-07-16.** Not built, not designed. Revisit in the field-design pass; do NOT carry the v1 model over by default. |
| `withdrawn_reason` | `Clarification not provided` · `Deposit not paid` · `Requestor did not claim records` · `Requestor withdrew` — *also deferred with `outcome`; the reason a request ended is recorded on the CHILD's disposition (§5.8) today.* |

**Withdrawal is a parent event even when triggered by one child.** Kevin's sheet has `Complete: Closed No Clarification Provided` on the child's Record Search. In Texas, §552.222(d): no answer to a clarification within 61 days and "the underlying request … is considered to have been withdrawn." So the child records *why*, but the terminal effect lands on the parent.

---

## 5. Child — fields and value lists

### 5.1 Identity
| Field | Notes |
|---|---|
| `id` | Keeps the pre-migration `requests.id` (see §8). |
| `master_request_id` | → parent. Column already exists. |
| `child_no` | `1..n`. **Not** 0-for-single. A zero would make the single-record case a different shape, which is exactly what always-wrap exists to prevent. |
| `request_number` | Composite: `2026-0045-1`. This *is* the combining field Kevin asked about — no separate column needed. **The `-1` suffix is hidden in the UI when the parent has one child.** |
| `component_label` | Human label ("body-cam footage"). Column already exists. |
| `description` | **Child only.** The parent has no description. |
| `record_types`, `classification`, `routing_basis` | Child only — routing is decided from the description. |
| `department_id`, `assigned_to` | Child only ("Fulfillment Team Assigned"). |

### 5.2 Stage (child)
Today's `STAGE_ORDER` is `intake · fee_review · awaiting_payment · record_search · exemption_review · ag_review · redaction_review · redaction · delivery · closed`. Under this model:

- `fee_review` and `awaiting_payment` **move off the child** — they are parent gates (money is parent-level).
- Everything else stays on the child.
- Kevin's coarse child `Stage` {`Intake`, `In process`, `Completed`} is retained as a *derived* summary above the fine-grained stage, for queue display.

### 5.3 Workstreams
Each carries a **budgeted due date**, a **days ahead/behind** delta, and a status. Budgeted dates come from estimate profiles ("we need to build a few profiles with some instruction for AI to select best fit profile" — Kevin's note; this is `BUILD_PRIORITY` item 3).

| Workstream | Values |
|---|---|
| **Estimate Data Collection** | `Not Started` · `Queue` · `In Process` · `Submitted` |
| **Record Search** | `Not Started` · `Queue` · `In Process` · `Clarification Requested` · `Complete: Self-Service Portal` · `Complete: Records Located` · `Complete: Partial` · `Complete: No Record Found` · `Complete: Closed – No Clarification Provided` |
| **Redaction** | `Not Required` · `Template Auto Redaction` · `Queue` · `In Process` · `Submitted For Review` · `Submitted For Legal Redaction` · `Revision Requested` · `Revised Submitted For Review` · `Completed` |
| **Legal Redaction** | `Not Requested` · `Queue` · `In Process` · `Redaction Complete` · `Redaction Submitted For Review` · `Legal Redaction Completed` |
| **Legal Review** | `Not Requested` · `Queue` · `In Process` · `Determination Complete` |

`Revision Requested` / `Revised Submitted For Review` are exactly the returned-for-rework states the redaction reviewer already writes (shipped `c7c6920`); `BACKLOG` R10 is the surfacing of that state on the author's task row.

`Record Search`'s `Complete: *` values are the **enforcement half of `BACKLOG` R9** and of `BUILD_PRIORITY` item 5 ("explicit found/not-found resolution states"). R9 captures the *requestor's* intent (`search_more` / `no_match_search`); these capture the *searcher's* answer. Both are child-scoped, which is now confirmed correct.

### 5.4 Budget clock (child)
| Field | Values |
|---|---|
| `budget_clock` | `None` · `Active` · `Complete {N} days` |

**Kevin's ruling (2026-07-13): child tolling is the BUDGET clock, not the statutory clock.** The statutory clock exists only on the parent. Name the column `budget_clock`, never `tolling`, so the two can never be confused in a query or a report.

### 5.5 Record-hold (child) — NEW
Not in the sheet. Required by the law.

| Field | Values |
|---|---|
| `record_hold` | `None` · `AG Ruling Pending` · `Litigation` · `Active Investigation` · `Third-Party Notice / Injunction` |

Blocks **release of this child**. Does **not** stop the parent clock. Does **not** block siblings. (TX §§552.103, 552.108 + ORD-664; WA RCW 42.56.540 enjoins "any *specific public record*"; FL §119.071(2)(c); IL §7(1)(d)(i); NY §87(2)(e); CT §1-210(b)(3)–(4).)

**AG ruling requests are a grouping object, not a status.** Texas §552.301(e)(2) requires the submission to be "labeled to indicate which exceptions apply to which parts," and rulings come back per-exhibit. Model: one parent → 0..n ruling requests → each covering 1..n children → each child carrying 1..n claimed exceptions. The §552.301(b) 10-business-day deadline is computed from the **parent's** receipt date.

### 5.6 Appeal (child) — NEW
Not in the sheet. Distinct from the parent's `fee_dispute`.

| Field | Values |
|---|---|
| `appeal_state` | `None` · `Appeal Filed` · `Under Review (AG / PAC / FOIC)` · `Litigation` · `Resolved – Release Ordered` · `Resolved – Withholding Upheld` |

An appeal on one child **must not freeze the parent or its siblings** — no researched jurisdiction supports that, and WA/NY/CT/IL all expressly contemplate parallel appeal and production.

### 5.7 Withholding log (child) — NEW
Not in the sheet. **This is the field that gets a city sued if it's missing.**

Every jurisdiction requires a per-record exemption claim with a citation and an explanation:
- WA RCW 42.56.210(3) — "the **specific exemption** authorizing the withholding of the record (or part) and a brief explanation of **how the exemption applies to the record withheld**."
- FL §119.07(1)(e) — "state the basis of the exemption … **including the statutory citation**."
- IL §9(b) — exemption + "a **detailed factual basis** and a **citation** to supporting legal authority."
- TX §552.301(e)(2) — labeled per part.

New table `child_exemptions`: `child_id` · `file_id` (nullable — a whole-record withholding has no file to point at) · `exemption_code` · `statutory_citation` · `explanation` · `scope` (`whole_record` | `portion`) · `asserted_by` · `asserted_at`. The city's withholding log for a request is generated by iterating children. The existing redaction rule library already carries citations — this is where they surface to the citizen.

### 5.8 Disposition and delivery (child) `[ANSWERED 2026-07-14 — Kevin + fee/installment research]`
The sheet ends at Redaction → `Completed` and the child falls off the edge; nothing records that the record was actually released.

**Child terminal disposition** — every child ends in exactly one of these. Kevin's four, plus the ones the law adds:

| `disposition` | Notes |
|---|---|
| `Closed – Delivered` | Records released. **Redacted release is still Delivered** — the withholding log (§5.7) carries the detail. |
| `Closed – No records located` | |
| `Closed – Denied` | Withheld in full under an exemption. **Requires a citation** (§5.7). |
| `Closed – No response` | Clarification unanswered. |
| `Closed – Non-payment` | |
| `Closed – Withdrawn by requestor` | Voluntary. Genuinely distinct from *No response*: one is a choice, the other is silence. |
| `Closed – Previously furnished` | Tex. Gov't Code § 552.232 — certify the same records were already provided, in lieu of re-copying. A real terminal outcome, **not** a denial. |
| `Closed – Not in our custody / referred` | The agency does not hold them. |

| Field | Values |
|---|---|
| `installment_no` | Which delivery batch this child went out in. |
| `delivered_at` | |

**Per-child release is first-class, not an MRR override.** WA RCW 42.56.080(2) makes installment delivery a requestor *entitlement* ("on a partial or installment basis as records … are assembled or made ready"). Keep `Hold-All` as the parent's operator default (what most cities do), but model `As-Ready` as a first-class parent `delivery_mode`. The MRR "force release one child" button is then an ordinary As-Ready release, not a bespoke path.

### 5.9 The payment gate is a COVERAGE test, not a whole-request test `[research 2026-07-14]`
**A child may NEVER be withheld because a *sibling* is unpaid.** No state authorizes conditioning release of one record on payment for a different record. The payment hook is tied everywhere to *the copies being provided*: TX "charges **accrued**" (§ 552.221(b)(2)) · CA "fees covering **direct costs of duplication**" (§ 7922.530(a)) · FL "the fee prescribed by law" (§ 119.07(4)) · NY "the fee prescribed **therefor**" (§ 89(3)(a)) · CT "**such** fee" (§ 1-212(c)). And two states cut affirmatively against sitting on finished records: **TX § 552.221(a)** ("shall **promptly produce**") and **CA § 7922.500** ("nothing … shall be construed to permit an agency to **delay or obstruct** the inspection or copying of public records").

Per-jurisdiction **`payment_release_rule`**:
- **`pay_in_full`** *(default — TX, IL, CA, FL, NY, CT)* — one estimate, one payment. Once the request's charges are paid, **any child releases the moment it is ready**. This is Kevin's instinct and it is the legally safest rule.
- **`per_installment`** *(WA — the only real one)* — RCW 42.56.120(4): the agency "**may charge for each part of the request as it is provided**." Each installment is priced at its own actual cost and releases when its own charges are covered. Sharp edge, and it must be modelled: "**If an installment … is not claimed or reviewed, the agency is not obligated to fulfill the balance of the request**" — in WA a *child-level* abandonment can legally close the *whole request*. (WA AG model rules also warn agencies they "**cannot use installments to delay access**." A model-rules **rewrite is in flight** — comment period ran to 2026-06-30. **Re-check WA before hard-coding it.**)

**TX has NO per-batch charging authority anywhere in ch. 552.** Every threshold is request-level (the 50-page rule § 552.261; the $40 itemized-statement trigger § 552.2615; the $100/$50 deposit triggers § 552.263). § 552.306(c)(2)(B)'s batched delivery is a **scheduling device inside the AG-decision track only** — it is not a billing regime. § 552.263(b): a deposit "may **not** … [be] a down payment for copies … the requestor **may request in the future**" — strictly request-scoped.

### 5.10 Fee ALLOCATION across installments — THE LAW IS SILENT `[research 2026-07-14]`
This was researched hard, twice, at Kevin's request. **Across all seven states there are exactly TWO rules that decide an allocation question:**
1. **WA RCW 42.56.120(2)(b)** — the per-request $2 flat fee is charged **once, on the FIRST installment**: "an additional flat fee shall **not** be charged for any installment after the first installment of a request produced in installments."
2. **VA** — a deposit "shall be **credited toward the final cost**."

**That is the entire body of authority.** Minimums, de-minimis floors, ceilings and deposits are all drafted as if a request produces exactly one invoice. **Do not go looking for a rule to implement — there isn't one.** Design a default, and label it a design decision.

### 5.10.1 The real problem is bigger than the cap `[REVISED 2026-07-19 — supersedes the running-cap default]`

**`componentGross` is a naive per-record sum that is NEVER the amount charged.** `feeEngine.compute()` prices
each component as hours × rate and pages × rate with **no rounding, no billability gate, no free allowances and
no tiers** (`feeEngine.js:142-168`), then **discards that** and re-prices everything from **request-level
aggregates** (`agg.search`, `agg.bw`, …). So `Σ componentGross ≠ total` for reasons that have nothing to do
with the ceiling.

**No request-level rule decomposes to components.** The ceiling is only the most visible instance. The full
inventory, verified against the engine 2026-07-19:

**Vehicles that make a combined request CHEAPER than the same records requested separately:**

| # | Vehicle | Mechanism |
|---|---|---|
| 1 | **Duplication tiers** | `tieredAmount()` walks bands on the **aggregate** page count. Ten 50-page records billed separately all sit in band 1; combined, 500 pages reach the cheaper bands. Literally quantity-break pricing. Implemented; not enabled in the live TX profile |
| 2 | **`maxFee` ceiling** | The known one. **`null` in the live TX profile** — theoretical today |
| 3 | **Delivery charged once per request** | N records, one delivery + handling. Separately, N charges. ⚠️ Collides with As-Ready (§5.8): you physically ship three times, the model charges delivery once |
| 4 | **`minFee` floor** | One floor instead of N. An *uplift*, not a saving — but it still needs allocating |

**Vehicles where prorata does NOT obviously apply — and this is the half that matters:**

| # | Vehicle | Mechanism |
|---|---|---|
| 5 | **Labor rounding on aggregates** | `roundHours(billable[k], increment, mode)` runs on the request total. Ten records at 0.1h each: separately 10 × 0.25 = **2.5h billed**; combined 1.0h → **1.0h**. **LIVE in the active TX profile** (increment 0.25, rounding up) while `maxFee` is null — so this gap is real *today* and the ceiling is not |
| 6 | **`laborGate` thresholds** | Keys on `totalPages` / `totalLaborHours` across the whole request. Under TX § 552.261's 50-page rule, ten 10-page records are each under 50 → labor free; combined at 100 pages → labor becomes **chargeable**. **Runs the OTHER way**, and it is a **step function** — labor flips entirely on or off |
| 7 | **Free allowances** | `freeLaborHours`, `freePageAllowance`, `av.freeMinutes` — one allowance per request, consumed in a fixed order across aggregates. Combining is *more* expensive, and nothing records which component consumed them |
| 8 | **`deMinimis`** | Evaluated on the request total, deliberately, to stop splitting arbitrage |

**⚠️ The consequence for design: there is not always a "saving" to allocate.** In 5–8 the combined request can
cost **more** than the sum of individuals, so the delta is a *surcharge*. And #6 is not proportional in either
direction. **Any rule expressed per-vehicle will be wrong for half of them.**

### 5.10.2 THE RULE — generalized prorata `[DECIDED 2026-07-19 by Kevin]`

One rule, both directions, no knowledge of *why* the delta exists:

```
grossSubtotal        = Σ componentGross[i]                       (already computed, feeEngine.js:172)
componentCharged[i]  = componentGross[i] × (total / grossSubtotal)
```

Equivalently: every component is scaled by the ratio of what was **actually charged** to the naive sum. The
delta — saving *or* surcharge — is distributed in proportion to each record's own gross.

**Why this shape and not a rulebook:**
- **It is the ERP answer.** This is exactly how an ERP allocates a trade discount or volume rebate across
  mixed line items, which is the mental model to reach for when explaining it to Finance.
- **It needs no knowledge of the vehicle.** Tiers, ceiling, floor, delivery, rounding, gates and allowances all
  collapse into one ratio — and so does any rule added to the engine later. Nothing to maintain per-vehicle.
- **It is order-independent**, which is the property that killed the previous default (see 5.10.3).
- **It is explainable to a requestor**: "your $60 record was billed $50 because the request total was capped."

**Guard two edge cases — both reachable, neither hypothetical:**
1. **`grossSubtotal = 0`** — de-minimis waived the request, or every rate is `'actual'`. Division by zero.
   Branch explicitly: everything is free, every `componentCharged` is 0.
2. **`rate: 'actual'` line items contribute 0 to `componentGross`.** Such a component allocates to 0 and reads
   as *free* while potentially being the most expensive record in the request. **`mail` delivery is `'actual'`
   in the live TX profile**, so this is live. Either resolve actuals before allocating, or exclude
   `needsActual` components from the ratio and charge them separately.

### 5.10.3 What this replaces, and why `[the running-cap rule is RETIRED]`

The previous default said *"the ceiling is a running cap on cumulative billing"* — charge each child its actual
cost in sequence and stop billing at the cap. **Kevin's scenario broke it (2026-07-19).**

Ledger: 10 records × $6 + 1 × $60 = `grossSubtotal` $120; `maxFee` $100.

- The expensive record shipped **first**: cumulative $60, cap not reached → charged **$60**.
- The same record shipped **last**: cumulative $120 → capped $100, already billed $60 → charged **$40**.

**Same record, same request, $60 or $40 depending on processing order** — an operational accident, not anyone's
decision. Whoever ships last absorbs the entire benefit; no record has a quotable price; and the release gate's
answer changes based on which staff member finished first. It did not dissolve the allocation problem, it
**relocated it into release order**, where it is invisible.

Under 5.10.2 that record is charged $50 (`$60 × 100/120`) whenever it ships.

**What SURVIVES from the earlier default, unchanged:**
- **One-time request-level charges are consumed by the FIRST installment** — WA RCW 42.56.120(2)(b) is the only
  authority in this whole area and it points exactly here. *(Note this is now the one deliberate exception to
  generalized prorata: the WA flat fee is charged once by statute, not shared.)*
- **The de-minimis floor is evaluated against the REQUEST TOTAL, never per installment.** ⚠️ The splitting
  arbitrage remains an **unaddressed gap in the law** — the only doctrinal hook (WA WAC 44-14-04004(3)) is aimed
  at agencies gaming *delay*, not requestors gaming *fees*.
- **A deposit already collected is credited FIFO against the earliest installments**, so records go out sooner.
- **TX has no per-batch charging authority anywhere in ch. 552** (see §5.9).

### 5.10.4 `componentCharged` is the missing field three features are blocked on `[NOT BUILT]`

It does not exist under **any** accounting method today — the engine emits `componentGross` (pre-everything) and
`total` (post-everything), with nothing in between. Adding it closes three separate open problems at once:

1. **The release gate.** `feeRelease.releaseGate()` is a **whole-request** test today
   (`balance = effectiveTotal − deposit_paid − final_paid`), which is exactly what §5.9 forbids. The
   per-child coverage test needs a per-child price and there isn't one.
2. **`fee_revenue by department`** — recorded as **UNDEFINED** (HANDOFF 2026-07-14 (tm)): revenue is one number
   on the parent, a parent with children in two departments has one figure and two departments, and attributing
   it "needs the same allocation the law is silent on." **5.10.2 defines it.**
3. **ERP line items** — see 5.10.5.

### 5.10.5 ERP: compute here, send detail `[DECIDED 2026-07-19 by Kevin]`

**Could Finance's ERP allocate this instead?** In principle yes — prorata allocation of a discount across mixed
line items is standard AR. **It is still the wrong home, for four reasons:**

1. **It is not a discount, it is a statutory ceiling.** A volume discount is a commercial term a seller elects;
   a maximum fee limits what a government may charge and here it decides **whether a record may lawfully be
   withheld**. That is a compliance determination, not revenue recognition.
2. **The release gate is synchronous and per-record.** "Can this ship now?" is answered on a screen, in the
   moment. Routing it through an ERP round-trip puts a statutory access right behind a govtech ERP's posting
   cycle — frequently nightly batch.
3. **The ceiling binds before the ERP hears anything.** It applies at *estimate* time, before acceptance and
   before any charge is emitted. There may be no ERP document in existence yet.
4. **Portability.** Two cities under the same statute would release records differently depending on which ERP
   they run — behavior varying by a vendor we do not control, invisible to both us and the records officer.

**And empirically it cannot today:** `erpSettlement.emitCharge()` sends a single scalar `amount` plus a
reference and `chargeCodeHint` — the ERP is never told there are eleven records. To allocate, it would need line
items; to send line items we must first compute `componentCharged`. **"Offload it" collapses into "build it,
then also send it."**

**The distinction that resolves it: the release-gate allocation and the GL allocation are different questions
and need not agree.** Optimum Q must have a per-record answer because it gates a legal act. Finance may allocate
however their policy dictates for revenue recognition. So: **compute the gate rule here, and extend the ERP
payload from a scalar to line items carrying `componentCharged`.** Finance gets the detail without inheriting a
compliance rule; we never inherit their accounting policy.

**Config knob** (the law is silent, so this is a city setting, not an encoded rule): allocation method
`prorata` *(default)* · `none — report actual costs only`, for a city whose Finance department already has a
policy. The `none` mode still satisfies their GL; it does **not** change the release gate, which always uses
prorata because §5.9 requires a per-child coverage test.

---

## 6. Roll-up rules

### 6.1 `parent_state` `[SIMPLIFIED 2026-07-16 by Kevin — two values]`
**Derived, never stored, never hand-set.** A parent has no `stage`; `stage` is a CHILD concept and an MRR's
children sit at different stages at the same time (Kevin, 2026-07-16) — a single parent-level stage would have to
lie about all but one of them.

- **`In Process`** — any child is not yet terminal.
- **`Complete`** — every child has reached a terminal disposition (§5.8), *whatever* those dispositions were.

`Complete` means "no further processing", **not** "delivered" and **not** "granted": a request whose only child
was denied is `Complete`. What actually happened is the child's disposition, and there is no parent-level
summary of it today — see §4.4.

> *Parked with the field-design pass (§4.4):* the earlier five-value ladder `Intake · In Process · Processed ·
> Delivered · Closed`. `Intake` collapses into `In Process` (nothing acts on the distinction); `Delivered` is a
> child fact, not a parent one; `Processed` vs `Closed` was never given a behavioural difference. Retained here
> only so the later pass does not have to rediscover why they went.

### 6.2 Parent `disposition` `[DEFERRED 2026-07-16 by Kevin — NOT BUILT, NOT THE CURRENT DESIGN. See §4.4.]`

> **Do not build from this section.** The parent has **no disposition and no outcome** (Kevin, 2026-07-16) — only
> `In Process` / `Complete` (§6.1). Everything below is **parked for the later field-design pass**, kept because
> its reasoning is expensive to rediscover — in particular **(a), which is still live and still built.**
>
> **(a) Parent-level terminal events CASCADE DOWN — this mechanism SURVIVES the deferral and is already
> implemented.** An unanswered clarification, an unpaid deposit or a withdrawal ends the whole request, and each
> open child takes the matching disposition from §5.8 (`Closed – No response`, `Closed – Non-payment`,
> `Closed – Withdrawn by requestor`). The parent then simply rolls up to `Complete`. `clarificationTimeout`
> already closes `COALESCE(master_request_id, id)` — the event is logged on the child, the closure lands on the
> parent (Tex. Gov't Code § 552.222(d) withdraws "the underlying request", not one record of it).
> **Nothing about deferring the parent's disposition FIELD changes this.**
>
> **(b) The derived roll-up table below (`Fulfilled` / `Partial fulfillment` / …) is NOT the current design.**
> It is one of the two conflicting vocabularies §4.4 documents; neither is built.

*(Parked below — the original 2026-07-14 design, retained for the field-design pass.)*

### 6.2-parked Parent `disposition` `[ANSWERED 2026-07-14 by Kevin — SUPERSEDED 2026-07-16]`
**There are TWO mechanisms, and conflating them is the mistake to avoid.** Kevin's framing was "if a multi-child request is closed for non-payment, that is the parent's disposition" — correct, but the causality runs **downward**, not upward.

**(a) Parent-level terminal events — these CASCADE DOWN, they do not roll up.** Money and the citizen relationship live on the parent (§2), so these end the whole request and every open child inherits the disposition:

| Event | Parent + all open children |
|---|---|
| Deposit/fee unpaid past the window | `Closed – Non-payment` |
| Clarification unanswered past the grace window | `Closed – No response` |
| Requestor withdraws | `Closed – Withdrawn by requestor` |

**(b) Otherwise the parent is DERIVED from its children**, in this precedence:

| Children | Parent disposition |
|---|---|
| all `Closed – Delivered` | **`Fulfilled`** |
| **some** delivered, some not | **`Partial fulfillment`** |
| none delivered, **any** `Denied` | **`Denied`** |
| none delivered, all `No records located` | **`No records located`** |

The mixed case Kevin did not name — *nothing delivered, some children denied and others no-records* — resolves to **`Denied`**, because a denial is an affirmative legal act the citizen can **appeal**, and it must not be masked behind "no records."

**The single-child case needs no special rule** — it falls straight out of the table (all = the one). That is exactly what always-wrap buys.

**Denial is a decision, not a state** (Kevin). It is an *action* that produces a `Closed – Denied` disposition on a child; the disposition is what rolls up.

This retires `requests.closure_reason`, which is currently overloaded four ways and cannot express fulfilled / partial / denied / no-records.

### 6.3 `budget_variance`
The parent's "Budget Date +/-" = the variance of the **critical-path child** (the one with the latest projected completion), i.e. the *worst* days-ahead figure across children. A parent is not "ahead" because four of five children are ahead.

### 6.4 Estimate
Per §12 Layer 3, unchanged and correct: children contribute **quantities** (pages, labor, media). The parent applies the **fee waiver, special fees, minimums, de-minimis, floor/ceiling, deposit and certification — once**. A child is a unit of *work*, never a unit of *billing*. Totals live at the parent for both single- and multi-child requests, exactly as Kevin proposed ("for coding simplicity … having a total at the parent level regardless").

---

## 7. Presentation — queue, dashboard, reports

**QUEUE: `[BUILT 2026-07-16 — verify_queue_parent_child 21/21, suite 744/744]`. Dashboard + reports: NOT YET — they consume the same `GET /requests` and inherit the fix, but neither groups by parent.**

**Queue and dashboard:** every request renders as a **parent line** with its children indented beneath it. When `child_count = 1`, the pair collapses to a single line and the `-1` suffix is hidden — the operator sees exactly what they see today.

> **What the build added to `GET /requests` (2026-07-16).** The queue was already LEAF-scoped and therefore listing the right ROWS — but it read four PARENT facts straight off them, which the tautological scope predicates had hidden until children actually existed. `request_number` resolves through the parent (`numberJoin`/`numberExpr`), with the child's own suffixed number preserved as **`component_number`**; `is_mrr` resolves through the parent (**requestCreate forces `is_mrr = 0` on every child, so the MRR badge could never have rendered**); and **`parent_id`** + **`child_count`** are added as the grouping key and the collapse test. Ordering keys on the PARENT's recency, then `child_no` ascending — the children of one request are inserted in a single loop milliseconds apart, so ordering by the child's own `created_at` put an MRR's records on screen backwards (`-3, -2, -1`).
>
> **The Open control moved to the LEFT of the line** `[Kevin, 2026-07-16 — "for the moment"]`. On a collapsed `n = 1` line it targets the child, exactly as before the wrap. **On an MRR parent line there is nothing to open yet**: the hub (§14.3) is design-gated and unbuilt, and the v1 workspace expects a WORK row — pointing it at the parent renders a screen with no stage, no description and no team. It is a disabled `Hub —` placeholder until §14.3 is designed. **This is the queue half of the "hub and queue must be designed together" requirement in §14.3.**

**Filters, reports, and worklists operate on CHILD rows.** This is the requirement that decided the whole model: "a report of all requests in redaction should include single-request child records as well as MRR child records." Every child row displays the parent `request_number` alongside its own `child_no`, so an overdue-work report is unambiguous about which request a line belongs to.

**My Tasks** is unchanged in shape — tasks already hang off the work unit, which is now the child.

---

## 8. Migration — additive, no data loss `[BUILT 2026-07-16 — `1739215` + `40ae5a7`, verify_wrap_parent 39/39, suite 686/686]`

> **BUILT.** `requestCreate` now creates the PARENT + CHILD pair; the child keeps the id everything hangs off and
> is what the helper RETURNS. **The backfill described below never had to run:** the 2026-07-16 purge left 0
> citizen requests, so there was nothing to convert — the wrap simply applies to every request created from now
> on. The three infrastructure containers (LIBRARY / SYS-*) are created `wrap:false` and stay bare, which is what
> they always were.
>
> **Two things this section did not account for, both found by the suite or by live:**
> 1. **`description` is NOT NULL.** Copying it to the parent (the "copy up" below, taken literally) makes every
>    description lookup match TWO rows — the double-count §11 exists to prevent. §5.1 was right that the parent
>    has no description; the constraint was protecting the right thing on the wrong row. Replaced by
>    `CHECK (child_no IS NULL OR description IS NOT NULL)`. Routing columns follow the same rule.
>    **`classification` IS copied up** — it drives the statutory clock's duration, and that clock is the parent's.
>    (§5.1 calls classification child-only because it is talking about *routing*. For one child they are
>    identical; MRR needs a worst-case roll-up — **still unspecified, see §6.**)
> 2. **The CHILD was getting its own statutory clock** — `workflowEngine.onIntake` runs on the child and started
>    one there. **The suite was green and LIVE was wrong**; only the live smoke caught it. Fixed in the engine
>    (`tolling.parentOf`), not at the five call sites. `deadline_date` now cascades to children as a derived
>    copy so LEAF-scoped work lists still show it; `request_clocks` stays parent-only.


**Pre-migration state, kept for the record (no longer true):** the columns `master_request_id`,
`component_label` and `is_mrr` existed and were written by zero lines of code; there were 125 requests and
0 children. That is what made the migration a clean one-time backfill with no legacy children to reconcile.
**It has since run** — children exist, and this paragraph describes the "before", not the present.

**The existing `requests` row becomes the CHILD and keeps its `id`.** A new parent row is created above it.

Why this direction: of the 16 tables carrying `request_id`, **8 are work-level and stay pointed at the existing id, untouched** — `tasks`, `request_files`, `redaction_jobs`, `av_redaction_tasks`, `document_pages`, `fulfilled_records`, `request_selected_records`, `workflow_decisions`. Those are the high-row-count tables and, more importantly, the ones every task screen and deep link resolves through. Every existing `/redaction/:taskId`, every file, every page image keeps working with no rewrite.

**7 money/clock tables repoint to the new parent id** — `request_clocks`, `request_fee_estimates`, `fee_payments`, `fee_adjustments`, `erp_charges`, `request_payment_events`, `objections`. Low row counts, few code paths.

`request_history` rows stay where they were written; new rows are written at the level of the action (a stage advance → child; a payment → parent).

Backfill per existing request: create parent, copy the citizen/money/clock columns up, set `child.master_request_id`, `child.child_no = 1`, `child.request_number = parent.request_number || '-1'`, repoint the 7 tables.

~~**Two live bugs this migration forces us to fix first**~~ **BOTH FIXED 2026-07-13 — this blocker is CLEARED** *(verified 2026-07-16; the text below is retained for the record)*:
1. ~~The frontend drives stage advances through a **legacy stage order containing a ghost stage `custodian_retrieval`**~~ → **FIXED `a9f8d29`** ("one canonical stage vocabulary — kill the ghost and the pipeline it hid", 23/23). Only historical comments now mention the name.
2. ~~`feeNonpayment.js:39` and `tickler.js:88` bypass `applyStageTransition` with a raw `UPDATE requests SET stage='closed'`~~ → **FIXED `9ba8f32`** ("route every close through applyStageTransition — no raw stage writes", 24/24). ARCHITECTURE item 6 holds.

**Remaining migration blockers as of 2026-07-16.** §9 is answered, item 1 is ratified (`ARCHITECTURE.md`), §14.2 closes routing, and §11.1 (a)+(b) are decided below. What is left is *work*, not decisions: the backfill (**0 rows to convert** after the 2026-07-16 purge), the portal emitting children, §4.2.1 `source_request_id` attribution, and the hub's **design direction** (§14.3 — UI rule: agree the design before building). The §4.2.1 toll engine shipped `01c3b36`; the §11.1 sweep + revenue items shipped `a68df67` on 2026-07-14 — **both were already done and this spec said otherwise.**

---

## 9. Open questions for Kevin — **ANSWERED 2026-07-14**

> **1. Dispositions — ANSWERED.** `Processed` does **not** mean delivered. Full terminal-disposition model for child and parent is now **§5.8** (child) and **§6.2** (parent roll-up, incl. the correction that parent-level terminal events *cascade down* rather than roll up).
>
> **2 & 3. Restart vs pause — ANSWERED: "where a state requires restart, restart."** Already built and per-jurisdiction (the 6-value enum + the `restart()` primitive + the AI extractor that targets it). TX is seeded `toll_and_restart` for **both** clarification (§ 552.222 / *City of Dallas v. Abbott*) and deposit (§ 552.263(e)). **→ ACTION: enable them for TX.** ⚠️ This changes reported lateness on live requests — requests now shown as overdue will stop being overdue. Deliberate, not a side effect.
>
> **NEW REQUIREMENT from Kevin (2026-07-14) — the "send again" rule.** Nothing in the system knows whether a restart obliges the agency to **re-issue**: a second invoice, or a second clarification request. New config slots (expressiveness first, safe default off — AUTO_CONFIG §1): a **re-issue rule** on the payment policy and a **second-notice rule** on the clarification policy. **Values must NOT be populated per state until researched** — guessing a notice obligation is the same class of legal exposure as guessing a clock rule.
>
> **THE TWO CLOCKS DO NOT MOVE TOGETHER.** Kevin: "reinvoicing and resetting the clock would likely change a request from late against budget to not late." Half right, and the distinction matters:
> - The **statutory clock (parent) RESETS** — the law says so.
> - The **budget clock (child) PAUSES, it does not reset.** The team genuinely cannot work while waiting on the requestor, so pausing is fair. But if a reset also wiped budget lateness, **a chronically slow office could hide it by re-invoicing.** Budget variance is the management signal; it must not be erasable by a billing action.
>
> **4. Delivery vs the payment gate — ANSWERED by research.** See **§5.9** (the gate is a *coverage* test — a child may never be withheld because a sibling is unpaid) and **§5.10** (fee allocation across installments: **the law is silent**; our default is a labelled design decision, not a discovered rule).
>
> **5. MRR routing stays manual** — confirmed 2026-07-13. No action.

*(Original text retained below for the record.)*

1. **Parent `Processed` vs `Delivered`.** Your sheet's parent Stage ends at `Processed`. I've added `Delivered` and `Closed` because nothing otherwise records that records went out. Confirm, or tell me `Processed` already meant "delivered."
2. **Should nonpayment stop the statutory clock?** Today it does not — `payment_pending` is declared in `tolling.js` and has **zero callers**, so a request sitting on an unpaid deposit runs late on paper. Texas is stronger than a toll: an unpaid deposit **re-receipts** the request (§552.263(e)) and can withdraw it (§552.263(f); §552.221(e) 60-day). Recommend: add `deposit_nonpayment_effect: pause | reset | withdraw | flag_only` and set TX = `reset` (§10.4 step 3). The `restart()` primitive it needs is already built.
3. **Clarification: reset, not pause.** Confirm we implement §552.222 / *City of Dallas v. Abbott* as a reset rather than a toll. **This is already expressible** — set `clarification_clock_effect = toll_and_restart` for TX (`clarificationAction.js:32-42`). It is not set today: the policy is at all-defaults (`no_fixed_clock`, `enabled: false`) and nothing is attested, so the automation has never fired. Turning it on **changes reported lateness on live requests**.
4. **`delivery_mode` = `Hold-All` (default) | `As-Ready`.** Confirm you want As-Ready as a real mode rather than an MRR-only override (§5.8).
5. ~~**Routing for MRR stays purely manual**~~ **RELAXED 2026-07-16 → see §14.2.** The 07-13 call (parent assigned to an MRR manager who assigns children by hand) is superseded by **suggest-and-confirm**: the classifier runs on every child; the result is *committed* on a single-child request and *suggested* on an MRR, for the RM to accept, override, or bypass. Pure manual is incompatible with always-wrap — a single-record request IS a parent with one child, so children must auto-route or every ordinary request would need a human to route it. **Still true and unchanged:** the parent is system-routed to an ORO Associate via `mrr_processing`, that person owns the whole tree at the parent (§14.1), and **intake review is bypassed for MRR** because the parent is already with an Open Records team member.

---

## 10. Jurisdiction rule configuration — what exists, what is missing
*Audited 2026-07-13 against the running code and the live DB. Kevin's question: "do we have code that automatically configures where state laws require re-receipt for unpaid deposit, resetting the clock vs pause?" Answer: **the engine exists, the per-state rule slot does not.***

### 10.1 BUILT — and better than the docs claim
| Capability | Where |
|---|---|
| Multi-clock engine, business/calendar basis, holiday set, derived due date, toll ledger | `tolling.js`, `deadlineCalc.js`; tables `request_clocks`, `clock_tolls` |
| Clock **pause / resume** | `tolling.js:108` `toll()`, `:119` `resume()` |
| Clock **reset / re-receipt** | `tolling.js:132` `restart()` — **BUILT** (1 caller, no route, no UI) |
| Per-classification durations (simple/standard/complex/redaction_required) | `system_config['deadline_rules']`, populated |
| **Clarification → clock effect: the working template for all of this** | `clarificationPolicy.js:29` validated 6-value enum + `clarificationAction.js:32-42` effect→action mapper: `toll_pause_resume` · `toll_and_restart` · `start_gate` · `runs_no_stop` · `operational_hold` · `no_fixed_clock` |
| Clarification grace → auto-close | `clarificationTimeout.js` |
| AI extraction of deadline/clarification rules from statute text, staged as reviewable proposals | `configExtractors.js:130-141`, `clarificationPolicyExtract.js` |
| Attestation gate + drift re-arm | `jurisdictionProfile.js:112-128`, `enforcement.js` |

**`clarificationAction.js` is the pattern to copy for every other clock rule.** Config enum → effect plan → engine primitive → history → attestation gate. It is already end-to-end.

### 10.2 The gaps
1. ~~**No per-jurisdiction rules row.**~~ **BUILT 2026-07-13 — `jurisdiction_rules(jurisdiction_id, domain, config_json)`**, verified 24/24. `deadline_rules` and `clarification_policy` are off `system_config` and scoped to a jurisdiction; `services/jurisdictionRules.js` owns read/write with a fallback to the legacy global key so an un-backfilled install cannot silently lose its clock. **The `jid` is finally load-bearing** — two jurisdictions now hold different clarification rules simultaneously (the harness proves it), where `clarificationPolicy.read(jid)` previously discarded the argument. The `configExtractors` adapters are jurisdiction-scoped, which makes the AI statute-extraction pipeline, config history, and profile-section hashing per-jurisdiction for free. *Still absent: the state → city precedence stack (one active jurisdiction today).*
2. ~~**No deposit → clock rule.**~~ **BUILT 2026-07-13 — verified 31/31.** `services/paymentClockPolicy.js` (the per-jurisdiction substrate: `deposit_clock_effect` · `deposit_grace_days` · `deposit_lapse_action`) + `services/depositAction.js` (the effect mapper), wired into all four real moments: deposit owed (`feeEstimates` accept), deposit paid (manual log · counter payment · ERP settlement), and lapse (`tickler`). **`payment_pending` finally has a caller.** TX is seeded `toll_and_restart` / grace 10 / `withdraw` from § 552.263(e)–(f) — a deposit **re-receipts** the request, so the clock restarts from the payment date rather than merely resuming. Shipped **`enabled: false`**, double-gated on enabled + attested, so it is a **no-op until a city opts in**: the harness proves the policy-off path is byte-for-byte today's behaviour.
3. ~~**No volume extension.**~~ **BUILT 2026-07-13 — verified 30/30.** `tolling.extend(clockId, days, reason, opts)` + a `clock_extensions` ledger + `POST /api/clocks/:id/extend`. An extension **lengthens the clock's duration** by a fixed number of days — the shape a statute actually has — where a toll only moves the due date by *elapsed wall time*. Caps come from the jurisdiction's own rules (`clocks.<type>.extension = { maxDays, maxCount, grounds }`) and are enforced by the ledger; **`maxDays` caps the TOTAL across the clock's life, not each grant**, so "one extension of not more than 14 days" cannot be evaded by granting 14 twice. A reason is mandatory — it is the statutory ground. Extensions and tolls compose (a clock can be extended *and* tolled). **No cap is seeded for TX**, deliberately: the TPIA has no unusual-circumstances extension, so an extension there is uncapped-but-recorded rather than silently blocked or silently allowed.
4. ~~**`tollReasons` is inert.**~~ **BUILT 2026-07-13.** `toll()` now rejects a reason the jurisdiction has not declared, naming the allowed set. **This nearly broke the AG hold:** `routes/requests.js` has always tolled the *respond* clock with `ag_ruling_pending`, which was **not** in the seeded `tollReasons` — switching validation on without backfilling it would have silently killed the AG flow. Backfilled by `seed_deadline_toll_reasons.js`; the regression is asserted in the harness.

### 10.3 The data that exists — and where it isn't
- **`CLARIFICATION_POLICY_SURVEY.md` holds 17 jurisdictions** (AL, AR, OK, NC, GA, PA, MI, ID, FL, AZ, CA, WA, NJ, RI, IL, KS, MS) with `clock_effect`, `grace_days`, `abandonment_closure`, `notice_required` and citations — **already in the exact shape `clarificationPolicy.js` validates**. It is **markdown, not data**: 0 rows in the DB.
- **`jurisdiction_profiles` has ONE row — Texas.** `clock_tolls` has **0 rows**: no clock has ever been tolled in production. All 7 profile sections have `attested_by = NULL`, so every automation gate is closed and the clarification automation has never fired.
- **Two docs are false and are corrected in this commit:** `SPEC_jurisdiction_configuration.md` claimed "three state profiles loaded" (there is one); `CONFIG_FRESHNESS_DESIGN.md` claimed four TX config sources are seeded (`config_sources` has zero rows).

### 10.4 Build order (do this before, or alongside, the parent/child migration)
1. ~~**`jurisdiction_rules(jurisdiction_id, domain, config_json)`**~~ — **BUILT + verified 2026-07-13 (24/24).**
2. ~~**Load the 17 surveyed states** as data.~~ **BUILT + verified 2026-07-13 (35/35).** `backend/src/db/seed_clarification_policies.js` — 17 surveyed jurisdictions + TX, written through the real config path (`effectiveConfig.applyConfig` → config history + profile section). All six clock effects are now represented in real data (`runs_no_stop` 7 · `no_fixed_clock` 4 · `toll_pause_resume` 3 · `toll_and_restart` 2 · `start_gate` 1 · `operational_hold` 1 — no single effect covers a majority, which is the quantitative case for the field existing at all). **All seeded `enabled: false`** — drafts pending city review + attestation; live behaviour unchanged.
3. ~~**Deposit rule slot.**~~ **BUILT + verified 2026-07-13 (31/31).** Landed as two fields rather than one — the clock effect (`runs_no_stop | toll_pause_resume | toll_and_restart | operational_hold`, sharing the clarification vocabulary because "waiting on the requestor" is one concept) and the lapse action (`flag_only | withdraw`), which are genuinely independent axes.
4. ~~**`extend(clockId, days, reason)`**~~ **BUILT + verified 2026-07-13 (30/30).**
5. ~~**Make `tollReasons` load-bearing.**~~ **BUILT + verified 2026-07-13.**

**§10 is complete.** The clock subsystem now has all three primitives (toll · restart · extend), a per-jurisdiction rule store, a validated toll vocabulary, and 18 jurisdictions of real rule data. **Deadline rules are seeded for TX, IL and CA** — verified 25/25 that the *same action produces different law*: IL caps an extension at one grant of 5 business days (5 ILCS 140/3(e)), CA at one of 14 calendar days (§ 7922.535(b)), TX has no cap because the TPIA grants no unusual-circumstances extension.

### 10.5 OPEN — the acknowledge-vs-produce clock (do NOT guess this)
**FL, WA, NY and CT are deliberately NOT seeded with deadline rules.** Their short statutory clock is **not a production deadline**:
- **FL** — *no statutory clock at all*; only "reasonable custodial delay" per record (*Tribune Co. v. Cannella*, 458 So. 2d 1075 (Fla. 1984)).
- **WA** — RCW 42.56.520: 5 business days to **respond** (produce · link · acknowledge with a reasonable estimate · seek clarification · deny). No final production deadline; the estimate is revised per installment.
- **NY** — Pub. Off. Law § 89(3)(a): 5 business days to **acknowledge**, then a "date certain within a reasonable period."
- **CT** — Conn. Gen. Stat. § 1-206(a): the 4 business days is the deadline for a **denial**, not for production.

Modelling any of these as a `respond`/produce clock would report **false lateness** — the same bug class as an unpaid deposit burning the statutory clock (§10.2 gap 2). The engine already supports a second, non-primary **`acknowledge`** clock as pure config (clock types are arbitrary keys), so no code is needed. **The product decision is:** when a jurisdiction has *no* production deadline, should the request show a **blank `deadline_date`** (legally honest) or an **internal service target** (operationally useful, but not law)? That fork is Kevin's, and it is why these four states are unseeded rather than guessed.

**Also remaining, none blocking:** the **state → city precedence stack** (Tulsa's EO and SF's Sunshine Ordinance are city overlays on looser state law — recorded as notes, not data), and a **UI editor** for the policy areas (API-only today; blocked on the UI rule — design direction must be agreed first).

**Relationship to the parent/child model:** all of this lives on the **parent** (the clock is parent-level, §2). None of it touches the child. The two workstreams are therefore independent and can be built in either order — but the roll-up rules in §6 assume the parent clock is trustworthy, so a request whose clock runs while a deposit is unpaid will report false lateness on every child beneath it.

---

## Appendix A — Legal basis (research, 2026-07-13)

### A.1 Texas PIA (Gov't Code ch. 552) — the anchor jurisdiction
| Mechanism | Cite | Level |
|---|---|---|
| AG decision request — only as to info the body "wishes to withhold" | §552.301(a) | **RECORD** |
| Submission labeled "which exceptions apply to which parts" | §552.301(e)(2) | **RECORD / part** |
| 10-business-day deadline to seek a ruling, measured from receipt of the *request* | §552.301(b) | **REQUEST** (clock) |
| Non-disputed records must still be produced promptly; 10 days "is not a grace period" | ORD-664 (2000) | **RECORD** |
| Missed AG deadline → info "presumed … public and must be released" | §552.302 | RECORD |
| Clarification **resets** the clock | §552.222; *City of Dallas v. Abbott*, 304 S.W.3d 380 (Tex. 2010) | **REQUEST** |
| No clarification response in 61 days → request withdrawn | §552.222(d) | **REQUEST** |
| Deposit → request "considered … received" on the date the deposit arrives | §552.263(e) | **REQUEST** (re-receipt) |
| Itemized statement > $40; no response in 10 BD → withdrawn | §552.2615 | REQUEST |
| Hour-limit allotment exhausted → not required to produce until paid | §552.275 | REQUEST (requestor-scoped) |
| Catastrophe suspension — **the only true toll**, max 14 days | §552.2325 | REQUEST |
| Cannot produce in 10 BD → certify in writing, set a date and hour | §552.221(c)–(d) | RECORD (not a pause) |
| No responsive records → written notice by the 10th BD | §552.221(f) *(HB 4219, eff. 9/1/2025)* | RECORD |
| Voluminous → batched delivery, dated certified notice per batch | §552.306(c)(2)(B) | **RECORD / installment** |
| Litigation exception | §552.103 | **RECORD** |
| Law-enforcement exception; basic arrest info released regardless | §552.108, §552.108(c) | **RECORD / sub-record** |
| Mandamus to compel production of identified information | §552.321 | RECORD |
| Complaint to DA/CA | §552.3215 | REQUEST |

### A.2 Comparative — FL · CA · IL · WA · NY · CT
**Finding: denials, exemptions, holds and appeals are RECORD-level in all six, without exception. Clocks and the things that pause them are REQUEST-level.**

- **WA** — the strongest installment regime in the country and record-level all the way down: RCW 42.56.080(2) (production "on a partial or installment basis"); 42.56.120 (charge per installment; an **unclaimed installment relieves the agency of the balance of the request** — the one place a record-level event has a request-level consequence); 42.56.210(3) (per-record exemption + explanation); 42.56.550(1) (show cause as to "a **specific public record** or class of records"); 42.56.540 (injunction reaches "any specific public record"). *If the model is built to WA's shape, every other state fits inside it.*
- **IL** — the outlier against us: one 5-business-day answer to the request, one 5-day extension (§3(d)–(f)); **no installment safe harbor**; voluminous (§3.6) and commercial prepayment (§3.1) freeze the **whole request**; a blown deadline is a constructive denial of the request (§9(c)). **Consequence: in IL a child that slips past the parent deadline must be affirmatively denied or extended, not left "in process."**
- **CA** — determination is request-level (10 days, §7922.535(a)) but production is per-record and "prompt" (§7922.530(a)); one 14-day extension (§7922.535(b)); segregability per record (§7922.525).
- **NY** — "granted **in whole or in part**" by a "date certain" (§89(3)(a)) sanctions staged production; appeal is against "denial of access to **a record**" (§89(4)(a)); a missed date certain is a constructive denial of the request.
- **FL** — no statutory clock at all; per-record "reasonable custodial delay" (*Tribune Co. v. Cannella*, 458 So. 2d 1075 (Fla. 1984)); redact the part and "produce the remainder" with a statutory citation (§119.07(1)(d)–(f)).
- **CT** — 4 business days is the **denial** clock, not the production clock (§1-206(a)); appeal to the FOI Commission within 30 days of the denial of records (§1-206(b)(1)); litigation-strategy hold is record-scoped and time-bounded, "until such litigation or claim has been finally adjudicated" (§1-210(b)(4)).

### A.3 The one rule that satisfies all seven at once
> Give the child a **budget** due date that may fall before or after the parent's statutory deadline. Then enforce: **any child not released by the parent's statutory deadline must carry an explicit disposition — an extension, a denial with citation, or a stated date certain.**

That single rule satisfies TX §552.221, IL §3, NY §89(3)(a), CT §1-206(a), CA §7922.535 and WA §42.56.520 simultaneously.

---

## 11. Migration readiness — the query layer is already parent/child-aware `[BUILT 2026-07-13, 13/13]`

The migration's danger was never the schema — it was the **27 LIST/COUNT queries** that would double-count the moment parent rows exist, three of them **destructively** (duplicate dunning emails to citizens; `clarificationTimeout` auto-closing a parent; the stall sweep flagging every parent forever).

**Solved by choosing predicates that are true BOTH before and after the migration** (`services/requestScope.js`):

| Predicate | SQL | Today | After migration |
|---|---|---|---|
| **PARENT** — the citizen's request (number, requestor, money, clock, deadline) | `r.master_request_id IS NULL` (a **root**) | every row | only parents |
| **LEAF / CHILD** — the unit of work (description, stage, routing, tasks, files, redaction) | `NOT EXISTS (SELECT 1 FROM requests c WHERE c.master_request_id = r.id)` | every row | only children |

Today a request **is its own parent and its own child**, so both are tautologies — **125 roots, 125 leaves, 125 rows** — and adopting them is a **provable no-op**: dashboard counters, the queue's 39 rows, all 7 reports, and every sweep-candidate set are byte-identical before and after. The migration then flips them automatically, with **no query to rewrite under pressure.**

**Scoped:** dashboard counters (PARENT) + by-stage (LEAF) · the request queue (LEAF) · all 4 `reportEngine` queries · the tickler stall sweep (LEAF) and scanned count (PARENT) · the nonpayment dunning sweep (**PARENT** — the duplicate-email bug) · the task reconciler (LEAF) · the flagged worklist (LEAF). Index added on `master_request_id`.

### 11.1 STILL OPEN — deliberately not guessed
- ~~**`clarificationTimeout`**~~ **DONE 2026-07-14**, once §6.2 settled that parent-level terminal events cascade down. The clarification EVENT is logged on the **child** (that record's description was vague) but the CLOSURE lands on the **parent** — Tex. Gov't Code § 552.222(d) withdraws "the underlying request," not one record of it. The sweep now searches LEAF rows and closes `COALESCE(master_request_id, id)`. Today that resolves to the row itself (a verified no-op: `close_target === id` on all 125 rows); after the migration it closes the parent and cascades. **This sweep AUTO-CLOSES — unscoped, it was the single most destructive query in the migration.**

**TWO ITEMS WERE BLOCKED ON A DECISION, NOT ON WORK — BOTH DECIDED 2026-07-16.** Neither is a join problem; both were design gaps in this spec. **Both decisions below are Claude's technical call, adopting this section's own recommendations — NOT Kevin's. Reverse either freely; nothing is built on them yet.**

> **(a) ~~DECIDED 2026-07-16~~ — ALREADY BUILT 2026-07-14 (`a68df67`). This section was STALE.**
> Kevin decided this on 07-14 and it **shipped the same day**: the deposit sweep now keys off the **money axis**
> (accepted estimate + `deposit_due > 0` + no payment) with **no stage predicate at all** — better than the
> `payment_status` option this section recommended, because it is what actually *defines* the condition.
> `deposit_due > 0` is load-bearing (without it a request that accepted a no-deposit estimate has
> `deposit_paid_at` NULL forever and is flagged overdue for a deposit it never owed — constructed and asserted
> in the harness). The prior agent proved old and new predicates select an identical row set today.
> **On 2026-07-16 I re-presented this as an open decision and "decided" it. It was not open.** Corrected here.
>
> **(b) ~~DECIDED 2026-07-16~~ — ALREADY BUILT 2026-07-14 (`a68df67`). This section was STALE.**
> `reportEngine` already **refuses** the child-grouped revenue cut and explains why; counts by department remain
> exact and are still offered; the AI report agent was taught the constraint so it cannot generate the impossible
> spec from natural language. Same correction as (a): I re-presented a shipped decision as an open one.
>
**(a) Where does the PAYMENT GATE live after the migration?** §5.2 says `fee_review` and `awaiting_payment` "move off the child — they are parent gates." But **the parent has no `stage`** — it has `parent_state` (`Intake · In Process · Processed · Delivered · Closed`, §6.1), and **none of those is a payment gate.** So "awaiting payment" currently has nowhere to live on the parent.

This blocks `tickler.js`'s deposit sweep concretely: it joins `requests.stage = 'awaiting_payment'` to `request_fee_estimates`. After the migration the **estimate hangs off the parent** and the **stage off the child**, so the join matches nothing and **the deposit sweep silently stops running** — no dunning, no lapse, no withdrawal. Options: (i) give the parent a `payment_state` axis; (ii) keep `awaiting_payment` as a real parent stage; (iii) drive the sweep off `payment_status` (§4.3) and drop the stage predicate entirely. **Recommend (iii)** — the money axis already exists on the parent and the stage predicate is redundant with it.

**(b) A parent-level MONEY metric grouped by a CHILD field is UNDEFINED, not just unjoined.** I previously called `fee_revenue by department` a join problem. **It is not.** Revenue is one number on the parent; a parent with two children in two departments has **one revenue figure and two departments**. Attributing it requires an **allocation rule** — the same allocation the law is silent on (§5.10). A join would just double-count the revenue into both departments.

Options: (i) report revenue **only** by parent-level groupings (month, requestor, status) and refuse the child-grouped cut; (ii) allocate revenue across children by their quantity share, and label the report as an estimate; (iii) report "revenue of requests **touching** department X," accepting that the figures overlap and do not sum to the total. **Recommend (i) for now** — a wrong revenue-by-department number is worse than no revenue-by-department number, and nothing in the product depends on it yet.
- ~~**`routes/tasks.js` `withReq()`** and the 7 `objections.js` joins select `request_number` from the work row.~~ **DONE 2026-07-13 (15/15).** `requestScope.numberJoin()` / `numberExpr()` resolve the **citizen-facing number through the parent** — `COALESCE(_p.request_number, r.request_number)`. Today `master_request_id` is NULL so it falls back to the row's own number (a no-op, verified on the live API); after the migration a task on a child shows the parent's `2026-0045`, never the child's `2026-0045-1`. Staff must never be shown a number the citizen has never seen.

---

## 12. Fee-waiver policy — research 2026-07-14 `[NOT BUILT — substrate designed, values researched]`

Kevin: *"we need to make sure that fee waiver denial follows the different rules required by different states."* Researched across TX · CA · IL · WA · FL · NY · CT. **Two findings are landmines.**

### 12.1 ⚠️ THE ILLINOIS FEE-FORFEITURE TRAP — a hold state that destroys the fee
5 ILCS 140/3(d): a body must comply with or deny within **5 business days**, extendable by 5 only on **seven enumerated grounds** (§3(e)) — **and deciding a fee waiver is NOT one of them.** Then:

> "*A public body that fails to respond to a request within the requisite periods in this Section but thereafter provides the requester with copies of the requested public records **may not impose a fee for such copies**.*"

**A request parked in "awaiting fee-waiver decision" keeps aging against the 5-day clock.** On day 6 the body has (a) constructively **denied** the request and (b) **permanently lost its right to charge anything** for those copies. The deliberation destroys the fee. Illinois is the only state in the set where the agency's own delay extinguishes the charge.

**What the system MUST do (IL):**
1. **Never let a waiver request pause the IL response clock** — `tolls_on_waiver_request = false`, non-overridable.
2. **Do not offer a §3(e) extension for waiver deliberation** — restrict the extension-reason picker to the seven statutory grounds (the `extend()` `grounds` cap already does this — §10.4 step 4).
3. **Warn at business-day 4**, block at 5, on any IL request in a waiver-pending state.
4. **If the clock is blown, HARD-DISABLE fee assessment** — the system must *refuse to generate an invoice*, not merely warn, citing §3(d).
5. **Log the deemed-denial** at day 6 so the requestor's 60-day PAC window (§9.5(a)) starts from a real recorded date.

### 12.2 ⚠️ TEXAS — the abandonment clock does NOT hang off the waiver denial
The obvious design (start the pay-or-abandon clock when the waiver is denied) is **wrong for Texas and would auto-close live requests.** In TX a waiver denial by itself does nothing procedurally. The 10-business-day deemed-withdrawal hangs off the **money documents**:
- **§ 552.2615(b)** — itemized estimate (required >$40): withdrawn if the requestor does not respond in writing within **10 business days** (accept · narrow · file an AG overcharge complaint).
- **§ 552.263(f)** — deposit (>$100 / >$50): withdrawn if not posted by the **10th business day**.

→ `response_window.trigger_event` must be `cost_estimate_sent` / `deposit_demanded`, **never** `waiver_denial`.

**TX *does* have a public-interest waiver** — § 552.267(a): the body "**shall** provide a copy … without charge … if the governmental body **determines** that waiver … is in the public interest because providing the copy **primarily benefits the general public**." **The "shall" is illusory** — it triggers only on the body's own determination, with no standard, no burden, and no review. Functionally discretionary. TX has **no indigency waiver and no news-media waiver** (SILENT — do not invent them).

### 12.3 Three uniform findings across all seven states
- **No state has a "deemed granted" rule.** Every state that addresses agency silence makes it a **deemed DENIAL**.
- **No state requires a fee-waiver denial to be in writing with reasons.** Written-reasons duties attach to *exemption/records* denials only. A uniform statutory gap — we ship written reasons anyway as policy; no state forbids it.
- **No state tolls the response clock for a pending waiver request or appeal.** TX is the only one with any clock movement, and it is a **restart on deposit receipt** (§ 552.263(e)), not a toll.

### 12.4 The pay-or-abandon clock is STATUTORY IN ONLY ONE OF SEVEN STATES
| | Waiver grounds | Binding | **Source** | Window | Trigger | Appeal forum | Forum can ORDER a waiver? |
|---|---|---|---|---|---|---|---|
| **TX** | public_interest · cost_exceeds_collection | discretionary | **statute** | 10 bd | `cost_estimate_sent` / `deposit_demanded` | AG **overcharge** only (10 bd) | **NO** |
| **CA** | *none* | none | none | — | — | court only | no |
| **IL** | public_interest | discretionary | **statute** | *SILENT* | — | PAC (60 cd) | **NO** ← *see 12.5* |
| **WA** | agency_discretion | discretionary | **agency_policy** | 30 cd | — | court (1 yr) | no |
| **FL** | *none* | none | none | *SILENT* | — | court + voluntary AG mediation | no |
| **NY** | agency_discretion | discretionary | **regulation** (21 NYCRR 1401.8) | *SILENT* | — | internal (30 cd) → Art. 78 | no |
| **CT** | indigency · exempt_records · public_interest · elected_official · public_defender | **MANDATORY** | **statute** | *SILENT* | — | FOIC (30 cd) | **YES** (except the "general welfare" prong) |

**`provenance.source` is LOAD-BEARING, not cosmetic.** Only TX may tell a requestor "the law gives you 10 business days." WA must say "**our rules** give you 30 days"; FL must say "**our policy** is to close after 30 days." **Four of seven states have no legal clock at all.** A UI that renders every timer as "the legal deadline" **misleads requestors in four of seven states.**

### 12.5 The sleeper field: `appeal.can_order_waiver`
Illinois' PAC **will open a fee-waiver file and then tell the requestor it was never empowered to grant one** — 2017 PAC 47258: "*the Public Access Counselor does not have authority to direct the City to grant … a fee waiver.*" Texas' AG complaint reviews the **amount** against the cost rules, not the § 552.267 discretionary call. **Never route a requestor to a forum that cannot grant what they came for.** CT's FOIC is the only forum in the set that can actually order a waiver.

### 12.6 Substrate (to build — mirrors `clarificationPolicy` / `paymentClockPolicy`)
`enabled` (default false) · `grounds` (multi-enum) · `binding` (mandatory|discretionary|none) · `requestor_must_state_purpose` (IL: true) · `denial_requires_written_reasons` · `deemed_granted_on_silence` (false everywhere) · `response_window {days, unit, trigger_event, expiry_effect}` · `clock {tolls_on_waiver_request, tolls_on_waiver_appeal, restarts_on_deposit_receipt}` · `appeal {forum, window_days, can_order_waiver, reaches_fee_amount}` · `thresholds {estimate_required_above, deposit_allowed_above, deposit_cap_pct}` · `guardrails {fee_forfeiture_on_late_response, extension_grounds_closed_list}` — each with `{source, citation, confidence}` provenance and a validated enum.

---

## 13. Citizen-facing model `[folded from SPEC_tasks_roles_mrr_fees.md §12 "Layer 1" — 2026-07-16. UNCHANGED and still correct: §12 got this layer right and nothing here revises it.]`

**The citizen never sees any of this vocabulary** — not parent, child, master, MRR, item, or component.

- **One submission = one request, one number, one fee, one deadline, one contact**, however many records they
  describe. The number is the parent's (§4.1); a child's `-1` suffix is never shown to a requestor and is hidden
  in staff UI when `child_count = 1` (§5.1, §7).
- **"Combined vs separate" is RETIRED and stays retired.** Combining is the legal norm and the *only* path; a
  genuinely independent second request means filing twice. The portal's `mrrChoice` is the retired artifact of
  the old question (`SPEC_public_portal_intake.md` §2 Phase 3/5) — **still present in the portal payload; remove
  it with the migration.**
- **The only multi-child choice that reaches the citizen is DELIVERY TIMING** — each-as-ready vs hold-all —
  shown only when `child_count > 1`, and it may be defaulted. ⚠️ Not a mere preference: **WA RCW 42.56.080(2)
  makes installments an entitlement** and **TX §552.306(c)(2)(B) requires batch notices** (§5.8).
- **Child formation from the description: AI proposes, a human decides.** Intake elicits one description per
  record (detect-and-propose → validate-each → "anything else?"). `child_count > 1` at handoff ⇒ MRR (§14).
- **The fee-waiver gate runs first**, before routing to Open Records and assigning the Request Manager.

**Fees (§12 "Layer 3", folded into §6.4 and unchanged):** computed **once, at the parent**, never per child.
Per-request thresholds — minimum, de-minimis, floor/ceiling, deposit, certification — apply **once** to the whole
request, which is the legal "combine into one request, one fee" rule. **A child is a unit of *work*, never a unit
of *billing*.** Children contribute quantities; the parent computes the money. Single- and multi-child requests
use the identical engine; multi only adds a per-child gathering step feeding the one parent estimate.
*(Open sub-item, carried forward from §12: whether to re-fee on child change — recomputation mechanics only,
never the number of minimums.)*

---

## 14. MRR management & staff workflow `[folded from SPEC_tasks_roles_mrr_fees.md §12.1 — 2026-07-16. NOT BUILT. The hub is NOT SCOPED.]`

> §12.1 was **never superseded by anything** — it was simply filed inside a document about tasks, roles and fees,
> where nobody building parent/child would look. That is a large part of why item 11 fell through the cracks for
> thirteen sessions. It lives here now. Read every "item" in the original as **child**.

### 14.0 The distinction that governs this whole section
**A parent with ONE child is an ordinary request and behaves exactly as it does today.** A parent with **2+
children is an MRR** and gets a manager. `is_mrr` is **derived** (`child_count > 1`, §4.1) — a fact, never a mode,
never hand-set.

*This distinction is the source of an apparent contradiction that cost two sessions.* §9 item 5 ("routing for
**MRR** stays purely manual") and `MASTER_task_types_permission_groups.md` §A2 ("the MRR **parent** is routed by
the system; the MRR **children** are hand-assigned") are **both MRR-scoped in their own sentences**. Neither ever
said anything about single-child requests, which have always auto-routed. Read out of scope, they look like a
contradiction of always-wrap. They are not.

### 14.1 Ownership — the ORO Associate owns the TREE, at the parent
- The MRR parent is **system-routed** to an **ORO Associate** (the Request Manager) via the **`mrr_processing`**
  task type when intake detects `child_count > 1`; eligibility applies.
  (`MASTER_task_types_permission_groups.md` §A2 — `[NOT BUILT]`.)
- **The ORO Associate owns the whole tree at the PARENT. Children are NOT individually assigned to them.**
  `[CLARIFIED 2026-07-16 by Kevin]` Only `mrr_processing` is an eligibility-routed task type in
  `ROUTABLE_TASK_TYPES` / the per-person subset picker; child tasks are not. Children are *dispositioned from
  inside the hub* (§14.3), not assigned to the RM one by one.
- **Intake review is bypassed for MRR** — the parent is already with an Open Records team member (§9 item 5).
- **The RM is the sole communicator with the requestor.** Task screens carry **no** contact-requestor button;
  they carry **"email the Request Manager."** One request, one voice — this exists to stop five staff
  independently emailing one citizen about one request.

### 14.2 Child routing — SUGGEST vs COMMIT `[DECIDED 2026-07-16 by Kevin — SUPERSEDES §9 item 5's "purely manual"]`

**The classifier runs identically on EVERY child. Only the commit gate differs.**

| | Classifier | Result |
|---|---|---|
| `child_count = 1` | runs | **COMMITTED** — routed and assigned automatically, exactly as today |
| `child_count > 1` (MRR) | runs | **SUGGESTED** — held for the Request Manager in the hub |

In the hub the RM may, per child: **accept the suggestion** (one click) · **override** (route to a different team
/ assign a specific person) · **process it personally without assigning**.

**Why suggest-and-confirm rather than pure automation (Kevin, 2026-07-16):** MRRs are disproportionately the
complex requests. The ORO Associate has materially more operational experience than the classifier can encode —
they may enter estimate data for a child themselves rather than route it at all, or hand a search to the one
individual known to be best at it. Suggestion upgrades the RM's job from data entry to review, and leaves a
recovery path when the classifier is wrong.

**Why not pure manual (the 2026-07-13 call, now relaxed):** always-wrap means a single-record request **is** a
parent with one child. If children did not auto-route, every ordinary request would suddenly need a human to
route it. The **engine** must therefore be uniform for single and multi; only the **commit gate** may differ.
This is the least special-casing that satisfies both requirements.

**"Process personally without assigning" STILL SPAWNS A TASK**, self-assigned to the RM.
`[Claude's call, 2026-07-16 — NOT Kevin's; flagged for correction]` Architecture item 6 requires every stage
advance to write `request_history` and spawn/update the stage task. Work with no task is precisely the untracked
state that invariant exists to prevent — and an unassigned, task-less child is **invisible to the budget clock**
(§5.4), which is the one signal that would catch it stalling.

### 14.3 The hub — MRR management workspace `[NOT SCOPED — design direction required BEFORE build (UI rule)]`

**Kevin's shape (2026-07-16):** *one screen showing the entire parent/child request record — a **parent line** and
**each child as a line**.* It is where the RM does everything: accept suggested routing/assignment, assign
manually, or take a child personally. This is the same shape §7 already specifies for the queue (parent line,
children indented, collapsing to a single line at `child_count = 1`) — **the hub and the queue treatment must be
designed together, not as two screens.**

Natural content, all of which already exists as data:
- **Parent line** — `request_number`, statutory `due_date`, `clock_state`, `tolled_days`, `payment_status`,
  `parent_state`, `outcome`.
- **Child lines** — `component_label`, the five workstream statuses (§5.3), **budget clock days ahead/behind**
  (§5.4), record-hold (§5.5), suggested-vs-committed routing (§14.2).

**Why the budget readout is the point of this screen (Kevin's scenario, 2026-07-16):** four children fully
processed and one behind in redaction blocks the parent from completing, which blocks estimate reconciliation and
final billing. Today **nothing surfaces which child is the blocker.** Slice B's per-request bottleneck timeline
already computes the raw signal (`c74b97e`..`a933b88`); `BUILD_PRIORITY` #13 is the org-wide version that turns a
recurring blockage into a staffing pattern rather than an incident. This is also the operational reason the child
carries `budget_clock` at all (§5.4) — the statutory clock (parent) would never reveal it.

### 14.4 The three other staff surfaces — actions WITHIN the hub `[NOT BUILT]`
1. **Multi-Record Estimate interface** — gather per-child inputs (search/select auto-populates the estimate
   profile, or manual entry) → totals accrue to the parent → parent **Create Estimate** via the standard engine
   (§6.4). Budgeted dates come from estimate profiles (`BUILD_PRIORITY` item 3).
2. **Non-system contributor** — the RM may assign estimate-gathering to **someone who is not a user** by email →
   **secure, expiring, single-use token link** → they submit costs → the task completes. *(Real-world case: the
   AV specialist in another department who will never hold a login. Nothing else in any spec covers this.)*
   `[needs the token substrate]`
3. **Multi-Record Search interface** — per-child search; selected / public-ready children auto-complete; a located
   record needing redaction hits the normal auto-routing.
4. **Verify ≠ Approve — the distinction is LEGAL, not cosmetic.** Staff **Verify** an estimate before it goes out.
   **Approve** is reserved for the *requestor* approving the estimate, which **in some states is the event that
   begins processing**. Collapsing the two words into one button would corrupt a statutory trigger.
5. **Manual early release of a completed child** — default: nothing releases until the whole request completes;
   the RM may set a **Finance-approved** acceptable payment to release specific completed children early.
   ⚠️ **Reconcile with §5.9:** the payment gate is a **coverage** test — a child may **never** be withheld because
   a *sibling* is unpaid. Early release is the RM's discretion *within* that constraint, not an exception to it.
6. **HIGH PRIORITY flag** → an AI report monitoring all high-priority MRRs.

### 14.5 Roll-up (pointer, not a restatement)
Parent completes only when **all** children complete. ~~mixed outcomes resolve per **§6.2** (and *not* by the
intuition that "some denied ⇒ partially granted" — read the precedence table).~~ Parent budget variance is the
**critical-path child**, per §6.3 — a parent is not "ahead" because four of five children are.

> ⛔ **Dangling pointer, corrected 2026-07-19.** This sent mixed-outcome resolution to **§6.2**, which is
> `[DEFERRED]` and says in its own text *"Do not build from this section. The parent has no disposition and no
> outcome."* So the pointer led to a section forbidding the thing it was consulted for.
>
> **There is no mixed-outcome resolution to perform.** `parent_state` is `In Process` · `Complete`, and
> `Complete` means every child reached a terminal disposition **whatever those dispositions were** (§4.4).
> Mixed outcomes are not resolved into a parent verdict — each child keeps its own §5.8 disposition. The
> warning against "some denied ⇒ partially granted" was right and is now structural rather than advisory.
>
> What genuinely remains open is **notices**, not status: which notice a citizen receives when one child is
> delivered and another denied. That belongs to §4.4's field-design pass — see `WORKFLOW_DECISIONS.md` Part 4.
