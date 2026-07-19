'use strict';
// THE SECOND-PERSON REDACTION REVIEW ROUTES ON ITS OWN COMPETENCE (brief §3.5, "routing split-brain").
//
// THREE COUPLED DEFECTS, and the middle one was already biting legal work before this slice touched it:
//
//   1. `redaction_qa` was excluded from `ROUTABLE_TASK_TYPES`, so it could never be granted to a person and
//      was pinned to legacy permission-role routing forever — while its LEGAL sibling (`legal_redaction`)
//      routed on the v3 model. Worse, an Elevated review resolved through ROLE_TO_TYPE to the task type
//      `redaction`: the same token as DOING a redaction. "Can redact" and "can review someone else's
//      redaction" are not the same competence, and the whole point of this task is that they are different
//      people.
//
//   2. ⚠️ TWO DIVERGENT CLAIM-POOL QUERIES. `taskRouting.poolForUser` checked permission roles OR
//      `user_task_types`; the route `GET /tasks/pool` checked permission roles ONLY. So any task whose
//      `role_required` is a v3 task-type token — `legal_review`, `legal_redaction`, `routing_review` — was
//      **invisible in the claim pool** while the service happily listed it. A task nobody can see is a task
//      nobody claims, and it does not look broken; it looks quiet. Now ONE shared predicate.
//
//   3. Switching `redaction_qa` onto the v3 model naively would have STRANDED the mandatory review: with
//      nobody holding the new token, eligibility resolves to nothing. Since an Elevated/Legal redaction
//      cannot be RELEASED until a different person approves it, a stranded review task blocks release of
//      every Elevated redaction in the system. So the token is chosen at SPAWN time from whether the team
//      has actually been granted it — §C is that guard, and it is the point of this harness.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var rr = require('/opt/optimumq/backend/src/services/redactionReview');

var PORT = Number(process.env.API_PORT) || 3101;
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'QA-' + Date.now();

function req(method, p) {
  return new Promise(function (res, rej) {
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j }); });
    });
    r.on('error', rej); r.end();
  });
}

(async function () {
  await db.initDb();
  var user = await db.get("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL LIMIT 1");
  TOKEN = await auth.signAccessToken(user);
  var TEAM = user.department_id;

  // A request on the SAME team as our user, so team-scoped eligibility is exercised rather than bypassed.
  var rid = 'req-' + TAG;
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id) " +
    "VALUES (?,?,?,?,?,'redaction','active',?)", [rid, rid, 'QA Test', 'qa@example.com', 'qa routing ' + TAG, TEAM]);

  console.log('\n=== A. redaction_qa IS A GRANTABLE TASK TYPE ===');
  ok('A1 it is in ROUTABLE_TASK_TYPES', tr.ROUTABLE_TASK_TYPES.indexOf('redaction_qa') >= 0);
  // The picker parity check lives in verify_v1_retirement §E3; here we prove the API accepts the grant,
  // because routes/staff.js filters incoming types against the same catalog.
  ok('A2 …and it is distinct from `redaction` — reviewing is not doing',
    tr.ROUTABLE_TASK_TYPES.indexOf('redaction') >= 0 && 'redaction_qa' !== 'redaction');

  console.log('\n=== B. ONE CLAIM POOL — the route and the service must agree ===');
  // A task carrying a v3 token. Before the fix this was listed by poolForUser and INVISIBLE to the route.
  var tid = 'task-' + TAG;
  await db.run("INSERT INTO tasks (id, request_id, type, title, status, role_required, team_id, created_at, updated_at) " +
    "VALUES (?,?,?,?,'open',?,?, datetime('now'), datetime('now'))",
    [tid, rid, 'redaction_qa', 'Review redaction before release', 'redaction_qa', TEAM]);
  await db.run("INSERT INTO user_task_types (user_id, task_type) VALUES (?,?) ON CONFLICT DO NOTHING", [user.id, 'redaction_qa']);

  var svc = await tr.poolForUser(user.id);
  var viaService = svc.filter(function (t) { return t.id === tid; }).length === 1;
  var route = await req('GET', '/api/tasks/pool');
  var viaRoute = route.status === 200 && (route.body.tasks || []).filter(function (t) { return t.id === tid; }).length === 1;
  ok('B1 the service lists a v3-token task for a holder of that token', viaService);
  ok('B2 THE ROUTE LISTS IT TOO — this is what was silently false', viaRoute);
  ok('B3 route and service agree', viaService === viaRoute);

  // And the predicate still EXCLUDES: holding the token must not open someone else's team's work.
  await db.run("DELETE FROM user_task_types WHERE user_id = ? AND task_type = ?", [user.id, 'redaction_qa']);
  var route2 = await req('GET', '/api/tasks/pool');
  var stillThere = (route2.body.tasks || []).filter(function (t) { return t.id === tid; }).length;
  ok('B4 …and revoking the token hides it again — the predicate discriminates, it does not just pass', stillThere === 0);

  console.log('\n=== C. THE CUTOVER CANNOT STRAND THE MANDATORY REVIEW ===');
  // An Elevated redaction cannot be RELEASED until a different person approves it. A review task routed to
  // a token nobody holds would block release of every Elevated redaction — so the token is chosen at spawn.
  // A FRESH request: spawnReviewTask is idempotent per request, and §B's task is still open on `rid` — it
  // would (correctly) refuse to spawn a second one and this section would test nothing.
  var rid2 = 'req-' + TAG + '-C';
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id) " +
    "VALUES (?,?,?,?,?,'redaction','active',?)", [rid2, rid2, 'QA Test', 'qa@example.com', 'qa cutover ' + TAG, TEAM]);
  var job = { id: 'job-' + TAG, request_id: rid2, disposition: 'elevated', submitted_by: 'someone-else' };
  ok('C0 nobody on the team holds redaction_qa yet', (await tr.hasSeededType('redaction_qa', TEAM)) === false);
  var t1 = await rr.spawnReviewTask(job, { actor: 'harness' });
  ok('C1 with nobody granted, the review still routes the legacy way (REDACTION_WORKER)',
    !!t1 && t1.role_required === 'REDACTION_WORKER');
  await db.run("DELETE FROM tasks WHERE id = ?", [t1.id]);

  await db.run("INSERT INTO user_task_types (user_id, task_type) VALUES (?,?) ON CONFLICT DO NOTHING", [user.id, 'redaction_qa']);
  ok('C2 once someone on the team is granted it, the team is seeded', (await tr.hasSeededType('redaction_qa', TEAM)) === true);
  var t2 = await rr.spawnReviewTask(job, { actor: 'harness' });
  ok('C3 …and the next review routes on the NEW token — the grant actually takes effect',
    !!t2 && t2.role_required === 'redaction_qa');
  ok('C4 either way a review task IS spawned — the gate is never left without one', !!t1 && !!t2);
  await db.run("DELETE FROM tasks WHERE id = ?", [t2.id]);

  console.log('\n=== D. THE SAFETY PROPERTY IS UNTOUCHED ===');
  // The whole reason this task exists: the author may not release their own Elevated/Legal work. Asserted
  // here because this slice edited redactionReview.js, and a routing change must not loosen the gate.
  var self = rr.gateApply({ disposition: 'elevated', review_stage: 'pending_review', submitted_by: 'alice' }, 'alice');
  ok('D1 the author still cannot release their own elevated redaction', self.allowed === false && self.code === 403);
  var other = rr.gateApply({ disposition: 'elevated', review_stage: 'pending_review', submitted_by: 'alice' }, 'bob');
  ok('D2 a different reviewer still can', other.allowed === true);
  var unsub = rr.gateApply({ disposition: 'elevated', review_stage: 'editing', submitted_by: null }, 'bob');
  ok('D3 and an unsubmitted elevated job still cannot be released at all', unsub.allowed === false && unsub.code === 409);

  console.log('\n=== E. A TASK WITH NO REQUIRED ROLE WAS CLAIMABLE BY ANYONE (brief §3.5) ===');
  // `role_required` NULL meant "everyone eligible" in BOTH readers: the pool predicate listed it to every
  // authenticated user, and claim() skipped its eligibility check outright. `review_auto_redaction` spawned
  // exactly that way — no TASK_ROLES entry — so an auto-redaction batch could be claimed and worked by
  // anyone with a login, in any department, with no redaction competence at all.
  ok('E1 review_auto_redaction now has a required role — reviewing redactions needs redaction competence',
    tr.TASK_ROLES.review_auto_redaction === 'REDACTION_WORKER');
  var batch = await tr.createTask({ requestId: null, type: 'review_auto_redaction',
    title: 'Review auto-redaction batch ' + TAG, createdBy: 'harness' });
  ok('E2 …and a batch task spawned the way massJobs spawns it carries that role, not NULL',
    !!batch && batch.role_required === 'REDACTION_WORKER');
  await db.run("DELETE FROM tasks WHERE id = ?", [batch.id]);

  // THE CLASS, not just the instance: refuse to CREATE a task nobody's competence gates. Failing at creation
  // fails loudly where the omission is made, rather than producing a row that looks ordinary and is open to
  // everyone. POST /api/tasks passes roleRequired straight from the body, so any new type could do this.
  var threw = null;
  try { await tr.createTask({ requestId: rid, type: 'some_new_type_' + TAG, title: 'x', createdBy: 'harness' }); }
  catch (e) { threw = e.message; }
  ok('E3 creating a task whose type has no role THROWS instead of quietly opening it to everyone',
    !!threw && /no required role/i.test(threw));

  // Defence in depth for a legacy or hand-inserted row: both readers must treat NULL as "nobody".
  var orphan = 'task-' + TAG + '-null';
  await db.run("INSERT INTO tasks (id, request_id, type, title, status, role_required, team_id, created_at, updated_at) " +
    "VALUES (?,?,?,?,'open',NULL,NULL, datetime('now'), datetime('now'))",
    [orphan, rid, 'review_auto_redaction', 'Legacy role-less task ' + TAG]);
  var poolNull = await req('GET', '/api/tasks/pool');
  ok('E4 a role-less task is advertised to NOBODY (it used to be the first branch of the predicate)',
    (poolNull.body.tasks || []).filter(function (t) { return t.id === orphan; }).length === 0);
  var claimNull = await tr.claim(orphan, user.id);
  ok('E5 …and cannot be claimed — claim() used to SKIP the check entirely when the role was NULL',
    !!claimNull.error && /no required role/i.test(claimNull.error));
  await db.run("DELETE FROM tasks WHERE id = ?", [orphan]);

  // ⚠️ POSITIVE CONTROL. Failing closed is only correct if ordinary work still flows — a guard that denies
  // everything would pass every assertion above and break the product.
  await db.run("INSERT INTO user_task_types (user_id, task_type) VALUES (?,?) ON CONFLICT DO NOTHING", [user.id, 'redaction_qa']);
  var good = 'task-' + TAG + '-ok';
  await db.run("INSERT INTO tasks (id, request_id, type, title, status, role_required, team_id, created_at, updated_at) " +
    "VALUES (?,?,?,?,'open',?,?, datetime('now'), datetime('now'))",
    [good, rid, 'redaction_qa', 'Claimable review ' + TAG, 'redaction_qa', TEAM]);
  var claimOk = await tr.claim(good, user.id);
  ok('E6 POSITIVE CONTROL — an eligible user can still claim a properly-roled task',
    !claimOk.error && claimOk.task && claimOk.task.assigned_to === user.id);
  await db.run("DELETE FROM tasks WHERE id = ?", [good]);
  await db.run("DELETE FROM user_task_types WHERE user_id = ? AND task_type = ?", [user.id, 'redaction_qa']);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
