'use strict';
// RESET THE TEST DATABASE — rebuild `optimumq_test` as a clone of live, then let the suite wreck it freely.
//
// WHY THIS EXISTS: every contamination bug of 2026-07-14 (15 orphan tasks OPEN in real worklists, 36 dangling
// rows, a 77-day clock left in PRODUCTION config by a test) had ONE cause: the verify_* harnesses created,
// mutated, and deleted rows in the LIVE database. FKs and the payment guard made that SAFE. They did not make
// it RIGHT. Tests get their own database.
//
// It clones LIVE rather than seeding from the seed_* files on purpose: there is no seed runner, the seeds were
// applied ad hoc over months, and the live config has since drifted (29 jurisdiction rules, per-record-type
// routing). A hand-built fixture would silently NOT be the thing the suite has been asserting against, and the
// first symptom would be assertions that pass for the wrong reason.
//
// LIVE IS OPENED READ-ONLY HERE. Nothing in this file writes to it.
'use strict';
require('dotenv').config({ path: '/opt/optimumq/backend/.env' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const LIVE_URL = process.env.LIVE_DATABASE_URL || require('./testEnv').LIVE_URL;
const TEST_URL = require('./testEnv').TEST_URL;
const TEST_DB = require('./testEnv').TEST_DB_NAME;
const SCHEMA = path.join(__dirname, '..', 'src', 'db', 'schema.postgres.sql');

// Order matters only for readability; the copy defers FK checks, so a parent may land after its child.
function adminUrl(url) { return url.replace(/\/[^/?]+(\?|$)/, '/postgres$1'); }

(async () => {
  if (!/_test(\?|$)/.test(TEST_URL)) {
    throw new Error('REFUSING: target database is not a *_test database: ' + TEST_URL.replace(/:[^:@]*@/, ':***@'));
  }

  // 1. (Re)create the test database.
  const admin = new Pool({ connectionString: adminUrl(TEST_URL) });
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [TEST_DB]
  );
  await admin.query('DROP DATABASE IF EXISTS ' + TEST_DB);
  await admin.query('CREATE DATABASE ' + TEST_DB);
  await admin.end();
  console.log('recreated database:', TEST_DB);

  // 2. Apply the real schema — the SAME file the app boots from, so the test DB gets the FKs and the
  //    payment-history delete guard too. A test DB that lacks the production constraints is a liar.
  const test = new Pool({ connectionString: TEST_URL });
  await test.query(fs.readFileSync(SCHEMA, 'utf8'));
  console.log('applied schema.postgres.sql (FKs + payment guard included)');

  // The schema SEEDS some tables itself (decision_reasons, and friends). Those rows would collide with the
  // ones we are about to copy from live, so clear the decks first. Live is the single source of truth for the
  // fixture — we do not want a half-seeded, half-cloned hybrid that matches neither.
  const { rows: allTables } = await test.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public'"
  );
  if (allTables.length) {
    await test.query(
      'TRUNCATE TABLE ' + allTables.map((t) => '"' + t.tablename + '"').join(', ') + ' RESTART IDENTITY CASCADE'
    );
  }

  // 3. Copy the data from live, table by table.
  const live = new Pool({ connectionString: LIVE_URL });
  const { rows: tables } = await live.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  );

  const client = await test.connect();
  let totalRows = 0;
  const skipped = [];
  try {
    // Defer FK enforcement for the load: the copy is a snapshot of an already-consistent database, and
    // insisting on parent-before-child ordering across 40+ tables would be a maintenance trap.
    await client.query("SET session_replication_role = 'replica'");
    await client.query('BEGIN');

    for (const { tablename } of tables) {
      const { rows } = await live.query('SELECT * FROM "' + tablename + '"');
      if (!rows.length) { skipped.push(tablename); continue; }

      const cols = Object.keys(rows[0]);
      const quoted = cols.map((c) => '"' + c + '"').join(', ');
      // Batch the inserts; these tables are small (hundreds of rows), so one round trip per table is plenty.
      const values = [];
      const params = [];
      let n = 0;
      for (const row of rows) {
        values.push('(' + cols.map(() => '$' + ++n).join(', ') + ')');
        for (const c of cols) params.push(row[c]);
      }
      await client.query(
        'INSERT INTO "' + tablename + '" (' + quoted + ') VALUES ' + values.join(', '),
        params
      );
      totalRows += rows.length;
    }

    await client.query('COMMIT');
    await client.query("SET session_replication_role = 'origin'");
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // 4. Prove the clone is faithful — a silently-partial copy is worse than no test DB at all, because the
  //    suite would go green against data that isn't there.
  const CHECK = ['requests', 'tasks', 'request_history', 'jurisdiction_rules', 'record_types', 'departments'];
  console.log('copied', totalRows, 'rows across', tables.length - skipped.length, 'tables (' + skipped.length + ' empty)');
  let drift = 0;
  for (const t of CHECK) {
    const a = (await live.query('SELECT count(*) AS c FROM "' + t + '"')).rows[0].c;
    const b = (await test.query('SELECT count(*) AS c FROM "' + t + '"')).rows[0].c;
    const ok = String(a) === String(b);
    if (!ok) drift++;
    console.log('  ', ok ? 'OK ' : 'DRIFT', t.padEnd(20), 'live=' + a, 'test=' + b);
  }

  await live.end();
  await test.end();
  if (drift) throw new Error('clone is NOT faithful — ' + drift + ' table(s) differ');
  console.log('TEST DB READY:', TEST_DB);
})().catch((e) => { console.error('reset_test_db FAILED:', e.message); process.exit(1); });
