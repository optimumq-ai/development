'use strict';
// IS NON-PAYMENT DUNNING INERT FOR WRAPPED REQUESTS?
//
// THE SUSPICION: money is a PARENT fact, but every UI path addresses a CHILD. `feeNonpayment.sweep()` is
// PARENT-scoped (`scope.andParent`), then asks paymentStatus.computeSituation(parentId), which looks up
// `request_fee_estimates WHERE request_id = <parent>`. If estimates are written with the CHILD's id, the
// parent has none, `hasEstimate` is false, and the sweep skips the request — so no dunning email is ever
// sent and non-payment auto-close never fires, silently, for every wrapped request in the system.
//
// This harness settles it by driving the REAL estimate path against a real wrapped request.
//
// ⚠️ DELIBERATELY NOT REGISTERED IN run_suite.js — B2 FAILS TODAY. It is a REPRODUCTION of an open, live
// defect (brief §3.1b), kept as evidence rather than as a passing test. **Register it in `ALL` the moment
// the money axis is moved to the parent** — it is the regression test for that fix, already written.
// Run it on demand with: npm test -- verify_nonpayment_scope
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var requestCreate = require('/opt/optimumq/backend/src/services/requestCreate');
var paymentStatus = require('/opt/optimumq/backend/src/services/paymentStatus');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'NPS-' + Date.now();

(async function () {
  await db.initDb();

  var made = await requestCreate.createRequest({
    requestorName: 'Nonpayment Probe', requestorEmail: 'np@example.com',
    description: 'nonpayment scope probe ' + TAG
  }, { actorName: 'harness', startClocks: false, kickIntake: false });

  var childId = made.id, parentId = made.parentId;
  ok('A1 createRequest wrapped the request (parent != child)', !!parentId && parentId !== childId);

  // Write an estimate exactly where the UI writes it: keyed on the CHILD id.
  await db.run(
    "INSERT INTO request_fee_estimates (id, request_id, kind, total, deposit_due, notify_flag, created_by, created_at, notified_at) " +
    "VALUES (?,?,?,?,?,?,?, datetime('now'), datetime('now'))",
    ['fe-' + TAG, childId, 'estimate', 250, 100, 0, 'harness']);

  var onChild = await db.get("SELECT count(*)::int AS n FROM request_fee_estimates WHERE request_id = ?", [childId]);
  var onParent = await db.get("SELECT count(*)::int AS n FROM request_fee_estimates WHERE request_id = ?", [parentId]);
  ok('A2 the estimate is on the CHILD (this is what every UI path does)', onChild.n === 1);
  ok('A3 the PARENT has no estimate of its own', onParent.n === 0);

  // THE QUESTION: the nonpayment sweep only ever asks the PARENT.
  var sitParent = await paymentStatus.computeSituation(parentId);
  var sitChild = await paymentStatus.computeSituation(childId);
  console.log('    parent situation: hasEstimate=' + !!sitParent.hasEstimate);
  console.log('    child  situation: hasEstimate=' + !!sitChild.hasEstimate);

  ok('B1 the CHILD shows the money (where it was written)', !!sitChild.hasEstimate === true);
  // This assertion states the DESIRED behaviour. If it FAILS, dunning is inert for wrapped requests.
  ok('B2 the PARENT — the row the nonpayment sweep asks — can see the money',
    !!sitParent.hasEstimate === true);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
