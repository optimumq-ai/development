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
