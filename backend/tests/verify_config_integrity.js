'use strict';
// CONFIG INTEGRITY. On 2026-07-14 the live TX deadline config was found holding `standard = 77` days (real
// requests were on a 77-day statutory clock) and a `__probe` marker; and the live TX clarification policy was
// found `enabled: true` with no provenance — a policy switched ON in production by a crashed test. Both had
// persisted silently, and both were CEMENTED by the harness's own restore, which trusted whatever it read.
//
// Nothing in the system could see it: the attestation-drift check compares content_hash to attested_hash, and
// nothing is attested, so it had nothing to compare against.
//
// This harness proves the checker catches each contamination class — by injecting it.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var CI = require('/opt/optimumq/backend/src/services/configIntegrity');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

var SAVED = {};
async function snapshot(jid, domain) {
  var r = await db.get('SELECT config_json, updated_by FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, domain]);
  SAVED[jid + '/' + domain] = r;
}
async function restore(jid, domain) {
  var r = SAVED[jid + '/' + domain];
  if (!r) return;
  await db.run('UPDATE jurisdiction_rules SET config_json = ?, updated_by = ? WHERE jurisdiction_id = ? AND domain = ?',
    [r.config_json, r.updated_by, jid, domain]);
}
function findingsAt(res, where, re) {
  return res.findings.filter(function (f) { return f.where === where && re.test(f.issue); });
}

(async function () {
  await db.initDb();
  try {
    await snapshot('jur-tx', 'deadline');
    await snapshot('jur-tx', 'clarification');

    // ---- 0. baseline: the live config is clean RIGHT NOW
    var base = await CI.check();
    ok('BASELINE: the live config is CLEAN — no drift, no test residue (' + base.checked + ' rules checked)',
      base.clean === true && base.errors === 0);
    ok('...and it knows which jurisdiction is live (' + base.activeJurisdiction + ')', base.activeJurisdiction === 'jur-tx');

    // ---- 1. THE ACTUAL BUG: a 77-day standard clock. This is what was in production.
    var cfg = JSON.parse(SAVED['jur-tx/deadline'].config_json);
    cfg.clocks.respond.durationByClassification.standard = 77;
    await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id = 'jur-tx' AND domain = 'deadline'", [JSON.stringify(cfg)]);
    var r1 = await CI.check();
    // WS3 made the band kind-aware, so the message now names the kind. Asserting on `(response)` is the
    // point: the widened bands for requestor windows and service targets must never reach a clock that
    // is — or defaults to — a base response deadline, which is where the 77 lived.
    ok('a 77-day "standard" clock is CAUGHT (the exact value found in production)',
      findingsAt(r1, 'jur-tx/deadline', /\(response\) has an implausible duration/).length === 1);
    ok('...as an ERROR, not a warning', r1.clean === false && r1.errors >= 1);
    await restore('jur-tx', 'deadline');

    // ---- 2. the probe marker that rode along with it
    var cfg2 = JSON.parse(SAVED['jur-tx/deadline'].config_json);
    cfg2.__probe = 'JRULES-12345';
    await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id = 'jur-tx' AND domain = 'deadline'", [JSON.stringify(cfg2)]);
    var r2 = await CI.check();
    ok('a stray `__probe` key is CAUGHT — a config key its schema does not define',
      findingsAt(r2, 'jur-tx/deadline', /Unknown config key "__probe"/).length === 1);
    await restore('jur-tx', 'deadline');

    // ---- 3. a live rule stamped by a test
    await db.run("UPDATE jurisdiction_rules SET updated_by = 'harness-restore' WHERE jurisdiction_id = 'jur-tx' AND domain = 'deadline'");
    var r3 = await CI.check();
    ok('a live rule last written by a TEST is CAUGHT ("harness-restore")',
      findingsAt(r3, 'jur-tx/deadline', /written by a TEST/).length === 1);
    await restore('jur-tx', 'deadline');

    // ---- 4. THE OTHER ACTUAL BUG: a policy switched ON in production, with no citation behind it
    var clar = JSON.parse(SAVED['jur-tx/clarification'].config_json);
    clar.enabled = true;
    clar.provenance = {};
    await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id = 'jur-tx' AND domain = 'clarification'", [JSON.stringify(clar)]);
    var r4 = await CI.check();
    ok('a policy SWITCHED ON with no provenance is CAUGHT — a rule a city adopted has a citation; this does not',
      findingsAt(r4, 'jur-tx/clarification', /SWITCHED ON but carries no citation/).length === 1);
    await restore('jur-tx', 'clarification');

    // ---- 5. an invalid clock basis
    var cfg5 = JSON.parse(SAVED['jur-tx/deadline'].config_json);
    cfg5.clocks.respond.basis = 'moon_phases';
    await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id = 'jur-tx' AND domain = 'deadline'", [JSON.stringify(cfg5)]);
    var r5 = await CI.check();
    ok('an invalid clock basis is CAUGHT', findingsAt(r5, 'jur-tx/deadline', /invalid basis/).length === 1);
    await restore('jur-tx', 'deadline');

    // ---- 6. every finding tells a human how to fix it
    var r6 = await CI.check();
    ok('after every injection is reverted, the config is CLEAN again', r6.clean === true && r6.errors === 0);
    ok('every finding the checker can emit carries a `fix` line',
      [r1, r2, r3, r4, r5].every(function (r) { return r.findings.every(function (f) { return !!f.fix && f.fix.length > 10; }); }));

    // ---- 7. the API surface
    var routeOk = true;
    try { require('/opt/optimumq/backend/src/routes/configIntegrity'); } catch (e) { routeOk = false; }
    ok('GET /api/config-integrity is mounted and loadable', routeOk);

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      await restore('jur-tx', 'deadline');
      await restore('jur-tx', 'clarification');
      var final = await CI.check();
      ok('cleanup: the live config is left exactly as found — CLEAN', final.clean === true && final.errors === 0);
    } catch (e) { console.error('CLEANUP ERR', e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
