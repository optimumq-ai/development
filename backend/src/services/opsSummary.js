'use strict';
// OPS SUMMARY (SPEC_operational_dashboard.md §2 slice 2) — the ONE read behind every dashboard pane.
//
// Derived on read, nothing stored: actionable tasks grouped team × task node, each node carrying
// queued / in-process / in-review counts, a PAUSED count, and the decided lateness buckets —
// 1 day late (over budget by ≤24h) · 2 days late (≤48h) · >2 days late. "Late" is BUDGET lateness
// (taskBudget's overMs off the task_events trail), never the statutory clock — the early-warning layer:
// a 3-day budget on the first task of a 10-day request fires on day 4, six days before the legal clock
// looks threatened (Kevin's framing, SPEC §1).
//
// PAUSED TASKS TELL THE TRUTH (§2 slice 1): a task waiting on the requestor (tasks.paused_at set) is
// counted as `paused`, never `late` — an attention tool that cries wolf gets ignored. The decided
// pause-not-reset rule's full interval subtraction stays a recorded simplification.
//
// Teams are whatever `departments` holds AT READ TIME — panes group by team, never name teams, so
// adding or deleting a department needs no dashboard reconfiguration.
var { all } = require('../db');
var taskTiming = require('./taskTiming');
var taskBudget = require('./taskBudget');

// Bucket edges live in workloadHealth so the node grid and the My Tasks personal composite bucket
// identically by construction (#13).
var bucketOf = require('./workloadHealth').bucketOf;
function emptyNode(taskType) {
  return { taskType: taskType, queued: 0, inProcess: 0, inReview: 0, paused: 0,
           late: { d1: 0, d2: 0, d2plus: 0 }, unbudgeted: 0 };
}
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// The task-node grid. opts.teamId scopes to one team (the route forces this for non-elevated users).
async function taskNodes(opts) {
  opts = opts || {};
  var params = [];
  var teamFilter = '';
  if (opts.teamId) { teamFilter = ' AND t.team_id = ?'; params.push(opts.teamId); }
  var rows = await all(
    "SELECT t.id, t.type, t.status, t.team_id, t.paused_at, r.record_type_id, d.name AS team_name " +
    "FROM tasks t LEFT JOIN requests r ON r.id = t.request_id LEFT JOIN departments d ON d.id = t.team_id " +
    "WHERE t.status IN ('open','assigned','in_progress','returned','awaiting_review')" + teamFilter, params);
  var timing = await taskTiming.forTasks(rows);
  var budgets = await taskBudget.forTasks(rows, timing);

  var teams = {}, totals = {};
  function node(store, key, label, taskType) {
    if (!store[key]) store[key] = { teamId: key === '_' ? null : key, teamName: label, nodes: {} };
    if (!store[key].nodes[taskType]) store[key].nodes[taskType] = emptyNode(taskType);
    return store[key].nodes[taskType];
  }
  rows.forEach(function (t) {
    var tKey = t.team_id || '_unassigned';
    var tLabel = t.team_name || 'Unassigned';
    [node(teams, tKey, tLabel, t.type), node(totals, '_', 'All teams', t.type)].forEach(function (n) {
      // Paused is its OWN state (the mockup's "waiting on requestor" column): a paused task is neither
      // queued nor in-process here, and never late — one task, one column.
      if (t.paused_at) { n.paused++; return; }
      if (t.status === 'open' || t.status === 'assigned') n.queued++;
      else if (t.status === 'awaiting_review') n.inReview++;
      else n.inProcess++; // in_progress + returned — active work, matching taskBudget.activeElapsed
      var b = budgets[t.id];
      if (!b) { n.unbudgeted++; return; }
      if (b.state === 'over') n.late[bucketOf(b.overMs)]++;
    });
  });
  // Stage counts per team (the Requests-in-Process pane) — active WORK rows, grouped live off requests,
  // so team membership follows the data exactly as the node grid does.
  var scope = require('./requestScope');
  var stageParams = [];
  var stageFilter = '';
  if (opts.teamId) { stageFilter = ' AND r.department_id = ?'; stageParams.push(opts.teamId); }
  var stageRows = await all(
    "SELECT COALESCE(r.department_id, '_unassigned') AS team_id, COALESCE(d.name, 'Unassigned') AS team_name, r.stage, count(*)::int AS n " +
    "FROM requests r LEFT JOIN departments d ON d.id = r.department_id " +
    "WHERE r.status = 'active' AND r.request_number != 'LIBRARY' AND r.request_number NOT LIKE 'SYS-%'" +
    scope.andLeaf('r') + stageFilter + ' GROUP BY 1, 2, 3', stageParams);
  var stagesByTeam = {}, stageTotals = {}, activeByTeam = {}, activeTotal = 0;
  stageRows.forEach(function (s) {
    if (!stagesByTeam[s.team_id]) { stagesByTeam[s.team_id] = {}; activeByTeam[s.team_id] = 0; }
    stagesByTeam[s.team_id][s.stage] = s.n;
    activeByTeam[s.team_id] += s.n;
    stageTotals[s.stage] = (stageTotals[s.stage] || 0) + s.n;
    activeTotal += s.n;
    if (!teams[s.team_id]) teams[s.team_id] = { teamId: s.team_id === '_unassigned' ? null : s.team_id, teamName: s.team_name, nodes: {} };
  });

  // WORKLOAD HEALTH (#13): score every node and composite every team from the SAME buckets the row
  // displays, so the verdict can never disagree with the counts beside it.
  var WH = require('./workloadHealth');
  function flatten(store) {
    return Object.keys(store).map(function (k) {
      var team = store[k];
      var nodes = Object.keys(team.nodes).sort().map(function (tt) {
        var n = team.nodes[tt];
        n.health = WH.healthOf(n.late);
        return n;
      });
      return { teamId: team.teamId, teamName: team.teamName,
               stages: stagesByTeam[k] || {}, activeRequests: activeByTeam[k] || 0,
               health: WH.compositeOf(nodes), nodes: nodes };
    }).sort(function (a, b) { return String(a.teamName).localeCompare(String(b.teamName)); });
  }
  var totalsOut = flatten(totals)[0] || { teamName: 'All teams', nodes: [], health: WH.compositeOf([]) };
  totalsOut.stages = stageTotals; totalsOut.activeRequests = activeTotal;
  return { teams: flatten(teams), totals: totalsOut };
}

// The Finance pane read. Simple and honest (SPEC §2): sums off the money that is actually recorded.
// Reconciliation supersedes the estimate on the effective total (the feeRelease rule); payments live on
// the estimate row; the waive is read from its own evidence block.
async function finance() {
  var out = { collectedToDate: 0, waivedToDate: 0, outstandingBalances: 0, billedUnpaid: 0 };
  try {
    var c = await all("SELECT COALESCE(SUM(COALESCE(deposit_paid_amount,0) + COALESCE(final_paid_amount,0)),0) AS s FROM request_fee_estimates WHERE kind = 'estimate'");
    out.collectedToDate = r2(c[0] && c[0].s);
  } catch (e) { /* leave 0 */ }
  try {
    var w = await all("SELECT COALESCE(SUM((fee_context_json::json->'deMinimisWaive'->>'originalTotal')::numeric),0) AS s " +
      "FROM request_fee_estimates WHERE kind = 'estimate' AND fee_context_json LIKE '%deMinimisWaive%'");
    out.waivedToDate = r2(w[0] && w[0].s);
  } catch (e) { /* leave 0 */ }
  try {
    var ests = await all(
      "SELECT DISTINCT ON (e.request_id) e.request_id, e.total, e.notified_at, " +
      "  COALESCE(e.deposit_paid_amount,0) + COALESCE(e.final_paid_amount,0) AS paid " +
      "FROM request_fee_estimates e JOIN requests r ON r.id = e.request_id AND r.status != 'closed' " +
      "WHERE e.kind = 'estimate' ORDER BY e.request_id, e.created_at DESC, e.seq DESC NULLS LAST");
    var recons = await all(
      "SELECT DISTINCT ON (e.request_id) e.request_id, e.total " +
      "FROM request_fee_estimates e JOIN requests r ON r.id = e.request_id AND r.status != 'closed' " +
      "WHERE e.kind = 'reconciliation' ORDER BY e.request_id, e.created_at DESC, e.seq DESC NULLS LAST");
    var reconBy = {}; recons.forEach(function (x) { reconBy[x.request_id] = Number(x.total); });
    ests.forEach(function (e) {
      var eff = reconBy[e.request_id] != null ? reconBy[e.request_id] : Number(e.total) || 0;
      var bal = r2(eff - (Number(e.paid) || 0));
      if (bal > 0) {
        out.outstandingBalances = r2(out.outstandingBalances + bal);
        if (e.notified_at && !(Number(e.paid) > 0)) out.billedUnpaid = r2(out.billedUnpaid + bal);
      }
    });
  } catch (e) { /* leave 0 */ }
  return out;
}

async function summary(opts) {
  var nodes = await taskNodes(opts);
  return { teams: nodes.teams, totals: nodes.totals, finance: await finance() };
}

module.exports = { summary: summary, taskNodes: taskNodes, finance: finance, bucketOf: bucketOf };
