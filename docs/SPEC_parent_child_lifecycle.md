# SPEC — Parent/Child Request Model & Lifecycle Vocabulary
**Status: DRAFT for Kevin's review — 2026-07-13. Not built. No code moves until this is ratified.**

Supersedes, on the storage/lifecycle question, the two incompatible prior designs:
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

**A third primitive is genuinely absent: `extend()`.** `toll()` pushes the due date out by *elapsed wall time*, which cannot express "+10 statutory days for unusual volume" (IL §3(e), CA §7922.535(b)). See §10.

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
| `parent_state` | `Intake` · `In Process` · `Processed` · `Delivered` · `Closed` — **derived** (§6.1). Kevin's sheet stops at `Processed`; `Delivered` and `Closed` are added because nothing in the sheet records that the records actually went out. |
| `outcome` | `Granted` · `Granted in Part` · `Denied` · `No Responsive Records` · `Withdrawn` — **derived** (§6.2). Never hand-set; the research is explicit that "granted in part" is a computed consequence of the children. |
| `withdrawn_reason` | `Clarification not provided` · `Deposit not paid` · `Requestor did not claim records` · `Requestor withdrew` |

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

### 5.8 Disposition and delivery (child) — NEW
The sheet ends at Redaction → `Completed` and the child falls off the edge; nothing records that the record was actually released.

| Field | Values |
|---|---|
| `disposition` | `Released` · `Released with Redactions` · `Withheld in Full` · `No Responsive Records` · `Withdrawn / Closed` |
| `installment_no` | Which delivery batch this child went out in. |
| `delivered_at` | |

**Per-child release is first-class, not an MRR override.** Kevin's earlier position was "delivery is all at once, with MRR able to force release of an individual child." The law leans the other way: WA RCW 42.56.080(2) makes installment delivery a requestor *entitlement* ("on a partial or installment basis as records … are assembled or made ready"), and TX §552.306(c)(2)(B) *requires* batched delivery with a dated notice per installment for voluminous responses.

→ **Recommended:** keep `Hold-All` as the parent's operator default (it is what most cities do and what Kevin wants), but model `As-Ready` as a first-class parent `delivery_mode`, so a WA deployment and a voluminous TX response are both legal without a special case. The MRR "force release one child" button then becomes an ordinary As-Ready release rather than a bespoke path.

---

## 6. Roll-up rules

### 6.1 `parent_state`
- `Intake` — no child has left intake.
- `In Process` — any child is past intake and not all are complete.
- `Processed` — every child has reached a point of no further processing (Kevin's definition), regardless of *what* happened to it.
- `Delivered` — every child that is releasable has been released.
- `Closed` — terminal.

### 6.2 `outcome` (derived, never hand-set)
| Children | Parent outcome |
|---|---|
| all `Released` / `Released with Redactions` | `Granted` |
| any released **and** any withheld/no-record | `Granted in Part` |
| all `Withheld in Full` | `Denied` |
| all `No Responsive Records` | `No Responsive Records` |
| parent withdrawal event | `Withdrawn` |

**Denial is a decision, not a state** (Kevin). It is an *action* that produces a `Withheld in Full` disposition; the disposition is what rolls up.

This retires `requests.closure_reason`, which is currently overloaded four ways and cannot express granted / partial / denied / no-records.

### 6.3 `budget_variance`
The parent's "Budget Date +/-" = the variance of the **critical-path child** (the one with the latest projected completion), i.e. the *worst* days-ahead figure across children. A parent is not "ahead" because four of five children are ahead.

### 6.4 Estimate
Per §12 Layer 3, unchanged and correct: children contribute **quantities** (pages, labor, media). The parent applies the **fee waiver, special fees, minimums, de-minimis, floor/ceiling, deposit and certification — once**. A child is a unit of *work*, never a unit of *billing*. Totals live at the parent for both single- and multi-child requests, exactly as Kevin proposed ("for coding simplicity … having a total at the parent level regardless").

---

## 7. Presentation — queue, dashboard, reports

**Queue and dashboard:** every request renders as a **parent line** with its children indented beneath it. When `child_count = 1`, the pair collapses to a single line and the `-1` suffix is hidden — the operator sees exactly what they see today.

**Filters, reports, and worklists operate on CHILD rows.** This is the requirement that decided the whole model: "a report of all requests in redaction should include single-request child records as well as MRR child records." Every child row displays the parent `request_number` alongside its own `child_no`, so an overdue-work report is unambiguous about which request a line belongs to.

**My Tasks** is unchanged in shape — tasks already hang off the work unit, which is now the child.

---

## 8. Migration — additive, no data loss

The columns `master_request_id`, `component_label` and `is_mrr` **already exist and are written by zero lines of code**; there are 125 requests and **0 children have ever been created**. So the migration is a clean one-time backfill with no legacy children to reconcile.

**The existing `requests` row becomes the CHILD and keeps its `id`.** A new parent row is created above it.

Why this direction: of the 16 tables carrying `request_id`, **8 are work-level and stay pointed at the existing id, untouched** — `tasks`, `request_files`, `redaction_jobs`, `av_redaction_tasks`, `document_pages`, `fulfilled_records`, `request_selected_records`, `workflow_decisions`. Those are the high-row-count tables and, more importantly, the ones every task screen and deep link resolves through. Every existing `/redaction/:taskId`, every file, every page image keeps working with no rewrite.

**7 money/clock tables repoint to the new parent id** — `request_clocks`, `request_fee_estimates`, `fee_payments`, `fee_adjustments`, `erp_charges`, `request_payment_events`, `objections`. Low row counts, few code paths.

`request_history` rows stay where they were written; new rows are written at the level of the action (a stage advance → child; a payment → parent).

Backfill per existing request: create parent, copy the citizen/money/clock columns up, set `child.master_request_id`, `child.child_no = 1`, `child.request_number = parent.request_number || '-1'`, repoint the 7 tables.

**Two live bugs this migration forces us to fix first** (both already found, neither yet fixed):
1. The frontend drives stage advances through a **legacy stage order containing a ghost stage `custodian_retrieval`** that exists nowhere in the backend.
2. `feeNonpayment.js:39` and `tickler.js:88` bypass `applyStageTransition` with a raw `UPDATE requests SET stage='closed'` — writing no history row and leaving open tasks claimable. This violates `ARCHITECTURE.md` item 6 and will silently corrupt roll-up, because a parent that closes without its children closing is exactly the state the roll-up rules cannot represent.

---

## 9. Open questions for Kevin

1. **Parent `Processed` vs `Delivered`.** Your sheet's parent Stage ends at `Processed`. I've added `Delivered` and `Closed` because nothing otherwise records that records went out. Confirm, or tell me `Processed` already meant "delivered."
2. **Should nonpayment stop the statutory clock?** Today it does not — `payment_pending` is declared in `tolling.js` and has **zero callers**, so a request sitting on an unpaid deposit runs late on paper. Texas is stronger than a toll: an unpaid deposit **re-receipts** the request (§552.263(e)) and can withdraw it (§552.263(f); §552.221(e) 60-day). Recommend: add `deposit_nonpayment_effect: pause | reset | withdraw | flag_only` and set TX = `reset` (§10.4 step 3). The `restart()` primitive it needs is already built.
3. **Clarification: reset, not pause.** Confirm we implement §552.222 / *City of Dallas v. Abbott* as a reset rather than a toll. **This is already expressible** — set `clarification_clock_effect = toll_and_restart` for TX (`clarificationAction.js:32-42`). It is not set today: the policy is at all-defaults (`no_fixed_clock`, `enabled: false`) and nothing is attested, so the automation has never fired. Turning it on **changes reported lateness on live requests**.
4. **`delivery_mode` = `Hold-All` (default) | `As-Ready`.** Confirm you want As-Ready as a real mode rather than an MRR-only override (§5.8).
5. **Routing for MRR stays purely manual** for now (your call, 2026-07-13): parent assigned to an MRR manager who assigns children by hand. Intake review is bypassed for MRR because the parent is already with an Open Records team member. Confirmed — recorded here, no action.

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
2. **No deposit → clock rule.** `'payment_pending'` is declared as a toll reason (`tolling.js:16`) and has **zero callers**; `feeNonpayment.js`, `paymentTiming.js`, `paymentStatus.js` and `tickler.js` do not import `tolling` at all. An overdue deposit only sets a flag (`tickler.js:113`), so **the statutory clock keeps running on an unpaid request** — false lateness (spec §9, open question 2).
3. **No volume extension, and no primitive that could express one.** `'extension'` exists only as an unread string in `tollReasons` and an `<option>` in `RequestWorkspacePage.js:266`. `toll()` moves the due date by *elapsed wall time*; it cannot do "+10 statutory days" (IL §3(e), CA §7922.535(b)). Needs a new `extend(clockId, days, reason)` writing to `request_clocks.duration` with an audit row.
4. **`tollReasons` is inert.** Declared per clock in config, **never read** — `toll()` accepts any string unvalidated (`tolling.js:108`).

### 10.3 The data that exists — and where it isn't
- **`CLARIFICATION_POLICY_SURVEY.md` holds 17 jurisdictions** (AL, AR, OK, NC, GA, PA, MI, ID, FL, AZ, CA, WA, NJ, RI, IL, KS, MS) with `clock_effect`, `grace_days`, `abandonment_closure`, `notice_required` and citations — **already in the exact shape `clarificationPolicy.js` validates**. It is **markdown, not data**: 0 rows in the DB.
- **`jurisdiction_profiles` has ONE row — Texas.** `clock_tolls` has **0 rows**: no clock has ever been tolled in production. All 7 profile sections have `attested_by = NULL`, so every automation gate is closed and the clarification automation has never fired.
- **Two docs are false and are corrected in this commit:** `SPEC_jurisdiction_configuration.md` claimed "three state profiles loaded" (there is one); `CONFIG_FRESHNESS_DESIGN.md` claimed four TX config sources are seeded (`config_sources` has zero rows).

### 10.4 Build order (do this before, or alongside, the parent/child migration)
1. ~~**`jurisdiction_rules(jurisdiction_id, domain, config_json)`**~~ — **BUILT + verified 2026-07-13 (24/24).**
2. **Load the 17 surveyed states** as data. They are already in the validated shape — this is now a pure data task, since the slot exists. **← next**
3. **Deposit rule slot** — one enum `deposit_nonpayment_effect: pause | reset | withdraw | flag_only`, one `effectPlan`-style switch wired into the tickler's deposit branch. ~60 lines, a direct copy of `clarificationAction.js`. TX = `reset` (§552.263(e)) with withdrawal on lapse (§552.263(f), §552.221(e)).
4. **`extend(clockId, days, reason)`** — the one genuinely new engine primitive, for statutory volume extensions.
5. **Make `tollReasons` load-bearing** — validate `toll()` against the clock's configured reasons.

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
