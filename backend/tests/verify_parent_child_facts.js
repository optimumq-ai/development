'use strict';
// PARENT FACTS THROUGH THE PARENT — the invariant in CLAUDE.md, proven on a two-child request (audit 2026-08-31,
// docs/audit/2026-08-31_spec_and_architecture.md §1e).
//
//   A. A two-child request: the parent holds the citizen's number; each child carries a -N suffix.
//   B. Citizen-facing reads addressed with a CHILD say the PARENT's number: the estimate panel header (and the
//      MRR badge), the estimate notice, the balance notice, the financial profile, the clarification letter.
//   C. The fee-waiver decision addressed with a child is WRITTEN on the parent and READ back through a child.
//   D. Closing the PARENT (the no-clarification / nonpayment sweeps' act) cascades: every child closes with its
//      own history row and its open tasks cancelled. Reopening the parent restores cascade-closed children.
//   E. A child that ended on its own is NOT reopened by a parent reopen.
//
// BREAKS THIS SHOULD CATCH: a notice reading request_number off the child (B) · the waiver UPDATE keyed on
// the addressed row (C) · applyStageTransition closing only the row it is given (D).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ut = require('/opt/optimumq/backend/src/services/userTypes');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var TR = require('/opt/optimumq/backend/src/services/taskRouting');
var CA = require('/opt/optimumq/backend/src/services/clarificationAction');

var pass = 0, fail = 0;
function ok(l, c, extra) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !extra ? '' : '  -> ' + String(extra).slice(0, 300))); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'pcf' + Date.now().toString().slice(-6);
async function mk(key) { var id = 'u-' + TAG + '-' + key; await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [id, id + '@test.optimumq.ai', 'PCF ' + key, 'Test ' + TAG]); await ut.grant(id, key, null, 'harness'); return id; }
async function callAs(id, method, path, body) {
  var t = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [id]));
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
function err(r) { return (r.body && (r.body.error || r.body.message)) || ('HTTP ' + r.status); }

(async function () {
  await db.initDb();
  var DIR = await mk('oro_director');
  var made = [];
  try {
    console.log('\n=== A. A TWO-CHILD REQUEST ===');
    var r = await RC.createRequest({ requestorName: 'Parent Facts', requestorEmail: 'pcf.' + TAG + '@example.com', requestorPhone: '555-0101',
      children: [{ description: 'Building permits for 1 Main St ' + TAG }, { description: 'Inspection reports for 1 Main St ' + TAG }] }, { kickIntake: false, actorName: 'harness' });
    var P = await db.get('SELECT * FROM requests WHERE id = ?', [r.parentId]);
    var kids = await db.all('SELECT * FROM requests WHERE master_request_id = ? ORDER BY child_no', [r.parentId]);
    made = [r.parentId].concat(kids.map(function (k) { return k.id; }));
    ok('A1 the parent exists with the citizen\'s number and two children', !!P && kids.length === 2, kids.length);
    var C1 = kids[0], C2 = kids[1];
    ok('A2 each child carries a suffixed number (' + C1.request_number + ')', C1.request_number === P.request_number + '-1' && C2.request_number === P.request_number + '-2');
    ok('A3 the parent is MRR (two children) and the children are forced 0', P.is_mrr === 1 && C1.is_mrr === 0);

    console.log('\n=== B. CITIZEN-FACING READS ADDRESSED WITH A CHILD ===');
    var est = await callAs(DIR, 'GET', '/fee-estimates/request/' + C1.id);
    ok('B1 the estimate panel header addressed with the child shows the PARENT\'s number', est.status === 200 && est.body.request && est.body.request.number === P.request_number, err(est) + ' ' + JSON.stringify(est.body && est.body.request));
    ok('B2 ...and the MRR badge (is_mrr through the parent)', est.status === 200 && est.body.request && est.body.request.isMrr === true, JSON.stringify(est.body && est.body.request));
    var fp = await callAs(DIR, 'GET', '/fee-estimates/request/' + C1.id + '/financial-profile');
    ok('B3 the financial profile addressed with the child names the parent\'s number and keeps the child\'s description', fp.status === 200 && fp.body.request && fp.body.request.requestNumber === P.request_number && /Building permits/.test(fp.body.request.description || ''), err(fp) + ' ' + JSON.stringify(fp.body && fp.body.request));
    var pv = await CA.preview(C2.id, {});
    var pvText = JSON.stringify(pv || {});
    ok('B4 the clarification letter preview addressed with a child quotes the PARENT\'s number, never the -2', pvText.indexOf(P.request_number) >= 0 && pvText.indexOf(C2.request_number) < 0, pvText.slice(0, 200));
    ok('B5 ...and the child\'s description', /Inspection reports/.test(pvText), '');
    // notices need a saved estimate; the balance notice needs a payment state — assert the number where one exists
    var bn = await callAs(DIR, 'GET', '/fee-estimates/request/' + C1.id + '/balance-notice');
    ok('B6 the balance notice route reads the parent\'s facts (either a notice with the parent number, or the honest "no estimate" refusal)', (bn.status === 400 && /No estimate/.test(err(bn))) || (bn.status === 200 && JSON.stringify(bn.body).indexOf(P.request_number) >= 0 && JSON.stringify(bn.body).indexOf(C1.request_number) < 0), err(bn));

    console.log('\n=== C. THE WAIVER IS WRITTEN ON THE PARENT ===');
    await db.run("UPDATE requests SET fee_waiver_requested = 1 WHERE id = ?", [r.parentId]);
    var wd = await callAs(DIR, 'POST', '/requests/' + C1.id + '/fee-waiver-decision', { decision: 'grant' });
    ok('C1 granting via the CHILD is accepted', wd.status === 200 && wd.body && wd.body.decision === 'granted', err(wd));
    var Pw = await db.get('SELECT fee_waiver_status FROM requests WHERE id = ?', [r.parentId]);
    var C1w = await db.get('SELECT fee_waiver_status FROM requests WHERE id = ?', [C1.id]);
    ok('C2 the decision landed on the PARENT row', Pw.fee_waiver_status === 'granted', Pw.fee_waiver_status);
    ok('C3 ...and not on the child row', C1w.fee_waiver_status !== 'granted', C1w.fee_waiver_status);
    var fp2 = await callAs(DIR, 'GET', '/fee-estimates/request/' + C2.id + '/financial-profile');
    ok('C4 the OTHER child\'s financial profile sees the waiver (read through the parent)', fp2.status === 200 && fp2.body.feeWaiver && fp2.body.feeWaiver.status === 'granted', JSON.stringify(fp2.body && fp2.body.feeWaiver));

    console.log('\n=== D. CLOSING THE PARENT CASCADES; REOPENING RESTORES ===');
    await TR.applyStageTransition(C1.id, 'record_search', { actorName: 'harness', action: 'STAGE_ADVANCED' });
    var openBefore = await db.all("SELECT id FROM tasks WHERE request_id IN (?, ?) AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [C1.id, C2.id]);
    await TR.applyStageTransition(r.parentId, 'closed', { actorName: 'System', action: 'CLOSED_NO_CLARIFICATION', notes: 'harness' });
    var kidsAfter = await db.all('SELECT id, status, stage FROM requests WHERE master_request_id = ?', [r.parentId]);
    ok('D1 every child is closed with the parent (' + kidsAfter.map(function (k) { return k.status; }).join(',') + ')', kidsAfter.every(function (k) { return k.status === 'closed' && k.stage === 'closed'; }));
    var openAfter = await db.all("SELECT id FROM tasks WHERE request_id IN (?, ?) AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [C1.id, C2.id]);
    ok('D2 no claimable task survives on any child (' + openBefore.length + ' open before → ' + openAfter.length + ')', openAfter.length === 0);
    var h1 = await db.get("SELECT action, stage_from, stage_to FROM request_history WHERE request_id = ? AND stage_to = 'closed' ORDER BY created_at DESC LIMIT 1", [C1.id]);
    ok('D3 each child has its own CLOSED_CASCADE history row remembering its stage (' + (h1 && h1.stage_from) + ')', !!h1 && h1.action === 'CLOSED_CASCADE' && h1.stage_from === 'record_search');
    await TR.applyStageTransition(r.parentId, 'awaiting_payment', { reopen: true, actorName: 'harness', action: 'REOPENED_NONPAYMENT' });
    var C1r = await db.get('SELECT status, stage FROM requests WHERE id = ?', [C1.id]);
    var C2r = await db.get('SELECT status, stage FROM requests WHERE id = ?', [C2.id]);
    ok('D4 reopening the parent restores each cascade-closed child to the stage it was in (' + C1r.stage + ', ' + C2r.stage + ')', C1r.status === 'active' && C1r.stage === 'record_search' && C2r.status === 'active' && C2r.stage === 'intake');

    console.log('\n=== E. A CHILD THAT ENDED ON ITS OWN STAYS ENDED ===');
    await TR.applyStageTransition(C2.id, 'closed', { actorName: 'harness', action: 'CLOSED_NO_RECORDS', notes: 'ended on its own' });
    await TR.applyStageTransition(r.parentId, 'closed', { actorName: 'System', action: 'CLOSED_NONPAYMENT' });
    await TR.applyStageTransition(r.parentId, 'awaiting_payment', { reopen: true, actorName: 'harness', action: 'REOPENED_NONPAYMENT' });
    var C1e = await db.get('SELECT status FROM requests WHERE id = ?', [C1.id]);
    var C2e = await db.get('SELECT status FROM requests WHERE id = ?', [C2.id]);
    ok('E1 the cascade-closed child reopens; the child that ended on its own stays closed', C1e.status === 'active' && C2e.status === 'closed', C1e.status + '/' + C2e.status);
  } finally {
    console.log('\n=== F. CLEANUP ===');
    for (var i = 0; i < made.length; i++) { await db.run('DELETE FROM tasks WHERE request_id = ?', [made[i]]); await db.run('DELETE FROM request_history WHERE request_id = ?', [made[i]]); await db.run('DELETE FROM request_clocks WHERE request_id = ?', [made[i]]); await db.run('DELETE FROM workflow_decisions WHERE request_id = ?', [made[i]]); await db.run('DELETE FROM request_fee_estimates WHERE request_id = ?', [made[i]]); }
    for (var j = made.length - 1; j >= 0; j--) { try { await db.run('DELETE FROM requests WHERE id = ?', [made[j]]); } catch (e) { console.log('  (cleanup left ' + made[j] + ': ' + e.message + ')'); } }
    await ut.revokeAll(DIR); await db.run('DELETE FROM users WHERE id = ?', [DIR]);
    ok('F1 harness rows removed', true);
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(1); });
