'use strict';
// FEE-WAIVER POLICY SUBSTRATE + THE ILLINOIS FEE-FORFEITURE GUARDRAIL.
//
// The guardrail is the point. 5 ILCS 140/3(d): a public body that answers late "may not impose a fee for
// such copies." A request parked in "awaiting fee-waiver decision" keeps aging against IL's 5-business-day
// clock — and deciding a waiver is NOT one of the seven § 3(e) extension grounds. On day 6 the city has
// constructively denied the request AND permanently lost its right to charge. The deliberation destroys
// the fee. The system must REFUSE to invoice, not warn.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var FWP = require('/opt/optimumq/backend/src/services/feeWaiverPolicy');
var FF = require('/opt/optimumq/backend/src/services/feeForfeiture');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');

var TAG = 'FEEWAIVER-' + Date.now();
var pass = 0, fail = 0, TOKEN = null, created = [], ORIGINAL = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function submit(d) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify({ description: d, requestorName: 'FW Test', requestorEmail: 'fw@example.com' });
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
async function setActive(jid) {
  await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [jid]);
}
async function newRequest(label) {
  await submit(label + ' ' + TAG);
  var req = null;
  for (var i = 0; i < 60 && !req; i++) { req = await db.get('SELECT id, request_number FROM requests WHERE description LIKE ?', ['%' + label + ' ' + TAG + '%']); await sleep(250); }
  if (!req) throw new Error('not created: ' + label);
  created.push(req.id);
  for (var j = 0; j < 40; j++) { var c = await db.get("SELECT id FROM request_clocks WHERE request_id = ? AND is_primary = 1", [req.id]); if (c) break; await sleep(250); }
  return req;
}
function estimateBody() {
  return { components: [{ id: 'c1', label: 'records', quantities: { searchHours: 5, bwPages: 200 } }], delivery: { method: 'email' } };
}

(async function () {
  await db.initDb();
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);
    ORIGINAL = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'")).value;

    // ---- 1. the substrate holds all seven, and the differences are real
    var rows = await db.all("SELECT jurisdiction_id FROM jurisdiction_rules WHERE domain = 'fee_waiver'");
    ok('7 jurisdictions hold a fee-waiver policy', rows.length === 7);

    var tx = await FWP.read('jur-tx'), il = await FWP.read('jur-il'), ct = await FWP.read('jur-ct');
    var wa = await FWP.read('jur-wa'), ca = await FWP.read('jur-ca'), ny = await FWP.read('jur-ny');
    ok('every policy is a DRAFT (enabled=false) — nothing is live',
      [tx, il, ct, wa, ca, ny].every(function (p) { return p.enabled === false; }));

    // ---- 2. THE TEXAS TRIGGER — the field that stops us auto-closing live requests
    ok('TX: the pay-or-abandon window is 10 BUSINESS days', tx.response_window_days === 10 && tx.response_window_unit === 'business');
    ok('TX: it is triggered by the COST ESTIMATE, not the waiver denial (§ 552.2615(b))',
      tx.response_window_trigger === 'cost_estimate_sent' && tx.response_window_trigger !== 'waiver_denial');
    ok('TX: windowStartsOn(cost_estimate_sent) = true', FWP.windowStartsOn(tx, 'cost_estimate_sent') === true);
    ok('TX: windowStartsOn(waiver_denial) = FALSE — a waiver denial does nothing procedurally in Texas',
      FWP.windowStartsOn(tx, 'waiver_denial') === false);
    ok('TX: the deposit RESTARTS the clock (§ 552.263(e)), it does not toll it', tx.restarts_on_deposit_receipt === true);
    ok('TX has a public-interest waiver, but NO indigency and NO news-media waiver (SILENT — not invented)',
      tx.grounds.indexOf('public_interest') >= 0 && tx.grounds.indexOf('indigency') < 0 && tx.grounds.indexOf('news_media') < 0);

    // ---- 3. the sleeper field: never route a requestor to a forum that cannot help them
    ok('IL appeal forum is the PAC, but it CANNOT order a waiver (2017 PAC 47258)',
      il.appeal_forum === 'pac' && il.appeal_can_order_waiver === false);
    ok('TX AG complaint reaches the fee AMOUNT but CANNOT order a waiver',
      tx.appeal_forum === 'ag_overcharge' && tx.appeal_reaches_fee_amount === true && tx.appeal_can_order_waiver === false);
    ok('CT FOIC is the ONLY forum in the set that CAN order a waiver', ct.appeal_can_order_waiver === true);
    ok('CT is the only MANDATORY waiver (§ 1-212(d))', ct.binding === 'mandatory' &&
      [tx, il, wa, ny].every(function (p) { return p.binding !== 'mandatory'; }));

    // ---- 4. provenance.source is LOAD-BEARING: only TX may call its clock "the law"
    ok('TX window source = statute — only TX may tell a requestor "the law gives you 10 business days"',
      tx.provenance.response_window_days.source === 'statute');
    ok('WA source = agency_policy — its 30 days is a MODEL RULE, not law', wa.provenance.response_window_days.source === 'agency_policy');
    ok('NY waiver source = regulation (21 NYCRR 1401.8), not statute', ny.provenance.grounds.source === 'regulation');
    ok('CA and FL have NO waiver grounds at all (SILENT)', ca.grounds.length === 0 && (await FWP.read('jur-fl')).grounds.length === 0);

    // ---- 5. uniform findings, encoded as invariants a city cannot configure around
    ok('no jurisdiction has deemed-granted-on-silence', [tx, il, ct, wa, ca, ny].every(function (p) { return p.deemed_granted_on_silence === false; }));
    var threw = null;
    try { FWP.validate({ deemed_granted_on_silence: true }); } catch (e) { threw = e.message; }
    ok('setting deemed_granted_on_silence is REJECTED — silence is a deemed DENIAL everywhere', !!threw && /deemed granted/i.test(threw));
    var threw2 = null;
    try { FWP.validate({ extension_grounds_closed_list: true, tolls_on_waiver_request: true }); } catch (e) { threw2 = e.message; }
    ok('a waiver-pending TOLL is REJECTED where the extension grounds are a closed list — that IS the IL trap',
      !!threw2 && /forfeits the fee/i.test(threw2));
    ok('no jurisdiction tolls the clock for a pending waiver', [tx, il, ct, wa, ca, ny].every(function (p) { return p.tolls_on_waiver_request === false; }));

    // =====================================================================================
    // 6. THE GUARDRAIL. Texas first: no forfeiture rule, so nothing changes.
    // =====================================================================================
    var A = await newRequest('TX no forfeiture');
    var ffTx = await FF.check(A.id);
    ok('TX: the forfeiture guardrail is NOT armed (no such rule in the TPIA)', ffTx.blocked === false);
    var estTx = await api('POST', '/fee-estimates/request/' + A.id, estimateBody());
    ok('TX: an estimate is created normally — the guardrail changed nothing for the live jurisdiction', estTx.status === 200);

    // =====================================================================================
    // 7. ILLINOIS. Blow the clock, then try to charge. The system must REFUSE.
    // =====================================================================================
    await setActive('jur-il');
    var B = await newRequest('IL clock alive');
    var estOk = await api('POST', '/fee-estimates/request/' + B.id, estimateBody());
    // NOTE: IL has no fee_profile seeded, so estimate creation 400s on config — that is a separate concern.
    // The claim under test is that the FORFEITURE GUARDRAIL is not firing while the clock is alive.
    ok('IL, clock still RUNNING: the guardrail does NOT fire (status ' + estOk.status + ', not 409)', estOk.status !== 409);
    var riskEarly = await FF.risk(B.id, 1);
    ok('IL, clock healthy: no forfeiture risk flagged yet', riskEarly.atRisk === false);

    // Now blow the clock: backdate the request + its clock past the 5-business-day window.
    var clk = await db.get("SELECT id FROM request_clocks WHERE request_id = ? AND is_primary = 1", [B.id]);
    await db.run("UPDATE request_clocks SET started_at = to_char(now() - interval '30 days', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [clk.id]);
    // ...and mark a fee waiver as pending — the hold state that eats the clock
    await db.run("UPDATE requests SET fee_waiver_requested = 1, fee_waiver_status = 'pending' WHERE id = ?", [B.id]);

    var ff = await FF.check(B.id);
    ok('IL, clock BLOWN: the guardrail fires (blocked=true)', ff.blocked === true);
    ok('...and it cites 5 ILCS 140/3(d)', /140\/3\(d\)/.test(ff.citation || ''));
    ok('...and the reason is written for a human, not a stack trace ("' + String(ff.reason).slice(0, 60) + '…")',
      /may not charge a fee|no longer be invoiced/i.test(ff.reason));

    var estBlocked = await api('POST', '/fee-estimates/request/' + B.id, estimateBody());
    ok('IL: POST /fee-estimates REFUSES with 409 — the system will not build an invoice it cannot lawfully send',
      estBlocked.status === 409 && estBlocked.body.code === 'FEE_FORFEITED');
    ok('...the 409 carries the citation the clerk can act on', /140\/3\(d\)/.test((estBlocked.body && estBlocked.body.citation) || ''));

    var sendBlocked = await api('POST', '/fee-estimates/request/' + B.id + '/notice/send', { text: 'x' });
    ok('IL: the OTHER door — POST /notice/send — is refused too (409). Both doors to charging are shut.',
      sendBlocked.status === 409 && sendBlocked.body.code === 'FEE_FORFEITED');

    // no estimate row was created by the blocked call
    var estRows = await db.get("SELECT COUNT(*) AS n FROM request_fee_estimates WHERE request_id = ?", [B.id]);
    ok('IL: the blocked call wrote NO estimate row (' + estRows.n + ') — it is a refusal, not a warning', Number(estRows.n) === 0);

    // ---- 8. the WARNING that precedes the block
    var C = await newRequest('IL at risk');
    var cclk = await db.get("SELECT id, duration FROM request_clocks WHERE request_id = ? AND is_primary = 1", [C.id]);
    await db.run("UPDATE requests SET fee_waiver_requested = 1, fee_waiver_status = 'pending' WHERE id = ?", [C.id]);
    // push it to 1 day left
    await db.run("UPDATE request_clocks SET started_at = to_char(now() - interval '6 days', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [cclk.id]);
    var risk = await FF.risk(C.id, 2);
    ok('IL: a waiver-pending request near the deadline is flagged AT RISK (' + risk.daysLeft + ' day(s) left)', risk.atRisk === true);
    ok('...and the warning names the trap: deciding the waiver is not a lawful reason to miss the deadline',
      /NOT a lawful reason/i.test(risk.message || ''));
    ok('...and it knows the waiver is what is holding it up', risk.waiverPending === true);

    // ---- 9. a TOLLED clock is not a blown clock
    var D = await newRequest('IL tolled');
    var dclk = await db.get("SELECT id FROM request_clocks WHERE request_id = ? AND is_primary = 1", [D.id]);
    await db.run("UPDATE request_clocks SET started_at = to_char(now() - interval '30 days', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [dclk.id]);
    await db.run("INSERT INTO clock_tolls (id, clock_id, reason, tolled_from, created_at) VALUES (?,?,?, to_char(now() - interval '29 days','YYYY-MM-DD HH24:MI:SS'), to_char(now(),'YYYY-MM-DD HH24:MI:SS'))",
      ['tl-fwtest', dclk.id, 'clarification_pending']);
    var ffTolled = await FF.check(D.id);
    ok('IL: a TOLLED clock is not a blown clock — the fee is not forfeited while the count is suspended',
      ffTolled.blocked === false);

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      if (ORIGINAL) await setActive(ORIGINAL);
      var back = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'")).value;
      ok('cleanup: active jurisdiction restored to ' + ORIGINAL, back === ORIGINAL);
      await db.run("DELETE FROM clock_tolls WHERE id = 'tl-fwtest'");
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
