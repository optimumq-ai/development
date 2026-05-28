// Axon Evidence connector - queries an Axon Evidence instance (or demo stub)
// and returns police records as Optimum Q search results.
const Anthropic = require('@anthropic-ai/sdk');

async function fetchJson(url, apiKey) {
  var res = await fetch(url, { headers: { 'X-API-Key': apiKey } });
  if (!res.ok) throw new Error('Axon API returned ' + res.status);
  return res.json();
}

async function search(query, config) {
  if (!config || !config.baseUrl) {
    console.error('[axon connector] missing baseUrl in config');
    return [];
  }
  var base = config.baseUrl.replace(/\/$/, '');
  var apiKey = config.apiKey || '';

  // Pull incidents (these are the records citizens usually request)
  var incidents = [];
  try {
    var data = await fetchJson(base + '/api/evidence/v1/incidents?pageSize=100', apiKey);
    incidents = data.data || [];
  } catch(e) {
    console.error('[axon connector] incident fetch failed:', e.message);
    return [];
  }
  if (!incidents.length) return [];

  var catalog = incidents.map(function(inc, i) {
    return (i+1) + '. ID:' + inc.incidentId +
      ' | Case: ' + inc.caseNumber +
      ' | Type: ' + inc.incidentType +
      ' | Officer: ' + inc.officer +
      ' | Location: ' + inc.location +
      ' | Date: ' + (inc.occurredAt || '').split('T')[0] +
      ' | Status: ' + inc.status +
      (inc.redactionRequired ? ' | REDACTION REQUIRED' : '');
  }).join('\n');

  var prompt = 'A citizen submitted a public records request. Their request: "' + query + '"\n\n' +
    'Below are police incident records. Return the ones relevant to the request as a JSON array. Only include genuinely relevant records (match score >= 50). If the request is not about police/incident/body-cam/law-enforcement records at all, return an empty array.\n\n' +
    catalog + '\n\n' +
    'Return ONLY a JSON array, no other text:\n' +
    '[{"id":"INC-XXXXXXXX","match_score":85,"relevance_note":"one sentence why this matches"}]';

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
      var inc = incidents.find(function(x){ return x.incidentId === r.id; });
      if (!inc) return null;
      var availability = inc.redactionRequired ? 'restricted' : 'available';
      var summaryParts = [inc.incidentType + ' at ' + inc.location, 'Officer ' + inc.officer, 'Status: ' + inc.status];
      if (inc.redactionRequired) summaryParts.push('⚠ Redaction review required before release');
      if (inc.involvesMinor) summaryParts.push('⚠ Involves a minor');
      return {
        id: inc.incidentId,
        sourceSystem: 'Axon Evidence (Police Records)',
        title: 'Case ' + inc.caseNumber + ' - ' + inc.incidentType,
        summary: summaryParts.join(' · '),
        relevanceNote: r.relevance_note,
        department: 'Police',
        docType: 'Police Incident',
        dateCreated: (inc.occurredAt || '').split('T')[0],
        pageCount: 1,
        publicAvailability: availability,
        matchScore: r.match_score
      };
    }).filter(function(x){ return x !== null; });
    return results;
  } catch(e) {
    console.error('[axon connector] ranking failed:', e.message);
    return [];
  }
}

module.exports = { search: search };
