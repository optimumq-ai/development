'use strict';
// Payment status model (Financial Profile phase 3). Status is a DERIVED photograph (deriveStatus,
// PURE) over a LIVE-computed situation (computeSituation, reads DB). Status is never stored or
// hand-set: after any event the situation is recomputed and the status re-derived, and the deposit
// requirement / gates are derived from the CURRENT effective total (live plan, not frozen). Every
// event is appended to request_payment_events with the status it produced. See
// REQUEST_FINANCIAL_PROFILE_DESIGN.md section 15.
var db = require('../db');
var pt = require('./paymentTiming');
var uuidv4 = require('uuid').v4;
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function st(current, label, reason) { return reason ? { current: current, label: label, reason: reason } : { current: current, label: label }; }

// PURE. Normalized situation -> the single current payment status. Order of precedence matters.
function deriveStatus(s) {
  s = s || {}; var E = 0.005;
  var eff = Number(s.effectiveTotal) || 0, paid = Number(s.totalPaid) || 0, dep = Number(s.depositRequired) || 0;
  if (s.terminal === 'withdrawn') return st('withdrawn', 'Withdrawn');
  if (s.terminal === 'closed_nonpayment') return st('closed_nonpayment', 'Closed \u2014 nonpayment');
  if (!s.hasEstimate) return st('no_estimate', 'No estimate yet');
  if (s.waived) return st('waived', 'Fees waived');
  if (eff <= 0) return st('no_fee', 'No fee due');
  if (paid > eff + E) return st('refund_due', 'Refund / credit due');
  var paidInFull = paid + E >= eff;
  if (!s.workComplete) {
    var startCleared = (s.startGate === 'none') || (dep <= 0 && s.startGate !== 'acceptance') || (s.startGate === 'acceptance' && s.accepted) || (s.startGate === 'deposit' && paid + E >= dep);
    if (!startCleared) {
      if (s.startGate === 'acceptance') return st('awaiting_acceptance', 'Awaiting estimate acceptance');
      return st('deposit_due', 'Deposit due \u2014 on hold');
    }
    var reason = (s.startGate === 'acceptance') ? 'estimate accepted' : (dep <= 0 ? 'no deposit required' : 'deposit paid');
    return st('cleared_to_proceed', 'Cleared to proceed', reason);
  }
  if (paidInFull) return s.delivered ? st('paid_in_full', 'Paid in full') : st('cleared_for_release', 'Paid in full \u2014 cleared for release');
  if (s.releaseHeld) return st('awaiting_final', 'Awaiting final payment \u2014 records held');
  return st('released_payment_due', 'Released \u2014 payment due');
}

// Reads DB -> normalized situation. Deposit requirement + gates are derived LIVE from the current
// effective total (base minus approved objection credits), so a mid-flight credit/correction that
// lowers the total re-derives the deposit (may drop to $0) and can flip the start gate.
// ⚠️ MONEY IS RESOLVED THROUGH THE TREE, NOT OFF ONE ROW (fixed 2026-07-19; brief §3.1b).
//
// THE DEFECT THIS CLOSES, and it was silent and total: money is a PARENT fact, but every UI path writes an
// estimate against the CHILD it is looking at. `feeNonpayment.sweep()` is PARENT-scoped — deliberately,
// because unscoped it would send the citizen DUPLICATE dunning emails — and then asked
// `computeSituation(parentId)`, which looked for `request_fee_estimates WHERE request_id = <parent>`. The
// parent has none. So `hasEstimate` was false, `continue` fired, and **for every wrapped request in the
// system no dunning email was ever sent and non-payment auto-close never fired.** The parent-scoping
// succeeded completely at preventing duplicates — by making dunning never happen at all.
//
// Proven by tests/verify_nonpayment_scope.js, written 2026-07-19 (q) and deliberately left failing until now.
//
// THE FIX IS RESOLVE-THROUGH, NOT A DATA MIGRATION. Estimates stay where the UI writes them; the money
// QUESTION is answered over the whole tree (the parent and all its children), which is the same technique
// `feeRelease.COVERING` uses for the release gate. Nothing has to move, and there is no backfill to get wrong.
//
// AGGREGATION RULES, and they are not arbitrary — each is the conservative reading for a CITIZEN:
//   totals / credits / refunds / payments — SUMMED across the tree. Three children with estimates are one
//                     bill; the citizen pays once for the request.
//   workComplete      — EVERY estimate-bearing row must be reconciled. Dunning only starts once the work is
//                     done, so one child still being worked must not trigger a demand for the whole request.
//   accepted          — EVERY estimate accepted. A tree is not accepted while a part of it is not.
//   waived            — ANY granted waiver. If a waiver was granted anywhere, do not dun.
//   delivered         — EVERY leaf delivered or closed.
// At n = 1 all of these are identities, so an ordinary request is completely unaffected.
async function moneyTreeIds(rid) {
  var p = await db.get("SELECT COALESCE(master_request_id, id) AS pid FROM requests WHERE id = ?", [rid]);
  if (!p || !p.pid) return [rid];
  var rows = await db.all("SELECT id FROM requests WHERE id = ? OR master_request_id = ?", [p.pid, p.pid]);
  return rows.length ? rows.map(function (r) { return r.id; }) : [rid];
}

async function computeSituation(rid) {
  var ids = await moneyTreeIds(rid);
  var ph = ids.map(function () { return '?'; }).join(',');

  // Latest estimate and latest reconciliation PER ROW — a reissue makes a new estimate for the same row, so
  // "latest per row" is what the single-row code always meant; summing raw rows would double-count reissues.
  var estAll = await db.all(
    "SELECT DISTINCT ON (request_id) * FROM request_fee_estimates WHERE request_id IN (" + ph + ") AND kind = 'estimate' " +
    "ORDER BY request_id, created_at DESC", ids);
  var reconAll = await db.all(
    "SELECT DISTINCT ON (request_id) request_id, total FROM request_fee_estimates WHERE request_id IN (" + ph + ") AND kind = 'reconciliation' " +
    "ORDER BY request_id, created_at DESC", ids);
  if (!estAll.length) return { hasEstimate: false };

  var reconBy = {};
  reconAll.forEach(function (r) { reconBy[r.request_id] = r; });
  // Most recent estimate across the tree — supplies the config profile and the acceptance/paid fields that
  // are not summable.
  var est = estAll.slice().sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); })[0];
  var recon = reconBy[est.request_id] || null;

  var reqRows = await db.all("SELECT id, master_request_id, stage, status, closure_reason, fee_waiver_status FROM requests WHERE id IN (" + ph + ")", ids);
  var reqRow = reqRows.filter(function (r) { return r.id === rid; })[0] || null;
  var leaves = reqRows.filter(function (r) { return r.master_request_id != null; });
  if (!leaves.length) leaves = reqRows; // pre-wrap / SYS rows are their own leaf

  var base = 0;
  estAll.forEach(function (e) {
    var rc = reconBy[e.request_id];
    base = Math.round((base + ((rc && rc.total != null) ? Number(rc.total) : (Number(e.total) || 0))) * 100) / 100;
  });
  var credRow = await db.get("SELECT COALESCE(SUM(resolution_amount),0) AS c FROM objections WHERE request_id IN (" + ph + ") AND status = 'resolved' AND approval_status = 'approved' AND resolution_type IN ('reduction','waiver','write_off')", ids);
  var manualCred = await db.get("SELECT COALESCE(SUM(amount),0) AS c FROM fee_adjustments WHERE request_id IN (" + ph + ") AND type = 'credit' AND COALESCE(voided,0) = 0", ids);
  var credits = Math.round(((Number(credRow && credRow.c) || 0) + (Number(manualCred && manualCred.c) || 0)) * 100) / 100;
  var eff = Math.max(0, Math.round((base - credits) * 100) / 100);
  var refundRow = await db.get("SELECT COALESCE(SUM(amount),0) AS r FROM fee_adjustments WHERE request_id IN (" + ph + ") AND type = 'refund' AND COALESCE(voided,0) = 0", ids);
  var refunds = Math.round((Number(refundRow && refundRow.r) || 0) * 100) / 100;
  var paidGross = 0;
  estAll.forEach(function (e) { paidGross = Math.round((paidGross + (Number(e.deposit_paid_amount) || 0) + (Number(e.final_paid_amount) || 0)) * 100) / 100; });
  var totalPaid = Math.max(0, Math.round((paidGross - refunds) * 100) / 100);
  var allAccepted = estAll.every(function (e) { return !!e.accepted_at; });
  var allReconciled = estAll.every(function (e) { return !!reconBy[e.request_id]; });
  var anyWaived = reqRows.some(function (r) { return r.fee_waiver_status === 'granted'; });
  var allDelivered = leaves.every(function (r) { return r.stage === 'delivery' || r.status === 'closed'; });
  var prof = est.config_profile_id ? await db.get('SELECT config_json FROM fee_profiles WHERE id = ?', [est.config_profile_id]) : await db.get("SELECT config_json FROM fee_profiles WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1");
  var cfg = {}; try { cfg = JSON.parse((prof && prof.config_json) || '{}'); } catch (e) { cfg = {}; }
  var ptCfg = (cfg.paymentTiming && Object.keys(cfg.paymentTiming).length) ? cfg.paymentTiming : pt.deriveDefaultPaymentTiming(cfg);
  var plan = pt.resolvePaymentPlan(ptCfg, { estimateTotal: eff });
  var gate = plan && plan.gate;
  var startGate = gate === 'deposit_before_work' ? 'deposit' : (gate === 'estimate_acceptance' ? 'acceptance' : 'none');
  var depositRequired = 0;
  if (startGate === 'deposit' && plan.firstPayment && plan.firstPayment.required) depositRequired = (plan.firstPayment.amount != null ? Number(plan.firstPayment.amount) : eff);
  return {
    hasEstimate: true,
    waived: anyWaived,
    effectiveTotal: eff, totalPaid: totalPaid, depositRequired: depositRequired,
    startGate: startGate, accepted: allAccepted,
    releaseHeld: pt.requiresPaymentBeforeRelease(plan),
    workComplete: allReconciled,
    delivered: allDelivered,
    moneyRowCount: estAll.length,
    terminal: (reqRow && reqRow.status === 'closed' && /nonpayment/i.test(reqRow.closure_reason || '')) ? 'closed_nonpayment' : ((reqRow && (reqRow.status === 'withdrawn' || reqRow.status === 'abandoned')) ? 'withdrawn' : null),
    base: base, credits: credits, plan: plan
  };
}

async function deriveCurrent(rid) { return deriveStatus(await computeSituation(rid)); }

// Recompute + append: derive the current status and log the event that produced it.
async function recordEvent(rid, evt) {
  evt = evt || {};
  var status = await deriveCurrent(rid);
  await promoteOnRelease(rid);
  var peId = 'pe-' + uuidv4().slice(0, 8);
  try {
    await db.run("INSERT INTO request_payment_events (id, request_id, type, amount, reason, reference, actor, approver, status_current, status_label, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [peId, rid, evt.type || 'event', (evt.amount != null ? Number(evt.amount) : null), evt.reason || null, evt.reference || null, evt.actor || null, evt.approver || null, status.current, status.label, nowStr()]);
  } catch (e) { console.error('[paymentStatus recordEvent]', e.message); }
  // PHASE 7 / WS5 — feed the REQUESTOR-level ledger from the one chokepoint every money event already
  // passes through. The cross-request A/R balance a deposit demand rests on (TX § 552.263(c): unpaid prior
  // amounts over $100) has to be EVENTED and reconstructable, not re-summed at read time over request rows
  // that keep moving. Idempotent on this event's id, and a no-op for an anonymous requestor — see
  // services/requestorLedger.js on why an unverified email is not an identity.
  try { await require('./requestorLedger').onMoneyEvent(rid, evt, peId); }
  catch (e) { console.error('[paymentStatus ledger]', e && e.message); }
  return status;
}

async function timeline(rid) {
  return await db.all("SELECT id, type, amount, reason, reference, actor, approver, status_current, status_label, created_at FROM request_payment_events WHERE request_id = ? ORDER BY created_at ASC, id ASC", [rid]);
}

// Whether the record output must be HELD from the public library (pay-before-release, has a fee,
// not waived, not yet paid in full). Governs public-ready publication (not just delivery).
async function publicationHeld(rid) {
  var s = await computeSituation(rid);
  return !!(s.hasEstimate && !s.waived && (Number(s.effectiveTotal) || 0) > 0 && s.releaseHeld && ((Number(s.totalPaid) || 0) + 0.005 < (Number(s.effectiveTotal) || 0)));
}
// When the release gate opens (paid / waived / net-terms / no-fee), promote this request's held
// fulfilled_records to 'released' (publish + downloadable). No-op if still held.
async function promoteOnRelease(rid) {
  try {
    if (!(await publicationHeld(rid))) {
      await db.run("UPDATE fulfilled_records SET status = 'released', released_at = COALESCE(released_at, ?) WHERE request_id = ? AND status = 'held'", [nowStr(), rid]);
    }
  } catch (e) { console.error('[promoteOnRelease]', e.message); }
}

module.exports = {
  moneyTreeIds: moneyTreeIds, deriveStatus: deriveStatus, computeSituation: computeSituation, deriveCurrent: deriveCurrent, recordEvent: recordEvent, timeline: timeline, publicationHeld: publicationHeld, promoteOnRelease: promoteOnRelease };
