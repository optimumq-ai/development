# MASTER — Task Types & Permission Groups (canonical enumeration)

**Status:** DRAFT companion to `DESIGN_user_type_role_model.md` (v3), fulfilling that doc's §10.5 / §11.3 ("write the canonical task-type + permission-group master list before build"). Reconciled against code (`backend/src/services/taskRouting.js`, `workflowEngine.js`) and `SPEC_tasks_roles_mrr_fees.md` on 2026-07-09.

**How to read this:** Part A is the complete set of *task types* (the "task menu" axis of the role model). Part B is the complete set of *permission groups* (the "permissions" axis). Part C maps both onto the v3 user types. When this is ratified, the code role columns (`FEE_MANAGER`, etc.) get retired in favour of the user-type + task-type model.

**Build-status legend:** `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DEFERRED]` · `[INTERIM]` (working via a stopgap role, pending reconciliation).

---

## Part A — Task-type master list

A "task type" is one kind of human stop in request processing. Two flavours (design §3a): **routable work** (flows through the workflow engine, lands on a My-Tasks list) and **non-routable capabilities** (never routed; gate UI only).

### A1. Routable task types

| Task type (key) | Display name | Code role today | Target owner (v3 user type) | Trigger / stage | Status |
|---|---|---|---|---|---|
| `estimate` | Estimate Creation | `FEE_MANAGER` | [Team] Fulfillment Staff *(Estimate Creation)*; ORO Associate for MRR | stage `fee_review` (estimate step) | task `[BUILT]`, screen `[BUILT]` |
| `record_search` | Record Search | `SEARCH_AND_TRIAGE` | [Team] Fulfillment Staff *(Record Search)* | stage `record_search` | task `[BUILT]`, screen `[NOT BUILT]` |
| `redaction` | Redaction (simple) | `REDACTION_WORKER` | [Team] Fulfillment Staff *(Simple Redaction)* | stage `redaction_review` / `redaction` | task `[BUILT]`, screen `[NOT BUILT]` |
| `legal_redaction` | Legal Redaction (advanced) | *(new — task-type key)* | ORO Legal Associate; ORO Senior Legal | trigger: `legal_flag` (Director escalation) or `SENSITIVE`/`LEGAL_HOLD` in latest `workflow_decisions.flags`; replaces `redaction` at the redaction stage | routing `[BUILT 2026-07-09]` (team-agnostic, pools to legal staff by subset); dedicated screen `[NOT BUILT]` |
| `legal_review` | Legal Review | *(new — task-type key)* | ORO Senior Legal (+ Legal Associate support) | stage `exemption_review` / `ag_review` | routing `[BUILT 2026-07-09]` (team-agnostic); dedicated screen `[NOT BUILT]` |
| `fee_waiver` | Fee-Waiver Approval | **`FINANCE`** | **ORO Finance** | trigger `fee_waiver_requested`; spawned `onIntake`; team-agnostic (`team_id=NULL`) | task + routing + resolution `[BUILT 2026-07-09]`; role reconciled `FEE_AUTHORITY`→`FINANCE`, orphan `FEE_WAIVER_APPROVER` retired `[2026-07-15]` |
| ~~`routing_review`~~ | Routing Review | *(new — task-type key)* | **ORO Associate** | trigger: classifier could not determine a fulfillment team (`teamId` null); team-agnostic; closed automatically on `PATCH /requests/:id/route` | ⚠️ **RETIRED 2026-07-29 (BW2)** — replaced 1:1 by `intake_review` trigger `unroutable`, same trigger, same role, same auto-close. The key stays in `TASK_ROLES` + the catalog so tasks already in flight remain claimable and resolvable; nothing spawns it any more |
| `intake_review` | Intake Review | *(task-type key)* | **ORO Associate** | trigger-spawned, team-agnostic. Triggers (enum `unroutable` \| `eligibility_review` \| `approval_pending` \| `sensitivity_flag` \| `reopen_retriage`) recorded on the task; `intake_review_mode` = `when_needed` (default) \| `always` | routing `[BUILT 2026-07-29 BW2]`; screen `[NOT BUILT]` (BW3) |
| `mrr_management` | MRR Coordination (parent hub) | *(task-type key)* | **ORO Associate** | spawned on the PARENT at intake when `child_count > 1`; team-agnostic. This is the `mrr_processing` design below, under the name SPEC_processing_ui §8 settled on | routing `[BUILT 2026-07-29 BW2]`; screen `[NOT BUILT]` (BW6 — My Tasks falls back to the request route) |
| `release_review` | Release Review | *(task-type key)* | **ORO Supervisor** *(suggested default; role is meant to be city-configurable)* | ⚠️ **REGISTERED ONLY** — BW5 owns the pipeline that spawns it, BW8 the screen. Assignment excludes the completer of the request's most recent flow task (two-eyes, BW2) | catalog `[BUILT 2026-07-29 BW2]`; spawner `[NOT BUILT]` (BW5) |
| ~~`commercial_rate`~~ | Commercial-Rate Approval | `FINANCE` (target) | **ORO Finance** | trigger `purpose='commercial'` | ✅ **DELETED FROM THE CATALOG 2026-07-19** (`ff32305`, brief §5.4). Was `[DEFERRED]` with the trigger unwired — so it was offerable in the per-person picker and produced a **permanently empty pool**. The design below stands; re-add the key *with* the code that spawns it |

> **`[revised 2026-07-29, BW2]` `ROUTABLE_TASK_TYPES` is now eleven** — the eight below plus `intake_review`,
> `mrr_management` and `release_review` (SPEC_processing_ui §8). The first two ship WITH their spawners in
> BW2, so the "an entry here is a promise the router can deliver that type" rule holds. `release_review` is
> the deliberate exception: its pipeline is BW5's, so between BW2 and BW5 it is routable and unspawned. It
> was registered early so a city can grant and configure it before reviews start arriving; the staff picker
> labels it accordingly. **Retired in the same commit:** `routing_review` (see the row above).
>
> **`[revised 2026-07-19]` `ROUTABLE_TASK_TYPES` is now exactly seven:** `estimate`, `record_search`, `redaction`, `legal_redaction`, `legal_review`, `fee_waiver`, `routing_review`. `commercial_rate` and `mrr_processing` were deleted (§5.4) — an entry there is a **promise the router can deliver that type**, and neither could. A harness (`verify_v1_retirement` §E) now asserts the Staff Management picker offers nothing the router cannot route, because the three catalogs drifted apart precisely by never being compared. **Still unreconciled:** `redaction_qa` is real but absent from `ROUTABLE_TASK_TYPES`.
>
> Note: wired keys in `taskRouting.js` are `estimate`, `record_search`, `redaction`, `fee_waiver`, plus (2026-07-09) `legal_review` and `legal_redaction`. `STAGE_TASK` now maps `record_search→record_search`, `redaction_review|redaction→redaction` (→ `legal_redaction` when the request is legally flagged), and `exemption_review|ag_review→legal_review`. Legal task types are office-level (team-agnostic) and resolve eligibility via `user_task_types`. Remaining unwired: `commercial_rate` (deferred) and the `mrr_*` set.

### A2. MRR task types — two distinct behaviors

The MRR parent is **routed by the system**; the MRR children are **hand-assigned by the Request Manager**. This is the key line: only `mrr_processing` is an eligibility-routed (routable) task type in `ROUTABLE_TASK_TYPES` / the per-person subset picker; the child tasks are not.

| Task type | Display name | Assignment | In per-person subset (`user_task_types`)? | Status |
|---|---|---|---|---|
| ~~`mrr_processing`~~ | MRR Processing (parent management) | **System-routed** to an ORO Associate (Request Manager) when intake detects MRR — eligibility applies | ~~Yes~~ **removed from `ROUTABLE_TASK_TYPES`** | ⚠️ **DELETED FROM THE CATALOG 2026-07-19** (`ff32305`) — **the DESIGN below is unchanged and still governs.** The hub is brief §5 decision 3 and is **still open**; if it is built, re-add this key alongside the code that spawns it. It was removed because nothing spawned it, not because the design was rejected |
| `mrr_estimate` | Multi-Record Request Estimate | **Hand-assigned** by the RM to any person per child (may be a non-user via secure link) — **no eligibility, no team filter, no smart routing** | **No** | `[NOT BUILT]` |
| `mrr_search` | Multi-Record Search | **Hand-assigned** by the RM to any person per child — no routing rules | **No** | task type `[REGISTERED 2026-07-29 BW2]`; screen `[NOT BUILT]` (BW6) |
| `mrr_redaction` | Multi-Record Redaction | **Hand-assigned** by the RM per child — joins the two above, same model | **No** | task type `[REGISTERED 2026-07-29 BW2]`; screen `[NOT BUILT]` (BW6) |

Mechanics: a manual `assign(taskId, userId)` sets the assignee with **no eligibility check** (only *claim-from-pool* checks eligibility), so RM hand-assignment of child tasks needs no special machinery — it simply bypasses the eligibility path. (SPEC §7, §12.1.)

### A3. Non-routable capabilities (gate UI, never routed)

| Capability | Gated by permission group | Held by |
|---|---|---|
| View dashboards | Reporting | every office user type + management |
| Run / export reports | Reporting | every office user type + management |
| City-oversight read-only view | Reporting | City Management (only capability it has) |

---

## Part B — Permission-group master list

Coarse groups (design §5) — legible, not per-button. "Owner" = the type that controls the *content* of the rules; "May" = other types granted the same edit ability; everyone else is view-only or excluded.

| Permission group | What it gates | Owner | May also edit | Explicitly excluded |
|---|---|---|---|---|
| **System Administration** | users/staff, teams, connectors, security/auth, system config | ORO System Administrator | ORO Director/Manager holds the **staff/team-management** subset (design §10.1); Sys Admin keeps connectors/security/auth | — |
| **Workflow & Taxonomy** | the rulebook, record types, categories, department↔fulfillment-team mapping (design §7) | ORO Director/Manager | ORO System Administrator | — |
| **Fee Configuration** | per-page/copy rates, labor rates, min/max fees, de-minimis auto-waive, free allowances, deposit rules, estimate profiles | ORO Director/Manager | ORO System Administrator | — |
| **Legal Rules** | redaction rules, exemptions/citations | **ORO Senior Legal (OWNER)** | ORO Director/Manager (may) | ORO System Administrator (**technical-only**, not rule content); [Team] Fulfillment Supervisor (**explicitly not**) |
| **Reporting** | dashboards, reports (view) | — (view capability) | all office types + City Management | — |

**Core line (design §5):** *do the work vs. set the rules.* A Fulfillment Supervisor or Staff member can perform a redaction task but cannot change the redaction **rules** — that is Legal Rules, owned by Senior Legal.

---

## Part C — User-type → task-menu + permission matrix

Cross-reference of the design §4 catalog against the enumerations above. "Task menu" is the set a person of this type may be assigned a **subset** of (design §3b); Authority and Permissions are fixed per type.

### Office-level

| User type | Task menu (subsettable) | Permission groups |
|---|---|---|
| City Management | *(none)* | Reporting |
| ORO System Administrator | *(none / optional)* | System Administration, Workflow & Taxonomy, Fee Configuration, Reporting — **not** Legal Rules |
| ORO Director / Manager | *(oversight; may act on any)* | Workflow & Taxonomy, Fee Configuration, Legal Rules (may), Reporting, staff/team management |
| ORO Supervisor | *(oversight; may act)* + `release_review` *(suggested default holder; BW2 registers the type, BW5 spawns it)* | Reporting |
| ORO Senior Legal | `legal_review`, `legal_redaction` | **Legal Rules (OWNER)**, Reporting |
| ORO Legal Associate | `legal_redaction`, `legal_review` (support) | Reporting |
| ORO Associate | `intake_review`, `mrr_management` (routable, BW2) + `mrr_estimate`, `mrr_search`, `mrr_redaction` (hand-assigned coordination work) | Reporting |
| **ORO Finance** | `fee_waiver`, `commercial_rate` | Reporting |

### Team-level (per fulfillment team)

| User type | Task menu (subsettable) | Permission groups |
|---|---|---|
| [Team] Fulfillment Manager | *(may do team tasks)* | *(team-scoped staff assignment; no global config)* |
| [Team] Fulfillment Supervisor | *(may do team tasks)* | none — **explicitly not Legal Rules** |
| [Team] Fulfillment Staff | subset of `{estimate, record_search, redaction}` | none |

---

## Decisions (resolved 2026-07-09) & remaining execution

1. **`legal_review` vs `legal_redaction` split — RESOLVED: keep two distinct task types.** `legal_review` = counsel decision (trigger: entry into `exemption_review` / `ag_review`); `legal_redaction` = advanced redaction *work* on flagged records (trigger: `SENSITIVE` classifier flag or Director escalation). Same "do the work vs. make the decision" line as redaction. *Execution:* wire tasks for both — neither is built today (`ATTORNEY_REVIEWER` exists but is unwired; the legal stages spawn no task).
2. **Retire the interim code roles — SETTLED (mechanical).** `FEE_MANAGER / SEARCH_AND_TRIAGE / REDACTION_WORKER / FEE_AUTHORITY / ATTORNEY_REVIEWER` become *derived* from (user type + task subset), not assigned. Migration item (design §9); no decision. **Progress:** the fee role is reconciled — `FEE_AUTHORITY`→`FINANCE`, and the orphan function role `FEE_WAIVER_APPROVER` retired `[2026-07-15, D4 §8 item 9]`. The rest (FEE_MANAGER/SEARCH_AND_TRIAGE/REDACTION_WORKER/ATTORNEY_REVIEWER) and the two-catalog collapse remain follow-on slices.
3. **`commercial_rate` wiring — SETTLED (deferred).** When built, same path/approver as `fee_waiver` → ORO Finance (design §10.4). Consistent with the existing `objections.js` approval gate.
4. **Smart-routing eligibility — RESOLVED: unify the text.** The per-person specialization text that Smart Routing embeds/matches (`user_spec` embeddings in `taskRouting.js`) is the **same** free-form "smart routing" box in design §8 — one field per staff member, not two. *Execution:* rewrite `eligibleUsers(team, roleName)` to resolve against the new model — "on this team **and** task-subset includes this task type" — instead of the `user_permission_roles` JOIN, without regressing the embedding rank. Applies to `record_search` and `redaction` today.
5. **Non-routable capabilities — RESOLVED: Reporting-only for v1.** No separate gate for bulk export, audit-log view, or un-redacted-original access in v1; add on demand (consistent with the "assign an extra user type if really needed" philosophy, design §3c). Revisit un-redacted-original access if a legal need surfaces.
