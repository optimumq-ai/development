'use strict';
// PHASE 7 / WS3 — clock-matrix reconciliation: the ten named timers become engine clocks, and the engine
// can finally tell a statutory deadline from a city service target.
//
// The claims under test, one per acceptance criterion in docs/SPEC_phase7_build.md:
//   1. TX shows the hard 10-business-day and 15-business-day AG clocks and the 60-day unclaimed timer
//      (TX-S05, § 552.221(e)).
//   2. OH shows ONLY operational targets — no legal deadline is manufactured for a state whose statute
//      says "within a reasonable period of time".
//   3. Existing seeded deadline rules keep working: IL, CA and the live TX config are untouched, and
//      every clock written before the kind taxonomy existed is still policed by the strict 1..45 band.
//
// Plus the two things that would be silent failures:
//   4. Deemed disclosure (§ 552.302) is an EXPOSURE on the AG duty clock, never a clock of its own.
//   5. An unset service target never becomes a request_clock, so no request is given a fabricated due
//      date in a soft-standard state.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var CM = require('/opt/optimumq/backend/src/services/clockMatrix');
var STI = require('/opt/optimumq/backend/src/services/stateTemplateImport');
var TOLL = require('/opt/optimumq/backend/src/services/tolling');
var CI = require('/opt/optimumq/backend/src/services/configIntegrity');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');

var TAG = 'CLOCKMX-' + Date.now();
var pass = 0, fail = 0;
// This harness WRITES config (it imports TX and OH and stamps scratch rows), and configIntegrity's first
// invariant is "no live rule may be stamped by a test" — which is exactly what those writes look like,
// correctly. Those findings are the guard doing its job on the harness itself, so they are filtered out
// here rather than silenced anywhere real: the assertions below are about the DURATION BANDS, and a
// harness that used an innocent-looking actor name to dodge the stamp check would be gaming the one
// invariant that caught the 2026-07-14 contamination.
function realErrors(findings, where) {
  return (findings || []).filter(function (f) {
    if (f.severity !== 'error') return false;
    if (/A harness has leaked into production config/.test(f.issue)) return false;
    return where ? f.where.indexOf(where) === 0 : true;
  });
}
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
async function setActive(jid) {
  await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [jid]);
}

(async function () {
  await db.initDb();
  var savedActive = null, savedTxDeadline = null, created = [];
  try {
    savedActive = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
    savedTxDeadline = (await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = 'deadline'") || {}).config_json;
    ok('the live TX deadline config is captured for restore', !!savedTxDeadline);

    await STI.importState('TX', { actor: 'harness-ws3' });
    await STI.importState('OH', { actor: 'harness-ws3' });

    var tx = await CM.forJurisdiction('jur-tx', {});
    var oh = await CM.forJurisdiction('jur-oh', {});
    ok('TX clock matrix reconciles', !!tx);
    ok('OH clock matrix reconciles', !!oh);
    var TXC = tx.config.clocks, OHC = oh.config.clocks;

    // ---- 1. THE ACCEPTANCE CRITERION: TX's hard AG clocks + the 60-day unclaimed timer
    ok('TX has the 10-business-day AG referral clock (§ 552.301(b))',
      !!TXC.ag_ruling && TXC.ag_ruling.duration === 10 && TXC.ag_ruling.basis === 'business_days');
    ok('...and it is a hard agency duty, not a target', TXC.ag_ruling.kind === 'agency_action');
    ok('...citing the statute', /552\.301|552\.221/.test(TXC.ag_ruling.citation || ''));
    ok('TX has the 15-business-day AG briefing clock (§ 552.301(e))',
      !!TXC.ag_submission && TXC.ag_submission.duration === 15 && TXC.ag_submission.basis === 'business_days');
    ok('...distinct from the 10-day referral (two duties, two clocks)', TXC.ag_ruling.duration !== TXC.ag_submission.duration);
    ok('TX has the 60-day unclaimed / nonpayment timer (TX-S05, § 552.221(e))',
      !!TXC.nonpayment_window && TXC.nonpayment_window.duration === 60 && TXC.nonpayment_window.basis === 'calendar_days');
    ok('...and it is the REQUESTOR\'s window, not an agency deadline', TXC.nonpayment_window.kind === 'requestor_window');
    ok('...sourced to TX-S05', (TXC.nonpayment_window.source_rule_ids || []).indexOf('TX-S05') >= 0);
    ok('TX has the 61-day clarification window (§ 552.222(d))',
      !!TXC.clarification_window && TXC.clarification_window.duration === 61 && TXC.clarification_window.kind === 'requestor_window');
    ok('TX has the 10-business-day certify-a-delay duty (§ 552.221(d))',
      !!TXC.certify_delay && TXC.certify_delay.duration === 10 && TXC.certify_delay.kind === 'agency_action');
    // The rule-id override earns its keep here: without it TX-0009 would be slot 1 and Texas would be
    // given a 10-business-day statutory PRODUCTION deadline that does not exist.
    ok('...and TX-0009 did NOT become a statutory production deadline',
      (TXC.certify_delay.source_rule_ids || []).indexOf('TX-0009') >= 0 &&
      (!TXC.complete || TXC.complete.kind === 'operational_target'));
    ok('TX production duty is a SERVICE TARGET — its statute says "promptly", with no number',
      !!TXC.complete && TXC.complete.kind === 'operational_target' && TXC.complete.duration === null);
    ok('...so TX reconciles to NO statutory response clock, and says so', !tx.report.primary && !!tx.report.noPrimary);

    // ---- 2. THE OTHER ACCEPTANCE CRITERION: OH shows only operational targets
    var ohKinds = Object.keys(OHC).map(function (k) { return OHC[k].kind; });
    ok('OH reconciles to operational targets and nothing else',
      ohKinds.length > 0 && ohKinds.every(function (k) { return k === 'operational_target'; }));
    ok('...none of them carries a duration (no number was invented)',
      Object.keys(OHC).every(function (k) { return OHC[k].duration === null; }));
    ok('...none of them is primary', Object.keys(OHC).every(function (k) { return !OHC[k].primary; }));
    ok('OH\'s response target records that the DUTY exists but the time does not (OH-0008)',
      !!OHC.respond && (OHC.respond.source_rule_ids || []).indexOf('OH-0008') >= 0);
    ok('...and its note refuses the phrase "legal deadline"', /NOT a legal deadline/.test(OHC.respond.note || ''));
    ok('OH gets ONE response-family target, not two (respond vs complete)',
      !!OHC.respond && !OHC.complete);

    // ---- 3. DEEMED DISCLOSURE IS AN EXPOSURE, NOT A CLOCK
    ok('§ 552.302 deemed disclosure is NOT a clock of its own',
      !Object.keys(TXC).some(function (k) { return (TXC[k].source_rule_ids || []).indexOf('TX-0022') >= 0; }));
    ok('...it rides on the AG duty clock as an exposure',
      !!(TXC.ag_ruling.exposures || []).length && TXC.ag_ruling.exposures[0].rule_id === 'TX-0022');
    ok('...flagged warning-only', TXC.ag_ruling.exposures[0].warningOnly === true);

    // Tolling rules are behaviour, not timers.
    ok('City of Dallas v. Abbott (TX-0015) is recorded as TOLLING, not a clock',
      tx.report.tolling.some(function (t) { return t.rule_id === 'TX-0015'; }));
    ok('the catastrophe suspension (TX-S04) is a suspension, not a clock',
      !!tx.report.suspension && tx.report.suspension.rules.some(function (r) { return r.rule_id === 'TX-S04'; }));

    // ---- 4. EXISTING SEEDED RULES KEEP WORKING
    var il = await JR.read('jur-il', 'deadline');
    var ca = await JR.read('jur-ca', 'deadline');
    ok('IL still has its 5-business-day respond clock', !!il && il.clocks.respond.default === 5 && il.clocks.respond.basis === 'business_days');
    ok('CA still has its 10-calendar-day determine clock', !!ca && ca.clocks.respond.default === 10 && ca.clocks.respond.basis === 'calendar_days');
    ok('a clock with no `kind` reads as `response` — the strict band still applies to every legacy config',
      CM.kindOf(il.clocks.respond) === 'response' && CM.kindOf({}) === 'response');
    ok('...and a legacy clock is still a LEGAL deadline', CM.isLegalDeadline(il.clocks.respond) === true);
    ok('an operational target is NOT a legal deadline', CM.isLegalDeadline(OHC.respond) === false);
    ok('a requestor window is NOT a legal deadline the agency is judged against', CM.isLegalDeadline(TXC.nonpayment_window) === false);

    var txLive = await JR.read('jur-tx', 'deadline');
    ok('the LIVE TX deadline config was not overwritten (re-import proposes, never replaces)',
      JSON.stringify(txLive) === JSON.stringify(JSON.parse(savedTxDeadline)));
    ok('...so TX keeps its existing primary respond clock', !!txLive.clocks.respond && txLive.clocks.respond.primary === true);

    // ---- 5. INTEGRITY: the widened bands did not weaken the response band
    var r = await CI.check();
    var rErr = realErrors(r.findings);
    ok('config integrity is clean with the reconciled configs in place (' + rErr.length + ' errors): ' +
       rErr.map(function (f) { return f.where; }).join(' '), rErr.length === 0);

    // The 77 must still be caught. Write it onto a scratch jurisdiction as a `response` clock.
    var FAKE = 'jur-ws3-' + Date.now();
    await db.run("INSERT INTO jurisdiction_profiles (id, code, name, status) VALUES (?,?,?,?)", [FAKE, 'ZZ', 'WS3 Test', 'library']);
    await JR.write(FAKE, 'deadline', { version: 1, weekend: [0, 6], holidays: [], clocks: {
      respond: { label: 'x', basis: 'calendar_days', default: 77, startOn: 'intake', primary: true }
    } }, 'ws3-harness');
    var r77 = await CI.check();
    ok('a 77-day RESPONSE clock is still an error — the tight band survived WS3',
      r77.findings.some(function (f) { return f.severity === 'error' && /77/.test(f.issue) && f.where.indexOf(FAKE) === 0; }));

    // But the same number as a requestor window is fine — that is the whole point of the kinds.
    await JR.write(FAKE, 'deadline', { version: 1, weekend: [0, 6], holidays: [], clocks: {
      nonpayment_window: { label: 'x', kind: 'requestor_window', basis: 'calendar_days', duration: 90, startOn: 'demand' }
    } }, 'ws3-harness');
    var r90 = await CI.check();
    ok('a 90-day REQUESTOR window is accepted (MO pays in 90 days; 150 above $1,000)',
      realErrors(r90.findings, FAKE).length === 0);

    // A service target may never be primary — it would be published as the statutory deadline.
    await JR.write(FAKE, 'deadline', { version: 1, weekend: [0, 6], holidays: [], clocks: {
      respond: { label: 'x', kind: 'operational_target', basis: 'business_days', duration: 5, startOn: 'intake', primary: true }
    } }, 'ws3-harness');
    var rTarget = await CI.check();
    ok('a PRIMARY operational target is an error (a city target must never be published as the law)',
      rTarget.findings.some(function (f) { return f.severity === 'error' && /operational TARGET but is marked primary/.test(f.issue) && f.where.indexOf(FAKE) === 0; }));

    // Two primaries = two legal due dates, resolved today by row age.
    await JR.write(FAKE, 'deadline', { version: 1, weekend: [0, 6], holidays: [], clocks: {
      respond: { label: 'a', basis: 'calendar_days', duration: 10, startOn: 'intake', primary: true },
      complete: { label: 'b', basis: 'calendar_days', duration: 20, startOn: 'intake', primary: true }
    } }, 'ws3-harness');
    var rTwo = await CI.check();
    ok('two primary clocks is an error', rTwo.findings.some(function (f) { return f.severity === 'error' && /marked primary/.test(f.issue) && f.where.indexOf(FAKE) === 0; }));
    await db.run("DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ?", [FAKE]);
    await db.run("DELETE FROM jurisdiction_profiles WHERE id = ?", [FAKE]);

    // ---- 6. AN UNSET TARGET NEVER BECOMES A CLOCK ON A REQUEST
    // This is the failure that would be invisible: durationFor() answers 10 for a def with no duration,
    // so without the guard every Ohio request would silently acquire a ten-day deadline nobody legislated.
    await setActive('jur-oh');
    var rules = await TOLL.loadRules();
    ok('OH is the active jurisdiction and its rules load', !!rules && !!rules.clocks);
    ok('...with every clock an unset target', Object.keys(rules.clocks).every(function (k) { return rules.clocks[k].duration == null && rules.clocks[k].default == null; }));
    var made = await RC.createRequest({
      requestorName: 'WS3 Harness', requestorEmail: 'ws3@example.com', description: 'Clock matrix harness ' + TAG
    }, { actorName: 'harness', kickIntake: false });
    created.push(made.parentId, made.childId);
    var clocks = await db.all("SELECT clock_type, duration FROM request_clocks WHERE request_id = ?", [made.parentId]);
    ok('a request in a soft-standard state gets NO fabricated clock', clocks.length === 0);
    var dl = await db.get("SELECT deadline_date FROM requests WHERE id = ?", [made.parentId]);
    ok('...and no fabricated deadline_date', !dl.deadline_date);

    // Under TX (which has a real seeded respond clock) the same path DOES produce one.
    await setActive('jur-tx');
    var made2 = await RC.createRequest({
      requestorName: 'WS3 Harness', requestorEmail: 'ws3b@example.com', description: 'Clock matrix harness TX ' + TAG
    }, { actorName: 'harness', kickIntake: false });
    created.push(made2.parentId, made2.childId);
    var clocks2 = await db.all("SELECT clock_type, duration, is_primary FROM request_clocks WHERE request_id = ?", [made2.parentId]);
    ok('a request in a state WITH a statutory clock still gets one', clocks2.length > 0 && clocks2.some(function (c) { return c.clock_type === 'respond'; }));
    ok('...and it is primary', clocks2.some(function (c) { return Number(c.is_primary) === 1; }));

    // ---- 7. computeStatus tells a caller what kind of date it is holding
    var primaryClock = await db.get("SELECT * FROM request_clocks WHERE request_id = ? AND is_primary = 1", [made2.parentId]);
    var st = TOLL.computeStatus(primaryClock, [], await TOLL.loadRules());
    ok('computeStatus reports the clock kind', st.kind === 'response');
    ok('...and that it IS a legal deadline', st.legalDeadline === true);
    ok('...and that it is not a service target', st.operationalTarget === false);
    var fakeTarget = { id: 'x', request_id: made2.parentId, clock_type: 'complete', label: 'c', basis: 'business_days', duration: 5, started_at: '2026-01-01', status: 'running', is_primary: 0 };
    var stT = TOLL.computeStatus(fakeTarget, [], { weekend: [0, 6], holidays: [], clocks: { complete: TXC.complete } });
    ok('a service target reports legalDeadline=false', stT.legalDeadline === false && stT.operationalTarget === true);
    ok('...and its overdue banner says it is the CITY target, not the law',
      stT.isOverdue && /CITY SERVICE TARGET/.test(stT.overdueMeaning || ''));

  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack);
    fail++;
  } finally {
    try {
      if (savedActive) await setActive(savedActive);
      if (savedTxDeadline) await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id = 'jur-tx' AND domain = 'deadline'", [savedTxDeadline]);
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
      var fin = await CI.check();
      var finErr = realErrors(fin.findings);
      ok('cleanup: config integrity clean (' + finErr.length + ' errors)', finErr.length === 0);
    } catch (e) { console.error('CLEANUP ERR', e && e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
