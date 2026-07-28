# DRAFT — Processing UI, session 1 (screen 3): Denial Compose

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-28. Not a spec, not for build. Sibling of
`DRAFT_processing_ui_intake_review.md` (1c) and `DRAFT_processing_ui_estimate.md` (2); becomes part of
`SPEC_processing_ui.md` when the shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft3_denial_compose.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — OH tab is the full compose, TX tab is the pre-clearance gate. Annotated,
same design language.

Denial compose is a BUILD item from the phase-screen inventory ("reason library + letter + routing").
Draft-2 carry-over decided this turn: **overly broad = stay-and-estimate** (confirmed by Kevin — the
estimate is the response to volume; only Vague pauses the estimate task).

---

## 1. The shape

- **Not a routed task.** A compose surface opened from a task and returning to it. Entry points:
  legal review (exemption denial) · redaction (exemption found mid-redaction) · intake review (OH
  deny-too-vague) · prefilled drafts raised by denial-shaped advisories (MA unpaid balance, vexatious
  flags, abandonment-closure-via-denial states). Prefill = system raised it, a person decides it;
  auto-denial stays out of scope by decision.
- **Per-record disposition is the spine:** withhold in full / release with redactions / release in
  full, each carrying its ground; released records continue to delivery. The letter must account for
  every withheld record and every redaction (Vaughn-style trail).
- **Grounds come from a per-state reason library** — cited, versioned, usage-counted, fail-closed
  (a ground the state lacks is absent, not greyed; an unresearched ground ships absent — same rule as
  `overbroad_is_denial_ground`).
- **Required elements are a per-state checklist that gates Send** (says why in words — the
  WAIVER_UNDECIDED / Found-gate pattern). OH: explanation w/ legal authority (B)(3), written denial,
  per-redaction notice (B)(1), remedy language; +invite-to-revise when the vagueness ground is
  selected (B)(2)). IL: conference-offered-first for the burden ground, estimate attached as
  evidence, and the forfeiture hard stop (past-deadline requests cannot be denied as burdensome —
  ground greys out with the reason).
- **The Texas tab is the compliance centerpiece:** in a pre-clearance state, staff denial on
  exemption grounds does not exist. The screen refuses to be a denial screen — previous-determination
  check shown (system, "none found"), then one-click **Refer to the AG** with the 10-bd duty clock,
  §552.302 presumed-public rendered as an exposure warning ON that clock (never its own countdown),
  and the 15-bd briefing clock. The AG band itself lives on the Legal Review screen (separate draft);
  after a favorable ruling this screen reopens to compose the letter citing the ruling.
- **Authority routing:** Senior Legal owns exemption denials. A composer without authority gets
  "Route for signature" instead of Send.

## 2. Bindings

| Surface | Binds to |
|---|---|
| Reason library | `decision_reasons` (exists: categorized, most-used-first, `is_active`) + exemption domain (`jurisdiction_rules`), per-state; needs: citation field surfaced, per-state scoping, versioned template text |
| Procedural grounds availability | branch profile capabilities (`clarification_denial` for OH vagueness) + clarification policy (`clarification_duty`, `vague_is_denial_ground` / future `overbroad_is_denial_ground`) |
| Pre-clearance gate | `ag_referral` capability true → exemption grounds route to referral; previous-determination check (new lookup); clocks `ag_ruling` / `ag_submission` via `computeStatus` (exposure list) |
| Per-record dispositions | `request_files` + redaction jobs; denial record per file w/ ground + citation |
| Required-elements checklist | per-state denial config (largely NEW — needs a `denial` domain or extension; remedy-language template per city) |
| Letter | assembled like `feeNotice`/`clarificationNotice` (deterministic builder + editable), delivery via email / printable postal letter |
| Prefilled advisory drafts | ledger advisories (`advisory_deny` MA rule), vexatious flags (class D, source + citation), `clarificationTimeout` w/ `abandonment_closure: via_denial` |
| History / trail | `DENIED` / `DENIED_IN_PART` history rows: grounds, citations, decider; withheld records keep grounds attached |

## 3. Compliance treatments

Rule (a): AG clocks are `agency_action` chips (navy, cited); §552.302 is an **exposure warning on the
clock**, never a countdown. Rule (b): grounds and the whole TX/OH divergence are branch-gated,
three-valued (absent only on explicit research). Rule (c): decided-by on the denial record — always a
named person; prefilled drafts carry both badges (system raised / person decided). Rule (e): nothing
here adverse-matches an anonymous requestor (the MA prefill path requires an identity anchor by ledger
rule).

## 4. Build implications (if the shape survives)

1. **A per-state denial config** (required elements, remedy language, ground availability) — the one
   genuinely new domain this screen needs; ships fail-closed and unconfirmed knobs behave per rule (d).
2. **Reason library extensions**: per-state scoping + citation + versioned template text on
   `decision_reasons` (substrate exists, fields don't).
3. **Previous-determination lookup** (TX): store + search past AG rulings/determinations by
   information category.
4. **Denial record model**: per-file ground attachments + `DENIED_IN_PART`; disposition roll-up for
   partial denials (open question).
5. **Compose-return flow**: draft persistence, route-for-signature task, reopen-with-ruling (TX).
6. **IL forfeiture stop**: past-deadline → burden ground disabled with reason (reads the response
   clock status; the record-search spec's forfeiture guardrail, surfaced here).

## 5. Open questions for Kevin

1. **Who may send which denial?** Exemption denials — Senior Legal (per role model). Procedural
   denials (OH vagueness): the intake reviewer who marked it, or still legal sign-off?
2. **Partial-denial roll-up** — which child disposition does "denied in part, rest delivered" take?
   (The eight-disposition list has `Denied` and `Closed – Delivered`; partial needs a rule.)
3. **Prefilled advisory drafts** — right entry shape? (Alternative: a small "confirm advisory" step
   on the ledger panel first, then compose.)
4. **The required-elements config** — per-state seeding is a research pass (remedy language, appeal
   windows). OK to ship the screen with TX/OH seeded and others fail-closed?
5. **Tab order in the mockup** — OH first (full compose) reads better for markup; fine?

## 6. Not re-opened

AG-band ownership of `ag_review` (WS2), the advisory-vs-automatic line (no auto-denial), the
per-record redaction model, clock taxonomy, Draft 1c/2 decisions (incl. overly-broad
stay-and-estimate, confirmed today).
