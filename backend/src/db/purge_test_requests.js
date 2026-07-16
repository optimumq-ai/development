'use strict';
// PURGE THE TEST/DEMO REQUEST CORPUS — one-time, pre-go-live.
//
// Kevin, 2026-07-16: "What exists is garbage mostly created quickly simply to test the build and changes of the
// request portal, long ago. It has caused problems in testing that wasted time and the best solution is to
// delete it." Confirmed same day: "keep the 3, delete the 126."
//
// THREE ROWS ARE NOT REQUESTS AND ARE NEVER TOUCHED. They use a request row as a container:
//   req-library-files    LIBRARY               owner of published public-library document copies
//   req-911-proactive    SYS-911-PROACTIVE     standing proactive-disclosure batch
//   req-template-samples SYS-TEMPLATE-SAMPLES  sample records used to BUILD REDACTION TEMPLATES
// Between them they own ~644 of ~723 request_files — 89% of every file in the system. Five places in the code
// already carve them out (reportEngine BASE_EXCL, the request queue, clarificationTimeout, feeNonpayment,
// renumber_request_numbers, requestCreate), all as `request_number != 'LIBRARY' AND NOT LIKE 'SYS-%'`.
// This script uses the SAME predicate, inverted, and then asserts the protected ids are not in the target set.
//
// WHY EXPLICIT INDIRECT CLEANUP: 18 tables CASCADE from requests, but SIX ledgers reference a request only
// INDIRECTLY and have NO declared FK — deleting the requests would silently strand them:
//   clock_tolls / clock_extensions -> request_clocks.id     task_events -> tasks.id (and a bare request_id)
//   redaction_zones -> redaction_jobs.id / request_files.id  embeddings -> fulfilled_records / document_pages
//
// Usage:  node src/db/purge_test_requests.js            (DRY RUN — prints the plan, changes nothing)
//         node src/db/purge_test_requests.js --apply    (executes, in ONE transaction)
require('dotenv').config();
var db = require('./index');

var PROTECTED = ['req-library-files', 'req-911-proactive', 'req-template-samples'];
var TARGET_WHERE = "request_number != 'LIBRARY' AND request_number NOT LIKE 'SYS-%'";
var APPLY = process.argv.indexOf('--apply') >= 0;

// The six FK-less ledgers, swept by ORPHANHOOD rather than by the target predicate.
//
// Why orphanhood and not scoping: on 2026-07-16 the live DB held 98 clock_tolls and 172 clock_extensions of
// which **every single one was already orphaned** — not one had a matching request_clocks row. They are residue
// from verify_* harnesses that ran against LIVE before the suite got its own database (2026-07-14, `42fe74b`) —
// the same contamination class that left 15 orphan tasks in real worklists. A scoped delete finds none of them,
// because the clocks they pointed at are long gone. Sweeping orphans cleans both that historical residue and
// anything this purge newly strands, in one pass, with one rule.
//
// Run AFTER the requests are deleted, so "orphan" already accounts for the cascade.
// embeddings: ONLY the two request-derived owner types. `record_type` (82) and `user_spec` (1) embeddings do not
// hang off requests and must survive.
var ORPHAN_SWEEP = [
  ['clock_tolls', "DELETE FROM clock_tolls t WHERE NOT EXISTS (SELECT 1 FROM request_clocks c WHERE c.id = t.clock_id)"],
  ['clock_extensions', "DELETE FROM clock_extensions e WHERE NOT EXISTS (SELECT 1 FROM request_clocks c WHERE c.id = e.clock_id)"],
  ['task_events', "DELETE FROM task_events te WHERE te.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = te.task_id)"],
  ['task_events (bare request_id)', "DELETE FROM task_events te WHERE te.request_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.id = te.request_id)"],
  ['redaction_zones (by job)', "DELETE FROM redaction_zones z WHERE z.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM redaction_jobs j WHERE j.id = z.job_id)"],
  ['redaction_zones (by file)', "DELETE FROM redaction_zones z WHERE z.file_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM request_files f WHERE f.id = z.file_id)"],
  ['embeddings (fulfilled_record)', "DELETE FROM embeddings e WHERE e.owner_type='fulfilled_record' AND NOT EXISTS (SELECT 1 FROM fulfilled_records x WHERE x.id = e.owner_id)"],
  ['embeddings (document_page)', "DELETE FROM embeddings e WHERE e.owner_type='document_page' AND NOT EXISTS (SELECT 1 FROM document_pages x WHERE x.id = e.owner_id)"]
];

async function census(label) {
  var rows = await db.all(
    "SELECT 'requests(total)' k, count(*)::int n FROM requests" +
    " UNION ALL SELECT 'requests(protected)', count(*)::int FROM requests WHERE NOT (" + TARGET_WHERE + ")" +
    " UNION ALL SELECT 'requests(target)', count(*)::int FROM requests WHERE " + TARGET_WHERE +
    " UNION ALL SELECT 'request_files', count(*)::int FROM request_files" +
    " UNION ALL SELECT 'tasks', count(*)::int FROM tasks" +
    " UNION ALL SELECT 'request_history', count(*)::int FROM request_history" +
    " UNION ALL SELECT 'request_clocks', count(*)::int FROM request_clocks" +
    " UNION ALL SELECT 'clock_tolls', count(*)::int FROM clock_tolls" +
    " UNION ALL SELECT 'clock_extensions', count(*)::int FROM clock_extensions" +
    " UNION ALL SELECT 'task_events', count(*)::int FROM task_events" +
    " UNION ALL SELECT 'redaction_zones', count(*)::int FROM redaction_zones" +
    " UNION ALL SELECT 'embeddings', count(*)::int FROM embeddings" +
    " UNION ALL SELECT 'request_fee_estimates', count(*)::int FROM request_fee_estimates" +
    " UNION ALL SELECT 'request_payment_events', count(*)::int FROM request_payment_events");
  console.log('\n--- census: ' + label);
  rows.forEach(function (r) { console.log('    ' + String(r.n).padStart(6) + '  ' + r.k); });
  return rows.reduce(function (m, r) { m[r.k] = r.n; return m; }, {});
}

(async function () {
  await db.initDb();
  console.log(APPLY ? '*** APPLY MODE — this will DELETE ***' : '=== DRY RUN (no changes) — pass --apply to execute ===');

  // GUARD 1: the protected rows must exist and must NOT be in the target set.
  var prot = await db.all("SELECT id, request_number FROM requests WHERE id = ANY($1::text[])", [PROTECTED]);
  if (prot.length !== PROTECTED.length) {
    throw new Error('Refusing: expected ' + PROTECTED.length + ' protected rows, found ' + prot.length +
      '. The infrastructure rows (library / proactive batch / redaction template samples) are not what this ' +
      'script was written against. Investigate before purging.');
  }
  var leak = await db.all("SELECT id FROM requests WHERE " + TARGET_WHERE + " AND id = ANY($1::text[])", [PROTECTED]);
  if (leak.length) throw new Error('Refusing: the target predicate matches a PROTECTED row: ' + leak.map(function (r) { return r.id; }).join(', '));
  console.log('\nprotected (never touched): ' + prot.map(function (r) { return r.request_number; }).join(', '));

  // GUARD 2: nothing in the target set may have taken money. The DB trigger would refuse anyway
  // (trg_block_delete_of_paid_request, Kevin's rule 2026-07-14) — this fails EARLY with a clearer message.
  var paid = await db.get(
    "SELECT count(*)::int n FROM requests r WHERE " + TARGET_WHERE.replace(/request_number/g, 'r.request_number') + " AND (" +
    " EXISTS (SELECT 1 FROM fee_payments WHERE request_id = r.id)" +
    " OR EXISTS (SELECT 1 FROM fee_adjustments WHERE request_id = r.id)" +
    " OR EXISTS (SELECT 1 FROM erp_charges WHERE request_id = r.id AND (paid_at IS NOT NULL OR COALESCE(paid_amount,0) > 0))" +
    " OR EXISTS (SELECT 1 FROM request_fee_estimates WHERE request_id = r.id AND (deposit_paid_at IS NOT NULL OR final_paid_at IS NOT NULL)))");
  if (paid.n > 0) {
    throw new Error('Refusing: ' + paid.n + ' request(s) in the target set have PAYMENT HISTORY. A request that ' +
      'took money cannot be deleted (Kevin, 2026-07-14) — close or withdraw it instead, then re-run.');
  }
  console.log('payment guard: 0 target requests ever took money — safe to delete.');

  var before = await census('BEFORE');
  console.log('\nplan: delete ' + before['requests(target)'] + ' requests, keep ' + before['requests(protected)'] + '.');

  // Orphans that ALREADY exist, before we touch anything — historical harness residue.
  var pre = await db.get("SELECT (SELECT count(*) FROM clock_tolls t WHERE NOT EXISTS (SELECT 1 FROM request_clocks c WHERE c.id=t.clock_id))" +
    " + (SELECT count(*) FROM clock_extensions e WHERE NOT EXISTS (SELECT 1 FROM request_clocks c WHERE c.id=e.clock_id)) AS n");
  console.log('\npre-existing ORPHANED toll/extension rows (harness residue, pre-dating this purge): ' + pre.n);

  if (!APPLY) {
    console.log('\n(dry run cannot preview the orphan sweep precisely — it runs AFTER the cascade, so most of its');
    console.log(' targets do not exist yet. It deletes ONLY rows whose parent is already gone.)');
    console.log('\nDRY RUN — nothing changed. Re-run with --apply.');
    process.exit(0);
  }

  await db.run('BEGIN');
  try {
    await db.run('DELETE FROM requests WHERE ' + TARGET_WHERE); // cascades the 18 declared FK tables
    console.log('  deleted  requests (cascading 18 declared-FK tables)');
    for (var j = 0; j < ORPHAN_SWEEP.length; j++) {
      await db.run(ORPHAN_SWEEP[j][1]);
      console.log('  swept    ' + ORPHAN_SWEEP[j][0]);
    }
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }

  var after = await census('AFTER');

  // GUARD 3: prove the outcome rather than assert it.
  var fail = 0;
  function check(l, c) { console.log((c ? '  OK   ' : '  FAIL ') + l); if (!c) fail++; }
  console.log('');
  check('0 target requests remain', after['requests(target)'] === 0);
  check('all ' + PROTECTED.length + ' protected rows survive', after['requests(protected)'] === PROTECTED.length);
  var orph = await db.get(
    "SELECT (SELECT count(*) FROM clock_tolls t WHERE NOT EXISTS (SELECT 1 FROM request_clocks c WHERE c.id=t.clock_id))" +
    " + (SELECT count(*) FROM clock_extensions e WHERE NOT EXISTS (SELECT 1 FROM request_clocks c WHERE c.id=e.clock_id))" +
    " + (SELECT count(*) FROM task_events te WHERE te.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.id=te.task_id))" +
    " + (SELECT count(*) FROM redaction_zones z WHERE z.file_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM request_files f WHERE f.id=z.file_id))" +
    " AS n");
  check('0 orphaned indirect ledger rows (tolls/extensions/task_events/zones)', Number(orph.n) === 0);
  var libFiles = await db.get("SELECT count(*)::int n FROM request_files WHERE request_id = 'req-library-files'");
  check('the public library still owns its files (' + libFiles.n + ')', libFiles.n > 0);
  var proFiles = await db.get("SELECT count(*)::int n FROM request_files WHERE request_id = 'req-911-proactive'");
  check('the 911 proactive-disclosure batch still owns its files (' + proFiles.n + ')', proFiles.n > 0);
  // NOT a file check: SYS-TEMPLATE-SAMPLES is an EMPTY holding area and always has been (0 files on
  // 2026-07-16, before and after). An earlier draft of this script asserted it owned files and failed on a
  // correct purge. What must survive is the ROW — plus the template substrate, which does not hang off it.
  var tmplRow = await db.get("SELECT count(*)::int n FROM requests WHERE id = 'req-template-samples'");
  check('the template-samples holding row survives (files: 0 — it is empty by design)', tmplRow.n === 1);
  var tmpl = await db.get("SELECT (SELECT count(*) FROM redaction_rules) + (SELECT count(*) FROM layout_profiles)" +
    " + (SELECT count(*) FROM redaction_categories) + (SELECT count(*) FROM mass_redaction_jobs) AS n");
  check('the redaction template substrate is intact (rules+profiles+categories+jobs = ' + tmpl.n + ')', Number(tmpl.n) > 0);

  console.log(fail ? '\nPURGE COMPLETED WITH ' + fail + ' FAILED CHECK(S)' : '\nPURGE CLEAN.');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('\nPURGE ABORTED: ' + ((e && e.message) || e)); process.exit(1); });
