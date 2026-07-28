# DRAFT — Processing UI, session 1 (screen 5): MRR Intake — the Request Manager's Hub

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-28. Not a spec, not for build. Sibling of
drafts 1c–4; becomes part of `SPEC_processing_ui.md` when the shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft5_mrr_hub.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — single city (Austin TX; OH differences are one annotation — this screen
is orchestration, not branch gating). Shows the hub **at intake** plus the six-weeks-later
critical-path readout as a ghost panel.

**This is the design direction `SPEC_parent_child_lifecycle.md` §14.3 is explicitly waiting for**
("NOT SCOPED — design direction required first"; deferred 2026-07-19, single-record first, design
never withdrawn). Everything already decided in §14 is honored, not re-opened:

- §14.0 `is_mrr` derived (`child_count > 1`), never a mode.
- §14.1 parent system-routed via **`mrr_processing`** to an ORO Associate (eligibility applies); the
  RM owns the tree at the parent; children are dispositioned inside the hub, never assigned to the RM
  one by one; **intake review is bypassed for MRR**; **the RM is the sole communicator**.
- §14.2 **suggest-and-confirm** (decided): classifier runs on every child; MRR results are suggested;
  RM accepts / overrides (team or person — manual assignment bypasses eligibility by design) / takes
  personally.
- §14.3 one screen: parent line + child lines; **hub and queue are one design**; the budget/critical-
  path readout is the point of the screen.
- §14.4 Multi-Record Estimate (per-item inputs → one parent estimate via the standard engine);
  non-system contributor (secure expiring single-use token link); **Verify ≠ Approve** (two words,
  two actors — requestor approval is a statutory trigger in some states); **HOLD, not early release**
  (`as_ready` default; §5.9 coverage — never withhold an item because a sibling is unpaid);
  HIGH PRIORITY flag → AI report.
- §14.5 / §4.4 no parent disposition; parent `Complete` = all children terminal, whatever their
  dispositions; parent budget variance = the critical-path child.
- The per-child `routing_review` "duplication" is resolved as designed: three routing *decisions* are
  correct; the child lines are the presentation that replaces three worklist tasks.

## 1. What the draft adds on top of the decided design

- **The hub at intake IS the MRR intake flow** (closing the Draft-1c deferral): suggested-routing
  states per child (committed / suggested-pending / suggestion-withheld-low-confidence / external /
  taken-personally), accept-all, per-child Mark Vague / Mark Overly Broad, and the requestor-level
  checks (eligibility / ledger / waiver chips — Draft 1's components, compact) on the parent card,
  since no intake-review stop exists for MRR.
- **Workstream grid per child line**: the §5.3 five-axis statuses rendered as compact cells, with
  `budget_clock` days ahead/behind; statutory clock only on the parent card (navy chip, the only one
  on screen).
- **External-contributor link state** on the child line (sent / opened / expires).
- **The ghost panel** showing the later-life face: three items complete and released `as_ready`, one
  item 3 days behind in redaction named as the critical path blocking parent completion →
  reconciliation → final billing; **Hold release…** as the deliberate, guarded act.
- **One-voice enforcement surfaced both ways**: Contact-requestor only here; item task screens say
  "email the Request Manager" (drafts 1–4 comply when the parent is an MRR).

## 2. Bindings

| Surface | Binds to |
|---|---|
| Queue + hub load | `mrr_processing` task (re-add key + spawner per the deletion note); parent + children rows; §7 queue shape (the disabled "Hub —" placeholder becomes this link) |
| Suggested routing | classifier output per child held un-committed for MRR (§14.2 — engine uniform, commit gate differs); accept → normal `applyStageTransition`/task spawn; override → manual `assign` (no eligibility check, by design); take-personally → self-assigned task |
| Requestor-level chips | eligibility findings, `/ledger/request/:parentId`, `/approval-modules` — Draft 1's bindings, parent-scoped |
| Workstream grid | §5.3 five workstream statuses + §5.4 `budget_clock` (budgeted dates from estimate profiles); Slice B bottleneck timeline for the critical-path signal |
| MR estimate | per-item inputs accrue → parent Create Estimate via standard engine (§6.4); Verify (staff) vs Approve (requestor — the acceptance gate) |
| External contributor | NEW token substrate: secure, expiring, single-use link; submission completes the task |
| Hold / release | §5.8 `as_ready` default + hold control with §5.8 guard; §5.9 per-item coverage test |
| High priority | parent flag → AI monitoring report (reporting surfaces, later) |

## 3. Open questions for Kevin

1. **Ratify or reverse §14.2's flagged call:** "take it personally still spawns a self-assigned
   task" is recorded as Claude's call, not yours. The draft keeps it (work without a task is
   invisible to the budget clock). Your call to make it settled.
2. **One screen, two faces** — hub at intake and hub in later life are the same screen (drafted).
   OK, or do you want an intake-mode that collapses once routing is committed?
3. **Estimate worksheet depth** — the per-item grid is a drawer/subscreen ("Open estimate
   worksheet…"); how rich (profile auto-fill per item, external inputs landing live)?
4. **Token link parameters** — expiry length, re-issue flow, what the external contributor sees
   (a one-field cost form? the child description? attachments?).
5. **Accept-all** — safe convenience or too easy? (It commits every pending suggestion including
   low-confidence ones; drafted with suggestion-withheld items excluded from accept-all.)
6. **OH-as-annotation** — fine for this screen, or do you want the two-tab treatment here too?

## 4. Not re-opened

Everything in §14 listed above; the retired parent-disposition roll-up (no "partially granted");
`as_ready` release default; the notices question (§14.5 → WORKFLOW_DECISIONS Part 4, a field-design
pass, not this screen).
