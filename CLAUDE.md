# OptimumQ — Open Records Management System

On-premise open-records platform for cities. Node/Express backend (`backend/`, PM2 app `optimumq-api`, port 3001), built frontend served by nginx, PostgreSQL + pgvector in Docker (`optimumq-postgres`, host port 5544). Runs as the `optimumq` service user.

## Specs are the contract
- Before building in any domain, READ the relevant spec in `docs/SPEC_*.md` (index: `docs/DOMAIN_MAP.md`).
- A design change updates the spec in the SAME commit as the code.
- Architecture decisions live in `docs/ARCHITECTURE.md` — conform to it. **All 7 items RATIFIED 2026-07-16**, including item 1 (wrap-in-parent).
- **Parent/child is BUILT (2026-07-16).** `docs/SPEC_parent_child_lifecycle.md` is the single binding spec (`SPEC_tasks_roles_mrr_fees.md` §12 is a pointer stub). Every request is now a PARENT (citizen, number, money, statutory clock) with 1..n CHILDREN (description, stage, routing, and every FK that hangs off work); a single-record request is n = 1, not a special case. `BUILD_PRIORITY` item 11 is done: wrap (§8), the portal emitting n children, and the queue (§7). **Still open:** the MRR hub (§14.3, design-gated), suggest-vs-commit routing (§14.2 — children currently auto-commit), the parent/child field-design pass (§4.4), and MRR classification roll-up (§6).
- **Read parent facts THROUGH the parent, never off a child.** `request_number`, `is_mrr`, requestor, money and the statutory clock are PARENT-level; `requestCreate` forces `is_mrr = 0` on every child, and a child's `request_number` carries a component suffix the citizen has never seen. Use `services/requestScope.js` — `andParent`/`andLeaf` to scope, `numberJoin`/`numberExpr` to resolve the citizen's number. These predicates were tautologies before children existed, so a query that looks correct against old data can still be wrong now.
- Build order comes from `docs/BUILD_PRIORITY_SUMMARY.md`.

## Process rules (non-negotiable)
- ONE bounded slice per session. No "while I'm in here" scope creep.
- "Done" = verified in the running app AND committed, with evidence (query result, test output, or screenshot). Never a chat assertion.
- Commit at every green moment. End each session with a short handoff note (append to `docs/HANDOFF.md`).
- Seed/demo data ONLY through real creation paths (e.g. POST /api/public/submit) — never direct inserts into mid-pipeline states.
- Smoke test on demand: submit → route → estimate → search → deliver. If it breaks, say so the same day.

## Tests (never against live)
- Run the suite with `cd backend && npm test` — that is the ONLY supported way. It rebuilds `optimumq_test`
  as a clone of live, boots a test API on :3101 against it, runs all 12 harnesses, and then **censuses the live
  DB before and after and fails if a single row moved**.
- NEVER run a `verify_*.js` harness bare. `tests/testEnv.js` will refuse and exit — tests must not touch live
  data. (They used to. It cost us 15 orphan tasks in real worklists and a 77-day statutory clock in production
  config.)
- New tests go in `backend/tests/` and require `testEnv.enforce()` before touching the DB.

## UI rule
- NEVER use the v1 UI (existing pages, layouts, styling, component structure) as a design reference — it is considered poor and is being replaced.
- Backend patterns, routes, services, and data access MAY be reused freely.
- For any new screen: agree on design direction BEFORE building.

## Architecture invariants (v2)
- One request-creation helper — never add a new insert site.
- One central stage-transition function — every stage advance writes request_history AND spawns/updates the stage task. No direct `UPDATE requests SET stage` anywhere else.
- Tasks have a NULLABLE request link. Passive/heads-up items are Notifications, never fake tasks or pseudo-requests.
- One task-routing role catalog.

## Environment
- Restart API: `pm2 restart optimumq-api` · logs: `pm2 logs optimumq-api --nostream`
- DB shell: `docker exec optimumq-postgres psql -U optimumq -d optimumq`
- Never echo, log, or query secret values (keys, password hashes, DATABASE_URL credentials).
- Do not touch the three connector stub processes (tyler/laserfiche/axon).
