# Process note — discovery output-size limit; route dense states to chunked discovery

> Captured 2026-07-21 (Kevin + Claude), from the wave-3 New Jersey run. Operational rule for the
> 50-state gather. Governs the discovery runners in `.claude/workflows/`.

## The failure (New Jersey, single-agent discovery)

New Jersey's first discovery run returned a valid result object with **`rules: []`** — zero rules —
despite reporting `verbatim_captured_count: 74`, 6 material-negatives, and 12 structural-branches. The
research was **not** the problem; the loss happened at the final submission step.

Reading the agent transcript, the agent researched OPRA correctly (pulled P.L. 2024 c.16, downloaded
raw statute HTML when web summaries paraphrased, read verbatim sections), then called the structured
output tool **twice**:

1. **First call** — `state` + `verbatim_captured_count` + **75 rules**. Accepted. ✅
2. **Second call** — the whole object again (`+ structural_branches + material_negatives`), at
   **~55,361 output tokens**, with **`rules` empty**. Also accepted. ✅

Structured output is **last-call-wins**, so the second submission **overwrote** the good first one.
That second call ran up against the model's single-response **output-token ceiling (~64K)**; the agent
tried to re-serialize *everything at once* (all 75 rules plus branches/negatives), ran out of output
room, and the `rules` array — largest, serialized last — was the casualty. The smaller fields survived.

**So the cause is the output-size ceiling, not research capacity.** One agent can *research* a dense
state fine; it cannot reliably *emit* a dense state's full result in one structured response.

## Why this is dangerous

It fails **silently**. The returned object looks well-formed — a plausible state result with branches,
negatives, and a non-zero verbatim count — but carries zero actual rules. Without an explicit check you
would bank a state as "done" with none of its rules. Any 50-state run will hit this on the dense states.

## The rule

1. **Ordinary-density states → single-agent runner** (`rules-discovery-only.js`). Fits comfortably:
   AZ 27, CO 25, NC 34, CT 42, TN 50 rules all returned whole.
2. **Dense states → chunked runner** (`rules-discovery-chunked.js`). Splits one state across
   category-scoped agents (default 3: access-intake / timing-production / money-remedies), each with a
   distinct rule-ID prefix (A/T/M) so they merge without collision. NJ re-run this way returned **141
   rules, 17 negatives, 21 branches, 0 collisions** — and each chunk's submission is small enough to
   clear the ceiling.
3. **Silent-loss guard on BOTH paths.** A state that returned zero rules but clearly found content
   (`verbatim_captured_count > 0`, or any negatives/branches) is flagged loudly:
   - chunked runner: merged `rules.length === 0` → hard error (`silent-loss guard tripped`).
   - single-agent runner: emits a `WARNING … RE-RUN CHUNKED` log and returns `sizeSuspect: [states]`.

### How to decide "dense"

No perfect a-priori signal, so treat it as detect-and-retry rather than predict:
- Run the single-agent runner; if a state trips the `sizeSuspect` guard, re-run **that state** chunked.
- Known-dense (statute with a heavy fee schedule + multi-track appeals + a 20xx overhaul) can go
  straight to chunked. NJ (OPRA, P.L. 2024 c.16) is the archetype; TN (50 rules) was near the edge but
  fit.

## Invocation

```js
// ordinary states
Workflow({ name: 'rules-discovery-only',    args: { states: ['Colorado','Connecticut'] } })
// one dense state, split + merged
Workflow({ name: 'rules-discovery-chunked', args: { state: 'New Jersey' } })
//   optional custom chunks: args.chunks = [{ label, prefix, areas:[...] }, ...]
```

## Caveat — chunking slightly over-splits

Three maximally-thorough parallel agents split finer than one would, and can duplicate a concept at a
chunk seam (e.g. a fee rule that also touches deadlines). NJ's 141 is "complete, slightly over-split,"
not a final count. The reconciliation/canonicalize pass is expected to merge these seam-duplicates —
this is fine (reconciliation already merges cross-*state* duplicates; cross-*chunk* is the same operation
within one state). Do **not** hand-trim; let reconciliation do it.

## Related

- Discovery-stage `config_home` is unreliable (NJ came back 80% `structural` even with a
  parameter-default nudge in the prompt) — decide config_home at pivot, per
  `DESIGN_master_list_and_city_config.md`. Tracked separately.
- Fan-out safety (no quadratic pairwise verify) — see the wave-1 post-mortem in `wave1/`.
