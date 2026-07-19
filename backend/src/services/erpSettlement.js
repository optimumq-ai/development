'use strict';
// ERP settlement connector (erp payment mode). Emits a charge (misc receipt / general bill) to the
// ERP and records local tracking so the ERP's payment-applied webhook can be matched back to a
// request. Optimum Q never holds the money; it hands off the charge and applies what finance reports.
var db = require('../db');
var uuidv4 = require('uuid').v4;
var feeRelease = require('./feeRelease');
var revAlloc = require('./revenueAllocation');
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// ---- LINE ITEMS (SPEC §5.10.5) ----------------------------------------------------------------------
// The ERP used to be sent a single scalar `amount`. It was never told there were eleven records, so it could
// not allocate anything — which is why "let Finance's ERP allocate it" collapsed into "build it, then also
// send it." `componentCharged` (§5.10.2) exists now, so the charge can carry its detail.
//
// THE DECISION THAT SHAPES THIS (§5.10.5): the release-gate allocation and the GL allocation are DIFFERENT
// QUESTIONS AND NEED NOT AGREE. Optimum Q must have a per-record answer because it gates a legal act
// (§5.9 coverage). Finance may recognise revenue however their policy dictates. So we send detail, not a
// mandate — and the city chooses which detail via `erp_allocation_method`:
//
//   'prorata' (DEFAULT) — line items carry `amount`, each record's share of THIS charge, summing to the
//                         charge total. Same rule as the gate, so gate and GL tell one story.
//   'none'              — for a city whose Finance department already has an allocation policy. Line items
//                         carry `actualCost` (the raw per-record cost, pre-rounding/cap/allowance) and NO
//                         `amount`. Finance applies its own policy against the authoritative scalar.
//
// ⚠️ WHY 'none' USES A DIFFERENT FIELD NAME RATHER THAN THE SAME ONE. Raw costs do NOT sum to the charge —
// that is the whole point of the request-level rules (a cap, a free allowance, labor rounding). If both modes
// emitted `amount`, an ERP that naively sums line items would post MORE than the city is charging, and
// over-bill a citizen for a statutory fee. Under `none` there is no `amount` field to sum, so that failure
// mode is structurally unavailable rather than merely documented.
//
// The knob NEVER touches the release gate, which always uses prorata because §5.9 requires a per-child
// coverage test. This is GL presentation only.
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

async function buildLineItems(o, method) {
  var snap = o.estimateId
    ? await db.get("SELECT * FROM request_fee_estimates WHERE id = ?", [o.estimateId])
    : null;
  // Resolve through the same rule the release gate uses (reconciliation supersedes) so a record is never
  // billed against one split and released against another.
  if (!snap || snap.kind === 'estimate') {
    var governing = await feeRelease.pricedSnapshot(o.requestId);
    if (governing) snap = governing;
  }
  if (!snap) return null;

  var fc = {};
  try { fc = JSON.parse(snap.fee_context_json || '{}'); } catch (e) { return null; }
  var comps = Array.isArray(fc.components) ? fc.components : [];
  if (!comps.length) return null;

  var ids = comps.map(function (c) { return c.id; }).filter(Boolean);
  var labels = {};
  if (ids.length) {
    var ph = ids.map(function () { return '?'; }).join(',');
    var rows = await db.all("SELECT id, request_number, department_id FROM requests WHERE id IN (" + ph + ")", ids);
    (rows || []).forEach(function (x) { labels[x.id] = x; });
  }
  function decorate(c, extra) {
    var row = labels[c.id] || {};
    var item = { recordId: c.id, label: c.label || null, recordType: c.recordType || null,
                 reference: row.request_number || null, departmentId: row.department_id || null };
    return Object.assign(item, extra);
  }

  if (method === 'none') {
    // No `amount` — see the warning above. `componentGross` is the raw per-record cost before any
    // request-level rule; that is exactly "actual costs only".
    return { allocation: 'none',
      note: 'Line items are ACTUAL per-record costs and do NOT sum to the charge amount. The authoritative ' +
            'figure is `amount` on the charge; allocate it per your own policy.',
      lineItems: comps.map(function (c) { return decorate(c, { actualCost: r2(c.componentGross) }); }) };
  }

  // Prorata. Allocate THIS CHARGE, not the request total — a deposit is a partial amount, and its line items
  // must sum to the deposit, not to the estimate. `splitOne` is the same allocator revenue attribution uses,
  // including the residual-on-largest rule, so an ERP charge and a revenue report never disagree by a cent.
  var priced = comps.filter(function (c) { return typeof c.componentCharged === 'number'; });
  if (!priced.length) return null;
  var parts = revAlloc.splitOne(o.requestId, Number(o.amount), comps);
  if (parts.length === 1 && parts[0].basis === 'request_total') return null; // nothing priced — send the scalar alone
  var byId = {};
  parts.forEach(function (p) { byId[p.requestId] = p.amount; });
  return { allocation: 'prorata',
    note: 'Line items sum to the charge amount.',
    lineItems: priced.map(function (c) {
      return decorate(c, { amount: r2(byId[c.id]), componentCharged: r2(c.componentCharged) });
    }) };
}

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

  // Detail, if we have it. An estimate priced before `componentCharged` existed, or one with no components,
  // yields no line items and the charge goes as it always did — a scalar. Never fabricate a split.
  var method = (c.erp_allocation_method === 'none') ? 'none' : 'prorata';
  var detail = null;
  try { detail = await buildLineItems(o, method); }
  catch (e) { detail = null; } // FAILS OPEN: detail is a courtesy to Finance; it must never block a charge.
  if (detail) {
    payload.allocation = detail.allocation;
    payload.allocationNote = detail.note;
    payload.lineItems = detail.lineItems;
  }
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

module.exports = { emitCharge: emitCharge, listCharges: listCharges, getWebhookSecret: getWebhookSecret, cfg: cfg,
                   buildLineItems: buildLineItems };
