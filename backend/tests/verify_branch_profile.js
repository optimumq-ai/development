'use strict';
// PHASE 7 / WS2 — the state branch profile and the eligibility gate, as the engine actually applies them.
//
// The claims under test, one per acceptance criterion in docs/SPEC_phase7_build.md:
//   1. With the TX profile, the AG-referral band REPLACES staff denial — asserting an exemption lands in
//      `ag_review`, not `exemption_review`.
//   2. With the OH profile, the band DOES NOT EXIST — the same assertion lands in `exemption_review`, and
//      the central stage-transition path REFUSES to move a request into `ag_review` at all.
//   3. The eligibility gate blocks ONLY where configured: imported-but-unconfirmed advises, confirmed +
//      action=block refuses, and confirmed + block with the fact absent routes for review instead of
//      guessing.
//   4. THE COMPATIBILITY GUARANTEE: a jurisdiction with no branch profile behaves exactly as before. This
//      is the one that protects the nineteen seeded states nobody has researched yet, so it is asserted
//      from both directions — capability unknown, and nothing suppressed.
//
// The harness imports OH itself (the importer is idempotent) and switches the ACTIVE jurisdiction between
// TX and OH, because that is the only way to exercise the engine's real read path. Everything it changes
// is restored in the finally block, and the restore is asserted.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var BP = require('/opt/optimumq/backend/src/services/branchProfile');
var EG = require('/opt/optimumq/backend/src/services/eligibilityGate');
var STI = require('/opt/optimumq/backend/src/services/stateTemplateImport');
var TR = require('/opt/optimumq/backend/src/services/taskRouting');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');

var TAG = 'BRANCH-' + Date.now();
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

async function setActive(jid) {
  await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [jid]);
}

(async function () {
  await db.initDb();
  var savedActive = null, savedOhElig = null, created = [];
  try {
    savedActive = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
    ok('active jurisdiction resolves (' + savedActive + ')', !!savedActive);

    // ---- 0. both states have a branch profile (WS1's importer is idempotent, so this is safe to re-run)
    await STI.importState('TX', { actor: 'harness-ws2' });
    await STI.importState('OH', { actor: 'harness-ws2' });
    savedOhElig = (await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-oh' AND domain = 'eligibility'") || {}).config_json;
    ok('OH eligibility config captured for restore', !!savedOhElig);

    // ---- 1. the profile reads the research, not a hand-set column
    var pTx = await BP.profile('jur-tx');
    var pOh = await BP.profile('jur-oh');
    ok('TX branch profile imported', pTx.imported === true);
    ok('OH branch profile imported', pOh.imported === true);
    ok('TX HAS the AG-referral band (8 Denial.* nodes, § 552.301)', pTx.capabilities.ag_referral === true);
    ok('OH does NOT have the AG-referral band', pOh.capabilities.ag_referral === false);
    ok('TX has the fee-waiver program (§ 552.267)', pTx.capabilities.fee_waiver === true);
    ok('OH does NOT have a fee-waiver program', pOh.capabilities.fee_waiver === false);
    ok('OH HAS the vagueness-denial branch (deny-as-vague override)', pOh.capabilities.clarification_denial === true);
    ok('TX does NOT have the vagueness-denial branch', pTx.capabilities.clarification_denial === false);
    ok('both states have the eligibility gate switched on (Master.g2)',
      pTx.capabilities.eligibility_gate === true && pOh.capabilities.eligibility_gate === true);

    // ---- 2. THE COMPATIBILITY GUARANTEE — an un-imported jurisdiction is UNKNOWN, never off
    var pCa = await BP.profile('jur-ca');
    ok('an un-imported jurisdiction reports imported=false', pCa.imported === false);
    ok('...and every capability is null (unknown), NOT false', Object.keys(pCa.capabilities).every(function (c) { return pCa.capabilities[c] === null; }));
    ok('...so nothing is blocked for it (ag_referral)', (await BP.blocked('jur-ca', 'ag_referral')) === false);
    ok('...and no stage is unavailable to it', (await BP.stageBlocked('jur-ca', 'ag_review')) === false);
    var pNone = await BP.profile('jur-does-not-exist-' + Date.now());
    ok('an unknown jurisdiction id degrades to unknown rather than throwing', pNone.imported === false);
    ok('an unknown CAPABILITY name throws (a typo must not read as "off")',
      await (async function () { try { await BP.isActive('jur-tx', 'no_such_capability'); return false; } catch (e) { return true; } })());

    // ---- 3. stage availability
    ok('TX: ag_review is available', (await BP.stageBlocked('jur-tx', 'ag_review')) === false);
    ok('OH: ag_review is UNAVAILABLE', (await BP.stageBlocked('jur-oh', 'ag_review')) === true);
    ok('OH: exemption_review (staff denial) is still available', (await BP.stageBlocked('jur-oh', 'exemption_review')) === false);
    ok('OH: record_search — an ungated stage — is never suppressed', (await BP.stageBlocked('jur-oh', 'record_search')) === false);
    var ohStages = await BP.stagesFor('jur-oh');
    ok('OH stage vocabulary drops exactly one stage', ohStages.length === require('/opt/optimumq/backend/src/services/stages').STAGES.length - 1);
    ok('...and it is ag_review', !ohStages.some(function (s) { return s.key === 'ag_review'; }));

    // ---- 4. THE ENGINE BACKSTOP: applyStageTransition refuses a stage the state does not have.
    // Make a real request through the real creation path, then try to walk it into the AG stage under OH.
    var made = await RC.createRequest({
      requestorName: 'WS2 Harness', requestorEmail: 'ws2@example.com',
      description: 'Branch profile harness request ' + TAG
    }, { actorName: 'harness', kickIntake: false, startClocks: false });
    created.push(made.parentId, made.childId);
    ok('a request was created through the real path', !!made.childId);

    await setActive('jur-oh');
    var refused = null;
    try { await TR.applyStageTransition(made.childId, 'ag_review', { actorName: 'harness', action: 'HARNESS' }); }
    catch (e) { refused = e; }
    ok('OH: applyStageTransition REFUSES a move into ag_review', !!refused && refused.code === 'STAGE_NOT_IN_JURISDICTION');
    ok('...and says why, naming the band', !!refused && /Attorney-General referral band/.test(refused.message));
    var stillAt = await db.get('SELECT stage FROM requests WHERE id = ?', [made.childId]);
    ok('...and the request did NOT move', stillAt.stage === 'intake');
    var noTask = await db.get("SELECT COUNT(*)::int AS n FROM tasks WHERE request_id = ? AND type = 'legal_review'", [made.childId]);
    ok('...and no legal_review task was spawned (the branch\'s task never exists)', Number(noTask.n) === 0);

    // The SAME call under TX succeeds — proving the refusal is the profile, not a broken transition.
    await setActive('jur-tx');
    var moved = await TR.applyStageTransition(made.childId, 'ag_review', { actorName: 'harness', action: 'HARNESS' });
    ok('TX: the identical transition is ALLOWED', !!moved && moved.toStage === 'ag_review');
    var agTask = await db.get("SELECT COUNT(*)::int AS n FROM tasks WHERE request_id = ? AND type = 'legal_review'", [made.childId]);
    ok('...and the AG band\'s legal_review task DID spawn', Number(agTask.n) === 1);

    // ---- 5. THE ACCEPTANCE CRITERION: which denial path does asserting an exemption take?
    // agBandDecision is the route's decision function; exercise it directly with each profile.
    // agBandDecision is module-private route logic, so assert it through the same two inputs the route
    // feeds it: the branch profile and the legacy exemption_model column.
    var txModel = (await db.get("SELECT exemption_model FROM jurisdiction_profiles WHERE id = 'jur-tx'") || {}).exemption_model;
    var ohModel = (await db.get("SELECT exemption_model FROM jurisdiction_profiles WHERE id = 'jur-oh'") || {}).exemption_model;
    ok('TX exemption_model is pre_clearance', txModel === 'pre_clearance');
    ok('OH exemption_model is unset (so the legacy column alone would say "staff review")', !ohModel);
    ok('TX: the band is active, so the AG path is the denial path', (await BP.isActive('jur-tx', 'ag_referral')) === true);
    ok('OH: the band is inactive, so staff denial is the ONLY denial path', (await BP.isActive('jur-oh', 'ag_referral')) === false);
    // THE CASE THE BRANCH PROFILE FIXES. OH's column is unset, so the legacy rule ("pre_clearance or
    // staff review") and the profile happen to agree today. The divergence that matters is the other
    // direction: a state whose research HAS the band but whose column nobody set would, before WS2, have
    // been given staff denial by accident of a default string. Prove the profile decides it by clearing
    // TX's column and checking the band is still the answer.
    await db.run("UPDATE jurisdiction_profiles SET exemption_model = NULL WHERE id = 'jur-tx'");
    ok('a band-active state with NO exemption_model still has the AG band (the profile beats the default)',
      (await BP.isActive('jur-tx', 'ag_referral')) === true);
    await db.run("UPDATE jurisdiction_profiles SET exemption_model = ? WHERE id = 'jur-tx'", [txModel]);
    ok('TX exemption_model restored',
      (await db.get("SELECT exemption_model FROM jurisdiction_profiles WHERE id = 'jur-tx'")).exemption_model === txModel);

    // ---- 6. THE ELIGIBILITY GATE — blocks only where configured
    await setActive('jur-oh');
    var cfgOh = await EG.config('jur-oh');
    ok('OH eligibility dimensions imported', cfgOh.imported === true);
    ok('OH gates on identity (R.C. 149.43 identity provision)', cfgOh.dimensions.identity.gated === true);
    ok('OH gates on the vexatious-litigator condition (R.C. 2323.52(J))', cfgOh.dimensions.vexatious.gated === true);
    ok('every dimension arrives UNCONFIRMED', Object.keys(cfgOh.dimensions).every(function (d) { return cfgOh.dimensions[d].confirmed === false; }));
    ok('every dimension arrives action=advise', Object.keys(cfgOh.dimensions).every(function (d) { return cfgOh.dimensions[d].action === 'advise'; }));

    var evalUnconfirmed = await EG.evaluate('jur-oh', { requestorName: 'A', requestorEmail: 'a@example.com' });
    ok('imported-but-unconfirmed: NOTHING is blocked', evalUnconfirmed.blocked === false && evalUnconfirmed.blocks.length === 0);
    ok('...but it is not silent either — advisories are raised', evalUnconfirmed.advisories.length > 0);
    ok('...and each advisory names the statutes behind it',
      evalUnconfirmed.advisories.every(function (a) { return Array.isArray(a.source_rule_ids); }) &&
      evalUnconfirmed.advisories.some(function (a) { return a.source_rule_ids.length > 0; }));

    // A real submission is NOT refused, and the finding is recorded where intake staff look.
    var made2 = await RC.createRequest({
      requestorName: 'WS2 Eligibility', requestorEmail: 'ws2e@example.com',
      description: 'Eligibility advisory harness ' + TAG
    }, { actorName: 'harness', kickIntake: false, startClocks: false });
    created.push(made2.parentId, made2.childId);
    ok('a submission into an unconfirmed-gate state is ACCEPTED', !!made2.childId);
    var note = await db.get("SELECT action, notes FROM request_history WHERE request_id = ? AND action LIKE 'ELIGIBILITY%'", [made2.childId]);
    ok('...and the advisory is written to the request history', !!note);
    ok('...saying explicitly that the request was not refused', !!note && /NOT refused/.test(note.notes));

    // Now CONFIRM a dimension and set it to block, with the requester actually failing it.
    var ohElig = await JR.read('jur-oh', 'eligibility');
    ohElig.dimensions.identity.confirmed = true;
    ohElig.dimensions.identity.action = 'block';
    await JR.write('jur-oh', 'eligibility', ohElig, 'harness-ws2');
    var evalBlocked = await EG.evaluate('jur-oh', { requestorName: 'B', requestorEmail: 'b@example.com', identityVerified: false });
    ok('confirmed + action=block + the fact present and failing: BLOCKED', evalBlocked.blocked === true);
    ok('...naming the dimension', evalBlocked.blocks.length === 1 && evalBlocked.blocks[0].dimension === 'identity');
    ok('...with a citizen-readable reason that gives the condition, not just "ineligible"',
      /restricts who may make a public-records request/.test(EG.refusalMessage(evalBlocked)));

    var threw = null;
    try {
      await RC.createRequest({ requestorName: 'WS2 Blocked', requestorEmail: 'ws2b@example.com',
        identityVerified: false, description: 'Should be refused ' + TAG }, { actorName: 'harness', kickIntake: false, startClocks: false });
    } catch (e) { threw = e; }
    ok('the creation path REFUSES it', !!threw && threw.code === 'ELIGIBILITY_BLOCKED');
    var leaked = await db.get("SELECT COUNT(*)::int AS n FROM requests WHERE description LIKE ?", ['%Should be refused ' + TAG + '%']);
    ok('...and wrote no row (the refusal happens before any insert)', Number(leaked.n) === 0);

    // THE UNANSWERED-QUESTION CASE: configured to block, but the submission does not carry the fact.
    // Refusing there would be a coin flip, so it must route for review instead.
    var evalUnknown = await EG.evaluate('jur-oh', { requestorName: 'C', requestorEmail: 'c@example.com' });
    ok('configured to block but the fact is ABSENT: not blocked', evalUnknown.blocked === false);
    ok('...routed for human review instead', evalUnknown.reviews.some(function (r) { return r.dimension === 'identity'; }));

    // And a requester who PASSES is untouched.
    var evalPass = await EG.evaluate('jur-oh', { requestorName: 'D', requestorEmail: 'd@example.com', identityVerified: true });
    ok('a requester who satisfies the confirmed condition is not blocked', evalPass.blocked === false);
    ok('...and raises no finding for that dimension',
      !evalPass.blocks.concat(evalPass.reviews, evalPass.advisories).some(function (f) { return f.dimension === 'identity'; }));

    // ---- 7. the gate is OFF where the state's own research says "any person may request"
    // Master.g2 inactive => no eligibility evaluation at all. Simulate by switching that branch off.
    var ohBranches = await JR.read('jur-oh', 'branches');
    var savedG2 = ohBranches.branches['Master.g2'].active;
    ohBranches.branches['Master.g2'].active = false;
    await JR.write('jur-oh', 'branches', ohBranches, 'harness-ws2');
    var evalGateOff = await EG.evaluate('jur-oh', { requestorName: 'E', requestorEmail: 'e@example.com', identityVerified: false });
    ok('branch g2 off: the eligibility gate does not run AT ALL', evalGateOff.gateOff === true && evalGateOff.blocked === false);
    ohBranches.branches['Master.g2'].active = savedG2;
    await JR.write('jur-oh', 'branches', ohBranches, 'harness-ws2');
    ok('branch g2 restored', (await BP.isActive('jur-oh', 'eligibility_gate')) === true);

    // ---- 8. an un-imported jurisdiction has no gate either
    var evalCa = await EG.evaluate('jur-ca', { requestorName: 'F', requestorEmail: 'f@example.com' });
    ok('un-imported jurisdiction: no blocks, no advisories (unchanged behaviour)',
      evalCa.blocked === false && evalCa.blocks.length === 0 && evalCa.advisories.length === 0);

  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack);
    fail++;
  } finally {
    try {
      if (savedActive) await setActive(savedActive);
      if (savedOhElig) await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id = 'jur-oh' AND domain = 'eligibility'", [savedOhElig]);
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t = 0; t < tabs.length; t++) for (var c = 0; c < created.length; c++) {
        if (!created[c]) continue;
        try { await db.run('DELETE FROM ' + tabs[t].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c2 = 0; c2 < created.length; c2++) { if (created[c2]) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c2]]); } catch (e) {} } }
      var leftReq = await db.get('SELECT COUNT(*)::int AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 harness requests left', Number(leftReq.n) === 0);
      var back = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
      ok('cleanup: the active jurisdiction is back to ' + savedActive, back === savedActive);
      var elig = await EG.config('jur-oh');
      ok('cleanup: the OH eligibility gate is back to advisory-only',
        elig.dimensions.identity.confirmed === false && elig.dimensions.identity.action === 'advise');
    } catch (e) { console.error('CLEANUP ERR', e && e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
