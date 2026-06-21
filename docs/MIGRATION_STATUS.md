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
- CUTOVER: DONE 2026-06-03 — index.js swapped to Postgres; PM2 optimumq-api restarted on PG; verified no SQLite handle, connected :5544, serving real data; backend/.env given PG conn; pm2 saved. App LIVE on Postgres.

## Safety / rollback
- Original DB + config backed up in /opt/optimumq/backups/.
- SQLite untouched at backend/data/optimumq.db; old schema at backend/src/db/schema.sql.
- Rollback = restore index.js (from index.sqlite.bak.js or git) and run on SQLite.

## Conversion rule
- db calls all/get/run are now async: add `await`, make enclosing fn `async`. Convert any `forEach` containing db calls to `for...of`.

- POST-CUTOVER FIX: services/email.js was missed in the async sweep (cfg() read DB synchronously -> got a Promise -> all config empty -> "no provider configured"). Converted to async; verified Resend send works (admin@optimumq.ai got id). Gmail delivery still pending Resend optimumq.ai domain verification (test mode).

- SECURITY ROTATIONS COMPLETE (2026-06-04): (1) GitHub PAT rotated — new token in remote, verified auth, old revoked in GitHub. (2) Gmail app password (smtp_pass) revoked in Google + cleared from system_config; email runs on Resend, SMTP was a dormant fallback. (3) Anthropic API key rotated — new key in backend/.env, app restarted + AI chat verified working, old key deleted in Console. REMAINING housekeeping (non-urgent): neutralize dormant Docker image/compose app-service (also scrub dead old-Anthropic-key copy in root .env); consolidate root .env vs backend/.env; clean up SQLite leftovers once confident on Postgres.

- DOCKER FOOTGUN NEUTRALIZED (2026-06-04): docker-compose.yml rewritten to postgres-only (removed dormant optimumq app service); stale optimumq:latest image (872MB) removed; dead old-anthropic-key cleared from root .env. App still runs via PM2 (unchanged); postgres container intact (restart=unless-stopped, healthy). REMAINING housekeeping: consolidate root .env vs backend/.env; SQLite cleanup once confident on Postgres.

## pgvector ENABLED (2026-06-21) -- the gap is now closed
- The June 3-4 migration moved SQLite -> Postgres (foundation), but the Postgres image was stock postgres:16-alpine, which does NOT include the pgvector extension. So vector search could not run natively until now.
- Swapped container image postgres:16-alpine -> pgvector/pgvector:pg16 via fresh-volume dump/restore (avoids musl->glibc data-dir collation issues). Old volume optimumq_optimumq-pgdata retained as rollback; new volume optimumq_optimumq-pgdata-v2.
- Backup taken pre-swap: backups/pre_pgvector_20260621_031512.sql (38 tables). Restored clean: 0 errors, row counts verified (requests=35, record_types=82, embeddings=82, document_pages=22, users=18).
- CREATE EXTENSION vector (v0.8.3). embeddings table now has a real `embedding vector(1024)` column + HNSW cosine index (embeddings_embedding_hnsw, vector_cosine_ops). All 82 record-type embeddings populated.
- semanticSearch.js now uses native pgvector cosine ( <=> ) instead of app-side cosine. schema.postgres.sql + indexRecordTypes.js updated for consistency on fresh boots / re-indexing.
- ROLLBACK if ever needed: revert docker-compose.yml (image->postgres:16-alpine, volume->optimumq-pgdata via the .bak), `docker compose up -d` (old volume intact); or restore the .sql dump.
