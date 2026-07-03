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
async function computeSituation(rid) {
  var est = await db.get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [rid]);
  var reqRow = await db.get("SELECT stage, status, fee_waiver_status FROM requests WHERE id = ?", [rid]);
  if (!est) return { hasEstimate: false };
  var recon = await db.get("SELECT total FROM request_fee_estimates WHERE request_id = ? AND kind = 'reconciliation' ORDER BY created_at DESC LIMIT 1", [rid]);
  var base = (recon && recon.total != null) ? Number(recon.total) : (Number(est.total) || 0);
  var credRow = await db.get("SELECT COALESCE(SUM(resolution_amount),0) AS c FROM objections WHERE request_id = ? AND status = 'resolved' AND approval_status = 'approved' AND resolution_type IN ('reduction','waiver','write_off')", [rid]);
  var manualCred = await db.get("SELECT COALESCE(SUM(amount),0) AS c FROM fee_adjustments WHERE request_id = ? AND type = 'credit' AND COALESCE(voided,0) = 0", [rid]);
  var credits = Math.round(((Number(credRow && credRow.c) || 0) + (Number(manualCred && manualCred.c) || 0)) * 100) / 100;
  var eff = Math.max(0, Math.round((base - credits) * 100) / 100);
  var refundRow = await db.get("SELECT COALESCE(SUM(amount),0) AS r FROM fee_adjustments WHERE request_id = ? AND type = 'refund' AND COALESCE(voided,0) = 0", [rid]);
  var refunds = Math.round((Number(refundRow && refundRow.r) || 0) * 100) / 100;
  var totalPaid = Math.max(0, Math.round(((Number(est.deposit_paid_amount) || 0) + (Number(est.final_paid_amount) || 0) - refunds) * 100) / 100);
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
    waived: !!(reqRow && reqRow.fee_waiver_status === 'granted'),
    effectiveTotal: eff, totalPaid: totalPaid, depositRequired: depositRequired,
    startGate: startGate, accepted: !!est.accepted_at,
    releaseHeld: pt.requiresPaymentBeforeRelease(plan),
    workComplete: !!recon,
    delivered: !!(reqRow && (reqRow.stage === 'delivery' || reqRow.status === 'closed')),
    terminal: (reqRow && (reqRow.status === 'withdrawn' || reqRow.status === 'abandoned')) ? 'withdrawn' : null,
    base: base, credits: credits, plan: plan
  };
}

async function deriveCurrent(rid) { return deriveStatus(await computeSituation(rid)); }

// Recompute + append: derive the current status and log the event that produced it.
async function recordEvent(rid, evt) {
  evt = evt || {};
  var status = await deriveCurrent(rid);
  await promoteOnRelease(rid);
  try {
    await db.run("INSERT INTO request_payment_events (id, request_id, type, amount, reason, reference, actor, approver, status_current, status_label, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ['pe-' + uuidv4().slice(0, 8), rid, evt.type || 'event', (evt.amount != null ? Number(evt.amount) : null), evt.reason || null, evt.reference || null, evt.actor || null, evt.approver || null, status.current, status.label, nowStr()]);
  } catch (e) { console.error('[paymentStatus recordEvent]', e.message); }
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

module.exports = { deriveStatus: deriveStatus, computeSituation: computeSituation, deriveCurrent: deriveCurrent, recordEvent: recordEvent, timeline: timeline, publicationHeld: publicationHeld, promoteOnRelease: promoteOnRelease };
