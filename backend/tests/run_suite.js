'use strict';
// THE SUITE RUNNER. This is the ONLY supported way to run the verify_* harnesses.
//
//   node tests/run_suite.js            # reset the test DB, boot a test API, run all 12 harnesses
//   node tests/run_suite.js --keep     # leave the test DB and API up afterwards for poking at
//   node tests/run_suite.js verify_stages verify_extend      # run only some
//
// It does four things, and the last one is the point:
//   1. Rebuilds `optimumq_test` as a faithful clone of live.
//   2. Boots a SECOND API instance on :3101 wired to the test DB. Without this the harnesses would drive the
//      LIVE API on :3001 — writing to production while asserting against the test database.
//   3. Runs the harnesses with DATABASE_URL/API_PORT pointed at the test stack.
//   4. TAKES A CENSUS OF THE LIVE DATABASE BEFORE AND AFTER, and fails the run if a single row moved.
//      That last check is the whole slice. Everything else is plumbing that could rot silently; this is the
//      assertion that would have caught all of 2026-07-14's contamination the day it started.
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { Pool } = require('pg');
const env = require('./testEnv');

const BACKEND = path.join(__dirname, '..');
const ALL = [
  'verify_stage_bypass', 'verify_stages', 'verify_request_create', 'verify_config_integrity',
  'verify_deposit_clock', 'verify_scope', 'verify_extend', 'verify_reissue',
  'verify_survey_seed', 'verify_fee_waiver', 'verify_jurrules', 'verify_deadline_rules',
  'verify_search_intents', 'verify_request_defect', 'verify_search_resolve',
  'verify_search_intent_gate', 'verify_fee_labor_gate', 'verify_estimate_profiles',
  'verify_role_reconciliation', 'verify_notifications', 'verify_returned_rework', 'verify_task_lifecycle',
  'verify_task_timing', 'verify_request_timeline', 'verify_time_budget', 'verify_work_timer',
  'verify_timecapture_config', 'verify_estimate_reconcile', 'verify_concurrent_tolls', 'verify_wrap_parent', 'verify_mrr_children',
  'verify_queue_parent_child', 'verify_legal_review', 'verify_fresh_install', 'verify_component_charged', 'verify_release_coverage',
];

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const picked = args.filter((a) => !a.startsWith('--'));
const HARNESSES = picked.length ? picked : ALL;

// The live census: every table that the suite has ever been caught mutating, plus the config tables.
const CENSUS = [
  'requests', 'tasks', 'request_history', 'request_clocks', 'request_payment_events', 'request_fee_estimates',
  'workflow_decisions', 'fee_payments', 'jurisdiction_rules', 'record_types', 'departments', 'users',
];

async function census(url) {
  const pool = new Pool({ connectionString: url });
  const out = {};
  for (const t of CENSUS) {
    try {
      const r = await pool.query('SELECT count(*)::int AS c FROM "' + t + '"');
      out[t] = r.rows[0].c;
    } catch (e) { out[t] = 'ERR'; }
  }
  // updated_by fingerprints on config are how a test leaves a mark WITHOUT changing any row count.
  try {
    const r = await pool.query("SELECT count(*)::int AS c FROM jurisdiction_rules WHERE updated_by IS NOT NULL");
    out['_config_stamps'] = r.rows[0].c;
  } catch (e) { /* table may not exist */ }
  await pool.end();
  return out;
}

function run(cmd, argv, extraEnv) {
  return spawnSync(cmd, argv, {
    cwd: BACKEND,
    env: Object.assign({}, process.env, extraEnv || {}),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

(async () => {
  // ---- 1. Census live BEFORE ------------------------------------------------------------------
  const before = await census(env.LIVE_URL);

  // ---- 2. Rebuild the test DB ----------------------------------------------------------------
  console.log('── resetting test database ──');
  const reset = run('node', [path.join(__dirname, 'reset_test_db.js')]);
  process.stdout.write(reset.stdout || '');
  if (reset.status !== 0) { console.error(reset.stderr); process.exit(1); }

  // ---- 3. Boot the test API ------------------------------------------------------------------
  console.log('\n── booting test API on :' + env.API_PORT + ' (test DB) ──');
  const api = spawn('node', [path.join(BACKEND, 'server.js')], {
    cwd: BACKEND,
    env: Object.assign({}, process.env, {
      DATABASE_URL: env.TEST_URL,
      PORT: String(env.API_PORT),
      NODE_ENV: 'test',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let apiLog = '';
  api.stdout.on('data', (d) => { apiLog += d; });
  api.stderr.on('data', (d) => { apiLog += d; });

  const ready = await (async () => {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch('http://localhost:' + env.API_PORT + '/api/health');
        if (res.ok) return true;
      } catch (e) { /* not up yet */ }
    }
    return false;
  })();
  if (!ready) {
    console.error('test API failed to start:\n' + apiLog.slice(-1500));
    api.kill('SIGTERM');
    process.exit(1);
  }
  console.log('test API healthy on :' + env.API_PORT);

  // ---- 4. Run the harnesses against the test stack --------------------------------------------
  const testEnvVars = { DATABASE_URL: env.TEST_URL, API_PORT: String(env.API_PORT), NODE_ENV: 'test' };
  let pass = 0, fail = 0, broken = 0;
  console.log('\n── suite ──');
  for (const h of HARNESSES) {
    const r = run('node', [path.join(__dirname, h + '.js')], testEnvVars);
    const out = (r.stdout || '') + (r.stderr || '');
    const m = out.match(/(\d+)\/(\d+) pass, (\d+) fail/);
    if (!m) {
      broken++;
      console.log('  ⚠️  ' + h.padEnd(24) + 'NO SUMMARY — harness did not complete');
      console.log(out.trim().split('\n').slice(-4).map((l) => '        ' + l).join('\n'));
      continue;
    }
    pass += Number(m[1]); fail += Number(m[3]);
    console.log('  ' + (Number(m[3]) === 0 ? '✅' : '❌') + '  ' + h.padEnd(24) + m[0]);
    // Print WHICH assertions failed. Without this the runner tells you a harness is red but not why, and the
    // only way to find out is to re-run it by hand against a --keep'd DB that the run has already dirtied —
    // where the failure often does not reproduce. The suite should say what broke.
    if (Number(m[3]) > 0) {
      // `ERR`/`CLEANUP ERR` too: a harness that throws increments `fail` WITHOUT printing a `FAIL` line, so
      // matching only /FAIL/ reported "1 fail" and then listed nothing — which is the exact blindness this
      // block was added to remove.
      out.split('\n').filter((l) => /^\s*(FAIL\s|ERR\s|CLEANUP ERR)/.test(l)).forEach((l) => console.log('        ' + l.trim()));
    }
  }

  // ---- 5. Census live AFTER — the assertion this whole slice exists for -------------------------
  const after = await census(env.LIVE_URL);
  const moved = Object.keys(before).filter((k) => String(before[k]) !== String(after[k]));

  if (!keep) api.kill('SIGTERM');

  console.log('\n── live database census ──');
  if (moved.length === 0) {
    console.log('  ✅ LIVE UNTOUCHED — not one row moved in ' + CENSUS.length + ' tables.');
  } else {
    console.log('  ❌ LIVE WAS MODIFIED BY THE TEST RUN:');
    for (const k of moved) console.log('      ' + k + ': ' + before[k] + ' -> ' + after[k]);
  }

  console.log('\n── result ──');
  console.log('  ' + pass + ' passed, ' + fail + ' failed' + (broken ? ', ' + broken + ' harness(es) did not complete' : ''));
  if (keep) console.log('  (--keep: test DB and API on :' + env.API_PORT + ' left running)');

  const ok = fail === 0 && broken === 0 && moved.length === 0;
  console.log('  ' + (ok ? 'SUITE GREEN, LIVE CLEAN' : 'SUITE NOT GREEN'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('run_suite FAILED:', e); process.exit(1); });
