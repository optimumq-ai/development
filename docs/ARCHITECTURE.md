# Optimum Q — Architecture Contract (v2 foundational decisions)
**Status: DRAFT — pending Kevin's ratification.** Drafted 2026-07-08 from the verified domain specs and the root-cause analysis of the v1 structural failures. Every build (human or AI) conforms to this document. Item 1 is the only open judgment call; items 2–7 are direct fixes for diagnosed v1 bugs.

## 1. Every request is wrapped in a parent (ADOPTED — amended 2026-07-13; see `SPEC_parent_child_lifecycle.md`)
Every request — even single-record — is a **parent with one or more children**. Uniform handling eliminates single-vs-multi special-casing: filters, worklists and reports run over **child** rows, so "everything in redaction" lists single-record and multi-record children in one shape.

**Amendment (2026-07-13):** the original clause "a child IS a full request row" is **wrong and is retired**. Parent and child carry **different fields**, because the law assigns different things to the request and to the record: exemptions, denials, redactions, record-holds and appeals are **record**-level; the statutory clock, the deadline, fees and everything that pauses the clock are **request**-level. Most consequentially, a record-hold (AG ruling, litigation, active investigation) **must never stop the parent clock or block a sibling** — Tex. ORD-664 holds the 10-day AG window "is not a grace period," so undisputed records must still go out. The field-by-field split, roll-up rules, and migration are specified in **`SPEC_parent_child_lifecycle.md`**, which also reconciles this item with `SPEC_tasks_roles_mrr_fees.md` §12.

## 2. Tasks are first-class, with a NULLABLE request link
`tasks.request_id` is nullable. A task may attach to a request, a source, an import batch, or nothing. **Rationale:** v1's NOT NULL constraint forced the SYS-IMPORT pseudo-request hack — a fake request manufactured to hang import tasks on, producing the incomprehensible task-open experience.

## 3. Notifications are their own model, request-independent
A Notification = description + hyperlink + recipient; no completion UI, no request dependency. Passive/monitor items and heads-ups are Notifications, never faked as tasks or requests. Shown in their own My Tasks area.

## 4. One role catalog
A single task-routing role set (System Function Roles), with Department Display Roles as a naming layer on top. **Never two overlapping catalogs.** Rationale: v1's function_roles + permission_roles split caused routing confusion and the "too many roles" pushback. Includes the Finance consolidation (fee waiver + objection + future commercial approvals under one role).

## 5. One request-creation helper
Every path that creates a request (portal chat, staff form, connectors, imports, API) calls ONE shared helper. Wrap-in-master (item 1), numbering, deadlines, defaults live there once. Rationale: v1 had 5 independent INSERT sites, which is how conventions drift.

## 6. One central stage-transition function
Every stage advance goes through ONE function that ALWAYS (a) writes request_history and (b) spawns/updates the stage's task. No direct `UPDATE requests SET stage` anywhere else. Rationale: v1 scattered transitions across 5+ files, producing an unlogged advance that stranded a request at a stage with no task — never root-caused, only mitigated by a reconciler. Keep the reconciler as a belt-and-suspenders safety net.

## 7. Process rules (non-negotiable)
- **"Done" = verified in the running app AND committed**, with evidence (query result, test, screenshot). Never chat assertion.
- **Seed/demo data only through real creation paths** — never direct INSERTs into mid-pipeline states (v1's seeded rows masked real bugs).
- **A core-loop smoke test** (submit → route → estimate → search → deliver) runs on demand; a break announces itself same-day.
- **One bounded slice per session; commit at every green moment; short handoff note ends each session.**
- **Specs are the contract**: read the relevant SPEC_*.md before building in a domain; a design change updates the spec in the same commit as the code.
