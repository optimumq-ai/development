# Wave-1 salvage

Recovered from the killed `rules-wave1-8states` run (2026-07-21). These are the **expensive,
completed** stages — reuse them so wave 1 does not have to be re-researched from scratch. See
[`../POSTMORTEM_credit_burn_2026-07-21.md`](../POSTMORTEM_credit_burn_2026-07-21.md) for the full story.

| File | What it is |
|---|---|
| `discovery.json` | 10 states fully researched — **366 rules** with verbatim source language (CA, TX, FL, NY, IL, VA, AZ, WA, OH, GA). |
| `canonicalize.json` | The clusterer's **107 candidate concepts** (`candidate_concepts[]`, each with `member_rule_ids`). |

**Not included:** the pivot/report from that run's journal were **stale 8-state cached artifacts**
(dictionary = 173, no GA/OH) — invalid for the 10-state deliverable, so they were discarded.

## Resume from here

```js
Workflow({ name: 'rules-wave-safe', args: {
  wave: 'wave1',
  discoveryResults: <contents of discovery.json>,   // skips the 10 high-effort research agents
  canon:            <contents of canonicalize.json>, // skips the clusterer
}})
```

Runs only the (now linear, budget-guarded) Verify → Pivot → Report.
