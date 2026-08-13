'use strict';
// WORKLOAD HEALTH (build item #13 — D4 §4, model approved by Kevin 2026-08-13 from mockups).
//
// The scoring layer over the shipped budget-lateness buckets (SPEC_operational_dashboard §1). Pure
// functions, no I/O — every consumer (ops-summary nodes/teams/totals, the My Tasks personal
// composite, the workload_health report metric) computes health from buckets it already has, so the
// score can never disagree with the counts on the same screen.
//
// THE FORMULA (the §4 "exponential penalty per additional day late", expressed in the decided buckets):
//   1 day over budget = 1 point · 2 days = 2 points · more than 2 days = 4 points.
// Doubling per day means one badly stuck task outweighs several slightly-late ones — which is what an
// attention tool should say. Paused tasks never score (they are excluded from the buckets upstream —
// the cries-wolf rule), and unbudgeted tasks never score (no budget, no lateness).
//
// STATUS THRESHOLDS (fixed v1, refine from customer feedback like the rest of the dashboard):
//   0 points  -> on_track          nothing is over budget
//   1–3       -> needs_attention   something is late, but contained
//   4+        -> falling_behind    one task badly stuck, or several slipping at once — act today
//
// Wire values are snake_case keys; display names live in the frontend ("On track" / "Needs
// attention" / "Falling behind") per the terminology rule — plain formal names, no jargon.

var POINTS = { d1: 1, d2: 2, d2plus: 4 };
var H24 = 86400000, H48 = 2 * 86400000;

// The decided bucket edges (SPEC_operational_dashboard §1): over by (0,24h] = d1 · (24h,48h] = d2 ·
// >48h = d2plus. Owned HERE so ops-summary and the personal composite bucket identically by construction.
function bucketOf(overMs) { return overMs <= H24 ? 'd1' : (overMs <= H48 ? 'd2' : 'd2plus'); }

// Buckets for a plain task list (the My Tasks personal composite): rows + their taskBudget results.
// Paused tasks never count (the cries-wolf rule); unbudgeted tasks never count (no budget, no lateness).
function bucketsOf(rows, budgets) {
  var late = { d1: 0, d2: 0, d2plus: 0 };
  (rows || []).forEach(function (t) {
    if (t.paused_at) return;
    var b = budgets && budgets[t.id];
    if (b && b.state === 'over') late[bucketOf(b.overMs)]++;
  });
  return late;
}

function pointsFromBuckets(late) {
  late = late || {};
  return (Number(late.d1) || 0) * POINTS.d1 +
         (Number(late.d2) || 0) * POINTS.d2 +
         (Number(late.d2plus) || 0) * POINTS.d2plus;
}

function statusOf(points) {
  if (points <= 0) return 'on_track';
  return points <= 3 ? 'needs_attention' : 'falling_behind';
}

function healthOf(late) {
  var p = pointsFromBuckets(late);
  return { points: p, status: statusOf(p) };
}

// Sum health across a list of node-like objects that each carry .late buckets.
function compositeOf(nodes) {
  var p = (nodes || []).reduce(function (acc, n) { return acc + pointsFromBuckets(n && n.late); }, 0);
  return { points: p, status: statusOf(p) };
}

module.exports = { POINTS: POINTS, pointsFromBuckets: pointsFromBuckets, statusOf: statusOf, healthOf: healthOf, compositeOf: compositeOf, bucketOf: bucketOf, bucketsOf: bucketsOf };
