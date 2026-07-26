# Fee-waiver & commercial-rate approval — v1 design (DECIDED)

Decided with Kevin 2026-07-26. Companion to `DESIGN_requestor_ledger.md`; parameterizes the
existing branches `Master.s1` (fee-waiver requested), `Master.s2` (commercial-rate requested),
`Estimate-Fee.dwv`/`wrev` (waiver decision + review). No new pages, no new statuses.

## Legal ground (from the working rule set — see per-state templates for evidence)

- **Waiver, 20 states, two shapes.** (1) **Mandatory** when defined criteria are met — CT
  (enumerated: indigent, elected official, public-defender counsel), ID (3-part public-
  understanding + can't-afford test), MI (first $20, indigent w/ affidavit), AZ (US-claims,
  crime victims), NV (VA-benefit records), NJ (crime victims), SC (legislators), VA (FERPA
  parents), OK (no search fee on public-interest release); TX hybrid (discretionary
  determination, mandatory once made, § 552.267(a)). (2) **Discretionary** public-interest /
  indigency ("may waive or reduce") — IL·LA·MA·MO·NE·OR·PA·SC·TN·WI·UT·MI·NV. Constraints:
  NV requires an adopted + posted written waiver policy; IL requires the requester to state a
  specific purpose.
- **Commercial, 8 states.** Statutory definitions with carve-outs (news media, academic,
  litigation evidence — AZ·MA·NJ·IN); AZ requires intake certification of purpose. **Clock
  effects in NJ (14-bd commercial window, 2× expedite fee) and IL (recurrent/commercial
  track)** → commercial must be classified at INTAKE, before deadlines lock — which is why
  `s2` sits on intake.
- **Statutes are silent on both open questions**: no state requires a waiver-denial notice and
  none stops processing on denial. Both are city policy (⚠ config-not-law).

## v1 model (DECIDED — keep it simple; volumes are low)

Per module (`fee_waiver`, `commercial_rate`), customer setup offers:

1. **`enabled` on/off** — governs the *discretionary* program only. **Statutory-mandatory
   categories are always on** regardless of the toggle (compliant-automation principle): they
   are auto-rules that fire on verified evidence (e.g. indigency affidavit), not judgment calls.
2. **`mode` — one of two options:**
   - **`intake_review`** — the Intake Review step itself carries approve/deny for the module
     (the intake reviewer decides inline; no extra hop).
   - **`routed_task`** — a separate task is spawned and routed to a **designated user type**
     (role) with a **designated task name**; config = `{ assignee_role, task_name }`. The child
     request continues through prelim-search meanwhile; the estimate cannot be COMMUNICATED
     until the module task closes (see sequencing).

Deferred to v2 (recorded, not built): criteria-based approver matrix ($ thresholds, requester
class, owning department, requestor-ledger history).

## Policy defaults (city-config, recommended)

- **Denial is always communicated, folded into the estimate notice** — "waiver reviewed and
  not granted + itemized estimate" is one communication; satisfies the 13-state itemized-
  estimate duties; no new document type.
- **Processing never stops on denial.** Waiver denial → normal estimate-acceptance gate
  (requester proceeds / narrows / withdraws — requester keeps control, nothing silently
  closes). Commercial classification (incl. overriding a self-declaration) → communicated
  because it changes invoice and possibly deadline; continues on the commercial track.

## Sequencing (unchanged flow, ordering constraints)

- `commercial_rate` decides at **intake/classification** (clock effects, AZ certification).
- `fee_waiver` decides at **estimate**: estimate computed → waiver decided → estimate adjusted
  → estimate sent (`fcom`, doubling as the denial notice) → requester response gate (`drsp`).
  A waiver is therefore always resolved before any amount is invoiced.
