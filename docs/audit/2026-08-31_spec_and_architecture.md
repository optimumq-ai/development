# TRIAGE — spec / architecture drift after the 2026-08-30 screen migration

Audit date 2026-08-30. Read-only. Scope: ARCHITECTURE invariants; SPEC_setup_hub, SPEC_jurisdiction_configuration,
SPEC_fees_estimates_payments, SPEC_user_type_model, SPEC_processing_ui (screen 5 only), DOMAIN_MAP index; docs naming
retired screens. Every item cites `file:line`.

---

## ⚠️ Concurrency caveat — read this first

**The repo was clean at `9f30943` when this audit started and is NOT clean now.** Between 05:33 and 05:34
(this audit finished 05:35) a **concurrent session** edited 18 files, deleted 3, and added
`backend/tests/audit/` + `backend/tests/verify_golden_setup.js`. None of those edits are mine — this audit
was read-only and touched nothing under `/opt/optimumq`. Every finding below was read against the working
tree as it stood, so **a handful of Part 3 / Part 2F line citations are already stale.**

That session is closing the same Part 3 list, in order. **Already fixed in the (uncommitted) working tree:**

| Finding | Status |
|---|---|
| `services/helpAgent.js:14,17-25` (both HIGH) | **CLOSED** — the nav text now names the two Administration tabs and every `/setup/*` door. |
| `docs/AI_DATA_TOUCHPOINTS.md:11` | **CLOSED** — → "Administration → Settings and Configuration → AI configuration". |
| `docs/PROMPT_INJECTION_DEFENSE.md:3` | **CLOSED** — → "… → AI configuration → AI Portal Security Information". |
| `docs/SPEC_jurisdiction_configuration.md:24` | **CLOSED** — → "the Fee rules screen (`/setup/fee-law`; the v1 Fee Configuration screen was retired 2026-08-30)". |
| `docs/SPEC_user_type_model.md:350` | **CLOSED** — → "`/setup/user-types`, reached from Organization → Staff → View user types". |
| `docs/DOMAIN_MAP.md:44` | **CLOSED** — → "six lanes of 34 counted items … Administration → Settings and Configuration". |
| `docs/DOMAIN_MAP.md:75` | **CLOSED** — → `Pages: RecordSourcesPage`. |
| `docs/DOMAIN_MAP.md:84` | **CLOSED** — `AIDataFlowPage` removed. |
| `docs/SPEC_jurisdiction_configuration.md:20` (2B-A3, `SetupPage.js` is dead code) | **ACTED ON** — `frontend/src/pages/SetupPage.js` is deleted (staged). The spec sentence itself is untouched, so 2B-A3 still stands as spec drift. |

**Still open, and one made WORSE:** `docs/DOMAIN_MAP.md:80` had `ConfigurationPage` removed but still reads
`Pages: JurisdictionProfilePage, SetupPage, RuleUpdatesPage` — and `SetupPage.js` has now been **deleted**,
so that pointer is freshly wrong rather than merely stale. Untouched: `DOMAIN_MAP.md:51`
(`WorkflowSimulatorPage`), `:58,61` (fees spec pointer + "NOT yet consolidated"), `:60` (`FeeConfigPage`),
`:65` ("record-search task screen NOT BUILT"), `:69` (`RedactionReviewPage`), `:88` (`SecurityPage`).

**Nothing in Part 1 or in Parts 2A–2E has been touched by that session** — every invariant violation and
every other spec-drift item below is live as written. Re-run `git diff` before acting on any Part 3 row.

---

## Part 1 — Architecture invariants

### 1a. ONE request-creation helper — **1 VIOLATION**

Grep: `grep -rn "INTO requests" --include=*.js backend/src` → 4 hits.
3 are inside the helper (`services/requestCreate.js:287,300,316`). The 4th is not.

| Sev | Item |
|---|---|
| **HIGH** | `backend/src/services/connectors/nena911.js:52` — `INSERT INTO requests (…, stage, status, …) VALUES (…, 'delivery', 'active')`, creating the `req-911-proactive` / `SYS-911-PROACTIVE` row directly. This bypasses `services/requestCreate.js` entirely: no wrap-in-parent, no numbering, no deadline, no defaults. `docs/ARCHITECTURE.md:29` (item 5) names **connectors** explicitly as a path that must call the one helper. It is also an item-7 violation (`docs/ARCHITECTURE.md:37`, "never direct INSERTs into mid-pipeline states") — the row is born at `stage='delivery'`. |

Contributing evidence: `backend/src/services/connectors/nena911.js:90` hangs `request_files` off the same pseudo id;
`backend/src/db/purge_test_requests.js:29` protects it as one of three permanent pseudo-requests;
`backend/src/services/reportEngine.js:14` has to carry `BASE_EXCL = "r.request_number NOT LIKE 'SYS-%' AND r.request_number <> 'LIBRARY'"`
to keep them out of every metric — the cost of the bypass, paid in every report.

### 1b. ONE central stage-transition function — **CLEAN**

Grep: `grep -rn "UPDATE requests" --include=*.js backend/src | grep -i stage` → 6 hits, 5 of which are *comments*
saying "no caller may do this". The single real write is
`backend/src/services/taskRouting.js:668`, inside `applyStageTransition()` (defined at `services/taskRouting.js:607`),
which writes `request_history` (`:672`), cancels the leaving stage's stale tasks (`:695`) and calls
`spawnForStage` (`:700`). It also carries the branch-profile backstop (`:619`) and the from-closed guard (`:655`).

Checked the one dynamically-built update, `backend/src/routes/tasks.js:367` (`"UPDATE requests SET " + sets.join(', ')`):
the only fields it can ever set are `record_type_id`, `record_owner_department_id`, `department_id`
(`routes/tasks.js:350,357,363`) — `stage` is not reachable. No violation.

### 1c. Nullable request link; no fake tasks / pseudo-requests — **PARTIAL**

Task side is clean. One insert site: `backend/src/services/taskRouting.js:320`, passing
`opts.requestId || null` (`:321`) — the nullable link is honored; the schema drops NOT NULL at
`backend/src/db/schema.postgres.sql:1122`. Role-less (world-claimable) tasks are refused at creation
(`services/taskRouting.js:290-296`). No task insert uses a placeholder request id.

| Sev | Item |
|---|---|
| **HIGH** | Pseudo-requests still exist and one is still actively *manufactured in code*: `backend/src/services/connectors/nena911.js:51-53` creates `req-911-proactive` purely as an anchor for proactive-disclosure files. `docs/ARCHITECTURE.md:15` (item 3) — "Passive/monitor items and heads-ups are Notifications, never faked as tasks or requests" — and `backend/src/services/notifications.js:6` records that notifications are "what replaced the SYS-IMPORT pseudo-request". The replacement was done for imports (`services/importIngest.js:28`) but not for this connector. |
| MEDIUM | Two further pseudo-requests survive as data with no creation site in `backend/src`: `req-library-files` (number `LIBRARY`) and `req-template-samples` (`SYS-TEMPLATE-SAMPLES`) — `backend/src/db/purge_test_requests.js:9-11,29`. Legacy rows rather than new violations, but `ARCHITECTURE.md:15` has no exception for them and no spec documents them as sanctioned. |

### 1d. ONE task-routing role catalog — **CLEAN (one doc drift)**

Grep: `grep -rn "TASK_ROLES\|ROUTABLE_TASK_TYPES\|role_required =" --include=*.js backend/src`.
Exactly one catalog: `backend/src/services/taskRouting.js:23` (`TASK_ROLES`), with
`ROUTABLE_TASK_TYPES` (`:120`) and `HAND_ASSIGNED_TASK_TYPES` (`:123`) beside it; every consumer imports it
(`routes/staff.js:12`, `services/intakeReview.js:5`, `services/coverageGap.js:8`, `services/approvalModules.js:56`).
The v1 `function_roles` / `permission_roles` tables are gone — the only surviving mention is a comment saying
they are ignored (`backend/src/routes/staff.js:43`); zero references in `frontend/src`.

`backend/src/services/approvalModules.js:59` (`ROUTABLE_ROLES`) is **not** a second catalog — it is an
allow-list of approval destinations validated against the router, cited to the same source (`:54-58`).

| Sev | Item |
|---|---|
| MEDIUM | `docs/SPEC_auth_security_platform.md:6` — "JWT access tokens (8h) carrying id/email/name/department + **function roles and permission roles**". The token actually carries `perms` (derived), `userTypes`, `authorities`, `permissionGroups`, `inOro`, `taskMenu` — `backend/src/services/auth.js:20-25`. `docs/ARCHITECTURE.md:19-27` (item 4) says that split is GONE, tables dropped. The spec still describes the retired two-catalog shape. |

### 1e. Read parent facts THROUGH the parent — **21 VIOLATIONS (9 HIGH)**

Two facts anchor every severity call below:
- `backend/src/services/requestCreate.js:78-94` — `requestor_*`, `delivery_method`, `mailing_*`,
  `fee_waiver_requested`, `classification` are copied identically to children; `is_mrr` and
  `certification_requested` are **forced 0** on children; `request_number` gets the `-N` suffix; and
  `PARENT_NULL` (`:90`) **NULLs `description`, `record_types`, `department_id`, `record_type_id`,
  `component_label` on the parent** — deliberately, per the comment at `:281-284`.
- `backend/src/services/feeRelease.js:32-35` — "Today every UI path writes estimates keyed on the CHILD."
  Confirmed in the frontend: `frontend/src/pages/EstimateTaskPage.js:232` renders
  `<FeeEstimatePanel requestId={task.request_id}/>`, and tasks hang off children. **So every
  `routes/feeEstimates.js` endpoint is addressed with a child id in the live UI.**

#### HIGH — a wrong number, wrong money, or a half-closed request reaches the citizen

| # | file:line | Why it is wrong |
|---|---|---|
| e1 | `backend/src/routes/feeEstimates.js:256` | `SELECT id, request_number, requestor_name, requestor_email, fee_waiver_status … FROM requests WHERE id = ?` — no `numberJoin`, no parent filter, `req.params.requestId` is a child. `services/feeNotice.js:85` renders `request.request_number` verbatim into the subject and body. **The citizen's cost-estimate email quotes `2026-000045-1`, a number they have never seen and cannot quote back.** The same file already resolves `certification_requested` through the parent at `:104-107` — the idiom exists here and was simply not applied to the number. |
| e2 | `backend/src/routes/feeEstimates.js:601` | Same shape, balance-due notice (`feeNotice.js:138`). |
| e3 | `backend/src/routes/feeEstimates.js:678` | Same shape, final-cost notice (`feeNotice.js:162,193`). |
| e4 | `backend/src/routes/feeEstimates.js:182`, `:779`, `:826` | `number: loaded.request.request_number, isMrr: !!loaded.request.is_mrr` (estimate panel header) and `requestNumber: reqRow.request_number` (financial profile). Off a child the number is suffixed **and `is_mrr` is the forced 0 — so the MRR badge can never render on the estimate screen.** |
| e5 | `backend/src/routes/requests.js:606`, `:628` (write) vs `routes/feeEstimates.js:256,678,779` (read) | `fee_waiver_status` / `_decided_by` / `_decided_at` are written to the row named in `POST /requests/:id/fee-waiver-decision`, resolved at `routes/requests.js:599` by `SELECT * FROM requests WHERE id = ? OR request_number = ?` with **no `workRow`/parent resolution**. These columns are not in `requestCreate`'s `COLUMNS` (added by later `ALTER`s), so they exist on exactly one row. The notice builders then read `fee_waiver_status` off the child. **A waiver granted on the parent is invisible to the child-keyed notice: the citizen is billed for fees the city has decided it is not owed** — and `requestorLedger.onWaiverGranted(request.id)` (`routes/requests.js:612`) clears A/R on the wrong row. |
| e6 | `backend/src/services/clarificationAction.js:55` | `SELECT id, request_number, delivery_method, stage, requestor_name, …, description, mailing_* FROM requests WHERE id = ? OR request_number = ?`. All three UI callers pass a child (`RecordSearchTaskPage.js:140`, `EstimateTaskPage.js:53`, `IntakeReviewTaskPage.js:124` — all `task.request_id`). `preview()`/`doOutreach()` put `reqRow.request_number` into the **clarification letter and email to the citizen** (`:95`, `:112`) and into `services/clarificationNotice.js:33,84`. The same module resolves the **clock** correctly through the parent at `:125` (`COALESCE(master_request_id, id)`) — the split is inconsistent inside one file. |
| e7 | `backend/src/services/feeNonpayment.js:54-63` | **The inverse error.** `sweep()` correctly selects parents (`:91`, `scope.andParent`), then `closeForNonpayment(rid)` calls `applyStageTransition(parentId, 'closed')`. `services/taskRouting.js:668,703` writes `stage`/`status` and cancels tasks **`WHERE id = ?` / `WHERE request_id = ?` — the parent only, with no cascade.** The parent flips to `closed` while every child stays `active` at its stage with **open, claimable tasks**. `publishOnClose` (`:61`) updates `fulfilled_records WHERE request_id = parent`, and those rows hang off children — a no-op. `reopen()` (`:71`) then gives the parent a work stage (`awaiting_payment`), which a parent must never hold. |
| e8 | `backend/src/services/clarificationTimeout.js:83-92` | Same shape, and the comment makes it worse: `:79-82` asserts "after the migration it closes the parent **and cascades to every child**". **There is no such cascade anywhere in `applyStageTransition`** (`taskRouting.js:607-731`, read end to end). This is the auto-closing sweep, so it marks the citizen's request closed on paper while the work rows keep running. `services/disposition.js:258-298` (`deriveParent`) derives the parent's closed state *bottom-up from the children* — the sanctioned direction, and proof these two top-down closes are inverted. |
| e9 | `backend/src/routes/requests.js:646` → `services/email.js:149-158` | `sendFeeWaiverDenial(request, …)` is handed the possibly-child row from `routes/requests.js:599`; the subject/body is `'Fee-Waiver Decision: ' + req.request_number`. |

#### MEDIUM

| # | file:line | Why |
|---|---|---|
| e10 | `backend/src/routes/tickler.js:17-19` | `SELECT id, request_number, requestor_name, stage … FROM requests r WHERE r.tickler_flag IS NOT NULL` + `scope.andLeaf('r')` — leaf-scoped, raw `request_number`, no `numberJoin`. The flagged-requests screen shows suffixed numbers. |
| e11 | `backend/src/services/coverageGap.js:61,81,128` | `SELECT id, request_number FROM requests WHERE id = task.request_id` — tasks hang off children, so the empty-pool notification **and the email to the manager** name `…-1`. |
| e12 | `backend/src/services/erpSettlement.js:103-112` | `SELECT request_number, requestor_name, requestor_email … WHERE id = o.requestId`; `routes/settlement.js:27` passes the addressed id. **The ERP charge `reference` sent to the city's finance system is the component number.** (The per-line-item `reference` at `:58` off component ids is defensible; the charge-level one is not.) |
| e13 | `backend/src/services/mrrHub.js:523`, `:604` | **Inverse.** `description: parent.description` / `truncate(p.description, 90)` — `description` is NULL on every parent by construction (`requestCreate.js:90`). **The MRR hub master header and the "My MRRs" list render a blank description on every MRR.** |
| e14 | `backend/src/routes/mrr.js:128` | Same NULL: `parent: { …, description: parent.description }`. |
| e15 | `backend/src/services/parentFinance.js:843`, `:866` | **Inverse.** Correctly resolves via `parentOf(rid)`, then publishes `stage: p.stage` — always NULL on a parent. |
| e16 | `backend/src/routes/requests.js:359`, `:409`, `:413` | **Inverse.** `PATCH /:id/route` does `SELECT * FROM requests WHERE id = ?` with no `workRow` resolution, then `autoRouteOrPool(taskId, request.description)`. Addressed with a parent, the routing text is NULL and Smart Routing gets nothing to match. |
| e17 | `backend/src/routes/legalEstimate.js:35`, `:65` | `title: 'Estimate legal hours — ' + request.request_number`; legal estimate runs per work row, so the task title carries the component suffix. |
| e18 | `backend/src/services/externalContributor.js:82,86,90,139,154` | `child.request_number` in the invite email and the scoped payload — an outside contributor is handed a number that does not exist to the citizen. |

#### LOW

| # | file:line | Why |
|---|---|---|
| e19 | `backend/src/services/clarificationTimeout.js:67`, `:112` | The dry-run `candidates` listing exposes the child's `request_number`; staff-facing only. |
| e20 | `backend/src/routes/requests.js:226`; `routes/tasks.js:16`, `:422` | Read `requestor_*` / `deadline_date` raw off a possibly-child row. **Provably correct today** — `requestor_*` is copied verbatim by `requestCreate`, and `tolling.js:140` deliberately cascades `deadline_date` to children (`WHERE id = ? OR master_request_id = ?`). Fragile, not wrong. `routes/tasks.js` does use `numberExpr` for the number. |
| e21 | `backend/src/services/tickler.js:112-115` vs `services/feeRelease.js:32-35` | **Contradictory comments.** `tickler.js` states "the ESTIMATE hangs off the PARENT while the STAGE lives on the CHILD"; `feeRelease.js` states the opposite. The frontend (`EstimateTaskPage.js:232`) proves `feeRelease` right. One of these is steering future work wrong. |

**Sampled files that are CLEAN** (all of these correctly use `requestScope` or an equivalent explicit filter):
`routes/publicChat.js` — exemplary: parent facts scoped with `master_request_id IS NULL` (`:594-597`, `:648-649`),
children queried separately for stage, and a child-suffixed number typed by a citizen normalised back to the
parent (`:592`). `services/tickler.js` — `andLeaf` on the stall sweep, `andParent` on the scanned count.
`services/reportEngine.js` — `scopeFor()` picks parent vs leaf per metric with the reasoning written out;
`routes/reports.js` is a thin pass-through. `services/feeEngine.js` / `feeBounds.js` — pure computation, zero
`requests` reads. `services/feeNotice.js` — pure renderer; the fault is entirely at its call sites. The
*selection* halves of `feeNonpayment.js:91` and `clarificationTimeout.js:73` are correctly scoped — only their
close paths (e7, e8) are wrong. Also clean: `routes/objections.js` (`numberExpr`+`numberJoin` on all seven
queries), `services/closureNotice.js` (`citizenFacts`), `services/releaseReviewPackage.js`,
`services/certificationSheet.js`, `services/opsSummary.js`, `services/autoRelease.js:206`,
`services/intakeReview.js:179-184`, `services/requestCreate.js:514-519`, `services/taskRouting.js:766`.

---

## Part 2 — Spec drift

### 2A. `docs/SPEC_setup_hub.md`

Ground truth: `backend/src/services/setupHub.js:23-35` = **6 lanes**; `:44-120` = **34 items**, lane shape
**[10,3,6,4,5,5]**, asserted by `backend/tests/verify_setup_hub.js:48-50`.

| Sev | Spec line | Claim | Code evidence |
|---|---|---|---|
| **HIGH** | `SPEC_setup_hub.md:10` | "**five lanes** of plain-language items" | Six — `setupHub.js:23-35` (`features` added C7); `verify_setup_hub.js:48` asserts `LANES.length === 6`. The spec's own §2 table (`:14-25`) lists six, so §1 contradicts §2. |
| **HIGH** | `SPEC_setup_hub.md:81` (H1) | "counted evidence for **all 36**" | 34 — `verify_setup_hub.js:49`. |
| **HIGH** | `SPEC_setup_hub.md:86` (F2) | "`verify_setup_hub` back to **36 items**" | 34 — `verify_setup_hub.js:49`. |
| **HIGH** | `SPEC_setup_hub.md:87` (F3) | "`verify_setup_hub` **35 items [10,8,5,4,7]**" | 34, **[10,3,6,4,5,5]** — `verify_setup_hub.js:49-50`. Both the total and the *five*-lane shape are false. |
| **HIGH** | `SPEC_setup_hub.md:82` (H2) | "Screens for the no-door items (**1.7**, 2.9, 2.10, 2.12, 2.13, 4.7)" | 1.7 = clarification policy, which has had a screen since R1: `setupHub.js:66` doors `/setup/request-rules?tab=clarification` (`App.js:183`). Only **five** rows carry `noScreen` — matching §3 at `:36`. H2 would send a builder to build a screen that exists. |
| **HIGH** | `SPEC_setup_hub.md:91` (H4, marked "open") | "Retire the collisions (deadline day-counts in Configuration; **the second email editor**; Org vs Departments page)" | Two of three are closed. C5 deleted the Fees & Deadlines tab and dropped `deadline_*` from `POST /config` (`routes/config.js:27` — the keys are gone). C2 built `/setup/email` (`App.js:166`). Only Org-vs-Departments survives (`App.js:122,162`). A builder would redo closed work. |
| **HIGH** | `SPEC_setup_hub.md:89` (D1) | "RequestRulesPage 4th tab, **laneIndex item 2 of 10**" | `frontend/src/pages/RequestRulesPage.js:151` → `deadlines: 'item 1 of 10'`. C1's deletion of the `jurisdiction` row shifted every index up by one. |
| **HIGH** | `SPEC_setup_hub.md:87` (F3) | clarification/exemptions/eligibility are "**4/5/6 of 10**" | `RequestRulesPage.js:151` → **3/4/5**. Same C1 shift. |
| **HIGH** | *omission* — §2/§3/§7 all silent | — | The **`/setup/email` "Email configuration" screen** (C2) is nowhere in the spec: row `email` at `setupHub.js:118`, route `App.js:166` → `EmailConfigPage`. It is one of the purpose-built hub screens and has no slice row. |
| MEDIUM | `SPEC_setup_hub.md:90` (I1) | "compliance lane **10 → 11**, **36 items**" | Compliance lane is 10 rows (`setupHub.js:54-75`); catalog is 34. |
| MEDIUM | `SPEC_setup_hub.md:84` (F1) | "…which **the hub's `fee_test` row** reads; `fee_test` door → `/setup/fee-law?tab=test`" | Row deleted by C8 (the spec says so itself at `:18`). The reader survives only as `setupHub.testEstimateStatus` (`setupHub.js:152-162`), served on `GET /fee-law` as `testStatus` (`routes/feeLaw.js:31`); `FeeLawPage.js:62` no longer scans the hub. |
| MEDIUM | `SPEC_setup_hub.md:9` (§1) | "One page — **Administration → Setup**" | The tab is "**Settings and Configuration**" and there are exactly two tabs (`AdministrationPage.js:17-18`), the strip hiding entirely below two (`:74`). §3a at `:43` carries the rename; §1 does not. |
| MEDIUM | `SPEC_setup_hub.md:67` (§5 payload) | `→ {counts, top:[agency], lanes:[…]}` | `build()` also returns `jurisdiction` and `profileError` (`setupHub.js:449`) and each item carries `note` (`:442`). More load-bearing: the spec never states that the `agency` top item is **excluded from its own lane's `items`/`total`** — `setupHub.js:441` filters `&& !it.top`, which is why the organization lane renders 4 of its 5 catalog rows and why 34 = 33 rendered + 1 top card. |
| MEDIUM | *omission* — §2:22 / §3:40 | — | The **rowless `SetupScreen` mode** is uncarried: `components/setup/SetupScreen.js:52-100` — with no `hubKey` the pill degrades to a plain "Settings and Configuration" back-link, `props.note` replaces the evidence line, no Attest renders, `can:true`. Used by `UserTypesPage.js`, the only `/setup/*` screen with no hub row. |
| MEDIUM | `SPEC_setup_hub.md:73-76` (§6) | the verification list | Predates C11. `verify_setup_hub.js` is 26 checks and now carries a section **G (G1–G4, `:135-138`)** asserting the `POST /api/config` operational-vs-system gating. |
| LOW | *code artifact* | — | `setupHub.js:240` (`go_live` reader) still returns `waitingOn: ['jurisdiction']`, a row C1 deleted. `build()` silently drops unknown dep keys (`:427-429`), so the Why line falls back to the evidence string. Dead reference to a row the spec records as DELETED (`:33`). |

**Accurate, no action:** §2 lane table (`:14-25`), §3 totals and the five `noScreen` rows (`:28-38`),
§3a Set Up Guide (`:42-52`, vs `SetupGuidePage.js:20-27,43-58`), §4 states (`:54-64`),
§5 endpoints/gating (`:66-70`), and the C11 paragraph (`:40`).

### 2B. `docs/SPEC_jurisdiction_configuration.md`

| Sev | Spec line | Claim | Code evidence |
|---|---|---|---|
| **HIGH** | `:11` | "**ConfigurationPage** fronts it" (the effective-dated system-config surface) | `ConfigurationPage.js` DELETED (C11). `/config` and `/admin?tab=config` land on the hub (`App.js:199`; `AdministrationPage.js:19-21`). The keys are now edited from six dedicated screens (`App.js:167-172`). **The spec names no successor screen at all.** |
| **HIGH** | `:24` (§5b) | "review, sandbox test and activation stay on the **Fee Configuration screen**" | `FeeConfigPage.js` DELETED (C9); `/fee-config` → `/setup/fee-law` (`App.js:197`). The composer itself is intact and correct (`JurisdictionConfigPage.js:310`, `:329`, `FEE_FIELDS` at `:260-296` is exactly 27 fields in 6 groups) — only the destination is dead. Duplicated in a code comment at `JurisdictionConfigPage.js:258`. |
| **HIGH** | `:20` (§5) | "SetupPage/stepper with deep links" `[BUILT]` | `frontend/src/pages/SetupPage.js` is **dead code, imported by nothing**. `AdministrationPage.js:17` binds tab `setup` to `SetupHubPage`; `App.js:163` redirects `/setup` → the hub. `backend/src/routes/onboarding.js` is still live, so the 7 phases exist as data with no UI. |
| **HIGH** | `:8` (the 2026-07-13 correction) | (i) "`jurisdiction_profiles` has exactly ONE row (`jur-tx`)"; (ii) "no clock, deadline, tolling, deposit or clarification rule … live per jurisdiction — those are global `system_config` singletons"; (iii) "`clarificationPolicy.read(jid)` accepts a jurisdiction id and **discards it**" | (i) 20 rows in the fixture (`backend/src/db/seed_fixture.sql:544-563`). (ii) `jurisdiction_rules (jurisdiction_id, domain, config_json)` exists (`backend/src/db/schema.postgres.sql:843-851`) and the clock reads it — `backend/src/services/tolling.js:30` `JR.readActive('deadline')`, `system_config` only as legacy fallback. (iii) `backend/src/services/clarificationPolicy.js:142-144` does `JR.read(jid, DOMAIN)`. All three now false. |
| **HIGH** | `:6` (§1) | "`jurisdiction_profile_sections` covering: identity, fees, taxonomy, exemption, deadlines, redaction" (6) | **9 core** sections — `identity, fees, deadlines, clarification, payment, fee_waiver, exemption, redaction, taxonomy` (`backend/src/services/jurisdictionProfile.js:26-36`) — **plus 6 template sections** (`intake, eligibility, branches, disposition, ledger, template_import`, `:46-53`) that appear after a state-template import (`sectionsFor`, `:62-67`). Missing `clarification`, `payment`, `fee_waiver` and the whole template tier. |
| **HIGH** | `:32` (§7 gap 1) | "whether the profile section actually drives clock durations is `[unverified]`" | Answered: `tolling.js:30` reads the per-jurisdiction `deadline` domain; the `deadlines` hub row doors `/setup/request-rules?tab=deadlines` with `foldSections:['deadlines']` (`setupHub.js:54`). |
| **HIGH** | `:34` (§7 gap 3) | "Fee-waiver-denial response-window rules per jurisdiction `[NOT BUILT — legal research first]`" | BUILT. `backend/src/services/feeWaiverPolicy.js:57-63` defines `response_window_days` / `_unit` / `_trigger` (enum incl. `waiver_denial`, `cost_estimate_sent`, `deposit_demanded`) / `_expiry`; seven-state research recorded at `:15-23`; `fee_waiver` profile section at `jurisdictionProfile.js:32`. |
| **HIGH** | *omission* | — | **The attestation FOLD is absent from the spec entirely.** `jurisdictionProfile.js:23-33,47-48` gives 8 of 15 sections a `foldedInto` target, and `routes/setupHub.js:41-63` makes a hub row's "Attest as complete" attest/unattest the folded profile sections; the jurisdiction-config attest rail now points at the owning `/setup` screen instead of offering its own button (`JurisdictionConfigPage.js:868-872`). This is the central change to how §1 attestation works. |
| **HIGH** | *omission* | — | **The Setup Hub is not mentioned in this spec.** `setupHub.js:23-36`/`:44-120` is now the front door for every domain §1–§5 describes, and `SPEC_setup_hub.md` is the binding doc. `/jurisdiction-config` retains only: the go-live flip, the propose-change composer, the unfolded attests (`redaction`, `taxonomy`, `branches`, `disposition`, `ledger`, `template_import`), integrity findings, provenance, and the `city_choices` door. |
| **HIGH** | *omission* | — | **`POST /api/config` key set and gating changed and the spec records neither.** `routes/config.js:19` `OPERATIONAL = ['overdue_alert_days','escalation_days','ack_email','av_redaction_mode']` accepts `operations_config`; everything else needs `system` authority (`:21-24`). C5 dropped `deadline_*`, `fee_threshold`, `cost_per_page`, `labor_rate` from `allowed` (`:27`). `av_redaction_mode` was read but never writable before C11. |
| **HIGH** | *omission* | — | **Four profile sections point at a deleted editor.** `jurisdictionProfile.js:49-52` — `branches`, `disposition`, `ledger`, `template_import` all carry `editor: '/config'`, now a redirect to the hub (`App.js:199`). Those four have no screen and hold the auto-release switches and the de-minimis setting. Separately `deadlines` (`:29`) still points at `/tickler` while the hub doors it to `/setup/request-rules?tab=deadlines` (`setupHub.js:54`) — two live attest paths. |
| MEDIUM | `:6` | "**JurisdictionProfilePage** fronts it" | No such component. It is `frontend/src/pages/JurisdictionConfigPage.js` at `/jurisdiction-config[/:section]` (`App.js:146-147`); `/jurisdiction-profile` is a redirect (`App.js:150`). |
| MEDIUM | `:11` | "a **nightly** promotion applies scheduled changes" | `backend/src/services/effectiveConfig.js:89-91` — `promoteDue` runs 60 s after boot then on a **1-hour** `setInterval`. |
| MEDIUM | `:14` | "**RuleUpdatesPage** fronts the pending queue" | Component name right, route wrong: now `/setup/update-configuration` (`App.js:177`), admin tab deleted (C16), `/rule-updates` a redirect (`App.js:148`). |
| MEDIUM | `:21` (§5 role gate) | writes take "`SYSTEM_ADMIN`/`DIRECTOR` (the System Administration permission group)" | Those role names were deleted in S5. The gate is `requirePermission('compliance_policy')` (`backend/src/routes/onboarding.js:10`), fee-test carve-out `editOrReviewer('fees')` (`:170`). "System Administration permission group" is not a group in `services/userTypes.js:59`. |
| MEDIUM | `:33` (§7 gap 2) | "Only **3** state profiles loaded" | 20 (`seed_fixture.sql:544-563`), and it contradicts the spec's own `:8`. |

**Accurate, no action:** §3 (`:14`) config-freshness staging; §4 (`:16-17`) AI rule discovery propose-only;
§5b composer mechanics (27 fields / 6 groups / bounds / 422 / `_proposal`); §6 supporting pieces.

### 2C. `docs/SPEC_user_type_model.md`

| Sev | Spec line | Claim | Code evidence |
|---|---|---|---|
| **HIGH** | `:92` | "`legacy_perm_map` … **is dropped in S5** with the shim" | NOT dropped, and load-bearing: `backend/src/services/taskRouting.js:452` joins it in the task-pool predicate (`JOIN legacy_perm_map m ON m.user_type_key = ut.key`). Created at `backend/src/db/schema.postgres.sql:1775`, seeded `:1872`, in the fixture at `seed_fixture.sql:204` and `db/gen_fixture_seed.js:39`. A builder deleting it on this spec's word breaks task routing. |
| **HIGH** | `:351-352` (§10 item 2) and `:357-359` (as-built S3) | "User types admin page (**Administration → User types**)"; "the matrix is a **tab of Administration** (`?tab=user-types`), readable by anyone who can open Administration" | Tab RETIRED (C17): `AdministrationPage.js:12-18` has two tabs, `:63` redirects `?tab=user-types` → `/setup/user-types`; route `App.js:180`; reached via "View user types" on Organization → Staff (`OrgPage.js:221`, stated by the page itself at `UserTypesPage.js:66`). **Second-order:** the route sits under the plain `AppLayout` guard and `GET /api/user-types` is `requireAuth` only (`backend/src/routes/userTypes.js:13`) — the catalog is now readable by *any* authenticated user, not "anyone who can open Administration". |
| **HIGH** | `:139` (§5) + `:249` (§8 row 5) | portal agent rules are gated `system_admin`, under "Lane 4" | The API still enforces `system_admin` (`backend/src/routes/agentRules.js:6,16,28,38`), but C11 moved the hub row into the new **System Features and Options** lane, whose group is `operations_config`: `setupHub.js:87` (`agent_rules`, lane `features`, door `/setup/agent-rules`) and `:34-36`. A Director/Associate who owns that row per the hub gets a 403 from the write endpoints. Spec records neither side of the mismatch. |
| MEDIUM | `:130-141` (§5 table), `:150-154` | Hub lane vocabulary: "Lane 1 / 2a + 2b / 3 / 4" with numbered items ("1.3 deadlines", "2.1–2.13", "4.2 AI keys", "4.3 AI deployment", "4.7 settlement") | Six **named** lanes with string keys — `compliance, fulfillment_fees, fulfillment_redaction, organization, technical, features` (`setupHub.js:23-36`) — and 34 name-keyed items. `ai_keys` + `ai_deployment` merged into `ai_config` (`:114`, C12); `fee_rates`/`fee_test` deleted (C8); `taxonomy` moved to `features` (`:83`, C7); `av_redaction` added (`:102`, C11). The group→type mapping in the table body is still right; only the item addressing is dead. |
| MEDIUM | `:356` (as-built S3) | "'Request Fulfillment Team' is relabelled **Home department (display only)**" | Half done: the **edit** modal carries it (`frontend/src/pages/StaffManagementPage.js:373`), the **create** form still reads "Request Fulfillment Team" (`:250`). |
| MEDIUM | `:34-48` (§2 "Where the code is today") | Present-tense survey facts | All now false: `SYSTEM_ADMIN` short-circuit (`:44`) retired in S4 (`backend/src/middleware/auth.js:38`); grant-all-11 at creation (`:41`); no route to edit roles (`:42`); the ungated `feeProfiles`/`departments`/`agentRules` writes (`:46`) are now gated (`feeProfiles.js:98,119`; `departments.js:15,27,45`; `agentRules.js:16,28,38`); go-live is `requireAuthority('go_live')` (`routes/jurisdictionProfile.js:116`), not `requireRole(SYSTEM_ADMIN)` (`:47`). The section is dated but reads as current — one "as of the pre-build survey; every row closed by S1–S6" banner fixes it. |
| LOW | `:219-224` (§7 primitives) | primitive list | Omits `requireAnyAuthority`, which exists and is exported (`backend/src/middleware/auth.js:112`). |

**Accurate, no action:** §3 catalog (`:57-69`, all 11 keys vs `userTypes.js:12-24`); §3.1 tables (`:77-96`) and the
four dropped legacy tables (`schema.postgres.sql:13-16`); §4 authority axis (`:107-118` vs `userTypes.js:28-42`);
§5 holder columns (`:135-140` vs `userTypes.js:46-59`); §6 task menus (`:170-176` vs `userTypes.js:65-77`);
§9.1 act-perm table (`:305-315` vs `ACT_PERMS`); §10 item 3 (`:353`, still-true "View staff by team NOT built",
`OrgPage.js:322-324`); §12 S5 apart from `legacy_perm_map`; §8 rows 1–2, 3–4, 6–9.

### 2D. `docs/SPEC_fees_estimates_payments.md`

The §4 ⛔ "correction block" (`:25-43`) is the single most misleading passage in the spec set: it is a
loud, formatted warning that has been **fixed in code** and would send a builder to re-fix it.

| Sev | Spec line | Claim | Code evidence |
|---|---|---|---|
| **HIGH** | `:25-30` | "There is **no aggregation across children at all** … a 3-child request produces three independent money pots and a parent that owns none" | `backend/src/services/paymentStatus.js:67-72` (`moneyTreeIds`) normalizes any id to `COALESCE(master_request_id, id)` and answers over the whole tree; the aggregation rules are documented at `:44-66`. `services/feeRelease.js:36` (`COVERING`) covers parent+children for the release gate. `services/parentFinance.js:33-36` (`parentOf`) normalizes every entry point "because money is a PARENT fact (§4.3)", and `routes/parentFinance.js:49-155` serves the parent statement/netting/settlement/credit/refund surface. |
| **HIGH** | `:32-36` | "dunning and non-payment auto-close are **inert** for every wrapped request … `verify_nonpayment_scope.js` (**not registered in the suite** — it fails today by design)" | Both halves false. `services/feeNonpayment.js:25-31` records the fix (2026-07-19); `clockStart` at `:34-39` reads `MAX(notified_at)` across `ps.moneyTreeIds(rid)`. `backend/tests/run_suite.js:32` **registers** `'verify_nonpayment_scope'`, and the suite is 2701/2702 green. |
| **HIGH** | `:26-29` | "All **17** `/fee-estimates/request/:requestId` endpoints use the id they are handed with **zero parent resolution**, and every UI path hands them a **child**" | **18** endpoints now (`routes/feeEstimates.js:146,198,254,283,367,457,493,506,526,550,599,616,675,697,719,728,736,776`), and parent resolution exists — `routes/feeEstimates.js:101-107` reads `certification_requested` off the master row. The premise is broken too: `routes/mrr.js:337-347` (Generate Estimate) finds-or-raises the ordinary `estimate` task **on `r.parentId`**, explicitly "one estimate for the whole request, not a sum of item prices". |
| **HIGH** | `:42-43` | "Closing this gap is **gated on the MRR hub** (§14.3)" | Gate lifted: the hub is BUILT (`services/mrrHub.js`, `routes/mrr.js`, `run_suite.js:34` `verify_bw6_mrr`) and the settlement method is decided and built (`services/parentFinance.js:1-27`). |
| **HIGH** | `:166` | "Fee-waiver approval task routing `[NOT BUILT]`" | BUILT: `services/approvalModules.js:52,107,124-126` ships a configurable `fee_waiver` module (`mode: routed_task`, `assignee_role: FINANCE`); `routes/feeLaw.js:81-90` → `services/feeLaw.js:214-235` (`decideWaiver`) writes the who-decides choice into that store. |
| **HIGH** | *omission* (§1 at `:8` is the closest touchpoint) | "the same gate covers **hand edits**, the fees composer, and AI-extracted values" | The **Fee rules screen and its whole API are absent from the spec.** `routes/feeLaw.js:1-9` documents `GET /api/fee-law`, `PUT /fee-law/decisions`, `POST /fee-law/read-document`, `/preview`, `/waiver`, `/clock`, `/approve`; `services/feeLaw.js:495-524` (`approve`) is now the **primary path that mints `fee_profiles` version n** (active, bounds-checked at `:503`, 422 `UNDECIDED` on undecided deferrals at `:499-501`) and writes `config_history` domain `fee_schedule`. Hand edits no longer happen where §1 says — `FeeConfigPage.js` is deleted, `/fee-config` → `/setup/fee-law` (`App.js:197`). Screen: `frontend/src/pages/FeeLawPage.js`, four tabs (`:27-32`: State mandate · City decisions · Fee policy document · Test an estimate); hub row `fee_law` "Fee rules" at `services/setupHub.js:65`. |
| MEDIUM | `:68-69` (§8) | "Fee sandbox `[BUILT]` — **Onboarding Fees phase**: preset scenarios + custom inputs" | Re-homed: it is Fee rules' fourth tab (`FeeLawPage.js:30,466`, `TestTab` at `:489-510`) and prices via `POST /api/fee-law/preview` (`routes/feeLaw.js:61-77`, which composes the *draft* schedule so the calculator works before v1 exists), not `/api/fee-sandbox/preview` directly. The hub's `fee_test` row is deleted (`setupHub.js:77-79`); its reader survives as `HUB.testEstimateStatus()` (`routes/feeLaw.js:31`). |
| MEDIUM | `:66` (§7) | "approval gate = **FEE_WAIVER_APPROVER** (→ Finance role per rename decision)"; "Statuses: pending-approval → approved/resolved" | `FEE_WAIVER_APPROVER` was retired 2026-07-15 (`backend/src/db/schema.sql:8`; `services/taskRouting.js:31`; `routes/requests.js:574`). Actual model: `status='tentative'` + `approval_status='pending'` → approved (`status='resolved'`) or rejected (status back to `open`) — `routes/objections.js:149-181`, gated on FINANCE (`:167`). |
| MEDIUM | *omission* (§3 at `:19-20`) | "Payment timing: gates & bands" reads as if the fee profile's bands are the whole story | The **deposit & payment clock** now lives on Fee rules and is uncarried: `routes/feeLaw.js:91-101` (`POST /api/fee-law/clock`) → `services/paymentClockPolicy.js` (`deposit_clock_effect` / `deposit_grace_days` / `deposit_lapse_action`, master switch + per-field confirms). Gate names and band selection themselves verify clean (`services/paymentTiming.js:12,17-21,56-65`). |
| LOW | `:2` | "Verified against code + DB on **2026-07-08**" | No later verification stamp, though §§1, 2, 2a, 8b carry 2026-08 build dates. |

**Accurate, no action:** §1 bounds gate (`routes/feeProfiles.js:60,98-113,119-137`); §2 estimate profiles
(`routes/estimateProfiles.js:13`); §2a actual-cost lines (`services/feeEngine.js:204,226,280-306,321-345`);
§3 payment timing; §5 settlement (`routes/settlement.js:18,33,50` — `payment-applied` genuinely unauthenticated);
§6 nonpayment/release; §8b labor gate + overhead. **Notably §4a's 2026-07-19 warning is STILL TRUE** —
`services/laborActuals.js:53-58` is still `WHERE request_id = ?` with no parent scoping. Leave it.

### 2E. `docs/SPEC_processing_ui.md` — screen 5 / MRR hub only

**The screen-5 normative paragraph (`:82-88`) is accurate.** Every clause verifies: `mrr_management` spawned on
wrap (`services/requestCreate.js:450-459`) with `autoRouteOrPool` into the ORO pool (`:458`; routable at
`services/taskRouting.js:120`; ORO token at `services/userTypes.js:72`); my-MRRs-only scope
(`services/mrrHub.js:583-586`); the three hand-assigned child activities (`mrrHub.js:40-44`, hand-assign
enforced at `:135,155,172`) that never advance a stage (`mrrHub.js:12-20` — nothing calls
`applyStageTransition`; the assignee screen says so, `frontend/src/pages/MrrActivityTaskPage.js:16-18`);
readiness meter arming one Generate Estimate (`routes/mrr.js:301-347`, 409 `NOT_READY`); denial designation
raising `legal_review` rather than a denial (`mrrHub.js:409-427`); verbatim descriptions
(`MrrMasterPage.js:16-20`, `MrrChildPage.js:16-18`); attachments + fulfilling-record auto-complete
(`mrrHub.js:297-320,461-474`, `requestCreate.js:461-466`). Routes match `frontend/src/App.js:139-141`.

| Sev | Spec line | Claim | Code evidence |
|---|---|---|---|
| MEDIUM | `:59` | screen 5 is "**4-level**: group → overview → master → child" | A fifth surface is built and normatively load-bearing: the assignee's **MRR activity task screen** at `/mrr-activity/:taskId` (`frontend/src/App.js:138`, `pages/MrrActivityTaskPage.js`, served by `routes/mrr.js:254`). Its whole point — "completing it updates the hub AND NOTHING ELSE" — *is* the spec's own hard rule, and the spec never names the screen that enforces it. |
| MEDIUM | `:82-88` + open register at `:254` | omits four built capabilities; and lists "per-child release control location" and "estimate-data entry form location" as **PROVISIONAL** | Both shipped (`routes/mrr.js:411`, `:285`). Also uncarried: per-item **priority** ordering (`routes/mrr.js:85`; test `verify_mrr_priority`, `run_suite.js:34`); per-child **release / hold / lift-hold** (`routes/mrr.js:411-448`; `mrrHub.js:26-29` routing through `feeRelease.releaseGate` + `releaseHold.holdState`); per-item **mark-defect** (`routes/mrr.js:392`); **external-contributor** assignment with link resend/revoke (`routes/mrr.js:189,202`; `mrrHub.js:155`; `services/externalContributor.js:143`; test `verify_external_links`). |
| LOW | `:254` | Draft 5 residuals list "activity ordering enforcement" and "MRR task label set" as open | Both shipped at the drafted position and are now code contracts: `mrrHub.js:47-49` (`ORDER_ENFORCED = false`, no gating between activities) and `mrrHub.js:38-44` (MRR SEARCH / MRR ESTIMATE / MRR REDACTION). Should read "shipped as drafted, unanswered" rather than PROVISIONAL. The one genuinely-open residual — classifier hint on the child assign-picker — is correctly still open (`mrrHub.js:135`). |

**Cleared, not drift:** `SPEC_processing_ui.md:184` "Fee Configuration" is the **permission-group** display name,
still live (`services/userTypes.js:59` `fee_configuration`; `services/goLive.js:44-47` `group: 'Fee Configuration'`),
not the deleted screen. Do not rename it. `:229` (BW6 with no `[BUILT]` tag) is covered by `:242`.

### 2F. `docs/DOMAIN_MAP.md` — index accuracy

| Sev | Spec line | Claim | Code evidence |
|---|---|---|---|
| **HIGH** | `DOMAIN_MAP.md:58,61` | §6 points the fees domain at "`SPEC_tasks_roles_mrr_fees.md` (intake/waiver)" and says "engine/payment/objection internals **NOT yet consolidated** — only intake/waiver/profile concept covered" | `docs/SPEC_fees_estimates_payments.md` exists (182 lines) and consolidates exactly those internals. A builder following the index would never find the domain's own spec. It also contradicts the file's own `:9` ("✅ ALL 12 DOMAINS CONSOLIDATED"). |
| **HIGH** | `DOMAIN_MAP.md:65` | §7 "Pages: (record-search task screen **NOT BUILT** — known gap)" | Built: `frontend/src/pages/RecordSearchTaskPage.js`, routed at `frontend/src/App.js:127`; `docs/SPEC_record_search_task_screen.md` is its spec and is referenced nowhere in the map. |
| **HIGH** | `DOMAIN_MAP.md:60` | §6 "Pages: **FeeConfigPage**, CashDrawerPage" | `FeeConfigPage.js` deleted (C9). The screen is `FeeLawPage.js` at `/setup/fee-law` (`App.js:181`), with `/fee-config` and `?tab=fees` redirecting (`App.js:197`, `AdministrationPage.js:50`). §6 also omits `routes/feeLaw.js`, `routes/parentFinance.js` and services `feeLaw`, `feeBounds`, `feeWaiverPolicy`, `paymentClockPolicy`, `laborActuals`, `parentFinance`. |
| **HIGH** | *omission* | — | The entire **Phase-7 / BW1–BW9 UI programme** — `docs/SPEC_processing_ui.md` and `docs/SPEC_phase7_build.md`, all nine waves BUILT — appears **nowhere** in the index, nor do the screens it built: `MrrOverviewPage`/`MrrMasterPage`/`MrrChildPage`/`MrrActivityTaskPage`, `ParentFinancialPage`, `IntakeReviewTaskPage`, `ReleaseReviewTaskPage`/`ReleaseReviewPowerModePage`, `DispositionsPage`, `SetupHubPage` (`frontend/src/App.js:117-141`). |
| MEDIUM | `DOMAIN_MAP.md:29,33,41,51,69,75,80,84,88` | Page pointers | **Nine listed page names no longer exist:** `WorkflowSimulatorPage`, `RedactionReviewPage`, `JurisdictionProfilePage` (→ `JurisdictionConfigPage`), `FeeConfigPage` (→ `FeeLawPage`), `ConfigurationPage` (→ six `/setup/*` screens), `IntegrationsPage` + `AIDataFlowPage` (→ `AiConfigurationPage`, tabs `keys`/`deployment`), `SecurityPage` + `SourcesPage` (→ `AiConfigurationPage?tab=security` and `RecordSourcesPage`). Every backend route and service the map names still exists — the rot is entirely on the Pages pointers. |
| **HIGH** | `DOMAIN_MAP.md:44` | "**five lanes of 36** counted items" (↔ Part 3) | Six lanes, 34 items — `services/setupHub.js:23-35`, `:44-120`; `backend/tests/verify_setup_hub.js:48-50`. The `features` lane is new (C7/C11); `fee_rates`, `fee_test`, `waiver_policy`, `deposits` were retired. |
| MEDIUM | `DOMAIN_MAP.md:9` | "✅ ALL 12 DOMAINS CONSOLIDATED · Specs: SPEC_\*.md" | Every `SPEC_*.md` in `docs/` resolves to a real file (23 present, none dangling), but the map names only 9 and hides the rest behind the wildcard. Unnamed beyond the HIGH omissions: `SPEC_public_library`, `SPEC_public_portal_intake`, `SPEC_taxonomy_classification`, `SPEC_jurisdiction_configuration`, `SPEC_request_lifecycle_workflow`, `SPEC_record_search_fulfillment`, `SPEC_redaction`, `SPEC_redaction_task_screen`, `SPEC_reporting_ai_help`, `SPEC_sources_imports_connectors`, `SPEC_auth_security_platform`. As an index it asserts completeness it does not deliver. |
| LOW | `DOMAIN_MAP.md:7` | "Derived 2026-07-08 from a structural scan of ALL backend routes (**36**), services (**40+**), connectors (11), and frontend pages (**37**)" | Today: **53** routes, **109** services, 11 connectors, **64** pages. Self-dating, hence LOW — but the map has not been re-derived across two months of migration. |


---

## Part 3 — Docs (and one code string) that name retired things as current

Greps run over `docs/*.md`, excluding `HANDOFF.md` and `WORKING_*.md`:
`grep -rn -F "<term>" --include=*.md docs/` for `/admin?tab=`, `Fee Configuration`, `Jurisdiction Profile tab`,
`Configuration tab`, `AI Data Flow`, `Portal Agent Security`, `Integrations page`, plus the retired paths
`/fee-config`, `/integrations`, `/ai-data-flow`, `/portal-security`, `/rule-updates`, `/workflow-map`,
`Admin →`, `Administration →`, `ConfigurationPage`, `FeeConfigPage`, `IntegrationsPage`, `AIDataFlowPage`.

**Ground truth used:** `frontend/src/App.js:146-199` (the real route table) and
`frontend/src/pages/AdministrationPage.js:12-18` (two tabs: `setup` "Settings and Configuration", `guide` "Set Up Guide").
`ConfigurationPage.js`, `FeeConfigPage.js`, `IntegrationsPage.js`, `AIDataFlowPage.js`, `PortalSecurityPage.js`,
`SourcesPage.js` no longer exist under `frontend/src` (verified by `find`).

| Sev | File:line | Names as current | Reality |
|---|---|---|---|
| **HIGH** | `backend/src/services/helpAgent.js:14` | The in-app help assistant's app context states: "Administration: one menu item holding the technical-setup screens as tabs — Setup, **Configuration, Update Configuration, Fee Configuration, Taxonomy, Workflow, Process Map, Sources, Redaction Rules, Integrations & API Keys, AI Data Flow, Portal Agent Security**." | Every one of those tabs is deleted (`AdministrationPage.js:12-18` = 2 tabs). The system prompt at `helpAgent.js:33` tells the model to ground every answer in this context and never invent nav items — so the model treats these eleven dead tabs as covered fact and will confidently direct staff to screens that do not exist. Its "say you are not certain" fallback (`helpAgent.js:34`) never fires, because the context does not look uncertain. This is live user-facing copy, not a doc. |
| **HIGH** | `backend/src/services/helpAgent.js:17,18,19,24,25` | "Taxonomy: …", "Workflow / Process Map (**Administration tabs**)", "Sources: …", "**Fee Configuration** / Cash Drawer", "**Configuration** (admins only): system settings" | Same retirement. Correct doors are `/setup/taxonomy`, `/setup/workflow-rules`, `/setup/process-map`, `/setup/record-sources`, `/setup/fee-law`; `/config` now redirects to the hub (`App.js:199`). |
| **HIGH** ↔2B | `docs/SPEC_jurisdiction_configuration.md:24` | "review, sandbox test and activation stay on the **Fee Configuration screen**" | `FeeConfigPage.js` was DELETED (C9); `/fee-config` and `/admin?tab=fees` redirect to `/setup/fee-law` (`App.js:197`). A builder following this sentence would look for a screen that is gone. |
| **HIGH** ↔2F | `docs/DOMAIN_MAP.md:44` | "Setup & Configuration HUB … **five lanes of 36 counted items** … (Administration → Setup)" | Six lanes, 34 items (`backend/src/services/setupHub.js:23-35`; `backend/tests/verify_setup_hub.js:48-50`), and the tab is "Settings and Configuration" (`AdministrationPage.js:17`). |
| MEDIUM | `docs/AI_DATA_TOUCHPOINTS.md:11` | "This audit is presented interactively at **Admin → AI Data Flow & Compliance**" | That tab and `AIDataFlowPage.js` were deleted (C12). The content is now two tabs of one screen: `/setup/ai-configuration?tab=deployment` and `?tab=touchpoints` (`App.js:159,173`). Prospect-facing leave-behind. |
| MEDIUM | `docs/PROMPT_INJECTION_DEFENSE.md:3` | "Companion to the in-app **Admin → Portal Agent Security** screen." | Folded into AI configuration as its 4th tab (C13); `/portal-security` redirects to `/setup/ai-configuration?tab=security` (`App.js:160`); component is `frontend/src/components/setup/PortalSecurityInfo.js`. |
| MEDIUM ↔2C | `docs/SPEC_user_type_model.md:350` | "**User types** admin page (**Administration → User types**)" | Tab deleted (C17). Now `/setup/user-types` (`App.js:180`), reached via "View user types" on Organization → Staff; it is the one `/setup` screen with no hub row. |
| MEDIUM | `docs/CONFIG_FRESHNESS_DESIGN.md:88` | "`frontend/src/pages/RuleUpdatesPage.js` at **`/rule-updates`** (nav '**Rule Updates**', isElev)" | The page file survives but now lives at `/setup/update-configuration` wearing the SetupScreen strip (`App.js:177`); `/rule-updates` is a redirect (`App.js:148`); there is no nav entry. |
| MEDIUM ↔2F | `docs/DOMAIN_MAP.md:75` | Domain page list "SourcesPage, **IntegrationsPage**" | Both deleted. Now `RecordSourcesPage` (`App.js:174`) and the AI-configuration keys tab (`App.js:173`). |
| MEDIUM ↔2F | `docs/DOMAIN_MAP.md:80` | Domain page list includes **`ConfigurationPage`** | Deleted C11; split into six `/setup` screens (`App.js:167-172`). |
| MEDIUM ↔2F | `docs/DOMAIN_MAP.md:84` | Domain page list "ARIAReportsPage, AIReportingPage, **AIDataFlowPage**" | `AIDataFlowPage` deleted C12. |
| MEDIUM ↔2F | `docs/DOMAIN_MAP.md:60` | Domain page list includes **`FeeConfigPage`** | Deleted C9. |
| LOW | `docs/CITY_FEE_SURVEY.md:154` | "Config UI (**FeeConfigPage**, Labor section): per-driver 'Chargeable' selector" | Deleted C9. Survey/research doc, not a build contract, but the pointer is dead. |
| LOW | `backend/src/routes/feeEstimates.js:209` | Error text to staff: "No fee configuration exists … Set one up **under Fee Configuration** first." | Should name Fee rules / `/setup/fee-law`. |

**NOT drift — checked and cleared.** "Fee Configuration" in `docs/MASTER_task_types_permission_groups.md:80,97,98`,
`docs/DESIGN_user_type_role_model.md:55,56,75`, `docs/SPEC_processing_ui.md:184`,
`docs/DRAFT_processing_ui_rule_editors.md:46` is the **permission-group display name**, which is still live:
`backend/src/services/userTypes.js:59` (`fee_configuration`), `backend/src/services/goLive.js:44-47`
(`group: 'Fee Configuration'`), `backend/src/routes/feeProfiles.js:10`. Leave these alone.
`docs/PROMPT_INJECTION_DEFENSE.md:1` (the document *title*) is likewise fine — only its line 3 nav pointer is stale.
Zero hits for "Jurisdiction Profile tab", "Configuration tab" and "Integrations page" outside history files.
`grep -rn "function_roles\|functionRoles" --include=*.js frontend/src` → 0 hits (clean).


---

## Counts

| Section | HIGH | MEDIUM | LOW |
|---|---|---|---|
| 1a — one creation helper | 1 | 0 | 0 |
| 1b — one stage transition | **clean** | — | — |
| 1c — nullable task link / no pseudo-requests | 1 | 1 | 0 |
| 1d — one role catalog | **clean** (1 doc drift) | 1 | 0 |
| 1e — parent facts through the parent | 9 | 9 | 3 |
| **Part 1 total** | **11** | **11** | **3** |
| 2A — SPEC_setup_hub | 9 | 6 | 1 |
| 2B — SPEC_jurisdiction_configuration | 11 | 5 | 0 |
| 2C — SPEC_user_type_model | 3 | 3 | 1 |
| 2D — SPEC_fees_estimates_payments | 6 | 3 | 1 |
| 2E — SPEC_processing_ui (screen 5) | 0 | 2 | 1 |
| 2F — DOMAIN_MAP index | 5 | 2 | 1 |
| **Part 2 total** | **34** | **21** | **5** |
| Part 3 — retired names (as listed) | 4 | 8 | 2 |
| Part 3 — **new** items only (7 rows marked ↔ dedupe into Part 2) | 2 | 3 | 2 |

**Deduped grand total: HIGH 47 · MEDIUM 35 · LOW 10 — 92 items.**

### The five to fix first

1. **e7 / e8** (`services/feeNonpayment.js:54-63`, `services/clarificationTimeout.js:83-92`) — both auto-close
   sweeps close the parent and leave every child live with claimable tasks, and `clarificationTimeout.js:79-82`
   documents a cascade that does not exist. Live data corruption, not drift.
2. **e1–e6, e9** (`routes/feeEstimates.js:256,601,678`, `services/clarificationAction.js:55`,
   `routes/requests.js:646`) — every citizen-facing notice quotes the component-suffixed number.
   `routes/feeEstimates.js:104-107` already shows the fix idiom in the same file.
3. **e5** — `fee_waiver_status` written on one row and read on another: the citizen gets billed after a waiver.
4. **`docs/SPEC_fees_estimates_payments.md:25-43`** — a loud ⛔ warning block that code fixed in July;
   a builder reading it would re-fix solved problems and treat the MRR hub as a blocker.
5. **`backend/src/services/helpAgent.js:14-25`** — the in-app help assistant still names eleven deleted
   admin tabs as the way to reach configuration. User-facing, and a one-string fix.
