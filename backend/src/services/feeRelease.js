'use strict';
// RELEASE GATE — is the money behind THIS record settled, so it may be released?
//
// §5.9 (SPEC_parent_child_lifecycle.md) is the governing rule and it is a legal one:
//
//     "A child may NEVER be withheld because a SIBLING is unpaid."
//
// No state authorizes conditioning release of one record on payment for a different record. Every statute
// ties the payment hook to *the copies being provided* — TX "charges ACCRUED" (§ 552.221(b)(2)), CA "direct
// costs of DUPLICATION" (§ 7922.530(a)), NY "the fee prescribed THEREFOR" (§ 89(3)(a)) — and TX § 552.221(a)
// ("shall promptly produce") and CA § 7922.500 (no "delay or obstruct") cut against sitting on finished
// records. So the gate is a COVERAGE test against this record's own share, never a whole-request balance test.
//
// WHAT THIS USED TO DO, AND WHY IT WAS WRONG: it compared the request's whole balance
// (`total − deposit − final`) and blocked on `!paidInFull`. On a multi-record request that withholds a
// finished, paid-for record because a *different* record's money has not arrived — precisely what §5.9
// forbids. It was invisible because there was no per-record price in the system to compare against.
//
// There is now: `componentCharged` (§5.10.2, generalized prorata). This resolves it.
//
// FOR A SINGLE-RECORD REQUEST THIS IS AN EXACT NO-OP. With one component,
// `componentCharged = componentGross × (total / grossSubtotal) = total`, so coverage and paid-in-full are the
// same test. That is the point: adopt the correct predicate while it is still an identity, exactly as
// `services/requestScope.js` did for the parent/child migration.
//
// Read-only. FAILS OPEN — the caller treats any error as "no gate", so a gate fault can never block an
// unrelated transition, and can never wrongly withhold a record.
var db = require('../db');
var pt = require('./paymentTiming');

// The priced snapshot covering this row: its OWN estimate, or its PARENT's.
//
// Today every UI path writes estimates keyed on the CHILD, so the first term hits. The money axis is
// specified to live on the PARENT (§4.3) and has not moved yet (§3.1b of the processing brief); when it
// does, the second term hits and this function keeps working unchanged.
var COVERING = "request_id IN (?, (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?))";

async function snapshot(rid, kind) {
  return await db.get(
    "SELECT * FROM request_fee_estimates WHERE " + COVERING + " AND kind = ? ORDER BY created_at DESC LIMIT 1",
    [rid, rid, kind]);
}

// This row's share of the request total. Returns null when it cannot be determined, so the caller can fall
// back rather than guess — an unresolvable share must never silently become $0 (which would release free) or
// the whole total (which would over-withhold).
function shareFor(rid, feeContextJson) {
  var fc = {};
  try { fc = JSON.parse(feeContextJson || '{}'); } catch (e) { return null; }
  var comps = fc.components || [];
  for (var i = 0; i < comps.length; i++) {
    if (comps[i] && comps[i].id === rid && typeof comps[i].componentCharged === 'number') {
      return { amount: comps[i].componentCharged, unpricedActuals: !!comps[i].hasUnpricedActuals };
    }
  }
  return null;
}

// THE SNAPSHOT WHOSE COMPONENTS AND TOTAL GOVERN, for one request.
//
// Exported because there are now THREE consumers of this rule — the release gate below, the ERP line-item
// payload (`erpSettlement`), and revenue attribution (`revenueAllocation`, which keeps its own bulk loader
// because it reads every request at once, and carries a pointer back here). They MUST agree: a record released
// against one split and billed against another is a defect nobody would find from either side alone.
async function pricedSnapshot(rid) {
  var est = await snapshot(rid, 'estimate');
  if (!est) return null;
  var recon = await snapshot(rid, 'reconciliation');
  // A reconciliation supersedes the estimate on BOTH axes — the total and the per-component split.
  return (recon && recon.total != null) ? recon : est;
}

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ── PHASE 7 / BW7 — CUMULATIVE FIFO COVERAGE (§5.10.3), AND THE FROZEN QUOTE IT RUNS ON ─────────
//
// This is the upgrade the footer of this file has flagged since `bd9befa`, now required because the parent
// financial view (Draft 7 §0, decided with Kevin 2026-07-28) reads coverage per item off ONE funds pool.
//
// KEVIN'S DECIDED SETTLEMENT METHOD, and the two halves of it that live in this function:
//
//   1. QUOTED SHARES ARE FROZEN AT ESTIMATE ACCEPTANCE. The gate reads the ACCEPTED estimate snapshot's
//      §5.10.2 prorata shares — never a reconciliation's. Actuals NEVER touch the release gate; a per-item
//      "actual" does not exist until every sibling has actuals, so a gate that consulted them would be
//      provisional and ORDER-DEPENDENT — the exact property §5.10.2 was designed to kill.
//   2. THE CHECK IS A RUNNING FUNDS BALANCE. available − Σ quoted shares of records ALREADY SHIPPED, and a
//      ready record ships when what is left covers its own quoted share. Three $20 items against $50 paid
//      release two and hold the third. A DENIED / NEVER-SHIPPED item's share NEVER consumes funds.
//
// THIS IS STILL NOT "WITHHELD BECAUSE A SIBLING IS UNPAID" (§5.9, which is a legal line). The money was not
// withheld by anybody — it was SPENT, on records the citizen has already received. The predicate is still
// "is THIS record's own share covered", asked of a pool that earlier releases have drawn down.
//
// ══ WHY IT CANNOT CHANGE A LIVE OUTCOME, WHICH IS THE HARD CONSTRAINT ══
//
// It applies ONLY when ONE priced snapshot names MORE THAN ONE request row — i.e. genuinely one pool funding
// n records. Today every UI path writes the estimate on the row it is looking at, so a single-record request
// (and each self-funded child) has exactly one component naming itself, `others` is empty, and this function
// returns `applies: false` before reading anything else. The gate then runs the code it ran yesterday, to
// the character — including recon-supersedes-estimate, which stays the basis on the single-pool path
// precisely BECAUSE changing it there would release records against an unpaid overage. §0's frozen-quote
// rule is applied where §0 applies, and nowhere else.
//
// AVAILABLE FUNDS = paid − refunds + credits. A credit is a dollar the citizen no longer owes; against a
// FROZEN quoted requirement, crediting the pool is arithmetically identical to shrinking the frozen share
// and does not require un-freezing it. So a withholding credit on item 2 correctly frees item 3.

// The ACCEPTED quote — the frozen basis. Falls back to the latest estimate when nothing is accepted yet: an
// un-accepted quote is still the quote, the freeze marker is simply absent, and reported as such.
async function acceptedQuote(rid) {
  var q = await db.get(
    "SELECT * FROM request_fee_estimates WHERE " + COVERING + " AND kind = 'estimate' AND accepted_at IS NOT NULL " +
    "ORDER BY accepted_at DESC LIMIT 1", [rid, rid]);
  return q || null;
}

// AFFIRMATIVE EVIDENCE ONLY. A record consumes funds when there is positive proof it went out the door:
// a released fulfilled_record, or the delivery stage (the reading `paymentStatus.computeSituation` already
// uses for `delivered`). Closure ALONE is never proof — a closure is just as likely a denial, a withdrawal
// or a no-records finding, and §0 is explicit that those shares never consume. The unknown case therefore
// resolves to "did not consume", which is also the direction that can only ever RELEASE a finished record
// rather than withhold one: over-counting consumption is the §5.9 failure, and it is the worse one.
async function shippedAmong(ids) {
  var out = {};
  if (!ids || !ids.length) return out;
  var ph = ids.map(function () { return '?'; }).join(',');
  var rows = [];
  try {
    rows = await db.all(
      "SELECT r.id, r.stage, r.status, r.closure_reason, " +
      "  (SELECT COUNT(*) FROM fulfilled_records fr WHERE fr.request_id = r.id AND fr.status = 'released') AS released_count " +
      "FROM requests r WHERE r.id IN (" + ph + ")", ids);
  } catch (e) { rows = []; }
  rows.forEach(function (r) {
    if (Number(r.released_count) > 0) out[r.id] = { shipped: true, evidence: 'a released record output' };
    else if (r.stage === 'delivery') out[r.id] = { shipped: true, evidence: 'the delivery stage' };
    else if (r.status === 'closed') out[r.id] = { shipped: false, evidence: 'closed without delivery (' + (r.closure_reason || 'no reason recorded') + ') — its share never consumes funds' };
    else out[r.id] = { shipped: false, evidence: 'not yet delivered' };
  });
  ids.forEach(function (id) { if (!out[id]) out[id] = { shipped: false, evidence: 'row not found — treated as never shipped' }; });
  return out;
}

// The FUNDS POOL for one request tree: what was actually received, net of refunds, plus credits.
async function poolFunds(rid) {
  var ids = [rid];
  try { ids = await require('./paymentStatus').moneyTreeIds(rid); } catch (e) { ids = [rid]; }
  var ph = ids.map(function () { return '?'; }).join(',');
  var paid = 0;
  try {
    var estRows = await db.all(
      "SELECT DISTINCT ON (request_id) request_id, deposit_paid_amount, final_paid_amount FROM request_fee_estimates " +
      "WHERE request_id IN (" + ph + ") AND kind = 'estimate' ORDER BY request_id, created_at DESC", ids);
    estRows.forEach(function (e) { paid = r2(paid + (Number(e.deposit_paid_amount) || 0) + (Number(e.final_paid_amount) || 0)); });
  } catch (e) { paid = 0; }
  var credits = 0, refunds = 0;
  try {
    var a = await db.get("SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END),0) AS c, " +
      "COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END),0) AS r FROM fee_adjustments " +
      "WHERE request_id IN (" + ph + ") AND COALESCE(voided,0) = 0", ids);
    credits = r2(a && a.c); refunds = r2(a && a.r);
  } catch (e) { credits = 0; refunds = 0; }
  var objCred = 0;
  try {
    var o = await db.get("SELECT COALESCE(SUM(resolution_amount),0) AS c FROM objections WHERE request_id IN (" + ph + ") " +
      "AND status = 'resolved' AND approval_status = 'approved' AND resolution_type IN ('reduction','waiver','write_off')", ids);
    objCred = r2(o && o.c);
  } catch (e) { objCred = 0; }
  credits = r2(credits + objCred);
  return { paid: paid, credits: credits, refunds: refunds, available: r2(paid - refunds + credits), treeIds: ids };
}

// Does one pool fund several records, and if so what does this one need? Returns `applies: false` for every
// single-pool request, which is every request in the system until the money axis moves to the parent.
async function cumulative(rid, ownShareFallback) {
  var out = { applies: false, reason: 'one priced snapshot, one record — coverage is self-contained' };

  // ── AFTER TERMINAL SETTLEMENT, THE FROZEN SHARES STOP GOVERNING (Draft 7 §0.3) ──
  //
  // The last record settles the request, and at that moment the request is ONE BILL again — exactly the
  // regime a single-record request has always run: final delivery against final payment. So the basis
  // switches from "your share of a frozen quote" to "the settled balance", which is the only reading under
  // which "held until that payment, or releases IMMEDIATELY when the adjustment nets to refund or zero" is
  // true. Holding the last record against frozen shares that a downward reconciliation has just superseded
  // would withhold a finished record over money nobody owes.
  //
  // UNREACHABLE OUTSIDE AN MRR. `settlement_at` is written by exactly one function — parentFinance.settle —
  // which refuses anything that is not a multi-record request at a real terminal state.
  var settleRow = null;
  try {
    settleRow = await db.get('SELECT settlement_at, settlement_outcome FROM requests WHERE id = ' +
      '(SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?)', [rid]);
  } catch (e) { settleRow = null; }
  if (settleRow && settleRow.settlement_at) {
    var net = null;
    try { net = await require('./parentFinance').netting(rid); } catch (e) { net = null; }
    var due = net ? Math.max(0, Number(net.balanceDue) || 0) : 0;
    return {
      applies: true, settled: true,
      settlementAt: settleRow.settlement_at, settlementOutcome: settleRow.settlement_outcome || null,
      // Expressed as required-against-available so the caller's one coverage comparison stays the only one in
      // the file: nothing is available to draw on, and what is required is what is still owed on the request.
      required: r2(due), available: 0, ownQuotedShare: null, siblings: [], consumedByShipped: 0,
      funds: net ? { paid: net.paidGross, credits: net.credits, refunds: net.refundsIssued, available: r2(net.paidGross - net.refundsIssued + net.credits) } : null,
      reason: due > 0
        ? ('This request has been settled and $' + due.toFixed(2) + ' is still due on it. The last record is held ' +
           'against that final payment — the same final-delivery-against-final-payment regime a single-record ' +
           'request runs (§0.3, and the §5.9 footnote records why it is the whole balance rather than one share).')
        : ('This request has been settled and nothing is owed' +
           (settleRow.settlement_outcome === 'refund' ? ' — it nets to a refund' : '') +
           '. Coverage is satisfied; nothing is held.'),
      ownShareOnly: 'Frozen per-item shares governed until settlement. After it the request is one bill again, ' +
        'which is what makes "releases immediately when the adjustment nets to refund or zero" true.'
    };
  }

  var quote = await acceptedQuote(rid);
  var fallbackQuote = false;
  if (!quote) { quote = await snapshot(rid, 'estimate'); fallbackQuote = true; }
  if (!quote) return out;
  var qfc = {}; try { qfc = JSON.parse(quote.fee_context_json || '{}'); } catch (e) { return out; }
  var comps = (qfc.components || []).filter(function (c) { return c && c.id && typeof c.componentCharged === 'number'; });
  var mine = null, others = [];
  comps.forEach(function (c) { if (c.id === rid) mine = c; else others.push(c); });
  if (!mine || !others.length) return out;

  var shipped = await shippedAmong(others.map(function (c) { return c.id; }));
  var consumed = 0;
  var ledger = others.map(function (c) {
    var s = shipped[c.id] || { shipped: false, evidence: 'unknown' };
    if (s.shipped) consumed = r2(consumed + c.componentCharged);
    return { id: c.id, label: c.label || null, quotedShare: r2(c.componentCharged),
             shipped: !!s.shipped, consumes: !!s.shipped, evidence: s.evidence };
  });
  var funds = await poolFunds(rid);
  var own = r2(mine.componentCharged);
  return {
    applies: true,
    reason: 'one accepted quote prices ' + (others.length + 1) + ' records from ONE funds pool, so coverage is cumulative (§5.10.3).',
    quoteEstimateId: quote.id, frozenAt: quote.accepted_at || null, frozenBy: quote.accepted_by || null,
    quoteFrozen: !fallbackQuote && !!quote.accepted_at,
    quoteBasisNote: (!fallbackQuote && quote.accepted_at)
      ? 'Quoted shares frozen at estimate acceptance. Actuals never move this gate.'
      : 'No accepted estimate yet — the latest quote is the basis, and the freeze marker is absent.',
    ownQuotedShare: own,
    siblings: ledger, consumedByShipped: consumed,
    required: r2(consumed + own),
    funds: funds, available: funds.available,
    ownShareOnly: 'The test is still this record’s OWN share against what is left in the pool. A sibling’s ' +
      'unpaid balance is never a reason to withhold this one (§5.9); already-shipped siblings drew the pool ' +
      'down because the citizen received those records.',
    fallbackOwnShare: r2(ownShareFallback)
  };
}

async function releaseGate(rid) {
  var est = await snapshot(rid, 'estimate');
  if (!est) {
    return { hasEstimate: false, requiresPaymentBeforeRelease: false, covered: true, paidInFull: true,
             balanceDue: 0, componentCharged: null, coverageBasis: 'no_estimate', coverageMode: 'self', cumulative: null,
             plan: null, paymentInstructions: null };
  }
  var prof = est.config_profile_id
    ? await db.get('SELECT config_json FROM fee_profiles WHERE id = ?', [est.config_profile_id])
    : await db.get("SELECT config_json FROM fee_profiles WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1");
  var cfg = {}; try { cfg = JSON.parse((prof && prof.config_json) || '{}'); } catch (e) { cfg = {}; }
  var ptCfg = (cfg.paymentTiming && Object.keys(cfg.paymentTiming).length) ? cfg.paymentTiming : pt.deriveDefaultPaymentTiming(cfg);
  var plan = pt.resolvePaymentPlan(ptCfg, { estimateTotal: Number(est.total) || 0 });

  // A reconciliation supersedes the estimate on BOTH axes — the total and the per-component split — so read
  // the share from whichever snapshot set the effective total, or the two would disagree.
  var recon = await snapshot(rid, 'reconciliation');
  var priced = (recon && recon.total != null) ? recon : est;
  var effectiveTotal = Number(priced.total) || 0;
  var bal = pt.computeBalance(effectiveTotal, est.deposit_paid_amount, est.final_paid_amount);

  var share = shareFor(rid, priced.fee_context_json);
  // FALLBACK — an estimate priced before componentCharged existed, or one whose components do not name this
  // row. Fall back to the whole-request test, which is the PREVIOUS behaviour: stricter than §5.9 requires,
  // never more permissive. Reported honestly as `coverageBasis` so a caller can tell the two apart.
  var charged = share ? share.amount : effectiveTotal;
  var basis = share ? 'component' : 'request_total';

  var paid = (Number(est.deposit_paid_amount) || 0) + (Number(est.final_paid_amount) || 0);

  // ── CUMULATIVE FIFO, WHEN AND ONLY WHEN ONE POOL FUNDS SEVERAL RECORDS (§5.10.3 / Draft 7 §0.2) ──
  // `applies: false` on every single-pool request, and then `required`/`funds` below are yesterday's
  // figures unchanged. See the block above cumulative() for why this cannot move a live outcome.
  var cum = null;
  try { cum = await cumulative(rid, charged); } catch (e) { console.error('[feeRelease cumulative]', e && e.message); cum = null; }
  var fifo = !!(cum && cum.applies);
  var required = fifo ? cum.required : charged;
  var funds = fifo ? cum.available : paid;
  // `coverageBasis` DELIBERATELY DOES NOT CHANGE. It answers "where did this record's share come from" —
  // a component, or the whole-request fallback — and existing callers and harnesses read it for exactly that.
  // WHICH RULE was applied is a different question and gets its own field, `coverageMode`. Overloading the
  // one string would have quietly broken every reader of it to say something it was never asked.
  var mode = fifo ? (cum.settled ? 'settled' : 'cumulative') : 'self';

  // Cent-tolerant: an off-by-$0.01 rounding artefact must not withhold a finished record.
  var covered = funds + 0.005 >= required;
  var shortfall = covered ? 0 : r2(required - funds);

  return {
    hasEstimate: true,
    requiresPaymentBeforeRelease: pt.requiresPaymentBeforeRelease(plan),
    // §5.9 coverage — THIS record's share, and what is owed on it alone.
    covered: covered,
    componentCharged: (fifo && cum.ownQuotedShare != null) ? cum.ownQuotedShare : (share ? share.amount : null),
    coverageBasis: basis,
    balanceDue: shortfall,
    // The cumulative-FIFO picture, present only when it applied. `coverageRequired` is what the pool had to
    // cover for THIS release; `coverageAvailable` is what was in it. Both are here so the financial view can
    // show the running balance per row without recomputing the rule.
    cumulative: fifo ? cum : null,
    coverageMode: mode,
    coverageRequired: r2(required),
    coverageAvailable: r2(funds),
    unpricedActuals: !!(share && share.unpricedActuals),
    // Request-level figures, retained for display and for the fallback path.
    paidInFull: bal.paidInFull, requestBalanceDue: bal.balanceDue, effectiveTotal: bal.effectiveTotal,
    plan: plan, paymentInstructions: cfg.paymentInstructions || null
  };
}

// ✅ BUILT (BW7, 2026-07-29). The cumulative-FIFO rule this footer flagged from `bd9befa` onward is now in
// `cumulative()` above:
//     required = Σ quotedShare(already SHIPPED siblings) + quotedShare(this one)
// against available funds (paid − refunds + credits). Three $20 children against $50 paid release two and
// hold the third. A denied / never-shipped sibling's share never consumes. Dormant on every single-pool
// request, which is every request until the money axis moves to the parent (§4.3).
module.exports = {
  releaseGate: releaseGate, pricedSnapshot: pricedSnapshot,
  // Exported for the parent financial view (services/parentFinance) and its harness. They MUST read the rule
  // from here rather than restate it — a screen that shows one running balance while the gate uses another is
  // a defect nobody would find from either side alone (the same reason `pricedSnapshot` is shared).
  acceptedQuote: acceptedQuote, cumulative: cumulative, poolFunds: poolFunds, shippedAmong: shippedAmong
};
