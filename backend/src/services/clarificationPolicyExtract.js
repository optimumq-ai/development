'use strict';
// AI clarification / vague-request POLICY extraction (clarification-policy slice 3).
// Reads a jurisdiction's statute / ordinance / AG-guidance text and proposes the 7-field
// clarification_policy (clock effect, duty, vagueness-as-denial, grace windows, closure, notice) WITH
// per-field provenance (source / citation / confidence). The proposal rides the EXISTING config-freshness
// review -> attest -> apply pipeline (configExtractors 'clarification' adapter -> effectiveConfig.applyConfig).
// Nothing applies automatically, and the runtime clock trigger stays gated on a separate profile-section
// attestation (clarificationPolicy.automationActive). The AI is never in the runtime clock path.
//
// This is the domain-specific sibling of feePolicyExtract: it replaces the generic extractor so proposals
// use the exact enum vocabularies (guaranteeing a schema-valid, apply-able config) and carry provenance.
var Anthropic = require('@anthropic-ai/sdk');
var CP = require('./clarificationPolicy');

// Tolerant JSON-object extractor: strips fences, then brace-matches the first balanced {...}.
function parseJSONObject(s) {
  var t = String(s || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  var a = t.indexOf('{'); if (a === -1) return null;
  var depth = 0, inStr = false, esc = false;
  for (var i = a; i < t.length; i++) { var ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(a, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}

// Describe each field + its allowed values straight from the clarificationPolicy schema, so this stays in
// sync if the field catalog changes.
function fieldCatalog() {
  return CP.FIELDS.map(function (f) {
    var allowed = f.type === 'enum' ? (' — one of: ' + f.values.join(' | '))
      : (f.type === 'bool' ? ' — true or false'
        : ' — a whole number of days, or null if the source does not specify');
    return '- "' + f.key + '" (' + f.label + ')' + allowed + '. ' + f.help;
  }).join('\n');
}

function buildPrompt(text, jurName, currentCfg) {
  return ''
    + 'You extract a CLARIFICATION / VAGUE-REQUEST policy from a U.S. public-records (FOIA / open-records) '
    + 'statute, ordinance, or attorney-general guidance for ' + (jurName || 'this jurisdiction') + '. This '
    + 'policy governs what happens when a request is too vague or insufficient: whether and how the statutory '
    + 'response clock reacts when the agency asks the requester to clarify, whether vagueness can itself '
    + 'justify a denial, and the grace windows before a non-responsive request may be closed.\n\n'
    + 'CURRENT CONFIGURATION (JSON):\n' + JSON.stringify(currentCfg || {}, null, 2) + '\n\n'
    + 'FIELDS to set — use these EXACT keys and allowed values; choose the value the SOURCE supports, '
    + 'otherwise keep the current/default value and do not invent one:\n'
    + fieldCatalog() + '\n'
    + '- "enabled" — true ONLY if the source establishes a real clarification policy worth automating; '
    + 'false if the source is silent on clarification handling.\n\n'
    + 'Return ONLY a JSON object (no prose, no markdown fences) with keys: config, provenance, summary.\n'
    + 'config: an object with the field keys above plus "enabled". Use the allowed enum values verbatim; '
    + 'for day counts use a number or null; never guess a value the source does not support.\n'
    + 'provenance: an object KEYED BY FIELD NAME, each value { "source": one of [' + CP.SOURCES.join(', ') + '], '
    + '"citation": a SHORT quote or section reference, 15 words or fewer, "confidence": a number 0..1 }. '
    + 'Include an entry for EVERY field you set from the source.\n'
    + 'summary: one short paragraph — what the source establishes vs. the current config, with the citation; '
    + 'or "No change indicated." if the source is silent.\n\n'
    + 'SOURCE DOCUMENT:\n' + String(text).slice(0, 60000);
}

// Returns { proposed, summary } matching the configExtractors adapter.extract contract. `proposed` is a
// schema-normalized clarification_policy object (incl. keyed provenance) — lenient normalize guarantees a
// valid, apply-able config even if the model returns an off-vocabulary enum; the human reviewer and the
// strict validate() at apply time are the real gates.
async function extract(text, opts) {
  opts = opts || {};
  var clean = String(text || '').slice(0, 60000);
  if (!clean.trim()) throw new Error('No policy text provided.');
  var currentCfg = opts.currentCfg || CP.defaults();
  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var msg = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1500, messages: [{ role: 'user', content: buildPrompt(clean, opts.jurName, currentCfg) }] });
  var raw = (msg.content || []).map(function (b) { return b.text || ''; }).join('\n');
  var parsed = parseJSONObject(raw) || {};
  var cfg = (parsed.config && typeof parsed.config === 'object') ? parsed.config : {};
  if (parsed.provenance && typeof parsed.provenance === 'object') cfg.provenance = parsed.provenance;
  var proposed = CP.normalize(cfg);
  var summary = (typeof parsed.summary === 'string' && parsed.summary.trim())
    ? parsed.summary.trim()
    : 'Proposed clarification policy extracted from the source document.';
  return { proposed: proposed, summary: summary };
}

module.exports = { extract: extract, buildPrompt: buildPrompt, parseJSONObject: parseJSONObject };
