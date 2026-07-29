'use strict';
// PHASE 7 / BW6 — THE MRR MANAGEMENT HUB. What this harness asserts, and why each claim earns a test:
//
//   A. AN MRR ACTIVITY NEVER ADVANCES A STAGE. This is THE structural claim of the whole workstream
//      (Kevin 7/28 item 5) and it is the one a future refactor would break silently — a stage call added
//      to mrrHub would look like a helpful convenience and would destroy the distinction between
//      `mrr_search` and `record_search`. So: spawn every activity on every item, complete them all, and
//      assert the child's stage, the parent's stage and the parent's status are all EXACTLY where they
//      started. Plus a source-level guard, because the behavioural test only covers today's call paths.
//   B. THE SUBSTRATE. Activities materialise lazily (deploying BW6 writes nothing), the honest five-value
//      status set survives a round trip, a spawn puts a REAL task on the assignee's My Tasks under the
//      right type, and "not required" demands a reason — because it is a decision, not a blank.
//   C. READINESS ARMS ONE BUTTON. n of m counts LIVE items only; the meter is driven by a per-child fact
//      SOMEBODY WROTE and never inferred from an activity status; Generate Estimate REFUSES below m of m
//      and arms the STANDARD engine at m of m rather than pricing anything itself.
//   D. DESIGNATION IS NOT A DENIAL. It spawns `legal_review`, requires grounds, and leaves the item OPEN
//      and undenied. Asserted by checking the item's status and closure_reason after designating — the
//      test that would fail the day somebody "helpfully" closed it.
//   E. THE FULFILLING-RECORD AUTO-COMPLETE, PER ITEM. The requestor's own `intent = 'complete'` completes
//      THAT item's search and no other item's, and completes the SEARCH only — a requestor's selection
//      cannot answer a staff judgement about redaction or price.
//   F. ONE VOICE. The contact-the-requestor write is manager-only at the API, and the assignee's activity
//      view offers "email the Request Manager" and carries no requestor address. A rule enforced only in
//      JSX is a rule one careless render removes.
//   G. deriveParent IS READ, NEVER RECOMPUTED. The hub reports the parent state disposition left behind,
//      including after a reopen un-derives it — and the reactivated `mrr_management` task comes back with
//      it, because a live child with no hub is a stranded item.
//   H. PER-CHILD RELEASE PASSES BOTH GATES. §5.9 coverage (a sibling's unpaid balance is NEVER a reason
//      to withhold this item) and the RM hold, including the installment-entitlement PREVENTION guard
//      whose refusal is surfaced VERBATIM with its citation. And MRR STAYS OUT OF THE AUTO-RELEASE
//      PIPELINE — asserted directly against autoRelease's NON_MRR condition, because BW6 touching that
//      would be the quietest possible regression.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var fs = require('fs');
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var HUB = require('/opt/optimumq/backend/src/services/mrrHub');
var DISP = require('/opt/optimumq/backend/src/services/disposition');
var AR = require('/opt/optimumq/backend/src/services/autoRelease');
var RH = require('/opt/optimumq/backend/src/services/releaseHold');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var uuidv4 = require('uuid').v4;

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'BW6-' + Date.now();
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, p, body, token) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || TOKEN) } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j }); });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

async function makeRequest(id, fields) {
  fields = fields || {};
  await db.run(
    'INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id, master_request_id, is_mrr, component_label) ' +
    "VALUES (?,?,?,?,?,?,'active',?,?,?,?)",
    [id, id, 'BW6 Harness', fields.email === null ? '' : (fields.email || 'bw6@example.com'),
     fields.description || ('bw6 harness ' + TAG), fields.stage || 'record_search',
     fields.departmentId || null, fields.parentId || null, fields.isMrr ? 1 : 0, fields.label || null]);
  return id;
}

// A parent with n children — the only shape any of this applies to (`child_count > 1`).
async function makeMrr(tag, n, opts) {
  opts = opts || {};
  var pid = await makeRequest('req-' + tag + '-P', { departmentId: opts.departmentId, isMrr: true, stage: 'record_search',
    description: 'Everything about the Barton Creek trail rebuild — minutes, the contract, the drone footage and the permits.' });
  var kids = [];
  for (var i = 1; i <= n; i++) {
    kids.push(await makeRequest('req-' + tag + '-C' + i, { departmentId: opts.departmentId, parentId: pid,
      label: 'Item ' + i, stage: 'record_search',
      description: 'Item ' + i + ' as the requestor wrote it, in their own words and not a paraphrase.' }));
  }
  var t = await tr.createTask({ requestId: pid, type: 'mrr_management', teamId: null, createdBy: 'bw6-harness' });
  if (opts.manager) await db.run("UPDATE tasks SET assigned_to = ?, status = 'in_progress' WHERE id = ?", [opts.manager, t.id]);
  return { parentId: pid, kids: kids, taskId: t.id };
}

async function stageOf(id) { var r = await db.get('SELECT stage, status FROM requests WHERE id = ?', [id]); return r; }

(async function () {
  await db.initDb();
  var jid = null, savedBranches = null, hadBranches = false;
  try {
    jid = await JR.activeJid();
    try { savedBranches = jid ? await JR.read(jid, 'branches') : null; hadBranches = !!savedBranches; } catch (e) { savedBranches = null; }

    var users = await db.all("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL ORDER BY id LIMIT 3");
    var mgr = users[0], worker = users[1] || users[0], stranger = users[2] || users[0];
    TOKEN = await auth.signAccessToken(mgr);
    var WORKER_TOKEN = await auth.signAccessToken(worker);
    var STRANGER_TOKEN = await auth.signAccessToken(stranger);
    var TEAM = mgr.department_id;

    // ================================================================================================
    console.log('\n=== A. AN MRR ACTIVITY NEVER ADVANCES A STAGE (the whole structural claim) ===');
    var A = await makeMrr(TAG + 'A', 3, { departmentId: TEAM, manager: mgr.id });
    var beforeChild = await stageOf(A.kids[0]);
    var beforeParent = await stageOf(A.parentId);

    for (var ki = 0; ki < A.kids.length; ki++) {
      for (var ai = 0; ai < HUB.ACTIVITIES.length; ai++) {
        await HUB.spawnActivity(A.kids[ki], HUB.ACTIVITIES[ai], { assigneeId: worker.id, actorId: mgr.id, actorName: mgr.display_name });
        await HUB.startActivity(A.kids[ki], HUB.ACTIVITIES[ai], { actorId: worker.id, actorName: worker.display_name });
        await HUB.completeActivity(A.kids[ki], HUB.ACTIVITIES[ai], { actorId: worker.id, actorName: worker.display_name });
      }
    }
    var afterChild = await stageOf(A.kids[0]);
    var afterParent = await stageOf(A.parentId);
    ok('A1 every activity on every item completed, and the CHILD has not moved one stage',
      afterChild.stage === beforeChild.stage && afterChild.status === beforeChild.status);
    ok('A2 …nor has the parent — an MRR is orchestrated by the manager, not by the engine',
      afterParent.stage === beforeParent.stage && afterParent.status === beforeParent.status);
    var noFlow = await db.get("SELECT count(*)::int AS n FROM tasks WHERE request_id = ? AND type IN ('record_search','redaction','estimate')", [A.kids[0]]);
    ok('A3 …and no FLOW task was spawned as a side effect — the MRR types are separate keys precisely so ' +
       'the two can never blur', noFlow.n === 0);
    var hist = await db.all("SELECT notes FROM request_history WHERE request_id = ? AND action = 'MRR_ACTIVITY_COMPLETED'", [A.kids[0]]);
    ok('A4 …and each completion SAYS so on the record, so a later reader is not left inferring it',
      hist.length === 3 && /advances no stage/i.test(hist[0].notes));

    // THE SOURCE GUARD. The behavioural test above only covers today's call paths; this one covers the
    // edit somebody makes next year. `applyStageTransition` in mrrHub would be the end of the design.
    var hubSrc = fs.readFileSync('/opt/optimumq/backend/src/services/mrrHub.js', 'utf8');
    ok('A5 SOURCE GUARD — services/mrrHub.js contains no applyStageTransition and no spawnForStage call. ' +
       'This is the assertion that survives a refactor the behavioural tests would not notice',
      hubSrc.indexOf('applyStageTransition(') < 0 && hubSrc.indexOf('spawnForStage(') < 0);

    // ================================================================================================
    console.log('\n=== B. THE SUBSTRATE — lazy, honest, and a real task for the assignee ===');
    var B = await makeMrr(TAG + 'B', 2, { departmentId: TEAM, manager: mgr.id });
    var rowsBefore = await db.get('SELECT count(*)::int AS n FROM mrr_tasks WHERE request_id = ?', [B.kids[0]]);
    ok('B1 deploying the substrate writes NOTHING — an untouched item has no activity rows at all', rowsBefore.n === 0);
    var lazyRead = await HUB.activities(B.kids[0]);
    ok('B2 …and still reads as three activities, each honestly `not_started` — a missing row is not a missing fact',
      lazyRead.length === 3 && lazyRead.every(function (a) { return a.status === 'not_started' && a.materialised === false; }));

    await HUB.spawnActivity(B.kids[0], 'search', { assigneeId: worker.id, actorId: mgr.id, actorName: 'Mgr' });
    var spawned = await HUB.getActivity(B.kids[0], 'search');
    var wtask = await db.get('SELECT * FROM tasks WHERE id = ?', [spawned.task_id]);
    ok('B3 a spawn puts a REAL task on the assignee’s list, under the MRR type', !!wtask && wtask.type === 'mrr_search');
    ok('B4 …assigned to the named person — hand-assigned, no smart routing', wtask.assigned_to === worker.id);
    ok('B5 …titled in the words they will read, carrying the parent number and the item',
      /MRR SEARCH/.test(wtask.title) && wtask.title.indexOf(B.parentId) >= 0);
    ok('B6 …and the activity is Queued, not silently In Process', spawned.status === 'queued');
    ok('B7 the assignee’s type is one of the three hand-assigned MRR keys, never a routable one',
      tr.HAND_ASSIGNED_TASK_TYPES.indexOf(wtask.type) >= 0 && tr.ROUTABLE_TASK_TYPES.indexOf(wtask.type) < 0);

    var noReason = null;
    try { await HUB.setNotRequired(B.kids[0], 'redaction', { actorId: mgr.id }); } catch (e) { noReason = e; }
    ok('B8 “not required” without a reason is REFUSED — it is a decision, not a blank',
      !!noReason && noReason.code === 'REASON_REQUIRED');
    await HUB.setNotRequired(B.kids[0], 'redaction', { reason: 'Nothing responsive is exempt on this item.', actorId: mgr.id });
    var nr = await HUB.getActivity(B.kids[0], 'redaction');
    ok('B9 …with one, it records BOTH the state and the why', nr.status === 'not_required' && !!nr.not_required_reason);
    var notStarted = await HUB.getActivity(B.kids[0], 'estimate');
    ok('B10 `not_started` and `not_required` stay DIFFERENT facts on the same item — a manager deciding ' +
       'what to assign next has to be able to tell them apart', notStarted.status === 'not_started');

    var badAct = null;
    try { await HUB.spawnActivity(B.kids[0], 'delivery', { assigneeId: worker.id }); } catch (e) { badAct = e; }
    ok('B11 an item has exactly three activities; a fourth is refused', !!badAct && badAct.code === 'BAD_ACTIVITY');
    var noAssignee = null;
    try { await HUB.spawnActivity(B.kids[1], 'search', { actorId: mgr.id }); } catch (e) { noAssignee = e; }
    ok('B12 an assignment with nobody named is refused — hand-assignment means a hand names a person',
      !!noAssignee && noAssignee.code === 'ASSIGNEE_REQUIRED');

    // ================================================================================================
    console.log('\n=== C. READINESS ARMS ONE BUTTON, AND IT ARMS THE STANDARD ENGINE ===');
    var Cx = await makeMrr(TAG + 'C', 3, { departmentId: TEAM, manager: mgr.id });
    var r0 = await HUB.readiness(Cx.parentId);
    ok('C1 the meter starts at 0 of m, counting the items', r0.n === 0 && r0.m === 3 && r0.ready === false);

    // The trap the meter must not fall into: an activity marked complete is NOT estimate data.
    await HUB.spawnActivity(Cx.kids[0], 'estimate', { assigneeId: worker.id, actorId: mgr.id });
    await HUB.completeActivity(Cx.kids[0], 'estimate', { actorId: worker.id, actorName: 'W' });
    var rTrap = await HUB.readiness(Cx.parentId);
    ok('C2 an activity marked complete does NOT move the meter — “the gatherer finished” is not “the ' +
       'numbers exist”, and the meter is a fact somebody WROTE', rTrap.n === 0);

    await HUB.saveEstimateData(Cx.kids[0], { pageCount: 40, laborMinutes: 30, estimatedCost: 12, complete: true }, { actorId: mgr.id, actorName: 'Mgr' });
    await HUB.saveEstimateData(Cx.kids[1], { pageCount: 10, complete: false }, { actorId: mgr.id, actorName: 'Mgr' });
    var r1 = await HUB.readiness(Cx.parentId);
    ok('C3 a SAVED-but-incomplete item does not count either', r1.n === 1 && r1.ready === false);
    ok('C4 …and the meter names what it is waiting on, rather than only counting',
      r1.pending.length === 2 && !!r1.pending[0].label);

    var armRefused = await req('POST', '/api/mrr/' + Cx.taskId + '/generate-estimate', {});
    ok('C5 Generate estimate REFUSES below m of m, and says how far off it is',
      armRefused.status === 409 && armRefused.body.code === 'NOT_READY' && /1 of 3/.test(armRefused.body.error));

    await HUB.saveEstimateData(Cx.kids[1], { pageCount: 10, complete: true }, { actorId: mgr.id, actorName: 'Mgr' });
    await HUB.saveEstimateData(Cx.kids[2], { pageCount: 5, complete: true }, { actorId: mgr.id, actorName: 'Mgr' });
    var r2 = await HUB.readiness(Cx.parentId);
    ok('C6 at m of m the meter is ready', r2.n === 3 && r2.m === 3 && r2.ready === true);
    ok('C7 …and it carries Verify ≠ Approve in the SERVER’s words, so no screen has to invent them',
      /VERIFY/.test(r2.armingRule) && /REQUESTOR approves/.test(r2.armingRule));

    var armed = await req('POST', '/api/mrr/' + Cx.taskId + '/generate-estimate', {});
    ok('C8 at m of m it arms', armed.status === 200 && armed.body.armed === true);
    var estTask = await db.get('SELECT * FROM tasks WHERE id = ?', [armed.body.estimateTaskId]);
    ok('C9 …by raising the ORDINARY estimate task on the MASTER record — one estimate for the request, ' +
       'through the standard engine, not a sum of item prices',
      !!estTask && estTask.type === 'estimate' && estTask.request_id === Cx.parentId);
    var armHist = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'MRR_ESTIMATE_ARMED'", [Cx.parentId]);
    ok('C10 …carrying the gathered figures into the worksheet’s history rather than re-deriving them',
      !!armHist && /Gathered figures/.test(armHist.notes));
    var armAgain = await req('POST', '/api/mrr/' + Cx.taskId + '/generate-estimate', {});
    ok('C11 arming twice does not raise a second estimate task — one estimate for the master record',
      armAgain.status === 200 && armAgain.body.estimateTaskId === armed.body.estimateTaskId);

    // A CLOSED item is not waiting on anybody's numbers. A meter that can never reach m is a meter nobody
    // trusts, so `m` counts LIVE items.
    var Cy = await makeMrr(TAG + 'CY', 3, { departmentId: TEAM, manager: mgr.id });
    await db.run("UPDATE requests SET status = 'closed', stage = 'closed' WHERE id = ?", [Cy.kids[2]]);
    var rLive = await HUB.readiness(Cy.parentId);
    ok('C12 an ENDED item drops out of the denominator — the meter counts live work', rLive.m === 2);

    // ================================================================================================
    console.log('\n=== D. DESIGNATION IS NOT A DENIAL ===');
    var D = await makeMrr(TAG + 'D', 2, { departmentId: TEAM, manager: mgr.id });
    var noGrounds = await req('POST', '/api/mrr/item/' + D.kids[0] + '/designate-denial', {});
    ok('D1 a designation with no grounds is refused — legal reviews the grounds, not the label',
      noGrounds.status === 422 && noGrounds.body.code === 'GROUNDS_REQUIRED');

    var des = await req('POST', '/api/mrr/item/' + D.kids[0] + '/designate-denial',
      { grounds: 'Attorney-client privilege over the settlement memorandum.' });
    ok('D2 with grounds it designates', des.status === 200 && des.body.designated === true);
    var lr = await db.get('SELECT * FROM tasks WHERE id = ?', [des.body.legalTaskId]);
    ok('D3 …by spawning a LEGAL REVIEW task on the item', !!lr && lr.type === 'legal_review' && lr.request_id === D.kids[0]);
    var afterDes = await db.get('SELECT status, stage, closure_reason, mrr_denial_designated FROM requests WHERE id = ?', [D.kids[0]]);
    ok('D4 …AND THE ITEM IS NOT DENIED. It is open, unclosed, with no closure reason. This is the assertion ' +
       'that fails the day somebody “helpfully” closes it here',
      afterDes.status === 'active' && afterDes.stage !== 'closed' && !afterDes.closure_reason);
    ok('D5 …the flag stands so the bar can carry the tag', Number(afterDes.mrr_denial_designated) === 1);
    var desHist = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'MRR_DENIAL_DESIGNATED'", [D.kids[0]]);
    ok('D6 …and the record says in words that a designation is not a denial',
      !!desHist && /not a denial/i.test(desHist.notes));
    var twice = await req('POST', '/api/mrr/item/' + D.kids[0] + '/designate-denial', { grounds: 'again' });
    ok('D7 designating twice is refused — one item, one referral', twice.status === 409);
    var withdrawn = await req('POST', '/api/mrr/item/' + D.kids[0] + '/withdraw-designation', { note: 'Reconsidered.' });
    var afterW = await db.get('SELECT mrr_denial_designated, mrr_denial_grounds FROM requests WHERE id = ?', [D.kids[0]]);
    ok('D8 a withdrawn designation clears the flag but KEEPS the grounds — a position taken and ' +
       'reconsidered is part of the history',
      withdrawn.status === 200 && Number(afterW.mrr_denial_designated) === 0 && !!afterW.mrr_denial_grounds);

    // ================================================================================================
    console.log('\n=== E. THE FULFILLING-RECORD AUTO-COMPLETE, PER ITEM ===');
    var E = await makeMrr(TAG + 'E', 3, { departmentId: TEAM, manager: mgr.id });
    // The requestor's own signal, captured at submit — R9's, not a new one.
    await db.run('INSERT INTO request_search_intents (id, request_id, seq, description, intent) VALUES (?,?,?,?,?)',
      [uuidv4(), E.kids[0], 1, 'the award notice I attached is the contract I mean', 'complete']);
    await db.run('INSERT INTO request_search_intents (id, request_id, seq, description, intent) VALUES (?,?,?,?,?)',
      [uuidv4(), E.kids[1], 1, 'search for more as well', 'search_more']);

    var appliedE = await HUB.autoCompleteFulfilledSearch(E.kids[0], { actorName: 'System' });
    ok('E1 an item the requestor marked as FULFILLED has its search auto-completed on arrival', appliedE.applied === true);
    var e0 = await HUB.activities(E.kids[0]);
    var e0search = e0.filter(function (a) { return a.activity === 'search'; })[0];
    ok('E2 …with the basis recorded as the requestor’s selection, not as a person’s work',
      e0search.status === 'complete' && e0search.completion_basis === 'fulfilling_record');
    ok('E3 …and it completes the SEARCH ONLY — a requestor’s selection cannot answer a staff judgement ' +
       'about redaction or price',
      e0.filter(function (a) { return a.activity === 'redaction'; })[0].status === 'not_started' &&
      e0.filter(function (a) { return a.activity === 'estimate'; })[0].status === 'not_started');

    var notE = await HUB.autoCompleteFulfilledSearch(E.kids[1], { actorName: 'System' });
    ok('E4 `search_more` is NOT fulfilment — the requestor asked for more, so nothing auto-completes',
      notE.applied === false && notE.reason === 'no_fulfilling_intent');
    var e2 = await HUB.activities(E.kids[2]);
    ok('E5 …and one item’s selection never speaks for another item',
      e2.filter(function (a) { return a.activity === 'search'; })[0].status === 'not_started');
    var eHist = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'MRR_SEARCH_AUTO_COMPLETED'", [E.kids[0]]);
    ok('E6 …and the auto-complete says whose act it was — the requestor’s own words at submit',
      !!eHist && /nothing was inferred/i.test(eHist.notes));
    var eStage = await stageOf(E.kids[0]);
    ok('E7 …and it, too, advanced no stage', eStage.stage === 'record_search' && eStage.status === 'active');

    // ================================================================================================
    console.log('\n=== F. ONE REQUEST, ONE VOICE ===');
    var F = await makeMrr(TAG + 'F', 2, { departmentId: TEAM, manager: mgr.id });
    await HUB.spawnActivity(F.kids[0], 'search', { assigneeId: worker.id, actorId: mgr.id });
    var fRow = await HUB.getActivity(F.kids[0], 'search');

    var strangerDefect = await req('POST', '/api/mrr/item/' + F.kids[0] + '/mark-defect', { reason: 'vague' }, STRANGER_TOKEN);
    ok('F1 the contact-the-requestor write is MANAGER-ONLY at the API — a rule enforced only in JSX is a ' +
       'rule one careless render removes',
      strangerDefect.status === 403 && strangerDefect.body.code === 'NOT_THE_MANAGER');

    var actView = await req('GET', '/api/mrr/activity-task/' + fRow.task_id, null, WORKER_TOKEN);
    ok('F2 the assignee’s activity view names the REQUEST MANAGER to email…',
      actView.status === 200 && !!actView.body.requestManager && /one voice/i.test(actView.body.oneVoice));
    var viewJson = JSON.stringify(actView.body);
    ok('F3 …and carries no requestor address anywhere in its payload — you cannot render a control for an ' +
       'address the screen was never given',
      viewJson.indexOf('bw6@example.com') < 0);
    ok('F4 …and states, before any button is pressed, that completing it advances nothing',
      /advances no stage/i.test(actView.body.neverAdvances));
    ok('F5 …and hands the assignee the requestor’s own attachments for THIS item — they ride the item, ' +
       'not the master record', !!actView.body.attachments && /ride this item/i.test(actView.body.attachments.ridesWithItem));

    var mgrMaster = await req('GET', '/api/mrr/' + F.taskId + '/master');
    ok('F6 the MANAGER’s master screen is the one place contact-requestor lives',
      mgrMaster.status === 200 && mgrMaster.body.oneVoice.contactRequestorHere === true);
    var strangerMaster = await req('GET', '/api/mrr/' + F.taskId + '/master', null, STRANGER_TOKEN);
    ok('F7 …and anybody else is told to email the manager instead of the requestor',
      strangerMaster.status === 200 && strangerMaster.body.oneVoice.contactRequestorHere === false &&
      /Email them/i.test(strangerMaster.body.oneVoice.note));

    // ================================================================================================
    console.log('\n=== G. THE PARENT STATE IS READ FROM deriveParent, NEVER RECOMPUTED ===');
    var Gx = await makeMrr(TAG + 'G', 2, { departmentId: TEAM, manager: mgr.id });
    var hubSrcG = hubSrc;
    ok('G1 SOURCE GUARD — mrrHub never writes a parent stage or status. §5.8: a parent is never closed by ' +
       'hand, and a derived state that two modules compute is two states',
      !/(DISP|disposition)\.deriveParent\s*\(/.test(hubSrcG) && !/UPDATE requests SET (stage|status)/.test(hubSrcG));

    var openRead = await HUB.master(Gx.parentId);
    ok('G2 with live items the hub reports In Process, and LABELS it derived',
      openRead.parent.state === 'in_process' && openRead.parent.stateIsDerived === true);

    await db.run("UPDATE requests SET status = 'closed', stage = 'closed', closure_reason = 'fulfilled' WHERE id = ?", [Gx.kids[0]]);
    await db.run("UPDATE requests SET status = 'closed', stage = 'closed', closure_reason = 'fulfilled' WHERE id = ?", [Gx.kids[1]]);
    var derived = await DISP.deriveParent(Gx.kids[1]);
    ok('G3 disposition.deriveParent — not the hub — closes the parent when every item has ended',
      derived.derived === true && derived.parentState === 'complete');
    var completeRead = await HUB.master(Gx.parentId);
    ok('G4 …and the hub REPORTS what the derivation left behind', completeRead.parent.state === 'complete');

    await db.run("UPDATE tasks SET status = 'cancelled' WHERE request_id = ? AND type = 'mrr_management'", [Gx.parentId]);
    await db.run("UPDATE requests SET status = 'active', stage = 'record_search', closure_reason = NULL WHERE id = ?", [Gx.kids[0]]);
    var underived = await DISP.deriveParent(Gx.kids[0]);
    ok('G5 a reopened item UN-DERIVES the parent, and reactivates the MRR task with it — a live child with ' +
       'no hub is a stranded item',
      underived.parentState === 'in_process' && underived.reactivated === true);
    var backTask = await db.get("SELECT status FROM tasks WHERE request_id = ? AND type = 'mrr_management'", [Gx.parentId]);
    ok('G6 …the hub the associate works from is open again', backTask.status === 'open');
    var reRead = await HUB.master(Gx.parentId);
    ok('G7 …and the hub follows, without recomputing anything', reRead.parent.state === 'in_process');

    // ================================================================================================
    console.log('\n=== H. PER-CHILD RELEASE — BOTH GATES, AND THE PIPELINE STAYS SHUT ===');
    var H = await makeMrr(TAG + 'H', 2, { departmentId: TEAM, manager: mgr.id });

    // MRR STAYS OUT OF THE PIPELINE. Asserted against autoRelease itself, because BW6 widening it would be
    // the quietest possible regression: nothing would look wrong until a city's records shipped themselves.
    var ev = await AR.evaluate(H.kids[0]);
    var nonMrr = ev.conditions.filter(function (c) { return c.code === 'NON_MRR'; })[0];
    ok('H1 the auto-release pipeline still refuses an MRR item outright…', nonMrr && nonMrr.ok === false);
    ok('H2 …in the words that reserve the act for the Request Manager', /Request Manager/.test(nonMrr.text));
    // FORCED past the knob deliberately: the question is not "is the pipeline switched on", it is "would
    // it ship an MRR if it were". It would not, and that is the condition BW6 must never widen.
    var ran = await AR.run(H.kids[0], { force: true });
    ok('H3 …and even FORCED past the city knob, the pipeline will not ship one item of an MRR',
      ran.acted === false && ran.reason === 'mrr');

    var relSt = await HUB.releaseState(H.kids[0]);
    ok('H4 the per-item gate reads with NO estimate as “nothing is owed on it” — not as a block',
      relSt.gate.hasEstimate === false && relSt.canRelease === true);
    ok('H5 …and says out loud that an MRR never auto-ships — this act is the manager’s, behind the funds gate',
      /never auto-ships/.test(relSt.pipelineNote) && /Request Manager/.test(relSt.pipelineNote));

    // THE RM HOLD. Not a payment hold, and never a hold nobody can explain.
    var noNote = await req('POST', '/api/mrr/item/' + H.kids[0] + '/hold', {});
    ok('H6 a hold with no note is refused — a stop nobody can explain is the unnamed hold the product does ' +
       'not have', noNote.status === 422 && noNote.body.code === 'NOTE_REQUIRED');
    var held = await req('POST', '/api/mrr/item/' + H.kids[0] + '/hold', { note: 'Council briefing Thursday.' });
    ok('H7 …with one, the hold stands', held.status === 200 && held.body.held === true);
    var heldSt = await HUB.releaseState(H.kids[0]);
    ok('H8 …and the item can no longer be released, for the hold’s stated reason',
      heldSt.canRelease === false && heldSt.blockedBy === 'hold' && /Council briefing/.test(heldSt.blockedReason));
    var relRefused = await req('POST', '/api/mrr/item/' + H.kids[0] + '/release', {});
    ok('H9 …and the release endpoint refuses with the SAME words the screen shows — a stale screen cannot ' +
       'get around it', relRefused.status === 409 && /Council briefing/.test(relRefused.body.error));

    // THE PREVENTION GUARD, surfaced verbatim with its citation.
    // The entitlement is a BRANCH-PROFILE fact, not a flag: it comes from the state's own imported research
    // (`Disposition.inst`), which is why "unknown" can never become an entitlement by accident.
    if (jid) await JR.write(jid, 'branches', { branches: { 'Disposition.inst': { active: true } } }, 'bw6-harness');
    await RH.onInstallmentRequest(H.kids[1], { actorName: 'Requester', note: 'as they become ready' });
    var prevented = await HUB.releaseState(H.kids[1]);
    ok('H10 an installment request on file in an entitlement state DISABLES the hold control…',
      prevented.holdControl && prevented.holdControl.canHold === false);
    ok('H11 …with the refusal and its CITATION carried to the screen verbatim, because a paraphrased legal ' +
       'refusal is a different refusal',
      /entitlement/i.test(prevented.holdControl.blockedReason) && prevented.holdControl.citation === RH.CITATION);
    var preventedApi = await req('POST', '/api/mrr/item/' + H.kids[1] + '/hold', { note: 'try anyway' });
    ok('H12 …and the API refuses in the same words, with the citation attached',
      preventedApi.status === 409 && preventedApi.body.code === 'INSTALLMENT_ENTITLEMENT' && !!preventedApi.body.citation);

    // AND THE MONEY GATE IS NOT THE HOLD. Holding a record that owes money must not mention the money.
    ok('H13 a hold is NEVER a payment hold, and says so — money gating is the release gate’s, per §5.9. ' +
       'A hold that grew a balance check would be the bug',
      /never a payment hold/i.test(held.body.neverAPaymentHold || ''));

    var lifted = await req('POST', '/api/mrr/item/' + H.kids[0] + '/lift-hold', { note: 'Briefing done.' });
    var afterLift = await HUB.releaseState(H.kids[0]);
    ok('H14 lifting the hold restores the item’s releasability', lifted.status === 200 && afterLift.canRelease === true);

    // THE MANUAL RELEASE ITSELF — BW5's one writer of `Closed – Delivered`, reached by hand, with the
    // parent's state left to deriveParent.
    var relOk = await req('POST', '/api/mrr/item/' + H.kids[0] + '/release', { note: 'Item ready.' });
    ok('H15 a manager may release ONE item by hand once both gates pass', relOk.status === 200 && relOk.body.released === true);
    var relRow = await db.get('SELECT status, closure_reason, delivered_at FROM requests WHERE id = ?', [H.kids[0]]);
    ok('H16 …through BW5’s single writer, which records the delivery and the ending together',
      relRow.status === 'closed' && !!relRow.delivered_at);
    var relParent = await db.get('SELECT status FROM requests WHERE id = ?', [H.parentId]);
    ok('H17 …and the parent stays In Process while a sibling is live — a parent is never closed by hand',
      relParent.status === 'active');

    // ── CLEANUP BEFORE THE EXIT, NOT IN `finally` ──────────────────────────────────────────────────
    //
    // `process.exit()` does not run a pending `finally`, so a harness that writes JURISDICTION CONFIG and
    // tidies up only in `finally` leaves that config behind for every harness that runs after it. This one
    // writes the branch profile (H10–H12), and a stale `Disposition.inst`-only profile is exactly the kind
    // of residue that makes a LATER harness fail for reasons nobody can find from its own output. So the
    // restore happens HERE, on the success path, and `finally` keeps it only for the error path.
    await restoreConfig();
    console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  } finally {
    await restoreConfig();
  }

  async function restoreConfig() {
    try {
      if (!jid) return;
      if (hadBranches && savedBranches) await JR.write(jid, 'branches', savedBranches, 'bw6-harness-restore');
      else await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, 'branches']);
    } catch (e) { console.error('CLEANUP ERR', e && e.message); }
  }
})();
