'use strict';
// ERP settlement routes (erp payment mode): emit a charge to the ERP, list local tracking, and
// receive the ERP's payment-applied webhook (shared-secret auth) to apply the payment to the request.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get } = require('../db');
const uuidv4 = require('uuid').v4;
const erp = require('../services/erpSettlement');
var taskRouting = require('../services/taskRouting');
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
async function hist(rid, actor, action, details) {
  try { await run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action, details, created_at) VALUES (?,?,?,?,?,?,?)", ['rh-' + uuidv4().slice(0, 8), rid, actor && actor.sub, (actor && actor.name) || 'system', action, details || null, nowStr()]); } catch (e) {}
}

// Emit a charge to the ERP. Body: { target:'deposit'|'balance', amount, dueDate?, gatingSemantic?, description? }
router.post('/request/:requestId/charge', requireAuth, async function (req, res) {
  try {
    var rid = req.params.requestId;
    if (!(await get("SELECT id FROM requests WHERE id = ?", [rid]))) return res.status(404).json({ error: 'Request not found.' });
    var b = req.body || {};
    var target = b.target === 'deposit' ? 'deposit' : 'balance';
    var amount = Number(b.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter a charge amount.' });
    var est = await get("SELECT id FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [rid]);
    var out = await erp.emitCharge({ requestId: rid, estimateId: est && est.id, target: target, amount: amount, dueDate: b.dueDate, gatingSemantic: b.gatingSemantic, description: b.description, by: (req.user && req.user.name) || req.user.sub });
    await hist(rid, req.user, 'ERP_CHARGE_SENT', 'Sent ' + target + ' charge of $' + amount.toFixed(2) + ' to the ERP (' + out.erpChargeId + ').');
    res.json({ ok: true, charge: out });
  } catch (e) { res.status(502).json({ error: 'Could not send the charge to the ERP: ' + (e && e.message) }); }
});

router.get('/request/:requestId/charges', requireAuth, async function (req, res) {
  try { res.json({ charges: (await erp.listCharges(req.params.requestId)) || [] }); }
  catch (e) { res.status(500).json({ error: 'Could not load ERP charges.' }); }
});

// Inbound payment-applied webhook from the ERP/gateway. Authenticated by shared secret, not a session.
router.post('/payment-applied', async function (req, res) {
  try {
    var expected = await erp.getWebhookSecret();
    if (!expected || (req.get('X-Webhook-Secret') || '') !== expected) return res.status(401).json({ error: 'Invalid webhook secret' });
    var b = req.body || {};
    var erpChargeId = b.chargeId;
    var amountApplied = Number(b.amountApplied) || 0;
    if (!erpChargeId || !(amountApplied > 0)) return res.status(400).json({ error: 'chargeId and amountApplied are required' });
    var track = await get("SELECT * FROM erp_charges WHERE erp_charge_id = ?", [erpChargeId]);
    if (!track) return res.status(404).json({ error: 'Unknown charge' });
    var now = nowStr();
    var newPaid = Math.round(((Number(track.paid_amount) || 0) + amountApplied) * 100) / 100;
    await run("UPDATE erp_charges SET paid_amount = ?, status = ?, method = ?, paid_at = ?, updated_at = ? WHERE id = ?", [newPaid, b.status || 'partial', b.method || null, now, now, track.id]);
    var est = await get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [track.request_id]);
    if (est) {
      await run("INSERT INTO fee_payments (id, request_id, estimate_id, target, method, amount, reference, clerk, drawer_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ['feepay-' + uuidv4().slice(0, 8), track.request_id, est.id, track.target, 'erp:' + (b.method || 'ext'), amountApplied, erpChargeId, 'ERP', now.slice(0, 10), now]);
      if (track.target === 'deposit') {
        await run("UPDATE request_fee_estimates SET deposit_paid_at = ?, deposit_paid_by = ?, deposit_paid_amount = ? WHERE id = ?", [now, 'ERP', (Number(est.deposit_paid_amount) || 0) + amountApplied, est.id]);
        var rr = await get("SELECT stage FROM requests WHERE id = ?", [track.request_id]);
        if (rr && rr.stage === 'awaiting_payment') {
          await taskRouting.applyStageTransition(track.request_id, 'record_search', {
            actorName: 'ERP', action: 'STAGE_ADVANCED', notes: 'Record search begins (ERP deposit applied).',
            createdBy: 'system', clearTickler: true });
        }
      } else {
        await run("UPDATE request_fee_estimates SET final_paid_at = ?, final_paid_by = ?, final_paid_amount = ? WHERE id = ?", [now, 'ERP', (Number(est.final_paid_amount) || 0) + amountApplied, est.id]);
      }
    }
    await hist(track.request_id, null, 'ERP_PAYMENT_APPLIED', 'ERP reported a ' + track.target + ' payment of $' + amountApplied.toFixed(2) + ' (' + (b.method || 'ext') + ') applied.');
    try { await require('../services/paymentStatus').recordEvent(track.request_id, { type: 'payment', amount: amountApplied, reason: 'ERP ' + track.target + ' payment', reference: erpChargeId }); } catch (e) {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Could not apply the payment: ' + (e && e.message) }); }
});

module.exports = router;
