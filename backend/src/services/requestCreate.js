'use strict';
// THE ONE REQUEST-CREATION HELPER. ARCHITECTURE item 5: "Every path that creates a request (portal chat,
// staff form, connectors, imports, API) calls ONE shared helper. Wrap-in-master, numbering, deadlines and
// defaults live there once. Rationale: v1 had 5 independent INSERT sites, which is how conventions drift."
//
// They had drifted. Before this module there were THREE intake paths with THREE DIFFERENT request-number
// algorithms and FOUR copies of a hardcoded deadline table:
//
//   A. routes/requests.js  staff create  — MAX(request_number) + 1        (correct)
//   B. routes/requests.js  /public       — last row BY created_at, +1     (BROKEN: the newest row may not
//                                          hold the highest number, and a non-standard number like
//                                          'DEMO-2026-5069' makes it restart at 0001 — a guaranteed
//                                          collision with an existing request)
//   C. routes/publicChat.js the live portal — COUNT(*) + 1                (BROKEN: delete ANY request below
//                                          the maximum and COUNT+1 mints a number that already exists →
//                                          UNIQUE violation on request_number → intake 500s. It works today
//                                          only by coincidence: COUNT (44) == MAX (44). Cities purge
//                                          requests; this is a live landmine.)
//
// One algorithm now: MAX + 1 over well-formed YYYY-NNNN numbers, retried on a unique collision so two
// concurrent submissions cannot mint the same number.
//
// DEADLINES: the three intake paths each carried their own `{simple:5, standard:10, complex:20,
// redaction_required:30}` calendar-day table. That IGNORED the jurisdiction's deadline rules — in Illinois
// (5 BUSINESS days) or California (10-day determination) it wrote the wrong date. The date was then silently
// overwritten anyway when the clock engine started. The helper now starts the clocks and lets
// tolling.writebackDeadline() set `deadline_date` from the JURISDICTION — one source of truth.
//
// This is also where WRAP-IN-PARENT will live (ARCHITECTURE item 1 / SPEC_parent_child_lifecycle): one place
// to create the parent + child pair, instead of three.
var db = require('../db');
var get = db.get, run = db.run;
var uuidv4 = require('uuid').v4;

// THE CITIZEN-FACING REQUEST NUMBER: YYYY-NNNNNN (fixed width).
//
// SEQ_DIGITS is the ONE place the width is defined. It drives BOTH the zero-padding and the pattern that finds
// the highest number so far — and that is the whole point. They used to be two separate literals (`padStart(4)`
// and a hardcoded `[0-9]{4}` regex), and a city that took 10,000 requests in one year hit this:
//
//   at 9,999 requests -> the helper mints 2026-10000, and the INSERT succeeds (padStart does not truncate).
//   ...but the `[0-9]{4}` pattern CANNOT SEE a 5-digit number, so the "highest so far" still reads 9,999
//   -> the helper mints 2026-10000 a SECOND time -> UNIQUE violation -> INTAKE 500s.
//   The city cannot accept another request for the rest of the year.
//
// 6 digits (999,999/yr) is Kevin's call — a large city can exceed 100,000 requests in a year.
//
// THE WIDTH MUST BE FIXED, not grow-as-needed. `ORDER BY request_number DESC` is a LEXICAL sort, and with
// mixed widths '2026-9999' sorts ABOVE '2026-010000' — which reintroduces exactly the collision above. Uniform
// width is what makes the "highest number" sort correct by construction, so this is a correctness property,
// not a cosmetic one. Changing SEQ_DIGITS means renumbering the existing rows to match (see
// db/renumber_request_numbers.js) — never leave two widths in the table.
var SEQ_DIGITS = 6;

// Only well-formed YYYY-NNNNNN numbers take part in sequencing. This deliberately excludes the system and demo
// rows ('SYS-IMPORT-…', 'DEMO-2026-5069', 'LIBRARY') that broke algorithm B.
async function nextRequestNumber(year) {
  year = year || new Date().getFullYear();
  var row = await get(
    "SELECT request_number FROM requests WHERE request_number ~ ('^' || ? || '-[0-9]{" + SEQ_DIGITS + "}$') " +
    'ORDER BY request_number DESC LIMIT 1',
    [String(year)]
  );
  var seq = 1;
  if (row && row.request_number) seq = parseInt(row.request_number.split('-')[1], 10) + 1;

  // The ceiling is now explicit and LOUD rather than a silent duplicate-key 500 at the front door. If a city
  // ever genuinely reaches it, widen SEQ_DIGITS and renumber — do not let it mint an over-wide number.
  if (String(seq).length > SEQ_DIGITS) {
    throw new Error(
      'Request numbering exhausted for ' + year + ': sequence ' + seq + ' exceeds ' + SEQ_DIGITS +
      ' digits. Widen SEQ_DIGITS in services/requestCreate.js and renumber existing rows.'
    );
  }
  return year + '-' + String(seq).padStart(SEQ_DIGITS, '0');
}

var COLUMNS = [
  'requestor_name', 'requestor_email', 'requestor_phone', 'requestor_type', 'delivery_method',
  'description', 'record_types', 'classification', 'department_id', 'record_type_id',
  'fee_waiver_requested', 'fee_waiver_reason', 'purpose',
  'mailing_street1', 'mailing_street2', 'mailing_city', 'mailing_state', 'mailing_zip',
  'certification_requested', 'email_verification_method', 'is_mrr', 'submission_channel'
];

// Map an intake payload (camelCase, from any of the three paths) onto the column set, with the defaults
// that used to be repeated at every site.
function normalize(f) {
  return {
    requestor_name: f.requestorName,
    requestor_email: f.requestorEmail,
    requestor_phone: f.requestorPhone || '',
    requestor_type: f.requestorType === 'commercial' ? 'commercial' : 'individual',
    delivery_method: f.deliveryMethod || 'email',
    description: f.description,
    record_types: f.recordTypes ? JSON.stringify(f.recordTypes) : null,
    classification: f.classification || 'standard',
    department_id: f.departmentId || null,
    record_type_id: f.recordTypeId || null,
    fee_waiver_requested: f.feeWaiverRequested ? 1 : 0,
    fee_waiver_reason: f.feeWaiverReason || null,
    purpose: f.purpose || null,
    mailing_street1: f.mailingStreet1 || null,
    mailing_street2: f.mailingStreet2 || null,
    mailing_city: f.mailingCity || null,
    mailing_state: f.mailingState || null,
    mailing_zip: f.mailingZip || null,
    certification_requested: f.certificationRequested ? 1 : 0,
    email_verification_method: (f.emailVerificationMethod === 'attested' || f.emailVerificationMethod === 'visual') ? f.emailVerificationMethod : null,
    is_mrr: f.isMrr ? 1 : 0,
    submission_channel: f.submissionChannel || 'portal'
  };
}

// Create a request. opts: { requestNumber (override, for SYS-*/demo rows), actorId, actorName, historyAction,
// historyNote, startClocks (default true), kickIntake (default true) }.
// Returns { id, requestNumber }.
async function createRequest(fields, opts) {
  opts = opts || {};
  if (!fields || !fields.requestorName || !fields.requestorEmail || !fields.description) {
    throw new Error('A request needs a requestor name, an email address, and a description.');
  }
  var cols = normalize(fields);
  var id = opts.id || uuidv4();

  var placeholders = COLUMNS.map(function () { return '?'; }).join(',');
  var values = COLUMNS.map(function (c) { return cols[c]; });

  // Race-safe: two concurrent submissions can compute the same next number. The UNIQUE constraint on
  // request_number is the referee; on a collision we re-read the max and try again rather than 500.
  var requestNumber = null, lastErr = null;
  for (var attempt = 0; attempt < 5; attempt++) {
    requestNumber = opts.requestNumber || await nextRequestNumber();
    try {
      await run(
        'INSERT INTO requests (id, request_number, stage, status, ' + COLUMNS.join(', ') + ') ' +
        'VALUES (?, ?, ?, ?, ' + placeholders + ')',
        [id, requestNumber, 'intake', 'active'].concat(values)
      );
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      // 23505 = unique_violation. Anything else is a real error — do not paper over it.
      if (!(e && (e.code === '23505' || /duplicate key|unique/i.test(e.message || '')))) throw e;
      if (opts.requestNumber) throw e; // an explicit number collided — that is the caller's problem
    }
  }
  if (lastErr) throw lastErr;

  await run(
    'INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
    [uuidv4(), id, opts.actorId || null, opts.actorName || 'System',
     opts.historyAction || 'CREATED', opts.historyNote || 'Request created.']
  );

  // The DEADLINE comes from the jurisdiction, not from a hardcoded table. startClocksForRequest is
  // idempotent and writes requests.deadline_date via tolling.writebackDeadline().
  if (opts.startClocks !== false) {
    try { await require('./tolling').startClocksForRequest(id); }
    catch (e) { console.error('[requestCreate] clock start failed:', e && e.message); }
  }

  if (opts.kickIntake !== false) {
    var we = require('./workflowEngine');
    we.bg(we.onIntake(id), 'intake ' + id);
  }

  return { id: id, requestNumber: requestNumber };
}

module.exports = {
  createRequest: createRequest,
  nextRequestNumber: nextRequestNumber,
  COLUMNS: COLUMNS,
  SEQ_DIGITS: SEQ_DIGITS, // exported so the renumber script and the suite cannot drift from the helper
};
