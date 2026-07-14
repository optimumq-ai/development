'use strict';
// Auto-close for the `clarification-timeout` workflow node (SPEC_record_search_task_screen.md §5b;
// CLARIFICATION_POLICY_SURVEY.md §2.2). A vague request was sent back for clarification and the
// requestor went silent; past the grace window (+ optional safety buffer) the request is closed as
// "withdrawn (no clarification)". This is the last backend piece of the clarification workflow.
//
// SAFETY GATE (AUTO_CONFIG, same as the slice-2 trigger): a request is auto-closed ONLY when the
// clarification policy is enabled AND its jurisdiction-profile section is attested
// (clarificationPolicy.automationActive), the jurisdiction actually configured a grace period
// (clarification_grace_days is a positive int — statute-silent/null never auto-closes), AND
// abandonment_closure permits it. Otherwise the sweep is a no-op — the request just waits for staff.
//
// Runs inside the daily tickler sweep (sibling of feeNonpayment.sweep). No direct clock work here;
// closure goes through the central taskRouting.applyStageTransition so history + tickler-flag clearing
// stay centralized. closure_notice_required is FLAGGED in the note (a written notice is owed) but not
// auto-sent — that outreach is a separate follow-up.
var db = require('../db');
var CA = require('./clarificationAction');
var taskRouting = require('./taskRouting');
var scope = require('./requestScope');

function parseTs(s) { return s ? new Date(String(s).replace(' ', 'T') + (/[zZ]|[+\-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) : null; }
function daysSince(s, now) { var d = parseTs(s); return d ? Math.floor((now.getTime() - d.getTime()) / 86400000) : null; }
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

var CLOSURE_REASON = 'no_clarification';
var CLOSURE_OK = { allowed: true, via_denial: true }; // not_allowed / unspecified never auto-close

// Resolve the closure policy for the active jurisdiction. Reuses the slice-2 automation gate so the
// grace window and the tolling trigger stay in lockstep on the same enable+attest switch.
async function timeoutConfig() {
  var st = await CA.automationState(); // { jid, policy, attested, active }
  var p = st.policy || {};
  var grace = parseInt(p.clarification_grace_days, 10);
  var buffer = parseInt(p.abandonment_grace_days, 10);
  var ag = await db.get("SELECT value FROM system_config WHERE key = 'agency_name'");
  return {
    active: st.active,
    graceDays: grace > 0 ? grace : null,
    bufferDays: buffer > 0 ? buffer : 0,
    closure: p.abandonment_closure || 'unspecified',
    noticeRequired: !!p.closure_notice_required,
    agencyName: (ag && ag.value) || 'the City',
    // The full silence window before auto-close = requestor grace + internal safety buffer.
    thresholdDays: (grace > 0) ? (grace + (buffer > 0 ? buffer : 0)) : null
  };
}

// Requests with an OUTSTANDING clarification: latest CLARIFICATION_REQUESTED is newer than the latest
// CLARIFICATION_RECEIVED (or there is no reply at all), and the request is still active.
// PARENT/CHILD (spec §6.2, answered by Kevin 2026-07-14). Two different rows are involved and conflating
// them is how this sweep would destroy data after the migration:
//
//   - The clarification EVENT is logged on the WORK row (the child): it was that record's description that
//     was too vague. So we search LEAF rows.
//   - The CLOSURE is a PARENT-level terminal event that CASCADES DOWN. An unanswered clarification withdraws
//     the WHOLE REQUEST — Tex. Gov't Code § 552.222(d): "the underlying request for public information is
//     considered to have been withdrawn by the requestor." It does not close one record and leave the rest
//     of the citizen's request half-alive.
//
// `close_target` is therefore the PARENT of the work row. Today `master_request_id` is NULL, so COALESCE
// resolves to the row itself and this is a provable no-op; after the migration it closes the parent, which
// cascades to every child. This sweep AUTO-CLOSES, so an unscoped version would have been the single most
// destructive query in the migration.
async function pendingClarifications() {
  return await db.all(
    "SELECT r.id, COALESCE(r.master_request_id, r.id) AS close_target, r.request_number, r.stage, r.requestor_name, " +
    "MAX(CASE WHEN h.action = 'CLARIFICATION_REQUESTED' THEN h.created_at END) AS sent_at, " +
    "MAX(CASE WHEN h.action = 'CLARIFICATION_RECEIVED'  THEN h.created_at END) AS replied_at " +
    "FROM requests r JOIN request_history h ON h.request_id = r.id " +
    "WHERE r.status = 'active' AND r.request_number != 'LIBRARY' " +
    "AND h.action IN ('CLARIFICATION_REQUESTED','CLARIFICATION_RECEIVED') " +
    scope.andLeaf('r') + " " +
    "GROUP BY r.id, r.master_request_id, r.request_number, r.stage, r.requestor_name " +
    "HAVING MAX(CASE WHEN h.action = 'CLARIFICATION_REQUESTED' THEN h.created_at END) IS NOT NULL"
  );
}

// Close the PARENT, not the work row (spec §6.2). Tex. Gov't Code § 552.222(d): an unanswered clarification
// withdraws "the underlying request", not one record of it. `close_target` is the parent — today that IS the
// row itself (master_request_id is NULL), so this is a no-op; after the migration it closes the parent and
// cascades to every child, instead of leaving the citizen's request half-alive.
async function closeForNoClarification(row, cfg, elapsed) {
  var target = row.close_target || row.id;
  var note = 'Auto-closed: no clarification received ' + elapsed + ' days after the request was sent (grace '
    + cfg.graceDays + (cfg.bufferDays ? ' + ' + cfg.bufferDays + ' buffer' : '') + ' days).'
    + (cfg.noticeRequired ? ' A written closure notice is required — please send one.' : '');
  await taskRouting.applyStageTransition(target, 'closed', {
    actorId: null, actorName: 'System', action: 'CLOSED_NO_CLARIFICATION', notes: note
  });
  await db.run("UPDATE requests SET closure_reason = ?, updated_at = ? WHERE id = ?", [CLOSURE_REASON, nowStr(), target]);
}

// The sweep. opts.now / opts.config for testing; opts.dryRun lists candidates without closing.
async function sweep(opts) {
  opts = opts || {};
  var cfg = opts.config || await timeoutConfig();
  var actions = { closed: 0 };
  var candidates = [];
  // Guard: only act when automation is live AND a grace period is configured AND closure is permitted.
  var eligible = cfg.active && cfg.thresholdDays != null && !!CLOSURE_OK[cfg.closure];
  if (!eligible) return { enabled: false, reason: !cfg.active ? 'automation_inactive' : (cfg.thresholdDays == null ? 'no_grace_configured' : 'closure_not_permitted'), actions: actions, candidates: candidates };

  var now = opts.now ? new Date(opts.now) : new Date();
  var rows = await pendingClarifications();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    // Outstanding = a reply hasn't landed since the most recent send.
    if (row.replied_at && String(row.replied_at) >= String(row.sent_at)) continue;
    var elapsed = daysSince(row.sent_at, now);
    if (elapsed == null) continue;
    candidates.push({ id: row.id, requestNumber: row.request_number, sentAt: row.sent_at, elapsedDays: elapsed });
    if (elapsed < cfg.thresholdDays) continue;
    if (opts.dryRun) continue;
    await closeForNoClarification(row, cfg, elapsed);
    actions.closed += 1;
  }
  return { enabled: true, thresholdDays: cfg.thresholdDays, noticeRequired: cfg.noticeRequired, actions: actions, candidates: candidates };
}

module.exports = { sweep: sweep, timeoutConfig: timeoutConfig, closeForNoClarification: closeForNoClarification, pendingClarifications: pendingClarifications };
