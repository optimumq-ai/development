# SPEC — Operational Dashboard (configurable panes + budget lateness)

**Status: BUILT 2026-08-12 — model decided and mockups approved by Kevin; all three slices shipped
(`verify_ops_dashboard` 21/21, full suite 1975/1975).**
Source: Kevin's note `/home/optimumq/exchange/dashboardrevision.doc` + his in-session clarification.
Foundation verified 2026-08-12 (full sweep): measurement is BUILT (task_events trail, queue/process
phase math, `time_budgets` table, ok/warn/over), the budget EDITOR and any lateness AGGREGATION are not.

## 1. The decided model `[DECIDED 2026-08-12 — Kevin]`

**Why budget lateness matters** (Kevin's framing, kept verbatim in spirit): a request may have a 10-day
statutory deadline; if the first task takes 9 days, everything after it happens at warp speed. With a
3-day budget on that first task, the dashboard flags it on **day 4** — six days before the legal clock
looks threatened. Budget lateness is the EARLY-WARNING layer; the statutory clock stays its own,
untouched machinery (the codebase's "false lateness" wall stands).

- **Simple, attention-catching, low precision.** No health formula, no exponential penalties, no
  complexity model — build item #13's scoring stays deferred. This is a counting model.
- **One budget value per TASK TYPE.** The editor exposes exactly the generic rows of the existing
  `time_budgets` table (record-type overrides stay in the schema for the future "brain", invisible for
  now). Calendar days, one number, editable by SUPERVISOR/DIRECTOR/SYSTEM_ADMIN.
- **Lateness buckets on OVERRUN duration** (elapsed active time − budget):
  `1 day late` = over by (0, 24h] · `2 days late` = over by (24h, 48h] · `>2 days late` = over by >48h.
  Computed from the existing `taskBudget` math (active elapsed = queue + process + returned; review
  excluded, as built).
- **Go-to-market simple; refine from customer feedback.** Anything cleverer waits for real users.

## 2. What gets built (three slices)

### Slice 1 — the budget editor + honest numbers
- **Editor**: a grid over `time_budgets` generic rows — task type · budget days · one save per row.
  New tab on Configuration ("Task Time Budgets"), gated SUPERVISOR/DIRECTOR/SYSTEM_ADMIN. Routes:
  `GET/PUT /api/config/time-budgets` (PUT validates: positive number ≤ 365, known task type). The seed
  values become *editable defaults* — the census/drift guard (`verify_v1_retirement` §E) keeps the task
  catalog and budget rows aligned.
- **Paused tasks tell the truth**: a currently-paused task (`tasks.paused_at` set) is EXCLUDED from the
  late buckets and shown as its own "waiting" count. This is the simple reading of the decided
  pause-not-reset rule (`SPEC_parent_child_lifecycle.md` §757): a task waiting on the citizen must not
  scream "late" — an attention tool that cries wolf gets ignored. Historical pause subtraction is NOT
  attempted (no interval history exists); recorded as a known simplification.

### Slice 2 — the aggregation endpoint
`GET /api/tasks/ops-summary` (staff-authed; team-scoped rows for non-elevated users, all teams for
elevated — the existing dashboard-stats scoping rule). One read serving every pane:
```
{ teams: [ { teamId, teamName,
    nodes: [ { taskType,
        queued,          // open + assigned
        inProcess,       // in_progress (+ returned)
        inReview,
        paused,
        late: { d1, d2, d2plus },   // the §1 buckets, actionable tasks only
        unbudgeted } ] } ],
  finance: { outstandingBalances, billedUnpaid, waivedToDate, collectedToDate } }   // Finance pane read
```
Derived on read from `task_events` + `time_budgets` + the finance services (requestor ledger /
paymentStatus aggregates); nothing stored. Teams are whatever `departments` holds at read time — panes
group by team, never name teams, so adding/deleting departments needs no dashboard reconfiguration
(Kevin's editability concern dissolves structurally).

### Slice 3 — the pane system
- **Recent Requests is deleted** (redundant with the Request Queue — Kevin).
- The dashboard becomes a pane grid. **Per-user configuration** (Kevin's stated preference; verified
  cheap): new `user_dashboard_panes` storage (user id → ordered pane list + per-pane params), with
  **role-based defaults** so nobody configures anything to get a sensible screen:
  supervisors → their team's panes · ORO/elevated → consolidated + per-team · FINANCE permission →
  finance pane · everyone else → the generic KPI view.
- **Pane library v1** (each a parameterized component over the one ops-summary read):
  1. **Team In Process** — the by-stage summary scoped to one team (or all).
  2. **Task Node Detail** — per task node: queued · in process · late 1d/2d/>2d (the core of Kevin's
     note), one team or consolidated.
  3. **All-Teams Grid** — Task Node Detail repeated per team, compact.
  4. **Finance** — outstanding balances, billed/unpaid, waived/collected.
  5. **Statutory Overdue** — the existing request-level overdue KPIs, kept (different clock, clearly
     labeled).
  6. **Generic** — today's KPI cards, the clerical default.

## 3. Explicitly out of scope (recorded so they are choices)
Health scores / exponential penalties (#13, still deferred) · the AI budget "brain" (Slice I, still
deferred — the editor is its manual forerunner) · per-record-type budget UI · parent roll-up of budget
variance (critical-path child; unblocked, separate slice) · historical pause interval subtraction ·
Recent Requests in any form.

## 4. Tests
Budget editor round-trip + role gate + validation refusals; paused exclusion (a paused over-budget task
lands in `paused`, not `late`); bucket edges (over by exactly 24h → d1; 24h+1s → d2); ops-summary
scoping (non-elevated sees own team only); pane defaults per role; deleted-team disappearance from the
grid. Harness `verify_ops_dashboard.js`, via `npm test` only.
