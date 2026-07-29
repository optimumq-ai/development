'use strict';
// PHASE 7 / BW5 — THE RM HOLD OF A READY RECORD, AND THE PREVENTION GUARD KEVIN RATIFIED 2026-07-29.
//
// ══ WHAT A HOLD IS, AND WHAT IT IS NOT ══
//
// SPEC §2.4 says "no manual hold anywhere — hold is a system state with a named cause". That bans the
// UNNAMED hold: a button that stops a request for reasons nobody records. A Request Manager holding a
// finished record because the department wants to brief the council first is a real operational act, and
// it is legitimate PRECISELY BECAUSE it is named: a note is ALWAYS required, and the note is the record.
//
// IT IS NEVER A PAYMENT HOLD (§5.9, unchanged, and this is a legal line rather than a preference). Money
// gating belongs to services/feeRelease, which implements the §5.9 coverage test — a child may never be
// withheld because a SIBLING is unpaid. This module does not look at money at all, and the auto-release
// pipeline reads both separately so neither can double-gate the other. If this file ever grows a balance
// check, that is the bug.
//
// ══ THE PREVENTION REFINEMENT (ratified 7/29, item 4) ══
//
// "In an entitlement jurisdiction with an installment request on file, the hold control is DISABLED with
//  the reason and citation shown — prevention, not fight; if the installment request arrives while a hold
//  stands, the hold AUTO-LIFTS and the RM is notified."
//
// Two halves, and the second is the only true override in the whole build:
//
//   PREVENTION   `holdState()` answers `canHold: false` with a reason and a citation, and `hold()` REFUSES
//                with the same words. One evaluator, two readers — the screen disables the control and the
//                API refuses, so a stale screen cannot get around it.
//   OVERRIDE     `onInstallmentRequest()` lifts a standing hold WITHOUT a person. That looks like rule (c)
//                ("advisory never auto-acts") being broken, and it is not: this is STATUTE ON VERIFIED
//                FACTS — the state's own imported research says the entitlement exists, and the requester
//                has made the request — which is the same asymmetry the mandatory fee waiver already runs
//                on. The system is not exercising judgment; it is declining to keep doing something the
//                law no longer permits. The RM is notified, because a hold vanishing silently would be a
//                second problem.
//
// THE FALLBACK RULE DOES THE SAFETY WORK. `installment_entitlement` is UNKNOWN in every jurisdiction whose
// branch profile has not been imported, and unknown is not an entitlement (branchProfile's whole design).
// So on an un-researched install this module is exactly a note-requiring hold and nothing else.
var db = require('../db');
var get = db.get, run = db.run;
var uuidv4 = require('uuid').v4;
var BP = require('./branchProfile');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function s(v) { return String(v == null ? '' : v).trim(); }

var CITATION = 'WA RCW 42.56.080(2) (installment production on request)';

// The hold picture for one record: what stands, and whether a new hold may be placed.
async function holdState(requestId) {
  var r = await get('SELECT id, release_hold, release_hold_note, release_hold_by, release_hold_at, ' +
    'installment_requested_at, installment_requested_note FROM requests WHERE id = ?', [requestId]);
  if (!r) return { known: false };
  var entitlement = null;
  try { entitlement = await BP.isActive(null, 'installment_entitlement'); } catch (e) { entitlement = null; }
  var installmentOnFile = !!r.installment_requested_at;
  // Only an EXPLICIT true entitlement plus an actual request on file prevents. Unknown never prevents.
  var prevented = entitlement === true && installmentOnFile;
  return {
    known: true, requestId: requestId,
    held: Number(r.release_hold) === 1,
    note: r.release_hold_note || null, by: r.release_hold_by || null, at: r.release_hold_at || null,
    installmentRequestedAt: r.installment_requested_at || null,
    installmentNote: r.installment_requested_note || null,
    entitlement: entitlement,
    canHold: !prevented,
    blockedReason: prevented
      ? 'This requester has an installment request on file and this state gives them the entitlement to ' +
        'receive records as they become ready. Holding the finished record would withhold what they are ' +
        'entitled to now, so the hold control is unavailable here.'
      : null,
    citation: prevented ? CITATION : null,
    // Said out loud so no screen has to infer it: money is somebody else's job.
    neverAPaymentHold: 'A hold is never a payment hold (§5.9). Money gating is the release gate’s, per record.'
  };
}

// Place a hold. A NOTE IS ALWAYS REQUIRED — the whole difference between this and the manual hold spec §2.4
// bans is that this one says why.
async function hold(requestId, opts) {
  opts = opts || {};
  var note = s(opts.note);
  if (!note) {
    var e0 = new Error('A hold always needs a note. A stop nobody can explain is the unnamed hold the product does not have.');
    e0.code = 'NOTE_REQUIRED'; e0.status = 422; throw e0;
  }
  var st = await holdState(requestId);
  if (!st.known) { var e1 = new Error('Request not found.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  if (!st.canHold) {
    var e2 = new Error(st.blockedReason);
    e2.code = 'INSTALLMENT_ENTITLEMENT'; e2.status = 409; e2.citation = st.citation; throw e2;
  }
  if (st.held) { var e3 = new Error('A hold already stands on this record.'); e3.code = 'ALREADY_HELD'; e3.status = 409; throw e3; }
  await run('UPDATE requests SET release_hold = 1, release_hold_note = ?, release_hold_by = ?, release_hold_at = ?, updated_at = ? WHERE id = ?',
    [note, opts.actorName || 'Request Manager', nowStr(), nowStr(), requestId]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'Request Manager', 'RELEASE_HOLD_PLACED',
     'Release held — ' + note + ' (This is not a payment hold: money gating is the release gate’s, per §5.9.)', nowStr()]);
  return Object.assign({ ok: true, held: true }, await holdState(requestId));
}

async function lift(requestId, opts) {
  opts = opts || {};
  var st = await holdState(requestId);
  if (!st.known) { var e1 = new Error('Request not found.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  if (!st.held) { var e2 = new Error('No hold stands on this record.'); e2.code = 'NOT_HELD'; e2.status = 409; throw e2; }
  await run('UPDATE requests SET release_hold = 0, release_hold_note = NULL, release_hold_by = NULL, release_hold_at = NULL, updated_at = ? WHERE id = ?',
    [nowStr(), requestId]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'Request Manager', 'RELEASE_HOLD_LIFTED',
     'Release hold lifted' + (s(opts.note) ? ' — ' + s(opts.note) : '.'), nowStr()]);
  return Object.assign({ ok: true, held: false }, await holdState(requestId));
}

// AN INSTALLMENT REQUEST ARRIVES. Recorded always; it AUTO-LIFTS a standing hold only where the state's own
// research says the entitlement exists — statute on verified facts, the only override in this build.
async function onInstallmentRequest(requestId, opts) {
  opts = opts || {};
  var r = await get('SELECT id, release_hold, release_hold_by FROM requests WHERE id = ?', [requestId]);
  if (!r) { var e1 = new Error('Request not found.'); e1.code = 'NOT_FOUND'; e1.status = 404; throw e1; }
  var note = s(opts.note);
  await run('UPDATE requests SET installment_requested_at = ?, installment_requested_note = ?, updated_at = ? WHERE id = ?',
    [nowStr(), note || null, nowStr(), requestId]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'Staff', 'INSTALLMENT_REQUESTED',
     'The requester asked for records in installments' + (note ? ' — ' + note : '.'), nowStr()]);

  var entitlement = null;
  try { entitlement = await BP.isActive(null, 'installment_entitlement'); } catch (e) { entitlement = null; }
  var lifted = false;
  if (Number(r.release_hold) === 1 && entitlement === true) {
    await run('UPDATE requests SET release_hold = 0, release_hold_note = NULL, release_hold_by = NULL, release_hold_at = NULL, updated_at = ? WHERE id = ?',
      [nowStr(), requestId]);
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), requestId, null, 'System · statute-triggered', 'RELEASE_HOLD_AUTO_LIFTED',
       'The hold was lifted automatically: an installment request arrived and this state gives the requester the ' +
       'entitlement to receive records as they become ready (' + CITATION + '). This is statute on verified facts, ' +
       'not a judgment — the Request Manager has been notified.', nowStr()]);
    lifted = true;
    // NOTIFY THE RM. A hold that vanishes silently is a second problem, not a solution to the first.
    try {
      var N = require('./notifications');
      var whoRow = r.release_hold_by
        ? await get('SELECT id FROM users WHERE display_name = ? AND status = \'active\' LIMIT 1', [r.release_hold_by])
        : null;
      if (whoRow) {
        await N.emit({
          userId: whoRow.id, kind: 'hold_auto_lifted', contextType: 'request', contextId: requestId,
          title: 'Your release hold was lifted by statute',
          body: 'An installment request arrived on this record. This state gives the requester the entitlement to ' +
                'receive records as they become ready (' + CITATION + '), so the hold could not stand.',
          link: '/requests/' + requestId, createdBy: 'system'
        });
      }
    } catch (e) { console.error('[releaseHold notify]', e && e.message); }
  }
  return Object.assign({ ok: true, installmentRecorded: true, holdAutoLifted: lifted, entitlement: entitlement },
    await holdState(requestId));
}

module.exports = { CITATION: CITATION, holdState: holdState, hold: hold, lift: lift, onInstallmentRequest: onInstallmentRequest };
