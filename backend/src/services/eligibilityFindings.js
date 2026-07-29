'use strict';
// PHASE 7 / BW3 — THE STRUCTURED ELIGIBILITY FINDINGS READ (DRAFT_processing_ui_intake_review.md §4.5,
// SPEC_processing_ui.md §8 "structured eligibility findings read").
//
// services/eligibilityGate.js DECIDES; this module REMEMBERS. The gate returns
// `{blocks, reviews, advisories}` at submit time and, until now, that structure was thrown away — only a
// prose history note survived. Three consumers need the structure back:
//
//   1. THE SPAWN TRIGGER. "an eligibility review returned" is trigger (ii) of intake_review, evaluated in
//      workflowEngine.onIntake. BW2 deliberately left it unwired because the only signal was a history
//      note's action string, and wiring a trigger to a sentence written for a human is a guess dressed as
//      a signal. This is the signal it was waiting for.
//   2. THE PANEL. Rule (c): an advisory renders ghost/dashed "recorded — nothing to decide"; a review
//      renders amber with a confirm control. Per-dimension, which the summary string flattens.
//   3. THE PROCEED GATE. A review is open until a NAMED PERSON confirms it. That confirmation has to be
//      recorded against the finding it answers, which a history row has nowhere to put.
//
// ══ WHAT THIS MODULE DOES NOT DO ══
//
// It does not re-evaluate. `read()` returns what was decided AT SUBMIT TIME, because that is what the
// reviewer is being asked about and because re-running the gate on a screen render would let a config edit
// silently retract a finding a person is mid-way through confirming.
//
// It does not invent findings for requests that predate the table. A request created before BW3 has its
// prose note and nothing else; `read()` reports those notes as `legacy` and — deliberately — they do NOT
// gate Proceed. A gate on a finding with no confirm control is a stop nobody can clear, which is worse
// than the missing gate: it would strand every in-flight request across the deploy. Stated here rather
// than left to be rediscovered.
var db = require('../db');
var get = db.get, all = db.all, run = db.run;
var uuidv4 = require('uuid').v4;

var CLASSES = ['block', 'review', 'advisory'];

function jsonArr(s) { try { var a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

// Shape one stored row the way a screen wants it. `open` is the whole point: a review nobody has confirmed
// is the thing that stops a Proceed, and an advisory is never open no matter what.
function shape(r) {
  return {
    id: r.id,
    requestId: r.request_id,
    dimension: r.dimension,
    class: r.finding_class,
    label: r.label,
    action: r.action,
    configConfirmed: Number(r.config_confirmed) === 1,
    factKnown: Number(r.fact_known) === 1,
    why: r.why,
    note: r.note,
    sourceRuleIds: jsonArr(r.source_rule_ids),
    evaluatedAt: r.evaluated_at,
    confirmedAt: r.confirmed_at || null,
    confirmedBy: r.confirmed_by || null,
    confirmNote: r.confirm_note || null,
    open: r.finding_class === 'review' && !r.confirmed_at
  };
}

// Persist an eligibilityGate.evaluate() result against a request. Never throws: an eligibility finding is
// something the request CARRIES, and a submission must not fail because the carrying failed. The same
// principle requestCreate already applies to the prose note beside it.
//
// Returns the number of rows written, or 0.
async function record(requestId, result) {
  if (!requestId || !result) return 0;
  var rows = [];
  ['block', 'review', 'advisory'].forEach(function (cls) {
    var list = result[cls + 's'];
    if (!Array.isArray(list)) return;
    list.forEach(function (f) { rows.push({ cls: cls, f: f }); });
  });
  if (!rows.length) return 0;
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    var f = rows[i].f;
    try {
      // ON CONFLICT on (request_id, dimension): a re-evaluation UPDATES the finding rather than stacking a
      // second one — but it must not erase a confirmation a person already gave. The confirm columns are
      // therefore left alone; a reviewer's recorded act is not the evaluator's to overwrite.
      await run(
        'INSERT INTO request_eligibility_findings ' +
        '(id, request_id, dimension, finding_class, label, action, config_confirmed, fact_known, why, note, source_rule_ids) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT (request_id, dimension) DO UPDATE SET finding_class = EXCLUDED.finding_class, ' +
        'label = EXCLUDED.label, action = EXCLUDED.action, config_confirmed = EXCLUDED.config_confirmed, ' +
        'fact_known = EXCLUDED.fact_known, why = EXCLUDED.why, note = EXCLUDED.note, ' +
        'source_rule_ids = EXCLUDED.source_rule_ids',
        [uuidv4(), requestId, f.dimension, rows[i].cls, f.label || null, f.action || null,
         f.confirmed === true ? 1 : 0, f.known === true ? 1 : 0, f.why || null, f.note || null,
         JSON.stringify(f.source_rule_ids || [])]);
      n++;
    } catch (e) { console.error('[eligibilityFindings record]', requestId, f.dimension, e && e.message); }
  }
  return n;
}

async function rowsFor(requestId) {
  if (!requestId) return [];
  try { return await all('SELECT * FROM request_eligibility_findings WHERE request_id = ? ORDER BY finding_class, dimension', [requestId]); }
  catch (e) { console.error('[eligibilityFindings rowsFor]', requestId, e && e.message); return []; }
}

// The prose notes written before this table existed (and the ones still written beside it). Surfaced so a
// legacy request's screen is not blank about a finding the audit trail plainly records — labelled, never
// parsed into a fake structure.
async function legacyNotes(requestId) {
  if (!requestId) return [];
  try {
    return await all(
      "SELECT id, action, notes, created_at FROM request_history WHERE request_id = ? " +
      "AND action IN ('ELIGIBILITY_REVIEW','ELIGIBILITY_ADVISORY') ORDER BY created_at", [requestId]);
  } catch (e) { return []; }
}

// The screen's read: `{blocks, reviews, advisories}` plus the derived questions everything else asks.
async function read(requestId) {
  var rows = await rowsFor(requestId);
  var out = { requestId: requestId, blocks: [], reviews: [], advisories: [], openReviews: 0, structured: rows.length > 0 };
  rows.forEach(function (r) {
    var s = shape(r);
    if (s.class === 'block') out.blocks.push(s);
    else if (s.class === 'review') { out.reviews.push(s); if (s.open) out.openReviews++; }
    else out.advisories.push(s);
  });
  var notes = await legacyNotes(requestId);
  // Only worth showing when there is nothing structured: otherwise the note is a prose restatement of the
  // rows above it, and two renderings of one fact is how a screen starts contradicting itself.
  out.legacy = out.structured ? [] : notes.map(function (n) {
    return { id: n.id, action: n.action, notes: n.notes, createdAt: n.created_at,
             why: 'Recorded before structured findings existed — the audit note is all there is, so there is nothing here to confirm.' };
  });
  return out;
}

// Trigger (ii): did a review come back? Used at SPAWN time (workflowEngine.onIntake), where the question is
// about the evaluation, not about anyone's confirmation yet.
async function hasReview(requestId) {
  try {
    var r = await get("SELECT count(*)::int AS n FROM request_eligibility_findings WHERE request_id = ? AND finding_class = 'review'", [requestId]);
    return !!(r && r.n > 0);
  } catch (e) { return false; }
}

// The gate's question: which reviews is nobody willing to put their name to yet?
async function openReviews(requestId) {
  try {
    var rows = await all("SELECT * FROM request_eligibility_findings WHERE request_id = ? AND finding_class = 'review' AND confirmed_at IS NULL ORDER BY dimension", [requestId]);
    return rows.map(shape);
  } catch (e) { return []; }
}

// A person confirms one finding. Their name is the point (rule c: `a person`, named) — the system never
// confirms its own advisory. Idempotent: re-confirming an already-confirmed finding is a no-op, not an
// overwrite of whoever actually decided it.
async function confirm(findingId, opts) {
  opts = opts || {};
  var row = await get('SELECT * FROM request_eligibility_findings WHERE id = ?', [findingId]);
  if (!row) { var e = new Error('Eligibility finding not found.'); e.status = 404; e.code = 'FINDING_NOT_FOUND'; throw e; }
  if (row.finding_class !== 'review') {
    var e2 = new Error('Only a finding that needs review can be confirmed; this one is ' + row.finding_class + ' — there is nothing to decide.');
    e2.status = 400; e2.code = 'NOT_A_REVIEW'; throw e2;
  }
  if (row.confirmed_at) return shape(row);
  if (!opts.actorName) { var e3 = new Error('A confirmation has to name the person making it.'); e3.status = 400; e3.code = 'ACTOR_REQUIRED'; throw e3; }
  await run("UPDATE request_eligibility_findings SET confirmed_at = datetime('now'), confirmed_by = ?, confirm_note = ? WHERE id = ?",
    [opts.actorName, (opts.note || '').trim() || null, findingId]);
  try {
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), row.request_id, opts.actorId || null, opts.actorName, 'ELIGIBILITY_REVIEW_CONFIRMED',
       (row.label || row.dimension) + ' — confirmed by ' + opts.actorName + '.' + (opts.note ? ' ' + String(opts.note).trim() : '')]);
  } catch (e4) { console.error('[eligibilityFindings confirm history]', e4 && e4.message); }
  return shape(await get('SELECT * FROM request_eligibility_findings WHERE id = ?', [findingId]));
}

module.exports = {
  CLASSES: CLASSES,
  record: record,
  read: read,
  hasReview: hasReview,
  openReviews: openReviews,
  legacyNotes: legacyNotes,
  confirm: confirm
};
