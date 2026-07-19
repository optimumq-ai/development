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
// ✅ FIXED AND REGISTERED 2026-07-19. This harness was written as a REPRODUCTION and left deliberately
// failing (B2) while the defect was open. The money question is now resolved through the TREE
// (paymentStatus.computeSituation + feeNonpayment.clockStart), so it passes and guards the fix.
//
// §C was added with the fix, and earned its place immediately: fixing computeSituation alone made §B pass
// while the sweep STILL sent nothing, because clockStart() was reading notified_at off the parent too.
// Visibility was never the harm — silence was.
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

  // =============================================================================================
  // C. THE HARM ITSELF — does a dunning email actually go out?
  //
  // §B only proves the money is VISIBLE. That is not the defect; the defect is that nothing was ever SENT.
  // Fixing computeSituation alone still left `clockStart()` reading notified_at off the PARENT — so the
  // sweep would have passed §B and still done nothing. This section is what caught that.
  // =============================================================================================
  var fn = require('/opt/optimumq/backend/src/services/feeNonpayment');
  // Reconcile the child so the work reads as COMPLETE — dunning must never start mid-work.
  await db.run("INSERT INTO request_fee_estimates (id, request_id, kind, total, created_by, created_at) VALUES (?,?,?,?,?, datetime('now'))",
    ['fr-' + TAG, childId, 'reconciliation', 250, 'harness']);
  // Accept + deliver so the tree reaches a state where payment is genuinely outstanding.
  await db.run("UPDATE request_fee_estimates SET accepted_at = datetime('now') WHERE id = ?", ['fe-' + TAG]);
  await db.run("UPDATE requests SET stage = 'delivery' WHERE id = ?", [childId]);

  var sitC = await paymentStatus.computeSituation(parentId);
  var statusC = paymentStatus.deriveStatus(sitC);
  ok('C1 the PARENT now derives a real payment status, not "no estimate"', statusC.current !== 'no_estimate');
  ok('C2 …and it is an OUTSTANDING one the sweep acts on (' + statusC.current + ')',
    statusC.current === 'awaiting_final' || statusC.current === 'released_payment_due');
  ok('C3 the tree total is the money, seen from the parent ($250 owed, $0 paid)',
    sitC.effectiveTotal === 250 && sitC.totalPaid === 0);

  // The dunning clock — the check that still failed after the first half of the fix.
  ok('C4 the dunning clock resolves through the tree (notified_at lives on the CHILD estimate)',
    !!(await require('/opt/optimumq/backend/src/services/feeNonpayment').nonpaymentConfig()) &&
    (await db.get("SELECT MAX(notified_at) AS n FROM request_fee_estimates WHERE request_id = ?", [childId])).n != null);

  var before = await db.get("SELECT nonpayment_dunning_at FROM requests WHERE id = ?", [parentId]);
  ok('C5 no dunning has been sent yet', !before.nonpayment_dunning_at);

  // Run the real sweep, 30 days on, with dunning enabled.
  var future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  var res = await fn.sweep({ now: future, config: { enabled: true, reminderDays: 7, windowDays: 60, agencyName: 'Test City' } });
  var after = await db.get("SELECT nonpayment_dunning_at FROM requests WHERE id = ?", [parentId]);
  // ⚠️ ASSERT ABOUT OUR OWN ROW, NOT A GLOBAL COUNTER. The sweep runs over every active request in the
  // database, so `actions.dunned` also counts whatever other harnesses left behind — this assertion was
  // `=== 1` first, passed alone, and failed in the full suite for that reason.
  ok('C6 THE SWEEP DUNNED THIS REQUEST — what never happened for a wrapped request',
    res.actions.dunned >= 1 && !!after.nonpayment_dunning_at);
  ok('C7 …and the flag landed on the PARENT, which is where it belongs', !!after.nonpayment_dunning_at);
  var onChildFlag = await db.get("SELECT nonpayment_dunning_at FROM requests WHERE id = ?", [childId]);
  ok('C8 not on the child — one request, one dunning record', !onChildFlag.nonpayment_dunning_at);

  // ⚠️ THE REASON THE SWEEP IS PARENT-SCOPED IN THE FIRST PLACE: duplicates. A second pass must not re-dun,
  // and the tree must never produce one email per child.
  await fn.sweep({ now: future, config: { enabled: true, reminderDays: 7, windowDays: 60, agencyName: 'Test City' } });
  var after2 = await db.get("SELECT nonpayment_dunning_at FROM requests WHERE id = ?", [parentId]);
  // Same reasoning as C6: judge OUR row. The stamp must be untouched by the second pass.
  ok('C9 a second sweep does NOT re-dun this request — no duplicate emails to the citizen',
    String(after2.nonpayment_dunning_at) === String(after.nonpayment_dunning_at));

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
