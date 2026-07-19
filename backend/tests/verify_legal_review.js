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

  // ==========================================================================================
  // I. A FINISHED TASK CANNOT DRIVE A STAGE TRANSITION.
  //
  // /tasks/:id/resolve checked the task TYPE and never its STATUS, so a done or cancelled task was still
  // resolvable — and resolving runs applyStageTransition, so it MOVES A REQUEST. Found 2026-07-19 by driving
  // the new screen: a CANCELLED legal_review was decided through the UI and advanced its request to
  // redaction_review. §3.2 cancels a stage's task whenever the request moves on, so stale cancelled tasks
  // are a normal, continuously-produced condition — not an edge case.
  //
  // Asserted over the API, not by source scan: this is the real guard.
  // ==========================================================================================
  console.log('\n=== I. a done/cancelled task cannot be resolved ===');

  // I(a) CANCELLED — the exact shape observed.
  var rI = 'req-' + TAG + '-I';
  await mkRequest(rI, 'record_search');
  await tr.applyStageTransition(rI, 'exemption_review', actor);
  var lrI = (await openTasks(rI, 'legal_review'))[0];
  // Moving the request on cancels the outgoing stage's task (§3.2) — the real way these are produced.
  await tr.applyStageTransition(rI, 'redaction_review', actor);
  var cancelled = await db.get('SELECT status FROM tasks WHERE id = ?', [lrI.id]);
  ok('I1 moving the request on leaves the legal_review cancelled (the §3.2 behaviour)', cancelled.status === 'cancelled');

  var stageBefore = (await db.get('SELECT stage FROM requests WHERE id = ?', [rI])).stage;
  var rejCancel = await api('POST', '/tasks/' + lrI.id + '/resolve', { outcome: 'overruled', notes: 'should be refused' });
  ok('I2 resolving a cancelled task is refused with 409 TASK_NOT_ACTIONABLE',
    rejCancel.status === 409 && rejCancel.body && rejCancel.body.code === 'TASK_NOT_ACTIONABLE');
  var stageAfter = (await db.get('SELECT stage FROM requests WHERE id = ?', [rI])).stage;
  // The assertion that matters: the REQUEST DID NOT MOVE. `overruled` would have sent it to `delivery`.
  ok('I3 and the request did not move (' + stageBefore + ' still)', stageAfter === stageBefore && stageAfter !== 'delivery');

  // I(b) DONE — the same task must not be resolvable twice.
  var rJ = 'req-' + TAG + '-J';
  await mkRequest(rJ, 'record_search');
  await tr.applyStageTransition(rJ, 'exemption_review', actor);
  var lrJ = (await openTasks(rJ, 'legal_review'))[0];
  var first = await api('POST', '/tasks/' + lrJ.id + '/resolve', { outcome: 'sustained', notes: 'legitimate first decision' });
  ok('I4 the first resolution succeeds', first.status === 200 && first.body && first.body.stage === 'redaction_review');
  var second = await api('POST', '/tasks/' + lrJ.id + '/resolve', { outcome: 'overruled', notes: 'second bite' });
  ok('I5 resolving the SAME task again is refused (no double transition)',
    second.status === 409 && second.body && second.body.code === 'TASK_NOT_ACTIONABLE');
  var stageJ = (await db.get('SELECT stage FROM requests WHERE id = ?', [rJ])).stage;
  ok('I6 and the second outcome did not take effect (still redaction_review, not delivery)', stageJ === 'redaction_review');

  // I(c) The guard must not block legitimate work.
  var rK = 'req-' + TAG + '-K';
  await mkRequest(rK, 'record_search');
  await tr.applyStageTransition(rK, 'exemption_review', actor);
  var lrK = (await openTasks(rK, 'legal_review'))[0];
  await db.run("UPDATE tasks SET status = 'in_progress' WHERE id = ?", [lrK.id]);
  var live = await api('POST', '/tasks/' + lrK.id + '/resolve', { outcome: 'partial', notes: 'in-progress task resolves normally' });
  ok('I7 an in_progress task still resolves normally (the guard is not over-broad)',
    live.status === 200 && live.body && live.body.stage === 'redaction_review');

  // ==========================================================================================
  // H. THE DECISION IS REACHABLE FROM THE UI (brief §4 Phase 2).
  //
  // Sections A-G tested the ENDPOINT and passed for a full day while the decision was reachable only by
  // curl: `/tasks/:id/resolve` handled legal_review correctly, and `TASK_SCREEN` in MyTasksPage carried no
  // entry for it, so the task fell through to `/requests/:id` — a page with no resolution control. 18 green
  // assertions over a feature no staff member could use.
  //
  // H4 is the one that matters: it closes the CLASS rather than this instance. A task type the resolve
  // endpoint accepts, with no screen to reach it, is unreachable work — so the check derives the accepted
  // types FROM THE ROUTE and requires each to have a screen. Add a type to the resolve guard without a
  // screen and this fails, naming it.
  // ==========================================================================================
  console.log('\n=== H. the legal review is REACHABLE from the UI, not just from curl ===');
  var fs = require('fs');
  var FE = '/opt/optimumq/frontend/src';

  var pageExists = fs.existsSync(FE + '/pages/LegalReviewTaskPage.js');
  ok('H1 LegalReviewTaskPage.js exists', pageExists);

  var appSrc = fs.readFileSync(FE + '/App.js', 'utf8');
  ok('H2 it is routed (legal-review/:taskId -> LegalReviewTaskPage)',
    /legal-review\/:taskId/.test(appSrc) && /<LegalReviewTaskPage\s*\/>/.test(appSrc));

  var myTasks = fs.readFileSync(FE + '/pages/MyTasksPage.js', 'utf8');
  var screenMap = (myTasks.match(/var TASK_SCREEN = \{[\s\S]*?\n\};/) || [''])[0];
  ok('H3 My Tasks links legal_review to that screen', /legal_review:\s*function/.test(screenMap));

  // Derive the accepted types from the route itself, so the check cannot go stale against the backend.
  var tasksRoute = fs.readFileSync('/opt/optimumq/backend/src/routes/tasks.js', 'utf8');
  var guard = (tasksRoute.match(/if \(t\.type !== [\s\S]*?\) \{/) || [''])[0];
  var accepted = (guard.match(/t\.type !== '([a-z_]+)'/g) || []).map(function (m) { return m.split("'")[1]; });
  var unreachable = accepted.filter(function (ty) {
    return !new RegExp('(^|[^a-z_])' + ty + ':\\s*function').test(screenMap);
  });
  ok('H4 EVERY task type /tasks/:id/resolve accepts has a screen (accepted: ' + accepted.join(', ') +
     (unreachable.length ? '; UNREACHABLE: ' + unreachable.join(', ') : '') + ')',
    accepted.length >= 2 && unreachable.length === 0);

  // SCAN CODE, NOT COMMENTS. A first cut of H8 matched the word ACTIONABLE anywhere in the file and passed
  // when the guard was deleted, because the explanatory comment above it still said "cancelled" and a dead
  // identifier still contained the token. Break-testing caught it. Strip comment lines first so these
  // assertions can only be satisfied by code.
  function codeOf(p) {
    return fs.readFileSync(p, 'utf8').split('\n')
      .filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join('\n');
  }
  var pageSrc = pageExists ? codeOf(FE + '/pages/LegalReviewTaskPage.js') : '';
  ok('H5 the screen resolves through /tasks/:id/resolve (the central-transition path)',
    /\/tasks\/'\s*\+\s*taskId\s*\+\s*'\/resolve/.test(pageSrc));
  // §3.3: the removed `POST /tasks/:id/complete` is exactly what a stub screen reaches for, and it would
  // finish the task WITHOUT moving the request. A stub that calls it looks like it works and strands.
  ok('H6 and never reaches for the removed /complete endpoint', !/\/complete/.test(pageSrc));
  // The note is enforced server-side (C-section); the screen must mirror it so the reviewer is not
  // surprised by a 422 after typing a decision.
  ok('H7 the screen mirrors the required-note rule client-side', /notes\.trim\(\)/.test(pageSrc) && /required/i.test(pageSrc));
  // §3.2 CANCELS a stage's task when the request moves on, so a stale legal_review sits at `cancelled`. A
  // screen keyed only on 'done' renders the full decision form over it — observed 2026-07-19, when a
  // cancelled task was resolved through this screen and moved the request.
  // ⚠️ This asserts only the CLIENT-SIDE courtesy. `/tasks/:id/resolve` still checks type and never status,
  // so the same call by curl succeeds. When that guard lands in the route, assert it here over the API.
  // Match the GUARD EXPRESSION itself — the status must be tested against the actionable set, and the
  // result must gate rendering. Deleting the guard fails this; a comment about it cannot satisfy it.
  ok('H8 the screen refuses to decide a task that is not actionable (e.g. cancelled)',
    /ACTIONABLE\s*=\s*\[[^\]]*'open'[^\]]*\]/.test(pageSrc) &&
    /ACTIONABLE\.indexOf\(\s*task\.status\s*\)\s*<\s*0/.test(pageSrc) &&
    /var done = resolved \|\| closed/.test(pageSrc));

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
