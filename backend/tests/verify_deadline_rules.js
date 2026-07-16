'use strict';
// Per-jurisdiction deadline rules — IL and CA, from the 2026-07-13 legal research.
// The claim: the clock a request gets, and the extension it may be granted, now come from the JURISDICTION,
// not from a global default. Proven by making each jurisdiction active in turn and watching the behaviour
// change: IL gives a 5-BUSINESS-day clock capped at one 5-day extension; CA gives a 10-CALENDAR-day
// determination clock capped at one 14-day extension; TX gives its own durations and has NO cap at all.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
// RESTORE_STAMP: put the row back exactly as found, INCLUDING updated_by — a restore that stamps itself
// 'harness-restore' leaves a test fingerprint on live config (configIntegrity flags it, rightly).
async function restoreStamp(jid, domain) {
  var orig = _origStamp[jid + '/' + domain];
  if (orig) await db.run('UPDATE jurisdiction_rules SET updated_by = ? WHERE jurisdiction_id = ? AND domain = ?', [orig, jid, domain]);
}
var _origStamp = {};
async function captureStamp(jid, domain) {
  var r = await db.get('SELECT updated_by FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, domain]);
  if (r) _origStamp[jid + '/' + domain] = r.updated_by;
}
var auth = require('/opt/optimumq/backend/src/services/auth');
var T = require('/opt/optimumq/backend/src/services/tolling');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');

var TAG = 'DLRULES-' + Date.now();
var pass = 0, fail = 0, TOKEN = null, created = [], ORIGINAL = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function submit(d) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify({ description: d, requestorName: 'DL Test', requestorEmail: 'dl@example.com' });
    var r = http.request({ host: 'localhost', port: (Number(process.env.API_PORT) || 3101), path: '/api/public/submit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      function (resp) { resp.on('data', function () {}); resp.on('end', function () { res(resp.statusCode); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}
async function setActive(jid) {
  await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [jid]);
}
async function newRequest(label) {
  await submit(label + ' ' + TAG);
  var req = null;
  for (var i = 0; i < 60 && !req; i++) { req = await db.get('SELECT id, request_number FROM requests WHERE description LIKE ?', ['%' + label + ' ' + TAG + '%']); await sleep(250); }
  if (!req) throw new Error('not created: ' + label);
  created.push(req.id);
  var clk = null;
  for (var j = 0; j < 40 && !clk; j++) { clk = await db.get("SELECT * FROM request_clocks WHERE request_id = (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?) AND is_primary = 1", [req.id]); await sleep(250); }
  return { req: req, clock: clk };
}

(async function () {
  await db.initDb();
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);
    ORIGINAL = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'")).value;
    ok('the active jurisdiction is TX before we start (' + ORIGINAL + ')', ORIGINAL === 'jur-tx');

    // ---- the rules exist as data
    var il = await JR.read('jur-il', 'deadline');
    var ca = await JR.read('jur-ca', 'deadline');
    ok('IL holds deadline rules', !!(il && il.clocks && il.clocks.respond));
    ok('CA holds deadline rules', !!(ca && ca.clocks && ca.clocks.respond));
    ok('IL: 5 BUSINESS days (5 ILCS 140/3(d))', il.clocks.respond.default === 5 && il.clocks.respond.basis === 'business_days');
    ok('CA: 10 CALENDAR days (Gov\'t Code § 7922.535(a))', ca.clocks.respond.default === 10 && ca.clocks.respond.basis === 'calendar_days');
    ok('CA\'s clock is labelled "Determine & notify" — it is a DETERMINATION deadline, not production',
      ca.clocks.respond.label === 'Determine & notify');
    ok('IL extension cap: 1 grant, max 5 days, 7 statutory grounds (§ 3(e))',
      il.clocks.respond.extension.maxCount === 1 && il.clocks.respond.extension.maxDays === 5 && il.clocks.respond.extension.grounds.length === 7);
    ok('CA extension cap: 1 grant, max 14 days, 6 statutory grounds (§ 7922.535(b)-(c))',
      ca.clocks.respond.extension.maxCount === 1 && ca.clocks.respond.extension.maxDays === 14 && ca.clocks.respond.extension.grounds.length === 6);

    // ---- FL / WA / NY / CT deliberately absent — modelling their acknowledge clock as a produce clock
    //      would report false lateness. This asserts the ABSENCE is deliberate, not an oversight.
    var fl = await JR.read('jur-fl', 'deadline');
    ok('FL has NO deadline rules — it has no statutory clock, and inventing one would be inventing law',
      !fl || !fl.clocks || !fl.clocks.respond || JSON.stringify(fl) === JSON.stringify(await JR.read('jur-tx', 'deadline')));

    // =====================================================================================
    // ILLINOIS: make it active. The clock a NEW request gets must come from IL's rules.
    // =====================================================================================
    await setActive('jur-il');
    var ilRules = await T.loadRules();
    ok('IL active: the engine loads IL\'s rules', ilRules.clocks.respond.basis === 'business_days' && ilRules.clocks.respond.default === 5);

    var A = await newRequest('IL clock');
    ok('IL: a new request gets a 5-day clock on a BUSINESS-day basis (' + A.clock.duration + ' ' + A.clock.basis + ')',
      Number(A.clock.duration) === 5 && A.clock.basis === 'business_days');

    var e1 = await T.extend(A.clock.id, 5, 'voluminous', { actor: 'harness' });
    ok('IL: the one 5-business-day extension is granted (§ 3(e))', e1.extended === true && e1.duration === 10);
    var refused = null;
    try { await T.extend(A.clock.id, 1, 'voluminous', { actor: 'harness' }); } catch (e) { refused = e.message; }
    ok('IL: a SECOND extension is refused — the statute allows exactly one', !!refused && /allows 1 extension/.test(refused));
    var badGround = null;
    try { var B = await newRequest('IL ground'); await T.extend(B.clock.id, 3, 'we_are_busy', { actor: 'harness' }); }
    catch (e) { badGround = e.message; }
    ok('IL: an invented ground is refused — the seven grounds are statutory (§ 3(e))', !!badGround && /not a ground/.test(badGround));

    // =====================================================================================
    // CALIFORNIA: same request shape, DIFFERENT law. The behaviour must change with it.
    // =====================================================================================
    await setActive('jur-ca');
    var C = await newRequest('CA clock');
    ok('CA: a new request gets a 10-day clock on a CALENDAR basis (' + C.clock.duration + ' ' + C.clock.basis + ')',
      Number(C.clock.duration) === 10 && C.clock.basis === 'calendar_days');
    ok('CA: the clock is labelled "Determine & notify", not "Respond / produce" — the operator reads the duty correctly',
      C.clock.label === 'Determine & notify');

    var over = null;
    try { await T.extend(C.clock.id, 15, 'voluminous', { actor: 'harness' }); } catch (e) { over = e.message; }
    ok('CA: a 15-day extension is refused — the CPRA caps it at 14 (§ 7922.535(b))', !!over && /at most 14 extension days/.test(over));
    var c14 = await T.extend(C.clock.id, 14, 'voluminous', { actor: 'harness' });
    ok('CA: exactly 14 days IS granted (10 + 14 = 24)', c14.extended === true && c14.duration === 24);
    ok('THE SAME ACTION, DIFFERENT LAW: IL capped this at 5 days; CA allowed 14. The jurisdiction decides.',
      e1.days === 5 && c14.days === 14);

    // a ground CA recognises but IL does not
    var D = await newRequest('CA ground');
    var caOnly = await T.extend(D.clock.id, 3, 'cyberattack', { actor: 'harness' });
    ok('CA: "cyberattack" is a valid CA ground (§ 7922.535(c), as amended) — and would be refused in IL',
      caOnly.extended === true && il.clocks.respond.extension.grounds.indexOf('cyberattack') < 0);

    // =====================================================================================
    // TEXAS: back to the real active jurisdiction. Its rules are untouched and it has NO cap.
    // =====================================================================================
    await setActive('jur-tx');
    var txRules = await T.loadRules();
    ok('TX active again: durations by classification restored (standard=' + txRules.clocks.respond.durationByClassification.standard + ')',
      txRules.clocks.respond.durationByClassification.standard === 10);
    ok('TX has NO extension cap — the TPIA grants no unusual-circumstances extension, so an extension there is uncapped-but-recorded',
      !txRules.clocks.respond.extension);
    var E = await newRequest('TX clock');
    ok('TX: a new request gets a TX-shaped clock (' + E.clock.duration + ' ' + E.clock.basis + ')',
      E.clock.basis === 'calendar_days' && [5, 10, 20, 30].indexOf(Number(E.clock.duration)) >= 0);

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      // THE MOST IMPORTANT RESTORE IN THIS HARNESS — the active jurisdiction is global.
      if (ORIGINAL) await setActive(ORIGINAL);
      var back = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'")).value;
      ok('cleanup: the active jurisdiction is restored to ' + ORIGINAL, back === ORIGINAL);

      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t = 0; t < tabs.length; t++) for (var c = 0; c < created.length; c++) {
        try { await db.run('DELETE FROM ' + tabs[t].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c2 = 0; c2 < created.length; c2++) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c2]]); } catch (e) {} }
      var left = await db.get('SELECT COUNT(*) AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 test requests remain', Number(left.n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
