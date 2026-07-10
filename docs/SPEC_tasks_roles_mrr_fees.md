# Consolidated Spec — Tasks, Notifications, Roles, MRR, Fees
**Current design only.** Superseded/iterative content removed. Verified against code + DB on 2026-07-08.

**Scope:** this covers ONLY the Task/Notification/My-Tasks, Role, Multi-Record (MRR), and Fee-intake/waiver/estimate domain. It is NOT a whole-system spec. Detailed reconciliation audit trail: `TASK_AND_NOTIFICATION_MODEL.md`.

**Status legend:** `[BUILT]` working in code · `[PARTIAL]` some built, gaps noted · `[NOT BUILT]` designed, not implemented · `[DEFERRED]` intentionally postponed · `[DECISION]` decided, not yet built

---

## 1. Two item types on My Tasks
- **Task Assignment** — a human "stop" in request processing, with its own completion screen; carries type, owning role, request/record context, lifecycle state, assignee, health contribution. `[PARTIAL — task records + routing built; per-type screens mostly NOT built, see §6]`
- **Notification** — ad-hoc item: a description + hyperlink to a screen, no completion UI; for heads-ups and passive/monitor items; independent of request_id. `[NOT BUILT]`

## 2. Task lifecycle & status
Internal: `open` (pool, no owner) → `assigned` → `in_progress` → `done`. `[BUILT]`
Owner-facing labels: **Queued** (=assigned), **In Process** (=in_progress), **Complete** (=done; item disappears from the box on completion). Pool items (`open`) appear in the claim pool, not a personal box.

## 3. Task routing (after a request is routed to a team)
1. **Smart-routing match** — compare each eligible role-holder's specialization text to the request; a confident match auto-assigns. `[BUILT]`
2. **Auto load-balancing toggle** — OFF → claim pool (first to claim owns) `[BUILT]`; ON → assign least-loaded person `[PARTIAL — leastLoaded primitive exists; toggle + workload formula NOT verified/built]`.
Supervisors, managers, system admins: **excluded from automatic assignment**; manually assignable; assumed able to do lower-level tasks in their department. `[design; enforcement to verify]`

## 4. Workload health scoring `[NOT BUILT]`
Per-role R/Y/G from a formula of late-task count with an **exponential penalty per additional day late**. Composite score at top of My Tasks. Feeds AI reporting + a management dashboard (health per task node per team). A per-task **"time budget"** is an input (reintroduce — dropped from an earlier spec).

## 5. My Tasks page structure `[NOT BUILT — current page lists assigned requests]`
One box per role the user holds. A box appears **only if** the user has a task of that type (assigned, or in a pool including them) — no empty boxes. Each box lists its Queued/In-Process items + a health score. Composite health at top. Notifications in a separate area.

## 6. Task completion screens (per type) `[PARTIAL]`
Each task type has its own screen; default shared across teams, team variants allowed (e.g., Police video redaction). **Estimate screen `[BUILT]`.** Record search / redaction / review / etc. `[NOT BUILT as dedicated screens]` — some functionality exists in the "workspace UI" (not the intended per-task processing UI); clicking a task currently opens the generic request-detail view.

## 7. Task / Role / Box catalog
Single-record lifecycle (each = one owning role = one My-Tasks box):
- **Estimate Creation** — role Estimate Creation/Review [today `estimate` routes to FEE_MANAGER; rename]. Task `[BUILT]`, screen `[BUILT]`.
- **Record Search** — role **Record Clerk** [code role SEARCH_AND_TRIAGE]. Task `[BUILT]`, screen `[NOT BUILT]`.
- **Redaction** — role **Redaction Clerk** [code role REDACTION_WORKER]. Task `[BUILT]`, screen `[NOT BUILT]`.
- **Legal Redaction** — role Legal Redaction [NEW]. Trigger: record type `sensitive=true` (flag to verify). `[NOT BUILT]`
- **Legal Review** — role Legal Review [code role ATTORNEY_REVIEWER exists, task not wired]. Catch-all legal counsel. `[NOT BUILT]`
- **Fee Waiver / Commercial Rate Approval** — role **Finance** (see §8); INTERIM code role `FEE_AUTHORITY` pending the Finance rename. Trigger: `fee_waiver_requested`. Task auto-spawned at intake (`onIntake`), team-agnostic (`team_id=NULL`) so it pools to every `FEE_AUTHORITY` holder; resolved by `POST /:id/fee-waiver-decision`, which now authorizes `FEE_AUTHORITY` (perm) + `SYSTEM_ADMIN/DIRECTOR/SUPERVISOR` (function) and marks the task `done`. `[BUILT 2026-07-09 — fee_waiver task + routing + resolution. Commercial-rate (`purpose='commercial'`) trigger still NOT wired; see §9-§10]`

MRR-specific tasks (role-agnostic; Request Manager assigns any best-fit user): **Multi-Record Request Estimate**, **Multi-Record Search**, **MRR Processing** (parent management, Open Records Request Manager). All `[NOT BUILT]`.

Passive items → Notifications, not tasks (e.g., awaiting payment).

## 8. Roles
**Two-layer model:** System Function Roles (fixed, engine-facing; tasks route to these) + Department Display Roles (dept-named labels mapped onto system roles, shown in UI). `[design; code has function_roles (~system layer) + a second overlapping permission_roles catalog — RECONCILE to one task-routing set]`
**Decision:** rename `FEE_WAIVER_APPROVER → Finance` (it already gates objection approvals too; broader financial-authority role). Touches code refs (objections.js, decisionReasons.js), catalog, user assignments. `[DECISION / NOT BUILT]`
MRR tasks are role-agnostic (no MRR-specific roles).

## 9. Fee-waiver processing
**Gate position:** FIRST step in processing (based on requestor category, pre-effort). If granted → no estimate-gathering. Applies to all requests.
**Built:** grant/deny endpoint; denial requires a reason from a reusable statutory-reason library (`decision_reasons`/`fee_waiver_denial`); denial sends a mandatory notice, then the request continues as normal (not closed); granted → fee computed then marked **waived** (notice "waived", balance $0). `[BUILT]`
**Gaps:** ~~NO auto-routing of a waiver request to the approver / no fee-waiver task on My Tasks~~ **BUILT 2026-07-09** (interim `FEE_AUTHORITY` routing; §5). NO "denial / response-window-active" status or requestor-reply flow `[NOT BUILT — compare against jurisdiction law before speccing]`.

## 10. Fee-intake capture (portal Phase 4) — default-forward `[NOT BUILT]`
Replaces the current yes/no waiver question. **Standard rates are the prominent default** ("Continue with standard rates"); below an "only if one applies" divider, two optional opt-ins: **Request a fee waiver** (desc) and **I'm a commercial requester** (desc, "subject to review"); plus "you can also just type to continue."
- Continue → `purpose=standard`.
- Fee waiver → follow-up reason → `fee_waiver_requested` → §9.
- Commercial → **sets the estimate calculator to commercial** (`purpose='commercial'`) so the staff estimate opens on commercial; staff confirm. **Approval `[DEFERRED — add on customer demand]`.**
Applies to BOTH the chat AND the "Prefer a form" fallback. Needs a richer widget than the current Yes/No quick replies.
**Current reality:** neither chat nor form captures commercial; `purpose` is set only by staff on the estimate screen; 0 commercial requests exist.

## 11. Estimate profiles `[PARTIAL]`
"**Profile**" (canonical term). Stores generating INPUTS per record type (quantities/stats/sample/expert-seed); the fee engine computes the estimate from them (standard OR commercial) into a detailed worksheet — not a stored total. `[engine BUILT; profiles table EMPTY — 0 populated]`
**Known gap (taxonomy, open):** record types can be "buckets" with variants (e.g., building-permit sub-types), but the taxonomy has no level below `record_type` and profiles/redaction attach 1-per-type, so variants can't get distinct profiles. A variant-level / auto-discovery design is an OPEN taxonomy decision (held by Kevin, intentionally not captured here).

## 12. Multi-record model — one request, many items `[MODEL AGREED 2026-07-10 — supersedes the prior "master/child / MRR" framing]`
The prior framing ("every request wrapped in a parent master + child," "combined vs separate," "a child is a full request") is **retired** — it braided three separate layers together and manufactured a false fee risk. Clean model, answered by layer:

**Core:** *A request has one or more items. The citizen sees one request, one number, one fee. Items are internal work-units that route and finish independently and roll up. Fees are computed once, at the request level. "Combined" is the default and the only path — there is no "combined vs separate."*

**Layer 1 — Citizen.** One submission = **one request, one number, one fee, one deadline, one contact**, regardless of how many records described. Never sees "master/child/MRR/item." **Not asked "combined vs separate"** — combining is the legal norm and the default; a genuinely independent second request = file twice. The only multi-item choice that reaches the citizen is **delivery timing** (send each item as ready vs hold-all), shown only when ≥2 items; may be defaulted.

**Layer 2 — Processing.** The request holds **items**, one per described record. Each item has its own department/owner, search, redaction-if-needed, files, and status. An item flows through the **same processing engine** as a standalone request — that is all "a child is a full request" ever meant (plumbing reuse, NOT a separate citizen request). A **Request Manager** owns the request and coordinates items; items **roll up** (request complete when all items complete; **Partially Granted** if some denied). Item formation from descriptions: **AI proposes / human decides**. **Single-record = a request with one item** — no special "MRR mode"; everything is uniformly 1…N items.

**Layer 3 — Fees.** Computed **once, at the request level**, never per item. Per-request thresholds (**minimum, de-minimis, floor/ceiling, deposit, certification**) apply **once** to the whole request — a city's per-request minimum is charged once no matter how many items (the legal "combine into one request, one fee" rule; already the engine's "parent-level application"). Items contribute **quantities**; an item is a unit of *work*, never a unit of *billing*. Single- and multi-record use the **identical** engine and thresholds; multi only adds a per-item **gathering** step feeding the one parent estimate. *(Open sub-item: whether to re-fee on item change — recomputation mechanics only, not the number of minimums.)*

**Terminology (retire the jargon that caused the tangle):** master/parent → **request**; child / "full request" → **item** (internal work-unit); `component_label` → **item label**; `is_mrr` special mode → just `item_count > 1` (a fact, not a mode); "combined vs separate" question → **removed**.

**Current reality / storage.** Schema has `is_mrr`, `master_request_id`, `component_label`; a request can read its items; classifier flags `is_mrr`. NO item creation/split yet (0 in DB), NO management screen, NO route-to-Open-Records. **One implementation fork (build-time; does not affect Layers 1 or 3):** store items as **(a)** child-request rows (`master_request_id`, reuses the engine, half-scaffolded — leaning this) or **(b)** a dedicated `request_items` table (cleaner data, more engine rework). Blast radius for (a): centralize ~5 creation sites + migrate ~118 rows + review ~17 list queries & 6–8 list views; processing engine untouched.

### 12.1 Staff-side MRR management — open design surface `[NOT BUILT — design next; hub = Request Manager workspace]`
Four staff surfaces, all reached **from** the Request Manager workspace — design the hub first; the other three are actions within it. Read every "child" below as **item**.
1. **Request Manager workspace (hub)** — RM owns the request, coordinates its items, is the sole communicator ("email Request Manager"; no per-task customer button); "MRR Processing" box.
2. **Multi-Record Estimate interface** — gather per-item inputs (search/select auto-populates the profile, or manual; non-user via secure expiring link) → totals accrue → parent **Create Estimate** via the standard engine.
3. **Multi-Record Search interface** — per-item search; selected/public-ready items auto-complete; a located record needing redaction hits the normal auto-routing.
4. **Manual early release of a completed item** — default no release until the whole request completes; RM may set a **Finance-approved** acceptable payment to release specific completed items early.

Detailed prior notes (retained; "child" = item):
- **Intake:** agent elicits one description per child (detect-and-propose + validate-each + "anything else?"); >1 item → MRR at handoff.
- **Fee-waiver gate first**; then route to Open Records, assign the **Request Manager** (owns the parent; "MRR Processing" box).
- Children not auto-routed; RM manually assigns a department per child; a public-ready-selected child needs nothing further.
- **Estimate:** if a profile exists, costs display for the RM; else RM assigns **Multi-Record Request Estimate** (role-agnostic) to gather; screen allows search/select (auto-populates the profile) or manual entry; on submit, ownership returns to RM and totals accrue; when all children done → parent = **Create Estimate**; RM generates via the standard engine.
- **Non-system contributor:** RM can assign estimate-gathering to a non-user by email → secure link → they submit costs → task complete. [needs a secure, expiring, single-use token]
- **Verify** (NOT "Approve" — "Approve" is reserved for the *requestor's* estimate approval, which in some states begins processing) → communicate the estimate to the requestor → the city's "begin processing" rules advance to fulfillment.
- **Fulfillment** mirrors estimate: selected/public-ready → auto-complete; else RM assigns **Multi-Record Search**; a located record needing redaction uses the normal auto node-change routine.
- Task screens have **no customer-comms button**; instead an "email Request Manager" button; the RM is the sole MRR communicator.
- **Completion/release:** parent complete only when ALL children complete; default no release until parent complete; NO partial-fee-allocation logic; but the RM may set an acceptable payment (Finance-approved) to release specific completed children early.
- **HIGH PRIORITY** checkbox → an AI report monitoring all high-priority MRRs.

## 13. Shipped fix (this session)
- **Self-healing reconciler** `[BUILT]`: spawns the missing stage task for any request stranded at record_search/redaction (idempotent; boot + every 2 min). Root cause of the original stage-advance-without-spawn is NOT isolated; centralized-transition fix deferred.

## 14. Deferred / open / legal-check
- Commercial-rate approval — DEFERRED (add on customer demand).
- Fee-waiver-denial response-window flow — jurisdiction legal research before spec.
- Time-budget input to health scoring — with health scoring build.
- Taxonomy variant-level / auto-discovery granularity — open, held by Kevin.
- Role-catalog reconciliation (function_roles vs permission_roles) — with role build.
