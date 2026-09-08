# SPEC — Setup & Configuration Hub (binding)

**Status:** design CLOSED 2026-08-24 (Kevin; canvas https://claude.ai/code/artifact/1c473eef-a5f6-47bd-a766-1003e9393060,
artboards in `docs/mockups/setup_hub/`, inventory in `WORKING_setup_inventory.md`). **H1 BUILT 2026-08-25.**
**Prerequisite:** `SPEC_user_type_model.md` (S1–S6 built) — the hub gates on permission groups and the `go_live`
authority and on nothing else (Kevin 2026-08-24: no stopgap).

## 1. What it is
One page — Administration → Setup — that replaces the seven-phase wizard as the front door. Everything the city
has to decide before it can answer records requests for real, as **six lanes (five until C7, 2026-08-29) of plain-language items**. Each
item opens the screen that sets it (the row is the button); its **state is counted from what is actually
configured**, never from a checkbox; a person may additionally **mark it done** (sign-off Option A).

## 2. Lanes and owners (Kevin's names, 2026-08-24)
| lane | title | owner = permission group(s) |
|---|---|---|
| 1 | Compliance and Policies Setup (C16, 2026-08-30: `law_updates` renamed "Update Configuration" → its own screen `/setup/update-configuration`; `redaction_rules` → `/setup/redaction-rules`; the admin Update Configuration and Redaction Rules tabs retired, `/rule-updates`, `/redaction-rules`, `?tab=updates`, `?tab=redaction` redirect) | `compliance_policy`; Legal sections `legal_rules` (Senior Legal owns; Director may) |
| 2a | Request Fulfillment Process Setup — Fees, Estimates and Routing (C8, 2026-08-30: the `fee_rates` "What this city actually charges" and `fee_test` "Try a test estimate" rows retired — both are Fee rules content, the schedule and its "Test an estimate" tab; `settlement` now waits on `fee_law`; C11, 2026-08-30: `time_budgets`, `time_tracking`, `notifications` moved to System Features and Options; C15: `routing_rules` renamed "Workflow Rules" → its own screen `/setup/workflow-rules`, `process_map` "Process Map" ADDED → `/setup/process-map` — the admin Workflow and Process Map tabs retired, `/workflow`, `/workflow-map`, `?tab=workflow`, `?tab=map` redirect. Kevin will rename this lane once its contents settle) | `operations_config` |
| 2b | Request Fulfillment Process Setup — Redaction and Release (C11, 2026-08-30: `av_redaction` "Video Redaction Options" ADDED — the v1 Configuration Redaction tab as a dedicated screen, `/setup/video-redaction`) | `operations_config` |
| 3 | Organization Departments, Teams, and Staff Setup | `operations_config` |
| 4 | Technical Setup (C10, 2026-08-30: the `auth_policy` row is named "User Authentication Setup"; C11: it doors to its own screen `/setup/authentication`; `agent_rules` moved to System Features and Options; C14: `sources` renamed "Record Sources and Connectors", doors to its own screen `/setup/record-sources` (the admin Sources tab retired; `/sources` and `?tab=sources` redirect); C12: `ai_keys` + `ai_deployment` MERGED into one row `ai_config` "AI configuration" → `/setup/ai-configuration`, four tabs — AI Service Keys · Deployment Model · AI Touchpoints Information · AI Portal Security Information (C13: the informational Portal Agent Security admin page, retired; `/portal-security` and `?tab=security` redirect to it); the hidden Integrations tab and the AI Data Flow admin tab retired, `/integrations`, `/ai-data-flow`, `?tab=integrations`, `?tab=ai-data` redirect there) | `system_admin` |
| 5 | System Features and Options (added 2026-08-29, C7: feature-catalog screens — Taxonomy first; the fulfillment lane's "Record types and categories" row moved here renamed, same key/deps/reader; the admin Taxonomy nav tab retired; C11, 2026-08-30: `time_budgets` "How many days a task should take" `/setup/time-budgets`, `time_tracking` renamed "Task Processing Time Capture" `/setup/time-capture`, `notifications` renamed "System Notifications" `/setup/notifications`, `agent_rules` renamed "Portal Agent Rules" `/setup/agent-rules` (row gate `system_admin`, matching its API — audit 2026-08-31) — each a dedicated screen wearing the shared `components/setup/SetupScreen` strip; C17: `taxonomy` (and the `calibration` / `record_owners` doors) → `/setup/taxonomy`, the hidden admin Taxonomy tab retired; User Types → `/setup/user-types` (no hub row; reached from Organization → Staff), the hidden User Types tab retired) | `operations_config` |
The **agency identity** card sits above the lanes ("Start here"; `operations_config` or `system_admin`). **Go-live**
is the last row of lane 1; it is flipped on the Jurisdiction Configuration page by the `go_live` authority
(ORO System Administrator **or** ORO Director) and is never "marked done".

## 3. Items
_Item counts quoted inside the slice table further down (36, 35, [10,8,5,4,7]…) are as of each slice; the current catalog is 34 items in six lanes [10,3,6,4,5,5] and the request-rules tabs are items 1–5 of 10 since C1 removed the jurisdiction row (audit 2026-08-31)._

The 34 items (35 before C8; 33 after it; 34 with C11's `av_redaction`; 33 after C12 merged the two AI rows; 34 with C15's `process_map` — all 2026-08-30) and their doors, dependencies and readers are the catalog in `services/setupHub.js` (`ITEMS`) —
the inventory's numbering maps 1:1, with five amendments: `eligibility` ("Requestor eligibility")
ADDED to the compliance lane (R1, 2026-08-27), `waiver_policy` RETIRED into the fee_law row (F2, 2026-08-27,
renamed "Fee rules"), `deposits` ("Deposits and payment clock") RETIRED into the same row (F3, 2026-08-29),
`intake` ("Request Intake") ADDED as the request-rules screen's 5th tab (I1, 2026-08-29), and the
`jurisdiction` row ("Which state's law this city follows") DELETED (C1 cleanup, 2026-08-29: it doored to the
same agency screen as the Start-here card, whose Attest signs the identity section via the fold; rows that
waited on it wait on `agency`, the stronger fact — fields complete AND state locked) — compliance lane 10.
Five items have **no screen yet** (2.9 redaction automation, 2.10 release switches, 2.12 decision reasons,
2.13 bulk schedule, 4.7 settlement): their rows render with a counted state and "no screen yet" and no door.
Building those screens is later hub slices (H2+), decided item by item.

**C11 (Kevin 2026-08-30) — the v1 Configuration page RETIRED.** Its six tabs are six dedicated screens, one hub row each: Authentication → `/setup/authentication` (`auth_policy`) · Notifications → `/setup/notifications` (`notifications`) · Redaction → `/setup/video-redaction` (`av_redaction`, new) · Time Tracking → `/setup/time-capture` (`time_tracking`) · Task Time Budgets → `/setup/time-budgets` (`time_budgets`) · Agent Rules → `/setup/agent-rules` (`agent_rules`, which had doored to the Portal Agent Security tab while its reader counted `agent_rules` rows). All wear the shared `SetupScreen` strip (state pill → hub, evidence, lane, Attest = the row's done-mark). `POST /api/config` now admits `av_redaction_mode` (it was read by `routes/avRedaction.js` but the v1 tab's Save silently dropped it) and lets `operations_config` holders write the four operational keys (`overdue_alert_days`, `escalation_days`, `ack_email`, `av_redaction_mode`); everything else stays system-authority. `/config` and `/admin?tab=config` land on the hub. The `time_tracking` reader now reads the real per-screen time-capture setting. Still to revisit after this (Kevin): AI Service Keys and the other hidden admin tabs.

## 3b. Dependencies and marks (fixed 2026-08-31)
A prerequisite MARKED done counts as ready for its dependents — readiness is computed through the dependency
chain, a mark never overrides `needs_attention`, and a marked row whose own prerequisites are not ready is
still waiting. (Before: the dependency pass ran before marks applied, so email marked done left System
Notifications waiting forever. `verify_setup_hub` C4.)

## 3c. The golden-setup harness (2026-08-31)
`tests/verify_golden_setup.js` configures a city end-to-end through the real APIs on the test DB — agency lock,
organization, fee rules (every deferral decided, waiver, clock + six settings, approve v1), request rules,
every remaining policy setting, proposals, every hub row marked, every section attested — and asserts
go-live `ready === true`, the guide all green, the sandbox prices, and a portal submission gets a priced
estimate. It runs LAST in the suite (before the reset) and cleans its marks and users. A refusal along the
way is printed as a NOTE — the harness exists to say where the product cannot be configured through its
own doors.

## 3d. THE APPROVAL MODEL — three colours, the screen owns its indicator (Kevin 2026-08-31, BUILT for Agency first)
Supersedes "Mark it done" as the user-facing sign-off (the mark is still the record). Every setup item shows
one of three colours, and **the screen is the source of truth** — the Set Up Guide's bar only reads it:
- **RED** — a required field is empty (forms), or nothing is entered. Required fields are marked on the
  screen (red border + "Required — enter a value and save") until saved.
- **YELLOW** — every required field is saved and the item awaits the lane owner's **approval** ("Approve —
  attest as complete", one approver per screen, the existing group gate); OR the item was approved and a
  saved change moved it since ("changed since approval by X on date — awaiting re-approval").
- **GREEN** — approved and unchanged since.
Mechanics (`services/setupHub.js`): a reader may report `required {missing, total}` and a `digest` of the
screen's content; `mark()` is refused 422 `REQUIRED_MISSING` while red and stores the digest; a screen's
write path calls `afterChange(key, actor)` after a save, which notifies the lane owners ONCE per change
(`notifications` kind `setup_reapproval`, dedupe per item); **an approval withdraws the item's open
`setup_ready` / `setup_reapproval` notices for EVERY owner** (`mark()` → `notifications.resolveContext`;
Kevin 2026-09-08 — approving from the screen without opening the bell used to leave the notice orphaned for
good, and because `emit()` dedupes against undismissed rows the orphan swallowed the next real notice for
that item; withdrawing a declaration or emptying a required field withdraws the `setup_ready` notice the
same way — the ask is void); `build()` computes `approval` /
`approvalWhy` / `changedSinceApproval` per item and page-level `colours` + `goLiveColour`. Items whose
reader has no `required` yet derive a colour from the counted state (ready → green; in progress / needs
attention → yellow; else red) — each such screen is converted one at a time (list screens like Staff get a
"Complete — submit for approval" act instead of required fields). **Agency is the first converted screen**
(`verify_setup_hub` H1–H7). **Settings and Configuration is navigation only** (`SetupHubPage`: four logical
groups, no status, no marks). **Go Live lives on the Set Up Guide's header**: red until nothing is red,
yellow while anything is yellow, green (confirmation dialog, `go_live` authority) when every bar is green;
"Live" once flipped — the Jurisdiction Configuration flip is no longer the only door.

## 3e. LIST SCREENS — "Ready for approval" (Kevin 2026-08-31, BUILT for Record Sources first)
A list screen has no save button and no required fields — items are added and deleted, over days or weeks.
Its reader reports `list {count, notConnected, noun}` + a `digest` of the list. Colours: **red** = nothing
added · **yellow, in progress** = one or more items, nobody has declared the list complete (quiet: no
notifications while it grows) · **"Ready for approval"** = a button in the strip for anyone who may edit the
screen — the adder's declaration that the list is complete; recorded by name (`setup_hub_ready`), the bar
reads READY FOR APPROVAL, ONE notification to the lane owners (`setup_ready`); a signal, never an approval;
withdrawable (and withdrawing it withdraws the owners' notices) · **green** = the lane owner approves (clears
the declaration and every owner's notice) · **green → yellow** = any
add/edit/delete after approval, automatically, with the one re-approval notification (the routes report
through `afterChange`; `routes/repositories.js` does it in a router-level finish hook). The evidence line
carries health ("3 connectors · 1 not connected") — never blocks the colour, but the approver sees it.
`POST/DELETE /setup-hub/:key/ready`; refused 422 `NOTHING_ADDED` while red, 400 `ALREADY_APPROVED` while
green-unchanged. `verify_setup_hub` I1–I5. Same model next for Departments, Teams, Staff, Taxonomy, Workflow
Rules.

**Deleting from the organization lists — BUILT 2026-09-08** (Kevin: "I see no way to delete a city department,
a fulfillment team, or a staff member"; nothing in the org model carries a foreign key, so deletion is a
PROCESS, `services/orgRemoval.js`). Every row on the three Organization tabs has **Delete**; it opens a dialog
that reads `GET /departments/:id/removal` or `GET /staff/:id/removal` — each prerequisite as a STEP with a
count, a plain sentence, and either a link to the screen that clears it or an inline action (a person's first
step is "Deactivate now"). `DELETE` re-runs the check and refuses **409 `REMOVAL_BLOCKED`** with the same list
while a step is open. Steps — department: Open Records hub flag · catch-all flag · record types naming it as
owner/fulfiller (Taxonomy → Owners) · open requests it owns · active staff calling it home. Team: hub flag ·
departments it fulfills (edit another team to take them) · open pool tasks · open requests routed to it ·
active members · team-scoped user types held on it. Person: not yourself · account still active · open tasks
assigned · open requests assigned · the only active `manage_users` account. Once clear, the FOOTPRINT decides
the outcome, never the caller: no closed requests / released records / finished tasks / history / approvals
→ **delete** (row gone); otherwise **retire** — the row stays for the record, hidden from every list and pool
(`departments.active = 0` with `processed_by`/catch-all cleared; `users.status = 'removed'` with user types,
task subset, routing profile, home team and notifications stripped, tokens bumped; login accepts `active`
only, `GET /staff` hides `removed`). The dialog says which outcome applies before the click. Permissions as
the create paths: `operations_config` for departments/teams, `manage_users` for people. The routers' finish
hooks report the DELETE, so an approved list drops to yellow. Harness `verify_org_removal` (A1–A7, B1–B5,
C1–C12).

## 3f. TABBED SCREENS — sections of one item (Kevin 2026-08-31, BUILT for AI configuration first)
A configurable tab has its own required set and its own colour: red while any of its required fields is
empty, yellow when complete, green once the SCREEN is approved. Informational tabs carry nothing. The screen's
pill is the WORST tab; its line names the tab and the field ("AI Service Keys: Anthropic key · Deployment
Model: GovCloud region"); ONE approval for the whole screen (refused while any tab is red); a change on any
tab after approval → yellow with one notification. Mechanics: the reader's `required.missing` entries are
prefixed by tab and it reports `tabs {key: 'red'|'ok'}`; `build()` turns that into per-tab colours the tab
bar shows as marks. AI configuration: Service Keys (Anthropic + Voyage) · Deployment Model (a model chosen;
Government adds region, Titan model, Bedrock key + secret). `verify_setup_hub` J1–J7.

## 3g. Converted screens (running list)
| Item | Pattern | Required set | Change hook |
|---|---|---|---|
| Agency (`agency`) | form | name, short name, jurisdiction type, address line 1, city, state, ZIP, contact email, contact phone + the state lock | `routes/agency.js` PUT + lock |
| Record Sources (`sources`) | list | ≥1 connector; "Ready for approval" | `routes/repositories.js` finish hook |
| AI configuration (`ai_config`) | tabs | Keys: Anthropic + Voyage (environment counts) · Deployment: a model; Government adds region, Titan model, Bedrock key + secret | `routes/integrations.js` POST |
| Email configuration (`email`) | form | provider; SMTP: host, port, from address · Resend: key, from address (the test send is evidence only) | `routes/integrations.js` POST (+ `routes/config.js` for the alert address) |
| User Authentication Setup (`auth_policy`) | form | auth mode, MFA mode, session timeout, minimum password length — SAVED, a shipped default is not a decision | `routes/config.js` POST |
| City departments (`departments`) | list | ≥1 department; "Ready for approval" | `routes/departments.js` finish hook (reports `departments` + `teams`) |
| Fulfillment teams (`teams`) | list | ≥1 team; health: departments with no team to serve them | same hook |
| Staff (`staff`) | list | ≥1 active person; health: people with no user type | `routes/staff.js` finish hook |
The three organization rows share the Organization screen (`/org?tab=…`); each tab wears the strip of its own row.
| Fee rules (`fee_law`) | tabs (decisions) | every deferral decided · both waiver choices · the clock's six when on · an APPROVED schedule version — exactly what the screen offers; the fees/fee_waiver/payment section knobs the screen does not surface stay with go-live (audit §3-E) | `routes/feeLaw.js` hook |
| Clarification · Exemptions · Eligibility · Intake · Deadlines (5 rows) | decisions | every unconfirmed local policy setting of the row's section (`sectionRequired`) — the same rule go-live counts | `routes/requestRules.js` hook + `policy-settings/confirm` (domain → item) |
| Redaction rules library (`redaction_rules`) | list | ≥1 rule approved AND in effect; health: rules waiting for a supervisor's approval · rules approved but switched off; "Ready for approval" and the approval are `legal_rules` acts (the row is a legal section) | `routes/redactionRules.js` finish hook (+ `policy-settings/confirm` domain `redaction`, already mapped) |
| Update Configuration (`law_updates`) | form | the review queue is EMPTY (every proposed change approved or discarded) + both reminder settings SAVED (how often, who receives it) | `routes/configFreshness.js` finish hook |
| Taxonomy (`taxonomy`) | list | ≥1 active record type; health: discovered drafts to review | `routes/taxonomy.js` finish hook (reports all three rows) |
| How much work each record type takes (`calibration`) | list | ≥1 calibrated record type; health: how many are still to calibrate | same hook + `routes/estimateProfiles.js` finish hook |
| Which department owns which records (`record_owners`) | list | ≥1 ownership assignment; health: record types with no owner | `routes/taxonomy.js` finish hook |
The three taxonomy rows share the Taxonomy screen (`/setup/taxonomy?tab=calibration|owners`); the body is one page (the content really is shared) and the `?tab=` chooses which row the strip signs off.
| Workflow Rules (`routing_rules`) | list | ≥1 ENABLED routing rule; health: rules written but switched off | `routes/workflow.js` finish hook |
| Process Map (`process_map`) | acknowledgement (§3j) | nothing — the required set is empty; the lane owner's approval IS the act | none (no write path; the digest is the shipped model) |
| How many days a task should take (`time_budgets`) | form | every task type's budget REVIEWED by the city (`source = 'supervisor'`) — the catalog seeds a figure into every row, so "has a number" proves nothing | `routes/config.js` PUT `/config/time-budgets` |
| Task Processing Time Capture (`time_tracking`) | form | ONE item — the per-screen blob has been saved. Off on every screen is a valid posture (states differ on which labor is chargeable); shipped silence is not | `routes/config.js` PUT `/config/time-capture` |
| Portal Agent Rules (`agent_rules`) | list | ≥1 rule IN FORCE; health: rules written but switched off. Declared and approved by `system_admin` (the row's own gate, matching its API) | `routes/agentRules.js` finish hook |
| Video Redaction Options (`av_redaction`) | form | the mode SAVED — the screen shows "internal" with nothing stored, which is the shipped default; choosing internal deliberately is a decision and saving it says so | `routes/config.js` POST (already mapped) |
| Redaction layout templates (`layout_templates`) | list | ≥1 template; health: record piles the variant scan flagged that still have no template. The Mass Redaction screen (`/mass-redaction`) now wears the strip — it is the row's only approval home | `routes/redactionTemplates.js` finish hook, LIBRARY CRUD ONLY (`POST /`, `PATCH /:id`, `DELETE /:id`) — applying, staging, matching and batch-running a template is work, not setup |

`routes/config.js` also reports changes to `notifications` (Staff Alerts, §3i), `av_redaction`, `time_budgets` (PUT `/config/time-budgets`) and `time_tracking` (PUT `/config/time-capture`) — all converted.

**Redaction rules library — design notes (2026-08-31).** A rule has its OWN two-step life (`approval_status`:
a supervisor approves the rule · `is_active`: it is in effect) and that is NOT the hub's approval. Only a rule
that is both approved and in effect counts toward the list; everything else is the health line the lane owner
reads before approving ("4 waiting for approval · 1 approved but not in effect"). The `redaction` PROFILE
SECTION is still attested on Jurisdiction Configuration — this row carries no `foldSections`, because the
redaction rules-engine content is its own planned slice (I1's closing note); folding it belongs there.

**Update Configuration — why a review queue is a FORM (2026-08-31).** The screen holds a QUEUE (proposed
changes waiting to be approved or discarded) and a small settings form (reminder cadence + recipient). It is
not a list screen: nobody "declares the queue complete", and an empty queue is not an empty list — it is the
finished state. So **"no proposals waiting" is a required item**: each pending proposal is a named missing
item ("Review the proposed change (fee): …"), and a proposal that arrives after approval re-opens the row to
RED (red wins over changed-since-approval, and the counted state stays `needs_attention` — the row is asking
for work, not for a signature). The two reminder settings are required as SAVED decisions, the Authentication
precedent: the 182-day cadence and the fall-back-to-`contact_email` recipient are shipped defaults, and the
status payload now carries `saved: {cadenceDays, recipient}` so the screen can outline an unsaved one in red.
OPEN (see `WORKING_setup_conversion_questions.md` Q1): a proposal created by the nightly freshness scan turns
the row red with NO notification — only screen-driven changes report through `afterChange`.

**Taxonomy, calibration and record ownership — three rows, one shared body (2026-08-31).** Organization
splits its three rows into three TABS because departments, teams and staff are three different lists. The
Taxonomy screen's three rows are three different QUESTIONS about the SAME list of record types, so splitting
the body would mean showing the record types three times. The screen therefore keeps one body and the
`?tab=` picks which row the strip is signing off (a "Setting up" pill row switches it without leaving the
page). Counts are what the row can honestly claim: calibration counts the types actually CALIBRATED (a city
may stop before covering all of them — the rest is health, not a blocker), ownership counts the assignments
made. `routes/taxonomy.js` reports all three (a deleted record type moves every one of them);
`routes/estimateProfiles.js` reports `calibration`.

## 3g′. FORM AND TABBED SCREENS SUBMIT THEMSELVES (Kevin 2026-08-30, BUILT)

A form or tabbed screen has no "Ready for approval" button — the save that fills the LAST required field is the
submission. `afterChange(key, actor)` on an unapproved item with a `required` set: if nothing is missing and
no `setup_hub_ready` row exists, it records the saver's name there and sends the lane owners the same
`setup_ready` notice a list screen's declaration sends ("Ready for approval: <screen> — <who> saved the last
required item…"). Further saves while still complete send nothing; a save that empties a required field
clears the record AND the owners' `setup_ready` notices so the next completion notifies again; approval
clears both too (`mark()`). The guide's yellow text carries "submitted by <who> on <date>, approver
notified". `notifications.emit` dedupes per user/kind/context while the earlier notice is undismissed, so an
approver never sees two identical nudges — which is exactly why a notice the system no longer means must be
withdrawn by the system, not left for each owner to dismiss. Harness: `verify_setup_hub` H3b/H4b/H6b,
I3b/I3c/I4b, K2b, K3b–K3d.

## 3i. STAFF ALERTS — the `notifications` row renamed, two tabs, the alert catalogue (Kevin 2026-08-30, BUILT)

"System Notifications" was a mislabel: the screen held two deadline thresholds and one piece of requestor
correspondence, and nothing anywhere listed the in-app alerts. Kevin's ruling: the distinction that holds is
WHO an alert is for, not how it travels. Requestor correspondence (acknowledgement, clarification, estimate,
closure letters) is configured under Request rules; **Staff Alerts** (`/setup/staff-alerts`; `/setup/notifications`
redirects) is everything the bell tells staff.
- **Alerts tab** — the catalogue, rendered from `services/alertCatalog.js` via `GET /setup-hub/alerts`: every
  `kind` with its bell title, when it is sent, who receives it, in plain words. Read-only; NO per-alert on/off
  (Kevin: none of these should be switchable off today; a future alert may earn one). `notifications.emit()`
  warns on a kind missing from the catalogue, so a new alert cannot ship unlisted. Counts nothing toward colour.
- **Deadline alerts tab** — `overdue_alert_days` + `escalation_days`, both SAVED (tabbed pattern: the tab mark is
  red until then; the screen's pill is this tab alone; one approval).
- The **requestor acknowledgement on/off** is NOT a separate switch (Kevin 2026-08-30, folded): Request Intake's
  choice "The acknowledgment, and when it goes out" (`Master.g4`) already carries "No automatic acknowledgment"
  (`no_auto`). `requestCreate.acknowledgementOn()` reads it — the email goes out unless the city has CONFIRMED
  `no_auto` (unconfirmed = send, the statutory-safe default). The `ack_email` system_config key is retired:
  dropped from `/config`'s allow-list and the hub's readers; nothing reads it.
Harness: `verify_setup_hub` N1–N3; golden D5c; request-rules IN4b.

## 3j. ACKNOWLEDGEMENT SCREENS — nothing to fill in, and reading it is the act (2026-08-31, BUILT on Process Map)
A fourth, small pattern for a setup row whose screen sets NOTHING: it explains how the product behaves and
the city's only act is to read it and say so. Before the approval model these rows were counted `ready` and
therefore GREEN before anyone had looked at them — the one colour the model must never hand out for free.
Mechanics: the reader reports an EMPTY required set (`required: {missing: [], total: 0}`) plus a digest of
the material. Colours then fall out of the form pattern unchanged — **yellow** "complete — awaiting approval"
from the first page build (there is nothing to fill in, so it is never red), **green** on the lane owner's
approval, and **yellow again** if the material changes under it (a release that adds a decision point
re-opens the row for a fresh read). There is no write path, so no `afterChange` hook and no notification —
the guide's colour is the whole signal. Process Map is the first (and so far only) screen on this pattern;
`verify_setup_hub` R4–R5. A screen that sets even one thing is NOT this pattern — it is a form.

## 3h. HOW TO CONVERT THE NEXT SCREEN — the recipe (2026-08-31)
Pick the pattern by what the screen is, then do these steps; every converted screen so far follows them.
1. **Reader** (`services/setupHub.js` READERS[key]) — keep the counted state/evidence and ADD, via `ev(state, line, extra)`:
   - **form:** `required: { missing: [labels], total }` for the fields the SCREEN offers (never something it cannot set), and
     `digest: digestOf([...every saved value the screen holds])`.
   - **list:** `list: { count, noun, health? }` (+ `notConnected` for connectors) and a `digest` of the rows.
   - **tabs:** `required.missing` entries prefixed `"<Tab name>: "` and `tabs: { <tabKey>: 'red'|'ok' }`.
   - **decisions (profile section):** `return withSection(sectionEvidence(sec), sec)` — done.
2. **Change hook** — the screen's write route(s) call `HUB.afterChange('<key>', actorName)` after a successful save.
   Router-level: `res.on('finish')` for POST/PATCH/PUT/DELETE (see `routes/repositories.js`); one handler:
   call it before `res.json` (see `routes/agency.js`). Settings saved through `routes/config.js` /
   `policy-settings/confirm`: extend the key→item / domain→item maps there.
3. **Screen** — if it uses `components/setup/SetupScreen` nothing else is needed (pill, Approve/Re-approve,
   Ready for approval on lists, changed-since notice are automatic). A screen with its own strip copies the
   Agency/Email pattern: `APPROVAL` colours, `ap = hubRow.approval`, `approvalWhy` in the line,
   `attested = signoff && !changedSinceApproval && ap !== 'red'`, button label from `changedSinceApproval`,
   Approve disabled while red. Forms mark empty required fields (red border + "Required — enter a value and
   save"); tabbed screens put a colour mark on each configurable tab from `row.tabs`.
4. **Doors** — one row per screen, or `?tab=` doors when several rows share a screen (Organization, Request rules).
5. **Harness** — a section in `verify_setup_hub` walking red → refused (422 REQUIRED_MISSING / NOTHING_ADDED) →
   yellow → green → a change → yellow + one notification; save/restore the config keys it touches. If the
   golden harness marks the row, make golden set what the row now requires.
6. **Spec** — a row in the §3g table.
Refusals to keep: a screen's required set is only what it can set itself; a shipped default is not a
decision (Authentication); environment-provided secrets count as set (AI keys); lists stay quiet while they
grow; approval is one act per screen by the lane owner.

## 3a. The Set Up Guide tab (G1, Kevin 2026-08-30)
The Administration page has two tabs: **Settings and Configuration** (the hub, above) and **Set Up Guide** —
Plan A from `docs/mockups/setup_hub/PlanGantt.dc.html` (chosen 2026-08-24, built 2026-08-30 as
`pages/SetupGuidePage.js`). Same `GET /api/setup-hub` payload, no second catalog: one row per item grouped
into six phases (Foundation = the agency card · Technical connections = technical lane · People and
departments = organization lane · Review the rules the law set = compliance lane minus go-live · How this
city works a request = fulfillment-fees + redaction + features lanes · Go live); the column is the STEP,
computed live as 1 + max(step of deps) (agency = 1, no-deps = 2, go-live = last); the bar is the item's
counted state; arrows are the dependencies, one trunk per source; dashed lines run from last-step leaves
into go-live; a row click opens the item's door. This is the first step of retiring the Jurisdiction
Configuration screen (Kevin's process, 2026-08-30).

## 4. States (counted)
`ready` · `in_progress` · `not_started` · `needs_attention` (was finished, came undone: drift, pending
proposal, rate above a limit, failing connection) · `waiting` (a prerequisite is not ready). Rules:
- The evidence line names the gap ("17 of 23 answered", "provider set · no test message sent").
- Running on shipped defaults is a real answer and says so.
- **Dependencies are open with warning, never a lock**: a waiting row keeps its door, is dimmed, and its
  "Why" explains what it waits on with a button to the prerequisite. An item's own counted progress wins
  over "waiting" (work done by hand is real).
- **Mark it done** (Option A): a member of the lane's group records the item ready; shown by name and
  date; reversible; it does not override `needs_attention` or `waiting`. Kevin may later make Ready
  conditional on validation per item (`signoffRequired` hook).

## 5. API
`GET /api/setup-hub` (any signed-in user) → `{counts, top:[agency], lanes:[{key,title,ownerLabel,groups,ready,total,canEdit,items:[…]}]}`;
each item `{key,name,door,noScreen,legal,goLive,deps,state,evidence,waitingOn?,why?,signoff?,canEdit}`.
`POST|DELETE /api/setup-hub/:key/done` — lane group (`legal_rules` for legal sections); go-live 400.
Sign-offs live in `setup_hub_signoffs(item_key PK, marked_by, marked_by_name, marked_at)`.

## 6. Verification
`verify_setup_hub`: catalog shape and lane counts; every dep real; owners are groups only (no role names in the
service); evidence is counted (an unserved department flips Teams; a pending proposal flips Law updates);
waiting rows keep their door; go-live not markable; marks gated per lane / legal; reversible; the page builds
even when a reader throws.

## 7. Slices
| # | Slice | Status |
|---|---|---|
| H1 | Hub service + API + page (counted evidence for all 36, sign-offs, Why, lane gating); replaces the Setup tab | **BUILT 2026-08-25** |
| H2 | Screens for the no-door items (1.7, 2.9, 2.10, 2.12, 2.13, 4.7) — one at a time, design first | open |
| H3 | Load the state rule profile from the agency screen (inventory 1.2) — **BUILT 2026-08-25** as a button, not a save side-effect: `/setup/agency` ("Agency name, address and contact", the hub's Start-here door) carries the shared status strip (chip → hub · the hub's evidence · Attest = the item's sign-off) and **"Lock state and load its rules"** → confirm → `POST /api/agency/lock-state {state}` = `stateTemplateImport.importState()` + profile `active` + `system_config.jurisdiction_profile` + `state_locked_at/by`. Once (409 after); refused for a state with no rules file (422). Agency fields (name, short name, jurisdiction type, street + optional mailing address, contact email/phone) live in `system_config` via `GET/PUT /api/agency`, gated by the agency item's groups. The hub's `agency` reader counts all of them and reads `in_progress · state not locked` until the lock. The v1 Configuration "Agency" tab is removed. `verify_agency_setup` 18/18. Design: `WORKING_hub_linked_screens.md` §0–§1. | built |
| F1 | **"What the law lets you charge" — BUILT 2026-08-26** (`/setup/fee-law`, `services/feeLaw.js`, `routes/feeLaw.js`; canvas `docs/mockups/hub_links/fee_law/`, WORKING §2b). The 35 verified fee items are read from the locked state's template file (identical key set in all 32; `parseValue` turns the prose into figures). **State mandate** window (basis fixed/ceiling/floor, 22 in TX): law figure read-only; **ceiling rows carry a city rate that defaults to the ceiling** (Kevin 2026-08-25) and are refused above it; fixed rows "as law"; floor rows start at the minimum; two items flagged "needs requestor ledger". **Deferral** window (13 in TX): a figure, "none" or "actual"; or a fee policy document (text/paste → `feePolicyExtract`) filed as `document` decisions with the extractor's citation as reference. Decisions live in `jurisdiction_rules` domain `fee_schedule_decisions`. **Approve** is refused while a deferral row is undecided, passes the state fee-bounds gate, and writes ONE `fee_profiles` row (FR, version n, active; previous active → superseded, never edited) mapped by each item's engine path, plus a `config_history` row carrying every decision. Hub `fee_law` reader: no jurisdiction → not_started; decisions but no version → in_progress "no fee schedule version yet"; version → in_progress "fee schedule vN · not yet confirmed" → attest → ready. Door `/setup/fee-law`. **Layout (Kevin 2026-08-26): four tabs** — State mandate · City decisions · Fee policy document · **Test an estimate** (the live fee-engine sandbox, `/api/fee-sandbox/preview` against the ACTIVE schedule, with "It behaves correctly / Something is off" → `/api/onboarding/fees/test-result`, which the hub's `fee_test` row reads; `fee_test` door → `/setup/fee-law?tab=test`). Every authority citation opens the research record (`/jurisdiction-profile/rules-research/:id`, verbatim statute language). `verify_fee_law` 22/22. Not in this slice: PDF text extraction (text/paste only), graduated page bands (were a rate-table edit; **C9, 2026-08-30: the v1 Fee Configuration screen is RETIRED** — it loaded blank and Fee rules is the schedule; `/fee-config` and `/admin?tab=fees` redirect to `/setup/fee-law`; until bands get a Fee rules surface they are reachable only through `PUT /api/fee-profiles/:id`), the SS context. | built |
| R1 | **"Request rules" — the three-tab screen — BUILT 2026-08-27** (`/setup/request-rules`, `services/requestRules.js`, `routes/requestRules.js`; canvas `docs/mockups/hub_links/clar_exempt_elig/`, WORKING §2f, decisions Kevin 2026-08-27: design approved · new hub row **`eligibility` "Requestor eligibility"** in the Compliance lane · three doors, each opening its MATCHING tab (`?tab=clarification|exemptions|eligibility`) · letters stay standard wording until the letter-template slice). One screen, three hub rows; the status strip follows the active tab. **Law panels** walk the locked state's template file for concept-keyed rule arrays (`collectRules`; clarification / appeal+denial / eligibility domains — TX: 4/10/4, the readable doc's exact lists); every citation opens the research record. **Clarification tab:** the import files the domain `enabled:false`; the MASTER SWITCH (`POST /api/request-rules/clarification/enabled`) is the act that lets the row leave Not started — it materializes the five choices (Master.bv, Clarification.n2/n3/close/d4) as `city_config` knobs in the clarification domain (idempotent; `clarificationPolicy.normalize/validate/write` now carry `knobs` through so a policy write can never erase a recorded decision) and fills the statutory fields the template settles (`statutoryGraceDays`: TX 61 d § 552.222(d) → `clarification_grace_days` + `abandonment_closure:'allowed'`; MO 90 / VA 30 found too). Choices are recorded via `POST /api/request-rules/clarification/confirm` (goLive.confirm + write-through of reply-window days and closing-notice to the policy fields); the reply window renders FIXED when statutory. **Exemptions tab (Legal Rules):** the 4 existing `knobs/Denial.*` settings — reasons = "comes from the Redaction rules library" acknowledgement card (live approved-rule count; NOT `decision_reasons`) · approval = permission-group select (legal_rules suggested) · denial letter = standard structure view (no generator exists yet; drafted at denial compose) · denial-letter service deadline (days). Confirms ride the EXISTING `/jurisdiction-profile/policy-settings/confirm` (Legal-Rules scoping). **Eligibility tab:** gated dimensions render as decision cards; `POST /api/request-rules/eligibility/posture` sets `gated` + `confirmed` in one act (never creates a dimension); ungated dimensions listed under "Nothing else to decide". Attest per tab = the hub sign-off, enabled when the tab has nothing unconfirmed (clarification also requires the switch ON). Shared `frontend/src/components/StatutePopup.js` extracted from FeeLawPage. `verify_request_rules` harness. | built |
| F2 | **"Fee rules" — the fee-law screen absorbs fee waivers — BUILT 2026-08-27** (Kevin's calls: broader title **"Fee rules"** ("Fee Parameter Domain" considered, dropped for the register and the domain-word overload); NO fifth tab — a "Fee waiver" SECTION on each existing tab; the `waiver_policy` hub row RETIRED, compliance lane 12 → 11). **State mandate** gains bucket `waiver`: `feeLaw.waiverRows()` builds one row per ground the state's `waiver` template item names (match on `public_interest` / `collection_cost`) — TX: "Waiver — public interest" (Fixed, must, city column "as law — decided per request") and "Waiver — cost of collection" (new `discretionary` binding chip, may, city column echoes the De-minimis threshold; the figure's single home stays on City decisions); a state naming neither falls back to the single generic row; no waiver item → no section. Mandate 22 → 23. **City decisions** gains group "Fee waiver · 2": *who decides a waiver request* (`POST /api/fee-law/waiver {decider}` — validated `intake_review|routed_task`, recorded with who/when in `fee_schedule_decisions.waiver`, and WRITTEN THROUGH to the `approvalModules` fee_waiver module the engine reads; the engine's current routing renders as the suggested answer) and *the waiver-denial explanation* (standard-wording acknowledgement; the 5 seeded `decision_reasons` sentences shown read-only until the letter-template slice). **Gates (Kevin): the waiver choices gate ATTEST, never Approve** — fee schedule v1 still waits only on the 13 money figures. Hub `fee_law` reader appends "waivers: X of 2 decided"; the row renames to "Fee rules". Canvas `docs/mockups/fee_law_waivers/`; WORKING §2h. `verify_fee_law` +7 (A6, F1–F6), `verify_setup_hub` back to 36 items. Not in this slice: the fee_waiver Content-tab pruning (§2g canvas, separate slice) and the fee_waiver profile section's attest-through (still attested on jurisdiction-config; fold-into-fees remains open). | built |
| F3 | **"Fee rules" also absorbs the deposit & payment clock — BUILT 2026-08-29** (Kevin's calls: same F2 treatment — no new tab, no separate setup section, the `deposits` hub row RETIRED, compliance lane 11 → 10 · the six clock/reissue settings recorded MASTER-SWITCH + CONFIRMS, the clarification pattern, because they drive automation that stops clocks and withdraws requests · canvas approved before build, `docs/mockups/fee_law_payment_clock/`). The six settings ARE the `paymentClockPolicy` store (`jurisdiction_rules` domain `payment`) that `depositAction`, `feeReissue` and the tickler already read — previously configured nowhere visible, switched off with safe-manual defaults that contradict what TX law fixes. **City decisions**: the estimates group retitles "Estimates, deposits, payment and their clocks" (matches the mandate tab) and gains the switch block + six rows when on. `feeLaw.clockPrefills()` parses the state's answers from the SAME template items the mandate rows render (`payment.depositClock`: clock_effect / grace / lapse_action · `payment.reissue`: the three bools) — TX: toll_and_restart · 10 business days · withdraw · yes ×3; a template that answers none leaves open city choices (4 of 32 states carry a clock-effect answer; leaving the switch OFF is itself a valid, attestable posture — the silent-state design). `POST /api/fee-law/clock {enabled}` writes the switch through to the policy store and records who/when in `fee_schedule_decisions.clock`; `{confirm:{key,value}}` (switch must be on; strict enum validation = the policy's own) writes the value through with the importer's provenance untouched. **Gates: the switch + six confirms gate ATTEST, never Approve**; the engine's automation double gate (policy enabled AND the `payment` profile section attested) is UNCHANGED. Hub `fee_law` reader appends "payment clock: off｜X of 6 confirmed". RequestRulesPage lane indexes follow (4/5/6 of 10). `verify_fee_law` +9 (G1–G9, payment-domain snapshot/restore incl. the updated_by stamp), `verify_setup_hub` 35 items [10,8,5,4,7]. Not in this slice: the `payment` profile section's attest-through (still attested on jurisdiction-config, same deferral class as fee_waiver's) and the grace-days provenance correction (the importer filed § 552.221(e)/TX-S05 on `deposit_grace_days`; the field's answer is the § 552.263(f) 10-business-day window — reconcile in the research pipeline alongside the negative-finding records). | built |
| F4 | **Fee rules — Kevin's markup pass, BUILT 2026-09-08** (`~/exchange/fee rules set up fixes and questions.docx`). Screen: the waiver section has its own wider grid (`gridW`) and every grid cell is `minWidth:0`, so the decider select and the wording button no longer cross into the law column · **AG rate reads as money** (`$0.10`, not `$0.1`) · **None / Actual are CLICK choices** beside each deferral field (the typed words still work; delivery's actual choice is labelled "Actual postage", unit `$ per request`) · **Electronic media is decided per item** (CD / DVD / USB fields; each a figure or `actual`; `decide()` refuses a figure above that item's state ceiling by name, e.g. "DVD above 3.75"; all-empty removes the decision) · prose rules (`parse:'text'`, TX `repeat`) are **humanized** (`humanize()`: the `|` findings become sentences, `some_key:` → `Some key:`, no 87-char cut) and their city column reads "as law" · the ledger flag is plain words: **"not enforced yet: the Requestor Ledger does not read this rule"** (`GAP_LEDGER`) — kept, not removed, because `requestorLedger.js` allowances/counters are manual stubs that read no fee rule · `rules.maxFee` relabelled **"Cap on one request's total (optional city policy)"** (TX has no dollar request maximum; the AG+25% ceilings are per item) · cost-of-collection city text **"Set using De-minimis in City Decisions"** (`$X · …` once set). **Citation popup** (`StatutePopup`): every row's authority opens it; it now shows the template item's own findings + research note (`law.segments`, `law.notes`) under "What the law provides for this item" BEFORE any corpus records — the TX corpus resolves only `TX-00xx` ids, so rows citing only `TX-9xxx` (overhead surcharge, media, most of bands/cap/repeat) used to open empty or, worse, on one unrelated record. Harness `verify_fee_law` A5b–A5g. OPEN from the doc: `dup.tiers` ("bands or none") still has no real surface (F1's note stands; TX research says no bands exist); populating the `TX-9xxx` research records is a corpus task, not a screen one. |
| F5 | **Fee rules → Requestor Ledger wiring — BUILT 2026-09-08** (Kevin: "wire the ledger next"). The two rows F1 flagged "needs requestor ledger" now carry engine paths and NO gap flag: `labor.periodicFreeHours` → `requestRules.personnelTimeAllowance {hoursPerYear, hoursPerMonth, citation}` (floor row; **None** = the city declines the optional § 552.275 regime, so floor rows may be `noneOk`), `repeat` → `requestRules.sameDayAggregation` (true when the prose names the same-day rule). `services/requestorLedger.js` reads both from the approved schedule (`scheduleRules`), COUNTS personnel time from the requestor's own estimate/reconciliation rows (rolling 12 months + calendar month; exempt requestor classes never metered), fires the `all_time_chargeable` trigger at the estimate gate (the estimate route sets `request.personnelTimeExceeded` before pricing; the engine then charges every hour and bypasses the page bar), and lists same-day siblings as a MAY-aggregate advisory. Anonymous ⇒ nothing. Details + harness map: `docs/rules_research/workflow/DESIGN_requestor_ledger.md` addendum 2026-09-08. `verify_fee_law` A5/A5c/D2b · `verify_requestor_ledger` §7b. |
| A1 | **Attestation fold — BUILT 2026-08-29** (Kevin: "fold those section attestations into their absorbing screens"; resolves the attest-through residue noted at R1, F2 and F3). An ITEMS row whose screen absorbed profile sections carries `foldSections`: `clarification`→[clarification], `exemptions`→[exemption], `eligibility`→[eligibility], `fee_law`→[fees, fee_waiver, payment]. `POST /setup-hub/:key/done` now ATTESTS each folded section FIRST (JP.attest — a refusal, e.g. an unconfirmed knob, fails the whole act 422 ATTEST_REFUSED in words and writes no mark; a not_configured section is SKIPPED, not an error — `payment` with the clock switch off stays un-attested by design, so automation's enabled+attested double gate never half-arms), then writes the mark; the response carries `attested`/`skipped`. `DELETE …/done` unmarks and un-attests every folded section. One act, one home: the screens' "Attest as complete" is now the section sign-off; drift still degrades the row/strip (sectionEvidence needs_attention beats the mark) and demands re-attest through the same button. Jurisdiction-config keeps Content/Provenance/Proposals and DRIFT display for folded sections but its attest rail is replaced by a pointer + door to the absorbing screen (`jurisdictionProfile` sections expose `foldedInto {item,name,door}`; stale editor strings updated to the absorbing doors). The `/jurisdiction-profile/attest` ROUTE stays as the mechanism (permission scoping lives and is tested there; the go-live gate reads attestations regardless of path). Permission parity holds: the hub gate already demands legal_rules on legal rows (exemptions) and the lane groups elsewhere. `verify_request_rules` +2 (E6a/E6b), `verify_fee_law` +2 (E3a/E3b); verify_setup_hub D4's mark/unmark cycle is fold-clean. | built |
| D1 | **"Request rules" 4th tab — Response deadlines and tolling — BUILT 2026-08-29** (Kevin's call: deadlines migrates next, as a 4th tab on `/setup/request-rules`; canvas approved before build, `docs/mockups/request_rules_deadlines/`). The hub row STAYS — only its door moves to `?tab=deadlines`; the A1 fold covers it (`foldSections: ['deadlines']` — Attest on the tab signs the deadlines section, a LEGAL section, so the strip's gate is `legal_rules`). **Law panel**: `TAB_CONCEPTS.deadlines = ['production','response']` — exactly TX_RULES_READABLE §3's four rules (TX-0008/0009/0010/TX-S04). **Clock table**: `ruleEditors.timerTable` (now exported) re-served for the tab — statutory clocks render as law with citations, toll-reason lists and the primary star; the § 552.233 suspension shows as the honest unlanded line (nothing to configure). **City writes, both gated legal_rules**: `POST /api/request-rules/deadlines/target {clock, days}` — operational-target clocks ONLY (`clockMatrix.kindOf` polices the line; a statutory clock refuses in words — its figure changes by proposal), whole days 1–365 or blank = no target, written to the deadline domain configIntegrity already bands; `POST …/deadlines/holidays` — the one-act load of the US federal (observed) 2026–27 set (the fixture's list) onto an EMPTY calendar; a loaded calendar refuses (409 — changes are proposals). **Attest gate**: waits only on the holiday calendar (blank service targets are a valid posture) — the empty-calendar case is the tab's headline finding: business-day clocks were counting holidays as working days, landing statutory deadlines EARLIER than the law requires. RequestRulesPage: 4th tab, laneIndex item 2 of 10, red calendar pill. `verify_request_rules` +9 (DL1–DL9, fixture-proof: forces a known deadline-domain shape, wholesale SNAP restore). Not in this slice: per-classification response durations (live TX uses the flat 10; the BW9b Frame C editor remains the proposal path) and city-specific holiday uploads beyond the federal set (proposals). | built |
| I1 | **"Request Intake" — the request-rules 5th tab + the identity fold — BUILT 2026-08-29** (Kevin's calls: intake as the 5th tab, titled **"Request Intake"**; the identity fold rides in the same pass; canvas `docs/mockups/request_rules_intake/`). **The tab**: `TAB_CONCEPTS.intake = ['intake','custody']` (exactly READABLE §10's TX-0005 + TX-0006) · a fixed **designated-addresses** card reads the agency configuration's contact e-mail + mailing address (no second place to type them; door to /setup/agency) · three choices, each confirmed via `POST /api/request-rules/intake/confirm` riding `goLive.confirm` against the knob's HOME domain: channels `Master.g1` and acknowledgment timing `Master.g4` (intake domain; law-named channels get a display-only "(law)" marker derived from the loaded rule text) and estimate-capture `Master.p3` (FEE domain — the tab is its single confirmable home, write-through, the F2 waiver-decider pattern). **New hub row** `intake` "Request Intake" (compliance lane 10 → 11, 36 items, door `?tab=intake`, `foldSections: ['intake']`). **Stowaway retired**: the importer filed a dead copy of `Master.bv` into the intake domain (no citations, no default, read by nothing — and it held the section at pending); `stateTemplateImport` now carries it in `KNOB_SKIP` (covered, deliberately unwritten — single home: the clarification tab) and the live copy was removed by a guarded migration write (refuses if the knob carries a recorded decision). **Identity fold (rider)**: the agency screen is the ONE identity surface — its fields + the state lock are everything the identity section holds — so the `agency` item carries `foldSections: ['identity']` (its Attest signs identity; note the agency item's gate is operations_config/system_admin, deliberately the person completing agency setup) and the `jurisdiction` row's readiness (identity attested) now comes from that same act; its door moves to `/setup/agency`. `verify_request_rules` +8 (IN1–IN8), `verify_agency_setup` +2 (C5a/C5b), `verify_setup_hub`/`verify_fee_law` counts follow. After I1 the only rules-engine content left on jurisdiction-config is REDACTION (its own planned slice) — plus the go-live flip itself. | built |
| H4 | Retire the collisions (deadline day-counts in Configuration; the second email editor; Org vs Departments page) | open |
| H5 | Per-item validation-conditional Ready (Kevin's reserved option) | open, on demand |
