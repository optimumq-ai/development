# Estimate / Payment-Amount / Timing — Variable Map (English, pre-code)

**Purpose.** One exhaustive, sorted, nested list of every variable that comes into play when the engine decides *whether an estimate is required, what it costs, what must be collected, in what form, what that gates, and how the clock reacts* — in plain English, before any code. This is (a) the design spine we mark up together, and (b) the backbone of the next research brief: each variable becomes a question the AI tools answer per city/state.

**How to read the tags.**
- `[STAT]` = set by statute/AG opinion → lives on the **jurisdiction profile** (seeded per state).
- `[POLICY]` = an **agency choice** within the statutory floor → agency-override config.
- `[TX ✓]` = value verified against Texas primary sources (§ 552.2615, § 552.263, AG cost summary).
- `[GAP]` = we do not yet have this; research target.
- `[COMM?]` = we must check whether **commercial** changes this (most layers are unknown).
- `[BUILT]` / `[PARTIAL]` / `[NOT BUILT]` = current code status.

---

## 1. Context variables (the "who/what" that conditions everything below)

- **1.1 Jurisdiction** `[STAT]` — state selects the statutory profile (thresholds, deposit rules, timing, deadlines). `[BUILT: jurisdiction_profiles]`
- **1.2 Agency attributes**
  - FTE size: **> 15 vs < 16 full-time employees** — sets the Texas deposit threshold ($100 vs $50). `[TX ✓] [POLICY]` (agency states its size) `[NOT BUILT: no FTE field]`
  - Financial integration mode: internal ledger vs ERP/accounting export. `[POLICY] [GAP]`
- **1.3 Requestor attributes**
  - **Purpose / rate class: standard vs COMMERCIAL** (vs other purposes some states define). `[POLICY per jurisdiction] [NOT CAPTURED at intake] [COMM? everywhere below]`
  - Fee-waiver status (requested / granted). `[BUILT: fee_waiver_requested]`
  - **Delinquency: unpaid amounts from prior requests** (Texas: > $100 triggers a deposit/bond option). `[TX ✓] [GAP: not tracked]`
- **1.4 Record-type attributes**
  - Always-free type → short-circuit to $0. `[POLICY] [GAP]`
  - Estimate method (expert seed / sampled average / historical actuals / scoping / manual). `[PARTIAL: record_type_estimate_profiles exists, empty]`
  - Possibility of **no responsive records** (drives the no-record outcome, §8). `[GAP]`

---

## 2. Is an estimate required — and when

- **2.1 Trigger threshold** — the $ amount above which an estimate must be provided. Varies widely:
  - Texas: banded — none ≤ $40; required > $40. `[TX ✓ STAT]`
  - Georgia > $25; Virginia on request; federal essentially only when prepayment sought. `[GAP: verify each]`
- **2.2 Timing** — before work / on request only / only when prepayment sought. `[TX ✓: before work for > $40] [GAP others]`
- **2.3 Required notice content** — what the estimate letter must say (itemization, methodology disclosure, response deadline). `[TX: itemized statement required] [GAP: exact wording per state]`
- **2.4 `[COMM?]`** Does commercial change the estimate threshold or notice? Unknown — research.

---

## 3. The amount (fee calculation) — *the existing engine; referenced, not re-derived*

The dollar computation already exists in `feeEngine.compute()`. Listed here only so the map is complete and so we can ask "does commercial change each line?"

- **3.1 Quantity inputs**, projected (estimate) vs actual (final) — *same engine, different numbers*. `[BUILT]`
- **3.2 Components**: labor (search / review / programming hrs), duplication (B&W / color / oversized pages), media, **A/V recordings** (per-recording + per-minute), delivery, certification, one-off "other/extra". `[BUILT]`
- **3.3 Free allowances**: free pages, free labor hours. `[BUILT] [COMM?]`
- **3.4 Floor (minimum fee) / Ceiling (maximum fee)**. `[BUILT] [COMM? — cities may set different min/max for commercial]`
- **3.5 De-minimis waive** (tiny totals → $0). `[BUILT]`
- **3.6 Labor overhead surcharge** (e.g., TX +20% of billable labor). `[BUILT]`
- **3.7 Commercial pricing** — **engine supports a full alternate schedule via `purposeOverrides`** (different rates, labor becomes billable, different min/max) **plus** a simpler `surchargePct`. `[ENGINE BUILT] [CONFIG EMPTY: no city populated] [UI PARTIAL: page exposes only surcharge % + labor toggle + free-inspection, not a full commercial schedule]`
  - **Open decision:** if research shows cities use fully different commercial rates/caps → build the **separate commercial policy view** (Standard | Commercial), full schedule each; calculator gains a "preview as standard/commercial" switch (no engine rebuild).
- **3.8 Billable search** — whether search/review time is chargeable at all; varies by state and by commercial (federal: commercial pays search/review/dup; many states limit). `[GAP: encode per state] [COMM? yes in several]`
- **3.9 Granularity & rounding** — labor unit (hour/½/¼/minute), page counting (per sheet vs per side), money rounding; may differ estimate vs actual. `[GAP: expose as config]`
- **3.10 Is the scoping/estimate search itself billable?** `[GAP]`

---

## 4. Advance payment — deposit / bond

- **4.1 Eligibility threshold** — Texas: estimate > $100 (> 15 FTE) or > $50 (< 16 FTE), **and** the itemized statement was provided. `[TX ✓ STAT]` Others differ (MI > $50, PA > $100, VA > $200, GA prepay > $500, federal > $250/prior-nonpayment). `[GAP: verify]`
- **4.2 Amount rule** — none / flat / **% of estimate** / **up-to-anticipated-cost** / tiered. Texas: up to full anticipated cost, **no statutory % cap**; the 50% in our config is `[POLICY]`, not law. Michigan caps at 50% `[STAT]`. `[ENGINE: deposit threshold+percent BUILT; tiered NOT BUILT]`
- **4.3 Form** — **cash deposit OR bond** (Texas accepts a bond). `[TX ✓] [NOT BUILT: bond option]`
- **4.4 Preconditions** — itemized statement first (TX); documentation duty (TX d: must document anticipated costs, and that documentation is publicly disclosable). `[TX ✓] [GAP: documentation artifact]`
- **4.5 Refundability** — refund if actual < estimate? credit? keep as floor? `[POLICY] [links to §7]`
- **4.6 `[COMM?]`** Do deposit thresholds/amounts differ for commercial? Unknown — research.

---

## 5. Collection timing & release gating (per estimate band)

*What has to happen before work begins and before records are released.*

- **5.1 Gate type** (by band): **nothing** (invoice on completion — records may ship before payment) / **estimate acceptance** (requestor must agree, no money up front) / **deposit-or-bond before processing**.
  - Texas: ≤ $40 → invoice on completion; $40–$100 → estimate acceptance, no deposit; > $100 → estimate + optional deposit/bond. `[TX ✓ STAT]`
- **5.2 Records-before-payment?** — for invoice-on-completion, records go out and the requestor is billed; for deposit bands, work is gated on payment. **Final payment before release** of the last records? `[POLICY] [GAP: state variation]`
- **5.3 `[COMM?]`** Does commercial change what gates work/release? Unknown — research.

---

## 6. Deadline / clock effects

- **6.1 Deposit shifts the "received" date** — Texas: when a deposit/bond is required, the request is considered received on the date it arrives (§ 552.263(e)). `[TX ✓ STAT] [PARTIAL: awaiting_payment stage exists; clock-reset not wired]`
- **6.2 Response / acceptance window** — Texas: **10 business days** to accept the estimate / pay the deposit or the request is **withdrawn by operation of law** (§ 552.263(f)). `[TX ✓ STAT] [GAP: enforce]`
- **6.3 Estimate validity / expiration** — does the estimate expire; how long to pay before abandonment/closure. `[POLICY] [GAP]`
- **6.4 Modified request = new request** — Texas: a request modified in response to a deposit demand is a separate request, received on the modification date (§ 552.263(e-1)). `[TX ✓ STAT] [GAP]`

---

## 7. Reconciliation (actual vs estimate)

There is **no legal margin-of-error**; the safety net is reconcile-to-actual.

- **7.1 Actual > estimate** — agency absorbs / bill the difference on delivery / pause and re-consent before continuing; large increases typically force **re-acknowledgement**. `[POLICY] [GAP: wire]`
- **7.2 Actual < estimate** — refund overpayment / credit / keep deposit if below a minimum. `[POLICY]`
- **7.3 Estimate and final run the SAME engine** — only projected-vs-actual quantities differ; deposit keys off the estimate, invoice off the final. `[design principle]`

---

## 8. Special triggers & billable outcomes

- **8.1 Delinquent requestor** — Texas: prior unpaid > $100 → may require deposit/bond before a new copy; agency may not pursue the debt by other means (§ 552.263(c)). `[TX ✓] [GAP]`
- **8.2 No down-payment for future requests** — Texas § 552.263(b). `[TX ✓]`
- **8.3 No-record-located certification fee** — **NEW class: a billable *outcome*, not a copy cost.** New Orleans issues a signed certification that *no record exists*, with a fee — even though nothing is produced. Interacts oddly with estimates (no copy quantities to estimate) and timing. `[GAP — model as its own outcome] [COMM?]`
- **8.4 Documentation duty** — see 4.4 (TX d). `[TX ✓]`
- **8.5 Always-free record types** → $0 short-circuit. `[POLICY] [GAP]`

---

## 9. Cross-cutting: layer + provenance (applies to *every* variable above)

- **9.1 Layer** — `[STAT]` (jurisdiction, seeded) vs `[POLICY]` (agency override). The engine must resolve statutory floor + agency layer + record-type override.
- **9.2 Provenance / verification** — **verified against primary source** vs **unverified AI lead**. Texas is verified; all other states in the knowledge doc are unverified leads and must NOT be promoted to active config until confirmed. This flag rides with each value.

---

## 10. Outputs (what the engine emits per scenario — so the simulator and the requestor notice have a contract)

- Itemized amount (per component) + adjusted subtotal + surcharge + total.
- Applied-flags: floor / ceiling / de-minimis / commercial-applied.
- Deposit/bond: due amount + form + basis string.
- **Applicable timing rule** (plain-English band statement) + what gates work/release.
- Key dates: response-by, deposit-due-by, estimate-valid-until, and the effective "received" date.
- **Requestor-facing language** (band-specific) for the confirmation communication.
- Workflow stage the request should move to.

---

## Intake capture (the one real capture-side change)

Replace the detailed fee-waiver interrogation with **one combined eligibility question** (agent + form):
> "Do you qualify for either? ☐ Fee waiver *(brief: nonprofits, journalists, researchers, non-commercial public interest)* ☐ Commercial *(brief: requesting for a commercial/business purpose)*"
Sets `requestor_type` / `purpose`. Not mutually exclusive → two checkboxes, not pick-one. `[BUILT: waiver capture; NOT BUILT: commercial capture]`

---

## Current build status snapshot (fees/estimates/payment)

- **Engine** (`feeEngine.compute`): amounts, floor/ceiling, de-minimis, labor overhead, deposit amount, surcharge, `purposeOverrides` mechanism — **BUILT**.
- **Fee Config UI + live calculator** — **BUILT**; commercial exposed only as surcharge % + labor toggle (not a full commercial schedule).
- **Fee sandbox** (Setup → Fees, mandatory test gate) — **BUILT**.
- **Estimate lifecycle** (accept → awaiting_payment vs proceed; deposit record; paid/unpaid) — **BUILT (two-state)**.
- **Payment-timing rule layer** (bands, collection timing, clock effects, reconciliation, no-record outcome, commercial-as-rules) — **NOT BUILT** (this map is its spec).
- **Commercial**: engine can price it, **not configured anywhere, not captured at intake, rules don't key off it** — **the gap**.

---

## Open questions to resolve on this doc (mark up here)

1. Commercial: surcharge-only, or full separate schedule + separate policy view? (drives 3.7 UI build)
2. Do we model `[COMM?]` as a per-layer flag from the start, or add it once research says where it bites?
3. No-record certification (8.3): its own workflow outcome, or a special line item?
4. Deposit form: do we build the bond option now (4.3) or defer?
5. Which reconciliation behaviors (7.1/7.2) are mandatory per state vs agency choice — needs the research.

---

## State profile: LOUISIANA (state-level via Grok summary — LEAD, pending primary source + city policies)

**Source:** Grok summary of La. R.S. 44:32 (legis.la.gov), citing Act 247 of 2023. **AI pass — NOT primary-source-verified.** City fee-schedule policies pending (they supply the actual numbers).

**Structural finding — Louisiana is the inverse of Texas.** The state sets almost no specific numbers; it delegates fee-setting to the city under a "reasonable" standard. Nearly every amount/threshold variable is `[POLICY]` (city choice), bounded only by a reasonableness test + a few hard rules. This confirms the STAT-floor + POLICY-layer architecture and proves the **STAT/POLICY tag is per-(state x variable), not global.**

- **Inspection / review: FREE (hard rule).** No fee to examine records in business hours; no fee for initial disclosability review unless a court orders. `[STAT hard rule]` -> maps to the existing "on-site inspection free" toggle.
- **Copies: "reasonable" fees, city sets them** (incl. electronic + transmission). Must notify amount in advance; may require upfront payment. `[POLICY, reasonableness-bounded]`
- **Must post a public fee schedule (Act 247 of 2023)** if the city charges. `[STAT compliance obligation]` -> NEW dimension: a compliance requirement + platform feature opportunity (generate/publish the schedule).
- **Waivers/reductions:** indigent citizens OR public-purpose use. `[POLICY]` -> NEW dimension: waiver *basis* categories vary by state.
- **No statutory bands, no deposit-received clock rule, no tiers** in the state law. Collection timing is simply "notify in advance, upfront payment allowed." `[POLICY]`
- **Reasonableness standard, not hard caps:** fees can't hinder access; courts evaluate reasonableness. State agencies benchmark $0.25/page; cities vary. `[soft constraint]`
- **Commercial:** state law does not define a commercial rate class -> `[COMM?]` data point: commercial distinction is NOT universal.

**Dimensions Louisiana adds to the map (to integrate into sections above):**
- **Constraint type** (new property of every bounded variable): **hard-cap** (TX) / **reasonableness-standard** (LA) / **benchmark-only** (LA $0.25/pg) / **none**. Drives whether the config UI hard-limits, soft-warns, or free-sets a value.
- **Must-post-fee-schedule** compliance requirement (belongs in section 8).
- **Waiver-basis categories** (extends 1.3 / intake): indigent / public-purpose / non-commercial-public-interest / journalist / researcher / nonprofit — the SET varies by state.
- **STAT/POLICY is per-(state x variable)** — the resolver supports it; the map must not assume a variable's layer is fixed across states.

**Pending:** primary-source text of R.S. 44:32; the city fee-schedule policies (actual LA numbers).
