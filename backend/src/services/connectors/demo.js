const Anthropic = require('@anthropic-ai/sdk');
const { all } = require('../../db');

async function search(query) {
  var docs = await all('SELECT id, title, summary, department, doc_type, date_created, page_count, public_availability, tags FROM demo_documents');
  if (!docs.length) return [];

  // Build a compact catalog for Claude to rank
  var catalog = docs.map(function(d, i) {
    return (i+1) + '. ID:' + d.id.substr(0,8) + ' | ' + d.title + ' | Dept: ' + d.department + ' | Type: ' + d.doc_type + ' | Date: ' + d.date_created + ' | Pages: ' + d.page_count + ' | Summary: ' + d.summary + ' | Tags: ' + d.tags;
  }).join('\n');

  var prompt = 'A citizen is searching for public records. Their query: "' + query + '"\n\n' +
    'Here is the catalog of available documents:\n\n' + catalog + '\n\n' +
    'Return the top 5 most relevant matches as a JSON array. Only include documents that are actually relevant to the query (match score >= 40). If nothing matches well, return an empty array.\n\n' +
    'Response format (return ONLY the JSON array, no other text):\n' +
    '[{"id_prefix":"abc12345","match_score":85,"relevance_note":"one sentence on why this matches"}, ...]\n\n' +
    'Score guidance: 90+ = exact match, 70-89 = strong match, 40-69 = possibly relevant, <40 = exclude.';

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
    var seen = {};
    var results = ranked.map(function(r) {
      var doc = docs.find(function(d) { return d.id.indexOf(r.id_prefix) === 0; });
      if (!doc) return null;
      return {
        id: doc.id,
        sourceSystem: 'Demo Document Library',
        title: doc.title,
        summary: doc.summary,
        relevanceNote: r.relevance_note,
        department: doc.department,
        docType: doc.doc_type,
        dateCreated: doc.date_created,
        pageCount: doc.page_count,
        publicAvailability: doc.public_availability,
        matchScore: r.match_score
      };
    }).filter(function(x){
      if (x === null || seen[x.id]) return false;
      seen[x.id] = true;
      return true;
    });
    return results;
  } catch(e) {
    console.error('[demo connector] search failed:', e.message);
    return [];
  }
}

module.exports = { search: search };
