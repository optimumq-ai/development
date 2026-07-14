'use strict';
// RESET THE TEST DATABASE — build `optimumq_test` from the SCHEMA + the DETERMINISTIC FIXTURE, then let the
// suite wreck it freely.
//
//   node tests/reset_test_db.js
//
// WHY A TEST DB AT ALL: every contamination bug of 2026-07-14 (15 orphan tasks OPEN in real worklists, 36
// dangling rows, a 77-day statutory clock left in PRODUCTION config by a test) had ONE cause: the verify_*
// harnesses created, mutated, and deleted rows in the LIVE database.
//
// WHY A FIXTURE AND NOT A CLONE: this used to clone live at run time. That isolated the tests, but it left them
// asserting against whatever happened to be in production that morning — a config edit in live would silently
// change what the suite was testing, and there was nothing to review or diff. The fixture
// (src/db/seed_fixture.sql) is a fixed, version-controlled file: same input every run.
//
// It builds from EMPTY, exactly as a new city install does. That is not incidental — it is the only thing that
// keeps schema.postgres.sql honest. The first time we ever did this it turned up two release blockers (the
// schema could not create a fresh DB, and it had drifted from live by a table and 20 columns).
//
// THE LIVE DATABASE IS NEVER OPENED BY THIS SCRIPT.
require('dotenv').config({ path: '/opt/optimumq/backend/.env' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const env = require('./testEnv');

const SCHEMA = path.join(__dirname, '..', 'src', 'db', 'schema.postgres.sql');
const FIXTURE = path.join(__dirname, '..', 'src', 'db', 'seed_fixture.sql');

function adminUrl(url) { return url.replace(/\/[^/?]+(\?|$)/, '/postgres$1'); }

(async () => {
  if (!/_test(\?|$)/.test(env.TEST_URL)) {
    throw new Error('REFUSING: target is not a *_test database: ' + env.redact(env.TEST_URL));
  }
  if (!fs.existsSync(FIXTURE)) {
    throw new Error('missing fixture: ' + FIXTURE + ' — regenerate with: node src/db/gen_fixture_seed.js');
  }

  // 1. Recreate the database.
  const admin = new Pool({ connectionString: adminUrl(env.TEST_URL) });
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [env.TEST_DB_NAME]
  );
  await admin.query('DROP DATABASE IF EXISTS ' + env.TEST_DB_NAME);
  await admin.query('CREATE DATABASE ' + env.TEST_DB_NAME);
  await admin.end();
  console.log('recreated database:', env.TEST_DB_NAME);

  const test = new Pool({ connectionString: env.TEST_URL });

  // 2. The real schema — the SAME file the app boots from, so the test DB gets the FKs and the
  //    payment-history delete guard. A test DB without the production constraints is a liar.
  await test.query(fs.readFileSync(SCHEMA, 'utf8'));
  console.log('applied schema.postgres.sql (from EMPTY — FKs + payment guard included)');

  // 3. The schema seeds a few tables itself (decision_reasons and friends); the fixture carries those rows
  //    too, so clear the decks and let the fixture be the single source of truth.
  const { rows: allTables } = await test.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  if (allTables.length) {
    await test.query('TRUNCATE TABLE ' + allTables.map((t) => '"' + t.tablename + '"').join(', ') + ' RESTART IDENTITY CASCADE');
  }

  // 4. The fixture. Loaded with FKs ARMED — if the reference graph is broken, this fails here and loudly.
  await test.query(fs.readFileSync(FIXTURE, 'utf8'));
  console.log('applied seed_fixture.sql');

  // 5. Prove the fixture is USABLE. A silently-thin fixture is worse than none: the suite would go green
  //    against data that isn't there. These are the things the harnesses actually require.
  const need = {
    users: 1,            // harnesses sign a token from an active user
    departments: 1,      // routing needs an org chart
    record_types: 1,     // classification needs a taxonomy
    jurisdiction_rules: 1, // the clock/fee engines read the active jurisdiction's rules
    categories: 1,
    system_config: 1,
  };
  let bad = 0;
  for (const [t, min] of Object.entries(need)) {
    const c = (await test.query('SELECT count(*)::int AS c FROM "' + t + '"')).rows[0].c;
    const ok = c >= min;
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK   ' : 'THIN ') + t.padEnd(20) + c);
  }
  const active = (await test.query("SELECT count(*)::int AS c FROM users WHERE status='active' AND display_name IS NOT NULL")).rows[0].c;
  if (!active) { bad++; console.log('  THIN  no active user — harnesses cannot sign a token'); }

  // And prove it is CLEAN: a fixture must carry no transactional history.
  for (const t of ['requests', 'tasks', 'request_history']) {
    const c = (await test.query('SELECT count(*)::int AS c FROM "' + t + '"')).rows[0].c;
    console.log('  ' + (c === 0 ? 'OK   ' : 'DIRTY') + t.padEnd(20) + c + (c === 0 ? ' (fixture carries no transactions)' : ' ← fixture is polluted'));
    if (c !== 0) bad++;
  }

  await test.end();
  if (bad) throw new Error('fixture is not usable — ' + bad + ' check(s) failed');
  console.log('TEST DB READY:', env.TEST_DB_NAME, '(deterministic fixture, no live data)');
})().catch((e) => { console.error('reset_test_db FAILED:', e.message); process.exit(1); });
