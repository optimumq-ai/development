// Mass-redaction background worker. A durable, resumable, chunked queue: each job carries a list of
// target files, a per-run chunk size, and a processing window. A tick() fires periodically; when the
// clock is inside the after-hours window and the shared nightly budget has room, it advances each job
// (in priority then FIFO order) by a chunk, reusing the SAME drift-check + apply logic as the
// synchronous batch. Jobs resume from a cursor, so stopping/restarting is the normal mode.
const { all, get, run } = require('../db');
const docProcessing = require('./docProcessing');
const structuredRedaction = require('./structuredRedaction');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function today() { return new Date().toISOString().slice(0, 10); }
async function getConfig(key, def) { var r = await get("SELECT value FROM system_config WHERE key = ?", [key]); return (r && r.value != null) ? r.value : def; }

function toMin(hhmm) { var p = String(hhmm || '').split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); }
function withinWindow(startStr, endStr) {
  var d = new Date(); var now = d.getHours() * 60 + d.getMinutes();
  var s = toMin(startStr), e = toMin(endStr);
  if (s === e) return true;            // 24h
  if (s < e) return now >= s && now < e;
  return now >= s || now < e;          // overnight wrap
}
async function budgetUsed(day) { var r = await get("SELECT used FROM mass_job_budget WHERE day = ?", [day]); return (r && r.used) || 0; }
async function addBudget(day, n) {
  await run("INSERT INTO mass_job_budget (day, used) VALUES (?,?) ON CONFLICT (day) DO UPDATE SET used = mass_job_budget.used + ?", [day, n, n]);
}
function mergeErrLog(existing, errs) {
  var arr = []; try { arr = JSON.parse(existing || '[]'); } catch (e) { arr = []; }
  arr = arr.concat(errs || []); if (arr.length > 25) arr = arr.slice(arr.length - 25);
  return JSON.stringify(arr);
}

async function processChunk(job, take, actor, actorSub) {
  var engine = require('../routes/redactionTemplates').engine;
  var res = { processed: 0, redacted: 0, held: 0, errors: 0, errs: [] };
  var fileIds = []; try { fileIds = JSON.parse(job.file_ids || '[]'); } catch (e) {}
  var template = await get('SELECT * FROM layout_profiles WHERE id = ?', [job.template_id]);
  if (!template) throw new Error('template missing');
  var zones = engine.parseZones(template);
  var fieldMap = engine.parseFieldMap(template);
  var fcols = engine.fpColumns(template.layout_fingerprint) || [];
  var threshold = template.safety_threshold != null ? template.safety_threshold : 80;
  var start = job.processed_items;
  for (var i = start; i < start + take && i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var file = await get('SELECT * FROM request_files WHERE id = ?', [fid]);
      if (!file) { res.errors++; res.errs.push({ file_id: fid, error: 'file not found' }); res.processed++; continue; }
      if (job.kind === 'fields') {
        var fsc = await engine.fieldsScore(fcols, fid);
        if (fsc.score != null && fsc.score < threshold) res.held++;
        else { await structuredRedaction.applyFieldMap(fid, fieldMap, actor, actorSub); res.redacted++; }
      } else {
        var pc = await get('SELECT count(*) AS c FROM document_pages WHERE file_id = ?', [fid]);
        if (!pc || !pc.c) await docProcessing.processFile(fid);
        var s = await engine.safetyScore(template, fid);
        if (s.score != null && s.score < threshold) res.held++;
        else { await engine.applyTemplateToFile(template, file, zones, actor, actorSub); res.redacted++; }
      }
    } catch (e) { res.errors++; res.errs.push({ file_id: fid, error: e.message }); }
    res.processed++;
  }
  return res;
}

var ticking = false;
async function tick(opts) {
  opts = opts || {};
  if (ticking && !opts.force) return { ran: false, reason: 'already running' };
  ticking = true;
  try {
    var force = !!opts.force, onlyJob = opts.jobId || null;
    var afterHours = (await getConfig('mass_redaction_after_hours_only', 'true')) === 'true';
    var ws = await getConfig('mass_redaction_window_start', '18:00');
    var we = await getConfig('mass_redaction_window_end', '06:00');
    if (!force && afterHours && !withinWindow(ws, we)) return { ran: false, reason: 'outside processing window' };
    var budget = parseInt(await getConfig('mass_redaction_nightly_budget', '500'), 10) || 500;
    var day = today();
    var remaining = budget - (await budgetUsed(day));
    if (!force && remaining <= 0) return { ran: false, reason: 'nightly budget exhausted' };

    var jobs = onlyJob
      ? await all("SELECT * FROM mass_redaction_jobs WHERE id = ? AND status IN ('queued','running')", [onlyJob])
      : await all("SELECT * FROM mass_redaction_jobs WHERE status IN ('queued','running') ORDER BY priority ASC, created_at ASC");
    var touched = [], totalProcessed = 0;
    for (var j = 0; j < jobs.length; j++) {
      var job = jobs[j];
      var cap = force ? job.chunk_size : Math.min(job.chunk_size, remaining);
      if (cap <= 0) break;
      var take = Math.min(cap, job.total_items - job.processed_items);
      if (take <= 0) { await run("UPDATE mass_redaction_jobs SET status='completed', updated_at=? WHERE id=?", [nowStr(), job.id]); continue; }
      await run("UPDATE mass_redaction_jobs SET status='running', updated_at=? WHERE id=?", [nowStr(), job.id]);
      var r = await processChunk(job, take, opts.actor || 'Scheduled Batch', opts.actorSub || null);
      var newProcessed = job.processed_items + r.processed;
      var done = newProcessed >= job.total_items;
      await run("UPDATE mass_redaction_jobs SET processed_items=?, redacted_count=redacted_count+?, held_count=held_count+?, error_count=error_count+?, status=?, error_log=?, last_run_at=?, updated_at=? WHERE id=?",
        [newProcessed, r.redacted, r.held, r.errors, done ? 'completed' : 'running', mergeErrLog(job.error_log, r.errs), nowStr(), nowStr(), job.id]);
      await addBudget(day, r.processed);
      totalProcessed += r.processed; remaining -= r.processed;
      touched.push({ id: job.id, processed: r.processed, redacted: r.redacted, held: r.held, errors: r.errors, done: done });
      if (!force && remaining <= 0) break;
    }
    return { ran: true, processed: totalProcessed, jobs: touched };
  } catch (e) { console.error('[massJobs tick]', e.message); return { ran: false, error: e.message }; }
  finally { ticking = false; }
}

function startWorker() {
  setInterval(function () { tick({}).catch(function (e) { console.error('[massJobs worker]', e.message); }); }, 60000);
  console.log('[massJobs] background worker started (tick every 60s)');
}

module.exports = { tick: tick, startWorker: startWorker, withinWindow: withinWindow };
