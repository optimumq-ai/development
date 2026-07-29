'use strict';
// PHASE 7 / BW2 — INTAKE REVIEW: the trigger-spawned first look, and the retirement of `routing_review`.
//
// Implements docs/DRAFT_processing_ui_intake_review.md §0 decision 5 + §4 (spawn side only — the screen is
// BW3's). The task type itself is registered in taskRouting.TASK_ROLES / ROUTABLE_TASK_TYPES.
//
// ══ WHAT REPLACED WHAT ══
//
// `routing_review` was one task with one trigger: the classifier could not determine a fulfillment team.
// Decision 5 generalises that into a trigger LIST on ONE task — "can't route" becomes trigger (i) of
// intake review rather than a task of its own. So this module is a 1:1 replacement on that path:
//
//   same trigger (teamId null)  ·  same office-level, team-agnostic routing  ·  same ORO Associate
//   same idempotency (one open task per request)  ·  same auto-close when the request is re-routed
//
// The retirement is of the SPAWNERS, not of the key: `routing_review` stays in TASK_ROLES and the
// close-on-route path still closes it, so tasks already in flight when this ships remain claimable and
// resolvable. Nothing creates a new one.
//
// ══ WHICH TRIGGERS ARE ACTUALLY WIRED (and why the others are not, yet) ══
//
// The enum below is the whole decided list, because the value it records has to be stable from the first
// task written. What is WIRED is deliberately narrower — a trigger is wired only where the signal exists
// today AND firing it does not change what a default install does:
//
//   unroutable        WIRED. Exactly today's routing_review condition. 1:1, no behaviour change.
//   approval_pending  WIRED. approvalModules already decides this (`needs_decision` + mode
//                     `intake_review`), and in that mode it deliberately spawns NO task because "the
//                     intake reviewer decides inline" — a reviewer who, until now, had no task to decide
//                     it on. So the decision was being dropped. Safe by default: the shipped defaults are
//                     fee_waiver=routed_task and commercial_rate=disabled, so this fires only where a city
//                     explicitly chose intake_review mode.
//   eligibility_review NOT WIRED. The findings persist as PROSE history notes today; draft §4.5 makes the
//                     structured {blocks, reviews, advisories} read a BW3 deliverable, and it is needed at
//                     SPAWN time, not just render time. Wiring it against a history-note action string
//                     would be a guess dressed as a signal.
//   sensitivity_flag  NOT WIRED. The signal exists (workflow_decisions.flags — SENSITIVE / LEGAL_HOLD /
//                     ONGOING_INVESTIGATION, the same list legal redaction escalates on), but those flags
//                     are common, so wiring it would stop a meaningful share of ordinary traffic at a
//                     screen that does not exist yet. WHICH flags should stop a request is a Kevin
//                     question, not an inference. BW3.
//   reopen_retriage   ENUM STUB ONLY. The Director's reopen-to-retriage path is BW5's (Draft 8 rev-2
//                     hybrid); the key exists so BW5 records it rather than inventing a sixth spelling.
//
// ══ MRR ══
//
// Decision 3 says MRR requests do not spawn intake review — their intake is the Request-Manager flow. That
// is honoured for the DISCRETIONARY triggers. It is deliberately NOT honoured for `unroutable`: an
// unroutable MRR child today gets a routing_review, and dropping that stop would leave a child nobody can
// route with nobody looking at it — silently, which is the exact failure trigger (i) exists to prevent.
// The MRR hub (BW6) is where that stop should eventually live; until it has a screen, the stop stays where
// it works. Recorded here rather than left to be rediscovered.
var db = require('../db');
var get = db.get, all = db.all, run = db.run;

var TYPE = 'intake_review';
// The decided trigger vocabulary (draft §0 decision 5). Order is the draft's (i)…(v).
var TRIGGERS = ['unroutable', 'eligibility_review', 'approval_pending', 'sensitivity_flag', 'reopen_retriage'];
// Wired today — see the header. Everything else is recordable but nothing raises it yet.
var WIRED_TRIGGERS = ['unroutable', 'approval_pending'];
var TRIGGER_LABELS = {
  unroutable: 'The fulfillment team could not be determined',
  eligibility_review: 'An eligibility finding needs a human decision',
  approval_pending: 'A fee-waiver or commercial-rate decision is pending',
  sensitivity_flag: 'The request carries a sensitivity flag',
  reopen_retriage: 'Reopened and sent back for re-triage'
};
var ACTIONABLE = "('open','assigned','in_progress','returned','awaiting_review')";

function normalizeTriggers(t) {
  var arr = Array.isArray(t) ? t : (t ? [t] : []);
  var out = [];
  arr.forEach(function (x) { if (TRIGGERS.indexOf(x) >= 0 && out.indexOf(x) < 0) out.push(x); });
  return out;
}

// The trigger keys recorded on a task row. Tolerant: a legacy row (or a hand-inserted one) has none, and
// "no recorded trigger" must never read as "some trigger I do not know about".
function triggersOf(taskRow) {
  if (!taskRow || !taskRow.spawn_triggers) return [];
  try { return normalizeTriggers(JSON.parse(taskRow.spawn_triggers)); } catch (e) { return []; }
}

async function openTask(requestId) {
  return await get("SELECT * FROM tasks WHERE request_id = ? AND type = '" + TYPE + "' AND status IN " + ACTIONABLE +
    ' ORDER BY created_at LIMIT 1', [requestId]);
}

// Any legacy routing_review still open on this request. Kept as its own reader so the retirement's
// "in-flight tasks keep working" promise has one place to change when they are finally all gone.
async function openLegacyRoutingReview(requestId) {
  return await get("SELECT * FROM tasks WHERE request_id = ? AND type = 'routing_review' AND status IN " + ACTIONABLE +
    ' ORDER BY created_at LIMIT 1', [requestId]);
}

var TITLES = {
  unroutable: 'Intake review — team could not be determined',
  approval_pending: 'Intake review — decide the requested fee waiver / rate',
  eligibility_review: 'Intake review — confirm requester eligibility',
  sensitivity_flag: 'Intake review — sensitivity flag raised',
  reopen_retriage: 'Intake review — reopened for re-triage'
};
function titleFor(triggers, override) {
  if (override) return override;
  for (var i = 0; i < triggers.length; i++) { if (TITLES[triggers[i]]) return TITLES[triggers[i]]; }
  return 'Intake review';
}

// Raise (or extend) the intake-review task for a request.
//
// IDEMPOTENT AND ADDITIVE. One open intake review per request — a second trigger firing does not make a
// second task, it ADDS ITS KEY to the one that exists. That matters for the close rule below: a task
// raised because the team was undeterminable AND a waiver is pending is not finished by routing alone.
//
// A legacy `routing_review` still open on the request counts as the intake stop already existing — the
// point of the retirement is one stop, not two overlapping ones, and stacking a new type on top of an old
// one mid-migration would produce exactly the double stop it removes.
//
// Never throws: a request must not fail to be created or classified because its review task could not be
// raised. Returns { task, created, addedTriggers } or null.
async function spawn(requestId, triggers, opts) {
  opts = opts || {};
  var want = normalizeTriggers(triggers);
  // No trigger and no `always` mode means nothing asked for this stop.
  if (!requestId || (!want.length && !opts.allowNoTrigger)) return null;
  try {
    var legacy = await openLegacyRoutingReview(requestId);
    if (legacy) return { task: legacy, created: false, addedTriggers: [], legacy: true };

    var existing = await openTask(requestId);
    var tr = require('./taskRouting');
    if (existing) {
      var have = triggersOf(existing);
      var added = want.filter(function (t) { return have.indexOf(t) < 0; });
      if (added.length) {
        await run("UPDATE tasks SET spawn_triggers = ?, updated_at = datetime('now') WHERE id = ?",
          [JSON.stringify(have.concat(added)), existing.id]);
      }
      return { task: await tr.getTask(existing.id), created: false, addedTriggers: added };
    }

    var reqRow = await get('SELECT description FROM requests WHERE id = ?', [requestId]);
    var task = await tr.createTask({
      requestId: requestId, type: TYPE, title: titleFor(want, opts.title),
      // Office-level work: team-agnostic, pooled to whoever holds `intake_review`, exactly as
      // routing_review was.
      teamId: null, createdBy: opts.createdBy || 'system', spawnTriggers: want
    });
    var text = opts.requestText || (reqRow && reqRow.description) || null;
    if (opts.awaitRouting) { await tr.autoRouteOrPool(task.id, text, {}); }
    else { tr.autoRouteOrPool(task.id, text, {}).catch(function (e) { console.error('[intakeReview route]', e && e.message); }); }
    return { task: await tr.getTask(task.id), created: true, addedTriggers: want };
  } catch (e) {
    console.error('[intakeReview spawn]', requestId, e && e.message);
    return null;
  }
}

// Is this request part of a multi-record submission? `is_mrr` is DERIVED and PARENT-level (§4.1) — a
// child always carries 0 — so the question has to be asked of the parent.
async function isMrr(requestId) {
  var r = await get('SELECT is_mrr, master_request_id FROM requests WHERE id = ?', [requestId]);
  if (!r) return false;
  if (Number(r.is_mrr) === 1) return true;
  if (!r.master_request_id) return false;
  var p = await get('SELECT is_mrr FROM requests WHERE id = ?', [r.master_request_id]);
  return !!(p && Number(p.is_mrr) === 1);
}

// THE `always` MODE (knob `intake_review_mode`, services/processingConfig.js).
//
// "Every non-MRR request pauses at intake review" (draft decision 5 + decision 3). Called at the end of
// intake, AFTER the trigger evaluations, so a request that already has a stop simply keeps it — spawn()
// is additive and idempotent, and a triggered task must not be replaced by an untriggered one that would
// lose the "why it's here" line.
//
// MRR is excluded here (decision 3): a multi-record submission's intake is the Request-Manager flow, and
// it now has its own `mrr_management` task. That exclusion is safe in a way the `unroutable` one is not —
// nothing is dropped, because the MRR parent has an owner either way.
//
// `when_needed` (the default, and today's behaviour) returns null and touches nothing.
async function spawnForMode(requestId, opts) {
  opts = opts || {};
  try {
    var PC = require('./processingConfig');
    if (!(await PC.intakeReviewAlways(opts.jurisdictionId || null))) return null;
    if (await isMrr(requestId)) return null;
    // No trigger fired — the city asked for the stop, and that is recorded as an EMPTY trigger list
    // rather than a missing one, so the queue can say "always mode" and the close rule can tell the two
    // apart.
    return await spawn(requestId, [], Object.assign({ allowNoTrigger: true, title: 'Intake review' }, opts));
  } catch (e) {
    console.error('[intakeReview spawnForMode]', requestId, e && e.message);
    return null;
  }
}

// THE AUTO-CLOSE INHERITED FROM `routing_review`.
//
// routing_review closed the moment the request was re-routed, because routing it WAS the work. Intake
// review can carry more than one reason, so the rule becomes conditional and states the same thing
// precisely: the task closes when the trigger being resolved is the ONLY reason it exists.
//
// A task with no recorded triggers is treated as unroutable-only when `trigger` is 'unroutable' — every
// task that could be in that state was raised by the unroutable path (it is the only wired spawner before
// this column existed, and legacy routing_review rows are handled beside it).
//
// Returns the number of tasks closed.
async function closeForResolvedTrigger(requestId, trigger, opts) {
  opts = opts || {};
  var closed = 0;
  try {
    // Legacy first: a routing_review open on this request is closed exactly as it always was.
    var legacy = await openLegacyRoutingReview(requestId);
    if (legacy) {
      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [legacy.id]);
      closed++;
    }
    var t = await openTask(requestId);
    if (t) {
      var have = triggersOf(t);
      // No recorded trigger has TWO meanings, and they close differently:
      //   spawn_triggers NULL  — the row predates the column. Every task that can be in that state was
      //                          raised by the unroutable path (the only wired spawner then), so routing
      //                          the request finishes it, exactly as routing_review behaved.
      //   spawn_triggers '[]'  — raised by `always` mode, which is not a trigger and is not resolved by
      //                          routing. The city asked for a stop on every request; giving it one that
      //                          disappears the moment the team is corrected would not be that.
      var legacyRow = t.spawn_triggers == null;
      var onlyReason = have.length === 0
        ? (legacyRow && trigger === 'unroutable')
        : (have.length === 1 && have[0] === trigger);
      if (onlyReason) {
        await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [t.id]);
        closed++;
      } else if (have.indexOf(trigger) >= 0) {
        // The reason is resolved but others remain: drop the key, keep the stop. Without this the screen
        // would keep claiming a request is here for a reason that has been dealt with.
        var left = have.filter(function (x) { return x !== trigger; });
        await run("UPDATE tasks SET spawn_triggers = ?, updated_at = datetime('now') WHERE id = ?",
          [JSON.stringify(left), t.id]);
      }
    }
  } catch (e) { console.error('[intakeReview closeForResolvedTrigger]', requestId, e && e.message); }
  return closed;
}

// Every open intake stop on a request, legacy included — used by callers that must not treat the intake
// task as ordinary team work (the re-route path moves WORK tasks onto the new team; this is office work).
async function openStops(requestId) {
  return await all("SELECT * FROM tasks WHERE request_id = ? AND type IN ('" + TYPE + "','routing_review') AND status IN " + ACTIONABLE,
    [requestId]);
}

module.exports = {
  TYPE: TYPE,
  TRIGGERS: TRIGGERS,
  WIRED_TRIGGERS: WIRED_TRIGGERS,
  TRIGGER_LABELS: TRIGGER_LABELS,
  normalizeTriggers: normalizeTriggers,
  triggersOf: triggersOf,
  titleFor: titleFor,
  openTask: openTask,
  openLegacyRoutingReview: openLegacyRoutingReview,
  openStops: openStops,
  isMrr: isMrr,
  spawn: spawn,
  spawnForMode: spawnForMode,
  closeForResolvedTrigger: closeForResolvedTrigger
};
