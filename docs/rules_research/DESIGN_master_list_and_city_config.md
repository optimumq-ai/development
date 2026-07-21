# Design note — the state research is the shipped "master list"; the city uploads only its local policy

> Ruling captured 2026-07-21 (Kevin). Product-model clarification for how the 50-state rules research feeds
> city configuration. **Nothing in the research prompt changes** — this is about how its *output* is used.
> Governed by `AUTO_CONFIG_DESIGN.md`; the parametrization mechanics live in `V2_state_research_prompt.md`
> and `reconciliation_pass_spec.md`.

## The purpose of the whole gather/parametrize/match exercise
To **guarantee that every configuration item a city could need under its state's law actually exists on the
configuration screens.** The research output — the concept dictionary + parameter tables + structural-branch
catalog — *is* the **master list of items**. If any state uniquely requires something, that something becomes
a selectable item in the master list, so a city in that state can turn it on and enter their local value.

This is the completeness half of `AUTO_CONFIG_DESIGN`'s "expressiveness precedes automation": the field must
exist before AI (or anyone) can populate it. Fully auto-populating a config from the AI wizard is a bonus, not
the goal — the goal is that the right **fields and checkboxes are present**.

## Two layers, one customer upload

| Layer | What it is | Who supplies it | When |
|---|---|---|---|
| **State layer (the master list + constraints)** | Which items must exist for a city in this state, and how state law binds each: `fixed` / `ceiling` / `floor` / `soft-standard` ("reasonable"), plus mandatory vs permitted. | **OptimumQ**, from this research — done **once**, shipped with the product, pre-loaded per state. | Build time. |
| **City layer (the values)** | The city's actual numbers/choices. | **The city**, by uploading its **local policy/ordinance** — AI extracts the values into the pre-built fields. | Setup. |

**The customer uploads ONE document: their own local policy.** They do **not** upload state legislative
content — OptimumQ already encoded the state layer as the master list. AI configures from the local policy
against the pre-built field set and its state constraints.

*(This refines, not contradicts, the earlier two-document framing: the state layer is a shipped OptimumQ asset,
not a per-customer upload. The city-value validation is unchanged.)*

## What this model gives for free
1. **Omissions become visible.** If a city's local policy is silent on something state law requires, the field
   is still there, empty, demanding a value. The city cannot silently skip a state-mandated item, because the
   completeness guarantee already put the field on the screen — a silent gap becomes a visible one.
2. **Validation works without a state-law upload.** Constraints come from OptimumQ's research, baked into each
   field, so a local policy that charges over a state ceiling (30¢ vs a 25¢ cap) is still flagged. A violation
   is surfaced for review — never silently accepted, never silently clamped. (See the city-layer validation
   note in `reconciliation_pass_spec.md` §3.)

## Consequences for the build
- **Completeness discipline is now mission-critical.** The master list ships as the completeness guarantee for
  *every* city in a state. A missed requirement is not a per-city inconvenience — it is a compliance gap for
  all of them. This is why the coverage matrix, material-negative reporting, and "never skip a requirement"
  rules earn their keep in the research prompt.
- **Requirement vs Permission drives required-field vs optional-checkbox.** The research already tags Rule Type.
  A `Requirement` becomes a field the city **must** fill; a `Permission` becomes an option the city **may**
  enable. The completeness guarantee is strongest for requirements.
- **The research prompt is unchanged by this note** — it still produces the master list. Only the framing of
  how the output is consumed (shipped substrate + city-policy-only upload) is clarified here.
