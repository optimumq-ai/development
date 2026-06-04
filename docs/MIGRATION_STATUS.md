# Postgres Migration - Live Status (resume-from-here note)

Branch: postgres-migration (off main). Commit progress frequently.

## Done
- Postgres 16 running as docker service `optimumq-postgres`, host port 5544 -> 5432.
- DB creds in .env: POSTGRES_USER/DB/PASSWORD, DATABASE_URL. App uses host `postgres:5432` on compose network; host scripts use localhost:5544.
- Ported schema backend/src/db/schema.postgres.sql (16 tables, 8 indexes) applied to Postgres.
- Data copied via backend/migrate_to_pg.js. Verified: all 16 tables match + content spot-checked.
- New async translator backend/src/db/index.pg.js, isolation-tested OK (?->$n, date/datetime('now'), INSERT OR IGNORE->ON CONFLICT, int8->number). NOT yet swapped into index.js.
- Converted to async/await (still run on SQLite via await pass-through until swap): departments, services/recordSearch, services/connectors/demo, classify, extract, config, routes/agentRules, routes/auth, services/auth, routes/staff, routes/files, routes/requests, routes/publicChat, server.js.

## Remaining
- Convert: DONE — all route/service files + server.js converted; express-async-errors added for async error handling.
- Add express-async-errors + `await initDb()` in server.js.
- CUTOVER: cp src/db/index.js src/db/index.sqlite.bak.js ; cp src/db/index.pg.js src/db/index.js. Then run app on Postgres, test: health, login, list/create requests, config.

## Safety / rollback
- Original DB + config backed up in /opt/optimumq/backups/.
- SQLite untouched at backend/data/optimumq.db; old schema at backend/src/db/schema.sql.
- Rollback = restore index.js (from index.sqlite.bak.js or git) and run on SQLite.

## Conversion rule
- db calls all/get/run are now async: add `await`, make enclosing fn `async`. Convert any `forEach` containing db calls to `for...of`.
