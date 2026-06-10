// AI content detection for redaction: the model reads the document's text, flags spans that are
// exempt/sensitive and maps each to a rule from the library. We then locate those words in the
// word-box data we already extracted and return SUGGESTED boxes (placed on the real text, so the
// coordinates are correct by construction - no coordinate guessing). Suggestions are ephemeral;
// the user accepts/dismisses them in the workspace.
const Anthropic = require('@anthropic-ai/sdk');
const { all, get } = require('../db');

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function extractFirstArray(text) {
  var s = text.indexOf('['); if (s === -1) return null;
  var depth = 0, inStr = false, esc = false;
  for (var i = s; i < text.length; i++) {
    var ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '[') depth++; else if (ch === ']') { depth--; if (depth === 0) return text.slice(s, i + 1); }
  }
  return null;
}
// Find contiguous runs of words whose joined (normalized) text equals the span.
function findRuns(words, spanText) {
  var target = norm(spanText); if (!target) return [];
  var runs = [];
  for (var i = 0; i < words.length; i++) {
    var acc = '';
    for (var j = i; j < words.length; j++) {
      acc += norm(words[j].t);
      if (acc === target) { runs.push([i, j]); break; }
      if (acc.length >= target.length) break;
      if (target.indexOf(acc) !== 0) break;
    }
  }
  return runs;
}
function unionBox(words, i, j) {
  var x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (var k = i; k <= j; k++) { var w = words[k]; x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y); x1 = Math.max(x1, w.x + w.w); y1 = Math.max(y1, w.y + w.h); }
  var box = { x: Math.max(0, x0 - 0.003), y: Math.max(0, y0 - 0.002) };
  box.w = Math.min(1 - box.x, (x1 - x0) + 0.006); box.h = Math.min(1 - box.y, (y1 - y0) + 0.004);
  return box;
}

async function discoverZones(fileId) {
  var pages = await all('SELECT page_no, text, words FROM document_pages WHERE file_id = ? ORDER BY page_no', [fileId]);
  if (!pages.length) return { suggestions: [], scanned_pages: 0 };
  var jurRow = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  var jurId = (jurRow && jurRow.value) || 'jur-tx';
  var jur = await get('SELECT name FROM jurisdiction_profiles WHERE id = ?', [jurId]);
  var rules = await all("SELECT id, title, category, description FROM redaction_rules WHERE jurisdiction_id = ? AND approval_status = 'approved' AND is_active = 1", [jurId]);
  var ruleById = {}; rules.forEach(function(r){ ruleById[r.id] = r; });
  var menu = rules.map(function(r){ return r.id + ' | ' + r.title + ' (' + r.category + ')' + (r.description ? ' - ' + r.description.slice(0, 90) : ''); }).join('\n');

  var blocks = [];
  for (var i = 0; i < pages.length; i++) { blocks.push('=== PAGE ' + pages[i].page_no + ' ===\n' + (pages[i].text || '').replace(/[ \t]+\n/g, '\n')); }
  var doc = blocks.join('\n\n'); if (doc.length > 24000) doc = doc.slice(0, 24000);

  var prompt = 'You are reviewing a government record held by a public agency in ' + ((jur && jur.name) || 'this jurisdiction') + ' before it is released under a public records request. ' +
    'Identify every span of text that is EXEMPT / sensitive and should be redacted before release: a private individual\'s name, Social Security number, date of birth, home/residential address, personal phone number, email, financial account or card number, driver\'s license or other ID number, medical information, and similar personal data.\n\n' +
    'Do NOT flag: the issuing or holding agency\'s own name/address/phone, public officials or employees named in their official capacity, case/form/application numbers that are not personal identifiers, dates that are not dates of birth, or generic/public boilerplate.\n\n' +
    'Available redaction rules (choose the best rule_id for each finding, or null if none fits):\n' + menu + '\n\n' +
    'Document text, by page:\n' + doc + '\n\n' +
    'Return ONLY a JSON array. Each element: {"page": <page number>, "text": "<the exact text substring as it appears in the document>", "rule_id": "<id from the list or null>", "reason": "<short why>"}. ' +
    'The "text" must match the document exactly so it can be located. Split distinct items (e.g. each address line, name, number) into separate elements. Return ONLY the JSON array.';

  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var resp = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] });
  var txt = resp.content.map(function(b){ return b.type === 'text' ? b.text : ''; }).join('');
  var arr = extractFirstArray(txt); if (!arr) return { suggestions: [], scanned_pages: pages.length };
  var items; try { items = JSON.parse(arr); } catch (e) { return { suggestions: [], scanned_pages: pages.length }; }

  var wordsByPage = {}; pages.forEach(function(p){ try { wordsByPage[p.page_no] = JSON.parse(p.words || '[]'); } catch (e) { wordsByPage[p.page_no] = []; } });
  var suggestions = [], seen = {}, unmatched = 0;
  items.forEach(function(it){
    if (!it || !it.text) return;
    var pn = it.page || 1; var words = wordsByPage[pn] || [];
    var runs = findRuns(words, it.text);
    if (!runs.length) { unmatched++; return; }
    runs.forEach(function(run){
      var key = pn + ':' + run[0] + ':' + run[1]; if (seen[key]) return; seen[key] = 1;
      var box = unionBox(words, run[0], run[1]);
      var r = it.rule_id && ruleById[it.rule_id];
      suggestions.push({ page_no: pn, x: box.x, y: box.y, w: box.w, h: box.h, rule_id: r ? it.rule_id : null, rule_title: r ? r.title : null, category: r ? r.category : null, text: it.text, reason: it.reason || null });
    });
  });
  return { suggestions: suggestions.slice(0, 50), scanned_pages: pages.length, found: items.length, unmatched: unmatched };
}

// Given a human description of a field (e.g. "driver's license number"), pick the best rule from the library.
async function suggestRule(label) {
  if (!label || !label.trim()) return { rule_id: null };
  var jurRow = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  var jurId = (jurRow && jurRow.value) || 'jur-tx';
  var rules = await all("SELECT id, title, category, description FROM redaction_rules WHERE jurisdiction_id = ? AND approval_status = 'approved' AND is_active = 1", [jurId]);
  if (!rules.length) return { rule_id: null };
  var menu = rules.map(function (r) { return r.id + ' | ' + r.title + ' (' + r.category + ')' + (r.description ? ' - ' + r.description.slice(0, 90) : ''); }).join('\n');
  var prompt = 'A records officer drew a redaction box over a field they describe as: "' + label.trim() + '".\n\n' +
    'Choose the single best-matching redaction rule for this field from the list below, or null if none reasonably fits. ' +
    'Match on the meaning of the field (e.g. a driver\'s license or license plate maps to a motor vehicle record rule; a home phone maps to a home address/telephone rule).\n\n' +
    'Rules:\n' + menu + '\n\nReturn ONLY JSON: {"rule_id": "<id from the list, or null>"}.';
  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var resp = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 200, messages: [{ role: 'user', content: prompt }] });
  var txt = resp.content.map(function (b) { return b.type === 'text' ? b.text : ''; }).join('');
  var m = txt.match(/\{[\s\S]*\}/); var obj = {}; try { obj = JSON.parse(m ? m[0] : '{}'); } catch (e) {}
  var hit = obj.rule_id && rules.filter(function (r) { return r.id === obj.rule_id; })[0];
  return hit ? { rule_id: hit.id, rule_title: hit.title, category: hit.category } : { rule_id: null };
}

module.exports = { discoverZones: discoverZones, suggestRule: suggestRule };
