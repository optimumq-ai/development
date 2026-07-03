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
const pt = require('../services/paymentTiming');
const emailTemplate = require('../services/emailTemplate');
const enforcement = require('../services/enforcement');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
var taskRouting = require('../services/taskRouting');
async function hist(requestId, actor, action, details, stageFrom, stageTo) {
  try {
    await run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action, details, stage_from, stage_to, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ['rh-' + uuidv4().slice(0, 8), requestId, actor && actor.sub, (actor && actor.name) || (actor && actor.sub), action, details || null, stageFrom || null, stageTo || null, nowStr()]);
  } catch (e) { console.error('[estimate hist]', e.message); }
}

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

// Resolve the payment & delivery plan for a saved estimate snapshot: the snapshot's own config
// profile (fallback active), its paymentTiming block (or a derived default), and the snapshot total.
// Read-only; used to surface the plan (4a) and drive the accept-time stage gate (4b).
async function planForSnapshot(snap, extra) {
  var prof = (snap && snap.config_profile_id) ? await get('SELECT config_json FROM fee_profiles WHERE id = ?', [snap.config_profile_id]) : null;
  if (!prof) { prof = await pickConfig(await activeJurisdiction()); }
  var cfg = {}; try { cfg = JSON.parse((prof && prof.config_json) || '{}'); } catch (e) { cfg = {}; }
  var hasPT = !!(cfg.paymentTiming && Object.keys(cfg.paymentTiming).length);
  var ptCfg = hasPT ? cfg.paymentTiming : pt.deriveDefaultPaymentTiming(cfg);
  var total = (snap && snap.total != null) ? Number(snap.total) : 0;
  var plan = pt.resolvePaymentPlan(ptCfg, Object.assign({ estimateTotal: total }, extra || {}));
  return { plan: plan, source: hasPT ? 'profile' : 'derived' };
}

// Payment state (4e): effective total (reconciled actual if present, else the estimate), deposit +
// final paid to date, and the resulting balance / paid-in-full flag. Drives the release gate (4d).
async function paymentState(rid) {
  var est = await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [rid]);
  if (!est) return null;
  var recon = await get("SELECT total FROM request_fee_estimates WHERE request_id = ? AND kind = 'reconciliation' ORDER BY created_at DESC LIMIT 1", [rid]);
  var base = (recon && recon.total != null) ? Number(recon.total) : (Number(est.total) || 0);
  var credRow = await get("SELECT COALESCE(SUM(resolution_amount),0) AS credits FROM objections WHERE request_id = ? AND status = 'resolved' AND approval_status = 'approved' AND resolution_type IN ('reduction','waiver','write_off')", [rid]);
  var credits = Math.round((Number(credRow && credRow.credits) || 0) * 100) / 100;
  var effectiveTotal = Math.max(0, Math.round((base - credits) * 100) / 100);
  var bal = pt.computeBalance(effectiveTotal, est.deposit_paid_amount, est.final_paid_amount);
  return { effectiveTotal: bal.effectiveTotal, reconciled: !!recon, adjustments: credits, depositPaid: Number(est.deposit_paid_amount) || 0,
    finalPaid: Number(est.final_paid_amount) || 0, paid: bal.paid, balanceDue: bal.balanceDue, paidInFull: bal.paidInFull, estimateId: est.id };
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
    var actualRateDrivers = [], laborRates = {};
    try { var cfgObj = cfg ? JSON.parse(cfg.config_json || '{}') : {}; var lab = cfgObj.labor || {}; ['search','review','programming'].forEach(function (k) { if (lab[k]) { laborRates[k] = Number(lab[k].rate) || 0; if (lab[k].actualRate) actualRateDrivers.push(k); } }); } catch (e) {}
    var planCtx = latest ? await planForSnapshot(latest) : null;
    var payState = await paymentState(req.params.requestId);
    var paymentMode = 'internal'; try { var _pc = cfg ? JSON.parse(cfg.config_json || '{}') : {}; if (_pc.payment_mode === 'erp') paymentMode = 'erp'; } catch (e) {}
    res.json({
      request: { id: loaded.request.id, number: loaded.request.request_number, isMrr: !!loaded.request.is_mrr, purpose: loaded.request.purpose || 'standard' },
      components: loaded.components,
      configProfile: cfg ? { id: cfg.id, name: cfg.name, status: cfg.status } : null,
      actualRateDrivers: actualRateDrivers, laborRates: laborRates,
      latest: hydrate(latest),
      paymentPlan: planCtx ? planCtx.plan : null, paymentTimingSource: planCtx ? planCtx.source : null,
      paymentState: payState, paymentMode: paymentMode
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
      other: b.other || null,
      purpose: b.purpose || 'standard',
      rateOverrides: b.rateOverrides || {}
    };
    if (b.purpose) { try { await run("UPDATE requests SET purpose = ? WHERE id = ?", [b.purpose, req.params.requestId]); } catch (e) {} }
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
    var noticePlan = await planForSnapshot(snap);
    var notice = feeNotice.buildNotice(reqRow, feeContext, { agencyName: agency, responseDays: responseDays, paymentPlan: noticePlan.plan });
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
    var gate = await enforcement.checkSection(null, 'fees');
    if (!gate.ok) return res.status(409).json({ error: gate.reason, needsAttestation: true, section: 'fees', drift: !!gate.drift });
    var subject = (req.body && req.body.subject) || 'Cost estimate for your public records request';
    var text = (req.body && req.body.text) || '';
    if (!text.trim()) return res.status(400).json({ error: 'The notice body is empty.' });
    var agencyName = await sysCfg('agency_name', 'Open Records');
    var html = emailTemplate.wrap({ agencyName: agencyName, contentHtml: emailTemplate.textToHtml(text) });
    var result = await email.send({ to: to, subject: subject, text: text, html: html });
    var ok = !!(result && result.sent);
    var now = nowStr();
    if (ok) await run('UPDATE request_fee_estimates SET notified_at = ?, notified_to = ? WHERE id = ?', [now, to, snap.id]);
    if (ok) await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE request_id = ? AND type = 'estimate' AND status IN ('open','assigned','in_progress')", [req.params.requestId]);
    res.json({ sent: ok, provider: result && result.provider, to: to, at: ok ? now : null, note: ok ? null : 'Email provider did not confirm send.' });
  } catch (e) { res.status(502).json({ error: 'Send failed: ' + (e && e.message ? e.message : 'unknown error') }); }
});


// --- Estimate response lifecycle: accept / decline / deposit ---

// Record requestor ACCEPTANCE of the latest sent estimate. Deposit due -> awaiting_payment;
// otherwise -> record_search (which spawns the record-search task via the shared stage path).
router.post('/request/:requestId/estimate/accept', requireAuth, async function (req, res) {
  var rid = req.params.requestId;
  var reqRow = await get('SELECT id, stage FROM requests WHERE id = ?', [rid]);
  if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
  var snap = await latestEstimate(rid);
  if (!snap) return res.status(400).json({ error: 'No estimate to accept.' });
  if (!snap.notified_at) return res.status(400).json({ error: 'This estimate has not been sent to the requestor yet.' });
  if (snap.declined_at) return res.status(409).json({ error: 'This estimate was already declined.' });
  var now = nowStr();
  var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'system';
  await run('UPDATE request_fee_estimates SET accepted_at = ?, accepted_by = ? WHERE id = ?', [now, actor, snap.id]);
  var depositDue = Number(snap.deposit_due) || 0;
  var acceptPlan = (await planForSnapshot(snap)).plan;
  var newStage = pt.gateToStage(acceptPlan.gate);
  // Safety: never regress a request that previously required a deposit out of awaiting_payment.
  if (depositDue > 0 && newStage !== 'awaiting_payment') newStage = 'awaiting_payment';
  await run("UPDATE requests SET stage = ?, status = 'active', tickler_flag = NULL, tickler_flagged_at = NULL, updated_at = datetime('now') WHERE id = ?", [newStage, rid]);
  await hist(rid, req.user, 'ESTIMATE_ACCEPTED', depositDue > 0 ? ('Deposit of $' + depositDue.toFixed(2) + ' required before work begins.') : 'No deposit required; record search begins.', reqRow.stage, newStage);
  if (newStage === 'record_search') { try { await taskRouting.spawnForStage(rid, 'record_search', req.user && req.user.sub); } catch (e) {} }
  res.json({ accepted: true, depositDue: depositDue, stage: newStage });
});

// Record requestor DECLINE of the estimate.
router.post('/request/:requestId/estimate/decline', requireAuth, async function (req, res) {
  var rid = req.params.requestId;
  var snap = await latestEstimate(rid);
  if (!snap) return res.status(400).json({ error: 'No estimate to decline.' });
  if (snap.accepted_at) return res.status(409).json({ error: 'This estimate was already accepted.' });
  var reason = (req.body && req.body.reason) || null;
  await run('UPDATE request_fee_estimates SET declined_at = ?, declined_reason = ? WHERE id = ?', [nowStr(), reason, snap.id]);
  await run("UPDATE requests SET tickler_flag = NULL, tickler_flagged_at = NULL WHERE id = ?", [rid]);
  await hist(rid, req.user, 'ESTIMATE_DECLINED', reason || 'Requestor declined the cost estimate.', null, null);
  res.json({ declined: true });
});

// Record a DEPOSIT payment on an accepted estimate; begins record search.
router.post('/request/:requestId/deposit/record', requireAuth, async function (req, res) {
  var rid = req.params.requestId;
  var reqRow = await get('SELECT id, stage FROM requests WHERE id = ?', [rid]);
  if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
  var snap = await latestEstimate(rid);
  if (!snap) return res.status(400).json({ error: 'No estimate on this request.' });
  if (!snap.accepted_at) return res.status(400).json({ error: 'Record the requestor acceptance before logging a deposit.' });
  var amount = (req.body && req.body.amount != null) ? Number(req.body.amount) : (Number(snap.deposit_due) || 0);
  var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'system';
  await run('UPDATE request_fee_estimates SET deposit_paid_at = ?, deposit_paid_by = ?, deposit_paid_amount = ? WHERE id = ?', [nowStr(), actor, amount, snap.id]);
  await run("UPDATE requests SET stage = 'record_search', status = 'active', tickler_flag = NULL, tickler_flagged_at = NULL, updated_at = datetime('now') WHERE id = ?", [rid]);
  await hist(rid, req.user, 'DEPOSIT_RECORDED', 'Deposit of $' + amount.toFixed(2) + ' recorded; record search begins.', reqRow.stage, 'record_search');
  try { await taskRouting.spawnForStage(rid, 'record_search', req.user && req.user.sub); } catch (e) {}
  res.json({ recorded: true, amount: amount, stage: 'record_search' });
});

// Record a FINAL (balance) payment on a request's estimate (4e); used before release for pay-in-full bands.
router.post('/request/:requestId/final-payment/record', requireAuth, async function (req, res) {
  var rid = req.params.requestId;
  var reqRow = await get('SELECT id, stage FROM requests WHERE id = ?', [rid]);
  if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
  var est = await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [rid]);
  if (!est) return res.status(400).json({ error: 'No estimate on this request.' });
  var before = await paymentState(rid);
  var amount = (req.body && req.body.amount != null) ? Number(req.body.amount) : (before ? before.balanceDue : 0);
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a payment amount.' });
  var newFinal = (Number(est.final_paid_amount) || 0) + amount;
  var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'system';
  await run('UPDATE request_fee_estimates SET final_paid_at = ?, final_paid_by = ?, final_paid_amount = ? WHERE id = ?', [nowStr(), actor, newFinal, est.id]);
  var after = await paymentState(rid);
  await hist(rid, req.user, 'FINAL_PAYMENT_RECORDED', 'Payment of $' + amount.toFixed(2) + ' recorded; balance now $' + after.balanceDue.toFixed(2) + (after.paidInFull ? ' (paid in full).' : '.'), null, null);
  res.json({ recorded: true, amount: amount, paymentState: after });
});


// Reconcile ACTUAL quantities against the accepted estimate: compute variance, flag a revised notice when the
// cost rose more than the jurisdiction's revisionNotifyPercent, and write the actuals back into the record-type
// estimate profiles (Welford) so future auto-estimates get sharper.
router.post('/request/:requestId/reconcile', requireAuth, async function (req, res) {
  try {
    var rid = req.params.requestId;
    var loaded = await loadComponents(rid);
    if (!loaded) return res.status(404).json({ error: 'Request not found.' });
    var jid = await activeJurisdiction();
    var cfgRow = await pickConfig(jid);
    if (!cfgRow) return res.status(400).json({ error: 'No fee configuration for the active jurisdiction.' });
    var config = {}; try { config = JSON.parse(cfgRow.config_json || '{}'); } catch (e) { config = {}; }
    var b = req.body || {};
    var request = {
      components: (b.components || []).map(function (c) { return { id: c.id, label: c.label, recordType: c.recordType || null, quantities: c.quantities || {} }; }),
      delivery: b.delivery || { method: 'email' },
      other: b.other || null,
      purpose: b.purpose || 'standard',
      rateOverrides: b.rateOverrides || {}
    };
    if (b.purpose) { try { await run("UPDATE requests SET purpose = ? WHERE id = ?", [b.purpose, rid]); } catch (e) {} }
    var feeContext = engine.compute(config, request);
    var actualTotal = Number(feeContext.requestLevel.total) || 0;
    var base = await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [rid]);
    var estTotal = base ? (Number(base.total) || 0) : null;
    var pol = (config.estimatePolicy && typeof config.estimatePolicy.revisionNotifyPercent === 'number') ? config.estimatePolicy.revisionNotifyPercent : 20;
    var variancePct = (estTotal != null && estTotal > 0) ? Math.round(((actualTotal - estTotal) / estTotal) * 1000) / 10 : null;
    var reNotify = (variancePct != null && variancePct > pol);
    var updates = [];
    for (var i = 0; i < request.components.length; i++) {
      var c = request.components[i];
      if (c.recordType) { try { await ep.recordActuals(c.recordType, c.quantities); updates.push(c.recordType); } catch (e) {} }
    }
    var id = 'feerec-' + uuidv4().slice(0, 8);
    await run(
      'INSERT INTO request_fee_estimates (id, request_id, kind, config_profile_id, input_json, fee_context_json, total, deposit_due, notify_flag, baseline_total, variance_pct, renotify_required, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, rid, 'reconciliation', cfgRow.id, JSON.stringify(request), JSON.stringify(feeContext), actualTotal, 0, 0, estTotal, variancePct, reNotify ? 1 : 0, (req.user && req.user.name) || (req.user && req.user.sub) || 'system', nowStr()]
    );
    await hist(rid, req.user, 'ESTIMATE_RECONCILED', 'Actual $' + actualTotal.toFixed(2) + (estTotal != null ? (' vs estimate $' + estTotal.toFixed(2) + ' (' + (variancePct >= 0 ? '+' : '') + variancePct + '%)') : '') + (reNotify ? ' \u2014 revised notice required.' : ''), null, null);
    res.json({ actualTotal: actualTotal, estimateTotal: estTotal, variancePct: variancePct, reNotifyThreshold: pol, reNotifyRequired: reNotify, feeContext: feeContext, profilesUpdated: updates });
  } catch (e) { res.status(500).json({ error: 'Could not reconcile: ' + (e && e.message) }); }
});

// Balance-due notice preview (4d): records ready, pre-release balance remains. Staff review, then send
// via the existing /notice/send path. Payment instructions come from the jurisdiction profile config.
router.get('/request/:requestId/balance-notice', requireAuth, async function (req, res) {
  try {
    var reqRow = await get('SELECT id, request_number, requestor_name, requestor_email FROM requests WHERE id = ?', [req.params.requestId]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
    var state = await paymentState(req.params.requestId);
    if (!state) return res.status(400).json({ error: 'No estimate on this request.' });
    var agency = await sysCfg('agency_name', 'the City');
    var snap = await latestEstimate(req.params.requestId);
    var pi = null;
    if (snap && snap.config_profile_id) { var prof = await get('SELECT config_json FROM fee_profiles WHERE id = ?', [snap.config_profile_id]); if (prof) { try { pi = JSON.parse(prof.config_json || '{}').paymentInstructions || null; } catch (e) {} } }
    var notice = feeNotice.buildBalanceDueNotice(reqRow, state, { agencyName: agency, paymentInstructions: pi });
    res.json({ to: reqRow.requestor_email || null, requestorName: reqRow.requestor_name || null, subject: notice.subject, text: notice.text, balanceDue: state.balanceDue, paymentState: state });
  } catch (e) { res.status(500).json({ error: 'Could not build the balance-due notice.' }); }
});

// Cashiering (internal payment mode): record a mail-in / walk-in payment to the fee_payments ledger,
// update the estimate's paid amounts, and — for a deposit that clears awaiting_payment — advance the stage.
router.post('/request/:requestId/payment/record', requireAuth, async function (req, res) {
  try {
    var rid = req.params.requestId;
    var reqRow = await get('SELECT id, stage FROM requests WHERE id = ?', [rid]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
    var est = await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [rid]);
    if (!est) return res.status(400).json({ error: 'No estimate on this request.' });
    var b = req.body || {};
    var target = (b.target === 'deposit') ? 'deposit' : 'balance';
    var method = String(b.method || 'cash');
    var amount = Number(b.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter a payment amount greater than zero.' });
    var tendered = (b.tendered != null && b.tendered !== '') ? Number(b.tendered) : null;
    var changeGiven = (method === 'cash' && tendered != null) ? pt.computeChange(tendered, amount) : 0;
    var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'system';
    var today = nowStr().slice(0, 10);
    await run('INSERT INTO fee_payments (id, request_id, estimate_id, target, method, amount, tendered, change_given, reference, clerk, drawer_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ['feepay-' + uuidv4().slice(0, 8), rid, est.id, target, method, amount, tendered, changeGiven, b.reference || null, actor, today, nowStr()]);
    if (target === 'deposit') {
      var newDep = (Number(est.deposit_paid_amount) || 0) + amount;
      await run('UPDATE request_fee_estimates SET deposit_paid_at = ?, deposit_paid_by = ?, deposit_paid_amount = ? WHERE id = ?', [nowStr(), actor, newDep, est.id]);
      if (reqRow.stage === 'awaiting_payment') {
        await run("UPDATE requests SET stage = 'record_search', status = 'active', tickler_flag = NULL, tickler_flagged_at = NULL, updated_at = datetime('now') WHERE id = ?", [rid]);
        await hist(rid, req.user, 'DEPOSIT_RECORDED', 'Deposit of $' + amount.toFixed(2) + ' (' + method + ') recorded; record search begins.', reqRow.stage, 'record_search');
        try { await taskRouting.spawnForStage(rid, 'record_search', req.user && req.user.sub); } catch (e) {}
      } else {
        await hist(rid, req.user, 'DEPOSIT_RECORDED', 'Deposit of $' + amount.toFixed(2) + ' (' + method + ') recorded.', null, null);
      }
    } else {
      var newFinal = (Number(est.final_paid_amount) || 0) + amount;
      await run('UPDATE request_fee_estimates SET final_paid_at = ?, final_paid_by = ?, final_paid_amount = ? WHERE id = ?', [nowStr(), actor, newFinal, est.id]);
      var afterH = await paymentState(rid);
      await hist(rid, req.user, 'FINAL_PAYMENT_RECORDED', 'Payment of $' + amount.toFixed(2) + ' (' + method + ') recorded; balance now $' + afterH.balanceDue.toFixed(2) + (afterH.paidInFull ? ' (paid in full).' : '.'), null, null);
    }
    var after = await paymentState(rid);
    res.json({ recorded: true, target: target, amount: amount, method: method, changeGiven: changeGiven, paymentState: after });
  } catch (e) { res.status(500).json({ error: 'Could not record the payment: ' + (e && e.message) }); }
});

// Daily cash-drawer reconciliation: non-voided payments collected on a date (default today), by method.
router.get('/payments/drawer', requireAuth, async function (req, res) {
  try {
    var date = (req.query && req.query.date) || nowStr().slice(0, 10);
    var rows = await all("SELECT p.*, r.request_number FROM fee_payments p LEFT JOIN requests r ON r.id = p.request_id WHERE p.drawer_date = ? AND COALESCE(p.voided,0) = 0 ORDER BY p.created_at", [date]);
    var totals = {}; var cash = 0;
    (rows || []).forEach(function (p) { var m = p.method || 'other'; totals[m] = Math.round(((totals[m] || 0) + (Number(p.amount) || 0)) * 100) / 100; if (m === 'cash') cash += (Number(p.amount) || 0); });
    res.json({ date: date, count: rows.length, totalsByMethod: totals, cashCollected: Math.round(cash * 100) / 100, transactions: rows });
  } catch (e) { res.status(500).json({ error: 'Could not load the drawer report.' }); }
});

// ---- Request Financial Profile: one assembled, explainable object per request. Recomputes the
// estimate (and reconciled actual, if any) from stored inputs so the rule trace is always present,
// then layers payment state, plan, ledger, ERP charges, approved objection credits, and a derived
// payment status. Renderers (staff screen, requestor view, emails) all consume this. ----
function deriveFinancialStatus(est, ps, mode, waiverStatus) {
  if (waiverStatus === 'granted') return { current: 'waived', label: 'Fees waived' };
  if (!est || !ps) return { current: 'no_estimate', label: 'No estimate yet' };
  if (ps.effectiveTotal <= 0) return { current: 'no_fee', label: 'No fee due' };
  if (ps.paidInFull) return { current: 'paid_released', label: 'Paid in full \u2014 released' };
  var depDue = est.deposit_due != null ? Number(est.deposit_due) : 0;
  var depPaid = ps.depositPaid || 0;
  if (depDue > 0 && depPaid + 0.005 < depDue) return { current: 'deposit_due', label: mode === 'erp' ? 'Deposit charge sent \u2014 hold' : 'Deposit invoiced \u2014 hold' };
  if (depDue > 0 && depPaid + 0.005 >= depDue && ps.balanceDue > 0) return { current: 'deposit_paid_proceed', label: 'Deposit paid \u2014 proceeding' };
  return { current: 'balance_due', label: mode === 'erp' ? 'Charged \u2014 awaiting ERP payment' : 'Invoiced \u2014 awaiting payment' };
}

async function computeSnapshot(row, fallbackCfgRow) {
  // Recompute from stored inputs (fresh trace); fall back to the stored fee_context_json.
  var profRow = row.config_profile_id ? await get('SELECT id, name, version, config_json FROM fee_profiles WHERE id = ?', [row.config_profile_id]) : fallbackCfgRow;
  var inputs = null; try { inputs = row.input_json ? JSON.parse(row.input_json) : null; } catch (e) { inputs = null; }
  if (inputs && profRow) {
    var profile = {}; try { profile = JSON.parse(profRow.config_json || '{}'); } catch (e) { profile = {}; }
    return { fc: engine.compute(profile, inputs), profRow: profRow };
  }
  var fc = {}; try { fc = JSON.parse(row.fee_context_json || '{}'); } catch (e) { fc = {}; }
  return { fc: fc, profRow: profRow };
}

router.get('/request/:requestId/financial-profile', requireAuth, async function (req, res) {
  try {
    var rid = req.params.requestId;
    var reqRow = await get("SELECT id, request_number, requestor_name, requestor_email, description, fee_waiver_requested, fee_waiver_status, fee_waiver_decided_by, fee_waiver_decided_at, fee_waiver_reason FROM requests WHERE id = ?", [rid]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
    var jid = await activeJurisdiction();
    var cfgRow = await pickConfig(jid);
    var paymentMode = 'internal'; try { var _pc = cfgRow ? JSON.parse(cfgRow.config_json || '{}') : {}; if (_pc.payment_mode === 'erp') paymentMode = 'erp'; } catch (e) {}

    var est = await latestEstimate(rid);
    var estimateOut = null;
    if (est) {
      var eSnap = await computeSnapshot(est, cfgRow);
      var eR = (eSnap.fc && eSnap.fc.requestLevel) || {};
      estimateOut = { present: true, id: est.id, total: (eR.total != null ? eR.total : Number(est.total) || 0), computation: eSnap.fc, createdAt: est.created_at, notifiedAt: est.notified_at || null,
        configProfile: eSnap.profRow ? { id: eSnap.profRow.id, name: eSnap.profRow.name, version: eSnap.profRow.version } : null };
    }

    var recon = await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'reconciliation' ORDER BY created_at DESC LIMIT 1", [rid]);
    var actualOut = null;
    if (recon) {
      var rSnap = await computeSnapshot(recon, cfgRow);
      var rR = (rSnap.fc && rSnap.fc.requestLevel) || {};
      var actualTotal = (rR.total != null ? rR.total : Number(recon.total) || 0);
      var estTotal = estimateOut ? estimateOut.total : 0;
      actualOut = { present: true, id: recon.id, total: actualTotal, computation: rSnap.fc, delta: Math.round((actualTotal - estTotal) * 100) / 100, createdAt: recon.created_at };
    }

    var payState = await paymentState(rid);
    var planCtx = est ? await planForSnapshot(est) : null;
    var ledger = await all("SELECT id, target, method, amount, tendered, change_given, reference, clerk, created_at FROM fee_payments WHERE request_id = ? AND COALESCE(voided,0) = 0 ORDER BY created_at", [rid]);
    var erpCharges = paymentMode === 'erp' ? await all("SELECT id, target, amount, reference, erp_charge_id, status, paid_amount, method, sent_at, paid_at FROM erp_charges WHERE request_id = ? ORDER BY created_at", [rid]) : [];
    var credits = await all("SELECT id, resolution_type, resolution_amount, resolution_detail, resolved_at, approved_by FROM objections WHERE request_id = ? AND status = 'resolved' AND approval_status = 'approved' AND resolution_type IN ('reduction','waiver','write_off') ORDER BY resolved_at", [rid]);
    var waiverStatus = reqRow.fee_waiver_status || null;
    var status = deriveFinancialStatus(est, payState, paymentMode, waiverStatus);
    // Fee computation method: waiver > applied purpose (commercial/inspection/...) > standard.
    var eRL = (estimateOut && estimateOut.computation && estimateOut.computation.requestLevel) || {};
    var method = 'standard', methodLabel = 'Standard';
    if (waiverStatus === 'granted') { method = 'fee_waiver'; methodLabel = 'Fee waiver approved'; }
    else if (eRL.purposeApplied && eRL.purpose && eRL.purpose !== 'standard') {
      method = eRL.purpose;
      methodLabel = eRL.purpose === 'commercial' ? 'Commercial rates' : (eRL.purpose === 'inspection' ? 'Inspection (no fee)' : (String(eRL.purpose).charAt(0).toUpperCase() + String(eRL.purpose).slice(1)));
    }
    var feeWaiver = { requested: !!reqRow.fee_waiver_requested, status: waiverStatus, decidedBy: reqRow.fee_waiver_decided_by || null, decidedAt: reqRow.fee_waiver_decided_at || null, reason: reqRow.fee_waiver_reason || null };

    res.json({
      computationMethod: { code: method, label: methodLabel },
      feeWaiver: feeWaiver,
      request: { id: reqRow.id, requestNumber: reqRow.request_number, requestorName: reqRow.requestor_name, requestorEmail: reqRow.requestor_email, description: reqRow.description },
      paymentMode: paymentMode,
      estimate: estimateOut,
      actual: actualOut,
      paymentState: payState,
      paymentTiming: planCtx ? { plan: planCtx.plan, source: planCtx.source } : null,
      ledger: ledger || [],
      erpCharges: erpCharges || [],
      objectionCredits: credits || [],
      paymentStatus: status,
      generatedAt: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: 'Could not assemble the financial profile: ' + (e && e.message) }); }
});

module.exports = router;
