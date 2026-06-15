# Fee Estimate - Knowledge & Design Reference

**Status: WORKING REFERENCE (v0.1, 2026-06-10).** Captures design decisions and policy
PATTERNS for the *estimate* side of the fee engine. The specific dollar figures and statute
specifics below are illustrative - drawn from the uploaded Fee Engine document and general
knowledge - and MUST be verified against current primary sources in a dedicated web-research
pass before being relied on operationally. This file is the home for that research as gathered. See Section 13 for Research Pass 1 findings
(ChatGPT, 2026-06-11; citations specific but NOT yet independently verified).

---

## 1. The core conundrum: you must search to estimate

To estimate page counts and redaction labor for a request (e.g., "the Mayor's emails to Paul
Smith, Dec 2025"), staff normally must perform most of the search they are trying to estimate -
locating the records is what reveals how many pages exist and whether redaction is needed.
This is the central friction in FOIA fee estimation and the reason an estimate step exists at all.

## 2. The legal margin that makes it workable (VERIFY specifics per state)

- **Good-faith / reasonable estimate standard.** Most statutes require only a reasonable,
  good-faith estimate, not an exact one. Reasonable variance between estimate and final is
  expected and protected. This is the margin that makes automation safe.
- **Estimating by averages.** Many jurisdictions permit estimating volume using reasonable
  averages rather than exact counts, especially for large or repetitive productions. This is the
  legal basis for the sampling/historical-average automation in Section 7. (VERIFY exact
  statutory/AG language per target state before relying on it.)
- **Penalty for under-processing vs. over-estimate** differs by state; some reduce fees for late
  processing (e.g., Michigan's per-day reduction) - a penalty, not an estimate concern.

## 3. Estimate notification & consent thresholds (patterns)

A consent checkpoint (NOT a deposit): when the estimate exceeds a threshold, the agency must
notify the requestor and obtain acknowledgement/agreement before continuing.
- Georgia: estimate + agreement required when estimate > $25 (per uploaded doc).
- Some agencies: notify when > $50 (per uploaded doc).
- Engine attributes: threshold amount; action (notify-only vs. explicit-consent-required).

## 4. Deposit / prepayment patterns

- **50% up front, balance on delivery** is a common model (assumes actual ~= estimate).
- Michigan: 50% deposit when estimate > $50 (per uploaded doc).
- Illinois (Springfield): 25% deposit when estimate > $250 (per uploaded doc).
- Most common range: 25-50% of estimated total.
- Multi-tier escalation: notify at $X (consent), 25% deposit at $Y, 50% at $Z.
- Delinquent-requestor rule: full advance payment may be required if a prior invoice is unpaid
  (Federal FOIA explicitly; some states/cities mirror).
- Engine attributes: threshold; deposit %; refundable-if-actual-lower flag; tiers[].

## 5. Over / under reconciliation patterns (city policy varies)

When actual cost differs from the estimate, cities handle it differently. Configurable per city:
- **Actual > estimate:** (a) agency absorbs the overage; (b) pause work and request additional
  payment/consent before continuing; (c) proceed and bill the difference on delivery.
- **Actual < estimate:** (a) refund the overpayment; (b) credit; (c) keep deposit if it is below a
  request minimum.
- The good-faith margin (Section 2) covers reasonable variance without re-consent; large
  increases typically require re-notification/re-acknowledgement (see Group 12 business rules
  in the main spec: an increase after acknowledgement forces re-acknowledgement).

## 6. Best-practice estimate workflow (target)

scoping (cheap) -> estimate (projected quantities) -> notify/consent if over threshold ->
deposit if over threshold -> perform work -> final (actual quantities) -> reconcile per policy.
The estimate and the final run the SAME engine; only the quantity inputs differ (projected vs.
actual). Deposit logic keys off the estimate; the invoice keys off the final.

## 7. Automation concepts - minimizing/eliminating the human estimate step

Goal: push as many estimates as possible to "no human involvement," reserving staff effort for
genuine exceptions. Same philosophy as redaction (automate the repeatable; route only the
uncertain to a person).

### 7a. Historical cost association to record type ("leverage prior efforts")
Every completed request writes its actuals back onto its record type: page count, labor hours,
redaction-needed flag, media, total cost. Over time each record type accumulates an estimation
profile. New requests for a consistent type auto-estimate from the profile with zero human input.

### 7b. Sampling for average page counts at taxonomy creation/discovery
When a record type is created or discovered, randomly sample a small number of records of that
type, measure page counts, and store the average on the record type. Feeds the same profile as
7a. Extends the existing AI Schema Discovery / record-type discovery flow.

### 7c. Variance / confidence gating (THE crux - when a human is still needed)
Store not just an average but a SPREAD (range/variance) and sample size per record type.
- Low variance -> auto-estimate, no human, no workflow step.
- High variance (e.g., 1 page in some cases, 20 in others) -> the average is unreliable for a
  specific request; flag low-confidence and route to a human estimate OR trigger a real scoping
  search (count matching items x average pages/item).
- Also force human/scoping review for high-dollar, unusually large, or novel-type requests.

### 7d. Human-expert estimate applied at the PROFILE level (not per request)
Key reframing (Kevin, 2026-06-10): a human expert's estimate should seed the record-type
PROFILE once, not be re-created per request. Example - "home building permit" record type:
an experienced clerk seeds typical values (1 hr search; ~20 oversized blueprint pages; 3
standard permit pages; 1 blueprint shipping tube). Every future request of that type auto-
estimates from that seed - human effort spent ONCE per type, then reused (same philosophy as
reusable redaction templates). It is not a separate fallback path; it is one more SOURCE that
populates the same profile, alongside historical actuals (7a) and sampling (7b).

### 7e. Profiles store QUANTITIES, not dollars (wherever possible)
A profile captures expected QUANTITIES typed by fee component / copy-category (search hours,
redaction hours, standard pages, oversized/specialty pages, color pages, media items), NOT
pre-computed dollar amounts. The engine then prices those quantities with the CITY'S current
rate config. Benefits: (1) the estimate stays correct when a city updates a rate; (2) the same
seeded profile is portable across cities with different rates - keeping the engine generic.
Capture a flat dollar ONLY for true pass-throughs with no rate (e.g., the $3 blueprint tube).
So George seeds "20 oversized pages + 3 standard pages + 1 search hour + 1 tube ($3)", and the
engine applies each city's oversized / standard / labor rates.

### 7f. Provenance, disclosure & safeguards
- Each estimate's feeContext stamps its basis: source (historical | sampled | human-expert),
  who/when seeded, confidence/variance. Supports disclosure to the requestor where law requires
  it (disclosure wording configurable per jurisdiction).
- Profile = DEFAULT estimate. Safeguards that keep it sound: (1) reconcile to actual at delivery
  under the over/under policy; (2) allow per-request OVERRIDE for known atypicals (e.g., a
  mansion with 80 blueprint pages) via the adjustment log; (3) optional drift-check that compares
  accumulating actuals to the seed and suggests a profile update over time.

### The estimate-automation ladder (cheapest first)
1. Historical actuals for the exact record type (best for consistent types).
2. Sampled average for the type (from discovery).
3. Scoping search: matching-item count x average pages/item (for variable types like emails).
4. Human estimate (fallback / exceptions only).

## 8. Parent/child fee aggregation (how estimates roll up)

Every request is a master with one or more component children (one per record type) - including
the single-item case (master-of-one). For estimates as for final bills:
- **Per-component (sum up):** raw per-unit charges tied to that component's records - labor
  hours, page counts, media. Each component is estimated from its record type's profile (Sec 7).
- **Per-request, applied once at the master:** free allowances, de minimis, request floor/ceiling,
  estimate-notification threshold, deposit threshold, delivery, certification.
This is what prevents splitting a request to dodge the per-request maximum.

## 9. LIVE RESEARCH QUEUE (gather + verify with current primary sources)

These need a dedicated web-research pass with citations; do not rely on memory for current
figures or statute language:
- [ ] Per-state statutory language explicitly permitting AVERAGE-BASED / good-faith estimates.
- [ ] Legal authority for HUMAN-EXPERT / experience-based estimates applied to a record type.
- [ ] Disclosure-of-basis requirements (must an estimate state it was based on averages or on
      staff experience? required wording? which states / federal?).
- [ ] Redaction-effort estimation by COMPLEXITY TIER (simple / medium / complex): is this an
      established or sanctioned method anywhere? source? how are tiers defined and priced?
- [ ] How COMPETITOR PRR platforms handle fee estimates (auto vs. manual) and their workflow for
      estimate -> deposit -> processing. Do any auto-generate estimates, especially from content?
- [ ] Estimate vs. actual GRANULARITY / ROUNDING: full / half / quarter hour vs. actual minutes;
      round up / down / nearest; minimum labor increments. Per-state norms + statutory requirements.
- [ ] In-flight estimate REVISION rules: when allowed; does an increase force re-consent / new
      deposit / work pause; how are decreases treated.
- [ ] Estimate VALIDITY / EXPIRATION and the deposit-payment window before a request is abandoned.
- [ ] NOT-TO-EXCEED / guaranteed-maximum estimate rules: which jurisdictions, what constraints.
- [ ] Current per-page, labor, and programming rates by state (these change; verify year).
- [ ] Estimate-notification and deposit thresholds across a sample of real cities (10-20).
- [ ] Over/under reconciliation legal requirements (where refunds are mandatory vs. optional).
- [ ] Rules on charging for the scoping/estimate work itself (is the estimate search billable?).
- [ ] Self-service/portal fee law (CA CPRA parity; IL debate) - confirm current state.
- [ ] Best-practice estimate templates/notices used by well-run agencies (examples to model).

---

## 10. Workflow integration - the REAL driver of estimate automation

The point of automating estimates is FLOW, not just accuracy: maximize the share of requests that
move forward WITHOUT bouncing (search -> back up to build an estimate -> send to requestor -> wait
for deposit -> resume work already partly done). Each bounce is a stall and a re-context cost.

Self-service / selected-records auto-estimate path (high-volume, low-friction case):
1. Requestor selects record(s) on the portal. Page count is READ from the files (known, not estimated).
2. Record type has an estimate PROFILE -> price directly (duplication/media exact; redaction from profile).
3. No profile (or no matching record type yet) -> AI scans the selected records for exempt content,
   assigns a redaction complexity tier (simple/medium/complex), estimates redaction labor by a
   per-tier per-page formula (e.g., simple = N min/page, medium = M min/page). [VERIFY method - research queue]
4. NON-HUMAN stagegate: estimate auto-sent to requestor; the request parks here awaiting deposit.
5. EXCEPTION -> human: if AI rates redaction COMPLEX, or there is no record type / no profile and
   confidence is low -> route to a human for manual estimate creation (a process still to define).
6. Deposit paid (e.g., 50%) -> request advances to "processing / awaiting final payment".
7. On completion -> actuals (see Section 11) are written into the record type's estimate PROFILE,
   so the next request of this type needs no human. If no record type existed, this may also be
   where one is created. [CONFIRM whether request-completion can create a record type today.]

This is a state machine, not a pile of rules: Awaiting-estimate -> (auto OR human) -> Estimate-sent/
awaiting-deposit -> Deposit-paid/processing -> Awaiting-final-payment -> Closed (+ profile updated).

## 11. Actuals capture - the work timer (carry forward from the Replit build)

A timer that runs while a user works a task and feeds REAL labor minutes into actuals. Serves three
purposes: (a) actual-cost compliance where states require it (refunds / not-to-exceed); (b) the
over/under reconciliation; (c) continuously improving estimate profiles (feeds Section 7a).
- Starts when a user opens a task (record SEARCH; also REDACTION; also REDACTION REVIEW).
- Pauses on window blur / machine idle; resumes on refocus.
- On task submit: shows computed elapsed time and offers a manual ADJUSTMENT (e.g., time spent
  off-screen discussing the search). Recommend requiring a short reason for any adjustment.
- Captured per task type -> actual labor by component, per request/component.

## Where to look for best practices (to mine + verify in the research pass)
- American Society of Access Professionals (ASAP); NAGARA (records administrators association).
- State FOIA councils / public-access ombudsmen / AG public-records guidance (per target state).
- Federal: DOJ Office of Information Policy (OIP) guidance; FOIA Advisory Committee reports.
- PRR platform vendor docs/webinars: Granicus/GovQA, NextRequest, JustFOIA/WebQA, Veritone.
- MuckRock (real request data and agency fee behavior).

---

## 12. Configurable variants the engine must support (axes of configurability + research targets)

The engine must be configurable across ALL of these. This list is also the research checklist:
for each axis, find the governing authority and the range of real-world settings.

A. **Estimate-creation method** (per record type): human-expert seed | sampled average |
   historical actuals | scoping search | per-request manual.  -> which are legally sanctioned?
B. **Regulatory authority per jurisdiction**: the statute / AG opinion / court ruling governing
   estimates, deposits, refunds, average-based estimation, disclosure. (jurisdiction_profiles
   already stores statute_name + statute_citation - hang this here.)
C. **Deposit model**: none | flat | % of estimate | tiered thresholds; threshold $; refundable?
D. **Over/under (final vs estimate)**: refund overage | agency absorbs | pause-and-bill-more |
   not-to-exceed guarantee | keep deposit as floor.  -> where is each mandatory vs optional?
E. **In-flight estimate revision**: when may an estimate be revised mid-process? does an INCREASE
   require re-consent / re-acknowledgement / a new deposit / pausing work? what about a DECREASE?
F. **Redaction complexity definition**: number of tiers (e.g., simple/medium/complex), criteria
   defining each tier, per-tier time formula (minutes per page).  -> sanctioned method anywhere?
G. **Granularity & rounding** (invisible until you compute a real bill - must be configurable):
   - Estimate labor unit: full hour | half hour | quarter hour | actual minutes.
   - Actual-cost labor rounding: up | down | nearest; to hour | half | quarter | minute.
   - Minimum billing increment for labor (e.g., min 15 min); may differ estimate vs. actual.
   - Page counting: per sheet | per side (main spec Group 4).
   - Money rounding precision (to the cent).
H. **Estimate validity / expiration**: does an estimate expire? how long does the requestor have
   to pay the deposit before the request is abandoned/closed? (workflow dimension)
I. **Is the scoping/estimate search itself billable?** (also in research queue)
J. **Always-free record types** short-circuit to $0 (record-type flag; main spec Open Q 5).

---

## 13. Research findings - Pass 1 (ChatGPT, 2026-06-11) - CITATIONS TO VERIFY

Provenance: ONE AI research pass. Statute citations are specific but NOT yet independently
verified. Treat as strong leads to confirm against primary sources, not as settled law.

### Design-relevant CORRECTIONS to earlier assumptions in this doc
1. No statutory "margin of error" tolerance was found. The legal cover for estimate inaccuracy
   is RECONCILIATION (refund / additional invoice / payment-before-release), NOT a tolerated
   percentage error. => the engine's safety net is the reconcile-to-actual step, not a "good-faith
   margin." (Revises Section 2.)
2. Averages/sampling (7b) and experience-based estimates (7d) are common in PRACTICE but have
   sparse legal blessing (strongest: a Colorado community-college CORA "rule of thumb", ~20
   emails/hour). => build both as CONFIGURABLE methods gated by a per-jurisdiction policy note +
   legal-review flag + audit trail; do NOT assume they are lawful everywhere by default.
3. "Agency absorbs the overage" is nowhere a legal REQUIREMENT - it is optional policy. (Keep it
   as one configurable option among several.)
4. The redaction simple/medium/complex tier (Sections 7c, 10) is NOT a sanctioned legal method in
   any priority jurisdiction. => build it ONLY as an optional INTERNAL estimate method with a
   visible disclaimer and audit trail, always reconciled to actual time.

### STRATEGIC finding (competitors)
No competitor platform publicly documents AUTO-GENERATING estimates from record content (page
counts + redaction effort). Most-tooled on fees: JustFOIA/WebQA (payment portal: send estimates,
track hourly rates + employee time + materials, invoice, collect cards) - but workflow-assisted /
manually configured, not content-derived. NextRequest/CivicPlus: end-to-end workflow, agency fee
policies shown, no documented content-based auto-estimation. Granicus/GovQA: no public estimate-
workflow detail found. Veritone: positioned around AI redaction/media, not fee estimation.
CAVEAT: may exist behind demos/customer-only docs; unverified from public sources. => supports the
auto-estimate-from-content differentiation thesis, pending confirmation.

### Findings by topic (citations to verify)
1. Estimate basis: required/authorized above a threshold, on request, or when advance payment is
   sought. Federal: advance pay only if prior nonpayment or est > $250 (5 U.S.C. Sec. 552(a)(4)(A)(v);
   28 C.F.R. Sec. 16.10). GA: > $25 -> notify + estimate in 3 business days, may defer search until
   requester agrees; > $500 -> prepayment (O.C.G.A. Sec. 50-18-71(d)). VA: offer estimate before
   searching if requested; > $200 -> deposit (Va. Code Sec. 2.2-3704(F)). MI: deposit if est > $50,
   max 50%, itemized (MCL Sec. 15.234). THRESHOLDS: GA $25 est / $500 prepay; MI $50; PA $100
   (practice); VA $200; federal $250.
2. Averages/sampling: CO CCCS CORA rule-of-thumb ~20 emails/hr (2023). WA flat $2 when "reasonably
   estimates and documents" cost >= $2 (RCW 42.56.120; WAC 44-14-07001). No statute expressly
   authorizing statistical sampling found.
3. Experience-based: common in practice; VA FOIA Council says a "minimum estimate" must be
   meaningful under Va. Code Sec. 2.2-3704(F). No squarely-approving case found.
4. Disclosure of basis: itemization required in some (MI "detailed itemization"; WA cost-basis
   statement); NO mandatory methodology wording ("based on averages/experience").
5. Deposits: federal $250/prior-nonpayment; MI 50% max > $50; GA full prepay > $500; WA up to 10%
   copying deposit + installments (RCW 42.56.120(4)); PA prepay > $100; VA deposit > $200; FL
   estimated special-service prepay w/ refund-or-additional after actual (Fla. Admin. Code R.
   1-2.0031). GAP: CA, IL specifics not sourced.
6. Over/under: FL refund excess / collect additional; CO DOLA pay remaining before production,
   refund if less; VA (UVA) refund overage / invoice additional; WA installments. No broad "must
   absorb" rule. Options: refund, additional invoice, payment-before-release, installment, waiver,
   not-to-exceed.
7. In-flight revision: mostly implied via payment-before-release (CO DOLA pay remaining before
   production; FL additional payment if over). No mandated re-consent workflow except GA's initial
   > $25 consent.
8. Validity/expiration: policy-based. MI practitioner material: deposit not received within 48 days
   of emailed response -> may deem abandoned. WA: installment not claimed -> agency not obligated.
   GAP: needs more sampling.
9. Granularity/rounding: CO Parks & Wildlife $41.37/hr in QUARTER-HOUR increments (2025); CO DOLA
   rounds DOWN to nearest 0.10 hour; FL AGO example 15-min increments at $2.50; WA per-page /
   per-file / per-GB / flat (RCW 42.56.120). No universal rule that estimate granularity must equal
   actual-billing granularity.
10. Redaction complexity tiers: NO primary authority endorsing simple/medium/complex. Closest: CO
    20 emails/hr (volume-based, not tiered). => optional internal method + disclaimer + audit.
11. Billable search: varies. Federal: commercial pays search/review/dup; others limited. GA: may
    charge search/retrieval/redaction/production/copying (O.C.G.A. Sec. 50-18-71(c)). CO: research/
    retrieval after free period, cap $41.37/hr (2024). VA: actual cost of accessing/searching, AND
    estimate-related costs applied toward overall charges (Va. Code Sec. 2.2-3704(F)). CA: generally
    only direct cost of duplication; search not in ordinary dup cost. WA: no fee for inspection/
    locating; only copying/customized. => "is scoping/estimate search billable" is JURISDICTION-
    DEPENDENT; VA explicitly folds estimate work into the charges.
12. Self-service/portal: CA only "direct cost of duplication" (+ data compilation/extraction in
    limited cases) (Cal. Gov't Code Sec. 7922.530, 7922.575). WA statutory electronic charges + $2
    flat alt, no inspection fee. CO will not charge per-page for electronic production. GAP: IL
    portal doctrine not sourced.
13. Competitors: see STRATEGIC finding above.
14. Regulatory authority: Federal FOIA 5 U.S.C. Sec. 552 (DOJ 28 C.F.R. Sec. 16.10; OIP/OGIS). CA
    CPRA, Gov. Code Sec. 7920.000 et seq. MI FOIA, MCL Sec. 15.234. CO CORA, C.R.S. Sec. 24-72-205
    (Leg. Council publishes max research rate $41.37/hr eff. 2024-07-01). GA Open Records Act,
    O.C.G.A. Sec. 50-18-71. PA Right-to-Know Law (Office of Open Records). WA Public Records Act,
    RCW 42.56.120 (MRSC; WAC model rules). VA FOIA, Va. Code Sec. 2.2-3704 (VA FOIA Advisory
    Council). FL ch. 119, esp. Sec. 119.07 (AG opinions; Fla. Admin. Code R. 1-2.0031).

### Still open after Pass 1 (targets for a second pass / verification)
- Margin-of-error tolerance (likely none; confirm).
- Broad legal authority for statistical SAMPLING of page counts.
- Mandatory disclosure WORDING for estimate methodology.
- CALIFORNIA and ILLINOIS deposit / advance-payment workflow specifics.
- ILLINOIS portal-download fee doctrine.
- Any competitor that DOES auto-generate estimates from content (behind demos?).
- Independent VERIFICATION of every citation above against primary sources.

---

## 14. Research Pass 2 (Grok, 2026-06-12) + cross-pass reconciliation - CITATIONS TO VERIFY

Provenance: second independent AI pass (Grok), compared against Pass 1 (ChatGPT, Section 13).
Citations still unverified. Where two independent passes AGREE, treat as higher-confidence; where
they DIVERGE, verify before relying.

### A. AGREEMENTS across both passes (higher confidence)
- Standard is "good-faith / reasonable" estimate; NO quantified statutory margin-of-error in either
  pass. Protection comes from RECONCILIATION, not a tolerated error band.
- Redaction simple/medium/complex tiers have NO formal legal sanction; only ad-hoc/practical use
  (per-page or per-minute). => keep as an internal estimating aid + disclaimer + audit trail.
- Absorbing the overage is NOT required (rare/optional). Refunds of overpayment common; additional
  billing / pause-for-more varies; not-to-exceed optional.
- COMPETITORS do not (in public docs) auto-generate estimates from record CONTENT; estimating is
  staff-driven/templated even where workflow/invoicing/deposits are automated. Two independent
  passes agree - strongest support yet for the auto-estimate-from-content differentiation (same
  public-docs-only caveat).
- California limits to "direct cost of duplication"; portal fees generally capped at the statutory
  copy rate; Illinois electronic/portal treatment is unsettled/debated.
- Itemization required in some jurisdictions (e.g., Michigan); no jurisdiction mandates disclosing
  the METHOD ("based on averages/experience").

### B. DIVERGENCES / conflicts to verify
- Averages & experience-based: Grok reads them as "generally permissible" (cites a Texas AG cost-
  estimate MODEL and Massachusetts good-faith regs); ChatGPT found "limited primary authority."
  Likely reconciliation: AVERAGING within a good-faith estimate is supported; formal STATISTICAL
  SAMPLING is thin. VERIFY: Texas AG cost model; Massachusetts public-records regs.
- Colorado rounding DIRECTION: Grok says round to NEAREST 0.1 hour; ChatGPT says round DOWN to 0.10
  hour. Conflict - VERIFY (affects every CO labor bill).

### C. NET-NEW leads from Grok (concrete + configurable; VERIFY)
- TEXAS PIA, Tex. Gov't Code Sec. 552.2615: mandatory WRITTEN ITEMIZED estimate when charges exceed
  $40, BEFORE work; requester has 10 BUSINESS DAYS to respond or the request is considered
  withdrawn. Deposit/bond when est > $100 (or > $50 for a small agency). Re-notify when costs change
  by more than 20%. (Consistent with the general structure of the Texas PIA as understood here -
  still verify the figures.) This one framework yields several engine knobs: estimate-trigger $,
  response-window days, deposit-trigger $, and a revision re-consent % threshold.
- ILLINOIS FOIA, 5 ILCS 140/6: response includes an estimate of time and fees; agency may require
  full payment before copying.
- MASSACHUSETTS public-records regs: cited as explicitly blessing detailed GOOD-FAITH estimates
  based on staff EXPERIENCE - potentially the strongest express authority for the profile/averages
  approach. VERIFY (likely M.G.L. c. 66 / 950 CMR 32.00; Supervisor of Records).
- ESTIMATE EXPIRATION: Texas 10 business days; Virginia ~30 days (vs Pass 1's Michigan 48-day
  practitioner figure). Configurable per jurisdiction.
- GEORGIA DPS: per-page or per-minute redaction/review charging (a practical, non-tiered example).

### D. Still open after two passes
- A quantified margin-of-error standard (both passes found none; likely truly absent).
- Formal authority for statistical SAMPLING (vs. averaging) of page counts.
- CALIFORNIA deposit/advance-payment specifics (neither pass nailed these).
- ILLINOIS portal/electronic fee doctrine (unsettled in both).
- Any competitor that DOES auto-generate from content (behind demos/customer-only docs?).
- Independent VERIFICATION of all citations in Sections 13-14.

---

## 15. Consolidated: architecture + estimate-method selection (the single source for "how it fits")

### Architecture: ONE engine, two wraps (not three engines)
- FEE ENGINE (deterministic calculator). Generic; configured per jurisdiction from the city's
  uploaded fee policy (AI extracts config w/ citations + confidence -> human approves; NO AI at
  runtime). Computes in two tiers:
  - CHILD/component level: per-record-type unit charges (labor, pages, media).
  - PARENT/request level: once-per-request rules on the aggregated total (free allowances, de
    minimis, floor/ceiling, delivery, certification, deposit thresholds). Parent-level application
    defeats split-to-dodge-the-cap.
- TWO MODES of the SAME engine: ESTIMATE = engine on PROJECTED quantities; FINAL = engine on
  ACTUAL quantities. There is no separate "estimate engine."
- The estimate run produces FOUR outputs: (1) itemized estimate; (2) deposit due (from deposit
  policy: threshold/%/tiers); (3) whether the notification/consent threshold is crossed; (4) a
  stamp of HOW it was derived (disclosure). These drive the workflow stagegate.
- ACCOUNTING/LEDGER WRAP: captures actuals (work timer + known page counts), tracks deposits/
  payments/balance, applies reconciliation policy (refund / bill difference / pause / not-to-
  exceed), holds immutable engine output + separate adjustment ledger, and feeds actuals back into
  record-type profiles.

### Estimate-method selection (per component) - the projection front-end
Walk most-automatic -> manual; stop at the first method that clears a confidence bar.
0. Record type flagged ALWAYS-FREE -> estimate $0. Done.
1. Records ALREADY SELECTED/KNOWN (portal pick or chosen from public/fulfilled index) -> page
   count is a FACT, not a projection. Copies + media exact; search labor ~0; only redaction effort
   is soft (see star). Near-deterministic, no-human bucket (the high-volume one).
2. Else (records described, must be located): does the record type have a usable ESTIMATION
   PROFILE (avg quantities + variance + sample size; populated by historical actuals, discovery
   sampling, or human-expert seed)?
   - Profile exists AND low variance/adequate sample -> use it. Auto-estimate, no human.
   - Profile exists BUT high variance, or request atypical/large/high-dollar -> go to 3.
   - No profile -> go to 4.
3. Cheap SCOPING signal? (matching-item count x profile avg pages/item) -> project from it. Auto if
   confidence holds; else -> 4.
4. MANUAL estimate (fallback): no profile, or low confidence, or atypical/high-dollar/novel, or
   redaction judged complex w/ no profile. If the type recurs, the human estimate SEEDS the profile
   (quantities, not dollars) so the next one is automatic.

star. REDACTION EFFORT (soft variable in both selected + projected paths): minutes from the type's
complexity tier, an AI content scan of the actual records (exempt-span count -> minutes), or
historical actuals. Simple/medium w/ confidence -> auto; complex or no-profile/low-confidence ->
human. Tier is an INTERNAL aid (no legal sanction) always trued-up to actual via the timer.

THE GATE under all steps: auto-vs-human is decided by confidence/variance + override triggers
(dollar size, novelty). Low uncertainty -> automatic (no stall); high uncertainty/stakes -> human.
PURPOSE = FLOW: maximize requests that never need a human estimate step.

### Still UNDESIGNED (the one real gap)
- The MANUAL ESTIMATE CREATION experience itself (the screen/steps a staffer uses at Step 4).
  Named, not yet designed.

---

## 16. Two more design requirements (added 2026-06-12)

### A. Estimate transparency / explainability (no black box)
The deterministic engine makes every estimate explainable by construction. Surface it as TWO views
of the same feeContext:
- STAFF view: full worksheet - each line = config rate x quantity, plus the METHOD that produced
  each projected quantity (profile / sample / scoping / manual / expert-seed) and its confidence.
- REQUESTOR view: a plain-language BASIS summary on the email/mail notification - what is charged
  for, the rates, and the basis in human terms ("based on the records you selected" / "typical
  values for this record type" / "staff review"), framed as a good-faith estimate to be reconciled.
Notes: output #4 of the estimate run (the "how derived" stamp) is the seed for the requestor
summary. Make requestor-facing detail level CONFIGURABLE per jurisdiction (disclosure norms vary;
itemization required in some, methodology wording mandated nowhere). Keep internal tier labels OUT
of the requestor view - express as concrete pages/hours, not "complexity: high".

### B. Financial integration mode - internal vs ERP/accounting (NEW; not previously mapped)
The underlying question: WHO is the system of record for the money?
- INTERNAL mode: Optimum Q issues the invoice, records payments, tracks balance/refunds itself.
  For small agencies with no finance-system integration.
- ERP/ACCOUNTING-INTEGRATION mode: Optimum Q computes fee + estimate + reconciliation LOGIC, hands
  the charge to the city's financial system (Tyler Munis / Workday / SAP / etc., the AR/GL book of
  record), and receives payment status BACK to advance the workflow. Larger agencies often require
  this (records system may not be the book of record for public funds).
- HYBRID (likely common): Optimum Q keeps a request-side ledger for WORKFLOW (owed, deposit status,
  balance) while the ERP holds the authoritative transaction.

Design: a configurable FINANCIAL-INTEGRATION MODE with an adapter interface - internal-ledger impl
vs ERP-connector impl. Fee/estimate/reconciliation logic is identical across modes; only the
system-of-record and money-movement differ. Workflow stagegates (awaiting-deposit -> paid ->
awaiting-final -> closed) are driven by PAYMENT EVENTS sourced from whichever mode is configured.

Rides the EXISTING connector pattern (platform already has connector stubs incl. Tyler Munis).
Extend that (or add a finance connector) rather than invent a new mechanism; Munis is notable
because it IS the finance system, so records-side and money-side could share a path.

Staging (consistent with payments caution): build the logic + ledger + mode/adapter abstraction now
(internal ledger as default, ERP connector as a defined interface/stub); live money-movement (card
processing internally, or true cash sync with the ERP) is the later, careful step.
