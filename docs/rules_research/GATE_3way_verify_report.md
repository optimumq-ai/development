# Pre-blast gate — Illinois 3-way merge + verify-bites fixture (2026-07-21)

> Workflow `rules-gate-3way-verify`, run `wf_f5982ff6-7d1`. 30 agents, ~649k tokens, ~30.8 min.
> **Discovery under the UPDATED V2 prompt:** AZ 25r/18v · NY 25r/22v · IL 39r/38v — **contentless: 0/0/0**.
> **Gate 1 (verify bites): 4/5** — one true-hold pair (copy-rate cap-vs-fixed) wrongly split → NO-GO by rule.
> **Gate 2 (3-way merge): held** — pairwise-complete verify split all 4 over-merged clusters the proposer
> made; the sole legit 3-state cluster survived. Deadline guardrail distinguished on operative obligation,
> not day-count. Fix verify to 5/5 + add one divergent (residency-required) state → GO.

---

# PRE-BLAST GATE REPORT — 50-State Blast

**Prepared for:** Technical Product Owner
**Run scope:** AZ / NY / IL discovery under the updated V2 prompt
**Date:** 2026-07-20

---

## 1. GATE VERDICT

**NO-GO — but a narrow, fixable one.** The blast fails on Gate 1 alone: the verify-BITES fixture scored **4/5**, missing `true-copy-rate` (a true-hold pair that verify wrongly split). Under the pre-agreed criterion — *any miss is a NO-GO* — that single miss holds the gate shut, and it matters more than its "one wrong row" size suggests, because **verify is the load-bearing safety net for everything else in this report.** Gate 2 (three-way merge) only *passes* because pairwise-complete verify caught and split all four over-merged clusters the clusterer proposed; we are trusting verify to be the sole adjudicator between a demonstrably noisy cluster-proposer and silent false-merges (data loss), and verify just proved it errs 1-in-5. The saving grace: the one error is in the **safe direction** (over-split, not over-merge — it creates a dedupable duplicate, it does not destroy a distinct rule). Recommendation: tune verify's cap-vs-fixed / ceiling-vs-fixed discrimination, re-run the fixture to a clean 5/5, then this converts to GO. Do **not** waive the fixture and blast on a 4/5 adjudicator.

---

## 2. Verify BITES? — Fixture Scorecard

**Score: 4/5. One miss → NO-GO by rule.**

| Label | Expected | Got | Correct |
|---|---|---|---|
| toll-vs-terminal | split | split | ✅ |
| ordinary-vs-special-fee | split | split | ✅ |
| judicial-vs-administrative-appeal | split | split | ✅ |
| true-response-window | hold | **hold** | ✅ |
| true-copy-rate | hold | **split** | ❌ |

**Does it discriminate, or just always-split?** It discriminates. `true-response-window` (two 5-business-day-from-receipt deadlines differing only cosmetically, "public body" vs "custodian") was correctly **held** — so verify is not a degenerate always-splitter. It can find a true coincidence and merge it.

**The miss:** `true-copy-rate` — two 25¢/page rules the fixture labels as the same. Verify split them on a **ceiling ("shall not exceed $.25") vs. fixed price ("a fee of $0.25")** argument. The reasoning is defensible in the abstract (max-of vs. equals behave differently at runtime), but per the fixture's ground truth it is an **over-split of a true-hold pair**. The failure mode is verify slicing legitimate merges on fine parametric distinctions.

**Why this is the whole ballgame, not a footnote:** every "no false merge survived" claim in §3 rests on verify splitting contested pairs correctly. An adjudicator that over-splits 1/5 inflates the concept count and the human dedup queue at scale; more importantly, it is the *only* thing proven to fail here, and it is the component we are asking to run unsupervised across 50 states.

---

## 3. THREE-WAY MERGE — Did the many-state rule hold?

**Correctness: held. Proposer quality: poor. Net: safe only because verify is pairwise-complete.**

Of the 5 three-state clusters the canonical stage proposed, **only 1 survives pairwise verify intact**:

| 3-state cluster | AZ↔NY | AZ↔IL | NY↔IL | Survives? |
|---|---|---|---|---|
| eligibility.no_residency_requirement | hold | hold | hold | ✅ legit |
| eligibility.any_person | split | split | split | ❌ fused on incidental "any person" feature |
| eligibility.no_purpose_requirement | split | split | split | ❌ opposite outcomes for commercial requester |
| denial.constructive_denial | split | split | split | ❌ fused on "deemed denial" *label* |
| appeal.judicial.review_of_denial | split | split | split | ❌ fused on "judicial review" *label* |

**Transitivity failures: 4 of 5.** These are not subtle A~B~C-but-not-A~C cases — **all three pairs split** in each of the four bad clusters. The clusterer merged on shallow shared features (the "any person" element, the "deemed denial" label, the "judicial review" label) rather than operative content. Examples caught by verify: `any_person` collapsed an open-inspection shelf-right (AZ), a written-request response menu (NY), and an exemption-scoped availability duty (IL) into one; `constructive_denial` fused a soft "promptly + index-failure" trigger (AZ), a §89(3)-by-reference reasonableness scheme (NY), and a hard 5-day expiry (IL). **Pairwise-complete verify caught every one.** The proposer is a weak first pass; verify is the real authority — which is exactly why the §2 miss is disqualifying.

**Response-deadline probe — the headline question:** The simple hypothesis ("NY+IL merge on 5 business days, AZ's soft 'promptly' stays out") **did not play out, and correctly so.** What actually happened:

- **AZ's soft "promptly furnish" (AZ-0010) stayed its own concept** (`production.promptly_furnish`) — soft standard not merged into any hard day-count. ✅ The guardrail held.
- **NY+IL did *not* merge.** NY-0009 was clustered into an **AZ+NY** acknowledgment window (`acknowledgment_window_5bd`, AZ-0005+NY-0009) — and even *that* two-state cluster **verify splits** (AZ = bare acknowledgment w/ portal exception; NY = three-way disposition menu, no portal carve-out).
- **IL's 5-business-day rule (IL-0007) was held out as UNRESOLVED**, correctly, because IL's obligation is *substantive* ("comply with or deny within 5 business days"), which a bare acknowledgment does **not** satisfy. The clusterer refused to force-merge on the shared day-count when the operative obligation differed.

So the shared "5 business days" is a **coincidence across three genuinely different obligations** (AZ acknowledge-receipt, NY disposition-menu, IL comply-or-deny), and the pipeline resisted the day-count-driven false merge in all three directions. This is the single best signal in the run: the deadline guardrail works, and it works for the right reason.

---

## 4. DISCOVERY DISCIPLINE — Did the updated prompt fix the empty-rule problem?

**Empty-rule problem: FIXED.** Contentless-that-slipped-through = **0 / 0 / 0** across AZ/NY/IL. The V2 prompt eliminated the A/B Florida "empty shell" mess. ✅

**Verbatim capture: good in aggregate, weak for AZ.**

| State | Rules | Verbatim | Rate |
|---|---|---|---|
| AZ | 25 | 18 | **72%** |
| NY | 25 | 22 | 88% |
| IL | 39 | 38 | 97% |
| **Total** | **89** | **78** | **87.6%** |

AZ's 72% (7 rules paraphrase/summary only) is a real quality gap. Several pair-checks explicitly note "Rule 1 is an Arizona *summary*." This matters because **verify adjudicates off verbatim text** — for the 7 paraphrase-only AZ rules, the adjudicator is reasoning on a gloss, not the statute.

**Universal-access facts emitted as rules, not negatives: YES.** "Any person," "no residency requirement," and "no purpose requirement" appear as first-class affirmative rules (AZ/NY/IL-0001/0002/0003) and were clustered as eligibility concepts — not dumped into the material-negatives bucket. ✅ Material negatives (AZ 10, NY 6, IL 6 = 22) capture the "not required" framing separately, as intended. AZ's higher negative count tracks its summary-heavy style.

**Consolidation:** 89 rules → 73 canonical concepts (5 three-state + 5 two-state clusters, 1 unresolved). Note the 73 is the *pre-verify* proposal; after honoring verify's splits (four 3-state clusters re-expand 1→3, plus the AZ/NY two-state and true-copy-rate-style splits), the true post-verify count lands in the low 80s. Expected and healthy — clustering proposes, verify disposes.

---

## 5. REMAINING RISKS BEFORE SCALING

1. **Verify's over-split bias is unquantified beyond 1/5.** The `true-copy-rate` miss shows verify slicing on ceiling-vs-fixed / cap-vs-fixed distinctions. At 50 states this inflates concept count and human dedup load, and — because verify is the *sole* adjudicator — any drift toward over-splitting is only visible if we keep testing it. Fix and re-baseline before blast.

2. **The clusterer is a noisy proposer (4/5 three-state clusters wrongly fused).** This is tolerable **only if pairwise-complete verify runs on every cluster with no sampling.** At 50-state scale the pairwise cost on over-large clusters is O(n²); the temptation to sample or cap comparisons is exactly where a **silent false-merge (data loss)** would enter. Hard requirement: no verify shortcuts at scale.

3. **AZ verbatim capture (72%) + unreliable metadata tags.** Two rules (AZ-0001, NY-0001) carry `clock:none` while their verbatim plainly contains a 5-business-day clock. Verify compensated by reading through to verbatim — but any downstream consumer that trusts the `clock`/`config_home` tags rather than the text will be wrong. Both the paraphrase-only rules and the mis-tagged clocks are latent defects that widen with more states.

4. **Unresolved-queue scaling (IL-0007).** One day-count collision needed human adjudication in a 3-state run. Day-count collisions (5-biz-day acknowledge vs. comply-or-deny vs. disposition-menu) will multiply across 50 states. Without a defined triage queue and SLA for `UNRESOLVED`, the blast stalls on human review rather than failing loudly.

5. **Sample is 3 strong-access, look-alike states.** AZ/NY/IL broadly agree on "any person / no purpose / no residency," which is *why* the one legit cluster held. The hard cases are untested: states that genuinely **impose** residency/citizenship or purpose requirements, unusual fee regimes, and split/tribal jurisdictions. Those are where the affirmative-rule-vs-negative capture and the eligibility clusters will actually be stressed. Recommend one deliberately divergent state (a residency-required jurisdiction) in the next validation batch before committing to all 50.

**Bottom line:** correctness is close and the merge-safety architecture is sound, but the gate criterion is unambiguous and verify — the component the whole design leans on — has not yet earned a clean pass. Fix verify to 5/5, add one divergent-state check, then GO.