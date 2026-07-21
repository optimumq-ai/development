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
**Also harvest each state's material negatives AND excluded items** — not just its rules (see stage 2b).
**Drop contentless rows before clustering** (empty Source Language + no Config Home + no Trigger + no Clock):
pilot #1 / the A/B showed these are the dominant cause of bad merges — a shell with nothing to compare gets
fused into real rules and destroys their content. A dropped shell is logged, not silently discarded.

**2. Canonicalize concepts** *(per category, parallel; the core merge).*
For each category, an agent clusters the state-proposed keys into **canonical concepts**, using Atomic Rule +
**verbatim Source Language** as the identity test — not the slug. (The A/B proved this: paraphrase flattens a
multi-factor *test* and a bare *policy* both to "reasonable time," and the merger fuses them; the verbatim
operative text is what keeps them apart. Weight verbatim over paraphrase when both are present.) For each
cluster it emits: canonical key, one-line definition, config-home, and the alias list (state slug →
canonical). Ambiguous or singleton clusters it **does not force** — they go to the unresolved bucket with a
reason. Output feeds the dictionary.

**2b. Reconcile across rules AND negatives/exclusions (pilot #1 — the asymmetry that fakes differences).**
The join must not compare rule-to-rule only. A fact one state emits as a **rule** and another emits as a
**material negative** (or drops via exclusion) is the *same law* stated two ways — if the join can't see the
negative side, it reports a phantom cross-state difference. So for every canonical concept, also scan the
other states' negatives and exclusions for the same fact and fold it in. Universal-access facts
(`eligibility.any_person`, `eligibility.no_residency_requirement`, …) are the worst offenders and now carry a
fixed shared key upstream; this stage catches the rest.

**3. Pivot** *(per category, parallel).*
- `parameter` concepts → build the value table: canonical concept × state → **constraint basis** +
  bound/value + unit + citation. **The state layer is a CONSTRAINT, not the final number** (ruled
  2026-07-21): a state gives a `fixed` value, a `ceiling` ("shall not exceed 25¢"), a `floor`, or a
  `soft-standard` ("reasonable"), and the *city* plugs in the operative value underneath it. So a ceiling-25¢
  state and a fixed-25¢ state are the **same concept** (`fee.copy_rate_per_page`) with a different `basis`
  attribute — never two concepts. Default-when-city-blank = worst-outcome-for-requestor (for a ceiling, the
  max; for a soft standard, no number — leave for the city). Flag states where the concept is **absent**
  (a material negative finding — meaningful, not a blank).
  - *City-layer validation (lives in `AUTO_CONFIG_DESIGN`, noted here for the contract):* when a city uploads
    an ordinance value, validate it against this constraint — value ≤ ceiling (or ≥ floor). A violation is
    **flagged for review**, never silently accepted and never silently clamped.
- `structural` concepts → build the catalog row: concept × states-that-have-it + a one-line shape.
- Any concept with clock rows → add to the timing/tolling table (effect + spec per state).

**4. Adversarial verify** *(per merged cluster, parallel; do NOT skip).*
For each canonical cluster, an independent agent tries to **refute the merge**: are two rules here that carry
a *different* operative effect (a deadline that tolls vs one that's hard)? a value pulled from a
special-record fee schedule masquerading as the ordinary rate? a `structural` fork flattened into a
`parameter`? Default to **split** on doubt.

> **Do NOT split on parametric variance (ruled 2026-07-21).** Two rules for the *same underlying parameter*
> that differ only in **constraint basis** (`fixed` vs `ceiling` vs `floor` vs `soft-standard`) or in the
> **value** (25¢ vs 50¢) are the **same concept** — HOLD them; the basis and value are per-state attributes,
> not concept boundaries. Split only when the *underlying operative rule* differs: a different fee type (copy
> vs search), a different record class (ordinary vs special-format), a toll-vs-terminal clock, or a
> judicial-vs-administrative fork. (This is the `true-copy-rate` miss the gate fixture caught: cap-25 vs
> fixed-25 must HOLD.)

Confirmed false-merges return to stage 2's input; survivors are locked. This is where the per-row citation
requirement pays off — a merge with no shared operative language fails here.

**Pairwise-COMPLETE, never sampled (gate 2, 2026-07-21).** Verify must run on **every cross-state pair inside
every multi-member cluster**, not just clusters flagged "contested." The clusterer over-fuses on summary
glosses — in a 4-state gate it proposed ~3 false fusions, incl. a non-transitive triangle (AZ~NY hold, but IL
splits from both) that single-linkage would have admitted. An unchecked pair inside a large cluster is exactly
where a transitivity failure slips through. Do **not** let this degrade to sampled pairs under scale/cost
pressure — verify is load-bearing here, not a backstop.

> **Prove verify BITES before the blast (pilot #1 — verify passed 2 merges and rejected 0, so its guardrail
> is unproven).** Seed the verify stage with a **red-team false-merge fixture**: false pairs it must SPLIT
> (toll-vs-terminal, ordinary-vs-special fee, judicial-vs-administrative) AND true pairs it must HOLD
> (same-value, parametric variants). Gate 2 (2026-07-21) landed this at **7/7** — proving verify both bites
> and discriminates. Run it as a **standing check**, not a one-time spot check.

**4b. Apply the verdicts — regenerate the map (gate 2 — the step the harness lacked).** Verify *deciding* a
split is worthless if the emitted map ignores it. After verify, **re-home every split member to its own
concept and regenerate the canonical list** so the output contains zero clusters verify rejected. The gate
proved the verdict layer correct while the displayed clusters still showed the fusions verify had split —
that gap must be closed *in the pipeline*, not left to a reader. **Acceptance check:** diff the pre-verify
candidate clusters against the post-verify map and confirm every split verdict is reflected; a fused pair that
verify split must not appear in the final map.

**5. Emit & feed back** *(one pass).*
Write the five outputs. The updated Concept Dictionary becomes the next wave's input.

### Many-state merge semantics (pilot #1 — untested at n=2, must be defined before the blast)
At 2 states almost every concept is single-state, so the pipeline never merged a **third** member into an
existing pair. Define it explicitly before scaling: when state C's rule joins an existing canonical concept
that already holds A and B, **verify C against every current member (A *and* B), not just one** — a merge is
only valid if C shares the operative rule with all of them. Merging is **not assumed transitive**: A≈B and
B≈C does not license A≈C without C being checked against A. If C matches some members but not others, that is
a signal the canonical concept is too broad — **split it**, don't force C in. Add a 3rd seed state early to
exercise this before committing to the full run.

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
