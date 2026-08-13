'use strict';
// FEE-CHOICE INTAKE (D1 §5 / D4 §10, item 6) — the portal's three-way fee choice, end to end through
// the REAL submit path (POST /api/public/submit), asserting on the PARENT (money facts are parent-level).
//
// The wizard's Your Information step (built 2026-07-18, Kevin-approved mockups) offers: standard rates
// (the default), a fee-waiver opt-in with a reason follow-up, and a commercial opt-in. The contract:
//   standard   -> purpose stays unset (engine reads 'standard'), no waiver machinery
//   waiver     -> fee_waiver_requested + reason on the PARENT -> onIntake spawns the fee_waiver task
//   commercial -> requestor_type='commercial' AND purpose='commercial' derived in requestCreate (the ONE
//                 creation helper), so the staff estimate opens on commercial rates for EVERY intake path
//
// WHAT THIS PREVENTS: the intake capture silently decoupling from the fee engine — a citizen declares
// commercial (or asks for a waiver) and the request proceeds as a standard-rate individual because a
// payload field was renamed or the derivation moved out of the creation helper.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');

var TAG = 'FCI-' + Date.now();
var pass = 0, fail = 0, createdParents = [];
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function submit(extra, label) {
  var body = Object.assign({
    description: label + ' ' + TAG,
    requestorName: 'FC Test', requestorEmail: 'fc@example.com'
  }, extra);
  var r = await fetch('http://localhost:' + (Number(process.env.API_PORT) || 3101) + '/api/public/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (r.status < 200 || r.status >= 300) throw new Error('submit ' + label + ' HTTP ' + r.status);
  // The child carries the description; the parent carries the money facts. Read THROUGH the parent.
  var child = null;
  for (var i = 0; i < 60 && !child; i++) {
    child = await db.get('SELECT id, master_request_id FROM requests WHERE description LIKE ?', ['%' + label + ' ' + TAG + '%']);
    await sleep(250);
  }
  if (!child) throw new Error('no child created for ' + label);
  var parent = await db.get('SELECT * FROM requests WHERE id = ?', [child.master_request_id]);
  if (!parent) throw new Error('no parent for ' + label);
  createdParents.push(parent.id);
  return { child: child, parent: parent };
}
async function waiverTask(parentId, childId) {
  for (var i = 0; i < 40; i++) {
    var t = await db.get("SELECT * FROM tasks WHERE request_id IN (?, ?) AND type = 'fee_waiver' AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [parentId, childId]);
    if (t) return t;
    await sleep(250);
  }
  return null;
}

(async function () {
  await db.initDb();

  console.log('\n=== A. DEFAULT — continue with standard rates, no opt-in ===');
  var a = await submit({}, 'standard water bills');
  ok('A1 the parent carries no purpose (engine will read standard)', a.parent.purpose == null || a.parent.purpose === 'standard');
  ok('A2 requestor_type is individual', a.parent.requestor_type === 'individual');
  ok('A3 no waiver machinery fires', Number(a.parent.fee_waiver_requested) === 0 && !(await db.get("SELECT id FROM tasks WHERE request_id IN (?,?) AND type='fee_waiver'", [a.parent.id, a.child.id])));

  console.log('\n=== B. FEE WAIVER — opt-in with reason, the approval task spawns ===');
  var b = await submit({ feeWaiverRequested: true, feeWaiverReason: 'nonprofit newsroom, public interest' }, 'waiver police reports');
  ok('B1 the PARENT records the waiver request and the reason',
    Number(b.parent.fee_waiver_requested) === 1 && /nonprofit newsroom/.test(b.parent.fee_waiver_reason || ''));
  var wt = await waiverTask(b.parent.id, b.child.id);
  ok('B2 the fee_waiver approval task spawned (onIntake), team-agnostic', !!wt && wt.team_id === null);
  ok('B3 a waiver request is still standard-purpose (waiver != commercial)', b.parent.purpose == null || b.parent.purpose === 'standard');

  console.log('\n=== C. COMMERCIAL — declared at intake, the estimate opens commercial ===');
  var c = await submit({ requestorType: 'commercial' }, 'commercial title research');
  ok('C1 requestor_type=commercial on the PARENT', c.parent.requestor_type === 'commercial');
  ok('C2 purpose=commercial derived in the one creation helper (the estimate screen and feeEngine read this)',
    c.parent.purpose === 'commercial');
  ok('C3 the child is not "the commercial one" — money facts read through the parent (child forced is_mrr=0, has its own row)',
    Number((await db.get('SELECT is_mrr FROM requests WHERE id = ?', [c.child.id])).is_mrr) === 0);
  ok('C4 no waiver machinery on a commercial declare', !(await db.get("SELECT id FROM tasks WHERE request_id IN (?,?) AND type='fee_waiver'", [c.parent.id, c.child.id])));

  console.log('\n=== D. LEAVE THE WORLD AS FOUND ===');
  for (var pid of createdParents) {
    await db.run('DELETE FROM requests WHERE master_request_id = ?', [pid]);
    await db.run('DELETE FROM requests WHERE id = ?', [pid]);
  }
  var left = await db.get('SELECT count(*)::int AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
  ok('D1 all three request families are gone (tasks/bookmarks/clocks follow by cascade)', Number(left.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
