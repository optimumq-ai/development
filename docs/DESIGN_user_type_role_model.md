# DESIGN — User-Type Role Model (v3 proposal)

**Status:** DRAFT / proposal, pending ratification. Not yet a contract. If adopted, this replaces the current two-catalog role setup and updates `SPEC_tasks_roles_mrr_fees.md` §8 + the `ARCHITECTURE.md` "one task-routing role catalog" invariant.
**Authors:** Kevin (concept), Claude (structure/analysis). Started 2026-07-09; v3 incorporates Kevin's markup (§10 answers resolved, ORO Finance added, Departments/Teams and Smart Routing sections added) 2026-07-09.

---

## 1. Why change

Today OptimumQ has **two overlapping role systems** that both try to gate request work, with nothing keeping them in sync:

- **Permission roles** (`user_permission_roles` → `FEE_MANAGER`, `FEE_AUTHORITY`, `SEARCH_AND_TRIAGE`, `REDACTION_WORKER`, …) — used by **task routing** (who a task lands on).
- **Function roles** (`user_function_roles` → `SYSTEM_ADMIN`, `DIRECTOR`, `SUPERVISOR`, …) — used by **`requireRole`** middleware (who may act at an endpoint).

Because they overlap and aren't linked, you get **holes**: e.g. the fee-waiver decision endpoint gated on `FEE_WAIVER_APPROVER`, a role that exists in *neither* routable catalog — so a task could route to someone who can't act, or an authorized person might never see the task. This violates the `ARCHITECTURE.md` invariant **"one task-routing role catalog."**

The fix is not "fewer dimensions" — it's dimensions that govern **different, non-overlapping questions**, all hanging off one organizing concept.

## 2. The organizing concept: **User Type**

A user is assigned one (or more) **user types** describing the kind of work they do / their position. The user type is the single object management reasons about, and it drives everything below.

## 3. Three axes (non-overlapping — this is what kills the holes)

| Axis | Answers | Set by |
|---|---|---|
| **Task types** | "What request work lands on my list?" | picked **per person** (a subset of the user type's task menu) |
| **Authority** | "What can I do to requests/tasks I don't own?" (reassign, re-route, override, escalate, reopen) | the **user type** |
| **Permissions** | "What system settings/rules can I *change*?" (redaction rules, fee profiles, users, taxonomy) | the **user type** |

Each answers a different question, so nothing can fall out of sync. Routing **and** the authority to act both derive from the same assignment — that is the reconciliation.

### 3a. Two flavors of "task type"
- **Routable work** — estimate, record search, redaction, fee-waiver approval, commercial-rate approval, legal review, MRR tasks. These flow through the workflow engine and land on My-Tasks lists. (Financial approvals — fee waiver and commercial rate — route to **ORO Finance**; see §4.)
- **Non-routable capabilities** — view dashboards, run reports. Never routed; just gate UI. Same picker, different behavior. (Covers City Management, and the reporting side of every type.)

### 3b. Per-person subsetting
Only the **task-type subset** is chosen per person — because that is the only thing that genuinely varies within a position. Example: a fulfillment team with 12 people, all "Team Staff," some doing only estimates, some only redaction, some all three. Authority and permissions do **not** vary per person; they are properties of the user type.

### 3c. Multiple user types per person (and the exception mechanism)
A person may hold more than one user type. This handles small cities (one person is Team Supervisor **and** Team Staff doing redaction), and it **is the built-in exception mechanism** for permissions: if a Team Supervisor genuinely needs to edit fee profiles, give them the office user type that carries that permission — no special per-person override machinery in v1.

## 4. User-type catalog

Office-level types are **team-agnostic** (cross-cutting). Team-level types are **per fulfillment team** (prefixed with the team name). "Authority" and "Permissions" columns are properties of the type; "Task menu" is the set a person of this type can be assigned a subset of.

> Note on naming: "Associate" / "Finance" etc. are **model terms chosen to keep the model intuitive**, not literal job titles.

### Office-level

| # | User type | Task menu | Authority | Permission groups |
|---|---|---|---|---|
| 1 | **City Management** | *(none — never processes requests)* | none | Reporting |
| 2 | **ORO System Administrator** | *(none / optional)* | system (users, teams) | System Administration, Workflow & Taxonomy, Fee Configuration, Reporting — **not** Legal Rules (technical-only) |
| 3 | **ORO Director / Manager** | *(oversight; may act on any)* | highest operational — reassign/re-route/override/escalate/reopen across all teams | Workflow & Taxonomy, Fee Configuration, **Legal Rules (may)**, Reporting, staff/team management |
| 4 | **ORO Supervisor** | *(oversight; may act)* | operational — reassign/re-route, escalate | Reporting |
| 5 | **ORO Senior Legal** (city attorney) | Legal Review, (Legal Redaction) | legal decisions (AG, exemptions) | **Legal Rules (OWNER)**, Reporting |
| 6 | **ORO Legal Associate** | Legal Redaction (advanced), Legal Review support | none special | Reporting |
| 7 | **ORO Associate** | MRR (estimate/search/processing coordination) | (MRR request-management) | Reporting |
| 8 | **ORO Finance** *(new — v3)* | Fee-Waiver Approval, Commercial-Rate Approval | financial approvals (fee waiver, commercial rate, objection approvals); may manage multiple record requests when finance-related | Reporting |

### Team-level (per team)

| # | User type | Task menu | Authority | Permission groups |
|---|---|---|---|---|
| 9 | **[Team] Fulfillment Manager** | *(may do team tasks)* | reassign within team; **receives coverage-gap emails**; assigns staff task subsets | *(team-scoped staff assignment; no global config)* |
| 10 | **[Team] Fulfillment Supervisor** | *(may do team tasks)* | reassign/assist within team | none — **explicitly not Legal Rules** |
| 11 | **[Team] Fulfillment Staff** | subset of {Estimate Creation, Record Search, Simple Redaction} | none | none |

## 5. Permission groups (coarse, to stay legible — not per-button)

- **System Administration** — users/staff, teams, connectors, security/auth, system config
- **Workflow & Taxonomy** — the rulebook, record types, categories
- **Fee Configuration** — rates, estimate profiles, thresholds
- **Legal Rules** — redaction rules, exemptions/citations
- **Reporting** — dashboards, reports (view)

**Decisions locked (2026-07-09):**
- **Legal Rules** — **Senior Legal owns**, **Director may**, **Sys Admin technical-only** (not the owner of rule content). So a **Team Supervisor can *do* a redaction task but cannot *change the rules* for it** — the core "do the work vs. set the rules" line.
- **Permissions strictly by user type in v1**; exceptions handled by assigning an additional user type (§3c).
- **Financial approval is its own authority** — the new **ORO Finance** type (not ORO Associate) owns fee-waiver, commercial-rate, and objection approvals.
- **Task-subset assignment** — set by **Sys Admin and ORO Manager globally**, and by the **Fulfillment Manager within their own team**.

## 6. Coverage-gap safety net

There is no monitoring today for "a request needs a task nobody covers" (e.g. it tries to advance from estimate to record search but no one on the team holds Record Search). Rather than a coverage matrix, **email the team manager** the moment it happens.

**Concrete hook:** the central `applyStageTransition` / `spawnForStage` path (built 2026-07-08/09) is exactly the choke point — when it spawns a stage task and `eligibleUsers(team, taskType)` is empty, fire the manager email. A few lines at a spot that already exists.

## 7. Departments, fulfillment teams & staff model (UI rework)

The screens that manage City Departments, Fulfillment Teams, and Staff today are weak and are **directly impacted by this change**. Kevin's model:

**City Departments.** Model the city's org-chart entities explicitly (City Clerk's Office, Police, Parks & Recreation, …). The system does not capture the org chart today; the UI must allow entering city departments.

**Where "Open Records" lives.** A city's Open Records function is usually a **sub-unit of the City Clerk's / City Records Office**, not its own department. If an Open Records Department *does* exist on the org chart, it is listed under Departments and the Open Records Office (team) is associated to it via a Departments dropdown during setup. If it does not exist, the parent office (e.g. City Clerk's) is selected instead.

**Fulfillment teams process requests.** Created in the UI; each is associated with **one or more** departments (e.g. an *Open Records Fulfillment Team* serving City Clerk's Office, Parks & Rec, etc.; a *Police Records Fulfillment Team* serving Police). This department↔team association lives in the **taxonomy** and is what maps a request description to the team that processes it.

**Critical distinction — Open Records *Office* vs Open Records *Fulfillment Team*:**
- The **Open Records Office** = management/administration of all fulfillment. It **does not process requests**, so it must **never appear in the Taxonomy** — nothing routes to it.
- But for **staff assignment**, the Office must be selectable as a "team" (people belong to it) even though it is **not a fulfillment team**. The system doesn't model this today (only fulfillment teams exist); a **default "Open Records Office" team** should exist for staffing purposes only.

**UI consolidation.** Replace today's overloaded multi-panel layout (each of departments/teams/staff on its own thin panel, with little on-screen guidance) with a **single "parent" screen** that manages city departments, teams, and staff together. On-screen guidance/help text matters — it is heavily relied on in demos.

## 8. Smart routing (assignment within teams)

Once a request is **routed to a department**, the next step is **assignment of a task to eligible staff**. Multiple assignment methods exist; one uses AI. Each staff member has a **free-form "smart routing" text box**; the AI matches the request description against the smart-routing text of the eligible members for that task type and assigns the best match. Today Smart Routing is **limited to fulfillment teams** and applies only to **Record Search** and **Redaction**.

**Compatibility concern:** the new user-type / per-person task-subset model must preserve the "eligible staff for this task type on this team" semantics that Smart Routing depends on (`eligibleUsers(team, taskType)`). Flag this as a spot the redesign could break — verify before build.

**Decided 2026-07-09:** the "smart routing" text box and the per-person **specialization text** that the matcher embeds (`user_spec` embeddings) are **one and the same field** — a single free-form text per staff member, not two. `eligibleUsers` is rewritten to resolve against the task-subset model ("on this team **and** their subset includes this task type") rather than the old `user_permission_roles` join.

## 9. What this implies (scope — not free)

- **Data migration:** map existing `function_roles` + `permission_roles` assignments onto the new user types. The interim fee-waiver routing (`FEE_AUTHORITY`, built 2026-07-09) becomes **ORO Finance + "Fee-Waiver Approval" task type**. *Kevin is OK skipping automated migration of existing test data* — most current requests are test entries whose descriptions won't match real records; he will recreate requests manually. So v1 migration effort can be minimal.
- **UI to build:** ~~an **edit-user** screen and a way to pick a person's task-type subset~~ (built 2026-07-09); ~~the consolidated Departments/Teams/Staff parent screen (§7)~~ (built 2026-07-09 as the **Organization** screen — Departments / Fulfillment Teams / Staff tabs, reusing the existing `departments` model; a team serving zero departments is surfaced as "staffing only", realizing the Open Records Office distinction without a schema change). Still to build: config screens for user types / permission groups.
- **Authority + permissions become type properties** in the data model — replacing the second catalog rather than layering on it.
- **Notifications caution:** system notifications already exist in parts of the app (e.g. reminders to update legislative content for fees, redaction, timing). Some task-related notices might better belong on My-Tasks lists. Before build, **audit existing notification code** so the new structure doesn't collide with or silently break it.

## 10. Open questions — resolved 2026-07-09

1. **Director vs Sys Admin split** — **Resolved: yes.** Director holds staff/team management; Sys Admin keeps only connectors/security/auth + technical config.
2. **"Finance" vs "ORO Associate"** — **Resolved:** split out. New **ORO Finance** user type owns financial approvals (fee waiver, commercial rate, and the `objections.js` approvals). Removed from ORO Associate.
3. **Who assigns a person's task subset** — **Resolved:** Sys Admin and ORO Manager **globally**; Fulfillment Manager **for their own team**.
4. **Commercial-rate approval** — **Resolved:** same path/approver as fee waiver (different trigger `purpose='commercial'`); the approver is **ORO Finance**.
5. **Task-type master list** — **Drafted 2026-07-09** in `MASTER_task_types_permission_groups.md` (canonical enumeration: routable task types, MRR tasks, non-routable capabilities, permission groups, and the user-type matrix). Pending review; a few items still open there.

## 11. Next steps

1. ~~Kevin reviews / edits this doc~~ — done; incorporated into v3.
2. ~~Resolve §10 open questions~~ — done (item 5 remains).
3. ~~Write the canonical task-type + permission-group master list~~ — drafted in `MASTER_task_types_permission_groups.md`; review + close its open items.
4. Scope the Departments/Teams/Staff data model + consolidated parent UI (§7).
5. Audit existing notifications (§9) and Smart Routing (§8) for compatibility.
6. Only then: data-model + (light) migration + UI plan, ratify into `SPEC_tasks_roles_mrr_fees.md` §8 and `ARCHITECTURE.md`, and build.
