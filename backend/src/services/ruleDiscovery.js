// AI auto-population of the Redaction Rules Library: asks the model for jurisdiction-appropriate
// open-records exemptions NOT already present, and inserts each as a source='ai', pending_review,
// inactive DRAFT. Never auto-approved - a supervisor reviews/verifies/approves before it takes effect.
const Anthropic = require('@anthropic-ai/sdk');
const { all, get, run } = require('../db');
const { v4: uuidv4 } = require('uuid');

var VALID_CATS = ['privacy','law_enforcement','health','legal','personnel','commercial','security','administrative'];

function extractFirstArray(text) {
  var s = text.indexOf('[');
  if (s === -1) return null;
  var depth = 0, inStr = false, esc = false;
  for (var i = s; i < text.length; i++) {
    var ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return text.slice(s, i + 1); }
  }
  return null;
}
function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function srcType(t) { return ['statute','regulation','case_law'].indexOf(t) >= 0 ? t : 'statute'; }

async function discoverRules(jurisdictionId) {
  var jur = await get('SELECT * FROM jurisdiction_profiles WHERE id = ?', [jurisdictionId]);
  if (!jur) throw new Error('jurisdiction not found');
  var agencyRow = await get("SELECT value FROM system_config WHERE key = 'agency_name'");
  var agencyName = agencyRow ? agencyRow.value : 'the agency';

  var existing = await all('SELECT title FROM redaction_rules WHERE jurisdiction_id = ?', [jurisdictionId]);
  var existingCites = await all('SELECT DISTINCT citation FROM legal_sources WHERE jurisdiction_id = ?', [jurisdictionId]);

  var prompt = 'You are assisting the public records office of ' + agencyName + ' in ' + jur.name +
    ', which operates under the ' + (jur.statute_name || 'state public records law') + ' (' + (jur.statute_citation || '') + ').\n\n' +
    'Propose ADDITIONAL redaction rules - categories of information this agency is legally required or permitted to withhold or redact before releasing public records - that are genuinely applicable in ' + jur.name + ' and are NOT already in their library below.\n\n' +
    'Already in the library (do NOT duplicate these):\n- ' + (existing.map(function(e){ return e.title; }).join('\n- ') || '(none)') + '\n\n' +
    'Existing citations already covered:\n' + (existingCites.map(function(c){ return c.citation; }).join('; ') || '(none)') + '\n\n' +
    'Use ONLY these category codes: ' + VALID_CATS.join(', ') + '.\n\n' +
    'Return ONLY a JSON array (no other text) of new suggestions, each:\n' +
    '{"title":"short name","description":"plain-language explanation of what to redact and under what circumstances","category":"<code>","legal_sources":[{"name":"short label","citation":"formal statutory or regulatory citation","source_type":"statute|regulation|case_law","statute_text":"a concise, accurate summary of what the provision says (for the reviewer; it will be verified)"}]}\n\n' +
    'Be accurate and specific with ' + jur.name + ' citations. Include 5 to 12 of the most operationally common exemptions not already covered. These are DRAFTS that the agency\'s legal counsel will verify before use, so prefer well-established exemptions. Return ONLY the JSON array.';

  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var resp = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] });
  var text = resp.content.map(function(b){ return b.type === 'text' ? b.text : ''; }).join('');
  var arr = extractFirstArray(text);
  if (!arr) return { added: 0, skipped: 0, rules: [] };
  var suggestions = JSON.parse(arr);

  var seenTitle = {}; existing.forEach(function(e){ seenTitle[norm(e.title)] = 1; });
  var added = [], skipped = 0;
  for (var i = 0; i < suggestions.length; i++) {
    var sug = suggestions[i];
    if (!sug || !sug.title || !sug.description || seenTitle[norm(sug.title)]) { skipped++; continue; }
    var cat = VALID_CATS.indexOf(sug.category) >= 0 ? sug.category : 'administrative';
    var ruleId = uuidv4();
    await run('INSERT INTO redaction_rules (id, jurisdiction_id, title, description, category, approval_status, is_active, source) VALUES (?,?,?,?,?,?,?,?)',
      [ruleId, jurisdictionId, sug.title, sug.description, cat, 'pending_review', 0, 'ai']);
    var srcs = Array.isArray(sug.legal_sources) ? sug.legal_sources : [];
    for (var j = 0; j < srcs.length; j++) {
      var sc = srcs[j]; var cite = ((sc && (sc.citation || sc.name)) || '').trim();
      if (!cite) continue;
      var ex = await get('SELECT id FROM legal_sources WHERE jurisdiction_id = ? AND citation = ?', [jurisdictionId, cite]);
      var sid = ex ? ex.id : uuidv4();
      if (!ex) await run('INSERT INTO legal_sources (id, jurisdiction_id, name, citation, source_type, description, statute_text, source) VALUES (?,?,?,?,?,?,?,?)',
        [sid, jurisdictionId, sc.name || cite, cite, srcType(sc.source_type), sc.description || null, sc.statute_text || null, 'ai']);
      await run('INSERT INTO rule_legal_sources (id, rule_id, legal_source_id) VALUES (?,?,?)', [uuidv4(), ruleId, sid]);
    }
    seenTitle[norm(sug.title)] = 1;
    added.push({ id: ruleId, title: sug.title, category: cat });
  }
  return { added: added.length, skipped: skipped, rules: added };
}

module.exports = { discoverRules: discoverRules };
