'use strict';
// Effective-dated configuration. An approved change can either apply now or be SCHEDULED for a future
// effective date. A nightly promotion applies any scheduled change whose effective date has arrived.
// Every apply (immediate or promoted) snapshots the resulting config into config_history with an
// effective window, so we can answer "what configuration was in effect on date X?" for defensibility.
// Optimum Q never tracks the law - the agency brings the approved document and sets the effective date.
var { all, get, run } = require('../db');
var CE = require('./configExtractors');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function today() { return new Date().toISOString().slice(0, 10); }
function uid(pfx) { return (pfx || 'scc') + '-' + require('uuid').v4().slice(0, 8); }

// Snapshot the CURRENT live config for a domain into history, closing the prior open window.
async function recordHistory(jid, domain, summary, effectiveFrom, source) {
  var ad = CE.adapter(domain);
  if (!ad || ad.applyMode !== 'live') return; // only versioned (live) domains have a single current config
  var cur = {}; try { cur = await ad.current(jid); } catch (e) {}
  var from = effectiveFrom || today();
  await run("UPDATE config_history SET effective_to = ? WHERE jurisdiction_id = ? AND domain = ? AND effective_to IS NULL", [from, jid, domain]);
  await run("INSERT INTO config_history (id, jurisdiction_id, domain, config_json, summary, effective_from, effective_to, source, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [uid('ch'), jid, domain, JSON.stringify(cur || {}), summary || null, from, null, source || 'applied', nowStr()]);
}

// Seed a baseline history row for each live domain that has none yet (so date-X lookups have a floor).
async function seedBaselineHistory(jid) {
  if (!jid) return;
  var domains = ['fee', 'deadline', 'exemption'];
  for (var i = 0; i < domains.length; i++) {
    var d = domains[i];
    var existing = await get("SELECT id FROM config_history WHERE jurisdiction_id = ? AND domain = ? LIMIT 1", [jid, d]);
    if (!existing) { try { await recordHistory(jid, d, 'Baseline (configuration in effect when history began)', today(), 'initial'); } catch (e) {} }
  }
}

// Apply a config to its live store now, record history, and re-index the jurisdiction profile.
async function applyConfig(jid, domain, cfg, actor, source, summary) {
  var ad = CE.adapter(domain);
  if (!ad || !ad.apply) throw new Error('This area cannot be applied automatically.');
  var result = await ad.apply(jid, cfg, actor || 'system');
  try { if (ad.applyMode === 'live') await recordHistory(jid, domain, summary, today(), source || 'applied'); } catch (e) {}
  try { await require('./jurisdictionProfile').sync(jid, { source: source || 'auto-config', actor: actor }); } catch (e) {}
  return result;
}

// Schedule an approved change for a future effective date (does NOT touch live config now).
async function schedule(jid, domain, effectiveDate, cfg, opts) {
  opts = opts || {};
  if (!jid || !domain) throw new Error('Jurisdiction and area are required.');
  if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error('A valid effective date (YYYY-MM-DD) is required.');
  var id = uid('scc');
  await run("INSERT INTO scheduled_config_changes (id, jurisdiction_id, domain, effective_date, config_json, summary, source_ref, proposal_id, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?, 'scheduled', ?, ?)",
    [id, jid, domain, effectiveDate, JSON.stringify(cfg || {}), opts.summary || null, opts.sourceRef || null, opts.proposalId || null, opts.actor || 'staff', nowStr()]);
  return await get("SELECT * FROM scheduled_config_changes WHERE id = ?", [id]);
}

async function listScheduled(jid) {
  return await all("SELECT * FROM scheduled_config_changes WHERE jurisdiction_id = ? AND status = 'scheduled' ORDER BY effective_date ASC, created_at ASC", [jid]);
}

// Cancel a scheduled change before it lands; return its linked proposal to the review queue.
async function cancel(id, actor) {
  var row = await get("SELECT * FROM scheduled_config_changes WHERE id = ?", [id]);
  if (!row) throw new Error('Scheduled change not found.');
  if (row.status !== 'scheduled') throw new Error('This change is already ' + row.status + '.');
  await run("UPDATE scheduled_config_changes SET status = 'cancelled', cancelled_at = ?, cancelled_by = ? WHERE id = ?", [nowStr(), actor || 'staff', id]);
  if (row.proposal_id) { try { await run("UPDATE config_proposals SET status = 'pending' WHERE id = ? AND status = 'scheduled'", [row.proposal_id]); } catch (e) {} }
  return { cancelled: true };
}

// Apply every scheduled change whose effective date has arrived. Idempotent; safe to run often.
async function promoteDue(opts) {
  opts = opts || {};
  var due = await all("SELECT * FROM scheduled_config_changes WHERE status = 'scheduled' AND effective_date <= ? ORDER BY effective_date ASC, created_at ASC", [today()]);
  var promoted = 0, items = [];
  for (var i = 0; i < due.length; i++) {
    var sc = due[i];
    try {
      var cfg = {}; try { cfg = JSON.parse(sc.config_json || '{}'); } catch (e) { cfg = {}; }
      await applyConfig(sc.jurisdiction_id, sc.domain, cfg, 'scheduled-promotion', 'scheduled_promotion', sc.summary || ('Scheduled change effective ' + sc.effective_date));
      await run("UPDATE scheduled_config_changes SET status = 'applied', applied_at = ? WHERE id = ?", [nowStr(), sc.id]);
      if (sc.proposal_id) { try { await run("UPDATE config_proposals SET status = 'applied' WHERE id = ?", [sc.proposal_id]); } catch (e) {} }
      promoted++; items.push({ id: sc.id, domain: sc.domain, effectiveDate: sc.effective_date });
    } catch (e) { console.error('[effectiveConfig] promote failed for', sc.id, e && e.message); }
  }
  return { promoted: promoted, items: items, at: nowStr() };
}

function startPromotionScheduler() {
  setTimeout(function () { promoteDue({ trigger: 'startup' }).then(function (r) { if (r.promoted) console.log('[effectiveConfig] promoted', r.promoted, 'scheduled change(s) at startup'); }).catch(function (e) { console.error('[effectiveConfig]', e && e.message); }); }, 60000);
  setInterval(function () { promoteDue({ trigger: 'hourly' }).then(function (r) { if (r.promoted) console.log('[effectiveConfig] promoted', r.promoted, 'scheduled change(s)'); }).catch(function (e) { console.error('[effectiveConfig]', e && e.message); }); }, 3600000);
}

module.exports = { schedule: schedule, listScheduled: listScheduled, cancel: cancel, promoteDue: promoteDue, applyConfig: applyConfig, recordHistory: recordHistory, seedBaselineHistory: seedBaselineHistory, startPromotionScheduler: startPromotionScheduler, today: today };
