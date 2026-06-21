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

// Fire-and-forget guard: run in background, swallow+log errors so indexing never breaks the caller.
function bg(promise, label) {
  Promise.resolve(promise).catch(function (e) { console.error('[embedIndex] ' + (label || 'task') + ' failed:', e && e.message); });
}

module.exports = {
  reindexRecordType: reindexRecordType,
  reindexRecordTypes: reindexRecordTypes,
  reindexDocumentPagesForFile: reindexDocumentPagesForFile,
  removeEmbedding: removeEmbedding,
  rtText: rtText,
  bg: bg
};
