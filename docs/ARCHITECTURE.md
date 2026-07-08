# Optimum Q — Architecture Contract (v2 foundational decisions)
**Status: DRAFT — pending Kevin's ratification.** Drafted 2026-07-08 from the verified domain specs and the root-cause analysis of the v1 structural failures. Every build (human or AI) conforms to this document. Item 1 is the only open judgment call; items 2–7 are direct fixes for diagnosed v1 bugs.

## 1. Every request is wrapped in a parent (ADOPTED — Kevin may veto)
Every request — even single-item — is a **master with one or more child records**. A child IS a full request row; all by-id processing works on children unchanged. Uniform handling eliminates single-vs-multi special-casing and is required by the MRR design (D4 §11). Measured v1 adoption cost was bounded (5 creation sites + migration); in v2 it costs nothing extra if built this way from day one.

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
