# DESIGN — User-Type Role Model (v2 proposal)

**Status:** DRAFT / proposal, pending ratification. Not yet a contract. If adopted, this replaces the current two-catalog role setup and updates `SPEC_tasks_roles_mrr_fees.md` §8 + the `ARCHITECTURE.md` "one task-routing role catalog" invariant.
**Authors:** Kevin (concept), Claude (structure/analysis). Started 2026-07-09.

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
- **Routable work** — estimate, record search, redaction, fee-waiver approval, legal review, MRR tasks. These flow through the workflow engine and land on My-Tasks lists.
- **Non-routable capabilities** — view dashboards, run reports. Never routed; just gate UI. Same picker, different behavior. (Covers City Management, and the reporting side of every type.)

### 3b. Per-person subsetting
Only the **task-type subset** is chosen per person — because that is the only thing that genuinely varies within a position. Example: a fulfillment team with 12 people, all "Team Staff," some doing only estimates, some only redaction, some all three. Authority and permissions do **not** vary per person; they are properties of the user type.

### 3c. Multiple user types per person (and the exception mechanism)
A person may hold more than one user type. This handles small cities (one person is Team Supervisor **and** Team Staff doing redaction), and it **is the built-in exception mechanism** for permissions: if a Team Supervisor genuinely needs to edit fee profiles, give them the office user type that carries that permission — no special per-person override machinery in v1.

## 4. User-type catalog

Office-level types are **team-agnostic** (cross-cutting). Team-level types are **per fulfillment team** (prefixed with the team name). "Authority" and "Permissions" columns are properties of the type; "Task menu" is the set a person of this type can be assigned a subset of.

### Office-level

| # | User type | Task menu | Authority | Permission groups |
|---|---|---|---|---|
| 1 | **City Management** | *(none — never processes requests)* | none | Reporting |
| 2 | **ORO System Administrator** | *(none / optional)* | system (users, teams) | System Administration, Workflow & Taxonomy, Fee Configuration, Reporting — **not** Legal Rules (technical-only) |
| 3 | **ORO Director / Manager** | *(oversight; may act on any)* | highest operational — reassign/re-route/override/escalate/reopen across all teams | Workflow & Taxonomy, Fee Configuration, **Legal Rules (may)**, Reporting, staff/team management |
| 4 | **ORO Supervisor** | *(oversight; may act)* | operational — reassign/re-route, escalate | Reporting |
| 5 | **ORO Senior Legal** (city attorney) | Legal Review, (Legal Redaction) | legal decisions (AG, exemptions) | **Legal Rules (OWNER)**, Reporting |
| 6 | **ORO Legal Associate** | Legal Redaction (advanced), Legal Review support | none special | Reporting |
| 7 | **ORO Associate** | Fee-Waiver Approval, MRR (estimate/search/processing coordination) | (MRR request-management) | Reporting |

### Team-level (per team)

| # | User type | Task menu | Authority | Permission groups |
|---|---|---|---|---|
| 8 | **[Team] Fulfillment Manager** | *(may do team tasks)* | reassign within team; **receives coverage-gap emails**; assigns staff task subsets | *(team-scoped staff assignment; no global config)* |
| 9 | **[Team] Fulfillment Supervisor** | *(may do team tasks)* | reassign/assist within team | none — **explicitly not Legal Rules** |
| 10 | **[Team] Fulfillment Staff** | subset of {Estimate Creation, Record Search, Simple Redaction} | none | none |

## 5. Permission groups (coarse, to stay legible — not per-button)

- **System Administration** — users/staff, teams, connectors, security/auth, system config
- **Workflow & Taxonomy** — the rulebook, record types, categories
- **Fee Configuration** — rates, estimate profiles, thresholds
- **Legal Rules** — redaction rules, exemptions/citations
- **Reporting** — dashboards, reports (view)

**Decisions locked (2026-07-09):**
- **Legal Rules** — **Senior Legal owns**, **Director may**, **Sys Admin technical-only** (not the owner of rule content). So a **Team Supervisor can *do* a redaction task but cannot *change the rules* for it** — the core "do the work vs. set the rules" line.
- **Permissions strictly by user type in v1**; exceptions handled by assigning an additional user type (§3c).

## 6. Coverage-gap safety net

There is no monitoring today for "a request needs a task nobody covers" (e.g. it tries to advance from estimate to record search but no one on the team holds Record Search). Rather than a coverage matrix, **email the team manager** the moment it happens.

**Concrete hook:** the central `applyStageTransition` / `spawnForStage` path (built 2026-07-08/09) is exactly the choke point — when it spawns a stage task and `eligibleUsers(team, taskType)` is empty, fire the manager email. A few lines at a spot that already exists.

## 7. What this implies (scope — not free)

- **Data migration:** map existing `function_roles` + `permission_roles` assignments onto the new user types. The interim fee-waiver routing (`FEE_AUTHORITY`, built 2026-07-09) becomes **ORO Associate + "Fee-Waiver Approval" task type**.
- **UI to build:** an **edit-user** screen (currently there is only add-staff, no edit), and a way to pick a person's task-type subset. Config screens for user types / permission groups.
- **Authority + permissions become type properties** in the data model — replacing the second catalog rather than layering on it.

## 8. Open questions

1. **Director vs Sys Admin split** — does Director hold staff/team management (part of System Administration), with only connectors/security reserved to Sys Admin? (Assumed yes above.)
2. **"Finance" vs "ORO Associate"** — the old spec named a **Finance** role for fee-waiver / commercial-rate / objection approvals. This model folds financial approval into **ORO Associate**. Is that right, or does money need its own authority (Director sign-off)? Note `objections.js` approvals also reference this.
3. **Who assigns a person's task subset** — Team Manager for their own team, Sys Admin globally, both?
4. **Commercial-rate approval** — same task type as fee waiver, different trigger (`purpose='commercial'`); confirm it's an ORO Associate task too.
5. **Task-type master list** — this doc lists the ones in play; a complete canonical enumeration (routable + capabilities) is still to be written before build.

## 9. Next steps

1. Kevin reviews / edits this doc (push back via the repo).
2. Resolve §8 open questions.
3. Write the canonical task-type + permission-group master list.
4. Only then: data-model + migration + UI plan, ratify into `SPEC_tasks_roles_mrr_fees.md` §8 and `ARCHITECTURE.md`, and build.
