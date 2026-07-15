# Consolidated Spec — Domain 6: Fees, Estimates & Payments (deep pass)
**Current design only.** Verified against code + DB on 2026-07-08. Complements SPEC_tasks_roles_mrr_fees (intake capture, waiver gate, Finance role).
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DEFERRED]`

## 1. Fee engine `[BUILT]`
Computes an estimate from INPUT quantities + a jurisdiction **fee profile** (`fee_profiles`, versioned, per-jurisdiction, context 'FR'). Mechanics: graduated **rate bands** (tiered pricing incl. free tiers); per-request **free labor hours** consumed in order search → review → programming, then increment-rounded (up/down/nearest) and priced; **labor billability gates** (hard non-billable states CA/NY/OH; all-or-nothing triggers — TX no labor until >50 pages, FL/NY hours thresholds); **labor overhead surcharge** (e.g., TX +20%, zero when labor non-billable); free B&W page allowance then duplication (bw/color/oversized bands); request-level floor/ceiling, de-minimis, deposit, notify thresholds. **purposeOverrides** layer standard vs **commercial** additively (labor becomes chargeable + surcharge). Waiver = compute-then-waive (Domain 4 spec §9). Three state profiles loaded; **TX verified against § 552.2615 / § 552.263** (50% deposit figure is agency policy, not statute). **Certification intake→engine wiring `[BUILT]`:** the requestor's intake opt-in (`requests.certification_requested`) now defaults `certification.count` on estimate + reconcile (one per priced component — `per_record` unit; an MRR master certifies each child), so a requested certification is never silently dropped from the estimate. The estimate panel surfaces the opt-in (`GET /fee-estimates/request/:id` → `certification.{requested,suggestedCount,rate,unit}`) and lets staff override the count (including `{count:0}` to remove it); an explicit body block always wins over the intake default. Priced only where the active FR profile sets a non-zero `certification.rate`. **Verified: TX PIA cost rules (1 TAC §70.3) authorize NO certification fee** — it is not a chargeable category — so the loaded TX profile is set to **`rate:0`** (legally accurate; no certification line on TX estimates). A city that charges to certify specific documents under separate statute would set its own figure. The intake→engine wiring still feeds `certification.count` regardless of rate; pricing appears on any profile with a non-zero cert rate.

## 2. Estimate profiles & the automated/manual decision `[BUILT — SEEDED 2026-07-14, Tier 1 #3]`
`record_type_estimate_profiles` stores generating inputs (quantities/stats/sample_size/expert seed). `estimateProfile.assess(recordTypeId)` is THE decision node: returns **automated** (profile confident + active jurisdiction fee config → priced total + deposit) or **manual** with reasons/drivers. Drives the estimate task title ("Review auto-generated estimate" vs "Create estimate") and prefills the estimate panel.

**The ten expert seeds are in** (`scripts/estimateProfiles.seed.js`, seeded through the real `PUT /api/estimate-profiles/:id` path, carried in `seed_fixture.sql`, locked by `verify_estimate_profiles` (15)). Police block first — incident reports · crash reports · arrest/booking · citations · CAD logs · 911 audio · body-worn video — then building permits (Kevin's own §7d worked example) · council minutes · official email. **All ten now assess AUTOMATED.** Before this, every estimate in the system was manual and the whole automation path — confidence ladder, dollar bound, panel prefill, historical write-back — was built and unreachable. **Verified end-to-end on live `2026-000048`:** a real public submission for a building permit spawned an estimate task titled *"Review auto-generated estimate."*

> **⚠ PROVENANCE — the seeds are PROVISIONAL.** `seedProfile` stamps `source='human-expert'`; **the expert was not a records clerk.** They are plausible defaults derived from the record types' own definitions and §7d, and each profile's `notes` says so verbatim (`verify_estimate_profiles` test D holds that admission in place). **A city's clerk should confirm them** — ten numbers, reviewed once. The historical write-back (`recordActuals`) corrects them over time regardless, and §7f's safeguards stand: a profile is a **default**, overridable per request and reconciled against actuals at delivery.

> **Not a blank cheque:** `assess()` still routes anything over **$200** to a human regardless of confidence, and a record type with **no** profile is still manual. `rt-official-email` is the weakest seed of the ten **by design** — email volume is request-dependent, and §7 names it the type that wants a **scoping search** (hit count × avg pages), not a fixed seed.

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

## 8b. THE 50-PAGE LABOR BAR + OVERHEAD — § 552.261(a), 1 TAC § 70.3(e) `[FIXED + VERIFIED 2026-07-14]`

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
label that implies a human validated it. Locked by **`verify_fee_labor_gate` (29)** — the **config** is now
the thing under test, so a reseed from an old script or a copied config for a new city goes RED, not live.

### Primary-source verification — deep-research pass, 2026-07-14

Every value below was verified **3-0** against primary sources (1 TAC § 70.3, Tex. Gov't Code Ch. 552, the AG
Public Information Handbook) by an adversarial 3-verifier-per-claim research pass. **Rates confirmed current**
(1 TAC § 70.3, last amended eff. 2007-02-22, no later amendment): **$0.10**/page, **$15/hr** general labor
(§ 70.3(d)(1) — locate/compile/manipulate/reproduce), **$28.50/hr** for **programming services only**
(§ 70.3(c)(1) — *do not bill general IT time at this rate*). The statute itself sets **no** dollar figures
(§ 552.262 delegates them to the AG); a city may charge **less**, may not exceed **125%** of the AG amount
absent exemption, and may never exceed **actual cost** (§ 552.262).

**THE BAR IS PAPER-ONLY — `paperOnly: true`** (Kevin, 2026-07-15; matches AG practice). The 50-page labor bar
applies to **paper deliveries** (`mail`/`pickup`); an **electronic** delivery (`email`, the portal default)
falls outside it and labor is chargeable, so a small emailed request now prices *labor + 20% overhead + copies*
(e.g. an 8-page incident report by email = **$14.30**, versus **$0.80** on paper).

> **This reverses the same-week protective `paperOnly: false`.** The 2026-07-14 primary-source research showed
> that false is **more protective than Texas practice requires**: the AG copies flow-chart routes electronic
> records straight to *"labor and overhead + cost of the medium"* with **no page-count gate**, and the AG's own
> worked examples charge $15/hr + 20% overhead on emailed/electronic requests — so scoping the bar to *every*
> method over-charged the **requester** relative to Texas, not the city. Kevin's call aligns the demo with AG
> practice. The one case the research left **genuinely unsettled** is a **small emailed PDF with no media
> (CD/DVD) cost** — no source blesses charging labor there (every AG electronic example ships on physical
> media), and the research's instruction was *do not resolve that doubt for city revenue.* A city that prefers
> the broader protective scope on that edge sets `paperOnly: false`; the mechanism stays in the engine for it.

**⚠ A PAGE BAR CANNOT BITE ON A REQUEST WITH NO PAGES** `[the trap the flip opened]`. Audio and video requests
have **zero** pages, and zero is *"50 or fewer"* — so the bar would have zeroed out labor on **the most
expensive records a city holds**, handing body-worn video (redaction runs *slower than real time*) over for
**free**. Caught the moment `paperOnly` flipped: the seeded profiles put **BWC at $67.50 and 911 audio at
$18.75, and both fell to $0.00.** § 552.261(a) exempts a request *"for 50 or fewer **pages** of paper records"* —
a body-cam request is not a request for pages at all, and Texas prices electronic records under separate rules
that **do** allow personnel time. **No pages, no page-bar** (`feeEngine.laborGate`; tests **G1–G4**). One page of
paper brings the bar straight back. With the bar now scoped to paper (`paperOnly: true`), this guard is
load-bearing for a **paper-delivered** no-page record — a body-cam clip burned to a DVD and mailed — where the
bar is in scope; the G tests exercise it on `mail` for exactly that reason.

### Overhead — VERIFIED and now SEEDED (`labor.overheadPct: 20`)

**§ 70.3(e)(3): overhead is 20% of the LABOR charge alone — never 20% of the total bill.** The engine already
computes it on the labor subtotal, so seeding the value was all that was needed. Two properties make it safe
(tests **H1–H5**):
- **§ 70.3(e)(2): no labor → no overhead.** Overhead *"shall not be made for requests for copies of 50 or fewer
  pages of standard paper records unless the request also qualifies for a labor charge."* Because the engine's
  overhead rides on the **gated** labor subtotal, the 50-page bar zeroes labor and overhead **together** — a 20%
  surcharge on a copies-only bill cannot happen by construction. A ≤50-page request pays **$0** overhead.
- **Opt-in (§ 70.3(e)(1)).** Seeding `20` asserts *this city recovers overhead* — an agency-policy posture, like
  the 50% deposit. A city that waives it sets `overheadPct: 0`. When elected, § 70.3 fixes it **at** 20% (not a
  dial-down ceiling; the authority to charge less lives in § 552.262).

Effect on the seeded profiles: audio/video and >50-page requests now carry overhead on their labor (**BWC
$67.50 → $81.00**, 911 audio **$18.75 → $22.50**); every copies-only request is unchanged at $0 labor / $0
overhead.

### The two exceptions — RESEARCHED, still UNBUILT (need a per-request assertion)

Now documented precisely; still not encoded, because each is a **per-request factual assertion with a recorded
basis**, not a config value — a design question. When either applies, the **full labor + overhead** charge
returns (both § 70.3(d) and § 70.3(e)(2) cross-reference § 552.261(a)(1)-(2)).
- **(1) "two or more separate buildings not physically connected"** — § 552.261(c) supplies only a **negative**
  test: a covered/open sidewalk, or an elevated/underground passageway, does **not** make buildings separate.
  **Burden is on the agency**, which the AG requires to furnish *"a simple map showing the location of the
  buildings"* (§ 552.269 cost-complaint process; **treble damages** for a bad-faith overcharge).
- **(2) "remote storage facility"** — § 70.3(g): with a commercial storage company, recover **only** the
  company's locate/retrieve/deliver/return fee; **no** added labor for the company's retrieval. Own-staff search
  **after** delivery gets ordinary $15/hr.

*(`_verified` stamps on the config record the same provenance.)*

## 9. Known gaps
- **`paperOnly: true` — RESOLVED** (§8b): the bar is scoped to paper, matching AG practice (which charges labor
  on electronic requests). The one edge the research left unsettled — a small emailed PDF with **no media cost** —
  is now priced with labor under this setting; a city that prefers the protective reading there sets `paperOnly:
  false`. Counsel may still weigh that single edge, but the demo default now follows Texas practice.
- **The two § 552.261(a) exceptions are researched but UNBUILT** (§8b) — each needs a per-request assertion with
  a recorded basis (the AG demands a building map for exception 1). Design work, not a config value.
- **Overhead** (§8b) — **RESOLVED**: verified 20%-of-labor, seeded, safe on ≤50-page requests by construction.
- Commercial intake capture `[NOT BUILT]` + approval `[DEFERRED]` — Domain 1 spec §5.
- Fee-waiver approval task routing `[NOT BUILT]` — Tasks spec §11.1.
- Variant-level profiles blocked on taxonomy decision (Domain 3 §5).
