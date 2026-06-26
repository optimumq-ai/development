'use strict';
// Live (incremental) embedding indexer. Keeps the `embeddings` table current as
// record types are created/edited/discovered and as document pages get text.
// All public calls are safe to fire-and-forget via bg(); they never throw into callers.
var db = require('../db');
var v = require('./voyageEmbed');
var uuid = require('uuid');

function arr(s) { try { var a = JSON.parse(s); return Array.isArray(a) ? a.join(', ') : (s || ''); } catch (e) { return s || ''; } }
function rtText(rt) {
  return [rt.name, rt.description, rt.intent, rt.expected_content, rt.typical_request_reason, arr(rt.synonyms), arr(rt.keywords)]
    .filter(Boolean).join('. ');
}

async function upsertEmbedding(ownerType, ownerId, vec, content) {
  var vj = JSON.stringify(vec);
  await db.run("DELETE FROM embeddings WHERE owner_type = ? AND owner_id = ? AND model = ?", [ownerType, ownerId, v.MODEL]);
  await db.run(
    "INSERT INTO embeddings (id, owner_type, owner_id, model, dim, vec, embedding, content, created_at) VALUES (?,?,?,?,?,?,?::vector,?,datetime('now'))",
    [uuid.v4(), ownerType, ownerId, v.MODEL, v.DIM, vj, vj, (content || '').slice(0, 400)]
  );
}

async function removeEmbedding(ownerType, ownerId) {
  await db.run("DELETE FROM embeddings WHERE owner_type = ? AND owner_id = ?", [ownerType, ownerId]);
}

async function reindexRecordTypes(ids) {
  if (!ids || !ids.length) return;
  var qs = ids.map(function () { return '?'; }).join(',');
  var rows = await db.all(
    "SELECT id, name, description, intent, expected_content, typical_request_reason, synonyms, keywords, status FROM record_types WHERE id IN (" + qs + ")", ids);
  var active = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].status === 'archived') { await removeEmbedding('record_type', rows[i].id); }
    else active.push(rows[i]);
  }
  var BATCH = 40;
  for (var j = 0; j < active.length; j += BATCH) {
    var slice = active.slice(j, j + BATCH);
    var texts = slice.map(rtText);
    var vecs = await v.embed(texts, { inputType: 'document' });
    for (var k = 0; k < slice.length; k++) { await upsertEmbedding('record_type', slice[k].id, vecs[k], texts[k]); }
  }
}

function reindexRecordType(id) { return reindexRecordTypes([id]); }

async function reindexDocumentPagesForFile(fileId) {
  var pages = await db.all(
    "SELECT id, text FROM document_pages WHERE file_id = ? AND text IS NOT NULL AND length(trim(text)) > 0", [fileId]);
  if (!pages.length) return;
  var BATCH = 16;
  for (var i = 0; i < pages.length; i += BATCH) {
    var slice = pages.slice(i, i + BATCH);
    var texts = slice.map(function (p) { return String(p.text || '').slice(0, 16000); });
    var vecs = await v.embed(texts, { inputType: 'document' });
    for (var k = 0; k < slice.length; k++) { await upsertEmbedding('document_page', slice[k].id, vecs[k], String(slice[k].text || '')); }
  }
}

// Reconstruct the CLEARED full text of a redacted record from the source OCR word-boxes
// MINUS any word that touches a redaction zone (bbox intersection -> over-redacts toward safety,
// never leaks a redacted word). Coords are normalized 0-1, top-left, same frame for words+zones.
function _wordsMinusZones(wordsJson, zones) {
  var words; try { words = JSON.parse(wordsJson || '[]'); } catch (e) { return ''; }
  if (!Array.isArray(words)) return '';
  return words.filter(function (wd) {
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      var noOverlap = (wd.x + wd.w) <= z.x || wd.x >= (z.x + z.w) || (wd.y + wd.h) <= z.y || wd.y >= (z.y + z.h);
      if (!noOverlap) return false; // word touches a redaction box -> drop it
    }
    return true;
  }).map(function (wd) { return wd.t; }).join(' ');
}
async function redactedTextForSource(sourceFileId) {
  if (!sourceFileId) return '';
  var pages = await db.all("SELECT page_no, words FROM document_pages WHERE file_id = ? AND words IS NOT NULL ORDER BY page_no", [sourceFileId]);
  if (!pages.length) return '';
  var zoneRows = await db.all("SELECT rz.page_no, rz.x, rz.y, rz.w, rz.h FROM redaction_zones rz JOIN redaction_jobs rj ON rj.id = rz.job_id WHERE rj.file_id = ? AND (rz.review_state IS NULL OR rz.review_state <> 'rejected')", [sourceFileId]);
  var byPage = {}; zoneRows.forEach(function (z) { (byPage[z.page_no] = byPage[z.page_no] || []).push(z); });
  var parts = [];
  for (var i = 0; i < pages.length; i++) { parts.push(_wordsMinusZones(pages[i].words, byPage[pages[i].page_no] || [])); }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function frText(fr) {
  return [fr.title, fr.summary, fr.keywords, fr.record_type_name].filter(Boolean).join('. ');
}
async function reindexFulfilledRecord(id) {
  var fr = await db.get("SELECT fr.id, fr.title, fr.summary, fr.keywords, fr.source_file_id, rt.name AS record_type_name FROM fulfilled_records fr LEFT JOIN record_types rt ON rt.id = fr.record_type_id WHERE fr.id = ?", [id]);
  if (!fr) { await removeEmbedding('fulfilled_record', id); return; }
  var text = frText(fr);
  try { var body = await redactedTextForSource(fr.source_file_id); if (body) text = (text + ". " + body).slice(0, 14000); } catch (e) {}
  if (!text || !text.trim()) return;
  var vecs = await v.embed([text], { inputType: 'document' });
  await upsertEmbedding('fulfilled_record', fr.id, vecs[0], text);
}

// Fire-and-forget guard: run in background, swallow+log errors so indexing never breaks the caller.
function bg(promise, label) {
  Promise.resolve(promise).catch(function (e) { console.error('[embedIndex] ' + (label || 'task') + ' failed:', e && e.message); });
}

module.exports = {
  reindexRecordType: reindexRecordType,
  reindexRecordTypes: reindexRecordTypes,
  reindexDocumentPagesForFile: reindexDocumentPagesForFile,
  reindexFulfilledRecord: reindexFulfilledRecord,
  redactedTextForSource: redactedTextForSource,
  removeEmbedding: removeEmbedding,
  upsertEmbedding: upsertEmbedding,
  rtText: rtText,
  bg: bg
};
