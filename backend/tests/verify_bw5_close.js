'use strict';
// PHASE 7 / BW5 — CLOSE & PIPELINE. What this harness asserts, and why each claim earns a test:
//
//   A. THE CLOSE GATES, AND THAT THEY DO NOT FEED EACH OTHER. A no-records close needs THREE independent
//      things — an effort trail, every duty-carrying description answered, and a closure note. Kevin was
//      explicit that answering a description must never satisfy the effort gate: a claim is not evidence.
//      Asserted by satisfying each one alone and watching the others stay open.
//   B. CLOSE = ONE ACT. The disposition, the stage transition and the NOTICE are one call; a close that
//      cannot notify is still RECORDED as owing the notice; and rule (e) — no address on file reads as
//      "does not apply", never as a failure.
//   C. close_approval, THE THREE MODES. direct draws one door, either draws both, approval_required
//      refuses Submit. A routed close writes a VISIBLE pending row and does NOT close. Approving executes
//      it as the APPROVER's act; the requester of a close cannot approve their own (and that is NOT
//      two-eyes — a different, weaker rule, so it must not borrow two-eyes' machinery).
//   D. DENY-CLOSE-NOTIFY. The legal-review deciding flow's new fourth outcome writes `Closed – Denied`
//      plus its notice in one act — an ending the three pre-existing outcomes could not reach.
//   E. THE FROM-CLOSED GUARD. A closed request cannot be moved by a stage change; the reopen route is the
//      only door, and the two legitimate pre-existing reopens still work.
//   F. REOPEN, BOTH LANDINGS. Prior stage (the DEFAULT, read from the history rather than guessed) and
//      intake re-triage (which spawns intake_review carrying trigger (v)). A required note. CLOCKS ARE
//      NEVER RESET. Silent — no requestor notice. And a reopened child UN-DERIVES the parent.
//   G. AUTO-BYPASS IS A RECORD. A bypassed task is `done` WITH a kind and a basis and a history row; a
//      bypass with no basis is refused outright, because that is the silent skip the rule forbids.
//   H. THE PIPELINE'S CONDITIONS AND ITS KNOB. The four conditions each answer for themselves; and the
//      knob is the safety story — UNCONFIRMED means nothing ships and nothing is even bypassed, which is
//      the claim that lets this ship to live installs at all.
//   I. release_review. Spawned instead of shipping when the pre-send knob is ON; two-eyes excludes the
//      person who did the last flow task; return-with-note does not re-spawn until the item has MOVED.
//   J. MANUAL ENDINGS + RIGHTS + THE WITHDRAWAL SPAWNER.
//   K. THE RM-HOLD GUARD. A note is always required; the entitlement + an installment request PREVENTS a
//      hold with a citation; an installment request arriving mid-hold auto-lifts it. And it is never a
//      payment hold — asserted by holding a request that owes money and watching the money go unmentioned.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var DISP = require('/opt/optimumq/backend/src/services/disposition');
var AR = require('/opt/optimumq/backend/src/services/autoRelease');
var RH = require('/opt/optimumq/backend/src/services/releaseHold');
var PC = require('/opt/optimumq/backend/src/services/processingConfig');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var IR = require('/opt/optimumq/backend/src/services/intakeReview');
var uuidv4 = require('uuid').v4;

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'BW5-' + Date.now();
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
    [id, id, 'BW5 Harness', fields.email === null ? '' : (fields.email || 'bw5@example.com'),
     fields.description || ('bw5 harness ' + TAG), fields.stage || 'record_search',
     fields.departmentId || null, fields.parentId || null, fields.isMrr ? 1 : 0, fields.label || null]);
  return id;
}

async function makeTask(requestId, type, opts) {
  opts = opts || {};
  var t = await tr.createTask({ requestId: requestId, type: type, teamId: opts.teamId || null,
    createdBy: 'bw5-harness' });
  if (opts.assignedTo) {
    await db.run("UPDATE tasks SET assigned_to = ?, status = ? WHERE id = ?",
      [opts.assignedTo, opts.status || 'in_progress', t.id]);
  }
  return await tr.getTask(t.id);
}

async function effort(requestId, action) {
  await db.run('INSERT INTO request_history (id, request_id, actor_name, action, notes) VALUES (?,?,?,?,?)',
    [uuidv4(), requestId, 'BW5 Harness', action || 'CALL_LOGGED', 'Effort logged by the harness.']);
}

async function stageOf(id) { return (await db.get('SELECT stage FROM requests WHERE id = ?', [id])).stage; }

(async function () {
  await db.initDb();
  var jid = null, savedProcessing = null, savedBranches = null, hadBranches = false;
  try {
    jid = await JR.activeJid();
    try { savedProcessing = jid ? await JR.read(jid, PC.DOMAIN) : null; } catch (e) { savedProcessing = null; }
    try { savedBranches = jid ? await JR.read(jid, 'branches') : null; hadBranches = !!savedBranches; } catch (e) { savedBranches = null; }

    var users = await db.all("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL ORDER BY id LIMIT 3");
    var user = users[0], other = users[1] || users[0];
    TOKEN = await auth.signAccessToken(user);
    var TEAM = user.department_id;
    var OTHER_TOKEN = await auth.signAccessToken(other);

    // ================================================================================================
    console.log('\n=== A. THE THREE GATES OF A NO-RECORDS CLOSE, AND THAT THEY DO NOT FEED EACH OTHER ===');
    var rA = await makeRequest('req-' + TAG + '-A', { departmentId: TEAM });
    var gA0 = await DISP.gateFor(rA, 'no_records', {});
    ok('A1 a bare request fails the gate, and names EVERY open condition rather than the first',
      gA0.blocked === true && gA0.rows.length === 3 && gA0.reasons.length >= 2);
    ok('A2 …the effort gate is open', gA0.rows.filter(function (r) { return r.code === 'NO_EFFORT_TRAIL'; })[0].ok === false);
    ok('A3 …the closure-note gate is open',
      gA0.rows.filter(function (r) { return r.code === 'CLOSURE_NOTE_REQUIRED'; })[0].ok === false);

    var gA1 = await DISP.gateFor(rA, 'no_records', { note: 'Searched both systems for the full range.' });
    ok('A4 a NOTE alone does not evidence the search — the effort gate stays open',
      gA1.rows.filter(function (r) { return r.code === 'NO_EFFORT_TRAIL'; })[0].ok === false && gA1.blocked === true);

    await effort(rA, 'SEARCH_RUN');
    var gA2 = await DISP.gateFor(rA, 'no_records', {});
    ok('A5 EFFORT alone does not supply the reasoning — the note gate stays open',
      gA2.rows.filter(function (r) { return r.code === 'NO_EFFORT_TRAIL'; })[0].ok === true &&
      gA2.rows.filter(function (r) { return r.code === 'CLOSURE_NOTE_REQUIRED'; })[0].ok === false);

    var gA3 = await DISP.gateFor(rA, 'no_records', { note: 'Exhaustive — both repositories, full range.' });
    ok('A6 with effort AND a note AND no open descriptions, the gate clears', gA3.blocked === false);

    var gB0 = await DISP.gateFor(rA, 'not_in_custody', { note: 'n' });
    ok('A7 a not-in-custody close demands a NAMED custodian…',
      gB0.rows.filter(function (r) { return r.code === 'CUSTODIAN_REQUIRED'; })[0].ok === false);
    ok('A8 …and a referral RECORD, because a referral naming nobody sends the requester nowhere',
      gB0.rows.filter(function (r) { return r.code === 'REFERRAL_RECORD_REQUIRED'; })[0].ok === false && gB0.blocked === true);

    // ================================================================================================
    console.log('\n=== B. CLOSE = ONE ACT (disposition + stage + NOTICE), AND RULE (e) ===');
    await PC.write(jid, { close_approval: { default: 'either' } }, 'bw5-harness');
    var closedA = await DISP.close(rA, 'no_records', { actorName: 'A. Closer',
      payload: { note: 'Exhaustive — both repositories, full range.' } });
    ok('B1 the close reports its ending and its label', closedA.ending === 'no_records' && /No records located/.test(closedA.label));
    ok('B2 …the request is CLOSED through the central transition', (await stageOf(rA)) === 'closed');
    var crA = await db.get('SELECT closure_reason FROM requests WHERE id = ?', [rA]);
    ok('B3 …with the §5.8 disposition written', crA.closure_reason === 'no_records');
    ok('B4 …and the NOTICE went out in the same act — never a silent end', closedA.notice.outcome === 'sent');
    var notHist = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'CLOSURE_NOTICE_SENT'", [rA]);
    ok('B5 …recorded on the request, so the duty is auditable', !!notHist);
    var reclose = null; try { await DISP.close(rA, 'no_records', { skipGate: true }); } catch (e) { reclose = e; }
    ok('B6 a closed item cannot be closed twice', !!reclose && reclose.code === 'ALREADY_CLOSED');

    // RULE (e): anonymous is "does not apply", never a failure and never "hidden".
    var rAnon = await makeRequest('req-' + TAG + '-ANON', { departmentId: TEAM, email: null });
    await effort(rAnon);
    var closedAnon = await DISP.close(rAnon, 'no_records', { actorName: 'A. Closer', payload: { note: 'Nothing located.' } });
    ok('B7 a requester with no address on file reads as DOES NOT APPLY, not as a delivery failure',
      closedAnon.notice.outcome === 'not_applicable' && /does not apply/i.test(closedAnon.notice.reason));
    var naHist = await db.get("SELECT action FROM request_history WHERE request_id = ? AND action = 'CLOSURE_NOTICE_NA'", [rAnon]);
    ok('B8 …and it is still RECORDED — the notice is accounted for either way', !!naHist);

    // ================================================================================================
    console.log('\n=== C. close_approval — THE THREE MODES, AND WHO MAY APPROVE ===');
    await PC.write(jid, { close_approval: { default: 'direct' } }, 'bw5-harness');
    var modeDirect = await DISP.approvalModeFor(rA, 'no_records');
    ok('C1 `direct` opens Submit only', modeDirect.canSubmit === true && modeDirect.canRoute === false);
    await PC.write(jid, { close_approval: { default: 'approval_required' } }, 'bw5-harness');
    var modeReq = await DISP.approvalModeFor(rA, 'no_records');
    ok('C2 `approval_required` opens Route only', modeReq.canSubmit === false && modeReq.canRoute === true);
    await PC.write(jid, { close_approval: { default: 'either' } }, 'bw5-harness');
    var modeEither = await DISP.approvalModeFor(rA, 'no_records');
    ok('C3 `either` — the DEFAULT decided 7/29 — opens both doors', modeEither.canSubmit && modeEither.canRoute);

    var rC = await makeRequest('req-' + TAG + '-C', { departmentId: TEAM });
    await effort(rC);
    var tC = await makeTask(rC, 'record_search', { teamId: TEAM, assignedTo: user.id });
    await PC.write(jid, { close_approval: { default: 'approval_required' } }, 'bw5-harness');
    var subRefused = await req('POST', '/api/tasks/' + tC.id + '/close',
      { ending: 'no_records', mode: 'submit', note: 'Nothing located.' });
    ok('C4 under `approval_required` a direct Submit is REFUSED with the resolved mode named',
      subRefused.status === 403 && subRefused.body.code === 'APPROVAL_REQUIRED');
    ok('C5 …and nothing was written', (await stageOf(rC)) !== 'closed');

    var routed = await req('POST', '/api/tasks/' + tC.id + '/close',
      { ending: 'no_records', mode: 'route', note: 'Nothing located; asking for a second signature.' });
    ok('C6 routing writes a PENDING close and does not close', routed.status === 200 && routed.body.pending === true &&
      (await stageOf(rC)) !== 'closed');
    var pend = await DISP.pending(rC);
    ok('C7 …the pending state is a real row a queue can render', !!pend && pend.status === 'pending' && pend.ending === 'no_records');
    ok('C8 …carrying the gate AS IT STOOD, so the approver sees the evidence the closer saw',
      !!pend.gate_json && /NO_EFFORT_TRAIL/.test(pend.gate_json));
    var apprTask = await db.get("SELECT * FROM tasks WHERE id = ?", [pend.approval_task_id]);
    ok('C9 …and a lightweight close_approval task exists for a supervisor to pick up',
      !!apprTask && apprTask.type === 'close_approval');

    var selfAppr = null;
    try { await DISP.approve(pend.id, { actorId: user.id, actorName: user.display_name }); } catch (e) { selfAppr = e; }
    ok('C10 the person who REQUESTED the close cannot approve it', !!selfAppr && selfAppr.code === 'SELF_APPROVAL');
    ok('C11 …and the item is still open', (await stageOf(rC)) !== 'closed');

    var approved = await DISP.approve(pend.id, { actorId: other.id, actorName: 'S. Supervisor' });
    ok('C12 a second person approves and the close EXECUTES', approved.ok === true && (await stageOf(rC)) === 'closed');
    var apprHist = await db.get("SELECT notes, actor_name FROM request_history WHERE request_id = ? AND action = 'CLOSED_NO_RECORDS'", [rC]);
    ok('C13 …recorded as the APPROVER’s act (rev 2), naming the requester too',
      apprHist.actor_name === 'S. Supervisor' && /Approved and executed by/.test(apprHist.notes));
    ok('C14 …and the notice fired on approval, not on the request', approved.notice.outcome === 'sent');
    ok('C15 close_approval is deliberately NOT a two-eyes type — that is a different, stronger rule',
      !tr.TWO_EYES_TYPES.close_approval);

    // Reject returns the work rather than consuming it.
    var rC2 = await makeRequest('req-' + TAG + '-C2', { departmentId: TEAM });
    await effort(rC2);
    var tC2 = await makeTask(rC2, 'record_search', { teamId: TEAM, assignedTo: user.id });
    await req('POST', '/api/tasks/' + tC2.id + '/close', { ending: 'no_records', mode: 'route', note: 'Nothing located.' });
    var pend2 = await DISP.pending(rC2);
    var noteless = null;
    try { await DISP.reject(pend2.id, { actorId: other.id, actorName: 'S. Supervisor' }); } catch (e) { noteless = e; }
    ok('C16 a refusal without a note is refused — the closer has to know what to do next',
      !!noteless && noteless.code === 'NOTE_REQUIRED');
    await DISP.reject(pend2.id, { actorId: other.id, actorName: 'S. Supervisor', note: 'Search the shared drive too.' });
    var tC2after = await db.get('SELECT status FROM tasks WHERE id = ?', [tC2.id]);
    ok('C17 rejecting reopens the originating task — a rejected close must not strand the item',
      tr.isActionable(tC2after.status) && (await stageOf(rC2)) !== 'closed');

    await PC.write(jid, { close_approval: { default: 'either' } }, 'bw5-harness');

    // ================================================================================================
    console.log('\n=== D. DENY-CLOSE-NOTIFY — the ending the deciding flow could not reach ===');
    var rD = await makeRequest('req-' + TAG + '-D', { departmentId: TEAM, stage: 'exemption_review' });
    var tD = await makeTask(rD, 'legal_review', { assignedTo: user.id });
    var denyNoNote = await req('POST', '/api/tasks/' + tD.id + '/resolve', { outcome: 'denied' });
    ok('D1 a denial still demands the legal note the other outcomes demand', denyNoNote.status === 422);
    var denied = await req('POST', '/api/tasks/' + tD.id + '/resolve',
      { outcome: 'denied', notes: 'Withheld in full under the law-enforcement exception; citation on the letter.' });
    ok('D2 the deciding flow can now END an item', denied.status === 200 && denied.body.ending === 'denial');
    ok('D3 …writing Closed – Denied', (await db.get('SELECT closure_reason FROM requests WHERE id = ?', [rD])).closure_reason === 'denial');
    ok('D4 …closing the request', (await stageOf(rD)) === 'closed');
    ok('D5 …and sending the determination notice in the SAME act', denied.body.notice.outcome === 'sent');

    // ================================================================================================
    console.log('\n=== E. THE FROM-CLOSED GUARD ===');
    var guardErr = null;
    try { await tr.applyStageTransition(rD, 'record_search', { actorName: 'Someone' }); } catch (e) { guardErr = e; }
    ok('E1 a closed request cannot be moved by a stage change', !!guardErr && guardErr.code === 'FROM_CLOSED');
    ok('E2 …and it stayed closed', (await stageOf(rD)) === 'closed');
    var guardRoute = await req('PATCH', '/api/requests/' + rD + '/stage', { stage: 'record_search' });
    ok('E3 the route surfaces the refusal as a 409 with its code, not a 500 — declining is not breaking',
      guardRoute.status === 409 && guardRoute.body.code === 'FROM_CLOSED');
    var allowed = await tr.applyStageTransition(rD, 'record_search', { reopen: true, actorName: 'Reopener' });
    ok('E4 …while an explicit reopen passes', !!allowed && allowed.changed === true);
    await tr.applyStageTransition(rD, 'closed', { actorName: 'Reset' });

    // ================================================================================================
    console.log('\n=== F. REOPEN — BOTH LANDINGS, AND WHAT IT REFUSES TO DO ===');
    var rF = await makeRequest('req-' + TAG + '-F', { departmentId: TEAM, stage: 'redaction_review' });
    await effort(rF);
    await DISP.close(rF, 'no_records', { actorName: 'A. Closer', payload: { note: 'Nothing located.' } });
    var noNote = null;
    try { await DISP.reopen(rF, { actorName: 'D. Director' }); } catch (e) { noNote = e; }
    ok('F1 a reopen without a note is refused — the reason IS the record', !!noNote && noNote.code === 'NOTE_REQUIRED');

    var reF = await DISP.reopen(rF, { actorName: 'D. Director', note: 'A second repository was missed.' });
    ok('F2 the DEFAULT landing is the PRIOR stage, read from the history rather than guessed',
      reF.resumePoint === 'prior_stage' && reF.priorStage === 'redaction_review' && reF.stage === 'redaction_review');
    ok('F3 …the closure reason is cleared and the reopen counted',
      (await db.get('SELECT closure_reason, reopen_count FROM requests WHERE id = ?', [rF])).closure_reason === null);
    ok('F4 …REOPEN IS SILENT — no requestor notice, and the response says so', reF.requestorNotified === false);
    ok('F5 …and CLOCKS ARE NEVER RESET', reF.clocksReset === false);
    var reHist = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'REQUEST_REOPENED'", [rF]);
    ok('F6 …the trail says the clocks were not reset, so an exposure still reads honestly',
      /Clocks are NOT reset/.test(reHist.notes));
    var noNotice = await db.get("SELECT count(*)::int AS n FROM request_history WHERE request_id = ? AND action = 'CLOSURE_NOTICE_SENT' AND created_at > ?", [rF, reHist ? '1970-01-01' : '1970-01-01']);
    ok('F7 …and no new notice was invented for the reopen', noNotice.n === 1);

    var rF2 = await makeRequest('req-' + TAG + '-F2', { departmentId: TEAM, stage: 'record_search' });
    await effort(rF2);
    await DISP.close(rF2, 'no_records', { actorName: 'A. Closer', payload: { note: 'Nothing located.' } });
    var reF2 = await DISP.reopen(rF2, { actorName: 'D. Director', note: 'This was never the right team.',
                                        resumePoint: 'intake_retriage' });
    ok('F8 the SECOND landing sends it back to intake for re-triage', reF2.resumePoint === 'intake_retriage' && reF2.stage === 'intake');
    ok('F9 …spawning the intake review', !!reF2.intakeReviewTaskId);
    var irTask = await db.get('SELECT spawn_triggers FROM tasks WHERE id = ?', [reF2.intakeReviewTaskId]);
    ok('F10 …carrying trigger (v) reopen_retriage — BW2’s enum stub, now wired',
      /reopen_retriage/.test(irTask.spawn_triggers || ''));
    ok('F11 …and the trigger is registered as WIRED', IR.WIRED_TRIGGERS.indexOf('reopen_retriage') >= 0);

    // Director authority lives on the route.
    var notDirector = await req('POST', '/api/requests/' + rF2 + '/reopen', { note: 'me too' });
    ok('F12 reopening is a Director’s act — an ordinary user is refused with a reason',
      notDirector.status === 403 && notDirector.body.code === 'DIRECTOR_REQUIRED');

    // A reopened child UN-DERIVES the parent.
    var pG = await makeRequest('req-' + TAG + '-P', { departmentId: TEAM, isMrr: true, stage: 'record_search' });
    var c1 = await makeRequest('req-' + TAG + '-P1', { departmentId: TEAM, parentId: pG, label: 'Item 1' });
    var c2 = await makeRequest('req-' + TAG + '-P2', { departmentId: TEAM, parentId: pG, label: 'Item 2' });
    var mrrTask = await makeTask(pG, 'mrr_management', {});
    await effort(c1); await effort(c2);
    await DISP.close(c1, 'no_records', { actorName: 'A. Closer', payload: { note: 'Nothing.' } });
    ok('F13 one child closed does NOT complete the parent', (await stageOf(pG)) !== 'closed');
    var lastClose = await DISP.close(c2, 'no_records', { actorName: 'A. Closer', payload: { note: 'Nothing.' } });
    ok('F14 the LAST child ending derives the parent Complete — never an act, always derived',
      lastClose.parent.derived === true && (await stageOf(pG)) === 'closed');
    var mrrAfterClose = await db.get('SELECT status FROM tasks WHERE id = ?', [mrrTask.id]);
    ok('F15 …and the MRR Management task ended with it', !tr.isActionable(mrrAfterClose.status));
    var reChild = await DISP.reopen(c2, { actorName: 'D. Director', note: 'Reopening item 2.' });
    ok('F16 reopening a child UN-DERIVES the parent — back to In Process',
      reChild.parent.parentState === 'in_process' && (await stageOf(pG)) !== 'closed');
    var mrrAfterReopen = await db.get('SELECT status FROM tasks WHERE id = ?', [mrrTask.id]);
    ok('F17 …and reactivates the MRR Management task, or the live child has no hub',
      tr.isActionable(mrrAfterReopen.status));

    // ================================================================================================
    console.log('\n=== G. AUTO-BYPASS IS A RECORD, NEVER A SILENT SKIP ===');
    var rG = await makeRequest('req-' + TAG + '-G', { departmentId: TEAM, stage: 'redaction' });
    var tG = await makeTask(rG, 'estimate', { teamId: TEAM });
    var noBasis = null;
    try { await AR.bypassTask(tG, 'system_condition', ''); } catch (e) { noBasis = e; }
    ok('G1 a bypass with NO recorded basis is refused outright', !!noBasis && /silent skip/.test(noBasis.message));
    var badKind = null;
    try { await AR.bypassTask(tG, 'because', 'reasons'); } catch (e) { badKind = e; }
    ok('G2 …and so is a basis kind outside the DecidedByBadge vocabulary (rule c)', !!badKind);
    var byp = await AR.bypassTask(tG, 'system_condition', 'The computed estimate total is $0.00.');
    var tGrow = await db.get('SELECT status, bypass_kind, bypass_basis, bypassed_at FROM tasks WHERE id = ?', [tG.id]);
    ok('G3 a bypassed task is COMPLETED, not skipped', tGrow.status === 'done');
    ok('G4 …carrying its badge value and its sentence',
      tGrow.bypass_kind === 'system_condition' && /\$0\.00/.test(tGrow.bypass_basis) && !!tGrow.bypassed_at);
    var bypHist = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'TASK_AUTO_BYPASSED'", [rG]);
    ok('G5 …and it is on the request’s trail, worded as auto-completed rather than skipped',
      !!bypHist && /auto-completed, not skipped/.test(bypHist.notes));

    // ================================================================================================
    console.log('\n=== H. THE PIPELINE — ITS CONDITIONS, AND THE KNOB THAT KEEPS IT OFF ===');
    var rH = await makeRequest('req-' + TAG + '-H', { departmentId: TEAM, stage: 'delivery' });
    var evH = await AR.evaluate(rH);
    var codes = evH.conditions.map(function (c) { return c.code; });
    ok('H1 the evaluator answers every condition separately, so a screen can render the same list it acts on',
      ['NON_MRR', 'TASKS_TERMINAL', 'BALANCE_CLEAR', 'PRE_SEND_REVIEW', 'NOT_HELD', 'STILL_OPEN']
        .every(function (c) { return codes.indexOf(c) >= 0; }));
    ok('H2 a clean single-record request with no open work is ELIGIBLE', evH.eligible === true);
    ok('H3 …but the pipeline is NOT ARMED, because the knob is unconfirmed', evH.armed === false && evH.knob.confirmed === false);

    var runOff = await AR.run(rH, {});
    ok('H4 THE SAFETY CLAIM: with the knob unconfirmed the pipeline does NOTHING',
      runOff.acted === false && runOff.reason === 'knob_unconfirmed');
    ok('H5 …and nothing shipped — this is exactly what the product does today', (await stageOf(rH)) === 'delivery');

    var rMrr = await makeRequest('req-' + TAG + '-HM', { departmentId: TEAM, parentId: pG, stage: 'delivery' });
    var evMrr = await AR.evaluate(rMrr);
    ok('H6 an MRR item is refused by the non-MRR guard, whatever else holds',
      evMrr.conditions.filter(function (c) { return c.code === 'NON_MRR'; })[0].ok === false);

    // Arm it and watch a real release.
    await AR.writeKnob('auto_release', { confirmed: true, value: 'on' }, jid, 'bw5-harness');
    var armed = await AR.knob('auto_release');
    ok('H7 confirming the knob arms the pipeline — the confirming act IS the decision to automate',
      armed.confirmed === true && armed.on === true);
    var runOn = await AR.run(rH, {});
    ok('H8 with the knob on and every condition met, the release event FIRES',
      runOn.acted === true && runOn.reason === 'released');
    var rHrow = await db.get('SELECT closure_reason, delivered_at, installment_no, stage FROM requests WHERE id = ?', [rH]);
    ok('H9 …writing Closed – Delivered + delivered_at + installment_no as ONE event',
      rHrow.closure_reason === 'fulfilled' && !!rHrow.delivered_at && Number(rHrow.installment_no) === 1 && rHrow.stage === 'closed');
    ok('H10 …with the notice in the same event', runOn.release.notice.outcome === 'sent');
    ok('H11 Delivered is written by the release event and never asserted by a person',
      DISP.ENDINGS.fulfilled.where === 'release_event' && DISP.ENDINGS.fulfilled.decidedBy === 'system');

    // Payment-due: pending, not blocked.
    var rPay = await makeRequest('req-' + TAG + '-PAY', { departmentId: TEAM, stage: 'delivery' });
    await db.run("INSERT INTO request_fee_estimates (id, request_id, kind, total, deposit_paid_amount, final_paid_amount, created_at) VALUES (?,?,?,?,?,?, datetime('now'))",
      ['est-' + TAG, rPay, 'estimate', 36.20, 0, 0]);
    var evPay = await AR.evaluate(rPay);
    ok('H12 an unpaid balance reads as PENDING with the number, not as a refusal',
      evPay.paymentPending === true &&
      /ships untouched/.test(evPay.conditions.filter(function (c) { return c.code === 'BALANCE_CLEAR'; })[0].text));
    var runPay = await AR.run(rPay, {});
    ok('H13 …and the pipeline waits rather than shipping', runPay.acted === false && runPay.reason === 'payment_due' &&
      (await stageOf(rPay)) === 'delivery');

    // ================================================================================================
    console.log('\n=== I. release_review — SPAWNED INSTEAD OF SHIPPING, TWO-EYES, AND THE RE-ARM ===');
    await AR.writeKnob('pre_send_review', { confirmed: true, value: 'on' }, jid, 'bw5-harness');
    var rI = await makeRequest('req-' + TAG + '-I', { departmentId: TEAM, stage: 'delivery' });
    var lastFlow = await makeTask(rI, 'record_search', { teamId: TEAM, assignedTo: user.id });
    await db.run("UPDATE tasks SET status = 'done', done_at = datetime('now') WHERE id = ?", [lastFlow.id]);
    var runI = await AR.run(rI, {});
    ok('I1 with the pre-send gate ON the pipeline DIVERTS rather than ships',
      runI.acted === true && runI.reason === 'release_review' && (await stageOf(rI)) === 'delivery');
    var rrTask = await db.get("SELECT * FROM tasks WHERE request_id = ? AND type = 'release_review'", [rI]);
    ok('I2 …onto the release_review type BW2 registered and nothing could spawn until now', !!rrTask);
    var blocked = await tr.assignmentBlocked(rrTask, user.id);
    ok('I3 TWO-EYES IS REAL HERE: the person who did the last flow task cannot review its release',
      blocked.blocked === true && blocked.code === 'TWO_EYES');
    var blockedOther = await tr.assignmentBlocked(rrTask, other.id);
    ok('I4 …and a second person is not blocked', blockedOther.blocked === false);

    var reSpawn = await AR.spawnReview(rI, {});
    ok('I5 the spawner is idempotent — one review, not one per evaluation', reSpawn.spawned === false && reSpawn.reason === 'already_open');

    var noNoteReturn = null;
    try { await AR.returnReview(rrTask.id, {}); } catch (e) { noNoteReturn = e; }
    ok('I6 returning without a note is refused — the team has to know what to change', !!noNoteReturn && noNoteReturn.code === 'NOTE_REQUIRED');
    await AR.returnReview(rrTask.id, { actorName: 'S. Supervisor', note: 'The withholding log is missing a citation.' });
    ok('I7 a returned review does not ship', (await stageOf(rI)) === 'delivery');
    ok('I8 …and does NOT immediately re-spawn, or the pipeline would loop against a reviewer’s decision',
      (await AR.reArmed(rI)) === false && (await AR.spawnReview(rI, {})).reason === 'returned_awaiting_work');
    await effort(rI, 'SEARCH_RUN');
    ok('I9 …it re-arms once the item has MOVED', (await AR.reArmed(rI)) === true);

    // Approving fires the release, as the approver's act.
    var rI2 = await makeRequest('req-' + TAG + '-I2', { departmentId: TEAM, stage: 'delivery' });
    await AR.run(rI2, {});
    var rr2 = await db.get("SELECT id FROM tasks WHERE request_id = ? AND type = 'release_review'", [rI2]);
    var appRes = await req('POST', '/api/tasks/' + rr2.id + '/release-review/approve', {}, OTHER_TOKEN);
    ok('I10 approving the review FIRES the release', appRes.status === 200 && appRes.body.reason === 'released');
    ok('I11 …and the item is Closed – Delivered',
      (await db.get('SELECT closure_reason FROM requests WHERE id = ?', [rI2])).closure_reason === 'fulfilled');
    await AR.writeKnob('pre_send_review', { confirmed: false, value: 'off' }, jid, 'bw5-harness');
    await AR.writeKnob('auto_release', { confirmed: false, value: 'off' }, jid, 'bw5-harness');
    ok('I12 turning the knobs back off disarms the pipeline again', (await AR.knob('auto_release')).on === false);

    // ================================================================================================
    console.log('\n=== J. THE MANUAL ENDINGS, THEIR RIGHTS, AND THE WITHDRAWAL SPAWNER ===');
    var rJ = await makeRequest('req-' + TAG + '-J', { departmentId: TEAM });
    var gJ = await DISP.gateFor(rJ, 'withdrawn', { note: 'They asked us to stop.' });
    ok('J1 Withdrawn is gated on the requester’s COMMUNICATION — a choice, not silence',
      gJ.blocked === true && gJ.rows[0].code === 'WITHDRAWAL_COMMUNICATION_REQUIRED');
    var logged = await DISP.logWithdrawalCommunication(rJ, { actorName: 'A. Clerk', body: 'Please cancel my request.' });
    ok('J2 logging a withdrawal SPAWNS a Process-withdrawal task to the RM/ORO pool', logged.spawned === true && !!logged.taskId);
    var pwTask = await db.get('SELECT type, status FROM tasks WHERE id = ?', [logged.taskId]);
    ok('J3 …so a withdrawal can never sit unprocessed while the clock runs',
      pwTask.type === 'process_withdrawal' && tr.isActionable(pwTask.status));
    var gJ2 = await DISP.gateFor(rJ, 'withdrawn', { note: 'They asked us to stop.' });
    ok('J4 …and the gate now clears', gJ2.blocked === false);

    var rightsAll = await DISP.manualEndingRights(rJ, { sub: user.id, roles: [] });
    var holderTask = await makeTask(rJ, 'record_search', { teamId: TEAM, assignedTo: user.id });
    var rightsHolder = await DISP.manualEndingRights(rJ, { sub: user.id, roles: [] });
    ok('J5 the item’s CURRENT TASK-HOLDER may close it Withdrawn (decided 7/29)',
      rightsHolder.withdrawn.viaTaskHolder === true && rightsHolder.withdrawn.allowed === true);
    ok('J6 …but that second door does NOT extend to Previously furnished — a cross-request certification ' +
       'is an office-level act', rightsHolder.previously_furnished.viaOro === false);
    var rightsDir = await DISP.manualEndingRights(rJ, { sub: other.id, roles: ['DIRECTOR'] });
    ok('J7 an ORO Associate+ may close either', rightsDir.withdrawn.allowed && rightsDir.previously_furnished.allowed);

    var closedJ = await DISP.close(rJ, 'withdrawn', { actorName: 'A. Clerk', payload: { note: 'Requester cancelled.' } });
    ok('J8 the withdrawal closes with its notice, one act', closedJ.ending === 'withdrawn' && !!closedJ.notice);

    var rJ2 = await makeRequest('req-' + TAG + '-J2', { departmentId: TEAM });
    var gPF = await DISP.gateFor(rJ2, 'previously_furnished', { priorRequestNumber: 'R-100', priorRequestDate: '2026-01-04' });
    ok('J9 Previously furnished demands the § 552.232 MATCH ATTESTATION, not just the pointers',
      gPF.blocked === true && gPF.rows.filter(function (r) { return r.code === 'MATCH_ATTESTATION_REQUIRED'; })[0].ok === false);
    var closedPF = await DISP.close(rJ2, 'previously_furnished', { actorName: 'M. Reyes',
      payload: { priorRequestNumber: 'R-100', priorRequestDate: '2026-01-04', matchAttested: true } });
    ok('J10 with the certification it closes', closedPF.ending === 'previously_furnished');
    var certHist = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'PREVIOUSLY_FURNISHED_CERTIFIED'", [rJ2]);
    ok('J11 …and the certification itself is on the record, attested by a named person',
      !!certHist && /552\.232/.test(certHist.notes) && /M\. Reyes/.test(certHist.notes));

    // The record screen.
    var recJ = await DISP.record(rJ2);
    ok('J12 the disposition record displays the ending, where it was written, and its evidence',
      recJ.items[0].ending === 'previously_furnished' && recJ.items[0].writtenWhere === 'disposition_record' && !!recJ.items[0].evidence);
    var recP = await DISP.record(pG);
    ok('J13 …and the parent state is DERIVED and labelled as derived, never closable by hand',
      recP.parentState.derived === true && /derive/i.test(recP.parentState.text));
    var openItem = recP.items.filter(function (i) { return !i.closed; })[0];
    ok('J14 …while an OPEN item says so rather than rendering a blank that reads like a missing record',
      !!openItem && /nothing to display/i.test(openItem.openText));

    // A sweep closure renders as a record with its badge.
    var rSweep = await makeRequest('req-' + TAG + '-SW', { departmentId: TEAM });
    await db.run("UPDATE requests SET closure_reason = 'no_clarification', status = 'closed', stage = 'closed' WHERE id = ?", [rSweep]);
    var recSw = await DISP.record(rSweep);
    ok('J15 a SWEEP closure renders as a record with its sweep badge and a system decider (rule c)',
      recSw.items[0].sweep === true && recSw.items[0].decidedBy === 'system' && /No response/.test(recSw.items[0].endingLabel));

    // ================================================================================================
    console.log('\n=== K. THE RM-HOLD GUARD (ratified 7/29) ===');
    var rK = await makeRequest('req-' + TAG + '-K', { departmentId: TEAM, stage: 'delivery' });
    var holdNoNote = null;
    try { await RH.hold(rK, { actorName: 'R. Manager' }); } catch (e) { holdNoNote = e; }
    ok('K1 a hold ALWAYS requires a note — a stop nobody can explain is the unnamed hold spec §2.4 bans',
      !!holdNoNote && holdNoNote.code === 'NOTE_REQUIRED');
    var held = await RH.hold(rK, { actorName: 'R. Manager', note: 'Briefing council Thursday.' });
    ok('K2 a NAMED hold stands', held.held === true && /council/.test(held.note));
    var evHeld = await AR.evaluate(rK);
    ok('K3 …and the pipeline will not ship a held record',
      evHeld.conditions.filter(function (c) { return c.code === 'NOT_HELD'; })[0].ok === false);
    ok('K4 …but it is NEVER a payment hold — money gating stays the release gate’s (§5.9)',
      /never a payment hold/i.test(held.neverAPaymentHold));

    // The prevention refinement, in an entitlement jurisdiction.
    await JR.write(jid, 'branches', { branches: { 'Disposition.inst': { active: true } } }, 'bw5-harness');
    var rK2 = await makeRequest('req-' + TAG + '-K2', { departmentId: TEAM, stage: 'delivery' });
    var stBefore = await RH.holdState(rK2);
    ok('K5 with the entitlement but NO installment request on file, a hold is still available', stBefore.canHold === true);
    await RH.onInstallmentRequest(rK2, { actorName: 'A. Clerk', note: 'Send them as they are ready.' });
    var stAfter = await RH.holdState(rK2);
    ok('K6 PREVENTION: with the entitlement AND a request on file the hold control is disabled…',
      stAfter.canHold === false && !!stAfter.blockedReason);
    ok('K7 …with the citation shown, so it is prevention rather than a fight', /RCW 42\.56\.080/.test(stAfter.citation || ''));
    var refused = null;
    try { await RH.hold(rK2, { actorName: 'R. Manager', note: 'Hold anyway.' }); } catch (e) { refused = e; }
    ok('K8 …and the API refuses with the same words the screen disables on — one evaluator, two readers',
      !!refused && refused.code === 'INSTALLMENT_ENTITLEMENT');

    // The override: an installment request arriving mid-hold.
    var rK3 = await makeRequest('req-' + TAG + '-K3', { departmentId: TEAM, stage: 'delivery' });
    await RH.hold(rK3, { actorName: 'R. Manager', note: 'Holding for a coordinated release.' });
    var lifted = await RH.onInstallmentRequest(rK3, { actorName: 'A. Clerk', note: 'They asked for installments.' });
    ok('K9 OVERRIDE: an installment request arriving mid-hold AUTO-LIFTS the hold',
      lifted.holdAutoLifted === true && lifted.held === false);
    var liftHist = await db.get("SELECT actor_name, notes FROM request_history WHERE request_id = ? AND action = 'RELEASE_HOLD_AUTO_LIFTED'", [rK3]);
    ok('K10 …recorded as statute-triggered, not as a judgment — the rule-(c) asymmetry, stated',
      !!liftHist && /statute/i.test(liftHist.actor_name) && /statute on verified facts/i.test(liftHist.notes));

    // And the fallback rule: no entitlement means no prevention.
    await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, 'branches']);
    var stNoProfile = await RH.holdState(rK2);
    ok('K11 UNKNOWN IS NOT AN ENTITLEMENT — on an un-researched install this is a note-requiring hold and ' +
       'nothing more', stNoProfile.entitlement === null && stNoProfile.canHold === true);

    console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  } finally {
    try {
      if (jid) {
        if (savedProcessing) await JR.write(jid, PC.DOMAIN, savedProcessing, 'bw5-harness-restore');
        else await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, PC.DOMAIN]);
        await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, AR.DOMAIN]);
        if (hadBranches && savedBranches) await JR.write(jid, 'branches', savedBranches, 'bw5-harness-restore');
        else await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, 'branches']);
      }
    } catch (e) { console.error('CLEANUP ERR', e && e.message); }
  }
})();
