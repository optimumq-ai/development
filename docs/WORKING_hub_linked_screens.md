# WORKING — Hub → linked screens (brainstorm, SUBJECT TO CHANGE)

Status: brainstorm with Kevin, 2026-08-25. Nothing here is binding until folded into
`SPEC_setup_hub.md`. Order of work follows the Plan A gantt (`docs/mockups/setup_hub/PlanGantt.dc.html`,
copy in `~/exchange/setup_hub_plan_gantt.png`), Phase 1 first. H2 (six no-door screens) is deferred behind this.

## 0. The shared pattern — "status strip"

Every screen reached from a hub row carries the same slim strip at the top:

    [ ● In progress ]  Name and state set · contact email missing        [ Attest as complete ]
      ^ chip = button, colored by hub state, click → back to the hub

- Chip text and color = the hub's five counted states (Not started / In progress / Ready / Needs attention /
  Waiting). Evidence line = the hub's existing evidence text. Same words in both places, one vocabulary.
- **Attest** writes the existing `setup_hub_signoffs` row for the item (no new table; reversible from the
  hub as today). Enabled only when the screen's own completeness check passes. Attest never overrides a
  computed `needs_attention` / `waiting` (SPEC_setup_hub §4 already says so).
- Permission to attest = the hub's `mayEdit` gate for that item (lane group; `legal_rules` on legal items).
- Hub row click → screen; chip click → hub. That is the whole navigation.

## 1. Phase 1 · Agency name, address and contact (hub key `agency`, inventory 3.1)

**Today:** door is `/admin?tab=config` — the Agency tab of a nine-tab Configuration page whose single
"Save Configuration" button posts every tab at once. Fields: agency_name, agency_short_name,
jurisdiction_type, state (50-state select, default TX), contact_email, contact_phone. Edits DO persist
(whitelist upsert into `system_config`; `contact_phone` is whitelisted). There is NO street/mailing address
field, NO state lock, and saving state triggers nothing (H3 open; `stateTemplateImport.importState()` is
CLI-only).

**Proposed screen: `/setup/agency` — one card, only this content.**

Fields (always editable, one Save button; no edit/save mode):
- Agency name · short name · jurisdiction type
- Street address: line 1, line 2, city, ZIP (+ its own address-state field — see note)
- [ ] Mailing address is different → reveals mailing line 1/2, city, state, ZIP
- Public records contact email · phone
- **State (jurisdiction)** select + button **"Lock state and load its rules"**

Note: the address state and the *jurisdiction* state are separate fields. A mailing-address edit must never
touch the rule-driving state.

**Lock state:** confirm dialog → writes `state`, `state_locked_at`, `state_locked_by`; calls `importState()`
and activates the profile (this IS slice H3, moved from "fires on save" to "fires on the button" — a
deliberate pull, not a side effect). Afterwards the select is read-only with "Locked TX · by <name> · <date>".
No unlock on this screen; re-running rules goes through the existing "Regenerate from state rules" proposal
path (fee-model decision, HANDOFF 2026-08-19).

**Attest:** enabled when every required field has a value AND the state is locked. Required = name, short
name, jurisdiction type, street address (line 1, city, state, ZIP), contact email, contact phone; mailing
block required only if the checkbox is on.

**Hub reader change:** count the address and phone too (today `ready` = name + state + email only), and
report "state not locked" as in_progress evidence.

**Backend:** new keys on the `POST /api/config` whitelist (address_line1/2, address_city, address_state,
address_zip, mailing_* ×5, mailing_differs, state_locked_at/by) — or a dedicated `/api/agency` endpoint so
this page stops posting the whole config object. Prefer the dedicated endpoint.

**Decided 2026-08-25 (Kevin):** lock via button; the old Agency tab on /admin Configuration is removed once
this page exists (the other eight tabs stay until their own rows are done).

**Artboard:** https://claude.ai/code/artifact/76a93009-f5d2-4255-94bf-dd9d3ced3b3d (sources in
`docs/mockups/hub_links/agency/` — Main = before lock, Locked = after lock + attest). Awaiting markup.

## 2. Phase 1 · State rules applied automatically (inventory 1.2) — section list for Kevin's sketches

Kevin is sketching a simpler UI for the state-rules content. Fact base handed over 2026-08-25 in
`~/exchange/TX_STATE_RULES_SECTIONS_2026-08-25.md` (+ `jurisdiction_config_live_2026-08-25.png`):
15 sections, fixed by the app not the state; 9 core + 6 that appear after the state load; content varies by
state (branches/clocks on or off), the section set never does; residency is a yes/no inside eligibility.

## 2a. Fees — how the state profile actually flows today (traced 2026-08-25, read-only)

- State load writes only the fee SENTENCES (`jurisdiction_rules.fee.fee_schedule` ← template
  `fee_schedule.statutory_evidence`) → shown on /jurisdiction-config/fees Content tab. The 35 verified
  dollar items per template (`fee_schedule.items`, each tagged with `engine_field`) are READ BY NOTHING.
- Administration → Fee Configuration: skeleton hardcoded (`FeeConfigPage.js DEFAULT_CONFIG`), values from
  `fee_profiles` (hand-seeded TX row). Profile dropdown = `fee_profiles` rows. Save config = in-place UPDATE,
  no version; only gate is `feeBounds` (422 above a statutory ceiling). "Configure from policy text (AI)" =
  paste box → `feePolicyExtract` (real model call) → proposes into the form, persists nothing.
- Engine (`feeEngine.compute`) reads `fee_profiles` only. So: law → sentences → Content tab · dead end ·
  hand-typed numbers → engine. No auto-config / regenerate path exists (designed 08-19, never built).
- "Propose change" composer (built 08-21) files a DRAFT fee_profiles row; no screen can activate it.
- Open from 08-19: duplicated homes (estimate/deposit thresholds in both fee_profiles.requestRules and
  fee_waiver rules).

**Kevin's direction (brainstorm):** state-entry screen → "State Mandate" window (fixed/ceiling/floor items
with citations) + "Guidelines and Deferral to Local Policy" window (soft-standard/silent, "reasonable");
local policy document upload → AI → local rules shown below the mandate → approved → new fee template
version. Scope must split: fee COMPUTATION vs estimate/deposit/payment clocks. The `basis` field on every
item already supports the mandate/deferral split mechanically. Next: table of TX items in the four
buckets for Kevin to sketch over.

## 3. Next rows (not yet discussed)
