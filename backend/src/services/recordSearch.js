const { all } = require('../db');
const demoConnector = require('./connectors/demo');

var connectors = {
  demo: demoConnector
  // future: laserfiche, axon, tyler, accela
};

async function searchAll(query) {
  var repos = all("SELECT id, name, connector_type FROM record_repositories WHERE status = 'active' ORDER BY sort_order");
  var allResults = [];
  for (var i = 0; i < repos.length; i++) {
    var repo = repos[i];
    var connector = connectors[repo.connector_type];
    if (!connector) continue;
    try {
      var results = await connector.search(query);
      allResults = allResults.concat(results);
    } catch(e) {
      console.error('[recordSearch] connector', repo.connector_type, 'failed:', e.message);
    }
  }
  // Sort by match score desc and return top 10
  allResults.sort(function(a, b) { return b.matchScore - a.matchScore; });
  return allResults.slice(0, 10);
}

module.exports = { searchAll: searchAll };
