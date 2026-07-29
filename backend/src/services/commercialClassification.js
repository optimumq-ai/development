'use strict';
// PHASE 7 / BW4 — THE COMMERCIAL-RATE CLASSIFICATION STORE.
//
// The BW3 gap, closed. `approvalModules.evaluateCommercial` has always been able to EVALUATE a
// classification (declared vs proposed, override detection, the NJ/IL clock-effect warning) — it just had
// nowhere to write one down. So the intake screen's commercial panel printed a confession instead of a
// button, and `intakeReview.proceedGate` deliberately refused to gate on a decision no act could record.
//
// This module is that act, and nothing more. It does NOT decide anything: `classifyAs` comes from a person,
// is stored against their name, and the evaluation module keeps its own opinions.
//
// ══ WHAT IT DOES NOT DO (conservative on ambiguity — recorded here, not left to be discovered) ══
//
//   IT DOES NOT MOVE THE CLOCK. New Jersey gives commercial requests a 14-business-day window and Illinois a
//   separate recurrent/commercial track — approvalModules says so, and says WHY it does not model the
//   durations ("that is deadline config, and modelling it here would put a number on a citizen's letter
//   from the wrong module"). Recording a classification therefore does not re-quote a deadline. The
//   clockEffect sentence is surfaced to the person BEFORE they classify, which is the whole point of
//   classifying at intake.
//
//   IT DOES NOT RE-PRICE AN ESTIMATE. The fee engine's commercial surcharge rides on `purpose`, which is
//   what the requester DECLARED and is a separate column on purpose. A classification that overrode the
//   declaration and silently changed `purpose` would re-price every saved estimate on the request without
//   anyone being told. The estimate screen reads the classification and offers the purpose switch as a
//   visible act instead.
//
//   IT DOES NOT NOTIFY. `mustCommunicate` is returned (an override is always communicated — design doc)
//   and the estimate notice is where that communication lands. Sending is a person's act, not a side
//   effect of recording.
var db = require('../db');
var get = db.get, run = db.run;
var uuidv4 = require('uuid').v4;

var VALUES = ['standard', 'commercial'];

function normalize(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return VALUES.indexOf(s) >= 0 ? s : null;
}

// The stored classification, or null when nobody has recorded one. `declared` is carried alongside so a
// caller never has to re-read the request to know whether the city overrode the requester.
async function read(requestId) {
  if (!requestId) return null;
  var r = await get('SELECT id, purpose, commercial_classification, commercial_classified_by, ' +
    'commercial_classified_at, commercial_classification_note FROM requests WHERE id = ?', [requestId]);
  if (!r) return null;
  var declared = r.purpose || 'standard';
  return {
    requestId: r.id,
    declared: declared,
    classification: r.commercial_classification || null,
    decidedBy: r.commercial_classified_by || null,
    decidedAt: r.commercial_classified_at || null,
    note: r.commercial_classification_note || null,
    // An override is the fact that has to be communicated. It is DERIVED, never stored, so it can never
    // disagree with the two values it comes from.
    overridesDeclaration: !!(r.commercial_classification && r.commercial_classification !== declared)
  };
}

// Record a person's classification. Idempotent in the ordinary sense — re-recording the same value simply
// re-stamps it — but never anonymous: `actor` is required by the caller (the routes supply the session's
// name), because a classification with no name on it is exactly the "system decided a judgment call" that
// rule (c) forbids.
async function record(requestId, classifyAs, actor, opts) {
  opts = opts || {};
  var value = normalize(classifyAs);
  if (!value) { var e = new Error('classification must be "standard" or "commercial"'); e.code = 'BAD_CLASSIFICATION'; throw e; }
  var reqRow = await get('SELECT id, purpose FROM requests WHERE id = ?', [requestId]);
  if (!reqRow) { var e2 = new Error('Request not found'); e2.code = 'NOT_FOUND'; throw e2; }
  var declared = reqRow.purpose || 'standard';
  var overrides = value !== declared;
  var note = (opts.note || '').trim() || null;

  await run("UPDATE requests SET commercial_classification = ?, commercial_classified_by = ?, " +
    "commercial_classified_at = datetime('now'), commercial_classification_note = ?, updated_at = datetime('now') " +
    'WHERE id = ?', [value, actor || 'staff', note, requestId]);

  var notes = 'Classified as ' + value.toUpperCase() + ' for rate purposes' +
    (overrides
      ? '. THIS OVERRIDES the requester\'s own declaration of "' + declared + '" — an override changes the ' +
        'invoice and, in a state with a commercial clock (NJ, IL), can change the deadline, so it must be ' +
        'communicated to the requester.'
      : ' (matches the requester\'s declaration of "' + declared + '").') +
    (note ? ' Reason: ' + note : '');
  try {
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), requestId, opts.actorId || null, actor || 'Staff', 'COMMERCIAL_CLASSIFICATION_RECORDED', notes]);
  } catch (e) { console.error('[commercialClassification history]', requestId, e && e.message); }

  return Object.assign(await read(requestId), { overridesDeclaration: overrides, mustCommunicate: overrides });
}

module.exports = { VALUES: VALUES, normalize: normalize, read: read, record: record };
