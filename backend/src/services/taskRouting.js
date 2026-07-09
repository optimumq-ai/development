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

// Default eligible permission-role per task type. (Overridable per task / later per team config.)
var TASK_ROLES = {
  estimate: 'FEE_MANAGER',
  record_search: 'SEARCH_AND_TRIAGE',
  redaction: 'REDACTION_WORKER'
};

// Smart Routing auto-assigns to the top match only when it is both decent (>= FLOOR) AND clearly ahead of
// the runner-up (lead >= MARGIN). Otherwise the task stays in the pool to claim. (Absolute cosine on short
// specialization text runs modest, so a margin test is more robust than a single high cutoff. Tunable; later
// these can move to per-team / Jurisdiction Profile config.)
var SMART_ROUTING_FLOOR = 0.45;
var SMART_ROUTING_MARGIN = 0.06;

function lit(vec) { return '[' + vec.join(',') + ']'; }

// Users on a team who hold the required permission role and are active.
async function eligibleUsers(teamId, roleName) {
  if (!roleName) return [];
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

async function createTask(opts) {
  var id = 't-' + uuidv4().substring(0, 8);
  var role = opts.roleRequired || TASK_ROLES[opts.type] || null;
  await run(
    "INSERT INTO tasks (id, request_id, type, title, team_id, role_required, status, created_by) " +
    "VALUES (?,?,?,?,?,?, 'open', ?)",
    [id, opts.requestId, opts.type, opts.title || null, opts.teamId || null, role, opts.createdBy || null]
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
  var elig = await eligibleUsers(task.team_id, task.role_required);
  if (task.role_required && elig.filter(function (u) { return u.id === userId; }).length === 0) {
    return { error: 'You are not eligible to claim this task' };
  }
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
    "WHERE status IN ('assigned','in_progress') AND assigned_to IN (" + ph + ") GROUP BY assigned_to", userIds);
  rows.forEach(function (r) { map[r.uid] = Number(r.n); });
  return map;
}

// Pick the eligible user with the smallest current workload (ties -> first by name for stability).
async function leastLoaded(teamId, roleName) {
  var elig = await eligibleUsers(teamId, roleName);
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
  var suggestions = await suggestAssignee(requestText, task.team_id, task.role_required, 5);
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
    var lb = await leastLoaded(task.team_id, task.role_required);
    if (lb) {
      var assignedLb = await assign(taskId, lb.userId, 'load_balanced', null);
      return { assigned: true, via: 'load_balanced', user: lb, task: assignedLb, suggestions: suggestions };
    }
  }
  return { assigned: false, via: 'pool', suggestions: suggestions, task: task };
}

// Open tasks the given user is eligible to claim (their team + a role they hold).
async function poolForUser(userId) {
  return await all(
    "SELECT t.* FROM tasks t " +
    "WHERE t.status = 'open' AND t.assigned_to IS NULL " +
    "AND (t.team_id IS NULL OR t.team_id = (SELECT department_id FROM users WHERE id = ?)) " +
    "AND (t.role_required IS NULL OR t.role_required IN (" +
    "  SELECT pr.name FROM user_permission_roles upr JOIN permission_roles pr ON pr.id = upr.permission_role_id WHERE upr.user_id = ?)) " +
    "ORDER BY t.created_at",
    [userId, userId]
  );
}

// Spawn the task that a workflow STAGE implies (record_search / redaction) and route it. Idempotent.
// Shared by manual stage changes and by the estimate-acceptance / deposit flow so there is one task-spawn path.
var STAGE_TASK = { record_search: 'record_search', redaction_review: 'redaction', redaction: 'redaction' };
async function spawnForStage(requestId, stage, createdBy) {
  var ttype = STAGE_TASK[stage];
  if (!ttype || stage === 'closed') return null;
  var existing = await get("SELECT id FROM tasks WHERE request_id = ? AND type = ? AND status IN ('open','assigned','in_progress')", [requestId, ttype]);
  if (existing) return null;
  var reqRow = await get('SELECT description, department_id FROM requests WHERE id = ?', [requestId]);
  if (!reqRow) return null;
  var task = await createTask({ requestId: requestId, type: ttype, teamId: reqRow.department_id, createdBy: createdBy || 'system' });
  autoRouteOrPool(task.id, reqRow.description, {}).catch(function (e) { console.error('[spawnForStage route]', e.message); });
  return task;
}

// Canonical forward ordering of the request lifecycle stages ("forward" = later in this list). The
// pipeline is not strictly linear (AG / exemption are side branches), but this order reflects how a
// request normally progresses and is the single source of truth for what counts as a forward advance.
// Keep in sync with the stage values the pipeline uses; an unknown stage is treated as NOT forward.
var STAGE_ORDER = ['intake', 'fee_review', 'awaiting_payment', 'record_search', 'exemption_review', 'ag_review', 'redaction_review', 'redaction', 'delivery', 'closed'];
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
  var task = await spawnForStage(requestId, toStage, opts.createdBy || opts.actorId || 'system');
  return { fromStage: fromStage, toStage: toStage, changed: true, task: task };
}

async function mine(userId) {
  return await all("SELECT * FROM tasks WHERE assigned_to = ? AND status IN ('assigned','in_progress') ORDER BY updated_at DESC", [userId]);
}

// Self-healing safety net: any request at a task-bearing stage without its task gets one spawned.
// Covers stranding from seeding, races, or any advance path that skipped the spawn. Idempotent.
async function reconcileStageTasks() {
  var rows = await all("SELECT id, stage FROM requests WHERE stage IN ('record_search','redaction_review','redaction') AND status = 'active'");
  var fixed = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var ttype = STAGE_TASK[r.stage];
    if (!ttype) continue;
    var existing = await get("SELECT id FROM tasks WHERE request_id = ? AND type = ? AND status IN ('open','assigned','in_progress')", [r.id, ttype]);
    if (!existing) { try { await spawnForStage(r.id, r.stage, 'system-reconciler'); fixed++; } catch (e) { console.error('[reconcileStageTasks]', r.id, e && e.message); } }
  }
  if (fixed > 0) console.log('[reconcileStageTasks] spawned ' + fixed + ' missing stage task(s)');
  return fixed;
}

// Run once at startup and every 2 minutes thereafter.
function startReconciler() {
  reconcileStageTasks().catch(function (e) { console.error('[reconcileStageTasks startup]', e && e.message); });
  setInterval(function () { reconcileStageTasks().catch(function () {}); }, 120000);
}

module.exports = {
  TASK_ROLES: TASK_ROLES,
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
  mine: mine,
  teamLoadBalancing: teamLoadBalancing,
  workloadCounts: workloadCounts,
  leastLoaded: leastLoaded,
  spawnForStage: spawnForStage,
  applyStageTransition: applyStageTransition,
  reconcileStageTasks: reconcileStageTasks,
  startReconciler: startReconciler
};
