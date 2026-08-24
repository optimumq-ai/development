# SPEC — User-Type Model (v3, build contract)

**Status:** **RATIFIED 2026-08-24** (Kevin: "go — ratify the spec and build S1"). This is the contract. It
supersedes `SPEC_tasks_roles_mrr_fees.md` §8 (roles) and `ARCHITECTURE.md` §4 ("one role catalog") is rewritten to point here.
**Build status:** **S1 BUILT 2026-08-24** (`verify_user_types`, see §12) — tables + catalog seed, cutover, derived claims, `auth_version`.
S2–S6 open. As-built notes that differ from the draft are marked *(as built)* inline.
**Sources:** `DESIGN_user_type_role_model.md` (v3, Kevin's concept, decisions of 2026-07-09),
`MASTER_task_types_permission_groups.md` (canonical enumerations), `WORKING_setup_inventory.md` (hub
decisions of 2026-08-24), and a code survey of 2026-08-24 (§2).
**Scope rule (Kevin, 2026-08-24):** no stopgap. This model is built for real, once, and the setup hub is
built on it. No gating ships on derived team membership.

---

## 1. What this spec settles

1. **One catalog.** A `user_types` catalog replaces BOTH legacy catalogs (`function_roles`,
   `permission_roles`) as the thing management assigns. Nothing is assigned per person except
   (a) user types and (b) the task-type subset the design already made per-person.
2. **Three axes, each answering one question** (design §3), all derived from the person's user types:
   - **Task menu** → routing (already live via `user_task_types`; this spec only constrains the picker).
   - **Authority** → what may I do to requests/tasks I don't own (reassign, override, go-live, …).
   - **Permission groups** → what configuration may I change (the setup hub's lanes).
3. **"In the ORO" is a fact in the data:** a person is in the Open Records Office iff they hold at
   least one **office-level** user type. That is the answer to the hub's lane-2/3 ownership question —
   no team-membership inference.
4. **The gate primitives** the routes migrate onto: `requirePermission(group)`,
   `requireAuthority(key)`, plus the existing per-request `requireRequestAct`.
5. **The migration** off the two legacy catalogs, including the compatibility period during which
   46 legacy `requireRole` call sites keep working unchanged.

---

## 2. Where the code is today (survey 2026-08-24 — the facts the design must fix)

| Fact | Evidence |
|---|---|
| Two catalogs, DB-seeded (SQLite `schema.sql:7-16`; the Postgres schema carries the tables but **not** the seed rows) | `backend/src/db/schema.sql` |
| 9 function roles; only 6 are checked anywhere. **CUSTODIAN, REDACTION_REVIEWER, REDACTION_APPROVER: 0 call sites.** COORDINATOR: 4 | grep of `backend/src` |
| Two roles are checked that exist in **no catalog** — `ORO_SUPERVISOR`, `RECORDS_MANAGER` (dead gates; nobody can pass them) | `routes/mrr.js:22`, `routes/parentFinance.js:22` |
| 11 permission roles; **every new user is granted all 11 unconditionally** at creation, and there is no route or UI to change them afterwards. Every `requireRoleOrPerm` perm branch is therefore a no-op for app-created users — including FINANCE | `routes/staff.js:40-41` |
| **No route to edit a user's function roles after creation** (frontend roster shows them read-only) | `routes/staff.js` PATCHes; `StaffManagementPage.js:262` |
| Roles and perms are minted into the 8h JWT; a change takes effect at next login | `services/auth.js:11-17` |
| `SYSTEM_ADMIN` short-circuits every gate | `middleware/auth.js:21,38` |
| There is **no teams table**: a team is a `departments` row with `kind='team'`; membership is `users.department_id` (one team per person) | `routes/departments.js`, `staff.js:53` |
| Hub gating gaps: fee_profiles writes, departments/teams writes, agent-rules writes = `requireAuth` only; settlement webhook = shared secret, non-constant-time compare | `feeProfiles.js:45,95,116`; `departments.js:13,26,44`; `agentRules.js:14,26,36`; `settlement.js:42` |
| Go-live flip = `SYSTEM_ADMIN` only; attest scope drawn inline by role name | `jurisdictionProfile.js:13-14,16-26,112` |
| Routing already runs on the per-person subset (`user_task_types`); permission roles are endpoint gates only | SPEC_tasks_roles_mrr_fees §8, cutover 2026-08-13 |

---

## 3. The catalog (data, not code)

Eleven user types, exactly the design §4 list. `scope` says whether the type is held office-wide or
against one fulfillment team.

| key | Display name | scope |
|---|---|---|
| `city_management` | City Management | office |
| `oro_sysadmin` | ORO System Administrator | office |
| `oro_director` | ORO Director / Manager | office |
| `oro_supervisor` | ORO Supervisor | office |
| `oro_senior_legal` | ORO Senior Legal | office |
| `oro_legal_associate` | ORO Legal Associate | office |
| `oro_associate` | ORO Associate | office |
| `oro_finance` | ORO Finance | office |
| `team_manager` | [Team] Fulfillment Manager | team |
| `team_supervisor` | [Team] Fulfillment Supervisor | team |
| `team_staff` | [Team] Fulfillment Staff | team |

The catalog is **seeded data with a fixed key set**. v1 ships no "create a user type" screen: the
keys are referenced by code (`requireAuthority`, coverage emails, hub lane ownership), so adding one is
a code change. Display names are editable per city (the design's "model terms, not job titles" note).

### 3.1 Tables

```sql
user_types            (id TEXT PK, key TEXT UNIQUE, display_name TEXT, scope TEXT CHECK(scope IN ('office','team')), sort_order INT, active INT DEFAULT 1)
user_type_task_menu   (user_type_id, task_type)          -- the menu a person of this type may be given a subset of
user_type_authority   (user_type_id, authority_key)      -- §4
user_type_permission  (user_type_id, permission_group)   -- §5
user_user_types       (user_id, user_type_id, team_id NULL, PRIMARY KEY (user_id, user_type_id, team_id))
                      -- team_id REQUIRED when scope='team' (references departments.id, kind='team'), NULL when 'office'
```

`user_task_types` (existing) is unchanged; §6 constrains what it may contain.

*(as built, S1)* `user_user_types` carries `assigned_by`, `assigned_at`, and its uniqueness is a UNIQUE index on
`(user_id, user_type_id, COALESCE(team_id,''))` — a Postgres PRIMARY KEY cannot hold the NULL `team_id` an
office type needs. Catalog ids are `ut-<key>`. The tables and catalog rows are seeded by `schema.postgres.sql`
(applied at API boot, idempotent) and carried by `seed_fixture.sql`. The compat shim's type→legacy-perm mapping
is also a small seeded table, `legacy_perm_map`, so the task-pool SQL predicate can join it; it is dropped in S5
with the shim. `services/userTypes.js` holds the spec's tables as constants (`CATALOG`, `AUTHORITY`,
`PERMISSION`, `TASK_MENU`, `LEGACY`) and `verify_user_types` A4 fails if the seeded tables ever differ from them.

Legacy `function_roles`, `permission_roles`, `user_function_roles`, `user_permission_roles`: kept
through the compatibility period (§9), then dropped.

---

## 4. Authority axis

Authority keys are a closed set; each is a property of a user type. They answer "what can I do to
work I don't own". They are NOT configuration rights (that is §5).

| authority_key | Means | Held by |
|---|---|---|
| `act_any_request` | act on any request/task regardless of assignment (the current `ACTING_ROLES` behaviour) | oro_director, oro_supervisor, oro_associate *(MRR/intake coordination)* |
| `reassign_any` | reassign / re-route tasks across all teams | oro_director, oro_supervisor |
| `reassign_team` | reassign / assist within own team | team_manager, team_supervisor |
| `override_stage` | manual stage moves, reopen, override engine decisions | oro_director |
| `escalate` | escalate to legal / director | oro_director, oro_supervisor, team_manager |
| `legal_decision` | AG rulings, exemption assertions, legal review outcomes | oro_senior_legal |
| `financial_approval` | fee waiver, commercial rate, fee objections (today's `FINANCE`) | oro_finance, oro_director |
| `assign_task_subsets_global` | set anyone's task subset | oro_sysadmin, oro_director |
| `assign_task_subsets_team` | set task subsets within own team | team_manager |
| `manage_users` | create/deactivate accounts, assign user types | oro_sysadmin, oro_director |
| `system` | technical administration acts (connectors, keys, auth policy) | oro_sysadmin |
| `go_live` | flip enforcement from simulated to real | **oro_sysadmin, oro_director** *(Kevin 2026-08-24)* |

Rules:
- `SYSTEM_ADMIN` no longer short-circuits every gate. `oro_sysadmin` holds exactly the authorities and
  permissions listed here; in particular it does **not** hold `legal_decision` or the Legal Rules group.
  (Today's "SysAdmin passes everything" is the single biggest reason the two catalogs drifted.) **Confirmed Kevin 2026-08-24.** The demo admin account is seeded with BOTH `oro_sysadmin` and `oro_director` so it keeps its reach.
- `oro_director` is the operational superset. It deliberately lacks `system` and `legal_decision`.

---

## 5. Permission groups (configuration rights) — and the hub lanes

Six groups. Five are the master list's; **Operations Configuration** is new, added because the hub
decisions of 2026-08-24 need a group that "anyone in the ORO plus fulfillment team supervisors" holds.

| permission_group | Gates (hub items) | Held by |
|---|---|---|
| `legal_rules` | Lane 1 legal sections: 1.3 deadlines, 1.8 exemptions & appeals, 1.9 redaction rules library; attest on those | **oro_senior_legal (owner)**, oro_director (may) |
| `compliance_policy` | Lane 1 non-legal items: 1.1 state, 1.4 statutory fees, 1.5 deposits, 1.6 waiver policy, 1.7 clarification, 1.10 city choices, 1.11 statutory updates (upload/apply) | oro_director, oro_sysadmin *(propose/edit; attest stays with §4 rules)* |
| `operations_config` | Lanes 2a + 2b + 3: 2.1–2.13, 3.2–3.5 (rates, sandbox, taxonomy catalog, calibration, routing rules, time budgets, time-tracking, notifications, redaction automation, release switches, layout templates, decision reasons, bulk schedule; departments, teams, staff records, record ownership) | **every office-level type except city_management**, plus team_manager and team_supervisor *(confirmed Kevin 2026-08-24: "anyone in ORO or a fulfillment team manager or supervisor")* |
| `fee_configuration` | *(subset marker within operations_config — 2.1, 2.2)* kept as its own group so a city can narrow it later without a schema change | same as operations_config in v1 |
| `system_admin` | Lane 4: 4.1 connectors, 4.2 AI keys, 4.3 AI deployment, 4.4 email, 4.5 auth policy, 4.6 portal agent rules, 4.7 settlement | oro_sysadmin |
| `reporting` | dashboards, reports (view) | all office types incl. city_management; team_manager |

**Owner vs may.** `legal_rules` keeps the owner/may distinction the go-live checklist already prints
(attestation names). Everywhere else "held" = may edit.

**Staff records (3.4) split.** Editing a person's *profile/team/specialization/task subset* is
`operations_config` (+ §4 `assign_task_subsets_*`); creating accounts and assigning **user types** is
authority `manage_users` (sysadmin/director). So an ORO Associate can fix a colleague's routing text but
cannot make anyone a Director.

**Lane header ownership on the hub** therefore reads from data:
- Lane 1: `compliance_policy` ∪ `legal_rules` holders; legal items show the `legal_rules` owner name.
- Lanes 2a/2b/3: `operations_config` holders.
- Lane 4: `system_admin` holders.
- Go-live: `go_live` authority.

---

## 6. Task-menu axis (constraint on the existing picker)

`user_task_types` stays the per-person subset the router already uses. New rule enforced by the staff
API and the picker: **a person may only be granted task types that appear in the menu of at least one
user type they hold** (union of menus). Menus (from the master list Part C, keys as in
`ROUTABLE_TASK_TYPES` today):

| user type | task menu |
|---|---|
| city_management | — |
| oro_sysadmin | — |
| oro_director | *(any — oversight)* |
| oro_supervisor | release_review, close_approval, process_withdrawal |
| oro_senior_legal | legal_review, legal_redaction |
| oro_legal_associate | legal_redaction, legal_review |
| oro_associate | intake_review, mrr_management *(+ hand-assigned mrr_* work, not granted)* |
| oro_finance | fee_waiver *(commercial_rate when its spawner exists)* |
| team_manager / team_supervisor | estimate, record_search, redaction, redaction_qa |
| team_staff | estimate, record_search, redaction, redaction_qa |

Team-level grants are still team-scoped by `users.department_id` as today (§2: one team per person).
`eligibleUsers(team, taskType)` is unchanged by this spec — it already resolves on the subset.

**Coverage-gap email** (design §6): when `spawnForStage` finds an empty pool for (team, type), email
every `team_manager` of that team (fallback: `oro_director`). Small; ships in slice S6.

---

## 7. Gate primitives

```js
requireAuthority(key)                 // 403 unless req.user.authorities includes key
requirePermission(group)              // 403 unless req.user.permissionGroups includes group
requireAnyPermission(...groups)
requireRequestAct({...})              // unchanged; ACTING_ROLES becomes authority act_any_request
```

`req.user` gains `userTypes: [{key, teamId}]`, `authorities: []`, `permissionGroups: []`,
`inOro: bool` (any office-level type). Minted at login from the tables in §3.1.

**Token freshness.** Roles currently live in an 8h JWT. This spec adds `users.auth_version`
(incremented on any user-type/subset change) and a claim `av`; `requireAuth` rejects a token whose
`av` is stale (one indexed read per request, cached 60s). A user-type change therefore takes effect
within a minute, not at next login. This is required for deactivation and for the hub's lane gates to
be trusted.

**Frontend.** `authStore` exposes `hasAuthority`, `hasPermission`, `inOro`. `AppLayout`'s `isElev` and
the page-level role checks (§2 list) move onto these. The Staff screen stops offering function-role
chips.

---

## 8. Route migration map (what each gate becomes)

| Surface | Today | After |
|---|---|---|
| fee_profiles writes (`feeProfiles.js:45,95,116`) | requireAuth | `requirePermission('fee_configuration')` |
| departments / teams writes (`departments.js:13,26,44`) | requireAuth | `requirePermission('operations_config')` |
| staff: create account, set user types (`staff.js` POST + new PATCH `/:id/user-types`) | requireRole(SA/DIR/SUP) | `requireAuthority('manage_users')` |
| staff: profile/team/specialization/task-types PATCHes | requireRole(SA/DIR/SUP) | `requirePermission('operations_config')` + subset scope check (`assign_task_subsets_global` or `_team` for own team) |
| agent rules (`agentRules.js:14,26,36`) | requireAuth | `requirePermission('system_admin')` |
| settlement webhook (`settlement.js:39`) | shared secret, `!==` | unchanged model (machine endpoint); compare with `crypto.timingSafeEqual`; secret required at boot when ERP mode is on. Not a user gate. |
| go-live flip (`jurisdictionProfile.js:112`) | requireRole(SYSTEM_ADMIN) | `requireAuthority('go_live')` |
| attest legal sections (`:43,48`) | ATTEST + inline scope | `requirePermission('legal_rules')`; owner name printed from the holder's type |
| attest / propose non-legal (`:66,91`) | DIRECTOR/SA inline | `requirePermission('compliance_policy')` |
| `/fee-waiver-decision`, objections, parentFinance, decisionReasons | requireRoleOrPerm(…, FINANCE) | `requireAuthority('financial_approval')` |
| mrr.js:22 / parentFinance.js:22 dead roles | ORO_SUPERVISOR / RECORDS_MANAGER (unpassable) | `requireAuthority('act_any_request')` / `financial_approval` |
| `requireRedactionWork` (26 sites), `requireRequestWork`, `requireTaxonomyEdit` | role/perm presets | presets re-implemented on the new claims; call sites untouched |
| every other `requireRole(...)` (~43 sites) | role names | **compat period:** unchanged (§9 mints legacy `roles` from user types); then migrated file-by-file to authority/permission |
| Menu / page checks (frontend, §2) | `hasAnyRole` | `hasPermission` / `hasAuthority` |

---

## 9. Migration and compatibility

**Decision (Kevin, 2026-08-24): no data migration.** Existing role data has no value beyond the
users' names. The cutover therefore *wipes* role assignments rather than mapping them:

1. `users` rows are **kept** (names, emails, passwords, teams, specialization text, `user_task_types`).
2. `user_function_roles` and `user_permission_roles` are **emptied**. No user-type is inferred for anyone.
3. A bootstrap seed assigns `oro_sysadmin` + `oro_director` to the seeded admin login
   (`kruss@optimumq.ai`, `seed_testers.sql`) so someone can sign in and assign everyone else through
   Staff Management (S3). Until then no other user holds any type: they can log in and see only what
   an untyped user sees (nothing gated). This is acceptable — Kevin will re-set every user by hand
   after the build, and may instead choose to delete and recreate all users.
4. `user_task_types` rows that fall outside the union of a person's type menus (§6) are left in place
   but **ignored by the router** until a matching type is assigned; the picker shows them as "not
   covered by a user type" so they can be cleaned up. *(S3 — not yet enforced in S1.)*

*(as built, S1)* The cutover is `src/db/user_types_cutover.js` (dry-run default, `--apply` to run; idempotent;
also bumps every user's `auth_version` so legacy-minted tokens die at once). The **demo/fixture accounts**
(`seed_test_staff.sql`, `seed_testers.sql` — not real people) are typed by `seed_user_types_demo_staff.sql`
so the suite has typed actors: testers → oro_sysadmin + oro_director; team supervisors → team_supervisor;
finance/IT supers → team_manager (Robert Cho also oro_finance); David Okafor → oro_senior_legal; staff →
team_staff. The five real accounts hold no type until re-set by hand, exactly as item 3 says.

### 9.1 Derived legacy claims (compat shim, deleted in S5)

Untouched legacy `requireRole` / `requireRoleOrPerm` call sites keep working during S2–S4 because
the legacy `roles` and `perms` claims are **derived from user types** at login:

| user type | legacy `roles` minted | legacy `perms` minted |
|---|---|---|
| oro_sysadmin | SYSTEM_ADMIN | all except FINANCE |
| oro_director | DIRECTOR | all |
| oro_supervisor | SUPERVISOR | REQUEST_MANAGER, DELIVERY_AND_CLOSURE, CLARIFICATION_SENDER, ESCALATION_HANDLER, REQUEST_REOPENER |
| oro_senior_legal | ATTORNEY_REVIEWER | DENIAL_AND_LEGAL, REDACTION_AUTHORITY |
| oro_legal_associate | — | REDACTION_WORKER, DENIAL_AND_LEGAL |
| oro_associate | COORDINATOR | REQUEST_MANAGER, SEARCH_AND_TRIAGE, CLARIFICATION_SENDER |
| oro_finance | — | FINANCE |
| team_manager | DEPT_MANAGER | SEARCH_AND_TRIAGE, REDACTION_WORKER, FEE_MANAGER |
| team_supervisor | SUPERVISOR | same as team_manager |
| team_staff | — | SEARCH_AND_TRIAGE, REDACTION_WORKER, FEE_MANAGER |

This is where the **grant-all bug is fixed**: perms come from type, never from "every row in
permission_roles". The `SYSTEM_ADMIN` short-circuit in `middleware/auth.js` is retired in S4; until
then the shim's `SYSTEM_ADMIN` claim still trips it for legacy sites only — the new primitives never
consult legacy claims.

### 9.2 Sequence

1. Add tables + seed catalog (no behaviour change).
2. Empty the two legacy assignment tables; seed the bootstrap admin (§9 item 3).
3. Switch claim minting to §9.1 (legacy claims now derived). Run the full suite (1790) + `verify_user_types`.
4. Land the hub-gap gates (§8 rows 1–7) on the new primitives. **This is the point the hub build is unblocked.**
5. Migrate remaining call sites file-by-file; delete the shim and the four legacy tables.

## 10. UI

1. **Staff Management** — replace function-role chips with a **User types** picker: office types as
   chips; team types as chips that require a team (defaults to the person's team). Editable after
   creation (new PATCH). Task-subset picker filtered to the union of the person's type menus (§6);
   types with an empty menu hide the picker. Gated per §8.
2. **User types** admin page (Administration → User types): read-only matrix of type × authority ×
   permission group × task menu, with editable display names. Exists so a city can *see* the model
   during demos; editing the matrix is out of v1.
3. **Organization** screen: the team "View staff" popup shows each member's team-level types.
4. Hub lane headers and the go-live row read owners from §5 (built in the hub slice, not here).

---

## 11. Verification

`backend/tests/verify_user_types.js`:
- catalog seeded, 11 types, menus/authorities/groups match §4–§6 exactly (table-driven from this spec).
- wipe + bootstrap per §9: legacy assignment tables empty, seeded admin holds oro_sysadmin + oro_director; idempotent.
- derived claims per §9.1; **diff report**: for every existing user, legacy-claims-before vs derived-after — any lost role/perm listed.
- each §8 gate: allowed type passes, non-holder gets 403, oro_sysadmin refused on `legal_rules` and `legal_decision`.
- go-live: oro_director passes, oro_sysadmin passes, oro_supervisor 403.
- token freshness: user-type change → old token rejected within the cache window.
- picker constraint: granting a task type outside the menu union → 400.
- settlement compare is timing-safe (unit).
Plus the existing 20 role-touching harnesses stay green through steps 3–5.

---

## 12. Slices (build order — each a session, each committed green)

| # | Slice | Unblocks |
|---|---|---|
| S1 | **BUILT 2026-08-24.** Tables, seed, wipe + bootstrap script, claim minting with §9.1 shim, `auth_version`, `verify_user_types` parts 1–3, 6. Also (needed to keep the suite green): the four non-auth readers of the legacy tables (`taskRouting` pool predicate + legacy fallback, `objections` supervisor finder, `coverageGap`, `importIngest`) now resolve legacy names through user types; `POST /staff` no longer grants every permission role; 16 harnesses grant user types via `tests/userTypeHelpers.js` instead of inserting legacy rows | — |
| S2 | Gate primitives; §8 rows 1–7 (hub gaps + go-live + attest); frontend `hasPermission/hasAuthority`; `verify_user_types` parts 4–5, 8 | **Hub build** |
| S3 | Staff Management user-type picker + PATCH; picker constraint; User-types admin page | Hub 3.4 |
| S4 | Migrate remaining `requireRole` sites (17 route files) + frontend checks; retire `SYSTEM_ADMIN` short-circuit | — |
| S5 | Delete shim + legacy tables + `FUNCTION_ROLES` frontend constant; ARCHITECTURE §4 + SPEC_tasks_roles §8 rewritten | — |
| S6 | Coverage-gap email | — |

---

## 13. Questions — RESOLVED (Kevin, 2026-08-24)

1. **ORO Finance holders:** moot — no migration. Existing role data is discarded (names kept); Kevin
   re-assigns user types by hand after the build, or deletes and recreates users. §9 rewritten.
2. **oro_supervisor task menu** = `release_review`, `close_approval`, `process_withdrawal` — confirmed.
3. **`operations_config` holders** = anyone in the ORO (every office type except City Management) plus
   fulfillment team managers and supervisors — confirmed as drafted.
4. **SysAdmin universal bypass removed** — confirmed, technical-only. Demo admin gets both
   `oro_sysadmin` and `oro_director`.
5. **DEPT_MANAGER mapping:** moot (no migration).

Ratification = Kevin's go on S1.
