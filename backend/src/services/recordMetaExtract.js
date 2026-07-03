'use strict';
// Slice 2b — AI catalog-metadata extraction for public-ready records.
// extractRecordMeta(text, ctx): reads CLEARED (already-redacted, public) document text -> returns
//   { title, summary, eventDate, keywords } so the library is searchable/browsable by good metadata
//   instead of the crude filename + request-description fallback. Best-effort; failure leaves crude meta.
// enrichFulfilledMeta(frId): background task fired after a deposit. Pulls cleared text, extracts meta,
//   updates the fulfilled_record, then re-embeds. Always re-embeds even on no-op so the record is searchable.
var Anthropic = require('@anthropic-ai/sdk');
var db = require('../db');
var ei = require('./embedIndex');

function buildPrompt(text, ctx) {
  return ''
    + 'You write catalog metadata for a PUBLIC-READY government record that has already been redacted and '
    + 'cleared for public release. From the DOCUMENT TEXT, produce concise, accurate metadata so a member '
    + 'of the public can find and recognize this record in an online public-records library.\n\n'
    + (ctx ? ('Record type: ' + ctx + '\n\n') : '')
    + 'Return ONLY a JSON object (no prose, no markdown fences) with these keys:\n'
    + '  "title": a short, specific, human-readable title (<= 90 chars). Lead with the record KIND, then the '
    + 'single most identifying detail actually present (address, permit/case number, project or party name, '
    + 'or date). Preserve a meaningful distinction the document states about itself (for example an '
    + 'APPLICATION versus an ISSUED permit). Never invent details not in the text.\n'
    + '  "summary": 1-2 plain, factual sentences: what the record is plus its most useful identifying facts. '
    + 'Neutral tone, no marketing words.\n'
    + '  "eventDate": the primary date the record concerns (issue/filing/meeting/decision date) as YYYY-MM-DD '
    + 'if clearly present in the text, otherwise null. Do not guess.\n'
    + '  "keywords": a short space-separated string of terms a citizen might actually search for.\n\n'
    + 'Use ONLY information present in the text. If the text is too sparse to title meaningfully, title it by '
    + 'the record kind alone. Do not include any redacted/withheld content even if hinted at.\n\n'
    + 'DOCUMENT TEXT:\n' + String(text || '').slice(0, 16000);
}

async function extractRecordMeta(text, ctx) {
  var clean = String(text || '').slice(0, 16000);
  if (!clean.trim()) return null;
  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var msg = await client.messages.create({
    model: 'claude-sonnet-4-5', max_tokens: 700,
    messages: [{ role: 'user', content: buildPrompt(clean, ctx) }]
  });
  var raw = (msg.content[0] && msg.content[0].text ? msg.content[0].text : '').trim().replace(/```json|```/g, '').trim();
  var p = JSON.parse(raw);
  if (!p || typeof p !== 'object') return null;
  var ed = (typeof p.eventDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.eventDate)) ? p.eventDate : null;
  return {
    title: (p.title && String(p.title).trim()) || null,
    summary: (p.summary && String(p.summary).trim()) || null,
    eventDate: ed,
    keywords: (p.keywords && String(p.keywords).trim()) || null
  };
}

async function enrichFulfilledMeta(frId) {
  try {
    var fr = await db.get("SELECT id, title, summary, source_file_id, record_type_id FROM fulfilled_records WHERE id = ?", [frId]);
    if (fr) {
      var body = await ei.redactedTextForSource(fr.source_file_id);
      if (body && body.trim().length >= 40) {
        var rtName = '';
        if (fr.record_type_id) {
          var rt = await db.get("SELECT name FROM record_types WHERE id = ?", [fr.record_type_id]);
          rtName = rt ? rt.name : '';
        }
        var meta = await extractRecordMeta(body, rtName);
        if (meta) {
          await db.run(
            "UPDATE fulfilled_records SET title = COALESCE(?, title), summary = COALESCE(?, summary), keywords = COALESCE(?, keywords), event_date = COALESCE(?, event_date) WHERE id = ?",
            [meta.title, meta.summary, meta.keywords, meta.eventDate, frId]);
        }
      }
    }
  } catch (e) { console.error('[enrichFulfilledMeta]', e && e.message); }
  try { await ei.reindexFulfilledRecord(frId); } catch (e) { console.error('[enrichFulfilledMeta embed]', e && e.message); }
  try { var frRow = await db.get("SELECT id, title, summary, geo_address FROM fulfilled_records WHERE id = ?", [frId]); if (frRow) await require('./geocode').geocodeRecord(frRow); } catch (e) { console.error('[enrichFulfilledMeta geocode]', e && e.message); }
}

module.exports = { extractRecordMeta: extractRecordMeta, enrichFulfilledMeta: enrichFulfilledMeta };
