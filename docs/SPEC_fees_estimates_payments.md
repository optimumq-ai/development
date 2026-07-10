# Consolidated Spec — Domain 6: Fees, Estimates & Payments (deep pass)
**Current design only.** Verified against code + DB on 2026-07-08. Complements SPEC_tasks_roles_mrr_fees (intake capture, waiver gate, Finance role).
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DEFERRED]`

## 1. Fee engine `[BUILT]`
Computes an estimate from INPUT quantities + a jurisdiction **fee profile** (`fee_profiles`, versioned, per-jurisdiction, context 'FR'). Mechanics: graduated **rate bands** (tiered pricing incl. free tiers); per-request **free labor hours** consumed in order search → review → programming, then increment-rounded (up/down/nearest) and priced; **labor billability gates** (hard non-billable states CA/NY/OH; all-or-nothing triggers — TX no labor until >50 pages, FL/NY hours thresholds); **labor overhead surcharge** (e.g., TX +20%, zero when labor non-billable); free B&W page allowance then duplication (bw/color/oversized bands); request-level floor/ceiling, de-minimis, deposit, notify thresholds. **purposeOverrides** layer standard vs **commercial** additively (labor becomes chargeable + surcharge). Waiver = compute-then-waive (Domain 4 spec §9). Three state profiles loaded; **TX verified against § 552.2615 / § 552.263** (50% deposit figure is agency policy, not statute). **Certification intake→engine wiring `[BUILT]`:** the requestor's intake opt-in (`requests.certification_requested`) now defaults `certification.count` on estimate + reconcile (one per priced component — `per_record` unit; an MRR master certifies each child), so a requested certification is never silently dropped from the estimate. The estimate panel surfaces the opt-in (`GET /fee-estimates/request/:id` → `certification.{requested,suggestedCount,rate,unit}`) and lets staff override the count (including `{count:0}` to remove it); an explicit body block always wins over the intake default. Priced only where the active FR profile sets a non-zero `certification.rate` (the loaded TX example is 0).

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

## 9. Known gaps
- Estimate profiles unpopulated (see §2) — automation path exists but never fires.
- Commercial intake capture `[NOT BUILT]` + approval `[DEFERRED]` — Domain 1 spec §5.
- Fee-waiver approval task routing `[NOT BUILT]` — Tasks spec §11.1.
- Variant-level profiles blocked on taxonomy decision (Domain 3 §5).
