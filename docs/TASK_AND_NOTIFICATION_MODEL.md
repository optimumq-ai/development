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
