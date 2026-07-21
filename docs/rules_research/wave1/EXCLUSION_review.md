# Wave-1 exclusion review sheet

Purpose: mark the rule types to **exclude** before reconciliation, to cut noise and Verify cost. Tick a box to drop that concept (or a whole family). In the morning, either edit this file directly or just send me the list of `candidate_key`s / families to exclude — I'll wire them into `rules-wave-safe.js` (the `EXCLUDE` block) and re-render.

- **107 candidate concepts** across **25 families**, from **366 rules**.

## Fast path — exclude by family

| Exclude | Family | Concepts | States touched | Example concept |
|:--:|---|--:|---|---|
| [ ] | **abandonment** | 3 | 3 | `abandonment.clarification_nonresponse` |
| [ ] | **appeal** | 13 | 9 | `appeal.judicial.right_to_sue` |
| [ ] | **clarification** | 1 | 5 | `clarification.assist_confer_revise` |
| [ ] | **classification** | 2 | 4 | `classification.presumption_of_openness` |
| [ ] | **communication** | 1 | 5 | `communication.delay_notice_estimated_date` |
| [ ] | **coverage** | 1 | 1 | `coverage.definitions` |
| [ ] | **custody** | 3 | 6 | `custody.records_officer_designation` |
| [ ] | **deadline** | 12 | 10 | `deadline.initial_response_window` |
| [ ] | **delivery** | 1 | 1 | `delivery.mail_electronic_transmission_caps` |
| [ ] | **denial** | 6 | 10 | `denial.reasons_and_exemption_citation` |
| [ ] | **disclosure** | 1 | 1 | `disclosure.commercial_list_prohibition` |
| [ ] | **eligibility** | 4 | 10 | `eligibility.no_purpose_requirement` |
| [ ] | **enforcement** | 3 | 4 | `enforcement.no_obstruction` |
| [ ] | **fee** | 19 | 10 | `fee.copy_duplication_charge` |
| [ ] | **inspection** | 3 | 6 | `inspection.requester_self_copy` |
| [ ] | **intake** | 7 | 9 | `intake.writing_requirement` |
| [ ] | **payment** | 6 | 9 | `payment.advance_prepayment_before_copies` |
| [ ] | **preservation** | 1 | 3 | `preservation.retention_hold` |
| [ ] | **production** | 7 | 9 | `production.format_and_medium_choice` |
| [ ] | **records** | 1 | 1 | `records.retention_schedule_available` |
| [ ] | **redaction** | 3 | 8 | `redaction.segregability` |
| [ ] | **review** | 3 | 3 | `review.ag_enforcement_authority` |
| [ ] | **routing** | 1 | 1 | `routing.civil_litigant_counsel_copy` |
| [ ] | **scope** | 1 | 4 | `scope.reasonably_identifiable` |
| [ ] | **search** | 4 | 6 | `search.electronic_retrieval_efficiency` |

### Raw-category reference (rule counts)

| Exclude | Category | Rules |
|:--:|---|--:|
| [ ] | Fees | 72 |
| [ ] | Intake | 39 |
| [ ] | Production | 38 |
| [ ] | Deadlines | 32 |
| [ ] | Denials | 26 |
| [ ] | Appeals | 25 |
| [ ] | Communications | 17 |
| [ ] | Eligibility | 16 |
| [ ] | Payment | 15 |
| [ ] | Custody/Routing | 15 |
| [ ] | Clarification | 14 |
| [ ] | Review | 14 |
| [ ] | Redaction | 13 |
| [ ] | Search | 8 |
| [ ] | Inspection | 6 |
| [ ] | Classification | 6 |
| [ ] | Enforcement | 5 |
| [ ] | Special Records | 3 |
| [ ] | Coverage | 2 |

---
## Detailed — exclude by concept

### abandonment (3 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `abandonment.clarification_nonresponse` | TX WA | Request deemed withdrawn on requester&#x27;s failure to respond to a clarification request (terminal). |
| [ ] | `abandonment.cost_estimate_nonresponse` | TX VA | Request deemed withdrawn on requester&#x27;s failure to respond to a cost/itemized estimate (terminal). |
| [ ] | `abandonment.failure_to_claim_or_pay` | TX WA | Request deemed withdrawn/unfulfilled on failure to inspect, claim, or pay (terminal). |

### appeal (13 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `appeal.judicial.right_to_sue` | AZ CA GA IL OH VA WA | Judicial enforcement path (mandamus/injunction/declaratory/special action) and venue. |
| [ ] | `appeal.admin.review_path_exists` | IL NY OH WA | Existence of an administrative review path for a denial (agency head, PAC, court of claims, internal review). |
| [ ] | `appeal.admin.reviewer_decision_deadline` | IL NY OH | Deadlines for the reviewer/public body to respond, decide, report, or object in the administrative review. |
| [ ] | `appeal.burden_on_public_body` | IL NY VA | Agency bears the burden to prove an exemption applies. |
| [ ] | `appeal.admin.requester_filing_deadline` | IL NY | Requester&#x27;s window to file an administrative appeal/review. |
| [ ] | `appeal.admin.filing_fee` | OH | Filing fee for an administrative complaint. |
| [ ] | `appeal.admin.mediation` | OH | Complaint referred to mediation. |
| [ ] | `appeal.admin.oversight_notification` | NY | Agency must forward appeal/determination to an oversight body. |
| [ ] | `appeal.judicial.charge_estimate_review` | WA | Judicial review of an agency&#x27;s time estimate or copying charges. |
| [ ] | `appeal.judicial.expedited_hearing_precedence` | VA | Expedited hearing timeframe and docket precedence for enforcement actions. |
| [ ] | `appeal.judicial.in_camera_review` | FL | In camera inspection of contested records by the court. |
| [ ] | `appeal.judicial.limitations_period` | WA | Limitations period to file a judicial-review action. |
| [ ] | `appeal.judicial.third_party_injunction` | WA | Agency/third party may move to enjoin inspection of a specific record. |

### clarification (1 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `clarification.assist_confer_revise` | CA IL OH TX WA | Agency may/must clarify, assist identifying, confer to narrow, or give chance to revise. |

### classification (2 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `classification.presumption_of_openness` | FL IL NY | All records presumed open/available except enumerated exceptions. |
| [ ] | `classification.commercial_purpose` | AZ | Commercial-purpose affirmation/statement requirement and definition. |

### communication (1 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `communication.delay_notice_estimated_date` | CA GA NY TX WA | When production is delayed, notify requester with reason and an estimated/certain date of availability. |

### coverage (1 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `coverage.definitions` | CA | Definitions of covered agency and public record. |

### custody (3 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `custody.records_officer_designation` | GA IL VA WA | Agency designates/publicly identifies a FOIA/records officer point of contact. |
| [ ] | `custody.custodian_designee_duties` | FL GA OH | Custodian/person-responsible duty to permit access; designee disclosure; absence no delay. |
| [ ] | `custody.contractor_vendor_records` | FL GA | Contractor/vendor duties to keep, provide, transfer, and not impede access to public records. |

### deadline (12 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `deadline.initial_response_window` | AZ CA FL GA IL NY OH TX VA WA | First statutory deadline to respond/determine/produce/acknowledge (fixed day-counts and soft promptly). |
| [ ] | `deadline.production_soft_standard` | CA FL GA OH WA | Downstream soft production/availability timing (promptly / reasonable time / as soon as practicable / most timely). |
| [ ] | `deadline.extension` | CA IL VA WA | Extension of the response deadline (for cause, by written notice, by agreement, or by court petition). |
| [ ] | `deadline.clock_start_computation` | GA IL | When the response clock starts / due-date computation and notation. |
| [ ] | `deadline.clock_tolling` | TX VA | Response/decision clock tolls during pendency of clarification, cost estimate, or deposit. |
| [ ] | `deadline.record_class_specific_window` | GA VA | Extended response window keyed to a specific record class (criminal investigative files, intercollegiate sports). |
| [ ] | `deadline.ag_brief_and_comments` | TX | Deadline to submit AG brief/comments and copy the requestor. |
| [ ] | `deadline.ag_decision_render` | TX | Deadline for the AG to render the decision (with extension). |
| [ ] | `deadline.ag_request_and_notice` | TX | Deadline to request the AG decision and give the requestor the withholding/notice. |
| [ ] | `deadline.commercial_request_window` | IL | Response window/options for commercial-purpose requests. |
| [ ] | `deadline.recurrent_requester_handling` | IL | Recurrent-requester response window, notice, and definition. |
| [ ] | `deadline.voluminous_request_handling` | IL | Voluminous-request response windows, requester-response window, and definition. |

### delivery (1 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `delivery.mail_electronic_transmission_caps` | OH | Mail/electronic transmission of copies permitted; monthly volume caps with non-commercial certification exception. |

### denial (6 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `denial.reasons_and_exemption_citation` | AZ CA FL GA IL NY OH VA WA | Denial/withholding must state particularized reasons, cite the specific exemption/legal authority, and describe withheld records. |
| [ ] | `denial.deemed_denial_on_nonresponse` | AZ FL IL NY VA | Failure to timely respond is deemed/constitutes a denial (opening review). |
| [ ] | `denial.written_form` | CA IL OH WA | A denial must be in writing. |
| [ ] | `denial.exemption_waiver_on_lapse` | TX | Information presumed public/must be released when the agency misses the AG-request/notice deadline. |
| [ ] | `denial.identify_responsible_persons` | CA | Denial must name persons responsible for the denial. |
| [ ] | `denial.notify_review_rights` | IL | Denial notice must inform requester of PAC/judicial review rights. |

### disclosure (1 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `disclosure.commercial_list_prohibition` | WA | No providing lists of individuals for commercial purposes absent authorization. |

### eligibility (4 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `eligibility.no_purpose_requirement` | AZ CA FL GA IL NY OH TX VA WA | Requester need not state a reason/purpose to obtain records. |
| [ ] | `eligibility.requester_standing` | AZ CA FL GA IL NY OH TX VA WA | Who has standing to request (open to any person / no residency-citizenship requirement, or restricted requester class). |
| [ ] | `eligibility.identity_disclosure` | OH VA | Whether the agency may require/condition access on requester identity. |
| [ ] | `eligibility.incarcerated_requester` | OH TX | Special handling/exclusion of requests from incarcerated persons. |

### enforcement (3 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `enforcement.no_obstruction` | CA FL | No delay/obstruction; no third-party control of disclosure; good-faith handling. |
| [ ] | `enforcement.pre_suit_cure_period` | OH | Pre-suit cure period after a complaint is served before the requester may proceed. |
| [ ] | `enforcement.written_request_gates_remedies` | GA | Enforcement/penalty remedies available only for written requests. |

### fee (19 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `fee.copy_duplication_charge` | AZ CA FL GA IL NY OH TX VA WA | The copy/duplication fee: per-page rate or actual-cost basis, paper and electronic media, surcharges, flat-fee option, actual-cost defini… |
| [ ] | `fee.no_search_review_charge` | CA IL NY TX WA | No charge for search/review/inspection labor. |
| [ ] | `fee.cost_estimate_itemized_notice` | GA NY TX VA | Duty to give an itemized/cost estimate (over a threshold or on request) before charging/searching; estimate cost credited. |
| [ ] | `fee.special_service_data_extraction` | CA FL NY WA | Special/extraordinary service charge for data compilation, extraction, programming, or outside professional service. |
| [ ] | `fee.labor_free_threshold` | GA NY TX | Free labor increment/allowance before any labor charge (first quarter hour / two hours / hour allowances). |
| [ ] | `fee.certified_copy_charge` | FL IL | Fee for a certified copy. |
| [ ] | `fee.labor_rate_lowest_paid` | GA NY | Labor/search-retrieval-redaction rate capped at the lowest-paid qualified employee&#x27;s hourly salary. |
| [ ] | `fee.no_charge_special_cases` | NY WA | No copy charge for reused recent records or website-posted records. |
| [ ] | `fee.no_overhead_general_cost` | VA WA | No recoupment of overhead/general administrative costs. |
| [ ] | `fee.special_record_type_rate` | OH VA | Fee rate keyed to a special record type (GIS/topo maps, video production). |
| [ ] | `fee.statutory_purpose_waiver` | AZ VA | No-charge for enumerated purposes/records (federal benefit claims, crime-victim, scholastic/FERPA). |
| [ ] | `fee.waiver_public_interest` | IL TX | Fee waiver/reduction when disclosure primarily benefits the public interest. |
| [ ] | `fee.commercial_purpose_rate` | AZ | Fee basis for commercial-purpose reproductions (cost, reasonable fee, commercial-market value). |
| [ ] | `fee.commercial_search_charge` | IL | Search/retrieval labor charge for commercial requests, free-hour allowance, and accounting. |
| [ ] | `fee.free_page_allowance` | IL | Initial pages provided free of copy charge. |
| [ ] | `fee.photograph_supervision` | FL | Charges for supervising photographing of records and for room expense. |
| [ ] | `fee.specific_statutory_fee_controls` | GA | A specific statutory fee, where prescribed, controls over the general charges. |
| [ ] | `fee.voluminous_electronic_data_tiers` | IL | Tiered fee caps by data size for voluminous electronic-record requests. |
| [ ] | `fee.waiver_when_collection_exceeds` | TX | Charge may be waived when collection cost exceeds the charge. |

### inspection (3 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `inspection.requester_self_copy` | AZ CA GA OH | Whether requester may make own copies (own device / when custodian lacks facilities / not required). |
| [ ] | `inspection.availability_hours` | AZ CA TX | Records available for inspection during normal/office business hours. |
| [ ] | `inspection.reasonable_conditions_supervision` | FL | Inspection at reasonable time, under reasonable conditions and custodian supervision. |

### intake (7 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `intake.writing_requirement` | FL GA IL NY OH TX | Whether a request must be in writing vs oral/optional. |
| [ ] | `intake.request_channels` | AZ GA NY WA | Which submission channels must be accepted (mail, email, fax, in person). |
| [ ] | `intake.designated_recipient` | GA TX | Agency may designate the address/individual to which requests must be directed. |
| [ ] | `intake.no_standard_form` | IL WA | Agency may not require a particular/standard form or official format. |
| [ ] | `intake.bot_request` | WA | Handling/denial of automated bot requests. |
| [ ] | `intake.no_magic_words_required` | VA | Request need not cite the statute to invoke it/its deadlines. |
| [ ] | `intake.request_form_provided` | NY | A public request form is developed/made available. |

### payment (6 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `payment.advance_prepayment_before_copies` | AZ CA IL NY OH | Agency may condition/require payment before providing copies. |
| [ ] | `payment.deposit_for_anticipated_costs` | GA TX VA WA | Deposit/bond/prepayment required when estimated cost exceeds a threshold. |
| [ ] | `payment.prepayment_for_prior_unpaid` | GA TX | Deposit/prepayment required for amounts unpaid on prior requests. |
| [ ] | `payment.collection_of_incurred_costs` | GA | Agency may collect agreed, lawfully-incurred costs regardless of pickup. |
| [ ] | `payment.deferral_pending_cost_agreement` | GA | Agency may defer search/retrieval until requester agrees to pay estimated costs. |
| [ ] | `payment.electronic_method` | VA | Local body may offer an electronic payment method. |

### preservation (1 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `preservation.retention_hold` | FL GA WA | Hold/retain records against destruction pending a request; no destruction to prevent disclosure. |

### production (7 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `production.format_and_medium_choice` | AZ CA FL GA IL NY OH VA | Produce in the medium/electronic format requested (subject to what agency holds/regularly uses); inspect-vs-copy option. |
| [ ] | `production.partial_installment` | GA WA | Produce available records on a partial/installment basis within the window. |
| [ ] | `production.records_not_found` | NY VA | Response when records cannot be found/do not exist; certify or refer to another body. |
| [ ] | `production.third_party_affected_notice` | GA WA | Notice to third parties/submitters (trade-secret affidavit; discretionary affected-person notice). |
| [ ] | `production.website_in_lieu` | CA GA | Agency may satisfy production by directing requester to records posted on its website. |
| [ ] | `production.copies_in_lieu_for_redaction` | GA | Agency may provide copies in lieu of access when redaction of confidential info is required. |
| [ ] | `production.record_type_priority` | AZ | Priority processing for a specific record type (crime-victim police reports). |

### records (1 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `records.retention_schedule_available` | OH | Current records retention schedule kept publicly available. |

### redaction (3 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `redaction.segregability` | CA FL GA NY OH VA WA | Redact exempt portions and produce/segregate the non-exempt remainder. |
| [ ] | `redaction.pii_privacy_deletion` | GA NY TX | Delete/redact personal identifiers (SSN, PII) to prevent privacy invasion, without added process. |
| [ ] | `redaction.notice_of_redaction` | OH | Notify requester of any redaction / make it plainly visible. |

### review (3 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `review.ag_enforcement_authority` | GA | Attorney General discretionary authority to enforce and seek penalties. |
| [ ] | `review.ag_predisclosure_ruling_required` | TX | Agency must seek an AG decision before withholding absent a previous determination. |
| [ ] | `review.commercial_misuse_hold` | AZ | Custodian may seek a governor&#x27;s order barring commercial-misuse production; pauses up to 30 days. |

### routing (1 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `routing.civil_litigant_counsel_copy` | GA | Civil-litigant requests copied to agency counsel; duplicate set provided at no cost. |

### scope (1 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `scope.reasonably_identifiable` | CA NY VA WA | Request must reasonably describe an identifiable record before the duty attaches. |

### search (4 concepts)

| Exclude | Concept key | States | What it is |
|:--:|---|---|---|
| [ ] | `search.electronic_retrieval_efficiency` | GA NY OH VA | Duty to retrieve electronically with reasonable effort / organize records / use most economical means. |
| [ ] | `search.overbroad_burdensome_denial` | IL NY OH WA | Whether/when an overbroad, categorical, or unduly burdensome request may be denied. |
| [ ] | `search.no_duty_to_create_record` | GA NY VA | No duty to create a record that does not already exist. |
| [ ] | `search.programming_extraction_not_new_record` | GA NY VA | Programming/excision/query commands to extract or redact are not creation of a new record. |
