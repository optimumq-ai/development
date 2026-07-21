# Post-mortem: the wave-1 credit burn (2026-07-21)

**What happened, in one line:** an overnight rules-research workflow used a *pairwise-complete*
verification step that fanned out **one high-effort agent per cross-state pair**. That's a
quadratic (N²) fan-out disguised as a single line of code. It spawned **1,068 agents**, hit the
1,000-agent hard cap, burned **6.26M tokens in ~102 minutes**, and tripped the monthly spend limit.

---

## 1. The numbers

One session (`4fd015b2`, 2026-07-20 22:32 → 2026-07-21 04:45) ran four workflows. Three were fine.
The fourth ate everything.

| Workflow | Status | Agents | Tokens | Duration |
|---|---|---:|---:|---:|
| rules-pilot-az-ny | ✅ completed | 6 | 200K | 16m |
| rules-ab-verbatim | ✅ completed | 15 | 469K | 36m |
| rules-gate-3way-verify | ✅ completed | 37 | 659K | 24m |
| **rules-wave1-8states** | 💀 **killed** | **1,000 (capped)** | **6.26M** | **102m** |
| **Session total** | | **~1,058** | **~7.59M** | |

The killed workflow alone was **82% of the entire session's token spend.**

---

## 2. What actually went wrong

The workflow itself was not a runaway loop. It was **one `parallel()` call over a combinatorial
list.** The stages:

1. **Discover** — 10 states, 10 agents. Fine. Produced 366 rules.
2. **Canonicalize** — 1 agent grouped them into 107 candidate clusters, 62 of them multi-state.
3. **Verify** — *"pairwise-COMPLETE on every multi-member cluster."* **This is the fault.**
   For a cluster with N cross-state members it emits N·(N−1)/2 pairs, **each its own
   `effort:'high'` agent.** Across the 62 clusters:

   > `cross-state pairs to verify: **1068**`

1,068 high-effort agents fired from one line. It blew past the **1,000-agent lifetime cap** and was
aborted at 845 started / 765 returned.

### The "~65 failed agents" were a symptom, not the cause

They didn't fail from a bug. Around the ~765th verify agent the account tripped its **monthly spend
limit**, and every remaining spawn returned `You've hit your monthly spend limit`. The causal chain:

```
quadratic pair explosion  →  6M+ tokens in ~100 min  →  monthly spend limit tripped
                          →  remaining ~300 agents all fail with the limit error
                          →  workflow aborted at the 1000-agent cap
```

### It also silently corrupted its own output

The script's error fallback was `verify errored -> conservative split`. So every spend-limit
failure was recorded as a real "split" verdict — meaning even if the run had finished, the tail of
the dictionary would have been fragmented by infrastructure errors, not by law.

---

## 3. Root causes (all four have to be true to burn like this)

| # | Cause | Fix |
|---|---|---|
| 1 | **Quadratic fan-out** — `parallel()` over N-choose-2 pairs | Verify each cluster with **one** partition agent (linear in clusters, not pairs) |
| 2 | **No agent cap** — nothing bounded the fan-out | Hard `MAX_VERIFY_AGENTS` ceiling; log anything dropped |
| 3 | **No budget guard** — no check on remaining spend before an expensive phase | Guard on `budget.remaining()` before Verify and Pivot; return partial results instead of firing doomed agents |
| 4 | **Errors treated as data** — a spend-limit error became a "split" verdict | Count errors; never map infra failure to a verdict; abort loudly if most agents error |

---

## 4. The fix

A reconciliation-safe rewrite lives at **`.claude/workflows/rules-wave-safe.js`**. Same pipeline,
same legal criteria, but:

- **Verify is now linear.** One partition agent per multi-state cluster returns a same-lever
  grouping of its members. **~62 agents instead of 1,068.** The downstream clique-cover and the
  "no split pair survives" acceptance check are unchanged.
- **Hard agent cap** (`MAX_VERIFY_AGENTS = 150`) — and it *logs* whatever it leaves unverified
  rather than silently truncating.
- **Budget guards** before Verify and Pivot — returns partial results instead of firing agents that
  will just fail on the limit.
- **Errors are no longer verdicts** — a failed agent is counted, not recorded as a "split"; if more
  than half the verify agents fail, the run aborts loudly rather than shipping a corrupted dictionary.

### Rough cost comparison

| | Old (pairwise) | New (per-cluster) |
|---|---:|---:|
| Verify agents | ~1,068 | ~62 |
| Order of growth | O(pairs) ≈ O(N²) | O(clusters) |
| Behavior at spend limit | keeps firing failing agents | stops, returns partial |
| Behavior on agent error | records "split" (corrupts) | counts; aborts if widespread |

---

## 5. Salvage — the expensive work was not lost

The killed run had **already completed the costly half** before it died. Recovered from the run
journal and checkpointed under `docs/rules_research/wave1/salvage/`:

- **`discovery.json`** — all 10 states fully researched, **366 rules** with verbatim source language.
- **`canonicalize.json`** — the clusterer's **107 candidate concepts**.

**Not salvaged (deliberately):** the pivot + report found in the same journal were **stale 8-state
cached artifacts** (dictionary = 173 concepts, dated 07-20, no Georgia/Ohio) — resume cache hits
from the earlier run, invalid for the 10-state deliverable.

### Finishing wave 1 cheaply

`rules-wave-safe.js` accepts a resume checkpoint, skipping the 10 expensive research agents and the
clusterer and running only the now-cheap Verify → Pivot → Report:

```js
Workflow({ name: 'rules-wave-safe', args: {
  wave: 'wave1',
  discoveryResults: <contents of salvage/discovery.json>,
  canon:            <contents of salvage/canonicalize.json>,
}})
```

---

## 6. Prevention checklist (for every future workflow)

- [ ] **Never** `parallel()` / `pipeline()` over pairs or products. Compute the list length and
      `log()` it *before* spawning.
- [ ] Put a **hard agent cap** on any fan-out, and `log()` whatever gets dropped.
- [ ] **Guard on budget** before each expensive phase; degrade to partial results, don't fire
      doomed agents.
- [ ] **Never** map an infrastructure error (spend limit, API) onto a data verdict.
