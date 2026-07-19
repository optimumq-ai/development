'use strict';
// COLLECTED REVENUE, ATTRIBUTED TO THE RECORD IT WAS COLLECTED FOR.
//
// Two separate problems are solved here, and they are easy to confuse:
//
//   1. WHERE THE MONEY IS. `requests.amount_paid` has NEVER had a writer — `reportEngine` was the single
//      reference to it in the whole codebase, so `fee_revenue` was structurally $0 on every dashboard and
//      report. Money is recorded on `request_fee_estimates.deposit_paid_amount` / `final_paid_amount` (written
//      by `routes/feeEstimates.js` and `routes/settlement.js`). That is the source of truth and this reads it.
//
//   2. WHICH DEPARTMENT EARNED IT. Revenue is collected ONCE against a request; a department belongs to the
//      individual RECORDS inside it. A request whose records span two departments has one payment and two
//      departments. Attributing it needs an allocation rule, and `fee_revenue by department` was recorded
//      UNDEFINED (HANDOFF 2026-07-14 (tm)) for exactly that reason — a join would double-count the payment
//      into both departments and the columns would not sum to the total.
//
// SPEC §5.10.2 defines the rule, and §5.10.4 names this as one of the three features blocked on it:
//
//     componentCharged[i] = componentGross[i] × (total / grossSubtotal)
//
// so each record already carries a price that sums to the request total. Collected money is attributed in the
// same proportion:
//
//     revenue[i] = paid × (componentCharged[i] / Σ componentCharged)
//
// This is order-independent and vehicle-ignorant for the same reason the pricing rule is, and the columns sum
// to the collected total by construction — the property whose absence made the cut undefined.
//
// AT n = 1 THIS IS AN EXACT IDENTITY. One component ⇒ its share is the whole payment ⇒ revenue lands wholly on
// that record's department, which is the trivially correct answer. That is deliberate: adopt the correct
// predicate while it is still an identity, exactly as `requestScope.js` did for the parent/child migration and
// `feeRelease.js` did for the release gate.
//
// Read-only.
var db = require('../db');

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function num(n) { return Number(n) || 0; }

// The snapshots that matter for one request, resolved exactly as `feeRelease.js` does — the two MUST agree, or
// a record could be released against one split and booked against another.
//
//   PAYMENTS come from the latest `estimate` row: `deposit_paid_amount` / `final_paid_amount` are written
//   there and a reconciliation does not carry them.
//   THE SPLIT comes from the latest `reconciliation` if one exists, else the estimate — a reconciliation
//   supersedes on BOTH axes (the total and the per-component split).
async function snapshots() {
  var rows = await db.all(
    "SELECT id, request_id, kind, total, fee_context_json, deposit_paid_amount, final_paid_amount, created_at " +
    "FROM request_fee_estimates WHERE kind IN ('estimate','reconciliation') ORDER BY created_at ASC, id ASC");
  var byReq = {};
  rows.forEach(function (row) {
    var k = row.request_id;
    if (!byReq[k]) byReq[k] = { estimate: null, reconciliation: null };
    // ordered ascending, so the last write of each kind wins = the latest
    if (row.kind === 'estimate') byReq[k].estimate = row;
    else byReq[k].reconciliation = row;
  });
  return byReq;
}

function componentsOf(snap) {
  if (!snap) return [];
  var fc = {};
  try { fc = JSON.parse(snap.fee_context_json || '{}'); } catch (e) { return []; }
  return Array.isArray(fc.components) ? fc.components : [];
}

// Split one request's collected money across its components.
//
// Returns [{ requestId, amount, basis }]. `basis` is reported rather than hidden so a caller can tell an
// allocated figure from an unallocated one:
//   'component'     — split by componentCharged (the §5.10.2 rule)
//   'request_total' — the whole payment attributed to the request the estimate is keyed on. This is the
//                     honest fallback for an estimate priced BEFORE componentCharged existed, or one whose
//                     components carry no charged figure. It is never a guess: the money provably belongs to
//                     that request, we simply cannot say which record inside it earned the money. It matches
//                     `feeRelease`'s fallback of the same name.
function splitOne(requestId, paid, comps) {
  var priced = comps.filter(function (c) { return c && typeof c.componentCharged === 'number'; });
  var sum = 0;
  priced.forEach(function (c) { sum += num(c.componentCharged); });
  sum = r2(sum);

  // No usable split — attribute to the request the money was collected against.
  // ⚠️ `sum <= 0` is REACHABLE, not defensive: a fully waived or de-minimis request prices every component at
  // 0 (`feeEngine` reports `basis: 'nothing_priced'`). Dividing by it would be NaN, and NaN silently poisons
  // every SUM it reaches. If nothing was priced and yet money was collected, we cannot say which record
  // earned it, so it stays whole.
  if (!priced.length || sum <= 0) return [{ requestId: requestId, amount: r2(paid), basis: 'request_total' }];

  var out = [], running = 0;
  priced.forEach(function (c) {
    var amt = r2(paid * (num(c.componentCharged) / sum));
    running = r2(running + amt);
    out.push({ requestId: c.id, amount: amt, basis: 'component' });
  });

  // Penny residual settles on the LARGEST share, not the last — so the result depends on the SET of
  // components and not on array order. Same rule as `feeEngine.allocateComponents`, and for the same reason:
  // a report that reorders its input must not move a cent between departments.
  var residual = r2(paid - running);
  if (residual !== 0 && out.length) {
    var big = 0;
    for (var i = 1; i < out.length; i++) if (out[i].amount > out[big].amount) big = i;
    out[big].amount = r2(out[big].amount + residual);
  }
  return out;
}

// Every dollar collected, attributed to the record that earned it.
// Returns [{ requestId, amount, basis, paidForRequestId }] — `paidForRequestId` is the request the payment was
// actually recorded against (the parent of the money), retained so a caller can apply request-level filters
// (time range, status) to the payer while grouping by the earner.
async function collected() {
  var byReq = await snapshots();
  var out = [];
  Object.keys(byReq).forEach(function (rid) {
    var est = byReq[rid].estimate;
    if (!est) return; // payments only ever live on an estimate row
    var paid = r2(num(est.deposit_paid_amount) + num(est.final_paid_amount));
    if (paid <= 0) return;
    // A reconciliation supersedes the estimate on both axes (see `snapshots`).
    var pricedSnap = (byReq[rid].reconciliation && byReq[rid].reconciliation.total != null)
      ? byReq[rid].reconciliation : est;
    splitOne(rid, paid, componentsOf(pricedSnap)).forEach(function (part) {
      part.paidForRequestId = rid;
      out.push(part);
    });
  });
  return out;
}

module.exports = { collected: collected, splitOne: splitOne };
