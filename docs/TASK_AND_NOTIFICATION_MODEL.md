# Task & Notification Model

**Status:** DRAFT v0.1 — reconstructed 2026-07-07 from Kevin's description + a code audit + recovered prior-chat design. Not yet verified line-by-line against code. Code-reality flags: `[code: exists]`, `[code: primitive exists]`, `[code: partial]`, `[code: to verify]`, `[code: not built]`.

## 1. Purpose
Authoritative definition of how work reaches a person on the **My Tasks** page: the two item types, how task assignments are routed, how workload health is scored, how the page is organized, per-type completion screens, and multi-record (parent/child) request management. Builds conform to this document.

## 2. Two item types on My Tasks

### 2.1 Task Assignment
Any **"stop" directly in the flow of processing a request that must be executed by a human.** Structured work with a defined completion screen. Carries: type, owning role, request/record context, lifecycle state, assignee, and a health contribution.

### 2.2 Notification
An **ad-hoc item that appears on My Tasks but is NOT a request-processing stop.** It informs and points — a description plus a hyperlink to a relevant screen — rather than presenting a purpose-built completion UI. Used for heads-ups and passive "monitor/observe" items (e.g., "an imported file has arrived — set up a redaction profile"). **Must not depend on a request_id.** `[code: not built]`

## 3. Task-assignment routing (after a request is routed to a team)
Order of operations:
1. **Smart-routing match.** Among people on the team holding the task's required role, compare each person's smart-routing description to the request description; if one matches well, assign the task to them. `[code: exists — suggestAssignee / autoRouteOrPool]`
2. **Auto load-balancing toggle:**
   - **OFF** → task goes to the **pool** of people in that role on that team; first to click **claim** becomes the assigned owner. `[code: exists — 'open' state = pool + claim]`
   - **ON** → task is assigned to the person with the **lightest workload**. `[code: primitive exists — leastLoaded(); toggle + full workload formula to verify]`

**Lifecycle states** `[code: exists]`: `open` (in pool, no owner) → `assigned` (owner set by routing or claim; appears on their My Tasks — this is when "assigned" counts) → `in_progress` (owner opened/started).

## 4. Workload health scoring
- **Formula inputs:** number of late tasks, with an **exponentially increasing penalty for each additional day** a task is late.
- Produces a **red / yellow / green** status per staff member **per role**.
- A **composite** score across all of a person's roles shows at the **top of their My Tasks page**.
- **Feeds:** AI reporting, and a management **dashboard** showing the health of each task node per team.
`[code: to verify — likely not built]`

## 5. My Tasks page structure
- A person may hold **multiple roles** → the page shows **one box per role** (e.g., a Record Search box, a Redaction box).
- Each role box **lists that role's task assignments** and shows that **role's health score**.
- **Composite health score at the top.**
- **Notifications** appear in their **own area**, separate from task-assignment boxes.
`[code: not built — current page lists assigned requests; no per-role boxes, no health scores, no notification area]`

## 6. Task completion screens (per type)
- **Each task type has its own completion screen**, opened by clicking a task line in a box.
- Default screens are **shared across teams**; specific teams may have **variants** (e.g., Police **video** redaction differs from standard redaction).
- **NOTE:** much of the functionality for individual task screens **already exists — but inside the "workspace UI,"** which is NOT the request-processing UI Kevin wants. Migrating/reframing that functionality into proper per-task screens is a known job. `[code: partial — functionality exists in workspace UI, wrong paradigm; clicking a task currently opens the generic request-detail screen]`

## 7. Multi-record (parent/child) requests
- A **parent** request covering multiple record **children** is **always routed to the Open Records team** and assigned to the **request-manager** role.
- The request manager **assigns each child record** to the appropriate team for its node (estimate if not auto-calculated, record search, redaction, etc.) — or may assign children **to themselves** and complete those nodes.
- There is a **dedicated multi-record request management task** (specific to this request type) that lands on the Open Records request-manager's My Tasks, presenting **all child requests with their status**.
`[code: to verify — dedicated management task type likely not built]`

## 8. Task catalog (current vs. target)
**Implemented today** `[code-verified]`: `estimate` (→FEE_MANAGER), `record_search` (→SEARCH_AND_TRIAGE), `redaction` (→REDACTION_WORKER), `review_auto_redaction` (unrouted), `build_redaction_template` (unrouted).
**Target human-step tasks not yet spawning:** intake/triage, clarification, fee-waiver approval, custodian retrieval, redaction approval, legal/attorney review, delivery & closure, multi-record management.
**Passive/monitor items → Notifications, not tasks** (e.g., awaiting payment).

## 9. Roles (reference)
Governed by the **two-layer role model** (see ROLE_MODEL, to be written): **System Function Roles** (fixed, engine-facing; tasks route to these) + **Department Display Roles** (dept-named, mapped onto system roles, shown in the UI). Current code has a `function_roles` catalog (matches the system-function layer) **plus** a second `permission_roles` catalog that overlaps and must be reconciled to one task-routing role set.

## 10. Open questions / to verify against code
- Exact workload formula (penalty curve) and R/Y/G thresholds.
- Whether the load-balance toggle is per-team or global.
- Precisely what the "workspace UI" contains vs. what a per-task processing screen needs.
- Whether any parent/child management exists at all.
- Notification model does not exist yet — needs a first-class table independent of `request_id`.

---

## 11. Task / Role / Box catalog (request-path walk-through) — v0.2, IN PROGRESS
Enumerating every human task across all request paths. Captured incrementally; **not yet complete**. Principle: each task = one owning function role = one labeled box on that owner's My Tasks page. Clicking a request line in a box opens a screen specific to processing that node.

| Node / Box label | Owning role (Kevin's name) | Current code role | Trigger | Next node | Code status |
|---|---|---|---|---|---|
| Estimate Creation | Estimate Creation / Review (NEW) | task `estimate` → FEE_MANAGER | first step on a new request | Record Search (or Hold-for-Payment) | task exists, routed to FEE_MANAGER, not a dedicated estimate role |
| Record Search | Record Clerk | task `record_search` → SEARCH_AND_TRIAGE | after estimate complete (payment satisfied if required) | Redaction | task exists; role rename needed |
| Redaction | Redaction Clerk | task `redaction` → REDACTION_WORKER | after record search complete | Legal Redaction/Review if sensitive, else Delivery | task exists; role rename needed |
| Legal Redaction | Legal Redaction (NEW) | — | record type flagged `sensitive = true` | Legal Review / Delivery | not built |
| Legal Review | Legal Review (NEW) | ATTORNEY_REVIEWER exists | sensitive record needing legal counsel (catch-all) | Delivery | role exists; no task wired to it |

**Notes:**
- **Hold-for-Payment:** if a request is held for required payment, it shows **Complete** in the Estimate box (the estimate node is done) rather than lingering; Record Search does not begin until payment is satisfied. `[to spec]`
- **Search-within-estimate** path deferred — Kevin to review current workflow design first.

## 12. Status labels & box behavior
A per-owner box shows only actionable items, in two visible states:
- **Queued** — assigned to this person, not yet started. *(code state: `assigned`)*
- **In Process** — this person has started it. *(code state: `in_progress`)*
- **Complete** — node finished; **the item simultaneously disappears from the box**. *(code state: `done`/closed)*

Pool/claimable items *(code state: `open`)* are **not** "in a person's box" — they are the claim pool (§3), shown to all eligible people, separate from the owned Queued/In-Process list.

## 13. Supervisor / Manager / System Admin assignment rule
- **Excluded from automatic assignment** — routing never auto-assigns a task to them.
- Assumed capable of performing any task of a **lower level in their department**.
- A task **may be manually assigned/reassigned** to a supervisor or manager; when it is, it appears in a box **labeled with that task type** on their My Tasks page, exactly like any owner.
`[code: to verify whether auto-routing already excludes supervisor/manager/admin]`

## 14. Open reconciliation questions raised by v0.2
- **Role naming vs. two-layer model:** are "Record Clerk / Redaction Clerk / Legal Redaction / Legal Review / Estimate Creation" the **System Function Role** names (replacing the abstract COORDINATOR-style names) or **Department Display** names? Settle once the full task list is complete.
- Does a record-type **`sensitive`** flag exist to drive legal routing? `[to verify]`
- Reconcile Kevin's role names against the existing `function_roles` + `permission_roles` catalogs (dedup to one set).

### 11.1 Fee Waiver / Commercial Rate Approval (added)
| Node / Box label | Owning role | Trigger | Code status |
|---|---|---|---|
| Fee Waiver / Commercial Rate Approval | **Finance** (NEW consolidated role) | `fee_waiver_requested = true` OR `purpose = 'commercial'` | see notes |

**Reconciliation (code-verified 2026-07-07):**
- **Fee waiver — mostly built.** Columns exist: `fee_waiver_requested`, `fee_waiver_status`, `fee_waiver_reason`, `fee_waiver_decided_by`, `fee_waiver_decided_at`. The portal agent (publicChat Phase 4) captures waiver requests and emits `[[FEE_WAIVER_INFO:yes|reason]]`. Approver role `FEE_WAIVER_APPROVER` exists. **Gap:** the decision is tracked but does not appear to spawn a My-Tasks approval task — wiring needed, not a rebuild.
- **Commercial rate — built as PRICING, not APPROVAL.** No commercial flag column; commercial is a value of `request.purpose` (`= 'commercial'`). The fee engine applies commercial rates **automatically** via `purposeOverrides.commercial` (labor billable + surcharge). **Design change:** requiring approval for commercial is NEW behavior — today it applies with no human gate. Decide: apply-then-flag-for-approval, or hold pending approval.
- **Finance role — does not exist by that name.** Closest: `FEE_WAIVER_APPROVER` (function), `FEE_MANAGER` / `FEE_AUTHORITY` (permission). Intent: consolidate fee approvals under one **Finance** role owning this combined task.
- `is_mrr` column exists, separate from commercial (purpose of MRR flag to verify).

**Intent captured:** both fee-waiver-requested and commercial-purpose requests require human approval, surfaced as one combined task in a **Finance** box on My Tasks, listing requests where either is true.

### 11.2 Commercial-rate intake capture — GAP (verified 2026-07-07)
The fee engine prices commercial correctly, but the citizen-side signal is **never captured at intake**:
- **Portal chat agent** (`publicChat.js`): no phase asks about commercial purpose and no emit token for it. Phase 4 handles only fee-waiver eligibility (non-commercial public-interest). The chat never records "I am a commercial requester."
- **Public "Prefer a form" fallback:** no commercial checkbox (verified in UI).
- **Where `purpose` is actually set:** only by **staff** on the fee-estimate screen (`feeEstimates.js` → `UPDATE requests SET purpose`), or the test sandbox — **never from citizen intake.**

**Implication for §11.1:** as envisioned (requester declares commercial → approval), the task needs a prerequisite build:
1. Capture commercial self-declaration at intake — a chat phase/emit token AND a form field.
2. That sets the trigger from intake (distinct from staff-applied `purpose`).
3. Finance approval gates whether commercial rates apply.

Today commercial is a **staff-applied pricing choice with no intake signal and no approval gate** — the opposite end of the flow from where the trigger should originate.

### 11.3 Intended Phase-4 intake capture (design — mocked previously, never applied)
Recovered from Kevin's memory of a mockup that was never applied. Replaces the current yes/no fee-waiver ask with an explicit choice.

**Prompt:** "Select which of the following apply:"
- **Fee Waiver** — brief description (e.g., "You may qualify to have fees reduced or waived — nonprofit, journalist, researcher, or public-interest use.")
- **Commercial Rates** — brief description (e.g., "Records requested for commercial use are billed at commercial rates.")
- **Neither**
- plus an **Enter** button to confirm.

This is the missing intake capture (§11.2 step 1) for **both** signals in one step:
- Fee Waiver selected → sets `fee_waiver_requested` (+ follow-up for reason) → Finance approval (§11.1).
- Commercial Rates selected → sets the commercial declaration (drives `purpose='commercial'`) → Finance approval (§11.1).

**Implementation notes:**
- Current chat uses only simple single-tap `[[QUICK_REPLIES:...]]` buttons. This selection (options WITH descriptions + an Enter button) is richer — fits the deferred "Quick Reply widgets" backlog item. Needs a new marker/widget, e.g. `[[FEE_CHOICE:...]]`.
- Fee Waiver vs. Commercial are effectively mutually exclusive → confirm single-select (pick one) rather than true multi-select. `[open]`
- Must apply to BOTH the chat AND the "Prefer a form" fallback (form needs the equivalent field).

### 11.4 Phase-4 intake capture — REVISED to default-forward (supersedes 11.3 framing)
The "pick one / Neither" framing in §11.3 is replaced. Reason: in a chat, a "pick one" prompt with two substantive options implicitly pressures a choice, and a requester to whom neither applies gets stranded (a form has a submit button; a chat prompt does not). Fix: make **standard rates the obvious default**, with the two special cases as optional opt-ins.

**Design:**
- Assistant message: most requests use **standard rates**; continue unless a special case applies.
- **Primary action (prominent, solid):** "Continue with standard rates →" — the default path, most visually dominant element.
- Under a soft "only if one applies to you" divider, two **optional opt-in** cards (secondary/outlined), each with a brief description:
  - **Request a fee waiver** — "You may qualify to have fees reduced or waived — nonprofit, journalist, researcher, or public-interest use."
  - **I'm a commercial requester** — "Records requested for commercial use are billed at commercial rates, subject to review."
- **"You can also just type your answer"** note — tapping is never mandatory; typing "continue"/"none" also advances. This is the escape hatch for anyone who ignores buttons.

**Behavior:**
- Continue → `purpose='standard'`, no approval task.
- Fee waiver → short follow-up for reason → sets `fee_waiver_requested` → Finance approval (§11.1), then returns to flow.
- Commercial → sets commercial declaration; **"subject to review"** = does NOT auto-apply commercial rates; flags for Finance approval (§11.1) before rates apply.
- Mutual exclusivity is naturally handled (opt into at most one).

**Rationale:** mirrors the fee engine, which already defaults to standard and only deviates for waiver/commercial — UI and logic now tell the same story. Applies to BOTH the chat and the "Prefer a form" fallback. Widget is richer than current `[[QUICK_REPLIES]]` (needs the fee-choice widget / new marker).

### 11.5 Fee-waiver processing — verified reconciliation (2026-07-07)
Recalled design vs. what the code actually does:
- **Grant/deny approval action — EXISTS.** `requests.js` sets `fee_waiver_status='granted'` (+ decided_by/at) or `='denied'` (+ reason). A staff action decides the waiver.
- **Effect of a granted waiver — EXISTS; requester owes $0.** The engine still computes the real cost; a granted waiver is applied at presentation/payment: the notice reads "fees waived" / "Computed cost: $X (waived)" (`feeNotice.js`) and `paymentStatus.js` marks `waived: true` (nothing due). Mechanism is "compute then waive," NOT "engine calculates zero." No separate no-estimate path — the estimate/notice simply honors the granted status (i.e., it stays on the normal path).
- **Auto-routing to the approver — DOES NOT EXIST (the gap).** `fee_waiver_requested` is captured at intake, but nothing checks it at the start of processing to route the request to `FEE_WAIVER_APPROVER` or spawn a fee-waiver-approval task on My Tasks. The grant/deny endpoints exist, but a waiver request is not auto-surfaced to anyone — a human must find it and act. `FEE_WAIVER_APPROVER` is currently wired to OBJECTION approvals (`objections.js`), not to fee-waiver-request routing.

**Net:** waiver decision + fee-effect are built; the intake → auto-route-to-approver → task link is missing. That link is exactly the §11.1 task (Finance box). Until it's wired, fee-waiver approval is manual.

### 11.6 Role rename: FEE_WAIVER_APPROVER -> Finance (decision)
**Rationale:** the approver role is not limited to fee waivers. Code confirms it already gates **objection-resolution approvals** (`objections.js` `/approve`, `/pending-approval`) and the decision-reasons endpoint — i.e., it is the financial-authority role that signs off on waivers AND objection-based price adjustments (and, if added later, commercial-rate approval). The label `FEE_WAIVER_APPROVER` describes one duty of a broader **Finance** role (a person in a financial/accounting position).

**Scope of the change (NOT just a label):** `FEE_WAIVER_APPROVER` is referenced in code and data. A rename must update every reference, not create a second role:
- `function_roles` catalog entry.
- `requireRole('FEE_WAIVER_APPROVER', ...)` gates in `objections.js` and `decisionReasons.js`.
- Any `user_function_roles` assignments.
- Reconcile against the parallel `permission_roles` (FEE_MANAGER / FEE_AUTHORITY) per §9 — decide whether Finance absorbs those too, to avoid re-splitting the catalog.

**Finance role owns:** fee-waiver approval, objection price-adjustment approval, and (future, deferred) commercial-rate approval. Its My Tasks box(es) surface these approvals.

### 7.1 Parent/child (MRR) — verified reconciliation (2026-07-07)
**Built (schema + read):**
- Columns: `is_mrr` (flag), `master_request_id` (component -> master link), `component_label`. Parent/child data model exists.
- A master (`is_mrr` true, `master_request_id` null) reads its components: `SELECT * FROM requests WHERE master_request_id = ?` — used in the request-detail view (`requests.js`) and MRR-aware fee aggregation (`feeEstimates.js`).
- Intake/classifier capture `is_mrr` + `mrrChoice` (combined|separate|none); AV detection checks components.

**NOT built (the gaps):**
- **Child creation / split — does NOT exist.** No code inserts component requests (no INSERT with `master_request_id`, no split logic). **Confirmed by data: 2 requests are MRR masters, 0 components exist in the entire DB.** A multi-record request is flagged but never decomposed into children. The `mrrChoice='separate'` path has no implementation.
- **MRR management task — does NOT exist.** No task spawns to an Open Records request-manager; no dedicated multi-record management view.
- **Parent -> Open Records -> manager-assigns-children routing — does NOT exist.**

**So §7's vision has a real foundation (schema + read), but needs: (a) the split step that creates component children, (b) the management task, (c) the routing.**

### 7.3 "Always parent, every request a child" — VERIFIED FALSE (2026-07-07)
Belief (recalled ~2 weeks ago): the model always creates a parent, and every request — even single-item — is a child. **Not built.** Evidence:
- **Schema:** `master_request_id` is nullable, no default — a request is NOT required to have a parent.
- **Data:** 118 total requests; **0 have a parent** (`master_request_id` set); all 118 stand alone. Only 2 are `is_mrr` masters, and even those have no children.
- **Code:** no INSERT ever sets `master_request_id` — nothing creates a parent/child relationship.

Every request today is a flat standalone; the parent/child columns exist but are entirely unused.

**Design note:** "always a parent / every request is a child" is a *sound* convention (uniform handling, avoids single-vs-multi special-casing) — but it is a design to ADOPT and build, not something in place. The column foundation exists; the wrapping/creation logic does not.

### 7.4 Parent/child adoption — blast-radius measurement (2026-07-07)
Measured cost of adopting "every request is wrapped in a master (even single-item)":

**Must change (the real work):**
- **5 request-creation sites** across 4 files (`publicChat.js` x1, `requests.js` x2, `nena911.js` x1, `importIngest.js` x1) — each needs wrap-in-master logic. Best centralized into ONE creation helper so it can't drift.
- **One-time migration** of the 118 existing standalone requests (wrap each in a master).

**Review (some will change, upper bound):**
- **~17 of 60 backend `FROM requests` queries** are non-by-id (list/aggregate) and may need master/child awareness. The other **43 are point-lookups by id and are UNAFFECTED** — a child is a full request row fetched by id.
- **~6-8 of 16 frontend files** are request-LIST surfaces (RequestQueue, Dashboard, MyTasks, Tickler, ARIAReports, CashDrawer) that must decide "show masters" vs "masters + children." The rest are single-request detail/workspace views, largely unaffected.

**Untouched (the bulk):** all routing, task, fee, redaction, and processing code that operates on a request BY ID keeps working — a child IS a full request. 2 files (`feeEstimates.js`, `requests.js`) already handle children, so the pattern exists.

**Assessment:** additive and bounded, NOT a teardown. Core work = 5 creation sites (centralize) + migration + reviewing ~17 reads and ~6-8 list views for display. The processing engine does not get rebuilt.
