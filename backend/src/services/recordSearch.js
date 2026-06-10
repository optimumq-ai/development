const { all } = require('../db');
const demoConnector = require('./connectors/demo');
const tylerConnector = require('./connectors/tyler');
const axonConnector = require('./connectors/axon');

var connectors = {
  demo: demoConnector,
  tyler: tylerConnector,
  axon: axonConnector,
  laserfiche: require('./connectors/laserfiche')
};

var STOPWORDS = { the:1,a:1,an:1,of:1,for:1,to:1,and:1,or:1,in:1,on:1,my:1,me:1,all:1,any:1,copy:1,copies:1,record:1,request:1,please:1,need:1,want:1,would:1,like:1,from:1,with:1,about:1,that:1,this:1 };
function tokenize(s) {
  return (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(function(t){ return t.length > 2 && !STOPWORDS[t]; }).map(function(t){ return (t.length > 3 && t.charAt(t.length - 1) === 's') ? t.slice(0, -1) : t; });
}
function flatTokens(jsonArr) {
  var arr = []; try { arr = JSON.parse(jsonArr || '[]'); } catch(e) { arr = []; }
  var out = []; arr.forEach(function(s){ tokenize(s).forEach(function(t){ out.push(t); }); }); return out;
}

// Tier 1: already-released ("public-ready") records from the Fulfilled Request Index.
// Always runs first, never narrowed by taxonomy; results carry publicReady:true so they sort to top.
async function searchPublicReady(query) {
  var kw = require('./connectors/keyword');
  var terms = kw.tokenize(query);
  if (!terms.length) return [];
  var rows = await all("SELECT fr.*, rt.name AS record_type_name, d.name AS department_name FROM fulfilled_records fr LEFT JOIN record_types rt ON rt.id = fr.record_type_id LEFT JOIN departments d ON d.id = fr.department_id WHERE fr.status = 'released'");
  var out = [];
  rows.forEach(function(r){
    var primary = (r.title || '') + ' ' + (r.record_type_name || '');
    var secondary = (r.summary || '') + ' ' + (r.keywords || '');
    var m = kw.match(terms, primary, secondary);
    if (!m) return;
    out.push({
      id: 'fulfilled:' + r.id,
      sourceSystem: 'Fulfilled Request Index',
      title: r.title,
      summary: (r.summary || '').slice(0, 200),
      department: r.department_name || '',
      docType: r.record_type_name || 'Released record',
      dateCreated: (r.released_at || '').slice(0, 10),
      pageCount: r.page_count || null,
      publicAvailability: 'available',
      matchScore: (m.score || 0) + 50,
      matchedTerms: m.matched,
      publicReady: true,
      fileId: r.output_file_id
    });
  });
  out.sort(function(a, b){ return b.matchScore - a.matchScore; });
  return out.slice(0, 5);
}

// Lightweight (no extra AI call) match of a query to a taxonomy record type by
// term overlap with the type's name + synonyms + keywords. Conservative: needs
// >= 2 distinct term hits, else returns null (caller searches broadly).
async function matchRecordType(query) {
  var qTokens = tokenize(query);
  if (!qTokens.length) return null;
  var qset = {}; qTokens.forEach(function(t){ qset[t] = 1; });
  var rts = await all("SELECT id, name, synonyms, keywords FROM record_types WHERE status = 'active'");
  var best = null;
  rts.forEach(function(rt){
    var terms = tokenize(rt.name).concat(flatTokens(rt.synonyms)).concat(flatTokens(rt.keywords));
    var seen = {}, hits = 0;
    terms.forEach(function(t){ if (qset[t] && !seen[t]) { seen[t] = 1; hits++; } });
    if (!best || hits > best.hits) best = { rt: rt, hits: hits };
  });
  if (!best || best.hits < 2) return null;
  var links = await all('SELECT repository_id FROM record_type_repositories WHERE record_type_id = ?', [best.rt.id]);
  return {
    recordTypeId: best.rt.id,
    recordTypeName: best.rt.name,
    hits: best.hits,
    sourceIds: links.map(function(l){ return l.repository_id; }),
    expandedTerms: flatTokens(best.rt.synonyms).concat(flatTokens(best.rt.keywords)).slice(0, 10).join(' ')
  };
}

async function searchAll(query) {
  var results = [];

  // Tier 1 - public-ready records: always searched, never narrowed.
  try { results = results.concat(await searchPublicReady(query) || []); } catch(e) {}

  // Tier 2 - taxonomy-aware live-system search.
  var repos = await all("SELECT id, name, connector_type, config FROM record_repositories WHERE status = 'active' ORDER BY sort_order");
  var searchable = repos.filter(function(r){ return !!connectors[r.connector_type]; });

  var match = null;
  try { match = await matchRecordType(query); } catch(e) {}

  // Narrow to the matched type's linked sources ONLY when that yields a non-empty
  // searchable set; otherwise fall back to searching everything (broad fallback).
  var targetRepos = searchable;
  if (match && match.sourceIds.length) {
    var narrowed = searchable.filter(function(r){ return match.sourceIds.indexOf(r.id) >= 0; });
    if (narrowed.length) targetRepos = narrowed;
  }
  // Query expansion: add the matched type's synonyms/keywords to improve recall.
  var effectiveQuery = (match && match.expandedTerms) ? (query + ' ' + match.expandedTerms) : query;

  var searches = targetRepos.map(async function(repo) {
    var connector = connectors[repo.connector_type];
    if (!connector) return [];
    var config = {};
    try { config = repo.config ? JSON.parse(repo.config) : {}; } catch(e) {}
    try {
      return (repo.connector_type === 'demo' ? await connector.search(effectiveQuery) : await connector.search(effectiveQuery, config)) || [];
    } catch(e) {
      console.error('[recordSearch] connector', repo.connector_type, 'failed:', e.message);
      return [];
    }
  });
  var sets = await Promise.all(searches);
  sets.forEach(function(s){ results = results.concat(s); });

  // Dedupe by id; public-ready first, then match score.
  var seen = {}, deduped = [];
  results.forEach(function(r){ var k = r.id || (r.sourceSystem + '|' + r.title); if (!seen[k]) { seen[k] = 1; deduped.push(r); } });
  deduped.sort(function(a, b) {
    var ap = a.publicReady ? 1 : 0, bp = b.publicReady ? 1 : 0;
    if (bp !== ap) return bp - ap;
    return (b.matchScore || 0) - (a.matchScore || 0);
  });
  return deduped.slice(0, 10);
}

async function nativeSearchAll(query, sourceId) {
  var map = {
    demo: demoConnector,
    tyler: tylerConnector,
    axon: axonConnector,
    filestore: require('./connectors/filestore'),
    'paper-index': require('./connectors/paperindex'),
    laserfiche: require('./connectors/laserfiche')
  };
  var repos = await all("SELECT id, name, connector_type, config FROM record_repositories WHERE status = 'active' ORDER BY sort_order");
  if (sourceId) repos = repos.filter(function(r){ return r.id === sourceId; });
  var groups = await Promise.all(repos.map(async function(repo) {
    var c = map[repo.connector_type];
    if (!c || typeof c.nativeSearch !== 'function') return null;
    var config = {};
    try { config = repo.config ? JSON.parse(repo.config) : {}; } catch(e) {}
    config.__repoId = repo.id;
    var results = [];
    try {
      results = repo.connector_type === 'demo'
        ? await c.nativeSearch(query)
        : await c.nativeSearch(query, config);
    } catch(e) {
      console.error('[nativeSearch]', repo.connector_type, 'failed:', e.message);
      results = [];
    }
    return { sourceId: repo.id, sourceName: repo.name, connectorType: repo.connector_type, results: (results || []).filter(function(r){ return r.matchScore >= 30; }) };
  }));
  return groups.filter(function(g) { return g && g.results.length > 0; });
}

module.exports = { searchAll: searchAll, nativeSearchAll: nativeSearchAll, matchRecordType: matchRecordType };
