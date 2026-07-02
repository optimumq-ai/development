'use strict';
// ERP settlement connector (erp payment mode). Emits a charge (misc receipt / general bill) to the
// ERP and records local tracking so the ERP's payment-applied webhook can be matched back to a
// request. Optimum Q never holds the money; it hands off the charge and applies what finance reports.
var db = require('../db');
var uuidv4 = require('uuid').v4;
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

async function cfg() {
  var rows = await db.all("SELECT key, value FROM system_config WHERE key LIKE 'erp_%'");
  var m = {}; (rows || []).forEach(function (r) { m[r.key] = r.value; });
  return m;
}

// Emit a charge to the ERP. target: 'deposit' | 'balance'. Records an erp_charges tracking row.
async function emitCharge(o) {
  var c = await cfg();
  if (!c.erp_base_url) throw new Error('ERP base URL is not configured');
  var reqRow = await db.get("SELECT request_number, requestor_name, requestor_email FROM requests WHERE id = ?", [o.requestId]);
  var payload = {
    amount: Number(o.amount),
    type: o.target === 'deposit' ? 'deposit' : 'balance',
    reference: (reqRow && reqRow.request_number) || o.requestId,
    dueDate: o.dueDate || 'immediate',
    gatingSemantic: o.gatingSemantic || null,
    chargeCodeHint: 'MISC-RECORDS-FEE',
    description: o.description || 'Public records request fee',
    requestor: reqRow ? { name: reqRow.requestor_name, email: reqRow.requestor_email } : null,
    callbackUrl: c.erp_callback_url || null
  };
  var res = await fetch(c.erp_base_url.replace(/\/$/, '') + '/api/munis/v1/ar/charges', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': c.erp_api_key || '' }, body: JSON.stringify(payload)
  });
  if (!res.ok) { var t = await res.text().catch(function () { return ''; }); throw new Error('ERP returned ' + res.status + ' ' + String(t).slice(0, 140)); }
  var data = await res.json();
  var id = 'erpc-' + uuidv4().slice(0, 8); var now = nowStr();
  await db.run("INSERT INTO erp_charges (id, request_id, estimate_id, target, amount, reference, erp_charge_id, status, paid_amount, sent_by, sent_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, o.requestId, o.estimateId || null, payload.type, payload.amount, payload.reference, data.chargeId, 'sent', 0, o.by || 'system', now, now, now]);
  return { id: id, erpChargeId: data.chargeId, reference: payload.reference, amount: payload.amount, target: payload.type, status: 'sent' };
}

async function listCharges(rid) { return await db.all("SELECT * FROM erp_charges WHERE request_id = ? ORDER BY created_at DESC", [rid]); }
async function getWebhookSecret() { var c = await cfg(); return c.erp_webhook_secret || ''; }

module.exports = { emitCharge: emitCharge, listCharges: listCharges, getWebhookSecret: getWebhookSecret, cfg: cfg };
