var { all, get, run } = require('../db');
var { v4: uuidv4 } = require('uuid');
var Anthropic = require('@anthropic-ai/sdk');
var connectors = { filestore: require('./connectors/filestore'), structured: require('./connectors/structured') };

function nid(p){ return p + '-' + uuidv4().substring(0, 8); }
function packArray(a){ return Array.isArray(a) ? JSON.stringify(a) : '[]'; }

async function linkRepo(recordTypeId, repositoryId, formats) {
  var dup = await get('SELECT id FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?', [recordTypeId, repositoryId]);
  if (dup) return false;
  var fmt = (Array.isArray(formats) && formats.length) ? formats[0] : null;
  await run('INSERT INTO record_type_repositories (id, record_type_id, repository_id, format, filter_spec, sort_order) VALUES (?,?,?,?,?,?)', [nid('rr'), recordTypeId, repositoryId, fmt, '{}', 100]);
  return true;
}

async function scanRepository(repo) {
  var connector = connectors[repo.connector_type];
  if (!connector || !connector.scan) return { error: 'Connector ' + repo.connector_type + ' does not support scanning' };
  var config = {};
  try { config = repo.config ? JSON.parse(repo.config) : {}; } catch (e) {}
  var samples = connector.scan(config);
  if (!samples.length) return { created: [], matched: [], scanned: 0 };
  var cats = await all('SELECT id, name FROM categories WHERE active = 1 ORDER BY sort_order');
  var existing = await all('SELECT code, name FROM record_types ORDER BY name');
  var catList = cats.map(function(c){ return c.id + ' = ' + c.name; }).join('\n');
  var existingList = existing.map(function(r){ return r.code + ' (' + r.name + ')'; }).join('; ');
  var digest = samples.map(function(s){ return '=== FILE: ' + s.filename + ' ===\n' + s.text; }).join('\n\n').substring(0, 14000);
  var prompt = 'You are a records-management taxonomy expert for a local government public-records system. '
    + 'Below are sample documents pulled from a records repository. Identify the DISTINCT record types present across the samples, and for EACH distinct type propose ONE catalog entry for the agency taxonomy. '
    + 'Return ONLY a JSON array, no other text.\n\n'
    + 'Choose category_id from EXACTLY one of these:\n' + catList + '\n\n'
    + 'Existing record types (if a discovered type clearly matches one, set matches_existing true and matched_code to its code):\n' + existingList + '\n\n';
  prompt += 'Rules:\n'
    + '- One array element per DISTINCT record type. Do NOT emit one element per file; group files of the same kind together.\n'
    + '- public_availability one of: releasable, review_required, restricted, confidential. Be conservative; default review_required.\n'
    + '- auto_release_eligible is 1 ONLY if every plausible exemption is detectable from the document content itself. Else 0.\n'
    + '- code: short kebab-case, unique, not in the existing list.\n'
    + '- formats: array drawn from document, video, audio, structured_data.\n'
    + '- example_files: array of sample filenames that exemplify this type.\n\n';
  prompt += 'Each array element shape:\n'
    + '{"matches_existing": false, "matched_code": null, "name": "", "code": "", "category_id": "", "intent": "", "expected_content": "", "typical_request_reason": "", "synonyms": [], "disambiguators": [], "keywords": [], "identifying_facets": [], "formats": [], "public_availability": "review_required", "auto_release_eligible": 0, "confidence": 0, "example_files": [], "reasoning": ""}\n\n'
    + 'SAMPLE DOCUMENTS:\n' + digest;
  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var message = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 3500, messages: [{ role: 'user', content: prompt }] });
  var raw = message.content[0].text.trim().replace(/```json|```/g, '').trim();
  var proposals = JSON.parse(raw);
  if (!Array.isArray(proposals)) proposals = [];
  var created = [], matched = [], linked = 0;
  for (var i = 0; i < proposals.length; i++) {
    var p = proposals[i];
    if (p.matches_existing && p.matched_code && existing.find(function(r){ return r.code === p.matched_code; })) {
      var exRow = await get('SELECT id FROM record_types WHERE code = ?', [p.matched_code]);
      if (exRow && await linkRepo(exRow.id, repo.id, p.formats)) linked++;
      matched.push({ name: p.name, matched_code: p.matched_code });
      continue;
    }
    if (!p.category_id || !cats.find(function(c){ return c.id === p.category_id; })) { p.category_id = cats.length ? cats[cats.length - 1].id : null; }
    var code = (p.code || 'discovered-type').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 48) || 'discovered-type';
    var dup = await get('SELECT id FROM record_types WHERE code = ?', [code]);
    if (dup) code = code + '-' + uuidv4().substring(0, 4);
    var id = nid('rt');
    var av = ['releasable','review_required','restricted','confidential'].indexOf(p.public_availability) >= 0 ? p.public_availability : 'review_required';
    var cols = 'id, category_id, name, code, intent, expected_content, typical_request_reason, synonyms, disambiguators, keywords, identifying_facets, formats, is_structured_data, public_availability, auto_release_eligible, status, source, confidence, sort_order';
    var ph = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';
    await run('INSERT INTO record_types (' + cols + ') VALUES (' + ph + ')', [ id, p.category_id, (p.name || 'Discovered type').toString().substring(0, 200), code, p.intent || null, p.expected_content || null, p.typical_request_reason || null, packArray(p.synonyms), packArray(p.disambiguators), packArray(p.keywords), packArray(p.identifying_facets), packArray(p.formats), (p.formats && p.formats.indexOf('structured_data') >= 0) ? 1 : 0, av, p.auto_release_eligible ? 1 : 0, 'draft', 'discovered', (typeof p.confidence === 'number' ? p.confidence : null), 900 ]);
    if (await linkRepo(id, repo.id, p.formats)) linked++;
    created.push({ id: id, name: p.name, code: code, confidence: p.confidence, example_files: p.example_files || [] });
  }
  return { created: created, matched: matched, linked: linked, scanned: samples.length };
}

module.exports = { scanRepository: scanRepository };
