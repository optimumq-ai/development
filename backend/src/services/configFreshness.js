'use strict';
// Config freshness loop. On a cadence (and on demand) it:
//  - sends the periodic courtesy reminder (no external source is fetched or monitored),
//  - tallies what is PENDING REVIEW per rule-domain (redaction uses its own pending_review rows;
//    other domains use the generic config_proposals staging table),
//  - logs the run and sends a REMINDER email to the designated recipient REGARDLESS of whether
//    anything was found (the email says what, if anything, is pending).
// Nothing is ever applied automatically; staged proposals only take effect after human review + approval.
// NOTE (Slice A): the live source-FETCH + version-diff that actually populates proposals is a later slice;
// this slice builds the registry, staging, scheduler, reminder, and pending-visibility around a pluggable scan.
var { all, get, run } = require('../db');
var { v4: uuidv4 } = require('uuid');
var email = require('./email');
var CE = require('./configExtractors');

var DOMAINS = [
  { key: 'redaction', label: 'Redaction / exemption rules' },
  { key: 'fee',       label: 'Fee & cost schedule' },
  { key: 'deadline',  label: 'Response deadlines & tolling' },
  { key: 'exemption', label: 'Exemption model & appeals' },
  { key: 'taxonomy',  label: 'Record types & taxonomy' }
];

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
async function cfgVal(key) { try { var r = await get("SELECT value FROM system_config WHERE key = ?", [key]); return r ? r.value : null; } catch (e) { return null; } }
async function activeJurisdiction() { return (await cfgVal('jurisdiction_profile')) || null; }
async function cadenceDays() { var n = Number(await cfgVal('freshness_reminder_days')); if (!(isFinite(n) && n > 0)) { n = Number(await cfgVal('freshness_scan_days')); } return (isFinite(n) && n > 0) ? n : 182; }

async function pendingSummary(jid) {
  var out = [];
  for (var i = 0; i < DOMAINS.length; i++) {
    var d = DOMAINS[i], n = 0, row;
    if (d.key === 'redaction') {
      row = await get("SELECT COUNT(*) AS n FROM redaction_rules WHERE jurisdiction_id = ? AND approval_status = 'pending_review'", [jid]);
    } else {
      row = await get("SELECT COUNT(*) AS n FROM config_proposals WHERE jurisdiction_id = ? AND domain = ? AND status = 'pending'", [jid, d.key]);
    }
    n = row ? Number(row.n) : 0;
    out.push({ domain: d.key, label: d.label, pending: n });
  }
  return out;
}

async function runScan(opts) {
  // Sends the periodic courtesy reminder to the configured recipient and logs the send.
  // It does NOT fetch, check, or monitor any external source - the agency brings approved
  // documents itself; Optimum Q never tracks the law.
  opts = opts || {};
  var jid = await activeJurisdiction();
  var now = nowStr();
  var id = 'cfr-' + uuidv4().slice(0, 8);
  await run("INSERT INTO config_freshness_runs (id, trigger, jurisdiction_id, summary_json, emailed, created_at) VALUES (?,?,?,?,?,?)", [id, opts.trigger || 'manual', jid, JSON.stringify([]), 0, now]);
  var emailed = false, emailReason = null;
  try {
    var to = (await cfgVal('freshness_reminder_to')) || (await cfgVal('contact_email')) || 'admin@optimumq.ai';
    var jrow = jid ? await get("SELECT name FROM jurisdiction_profiles WHERE id = ?", [jid]) : null;
    var res = await email.sendFreshnessReminder({ jurisdiction: jrow ? jrow.name : null }, to);
    emailed = !!(res && res.sent); emailReason = res && res.reason;
    if (emailed) await run("UPDATE config_freshness_runs SET emailed = 1 WHERE id = ?", [id]);
  } catch (e) { console.error('[reminder] send failed:', e && e.message); emailReason = e && e.message; }
  return { jurisdiction: jid, emailed: emailed, emailReason: emailReason, runId: id, at: now };
}

async function maybeRun() {
  try {
    var last = await get("SELECT created_at FROM config_freshness_runs ORDER BY created_at DESC LIMIT 1");
    var days = await cadenceDays();
    if (last && last.created_at) {
      var lastMs = Date.parse(last.created_at.replace(' ', 'T') + 'Z');
      if (isFinite(lastMs) && (Date.now() - lastMs) < days * 86400000) return { skipped: true };
    }
    return await runScan({ trigger: 'scheduled' });
  } catch (e) { console.error('[configFreshness] maybeRun', e && e.message); return { error: e && e.message }; }
}

function startScheduler() {
  setTimeout(function () { maybeRun().then(function (r) { if (r && !r.skipped) console.log('[reminder] periodic reminder sent'); }).catch(function (e) { console.error('[configFreshness]', e && e.message); }); }, 90000);
  setInterval(function () { maybeRun().catch(function (e) { console.error('[configFreshness]', e && e.message); }); }, 86400000);
}

module.exports = { DOMAINS: DOMAINS, pendingSummary: pendingSummary, runScan: runScan, maybeRun: maybeRun, activeJurisdiction: activeJurisdiction, cadenceDays: cadenceDays, startScheduler: startScheduler };
