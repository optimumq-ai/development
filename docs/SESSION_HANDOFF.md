# Session Handoff Note

**Last updated:** 2026-06-02 (end of long planning session)

## Where the project stands

Optimum Q is functional and demo-ready as baseline. Tonight committed to **big bang v1 build** — full taxonomy + AI-assisted discovery + document indexing + vector search + FRI + Postgres migration, BEFORE sales motion. ~80-120 hours, ~15 sessions over 2-3 weeks.

## Decisions locked

- Postgres migration: do it now (Session 2)
- Embeddings: Voyage AI
- Taxonomy architecture: Choice C (Repositories + Record Types separate, linked)
- Search routing: Design 3 (two-stage — taxonomy-first, broad fallback)
- Template seeding: ~55 record types across 13 categories
- One codebase, no state-specific forks. Jurisdiction Profile data per state
- Email connector: stub for v1, real M365/Google in v2
- AI-assisted schema discovery + approval queue: INCLUDED in v1

## Decisions still open

- **Fulfilled Request Index in v1:** leaning yes (Kevin reviewing Replit doc before confirming)
- **Build sequence:** proposed sequence below pending Kevin's review

## Proposed build sequence

1. **Session 1** — Lock decisions, update design doc, create taxonomy-v1 branch, master acceptance test plan
2. **Sessions 2-3** — Postgres migration
3. **Sessions 4-7** — Foundation taxonomy + document indexing pipeline
4. **Sessions 8-10** — AI-assisted discovery + approval queue
5. **Sessions 11-13** — Search integration + FRI + email stub
6. **Sessions 14-15** — Polish + acceptance testing + demo prep

## Replit prototype documents in hand

Kevin shared three documents from his Replit prototype:
- OCR + text extraction pipeline
- Vector indexing + semantic search architecture
- Redaction workflow (request-driven + proactive batch)

Still pending from Replit: RCS Engine description, chat agent / search intake description.

## Lessons from prototype work

- AI zone discovery for redaction was unreliable in testing; manual drag-and-drop is the practical default. Design Optimum Q with manual primary, AI as experimental assist.
- Browser-side redaction processing in Replit was unintended. For Optimum Q, server-side is preferred.
- Layout Profiles (where zones sit) are separate from Exemption Reference Library (legal basis). Both deserve first-class status.

## To start the next session

1. Read this handoff doc (SESSION_HANDOFF.md)
2. Read TAXONOMY_DESIGN.md for full architecture
3. Check in with Kevin to lock Decisions 3 and 4
4. Then start Session 2 (Postgres migration)

## Tools available in next session

- SSH MCP server: optimumq-ssh:exec for commands on droplet
- Claude in Chrome: browser interaction if needed
- 1000-char command length limit on SSH MCP — write longer scripts via multiple echo appends or temp files
