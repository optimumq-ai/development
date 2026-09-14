# Setup interdependencies — departments, fulfillment teams, record types, sources

*Written 2026-09-14 for Kevin's 2026-09-13 markup (Record Sources): "before deleting the two demo sources, a document
showing the interdependencies of city departments, fulfillment teams, taxonomy (record types) and sources", plus the
starter-data decision. Every statement below is read from the schema, the routes and the live database on 2026-09-14.*

## 1. The four objects and what links them

| Object | Table | What it is | Links it carries |
|---|---|---|---|
| City department | `departments` (`kind = 'department'`) | An org-chart department that OWNS records | `processed_by` → the fulfillment team that works its requests by default; flags `is_open_records`, `is_catch_all` |
| Fulfillment team | `departments` (`kind = 'team'`) | A pool of staff that works tasks | none outward; departments point AT it; staff belong to it (`users.department_id`); tasks sit in its pool (`tasks.team_id`) |
| Record type | `record_types` (+ `categories`) | What the city holds; a variant is a record type naming a parent | `record_type_departments` (role **owner** = the department, role **fulfiller** = an optional team override); `record_type_repositories` (which sources hold it); `parent_record_type_id` |
| Source | `record_repositories` | A connected system or drive | none outward. **Nothing points from a source to a department**; a department reaches a source only through a record type. |

The links, as a picture:

```
department ──processed_by──▶ team
     ▲                        ▲
   owner                   fulfiller (override, rare — 1 live)
     │                        │
 record type ─────────────────┘
     │
  found in (record_type_repositories)
     ▼
   source
```

A **request** ties them together at run time: the classifier picks a record type → its owner department
(`requests.record_owner_department_id`) → that department's team, unless the type carries a fulfiller override
(`requests.department_id` = the team) → the search runs over the type's sources (a variant with none of its own uses its
parent's, since 2026-09-14). Nothing about a request refers to a source directly; released records and fulfilled records
refer to the record type and the department.

## 2. Direction of dependence — what must exist before what

Setup order (each row needs the one above it to be meaningful):

1. **Fulfillment teams** — departments point at them (`processed_by`). A department with no team routes nowhere.
2. **City departments** — record types name them as owner. One is the catch-all; one team is the Open Records hub.
3. **Sources** — independent of everything above (a source knows nothing about departments), but record types point at them.
4. **Record types** — the join point. A type without an owner cannot route; a type without a source searches nothing.
5. **Variants** — need a parent type; inherit its routing, estimate profile, time budgets, legal gate and (now) sources.

Deletion order is the reverse, and what each deletion strands if done bare:

| Deleting a… | Strands | Guarded today? |
|---|---|---|
| Fulfillment team | departments' `processed_by`, open tasks in its pool, open requests routed to it, staff, team-scoped user types | **Yes** — `orgRemoval.checkTeam` names each blocker; retire instead of delete when history exists |
| City department | record types naming it as owner/fulfiller, open requests it owns, staff who call it home, the catch-all / hub flags | **Yes** — `orgRemoval.checkDepartment` |
| Record type | `record_type_departments` + `record_type_repositories` (cascaded), variants (refused), and — **not checked** — `requests.record_type_id` (4 live), `fulfilled_records.record_type_id` (1,555 live), `document_fingerprints.matched_record_type_id` (160), `record_type_estimate_profiles`, `layout_profiles`, `workflow_decisions`, `mass_redaction_jobs`, `time_budgets` | **Partly** — `DELETE /taxonomy/record-types/:id` refuses only when variants exist; there is no Delete in the UI |
| Source | `record_type_repositories` rows (left dangling → the type's search lists a source that no longer exists), `document_fingerprints`, `paper_index_items`, `request_files.repository_id`, `import_ingest_log` | **No** — `DELETE /repositories/:id` is a bare row delete; the Record Sources screen offers it behind a confirm |

## 3. Live census, 2026-09-14

| | Count | Notes |
|---|---|---|
| City departments | 12 | Catch-all: City Clerk. Every department has a `processed_by` team. |
| Fulfillment teams | 10 | Open Records hub team: Open Records Fulfillment Team. **Anomaly:** "Open Records Office" (`dept-openrecords`) is stored as `kind = 'team'` with a routing specialization reading "TEST: mounted unit and K9 records" — test residue worth clearing. |
| Record types | 92 | 76 seeded · 7 discovered and active · 8 discovered drafts (all variants of Building permits) · 1 manual. 15 categories. |
| Owner links | 75 | 11 departments own records (Police 11, Clerk 11, Building & Planning 11, Finance 10, HR 5, PIO 5, Public Works 5, Attorney 5, IT 4, Fire 4, Parks 3). **10 active buckets have NO owner** and so cannot route: 911 Call Records · Animal impound & intake · Direct deposit authorizations · Employee pay stubs · Employee tax forms (W-2) · Employee timesheets · Forensic device images · Mobile device contents · Payroll registers · Vendor invoices. |
| Fulfiller overrides | 1 | Historical Property & Land Records → City Clerk Records & Archives. |
| Sources | 21 → **19** (Demo Document Library and Development Services Drive deleted 2026-09-14 on Kevin's decision; the six other demo sources kept for now) | 11 shipped by the fixture (10 after the deletion) (demo/sample systems and the three connector stubs) + 10 filestore drives added on this box (the nine department drives migrated 2026-09-04 and two leftovers). **53 of 84 buckets have no source at all**; Laserfiche ECM alone is linked to 21 types. |

### The two sources Kevin wants deleted

| Source | Linked record types | Fingerprints | Other references | Verdict |
|---|---|---|---|---|
| Demo Document Library (`repo-demo`, connector `demo`) | 0 | 0 | none | Safe to delete — zero footprint |
| Development Services Drive (`repo-80tdz1ho`, filestore, inactive) | 0 | 0 | none | Safe to delete — zero footprint (its successor "Development Services Shared Drive" carries the 4 types and 160 fingerprints) |

Other fixture sources with the same zero footprint, candidates for the same decision: 911 Call Management System (demo) ·
City Email System (demo) · City Payroll System (sample) · Tyler Munis (Financial/ERP) · Engineering Shared Drive · Planning
Shared Drive. "Test Import Drop" holds 13 `request_files` and 3 ingest-log rows — not zero. "Sample Network Drive (PDFs)" is
linked to 8 types with 8 fingerprints — not zero.

## 4. What ships as starter data today

`src/db/seed_fixture.sql` (regenerated from live by `gen_fixture_seed.js`; the ONLY install path — `SEEDS.md`) ships:

| Layer | Rows in the fixture | Ships? |
|---|---|---|
| Departments + teams | 49 (`dept-*`/`team-*`) | Yes |
| Categories + record types | 94 types | **Yes** — the generic municipal taxonomy, drafts included |
| Owner / fulfiller links | 75 | Yes — routing arrives pre-wired to the seeded departments |
| Sources | 11 | Yes — the demo systems and connector stubs above |
| Source links | 46 | Yes |
| Document fingerprints, requests, files | none | No (transactional) |

So the answer to Kevin's question is **yes, record types ship as starter data**, and so do 11 sources — including the two he
wants gone. Deleting them on live and regenerating the fixture removes them from every future install; deleting them on
live alone does not.

## 5. Recommendations

1. **Delete the two sources now** — both have zero footprint; the bare delete is harmless for them. Then regenerate the
   fixture so a new city does not receive them. Decide the six other zero-footprint demo sources in the same act.
2. **Keep record types as starter data.** A city starting from 94 generic types with owners pre-wired prunes faster than
   one building 94 from nothing, and the classifier is only as good as the catalog it reads. The 10 owner-less buckets
   should get owners before shipping (payroll/HR ones → Human Resources or Finance; 911 → Police or Fire; forensic/mobile →
   Police; Animal impound → Police or Community Programs — Kevin's call per department).
3. **Add record-type deletion the way departments got it (2026-09-08): a guided process, not a button.** Reuse the
   `orgRemoval` shape — `check()` names blockers (variants, open requests on the type, an active estimate profile or
   layout profile, stamped fingerprints, a pending mass-redaction job) with the screen that clears each, and the outcome
   is decided by footprint: **delete** when nothing points at it, **retire** (`status = 'retired'`, hidden from the
   classifier catalog and every picker, name kept) when fulfilled records or closed requests still reference it. Surface
   it as "Delete…" in the record-type editor and on the taxonomy row. One slice.
4. **Give source deletion the same guard** — check `record_type_repositories`, `document_fingerprints`,
   `paper_index_items`, `request_files`, `import_ingest_log`; delete when clean, otherwise refuse with the list (a source
   that fed released records should be retired, not erased). Same slice as 3 or the next.
5. **Clear the test residue:** the "Open Records Office" row stored as a team with a TEST routing specialization.

## 6. Decisions for Kevin

- ~~Delete the two sources now~~ **DECIDED 2026-09-14: deleted; the other six stay for now.**
- Record types stay as starter data (recommended) — and who owns each of the 10 owner-less buckets.
- Build guided record-type deletion (and the matching source guard) as the next slice — yes / later.
- The "Open Records Office" team row: delete it, or is it real?
