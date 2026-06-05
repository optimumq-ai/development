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
