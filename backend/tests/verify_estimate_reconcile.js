'use strict';
// SLICE E — measured-labor → fee reconciliation wiring.
//
// Slice D measures actual labor per task (tasks.work_seconds, finalized). Slice E · Fork 1 made capture a city
// toggle, so work_seconds may be a real number OR NULL (off/skipped). This harness covers the bridge:
//   (1) laborActuals.rollup — finalized seconds map to fee labor-driver HOURS by task type; NULL work_seconds is
//       tolerated (excluded, never assumed zero-and-billed).
//   (2) Fork 2 auto-draft trigger — when the LAST billable work task finalizes AND a prior estimate + measured
//       labor exist, a kind='reconciliation' DRAFT is auto-computed. It does NOT fire early (other billable work
//       still open), does NOT fire without an estimate, does NOT fire with no measured actuals, and NEVER sends a
//       notice on its own (human-gated: notified_at stays NULL).
//   (3) the manual reconcile route still works through the same shared snapshot writer (regression).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var auth = require('/opt/optimumq/backend/src/services/auth');
var laborActuals = require('/opt/optimumq/backend/src/services/laborActuals');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var PORT = Number(process.env.API_PORT) || 3101, TAG = 'ER-' + Date.now();
var OWNER = 'u-police-staff';
async function token(id) { var u = await db.get('SELECT * FROM users WHERE id = ?', [id]); return u ? await auth.signAccessToken(u) : null; }
async function api(method, path, tok, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: Object.assign(tok ? { Authorization: 'Bearer ' + tok } : {}, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
}
async function mkReq(suffix) {
  var rid = 'req-' + TAG + '-' + suffix;
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?, 'record_search','active') ON CONFLICT (id) DO NOTHING", [rid, rid, 'x', 'x@x', 'er']);
  return rid;
}
async function mkEstimate(tok, rid, quantities) {
  var e = await api('POST', '/fee-estimates/request/' + rid, tok, { components: [{ id: 'c1', label: 'records', quantities: quantities }], delivery: { method: 'email' } });
  if (e.status !== 200) throw new Error('estimate setup failed: ' + JSON.stringify(e.body));
  return e.body.estimate.total;
}
async function mkTask(rid, type) { var t = await tr.createTask({ type: type, requestId: rid, createdBy: 'test' }); await tr.assign(t.id, OWNER, 'manual'); return t.id; }
async function finalize(tok, taskId, seconds, extra) {
  await api('POST', '/tasks/' + taskId + '/work', tok, { seconds: seconds });
  return await api('POST', '/tasks/' + taskId + '/work/finalize', tok, Object.assign({ seconds: seconds }, extra || {}));
}
async function setDone(taskId) { await db.run("UPDATE tasks SET status = 'done' WHERE id = ?", [taskId]); }
async function recon(rid) { return await db.get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'reconciliation' ORDER BY created_at DESC LIMIT 1", [rid]); }

(async function () {
  await db.initDb();
  var tok = await token(OWNER);

  console.log('\n=== A. ROLLUP — finalized seconds map to labor-driver HOURS by task type; NULL tolerated ===');
  var rA = await mkReq('rollup');
  var ts = await mkTask(rA, 'record_search'); await finalize(tok, ts, 3600);            // 1.0 h search
  var tr1 = await mkTask(rA, 'redaction'); await finalize(tok, tr1, 1800);              // 0.5 h review
  var tr2 = await mkTask(rA, 'legal_review'); await finalize(tok, tr2, 900);            // 0.25 h review
  var te = await mkTask(rA, 'estimate'); await finalize(tok, te, 5400);                 // non-billable -> 0
  var tsk = await mkTask(rA, 'redaction'); await finalize(tok, tsk, 4000, { skipped: true }); // NULL -> excluded
  var roll = await laborActuals.rollup(rA);
  ok('A1 search = 1.0 h (record_search)', roll.hours.searchHours === 1);
  ok('A2 review = 0.75 h (redaction 0.5 + legal_review 0.25)', roll.hours.reviewHours === 0.75);
  ok('A3 programming = 0 h (no task maps to it)', roll.hours.programmingHours === 0);
  ok('A4 the estimate task contributes nothing (non-billable, not in the rollup at all)', !roll.counted.some(function (c) { return c.type === 'estimate'; }) && !roll.excluded.some(function (c) { return c.type === 'estimate'; }));
  ok('A5 the SKIPPED redaction (work_seconds NULL) is EXCLUDED, not counted as zero', roll.excluded.some(function (c) { return c.id === tsk; }) && roll.counted.every(function (c) { return c.id !== tsk; }));
  ok('A6 hasActuals is true', roll.hasActuals === true);

  console.log('\n=== B. AUTO-DRAFT — fires only when the LAST billable task finalizes; never sends a notice ===');
  var rB = await mkReq('draft');
  var estTotalB = await mkEstimate(tok, rB, { searchHours: 1, reviewHours: 1, bwPages: 20 });
  var bSearch = await mkTask(rB, 'record_search');
  var bRed = await mkTask(rB, 'redaction');
  // Finalize the search task while the redaction task is STILL open -> not the last billable task.
  await finalize(tok, bSearch, 7200);   // 2 h search
  ok('B1 no reconciliation yet — a billable task is still in flight', !(await recon(rB)));
  // The search task resolves (status done); the redaction task is now the last billable task.
  await setDone(bSearch);
  await finalize(tok, bRed, 3600);       // 1 h review
  var recB = await recon(rB);
  ok('B2 finalizing the LAST billable task auto-computed a reconciliation draft', !!recB);
  ok('B3 the draft is marked auto-generated (created_by)', recB && /auto-draft/i.test(recB.created_by || ''));
  ok('B4 SEND stays human-gated — the draft was NOT notified to the requestor', recB && recB.notified_at == null);
  ok('B5 variance vs the estimate was computed', recB && recB.variance_pct != null && recB.baseline_total != null && Math.abs(Number(recB.baseline_total) - estTotalB) < 0.005);
  var draftInput = {}; try { draftInput = JSON.parse(recB.input_json || '{}'); } catch (e) {}
  var c0 = draftInput.components && draftInput.components[0] && draftInput.components[0].quantities;
  ok('B6 the draft carries the MEASURED labor (search 2 h, review 1 h) on the request', c0 && c0.searchHours === 2 && c0.reviewHours === 1);
  ok('B7 the draft carries the estimate\'s non-labor quantities forward (bwPages 20)', c0 && c0.bwPages === 20);
  ok('B8 exactly one reconciliation snapshot exists (no early duplicate)', (await db.get("SELECT count(*) AS n FROM request_fee_estimates WHERE request_id = ? AND kind = 'reconciliation'", [rB])).n === 1);

  console.log('\n=== C. NO MEASURED ACTUALS — a skipped last task leaves nothing billable; no draft ===');
  var rC = await mkReq('skip');
  await mkEstimate(tok, rC, { searchHours: 1, bwPages: 10 });
  var cTask = await mkTask(rC, 'record_search');
  await finalize(tok, cTask, 5000, { skipped: true });   // work_seconds NULL
  ok('C1 rollup.hasActuals is false (nothing captured)', (await laborActuals.rollup(rC)).hasActuals === false);
  ok('C2 no reconciliation drafted — falls back to the manual path, never reconciles fabricated zeros', !(await recon(rC)));

  console.log('\n=== D. NO ESTIMATE — nothing to reconcile against; no draft ===');
  var rD = await mkReq('noest');
  var dTask = await mkTask(rD, 'record_search');
  await finalize(tok, dTask, 3600);
  ok('D1 measured labor exists but there is no estimate -> no draft', (await laborActuals.rollup(rD)).hasActuals === true && !(await recon(rD)));

  console.log('\n=== E. NON-BILLABLE finalize does not trigger a draft ===');
  var rE = await mkReq('nonbill');
  await mkEstimate(tok, rE, { searchHours: 1, bwPages: 10 });
  var eTask = await mkTask(rE, 'estimate');
  await finalize(tok, eTask, 3600);      // finalizing an ESTIMATE task (non-billable)
  ok('E1 finalizing a non-billable task type does not auto-draft', !(await recon(rE)));

  console.log('\n=== F. MANUAL reconcile route still works through the shared writer (regression) ===');
  var rF = await mkReq('manual');
  await mkEstimate(tok, rF, { searchHours: 1, bwPages: 10 });
  await db.run("UPDATE request_fee_estimates SET notified_at = ?, accepted_at = ? WHERE request_id = ? AND kind = 'estimate'", ['2026-07-15 00:00:00', '2026-07-15 00:00:00', rF]);
  var rec = await api('POST', '/fee-estimates/request/' + rF + '/reconcile', tok, { components: [{ id: 'c1', label: 'records', quantities: { searchHours: 3, bwPages: 40 } }], delivery: { method: 'email' } });
  ok('F1 manual reconcile returns 200 with actualTotal + variancePct', rec.status === 200 && rec.body.actualTotal != null && ('variancePct' in rec.body));
  var recF = await recon(rF);
  ok('F2 it wrote a reconciliation snapshot (not marked auto-draft)', recF && !/auto-draft/i.test(recF.created_by || ''));

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
