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

var UPLOAD_DIR = path.join(__dirname, '../../../uploads');
var ALLOWED = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.tiff', '.txt', '.csv'];
var MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tiff': 'image/tiff', '.txt': 'text/plain', '.csv': 'text/csv', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

async function ensureTable() {
  await db.run("CREATE TABLE IF NOT EXISTS import_ingest_log (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, file_key TEXT NOT NULL, original_name TEXT, request_file_id TEXT, status TEXT, detail TEXT, ingested_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')))");
  await db.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_import_ingest ON import_ingest_log (repository_id, file_key)");
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

async function discoverNew(repo) {
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
    try { var st = fs.statSync(full); if (!st.isFile()) return; var key = fileKey(f, st); if (!seenSet[key]) out.push({ full: full, name: f, key: key, size: st.size }); } catch (e) { /* skip */ }
  });
  return { files: out, scanned: entries.length };
}

async function runIngest(repoId) {
  var repo = await db.get("SELECT * FROM record_repositories WHERE id = ?", [repoId]);
  if (!repo) return { error: 'Source not found.' };
  if (repo.connector_type !== 'import') return { error: 'This source is not an Import source.' };
  var disc = await discoverNew(repo);
  if (disc.error) return { error: disc.error };
  var reqId = await ensureIngestRequest(repo);
  var ingested = 0, errors = 0;
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
      ingested++;
    } catch (e) {
      errors++;
      try { await db.run("INSERT INTO import_ingest_log (id, repository_id, file_key, original_name, status, detail) VALUES (?,?,?,?, 'error', ?) ON CONFLICT (repository_id, file_key) DO UPDATE SET status='error', detail=EXCLUDED.detail", [uuidv4(), repo.id, f.key, f.name, String(e.message).slice(0, 300)]); } catch (ee) { /* ignore */ }
      console.error('[importIngest]', f.name, e.message);
    }
  }
  return { ingested: ingested, errors: errors, scanned: disc.scanned, newFound: disc.files.length };
}

async function status(repoId) {
  await ensureTable();
  var rows = await db.all("SELECT status, COUNT(*) AS c, MAX(ingested_at) AS last FROM import_ingest_log WHERE repository_id = ? GROUP BY status", [repoId]);
  var out = { ingested: 0, errors: 0, lastRun: null };
  rows.forEach(function (r) { if (r.status === 'ingested') out.ingested = Number(r.c) || 0; if (r.status === 'error') out.errors = Number(r.c) || 0; if (r.last && (!out.lastRun || r.last > out.lastRun)) out.lastRun = r.last; });
  return out;
}
module.exports = { runIngest: runIngest, status: status, discoverNew: discoverNew, ensureTable: ensureTable };
