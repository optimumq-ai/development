// Paper Records Index connector.
// Searches an imported index of physical/paper records (paper_index_items) for a
// given repository. A "hit" returns the physical LOCATION of the record (facility,
// box, folder) rather than a downloadable file; retrieval is handled manually.
var { all } = require('../../db');

async function nativeSearch(query, config) {
  var kw = require('./keyword');
  var terms = kw.tokenize(query);
  if (!terms.length) return [];
  var repoId = config && (config.__repoId || config.repository_id);
  if (!repoId) return [];
  var facility = (config && config.facility) ? config.facility : '';
  var items = await all('SELECT id, title, description, location, record_date, box, folder, tags FROM paper_index_items WHERE repository_id = ?', [repoId]);
  var out = [];
  items.forEach(function(it) {
    var primary = (it.title || '') + ' ' + (it.tags || '');
    var secondary = (it.description || '') + ' ' + (it.location || '') + ' ' + (it.box || '') + ' ' + (it.folder || '');
    var m = kw.match(terms, primary, secondary);
    if (!m) return;
    var locParts = [];
    if (facility) locParts.push(facility);
    if (it.location) locParts.push(it.location);
    if (it.box) locParts.push('Box ' + it.box);
    if (it.folder) locParts.push('Folder ' + it.folder);
    out.push({
      id: 'paper:' + it.id,
      sourceSystem: facility || 'Paper Records',
      title: it.title,
      summary: it.description || '',
      location: locParts.join(' \u00b7 '),
      department: '',
      docType: 'Paper record',
      dateCreated: it.record_date || '',
      pageCount: null,
      publicAvailability: 'paper',
      matchScore: m.score,
      matchedTerms: m.matched
    });
  });
  out.sort(function(a, b) { return b.matchScore - a.matchScore; });
  return out.slice(0, 12);
}

module.exports = { nativeSearch: nativeSearch };
