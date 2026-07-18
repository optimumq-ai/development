'use strict';
// LEGAL REVIEW IS RESOLVABLE, AND A STAGE'S TASK DIES WITH ITS STAGE (brief §3.2).
//
// WHAT THIS PREVENTS, in two parts:
//
// (1) `legal_review` spawns at exemption_review / ag_review and NOTHING could complete it. No route resolved
//     it, and the 2-minute reconciler re-created it for as long as the request sat at that stage. The only
//     thing that could mark it done was the unguarded `POST /tasks/:id/complete` — which would have left the
//     request at exemption_review with no task and no way forward. Completing a legal review IS a stage
//     decision, so it now goes through applyStageTransition, and a NOTE IS REQUIRED because asserting an
//     exemption is a legal act the city may have to defend.
//
// (2) A task belongs to the stage that implied it. `legal_review` was only ever cleared by `closed`, so
//     `/requests/:id/ag-ruling` (ag_review -> redaction_review) left an OPEN, POOLED legal_review on a
//     request that had already moved to redaction — two open tasks from two different stages at once, and a
//     legal staffer could claim an exemption review for a decision already made and acted on.
//
// The family rule is the subtle half: redaction_review -> redaction implies `redaction` on BOTH sides, so an
// in-flight redaction task MUST survive that move. Cancelling it there would destroy real work.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'LR-' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;

async function api(method, path, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function mkRequest(id, stage) {
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?,?, 'active') ON CONFLICT (id) DO NOTHING",
    [id, id, 'Test', 't@example.com', 'legal review test ' + TAG, stage || 'record_search']);
}
async function openTasks(rid, type) {
  return await db.all("SELECT id, type, status FROM tasks WHERE request_id = ? AND type = ? AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [rid, type]);
}

(async function () {
  await db.initDb();
  var admin = await db.get("SELECT * FROM users WHERE id = 'u-legal-super'");
  TOKEN = await auth.signAccessToken(admin);
  var actor = { actorName: 'Harness' };

  console.log('\n=== A. legal_review SPAWNS at exemption_review, as before ===');
  var rA = 'req-' + TAG + '-A';
  await mkRequest(rA, 'record_search');
  await tr.applyStageTransition(rA, 'exemption_review', actor);
  var lrA = await openTasks(rA, 'legal_review');
  ok('A1 entering exemption_review spawns exactly one open legal_review', lrA.length === 1);

  console.log('\n=== B. IT CAN NOW BE RESOLVED — but not carelessly ===');
  var noNote = await api('POST', '/tasks/' + lrA[0].id + '/resolve', { outcome: 'sustained' });
  ok('B1 resolving with NO NOTE is refused (422 NOTE_REQUIRED)',
    noNote.status === 422 && noNote.body && noNote.body.code === 'NOTE_REQUIRED');
  var stillOpen = await openTasks(rA, 'legal_review');
  ok('B2 the refused call changed nothing — task still open', stillOpen.length === 1);

  var badOutcome = await api('POST', '/tasks/' + lrA[0].id + '/resolve', { outcome: 'looks_fine', notes: 'a note' });
  ok('B3 an unknown outcome is refused (400)', badOutcome.status === 400);

  var good = await api('POST', '/tasks/' + lrA[0].id + '/resolve',
    { outcome: 'sustained', notes: 'Withheld under 7(1)(b); personnel file.' });
  ok('B4 sustained + a note succeeds', good.status === 200 && good.body && good.body.ok === true);
  var taskA = await db.get('SELECT status FROM tasks WHERE id = ?', [lrA[0].id]);
  ok('B5 the task is done', taskA.status === 'done');
  var reqA = await db.get('SELECT stage FROM requests WHERE id = ?', [rA]);
  ok('B6 the REQUEST MOVED — sustained -> redaction_review (not stranded)', reqA.stage === 'redaction_review');
  var hA = await db.get("SELECT action, notes, stage_from, stage_to FROM request_history WHERE request_id = ? AND action = 'LEGAL_REVIEW_RECORDED' ORDER BY created_at DESC LIMIT 1", [rA]);
  ok('B7 history records the decision, with the reviewer\'s note preserved',
    !!hA && hA.stage_from === 'exemption_review' && hA.stage_to === 'redaction_review' && hA.notes.indexOf('7(1)(b)') >= 0);

  console.log('\n=== C. THE RECONCILER DOES NOT RESURRECT IT (the stage moved on) ===');
  await tr.reconcileStageTasks();
  var afterRec = await openTasks(rA, 'legal_review');
  ok('C1 no legal_review comes back after a reconciler sweep', afterRec.length === 0);

  console.log('\n=== D. overruled RELEASES instead of redacting ===');
  var rD = 'req-' + TAG + '-D';
  await mkRequest(rD, 'record_search');
  await tr.applyStageTransition(rD, 'exemption_review', actor);
  var lrD = (await openTasks(rD, 'legal_review'))[0];
  var ovr = await api('POST', '/tasks/' + lrD.id + '/resolve', { outcome: 'overruled', notes: 'No exemption applies; release in full.' });
  ok('D1 overruled succeeds', ovr.status === 200);
  ok('D2 overruled -> delivery', (await db.get('SELECT stage FROM requests WHERE id = ?', [rD])).stage === 'delivery');

  console.log('\n=== E. THE ORPHAN: a stage task dies when its stage moves on ===');
  var rE = 'req-' + TAG + '-E';
  await mkRequest(rE, 'record_search');
  await tr.applyStageTransition(rE, 'ag_review', actor);
  var lrE = await openTasks(rE, 'legal_review');
  ok('E1 ag_review spawned a legal_review', lrE.length === 1);
  // The AG ruling moves the stage WITHOUT touching the task — exactly the path that used to orphan it.
  var ruling = await api('POST', '/requests/' + rE + '/ag-ruling', { outcome: 'sustained', note: 'ruling recorded' });
  ok('E2 the AG ruling advanced the request', ruling.status === 200 &&
    (await db.get('SELECT stage FROM requests WHERE id = ?', [rE])).stage === 'redaction_review');
  var orphan = await openTasks(rE, 'legal_review');
  ok('E3 the legal_review is NOT left open and claimable (this is the bug)', orphan.length === 0);
  var redE = await openTasks(rE, 'redaction');
  ok('E4 and the new stage got its own task', redE.length === 1);

  console.log('\n=== F. FAMILY-AWARE: an in-flight redaction SURVIVES redaction_review -> redaction ===');
  // The dangerous over-correction. Both stages imply `redaction`, so cancelling here would destroy real work.
  var redBefore = (await openTasks(rE, 'redaction'))[0];
  await db.run("UPDATE tasks SET status = 'in_progress' WHERE id = ?", [redBefore.id]);
  await tr.applyStageTransition(rE, 'redaction', actor);
  var redAfter = await db.get('SELECT status FROM tasks WHERE id = ?', [redBefore.id]);
  ok('F1 the in-progress redaction task is untouched by the move', redAfter.status === 'in_progress');
  ok('F2 and no duplicate redaction task was spawned alongside it', (await openTasks(rE, 'redaction')).length === 1);

  console.log('\n=== G. exemption_review -> ag_review keeps the SAME legal_review (same task both sides) ===');
  var rG = 'req-' + TAG + '-G';
  await mkRequest(rG, 'record_search');
  await tr.applyStageTransition(rG, 'exemption_review', actor);
  var lrG1 = (await openTasks(rG, 'legal_review'))[0];
  await tr.applyStageTransition(rG, 'ag_review', actor);
  var lrG2 = await openTasks(rG, 'legal_review');
  ok('G1 escalating exemption_review -> ag_review keeps the one legal_review, same id',
    lrG2.length === 1 && lrG2[0].id === lrG1.id);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
