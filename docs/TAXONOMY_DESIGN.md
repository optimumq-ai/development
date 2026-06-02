# Optimum Q Taxonomy Feature — Design Document

**Status:** Approved for implementation
**Path:** Phased v1 (defer AI-assisted proposal to v2)
**Sessions estimated:** 6-10 sessions of focused work

---

## Purpose

The taxonomy is the knowledge layer that tells Optimum Q **what records exist, where they live, what citizens call them, and how to handle them.** It replaces today's implicit, code-embedded routing logic with explicit, editable, auditable data.

Three benefits:
1. Citizens get more accurate results because the system understands what they're really asking for
2. Staff can correct AI confusion without code changes (e.g., the body-cam-returns-documents bug becomes structurally impossible)
3. Customer onboarding becomes a matter of curating a template rather than building from scratch

---

## Core architecture

Two related concepts as separate database entities:

### Repositories — places where records live

A Repository entry describes a system, file storage, or physical location where records are kept. One entry per system.

Examples:
- Tyler Munis Production
- Axon Evidence
- City Microsoft 365 (email)
- Document Library
- Basement Archives — Building A (paper records)

Fields:
- id, name, description
- type: cloud_system | on_premises_system | file_storage | physical_location
- connection_url, credentials (encrypted), status, last_query_at
- primary_department, is_authoritative, retention_default
- responsible_staff
- physical_location, retrieval_lead_time_days (for physical repositories)
- created_at, created_by, modified_at, modified_by

### Record Types — kinds of records citizens request

A Record Type entry describes a category of record that citizens might ask for.

Examples:
- Body-worn camera footage
- Vendor invoices
- Building permits
- City council meeting minutes

Fields:
- id, name, description
- category (one of 13 template categories)
- synonyms: JSON array of phrases citizens use
- format: video | pdf | structured_record | email | mixed | physical_only
- disambiguators: text clarifying what this is NOT
- repositories: JSON array of {repository_id, filter_spec} entries
- public_availability: releasable | restricted | confidential
- redaction_profile: JSON array of redaction categories
- legal_references: statute citations
- department_owner
- search_boost_keywords, search_exclude_keywords
- created_at, created_by, modified_at, modified_by

---

## Search routing — Two-stage design

**Stage 1 — Taxonomy match (fast):**
1. Match query against record type names, descriptions, synonyms
2. Assign confidence scores to matched record types
3. If confidence >= 80%: only query repositories linked to top-matching record types, using their filter specs
4. If confidence is low: fall through to stage 2

**Stage 2 — Broad fallback (current behavior):**
1. Query all active repositories in parallel
2. Each connector ranks independently
3. Merge and return top results

This gives precision when the citizen knows what they want, while preserving exploration ability.

---

## Permissions

- **SYSTEM_ADMIN**: full control over repositories and record types
- **DIRECTOR, SUPERVISOR**: edit record type entries; cannot add/remove repositories
- **DEPT_MANAGER**: view all; edit record types in their own department
- **Other staff**: view-only

All edits logged in audit trail with who/what/when/before/after.

---

## Template — ships out of the box

A new install seeds ~55 record types across 13 categories, Texas-default legal references.

**Categories:**

1. Police / Public Safety (8 entries)
2. Fire / EMS (4 entries)
3. Financial / Procurement (6 entries)
4. Human Resources (4 entries)
5. Permits, Licenses, Inspections (5 entries)
6. Council / Governance (5 entries)
7. Planning / Zoning / Land Use (3 entries)
8. Public Works / Infrastructure (3 entries)
9. Legal (3 entries)
10. Communications / Public Statements (3 entries)
11. Email Records (5-7 entries) — NEW category
12. Public Information / Data (3 entries)
13. Out-of-Scope / Refer Elsewhere (3 entries)

Each template entry ships with realistic defaults for required fields, pre-populated synonyms, Texas Government Code Chapter 552 references where applicable, and reasonable redaction profile defaults.

---

## Connector additions for v1

- **Microsoft 365 / Email Stub** — mock email system. Fake mailboxes, fake emails, realistic metadata. Real M365/Google connector deferred to v2.

---

## UI

**Taxonomy** as a top-level navigation item in the staff sidebar, positioned between Departments and Configuration.

**Two sub-tabs:**

1. **Repositories** — list, add, edit, delete. Shows connection status, last query time, linked record types. Form varies by repository type.

2. **Record Types** — grid grouped by category. Filter and search. Editor with all fields.

**Each entry has:**
- Edit history button → audit trail view
- Test button → simulates a citizen query to preview matching behavior

---

## v2 work explicitly deferred

- AI-assisted schema discovery from connected systems
- AI-assisted synonym suggestions from observed conversations
- Cross-customer template improvements
- Real M365 / Google Workspace connector
- Self-describing repositories
- Staff proposal workflow with approval queue

---

## Migration from current state

The existing `record_repositories` table evolves rather than gets replaced:
- Add new fields for the richer schema
- Create new `record_types` table
- Run migration creating initial taxonomy entries from existing connector code
- Rewire `recordSearch.js` for two-stage routing, preserving fallback

The Agent Rules feature remains valuable for **style and judgment**. Taxonomy handles **facts**. Both layers coexist.

---

## Build sequence

**Session 1 — Foundation:** Database schema, backend API, Repositories tab UI, migration of existing repositories.

**Session 2 — Record Types:** UI for record types, search dispatcher rewire with two-stage routing.

**Session 3 — Template seeding:** Author 55 template entries, seed script, test against demo data.

**Session 4 — Email stub:** Email mock system, wire as repository, add email record types.

**Session 5 — Audit and polish:** Audit trail UI, test-entry button, edge cases, documentation.

---

## Open questions for later

- Hierarchical relationships between record types?
- Exportable/importable taxonomy for customer sharing?
- How to handle records spanning multiple departments?
