'use strict';
// PHASE 7 / BW5 — THE DISPOSITION MODEL: how a request item ENDS, and who is allowed to end it.
//
// Normative source: docs/DRAFT_processing_ui_disposition_close.md rev 2 (+ its §3 decisions, all decided
// with Kevin 2026-07-29) and docs/SPEC_processing_ui.md §4.
//
// ══ THE ONE IDEA ══
//
// CLOSING HAPPENS WHERE THE EVIDENCE LIVES. Before rev 2 the design had a close SCREEN; Kevin's 7/28
// direction replaced it with closes that live inside the task that holds the proof — a no-records close
// belongs beside the effort trail, a denial belongs inside the determination that denied it, delivery
// belongs to the release event that produced it. This module is the shared machinery under all of them:
// one vocabulary, one gate evaluator, one close act, one approval flow.
//
// ══ THE EIGHT §5.8 ENDINGS, AND THE THREE LEGACY SWEEP REASONS ══
//
// The eight are the vocabulary; the extra three (`deposit_unpaid`, `estimate_lapsed`, `abandoned`) are
// closure_reason strings the codebase ALREADY writes from sweeps that predate this model. They are not new
// endings — they are variants of the two lapse endings — but they exist on live rows, so the record screen
// must be able to render them rather than showing a closed request with an ending it cannot name.
//
// ══ CLOSE = ONE ACT (rev 2, carried from rev 1 unchanged) ══
//
// A disposition write and its notice are ONE act, blocked-with-reason. Not two buttons, not a notice that
// a later sweep might send: `close()` writes the ending, transitions the stage through the ONE central
// transition, sends the notice, and derives the parent — or it refuses with a stated cause and writes
// nothing. Compliance rule 1 ("every close owes a notice") is only enforceable if there is exactly one
// place a close can happen.
//
// ══ THE TWO GATES NEVER FEED EACH OTHER (Kevin, explicit) ══
//
// A no-records close needs BOTH an effort trail AND every duty-carrying portal description answered, and
// neither one may satisfy the other. Answering a description is a CLAIM ("there is nothing more"); the
// effort trail is EVIDENCE ("here is what I did"). A system that let an answered description count as
// effort would let a searcher close a request by asserting the conclusion.
//
// ══ WHO MAY CLOSE: `close_approval`, resolved per department per ending ══
//
// BW2 built the resolver (services/processingConfig.closeApprovalFor) and deliberately left it unread.
// This is its reader. `direct` = Submit only · `either` (DEFAULT) = both doors, the closer chooses ·
// `approval_required` = route only. A routed close is a VISIBLE state (`request_close_approvals`, status
// pending) plus a lightweight approval task; on approval the close executes and is recorded as the
// APPROVER's act. Two-eyes is NOT required here — the rule is only that the approver differs from the
// requester of the close, which is a weaker and different thing (a supervisor may approve a close on a
// request whose search they helped with; they may not approve their own close).
var db = require('../db');
var get = db.get, all = db.all, run = db.run;
var uuidv4 = require('uuid').v4;
var PC = require('./processingConfig');
var CN = require('./closureNotice');
var SI = require('./searchIntents');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function s(v) { return String(v == null ? '' : v).trim(); }

// ── THE VOCABULARY ────────────────────────────────────────────────────────────────────────────────
//
// `key`          the ending, and the `close_approval` config key (processingConfig.ENDINGS)
// `reason`       the value written to requests.closure_reason
// `action`       the request_history action for the close
// `where`        where it is finalized — the rev-2 table, in data
// `decidedBy`    the DecidedByBadge value the record screen renders (rule c)
var ENDINGS = {
  no_records: {
    key: 'no_records', reason: 'no_records', label: 'Closed – No records located', action: 'CLOSED_NO_RECORDS',
    where: 'record_search_task', decidedBy: 'person', manual: true, gated: true,
    evidence: 'The diligent-search effort trail and the answered portal descriptions.'
  },
  not_in_custody: {
    key: 'not_in_custody', reason: 'not_in_custody', label: 'Closed – Not in our custody (referred)',
    action: 'CLOSED_NOT_IN_CUSTODY', where: 'record_search_task', decidedBy: 'person', manual: true, gated: true,
    evidence: 'The named custodian and the referral record sent to the requester.'
  },
  denial: {
    key: 'denial', reason: 'denial', label: 'Closed – Denied', action: 'CLOSED_DENIED',
    where: 'legal_review_or_denial_compose', decidedBy: 'person', manual: true, gated: false,
    evidence: 'The asserted exemption, its citation, and the legal review that recorded it.'
  },
  fulfilled: {
    key: 'fulfilled', reason: 'fulfilled', label: 'Closed – Delivered', action: 'CLOSED_DELIVERED',
    where: 'release_event', decidedBy: 'system', manual: false, gated: false,
    evidence: 'The release event: what was delivered, when, and as which installment.'
  },
  withdrawn: {
    key: 'withdrawn', reason: 'withdrawn', label: 'Closed – Withdrawn by requester', action: 'CLOSED_WITHDRAWN',
    where: 'disposition_record', decidedBy: 'person', manual: true, gated: true,
    evidence: "The requester's withdrawal communication, attached to the request."
  },
  previously_furnished: {
    key: 'previously_furnished', reason: 'previously_furnished', label: 'Closed – Previously furnished',
    action: 'CLOSED_PREVIOUSLY_FURNISHED', where: 'disposition_record', decidedBy: 'person', manual: true, gated: true,
    evidence: 'The §552.232 certification: prior request number, date, and the match attestation.'
  },
  no_clarification: {
    key: 'no_clarification', reason: 'no_clarification', label: 'Closed – No response', action: 'CLOSED_NO_CLARIFICATION',
    where: 'sweep', decidedBy: 'system', manual: false, sweep: true,
    evidence: 'The clarification sent, and the elapsed response window (a numeric basis).'
  },
  nonpayment: {
    key: 'nonpayment', reason: 'nonpayment', label: 'Closed – Non-payment', action: 'CLOSED_NONPAYMENT',
    where: 'sweep', decidedBy: 'system', manual: false, sweep: true,
    evidence: 'The unpaid invoice, the dunning reminder, and the elapsed window.'
  },
  // ── legacy sweep reasons already written by live code. Displayed, never offered. ──
  deposit_unpaid: {
    key: 'deposit_unpaid', reason: 'deposit_unpaid', label: 'Closed – Deposit never paid', action: 'CLOSED_DEPOSIT_UNPAID',
    where: 'sweep', decidedBy: 'system', manual: false, sweep: true, evidence: 'The deposit clock and the unpaid deposit record.'
  },
  estimate_lapsed: {
    key: 'estimate_lapsed', reason: 'estimate_lapsed', label: 'Closed – Estimate lapsed', action: 'CLOSED_ESTIMATE_LAPSED',
    where: 'sweep', decidedBy: 'system', manual: false, sweep: true, evidence: 'The estimate sent, and the elapsed acceptance window.'
  },
  abandoned: {
    key: 'abandoned', reason: 'abandoned', label: 'Closed – Abandoned', action: 'CLOSED_ABANDONED',
    where: 'sweep', decidedBy: 'system', manual: false, sweep: true, evidence: 'The tickler trail showing the request went unanswered.'
  }
};
var ENDING_KEYS = Object.keys(ENDINGS);

// The two endings the RECORD SEARCH task's rail may finalize (rev 2 Frame A). Denial is deliberately not
// here: an exemption discovered during a search goes to Legal Review, which owns the determination.
var TASK_CLOSE_ENDINGS = ['no_records', 'not_in_custody'];
// The two endings with no task to live in — the Disposition record screen's only acts (rev 2 Frame C).
var MANUAL_RECORD_ENDINGS = ['withdrawn', 'previously_furnished'];

// closure_reason -> ending. TOLERANT: an unrecognised legacy string is reported as an unknown ending
// rather than mapped onto a neighbour, because a record screen that renames a closure is worse than one
// that admits it does not recognise it.
function endingOf(closureReason) {
  var r = s(closureReason);
  if (!r) return null;
  if (ENDINGS[r]) return ENDINGS[r];
  // Historic variants seen live.
  if (/nonpayment/i.test(r)) return ENDINGS.nonpayment;
  if (/no[_ -]?records/i.test(r)) return ENDINGS.no_records;
  return null;
}

// ── THE EFFORT TRAIL (evidence, never a claim) ────────────────────────────────────────────────────
//
// The same action set the record-search resolve path has always enforced. Kept here so the popup's gate
// and the route's refusal read ONE definition — the "one gate, two readers" rule.
var EFFORT_ACTIONS = ['CONSULT_REQUESTED', 'CALL_LOGGED', 'CLARIFICATION_REQUESTED', 'RECORD_ATTACHED', 'SEARCH_RUN'];

async function effortTrail(requestId) {
  var ph = EFFORT_ACTIONS.map(function () { return '?'; }).join(',');
  var rows = await all(
    'SELECT action, notes, actor_name, created_at FROM request_history WHERE request_id = ? AND action IN (' + ph + ') ' +
    'ORDER BY created_at DESC LIMIT 25', [requestId].concat(EFFORT_ACTIONS));
  return { count: rows.length, entries: rows };
}

// ── THE GATE ──────────────────────────────────────────────────────────────────────────────────────
//
// One evaluator, two readers: the popup renders the rows, the route refuses on `blocked`. Every row is a
// sentence a person can act on — "☐ Closure note required" is not a gate, it is a scold.
//   payload: { note, custodianName, custodianContact, referralNote, withdrawalCommunicationId,
//              priorRequestNumber, priorRequestDate, matchAttested }
async function gateFor(requestId, ending, payload) {
  payload = payload || {};
  var def = ENDINGS[ending];
  var rows = [];
  if (!def) {
    return { ending: ending, known: false, blocked: true, rows: [],
             reasons: [{ code: 'UNKNOWN_ENDING', text: 'There is no such ending: "' + ending + '".' }] };
  }

  var note = s(payload.note);

  if (ending === 'no_records') {
    var eff = await effortTrail(requestId);
    rows.push({ code: 'NO_EFFORT_TRAIL', ok: eff.count > 0,
      text: eff.count > 0
        ? 'Effort trail is non-empty — ' + eff.count + ' logged action(s) evidence the search.'
        : 'Nothing has been logged on this request. A no-records closure has to be evidenced — run a search, log a call, or confer first.' });
    // THE SECOND GATE, AND IT IS NOT THE FIRST ONE AGAIN. `openIntents` are the duty-carrying portal
    // descriptions the requester asked the team to search. Answering them is a CLAIM about the world;
    // the effort trail is the EVIDENCE for it. Neither satisfies the other, ever.
    var open = [];
    try { open = await SI.openIntents(requestId); } catch (e) { open = []; }
    rows.push({ code: 'UNRESOLVED_SEARCH_INTENT', ok: open.length === 0,
      text: open.length === 0
        ? 'Every duty-carrying description the requester submitted has been answered.'
        : (open.length === 1
          ? 'The requester asked the team to search for “' + open[0].description + '”. Answer that description before closing.'
          : open.length + ' descriptions the requester submitted still need an answer before closing.'),
      openIntents: open.map(function (i) { return { id: i.id, description: i.description, intent: i.intent }; }) });
    rows.push({ code: 'CLOSURE_NOTE_REQUIRED', ok: !!note,
      text: note ? 'Closure note recorded — why this search is exhaustive.'
                 : 'A closure note is required — the trail is the evidence, the note is the reasoning. Say why this search is exhaustive.' });
  } else if (ending === 'not_in_custody') {
    rows.push({ code: 'CUSTODIAN_REQUIRED', ok: !!s(payload.custodianName),
      text: s(payload.custodianName)
        ? 'Custodian named: ' + s(payload.custodianName) + '.'
        : 'Name the custodian you believe holds these records. A referral that names nobody sends the requester nowhere.' });
    rows.push({ code: 'REFERRAL_RECORD_REQUIRED', ok: !!s(payload.referralNote),
      text: s(payload.referralNote)
        ? 'Referral record on file — it rides the closure notice to the requester.'
        : 'Record the referral: what you are telling the requester about where to go, and why these records are not ours.' });
    rows.push({ code: 'CLOSURE_NOTE_REQUIRED', ok: !!note,
      text: note ? 'Closure note recorded.' : 'A closure note is required — say how you determined these records are not in this office’s custody.' });
  } else if (ending === 'withdrawn') {
    // A WITHDRAWAL IS A CHOICE, NOT SILENCE. That distinction is the entire reason `withdrawn` and
    // `no_clarification` are two endings, so the gate is the communication itself, on file.
    var comm = await withdrawalCommunications(requestId);
    var picked = s(payload.withdrawalCommunicationId);
    var found = picked ? comm.filter(function (c) { return c.id === picked; })[0] : comm[0];
    rows.push({ code: 'WITHDRAWAL_COMMUNICATION_REQUIRED', ok: !!found,
      text: found
        ? 'Withdrawal communication on file — logged ' + (found.created_at || '') + ' by ' + (found.actor_name || 'staff') + '.'
        : 'Attach the requester’s withdrawal communication first. Withdrawn is a choice they made; silence is a different ending.' });
    rows.push({ code: 'CLOSURE_NOTE_REQUIRED', ok: !!note,
      text: note ? 'Closure note recorded.' : 'A closure note is required — record what the requester asked for.' });
  } else if (ending === 'previously_furnished') {
    rows.push({ code: 'PRIOR_REQUEST_REQUIRED', ok: !!s(payload.priorRequestNumber),
      text: s(payload.priorRequestNumber) ? 'Prior request: ' + s(payload.priorRequestNumber) + '.'
        : 'Give the prior request number the records were furnished under.' });
    rows.push({ code: 'PRIOR_DATE_REQUIRED', ok: !!s(payload.priorRequestDate),
      text: s(payload.priorRequestDate) ? 'Furnished on ' + s(payload.priorRequestDate) + '.'
        : 'Give the date the records were furnished.' });
    rows.push({ code: 'MATCH_ATTESTATION_REQUIRED', ok: payload.matchAttested === true,
      text: payload.matchAttested === true
        ? 'Certified: the records requested here are the same records previously furnished.'
        : 'Certify that these are the SAME records previously furnished. This is a certification, not a denial — it has to be true.' });
  }

  var blocked = rows.some(function (r) { return !r.ok; });
  return {
    ending: ending, known: true, label: def.label, blocked: blocked, rows: rows,
    reasons: rows.filter(function (r) { return !r.ok; }).map(function (r) { return { code: r.code, text: r.text }; })
  };
}

// Communications logged as a withdrawal. One definition, three readers: the gate above, the spawner below,
// and the Disposition record's evidence link.
async function withdrawalCommunications(requestId) {
  return await all(
    "SELECT id, actor_name, notes, created_at FROM request_history WHERE request_id = ? " +
    "AND action = 'WITHDRAWAL_COMMUNICATION' ORDER BY created_at DESC", [requestId]);
}

// ── close_approval — which doors are open for THIS request and THIS ending ────────────────────────
async function approvalModeFor(requestId, ending) {
  var r = await get('SELECT department_id FROM requests WHERE id = ?', [requestId]);
  var resolved = await PC.closeApprovalFor(null, r && r.department_id, ending);
  return {
    mode: resolved.mode, source: resolved.source,
    canSubmit: resolved.mode === 'direct' || resolved.mode === 'either',
    canRoute: resolved.mode === 'approval_required' || resolved.mode === 'either'
  };
}

// ── PARENT DERIVATION (§5.8: the parent derives Complete; it is never closed by hand) ─────────────
//
// A parent whose children have all ended IS complete — that is a derived fact, not an act, so it is
// computed here rather than asserted by whoever happened to close the last child. The inverse matters
// just as much: a reopened child UN-derives it (stage 2's reopen path calls this with the child active).
async function deriveParent(childId) {
  var child = await get('SELECT id, master_request_id FROM requests WHERE id = ?', [childId]);
  if (!child || !child.master_request_id) return { derived: false, reason: 'not_a_child' };
  var pid = child.master_request_id;
  var kids = await all('SELECT id, status FROM requests WHERE master_request_id = ?', [pid]);
  if (!kids.length) return { derived: false, reason: 'no_children' };
  var openKids = kids.filter(function (k) { return k.status !== 'closed'; });
  var parent = await get('SELECT id, stage, status FROM requests WHERE id = ?', [pid]);
  if (!parent) return { derived: false, reason: 'no_parent' };

  if (openKids.length === 0) {
    if (parent.status === 'closed') return { derived: false, parentId: pid, already: true };
    await require('./taskRouting').applyStageTransition(pid, 'closed', {
      actorName: 'System', action: 'PARENT_DERIVED_COMPLETE',
      notes: 'All ' + kids.length + ' item(s) have ended, so the request derives Complete. A parent is never closed by hand.'
    });
    return { derived: true, parentId: pid, parentState: 'complete', openChildren: 0 };
  }
  // At least one child is live. If the parent had derived Complete, it must UN-derive.
  if (parent.status === 'closed') {
    await require('./taskRouting').applyStageTransition(pid, 'record_search', {
      // Past the from-closed guard: a derived state following its children is not a decision, and the
      // parent was never closed by an act in the first place.
      reopen: true,
      actorName: 'System', action: 'PARENT_UNDERIVED',
      notes: openKids.length + ' item(s) are live again, so the request is back In Process. Derived completion is not a decision — it follows the items.'
    });
    await run("UPDATE requests SET closure_reason = NULL WHERE id = ?", [pid]);
    // Reactivate the MRR Management task if it had ended with the parent. `closed` cancels every open
    // task, so the hub the ORO Associate works from is gone; a live child with no hub is a stranded item.
    try {
      var mrr = await get("SELECT id, status FROM tasks WHERE request_id = ? AND type = 'mrr_management' ORDER BY created_at DESC LIMIT 1", [pid]);
      if (mrr && ['cancelled', 'done'].indexOf(mrr.status) >= 0) {
        await run("UPDATE tasks SET status = 'open', updated_at = datetime('now') WHERE id = ?", [mrr.id]);
      }
    } catch (e) { console.error('[deriveParent mrr]', e && e.message); }
    return { derived: true, parentId: pid, parentState: 'in_process', openChildren: openKids.length, reactivated: true };
  }
  return { derived: false, parentId: pid, parentState: 'in_process', openChildren: openKids.length };
}

// ── THE CLOSE. ONE ACT. ───────────────────────────────────────────────────────────────────────────
//
//   opts: { actorId, actorName, payload, skipGate, taskId, decidedByApprover, noticeCtx, basisText }
//
// Order matters and is deliberate:
//   1. refuse on the gate (nothing written)
//   2. resolve any per-ending side record (search-intent ledger, referral record)
//   3. write closure_reason, then the central stage transition to `closed`
//   4. send the notice — inseparable from 3, which is why it is inside this function and not the caller's
//   5. derive the parent
//
// A CLOSED REQUEST IS NOT RE-CLOSABLE. Guarded here as well as by the from-closed transition guard,
// because this is the path a screen calls twice on a double-click.
async function close(requestId, ending, opts) {
  opts = opts || {};
  var payload = opts.payload || {};
  var def = ENDINGS[ending];
  if (!def) { var e0 = new Error('There is no such ending: "' + ending + '".'); e0.code = 'UNKNOWN_ENDING'; e0.status = 400; throw e0; }

  var request = await get('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request) { var e1 = new Error('Request not found.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  if (request.status === 'closed' || request.stage === 'closed') {
    var e2 = new Error('This item is already closed (' + ((endingOf(request.closure_reason) || {}).label || request.closure_reason || 'closed') + ').');
    e2.code = 'ALREADY_CLOSED'; e2.status = 409; throw e2;
  }

  var gate = { blocked: false, rows: [], reasons: [] };
  if (!opts.skipGate && def.gated) {
    gate = await gateFor(requestId, ending, payload);
    if (gate.blocked) {
      var e3 = new Error(gate.reasons.map(function (r) { return r.text; }).join(' '));
      e3.code = gate.reasons[0].code; e3.status = 422; e3.reasons = gate.reasons; e3.gate = gate;
      throw e3;
    }
  }

  var actor = { actorId: opts.actorId || null, actorName: opts.actorName || 'Staff' };
  var note = s(payload.note);
  var noticeCtx = Object.assign({ note: note }, opts.noticeCtx || {});
  var extra = [];
  var stats = {};

  // Per-ending side records, written BEFORE the transition so a failure leaves the request open rather
  // than closed-without-its-evidence.
  if (ending === 'no_records') {
    var eff = await effortTrail(requestId);
    noticeCtx.effortCount = eff.count;
    stats.effortEntries = eff.count;
    extra.push('Diligent search evidenced by ' + eff.count + ' logged action(s).');
    // Every open description is answered BY this closure — the per-description ledger must not be left
    // half-written (the behaviour the pre-BW5 resolve path already had; preserved exactly).
    try {
      stats.intentsClosed = await SI.resolveAllOpen(requestId, { actorName: actor.actorName,
        note: 'Closed with the request: no responsive records found.' + (note ? ' ' + note : '') });
    } catch (e) { console.error('[disposition close intents]', e && e.message); }
  } else if (ending === 'not_in_custody') {
    noticeCtx.custodianName = s(payload.custodianName);
    noticeCtx.custodianContact = s(payload.custodianContact);
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), requestId, actor.actorId, actor.actorName, 'REFERRAL_RECORDED',
       'Referred to ' + s(payload.custodianName) + (s(payload.custodianContact) ? ' (' + s(payload.custodianContact) + ')' : '') +
       ' — ' + s(payload.referralNote), nowStr()]);
    extra.push('Referred to ' + s(payload.custodianName) + '.');
  } else if (ending === 'previously_furnished') {
    noticeCtx.priorRequestNumber = s(payload.priorRequestNumber);
    noticeCtx.priorRequestDate = s(payload.priorRequestDate);
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), requestId, actor.actorId, actor.actorName, 'PREVIOUSLY_FURNISHED_CERTIFIED',
       'Certified under Tex. Gov’t Code § 552.232: the records requested here are the same records furnished under ' +
       s(payload.priorRequestNumber) + ' on ' + s(payload.priorRequestDate) + '. Attested by ' + actor.actorName + '.', nowStr()]);
    extra.push('Certified previously furnished under ' + s(payload.priorRequestNumber) + '.');
  } else if (ending === 'withdrawn') {
    extra.push('Withdrawn on the requester’s own communication.');
  }
  if (opts.basisText) { noticeCtx.basisText = opts.basisText; extra.push(opts.basisText); }

  await run('UPDATE requests SET closure_reason = ?, updated_at = ? WHERE id = ?', [def.reason, nowStr(), requestId]);
  var moved = await require('./taskRouting').applyStageTransition(requestId, 'closed', {
    actorId: actor.actorId, actorName: actor.actorName, action: def.action,
    notes: def.label + '. ' + extra.join(' ') + (note ? ' ' + note : '') +
      (opts.decidedByApprover ? ' Approved and executed by ' + actor.actorName + ' on ' + (opts.requestedByName || 'the closer') + '’s request.' : '')
  });

  // THE NOTICE IS PART OF THE ACT, not a follow-up. See services/closureNotice.js.
  var notice = await CN.send(requestId, ending, noticeCtx, actor);

  var parent = await deriveParent(requestId);

  return Object.assign({ ok: true, ending: ending, label: def.label, closureReason: def.reason,
    stage: moved && moved.toStage, notice: notice, parent: parent, gate: gate }, stats);
}

// ── CLOSE APPROVAL — the routed door ──────────────────────────────────────────────────────────────
//
// A routed close is PENDING, VISIBLY. The row below is that state; the task is how it reaches a human.
// Requesting one still runs the gate: routing an unevidenced close would just move the refusal onto the
// supervisor's desk, which is the opposite of what an approval is for.
async function requestApproval(requestId, ending, opts) {
  opts = opts || {};
  var payload = opts.payload || {};
  var def = ENDINGS[ending];
  if (!def) { var e0 = new Error('There is no such ending: "' + ending + '".'); e0.code = 'UNKNOWN_ENDING'; e0.status = 400; throw e0; }
  var request = await get('SELECT id, department_id, status, stage FROM requests WHERE id = ?', [requestId]);
  if (!request) { var e1 = new Error('Request not found.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  if (request.status === 'closed') { var e2 = new Error('This item is already closed.'); e2.code = 'ALREADY_CLOSED'; e2.status = 409; throw e2; }

  var existing = await pending(requestId);
  if (existing) { var e3 = new Error('A close is already pending approval on this item.'); e3.code = 'APPROVAL_PENDING'; e3.status = 409; throw e3; }

  var gate = await gateFor(requestId, ending, payload);
  if (gate.blocked) {
    var e4 = new Error(gate.reasons.map(function (r) { return r.text; }).join(' '));
    e4.code = gate.reasons[0].code; e4.status = 422; e4.reasons = gate.reasons; e4.gate = gate;
    throw e4;
  }

  var tr = require('./taskRouting');
  var id = uuidv4();
  var task = null;
  try {
    task = await tr.createTask({
      requestId: requestId, type: 'close_approval', teamId: request.department_id || null,
      title: 'Approve close — ' + def.label, createdBy: opts.actorId || 'system'
    });
  } catch (e) { console.error('[requestApproval createTask]', e && e.message); }

  await run(
    'INSERT INTO request_close_approvals (id, request_id, task_id, approval_task_id, ending, payload_json, gate_json, status, ' +
    'requested_by, requested_by_name, requested_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, requestId, opts.taskId || null, task ? task.id : null, ending, JSON.stringify(payload), JSON.stringify(gate),
     'pending', opts.actorId || null, opts.actorName || 'Staff', nowStr()]);

  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'Staff', 'CLOSE_APPROVAL_REQUESTED',
     'Close pending approval — ' + def.label + '. Requested by ' + (opts.actorName || 'Staff') +
     '. The disposition and its notice fire on approval, recorded as the approver’s act.', nowStr()]);

  if (task) {
    // Route it like any other task so it lands in the right pool. Never blocks: an unroutable approval is
    // still a visible pending row, which is better than a close that silently did not happen.
    tr.autoRouteOrPool(task.id, 'Approve close — ' + def.label, {})
      .catch(function (e) { console.error('[requestApproval route]', e && e.message); });
  }
  return { ok: true, pending: true, approvalId: id, taskId: task ? task.id : null, ending: ending, label: def.label };
}

async function pending(requestId) {
  return await get("SELECT * FROM request_close_approvals WHERE request_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1", [requestId]);
}
async function byApprovalTask(taskId) {
  return await get("SELECT * FROM request_close_approvals WHERE approval_task_id = ? ORDER BY requested_at DESC LIMIT 1", [taskId]);
}

// THE APPROVER MUST DIFFER FROM THE REQUESTER — and that is ALL that is required here.
//
// Two-eyes (taskRouting.TWO_EYES_TYPES) is a stronger rule: it excludes whoever completed the item's last
// FLOW task, because a release review is a check on the work itself. A close approval is a check on the
// DECISION TO END, so the only conflict is self-approval. Conflating them would make a supervisor who
// helped with a search unable to approve its closure — a stop with no compliance basis, which rule (c)
// forbids as surely as an automatic act does.
function selfApproval(row, userId) {
  return !!(row && row.requested_by && userId && row.requested_by === userId);
}

async function approve(approvalId, opts) {
  opts = opts || {};
  var row = await get('SELECT * FROM request_close_approvals WHERE id = ?', [approvalId]);
  if (!row) { var e1 = new Error('No such close approval.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  if (row.status !== 'pending') { var e2 = new Error('This close approval was already ' + row.status + '.'); e2.code = 'NOT_PENDING'; e2.status = 409; throw e2; }
  if (selfApproval(row, opts.actorId)) {
    var e3 = new Error('You requested this close, so you cannot also approve it. An approval has to be a second person.');
    e3.code = 'SELF_APPROVAL'; e3.status = 403; throw e3;
  }
  var payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch (e) {}

  // The close executes as the APPROVER's act (rev 2: "on approval the close is the approver's recorded act").
  var result = await close(row.request_id, row.ending, {
    actorId: opts.actorId, actorName: opts.actorName || 'Approver', payload: payload,
    decidedByApprover: true, requestedByName: row.requested_by_name
  });
  await run("UPDATE request_close_approvals SET status = 'approved', decided_by = ?, decided_by_name = ?, decided_at = ?, decision_note = ? WHERE id = ?",
    [opts.actorId || null, opts.actorName || 'Approver', nowStr(), s(opts.note) || null, approvalId]);
  if (row.approval_task_id) {
    await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?", [row.approval_task_id]);
  }
  return Object.assign({ approvalId: approvalId, approvedBy: opts.actorName || 'Approver' }, result);
}

async function reject(approvalId, opts) {
  opts = opts || {};
  var row = await get('SELECT * FROM request_close_approvals WHERE id = ?', [approvalId]);
  if (!row) { var e1 = new Error('No such close approval.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  if (row.status !== 'pending') { var e2 = new Error('This close approval was already ' + row.status + '.'); e2.code = 'NOT_PENDING'; e2.status = 409; throw e2; }
  var note = s(opts.note);
  if (!note) { var e3 = new Error('Say why the close is not approved — the closer has to know what to do next.'); e3.code = 'NOTE_REQUIRED'; e3.status = 422; throw e3; }
  await run("UPDATE request_close_approvals SET status = 'rejected', decided_by = ?, decided_by_name = ?, decided_at = ?, decision_note = ? WHERE id = ?",
    [opts.actorId || null, opts.actorName || 'Approver', nowStr(), note, approvalId]);
  if (row.approval_task_id) {
    await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", [row.approval_task_id]);
  }
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), row.request_id, opts.actorId || null, opts.actorName || 'Approver', 'CLOSE_APPROVAL_REJECTED',
     'Close not approved — ' + note + '. The item stays open and the work returns to ' + (row.requested_by_name || 'the closer') + '.', nowStr()]);
  // The originating task must come back to life: rejecting a close and leaving no task is a stranded item.
  if (row.task_id) {
    await run("UPDATE tasks SET status = CASE WHEN status IN ('done','cancelled') THEN 'open' ELSE status END, updated_at = datetime('now') WHERE id = ?", [row.task_id]);
  }
  return { ok: true, rejected: true, approvalId: approvalId, note: note };
}

// ── REOPEN — the Director's act, and the only door out of `closed` ────────────────────────────────
//
// Decided 7/29 (Draft 8 rev 2 §3.3), and every clause of it is load-bearing:
//
//   DIRECTOR AUTHORITY      enforced at the route. Reopening reverses a recorded public act.
//   A REQUIRED NOTE         the reason IS the record. "It was reopened" answers nothing.
//   A RESUME POINT          prior stage (DEFAULT) or intake review for re-triage. The hybrid, because
//                           the two real cases differ: "we missed a repository" resumes the search;
//                           "this was never the right team / the classification was wrong" needs the
//                           first look again, which is trigger (v) on Draft 1c's list — no new machinery.
//   CLOCKS ARE NEVER RESET  the original history stands and exposures show honestly. There is deliberately
//                           no clock write anywhere in this function. A city that reopens a request three
//                           weeks late is three weeks late, and a reopen that quietly restarted the
//                           statutory clock would be the system laundering a missed deadline.
//   SILENT                  no requestor notice. The subsequent OUTCOME speaks — a reopen followed by a
//                           release says more than a letter announcing an internal change of mind.
//   UN-DERIVES THE PARENT   a live child means the parent is In Process again, and its MRR Management task
//                           comes back (deriveParent, above).
//
//   opts: { actorId, actorName, note, resumePoint: 'prior_stage' | 'intake_retriage' }
async function reopen(requestId, opts) {
  opts = opts || {};
  var note = s(opts.note);
  if (!note) { var e0 = new Error('A note is required to reopen a closed request. Say why it is being reopened — the reason is the record.'); e0.code = 'NOTE_REQUIRED'; e0.status = 422; throw e0; }
  var resumePoint = opts.resumePoint === 'intake_retriage' ? 'intake_retriage' : 'prior_stage';

  var r = await get('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!r) { var e1 = new Error('Request not found.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  if (r.stage !== 'closed' && r.status !== 'closed') {
    var e2 = new Error('This request is not closed, so there is nothing to reopen.'); e2.code = 'NOT_CLOSED'; e2.status = 409; throw e2;
  }

  // THE PRIOR STAGE IS A FACT IN THE HISTORY, not a guess. The last transition INTO closed knows where the
  // request came from; if there is none (a legacy row closed before the central transition existed) the
  // fallback is `record_search`, the fulfillment entry — never `intake`, which would silently re-triage a
  // request whose Director asked for the other door.
  var prior = await get(
    "SELECT stage_from FROM request_history WHERE request_id = ? AND stage_to = 'closed' AND stage_from IS NOT NULL " +
    'ORDER BY created_at DESC LIMIT 1', [requestId]);
  var priorStage = (prior && prior.stage_from && prior.stage_from !== 'closed') ? prior.stage_from : 'record_search';
  var target = resumePoint === 'intake_retriage' ? 'intake' : priorStage;

  var closureWas = endingOf(r.closure_reason);
  await run("UPDATE requests SET closure_reason = NULL, reopened_at = ?, reopen_count = COALESCE(reopen_count, 0) + 1, updated_at = ? WHERE id = ?",
    [nowStr(), nowStr(), requestId]);

  var moved = await require('./taskRouting').applyStageTransition(requestId, target, {
    reopen: true, actorId: opts.actorId || null, actorName: opts.actorName || 'Director',
    action: 'REQUEST_REOPENED',
    notes: 'Reopened by ' + (opts.actorName || 'a Director') + ' — ' + note +
      ' Resuming at ' + (resumePoint === 'intake_retriage' ? 'intake review for re-triage' : 'the prior stage (' + priorStage + ')') +
      '. Previously ' + ((closureWas && closureWas.label) || 'closed') +
      '. Clocks are NOT reset: the original history stands and any exposure it created still shows.'
  });

  var intake = null;
  if (resumePoint === 'intake_retriage') {
    // Trigger (v) on Draft 1c's list — the enum stub BW2 registered, now wired by its owner.
    try {
      intake = await require('./intakeReview').spawn(requestId, ['reopen_retriage'], {
        createdBy: opts.actorId || 'system'
      });
    } catch (e) { console.error('[disposition reopen intake]', e && e.message); }
  }

  var parent = await deriveParent(requestId);
  return {
    ok: true, reopened: true, requestId: requestId, resumePoint: resumePoint,
    stage: (moved && moved.toStage) || target, priorStage: priorStage,
    previousEnding: closureWas ? closureWas.key : (r.closure_reason || null),
    intakeReviewTaskId: intake && intake.task ? intake.task.id : null,
    parent: parent,
    // Said out loud in the response because a screen must not offer to "notify the requestor of the reopen".
    requestorNotified: false,
    clocksReset: false
  };
}

module.exports = {
  reopen: reopen,
  ENDINGS: ENDINGS, ENDING_KEYS: ENDING_KEYS,
  TASK_CLOSE_ENDINGS: TASK_CLOSE_ENDINGS, MANUAL_RECORD_ENDINGS: MANUAL_RECORD_ENDINGS,
  EFFORT_ACTIONS: EFFORT_ACTIONS,
  endingOf: endingOf, effortTrail: effortTrail, gateFor: gateFor,
  withdrawalCommunications: withdrawalCommunications,
  approvalModeFor: approvalModeFor,
  deriveParent: deriveParent,
  close: close,
  requestApproval: requestApproval, pending: pending, byApprovalTask: byApprovalTask,
  selfApproval: selfApproval, approve: approve, reject: reject
};
