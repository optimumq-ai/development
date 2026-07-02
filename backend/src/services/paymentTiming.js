// paymentTiming.js - Payment & delivery-plan resolver (slice 1 + slice 2 derive helper)
//
// Pure, dependency-free. Given an estimate total + a jurisdiction's paymentTiming
// config + request context, returns the "payment & delivery plan" card described in
// FEE_ESTIMATE_VARIABLE_MAP.md sections C.1 (due-dates), C.2 (delivery trigger), 5, 6.
//
// Consumed read-only by the fee sandbox (slice 2). Live-workflow wiring is slice 4.
// Does NOT compute the fee amount - feeEngine.compute() does that. It consumes the
// resulting estimate total and decides WHAT must be collected, WHEN, and what that gates.
'use strict';

var GATES = ['invoice_on_completion', 'estimate_acceptance', 'deposit_before_work', 'pay_in_full_before_release'];

function num(v) { return typeof v === 'number' && isFinite(v) ? v : (isFinite(Number(v)) ? Number(v) : 0); }
function r2(n) { return Math.round(n * 100) / 100; }

// First band whose upTo >= total (upTo null = unlimited top band).
function selectBand(bands, total) {
  for (var i = 0; i < bands.length; i++) {
    var b = bands[i];
    if (b.upTo == null || total <= num(b.upTo)) return { index: i, band: b };
  }
  return { index: bands.length - 1, band: bands[bands.length - 1] };
}

// First-payment (advance/deposit) amount where determinable.
// basis: 'none' | 'percent' | 'up_to_anticipated_cost' | 'tiered'
function firstPaymentAmount(fp, total) {
  var basis = fp.basis || 'none';
  if (basis === 'percent') {
    var pct = num(fp.percent);
    var amt = r2(total * pct / 100);
    if (fp.cap === 'half_estimate') amt = Math.min(amt, r2(total * 0.5));
    else if (fp.cap === 'estimate') amt = Math.min(amt, total);
    else if (typeof fp.cap === 'number') amt = Math.min(amt, fp.cap);
    return { amount: amt, ceiling: false, basisText: pct + '% of the $' + total.toFixed(2) + ' estimate' };
  }
  if (basis === 'up_to_anticipated_cost') {
    return { amount: total, ceiling: true, basisText: 'up to the full anticipated cost ($' + total.toFixed(2) + ')' };
  }
  if (basis === 'tiered') {
    return { amount: null, ceiling: false, basisText: 'tiered (not yet implemented - map 4.2)' };
  }
  return { amount: 0, ceiling: false, basisText: 'no advance payment' };
}

function humanWindow(w) {
  if (!w) return null;
  return w.days + ' ' + (w.unit || 'calendar') + ' day' + (w.days === 1 ? '' : 's') +
         ' from when the estimate is ' + (w.from === 'notice_received' ? 'received' : 'sent') +
         ', or the request is ' + (w.onExpiry || 'closed');
}

function buildSummary(gate, fp, total) {
  switch (gate) {
    case 'invoice_on_completion':
      return 'Estimate $' + total.toFixed(2) + ': no advance payment. Work proceeds; records are released and the requestor is invoiced on completion.';
    case 'estimate_acceptance':
      return 'Estimate $' + total.toFixed(2) + ': requestor must accept the estimate before work begins; no deposit.' +
        (fp.dueWindowText ? ' Acceptance due ' + fp.dueWindowText + '.' : '');
    case 'deposit_before_work':
      return 'Estimate $' + total.toFixed(2) + ': advance payment (' + (fp.basisText || '') + ') required before work begins' +
        (fp.dueWindowText ? '; due ' + fp.dueWindowText : '') +
        (fp.creditedToFinal ? '; credited to the final invoice.' : '.');
    case 'pay_in_full_before_release':
      return 'Estimate $' + total.toFixed(2) + ': work proceeds; records are released only after the fee is paid in full.';
    default:
      return 'Estimate $' + total.toFixed(2) + '.';
  }
}

function resolvePaymentPlan(pt, ctx) {
  pt = pt || {}; ctx = ctx || {};
  var total = num(ctx.estimateTotal);
  var sel = selectBand(pt.bands || [], total);
  var band = sel.band || {};
  var gate = band.gate || 'invoice_on_completion';
  var deliveryTrigger = band.deliveryTrigger || gate;
  var notes = [];

  var estimateRequired = pt.estimateRequiredOver === 'on_request'
    ? false
    : total > num(pt.estimateRequiredOver);

  // Delinquency override (map 8.1 TX; MI 100% deposit): a prior unpaid balance can
  // force a deposit even in a band that normally takes none.
  var fpCfg = pt.firstPayment || {};
  var depositForced = false;
  if (ctx.delinquent && pt.delinquent) {
    depositForced = true;
    gate = 'deposit_before_work';
    deliveryTrigger = 'deposit_before_work';
    notes.push('Delinquent requestor: prior unpaid balance forces an advance payment (' +
      (pt.delinquent.depositPercent || 100) + '% of estimate) regardless of band.');
    fpCfg = { basis: 'percent', percent: pt.delinquent.depositPercent || 100, cap: null,
              dueWindow: fpCfg.dueWindow, creditedToFinal: fpCfg.creditedToFinal };
  }

  var firstPayment;
  if (gate === 'deposit_before_work') {
    var amt = firstPaymentAmount(fpCfg, total);
    firstPayment = {
      required: true, kind: 'deposit', basis: fpCfg.basis || 'up_to_anticipated_cost',
      amount: amt.amount, isCeiling: amt.ceiling, basisText: amt.basisText,
      dueWindow: fpCfg.dueWindow || null, dueWindowText: humanWindow(fpCfg.dueWindow),
      creditedToFinal: fpCfg.creditedToFinal !== false
    };
  } else if (gate === 'estimate_acceptance') {
    firstPayment = { required: false, kind: 'acceptance', basis: 'none',
      note: 'Requestor must accept the estimate before work begins; no money up front.',
      dueWindow: fpCfg.dueWindow || null, dueWindowText: humanWindow(fpCfg.dueWindow) };
  } else {
    firstPayment = { required: false, kind: 'none', basis: 'none' };
  }

  var sp = pt.secondPayment || {};
  var secondPayment = {
    basis: sp.basis || 'actual',
    terms: sp.terms || null,
    dueWindow: sp.dueWindow || null, dueWindowText: humanWindow(sp.dueWindow)
  };

  if (pt.agencyEstimateDeadline) {
    notes.push('Agency must issue the estimate within ' + pt.agencyEstimateDeadline.days +
      ' ' + (pt.agencyEstimateDeadline.unit || 'business') + ' days.');
  }

  return {
    estimateRequired: estimateRequired,
    band: { index: sel.index, upTo: band.upTo != null ? band.upTo : null, label: band.label || null },
    gate: gate,
    firstPayment: firstPayment,
    deliveryTrigger: deliveryTrigger,
    secondPayment: secondPayment,
    summary: buildSummary(gate, firstPayment, total),
    notes: notes,
    depositForced: depositForced
  };
}

// Build a minimal paymentTiming config from a legacy fee profile's requestRules, for
// jurisdictions that don't yet carry a dedicated paymentTiming block. Lossy: bands come
// from estimateNotifyThreshold + deposit.threshold; due-windows are unknown (null) since
// legacy config never captured them. Callers flag the result as 'derived'.
function deriveDefaultPaymentTiming(config) {
  config = config || {};
  var rules = config.requestRules || {};
  var dep = rules.deposit || {};
  var notifyOver = rules.estimateNotifyThreshold;
  var depThr = dep.threshold;
  var bands = [];
  if (notifyOver != null && depThr != null && num(depThr) > num(notifyOver)) {
    bands.push({ upTo: num(notifyOver), gate: 'invoice_on_completion', deliveryTrigger: 'invoice_on_completion' });
    bands.push({ upTo: num(depThr), gate: 'estimate_acceptance', deliveryTrigger: 'estimate_acceptance' });
    bands.push({ upTo: null, gate: 'deposit_before_work', deliveryTrigger: 'deposit_before_work' });
  } else if (depThr != null) {
    bands.push({ upTo: num(depThr), gate: 'estimate_acceptance', deliveryTrigger: 'invoice_on_completion' });
    bands.push({ upTo: null, gate: 'deposit_before_work', deliveryTrigger: 'deposit_before_work' });
  } else {
    bands.push({ upTo: null, gate: 'invoice_on_completion', deliveryTrigger: 'invoice_on_completion' });
  }
  var firstPayment;
  if (dep.percent != null) {
    firstPayment = { basis: 'percent', percent: num(dep.percent), cap: null, dueWindow: null, creditedToFinal: true };
  } else {
    firstPayment = { basis: 'up_to_anticipated_cost', cap: 'estimate', dueWindow: null, creditedToFinal: true };
  }
  return {
    estimateRequiredOver: notifyOver != null ? num(notifyOver) : 0,
    bands: bands,
    firstPayment: firstPayment,
    secondPayment: { basis: 'actual', terms: null },
    delinquent: null,
    _derived: true
  };
}

// Map a resolved gate to the request workflow stage applied on estimate acceptance.
// deposit_before_work holds the request at awaiting_payment; every other gate proceeds
// to record_search (work begins; pay-in-full / invoice-on-completion are enforced later
// at the delivery/release step, not here).
var GATE_STAGE = {
  invoice_on_completion: 'record_search',
  estimate_acceptance: 'record_search',
  deposit_before_work: 'awaiting_payment',
  pay_in_full_before_release: 'record_search'
};
function gateToStage(gate) { return GATE_STAGE[gate] || 'record_search'; }

// Balance math: effective total (reconciled actual if present, else estimate) minus deposit +
// final paid to date. paidInFull tolerates a half-cent rounding epsilon.
function computeBalance(effectiveTotal, depositPaid, finalPaid) {
  var eff = Number(effectiveTotal) || 0;
  var paid = (Number(depositPaid) || 0) + (Number(finalPaid) || 0);
  var bal = Math.round((eff - paid) * 100) / 100;
  return { effectiveTotal: Math.round(eff*100)/100, paid: Math.round(paid*100)/100, balanceDue: Math.max(0, bal), paidInFull: bal <= 0.005 };
}

module.exports = { resolvePaymentPlan: resolvePaymentPlan, deriveDefaultPaymentTiming: deriveDefaultPaymentTiming, selectBand: selectBand, gateToStage: gateToStage, computeBalance: computeBalance, GATES: GATES };
