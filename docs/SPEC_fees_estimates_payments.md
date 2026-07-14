# Consolidated Spec — Domain 6: Fees, Estimates & Payments (deep pass)
**Current design only.** Verified against code + DB on 2026-07-08. Complements SPEC_tasks_roles_mrr_fees (intake capture, waiver gate, Finance role).
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DEFERRED]`

## 1. Fee engine `[BUILT]`
Computes an estimate from INPUT quantities + a jurisdiction **fee profile** (`fee_profiles`, versioned, per-jurisdiction, context 'FR'). Mechanics: graduated **rate bands** (tiered pricing incl. free tiers); per-request **free labor hours** consumed in order search → review → programming, then increment-rounded (up/down/nearest) and priced; **labor billability gates** (hard non-billable states CA/NY/OH; all-or-nothing triggers — TX no labor until >50 pages, FL/NY hours thresholds); **labor overhead surcharge** (e.g., TX +20%, zero when labor non-billable); free B&W page allowance then duplication (bw/color/oversized bands); request-level floor/ceiling, de-minimis, deposit, notify thresholds. **purposeOverrides** layer standard vs **commercial** additively (labor becomes chargeable + surcharge). Waiver = compute-then-waive (Domain 4 spec §9). Three state profiles loaded; **TX verified against § 552.2615 / § 552.263** (50% deposit figure is agency policy, not statute). **Certification intake→engine wiring `[BUILT]`:** the requestor's intake opt-in (`requests.certification_requested`) now defaults `certification.count` on estimate + reconcile (one per priced component — `per_record` unit; an MRR master certifies each child), so a requested certification is never silently dropped from the estimate. The estimate panel surfaces the opt-in (`GET /fee-estimates/request/:id` → `certification.{requested,suggestedCount,rate,unit}`) and lets staff override the count (including `{count:0}` to remove it); an explicit body block always wins over the intake default. Priced only where the active FR profile sets a non-zero `certification.rate`. **Verified: TX PIA cost rules (1 TAC §70.3) authorize NO certification fee** — it is not a chargeable category — so the loaded TX profile is set to **`rate:0`** (legally accurate; no certification line on TX estimates). A city that charges to certify specific documents under separate statute would set its own figure. The intake→engine wiring still feeds `certification.count` regardless of rate; pricing appears on any profile with a non-zero cert rate.

## 2. Estimate profiles & the automated/manual decision `[BUILT engine / EMPTY data]`
`record_type_estimate_profiles` stores generating inputs (quantities/stats/sample_size/expert seed). `estimateProfile.assess(recordTypeId)` is THE decision node: returns **automated** (profile confident + active jurisdiction fee config → priced total + deposit) or **manual** with reasons/drivers. Drives the estimate task title ("Review auto-generated estimate" vs "Create estimate"). **Zero profiles populated** — every estimate is manual today.

## 3. Payment timing: gates & bands `[BUILT]`
`paymentTiming` decides WHAT is collected WHEN and what it gates. Four gates: `invoice_on_completion`, `estimate_acceptance`, `deposit_before_work`, `pay_in_full_before_release`. Band selection by estimate total (first band whose upTo ≥ total). `gateToStage` maps a gate to the next stage; safety rule: a request that required a deposit never regresses out of `awaiting_payment`.

## 4. Estimate lifecycle `[BUILT]`
Create/version snapshots (`request_fee_estimates`) → **send notice** (feeNotice; marks the estimate task done) → requestor **accept** (→ awaiting_payment if deposit due, else record_search + task spawn) / **decline** → **deposit/payment record** (clears awaiting_payment → record_search + task spawn) → **final payment** → **reconcile** (actuals vs estimate) → **adjustment** + adjustment notice → **reopen**. MRR-aware fee aggregation across children exists.

## 5. Payment modes & settlement `[BUILT]`
Two modes: local **cash drawer** (CashDrawerPage) and **ERP settlement** — emit charge to ERP, track locally, ERP calls back `payment-applied` (webhook, no auth) which clears awaiting_payment and spawns the search task. Charge history per request.

## 6. Nonpayment & release gate `[BUILT]`
- **feeNonpayment**: OPT-IN per jurisdiction auto-close for COMPLETION-phase unpaid states (awaiting_final / released_payment_due) — one dunning reminder at reminderDays, then close; complements the tickler's pre-work lapse coverage.
- **feeRelease**: read-only release gate — resolves plan + balance, reports whether records may release; consumed by stage-advance; **fails open** so a gate fault can't block unrelated transitions.

## 7. Objections `[BUILT]`
Requestor objection to fees: filed per request with **source** (letter/email/phone/in_person) + **evidence required** (file or typed recap) + reason. Resolution proposals priced against the active fee profile; **approval gate** = FEE_WAIVER_APPROVER (→ Finance role per rename decision); escalation path resolves a SUPERVISOR/DEPT_MANAGER in the caller's department. Statuses: pending-approval → approved/resolved with audit (who/when).

## 8. Fee sandbox `[BUILT]`
Onboarding Fees phase: preset scenarios + custom inputs; Issues/Confirmed paths; **hard gate** — phase approval requires a confirmed test on record.

## 8b. THE 50-PAGE LABOR BAR — § 552.261(a) `[FIXED 2026-07-14]`

**The engine always had the gate. The config never set it.** `feeEngine.laborGate` has carried an
all-or-nothing labor trigger since it was written — its own comment names Texas — and **`billableWhen`
appeared in ZERO seeded fee profiles.** So the mechanism sat there, correct and unreachable, while **every
Texas estimate charged labor**:

> **Tex. Gov't Code § 552.261(a):** *"If a request is for 50 or fewer pages of paper records, the charge …
> **may not include costs of materials, labor, or overhead**, but shall be limited to the charge for each page
> of the paper record that is photocopied."* (The per-page rate is 1 TAC § 70.3 = `duplication.bw.rate`, $0.10.)

A typical **8-page incident report priced at $12.05 where the statute allows $0.80** — ~15× over, on the most
common request a city receives. **A reader with no config: the mirror of the "seeded but never read" class,
and just as silent.** Found only because **populating the estimate profiles (§2) would have AUTOMATED the
overcharge** across the ten most common record types, emitting it under a *"Review auto-generated estimate"*
label that implies a human validated it. Locked by **`verify_fee_labor_gate` (20)** — the **config** is now
the thing under test, so a reseed from an old script or a copied config for a new city goes RED, not live.

**⚠ `paperOnly` — UNVERIFIED, and LOAD-BEARING (Kevin's call, 2026-07-14).** § 552.261(a) says *"pages of
**paper** records"* and *"photocopied"*, so the bar is scoped to paper deliveries (`mail`/`pickup`/`paper`).
**The demo's default delivery is `email`, so the bar does NOT fire on most requests** — that same 8-page report
still prices at $12.05 by email. Test **D** pins this exactly so it stays visible. **Needs counsel.** If
§ 552.261(a) is read to reach electronic copies, it is a **one-value flip** (`paperOnly: false`).

**⚠ Two things deliberately NOT encoded** (flagged, not guessed): the statute's **two exceptions** (records in
2+ unconnected buildings, or a remote storage facility, restore the labor charge) — asserting the condition
per request is a design question, and **under-charging is recoverable while unlawful over-charging is not**;
and **`labor.overheadPct`**, which this spec's §1 mentions as a TX +20% surcharge but which is **NOT in the
verified-TX section** of `FEE_ESTIMATE_KNOWLEDGE.md`. **An unresearched charge is the same exposure as an
unresearched clock rule.** Both remain unseeded.

## 9. Known gaps
- **The `paperOnly` scope + the two § 552.261(a) exceptions + `labor.overheadPct`** — see §8b. Counsel.
- Commercial intake capture `[NOT BUILT]` + approval `[DEFERRED]` — Domain 1 spec §5.
- Fee-waiver approval task routing `[NOT BUILT]` — Tasks spec §11.1.
- Variant-level profiles blocked on taxonomy decision (Domain 3 §5).
