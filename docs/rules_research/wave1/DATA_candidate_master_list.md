# Wave 1 — candidate master list (cross-state concepts)

> ⚠️ **Pre-verification.** These are the clusterer's **107 candidate concepts** grouping the 366 state rules by shared *lever*. They have **not** yet passed the per-cluster Verify step, so some groups may still need splitting. The fully-verified 10-state master list is produced by finishing the resume run (see [`salvage/README.md`](salvage/README.md)). The older *verified* list in [`WAVE1_master_list.md`](WAVE1_master_list.md) covers only 8 states.

- **62 multi-state concepts** (real cross-state overlap)
- 45 single-state concepts

## Multi-state concepts

### `deadline.initial_response_window`  ·  AZ CA FL GA IL NY OH TX VA WA

First statutory deadline to respond/determine/produce/acknowledge (fixed day-counts and soft promptly).

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0007` |  | The custodian shall promptly furnish the requested copies, printouts or photographs (subject to fee/facility conditions). &#x27;Promptly&#x27; is an undefined standard; no fixed number of days is set by statute. |
| CA | `CA-0009` | fixed | Within 10 days of receiving a copy request, the agency must determine whether it seeks disclosable public records in its possession and promptly notify the requester of the determination and the reasons. |
| CA | `CA-0010` |  | The agency must promptly notify the requester of its determination and the reasons therefor. |
| FL | `FL-0007` |  | A custodian and any designee must acknowledge a request to inspect or copy records promptly. |
| GA | `GA-0011` | ceiling | An agency shall produce responsive records within a reasonable amount of time not to exceed three business days of receipt of the request; the agency is not required to produce records that did not exist at the time of the request. |
| IL | `IL-0010` | fixed | A public body must comply with or deny a written request within 5 business days after receipt, unless the time is properly extended. |
| NY | `NY-0009` | fixed | Within five business days of receipt of a written request, the agency shall grant access, deny the request in writing, or furnish a written acknowledgement of receipt with an approximate date. |
| OH | `OH-0007` | soft-standard | Responsive public records shall be promptly prepared and made available for inspection during regular business hours. |
| TX | `TX-0008` |  | The officer must produce public information promptly, i.e., as soon as possible under the circumstances, within a reasonable time, without delay. |
| VA | `VA-0007` | fixed | The custodian shall, promptly but in all cases within five working days of receiving a request, provide the records or make one of four written responses. |
| WA | `WA-0010` | fixed | Within five business days of receiving a request, the agency must respond in one of the five statutory ways. |
| WA | `WA-0011` |  | The initial response must take one of five forms: provide the record; provide a website link to it; acknowledge and give a reasonable time estimate; acknowledge and request clarification with an estimate; or deny. |

### `eligibility.no_purpose_requirement`  ·  AZ CA FL GA IL NY OH TX VA WA

Requester need not state a reason/purpose to obtain records.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0004` |  | A requester need not state a reason or purpose for a non-commercial request; the only purpose-related duty is to affirm the record is not for a commercial purpose (or, if it is, to provide the commercial-purpose statement under § 39-121.03). |
| CA | `CA-0002` |  | An agency may not condition or limit access to an otherwise-disclosable public record based on the purpose for which the record is requested; requesters need not state a reason. |
| FL | `FL-0003` |  | A custodian may not require the requester to state a reason or purpose for the request; the requester&#x27;s motivation does not affect the right of access. |
| GA | `GA-0002` |  | A requester need not state a reason or purpose to obtain general public records; a purpose/&#x27;need&#x27; showing is required only for enumerated special record types (e.g., motor vehicle accident reports). |
| IL | `IL-0002` |  | A public body may not require a requester to state the purpose of a request, except to determine commercial-purpose status or to rule on a fee-waiver request. |
| NY | `NY-0002` |  | A requester need not state a reason, need, good faith, or legitimate purpose to obtain accessible records. |
| OH | `OH-0002` |  | A public office may not condition availability of records on the requester disclosing the intended use of the record; requiring intended-use disclosure constitutes a denial. |
| TX | `TX-0002` |  | The governmental body may not inquire into the purpose for which the requested information will be used. |
| VA | `VA-0002` |  | A requester need not state a purpose or reason to obtain public records; the custodian may require only the requester&#x27;s name and legal address. |
| WA | `WA-0002` |  | A requester shall not be required to provide the purpose of the request, except to establish whether disclosure would violate the commercial-purpose list prohibition or another statute restricting disclosure to certain persons. |

### `eligibility.requester_standing`  ·  AZ CA FL GA IL NY OH TX VA WA

Who has standing to request (open to any person / no residency-citizenship requirement, or restricted requester class).

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0001` |  | Any person may inspect public records in the custody of any officer; the statute imposes no eligibility qualification (no residency, citizenship, standing, or purpose condition) on who may request. |
| AZ | `AZ-0003` |  | There is no residency, citizenship, or in-state requirement to request public records; the right extends to &#x27;any person.&#x27; |
| CA | `CA-0001` |  | Every person has a right to inspect any public record; the right to request/inspect is not limited to residents, citizens, or an enumerated class of requesters. |
| CA | `CA-0003` |  | Records must be made available to any person; there is no residency, citizenship, or in-state requirement to request records. |
| FL | `FL-0001` |  | Every person has the right to inspect or copy any public record made or received in connection with the official business of any public body, officer, or employee of the state (or persons acting on their behalf), except records exempted under this section or made confidential by the Constitution. |
| FL | `FL-0002` |  | The right of access runs to &#x27;every person&#x27; / &#x27;any person&#x27; with no residency or citizenship qualification; a custodian may not condition access on the requester being a Florida resident. |
| GA | `GA-0001` |  | All public records are open for personal inspection and copying by any person, except records specifically exempted by court order or by law; no requester qualification is imposed for general access. |
| GA | `GA-0003` |  | There is no Georgia residency or citizenship condition on the right to request public records; the right runs to any person. |
| IL | `IL-0001` |  | A public body must make all public records available to any person for inspection or copying, except records exempt under Sections 7 and 8.5. |
| IL | `IL-0003` |  | Any person may request public records; the Act imposes no residency or citizenship condition on the right of access. |
| NY | `NY-0001` |  | Any member of the public may request access to the records of government; access is a public right exercisable by any person. |
| NY | `NY-0003` |  | Accessible records are equally available to any person regardless of residency, citizenship, or status; an agency may not condition access on proof of residency or identity. |
| OH | `OH-0001` |  | Any person may request public records; upon such a request all responsive public records shall be promptly prepared and made available for inspection at all reasonable times during regular business hours. |
| OH | `OH-0004` |  | Access is available to any person with no residency limitation; the statute extends the right to &#x27;any person&#x27; without an Ohio-residency qualifier. |
| TX | `TX-0001` |  | Any person may apply to the officer for public information and the officer shall promptly produce public information for inspection, duplication, or both. |
| TX | `TX-0003` |  | There is no residency requirement; the right to request runs to &#x27;any person&#x27; regardless of residence. |
| VA | `VA-0001` |  | Public records are open only to citizens of the Commonwealth and to representatives of newspapers/magazines with circulation in, and radio/TV stations broadcasting in or into, the Commonwealth; the engine may restrict standing to these requester classes. |
| WA | `WA-0001` |  | Upon request for identifiable public records, the agency shall make them promptly available to any person. |
| WA | `WA-0003` |  | An agency shall not distinguish among persons requesting records. |
| WA | `WA-0004` |  | Records must be made available to any person with no residency or citizenship qualification. |

### `fee.copy_duplication_charge`  ·  AZ CA FL GA IL NY OH TX VA WA

The copy/duplication fee: per-page rate or actual-cost basis, paper and electronic media, surcharges, flat-fee option, actual-cost definition/prereq.

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0008` | soft-standard | The custodian may charge a fee for copies if facilities are available; the statute sets no numeric per-page rate for ordinary (non-commercial) requests — the public body sets the amount. |
| CA | `CA-0021` | ceiling | Fees for copies of records are limited to fees covering the direct costs of duplication, or a statutory fee if one applies. |
| CA | `CA-0022` | ceiling | The cost of duplicating an electronic record is limited to the direct cost of producing a copy of the record in an electronic format. |
| FL | `FL-0020` | ceiling | For duplicated copies of records not larger than 14 by 8.5 inches, the agency may charge up to 15 cents per one-sided copy. |
| FL | `FL-0021` | ceiling | For a two-sided copy, the agency may charge no more than an additional 5 cents. |
| FL | `FL-0022` | fixed | For all copies other than standard-size paper copies, the agency charges the actual cost of duplication of the public record. |
| FL | `FL-0023` |  | &#x27;Actual cost of duplication&#x27; means the cost of the material and supplies used to duplicate the record, and does not include labor cost or overhead cost associated with such duplication. |
| GA | `GA-0018` | ceiling | In addition to labor charges, an agency may charge for copying, not to exceed 10 cents per page for letter or legal size documents, or the actual cost of producing the copy for other document types. |
| GA | `GA-0019` | fixed | For electronic records, the agency may charge the actual cost of the media on which the records or data are produced. |
| IL | `IL-0028` | ceiling | The fee for black-and-white, letter- or legal-sized copies (after the free 50) may not exceed 15 cents per page. |
| IL | `IL-0029` | ceiling | For copies in color or in a size other than letter/legal, a public body may not charge more than its actual cost of reproduction. |
| IL | `IL-0031` | ceiling | For records provided in electronic format, a public body may charge the requester only the actual cost of purchasing the recording medium. |
| NY | `NY-0024` | ceiling | Fees for paper copies shall not exceed 25 cents per photocopy not exceeding 9 by 14 inches, unless a different fee is prescribed by statute. |
| NY | `NY-0025` | ceiling | For records other than 9x14 paper photocopies, the fee shall not exceed the actual cost of reproduction determined under § 87(1)(c). |
| OH | `OH-0018` | ceiling | Copies of public records shall be made available &#x27;at cost&#x27; — the office may not charge more than its actual cost of making the copy. |
| TX | `TX-0025` | soft-standard | The copy charge must be an amount that reasonably includes all costs related to reproducing the information, including materials, labor, and overhead. |
| TX | `TX-0027` | ceiling | Charges for copies/inspection may not exceed the amounts established by attorney general rule; a non-state governmental body setting its own charges may not exceed the AG-established amounts by more than 25% absent an exemption. |
| VA | `VA-0021` | ceiling | A public body may make reasonable charges not to exceed its actual cost incurred in accessing, duplicating, supplying, or searching for the requested records. |
| VA | `VA-0022` | soft-standard | The body shall make all reasonable efforts to supply the requested records at the lowest possible cost. |
| VA | `VA-0024` | ceiling | Any duplicating fee charged by a public body shall not exceed the actual cost of duplication. |
| WA | `WA-0020` | ceiling | A reasonable charge may be imposed for copies and for use of agency copying equipment, not exceeding the amount necessary to reimburse the agency for its actual costs directly incident to copying. |
| WA | `WA-0021` | ceiling | Absent a published actual-cost calculation, the agency may charge up to fifteen cents per page for photocopies or printed copies of electronic records. |
| WA | `WA-0022` | ceiling | Absent a published actual-cost calculation, the agency may charge up to ten cents per page for public records scanned into an electronic format. |
| WA | `WA-0023` | ceiling | Absent a published actual-cost calculation, the agency may charge up to five cents per each four electronic files or attachments uploaded for electronic delivery. |
| WA | `WA-0024` | ceiling | Absent a published actual-cost calculation, the agency may charge up to ten cents per gigabyte for transmission of records in an electronic format. |
| WA | `WA-0025` | ceiling | An agency may charge a flat fee of up to two dollars for a request as payment for the costs of providing the copies, in lieu of itemized charges. |
| WA | `WA-0027` |  | An agency may charge actual copying costs only in accordance with costs it has established and published; it may establish and make available a statement of the actual costs it charges for copies. |

### `denial.reasons_and_exemption_citation`  ·  AZ CA FL GA IL NY OH VA WA

Denial/withholding must state particularized reasons, cite the specific exemption/legal authority, and describe withheld records.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0011` |  | If requested, the custodian of the records of an &#x27;agency&#x27; shall furnish an index of the records or categories of records withheld and the reasons they were withheld, excluding information expressly made privileged/confidential by statute or court order. |
| CA | `CA-0028` |  | An agency must justify withholding any record by demonstrating that it is exempt under an express provision of the CPRA, or that on the facts of the particular case the public interest served by nondisclosure clearly outweighs the public interest served by disclosure. |
| FL | `FL-0018` |  | A custodian contending all or part of a record is exempt must state the basis of the exemption, including the statutory citation to the exemption. |
| FL | `FL-0019` |  | If the requester asks, the custodian must state in writing and with particularity the reasons for the conclusion that the record is exempt or confidential. |
| GA | `GA-0015` |  | When an agency withholds all or part of a record, it shall notify the requester of the specific legal authority for the exemption by Code section, subsection, and paragraph within three business days (or, if search/retrieval is delayed, no later than three business days after retrieval). |
| IL | `IL-0040` |  | The denial notice must specify the exemption claimed and the specific reasons for the denial, including a detailed factual basis and a citation to supporting legal authority. |
| NY | `NY-0034` |  | A denial of access is valid only when there is a particularized and specific justification for the denial. |
| NY | `NY-0035` |  | A denial of access shall not be based solely on the category or type of the record. |
| OH | `OH-0014` |  | If a request is ultimately denied in part or whole, the office shall provide the requester an explanation, including legal authority, setting forth why the request was denied. |
| VA | `VA-0011` |  | A response withholding records entirely shall identify with reasonable particularity the volume and subject matter of withheld records and cite, as to each category, the specific Code section authorizing the withholding. |
| VA | `VA-0012` |  | A response providing records in part and withholding in part shall identify with reasonable particularity the subject matter of withheld portions and cite, as to each category, the specific Code section authorizing the withholding. |
| WA | `WA-0034` |  | A response refusing inspection in whole or in part must include a statement of the specific exemption authorizing the withholding and a brief explanation of how the exemption applies to the record withheld. |

### `production.format_and_medium_choice`  ·  AZ CA FL GA IL NY OH VA

Produce in the medium/electronic format requested (subject to what agency holds/regularly uses); inspect-vs-copy option.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0022` |  | When a public record is maintained in an electronic format, the electronic version — including embedded metadata — is a public record and, if requested in that form, is subject to disclosure in its native/electronic format. |
| CA | `CA-0017` |  | If information constituting a non-exempt identifiable public record is held in an electronic format, the agency must make it available in an electronic format when requested by any person. |
| CA | `CA-0018` |  | The agency must make the information available in any electronic format in which it holds the information, and must provide a copy in the requested format if that format is one the agency has used to create copies for its own use or for other agencies. |
| FL | `FL-0016` |  | An agency must provide a copy of a record in the medium requested if it maintains the record in that medium; providing a copy in a medium not routinely used, or compiling/manipulating data, is charged under s. 119.07(4). |
| FL | `FL-0006` |  | As an agency increases its use of electronic recordkeeping it must provide reasonable public access to records electronically maintained and must ensure exempt/confidential records are not disclosed except as permitted by law. |
| GA | `GA-0030` |  | A requester may request that electronic records, data, or data fields be produced in the format in which the agency keeps them, or in a standard export format such as a flat-file ASCII format, if the agency&#x27;s existing computer programs support such export; and the agency shall produce electronic copies or, if the requester prefers, printouts. |
| IL | `IL-0034` |  | When a person requests a copy of a record maintained in electronic format, the public body must furnish it in the electronic format the requester specifies, if feasible. |
| NY | `NY-0021` |  | An agency shall provide records in the medium requested if it can reasonably make the copy or have it made by engaging an outside professional service. |
| NY | `NY-0022` |  | Records provided in a computer format shall not be encrypted. |
| OH | `OH-0021` |  | The office shall permit the requester to choose to have the record duplicated on paper, on the same medium the office keeps it, or on any other medium the office determines it can reasonably be duplicated on, and shall provide the copy in accordance with that choice. |
| VA | `VA-0003` |  | Access is provided by inspection or by providing copies of the requested records, at the option of the requester. |
| VA | `VA-0018` |  | The body shall produce nonexempt database records in any tangible medium identified by the requester — including, where it has the capability, posting on a website or delivery to a requester-provided email address — if that medium is used in the regular course of business. |
| VA | `VA-0019` |  | No public body is required to produce records from an electronic database in a format not regularly used by it, but it shall make reasonable efforts to provide records in any format under terms agreed with the requester, including payment of reasonable costs. |

### `appeal.judicial.right_to_sue`  ·  AZ CA GA IL OH VA WA

Judicial enforcement path (mandamus/injunction/declaratory/special action) and venue.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0014` |  | A person denied access to or the right to copy public records may appeal the denial through a special action in the superior court. |
| CA | `CA-0029` |  | Any person may institute a proceeding for injunctive or declaratory relief, or a writ of mandate, in any court of competent jurisdiction, to enforce the right to inspect or receive a copy of public records. |
| GA | `GA-0036` |  | The superior courts have jurisdiction in law and equity to entertain actions to enforce the Open Records Act; such actions may be brought by any person, firm, corporation, or other entity. |
| IL | `IL-0047` |  | Any person denied access to inspect or copy a public record may file suit for injunctive or declaratory relief in circuit court. |
| IL | `IL-0048` |  | Suit against a State public body may be filed in the circuit court for the county where the public body has its principal office or where the person denied access resides. |
| OH | `OH-0034` |  | A person allegedly aggrieved by a failure to comply with the Public Records Act may commence a mandamus action to compel the public office to comply with its obligations. |
| VA | `VA-0036` |  | An aggrieved requester may file a petition for mandamus or injunction in the appropriate court (venue keyed to the type of public body) to enforce the chapter&#x27;s records-access rights. |
| WA | `WA-0037` |  | A person denied the opportunity to inspect or copy a record may move the superior court to require the agency to show cause why it refused; the agency bears the burden of proving the refusal is authorized by an exempting or prohibiting statute. |

### `redaction.segregability`  ·  CA FL GA NY OH VA WA

Redact exempt portions and produce/segregate the non-exempt remainder.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0020` |  | Any reasonably segregable portion of a record must be made available after deletion of the portions that are exempt by law. |
| FL | `FL-0017` |  | A custodian asserting that an exemption applies to part of a record must redact that portion to which the exemption is asserted and validly applies, and must produce the remainder for inspection and copying. |
| GA | `GA-0034` |  | Exemptions are interpreted narrowly to exclude only the portion of a record to which an exclusion is directly applicable, and the agency having custody has a duty to provide all other portions of the record for inspection or copying. |
| NY | `NY-0033` |  | Where electronic records mix accessible and withholdable items, the agency shall, whenever practicable and reasonable, design retrieval to permit segregation and retrieval of the accessible items to provide maximum public access. |
| OH | `OH-0016` |  | If a public record contains information exempt from disclosure, the office shall make available all of the information within the record that is not exempt. |
| VA | `VA-0020` |  | A public body may not withhold an entire record because some portion is excluded; a record may be withheld in full only where an exclusion applies to its entire content, otherwise only the excluded portions are withheld and all nonexcluded portions shall be disclosed. |
| WA | `WA-0033` |  | The chapter&#x27;s exemptions are inapplicable to the extent that information whose disclosure would violate personal privacy or vital governmental interests can be deleted from the specific records sought; the non-exempt remainder must be disclosed. |

### `intake.writing_requirement`  ·  FL GA IL NY OH TX

Whether a request must be in writing vs oral/optional.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| FL | `FL-0004` |  | A custodian may not require that a public-records request be made in writing, on a particular form, or in person, and may not require the requester to disclose their identity as a condition of access. |
| GA | `GA-0004` |  | A request may be made to the custodian orally or in writing; an oral request is a valid intake path (though it does not unlock the statutory enforcement remedies — see GA-0007). |
| IL | `IL-0005` |  | A public body may honor oral requests for inspection or copying. |
| NY | `NY-0004` |  | The agency&#x27;s five-business-day response duty is triggered by receipt of a written request for a record. |
| OH | `OH-0005` |  | A written request is not mandatory; a requester may make an oral request and the office must honor it. |
| TX | `TX-0005` |  | A request must be in writing and delivered by U.S. mail, e-mail, hand delivery, or another method the governmental body has approved (e.g., fax, submission through its website). |

### `clarification.assist_confer_revise`  ·  CA IL OH TX WA

Agency may/must clarify, assist identifying, confer to narrow, or give chance to revise.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0007` |  | To assist the requester in making a focused, effective request, the agency shall (to the extent reasonable) help identify responsive records, describe the information technology and physical location where records exist, and suggest ways to overcome any practical basis for denying access. |
| CA | `CA-0008` |  | The agency&#x27;s duty to help identify responsive records is deemed satisfied if it cannot identify the requested information after making a reasonable effort to elicit additional clarifying information from the requester. |
| IL | `IL-0016` |  | Before denying a categorical request as unduly burdensome, the public body must give the requester an opportunity to confer to reduce the request to manageable proportions. |
| OH | `OH-0012` |  | If a request is denied as ambiguous or overly broad, the office shall provide the requester an opportunity to revise the request by informing the requester of the manner in which records are maintained and accessed in the ordinary course of duties. |
| TX | `TX-0012` |  | If a request is unclear the body may ask the requestor to clarify; if a large amount is requested the body may discuss narrowing the scope. |
| TX | `TX-0013` |  | A written clarification/discussion request (or a request for additional info) must include a statement of the consequences of the requestor&#x27;s failure to timely respond. |
| WA | `WA-0015` |  | When acknowledging an unclear request, the agency may ask the requester to clarify what information is sought. |
| WA | `WA-0017` |  | Where only part of a request is unclear, the agency must respond to the portions that are clear. |

### `communication.delay_notice_estimated_date`  ·  CA GA NY TX WA

When production is delayed, notify requester with reason and an estimated/certain date of availability.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0011` |  | If the agency determines the request seeks disclosable public records, it must also state the estimated date and time when the records will be made available. |
| GA | `GA-0013` |  | Where responsive records exist but are unavailable within three business days, the agency shall within that period provide the requester a description of the records and a timeline for when they will be available. |
| NY | `NY-0010` |  | A written acknowledgement must state an approximate date, reasonable under the circumstances, when the request will be granted or denied. |
| NY | `NY-0011` | fixed | If the agency grants a request but circumstances prevent disclosure within twenty business days from the acknowledgement, it must act (state reasons and a date certain). |
| NY | `NY-0012` |  | When disclosure cannot occur within twenty business days, the agency must state in writing both the reason for the inability and a date certain, within a reasonable period, when the request will be granted. |
| TX | `TX-0009` |  | If information cannot be produced within 10 business days after receipt, the officer must certify that fact in writing to the requestor and set a date and hour, within a reasonable time, when it will be available. |
| TX | `TX-0010` |  | If requested information is in active use or in storage and therefore unavailable when requested, the officer must certify this in writing and set a date and hour, within a reasonable time, when it will be available. |
| WA | `WA-0012` |  | When acknowledging a request rather than fulfilling it, the agency must provide a reasonable estimate of the time it will require to respond. |

### `deadline.production_soft_standard`  ·  CA FL GA OH WA

Downstream soft production/availability timing (promptly / reasonable time / as soon as practicable / most timely).

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0014` |  | Once a disclosable copy request is made, the agency must make the records promptly available (a soft-standard production deadline distinct from the 10-day determination). |
| FL | `FL-0014` |  | The only delay permitted in producing records is the limited reasonable time the custodian needs to retrieve the record and delete the portions asserted to be exempt; no automatic or policy-based delay is allowed. |
| GA | `GA-0014` |  | For records that could not be produced within three business days, the agency shall provide the responsive records or access to them as soon as practicable (a soft, undefined standard, not a fixed day count). |
| OH | `OH-0008` | soft-standard | Copies of requested public records shall be made available at cost and within a reasonable period of time. |
| WA | `WA-0013` |  | Responses to public records requests shall be made promptly. |
| WA | `WA-0041` |  | Agency rules must provide for the fullest assistance to inquirers and the most timely possible action on requests for information. |

### `denial.deemed_denial_on_nonresponse`  ·  AZ FL IL NY VA

Failure to timely respond is deemed/constitutes a denial (opening review).

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0013` |  | Access is deemed denied if the custodian fails to promptly respond to a production request, or fails to provide the requested index of withheld records/categories under § 39-121.01(D)(2). |
| FL | `FL-0028` |  | Delay beyond the limited reasonable time needed to retrieve and redact, or a policy-based/automatic delay, constitutes an unlawful (constructive) denial of access. |
| IL | `IL-0014` |  | Failure to comply with, extend the time for, or deny a written request within 5 business days after receipt is treated as a denial of the request. |
| NY | `NY-0013` |  | An agency&#x27;s failure to conform to the subdivision-three response provisions constitutes a denial of the request. |
| NY | `NY-0040` |  | An agency&#x27;s failure to conform to the appeal provisions of paragraph (a) constitutes a denial (opening judicial review). |
| VA | `VA-0015` |  | Failure to respond to a request within the statutory period is deemed a denial of the request and constitutes a violation of the chapter. |

### `fee.no_search_review_charge`  ·  CA IL NY TX WA

No charge for search/review/inspection labor.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0024` |  | For ordinary production of electronic records, an agency may not charge for the ancillary staff time of searching for and redacting/reviewing records; such time is chargeable only within the narrow data-extraction cost-shift of Section 7922.575(b) (i.e., where extraction/programming or interval-only production applies). |
| IL | `IL-0032` |  | A public body may not charge the requester for the cost of any search for and review of the records. |
| NY | `NY-0029` |  | Preparing a copy shall not include search time or administrative costs; these may not be charged to the requester. |
| TX | `TX-0026` |  | For a request of 50 or fewer pages of paper records, the charge may not include materials, labor, or overhead and is limited to the per-page photocopy charge, unless the pages are in two-or-more unconnected buildings or a remote storage facility. |
| WA | `WA-0019` | fixed | No fee may be charged for inspecting public records or for locating documents and making them available for copying. |

### `payment.advance_prepayment_before_copies`  ·  AZ CA IL NY OH

Agency may condition/require payment before providing copies.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0006` |  | For a request to mail a copy, the custodian may require the requester to pay in advance for any copying and postage charges. |
| CA | `CA-0025` |  | The agency&#x27;s duty is to make copies available upon payment of the duplication fees, permitting the agency to condition release of copies on payment. |
| IL | `IL-0019` |  | When it gives a fee estimate on a commercial or recurrent-requester request, the public body may require the requester to pay the fees in full before copying the requested documents. |
| NY | `NY-0019` |  | Upon payment of, or offer to pay, the prescribed fee, the entity shall provide a copy of the record and, if requested, certify its correctness. |
| OH | `OH-0020` |  | A public office may require the requester to pay in advance the cost of providing a copy, in accordance with the format the requester chose. |

### `appeal.admin.review_path_exists`  ·  IL NY OH WA

Existence of an administrative review path for a denial (agency head, PAC, court of claims, internal review).

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| IL | `IL-0043` |  | A person whose request is denied may file a request for review with the Public Access Counselor (except against the General Assembly and its committees/commissions/agencies). |
| NY | `NY-0036` |  | A person denied access to a record may appeal in writing to the head, chief executive, or governing body of the entity (or its designee). |
| OH | `OH-0028` |  | A requester allegedly aggrieved by a public-records denial may file a complaint with the clerk of the court of claims; the court of claims is the sole and exclusive authority for adjudicating such complaints under this expedited alternative to mandamus. |
| WA | `WA-0036` |  | An agency must establish a mechanism for the most prompt possible review of a denial of inspection; the review is deemed completed at the end of the second business day following the denial and constitutes final agency action for purposes of judicial review. |

### `custody.records_officer_designation`  ·  GA IL VA WA

Agency designates/publicly identifies a FOIA/records officer point of contact.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0008` |  | An agency that designates one or more open records officers shall make the designation in writing, immediately provide notice of them to any person on request (orally or in writing), notify the county legal organ, and, if it has a website, prominently display the designation. |
| IL | `IL-0006` |  | Each public body must designate one or more officials or employees to act as its Freedom of Information officer(s). |
| VA | `VA-0035` |  | All state, local, and regional public bodies subject to the chapter shall designate and publicly identify one or more FOIA officers to serve as the point of contact for records requests and to coordinate the body&#x27;s FOIA compliance. |
| WA | `WA-0040` |  | Each state and local agency shall appoint and publicly identify a public records officer to serve as the point of contact for records requests and to oversee the agency&#x27;s compliance with the chapter. |

### `deadline.extension`  ·  CA IL VA WA

Extension of the response deadline (for cause, by written notice, by agreement, or by court petition).

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0012` | ceiling | In unusual circumstances the determination time limit may be extended by written notice, but not by more than 14 days. |
| CA | `CA-0013` |  | An extension of the determination deadline is valid only if made by written notice from the agency head or designee, setting forth the reasons for the extension and the date a determination is expected to be dispatched. |
| IL | `IL-0011` | ceiling | A public body may extend the response time by not more than 5 business days beyond the original due date for any of seven enumerated reasons. |
| IL | `IL-0012` |  | When it extends, the public body must, within 5 business days after receipt, notify the requester of the reasons for the extension and the date the response will be forthcoming. |
| IL | `IL-0013` |  | The requester and the public body may agree in writing to extend the time for compliance for a period determined by the parties. |
| VA | `VA-0008` | fixed | If, within the five-work-day period, the body responds in writing that it is not practically possible to provide the records or determine availability and specifies the conditions making a response impossible, it gets an additional seven work days to make one of the four responses. |
| VA | `VA-0010` |  | A public body may petition the appropriate court for additional time to respond when the request is for an extraordinary volume of records or requires an extraordinarily lengthy search that would prevent it from meeting operational responsibilities, but must first make reasonable efforts to reach agreement with the requester. |
| WA | `WA-0014` |  | Additional time to respond may be based on the need to clarify the request, to locate and assemble records, to notify affected third persons or agencies, or to determine whether information is exempt. |

### `denial.written_form`  ·  CA IL OH WA

A denial must be in writing.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0026` |  | A response to a written request that includes a determination denying the request, in whole or in part, must be in writing. |
| IL | `IL-0039` |  | A public body denying a request must notify the requester in writing of the decision to deny. |
| OH | `OH-0015` |  | If the initial request was provided in writing, the denial explanation shall also be provided to the requester in writing. |
| WA | `WA-0035` |  | Denials of requests must be accompanied by a written statement of the specific reasons for the denial. |

### `fee.cost_estimate_itemized_notice`  ·  GA NY TX VA

Duty to give an itemized/cost estimate (over a threshold or on request) before charging/searching; estimate cost credited.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0022` |  | Where an agency will seek costs in excess of $25.00 to respond, it shall notify the requester within three business days and inform the requester of the cost estimate. |
| NY | `NY-0031` |  | The requester shall be informed of the estimated cost of preparing the copy if more than two hours of employee time is needed or if an outside professional service would be retained. |
| TX | `TX-0028` |  | If a copy charge (or a § 552.271 paper-inspection charge) will exceed $40, the body must give the requestor a written itemized statement detailing all estimated charges (including labor/personnel), notice of any less-costly alternative, and the requestor&#x27;s response responsibilities. |
| VA | `VA-0025` |  | Prior to conducting a search for records, the body shall notify the requester in writing that it may make reasonable charges not to exceed actual cost and inquire whether the requester would like a cost estimate in advance. |
| VA | `VA-0026` |  | The public body shall provide the requester with a cost estimate if requested. |
| VA | `VA-0029` |  | Any costs incurred by the public body in estimating the cost of supplying the records shall be applied toward the overall charges to be paid by the requester. |

### `fee.special_service_data_extraction`  ·  CA FL NY WA

Special/extraordinary service charge for data compilation, extraction, programming, or outside professional service.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0023` |  | The requester bears the cost of producing a copy (including the cost to construct a record and the cost of programming and computer services) when the electronic record is produced only at regularly scheduled intervals, or when the request requires data compilation, extraction, or programming to produce the record. |
| FL | `FL-0025` | soft-standard | If the nature or volume of records requires extensive use of IT resources or extensive clerical/supervisory assistance, the agency may charge, in addition to actual duplication cost, a reasonable special service charge based on the cost actually incurred. |
| NY | `NY-0030` |  | The actual cost of engaging an outside professional service to prepare a copy may be included only when the agency&#x27;s information technology equipment is inadequate to prepare the copy and the service is used. |
| WA | `WA-0029` |  | An agency may impose a customized service charge for a request that requires information-technology expertise to prepare data compilations or provide customized electronic access not used by the agency for other purposes, only after notifying the requester of the charge and the reason it applies. |

### `inspection.requester_self_copy`  ·  AZ CA GA OH

Whether requester may make own copies (own device / when custodian lacks facilities / not required).

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0012` |  | If the custodian lacks facilities to copy a record the person has a right to inspect, the person shall be granted access to make copies, done while the record remains in the custodian&#x27;s possession/custody/control and under the custodian&#x27;s supervision. |
| CA | `CA-0016` |  | A requester inspecting disclosable records on agency premises may use their own equipment to photograph or copy records without physical contact, unless doing so would damage the record or gain unauthorized access to agency systems; the agency may set reasonable equipment-use limits. |
| GA | `GA-0027` |  | At the time of inspection, any person may make photographic copies or other electronic reproductions of the records using suitable portable devices brought to the place of inspection. |
| OH | `OH-0022` |  | Nothing requires a public office to allow a requester to make the copies of a public record themselves. |

### `intake.request_channels`  ·  AZ GA NY WA

Which submission channels must be accepted (mail, email, fax, in person).

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0005` |  | A requester may (a) examine records in person during regular office hours, (b) be furnished copies/printouts/photographs, or (c) request that the custodian mail a copy of any public record not otherwise available on the public body&#x27;s website. |
| GA | `GA-0006` |  | An agency shall permit receipt of written requests by e-mail or facsimile in addition to other approved methods, provided the agency uses e-mail or facsimile in the normal course of its business. |
| NY | `NY-0006` |  | An entity with reasonable means available shall accept requests submitted by email and respond by email, unless the request seeks a response in another form. |
| WA | `WA-0006` |  | An agency shall honor requests for identifiable public records received in person during normal office hours, or by mail or email, unless exempted by the chapter. |

### `payment.deposit_for_anticipated_costs`  ·  GA TX VA WA

Deposit/bond/prepayment required when estimated cost exceeds a threshold.

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0024` |  | Where the estimated production cost exceeds $500.00, the agency may insist on prepayment of the costs before beginning search, retrieval, review, or production. |
| TX | `TX-0034` | fixed | The officer may require a deposit or bond for anticipated copy costs once an itemized estimate has been provided and the estimated charge exceeds $100 (body with more than 15 full-time employees) or $50 (fewer than 16 full-time employees). |
| VA | `VA-0031` | fixed | Where a public body determines in advance that charges are likely to exceed $200, it may, before continuing to process the request, require the requester to pay a deposit not to exceed the amount of the advance determination. |
| WA | `WA-0031` | ceiling | An agency may require a deposit not exceeding ten percent of the estimated cost of providing copies for a request. |

### `scope.reasonably_identifiable`  ·  CA NY VA WA

Request must reasonably describe an identifiable record before the duty attaches.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0006` |  | A copy request must reasonably describe an identifiable record or records before the duty to produce attaches. |
| NY | `NY-0005` |  | The response duty attaches only where the requested record is reasonably described. |
| VA | `VA-0005` |  | A request for public records shall identify the requested records with reasonable specificity. |
| WA | `WA-0007` |  | A request must be for identifiable records; a request for all or substantially all of an agency&#x27;s records is not valid, but a request for all records on a particular topic, keyword, or name is not treated as a request for all records. |

### `search.electronic_retrieval_efficiency`  ·  GA NY OH VA

Duty to retrieve electronically with reasonable effort / organize records / use most economical means.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0020` |  | An agency shall utilize the most economical means reasonably calculated to identify and produce responsive, nonexcluded documents. |
| NY | `NY-0015` |  | When an agency can retrieve or extract a record or data from a computer storage system with reasonable effort, it shall do so. |
| NY | `NY-0016` |  | Where electronic retrieval/extraction requires less employee time than manual retrieval or redaction from non-electronic records, the agency shall retrieve or extract the record electronically. |
| OH | `OH-0009` |  | A public office must organize and maintain its public records so that they can be made available for inspection or copying. |
| VA | `VA-0016` |  | Records maintained in an electronic data processing system or database shall be made available at a reasonable cost not exceeding actual cost; where databases combine exempt and nonexempt records, the body shall provide access to the nonexempt records. |

### `search.overbroad_burdensome_denial`  ·  IL NY OH WA

Whether/when an overbroad, categorical, or unduly burdensome request may be denied.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| IL | `IL-0015` |  | A request for all records within a category may be denied only if compliance would be unduly burdensome, there is no way to narrow it, and the burden outweighs the public interest in the information. |
| NY | `NY-0018` |  | An agency shall not deny a request as voluminous or burdensome due to insufficient staffing (or any basis) if it may engage an outside professional service to provide copying, programming, or other services, the cost of which it may recover. |
| OH | `OH-0011` |  | A public office may deny a request that is ambiguous or overly broad, or that does not reasonably identify what public records are being requested. |
| WA | `WA-0008` |  | An agency shall not deny a request for identifiable public records solely because the request is overbroad. |

### `appeal.admin.reviewer_decision_deadline`  ·  IL NY OH

Deadlines for the reviewer/public body to respond, decide, report, or object in the administrative review.

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| IL | `IL-0045` | fixed | Within 7 business days after receiving the request for review, the public body must provide copies of the requested records to the PAC and otherwise fully cooperate. |
| IL | `IL-0046` | fixed | The Attorney General must examine the issues and records, make findings of fact and conclusions of law, and issue a binding opinion within 60 days after receipt of the request for review. |
| NY | `NY-0038` | fixed | Within ten business days of receiving the appeal, the appeal authority shall fully explain in writing the reasons for further denial or provide access to the record. |
| OH | `OH-0031` | fixed | Within ten business days after the termination of mediation (or notice that the case was not referred to mediation), the public office must file a response to the complaint. |
| OH | `OH-0032` | fixed | Not later than seven business days after receiving the response (or motion to dismiss), the special master shall submit a report and recommendation; the period may be extended by an additional seven business days for good cause. |
| OH | `OH-0033` | fixed | Either party may object to the special master&#x27;s report and recommendation within seven business days after receiving it. |

### `appeal.burden_on_public_body`  ·  IL NY VA

Agency bears the burden to prove an exemption applies.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| IL | `IL-0009` |  | A public body asserting a record is exempt bears the burden of proving the exemption by clear and convincing evidence. |
| NY | `NY-0041` |  | A person denied access in an administrative appeal determination may bring a proceeding to review that denial under CPLR Article 78; the agency bears the burden of proving the record falls within an exemption. |
| VA | `VA-0038` |  | In an enforcement proceeding the public body bears the burden of proving an exclusion by a preponderance of the evidence, and any failure by the body to follow the chapter&#x27;s procedures is presumed to be a violation. |

### `classification.presumption_of_openness`  ·  FL IL NY

All records presumed open/available except enumerated exceptions.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| FL | `FL-0005` |  | All state, county, and municipal records are open for personal inspection and copying by any person unless a specific exemption applies. |
| IL | `IL-0008` |  | All records in the custody or possession of a public body are presumed open to inspection or copying. |
| NY | `NY-0008` |  | Each agency shall make all records available for inspection and copying except records or portions that fall within the enumerated exceptions. |
| NY | `NY-0023` |  | Each agency shall, per its published rules, make available for public inspection and copying all records except those (or portions) that may be withheld under the exemptions. |

### `custody.custodian_designee_duties`  ·  FL GA OH

Custodian/person-responsible duty to permit access; designee disclosure; absence no delay.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| FL | `FL-0010` |  | A custodian may designate another officer or employee to permit inspection and copying, but must disclose the identity of the designee to the requester. |
| GA | `GA-0009` |  | The absence or unavailability of the designated agency officer or employee may not be permitted to delay the agency&#x27;s response to a request. |
| OH | `OH-0013` |  | The duty to prepare, make available, and copy public records falls on the public office or the &#x27;person responsible for public records&#x27; who holds custody. |

### `fee.labor_free_threshold`  ·  GA NY TX

Free labor increment/allowance before any labor charge (first quarter hour / two hours / hour allowances).

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0017` | fixed | No labor charge may be made for the first quarter hour of search, retrieval, or redaction. |
| NY | `NY-0028` | fixed | No preparation fee may be charged unless at least two hours of agency employee time is needed to prepare the copy. |
| TX | `TX-0031` | floor | A body that sets time limits on uncompensated personnel time must allow at least 36 hours per requestor over a 12-month period and at least 15 hours per requestor in a one-month period before charging for personnel time. |

### `inspection.availability_hours`  ·  AZ CA TX

Records available for inspection during normal/office business hours.

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0002` |  | Custodian must make public records available for inspection at all times during regular office hours. |
| CA | `CA-0015` |  | Public records are open to inspection at all times during the office hours of the agency. |
| TX | `TX-0007` | floor | Public information must be available to the public at a minimum during the governmental body&#x27;s normal business hours. |

### `preservation.retention_hold`  ·  FL GA WA

Hold/retain records against destruction pending a request; no destruction to prevent disclosure.

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| FL | `FL-0030` |  | Even if the custodian asserts a requested record is not a public record subject to inspection, the record must not be disposed of for 30 days after a written request to inspect or copy it was served on or made to the custodian. |
| GA | `GA-0038` |  | Persons or entities that destroy records for the purpose of preventing their disclosure under the Open Records Act may be prosecuted under O.C.G.A. § 45-11-1. |
| WA | `WA-0042` |  | If a requested record exists but is scheduled for destruction, the agency must retain it and may not destroy or erase it until the request is resolved. |

### `redaction.pii_privacy_deletion`  ·  GA NY TX

Delete/redact personal identifiers (SSN, PII) to prevent privacy invasion, without added process.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0035` |  | Enumerated personal identifiers (e.g., social security number, financial/bank/credit-card/account data, personal e-mail or cell number, day and month of birth, medical/insurance information, and similar items) shall be redacted prior to disclosure of any requested record, subject to statutory exceptions. |
| NY | `NY-0032` |  | An agency may delete identifying details when it makes records available to prevent an unwarranted invasion of personal privacy. |
| TX | `TX-0024` |  | A body may redact a living person&#x27;s social security number from information it discloses under § 552.021 without requesting an attorney general decision under Subchapter G. |

### `search.no_duty_to_create_record`  ·  GA NY VA

No duty to create a record that does not already exist.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0029` |  | No public officer or agency is required to prepare new reports, summaries, or compilations not in existence at the time of the request. |
| NY | `NY-0014` |  | An entity is not required to prepare any record it does not possess or maintain (except the statutorily specified subject-matter/vote records). |
| VA | `VA-0014` |  | No public body is required to create a new record that does not already exist, but it may abstract or summarize information under terms agreed with the requester. |

### `search.programming_extraction_not_new_record`  ·  GA NY VA

Programming/excision/query commands to extract or redact are not creation of a new record.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0031` |  | An agency shall not refuse to produce electronic records, data, or data fields on the ground that exporting or redacting requires inputting range, search, filter, or report commands, so long as those commands can be executed using existing programs the agency uses in the ordinary course of business. |
| NY | `NY-0017` |  | Programming necessary to retrieve a record from computer storage and transfer it to the requested medium is not the preparation or creation of a new record. |
| VA | `VA-0017` |  | Excising exempt fields from a database, or converting data from one available format to another, is not deemed the creation, preparation, or compilation of a new public record. |

### `abandonment.clarification_nonresponse`  ·  TX WA

Request deemed withdrawn on requester's failure to respond to a clarification request (terminal).

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| TX | `TX-0014` | fixed | If the body receives no written response by the 61st day after sending a clarification/discussion request (or additional-information request), the underlying request is considered withdrawn. |
| WA | `WA-0016` |  | If the requester fails to respond to a clarification request and the entire request is unclear, the agency need not respond to it. |

### `abandonment.cost_estimate_nonresponse`  ·  TX VA

Request deemed withdrawn on requester's failure to respond to a cost/itemized estimate (terminal).

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| TX | `TX-0029` | fixed | The request is considered withdrawn if the requestor does not respond in writing within 10 business days after the itemized statement is sent (accepting charges, modifying the request, or filing an overcharge complaint). |
| TX | `TX-0030` |  | If, before making the copy available, the body determines estimated charges will exceed the itemized statement by 20% or more, it must send a written updated itemized statement; no timely response to the update means the request is withdrawn. |
| VA | `VA-0028` | fixed | If the public body receives no response from the requester within 30 days of sending the cost estimate, the request is deemed withdrawn. |

### `abandonment.failure_to_claim_or_pay`  ·  TX WA

Request deemed withdrawn/unfulfilled on failure to inspect, claim, or pay (terminal).

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| TX | `TX-0011` | fixed | A request is considered withdrawn if the requestor fails to inspect/duplicate the information within 60 days after it is made available, or fails to pay applicable charges within 60 days after being informed of the costs. |
| WA | `WA-0032` |  | If the requester fails to inspect, pay for, or claim an installment of a records request, the agency need not fulfill the balance of the request. |

### `appeal.admin.requester_filing_deadline`  ·  IL NY

Requester's window to file an administrative appeal/review.

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| IL | `IL-0044` | fixed | A request for review with the PAC must be filed not later than 60 days after the date of the final denial. |
| NY | `NY-0037` | fixed | The requester must file the written administrative appeal within thirty days of the denial. |

### `custody.contractor_vendor_records`  ·  FL GA

Contractor/vendor duties to keep, provide, transfer, and not impede access to public records.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| FL | `FL-0011` |  | A contractor providing services to a public agency must keep and maintain the public records required by the agency to perform the service. |
| FL | `FL-0012` |  | On the agency custodian&#x27;s request, a contractor must provide the agency a copy of, or allow inspection/copying of, requested records within a reasonable time at a cost not exceeding the chapter&#x27;s fees. |
| FL | `FL-0013` |  | At contract completion the contractor must transfer, at no cost, all public records in its possession to the agency, or keep and maintain the records; if transferring, it must destroy exempt/confidential duplicates. |
| GA | `GA-0033` |  | If an agency contracts with a private vendor to collect or maintain public records, the agency shall ensure the arrangement does not limit public access and that the vendor does not impede record access or the method of delivery established by the agency or by law. |

### `deadline.clock_start_computation`  ·  GA IL

When the response clock starts / due-date computation and notation.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0010` |  | Where an agency requires that requests be directed to designated individuals, the three-day response period does not begin to run until the request is made in writing upon such individuals. |
| IL | `IL-0007` |  | Upon receiving a request, the FOIA officer must note the date the public body received the written request and compute and record the date the response period expires. |

### `deadline.clock_tolling`  ·  TX VA

Response/decision clock tolls during pendency of clarification, cost estimate, or deposit.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| TX | `TX-0015` |  | A governmental body&#x27;s good-faith request for clarification tolls the 10-business-day period for requesting an attorney general decision until the requestor responds. |
| VA | `VA-0027` |  | The response period is tolled for the amount of time that elapses between the public body&#x27;s notice of the cost estimate and the requester&#x27;s response. |
| VA | `VA-0032` |  | The response period is tolled for the amount of time that elapses between notice of the advance determination and the requester&#x27;s response. |

### `deadline.record_class_specific_window`  ·  GA VA

Extended response window keyed to a specific record class (criminal investigative files, intercollegiate sports).

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0039` | fixed | For records (other than nonclerical staff salary information) of intercollegiate sports programs of any University System of Georgia unit, the period for any production, access, response, or notice is 90 business days from the date the agency received the request. |
| VA | `VA-0009` | fixed | For a request for criminal investigative files under § 2.2-3706.1, the additional extension when a response is not practically possible is 60 work days rather than seven. |

### `eligibility.identity_disclosure`  ·  OH VA

Whether the agency may require/condition access on requester identity.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| OH | `OH-0003` |  | A public office may not condition availability of records on the requester disclosing the requester&#x27;s identity; requiring identity disclosure constitutes a denial. |
| OH | `OH-0006` |  | A public office may ask for a written request, identity, or intended use only after first disclosing to the requester that these are not mandatory and may be declined. |
| VA | `VA-0004` |  | The custodian may require the requester to provide his name and legal address. |

### `eligibility.incarcerated_requester`  ·  OH TX

Special handling/exclusion of requests from incarcerated persons.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| OH | `OH-0035` |  | A public office need not permit a person incarcerated pursuant to a criminal conviction to inspect or copy a record concerning a criminal investigation or prosecution unless the sentencing judge (or successor) finds the information is necessary to support what appears to be a justiciable claim of the person. |
| TX | `TX-0004` |  | A governmental body is not required to accept or comply with a request from an incarcerated/confined individual or that individual&#x27;s agent (other than the individual&#x27;s attorney seeking disclosable information). |

### `enforcement.no_obstruction`  ·  CA FL

No delay/obstruction; no third-party control of disclosure; good-faith handling.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0030` |  | Nothing in the CPRA may be construed to permit an agency to delay or obstruct the inspection or copying of public records. |
| CA | `CA-0031` |  | An agency may not allow another party to control the disclosure of information that is otherwise subject to disclosure under the CPRA. |
| FL | `FL-0008` |  | A custodian and any designee must respond to requests to inspect or copy records in good faith. |

### `fee.certified_copy_charge`  ·  FL IL

Fee for a certified copy.

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| FL | `FL-0024` | ceiling | An agency may charge up to $1 per copy for a certified copy of a public record. |
| IL | `IL-0030` | ceiling | The cost for certifying a record may not exceed $1. |

### `fee.labor_rate_lowest_paid`  ·  GA NY

Labor/search-retrieval-redaction rate capped at the lowest-paid qualified employee's hourly salary.

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0016` | ceiling | An agency may impose a reasonable charge for search, retrieval, and redaction, but that charge shall not exceed the prorated hourly salary of the lowest paid full-time employee who, in the custodian&#x27;s reasonable discretion, has the necessary skill and training to perform the request. |
| NY | `NY-0027` | fixed | Actual reproduction cost may include only the hourly salary attributed to the lowest-paid agency employee who has the necessary skill to prepare the copy. |

### `fee.no_charge_special_cases`  ·  NY WA

No copy charge for reused recent records or website-posted records.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| NY | `NY-0026` | fixed | Where an identical record was prepared for a prior request within the past six months and an electronic copy is available, the agency shall charge no fee except the actual cost of a storage device/media if provided. |
| WA | `WA-0026` | fixed | An agency may not impose copying charges for access to or downloading of records it routinely posts on its public internet website. |

### `fee.no_overhead_general_cost`  ·  VA WA

No recoupment of overhead/general administrative costs.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| VA | `VA-0023` |  | No public body shall impose extraneous, intermediary, or surplus fees or expenses to recoup the general costs of creating or maintaining records or transacting the general business of the public body. |
| WA | `WA-0028` |  | In determining actual copy costs, an agency may not include staff salaries, benefits, or general administrative or overhead charges unless directly related to the actual cost of copying. |

### `fee.special_record_type_rate`  ·  OH VA

Fee rate keyed to a special record type (GIS/topo maps, video production).

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| OH | `OH-0019` | ceiling | A law enforcement agency or prosecuting attorney&#x27;s office may charge the actual cost of preparing a video record, not to exceed $75 per hour of video produced and not to exceed $750 total. |
| VA | `VA-0034` | ceiling | A body may make a reasonable charge, not exceeding actual cost, for records produced from a geographic information system at the request of anyone other than the owner of the subject land, except that it may charge on a pro rata per-acre basis for topographical maps it developed that encompass a contiguous area greater than 50 acres. |

### `fee.statutory_purpose_waiver`  ·  AZ VA

No-charge for enumerated purposes/records (federal benefit claims, crime-victim, scholastic/FERPA).

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| AZ | `AZ-0009` |  | Records requested for the purposes listed in § 39-122 (federal benefit claims) or § 39-127 (crime-victim records) shall be furnished without charge. |
| AZ | `AZ-0019` |  | No state, county or city (or officer/board thereof) shall demand or receive a fee for certified copies of, or searches for, public records when they are to be used in connection with a claim for a pension, allotment, allowance, compensation, insurance or other benefit to be presented to the United States or a federal bureau/department. |
| AZ | `AZ-0020` |  | A crime victim (or the victim&#x27;s attorney on the victim&#x27;s behalf; and, for Part I crimes, immediate family if the victim is killed or incapacitated) has the right to receive one copy of the police report and audio/video recordings without charge from the investigating agency, plus specified court records. |
| VA | `VA-0033` |  | The reasonable-charge fee provisions do not apply to scholastic records that must be made available under FERPA when requested by a parent or legal guardian of a minor student or by a student who is 18 or older. |

### `fee.waiver_public_interest`  ·  IL TX

Fee waiver/reduction when disclosure primarily benefits the public interest.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| IL | `IL-0033` |  | Documents must be furnished without charge or at reduced charge, as determined by the public body, if the requester states a specific purpose and the waiver is in the public interest (principally to disseminate information on public health/safety/welfare or legal rights, not for personal/commercial benefit). |
| TX | `TX-0032` |  | The body must provide a copy without charge or at a reduced charge if it determines waiver/reduction is in the public interest because providing the copy primarily benefits the general public. |

### `intake.designated_recipient`  ·  GA TX

Agency may designate the address/individual to which requests must be directed.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0005` |  | An agency may (but is not obligated to) require that all written requests be directed to a designated official chosen from an enumerated list (director/chair/CEO, senior satellite official, designated records custodian clerk, or designated open records officer). |
| TX | `TX-0006` |  | A governmental body may designate one mailing address and one e-mail address for requests; if it posts/prints them, it need not respond to a request unless received at a designated address, by hand delivery, or by an approved (a)(4) method. |

### `intake.no_standard_form`  ·  IL WA

Agency may not require a particular/standard form or official format.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| IL | `IL-0004` |  | A public body may not require that a request be submitted on a standard form. |
| WA | `WA-0005` |  | No official format is required to make a records request, though an agency may recommend a form or web page. |

### `payment.prepayment_for_prior_unpaid`  ·  GA TX

Deposit/prepayment required for amounts unpaid on prior requests.

_config home: parameter_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0025` |  | Where a requester has not paid costs lawfully incurred for a prior request, the agency may require prepayment for all future requests from that person until the prior costs are paid or the payment dispute is resolved. |
| TX | `TX-0035` | fixed | The officer may require a deposit or bond for unpaid amounts owed on prior requests if those unpaid amounts exceed $100, and this becomes the sole means of collecting those amounts. |

### `production.partial_installment`  ·  GA WA

Produce available records on a partial/installment basis within the window.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0012` |  | Where some but not all responsive records are available within three business days, the agency shall make available within that period those records that can be located and produced. |
| WA | `WA-0018` |  | Records may be provided on a partial or installment basis as records in a larger set are assembled or made ready. |

### `production.records_not_found`  ·  NY VA

Response when records cannot be found/do not exist; certify or refer to another body.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| NY | `NY-0020` |  | Where applicable, the entity shall certify that it does not possess the record or that the record cannot be found after a diligent search. |
| VA | `VA-0013` |  | If records could not be found or do not exist, the response says so; and if the receiving body knows another public body has the records, the response shall include contact information for that other public body. |

### `production.third_party_affected_notice`  ·  GA WA

Notice to third parties/submitters (trade-secret affidavit; discretionary affected-person notice).

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| GA | `GA-0041` |  | Where a submitter has attached a trade-secret affidavit to records, the agency shall notify the submitter before producing them; if the agency determines the information is not a trade secret it shall notify the submitter of its intent to disclose within ten days unless barred by court order (the submitter may then sue to prevent disclosure). |
| WA | `WA-0043` |  | An agency has discretion to notify persons named in, or to whom a requested record specifically pertains, that release of the record has been requested, except where notice is required by law. |

### `production.website_in_lieu`  ·  CA GA

Agency may satisfy production by directing requester to records posted on its website.

_config home: structural_

| State | Rule ID | Basis | Rule (value) |
|---|---|---|---|
| CA | `CA-0019` |  | An agency may satisfy a records-posting/production obligation by maintaining the record on its website and directing the requester there, but must promptly provide a copy if the requester cannot access or reproduce the record from the website. |
| GA | `GA-0032` |  | An agency may provide access to records through a public website in lieu of separate printouts or copies, but if it receives a request for data fields it shall not refuse the responsive data on the ground that it is available through a website when the requester seeks the data in the electronic format in which it is kept. |

---
## Single-state concepts

| Concept | State | Rule |
|---|---|---|
| `appeal.admin.filing_fee` | OH | A person filing a public-records complaint with the clerk of the court of claims shall pay a filing fee of twenty-five dollars. |
| `appeal.admin.mediation` | OH | Upon assignment of a public-records complaint, the special master immediately refers the case to mediation. |
| `appeal.admin.oversight_notification` | NY | Each agency shall immediately forward to the Committee on Open Government a copy of the appeal when received and the ensuing determination. |
| `appeal.judicial.charge_estimate_review` | WA | A person may petition the superior court to challenge an agency&#x27;s reasonable estimate of the time to respond or its copying charges; the agency must show the estimate or charge is reasonable. |
| `appeal.judicial.expedited_hearing_precedence` | VA | The petition for mandamus or injunction shall be heard within seven days of the date it is made, provided the defendant receives at least three working days&#x27; notice (notice waived for open-meetings violations). |
| `appeal.judicial.expedited_hearing_precedence` | VA | The enforcement proceeding shall be given precedence on the court&#x27;s docket over all cases not otherwise given precedence by law. |
| `appeal.judicial.in_camera_review` | FL | In a civil action where an exemption under specified provisions (s. 119.071(1)(d) or (f), (2)(d),(e),(f), or (4)(c)) is asserted, the record must be submitted to the court for in camera inspection. |
| `appeal.judicial.limitations_period` | WA | An action under the judicial-review section must be filed within one year of the agency&#x27;s claim of exemption or the last production of a record on a partial or installment basis. |
| `appeal.judicial.third_party_injunction` | WA | An agency, its representative, or a person named in or to whom a record specifically pertains may move the superior court by affidavit to enjoin inspection of a specific record, which the court may grant on finding that disclosure would clearly not be in the public interest and would substantially and irreparably damage any person or vital governmental functions. |
| `classification.commercial_purpose` | AZ | At the time of the request, the requester shall affirm the record is not for a commercial purpose, or, if it is, that they will provide the commercial-purpose statement under § 39-121.03(A). |
| `classification.commercial_purpose` | AZ | When a person requests copies/printouts/photographs for a commercial purpose, they shall provide a statement setting forth the commercial purpose for which the reproductions will be used. |
| `classification.commercial_purpose` | AZ | &#x27;Commercial purpose&#x27; means using a public record for sale or resale, for producing a document containing the copy for sale, for obtaining names/addresses for solicitation, for selling names/addresses to another for solicitation, or for any purpose in which the purchaser can reasonably anticipate monetary gain from the record&#x27;s direct or indirect use. |
| `coverage.definitions` | CA | The CPRA applies to a &#x27;local agency,&#x27; which includes a county; a city (general law or chartered); a city and county; a school district; a municipal corporation; a district; a political subdivision; any board/commission/agency of the foregoing; and other local public agencies. |
| `coverage.definitions` | CA | A &#x27;public record&#x27; is any writing containing information relating to the conduct of the public&#x27;s business prepared, owned, used, or retained by any state or local agency, regardless of physical form or characteristics. |
| `deadline.ag_brief_and_comments` | TX | Within 15 business days of the request the body must submit to the AG written comments on the exceptions, a copy of the request, a dated receipt statement, and a copy (or representative sample) of the requested information. |
| `deadline.ag_brief_and_comments` | TX | A body that submits written comments to the AG must send a copy of those comments to the requestor not later than the 15th business day after receiving the written request. |
| `deadline.ag_decision_render` | TX | The attorney general must render the decision not later than the 45th business day after receiving the request, extendable once by 10 business days on timely notice to the body and requestor. |
| `deadline.ag_request_and_notice` | TX | The body must ask the attorney general for a decision and state the applicable exceptions within a reasonable time but not later than the 10th business day after receiving the written request. |
| `deadline.ag_request_and_notice` | TX | Within 10 business days of the request the body must give the requestor a written statement that it is withholding and has asked the AG, plus a copy (redacted if needed) of its AG communication. |
| `deadline.commercial_request_window` | IL | A public body must respond to a request for records to be used for a commercial purpose within 21 working days after receipt. |
| `deadline.commercial_request_window` | IL | The commercial-request response must do one of four things: give a time-and-fee estimate, deny under an exemption, notify the request is unduly burdensome with an opportunity to narrow, or provide the records. |
| `deadline.recurrent_requester_handling` | IL | A public body must respond to a request from a recurrent requester within 21 business days after receipt. |
| `deadline.recurrent_requester_handling` | IL | Within 5 business days after receiving a request from a recurrent requester, the public body must notify the requester that it is being treated under the recurrent-requester provisions. |
| `deadline.recurrent_requester_handling` | IL | A requester is a recurrent requester if, in the prior 12 months, it submitted to the same public body at least 50 requests, or at least 15 within a 30-day period, or at least 7 within a 7-day period. |
| `deadline.voluminous_request_handling` | IL | A request is voluminous if it includes more than 5 individual requests for more than 5 different categories of records within 20 business days, or requires compiling more than 500 letter/legal-sized pages (unless a single record exceeds 500 pages). |
| `deadline.voluminous_request_handling` | IL | A public body must respond to a voluminous request within 5 business days after receipt (notifying the requester it is being treated as voluminous). |
| `deadline.voluminous_request_handling` | IL | After the public body&#x27;s voluminous-request response, the requester must respond within 10 business days; if the requester does not respond (or the request remains voluminous), the public body responds and assesses any fees. |
| `deadline.voluminous_request_handling` | IL | The public body must give its final voluminous-request response within the earlier of 5 business days after receiving the requester&#x27;s response or 5 business days after the final day for the requester to respond. |
| `delivery.mail_electronic_transmission_caps` | OH | A public office may transmit copies of public records to a requester by United States mail or by any other means of delivery or transmission the requester chooses, if the requester pays the postage/delivery cost in advance. |
| `delivery.mail_electronic_transmission_caps` | OH | A public office may limit the number of records it will physically deliver by U.S. mail or another delivery service to ten per month, unless the requester certifies in writing non-commercial use. |
| `delivery.mail_electronic_transmission_caps` | OH | The ten-per-month delivery limit does not apply if the requester certifies in writing that they do not intend to use or forward the records, or the information in them, for commercial purposes. |
| `delivery.mail_electronic_transmission_caps` | OH | A public office that makes records available online may limit the number of records it will transmit electronically (or otherwise) to a person to ten per month, unless the records are not available online or the requester certifies non-commercial use. |
| `denial.exemption_waiver_on_lapse` | TX | If the body does not timely request an AG decision and provide the § 552.301(d) and (e-1) notices, the requested information is presumed public and must be released absent a compelling reason to withhold. |
| `denial.identify_responsible_persons` | CA | A notification of denial must set forth the names and titles or positions of each person responsible for the denial. |
| `denial.notify_review_rights` | IL | Each denial notice must inform the requester of the right to review by the Public Access Counselor and provide the PAC&#x27;s address and phone number. |
| `denial.notify_review_rights` | IL | Each denial notice must inform the requester of the right to judicial review. |
| `disclosure.commercial_list_prohibition` | WA | The chapter does not authorize giving, selling, or providing access to lists of individuals requested for commercial purposes, and agencies shall not do so unless specifically authorized or directed by law. |
| `enforcement.pre_suit_cure_period` | OH | After a complaint alleging a failure to promptly prepare or make available records is served on the public office, the office has three business days to cure or otherwise address the failure before the requester may proceed. |
| `enforcement.written_request_gates_remedies` | GA | The enforcement and penalty provisions (§§ 50-18-73 and 50-18-74) are available only when the request was made in writing consistent with subsection (b); they are unavailable for oral requests. This classifies whether a request is enforcement-eligible. |
| `fee.commercial_purpose_rate` | AZ | For commercial-purpose reproductions the custodian&#x27;s charge may include: (1) a portion of the public body&#x27;s cost of obtaining the original/copies; (2) a reasonable fee for time, materials, equipment and personnel in producing the reproduction; and (3) the value of the reproduction on the commercial market as best determined by the public body. |
| `fee.commercial_search_charge` | IL | For a commercial request, a public body may charge up to $10 for each hour spent by personnel searching for, retrieving, or examining the record for necessary redactions. |
| `fee.commercial_search_charge` | IL | No fee may be charged for the first 8 hours spent by personnel searching for or retrieving a requested record on a commercial request. |
| `fee.commercial_search_charge` | IL | If it imposes a Section 6(f) fee, the public body must provide the requester an accounting of all fees, costs, and personnel hours connected with the request. |
| `fee.free_page_allowance` | IL | No fee may be charged for the first 50 pages of black-and-white, letter- or legal-sized copies requested. |
| `fee.photograph_supervision` | FL | When a person photographs public records, the custodian may charge for supervision services at a rate agreed upon by the parties; if they cannot agree, the custodian determines the charge. |
| `fee.photograph_supervision` | FL | Where another room or place is necessary to photograph public records, the expense of providing it is paid by the person desiring to photograph the records. |
| `fee.specific_statutory_fee_controls` | GA | Where a specific fee for certified copies or other records is authorized or prescribed by law, that specific fee applies instead of the general search/retrieval/copy charges when such records are sought. |
| `fee.voluminous_electronic_data_tiers` | IL | For a voluminous request for electronic records, a public body may charge tiered caps by data size: for non-PDF data up to $20 (&lt;=2 MB), $40 (2-4 MB), or $100 (&gt;4 MB); for PDF data up to $20 (&lt;=80 MB), $40 (80-160 MB), or $100 (&gt;160 MB). |
| `fee.waiver_when_collection_exceeds` | TX | The body may waive the charge if the cost of processing the collection of the charge would exceed the amount of the charge. |
| `inspection.reasonable_conditions_supervision` | FL | Every person who has custody of a public record must permit that record to be inspected and copied by any person desiring to do so. |
| `inspection.reasonable_conditions_supervision` | FL | Inspection and copying occur at any reasonable time, under reasonable conditions, and under supervision by the custodian. |
| `intake.bot_request` | WA | An agency may deny a bot request that is one of multiple requests from the same requester within a 24-hour period if it establishes that responding would cause excessive interference with other essential functions. |
| `intake.no_magic_words_required` | VA | A request need not reference VFOIA to invoke the chapter&#x27;s provisions or to impose the response time limits on the public body. |
| `intake.request_form_provided` | NY | The Committee on Open Government develops a request form, made available on the internet, that the public may use to request a record. |
| `payment.collection_of_incurred_costs` | GA | Where charges were lawfully estimated and agreed and the agency has incurred the agreed-upon costs to make records available, the agency may collect those charges (via tax/fee collection methods) regardless of whether the requester inspects or accepts the records. |
| `payment.deferral_pending_cost_agreement` | GA | The agency may defer search and retrieval until the requester agrees to pay the estimated costs, unless the request already stated a willingness to pay an amount exceeding the search and retrieval costs. |
| `payment.electronic_method` | VA | Any local public body that charges for producing records may provide an electronic method of payment (noncash, non-paper-check — credit/debit cards, direct deposit/debit, electronic checks, telephonic payment). |
| `production.copies_in_lieu_for_redaction` | GA | An agency may, in its discretion, provide copies of a record in lieu of providing access to the record when portions contain confidential information that must be redacted. |
| `production.record_type_priority` | AZ | A law enforcement agency shall prioritize the processing and providing of each police report requested under § 39-127. |
| `records.retention_schedule_available` | OH | A public office shall have available a copy of its current records retention schedule at a location readily available to the public. |
| `redaction.notice_of_redaction` | OH | When making a record available, the office shall notify the requester of any redaction or make the redaction plainly visible. |
| `review.ag_enforcement_authority` | GA | The Attorney General has discretionary authority to bring enforcement actions to compel compliance with the Open Records Act and to seek civil or criminal penalties or both. |
| `review.ag_predisclosure_ruling_required` | TX | A body that receives a written request for information it wishes to withhold under a Subchapter C exception must ask the attorney general for a decision, unless there has been a previous determination. |
| `review.ag_predisclosure_ruling_required` | TX | No new AG decision is required where there has already been a previous determination that the information falls within an exception (or is public). |
| `review.commercial_misuse_hold` | AZ | If the custodian believes the stated commercial purpose is a misuse of public records, the custodian may apply to the governor for an executive order prohibiting furnishing the records; if no order issues within thirty days of the application, the custodian shall provide the reproductions upon being paid the fee. |
| `routing.civil_litigant_counsel_copy` | GA | Requests by civil litigants for records sought for use in ongoing civil or administrative litigation against the agency shall be made in writing and copied to the agency&#x27;s counsel of record contemporaneously; the agency shall provide duplicate sets of produced records to that counsel at no cost unless counsel declines. |
