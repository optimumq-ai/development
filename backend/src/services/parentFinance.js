'use strict';
// PHASE 7 / BW7 — THE PARENT'S MONEY, AS A LEDGER RATHER THAN A RECOMPUTATION.
// (docs/DRAFT_processing_ui_parent_financial.md — §0 is Kevin's DECIDED settlement method, 2026-07-28 r2)
//
// The parent is the request's financial processor. This module is its arithmetic; `routes/parentFinance.js`
// is its API and `pages/ParentFinancialPage.js` is its counter. Payment-TAKING is not here and must never
// move here — that is the Cash Drawer, and this screen links to it.
//
// ══ THE FOUR RULES THIS FILE EXISTS TO OBEY ══
//
//  1. EVENTED, NEVER RECOMPUTED. A figure a demand rests on must be reconstructable (class-A ledger
//     discipline). Every credit and every refund is a row in `fee_adjustments` AND an event on
//     `request_payment_events` through `paymentStatus.recordEvent` — the one money chokepoint every channel
//     already passes through. `netting()` below is a READ over those rows; it is never the source of one.
//  2. NO AUTOMATIC REFUND, EVER. A person issues; the system does the arithmetic and refuses to do more.
//     `refund()` throws without an actor, a method and a reference, and the route gates it on FINANCE.
//     v1 is RECORD-ONLY: the money moves in the city's finance system and this records that it did.
//  3. CREDITS ARE VALUED IN QUOTED NUMBERS AND CITED TO THEIR CAUSE (§0.6). A withholding credit is
//     computed off the FROZEN quoted share, because it can post the day the legal determination lands —
//     while anything derived from measured actuals has to wait for the terminal settlement, when actuals
//     for the whole request exist at all.
//  4. ACTUALS NEVER TOUCH THE RELEASE GATE. That rule lives in `services/feeRelease.cumulative()` and this
//     module READS it rather than restating it. A screen showing one running balance while the gate uses
//     another is a defect neither side could reveal alone.
var db = require('../db');
var uuidv4 = require('uuid').v4;
var FR = require('./feeRelease');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function s(v) { return String(v == null ? '' : v).trim(); }
function bad(msg, code, status) { var e = new Error(msg); e.code = code || 'BAD_REQUEST'; e.status = status || 422; return e; }

// The parent of any row in the tree — money is a PARENT fact (§4.3), so every entry point normalizes first.
async function parentOf(rid) {
  var r = await db.get('SELECT COALESCE(master_request_id, id) AS pid FROM requests WHERE id = ?', [rid]);
  return (r && r.pid) || rid;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE FROZEN QUOTE (§0.1)
//
// The accepted estimate snapshot IS the freeze. `request_fee_estimates` is append-only — a reissue writes a
// NEW row rather than editing this one — so the row stamped `accepted_at` is an immutable record of the
// quoted shares as the requestor accepted them, and no separate frozen-shares table is needed or wanted
// (a second copy of the same numbers is a second thing that can disagree).
//
// `freezeQuote` therefore does not COPY anything. It posts the event that says which snapshot is the basis,
// so the freeze is visible on the statement rather than inferable from a timestamp on another table.
async function quotedShares(rid) {
  var pid = await parentOf(rid);
  var quote = await FR.acceptedQuote(pid);
  var frozen = !!(quote && quote.accepted_at);
  if (!quote) quote = await db.get(
    "SELECT * FROM request_fee_estimates WHERE request_id IN (?, (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?)) " +
    "AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [pid, pid]);
  if (!quote) return { hasQuote: false, frozen: false, components: [],
    note: 'No estimate has been priced for this request yet, so there are no quoted shares to freeze.' };
  var fc = {}; try { fc = JSON.parse(quote.fee_context_json || '{}'); } catch (e) { fc = {}; }
  var comps = (fc.components || []).map(function (c) {
    return {
      id: c.id, label: c.label || null, recordType: c.recordType || null,
      componentGross: r2(c.componentGross),
      quotedShare: (typeof c.componentCharged === 'number') ? r2(c.componentCharged) : null,
      hasUnpricedActuals: !!c.hasUnpricedActuals
    };
  });
  var rl = fc.requestLevel || {};
  var gross = 0; comps.forEach(function (c) { gross = r2(gross + c.componentGross); });
  var total = r2(quote.total);
  var ratio = gross > 0 ? Math.round((total / gross) * 10000) / 10000 : null;
  return {
    hasQuote: true, frozen: frozen, estimateId: quote.id,
    frozenAt: quote.accepted_at || null, frozenBy: quote.accepted_by || null,
    total: total, grossSubtotal: gross, ratio: ratio,
    requestLevelTotal: rl.total != null ? r2(rl.total) : total,
    components: comps,
    // Requestor-explainable, because this is the sentence staff will have to say out loud at the counter.
    explain: ratio == null
      ? 'Nothing priced, so there is no share to explain.'
      : 'Each item’s share is its own priced subtotal times ' + ratio.toFixed(4) + ' — the ratio between what the ' +
        'request was actually charged ($' + total.toFixed(2) + ') and the sum of the item subtotals ($' + gross.toFixed(2) + '). ' +
        'Every request-level rule (labor rounding, free allowances, tiers, floors, ceilings, surcharges) applies to ' +
        'the request as a whole, so this is the one allocation that does not depend on the order the items ship in (§5.10.2).',
    frozenNote: frozen
      ? 'Frozen at estimate acceptance. Measured actuals never move these numbers or the release gate — variances ' +
        'accumulate silently and settle once, on the last record (§0.1, §0.3).'
      : 'NOT YET FROZEN — the requestor has not accepted this estimate. Acceptance is what freezes the shares.'
  };
}

// Posts the freeze event. Idempotent by construction: called from the acceptance path, which itself refuses
// a second acceptance, and a duplicate event would be harmless (it asserts a fact, it does not move money).
async function freezeQuote(rid, opts) {
  opts = opts || {};
  var pid = await parentOf(rid);
  var q = await quotedShares(pid);
  if (!q.hasQuote) return { skipped: true, reason: 'no priced estimate to freeze' };
  try {
    await db.run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, details, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['rh-' + uuidv4().slice(0, 8), pid, opts.actorId || null, opts.actorName || 'Requestor (external)',
       'QUOTED_SHARES_FROZEN',
       'Quoted per-item shares frozen at estimate acceptance — total $' + Number(q.total || 0).toFixed(2) +
       ' across ' + q.components.length + ' item(s). Measured actuals will not move these shares or the release gate.',
       JSON.stringify({ estimateId: q.estimateId, total: q.total, ratio: q.ratio, components: q.components }), nowStr()]);
  } catch (e) { /* history is best-effort; the accepted snapshot is the record of truth */ }
  try {
    await require('./paymentStatus').recordEvent(pid, {
      type: 'quote_frozen', amount: q.total, reference: q.estimateId,
      reason: 'Quoted per-item shares frozen at estimate acceptance (§5.10.2 prorata, computed once). ' +
        'Release coverage reads these; actuals never do.',
      actor: opts.actorName || 'Requestor (external)'
    });
  } catch (e) { console.error('[parentFinance freezeQuote]', e && e.message); }
  return { ok: true, frozen: true, estimateId: q.estimateId, components: q.components };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NETTING (Draft 7 §4.1)
//
//   balance before credits  = max(0, base − paid gross)
//   credits absorbed        = min(credits, balance before credits)      ← credits reduce the balance FIRST
//   refund due              = credits − credits absorbed                 = max(0, credits − balance)
//   refund outstanding      = max(0, refund due − refunds already issued)
//
// A REFUND EXISTS ONLY WHEN CREDITS EXCEED THE BALANCE. That ordering is the whole point: a city does not
// mail a cheque to somebody who still owes it money, and a credit that merely cancels an open balance is
// not a refund and must not be presented as one.
async function netting(rid) {
  var pid = await parentOf(rid);
  var PS = require('./paymentStatus');
  var sit = await PS.computeSituation(pid);
  if (!sit || !sit.hasEstimate) {
    return { hasEstimate: false, base: 0, credits: 0, paidGross: 0, refundsIssued: 0,
             balanceDue: 0, refundDue: 0, refundOutstanding: 0,
             note: 'No estimate on this request, so there is no receivable and nothing to net.' };
  }
  var ids = await PS.moneyTreeIds(pid);
  var ph = ids.map(function () { return '?'; }).join(',');
  var refRow = await db.get("SELECT COALESCE(SUM(amount),0) AS r FROM fee_adjustments WHERE request_id IN (" + ph + ") AND type = 'refund' AND COALESCE(voided,0) = 0", ids);
  var refundsIssued = r2(refRow && refRow.r);
  var base = r2(sit.base);
  var credits = r2(sit.credits);
  var paidGross = r2((Number(sit.totalPaid) || 0) + refundsIssued); // computeSituation reports paid NET of refunds
  var balanceBeforeCredits = Math.max(0, r2(base - paidGross));
  var creditsAbsorbed = r2(Math.min(credits, balanceBeforeCredits));
  var refundDue = r2(credits - creditsAbsorbed);
  var refundOutstanding = Math.max(0, r2(refundDue - refundsIssued));
  var balanceDue = Math.max(0, r2(balanceBeforeCredits - creditsAbsorbed));
  return {
    hasEstimate: true, requestId: pid, treeIds: ids,
    base: base, credits: credits, paidGross: paidGross, paidNet: r2(sit.totalPaid),
    refundsIssued: refundsIssued,
    balanceBeforeCredits: balanceBeforeCredits, creditsAbsorbed: creditsAbsorbed,
    balanceDue: balanceDue, refundDue: refundDue, refundOutstanding: refundOutstanding,
    waived: !!sit.waived, effectiveTotal: r2(sit.effectiveTotal),
    statusCurrent: PS.deriveStatus(sit).current, statusLabel: PS.deriveStatus(sit).label,
    order: 'Credits reduce the open balance first; a refund exists only for what is left over after that.',
    refundRule: 'No refund is ever automatic. Finance issues it, records the method and the reference, and the ' +
      'money moves in the city’s finance system — this screen records that act, it does not perform it.'
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CREDITS — CAUSE-CITED, ON THE PAYMENT STREAM (Draft 7 §4.1)
//
// A credit with no cause is an unexplained reduction of a public receivable, which is the one thing an
// auditor will always ask about. So `causeKind` and `causeRef` are REQUIRED, and the citation is written into
// the row, the event and the history line — three places that must agree, from one string.
var CREDIT_CAUSES = {
  withholding: 'a legal determination withholding part of a delivered set',
  reconciliation: 'a reconciliation of the estimate against measured actuals',
  objection: 'an approved fee objection',
  correction: 'a correction to the priced estimate'
};

async function credit(rid, opts) {
  opts = opts || {};
  var pid = await parentOf(rid);
  var amount = r2(opts.amount);
  if (!(amount > 0)) throw bad('A credit needs an amount greater than zero.', 'AMOUNT_REQUIRED');
  var kind = s(opts.causeKind);
  if (!CREDIT_CAUSES[kind]) throw bad('A credit must cite its cause: one of ' + Object.keys(CREDIT_CAUSES).join(', ') +
    '. An unexplained reduction of a public receivable is not something this system will write.', 'CAUSE_REQUIRED');
  var ref = s(opts.causeRef);
  if (!ref) throw bad('A credit must carry the reference of the thing that caused it (the determination, the ' +
    'reconciliation snapshot, the objection). "Because staff said so" is not a citation.', 'CAUSE_REF_REQUIRED');
  var actor = s(opts.actorName);
  if (!actor) throw bad('A credit is a person’s act and is recorded against them.', 'ACTOR_REQUIRED');
  var target = s(opts.itemRequestId) || pid;
  var cite = s(opts.reason) || ('Credit — ' + CREDIT_CAUSES[kind] + ' (' + ref + ').');

  var id = 'feeadj-' + uuidv4().slice(0, 8);
  await db.run('INSERT INTO fee_adjustments (id, request_id, type, amount, reason, actor, created_at, voided, ' +
    'reference, cause_kind, cause_ref, approver) VALUES (?,?,?,?,?,?,?,0,?,?,?,?)',
    [id, target, 'credit', amount, cite, actor, nowStr(), ref, kind, ref, s(opts.approver) || null]);
  try {
    await db.run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
      ['rh-' + uuidv4().slice(0, 8), target, opts.actorId || null, actor, 'FEE_CREDIT_POSTED',
       'Credit $' + amount.toFixed(2) + ' — ' + cite, nowStr()]);
  } catch (e) { /* best effort */ }
  // THE CHOKEPOINT. recordEvent re-derives the status, appends the event, feeds the requestor ledger and
  // pokes the auto-release pipeline — a credit that cleared a balance has to be able to ship a record.
  var status = null;
  try {
    status = await require('./paymentStatus').recordEvent(target, {
      type: 'credit', amount: amount, reason: cite, reference: ref, actor: actor, approver: s(opts.approver) || null });
  } catch (e) { console.error('[parentFinance credit]', e && e.message); }
  return { ok: true, id: id, amount: amount, causeKind: kind, causeRef: ref, reason: cite,
           status: status, netting: await netting(pid) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REFUND — A PERSON'S ACT, RECORD-ONLY IN v1 (Draft 7 §4.2, open question 2 answered "record-only")
//
// The route gates this on FINANCE. This function refuses independently, because a gate that exists only in
// the router is a gate one new caller walks around.
async function refund(rid, opts) {
  opts = opts || {};
  var pid = await parentOf(rid);
  var amount = r2(opts.amount);
  if (!(amount > 0)) throw bad('A refund needs an amount greater than zero.', 'AMOUNT_REQUIRED');
  var method = s(opts.method);
  if (!method) throw bad('Record how the refund is being issued (check request, card reversal, credit to account). ' +
    'The method is half of what makes the record answer a question later.', 'METHOD_REQUIRED');
  var ref = s(opts.reference);
  if (!ref) throw bad('Record the reference number the city’s finance system will know this refund by. ' +
    'Without it there is no way to prove the money moved.', 'REFERENCE_REQUIRED');
  var actor = s(opts.actorName);
  if (!actor) throw bad('A refund is issued by a named person. The system does the arithmetic and nothing else.', 'ACTOR_REQUIRED');

  var net = await netting(pid);
  if (!(net.refundOutstanding > 0)) {
    throw bad('There is no refund due on this request. Credits reduce the open balance first, and a refund exists ' +
      'only for what is left over — here that is $0.00. (Balance due $' + net.balanceDue.toFixed(2) +
      ', credits $' + net.credits.toFixed(2) + '.)', 'NO_REFUND_DUE', 409);
  }
  if (amount > net.refundOutstanding + 0.005) {
    throw bad('That is more than is owed back. $' + net.refundOutstanding.toFixed(2) + ' is outstanding as a refund ' +
      'on this request; the screen will not record a larger one.', 'EXCEEDS_REFUND_DUE', 409);
  }

  var id = 'feeadj-' + uuidv4().slice(0, 8);
  var reason = s(opts.reason) || ('Refund issued by ' + actor + ' — ' + method + ' (' + ref + ').');
  await db.run('INSERT INTO fee_adjustments (id, request_id, type, amount, reason, actor, created_at, voided, ' +
    'method, reference, cause_kind, cause_ref, approver) VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)',
    [id, pid, 'refund', amount, reason, actor, nowStr(), method, ref, 'refund', ref, s(opts.approver) || actor]);
  try {
    await db.run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
      ['rh-' + uuidv4().slice(0, 8), pid, opts.actorId || null, actor, 'FEE_REFUND_RECORDED',
       'Refund $' + amount.toFixed(2) + ' recorded — ' + method + ', reference ' + ref +
       '. RECORD ONLY: the movement of funds happens in the city’s finance system.', nowStr()]);
  } catch (e) { /* best effort */ }
  var status = null;
  try {
    status = await require('./paymentStatus').recordEvent(pid, {
      type: 'refund', amount: amount, reason: reason, reference: ref, actor: actor, approver: s(opts.approver) || actor });
  } catch (e) { console.error('[parentFinance refund]', e && e.message); }
  return { ok: true, id: id, amount: amount, method: method, reference: ref, recordOnly: true,
           recordOnlyNote: 'Recorded, not performed. The funds move in the city’s finance system; this is the city’s ' +
             'record that they were authorized to.',
           status: status, netting: await netting(pid) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WITHHOLDING → RECOMPUTE → CREDIT (Draft 7 §4.4)
//
// A legal determination shrinks a set the citizen was already billed for. The recompute is done in QUOTED
// numbers off the FROZEN share (§0.6) — which is why it can post the day the determination lands instead of
// waiting for the terminal settlement.
//
// THE FROZEN SHARE IS NOT REWRITTEN, and this is deliberate. Moving it would move the release gate
// RETROACTIVELY: records that already shipped shipped against the old share, and re-basing the pool after the
// fact would make an honest earlier release look like an overdraw. The credit is the recompute's expression —
// the revised share is recorded on the credit so both numbers are on the record and neither is inferred.
async function withholdingCredit(rid, opts) {
  opts = opts || {};
  var itemId = s(opts.itemRequestId) || rid;
  var pid = await parentOf(itemId);
  var determinationRef = s(opts.determinationRef);
  if (!determinationRef) throw bad('Cite the legal determination that withheld the material. A credit is only as ' +
    'good as the decision it points at.', 'DETERMINATION_REQUIRED');
  var actor = s(opts.actorName);
  if (!actor) throw bad('A credit is a person’s act and is recorded against them.', 'ACTOR_REQUIRED');

  var q = await quotedShares(pid);
  if (!q.hasQuote) return { skipped: true, reason: 'no priced estimate — nothing to recompute against' };
  var comp = null;
  q.components.forEach(function (c) { if (c.id === itemId) comp = c; });
  if (!comp || comp.quotedShare == null) {
    return { skipped: true, reason: 'the quote does not price this item separately, so there is no per-item share to ' +
      'recompute. Post the credit against the request with the amount Finance determines.' };
  }

  var fraction;
  if (opts.fraction != null) fraction = Number(opts.fraction);
  else {
    var withheld = Number(opts.withheldUnits), total = Number(opts.totalUnits);
    if (!(total > 0)) throw bad('To value a withholding in quoted numbers the screen needs how much was withheld out ' +
      'of how much was billed (e.g. 40 pages of 120).', 'UNITS_REQUIRED');
    fraction = withheld / total;
  }
  if (!(fraction > 0)) return { skipped: true, reason: 'nothing was withheld, so nothing is credited' };
  fraction = Math.min(1, fraction);

  var creditAmount = r2(comp.quotedShare * fraction);
  var revised = r2(comp.quotedShare - creditAmount);
  if (!(creditAmount > 0)) return { skipped: true, reason: 'the withheld portion values to $0.00 at the quoted rate' };

  var unitWords = (opts.withheldUnits != null && opts.totalUnits != null)
    ? (Number(opts.withheldUnits) + ' of ' + Number(opts.totalUnits) + ' ' + (s(opts.unitLabel) || 'pages'))
    : (Math.round(fraction * 1000) / 10) + '% of the item';
  var cite = (comp.label ? comp.label : 'Item ' + itemId) + ': ' + unitWords + ' withheld per legal determination ' +
    determinationRef + '. Valued at the quoted allocation — $' + comp.quotedShare.toFixed(2) + ' quoted, revised to $' +
    revised.toFixed(2) + '.';

  var res = await credit(pid, {
    amount: creditAmount, causeKind: 'withholding', causeRef: determinationRef, reason: cite,
    itemRequestId: itemId, actorName: actor, actorId: opts.actorId, approver: opts.approver
  });
  return Object.assign({}, res, {
    itemRequestId: itemId, quotedShare: comp.quotedShare, revisedQuotedShare: revised,
    fraction: Math.round(fraction * 10000) / 10000,
    frozenShareUntouched: 'The frozen quoted share is left as it was. Records that already shipped shipped against it, ' +
      'and re-basing the pool retroactively would make an honest earlier release look like an overdraw. The credit ' +
      'carries the revised figure instead.'
  });
}

// The credit / refund rail, as rows a screen can render without doing arithmetic of its own.
async function adjustments(rid) {
  var pid = await parentOf(rid);
  var ids = await require('./paymentStatus').moneyTreeIds(pid);
  var ph = ids.map(function () { return '?'; }).join(',');
  var rows = await db.all('SELECT id, request_id, type, amount, reason, actor, approver, method, reference, ' +
    'cause_kind, cause_ref, created_at, COALESCE(voided,0) AS voided FROM fee_adjustments WHERE request_id IN (' + ph + ') ' +
    'ORDER BY created_at ASC, id ASC', ids);
  return rows.map(function (r) {
    return {
      id: r.id, requestId: r.request_id, type: r.type, amount: r2(r.amount), reason: r.reason,
      actor: r.actor || null, approver: r.approver || null, method: r.method || null,
      reference: r.reference || null, causeKind: r.cause_kind || null, causeRef: r.cause_ref || null,
      createdAt: r.created_at, voided: Number(r.voided) === 1,
      // Rule (c): who decided. A credit or a refund is ALWAYS a person's act; the system only ever computed
      // the amount, and it says so rather than letting the actor column imply more than it holds.
      decidedBy: 'person'
    };
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// THE LAST RECORD SETTLES THE REQUEST (§0.3)
//
// Kevin's decision, and the reason for it: on an MRR the pricing vehicles are AGGREGATE, so a per-item
// "actual" does not exist until every child has actuals. There is therefore exactly one honest moment to
// reconcile — when the last one is ready — and at that moment the request behaves EXACTLY like a non-MRR:
// aggregate actuals run through the same engine once, producing the adjusted final invoice or a refund.
// The last record is held until that payment, or RELEASES IMMEDIATELY when the adjustment nets to refund or
// zero (a city does not sit on a finished record while it owes the citizen money).
//
// §5.9 FOOTNOTE, RECORDED (Draft 7 §0.7): a purist reading would hold the last record only for its own
// ADJUSTED share. Final-delivery-against-final-payment is the standard regime deposits were designed around,
// the invoice issues the moment the record is ready, and the 20% rule bounds the exposure. Adopted with the
// reasoning on the record rather than silently.
//
// THE TRIGGER IS NARROW ON PURPOSE. `settle()` refuses on anything that is not a real MRR at a real terminal
// state: no children, more than one item still live, or an already-recorded settlement. A settlement that
// could fire early would rewrite a request's bill in the middle of the work.

var TERMINAL_STATUSES = ['closed', 'withdrawn', 'abandoned'];

// Is an item DONE — nothing further will happen to it? Shipped, or ended without shipping. Both are terminal;
// only one of them consumed funds, which is why `shipped` is reported separately rather than collapsed in.
async function itemStates(pid) {
  var kids = await db.all('SELECT id, request_number, stage, status, closure_reason FROM requests WHERE master_request_id = ? ORDER BY request_number ASC, id ASC', [pid]);
  if (!kids.length) return { isMrr: false, items: [] };
  var shipped = await FR.shippedAmong(kids.map(function (k) { return k.id; }));
  var items = kids.map(function (k) {
    var sh = shipped[k.id] || { shipped: false, evidence: 'unknown' };
    var ended = TERMINAL_STATUSES.indexOf(k.status) !== -1;
    return {
      id: k.id, label: k.request_number || k.id, stage: k.stage, status: k.status,
      closureReason: k.closure_reason || null,
      shipped: !!sh.shipped, shipEvidence: sh.evidence,
      terminal: !!sh.shipped || ended,
      endedWithoutShipping: ended && !sh.shipped
    };
  });
  return { isMrr: true, items: items };
}

// Are the last record's OWN actuals in? "In" means no billable work task on it is still in flight — not that
// a stopwatch produced a number, because capture is a city-owned toggle and may legitimately be off. Whether
// measured labor EXISTS is reported separately so the settlement can fall back to the manual path honestly.
async function actualsIn(rid) {
  var LA = require('./laborActuals');
  var remaining = 0, roll = null;
  try { remaining = await LA.remainingBillableCount(rid, null); } catch (e) { remaining = 0; }
  try { roll = await LA.rollup(rid); } catch (e) { roll = null; }
  return { in: remaining === 0, remainingBillableTasks: remaining, hasMeasured: !!(roll && roll.hasActuals), rollup: roll };
}

async function settlementState(rid) {
  var pid = await parentOf(rid);
  var p = await db.get('SELECT id, request_number, settlement_at, settlement_by, settlement_outcome, ' +
    'settlement_reconciliation_id, settlement_amount FROM requests WHERE id = ?', [pid]);
  var st = await itemStates(pid);
  var settled = (p && p.settlement_at) ? {
    at: p.settlement_at, by: p.settlement_by, outcome: p.settlement_outcome,
    reconciliationId: p.settlement_reconciliation_id, amount: r2(p.settlement_amount)
  } : null;

  if (!st.isMrr) {
    return { requestId: pid, isMrr: false, ready: false, settled: settled, items: [],
      reason: 'This is not a multi-record request. It settles through the ordinary reconcile-and-invoice path; ' +
        'the last-record settlement exists only because an MRR has no honest per-item actual until every item is done.' };
  }

  var live = st.items.filter(function (i) { return !i.terminal; });
  var lastRecord = null, own = null;
  if (live.length === 1) { lastRecord = live[0]; own = await actualsIn(lastRecord.id); }
  var ready = false, reason;
  if (settled) { reason = 'Already settled on ' + settled.at + ' (' + settled.outcome + ').'; }
  else if (live.length > 1) {
    reason = live.length + ' items are still live. The request settles once, when the LAST one is ready — ' +
      'aggregate pricing means a per-item actual does not exist before that.';
  } else if (live.length === 0) {
    ready = true;
    reason = 'Every item is terminal and the request has never been settled. Settle it now — the aggregate ' +
      'reconciliation is overdue rather than early.';
  } else if (!own.in) {
    reason = 'The last item (' + lastRecord.label + ') still has ' + own.remainingBillableTasks +
      ' billable task(s) in flight. Its own actuals have to be in before the aggregate can be run.';
  } else {
    ready = true;
    reason = 'The last item (' + lastRecord.label + ') is ready and every sibling is terminal. ' +
      'This is the moment the request settles.';
  }

  return {
    requestId: pid, requestNumber: (p && p.request_number) || null, isMrr: true,
    items: st.items, itemCount: st.items.length,
    terminalCount: st.items.filter(function (i) { return i.terminal; }).length,
    shippedCount: st.items.filter(function (i) { return i.shipped; }).length,
    neverShippedCount: st.items.filter(function (i) { return i.endedWithoutShipping; }).length,
    lastRecord: lastRecord, lastRecordActuals: own,
    ready: ready, settled: settled, reason: reason,
    branches: 'A balance due HOLDS the last record until it is paid. A refund or a zero adjustment RELEASES it ' +
      'immediately — the city does not sit on a finished record while it owes the citizen money.',
    footnote: 'A purist reading would hold the last record only for its own adjusted share. ' +
      'Final-delivery-against-final-payment is the regime deposits were designed around, the invoice issues the ' +
      'moment the record is ready, and the 20% rule bounds the exposure (§5.9 footnote, adopted with the reasoning recorded).'
  };
}

// ── THE 20% OVERAGE WATCHDOG (§552.2615) — THE ONLY MID-FLIGHT RUNNING NUMBER (§0.4) ────────────
//
// Two jobs, and the second is the one that has teeth:
//   (a) it feeds the EXISTING updated-statement / reissue machinery (services/feeReissue), which already
//       implements § 552.2615(b)-(c). Nothing is reimplemented here.
//   (b) it CAPS what a final invoice may collect. An overage the requestor was never told about is forfeited,
//       and this screen refuses to bill it.
//
// (b) IS ALWAYS ON, and that is consistent with feeReissue's own asymmetry rather than a departure from it:
// feeReissue's counter gate is policy-opt-in because BLOCKING A PAYMENT has a real cost with a real clerk
// standing there. Refusing to GENERATE a demand for an amount the requestor was never sent costs nothing —
// the city cures it by sending the revised statement, which it has to do anyway. Block for free, never block
// at a cost the city did not agree to.
async function overageWatchdog(rid) {
  var pid = await parentOf(rid);
  var RI = require('./feeReissue');
  var pending = { pending: false }, lastNotified = null;
  try { pending = await RI.pending(pid); } catch (e) { pending = { pending: false }; }
  try { lastNotified = await RI.lastNotifiedTotal(pid); } catch (e) { lastNotified = null; }
  // Fall back through the tree: on an MRR the notice may have been sent against the row the estimate lives on.
  if (!lastNotified || !pending.pending) {
    var ids = await require('./paymentStatus').moneyTreeIds(pid);
    for (var i = 0; i < ids.length && !pending.pending; i++) {
      if (ids[i] === pid) continue;
      try { var p2 = await RI.pending(ids[i]); if (p2.pending) { pending = p2; pending._row = ids[i]; } } catch (e) {}
      if (!lastNotified) { try { lastNotified = await RI.lastNotifiedTotal(ids[i]); } catch (e) {} }
    }
  }
  var net = await netting(pid);
  var ceiling = lastNotified ? r2(lastNotified.total) : null;
  var collectible = (pending.pending && ceiling != null) ? Math.max(0, r2(ceiling - net.paidGross)) : null;
  var forfeited = (collectible != null) ? Math.max(0, r2(net.balanceDue - collectible)) : 0;
  return {
    requestId: pid,
    revisedStatementOutstanding: !!pending.pending,
    variancePct: pending.variancePct != null ? pending.variancePct : null,
    actualTotal: pending.actualTotal != null ? r2(pending.actualTotal) : null,
    estimateTotal: pending.estimateTotal != null ? r2(pending.estimateTotal) : null,
    lastNotifiedTotal: ceiling, lastNotifiedAt: lastNotified ? lastNotified.notifiedAt : null,
    balanceDue: net.balanceDue,
    collectionCap: collectible,
    forfeitedUnlessNotified: forfeited,
    citation: "Tex. Gov't Code § 552.2615(b)-(c)",
    reason: pending.pending
      ? ('The actual cost came in ' + (pending.variancePct != null ? pending.variancePct + '% ' : '') +
         'above the estimate the requestor accepted and the updated itemized statement has NOT been sent. ' +
         'The requestor has not agreed to the higher number, so the city may not collect above $' +
         (ceiling != null ? ceiling.toFixed(2) : '?') + ' on this request' +
         (forfeited > 0 ? (' — $' + forfeited.toFixed(2) + ' of the balance is not billable until the revised ' +
           'statement goes out, and this screen will not bill it.') : '.') +
         ' Sending the revised statement cures it, and also restarts the requestor’s response window.')
      : 'No updated statement is outstanding. Nothing caps the final invoice.',
    // Pointer, not a duplicate. The send is a person's act through the reissue machinery.
    sendVia: 'services/feeReissue — the revised itemized statement. The SEND is a person’s act; this only measures.'
  };
}

// ── SETTLE. Runs the aggregate ONCE, exactly as a non-MRR reconcile does. ────────────────────────
async function settle(rid, opts) {
  opts = opts || {};
  var actor = s(opts.actorName);
  if (!actor) throw bad('Settlement is a person’s act and is recorded against them. The system runs the engine; ' +
    'it does not decide to bill anybody.', 'ACTOR_REQUIRED');
  var pid = await parentOf(rid);
  var state = await settlementState(pid);
  if (!state.isMrr) throw bad(state.reason, 'NOT_MRR', 409);
  if (state.settled) throw bad('This request was already settled on ' + state.settled.at + ' (' + state.settled.outcome +
    '). A request settles once; a second run would rewrite a bill the citizen has already been given.', 'ALREADY_SETTLED', 409);
  if (!state.ready) throw bad(state.reason, 'NOT_READY', 409);

  var LA = require('./laborActuals');
  var engine = require('./feeEngine');
  var PS = require('./paymentStatus');
  var ids = await PS.moneyTreeIds(pid);

  // AGGREGATE THE ACTUALS ACROSS THE WHOLE TREE. `laborActuals.rollup` is per-row (its own header says
  // per-child attribution is deferred); the aggregate is the sum, which is exactly the figure the engine
  // reconciles at the request level anyway.
  var hours = { searchHours: 0, reviewHours: 0, programmingHours: 0 };
  var counted = [], measured = false;
  for (var i = 0; i < ids.length; i++) {
    var roll = await LA.rollup(ids[i]);
    ['searchHours', 'reviewHours', 'programmingHours'].forEach(function (k) { hours[k] = Math.round((hours[k] + (Number(roll.hours[k]) || 0)) * 10000) / 10000; });
    counted = counted.concat(roll.counted || []);
    if (roll.hasActuals) measured = true;
  }

  var quote = await FR.acceptedQuote(pid);
  if (!quote) quote = await db.get("SELECT * FROM request_fee_estimates WHERE request_id IN (" +
    ids.map(function () { return '?'; }).join(',') + ") AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", ids);
  if (!quote) throw bad('There is no estimate to settle against on this request.', 'NO_ESTIMATE', 409);
  var input = {}; try { input = JSON.parse(quote.input_json || '{}'); } catch (e) { input = {}; }
  if (!input.components || !input.components.length) throw bad('The estimate on this request has no priced components, ' +
    'so there is nothing for the engine to re-run.', 'NO_COMPONENTS', 409);

  var cfgRow = quote.config_profile_id
    ? await db.get('SELECT * FROM fee_profiles WHERE id = ?', [quote.config_profile_id])
    : await db.get("SELECT * FROM fee_profiles WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1");
  var config = {}; try { config = JSON.parse((cfgRow && cfgRow.config_json) || '{}'); } catch (e) { config = {}; }
  var pol = (config.estimatePolicy && typeof config.estimatePolicy.revisionNotifyPercent === 'number')
    ? config.estimatePolicy.revisionNotifyPercent : 20;

  // ONE RUN, THE SAME ENGINE. `measured` false means capture was off or skipped everywhere — then the quoted
  // quantities stand and the "aggregate" is the quote, which is the honest answer rather than zero hours.
  var settleInput = measured ? LA.applyMeasuredLabor(input, hours) : JSON.parse(JSON.stringify(input));
  settleInput._mrrSettlement = true;
  settleInput._aggregateLabor = { hours: hours, tasks: counted.length, measured: measured };
  var feeContext = engine.compute(config, settleInput);

  var recon = await LA.writeReconciliation({
    rid: quote.request_id, configProfileId: cfgRow && cfgRow.id, input: settleInput, feeContext: feeContext,
    estTotal: quote.total != null ? Number(quote.total) : null, revisionNotifyPercent: pol,
    createdBy: actor + ' (mrr settlement)'
  });

  // THE POSITION AFTER THE RUN. netting() reads the reconciliation we just wrote — evented, not recomputed.
  var net = await netting(pid);
  var watch = await overageWatchdog(pid);
  var outcome, finalInvoice = 0, refundOut = 0;
  if (net.refundOutstanding > 0.005) { outcome = 'refund'; refundOut = net.refundOutstanding; }
  else if (net.balanceDue > 0.005) {
    outcome = 'balance_due';
    finalInvoice = (watch.collectionCap != null) ? Math.min(net.balanceDue, watch.collectionCap) : net.balanceDue;
    finalInvoice = r2(finalInvoice);
  } else { outcome = 'zero'; }

  await db.run('UPDATE requests SET settlement_at = ?, settlement_by = ?, settlement_outcome = ?, ' +
    'settlement_reconciliation_id = ?, settlement_amount = ?, updated_at = ? WHERE id = ?',
    [nowStr(), actor, outcome, recon.id, outcome === 'refund' ? refundOut : finalInvoice, nowStr(), pid]);

  var words = outcome === 'refund'
    ? ('nets to a refund of $' + refundOut.toFixed(2) + ' — the last record RELEASES immediately; the refund itself ' +
       'is Finance’s act and is never automatic')
    : outcome === 'zero'
      ? 'nets to zero — the last record RELEASES immediately'
      : ('leaves $' + net.balanceDue.toFixed(2) + ' due' +
         (watch.forfeitedUnlessNotified > 0
           ? (', of which only $' + finalInvoice.toFixed(2) + ' is billable: $' + watch.forfeitedUnlessNotified.toFixed(2) +
              ' is unnotified overage and is forfeited unless the updated itemized statement goes out (' + watch.citation + ')')
           : '') +
         '. The last record is held until that payment');

  try {
    await db.run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, details, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ['rh-' + uuidv4().slice(0, 8), pid, opts.actorId || null, actor, 'MRR_SETTLED',
       'Request settled on the last record: aggregate actuals run through the fee engine once ($' +
       Number(recon.actualTotal || 0).toFixed(2) + ' against the accepted estimate $' +
       (recon.estimateTotal != null ? Number(recon.estimateTotal).toFixed(2) : '?') + '), which ' + words + '.',
       JSON.stringify({ reconciliationId: recon.id, outcome: outcome, hours: hours, measured: measured,
         finalInvoice: finalInvoice, refundOutstanding: refundOut, cap: watch.collectionCap,
         forfeited: watch.forfeitedUnlessNotified }), nowStr()]);
  } catch (e) { /* best effort */ }
  try {
    await PS.recordEvent(pid, { type: 'settlement', amount: outcome === 'refund' ? refundOut : finalInvoice,
      reason: 'MRR terminal settlement — ' + words + '.', reference: recon.id, actor: actor });
  } catch (e) { console.error('[parentFinance settle]', e && e.message); }

  return {
    ok: true, outcome: outcome, reconciliation: recon, netting: net, watchdog: watch,
    finalInvoice: finalInvoice, refundOutstanding: refundOut,
    aggregate: { hours: hours, tasks: counted.length, measured: measured },
    releasesLastRecordImmediately: outcome !== 'balance_due',
    lastRecord: state.lastRecord,
    note: 'Settled once, through the same engine a single-record request uses. ' +
      (outcome === 'balance_due'
        ? 'The last record is held against the final payment.'
        : 'The last record’s coverage is satisfied by the settlement — nothing is held.'),
    forfeited: watch.forfeitedUnlessNotified,
    forfeitedReason: watch.forfeitedUnlessNotified > 0 ? watch.reason : null
  };
}

// What may a final invoice actually collect right now? The cap read on its own, for the screen and for any
// caller about to generate a demand. `refuse` is the answer to "can I bill the whole balance": no, and why.
async function collectionCap(rid) {
  var pid = await parentOf(rid);
  var watch = await overageWatchdog(pid);
  var billable = (watch.collectionCap != null) ? Math.min(watch.balanceDue, watch.collectionCap) : watch.balanceDue;
  return {
    requestId: pid, balanceDue: watch.balanceDue, billable: r2(billable),
    refuse: watch.forfeitedUnlessNotified > 0,
    forfeited: watch.forfeitedUnlessNotified,
    reason: watch.forfeitedUnlessNotified > 0 ? watch.reason : null,
    citation: watch.forfeitedUnlessNotified > 0 ? watch.citation : null,
    sendVia: watch.sendVia
  };
}

module.exports = {
  CREDIT_CAUSES: CREDIT_CAUSES, TERMINAL_STATUSES: TERMINAL_STATUSES,
  parentOf: parentOf,
  quotedShares: quotedShares, freezeQuote: freezeQuote,
  netting: netting, credit: credit, refund: refund,
  withholdingCredit: withholdingCredit, adjustments: adjustments,
  itemStates: itemStates, actualsIn: actualsIn, settlementState: settlementState,
  overageWatchdog: overageWatchdog, settle: settle, collectionCap: collectionCap
};
