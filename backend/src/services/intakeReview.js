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
//   eligibility_review WIRED IN BW3. The structured read it was waiting for now exists
//                     (services/eligibilityFindings.js — a real table written beside the prose note), so
//                     workflowEngine.onIntake asks `hasReview(requestId)` instead of regex-ing an English
//                     sentence. Safe by default in the same way `approval_pending` is: a finding only
//                     becomes a REVIEW where the city has CONFIRMED the dimension and chosen review (or
//                     chose block on a fact the submission does not carry), and a freshly imported state is
//                     advisory-only by construction — so a default install raises none of these.
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
var WIRED_TRIGGERS = ['unroutable', 'approval_pending', 'eligibility_review'];
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
// ══ AUTO-COMPLETE (draft §0 decision 4 + §4.4) ══
//
// "If the request came from the portal and the requestor indicated that an attached record FULFILLS the
// search, the intake_review task is marked completed automatically (spawn + auto-complete so the audit
// trail is intact; the request proceeds without a stop, and the queue never shows it)."
//
// THE SIGNAL IS R9's, NOT A NEW ONE. `request_search_intents.intent = 'complete'` is precisely "this
// selection is everything I want for this description" — the requestor's own words, captured at submit.
// The adjacency the draft flags (SPEC_record_search_task_screen §1's unbuilt `wfr-selected-*` skip recipe)
// is the same signal with a second consumer; this is the first, and it reads the substrate rather than
// inventing a flag beside it.
//
// THE CONDITION IS DELIBERATELY CONJUNCTIVE, and each half matters:
//   at least one `complete` intent   — the requestor actually said "this answers it". A request with no
//                                      intents at all is an ordinary request, not a fulfilled one.
//   NO open duty-carrying intent     — `search_more` / `no_match_search` mean the requestor asked the team
//                                      to keep looking. Auto-completing THAT would close, as answered, a
//                                      request the requestor considers open — the exact failure the R9 gate
//                                      in routes/tasks.js exists to prevent, arriving through a side door.
//
// Never throws; an unreadable substrate answers "no", which costs a stop rather than skipping one.
async function autoCompletes(requestId) {
  try {
    var SI = require('./searchIntents');
    var rows = await all("SELECT intent FROM request_search_intents WHERE request_id = ? AND intent = 'complete'", [requestId]);
    if (!rows.length) return false;
    var open = await SI.openIntents(requestId);
    return open.length === 0;
  } catch (e) { console.error('[intakeReview autoCompletes]', requestId, e && e.message); return false; }
}

async function spawnForMode(requestId, opts) {
  opts = opts || {};
  try {
    var PC = require('./processingConfig');
    if (!(await PC.intakeReviewAlways(opts.jurisdictionId || null))) return null;
    if (await isMrr(requestId)) return null;

    // AUTO-COMPLETE, always mode. The task is still CREATED — the audit trail must show that this city's
    // every-request review happened and why it needed no person — and then completed on the spot with no
    // assignee, so it never reaches anybody's queue.
    //
    // In `when_needed` (the default) there is nothing to do here at all: no trigger fired, so no task was
    // ever going to be raised. That is the draft's "simply a no-trigger case", and it is why this check
    // lives AFTER the mode gate rather than before it — a fulfilled request in default mode must not cause
    // a task to be created purely so it can be closed again.
    if (await autoCompletes(requestId)) {
      var existingAC = await openTask(requestId);
      if (existingAC) return { task: existingAC, created: false, addedTriggers: [], autoCompleted: false };
      var trAC = require('./taskRouting');
      var acTask = await trAC.createTask({
        requestId: requestId, type: TYPE,
        title: 'Intake review — auto-completed (the requestor’s selection fulfills the request)',
        teamId: null, createdBy: opts.createdBy || 'system', spawnTriggers: []
      });
      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [acTask.id]);
      try {
        await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
          [require('uuid').v4(), requestId, null, 'System', 'INTAKE_REVIEW_AUTO_COMPLETED',
           'This city reviews every request at intake, but the requestor marked their portal selection as ' +
           'fulfilling the request and asked for nothing further — so the review task was raised and closed ' +
           'automatically. No person was assigned and the request was not stopped.']);
      } catch (e) { console.error('[intakeReview auto-complete history]', e && e.message); }
      return { task: await trAC.getTask(acTask.id), created: true, addedTriggers: [], autoCompleted: true };
    }
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

// ══ THE PROCEED GATE (draft §4.6) ══
//
// "Resolution blocked (with the reason) while an inline waiver decision or an eligibility review is open —
// same pattern as the record-search Found gate (422 with a named cause)."
//
// ONE function, TWO consumers, and that is deliberate: `POST /tasks/:id/resolve` refuses on it, and the
// screen's Resolve panel RENDERS it. A gate the screen computes for itself is a gate that eventually
// disagrees with the one that enforces — the record-search Found gate learned that the expensive way, and
// its comment in routes/tasks.js says so.
//
// The reasons are SENTENCES, not codes with a lookup table on the far side. A reviewer staring at a
// greyed-out Proceed needs to be told what to do about it, and the words belong next to the condition they
// describe rather than in a frontend switch statement that drifts.
//
// ⚠ WHAT IS DELIBERATELY NOT GATED, and why (conservative on ambiguity — recorded here rather than
// discovered later):
//
//   COMMERCIAL-RATE CLASSIFICATION. `approvalModules.evaluateCommercial` returns `needs_decision` for as
//   long as no `classifyAs` is supplied — and NOTHING PERSISTS a classification anywhere (there is no
//   column, no history action, no task outcome that records one; see the grep in the BW3 commit). A gate on
//   it would therefore be a stop no act in the system can clear: every request in a city that enables the
//   module in intake_review mode would be permanently un-proceedable. The panel renders (it is a real
//   pending decision the reviewer should see); the gate waits for BW4 to give the classification somewhere
//   to live.
//
//   LEGACY PROSE ELIGIBILITY NOTES. A request created before the structured findings table has notes and no
//   confirmable rows. Gating on them would strand every in-flight request across the deploy behind a
//   confirm button that has nothing to confirm. See services/eligibilityFindings.js.
async function proceedGate(requestId) {
  var out = { blocked: false, reasons: [] };
  if (!requestId) return out;

  // (a) An eligibility review nobody has put their name to. Rule (c): the system never confirms its own
  // finding, so this clears only when a PERSON does.
  try {
    var open = await require('./eligibilityFindings').openReviews(requestId);
    open.forEach(function (f) {
      out.reasons.push({
        code: 'ELIGIBILITY_REVIEW_OPEN',
        finding: f.dimension,
        text: 'The ' + String(f.label || f.dimension).toLowerCase() + ' finding still needs your confirmation. ' +
              'Confirm it in the Requester eligibility panel — the request proceeds, but a person has to say so.'
      });
    });
  } catch (e) { console.error('[intakeReview proceedGate eligibility]', e && e.message); }

  // (b) An inline fee-waiver decision. Only in `intake_review` mode: in `routed_task` mode (the shipped
  // default) the decision belongs to a Fee-Waiver Approval task and gating intake on it would block a
  // request behind somebody else's queue. The estimate-communication gate already holds that line.
  try {
    var req = await get('SELECT * FROM requests WHERE id = ?', [requestId]);
    if (req) {
      var AM = require('./approvalModules');
      var wv = await AM.evaluateWaiver(null, req, {});
      if (wv.outcome === 'needs_decision' && wv.route && wv.route.mode === 'intake_review') {
        out.reasons.push({
          code: 'WAIVER_UNDECIDED',
          text: 'The requester asked for a fee waiver and this city decides it here. Grant or deny it in the ' +
                'Fee waiver panel before proceeding — the estimate cannot be sent while it is open either way.'
        });
      }
    }
  } catch (e) { console.error('[intakeReview proceedGate waiver]', e && e.message); }

  out.blocked = out.reasons.length > 0;
  return out;
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
  closeForResolvedTrigger: closeForResolvedTrigger,
  proceedGate: proceedGate,
  autoCompletes: autoCompletes
};
