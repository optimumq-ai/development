var { all, get, run } = require('../db');
var { v4: uuidv4 } = require('uuid');
var embedIndex = require('./embedIndex');
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
  var message = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 3500, messages: [{ role: 'user', content: prompt }] });
  var raw = require('./aiText').textOf(message).replace(/```json|```/g, '').trim();
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
  embedIndex.bg(embedIndex.reindexRecordTypes(created.map(function(c){ return c.id; })), 'discover-scan');
  return { created: created, matched: matched, linked: linked, scanned: samples.length };
}

// ============================================================================================
// VARIANT GROUPINGS (#14 slice 2 — Kevin's counting concept, design approved 2026-08-13, mockup 3).
//
// Scan a BUCKET type's real holdings across its linked sources, and have the AI propose variant
// GROUPINGS with document counts — the big consistent-layout piles get flagged as mass-redaction
// candidates. Two halves, deliberately split:
//   discoverVariantGroupings — read-only: samples + AI proposal. INSERTS NOTHING; the result is
//     shown to a human. Counts are honest: share-of-sample × the source's REAL total when the
//     connector can count (filestore can), else the sample count labeled as such.
//   applyGroupingProposal — inserts ONE approved proposal as a DRAFT variant under the bucket
//     (status='draft', source='discovered', parent + category aligned). Drafts don't classify;
//     activation stays the human act it already is. Pure data-shaping, testable without a model.
// ============================================================================================
// v2 (Kevin's fingerprint design, 2026-08-14): for sources whose connector exposes real files
// (filestore), discovery is now a DETERMINISTIC CENSUS — every document is fingerprinted once
// (persistent, hash-keyed, services/docFingerprint), documents matching an already-approved
// variant's stored signature are RECOGNIZED rather than re-proposed (the cross-location case:
// same template, new drive), and only the unrecognized remainder is clustered by 8-of-10 feature
// match. Counts are EXACT cluster sizes, not extrapolations, and no alphabetical-sampling skew
// exists because there is no sample. The AI's only job left is naming clusters it is handed —
// a few small excerpts per cluster, no 14k-char digest ceiling. Sources without file access
// (laserfiche, etc.) keep the legacy sample-digest flow below.
async function discoverVariantGroupings(bucketId) {
  var bucket = await get('SELECT * FROM record_types WHERE id = ?', [bucketId]);
  if (!bucket) return { error: 'Record type not found' };
  if (bucket.parent_record_type_id) return { error: 'That type is itself a variant — run discovery on its parent bucket instead' };
  var repos = await all(
    "SELECT rp.* FROM record_type_repositories rr JOIN record_repositories rp ON rp.id = rr.repository_id " +
    "WHERE rr.record_type_id = ? AND rp.status = 'active'", [bucketId]);

  // Prefer the fingerprint census wherever a connector exposes real files.
  var fileRepos = repos.filter(function (r) { var c = connectors[r.connector_type]; return c && c.listFiles; });
  if (fileRepos.length) {
    var out = await discoverViaFingerprints(bucket, fileRepos);
    if (!out.error || out.hadFiles) return out;
    // No files found on the file-capable repos — fall through to the legacy sample path.
  }
  return await discoverViaSampleDigest(bucket, repos);
}

// The deterministic half of v2 — census + recognition + clustering. Everything except cluster
// NAMING happens here, model-free.
async function fingerprintCensus(bucket, fileRepos) {
  var docFingerprint = require('./docFingerprint');
  var fs = require('fs');
  var crypto = require('crypto');
  var rows = [], totalFiles = 0, unreadable = 0, scannedRepos = [];
  for (var r = 0; r < fileRepos.length; r++) {
    var repo = fileRepos[r];
    var config = {};
    try { config = repo.config ? JSON.parse(repo.config) : {}; } catch (e) {}
    var files = connectors[repo.connector_type].listFiles(config) || [];
    totalFiles += files.length;
    scannedRepos.push(repo.name);
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var sha = null;
      try { sha = crypto.createHash('sha256').update(fs.readFileSync(f.fullPath)).digest('hex'); } catch (e) { unreadable++; continue; }
      var existing = await get('SELECT * FROM document_fingerprints WHERE repository_id = ? AND filename = ?', [repo.id, f.filename]);
      if (existing && existing.content_sha256 === sha) {
        var feat = null; try { feat = JSON.parse(existing.features); } catch (e) {}
        if (feat) { rows.push({ id: existing.id, repoId: repo.id, repoName: repo.name, filename: f.filename, fullPath: f.fullPath, features: feat, matched: existing.matched_record_type_id }); continue; }
      }
      var features = docFingerprint.extractFeatures(f.fullPath);
      if (!features) { unreadable++; continue; } // image-only / unreadable — future OCR path
      var id = existing ? existing.id : nid('fp');
      if (existing) {
        await run('UPDATE document_fingerprints SET content_sha256 = ?, page_count = ?, features = ?, matched_record_type_id = NULL WHERE id = ?', [sha, features.pageCount, JSON.stringify(features), id]);
      } else {
        await run('INSERT INTO document_fingerprints (id, repository_id, filename, content_sha256, page_count, features) VALUES (?,?,?,?,?,?)', [id, repo.id, f.filename, sha, features.pageCount, JSON.stringify(features)]);
      }
      rows.push({ id: id, repoId: repo.id, repoName: repo.name, filename: f.filename, fullPath: f.fullPath, features: features, matched: null });
    }
  }
  return { rows: rows, totalFiles: totalFiles, unreadable: unreadable, scannedRepos: scannedRepos };
}

// Recognition-before-discovery: match fingerprints against the stored signatures of the bucket's
// approved variants. Recognized documents are counted under the KNOWN variant — never re-proposed
// under an AI-chosen near-duplicate name — and stamped so the index remembers.
async function recognizeAgainstSignatures(bucket, rows) {
  var docFingerprint = require('./docFingerprint');
  var variants = await all("SELECT id, name, discovery_meta FROM record_types WHERE parent_record_type_id = ?", [bucket.id]);
  var sigs = [];
  variants.forEach(function (v) {
    try { var m = JSON.parse(v.discovery_meta || '{}'); if (m.signature) sigs.push({ id: v.id, name: v.name, signature: m.signature }); } catch (e) {}
  });
  var recognized = {}; // variantId -> { count, files }
  var unrecognized = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var hit = row.matched && sigs.find(function (s) { return s.id === row.matched; })
      ? sigs.find(function (s) { return s.id === row.matched; })
      : sigs.find(function (s) { return docFingerprint.matchesSignature(row.features, s.signature); });
    if (hit) {
      if (!recognized[hit.id]) recognized[hit.id] = { record_type_id: hit.id, name: hit.name, count: 0, example_files: [] };
      recognized[hit.id].count++;
      if (recognized[hit.id].example_files.length < 3) recognized[hit.id].example_files.push(row.filename);
      if (row.matched !== hit.id) await run('UPDATE document_fingerprints SET matched_record_type_id = ? WHERE id = ?', [hit.id, row.id]);
    } else {
      unrecognized.push(row);
    }
  }
  var recList = [];
  for (var vid in recognized) {
    var tpl = await get("SELECT 1 AS ok FROM layout_profiles WHERE record_type_id = ? AND status != 'deleted' LIMIT 1", [vid]);
    recognized[vid].template_ready = !!tpl;
    recList.push(recognized[vid]);
  }
  recList.sort(function (a, b) { return b.count - a.count; });
  return { recognized: recList, unrecognized: unrecognized };
}

async function discoverViaFingerprints(bucket, fileRepos) {
  var docFingerprint = require('./docFingerprint');
  var execFileSync = require('child_process').execFileSync;
  var census = await fingerprintCensus(bucket, fileRepos);
  if (!census.rows.length) return { error: 'No scannable documents found in the sources linked to this type', repos: census.scannedRepos, hadFiles: census.totalFiles > 0 };

  var rec = await recognizeAgainstSignatures(bucket, census.rows);
  var clusters = docFingerprint.cluster(rec.unrecognized)
    .map(function (idxs) { return idxs.map(function (i) { return rec.unrecognized[i]; }); })
    .filter(function (members) { return members.length >= 3; })
    .sort(function (a, b) { return b.length - a.length; });
  var clustered = clusters.reduce(function (n, c) { return n + c.length; }, 0);
  var ungroupedCount = rec.unrecognized.length - clustered;

  var groupings = [];
  if (clusters.length) {
    // AI names the clusters it is HANDED — a couple of small excerpts each, honest counts attached
    // by code afterward. The model discovers nothing and counts nothing.
    var existingVariants = await all('SELECT name FROM record_types WHERE parent_record_type_id = ?', [bucket.id]);
    var clusterDigest = clusters.map(function (members, ci) {
      var reps = members.slice(0, 2).map(function (m) {
        var text = '';
        try { text = execFileSync('pdftotext', ['-f', '1', '-l', '1', m.fullPath, '-'], { encoding: 'utf8', timeout: 15000 }); } catch (e) {}
        return '--- example (' + m.filename + ') ---\n' + (text || '').trim().substring(0, 1100);
      }).join('\n');
      var labels = (docFingerprint.signature(members.map(function (m) { return m.features; })).labels || []).join(', ');
      return '=== CLUSTER ' + ci + ' — ' + members.length + ' documents sharing one layout ===\nForm field labels: ' + (labels || '(none)') + '\n' + reps;
    }).join('\n\n');
    var prompt = 'You are a records-management taxonomy expert. The agency record type "' + bucket.name + '"'
      + (bucket.intent ? ' (' + bucket.intent + ')' : '') + ' contains distinct sub-kinds.\n'
      + 'Deterministic layout analysis has ALREADY grouped the documents into clusters — your only job is to NAME '
      + 'and describe each cluster from its example documents. Do not merge, split, or re-count clusters.\n'
      + 'Return ONLY a JSON array with EXACTLY one element per cluster, in cluster order.\n\n'
      + 'Rules:\n'
      + (existingVariants.length ? '- These variants already exist — do not reuse their names: ' + existingVariants.map(function (v) { return v.name; }).join('; ') + '\n' : '')
      + '- code: short kebab-case.\n\n'
      + 'Element shape:\n'
      + '{"cluster": 0, "name": "", "code": "", "intent": "", "expected_content": "", "synonyms": [], "keywords": [], "identifying_facets": [], "confidence": 0, "reasoning": ""}\n\n'
      + 'CLUSTERS:\n' + clusterDigest;
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var message = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] });
    var raw = require('./aiText').textOf(message).replace(/```json|```/g, '').trim();
    var names = [];
    try { names = JSON.parse(raw); } catch (e) { return { error: 'The AI response could not be read — try the scan again (the fingerprint index is saved, so a retry is fast)' }; }
    if (!Array.isArray(names)) names = [];
    groupings = clusters.map(function (members, ci) {
      var named = names.find(function (n) { return Number(n.cluster) === ci; }) || {};
      var feats = members.map(function (m) { return m.features; });
      var layout = docFingerprint.layoutConsistency(feats);
      return {
        name: named.name || ('Layout grouping ' + (ci + 1)),
        code: named.code || ('grouping-' + (ci + 1)),
        intent: named.intent || null, expected_content: named.expected_content || null,
        synonyms: named.synonyms || [], keywords: named.keywords || [],
        identifying_facets: named.identifying_facets || [], formats: ['document'],
        confidence: typeof named.confidence === 'number' ? named.confidence : null,
        reasoning: named.reasoning || null,
        counted: true,
        estimated_count: members.length,
        sample_share: census.rows.length ? +(members.length / census.rows.length).toFixed(4) : 0,
        layout: layout,
        mass_redaction_candidate: layout === 'uniform' || layout === 'few_layouts',
        example_files: members.slice(0, 5).map(function (m) { return m.filename; }),
        fingerprint_ids: members.map(function (m) { return m.id; }),
        signature: docFingerprint.signature(feats)
      };
    });
  }

  return {
    bucket: { id: bucket.id, name: bucket.name },
    method: 'fingerprint',
    repos: census.scannedRepos,
    sampled: census.rows.length,                      // documents actually fingerprinted (census, not a sample)
    totalDocuments: census.totalFiles,                // exact
    unreadable: census.unreadable,                    // image-only/broken files, honestly excluded
    recognized: rec.recognized,
    ungroupedShare: census.rows.length ? Math.round((ungroupedCount / census.rows.length) * 100) / 100 : 0,
    groupings: groupings
  };
}

// Legacy sample-digest flow — kept verbatim for connectors that cannot expose files.
async function discoverViaSampleDigest(bucket, repos) {
  var samples = [], totalDocs = 0, totalKnown = false, scannedRepos = [];
  repos.forEach(function (repo) {
    var connector = connectors[repo.connector_type];
    if (!connector || !connector.scan) return;
    var config = {};
    try { config = repo.config ? JSON.parse(repo.config) : {}; } catch (e) {}
    var s = connector.scan(config) || [];
    s.forEach(function (x) { samples.push({ filename: x.filename, text: x.text, source: repo.name }); });
    if (connector.countAll) { totalDocs += connector.countAll(config); totalKnown = true; }
    scannedRepos.push(repo.name);
  });
  if (!samples.length) return { error: 'No scannable documents found in the sources linked to this type', repos: scannedRepos };

  var existingVariants = await all('SELECT name, code FROM record_types WHERE parent_record_type_id = ?', [bucket.id]);
  var digest = samples.map(function (s) { return '=== FILE: ' + s.filename + ' (' + s.source + ') ===\n' + s.text; }).join('\n\n').substring(0, 14000);
  var prompt = 'You are a records-management taxonomy expert. The agency catalog has a record type "' + bucket.name + '"'
    + (bucket.intent ? ' (' + bucket.intent + ')' : '') + ' that may really be a family of distinct sub-kinds.\n'
    + 'Below are sample documents of this type from the agency\'s own holdings. Group them into the DISTINCT sub-kinds you can '
    + 'see evidence for, and return ONLY a JSON array, one element per grouping.\n\n'
    + 'Rules:\n'
    + '- Only propose a grouping the samples actually support; leave unclear documents ungrouped.\n'
    + (existingVariants.length ? '- These variants already exist — do not re-propose them: ' + existingVariants.map(function (v) { return v.name; }).join('; ') + '\n' : '')
    + '- sample_share: the fraction (0-1) of the samples that belong to this grouping.\n'
    + '- layout: "uniform" when the documents share one consistent layout, "few_layouts" when a small number of layouts cover nearly all, "varied" otherwise.\n'
    + '- mass_redaction_candidate: true only for uniform or few_layouts groupings — the kind where one redaction template fits the pile.\n'
    + '- code: short kebab-case.\n\n'
    + 'Element shape:\n'
    + '{"name": "", "code": "", "intent": "", "expected_content": "", "synonyms": [], "keywords": [], "identifying_facets": [], "formats": ["document"], "confidence": 0, "sample_share": 0, "layout": "varied", "mass_redaction_candidate": false, "example_files": [], "reasoning": ""}\n\n'
    + 'SAMPLE DOCUMENTS:\n' + digest;
  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var message = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] });
  var raw = require('./aiText').textOf(message).replace(/```json|```/g, '').trim();
  var groupings = [];
  try { groupings = JSON.parse(raw); } catch (e) { return { error: 'The AI response could not be read — try the scan again' }; }
  if (!Array.isArray(groupings)) groupings = [];
  var groupedShare = 0;
  groupings.forEach(function (g) {
    var share = Math.max(0, Math.min(1, Number(g.sample_share) || 0));
    groupedShare += share;
    g.sample_share = share;
    g.estimated_count = totalKnown ? Math.round(share * totalDocs) : null;
    g.mass_redaction_candidate = !!g.mass_redaction_candidate && (g.layout === 'uniform' || g.layout === 'few_layouts');
  });
  return {
    bucket: { id: bucket.id, name: bucket.name },
    repos: scannedRepos, sampled: samples.length,
    totalDocuments: totalKnown ? totalDocs : null,
    ungroupedShare: Math.max(0, Math.round((1 - groupedShare) * 100)) / 100,
    groupings: groupings
  };
}

async function applyGroupingProposal(bucketId, p) {
  var bucket = await get('SELECT * FROM record_types WHERE id = ?', [bucketId]);
  if (!bucket) throw new Error('Record type not found');
  if (bucket.parent_record_type_id) throw new Error('That type is itself a variant — variants go one level deep');
  if (!p || !(p.name || '').trim()) throw new Error('A proposal needs a name');
  var code = (p.code || p.name).toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 48) || 'variant';
  var dup = await get('SELECT id FROM record_types WHERE code = ?', [code]);
  if (dup) code = code + '-' + uuidv4().substring(0, 4);
  var id = nid('rt');
  // Provenance lives in the description — visible, editable, honest about being an estimate.
  var provenance = 'Proposed by auto-discovery' +
    (p.estimated_count != null ? ' — about ' + p.estimated_count + ' documents in the holdings' : (p.sample_share ? ' — ' + Math.round(p.sample_share * 100) + '% of the scanned sample' : '')) +
    (p.mass_redaction_candidate ? '. Consistent layout — a mass-redaction candidate.' : '.');
  // The flag also lands machine-readable: the Mass Redaction page lists this variant as "waiting
  // for a template" until an active template names it. discovery_meta is the card's evidence.
  var massCand = p.mass_redaction_candidate ? 1 : 0;
  // The cluster's consensus signature (fingerprint discovery) is stored regardless of the mass
  // flag: it is what lets FUTURE scans — including scans of other locations — RECOGNIZE this
  // variant's documents instead of re-proposing them under a near-duplicate name.
  var meta = (massCand || p.signature) ? JSON.stringify({
    estimated_count: p.estimated_count != null ? p.estimated_count : null,
    sample_share: p.sample_share || null,
    layout: p.layout || null,
    counted: !!p.counted,
    example_files: Array.isArray(p.example_files) ? p.example_files.slice(0, 5) : [],
    repos: Array.isArray(p.repos) ? p.repos.slice(0, 5) : [],
    found_at: new Date().toISOString().slice(0, 10),
    signature: p.signature || null
  }) : null;
  var cols = 'id, category_id, parent_record_type_id, name, code, description, intent, expected_content, synonyms, keywords, identifying_facets, formats, public_availability, status, source, confidence, sort_order, mass_redaction_candidate, discovery_meta';
  var ph = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';
  await run('INSERT INTO record_types (' + cols + ') VALUES (' + ph + ')', [
    id, bucket.category_id, bucket.id, (p.name || '').toString().substring(0, 200), code, provenance,
    p.intent || null, p.expected_content || null, packArray(p.synonyms), packArray(p.keywords),
    packArray(p.identifying_facets), packArray(p.formats && p.formats.length ? p.formats : ['document']),
    bucket.public_availability || 'review_required', 'draft', 'discovered',
    (typeof p.confidence === 'number' ? p.confidence : null), 900, massCand, meta]);
  // Stamp the cluster's documents in the fingerprint index: they now BELONG to this variant, so
  // the next scan reports them as recognized instead of re-clustering them.
  if (Array.isArray(p.fingerprint_ids) && p.fingerprint_ids.length) {
    var fph = p.fingerprint_ids.map(function () { return '?'; }).join(',');
    await run('UPDATE document_fingerprints SET matched_record_type_id = ? WHERE id IN (' + fph + ')', [id].concat(p.fingerprint_ids));
  }
  embedIndex.bg(embedIndex.reindexRecordTypes([id]), 'discover-variant');
  return await get('SELECT * FROM record_types WHERE id = ?', [id]);
}

module.exports = {
  scanRepository: scanRepository, discoverVariantGroupings: discoverVariantGroupings,
  applyGroupingProposal: applyGroupingProposal,
  // model-free internals of the fingerprint path, exported so the suite can verify the census,
  // persistence, and recognition without a model call (same principle as applyGroupingProposal)
  fingerprintCensus: fingerprintCensus, recognizeAgainstSignatures: recognizeAgainstSignatures
};
