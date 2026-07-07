'use strict';
// Import ingestion: pull files from a drop folder INTO the system so they get extracted + indexed
// (and can then be mass-redacted -> public-ready). Generalizes the 911 incremental-pull pattern.
// SAFE: copies files (never moves/deletes the source), idempotent via a per-source manifest
// (dedup by name+size+mtime), and error-isolated (a bad file is logged and skipped).
var fs = require('fs');
var path = require('path');
var uuidv4 = require('uuid').v4;
var db = require('../db');
var docProcessing = require('./docProcessing');
var embedIndex = require('./embedIndex');
var Anthropic = require('@anthropic-ai/sdk');

var UPLOAD_DIR = path.join(__dirname, '../../../uploads');
var ALLOWED = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.tiff', '.txt', '.csv'];
var MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tiff': 'image/tiff', '.txt': 'text/plain', '.csv': 'text/csv', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

async function ensureTable() {
  await db.run("CREATE TABLE IF NOT EXISTS import_ingest_log (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, file_key TEXT NOT NULL, original_name TEXT, request_file_id TEXT, status TEXT, detail TEXT, ingested_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')))");
  await db.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_import_ingest ON import_ingest_log (repository_id, file_key)");
  await db.run("CREATE TABLE IF NOT EXISTS import_review_jobs (job_id TEXT PRIMARY KEY, repository_id TEXT, review_assignee TEXT, kind TEXT, review_task_id TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')))");
}
function parseCfg(repo) { try { return repo.config ? (typeof repo.config === 'string' ? JSON.parse(repo.config) : repo.config) : {}; } catch (e) { return {}; } }
function fileKey(name, st) { return name + ':' + st.size + ':' + Math.floor(st.mtimeMs); }

async function ensureIngestRequest(repo) {
  var reqId = 'sysimport-' + repo.id;
  var rq = await db.get("SELECT id FROM requests WHERE id = ?", [reqId]);
  if (!rq) await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, classification, stage, status, created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
    [reqId, 'SYS-IMPORT-' + String(repo.id).slice(0, 10), 'File Import', 'system@optimumq.ai', 'Standing file-import batch for source: ' + repo.name, 'standard', 'delivery', 'active']);
  return reqId;
}

async function discoverNew(repo, settleMs) {
  await ensureTable();
  var cfg = parseCfg(repo);
  var dir = cfg.path;
  if (!dir) return { error: 'No import path configured for this source.', files: [] };
  if (!fs.existsSync(dir)) return { error: 'Import path not found on disk: ' + dir, files: [] };
  var entries;
  try { entries = fs.readdirSync(dir); } catch (e) { return { error: 'Cannot read import path: ' + e.message, files: [] }; }
  entries = entries.filter(function (f) { return ALLOWED.indexOf(path.extname(f).toLowerCase()) >= 0; });
  var seen = await db.all("SELECT file_key FROM import_ingest_log WHERE repository_id = ? AND status = 'ingested'", [repo.id]);
  var seenSet = {}; seen.forEach(function (r) { seenSet[r.file_key] = 1; });
  var out = [];
  entries.forEach(function (f) {
    var full = path.join(dir, f);
    try { var st = fs.statSync(full); if (!st.isFile()) return; if (settleMs && (Date.now() - st.mtimeMs) < settleMs) return; var key = fileKey(f, st); if (!seenSet[key]) out.push({ full: full, name: f, key: key, size: st.size }); } catch (e) { /* skip */ }
  });
  return { files: out, scanned: entries.length };
}

async function runIngest(repoId, opts) {
  opts = opts || {};
  var repo = await db.get("SELECT * FROM record_repositories WHERE id = ?", [repoId]);
  if (!repo) return { error: 'Source not found.' };
  if (repo.connector_type !== 'import') return { error: 'This source is not an Import source.' };
  var cfg = parseCfg(repo);
  var disc = await discoverNew(repo, opts.settleMs || 0);
  if (disc.error) return { error: disc.error };
  var reqId = await ensureIngestRequest(repo);
  var ingested = 0, errors = 0, fids = [];
  for (var i = 0; i < disc.files.length; i++) {
    var f = disc.files[i];
    try {
      var ext = path.extname(f.name).toLowerCase();
      var fid = 'imp-' + uuidv4();
      var destName = fid + ext;
      fs.copyFileSync(f.full, path.join(UPLOAD_DIR, destName)); // COPY - source untouched
      await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
        [fid, reqId, destName, f.name, MIME[ext] || 'application/octet-stream', f.size, 'imported', 'Import: ' + repo.name]);
      await docProcessing.processFile(fid); // extract text + auto-index (internal)
      await db.run("INSERT INTO import_ingest_log (id, repository_id, file_key, original_name, request_file_id, status) VALUES (?,?,?,?,?, 'ingested') ON CONFLICT (repository_id, file_key) DO UPDATE SET status='ingested', request_file_id=EXCLUDED.request_file_id, detail=NULL, ingested_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')",
        [uuidv4(), repo.id, f.key, f.name, fid]);
      ingested++; fids.push(fid);
      var _act = cfg.post_ingest || 'leave';
      if (_act === 'archive') { try { var _pd = path.join(path.dirname(f.full), 'processed'); fs.mkdirSync(_pd, { recursive: true }); fs.renameSync(f.full, path.join(_pd, f.name)); } catch(eA){ console.error('[importIngest archive]', eA && eA.message); } }
      else if (_act === 'delete') { try { fs.unlinkSync(f.full); } catch(eD){ console.error('[importIngest delete]', eD && eD.message); } }
    } catch (e) {
      errors++;
      try { await db.run("INSERT INTO import_ingest_log (id, repository_id, file_key, original_name, status, detail) VALUES (?,?,?,?, 'error', ?) ON CONFLICT (repository_id, file_key) DO UPDATE SET status='error', detail=EXCLUDED.detail", [uuidv4(), repo.id, f.key, f.name, String(e.message).slice(0, 300)]); } catch (ee) { /* ignore */ }
      console.error('[importIngest]', f.name, e.message);
    }
  }
  try { if (cfg.record_type_id && fids.length) await enrichRecordType(cfg.record_type_id, fids); } catch(e){ console.error('[importIngest enrich call]', e && e.message); }
  try { await routeEndToEnd(repo, cfg, reqId, fids); } catch(e){ console.error('[importIngest routeEndToEnd]', e && e.message); }
  return { ingested: ingested, errors: errors, scanned: disc.scanned, newFound: disc.files.length };
}

// AI enrichment: on first import, look at the actual sample files and fill in the record
// type's vocabulary (synonyms/keywords/disambiguators/intent/expected_content). Human
// provides name+description (the spine); AI adds the vocabulary (the muscle). Runs once
// (skipped if the type already has synonyms).
function packArr(a){ return Array.isArray(a) ? JSON.stringify(a) : '[]'; }
async function enrichRecordType(typeId, fids){
  if (!typeId || !fids || !fids.length) return;
  if (!process.env.ANTHROPIC_API_KEY) return;
  var t = await db.get("SELECT id, name, description, synonyms FROM record_types WHERE id = ?", [typeId]);
  if (!t) return;
  var existing = []; try { existing = JSON.parse(t.synonyms || '[]'); } catch(e){}
  if (existing && existing.length) return; // already enriched
  var texts = [];
  for (var i=0; i<Math.min(fids.length, 3); i++){
    var pages = await db.all("SELECT text FROM document_pages WHERE file_id = ? AND text IS NOT NULL ORDER BY page_no LIMIT 3", [fids[i]]);
    pages.forEach(function(pg){ if (pg.text) texts.push(pg.text); });
  }
  var sample = texts.join('\n').slice(0, 4000);
  if (!sample.trim()) return;
  var prompt = 'You are helping build a public-records taxonomy. A record type has been defined:\n'
    + 'Name: ' + (t.name||'') + '\nDescription: ' + (t.description||'(none)') + '\n\n'
    + 'Here are excerpts from actual documents of this type:\n---\n' + sample + '\n---\n\n'
    + 'Generate vocabulary to improve search matching. Respond ONLY with JSON (no markdown, no preamble):\n'
    + '{"synonyms": [], "keywords": [], "disambiguators": [], "intent": "", "expected_content": ""}\n'
    + '- synonyms: alternate names a requester might use for this record type\n'
    + '- keywords: distinctive terms found in these documents\n'
    + '- disambiguators: terms that distinguish this from similar record types\n'
    + '- intent: one sentence on why someone requests these\n'
    + '- expected_content: one sentence on what these records contain';
  try {
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var msg = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
    var raw = (msg.content && msg.content[0] && msg.content[0].text) ? msg.content[0].text.trim() : '';
    raw = raw.replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'').trim();
    var r = JSON.parse(raw);
    await db.run("UPDATE record_types SET synonyms=?, keywords=?, disambiguators=?, intent=COALESCE(NULLIF(intent,''), ?), expected_content=COALESCE(NULLIF(expected_content,''), ?) WHERE id=?",
      [packArr(r.synonyms), packArr(r.keywords), packArr(r.disambiguators), r.intent||null, r.expected_content||null, typeId]);
    try { embedIndex.bg(embedIndex.reindexRecordType(typeId), 'rt-enrich ' + typeId); } catch(e){}
    console.log('[importIngest] enriched record type', typeId, '(' + (t.name||'') + ')');
  } catch(e){ console.error('[importIngest enrich]', e && e.message); }
}

// End-to-end routing: after ingest, optionally auto-create a redaction job (if a template is
// linked) or a one-time 'build template' task (if not). Review happens as a task on completion.
async function routeEndToEnd(repo, cfg, reqId, fids){
  if (!cfg || !cfg.end_to_end || !fids || !fids.length) return;
  var reviewer = cfg.review_assignee || null;
  if (cfg.template_id) {
    var tmpl = await db.get("SELECT id, name, kind FROM layout_profiles WHERE id = ?", [cfg.template_id]);
    if (tmpl) {
      var jobId = 'mj-imp-' + uuidv4();
      await db.run("INSERT INTO mass_redaction_jobs (id, name, template_id, kind, file_ids, total_items, chunk_size, window_start, window_end, priority, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'queued', ?, datetime('now'), datetime('now'))",
        [jobId, 'Import auto-redaction - ' + repo.name + ' - ' + new Date().toISOString().slice(0,10), tmpl.id, tmpl.kind || 'zones', JSON.stringify(fids), fids.length, 100, '00:00', '23:59', 5, reviewer || 'import']);
      await db.run("INSERT INTO import_review_jobs (job_id, repository_id, review_assignee, kind) VALUES (?,?,?,?) ON CONFLICT (job_id) DO NOTHING", [jobId, repo.id, reviewer, 'review']);
      return;
    }
  }
  // no template linked -> ensure a one-time build-template task exists
  var existing = await db.get("SELECT id FROM tasks WHERE request_id = ? AND type = 'build_redaction_template' AND status IN ('open','assigned','in_progress')", [reqId]);
  if (!existing) {
    var tr = require('./taskRouting');
    var t = await tr.createTask({ requestId: reqId, type: 'build_redaction_template', title: 'Build redaction template for import source: ' + repo.name, createdBy: 'import' });
    if (reviewer && t && t.id) { try { await tr.assign(t.id, reviewer, 'manual'); } catch(e){} }
  }
}

async function status(repoId) {
  await ensureTable();
  var rows = await db.all("SELECT status, COUNT(*) AS c, MAX(ingested_at) AS last FROM import_ingest_log WHERE repository_id = ? GROUP BY status", [repoId]);
  var out = { ingested: 0, errors: 0, lastRun: null };
  rows.forEach(function (r) { if (r.status === 'ingested') out.ingested = Number(r.c) || 0; if (r.status === 'error') out.errors = Number(r.c) || 0; if (r.last && (!out.lastRun || r.last > out.lastRun)) out.lastRun = r.last; });
  return out;
}
function pad2(n){ return String(n).length<2 ? '0'+n : String(n); }
async function tick(){
  var now = new Date();
  var hour = now.getHours(); // server local time
  var today = now.getFullYear() + '-' + pad2(now.getMonth()+1) + '-' + pad2(now.getDate());
  var repos = await db.all("SELECT * FROM record_repositories WHERE connector_type = 'import' AND status = 'active'");
  for (var i=0;i<repos.length;i++){
    var cfg = parseCfg(repos[i]);
    if (cfg.schedule !== 'daily') continue;
    var schedHour = parseInt(cfg.hour, 10); if (isNaN(schedHour)) schedHour = 2;
    if (hour !== schedHour) continue;
    var mkKey = 'import_sched_last_' + repos[i].id;
    var mk = await db.get("SELECT value FROM system_config WHERE key = ?", [mkKey]);
    if (mk && mk.value === today) continue; // already ran today
    try {
      var r = await runIngest(repos[i].id);
      await db.run("INSERT INTO system_config (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [mkKey, today]);
      console.log('[importScheduler] daily ingest "' + repos[i].name + '":', JSON.stringify(r));
    } catch(e){ console.error('[importScheduler]', repos[i].name, e && e.message); }
  }
}
async function tickWatch(){
  var repos = await db.all("SELECT * FROM record_repositories WHERE connector_type = 'import' AND status = 'active'");
  for (var i=0;i<repos.length;i++){
    var wcfg = parseCfg(repos[i]);
    if (wcfg.schedule !== 'watch') continue;
    try { await runIngest(repos[i].id, { settleMs: 15000 }); } catch(e){ console.error('[importWatch]', repos[i].name, e && e.message); }
  }
}
function startScheduler(){
  // hourly tick; a daily import source runs once at its configured hour (server local time)
  setInterval(function(){ tick().catch(function(e){ console.error('[importScheduler tick]', e && e.message); }); }, 3600000);
  // watch tick every 90s; watch sources ingest settled new files as they arrive (15s settle)
  setInterval(function(){ tickWatch().catch(function(e){ console.error('[importWatch tick]', e && e.message); }); }, 90000);
  setTimeout(function(){ tick().catch(function(e){ console.error('[importScheduler boot]', e && e.message); }); }, 120000); // catch-up shortly after boot
}

module.exports = { runIngest: runIngest, status: status, discoverNew: discoverNew, ensureTable: ensureTable, startScheduler: startScheduler };
