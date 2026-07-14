'use strict';
// THE GUARD. Require this FIRST from every harness, before src/db is touched.
//
// A test database only helps if the tests actually point at it. The failure mode we are defending against is
// not exotic — it is someone running `node verify_stages.js` directly out of habit, picking up `.env`, and
// quietly rewriting production. That is exactly how a 77-day statutory clock ended up in live config, and how
// 15 orphan tasks ended up OPEN in real worklists.
//
// So: this module refuses to let a harness run against anything that is not a *_test database. It does not
// warn. It exits. A test that CAN touch production eventually WILL.
require('dotenv').config({ path: '/opt/optimumq/backend/.env' });
const fs = require('fs');

// LIVE_URL is read from the .env FILE, never from process.env. The runner exports DATABASE_URL=<test> into the
// child environment, and dotenv does not override an already-set variable — so trusting process.env here would
// make the reset script clone the test database from ITSELF and quietly produce an empty fixture.
const ENV_FILE = '/opt/optimumq/backend/.env';
const LIVE_URL = (fs.readFileSync(ENV_FILE, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m) || [])[1];
if (!LIVE_URL) { console.error('FATAL: no DATABASE_URL in ' + ENV_FILE); process.exit(1); }

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'optimumq_test';
const TEST_URL = LIVE_URL.replace(/\/[^/?]+(\?|$)/, '/' + TEST_DB_NAME + '$1');

// The API the harnesses talk to over HTTP must ALSO be the test instance. Pointing the harness's DB at the
// test database while it drives the LIVE API on :3001 would be the worst of both worlds: assertions read one
// database while the writes land in another. The port is the tell.
const LIVE_PORT = Number(process.env.PORT || 3001);
const API_PORT = Number(process.env.API_PORT || 3101);

function redact(u) { return String(u).replace(/:[^:@/]*@/, ':***@'); }

function enforce() {
  const target = process.env.DATABASE_URL;
  const dbName = (String(target).match(/\/([^/?]+)(\?|$)/) || [])[1];

  if (!/_test$/.test(String(dbName))) {
    console.error('');
    console.error('  ✗ REFUSING TO RUN — this harness is pointed at a NON-TEST database.');
    console.error('    DATABASE_URL -> ' + redact(target) + '  (database: ' + dbName + ')');
    console.error('');
    console.error('    Tests must never touch live data. Run the suite through its runner:');
    console.error('        node tests/run_suite.js');
    console.error('    or set the environment explicitly:');
    console.error('        DATABASE_URL=' + redact(TEST_URL) + ' API_PORT=' + API_PORT + ' node tests/<harness>.js');
    console.error('');
    process.exit(1);
  }

  if (API_PORT === LIVE_PORT) {
    console.error('  ✗ REFUSING TO RUN — API_PORT (' + API_PORT + ') is the LIVE API port.');
    console.error('    The harness would drive the live API (writing to the live DB) while asserting against the test DB.');
    process.exit(1);
  }
  return { dbName, API_PORT };
}

module.exports = { LIVE_URL, TEST_URL, TEST_DB_NAME, API_PORT, LIVE_PORT, enforce, redact };
