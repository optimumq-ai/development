'use strict';
// 911 Call Management System (demo) - a synthetic CAD/dispatch source that demonstrates the real
// INCREMENTAL-PULL pattern: the 911 system accumulates call records in its OWN store (demo_911_calls),
// and Optimum Q pulls only what is NEW since a stored watermark (checkpoint), then runs the delta
// through born-redacted structured mass-redaction into the public-ready library + map. This is the
// same seam a real connector uses - swap demo_911_calls for a live pull (API) or a watched export drop.
var fs = require('fs');
var path = require('path');
var db = require('../../db');
var uuidv4 = require('uuid').v4;

var UPLOAD_DIR = path.join(__dirname, '../../../../uploads');
var COLUMNS = ['call_id', 'call_type', 'priority', 'received_at', 'caller_name', 'caller_phone', 'caller_address', 'incident_location', 'responding_units', 'disposition', 'narrative'];
var EXEMPT = ['caller_name', 'caller_phone', 'caller_address'];
var RT_ID = 'rt-911-calls', REPO_ID = 'repo-911-demo', SYSREQ_ID = 'req-911-proactive', TMPL_ID = 'tmpl-911-fields';
var WATERMARK_KEY = 'nena911_watermark';

var CALL_TYPES = ['Medical Emergency', 'Traffic Accident', 'Burglary Alarm', 'Noise Complaint', 'Welfare Check', 'Suspicious Person', 'Fire Alarm', 'Domestic Disturbance', 'Theft in Progress', 'Vandalism', 'Reckless Driver', 'Trespassing'];
var STREETS = ['Oak Creek Dr', 'Cedar St', 'Commerce Blvd', 'Industrial Pkwy', 'Maple Ave', 'Elm St', 'Pine Ridge Rd', 'Main St', 'Highland Ave', 'Willow Ln', 'Sycamore Ct', 'Birch Way'];
var FIRST = ['James', 'Maria', 'Robert', 'Linda', 'David', 'Sarah', 'Michael', 'Jennifer', 'William', 'Patricia', 'Ahmed', 'Wei', 'Sofia', 'Omar'];
var LAST = ['Nguyen', 'Garcia', 'Smith', 'Johnson', 'Okafor', 'Patel', 'Reyes', 'Bianchi', 'Lindqvist', 'Tran', 'Cohen', 'Murphy'];
var UNITS = ['PD-12', 'PD-7', 'EMS-3', 'ENG-4', 'PD-21', 'EMS-1', 'PD-9', 'ENG-2'];
var DISPO = ['Report Taken', 'Cleared - No Action', 'Arrest Made', 'Referred to Detective', 'Transported to Hospital', 'Gone on Arrival', 'Citation Issued'];
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function csvCell(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

function makeCall() {
  var now = Date.now() - rint(0, 36) * 3600 * 1000;
  var dt = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
  var type = pick(CALL_TYPES), loc = rint(100, 4999) + ' ' + pick(STREETS);
  return {
    call_id: 'CAD-' + rint(2024, 2026) + '-' + rint(10000, 99999), call_type: type, priority: 'P' + rint(1, 3), received_at: dt,
    caller_name: pick(FIRST) + ' ' + pick(LAST), caller_phone: '(214) 555-' + String(rint(1000, 9999)), caller_address: rint(100, 4999) + ' ' + pick(STREETS),
    incident_location: loc, responding_units: pick(UNITS) + (Math.random() < 0.4 ? ', ' + pick(UNITS) : ''), disposition: pick(DISPO),
    narrative: 'Units dispatched to a reported ' + type.toLowerCase() + ' at ' + loc + '. ' + pick(['Situation resolved on scene.', 'Parties advised.', 'Follow-up report filed.', 'Scene secured; no further action.'])
  };
}
function csvFor(call) { return COLUMNS.join(',') + '\n' + COLUMNS.map(function (c) { return csvCell(call[c]); }).join(',') + '\n'; }

async function ensureSetup() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  await db.run("CREATE TABLE IF NOT EXISTS demo_911_calls (seq BIGSERIAL PRIMARY KEY, call_id TEXT, call_type TEXT, priority TEXT, received_at TEXT, caller_name TEXT, caller_phone TEXT, caller_address TEXT, incident_location TEXT, responding_units TEXT, disposition TEXT, narrative TEXT, created_at TEXT, pulled INTEGER DEFAULT 0)");
  var cat = await db.get("SELECT id FROM categories WHERE LOWER(name) LIKE '%public safety%' OR LOWER(name) LIKE '%police%' OR LOWER(name) LIKE '%law%' LIMIT 1");
  if (!cat) cat = await db.get("SELECT id FROM categories LIMIT 1");
  await db.run("INSERT INTO record_types (id, category_id, name, code, description, status, auto_publish, mappable, is_structured_data, fulfillment_method, medium, public_availability) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING",
    [RT_ID, cat && cat.id, '911 Call Records', 'CAD-911', 'Computer-aided dispatch (911) call records. Caller identifying information is withheld; the incident type, location, time, and disposition are public.', 'active', 1, 1, 1, 'electronic_search', 'electronic', 'redacted']);
  await db.run("INSERT INTO record_repositories (id, name, connector_type, status, config, sort_order) VALUES (?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING",
    [REPO_ID, '911 Call Management System (demo)', 'nena911', 'active', JSON.stringify({ note: 'Synthetic CAD/dispatch emulator', integration: 'incremental-pull' }), 60]);
  var rq = await db.get("SELECT id FROM requests WHERE id = ?", [SYSREQ_ID]);
  if (!rq) await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, classification, department_id, record_type_id, stage, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))",
    [SYSREQ_ID, 'SYS-911-PROACTIVE', 'Proactive Disclosure', 'system@optimumq.ai', 'Standing proactive-disclosure batch for 911 call records.', 'standard', 'dept-police', RT_ID, 'delivery', 'active']);
  var fieldMap = EXEMPT.map(function (f) { return { field: f, rule_id: null }; });
  await db.run("INSERT INTO layout_profiles (id, name, record_type_id, kind, field_map, layout_fingerprint, safety_threshold, zones) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING",
    [TMPL_ID, '911 Caller PII (born-redacted)', RT_ID, 'fields', JSON.stringify(fieldMap), JSON.stringify({ kind: 'fields', columns: COLUMNS }), 60, '[]']);
  return { recordType: RT_ID, source: REPO_ID, systemRequest: SYSREQ_ID, template: TMPL_ID };
}

// The 911 SYSTEM logs n new calls into its own store. Optimum Q has not seen these yet.
async function generateIntoSource(n) {
  await ensureSetup();
  n = n || 20;
  for (var i = 0; i < n; i++) {
    var c = makeCall();
    await db.run("INSERT INTO demo_911_calls (call_id, call_type, priority, received_at, caller_name, caller_phone, caller_address, incident_location, responding_units, disposition, narrative, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [c.call_id, c.call_type, c.priority, c.received_at, c.caller_name, c.caller_phone, c.caller_address, c.incident_location, c.responding_units, c.disposition, c.narrative, nowStr()]);
  }
  return { added: n };
}
async function watermark() { var r = await db.get("SELECT value FROM system_config WHERE key = ?", [WATERMARK_KEY]); return Number(r && r.value) || 0; }
async function setWatermark(seq) { await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = ?", [WATERMARK_KEY, String(seq), String(seq)]); }

// Discover records NEW since the last checkpoint - the incremental-pull query.
async function discoverNew() {
  await ensureSetup();
  var wm = await watermark();
  var rows = await db.all("SELECT * FROM demo_911_calls WHERE seq > ? ORDER BY seq ASC", [wm]);
  var total = await db.get("SELECT COUNT(*) AS c, COALESCE(MAX(seq),0) AS mx FROM demo_911_calls");
  return { newCount: rows.length, calls: rows, watermark: wm, sourceTotal: Number(total.c) || 0, maxSeq: Number(total.mx) || 0 };
}

// Materialize a set of source calls as CSV request_files + a mass-redaction job.
async function materializeCalls(calls) {
  var fileIds = [];
  for (var i = 0; i < calls.length; i++) {
    var c = calls[i], fid = 'f911-' + uuidv4(), fname = fid + '.csv', body = csvFor(c);
    fs.writeFileSync(path.join(UPLOAD_DIR, fname), body, 'utf8');
    await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
      [fid, SYSREQ_ID, fname, c.call_id + '.csv', 'text/csv', Buffer.byteLength(body), 'attached', '911 Emulator']);
    fileIds.push(fid);
  }
  var jobId = 'mj911-' + uuidv4();
  await db.run("INSERT INTO mass_redaction_jobs (id, name, template_id, kind, file_ids, total_items, chunk_size, window_start, window_end, priority, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'queued', ?, datetime('now'), datetime('now'))",
    [jobId, '911 Call Records - ' + new Date().toISOString().slice(0, 10), TMPL_ID, 'fields', JSON.stringify(fileIds), calls.length, 100, '00:00', '23:59', 5, '911 Emulator']);
  return { jobId: jobId, fileIds: fileIds };
}

// Deterministic 911 enrichment (title/summary + incident location for the map), then geocode + re-embed.
async function enrich911(fileIds) {
  var fs2 = require('fs'), path2 = require('path'), geo = require('../geocode'), ei = require('./../embedIndex'), done = 0;
  for (var i = 0; i < (fileIds || []).length; i++) {
    try {
      var src = fileIds[i];
      var fr = await db.get("SELECT f.id FROM fulfilled_records f WHERE f.source_file_id = ? ORDER BY f.released_at DESC LIMIT 1", [src]);
      if (!fr) continue;
      var srcRf = await db.get("SELECT filename FROM request_files WHERE id = ?", [src]);
      var c = parseRow(fs2.readFileSync(path2.join(UPLOAD_DIR, srcRf.filename), 'utf8'));
      if (!c) continue;
      var dateStr = (c.received_at || '').slice(0, 10);
      var title = c.call_type + ' - ' + c.incident_location + (dateStr ? ' (' + dateStr + ')' : '');
      var summary = 'A ' + String(c.call_type || '').toLowerCase() + ' 911 call' + (dateStr ? ' received ' + dateStr : '') + ', at ' + c.incident_location + '. Disposition: ' + c.disposition + '. Responding units: ' + c.responding_units + '. Caller identifying information has been withheld.';
      await db.run("UPDATE fulfilled_records SET title = ?, summary = ?, keywords = ?, geo_address = ? WHERE id = ?", [title, summary, [c.call_type, c.incident_location, '911', 'CAD', c.disposition].filter(Boolean).join(', '), c.incident_location, fr.id]);
      try { await geo.geocodeRecord({ id: fr.id, title: title, summary: summary, geo_address: c.incident_location }); } catch (eg) {}
      try { await ei.reindexFulfilledRecord(fr.id); } catch (ee) {}
      done++;
    } catch (e) { console.error('[enrich911]', e && e.message); }
  }
  return done;
}
function parseRow(text) {
  var lines = String(text || '').trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  function split(line) { var out = [], cur = '', q = false; for (var i = 0; i < line.length; i++) { var c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }
  var h = split(lines[0]), v = split(lines[1]), o = {}; h.forEach(function (k, i) { o[k.trim()] = (v[i] || '').trim(); }); return o;
}

// Pull everything new since the checkpoint, run it through the pipeline, advance the watermark.
async function pullAndProcess() {
  var massJobs = require('../massJobs');
  var d = await discoverNew();
  if (!d.newCount) return { pulled: 0, redacted: 0, enriched: 0, sourceTotal: d.sourceTotal };
  var mat = await materializeCalls(d.calls);
  var tick = await massJobs.tick({ force: true, onlyJob: mat.jobId });
  var jr = (tick.jobs || []).find(function (j) { return j.id === mat.jobId; }) || {};
  var enriched = await enrich911(mat.fileIds);
  var maxSeq = d.calls[d.calls.length - 1].seq;
  await db.run("UPDATE demo_911_calls SET pulled = 1 WHERE seq <= ?", [maxSeq]);
  await setWatermark(maxSeq);
  return { pulled: d.newCount, redacted: jr.redacted || 0, held: jr.held || 0, errors: jr.errors || 0, enriched: enriched, sourceTotal: d.sourceTotal, jobId: mat.jobId };
}

// One-click demo: the 911 system logs n calls, then Optimum Q pulls + processes the new delta.
async function runNow(n) { await generateIntoSource(n || 20); return pullAndProcess(); }

var SCHED_STARTED = false;
async function startScheduler() {
  if (SCHED_STARTED) return; SCHED_STARTED = true;
  async function check() {
    try {
      var en = await db.get("SELECT value FROM system_config WHERE key = 'nena911_daily_enabled'");
      if (en && en.value === '0') return;
      var today = new Date().toISOString().slice(0, 10);
      var last = await db.get("SELECT value FROM system_config WHERE key = 'nena911_last_gen_day'");
      if (last && last.value === today) return;
      var r = await runNow(20);
      await db.run("INSERT INTO system_config (key, value) VALUES ('nena911_last_gen_day', ?) ON CONFLICT (key) DO UPDATE SET value = ?", [today, today]);
      console.log('[nena911] daily batch:', JSON.stringify(r));
    } catch (e) { console.error('[nena911 sched]', e && e.message); }
  }
  setInterval(check, 60 * 60 * 1000);
  setTimeout(check, 20000);
}

function search() { return []; }
module.exports = { ensureSetup: ensureSetup, generateIntoSource: generateIntoSource, discoverNew: discoverNew, pullAndProcess: pullAndProcess, runNow: runNow, enrich911: enrich911, startScheduler: startScheduler, search: search, COLUMNS: COLUMNS, EXEMPT: EXEMPT, IDS: { RT_ID: RT_ID, REPO_ID: REPO_ID, SYSREQ_ID: SYSREQ_ID, TMPL_ID: TMPL_ID } };
