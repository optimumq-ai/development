# Optimum Q - Taxonomy Data Model (synthesis v2)
Draft from Kevin's brain-dump + Claude synthesis, 2026-06-04. For review when fresh.

## Core insight
RECORD TYPE is the hub. Department, format/medium, repository, routing, redaction, cost, public-ready all ATTACH to a record type (as attributes or linked records). They are NOT separate hierarchies to juggle.

## Two coupled layers
- TAXONOMY (types + rules): curated, AI-assisted, human-approved. ~dozens of entries.
- INDEX (instances + actuals): automatic via connectors. Thousands of entries.
Linked by classification: each indexed record -> one record type.

## Entities
- Category (~13 high-level browse groups; add "Technology / IT Assets"). Keeps record-type count manageable.
- Record Type (THE HUB; ~55-100). Sits at the finest level where HANDLING RULES stay constant.
  Attributes: description, synonyms[], disambiguators (what it's NOT), keywords, format(s) [video|pdf|structured_data|email|physical|mixed], public_availability [releasable|restricted|confidential], redaction_profile, legal_references (from jurisdiction profile, never AI-guessed), fee_estimate_default, is_structured_data (data record vs output file).
  Relationships:
  - owning_department(s) [many]: creates/maintains for business.
  - fulfilling_department [1; default Open Records]: processes the request (-> routing). Owner != fulfiller.
  - repositories[]: each link = {repository, format, filter}. Repositories include PHYSICAL/PAPER. (Paper-then-PDF budget = one record type, two repository links with date filters.)
- Repository: where records live (cloud_system | structured_db | file_storage | physical_location). Medium lives here, not as a hierarchy.
- Smart Routing (derived): record type [+ repo/keywords] -> fulfilling dept/queue [+ optional employee-level later].
- Indexed Record (instance): actual doc/data from a connector; extracted title/description/keywords/embedding; classified -> record type (e.g. "Approved Annual Budget 2024"). Specific named items live HERE, auto-extracted, NOT hand-authored in the taxonomy.
- Fulfilled Request Index (FRI): prior fulfillments; links a specific record -> actual cost + public-ready version pointer + redaction already done. Powers cost-estimate bypass + public-ready awareness for repeat requests.

## Granularity test (resolves the category worry)
A record type = finest level where redaction, public-availability, routing, and rough cost all stay the same.
- Too broad ("Documents"): rules conflict -> split.
- Too fine ("Annual Budget 2024"): that's an instance -> belongs in the index.
- Same format, different handling (body-cam vs council video) -> different record types. Format is an attribute; rules define the type.

## Open decisions (when fresh)
1. Final category list + count.
2. Redaction profile: attribute on the type vs separate linked library (lean: separate library).
3. Smart Routing initial granularity (record-type now; employee-level later?).
4. "Canonical/singular" flag on some record types, for cost/public-ready bypass of specific known documents.

## What's already resolved
Owner-vs-fulfiller, A/V multi-department, paper-then-PDF, data-vs-output, and where cost/public-ready live - all handled by the hub model above. Nothing Kevin typed is lost.

## Descriptive knowledge on a record type (added 2026-06-04, from intent/content discussion)
Key insight: citizens describe a SITUATION + CONTENT, not a type name. Synonyms only catch alternate names -> big gap. Add richer fields beyond synonyms:
- intent/purpose: what the record exists to capture (body-cam = events an officer is directly involved in while on duty). Acts as a DISCRIMINATOR -> lets AI EXCLUDE plausible-but-wrong keyword matches (e.g. use-of-force training video, council clip).
- expected_content + typical_request_reason: what's in it + situations that drive requests (use of force, wrongful arrest claim). Matches how citizens actually phrase requests; also guides what to extract at indexing time.
- identifying_facets: date, location, persons/officers, incident/case # -> the details that pin down a SPECIFIC instance.

Agent behavior (resolves the "nothing found vs wrong result" dilemma): in the ambiguous middle, the agent ASKS one targeted, benign question driven by the type's identifying_facets (not a generic "tell me more"). Separates two questions that were tangled: (a) is this the right TYPE? [taxonomy + intent] vs (b) do we have THIS specific instance? [connector/index + facets]. Honest outputs: confident on both -> return; right type but unconfirmed instance -> say so, confirm one detail, route to records team; not a fit -> say so plainly. Never fabricate a match, never wrongly stonewall.

## Two kinds of clarifying question (added 2026-06-04)
Agent runs an in-conversation retrieval pass; candidates return TAGGED with record type + relevance score. The SHAPE of results decides what (if anything) to ask:
- one type clearly dominant -> lead with it (no question).
- several types, close + distinct purpose -> TYPE-LEVEL question ("which kind?"), from candidates' differing intent/purpose. E.g. "Milford Park pool" matches contract, council minutes, AND agenda; ask "the signed contract, or the council's record of approving it?"
- one type, several instances -> INSTANCE-LEVEL question ("which one?"), from identifying_facets (body-cam case).
Trigger to ask = multiple matches AND closely scored AND differ in a way that matters. Do NOT ask when the description already names a type ("the contract ...") -> lead with it + name alternatives. Over-asking erodes confidence as much as a wrong result.

## Email-specific lessons (added 2026-06-04)
Email is special: huge undifferentiated pile, no titles; only scalable handles are metadata (sender/recipient/date) + full-text/semantic search of bodies.
- UNDER-SCOPED (unbounded) request: topic-only, no custodian/date. Records-law backdrop = "reasonably describe" requirement; remedy = clarification, mostly discretionary (codified thresholds rare). Per-agency posture lives in Jurisdiction Profile.
  KEY MOVE = SCOPE ASSISTANCE by DERIVATION: don't just demand sender+date the requestor doesn't know. Use OTHER record types (council agenda/minutes) to derive the date + custodians of the event, then propose a scoped search to confirm. One record type bootstraps another. Reframe: "let me make this fulfillable," not "insufficient, denied."
- Attachments-by-content = capability, not selection. Requires connector to extract+OCR+index attachment text JOINED to parent email.
- Admin guide / acceptable-use policy turning up = same intent discriminator (different record types in Technology/Policy categories; intent excludes them).
- AUTO-RELEASE ELIGIBILITY principle: a record type is eligible for auto-release/immediate-download ONLY if every exemption that could apply is AI-DETECTABLE from content (SSN, DOB, phone, address). CONTEXT-DEPENDENT exemptions (ongoing investigation, undercover identity, active litigation, subject is a minor) depend on facts NOT in the document -> AI cannot judge them. Email is dense with these -> email defaults to HUMAN-REVIEW-REQUIRED, never auto-release. After a human clears a specific email, that version can enter the public-ready index.
- Competitive (verify before claiming): established platforms (GovQA/Granicus, NextRequest, JustFOIA tier) = workflow tools; email handled manually / eDiscovery-style. Our conversational semantic cross-record scoping is ahead, BUT govtech AI is moving fast.
