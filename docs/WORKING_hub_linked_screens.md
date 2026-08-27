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

**BUILT 2026-08-25 (evening)** on Kevin's go: `/setup/agency` (`frontend/src/pages/AgencySetupPage.js`), `GET/PUT
/api/agency` + `POST /api/agency/lock-state` (`backend/src/routes/agency.js`), hub `agency` reader counts every
required field + the lock, door → `/setup/agency`, Agency tab removed from ConfigurationPage. Kept to the
artboard; the lock response shows what loaded (sections written, primary clock or "service target", count of
unconfirmed city choices) with a button back to the hub. Harness `verify_agency_setup` 18/18. Bound into
SPEC_setup_hub §7 H3. Still open from this section: the hub reader's `state` evidence uses the code (TX) not the
name; no unlock anywhere (by design).

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
item already supports the mandate/deferral split mechanically. Delivered 2026-08-25:
`~/exchange/TX_FEE_FOUR_BUCKETS_2026-08-25.md` — A mandate/computation 13 · B mandate/estimate-payment 9 ·
C deferral/computation 10 · D deferral/estimate-payment 3. Two mandate items have no engine home (per-requestor
free hours, repeat/aggregation → need a requestor ledger); five items live in two places. Kevin sketches next.

## 2b. Phase 1 · What the law lets you charge (hub key `fee_law`, section `fees`) — sketched 2026-08-25

**Today (observed after Kevin's live TX lock):** door `/jurisdiction-config/fees` shows 3 statute SENTENCES
(copy charge, 50-page allowance, AG rate + 25%) + 4 unconfirmed knobs (Estimate-Fee.addt/dreq/fcom/frev) +
"Propose change…". Hub reads Waiting · not configured, because the section's configured check is
`fee_profiles` (the city rate table) and the import never writes it. New fact: the imported
`jurisdiction_rules.fee` blob carries only those 3 sentence concepts — the 35 verified `fee_schedule.items`
in TX.json are dropped at import, not just unread.

**Sketch (Kevin's direction, status-strip pattern):** one screen, two windows side by side, four buckets.
- Left **State mandate** (A 13 + B 9): loaded by the lock, read-only, each row = plain name · TX value ·
  Ceiling/Fixed/Floor chip · citation. Two rows flagged "needs requestor ledger" (drawn, not hidden).
- Right **Guidelines and deferral to local policy** (C 10 + D 3): each row = value input · "what the law
  says" chip (Actual cost / Reasonable / Silent) + citation. Header box: "Read a fee policy document" →
  AI fills rows with page refs (second artboard) → rows the document missed stay red until decided.
- Footer: **Approve as fee schedule v1** — approval writes ONE versioned schedule (the `fee_profiles`
  version estimates price from), giving the 5 twice-homed numbers a single home. Attest gated on a version
  existing. Canvas: https://claude.ai/code/artifact/50a65ce5-a37b-4ad4-a9ef-276474b0d4bd
  (sources `docs/mockups/hub_links/fee_law/`).

**Decided 2026-08-25 (Kevin):** the mandate side shows ONE ceiling per row (this city's: AG rate + 25% for TX
cities, § 552.262(c)) plus a "This city charges" column; and **for every state template, a ceiling item's city
value DEFAULTS TO THE CEILING** (basis = ceiling → prefill cap; the city may only lower it) — less setup work,
and a demo city prices from day one. Fixed rows read "as law"; floor rows prefill the law's minimum.
**Open for Kevin:** ledger gaps drawn or hidden? · block approval on undecided rows or allow partial? · where
the SS context lives.
**Build implications (not started):** importer must keep `fee_schedule.items`; approval = new
`fee_profiles` row mapped by each item's `engine_field`; fee-law hub reader = "a version exists";
document→AI reuses `feePolicyExtract` but must persist proposals with page refs.

**BUILT 2026-08-26 (F1):** `/setup/fee-law` + `GET/PUT/POST /api/fee-law` + `services/feeLaw.js`. Chosen route
for the 35 items: read them from the locked state's template FILE (the rules library on disk) rather than
re-importing them into the blob — no re-import needed for Kevin's live TX lock. Windows stack vertically in
the app (the 1420-wide side-by-side canvas does not fit the 1170 content width). Document reading = text
files / paste through the existing `feePolicyExtract`; PDF is a follow-up. Bound into SPEC_setup_hub §7 F1.

## 2c. Redaction rules library (hub key `redaction_rules`) — decided 2026-08-25

**Fact (from the backup of the wiped library):** the 26 TX rules were 14 hand-seeded (`seed_jurisdiction_tx.sql`)
+ 12 AI-drafted from statute text through `configExtractors.redaction` (`extractRedactionRules`) on 2026-06-09,
each approved by Kevin on 2026-06-10. The rows carry `source_document: null` — the extractor never recorded
what text it read. The rules library (`pruned_discovery.json`) has 52 Redaction rules but they are PROCESS
(segregability, notice, personnel-privacy procedure, a few named mandatory redactions) — no per-state
exemption catalogue exists anywhere.

**Decided (Kevin):** no new research pass — the project cannot wait. The row's screen = **upload documents →
AI populates the redaction rule library as drafts (with page/document reference) → legal approval, or type
rules by hand.** Same document-in / AI-proposes / human-approves pattern as the fee deferral window (§2b), so
one shared component. Must fix: persist the source document and reference on each drafted rule.

## 2d. Direction for the whole hub — stated by Kevin 2026-08-25

- **Retire the Jurisdiction Configuration screen** and many of the Administration links; all
  setup/configuration is driven from the hub.
- Kevin will **modify the hub screen to reduce complexity** (his markup pending); every hub-linked screen
  (agency — built; fee_law — canvas approved; redaction_rules — §2c) links to the REVISED hub.
- **Next slice:** build the fee_law canvas (§2b) as approved. Then decide the next step.

## 2e. Requestor ledger — views sketched 2026-08-26

**Facts:** the ledger MVP (class A) is BUILT and inert on live (all 27 request links anonymous — demo data
predates the wizard's verify-link gate). There are NO requestor accounts and will be none (Kevin, reaffirmed);
the design doc's "portal account" wording was corrected — the verified email is the primary anchor, the
`portal_account_id` column is dead. Balance = SUM over the requestor's own event rows (indexed), not a scan.

**Sketch:** https://claude.ai/code/artifact/2c16b365-5198-4a1d-bf1e-50096cc3faf0 (sources
`docs/mockups/hub_links/ledger/`): (1) **ledger card** from a request's Financial page — identity basis,
outstanding, balance by request, the state rule that applies (TX $100 deposit), allowance meters (TX 36h/15h;
manual until class B counting), flags; (2) **anonymous request** — "no ledger is kept", with the
staff-confirm-identity door; (3) **lookup by email** (finance staff, exact match, never creates).
**Open for Kevin:** who may open it · merge-two-addresses action · lookup by name? · where the lookup lives.
Build after markup; first a real wizard submission on live (smoke test) so one true ledger exists.

## 2f. Clarification · Exemptions · Eligibility — three-tab screen sketched 2026-08-26

The slice decided at 2026-08-26 close (HANDOFF): ONE screen, three tabs, status-strip pattern, serving hub
rows `clarification` (item 6, noScreen today), `exemptions` (item 7, `legal: true`) and a NEW eligibility row
(the `eligibility` profile section exists — 6 dimensions, only `incarceration` gated — but no hub row yet).
The strip follows the ACTIVE tab's row; each tab's dot on the tab bar shows its row's hub state.

**Canvas:** https://claude.ai/code/artifact/ad29b14f-c181-407b-870c-f8045a840b61 (sources
`docs/mockups/hub_links/clar_exempt_elig/` — Main = clarification tab, Exemptions, Eligibility,
ClarificationLetter = the "View the letter" popup). Awaiting Kevin's markup.

- **Clarification tab (TX_RULES_READABLE §4):** law panel = TX-0012/13/14/15 with citations (statute popup,
  F1 pattern). A prominent master switch tops the choices column — the live import filed the domain
  `enabled: false`, and while off the hub row can never leave Not started; the mock draws it ON with the
  provenance in a hint. Five choices: vagueness screen wording · the clarification letter (standard wording +
  View the letter; § 552.222(e) required-warning chip) · reply window (61 days, FIXED in TX, § 552.222(d)) ·
  close-as-withdrawn (closure fixed, closing notice = city policy checkbox) · materially-revised reply (radio:
  new request with new deadline, suggested / continue original).
- **Exemptions tab (§7):** law panel drawn as the AG-process clock — by the 10th bd (ask AG + notify
  requestor, TX-0016/18/S03/19), by the 15th bd (comments + copy, TX-0020/21), missed → presumed public
  (TX-0022, red marker) — plus the no-AG-needed pair (previous determination TX-0017/S02; no responsive
  records TX-S01, eff. 9/1/2025). Four choices: **where denial reasons come from** = amber card "the
  Redaction rules library — not loaded yet", confirmable as understood (NOT `decision_reasons`; per the
  handoff decision) · who may approve a denial = permission-group select, Legal Rules suggested · the denial
  letter (standard wording + view; § 552.301(d) content chip) · denial-letter service deadline (days, city
  policy). Footer notes attest needs the Legal Rules group.
- **Eligibility tab (§11):** law panel TX-0001/02/03/04. One decision card — incarcerated requesters
  (§ 552.028(a) allows refusal; radio refuse-as-allowed suggested, matches the gated dimension) with its own
  Confirm. The other five dimensions listed under "Nothing else to decide" (settled by law / nothing switched
  on) so the one-click attest is legible. Repeat-requester row cross-links time caps to fees/ledger.
- **Letters:** standard wording only (decided 2026-08-26); the letter popup shows the REAL generated text
  (`clarificationNotice.buildNotice` with graceDays 61, City of Autumn Falls letterhead). Flagged in-canvas:
  the standard consequence sentence ("we may be unable to continue") is softer than TX's statutory
  consequence (withdrawn on day 61) — strengthen now or wait for the template store?

**Decided 2026-08-27 (Kevin):** design approved · new hub row `eligibility` "Requestor eligibility" in the
Compliance lane · three doors, each opening its MATCHING tab · letter wording waits for the template slice.
**BUILT 2026-08-27** on Kevin's go: `/setup/request-rules` (`RequestRulesPage.js`), `services/requestRules.js`
+ `routes/requestRules.js`, shared `components/StatutePopup.js` (FeeLawPage refactored onto it), hub doors +
`eligibility` row + readers, `clarificationPolicy` carries screen knobs through policy writes. Bound into
SPEC_setup_hub §7 R1; harness `verify_request_rules`.

## 3. Next rows (not yet discussed)
