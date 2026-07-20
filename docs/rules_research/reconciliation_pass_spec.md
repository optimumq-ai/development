# Reconciliation Pass — from 50 states of discovery to one parameterized model

> **Draft for red-line, 2026-07-20.** The assembly step that consumes the V2 research output
> (`V2_state_research_prompt.md`) and produces the cross-state configuration library. This is the step that
> was going to be the hard manual problem; the V2 columns exist to make it a *merge* problem instead of a
> *re-read* problem.

---

## The core idea

Each state agent runs **blind to the others** (a parallel fan-out can't share a growing dictionary within one
wave), so it **SUGGESTs** concept keys freely. Reconciliation is where those independent suggestions get
**merged into canonical concepts**, and where the parameterized model is actually built.

Reconciliation never re-reads statutes. It operates only on the structured columns the research already
produced — `Concept Key`, `Config Home`, `Clock Effect`, `Clock Spec`, `Related Rule IDs`, `Category`. That
is the whole point of those columns: the expensive semantic work happened once, at extraction, by the agent
that had the source sentence in front of it.

**Do not merge on `Concept Key` string equality alone.** Two states may coin the same slug for different
rules, or different slugs for the same rule. A merge is valid only when the underlying **Atomic Rule +
operative Source Language** say the same operative thing. The slug is a candidate; the rule text is the proof.

---

## Inputs and outputs

**In:** the per-state primary tables (all rows, all states in the wave) + the current **Concept Dictionary**
(empty on wave 1; grown by each prior wave).

**Out:**
1. **Concept Dictionary** (updated) — canonical `concept_key` → definition, category, config-home, aliases
   (every state slug that maps to it). This is fed back as INPUT to the next wave, so later states map more
   and suggest less, and reconciliation load falls over time.
2. **Parameter tables** (one per category) — for each `parameter` concept: concept × state → value(s) +
   citation. This is the parameterized model. (`fee.copy_rate_per_page`: AZ … · TX $0.10 · FL $0.15 …)
3. **Structural-branch catalog** — for each `structural` concept: which states have it, and the shape of the
   path/stage. These are the forks the engine must be able to express (AZ's Governor-review commercial-use
   path, a state's internal-appeal stage).
4. **Timing/tolling table** — every rule with `Clock Effect ≠ none`, pivoted concept × state → effect + spec.
   The calendar dimension, assembled — the thing V1's flat output could never produce.
5. **Unresolved bucket** — proposed keys that didn't cluster confidently, and suspected false-merges → human
   review. Nothing is silently merged or silently dropped.

---

## Stages

Run as a Workflow. Stages 2–4 fan out **per Category** (Fees, Deadlines, Redaction…) so they run concurrently
and each agent sees a coherent slice.

**1. Harvest & normalize** *(one pass, cheap).*
Concatenate all state rows. Trim obvious noise. Group by `Category`. Emit the distinct
`(state, Concept Key, Legal Concept, Config Home, Atomic Rule excerpt)` tuples per category. No judgment yet.

**2. Canonicalize concepts** *(per category, parallel; the core merge).*
For each category, an agent clusters the state-proposed keys into **canonical concepts**, using Atomic Rule +
Source Language as the identity test — not the slug. For each cluster it emits: canonical key, one-line
definition, config-home, and the alias list (state slug → canonical). Ambiguous or singleton clusters it
**does not force** — they go to the unresolved bucket with a reason. Output feeds the dictionary.

**3. Pivot** *(per category, parallel).*
- `parameter` concepts → build the value table: canonical concept × state → value + unit + citation. Flag
  states where the concept is **absent** (a material negative finding — meaningful, not a blank).
- `structural` concepts → build the catalog row: concept × states-that-have-it + a one-line shape.
- Any concept with clock rows → add to the timing/tolling table (effect + spec per state).

**4. Adversarial verify** *(per merged cluster, parallel; do NOT skip).*
For each canonical cluster, an independent agent tries to **refute the merge**: are two rules here that carry
a *different* operative effect (a deadline that tolls vs one that's hard)? a value pulled from a
special-record fee schedule masquerading as the ordinary rate? a `structural` fork flattened into a
`parameter`? Default to **split** on doubt. Confirmed false-merges return to stage 2's input; survivors are
locked. This is where the per-row citation requirement pays off — a merge with no shared operative language
fails here.

**5. Emit & feed back** *(one pass).*
Write the five outputs. The updated Concept Dictionary becomes the next wave's input.

---

## Wave strategy

- **Wave 1 (seed):** the states already done by hand (Arizona, Alabama) + a few more. Produces the first
  dictionary. Highest suggestion rate, highest reconciliation load — expected.
- **Waves 2…N:** each wave's state agents receive the current dictionary, so they map to existing canonicals
  and only SUGGEST genuinely new concepts. Reconciliation shrinks each wave toward "absorb a handful of new
  concepts + fill in the value matrix."
- **Convergence signal:** when a wave produces near-zero new canonical concepts (only new *values* for
  existing concepts), the concept model is saturated — the remaining work is data entry, not discovery.

---

## How to run it (Workflow shape)

```
Phase 1 — Discover (parallel, one agent per state in the wave)
  agent(V2_prompt with {{STATE}} filled + current dictionary, schema = the 18 columns)
    → per-state rows

Phase 2 — Reconcile (pipeline, per Category)
  harvest(all rows) grouped by category
  → canonicalize(category)            // stage 2
  → pivot(category)                   // stage 3
  → verify each cluster (parallel)    // stage 4, adversarial, default-split
Phase 3 — Emit
  dictionary (feed back) + parameter tables + structural catalog + timing table + unresolved bucket
```

Notes for whoever wires this:
- Force **structured output** on Phase 1 (the columns) so no state returns prose.
- Phase 2 canonicalize is a genuine **barrier** per category — it needs *all* of a category's rows at once to
  cluster. That's the rare justified barrier; the per-cluster verify in stage 4 is not — pipeline it.
- Keep a state's rows attributed to that state end-to-end (the parameter table is concept × **state**).
- **Citations ride through untouched** — reconciliation must not invent or drop a source link.

---

## Guardrails

- **Nothing merges without shared operative language.** Slug collision is a hint, never a merge.
- **Nothing is silently dropped.** Unclustered → unresolved bucket. Deliberately excluded upstream → already
  in the state's Excluded list.
- **`parameter` vs `structural` is load-bearing** — a misfiled structural fork becomes a value nobody can
  configure. Stage 4 checks this explicitly.
- **Absence is data.** A concept present in 30 states and absent in 5 is a material finding about those 5, not
  a gap to paper over.
- **This pass designs nothing.** It clusters, pivots, and verifies discovery output. The actual config-UI and
  engine changes are a separate, later step (governed by `AUTO_CONFIG_DESIGN.md`), and stay a human decision.
