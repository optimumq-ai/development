const { all } = require('../db');
const demoConnector = require('./connectors/demo');
const tylerConnector = require('./connectors/tyler');
const axonConnector = require('./connectors/axon');

var connectors = {
  demo: demoConnector,
  tyler: tylerConnector,
  axon: axonConnector
  // future: axon, laserfiche, accela
};

async function searchAll(query) {
  var repos = await all("SELECT id, name, connector_type, config FROM record_repositories WHERE status = 'active' ORDER BY sort_order");
  var allResults = [];
  // Query each active repository in parallel
  var searches = repos.map(async function(repo) {
    var connector = connectors[repo.connector_type];
    if (!connector) return [];
    var config = {};
    try { config = repo.config ? JSON.parse(repo.config) : {}; } catch(e) {}
    try {
      // demo connector takes (query); others take (query, config)
      var results = repo.connector_type === 'demo'
        ? await connector.search(query)
        : await connector.search(query, config);
      return results || [];
    } catch(e) {
      console.error('[recordSearch] connector', repo.connector_type, 'failed:', e.message);
      return [];
    }
  });
  var resultSets = await Promise.all(searches);
  resultSets.forEach(function(set){ allResults = allResults.concat(set); });
  // Sort by match score desc, return top 10
  allResults.sort(function(a, b) { return b.matchScore - a.matchScore; });
  return allResults.slice(0, 10);
}

module.exports = { searchAll: searchAll };
