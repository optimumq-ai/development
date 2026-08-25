'use strict';
// FINANCIAL-AUTHORITY ROLE RECONCILIATION — D4 §8, item 9.
//
// WHAT THIS HARNESS EXISTS TO PREVENT — and it was LIVE until 2026-07-15:
//
//   The "who may approve a fee decision" authority was split across BOTH role catalogs under TWO names:
//     - the fee-waiver TASK routed to, and /fee-waiver-decision authorized on, the *permission* role
//       FEE_AUTHORITY;
//     - fee-OBJECTION approval (/objections/:id/approve, /objections/pending-approval) and the
//       fee-waiver-denial reason library (/decision-reasons) gated on the *function* role
//       FEE_WAIVER_APPROVER — which almost no one held (one user in live, zero in the seeds).
//   So the person who RECEIVED the fee-waiver task (a FEE_AUTHORITY holder) could not approve a fee
//   objection or even see the approval queue unless they separately held DIRECTOR/SYSTEM_ADMIN. Two names,
//   two catalogs, one concept, one silent authorization hole.
//
// THE FIX: collapse to ONE canonical role, the FINANCE permission/capability (renamed from FEE_AUTHORITY),
// gating routing AND every financial gate; retire the orphan FEE_WAIVER_APPROVER function role. This harness
// proves a FINANCE holder who is NOT a manager can now act, a non-holder still cannot, and the old names are
// gone from the catalog and from routing.
//
// BREAKS THIS SHOULD CATCH: re-introduce FEE_WAIVER_APPROVER on a gate -> C goes red (a FINANCE-only user is
// refused). Point fee_waiver routing back at a dead role -> B red. Leave FEE_AUTHORITY in the catalog -> A red.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var PORT = Number(process.env.API_PORT) || 3101;

async function token(userId) {
  var u = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  return u ? await auth.signAccessToken(u) : null;
}
async function api(method, path, tok, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method,
    headers: Object.assign(tok ? { Authorization: 'Bearer ' + tok } : {}, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async function () {
  await db.initDb();

  console.log('\n=== A. THE CATALOG — one financial capability, the old names and tables are gone (S5) ===');
  var UT = require('/opt/optimumq/backend/src/services/userTypes');
  ok('A1 FINANCE is an act permission carried by oro_finance and oro_director', UT.ACT_PERMS.oro_finance.indexOf('FINANCE') !== -1 && UT.ACT_PERMS.oro_director.indexOf('FINANCE') !== -1);
  ok('A2 the legacy FEE_AUTHORITY name appears in no act-permission list', Object.keys(UT.ACT_PERMS).every(function (k) { return UT.ACT_PERMS[k].indexOf('FEE_AUTHORITY') === -1; }));
  var legacyT = (await db.all("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('function_roles','permission_roles','user_function_roles','user_permission_roles')")).length;
  ok('A3 the v1 role catalogs no longer exist as tables', legacyT === 0);
  ok('A4 oro_sysadmin does NOT carry FINANCE (technical-only)', UT.ACT_PERMS.oro_sysadmin.indexOf('FINANCE') === -1);
  var deadTask = await db.get("SELECT COUNT(*) AS c FROM tasks WHERE role_required = 'FEE_AUTHORITY'");
  ok('A5 no task still names the old routing role', Number(deadTask.c) === 0);
  var holders = await UT.usersWithActPerm('FINANCE');
  ok('A6 the FINANCE capability actually has holders (derived from user types)', holders.length > 0);

  console.log('\n=== B. ROUTING — the fee-waiver task points at FINANCE ===');
  ok('B1 TASK_ROLES.fee_waiver === FINANCE', tr.TASK_ROLES && tr.TASK_ROLES.fee_waiver === 'FINANCE');
  // Team-agnostic fee_waiver eligibility resolves the FINANCE holders (legacy permission-role fallback).
  var elig = await tr.eligibleUsers(null, 'FINANCE');
  ok('B2 eligibleUsers resolves FINANCE holders for the fee-waiver task', Array.isArray(elig) && elig.length > 0);

  console.log('\n=== C. THE GATES — a FINANCE holder can act; a non-holder cannot (the bug fix) ===');
  // Robert Cho holds FINANCE but is only a DEPT_MANAGER — NOT DIRECTOR/SYSTEM_ADMIN. Before this slice he was
  // refused at every fee gate. Marcus Bell holds neither: the control that proves the gate still bites.
  var finTok = await token('u-finance-super');   // FINANCE capability, no manager role
  var doerTok = await token('u-police-staff');    // no FINANCE, no manager
  ok('C0 both test users exist', !!finTok && !!doerTok);

  // C1/C2 — the approval queue.
  ok('C1 FINANCE holder may see the fee-objection approval queue (was 403 before the fix)',
    (await api('GET', '/objections/pending-approval', finTok)).status === 200);
  ok('C2 a non-FINANCE doer is still refused the approval queue',
    (await api('GET', '/objections/pending-approval', doerTok)).status === 403);

  // C3/C4 — the approve action. A non-existent id proves the GATE opened (handler reached -> 404, not 403).
  ok('C3 FINANCE holder passes the approve gate (404 on a fake id, NOT 403)',
    (await api('POST', '/objections/no-such-objection/approve', finTok, { decision: 'approve' })).status === 404);
  ok('C4 a non-FINANCE doer is refused the approve action (403)',
    (await api('POST', '/objections/no-such-objection/approve', doerTok, { decision: 'approve' })).status === 403);

  // C5/C6 — the fee-waiver-denial reason library.
  var rTag = 'RECON-' + Date.now();
  ok('C5 FINANCE holder may add a decision reason (gate passes)',
    (await api('POST', '/decision-reasons', finTok, { category: 'fee_waiver_denial', text: rTag }).then(function (r) { return r; })).status < 400);
  ok('C6 a non-FINANCE doer is refused adding a decision reason (403)',
    (await api('POST', '/decision-reasons', doerTok, { category: 'fee_waiver_denial', text: rTag + '-x' })).status === 403);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
