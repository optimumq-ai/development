# Session State — 2026-06-26 (portal search overhaul + taxonomy/vector grounding)

Read this first in a new chat, then SESSION_HANDOFF.md and the design docs. Code + git are the
source of truth; the chat transcript is not. HEAD at write time: 466d84f, health 200, tree clean.

## What was built/fixed this session (all committed + pushed)
Portal search was overhauled end to end. In order:
- Search false-positive floor fix: released/public-ready records now need >=2 matched terms OR a
  title hit; killed the "January"->tax-return 60% bug. Reduced flat +50 public-ready boost to +15;
  added relevanceNote so cards show why they matched. (recordSearch.js searchPublicReady)
- Post-search JUDGE (recordSearch.judgeResults): after searchAll, an AI call keeps only results
  that ARE the kind/format the person asked for (drops topical docs for a footage request),
  ignoring scores. FAIL-OPEN, toggle system_config portal_search_judge (default ON). Wired into
  publicChat after searchAll. Made RELIABLE via: temperature 0, a concise prompt with a worked
  example, ASSISTANT PREFILL ('[') to force array-only output, numeric-array regex parse. (The
  earlier STEP-by-STEP prompt made it answer in prose -> parse failed -> fail-open kept everything.)
- Hybrid taxonomy ROUTER (recordSearch.matchRecordType): cheap keyword pass for clear winners;
  when weak/ambiguous, a small AI classifier picks the best record type from the full taxonomy;
  falls back to keyword >=2-hit. Toggle portal_search_ai_routing (default ON), fail-open.
- SOFT routing (not hard narrowing): searchAll always searches every active source and only
  PRIORITIZES the matched type's source(s) in the sort (public-ready first, then _routed, then
  score). This is the fix for the thin/partial-taxonomy Achilles heel — routing can never EXCLUDE
  the right source, worst case = plain broad + judge. _routed tag stripped before returning.
- Step 2 RESULT-AWARE replies (publicChat two-phase compose): after the search, a focused
  standalone compose call (NOT the full agent prompt — that caused re-emission of markers) writes
  the citizen reply: results -> "found these, do any match?" + quick replies; zero -> "no
  public-ready match, I'll submit for processing" + continues intake. (Was written a prior session
  but never committed AND the live process predated it — found orphaned, fixed, committed.)
- Axon connector results relabeled as "Body-worn / in-car camera footage" (docType + summary lead)
  in both search() and nativeSearch(), so the judge + citizen recognize them as the video
  deliverable, not an ambiguous "Police Incident".

Commit chain this session: f229993 (floor) -> 4064696 (judge step1) -> a18ebba (judge reliability
+ step2 compose) -> 466d84f (judge footage/doc discrimination + axon footage labeling).

## Verified working
- Dash-cam (no matching incident): search -> judge drops docs to ~0 -> reply gracefully says "no
  public-ready match, submitting for processing" and asks delivery method.
- Body-cam footage that DOES match (e.g. "vehicle pursuit at Northgate"): Axon stub returns the 3
  footage incidents (restricted/redaction-required), judge keeps footage + drops docs, reply asks
  "do any match?" with quick replies. Cards already hide download + show REDACTION REVIEW badge.

## Ground truth learned this session (corrects stale assumptions)
- TAXONOMY = 3-level catalog: 15 Categories -> Record Types (BUCKETS, with identifying_facets /
  disambiguators / formats describing variations) -> linked Sources (record_type_repositories,
  digital and/or paper). It is type-level, NOT document-title level.
- AUTO-DISCOVERY (schemaDiscovery.js): connector.scan() returns a SAMPLE (filestore default 50
  PDFs), AI identifies DISTINCT record TYPES and proposes draft catalog entries (status='draft',
  source='discovered') for human approval, links the source. Type-level, sampled, proposal queue.
  Only filestore + structured connectors support scan. Paper is NOT auto-discoverable (curated via
  the paperindex connector).
- VECTOR DB (embeddings table, voyage-3.5-lite, pgvector): polymorphic owner_type/owner_id. Holds
  82 record_type embeddings (auto-reindexed on taxonomy create/edit/approve; used for semantic
  routing/classification) + 30 document_page embeddings (from files INGESTED into the platform via
  docProcessing OCR pipeline). It is NOT a crawl of source systems.
- BIG ONE: the PORTAL search does NOT use the vector DB at all. recordSearch.searchAll = keyword
  over fulfilled_records + LIVE connector search over source systems (demo stubs: axon:4002,
  tyler, laserfiche; filestore reads disk) + the judge. Portal "AI search" = Claude RANKING live
  connector results, not vector similarity. The vector DB powers a SEPARATE /api/semantic-search
  (staff-side) + query->record-type routing.
- The agent does NOT get taxonomy clarification data today. It receives only the NAMES of
  manual/bulk record types (for expectation-setting) via buildFulfillmentGuidance. Its clarifying
  questions come from GENERAL knowledge, not the taxonomy's identifying_facets/disambiguators
  (which exist and would be the ideal source).
- Demo "2018_TaxReturn" fulfilled_record has a mismatched summary about building permits (bad seed
  data that caused confusing matches) — flagged, not yet fixed.

## Open threads / parked (with leanings)
1. Taxonomy-driven CLARIFICATION: feed matched record type's identifying_facets/disambiguators to
   the agent so it asks grounded, per-type questions and SKIPS questions already answered (adaptive,
   not always-ask). Not built.
2. Repeatable, EXPLAINABLE search process Kevin wants: keyword-first ("we look for records
   containing your words"), AI/semantic fallback only if keyword is empty/weak (result-driven
   escalation, not predict-then-pick). Description-character can be a shortcut hint. Kevin liked
   framing odd keyword results to the user as "let's start by searching for documents that contain
   your keywords." Not built. (Note: today portal keyword+AI run together and merge; this would
   restructure into explicit sequential escalation.)
3. Smart-routing RULEBOOK + launch-from-failure staff AUTHORING AGENT (structured rules enforced by
   code; agent interviews staff to fill structure; separate from citizen agent; conditional
   screenshot ask is cold-start fallback). Designed, not built. See earlier discussion.
4. Taxonomy COMPLETENESS gating: two-key model + completeness dial. Denominator must be INDEPENDENT
   of discovery (not circular) — use a fixed expected-types checklist OR a raw file/structural
   census; OR gate on COVERAGE of completed work (every source discovered, every proposed type
   triaged). See docs/ONBOARDING_TAXONOMY_GATING.md.
5. Kevin's "additional taxonomy content" ideas (would raise accuracy) — he has more to share.
6. Taxonomy AI AGENT (clever name) to help build/maintain taxonomy — extension of auto-discovery
   into an interactive reviewer/maintainer. Kevin's idea.
7. Body-cam demo polish: real file download is a PLACEHOLDER across the portal ("coming soon"
   alert), so linking Kevin's uploaded test videos (/opt/optimumq/uploads/*.mp4, from ~6/20-21) to
   a downloadable released clip is gated on building real download. Also the explicit "this is the
   full multi-hour file, must be reduced to the relevant segment" messaging isn't surfaced yet.
8. Kevin is comparing the OLD Replit build's search (he believes it did full-corpus vector indexing
   with a nightly reindex per connector + some undocumented clever UI features). He is bringing a
   description + screenshot. Goal: decide whether to adopt index-everything-with-refresh for the
   portal (the architectural gap above), and recreate any clever features. A paste-ready
   extraction prompt was given to him.

## Connectivity / workflow notes
- Kevin on flaky Starlink; SSH MCP times out / "No response from server" frequently — RETRY, verify
  state after. On a dropped chat + retry, his app resends his last msg and WIPES the transcript of
  my response, but the WORK SURVIVES (it's committed). Protocol on reconnect: run
  `git log --oneline`, health check, `git status` — commits are truth.
- COMMIT EACH VERIFIED SLICE IMMEDIATELY (orphaned uncommitted work has bitten twice).
- Patch method: python heredoc with rep(a,b) asserting count==1. Mask pushes:
  `| sed -E 's#//[^@]*@#//***@#g'`. Bracket-check JS before frontend build. Never echo secrets.

## Thread 9 — Agent-driven exploratory user testing (for the spec; not built)
Kevin's goal: a "next-generation" AI-leveraged company — cut headcount/overhead, improve code
quality + customer experience, reduce dev/test + onboarding effort. He wants AI agents to perform
simulated USER testing that finds system issues AND flags where documentation needs fixing.

Two distinct kinds (keep separate):
- DETERMINISTIC regression (Playwright/Cypress): records exact selectors/clicks/values, replays
  identically. Good for "is this EXACT thing byte-identical before/after a change" (a calc, a data
  write). Brittle to UI changes, no judgment. NOT the main thing Kevin wants.
- GOAL-DRIVEN EXPLORATORY agent testing (what Kevin wants): give the agent a plain-English
  objective + portal access + ONLY what is self-evident in the UI and learnable from user guides;
  it finds the path like a real user and REPORTS what was confusing / not self-evident / where it
  got stuck / what broke. A synthetic user WITH judgment.

Why reusable across future UI changes (Kevin's instinct, confirmed): tests describe INTENT
(goal + constraints), not implementation (selectors/steps), so a redesign doesn't break them. To be
durable AND rigorous each scenario needs three parts: OBJECTIVE + WHAT IS KNOWABLE (UI + guides
only) + OBSERVABLE SUCCESS CONDITIONS (e.g. "a request number was issued", "fee notice shows the
second estimate", "footage result marked redaction-required, no download"). Success conditions give
clear pass/fail despite the non-deterministic path. Do not omit them.

Docs-audit benefit: restricting the agent to UI + guides means every stuck/guess pinpoints a
UI-clarity gap or documentation defect with high specificity. One pass tests the system AND audits
the docs against each other.

Now vs later:
- REQUESTOR-SIDE: achievable today via Claude-in-Chrome against the live portal. Give a scenario
  (vague request / multiple-match clarification / unpaid second estimate / footage needing
  redaction); Claude drives the portal as that citizen and returns a narrative. Repeatability =
  re-run the SAME scenarios and compare narrative reports (catches regressions a rigid script
  misses).
- STAFF MULTI-ROLE sim (agent logs in as different employees, reads docs + AI Help Assistant,
  figures out who does each task to process a request to completion): reusable in DESIGN but more
  FRAGILE in practice. GATED on user guides, the AI Help Assistant, and stable test accounts. Claude
  must only log in as users whose credentials Kevin explicitly provides for that session.

OpenClaw / computer-use: OS/pixel-screenshot level (any app, slower, more brittle, more setup). For
a WEB portal, Claude-in-Chrome is better (reads DOM -> faster, less brittle). OpenClaw only earns
its keep for non-browser desktop apps; no need to coordinate both here.

Complementarity: agent testing = "does it make sense, roughly work, and where are doc gaps";
scripted regression = "did this exact thing change". Use both.

Sequencing: requestor-side scenarios first (runnable today), staff-side layered in as docs + Help
Assistant + test accounts mature. The scenario specs are the durable, reusable asset; put the
approach in the spec.

## Thread 10 — Email-request search as a distinct COUNT-ONLY mode (for the spec; not built)
What exists: email appears in the taxonomy as record-type buckets — "Official email correspondence",
"Text & instant messages", "Internal memos & correspondence" — but there is NO email connector and
NO email-specific search behavior. Today an email request falls through the normal document path
(wrong). The taxonomy buckets give the router a hook to DETECT an email request and switch modes.

Kevin's approach (validated as sound + matching real practice):
- Email is searched KEYWORD-ONLY, always. Basis: the public-records "reasonably describe identifiable
  records" standard, which for email means (per e-discovery practice) search TERMS + CUSTODIANS +
  DATE RANGE. Semantic/AI search over raw email is awkward (email APIs are term-based) and legally
  murkier. Email is the purest case of the "keyword-first explainable search" goal (Thread 2).
  Specifics vary by jurisdiction -> Jurisdiction Profile config. (Do NOT fabricate a specific statute.)
- COUNT-THEN-NARROW: run the term search, report the hit count; if large, disclose it and invite
  narrowing. Highest-leverage levers for email are CUSTODIANS (sender/recipient) and DATE RANGE, not
  just more terms — the narrowing prompt should solicit those specifically.
- COUNT-ONLY, never content or subject lines. KEY distinction from the document path: released docs
  show titles/summaries because vetted; raw email hits are UNREVIEWED, and even a subject line or
  sender can contain exempt/PII content. Email mode renders NO content cards — just a number + the
  narrowing conversation. The post-search JUDGE does not apply (no content to judge).
- DISCLOSURE: all requested email is subject to inspection for exempt content before release (email
  almost always needs review/redaction: PII, personnel, attorney-client, security, third-party).
  Fold into the same message as the count. Even the count is pre-review.
- Zero-hit: "no emails matched those terms — broaden, or submit for staff to search."
- Configurable threshold for what counts as "large" enough to trigger narrowing.

Workload framing (honest): front-loads SCOPING so the request reaches staff/email-system owner
already targeted and reasonably-described, not a fishing expedition that bounces back. Reduces
back-and-forth a lot but does NOT eliminate staff — authoritative search + review stays internal.
Real value: helps the requester meet the "reasonably describe" standard before submitting.

Build needs (net-new): an EMAIL CONNECTOR that runs a term/count query WITHOUT returning content,
against Exchange/O365 (Microsoft Graph or Purview eDiscovery) or Google Workspace (Vault) — these
support count-style queries with custodian + date filters. Credentialed access required; a stub can
return synthetic counts for demos. Self-contained search MODE gated by the router detecting an email
request: distinct conversation (narrowing loop), distinct presentation (count not cards), distinct
disclosure.

Ties to: Thread 1 (taxonomy-driven clarification — email facets = terms/custodians/date-range) and
Thread 2 (keyword-first explainable search).

## Thread 11 — How file/document search ACTUALLY works (corrects the "samples" confusion) + hybrid architecture
CORRECTION to an earlier confusion: auto-discovery's SAMPLE (filestore scan(), default 50 PDFs) is
for DISCOVERY ONLY — lets the AI glance at a handful to propose the taxonomy BUCKET ("this folder
contains building permits"). It does NOT limit what search can find.

filestore.js (verified): exports scan() + nativeSearch() (NO .search()).
- scan(config): up to sample_limit (50) PDFs, pdftotext -> {filename, first 1500 chars}. Discovery.
- nativeSearch(query, config): loops EVERY PDF in the dir (no limit), pdftotext extracts FULL text,
  keyword-matches terms vs filename + content, returns top 8 with snippets. Reads the live corpus at
  query time; samples are irrelevant to it.

Lenmark example: "building permit for Lenmark Homes ~March 15 2025, all PDF" IS findable today IF
"Lenmark Homes" literally appears in the PDF text — nativeSearch reads every PDF live and
keyword-matches. Found whether or not it was sampled. Date match is literal. Keyword-only (no
semantic): a conceptual query ("permits for that new subdivision") finds nothing.

Two REAL gaps exposed:
- GAP 1 (architectural): filestore has NO .search(). The MAIN conversational search
  (recordSearch.searchAll, the agent's [[SEARCH_QUERY]]) calls connector.search() — demo/tyler/axon/
  laserfiche have it, filestore does NOT. So a raw PDF file store is reachable ONLY via the separate
  "Search connected systems directly" button (nativeSearch path), NOT via the chat agent's search.
  A citizen describing the Lenmark permit to the agent may not get it. Inconsistency.
- GAP 2: nativeSearch does not apply taxonomy query expansion/synonyms; on the file path the
  taxonomy under-helps even for routing/expansion.
- SCALE limit: re-running pdftotext over EVERY PDF on EVERY query doesn't scale to the tens of
  thousands of files a real city has.

Taxonomy synonyms/intent value: operate at the ROUTING + QUERY-EXPANSION layer (which source to
prioritize, broaden the query), independent of sampling. NOT document indexing.

HYBRID architecture conclusion (the real answer to "our live search vs Replit's index-everything"):
SOURCE-DEPENDENT, not one-or-the-other.
- Systems with their own good search APIs (Tyler, Laserfiche, Axon, email/O365): LIVE-QUERY — always
  current, no index to maintain. Indexing them ourselves = redundant + staleness.
- Raw FILE STORES / unstructured (PDFs on a drive): build a VECTOR+KEYWORD INDEX (Replit's approach).
  Extract/index each file once with a job catching new/changed files; queries become fast and (if
  embedded) semantically recall-able. Cost: ingestion + reindex pipeline, storage + embedding cost,
  staleness management, decide what to index (records vs config, esp. DB sources). Replit was right
  FOR THIS CASE ("least likely to miss a record").
Net target: index selectively where it earns its keep; live-query the API-capable systems. Not
"index everything", not "never index".

Replit context (Kevin's inquiry): their 2nd build used the vector DB for semantic search (OpenAI
scoring), intended to index ALL documents, but search was incomplete/untested. Stated pro of
index-all: lowest chance of missing a record. (Kevin bringing full doc + screenshot — see Thread 8.)

## Thread 12 — Vocabulary mismatch ("fight" vs "assault") + the Axon "fetch-100-and-rank" reality
Test case (Kevin): "incident report for a fight at a convenience store near Main & Jefferson, late
Dec 2025" — but the report says "assault" / "physically attacked", not "fight". Can we find it?

What the AXON connector actually does (verified, axon.js): search() fetches a BROAD page —
/incidents?pageSize=100 with NO query/keyword passed to the source API — then hands ALL of them to
Claude, which RANKS relevance (match_score >= 50). Matching is Claude reading incidents and judging,
NOT keyword matching. Claude understands fight ~= assault ~= physically attacked. So:
- DEMO (80 incidents, all fit in the 100-page): YES, it finds the assault report for a "fight" query
  — "accidentally semantic" via the AI ranker.
- PRODUCTION scale: BREAKS — a fixed page of 100 with NO query-driven retrieval means that in a
  system with millions of incidents the relevant one almost certainly is not in the slice Claude ever
  sees, so it is missed — NOT for vocabulary reasons, but because nothing used the query to RETRIEVE
  it from the source. Demo works, production silently fails.

Path comparison for vocabulary mismatch:
- Pure KEYWORD (filestore nativeSearch, or passing terms to a source keyword API): MISSES it —
  "assault" is not "fight". Taxonomy synonym-expansion helps PARTIALLY (if the type lists "assault,
  altercation" as synonyms) but cannot enumerate open-ended paraphrases like "physically attacked".
  Keyword is fundamentally word-bound.
- SEMANTIC vector index: solves BOTH — embeddings encode MEANING, so "fight at a store" lands next to
  "physically attacked outside the store" with zero shared words; AND it scales (top-K by meaning over
  millions, fast). The fight/assault case is the canonical argument FOR a semantic layer.

REFINEMENT to the Thread-11 hybrid conclusion: "live-query the API systems" inherits the SOURCE's OWN
search quality. If the source API is keyword-only, live-querying it inherits the vocabulary blindness
— you just moved the weakness to the source. To GUARANTEE semantic recall, either (a) the source
itself offers semantic search, or (b) we index its content into our own vector DB. The real decision
axis is NOT just "does the source have an API?" but "is the source's OWN search good enough (semantic
+ scalable), or do we need to index its content ourselves for recall?" High-stakes, vocabulary-rich,
high-volume sources (incident reports, email) lean toward indexing.

Precision/recall footnote: semantic trades some PRECISION for RECALL (can surface conceptually-near-
but-wrong items) — exactly why the post-search JUDGE exists, and why keyword-first -> semantic-
fallback -> judge (Thread 2) is attractive: keyword for precise hits, semantic to catch vocabulary-
mismatch misses, judge to clean up.

ALSO worth fixing regardless of indexing: the Axon "fetch fixed 100, no query filter" retrieval is a
latent production bug — at minimum it should pass query/date/location filters to the source so
retrieval is query-driven, not an arbitrary slice.
