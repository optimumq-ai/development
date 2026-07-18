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
  'certification_requested', 'email_verification_method', 'is_mrr', 'submission_channel',
  'component_label'
];

// Columns that belong to the WORK ROW ONLY and are therefore NULLed on the parent (§5.1). Everything else in
// COLUMNS is citizen/money identity and IS copied up. `classification` is deliberately NOT in this list: it
// drives the statutory clock's duration (`tolling.durationFor`) and that clock is a parent object.
var PARENT_NULL = { description: 1, record_types: 1, department_id: 1, record_type_id: 1, component_label: 1 };

// Columns that vary PER CHILD. Everything else on a child row is a copy of the citizen/money identity, so the
// children of one request agree about who asked and how they want it delivered, and differ only in the work.
var CHILD_FIELDS = ['description', 'record_types', 'classification', 'department_id', 'record_type_id', 'component_label'];

// Normalise the children of a request (§13: "one description per described record"; AI proposes, a human
// decides). Two accepted shapes, and the single-description one is not a special case — it is n = 1:
//   { description: '...' }                       -> one child   (every caller that predates MRR)
//   { children: [{ description, ... }, ...] }    -> n children  (the portal's per-record intake loop)
function childrenOf(fields) {
  var list = Array.isArray(fields.children) && fields.children.length
    ? fields.children
    : [{ description: fields.description, recordTypes: fields.recordTypes, classification: fields.classification,
         departmentId: fields.departmentId, recordTypeId: fields.recordTypeId, componentLabel: fields.componentLabel }];
  return list.map(function (c, i) {
    if (!c || !String(c.description || '').trim()) {
      throw new Error('Child ' + (i + 1) + ' has no description. Every child is one described record (§5.1).');
    }
    return {
      description: c.description,
      record_types: c.recordTypes ? JSON.stringify(c.recordTypes) : null,
      classification: c.classification || fields.classification || 'standard',
      department_id: c.departmentId || null,
      record_type_id: c.recordTypeId || null,
      component_label: c.componentLabel || null
    };
  });
}

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
    // §5 — a commercial requester implies commercial purpose, so the staff estimate opens on commercial
    // rates (staff confirm). Explicit f.purpose still wins. Derived in the ONE creation helper so every
    // path (portal wizard, form, connectors) is covered, not just the portal.
    purpose: f.purpose || (f.requestorType === 'commercial' ? 'commercial' : null),
    mailing_street1: f.mailingStreet1 || null,
    mailing_street2: f.mailingStreet2 || null,
    mailing_city: f.mailingCity || null,
    mailing_state: f.mailingState || null,
    mailing_zip: f.mailingZip || null,
    certification_requested: f.certificationRequested ? 1 : 0,
    email_verification_method: (f.emailVerificationMethod === 'attested' || f.emailVerificationMethod === 'visual') ? f.emailVerificationMethod : null,
    is_mrr: f.isMrr ? 1 : 0,
    submission_channel: f.submissionChannel || 'portal',
    component_label: f.componentLabel || null // per-child in practice; here for the n=1 / unwrapped paths
  };
}

// WRAP-IN-PARENT (ARCHITECTURE item 1, RATIFIED 2026-07-16; SPEC_parent_child_lifecycle.md §8).
//
// Every request is a PARENT with 1..n CHILDREN. A single-record request is a parent with ONE child — there is
// no "single vs multi" mode, which is the whole point: filters, worklists and reports run over CHILD rows and
// see one uniform shape.
//
//   PARENT — the citizen relationship: request_number, requestor, money, the STATUTORY clock, the deadline.
//   CHILD  — the unit of work: description, stage, routing, and every FK that hangs off it (tasks, files,
//            redaction, search). `createRequest` RETURNS THE CHILD's id, because that is what work attaches to.
//
// COPY-UP, NOT MOVE. §8 is explicit that the migration is "additive, no data loss": the child keeps every
// column it has today and the parent gets COPIES of the citizen/money columns. Nothing that reads a request
// today breaks, and readers move up to the parent one at a time. Two columns force the issue anyway:
//   * `description` is NOT NULL — the spec says "the parent has no description", but the constraint says
//     otherwise. We copy rather than relax the constraint: a NOT NULL description is a good rule for the row
//     that actually carries the work. Nothing reads the parent's copy. (MRR can summarise it later.)
//   * `classification` drives the CLOCK DURATION (`tolling.durationFor`), and the statutory clock is a PARENT
//     object — so the parent needs it. The spec lists classification as child-only because it is talking about
//     ROUTING. For one child the two are identical; MRR needs a worst-case roll-up (§6, not yet specified).
//     [Claude's call, 2026-07-16 — filling a genuine gap in the spec, not Kevin's ruling.]
//
// `stage` is deliberately left NULL on the parent. A parent has no stage (§5.2 — `fee_review`/`awaiting_payment`
// are parent GATES on the money axis, not stages). Every stage-reading sweep is already LEAF-scoped precisely
// so a NULL-staged parent is invisible to it (see tickler.js's stall sweep).
//
// The CHILD's number carries the component suffix: `2026-000001-1`. That falls OUT of `nextRequestNumber`'s
// `^YYYY-[0-9]{6}$` pattern for free — children can never take part in citizen-number sequencing. That is a
// happy consequence of the fixed-width numbering fix (`efe3c57`), and it is asserted in the harness rather
// than left to luck.
//
// Create a request. opts: { requestNumber (override, for SYS-*/demo rows), actorId, actorName, historyAction,
// historyNote, startClocks (default true), kickIntake (default true), wrap (default true — false inserts a
// BARE row for the LIBRARY/SYS-* infrastructure containers, which are not citizen requests) }.
// Returns { id (THE CHILD), requestNumber (the CITIZEN's number, i.e. the parent's), parentId, childId }.
async function createRequest(fields, opts) {
  opts = opts || {};
  // A request needs a requestor and AT LEAST ONE described record — either the single `description` (every
  // caller that predates MRR) or a non-empty `children` array. childrenOf() then validates each child.
  var hasKids = Array.isArray(fields && fields.children) && fields.children.length > 0;
  if (!fields || !fields.requestorName || !fields.requestorEmail || (!fields.description && !hasKids)) {
    throw new Error('A request needs a requestor name, an email address, and at least one described record.');
  }
  var cols = normalize(fields);
  var kids = childrenOf(fields);
  var parentId = uuidv4();
  var wrap = opts.wrap !== false;
  // opts.id names the FIRST child — every caller that predates MRR passes one and expects it back as `id`.
  var childIds = kids.map(function (_, i) { return (i === 0 && opts.id) ? opts.id : uuidv4(); });
  var childId = childIds[0];

  // `is_mrr` is DERIVED, never hand-set (§4.1): it is `child_count > 1`, a FACT, not a mode. The classifier's
  // and the portal's `isMrr` flag is now advisory only — what the citizen actually described decides. It lives
  // on the PARENT; a child is never "an MRR", it is a component of one.
  cols.is_mrr = 0;
  var parentIsMrr = kids.length > 1 ? 1 : 0;

  var placeholders = COLUMNS.map(function () { return '?'; }).join(',');
  var values = COLUMNS.map(function (c) { return cols[c]; });

  // Race-safe: two concurrent submissions can compute the same next number. The UNIQUE constraint on
  // request_number is the referee; on a collision we re-read the max and try again rather than 500.
  var requestNumber = null, lastErr = null;
  for (var attempt = 0; attempt < 5; attempt++) {
    requestNumber = opts.requestNumber || await nextRequestNumber();
    try {
      if (wrap) {
        // PARENT first — the child's master_request_id references it.
        // The WORK columns are NULLed on the parent, not copied. `description` above all: a copy makes every
        // description lookup match BOTH rows (the suite proved this the moment the wrap went in), which is the
        // double-count the scope predicates exist to prevent. Routing columns follow the same rule — routing is
        // decided from the description, so it belongs to whoever holds the description (§5.1, §14.2).
        // `classification` IS copied: it drives the statutory clock's duration, and that clock is the parent's.
        await run(
          'INSERT INTO requests (id, request_number, stage, status, master_request_id, child_no, ' + COLUMNS.join(', ') + ') ' +
          'VALUES (?, ?, NULL, ?, NULL, NULL, ' + placeholders + ')',
          [parentId, requestNumber, 'active'].concat(COLUMNS.map(function (c) {
            if (c === 'is_mrr') return parentIsMrr; // derived from what was actually described
            return PARENT_NULL[c] ? null : cols[c];
          }))
        );
        // CHILDREN — 1..n. The first keeps the id everything else hangs off. child_no starts at 1, never 0: a
        // zero would make the single-record case a different shape, which is exactly what always-wrap exists to
        // prevent (§5.1). A single-record request is simply n = 1 and takes THIS SAME PATH — there is no
        // "MRR mode" branch, and that is the point.
        for (var k = 0; k < kids.length; k++) {
          await run(
            'INSERT INTO requests (id, request_number, stage, status, master_request_id, child_no, ' + COLUMNS.join(', ') + ') ' +
            'VALUES (?, ?, ?, ?, ?, ?, ' + placeholders + ')',
            [childIds[k], requestNumber + '-' + (k + 1), 'intake', 'active', parentId, k + 1]
              .concat(COLUMNS.map(function (c) {
                return Object.prototype.hasOwnProperty.call(kids[k], c) ? kids[k][c] : cols[c];
              }))
          );
        }
      } else {
        // Unwrapped: the LIBRARY / SYS-* containers. They are not citizen requests and must never grow a parent.
        await run(
          'INSERT INTO requests (id, request_number, stage, status, ' + COLUMNS.join(', ') + ') ' +
          'VALUES (?, ?, ?, ?, ' + placeholders + ')',
          [childId, requestNumber, 'intake', 'active'].concat(values)
        );
      }
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

  // HISTORY IS WRITTEN AT THE LEVEL OF THE ACTION (§8) — and creation happens at BOTH levels, so both get a
  // row. They are not duplicates; they are different facts, and MRR makes that obvious (one submission, n
  // components):
  //   PARENT — the citizen submitted a request. The parent's trail must not start empty; its later rows are
  //            payments and clock events, which are also parent-level.
  //   CHILD  — this component came into being. Staff open the CHILD (it is the work row), and its audit trail
  //            must not start mid-story with a stage advance out of nowhere. requestTimeline builds the stage
  //            backbone from these rows.
  // Stage advances write their own child rows through applyStageTransition — never from here.
  for (var h = 0; h < childIds.length; h++) {
    await run(
      'INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), childIds[h], opts.actorId || null, opts.actorName || 'System',
       opts.historyAction || 'CREATED',
       kids.length > 1
         ? 'Record ' + (h + 1) + ' of ' + kids.length + ' on request ' + requestNumber + '.'
         : (opts.historyNote || 'Request created.')]
    );
  }
  if (wrap) {
    await run(
      'INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), parentId, opts.actorId || null, opts.actorName || 'System',
       opts.historyAction || 'CREATED',
       'Request received from the requestor (' + requestNumber + ')' +
       (kids.length > 1 ? ' — ' + kids.length + ' records described.' : '.')]
    );
  }

  // The DEADLINE comes from the jurisdiction, not from a hardcoded table. startClocksForRequest is
  // idempotent and writes requests.deadline_date via tolling.writebackDeadline().
  // THE STATUTORY CLOCK IS A PARENT OBJECT (§4.2) — one legal deadline per citizen request, never one per
  // record. A child carries only its BUDGET clock (§5.4), which is a different column and a different idea.
  if (opts.startClocks !== false) {
    try { await require('./tolling').startClocksForRequest(wrap ? parentId : childId); }
    catch (e) { console.error('[requestCreate] clock start failed:', e && e.message); }
  }

  // Routing is decided from the DESCRIPTION, and each child has its OWN — so intake runs PER CHILD, and the
  // children of one MRR can land in different departments at different stages (§14.2, Kevin 2026-07-16).
  // NOTE: on an MRR the classifier's result is meant to be a SUGGESTION the ORO Associate confirms in the hub
  // (§14.2 suggest-vs-commit). The hub does not exist yet (§14.3, design-gated), so today every child commits
  // its routing exactly as a single-record request does. That is the pre-existing behaviour, not a new decision
  // — flagged here so the hub slice knows where the gate belongs.
  // SEQUENTIALLY, in ONE background chain — not n parallel ones. Each onIntake makes an Anthropic call
  // (classifier.js, claude-sonnet-4-5), so firing n at once means n concurrent LLM calls per submission: rate
  // limits, a cost spike, and — observed in the harness — a child that silently never gets routed because its
  // call lost. A 10-record MRR would fire ten. One child failing must not strand its siblings, so each is
  // caught and logged individually rather than aborting the chain.
  if (opts.kickIntake !== false) {
    var we = require('./workflowEngine');
    we.bg((async function () {
      for (var n = 0; n < childIds.length; n++) {
        try { await we.onIntake(childIds[n]); }
        catch (e) { console.error('[requestCreate] intake failed for child ' + (n + 1) + '/' + childIds.length + ' (' + childIds[n] + '):', e && e.message); }
      }
    })(), 'intake ' + requestNumber + ' (' + childIds.length + (childIds.length === 1 ? ' child)' : ' children)'));
  }

  return {
    id: childId, requestNumber: requestNumber,
    parentId: wrap ? parentId : null, childId: childId,
    childIds: childIds, childCount: childIds.length, isMrr: !!parentIsMrr
  };
}

module.exports = {
  createRequest: createRequest,
  nextRequestNumber: nextRequestNumber,
  COLUMNS: COLUMNS,
  SEQ_DIGITS: SEQ_DIGITS, // exported so the renumber script and the suite cannot drift from the helper
};
