# Wave 6 — state rules (OK · MO)

Discovery-only run (2026-07-22), single-agent, verbatim. Both passed the size guard.

## Summary

| State | Rules | Verbatim | Neg | Branches |
|---|--:|--:|--:|--:|
| OK | 28 | 28 | 10 | 7 |
| MO | 35 | 29 | 7 | 7 |

---

## Oklahoma (OK) — 28 rules

### Eligibility

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0001` | structural | none | **Any person may inspect, copy, or mechanically reproduce the records of public bodies and public officials during regular business hours.**<br><br>_“All records of public bodies and public officials shall be open to any person for inspection, copying, or mechanical reproduction during regular business hours; provided:”_ | Okla. Stat. tit. 51, § 24A.5 |
| `OK-0002` | structural | none | **The right to inspect/copy records extends to any person with no residency or citizenship qualification.**<br><br>_“All records of public bodies and public officials shall be open to any person for inspection, copying, or mechanical reproduction during regular business hours”_ | Okla. Stat. tit. 51, § 24A.5 |
| `OK-0003` | structural | none | **A public body may not impose access procedures beyond those specified in the Act; no statement of purpose is required to inspect/copy records (purpose matters only to fees, not access).**<br><br>_“Except as may be required by other statutes, public bodies do not need to follow any procedures for providing access to public records except those specifically required by the Oklahoma Open Records Act.”_ | Okla. Stat. tit. 51, § 24A.2 |

### Inspection

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0004` | parameter · soft-standard | none | **Records are open for inspection/copying during the public body&#x27;s regular business hours.**<br><br>_“All records of public bodies and public officials shall be open to any person for inspection, copying, or mechanical reproduction during regular business hours”_ | Okla. Stat. tit. 51, § 24A.5 |

### Classification

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0005` | structural | none | **All records are presumed open and subject to disclosure except records specifically required by law to be kept confidential.**<br><br>_“The Oklahoma Open Records Act, Sections 24A.1 through 24A.30 of this title, does not apply to records specifically required by law to be kept confidential”_ | Okla. Stat. tit. 51, § 24A.5(1); § 24A.2 |

### Denials

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0006` | structural | none | **The public body/official asserting confidentiality bears, at all times, the burden of establishing that the record is protected by a confidential privilege.**<br><br>_“provided, the person, agency or political subdivision shall at all times bear the burden of establishing such records are protected by such a confidential privilege.”_ | Okla. Stat. tit. 51, § 24A.2 |
| `OK-0027` | structural | none | **Except for records made open by § 24A.8(A) or other law, a law enforcement agency may deny access to law enforcement records unless a court finds the public interest or an individual&#x27;s interest outweighs the reason for denial.**<br><br>_“Except for the records listed in subsection A of this section and those made open by other state or local laws, law enforcement agencies may deny access to law enforcement records except where a court finds that the public interest or the interest of an individual outweighs the reason for denial.”_ | Okla. Stat. tit. 51, § 24A.8(B) |

### Redaction

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0007` | structural | none | **Any reasonably segregable portion of a record containing exempt material must be provided after deletion of the exempt portions.**<br><br>_“Any reasonably segregable portion of a record containing exempt material shall be provided after deletion of the exempt portions;”_ | Okla. Stat. tit. 51, § 24A.5(3) |
| `OK-0008` | structural | none | **A public body may treat Social Security numbers in a record as confidential and redact or delete them prior to release, regardless of the person&#x27;s status.**<br><br>_“All Social Security numbers included in a record may be confidential regardless of the person&#x27;s status as a public employee or private individual and may be redacted or deleted prior to release of the record by the public body;”_ | Okla. Stat. tit. 51, § 24A.5(2) |

### Deadlines

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0009` | structural | sets-deadline · undefined-soft: &quot;prompt, reasonable access&quot; from request receipt | **A public body must provide prompt, reasonable access to its records.**<br><br>_“A public body must provide prompt, reasonable access to its records but may establish reasonable procedures which protect the integrity and organization of its records and to prevent excessive disruptions of its essential functions.”_ | Okla. Stat. tit. 51, § 24A.5(6) |
| `OK-0011` | structural | none | **A delay in providing access must be limited solely to the time required to prepare the requested documents and to avoid excessive disruption of the body&#x27;s essential functions.**<br><br>_“A delay in providing access to records shall be limited solely to the time required for preparing the requested documents and the avoidance of excessive disruptions of the public body&#x27;s essential functions.”_ | Okla. Stat. tit. 51, § 24A.5(6) |
| `OK-0012` | structural | none | **Production of a current request may not be unreasonably delayed until completion of a prior request that will take substantially longer than the current request.**<br><br>_“In no event may production of a current request for records be unreasonably delayed until after completion of a prior records request that will take substantially longer than the current request.”_ | Okla. Stat. tit. 51, § 24A.5(6) |

### Production

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0010` | structural | none | **A public body may establish reasonable procedures that protect the integrity and organization of its records and prevent excessive disruptions of its essential functions.**<br><br>_“but may establish reasonable procedures which protect the integrity and organization of its records and to prevent excessive disruptions of its essential functions.”_ | Okla. Stat. tit. 51, § 24A.5(6) |
| `OK-0013` | structural | none | **A public body that makes the requested records available on the Internet is deemed to meet its obligation to provide prompt, reasonable access.**<br><br>_“Any public body which makes the requested records available on the Internet shall meet the obligation of providing prompt, reasonable access to its records as required by this paragraph;”_ | Okla. Stat. tit. 51, § 24A.5(6) |

### Custody/Routing

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0014` | structural | none | **A public body must designate certain persons authorized to release its records for inspection, copying, or mechanical reproduction.**<br><br>_“A public body shall designate certain persons who are authorized to release records of the public body for inspection, copying, or mechanical reproduction.”_ | Okla. Stat. tit. 51, § 24A.5(7) |
| `OK-0015` | structural | none | **At least one authorized person must be available at all times to release records during the public body&#x27;s regular business hours.**<br><br>_“At least one person shall be available at all times to release records during the regular business hours of the public body.”_ | Okla. Stat. tit. 51, § 24A.5(7) |

### Fees

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0016` | parameter · ceiling | none · ceiling: reasonable direct cost of copying/reproduction | **A public body may charge a fee only to recover the reasonable, direct costs of record copying or mechanical reproduction.**<br><br>_“Otherwise, a public body may charge a fee only for recovery of the reasonable, direct costs of record copying, or mechanical reproduction.”_ | Okla. Stat. tit. 51, § 24A.5(4) |
| `OK-0017` | parameter · ceiling | none · ceiling: $0.25/page (pages &lt;= 8.5 x 14 in) | **The record copying fee may not exceed twenty-five cents ($0.25) per page for records 8.5 by 14 inches or smaller.**<br><br>_“Notwithstanding any state or local provision to the contrary, in no instance shall the record copying fee exceed twenty-five cents ($0.25) per page for records having the dimensions of eight and one-half (8 1/2) by fourteen (14) inches or smaller,”_ | Okla. Stat. tit. 51, § 24A.5(4) |
| `OK-0018` | parameter · ceiling | none · ceiling: $1.00/page (certified copy) | **The fee for a certified copy may not exceed One Dollar ($1.00) per copied page.**<br><br>_“or a maximum of One Dollar ($1.00) per copied page for a certified copy.”_ | Okla. Stat. tit. 51, § 24A.5(4) |
| `OK-0019` | structural | none · ceiling: reasonable direct cost of search and copying | **If a request is solely for a commercial purpose, or would clearly cause excessive disruption of the body&#x27;s essential functions, the body may charge a reasonable fee to recover the direct cost of record search and copying.**<br><br>_“However, if the request: a. is solely for commercial purpose, or b. would clearly cause excessive disruption of the essential functions of the public body, then the public body may charge a reasonable fee to recover the direct cost of record search and copying;”_ | Okla. Stat. tit. 51, § 24A.5(4) |
| `OK-0020` | structural | none | **Newspaper publication or news-media broadcast for news purposes is not a resale or commercial/trade use, and charges for electronic data provided to news media for a news purpose may not exceed the direct cost of copying.**<br><br>_“however, publication in a newspaper or broadcast by news media for news purposes shall not constitute a resale or use of a record for trade or commercial purpose and charges for providing copies of electronic data to the news media for a news purpose shall not exceed the direct cost of making the copy.”_ | Okla. Stat. tit. 51, § 24A.5(4) |
| `OK-0021` | structural | none | **A public body that establishes fees must post a written schedule of the fees at its principal office and with the county clerk.**<br><br>_“Any public body establishing fees under this act shall post a written schedule of the fees at its principal office and with the county clerk.”_ | Okla. Stat. tit. 51, § 24A.5(4) |
| `OK-0022` | structural | none | **No search fee may be charged when release of the records is in the public interest, including release to news media, scholars, authors, and taxpayers seeking to determine whether officials are performing their duties.**<br><br>_“In no case shall a search fee be charged when the release of records is in the public interest, including, but not limited to, release to the news media, scholars, authors and taxpayers seeking to determine whether those entrusted with the affairs of the government are honestly, faithfully, and competently performing their duties as public servants.”_ | Okla. Stat. tit. 51, § 24A.5(4) |
| `OK-0023` | structural | none | **Fees may not be used to discourage requests for information or as obstacles to disclosure of requested information.**<br><br>_“The fees shall not be used for the purpose of discouraging requests for information or as obstacles to disclosure of requested information;”_ | Okla. Stat. tit. 51, § 24A.5(4) |
| `OK-0024` | structural | none | **Where the cost of copying/reproducing/certifying each individual record is otherwise prescribed by state law, the body may assess that cost per individual record or portion requested.**<br><br>_“Any request for a record which contains individual records of persons, and the cost of copying, reproducing or certifying each individual record is otherwise prescribed by state law, the cost may be assessed for each individual record, or portion thereof requested as prescribed by state law.”_ | Okla. Stat. tit. 51, § 24A.5(4) |

### Intake

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0025` | structural | none | **A public body without at least 30 regular business hours per week must post and maintain a written notice (at its principal office and with the county clerk) designating the days records are available, the name/mailing address/telephone of the individual in charge of records, and detailed procedures for obtaining access at least two days per week excluding Sunday.**<br><br>_“If a public body or its office does not have regular business hours of at least thirty (30) hours a week, the public body shall post and maintain a written notice at its principal office and with the county clerk where the public body is located which notice shall: 1. Designate the days of the week when records are available for inspection, copying or mechanical reproduction; 2. Set forth the name, mailing address, and telephone number of the individual in charge of the records; and 3. Describe in detail the procedures for obtaining access to the records at least two days of the week, excluding Sunday.”_ | Okla. Stat. tit. 51, § 24A.6(A) |
| `OK-0026` | structural | none | **The requester and the authorized release person may agree to inspection/copying on a day and time other than that designated in the sub-30-hours notice.**<br><br>_“The person requesting the record and the person authorized to release the records of the public body may agree to inspection, copying, or mechanical reproduction on a day and at a time other than that designated in the notice.”_ | Okla. Stat. tit. 51, § 24A.6(B) |

### Appeals

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `OK-0028` | structural | none | **A person denied access to records may bring a civil suit for declaratory or injunctive relief, or both, limited to records requested and denied prior to filing the suit.**<br><br>_“Any person denied access to records of a public body or public official: 1. May bring a civil suit for declarative or injunctive relief, or both, but such civil suit shall be limited to records requested and denied prior to filing of the civil suit; and 2. If successful, shall be entitled to reasonable attorney fees.”_ | Okla. Stat. tit. 51, § 24A.17(B) |

### Material negatives

- `deadline.initial_response_window` — Oklahoma sets NO fixed numeric response or determination deadline. The only timing standard is the soft &#x27;prompt, reasonable access&#x27; of §24A.5(6). Absence of a found rule is not proof none exists, but the Act contains no day-count.
- `intake.acknowledgment_window` — No statutory duty to acknowledge a request or issue an estimated completion date. The Act specifies only prompt, reasonable access.
- `denial.deemed_denial_on_nonresponse` — No statutory &#x27;silence = denial&#x27; trigger. §24A.17(B) provides a civil remedy for records &#x27;requested and denied,&#x27; but the Act fixes no clock after which non-response is deemed a denial (Oklahoma case law has treated unreasonable delay as constructive denial; not codified — flagged for a later case-law pass).
- `appeal.administrative.review_right` — No administrative or Attorney-General records-review/appeal process exists (contrast Texas&#x27;s AG-decision regime). Enforcement is judicial only (§24A.17(B)).
- `clarification.request_permitted` — No statutory clarification/narrowing procedure, clarification clock, or reasonably-describes-identifiable threshold is stated in the Act.
- `preservation.hold_pending_request` — No statutory preservation/litigation-hold triggered by a pending request. §24A.8(C) and §24A.18 expressly disclaim any additional recordkeeping requirement; retention is governed by separate records-management law (out of scope).
- `production.format_medium` — No general &#x27;produce in the requester&#x27;s chosen electronic format&#x27; mandate. The Act addresses electronic format only for narrow record types (news-media electronic data and DPS computerized copies), both capped at direct cost — not a general format-choice right.
- `payment.advance_deposit_before_production` — The Act contains no provision authorizing or governing advance deposits or pre-payment before production; only the fee caps of §24A.5(4) are stated.
- `deadline.determination_extension` — No statutory extension mechanism or unusual-circumstances tolling; consistent with the absence of any fixed response clock.
- `intake.written_request_required` — The Act does not require a written request or any particular form; §24A.2 bars imposing procedures beyond those the Act specifies, and none is specified for intake form or channel.

### Structural branches

- `intake.limited_hours_notice` — OK-0025 (§24A.6(A)): distinct intake/availability path for public bodies open fewer than 30 hours/week — posted notice, designated in-charge individual, and a minimum-two-days-per-week access floor.
- `intake.appointment_by_agreement` — OK-0026 (§24A.6(B)): mutual-agreement appointment path for access outside the designated limited-hours days.
- `fee.search_fee_conditional` — OK-0019 (§24A.5(4)): fee-basis fork — a search fee is unlockable ONLY when the request is solely commercial-purpose or would clearly cause excessive disruption; otherwise search cost is non-recoverable.
- `classification.commercial_purpose_news_exclusion` — OK-0020 (§24A.5(4)): classification branch excluding news-media/news-purpose use from &#x27;commercial purpose&#x27;, diverting it away from the search-fee path and into a direct-cost-only electronic-data rate.
- `handling.no_queue_blocking` — OK-0012 (§24A.5(6)): queue-management branch prohibiting a short current request from being blocked behind a substantially longer prior request.
- `production.website_redirect` — OK-0013 (§24A.5(6)): Internet-availability path that satisfies the prompt-access duty.
- `denial.law_enforcement_discretion` — OK-0027 (§24A.8(B)): record-specific discretionary-denial path for law-enforcement records not on the §24A.8(A) mandatory-disclosure list, subject to a court public-interest balancing test (human-legal-review flagged).

---

## Missouri (MO) — 35 rules

### Eligibility

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0001` | structural | none | **Each public governmental body must make its public records available for inspection and copying by the public; access is not limited to any class or category of requester.**<br><br>_“Each public governmental body shall make available for inspection and copying by the public of that body&#x27;s public records.”_ | § 610.023.2, RSMo |
| `MO-0002` | structural | none | **There is no Missouri residency or citizenship condition on the right to inspect or copy public records; the statute grants access to &#x27;the public&#x27; with no residency qualifier.**<br><br>_“Each public governmental body shall make available for inspection and copying by the public of that body&#x27;s public records.”_ | § 610.023.2, RSMo |
| `MO-0003` | structural | none | **A requester need not state a purpose or reason for requesting public records; the access grant to &#x27;the public&#x27; carries no purpose condition.**<br><br>_“Each public governmental body shall make available for inspection and copying by the public of that body&#x27;s public records.”_ | § 610.023.2, RSMo |

### Custody/Routing

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0004` | structural | none | **Each public governmental body must appoint a custodian who is responsible for the maintenance of that body&#x27;s records.**<br><br>_“Each public governmental body is to appoint a custodian who is to be responsible for the maintenance of that body&#x27;s records.”_ | § 610.023.1, RSMo |
| `MO-0005` | structural | none | **The identity and location of a public governmental body&#x27;s custodian must be made available upon request.**<br><br>_“The identity and location of a public governmental body&#x27;s custodian is to be made available upon request.”_ | § 610.023.1, RSMo |

### Intake

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0006` | structural | none | **A public governmental body may ask a requester to fill out a request form but may not require use of a form as a condition of access.**<br><br>_“a public governmental body may ask that requestors fill out a form, but it can&#x27;t require them to do so.”_ | Mo. Att&#x27;y Gen., Sunshine Law FAQs (interpreting § 610.023.3) |
| `MO-0007` | structural | none | **A records request need not be submitted in writing; written submission is encouraged as helpful but is not required by statute.** _(paraphrase)_<br><br>_“Section 610.023.3, RSMo, ... does not specify a manner in which these requests must be submitted; while not required, it may be helpful to submit requests in writing.”_ | Mo. Att&#x27;y Gen., Sunshine Law FAQs (interpreting § 610.023.3) |

### Deadlines

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0008` | parameter · ceiling | sets-deadline · ceiling: 3 business-days from request receipt by custodian | **The custodian must act upon a request for access no later than the end of the third business day following the date the request is received by the custodian.**<br><br>_“Each request for access to a public record shall be acted upon as soon as possible, but in no event later than the end of the third business day following the date the request is received by the custodian of records of a public governmental body.”_ | § 610.023.3, RSMo |
| `MO-0009` | structural | sets-deadline · undefined-soft: &quot;as soon as possible&quot; from request receipt | **A request for access must be acted upon as soon as possible, a promptness standard operating within the outer three-business-day cap.**<br><br>_“Each request for access to a public record shall be acted upon as soon as possible, but in no event later than the end of the third business day following the date the request is received by the custodian of records of a public governmental body.”_ | § 610.023.3, RSMo |
| `MO-0012` | structural | sets-deadline · undefined-soft: &quot;reasonable cause&quot; extension beyond 3 business-days from request receipt | **The period for document production may exceed three business days for reasonable cause.**<br><br>_“This period for document production may exceed three days for reasonable cause.”_ | § 610.023.3, RSMo |
| `MO-0014` | parameter · ceiling | sets-deadline · ceiling: 3 business-days from receipt of the request for the statement | **The written statement of grounds for denial must be furnished to the requester no later than the end of the third business day following the date the request for the statement is received.**<br><br>_“and shall be furnished to the requester no later than the end of the third business day following the date that the request for the statement is received.”_ | § 610.023.4, RSMo |

### Production

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0010` | structural | none | **If records are requested in a certain format, the public body must provide the records in the requested format if such format is available.**<br><br>_“If records are requested in a certain format, the public body shall provide the records in the requested format, if such format is available.”_ | § 610.023.3, RSMo |
| `MO-0032` | structural | none | **A public body keeping records in electronic format is strongly encouraged to provide access electronically, and where its system allows electronic copying it must provide data in electronic format if requested.** _(paraphrase)_<br><br>_“A public governmental body keeping its records in an electronic format is strongly encouraged to provide access to its public records to members of the public in an electronic format. ... the public governmental body shall provide data to the public in such electronic format, if requested.”_ | § 610.029.1, RSMo |

### Communications

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0011` | structural | none | **If access is not granted immediately, the custodian must give a detailed explanation of the cause for further delay and the place and earliest time and date the record will be available for inspection.**<br><br>_“If access to the public record is not granted immediately, the custodian shall give a detailed explanation of the cause for further delay and the place and earliest time and date that the record will be available for inspection.”_ | § 610.023.3, RSMo |
| `MO-0027` | structural | none | **The public body must notify the requester that failing to remit payment within ninety days (or one hundred fifty days if fees exceed one thousand dollars) will cause the request to be considered withdrawn.**<br><br>_“The public governmental body shall include notice to the requester that if the requester fails to remit payment of the fees within ninety days, or within one hundred fifty days if the requested fees are greater than one thousand dollars, then the request for public records shall be considered withdrawn.”_ | § 610.026.2, RSMo |

### Denials

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0013` | structural | none | **If a request for access is denied, the custodian must, upon request, provide a written statement of the grounds for denial citing the specific provision of law under which access is denied.**<br><br>_“If a request for access is denied, the custodian shall provide, upon request, a written statement of the grounds for such denial. Such statement shall cite the specific provision of law under which access is denied”_ | § 610.023.4, RSMo |
| `MO-0028` | structural | none | **Records of public governmental bodies are presumed open to the public unless otherwise provided by law; the Sunshine Law is liberally construed and its exceptions strictly construed.**<br><br>_“It is the public policy of this state that meetings, records, votes, actions, and deliberations of public governmental bodies be open to the public unless otherwise provided by law. ... [the sections] shall be liberally construed and their exceptions strictly construed to promote this public policy.”_ | § 610.011.1, RSMo |

### Redaction

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0015` | structural | none | **If a record contains both nonexempt and exempt material, the public body must separate them and make the nonexempt material available for examination and copying.**<br><br>_“If a public record contains material which is not exempt from disclosure as well as material which is exempt from disclosure, the public governmental body shall separate the exempt and nonexempt material and make the nonexempt material available for examination and copying.”_ | § 610.024.1, RSMo |
| `MO-0016` | structural | none | **When designing a public record, a public body must, to the extent practicable, facilitate a separation of exempt from nonexempt information.**<br><br>_“When designing a public record, a public governmental body shall, to the extent practicable, facilitate a separation of exempt from nonexempt information.”_ | § 610.024.2, RSMo |
| `MO-0017` | structural | none | **If the separation is readily apparent, the public body must generally describe the material exempted, unless that description would reveal the contents of the exempt information and thus defeat the purpose of the exemption.**<br><br>_“If the separation is readily apparent to a person requesting to inspect or receive copies of the form, the public governmental body shall generally describe the material exempted unless that description would reveal the contents of the exempt information and thus defeat the purpose of the exemption.”_ | § 610.024.2, RSMo |

### Fees

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0018` | parameter · ceiling | none | **Fees for copying public records provided in paper form shall not exceed ten cents per page for a paper copy not larger than nine by fourteen inches.**<br><br>_“Fees for copying public records ... shall not exceed ten cents per page for a paper copy not larger than nine by fourteen inches, with the hourly fee for duplicating time not to exceed the average hourly rate of pay for clerical staff of the public governmental body.”_ | § 610.026.1(1), RSMo |
| `MO-0019` | parameter · ceiling | none | **The hourly fee charged for duplicating time shall not exceed the average hourly rate of pay for clerical staff of the public governmental body.**<br><br>_“with the hourly fee for duplicating time not to exceed the average hourly rate of pay for clerical staff of the public governmental body.”_ | § 610.026.1(1), RSMo |
| `MO-0020` | parameter · ceiling | none | **Research time required for fulfilling records requests may be charged at the actual cost of research time.**<br><br>_“Research time required for fulfilling records requests may be charged at the actual cost of research time.”_ | § 610.026.1(1), RSMo |
| `MO-0021` | parameter · soft-standard | none | **Documents must be copied/duplicated using the personnel of the body that results in the lowest amount of charges for the request.** _(paraphrase)_<br><br>_“Documents may be copied using employees of the body that result in the lowest amount of charges for search, research, and duplication time.”_ | § 610.026.1(1), RSMo |
| `MO-0022` | structural | none | **A requester may request an estimate of the cost of copies before the public body produces them.** _(paraphrase)_<br><br>_“a person requesting records may request that the public governmental body provide an estimate of the cost prior to producing the copies.”_ | § 610.026.1(1), RSMo |
| `MO-0023` | parameter · ceiling | none | **Fees for records maintained on computer facilities, tapes, disks, videotapes or films shall include only the cost of copies, staff time (not exceeding the average hourly rate of pay for staff needed for copies and programming), and the cost of the medium used for duplication.**<br><br>_“Fees for providing access to public records maintained on computer facilities, recording tapes or disks, videotapes or films ... shall include only the cost of copies, staff time, which shall not exceed the average hourly rate of pay for staff of the public governmental body required for making copies and programming, if necessary, and the cost of the disk, tape, or other medium used for the duplication.”_ | § 610.026.1(2), RSMo |
| `MO-0024` | structural | none | **A public body may waive or reduce the fees when it determines that waiver or reduction of the fee is in the public interest.**<br><br>_“Documents may be furnished without charge or at a reduced charge when the public governmental body determines that waiver or reduction of the fee is in the public interest because it is likely to contribute significantly to public understanding of the operations or activities of the public governmental body.”_ | § 610.026.1(1), RSMo |

### Payment

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0025` | structural | none | **Payment of fees may be requested prior to fulfilling the request.**<br><br>_“Payment of fees may be requested prior to fulfilling the request.”_ | § 610.026.2, RSMo |
| `MO-0026` | parameter · fixed | terminal · fixed: 90 calendar-days from fee request; 150 calendar-days if fees &gt; $1,000 | **A request is considered withdrawn if the requester fails to remit all fees within ninety days, or within one hundred fifty days if the requested fees are greater than one thousand dollars.**<br><br>_“A request for public records to a public governmental body shall be considered withdrawn if the requester fails to remit all fees within ninety days, or within one hundred fifty days if the requested fees are greater than one thousand dollars.”_ | § 610.026.2, RSMo |

### Inspection

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0029` | structural | none | **No person may remove original public records from the office of a public governmental body or its custodian without written permission of the designated custodian.**<br><br>_“No person shall remove original public records from the office of a public governmental body or its custodian without written permission of the designated custodian.”_ | § 610.023.2, RSMo |

### Special Records

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0030` | structural | none | **&#x27;Public governmental body&#x27; includes governmental entities created by order or ordinance of any political subdivision or district, bringing municipal bodies within the Sunshine Law&#x27;s coverage.** _(paraphrase)_<br><br>_“&#x27;Public governmental body&#x27;, any legislative, administrative or governmental entity created by the Constitution or statutes of this state, by order or ordinance of any political subdivision or district, judicial entities when operating in an administrative capacity, or by executive order ...”_ | § 610.010(4), RSMo |
| `MO-0031` | structural | none | **&#x27;Public record&#x27; means any record, written or electronically stored, retained by or of any public governmental body, including reports, studies, and records created or maintained by private contractors under an agreement with or on behalf of the body.** _(paraphrase)_<br><br>_“&#x27;Public record&#x27;, any record, whether written or electronically stored, retained by or of any public governmental body including any report, survey, memorandum, or other document or study ... including records created or maintained by private contractors under an agreement with a public governmental body or on behalf of a public governmental body ...”_ | § 610.010(6), RSMo |

### Appeals

| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |
|---|---|---|---|---|
| `MO-0033` | structural | none | **Any aggrieved person, taxpayer to or citizen of the state, or the attorney general or prosecuting attorney, may seek judicial enforcement of the Sunshine Law&#x27;s records provisions.**<br><br>_“Any aggrieved person, taxpayer to, or citizen of, this state, or the attorney general or prosecuting attorney, may seek judicial enforcement of the requirements of sections 610.010 to 610.026.”_ | § 610.027.1, RSMo |
| `MO-0034` | structural | none | **Suits to enforce the records provisions must be brought in the circuit court for the county in which the public governmental body has its principal place of business.**<br><br>_“Suits to enforce sections 610.010 to 610.026 shall be brought in the circuit court for the county in which the public governmental body has its principal place of business.”_ | § 610.027.1, RSMo |
| `MO-0035` | structural | none | **Once the enforcement-seeking party shows the body is subject to the law and closed a record, the burden of persuasion shifts to the body to demonstrate compliance.**<br><br>_“Once a party seeking judicial enforcement of sections 610.010 to 610.026 demonstrates to the court that the body in question is subject to the requirements of sections 610.010 to 610.026 and has held a closed meeting, record or vote, the burden of persuasion shall be on the body and its members to demonstrate compliance with the requirements of sections 610.010 to 610.026.”_ | § 610.027.2, RSMo |

### Material negatives

- `denial.deemed_denial_nonresponse` — No statutory deemed/constructive-denial trigger. Chapter 610 requires action within three business days (610.023.3) but does not state that silence past that deadline is automatically a denial; a failure to respond is treated as a violation enforceable in court (610.027), and knowing/purposeful violations carry penalties, rather than converting silence into a deemed denial with its own clock. Absence of a found rule is not proof none exists.
- `appeal.administrative.none` — No internal administrative appeal or binding administrative-review stage for records denials. Enforcement is exclusively judicial (610.027). The Attorney General or a prosecuting attorney may investigate and sue, and a requester may complain to the AG&#x27;s office, but no statute creates a binding administrative determination the platform would route to before court.
- `fee.waiver_indigency` — No separate statutory indigency fee waiver. The only fee-waiver provision is the discretionary public-interest waiver/reduction in 610.026.1 (MO-0024); Chapter 610 does not provide a mandatory indigency-based waiver.
- `payment.deposit_threshold` — No statutory deposit percentage or dollar threshold governing advance payment. 610.026.2 permits requesting payment before fulfillment (MO-0025) but sets no required deposit amount; the 90/150-day figures (MO-0026) are withdrawal deadlines, not deposit thresholds.
- `search.burden_hour_threshold` — No statutory &#x27;unduly burdensome&#x27; or search-hour threshold permitting denial of a voluminous request. Chapter 610 sets no burden-hour cap; a body may recover search/research time as a fee (MO-0020) rather than refuse the request for burden.
- `intake.acknowledgment_window` — No separate acknowledgment deadline distinct from the substantive-response deadline. The three-business-day clock in 610.023.3 (MO-0008) is a deadline to act upon the request, not a mere acknowledgment; Missouri does not require a separate receipt acknowledgment.
- `classification.commercial_purpose` — No commercial-purpose classification or commercial-use fee surcharge in Chapter 610. Unlike several states, Missouri&#x27;s fee schedule (610.026) draws no distinction based on the requester&#x27;s commercial vs. non-commercial purpose.

### Structural branches

- `communications.delay_notice_date_certain` — Delay-notice path (MO-0011): when access is not immediate, custodian must issue a detailed cause explanation plus a date-certain for availability.
- `deadline.extension_reasonable_cause` — Reasonable-cause extension path (MO-0012): production window may exceed three business days on an undefined-soft &#x27;reasonable cause&#x27; standard, paired with the delay notice.
- `denial.exemption_citation_required` — Denial-statement path (MO-0013/MO-0014): on a requester&#x27;s request, a written grounds statement citing the specific legal provision must issue within three business days of that request.
- `redaction.segregability` — Segregate-and-produce path (MO-0015/MO-0016/MO-0017): separate exempt from nonexempt material, produce the nonexempt, and generally describe the exempted material unless doing so defeats the exemption.
- `fee.nonpayment_withdrawal` — Fee-nonpayment withdrawal path (MO-0026/MO-0027): a request terminates as withdrawn if fees go unpaid for 90 days (150 days if &gt; $1,000), preceded by a mandatory withdrawal-consequence notice — a Missouri-specific terminal branch added by the 2025 amendment.
- `appeal.judicial.enforcement_right` — Judicial-only enforcement path (MO-0033/MO-0034/MO-0035): no administrative appeal; enforcement is a circuit-court suit with venue at the body&#x27;s principal place of business and burden-shifting to the body.
- `production.electronic_format_on_request` — Electronic-format path (MO-0032): where the body maintains records electronically and its system permits electronic copying, it must provide data in electronic format on request.
