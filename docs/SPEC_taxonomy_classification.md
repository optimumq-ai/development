# Consolidated Spec — Domain 3: Taxonomy & Classification
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[OPEN]`

## 1. Taxonomy structure `[BUILT]`
Two levels: **categories** (15) → **record_types** (77 active; 84 incl. drafts). Rich per-type metadata (31 columns): synonyms, keywords, disambiguators, intent, expected_content, typical_request_reason, identifying_facets, formats, is_structured_data, public_availability, auto_release_eligible, redaction_profile_id, fee range, fulfillment_method, medium, auto_publish, mappable, status, source, confidence. Links: `record_type_departments` (roles **owner** and **fulfiller**, many-to-many) and `record_type_repositories` (types ↔ sources). Full CRUD + link management via taxonomy routes; managed on TaxonomyPage. Design Choice C (types and repositories as separate linked entities) — per TAXONOMY_DESIGN.md.
**`[OPEN]`** No level below record_type (verified: no variant/subtype table). Variant-level granularity + profile-per-variant is an open design decision held by Kevin (bucket-types problem, e.g., building-permit variants).

## 2. AI classifier & routing `[BUILT]`
One AI call does two independent steps: (1) match against the **active taxonomy** (compact catalog with synonyms/keywords injected) returning record_type + 0-100 confidence; (2) a **general-knowledge department guess**, with explicit instruction to return null rather than guess when off-topic/vague. Routing basis:
- **taxonomy** — confident type match → owner department; fulfiller team override honored (`record_type_departments.role='fulfiller'`).
- **general** — no type match but department guess → that department's processing team.
- **unassigned** — classifier abstains → request left team-less for the **triage queue** (never auto-stamped to a real team).
Confidence ≥ 70 also pins `record_type_id` onto the request (feeds estimate-profile lookup + task screens). Classification result + reasoning persisted to `workflow_decisions` for audit.

## 3. Embeddings & semantic layer `[BUILT]`
`embeddings` table (pgvector) + Voyage AI (`voyageEmbed`), shared by: record-type semantic match (`/semantic-search/record-types`), document search (`/semantic-search/documents`), library/public search, and Smart Routing's user-specialization matching. embedIndex maintains the index.

## 4. Schema discovery `[BUILT — propose/approve]`
`POST /taxonomy/discover` → connector `scan()` pulls sample documents from a repository → AI identifies distinct record types across samples → for each: either **matches an existing type** (linked to the repo) or **proposes a new one**, inserted as `status='draft'`, `source='discovered'` with confidence + example files. **Humans approve** by activating drafts on TaxonomyPage — drafts don't participate in classification (classifier uses active only). SchemaDiscoveryPage fronts this. Matches the AI-proposes/human-approves principle.

## 5. Known gaps / open
- Variant/sub-type level `[OPEN — Kevin]` (blocks per-variant estimate + redaction profiles).
- Template seeding was ~55 types/13 categories; live catalog has grown to 77/15 — the delta is city-specific + discovered types `[healthy]`.
- Auto-discovery counting groupings for mass-redaction candidates (Kevin's concept) `[NOT BUILT]` — related to the variant decision.
