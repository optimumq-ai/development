'use strict';
// STAFF-ENTERED ACTUAL AMOUNTS on 'actual'-rated fee lines (Kevin 2026-08-26; SPEC_fees_estimates_payments §2a).
//
//   A. ENGINE: a line rated 'actual' prices to $0 + needsActual (unchanged); `request.actualAmounts` puts the
//      entered dollars on the request-level line (dup_bw / dup_color / dup_oversized / media:<type> /
//      delivery), adds it to the subtotals and total, pro-rates it across the components' matching lines by
//      quantity, and clears hasUnpricedActuals — so per-record allocation and release gating see a real price.
//      A blank, non-numeric or unrelated key changes nothing.
//   B. API: POST /fee-estimates/request/:id and /reconcile pass actualAmounts through to the engine and keep it
//      in the snapshot's input, so the estimate screen reloads with the figures staff typed.
//
// BREAKS THIS SHOULD CATCH: apply the actual to the request line but not the components (A3) · drop the key on
// the route (B1) · let a blank string price as $0 "entered" (A5).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var E = require('/opt/optimumq/backend/src/services/feeEngine');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');

var pass = 0, fail = 0;
function ok(l, c, extra) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !extra ? '' : '  -> ' + extra)); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'aa' + Date.now().toString().slice(-6);
function near(a, b) { return Math.abs(Number(a) - Number(b)) < 0.005; }
async function callAs(user, method, path, body) {
  var t = await auth.signAccessToken(user);
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

var CFG = { context: 'FR', version: 1,
  labor: { overheadPct: 0, search: { rate: 10, increment: 0, rounding: 'up', billable: true }, review: { rate: 10, increment: 0, rounding: 'up', billable: true }, programming: { rate: 10, increment: 0, rounding: 'up', billable: true } },
  duplication: { bw: { rate: 0.10 }, color: { rate: 'actual' }, oversized: { rate: 0.5 }, specialty: { rate: 'actual' } },
  media: { cd: 1, dvd: 3, usb: 'actual' }, av: {},
  delivery: { email: 0, pickup: 0, mail: 'actual', handling: 0 }, certification: { rate: 0, unit: 'per_record' },
  requestRules: { freePageAllowance: 0, freeLaborHours: 0, deMinimis: 0, minFee: 0, maxFee: null, deposit: { threshold: null, percent: null }, estimateNotifyThreshold: null },
  estimatePolicy: {}, payment_mode: 'internal' };
var REQ = { components: [{ id: 'a', label: 'A', quantities: { bwPages: 10, colorPages: 30, media: [{ type: 'usb', count: 1 }] } }, { id: 'b', label: 'B', quantities: { colorPages: 10 } }], delivery: { method: 'mail' } };

(async function () {
  console.log('\n=== A. ENGINE ===');
  var r0 = E.compute(CFG, JSON.parse(JSON.stringify(REQ)));
  var R0 = r0.requestLevel;
  ok('A1 without actuals: color copies, usb, mail price to $0 needsActual; total is the B&W $1 only; both components unpriced', near(R0.total, 1) && R0.duplication[1].needsActual && R0.media[0].needsActual && R0.delivery.needsActual && r0.components.every(function (c) { return c.hasUnpricedActuals; }), JSON.stringify(R0).slice(0, 200));
  var req1 = JSON.parse(JSON.stringify(REQ)); req1.actualAmounts = { dup_color: 20, 'media:usb': 7.5, delivery: 4.25 };
  var r1 = E.compute(CFG, req1); var R1 = r1.requestLevel;
  ok('A2 with actuals: the request-level lines carry the entered figures and the total is 1 + 20 + 7.5 + 4.25 = 32.75', near(R1.duplicationSubtotal, 21) && near(R1.mediaSubtotal, 7.5) && near(R1.deliverySubtotal, 4.25) && near(R1.total, 32.75) && R1.duplication[1].actualEntered && !R1.duplication[1].needsActual && R1.actualsEntered.length === 3, JSON.stringify([R1.duplicationSubtotal, R1.mediaSubtotal, R1.deliverySubtotal, R1.total]));
  var A = r1.components[0], B = r1.components[1];
  var aColor = A.lineItems.filter(function (l) { return l.kind === 'dup_color'; })[0], bColor = B.lineItems.filter(function (l) { return l.kind === 'dup_color'; })[0], aUsb = A.lineItems.filter(function (l) { return l.kind === 'media'; })[0];
  ok('A3 the $20 for 40 color pages is shared by quantity: A (30 pages) $15, B (10 pages) $5; usb $7.50 on A; both marked entered, neither unpriced', near(aColor.amount, 15) && near(bColor.amount, 5) && aColor.actualEntered && bColor.actualEntered && near(aUsb.amount, 7.5) && !A.hasUnpricedActuals && !B.hasUnpricedActuals, JSON.stringify([aColor, bColor, aUsb]));
  ok('A4 component gross and the request gross follow (A 23.50, B 5, gross 28.50) so allocation prices every record', near(A.componentGross, 23.5) && near(B.componentGross, 5) && near(R1.grossSubtotal, 28.5) && r1.allocation && r1.allocation.basis === 'prorata', JSON.stringify([A.componentGross, B.componentGross, R1.grossSubtotal, r1.allocation && r1.allocation.basis]));
  var req2 = JSON.parse(JSON.stringify(REQ)); req2.actualAmounts = { dup_color: '', 'media:usb': 'abc', dup_bw: 99, nonsense: 5 };
  var r2 = E.compute(CFG, req2); var R2 = r2.requestLevel;
  ok('A5 a blank or non-numeric entry changes nothing; a key for a line that is not "actual" (dup_bw) is ignored', near(R2.total, 1) && R2.duplication[1].needsActual && R2.media[0].needsActual && near(R2.duplication[0].amount, 1) && R2.actualsEntered.length === 0, JSON.stringify(R2).slice(0, 200));
  var req3 = JSON.parse(JSON.stringify(REQ)); req3.actualAmounts = { delivery: 4.25 };
  var r3 = E.compute(CFG, req3);
  ok('A6 entering only postage leaves the copy lines honestly unpriced (components still flagged)', near(r3.requestLevel.deliverySubtotal, 4.25) && r3.requestLevel.duplication[1].needsActual && r3.components[0].hasUnpricedActuals);

  console.log('\n=== B. API ===');
  await db.initDb();
  var jid = await JR.activeJid();
  var user = await db.get("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL ORDER BY id LIMIT 1");
  // A fee profile with 'actual' rates for the active jurisdiction (test DB only), and a request to price.
  var pid = 'feeprof-' + TAG;
  await db.run("UPDATE fee_profiles SET status = 'superseded' WHERE jurisdiction_id = ? AND context = 'FR' AND status = 'active'", [jid]);
  await db.run('INSERT INTO fee_profiles (id, jurisdiction_id, context, version, status, name, config_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [pid, jid, 'FR', 999, 'active', 'AA harness', JSON.stringify(CFG), 'harness', '2026-08-26 00:00:00', '2026-08-26 00:00:00']);
  var rid = 'req-' + TAG;
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, purpose, fee_waiver_requested) VALUES (?,?,?,?,?,?,'active','standard',0)", [rid, rid, 'AA Harness', 'aa@example.com', 'aa harness ' + TAG, 'estimate']);
  var body = { components: [{ id: rid, label: 'A', quantities: { bwPages: 10, colorPages: 30, media: [{ type: 'usb', count: 1 }] } }], delivery: { method: 'mail' }, certification: { count: 0 }, purpose: 'standard', rateOverrides: {}, actualAmounts: { dup_color: 20, 'media:usb': 7.5, delivery: 4.25 } };
  var e1 = await callAs(user, 'POST', '/fee-estimates/request/' + rid, body);
  var fc = e1.body && e1.body.estimate && e1.body.estimate.feeContext;
  ok('B1 POST estimate passes actualAmounts to the engine: total 32.75, lines entered', e1.status === 200 && fc && near(fc.requestLevel.total, 32.75) && fc.requestLevel.actualsEntered.length === 3, JSON.stringify(e1.body).slice(0, 220));
  var g = await callAs(user, 'GET', '/fee-estimates/request/' + rid);
  ok('B2 the snapshot keeps what staff typed: GET latest.input.actualAmounts round-trips', g.status === 200 && g.body.latest && g.body.latest.input && g.body.latest.input.actualAmounts && near(g.body.latest.input.actualAmounts.dup_color, 20) && near(g.body.latest.input.actualAmounts.delivery, 4.25), JSON.stringify(g.body.latest && g.body.latest.input).slice(0, 200));
  body.actualAmounts = { dup_color: 22, 'media:usb': 7.5, delivery: 5.1 };
  var rc = await callAs(user, 'POST', '/fee-estimates/request/' + rid + '/reconcile', body);
  var rcTotal = rc.body && (rc.body.actualTotal != null ? rc.body.actualTotal : (rc.body.feeContext && rc.body.feeContext.requestLevel.total));
  ok('B3 reconcile takes the true actuals: total becomes 1 + 22 + 7.5 + 5.10 = 35.60', rc.status === 200 && rcTotal != null && near(rcTotal, 35.6), JSON.stringify(rc.body).slice(0, 220));

  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(1); });
