'use strict';
// THE "SEND AGAIN" GATE — Kevin, 2026-07-14: "the rules configuration needs to be able to know when
// 'send again' is required, for either re-invoice or a second request for clarification."
//
// This is the re-invoice half.
//
// THE GAP IT CLOSES. The 20% variance rule was already COMPUTED — `routes/feeEstimates.js` reconciles actual
// quantities against the accepted estimate and sets `renotify_required` when the cost rose past the
// jurisdiction's `revisionNotifyPercent` (default 20). But it was a FLAG AND NOTHING ELSE. Nobody read it.
// A clerk could reconcile a $400 job against a $100 estimate, see "revised notice required", ignore it, and
// collect $400. That is unlawful in Texas:
//
//   § 552.2615(c) — if the actual charges will exceed the itemized estimate by MORE THAN 20%, the
//                   governmental body "shall send to the requestor an updated itemized statement," and the
//                   requestor again has 10 business days to respond or the request is withdrawn.
//   § 552.2615(b) — a body that does NOT provide the required itemized statement "may not collect more
//                   than $40" for the request. The statement is a precondition to the money.
//
// So: when the jurisdiction requires a re-issue on variance and the revised notice has NOT been sent, the
// system REFUSES to take money above the amount the requestor was last actually told about. Not a warning —
// the requestor never agreed to the higher number, and in TX the city has no right to it yet.
//
// ⚠️ THIS GATE IS *NOT* FAIL-SAFE-INVERTED, AND THE DIFFERENCE FROM feeForfeiture.js IS DELIBERATE.
//
// feeForfeiture is armed by its flag alone, because in Illinois the fee is ALREADY lost by operation of law
// the moment the clock blows — blocking the invoice costs the city nothing it still had.
//
// Here the fee is NOT lost. The city can cure it by sending the revised statement. So blocking collection
// prematurely could stop a *legitimate* payment at the counter — a real cost with a real clerk standing
// there. This gate therefore respects the normal safe-manual gate: it acts only when the city has switched
// the payment policy ON. Texas is seeded with the rule but ships `enabled: false`, so nothing changes for a
// live request until a city opts in.
//
// The asymmetry is the point: block for free, never block at a cost the city did not agree to.
var db = require('../db');
var PCP = require('./paymentClockPolicy');

// The amount the requestor was LAST TOLD about. That is what they can be held to — not a number the city
// recomputed internally and never sent.
async function lastNotifiedTotal(requestId) {
  var est = await db.get(
    "SELECT total, notified_at FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' AND notified_at IS NOT NULL " +
    "ORDER BY notified_at DESC LIMIT 1", [requestId]);
  return est ? { total: Number(est.total) || 0, notifiedAt: est.notified_at } : null;
}

// Is a revised notice outstanding? True when the newest reconciliation flagged `renotify_required` and no
// estimate notice has been sent to the requestor SINCE that reconciliation.
async function pending(requestId) {
  var recon = await db.get(
    "SELECT id, total, baseline_total, variance_pct, renotify_required, created_at FROM request_fee_estimates " +
    "WHERE request_id = ? AND kind = 'reconciliation' ORDER BY created_at DESC LIMIT 1", [requestId]);
  if (!recon || Number(recon.renotify_required) !== 1) return { pending: false };

  var notice = await db.get(
    "SELECT notified_at FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' AND notified_at IS NOT NULL " +
    "AND notified_at > ? ORDER BY notified_at DESC LIMIT 1", [requestId, recon.created_at]);
  if (notice) return { pending: false, resentAt: notice.notified_at };

  return {
    pending: true,
    actualTotal: Number(recon.total) || 0,
    estimateTotal: recon.baseline_total != null ? Number(recon.baseline_total) : null,
    variancePct: recon.variance_pct != null ? Number(recon.variance_pct) : null,
    reconciledAt: recon.created_at
  };
}

// May the city collect `amount` on this request right now?
// Returns { blocked, reason, citation, ceiling } — blocked=false when the jurisdiction has no re-issue rule.
async function checkCollection(requestId, amount) {
  var policy;
  try { policy = await PCP.read(null); } catch (e) { return { blocked: false }; }
  // enabled === true is required (see the header): this gate can stop a legitimate payment, so the city
  // opts in. It is not the fail-safe inversion used by feeForfeiture.
  if (!policy || policy.enabled !== true || policy.reissue_blocks_collection !== true) return { blocked: false };

  var p = await pending(requestId);
  if (!p.pending) return { blocked: false };

  // The ceiling is what the requestor was last told. Money at or below that is money they agreed to.
  var last = await lastNotifiedTotal(requestId);
  var ceiling = last ? last.total : 0;
  var paidRow = await db.get(
    "SELECT COALESCE(SUM(amount),0) AS paid FROM fee_payments WHERE request_id = ?", [requestId]);
  var paid = Number(paidRow && paidRow.paid) || 0;
  var wouldBe = paid + (Number(amount) || 0);

  if (wouldBe <= ceiling + 0.005) return { blocked: false, ceiling: ceiling, paid: paid };

  var prov = (policy.provenance && policy.provenance.reissue_required_on_variance) || {};
  return {
    blocked: true,
    ceiling: ceiling,
    paid: paid,
    reason: 'The actual cost ($' + p.actualTotal.toFixed(2) + ') came in ' + (p.variancePct != null ? p.variancePct + '% ' : '') +
            'above the estimate the requestor accepted ($' + (p.estimateTotal != null ? p.estimateTotal.toFixed(2) : '?') + '), ' +
            'and the revised itemized statement has not been sent. The requestor has not agreed to the higher amount, ' +
            'so the city cannot collect more than $' + ceiling.toFixed(2) + ' on this request yet. ' +
            'Send the revised estimate first — that also restarts the requestor\'s response window.',
    citation: prov.citation || "Tex. Gov't Code § 552.2615(b)-(c)"
  };
}

module.exports = { pending: pending, checkCollection: checkCollection, lastNotifiedTotal: lastNotifiedTotal };
