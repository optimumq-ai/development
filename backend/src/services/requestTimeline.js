'use strict';
// REQUEST TIMELINE (Slice B-breakdown). Stitches the two bookmark sources into ONE gap-free, submit-anchored
// timeline of phase segments, so "where did this request's time go / where's the bottleneck" is answerable:
//   - the STAGE backbone comes from request_history (captures work stages, HOLDS like awaiting_payment, and
//     detours like AG review);
//   - inside each WORK stage, the queue/process/review split comes from the Slice-A task_events trail.
// Raw calendar time (the budget overlay is Slice C; the legal deadline is a separate clock).
var { all, get } = require('../db');
var parseAt = require('./taskTiming').parseAt;

// Which task type(s) a work stage drills into (to split it queue/process/review).
var STAGE_TASKTYPE = {
  record_search: ['record_search'], redaction: ['redaction', 'legal_redaction'],
  redaction_review: ['redaction', 'legal_redaction'], estimate: ['estimate'],
  ag_review: ['legal_review'], exemption_review: ['legal_review']
};
var HOLD_STAGES = { awaiting_payment: 1, awaiting_deposit: 1 };
var STAGE_LABEL = {
  intake: 'Intake', record_search: 'Record Search', redaction: 'Redaction', redaction_review: 'Redaction',
  estimate: 'Estimate', awaiting_payment: 'Awaiting payment', awaiting_deposit: 'Awaiting deposit',
  ag_review: 'Legal Review', exemption_review: 'Legal Review', delivery: 'Delivery', closed: 'Closed'
};
function statusToPhase(s) { return ({ open: 'queue', assigned: 'queue', in_progress: 'process', awaiting_review: 'review', returned: 'queue' })[s] || 'process'; }

// The task's phase intervals (from its ordered events) clipped to a [winStart, winEnd] window.
function taskIntervals(events, winStart, winEnd, nowMs) {
  var out = [];
  for (var i = 0; i < events.length; i++) {
    var a = parseAt(events[i].at); if (a == null) continue;
    var b = (i + 1 < events.length) ? parseAt(events[i + 1].at) : nowMs;
    if (b == null) b = nowMs;
    var s = Math.max(a, winStart), e = Math.min(b, winEnd);
    if (e > s) out.push({ phase: statusToPhase(events[i].to_status), start: s, end: e });
  }
  return out;
}
// Make a work stretch gap-free: fill any uncovered time with 'queue' (it sat), merge adjacent same-phase.
function coverStretch(stage, S, E, intervals) {
  intervals = (intervals || []).slice().sort(function (a, b) { return a.start - b.start; });
  var out = [], cursor = S;
  intervals.forEach(function (iv) {
    if (iv.start > cursor) out.push({ stage: stage, phase: 'queue', start: cursor, end: iv.start });
    var s = Math.max(iv.start, cursor);
    if (iv.end > s) out.push({ stage: stage, phase: iv.phase, start: s, end: iv.end });
    cursor = Math.max(cursor, iv.end);
  });
  if (cursor < E) out.push({ stage: stage, phase: 'queue', start: cursor, end: E });
  var merged = [];
  out.forEach(function (x) { var l = merged[merged.length - 1]; if (l && l.phase === x.phase && Math.abs(l.end - x.start) < 1000) l.end = x.end; else merged.push(x); });
  return merged;
}

async function build(requestId, nowMs) {
  nowMs = nowMs || Date.now();
  var req = await get("SELECT id, created_at, stage, status, record_type_id FROM requests WHERE id = ?", [requestId]);
  if (!req) return null;
  var submitMs = parseAt(req.created_at) || nowMs;
  var hist = await all("SELECT stage_from, stage_to, created_at FROM request_history WHERE request_id = ? AND stage_to IS NOT NULL ORDER BY created_at, id", [requestId]);

  // Stage points: submit in the initial stage, then each transition sets the stage from its time on.
  var pts = [{ at: submitMs, stage: (hist[0] && hist[0].stage_from) || req.stage || 'intake' }];
  hist.forEach(function (r) { var t = parseAt(r.created_at); if (t != null && r.stage_to) pts.push({ at: Math.max(t, submitMs), stage: r.stage_to }); });
  pts.sort(function (a, b) { return a.at - b.at; });

  // Stage stretches (contiguous), merging adjacent same-stage.
  var stretches = [];
  for (var i = 0; i < pts.length; i++) {
    var start = pts[i].at, end = (i + 1 < pts.length) ? pts[i + 1].at : nowMs, stage = pts[i].stage;
    if (end <= start || !stage) continue;
    var last = stretches[stretches.length - 1];
    if (last && last.stage === stage && Math.abs(last.end - start) < 1000) last.end = end;
    else stretches.push({ stage: stage, start: start, end: end });
  }

  var evs = await all("SELECT task_type, to_status, at FROM task_events WHERE request_id = ? ORDER BY id", [requestId]);
  var byType = {}; evs.forEach(function (e) { (byType[e.task_type] = byType[e.task_type] || []).push(e); });

  var segs = [];
  stretches.forEach(function (st) {
    if (HOLD_STAGES[st.stage]) { segs.push({ stage: st.stage, phase: 'hold', start: st.start, end: st.end }); return; }
    if (st.stage === 'delivery') { segs.push({ stage: st.stage, phase: 'done', start: st.start, end: st.end }); return; }
    if (st.stage === 'closed') return; // terminal, not a stretch to render
    var types = STAGE_TASKTYPE[st.stage];
    if (types) {
      var ev = [];
      types.forEach(function (t) { (byType[t] || []).forEach(function (e) { ev.push(e); }); });
      ev.sort(function (a, b) { return (parseAt(a.at) || 0) - (parseAt(b.at) || 0); });
      coverStretch(st.stage, st.start, st.end, taskIntervals(ev, st.start, st.end, nowMs)).forEach(function (x) { segs.push(x); });
    } else {
      segs.push({ stage: st.stage, phase: 'process', start: st.start, end: st.end }); // intake / other office work
    }
  });

  var totalMs = Math.max(0, nowMs - submitMs);
  var byPhase = {}; segs.forEach(function (s) { byPhase[s.phase] = (byPhase[s.phase] || 0) + (s.end - s.start); });
  var workingMs = byPhase.process || 0;
  var waitingMs = (byPhase.queue || 0) + (byPhase.review || 0) + (byPhase.hold || 0);
  // Bottleneck = the longest ACTIONABLE stretch (holds are the requester's; delivery is terminal).
  var actionable = segs.filter(function (s) { return s.phase !== 'hold' && s.phase !== 'done'; })
    .sort(function (a, b) { return (b.end - b.start) - (a.end - a.start); });
  var bn = actionable[0] || null;

  // Per-work-stage budget (Slice C): the step's generic/record-type budget in days, for the timeline markers.
  var budgetMap = await require('./taskBudget').loadBudgetMap();
  var stageBudgets = {};
  Object.keys(STAGE_TASKTYPE).forEach(function (stg) {
    var d = require('./taskBudget').lookup(budgetMap, req.record_type_id, STAGE_TASKTYPE[stg][0]);
    if (d != null) stageBudgets[stg] = d;
  });

  return {
    requestId: requestId, submitAt: req.created_at, stage: req.stage, status: req.status,
    totalMs: totalMs, workingMs: workingMs, waitingMs: waitingMs, byPhase: byPhase, stageBudgets: stageBudgets,
    segments: segs.map(function (s) { return { stage: s.stage, stageLabel: STAGE_LABEL[s.stage] || s.stage, phase: s.phase, durationMs: s.end - s.start }; }),
    bottleneck: bn ? { stage: bn.stage, stageLabel: STAGE_LABEL[bn.stage] || bn.stage, phase: bn.phase, durationMs: bn.end - bn.start } : null
  };
}

module.exports = { build: build, statusToPhase: statusToPhase, coverStretch: coverStretch, STAGE_LABEL: STAGE_LABEL };
