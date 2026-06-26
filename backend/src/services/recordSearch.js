const { all, get } = require('../db');
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
    // Relevance floor: a released/public-ready record surfaces only when it matches at least
    // two distinct query terms, OR matches a term in its title / record type. A single weak
    // body-text hit on a common word (e.g. a month like "January") is not enough - that
    // previously let unrelated records (a tax return matching only "january") appear at 60%.
    var primaryLower = (primary || '').toLowerCase();
    var titleHits = m.matched.filter(function(t){ return primaryLower.indexOf(t) !== -1; }).length;
    if (m.matched.length < 2 && titleHits < 1) return;
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
      matchScore: Math.min(100, (m.score || 0) + 15),
      matchedTerms: m.matched,
      relevanceNote: 'Matched your search terms: ' + m.matched.join(', '),
      publicReady: true,
      fileId: r.output_file_id
    });
  });
  out.sort(function(a, b){ return b.matchScore - a.matchScore; });
  return out.slice(0, 5);
}

// Map a query to the most likely taxonomy record type, so the search can narrow to that
// type's linked source system(s) - this prevents e.g. a payroll request drowning under HR
// documents that merely share words like "January"/"compensation". HYBRID router: a cheap
// keyword pass handles clear lexical matches; when it is weak or ambiguous (exactly when
// keyword routing misfires onto the wrong source) a small AI classifier arbitrates against
// the full taxonomy. AI step is toggle-gated (portal_search_ai_routing, default ON) and
// FAIL-OPEN: any error falls back to the keyword winner (old behavior), never breaks search.
function scoreTypesByKeyword(query, rts) {
  var qTokens = tokenize(query);
  if (!qTokens.length) return [];
  var qset = {}; qTokens.forEach(function(t){ qset[t] = 1; });
  return rts.map(function(rt){
    var terms = tokenize(rt.name).concat(flatTokens(rt.synonyms)).concat(flatTokens(rt.keywords));
    var seen = {}, hits = 0;
    terms.forEach(function(t){ if (qset[t] && !seen[t]) { seen[t] = 1; hits++; } });
    return { rt: rt, hits: hits };
  }).sort(function(a, b){ return b.hits - a.hits; });
}

async function aiClassifyType(query, rts) {
  var Anthropic = require('@anthropic-ai/sdk');
  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var catalog = rts.map(function(rt, i){
    var aka = flatTokens(rt.synonyms).slice(0, 6).join(', ');
    return (i + 1) + '. ' + rt.name + (aka ? ' (' + aka + ')' : '');
  }).join('\n');
  var prompt = 'A person is requesting a public record. Their request: "' + query + '"\n\n' +
    'Here is the catalog of record types this agency keeps:\n' + catalog + '\n\n' +
    'Which ONE record type best matches the kind of record the person is asking for? ' +
    'Judge by what the record actually IS, not just shared words. Reply with ONLY the item number. ' +
    'If no type clearly fits, reply 0.';
  var resp = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 10, messages: [{ role: 'user', content: prompt }] });
  var text = resp.content.map(function(b){ return b.type === 'text' ? b.text : ''; }).join('');
  var n = parseInt((text.match(/[0-9]+/) || ['0'])[0], 10);
  if (!n || n < 1 || n > rts.length) return null;
  return rts[n - 1];
}

async function matchRecordType(query) {
  var rts = await all("SELECT id, name, synonyms, keywords FROM record_types WHERE status = 'active'");
  if (!rts.length) return null;
  var scored = scoreTypesByKeyword(query, rts);
  var top = scored[0] || { hits: 0 };
  var second = scored[1] || { hits: 0 };
  var chosen = null;
  // Trust the keyword pass only when it is a strong, unambiguous winner.
  if (top.hits >= 3 && (top.hits - second.hits) >= 2) {
    chosen = top.rt;
  } else {
    var aiFlag = await get("SELECT value FROM system_config WHERE key = 'portal_search_ai_routing'");
    var aiOn = !aiFlag || aiFlag.value === '1' || aiFlag.value === 'true';
    if (aiOn) {
      try {
        chosen = await aiClassifyType(query, rts);
        if (chosen) console.log('[routing] AI -> "' + chosen.name + '" for: ' + query);
      } catch (e) { console.error('[routing] AI classify failed:', e && e.message); }
    }
    if (!chosen && top.hits >= 2) chosen = top.rt; // fall back to old keyword behavior
  }
  if (!chosen) return null;
  var links = await all('SELECT repository_id FROM record_type_repositories WHERE record_type_id = ?', [chosen.id]);
  return {
    recordTypeId: chosen.id,
    recordTypeName: chosen.name,
    sourceIds: links.map(function(l){ return l.repository_id; }),
    expandedTerms: flatTokens(chosen.synonyms).concat(flatTokens(chosen.keywords)).slice(0, 10).join(' ')
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

  // Query expansion: add the matched type's synonyms/keywords to improve recall.
  var effectiveQuery = (match && match.expandedTerms) ? (query + ' ' + match.expandedTerms) : query;

  // SOFT routing (robust to thin / partial / lazily-built taxonomies): we ALWAYS search every
  // active source - routing never EXCLUDES a source - so a mis-classified record type (or a
  // wanted type that simply was not created) can never hide the source where the real record
  // lives. Instead, results from the matched type's linked source(s) are PRIORITIZED in the
  // ranking below. Worst case (wrong route, or no route at all) degrades to a plain broad
  // search + the judge - never a silent hard miss. The payoff of a complete taxonomy is better
  // ranking; the cost of an incomplete one is only the loss of that ranking boost.
  var routedSet = {};
  if (match && match.sourceIds.length) match.sourceIds.forEach(function(id){ routedSet[id] = 1; });

  var searches = searchable.map(async function(repo) {
    var connector = connectors[repo.connector_type];
    if (!connector) return [];
    var config = {};
    try { config = repo.config ? JSON.parse(repo.config) : {}; } catch(e) {}
    try {
      var res = (repo.connector_type === 'demo' ? await connector.search(effectiveQuery) : await connector.search(effectiveQuery, config)) || [];
      if (routedSet[repo.id]) res.forEach(function(r){ r._routed = 1; });
      return res;
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
    if (bp !== ap) return bp - ap;                       // released/public-ready first (unchanged)
    var ar = a._routed ? 1 : 0, br = b._routed ? 1 : 0;
    if (br !== ar) return br - ar;                       // then results from the routed source (soft boost)
    return (b.matchScore || 0) - (a.matchScore || 0);
  });
  return deduped.slice(0, 10).map(function(r){ if (r._routed) { delete r._routed; } return r; });
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

// Post-search relevance JUDGE. Holds the original request intent, looks at the candidate
// results, and keeps only those that actually SATISFY the request (right kind of record /
// deliverable), ignoring match scores. Catches the "topically related but wrong thing"
// failure (a policy document returned for a video-footage request). FAIL-OPEN: on any error,
// disabled toggle, or empty input it returns the results unchanged, so it can only ever
// improve the result set, never break search. Conservative: drops only clearly-wrong kinds.
async function judgeResults(query, results) {
  if (!results || !results.length) return results || [];
  try {
    var flag = await get("SELECT value FROM system_config WHERE key = 'portal_search_judge'");
    var enabled = !flag || flag.value === '1' || flag.value === 'true'; // default ON
    if (!enabled) return results;
    var Anthropic = require('@anthropic-ai/sdk');
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var catalog = results.map(function(r, i){
      return (i + 1) + '. ' + (r.title || 'untitled') + ' | type: ' + (r.docType || 'unknown') + ' | ' + ((r.summary || '').slice(0, 160));
    }).join('\n');
    var prompt = 'A person asked for a specific public record. Their request: "' + query + '"\n\n' +
      'A search returned these candidate records:\n' + catalog + '\n\n' +
      'Keep ONLY the candidates that are actually the KIND and FORMAT of record the person asked for. Topical relatedness is NOT enough. Ignore all match/relevance scores.\n' +
      'KEY RULE: if the request asks for a particular kind or format - VIDEO / FOOTAGE / RECORDING, a PHOTOGRAPH, an AUDIO recording, or a specific named document - then a candidate that merely DISCUSSES, GOVERNS, or RELATES TO that subject does NOT satisfy it and must be dropped. Concretely: for a request for dash-cam or body-cam VIDEO FOOTAGE, an actual video/footage record qualifies, but a camera POLICY, a CONTRACT, a MANUAL, MEETING MINUTES, or a RESOLUTION do NOT qualify - drop every one of them, even though they mention cameras.\n' +
      'Conversely, if the person asked for a policy/report/document, that document qualifies and unrelated items do not.\n\n' +
      'Return ONLY a JSON array of the 1-based item numbers that are the right KIND of record. If none qualify, return [].';
    var resp = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 200, temperature: 0, messages: [{ role: 'user', content: prompt }] });
    var text = resp.content.map(function(b){ return b.type === 'text' ? b.text : ''; }).join('');
    var mm = text.match(/\[[\s\S]*?\]/);
    if (!mm) return results;
    var keep = JSON.parse(mm[0]);
    if (!Array.isArray(keep)) return results;
    var keepSet = {}; keep.forEach(function(n){ keepSet[parseInt(n, 10)] = 1; });
    var filtered = results.filter(function(r, i){ return keepSet[i + 1]; });
    if (filtered.length !== results.length) console.log('[searchJudge] kept ' + filtered.length + '/' + results.length + ' for query: ' + query);
    return filtered;
  } catch (e) { console.error('[searchJudge] failed, returning unfiltered:', e && e.message); return results; }
}

module.exports = { searchAll: searchAll, nativeSearchAll: nativeSearchAll, matchRecordType: matchRecordType, judgeResults: judgeResults };
