var { all, get, run } = require('../db');
var { v4: uuidv4 } = require('uuid');
var embedIndex = require('./embedIndex');
var Anthropic = require('@anthropic-ai/sdk');
var connectors = { filestore: require('./connectors/filestore') };   // structured's scan() retired with Scan source; its census is slice 5

function nid(p){ return p + '-' + uuidv4().substring(0, 8); }
function packArray(a){ return Array.isArray(a) ? JSON.stringify(a) : '[]'; }

async function linkRepo(recordTypeId, repositoryId, formats) {
  var dup = await get('SELECT id FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?', [recordTypeId, repositoryId]);
  if (dup) return false;
  var fmt = (Array.isArray(formats) && formats.length) ? formats[0] : null;
  await run('INSERT INTO record_type_repositories (id, record_type_id, repository_id, format, filter_spec, sort_order) VALUES (?,?,?,?,?,?)', [nid('rr'), recordTypeId, repositoryId, fmt, '{}', 100]);
  return true;
}

// scanRepository (the 'Scan source' page's sample digest) RETIRED 2026-09-15 — flow-map decision 2: the census reads every
// file and association is a human approval; a nine-file alphabetical sample had no remaining job.

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
// v3 (2026-09-15, inventory build slice 4 — flow-map decisions 1–3): "Find variants" no longer scans anything. It READS
// THE CENSUS STORE of the bucket's linked sources: groupings already associated to this bucket or its variants are the
// "recognized" list (exact counts), the unassociated groupings are handed to the AI for NAMING only, and approval goes
// through applyGroupingProposal as before (which now also marks the census grouping associated). A source that has
// never been censused is named, not silently skipped — the census is started from Record Sources › Inventory.
async function discoverVariantGroupings(bucketId) {
  var bucket = await get('SELECT * FROM record_types WHERE id = ?', [bucketId]);
  if (!bucket) return { error: 'Record type not found' };
  if (bucket.parent_record_type_id) return { error: 'That type is itself a variant — run discovery on its parent bucket instead' };
  var repos = await all(
    "SELECT rp.* FROM record_type_repositories rr JOIN record_repositories rp ON rp.id = rr.repository_id " +
    "WHERE rr.record_type_id = ? AND rp.status = 'active'", [bucketId]);
  if (!repos.length) return { error: 'No censused documents: this type is linked to no source yet. Link a source, run its census from Record Sources › Inventory, then come back.' };
  var censused = [], notCensused = [], latest = null;
  for (var i = 0; i < repos.length; i++) {
    var last = await get("SELECT finished_at FROM source_census_runs WHERE repository_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1", [repos[i].id]);
    if (last) { censused.push(repos[i]); if (!latest || last.finished_at > latest) latest = last.finished_at; } else notCensused.push(repos[i].name);
  }
  if (!censused.length) return { error: 'No censused documents: none of the sources linked to this type has had a census yet (' + notCensused.join(', ') + '). Run one from Record Sources › Inventory first.' };
  var repoIds = censused.map(function (r) { return r.id; });
  var ph = repoIds.map(function () { return '?'; }).join(',');
  var repoById = {}; censused.forEach(function (r) { repoById[r.id] = r; });
  var variants = await all('SELECT id, name FROM record_types WHERE parent_record_type_id = ?', [bucketId]);
  var mine = {}; mine[bucketId] = bucket.name; variants.forEach(function (v) { mine[v.id] = v.name; });
  var groupRows = await all('SELECT * FROM census_groupings WHERE repository_id IN (' + ph + ') ORDER BY member_count DESC, ordinal', repoIds);
  var totals = await get("SELECT count(*)::int AS files, sum(CASE WHEN kind = 'doc' THEN 1 ELSE 0 END)::int AS docs, sum(CASE WHEN kind = 'unreadable' THEN 1 ELSE 0 END)::int AS unreadable FROM document_fingerprints WHERE repository_id IN (" + ph + ')', repoIds);

  // Recognized: groupings already associated to this bucket or one of its variants — exact counts, template status.
  var recognized = {}, unassoc = [];
  for (var g = 0; g < groupRows.length; g++) {
    var row = groupRows[g];
    if (row.record_type_id && mine[row.record_type_id]) {
      var r = recognized[row.record_type_id] = recognized[row.record_type_id] || { record_type_id: row.record_type_id, name: mine[row.record_type_id], count: 0, example_files: [], example_sources: [] };
      r.count += row.member_count || 0;
      var exIds = []; try { exIds = JSON.parse(row.example_ids || '[]'); } catch (e) {}
      if (exIds.length && r.example_files.length < 3) {
        var exs = await all('SELECT filename, repository_id FROM document_fingerprints WHERE id IN (' + exIds.map(function () { return '?'; }).join(',') + ') LIMIT 3', exIds);
        exs.forEach(function (x) { if (r.example_files.length < 3) { r.example_files.push(x.filename); r.example_sources.push({ filename: x.filename, repository_id: x.repository_id }); } });
      }
    } else if (!row.record_type_id) unassoc.push(row);
    // groupings associated to some OTHER type are that type's business — not shown here
  }
  var recList = [];
  for (var vid in recognized) {
    var tpl = await get("SELECT 1 AS ok FROM layout_profiles WHERE record_type_id = ? AND status != 'deleted' LIMIT 1", [vid]);
    recognized[vid].template_ready = !!tpl; recList.push(recognized[vid]);
  }
  recList.sort(function (a, b) { return b.count - a.count; });

  // Unassociated groupings: the AI NAMES them (one call, all groupings) — counts, layout and membership are the census's.
  var groupings = [];
  if (unassoc.length) {
    var docFingerprint = require('./docFingerprint');
    var execFileSync = require('child_process').execFileSync;
    var pathMod = require('path'), fsMod = require('fs');
    var memberSets = [];
    for (var u = 0; u < unassoc.length; u++) {
      var members = await all('SELECT id, filename, repository_id FROM document_fingerprints WHERE grouping_id = ?', [unassoc[u].id]);
      memberSets.push(members);
    }
    var clusterDigest = unassoc.map(function (row, ci) {
      var sig = {}; try { sig = JSON.parse(row.signature || '{}') || {}; } catch (e) {}
      var reps = memberSets[ci].slice(0, 2).map(function (m) {
        var text = '';
        try { var cfg = JSON.parse((repoById[m.repository_id] || {}).config || '{}') || {}; var base = pathMod.resolve(cfg.path || '/nonexistent'); var full = pathMod.resolve(base, m.filename);
          if (full.indexOf(base + pathMod.sep) === 0 && fsMod.existsSync(full)) text = execFileSync('pdftotext', ['-f', '1', '-l', '1', full, '-'], { encoding: 'utf8', timeout: 15000 }); } catch (e) {}
        return '--- example (' + m.filename + ') ---\n' + (text || '').trim().substring(0, 1100);
      }).join('\n');
      return '=== CLUSTER ' + ci + ' — ' + row.member_count + ' documents sharing one layout ===\nForm field labels: ' + ((sig.labels || []).join(', ') || '(none)') + '\n' + reps;
    }).join('\n\n');
    var prompt = 'You are a records-management taxonomy expert. The agency record type "' + bucket.name + '"'
      + (bucket.intent ? ' (' + bucket.intent + ')' : '') + ' contains distinct sub-kinds.\n'
      + 'A census has ALREADY grouped the documents into clusters of identical layout — your only job is to NAME '
      + 'and describe each cluster from its example documents. Do not merge, split, or re-count clusters.\n'
      + 'Return ONLY a JSON array with EXACTLY one element per cluster, in cluster order.\n\n'
      + 'Rules:\n'
      + (variants.length ? '- These variants already exist — do not reuse their names: ' + variants.map(function (v) { return v.name; }).join('; ') + '\n' : '')
      + '- code: short kebab-case.\n\n'
      + 'Element shape:\n'
      + '{"cluster": 0, "name": "", "code": "", "intent": "", "expected_content": "", "synonyms": [], "keywords": [], "identifying_facets": [], "confidence": 0, "reasoning": ""}\n\n'
      + 'CLUSTERS:\n' + clusterDigest;
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var message = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 12000, messages: [{ role: 'user', content: prompt }] });
    var raw = require('./aiText').textOf(message).replace(/```json|```/g, '').trim();
    var names = [];
    try { names = JSON.parse(raw); } catch (e) { return { error: 'The AI response could not be read — try again (the census is saved, so a retry is fast)' }; }
    if (!Array.isArray(names)) names = [];
    groupings = unassoc.map(function (row, ci) {
      var named = names.find(function (n) { return Number(n.cluster) === ci; }) || {};
      var sig = null; try { sig = JSON.parse(row.signature || 'null'); } catch (e) {}
      var members = memberSets[ci];
      return {
        grouping_id: row.id,
        name: named.name || ('Layout grouping ' + (ci + 1)),
        code: named.code || ('grouping-' + (ci + 1)),
        intent: named.intent || null, expected_content: named.expected_content || null,
        synonyms: named.synonyms || [], keywords: named.keywords || [],
        identifying_facets: named.identifying_facets || [], formats: ['document'],
        confidence: typeof named.confidence === 'number' ? named.confidence : null,
        reasoning: named.reasoning || null,
        counted: true,
        estimated_count: row.member_count,
        sample_share: totals && totals.docs ? +(row.member_count / totals.docs).toFixed(4) : 0,
        layout: row.layout || 'uniform',
        mass_redaction_candidate: row.layout === 'uniform' || row.layout === 'few_layouts',
        example_files: members.slice(0, 5).map(function (m) { return m.filename; }),
        example_sources: members.slice(0, 5).map(function (m) { return { filename: m.filename, repository_id: m.repository_id }; }),
        fingerprint_ids: members.map(function (m) { return m.id; }),
        signature: sig,
        source_name: (repoById[row.repository_id] || {}).name || null
      };
    });
  }
  var grouped = groupRows.reduce(function (n, r) { return n + (r.member_count || 0); }, 0);
  return {
    bucket: { id: bucket.id, name: bucket.name },
    method: 'census',
    repos: censused.map(function (r) { return r.name; }),
    not_censused: notCensused,
    censused_at: latest,
    sampled: totals ? Number(totals.docs) : 0,            // documents fingerprinted by the census (not a sample)
    totalDocuments: totals ? Number(totals.files) : 0,   // every file the census counted
    unreadable: totals ? Number(totals.unreadable) : 0,
    recognized: recList,
    ungroupedShare: totals && totals.docs ? Math.round(((Number(totals.docs) - grouped) / Number(totals.docs)) * 100) / 100 : 0,
    groupings: groupings
  };
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
        // Stale feature shape (older FEATURE_V) → fall through and re-extract; the file is unchanged
        // but the fingerprint vocabulary grew (e.g. the title-veto feature, 2026-09-04).
        if (feat && feat.v !== docFingerprint.FEATURE_V) feat = null;
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
      if (!recognized[hit.id]) recognized[hit.id] = { record_type_id: hit.id, name: hit.name, count: 0, example_files: [], example_sources: [] };
      recognized[hit.id].count++;
      if (recognized[hit.id].example_files.length < 3) { recognized[hit.id].example_files.push(row.filename); recognized[hit.id].example_sources.push({ filename: row.filename, repository_id: row.repoId }); }
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

// discoverViaFingerprints / discoverViaSampleDigest RETIRED 2026-09-15 (slice 4): the census store replaces the per-bucket scan.
// fingerprintCensus + recognizeAgainstSignatures stay exported as the model-free kernel the fingerprint harness locks.

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
  // The variant's SOURCES are written here too (Kevin 2026-09-14): discovery knows exactly which repositories the
  // cluster's documents live in, so the variant gets those links — not a copy of the whole bucket's list. Exact
  // set = the distinct repositories of the stamped fingerprints; the legacy sample path has only example_sources.
  var sourceIds = [];
  if (Array.isArray(p.fingerprint_ids) && p.fingerprint_ids.length) {
    var fph = p.fingerprint_ids.map(function () { return '?'; }).join(',');
    await run('UPDATE document_fingerprints SET matched_record_type_id = ? WHERE id IN (' + fph + ')', [id].concat(p.fingerprint_ids));
    sourceIds = (await all('SELECT DISTINCT repository_id FROM document_fingerprints WHERE id IN (' + fph + ')', p.fingerprint_ids)).map(function (r) { return r.repository_id; });
    // The census groupings these documents belong to are now associated (slice 4: Find variants reads the census store).
    await run('UPDATE census_groupings SET record_type_id = ? WHERE record_type_id IS NULL AND id IN (SELECT DISTINCT grouping_id FROM document_fingerprints WHERE grouping_id IS NOT NULL AND id IN (' + fph + '))', [id].concat(p.fingerprint_ids));
  }
  if (!sourceIds.length && Array.isArray(p.example_sources)) {
    p.example_sources.forEach(function (es) { if (es && es.repository_id && sourceIds.indexOf(es.repository_id) === -1) sourceIds.push(es.repository_id); });
  }
  var fmts = p.formats && p.formats.length ? p.formats : ['document'];
  for (var si = 0; si < sourceIds.length; si++) await linkRepo(id, sourceIds[si], fmts);
  embedIndex.bg(embedIndex.reindexRecordTypes([id]), 'discover-variant');
  return await get('SELECT * FROM record_types WHERE id = ?', [id]);
}

module.exports = {
  discoverVariantGroupings: discoverVariantGroupings,
  applyGroupingProposal: applyGroupingProposal,
  // model-free internals of the fingerprint path, exported so the suite can verify the census,
  // persistence, and recognition without a model call (same principle as applyGroupingProposal)
  fingerprintCensus: fingerprintCensus, recognizeAgainstSignatures: recognizeAgainstSignatures
};
