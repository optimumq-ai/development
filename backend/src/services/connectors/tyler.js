// Tyler Munis connector - queries a Munis ERP instance (or the demo stub)
// and returns financial records as Optimum Q search results.
const Anthropic = require('@anthropic-ai/sdk');

// Node 18+ has global fetch built in
async function fetchJson(url, apiKey) {
  var res = await fetch(url, { headers: { 'X-API-Key': apiKey } });
  if (!res.ok) throw new Error('Tyler API returned ' + res.status);
  return res.json();
}

// config = { baseUrl, apiKey } from the repository record
async function search(query, config) {
  if (!config || !config.baseUrl) {
    console.error('[tyler connector] missing baseUrl in config');
    return [];
  }
  var base = config.baseUrl.replace(/\/$/, '');
  var apiKey = config.apiKey || '';

  // Pull a broad set of invoices (up to 100, newest first) to rank
  var invoices = [];
  try {
    var data = await fetchJson(base + '/api/munis/v1/invoices?pageSize=100', apiKey);
    invoices = data.data || [];
  } catch(e) {
    console.error('[tyler connector] invoice fetch failed:', e.message);
    return [];
  }
  if (!invoices.length) return [];

  // Build a compact catalog for Claude to rank
  var catalog = invoices.map(function(inv, i) {
    return (i+1) + '. ID:' + inv.invoiceId +
      ' | Vendor: ' + inv.vendorName +
      ' | Dept: ' + inv.department +
      ' | Desc: ' + inv.description +
      ' | Amount: $' + inv.amount.toLocaleString() +
      ' | Date: ' + inv.invoiceDate +
      ' | Status: ' + inv.paymentStatus;
  }).join('\n');

  var prompt = 'A citizen submitted a public records request. Their request: "' + query + '"\n\n' +
    'Below are financial records (invoices/payments) from the city ERP system. Return the ones relevant to the request as a JSON array. Only include genuinely relevant records (match score >= 50). If the request is not about financial/payment/vendor/invoice records at all, return an empty array.\n\n' +
    catalog + '\n\n' +
    'Return ONLY a JSON array, no other text:\n' +
    '[{"id":"INV-XXXXXXXX","match_score":85,"relevance_note":"one sentence why this matches"}]';

  try {
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    var text = response.content.map(function(b){ return b.type === 'text' ? b.text : ''; }).join('');
    var jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    var ranked = JSON.parse(jsonMatch[0]);
    var results = ranked.map(function(r) {
      var inv = invoices.find(function(x){ return x.invoiceId === r.id; });
      if (!inv) return null;
      return {
        id: inv.invoiceId,
        sourceSystem: 'Tyler Munis (Financial/ERP)',
        title: 'Invoice ' + inv.invoiceNumber + ' - ' + inv.vendorName,
        summary: inv.description + ' — $' + inv.amount.toLocaleString() + ' (' + inv.paymentStatus + ')' + (inv.checkNumber ? ', Check ' + inv.checkNumber : ''),
        relevanceNote: r.relevance_note,
        department: inv.department,
        docType: 'Invoice',
        dateCreated: inv.invoiceDate,
        pageCount: 1,
        publicAvailability: 'available',
        matchScore: r.match_score
      };
    }).filter(function(x){ return x !== null; });
    return results;
  } catch(e) {
    console.error('[tyler connector] ranking failed:', e.message);
    return [];
  }
}

async function nativeSearch(query, config) {
  var kw = require('./keyword');
  var terms = kw.tokenize(query);
  if (!terms.length) return [];
  if (!config || !config.baseUrl) return [];
  var base = config.baseUrl.replace(/\/$/, '');
  var invoices = [];
  try {
    var data = await fetchJson(base + '/api/munis/v1/invoices?pageSize=100', config.apiKey || '');
    invoices = data.data || [];
  } catch(e) { console.error('[tyler nativeSearch]', e.message); return []; }
  var out = [];
  invoices.forEach(function(inv) {
    var primary = (inv.vendorName || '') + ' ' + (inv.invoiceNumber || '') + ' ' + (inv.poNumber || '') + ' ' + (inv.checkNumber || '');
    var secondary = (inv.description || '') + ' ' + (inv.department || '') + ' ' + (inv.fundCode || '') + ' ' + (inv.paymentStatus || '');
    var m = kw.match(terms, primary, secondary);
    if (!m) return;
    out.push({ id: inv.invoiceId, sourceSystem: 'Tyler Munis (Financial/ERP)', title: 'Invoice ' + inv.invoiceNumber + ' - ' + inv.vendorName, summary: inv.description + ' \u2014 $' + inv.amount.toLocaleString() + ' (' + inv.paymentStatus + ')', department: inv.department, docType: 'Invoice', dateCreated: inv.invoiceDate, pageCount: 1, publicAvailability: 'available', matchScore: m.score, matchedTerms: m.matched });
  });
  out.sort(function(a, b) { return b.matchScore - a.matchScore; });
  return out.slice(0, 8);
}

module.exports = { search: search, nativeSearch: nativeSearch };
