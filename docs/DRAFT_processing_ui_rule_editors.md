# DRAFT — Processing UI, session 1 (screen 10): Rule-Content Editors (Jurisdiction Configuration)

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-29. Not a spec, not for build. Answers
Kevin's Draft-6 markup question ("do we have mockups for each section that correspond with the
rules-engine build?") — decided 7/29: draft them now. Becomes part of `SPEC_processing_ui.md`
with the rest when the shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft10_rule_editors.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — Frame A: the section screen (the pattern, fee as the worked
example); Frame B: the Exemptions editor (Legal Rules ownership, edit-as-proposal); Frame C:
the Deadlines & Clocks editor (the compliance-heavy one). Single city (Austin, TX).

---

## 0. What this is — and the two-kinds-of-content rule that shapes everything

Draft 6's readiness index lists the 15 `jurisdiction_rules` domains; its screen 2 confirmed ⚠
knobs. These editors are the rest of the answer: **each section row opens a section screen**
where the domain's actual rule content is read and edited. Draft 6's knob cards become the
**City knobs zone** of this screen (one surface per section, not two screens).

**The rule that shapes everything: a section holds two kinds of content, and they edit
differently.**

| Kind | Examples | Edit behavior |
|---|---|---|
| **Statute-derived facts** (imported from the research, citation + provenance attached) | an exemption and its citation; a statutory clock's duration and kind; chargeability ("no labor lines in OH — R.C. 149.43(B)(1)") | Editing asserts *the law says otherwise*: requires a citation + note, and **always creates a proposal** through the existing config-proposal review flow — never a silent in-place write |
| **City-policy values** (the ⚠ knobs — what the statute left to the city) | operational targets; grace windows; thresholds the city may set; `close_approval`; the pre-send gate | Freely settable by the owner; the Draft-6 **confirm** flow (value + `confirmed:true` + who/when); no proposal needed |

The visual grammar mirrors the clock chips: statute-derived rows carry a **navy solid left edge +
citation chip**; city knobs carry the **dashed amber** treatment with their suggested-default
chip. A reader should never wonder which kind they are looking at — that confusion is how a city
accidentally "edits the law."

## 1. The shape

- **Route:** Director's Jurisdiction Configuration area → readiness index (Draft 6 screen 1) →
  **section screen** per domain. Read-only for oversight; editable only when the user's type
  carries the domain's permission group.
- **Section screen zones** (Frame A): header (domain · status chip · owner group · attest state ·
  drift) · **Content** (the rules, read-first, every row cited) · **City knobs** (Draft 6's
  confirm cards, embedded) · **Provenance** (template-import manifest, `source_rule_ids` →
  research text) · **Pending proposals** (the existing review/apply flow, inline).
- **Ownership by permission group** (drafted mapping — open question 1):
  - **Legal Rules** (Senior Legal OWNER · Director may · SysAdmin technical-only): `exemption` ·
    `redaction` · `deadline` · `clock_matrix`
  - **Fee Configuration:** `fee` · `payment` · `fee_waiver` · `approval_modules` · `ledger`
  - **Workflow & Taxonomy:** `intake` · `branches` · `disposition` · `clarification` ·
    `eligibility`
  - `template_import`: read-only manifest (SysAdmin view) — never edited by anyone.
- **Every content edit is a proposal** — one audit path, no exceptions. The owner's own edit
  produces a proposal they may review-and-apply in the same act ("apply now" on their own
  proposal); a Director-may edit on a Legal domain routes to Senior Legal. Applying a proposal
  recomputes `content_hash` → **attested sections drift** and demand re-attestation — the
  drift machinery Draft 6 already renders, now with a cause.
- **The editor refuses what the engine would refuse.** Every WS1–WS3 police rule runs on hand
  edits: response-clock band (1..45 business days), a `kind` on every timer, no primary-eligible
  denial deadline, policed domains (`clarification`/`payment`/`fee_waiver`) never accept a
  guessed enum, unroutable `assignee_role` refused. Refusals are worded ("this would put a
  46-day response clock on every request — outside the reconciler's band"), not just red.
- **Empty is honest** (rule-b posture): a domain the state never imported renders "No content —
  import a state template or add the first rule," never an alarm, never a fabricated default.

## 2. The three worked frames

- **Frame A — Fee section** (the pattern demo): statutory chargeability facts (navy, cited: TX
  personnel time per AG schedule; the §552.2615 itemization trigger) beside city knobs (dashed
  amber: the copy rate the city charges within the allowed method, confirm flow). Shows both
  kinds on one screen, plus provenance and a pending proposal inline.
- **Frame B — Exemptions** (Legal Rules): the exemption list, each row citation-chipped and
  showing **wiring** — which redaction rules consume it (`wired` vs `content-only`, branchProfile
  vocabulary). Edit modal = the proposal composer: change + citation + note, preview of what
  drifts. Read-only banner as a team supervisor would see it ("Legal Rules — you can do the
  redaction task; you cannot change its rules").
- **Frame C — Deadlines & Clocks** (the compliance-heavy one): the named-timer table (name ·
  kind · duration · citation), kinds rendered in the ClockChip grammar so `operational_target`
  can never masquerade as statutory; the band guard shown refusing a 46-day response edit; the
  OH one-liner (timers exist, none statutory, targets are city knobs).

## 3. Bindings

| Surface | Binds to |
|---|---|
| Section screen | `jurisdiction_rules` row per domain; status/owner from `GET /api/jurisdiction-profile/status` + permission-group display metadata (Draft 6 build item 3) |
| Content zone | domain config JSON rendered per-domain (each domain gets its renderer — the pattern is shared, the content templates are per-domain) |
| Cited facts | `provenance` + `source_rule_ids` → research rule text (drill-down = Draft 6 open q4, drafted IN) |
| Edit-as-proposal | `config_proposals` + `effectiveConfig.applyConfig` (BUILT — the same flow template imports use); apply → `content_hash` recompute → drift vs `attested_hash` |
| Knob zone | Draft 6's confirm endpoint (NEW there, shared here) |
| Police rules | the WS1–WS3 validators (`clockMatrix` reconciler band, policed-domain rule, kind requirement) run at proposal-compose time, not just apply time |
| Wiring indicators | `branchProfile` capabilities `wired` flag; redaction-rule consumption for exemptions |
| Permissions | permission groups per §5 of the role model (`DESIGN_user_type_role_model.md`) |

## 4. Build implications (if the shape survives)

1. **Per-domain content renderers** (15, most trivial — a cited list or a small table); the
   section-screen shell, knob zone, and proposal composer are shared components.
2. **Proposal composer for hand edits** — today proposals are born from template imports; this
   adds a UI author path (same table, same review/apply, new `origin: 'editor'`).
3. **Validator surfacing** — the WS1–WS3 police rules need callable-at-compose-time form with
   human-readable refusals.
4. **Owner labels + permission-group gating** on the route (Draft 6 item 3 grows teeth).
5. **Research-text drill-down** (provenance → rule text) — the gather's rules become viewable
   from the editor.

## 5. Open questions for Kevin

1. **The ownership mapping** — is Legal Rules owning `deadline` + `clock_matrix` right (they are
   statutory timing), or should those sit with Workflow & Taxonomy?
2. **Director-may on Legal domains** — drafted as Director edits create a proposal routed to
   Senior Legal (may not self-apply). Or may the Director apply directly on Legal domains too?
3. **Per-domain depth for v1** — all 15 renderers, or the high-touch six first (exemption,
   redaction, fee, deadline, clock_matrix, clarification) with the rest read-only JSON-pretty
   views until needed?
4. **Research-text drill-down** — drafted IN (provenance zone). Keep for v1, or link-out later?
5. **Should applying any Legal-domain proposal require the section to re-attest before the
   engine uses it** (strict), or drift-warn only (drafted — matches current WS1 behavior)?

## 6. Not re-opened

The attest/refuse mechanics, drift hashing, the proposal review/apply flow, the knob-confirm
design (Draft 6), rule-(d) gating, permission groups themselves (role model §5), the
never-hand-edit-generated-templates rule (that rule is about the Phase-6 pipeline files; the
live `jurisdiction_rules` config is exactly what these editors legitimately edit).
