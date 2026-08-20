# Fee Gap Pass — Verify Rollup

Status as of 2026-08-20. Covers the verify (refute) pass over the 22 discovered states'
`raw/<ST>.json` files. Verdicts per row: CONFIRMED | CORRECTED | REFUTED | UNVERIFIABLE.
Source files: `verified/<ST>.json` (one row per resolution item, 36 per state).

## Grand tally (COMPLETE — all 22 discovered states verified)

| Verdict | Rows | Share |
|---|---|---|
| CONFIRMED | 773 | 97.6% |
| CORRECTED | 18 | 2.3% |
| UNVERIFIABLE | 1 | 0.1% |
| **REFUTED** | **0** | — |
| Total checked | 792 | 22 states × 36 |

**Zero refuted rows.** No state had a figure that turned out to be wrong, agency-only
recorded as municipal, or a ceiling recorded as a value. Every correction below is either
(a) metadata-level — a stale `effective_status` claim or a verbatim quote attributed to the
wrong section / spliced across sentences — with the resolution word, value and scope standing,
or (b) one substantive trim (CT).

## Per-state

| State | C | c | R | U | Not-confirmed items |
|---|---|---|---|---|---|
| AL | 36 | 0 | 0 | 0 | — |
| AZ | 36 | 0 | 0 | 0 | — |
| CA | 29 | 7 | 0 | 0 | 7 metadata fixes: quotes verified but `official_link`/`effective_status` fields misattributed (§ 7922.535 vs § 7922.575); all 7 resolutions ("silent") stand |
| CO | 36 | 0 | 0 | 0 | programmatic match against full C.R.S. Title 24 text |
| CT | 35 | 1 | 0 | 0 | **rules.deposit.percent — substantive**: § 1-212(c) prints no percentage; recorded "100"/value removed |
| FL | 36 | 0 | 0 | 0 | — |
| GA | 35 | 0 | 0 | 1 | payment.method UNVERIFIABLE — O.C.G.A. § 50-1-6 not openable from an official source (manual check) |
| ID | 34 | 2 | 0 | 0 | rules.deposit.percent, payment.productionGate — spliced quote in § 74-102(12); substance stands |
| IL | 36 | 0 | 0 | 0 | — |
| IN | 35 | 1 | 0 | 0 | certification — substance ($5 ceiling) confirmed, row metadata corrected |
| KS | 36 | 0 | 0 | 0 | — |
| LA | 36 | 0 | 0 | 0 | R.S. 44:32 confirmed live, last amended Acts 2024 No. 411 |
| NC | 35 | 1 | 0 | 0 | av — quote/value/scope correct, amendment-history statement fixed |
| NE | 36 | 0 | 0 | 0 | — |
| NJ | 36 | 0 | 0 | 0 | verified against P.L.2024, c.16 chapter law |
| NV | 36 | 0 | 0 | 0 | current through 2025 (83rd) Session |
| OH | 36 | 0 | 0 | 0 | R.C. 149.43 eff. 9/30/2025 (H.B. 96); later version eff. 9/7/2026 (H.B. 31) noted |
| PA | 36 | 0 | 0 | 0 | OOR fee schedule page + PDF both opened |
| TN | 36 | 0 | 0 | 0 | all 5 OORC instruments opened |
| TX | 34 | 2 | 0 | 0 | rules.minFee, waiver.forfeiture — "silent" resolutions right, verbatim quotes belonged to other sections; fixed |
| UT | 36 | 0 | 0 | 0 | — |
| SC | 32 | 4 | 0 | 0 | estimate.requesterResponseDays, payment.reissue (both: quote is in § 30-4-30(C), not (B)), av (§ 23-1-240(G)(1) quote not on the row's official_link), commercial (§ 30-4-50(B) paraphrase flagged verbatim) — all four resolutions ("silent") stand |

## Follow-ups

1. **GA payment.method — RESOLVED by scope decision (Kevin, 2026-08-20).** No manual check
   needed: `payment.method` is OUT OF SCOPE for the state rules profile. Card acceptance is
   citywide finance-department policy, not an open-records rule (across all 22 states the item
   is either silent in the records law or rests on a general municipal-payments statute; only
   TN/TX have records-specific content, and only at guidance level). **Exclude the item at
   merge.** Bonus: Kevin's Justia 2025 copy of § 50-18-71 confirms GA fee subsections current
   through SB 12 (eff. 5/14/2025, non-fee amendment).
2. Decisions parked with Kevin: (a) merge CONFIRMED/CORRECTED resolutions + new 9NNN rule
   rows into `alignment/fee_master_list.json` as the `verified` layer; (b) whether to run the
   full gap pass for the 10 undiscovered states (MA MI MN MO NY OK OR VA WA WI — MN first).
