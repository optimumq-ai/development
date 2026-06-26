# Public-Ready Records Library — Design

**Status:** Design captured from a brainstorming session. Nothing in the "later phases"
is built. Phase 1 is scoped but not yet started. This doc is the reload-the-mental-model
artifact — read it cold and you should be able to see all the moving parts again.

**Date captured:** 2026-06-26
**Companion docs:** TAXONOMY_DESIGN.md, AUTO_CONFIG_DESIGN.md, VIDEO_REDACTION.md

---

## 1. The idea in one paragraph

A **public-ready records library** is a single logical store of records that have already
been cleared for public release — the vetted output of the redaction/release process. It is
the thing the portal should search FIRST (before falling through to live source systems), and
it is the foundation for a future dedicated public "browse and download" page (the recognized
"Electronic Reading Room" / "FOIA Library" pattern). Because the library is bounded and already
cleared, it is the one place where indexing everything (keyword + semantic vector) is cheap,
safe, and high value. Search and browse are two front doors onto the same indexed library.

## 2. The reframe that drives everything: three populations, three policies

The recurring question "should we index everything in the vector DB?" dissolves once records are
separated by **clearance status**, because the real axis is not "API vs index" — it is "who is
searching, and has the content been cleared for them to see?"

1. **Public-ready library** (vetted, bounded, cleared) — index it completely (keyword + vector),
   expose semantic search to the public. No exempt-content-in-the-index risk (already cleared),
   finite so cost/refresh is trivial, and it is exactly what the citizen wants most. **Search hits
   this first.** This is the Reading Room.
2. **Raw records in source systems with their own search** (Tyler, Axon, Laserfiche, email) —
   live-query for request intake/matching. Where the source's own search is keyword-only and recall
   stakes are high (incident reports — the "fight" vs "assault" vocabulary-mismatch case), index that
   source's content into an **access-controlled STAFF semantic layer**, never a public one. The
   request process is the safety net for a citizen-side keyword miss: a miss is not a final miss, it
   becomes "we'll search and process this for you," and staff (who can see raw content) search
   authoritatively and review before release.
3. **Raw files on disk** (file stores) — index for staff search (pipeline already exists); same
   access control as (2).

Net: you GET index-everything where it is safe (public-ready), and you get semantic recall where it
matters (staff incident search), without ever putting un-reviewed exempt content in front of the
public. The fight/assault example, looked at correctly, argues for **staff-side** semantic indexing
of incident reports — not public index-everything.

## 3. Grounded code reality (verified against the live codebase 2026-06-26)

**The library already half-exists. It is the `fulfilled_records` table.** Its own schema comment
reads: "Fulfilled Request Index (a.k.a. Released Records Library): records already processed and
released. Tier 1 of search reads this so previously-released records surface first."

What exists today:
- **Table `fulfilled_records`** with columns: id, request_id, source_file_id, output_file_id,
  title, summary, record_type_id, department_id, keywords, public_availability (released|redacted),
  page_count, released_by, released_at, status. Good bones — several of the metadata fields we want
  are already columns.
- **Keyword search over it is live and already prioritized.** `recordSearch.searchPublicReady(query)`
  (services/recordSearch.js:24) loads released rows, keyword-scores via connectors/keyword
  (tokenize+match), applies the relevance floor (>=2 matched terms OR a title/record-type hit),
  returns top 5 tagged `publicReady:true`. It is concatenated into `searchAll()` (line ~136) and
  prioritized by the soft-routing sort. So "search public-ready first" exists as KEYWORD today.
- **A deposit path exists.** `redactionApply.applyRedaction()` (services/redactionApply.js:181)
  inserts into fulfilled_records when a redaction is APPLIED (status set 'released'). Idempotent
  (DELETE by source_file_id first). `structuredRedaction.js:176` does the same for the structured/AV
  path.
- **Embedding plumbing is reusable as-is:** `voyageEmbed.embed(texts, opts)` -> vectors (MODEL,
  DIM=1024, cosine); `embedIndex.upsertEmbedding(ownerType, ownerId, vec, content)` (generic upsert
  into the polymorphic `embeddings` table, owner_type/owner_id, native pgvector `<=>`); `bg(promise,
  label)` for fire-and-forget. Existing patterns to mirror: reindexRecordTypes, reindexDocumentPages.

What is MISSING (this is the work):
- **No embeddings on fulfilled_records.** Live embeddings table holds 82 `record_type` + 30
  `document_page` vectors and zero `fulfilled_record`. The library is keyword-only — no semantic
  recall (so the fight/assault miss applies to it too until we embed it).
- **The deposit metadata is crude.** Today title = filename minus extension; summary = the request
  description; keywords = record-type name + title. No AI summary, no event date, no clean title.
- **Mass redaction does NOT deposit.** massJobs.js produces redacted outputs but writes nothing to
  fulfilled_records — exactly the gap noted in brainstorming. Bulk/onboarding batches never reach
  the library today.
- **The deposit fires on APPLY, before any review/approval gate, and publishes unconditionally.**
  redaction_jobs has review_stage/reviewed_by/reviewed_at/submitted_by, but the fulfilled_records
  insert happens at apply with status='released'. There is no "should this be published to the open
  library?" eligibility decision (a one-off record released to a single requester is not
  automatically reading-room material).
- **Live corpus is essentially empty:** fulfilled_records has 1 row. The demo portal "public-ready"
  experience is mostly the live demo connector (demo_documents), not the library.

## 4. Metadata set (the relational fields are what make browse work)

Browse is built from the fields that let records RELATE to each other, not just describe themselves.
Capture metadata at the public-ready stage, split into template-constant vs record-variable, and
**derive it ONLY from the redacted, public-ready copy — never the raw record** (this is the rule that
keeps the whole experience clean: extraction runs on already-cleared content).

**Phase-1 subset (helps search, cheap, build now):**
- record_type_id + department_id — let search filter/prioritize (library-side taxonomy routing).
- event_date — distinct from released_at; "from last March" should mean when it happened.
- summary (plain-language, 1-2 sentences) — the quiet high-value field: denser/cleaner text for the
  semantic index than raw OCR, and what makes a browse list readable. (Replaces today's "summary =
  request description".)
- a cleaner title (extraction with confidence; today it is just the filename).
- searchable text + its embedding (the search index itself — non-negotiable for search-first).

**Browse/map fuel (defer to later phases):**
- geocoordinate + address (map pins, address-based wandering — highest-leverage civic field).
- entities (contractor, vendor, business, person where releasable) — power "more like this".
- topic/subject tags (small controlled vocabulary) — "related by theme" across record types.
- homogeneous/heterogeneous flag — decides scroll-the-stack vs titled-list rendering.
- mappable flag — record TYPES that may be searched but must NOT appear as map pins (see Map).

**Template-constant vs record-variable:** for a single-type batch, department / record_type /
homogeneous flag / mappable flag / topic tags are IDENTICAL for every record — set ONCE on the
mass-redaction template, stamped on every record, no per-record AI cost. Only title / event_date /
address / entities / summary need per-record extraction. Low-confidence extractions go to human
review (same propose-then-review pattern as everything else).

**Terminology (keep distinct in code + docs):** EXTRACTION = AI reads the cleared copy and produces
metadata fields. EMBEDDING = the text becomes a vector for semantic search. Phase 1 needs both:
extract the small field set, embed the searchable text. The browse/map phase adds more extraction
(more fields) but no new embedding work.

## 5. Deposit paths and triggers

Every path that produces a cleared copy should deposit a COPY into the library (its own stored
artifact, divorced from the request, so amending/deleting the request never disturbs the published
version), with the same metadata schema regardless of origin.

- **Request process** (today: redactionApply on apply). Change to: deposit at the point the record
  is provably cleared, plus an eligibility gate. Lean: redaction-APPROVAL (reviewed/approved), not
  "shipped" — approval is the single reliable "cleared for release" gate; shipping varies by delivery
  method and may not fire cleanly. Add a **publish-to-public-library** decision (auto for some record
  types via a flag, human toggle for others) so a record released to ONE requester does not auto-
  publish to the open library.
- **Mass redaction** (today: no deposit — must be ADDED). Template gains the constant metadata fields;
  the job gains a per-record extract+embed+deposit step running on the redacted output.
- **Structured / A/V** (today: structuredRedaction.js already inserts). Same handoff; A/V stores the
  redacted copy with a thumbnail/poster + transcript, and the TRANSCRIPT text is what gets indexed
  (makes video/audio searchable by what is said/shown, like documents by their text).

## 6. Search-first (the Phase-1 payoff)

The keyword tier already exists. Phase 1 adds the semantic tier on the SAME library:
- New embedding owner_type `fulfilled_record`; embed the searchable text (title + summary + extracted
  text) at deposit time via the existing bg()/upsertEmbedding plumbing.
- In searchPublicReady (or a sibling), add a pgvector query (`<=>`, mirror semanticSearch.js) over
  owner_type='fulfilled_record', merged with the existing keyword score. Keyword for precise hits,
  semantic to catch vocabulary-mismatch misses, then the existing post-search JUDGE cleans up
  (semantic trades precision for recall — the judge is exactly why keyword-first -> semantic ->
  judge is attractive).
- Demonstrable win: a citizen describes a record, the portal hands them the already-cleared copy
  instantly instead of routing them into a request (the VA reading-room "search first" pattern).

## 7. Browse surface (a different MODE from search: passive discovery, not intent)

Search is for intent ("I need the permit for 123 Main"). Browse is for curiosity with no target —
wandering and stumbling onto something. The browse needs lateral moves, not just a downward tree.

- **Drill-down spine (deterministic, the easy part):** Department -> Record Type -> Year/Month ->
  records, with a viewer. It is just "group by" over metadata; NO AI runs at browse time. Grouping is
  by the tag stamped ONCE at release, so the tree is stable and predictable (runtime AI clustering
  would reshuffle the tree unpredictably — do not do it). Counts on nodes; empty branches hidden;
  lazy-loaded.
- **Homogeneous vs heterogeneous rendering:** homogeneous high-volume form-stacks (permit
  applications, inspections) render the scroll-through-the-stack viewer where drill-down shines.
  Heterogeneous types (council agendas, emails, correspondence, contracts) render a plain reverse-
  chronological titled list, or are simply found by search. The browse does NOT need to cover
  everything the same way (a library has browsable shelves AND a catalog). The homogeneous flag on
  the record type drives which rendering is used.
- **Lateral "more like this" (the real discovery engine):** from one record, surface others sharing
  address / contractor / vendor / department / time window / type (exact-field) and conceptually
  similar (semantic). One permit -> the others on that street; one contract -> others with that vendor.
- **Time and place as browse axes:** a scrubable timeline; a map for geographic types (see Map).
- **Entry points that invite a first click with no question in mind:** "Recently released", "Most
  viewed", "Newly added: 40 building permits", featured/seasonal collections, and especially the
  frequently-requested records (the natural front-window display; the legal reading-room category).

## 8. Map (the applause feature — and the highest-sensitivity surface)

Why it matters: a homeowner clicking their own block — every permit, inspection, road project nearby
— is a transparency win an elected official can announce. It is the one part of the platform visible
to voters, which changes WHO champions the purchase (elected official, not just the records clerk).

Architecture that keeps cost near zero (basemap and data layer are SEPARATE problems):
- **Open basemap floor (free):** Leaflet/MapLibre over OpenStreetMap tiles — no API key, no per-view
  billing. (Google Maps charges per load + needs a billing key — not needed here; this is the source
  of the cost worry, and the answer is simply not to use it.)
- **Optional city-GIS layer (authoritative, low-risk):** most prospective cities run planning/zoning
  GIS (Esri/ArcGIS dominant; QGIS open). They can publish layers via standard web services (ArcGIS
  REST / WMS / WFS / GeoJSON). Two uses: (a) the city's GIS is the ADDRESS/PARCEL authority for
  accurate geocoding (solves the misgeocoded-pin-in-the-wrong-yard embarrassment, far better than a
  generic geocoder); (b) an official parcel/zoning/district overlay UNDER our dots ("that's OUR map,
  with the records on it"). Read-only consumption; we never write to their GIS — the kind of
  integration IT approves without a long review. "GIS source" becomes a per-city configuration item
  (jurisdiction-profile philosophy), with graceful fallback to open basemap + standard geocoder when
  a city cannot/will-not provide one. The map never DEPENDS on city GIS; it is better when present.
- **Our records as the top clickable layer:** the yellow dots are just our public-ready metadata —
  the part we own outright.

Two guardrails:
- **Surveillance failure mode:** plotting records by address aggregates in a way no single document
  does. A homeowner on their own block is the dream; someone building a pattern around a specific
  person's home (e.g. every police response to an address) is the nightmare — and incident records
  are exemption-laden. Defense: only cleared copies reach the library + a **per-record-type "mappable"
  flag** so sensitive types can be searchable-but-not-pinned. "We thought about the surveillance mode
  and here is the toggle" is itself a selling point to a city attorney.
- **Geocoding accuracy:** address -> lat/long is solved but not free or perfect; a bad pin on a public
  civic map is worse than a bad search result. Treat geocoding with the same confidence/review
  treatment, and prefer the city's own parcel authority as source of truth.

## 9. The dedicated public-ready page (Reading Room)

Strongly validated by research; this is a recognized, legally grounded pattern:
- **"Electronic Reading Room" / "FOIA Library":** federal agencies MUST affirmatively post four
  categories of records for public inspection without a request, including records requested 3+ times
  (5 U.S.C. 552(a)(2)). The VA's version even auto-searches the reading room at intake before a
  request proceeds — our "search public-ready first" exactly. Trend is proactive disclosure to
  eliminate requests entirely (e.g. EPA posting datasets).
- **Competitor "Reading Room":** Casepoint's "Reading Room AI Assistant" lets would-be requesters
  search a library of published completed-request documents via a CHAT-based search. That is precisely
  our conversational-search instinct — and we already own the agent tech to do it, better.
- **What Dallas has (and why "I could build better" is fair):** the Dallas Police Public Data Viewer
  is a filtered, attestation-gated browse of releasable offense/arrest DATA driven by the city's open
  data portal — structured, dated UX, not document/A-V semantic search. Plus Dallas OpenData (raw
  datasets) and the County Clerk index+OCR property search. None is a modern document + A/V semantic
  search.
- **Design for ours:** no login, no request framing — just search + browse + download. Hybrid
  keyword + semantic over the public-ready index; facets (category/department/date/media-type); the
  conversational agent as an optional layer (reuse existing). A/V copies in the same library with
  thumbnail + indexed transcript.

## 10. Phasing (critical path first; everything else bolts on without rework)

The point of phasing: search-first needs only a THIN slice; browse/map/page are later layers on the
same foundation.

**Phase 1 — search public-ready first, semantically (the foundation + the testable win):**
1. Confirm fulfilled_records is the repository; add the small metadata fields it lacks (event_date;
   provision for a real summary/title).
2. Improve the request-process deposit: extract a real summary + event_date + clean title from the
   redacted copy; embed (owner_type='fulfilled_record') via bg()/upsertEmbedding. (Build the extract
   pipeline now, small field set, so later phases just "extract more fields".)
3. Resolve the trigger/eligibility question (deposit at approval; add a publish-eligibility gate).
4. Add the semantic query to searchPublicReady (pgvector, merged with keyword), let the existing
   judge clean up.
   -> Testable end-to-end: approve a redacted record -> it lands in the library, embedded -> a portal
   search surfaces it from the library (incl. a vocabulary-mismatch query) instead of a live connector.
   The request-process path is the better first populator for TESTING (one record at a time, hand-
   craftable). Defer mass-redaction deposit, browse, and map.

**Later phases (independent, non-blocking):**
- Mass-redaction deposit path + template-constant metadata (bulk + onboarding populate the library).
- Browse metadata (geocoordinate, address, entities, topic tags, homogeneous + mappable flags).
- Browse surface (drill-down + homogeneous/heterogeneous rendering + "more like this" + timeline).
- Map (open basemap + optional city-GIS overlay/geocoding + mappable guardrail).
- Dedicated Reading Room page (no-login browse/search/download; A/V with transcript).
- Staff-side semantic indexing of high-stakes sources (incident reports) — its OWN later decision.

## 11. Open questions to resolve against code/taxonomy before/within the build

- **Browse-leaf granularity vs taxonomy depth:** the "all Single-Family Construction Permit
  Applications grouped" leaf only works if the taxonomy goes that deep. ~82 record types exist;
  verify whether the relevant types are granular enough or need deepening / a secondary grouping key.
- **Trigger:** confirm deposit should move from apply -> approval; define the publish-eligibility
  flag (per record type auto vs human toggle).
- **datetime('now') in the inserts:** redactionApply/structuredRedaction inserts use SQLite-style
  datetime('now') and `?` placeholders under try/catch; the DB is Postgres. It currently lands rows
  (1 row exists) so a shim translates — but confirm the shim covers it and the try/catch is not
  silently swallowing failures at scale.
- **Title + event_date extraction reliability:** both ride on the existing AI extraction-with-
  confidence pipeline; messy titles/filenames are the soft spot most likely to look broken if skipped.
- **A/V viewer:** PDF viewer is easy; the media player + transcript view is a separate component —
  ship documents first, A/V as a fast-follow.
- **Geocoding source of truth:** prefer the city's parcel/address authority; define the generic-
  geocoder fallback.
- **Copy vs pointer:** confirm each deposit stores an independent copy artifact, not a reference into
  the request workflow's working files.

## 12. Locked principles carried in from the brainstorm

- Metadata for the public library is derived from the redacted, public-ready version, never the raw
  record.
- Search and browse are two front doors onto ONE tagged library.
- Grouping/tagging is deterministic (stamped once at release), not runtime AI clustering.
- The map never depends on city GIS; city GIS is an enhancement, with an open-stack fallback.
- "route" = get a request to a team/queue; "assign" = get a task to a person (carried from workflow).
- EXTRACTION != EMBEDDING (Section 4).
