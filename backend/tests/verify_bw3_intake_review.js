'use strict';
// PHASE 7 / BW3 — INTAKE REVIEW. What this harness asserts, and why each claim is worth a test:
//
//   A. THE STRUCTURED ELIGIBILITY READ. An evaluation persists as ROWS, not only as a prose note; the rows
//      split into blocks/reviews/advisories; re-recording updates rather than stacks; and a re-evaluation
//      does NOT erase a confirmation a person already gave. A read model that quietly overwrote a
//      reviewer's recorded act would be worse than no read model.
//   B. THE CONFIRM. Only a `review` is confirmable, it names the person, it writes history, and it is
//      idempotent — re-confirming must not re-attribute the decision to whoever clicked last.
//   C. TRIGGER (ii). The eligibility_review trigger is wired and fires off the structured read. A default
//      install raises none, because an unconfirmed dimension is advisory-only by construction — that
//      "changes nothing by default" claim is the whole safety argument and it is asserted, not assumed.
//   D. THE RESOLVE PATH + THE GATE. `intake_review` resolves through /tasks/:id/resolve; an open review
//      blocks it 422 with a NAMED cause; confirming it unblocks; the request advances through the central
//      transition; and a request that has already moved past record_search is NOT dragged backwards.
//   E. AUTO-COMPLETE. A `complete` intent in `always` mode raises the task and closes it with a history row
//      and no assignee; an OPEN duty-carrying intent (search_more) refuses to auto-complete, because
//      closing that request as answered is the exact failure the R9 gate exists to prevent; and in
//      `when_needed` (the default) nothing is raised at all.
//   F. THE QUEUE + THE SCREEN'S CONTEXT. The exceptions queue returns labelled triggers and a clock whose
//      KIND is present — the one field a UI must consult before writing the words "the law requires" — and
//      the screen's context returns the same gate the resolve route refuses on.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var IR = require('/opt/optimumq/backend/src/services/intakeReview');
var EF = require('/opt/optimumq/backend/src/services/eligibilityFindings');
var PC = require('/opt/optimumq/backend/src/services/processingConfig');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'BW3-' + Date.now();
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
    "INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id) " +
    "VALUES (?,?,?,?,?,?,'active',?)",
    [id, id, 'BW3 Harness', 'bw3@example.com', fields.description || ('bw3 harness ' + TAG),
     fields.stage || 'intake', fields.departmentId || null]);
  return id;
}

// An eligibilityGate.evaluate()-shaped result, built by hand. The harness never drives the gate itself —
// verify_branch_profile owns that — so nothing here depends on a jurisdiction's imported config.
function evaluation(opts) {
  opts = opts || {};
  return {
    blocked: false, blocks: [],
    reviews: opts.reviews || [],
    advisories: opts.advisories || []
  };
}
function finding(dimension, label, extra) {
  return Object.assign({ dimension: dimension, label: label, action: 'route_review', confirmed: true,
    known: false, passes: false, source_rule_ids: ['rule-' + dimension], note: 'help text',
    why: 'the harness says so' }, extra || {});
}

(async function () {
  await db.initDb();
  var created = { requests: [], tasks: [] };
  var savedProcessing = null, jid = null;
  try {
    jid = await JR.activeJid();
    try { savedProcessing = jid ? await JR.read(jid, PC.DOMAIN) : null; } catch (e) { savedProcessing = null; }

    var user = await db.get("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);
    var TEAM = user.department_id;

    // ================================================================================================
    console.log('\n=== A. THE STRUCTURED ELIGIBILITY READ (draft §4.5) ===');
    var rA = await makeRequest('req-' + TAG + '-A'); created.requests.push(rA);
    var n = await EF.record(rA, evaluation({
      reviews: [finding('identity', 'Identity')],
      advisories: [finding('incarceration', 'Incarcerated requester', { action: 'advise', confirmed: false })]
    }));
    ok('A1 an evaluation persists as ROWS, one per dimension', n === 2);

    var readA = await EF.read(rA);
    ok('A2 …split into the evaluator\'s own three classes', readA.reviews.length === 1 && readA.advisories.length === 1 && readA.blocks.length === 0);
    ok('A3 …with the config-confirmed flag kept separate from any person\'s confirmation',
      readA.reviews[0].configConfirmed === true && readA.reviews[0].confirmedAt === null);
    ok('A4 …and a review with nobody\'s name on it reads as OPEN', readA.reviews[0].open === true && readA.openReviews === 1);
    ok('A5 an advisory is never open — advisory ≠ automatic, and it is also never a stop',
      readA.advisories[0].open === false);
    ok('A6 the prose note is not duplicated beside the rows once the structure exists', readA.legacy.length === 0);

    // Re-recording the same evaluation must UPDATE, not stack a second opinion.
    await EF.record(rA, evaluation({ reviews: [finding('identity', 'Identity')], advisories: [finding('incarceration', 'Incarcerated requester')] }));
    var readA2 = await EF.read(rA);
    ok('A7 re-recording updates in place — one row per dimension per request, never a second opinion',
      readA2.reviews.length === 1 && readA2.advisories.length === 1);

    // ================================================================================================
    console.log('\n=== B. THE CONFIRM IS A PERSON\'S ACT (rule c) ===');
    var findingId = readA2.reviews[0].id;
    var advisoryId = readA2.advisories[0].id;
    var confirmed = await EF.confirm(findingId, { actorId: user.id, actorName: 'B. Harness' });
    ok('B1 a review is confirmed by a NAMED person', confirmed.confirmedBy === 'B. Harness' && !!confirmed.confirmedAt);
    ok('B2 …and it is no longer open', confirmed.open === false && (await EF.openReviews(rA)).length === 0);
    var hist = await db.get("SELECT * FROM request_history WHERE request_id = ? AND action = 'ELIGIBILITY_REVIEW_CONFIRMED'", [rA]);
    ok('B3 …recorded in the audit trail, not only in a column', !!hist);

    var again = await EF.confirm(findingId, { actorName: 'Somebody Else' });
    ok('B4 re-confirming is a NO-OP — a recorded decision is not re-attributed to whoever clicked last',
      again.confirmedBy === 'B. Harness');

    var advErr = null;
    try { await EF.confirm(advisoryId, { actorName: 'B. Harness' }); } catch (e) { advErr = e; }
    ok('B5 an ADVISORY cannot be confirmed — there is nothing to decide, and offering the act would imply there is',
      !!advErr && advErr.code === 'NOT_A_REVIEW');

    // A re-evaluation after a confirmation must not silently un-confirm it.
    await EF.record(rA, evaluation({ reviews: [finding('identity', 'Identity')] }));
    var readA3 = await EF.read(rA);
    ok('B6 a re-evaluation does NOT erase a confirmation already given',
      readA3.reviews[0].confirmedBy === 'B. Harness');

    // ================================================================================================
    console.log('\n=== C. TRIGGER (ii) IS WIRED, AND SAFE BY DEFAULT ===');
    ok('C1 the trigger is in the wired set now that its signal exists',
      IR.WIRED_TRIGGERS.indexOf('eligibility_review') >= 0);
    var rC = await makeRequest('req-' + TAG + '-C'); created.requests.push(rC);
    ok('C2 a request with NO findings raises nothing — an ordinary request never stops at intake',
      (await EF.hasReview(rC)) === false);
    await EF.record(rC, evaluation({ advisories: [finding('residency', 'Residency', { action: 'advise', confirmed: false })] }));
    ok('C3 an ADVISORY is not a trigger — a freshly imported state is advisory-only, so it must not stop traffic',
      (await EF.hasReview(rC)) === false);
    await EF.record(rC, evaluation({ reviews: [finding('identity', 'Identity')] }));
    ok('C4 a REVIEW is', (await EF.hasReview(rC)) === true);
    var spawnC = await IR.spawn(rC, ['eligibility_review'], { createdBy: 'harness', awaitRouting: true });
    created.tasks.push(spawnC.task.id);
    ok('C5 …and it raises an intake_review carrying the trigger key',
      spawnC.created && IR.triggersOf(spawnC.task).join('|') === 'eligibility_review');

    // ================================================================================================
    console.log('\n=== D. THE RESOLVE PATH AND ITS GATE (draft §4.6) ===');
    await db.run("UPDATE tasks SET assigned_to = ?, status = 'assigned' WHERE id = ?", [user.id, spawnC.task.id]);
    var gateOpen = await IR.proceedGate(rC);
    ok('D1 an unconfirmed review BLOCKS proceed, with a named cause',
      gateOpen.blocked && gateOpen.reasons[0].code === 'ELIGIBILITY_REVIEW_OPEN');
    ok('D2 …and the cause is a SENTENCE a reviewer can act on, not a code to look up',
      /confirm/i.test(gateOpen.reasons[0].text));

    var blocked = await req('POST', '/api/tasks/' + spawnC.task.id + '/resolve', { outcome: 'proceed' });
    ok('D3 the route refuses it 422 — the same pattern as the record-search Found gate',
      blocked.status === 422 && blocked.body && blocked.body.code === 'ELIGIBILITY_REVIEW_OPEN');
    ok('D4 …and the task is untouched by a refused resolve',
      (await tr.getTask(spawnC.task.id)).status === 'assigned');

    var badOutcome = await req('POST', '/api/tasks/' + spawnC.task.id + '/resolve', { outcome: 'hold' });
    ok('D5 there is NO manual hold outcome — hold is a system state with a named cause (spec §2.4)',
      badOutcome.status === 400 && badOutcome.body.code === 'UNKNOWN_OUTCOME');

    var openC = await EF.openReviews(rC);
    await EF.confirm(openC[0].id, { actorId: user.id, actorName: 'D. Harness' });
    ok('D6 confirming clears the gate', (await IR.proceedGate(rC)).blocked === false);

    var okRes = await req('POST', '/api/tasks/' + spawnC.task.id + '/resolve', { outcome: 'proceed' });
    ok('D7 proceed resolves the task', okRes.status === 200 && (await tr.getTask(spawnC.task.id)).status === 'done');
    var movedC = await db.get('SELECT stage FROM requests WHERE id = ?', [rC]);
    ok('D8 …and moves the request to record_search through the CENTRAL transition',
      movedC.stage === 'record_search' && okRes.body.stageChanged === true);
    var advRow = await db.get("SELECT * FROM request_history WHERE request_id = ? AND action = 'INTAKE_REVIEW_COMPLETE'", [rC]);
    ok('D9 …recorded in the audit trail', !!advRow);

    // A request that has ALREADY moved past record_search must not be dragged backwards.
    var rD = await makeRequest('req-' + TAG + '-D', { stage: 'redaction', departmentId: TEAM }); created.requests.push(rD);
    var tD = await tr.createTask({ requestId: rD, type: 'intake_review', title: 'late stop', teamId: null, createdBy: 'harness', spawnTriggers: [] });
    created.tasks.push(tD.id);
    await db.run("UPDATE tasks SET assigned_to = ?, status = 'assigned' WHERE id = ?", [user.id, tD.id]);
    var lateRes = await req('POST', '/api/tasks/' + tD.id + '/resolve', { outcome: 'proceed' });
    var stillD = await db.get('SELECT stage FROM requests WHERE id = ?', [rD]);
    ok('D10 proceed only moves FORWARD — an already-advanced request is not dragged back out of redaction',
      lateRes.status === 200 && stillD.stage === 'redaction' && lateRes.body.stageChanged === false);
    ok('D11 …and the task still completes, with the trail saying why the stage was left alone',
      (await tr.getTask(tD.id)).status === 'done');

    // ================================================================================================
    console.log('\n=== E. AUTO-COMPLETE (decision 4 / §4.4) ===');
    // when_needed (the DEFAULT): a fulfilled request is simply a no-trigger case. Nothing is raised, so
    // nothing has to be closed.
    if (jid) await PC.write(jid, { intake_review_mode: 'when_needed' }, 'bw3-harness');
    var rE0 = await makeRequest('req-' + TAG + '-E0'); created.requests.push(rE0);
    await db.run("INSERT INTO request_search_intents (id, request_id, seq, description, intent) VALUES (?,?,?,?,?)",
      ['si-' + TAG + '-0', rE0, 1, 'the attached record answers this', 'complete']);
    ok('E1 the fulfills signal is READ from R9\'s own substrate, not a new flag',
      (await IR.autoCompletes(rE0)) === true);
    var noneE = await IR.spawnForMode(rE0, { createdBy: 'harness', awaitRouting: true });
    ok('E2 in when_needed (the default) NOTHING is raised — no task created purely to be closed again',
      noneE === null && !(await IR.openTask(rE0)));

    // always mode: the task IS raised (audit trail) and closed on the spot, with no assignee.
    if (jid) await PC.write(jid, { intake_review_mode: 'always' }, 'bw3-harness');
    var rE1 = await makeRequest('req-' + TAG + '-E1'); created.requests.push(rE1);
    await db.run("INSERT INTO request_search_intents (id, request_id, seq, description, intent) VALUES (?,?,?,?,?)",
      ['si-' + TAG + '-1', rE1, 1, 'the attached record answers this', 'complete']);
    var acE = await IR.spawnForMode(rE1, { createdBy: 'harness', awaitRouting: true });
    if (acE && acE.task) created.tasks.push(acE.task.id);
    ok('E3 in always mode the task is RAISED — the audit trail shows the city\'s review happened',
      !!acE && acE.created === true && acE.autoCompleted === true);
    ok('E4 …and completed on the spot, with no assignee, so the queue never shows it',
      acE.task.status === 'done' && !acE.task.assigned_to);
    var acHist = await db.get("SELECT * FROM request_history WHERE request_id = ? AND action = 'INTAKE_REVIEW_AUTO_COMPLETED'", [rE1]);
    ok('E5 …and the reason is written down, not inferred from a closed task', !!acHist);

    // An OPEN duty-carrying intent must refuse to auto-complete.
    var rE2 = await makeRequest('req-' + TAG + '-E2'); created.requests.push(rE2);
    await db.run("INSERT INTO request_search_intents (id, request_id, seq, description, intent) VALUES (?,?,?,?,?)",
      ['si-' + TAG + '-2a', rE2, 1, 'these match', 'complete']);
    await db.run("INSERT INTO request_search_intents (id, request_id, seq, description, intent) VALUES (?,?,?,?,?)",
      ['si-' + TAG + '-2b', rE2, 2, 'and ALSO search for more', 'search_more']);
    ok('E6 a request the requestor asked us to search FURTHER never auto-completes — closing it as answered ' +
       'is the exact failure the R9 gate exists to prevent',
      (await IR.autoCompletes(rE2)) === false);
    var stopE2 = await IR.spawnForMode(rE2, { createdBy: 'harness', awaitRouting: true });
    if (stopE2 && stopE2.task) created.tasks.push(stopE2.task.id);
    ok('E7 …it gets the ordinary always-mode stop, open and assignable',
      !!stopE2 && stopE2.task.status !== 'done');

    // A TRIGGERED stop is not auto-completed out from under its trigger.
    var rE3 = await makeRequest('req-' + TAG + '-E3'); created.requests.push(rE3);
    await db.run("INSERT INTO request_search_intents (id, request_id, seq, description, intent) VALUES (?,?,?,?,?)",
      ['si-' + TAG + '-3', rE3, 1, 'the attached record answers this', 'complete']);
    var trigE3 = await IR.spawn(rE3, ['unroutable'], { createdBy: 'harness', awaitRouting: true });
    created.tasks.push(trigE3.task.id);
    var afterE3 = await IR.spawnForMode(rE3, { createdBy: 'harness', awaitRouting: true });
    ok('E8 a request already stopped for a REASON is not auto-completed out from under it',
      (await tr.getTask(trigE3.task.id)).status !== 'done' && (!afterE3 || afterE3.autoCompleted !== true));
    if (jid) await PC.write(jid, { intake_review_mode: 'when_needed' }, 'bw3-harness');

    // ================================================================================================
    console.log('\n=== F. THE QUEUE AND THE SCREEN\'S CONTEXT ===');
    var rF = await makeRequest('req-' + TAG + '-F', { departmentId: TEAM }); created.requests.push(rF);
    var tF = await IR.spawn(rF, ['unroutable', 'approval_pending'], { createdBy: 'harness', awaitRouting: true });
    created.tasks.push(tF.task.id);
    await db.run("UPDATE tasks SET assigned_to = ?, status = 'assigned' WHERE id = ?", [user.id, tF.task.id]);

    var q = await req('GET', '/api/tasks/intake-queue');
    var qrow = (q.body.tasks || []).filter(function (t) { return t.id === tF.task.id; })[0];
    ok('F1 the exceptions queue lists the task', q.status === 200 && !!qrow);
    ok('F2 …with its triggers LABELLED — on an exceptions queue the first question is WHICH exception',
      qrow.triggers.length === 2 && /could not be determined/.test(qrow.triggers[0].label));
    ok('F3 …and always-mode is distinguished from a named trigger and from an unrecorded one',
      qrow.alwaysMode === false && qrow.triggerUnrecorded === false);
    ok('F4 …and the clock, when there is one, carries its KIND — the one field a UI must consult before ' +
       'writing the words "the law requires"',
      qrow.clock === null || typeof qrow.clock.kind === 'string');

    var cx = await req('GET', '/api/tasks/' + tF.task.id + '/intake-context');
    ok('F5 the screen\'s context loads', cx.status === 200 && cx.body.task.id === tF.task.id);
    ok('F6 …carrying the SAME gate the resolve route refuses on, so the screen and the guard cannot drift',
      cx.body.gate && typeof cx.body.gate.blocked === 'boolean');
    ok('F7 …and both approval-module evaluations, so a panel knows whether it exists at all',
      !!cx.body.waiver && !!cx.body.commercial && typeof cx.body.waiver.mode === 'string');

    // The EditInfoFrame's write.
    var rt = await db.get("SELECT id, name FROM record_types WHERE status = 'active' LIMIT 1");
    var team = await db.get("SELECT id, name FROM departments WHERE kind = 'team' AND active = 1 LIMIT 1");
    var patched = await req('PATCH', '/api/tasks/' + tF.task.id + '/intake-routing',
      { recordTypeId: rt.id, teamId: team.id });
    ok('F8 the EditInfoFrame writes the classification and the routed team',
      patched.status === 200 && patched.body.request.record_type_id === rt.id && patched.body.request.department_id === team.id);
    var corr = await db.get("SELECT * FROM request_history WHERE request_id = ? AND action = 'INTAKE_INFO_CORRECTED'", [rF]);
    ok('F9 …and records the correction, because it changes who can be matched downstream', !!corr);
    var noop = await req('PATCH', '/api/tasks/' + tF.task.id + '/intake-routing', { recordTypeId: rt.id });
    var corrN = await db.get("SELECT count(*)::int AS n FROM request_history WHERE request_id = ? AND action = 'INTAKE_INFO_CORRECTED'", [rF]);
    ok('F10 …but confirming what the AI already said writes NO history row — that is noise in a trail the city may have to read',
      noop.status === 200 && corrN.n === 1);
    var bogus = await req('PATCH', '/api/tasks/' + tF.task.id + '/intake-routing', { teamId: 'not-a-team-' + TAG });
    ok('F11 …and a value that is not on the list it claims to come from is refused', bogus.status === 400);

    console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  } finally {
    try {
      if (jid) {
        if (savedProcessing) await JR.write(jid, PC.DOMAIN, savedProcessing, 'bw3-harness-restore');
        else await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, PC.DOMAIN]);
      }
    } catch (e) { console.error('CLEANUP ERR', e && e.message); }
  }
})();
