# Setup & Configuration — Task Inventory (first pass)

**Working doc for the setup-hub redesign** (Kevin's revised-wizard concept, 2026-08-21). This is the
candidate item list for the four lanes, built from a full sweep of the code: every Admin tab, every
Jurisdiction Configuration line, the onboarding wizard phases, the standalone org screens, and every
backend config surface — including ones that currently have **no screen at all**.

Columns: **where edited today** (the door that exists now) · **protected by** (the real server-side
gate, not the UI's) · **evidence of done** (what the system can honestly display as status — this is
what the hub's chips should read, never a bare checkbox) · **depends on** (first-pass dependency map).

Lane ownership **settled 2026-08-24 (Kevin)**: Lane 1 → Legal / ORO Director · Lane 4 → Technical
System Admin · **Lanes 2 and 3 → anyone in the Open Records Office, plus fulfillment team
supervisors.** See the note under "Gating gaps" for what that costs to enforce — neither lane has a
server-side gate today, and "in the ORO" is not yet a thing the data can answer.

---

## Lane 1 — Statutory & Policy Rule Configuration *(Legal / ORO Director)*

What the LAW says and how the city answers the questions the law leaves open. Everything here is
citation-bearing, edits as a proposal, and lands in the attestation/go-live flow.

| # | Item | Where edited today | Protected by | Evidence of done | Depends on |
|---|------|--------------------|--------------|------------------|------------|
| 1.1 | Jurisdiction identity & statutes (state, statute, exemption model) | Jurisdiction Config → identity | Director/SysAdmin propose; attest | section attested | — |
| 1.2 | State rules import (the 32-state template: evidence, clocks, branch profile) — **not a hub item (Kevin 2026-08-24): fires automatically when agency state is saved (1.1 / 3.1)**. ⚠ Reality check: today the import is `backend/src/db/import_state_template.js`, a CLI with **no UI door at all** (the config screen even says "import a state template" with no way to do it), and the importer leaves the profile at `status='library'` without switching the city over. The auto-load is a build item: wire `importState()` + activation to the agency-identity save. Its human residue (statute name, unresolved timers, no-clock states) surfaces as unconfirmed items in this lane. | Jurisdiction Config (import act) | SysAdmin/Director | template imported; 6 template sections appear | 1.1 |
| 1.3 | Response deadlines & tolling | Jurisdiction Config → deadlines | **Legal section**: Senior Legal or Director; attest | attested; clock matrix populated | 1.2 |
| 1.4 | Fee & cost schedule — *statutory layer* (what the law allows; bounds) | Jurisdiction Config → fees (new composer) | Director/SysAdmin; citation required on law-bounded values; server refuses violations | attested; 0 bounds violations | 1.2 |
| 1.5 | Deposit & payment clock rules | Jurisdiction Config → payment | Director/SysAdmin; attest | attested | 1.2 |
| 1.6 | Fee-waiver policy + approval modules (waiver / commercial-rate, statutory categories) | Jurisdiction Config → fee_waiver *(only door — no dedicated screen)* | Director/SysAdmin; attest | attested; modules configured | 1.2 |
| 1.7 | Clarification / vague-request policy | **No working screen** (its editor link is dead; backend `/clarification-policy` exists) | SysAdmin/Director (API) | attested | 1.2 |
| 1.8 | Exemption model & appeals | Jurisdiction Config → exemption | **Legal section** | attested | 1.1 |
| 1.9 | Redaction / exemption RULES library (cited legal grounds) | Admin → Redaction Rules + Jurisdiction Config → redaction | Redaction authority roles; **Legal section** attest | attested; N approved rules | 1.2 |
| 1.10 | Template city-answers (intake channels, requester eligibility, branch profile, delivery/release hold, requestor ledger) | Jurisdiction Config → 5 template sections | Director/SysAdmin; every ⚠ city-knob confirmed | all knobs confirmed + attested | 1.2 |
| 1.11 | Ongoing statutory updates (upload a legal change → review → apply/schedule) | Admin → Update Configuration | upload: Director band; **apply: + Senior Legal** | no pending proposals | 1.1–1.10 (maintenance of) |
| 1.12 | Go-live enforcement (turn the gates from simulated to real) | Jurisdiction Config front page | **SysAdmin only** (the flip); checklist informs it | dev mode OFF | everything attested |

## Lane 2 — Request Processing Operational Configuration *(any ORO user; fulfillment team supervisors)*

How this city actually works a request: the rates it charges, how work routes, what automates.

| # | Item | Where edited today | Protected by | Evidence of done | Depends on |
|---|------|--------------------|--------------|------------------|------------|
| 2.1 | Fee configuration — *operational rates* (what the city charges; payment handling mode internal/ERP) | Admin → Fee Configuration | ⚠ **any logged-in user** (hardening PAUSED, known) + statutory bounds gate (422) | active fee profile version; inside bounds | 1.4 |
| 2.2 | Fee & estimate sandbox test | Setup wizard → Fees phase panel | designated reviewer or Director/SysAdmin | test confirmed **against current profile version** | 2.1, 2.4 |
| 2.3 | Record types & taxonomy (categories, variants, availability, fulfillment method) | Admin → Taxonomy (+ AI discovery) | SysAdmin/Director | N active types; discovered drafts reviewed | **4.1 for AI discovery** (Kevin's example) |
| 2.4 | Estimate calibration (per-record-type expert seeds) | Taxonomy → record type editor panel | SysAdmin/Director/Supervisor | N of M types calibrated | 2.3 |
| 2.5 | Workflow routing rules (plain-English → routed stage/team) | Admin → Workflow | SysAdmin/Director/Supervisor | N enabled rules | 3.2, 3.3 |
| 2.6 | Task time budgets (days per task type) | Admin → Configuration → Task Time Budgets | SysAdmin/Director/Supervisor | set | — |
| 2.7 | Time tracking mode (off / discretionary / always) | Admin → Configuration → Time Tracking | SysAdmin/Director | set | — |
| 2.8 | Notification thresholds (overdue alert days, escalation days, acknowledgment email) | Admin → Configuration → Notifications | SysAdmin | set | 4.4 |
| 2.9 | Redaction disposition automation (master switch, span thresholds, category sets) | **No screen** (backend `/redaction-config` fully orphaned) | SysAdmin/Director (API) | enabled + thresholds set | 1.9 |
| 2.10 | Release pipeline switches (auto-release, pre-send review) | **No screen** (backend `/dispositions/knobs`) | Director (API) | set | — |
| 2.11 | Redaction layout templates (what auto-redaction applies) | Mass Redaction area | redaction authority roles | N templates (wizard's redaction signal) | 1.9 |
| 2.12 | Decision reasons library (statutory denial/waiver texts) | **No curation screen** (grows only as a side-effect of decisions) | Director/Supervisor/Finance | library non-empty | 1.2 |
| 2.13 | Mass-redaction schedule (after-hours window, nightly budget) | **No screen** (keys read with hardcoded defaults) | — | set | — |

## Lane 3 — Organization Configuration *(any ORO user; fulfillment team supervisors)*

Who exists and who does what. (The mockup's top-level "Organization name and address" lives here as 3.1.)

| # | Item | Where edited today | Protected by | Evidence of done | Depends on |
|---|------|--------------------|--------------|------------------|------------|
| 3.1 | Agency identity (name, type, state, contact) | Admin → Configuration → Agency | SysAdmin | filled | — |
| 3.2 | City departments | Org page (and older Departments page — same data) | ⚠ **any logged-in user** (no server gate) | N departments | — |
| 3.3 | Fulfillment teams + which departments each serves + load balancing | Org page → Teams | ⚠ same gap | every department has a serving team | 3.2 |
| 3.4 | Staff: accounts, function roles, task-type qualifications | Staff management (also embedded in Org) | SysAdmin/Director/Supervisor | staff active; key roles filled | 3.3 |
| 3.5 | Record ownership (which department owns each record type) | Taxonomy → record type editor | SysAdmin/Director | N of M types have an owner | 2.3, 3.2 |

## Lane 4 — Technical Configuration *(Technical System Admin)*

| # | Item | Where edited today | Protected by | Evidence of done | Depends on |
|---|------|--------------------|--------------|------------------|------------|
| 4.1 | Connectors / record repositories (systems, ingestion schedules, paper index, per-source auto-redaction) | Admin → Sources | SysAdmin/Director | N sources; ingest runs green; discovered drafts reviewed | 2.11 for auto-redaction |
| 4.2 | AI service credentials (Anthropic, Voyage) with live tests | Admin → Integrations & API Keys | **SysAdmin only** | test buttons green | — |
| 4.3 | AI deployment profile (Standard / GovCloud / air-gapped + Bedrock creds) | Admin → AI Data Flow | SysAdmin only | profile chosen; touchpoints routed | 4.2 |
| 4.4 | Email provider (SMTP or Resend) + test send | Admin → Integrations (⚠ ALSO Admin → Configuration → Email — two doors, they collide) | SysAdmin | test email delivered | — |
| 4.5 | Authentication policy (auth mode, MFA, session timeout, password length) | Admin → Configuration → Authentication | SysAdmin | set | — |
| 4.6 | Public portal agent rules + security posture | Admin → Configuration → Agent Rules (⚠ **ungated**) · Portal Agent Security tab is read-only documentation | should be SysAdmin | rules reviewed | — |
| 4.7 | ERP / settlement integration (charge handoff, payment-applied webhook) | **No provider-config screen**; mode chosen at 2.1 | ⚠ webhook currently **unauthenticated** | test charge round-trips | 2.1 in ERP mode |

---

## Redundancies & collisions (the "some redundancy" you suspected — confirmed)

1. **Fees has three doors, two stores.** Statutory layer (1.4, bounds/evidence, attested) vs
   operational rates (2.1, fee_profiles) are genuinely different stores — keep both, one per lane,
   exactly as your two Fees boxes drew it. The wizard's Fees *phase* is not a third thing; it's the
   status row + sandbox gate over 2.1/2.2.
2. **Deadline day-counts exist twice.** Admin → Configuration → "Fees & Deadlines" holds
   `deadline_simple/standard/complex/redaction` while the binding clock rules live in 1.3. Two
   editors, one concept, no link between them — recommend the hub exposes only 1.3 and the
   Configuration copy is retired.
3. **Email settings in two editors that fight.** Saving SMTP on the Integrations card silently blanks
   the Resend key the Configuration → Email tab saved. One door should win (4.4); the other retires.
4. **Org page vs Departments page** edit the same table with slightly different fields (sort order,
   `processed_by` side). One survives into the hub.
5. **Your mockup's Organization lane lists "City Departments" twice** — presumably meant Departments +
   Teams (+ Staff), which are 3.2/3.3/3.4 here.
6. **"Taxonomy" appears in two lanes legitimately**: the statutory taxonomy *section* (attested
   content, part of 1.2's import) vs the operational catalog (2.3). Needs distinct naming on the hub
   or users will think it's the same button.
7. **Redaction is four related-but-different items**: legal rules library (1.9), disposition
   automation (2.9), layout templates (2.11), and the per-source auto-redaction hookup (inside 4.1).
   The wizard's single "Redaction Readiness" phase currently blurs them.

## Items with no door today (the hub design must decide: build a screen, or drop the item)

1.7 clarification policy (dead link) · 2.9 redaction disposition automation · 2.10 release pipeline
switches · 2.12 decision-reasons curation · 2.13 mass-redaction schedule · 4.7 settlement provider
config · monitored legal-source registry (backend of 1.11, unreachable half) · approval modules have
no dedicated screen (reachable only through 1.6).

## Gating gaps the rights-by-lane concept will surface (flagged now so the design accounts for them)

- 2.1 fee profiles: writes open to any authenticated user (hardening already on the paused list).
- 3.2/3.3 departments & teams: no server-side role gate at all.
- 4.6 agent rules: no role gate (any user can steer the public portal agent).
- 4.7 settlement webhook: unauthenticated inbound endpoint.
- One silent bug: the AV-redaction default (Configuration → Redaction tab) saves to a key the server
  refuses to write — the save is silently dropped. Needs a fix whichever screen survives.

**What the lanes-2-and-3 answer costs (2026-08-24).** "Anyone in the ORO, plus fulfillment team
supervisors" is not expressible against today's data. `DESIGN_user_type_role_model.md` (v3) defines
the eight ORO user types, but **only half of that model was built**: the per-person task-subset axis
is live (`user_task_types`, routing cut over 2026-08-13), while the user-type catalog never landed —
the DB still carries the pre-v3 nine function roles (COORDINATOR, SUPERVISOR, REDACTION_REVIEWER,
REDACTION_APPROVER, ATTORNEY_REVIEWER, CUSTODIAN, DEPT_MANAGER, DIRECTOR, SYSTEM_ADMIN) plus eleven
permission roles, and the design doc is still DRAFT, unratified into `ARCHITECTURE.md`. Later work
mapped ORO types onto whatever existed: ORO Senior Legal = `ATTORNEY_REVIEWER` (that is the gate the
Legal attestation actually checks), ORO Finance = the `FINANCE` permission role.

**DECIDED (Kevin, 2026-08-24): no stopgap.** A team-membership derivation of "in the ORO" was
considered and rejected — the broken underlying model is part of what this redesign exists to fix,
not something to route around. The hub gates on the real v3 user-type catalog, built properly first.

**The plan (sequencing, decided 2026-08-24):**
1. **Finish the hub design on paper** — the design pass defines what the permission model must
   express (lane rights, who may confirm/sign off what, who reviews). No hub build during this.
2. **Spec and build the v3 user-type model for real** — the user-type catalog, the authority axis,
   permission groups as data, migration off the pre-v3 function/permission-role pair, ratification
   into `ARCHITECTURE.md` and `SPEC_tasks_roles_mrr_fees.md` §8. The gating gaps above get closed
   ON this model, not patched twice.
3. **Build the hub on top** of the finished role model.

## Open questions (yours)

1. ~~Lane owners for lanes 2 and 3 (the cut-off sentence).~~ **Answered 2026-08-24:** anyone in the
   ORO, plus fulfillment team supervisors — for both lanes. Consequences in the gating-gaps section.
2. Does "submitted as complete" (your dependency trigger) mean the existing reviewer-approval flow,
   the attestation act, or a lighter self-serve "mark complete"? Today all three exist in different
   places; the hub could unify on approval-where-gated / mark-complete-elsewhere.
3. Is the existing 7-phase Setup wizard replaced by the hub, or does the hub become the front door
   and the phases dissolve into the lane items above? (My read: dissolve — every phase maps to rows
   in this inventory, and the readiness signals + approval flow carry over item-by-item.)
4. The no-door items: which are worth screens for v1 of the hub, which stay backend-only, which die?

## Plan layout decision (Kevin, 2026-08-24, later session)

- **Plan A (full gantt) chosen** as the overview layout. Plans B/C stay on canvas page 2 for reference.
- Kevin asked what the gantt's collapsed "5 more settings with no prerequisites" row held; it was Lane-2 items
  **2.6, 2.7, 2.10, 2.12, 2.13**. Expanded into their own rows at his request (`docs/mockups/setup_hub/PlanGantt.dc.html`).
  Three of the five (2.10, 2.12, 2.13) have no screen today — flagged "no screen yet" on the row.

