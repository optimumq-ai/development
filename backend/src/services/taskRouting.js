// Reusable task routing + assignment primitive, shared by ALL task types
// (estimate, record_search, redaction, ...). Two mechanisms:
//   (1) POOL CLAIM  - an open task is offered to every eligible user (right team + role); any can claim it.
//   (2) SMART ROUTING - semantic match of the request text against eligible users' specialization text
//                       (pgvector cosine over voyage embeddings); high-confidence match auto-assigns.
// autoRouteOrPool() ties them together: try smart routing first; if no confident person, leave in the pool.

var db = require('../db');
var all = db.all, get = db.get, run = db.run;
var v = require('./voyageEmbed');
var uuidv4 = require('uuid').v4;

// THE STATUSES IN WHICH A TASK IS STILL LIVE WORK — i.e. it can be claimed, worked, or resolved. Anything
// else (`done`, `cancelled`) is finished: the work is over and the task must not drive anything further.
//
// This list is duplicated as a SQL literal in about six places in this file, and that duplication is how the
// hole below survived. Exported so a JS-side caller has ONE thing to ask instead of re-typing it.
// ⚠️ The SQL literals still carry their own copies — converting them is a separate, mechanical pass.
var ACTIONABLE_STATUSES = ['open', 'assigned', 'in_progress', 'returned', 'awaiting_review'];
function isActionable(status) { return ACTIONABLE_STATUSES.indexOf(status) !== -1; }

// Default eligible permission-role per task type. (Overridable per task / later per team config.)
var TASK_ROLES = {
  estimate: 'FEE_MANAGER',
  record_search: 'SEARCH_AND_TRIAGE',
  redaction: 'REDACTION_WORKER',
  // Second-person redaction review (SPEC_redaction_automation.md slice 4). Default reviewer role is a
  // REDACTION_WORKER (Elevated); Legal reviews pass roleRequired:'legal_redaction' explicitly at spawn.
  redaction_qa: 'REDACTION_WORKER',
  // Fee-waiver / commercial-rate approval routes to FINANCE — the reconciled financial-authority permission
  // role (D4 §8, item 9; renamed from FEE_AUTHORITY, and the orphan FEE_WAIVER_APPROVER function role retired).
  fee_waiver: 'FINANCE',
  // Legal task types (v3) have NO legacy permission role — their own task-type key is the eligibility
  // token, so eligibleUsers resolves them via the per-person subset (user_task_types). Office-level work.
  legal_review: 'legal_review',
  legal_redaction: 'legal_redaction',
  // Routing review: when the classifier can't determine a fulfillment team, an ORO Associate reviews and
  // corrects the routing. Office-level, team-agnostic; eligibility via the per-person subset.
  // ⚠️ RETIRED BY BW2 stage 2 — `intake_review` trigger (i) replaces it 1:1 on the unroutable path. The
  // entry stays so legacy rows already in flight remain claimable and resolvable.
  routing_review: 'routing_review',
  // ── PHASE 7 / BW2 — PROCESSING-UI CATALOG (docs/SPEC_processing_ui.md §8) ────────────────────────
  // All of these are v3 task types: their own key IS the eligibility token, resolved through the
  // per-person subset (user_task_types). None carries a legacy permission role.
  //
  // intake_review   the ORO Associate's first look. Office-level, team-agnostic. Spawned by TRIGGER, not
  //                 by stage — trigger (i) "can't determine a team" is what routing_review used to be.
  intake_review: 'intake_review',
  // mrr_management  the MRR parent hub. The `mrr_processing` design (MASTER §A2) under the name the
  //                 processing-UI spec settled on. System-routed to an ORO Associate; spawned on the
  //                 PARENT when a submission described more than one record.
  mrr_management: 'mrr_management',
  // release_review  second-eyes review before release. REGISTERED ONLY here — BW5 owns the pipeline that
  //                 spawns it, and BW8 the screen. The eligible ROLE is meant to be city-configurable
  //                 (spec §8 "config role"); the suggested default is ORO Supervisor, which in the v3
  //                 model means "the people a supervisor granted `release_review` to". No jurisdiction
  //                 knob is written for it yet — that lands with the pipeline that reads it, so nothing
  //                 stores a role nothing consults.
  release_review: 'release_review',
  // close_approval  the lightweight second signature on a CLOSE (BW5; spec §8 "close-approval, spawned by
  //                 close_approval routing"). Spawned only when the resolved `close_approval` mode routes —
  //                 `approval_required`, or `either` when the closer chose the second door. Its own key is
  //                 the eligibility token, so a city grants it to whoever it calls a supervisor.
  //
  //                 ⚠️ NOT a TWO_EYES_TYPES member, and that is a decision rather than an omission. Two-eyes
  //                 excludes whoever completed the item's last FLOW task, because a release review checks
  //                 the WORK. A close approval checks the DECISION TO END, so the only conflict is
  //                 self-approval — enforced in services/disposition.js, which knows who requested it.
  close_approval: 'close_approval',
  // process_withdrawal  spawned ad hoc when a communication is logged as a withdrawal (decided 7/29). Not a
  //                 standing type: it exists only when a withdrawal actually arrives, and it closes the
  //                 forgotten-withdrawal gap — the clock otherwise keeps running on a request nobody wants.
  process_withdrawal: 'process_withdrawal',
  // ── HAND-ASSIGNED MRR CHILD WORK ────────────────────────────────────────────────────────────────
  // NOT routable: the Request Manager assigns these per child to any person (possibly a non-user via a
  // secure link) with no eligibility check — `assign()` does not check, only `claim()` does. They need a
  // TASK_ROLES entry anyway because createTask REFUSES a role-less task (a NULL role was world-claimable,
  // brief §3.5). Pointing each at its own key gives exactly the right behaviour: nobody can hold the
  // token (it is not in ROUTABLE_TASK_TYPES, so the picker cannot grant it), so the task is invisible in
  // every claim pool and unclaimable — reachable only by the RM's deliberate hand-assignment.
  mrr_search: 'mrr_search',
  mrr_estimate: 'mrr_estimate',
  // mrr_redaction joins the pair above: redaction of one child's records, same assignment model.
  mrr_redaction: 'mrr_redaction',
  // Reviewing an auto-redaction import batch is redaction work and needs redaction competence. It had NO
  // entry here, which meant `role_required` came out NULL — and NULL was treated as "everyone eligible"
  // (brief §3.5). See the fail-closed guard in createTask below.
  review_auto_redaction: 'REDACTION_WORKER'
};

// Canonical routable task types (docs/MASTER_task_types_permission_groups.md §A1). These are the keys a
// person's per-person subset (user_task_types) is drawn from — i.e. work the SYSTEM routes by eligibility.
//
// `commercial_rate` and `mrr_processing` were REMOVED 2026-07-19 (Kevin, brief §5.4). Nothing spawned
// either — no `createTask({type:'commercial_rate'})` or `'mrr_processing'` exists anywhere — so they were
// offerable in the per-person picker and produced permanently empty pools: a supervisor could grant someone
// work that can never arrive. An entry here is a PROMISE that the router can deliver that type, and neither
// could. Live carried zero `user_task_types` rows for both, so nothing was orphaned by removing them.
//
// ⚠️ `mrr_processing` is still the DESIGNED routing mechanism for the MRR parent hub (§14.3, MASTER §A2) —
// the hub itself is brief §5 decision 3 and is still open. This deletes the catalog entry, NOT the design:
// if the hub is built, re-add the key alongside the code that actually spawns it. The MRR CHILD tasks
// (mrr_estimate / mrr_search) were never here anyway — the Request Manager hand-assigns those with no
// eligibility rules, so they never gate through user_task_types.
//
// BW2 (2026-07-29) adds `intake_review`, `mrr_management` and `release_review`. The first two arrive WITH
// their spawners in this same workstream (intake_review on the unroutable path — the retirement of
// routing_review; mrr_management on the parent of a multi-record submission), so the promise above holds
// for both. `release_review` is the deliberate exception: the spec makes BW5 the owner of the release
// pipeline that spawns it, so between BW2 and BW5 it is a routable type nothing spawns. It is registered
// early on purpose — a city has to be able to GRANT it and configure its role before the pipeline that
// uses it exists — but the empty-pool caveat above applies until BW5 lands, and the picker entry says so.
// BW5 adds `close_approval` and `process_withdrawal`. Both arrive WITH their spawners in this workstream
// (the close-approval router and the withdrawal-communication spawner), so the promise above holds for
// both: a city that grants either token will actually receive that work.
var ROUTABLE_TASK_TYPES = ['estimate', 'record_search', 'redaction', 'redaction_qa', 'legal_redaction', 'legal_review', 'fee_waiver', 'routing_review', 'intake_review', 'mrr_management', 'release_review', 'close_approval', 'process_withdrawal'];
// Task types the Request Manager hand-assigns per MRR child. Deliberately NOT routable (see TASK_ROLES):
// no eligibility, no team filter, no smart routing, never offered in the per-person picker.
var HAND_ASSIGNED_TASK_TYPES = ['mrr_search', 'mrr_estimate', 'mrr_redaction'];
// Reverse of TASK_ROLES: legacy permission-role name -> task type, used to translate existing callers
// (which pass task.role_required) onto the new task-type model during the cutover.
var ROLE_TO_TYPE = { FEE_MANAGER: 'estimate', SEARCH_AND_TRIAGE: 'record_search', REDACTION_WORKER: 'redaction', FINANCE: 'fee_waiver' };

// Smart Routing auto-assigns to the top match only when it is both decent (>= FLOOR) AND clearly ahead of
// the runner-up (lead >= MARGIN). Otherwise the task stays in the pool to claim. (Absolute cosine on short
// specialization text runs modest, so a margin test is more robust than a single high cutoff. Tunable; later
// these can move to per-team / Jurisdiction Profile config.)
var SMART_ROUTING_FLOOR = 0.45;
var SMART_ROUTING_MARGIN = 0.06;

function lit(vec) { return '[' + vec.join(',') + ']'; }

// Users on a team eligible to be assigned a task.
// NEW MODEL (v3): eligibility = active + on the team + their per-person task-type subset (user_task_types)
// includes this task type. The `roleName` arg may be a task type (new callers) or a legacy permission-role
// name (existing callers, which pass task.role_required); we translate the latter via ROLE_TO_TYPE.
// Cutover is safe and incremental — scoped PER (team, task type): a team uses the new model for a task
// type only once someone ON THAT TEAM has been assigned it; every other team stays on the legacy
// permission-role query until it is migrated. So assigning one team never affects another's routing.
// (Team-agnostic tasks — teamId null, e.g. fee_waiver — use a global guard on the task type.)
async function eligibleUsers(teamId, roleName) {
  if (!roleName) return [];
  var taskType = ROUTABLE_TASK_TYPES.indexOf(roleName) !== -1 ? roleName : ROLE_TO_TYPE[roleName];
  if (taskType) {
    var seeded;
    if (teamId) {
      seeded = await get(
        "SELECT 1 AS x FROM user_task_types utt JOIN users u ON u.id = utt.user_id " +
        "WHERE utt.task_type = ? AND u.department_id = ? LIMIT 1",
        [taskType, teamId]
      );
    } else {
      seeded = await get("SELECT 1 AS x FROM user_task_types WHERE task_type = ? LIMIT 1", [taskType]);
    }
    if (seeded) {
      var p = [taskType];
      var dc = '';
      if (teamId) { dc = ' AND u.department_id = ?'; p.push(teamId); }
      return await all(
        "SELECT u.id, u.display_name, u.routing_specialization " +
        "FROM users u " +
        "JOIN user_task_types utt ON utt.user_id = u.id " +
        "WHERE utt.task_type = ? AND u.status = 'active'" + dc,
        p
      );
    }
  }
  // Legacy fallback: the old permission-role catalog.
  var params = [roleName];
  var deptClause = '';
  if (teamId) { deptClause = ' AND u.department_id = ?'; params.push(teamId); }
  return await all(
    "SELECT u.id, u.display_name, u.routing_specialization " +
    "FROM users u " +
    "JOIN user_permission_roles upr ON upr.user_id = u.id " +
    "JOIN permission_roles pr ON pr.id = upr.permission_role_id " +
    "WHERE pr.name = ? AND u.status = 'active'" + deptClause,
    params
  );
}

// (Re)embed a user's specialization text so Smart Routing can match against it.
async function embedUserSpec(userId, text) {
  await run("DELETE FROM embeddings WHERE owner_type = 'user_spec' AND owner_id = ?", [userId]);
  if (!text || !text.trim()) return;
  var e = await v.embed(text.trim(), { inputType: 'document' });
  var vec = e[0];
  if (!vec || !vec.length) return;
  await run(
    "INSERT INTO embeddings (id, owner_type, owner_id, model, dim, vec, embedding, content, created_at) " +
    "VALUES (?,?,?,?,?,?,?::vector,?,datetime('now'))",
    [uuidv4(), 'user_spec', userId, v.MODEL, v.DIM, JSON.stringify(vec), lit(vec), text.trim()]
  );
}

// Smart Routing: rank eligible users by how well their specialization matches the request text.
// Returns [{ userId, name, score|null }] - users without specialization embeddings get score null (ranked last).
async function suggestAssignee(requestText, teamId, roleName, k) {
  k = k || 5;
  var elig = await eligibleUsers(teamId, roleName);
  if (!elig.length) return [];
  var byId = {}; elig.forEach(function (u) { byId[u.id] = u; });
  var scores = {};
  if (requestText && requestText.trim()) {
    var e = await v.embed(requestText.trim(), { inputType: 'query' });
    var qv = e[0];
    if (qv && qv.length) {
      var ql = lit(qv);
      var ids = elig.map(function (u) { return u.id; });
      var ph = ids.map(function () { return '?'; }).join(',');
      var rows = await all(
        "SELECT e.owner_id AS id, 1 - (e.embedding <=> ?::vector) AS score " +
        "FROM embeddings e " +
        "WHERE e.owner_type = 'user_spec' AND e.embedding IS NOT NULL AND e.owner_id IN (" + ph + ") " +
        "ORDER BY e.embedding <=> ?::vector LIMIT ?",
        [ql].concat(ids).concat([ql, k])
      );
      rows.forEach(function (r) { scores[r.id] = Math.round(Number(r.score) * 1000) / 1000; });
    }
  }
  var ranked = elig.map(function (u) {
    return { userId: u.id, name: u.display_name, score: (u.id in scores) ? scores[u.id] : null };
  });
  ranked.sort(function (a, b) {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  });
  return ranked.slice(0, k);
}

async function getTask(taskId) { return await get('SELECT * FROM tasks WHERE id = ?', [taskId]); }

// ══ TWO EYES (BW2; SPEC_processing_ui §5 / Draft 9) ══════════════════════════════════════════════════
//
// A release review exists to be a SECOND look. If it can land on the person who just did the work, it is
// a first look wearing a second hat: the reviewer's own judgement is what is being checked, and self-
// review is exactly the control a release gate is supposed to provide.
//
// So the rule is stated at ASSIGNMENT time, not at screen time — a task that reaches the wrong person's
// queue has already failed, and telling them at the last click makes the failure the reviewer's problem.
// It applies to every route INTO a person: smart routing, load balancing, and claiming from the pool.
//
// "The completer of the request's most recent flow task" = the assignee of the most recently COMPLETED
// task on this request, excluding two-eyes tasks themselves (a previous release review is a review, not
// the work being reviewed). Ordering prefers `done_at`, falling back to `updated_at` for rows that
// predate the timing columns.
//
// SCOPE IS DELIBERATELY NARROW (Draft 9 marks two-eyes scope as open pending Kevin): the last completer,
// not everyone who ever touched the request. A wider exclusion can empty a small city's pool entirely,
// and an empty pool is a worse failure than a reviewer who also did an earlier step — it stops the
// request, and it stops it silently.
var TWO_EYES_TYPES = { release_review: 1 };

async function twoEyesExclusions(task) {
  if (!task || !TWO_EYES_TYPES[task.type] || !task.request_id) return [];
  var typeKeys = Object.keys(TWO_EYES_TYPES);
  var ph = typeKeys.map(function () { return '?'; }).join(',');
  var row = await get(
    "SELECT assigned_to FROM tasks WHERE request_id = ? AND id <> ? AND status = 'done' " +
    'AND assigned_to IS NOT NULL AND type NOT IN (' + ph + ') ' +
    'ORDER BY COALESCE(done_at, updated_at) DESC LIMIT 1',
    [task.request_id, task.id].concat(typeKeys));
  return (row && row.assigned_to) ? [row.assigned_to] : [];
}

// May this person take this task? Encodes the two-eyes rule as a question with a REASON, so every caller
// (claim now, manual assignment and the screen later) refuses for the same stated cause.
async function assignmentBlocked(task, userId) {
  var ex = await twoEyesExclusions(task);
  if (ex.indexOf(userId) >= 0) {
    return {
      blocked: true, code: 'TWO_EYES',
      reason: 'You completed the last step on this request, so you cannot also review its release. ' +
              'A release review has to be a second person.'
    };
  }
  return { blocked: false };
}

// ⚠️ A TASK WITHOUT A REQUIRED ROLE WAS WORLD-CLAIMABLE (brief §3.5, fixed 2026-07-19).
//
// `role_required` NULL meant "everyone eligible" in BOTH readers: the claim-pool predicate listed it to
// every authenticated user, and `claim()` skipped its eligibility check entirely (`if (task.role_required)`).
// `review_auto_redaction` spawned that way — it had no TASK_ROLES entry — so an auto-redaction batch could be
// claimed and worked by anyone with a login, regardless of competence or department.
//
// The instance is fixed above. THIS is the class: refuse to create a task nobody's competence gates. Failing
// at CREATION is deliberate — it fails loudly, at the point the omission is made, instead of producing a row
// that looks ordinary and is quietly open to everyone. Every caller today resolves a role, so this throws
// only on a genuinely new type that forgot one.
function requiredRoleFor(opts) {
  var role = opts.roleRequired || TASK_ROLES[opts.type] || null;
  if (!role) {
    throw new Error('createTask: task type "' + opts.type + '" has no required role. Add it to TASK_ROLES ' +
      'or pass roleRequired — a task with no role is claimable by any authenticated user.');
  }
  return role;
}

async function createTask(opts) {
  var id = 't-' + uuidv4().substring(0, 8);
  var role = requiredRoleFor(opts);
  // WHY the task exists, when the answer is not "the stage said so" (BW2). A trigger-spawned type records
  // its trigger key(s) here; everything else leaves it NULL and reads exactly as it always has.
  // An EMPTY array is stored as `[]`, not collapsed to NULL: "raised with no trigger" (a city running
  // intake review in `always` mode) and "predates this column" are different facts, and the auto-close
  // rule distinguishes them — see intakeReview.closeForResolvedTrigger.
  var triggers = Array.isArray(opts.spawnTriggers) ? JSON.stringify(opts.spawnTriggers) : null;
  await run(
    "INSERT INTO tasks (id, request_id, type, title, team_id, role_required, status, created_by, spawn_triggers) " +
    "VALUES (?,?,?,?,?,?, 'open', ?,?)",
    [id, opts.requestId || null, opts.type, opts.title || null, opts.teamId || null, role, opts.createdBy || null, triggers]
  );
  return await getTask(id);
}

// Assign a task to a specific user (manual or smart-routing). basis: 'manual'|'smart_routing'|'claim'.
async function assign(taskId, userId, basis, score) {
  await run(
    "UPDATE tasks SET assigned_to = ?, status = 'assigned', assignment_basis = ?, match_score = ?, updated_at = datetime('now') WHERE id = ?",
    [userId, basis || 'manual', (score == null ? null : score), taskId]
  );
  return await getTask(taskId);
}

// Claim an open task from the pool. Atomic + race-safe + eligibility-checked.
async function claim(taskId, userId) {
  var task = await getTask(taskId);
  if (!task) return { error: 'Task not found' };
  if (task.status !== 'open' || task.assigned_to) return { error: 'This task has already been taken' };
  // FAIL CLOSED on a role-less task. This used to read `if (task.role_required && ...)`, so a NULL role
  // SKIPPED the eligibility check and the task was claimable by anyone. Creation now refuses to make such a
  // task, so this can only be a legacy or hand-inserted row — and the safe answer for one is "nobody", not
  // "everybody". Live carried zero such rows when this landed.
  if (!task.role_required) {
    return { error: 'This task has no required role and cannot be claimed. Report it — it should not exist.' };
  }
  var elig = await eligibleUsers(task.team_id, task.role_required);
  if (elig.filter(function (u) { return u.id === userId; }).length === 0) {
    return { error: 'You are not eligible to claim this task' };
  }
  // TWO EYES: eligible is not the same as permitted on a review of your own work.
  var blocked = await assignmentBlocked(task, userId);
  if (blocked.blocked) return { error: blocked.reason, code: blocked.code };
  await run(
    "UPDATE tasks SET assigned_to = ?, status = 'assigned', assignment_basis = 'claim', claimed_at = datetime('now'), updated_at = datetime('now') " +
    "WHERE id = ? AND status = 'open' AND assigned_to IS NULL",
    [userId, taskId]
  );
  var after = await getTask(taskId);
  if (!after || after.assigned_to !== userId) return { error: 'This task was just claimed by someone else' };
  return { task: after };
}

// Is Auto Load Balancing turned on for this team?
async function teamLoadBalancing(teamId) {
  if (!teamId) return false;
  var d = await get('SELECT auto_load_balancing FROM departments WHERE id = ?', [teamId]);
  return !!(d && Number(d.auto_load_balancing) === 1);
}

// Open/active task counts per user (the workload metric for load balancing).
async function workloadCounts(userIds) {
  var map = {};
  if (!userIds || !userIds.length) return map;
  var ph = userIds.map(function () { return '?'; }).join(',');
  var rows = await all(
    "SELECT assigned_to AS uid, COUNT(*) AS n FROM tasks " +
    "WHERE status IN ('assigned','in_progress','returned','awaiting_review') AND assigned_to IN (" + ph + ") GROUP BY assigned_to", userIds);
  rows.forEach(function (r) { map[r.uid] = Number(r.n); });
  return map;
}

// Pick the eligible user with the smallest current workload (ties -> first by name for stability).
async function leastLoaded(teamId, roleName, excludeIds) {
  var elig = await eligibleUsers(teamId, roleName);
  if (excludeIds && excludeIds.length) {
    elig = elig.filter(function (u) { return excludeIds.indexOf(u.id) < 0; });
  }
  if (!elig.length) return null;
  var counts = await workloadCounts(elig.map(function (u) { return u.id; }));
  elig.sort(function (a, b) {
    var ca = counts[a.id] || 0, cb = counts[b.id] || 0;
    if (ca !== cb) return ca - cb;
    return (a.display_name || '').localeCompare(b.display_name || '');
  });
  return { userId: elig[0].id, name: elig[0].display_name, load: counts[elig[0].id] || 0 };
}

// The shared decision: try Smart Routing to a person; if no confident match, leave the task in the pool to claim.
async function autoRouteOrPool(taskId, requestText, opts) {
  opts = opts || {};
  var task = await getTask(taskId);
  if (!task) return { error: 'Task not found' };
  var floor = (opts.floor != null) ? opts.floor : SMART_ROUTING_FLOOR;
  var margin = (opts.margin != null) ? opts.margin : SMART_ROUTING_MARGIN;
  // TWO EYES applies to every route INTO a person, so it is enforced here — before smart routing and
  // before load balancing — not only at claim time. Otherwise the rule would be honoured by the one path
  // a human chooses and bypassed by the two the system chooses.
  var excluded = await twoEyesExclusions(task);
  var suggestions = (await suggestAssignee(requestText, task.team_id, task.role_required, 5))
    .filter(function (s0) { return excluded.indexOf(s0.userId) < 0; });
  var scored = suggestions.filter(function (s2) { return s2.score != null; });
  var top = scored[0];
  var second = scored[1];
  var confident = top && top.score >= floor && (!second || (top.score - second.score) >= margin);
  if (confident) {
    var assigned = await assign(taskId, top.userId, 'smart_routing', top.score);
    return { assigned: true, via: 'smart_routing', user: top, task: assigned, suggestions: suggestions };
  }
  // No confident specialist. If the owning team runs Auto Load Balancing, hand it to the least-loaded
  // eligible person; otherwise leave it in the pool to claim. (Priority: smart match -> load balance -> pool.)
  if (await teamLoadBalancing(task.team_id)) {
    var lb = await leastLoaded(task.team_id, task.role_required, excluded);
    if (lb) {
      var assignedLb = await assign(taskId, lb.userId, 'load_balanced', null);
      return { assigned: true, via: 'load_balanced', user: lb, task: assignedLb, suggestions: suggestions };
    }
  }
  return { assigned: false, via: 'pool', suggestions: suggestions, task: task };
}

// Open tasks the given user is eligible to claim (their team + a role they hold).
// THE CLAIM-POOL ELIGIBILITY PREDICATE — ONE definition, used by both readers.
//
// ⚠️ There were TWO (brief §3.5). This service checked permission roles OR `user_task_types`; the route
// `GET /tasks/pool` checked permission roles ONLY. So every task whose `role_required` is a v3 task-type
// token rather than a legacy permission-role name — `legal_review`, `legal_redaction`, `routing_review` —
// was **invisible in the claim pool**, while `poolForUser` happily listed it. Legal work was already
// affected: a task nobody can see is a task nobody claims, and it does not look broken, it looks quiet.
//
// Expects THREE bound params in order: userId (team), userId (permission roles), userId (task types).
var POOL_ELIGIBILITY_SQL =
  "t.status = 'open' AND t.assigned_to IS NULL " +
  "AND (t.team_id IS NULL OR t.team_id = (SELECT department_id FROM users WHERE id = ?)) " +
  // Eligible if role_required is null, OR the user holds it as a legacy permission role, OR (v3 model)
  // it is a task type in the user's per-person subset — the latter is how legal/new task types resolve.
  // ⚠️ `t.role_required IS NULL` used to be the FIRST branch here — i.e. a role-less task was advertised to
  // every authenticated user. It is gone: a task nobody's competence gates is shown to nobody, matching the
  // claim guard. Creation refuses to make one, so this only ever applies to a legacy row.
  "AND (t.role_required IN (SELECT pr.name FROM user_permission_roles upr JOIN permission_roles pr ON pr.id = upr.permission_role_id WHERE upr.user_id = ?) " +
  "  OR t.role_required IN (SELECT task_type FROM user_task_types WHERE user_id = ?))";

// TWO EYES IN THE POOL. A task this person may not take must not be OFFERED to them: showing it and then
// refusing the claim makes the rule look like a bug at the moment they act on it. One filter, used by both
// pool readers (this and GET /tasks/pool), so the list and the claim guard cannot disagree.
async function filterTwoEyes(rows, userId) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!TWO_EYES_TYPES[rows[i].type]) { out.push(rows[i]); continue; }
    var b = await assignmentBlocked(rows[i], userId);
    if (!b.blocked) out.push(rows[i]);
  }
  return out;
}

async function poolForUser(userId) {
  var rows = await all(
    "SELECT t.* FROM tasks t WHERE " + POOL_ELIGIBILITY_SQL + " ORDER BY t.created_at",
    [userId, userId, userId]
  );
  return await filterTwoEyes(rows, userId);
}

// Is anyone actually carrying this task type yet? The v3 cutover is scoped per (team, task type): a team
// moves onto the new model for a type only once someone ON THAT TEAM holds it. Callers use this to pick the
// eligibility token at SPAWN time, so a type nobody has been granted keeps routing the way it does today.
async function hasSeededType(taskType, teamId) {
  var row = teamId
    ? await get("SELECT 1 AS x FROM user_task_types utt JOIN users u ON u.id = utt.user_id " +
                "WHERE utt.task_type = ? AND u.department_id = ? AND u.status = 'active' LIMIT 1", [taskType, teamId])
    : await get("SELECT 1 AS x FROM user_task_types utt JOIN users u ON u.id = utt.user_id " +
                "WHERE utt.task_type = ? AND u.status = 'active' LIMIT 1", [taskType]);
  return !!row;
}

// Spawn the task that a workflow STAGE implies and route it. Idempotent.
// Shared by manual stage changes and by the estimate-acceptance / deposit flow so there is one task-spawn path.
//   record_search / redaction  -> team fulfillment work (routed within the request's team)
//   exemption_review / ag_review -> legal_review  (office-level, team-agnostic — Senior Legal / Legal Associate)
//   redaction stage on a legally-flagged request -> legal_redaction instead of redaction (office-level)
var STAGE_TASK = { record_search: 'record_search', redaction_review: 'redaction', redaction: 'redaction', exemption_review: 'legal_review', ag_review: 'legal_review' };
var REDACTION_STAGES = { redaction_review: 1, redaction: 1 };
// Legal task types are office-level (v3): they pool to legal staff office-wide, not to the request's team.
var LEGAL_TYPES = { legal_review: 1, legal_redaction: 1 };

// The FAMILY a stage's task belongs to. `redaction` and `legal_redaction` are one family — a request gets one
// or the other, never both — so they must be treated as interchangeable both when deciding whether a task
// already exists (spawnForStage) and when deciding whether a task is stale (staleStageTasks below).
function taskFamily(ttype) {
  if (ttype === 'redaction' || ttype === 'legal_redaction') return ['redaction', 'legal_redaction'];
  return ttype ? [ttype] : [];
}
var LEGAL_FLAG_VALUES = ['SENSITIVE', 'LEGAL_HOLD', 'ONGOING_INVESTIGATION'];

// A request needs legal (advanced) redaction if a director escalated it (legal_flag) or the classifier
// flagged it sensitive/legal-hold (workflow_decisions.flags, latest decision).
async function requestNeedsLegalRedaction(requestId, reqRow) {
  if (reqRow && Number(reqRow.legal_flag) === 1) return true;
  var d = await get("SELECT flags FROM workflow_decisions WHERE request_id = ? AND flags IS NOT NULL ORDER BY created_at DESC LIMIT 1", [requestId]);
  if (!d || !d.flags) return false;
  try { var arr = JSON.parse(d.flags); return Array.isArray(arr) && arr.some(function (f) { return LEGAL_FLAG_VALUES.indexOf(f) !== -1; }); }
  catch (e) { return false; }
}

async function spawnForStage(requestId, stage, createdBy) {
  var ttype = STAGE_TASK[stage];
  if (!ttype || stage === 'closed') return null;
  var reqRow = await get('SELECT description, department_id, legal_flag FROM requests WHERE id = ?', [requestId]);
  if (!reqRow) return null;
  if (REDACTION_STAGES[stage]) {
    // Redaction automation (SPEC_redaction_automation.md, slice 3a): auto-bypass provably-clean
    // responsive files (identity — public-ready copy / previously released). If EVERY responsive file
    // is thereby released, redaction is skipped entirely: advance past it and spawn no task.
    // Read-independent (no LLM/OCR), so it is safe here in the transition path.
    try {
      // Master switch (slice 6): a jurisdiction can disable the automation and fall back to manual redaction.
      var autoOn = await require('./redactionConfig').enabled();
      var rb = require('./redactionBypass'); // lazy require avoids a load-order cycle
      var triage = autoOn ? await rb.bypassIdentityForRequest(requestId, { actorName: 'Redaction Triage' }) : { total: 0, allReleased: false };
      if (triage.total > 0 && triage.allReleased) {
        await applyStageTransition(requestId, 'delivery', {
          actorName: 'Redaction Triage', action: 'STAGE_ADVANCED',
          notes: 'All responsive records already released (public-ready or previously released) — redaction bypassed.'
        });
        return null; // no redaction task — nothing left to redact
      }
    } catch (e) { console.error('[spawnForStage bypass]', e && e.message); }
    // Redaction stage on a legally-flagged request escalates to legal (advanced) redaction.
    if (await requestNeedsLegalRedaction(requestId, reqRow)) ttype = 'legal_redaction';
  }
  // Idempotency: never double-spawn. Redaction + legal_redaction are one family (a request gets one or the
  // other, never both), so an existing task of either blocks a new one for this request.
  var typeSet = (ttype === 'redaction' || ttype === 'legal_redaction') ? ['redaction', 'legal_redaction'] : [ttype];
  var ph = typeSet.map(function () { return '?'; }).join(',');
  var existing = await get("SELECT id FROM tasks WHERE request_id = ? AND type IN (" + ph + ") AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [requestId].concat(typeSet));
  if (existing) return null;
  // Legal work is office-level (team-agnostic); team fulfillment work stays on the request's team.
  var teamId = LEGAL_TYPES[ttype] ? null : reqRow.department_id;
  var task = await createTask({ requestId: requestId, type: ttype, teamId: teamId, createdBy: createdBy || 'system' });
  // THE COVERAGE GAP (BW2). A task whose eligible set is EMPTY is a request stopping silently at a stage
  // nobody in the city can act on — nothing looks broken from any screen, and the first symptom is a
  // missed deadline. Check it HERE, where the task is born, and tell the team's Fulfillment Manager.
  // Never blocks the spawn: the task is still the right row to create, it just has nobody yet.
  try {
    var elig = await eligibleUsers(teamId, task.role_required);
    if (!elig.length) {
      require('./coverageGap').notifyEmptyPool(task, {})
        .catch(function (e) { console.error('[spawnForStage coverage]', e && e.message); });
    }
  } catch (e) { console.error('[spawnForStage coverage]', e && e.message); }
  autoRouteOrPool(task.id, reqRow.description, {}).catch(function (e) { console.error('[spawnForStage route]', e.message); });
  return task;
}

// Canonical forward ordering of the request lifecycle stages ("forward" = later in this list). The
// pipeline is not strictly linear (AG / exemption are side branches), but this order reflects how a
// request normally progresses and is the single source of truth for what counts as a forward advance.
// Keep in sync with the stage values the pipeline uses; an unknown stage is treated as NOT forward.
var STAGE_ORDER = require('./stages').ORDER; // ONE canonical vocabulary — see services/stages.js
var scope = require('./requestScope');
function isForwardStage(fromStage, toStage) {
  var fi = STAGE_ORDER.indexOf(fromStage), ti = STAGE_ORDER.indexOf(toStage);
  if (fi === -1 || ti === -1) {
    console.warn('[applyStageTransition] stage not in STAGE_ORDER (from=' + fromStage + ' to=' + toStage + '); tickler flag left unchanged');
    return false;
  }
  return ti > fi;
}

// ONE central stage-transition (Architecture item 6). EVERY stage advance goes through here so it
// ALWAYS (a) writes the request_history advance row (stage_from -> stage_to) and (b) spawns/updates the
// stage's task. No caller may `UPDATE requests SET stage` directly. Replaces the scattered raw updates
// that produced unlogged advances stranding a request at a task-bearing stage with no task.
//   opts: { actorId, actorName, action, notes, createdBy }
async function applyStageTransition(requestId, toStage, opts) {
  opts = opts || {};
  var reqRow = await get("SELECT stage, department_id FROM requests WHERE id = ?", [requestId]);
  if (!reqRow) return null;
  var fromStage = reqRow.stage;
  // PHASE 7 / WS2 — THE BRANCH-PROFILE BACKSTOP. A stage the state's imported branch profile switches off
  // does not exist in that state, and a request moved into it would sit in a stage with a task nobody in
  // that jurisdiction can legally resolve. Every caller should have decided this already (the AG band is
  // chosen at assert-exemption); this is the central path, so it refuses rather than trusts.
  //
  // It THROWS. Returning null would be silently swallowed by the several callers that ignore the return
  // value, and the request would stay where it was with no record of why — the stranding class of bug
  // this whole module exists to prevent. Only an EXPLICIT `false` blocks: an un-imported jurisdiction is
  // unknown, not off (see branchProfile.js).
  if (toStage && toStage !== fromStage) {
    var BP = require('./branchProfile');
    if (await BP.stageBlocked(null, toStage)) {
      var e = new Error('Cannot move this request to "' + toStage + '": ' + BP.reason(BP.STAGE_CAPABILITY[toStage]));
      e.code = 'STAGE_NOT_IN_JURISDICTION';
      e.stage = toStage;
      throw e;
    }
  }
  if (toStage == null || toStage === fromStage) {
    // No actual stage change: nothing to log, nothing new to spawn. (spawnForStage is idempotent and
    // the reconciler covers a missing task for the current stage.)
    return { fromStage: fromStage, toStage: fromStage, changed: false, task: null };
  }
  var newStatus = (toStage === 'closed') ? 'closed' : 'active';
  // Any FORWARD advance lifts the "waiting/dormant" tickler flag — the awaited event (or a human
  // standing in for it) has moved the request on, so the wait the flag represented is over
  // (decision 2026-07-09). Backward / lateral moves leave the flag for the tickler sweep to re-judge.
  var ticklerClear = isForwardStage(fromStage, toStage) ? ", tickler_flag = NULL, tickler_flagged_at = NULL" : "";
  await run("UPDATE requests SET stage = ?, status = ?" + ticklerClear + ", updated_at = datetime('now') WHERE id = ?",
    [toStage, newStatus, requestId]);
  await run(
    "INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, stage_from, stage_to, created_at) " +
    "VALUES (?,?,?,?,?,?,?,?, datetime('now'))",
    [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'System', opts.action || 'STAGE_ADVANCED', opts.notes || null, fromStage, toStage]);
  // A TASK BELONGS TO THE STAGE THAT IMPLIED IT. When the request moves to a stage that implies a DIFFERENT
  // task, the old stage's task is stale and must not stay claimable.
  //
  // WHAT THIS FIXES (brief §3.2): `legal_review` spawns at exemption_review/ag_review, and the only thing that
  // ever cleared it was `closed`. So `/requests/:id/ag-ruling` — which moves ag_review -> redaction_review —
  // left an OPEN, POOLED legal_review task on a request that had already moved to redaction. A legal staffer
  // could claim and work an exemption review for a decision that was made and acted on days earlier, and the
  // request would carry an open legal_review and an open redaction at the same time.
  //
  // FAMILY-AWARE ON PURPOSE: redaction_review -> redaction implies `redaction` on BOTH sides, so the in-flight
  // redaction task survives that move (cancelling it there would destroy real work). Likewise
  // exemption_review -> ag_review is legal_review on both sides. Only a genuine change of task is cleared.
  // `closed` is excluded because the branch below already cancels EVERY open task, which is stricter.
  if (toStage !== 'closed') {
    var leaving = taskFamily(STAGE_TASK[fromStage]);
    var arriving = taskFamily(STAGE_TASK[toStage]);
    var stale = leaving.filter(function (x) { return arriving.indexOf(x) === -1; });
    if (stale.length) {
      var sph = stale.map(function () { return '?'; }).join(',');
      await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE request_id = ? AND type IN (" + sph + ") AND status IN ('open','assigned','in_progress','returned','awaiting_review')",
        [requestId].concat(stale));
    }
  }
  var task = await spawnForStage(requestId, toStage, opts.createdBy || opts.actorId || 'system');
  // A CLOSED request must not leave claimable work behind. Without this, closing a request (delivery,
  // tickler lapse, nonpayment, deposit withdrawal) left its open tasks sitting in the pools — a staffer
  // could claim and work a task for a request that is already closed. Found 2026-07-13 by the deposit-clock
  // harness; it was never specific to that path.
  if (toStage === 'closed') {
    await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE request_id = ? AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [requestId]);
  }
  // Redaction automation slice 3b: on ENTERING a redaction stage (once, not on reconciler sweeps of
  // spawnForStage), kick the read-based triage in the BACKGROUND so the AI read's latency/failure never
  // blocks this transition. It reads + persists a disposition per un-triaged responsive file, bypasses
  // record-type-clean files, and advances/cancels the task if everything clears.
  if (REDACTION_STAGES[toStage]) {
    try {
      if (await require('./redactionConfig').enabled()) {
        require('./embedIndex').bg(require('./redactionTriage').triageReadForRequest(requestId, {}), 'redaction-triage ' + requestId);
      }
    } catch (e) { console.error('[applyStageTransition triage]', e && e.message); }
  }
  return { fromStage: fromStage, toStage: toStage, changed: true, task: task };
}

// Escalate a request to legal (advanced) redaction. Sets legal_flag (so the redaction stage spawns
// legal_redaction), logs LEGAL_ESCALATED, and if an ordinary redaction task is already open it is superseded
// and re-spawned as legal_redaction. Idempotent (no-op if already flagged). Shared by the Director endpoint
// and by the read-triage's legal-category trigger (SPEC_redaction_automation.md slice 5).
//   opts: { flagType, note, actorId, actorName }
async function escalateToLegal(requestId, opts) {
  opts = opts || {};
  var request = await get('SELECT id, stage, legal_flag FROM requests WHERE id = ?', [requestId]);
  if (!request) return { escalated: false, reason: 'not_found' };
  if (Number(request.legal_flag) === 1) return { escalated: false, alreadyFlagged: true, converted: false, task: null };
  await run("UPDATE requests SET legal_flag = 1, legal_flag_type = ?, updated_at = datetime('now') WHERE id = ?",
    [opts.flagType || 'CONTENT_ESCALATION', requestId]);
  await run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)",
    [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'System', 'LEGAL_ESCALATED',
     'Escalated for legal (advanced) redaction' + (opts.note ? ': ' + opts.note : '')]);
  var converted = false, newTask = null;
  var openRed = await get("SELECT id FROM tasks WHERE request_id = ? AND type = 'redaction' AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [requestId]);
  if (openRed) {
    await run("UPDATE tasks SET status = 'superseded', updated_at = datetime('now') WHERE id = ?", [openRed.id]);
    try { newTask = await spawnForStage(requestId, request.stage, opts.actorId || 'system'); converted = true; }
    catch (e) { console.error('[escalateToLegal respawn]', e && e.message); }
  }
  return { escalated: true, alreadyFlagged: false, converted: converted, task: newTask };
}

async function mine(userId) {
  return await all("SELECT * FROM tasks WHERE assigned_to = ? AND status IN ('assigned','in_progress','returned','awaiting_review') ORDER BY updated_at DESC", [userId]);
}

// Self-healing safety net: any request at a task-bearing stage without its task gets one spawned.
// Covers stranding from seeding, races, or any advance path that skipped the spawn. Idempotent.
async function reconcileStageTasks() {
  // LEAF: the reconciler spawns the STAGE's task, and only a work row has a stage.
  var rows = await all("SELECT r.id, r.stage FROM requests r WHERE r.stage IN ('record_search','redaction_review','redaction','exemption_review','ag_review') AND r.status = 'active'" + scope.andLeaf('r'));
  var fixed = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!STAGE_TASK[r.stage]) continue;
    // spawnForStage is idempotent and owns the legal-branching + redaction-family logic; a non-null
    // return means it actually spawned a missing task.
    try { var t = await spawnForStage(r.id, r.stage, 'system-reconciler'); if (t) fixed++; } catch (e) { console.error('[reconcileStageTasks]', r.id, e && e.message); }
  }
  if (fixed > 0) console.log('[reconcileStageTasks] spawned ' + fixed + ' missing stage task(s)');
  return fixed;
}

// Run once at startup and every 2 minutes thereafter.
function startReconciler() {
  reconcileStageTasks().catch(function (e) { console.error('[reconcileStageTasks startup]', e && e.message); });
  setInterval(function () { reconcileStageTasks().catch(function () {}); }, 120000);
}

// TASK ENTRY CONTRACT (Slice A). "Begin work" is one canonical, idempotent event: transition assigned -> in
// process (the DB trigger bookmarks the time) + run the task type's on-entry automation (non-destructive,
// gated). EVERY entry path calls this — opening a task screen now, batch/conveyor later — so none can bypass
// automation and none double-runs it. Only the OWNER begins work (a supervisor peeking must not start the
// clock). On-entry automation for redaction (auto AI discovery) is gated frontend-side by redaction_jobs
// .discovered_at, so it fires once and never re-scans committed work.
async function enterTask(taskId, userId, opts) {
  opts = opts || {};
  var t = await get("SELECT id, type, assigned_to, status FROM tasks WHERE id = ?", [taskId]);
  if (!t) return null;
  var isOwner = t.assigned_to && t.assigned_to === userId;
  if (!isOwner && !opts.force) return t; // viewing, not beginning — no transition
  if (t.status === 'assigned' || t.status === 'returned') {
    await run("UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status IN ('assigned','returned')", [taskId]);
  }
  return await getTask(taskId);
}

// RETURNED-FOR-REWORK (BACKLOG R10, slice 8b). The general "your work came back" primitive. A reviewer sends
// work back: we FLAG the owner's task (it keeps its status, so it stays put in My Tasks and renders the
// "URGENT CORRECTIONS REQUIRED" treatment) AND push a notification. Any return flow (redaction, and future
// clarification) is a customer; objection rejections use the notification alone (they aren't tasks).
async function markTaskReturned(taskId, opts) {
  opts = opts || {};
  var t = await get("SELECT id, type, assigned_to, request_id FROM tasks WHERE id = ?", [taskId]);
  if (!t) return null;
  await run("UPDATE tasks SET status = 'returned', return_reason = ?, returned_by = ?, returned_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status NOT IN ('done','cancelled','superseded')",
    [opts.reason || null, opts.by || null, taskId]);
  if (t.assigned_to) {
    try {
      var N = require('./notifications');
      await N.emit({
        userId: t.assigned_to, kind: 'work_returned', contextType: 'task', contextId: taskId,
        title: opts.title || 'Your work was returned for corrections',
        body: (opts.by ? opts.by + ' returned it' : 'Returned') + (opts.reason ? ' — ' + opts.reason : '.'),
        link: opts.link || (t.request_id ? '/requests/' + t.request_id : null), createdBy: 'system'
      });
    } catch (e) { console.error('[markTaskReturned notify]', e && e.message); }
  }
  return t.assigned_to;
}
// Clear the returned flag (the author re-submitted the corrected work).
async function clearReturned(taskId) {
  // Author re-submitted the corrected work: leave the 'returned' state (back to in_progress) and wipe the reason.
  await run("UPDATE tasks SET status = CASE WHEN status = 'returned' THEN 'in_progress' ELSE status END, return_reason = NULL, returned_by = NULL, returned_at = NULL, updated_at = datetime('now') WHERE id = ?", [taskId]);
}

module.exports = {
  enterTask: enterTask,
  markTaskReturned: markTaskReturned,
  clearReturned: clearReturned,
  TASK_ROLES: TASK_ROLES,
  ACTIONABLE_STATUSES: ACTIONABLE_STATUSES,
  isActionable: isActionable,
  ROUTABLE_TASK_TYPES: ROUTABLE_TASK_TYPES,
  HAND_ASSIGNED_TASK_TYPES: HAND_ASSIGNED_TASK_TYPES,
  SMART_ROUTING_FLOOR: SMART_ROUTING_FLOOR,
  SMART_ROUTING_MARGIN: SMART_ROUTING_MARGIN,
  eligibleUsers: eligibleUsers,
  embedUserSpec: embedUserSpec,
  suggestAssignee: suggestAssignee,
  createTask: createTask,
  getTask: getTask,
  assign: assign,
  claim: claim,
  autoRouteOrPool: autoRouteOrPool,
  poolForUser: poolForUser,
  filterTwoEyes: filterTwoEyes,
  TWO_EYES_TYPES: TWO_EYES_TYPES,
  twoEyesExclusions: twoEyesExclusions,
  assignmentBlocked: assignmentBlocked,
  POOL_ELIGIBILITY_SQL: POOL_ELIGIBILITY_SQL,
  hasSeededType: hasSeededType,
  mine: mine,
  teamLoadBalancing: teamLoadBalancing,
  workloadCounts: workloadCounts,
  leastLoaded: leastLoaded,
  spawnForStage: spawnForStage,
  requestNeedsLegalRedaction: requestNeedsLegalRedaction,
  escalateToLegal: escalateToLegal,
  applyStageTransition: applyStageTransition,
  reconcileStageTasks: reconcileStageTasks,
  startReconciler: startReconciler
};
