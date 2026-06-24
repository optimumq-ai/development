# City Fee/Estimate Survey + Engine Gap Analysis (10 cities)

Purpose: stress-test the fee engine against real city/state public-records ESTIMATE rules across regions
and sizes, and surface any policy the current engine cannot express. Answers Kevin's question: "what's the
likelihood the software can't accommodate a given city's policies, and what was that switch we said we'd need?"

PROVENANCE / CAVEAT: this pass is built from established STATUTORY FRAMEWORKS + prior in-repo research
(JURISDICTION_RULES.md, FEE_ESTIMATE_KNOWLEDGE.md), NOT a fresh live web pull. The STRUCTURAL conclusions
(which kinds of charges a state allows -> which drive engine gaps) are stable and reliable. The exact dollar
amounts/rates below are framework-typical and MUST be verified against each city's CURRENT ordinance/schedule
when its Jurisdiction Profile is actually built. Frameworks change slowly; dollar figures change yearly.

## THE SWITCH (what Kevin was remembering)
Per-driver BILLABLE/NON-BILLABLE gating. Labor that is chargeable in Texas (search, review, redaction) must
price to $0 BY LAW in California, New York, Ohio, and others. Today the engine can only fake this by setting a
driver's rate to 0 - which (a) can't distinguish "non-billable by statute" from "rate happens to be $0",
(b) can't carry the legal basis, and (c) cannot express CONDITIONAL billability (chargeable only past a
trigger). Two states cannot be served by one flat rate-set; you need a per-driver switch. Details in Gaps 1-2.

## The 10 cities (region + size + governing framework + distinctive estimate structure)
Sizes are approximate; all in the 150k-1M band requested. Each maps to its state framework (state law
controls/ceilings public-records fees; home-rule cities set specific rates within that).

1. Arlington, TX (~395k; South/Southwest) - TX Gov't Code 552 / 1 TAC 70.
   $0.10/pg; labor $15/hr; programming $28.50/hr; OVERHEAD +20% of labor; but NO labor/overhead for <=50
   standard pages; video $10/recording + $1/min. Itemize >$40; deposit >$100; 10-biz-day response; re-notify
   if actual > est by >20%. Distinctive: 50-page all-or-nothing labor gate + 20% overhead.

2. Sacramento, CA (~525k; West) - CPRA, Gov't Code 7920+.
   DIRECT COST OF DUPLICATION ONLY (~$0.10-0.25/pg or actual); NO search/review/redaction labor for paper;
   MAY charge programming/data-extraction for ELECTRONIC records only. ~10-cal-day determination. Distinctive:
   labor non-billable (paper) but electronic extraction billable -> needs per-driver gating, not rate=0.

3. Tampa, FL (~400k; Southeast) - FL ch. 119, esp. 119.07.
   ~$0.15/pg one-sided letter ($0.20 double-sided), $1 certified; "special service charge" = labor at the
   ACTUAL hourly rate of the lowest-paid capable employee, ONLY if the request requires EXTENSIVE work
   (agency-set, commonly >15-30 min). Prepayment allowed; NO public-interest fee waiver. Distinctive: labor
   billable only past a TIME trigger; actual-employee rate basis.

4. Rochester, NY (~210k; Northeast) - NY FOIL, Pub. Off. Law 87.
   $0.25/pg (<=9x14); actual cost for larger; may charge for "preparing a copy" (e.g., programmer time) ONLY
   when it takes >2 hours; NO search/review labor. 5-biz-day acknowledgment. Distinctive: labor non-billable
   except a >2-hour "preparation" carve-out; hard $0.25 page cap.

5. Tacoma, WA (~220k; Northwest) - WA PRA, RCW 42.56.120 (WAC model rules).
   Statutory default per-page (e.g., ~$0.15/pg copies, ~$0.10/pg scan) OR actual cost; $2 FLAT-FEE option; NO
   fee for INSPECTION or merely locating records; "customized service charge" possible. Per-day penalties for
   wrongful denial. Distinctive: no inspection/locating fee; statutory default schedule + $2 flat alternative.

6. Columbus, OH (~910k; Midwest) - Ohio Public Records Act, ORC 149.43.
   ONLY actual cost of duplication (commonly $0.05-0.10/pg); NO labor/search charges AT ALL; no inspection
   fee; prepayment of postage allowed. Distinctive: labor entirely prohibited (stricter than CA - no real
   electronic-extraction carve-out). Strongest case for the billable switch.

7. Denver, CO (~715k; Mountain) - CO CORA, C.R.S. 24-72-205.
   Research & retrieval fee AFTER a free first hour, capped at the state max research rate (~$41.37/hr, eff.
   2024-07-01, INFLATION-ADJUSTED periodically); per-page up to ~$0.25; will NOT charge per-page for
   electronic production; deposit may be required. Distinctive: first-hour-FREE then CAPPED hourly; the cap
   is a moving statutory number; electronic = no per-page.

8. Mesa, AZ (~510k; Southwest) - AZ Public Records, ARS 39-121+.
   NON-COMMERCIAL purpose = cost of copies; COMMERCIAL PURPOSE = additional charges reflecting the commercial
   value and the cost of obtaining the records, and requires a stated-purpose affidavit. Distinctive:
   requester-PURPOSE fee switch (two different fee bases selected by why the records are wanted).

9. Nashville, TN (~690k; Southeast) - TN TPRA; Office of Open Records Counsel "Schedule of Reasonable Charges".
   Copies ~$0.15/pg; LABOR billable after a free first hour, at the hourly wage of the lowest-paid capable
   employee, aggregated across the request. Distinctive: first-hour-free labor + a STATE-STANDARDIZED schedule
   + actual-employee rate basis.

10. Boston, MA (~650k; Northeast) - MA Public Records, G.L. c. 66 s.10; 950 CMR 32.
    MUNICIPALITIES: first 2 hours of search/segregation FREE (4 hours for smaller municipalities), then labor
    capped at ~$25/hr; ~$0.05/pg standard b&w letter/legal; good-faith written estimate required over a small
    threshold. Distinctive: first-N-hours-free + hourly CAP (municipal tier) + low statutory copy rate.

(Bonus 11th, Midwest small: Naperville, IL (~150k) - IL FOIA, 5 ILCS 140. First 50 pages b&w FREE then ~$0.15/pg;
electronic = actual cost of the medium; COMMERCIAL-purpose requests get different/extended handling and may be
charged for staff compilation time. Another commercial-purpose switch + a free-page tier.)

## What the engine ALREADY handles (no change needed)
- Flat per-page b&w/color/oversized; "actual cost" drivers (rate='actual'): all 10's basic copy charges.
- Per-item media (CD/DVD/USB) and per-recording + per-minute A/V (TX video rule) - built.
- Fixed hourly labor (search/review/programming) at a configured rate: TX, GA, CO/TN/MA caps (set rate<=cap).
- Free page allowance (IL first-50-free; the "free then flat" 2-band case) and flat free-labor-hours.
- Deposit threshold + percent; min/max fee; de-minimis waive; certification; delivery + handling.
- Estimate policy: response window, validity days, >20% re-notify (built), itemize-notify threshold.
=> Every city's BASIC copy/media/deposit/estimate-clock mechanics are expressible today.

## GAPS - rules the engine CANNOT yet cleanly express (the build list)

GAP 1 - Per-driver BILLABLE flag (+ legal basis). [THE switch]
  Bites: CA, NY, OH, WA (and partly FL/NY) forbid labor that TX/FL/GA/CO/TN allow. rate=0 is lossy and can't
  carry "non-chargeable under <cite>". Fix: each driver = { rate, billable:true|false, basisNote }. Estimate UI
  shows "Not chargeable under [statute]" instead of a misleading $0 line.

GAP 2 - CONDITIONAL / threshold-triggered labor. [the part rate=0 truly can't fake]
  Bites: TX (labor+overhead $0 until >50 pages, then FULL - an all-or-nothing PAGE gate, NOT a free-hours
  deduction); FL (only if "extensive", a TIME gate); NY (only >2 hrs "preparation"); CO/TN/MA (first hour/
  first N hours free THEN hourly - the simple free_then_bill case freeLaborHours approximates, but not the TX
  page gate or FL/NY time gates). Fix: driver.billableWhen = { trigger:'pages'|'minutes'|'hours'|'none',
  threshold:N, mode:'all_or_nothing'|'free_then_bill' }.
  NOTE: GAP 1 + GAP 2 are ONE data-model change (driver becomes {rate, billable, billableWhen}) and together
  unlock CA, NY, OH, FL, CO, TN, MA, and a CORRECT TX 50-page rule. Highest ROI. THIS is the switch to build.

GAP 3 - Labor OVERHEAD surcharge (TX +20% of labor). No percentage surcharge on labor exists.
  Fix: labor.overheadPct (applied to billable labor only).

GAP 4 - Requester-PURPOSE fee switch (commercial vs non-commercial). [clearest "can't be one component"]
  Bites: AZ, IL, federal-style - a DIFFERENT fee BASIS selected by WHY the records are wanted, not a different
  rate. You cannot express "non-commercial: no labor; commercial: labor + commercial-value charge" in one
  rate-set. Fix: selectable profile VARIANTS by request.purpose (standard | commercial), reusing the engine's
  existing `context` selection concept (today FR/SS) extended to purpose. Also gates a stated-purpose affidavit
  step in workflow.

GAP 5 - TIERED / graduated rate bands (e.g., $0.25 first page then $0.10; oversized size tiers; 3+ volume
  bands). Engine = one flat rate + a free allowance (covers only the 2-band "free then flat"). Fix: optional
  rate bands per driver. Lower frequency; many cities are single-rate.

GAP 6 - Per-estimate ACTUAL-employee rate override (FL, NY, TN: rate = the actual wage of the lowest-paid
  capable employee, varies per request/person). Engine uses a fixed configured rate. Fix: allow a per-estimate
  rate override on labor drivers flagged "actual-rate basis" (the estimate worksheet takes quantities today,
  not rate overrides).

GAP 7 (workflow, already flagged in JURISDICTION_RULES.md - listed for completeness):
  - AG-ruling PRE-CLEARANCE stage toggle (TX only) + exemption_model switch {pre_clearance|self_appeal_court|
    self_court}. Hardcoding the AG stage would force a rip-out for ~49 states.
  - INSPECTION-vs-copies: WA/OH charge nothing to inspect/locate -> an inspection request type should zero
    duplication/labor. Partly modelled by `context`; make explicit.

## Priority recommendation
1. GAP 1 + GAP 2 together (driver -> {rate, billable, billableWhen}). Single change; unlocks ~all 10 states'
   labor rules + a correct TX 50-page rule. Build first. (This is the switch.)
2. GAP 3 overhead percentage (small; TX + a few).
3. GAP 4 commercial-purpose schedule switch (medium; needed for AZ/IL/federal-style and any city that
   distinguishes commercial requesters; also a workflow affidavit step).
4. GAP 6 per-estimate actual-rate override (small; FL/NY/TN).
5. GAP 5 tiered rate bands (lower frequency).
6. GAP 7 workflow toggles (exemption_model, inspection type) - on the jurisdiction-layer roadmap already.

## Bottom-line answer to "will the software fail to accommodate a city?"
With GAPS 1-4 built, the engine should express the fee/estimate rules of the large majority of US cities,
because almost all variation reduces to: (which drivers are billable) x (on what trigger) x (at what rate/cap)
x (plus/minus overhead) x (which schedule applies by purpose). The remaining long-tail (exotic tiered
schedules, unusual local surcharges) is covered by GAP 5 or by the generic "other" one-off line already in the
engine. The structural risk is LOW once the per-driver billable/trigger switch exists; today, without it, any
no-labor state (CA, NY, OH, WA) and the TX 50-page rule are only approximated.
