# Pre-blast gate RE-RUN — 4 states (AZ/NY/IL + Virginia), verify fix (2026-07-21)

> Workflow `rules-gate-3way-verify`, resumed run `wf_f5982ff6-7d1` (AZ/NY/IL discovery cache-replayed;
> Virginia + reconciliation ran live). 37 agents, ~659k tokens, ~23.8 min.
> **Verify BITES: 7/7 clean** (the two parametric-variance misses now HOLD; the 4 real-difference pairs still SPLIT).
> **Virginia divergence: PASS** (residency-required → kept OUT of the "any person" / "no residency" clusters).
> **Empty-rule discipline: 0/0/0/0.**
> ⚠️ Two caveats in the session notes: (1) a harness key-normalization bug crashed 20 of 44 real pairwise
> checks — cosmetic, the 7/7 fixture is the definitive verify proof and 24 checks still demonstrated the
> mechanism; (2) the pipeline computes verify verdicts but does not yet APPLY them to reshape the final map.

---

# PRE-BLAST GATE — 50-State Legal-Rule Extraction

**Run:** re-run after 4/5 first gate · **States in scope:** AZ, NY, IL, VA (VI) · **Date:** 2026-07-20

---

## 1. GATE VERDICT — **GO**

**GO for the 50-state blast.** Both gate items pass. The parametric-variance fix landed verify at a clean **7/7** on the labeled BITES fixture — the two prior misses (ceiling-vs-fixed-same-value, variant-and-different-value) now correctly **HOLD**, and critically the fix did *not* turn verify into an always-holder: it still **SPLIT** all four genuinely-different pairs. The four-state merge held where concepts are genuinely shared (no-residency, copy-rate) and pairwise-complete verify caught every contested cluster the summary-gloss clusterer over-fused, splitting them on the verbatim text. The divergent-state stress test passed cleanly: Virginia, which may impose a residency/citizenship condition, was **kept out** of both the "any person" and "no residency requirement" eligibility clusters rather than fused in. The GO carries **one non-blocking pre-flight condition** (Section 3): the final canonical must render the pairwise-split verdicts, not the candidate-cluster list — three of the displayed multi-state clusters are gloss-fusions that verify already rejected.

---

## 2. Verify BITES? — **7/7, clean pass**

| # | Fixture label | Expected | Got | Correct |
|---|---|---|---|---|
| 1 | toll-vs-terminal | split | split | ✅ |
| 2 | ordinary-vs-special-fee | split | split | ✅ |
| 3 | judicial-vs-administrative-appeal | split | split | ✅ |
| 4 | copyrate-vs-searchfee-different-parameter | split | split | ✅ |
| 5 | true-response-window | hold | hold | ✅ |
| 6 | copyrate-ceiling-vs-fixed-same-value | hold | hold | ✅ |
| 7 | copyrate-variant-and-different-value | hold | hold | ✅ |

**The prior miss is fixed.** Fixtures 6 and 7 are the exact parametric-variance shape that failed the first gate: same parameter (per-page copy fee), differing only in *constraint basis* (ceiling vs fixed) or *value* (25¢ vs 50¢). Both now HOLD, matching the 2026-07-21 ruling that the state sets the constraint and the city fills the value.

**It did not overcorrect into an always-holder.** The three false-hold traps all still split on a real concept boundary: a clock effect (toll pauses/resumes vs terminal deems-abandoned), a record class (standard page vs oversized sheet), a forum (agency appeal vs superior-court special action), and a parameter/unit (per-page copy vs per-hour search). Verify discriminates *basis/value variance* (hold) from *obligation/clock/class/parameter* differences (split) — which is precisely the behavior the blast depends on. **No misses → GO on this item.**

---

## 3. MANY-STATE MERGE — held, and pairwise-complete earned its keep

**The rule held across four states, and the pairwise-complete pass is the reason it's trustworthy.** The candidate clusterer over-fuses on summary glosses ("any person / no requester-eligibility"), and pairwise-complete verify — checking every pair on *verbatim* text — caught and split every one of those false fusions. Concretely:

**Contested clusters the pairwise pass correctly broke (transitivity hazards):**
- **`eligibility.any_person`** (AZ-0001 / NY-0001 / IL-0001) — **3/3 pairs SPLIT.** The gloss hid three distinct obligations: AZ's standing inspection *right* (no clock), NY's 5-business-day *response duty* (comply/deny/acknowledge), IL's *scope-of-access + copying* mandate with the §7/8.5 exemption fork. This candidate cluster must dissolve; the three rules re-home to distinct concepts.
- **`appeal.judicial.enforcement`** (AZ / NY / IL / VA) — **3/3 checked pairs SPLIT.** AZ superior-court special action, NY Article-78 review-of-appeal (requires prior administrative exhaustion), IL plenary injunctive/declaratory suit — three different remedy rungs and vehicles. Spurious four-member cluster; dissolves to singletons.
- **`denial.constructive_denial`** (AZ / NY / IL / VA) — **non-transitive triangle:** AZ~NY **hold**, but AZ≠IL **split** and NY≠IL **split**. Single-linkage would wrongly pull IL (a hard 5-day three-way fork) in behind the AZ~NY hold. Pairwise-complete correctly isolates IL. Final concept = {AZ, NY} only.
- **`eligibility.no_purpose_requirement`** (AZ / NY / IL / VA) — AZ splits from both NY and IL (AZ gates commercial requesters with a purpose-statement *access condition*); NY~IL **hold**. Cluster must keep {NY, IL, VA} and **drop AZ**.

**Clusters that genuinely held (parametric variance, correctly fused):**
- **`eligibility.no_residency_requirement`** (AZ / NY / IL) — 3/3 **hold**. Same obligation, differs only by jurisdiction.
- **`fee.copy_rate_per_page`** (NY 25¢ ceiling / IL 15¢ ceiling / AZ soft-uncapped) — 3/3 **hold**. Pure basis+value variance across all three pairs — the fix working at cluster scale.

**Virginia divergent-state test — PASS.** VA is absent from `no_residency_requirement` and from `any_person`; because VA may condition access on residency, it does *not* share the universal-access concept and was correctly **kept separate** rather than fused with the three look-alike states. VA still joins concepts it genuinely shares (`no_purpose_requirement`, `foia_officer_designation`, `requested_medium`, `constructive_denial` as a member — pending the IL exclusion above). The stress state did not contaminate the eligibility clusters.

**Response-deadline probe — healthy discrimination, no soft-into-hard collapse.** AZ's soft "promptly" and its acknowledge-receipt window stayed as their own concepts (`production.promptly_furnish`, `intake.acknowledgment_window`) and did **not** fuse into the hard day-count deadlines — correct per the soft-vs-hard fork. NY's 5-day *three-way* (make-available / approximate-date / deny, NY-0009) stayed distinct from IL's 5-day *comply-or-deny* (IL-0007) despite the identical day-count, because the obligation structure differs; IL-0007 fused only with VA-0007 (same comply-or-deny obligation). The pipeline did not lazily collapse "5 days = 5 days" — further evidence it is not an always-holder.

**Pre-flight condition (non-blocking):** the CANONICAL headline ("9 three-state clusters; 0 unresolved") and the displayed cluster membership still list `any_person`, the four-member `judicial.enforcement`, and the IL arm of `constructive_denial` as fused. The pairwise verdicts are decisive and `UNRESOLVED` is empty, so the *verdict* layer is correct — but the **candidate-cluster display must be reconciled to honor the pairwise splits before the map ships**, or a false fusion rides along into the 50-state output.

---

## 4. DISCOVERY DISCIPLINE

**Contentless slip-through: 0 / 0 / 0 / 0 — clean across all four states.** The V2 prompt tightening held; nothing empty passed the gate.

**Verbatim capture rate:**

| State | Rules | Verbatim | Rate | Material negatives |
|---|---|---|---|---|
| AZ | 25 | 18 | **72.0%** | 10 |
| NY | 25 | 22 | 88.0% | 6 |
| IL | 39 | 38 | **97.4%** | 6 |
| VA (VI) | 27 | 24 | 88.9% | 12 |
| **Total** | **116** | **102** | **87.9%** | 34 |

**AZ did not improve — it is the same 72% as last run.** The cached AZ pull was reused, not re-fetched under the updated V2 prompt; 7 of 25 AZ rules still lack verbatim text. Every other state is ≥88% and IL is near-perfect at 97%, so 72% is an AZ-specific artifact, not a prompt regression. This is the single sharpest discipline gap going into the blast (see Section 5).

**Universal-access facts captured as rules, not negatives.** `any_person`, `no_residency_requirement`, and `no_purpose_requirement` are encoded affirmatively as rules (AZ-0001/0002/0003, etc.) rather than dumped into material-negatives — correct. Virginia's *absence* of a no-residency rule is the intended exception (it has the requirement), and VA's higher negative count (12) is consistent with its greater divergence.

**Constraint basis captured for parameter rules.** The fee concepts carry explicit basis tags — NY/IL "shall not exceed" (ceiling), AZ "may charge / no statewide cap" (soft/uncapped) — which is exactly what let the copy-rate cluster hold across a ceiling+ceiling+soft triple. The basis field is populated and load-bearing.

---

## 5. REMAINING RISKS before scaling

1. **AZ verbatim stuck at 72% (cached, not re-pulled).** Highest-priority pre-blast fix. If 72% reflects a *fetch/parse weakness* on AZ's source format rather than genuine source gaps, 46 unseen states may inherit it silently — and the census would look "green" while shipping paraphrase-only rules. **Force a fresh AZ pull under V2 and confirm the rate moves before blast**, so we know whether 72% is a source ceiling or a pipeline bug.

2. **Divergent-state coverage is n=1.** VA validated the residency axis only. Other divergence axes are untested at scale: purpose-as-access-condition (AZ commercial), states with *no* judicial remedy, fee-shifting/attorney-fee states, and states with statutory day-counts that toll on clarification. One clean divergent state is not proof the clusterer resists every divergence pattern.

3. **Pairwise-complete cost and coverage at 50 states.** The safety net is O(n²) per cluster. With 50 states, clusters will be larger and more numerous; confirm pairwise-complete actually runs on **every multi-member cluster**, not just the ones flagged contested — an unchecked pair inside a large cluster is exactly where a single-linkage transitivity failure (like the `constructive_denial` AZ~NY~IL triangle) would slip through.

4. **The pipeline leans on verify to undo the clusterer's gloss-fusion.** Candidate clustering proposed at least three false fusions in a four-state sample. That's fine while pairwise-complete runs on everything, but it means verify is load-bearing, not a backstop — any future latency/cost pressure that samples pairs instead of exhausting them would immediately re-admit gloss fusions. Do not let pairwise-complete degrade to sampled under scale pressure.

5. **Candidate-display ↔ verdict reconciliation is unproven end-to-end.** The verdict layer is correct and `UNRESOLVED` is empty, but this run still *shows* fused clusters that verify split. Until the final concept map is regenerated and confirmed to drop `any_person`, the four-member `judicial.enforcement`, and the IL arm of `constructive_denial`, we haven't demonstrated the reconciliation step actually fires — verify being right doesn't help if the emitted map ignores it.

**Bottom line:** the fix landed, verify is clean and discriminating, the merge holds and self-corrects, and the divergent state stayed separate. Ship the blast — after (a) a fresh AZ pull to resolve the 72%, and (b) a confirmed regeneration that proves the final map honors the pairwise splits.