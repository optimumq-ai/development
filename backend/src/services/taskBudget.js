'use strict';
// TIME BUDGET (Slice C). Compares the Slice-B actual elapsed against a per-(record_type, task_type) budget to
// yield "budgeted days remaining / over budget". Generic per-task-type defaults for now (record_type_id NULL);
// the future budget "brain" adds per-record-type rows. Raw calendar days — the legal deadline is a separate clock.
var { all } = require('../db');
var DAY = 86400000;

// Budget status vs the person's OWN active time on the step (queue + process + returned-for-rework), taken from
// the same Slice-B trail the displayed clock uses so the two always agree. In-review time is EXCLUDED — that's
// the reviewer's separately-budgeted step (redaction_qa), not the author's.
function statusFor(budgetDays, elapsedMs) {
  if (budgetDays == null || elapsedMs == null) return null;
  var budgetMs = budgetDays * DAY;
  var remainingMs = budgetMs - elapsedMs;
  var state = remainingMs < 0 ? 'over' : (remainingMs < budgetMs * 0.25 ? 'warn' : 'ok'); // warn inside the last 25%
  return { budgetDays: budgetDays, budgetMs: budgetMs, elapsedMs: elapsedMs, remainingMs: remainingMs, overMs: Math.max(0, -remainingMs), state: state };
}
function activeElapsed(timing) { if (!timing) return null; return (timing.inQueueMs || 0) + (timing.inProcessMs || 0) + (timing.returnedMs || 0); }

async function loadBudgetMap() {
  var rows = await all("SELECT record_type_id, task_type, budget_days FROM time_budgets");
  var map = {};
  rows.forEach(function (b) { map[(b.record_type_id || '') + '|' + b.task_type] = Number(b.budget_days); });
  return map;
}
// budget days for a (record_type, task_type): prefer the specific row, fall back to the generic default.
function lookup(map, recordTypeId, taskType) {
  var v = map[(recordTypeId || '') + '|' + taskType];
  if (v == null) v = map['|' + taskType];
  return v == null ? null : v;
}

// Attach a budget status to task rows (each with type, record_type_id) using the Slice-B timing map (taskId ->
// timing) so budget and clock share one elapsed. One budgets query.
async function forTasks(taskRows, timingMap) {
  var map = await loadBudgetMap();
  var out = {};
  (taskRows || []).forEach(function (t) {
    out[t.id] = statusFor(lookup(map, t.record_type_id, t.type), activeElapsed(timingMap && timingMap[t.id]));
  });
  return out;
}

module.exports = { statusFor: statusFor, activeElapsed: activeElapsed, loadBudgetMap: loadBudgetMap, lookup: lookup, forTasks: forTasks };
