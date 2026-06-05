# Optimum Q - Competitive & Practice Landscape
Research scan 2026-06-05 (Claude + web). For positioning before sales.

## A. How agencies handle email requests (grounds the scope-assistance feature)
- Universal rule: a request must "reasonably describe" the records (specific enough to locate with reasonable effort).
- DOJ FOIA guidance: vague descriptions AND unduly burdensome searches are both "not reasonably described" -> can be closed as such. So a topic-only email request with no custodian/date is the textbook overbroad case.
- Standard remedy = narrow, not deny. For emails: provide start/end date + key words (e.g. Montana OPIR).
- TEXAS (controlling case: City of Dallas v. Abbott, 304 S.W.3d 380): TPIA 552.222 lets the body ask the requester to CLARIFY (unclear) or NARROW (unduly broad). The 10-business-day clock to seek an AG ruling RESETS from the clarified/narrowed request. No written response -> request withdrawn after the 61st day. Also a clarify-for-redaction-consent move (552.222) to avoid a ~45-day AG-ruling wait.
- Implication: our agent's scope-assistance maps to a REAL statutory step (clarification) and even resets the agency's clock -> concrete value story, not just UX. Per-state rules live in the Jurisdiction Profile.
- Our EDGE: statutes assume the REQUESTER supplies custodians+dates; nobody's standard move is to DERIVE them from the agency's own governance records.

## B. Competitor tiers
1. Records-platform incumbents (Granicus/GovQA, NextRequest, JustFOIA, GovOS, Tyler): WORKFLOW tools - intake portal, tracking, routing, redaction, audit, reporting. Granicus AI = mostly redaction (esp. video) + clerk-task automation (Operations Cloud, Jan 2025). NOT doing semantic search-and-match. We win here.
2. eDiscovery (Everlaw, Reveal, Logikcull, Relativity): ALREADY do "find responsive records" - clustering, custodian ID, semantic search, RAG w/ citations, automated PII redaction. Everlaw markets a FOIA product. BUT litigation-grade, matter-based, expensive, internal-staff; load-a-dataset-and-search. Not citizen-facing, not taxonomy-driven, not routing across live systems. Capability exists; could move down-market.
3. AI intake layer - BetaQuick "Morgan" (CLOSEST on intake): AI voice agent; structured intake against the city's record categories with a taxonomy matched to the records RETENTION SCHEDULE; scope-clarification example nearly verbatim ours ("emails about the stadium" -> which officials, date range, keywords); enforces the intake-vs-human-review boundary (validates our auto-release principle). BUT it's a front-door concierge that FILES tickets into the incumbents and STOPS at intake - no search/find/disambiguate; ASKS the requester for scope (doesn't derive). Sold on a TEXAS DIR coop contract -> procurable in our backyard.
4. AI-native FOIA startups (e.g. Madison AI): pitching our full thesis at 2026 ICMA - "AI assistant that fetches records/emails, evaluates like a human, first-pass redaction." Closest to our vision; clearest sign the space is heating up.

## Straight read
- "Nobody automates this much" = half right (incumbents don't) / half outdated (intake AI + eDiscovery search + AI-native FOIA each chip at pieces; 2025-26 is the convergence moment). AI is also FLOODING agencies (requesters use ChatGPT/Claude -> 3-page rambles), worsening the intake/scoping problem we solve.
- Validation: serious independent players landed on our exact patterns (taxonomy from retention schedule, scope-clarification, intake-vs-human boundary) -> instincts are sound.
- DEFENSIBLE GROUND: the UNIFIED platform - citizen intake + intelligent standing taxonomy (intent/expected-content/identifying-facets) + semantic search across live systems + which-kind/which-one disambiguation + routing + redaction-assist + FRI. Scope-DERIVATION (council vote -> email custodians/dates) is ours alone in this set.
- STRATEGIC: space moving fast; "only we do this" erodes each quarter. Open question worth revisiting: a sharp differentiated wedge in front of agencies SOONER vs a complete v1 LATER.

## Sources (key)
- DOJ OIP procedural guidance (reasonably described vs burdensome search).
- Montana OPIR; Berkeley PRA guide; NH RTK; CA PRA FAQ (reasonably describe; email date range).
- TML "TPIA Made Easy" 2025; TX OAG to-do list; UH System TPIA; Abernathy Roeder (552.222 clarify/narrow + redaction-consent); City of Dallas v. Abbott.
- Granicus/GovQA product pages; Granicus 2025 Semiannual (Operations Cloud); Granicus video-redaction blog.
- BetaQuick "AI Intake for FOIA & Public Records" (Morgan), betaquick.com, May 2026.
- Everlaw FOIA page; Reveal "Ask"; Logikcull; vidizmo legal-document-processing.
- Route Fifty (Madison AI, Apr 2026); Federal News Network (AI personas mapped to disposition schedules, May 2026).
