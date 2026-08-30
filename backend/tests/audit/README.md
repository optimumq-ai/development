# Static and crawl audits (2026-08-30)

Read-only tools that found the 2026-08-30 audit's defects. None touches the database; none runs under the suite.

- `node tests/audit/links.js` — every in-app navigation target (nav/Link/Navigate/hub door/editor) resolves to a real route through redirects.
- `node tests/audit/deadcode.js` — orphan frontend files, backend routes with no frontend caller and no test, frontend calls with no route, services nothing requires, `system_config` keys read-but-never-written / written-but-never-read. HEURISTIC: only `api.get/post(...)` with a literal or simple-concatenation first argument is seen — local wrapper functions, ternaries in paths and `axios` calls are missed (the 2026-08-30 triage lists the false positives).
- `node tests/audit/coverage.js` — backend routes and frontend routes no harness references.
- `node tests/audit/crawl.js <out.json>` then `node tests/audit/crawlsum.js <out.json>` — Playwright walks every non-parameter route as one active user per user type against the nginx-served build. NAVIGATION ONLY: every non-GET `/api` request is blocked and logged, so it is provably non-writing (a blocked write on page load is itself a finding). Needs the `playwright` package resolvable and the Chromium binary in `~/.cache/ms-playwright/`. ~45 minutes per user type.

Findings and their triage live in `docs/AUDIT_2026-08-31.md`.
