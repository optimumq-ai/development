# Fee Gap Pass — Verify Rollup

Status as of 2026-08-21. Covers the verify (refute) pass over ALL 32 states'
`raw/<ST>.json` files. Verdicts per row: CONFIRMED | CORRECTED | REFUTED | UNVERIFIABLE.
Source files: `verified/<ST>.json` (one row per resolution item, 36 per state).
The final 10 states (MA MI MN MO NY OK OR VA WA WI) ran the source-grounded variant:
Kevin-supplied official texts in `source_docs/` were the primary evidence; web research
only for gaps, delegated instruments and flagged currency checks.

## Grand tally (COMPLETE — all 32 states verified)

| Verdict | Rows | Share |
|---|---|---|
| CONFIRMED | 1129 | 98.0% |
| CORRECTED | 22 | 1.9% |
| UNVERIFIABLE | 1 (resolved by scope decision) | 0.1% |
| **REFUTED** | **0** | — |
| Total checked | 1152 | 32 states × 36 |

### The first 22 states (2026-08-20)

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

## The final 10 states (source-grounded, 2026-08-21)

| State | C | c | R | U | Not-confirmed items |
|---|---|---|---|---|---|
| MA | 36 | 0 | 0 | 0 | verified against Kevin-supplied c.66 §10 + 950 CMR 32; currency check clean (no post-2016-reform amendment) |
| MI | 35 | 1 | 0 | 0 | **labor.increment — "15 minutes or more" is a floor on the billing increment, not a fixed value.** Web-only sources (MCL 15.235, 408.934) re-fetched with repaired TLS chain, all figures confirmed, clean texts banked in source_docs |
| MN | 36 | 0 | 0 | 0 | 2025 subd. 3(g) suspension rule captured; Minn. Rules 1205.x delegated layer followed |
| MO | 36 | 0 | 0 | 0 | HB 145 withdrawal regime (90/150 days) captured; Gross v. Parson no-attorney-review-time honored |
| NY | 35 | 1 | 0 | 0 | dup.specialty.rate — source_language updated to current § 87(1)(c) saver-clause placement (DOS page prints a stale rendering); substance stands |
| OK | 36 | 0 | 0 | 0 | SB 2184 § 72 check: only swaps "Service Oklahoma" into ¶3 driving-records proviso — NO fee change; 25¢ cap regime stands |
| OR | 36 | 0 | 0 | 0 | 2026 c.93 currency check done in discover; county-clerk delegation (ORS 205.320) followed |
| VA | 36 | 0 | 0 | 0 | SB 56 (2026) correctly NOT imported (passed Senate, not enacted); history ends 2023 c.534 |
| WA | 34 | 2 | 0 | 0 | media, delivery — basis fixed→**ceiling**: RCW 42.56.120(2)(b) "may not charge in excess of" makes actual cost a ceiling, matching the discover pass's own convention on sibling rows |
| WI | 36 | 0 | 0 | 0 | DOJ 25¢ guidance correctly kept out of statutory values; § 19.35(3)(h) body-cam regime and no-redaction-fee case law captured |

## Merge status (2026-08-21)

**DONE — full 32-state verified layer merged into `alignment/fee_master_list.json`**
(1120 cells = 35 items × 32 states; 1098 CONFIRMED rows as-is + 22 with the verify agent's
corrected_row). `payment.method` moved to `excluded_items` per the owner decision; its 13
payment-only 9NNN anchor rules excluded with it. The other 346 new 9NNN rules are banked in
`alignment/fee_gap_new_rules.json`. Merge script (idempotent, full rebuild):
`fee_gap/scripts/merge-verified-into-master.js`.

## Follow-ups

1. **GA payment.method — RESOLVED by scope decision (Kevin, 2026-08-20).** No manual check
   needed: `payment.method` is OUT OF SCOPE for the state rules profile. Card acceptance is
   citywide finance-department policy, not an open-records rule (across all 22 states the item
   is either silent in the records law or rests on a general municipal-payments statute; only
   TN/TX have records-specific content, and only at guidance level). **Exclude the item at
   merge.** Bonus: Kevin's Justia 2025 copy of § 50-18-71 confirms GA fee subsections current
   through SB 12 (eff. 5/14/2025, non-fee amendment).
2. ~~Decisions parked with Kevin~~ — both executed 2026-08-21: (a) the verified layer is
   merged (see Merge status above); (b) the 10-state gap pass ran source-grounded on
   Kevin-supplied official texts and is complete. **Step 2 is DONE for all 32 states.**
   Next: step 3 — template `fee_schedule` gains `value/unit/basis/engine_field/applies_to`
   from the verified layer.
