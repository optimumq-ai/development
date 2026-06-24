# Jurisdiction Rules: Estimates, Fees & Redaction Triggers (multi-state)

Purpose: capture how public-records cost rules and exemption/redaction processes differ across
states, so the Jurisdiction Profile layer parameterizes the right variables and we do NOT hardcode
Texas assumptions. Researched 2026-06-23 (TX, CA, FL, NY, WA).

ARCHITECTURE PRINCIPLE (confirmed): one codebase, universal taxonomy + workflow, with a Jurisdiction
Profile supplying statutes, dollar amounts, clocks, billable cost drivers, and whether certain STAGES
exist at all. Two biggest cross-state forks: (1) what labor is billable and on what trigger; (2) the
exemption-decision model (pre-clearance ruling vs agency self-determination).

## Part A - Axes the Jurisdiction Profile MUST parameterize
1. Per-copy paper rate + media rates (TX $0.10, FL $0.15, NY $0.25, CA ~$0.10-0.25, WA $0.15/actual).
2. Is LABOR billable, and on what trigger? None-except-narrow-electronic (CA); page threshold (TX >50pp);
   time threshold agency-set (FL >15-30min; NY >2hr "preparation"); customized IT service charge (WA).
3. WHICH drivers are billable per jurisdiction: search/locate, review, REDACTION, programming, per-minute
   media. Redaction labor billable in TX (>50pp) & FL (extensive); NOT in CA or NY.
4. Labor rate basis: fixed statutory ($15/hr, $28.50 programming - TX) vs actual lowest-paid-capable
   employee (FL, NY) vs none (CA). Overhead: TX adds 20% of labor.
5. Exemption-decision MODEL (the big workflow fork):
   - Pre-clearance: must request AG ruling to withhold within a clock (TX 10 business days; AG ~45 working
     days). An entire STAGE + external dependency + deadline.
   - Self-determine + internal appeal then court (NY: appeal to agency officer in 30d, answer in 10 biz days,
     then Article 78 lawsuit).
   - Self-determine + court only (CA, FL, WA).
6. Self-redact-WITHOUT-ruling categories (jurisdiction data -> Exemption Reference Library).
7. Response/estimate clocks (acknowledge, produce, estimate-acceptance window).
8. Deposit/prepay threshold (TX >$100, or >$50 for <16 FTE).
9. Public-interest fee WAIVER exists (TX) vs none (FL).
10. Itemized-estimate threshold + variance rule (TX itemize >$40; re-notify if actual exceeds est by >20%).

## Part B - Texas detail (the demo jurisdiction)
Cost rules (1 TAC Ch. 70; Gov't Code Ch. 552):
- Paper $0.10/page; oversize $0.50; CD $1.00; DVD $3.00; USB/drive actual cost.
- Labor $15/hr (locate, compile, manipulate, reproduce); programming $28.50/hr; overhead = 20% of labor.
- 50-PAGE RULE: NO labor/overhead for <=50 pages of standard paper (exceptions: 2+ unconnected buildings,
  remote storage).
- Body/dash camera video: <= $10 per recording + $1.00 per full minute (if not already released).
- Attorney/staff time to review for exceptions or prepare an AG ruling request is NOT chargeable.
- Redaction labor IS chargeable (mixed confidential+public on a page), but NOT for <=50 pages.
- No flat fees; per-request. AG publishes a Public Information Cost Estimate Model.

Estimate / deposit / clock:
- Itemized written estimate required when charges exceed $40, before work begins.
- Requestor responds within 10 business days (accept/modify/withdraw) or request auto-withdraws.
- Estimate >$100 ($50 for <16 FTE): may require bond/prepayment/deposit.
- Actual exceeds estimate by >20%: must re-notify and get acceptance again.

Redaction / legal-review TRIGGER buckets (codifiable):
- BUCKET 1 (auto-redact, NO legal review / NO ruling; usually a notice/form to requestor):
  SSN (552.147); driver-license/motor-vehicle (552.130); account/access-device/card numbers (552.136);
  family-violence/trafficking/assault shelter (552.138); public-employee personal info (552.024 & 552.1175);
  plus standing "previous determinations" (ORD-684: I-9s, W-2/W-4, direct-deposit auth, fingerprints, etc.).
- BUCKET 2 (LEGAL REVIEW + AG ruling clock): withholding under a discretionary/confidential exception NOT
  covered by a previous determination -> request AG ruling within 10 business days, notify requestor, send
  marked sample. Miss the deadline => presumed public.
- BUCKET 3 (release as-is).
Exemption library seed (TX): 552.024/.101/.130/.136/.138/.147/.1175, 552.301/.305, ORD-673 & ORD-684.

## Part C - Five-state comparison (structural)
| Axis | TX | CA | FL | NY | WA |
|---|---|---|---|---|---|
| Paper /pg | $0.10 | ~$0.10-0.25 | $0.15 | $0.25 | $0.15/actual |
| Search labor billable? | Yes >50pp | No | Yes if extensive | No | Customized svc charge |
| Redaction labor billable? | Yes >50pp | No | Yes if extensive | No (only "prep") | Limited |
| Labor rate | $15/hr fixed +20% | n/a | actual (lowest capable) | actual (lowest capable) | actual |
| Labor trigger | >50 pages | n/a | >15-30 min (agency-set) | >2 hours prep | IT expertise |
| Exemption model | AG ruling pre-clearance | self + court | self + court | self + appeal + court | self + court |
| Deposit | >$100 | rare | prepay allowed | on notice | customized |
| Fee waiver (public interest) | Yes | limited | None | None | Limited |
| Ack / respond clock | 10 biz days (+AG ~45wd) | 10 cal days | promptly | 5 biz day ack | 5 biz days |
Note: dollar figures and thresholds change; verify per state when building each profile. WA is notable for
per-day penalties on wrongful denial. CA bill AB 1821 (pending) may add labor fees for "commercial" requests.

## Part D - Design implications for OptimumQ (avoid rework)
1. FEE ENGINE: treat each cost DRIVER as jurisdiction-configurable: {rate, billable_yes_no, threshold}.
   Do NOT hardcode TX labor rules. Example: driver "redaction_hours" is billable in TX (>50pp) & FL
   (extensive) but must price to $0 in CA & NY. The engine zeroes non-billable drivers per profile.
2. EXEMPTION/REDACTION DECISION = a jurisdiction-configurable STAGE, not a hardcoded step:
   - "Request AG ruling" node + its 10-biz-day clock EXISTS only for pre-clearance states (TX). Absent for
     CA/FL/WA. NY adds an internal-appeal node. If we hardcoded the AG stage we'd rip it out for ~49 states.
   - Model it as: jurisdiction.exemption_model in {pre_clearance, self_appeal_court, self_court}.
3. Self-redact-without-ruling categories = per-jurisdiction data in the Exemption Reference Library.
4. Clocks/deadlines, deposit thresholds, fee-waiver existence, itemized-estimate threshold, variance %
   = all Jurisdiction Profile fields (we already have deposit threshold + deadlines as knobs).
5. Per-record-type charge models live in the taxonomy + jurisdiction overlay (e.g. TX video = per-recording
   + per-minute cap). The estimate "template" per type = its relevant billable drivers (see Part E).

## Part E - Estimate-creation workflow (proposed; connects Kevin's sketch)
Key unblocking insight: the estimate usually does NOT require the full search first. It is a GOOD-FAITH
estimate, legitimized by the >20% reconciliation rule (TX). Quantities are estimated from the record type:
- Video: minutes (+ recording count) - usually from incident/CAD metadata or a quick locate, not full review.
- Documents: estimated page count + labor hours; for <=50pp (TX) labor is $0 so precision barely matters;
  for large/unknowable sets, a quick scoping/locate pass sizes it (itself billable >50pp in TX).

Estimate TEMPLATE per record type = the set of billable cost DRIVERS for that type (this is what
record_type_estimate_profiles.DRIVERS already model). Add media drivers (recordings, minutes) for video.
- Documents template: bwPages, colorPages, oversizedPages, searchHours, reviewHours, programmingHours.
- Video template: recordings, minutes (priced per the jurisdiction's per-minute + per-recording rule).

Unified flow (AUTO path) - reorder so estimate precedes Record Search:
1. Confidence hurdles cleared (record type + team). Instead of assigning Record Search first, create an
   ESTIMATE task for the owning team.
2. Auto-estimate avenue? (estimateProfile.assess) ->
   - YES: system pre-fills the type's driver template, fee engine prices it -> assign a "Review Estimate"
     task (claim pool or Smart Routing to a FEE_MANAGER on that team). Person checks/edits, sends.
   - NO: assign a "Create Estimate" task (same routing). Person fills the driver template; fee engine prices.
   (Same screen, same template, same fee engine; only difference = pre-filled vs blank.)
3. Send itemized estimate IF > jurisdiction itemized threshold (TX $40). Below threshold, just proceed.
4. Requestor responds within the jurisdiction window (TX 10 biz days): accept / modify / withdraw.
   No response -> auto-withdraw (TICKLER time branch).
5. Deposit required? (estimate > jurisdiction deposit threshold) -> request + await payment (TICKLER).
   Waiver granted -> skip fees.
6. THEN assign Record Search (the work moves here). -> readiness/redaction -> deliver.
7. RECONCILE: actual quantities vs estimate; if actual > est by >20% (TX) re-notify + re-accept; write ACTUAL
   quantities back into the estimate profile (Welford) to improve future auto-estimates. Loop closes.

ROLE: reuse permission role FEE_MANAGER as the per-team "estimate" pool (no new role needed); FEE_AUTHORITY
can be the approver if a sign-off is wanted. MULTI-RECORD: Open Records builds the parent and farms an
estimate task to each owning team per item; each item uses its own type template; parent rolls them up.

NET-NEW build pieces this implies: estimate task (Create/Review variants) as an assignable task; the
assignment layer (claim pool + Smart Routing match - already flagged); media drivers in the profile/engine;
jurisdiction billable-driver gating in the fee engine; the AG-ruling stage as a jurisdiction toggle.

## exemption_model wired (2026-06-24)
The exemption_model toggle (pre_clearance | self_appeal_court | self_court) described here is now a real column on jurisdiction_profiles and drives the AG pre-clearance workflow segment + tolling. TX seeded as pre_clearance. See SESSION_HANDOFF / CITY_FEE_SURVEY GAP 7.
