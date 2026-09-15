'use strict';
// SOURCE CENSUS (2026-09-15, inventory build slice 1). Design: docs/DESIGN_setup_flow_map.md §3 step 2,
// docs/mockups/inventory_census, HANDOFF 2026-09-04 (three design rounds) and 2026-09-15 (Kevin's calls).
//
// One census per source, one source at a time, as a background job with progress. It reads EVERY file once:
//   pass 1 — files with a text layer are fingerprinted from pdftotext word boxes (docFingerprint);
//   pass 2 — scanned PDFs are read by local tesseract and fingerprinted from OCR word boxes (no opt-in, no fee);
//   then documents are grouped into IDENTICAL GROUPINGS (8-of-10 layout agreement, 3 or more documents) with
//   exact counts. Recognition runs first: documents matching an approved variant's stored signature are counted
//   under that variant (the grouping is "associated"); only the rest are clustered.
// Taxonomy-free: no record type has to be linked before a source can be censused (flow-map decision 1).
// Incremental: unchanged files (same content hash, current feature shape) are never re-read; removed files
// leave the index. Every file type is COUNTED; unsupported types are listed, never silently skipped.
// The census itself is model-free. The one paid step of the inventory flow (naming a grouping) happens at
// association time (slice 3), never here.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var { all, get, run } = require('../db');
var { v4: uuidv4 } = require('uuid');
var docFingerprint = require('./docFingerprint');

var connectors = { filestore: require('./connectors/filestore'), structured: require('./connectors/structured') };
var PROGRESS_EVERY = 5;

function nid(p) { return p + '-' + uuidv4().substring(0, 8); }
function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function cfgOf(repo) { try { return repo.config ? (typeof repo.config === 'string' ? JSON.parse(repo.config) : repo.config) : {}; } catch (e) { return {}; } }
function connectorFor(repo) { var c = repo && connectors[repo.connector_type]; return (c && (c.listAll || c.listKinds)) ? c : null; }
function isKinds(repo) { var c = repo && connectors[repo.connector_type]; return !!(c && c.listKinds && !c.listAll); }
function parseJson(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

// Can this source be censused at all? Search-only connectors cannot list what they hold (decision 5).
function availability(repo) {
  if (!connectorFor(repo)) return { available: false, reason: 'This connector can search but cannot list what it holds; no census is possible until its API can enumerate records. Record types stay linked by hand.' };
  var cfg = cfgOf(repo);
  if (!cfg.path) return { available: false, reason: isKinds(repo) ? 'This source has no system definition configured.' : 'This source has no folder path configured.' };
  if (!fs.existsSync(cfg.path)) return { available: false, reason: isKinds(repo) ? 'The system definition is not reachable from this server.' : 'The source folder is not reachable from this server.' };
  return { available: true, kind: isKinds(repo) ? 'kinds' : 'documents' };
}

// ---------------------------------------------------------------- the queue: one census at a time, in-process
var queue = [];       // run ids waiting
var active = null;    // run id executing
var waiters = {};     // run id -> [resolve]

async function request(repoId, actor) {
  var repo = await get('SELECT * FROM record_repositories WHERE id = ?', [repoId]);
  if (!repo) return { status: 404, error: 'Source not found' };
  var av = availability(repo);
  if (!av.available) return { status: 422, error: av.reason };
  var open = await get("SELECT id, status FROM source_census_runs WHERE repository_id = ? AND status IN ('queued','running') LIMIT 1", [repoId]);
  if (open) return { status: 409, error: 'A census for this source is already ' + open.status + '.', run_id: open.id };
  var id = nid('census');
  await run('INSERT INTO source_census_runs (id, repository_id, status, requested_by, requested_by_name, requested_at, census_kind) VALUES (?,?,?,?,?,?,?)',
    [id, repoId, 'queued', (actor && actor.id) || null, (actor && actor.name) || null, now(), isKinds(repo) ? 'kinds' : 'documents']);
  queue.push(id);
  var position = queue.length - 1 + (active ? 1 : 0);
  var behind = active ? await get('SELECT r.id, r.repository_id, rp.name AS repository_name FROM source_census_runs r JOIN record_repositories rp ON rp.id = r.repository_id WHERE r.id = ?', [active]) : null;
  pump();
  return { status: 202, run_id: id, position: position, queued_behind: behind };
}

function pump() {
  if (active || !queue.length) return;
  var id = queue.shift(); active = id;
  execute(id).catch(function (e) { console.error('[census] run failed', id, e && e.message); })
    .then(function () { active = null; (waiters[id] || []).forEach(function (r) { r(); }); delete waiters[id]; pump(); });
}
// Wait for a run to leave the queue/executor (used by the harness; the UI polls status()).
function awaitRun(id) {
  if (active !== id && queue.indexOf(id) === -1) return Promise.resolve();
  return new Promise(function (res) { (waiters[id] = waiters[id] || []).push(res); });
}
// On boot: anything left queued/running by a previous process was interrupted. Say so; never resume silently.
async function recoverInterrupted() {
  await run("UPDATE source_census_runs SET status = 'failed', phase = NULL, finished_at = ?, error = 'interrupted by a server restart — run the census again' WHERE status IN ('queued','running')", [now()]);
}

// ---------------------------------------------------------------- the run
async function setRun(id, fields) {
  var keys = Object.keys(fields);
  await run('UPDATE source_census_runs SET ' + keys.map(function (k) { return k + ' = ?'; }).join(', ') + ' WHERE id = ?', keys.map(function (k) { return fields[k]; }).concat([id]));
}

async function upsertFile(repoId, runId, f, existing, fields) {
  // fields: { kind, features|null, sha, ocr, unreadable }
  var feat = fields.features ? JSON.stringify(fields.features) : null;
  var pages = fields.features ? fields.features.pageCount : null;
  if (existing) {
    await run('UPDATE document_fingerprints SET content_sha256 = ?, page_count = ?, features = ?, matched_record_type_id = NULL, grouping_id = NULL, kind = ?, file_type = ?, ocr = ?, unreadable = ?, size_bytes = ?, last_seen_run_id = ?, extracted_at = ? WHERE id = ?',
      [fields.sha || null, pages, feat, fields.kind, f.ext || null, fields.ocr ? 1 : 0, fields.unreadable ? 1 : 0, f.size, runId, now(), existing.id]);
    return existing.id;
  }
  var id = nid('fp');
  await run('INSERT INTO document_fingerprints (id, repository_id, filename, content_sha256, page_count, features, kind, file_type, ocr, unreadable, size_bytes, last_seen_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, repoId, f.filename, fields.sha || null, pages, feat, fields.kind, f.ext || null, fields.ocr ? 1 : 0, fields.unreadable ? 1 : 0, f.size, runId]);
  return id;
}

async function execute(id) {
  var runRow = await get('SELECT * FROM source_census_runs WHERE id = ?', [id]);
  if (!runRow) return;
  var repo = await get('SELECT * FROM record_repositories WHERE id = ?', [runRow.repository_id]);
  var connector = connectorFor(repo);
  if (!connector) { await setRun(id, { status: 'failed', finished_at: now(), error: 'Source gone or connector cannot list files' }); return; }
  var cfg = cfgOf(repo);
  if (isKinds(repo)) return executeKinds(id, repo, connector, cfg);
  var t0 = Date.now();
  await setRun(id, { status: 'running', phase: 'text', started_at: now() });
  try {
    var files = connector.listAll(cfg);
    var c = { text: 0, ocr: 0, unreadable: 0, unsupported: 0, new: 0, changed: 0, kept: 0 };
    var done = 0, deferred = [];
    await setRun(id, { total_files: files.length });
    async function tick(force) { done++; if (force || done % PROGRESS_EVERY === 0) await setRun(id, { done_files: done }); }

    // ---- pass 1: every file; text-layer documents fingerprinted, scans deferred, other types counted
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var existing = await get('SELECT id, content_sha256, features, kind, ocr FROM document_fingerprints WHERE repository_id = ? AND filename = ?', [repo.id, f.filename]);
      if (f.ext !== 'pdf') {
        await upsertFile(repo.id, id, f, existing, { kind: 'unsupported', features: null, sha: null });
        c.unsupported++; if (!existing) c.new++; await tick(false); continue;
      }
      var sha = null;
      try { sha = sha256(f.fullPath); } catch (e) { await upsertFile(repo.id, id, f, existing, { kind: 'unreadable', features: null, sha: null, unreadable: 1 }); c.unreadable++; if (!existing) c.new++; await tick(false); continue; }
      if (existing && existing.content_sha256 === sha) {
        var feat = parseJson(existing.features, null);
        var current = feat && feat.v === docFingerprint.FEATURE_V;
        if ((existing.kind === 'doc' && current) || existing.kind === 'unreadable') {
          await run('UPDATE document_fingerprints SET size_bytes = ?, file_type = ?, last_seen_run_id = ? WHERE id = ?', [f.size, f.ext, id, existing.id]);
          c.kept++; if (existing.kind === 'unreadable') c.unreadable++; else if (existing.ocr) c.ocr++; else c.text++;
          await tick(false); continue;
        }
      }
      var features = docFingerprint.extractFeatures(f.fullPath);
      if (features) {
        await upsertFile(repo.id, id, f, existing, { kind: 'doc', features: features, sha: sha, ocr: 0 });
        c.text++; if (existing) c.changed++; else c.new++;
      } else {
        deferred.push({ f: f, sha: sha, existing: existing });
      }
      await tick(false);
    }
    var pass1 = Date.now() - t0;
    await setRun(id, { done_files: done, phase: 'ocr', pass1_ms: pass1 });

    // ---- pass 2: scans read by OCR; what OCR cannot read is recorded as unreadable
    var t1 = Date.now();
    for (var j = 0; j < deferred.length; j++) {
      var d = deferred[j];
      var of = docFingerprint.extractFeaturesOcr(d.f.fullPath);
      if (of) { await upsertFile(repo.id, id, d.f, d.existing, { kind: 'doc', features: of, sha: d.sha, ocr: 1 }); c.ocr++; }
      else { await upsertFile(repo.id, id, d.f, d.existing, { kind: 'unreadable', features: null, sha: d.sha, unreadable: 1 }); c.unreadable++; }
      if (d.existing) c.changed++; else c.new++;
      await setRun(id, { done_files: Math.min(files.length, done) });
    }
    var pass2 = Date.now() - t1;

    // ---- removed: indexed here, not on disk any more
    var gone = await get('SELECT count(*)::int AS n FROM document_fingerprints WHERE repository_id = ? AND (last_seen_run_id IS NULL OR last_seen_run_id <> ?)', [repo.id, id]);
    await run('DELETE FROM document_fingerprints WHERE repository_id = ? AND (last_seen_run_id IS NULL OR last_seen_run_id <> ?)', [repo.id, id]);

    // ---- grouping
    await setRun(id, { phase: 'grouping' });
    var g = await regroup(repo, id);

    await setRun(id, {
      status: 'done', phase: null, finished_at: now(), done_files: files.length,
      text_files: c.text, ocr_files: c.ocr, unreadable_files: c.unreadable, unsupported_files: c.unsupported,
      new_files: c.new, changed_files: c.changed, removed_files: Number(gone.n), kept_files: c.kept,
      groupings_count: g.groupings, ungrouped_count: g.ungrouped, pass2_ms: pass2
    });
  } catch (e) {
    await setRun(id, { status: 'failed', phase: null, finished_at: now(), error: String(e && e.message || e).slice(0, 500) });
  }
}

// ---------------------------------------------------------------- data systems: the kinds ARE the grouping
// Field typing from the name and the sample value — id / number / date / text / prose. Prose is what would be worth
// embedding row by row (tier 2, opt-in); ids, dates and numbers never are (tier 3: filters beat vectors there).
function typeField(name, value) {
  var n = String(name || '').toLowerCase();
  if (/(^|_)(id|no|number|num|code|key|ssn|routing|account|last4)$|_id$|^id$/.test(n)) return 'id';
  if (/date|_at$|period|year|time/.test(n)) return 'date';
  if (/note|narrative|description|comment|summary|remarks|findings|reason|text|body/.test(n)) return 'prose';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
    if (/^-?[\d,.]+$/.test(value.trim())) return 'number';
    if (value.length > 60 || value.split(/\s+/).length > 8) return 'prose';
    return 'text';
  }
  if (value == null) return /amount|total|count|hours|pay|wages|gross|net|tax|fee|rate|balance|qty/.test(n) ? 'number' : 'text';
  return 'text';
}
function embedTierFor(fields) {
  var types = fields.map(function (f) { return f.type; });
  if (types.some(function (t) { return t === 'prose'; })) return 2;              // prose present — opt-in per kind
  if (types.every(function (t) { return t === 'id' || t === 'number' || t === 'date'; })) return 3;
  return 1;
}
function normName(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(s|es)\b/g, '').replace(/s\b/g, '').replace(/\s+/g, ' ').trim(); }

async function executeKinds(id, repo, connector, cfg) {
  var t0 = Date.now();
  await setRun(id, { status: 'running', phase: 'kinds', started_at: now() });
  try {
    var kinds = connector.listKinds(cfg) || [];
    await setRun(id, { total_files: kinds.length });
    var types = await all("SELECT id, name FROM record_types WHERE status = 'active' AND parent_record_type_id IS NULL");
    var byNorm = {}; types.forEach(function (t) { byNorm[normName(t.name)] = t.id; });
    var c = { new: 0, changed: 0, kept: 0 }, seen = [];
    for (var i = 0; i < kinds.length; i++) {
      var k = kinds[i];
      var fields = k.fields.map(function (f) { return { name: f, type: typeField(f, k.sample ? k.sample[f] : undefined) }; });
      var prose = fields.filter(function (f) { return f.type === 'prose'; }).map(function (f) { return f.name; });
      var tier = embedTierFor(fields);
      var existing = await get('SELECT * FROM census_kinds WHERE repository_id = ? AND kind_key = ?', [repo.id, k.key]);
      var rtId = existing && existing.record_type_id ? existing.record_type_id : (byNorm[normName(k.name)] || byNorm[normName(k.key)] || null);
      var basis = existing && existing.record_type_id ? existing.match_basis : (rtId ? 'by_name' : null);
      var fingerprint = JSON.stringify([k.fields, k.row_count, k.date_range, k.description]);
      if (existing) {
        var was = JSON.stringify([parseJson(existing.fields, []).map(function (f) { return f.name; }), existing.row_count != null ? Number(existing.row_count) : null, parseJson(existing.date_range, null), existing.description]);
        if (was === fingerprint) c.kept++; else c.changed++;
        await run('UPDATE census_kinds SET name = ?, description = ?, fields = ?, sample = ?, row_count = ?, date_range = ?, record_type_id = ?, match_basis = ?, embed_tier = ?, prose_fields = ?, last_seen_run_id = ? WHERE id = ?',
          [k.name, k.description, JSON.stringify(fields), k.sample ? JSON.stringify(k.sample) : null, k.row_count, k.date_range ? JSON.stringify(k.date_range) : null, rtId, basis, existing.embed_tier != null && existing.embed_tier !== 1 ? existing.embed_tier : tier, JSON.stringify(prose), id, existing.id]);
        seen.push(existing.id);
      } else {
        var kid = nid('kind'); c.new++;
        await run('INSERT INTO census_kinds (id, repository_id, kind_key, name, description, fields, sample, row_count, date_range, record_type_id, match_basis, embed_tier, prose_fields, first_seen_run_id, last_seen_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [kid, repo.id, k.key, k.name, k.description, JSON.stringify(fields), k.sample ? JSON.stringify(k.sample) : null, k.row_count, k.date_range ? JSON.stringify(k.date_range) : null, rtId, basis, tier, JSON.stringify(prose), id, id]);
        seen.push(kid);
      }
      await setRun(id, { done_files: i + 1 });
    }
    var gone = await get('SELECT count(*)::int AS n FROM census_kinds WHERE repository_id = ? AND (last_seen_run_id IS NULL OR last_seen_run_id <> ?)', [repo.id, id]);
    await run('DELETE FROM census_kinds WHERE repository_id = ? AND (last_seen_run_id IS NULL OR last_seen_run_id <> ?)', [repo.id, id]);
    await setRun(id, { status: 'done', phase: null, finished_at: now(), done_files: kinds.length, new_files: c.new, changed_files: c.changed, removed_files: Number(gone.n), kept_files: c.kept, groupings_count: kinds.length, ungrouped_count: 0, pass1_ms: Date.now() - t0, pass2_ms: 0 });
  } catch (e) {
    await setRun(id, { status: 'failed', phase: null, finished_at: now(), error: String(e && e.message || e).slice(0, 500) });
  }
}

// One honest sentence per record: the kind's name, then up to five fields that are not ids, with values a field
// redaction template withholds shown blacked out — this string is what would embed; withheld values never leave.
function renderRecord(kind, sample, withheld) {
  var parts = [], wh = {}; (withheld || []).forEach(function (w) { wh[String(w).toLowerCase()] = 1; });
  var fields = parseJson(kind.fields, []);
  fields.forEach(function (f) {
    if (parts.length >= 5 || f.type === 'id') return;
    var v = sample ? sample[f.name] : undefined; if (v == null) return;
    var label = f.name.replace(/_/g, ' ');
    parts.push({ label: label, value: wh[f.name.toLowerCase()] ? null : String(v), withheld: !!wh[f.name.toLowerCase()] });
  });
  return { text: kind.name + (parts.length ? ' — ' + parts.map(function (p) { return p.label + ' ' + (p.withheld ? '████' : p.value); }).join(' — ') : ''), parts: parts };
}

async function fieldTemplateFor(recordTypeId) {
  if (!recordTypeId) return null;
  var t = await get("SELECT id, name, field_map FROM layout_profiles WHERE record_type_id = ? AND kind = 'fields' AND status != 'deleted' ORDER BY created_at DESC LIMIT 1", [recordTypeId]);
  if (!t) return null;
  return { id: t.id, name: t.name, withheld: parseJson(t.field_map, []).map(function (f) { return f.field; }).filter(Boolean) };
}

async function kindsInventory(repo, st) {
  var cfg = cfgOf(repo);
  var rows = await all('SELECT * FROM census_kinds WHERE repository_id = ? ORDER BY row_count DESC NULLS LAST, name', [repo.id]);
  var kinds = [], totalRows = 0, rowsKnown = false, fieldCount = 0, withTemplate = 0;
  for (var i = 0; i < rows.length; i++) {
    var k = rows[i], rt = k.record_type_id ? await get('SELECT id, name, status FROM record_types WHERE id = ?', [k.record_type_id]) : null;
    var tpl = await fieldTemplateFor(rt ? rt.id : null); if (tpl) withTemplate++;
    var fields = parseJson(k.fields, []); fieldCount += fields.length;
    if (k.row_count != null) { totalRows += Number(k.row_count); rowsKnown = true; }
    var sample = parseJson(k.sample, null);
    kinds.push({
      id: k.id, key: k.kind_key, name: k.name, description: k.description, fields: fields, row_count: k.row_count != null ? Number(k.row_count) : null,
      date_range: parseJson(k.date_range, null), record_type: rt, match_basis: k.match_basis,
      field_template: tpl, embed_tier: k.embed_tier, prose_fields: parseJson(k.prose_fields, []),
      rendered: renderRecord(k, sample, tpl ? tpl.withheld : []),
      redaction: tpl ? 'field_template_ready' : 'no_field_template'
    });
  }
  var history = (await all("SELECT * FROM source_census_runs WHERE repository_id = ? AND status IN ('done','failed') ORDER BY seq DESC LIMIT 10", [repo.id])).map(runSummary);
  return {
    mode: 'data',
    source: { id: repo.id, name: repo.name, connector_type: repo.connector_type, status: repo.status, description: repo.description, path: cfg.path || null, system: rows.length ? null : null },
    census: Object.assign(st, { history: history }),
    totals: { kinds: kinds.length, rows: rowsKnown ? totalRows : null, fields: fieldCount, field_templates: withTemplate },
    kinds: kinds
  };
}

async function associateKind(repo, kindId, recordTypeId) {
  var k = await get('SELECT * FROM census_kinds WHERE id = ? AND repository_id = ?', [kindId, repo.id]);
  if (!k) return { status: 404, error: 'Record kind not found' };
  if (recordTypeId) {
    var rt = await get('SELECT id FROM record_types WHERE id = ?', [recordTypeId]);
    if (!rt) return { status: 422, error: 'Choose an existing record type.' };
    await run("UPDATE census_kinds SET record_type_id = ?, match_basis = 'by_hand' WHERE id = ?", [recordTypeId, kindId]);
    var dup = await get('SELECT id FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?', [recordTypeId, repo.id]);
    if (!dup) await run('INSERT INTO record_type_repositories (id, record_type_id, repository_id, format, filter_spec, sort_order) VALUES (?,?,?,?,?,?)', [nid('rr'), recordTypeId, repo.id, 'structured_data', '{}', 100]);
  } else {
    await run('UPDATE census_kinds SET record_type_id = NULL, match_basis = NULL WHERE id = ?', [kindId]);
  }
  return { status: 200 };
}

// ---------------------------------------------------------------- grouping: recognition first, then clusters
function foldersOf(members) {
  var counts = {};
  members.forEach(function (m) { var d = path.posix.dirname(m.filename); d = d === '.' ? '/' : '/' + d; counts[d] = (counts[d] || 0) + 1; });
  return Object.keys(counts).map(function (k) { return { folder: k, n: counts[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
}

async function regroup(repo, runId) {
  var rows = await all("SELECT id, filename, features, matched_record_type_id, grouping_id AS prior_grouping_id FROM document_fingerprints WHERE repository_id = ? AND kind = 'doc' AND features IS NOT NULL", [repo.id]);
  rows.forEach(function (r) { r.features = parseJson(r.features, null); });
  rows = rows.filter(function (r) { return r.features; });
  await run('UPDATE document_fingerprints SET grouping_id = NULL WHERE repository_id = ?', [repo.id]);

  // Recognition against EVERY stored variant signature (the census is taxonomy-free — no bucket to scope by).
  var sigRows = await all("SELECT id, name, discovery_meta FROM record_types WHERE discovery_meta IS NOT NULL");
  var sigs = [];
  sigRows.forEach(function (v) { var m = parseJson(v.discovery_meta, {}); if (m && m.signature) sigs.push({ id: v.id, signature: m.signature }); });
  var byType = {}, unrec = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], hit = null;
    if (r.matched_record_type_id) hit = { id: r.matched_record_type_id };            // a stamp is a fact — keep it
    else hit = sigs.find(function (s) { return docFingerprint.matchesSignature(r.features, s.signature); }) || null;
    if (hit) {
      (byType[hit.id] = byType[hit.id] || []).push(r);
      if (r.matched_record_type_id !== hit.id) await run('UPDATE document_fingerprints SET matched_record_type_id = ? WHERE id = ?', [hit.id, r.id]);
    } else unrec.push(r);
  }

  var existing = await all('SELECT * FROM census_groupings WHERE repository_id = ?', [repo.id]);
  existing.forEach(function (e) { e.signature = parseJson(e.signature, null); });
  var maxOrd = existing.reduce(function (m, e) { return Math.max(m, e.ordinal || 0); }, 0);
  var seen = {};
  // Stable ids: the grouping most of these documents belonged to last run keeps its row — whether the set is
  // now associated (its documents were stamped by an approval) or still a bare cluster. Signature is the fallback.
  function priorOf(members) {
    var counts = {}, best = null, n = 0;
    members.forEach(function (m) { if (!m.prior_grouping_id) return; counts[m.prior_grouping_id] = (counts[m.prior_grouping_id] || 0) + 1; if (counts[m.prior_grouping_id] > n) { n = counts[m.prior_grouping_id]; best = m.prior_grouping_id; } });
    if (!best) return null;
    var row = existing.find(function (e) { return e.id === best && !seen[e.id]; });
    return row || null;
  }

  async function writeGrouping(match, members, recordTypeId) {
    var feats = members.map(function (m) { return m.features; });
    var sig = docFingerprint.signature(feats);
    var layout = docFingerprint.layoutConsistency(feats);
    var folders = JSON.stringify(foldersOf(members));
    var examples = JSON.stringify(members.slice(0, 5).map(function (m) { return m.id; }));
    var gid;
    if (match) {
      gid = match.id;
      await run('UPDATE census_groupings SET record_type_id = ?, signature = ?, member_count = ?, layout = ?, folders = ?, example_ids = ?, last_seen_run_id = ? WHERE id = ?',
        [recordTypeId || null, JSON.stringify(sig), members.length, layout, folders, examples, runId, gid]);
    } else {
      gid = nid('grp'); maxOrd++;
      await run('INSERT INTO census_groupings (id, repository_id, ordinal, record_type_id, signature, member_count, layout, folders, example_ids, first_seen_run_id, last_seen_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [gid, repo.id, maxOrd, recordTypeId || null, JSON.stringify(sig), members.length, layout, folders, examples, runId, runId]);
    }
    seen[gid] = 1;
    var ph = members.map(function () { return '?'; }).join(',');
    await run('UPDATE document_fingerprints SET grouping_id = ? WHERE id IN (' + ph + ')', [gid].concat(members.map(function (m) { return m.id; })));
    return gid;
  }

  // Associated groupings: one per record type present in this source.
  for (var tid in byType) {
    var match = existing.find(function (e) { return e.record_type_id === tid && !seen[e.id]; }) || priorOf(byType[tid]);
    await writeGrouping(match, byType[tid], tid);
  }
  // Unrecognised: cluster, then keep ids stable by matching each cluster's signature to an existing unassociated row.
  var clusters = docFingerprint.cluster(unrec)
    .map(function (idxs) { return idxs.map(function (k) { return unrec[k]; }); })
    .filter(function (m) { return m.length >= 3; })
    .sort(function (a, b) { return b.length - a.length; });
  var clustered = 0;
  for (var ci = 0; ci < clusters.length; ci++) {
    var members = clusters[ci]; clustered += members.length;
    var sig = docFingerprint.signature(members.map(function (m) { return m.features; }));
    var cand = priorOf(members) || existing.find(function (e) { return !e.record_type_id && !seen[e.id] && e.signature && docFingerprint.matchesSignature(sig, e.signature); }) || null;
    await writeGrouping(cand, members, null);
  }
  // Groupings whose documents are no longer here disappear with them.
  var keep = Object.keys(seen);
  if (keep.length) await run('DELETE FROM census_groupings WHERE repository_id = ? AND id NOT IN (' + keep.map(function () { return '?'; }).join(',') + ')', [repo.id].concat(keep));
  else await run('DELETE FROM census_groupings WHERE repository_id = ?', [repo.id]);
  return { groupings: keep.length, ungrouped: unrec.length - clustered };
}

// ---------------------------------------------------------------- reads
// Cheap disk-vs-index comparison (names and sizes, no hashing): what a refresh would find.
function drift(repo) {
  return (async function () {
    var connector = connectorFor(repo); if (!connector || !connector.listAll) return null;
    var cfg = cfgOf(repo); if (!cfg.path || !fs.existsSync(cfg.path)) return null;
    var files = connector.listAll(cfg);
    var idx = await all('SELECT filename, size_bytes FROM document_fingerprints WHERE repository_id = ?', [repo.id]);
    var byName = {}; idx.forEach(function (r) { byName[r.filename] = r; });
    var seen = {}, out = { new: 0, changed: 0, removed: 0 };
    files.forEach(function (f) {
      seen[f.filename] = 1;
      var r = byName[f.filename];
      if (!r) out.new++;
      else if (r.size_bytes != null && Number(r.size_bytes) !== f.size) out.changed++;
    });
    idx.forEach(function (r) { if (!seen[r.filename]) out.removed++; });
    return out;
  })();
}

function runSummary(r) {
  if (!r) return null;
  return {
    id: r.id, status: r.status, phase: r.phase, requested_at: r.requested_at, started_at: r.started_at, finished_at: r.finished_at,
    requested_by_name: r.requested_by_name,
    total_files: r.total_files, done_files: r.done_files,
    text_files: r.text_files, ocr_files: r.ocr_files, unreadable_files: r.unreadable_files, unsupported_files: r.unsupported_files,
    new_files: r.new_files, changed_files: r.changed_files, removed_files: r.removed_files, kept_files: r.kept_files,
    groupings_count: r.groupings_count, ungrouped_count: r.ungrouped_count, pass1_ms: r.pass1_ms, pass2_ms: r.pass2_ms, error: r.error
  };
}

// Status for the card / polling: availability, the open run (queued/running) with progress, the last finished run, drift.
async function status(repo, opts) {
  var av = availability(repo);
  var open = await get("SELECT * FROM source_census_runs WHERE repository_id = ? AND status IN ('queued','running') ORDER BY seq DESC LIMIT 1", [repo.id]);
  var last = await get("SELECT * FROM source_census_runs WHERE repository_id = ? AND status = 'done' ORDER BY seq DESC LIMIT 1", [repo.id]);
  var out = { available: av.available, reason: av.reason || null, kind: av.kind || (isKinds(repo) ? 'kinds' : 'documents'), current: runSummary(open), last: runSummary(last), drift: null, queue_position: null };
  if (open) {
    if (active === open.id) out.queue_position = 0;
    else { var qi = queue.indexOf(open.id); out.queue_position = qi >= 0 ? qi + (active ? 1 : 0) : null; }
    if (active && active !== open.id) out.queued_behind = await get('SELECT rp.id, rp.name FROM source_census_runs r JOIN record_repositories rp ON rp.id = r.repository_id WHERE r.id = ?', [active]);
  }
  if (av.available && last && !(opts && opts.skipDrift)) { try { out.drift = await drift(repo); } catch (e) { out.drift = null; } }
  return out;
}

// Redaction posture of an associated grouping — derived from its record type, never stored on the grouping.
async function redactionPosture(rt) {
  if (!rt) return null;
  var tpl = await get("SELECT 1 AS ok FROM layout_profiles WHERE record_type_id = ? AND status != 'deleted' LIMIT 1", [rt.id]);
  if (tpl) return 'template_ready';
  if (rt.auto_release_eligible && rt.public_availability === 'releasable') return 'no_redaction';
  var meta = parseJson(rt.discovery_meta, {});
  if (meta && meta.redact_by_hand) return 'redact_by_hand';
  if (rt.mass_redaction_candidate) return 'waiting';
  return 'none';
}

async function inventory(repo) {
  var cfg = cfgOf(repo);
  var st = await status(repo);
  if (isKinds(repo)) return kindsInventory(repo, st);
  var files = await all('SELECT id, filename, kind, file_type, ocr, unreadable, size_bytes, page_count, grouping_id, matched_record_type_id FROM document_fingerprints WHERE repository_id = ? ORDER BY filename', [repo.id]);
  var totals = { files: files.length, fingerprinted: 0, text_layer: 0, ocr: 0, unreadable: 0, unsupported: 0, groupings: 0, ungrouped: 0 };
  var types = {}, unsupportedExt = {}, folders = {};
  files.forEach(function (f) {
    var ext = f.file_type || 'other'; types[ext] = (types[ext] || 0) + 1;
    var d = path.posix.dirname(f.filename); if (d !== '.') folders[d] = 1;
    if (f.kind === 'doc') { totals.fingerprinted++; if (f.ocr) totals.ocr++; else totals.text_layer++; }
    else if (f.kind === 'unreadable') totals.unreadable++;
    else if (f.kind === 'unsupported') { totals.unsupported++; unsupportedExt[ext] = (unsupportedExt[ext] || 0) + 1; }
  });
  var grows = await all('SELECT * FROM census_groupings WHERE repository_id = ? ORDER BY member_count DESC, ordinal', [repo.id]);
  var groupings = [];
  for (var i = 0; i < grows.length; i++) {
    var g = grows[i], rt = null, parent = null;
    if (g.record_type_id) {
      rt = await get('SELECT id, name, status, parent_record_type_id, public_availability, auto_release_eligible, mass_redaction_candidate, discovery_meta FROM record_types WHERE id = ?', [g.record_type_id]);
      if (rt && rt.parent_record_type_id) parent = await get('SELECT id, name FROM record_types WHERE id = ?', [rt.parent_record_type_id]);
    }
    var exIds = parseJson(g.example_ids, []);
    var examples = exIds.length ? await all('SELECT id, filename, ocr FROM document_fingerprints WHERE id IN (' + exIds.map(function () { return '?'; }).join(',') + ')', exIds) : [];
    var gsig = parseJson(g.signature, {}) || {};
    groupings.push({
      id: g.id, ordinal: g.ordinal, member_count: g.member_count, layout: g.layout,
      folders: parseJson(g.folders, []),
      labels: (gsig.labels || []).slice(0, 14),          // the field labels the layout owns (View sample)
      record_type: rt ? { id: rt.id, name: rt.name, status: rt.status, parent: parent ? { id: parent.id, name: parent.name } : null } : null,
      redaction: await redactionPosture(rt),
      decisions: (function () { var m = rt ? (parseJson(rt.discovery_meta, {}) || {}) : {}; return { no_redaction: m.no_redaction ? { by_name: m.no_redaction.by_name, at: m.no_redaction.at, reason: m.no_redaction.reason } : null, redact_by_hand: m.redact_by_hand || null }; })(),
      examples: examples.map(function (e) { return { fingerprint_id: e.id, filename: e.filename, ocr: !!e.ocr }; }),
      first_seen_run_id: g.first_seen_run_id, last_seen_run_id: g.last_seen_run_id
    });
  }
  totals.groupings = groupings.length;
  var ungrouped = files.filter(function (f) { return !f.grouping_id; }).map(function (f) {
    return { fingerprint_id: f.id, filename: f.filename, kind: f.kind, file_type: f.file_type, ocr: !!f.ocr, size_bytes: f.size_bytes != null ? Number(f.size_bytes) : null };
  });
  totals.ungrouped = ungrouped.filter(function (u) { return u.kind === 'doc'; }).length;
  var linked = await all("SELECT rt.id, rt.name, rt.status, rt.parent_record_type_id, p.name AS parent_name FROM record_type_repositories rr JOIN record_types rt ON rt.id = rr.record_type_id LEFT JOIN record_types p ON p.id = rt.parent_record_type_id WHERE rr.repository_id = ? ORDER BY rt.name", [repo.id]);
  var counts = await all('SELECT matched_record_type_id AS id, count(*)::int AS n FROM document_fingerprints WHERE repository_id = ? AND matched_record_type_id IS NOT NULL GROUP BY matched_record_type_id', [repo.id]);
  var countBy = {}; counts.forEach(function (c) { countBy[c.id] = Number(c.n); });
  var history = (await all("SELECT * FROM source_census_runs WHERE repository_id = ? AND status IN ('done','failed') ORDER BY seq DESC LIMIT 10", [repo.id])).map(runSummary);
  return {
    mode: 'documents',
    source: { id: repo.id, name: repo.name, connector_type: repo.connector_type, status: repo.status, description: repo.description, path: cfg.path || null, sub_folders: Object.keys(folders).length },
    census: Object.assign(st, { history: history }),
    totals: totals,
    file_types: Object.keys(types).map(function (k) { return { ext: k, n: types[k] }; }).sort(function (a, b) { return b.n - a.n; }),
    unsupported_by_type: Object.keys(unsupportedExt).map(function (k) { return { ext: k, n: unsupportedExt[k] }; }).sort(function (a, b) { return b.n - a.n; }),
    groupings: groupings,
    ungrouped: { count: ungrouped.length, files: ungrouped },
    linked_types: linked.map(function (l) { return { id: l.id, name: l.name, status: l.status, parent_name: l.parent_name || null, count_here: countBy[l.id] || 0 }; })
  };
}

// Resolve a fingerprint to its on-disk path, refusing anything outside the source root.
async function fileOf(repo, fingerprintId) {
  var row = await get('SELECT * FROM document_fingerprints WHERE id = ? AND repository_id = ?', [fingerprintId, repo.id]);
  if (!row) return null;
  var cfg = cfgOf(repo); if (!cfg.path) return null;
  var base = path.resolve(cfg.path), full = path.resolve(base, row.filename);
  if (row.filename.split('/').indexOf('..') !== -1 || full.indexOf(base + path.sep) !== 0) return null;
  if (!fs.existsSync(full)) return null;
  return { row: row, fullPath: full };
}

module.exports = {
  request: request, awaitRun: awaitRun, recoverInterrupted: recoverInterrupted,
  status: status, inventory: inventory, drift: drift, availability: availability, fileOf: fileOf, associateKind: associateKind, renderRecord: renderRecord, typeField: typeField,
  execute: execute, regroup: regroup,
  _queueState: function () { return { active: active, queue: queue.slice() }; }
};
