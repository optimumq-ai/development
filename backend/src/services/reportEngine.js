'use strict';
// Deterministic report engine. Takes a bounded query SPEC (produced either by a pre-built report or
// by the NL->spec translator) and computes the numbers in code - never lets the model write SQL.
// Safe (read-only, fixed table/column whitelist), correct (code computes), consistent (same spec ->
// same result). Returns { title, viz, columns, rows, note }.
var db = require('../db');

// ---- catalog (the only things a report can reference) ----
var METRICS = ['request_count', 'fee_revenue', 'overdue_count', 'avg_processing_days', 'compliance_rate', 'self_service_rate'];
var GROUPS = { month: 'Month', department: 'Department', classification: 'Classification', status: 'Status', requestor: 'Requestor' };
var TIME_PRESETS = ['all', 'ytd', 'this_month', 'last_month', 'last_7d', 'last_30d', 'last_60d', 'last_90d', 'last_12_months'];

// exclude system/pseudo requests from all request-based metrics
var BASE_EXCL = "r.request_number NOT LIKE 'SYS-%' AND r.request_number <> 'LIBRARY'";

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
function whereFrom(spec, extra) {
  var w = [BASE_EXCL], p = [];
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
function moneyRows(rows) { return rows.map(function (x) { return { label: x.k, value: Math.round((Number(x.v) || 0) * 100) / 100 }; }); }

async function runSpec(spec) {
  spec = spec || {};
  var metric = METRICS.indexOf(spec.metric) >= 0 ? spec.metric : 'request_count';
  var groupBy = GROUPS[spec.group_by] ? spec.group_by : null;
  var limit = Math.min(Math.max(parseInt(spec.limit, 10) || 0, 0), 50);

  // --- self_service_rate: library (published) vs submitted requests ---
  if (metric === 'self_service_rate') {
    var lib = await db.get("SELECT COUNT(*) AS c FROM fulfilled_records WHERE status='released' AND COALESCE(published,0)=1");
    var w0 = whereFrom(spec);
    var sub = await db.get("SELECT COUNT(*) AS c FROM requests r" + w0.sql, w0.params);
    var L = Number(lib.c) || 0, S = Number(sub.c) || 0, denom = L + S;
    return { title: 'Self-service rate', viz: 'number', columns: ['Metric', 'Value'],
      rows: [{ label: 'Self-service records available', value: L }, { label: 'Submitted requests', value: S }, { label: 'Self-service share', value: denom ? Math.round(L / denom * 100) + '%' : 'n/a' }],
      note: 'Self-service = records already published to the public library (no staff request needed).' };
  }

  // --- avg_processing_days & compliance_rate: computed in JS from closed requests ---
  if (metric === 'avg_processing_days' || metric === 'compliance_rate') {
    var g = groupBy ? groupExpr(groupBy) : null;
    var wc = whereFrom(spec, "r.status = 'closed'");
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

  // --- count/revenue/overdue: SQL aggregate, optional group ---
  var valueExpr = metric === 'fee_revenue' ? 'COALESCE(SUM(r.amount_paid),0)' : 'COUNT(*)';
  var extra = metric === 'overdue_count' ? ("r.deadline_date < '" + today() + "' AND r.status = 'active'") : null;
  var w = whereFrom(spec, extra);
  if (groupBy) {
    var ge = groupExpr(groupBy);
    var order = (spec.sort === 'desc') ? 'v DESC' : (spec.sort === 'asc' ? 'v ASC' : ge.order);
    var sql = "SELECT " + ge.sql + " AS k, " + valueExpr + " AS v FROM requests r" + ge.join + w.sql + " GROUP BY " + ge.sql + " ORDER BY " + order + (limit ? " LIMIT " + limit : "");
    var rr = await db.all(sql, w.params);
    var rowsOut = metric === 'fee_revenue' ? moneyRows(rr) : rr.map(function (x) { return { label: x.k, value: Number(x.v) || 0 }; });
    return { title: titleFor(metric, groupBy, spec), viz: spec.viz || (groupBy === 'month' ? 'line' : 'bar'), columns: [ge.label, metricLabel(metric)], rows: rowsOut, note: noteFor(metric) };
  } else {
    var one = await db.get("SELECT " + valueExpr + " AS v FROM requests r" + w.sql, w.params);
    var v = Number(one.v) || 0;
    return { title: titleFor(metric, null, spec), viz: 'number', columns: ['Metric', 'Value'], rows: [{ label: metricLabel(metric), value: metric === 'fee_revenue' ? '$' + (Math.round(v * 100) / 100).toLocaleString() : v }], note: noteFor(metric) };
  }
}
function metricLabel(m) { return { request_count: 'Requests', fee_revenue: 'Fee revenue', overdue_count: 'Overdue', avg_processing_days: 'Avg days', compliance_rate: 'Compliant %' }[m] || 'Value'; }
function noteFor(m) { return m === 'fee_revenue' ? 'Fee revenue = payments collected (amount paid) on requests.' : (m === 'overdue_count' ? 'Active requests past their statutory deadline.' : ''); }
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
