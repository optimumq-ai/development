'use strict';
// jurisdiction_rules — the per-jurisdiction rule slot.
// The claim under test: a rule is now scoped to a jurisdiction, the jid is LOAD-BEARING (it used to be
// accepted and discarded), the clock engine reads the jurisdiction row, and a jurisdiction with no row
// still works via the legacy fallback. Real paths only (POST /api/public/submit for the end-to-end leg).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var CP = require('/opt/optimumq/backend/src/services/clarificationPolicy');
var TOLL = require('/opt/optimumq/backend/src/services/tolling');
var CE = require('/opt/optimumq/backend/src/services/configExtractors');

var TAG = 'JRULES-' + Date.now();
var FAKE = 'jur-zz-test';
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function submit(d) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify({ description: d, requestorName: 'JR Test', requestorEmail: 'jr@example.com' });
    var r = http.request({ host: 'localhost', port: (Number(process.env.API_PORT) || 3101), path: '/api/public/submit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      function (resp) { resp.on('data', function () {}); resp.on('end', function () { res(resp.statusCode); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}

(async function () {
  await db.initDb();
  var created = [], savedDeadline = null, savedClar = null, activeJid = null;
  try {
    activeJid = await JR.activeJid();
    ok('active jurisdiction resolves (' + activeJid + ')', !!activeJid);

    // ---- 1. the table exists and the boot-time backfill lifted BOTH global blobs onto it
    var rows = await db.all('SELECT jurisdiction_id, domain, config_json, updated_by FROM jurisdiction_rules ORDER BY domain');
    ok('jurisdiction_rules table exists', Array.isArray(rows));
    var byDomain = {}; rows.forEach(function (r) { byDomain[r.jurisdiction_id + '/' + r.domain] = r; });
    var dRow = byDomain[activeJid + '/deadline'], cRow = byDomain[activeJid + '/clarification'];
    // Assert the rows EXIST and hold real config. Do NOT assert updated_by === 'backfill': any later write
    // through the real path (a harness restore, an AI apply, a staff edit) legitimately re-stamps it, and
    // asserting the provenance stamp made this test fail whenever another harness had run first.
    ok('backfill: deadline rules live on ' + activeJid, !!dRow && !!dRow.config_json);
    ok('backfill: clarification policy lives on ' + activeJid, !!cRow && !!cRow.config_json);

    savedDeadline = dRow && dRow.config_json;
    savedClar = cRow && cRow.config_json;

    // GUARD: this harness MUTATES the live TX config and restores it afterwards. If a previous run died
    // mid-flight, the "saved" value would itself be the probe value — and restoring it would cement the
    // corruption forever (this actually happened: standard=77 persisted in the live config). Refuse to run
    // against a dirty config rather than laundering it.
    var pre = JSON.parse(savedDeadline || '{}');
    var preClar = JSON.parse(savedClar || '{}');
    var deadlineClean = !pre.__probe && pre.clocks.respond.durationByClassification.standard === 10;
    // The SAME laundering trap applies to the clarification policy: this harness sets TX to enabled=true
    // with no provenance, and a crashed run would make that the "saved" value forever.
    var clarClean = preClar.enabled !== true && !!(preClar.provenance && preClar.provenance.clarification_clock_effect);
    ok('PRE-FLIGHT: the live TX deadline config is CLEAN (no leftover probe from a crashed run)', deadlineClean);
    ok('PRE-FLIGHT: the live TX clarification policy is CLEAN (a draft, with provenance)', clarClean);
    if (!deadlineClean || !clarClean) {
      throw new Error('The live TX config is contaminated by a crashed run. Repair it (re-run the seeds) ' +
        'before running this harness — restoring a dirty snapshot would cement the corruption.');
    }

    // the backfilled deadline config is the REAL one (not an empty object)
    var dCfg = JSON.parse(savedDeadline || '{}');
    ok('backfilled deadline config carries the real clocks (respond.default=' + (dCfg.clocks && dCfg.clocks.respond && dCfg.clocks.respond.default) + ')',
      !!(dCfg.clocks && dCfg.clocks.respond && dCfg.clocks.respond.durationByClassification));

    // ---- 2. the clock engine reads the JURISDICTION row, not the global key
    // Change ONLY the jurisdiction row; the engine must see it.
    var probe = JSON.parse(JSON.stringify(dCfg));
    probe.clocks.respond.durationByClassification.standard = 77;
    probe.__probe = TAG;
    await JR.write(activeJid, 'deadline', probe, 'harness');
    var seen = await TOLL.loadRules();
    ok('clock engine reads the jurisdiction row (standard=77)', seen && seen.clocks.respond.durationByClassification.standard === 77);
    ok('clock engine sees the probe marker (it is the same object, not a coincidence)', seen.__probe === TAG);

    // Now change ONLY the legacy global key to something else. The engine must IGNORE it, because the
    // jurisdiction row wins. This is the whole point of the slice.
    var decoy = JSON.parse(JSON.stringify(dCfg));
    decoy.clocks.respond.durationByClassification.standard = 999;
    await db.run("INSERT INTO system_config (key, value) VALUES ('deadline_rules', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(decoy)]);
    var seen2 = await TOLL.loadRules();
    ok('the legacy GLOBAL key no longer wins (still 77, not 999)', seen2.clocks.respond.durationByClassification.standard === 77);

    // ---- 3. THE CORE CLAIM: the jid is load-bearing. Two jurisdictions, two different policies.
    await db.run("INSERT INTO jurisdiction_profiles (id, code, name, statute_name, statute_citation, status, exemption_model) VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING",
      [FAKE, 'ZZ', 'Test State ' + TAG, 'Test Act', 'ZZ Code 1.01', 'active', 'self_court']);

    // TX = toll_and_restart (Texas: clarification RESETS the clock — City of Dallas v. Abbott)
    await CP.write(activeJid, { enabled: true, clarification_clock_effect: 'toll_and_restart', clarification_grace_days: 61 }, 'harness');
    // ZZ = toll_pause_resume (a pause-and-resume state, e.g. WA)
    await CP.write(FAKE, { enabled: true, clarification_clock_effect: 'toll_pause_resume', clarification_grace_days: 30 }, 'harness');

    var pTx = await CP.read(activeJid);
    var pZz = await CP.read(FAKE);
    ok('jurisdiction A policy = toll_and_restart (TX: clarification RESETS the clock)', pTx.clarification_clock_effect === 'toll_and_restart');
    ok('jurisdiction B policy = toll_pause_resume (a pause state)', pZz.clarification_clock_effect === 'toll_pause_resume');
    ok('THE JID IS LOAD-BEARING — two jurisdictions hold different rules simultaneously', pTx.clarification_clock_effect !== pZz.clarification_clock_effect);
    ok('per-jurisdiction grace days differ (61 vs 30)', pTx.clarification_grace_days === 61 && pZz.clarification_grace_days === 30);

    // and the write went to jurisdiction_rules, NOT back into the global system_config key
    var legacy = await db.get("SELECT value FROM system_config WHERE key = 'clarification_policy'");
    var legacyCfg = legacy ? JSON.parse(legacy.value) : {};
    ok('write() did NOT touch the legacy global key (it still holds the old disabled default)', legacyCfg.enabled !== true);
    var jrClar = await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = 'clarification'", [FAKE]);
    ok('write() landed in jurisdiction_rules for the second jurisdiction', !!jrClar && JSON.parse(jrClar.config_json).clarification_clock_effect === 'toll_pause_resume');

    // ---- 4. fallback: a jurisdiction with NO row inherits the legacy global (no silent loss of the clock)
    var orphan = 'jur-orphan-' + Date.now();
    var fb = await JR.read(orphan, 'deadline');
    ok('a jurisdiction with no row falls back to the legacy global (999 decoy)', !!fb && fb.clocks.respond.durationByClassification.standard === 999);
    ok('fallback for an unknown domain returns null, not a throw', (await JR.read(orphan, 'nonexistent_domain')) === null);

    // ---- 5. the extractor adapters are now jurisdiction-scoped (AI config pipeline + profile hashing)
    var adCur = await CE.adapter('deadline').current(activeJid);
    ok('configExtractors deadline.current(jid) reads the jurisdiction row', adCur && adCur.__probe === TAG);
    var adCurZz = await CE.adapter('clarification').current(FAKE);
    ok('configExtractors clarification.current(jid) is jurisdiction-scoped', adCurZz.clarification_clock_effect === 'toll_pause_resume');

    // ---- 6. END TO END through a real creation path: a new request's clock uses the jurisdiction rules
    await submit('Test request for jurisdiction rule wiring ' + TAG);
    var req = null;
    for (var i = 0; i < 60 && !req; i++) { req = await db.get('SELECT id, request_number FROM requests WHERE description LIKE ?', ['%' + TAG + '%']); await sleep(250); }
    ok('request created through the real portal path', !!req);
    if (req) created.push(req.id);

    var clk = null;
    for (var j = 0; j < 40 && !clk; j++) { clk = await db.get("SELECT * FROM request_clocks WHERE request_id = ? AND is_primary = 1", [req.id]); await sleep(250); }
    ok('a primary clock was created for it', !!clk);
    // The clock's duration must come from the JURISDICTION row. Classification decides which bucket;
    // if it classified 'standard' we get our probe value 77 — otherwise assert it matched SOME bucket
    // from the jurisdiction config and NOT the 999 decoy in the global key.
    var buckets = probe.clocks.respond.durationByClassification;
    var fromJur = Object.keys(buckets).some(function (k) { return Number(buckets[k]) === Number(clk.duration); });
    ok('clock duration (' + clk.duration + ') came from the JURISDICTION config, not the global decoy',
      fromJur && Number(clk.duration) !== 999);
    if (Number(clk.duration) === 77) ok('  (classified standard → picked up the probe value 77 exactly)', true);

    console.log('\n  request ' + (req && req.request_number) + ' clock: duration=' + clk.duration + ' basis=' + clk.basis);

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    // restore everything: the real deadline config, the real clarification policy, drop the test rows
    try {
      if (savedDeadline) {
        await db.run("UPDATE jurisdiction_rules SET config_json = ?, updated_by = 'backfill' WHERE jurisdiction_id = ? AND domain = 'deadline'", [savedDeadline, activeJid]);
        await db.run("INSERT INTO system_config (key, value) VALUES ('deadline_rules', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [savedDeadline]);
      }
      if (savedClar) await db.run("UPDATE jurisdiction_rules SET config_json = ?, updated_by = 'backfill' WHERE jurisdiction_id = ? AND domain = 'clarification'", [savedClar, activeJid]);
      await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ?', [FAKE]);
      await db.run('DELETE FROM jurisdiction_profile_sections WHERE jurisdiction_id = ?', [FAKE]);
      await db.run('DELETE FROM config_history WHERE jurisdiction_id = ?', [FAKE]);
      await db.run('DELETE FROM jurisdiction_profiles WHERE id = ?', [FAKE]);
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t = 0; t < tabs.length; t++) for (var c = 0; c < created.length; c++) {
        try { await db.run('DELETE FROM ' + tabs[t].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c2 = 0; c2 < created.length; c2++) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c2]]); } catch (e) {} }

      var leftReq = await db.get('SELECT COUNT(*) AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      var leftJur = await db.get('SELECT COUNT(*) AS n FROM jurisdiction_profiles WHERE id = ?', [FAKE]);
      var restored = await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = 'clarification'", [activeJid]);
      ok('cleanup: 0 test requests, 0 test jurisdictions left', Number(leftReq.n) === 0 && Number(leftJur.n) === 0);
      var rc = JSON.parse(restored.config_json);
      ok('cleanup: the real TX clarification policy is restored (enabled=' + rc.enabled + ', provenance intact)',
        restored && restored.config_json === savedClar && rc.enabled === false && !!rc.provenance.clarification_clock_effect);
      var rr = await TOLL.loadRules();
      ok('cleanup: the live clock config is back to normal (standard=' + rr.clocks.respond.durationByClassification.standard + ')',
        rr.clocks.respond.durationByClassification.standard === JSON.parse(savedDeadline).clocks.respond.durationByClassification.standard);
      ok('cleanup: NO probe marker left behind in the live config', !rr.__probe);
    } catch (e) { console.error('CLEANUP ERR', e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
