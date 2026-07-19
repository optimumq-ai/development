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

async function releaseGate(rid) {
  var est = await snapshot(rid, 'estimate');
  if (!est) {
    return { hasEstimate: false, requiresPaymentBeforeRelease: false, covered: true, paidInFull: true,
             balanceDue: 0, componentCharged: null, coverageBasis: 'no_estimate', plan: null, paymentInstructions: null };
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
  // Cent-tolerant: an off-by-$0.01 rounding artefact must not withhold a finished record.
  var covered = paid + 0.005 >= charged;
  var shortfall = covered ? 0 : Math.round((charged - paid) * 100) / 100;

  return {
    hasEstimate: true,
    requiresPaymentBeforeRelease: pt.requiresPaymentBeforeRelease(plan),
    // §5.9 coverage — THIS record's share, and what is owed on it alone.
    covered: covered,
    componentCharged: share ? share.amount : null,
    coverageBasis: basis,
    balanceDue: shortfall,
    unpricedActuals: !!(share && share.unpricedActuals),
    // Request-level figures, retained for display and for the fallback path.
    paidInFull: bal.paidInFull, requestBalanceDue: bal.balanceDue, effectiveTotal: bal.effectiveTotal,
    plan: plan, paymentInstructions: cfg.paymentInstructions || null
  };
}

// ⚠️ NOT YET REQUIRED, BUT REQUIRED BEFORE THE MONEY AXIS MOVES TO THE PARENT.
// Today each child carries its own estimate and therefore its own payment pool, so per-child coverage is
// self-contained. Once one parent-level estimate funds n children from ONE pool, coverage must become
// CUMULATIVE over already-released siblings (§5.10.3: "a deposit already collected is credited FIFO against
// the earliest installments"), i.e.
//     required = Σ componentCharged(already released) + componentCharged(this one)
// Releasing three $20 children against $50 paid must release two and hold the third — not release all three
// because each is individually under $50. Note this is still not "withheld because a sibling is unpaid": the
// money was spent on records the citizen already received.
module.exports = { releaseGate: releaseGate, pricedSnapshot: pricedSnapshot };
