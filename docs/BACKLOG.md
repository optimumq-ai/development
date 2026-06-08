# Backlog / Ideas to Consider

Running list of enhancement ideas captured during build sessions. Not yet scheduled.

## Discovery -> Redaction integration (captured 2025-06-08)

Enhance AI Discovery so record-type discovery and redaction setup go hand in hand:

- When discovery runs, create a **snapshot of the record types** found (point-in-time record of what was discovered/proposed).
- During the **review** step (approve/reject of discovered drafts), add two options per record type:
  1. **Generate a redaction template** for that record type, derived from its structure, expected content, and sensitivity (public_availability / auto_release_eligible). The type already encodes which exemptions are plausible, so a starter template can be proposed automatically.
  2. **Generate a mass auto-redaction process + scheduling** for records of that type - a recurring/bulk redaction job.

Rationale: once a record type is approved, we know its structure and sensitivity - exactly what is needed to draft a redaction template and configure scheduled bulk redaction. These pair naturally with the approval step rather than being separate later work.

Related: docs/FEATURE_context_aware_redaction.md.

## Native Source Search / Portal Fallback Search (captured 2025-06-08, from Replit prototype design)

When the public-portal AI search returns no results - OR the user reviews AI results and finds no match - a "Search Connected Systems" button appears. It opens an in-portal search panel that queries each connected source system DIRECTLY via that system's own (keyword-level) search mechanism, NOT Optimum Q's AI semantic index. Results display inside the portal (no leaving the app), grouped by source, each with record title, date, and a brief description where available.

Behavior:
- Covers all active connected sources (e.g. Building Permits, Police Reports, Council Minutes).
- Record found -> user can view/download directly. Still no results -> prompt to submit a formal records request.
- Rationale: the semantic index can miss records that are not semantically similar to the query, are awaiting re-indexing, or use terminology the user recognizes on sight but did not phrase the same way. A direct keyword-level fallback catches those gaps before the user gives up or files an unnecessary formal request.
- Production: each source exposes a search API (Tyler, Accela, police RMS) called through its registered connector. Prototype: queries the file-based local repositories.

Reconciliation with current build:
- This is the "native per-connector keyword search" mode, distinct from the (future) pgvector AI semantic index. Three search modes total: AI semantic index (future, blocked on pgvector+Voyage), native per-connector keyword search (this feature), and the current portal chat path.
- recordSearch.searchAll() already fans a query across active connectors and is wired into the public portal chat (publicChat.js) - the natural host for the button.
- To build: portal "Search Connected Systems" button + results-grouped-by-source panel + empty-state CTA to submit a formal request; expose connector search explicitly as a keyword fallback (separate from the AI-ranked path); real per-source search() in each connector for production systems.
