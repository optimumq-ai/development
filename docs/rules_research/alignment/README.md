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
- **`master_concept_dictionary.json`** — THE deliverable. All **1,116** pruned rules (updated 2026-07-26:
  +9 `amendments_2025.json` supplements, +6 restored TX AG-referral rules) clustered into **122 canonical
  concepts** across 17 families (874 source keys → 122; 0 catch-alls after review). Every rule mapped
  exactly once (0 dropped, 0 duplicated). Each entry: canonical_key, family, resolved config_home,
  state_count, states, representative definition, merged_from (source keys), members_by_state (rule_ids).
  Mirrored to the exchange folder as `Master_concept_dictionary.xlsx` (`../scripts/gen_dict_xlsx.js`).
  New concepts 2026-07-26: `appeal.ag_referral_to_withhold` (TX, 8 rules) · `denial.deemed_disclosure`
  (TX-0022 — was mis-merged into deemed_denial by the `/deem/` regex; now split) ·
  `eligibility.vexatious_requester_gate` (OH) · `response.catastrophe_suspension` (TX).
- `master_concept_dictionary_SEED.json` — the earlier 75-concept multi-state seed (superseded by the master).
- `families/eligibility.json`, `families/timing.json` — the two hand-curated family slices (drove the master
  via a key→canonical lookup); the rest were clustered by a tuned per-family functional bucketer.

## config_home (the design payload)
122 concepts: **8 pure parameter, 47 mixed, 67 structural**. The ~55 parameter/mixed concepts are the
**value-knobs** a per-state/city config template fills (copy rates, response windows, fee schedules, deposit
thresholds, extension length…); the 74 structural are process-shape forks. `mixed` means states split
parameter-vs-structural — usually the qualitative-standard-plus-local-value pattern (e.g. response window is
a number in 21 states, a soft "promptly" in 10), but sometimes a discovery mis-code to resolve at design time.

## Status / caveats (first-pass draft)
The eligibility + timing families were hand-clustered (high confidence). The remaining families were
clustered by tuned regex bucketing of concept_keys — good first-pass, but the `*.other_*` catch-alls
(~4% of rules; biggest is custody.other 16) and any coarse merge should be reviewed before the design
commits. Refine a family by editing its bucket rules (scratchpad `align_all.js`) and re-running.

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
