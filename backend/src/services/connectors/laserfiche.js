// Laserfiche ECM connector - queries a Laserfiche repository (or the demo stub)
// and returns documents as Optimum Q search results. This is the citywide DMS:
// one source spanning many departments and record series, ranked by AI relevance.
const Anthropic = require('@anthropic-ai/sdk');

async function fetchJson(url, apiKey) {
  var res = await fetch(url, { headers: { 'X-API-Key': apiKey } });
  if (!res.ok) throw new Error('Laserfiche API returned ' + res.status);
  return res.json();
}

// Extract the first complete JSON array from model text, ignoring any trailing prose.
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

function mapAvailability(status) {
  if (status === 'public') return 'available';
  if (status === 'redaction_required') return 'review_required';
  if (status === 'restricted') return 'restricted';
  return 'review_required';
}

async function search(query, config) {
  if (!config || !config.baseUrl) {
    console.error('[laserfiche connector] missing baseUrl in config');
    return [];
  }
  var base = config.baseUrl.replace(/\/$/, '');
  var apiKey = config.apiKey || '';

  var docs = [];
  try {
    var data = await fetchJson(base + '/LFRepositoryAPI/v1/entries?pageSize=200', apiKey);
    docs = data.data || [];
  } catch(e) {
    console.error('[laserfiche connector] entry fetch failed:', e.message);
    return [];
  }
  if (!docs.length) return [];

  var catalog = docs.map(function(d, i) {
    return (i+1) + '. ID:' + d.entryId +
      ' | Series: ' + d.recordSeries +
      ' | Dept: ' + d.department +
      ' | Title: ' + d.name +
      ' | Date: ' + d.documentDate +
      ' | ' + d.summary;
  }).join('\n');

  var prompt = 'A member of the public submitted a records request: "' + query + '"\n\n' +
    'Below are documents from the city Laserfiche document management system, spanning many departments and record series. ' +
    'Return ONLY the documents genuinely relevant to the request as a JSON array (match score >= 50). ' +
    'If nothing is relevant, return an empty array.\n\n' +
    catalog + '\n\n' +
    'Return ONLY a JSON array, no other text:\n' +
    '[{"id":"LF-XXXXXX","match_score":85,"relevance_note":"one sentence why this matches"}]';

  try {
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    var text = response.content.map(function(b){ return b.type === 'text' ? b.text : ''; }).join('');
    var arrStr = extractFirstArray(text);
    if (!arrStr) return [];
    var ranked = JSON.parse(arrStr);
    var results = ranked.map(function(r) {
      var d = docs.find(function(x){ return x.entryId === r.id; });
      if (!d) return null;
      return {
        id: d.entryId,
        sourceSystem: 'Laserfiche ECM',
        title: d.name,
        summary: d.summary,
        department: d.department,
        docType: d.recordSeries,
        dateCreated: d.documentDate,
        pageCount: d.pageCount,
        publicAvailability: mapAvailability(d.releaseStatus),
        matchScore: r.match_score || 50,
        matchedTerms: []
      };
    }).filter(Boolean);
    return results;
  } catch(e) {
    console.error('[laserfiche connector] ranking failed:', e.message);
    return [];
  }
}

async function nativeSearch(query, config) {
  var kw = require('./keyword');
  var terms = kw.tokenize(query);
  if (!terms.length) return [];
  if (!config || !config.baseUrl) return [];
  var base = config.baseUrl.replace(/\/$/, '');
  var docs = [];
  try { var data = await fetchJson(base + '/LFRepositoryAPI/v1/entries?pageSize=200', config.apiKey || ''); docs = data.data || []; } catch(e) { return []; }
  var out = [];
  docs.forEach(function(d){
    var m = kw.match(terms, d.name + ' ' + d.recordSeries, d.summary + ' ' + d.department);
    if (!m) return;
    out.push({ id: d.entryId, sourceSystem: 'Laserfiche ECM', title: d.name, summary: d.summary, department: d.department, docType: d.recordSeries, dateCreated: d.documentDate, pageCount: d.pageCount, publicAvailability: mapAvailability(d.releaseStatus), matchScore: m.score, matchedTerms: m.matched });
  });
  out.sort(function(a,b){ return b.matchScore - a.matchScore; });
  return out.slice(0, 10);
}

module.exports = { search: search, nativeSearch: nativeSearch };
