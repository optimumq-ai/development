// Per-request fee estimate API. Wires the deterministic engine onto a real request: loads the
// request's components (MRR master+children, or a master-of-one), prices them against the active
// jurisdiction's FR config using the supplied quantities (the manual/staff path for now; the
// automated projection ladder - profiles/sampling/known-page-counts - will later pre-fill these),
// persists an immutable feeContext snapshot, and updates the request's headline estimate.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');
const engine = require('../services/feeEngine');
const ep = require('../services/estimateProfile');
const email = require('../services/email');
const feeNotice = require('../services/feeNotice');
const emailTemplate = require('../services/emailTemplate');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
async function sysCfg(key, def) { var r = await get('SELECT value FROM system_config WHERE key = ?', [key]); return (r && r.value != null && r.value !== '') ? r.value : def; }
async function latestEstimate(requestId) { return await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [requestId]); }

// Projection ladder, rung 1: derive KNOWN page counts for a component (request/child id) from records
// already in hand - paginated attached documents + selected records that resolve to a page count.
// Where records are known, the page count is a fact, not an estimate (and search labor is ~0).
async function knownQuantities(componentId) {
  var att = await get('SELECT count(*) n, count(DISTINCT file_id) f FROM document_pages WHERE request_id = ?', [componentId]);
  var attachedPages = (att && Number(att.n)) || 0;
  var attachedFiles = (att && Number(att.f)) || 0;
  var sel = await all('SELECT s.record_id, dd.page_count AS pages FROM request_selected_records s LEFT JOIN demo_documents dd ON dd.id = s.record_id WHERE s.request_id = ?', [componentId]);
  var selectedPages = 0, selKnown = 0, selUnknown = 0;
  (sel || []).forEach(function (r) { if (r.pages != null) { selectedPages += Number(r.pages); selKnown++; } else { selUnknown++; } });
  var knownPages = attachedPages + selectedPages;
  var parts = [];
  if (attachedPages) parts.push(attachedPages + ' page' + (attachedPages === 1 ? '' : 's') + ' from ' + attachedFiles + ' attached document' + (attachedFiles === 1 ? '' : 's'));
  if (selKnown) parts.push(selectedPages + ' page' + (selectedPages === 1 ? '' : 's') + ' across ' + selKnown + ' selected record' + (selKnown === 1 ? '' : 's'));
  var basis = parts.join('; ');
  if (selUnknown) basis += (basis ? '; ' : '') + selUnknown + ' selected record' + (selUnknown === 1 ? '' : 's') + ' with no page count available (enter manually)';
  return { knownPages: knownPages, hasKnown: knownPages > 0, attachedPages: attachedPages, attachedFiles: attachedFiles, selectedPages: selectedPages, selectedUnknown: selUnknown, basis: basis };
}

async function activeJurisdiction() {
  var row = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  return (row && row.value) || 'jur-tx';
}
async function pickConfig(jid) {
  return await get("SELECT * FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR' ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC LIMIT 1", [jid]);
}

// A request becomes one-or-more fee components: MRR master -> its children (or master-of-one if no
// children exist yet); a plain request -> itself as a single component.
async function loadComponents(requestId) {
  var reqRow = await get('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!reqRow) return null;
  var rows;
  if (reqRow.is_mrr && !reqRow.master_request_id) {
    var kids = await all('SELECT * FROM requests WHERE master_request_id = ?', [requestId]);
    rows = (kids && kids.length) ? kids : [reqRow];
  } else {
    rows = [reqRow];
  }
  var comps = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rtName = null;
    if (r.record_type_id) { var rt = await get('SELECT name FROM record_types WHERE id = ?', [r.record_type_id]); rtName = rt && rt.name; }
    var label = (r.component_label && r.component_label.trim()) || rtName || (r.description ? r.description.slice(0, 40) : ('Request ' + (r.request_number || '')));
    comps.push({ id: r.id, label: label, recordType: r.record_type_id || null, recordTypeName: rtName });
  }
  return { request: reqRow, components: comps };
}

function hydrate(row) {
  if (!row) return null;
  try { row.feeContext = JSON.parse(row.fee_context_json || '{}'); } catch (e) { row.feeContext = {}; }
  try { row.input = JSON.parse(row.input_json || '{}'); } catch (e) { row.input = {}; }
  delete row.fee_context_json; delete row.input_json;
  return row;
}

// context for the estimate panel: components to price, the config that applies, and the latest snapshot
router.get('/request/:requestId', requireAuth, async function (req, res) {
  try {
    var loaded = await loadComponents(req.params.requestId);
    if (!loaded) return res.status(404).json({ error: 'Request not found.' });
    var jid = await activeJurisdiction();
    var cfg = await pickConfig(jid);
    var latest = await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [req.params.requestId]);
    for (var ci = 0; ci < loaded.components.length; ci++) {
      loaded.components[ci].suggested = await knownQuantities(loaded.components[ci].id);
      var rtid = loaded.components[ci].recordType;
      loaded.components[ci].autoEstimate = rtid ? await ep.assess(rtid, { jurisdictionId: jid }) : { decision: 'manual', confidence: 'none', reasons: ['No record type identified for this component.'] };
    }
    res.json({
      request: { id: loaded.request.id, number: loaded.request.request_number, isMrr: !!loaded.request.is_mrr },
      components: loaded.components,
      configProfile: cfg ? { id: cfg.id, name: cfg.name, status: cfg.status } : null,
      latest: hydrate(latest)
    });
  } catch (e) { res.status(500).json({ error: 'Could not load estimate context.' }); }
});

// compute + persist an estimate snapshot from supplied per-component quantities
router.post('/request/:requestId', requireAuth, async function (req, res) {
  try {
    var loaded = await loadComponents(req.params.requestId);
    if (!loaded) return res.status(404).json({ error: 'Request not found.' });
    var jid = await activeJurisdiction();
    var cfgRow = await pickConfig(jid);
    if (!cfgRow) return res.status(400).json({ error: 'No fee configuration exists for the active jurisdiction. Set one up under Fee Configuration first.' });
    var config = {}; try { config = JSON.parse(cfgRow.config_json || '{}'); } catch (e) { config = {}; }

    var b = req.body || {};
    var request = {
      components: (b.components || []).map(function (c) { return { id: c.id, label: c.label, recordType: c.recordType || null, quantities: c.quantities || {} }; }),
      delivery: b.delivery || { method: 'email' },
      certification: b.certification || null,
      other: b.other || null
    };
    var feeContext = engine.compute(config, request);
    var R = feeContext.requestLevel;

    var id = 'feeest-' + uuidv4().slice(0, 8);
    await run(
      'INSERT INTO request_fee_estimates (id, request_id, kind, config_profile_id, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.params.requestId, 'estimate', cfgRow.id, JSON.stringify(request), JSON.stringify(feeContext), R.total, R.depositDue, R.estimateNotifyTriggered ? 1 : 0, (req.user && req.user.name) || (req.user && req.user.sub) || 'system', nowStr()]
    );
    await run('UPDATE requests SET estimated_fee = ? WHERE id = ?', [R.total, req.params.requestId]);

    res.json({ estimate: { id: id, total: R.total, depositDue: R.depositDue, notify: R.estimateNotifyTriggered, feeContext: feeContext, configProfile: { id: cfgRow.id, name: cfgRow.name } } });
  } catch (e) { res.status(500).json({ error: 'Could not compute estimate: ' + (e && e.message) }); }
});

// build the requestor-facing notice (preview) from the latest saved estimate
router.get('/request/:requestId/notice', requireAuth, async function (req, res) {
  try {
    var reqRow = await get('SELECT id, request_number, requestor_name, requestor_email FROM requests WHERE id = ?', [req.params.requestId]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
    var snap = await latestEstimate(req.params.requestId);
    if (!snap) return res.status(400).json({ error: 'No saved estimate yet - calculate an estimate first.' });
    var feeContext = {}; try { feeContext = JSON.parse(snap.fee_context_json || '{}'); } catch (e) { feeContext = {}; }
    var agency = await sysCfg('agency_name', 'the City');
    var responseDays = null;
    if (snap.config_profile_id) { var prof = await get('SELECT config_json FROM fee_profiles WHERE id = ?', [snap.config_profile_id]); if (prof) { try { var cj = JSON.parse(prof.config_json || '{}'); responseDays = cj.estimatePolicy && cj.estimatePolicy.requesterResponseDays; } catch (e) {} } }
    var notice = feeNotice.buildNotice(reqRow, feeContext, { agencyName: agency, responseDays: responseDays });
    var R = feeContext.requestLevel || {};
    res.json({ to: reqRow.requestor_email || null, requestorName: reqRow.requestor_name || null, subject: notice.subject, text: notice.text, total: R.total || 0, depositDue: R.depositDue || 0, notifyTriggered: !!R.estimateNotifyTriggered, notifiedAt: snap.notified_at || null, notifiedTo: snap.notified_to || null });
  } catch (e) { res.status(500).json({ error: 'Could not build the notice.' }); }
});

// send the (staff-reviewed) notice to the requestor + record it on the snapshot
router.post('/request/:requestId/notice/send', requireAuth, async function (req, res) {
  try {
    var reqRow = await get('SELECT id, requestor_email FROM requests WHERE id = ?', [req.params.requestId]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
    var to = (req.body && req.body.to) || reqRow.requestor_email;
    if (!to) return res.status(400).json({ error: 'No requestor email address on this request.' });
    var snap = await latestEstimate(req.params.requestId);
    if (!snap) return res.status(400).json({ error: 'No saved estimate to send.' });
    var subject = (req.body && req.body.subject) || 'Cost estimate for your public records request';
    var text = (req.body && req.body.text) || '';
    if (!text.trim()) return res.status(400).json({ error: 'The notice body is empty.' });
    var agencyName = await sysCfg('agency_name', 'Open Records');
    var html = emailTemplate.wrap({ agencyName: agencyName, contentHtml: emailTemplate.textToHtml(text) });
    var result = await email.send({ to: to, subject: subject, text: text, html: html });
    var ok = !!(result && result.sent);
    var now = nowStr();
    if (ok) await run('UPDATE request_fee_estimates SET notified_at = ?, notified_to = ? WHERE id = ?', [now, to, snap.id]);
    res.json({ sent: ok, provider: result && result.provider, to: to, at: ok ? now : null, note: ok ? null : 'Email provider did not confirm send.' });
  } catch (e) { res.status(502).json({ error: 'Send failed: ' + (e && e.message ? e.message : 'unknown error') }); }
});

module.exports = router;
