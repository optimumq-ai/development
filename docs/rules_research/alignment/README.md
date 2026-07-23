# Cross-state alignment — working notes

Goal: fold the 32-state pruned rule set (`../pruned/pruned_discovery.json`, 1,101 rules) into a **master
concept dictionary** — canonical concepts, each mapping to per-state member rules + a resolved `config_home`
(parameter = city fills a value / structural = process-shape fork), so the design can drive per-state
config templates ([[requester-class-eligibility-cluster]], [[compliant-automation-principle]]).

## Landscape (measured 2026-07-23 from the pruned set)
- 1,101 rules → **860 unique normalized concept_keys**.
- **91% (785) are singletons** (one state only). Only 75 concepts span ≥2 states; ~26 span ≥3.
  → concept_keys are only lightly pre-aligned; alignment is a real **semantic clustering** job.
- Fragmentation is worst in **fee (195 concepts/248 rules), production (124/141), intake (91/108)** —
  each state coined its own sub-keys (~1.3 rules/concept). Eligibility is already tight (21/106).
- Trivial family-name splits to normalize: deadline/deadlines, denial/denials, communication/communications,
  special/special_records.
- **11 config_home conflicts** in the seed alone (e.g. `eligibility.no_purpose_requirement` is structural
  in 28 states, mis-coded parameter in 4) — confirms the known config_home unreliability; resolve by
  legal analysis / majority, not by trusting the discovery value.

## Artifacts
- `master_concept_dictionary_SEED.json` — the 75 multi-state concepts (canonical_key, majority config_home,
  representative definition, states, member rule_ids). The confident core to build on.

## Method (safe, linear — NOT the quadratic pairwise verify, see [[workflow-fanout-safety]])
Align **family-by-family** (each family is a bounded sub-problem; linear in families, never pairwise across
all concepts):
1. Normalize family-name variants.
2. Within each family, cluster its concepts into canonical concepts (semantic — read the rules; the
   token-overlap heuristic produces false merges like no_purpose⇄no_residency, so it can't be automated blind).
3. Resolve config_home per canonical concept (legal analysis, not discovery value).
4. Emit dictionary entries: canonical_key, definition, config_home, per-state members + their parameter values.
Order by tractability/overlap: eligibility → deadline/response → denial → intake → payment → redaction →
custody/routing → production → **fee** (biggest/last). Big-three (fee/production/intake) are the bulk.
