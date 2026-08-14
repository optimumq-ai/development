'use strict';
// MASS-JOBS ROLE GATE + PROCESSING AUDIT TRAIL — two defects the 2026-08-14 product-split code scan
// surfaced, fixed regardless of any split:
//   1. Every /api/mass-jobs MUTATION was requireAuth only — any logged-in staffer could point a
//      template at an archive and burn redactions, or cancel someone's batch. Now gated:
//      REDACTION_WORKER/REDACTION_AUTHORITY perm, or DIRECTOR/SUPERVISOR/SYSTEM_ADMIN function role.
//      Reads stay requireAuth (consistent with the rest of the processing side).
//   2. Request-less processing work left NO audit trail (request_history.request_id is NOT NULL).
//      Now: processing_history — insert-only, actor + action + shape-facts-only details — written on
//      job create/pause/resume/cancel/run-now and on every worker chunk (forcing user or
//      'Scheduled Batch'), readable at GET /mass-jobs/:id/history.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var { v4: uuidv4 } = require('/opt/optimumq/backend/node_modules/uuid');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'PA' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function call(token, method, path2, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path2, {
    method: method,
    headers: Object.assign(token ? { Authorization: 'Bearer ' + token } : {}, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function mkUser(id, name) {
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')",
    [id, id + '@test.optimumq.ai', name, 'Test ' + TAG]);
  return db.get('SELECT * FROM users WHERE id = ?', [id]);
}
async function history(jobId) {
  return db.all("SELECT * FROM processing_history WHERE entity_type = 'mass_job' AND entity_id = ? ORDER BY seq ASC", [jobId]);
}

(async function () {
  await db.initDb();
  var worker = require('/opt/optimumq/backend/src/services/massJobs');

  // Users: one with NO roles at all, one holding only the REDACTION_WORKER permission role, plus the
  // seeded sysadmin. Fixture template: minimal layout profile (the create path only reads id/kind/record_type_id).
  var uNone = await mkUser('u-pa-none-' + TAG, 'PA NoRoles');
  var uRed = await mkUser('u-pa-red-' + TAG, 'PA RedactionWorker');
  await db.run("INSERT INTO user_permission_roles (user_id, permission_role_id) VALUES (?, 'pr-redworker')", [uRed.id]);
  var tNone = await auth.signAccessToken(uNone);
  var tRed = await auth.signAccessToken(uRed);
  var tAdmin = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var tplId = 'tpl-' + TAG;
  await db.run("INSERT INTO layout_profiles (id, name, kind, zones, field_map) VALUES (?,?, 'pages', '[]', '[]')", [tplId, 'PA Template ' + TAG]);

  console.log('\n=== A. THE GATE — mutations need redaction authority; reads do not ===');
  var mk = { name: 'PA job ' + TAG, template_id: tplId, file_ids: ['pa-nonexistent-1', 'pa-nonexistent-2'] };
  var r = await call(tNone, 'POST', '/mass-jobs', mk);
  ok('A1 a no-role staffer CANNOT create a mass job (403)', r.status === 403);
  var jobAdmin = (await call(tAdmin, 'POST', '/mass-jobs', mk)).body;
  ok('A2 SYSTEM_ADMIN can create (gate passes admins)', !!(jobAdmin && jobAdmin.id));
  var jobRed = (await call(tRed, 'POST', '/mass-jobs', Object.assign({}, mk, { name: 'PA red job ' + TAG }))).body;
  ok('A3 a REDACTION_WORKER perm holder can create', !!(jobRed && jobRed.id));
  r = await call(tNone, 'POST', '/mass-jobs/' + jobAdmin.id + '/cancel');
  ok('A4 a no-role staffer CANNOT cancel someone\'s job (403)', r.status === 403);
  r = await call(tNone, 'POST', '/mass-jobs/' + jobAdmin.id + '/run-now');
  ok('A5 ... nor force a run (403)', r.status === 403);
  r = await call(tNone, 'POST', '/mass-jobs/911/generate', { count: 1 });
  ok('A6 ... nor trigger the 911 connector (403)', r.status === 403);
  r = await call(tNone, 'GET', '/mass-jobs');
  ok('A7 reads stay open to any authenticated staffer (job list 200)', r.status === 200);
  r = await call(null, 'POST', '/mass-jobs', mk);
  ok('A8 no token at all is still 401', r.status === 401);

  console.log('\n=== B. THE TRAIL — every act on a request-less job is recorded with its actor ===');
  var h = await history(jobRed.id);
  ok('B1 creation wrote a trail row naming the creator', h.length === 1 && h[0].action === 'created' && h[0].actor_name === 'PA RedactionWorker' && h[0].actor_id === uRed.id);
  var d1 = JSON.parse(h[0].details || '{}');
  ok('B2 created details carry the shape facts (name, template, size)', d1.template_id === tplId && d1.total_items === 2);
  await call(tRed, 'POST', '/mass-jobs/' + jobRed.id + '/pause');
  await call(tAdmin, 'POST', '/mass-jobs/' + jobRed.id + '/resume');
  h = await history(jobRed.id);
  ok('B3 pause then resume each wrote a row, each with ITS actor', h.length === 3 &&
    h[1].action === 'paused' && h[1].actor_name === 'PA RedactionWorker' &&
    h[2].action === 'resumed' && h[2].actor_name === 'Kerri Russ');
  ok('B4 status rows record the transition', JSON.parse(h[1].details).from === 'queued' && JSON.parse(h[1].details).to === 'paused');

  // Force a run as the admin: the chunk grinds both (nonexistent) files as errors and completes.
  var rn = await call(tAdmin, 'POST', '/mass-jobs/' + jobRed.id + '/run-now');
  ok('B5 run-now succeeded and completed the 2-item job', rn.status === 200 && rn.body.job && rn.body.job.status === 'completed');
  h = await history(jobRed.id);
  var runRow = h.find(function (x) { return x.action === 'run_now'; });
  var chunkRow = h.find(function (x) { return x.action === 'chunk_processed'; });
  ok('B6 the forced run wrote run_now + chunk_processed rows', !!runRow && !!chunkRow);
  ok('B7 the chunk names the FORCING USER as its actor', chunkRow && chunkRow.actor_name === 'Kerri Russ');
  var dc = chunkRow ? JSON.parse(chunkRow.details || '{}') : {};
  ok('B8 chunk details are counts only (processed/errors/forced/completed)', dc.processed === 2 && dc.errors === 2 && dc.forced === true && dc.completed === true);

  // The unattended path: tick with no actor supplied records 'Scheduled Batch'.
  await call(tAdmin, 'POST', '/mass-jobs/' + jobAdmin.id + '/pause');
  await call(tAdmin, 'POST', '/mass-jobs/' + jobAdmin.id + '/resume');
  await worker.tick({ force: true, jobId: jobAdmin.id });
  var h2 = await history(jobAdmin.id);
  var chunk2 = h2.find(function (x) { return x.action === 'chunk_processed'; });
  ok('B9 an unattended worker chunk is attributed to Scheduled Batch', !!chunk2 && chunk2.actor_name === 'Scheduled Batch' && chunk2.actor_id == null);

  var cancelJob = (await call(tAdmin, 'POST', '/mass-jobs', Object.assign({}, mk, { name: 'PA cancel ' + TAG }))).body;
  await call(tAdmin, 'POST', '/mass-jobs/' + cancelJob.id + '/cancel');
  var h3 = await history(cancelJob.id);
  ok('B10 cancel wrote its row', h3.some(function (x) { return x.action === 'canceled' && x.actor_name === 'Kerri Russ'; }));

  console.log('\n=== C. READ-BACK + NO PII ===');
  var hr = await call(tNone, 'GET', '/mass-jobs/' + jobRed.id + '/history');
  ok('C1 GET /:id/history returns the trail, details parsed to objects', hr.status === 200 && Array.isArray(hr.body) && hr.body.length === h.length && typeof hr.body[0].details === 'object');
  var allRows = h.concat(h2, h3);
  var pii = allRows.filter(function (x) {
    var s = (x.details || '') + '';
    return /\d{3}-\d{2}-\d{4}|@(?!test\.optimumq)/.test(s) || s.indexOf('caller_name') !== -1;
  });
  ok('C2 no trail row carries document content or PII-shaped values', pii.length === 0);

  console.log('\n=== D. CLEANUP ===');
  var jobIds = [jobAdmin.id, jobRed.id, cancelJob.id];
  await db.run('DELETE FROM processing_history WHERE entity_id IN (?,?,?)', jobIds);
  await db.run('DELETE FROM mass_redaction_jobs WHERE id IN (?,?,?)', jobIds);
  await db.run('DELETE FROM layout_profiles WHERE id = ?', [tplId]);
  await db.run('DELETE FROM user_permission_roles WHERE user_id IN (?,?)', [uNone.id, uRed.id]);
  await db.run('DELETE FROM users WHERE id IN (?,?)', [uNone.id, uRed.id]);
  var left1 = await db.get("SELECT count(*)::int AS n FROM mass_redaction_jobs WHERE name LIKE '%' || ?", [TAG]);
  var left2 = await db.get("SELECT count(*)::int AS n FROM users WHERE title = 'Test ' || ?", [TAG]);
  ok('D1 all fixture rows are gone', Number(left1.n) === 0 && Number(left2.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
