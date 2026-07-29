'use strict';
// PHASE 7 / BW2 — CATALOG & ROUTING. What this harness asserts, and why each claim is worth a test:
//
//   A. THE CATALOG. intake_review / mrr_management / release_review are routable and grantable; the
//      hand-assigned MRR trio is deliberately NOT routable but still carries a required role, because a
//      role-less task is claimable by anyone (brief §3.5) and "hand-assigned" must not mean "world-open".
//   B. THE RETIREMENT. Nothing spawns `routing_review` any more; the unroutable path raises an
//      `intake_review` carrying trigger `unroutable`, and re-routing the request closes it — the exact
//      behaviour routing_review had. Legacy routing_review rows still close, so tasks in flight across the
//      deploy are not stranded.
//   C. TRIGGERS. Spawns are ADDITIVE: a second trigger extends the one open stop instead of stacking a
//      second one, and resolving ONE reason on a multi-reason task drops that key and leaves the stop.
//      This is the whole difference between a trigger list and a task per trigger.
//   D. KNOBS. Defaults are today's behaviour (`when_needed`, `either`), the close_approval resolver walks
//      department -> office in the right order, and `always` mode raises a stop that re-routing does NOT
//      close (routing is not what a city on always-mode asked to review).
//   E. TWO EYES. The completer of the request's most recent flow task cannot claim, be routed, or even SEE
//      its release review — asserted through the service AND the route, because they disagreed once before.
//   F. COVERAGE GAP. A stage task spawned into an empty pool tells the team's manager rather than sitting
//      silently in nobody's queue.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var fs = require('fs');
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var IR = require('/opt/optimumq/backend/src/services/intakeReview');
var PC = require('/opt/optimumq/backend/src/services/processingConfig');
var CG = require('/opt/optimumq/backend/src/services/coverageGap');
var WE = require('/opt/optimumq/backend/src/services/workflowEngine');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'BW2-' + Date.now();
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, p, body, token) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || TOKEN) } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j }); });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

// A bare request row. The harness never drives the classifier — every intake path below is exercised with
// an explicit matcher result, so no LLM call is made and no test depends on an API being up.
async function makeRequest(id, fields) {
  fields = fields || {};
  await db.run(
    "INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id) " +
    "VALUES (?,?,?,?,?,?,'active',?)",
    [id, id, 'BW2 Harness', 'bw2@example.com', fields.description || ('bw2 harness ' + TAG),
     fields.stage || 'intake', fields.departmentId || null]);
  return id;
}

// teamId null out of the rulebook — the unroutable condition, without the classifier.
var UNROUTABLE_MATCH = { classification: 'standard', recordTypeConfidence: 0, flags: [], departmentId: null,
  custodianDepartmentId: null, routingBasis: 'unassigned', reasoning: 'harness: team undeterminable' };

(async function () {
  await db.initDb();
  var created = { requests: [], tasks: [], notifications: [] };
  var savedProcessing = null, jid = null;
  try {
    jid = await JR.activeJid();
    try { savedProcessing = jid ? await JR.read(jid, PC.DOMAIN) : null; } catch (e) { savedProcessing = null; }

    var user = await db.get("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL LIMIT 1");
    var other = await db.get("SELECT * FROM users WHERE status = 'active' AND id <> ? AND department_id = ? LIMIT 1",
      [user.id, user.department_id]);
    if (!other) other = await db.get("SELECT * FROM users WHERE status = 'active' AND id <> ? LIMIT 1", [user.id]);
    TOKEN = await auth.signAccessToken(user);
    var TEAM = user.department_id;

    // ================================================================================================
    console.log('\n=== A. THE CATALOG (SPEC_processing_ui §8) ===');
    ['intake_review', 'mrr_management', 'release_review'].forEach(function (t) {
      ok('A1 ' + t + ' is routable — a supervisor can grant it', tr.ROUTABLE_TASK_TYPES.indexOf(t) >= 0);
      ok('A2 ' + t + ' resolves eligibility on its OWN key (v3 model, no legacy permission role)',
        tr.TASK_ROLES[t] === t);
    });
    ['mrr_search', 'mrr_estimate', 'mrr_redaction'].forEach(function (t) {
      ok('A3 ' + t + ' is NOT routable — the RM hand-assigns it, no eligibility, no pool',
        tr.ROUTABLE_TASK_TYPES.indexOf(t) < 0 && tr.HAND_ASSIGNED_TASK_TYPES.indexOf(t) >= 0);
      ok('A4 …but it still carries a required role — a role-less task is claimable by ANYONE (§3.5)',
        !!tr.TASK_ROLES[t]);
    });
    // The picker is what a supervisor actually sees; verify_v1_retirement §E3 owns catalog parity, so here
    // we only assert the new keys reached it — an unlisted routable type is a grant nobody can make.
    var picker = fs.readFileSync('/opt/optimumq/frontend/src/pages/StaffManagementPage.js', 'utf8');
    ok('A5 the staff picker offers the three new routable types',
      /key:'intake_review'/.test(picker) && /key:'mrr_management'/.test(picker) && /key:'release_review'/.test(picker));

    var handTask = await tr.createTask({ requestId: null, type: 'mrr_redaction', title: 'MRR redaction ' + TAG, createdBy: 'harness' });
    created.tasks.push(handTask.id);
    ok('A6 a hand-assigned MRR task can be CREATED (the RM path) and is not role-less',
      !!handTask && handTask.role_required === 'mrr_redaction');
    ok('A7 …and nobody can hold that token, so it is in no claim pool — hand-assignment is the only door',
      (await tr.poolForUser(user.id)).filter(function (t) { return t.id === handTask.id; }).length === 0);

    // ================================================================================================
    console.log('\n=== B. THE RETIREMENT OF routing_review (draft §0.5 trigger (i)) ===');
    var srcFiles = [];
    (function walk(dir) {
      fs.readdirSync(dir).forEach(function (f) {
        var p = dir + '/' + f;
        if (fs.statSync(p).isDirectory()) return walk(p);
        if (/\.js$/.test(f)) srcFiles.push(p);
      });
    })('/opt/optimumq/backend/src');
    var spawns = [];
    srcFiles.forEach(function (p) {
      fs.readFileSync(p, 'utf8').split('\n').forEach(function (line, i) {
        if (/type:\s*'routing_review'/.test(line) && !/^\s*(\/\/|\*)/.test(line)) spawns.push(p + ':' + (i + 1));
      });
    });
    ok('B1 NOTHING spawns routing_review any more' + (spawns.length ? ' — found ' + spawns.join(', ') : ''),
      spawns.length === 0);

    var r1 = await makeRequest('req-' + TAG + '-B'); created.requests.push(r1);
    await WE.onIntake(r1, UNROUTABLE_MATCH);
    var stop = await IR.openTask(r1);
    ok('B2 an unroutable request raises an INTAKE REVIEW (not a routing review)', !!stop);
    ok('B3 …team-agnostic and pooled to intake_review holders, exactly as routing_review was',
      !!stop && stop.team_id === null && stop.role_required === 'intake_review');
    ok('B4 …and it records WHY it is here', !!stop && IR.triggersOf(stop).join(',') === 'unroutable');
    ok('B5 no routing_review was created alongside it', !(await IR.openLegacyRoutingReview(r1)));

    // The auto-close-on-route behaviour, moved onto the new task.
    await IR.closeForResolvedTrigger(r1, 'unroutable');
    ok('B6 routing the request CLOSES the stop — the behaviour inherited from routing_review',
      !(await IR.openTask(r1)));

    // A legacy row, mid-migration: it must still close, and must suppress a duplicate new-type stop.
    var r2 = await makeRequest('req-' + TAG + '-BL'); created.requests.push(r2);
    var legacy = await tr.createTask({ requestId: r2, type: 'routing_review', title: 'legacy ' + TAG, teamId: null, createdBy: 'harness' });
    created.tasks.push(legacy.id);
    await IR.spawn(r2, ['unroutable'], { createdBy: 'harness', awaitRouting: true });
    ok('B7 an OPEN legacy routing_review suppresses a second stop — one review, not two overlapping',
      !(await IR.openTask(r2)));
    await IR.closeForResolvedTrigger(r2, 'unroutable');
    var legacyAfter = await tr.getTask(legacy.id);
    ok('B8 …and the legacy task still closes on re-route, so nothing in flight is stranded',
      legacyAfter.status === 'done');

    // ================================================================================================
    console.log('\n=== C. TRIGGERS ARE A LIST ON ONE TASK, NOT A TASK EACH ===');
    ok('C0 the decided enum is exactly the five keys, in draft order',
      IR.TRIGGERS.join('|') === 'unroutable|eligibility_review|approval_pending|sensitivity_flag|reopen_retriage');
    // BW3 added `eligibility_review` — its structured signal now exists (services/eligibilityFindings.js).
    // `sensitivity_flag` stays deliberately unwired (which flags should stop a request is Kevin's question,
    // not an inference) and `reopen_retriage` is BW5's. verify_bw3_intake_review owns the wiring proof.
    ok('C1 only the triggers whose signals exist today are wired',
      IR.WIRED_TRIGGERS.join('|') === 'unroutable|approval_pending|eligibility_review');

    var r3 = await makeRequest('req-' + TAG + '-C'); created.requests.push(r3);
    var s1 = await IR.spawn(r3, ['unroutable'], { createdBy: 'harness', awaitRouting: true });
    var s2 = await IR.spawn(r3, ['approval_pending'], { createdBy: 'harness', awaitRouting: true });
    created.tasks.push(s1.task.id);
    ok('C2 a second trigger EXTENDS the open stop rather than stacking a second task',
      s2.created === false && s2.task.id === s1.task.id);
    ok('C3 …and both reasons are recorded', IR.triggersOf(s2.task).sort().join(',') === 'approval_pending,unroutable');
    var openCount = await db.get("SELECT count(*)::int AS n FROM tasks WHERE request_id = ? AND type = 'intake_review'", [r3]);
    ok('C4 exactly ONE intake review exists on the request', openCount.n === 1);

    await IR.closeForResolvedTrigger(r3, 'unroutable');
    var afterRoute = await IR.openTask(r3);
    ok('C5 routing a MULTI-reason stop does NOT close it — the waiver decision is still outstanding', !!afterRoute);
    ok('C6 …but the resolved reason is dropped, so the screen stops claiming it',
      !!afterRoute && IR.triggersOf(afterRoute).join(',') === 'approval_pending');
    await IR.closeForResolvedTrigger(r3, 'approval_pending');
    ok('C7 resolving the LAST reason closes the stop', !(await IR.openTask(r3)));

    // ================================================================================================
    console.log('\n=== D. THE KNOBS (SPEC §8 config deltas) ===');
    var d0 = PC.normalize(null);
    ok('D1 intake_review_mode defaults to when_needed — which IS the shipped behaviour',
      d0.intake_review_mode === 'when_needed');
    ok('D2 close_approval defaults to `either` — both doors open, so every close that works today keeps working',
      d0.close_approval.default === 'either' && PC.resolveCloseApproval(d0, null, 'denial').mode === 'either');
    var cfg = PC.normalize({ close_approval: { default: 'direct', endings: { denial: 'approval_required' },
      departments: { 'dept-x': { endings: { denial: 'either' } }, 'dept-y': { default: 'approval_required' } } } });
    ok('D3 department+ending beats office ending', PC.resolveCloseApproval(cfg, 'dept-x', 'denial').mode === 'either');
    ok('D4 department default beats office ending', PC.resolveCloseApproval(cfg, 'dept-y', 'denial').mode === 'approval_required');
    ok('D5 office ending beats office default', PC.resolveCloseApproval(cfg, 'dept-z', 'denial').mode === 'approval_required');
    ok('D6 office default is the floor', PC.resolveCloseApproval(cfg, 'dept-z', 'fulfilled').mode === 'direct');
    ok('D7 an unknown mode or ending is DROPPED, not corrected — a value nobody can act on is not a setting',
      PC.normalize({ intake_review_mode: 'sometimes', close_approval: { endings: { bogus_ending: 'direct', denial: 'maybe' } } })
        .intake_review_mode === 'when_needed' &&
      Object.keys(PC.normalize({ close_approval: { endings: { bogus_ending: 'direct', denial: 'maybe' } } }).close_approval.endings).length === 0);

    // `always` mode, end to end.
    if (jid) {
      await PC.write(jid, { intake_review_mode: 'always' }, 'bw2-harness');
      ok('D8 the knob round-trips through jurisdiction_rules', (await PC.config(jid)).intake_review_mode === 'always');
      var r4 = await makeRequest('req-' + TAG + '-D', { departmentId: TEAM }); created.requests.push(r4);
      var always = await IR.spawnForMode(r4, { createdBy: 'harness', awaitRouting: true });
      ok('D9 always mode raises a stop on a request no trigger fired for', !!always && !!always.task);
      if (always && always.task) created.tasks.push(always.task.id);
      var alwaysTask = await IR.openTask(r4);
      ok('D10 …recorded as an EMPTY trigger list, not a missing one — "always" and "legacy row" are different facts',
        !!alwaysTask && alwaysTask.spawn_triggers === '[]');
      await IR.closeForResolvedTrigger(r4, 'unroutable');
      ok('D11 …and re-routing does NOT close it: routing is not what a city on always-mode asked to review',
        !!(await IR.openTask(r4)));
      await PC.write(jid, { intake_review_mode: 'when_needed' }, 'bw2-harness');
      var r5 = await makeRequest('req-' + TAG + '-D2', { departmentId: TEAM }); created.requests.push(r5);
      ok('D12 back on the default, always-mode spawns nothing at all',
        (await IR.spawnForMode(r5, { createdBy: 'harness' })) === null && !(await IR.openTask(r5)));
    }

    // ================================================================================================
    console.log('\n=== E. TWO EYES ON release_review ===');
    var r6 = await makeRequest('req-' + TAG + '-E', { departmentId: TEAM }); created.requests.push(r6);
    // The work: a completed task on the request, done by `user`.
    var doneT = await tr.createTask({ requestId: r6, type: 'record_search', teamId: TEAM, createdBy: 'harness' });
    created.tasks.push(doneT.id);
    await db.run("UPDATE tasks SET status = 'done', assigned_to = ?, done_at = datetime('now') WHERE id = ?", [user.id, doneT.id]);
    var rel = await tr.createTask({ requestId: r6, type: 'release_review', title: 'Release review ' + TAG, teamId: null, createdBy: 'harness' });
    created.tasks.push(rel.id);
    var ex = await tr.twoEyesExclusions(rel);
    ok('E1 the completer of the most recent flow task is excluded from its release review',
      ex.length === 1 && ex[0] === user.id);
    var blockedSelf = await tr.assignmentBlocked(rel, user.id);
    ok('E2 …with a stated cause, not a bare refusal', blockedSelf.blocked === true && blockedSelf.code === 'TWO_EYES');
    ok('E3 …and a DIFFERENT person is not blocked — the rule excludes one person, not the pool',
      other ? (await tr.assignmentBlocked(rel, other.id)).blocked === false : true);

    await db.run("INSERT INTO user_task_types (user_id, task_type) VALUES (?,?) ON CONFLICT DO NOTHING", [user.id, 'release_review']);
    var claimed = await tr.claim(rel.id, user.id);
    ok('E4 CLAIMING your own work\'s review is refused', !!claimed.error && claimed.code === 'TWO_EYES');
    var svcPool = await tr.poolForUser(user.id);
    ok('E5 …and it is not OFFERED either — showing it and then refusing makes the rule look like a bug',
      svcPool.filter(function (t) { return t.id === rel.id; }).length === 0);
    var routePool = await req('GET', '/api/tasks/pool');
    ok('E6 the ROUTE agrees with the service (these two disagreed once before, §3.5)',
      routePool.status === 200 && (routePool.body.tasks || []).filter(function (t) { return t.id === rel.id; }).length === 0);
    var routed = await tr.autoRouteOrPool(rel.id, null, {});
    ok('E7 smart routing / load balancing cannot hand it to the excluded person either',
      !(routed.assigned && routed.user && routed.user.userId === user.id));
    await db.run("DELETE FROM user_task_types WHERE user_id = ? AND task_type = 'release_review'", [user.id]);

    // ================================================================================================
    console.log('\n=== F. THE COVERAGE GAP (SPEC §8, role model §6) ===');
    // A team nobody is eligible for: a fresh department with no staff at all.
    var deptId = 'dept-' + TAG;
    await db.run("INSERT INTO departments (id, name, code, kind, active) VALUES (?,?,?,'team',1)",
      [deptId, 'BW2 Empty Team ' + TAG, 'BW2' + Date.now().toString().slice(-6)]);
    var mgrRole = await db.get("SELECT id FROM function_roles WHERE name = 'DEPT_MANAGER'");
    var mgrId = 'u-' + TAG;
    await db.run("INSERT INTO users (id, email, display_name, department_id, status) VALUES (?,?,?,?,'active')",
      [mgrId, 'bw2mgr+' + TAG + '@example.com', 'BW2 Manager', deptId]);
    if (mgrRole) await db.run("INSERT INTO user_function_roles (user_id, function_role_id) VALUES (?,?) ON CONFLICT DO NOTHING", [mgrId, mgrRole.id]);

    var who = await CG.managersFor(deptId);
    ok('F1 the team\'s manager is resolvable — DEPT_MANAGER stands in for the unbuilt v3 Fulfillment Manager',
      who.users.filter(function (u) { return u.id === mgrId; }).length === 1);

    var r7 = await makeRequest('req-' + TAG + '-F', { stage: 'record_search', departmentId: deptId });
    created.requests.push(r7);
    var gapTask = await tr.spawnForStage(r7, 'record_search', 'harness');
    ok('F2 the task is still spawned — a coverage gap must not silently swallow the work', !!gapTask);
    if (gapTask) created.tasks.push(gapTask.id);
    ok('F3 …and nobody is eligible for it, which is the condition under test',
      (await tr.eligibleUsers(deptId, gapTask.role_required)).length === 0);
    // The notify is fired without awaiting so the spawn is never blocked by it.
    await new Promise(function (r) { setTimeout(r, 400); });
    var note = await db.get("SELECT * FROM notifications WHERE user_id = ? AND kind = ? AND context_id = ?",
      [mgrId, CG.KIND, gapTask.id]);
    ok('F4 THE MANAGER IS TOLD, by task — an empty pool is a stopped request that looks like nothing at all', !!note);
    if (note) created.notifications.push(note.id);
    // Re-notifying is idempotent: the reconciler re-enters this path every 2 minutes for as long as the gap lasts.
    await CG.notifyEmptyPool(gapTask, {});
    var noteCount = await db.get("SELECT count(*)::int AS n FROM notifications WHERE user_id = ? AND kind = ? AND context_id = ?",
      [mgrId, CG.KIND, gapTask.id]);
    ok('F5 …once per task, not once per reconciler sweep', noteCount.n === 1);

    console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  } finally {
    // Restore the jurisdiction's processing config exactly as it was found.
    try {
      if (jid) {
        if (savedProcessing) await JR.write(jid, PC.DOMAIN, savedProcessing, 'bw2-harness-restore');
        else await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, PC.DOMAIN]);
      }
    } catch (e) { console.error('CLEANUP ERR', e && e.message); }
  }
})();
