'use strict';
// Tickler: a time-driven sweep that FLAGS requests on overdue clocks (it does not auto-close by default).
// Three clocks: (1) estimate-response lapse, (2) deposit overdue, (3) general stall. Each is idempotent
// (won't re-flag/re-log) and writes a request_history entry. Runs on a daily setInterval + a manual endpoint.

var db = require('../db');
var all = db.all, get = db.get, run = db.run;
var uuidv4 = require('uuid').v4;

var DEFAULTS = { requesterResponseDays: 10, depositDueDays: 10, stallDays: 21, autoWithdrawOnLapse: false };
var TERMINAL_STAGES = ['delivery', 'closed'];

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function daysAgoStr(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' '); }

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
  var T = await thresholds();
  var actions = { estimate_lapsed: 0, deposit_overdue: 0, stalled: 0, withdrawn: 0 };

  // (1) Estimate-response lapse: latest sent estimate not accepted/declined, older than the response window.
  var lapseCut = daysAgoStr(T.requesterResponseDays);
  var lapsedRows = await all(
    "SELECT e.id AS est_id, e.request_id AS rid, r.stage AS stage FROM request_fee_estimates e " +
    "JOIN requests r ON r.id = e.request_id " +
    "WHERE e.kind = 'estimate' AND e.notified_at IS NOT NULL AND e.accepted_at IS NULL AND e.declined_at IS NULL " +
    "AND e.lapsed_at IS NULL AND e.notified_at < ? AND r.status = 'active' " +
    "AND e.id = (SELECT id FROM request_fee_estimates WHERE request_id = r.id AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1)",
    [lapseCut]);
  for (var i = 0; i < lapsedRows.length; i++) {
    var lr = lapsedRows[i];
    await run("UPDATE request_fee_estimates SET lapsed_at = ? WHERE id = ?", [nowStr(), lr.est_id]);
    if (T.autoWithdrawOnLapse) {
      await run("UPDATE requests SET stage = 'closed', status = 'closed', closure_reason = 'estimate_lapsed', tickler_flag = 'estimate_lapsed', tickler_flagged_at = ?, updated_at = datetime('now') WHERE id = ?", [nowStr(), lr.rid]);
      await hist(lr.rid, 'ESTIMATE_LAPSED', 'No response within ' + T.requesterResponseDays + ' days; request auto-withdrawn.', lr.stage, 'closed');
      actions.withdrawn += 1;
    } else {
      await flagRequest(lr.rid, 'estimate_response_overdue');
      await hist(lr.rid, 'ESTIMATE_LAPSED', 'No response within ' + T.requesterResponseDays + ' days; flagged for follow-up.', null, null);
    }
    actions.estimate_lapsed += 1;
  }

  // (2) Deposit overdue: accepted estimate, sitting in awaiting_payment, unpaid past the deposit window.
  var depCut = daysAgoStr(T.depositDueDays);
  var depRows = await all(
    "SELECT r.id AS rid FROM requests r JOIN request_fee_estimates e ON e.request_id = r.id " +
    "WHERE r.stage = 'awaiting_payment' AND r.status = 'active' AND e.kind = 'estimate' " +
    "AND e.accepted_at IS NOT NULL AND e.deposit_paid_at IS NULL AND e.accepted_at < ? " +
    "AND COALESCE(r.tickler_flag, '') <> 'deposit_overdue'",
    [depCut]);
  for (var j = 0; j < depRows.length; j++) {
    await flagRequest(depRows[j].rid, 'deposit_overdue');
    await hist(depRows[j].rid, 'DEPOSIT_OVERDUE', 'Deposit unpaid more than ' + T.depositDueDays + ' days after acceptance.', null, null);
    actions.deposit_overdue += 1;
  }

  // (3) General stall: active, non-terminal, untouched longer than the stall window, not already flagged.
  var stallCut = daysAgoStr(T.stallDays);
  var ph = TERMINAL_STAGES.map(function () { return '?'; }).join(',');
  var stalledRows = await all(
    "SELECT id FROM requests WHERE status = 'active' AND stage NOT IN (" + ph + ") AND updated_at < ? AND COALESCE(tickler_flag, '') = ''",
    TERMINAL_STAGES.concat([stallCut]));
  for (var s = 0; s < stalledRows.length; s++) {
    await flagRequest(stalledRows[s].id, 'stalled');
    await hist(stalledRows[s].id, 'REQUEST_STALLED', 'No activity in more than ' + T.stallDays + ' days.', null, null);
    actions.stalled += 1;
  }

  var scanned = await get("SELECT count(*) AS c FROM requests WHERE status = 'active'");
  var flagged = actions.estimate_lapsed + actions.deposit_overdue + actions.stalled;
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

module.exports = { runSweep: runSweep, clearFlag: clearFlag, startScheduler: startScheduler, DEFAULTS: DEFAULTS };
