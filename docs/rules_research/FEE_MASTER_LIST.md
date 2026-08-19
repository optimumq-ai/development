# Fee & Estimate MASTER LIST — step 1 (published 2026-08-19)

**What this is.** The complete set of configuration items the fee / estimate / payment engine can hold, each mapped to the canonical concept(s) of the rules library, with a per-state status **auto-derived from the rule text** as the starting point for the step-2 gap pass. Every cell in `fee_master_list.json` carries the rule ids, citations, extracted numbers and a snippet so a person can verify it. Nothing here is a verified value yet.

**Status legend.** `V` a number is present in the rule text (verify it belongs to this field) · `V*` a number AND a delegation ("may not exceed the AG-set amount by 25%") · `D` delegated to a regulation / AG rule / uniform schedule — the figure is outside the corpus · `C` statute defers to the city / governing body · `A` "actual cost" / "reasonable" standard (city sets, within the standard) · `R` a rule exists but carries no value (structural or qualitative) · `·` silent.

**Known holes.**
- NJ: dictionary lists NJ under several fee concepts but the pruned corpus holds ZERO NJ rules (chunked-discovery failure) — every NJ cell is "silent" here and must be re-researched.
- Delegations: where a statute delegates rate-setting to a regulation / AG rule / uniform schedule (TX 1 TAC §70.3 pattern), the regulation text is NOT in the corpus — the gap pass follows those.
- Duplicated homes: estimate threshold, deposit threshold and deposit cap live in BOTH fee_profiles.requestRules and jurisdiction_rules fee_waiver.* — one concept, two stores; a later step picks one home.
- Not in engine: per-requestor periodic free hours (TX §552.275), repeat/aggregation rules — recorded here so the field can exist before anyone populates it.

## Items (engine field ← canonical concepts)

| # | Item | Engine home | Type | Canonical concepts |
|---|---|---|---|---|
| 1 | Copy rate — B&W page | `fee_profiles:duplication.bw.rate` | rate_usd | `fee.copy_rate_per_page`, `fee.actual_cost_basis`, `fee.schedule_and_authority` |
| 2 | Copy rate — color page | `fee_profiles:duplication.color.rate` | rate_usd | `fee.copy_rate_per_page`, `fee.nonstandard_rate` |
| 3 | Copy rate — oversized / nonstandard page | `fee_profiles:duplication.oversized.rate` | rate_usd | `fee.nonstandard_rate` |
| 4 | Specialty reproduction (photos, maps, transcripts) | `fee_profiles:duplication.specialty.rate` | actual_or_usd | `fee.nonstandard_rate`, `fee.special_service_charge` |
| 5 | Graduated page bands (per-page rate by volume) | `fee_profiles:duplication.*.tiers` | tiers | `fee.copy_rate_per_page`, `fee.free_allowance` |
| 6 | Free page allowance per request | `fee_profiles:requestRules.freePageAllowance` | pages | `fee.free_allowance`, `fee.no_charge_categories` |
| 7 | Labor rate — search / retrieval ($/hr) | `fee_profiles:labor.search.rate` | rate_usd_per_hour | `fee.labor_charge`, `fee.actual_cost_basis` |
| 8 | Labor rate — review / redaction ($/hr) | `fee_profiles:labor.review.rate` | rate_usd_per_hour | `fee.labor_charge`, `fee.no_charge_categories` |
| 9 | Labor rate — programming / data extraction ($/hr) | `fee_profiles:labor.programming.rate` | rate_usd_per_hour | `fee.labor_charge`, `fee.special_service_charge` |
| 10 | When labor is chargeable at all (never / always / only over N pages or N hours; paper-only scope) | `fee_profiles:labor.*.billable / billableWhen{trigger,threshold,paperOnly}` | enum+threshold | `fee.free_allowance`, `fee.labor_charge`, `fee.no_charge_categories` |
| 11 | Overhead / fringe surcharge on labor (%) | `fee_profiles:labor.overheadPct` | pct | `fee.labor_charge`, `fee.actual_cost_basis` |
| 12 | Labor time increment + rounding | `fee_profiles:labor.*.increment / rounding` | hours | `fee.labor_charge` |
| 13 | Free labor hours per request | `fee_profiles:requestRules.freeLaborHours` | hours | `fee.free_allowance`, `fee.labor_charge` |
| 14 | Free personnel time per requestor per month/year (TX § 552.275 pattern) | `NOT IN ENGINE (fee_profiles gap — requestor-ledger counter)` | hours | `fee.free_allowance`, `fee.aggregation` |
| 15 | Itemized estimate / cost notice required above ($ or hours) | `fee_profiles:requestRules.estimateNotifyThreshold  (DUPLICATE: jurisdiction_rules fee_waiver.estimate_required_above)` | usd | `fee.estimate_and_notice` |
| 16 | Requester must respond to an estimate within N days (else withdrawn) | `fee_profiles:estimatePolicy.requesterResponseDays  (also fee_waiver.response_window_*)` | int | `fee.estimate_and_notice`, `payment.nonpayment_consequence` |
| 17 | Revised estimate required when actual exceeds estimate by N% | `fee_profiles:estimatePolicy.revisionNotifyPercent  (also payment.reissue_required_on_variance)` | pct | `fee.estimate_and_notice` |
| 18 | Estimate validity period (days) | `fee_profiles:estimatePolicy.estimateValidityDays` | int | `fee.estimate_and_notice` |
| 19 | Deposit / prepayment may be required above ($) | `fee_profiles:requestRules.deposit.threshold  (DUPLICATE: fee_waiver.deposit_allowed_above)` | usd | `payment.deposit_threshold`, `payment.deposit`, `payment.advance_payment` |
| 20 | Deposit capped at (% of estimate) | `fee_profiles:requestRules.deposit.percent  (DUPLICATE: fee_waiver.deposit_cap_pct)` | pct | `payment.deposit_ceiling`, `payment.deposit` |
| 21 | Production may be conditioned on payment (pay before copies / pay in full before release) | `paymentTiming gates + fee_profiles bands` | enum | `payment.production_conditioned_on_payment`, `payment.advance_payment` |
| 22 | Nonpayment consequence (withdrawn after N days; prior-debt prepayment) | `feeNonpayment + estimatePolicy + jurisdiction_rules payment.deposit_lapse_action` | enum+int | `payment.nonpayment_consequence` |
| 23 | Statutory clock effect while a deposit is unpaid; grace; lapse action | `jurisdiction_rules:payment.{deposit_clock_effect,deposit_grace_days,deposit_lapse_action}` | enum | `payment.deposit`, `payment.advance_payment` |
| 24 | Overrun re-issue rules (revised estimate required / blocks collection / restarts window) | `jurisdiction_rules:payment.reissue_*` | bool | `fee.estimate_and_notice` |
| 25 | Electronic payment method offered | `fee_profiles:payment_mode (operational; not law-driven except VA)` | enum | `payment.method` |
| 26 | Request-level ceiling (actual cost cap / statutory max) | `fee_profiles:requestRules.maxFee` | usd_or_rule | `fee.actual_cost_basis`, `fee.schedule_and_authority` |
| 27 | De-minimis: no charge below ($) | `fee_profiles:requestRules.deMinimis (+ de-minimis knob)` | usd | `fee.waiver`, `fee.no_charge_categories` |
| 28 | Minimum fee | `fee_profiles:requestRules.minFee` | usd | — |
| 29 | Electronic media (CD/DVD/USB) charge | `fee_profiles:media.{cd,dvd,usb}` | actual_or_usd | `fee.electronic_media_charge` |
| 30 | Delivery: mail / handling / email / pickup | `fee_profiles:delivery.*` | actual_or_usd | `fee.delivery_charge`, `fee.electronic_media_charge` |
| 31 | Certification / certified-copy charge | `fee_profiles:certification.{rate,unit}` | rate_usd | `fee.certified_copy_charge` |
| 32 | Audio/video: per recording, per minute, free minutes | `fee_profiles:av.{perRecording,perMinute,freeMinutes}` | rate_usd | `fee.special_service_charge`, `fee.nonstandard_rate` |
| 33 | Commercial-purpose schedule (surcharge %, labor becomes chargeable) | `fee_profiles:purposeOverrides.commercial` | pct+bool | `fee.commercial_charge` |
| 34 | Fee waiver: grounds, mandatory vs discretionary, purpose statement, written denial, appeal | `jurisdiction_rules:fee_waiver.*` | enum_list+bool | `fee.waiver` |
| 35 | Late response forfeits the fee | `jurisdiction_rules:fee_waiver.fee_forfeiture_on_late_response` | bool | `fee.waiver`, `payment.nonpayment_consequence` |
| 36 | Repeat / aggregated requests (carry-forward, aggregation threshold) | `NOT IN ENGINE (requestor-ledger)` | structural | `fee.repeat_request_carryforward`, `fee.aggregation` |

## Per-state matrix (auto-derived — see legend)

| Item | AL | AZ | CA | CO | CT | FL | GA | ID | IL | IN | KS | LA | MA | MI | MN | MO | NC | NE | NJ | NV | NY | OH | OK | OR | PA | SC | TN | TX | UT | VA | WA | WI |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dup.bw.rate | A | R | A | V | V | V | V | A | V | V | A | C | V | V | V | V | A | R | · | D | V | A | V | A | V | R | V | V* | C | A | V | V |
| dup.color.rate | · | R | · | V | V | V | V | · | V | V | · | C | V | V | V | V | · | · | · | V* | V | V | V | · | V | R | V | R | · | · | V | A |
| dup.oversized.rate | · | · | · | A | R | A | · | · | A | · | · | · | · | · | · | · | · | · | · | V | · | V | · | · | · | · | V | · | · | · | · | A |
| dup.specialty.rate | · | · | · | A | R | A | · | · | V | A | · | · | · | · | · | · | D | · | · | V | · | V | · | · | C | · | V | · | · | · | R | A |
| dup.tiers | · | R | · | V | V | V | V | R | V | V | · | C | V | V | V | V | · | R | · | D | V | A | V | · | V | R | V | V | R | · | V | A |
| rules.freePages | · | · | R | R | · | · | R | R | V | · | · | R | V | R | · | · | · | R | · | D | A | · | · | · | R | R | · | V | R | R | R | R |
| labor.search.rate | · | · | A | R | · | A | A | A | · | · | A | R | V | V | A | A | A | R | · | A | A | · | A | A | · | A | V | · | A | A | C | V |
| labor.review.rate | · | · | R | R | · | · | A | R | R | · | A | R | V | V | A | A | R | · | · | D | A | · | · | R | R | A | R | · | R | R | R | V |
| labor.programming.rate | · | · | · | R | · | A | A | R | V | A | A | R | V | V | A | A | D | · | · | · | A | · | · | R | C | A | R | · | R | · | R | V |
| labor.billableWhen | · | · | R | R | · | · | A | R | V | · | A | R | V | V | A | A | R | R | · | D | A | · | · | R | R | A | R | V | R | R | R | V |
| labor.overheadPct | · | · | A | R | · | A | A | A | · | · | A | R | V | V | A | A | A | R | · | A | A | · | A | A | · | A | V | · | A | A | C | V |
| labor.increment | · | · | · | R | · | · | A | R | · | · | A | R | V | V | A | A | R | · | · | · | A | · | · | R | · | A | R | · | R | · | · | V |
| rules.freeLaborHours | · | · | · | R | · | · | A | R | V | · | A | R | V | V | A | A | R | R | · | · | A | · | · | R | · | A | R | V | R | · | · | V |
| labor.periodicFreeHours | · | · | · | R | · | · | R | R | V | · | · | · | V | · | · | · | · | R | · | · | · | · | · | · | · | · | A | V | R | · | · | · |
| rules.estimateNotifyThreshold | R | · | · | · | · | · | V | · | · | · | V | · | R | R | · | R | · | R | · | · | R | · | · | V | · | · | A | V* | · | A | · | · |
| estimate.requesterResponseDays | R | · | · | · | · | · | V | · | · | · | V | R | C | V | · | R | · | R | · | · | R | · | A | V | · | · | A | V* | · | A | R | · |
| estimate.revisionNotifyPercent | R | · | · | · | · | · | V | · | · | · | V | · | R | R | · | R | · | R | · | · | R | · | · | V | · | · | A | V* | · | A | · | · |
| estimate.validityDays | R | · | · | · | · | · | V | · | · | · | V | · | R | R | · | R | · | R | · | · | R | · | · | V | · | · | A | V* | · | A | · | · |
| rules.deposit.threshold | A | R | · | · | R | · | V | R | · | · | R | R | R | V | · | R | · | R | · | · | · | R | · | · | V | · | R | V | V | V | · | V |
| rules.deposit.percent | · | · | · | · | · | · | · | · | · | · | R | · | · | V | · | · | · | R | · | · | · | · | · | · | · | R | · | V | · | · | R | · |
| payment.productionGate | A | R | A | · | R | · | V | R | R | · | · | R | A | · | · | R | · | · | · | R | · | R | · | R | V | R | R | · | V | · | · | V |
| payment.nonpayment | R | · | · | · | · | · | R | · | · | · | R | R | C | V | · | R | · | R | · | · | · | · | A | V | · | · | · | · | · | · | R | · |
| payment.depositClock | A | R | · | · | R | · | V | R | · | · | R | R | R | V | · | R | · | R | · | · | · | R | · | · | V | · | R | V | V | · | · | V |
| payment.reissue | R | · | · | · | · | · | V | · | · | · | V | · | R | R | · | R | · | R | · | · | R | · | · | V | · | · | A | V* | · | A | · | · |
| payment.method | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | C | · | · |
| rules.maxFee | A | · | A | · | · | A | R | A | · | C | A | D | A | R | · | R | A | R | · | A | A | · | A | A | R | R | V | V* | C | A | C | V |
| rules.deMinimis | · | R | R | R | C | · | · | R | R | · | · | R | A | V | · | R | · | R | · | D | A | · | R | R | R | R | R | R | R | A | R | R |
| rules.minFee | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| media | · | · | A | · | A | · | A | A | A | A | R | · | A | R | · | R | R | A | · | A | · | · | · | · | R | R | A | · | · | A | V | · |
| delivery | · | · | A | · | A | · | A | A | A | A | R | · | A | A | · | R | R | A | · | A | · | · | · | · | A | R | A | · | · | A | V | A |
| certification | · | · | · | · | V | V | · | · | V | V | · | · | · | · | · | · | R | · | · | · | · | · | V | · | A | · | · | · | · | · | · | · |
| av | · | · | · | A | R | A | · | · | V | A | · | · | · | · | · | · | D | · | · | V | · | V | · | · | C | · | V | · | · | · | R | A |
| commercial | · | A | · | · | · | · | · | · | V | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | R | · | · | · | R | · |
| waiver | · | R | · | · | C | · | · | R | R | · | · | R | A | V | · | R | · | R | · | R | · | · | R | R | R | R | R | R | R | A | · | R |
| waiver.forfeiture | R | R | · | · | C | · | R | R | R | · | R | R | C | V | · | R | · | R | · | R | · | · | A | V | R | R | R | R | R | A | R | R |
| repeat | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | A | · | · | · | · | · |

## Per-state summary

| State | items with a number | delegated | defers/actual-cost | rule-no-value | silent |
|---|---|---|---|---|---|
| AL | 0 | 0 | 5 | 7 | 24 |
| AZ | 0 | 0 | 1 | 9 | 26 |
| CA | 0 | 0 | 7 | 4 | 25 |
| CO | 3 | 0 | 3 | 10 | 20 |
| CT | 4 | 0 | 5 | 6 | 21 |
| FL | 4 | 0 | 7 | 0 | 25 |
| GA | 11 | 0 | 9 | 5 | 11 |
| ID | 0 | 0 | 6 | 14 | 16 |
| IL | 12 | 0 | 3 | 5 | 16 |
| IN | 4 | 0 | 6 | 0 | 26 |
| KS | 5 | 0 | 9 | 7 | 15 |
| LA | 0 | 1 | 3 | 16 | 16 |
| MA | 12 | 0 | 9 | 6 | 9 |
| MI | 18 | 0 | 1 | 7 | 10 |
| MN | 3 | 0 | 7 | 0 | 26 |
| MO | 3 | 0 | 7 | 15 | 11 |
| NC | 0 | 3 | 4 | 7 | 22 |
| NE | 0 | 0 | 2 | 21 | 13 |
| NJ | 0 | 0 | 0 | 0 | 36 |
| NV | 4 | 6 | 5 | 3 | 18 |
| NY | 3 | 0 | 10 | 5 | 18 |
| OH | 4 | 0 | 2 | 3 | 27 |
| OK | 4 | 0 | 6 | 2 | 24 |
| OR | 7 | 0 | 4 | 8 | 17 |
| PA | 6 | 0 | 5 | 8 | 17 |
| SC | 0 | 0 | 7 | 12 | 17 |
| TN | 9 | 0 | 9 | 12 | 6 |
| TX | 15 | 0 | 0 | 4 | 17 |
| UT | 3 | 0 | 4 | 11 | 18 |
| VA | 1 | 0 | 15 | 3 | 17 |
| WA | 5 | 0 | 3 | 12 | 16 |
| WI | 12 | 0 | 6 | 4 | 14 |

## How this is used next
- **Step 2 (gap pass):** one research+verify run per state over exactly these items — follow every `D` into its regulation, confirm every `V`/`V*` belongs to the field it landed on, and turn `·`/`R` into either a value, an explicit "defers to city", or a confirmed "state silent".
- **Step 3:** the state template `fee_schedule` gains `value / unit / basis / engine_field` per item.
- **Step 4:** generator (template → proposed fee profile), local-policy validation against constraints, one-time auto-configure + lock.
- **Acceptance:** for each state, every item is valued from the library or explicitly city-deferred; no state-specific code.

