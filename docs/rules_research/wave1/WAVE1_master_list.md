# Wave 1 master list — readable render

Seed dictionary: **173 concepts**. Parameter table: **48**. Structural catalog: **125**.

## Parameter concepts (city-tunable knobs / per-state values)

### `inspection.office_hours`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | floor | Available at a minimum during the body's normal business hours (city sets the hours) | Tex. Gov't Code § 552.021 |
| CA | fixed | Open at all times during the agency's office hours | Cal. Gov. Code § 7922.525(a) |
| AZ | fixed | Available at all times during regular office hours | Ariz. Rev. Stat. § 39-121 |

### `deadline.initial_response_window__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| NY | fixed | 5 business days from receipt of written request | N.Y. Pub. Off. Law § 89(3)(a) |
| VA | fixed | 5 working days from receipt of request | Va. Code § 2.2-3704(B) |
| WA | fixed | 5 business days from request receipt | RCW 42.56.520(1) |

### `deadline.determination_extension__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| CA | ceiling | Up to 14 additional days beyond the 10-day determination deadline; written notice required | Cal. Gov. Code § 7922.535(b) |
| IL | ceiling | Up to 5 business days beyond the original due date (7 enumerated grounds) | 5 ILCS 140/3(e) |
| VA | fixed | Additional 7 work days beyond the original 5-working-day response | Va. Code § 2.2-3704(B)(4) |

### `fee.copy_actual_cost_ceiling__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| CA | ceiling | Direct cost of duplication (or applicable statutory fee); electronic = direct cost of producing an electronic copy | Cal. Gov. Code § 7922.530(a); § 7922.575(a) |
| VA | ceiling | Actual cost of duplication | Va. Code § 2.2-3704(F) |
| WA | ceiling | Actual costs directly incident to copying | RCW 42.56.120(1) |

### `fee.copy_actual_cost_ceiling__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| VA | ceiling | Actual cost incurred in accessing, duplicating, supplying, or searching | Va. Code § 2.2-3704(F) |
| FL | fixed | Actual cost of duplication for copies other than standard-size paper | § 119.07(4)(a)3., Fla. Stat. |

### `fee.per_page_rate_ceiling__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| NY | ceiling | 25¢ per photocopy not exceeding 9x14 in, unless a different statutory fee applies | N.Y. Pub. Off. Law § 87(1)(b)(iii)(1) |
| FL | ceiling | 15¢ per one-sided copy not larger than 14x8.5 in | § 119.07(4)(a)1., Fla. Stat. |
| IL | ceiling | 15¢ per page for B&W letter/legal copies (after the free 50) | 5 ILCS 140/6(b) |
| WA | ceiling | 15¢ per page for photocopies/printed electronic records, absent a published actual-cost calc | RCW 42.56.120(2)(b)(i) |

### `fee.other_records_actual_cost__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| NY | ceiling | Actual cost of reproduction (records other than 9x14 paper) per § 87(1)(c) | N.Y. Pub. Off. Law § 87(1)(b)(iii)(1) |
| IL | ceiling | Actual cost of reproduction for color or non-letter/legal-size copies | 5 ILCS 140/6(b) |

### `fee.labor_special_service_charge__4`
| State | Basis | Value | Citation |
|---|---|---|---|
| FL | soft-standard | Reasonable special service charge based on cost actually incurred, added to duplication cost, where extensive IT or clerical/supervisory assistance is required | § 119.07(4)(d), Fla. Stat. |
| WA | soft-standard | Customized service charge where IT expertise is required to prepare data compilations/custom access; requires notice; no numeric cap | RCW 42.56.120(3) |

### `fee.certified_copy_charge`
| State | Basis | Value | Citation |
|---|---|---|---|
| FL | ceiling | Up to $1 per certified copy | § 119.07(4)(c), Fla. Stat. |
| IL | ceiling | Certification cost not to exceed $1 | 5 ILCS 140/6(b) |

### `payment.advance_deposit_before_production__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| VA | fixed | Threshold $200; deposit ceiling = the advance-determination amount | Va. Code § 2.2-3704(H) |
| WA | ceiling | Deposit not exceeding 10% of the estimated cost of providing copies | RCW 42.56.120(4) |

### `deadline.initial_response_window__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| IL | fixed | 5 business days from request receipt (comply or deny), unless properly extended | 5 ILCS 140/3(d) |

### `deadline.initial_response_window__3`
| State | Basis | Value | Citation |
|---|---|---|---|
| CA | fixed | 10 days from receipt to determine and notify | Cal. Gov. Code § 7922.535(a) |

### `deadline.determination_extension__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| VA | fixed | 60 work days (in lieu of 7) for criminal investigative files under § 2.2-3706.1 | Va. Code § 2.2-3704(B)(4) |

### `communication.delay_certification_date_certain__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| NY | fixed | 20 business days from acknowledgement — trigger to state reasons and a date certain if disclosure cannot occur | N.Y. Pub. Off. Law § 89(3)(a) |

### `withdrawal.clarification_nonresponse__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | fixed | 61 days from clarification/discussion request sent with no written response = request considered withdrawn | Tex. Gov't Code § 552.222(d) |

### `withdrawal.fee_estimate_nonresponse__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | fixed | 10 business days from itemized statement sent with no written response = withdrawn; updated statement required if estimate rises 20%+ | Tex. Gov't Code § 552.2615(b),(c) |

### `withdrawal.fee_estimate_nonresponse__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| VA | fixed | 30 days from sending the cost estimate with no response = deemed withdrawn | Va. Code § 2.2-3704(F) |

### `withdrawal.abandonment_fail_inspect_or_pay__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | fixed | 60 days from info made available (or from cost notice) without inspection/payment = considered withdrawn | Tex. Gov't Code § 552.221(e) |

### `review.ag_referral_deadlines_notices`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | fixed | AG-decision request + requestor withholding notice by 10th business day; AG written comments + requestor copy by 15th business day, from receipt of the request | Tex. Gov't Code § 552.301(b),(d),(e),(e-1) |

### `review.ag_decision_render_deadline`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | ceiling | AG renders decision within 45 business days of receipt, extendable once by 10 business days | Tex. Gov't Code § 552.306 |

### `fee.copy_all_costs_incl_overhead`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | soft-standard | Reasonable amount including all reproduction costs — materials, labor, and overhead | Tex. Gov't Code § 552.261(a) |

### `fee.per_page_rate_ceiling__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| FL | ceiling | No more than an additional 5¢ for a two-sided copy | § 119.07(4)(a)2., Fla. Stat. |

### `fee.per_page_rate_ceiling__3`
| State | Basis | Value | Citation |
|---|---|---|---|
| WA | ceiling | Flat fee up to $2 per request in lieu of itemized charges | RCW 42.56.120(2)(d) |

### `fee.other_records_actual_cost__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| WA | ceiling | Up to 10¢ per page for records scanned into electronic format, absent a published actual-cost calc | RCW 42.56.120(2)(b)(ii) |

### `fee.electronic_medium_cost__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| IL | ceiling | Actual cost of the recording medium; voluminous e-records tiered caps of $20/$40/$100 by data size (non-PDF: ≤2/2-4/>4 MB; PDF: ≤80/80-160/>160 MB) | 5 ILCS 140/6(a); 6(a-5) |

### `fee.electronic_medium_cost__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| WA | ceiling | Up to 5¢ per 4 files/attachments uploaded; up to 10¢ per GB transmitted, absent a published actual-cost calc | RCW 42.56.120(2)(b)(iii),(iv) |

### `fee.first_pages_free`
| State | Basis | Value | Citation |
|---|---|---|---|
| IL | fixed | First 50 pages of B&W letter/legal copies free | 5 ILCS 140/6(b) |

### `fee.inspection_no_charge`
| State | Basis | Value | Citation |
|---|---|---|---|
| WA | fixed | No fee for inspecting records or for locating documents and making them available for copying ($0) | RCW 42.56.120(1) |

### `fee.labor_special_service_charge__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| NY | fixed | Hourly salary of the lowest-paid employee with the necessary skill; no preparation fee unless ≥2 hours needed; outside-service cost only if agency IT inadequate | N.Y. Pub. Off. Law § 87(1)(c)(i),(iii),(iv) |

### `fee.labor_special_service_charge__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| IL | ceiling; 8-hour free floor | Commercial requests: up to $10 per personnel hour for search/retrieval/redaction; first 8 hours free | 5 ILCS 140/6(f) |

### `fee.labor_special_service_charge__3`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | floor | If it caps uncompensated personnel time, must allow at least 36 hours/requestor per 12 months and at least 15 hours/requestor per month before charging | Tex. Gov't Code § 552.275(a),(b) |

### `fee.reused_electronic_no_fee`
| State | Basis | Value | Citation |
|---|---|---|---|
| NY | fixed | No fee (except actual storage-media cost) where an identical record was prepared within the prior 6 months and an electronic copy is available | N.Y. Pub. Off. Law § 87(1)(b)(iii)(2) |

### `fee.no_charge_website_posted`
| State | Basis | Value | Citation |
|---|---|---|---|
| WA | fixed | No copying charge for access to or downloading of records routinely posted on the agency website ($0) | RCW 42.56.120(2)(e) |

### `fee.gis_records_charge`
| State | Basis | Value | Citation |
|---|---|---|---|
| VA | ceiling | Reasonable charge not exceeding actual cost; exception — pro rata per-acre for body-developed topo maps over 50 contiguous acres | Va. Code § 2.2-3704(F) |

### `fee.photograph_charges`
| State | Basis | Value | Citation |
|---|---|---|---|
| FL | soft-standard; fixed room expense | Supervision charge at a rate agreed by the parties (else set by custodian); expense of any separate room/place paid by the requester | § 119.07(4)(e)1.,2., Fla. Stat. |

### `fee.lowest_cost_effort`
| State | Basis | Value | Citation |
|---|---|---|---|
| VA | soft-standard | Reasonable efforts to supply the requested records at the lowest possible cost | Va. Code § 2.2-3704(F) |

### `fee.commercial_purpose_rate`
| State | Basis | Value | Citation |
|---|---|---|---|
| AZ | soft-standard | May include a portion of the cost of the original/copies, a reasonable fee for time/materials/equipment/personnel, and the reproduction's commercial-market value | Ariz. Rev. Stat. § 39-121.03(A) |

### `fee.copy_charge_standard`
| State | Basis | Value | Citation |
|---|---|---|---|
| AZ | soft-standard | May charge a fee for copies if facilities available; no statutory per-page rate for ordinary requests — the public body sets the amount | Ariz. Rev. Stat. § 39-121.01(D)(1) |

### `fee.rate_ceiling_ag_rules`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | ceiling | May not exceed AG-established amounts; a non-state body setting its own charges may not exceed AG amounts by more than 25% absent an exemption | Tex. Gov't Code § 552.262(a),(c) |

### `payment.advance_deposit_before_production__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| TX | fixed | Deposit/bond after itemized estimate when charge exceeds $100 (>15 FTE) or $50 (<16 FTE); also for prior unpaid amounts exceeding $100 | Tex. Gov't Code § 552.263(a),(a-1) |

### `appeal.admin.filing_deadline__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| NY | fixed | 30 days from the denial to file the written administrative appeal | N.Y. Pub. Off. Law § 89(4)(a) |

### `appeal.admin.filing_deadline__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| IL | fixed | Within 60 days of the final denial to file a PAC request for review | 5 ILCS 140/9.5(a) |

### `appeal.admin.determination_deadline__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| NY | fixed | 10 business days from receipt of the appeal to explain further denial or provide access | N.Y. Pub. Off. Law § 89(4)(a) |

### `appeal.admin.determination_deadline__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| IL | fixed | 60 days from receipt of the request for review for the AG to issue a binding opinion | 5 ILCS 140/9.5(f) |

### `appeal.admin.cooperation_forwarding__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| IL | fixed | Within 7 business days of receiving the request for review, provide the records to the PAC and fully cooperate | 5 ILCS 140/9.5(c) |

### `appeal.judicial.procedure_timing__1`
| State | Basis | Value | Citation |
|---|---|---|---|
| VA | fixed | Petition heard within 7 days of being made; at least 3 working days' notice to the defendant; docket precedence | Va. Code § 2.2-3713(D) |

### `appeal.judicial.procedure_timing__2`
| State | Basis | Value | Citation |
|---|---|---|---|
| WA | fixed | Action filed within 1 year of the agency's claim of exemption or the last partial/installment production | RCW 42.56.550(6) |

### `response.special_requester_windows`
| State | Basis | Value | Citation |
|---|---|---|---|
| IL | fixed | Commercial: 21 working days; recurrent: 21 business days; voluminous: 5 business days initial, then requester's 10-business-day response and final response within 5 business days | 5 ILCS 140/3.1(a); 3.2(a); 3.6 |


## Structural catalog (process paths / forks)

- **`eligibility.any_person__1`** (TX, CA, NY, FL, IL, WA) — eligibility gate: right of access open to any person, no enumerated requester class
- **`eligibility.no_purpose_requirement__1`** (TX, CA, NY, FL, IL, WA) — intake gate: no purpose/reason may be required or inquired into
- **`eligibility.no_residency_requirement`** (TX, CA, NY, FL, IL, WA, AZ) — eligibility gate: no residency/citizenship qualifier on the right to request
- **`intake.no_form_required__2`** (IL, WA) — intake channel: no mandatory standard form / prescribed format
- **`intake.examine_or_copy_option`** (AZ, VA) — intake branch: inspect-in-person vs receive-copies, at requester's option
- **`intake.reasonably_describes_identifiable`** (CA, NY, VA, WA) — intake gate: duty attaches only on reasonably-described identifiable records
- **`custody.foia_officer_designation`** (IL, VA, WA) — org/role node: designate and publicly identify a records/FOIA officer
- **`classification.presumption_of_openness`** (NY, IL, FL) — classification default: all records presumed open except enumerated exemptions
- **`production.promptly__1`** (TX, CA, AZ) — production stage: soft-standard 'promptly / reasonable time' production clock
- **`denial.deemed_denial_on_nonresponse`** (NY, IL, VA, AZ) — terminal branch: timely-response lapse = deemed/constructive denial
- **`clarification.request_permitted`** (TX, WA) — clarification branch: body may ask requester to clarify an unclear request
- **`redaction.segregability__1`** (CA, FL, VA, WA) — production step: redact exempt portions, produce the segregable remainder
- **`fee.no_search_review_labor_overhead__1`** (NY, IL, CA) — fee rule: search/review/administrative time not chargeable to requester
- **`fee.estimate_itemized_statement__1`** (TX, NY) — communication step: itemized cost estimate on threshold/request
- **`payment.advance_deposit_before_production__4`** (AZ, CA) — payment gate: condition release of copies on advance payment
- **`production.format_medium__1`** (CA, IL, VA, NY, FL) — production option: deliver in requested/available electronic format or medium
- **`production.no_duty_create_new_record__1`** (NY, VA) — duty limit: no obligation to create a record not possessed/maintained
- **`production.no_duty_create_new_record__2`** (NY, VA) — duty limit: retrieval/programming/excision is not creation of a new record
- **`denial.written_form__1`** (CA, IL) — denial step: denial issued in writing
- **`denial.cite_exemption_particularized__1`** (IL, WA, FL) — denial step: cite specific exemption + particularized factual/legal basis
- **`denial.cite_exemption_particularized__2`** (VA, AZ) — denial step: withholding index / per-category specific-citation particularity
- **`burden.agency_justify_exemption`** (IL, CA, VA) — burden rule: agency bears burden to justify withholding
- **`appeal.judicial.enforcement_right__1`** (CA, IL, VA) — appeal branch: judicial enforcement via mandate/injunctive/declaratory relief
- **`appeal.judicial.enforcement_right__2`** (NY, AZ, WA) — appeal branch: judicial enforcement via Article 78 / special action / show-cause
- **`eligibility.any_person__2`** (AZ) — eligibility gate: any person may inspect (no qualification)
- **`eligibility.no_purpose_requirement__2`** (VA) — intake gate: no purpose required (name/legal address only)
- **`eligibility.no_purpose_requirement__3`** (AZ) — intake gate: no purpose required except commercial-purpose affirmation
- **`eligibility.no_distinction_among_requesters`** (WA) — eligibility rule: no distinction among persons requesting records
- **`eligibility.requester_class_restricted`** (VA) — eligibility gate: standing restricted to enumerated classes (citizens/press)
- **`eligibility.incarcerated_exclusion`** (TX) — eligibility carve-out: incarcerated requester/agent excluded
- **`intake.written_request_required__1`** (TX) — intake gate: written request via approved delivery methods triggers duty
- **`intake.written_request_required__2`** (NY) — intake gate: written request triggers the response clock
- **`intake.no_form_required__1`** (FL) — intake channel: no writing/form/in-person/ID may be required
- **`intake.oral_request_permitted`** (IL) — intake channel: oral requests may be honored
- **`intake.email_multichannel_accepted__1`** (NY) — intake channel: accept and respond by email
- **`intake.email_multichannel_accepted__2`** (WA) — intake channel: in-person/mail/email requests honored
- **`intake.request_form_available`** (NY) — resource node: oversight-published internet request form
- **`intake.designated_address`** (TX) — intake channel: single designated mailing/email address for requests
- **`intake.overbreadth_not_sole_denial`** (WA) — denial guard: overbreadth may not be the sole basis for denial
- **`intake.bot_request_denial`** (WA) — intake gate: bot-request denial where excessive interference is shown
- **`intake.no_statutory_citation_required`** (VA) — intake rule: no need to cite the act to invoke it or its clocks
- **`intake.identification_allowed`** (VA) — intake field: name and legal address may be required
- **`intake.commercial_purpose_statement_required`** (AZ) — intake field: commercial-purpose affirmation/statement at request time
- **`intake.receipt_date_computation`** (IL) — intake step: record receipt date and compute the due date
- **`custody.duty_to_permit_inspection`** (FL) — custody duty: permit inspection/copying at reasonable time under supervision
- **`custody.designee_disclosure`** (FL) — org/role node: may designate a designee but must disclose their identity
- **`custody.contractor_records`** (FL) — custody scope: contractor keep/provide/transfer public records
- **`coverage.local_agency`** (CA) — coverage definition: covered 'local agency'
- **`coverage.public_record_definition`** (CA) — coverage definition: 'public record' regardless of physical form
- **`classification.recurrent_requester_definition`** (IL) — classification definition: recurrent-requester volume thresholds (50/12mo, 15/30d, 7/7d)
- **`classification.voluminous_request_definition`** (IL) — classification definition: voluminous-request thresholds (>5 requests/>5 categories or >500 pages)
- **`classification.commercial_purpose_definition`** (AZ) — classification definition: 'commercial purpose'
- **`inspection.self_copy_own_device__1`** (CA) — inspection option: self-copy with own device on premises, no physical contact
- **`inspection.self_copy_own_device__2`** (AZ) — inspection option: self-copy when custodian lacks facilities, under supervision
- **`production.promptly__2`** (WA) — production stage: soft-standard 'promptly / most timely possible action'
- **`response.options_enumerated`** (WA) — response branch: one of five enumerated response forms incl. time estimate
- **`communication.acknowledgment_response_duty__1`** (NY) — communication step: written acknowledgement with an approximate date
- **`communication.acknowledgment_response_duty__2`** (CA) — communication step: state the estimated availability date on a grant
- **`communication.acknowledgment_response_duty__3`** (FL) — communication step: prompt, good-faith acknowledgement
- **`deadline.determination_extension__3`** (WA) — extension grounds: clarify / locate-assemble / third-party notice / exemption review
- **`communication.extension_notice__1`** (CA) — communication step: written extension notice stating reasons and expected date
- **`communication.extension_notice__2`** (IL) — communication step: extension notice with reasons and forthcoming date within 5 business days
- **`deadline.extension_by_agreement`** (IL) — extension branch: extend compliance time by written agreement of the parties
- **`deadline.court_petition_additional_time`** (VA) — extension branch: petition court for more time on extraordinary requests
- **`communication.delay_certification_date_certain__1`** (TX) — communication step: certify inability to produce and set a date/hour certain
- **`clarification.duty_to_assist_identify`** (CA) — clarification duty: assist to identify records; satisfied after reasonable effort
- **`clarification.confer_before_burden_denial`** (IL) — clarification step: offer to confer to narrow before an unduly-burdensome denial
- **`clarification.consequences_notice`** (TX) — communication step: clarification request must state consequences of nonresponse
- **`withdrawal.clarification_nonresponse__2`** (WA) — terminal branch: no response duty if wholly-unclear request goes unclarified (clear portions still answered)
- **`withdrawal.abandonment_fail_inspect_or_pay__2`** (WA) — terminal branch: balance of request not fulfilled on an unclaimed installment
- **`deadline.tolling_pending_requester_response__1`** (TX) — clock rule: tolls the AG-request clock during a good-faith clarification
- **`deadline.tolling_pending_requester_response__2`** (VA) — clock rule: tolls response period during cost-estimate / advance-determination wait
- **`review.ag_decision_required`** (TX) — review branch: must seek AG decision to withhold, absent a prior determination
- **`denial.deemed_disclosure_on_noncompliance`** (TX) — terminal branch: untimely AG request/notice → information presumed public
- **`redaction.ssn_no_ag`** (TX) — redaction rule: SSN redaction permitted without an AG decision
- **`redaction.segregability__2`** (NY) — production step: delete identifying details / segregate accessible electronic items
- **`fee.copy_actual_cost_ceiling__3`** (FL) — fee definition: 'actual cost of duplication' = materials/supplies, excludes labor/overhead
- **`fee.small_request_labor_bar`** (TX) — fee rule: 50-or-fewer pages limited to per-page charge, no labor/overhead
- **`fee.no_search_review_labor_overhead__2`** (WA) — fee rule: no salaries/benefits/general-overhead in actual copy cost
- **`fee.no_search_review_labor_overhead__3`** (VA) — fee rule: no extraneous/intermediary/surplus fees for general costs
- **`fee.estimate_itemized_statement__2`** (VA) — communication step: pre-search cost notice and estimate on request
- **`fee.estimate_itemized_statement__3`** (IL) — communication step: accounting of §6(f) fees, costs, and personnel hours
- **`fee.waiver_public_interest__1`** (TX) — fee waiver: public-interest waiver / collection-cost-exceeds-charge waiver
- **`fee.waiver_public_interest__2`** (IL) — fee waiver: public-interest reduced or no charge on stated purpose
- **`fee.statutory_categorical_exemption__1`** (AZ) — fee waiver: statutory categories (federal-benefit claims, crime-victim records) at no charge
- **`fee.statutory_categorical_exemption__2`** (VA) — fee waiver: FERPA scholastic records exempt from reasonable-charge provisions
- **`fee.data_extraction_cost_shift`** (CA) — fee rule: requester bears data compilation/extraction/programming cost
- **`fee.actual_cost_statement_prereq`** (WA) — fee prerequisite: actual copy costs chargeable only per a published cost statement
- **`payment.advance_deposit_before_production__3`** (IL) — payment gate: full prepayment before copying for commercial/recurrent requests
- **`payment.electronic_method`** (VA) — payment channel: local body may offer an electronic payment method
- **`production.certification_or_no_record__1`** (NY) — production step: certify copy correctness, or certify no record after diligent search
- **`production.certification_or_no_record__2`** (VA) — production step: state records not found/nonexistent and refer to the holding body
- **`production.format_medium__2`** (AZ) — production option: native electronic format including embedded metadata
- **`production.format_medium__3`** (VA) — production option: electronic database records in a used format at reasonable cost
- **`production.format_medium__4`** (NY) — production rule: computer-format records shall not be encrypted
- **`production.electronic_retrieval_required`** (NY) — production rule: electronic retrieval/extraction required when feasible / preferred when faster
- **`production.website_redirect`** (CA) — production option: satisfy via website redirect, provide copy if inaccessible
- **`production.installment_basis`** (WA) — production option: partial/installment delivery as records are assembled
- **`production.electronic_reasonable_access_policy`** (FL) — production policy: reasonable public access to electronically maintained records
- **`production.crime_victim_priority`** (AZ) — production priority: prioritize processing of requested police reports
- **`denial.burdensome_standard__1`** (IL) — denial standard: unduly-burdensome test — no narrowing + burden outweighs public interest
- **`denial.burdensome_standard__2`** (NY) — denial guard: no voluminous/burdensome denial where outside service is available
- **`denial.written_form__2`** (WA) — denial step: written statement of the specific reasons for denial
- **`denial.cite_exemption_particularized__3`** (NY) — denial rule: particularized/specific justification, not category-based
- **`denial.identify_responsible_persons`** (CA) — denial step: name and title/position of each person responsible for the denial
- **`denial.notify_appeal_rights`** (IL) — denial step: inform of PAC review and judicial-review rights
- **`appeal.admin.review_right__1`** (NY) — appeal branch: written administrative appeal to agency head/governing body
- **`appeal.admin.review_right__2`** (IL) — appeal branch: request for review with the Public Access Counselor
- **`appeal.admin.review_right__3`** (WA) — appeal branch: internal review, deemed complete at end of 2nd business day (final agency action)
- **`appeal.admin.cooperation_forwarding__1`** (NY) — appeal step: forward the appeal and determination to oversight (Committee on Open Government)
- **`appeal.admin.constructive_denial`** (NY) — terminal branch: failure to conform to appeal provisions constitutes a denial
- **`appeal.judicial.enforcement_right__3`** (IL) — appeal venue: circuit court at the body's principal office or requester's residence
- **`appeal.judicial.in_camera_special__1`** (FL) — judicial procedure: in camera inspection of asserted-exempt records
- **`appeal.judicial.in_camera_special__2`** (WA) — judicial procedure: third-party affidavit motion to enjoin inspection
- **`appeal.judicial.charge_estimate_review`** (WA) — judicial procedure: petition to review time estimate / copy charges (agency shows reasonableness)
- **`handling.no_delay_obstruct__1`** (CA) — handling rule: no delay or obstruction of inspection/copying
- **`handling.no_delay_obstruct__2`** (FL) — handling rule: only limited reasonable retrieve/redact delay; policy delay = constructive denial
- **`handling.no_third_party_control`** (CA) — handling rule: no third-party control over disclosure of disclosable info
- **`communication.third_party_notice`** (WA) — communication option: discretionary notice to persons named in the record
- **`fee.commercial_list_prohibition`** (WA) — disclosure carve-out: no lists of individuals provided for commercial purposes
- **`preservation.hold_pending_request__1`** (FL) — preservation rule: 30-day hold on a requested record against disposal
- **`preservation.hold_pending_request__2`** (WA) — preservation rule: retain a record scheduled for destruction until the request resolves
- **`communication.special_requester_notice`** (IL) — communication step: commercial/recurrent classification notice and response options
- **`review.commercial_misuse_governor_order`** (AZ) — review branch: governor-order pause for suspected commercial misuse (30-day)
- **`communication.determination_with_reasons`** (CA) — communication step: prompt notice of the determination and its reasons