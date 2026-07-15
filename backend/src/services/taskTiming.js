'use strict';
// TASK TIMING (Slice B). Reads the immutable bookmark trail (task_events) Slice A records and computes
// elapsed CALENDAR time in each state — the stretch between two consecutive bookmarks belongs to the status
// the task was in during it; the current (last) state's clock runs to now. Raw wall-clock only (Kevin's model:
// every second accounted for); the budgeted-vs-actual overlay is Slice C, the legal deadline is a separate clock.
var { all } = require('../db');

var TERMINAL = { done: 1, cancelled: 1, superseded: 1 };

// 'YYYY-MM-DD HH:MI:SS' (stored UTC) -> epoch ms.
function parseAt(s) { if (!s) return null; var t = Date.parse(String(s).replace(' ', 'T') + 'Z'); return isNaN(t) ? null : t; }

// events: [{to_status, at}] ordered oldest-first. Returns per-status totals + the current state + how long
// it has been in it. nowMs lets tests pin "now".
function durationsFromEvents(events, nowMs) {
  nowMs = nowMs || Date.now();
  var totals = {};
  for (var i = 0; i < events.length; i++) {
    var start = parseAt(events[i].at); if (start == null) continue;
    var status = events[i].to_status;
    var end;
    if (i + 1 < events.length) end = parseAt(events[i + 1].at);
    else end = TERMINAL[status] ? start : nowMs; // terminal state has no ongoing clock
    if (end == null) end = nowMs;
    totals[status] = (totals[status] || 0) + Math.max(0, end - start);
  }
  var last = events.length ? events[events.length - 1] : null;
  var currentStatus = last ? last.to_status : null;
  var currentSinceMs = (last && !TERMINAL[currentStatus]) ? Math.max(0, nowMs - parseAt(last.at)) : 0;
  return { currentStatus: currentStatus, currentSinceMs: currentSinceMs, totals: totals };
}

// Roll per-status totals up into the phases the UI shows.
function phases(totals) {
  totals = totals || {};
  return {
    inQueueMs: (totals.open || 0) + (totals.assigned || 0),
    inProcessMs: totals.in_progress || 0,
    inReviewMs: totals.awaiting_review || 0,
    returnedMs: totals.returned || 0
  };
}

// Compute a timing object per task for a set of task rows (each with id + optional request_created_at), in ONE
// events query. Returns { [taskId]: { currentStatus, currentSinceMs, inQueueMs, inProcessMs, inReviewMs, returnedMs, ageMs } }.
async function forTasks(taskRows, nowMs) {
  nowMs = nowMs || Date.now();
  var ids = (taskRows || []).map(function (t) { return t.id; }).filter(Boolean);
  if (!ids.length) return {};
  var ph = ids.map(function () { return '?'; }).join(',');
  var evs = await all("SELECT task_id, to_status, at FROM task_events WHERE task_id IN (" + ph + ") ORDER BY task_id, id", ids);
  var byTask = {};
  evs.forEach(function (e) { (byTask[e.task_id] = byTask[e.task_id] || []).push(e); });
  var out = {};
  (taskRows || []).forEach(function (t) {
    var d = durationsFromEvents(byTask[t.id] || [], nowMs);
    var p = phases(d.totals);
    var anchor = parseAt(t.request_created_at);
    out[t.id] = Object.assign({ currentStatus: d.currentStatus, currentSinceMs: d.currentSinceMs,
      ageMs: anchor != null ? Math.max(0, nowMs - anchor) : null }, p);
  });
  return out;
}

module.exports = { parseAt: parseAt, durationsFromEvents: durationsFromEvents, phases: phases, forTasks: forTasks };
