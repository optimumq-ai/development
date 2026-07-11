'use strict';
// Redaction automation — bypass mechanism (SPEC_redaction_automation.md, slice 2).
//
// Identity bypass (cases a/b in §2): a responsive file that is provably the same document as one
// already released can skip redaction and reuse the prior released output. No AI read is needed —
// this is a pure database identity check, so it lives here, separate from the read-dependent
// record-type-clean case (c), which slice 3 assembles.
//
// File identity: request_files has no content hash and no link back to a library record, so identity
// is (original_name + size + mimetype) matched against a released fulfilled_records row via its
// source_file_id. A match whose fulfilled_records.published = 1 is a public-ready library copy
// (basis published_public_copy, §2a); otherwise it is a previously-released copy (previously_released_dedup, §2b).
// Both reuse the matched output_file_id.
//
// Nothing here is wired into a route/flow yet — slice 3 (eager computation at stage entry) calls it.

var { all, get, run } = require('../db');
var uuidv4 = require('uuid').v4;
var disposition = require('./redactionDisposition');

// Find a released output for a document identical to `file` (a different prior release).
// file: { id, request_id, original_name, size, mimetype }
// returns { fulfilledId, outputFileId, published, title, summary, recordTypeId, pageCount } | null
async function findReusableRelease(file) {
  if (!file || !file.original_name) return null;
  var row = await get(
    "SELECT fr.id AS fulfilled_id, fr.output_file_id, fr.published, fr.title, fr.summary, fr.record_type_id, fr.page_count " +
    "FROM fulfilled_records fr JOIN request_files sf ON sf.id = fr.source_file_id " +
    "WHERE fr.status = 'released' AND fr.output_file_id IS NOT NULL " +
    "AND sf.original_name = ? AND sf.size = ? AND COALESCE(sf.mimetype,'') = COALESCE(?,'') " +
    "AND fr.source_file_id <> ? " +
    "ORDER BY (CASE WHEN fr.published = 1 THEN 0 ELSE 1 END), fr.released_at DESC LIMIT 1",
    [file.original_name, (file.size == null ? null : file.size), file.mimetype || null, file.id]
  );
  if (!row) return null;
  return {
    fulfilledId: row.fulfilled_id,
    outputFileId: row.output_file_id,
    published: !!row.published,
    title: row.title,
    summary: row.summary,
    recordTypeId: row.record_type_id,
    pageCount: row.page_count
  };
}

// True when this file already has a released redaction job (already redacted or already bypassed).
async function fileAlreadyReleased(fileId) {
  var r = await get("SELECT id FROM redaction_jobs WHERE file_id = ? AND review_stage = 'released' LIMIT 1", [fileId]);
  return !!r;
}

// Record a bypass for `file`: a uniform redaction_jobs row (disposition=bypass, review_stage=released)
// reusing `reuse.outputFileId`, plus a fulfilled_records row for THIS request pointing at the reused
// output, plus a history row. Idempotent. ctx: { actorId, actorName }.
// returns { jobId, disposition:'bypass', basis, outputFileId } | { skipped:true } when already released.
async function recordBypass(file, basis, reuse, ctx) {
  ctx = ctx || {};
  if (await fileAlreadyReleased(file.id)) return { skipped: true };

  var jobId = uuidv4();
  await run(
    "INSERT INTO redaction_jobs (id, file_id, request_id, status, output_file_id, review_stage, disposition, disposition_basis, created_by, created_at, updated_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))",
    [jobId, file.id, file.request_id || null, 'released', reuse.outputFileId, 'released', 'bypass', JSON.stringify(basis || {}), ctx.actorId || null]
  );

  // Give this request its own released record pointing at the reused output (dedup reuse; no re-redaction).
  await run('DELETE FROM fulfilled_records WHERE source_file_id = ?', [file.id]);
  var frId = uuidv4();
  var baseTitle = reuse.title || (file.original_name || 'Released record').replace(/\.[a-z0-9]+$/i, '');
  await run(
    'INSERT INTO fulfilled_records (id, request_id, source_file_id, output_file_id, title, summary, record_type_id, department_id, keywords, public_availability, page_count, released_by, released_at, status) ' +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?)",
    [frId, file.request_id || null, file.id, reuse.outputFileId, baseTitle, reuse.summary || baseTitle, reuse.recordTypeId || null, null, baseTitle, 'released', reuse.pageCount || null, ctx.actorName || 'System', 'released']
  );
  // A published source stays public-ready on reuse; a private prior release stays unpublished.
  if (reuse.published) {
    await run("UPDATE fulfilled_records SET published = 1, published_at = datetime('now'), published_by = ? WHERE id = ?", [ctx.actorName || 'System', frId]);
  }

  if (file.request_id) {
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), file.request_id, ctx.actorId || null, ctx.actorName || 'System', 'REDACTION_BYPASSED',
       'No redaction required for ' + (file.original_name || file.id) + ' — reused a previously released copy (' + ((basis && basis.rule) || 'dedup') + ').']);
  }
  return { jobId: jobId, disposition: 'bypass', basis: basis, outputFileId: reuse.outputFileId };
}

// Convenience: check identity bypass for one file and record it if applicable.
// returns { bypassed:true, basis, jobId, outputFileId } | { bypassed:false }
async function bypassIdentityFile(file, ctx) {
  var reuse = await findReusableRelease(file);
  if (!reuse) return { bypassed: false };
  var signals = { isPublishedPublicCopy: reuse.published, priorReleasedOutputFileId: reuse.published ? null : reuse.outputFileId };
  var d = disposition.computeDisposition(signals); // -> bypass / published_public_copy | previously_released_dedup
  if (d.disposition !== 'bypass') return { bypassed: false };
  var rec = await recordBypass(file, d.basis, reuse, ctx);
  if (rec.skipped) return { bypassed: false, alreadyReleased: true };
  return { bypassed: true, basis: d.basis, jobId: rec.jobId, outputFileId: rec.outputFileId };
}

// Auto-bypass every provably-clean responsive file for a request (identity cases a/b).
// Read-independent — safe to call synchronously in the stage-transition path (no LLM/OCR).
// returns { total, bypassed, allReleased }.
async function bypassIdentityForRequest(requestId, ctx) {
  var files = await responsiveFiles(requestId);
  var bypassed = 0;
  for (var i = 0; i < files.length; i++) {
    var r = await bypassIdentityFile(files[i], ctx);
    if (r.bypassed) bypassed++;
  }
  return { total: files.length, bypassed: bypassed, allReleased: await allResponsiveReleased(requestId) };
}

// ---- completion / advance helpers (used by slice 3's orchestrator; reusable now) ----

async function responsiveFiles(requestId) {
  return await all("SELECT id, request_id, original_name, mimetype, size FROM request_files WHERE request_id = ? AND responsive = 1", [requestId]);
}

// Every responsive file has a released redaction job (redacted or bypassed). False when there are none.
async function allResponsiveReleased(requestId) {
  var files = await responsiveFiles(requestId);
  if (!files.length) return false;
  for (var i = 0; i < files.length; i++) {
    if (!(await fileAlreadyReleased(files[i].id))) return false;
  }
  return true;
}

var REDACTION_STAGES = { redaction_review: 1, redaction: 1 };

// If the request sits at a redaction stage and every responsive file is released, advance to delivery
// through the ONE central stage-transition. Returns { advanced:bool, from } .
async function advanceIfAllReleased(requestId, ctx) {
  ctx = ctx || {};
  var reqRow = await get('SELECT stage FROM requests WHERE id = ?', [requestId]);
  if (!reqRow || !REDACTION_STAGES[reqRow.stage]) return { advanced: false, from: reqRow ? reqRow.stage : null };
  if (!(await allResponsiveReleased(requestId))) return { advanced: false, from: reqRow.stage };
  var taskRouting = require('./taskRouting'); // lazy require avoids any load-order coupling
  await taskRouting.applyStageTransition(requestId, 'delivery', {
    actorId: ctx.actorId || null,
    actorName: ctx.actorName || 'Redaction',
    action: 'STAGE_ADVANCED',
    notes: 'All responsive records released (redacted or bypassed) — advanced to delivery.'
  });
  return { advanced: true, from: reqRow.stage };
}

module.exports = {
  findReusableRelease: findReusableRelease,
  fileAlreadyReleased: fileAlreadyReleased,
  recordBypass: recordBypass,
  bypassIdentityFile: bypassIdentityFile,
  bypassIdentityForRequest: bypassIdentityForRequest,
  responsiveFiles: responsiveFiles,
  allResponsiveReleased: allResponsiveReleased,
  advanceIfAllReleased: advanceIfAllReleased
};
