'use strict';
// THE ILLINOIS FEE-FORFEITURE GUARDRAIL.
//
// 5 ILCS 140/3(d): "A public body that fails to respond to a request within the requisite periods in this
// Section but thereafter provides the requester with copies of the requested public records MAY NOT IMPOSE A
// FEE FOR SUCH COPIES."
//
// The trap is a HOLD STATE. A request parked in "awaiting fee-waiver decision" keeps aging against IL's
// 5-business-day clock — and deciding a waiver is NOT among the seven enumerated § 3(e) grounds for an
// extension. On day 6 the body has (a) constructively denied the request and (b) PERMANENTLY lost its right
// to charge anything for those copies. The deliberation destroys the fee. Illinois is the only state in the
// researched set where the agency's own delay extinguishes the charge.
//
// So this is not a warning. When the clock is blown in a forfeiture jurisdiction, the system REFUSES to
// generate an invoice. A warning would let a clerk click past it and bill unlawfully.
//
// FAIL-SAFE INVERSION — read this before "fixing" it. Every other policy in this codebase is gated on
// `enabled === true AND the profile section is attested` (AUTO_CONFIG safe-manual default): an unconfigured
// city gets NO automated action. This guardrail deliberately inverts that. It is armed by the FLAG ALONE
// (`fee_forfeiture_on_late_response`), without requiring `enabled` or attestation, because the two failure
// directions are not symmetric:
//   - Blocking an invoice the city was not entitled to charge costs the city NOTHING — the law already says
//     it may not charge.
//   - NOT blocking it means the city bills unlawfully and loses the fee anyway, plus the exposure.
// The safe failure is to block. Defaults keep it off (the flag is false everywhere except IL), so this
// changes nothing for a jurisdiction that has not been seeded with a forfeiture rule.
var db = require('../db');
var FWP = require('./feeWaiverPolicy');
var T = require('./tolling');

// Is fee assessment barred on this request right now?
// Returns { blocked, reason, citation, clock } — blocked=false when the jurisdiction has no forfeiture rule.
async function check(requestId) {
  var policy;
  try { policy = await FWP.read(null); } catch (e) { return { blocked: false }; }
  if (!policy || policy.fee_forfeiture_on_late_response !== true) return { blocked: false };

  var clocks;
  try { clocks = await T.statusForRequest(requestId); } catch (e) { return { blocked: false }; }
  var primary = (clocks || []).filter(function (c) { return c.isPrimary; })[0];
  if (!primary) return { blocked: false };

  // "Blown" = the statutory response clock has expired. A clock that is currently TOLLED is not blown —
  // the count is suspended — so only `expired` bars the fee.
  if (primary.state !== 'expired') {
    return { blocked: false, clock: { state: primary.state, remainingDays: primary.remainingDays } };
  }

  var prov = (policy.provenance && policy.provenance.fee_forfeiture_on_late_response) || {};
  return {
    blocked: true,
    reason: 'The statutory response deadline passed ' + Math.abs(primary.remainingDays) + ' day(s) ago. ' +
            'In this jurisdiction a public body that answers late may not charge a fee for the copies it then provides, ' +
            'so this request can no longer be invoiced.',
    citation: prov.citation || '5 ILCS 140/3(d)',
    clock: { state: primary.state, remainingDays: primary.remainingDays, dueDate: primary.dueDate }
  };
}

// How close is this request to forfeiting its fee? For the warning that precedes the block.
// Returns { atRisk, daysLeft } — atRisk when the clock is running and within `withinDays` of expiry.
async function risk(requestId, withinDays) {
  withinDays = (withinDays == null) ? 1 : withinDays;
  var policy;
  try { policy = await FWP.read(null); } catch (e) { return { atRisk: false }; }
  if (!policy || policy.fee_forfeiture_on_late_response !== true) return { atRisk: false };

  var clocks;
  try { clocks = await T.statusForRequest(requestId); } catch (e) { return { atRisk: false }; }
  var primary = (clocks || []).filter(function (c) { return c.isPrimary; })[0];
  if (!primary || primary.state !== 'running') return { atRisk: false };
  if (primary.remainingDays > withinDays) return { atRisk: false };

  // Only meaningful while a waiver decision is actually outstanding — that is the hold state that eats the
  // clock. (A late request forfeits the fee regardless, but THIS warning is about the waiver deliberation.)
  var req = await db.get("SELECT fee_waiver_requested, fee_waiver_status FROM requests WHERE id = ?", [requestId]);
  var waiverPending = !!(req && req.fee_waiver_requested && (!req.fee_waiver_status || req.fee_waiver_status === 'pending'));

  return {
    atRisk: true,
    waiverPending: waiverPending,
    daysLeft: primary.remainingDays,
    message: waiverPending
      ? 'Deciding the fee waiver is NOT a lawful reason to miss the response deadline here, and missing it forfeits the fee entirely. ' +
        primary.remainingDays + ' day(s) left — decide the waiver and respond, or the city cannot charge for these copies.'
      : 'The response deadline is ' + primary.remainingDays + ' day(s) away. Missing it forfeits the right to charge a fee for these copies.'
  };
}

module.exports = { check: check, risk: risk };
