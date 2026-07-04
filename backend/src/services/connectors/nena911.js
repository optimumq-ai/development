'use strict';
// 911 Call Management System (demo) - a synthetic CAD/dispatch source. Generates call records as
// structured CSV files that flow through the STRUCTURED (born-redacted) mass-redaction path: the
// caller's identifying fields are DROPPED (never written to the cleared copy) while the incident
// (type, location, time, disposition) stays public. The cleared record then deposits to the
// public-ready library, publishes, indexes, and geocodes the INCIDENT location for the map.
var fs = require('fs');
var path = require('path');
var db = require('../../db');
var uuidv4 = require('uuid').v4;

var UPLOAD_DIR = path.join(__dirname, '../../../../uploads');
var COLUMNS = ['call_id', 'call_type', 'priority', 'received_at', 'caller_name', 'caller_phone', 'caller_address', 'incident_location', 'responding_units', 'disposition', 'narrative'];
var EXEMPT = ['caller_name', 'caller_phone', 'caller_address'];

var RT_ID = 'rt-911-calls', REPO_ID = 'repo-911-demo', SYSREQ_ID = 'req-911-proactive', TMPL_ID = 'tmpl-911-fields';

var CALL_TYPES = ['Medical Emergency', 'Traffic Accident', 'Burglary Alarm', 'Noise Complaint', 'Welfare Check', 'Suspicious Person', 'Fire Alarm', 'Domestic Disturbance', 'Theft in Progress', 'Vandalism', 'Reckless Driver', 'Trespassing'];
var STREETS = ['Oak Creek Dr', 'Cedar St', 'Commerce Blvd', 'Industrial Pkwy', 'Maple Ave', 'Elm St', 'Pine Ridge Rd', 'Main St', 'Highland Ave', 'Willow Ln', 'Sycamore Ct', 'Birch Way'];
var FIRST = ['James', 'Maria', 'Robert', 'Linda', 'David', 'Sarah', 'Michael', 'Jennifer', 'William', 'Patricia', 'Ahmed', 'Wei', 'Sofia', 'Omar'];
var LAST = ['Nguyen', 'Garcia', 'Smith', 'Johnson', 'Okafor', 'Patel', 'Reyes', 'Bianchi', 'Lindqvist', 'Tran', 'Cohen', 'Murphy'];
var UNITS = ['PD-12', 'PD-7', 'EMS-3', 'ENG-4', 'PD-21', 'EMS-1', 'PD-9', 'ENG-2'];
var DISPO = ['Report Taken', 'Cleared - No Action', 'Arrest Made', 'Referred to Detective', 'Transported to Hospital', 'Gone on Arrival', 'Citation Issued'];
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function csvCell(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

function makeCall() {
  var now = Date.now() - rint(0, 36) * 3600 * 1000;
  var dt = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
  var yr = rint(2024, 2026);
  var num = rint(10000, 99999);
  var type = pick(CALL_TYPES);
  var loc = rint(100, 4999) + ' ' + pick(STREETS);
  var name = pick(FIRST) + ' ' + pick(LAST);
  return {
    call_id: 'CAD-' + yr + '-' + num,
    call_type: type,
    priority: 'P' + rint(1, 3),
    received_at: dt,
    caller_name: name,
    caller_phone: '(214) 555-' + String(rint(1000, 9999)),
    caller_address: rint(100, 4999) + ' ' + pick(STREETS),
    incident_location: loc,
    responding_units: pick(UNITS) + (Math.random() < 0.4 ? ', ' + pick(UNITS) : ''),
    disposition: pick(DISPO),
    narrative: 'Units dispatched to a reported ' + type.toLowerCase() + ' at ' + loc + '. ' + pick(['Situation resolved on scene.', 'Parties advised.', 'Follow-up report filed.', 'Scene secured; no further action.'])
  };
}
function csvFor(call) {
  var header = COLUMNS.join(',');
  var row = COLUMNS.map(function (c) { return csvCell(call[c]); }).join(',');
  return header + '\n' + row + '\n';
}

async function ensureSetup() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  var cat = await db.get("SELECT id FROM categories WHERE LOWER(name) LIKE '%public safety%' OR LOWER(name) LIKE '%police%' OR LOWER(name) LIKE '%law%' LIMIT 1");
  if (!cat) cat = await db.get("SELECT id FROM categories LIMIT 1");
  var catId = cat && cat.id;
  await db.run("INSERT INTO record_types (id, category_id, name, code, description, status, auto_publish, mappable, is_structured_data, fulfillment_method, medium, public_availability) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING",
    [RT_ID, catId, '911 Call Records', 'CAD-911', 'Computer-aided dispatch (911) call records. Caller identifying information is withheld; the incident type, location, time, and disposition are public.', 'active', 1, 1, 1, 'electronic_search', 'electronic', 'redacted']);
  await db.run("INSERT INTO record_repositories (id, name, connector_type, status, config, sort_order) VALUES (?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING",
    [REPO_ID, '911 Call Management System (demo)', 'nena911', 'active', JSON.stringify({ note: 'Synthetic CAD/dispatch emulator' }), 60]);
  var rq = await db.get("SELECT id FROM requests WHERE id = ?", [SYSREQ_ID]);
  if (!rq) {
    await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, classification, department_id, record_type_id, stage, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))",
      [SYSREQ_ID, 'SYS-911-PROACTIVE', 'Proactive Disclosure', 'system@optimumq.ai', 'Standing proactive-disclosure batch for 911 call records.', 'standard', null, RT_ID, 'delivery', 'active']);
  }
  var fieldMap = EXEMPT.map(function (f) { return { field: f, rule_id: null }; });
  var fingerprint = JSON.stringify({ kind: 'fields', columns: COLUMNS });
  await db.run("INSERT INTO layout_profiles (id, name, record_type_id, kind, field_map, layout_fingerprint, safety_threshold, zones) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING",
    [TMPL_ID, '911 Caller PII (born-redacted)', RT_ID, 'fields', JSON.stringify(fieldMap), fingerprint, 60, '[]']);
  return { recordType: RT_ID, source: REPO_ID, systemRequest: SYSREQ_ID, template: TMPL_ID };
}

// Generate n call records as CSV request_files, then queue a mass-redaction job over them.
async function generateBatch(n) {
  await ensureSetup();
  n = n || 20;
  var fileIds = [];
  for (var i = 0; i < n; i++) {
    var call = makeCall();
    var fid = 'f911-' + uuidv4();
    var fname = fid + '.csv';
    fs.writeFileSync(path.join(UPLOAD_DIR, fname), csvFor(call), 'utf8');
    var size = Buffer.byteLength(csvFor(call));
    await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
      [fid, SYSREQ_ID, fname, call.call_id + '.csv', 'text/csv', size, 'attached', '911 Emulator']);
    fileIds.push(fid);
  }
  var jobId = 'mj911-' + uuidv4();
  await db.run("INSERT INTO mass_redaction_jobs (id, name, template_id, kind, file_ids, total_items, chunk_size, window_start, window_end, priority, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'queued', ?, datetime('now'), datetime('now'))",
    [jobId, '911 Call Records - ' + new Date().toISOString().slice(0, 10), TMPL_ID, 'fields', JSON.stringify(fileIds), n, 100, '00:00', '23:59', 5, '911 Emulator']);
  return { jobId: jobId, fileIds: fileIds, count: n };
}

// Light connector interface (source appears under Sources; live search not the focus - public
// access comes through the born-redacted library). Returns [] so it never injects raw CAD into search.
function search() { return []; }

// Minimal one-row CSV parse (handles quoted fields).
function parseRow(text) {
  var lines = String(text || '').trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  function split(line) { var out = [], cur = '', q = false; for (var i = 0; i < line.length; i++) { var c = line[i]; if (c === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }
  var h = split(lines[0]), v = split(lines[1]), o = {};
  h.forEach(function (k, i) { o[k.trim()] = (v[i] || '').trim(); });
  return o;
}

// Deterministic 911 enrichment: set a real title/summary + use the INCIDENT location (public) as the
// map address, then geocode + re-embed. Runs AFTER the born-redaction deposit, overriding the generic
// metadata step (which cannot infer good fields from a redacted structured record). Idempotent.
async function enrich911(fileIds) {
  var fs2 = require('fs'), path2 = require('path');
  var geo = require('../geocode'), ei = require('./../embedIndex');
  var done = 0;
  for (var i = 0; i < (fileIds || []).length; i++) {
    try {
      var src = fileIds[i];
      var fr = await db.get("SELECT f.id, rf.filename FROM fulfilled_records f JOIN request_files rf ON rf.id = f.source_file_id WHERE f.source_file_id = ? ORDER BY f.released_at DESC LIMIT 1", [src]);
      if (!fr) continue;
      var srcRf = await db.get("SELECT filename FROM request_files WHERE id = ?", [src]);
      var csv = fs2.readFileSync(path2.join(UPLOAD_DIR, srcRf.filename), 'utf8');
      var c = parseRow(csv);
      if (!c) continue;
      var dateStr = (c.received_at || '').slice(0, 10);
      var title = c.call_type + ' - ' + c.incident_location + (dateStr ? ' (' + dateStr + ')' : '');
      var summary = 'A ' + String(c.call_type || '').toLowerCase() + ' 911 call' + (dateStr ? ' received ' + dateStr : '') + ', at ' + c.incident_location + '. Disposition: ' + c.disposition + '. Responding units: ' + c.responding_units + '. Caller identifying information has been withheld.';
      var keywords = [c.call_type, c.incident_location, '911', 'CAD', c.disposition].filter(Boolean).join(', ');
      await db.run("UPDATE fulfilled_records SET title = ?, summary = ?, keywords = ?, geo_address = ? WHERE id = ?", [title, summary, keywords, c.incident_location, fr.id]);
      try { await geo.geocodeRecord({ id: fr.id, title: title, summary: summary, geo_address: c.incident_location }); } catch (eg) {}
      try { await ei.reindexFulfilledRecord(fr.id); } catch (ee) {}
      done++;
    } catch (e) { console.error('[enrich911]', e && e.message); }
  }
  return done;
}

// Full demo pipeline in one call: generate -> born-redact (force the mass tick) -> deposit/publish
// (automatic) -> deterministic 911 enrich (title/summary/geo) -> library + map. Returns a summary.
async function runNow(n) {
  var massJobs = require('../massJobs');
  var batch = await generateBatch(n || 20);
  var tick = await massJobs.tick({ force: true, onlyJob: batch.jobId });
  var jr = (tick.jobs || []).find(function (j) { return j.id === batch.jobId; }) || {};
  var enriched = await enrich911(batch.fileIds);
  return { generated: batch.count, redacted: jr.redacted || 0, held: jr.held || 0, errors: jr.errors || 0, enriched: enriched, jobId: batch.jobId };
}

var SCHED_STARTED = false;
// Daily automation: generate ~20 records/day and run them through the pipeline. Toggle via
// system_config nena911_daily_enabled ('0' to disable). Once-per-day guard survives restarts.
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

module.exports = { ensureSetup: ensureSetup, generateBatch: generateBatch, search: search, enrich911: enrich911, runNow: runNow, startScheduler: startScheduler, COLUMNS: COLUMNS, EXEMPT: EXEMPT, IDS: { RT_ID: RT_ID, REPO_ID: REPO_ID, SYSREQ_ID: SYSREQ_ID, TMPL_ID: TMPL_ID } };
