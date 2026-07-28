# DRAFT — Processing UI, session 1 (screen 6): the Go-Live Checklist

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-28. Not a spec, not for build. Sibling of
drafts 1c–5b; becomes part of `SPEC_processing_ui.md` when the shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft6_golive_checklist.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — two screens: the section readiness index, and the confirm-each-knob
section detail (clarification as the worked example). Single city; Columbus renders identically
with its own 9 warnings.

This is rule (d)'s surface from the Phase-7 handoff: every ⚠ city-config knob imports as
`confirmed: false` with a `suggested_default`; a section cannot reach `configured` — and `attest()`
refuses it — while any knob is unconfirmed. TX and OH each carry 9 such warnings today. The
checklist also folds in the two other go-live realities the handoff names: the **pending proposal
queue** (TX's WS3 reconciled clocks are still pending on live — until approved, live TX runs
pre-Phase-7 clocks) and the **configIntegrity invariants** (born from the 77-day probe incident).

---

## 1. The shape

- **Screen 1 — readiness index.** A computed gate summary (unconfirmed knobs · pending proposals ·
  integrity findings · sections attested · enforcement dev-mode), then one row per
  `jurisdiction_rules` domain (15): status chip, knob count, content owner, attest action.
  Status vocabulary: `Attested ✓` · `Configured (ready to attest)` · `Imported — n unconfirmed` ·
  `ACTIVE + unconfirmed parameter` (red, sorts first — a live program on an unconfirmed default is
  the worst state) · `Proposal pending` · `Drifted` · `Empty` (honest, not an alarm).
- **Screen 2 — the knob card.** Per knob: the note (what the statute left to the city), the
  suggested default rendered dashed-amber ("a starting point, never an answer"), a value editor,
  and Confirm recording name + date. A confirmed card keeps the suggestion chip visible —
  confirming the default is still a decision, recorded as one. Attest button at the bottom, disabled
  with the named reason until every knob is confirmed (the `attest()` gate, restated in words).
- **Rail:** pending proposals (one-click into the existing config-proposal review flow) · integrity
  findings (invariants, not knobs) · enforcement dev-mode state (SADMIN-only act, framed as the
  final go-live step this checklist makes responsible).

## 2. Bindings

| Surface | Binds to |
|---|---|
| Gate summary + section rows | `GET /api/jurisdiction-profile/status` (section readiness index: configured / attested / drifted) + per-domain unconfirmed-knob counts (`jurisdictionProfile` pending-knob walk) |
| Knob cards | `jurisdiction_rules` city_config edges: `{note, confirmed, value, suggested_key, suggested_default}`; eligibility dimensions' `confirmed` flag included |
| Confirm action | NEW small endpoint: set knob `value` + `confirmed: true` + who/when (today confirmation has no route — the gate exists, the setter doesn't) |
| Attest / re-open | `POST /attest` / `POST /unattest` (built; ATTEST role = SYSTEM_ADMIN | DIRECTOR); drift via `content_hash` vs `attested_hash` |
| Proposals | `config_proposals` pending rows + the existing review/apply flow (`effectiveConfig.applyConfig`) |
| Integrity findings | `GET /api/config-integrity` (invariants 1–5 + unconfirmed-knob findings + active-branch-unconfirmed) |
| Enforcement | `GET/POST /api/jurisdiction-profile/enforcement` (devMode, SADMIN) |

## 3. Compliance treatments

Rule (d) is the screen. Adjacent honesty rules carried over: **empty ≠ wrong** (a section the state
never imported is not an alarm — the rule-(b) posture applied to config); suggested defaults are
visually "not an answer"; every confirmation and attestation is a named person's act (rule (c)'s
decided-by, applied to configuration); the gate summary is computed from the same sources the
engine enforces, never asserted by the UI.

## 4. Build implications (if the shape survives)

1. **The knob-confirm endpoint** — the one genuinely missing piece of plumbing: `attest()` reads
   `confirmed`, the importer writes it false, and nothing today sets it true.
2. **Per-domain knob enumeration** in `/status` (or a sibling) so the index can show counts without
   loading every config.
3. **Owner labels** from the permission-group mapping (display metadata, not enforcement).
4. **ATTEST role widening** if Kevin confirms Senior Legal attests the Legal Rules domains (open
   question 1).
5. **Checklist route + screens** under the Director's UI; oversight read for Supervisor.

## 5. Open questions for Kevin

1. **Who attests the legal sections?** Content owner is Senior Legal (permission groups), but the
   ATTEST role today is System Admin | Director. Drafted with Senior Legal attesting
   exemption/redaction — requires widening the role. Confirm or keep Director-only.
2. **Where does this live?** Drafted as the Director's "Jurisdiction Configuration" area. Should
   the gate summary also surface as a banner on the Director's home/dashboard until ready?
3. **Dev-mode framing** — drafted as the last pill + a rail card ("turning it off is the go-live
   act"). Strong enough, or do you want an explicit guided go-live ceremony (checklist → confirm →
   flip) once all pills are green?
4. **Knob evidence drill-down** — the note is on the card; should clicking through show the
   template rule ids / research text behind the knob (flagged as later work in the mockup)?
5. **Re-open/unattest** — drafted as a quiet per-row action with a confirmation. Enough friction?

## 6. Not re-opened

The attest/refuse mechanics (WS1/WS2), integrity invariants and their bands, the proposal review
flow, mandatory-waiver's confirmation-doesn't-gate asymmetry (WS4 — noted on the fee_waiver row via
the ACTIVE-unconfirmed alarm instead).
