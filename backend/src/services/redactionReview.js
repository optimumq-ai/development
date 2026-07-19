'use strict';
// Redaction automation — reviewer task + release gating (SPEC_redaction_automation.md, slice 4).
//
// Review routing (Q2 decision): a mandatory second-person review only for the Elevated and Legal
// dispositions. Simple/Standard self-release unchanged; Bypass never reaches here (auto-released).
//
// Two guarantees:
//   1. gateApply — the HARD rule: an Elevated/Legal job cannot be released (`apply`) until it has been
//      submitted for review AND is released by someone OTHER than the author (submitted_by). This closes
//      today's hole where `apply` ignored review_stage entirely (REDACTION_GROUND_TRUTH §3.2).
//   2. spawnReviewTask — a real routed `redaction_qa` task so a reviewer is actually tasked (pooled to a
//      different holder of the role; author excluded at the gate). Elevated -> REDACTION_WORKER on the
//      request's team; Legal -> legal staff, office-level.
//
// Gating keys off redaction_jobs.disposition: NULL / simple / standard -> ungated (no regression), so this
// is inert until per-file dispositions are populated (slice 3b) or set explicitly.

var { all, get, run } = require('../db');
var GATED = { elevated: 1, legal: 1 };

// Decide whether `applier` (a user id or display name — same expression the routes store in submitted_by)
// may release `job`. Pure. returns { allowed, code, reason }.
function gateApply(job, applier) {
  var disp = job && job.disposition;
  if (!GATED[disp]) return { allowed: true };
  var stage = job.review_stage;
  if (stage == null || stage === 'editing') {
    return { allowed: false, code: 409, reason: 'This ' + disp + ' redaction must be submitted for review before it can be released.' };
  }
  if (stage === 'released') return { allowed: true }; // already released — idempotent no-op
  if (applier != null && job.submitted_by != null && String(applier) === String(job.submitted_by)) {
    return { allowed: false, code: 403, reason: 'A different reviewer must approve this ' + disp + ' redaction before release.' };
  }
  return { allowed: true };
}

// Spawn a redaction_qa review task for an Elevated/Legal job, if one is not already open for the request.
// Pooled (not auto-assigned) so a DIFFERENT reviewer claims it. Idempotent. ctx: { actor }.
async function spawnReviewTask(job, ctx) {
  ctx = ctx || {};
  if (!GATED[job && job.disposition]) return null;
  var existing = await get("SELECT id FROM tasks WHERE request_id = ? AND type = 'redaction_qa' AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [job.request_id]);
  if (existing) return null;
  var reqRow = await get('SELECT department_id FROM requests WHERE id = ?', [job.request_id]);
  var isLegal = job.disposition === 'legal';
  var teamId = isLegal ? null : (reqRow && reqRow.department_id) || null; // legal = office-level; elevated = team
  var taskRouting = require('./taskRouting'); // lazy require avoids any load-order coupling
  // ELEVATED REVIEW: `redaction_qa` if the team has actually been granted it, else the legacy
  // REDACTION_WORKER role (2026-07-19, brief §3.5). `redaction_qa` was excluded from ROUTABLE_TASK_TYPES, so
  // it was pinned to legacy routing forever while its Legal sibling used the v3 model — and reviewing
  // someone else's redaction resolved to the SAME token as doing one, conflating "can redact" with "can
  // review another's redaction".
  //
  // Choosing the token at SPAWN time is what makes the cutover safe. Granting a person `redaction_qa` now
  // takes effect; granting nobody changes nothing, so this cannot strand the mandatory second review —
  // which, if it stranded, would block release of every Elevated redaction.
  var role = isLegal
    ? 'legal_redaction'
    : ((await taskRouting.hasSeededType('redaction_qa', teamId)) ? 'redaction_qa' : 'REDACTION_WORKER');
  return await taskRouting.createTask({
    requestId: job.request_id, type: 'redaction_qa', roleRequired: role, teamId: teamId,
    title: (isLegal ? 'Legal review before release' : 'Review redaction before release'),
    createdBy: ctx.actor || 'system'
  });
}

// Reviewer approved & released -> close the open review task(s) for the request, but ONLY when no other
// gated job on the request is still awaiting review. The qa task is per-request while jobs are per-file:
// closing it on the first release would strand a second Elevated/Legal file with no reviewer tasked.
async function completeReviewTask(requestId) {
  var pending = await get(
    "SELECT id FROM redaction_jobs WHERE request_id = ? AND disposition IN ('elevated','legal') " +
    "AND review_stage IN ('pending_review','in_review') LIMIT 1", [requestId]);
  if (pending) return { closed: false, pendingJobId: pending.id };
  await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE request_id = ? AND type = 'redaction_qa' AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [requestId]);
  return { closed: true };
}

// Reviewer sent it back to the author -> cancel the review task; a fresh one spawns when the author re-submits.
async function closeReviewTask(requestId) {
  await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE request_id = ? AND type = 'redaction_qa' AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [requestId]);
}

module.exports = { gateApply: gateApply, spawnReviewTask: spawnReviewTask, completeReviewTask: completeReviewTask, closeReviewTask: closeReviewTask, GATED: GATED };
