'use strict';
// PHASE 7 / BW6 — THE MRR MANAGEMENT HUB.
// (docs/DRAFT_processing_ui_mrr_hub.md rev 5b + §0b · docs/SPEC_processing_ui.md §3 screen 5)
//
// ══ WHAT THIS MODULE IS, AND THE ONE THING IT MUST NEVER DO ══
//
// `mrr_management` tasks have existed on live installs since BW2 — `requestCreate` spawns one whenever a
// submission wraps into a parent with more than one child. What they have never had is a screen, so the
// task fell through My Tasks to `/requests/:id`, which coordinates nothing. This module is the hub behind
// that screen, and it is almost entirely NEW SURFACE over EXISTING FACTS.
//
// THE HARD RULE, from Kevin 7/28 item 5 and repeated in the draft's annotation 11:
//
//     MRR child activities DO NOT MOVE FORWARD IN A PROCESS.
//
// So nothing in this file calls `applyStageTransition`, `spawnForStage`, or the auto-release pipeline.
// Completing an MRR SEARCH updates the bar on the hub and nothing else. The manager orchestrates; the
// engine does not. That is not a stylistic choice — it is the structural difference between `mrr_search`
// and `record_search`, and the reason the two are separate task-type keys at all. If a future edit adds a
// stage call to this module, the two have blurred and the design is gone.
//
// THE OTHER HARD RULE: the PARENT's state is `disposition.deriveParent`'s and nobody else's (§5.8 — a
// parent is never closed by hand). This module READS parent state; it never computes or writes one. When
// a child reopens, deriveParent already reactivates the `mrr_management` task, so the hub comes back with
// it — that path is deliberately left exactly where it is.
//
// AND: MRR stays OUT of the auto-release pipeline (autoRelease's NON_MRR condition). Per-child release
// here goes through `feeRelease.releaseGate` (§5.9 coverage — never a sibling's balance) and
// `releaseHold.holdState` (the RM hold guard), and it refuses in THEIR words, not in words invented here.
var db = require('../db');
var get = db.get, all = db.all, run = db.run;
var uuidv4 = require('uuid').v4;

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function s(v) { return String(v == null ? '' : v).trim(); }

// ── THE THREE ACTIVITIES ─────────────────────────────────────────────────────────────────────────
//
// The label set is Draft 5 §3 question 6, drafted and shipped as drafted: MRR SEARCH / MRR ESTIMATE /
// MRR REDACTION. Kevin has not answered it, so the conservative move is the drafted position.
var ACTIVITIES = ['search', 'estimate', 'redaction'];
var TASK_TYPE = { search: 'mrr_search', estimate: 'mrr_estimate', redaction: 'mrr_redaction' };
var LABEL = { search: 'MRR SEARCH', estimate: 'MRR ESTIMATE', redaction: 'MRR REDACTION' };
var ACTIVITY_NAME = { search: 'Record search', estimate: 'Estimate data gathering', redaction: 'Redaction' };
var STATUSES = ['not_started', 'queued', 'in_process', 'complete', 'not_required'];

// NO ENFORCED ORDER (Draft 5 §3 question 3, drafted position kept). Redaction may be queued before search
// completes; the hub says "queued" and the manager decides. The system does not gate one activity on
// another, because on an MRR the orchestration IS the manager's job — that is the whole shape Kevin drew.
var ORDER_ENFORCED = false;

function isMrrParentRow(r, kidCount) {
  return !!r && (Number(r.is_mrr) === 1 || (kidCount || 0) > 1);
}

// ── ACTIVITY ROWS ────────────────────────────────────────────────────────────────────────────────
//
// Lazily materialised: a child with no activity rows reads as three `not_started` activities, and the row
// appears the moment somebody acts. That keeps the substrate additive — deploying BW6 writes nothing.
async function ensureRows(childId) {
  var child = await get('SELECT id, master_request_id FROM requests WHERE id = ?', [childId]);
  if (!child) return [];
  var have = await all('SELECT * FROM mrr_tasks WHERE request_id = ?', [childId]);
  var byAct = {};
  have.forEach(function (r) { byAct[r.activity] = r; });
  for (var i = 0; i < ACTIVITIES.length; i++) {
    var a = ACTIVITIES[i];
    if (byAct[a]) continue;
    var id = 'mrra-' + uuidv4().substring(0, 8);
    await run('INSERT INTO mrr_tasks (id, request_id, parent_request_id, activity, status, created_at, updated_at) ' +
      'VALUES (?,?,?,?,?,?,?)', [id, childId, child.master_request_id || null, a, 'not_started', nowStr(), nowStr()]);
  }
  return await activities(childId);
}

async function activities(childId) {
  var rows = await all('SELECT * FROM mrr_tasks WHERE request_id = ? ORDER BY activity', [childId]);
  var byAct = {};
  rows.forEach(function (r) { byAct[r.activity] = r; });
  var out = ACTIVITIES.map(function (a) {
    var r = byAct[a];
    if (r) return decorate(r);
    // The honest empty. `not_started` is a real answer, not a missing row — see the schema comment.
    return { id: null, activity: a, name: ACTIVITY_NAME[a], label: LABEL[a], status: 'not_started',
      statusLabel: 'Not started', assignee_name: null, task_id: null, materialised: false };
  });
  // The secure-link substrate exists now (2026-08-01) — an externally-assigned activity carries its REAL
  // link state, read from the token store, never fabricated here.
  for (var i = 0; i < out.length; i++) {
    if (out[i].external_email) {
      try { out[i].external = await require('./externalContributor').stateFor(childId, out[i].activity); }
      catch (e) { out[i].external = null; }
    }
  }
  return out;
}

var STATUS_LABEL = { not_started: 'Not started', queued: 'Queued', in_process: 'In Process',
  complete: 'Complete', not_required: 'Not required' };

function decorate(r) {
  r.name = ACTIVITY_NAME[r.activity];
  r.label = LABEL[r.activity];
  r.statusLabel = STATUS_LABEL[r.status] || r.status;
  r.materialised = true;
  return r;
}

async function getActivity(childId, activity) {
  return await get('SELECT * FROM mrr_tasks WHERE request_id = ? AND activity = ?', [childId, activity]);
}

function badActivity(activity) {
  if (ACTIVITIES.indexOf(activity) >= 0) return null;
  var e = new Error('An MRR item has exactly three activities: search, estimate, redaction.');
  e.code = 'BAD_ACTIVITY'; e.status = 400; return e;
}

// The title an assignee reads on My Tasks. It carries the parent number, the item, and the requestor's own
// truncated words — the bar's one-liner is a TRUNCATION, never a summary (§0b).
function truncate(t, n) {
  t = s(t).replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

async function itemTitle(child, parent, activity) {
  var idx = child.component_label || 'Item';
  return LABEL[activity] + ' · ' + ((parent && parent.request_number) || child.request_number) +
    ' · ' + idx + ' · ' + truncate(child.description, 60);
}

// ── SPAWN / ASSIGN ───────────────────────────────────────────────────────────────────────────────
//
// Child MRR tasks are HAND-ASSIGNED (MASTER A2, and `taskRouting.HAND_ASSIGNED_TASK_TYPES` already lists
// all three keys). No team filter, no smart routing, no pool. The classifier hint on the child assign
// picker is Draft 5 §3 question 2 and is OMITTED — the drafted-clean position, per the conservative rule.
//
// `assigneeId` names a user; `self` is the manager taking it (still a real task on their own My Tasks —
// "everything worked has a task; nothing is invisible", annotation 2); `externalEmail` records the
// external-contributor case. The token substrate that would make an external link real DOES NOT EXIST in
// this codebase — searched for, absent — so the external path stores the address and the hub renders a
// LABELLED PLACEHOLDER. No token is invented here.
async function spawnActivity(childId, activity, opts) {
  opts = opts || {};
  var bad = badActivity(activity); if (bad) throw bad;
  var child = await get('SELECT * FROM requests WHERE id = ?', [childId]);
  if (!child) { var e0 = new Error('Item not found.'); e0.code = 'NOT_FOUND'; e0.status = 404; throw e0; }
  var parent = child.master_request_id ? await get('SELECT * FROM requests WHERE id = ?', [child.master_request_id]) : null;
  await ensureRows(childId);
  var row = await getActivity(childId, activity);

  var external = s(opts.externalEmail);
  var assigneeId = opts.assigneeId || null;
  if (!assigneeId && !external) {
    var e1 = new Error('An MRR activity is hand-assigned: name the person (or the external contributor’s email).');
    e1.code = 'ASSIGNEE_REQUIRED'; e1.status = 422; throw e1;
  }

  var assigneeName = null, taskId = null;
  if (assigneeId) {
    var u = await get('SELECT id, display_name FROM users WHERE id = ?', [assigneeId]);
    if (!u) { var e2 = new Error('No such person.'); e2.code = 'NO_SUCH_USER'; e2.status = 404; throw e2; }
    assigneeName = u.display_name;
    var tr = require('./taskRouting');
    // A REAL task row, so the work appears on the assignee's My Tasks like any other. What makes it an MRR
    // task is not a flag on this row — it is the TYPE, and the fact that completing it lands in the hub.
    var t = await tr.createTask({
      requestId: childId, type: TASK_TYPE[activity],
      title: await itemTitle(child, parent, activity),
      teamId: null, createdBy: opts.actorId || 'system'
    });
    await tr.assign(t.id, assigneeId, opts.actorId && opts.actorId === assigneeId ? 'manual' : 'manual', null);
    taskId = t.id;
  } else {
    assigneeName = external + ' (external)';
  }

  // Cancel a stale task from a previous assignment rather than leaving it on someone's list.
  if (row && row.task_id && row.task_id !== taskId) {
    await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('done','cancelled')", [row.task_id]);
  }

  await run('UPDATE mrr_tasks SET status = ?, task_id = ?, assignee_id = ?, assignee_name = ?, ' +
    'assignment_basis = ?, external_email = ?, spawned_at = COALESCE(spawned_at, ?), not_required_reason = NULL, updated_at = ? ' +
    'WHERE request_id = ? AND activity = ?',
    ['queued', taskId, assigneeId, assigneeName,
      external ? 'external' : (opts.actorId && opts.actorId === assigneeId ? 'self' : 'manual'),
      external || null, nowStr(), nowStr(), childId, activity]);

  // THE SECURE LINK (2026-08-01, replacing BW6's labelled placeholder). Assigning externally ISSUES the
  // link (superseding any prior one — one active link per assignment); assigning to a PERSON revokes an
  // outstanding external link, because the person it was cut for no longer holds the work.
  var XC = require('./externalContributor');
  if (external) {
    try { await XC.issue(childId, activity, external, { actorId: opts.actorId, actorName: opts.actorName, baseUrl: opts.baseUrl }); }
    catch (e) { console.error('[mrrHub external link]', e && e.message); }
  } else if (row && row.external_email) {
    try { await XC.revoke(childId, activity, { actorName: (opts.actorName || 'staff') + ' (reassigned to ' + assigneeName + ')' }); }
    catch (e) { console.error('[mrrHub external revoke]', e && e.message); }
  }

  await history(childId, opts, 'MRR_ACTIVITY_ASSIGNED',
    ACTIVITY_NAME[activity] + ' assigned to ' + assigneeName + '. ' +
    (external
      ? 'A secure expiring link was emailed to them; their uploads and completion land in this hub and advance no stage.'
      : 'The assignee sees “' + LABEL[activity] + '” on their My Tasks; completing it updates the MRR hub and advances no stage.'));

  return await activities(childId);
}

async function history(requestId, opts, action, notes) {
  opts = opts || {};
  try {
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'Request Manager', action, notes, nowStr()]);
  } catch (e) { console.error('[mrrHub history]', e && e.message); }
}

async function startActivity(childId, activity, opts) {
  opts = opts || {};
  var bad = badActivity(activity); if (bad) throw bad;
  await ensureRows(childId);
  var row = await getActivity(childId, activity);
  if (!row || row.status === 'not_started') {
    var e = new Error('Nothing has been assigned for this activity yet.'); e.code = 'NOT_ASSIGNED'; e.status = 409; throw e;
  }
  if (row.status === 'complete') return await activities(childId);
  await run('UPDATE mrr_tasks SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?',
    ['in_process', nowStr(), nowStr(), row.id]);
  if (row.task_id) {
    try { await require('./taskRouting').enterTask(row.task_id, opts.actorId); } catch (e) { console.error('[mrrHub start]', e && e.message); }
  }
  return await activities(childId);
}

// ── COMPLETION — THE POINT WHERE THE DESIGN IS EITHER KEPT OR LOST ───────────────────────────────
//
// This closes the assignee's task row and writes `complete` on the activity. IT DOES NOT TOUCH THE STAGE.
// There is no applyStageTransition call here and there must never be one: the assignee's completion is
// information for the manager, not a move in a workflow. See the module header.
async function completeActivity(childId, activity, opts) {
  opts = opts || {};
  var bad = badActivity(activity); if (bad) throw bad;
  await ensureRows(childId);
  var row = await getActivity(childId, activity);
  if (!row || ['not_started', 'not_required'].indexOf(row.status) >= 0) {
    var e = new Error('This activity has not been started, so there is nothing to complete.');
    e.code = 'NOT_ACTIVE'; e.status = 409; throw e;
  }
  if (row.status === 'complete') return await activities(childId);

  await run('UPDATE mrr_tasks SET status = ?, completed_at = ?, completed_by = ?, completed_by_name = ?, ' +
    'completion_basis = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?',
    ['complete', nowStr(), opts.actorId || null, opts.actorName || row.assignee_name || null,
      opts.basis || 'person', s(opts.note) || null, nowStr(), row.id]);

  if (row.task_id) {
    try {
      await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('done','cancelled')", [row.task_id]);
    } catch (e) { console.error('[mrrHub complete task]', e && e.message); }
  }

  await history(childId, opts, 'MRR_ACTIVITY_COMPLETED',
    ACTIVITY_NAME[activity] + ' complete' +
    (opts.basis === 'fulfilling_record'
      ? ' — the requestor marked an attached library record as FULFILLING this item, so its search was already answered.'
      : '.') +
    ' This updates the MRR hub. It advances no stage: on a multi-record request the pipeline is the Request Manager’s orchestration.');

  return await activities(childId);
}

// "Not required" is a decision with a reason, never a blank. The draft insists `not_started` and
// `not_required` stay visibly different facts on the bar.
async function setNotRequired(childId, activity, opts) {
  opts = opts || {};
  var bad = badActivity(activity); if (bad) throw bad;
  var reason = s(opts.reason);
  if (!reason) { var e = new Error('Say why the activity is not required — “not required” is a decision, not a blank.'); e.code = 'REASON_REQUIRED'; e.status = 422; throw e; }
  await ensureRows(childId);
  var row = await getActivity(childId, activity);
  if (row && row.task_id) {
    await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('done','cancelled')", [row.task_id]);
  }
  await run('UPDATE mrr_tasks SET status = ?, not_required_reason = ?, task_id = NULL, updated_at = ? WHERE id = ?',
    ['not_required', reason, nowStr(), row.id]);
  await history(childId, opts, 'MRR_ACTIVITY_NOT_REQUIRED', ACTIVITY_NAME[activity] + ' marked not required — ' + reason);
  return await activities(childId);
}

// ── THE FULFILLING-RECORD AUTO-COMPLETE, PER ITEM (§0b) ──────────────────────────────────────────
//
// Draft 1's rule, applied per item: "a library record the requestor marked as FULFILLING an item
// auto-completes that item's search on arrival". The SIGNAL IS R9's and not a new one —
// `request_search_intents.intent = 'complete'` is the requestor saying "this selection is everything I
// want for this description", captured at submit. Same substrate `intakeReview` reads; no second notion of
// "fulfils" is invented here.
//
// It completes the SEARCH only. Estimate data and redaction are staff judgements about records; a
// requestor's selection cannot answer either.
async function autoCompleteFulfilledSearch(childId, opts) {
  opts = opts || {};
  var intents = await all("SELECT * FROM request_search_intents WHERE request_id = ? AND intent = 'complete'", [childId]);
  var sel = await get('SELECT count(*)::int AS n FROM request_selected_records WHERE request_id = ?', [childId])
    .catch(function () { return null; });
  if (!intents.length) return { applied: false, reason: 'no_fulfilling_intent' };
  await ensureRows(childId);
  var row = await getActivity(childId, 'search');
  if (row && ['complete', 'not_required'].indexOf(row.status) >= 0) return { applied: false, reason: 'already_settled' };
  // The activity may never have been assigned — that is the common case, and it is precisely the point:
  // nobody should be asked to search for what the requestor already handed over.
  await run('UPDATE mrr_tasks SET status = ?, completed_at = ?, completion_basis = ?, ' +
    'completed_by_name = ?, updated_at = ? WHERE id = ?',
    ['complete', nowStr(), 'fulfilling_record', 'System · requestor’s selection', nowStr(), row.id]);
  if (row.task_id) {
    await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('done','cancelled')", [row.task_id]);
  }
  await history(childId, opts, 'MRR_SEARCH_AUTO_COMPLETED',
    'Record search for this item completed automatically: the requestor marked ' +
    ((sel && sel.n) ? sel.n + ' attached library record(s)' : 'an attached library record') +
    ' as FULFILLING this item at submission. Their own words, captured at submit — nothing was inferred.');
  return { applied: true, selectedRecords: (sel && sel.n) || 0 };
}

// ── ESTIMATE DATA, AND THE READINESS METER ───────────────────────────────────────────────────────
//
// Kevin 7/28 item 7. `complete` is a per-child fact SOMEBODY WROTE — never inferred from an activity
// status, because "the searcher finished" is not "the numbers exist". Marking the data complete also
// settles the `estimate` activity, which is what the child view shows ("Entered by … / View-edit data"):
// on this screen the estimate activity IS the data entry.
//
// Where the entry FORM lives is Draft 5 §3 question 5 and unanswered; the conservative build puts a small
// form on the child view (a drawer would be a bigger claim) and leaves the master's Generate Estimate to
// the standard engine, untouched.
async function saveEstimateData(childId, values, opts) {
  opts = opts || {};
  values = values || {};
  var child = await get('SELECT id, master_request_id FROM requests WHERE id = ?', [childId]);
  if (!child) { var e = new Error('Item not found.'); e.code = 'NOT_FOUND'; e.status = 404; throw e; }
  var existing = await get('SELECT * FROM mrr_estimate_data WHERE request_id = ?', [childId]);
  var complete = values.complete ? 1 : 0;
  var num = function (v) { return (v === '' || v == null) ? null : Number(v); };
  if (!existing) {
    await run('INSERT INTO mrr_estimate_data (id, request_id, parent_request_id, labor_minutes, page_count, ' +
      'media_count, other_cost, estimated_cost, notes, complete, entered_by, entered_by_name, entered_at, created_at, updated_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['mrre-' + uuidv4().substring(0, 8), childId, child.master_request_id || null,
        num(values.laborMinutes), num(values.pageCount), num(values.mediaCount), num(values.otherCost),
        num(values.estimatedCost), s(values.notes) || null, complete,
        opts.actorId || null, opts.actorName || null, nowStr(), nowStr(), nowStr()]);
  } else {
    await run('UPDATE mrr_estimate_data SET labor_minutes = ?, page_count = ?, media_count = ?, other_cost = ?, ' +
      'estimated_cost = ?, notes = ?, complete = ?, entered_by = ?, entered_by_name = ?, entered_at = ?, updated_at = ? WHERE id = ?',
      [num(values.laborMinutes), num(values.pageCount), num(values.mediaCount), num(values.otherCost),
        num(values.estimatedCost), s(values.notes) || null, complete,
        opts.actorId || null, opts.actorName || null, nowStr(), nowStr(), existing.id]);
  }
  await ensureRows(childId);
  if (complete) {
    var row = await getActivity(childId, 'estimate');
    if (row && row.status !== 'not_required') {
      await run('UPDATE mrr_tasks SET status = ?, completed_at = ?, completed_by = ?, completed_by_name = ?, ' +
        'completion_basis = ?, updated_at = ? WHERE id = ?',
        ['complete', nowStr(), opts.actorId || null, opts.actorName || null, 'person', nowStr(), row.id]);
      if (row.task_id) {
        await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('done','cancelled')", [row.task_id]);
      }
    }
  }
  await history(childId, opts, complete ? 'MRR_ESTIMATE_DATA_COMPLETE' : 'MRR_ESTIMATE_DATA_SAVED',
    'Estimate data for this item ' + (complete ? 'marked complete' : 'saved') +
    '. One estimate is generated for the MASTER record through the standard engine when every item is complete.');
  return await estimateData(childId);
}

async function estimateData(childId) {
  var row = await get('SELECT * FROM mrr_estimate_data WHERE request_id = ?', [childId]);
  return row || { request_id: childId, complete: 0, entered_by_name: null };
}

// n of m. `m` counts the LIVE items: an item that has ended (closed) is not waiting on anybody's numbers,
// and a meter that can never reach m is a meter nobody trusts.
async function readiness(parentId) {
  var kids = await all("SELECT id, status, component_label, description FROM requests WHERE master_request_id = ? ORDER BY component_label, created_at", [parentId]);
  var live = kids.filter(function (k) { return k.status !== 'closed'; });
  var data = await all('SELECT request_id, complete FROM mrr_estimate_data WHERE parent_request_id = ?', [parentId]);
  var doneSet = {};
  data.forEach(function (d) { if (Number(d.complete) === 1) doneSet[d.request_id] = true; });
  var n = live.filter(function (k) { return doneSet[k.id]; }).length;
  var m = live.length;
  return {
    n: n, m: m, ready: m > 0 && n === m,
    pending: live.filter(function (k) { return !doneSet[k.id]; })
      .map(function (k) { return { id: k.id, label: k.component_label || 'Item', description: truncate(k.description, 70) }; }),
    // Said in the server's words so the screen never has to invent the sentence, and so Verify ≠ Approve
    // survives the trip to the browser.
    armingRule: 'Generate estimate arms when every item’s estimate data is complete. It produces ONE estimate ' +
      'for the master record through the standard engine — staff VERIFY it, the REQUESTOR approves it. Those are ' +
      'two acts by two people, because requestor approval is a statutory trigger in some states.'
  };
}

// ── DENIAL DESIGNATION — A REFERRAL, NOT AN ENDING ───────────────────────────────────────────────
//
// Kevin 7/28 item 6. The word "denial" is here and the ACT is not: this flags the item and spawns
// `legal_review` with the manager's grounds attached. Legal decides; BW5's deny-close-notify writes the
// ending if it is upheld; Draft 3 composes the letter. NOTHING in this function can close a record, and
// that is deliberate — a manager designating is stating a position, not exercising a denial power.
async function designateDenial(childId, opts) {
  opts = opts || {};
  var grounds = s(opts.grounds);
  if (!grounds) {
    var e = new Error('A denial designation carries your grounds — legal reviews the grounds, not the label.');
    e.code = 'GROUNDS_REQUIRED'; e.status = 422; throw e;
  }
  var child = await get('SELECT * FROM requests WHERE id = ?', [childId]);
  if (!child) { var e1 = new Error('Item not found.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  if (Number(child.mrr_denial_designated) === 1) {
    var e2 = new Error('This item is already designated and with Legal Review.'); e2.code = 'ALREADY_DESIGNATED'; e2.status = 409; throw e2;
  }
  var parent = child.master_request_id ? await get('SELECT * FROM requests WHERE id = ?', [child.master_request_id]) : null;
  var tr = require('./taskRouting');
  var task = await tr.createTask({
    requestId: childId, type: 'legal_review',
    title: 'Legal review — denial designated on ' + ((parent && parent.request_number) || child.request_number) +
      ' · ' + (child.component_label || 'item'),
    teamId: null, createdBy: opts.actorId || 'system'
  });
  try { await tr.autoRouteOrPool(task.id, null, {}); } catch (e) { console.error('[mrrHub designate route]', e && e.message); }

  await run('UPDATE requests SET mrr_denial_designated = 1, mrr_denial_grounds = ?, mrr_denial_by = ?, ' +
    'mrr_denial_at = ?, mrr_denial_legal_task_id = ?, updated_at = ? WHERE id = ?',
    [grounds, opts.actorName || 'Request Manager', nowStr(), task.id, nowStr(), childId]);
  await history(childId, opts, 'MRR_DENIAL_DESIGNATED',
    'Denial DESIGNATED on this item and submitted for Legal Review — grounds: ' + grounds +
    '. A designation is not a denial: legal decides, and only a legal decision can close this item as denied.');
  return { designated: true, legalTaskId: task.id, grounds: grounds };
}

async function withdrawDesignation(childId, opts) {
  opts = opts || {};
  var child = await get('SELECT * FROM requests WHERE id = ?', [childId]);
  if (!child || Number(child.mrr_denial_designated) !== 1) {
    var e = new Error('No designation stands on this item.'); e.code = 'NOT_DESIGNATED'; e.status = 409; throw e;
  }
  if (child.mrr_denial_legal_task_id) {
    await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('done','cancelled')", [child.mrr_denial_legal_task_id]);
  }
  await run('UPDATE requests SET mrr_denial_designated = 0, mrr_denial_legal_task_id = NULL, updated_at = ? WHERE id = ?', [nowStr(), childId]);
  await history(childId, opts, 'MRR_DENIAL_DESIGNATION_WITHDRAWN',
    'Denial designation withdrawn' + (s(opts.note) ? ' — ' + s(opts.note) : '.') +
    ' The grounds stay on the record: a position taken and reconsidered is part of the history.');
  return { designated: false };
}

// ── ATTACHMENTS, PER ITEM (§0b) ──────────────────────────────────────────────────────────────────
//
// "Attachments ride the item, not the master record." Children ARE requests, so `request_files` keyed on
// the child already is per-item storage — nothing new is needed, and the count on the bar and the panel on
// the child view read the same rows the MRR SEARCH task screen reads.
async function attachments(childId) {
  var files = await all("SELECT id, original_name, filename, mimetype, size, uploaded_by, uploaded_at, status " +
    "FROM request_files WHERE request_id = ? ORDER BY uploaded_at", [childId]);
  var intents = await all('SELECT id, seq, description, intent FROM request_search_intents WHERE request_id = ? ORDER BY seq', [childId]);
  var selected = await all('SELECT id, record_id, title, source_system FROM request_selected_records WHERE request_id = ? ORDER BY created_at', [childId]);
  var fulfilling = intents.filter(function (i) { return i.intent === 'complete'; });
  return {
    files: files, count: files.length,
    selectedRecords: selected,
    fulfillingIntents: fulfilling,
    // The sentence the panel prints. Written here because it is a RULE, not a caption.
    ridesWithItem: 'Attachments ride this item into its MRR SEARCH task — the searcher sees them there, not on the master record.',
    fulfilsNote: fulfilling.length
      ? 'The requestor marked their selection as fulfilling this item, so its search completes on arrival rather than being assigned.'
      : null
  };
}

// ── THE MASTER RECORD READ ───────────────────────────────────────────────────────────────────────
//
// One call for the whole hub. The parent's STATE is read, never computed: `deriveParent` owns it (§5.8),
// and this endpoint reports what that derivation left behind.
async function master(parentId) {
  var parent = await get('SELECT * FROM requests WHERE id = ?', [parentId]);
  if (!parent) return { known: false };
  var kids = await all('SELECT * FROM requests WHERE master_request_id = ? ORDER BY component_label, created_at', [parentId]);

  var items = [];
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    var acts = await activities(k.id);
    var att = await get('SELECT count(*)::int AS n FROM request_files WHERE request_id = ?', [k.id]).catch(function () { return { n: 0 }; });
    var ed = await get('SELECT complete, entered_by_name, entered_at, estimated_cost FROM mrr_estimate_data WHERE request_id = ?', [k.id]);
    var ext = acts.filter(function (a) { return a.external_email; })[0];
    var defect = await defectOf(k.id);
    // ONE ASSIGNEE LINE on the bar: the person carrying live work, else the last person who did any.
    var live = acts.filter(function (a) { return a.status === 'in_process' || a.status === 'queued'; })[0];
    var anyone = live || acts.filter(function (a) { return a.assignee_name; })[0];
    items.push({
      id: k.id, requestNumber: k.request_number, label: k.component_label || ('Item ' + (i + 1)),
      // VERBATIM. The bar's line is a TRUNCATION of the requestor's own words, never a summary (§0b).
      description: k.description, descriptionShort: truncate(k.description, 96),
      status: k.status, stage: k.stage, closureReason: k.closure_reason || null,
      activities: acts,
      assigneeName: anyone ? anyone.assignee_name : null,
      attachmentCount: (att && att.n) || 0,
      estimateData: ed ? { complete: Number(ed.complete) === 1, enteredByName: ed.entered_by_name, enteredAt: ed.entered_at, estimatedCost: ed.estimated_cost } : { complete: false },
      denial: Number(k.mrr_denial_designated) === 1
        ? { designated: true, grounds: k.mrr_denial_grounds, by: k.mrr_denial_by, at: k.mrr_denial_at, legalTaskId: k.mrr_denial_legal_task_id }
        : { designated: false },
      defect: defect,
      // The token substrate is REAL now (2026-08-01) — the bar shows the link's actual state, read from
      // the token store by activities() above.
      external: ext ? (ext.external || { email: ext.external_email, linkState: 'sent' }) : null
    });
  }

  var ready = await readiness(parentId);
  var clocks = await parentClocks(parentId);
  return {
    known: true,
    parent: {
      id: parent.id, requestNumber: parent.request_number, description: parent.description,
      requestorName: parent.requestor_name, requestorEmail: parent.requestor_email,
      requestorType: parent.requestor_type, deliveryMethod: parent.delivery_method,
      submissionChannel: parent.submission_channel, createdAt: parent.created_at,
      // READ, never recomputed. disposition.deriveParent owns this (§5.8).
      state: parent.status === 'closed' ? 'complete' : 'in_process',
      stateIsDerived: true,
      stateNote: 'The master record’s state is DERIVED from its items — it is never closed by hand, and a reopened item un-derives it.'
    },
    items: items, itemCount: items.length,
    readiness: ready,
    clocks: clocks,
    // Statutory clock is MASTER-ONLY (§4.2). Said out loud so a child screen never renders one.
    clockScope: 'The statutory clock is a MASTER-record object: one legal deadline per citizen request, never one per item.',
    orderEnforced: ORDER_ENFORCED,
    orderNote: 'No ordering is enforced between an item’s activities. On a multi-record request the manager orchestrates; ' +
      'the engine does not. “Queued” beside an unfinished search is a convention, not a gate.'
  };
}

// ── THE ITEM'S DEFECT, READ WHERE IT WAS WRITTEN ─────────────────────────────────────────────────
//
// There is no `request_defects` table and this build does not add one. `clarificationAction.send` records
// the defect in the REQUEST HISTORY ("flagged vague" / "flagged OVERLY BROAD") alongside the outreach that
// carries it, and `taskPause` records the pause it caused. Reading the same rows keeps ONE record of a
// defect: a second store would be a second truth, and the two would drift the first time somebody resolved
// a clarification through the machinery that already exists.
async function defectOf(childId) {
  var rows = await all("SELECT action, notes, created_at FROM request_history WHERE request_id = ? " +
    "AND action IN ('CLARIFICATION_REQUESTED','CLARIFICATION_RESOLVED') ORDER BY created_at DESC LIMIT 5", [childId]);
  if (!rows.length) return null;
  if (rows[0].action === 'CLARIFICATION_RESOLVED') return null;   // answered; the flag is spent
  var n = rows[0].notes || '';
  var reason = /flagged OVERLY BROAD/i.test(n) ? 'overly_broad' : (/flagged vague/i.test(n) ? 'vague' : null);
  if (!reason) return null;
  return { reason: reason, label: reason === 'vague' ? 'Vague' : 'Overly broad', at: rows[0].created_at,
    outstanding: true };
}

async function parentClocks(parentId) {
  var out = [];
  try {
    var tolling = require('./tolling');
    var rules = await tolling.loadRules();
    var rows = await all('SELECT * FROM request_clocks WHERE request_id = ? ORDER BY is_primary DESC, created_at', [parentId]);
    for (var i = 0; i < rows.length; i++) {
      var tolls = await all('SELECT * FROM clock_tolls WHERE clock_id = ? ORDER BY created_at', [rows[i].id]);
      var st = tolling.computeStatus(rows[i], tolls, rules);
      out.push({ kind: st.kind, label: st.label, dueDate: st.dueDate, citation: st.citation,
        legalDeadline: st.legalDeadline, operationalTarget: st.operationalTarget, isOverdue: st.isOverdue,
        overdueMeaning: st.overdueMeaning, exposures: st.exposures, state: st.state, isPrimary: st.isPrimary });
    }
  } catch (e) { console.error('[mrrHub clocks]', e && e.message); }
  return out;
}

// ── THE OVERVIEW — MY MRRs (round 2: my-MRRs only) ───────────────────────────────────────────────
//
// Scoped to the `mrr_management` tasks THIS person holds. The all-office view with a manager column is
// oversight authority (Supervisor / Director) and is NOT a tab here — resolved, Draft 5 §3 question 1.
async function overview(userId) {
  var tasks = await all("SELECT * FROM tasks WHERE type = 'mrr_management' AND assigned_to = ? " +
    "AND status IN ('assigned','in_progress','open','returned','awaiting_review') ORDER BY updated_at DESC", [userId]);
  var rows = [];
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    var p = await get('SELECT * FROM requests WHERE id = ?', [t.request_id]);
    if (!p) continue;
    var kids = await all('SELECT id, status, mrr_denial_designated FROM requests WHERE master_request_id = ?', [p.id]);
    var ready = await readiness(p.id);
    var clocks = await parentClocks(p.id);
    var vague = 0;
    for (var j = 0; j < kids.length; j++) {
      var d = await defectOf(kids[j].id);
      if (d) vague++;
    }
    rows.push({
      taskId: t.id, requestId: p.id, requestNumber: p.request_number,
      requestorName: p.requestor_name, description: p.description, descriptionShort: truncate(p.description, 90),
      itemCount: kids.length,
      openItems: kids.filter(function (k) { return k.status !== 'closed'; }).length,
      readiness: ready,
      clock: clocks.filter(function (c) { return c.isPrimary; })[0] || clocks[0] || null,
      flags: {
        vague: vague,
        denialDesignated: kids.filter(function (k) { return Number(k.mrr_denial_designated) === 1; }).length
      },
      // READ. deriveParent owns it.
      parentState: p.status === 'closed' ? 'complete' : 'in_process'
    });
  }
  return { scope: 'my_mrrs', rows: rows,
    scopeNote: 'Scoped to the MRRs assigned to you. With several eligible associates in the office each holds only ' +
      'their own; the all-office view is oversight authority (Supervisor / Director), not a tab on this screen.' };
}

// ── PER-CHILD RELEASE — THROUGH THE EXISTING GATES, NEVER AROUND THEM ────────────────────────────
//
// Draft 5 §3 question 4 (unanswered) drafted BOTH ways; the conservative build surfaces a READ here and a
// release that must pass the two gates that already exist:
//
//   feeRelease.releaseGate    §5.9 coverage — THIS record's own share. A child is never withheld because a
//                             SIBLING is unpaid. Money gating lives there and is not re-implemented here.
//   releaseHold.holdState     the RM hold, and its installment-entitlement PREVENTION guard. When it
//                             refuses, its refusal is surfaced VERBATIM — a paraphrased legal refusal is a
//                             different refusal.
//
// MRR STAYS OUT OF THE AUTO-RELEASE PIPELINE. autoRelease's NON_MRR condition is untouched: this is the
// manager's manual act on one item, which is exactly the orchestration that condition reserves for them.
async function releaseState(childId) {
  var FR = require('./feeRelease');
  var RH = require('./releaseHold');
  var gate = null, hold = null;
  try { gate = await FR.releaseGate(childId); } catch (e) { gate = null; }
  try { hold = await RH.holdState(childId); } catch (e) { hold = null; }
  var moneyOk = !gate || !gate.requiresPaymentBeforeRelease || gate.covered;
  var held = !!(hold && hold.held);
  return {
    requestId: childId, gate: gate, hold: hold,
    canRelease: moneyOk && !held,
    blockedBy: held ? 'hold' : (moneyOk ? null : 'funds'),
    // The exact refusal words of whichever gate refuses. Never rewritten.
    blockedReason: held
      ? ('A release hold stands on this item — ' + (hold.note || 'no note recorded') + '.')
      : (moneyOk ? null
        : ('This item’s own share is not covered: $' + (gate.balanceDue != null ? gate.balanceDue : '?') +
           ' is outstanding on it. (A sibling’s unpaid balance is never a reason to withhold this one — §5.9.)')),
    holdControl: hold ? { canHold: hold.canHold, blockedReason: hold.blockedReason, citation: hold.citation } : null,
    pipelineNote: 'A multi-record request never auto-ships: the release pipeline’s NON_MRR condition reserves this ' +
      'to the Request Manager, behind the funds gate. This is that act, per item.'
  };
}

module.exports = {
  ACTIVITIES: ACTIVITIES, TASK_TYPE: TASK_TYPE, LABEL: LABEL, ACTIVITY_NAME: ACTIVITY_NAME,
  STATUSES: STATUSES, STATUS_LABEL: STATUS_LABEL, ORDER_ENFORCED: ORDER_ENFORCED,
  ensureRows: ensureRows, activities: activities, getActivity: getActivity,
  spawnActivity: spawnActivity, startActivity: startActivity, completeActivity: completeActivity,
  setNotRequired: setNotRequired, autoCompleteFulfilledSearch: autoCompleteFulfilledSearch,
  saveEstimateData: saveEstimateData, estimateData: estimateData, readiness: readiness,
  designateDenial: designateDenial, withdrawDesignation: withdrawDesignation,
  attachments: attachments, master: master, overview: overview, releaseState: releaseState,
  defectOf: defectOf, parentClocks: parentClocks,
  isMrrParentRow: isMrrParentRow
};
