'use strict';
// PHASE 7 / BW4 — THE ESTIMATE TASK'S PAUSE (DRAFT_processing_ui_estimate.md §0, §4.1).
//
// ══ THE DECIDED ASYMMETRY (Kevin, 2026-07-28, §5 open question 2 — RESOLVED) ══
//
//   VAGUE PAUSES.        "You can't price what you can't parse." The estimator who cannot scope the request
//                        has just DISCOVERED the vagueness; leaving the task actionable would leave a
//                        person staring at a builder they cannot fill in. And vague never waits for an
//                        estimate — in runs-no-stop states, delay burns clock.
//   OVERLY BROAD DOES NOT. "Too large is not a mark anywhere — it IS the estimate." Most states handle
//                        volume economically (TX: itemized estimate § 552.2615, deposit § 552.263, 36-hour
//                        cap § 552.275 — no burden-denial ground exists), and the acceptance gate
//                        (proceed / narrow / withdraw) is the narrowing conversation. Stay and estimate.
//                        Where a burden denial ground DOES exist (IL unduly-burdensome), the
//                        conference-before-denial gate belongs on Denial compose with this estimate as its
//                        evidence — not here.
//
// ══ WHY A NULLABLE MARKER AND NOT A `paused` STATUS ══
//
// Every actionable-task query in this codebase is spelled `status IN ('open','assigned','in_progress',
// 'returned','awaiting_review')` — in the queue, the router, the close-on-route path, the notice/send sweep
// that CLOSES the estimate task when the notice goes out. A new status value would silently drop a paused
// task out of all of them, including the sweep that closes it: the task would be unclosable, and the
// request would strand behind a task nobody could finish. That is the exact failure the hard rule forbids.
//
// So the pause is a marker BESIDE the status. Everything that does not read it behaves precisely as before,
// every pre-existing row reads as not-paused, and the resume path works on a task paused before this
// shipped as well as after. What the marker buys is a screen that refuses to let you price a request whose
// meaning is currently in the post.
var db = require('../db');
var get = db.get, all = db.all, run = db.run;
var uuidv4 = require('uuid').v4;

var ACTIONABLE = "('open','assigned','in_progress','returned','awaiting_review')";
// Estimate work only. Record search has its own clarification affordance and its own screen; widening this
// to every open task would pause work that a clarification does not block.
var PAUSABLE_TYPES = ['estimate', 'mrr_estimate'];

// The pause state of a task row, in the screen's vocabulary. Pure — takes the row it was given.
function stateOf(taskRow) {
  if (!taskRow || !taskRow.paused_at) return { paused: false };
  return {
    paused: true,
    at: taskRow.paused_at,
    reason: taskRow.paused_reason || null,
    by: taskRow.paused_by || null,
    // The words the screen prints. They live here, next to the condition, rather than in a frontend switch
    // that drifts from it — the same rule proceedGate's sentences follow.
    text: taskRow.paused_reason === 'vague'
      ? 'This estimate is paused: the request was marked VAGUE and a clarification is with the requestor. ' +
        'You cannot price what you cannot parse — the estimate resumes when they reply.'
      : 'This estimate is paused pending the requestor’s response.'
  };
}

// Pause every open estimate task on a request. Returns the number paused. Never throws: a clarification
// must not fail to send because a task could not be marked.
async function pauseForRequest(requestId, reason, opts) {
  opts = opts || {};
  var n = 0;
  try {
    var ph = PAUSABLE_TYPES.map(function () { return '?'; }).join(',');
    var rows = await all('SELECT id FROM tasks WHERE request_id = ? AND type IN (' + ph + ') AND status IN ' +
      ACTIONABLE + ' AND paused_at IS NULL', [requestId].concat(PAUSABLE_TYPES));
    for (var i = 0; i < rows.length; i++) {
      await run("UPDATE tasks SET paused_at = datetime('now'), paused_reason = ?, paused_by = ?, updated_at = datetime('now') WHERE id = ?",
        [reason || null, opts.actorName || 'Staff', rows[i].id]);
      n++;
    }
    if (n) {
      await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
        [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'Staff', 'ESTIMATE_TASK_PAUSED',
         n + ' estimate task(s) paused pending the requestor’s response' + (reason ? ' (' + reason + ')' : '') +
         '. The task remains claimable and closable — only the estimate builder is held.']);
    }
  } catch (e) { console.error('[taskPause pauseForRequest]', requestId, e && e.message); }
  return n;
}

// Resume every paused estimate task on a request. Deliberately NOT restricted to tasks this process paused:
// a task paused before a reply arrives — including one paused by an earlier deploy, or by a different
// person — must resume on the reply. That is the whole "must not strand" requirement.
async function resumeForRequest(requestId, opts) {
  opts = opts || {};
  var n = 0;
  try {
    var rows = await all('SELECT id FROM tasks WHERE request_id = ? AND paused_at IS NOT NULL', [requestId]);
    for (var i = 0; i < rows.length; i++) {
      await run("UPDATE tasks SET paused_at = NULL, paused_reason = NULL, paused_by = NULL, updated_at = datetime('now') WHERE id = ?", [rows[i].id]);
      n++;
    }
    if (n) {
      await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
        [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'Staff', 'ESTIMATE_TASK_RESUMED',
         n + ' estimate task(s) resumed' + (opts.note ? ' — ' + opts.note : '.')]);
    }
  } catch (e) { console.error('[taskPause resumeForRequest]', requestId, e && e.message); }
  return n;
}

async function isPaused(taskId) {
  var t = await get('SELECT paused_at FROM tasks WHERE id = ?', [taskId]);
  return !!(t && t.paused_at);
}

module.exports = {
  PAUSABLE_TYPES: PAUSABLE_TYPES,
  stateOf: stateOf, pauseForRequest: pauseForRequest, resumeForRequest: resumeForRequest, isPaused: isPaused
};
