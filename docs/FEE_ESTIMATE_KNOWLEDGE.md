# Fee Estimate - Knowledge & Design Reference

**Status: WORKING REFERENCE (v0.1, 2026-06-10).** Captures design decisions and policy
PATTERNS for the *estimate* side of the fee engine. The specific dollar figures and statute
specifics below are illustrative - drawn from the uploaded Fee Engine document and general
knowledge - and MUST be verified against current primary sources in a dedicated web-research
pass before being relied on operationally. This file is the home for that research as gathered.

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
