# Wave 1 — 8-state master list (TX/CA/NY/FL/IL/VA/WA/AZ) — 2026-07-21

> Workflow `rules-wave1-8states`, run `wf_d36c9670-f73`. **399 agents, ~6.94M tokens, ~93 min.**
> 290 rules mined → 272 verified → **173 concepts** (48 parameter · 125 structural; 34 multi-state).
> 388 cross-state pairs verified (190 hold / 198 split); 42 candidates split by verify.
> **Apply-verdicts acceptance check: PASSED — 0 surviving split-pair violations.**
> Deliverables (machine-readable seed for wave 2): concept_dictionary.json · parameter_table.json ·
> structural_catalog.json in this folder.

---

# WAVE 1 — 50-State Master List, First Tranche

**Prepared for:** Technical Product Owner
**Scope:** TX · CA · NY · FL · IL · VA · WA · AZ (8 states)
**Date:** 2026-07-20
**Pipeline:** discovery → reconciliation → apply-verdicts → acceptance gate

---

## 1. Wave 1 at a glance

| State | Rules mined | Verified | Material negatives | Verify rate |
|-------|:----:|:----:|:----:|:----:|
| TX | 35 | 29 | 5 | 83% |
| CA | 31 | 30 | 8 | 97% |
| NY | 41 | 39 | 14 | 95% |
| FL | 30 | 26 | 6 | 87% |
| IL | 48 | 48 | 6 | 100% |
| VA | 39 | 39 | 8 | 100% |
| WA | 44 | 40 | 6 | 91% |
| AZ | 22 | 21 | 7 | 95% |
| **Total** | **290** | **272** | **60** | **93.8%** |

- **Usable rows:** 290 (= sum of mined rules); **272 survived verification** (~18 rows, 6.2%, dropped as unverifiable/contentless).
- **Concepts in the master list:** **173** — reconciled from 114 candidates.
- **Apply-verdicts acceptance check: PASSED — 0 surviving split-pair violations.** No concept still groups two states that the pairwise verifier ruled must stay apart. This is the gate that has to read zero, and it does.

---

## 2. The master list — 173 concepts

**Split by config home:** ~**125 structural** (process nodes, branches, stages) + ~**48 parameter** (city-tunable numeric/threshold cells). 34 concepts span ≥2 states (**multi-state**); the remaining 139 are single-state specials.

The parameter concepts are the ones the config engine will surface as per-city knobs. The cross-state parameter families — where the *same lever* carries a *different value* per state — are the payload of Wave 1:

### Response window (the headline knob)
`deadline.initial_response_window` split into three concepts because the values are irreconcilable:

| State | Basis | Value | Cite |
|---|---|---|---|
| NY | fixed | 5 business days | Pub. Off. Law § 89(3)(a) |
| VA | fixed | 5 working days | Va. Code § 2.2-3704(B) |
| WA | fixed | 5 business days | RCW 42.56.520(1) |
| IL | fixed | 5 business days | 5 ILCS 140/3(d) |
| CA | fixed | 10 days | Gov. Code § 7922.535(a) |
| **TX · FL · AZ** | **ABSENT** | **no numeric window** — run on "promptly"/soft standard (`production.promptly`) | — |

> **Material negative worth flagging to product:** TX, FL and AZ have **no fixed statutory response deadline**. The engine cannot default them to a day count — their clock is a soft standard, and the UI must not manufacture a hard due date.

### Determination extension
| State | Basis | Value |
|---|---|---|
| CA | ceiling | +14 days beyond the 10-day determination |
| IL | ceiling | +5 business days (7 enumerated grounds) |
| VA | fixed | +7 work days (60 work days for criminal-investigative files) |
| WA | structural | enumerated grounds, no numeric cap |

### Copy-fee ceilings
| Concept | States | Notable values |
|---|---|---|
| `fee.per_page_rate_ceiling` | NY 25¢/copy · FL 15¢ (+5¢ two-sided) · IL 15¢ after free 50 · WA 15¢ (or flat $2/request) | per-page ceilings only where the state sets one |
| `fee.copy_actual_cost_ceiling` | CA · VA · WA (direct/actual cost) · FL (non-standard paper) | CA/VA/WA carry **no per-page number** — actual cost only |
| `fee.other_records_actual_cost` | NY · IL · WA (up to 10¢/page scanned) | |
| `fee.electronic_medium_cost` | IL tiered $20/$40/$100 by data size | |
| `fee.certified_copy_charge` | FL up to $1 · IL ≤$1 | |
| `fee.labor_special_service_charge` | FL · WA — both soft-standard, no numeric cap | |

### Deposit / advance payment
| State | Basis | Value |
|---|---|---|
| VA | fixed | threshold $200; deposit = advance-determination amount |
| WA | ceiling | deposit ≤ 10% of estimated copy cost |

### Inspection hours
TX (floor — city sets hours) · CA (fixed — all office hours) · AZ (fixed — regular office hours).

### State-specific clocks captured as parameters
TX withdrawal timers (61-day clarification, 10-business-day fee-estimate, 60-day abandonment), VA fee-estimate withdrawal (30 days), and the TX AG-review deadlines (10th/15th business day referral; 45-business-day AG decision +10).

---

## 3. Structural forks — confirmed catalogued, not flattened

The reconciler kept genuinely different *process paths* in the **structural catalog** rather than collapsing them into parameter cells. The material forks:

- **TX Attorney-General pre-clearance (a whole stage no other Wave 1 state has):** `review.ag_decision_required` (must seek AG ruling to withhold, absent a prior determination) → `review.ag_referral_deadlines_notices` → `review.ag_decision_render_deadline` → `denial.deemed_disclosure_on_noncompliance` (untimely AG request ⇒ info presumed public) → `redaction.ssn_no_ag` (SSN redaction without AG) → `deadline.tolling_pending_requester_response__1`. This is correctly a **branch/stage**, not a knob.
- **VA restricted standing:** `eligibility.requester_class_restricted` (citizens/press only) sits as its own structural gate *against* the 7-state `eligibility.any_person` default — a true eligibility fork, not a parameter on the same node.
- **WA:** `response.options_enumerated` (5 mandated response forms incl. time estimate), `intake.bot_request_denial`, `intake.overbreadth_not_sole_denial`, `appeal.admin.review_right__3` (final agency action at end of 2nd business day), `production.installment_basis`, `appeal.judicial.charge_estimate_review`.
- **IL:** Public Access Counselor review (`appeal.admin.review_right__2`), recurrent/voluminous-requester definitions, unduly-burdensome standard, appeal-rights notice.
- **NY:** administrative appeal to agency head, forwarding to the Committee on Open Government, constructive-denial-on-appeal, Article-78 judicial path.
- **AZ:** commercial-purpose statement + definition, governor-order pause for suspected commercial misuse, crime-victim processing priority.
- **FL:** contractor-records custody, designee-disclosure, 30-day preservation hold, policy-delay-as-constructive-denial.

**Confirmation:** these live in the structural catalog as distinct shapes (gates/branches/stages), consistent with the config-over-encoding rule — parameters are city-tunable values; structural specials are separate process paths and must never be flattened into a value column.

---

## 4. Reconciliation health

- **Apply-verdicts fired, materially.** 114 candidates → **173** final; **42 candidates were split by verify** (the `__1/__2/__3` suffixing). Concrete example: `deadline.initial_response_window` split three ways (5-day vs 10-day vs absent), and `fee.copy_actual_cost_ceiling` / `fee.per_page_rate_ceiling` fragmented rather than force-merging different bases. This is the stage doing its job.
- **Pairwise verification is appropriately skeptical.** 388 cross-state pairs verified: **190 hold / 198 split** — nearly half of proposed equivalences were rejected. The reconciler is not over-merging to inflate the multi-state count.
- **Acceptance gate clean:** 0 surviving split-pair violations (§1).
- **Verify/capture rate: 93.8%** (272/290); ~18 rows dropped as contentless/unverifiable.
- **Material negatives captured: 60** — absence is being recorded as data (e.g., TX/FL/AZ = no fixed response window), which the config engine needs as much as presence.

**Weakest discovery — AZ.** 22 rules (lowest by a wide margin) and the highest negative ratio (7/22 ≈ 32%). AZ sits outside most multi-state groups and has no fixed-window concept. It's not wrong, but it's the thinnest column and the first candidate for a re-mine before it anchors comparisons in Wave 2. NY is the opposite — richest (41 rules) but carries the most carve-outs (14 negatives), so its exemption/appeal surface is dense and worth spot-auditing.

---

## 5. Ready for Wave 2?

**Yes — this is a sound seed.** Canonical keys are stable, `config_home` is assigned, the parameter table carries basis + value + citation per cell, and the apply-verdicts → acceptance-gate loop is proven to zero. New states can be absorbed against this dictionary rather than starting cold.

**What to watch, honestly:**

1. **Concept fragmentation is the #1 scale risk.** 42 splits already, and `initial_response_window` fragmented into three keys *keyed by value*. Adding states with 3-day, 7-day, or "reasonable time" windows will keep minting `__4/__5/…`. **Decide now:** is `initial_response_window` **one** concept with a per-state parameter cell, or N concepts keyed by value? The current pattern will not scale to 50 states cleanly — recommend collapsing pure-value variants into one concept + parameter cells, reserving new concepts for genuine *shape* differences.

2. **`config_home` drift within a family.** The same real-world lever lands in different homes across states — `payment.advance_deposit_before_production` is parameter in VA/WA but structural in AZ/CA; `deadline.determination_extension` is parameter in CA/IL/VA but structural in WA. Set a rule so a lever's home is decided by the lever, not by the state, before Wave 2 amplifies the inconsistency.

3. **Preserve negative capture.** The 60 material negatives (esp. "no numeric deadline") are load-bearing for the engine. Wave 2 mining must keep recording absence, not just presence.

4. **Pairwise verification cost.** 388 pairs for 8 states is ~O(n²). At 50 states this explodes — confirm pair-verification stays scoped to same-family candidates (it appears to), and keep the hold/split ratio as a monitored health metric.

5. **Floor on discovery depth.** AZ's thin column shows a state can be under-mined. Set a minimum rule/negative target so no Wave 2 state anchors comparisons on a shallow pull.

6. **Structural specials will multiply.** TX's AG stage and VA's standing fork are the template for what Wave 2 brings (each state adds its own oversight body / appeal path). Confirm the structural catalog remains their home and the flatten-to-parameter temptation is resisted.

**Bottom line:** Green to proceed to the next 8–10 states. Resolve the value-vs-shape split policy (#1) and the `config_home` rule (#2) *before* the next tranche, or the concept count will grow faster than the actual legal surface it represents.