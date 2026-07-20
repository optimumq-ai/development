# Pilot #1 — AZ + NY discovery → blind reconciliation (2026-07-20)

> Workflow `rules-pilot-az-ny`, run `wf_3b5a0c3f-a3b`. 6 agents, ~200k tokens, ~15.6 min.
> **Stats:** AZ 21 rules (1 self-flagged unverified) · NY 31 rules (0) · 49 canonical concepts ·
> **2 cross-state joins** · 0 false merges caught · 1 unresolved. Blind run (no seed dictionary).
> Report authored by the workflow's synthesis agent; my commentary is in the session.

---

# Pilot Report — AZ + NY Discovery→Reconciliation, Gate to 50-State Blast

## 1. Verdict — GO-WITH-FIXES

**GO-WITH-FIXES.** The pipeline is structurally sound: the inclusion filter cut legal background cleanly (22 excluded items across the two states, all remedies/definitions/standing-obligations/policy), the columns are filled and load-bearing, structural forks stayed structural, and the one unresolved item is a legitimate human-decision fork, not slop. But the *core* value proposition — the cross-state join — fired on only **2 concepts** and the verify step **rejected zero** candidates, so the merge machine is essentially unexercised and there is **no evidence it can catch a false merge**. There is also one systematic defect that will multiply at scale: the same universal-access fact was emitted as a **rule in AZ** and a **material negative in NY**, a synonym-splitter the join never sees. Fix the symmetry rule, prove verify bites with a red-team fixture, and nail down 3-way merge semantics before spending on 48 more states. None of these are deal-breakers; all are cheap relative to the blast.

## 2. The four review checks

### (a) DILUTION — PASS
The inclusion test is cutting background, not encoding it.
- **Exclusion lists are populated and substantive.** AZ excluded 12 items, NY 10. The excluded set is exactly what should be cut: remedy provisions (AZ §39-121.02 fees/damages, §39-121.03(C) treble damages, §39-124 criminal classification; NY §89(4)(c) penalties), pure definitions (officer/public-body §39-121.01(A); agency §86(3)), standing obligations (records retention; NY 1401.6 subject-matter list, 1401.3/1401.4 hours, 1401.9 notice), boilerplate (1401.10 severability), policy statements (1401.1), and **the entire exemption catalog** (§87(2)) deferred to a special-records pass.
- **Almost no leakage.** The few definitions/standing items that *were* kept are justified keeper-slivers: `classification.commercial_purpose_definition` (AZ-0012, software branches fee basis on it) and the RAO/appeals-officer *designations* (NY-0007/0012, which route every request). The line held: standing *designation that routes* = kept; standing *recordkeeping/publicity* = cut (contrast NY-0007 kept vs NY-0006 subject-matter list excluded).
- **Minor risk:** "keep the definition if software branches on it" (AZ-0012) is a subjective test that different runs may apply inconsistently at scale. Low severity.

### (b) COLUMNS — PASS, with verbatim-source gaps
`concept_key`, `config_home`, `clock_effect`/`clock_spec`, `related_rule_ids` are filled and useful.
- **Good `clock_spec` honesty:** NY-0002 `sets-deadline / "5 business days from receipt"`; NY-0013 correctly flags **calendar** days for the appeal window while NY-0014 flags **business** days for the decision window — the model distinguished the two, which is a real trap. AZ-0005 records `sets-deadline / "'promptly' — undefined standard, no fixed number"` and explicitly says *do not convert to a number*. AZ-0011's 30-day spec notes it **bounds the governor, not the requester** — exactly the nuance a naive encoder drops.
- **Good `related_rule_ids` chains:** AZ-0009 links AZ-0005→AZ-0008→AZ-0013 (promptly-duty → withheld-index → deemed-denial → appeal), a usable causal graph. The NY fee cluster cross-links NY-0025/0026/0027/0029 coherently.
- **Bad / weak:** `source_language` is **empty** on AZ-0019, AZ-0020, and AZ-0021 (fetch returned summaries only) — the schema let paraphrase-only rows through without forcing a flag. AZ-0007's quote is "assembled from opened statute page and search snippet"; AZ-0010's fee basis is two-thirds paraphrase. These are honestly *noted*, but a downstream consumer can't distinguish verbatim from paraphrase without reading the notes field.

### (c) THE JOIN — the core test — MIXED
- **Real joins: 2, both sound.** `denial.constructive_denial` (AZ-0009 + NY-0016) and `fee.copy_rate_per_page` (AZ-0006 + NY-0023). Both AZ and NY *independently proposed different keys* (`denial.constructive_denial_trigger` vs `denial.constructive_denial`; `fee.copy_charge_permitted` vs `fee.copy_rate_per_page`) and reconciliation correctly collapsed them. Verify's reasoning is disciplined — it confirmed no toll-vs-terminal divergence, no structural fork collapsed into a parameter, and that the deadline differences are *parameters over one shared operative rule*.
- **False merges caught by verify: 0 — because 0 were proposed to reject.** Both candidates got `hold`. This means **verify is unproven**: we have two true-positives passed and zero attempts to reject. We cannot claim the guardrail works.
- **Synonyms that SHOULD have merged but didn't: 1 systematic miss.** `requester.eligibility_any_person` is an affirmative **rule in AZ (AZ-0002)** but the identical legal fact ("any person, no residency/purpose restriction") was logged as a **material negative in NY**, so it never entered the join. This is the single most important finding: the join only compares concepts *both states emitted as rules*, so a fact one state states affirmatively and another states as an absence fragments silently. At 50 states this will manufacture fake "legal differences" wherever drafting style differs.
- Correctly-kept-separate (not misses): AZ's appeal is **judicial** (`appeal.judicial_special_action`, superior-court special action) while NY's is **internal administrative** (`appeals.appeal_window` + separate appeals officer). Different legal machinery, correctly two concepts. The AZ "promptly" vs NY "5+20 business day" response deadlines correctly went to the unresolved bucket rather than force-merging.

**Bottom line on the join:** what fired was correct, but the sample is far too small to trust the mechanism, and it already leaks on the rule-vs-negative asymmetry.

### (d) UNRESOLVED SIZE — small and legitimate (1 item), but it foreshadows a scaling gap
`AZ-0005` (the "promptly" duty) is held out for two *correct* reasons: config_home disagreement (AZ soft/undefined **structural** standard vs NY hard **parameter** counts) and structural-model mismatch (AZ collapses response+production into one obligation; NY splits into 5-day response + ~20-day grant). This is a genuine human-decision fork, not a guidance failure. **But** it exposes a real scale problem: many states use undefined soft standards ("promptly," "reasonable," "without unreasonable delay"). If every soft-standard deadline lands in a human-triage bucket, that bucket grows linearly with states. The guidance needs a canonical way to represent a soft standard *before* the blast (see §6).

## 3. Parameter tables (sample)

| Concept | Arizona | New York |
|---|---|---|
| `fee.copy_rate_per_page` | No statutory cap; local rate; "if facilities available" — §39-121.01(D)(1) | ≤ **$0.25/page**, photocopies ≤ 9×14 in — 21 NYCRR §1401.8(b)(1) |
| `deadline.initial_response_window` | **absent** (material negative: duty is "promptly," no day-count) | **5 business days** from receipt — §1401.5(c); Pub. Off. Law §89(3)(a) |
| `deadline.approximate_grant_date` | **absent** | **≤ 20 business days** from acknowledgment — §1401.5(c)(3) |
| `appeals.appeal_window` | **absent** (material negative: no statutory filing deadline for the special action) | **30 calendar days** from denial — §1401.7(d) |
| `appeals.decision_window` | **absent** | **10 business days** from appeal receipt — §1401.7(f) |
| `fee.commercial_purpose_basis` | acquisition-cost portion + reasonable reproduction fee + commercial-market value — §39-121.03(A) | **absent** (NY bars review/search/prep labor; no commercial-value basis) |

The "absent" cells are the material negatives doing real work: they distinguish "we didn't find a rule" from "the rule is $0/none," which is exactly the distinction a 50-state config table needs.

## 4. Structural-branch catalog (confirmed NOT flattened to parameters)

All rows below carry `config_home = structural` in the data; the two joins explicitly verified structural forks were not collapsed into parameters.

**Arizona**
- `review.commercial_abuse_governor_referral` (AZ-0011) — custodian applies to the **Governor** for an executive order; 30-day no-order window forces release on payment. AZ-bespoke.
- `intake.commercial_purpose_affirmation` (AZ-0004) — required intake gate classifying commercial vs non-commercial and routing fee basis.
- `denial.withheld_index_on_request` (AZ-0008) → feeds the deemed-denial trigger (AZ-0009) on failure to furnish.
- `appeal.judicial_special_action` (AZ-0013) — **judicial** review (not internal admin).
- `appeal.victim_special_action_criminal_case` (AZ-0014) — victim's denial routed **into the criminal case**.
- `production.depicted_victim_court_release_gate` (AZ-0021) — court balancing gate *(self-flagged unverified; non-automatable)*.
- Crime-victim cluster: `fee.crime_victim_no_charge` (AZ-0016), `production.crime_victim_priority_processing` (AZ-0017), witness redaction/PII (AZ-0018/0019/0020).

**New York**
- `routing.records_access_officer` (NY-0007) — every request routes to a designated RAO.
- `appeals.separate_appeals_officer` (NY-0012) — internal appeal stage; RAO may **not** be the appeals officer (role separation).
- `appeals.constructive_denial` (NY-0015) — **appeal-stage** deemed denial, distinct from the request-stage one (NY-0016).
- `oversight.forward_appeal` / `oversight.forward_determination` (NY-0017/0018) — mandatory notice of every appeal + determination to the **Committee on Open Government**. NY-specific external oversight.
- `deadline.extension_with_reason` (NY-0005), `production.internet_records_notice` (NY-0009), `payment.advance_payment_allowed` (NY-0030), `fee.estimate_notice` (NY-0029), `routing.not_custodian_certification` (NY-0008).

No structural fork was found masquerading as a parameter. Items that *are* parameters (copy rate, response/appeal windows, request format, fee waiver) are correctly parameterized.

## 5. Timing / tolling table (sample)

| Rule | State | clock_effect | spec |
|---|---|---|---|
| AZ-0005 promptly-furnish | AZ | sets-deadline | "promptly" — **undefined**, from receipt (do not numeric-ize) |
| AZ-0009 deemed denial | AZ | **terminal** | on failure to respond promptly OR furnish requested index |
| AZ-0011 governor referral | AZ | sets-deadline | 30 days — **bounds the governor, not the requester** |
| NY-0002 initial response | NY | sets-deadline | 5 **business** days from receipt |
| NY-0004 approximate grant date | NY | sets-deadline | ≤ 20 **business** days from acknowledgment |
| NY-0005 extension | NY | sets-deadline | date certain, "reasonable period" (undefined) |
| NY-0013 appeal window | NY | sets-deadline | 30 **calendar** days from denial |
| NY-0014 appeal decision | NY | sets-deadline | 10 **business** days from appeal receipt |
| NY-0015 appeal deemed-denied | NY | **terminal** | at expiry of 10 business days |
| NY-0016 request deemed-denied | NY | **terminal** | at expiry of the applicable limit (5 / 20 / date-certain) |

Note the model correctly mixed **business** vs **calendar** day bases within NY and correctly tagged both terminal states — good signal the clock column is real, not decorative.

## 6. Prompt/spec fixes to make BEFORE the blast (ordered)

**Cheap prompt tweaks (do all four):**
1. **Symmetry rule for universal facts (highest priority).** Force a universal-access statement ("any person may request," "no residency/purpose requirement") to emit as a **structural rule with a fixed shared canonical key**, never as a material negative. The AZ-rule / NY-negative split on `requester.eligibility_any_person` is a systematic synonym-splitter that the join structurally cannot see. This is the one pilot finding that clearly *worsens* with scale.
2. **Canonical form for soft/undefined deadlines.** Add an explicit `clock_spec.standard = "undefined-soft"` value so "promptly"/"reasonable"/"date certain" rules can join a deadline concept as `config_home = structural` without being misfiled as numeric parameters. Otherwise every soft-standard state feeds the human-triage bucket (AZ-0005 today; ~dozens tomorrow).
3. **Force `source_language` provenance.** Schema should require either a non-empty verbatim quote **or** an explicit `paraphrase = true` + `needs_verification` flag. AZ-0019/0020/0021 slipped through with empty quotes; downstream must not mistake paraphrase for verbatim.
4. **Namespace appeal *type*.** Make `appeal.judicial.*` vs `appeal.administrative.*` explicit guidance so a state with both paths doesn't collapse them. The pilot got this right by luck (AZ judicial, NY administrative); a state with both would expose it.

**Structural changes (do 5 and 6; scope 7):**
5. **Add a cross-state reconciliation pass over material negatives AND exclusions, not just emitted rules.** Today the join compares rule-to-rule only, so rule-vs-negative (fix #1's root cause) and rule-vs-excluded gaps are invisible. Without this, at 50 states coverage/drafting gaps will masquerade as genuine legal differences.
6. **Prove verify bites — the machine will fail silently at scale otherwise.** Verify passed 2 true merges and rejected 0. Before spending, run a deliberate **false-merge fixture**: a red-team pair that looks similar but differs on toll-vs-terminal or fee-basis, and confirm verify rejects it. This is the project's own "tests must bite" discipline applied to the merge engine.
7. **Pin down many-state merge semantics (untested).** 49 concepts from 52 rules = 47 single-state; the pipeline has **never done a 3-way merge**. When a third state joins an existing 2-member canonical, does it re-verify against **both** members or just one? Is the merge transitive? Define and test this on a 3rd state (a cheap add — one more state) before committing to 48.

## 7. Honest limits of this pilot

- **The join — the whole reason to build this — fired on 2 concepts.** Everything about scale-behavior of merge and verify is extrapolation. Verify rejected nothing, so its guardrail value is unproven.
- **No 3-way+ merge, no transitivity test.** Consolidation semantics are unvalidated; at n=2 almost every concept is single-state, which is the *easy* case.
- **Citation accuracy is bounded by source access, not verified against ground truth.** WebFetch returned summaries/paraphrases rather than verbatim text for several AZ rows: AZ-0021 is self-flagged unverified (and is a non-automatable court balancing test — correctly held for human legal review), AZ-0019/0020 have no verbatim `source_language`, AZ-0007's cross-reference is flagged for re-check, AZ-0010's fee basis is largely paraphrase, and §39-121.04's operative sliver came back summary-only. NY is cleaner (0 self-flagged), but its fee rules were sourced through **21 NYCRR §1401.8 as reproduced in a municipal PDF (Village of Cold Spring)** and the §87 statute page could not be rendered directly — so NY fee citations are verified against a **secondary reproduction and a regulatory parallel**, not always the primary statute. The pilot validates *internal consistency and provenance-honesty*, not *legal correctness*.
- **Exemptions were deliberately not inventoried in either state** (AZ confidentiality regimes §§39-123..128 deferred; NY §87(2) deferred). The disclosability logic that actually decides *what gets released* — the hardest and highest-liability part — is entirely out of this pass's scope.
- **"Current law" is a 2026-07-20 snapshot.** Handling of enacted-vs-pending was correct (AZ SB1372 enacted → included; NY S2520/S4632/A3425 pending → excluded), but this is a dated cut, not a standing subscription.

**Net:** the discovery half is production-quality on these two states; the reconciliation half is promising but under-tested. Fund the blast, but gate the first tranche (say, 5 states) on fixes #1, #5, and #6 landing and verify demonstrably rejecting a planted false merge.