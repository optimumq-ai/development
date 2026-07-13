'use strict';
// Tickler: a time-driven sweep that FLAGS requests on overdue clocks (it does not auto-close by default).
// Three clocks: (1) estimate-response lapse, (2) deposit overdue, (3) general stall. Each is idempotent
// (won't re-flag/re-log) and writes a request_history entry. Runs on a daily setInterval + a manual endpoint.

var db = require('../db');
var all = db.all, get = db.get, run = db.run;
var uuidv4 = require('uuid').v4;
var pt = require('./paymentTiming');
var PCP = require('./paymentClockPolicy');
var depositAction = require('./depositAction');

var DEFAULTS = { requesterResponseDays: 10, depositDueDays: 10, stallDays: 21, autoWithdrawOnLapse: false };
var TERMINAL_STAGES = ['delivery', 'closed'];

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function daysAgoStr(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' '); }

// --- 4c: per-request band windows ---
function subBusinessDays(fromMs, n) { var d = new Date(fromMs); var left = n; while (left > 0) { d.setDate(d.getDate() - 1); var wd = d.getDay(); if (wd !== 0 && wd !== 6) left--; } return d; }
function overdue(anchorStr, days, unit, nowMs) { if (!anchorStr || !days) return false; var a = Date.parse(String(anchorStr).replace(' ', 'T')); if (isNaN(a)) return false; var cutoff = (unit === 'business') ? subBusinessDays(nowMs, days).getTime() : (nowMs - days * 86400000); return a < cutoff; }
function windowFromPlan(plan, fallbackDays) { var w = plan && plan.firstPayment && plan.firstPayment.dueWindow; if (w && w.days) return { days: Number(w.days), unit: w.unit || 'calendar', onExpiry: w.onExpiry || 'withdrawn', fromPlan: true }; return { days: fallbackDays, unit: 'calendar', onExpiry: 'withdrawn', fromPlan: false }; }
var _cfgCache = {};
async function cfgForEstimate(est) {
  var pid = est.config_profile_id || '_active';
  var cfg = _cfgCache[pid];
  if (cfg === undefined) {
    var row = est.config_profile_id ? await get('SELECT config_json FROM fee_profiles WHERE id = ?', [est.config_profile_id]) : await get("SELECT config_json FROM fee_profiles WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1");
    try { cfg = row ? JSON.parse(row.config_json || '{}') : {}; } catch (e) { cfg = {}; }
    _cfgCache[pid] = cfg;
  }
  return cfg;
}
async function planForEstimate(est) {
  var cfg = await cfgForEstimate(est);
  var ptCfg = (cfg.paymentTiming && Object.keys(cfg.paymentTiming).length) ? cfg.paymentTiming : pt.deriveDefaultPaymentTiming(cfg);
  return pt.resolvePaymentPlan(ptCfg, { estimateTotal: Number(est.total) || 0 });
}

async function hist(requestId, action, details, stageFrom, stageTo) {
  try {
    await run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action, details, stage_from, stage_to, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ['rh-' + uuidv4().slice(0, 8), requestId, 'system', 'Tickler', action, details || null, stageFrom || null, stageTo || null, nowStr()]);
  } catch (e) { console.error('[tickler hist]', e.message); }
}

async function thresholds() {
  var T = Object.assign({}, DEFAULTS);
  try {
    var row = await get("SELECT config_json FROM fee_profiles WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1");
    if (!row) row = await get("SELECT config_json FROM fee_profiles ORDER BY updated_at DESC LIMIT 1");
    if (row && row.config_json) {
      var cfg = JSON.parse(row.config_json);
      var ep = cfg.estimatePolicy || {};
      if (typeof ep.requesterResponseDays === 'number' && ep.requesterResponseDays > 0) T.requesterResponseDays = ep.requesterResponseDays;
      if (ep.autoWithdrawOnLapse != null) T.autoWithdrawOnLapse = !!ep.autoWithdrawOnLapse;
    }
  } catch (e) { /* defaults */ }
  return T;
}

async function flagRequest(requestId, flag) {
  await run("UPDATE requests SET tickler_flag = ?, tickler_flagged_at = ? WHERE id = ?", [flag, nowStr(), requestId]);
}

async function runSweep(opts) {
  opts = opts || {};
  _cfgCache = {};
  var T = await thresholds();
  var actions = { estimate_lapsed: 0, deposit_overdue: 0, deposit_withdrawn: 0, stalled: 0, withdrawn: 0 };

  // (1) Estimate-response lapse: latest sent estimate not accepted/declined, past ITS band's acceptance
  // window (per-jurisdiction plan window; falls back to the flat default when the plan carries none).
  var nowMs = Date.now();
  var lapseCandidates = await all(
    "SELECT e.id AS est_id, e.request_id AS rid, e.config_profile_id, e.total, e.notified_at, r.stage AS stage FROM request_fee_estimates e " +
    "JOIN requests r ON r.id = e.request_id " +
    "WHERE e.kind = 'estimate' AND e.notified_at IS NOT NULL AND e.accepted_at IS NULL AND e.declined_at IS NULL " +
    "AND e.lapsed_at IS NULL AND r.status = 'active' " +
    "AND NOT EXISTS (SELECT 1 FROM objections o WHERE o.request_id = r.id AND o.status IN ('open','tentative') AND o.clock_frozen = 1) " +
    "AND e.id = (SELECT id FROM request_fee_estimates WHERE request_id = r.id AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1)");
  for (var i = 0; i < lapseCandidates.length; i++) {
    var lr = lapseCandidates[i];
    var lw = windowFromPlan(await planForEstimate(lr), T.requesterResponseDays);
    if (!overdue(lr.notified_at, lw.days, lw.unit, nowMs)) continue;
    var ldue = lw.days + ' ' + lw.unit + ' day' + (lw.days === 1 ? '' : 's');
    await run("UPDATE request_fee_estimates SET lapsed_at = ? WHERE id = ?", [nowStr(), lr.est_id]);
    if (T.autoWithdrawOnLapse) {
      var reason = lw.onExpiry === 'abandoned' ? 'abandoned' : 'estimate_lapsed';
      await run("UPDATE requests SET stage = 'closed', status = 'closed', closure_reason = ?, tickler_flag = ?, tickler_flagged_at = ?, updated_at = datetime('now') WHERE id = ?", [reason, reason, nowStr(), lr.rid]);
      await hist(lr.rid, 'ESTIMATE_LAPSED', 'No response within ' + ldue + '; request auto-' + (lw.onExpiry === 'abandoned' ? 'abandoned' : 'withdrawn') + '.', lr.stage, 'closed');
      actions.withdrawn += 1;
    } else {
      await flagRequest(lr.rid, 'estimate_response_overdue');
      await hist(lr.rid, 'ESTIMATE_LAPSED', 'No response within ' + ldue + '; flagged for follow-up.', null, null);
    }
    actions.estimate_lapsed += 1;
  }

  // (2) Deposit overdue: accepted, in awaiting_payment, unpaid past ITS band's deposit window
  // (per-jurisdiction; falls back to the flat default). Flag only, no auto-close (unchanged behavior).
  var depCandidates = await all(
    "SELECT r.id AS rid, e.config_profile_id, e.total, e.accepted_at FROM requests r JOIN request_fee_estimates e ON e.request_id = r.id " +
    "WHERE r.stage = 'awaiting_payment' AND r.status = 'active' AND e.kind = 'estimate' " +
    "AND e.accepted_at IS NOT NULL AND e.deposit_paid_at IS NULL " +
    "AND COALESCE(r.tickler_flag, '') <> 'deposit_overdue' " +
    "AND NOT EXISTS (SELECT 1 FROM objections o WHERE o.request_id = r.id AND o.status IN ('open','tentative') AND o.clock_frozen = 1) " +
    "AND e.id = (SELECT id FROM request_fee_estimates WHERE request_id = r.id AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1)");
  for (var j = 0; j < depCandidates.length; j++) {
    var dr = depCandidates[j];
    var drCfg = await cfgForEstimate(dr);
    if (drCfg && drCfg.payment_mode === 'erp') continue; // ERP owns dunning; suppress our deposit reminder
    var dw = windowFromPlan(await planForEstimate(dr), T.depositDueDays);
    // A jurisdiction may set its own grace window (TX: 10 business days, § 552.263(f)); otherwise the
    // fee profile's payment band window stands, exactly as before.
    var depPolicy = await PCP.read(null);
    if (depPolicy.deposit_grace_days != null) dw = { days: depPolicy.deposit_grace_days, unit: dw.unit };
    // A grace of 0 is a legitimate setting ("no grace — due on acceptance"), but overdue() treats a falsy
    // day count as "no window" and would never fire. Zero means immediately overdue, not never.
    var isOverdue = (Number(dw.days) === 0) ? !!dr.accepted_at : overdue(dr.accepted_at, dw.days, dw.unit, nowMs);
    if (!isOverdue) continue;
    var windowDesc = dw.days + ' ' + dw.unit + ' days after acceptance';

    // The jurisdiction's lapse rule. `withdraw` closes the request through the CENTRAL stage transition
    // (never a raw UPDATE), and only when the policy is enabled AND attested. Default is flag_only —
    // today's behaviour, unchanged.
    var lapse = { withdrawn: false };
    try { lapse = await depositAction.onDepositLapsed(dr.rid, { actorName: 'system', windowDesc: windowDesc }); } catch (e) {}
    if (lapse.withdrawn) {
      actions.deposit_withdrawn = (actions.deposit_withdrawn || 0) + 1;
      continue; // the request is closed; a tickler flag on a closed request is noise
    }
    await flagRequest(dr.rid, 'deposit_overdue');
    await hist(dr.rid, 'DEPOSIT_OVERDUE', 'Deposit unpaid more than ' + windowDesc + '.', null, null);
    actions.deposit_overdue += 1;
  }

  // (3) General stall: active, non-terminal, untouched longer than the stall window, not already flagged.
  var stallCut = daysAgoStr(T.stallDays);
  var ph = TERMINAL_STAGES.map(function () { return '?'; }).join(',');
  var stalledRows = await all(
    "SELECT id FROM requests WHERE status = 'active' AND stage NOT IN (" + ph + ") AND updated_at < ? AND COALESCE(tickler_flag, '') = '' AND NOT EXISTS (SELECT 1 FROM objections o WHERE o.request_id = requests.id AND o.status IN ('open','tentative') AND o.clock_frozen = 1)",
    TERMINAL_STAGES.concat([stallCut]));
  for (var s = 0; s < stalledRows.length; s++) {
    await flagRequest(stalledRows[s].id, 'stalled');
    await hist(stalledRows[s].id, 'REQUEST_STALLED', 'No activity in more than ' + T.stallDays + ' days.', null, null);
    actions.stalled += 1;
  }

  var scanned = await get("SELECT count(*) AS c FROM requests WHERE status = 'active'");
  var flagged = actions.estimate_lapsed + actions.deposit_overdue + actions.stalled;
  try { var np = await require('./feeNonpayment').sweep(); actions.nonpayment_dunned = np.actions.dunned; actions.nonpayment_closed = np.actions.closed; } catch (e) { console.error('[tickler nonpayment]', e.message); }
  try { var ct = await require('./clarificationTimeout').sweep(); actions.clarification_timeout_closed = ct.actions.closed; } catch (e) { console.error('[tickler clarification-timeout]', e.message); }
  var summary = { thresholds: T, actions: actions };
  await run("INSERT INTO tickler_runs (id, ran_at, trigger, scanned, flagged, summary_json) VALUES (?,?,?,?,?,?)",
    ['tk-' + uuidv4().slice(0, 8), nowStr(), opts.trigger || 'manual', (scanned ? scanned.c : 0), flagged, JSON.stringify(summary)]);
  return { ranAt: nowStr(), scanned: scanned ? scanned.c : 0, flagged: flagged, actions: actions, thresholds: T };
}

async function clearFlag(requestId) {
  await run("UPDATE requests SET tickler_flag = NULL, tickler_flagged_at = NULL WHERE id = ?", [requestId]);
}

var _started = false;
function startScheduler() {
  if (_started) return; _started = true;
  setTimeout(function () { runSweep({ trigger: 'scheduled' }).then(function (r) { console.log('[tickler] startup sweep:', JSON.stringify(r.actions)); }).catch(function (e) { console.error('[tickler]', e.message); }); }, 60000);
  setInterval(function () { runSweep({ trigger: 'scheduled' }).catch(function (e) { console.error('[tickler]', e.message); }); }, 86400000);
  console.log('[tickler] scheduler started (daily)');
}

module.exports = { runSweep: runSweep, clearFlag: clearFlag, startScheduler: startScheduler, DEFAULTS: DEFAULTS, overdue: overdue, windowFromPlan: windowFromPlan };
