# Arizona — wave 1 vs wave 2 (process consistency check)

Arizona was researched twice under the same refined V2 contract: once in the wave-1 run (~2026-07-20) and again in wave 2 (2026-07-21). This compares the two pulls to see how stable and repeatable the gathering process is.

| Metric | Wave 1 | Wave 2 |
|---|---:|---:|
| Rules | 22 | 27 |
| Verbatim captured | 21 | 22 |
| Distinct concept_keys | 22 | 27 |
| Material negatives | 7 | 8 |
| Structural branches | 7 | 9 |

## Category coverage

| Category | Wave 1 | Wave 2 |
|---|---:|---:|
| Appeals | 1 | 2 |
| Classification | 2 | 0 |
| Denials | 2 | 3 |
| Eligibility | 3 | 3 |
| Fees | 5 | 4 |
| Inspection | 1 | 1 |
| Intake | 2 | 4 |
| Payment | 1 | 2 |
| Production | 4 | 3 |
| Redaction | 0 | 1 |
| Review | 1 | 1 |
| Special Records | 0 | 3 |

## Concept overlap

- **Shared concept_keys (both runs): 6**
- Only in wave 1: 16
- Only in wave 2: 21

### Concepts wave 2 did NOT reproduce from wave 1

- `classification.commercial_purpose_statement`
- `denials.deemed_denial_nonresponse`
- `denials.withholding_index_on_request`
- `fee.commercial_purpose_rate_basis`
- `fee.copy_charge_standard`
- `fee.statutory_purpose_waiver`
- `fee.waiver_crime_victim_records`
- `fee.waiver_federal_benefit_claims`
- `inspection.during_office_hours`
- `intake.request_channels`
- `payment.advance_payment_for_mailed_copies`
- `production.access_to_copy_when_no_facilities`
- `production.crime_victim_report_priority`
- `production.native_format_with_metadata`
- `response.prompt_furnishing_deadline`
- `review.commercial_misuse_governor_order`

### New concepts wave 2 surfaced that wave 1 missed

- `appeal.judicial.victim_special_action_in_criminal_case`
- `definition.public_body_coverage`
- `denial.constructive_denial_nonresponse`
- `denial.index_agency_scope_exception`
- `denial.index_privileged_exclusion`
- `denial.withholding_index`
- `fee.commercial_purpose_surcharge`
- `fee.copy_charge`
- `fee.waiver_claims_against_united_states`
- `fee.waiver_crime_victim_police_report`
- `inspection.office_hours_availability`
- `intake.commercial_purpose_statement`
- `intake.mail_copy_website_carveout`
- `intake.request_methods`
- `payment.advance_payment_mailed_copies`
- `payment.commercial_fee_precondition_to_release`
- `production.electronic_records_native_format_metadata`
- `production.onsite_copying_no_facilities`
- `production.response_promptness`
- `review.administrative.governor_commercial_purpose_petition`
- `special_records.crime_victim_report_priority`

> Note: concept_keys are coined per-run before reconciliation, so different slugs can still describe the same lever. Treat non-overlap as "worth reconciling," not necessarily "disagreement."