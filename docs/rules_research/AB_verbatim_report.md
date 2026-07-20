# Verbatim A/B — does feeding the merger verbatim source text improve consolidation accuracy? (2026-07-20)

> Workflow `rules-ab-verbatim`, run `wf_5ed477af-e11`. 15 agents, ~469k tokens, ~35.5 min.
> Controlled: 4 states (AZ/NY/TX/FL) discovered ONCE with verbatim; identical rule set fed to the
> SAME canonicalize prompt in two views — Arm A (verbatim) vs Arm B (verbatim stripped). Only
> `source_language` differs. Disagreements adjudicated by a neutral judge, statute text as oracle.
> **Headline:** MANDATE verbatim as cheap insurance (risk-asymmetry, not effect size); +1 clean delta,
> 0 losses; the bigger lever is fixing contentless "empty" rules (Florida) that drove 5 of 8 disagreements.

---

## OptimumQ Consolidation A/B: Does VERBATIM Operative Text Improve Merge Accuracy?

*Experiment report — for the technical product owner deciding the 50-state blast prompt. One question: does feeding the canonicalize agent verbatim operative source text (vs paraphrase only) measurably improve cross-state merge accuracy?*

---

## 1. Answer

**Directionally yes, never negative — but the clean signal is thin.** On the single uncontaminated head-to-head, verbatim drove the correct call and paraphrase-only did not (verbatim 1, paraphrase 0). Across all 8 adjudicated disagreements the verbatim arm was right 6 times and the stripped arm 2 times, but **5 of those 6 stripped-arm losses are confounded by empty source rules, not by verbatim vs. paraphrase.** Net correct-decision delta *cleanly attributable to verbatim*: **+1, with 0 losses.** The honest read is a small positive effect with zero observed downside and a sound failure mechanism — not a large measured gain.

---

## 2. The numbers

**Discovery (verbatim capture rate):**

| State | Rules | With verbatim | Coverage |
|-------|------:|--------------:|---------:|
| AZ | 26 | 20 | 77% |
| NY | 31 | 26 | 84% |
| TX | 50 | 44 | 88% |
| FL | 25 | 20 | 80% |
| **Total** | **132** | **110** | **83%** |

**Merge behavior (same rule set, two views of the canonicalize prompt):**

- Arm A (verbatim present): **20** cross-state merges
- Arm B (verbatim stripped): **26** cross-state merges
- Agreed merges: **19**
- A-only merges: **1**
- B-only merges: **7**
- **Merge-set agreement (Jaccard):** 19 / 27 = **70%**

Stripping verbatim made the agent merge *more* (26 vs 20), not less — the failure direction is **over-merging**.

**Adjudication (neutral judge, statute text as oracle) — 8 disagreements:**

| Metric | Count |
|--------|------:|
| Verbatim-correct | **1** |
| Verbatim-wrong | **0** |
| Clean tests (both sides had operative text) | **1** |
| Contaminated (one side entirely undefined) | **6** |
| Contaminated (paraphrase sufficed, verbatim not decisive) | **1** |

Per-arm accuracy on the 8 disagreements: **Arm A 6/8, Arm B 2/8.** But only **1** of those 8 is a clean verbatim-vs-paraphrase test.

---

## 3. Where verbatim mattered (or didn't)

**The one clean test — and verbatim won it. `Arizona:AZ-0006 | Texas:TX-0018` (toll-vs-terminal / standard-vs-policy boundary).**
Both rules live under the same destination concept — "reasonable time to produce records" — which is exactly the kind of surface similarity that lures an agent into merging. The stripped arm (B) merged them. The verbatim arm (A) kept them separate, which the judge confirmed as correct:

- AZ-0006 is a **judicial multi-factor test**: reasonableness is *judged by* enumerated factors (agency resources, nature of request, redaction burden, record location), measured from request receipt — a parameter-style standard with concrete operative content.
- TX-0018 is a **bare structural policy directive**: "a suitable copy… within a reasonable time after the date on which the copy is requested" — no factors, no test, different clock anchor.

The judge's words: *"The verbatims confirm the divergence: AZ supplies a factor-weighing framework; TX supplies only an aspirational 'reasonable time' policy."* This is the crux — **paraphrase flattened both to "reasonable time," and the stripped arm collapsed a specific multi-factor test into a contentless policy statement, destroying operative content.** The verbatim text was what preserved the distinction. That is precisely the failure verbatim is meant to prevent.

**Where verbatim did NOT matter — the 6 contaminated disagreements.** Five (`AZ-0004|FL-0002`, `AZ-0006|FL-0005`, `AZ-0006|FL-0023`, `FL-0009|NY-0023`, `FL-0010|NY-0023`) and the lone A-only miss (`AZ-0006|FL-0007`) all share one shape: **one side is entirely undefined — no paraphrase, no verbatim, no config_home, no clock.** When a rule carries zero operative content, verbatim cannot help, because there is nothing to compare. These are not evidence for or against verbatim; they are evidence that **the stripped arm over-merges empty shells** (it merged 5 empty rules into real ones; the verbatim arm mostly refused). The judge flagged `verbatim_would_help = false` on every one.

**Where paraphrase alone sufficed — `AZ-0006|TX-0012`.** Here the correct answer *was* to merge (both encode "promptly = reasonable time under the circumstances, no fixed day-count, from receipt"), and the stripped arm got it right while the verbatim arm missed it. This is a point *against* an over-strong verbatim claim: when two rules genuinely express the same norm, paraphrase carried enough signal, and the extra verbatim text in Arm A did not help it merge — it stayed split. Verbatim is not a free accuracy win in both directions.

Boundary-case coverage was thin: the clean test was a **standard-vs-policy (toll/terminal-adjacent) timing case.** We got **no clean fee-basis and no clean scope disagreement** — those never produced a decidable head-to-head, so we cannot claim verbatim helps there.

---

## 4. Confounds & honest limits

- **Sample size.** 4 states, 8 disagreements, **1 clean causal test.** A single clean win (n=1) is directionally encouraging but statistically weak. Do not oversell "6/8 for verbatim" — most of that margin is not a verbatim effect.
- **Rule-vs-negative (empty-rule) asymmetry hits both arms.** The dominant confound is Florida's undefined rules. 6 of 7 contaminated disagreements stem from a side with *no operative text at all.* This is a **discovery-completeness defect**, not a verbatim question — and it inflated the stripped arm's error count. Fix discovery (don't emit contentless rules) and 5 of the 8 disagreements likely vanish, shrinking the apparent verbatim advantage.
- **Paraphrase contamination.** `AZ-0006|TX-0012` shows paraphrase alone can carry a correct merge, so the two arms are not cleanly separated — the "verbatim view" and "paraphrase view" share the paraphrase, meaning Arm B is never information-*empty*, just information-*reduced*. The measured delta is the marginal value of verbatim *on top of* paraphrase, which is inherently small.
- **Single-run variance.** One canonicalize pass per arm, no repeats. LLM merge decisions are stochastic; a 20-vs-26 merge count could shift on re-run. No confidence interval is defensible here.
- **Coverage skew.** Verbatim capture ranged 77–88%; the arms are only truly different for the ~83% of rules that *had* verbatim to strip. For the other 17%, the arms were identical by construction.

---

## 5. Recommendation

**MANDATE generous verbatim in the 50-state blast prompt — but bill it as cheap insurance, not a proven accuracy engine, and pair it with a discovery-completeness fix.**

Rationale, tied to cost:

1. **Zero observed downside.** Across 8 adjudications the verbatim arm was never *wrong* where paraphrase was right for a verbatim-attributable reason (verbatim-wrong = 0). Verbatim did not manufacture bad merges.
2. **The failure mode it prevents is the expensive one — and irreversible.** Stripping verbatim pushed the agent toward **over-merging** (26 vs 20), and the one clean case shows exactly how: it collapsed a concrete multi-factor test into a contentless "reasonable time" policy. A wrong merge **destroys operative content** and is hard to detect downstream; a wrong split is visible and cheaply re-merged. Given that asymmetry, even a +1 clean delta justifies the spend.
3. **The token cost is modest and one-directional.** Verbatim is captured once at discovery (110 snippets over 132 rules — typically a sentence or two of operative text each) and fed into a prompt you were already paying to run. Scaled to 50 states this is roughly linear in rule count, a small fraction of the canonicalize context, and buys protection against the highest-cost error class. The accuracy it *provably* bought is small (1 clean decision); the accuracy it *protects* (against content-destroying merges) is the reason to keep it.

**Do not read this as a large win.** If the only goal were to maximize measured clean delta, this experiment would read as "near-zero, n=1" and you could argue to skip. The reason to mandate anyway is **risk asymmetry, not effect size.**

**One condition on the mandate:** the biggest lever in this data is not verbatim at all — it is that Florida emitted **undefined rules with no operative text**, which caused 5 of 8 disagreements and most of the stripped arm's errors. **Fix discovery to drop or flag contentless rules before canonicalize.** Verbatim mandated + empty rules suppressed will do more for merge accuracy at 50-state scale than either change alone.