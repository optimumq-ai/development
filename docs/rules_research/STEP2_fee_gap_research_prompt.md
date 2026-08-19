# Fee & Estimate GAP PASS — Research Prompt (Step 2) — **DRAFT for Kevin's review, 2026-08-19**

> Status: **DRAFT — not yet run.** Companion to `FEE_MASTER_LIST.md` (step 1). Inherits the V2 discovery
> discipline (`V2_state_research_prompt.md`) unchanged wherever this prompt is silent: anti-fabrication,
> verbatim source language with `is_paraphrase`, source hierarchy, authority treatment, duplicate handling,
> case-law boundary, the 18-column rule schema, prohibited output. **What is new here:** the pass is driven by
> a fixed 36-item checklist per state, it is *required* to follow statutory delegations into the regulation /
> AG rule / uniform schedule that actually holds the figure, and it returns a per-item **resolution** the
> generator can consume — not just more rules.

## Why this pass exists (one paragraph, so the researcher knows what "done" means)

The library's fee content is thorough on **rules** and thin on **values**. Step 1 measured it: for 36
engine items × 32 states, a usable figure exists in ~19 states for the copy rate, ~6 for labor, ~8 for the
deposit threshold; ~12 states legitimately defer to "actual cost"/"reasonable"; ~10 delegate a figure to a
regulation the statute-level research never opened (Texas: Gov't Code § 552.262 → AG rule 1 TAC § 70.3);
one state (NJ) has no rules at all in the corpus. The gap pass exists to turn every one of the 36 × 32 cells
into exactly one of: **a sourced value/bound**, **an explicit "state defers to the municipality"**, or **a
confirmed "state is silent"** — so a city in any of the 32 states gets a first-pass fee configuration
generated from the library with no state needing bespoke code.

---

## Inputs supplied with each run (per state)

1. `{{STATE}}` / `{{ST}}` and the research date.
2. **The state's 36-item slice of `fee_master_list.json`** — for each item: `id`, `label`, `type`, the
   canonical concepts, the auto-derived `status`, the member `rule_ids`, `citations`, `values` found, and a
   `snippet`. Treat it as **the checklist and the prior**, not as truth: the statuses were machine-derived.
3. **The 23 canonical fee/payment concepts** from `master_concept_dictionary.json` (key + definition).
   Map every new rule to one; coin a key only if none fits and list it under *Proposed Concept Keys*.
4. **The state's existing fee/payment rule rows** (V2 schema) so you extend the sequence (`{{ST}}-NNNN`
   continues from the highest existing id) and never re-discover what is already there. You may **amend** an
   existing row (mark `supersedes`/`amends` with its id) when your opened source shows it wrong or stale.

---

## The one mandate that is new: FOLLOW DELEGATIONS TO THE INSTRUMENT THAT HOLDS THE NUMBER

When the statute delegates a fee figure — *"as established by rule," "adopted by the Attorney General,"
"the uniform fee schedule," "the department shall set," "not to exceed the amount set by the Secretary of
State"* — you **must** locate and open the delegated instrument (administrative code / AG rule / published
fee schedule / official guidance carrying the schedule) and extract the operative figures from it, verbatim,
with the instrument's own citation, source type (`Administrative Rule`, `Official Guidance`, `Official Form`)
and effective status. The statute row stays; the instrument becomes a **new rule row** linked to it by
`Related Rule IDs`, and the item's resolution cites **both**.

If the delegated instrument cannot be found or opened after a genuine search, the item resolves to
`delegated_unresolved` with a **search log** (what you looked for, where, what you found instead). Never fill
a delegated figure from a secondary source (a law-firm summary, a county FAQ, a vendor page). Never infer a
figure from a neighboring state.

**Municipal applicability is part of the mandate.** Many states publish a *state-agency* schedule (a
"uniform fee schedule" for executive agencies) that does **not** bind cities. For every figure, state whether
it binds municipalities, binds only state agencies, or is a default cities may adopt — and record that in
`applies_to`. An agency-only figure resolves the item for municipalities as `defers_to_city` (with the
agency figure noted as guidance), not as `value`.

---

## What you resolve: the 36 items

Work the checklist in this order (it mirrors the engine): duplication (B&W, color, oversized/nonstandard,
specialty; graduated bands; free page allowance) → labor (search, review/redaction, programming rates; *when
labor is chargeable at all* — never / always / only above N pages or N hours, paper-only scope; overhead or
fringe %; time increment; free labor hours per request; free personnel time per requestor per period) →
estimates (itemized-estimate / cost-notice threshold; requester response window; revision-notice %; estimate
validity) → deposits & payment (deposit/prepayment threshold; deposit cap %; production conditioned on
payment; nonpayment consequence; clock effect while a deposit is unpaid; overrun re-issue rules; electronic
payment method) → ceilings/floors (request-level actual-cost cap; de-minimis; minimum fee) → media,
delivery, certification, audio/video (per recording / per minute / free minutes) → commercial-purpose
schedule → fee waiver (grounds; mandatory vs discretionary; purpose statement; written denial; appeal;
forfeiture on late response) → repeat / aggregated requests.

For **each item** return exactly one resolution row (schema below). An item can be resolved by an existing
rule row (cite its id), by a rule row you add in this pass, or by a documented absence.

### Resolution vocabulary (pick one per item)
| `resolution` | Meaning | Must carry |
|---|---|---|
| `value` | The state sets the operative figure/choice for municipalities. | `value`, `unit`, `basis=fixed`, source |
| `ceiling` / `floor` | The state bounds it; the city sets the operative value under/over the bound. | `value` (the bound), `unit`, `basis`, source |
| `range` | Both a floor and a ceiling. | both values, source |
| `actual_cost_standard` | "Actual cost" / "reasonable" / "direct cost" — no number; city sets within the standard. | the standard's verbatim term, source |
| `defers_to_city` | The statute expressly leaves it to the governing body / ordinance / local policy. | source |
| `structural` | The item is a rule the engine must *execute* (a required notice, a gate), not a value. | source; note the shape |
| `silent` | Searched (statute, rules, AG opinions, official guidance) — nothing found. | the coverage note |
| `delegated_unresolved` | Statute delegates; instrument not found/opened. | search log |
| `not_applicable` | The item cannot exist under this state's law (e.g., labor is categorically non-chargeable, so "labor rate" is moot). | source for the categorical rule |

Also carry: `rule_type` (Requirement · Permission · Prohibition · …), `applies_to`
(`municipalities` · `state_agencies_only` · `all_public_bodies` · `unclear`), `effective_status`, `is_paraphrase`,
`confidence` (`high` = opened primary source, figure verbatim · `medium` = opened source, figure needs unit/scope
judgment · `low` = paraphrase or secondary), and `manual_verification` (why, if any).

### Rules of resolution (do not weaken)
- **A number in a rule is not automatically the item's value.** Step 1's `V` cells only mean "a number
  appears in the text." Confirm the number belongs to *this* item, in *this* unit, for *municipalities*.
- **Requirement vs Permission is preserved** — a "may charge up to 25¢" is a `ceiling` under a Permission; a
  "shall charge 25¢" is a `value` under a Requirement. Same concept, different `basis` and `rule_type`.
- **Never convert a soft standard into a number.** "Reasonable" resolves to `actual_cost_standard`, verbatim.
- **Silence is a structured negative, not a guess.** `silent` requires the coverage note naming what you
  searched (statute chapter, admin code title, AG opinion index, records-authority guidance).
- **Recency.** Check 2024–2026 session laws and rule amendments for the fee sections specifically — rates and
  thresholds are the provisions legislatures actually change. Record `effective_status` per row.
- **Verbatim, always**, or `is_paraphrase = true` with the flag for manual verification.
- **Municipal scope first.** This product configures cities. Where a state runs two regimes (agencies vs
  local bodies), resolve for the local-body regime and note the other.

---

## Deliverables (per state)

1. **Research date & current-law statement** (as V2).
2. **Resolution table — exactly 36 rows**, one per item, in the JSON shape below (plus a readable table).
3. **New / amended rule rows** in the V2 18-column schema (+ `is_paraphrase`), ids continuing the state's
   sequence, `Related Rule IDs` linking an instrument to the statute that delegated to it, `amends`/
   `supersedes` where you correct an existing row.
4. **Delegations followed** — one line per delegation: statute cite → instrument found (cite, link,
   opened Y/N) → figures extracted → applies_to. This is the audit trail for the new mandate.
5. **Municipal-vs-agency applicability notes** — every figure whose scope needed judgment.
6. **Coverage matrix by item** — Resolved-from-existing-rule · Resolved-from-new-rule · Documented-absence ·
   Delegated-unresolved · Source-inaccessible.
7. **Material negative findings** and **Gaps & manual-verification list** (as V2).
8. **Proposed Concept Keys** (only if you had to coin one).

### Resolution row schema (JSON)
```json
{
  "state": "TX",
  "item_id": "rules.deposit.threshold",
  "resolution": "value",
  "value": "100 | 50",
  "unit": "USD (bodies with >15 FTE | ≤15 FTE)",
  "basis": "fixed",
  "rule_type": "Permission",
  "applies_to": "all_public_bodies",
  "resolved_by_rule_ids": ["TX-0034"],
  "new_rule_ids": [],
  "source_authority": "Tex. Gov't Code § 552.263(a), (a-1)",
  "source_type": "Statute",
  "official_link": "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.552.htm#552.263",
  "source_language": "<verbatim operative clause>",
  "is_paraphrase": false,
  "effective_status": "Current",
  "confidence": "high",
  "manual_verification": null,
  "notes": "Deposit is permitted once an itemized estimate has been provided; two thresholds by staff size."
}
```

---

## The VERIFY pass (independent agent, per state — same shape as the pre-blast 3-way gate)

Given the state's 36 resolution rows and their sources, **try to refute each row**: open the official link;
confirm the verbatim clause is present; confirm the value, unit, basis and `applies_to` (municipal scope);
confirm currency (no later amendment); confirm the resolution word is the right one (a ceiling recorded as a
value is a REFUTE). Verdict per row: `CONFIRMED` · `CORRECTED` (with the corrected row) · `REFUTED` (with why)
· `UNVERIFIABLE` (source not opened). Default to `UNVERIFIABLE`, never to `CONFIRMED`, when the source cannot
be opened. Only `CONFIRMED` rows enter the library as verified; `CORRECTED` rows go back through discovery
once; anything else is a human item.

Run shape: **linear per state — one discover agent, one verify agent, one reconcile step; hard cap 3 agents
per state, ~100 total.** (The earlier wave exploded to 1,068 agents on a pairwise verify — `rules-wave-safe`
exists for exactly this reason; the gap pass uses its partition-verify shape, not pairwise.)

---

## Acceptance for step 2 (what "the library is complete enough for fees" means)

For each of the 32 states: **36 of 36 items resolved** with a resolution word from the vocabulary; every
`value`/`ceiling`/`floor`/`range` row `CONFIRMED` by verify with verbatim source; every `delegated_unresolved`
carries a search log; `applies_to` never blank; NJ run under the full V2 discovery **first** (fees are a subset
of a state that has nothing) and then through this pass. Then step 3 (template `fee_schedule` gains
`value/unit/basis/engine_field/applies_to` from the CONFIRMED rows) has everything it needs.

## Open questions for Kevin before running
1. **Local-body scope only, or record agency schedules too?** The draft resolves for municipalities and notes
   the agency regime. Recording agency figures fully would cost little and matters if the product ever serves
   counties/state agencies.
2. **Recency window.** Draft says check 2024–2026 session laws for the fee sections. Wider?
3. **Budget/shape.** One discover + one verify agent per state, 32 states, ~2–3 hours wall-clock at the safe
   cap. NJ needs a full V2 discovery first (its own run).
4. **Estimate calibration is out** (operational data, not law) — confirm.
