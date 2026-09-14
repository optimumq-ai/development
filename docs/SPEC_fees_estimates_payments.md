# Consolidated Spec — Domain 6: Fees, Estimates & Payments (deep pass)
**Current design only.** Verified against code + DB on 2026-07-08. Complements SPEC_tasks_roles_mrr_fees (intake capture, waiver gate, Finance role).
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DEFERRED]`

## 1. Fee engine `[BUILT]`
Computes an estimate from INPUT quantities + a jurisdiction **fee profile** (`fee_profiles`, versioned, per-jurisdiction, context 'FR'). Mechanics: graduated **rate bands** (tiered pricing incl. free tiers); per-request **free labor hours** consumed in order search → review → programming, then increment-rounded (up/down/nearest) and priced; **labor billability gates** (hard non-billable states CA/NY/OH; all-or-nothing triggers — TX no labor until >50 pages, FL/NY hours thresholds); **labor overhead surcharge** (e.g., TX +20%, zero when labor non-billable); free B&W page allowance then duplication (bw/color/oversized bands); request-level floor/ceiling, de-minimis, deposit, notify thresholds. **purposeOverrides** layer standard vs **commercial** additively (labor becomes chargeable + surcharge). Waiver = compute-then-waive (Domain 4 spec §9). Three state profiles loaded; **TX verified against § 552.2615 / § 552.263** (50% deposit figure is agency policy, not statute). **Certification intake→engine wiring `[BUILT]`:** the requestor's intake opt-in (`requests.certification_requested`) now defaults `certification.count` on estimate + reconcile (one per priced component — `per_record` unit; an MRR master certifies each child), so a requested certification is never silently dropped from the estimate. The estimate panel surfaces the opt-in (`GET /fee-estimates/request/:id` → `certification.{requested,suggestedCount,rate,unit}`) and lets staff override the count (including `{count:0}` to remove it); an explicit body block always wins over the intake default. Priced only where the active FR profile sets a non-zero `certification.rate`. **Verified: TX PIA cost rules (1 TAC §70.3) authorize NO certification fee** — it is not a chargeable category — so the loaded TX profile is set to **`rate:0`** (legally accurate; no certification line on TX estimates). A city that charges to certify specific documents under separate statute would set its own figure. The intake→engine wiring still feeds `certification.count` regardless of rate; pricing appears on any profile with a non-zero cert rate. **Extra costs `[CHANGED 2026-09-14]`:** `request.other` is a LIST of `{description, amount}` (a lone object — every estimate saved before this date — is still accepted, so a stored `input_json` re-prices identically); `requestLevel.other` is the list (null when none), `otherSubtotal` the sum; the notice prints each line; both the estimate panel and the Test tab enter them as rows. **Config figures typed with a unit** ("5%", "$3", "30 days") are normalised to their number at `feeLaw.decide` (text with no figure on a numeric item is refused by name), coerced again at `compose`, and the engine's `num()` strips `$ , %` — so a schedule approved BEFORE the fix (live TX v3 carried `surchargePct: "5%"` and `deposit.percent: "50%"`, which `Number()` read as NaN → 0: no commercial surcharge, no deposit) now prices correctly without re-approval.

**Statutory bounds gate `[BUILT 2026-08-21; verify_fee_bounds]`:** every fee-profile save is checked against what state law allows. Data: `src/data/state_fee_bounds.json` — 32 states × 35 fee items, generated from the verified fee layer (`docs/rules_research/alignment/fee_master_list.json`, 1,120 verified cells, 0 refuted) by `scripts/gen_state_fee_bounds.js`; regenerate after any master-list change. `feeBounds.check(config, stateCode)` enforces numeric ceilings, floors and statute-set figures (**fixed = authorization ceiling**: a city may charge less than the statutory figure, never more); graduated duplication tiers are checked band-by-band so a lawful base rate cannot smuggle an unlawful band; `actual_cost`/`silent`/non-numeric bounds display but do not gate. `POST`/`PUT /api/fee-profiles` refuse a violating config **422** with per-path violations (plain language + citation) — the same gate covers hand edits, the fees composer, and AI-extracted values; a name/status-only PUT is not gated. `GET /api/fee-profiles/bounds` (optional `jurisdiction_id`, defaults to the active jurisdiction) serves the display copy the config screens show beside each input.

## 2. Estimate profiles & the automated/manual decision `[BUILT — SEEDED 2026-07-14, Tier 1 #3]`
`record_type_estimate_profiles` stores generating inputs (quantities/stats/sample_size/expert seed). `estimateProfile.assess(recordTypeId)` is THE decision node: returns **automated** (profile confident + active jurisdiction fee config → priced total + deposit) or **manual** with reasons/drivers. Drives the estimate task title ("Review auto-generated estimate" vs "Create estimate") and prefills the estimate panel.

**The ten expert seeds are in** (`scripts/estimateProfiles.seed.js`, seeded through the real `PUT /api/estimate-profiles/:id` path, carried in `seed_fixture.sql`, locked by `verify_estimate_profiles` (15)). Police block first — incident reports · crash reports · arrest/booking · citations · CAD logs · 911 audio · body-worn video — then building permits (Kevin's own §7d worked example) · council minutes · official email. **All ten now assess AUTOMATED.** Before this, every estimate in the system was manual and the whole automation path — confidence ladder, dollar bound, panel prefill, historical write-back — was built and unreachable. **Verified end-to-end on live `2026-000048`:** a real public submission for a building permit spawned an estimate task titled *"Review auto-generated estimate."*

> **⚠ PROVENANCE — the seeds are PROVISIONAL.** `seedProfile` stamps `source='human-expert'`; **the expert was not a records clerk.** They are plausible defaults derived from the record types' own definitions and §7d, and each profile's `notes` says so verbatim (`verify_estimate_profiles` test D holds that admission in place). **A city's clerk should confirm them** — ten numbers, reviewed once. The historical write-back (`recordActuals`) corrects them over time regardless, and §7f's safeguards stand: a profile is a **default**, overridable per request and reconciled against actuals at delivery.

> **Not a blank cheque:** `assess()` still routes anything over **$200** to a human regardless of confidence, and a record type with **no** profile is still manual. `rt-official-email` is the weakest seed of the ten **by design** — email volume is request-dependent, and §7 names it the type that wants a **scoping search** (hit count × avg pages), not a fixed seed.

## 3. Payment timing: gates & bands `[BUILT]`
`paymentTiming` decides WHAT is collected WHEN and what it gates. Four gates: `invoice_on_completion`, `estimate_acceptance`, `deposit_before_work`, `pay_in_full_before_release`. Band selection by estimate total (first band whose upTo ≥ total). `gateToStage` maps a gate to the next stage; safety rule: a request that required a deposit never regresses out of `awaiting_payment`.

## 4. Estimate lifecycle `[BUILT]`
Create/version snapshots (`request_fee_estimates`) → **send notice** (feeNotice; marks the estimate task done) → requestor **accept** (→ awaiting_payment if deposit due, else record_search + task spawn) / **decline** → **deposit/payment record** (clears awaiting_payment → record_search + task spawn) → **final payment** → **reconcile** (actuals vs estimate) → **adjustment** + adjustment notice → **reopen**. ~~MRR-aware fee aggregation across children exists.~~

> ⛔ **"MRR-aware fee aggregation across children exists" is FALSE** `[corrected 2026-07-19]`. There is **no
> aggregation across children at all**. All 17 `/fee-estimates/request/:requestId` endpoints use the id they
> are handed with zero parent resolution, and every UI path hands them a **child** — `EstimateTaskPage` passes
> `task.request_id`, and tasks hang off children. A 3-child request therefore produces **three independent
> money pots and a parent that owns none**: three estimates, three deposit ledgers, three payment states, and
> no request-level total to bill the citizen for.
>
> **Verified consequence, not a theoretical one:** `feeNonpayment.sweep()` is parent-scoped (deliberately —
> unscoped it would send citizens duplicate dunning emails), then skips on `!sit.hasEstimate`. Since the money
> is on the child, **dunning and non-payment auto-close are inert for every wrapped request.** Reproduction:
> `backend/tests/verify_nonpayment_scope.js` (not registered in the suite — it fails today by design; it is
> the regression test for the fix).
>
> Note the honest statement two paragraphs below, in §4a: labor rollup is *"**Request-level only** (per-component
> / MRR-child attribution deferred to #11)"*. **#11 shipped 2026-07-16 and this was never revisited.**
> `SPEC_parent_child_lifecycle.md` §4.3 places money at the parent and §6.4 says why — *"children contribute
> **quantities**… the parent applies the fee waiver, minimums, deposit and certification **once**. A child is a
> unit of *work*, never a unit of *billing*."* Closing this gap is gated on the MRR hub (§14.3): how n children's
> fees roll up into one citizen bill is the same question. See `WORKING_attribute_inventory.md` Part A5.

### 4a. Measured-labor reconciliation `[BUILT]` (Slice E)
The ACTUAL labor hours fed to `/reconcile` are no longer typed by hand — Slice D's per-task active-work timer (`tasks.work_seconds`, finalized per task) now flows into the estimate→actual reconciliation. `services/laborActuals.js` is the bridge:
- **Rollup** (`rollup(requestId)`): sums FINALIZED `work_seconds` across a request's billable work tasks and maps task type → fee labor driver — `record_search`→**search**; `redaction`/`legal_redaction`/`redaction_qa`/`legal_review`→**review** (the review/redaction family); everything else is non-billable and contributes no hours (nothing maps to **programming** — no routed task type produces it). Converts to hours. ~~**Request-level only** (per-component / MRR-child attribution deferred to #11: aggregate lands on the first component, so the request-LEVEL total is correct since the engine re-aggregates labor there).~~
  > ⚠️ **CORRECTED 2026-07-19.** #11 shipped 2026-07-16, and "aggregate lands on the first component" describes
  > a component model that no longer exists. **Verified:** `rollup()` is `SELECT … FROM tasks WHERE request_id = ?`
  > with **no parent/child scoping**, and its only caller passes a **child** id. For **n = 1** the rollup is
  > correct (the one child holds every task). For an **MRR** it is **per child, with no parent aggregation** —
  > a parent id returns zeros, because parents have no tasks. Same root cause and same fix as the money split
  > above: §6.4 — *children contribute quantities, the parent bills once.* **Tolerates NULL `work_seconds`** — a task whose capture was *off* or was *skipped* (Slice E · Fork 1) contributes zero and is reported as *excluded*, never assumed; `hasActuals=false` ⇒ fall back to the manual path, never reconcile fabricated zeros.
- **Auto-draft trigger** (Fork 2): when a request's **last billable work task** finalizes AND a prior estimate + measured actuals exist, a `kind='reconciliation'` DRAFT is auto-computed (measured labor overlaid on the estimate's quoted quantities; non-labor page counts carried forward as-quoted). The revised-notice **SEND stays human-gated** exactly as via `feeReissue` — the auto step only computes/stages (`created_by` marked `… (auto-draft)`, `notified_at` NULL), never notifies the requestor and never folds actuals into the record-type profiles (Welford) — that belongs to the staff-confirmed manual reconcile. Fired non-fatally from `POST /tasks/:id/work/finalize`.
- **Shared writer**: both the manual `/reconcile` route and the auto-draft go through one `laborActuals.writeReconciliation()` so the snapshot shape + variance/renotify math never drift.
- **Readout**: `GET /fee-estimates/request/:id` returns a `laborActuals` block (measured vs estimated hours per driver, counted/excluded tasks, and an `autoDraft` flag when a draft awaits review); `FeeEstimatePanel` renders labor estimate-vs-actual and a *Use measured hours* button (no new screen — UI rule).

## 5. Payment modes & settlement `[BUILT]`
Two modes: local **cash drawer** (CashDrawerPage) and **ERP settlement** — emit charge to ERP, track locally, ERP calls back `payment-applied` (webhook, no auth) which clears awaiting_payment and spawns the search task. Charge history per request.

## 6. Nonpayment & release gate `[BUILT]`
- **feeNonpayment**: OPT-IN per jurisdiction auto-close for COMPLETION-phase unpaid states (awaiting_final / released_payment_due) — one dunning reminder at reminderDays, then close; complements the tickler's pre-work lapse coverage.
- **feeRelease**: read-only release gate — resolves plan + balance, reports whether records may release; consumed by stage-advance; **fails open** so a gate fault can't block unrelated transitions.

## 7. Objections `[BUILT]`
Requestor objection to fees: filed per request with **source** (letter/email/phone/in_person) + **evidence required** (file or typed recap) + reason. Resolution proposals priced against the active fee profile; **approval gate** = FEE_WAIVER_APPROVER (→ Finance role per rename decision); escalation path resolves a SUPERVISOR/DEPT_MANAGER in the caller's department. Statuses: pending-approval → approved/resolved with audit (who/when).

## 8. Fee sandbox `[BUILT]`
Lives on Fee rules → **Test an estimate** (`/setup/fee-law?tab=test`; `POST /fee-law/preview` → `feeSandbox.previewWith` → the SAME `feeEngine.compute` + `feeNotice.buildNotice` a real estimate uses; nothing is saved). **Since 2026-09-14 (Kevin's 2026-09-13 markup) the result shown IS the requestor's notice** — the staff computation card and its "show the notice" button are gone; a badge says whether it priced against the approved vN or the unapproved draft, and "Fee waived" reads through to the notice as a granted waiver does. Inputs: the six quantities, delivery, **purpose (Standard · Commercial** — the former "Inspection only" choice was removed: no inspection concept exists in code or spec, §9), **records certified** (count × the certified copy charge, `per_record`; it does not multiply the copies — the copy-set reading is Kevin's open question, §9), **extra costs as a list** of description + amount (each its own line on the notice), fee waived. Outcome buttons "It behaves correctly / Something is off" → `POST /onboarding/fees/test-result`. `verify_fee_law` C5–C9.

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
- **Inspection requests `[NOT BUILT — future enhancement]`** (Kevin 2026-09-13): nothing in code or spec models a request to INSPECT rather than copy. Wanted: log an inspection request internally (walk-in or email), mark it as inspection with what is to be inspected, schedule the inspection. Fees: Texas allows personnel-time charges on inspection only in narrow cases (§ 552.271), so $0 is the usual outcome, not a rule — research before encoding. The "Inspection" purpose choices on the Test tab and the estimate panel were removed 2026-09-14: they priced at standard rates under an "Inspection (no fee)" label.
- **Certification wording — Kevin's call pending** (2026-09-13): the engine charges `certification.count × certification.rate`, one per record certified (`per_record`). Kevin reads "3 certified copies" of a 100-page request as three full copy SETS (300 pages, each set certified). The field is now labelled "Records certified" with that meaning spelled out; whether to add a copy-set multiplier (pages × sets, certification per set) awaits his answer.


## 2a. Staff-entered actual amounts on 'actual'-rated lines `[BUILT 2026-08-26; verify_actual_amounts]`
A fee-schedule rate of `actual` (specialty reproduction, postage, USB media, any copy rate a state prices at
actual cost) makes the engine emit the line at **$0 with `needsActual`** and flag the component
`hasUnpricedActuals` (release checks it). Kevin's rule (2026-08-26): such an item is **blank on the schedule and
priced by a human on the estimate**, then corrected to the true actual at reconciliation. Mechanism:
`request.actualAmounts = { dup_bw | dup_color | dup_oversized | 'media:<type>' | delivery : dollars }` —
the entered figure lands on the request-level line (where subtotals are priced), is **pro-rated across the
components' matching lines by quantity** (so per-record allocation, revenue-by-department and ERP line items see a
real price), and clears `needsActual`. A blank/non-numeric entry, or a key for a line that is not `actual`,
changes nothing. `POST /fee-estimates/request/:id` and `/reconcile` pass it through and it persists in the
snapshot's `input_json`; `FeeEstimatePanel` renders an amber "Actual-cost items" box under the itemized
estimate with one `$ actual` input per such line (estimate-time best figure; true actual at reconcile).
Not built: a default-for-estimate postage figure (would need `delivery.mail` to carry both a default and 'actual').
