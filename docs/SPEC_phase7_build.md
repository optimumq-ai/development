# SPEC — Phase 7: state-config build (templates → engine)

**Goal:** any of the 32 gathered states can be stood up from its Phase-6 template
(`docs/rules_research/workflow/templates/<ST>.json`) — imported into the app's existing
jurisdiction-config machinery, with the workflow engine honoring the state's branch profile and
clock matrix. Written 2026-07-26 for execution by a smaller model in small, sequential commits;
design decisions live in the referenced docs — do not re-litigate them here.

## Inputs (ground truth — read before coding)

- `docs/rules_research/workflow/templates/<ST>.json` + `templates/README.md` (schema: knobs ·
  branches · clock_matrix · fee_schedule · program_setup · ledger · audit)
- `docs/rules_research/workflow/node_concept_map.json` (node → concept assignments)
- `docs/rules_research/workflow/DESIGN_requestor_ledger.md` (ledger classes A–D; MVP = class A;
  identity anchors = portal-account / verified-email / staff-confirmed, NO fuzzy adverse matching)
- `docs/rules_research/workflow/DESIGN_fee_waiver_commercial.md` (approval modules v1 DECIDED:
  `enabled` governs discretionary program only; modes `intake_review` | `routed_task`)
- Existing machinery: `jurisdiction_profiles` + `jurisdiction_rules(jurisdiction_id, domain,
  config_json)` with domain adapters in `backend/src/services/configExtractors.js` (fee, deadline,
  clarification, payment, fee_waiver, exemption, redaction, taxonomy) · `request_clocks`/
  `clock_tolls`/`clock_extensions` + `deadlineCalc.js` · `jurisdiction_profile_sections`
  (attestation) · `config_proposals`/`config_history` · `workflowModel.js` 10-stage pipeline ·
  `configIntegrity.js` · TX seed (`seed_jurisdiction_tx.sql`)

## Template section → app surface

| Template section | Existing surface | Gap |
|---|---|---|
| `fee_schedule` | domain `fee` (+ `fee_matrix`, `feeEngine.js`) | importer mapping only |
| `clock_matrix` | domain `deadline` + clocks tables + `deadlineCalc.js` | named-timer taxonomy; soft-standard flag |
| clarification knobs | domain `clarification` | importer mapping only |
| payment knobs (`ddep`/`cnp`) | domain `payment` (`paymentClockPolicy`, `feeNonpayment`) | importer mapping only |
| waiver knobs/branches | domain `fee_waiver` (`feeWaiverPolicy.js`) | approval-mode config (WS4) |
| `nreason`/`r1` libraries | domains `exemption`, `redaction` (rules library w/ approval_status) | importer stubs; content is per-state data load |
| `branches` (25 ▲) | — | **NEW domain `branches`** + engine gating (WS2) |
| eligibility gate (`g2`) | — | **NEW domain `eligibility`** (WS2) |
| intake knobs (`g1`/`g4`) | partial (portal/intake config) | **NEW domain `intake`** |
| disposition (`fmt`/`hold`) | partial (delivery_method on requests) | **NEW domain `disposition`** |
| `ledger` | — | requestor-ledger MVP (WS5) |
| `program_setup` | `jurisdiction_profile_sections` | render as onboarding checklist rows (attestation flow already exists) |

## Workstreams — build in this order, one commit each minimum

**WS1 — Template importer.** `backend/src/db/import_state_template.js <ST>`:
upserts `jurisdiction_profiles` + one `jurisdiction_rules` row per domain, translating template
sections per the table above. Rules: (a) statutory evidence values → domain config with
`source_rule_ids` retained; (b) ⚠ city-config knobs → config keys created with the suggested
default AND a `jurisdiction_profile_sections` row `status='not_configured'` so go-live attestation
forces a human to confirm each one; (c) re-import of an already-configured jurisdiction writes
`config_proposals` (diff for review), never blind overwrite; (d) idempotent. Acceptance: import TX
and OH; `check_config_integrity.js` passes; re-import is a no-op proposal-wise when nothing changed.

**WS2 — Branch profile + eligibility gating.** New domains `branches` (the 25 ▲ on/off + params)
and `eligibility` (gate config: residency/identity/purpose per requester class — see
requester-class cluster: these are config dimensions, not per-state exceptions).
`workflowModel.js`/`stages.js` consult the branch profile: an inactive branch's stages/tasks never
spawn (AG band, third-party notice, referral, installments…). Acceptance: with TX profile the AG
band replaces staff denial; with OH profile it does not exist; eligibility gate blocks only where
configured.

**WS3 — Clock-matrix reconciliation.** Map the template's 10 named timers onto domain `deadline` +
`request_clocks.clock_type`. Add soft-standard support: timer flagged `operational_target` (drives
My-Tasks aging, explicitly NOT a legal deadline — S-002) for `present:false` states like OH.
Deemed-denial/deemed-disclosure exposure stays warning-only (system's job is to respond in time).
Acceptance: TX shows hard 10-bd/15-bd AG clocks + 60-day unclaimed timer (TX-S05); OH shows only
operational targets; existing seeded deadline rules keep working.

**WS4 — Approval modules v1** (per DESIGN_fee_waiver_commercial.md, decided): `fee_waiver` and
`commercial_rate` module config = `{enabled, mode: intake_review|routed_task, routed_task:
{assignee_role, task_name}}`. Mandatory statutory waiver categories (template evidence) fire
regardless of `enabled`, on verified evidence. Commercial classifies at INTAKE (NJ/IL clock
effects). Waiver decision always resolves before estimate communication; denial text folds into
the estimate notice; processing never stops. Acceptance: both modes exercisable end-to-end on a
fixture request; toggling `enabled` off leaves mandatory categories live.

**WS5 — Requestor-ledger MVP (class A).** Per DESIGN_requestor_ledger.md: RequestorProfile +
balance/allowances/counters/flags tables, evented from the parent financial processor; pure
trigger evaluation at the 3 existing gates; adverse triggers require affirmative identity match;
classes B–D as config stubs with manual counters. Acceptance: TX 552.263(c) unpaid->$100 deposit
trigger and OK unpaid-fees advance-payment gate fire on fixtures; anonymous requests never
adverse-match.

**WS6 — Integrity + E2E.** Extend `configIntegrity.js`: every knob has a value or an attested
city default; every ACTIVE branch has its required params; every named timer resolves. Two
scenario scripts (seeded fixtures, run via the WS1 imports): TX hard-clock + AG-referral path,
OH soft-clock + staff-denial path. Acceptance: both scripts green; integrity check green for
TX + OH; existing test suite unbroken.

## Non-goals (do not build)

v2 criteria-based approver matrix · ledger classes B–D beyond config stubs · the 18 ungathered
states · exemption/redaction library CONTENT loads (separate data task) · any rewrite of the
stage pipeline, clock tables, or adapter framework (extend additively; schema changes are
`CREATE TABLE IF NOT EXISTS` only — schema re-applies idempotently on boot).

## Execution notes

Sequential, single-threaded; NO multi-agent fan-out. Small commits on `main` (Kevin's
convention), message prefix `feat(phase7-wsN):`. After each backend change: restart = kill the
optimumq-owned `node server.js` on :3001 (root PM2 respawns). Verify with
`check_config_integrity.js` + the WS6 scripts as they come online. If a template value looks
wrong, fix the Phase-6 pipeline (map/generator), never hand-edit a generated `<ST>.json`.
