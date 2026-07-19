'use strict';
// Auto-close on nonpayment (Financial Profile phase 3d). OPT-IN per jurisdiction (nonpaymentClose
// config). Targets the COMPLETION-phase unpaid states (awaiting_final / released_payment_due) that the
// tickler's pre-work lapse logic does not cover. Sends one dunning reminder at reminderDays, then
// closes for nonpayment after windowDays if still unpaid. Closed requests are RE-OPENABLE. Held
// records stay held on close unless the jurisdiction sets publishOnClose.
var db = require('../db');
var ps = require('./paymentStatus');
var feeNotice = require('./feeNotice');
var email = require('./email');
var uuidv4 = require('uuid').v4;
var scope = require('./requestScope');
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function parseTs(s) { return s ? new Date(String(s).replace(' ', 'T') + (/[zZ]|[+\-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) : null; }
function daysSince(s, now) { var d = parseTs(s); return d ? Math.floor((now.getTime() - d.getTime()) / 86400000) : null; }

async function nonpaymentConfig() {
  var row = await db.get("SELECT config_json FROM fee_profiles WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1");
  var cfg = {}; try { cfg = JSON.parse((row && row.config_json) || '{}'); } catch (e) {}
  var np = cfg.nonpaymentClose || {};
  var ag = await db.get("SELECT value FROM system_config WHERE key = 'agency_name'");
  return { enabled: !!np.enabled, windowDays: Number(np.windowDays) || 30, reminderDays: Number(np.reminderDays) || 15, publishOnClose: !!np.publishOnClose, agencyName: (ag && ag.value) || 'the City' };
}

// ⚠️ THE SECOND HALF OF THE SAME DEFECT (fixed 2026-07-19 with the computeSituation tree fix).
//
// This is the dunning CLOCK, and it decides whether the sweep proceeds at all: no invoice date, no dunning.
// It read `WHERE request_id = <parent>`, but `notified_at` is stamped on the estimate — which every UI path
// writes against the CHILD. So even once `computeSituation` could SEE the money, the sweep still hit
// `if (!start) continue;` and did nothing. Fixing only the first half would have looked right, tested green
// on `hasEstimate`, and still never sent an email — which is why the harness now drives the whole sweep.
//
// Scoped over the tree, and MAX() across it: the clock starts at the LATEST notice, so a citizen invoiced
// again for a later component is not dunned on the strength of the first component's date.
async function clockStart(rid) {
  var ids = await ps.moneyTreeIds(rid);
  var ph = ids.map(function () { return '?'; }).join(',');
  var row = await db.get("SELECT MAX(notified_at) AS n FROM request_fee_estimates WHERE request_id IN (" + ph + ") AND notified_at IS NOT NULL", ids);
  return row && row.n ? row.n : null;
}

async function sendDunning(rid, req, sit, cfg) {
  var bal = Math.max(0, Math.round(((Number(sit.effectiveTotal) || 0) - (Number(sit.totalPaid) || 0)) * 100) / 100);
  var notice = feeNotice.buildDunningNotice(req, { balanceDue: bal, closeByDays: Math.max(1, cfg.windowDays - cfg.reminderDays) }, { agencyName: cfg.agencyName });
  if (req.requestor_email) { try { await email.send({ to: req.requestor_email, subject: notice.subject, text: notice.text }); } catch (e) { console.error('[dunning email]', e.message); } }
  await db.run("UPDATE requests SET nonpayment_dunning_at = ? WHERE id = ?", [nowStr(), rid]);
  await ps.recordEvent(rid, { type: 'dunning', reason: 'payment reminder sent', actor: 'system' });
}

// ARCHITECTURE item 6: every stage change goes through the ONE central transition, which ALWAYS writes
// request_history (with stage_from/stage_to) and spawns/cancels the stage's task. These two functions used
// to write `UPDATE requests SET stage = 'closed'` directly — an unlogged jump that left the request's open
// tasks CLAIMABLE in the pools. Fixed 2026-07-13.
async function closeForNonpayment(rid, cfg) {
  cfg = cfg || await nonpaymentConfig();
  await require('./taskRouting').applyStageTransition(rid, 'closed', {
    actorName: 'System', action: 'CLOSED_NONPAYMENT',
    notes: 'Closed for nonpayment after a dunning reminder and the configured window. Re-openable.'
  });
  await db.run("UPDATE requests SET closure_reason = 'nonpayment', updated_at = ? WHERE id = ?", [nowStr(), rid]);
  if (cfg.publishOnClose) { try { await db.run("UPDATE fulfilled_records SET status = 'released', released_at = COALESCE(released_at, ?) WHERE request_id = ? AND status = 'held'", [nowStr(), rid]); } catch (e) {} }
  await ps.recordEvent(rid, { type: 'closed', reason: 'closed for nonpayment', actor: 'system' });
}

async function reopen(rid, actor) {
  var r = await db.get("SELECT status, closure_reason FROM requests WHERE id = ?", [rid]);
  if (!r || r.status !== 'closed' || !/nonpayment/i.test(r.closure_reason || '')) throw new Error('This request is not closed for nonpayment.');
  // The raw UPDATE this replaces was the worse half of the bug: a reopened request landed back in
  // awaiting_payment with NO stage task, so it was live again but invisible to every worklist.
  await db.run("UPDATE requests SET closure_reason = NULL, nonpayment_dunning_at = NULL WHERE id = ?", [rid]);
  await require('./taskRouting').applyStageTransition(rid, 'awaiting_payment', {
    actorName: actor || 'Staff', action: 'REOPENED_NONPAYMENT',
    notes: 'Reopened after closure for nonpayment.'
  });
  await ps.recordEvent(rid, { type: 'reopened', reason: 'reopened for late payment', actor: actor || 'staff' });
  return { reopened: true };
}

// The sweep: dunning at reminderDays, close at windowDays. opts.now / opts.config for testing.
async function sweep(opts) {
  opts = opts || {};
  var cfg = opts.config || await nonpaymentConfig();
  var actions = { dunned: 0, closed: 0 };
  if (!cfg.enabled) return { enabled: false, actions: actions };
  var now = opts.now ? new Date(opts.now) : new Date();
  // PARENT: money is parent-level. Unscoped, this loop would run once per CHILD and once per PARENT —
  // sending the citizen DUPLICATE DUNNING EMAILS. The most user-visible failure in the whole migration.
  var rows = await db.all("SELECT r.id FROM requests r WHERE r.status = 'active' AND r.request_number != 'LIBRARY'" + scope.andParent('r'));
  for (var i = 0; i < rows.length; i++) {
    var rid = rows[i].id;
    var sit = await ps.computeSituation(rid);
    if (!sit.hasEstimate) continue;
    var status = ps.deriveStatus(sit);
    if (status.current !== 'awaiting_final' && status.current !== 'released_payment_due') continue;
    var start = await clockStart(rid);
    if (!start) continue; // never invoiced -> no clock
    var days = daysSince(start, now);
    if (days == null) continue;
    var req = await db.get("SELECT id, requestor_email, requestor_name, request_number, nonpayment_dunning_at FROM requests WHERE id = ?", [rid]);
    if (days >= cfg.windowDays && req.nonpayment_dunning_at) { await closeForNonpayment(rid, cfg); actions.closed += 1; }
    else if (days >= cfg.reminderDays && !req.nonpayment_dunning_at) { await sendDunning(rid, req, sit, cfg); actions.dunned += 1; }
  }
  return { enabled: true, actions: actions };
}

module.exports = { sweep: sweep, closeForNonpayment: closeForNonpayment, reopen: reopen, nonpaymentConfig: nonpaymentConfig };
