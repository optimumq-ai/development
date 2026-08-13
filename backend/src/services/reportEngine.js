'use strict';
// Deterministic report engine. Takes a bounded query SPEC (produced either by a pre-built report or
// by the NL->spec translator) and computes the numbers in code - never lets the model write SQL.
// Safe (read-only, fixed table/column whitelist), correct (code computes), consistent (same spec ->
// same result). Returns { title, viz, columns, rows, note }.
var db = require('../db');

// ---- catalog (the only things a report can reference) ----
var METRICS = ['request_count', 'fee_revenue', 'overdue_count', 'avg_processing_days', 'compliance_rate', 'self_service_rate', 'workload_health', 'high_priority_mrrs'];
var GROUPS = { month: 'Month', department: 'Department', classification: 'Classification', status: 'Status', requestor: 'Requestor' };
var TIME_PRESETS = ['all', 'ytd', 'this_month', 'last_month', 'last_7d', 'last_30d', 'last_60d', 'last_90d', 'last_12_months'];

// exclude system/pseudo requests from all request-based metrics
var BASE_EXCL = "r.request_number NOT LIKE 'SYS-%' AND r.request_number <> 'LIBRARY'";

var scope = require('./requestScope');
var revAlloc = require('./revenueAllocation');
// PARENT/CHILD SCOPE for reports. Once parent rows exist, an unscoped `FROM requests` double-counts every
// metric — volume, revenue, compliance, all of it. The right side depends on what is being measured:
//
//   PARENT (default) — VOLUME and MONEY and DEADLINES are properties of the citizen's request:
//                      request_count by month, fee_revenue, overdue_count, compliance_rate,
//                      avg_processing_days, self_service_rate.
//   LEAF             — grouping by a field that only a WORK row has (department, classification).
//                      "Requests by department" is really "work by department", and that is the child.
//
// RESOLVED 2026-07-19 (was a KNOWN LIMIT here and in SPEC §10.6): a PARENT-level MONEY metric grouped by a
// CHILD field — `fee_revenue by department` — is not a join problem and never was. A join would double-count
// one payment into two departments. It needed an ALLOCATION rule, which `componentCharged` (§5.10.2) now
// provides; `fee_revenue` no longer routes through this function at all, see `revenueReport` below.
function scopeFor(metric, groupBy) {
  var childGrouped = (groupBy === 'department' || groupBy === 'classification');
  return childGrouped ? scope.leaf('r') : scope.parent('r');
}

function today() { return new Date().toISOString().slice(0, 10); }
function ymd(dt) { return dt.toISOString().slice(0, 10); }
function timeRange(tr) {
  if (!tr || !tr.preset || tr.preset === 'all') return {};
  var now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth();
  function ago(days) { var x = new Date(now); x.setUTCDate(x.getUTCDate() - days); return ymd(x); }
  switch (tr.preset) {
    case 'ytd': return { from: y + '-01-01' };
    case 'this_month': return { from: ymd(new Date(Date.UTC(y, m, 1))) };
    case 'last_month': return { from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 1))) };
    case 'last_7d': return { from: ago(7) };
    case 'last_30d': return { from: ago(30) };
    case 'last_60d': return { from: ago(60) };
    case 'last_90d': return { from: ago(90) };
    case 'last_12_months': return { from: ymd(new Date(Date.UTC(y - 1, m, 1))) };
    default: return {};
  }
}
function groupExpr(g) {
  switch (g) {
    case 'month': return { sql: "substr(r.created_at,1,7)", label: 'Month', join: '', order: 'k ASC' };
    case 'department': return { sql: "COALESCE(d.name,'Unassigned')", label: 'Department', join: ' LEFT JOIN departments d ON d.id = r.department_id', order: 'v DESC' };
    case 'classification': return { sql: "r.classification", label: 'Classification', join: '', order: 'v DESC' };
    case 'status': return { sql: "r.status", label: 'Status', join: '', order: 'v DESC' };
    case 'requestor': return { sql: "COALESCE(r.requestor_name,'(unknown)')", label: 'Requestor', join: '', order: 'v DESC' };
    default: return null;
  }
}
function whereFrom(spec, extra, scopeSql) {
  var w = [BASE_EXCL], p = [];
  if (scopeSql) w.push(scopeSql);
  var tr = timeRange(spec.time_range);
  if (tr.from) { w.push("r.created_at >= ?"); p.push(tr.from); }
  if (tr.to) { w.push("r.created_at < ?"); p.push(tr.to); }
  var f = spec.filters || {};
  if (f.status && f.status !== 'all') { w.push("r.status = ?"); p.push(f.status); }
  if (f.classification) { w.push("r.classification = ?"); p.push(f.classification); }
  if (f.overdue) { w.push("r.deadline_date < ? AND r.status = 'active'"); p.push(today()); }
  if (extra) w.push(extra);
  return { sql: ' WHERE ' + w.join(' AND '), params: p };
}

async function runSpec(spec) {
  spec = spec || {};
  var metric = METRICS.indexOf(spec.metric) >= 0 ? spec.metric : 'request_count';
  var groupBy = GROUPS[spec.group_by] ? spec.group_by : null;
  var limit = Math.min(Math.max(parseInt(spec.limit, 10) || 0, 0), 50);

  // --- high_priority_mrrs (§14.4 item 6): the watch report over every flagged MRR ---
  // Point-in-time, grouped by nothing: each flagged, still-open MRR is one row with the facts a
  // manager acts on — items open, estimate readiness, the statutory due date. Sorted soonest-due first.
  if (metric === 'high_priority_mrrs') {
    var HUBr = require('./mrrHub');
    var flagged = await db.all(
      "SELECT id, request_number, high_priority_set_by, high_priority_set_at FROM requests r " +
      "WHERE r.high_priority = 1 AND r.status != 'closed' AND r.master_request_id IS NULL AND " + BASE_EXCL + " ORDER BY r.created_at");
    var hpRows = [];
    for (var hi = 0; hi < flagged.length; hi++) {
      var hp = flagged[hi];
      var hkids = await db.all("SELECT status FROM requests WHERE master_request_id = ?", [hp.id]);
      var hready = await HUBr.readiness(hp.id).catch(function () { return null; });
      // Due dates are COMPUTED (started_at + duration through tolls), never stored — go through
      // the same parentClocks the hub master renders, so the report can never disagree with it.
      var hclocks = await HUBr.parentClocks(hp.id);
      var hprimary = hclocks.filter(function (c) { return c.isPrimary && c.dueDate; })[0] ||
                     hclocks.filter(function (c) { return c.legalDeadline && c.dueDate; })[0] || null;
      var hopen = hkids.filter(function (k) { return k.status !== 'closed'; }).length;
      hpRows.push({
        label: hp.request_number + ' — ' + hkids.length + ' item' + (hkids.length === 1 ? '' : 's') + ', ' + hopen + ' open' +
          (hready ? ' · estimate data ' + hready.n + ' of ' + hready.m + ' ready' : '') +
          (hprimary ? ' · respond by ' + String(hprimary.dueDate).slice(0, 10) : '') +
          ' · flagged by ' + (hp.high_priority_set_by || 'staff'),
        value: hopen,
        _due: hprimary ? String(hprimary.dueDate) : '9999'
      });
    }
    hpRows.sort(function (a, b) { return a._due < b._due ? -1 : 1; });
    hpRows.forEach(function (rw) { delete rw._due; });
    return { title: 'High-priority multi-record requests', viz: 'table', columns: ['Request', 'Open items'],
      rows: hpRows,
      note: hpRows.length
        ? 'Every open multi-record request a Request Manager has marked HIGH PRIORITY, soonest statutory due date first. Snapshot of right now.'
        : 'No open multi-record requests are marked HIGH PRIORITY right now.' };
  }

  // --- workload_health (#13): the AI-reporting hook onto the dashboard's health scoring ---
  // A point-in-time snapshot off the SAME ops-summary read the dashboard uses, so a report can never
  // disagree with the screen. Time ranges and groupings don't apply (it is "now", grouped by team).
  if (metric === 'workload_health') {
    var opsW = await require('./opsSummary').taskNodes({});
    var WHr = require('./workloadHealth');
    var LABELS = { on_track: 'On track', needs_attention: 'Needs attention', falling_behind: 'Falling behind' };
    var whRows = opsW.teams.map(function (t) {
      var l = t.nodes.reduce(function (acc, n) {
        acc.d1 += n.late.d1; acc.d2 += n.late.d2; acc.d2plus += n.late.d2plus; return acc;
      }, { d1: 0, d2: 0, d2plus: 0 });
      var parts = [];
      if (l.d1) parts.push(l.d1 + ' task' + (l.d1 > 1 ? 's' : '') + ' 1 day late');
      if (l.d2) parts.push(l.d2 + ' 2 days late');
      if (l.d2plus) parts.push(l.d2plus + ' more than 2 days late');
      return { label: t.teamName + ' — ' + LABELS[t.health.status] + (parts.length ? ' (' + parts.join(', ') + ')' : ''),
               value: t.health.points };
    }).sort(function (a, b) { return b.value - a.value; });
    var totW = opsW.totals.health || WHr.compositeOf([]);
    return { title: 'Workload health by team', viz: 'table', columns: ['Team', 'Health points'],
      rows: whRows,
      note: 'All teams: ' + LABELS[totW.status] + ' at ' + totW.points + ' points. Points: a task 1 day over its ' +
            'time budget = 1, 2 days = 2, more than 2 days = 4. 0 = on track, 1–3 = needs attention, 4+ = falling ' +
            'behind. Snapshot of right now; tasks waiting on the requestor never count. Budget lateness, not the legal deadline.' };
  }

  // --- self_service_rate: library (published) vs submitted requests ---
  if (metric === 'self_service_rate') {
    var lib = await db.get("SELECT COUNT(*) AS c FROM fulfilled_records WHERE status='released' AND COALESCE(published,0)=1");
    var w0 = whereFrom(spec, null, scopeFor('self_service_rate', null));
    var sub = await db.get("SELECT COUNT(*) AS c FROM requests r" + w0.sql, w0.params);
    var L = Number(lib.c) || 0, S = Number(sub.c) || 0, denom = L + S;
    return { title: 'Self-service rate', viz: 'number', columns: ['Metric', 'Value'],
      rows: [{ label: 'Self-service records available', value: L }, { label: 'Submitted requests', value: S }, { label: 'Self-service share', value: denom ? Math.round(L / denom * 100) + '%' : 'n/a' }],
      note: 'Self-service = records already published to the public library (no staff request needed).' };
  }

  // --- avg_processing_days & compliance_rate: computed in JS from closed requests ---
  if (metric === 'avg_processing_days' || metric === 'compliance_rate') {
    var g = groupBy ? groupExpr(groupBy) : null;
    var wc = whereFrom(spec, "r.status = 'closed'", scopeFor(metric, groupBy));
    var sel = "SELECT " + (g ? g.sql + " AS k, " : "'All' AS k, ") + "r.created_at, r.updated_at, r.deadline_date FROM requests r" + (g ? g.join : '') + wc.sql;
    var rows = await db.all(sel, wc.params);
    var buckets = {};
    rows.forEach(function (x) {
      var key = x.k || '(none)';
      if (!buckets[key]) buckets[key] = { n: 0, days: 0, compliant: 0, dtotal: 0 };
      var c = new Date(x.created_at), u = new Date(x.updated_at);
      var d = (u - c) / 86400000; if (isFinite(d) && d >= 0) { buckets[key].days += d; buckets[key].n++; }
      if (x.deadline_date) { buckets[key].dtotal++; var met = new Date(x.updated_at) <= new Date(x.deadline_date + 'T23:59:59'); if (met) buckets[key].compliant++; }
    });
    var isNumberViz = !groupBy;
    var out = Object.keys(buckets).map(function (k) {
      var b = buckets[k];
      var val = metric === 'avg_processing_days' ? (b.n ? Math.round(b.days / b.n * 10) / 10 : 0) : (b.dtotal ? Math.round(b.compliant / b.dtotal * 100) : 0);
      return { label: k, value: (metric === 'compliance_rate' && isNumberViz) ? (val + '%') : val };
    });
    out.sort(function (a, b) { return b.value - a.value; });
    var unit = metric === 'avg_processing_days' ? ' (days)' : ' (%)';
    return { title: (metric === 'avg_processing_days' ? 'Average processing time' : 'Compliance rate') + (groupBy ? ' by ' + GROUPS[groupBy].toLowerCase() : ''),
      viz: groupBy ? 'bar' : 'number', columns: [(g ? g.label : 'Scope'), (metric === 'avg_processing_days' ? 'Avg days' : 'Compliant %')], rows: out,
      note: metric === 'compliance_rate' ? 'Share of closed requests completed on or before their statutory deadline.' : 'Average calendar days from intake to close, for closed requests.' };
  }

  // --- fee_revenue: computed in JS, because collected money must be ALLOCATED before it can be grouped ---
  //
  // WAS REFUSED UNTIL 2026-07-19. Revenue by department/classification was recorded UNDEFINED (Kevin,
  // 2026-07-14): revenue is one number on the parent, a department is a property of the individual RECORDS
  // inside it, and splitting it needed an allocation rule that did not exist. `componentCharged` (SPEC
  // §5.10.2, built 2026-07-19) is that rule, so the cut is now defined — see `services/revenueAllocation.js`.
  //
  // This ALSO replaces `SUM(r.amount_paid)`, which was reading a column that has never had a writer.
  if (metric === 'fee_revenue') return await revenueReport(spec, groupBy, limit);

  // --- count/overdue: SQL aggregate, optional group ---
  var valueExpr = 'COUNT(*)';
  var extra = metric === 'overdue_count' ? ("r.deadline_date < '" + today() + "' AND r.status = 'active'") : null;
  var w = whereFrom(spec, extra, scopeFor(metric, groupBy));
  if (groupBy) {
    var ge = groupExpr(groupBy);
    // ', k' is a deterministic tiebreaker: two departments with the same count were swapping places
    // between runs, which reads as data churn in a report that has not changed.
    var order = ((spec.sort === 'desc') ? 'v DESC' : (spec.sort === 'asc' ? 'v ASC' : ge.order)) + ', k';
    var sql = "SELECT " + ge.sql + " AS k, " + valueExpr + " AS v FROM requests r" + ge.join + w.sql + " GROUP BY " + ge.sql + " ORDER BY " + order + (limit ? " LIMIT " + limit : "");
    var rr = await db.all(sql, w.params);
    var rowsOut = rr.map(function (x) { return { label: x.k, value: Number(x.v) || 0 }; });
    return { title: titleFor(metric, groupBy, spec), viz: spec.viz || (groupBy === 'month' ? 'line' : 'bar'), columns: [ge.label, metricLabel(metric)], rows: rowsOut, note: noteFor(metric) };
  } else {
    var one = await db.get("SELECT " + valueExpr + " AS v FROM requests r" + w.sql, w.params);
    return { title: titleFor(metric, null, spec), viz: 'number', columns: ['Metric', 'Value'], rows: [{ label: metricLabel(metric), value: Number(one.v) || 0 }], note: noteFor(metric) };
  }
}

// FEE REVENUE — collected money, attributed to the record that earned it.
//
// Computed in JS rather than SQL for the same reason `avg_processing_days` is: the per-record split lives in
// each snapshot's `fee_context_json`, and the allocation (§5.10.2) is a rule, not an aggregate.
//
// WHICH ROW A FILTER APPLIES TO is the subtle part, and the two are deliberately different:
//   the PAYER  (parent) carries the filters and the parent-level cuts — time range, status, requestor, month.
//                       The citizen paid once, on a date, with a status; that is a parent fact.
//   the EARNER (child)  carries the child-level cuts — department, classification. That is the whole point of
//                       the allocation: money collected from one payer is earned by n records.
// Filtering on the earner instead would drop revenue whose parent matched, and silently under-report the total.
async function revenueReport(spec, groupBy, limit) {
  var parts = await revAlloc.collected();

  // Same filters, scope and exclusions as every other parent-level metric.
  var w = whereFrom(spec, null, scope.parent('r'));
  var payerRows = await db.all("SELECT r.id, r.created_at, r.status, r.requestor_name FROM requests r" + w.sql, w.params);
  var payers = {};
  payerRows.forEach(function (x) { payers[x.id] = x; });
  parts = parts.filter(function (p) { return payers[p.paidForRequestId]; });

  var total = 0;
  parts.forEach(function (p) { total = Math.round((total + p.amount) * 100) / 100; });

  // How much of the total could NOT be attributed to a specific record. Disclosed rather than buried: a
  // department cut that quietly omits money reads as precise when it is not. See `revenueAllocation.splitOne`.
  var unallocated = 0;
  parts.forEach(function (p) { if (p.basis !== 'component') unallocated = Math.round((unallocated + p.amount) * 100) / 100; });

  if (!groupBy) {
    return { title: titleFor('fee_revenue', null, spec), viz: 'number', columns: ['Metric', 'Value'],
      rows: [{ label: 'Fee revenue', value: '$' + total.toLocaleString() }], note: revenueNote(null, 0, total) };
  }

  var childGrouped = (groupBy === 'department' || groupBy === 'classification');
  var earners = {};
  if (childGrouped) {
    var ids = {};
    parts.forEach(function (p) { ids[p.requestId] = true; });
    var idList = Object.keys(ids);
    if (idList.length) {
      var ph = idList.map(function () { return '?'; }).join(',');
      var er = await db.all(
        "SELECT r.id, r.classification, COALESCE(d.name,'Unassigned') AS dept FROM requests r" +
        " LEFT JOIN departments d ON d.id = r.department_id WHERE r.id IN (" + ph + ")", idList);
      er.forEach(function (x) { earners[x.id] = x; });
    }
  }

  var buckets = {};
  parts.forEach(function (p) {
    var key;
    if (groupBy === 'department') key = (earners[p.requestId] || {}).dept || 'Unassigned';
    else if (groupBy === 'classification') key = (earners[p.requestId] || {}).classification || '(none)';
    else if (groupBy === 'month') key = String(payers[p.paidForRequestId].created_at).slice(0, 7);
    else if (groupBy === 'status') key = payers[p.paidForRequestId].status;
    else key = payers[p.paidForRequestId].requestor_name || '(unknown)';
    buckets[key] = Math.round(((buckets[key] || 0) + p.amount) * 100) / 100;
  });

  var out = Object.keys(buckets).map(function (k) { return { label: k, value: buckets[k] }; });
  // Deterministic tiebreaker by label — two departments with equal revenue were swapping places between runs,
  // which reads as data churn in a report that has not changed.
  var asc = (spec.sort === 'asc') || (!spec.sort && groupBy === 'month');
  out.sort(function (a, b) {
    if (groupBy === 'month' && !spec.sort) return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0);
    if (a.value !== b.value) return asc ? a.value - b.value : b.value - a.value;
    return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0);
  });
  if (limit) out = out.slice(0, limit);

  return { title: titleFor('fee_revenue', groupBy, spec), viz: spec.viz || (groupBy === 'month' ? 'line' : 'bar'),
    columns: [groupExpr(groupBy).label, 'Fee revenue'], rows: out,
    note: revenueNote(childGrouped ? groupBy : null, unallocated, total) };
}

function revenueNote(childGrouped, unallocated, total) {
  var base = 'Fee revenue = payments collected (deposits and final payments) on fee estimates.';
  if (!childGrouped) return base;
  base += ' Each payment is split across the records it covers in proportion to their charged share' +
          ' (SPEC §5.10.2), so the columns sum to the total.';
  if (unallocated > 0) {
    base += ' $' + unallocated.toLocaleString() + ' of $' + total.toLocaleString() +
            ' could not be attributed to a specific record (estimates with no per-record pricing) and is' +
            ' counted under the department that was billed.';
  }
  return base;
}
function metricLabel(m) { return { request_count: 'Requests', fee_revenue: 'Fee revenue', overdue_count: 'Overdue', avg_processing_days: 'Avg days', compliance_rate: 'Compliant %' }[m] || 'Value'; }
// fee_revenue never reaches here — it has its own note (`revenueNote`), because the note has to disclose how
// much of the money could not be allocated.
function noteFor(m) { return m === 'overdue_count' ? 'Active requests past their statutory deadline.' : ''; }
function titleFor(m, g, spec) {
  var base = { request_count: 'Request volume', fee_revenue: 'Fee revenue', overdue_count: 'Overdue requests' }[m] || 'Report';
  var t = base + (g ? ' by ' + GROUPS[g].toLowerCase() : '');
  var pre = spec.time_range && spec.time_range.preset;
  if (pre && pre !== 'all') t += ' (' + pre.replace(/_/g, ' ') + ')';
  return t;
}

// compare two request-count series (this vs last month, or self-service vs submitted)
async function runCompare(spec) {
  if (spec.compare === 'this_vs_last_month') {
    var a = await runSpec({ metric: 'request_count', time_range: { preset: 'this_month' } });
    var b = await runSpec({ metric: 'request_count', time_range: { preset: 'last_month' } });
    return { title: 'Requests: this month vs last month', viz: 'bar', columns: ['Period', 'Requests'],
      rows: [{ label: 'Last month', value: b.rows[0].value }, { label: 'This month', value: a.rows[0].value }], note: '' };
  }
  return runSpec(spec);
}

async function run(spec) { spec = spec || {}; if (spec.compare) return runCompare(spec); return runSpec(spec); }

// pre-built reports (the buttons)
var PREBUILT = {
  fee_revenue_ytd: { metric: 'fee_revenue', group_by: 'month', time_range: { preset: 'ytd' }, viz: 'line' },
  volume_by_month: { metric: 'request_count', group_by: 'month', time_range: { preset: 'last_12_months' }, viz: 'line' },
  processing_time: { metric: 'avg_processing_days', group_by: 'classification' },
  overdue_by_dept: { metric: 'overdue_count', group_by: 'department' },
  compliance_rate: { metric: 'compliance_rate' },
  self_service_rate: { metric: 'self_service_rate' },
  top_requestors: { metric: 'request_count', group_by: 'requestor', time_range: { preset: 'last_90d' }, sort: 'desc', limit: 10, viz: 'table' }
};

module.exports = { run: run, runSpec: runSpec, PREBUILT: PREBUILT, METRICS: METRICS, GROUPS: GROUPS, TIME_PRESETS: TIME_PRESETS };
