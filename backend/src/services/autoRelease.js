'use strict';
// PHASE 7 / BW5 — THE AUTO-RELEASE PIPELINE (Draft 8 rev 2 Frame B, SPEC_processing_ui.md §4.1).
//
// Kevin's 7/28 direction item 4: "delivery and closure are automatic from conditions." When the last flow
// task is terminal — completed by a person, or AUTO-BYPASSED WITH A RECORDED BASIS — and the outstanding
// balance is ≤ 0, the item ships, notifies and closes with nobody touching it.
//
// ══ THE CONSERVATIVE DEFAULT DECISION (BW5's brief asked for it explicitly, and here it is) ══
//
// THE WHOLE PIPELINE IS GATED BEHIND AN UNCONFIRMED ⚠ KNOB, not just the pre-send review.
//
// The brief said to gate the evaluator "if there is ANY doubt a live request could auto-ship unexpectedly".
// There is not doubt — there is certainty. Today NOTHING auto-ships: delivery is reached by a person
// advancing the stage, and the release gate (services/feeRelease) only ever REFUSES an advance somebody
// already asked for. An evaluator that fires on conditions would, on the day it deployed, start shipping
// records out of live installs that never chose automatic delivery — including installs mid-migration whose
// flow tasks are terminal for reasons that have nothing to do with the work being finished.
//
// So `auto_release` ships as a city-config knob with `suggested_default: off`, in the exact rule-(d) shape
// jurisdictionProfile.pendingCityKnobs already scans for. UNCONFIRMED = OFF = today's behaviour, and the
// confirming act IS the human decision to automate — which is the point Kevin made about the pre-send gate
// and which applies with more force to the thing that actually sends records to a citizen.
//
// Every piece below still BUILDS and is testable with the knob on. What the knob withholds is the firing.
//
// ══ THE FOUR CONDITIONS ══
//
//   (i)   every flow task terminal — done by a person, or bypassed WITH A BASIS (never a silent skip)
//   (ii)  outstanding balance ≤ 0 — the funds gate, read from services/feeRelease (§5.9 coverage)
//   (iii) the pre-send review gate is off, or its review passed
//   (iv)  non-MRR — an MRR release stays the Request Manager's orchestration behind Draft 7's funds gate
//
// Plus the one the RM-hold guard adds (§5.9): a record on a recorded hold does not ship. That is not a
// payment hold — feeRelease owns money gating, and this pipeline does not double-gate it.
//
// ══ AUTO-BYPASS IS A RECORD, NEVER A SKIP ══
//
// A step the conditions make unnecessary is COMPLETED, with `bypass_kind` (the DecidedByBadge value —
// rule c) and `bypass_basis` (the sentence a later reader needs) written on the task and a history row
// beside it. "Redaction — not required" with no basis is indistinguishable from redaction nobody did.
var db = require('../db');
var get = db.get, all = db.all, run = db.run;
var uuidv4 = require('uuid').v4;
var JR = require('./jurisdictionRules');
var DISP = require('./disposition');
var feeRelease = require('./feeRelease');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function s(v) { return String(v == null ? '' : v).trim(); }

var DOMAIN = 'release_pipeline';
var ACTIONABLE = "('open','assigned','in_progress','returned','awaiting_review')";

// ── THE TWO KNOBS, in the rule-(d) shape (see services/deMinimisPolicy.js for the convention) ─────
var KNOBS = {
  auto_release: {
    key: 'auto_release', suggestedDefault: 'off',
    note: 'Whether delivery and closure fire AUTOMATICALLY once the conditions hold — every flow task ' +
      'terminal, balance ≤ 0, no pre-send review, non-MRR. This is city policy, not law: no statute ' +
      'requires or forbids automatic release. Unconfirmed means OFF, which is what the product does today; ' +
      'confirming it ON is the conscious decision to let records ship with nobody touching them.'
  },
  pre_send_review: {
    key: 'pre_send_review', suggestedDefault: 'off',
    note: 'Whether a second person reviews the package BEFORE it ships. City policy, not law — the ' +
      'statutory pre-release steps (legal review, AG band, third-party notice) already ride the flow as ' +
      'their own tasks. Unconfirmed means OFF, which is today’s behaviour. When ON, a `release_review` ' +
      'task is raised instead of shipping.'
  }
};

function onOff(v) { return v === 'on' || v === true ? 'on' : (v === 'off' || v === false ? 'off' : null); }

// A knob's state. Never throws: an unreadable config answers "unconfirmed", and for BOTH of these knobs
// unconfirmed is the SAFE direction (nothing automates), which is the opposite of the de-minimis knob where
// unconfirmed had to be the permissive one. The convention is the same; the direction follows the risk.
async function knob(name, jid) {
  var def = KNOBS[name];
  var out = { domain: DOMAIN, knob: name, confirmed: false, value: 'off', on: false,
              suggestedDefault: def.suggestedDefault, note: def.note, configNotLaw: true };
  try {
    if (!jid) jid = await JR.activeJid();
    var raw = jid ? await JR.read(jid, DOMAIN) : null;
    var cc = raw && raw.knobs && raw.knobs[name] && raw.knobs[name].city_config;
    if (cc) {
      var v = onOff(cc.value);
      // CONFIRMED MEANS CONFIRMED WITH AN ANSWER. A knob flagged confirmed with no value is not a decision,
      // and reading it as one would automate on the strength of a half-filled form.
      out.confirmed = cc.confirmed === true && v != null;
      out.value = out.confirmed ? v : 'off';
      out.on = out.confirmed && v === 'on';
      if (cc.suggested_default != null) out.suggestedDefault = onOff(cc.suggested_default) || def.suggestedDefault;
    }
  } catch (e) { console.error('[autoRelease knob]', name, e && e.message); }
  return out;
}

async function writeKnob(name, patch, jid, actor) {
  if (!KNOBS[name]) throw new Error('No such release-pipeline knob: ' + name);
  if (!jid) jid = await JR.activeJid();
  var raw = null;
  try { raw = await JR.read(jid, DOMAIN); } catch (e) { raw = null; }
  raw = raw || {};
  raw.knobs = raw.knobs || {};
  raw.knobs[name] = {
    city_config: {
      note: KNOBS[name].note,
      confirmed: (patch || {}).confirmed === true,
      value: onOff((patch || {}).value),
      suggested_key: name,
      suggested_default: KNOBS[name].suggestedDefault
    }
  };
  await JR.write(jid, DOMAIN, raw, actor || 'staff');
  return await knob(name, jid);
}

// ── THE AUTO-BYPASS WRITER ────────────────────────────────────────────────────────────────────────
//
// Completes ONE task as a record. `kind` is the DecidedByBadge vocabulary:
//   statute          — the law made this step unnecessary (a statutorily-mandatory waiver zeroed the fee)
//   system_condition — a fact the system can verify made it unnecessary (balance is $0.00)
//   recorded         — the basis is on file but nobody and nothing DECIDED it (no redaction flags)
// Never a fourth value, and never blank: a bypass with no kind is the silent skip this exists to forbid.
var BYPASS_KINDS = ['statute', 'system_condition', 'recorded'];

async function bypassTask(task, kind, basis, opts) {
  opts = opts || {};
  if (BYPASS_KINDS.indexOf(kind) < 0) throw new Error('bypassTask: unknown basis kind "' + kind + '"');
  if (!s(basis)) throw new Error('bypassTask: a bypass with no recorded basis is a silent skip.');
  await run("UPDATE tasks SET status = 'done', bypass_kind = ?, bypass_basis = ?, bypassed_at = ?, updated_at = datetime('now') WHERE id = ?",
    [kind, basis, nowStr(), task.id]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), task.request_id, null, opts.actorName || 'System', 'TASK_AUTO_BYPASSED',
     (task.type || 'task') + ' — auto-completed, not skipped. Basis (' + kind + '): ' + basis, nowStr()]);
  return { taskId: task.id, type: task.type, kind: kind, basis: basis };
}

// What, if anything, makes THIS open task unnecessary? Returns { kind, basis } or null.
//
// Deliberately narrow. A bypass rule exists only where the system holds a fact that MAKES the step
// unnecessary — not merely one that suggests it. Everything else stays a person's task, which is the
// honest outcome: the pipeline then simply does not fire, and someone finishes the work.
async function bypassReasonFor(task, ctx) {
  ctx = ctx || {};
  var t = task.type;

  if (t === 'estimate' || t === 'mrr_estimate') {
    // A ZERO ESTIMATE IS NOT AN ESTIMATE TO SEND. Two distinct bases, and they are not the same badge:
    // a statutorily-mandatory waiver is the LAW zeroing the fee; a $0 computed total is a system fact.
    var est = await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [task.request_id]);
    var reqRow = ctx.request || await get('SELECT fee_waiver_status FROM requests WHERE id = ?', [task.request_id]);
    var total = est ? Number(est.total) || 0 : null;
    var waived = reqRow && /grant/i.test(reqRow.fee_waiver_status || '');
    if (waived && (total === null || total <= 0)) {
      return { kind: 'statute', basis: 'The fee waiver was granted and the estimate is $0.00 — there is no charge to quote, so the estimate step has nothing to do.' };
    }
    if (total !== null && total <= 0) {
      return { kind: 'system_condition', basis: 'The computed estimate total is $0.00 — nothing is chargeable on this request, so there is no estimate to send.' };
    }
    return null;
  }

  if (t === 'redaction' || t === 'legal_redaction') {
    // NO EXEMPTION FLAGS ON THE RELEASED SET. This is `recorded`, not `statute` and not `system_condition`:
    // the ABSENCE of a flag is evidence on file, but nobody decided that nothing is exempt, and the badge
    // must not claim they did (rule c).
    var flagged = await get('SELECT legal_flag FROM requests WHERE id = ?', [task.request_id]);
    if (flagged && Number(flagged.legal_flag) === 1) return null;
    var pend = await get(
      "SELECT count(*)::int AS n FROM redaction_jobs WHERE request_id = ? AND COALESCE(review_stage,'') <> 'released'", [task.request_id]);
    if (pend && pend.n > 0) return null;
    var files = await get("SELECT count(*)::int AS n FROM request_files WHERE request_id = ? AND responsive = 1", [task.request_id]);
    if (!files || files.n < 1) return null;
    return { kind: 'recorded', basis: 'No exemption flags on the released set and no redaction job left unreleased across ' +
      files.n + ' responsive record(s) — redaction is not required here. The absence of a flag is the recorded basis; nobody judged the content exempt.' };
  }

  return null;
}

// ── THE FOUR CONDITIONS, EVALUATED ────────────────────────────────────────────────────────────────
//
// Read-only. Returns every condition with its own sentence, so a screen renders the same list the
// pipeline acts on — the "one gate, two readers" rule this codebase applies everywhere else.
async function evaluate(requestId, opts) {
  opts = opts || {};
  var request = await get('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request) return { requestId: requestId, known: false, eligible: false, conditions: [] };

  var autoKnob = await knob('auto_release');
  var reviewKnob = await knob('pre_send_review');
  var conditions = [];

  // (iv) NON-MRR. Checked first because it is the cheapest and the most absolute: an MRR release is the
  // Request Manager's orchestration (delivery_mode / notice_packaging, both blank by design), and shipping
  // one child automatically would answer a question the city has not been asked yet.
  var kidCount = await get('SELECT count(*)::int AS n FROM requests WHERE master_request_id = ?', [requestId]);
  var parentIsMrr = false;
  if (request.master_request_id) {
    var p = await get('SELECT is_mrr FROM requests WHERE id = ?', [request.master_request_id]);
    var sib = await get('SELECT count(*)::int AS n FROM requests WHERE master_request_id = ?', [request.master_request_id]);
    parentIsMrr = !!(p && Number(p.is_mrr) === 1) || !!(sib && sib.n > 1);
  }
  var isMrr = Number(request.is_mrr) === 1 || (kidCount && kidCount.n > 1) || parentIsMrr;
  conditions.push({ code: 'NON_MRR', ok: !isMrr, decidedBy: 'system',
    text: isMrr ? 'This is a multi-record request. An MRR release stays the Request Manager’s orchestration behind the funds gate — the pipeline does not ship one item of it.'
                : 'Single-record request — the pipeline may act.' });

  // (i) EVERY FLOW TASK TERMINAL. Bypassable ones are named so the caller can complete them as records
  // before re-evaluating; nothing here writes.
  var openTasks = await all('SELECT * FROM tasks WHERE request_id = ? AND status IN ' + ACTIONABLE, [requestId]);
  var bypassable = [];
  var stuck = [];
  for (var i = 0; i < openTasks.length; i++) {
    var reason = await bypassReasonFor(openTasks[i], { request: request });
    if (reason) bypassable.push({ task: openTasks[i], reason: reason });
    else stuck.push(openTasks[i]);
  }
  conditions.push({ code: 'TASKS_TERMINAL', ok: stuck.length === 0, decidedBy: 'system',
    text: stuck.length === 0
      ? (openTasks.length === 0 ? 'Every flow task is terminal.'
         : bypassable.length + ' remaining step(s) are auto-bypassable with a recorded basis; nothing needs a person.')
      : stuck.length + ' flow task(s) still need a person: ' + stuck.map(function (t) { return t.type; }).join(', ') + '.',
    openTasks: stuck.map(function (t) { return { id: t.id, type: t.type, status: t.status }; }),
    bypassable: bypassable.map(function (b) { return { id: b.task.id, type: b.task.type, kind: b.reason.kind, basis: b.reason.basis }; }) });

  // (ii) THE FUNDS GATE. Read from services/feeRelease, which owns §5.9 coverage. NOT re-implemented here:
  // two answers to "is the money settled" is how a record gets released against one split and billed
  // against another.
  var gate = { covered: true, balanceDue: 0, hasEstimate: false };
  try { gate = await feeRelease.releaseGate(requestId); } catch (e) { console.error('[autoRelease gate]', e && e.message); }
  var fundsOk = !gate.hasEstimate || gate.covered || !(Number(gate.balanceDue) > 0);
  conditions.push({ code: 'BALANCE_CLEAR', ok: fundsOk, decidedBy: 'system',
    text: fundsOk ? 'Outstanding balance is $0.00 or less — nothing is owed on this record.'
                  : 'Payment due: $' + (Number(gate.balanceDue) || 0).toFixed(2) + '. The item waits here and ships untouched the moment the balance clears.',
    balanceDue: Number(gate.balanceDue) || 0 });

  // (iii) THE PRE-SEND REVIEW GATE. `ok` here means "nothing stands between this and the wire" — either the
  // gate is off, or a review has already been approved. When it is ON and unreviewed the pipeline does not
  // stop; it DIVERTS, which is a different outcome and is reported as one.
  var reviewTask = await get("SELECT * FROM tasks WHERE request_id = ? AND type = 'release_review' ORDER BY created_at DESC LIMIT 1", [requestId]);
  var reviewApproved = !!(reviewTask && reviewTask.status === 'done');
  var gateOff = !reviewKnob.on;
  conditions.push({ code: 'PRE_SEND_REVIEW', ok: gateOff || reviewApproved, decidedBy: reviewKnob.confirmed ? 'person' : 'system',
    text: gateOff
      ? (reviewKnob.confirmed ? 'This city has decided against a pre-send review — the package ships without one.'
                              : 'No pre-send review: the knob is unconfirmed, which means OFF — today’s behaviour, and nobody has chosen otherwise.')
      : (reviewApproved ? 'The pre-send review was approved — the release may fire.'
                        : 'This city requires a second person to review the package before it ships. A release review is raised instead of shipping.'),
    knob: reviewKnob });

  // THE RM HOLD (§5.9 — never a payment hold; feeRelease above owns the money and is not double-gated).
  var held = Number(request.release_hold) === 1;
  conditions.push({ code: 'NOT_HELD', ok: !held, decidedBy: held ? 'person' : 'system',
    text: held ? 'This record is on a recorded hold' + (request.release_hold_note ? ' — ' + request.release_hold_note : '') + '. It does not ship while the hold stands.'
               : 'No hold stands on this record.' });

  // ALREADY ENDED. Belt and braces beside the from-closed guard: a closed request has no release left in it.
  var openItem = request.status !== 'closed' && request.stage !== 'closed';
  conditions.push({ code: 'STILL_OPEN', ok: openItem, decidedBy: 'system',
    text: openItem ? 'The item is open.' : 'This item has already ended (' + (request.closure_reason || 'closed') + ').' });

  var blocked = conditions.filter(function (c) { return !c.ok; });
  var divertToReview = !gateOff && !reviewApproved &&
    blocked.length === 1 && blocked[0].code === 'PRE_SEND_REVIEW';

  return {
    requestId: requestId, known: true,
    // ELIGIBLE means "every condition holds". The knob is reported separately and on purpose: the
    // conditions are a fact about the request, the knob is a decision about the city. Conflating them would
    // make it impossible to show a Director what WOULD happen if they turned it on.
    eligible: blocked.length === 0,
    conditions: conditions, blocked: blocked,
    knob: autoKnob, reviewKnob: reviewKnob,
    armed: autoKnob.on,
    divertToReview: divertToReview,
    bypassable: bypassable.map(function (b) { return { id: b.task.id, type: b.task.type, kind: b.reason.kind, basis: b.reason.basis }; }),
    paymentPending: !fundsOk,
    releaseGate: gate
  };
}

// ── THE RELEASE EVENT — one event, three writes and a notice ──────────────────────────────────────
//
// Draft 8 rev 2: "writes Closed – Delivered + delivered_at + installment_no + notice, ONE event." Delivered
// is WRITTEN BY the release event and never asserted by a person, which is why this is the only place the
// `fulfilled` ending is produced. A redacted release is still Delivered — the withholding log carries the
// detail (rev 2 constant, unchanged).
async function release(requestId, opts) {
  opts = opts || {};
  var request = await get('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request) { var e0 = new Error('Request not found.'); e0.code = 'NOT_FOUND'; e0.status = 404; throw e0; }

  var installment = (Number(request.installment_no) || 0) + 1;
  var pages = await get("SELECT count(*)::int AS n FROM request_files WHERE request_id = ? AND responsive = 1", [requestId]);
  var when = nowStr();
  await run('UPDATE requests SET delivered_at = ?, installment_no = ?, updated_at = ? WHERE id = ?',
    [when, installment, when, requestId]);

  var out = await DISP.close(requestId, 'fulfilled', {
    skipGate: true,
    actorId: opts.actorId || null,
    actorName: opts.actorName || 'System',
    payload: { note: s(opts.note) },
    noticeCtx: { pageCount: pages ? pages.n : null, installmentNo: installment, deliveredAt: when },
    basisText: 'Released ' + (pages ? pages.n : 0) + ' record(s)' + (installment > 1 ? ' as installment ' + installment : '') +
      ' — delivered ' + when + '.' + (opts.approverName ? ' Release approved by ' + opts.approverName + '.' : '')
  });
  return Object.assign({ released: true, deliveredAt: when, installmentNo: installment,
                         recordCount: pages ? pages.n : 0 }, out);
}

// ── THE `release_review` SPAWNER, AND ITS RE-ARM RULE ─────────────────────────────────────────────
//
// BW2 registered the task type and said outright that between BW2 and BW5 it is "a routable type nothing
// spawns". This is the spawner. Routing is per config, suggested default ORO Supervisor — in the v3 model
// that means "the people a supervisor granted `release_review` to", so the suggestion is expressed by who
// holds the token rather than by a role name invented here. Two-eyes is already enforced at assignment
// (taskRouting.TWO_EYES_TYPES) — the reviewer is never the person who completed the last flow task.
//
// RE-ARM: a review RETURNED with a note must not immediately re-spawn — the pipeline would loop, since the
// conditions that raised it still hold. It re-arms when the item has MOVED since the return: any history
// row newer than the return means real work landed. No new column; the history already knows.
async function reArmed(requestId) {
  var ret = await get("SELECT id, created_at FROM request_history WHERE request_id = ? AND action = 'RELEASE_REVIEW_RETURNED' ORDER BY created_at DESC LIMIT 1", [requestId]);
  if (!ret) return true;
  // `>=`, NOT `>`, and the direction of the imprecision is the reason. request_history timestamps have
  // one-second resolution, so work landing in the same second as the return would read as older than it and
  // the review would never re-arm — a permanently stuck item. Comparing `>=` (excluding the return itself
  // and the raise it would trigger) can instead re-arm one second early, which at worst re-raises a review
  // somebody has to click through. Between a stuck request and a redundant review, take the redundant review.
  var newer = await get(
    "SELECT count(*)::int AS n FROM request_history WHERE request_id = ? AND created_at >= ? AND id <> ? " +
    "AND action NOT IN ('RELEASE_REVIEW_RETURNED','RELEASE_REVIEW_RAISED')", [requestId, ret.created_at, ret.id]);
  return !!(newer && newer.n > 0);
}

async function spawnReview(requestId, opts) {
  opts = opts || {};
  var open = await get("SELECT id FROM tasks WHERE request_id = ? AND type = 'release_review' AND status IN " + ACTIONABLE, [requestId]);
  if (open) return { spawned: false, taskId: open.id, reason: 'already_open' };
  if (!(await reArmed(requestId))) return { spawned: false, taskId: null, reason: 'returned_awaiting_work' };
  var tr = require('./taskRouting');
  var reqRow = await get('SELECT description, department_id FROM requests WHERE id = ?', [requestId]);
  var task = await tr.createTask({
    requestId: requestId, type: 'release_review', teamId: null,
    title: 'Release review — approve before this package ships', createdBy: opts.createdBy || 'system'
  });
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), requestId, null, 'System', 'RELEASE_REVIEW_RAISED',
     'Every release condition holds, but this city requires a pre-send review, so the package was NOT shipped — ' +
     'a release review was raised instead. Approving it fires the release event.', nowStr()]);
  tr.autoRouteOrPool(task.id, (reqRow && reqRow.description) || null, {})
    .catch(function (e) { console.error('[autoRelease spawnReview route]', e && e.message); });
  return { spawned: true, taskId: task.id };
}

async function returnReview(taskId, opts) {
  opts = opts || {};
  var note = s(opts.note);
  if (!note) { var e0 = new Error('Say what has to change before this package ships — a return with no note tells the team nothing.'); e0.code = 'NOTE_REQUIRED'; e0.status = 422; throw e0; }
  var t = await get("SELECT * FROM tasks WHERE id = ? AND type = 'release_review'", [taskId]);
  if (!t) { var e1 = new Error('No such release review.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", [taskId]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), t.request_id, opts.actorId || null, opts.actorName || 'Reviewer', 'RELEASE_REVIEW_RETURNED',
     'Release review returned — ' + note + ' The package does not ship. The pipeline re-arms once the item has moved.', nowStr()]);
  return { ok: true, returned: true, taskId: taskId, note: note, reArmsOnNextWork: true };
}

// ── THE PIPELINE ──────────────────────────────────────────────────────────────────────────────────
//
// Idempotent, never throws to its caller (it is invoked from money hooks and task completions, where an
// exception would fail an unrelated write). Returns what it did and, crucially, what it did NOT do and why.
//
//   opts: { force } — `force: true` runs the evaluator and acts EVEN WITH THE KNOB UNCONFIRMED. It exists
//   for the release-review approval path (a person has just said "ship it", which is a decision the knob is
//   not being asked about) and for tests. Nothing background ever passes it.
async function run_(requestId, opts) {
  opts = opts || {};
  try {
    var ev = await evaluate(requestId);
    if (!ev.known) return { acted: false, reason: 'not_found' };

    // THE KNOB. First real gate, before anything is written — including the bypasses, which are records on
    // a live request and must not appear on an install that never asked for this pipeline.
    if (!ev.armed && !opts.force) {
      return { acted: false, reason: 'knob_unconfirmed', knob: ev.knob, evaluation: ev,
               text: 'The auto-release pipeline is not switched on for this city (unconfirmed = off). Nothing shipped, ' +
                     'nothing was bypassed — this is exactly what the product does today.' };
    }
    if (!ev.conditions.filter(function (c) { return c.code === 'NON_MRR'; })[0].ok) {
      return { acted: false, reason: 'mrr', evaluation: ev };
    }
    if (!ev.conditions.filter(function (c) { return c.code === 'STILL_OPEN'; })[0].ok) {
      return { acted: false, reason: 'already_closed', evaluation: ev };
    }

    // AUTO-BYPASS PASS. Each one is a completed task with a badge and a basis, written before the funds
    // check so the record reads in the order it happened.
    var bypassed = [];
    for (var i = 0; i < ev.bypassable.length; i++) {
      var b = ev.bypassable[i];
      var task = await get('SELECT * FROM tasks WHERE id = ?', [b.id]);
      if (!task || ['done', 'cancelled', 'superseded'].indexOf(task.status) >= 0) continue;
      try { bypassed.push(await bypassTask(task, b.kind, b.basis, opts)); }
      catch (e) { console.error('[autoRelease bypass]', b.id, e && e.message); }
    }
    if (bypassed.length) ev = await evaluate(requestId);

    if (ev.paymentPending) {
      return { acted: false, reason: 'payment_due', bypassed: bypassed, evaluation: ev,
               text: 'Pending — balance $' + (ev.releaseGate.balanceDue || 0).toFixed(2) + ' > 0. It ships untouched the moment payment brings it to ≤ 0.' };
    }
    if (ev.divertToReview) {
      var sp = await spawnReview(requestId, opts);
      return { acted: true, reason: 'release_review', bypassed: bypassed, review: sp, evaluation: ev };
    }
    if (!ev.eligible) {
      return { acted: bypassed.length > 0, reason: 'conditions_not_met', bypassed: bypassed,
               blocked: ev.blocked, evaluation: ev };
    }
    var rel = await release(requestId, opts);
    return { acted: true, reason: 'released', bypassed: bypassed, release: rel, evaluation: ev };
  } catch (e) {
    console.error('[autoRelease run]', requestId, e && e.message);
    return { acted: false, reason: 'error', error: e && e.message };
  }
}

// THE PAYMENT-RECEIVED HOOK. "Payment due ⇒ pending until balance ≤ 0, then ships untouched." Wired at
// services/paymentStatus.recordEvent — the ONE chokepoint every money event already passes through
// (counter, ERP webhook, portal), so no channel can bring a balance to zero without the pipeline noticing.
// Fire-and-forget by construction: `run_` never throws, and a release must never be able to fail a payment.
async function onPaymentReceived(requestId) {
  return await run_(requestId, {});
}

module.exports = {
  DOMAIN: DOMAIN, KNOBS: KNOBS, BYPASS_KINDS: BYPASS_KINDS,
  knob: knob, writeKnob: writeKnob,
  bypassTask: bypassTask, bypassReasonFor: bypassReasonFor,
  evaluate: evaluate, release: release,
  spawnReview: spawnReview, returnReview: returnReview, reArmed: reArmed,
  run: run_, onPaymentReceived: onPaymentReceived
};
