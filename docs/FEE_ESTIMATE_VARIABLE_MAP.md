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

---

## City profile: NEW ORLEANS (primary sources — municipal code text provided)

**Sources:** NOLA Municipal Code Art. V (Sec. 70-551..565, general city fees) + Sec. 90-123 (NOPD police report fee schedule), text provided by user. General public records copy fees live in **70-557** (NOT 70-564 — that section, "permit/license preparation fees," was repealed by Ord. 19,972 in 2000 and is reserved; any citation to 70-564 for record fees is stale). Police records carved out under 90-123 / 90-124.

**Big structural additions this document forces into the map:**

- **NEW: Fee-computation MODE (per record type / department).** Two modes:
  - **computed** — the labor + duplication engine (`feeEngine.compute`). `[BUILT]`
  - **fixed/tiered schedule** — a lookup table of item -> price (NOPD: offense report $25 for 1-10 pp then $1/pp; accident report $5 + $15 processing; photos $10/print; fingerprinting $25; computer printouts $150-$300 tiered by man-hours x file size; research study $100). `[NOT BUILT — engine only does computed]`
  - A record type/department selects its mode. Police-class records need the fixed-schedule mode; general records use the computed engine. **This is a core architectural addition.**
- **NEW: Per-item state-law override.** NOPD schedule: "if valid state law imposes a higher or lower maximum fee for any one of the items, the fee for that item shall be that state maximum." So the STAT/POLICY resolution is **per-line-item**, not one floor over the whole schedule. (Extends section 9.1.)
- **No-record fee (section 8.3) confirmed + refined:** it is a **flat, outcome-independent search fee** — "none found $5 / located $5." You pay for the search; the copy is incidental. For fixed-schedule record types the fee IS the search, not the copy.
- **Certification deliverables as line items:** e.g., "letter of good conduct for visa - $25" — a certification output priced as its own item (fits fixed-schedule mode).

**Smaller additions (integrate into existing sections):**
- **Delinquency / indebtedness gating (70-554):** 33-1/3% delinquency fee + 15% interest; applicant must certify under oath they owe the city nothing or **no service/permit/license issues**. Broader than Texas's requestor-specific trigger (section 8.1) — a general no-service-if-indebted rule.
- **Annual fee-schedule review (70-553):** departments submit a proposed schedule yearly, adjust for inflation, and **flag which fees are state-law-limited**. Dovetails with LA Act 247's must-post-schedule (compliance dimension).
- **Returned-check / payment-failure penalty (70-551):** greater of 1% or $15. (payment-failure dimension)
- **Payment-form constraints:** NOPD accepts cash and/or personal check; **no foreign checks or money orders**. -> add "accepted payment forms" as a policy field (also intake-relevant).
- **General copy fees (70-557):** documents $0.50/page; audio/video $30/copy; maps $0.40/sqft; various fixed code-copy prices. (LA city "reasonable fee" made concrete.)

**Provenance refinement (section 9.2):** "verified" must include **citation-currency** — is the cited ordinance section still in force, or repealed/renumbered? (70-564 is the cautionary example.)

**Comparison data point (Orleans Parish DA, via web):** pay-in-advance; **30 business days** to pay the estimated cost or the request must be resubmitted; no cost to view records (inspection free); "Notice of Estimated Costs" issued after a disclosability review. (Another LA collection-timing variant.)

---

## Data point: NEW ORLEANS OIG public-records fee schedule (compliance anti-pattern -> platform feature)

Source: NOLA OIG "Request for Records" page (user-provided). Fees: paper $0.50/pg; **electronic base fee $25**; delivery "additional... may apply"; **"Additional Fees: additional service fees may apply depending on the scope of the request."**

**Compliance observation (NOT legal advice):** the vague "additional service fees may apply" catch-all is in tension with LA Act 247 / R.S. 44:32(C)'s requirement to establish and post a **reasonable, definite fee schedule** — the mandate's purpose is advance predictability, which an open-ended "fees may apply" defeats. It is also harder to defend under LA's reasonableness standard (courts evaluate reasonableness). Whether it is a technical violation is an enforcement question; at minimum it is bad practice.

**Turned into a design principle + platform value:**
- **Schedule-definiteness (compliance principle):** the config model must NOT provide a vague "misc / catch-all fee" escape hatch. Every charge must be either a fixed amount or a **defined computed rule** (labor rate, per-page rate) — never "may apply depending on scope." Scope-dependent costs are expressed as a defined rule, not vague language.
- **Platform-as-compliance-tool (pitch):** forcing a definite, itemized, posted schedule is exactly what Act 247 requires -> configuring the platform drags the agency into compliance AND hardens their fees against reasonableness challenges. "We don't just calculate your fees, we make them legally defensible."
- **Base-fee-per-delivery-method** data point: OIG charges a flat $25 base for *electronic* delivery (itself reasonableness-questionable). Add "base fee per delivery method" as a config field (partially present in the delivery section).
- **Public-posting intake mode (tangent):** OIG posts requests publicly and auto-redacts SSN/DOB, rejects non-PRR and profane submissions. A distinct intake/publishing mode some agencies use; not core to fees but note it exists.

---

# ADDENDUM — 2026-07-01: multi-state sweep consolidation (ChatGPT batches 1 & 2)

**Provenance.** Every jurisdiction value below is `[LEAD — unverified]`: AI-collected (ChatGPT) *with* primary-source citations, NOT yet checked against primary text. Do not promote any value to active config until the cited source is confirmed. Verified profiles remain Texas (primary) and New Orleans (primary). Fuller extracts + URLs live in the two source PDFs retained by Kevin — batch 1: AL / AR / OK / NC / GA / PA / MI / ID; batch 2: SD / IA / NM / AZ / NV / VA / RI / OR / MO.

**Reconciliation with FEE_ESTIMATE_KNOWLEDGE.md.** These are new jurisdictions, distinct from Knowledge-doc research Pass 1 (ChatGPT 2026-06-11) and Pass 2 (Grok 2026-06-12), which were topic-level not city-level. Collection-timing (Knowledge §12K) and configurable-variants (§12) are *extended*, not duplicated, by sections C.1–C.2 below.

**Sweep verdict.** By batch 2 the returns were mostly repetition — the map's ten-section spine absorbed everything. That saturation is the signal we've captured the common variables. Net-new below: 4 structural dimensions (A), 3 watch-items promoted to common (B), and the 3 agreed design sections (C). One finding — Arizona commercial market-value basis (A.1) — has a genuine engine implication.

## A. New structural dimensions (not previously in the map)

### A.1 Commercial fee BASIS — cost-recovery vs market-value  `[extends §3.7] [ENGINE IMPLICATION]`
Arizona (ARS §39-121.03(A)) permits, for commercial-purpose requests, a charge combining (a) a portion of the cost of obtaining the original, (b) a reasonable time/materials/equipment/personnel fee, AND (c) **the value of the reproduction on the commercial market**.
- **This breaks the engine's foundational assumption that a fee is cost-recovery.** `purposeOverrides` can hold a different commercial *schedule* but cannot express *market-value* pricing. → confirms commercial belongs in its own policy view, and adds **fee basis** (cost-recovery | market-value) as a commercial config axis.
- Bundled: commercial-purpose **attestation/affidavit** at intake + **misuse liability** (ARS §39-121.03(C)). → extends §1.3 commercial capture and the combined intake eligibility question.

### A.2 Request-aggregation window  `[new — cross-cutting; touches §3.3 free allowances]`
Rhode Island (§38-2-4(b)): multiple requests from the same requester to the same body within **30 days** count as **one request** for search/retrieval fees (and the free first hour). Without it, free-tier allowances are gameable by splitting requests. New variable: aggregation window (days) × scope (same requester × same body).

### A.3 Attorney / legal-review labor — distinct component with a carve-out  `[extends §3.2 components]`
Oregon (ORS §192.324(4)(b)) and Iowa (§22.3): attorney time for **redaction/segregation** is billable, but attorney time spent **determining whether the records law applies** is NOT. → attorney-review is its own labor component with an explicit "legal-applicability determination" exclusion, separate from search/review.

### A.4 Cost-basis composition — what may enter the basis  `[extends §3.6 labor overhead]`
States both mandate and forbid specific inclusions:
- **Exclude** (IA §22.3; VA §2.2-3704(F)): employee benefits, depreciation, maintenance, electricity, insurance, general business/overhead costs.
- **Include, capped** (MI MCL 15.234): fringe-benefit add-on up to **50%** of labor if itemized; overtime generally excluded.
→ cost-basis composition is a per-jurisdiction allow/deny list, not a single overhead-% line.

## B. Reinforced dimensions — now common enough to be first-class

### B.1 Fee dispute / appeal / mediation path  `[NEW SECTION — was a §8 watch-item]`
A requester route to contest an estimate/fee: NC (§132-6.2) mediation by the State CIO; PA (RTKL) challenge via state OOR; SD (§1-27-38) civil action or administrative review of a fee estimate. We model none of this. Ties to TX documentation duty (§4.4): the estimate-basis artifact the platform generates IS the defense. New outputs: appeal info in the estimate notice + a preserved estimate-basis record.

### B.2 Burden / extraordinary-use trigger  `[extends §2 / §8 — new trigger TYPE]`
A fee-switch keyed to operational burden, not dollars or purpose: OK (51 O.S. §24A.5) search+copy chargeable if solely commercial OR would **clearly cause excessive disruption of essential functions**; NV (NRS §239.055) **extraordinary-use** fees. New trigger type alongside dollar-threshold and purpose.

### B.3 Agency-side deadline to ISSUE the estimate  `[new timing sub-variable — §6]`
GA (§50-18-71): estimate notice required within **3 business days**. Every other timing variable is requester-side; this is the agency's clock to *produce* the estimate.

## C. Agreed new sections (design decisions locked this session)

### C.1 Payment due-dates & terms — BOTH payments  `[NEW — consolidates scattered §6 + fills the second-payment gap]`
- **First payment (deposit / advance) due-by** = the acceptance/deposit window. TX 10 business days `[✓]`; VA 30 days; OR (Eugene) 60 days; RI tolled-pending-payment. Expiry → request withdrawn/closed by operation of law.
- **Second payment (final invoice) due-by & terms** = *was unmodeled.* Options seen: invoice-on-completion (records already shipped, bill after) vs due-before-release; net-period per agency. `[GAP — build as an explicit variable, both payments]`

### C.2 Delivery trigger — promoted to a first-class variable  `[was smeared across §5 / §6 / §7]`
The event that releases records — NOT universally "balance = 0":
- **pay_in_full_before_release** (no deposit stage): Birmingham ("do not pre-pay; released on full payment"), Henderson ("pay before receiving copy"), Eugene ("paid before retrieval begins").
- **deposit_before_work**, release on final settlement: VA (deposit if likely > $200, credited to final).
- **invoice_on_completion** (ship before payment): TX ≤ $40 band.
- **estimate_acceptance** only (no money up front): TX $40–$100 band.
→ per-jurisdiction enum { invoice_on_completion | estimate_acceptance | deposit_before_work | pay_in_full_before_release }.

## D. Jurisdiction leads (unverified; citation-carrying)  `[LEAD — verify before config]`

- **Alabama** — Ala. Code §36-12-41: "reasonable fee"; no uniform municipal schedule. *Birmingham:* paper $0.50/1-side, $0.75/2-side, B&W only; electronic $8/media unit + $0.10/pg; certified +$5; **no prepayment — released on full payment after completion** (delivery-trigger case).
- **Arkansas** — §25-19-105(d)(3): actual repro cost, **personnel search/retrieval/review time excluded**; advance payment if est > **$25**; itemized breakdown; custodian bears exempt-separation cost. *Fayetteville:* no citywide schedule located; state $10 accident-report fee.
- **Oklahoma** — 51 O.S. §24A.5 (am. SB535 eff. 2025-11-01): copies ≤ **$0.25/pg** (≤ legal), certified ≤ $1/pg; search fee if **solely commercial** or **excessive disruption**; no search fee if public interest (media/scholars/taxpayers); advance payment if est > **$75** or prior unpaid; must-post schedule. *Tulsa:* EO 2024-08; Tulsa PD (Ord. 19224) $3 / ≤10 pg then $1/pg.
- **North Carolina** — §132-6.2: actual repro cost; special service charge for extensive IT/clerical; **fee-dispute mediation via State CIO**. *Charlotte:* no citywide schedule located.
- **Georgia** — O.C.G.A. §50-18-71(c)-(d): search/retrieval/redaction at lowest-paid capable FTE hourly, **first 15 min free**; copies ≤ **$0.10/pg**; **estimate notice within 3 business days**; prepay allowed if est > **$500**; prepay if prior unpaid. *Atlanta:* Office of Transparency mirrors state.
- **Pennsylvania** — 65 P.S. §67.1307 + OOR schedule: **no fee for access-determination review**; B&W ≤ $0.25 first 1,000 pp then ≤ $0.20 (**volume step-down**); color ≤ $0.50; certification ≤ $5; **redaction no fee**; challenge via state OOR. *Pittsburgh:* defers to OOR schedule.
- **Michigan** — MCL 15.234: labor at lowest-paid capable; paper ≤ **$0.10/sheet**; **fringe-benefit add-on ≤ 50%**, no overtime; **deposit ≤ 50% if est > $50**; **100% deposit** for subsequent requests when prior unpaid (statutory conditions: prior final ≤ 105% of est, delivered within timeframe, 90 days post-notice, no proof of payment; released at proof-of-payment or 365 days). *Dearborn:* mirrors — >$50 → ≤50% good-faith deposit; the 105% / 90-day / 365-day mechanics.
- **Idaho** — §74-102(10): **first 2 labor hours + first 100 pages free**; beyond → actual labor+copy at lowest-paid capable/attorney; advance payment allowed. *Boise:* free unless > 100 printed pages or > 2 hrs; pay estimate before work; top-up if over.
- **South Dakota** — SDCL §§1-27-1.2 / 35 / 36 / 38: actual retrieval/repro; specialized-service charge separate; **§1-27-38 = review of a fee estimate**. *Sioux Falls:* no citywide schedule located.
- **Iowa** — §22.3: actual cost only; supervision fee allowed; **benefits / depreciation / maintenance / electricity / insurance excluded**; legal-services cost only for redaction/review; IPIB guidance: communicate estimate on receipt, may require payment before retrieval. *Des Moines PD:* per-event, defers to state.
- **New Mexico** — NMSA §14-2-9: copies ≤ **$1.00/pg** (≤ 11×17); actual cost for disk/transmission; **no fee for electronically-produced records** (DOJ guidance: print $0.75/pg, CD/DVD $10/disc); may require advance before copies. *Albuquerque:* request page + fee-waiver form; no separate citywide schedule located.
- **Arizona** — ARS §§39-121.01 / .03: may require advance for mailed copies; **commercial = cost-portion + labor/materials + MARKET VALUE** (see A.1); commercial affidavit + misuse liability. *Mesa:* many records pre-posted online; no separate citywide schedule located. *(Mesa/AZ also in CITY_FEE_SURVEY; this adds state-code detail.)*
- **Nevada** — NRS ch. 239 (§239.052 fees, §239.055 **extraordinary-use**; NAC §239.864): estimate if actual cost > **$25**; deposit ≤ estimated actual cost; **payment before receiving copy** (delivery-trigger case). *Henderson:* City-Wide Public Records & Document Fee Schedule (Oct 2025); fees per NRS 239.055.
- **Virginia** — §2.2-3704(F)-(I): actual cost; **no overhead / general-cost recoupment**; must offer estimate on request; **response tolled during estimate pendency; withdrawn if no response in 30 days**; **deposit if likely > $200** (credited to final); may require payment of prior unpaid > 30 days. *Chesapeake:* mirrors (5-day clock excludes estimate-pendency; closed at 30 days).
- **Rhode Island** — §38-2-4: copies ≤ **$0.15/pg**; search/retrieval ≤ **$15/hr, first hour free**; **same-requester requests within 30 days = one request** (see A.2); estimate on request; itemization on request; court may waive for public interest. *Providence:* mirrors verbatim; tolling per §38-2-7(b).
- **Oregon** — ORS §§192.324 / .329: fees ≈ actual cost incl. summarizing/compiling/tailoring; **attorney redaction/segregation billable, law-applicability determination NOT** (see A.3); fee > **$25** requires written estimate + requester confirmation; waiver if public benefit. *Eugene:* ≤ 30 min free (Level 3); **paid before retrieval**; refund if under; **60 days to pay or request closed** (ORS 192.329(3)(b)).
- **Missouri** — RSMo §610.026: paper ≤ **$0.10/pg** (≤ 9×14); duplication time ≤ avg clerical hourly; **research at actual cost**; must staff to lowest total charge; estimate on request; waiver for public interest; electronic/media at cost + programming. *Springfield:* Sunshine page (403 to tool); SPS example ≤ $0.10/pg + reasonable search time, estimate by end of 3rd business day.

<!-- END ADDENDUM 2026-07-01 -->
