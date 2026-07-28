'use strict';
// PHASE 7 / WS6 — SCENARIO 2: OHIO. Soft standard + the staff-denial path.
//
// The mirror image of verify_e2e_tx.js, and the reason both exist: the two states must come out
// DIFFERENT from the same engine, with no per-state code anywhere between them.
//
//   WS1  the template imports into a jurisdiction that had no config at all
//   WS2  the branch profile says OH has NO Attorney-General band, so `ag_review` does not exist here and
//        asserting an exemption goes to staff review — and the central stage path REFUSES the AG stage
//   WS3  OH's response duty is "within a reasonable period of time": no statutory number, so the state
//        reconciles to operational targets only and NO fabricated deadline is put on a citizen's request
//   WS4  OH has no statutory fee-waiver program, so the module cannot be switched on, and a waiver
//        request is answered honestly instead of waiting for a decision nobody will make
//   WS5  OH has no unpaid-prior-balance rule, so that gate does not exist there
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var STI = require('/opt/optimumq/backend/src/services/stateTemplateImport');
var BP = require('/opt/optimumq/backend/src/services/branchProfile');
var CM = require('/opt/optimumq/backend/src/services/clockMatrix');
var AM = require('/opt/optimumq/backend/src/services/approvalModules');
var RL = require('/opt/optimumq/backend/src/services/requestorLedger');
var TR = require('/opt/optimumq/backend/src/services/taskRouting');
var TOLL = require('/opt/optimumq/backend/src/services/tolling');

var TAG = 'E2EOH-' + Date.now();
var pass = 0, fail = 0, TOKEN = null, created = [];
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
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
async function submit(desc) {
  var r = await fetch('http://localhost:' + PORT + '/api/public/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: desc, requestorName: 'OH E2E', requestorEmail: 'ohe2e@example.com', feeWaiverRequested: true })
  });
  return r.status;
}

(async function () {
  await db.initDb();
  var savedActive = null;
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);
    savedActive = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
    ok('fixture ready', !!TOKEN && !!savedActive);

    // ---- WS1: a jurisdiction with NO prior config — everything is written, nothing is overwritten
    var imp = await STI.importState('OH', { actor: 'e2e-oh' });
    ok('WS1: OH imports', imp.code === 'OH');
    ok('...writing its config rather than proposing over one', imp.proposed.filter(function (p) { return p.domain !== 'template_import'; }).length === 0);
    await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', 'jur-oh') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");

    // ---- WS3: THE SOFT STANDARD. No statutory number, so no number.
    var dl = await JR.read('jur-oh', 'deadline');
    ok('WS3: OH has a deadline config', !!dl && !!dl.clocks);
    var kinds = Object.keys(dl.clocks).map(function (k) { return CM.kindOf(dl.clocks[k]); });
    ok('WS3: SOFT STANDARD — every clock is an operational target',
      kinds.length > 0 && kinds.every(function (k) { return k === 'operational_target'; }));
    ok('...none of them carries an invented duration',
      Object.keys(dl.clocks).every(function (k) { return dl.clocks[k].duration == null; }));
    ok('...none of them is primary, so no city target can be published as the law',
      Object.keys(dl.clocks).every(function (k) { return !dl.clocks[k].primary; }));
    ok('...and none is a legal deadline',
      Object.keys(dl.clocks).every(function (k) { return CM.isLegalDeadline(dl.clocks[k]) === false; }));
    ok('...the response target records the duty and cites the rule behind it (OH-0008)',
      !!dl.clocks.respond && (dl.clocks.respond.source_rule_ids || []).indexOf('OH-0008') >= 0);

    // ---- a citizen submits
    var code = await submit('Ohio end-to-end scenario ' + TAG);
    ok('a public submission is accepted (' + code + ')', code === 201 || code === 200);
    var req = null;
    for (var i = 0; i < 80 && !req; i++) { req = await db.get('SELECT id, master_request_id, stage, deadline_date FROM requests WHERE description LIKE ?', ['%' + TAG + '%']); await sleep(250); }
    ok('the request lands', !!req);
    created.push(req.id, req.master_request_id);
    var parentId = req.master_request_id || req.id;

    // THE POINT OF THE SCENARIO: no fabricated deadline. tolling.durationFor() answers 10 for a clock
    // with no duration, so without WS3's guard every Ohio request would silently acquire a ten-day
    // statutory deadline the legislature never set.
    await sleep(1500);
    var clocks = await db.all("SELECT clock_type FROM request_clocks WHERE request_id = ?", [parentId]);
    ok('OH SOFT CLOCK: no statutory clock is started', clocks.length === 0);
    var after = await db.get('SELECT deadline_date FROM requests WHERE id = ?', [parentId]);
    ok('...and no due date is written on the request', !after.deadline_date);
    var rules = await TOLL.loadRules();
    ok('...though the engine did load OH\'s rules (it did not silently fall back to a default clock)',
      !!rules.clocks && Object.keys(rules.clocks).length > 0 && Object.keys(rules.clocks).every(function (k) { return rules.clocks[k].duration == null; }));

    // ---- WS2: THE AG BAND DOES NOT EXIST HERE
    ok('WS2: the branch profile says OH has NO AG band', (await BP.isActive('jur-oh', 'ag_referral')) === false);
    ok('...so the ag_review stage is unavailable', (await BP.stageBlocked('jur-oh', 'ag_review')) === true);
    var stagesRes = await api('GET', '/stages');
    ok('...and the API reports it unavailable', stagesRes.status === 200 && (stagesRes.body.unavailable || []).indexOf('ag_review') >= 0);
    ok('...while the vocabulary itself is unchanged (the frontend mirror stays valid)',
      stagesRes.body.order.indexOf('ag_review') >= 0);

    var assertRes = await api('POST', '/requests/' + req.id + '/assert-exemption', { note: 'E2E withholding' });
    ok('asserting an exemption is accepted (' + assertRes.status + ')', assertRes.status === 200);
    ok('THE STAFF-DENIAL PATH: it lands in exemption_review, not ag_review', assertRes.body && assertRes.body.stage === 'exemption_review');
    ok('...decided from the branch profile, not the legacy column', assertRes.body && assertRes.body.agBand && assertRes.body.agBand.band === false);
    ok('...and no clock is tolled, because there is no AG to wait for', assertRes.body && assertRes.body.tolled === false);
    var legalTask = await db.get("SELECT id FROM tasks WHERE request_id = ? AND type = 'legal_review' AND status IN ('open','assigned','in_progress')", [req.id]);
    ok('...with a legal_review task for the staff reviewer', !!legalTask);
    var hist = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'EXEMPTION_ASSERTED' ORDER BY created_at DESC LIMIT 1", [req.id]);
    ok('...and the record says why: this state has no AG referral band', !!hist && /no Attorney-General referral band/.test(hist.notes || ''));

    // the engine refuses the AG stage even if something tried to force it
    var refused = null;
    try { await TR.applyStageTransition(req.id, 'ag_review', { actorName: 'e2e', action: 'FORCE' }); } catch (e) { refused = e; }
    ok('the central stage path REFUSES a move into ag_review', !!refused && refused.code === 'STAGE_NOT_IN_JURISDICTION');
    var stillAt = await db.get('SELECT stage FROM requests WHERE id = ?', [req.id]);
    ok('...and the request did not move', stillAt.stage === 'exemption_review');

    // ---- WS4: no waiver program, and the requester is told rather than left waiting
    var am = await AM.config('jur-oh');
    ok('WS4: OH has no statutory fee-waiver program', am.modules.fee_waiver.branchAvailable === false);
    ok('...so the module is off however the toggle is set', am.modules.fee_waiver.enabled === false);
    ok('...and OH has no statutory-mandatory categories to fire regardless', am.mandatory.length === 0);
    var wv = await AM.evaluateWaiver('jur-oh', { fee_waiver_requested: 1 }, {});
    ok('...a waiver request is answered honestly and processing continues',
      wv.outcome === 'not_offered' && /no statutory fee-waiver program/.test(wv.reason));
    var gate = await AM.estimateCommunicationGate('jur-oh', { fee_waiver_requested: 1, fee_waiver_status: null });
    ok('...and the estimate is NOT held behind a decision nobody will make', gate.blocked === false && gate.notOffered === true);

    // ---- WS5: no cross-request money gate in this state
    var led = await RL.config('jur-oh');
    ok('WS5: OH has no unpaid-prior-balance rule, so the gate does not exist', led.prior_balance.applies === false);
    var ledEval = await RL.evaluateEstimate('jur-oh', req.id, { estimateTotal: 500 });
    ok('...and nothing fires on a large estimate', ledEval.triggers.length === 0);

  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack);
    fail++;
  } finally {
    try {
      if (savedActive) await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [savedActive]);
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t = 0; t < tabs.length; t++) for (var c = 0; c < created.length; c++) {
        if (!created[c]) continue;
        try { await db.run('DELETE FROM ' + tabs[t].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c3 = 0; c3 < created.length; c3++) { if (created[c3]) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c3]]); } catch (e) {} } }
      var left = await db.get('SELECT COUNT(*)::int AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 scenario requests left', Number(left.n) === 0);
      var back = (await db.get("SELECT value FROM system_config WHERE key='jurisdiction_profile'") || {}).value;
      ok('cleanup: active jurisdiction restored', back === savedActive);
    } catch (e) { console.error('CLEANUP ERR', e && e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
