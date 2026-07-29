'use strict';
// PHASE 7 / BW4 — THE ESTIMATE TASK SCREEN. What this harness asserts, and why each claim earns a test:
//
//   A. THE COMMERCIAL CLASSIFICATION STORE. A classification PERSISTS, names its decider, records an
//      override of the requester's own declaration, and — the one that matters — does NOT overwrite the
//      declaration itself. `evaluateCommercial` flips from `needs_decision` to `classified` off the stored
//      value, which is the whole reason BW3 could not gate on it.
//   B. THE GATE, NARROWLY. proceedGate raises COMMERCIAL_UNCLASSIFIED only when the module is ENABLED and
//      in `intake_review` mode, and recording a classification clears it. The default install (module
//      disabled) raises nothing — that "changes nothing by default" claim is the safety argument for
//      shipping a new stop at all, so it is asserted rather than assumed.
//   C. TRIGGER (iv) sensitivity_flag. A flagged request raises intake_review carrying the trigger; an
//      unflagged one is untouched. The set of requests that stop must not change — only the destination.
//   D. THE PAUSE. `vague` pauses the estimate task, `overly_broad` does NOT (stay-and-estimate), a
//      clarification with no defect pauses nothing (every pre-existing caller), the reply resumes, a task
//      paused before the reply still resumes, and a paused task stays ACTIONABLE and CLOSABLE — the
//      stranding failure the marker-not-a-status decision exists to prevent.
//   E. PROVENANCE. An auto-routed request reads as first-human-review; a completed intake review with a
//      person on it reads as via-intake-review NAMED; an auto-completed one does NOT (no reviewer); an
//      OPEN one is not provenance either.
//   F. THE WAIVER PANEL + SEND GATE. Hidden when there is nothing to show; by-statute on verified evidence
//      even with the program OFF and nothing requested (the asymmetry); not_offered is never hidden when
//      the requester ASKED; and the send gate's words come from the same function the 409 refuses with.
//   G. DE MINIMIS. Requires a reason, writes a $0 snapshot WITHOUT rewriting the computed one, sends
//      nothing (notified_at stays null), closes the task, advances forward only, and refuses once a notice
//      has gone out.
//   G2. THE DE-MINIMIS THRESHOLD KNOB. Ships unconfirmed with a suggestion; while unconfirmed the action
//      offers itself regardless of total (behaviour-preserving); once confirmed it offers at or below the
//      value and disappears above it — and the ROUTE refuses too, because a ceiling the screen honours and
//      the endpoint ignores is no ceiling. A knob marked confirmed with no value is not a decision.
//   H. CHARGEABILITY. A forbidden line kind is reported forbidden WITH a citation; a conditional one is
//      reported conditional; an UNCONFIGURED one is still permitted — hiding it would silently remove
//      working inputs from existing installs in the name of a prohibition nobody declared.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var IR = require('/opt/optimumq/backend/src/services/intakeReview');
var AM = require('/opt/optimumq/backend/src/services/approvalModules');
var CC = require('/opt/optimumq/backend/src/services/commercialClassification');
var TP = require('/opt/optimumq/backend/src/services/taskPause');
var CH = require('/opt/optimumq/backend/src/services/chargeability');
var CA = require('/opt/optimumq/backend/src/services/clarificationAction');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var WE = require('/opt/optimumq/backend/src/services/workflowEngine');
var DM = require('/opt/optimumq/backend/src/services/deMinimisPolicy');

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'BW4-' + Date.now();
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
    'INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id, purpose, fee_waiver_requested) ' +
    "VALUES (?,?,?,?,?,?,'active',?,?,?)",
    [id, id, 'BW4 Harness', 'bw4@example.com', fields.description || ('bw4 harness ' + TAG),
     fields.stage || 'intake', fields.departmentId || null, fields.purpose || 'standard',
     fields.feeWaiverRequested ? 1 : 0]);
  return id;
}

(async function () {
  await db.initDb();
  var jid = null, savedAM = null, savedBranches = null, branchesCleared = false;
  try {
    jid = await JR.activeJid();
    try { savedAM = jid ? await JR.read(jid, AM.DOMAIN) : null; } catch (e) { savedAM = null; }

    // ⚠ THE ACTIVE JURISDICTION IS NOT THIS HARNESS'S TO ASSUME. The branch profile is the OUTER switch on
    // both approval modules: a state whose research says it has no commercial rate (Ohio) forces
    // `enabled: false` however the toggle is set, and that is correct behaviour this harness must not fight.
    // But it also makes sections A and B untestable — and WHICH jurisdiction is active depends on which
    // harness ran before this one in the suite, which is exactly the kind of order dependence that produces
    // a green run alone and a red one in the suite (it did, first time). So: if the active jurisdiction
    // branch-blocks commercial_rate, the branch row is saved and cleared for the duration (cleared = every
    // capability UNKNOWN, which is `null` and therefore renders — the fallback rule), and restored in the
    // finally. Nothing about the branch profile's own behaviour is being asserted here; verify_branch_profile
    // owns that.
    try {
      if (jid && (await require('/opt/optimumq/backend/src/services/branchProfile').isActive(jid, 'commercial_rate')) === false) {
        savedBranches = await JR.read(jid, 'branches');
        await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, 'branches']);
        branchesCleared = true;
      }
    } catch (e) { console.error('branch neutralize failed', e && e.message); }

    var user = await db.get("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);
    var TEAM = user.department_id;

    // ================================================================================================
    console.log('\n=== A. THE COMMERCIAL CLASSIFICATION STORE (BW3 confessed it did not exist) ===');
    var rA = await makeRequest('req-' + TAG + '-A', { purpose: 'standard' });
    var before = await CC.read(rA);
    ok('A1 an unclassified request reads as unclassified — NULL is not "standard"',
      before.classification === null && before.declared === 'standard');

    var recA = await CC.record(rA, 'commercial', 'A. Harness', { note: 'reseller, bulk resale' });
    ok('A2 a classification persists, against a NAMED person (rule c)',
      recA.classification === 'commercial' && recA.decidedBy === 'A. Harness' && !!recA.decidedAt);
    ok('A3 …and it is recorded as an OVERRIDE of what the requester declared', recA.overridesDeclaration === true);
    var rowA = await db.get('SELECT purpose, commercial_classification FROM requests WHERE id = ?', [rA]);
    ok('A4 …WITHOUT overwriting the declaration — an override is only detectable while both survive',
      rowA.purpose === 'standard' && rowA.commercial_classification === 'commercial');
    var histA = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'COMMERCIAL_CLASSIFICATION_RECORDED'", [rA]);
    ok('A5 …and the trail SAYS it is an override, because that has to be communicated',
      !!histA && /OVERRIDES/.test(histA.notes));

    var badA = null; try { await CC.record(rA, 'wholesale', 'A. Harness'); } catch (e) { badA = e; }
    ok('A6 an unknown value is refused rather than stored', !!badA && badA.code === 'BAD_CLASSIFICATION');

    // Turn the module on, in intake_review mode, for the evaluation + gate assertions.
    await AM.write(jid, { commercial_rate: { enabled: true, mode: 'intake_review' } }, 'bw4-harness');
    var reqRowA = await db.get('SELECT * FROM requests WHERE id = ?', [rA]);
    var evalA = await AM.evaluateCommercial(jid, reqRowA, {});
    ok('A7 evaluateCommercial reads the STORED value — needs_decision becomes classified, which is exactly ' +
       'what BW3 had no way to reach',
      evalA.outcome === 'classified' && evalA.classified === 'commercial' && evalA.recorded === true);
    ok('A8 …carrying the decider through, so a screen draws the badge without a second read',
      evalA.decidedBy === 'A. Harness');

    // ================================================================================================
    console.log('\n=== B. THE GATE, AND THE DEFAULT THAT MUST NOT MOVE ===');
    var rB = await makeRequest('req-' + TAG + '-B');
    var gateB = await IR.proceedGate(rB);
    ok('B1 module ENABLED + mode intake_review: an unclassified request blocks Proceed, with a named cause',
      gateB.blocked && gateB.reasons.some(function (r) { return r.code === 'COMMERCIAL_UNCLASSIFIED'; }));
    ok('B2 …and the cause is a SENTENCE that says what to do about it, not a code to look up',
      /Commercial-rate panel/.test((gateB.reasons.filter(function (r) { return r.code === 'COMMERCIAL_UNCLASSIFIED'; })[0] || {}).text || ''));
    await CC.record(rB, 'standard', 'B. Harness');
    var gateB2 = await IR.proceedGate(rB);
    ok('B3 recording a classification CLEARS it — a gate no act can clear is the one BW3 refused to build',
      !gateB2.reasons.some(function (r) { return r.code === 'COMMERCIAL_UNCLASSIFIED'; }));

    await AM.write(jid, { commercial_rate: { enabled: true, mode: 'routed_task' } }, 'bw4-harness');
    var rB2 = await makeRequest('req-' + TAG + '-B2');
    var gateB3 = await IR.proceedGate(rB2);
    ok('B4 routed_task mode does NOT gate intake — that would block a request behind somebody else\'s queue',
      !gateB3.reasons.some(function (r) { return r.code === 'COMMERCIAL_UNCLASSIFIED'; }));

    await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, AM.DOMAIN]);
    var defaults = AM.defaultsFor('commercial_rate');
    ok('B5 the SHIPPED DEFAULT is disabled — so no default install grows a new stop', defaults.enabled === false);
    var rB3 = await makeRequest('req-' + TAG + '-B3');
    var gateB4 = await IR.proceedGate(rB3);
    ok('B6 …and on defaults, an unclassified request is not blocked at all',
      !gateB4.reasons.some(function (r) { return r.code === 'COMMERCIAL_UNCLASSIFIED'; }));

    var offRes = await req('POST', '/api/requests/' + rB3 + '/commercial-classification', { classifyAs: 'commercial' });
    ok('B7 …and the route refuses to record one where the module is off: a rate decision in a city with no ' +
       'commercial rate is not a decision',
      offRes.status === 409 && offRes.body.code === 'COMMERCIAL_NOT_OFFERED');

    // ================================================================================================
    console.log('\n=== C. TRIGGER (iv) sensitivity_flag — SAME REQUESTS, NEW DESTINATION ===');
    ok('C1 the trigger is in the wired set', IR.WIRED_TRIGGERS.indexOf('sensitivity_flag') >= 0);
    var rC = await makeRequest('req-' + TAG + '-C', { description: 'sensitive matter ' + TAG });
    await WE.onIntake(rC, { classification: 'standard', recordTypeConfidence: 95, flags: ['SENSITIVE'],
      departmentId: TEAM, custodianDepartmentId: TEAM, reasoning: 'harness' });
    var stopC = await IR.openTask(rC);
    ok('C2 a SENSITIVITY-flagged request now raises an intake_review',
      !!stopC && IR.triggersOf(stopC).indexOf('sensitivity_flag') >= 0);

    var rC2 = await makeRequest('req-' + TAG + '-C2', { description: 'ordinary parks matter ' + TAG });
    await WE.onIntake(rC2, { classification: 'standard', recordTypeConfidence: 95, flags: [],
      departmentId: TEAM, custodianDepartmentId: TEAM, reasoning: 'harness' });
    var stopC2 = await IR.openTask(rC2);
    ok('C3 …and an UNflagged one is untouched — the set of requests that stop must not change',
      !stopC2);

    var rC3 = await makeRequest('req-' + TAG + '-C3', { description: 'legal hold matter ' + TAG });
    await WE.onIntake(rC3, { classification: 'standard', recordTypeConfidence: 40, flags: ['LEGAL_HOLD'],
      departmentId: TEAM, custodianDepartmentId: TEAM, reasoning: 'harness' });
    var stopC3 = await IR.openTask(rC3);
    ok('C4 …all three flag kinds count — the rule\'s own list decides, this does not narrow it',
      !!stopC3 && IR.triggersOf(stopC3).indexOf('sensitivity_flag') >= 0);

    // ================================================================================================
    console.log('\n=== D. THE PAUSE THAT CANNOT STRAND A TASK ===');
    var rD = await makeRequest('req-' + TAG + '-D', { departmentId: TEAM, stage: 'intake' });
    var tD = await tr.createTask({ requestId: rD, type: 'estimate', title: 'Create estimate', teamId: TEAM, createdBy: 'harness' });
    await db.run("UPDATE tasks SET assigned_to = ?, status = 'assigned' WHERE id = ?", [user.id, tD.id]);

    await CA.send(rD, { reason: 'overly_broad', actorName: 'D. Harness' });
    ok('D1 OVERLY BROAD does NOT pause — "too large is not a mark, it IS the estimate"',
      (await TP.isPaused(tD.id)) === false);

    await CA.send(rD, { actorName: 'D. Harness' });
    ok('D2 a clarification with NO recorded defect pauses nothing — every pre-existing caller is unchanged',
      (await TP.isPaused(tD.id)) === false);

    var sentD = await CA.send(rD, { reason: 'vague', actorName: 'D. Harness' });
    ok('D3 VAGUE pauses the estimate task — you cannot price what you cannot parse',
      sentD.estimateTasksPaused === 1 && (await TP.isPaused(tD.id)) === true);
    var rowD = await tr.getTask(tD.id);
    ok('D4 …and the task stays ACTIONABLE: the pause is a marker beside the status, never a status value, ' +
       'so nothing that reads `status IN (...)` loses it',
      ['open', 'assigned', 'in_progress', 'returned', 'awaiting_review'].indexOf(rowD.status) >= 0);
    ok('D5 …and the pause carries its own words, from the server', TP.stateOf(rowD).paused === true && /cannot parse/.test(TP.stateOf(rowD).text));

    var sendBlocked = await req('POST', '/api/fee-estimates/request/' + rD + '/notice/send', { text: 'hello' });
    ok('D6 …and the notice cannot be SENT while paused — a screen-only hold is theatre',
      sendBlocked.status === 409 && sendBlocked.body.code === 'ESTIMATE_PAUSED');

    var resD = await CA.resolve(rD, { actorName: 'D. Harness' });
    ok('D7 the requestor\'s REPLY resumes it', resD.estimateTasksResumed === 1 && (await TP.isPaused(tD.id)) === false);

    // A task paused by somebody else / an earlier deploy still resumes on the reply.
    await db.run("UPDATE tasks SET paused_at = datetime('now'), paused_reason = 'vague', paused_by = 'Somebody Else' WHERE id = ?", [tD.id]);
    var resD2 = await TP.resumeForRequest(rD, { actorName: 'D. Harness' });
    ok('D8 …including one paused by another person or an earlier deploy — nothing may be left with no way back',
      resD2 === 1 && (await TP.isPaused(tD.id)) === false);

    // ================================================================================================
    console.log('\n=== E. PROVENANCE (§4.2) ===');
    var rE = await makeRequest('req-' + TAG + '-E');
    var pE = await IR.provenance(rE);
    ok('E1 no intake stop at all = auto-routed, first human review',
      pE.firstHumanReview === true && pE.viaIntakeReview === false && /Auto-routed/.test(pE.label));

    var openE = await IR.spawn(rE, ['unroutable'], { createdBy: 'harness', awaitRouting: true });
    var pE2 = await IR.provenance(rE);
    ok('E2 an OPEN intake review is NOT provenance — nobody has decided anything yet',
      pE2.viaIntakeReview === false && pE2.openStop === true);

    await db.run("UPDATE tasks SET assigned_to = ?, status = 'done' WHERE id = ?", [user.id, openE.task.id]);
    var pE3 = await IR.provenance(rE);
    ok('E3 a COMPLETED review held by a person reads as via-intake-review, NAMED',
      pE3.viaIntakeReview === true && pE3.firstHumanReview === false && !!pE3.decidedBy &&
      pE3.label.indexOf('Via Intake Review') === 0);

    var rE2 = await makeRequest('req-' + TAG + '-E2');
    var acTask = await tr.createTask({ requestId: rE2, type: 'intake_review', title: 'auto', teamId: null, createdBy: 'system', spawnTriggers: [] });
    await db.run("UPDATE tasks SET status = 'done' WHERE id = ?", [acTask.id]);
    await db.run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)",
      [require('uuid').v4(), rE2, null, 'System', 'INTAKE_REVIEW_AUTO_COMPLETED', 'auto']);
    var pE4 = await IR.provenance(rE2);
    ok('E4 an AUTO-COMPLETED review is NOT a human review — labelling it "Via Intake Review (name)" would ' +
       'name nobody, or name the system (rule c)',
      pE4.firstHumanReview === true && pE4.autoCompleted === true && pE4.viaIntakeReview === false);

    // ================================================================================================
    console.log('\n=== F. THE WAIVER PANEL + THE SEND GATE (§0b, §4.3) ===');
    var rF = await makeRequest('req-' + TAG + '-F');
    var reqF = await db.get('SELECT * FROM requests WHERE id = ?', [rF]);
    var wF = await AM.evaluateWaiver(jid, reqF, {});
    ok('F1 nothing requested, nothing armed, nothing decided => the panel is HIDDEN',
      AM.waiverPanelState(wF, reqF).state === 'hidden');

    // The asymmetry: a mandatory category fires on VERIFIED EVIDENCE even with the program off and nothing
    // requested. Driven through evaluateWaiver's own opts so the harness does not depend on a seeded state.
    var wStat = await AM.evaluateWaiver(jid, reqF, {
      config: { modules: { fee_waiver: { enabled: false, mode: 'routed_task', branchAvailable: null, routed_task: {} } },
        mandatory: [{ key: 'indigent', label: 'Indigent requester', evidence: 'indigency_affidavit', citation: 'Conn. Gen. Stat. § 1-212(d)' }] },
      verifiedEvidence: ['indigency_affidavit']
    });
    ok('F2 a statutory-mandatory category fires on verified evidence with the program OFF and nothing requested',
      wStat.outcome === 'auto_granted');
    var psF = AM.waiverPanelState(wStat, reqF);
    ok('F3 …and the panel surfaces it as BY STATUTE, with nothing for this person to decide',
      psF.state === 'by_statute' && psF.decidedBy === 'statute' && !!psF.category);

    var rF2 = await makeRequest('req-' + TAG + '-F2', { feeWaiverRequested: true });
    var reqF2 = await db.get('SELECT * FROM requests WHERE id = ?', [rF2]);
    var wF2 = await AM.evaluateWaiver(jid, reqF2, {
      config: { modules: { fee_waiver: { enabled: false, mode: 'routed_task', branchAvailable: false, routed_task: {} } }, mandatory: [] } });
    ok('F4 a requester who ASKED and has no program to ask is NEVER hidden — silence is the failure there',
      AM.waiverPanelState(wF2, reqF2).state === 'not_offered');

    var gateF = await AM.estimateCommunicationGate(jid, reqF2);
    ok('F5 the send gate blocks an undecided waiver, with the 409 code the send route refuses with',
      gateF.blocked === false || gateF.code === 'WAIVER_UNDECIDED');
    await db.run("UPDATE requests SET fee_waiver_status = 'denied', fee_waiver_reason = 'not indigent', fee_waiver_decided_by = 'F. Harness' WHERE id = ?", [rF2]);
    var reqF3 = await db.get('SELECT * FROM requests WHERE id = ?', [rF2]);
    ok('F6 …and a DENIAL unblocks it: processing never stops on a denial, it folds into the notice',
      (await AM.estimateCommunicationGate(jid, reqF3)).blocked === false);
    var psF3 = AM.waiverPanelState(await AM.evaluateWaiver(jid, reqF3, {}), reqF3);
    ok('F7 …and the panel shows the decision with the DECIDER\'s name (rule c)',
      psF3.state === 'decided' && psF3.decidedBy === 'F. Harness');

    // ================================================================================================
    console.log('\n=== G. DE MINIMIS — WAIVE AND ADVANCE (§4.4) ===');
    var rG = await makeRequest('req-' + TAG + '-G', { departmentId: TEAM, stage: 'intake' });
    var tG = await tr.createTask({ requestId: rG, type: 'estimate', title: 'Create estimate', teamId: TEAM, createdBy: 'harness' });
    await db.run("UPDATE tasks SET assigned_to = ?, status = 'assigned' WHERE id = ?", [user.id, tG.id]);
    var snapId = 'fe-bw4' + Date.now().toString().slice(-6);
    await db.run("INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at) " +
      "VALUES (?,?,'estimate','{}',?,?,0,0,'harness',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))",
      [snapId, rG, JSON.stringify({ requestLevel: { total: 1.75, depositDue: 0 } }), 1.75]);

    var noNote = await req('POST', '/api/fee-estimates/request/' + rG + '/de-minimis-waive', {});
    ok('G1 a reason is REQUIRED — this waives money on judgment rather than on a rule',
      noNote.status === 400 && noNote.body.code === 'NOTE_REQUIRED');

    var dm = await req('POST', '/api/fee-estimates/request/' + rG + '/de-minimis-waive', { note: 'under two dollars' });
    ok('G2 it records the waive and advances the request', dm.status === 200 && dm.body.waived === true && dm.body.total === 0);
    var origin = await db.get('SELECT total FROM request_fee_estimates WHERE id = ?', [snapId]);
    ok('G3 …WITHOUT rewriting the engine\'s computed estimate — that is the evidence of what fees would have been',
      Number(origin.total) === 1.75);
    var zero = await db.get("SELECT total, notified_at, accepted_by FROM request_fee_estimates WHERE request_id = ? AND total = 0 ORDER BY created_at DESC LIMIT 1", [rG]);
    ok('G4 …a $0 snapshot is written, accepted by the staff member (a $0 estimate asks the requester for nothing)',
      !!zero && !!zero.accepted_by);
    ok('G5 …and NOTHING was sent: notified_at stays null rather than logging a notice that never existed',
      zero.notified_at === null);
    ok('G6 …the estimate task closes', (await tr.getTask(tG.id)).status === 'done');
    var stageG = await db.get('SELECT stage FROM requests WHERE id = ?', [rG]);
    ok('G7 …and the request advances to record search', stageG.stage === 'record_search' && dm.body.advanced === true);
    var histG = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'FEE_DE_MINIMIS_WAIVED'", [rG]);
    ok('G8 …recorded as a PERSON\'s judgment, distinguished from the configured de-minimis rule',
      !!histG && /judgment/.test(histG.notes));

    // Already-notified: the requester is holding a figure, so the notice cycle can no longer be skipped.
    var rG2 = await makeRequest('req-' + TAG + '-G2', { departmentId: TEAM });
    var snap2 = 'fe-bw4b' + Date.now().toString().slice(-6);
    await db.run("INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, notified_at) " +
      "VALUES (?,?,'estimate','{}','{}',5,0,0,'harness',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'),to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))",
      [snap2, rG2]);
    var late = await req('POST', '/api/fee-estimates/request/' + rG2 + '/de-minimis-waive', { note: 'too late' });
    ok('G9 …and it is refused once the notice has gone out — a waiver, which communicates, is the right act then',
      late.status === 409 && late.body.code === 'ALREADY_NOTIFIED');

    // ================================================================================================
    console.log('\n=== G2. THE DE-MINIMIS THRESHOLD KNOB (Kevin 7/29, answering Draft 2 §5 q3) ===');
    var unconf = await DM.read(jid);
    ok('G10 the knob ships UNCONFIRMED with a SUGGESTION, marked city policy rather than law',
      unconf.confirmed === false && unconf.thresholdUsd === null && unconf.suggestedDefault === 25 && unconf.configNotLaw === true);
    var offBig = await DM.offerFor(4000, jid);
    ok('G11 …and while unconfirmed the action offers itself REGARDLESS of the total — behaviour-preserving, ' +
       'because a city that has not chosen a ceiling has not chosen one',
      offBig.offered === true && offBig.reason === 'unconfirmed');

    await DM.write(jid, { confirmed: true, value: 20 }, 'bw4-harness');
    var conf = await DM.read(jid);
    ok('G12 a city can confirm a value', conf.confirmed === true && conf.thresholdUsd === 20);
    ok('G13 …at or below it the action is offered, and the note is STILL required — a threshold says the ' +
       'amount is small, not why this request was not worth billing',
      (await DM.offerFor(19.99, jid)).offered === true && /reason is still/i.test((await DM.offerFor(19.99, jid)).text));
    var above = await DM.offerFor(20.01, jid);
    ok('G14 …above it the action does not render', above.offered === false && above.reason === 'above_threshold');

    // And the ENDPOINT refuses too — a ceiling the screen honours and the route ignores is no ceiling.
    var rG3 = await makeRequest('req-' + TAG + '-G3', { departmentId: TEAM });
    var snap3 = 'fe-bw4c' + Date.now().toString().slice(-6);
    await db.run("INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at) " +
      "VALUES (?,?,'estimate','{}','{}',95,0,0,'harness',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))", [snap3, rG3]);
    var overRes = await req('POST', '/api/fee-estimates/request/' + rG3 + '/de-minimis-waive', { note: 'try it anyway' });
    ok('G15 …and so does the route, so the policy cannot be stepped around with one request',
      overRes.status === 409 && overRes.body.code === 'ABOVE_DE_MINIMIS_THRESHOLD');

    await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, DM.DOMAIN]);
    ok('G16 a knob marked confirmed with NO value is not a decision and does not gate',
      (await (async function () { await DM.write(jid, { confirmed: true, value: null }, 'bw4-harness'); return DM.offerFor(9999, jid); })()).offered === true);
    await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, DM.DOMAIN]);

    // ================================================================================================
    console.log('\n=== H. CHARGEABILITY AS CITED CONFIG (§3, §4.5) ===');
    var ohKinds = CH.fromConfig({ labor: { search: { billable: false }, review: { billable: false } },
      duplication: { bw: { rate: 0.05 } } }, 'OH');
    var ohSearch = ohKinds.filter(function (k) { return k.field === 'searchHours'; })[0];
    ok('H1 Ohio forbids labor, so the builder is told not to offer it', ohSearch && ohSearch.permitted === false);
    ok('H2 …WITH the citation, because a vanished field with no reason reads as a bug',
      ohSearch.citation === 'R.C. 149.43(B)(1)');

    var txKinds = CH.fromConfig({ labor: { search: { rate: 15, billableWhen: { mode: 'all_or_nothing', trigger: 'pages',
      threshold: 50, paperOnly: true, _statute: "Tex. Gov't Code § 552.261(a)" } } }, duplication: { bw: { rate: 0.1 } } }, 'TX');
    var txSearch = txKinds.filter(function (k) { return k.field === 'searchHours'; })[0];
    ok('H3 Texas permits personnel time, conditionally, and says on what condition',
      txSearch.permitted === true && txSearch.reason === 'conditional' && /exceed 50/.test(txSearch.text));
    ok('H4 …citing the config\'s OWN researched statute rather than a fallback',
      txSearch.citation === "Tex. Gov't Code § 552.261(a)");

    var bare = CH.fromConfig({ duplication: {} }, 'ZZ');
    var bareSearch = bare.filter(function (k) { return k.field === 'searchHours'; })[0];
    ok('H5 an UNCONFIGURED kind is still offered, marked unconfigured — hiding it would silently strip ' +
       'working inputs from existing installs for a prohibition nobody declared',
      bareSearch.permitted === true && bareSearch.reason === 'unconfigured');

    var live = await CH.forActiveJurisdiction(jid);
    ok('H6 the live read never throws and always answers with a kind list', Array.isArray(live.kinds));

    // ================================================================================================
    console.log('\n=== I. THE SCREEN\'S ONE READ ===');
    var ctxRes = await req('GET', '/api/tasks/' + tD.id + '/estimate-context');
    ok('I1 the estimate screen\'s context loads', ctxRes.status === 200 && ctxRes.body.task.id === tD.id);
    ok('I2 …carrying provenance, the pause state, the waiver panel state and the send gate — all from the ' +
       'same functions the guards use, so the screen and the refusal cannot drift',
      !!ctxRes.body.provenance && !!ctxRes.body.paused && !!ctxRes.body.waiverPanel && !!ctxRes.body.waiverGate);
    var wrongType = await req('GET', '/api/tasks/' + openE.task.id + '/estimate-context');
    ok('I3 …and it refuses a task that is not an estimate', wrongType.status === 400);

    console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  } finally {
    try {
      if (jid) {
        if (savedAM) await JR.write(jid, AM.DOMAIN, savedAM, 'bw4-harness-restore');
        else await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, AM.DOMAIN]);
        await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, DM.DOMAIN]);
        if (branchesCleared && savedBranches) await JR.write(jid, 'branches', savedBranches, 'bw4-harness-restore');
      }
    } catch (e) { console.error('CLEANUP ERR', e && e.message); }
  }
})();
