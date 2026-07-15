'use strict';
// SLICE E — bridge measured actual labor (Slice D) into fee reconciliation.
//
// Slice D put a real active-time timer on task screens (tasks.work_seconds, finalized per task). Slice E · Fork 1
// made capture a city-owned, per-UI toggle (off | discretion | always), which means work_seconds may be a real
// billable number, or NULL (capture was off, or the assignee skipped). This module is the wiring that turns those
// per-task seconds into the ACTUAL labor HOURS the deterministic fee engine already knows how to reconcile — and,
// on the last billable task's finalize, auto-computes a DRAFT reconciliation. The revised-notice SEND stays
// human-gated exactly as it already is via feeReissue (this only computes/stages; it never notifies a requestor).
//
// Request-level only. Per-component / MRR-child attribution is DEFERRED to #11 (parent roll-up), consistent with
// Slice B/C: for a multi-component request the measured labor is aggregated and applied to the first component, so
// the request-LEVEL total is correct (the engine re-aggregates labor at the request level anyway) even though the
// per-component split is not yet meaningful.

var db = require('../db');
var all = db.all, get = db.get, run = db.run;
var uuidv4 = require('uuid').v4;
var engine = require('./feeEngine');

// Task type -> fee labor driver. The engine prices three labor drivers: search / review / programming.
//   record_search                                    -> search
//   redaction / legal_redaction / redaction_qa /
//   legal_review                                     -> review   (the "review/redaction" family)
//   everything else (estimate, routing_review,
//   fee_waiver, commercial_rate, mrr_processing, ...) -> non-billable labor: contributes NO hours.
// programming has no routed task type today (bespoke data-extraction work is not a task) — so nothing maps to it;
// the driver stays available for the manual path. Matches the default mapping parked in the Slice E scoping notes.
var TASK_DRIVER = {
  record_search: 'search',
  redaction: 'review',
  legal_redaction: 'review',
  redaction_qa: 'review',
  legal_review: 'review',
};
var BILLABLE_TASK_TYPES = Object.keys(TASK_DRIVER);
// Active (non-terminal) task statuses — a billable task in one of these still has labor to come.
var ACTIVE_STATUSES = ['open', 'assigned', 'in_progress', 'returned', 'awaiting_review'];
// The engine's per-component quantity keys for the three labor drivers.
var DRIVER_QTY_KEY = { search: 'searchHours', review: 'reviewHours', programming: 'programmingHours' };

function r4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }
function qmarks(arr) { return arr.map(function () { return '?'; }).join(','); }

// Roll up FINALIZED measured labor across a request's billable work tasks into fee labor-driver HOURS.
// Tolerates NULL work_seconds: a task whose capture was off or was skipped contributes ZERO and is reported under
// `excluded` — never assumed to have actuals. `hasActuals` is the honest gate: false means no measured labor exists
// and the caller must fall back to the manual path rather than reconcile against fabricated zero-hours.
async function rollup(requestId) {
  var rows = await all(
    'SELECT id, type, status, work_seconds, work_measured_seconds, work_finalized FROM tasks ' +
    'WHERE request_id = ? AND type IN (' + qmarks(BILLABLE_TASK_TYPES) + ')',
    [requestId].concat(BILLABLE_TASK_TYPES)
  );
  var seconds = { search: 0, review: 0, programming: 0 };
  var counted = [], excluded = [];
  (rows || []).forEach(function (t) {
    var driver = TASK_DRIVER[t.type];
    if (t.work_finalized && t.work_seconds != null) {
      seconds[driver] += Number(t.work_seconds) || 0;
      counted.push({ id: t.id, type: t.type, driver: driver, seconds: Number(t.work_seconds) || 0 });
    } else {
      excluded.push({ id: t.id, type: t.type, driver: driver,
        reason: t.work_finalized ? 'no billable time captured (off/skipped)' : 'not finalized' });
    }
  });
  var hours = {
    searchHours: r4(seconds.search / 3600),
    reviewHours: r4(seconds.review / 3600),
    programmingHours: r4(seconds.programming / 3600),
  };
  return {
    requestId: requestId,
    hours: hours,
    seconds: seconds,
    hasActuals: (seconds.search + seconds.review + seconds.programming) > 0,
    counted: counted,
    excluded: excluded,
  };
}

// Count billable work tasks still in flight on a request, excluding one task id (the one finalizing now). Zero
// means the finalizing task is the LAST billable task — the auto-draft trigger point (Fork 2).
async function remainingBillableCount(requestId, excludeTaskId) {
  var params = [requestId, excludeTaskId == null ? '' : excludeTaskId].concat(BILLABLE_TASK_TYPES).concat(ACTIVE_STATUSES);
  var row = await get(
    'SELECT count(*) AS n FROM tasks WHERE request_id = ? AND id <> ? AND type IN (' +
    qmarks(BILLABLE_TASK_TYPES) + ') AND status IN (' + qmarks(ACTIVE_STATUSES) + ')',
    params
  );
  return Number(row && row.n) || 0;
}

// The estimate's quoted labor hours, summed across components (request-level), for the estimate-vs-actual readout.
function estimatedHoursFromInput(input) {
  var out = { searchHours: 0, reviewHours: 0, programmingHours: 0 };
  var comps = (input && input.components) || [];
  comps.forEach(function (c) {
    var q = (c && c.quantities) || {};
    out.searchHours += Number(q.searchHours) || 0;
    out.reviewHours += Number(q.reviewHours) || 0;
    out.programmingHours += Number(q.programmingHours) || 0;
  });
  return { searchHours: r4(out.searchHours), reviewHours: r4(out.reviewHours), programmingHours: r4(out.programmingHours) };
}

// Take the estimate's stored input and overlay MEASURED labor hours onto it, request-level: all measured hours land
// on the first component; the other components' labor is zeroed. Non-labor quantities (pages/media/av) are carried
// forward AS QUOTED — this draft measures LABOR, not page counts, and staff refine the rest via the manual path.
function applyMeasuredLabor(input, measuredHours) {
  var base = input && typeof input === 'object' ? JSON.parse(JSON.stringify(input)) : { components: [] };
  var comps = base.components || [];
  if (!comps.length) return base;
  comps.forEach(function (c, i) {
    c.quantities = c.quantities || {};
    ['search', 'review', 'programming'].forEach(function (d) {
      var key = DRIVER_QTY_KEY[d];
      c.quantities[key] = (i === 0) ? (Number(measuredHours[key]) || 0) : 0;
    });
  });
  base._laborActuals = true;
  return base;
}

// Central reconciliation-snapshot writer. Computes variance vs the estimate total, flags a revised notice past the
// jurisdiction's revisionNotifyPercent, and inserts one kind='reconciliation' row. Shared by BOTH the manual
// reconcile route and the auto-draft trigger so the snapshot shape and variance math never drift. Side-effect-free
// beyond the single insert (no Welford, no history, no notice) — callers layer those on per their context.
async function writeReconciliation(opts) {
  var actualTotal = Number(opts.feeContext.requestLevel.total) || 0;
  var estTotal = (opts.estTotal != null) ? Number(opts.estTotal) : null;
  var pol = (typeof opts.revisionNotifyPercent === 'number') ? opts.revisionNotifyPercent : 20;
  var variancePct = (estTotal != null && estTotal > 0) ? Math.round(((actualTotal - estTotal) / estTotal) * 1000) / 10 : null;
  var reNotify = (variancePct != null && variancePct > pol);
  var id = 'feerec-' + uuidv4().slice(0, 8);
  var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await run(
    'INSERT INTO request_fee_estimates (id, request_id, kind, config_profile_id, input_json, fee_context_json, total, deposit_due, notify_flag, baseline_total, variance_pct, renotify_required, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, opts.rid, 'reconciliation', opts.configProfileId || null, JSON.stringify(opts.input || {}),
     JSON.stringify(opts.feeContext), actualTotal, 0, 0, estTotal, variancePct, reNotify ? 1 : 0,
     opts.createdBy || 'system', now]
  );
  return { id: id, actualTotal: actualTotal, estimateTotal: estTotal, variancePct: variancePct, reNotifyRequired: reNotify, reNotifyThreshold: pol };
}

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
async function activeJurisdiction() {
  var row = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  return (row && row.value) || 'jur-tx';
}
async function pickConfig(jid) {
  return await get("SELECT * FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR' ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC LIMIT 1", [jid]);
}

// Auto-compute a DRAFT reconciliation from measured labor (Fork 2 trigger). Returns the draft summary, or null with
// a reason when it declines — so it is always safe to call on any finalize:
//   - no prior estimate snapshot            -> nothing to reconcile against
//   - no measured actuals (all off/skipped) -> fall back to the manual path; never reconcile fabricated zeros
// Human-gated by construction: it stages a reconciliation snapshot only. It does NOT send a notice and does NOT
// fold actuals into the record-type profiles (Welford) — those belong to the staff-confirmed manual reconcile.
async function autoDraftReconcile(requestId, actor) {
  var roll = await rollup(requestId);
  if (!roll.hasActuals) return { skipped: true, reason: 'no measured labor actuals', rollup: roll };
  var est = await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [requestId]);
  if (!est) return { skipped: true, reason: 'no estimate to reconcile against', rollup: roll };
  var input = {}; try { input = JSON.parse(est.input_json || '{}'); } catch (e) { input = {}; }
  if (!input.components || !input.components.length) return { skipped: true, reason: 'estimate has no priced components', rollup: roll };

  var cfgRow = est.config_profile_id ? await get('SELECT * FROM fee_profiles WHERE id = ?', [est.config_profile_id]) : await pickConfig(await activeJurisdiction());
  var config = {}; try { config = JSON.parse((cfgRow && cfgRow.config_json) || '{}'); } catch (e) { config = {}; }

  var draftInput = applyMeasuredLabor(input, roll.hours);
  draftInput._autoDraft = true;
  draftInput._laborRollup = { seconds: roll.seconds, hours: roll.hours, tasks: roll.counted };
  var feeContext = engine.compute(config, draftInput);
  var pol = (config.estimatePolicy && typeof config.estimatePolicy.revisionNotifyPercent === 'number') ? config.estimatePolicy.revisionNotifyPercent : 20;

  var summary = await writeReconciliation({
    rid: requestId, configProfileId: cfgRow && cfgRow.id, input: draftInput, feeContext: feeContext,
    estTotal: est.total != null ? Number(est.total) : null, revisionNotifyPercent: pol,
    createdBy: (actor || 'system') + ' (auto-draft)',
  });

  try {
    await run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action, details, created_at) VALUES (?,?,?,?,?,?,?)",
      ['rh-' + uuidv4().slice(0, 8), requestId, null, actor || 'system', 'ESTIMATE_RECONCILED_DRAFT',
       'Draft reconciliation auto-computed from measured labor (' + roll.counted.length + ' task' + (roll.counted.length === 1 ? '' : 's') + '): $' + summary.actualTotal.toFixed(2) +
       (summary.estimateTotal != null ? (' vs estimate $' + summary.estimateTotal.toFixed(2) + ' (' + (summary.variancePct >= 0 ? '+' : '') + summary.variancePct + '%)') : '') +
       (summary.reNotifyRequired ? ' — revised notice required (staff review before sending).' : ' — staff review before finalizing.'),
       nowStr()]);
  } catch (e) { /* history is best-effort; the snapshot is the record of truth */ }
  try {
    await require('./paymentStatus').recordEvent(requestId, { type: 'reconciliation', amount: summary.actualTotal, reason: 'draft reconciliation auto-computed from measured labor', actor: actor || 'system' });
  } catch (e) { /* non-fatal */ }

  return { draft: true, reason: null, rollup: roll, reconciliation: summary };
}

// Trigger entry point, called from the task finalize path. Fires the auto-draft only when the finalizing task is a
// billable work task AND it is the last one still in flight. Never throws — a reconciliation failure must not break
// task finalize. `taskType`/`wasFinalized` let the caller skip the work for non-billable or already-finalized tasks.
async function maybeAutoDraftOnFinalize(requestId, taskId, taskType, actor, wasAlreadyFinalized) {
  try {
    if (wasAlreadyFinalized) return { skipped: true, reason: 'task was already finalized' };
    if (BILLABLE_TASK_TYPES.indexOf(taskType) === -1) return { skipped: true, reason: 'not a billable work task' };
    var remaining = await remainingBillableCount(requestId, taskId);
    if (remaining > 0) return { skipped: true, reason: remaining + ' billable task(s) still in flight' };
    return await autoDraftReconcile(requestId, actor);
  } catch (e) {
    return { error: (e && e.message) || 'auto-draft failed' };
  }
}

module.exports = {
  TASK_DRIVER: TASK_DRIVER,
  BILLABLE_TASK_TYPES: BILLABLE_TASK_TYPES,
  DRIVER_QTY_KEY: DRIVER_QTY_KEY,
  rollup: rollup,
  remainingBillableCount: remainingBillableCount,
  estimatedHoursFromInput: estimatedHoursFromInput,
  applyMeasuredLabor: applyMeasuredLabor,
  writeReconciliation: writeReconciliation,
  autoDraftReconcile: autoDraftReconcile,
  maybeAutoDraftOnFinalize: maybeAutoDraftOnFinalize,
};
