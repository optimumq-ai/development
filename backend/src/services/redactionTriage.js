'use strict';
// Redaction automation — read-based triage (SPEC_redaction_automation.md, slice 3b).
//
// For each responsive file with no identity bypass (slice 2/3a), run the AI content read, compute the
// disposition (slice 1) from the read + record-type + legal signals, and PERSIST it on the file's job so
// the redaction screen opens pre-triaged. Record-type-clean files (case c: auto_release_eligible + a
// successful zero-span read) bypass here, released as-is. Runs in the BACKGROUND off the stage transition
// (kicked from applyStageTransition), so the read's latency/failure never blocks a stage advance.
//
// Guardrails: a failed read never bypasses (-> Simple). Template matching is NOT yet wired, so a span-bearing
// doc with no confident template lands in Elevated (safe: more review, never less) — a documented refinement.

var { all, get, run } = require('../db');
var uuidv4 = require('uuid').v4;
var disposition = require('./redactionDisposition');
var bypass = require('./redactionBypass');
var zoneDiscovery = require('./zoneDiscovery');

var DOC_MIME = /^(application\/pdf|image\/)/i;

// Run the AI read for a document file -> { readOk, spans:[{category}] }. spanCount uses max(located, found)
// so an item the model found but couldn't be located in the OCR word-boxes still counts (never a false-clean).
// readOk is TRUE only for a real read of a real document: a non-document mimetype, or a doc with no OCR'd
// pages, returns readOk:FALSE so it can NEVER be auto-bypassed as "clean" (it was never actually read).
async function runRead(file) {
  if (!DOC_MIME.test(file.mimetype || '')) return { readOk: false, spans: [] }; // non-document: not read here
  try {
    var pc = await get('SELECT count(*) AS c FROM document_pages WHERE file_id = ?', [file.id]);
    if (!pc || !Number(pc.c)) { try { await require('./docProcessing').processFile(file.id); } catch (eP) { /* fall through to page check */ } }
    var r = await zoneDiscovery.discoverZones(file.id);
    if (!Number(r.scanned_pages || 0)) return { readOk: false, spans: [] }; // no readable pages -> read did not happen
    var found = (typeof r.found === 'number') ? r.found : (r.suggestions ? r.suggestions.length : 0);
    var spans = (r.suggestions || []).map(function (s) { return { category: s.category || null }; });
    while (spans.length < found) spans.push({ category: null }); // found-but-unlocated fallback
    return { readOk: true, spans: spans };
  } catch (e) {
    console.error('[redactionTriage read]', file.id, e && e.message);
    return { readOk: false, spans: [] };
  }
}

async function assembleSignals(file, ctx) {
  var reqRow = file.request_id ? await get('SELECT record_type_id, legal_flag FROM requests WHERE id = ?', [file.request_id]) : null;
  var rt = (reqRow && reqRow.record_type_id) ? await get('SELECT auto_release_eligible, public_availability FROM record_types WHERE id = ?', [reqRow.record_type_id]) : null;
  var taskRouting = require('./taskRouting'); // lazy require avoids a load-order cycle
  var legalFlag = file.request_id ? await taskRouting.requestNeedsLegalRedaction(file.request_id, reqRow) : false;
  var read = ctx && ctx.readOverride ? ctx.readOverride : await runRead(file);
  return {
    autoReleaseEligible: rt ? !!rt.auto_release_eligible : false,
    publicAvailability: rt ? rt.public_availability : null,
    legalFlag: !!legalFlag,
    readOk: !!read.readOk,
    spans: read.spans || []
    // templateMatched intentionally omitted (not yet wired) -> span-bearing docs default to Elevated.
  };
}

// Ensure a non-released draft job for the file (to hold the persisted disposition).
async function ensureJob(file, ctx) {
  var j = await get("SELECT * FROM redaction_jobs WHERE file_id = ? AND review_stage <> 'released' ORDER BY created_at DESC LIMIT 1", [file.id]);
  if (j) return j;
  var jid = uuidv4();
  await run("INSERT INTO redaction_jobs (id, file_id, request_id, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,datetime('now'),datetime('now'))",
    [jid, file.id, file.request_id || null, 'draft', (ctx && ctx.actor) || 'triage']);
  return await get('SELECT * FROM redaction_jobs WHERE id = ?', [jid]);
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

// Compute + persist the disposition for one file. Idempotent: a file whose current job already carries a
// disposition is not re-read. Returns { disposition, basis, cached? }.
async function computeAndPersistDisposition(file, ctx) {
  ctx = ctx || {};
  var current = await get("SELECT id, disposition, disposition_basis, review_stage FROM redaction_jobs WHERE file_id = ? ORDER BY created_at DESC LIMIT 1", [file.id]);
  if (current && current.disposition) return { disposition: current.disposition, basis: safeParse(current.disposition_basis), cached: true };

  var signals = await assembleSignals(file, ctx);
  var d = disposition.computeDisposition(signals, ctx.config);

  if (d.disposition === 'bypass') {
    await bypass.recordCleanBypass(file, d.basis, { actorName: (ctx.actorName || 'Redaction Triage') });
    return d;
  }
  var job = await ensureJob(file, ctx);
  await run("UPDATE redaction_jobs SET disposition = ?, disposition_basis = ?, updated_at = datetime('now') WHERE id = ?",
    [d.disposition, JSON.stringify(d.basis || {}), job.id]);
  return d;
}

async function cancelRedactionTask(requestId) {
  await run("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE request_id = ? AND type IN ('redaction','legal_redaction') AND status IN ('open','assigned','in_progress')", [requestId]);
}

// Triage every responsive, not-yet-released file for a request; then, if record-type-clean bypasses cleared
// the remainder, advance to delivery and cancel the (now unneeded) redaction task. Returns a summary.
async function triageReadForRequest(requestId, ctx) {
  ctx = ctx || {};
  var files = await bypass.responsiveFiles(requestId);
  var results = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (await bypass.fileAlreadyReleased(f.id)) { results.push({ file: f.id, disposition: 'released' }); continue; }
    try { var d = await computeAndPersistDisposition(f, ctx); results.push({ file: f.id, disposition: d.disposition }); }
    catch (e) { console.error('[triageReadForRequest]', f.id, e && e.message); results.push({ file: f.id, error: true }); }
  }
  var adv = await bypass.advanceIfAllReleased(requestId, { actorName: 'Redaction Triage' });
  if (adv.advanced) await cancelRedactionTask(requestId);
  return { files: results, advanced: adv.advanced };
}

module.exports = {
  runRead: runRead,
  assembleSignals: assembleSignals,
  computeAndPersistDisposition: computeAndPersistDisposition,
  triageReadForRequest: triageReadForRequest
};
