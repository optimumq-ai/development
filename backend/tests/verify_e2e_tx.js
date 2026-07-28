'use strict';
// PHASE 7 / WS6 — SCENARIO 1: TEXAS. Hard clock + the Attorney-General referral path.
//
// This is the whole of Phase 7 exercised on one state through the real paths: WS1 imports the template,
// WS3's reconciled clock config is APPROVED through the ordinary config-proposal machinery, a citizen
// submits through the public portal, and the request walks the AG band that Texas has and Ohio does not.
//
//   WS1  the template imports, and the deadline change arrives as a PROPOSAL because TX already had a
//        config — approved here through effectiveConfig.applyConfig, which is what a reviewer does
//   WS2  the branch profile says TX has the AG band, so asserting an exemption goes to the AG and the
//        `ag_review` stage exists
//   WS3  the hard 10-business-day AG clock and 15-business-day briefing clock, the 60-day unclaimed
//        window, and § 552.302 deemed disclosure recorded as an exposure rather than a countdown
//   WS4  TX has a statutory fee-waiver program, so the module is available
//   WS5  the requestor ledger carries the § 552.263(c) rule at its $100 threshold
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
var TOLL = require('/opt/optimumq/backend/src/services/tolling');
var EC = require('/opt/optimumq/backend/src/services/effectiveConfig');

var TAG = 'E2ETX-' + Date.now();
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
    body: JSON.stringify({ description: desc, requestorName: 'TX E2E', requestorEmail: 'txe2e@example.com' })
  });
  return r.status;
}

(async function () {
  await db.initDb();
  var savedActive = null, savedDeadline = null;
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);
    savedActive = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
    savedDeadline = (await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id='jur-tx' AND domain='deadline'") || {}).config_json;
    ok('fixture ready (actor + saved TX deadline config)', !!TOKEN && !!savedDeadline);

    // ---- WS1: import the template. TX already has config, so `deadline` arrives as a proposal.
    var imp = await STI.importState('TX', { actor: 'e2e-tx' });
    ok('WS1: TX imports', imp.code === 'TX');
    ok('...and the deadline change is a PROPOSAL, not an overwrite',
      imp.proposed.some(function (p) { return p.domain === 'deadline'; }) || imp.unchanged.indexOf('deadline') >= 0);
    var prop = await db.get("SELECT id, proposed_json FROM config_proposals WHERE jurisdiction_id='jur-tx' AND domain='deadline' AND status='pending' ORDER BY created_at DESC LIMIT 1");
    if (prop) {
      // A reviewer approving it — the ordinary path, not a back door.
      await EC.applyConfig('jur-tx', 'deadline', JSON.parse(prop.proposed_json), 'e2e-tx', 'proposal_approved', 'E2E: approve the reconciled clock matrix');
      await db.run("UPDATE config_proposals SET status='applied' WHERE id = ?", [prop.id]);
    }
    var dl = await JR.read('jur-tx', 'deadline');
    ok('...and once approved the config carries the reconciled clocks', !!dl && !!dl.clocks);

    await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', 'jur-tx') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");

    // ---- WS3: the hard clocks
    ok('WS3: TX keeps a PRIMARY response clock', !!dl.clocks.respond && dl.clocks.respond.primary === true);
    ok('WS3: the 10-business-day AG referral clock is configured (§ 552.301(b))',
      !!dl.clocks.ag_ruling && Number(dl.clocks.ag_ruling.duration) === 10 && dl.clocks.ag_ruling.basis === 'business_days');
    ok('WS3: the 15-business-day AG briefing clock is configured (§ 552.301(e))',
      !!dl.clocks.ag_submission && Number(dl.clocks.ag_submission.duration) === 15 && dl.clocks.ag_submission.basis === 'business_days');
    ok('WS3: the 60-day unclaimed / nonpayment window is configured (TX-S05)',
      !!dl.clocks.nonpayment_window && Number(dl.clocks.nonpayment_window.duration) === 60);
    ok('WS3: § 552.302 deemed disclosure rides on the AG clock as an EXPOSURE',
      (dl.clocks.ag_ruling.exposures || []).some(function (e) { return e.rule_id === 'TX-0022' && e.warningOnly === true; }));
    ok('...and is not a clock of its own',
      !Object.keys(dl.clocks).some(function (k) { return (dl.clocks[k].source_rule_ids || []).indexOf('TX-0022') >= 0; }));
    ok('WS3: the requestor windows are not judged as agency deadlines',
      CM.isLegalDeadline(dl.clocks.nonpayment_window) === false && CM.isLegalDeadline(dl.clocks.ag_ruling) === true);

    // ---- a citizen submits, through the public portal
    var code = await submit('Texas end-to-end scenario ' + TAG);
    ok('a public submission is accepted (' + code + ')', code === 201 || code === 200);
    var req = null;
    for (var i = 0; i < 80 && !req; i++) { req = await db.get('SELECT id, master_request_id, stage, deadline_date FROM requests WHERE description LIKE ?', ['%' + TAG + '%']); await sleep(250); }
    ok('the request lands', !!req);
    created.push(req.id, req.master_request_id);
    var parentId = req.master_request_id || req.id;

    // ---- THE HARD CLOCK: a statutory due date exists and it is on the parent
    var clocks = null;
    for (var c2 = 0; c2 < 40 && !(clocks && clocks.length); c2++) { clocks = await db.all("SELECT clock_type, duration, basis, is_primary FROM request_clocks WHERE request_id = ?", [parentId]); await sleep(250); }
    ok('TX HARD CLOCK: the statutory clock starts on the parent', !!clocks && clocks.length > 0);
    ok('...exactly one of them is primary', clocks.filter(function (x) { return Number(x.is_primary) === 1; }).length === 1);
    var withDeadline = await db.get('SELECT deadline_date FROM requests WHERE id = ?', [parentId]);
    ok('...and it writes a real due date', !!withDeadline.deadline_date);
    var primary = await db.get("SELECT * FROM request_clocks WHERE request_id = ? AND is_primary = 1", [parentId]);
    var status = TOLL.computeStatus(primary, [], await TOLL.loadRules());
    ok('...which the engine reports as a LEGAL deadline', status.legalDeadline === true && status.operationalTarget === false);

    // ---- WS2: THE AG BAND REPLACES STAFF DENIAL
    ok('WS2: the branch profile says TX has the AG band', (await BP.isActive('jur-tx', 'ag_referral')) === true);
    ok('...so the ag_review stage is available here', (await BP.stageBlocked('jur-tx', 'ag_review')) === false);
    var stagesRes = await api('GET', '/stages');
    ok('...and the API reports nothing unavailable for TX', stagesRes.status === 200 && (stagesRes.body.unavailable || []).length === 0);

    var assertRes = await api('POST', '/requests/' + req.id + '/assert-exemption', { note: 'E2E withholding' });
    ok('asserting an exemption is accepted (' + assertRes.status + ')', assertRes.status === 200);
    ok('THE AG PATH: it lands in ag_review, not staff review', assertRes.body && assertRes.body.stage === 'ag_review');
    ok('...decided from the branch profile', assertRes.body && assertRes.body.agBand && assertRes.body.agBand.band === true);
    ok('...and the response clock is TOLLED while the AG holds it', assertRes.body && assertRes.body.tolled === true);
    var agClock = await db.get("SELECT id, duration, basis FROM request_clocks WHERE request_id = ? AND clock_type = 'ag_ruling'", [parentId]);
    ok('...on a 10-business-day AG clock', !!agClock && Number(agClock.duration) === 10 && agClock.basis === 'business_days');
    var legalTask = await db.get("SELECT id, type, status FROM tasks WHERE request_id = ? AND type = 'legal_review' AND status IN ('open','assigned','in_progress')", [req.id]);
    ok('...with a legal_review task on the work row', !!legalTask);

    // ---- the ruling closes what the assertion opened
    var ruling = await api('POST', '/requests/' + req.id + '/ag-ruling', { outcome: 'sustained', note: 'E2E ruling' });
    ok('recording the AG ruling is accepted (' + ruling.status + ')', ruling.status === 200);
    ok('...moving to redaction_review', ruling.body && ruling.body.stage === 'redaction_review');
    ok('...satisfying the AG clock and resuming the response clock', ruling.body && ruling.body.agSatisfied === true && ruling.body.resumed === true);
    var staleLegal = await db.get("SELECT id FROM tasks WHERE request_id = ? AND type = 'legal_review' AND status IN ('open','assigned','in_progress')", [req.id]);
    ok('...and the legal_review task does not stay claimable', !staleLegal);

    // ---- WS4 / WS5 on the same state
    var am = await AM.config('jur-tx');
    ok('WS4: TX has a statutory fee-waiver program available', am.modules.fee_waiver.branchAvailable === true);
    ok('WS4: TX has no commercial rate, so that module cannot be switched on', am.modules.commercial_rate.branchAvailable === false);
    var led = await RL.config('jur-tx');
    ok('WS5: the § 552.263(c) prior-balance rule is present at $100', led.prior_balance.rule_id === 'TX-0035' && led.prior_balance.threshold_usd === 100);
    ok('...and off until the city elects it', led.prior_balance.enabled === false);

  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack);
    fail++;
  } finally {
    try {
      if (savedActive) await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [savedActive]);
      if (savedDeadline) await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id='jur-tx' AND domain='deadline'", [savedDeadline]);
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
