'use strict';
// PHASE 7 / WS4 — the fee-waiver and commercial-rate approval modules, v1.
//
// The claims under test, from docs/SPEC_phase7_build.md and the decided
// docs/rules_research/workflow/DESIGN_fee_waiver_commercial.md:
//   1. BOTH MODES are exercisable end-to-end on a real request. `intake_review` spawns no extra task —
//      that is the whole point of the mode. `routed_task` spawns the configured task, with the
//      configured name, to the configured role.
//   2. TOGGLING `enabled` OFF LEAVES THE MANDATORY CATEGORIES LIVE. A Connecticut requester with a
//      verified indigency affidavit is waived by statute (§ 1-212(d)) whether or not the city runs a
//      discretionary program, and whether or not anyone confirmed the category — the one place in
//      Phase 7 where unconfirmed config still acts, because acting costs money and not acting costs a
//      citizen a right.
//   3. SEQUENCING: the estimate cannot be COMMUNICATED while a waiver decision is outstanding, and a
//      denial folds into the estimate notice instead of becoming its own letter.
//   4. PROCESSING NEVER STOPS on a denial.
//   5. A routed_task pointed at a role nobody holds is REFUSED — that task would pool to nobody and
//      block every estimate behind it, silently.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var AM = require('/opt/optimumq/backend/src/services/approvalModules');
var STI = require('/opt/optimumq/backend/src/services/stateTemplateImport');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var WE = require('/opt/optimumq/backend/src/services/workflowEngine');
var CI = require('/opt/optimumq/backend/src/services/configIntegrity');
var feeNotice = require('/opt/optimumq/backend/src/services/feeNotice');

var TAG = 'APPROVAL-' + Date.now();
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function realErrors(findings, where) {
  return (findings || []).filter(function (f) {
    if (f.severity !== 'error') return false;
    if (/A harness has leaked into production config/.test(f.issue)) return false;
    return where ? f.where.indexOf(where) === 0 : true;
  });
}
async function setActive(jid) {
  await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [jid]);
}
// A request through the real creation path, with intake run synchronously so the module's decision is
// observable rather than racing a background chain.
async function makeRequest(fields, created) {
  var made = await RC.createRequest(Object.assign({
    requestorName: 'WS4 Harness', requestorEmail: 'ws4@example.com', description: 'Approval module harness ' + TAG
  }, fields), { actorName: 'harness', kickIntake: false, startClocks: false });
  created.push(made.parentId, made.childId);
  await WE.onIntake(made.childId);
  return made;
}
function waiverTasks(rid) {
  return db.all("SELECT id, type, title, role_required, status FROM tasks WHERE request_id = ? AND type = 'fee_waiver'", [rid]);
}

(async function () {
  await db.initDb();
  var savedActive = null, created = [];
  try {
    savedActive = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
    ok('active jurisdiction resolves (' + savedActive + ')', !!savedActive);

    // ---- 0. defaults preserve today's behaviour
    var cfg0 = await AM.config(savedActive);
    ok('fee_waiver defaults ENABLED — the shipped product already spawns a waiver task, and defaulting it ' +
       'off would silently stop answering waiver requests', cfg0.modules.fee_waiver.enabled === true);
    ok('commercial_rate defaults DISABLED — nothing spawns commercial work today, so ON would be the change',
      cfg0.modules.commercial_rate.enabled === false);
    // The default MODE matters as much as the default `enabled`: intake_review would have stopped the
    // existing waiver task just as dead, one layer down, with the toggle still reading "on".
    ok('fee_waiver defaults to routed_task — reproducing the existing spawn exactly',
      cfg0.modules.fee_waiver.mode === 'routed_task');
    ok('...to FINANCE, with the title the hardcoded spawn used',
      cfg0.modules.fee_waiver.routed_task.assignee_role === 'FINANCE' &&
      cfg0.modules.fee_waiver.routed_task.task_name === 'Decide fee-waiver request');
    ok('commercial_rate defaults to intake_review (nothing existed to preserve)',
      cfg0.modules.commercial_rate.mode === 'intake_review');
    ok('the recommended denial policy is to fold into the estimate notice',
      cfg0.modules.fee_waiver.denial_notice === 'fold_into_estimate');

    // ---- 1. MODE: intake_review — the reviewer decides inline, so NO extra task
    await AM.write(savedActive, { fee_waiver: { enabled: true, mode: 'intake_review' } }, 'harness-ws4');
    var r1 = await makeRequest({ feeWaiverRequested: true, description: 'Waiver inline ' + TAG }, created);
    var t1 = await waiverTasks(r1.childId);
    ok('intake_review: a waiver request spawns NO separate approval task', t1.length === 0);
    var st1 = await db.get('SELECT fee_waiver_requested, fee_waiver_status FROM requests WHERE id = ?', [r1.childId]);
    ok('...but the request still carries the waiver request, pending a decision',
      Number(st1.fee_waiver_requested) === 1 && !st1.fee_waiver_status);
    var ev1 = await AM.evaluateWaiver(savedActive, st1, {});
    ok('...and the module says it needs a decision, inline', ev1.outcome === 'needs_decision' && ev1.route.mode === 'intake_review');

    // ---- 2. MODE: routed_task — the configured task, name and role
    await AM.write(savedActive, { fee_waiver: { enabled: true, mode: 'routed_task', routed_task: { assignee_role: 'FEE_MANAGER', task_name: 'Fee waiver — finance review' } } }, 'harness-ws4');
    var r2 = await makeRequest({ feeWaiverRequested: true, description: 'Waiver routed ' + TAG }, created);
    var t2 = await waiverTasks(r2.childId);
    ok('routed_task: exactly one approval task is spawned', t2.length === 1);
    ok('...with the CONFIGURED task name', t2.length === 1 && t2[0].title === 'Fee waiver — finance review');
    ok('...routed to the CONFIGURED role', t2.length === 1 && t2[0].role_required === 'FEE_MANAGER');

    // ---- 3. SEQUENCING: the estimate cannot be communicated while the decision is outstanding
    var pending = await db.get('SELECT id, fee_waiver_requested, fee_waiver_status FROM requests WHERE id = ?', [r2.childId]);
    var gate = await AM.estimateCommunicationGate(savedActive, pending);
    ok('the estimate is BLOCKED while the waiver is undecided', gate.blocked === true && gate.code === 'WAIVER_UNDECIDED');
    ok('...and the reason names the task that has to close first', /Fee waiver — finance review/.test(gate.reason));

    await db.run("UPDATE requests SET fee_waiver_status = 'denied', fee_waiver_reason = 'Not primarily for public benefit' WHERE id = ?", [r2.childId]);
    var decided = await db.get('SELECT id, request_number, requestor_name, fee_waiver_requested, fee_waiver_status, fee_waiver_reason FROM requests WHERE id = ?', [r2.childId]);
    var gate2 = await AM.estimateCommunicationGate(savedActive, decided);
    ok('once decided, the estimate may be sent', gate2.blocked === false);

    // ---- 4. THE DENIAL FOLDS INTO THE ESTIMATE NOTICE — one communication, no new document type
    var cfgNow = await AM.config(savedActive);
    var denialText = AM.denialNoticeText(decided, cfgNow.modules.fee_waiver);
    ok('a denial produces notice text', !!denialText && /not able to grant it/.test(denialText));
    ok('...quoting the reason the decider gave', /Not primarily for public benefit/.test(denialText));
    ok('...and saying in terms that processing does not stop', /does not stop your request/.test(denialText));
    var notice = feeNotice.buildNotice(decided, { requestLevel: { total: 42 } }, { agencyName: 'Testville', feeWaiver: { granted: false, deniedText: denialText } });
    ok('the estimate notice CARRIES the denial', /not able to grant it/.test(notice.text));
    ok('...and the amount, in the same message', /42/.test(notice.text));
    ok('...under an estimate subject line, not a denial one', /Cost estimate/.test(notice.subject));

    // separate_letter is still available for a city that wants it
    await AM.write(savedActive, { fee_waiver: { enabled: true, mode: 'routed_task', denial_notice: 'separate_letter', routed_task: { assignee_role: 'FEE_MANAGER', task_name: 'Fee waiver — finance review' } } }, 'harness-ws4');
    var cfgSep = await AM.config(savedActive);
    ok('a city can still choose a separate denial letter', cfgSep.modules.fee_waiver.denial_notice === 'separate_letter');
    ok('...and then the notice does NOT carry the denial', AM.denialNoticeText(decided, cfgSep.modules.fee_waiver) === null);

    // ---- 5. THE ACCEPTANCE CRITERION: enabled OFF leaves the mandatory categories live.
    // Connecticut: § 1-212(d) enumerates indigent / elected official / public-defender counsel.
    await setActive('jur-ct');
    await AM.write('jur-ct', { fee_waiver: { enabled: false, mode: 'intake_review' } }, 'harness-ws4');
    var ctCfg = await AM.config('jur-ct');
    ok('CT: the discretionary program is OFF', ctCfg.modules.fee_waiver.enabled === false);
    ok('...and CT carries three statutory-mandatory categories', ctCfg.mandatory.length === 3);
    ok('...none of which anyone has confirmed', ctCfg.mandatory.every(function (c) { return c.confirmed === false; }));

    var plain = await AM.evaluateWaiver('jur-ct', { fee_waiver_requested: 1 }, {});
    ok('with the program off and no evidence: not offered, and nothing stops',
      plain.outcome === 'not_offered' && /continues to the ordinary estimate/.test(plain.reason));

    var indigent = await AM.evaluateWaiver('jur-ct', { fee_waiver_requested: 1, verifiedEvidence: ['indigency_affidavit'] }, {});
    ok('THE CRITERION: a verified indigency affidavit is AUTO-GRANTED with the program off',
      indigent.outcome === 'auto_granted');
    ok('...naming the category', indigent.mandatoryFired && indigent.mandatoryFired.key === 'indigent');
    ok('...citing the statute that compels it', /1-212\(d\)/.test(indigent.reason));
    ok('...and it fires on an UNCONFIRMED category — the one place unconfirmed config still acts',
      indigent.mandatoryFired.confirmed === false);
    var defender = await AM.evaluateWaiver('jur-ct', { fee_waiver_requested: 1, verifiedEvidence: ['appointment_letter'] }, {});
    ok('a public-defender appointment letter fires its own category', defender.outcome === 'auto_granted' && defender.mandatoryFired.key === 'public_defender');
    var noEvidence = await AM.evaluateWaiver('jur-ct', { fee_waiver_requested: 1, verifiedEvidence: ['something_else'] }, {});
    ok('MANDATORY IS NOT AUTOMATIC-ON-REQUEST: unmatched evidence does not auto-grant', noEvidence.outcome === 'not_offered');

    // and end-to-end through the real intake path
    var r3 = await makeRequest({ feeWaiverRequested: true, verifiedEvidence: ['indigency_affidavit'], description: 'CT mandatory ' + TAG }, created);
    var st3 = await db.get('SELECT fee_waiver_status, fee_waiver_decided_by, fee_waiver_reason FROM requests WHERE id = ?', [r3.childId]);
    ok('end-to-end: intake auto-grants the statutory waiver', st3.fee_waiver_status === 'granted');
    ok('...recorded as decided by statute, not by a person', st3.fee_waiver_decided_by === 'statute');
    var t3 = await waiverTasks(r3.childId);
    ok('...and spawns no approval task (there is no judgment call to route)', t3.length === 0);
    var h3 = await db.get("SELECT action, notes FROM request_history WHERE request_id = ? AND action = 'FEE_WAIVER_GRANTED'", [r3.childId]);
    ok('...with the statutory reason on the request history', !!h3 && /1-212\(d\)/.test(h3.notes));

    // ---- 6. A state with NO statutory waiver cannot have a discretionary one
    await STI.importState('OH', { actor: 'harness-ws4' });
    await setActive('jur-oh');
    await AM.write('jur-oh', { fee_waiver: { enabled: true, mode: 'intake_review' } }, 'harness-ws4');
    var ohCfg = await AM.config('jur-oh');
    ok('OH: the branch profile says there is no waiver program', ohCfg.modules.fee_waiver.branchAvailable === false);
    ok('...so the module is forced off even though the toggle says on', ohCfg.modules.fee_waiver.enabled === false);
    ok('...and OH has no statutory-mandatory categories either', ohCfg.mandatory.length === 0);
    var ohEval = await AM.evaluateWaiver('jur-oh', { fee_waiver_requested: 1 }, {});
    ok('...a waiver request there is answered honestly, and processing continues',
      ohEval.outcome === 'not_offered' && /no statutory fee-waiver program/.test(ohEval.reason));
    var ohGate = await AM.estimateCommunicationGate('jur-oh', { fee_waiver_requested: 1, fee_waiver_status: null });
    ok('...and the estimate is NOT blocked waiting for a decision nobody will make',
      ohGate.blocked === false && ohGate.notOffered === true);

    // ---- 7. COMMERCIAL classifies at intake.
    // Exercised on NJ, not TX: Texas's research carries no commercial-rate branch, so the module is
    // correctly forced off there — which is itself worth asserting, and is why the mode tests need a
    // state that actually has one. (TX is imported first so this holds however the harness is run.)
    await setActive(savedActive);
    await STI.importState('TX', { actor: 'harness-ws4' });
    await AM.write(savedActive, { commercial_rate: { enabled: true, mode: 'routed_task', routed_task: { assignee_role: 'FINANCE', task_name: 'Confirm commercial classification' } } }, 'harness-ws4');
    var txCm = await AM.config(savedActive);
    ok('TX: the branch profile says there is no commercial rate', txCm.modules.commercial_rate.branchAvailable === false);
    ok('...so the module is forced off even with the toggle on', txCm.modules.commercial_rate.enabled === false);
    var txEval = await AM.evaluateCommercial(savedActive, { purpose: 'standard' }, {});
    ok('...and there is nothing to classify', txEval.outcome === 'not_offered' && /no statutory commercial rate/.test(txEval.reason));

    var njCfg = await AM.config('jur-nj');
    ok('the NJ fixture is present', njCfg.code === 'NJ');
    await AM.write('jur-nj', { commercial_rate: { enabled: true, mode: 'routed_task', routed_task: { assignee_role: 'FINANCE', task_name: 'Confirm commercial classification' } } }, 'harness-ws4');
    var cm = await AM.evaluateCommercial('jur-nj', { purpose: 'standard' }, {});
    ok('NJ commercial: enabled and awaiting a decision', cm.enabled === true && cm.outcome === 'needs_decision');
    ok('...routed per the configured mode', cm.route.mode === 'routed_task' && cm.route.task_name === 'Confirm commercial classification');
    var cmOverride = await AM.evaluateCommercial('jur-nj', { purpose: 'standard' }, { classifyAs: 'commercial' });
    ok('classifying a self-declared standard request as commercial is an OVERRIDE', cmOverride.overridesDeclaration === true);
    ok('...and an override is ALWAYS communicated (it changes the invoice, maybe the deadline)', cmOverride.mustCommunicate === true);
    var cmAgree = await AM.evaluateCommercial('jur-nj', { purpose: 'commercial' }, { classifyAs: 'commercial' });
    ok('agreeing with the requester is not an override', cmAgree.overridesDeclaration === false && cmAgree.mustCommunicate === false);
    // NJ / IL change the response clock on classification — the module says so rather than inventing a number.
    ok('NJ: the module warns that commercial changes the response clock', !!cm.clockEffect && /BEFORE quoting a deadline/.test(cm.clockEffect));
    ok('...without inventing the duration (that is deadline config, not this module)', !/14/.test(cm.clockEffect));

    // ---- 8. AN UNROUTABLE ROLE IS REFUSED, not silently corrected
    var threw = null;
    try { await AM.write(savedActive, { fee_waiver: { enabled: true, mode: 'routed_task', routed_task: { assignee_role: 'NOT_A_ROLE', task_name: 'x' } } }, 'harness-ws4'); }
    catch (e) { threw = e; }
    ok('a routed_task pointed at a role nobody holds is REFUSED', !!threw && /no one is eligible/.test(threw.message));
    ok('...explaining that the task would block the estimate behind it', !!threw && /block the estimate/.test(threw.message));
    // and if one is already stored, integrity reports it
    await JR.write(savedActive, AM.DOMAIN, { fee_waiver: { enabled: true, mode: 'routed_task', routed_task: { assignee_role: 'GHOST_ROLE', task_name: 'x' } } }, 'ws4-direct');
    var ri = await CI.check();
    ok('an already-stored unroutable role is an integrity ERROR',
      ri.findings.some(function (f) { return f.severity === 'error' && /pool to nobody/.test(f.issue); }));

  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack);
    fail++;
  } finally {
    try {
      if (savedActive) await setActive(savedActive);
      await db.run("DELETE FROM jurisdiction_rules WHERE domain = 'approval_modules'");
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t = 0; t < tabs.length; t++) for (var c = 0; c < created.length; c++) {
        if (!created[c]) continue;
        try { await db.run('DELETE FROM ' + tabs[t].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c2 = 0; c2 < created.length; c2++) { if (created[c2]) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c2]]); } catch (e) {} } }
      var left = await db.get('SELECT COUNT(*)::int AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 harness requests left', Number(left.n) === 0);
      var back = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
      ok('cleanup: active jurisdiction restored to ' + savedActive, back === savedActive);
      var fin = realErrors((await CI.check()).findings);
      ok('cleanup: config integrity clean (' + fin.length + ' errors)', fin.length === 0);
    } catch (e) { console.error('CLEANUP ERR', e && e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
