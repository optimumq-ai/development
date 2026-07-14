'use strict';
// Clock EXTEND primitive + toll-reason validation.
// Claim 1: an extension adds a FIXED number of statutory days (IL 5 ILCS 140/3(e), CA § 7922.535(b)) —
//          something toll() structurally cannot express, because a toll moves the due date by elapsed wall
//          time. Caps come from the jurisdiction's own rules and are enforced by the extension ledger.
// Claim 2: tollReasons is finally load-bearing — a reason the jurisdiction never declared is REJECTED.
// Claim 3 (the regression that matters): the AG hold still works. requests.js has always tolled the respond
//          clock with `ag_ruling_pending`, which was NOT in the seeded tollReasons — switching on validation
//          without backfilling it would have broken the AG flow silently.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var T = require('/opt/optimumq/backend/src/services/tolling');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');

var TAG = 'EXTEND-' + Date.now();
var JID = 'jur-tx';
var pass = 0, fail = 0, TOKEN = null, created = [], savedDeadline = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function submit(d) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify({ description: d, requestorName: 'Ext Test', requestorEmail: 'ext@example.com' });
    var r = http.request({ host: 'localhost', port: (Number(process.env.API_PORT) || 3101), path: '/api/public/submit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      function (resp) { resp.on('data', function () {}); resp.on('end', function () { res(resp.statusCode); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}
async function api(method, path, body) {
  var r = await fetch('http://localhost:' + (Number(process.env.API_PORT) || 3101) + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function newRequest(label) {
  await submit(label + ' ' + TAG);
  var req = null;
  for (var i = 0; i < 60 && !req; i++) { req = await db.get('SELECT id, request_number FROM requests WHERE description LIKE ?', ['%' + label + ' ' + TAG + '%']); await sleep(250); }
  if (!req) throw new Error('not created: ' + label);
  created.push(req.id);
  var clk = null;
  for (var j = 0; j < 40 && !clk; j++) { clk = await db.get("SELECT * FROM request_clocks WHERE request_id = ? AND is_primary = 1", [req.id]); await sleep(250); }
  return { req: req, clock: clk };
}
async function primaryState(rid) {
  return (await T.statusForRequest(rid)).filter(function (c) { return c.isPrimary; })[0];
}

(async function () {
  await db.initDb();
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);
    savedDeadline = JSON.stringify(await JR.read(JID, 'deadline'));

    // ---- 1. toll-reason validation is live, and the declared list is honoured
    var rules = await T.loadRules();
    var declared = rules.clocks.respond.tollReasons;
    ok('the respond clock declares its toll reasons (' + declared.join(', ') + ')', Array.isArray(declared) && declared.length >= 4);
    ok('ag_ruling_pending is declared — the AG hold would break without it', declared.indexOf('ag_ruling_pending') >= 0);

    var A = await newRequest('toll validation');
    var threw = null;
    try { await T.toll(A.clock.id, 'made_up_reason', 'nope'); } catch (e) { threw = e.message; }
    ok('an UNDECLARED toll reason is now REJECTED (it used to be silently accepted)', !!threw && /not a toll reason/.test(threw));
    ok('...and the error names the allowed reasons, so a human can fix it', !!threw && /clarification_pending/.test(threw));
    var noTolls = await db.get("SELECT COUNT(*) AS n FROM clock_tolls WHERE clock_id = ?", [A.clock.id]);
    ok('the rejected toll wrote NOTHING to the ledger', Number(noTolls.n) === 0);

    // the REGRESSION that matters: ag_ruling_pending must still be accepted on the respond clock
    var agr = await T.toll(A.clock.id, 'ag_ruling_pending', 'AG decision requested');
    ok('REGRESSION: the AG hold still tolls the respond clock (ag_ruling_pending accepted)', !!agr.tolled);
    await T.resume(A.clock.id);

    // ---- 2. EXTEND: a fixed number of statutory days, which a toll cannot express
    var B = await newRequest('extend basic');
    var before = await primaryState(B.req.id);
    var dur0 = before.duration, due0 = before.dueDate;

    var ex = await api('POST', '/clocks/' + B.clock.id + '/extend', { days: 5, reason: 'voluminous', note: '5 ILCS 140/3(e)-style' });
    ok('POST /clocks/:id/extend granted 5 days through the real endpoint', ex.status === 200 && ex.body.extended === true);
    var after = await primaryState(B.req.id);
    ok('the clock DURATION grew by exactly 5 (' + dur0 + ' -> ' + after.duration + ')', after.duration === dur0 + 5);
    ok('the due date moved out (' + due0 + ' -> ' + after.dueDate + ')', after.dueDate > due0);
    ok('the clock is still RUNNING — an extension is not a pause', after.state === 'running');
    ok('nothing was tolled — extension and toll are different primitives', after.tolledDays === 0);
    ok('remaining days grew by 5, not by wall-clock time', after.remainingDays === before.remainingDays + 5);

    var led = await api('GET', '/clocks/' + B.clock.id + '/extensions');
    ok('the extension is in the ledger with its statutory ground', led.status === 200 && led.body.extensions.length === 1 && led.body.extensions[0].reason === 'voluminous');
    ok('the ledger records who granted it', led.body.extensions[0].actor === (user.display_name || user.email));

    // the deadline_date writeback happened (the requests row, not just the derived view)
    var wb = await db.get('SELECT deadline_date FROM requests WHERE id = ?', [B.req.id]);
    ok('requests.deadline_date was written back', wb.deadline_date === after.dueDate);

    // ---- 3. bad input is refused with a human error, not a 500
    var e1 = await api('POST', '/clocks/' + B.clock.id + '/extend', { days: 0, reason: 'voluminous' });
    ok('a zero-day extension is refused (400)', e1.status === 400);
    var e2 = await api('POST', '/clocks/' + B.clock.id + '/extend', { days: 3 });
    ok('an extension with NO reason is refused — the reason IS the statutory ground', e2.status === 400 && /reason/.test(e2.body.error));

    // ---- 4. CAPS come from the jurisdiction's own statute. Configure an IL-shaped rule and prove it binds.
    var cfg = JSON.parse(savedDeadline);
    cfg.clocks.respond.extension = { maxDays: 5, maxCount: 1, grounds: ['voluminous', 'offsite_records'] };
    await JR.write(JID, 'deadline', cfg, 'harness');

    var C = await newRequest('extend capped');
    var c1 = await api('POST', '/clocks/' + C.clock.id + '/extend', { days: 5, reason: 'voluminous' });
    ok('CAP: the first 5-day extension is allowed (IL: one 5-business-day extension)', c1.status === 200);
    var c2 = await api('POST', '/clocks/' + C.clock.id + '/extend', { days: 1, reason: 'voluminous' });
    ok('CAP: a SECOND extension is refused — maxCount 1 (' + (c2.body && c2.body.error || '').slice(0, 60) + '…)', c2.status === 400 && /allows 1 extension/.test(c2.body.error));

    var D = await newRequest('extend overcap');
    var d1 = await api('POST', '/clocks/' + D.clock.id + '/extend', { days: 9, reason: 'voluminous' });
    ok('CAP: a single over-cap grant is refused — maxDays 5, asked 9', d1.status === 400 && /at most 5 extension days/.test(d1.body.error));
    var d2 = await api('POST', '/clocks/' + D.clock.id + '/extend', { days: 3, reason: 'hurricane' });
    ok('CAP: an undeclared GROUND is refused (grounds are statutory, not free text)', d2.status === 400 && /not a ground/.test(d2.body.error));
    var d3 = await api('POST', '/clocks/' + D.clock.id + '/extend', { days: 3, reason: 'offsite_records' });
    ok('a declared ground within the cap IS allowed', d3.status === 200);

    // maxDays caps the TOTAL across the clock's life, not each grant — otherwise "one extension of not more
    // than 14 days" could be evaded by granting 14 twice. Isolate it: allow 3 grants, still cap 5 total days.
    var cfg2 = JSON.parse(savedDeadline);
    cfg2.clocks.respond.extension = { maxDays: 5, maxCount: 3, grounds: ['voluminous'] };
    await JR.write(JID, 'deadline', cfg2, 'harness');
    var F = await newRequest('extend total cap');
    var f1 = await api('POST', '/clocks/' + F.clock.id + '/extend', { days: 3, reason: 'voluminous' });
    ok('TOTAL CAP: a first 3-day grant is allowed (3 of 5 used)', f1.status === 200 && f1.body.duration != null);
    var f2 = await api('POST', '/clocks/' + F.clock.id + '/extend', { days: 3, reason: 'voluminous' });
    ok('TOTAL CAP: a second 3-day grant is REFUSED — 3+3 > 5, even though 2 more grants are permitted',
      f2.status === 400 && /at most 5 extension days/.test(f2.body.error));
    var f3 = await api('POST', '/clocks/' + F.clock.id + '/extend', { days: 2, reason: 'voluminous' });
    ok('TOTAL CAP: the remaining 2 days ARE grantable (3+2 = the 5-day cap exactly)', f3.status === 200);
    var fLed = await api('GET', '/clocks/' + F.clock.id + '/extensions');
    ok('TOTAL CAP: the ledger shows 2 grants totalling exactly 5 days',
      fLed.body.extensions.length === 2 && fLed.body.extensions.reduce(function (s, e) { return s + Number(e.days); }, 0) === 5);

    // ---- 5. a toll and an extension COMPOSE correctly (they are independent)
    var E = await newRequest('toll plus extend');
    var e0 = await primaryState(E.req.id);
    await T.extend(E.clock.id, 5, 'voluminous', { actor: 'harness' });
    await T.toll(E.clock.id, 'clarification_pending', 'awaiting the requestor');
    var eSt = await primaryState(E.req.id);
    ok('a clock can be BOTH extended and tolled — duration +5 AND state tolled', eSt.duration === e0.duration + 5 && eSt.state === 'tolled');
    await T.resume(E.clock.id);
    var eSt2 = await primaryState(E.req.id);
    ok('after resume it is running, and the extension survived the toll', eSt2.state === 'running' && eSt2.duration === e0.duration + 5);

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      if (savedDeadline) await JR.write(JID, 'deadline', JSON.parse(savedDeadline), 'harness-restore');
      var back = await JR.read(JID, 'deadline');
      ok('cleanup: the TX deadline config is restored (no extension cap, as TX has no statutory extension)',
        !back.clocks.respond.extension);
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
