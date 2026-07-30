'use strict';
// PHASE 7 / BW7 — THE PARENT FINANCIAL VIEW'S API.
// (docs/DRAFT_processing_ui_parent_financial.md · docs/SPEC_processing_ui.md §3 screen 7)
//
// TWO AUTHORITIES, DELIBERATELY DIFFERENT (Draft 7 §4.5: "RM read, Finance act"):
//
//   READ    the Request Manager and the oversight roles. The RM has to be able to answer the citizen's
//           question about their own request's money without holding financial authority.
//   ACT     credits and refunds are gated on FINANCE (the reconciled financial-authority capability — the
//           same permission the fee-waiver and fee-objection decisions run on) or DIRECTOR. The refund
//           control is VISIBLE to the RM and ENABLED only for Finance, because hiding it would leave the RM
//           unable to tell a citizen who to ask.
//
// PAYMENT-TAKING IS NOT HERE. The Cash Drawer is the payment surface and this screen links to it. A second
// place to take money is a second cash-handling procedure, and cities do not have those.
var express = require('express');
var router = express.Router();
var { requireAuth, requireRoleOrPerm } = require('../middleware/auth');
var { get } = require('../db');
var PF = require('../services/parentFinance');

var OVERSIGHT = ['SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'ORO_SUPERVISOR', 'RECORDS_MANAGER'];
var FINANCE_ACT = requireRoleOrPerm(['DIRECTOR', 'SYSTEM_ADMIN'], ['FINANCE']);

function canAct(user) {
  var roles = (user && user.roles) || [], perms = (user && user.perms) || [];
  return roles.indexOf('SYSTEM_ADMIN') !== -1 || roles.indexOf('DIRECTOR') !== -1 || perms.indexOf('FINANCE') !== -1;
}
function actorName(req) {
  return (req.user && (req.user.name || req.user.display_name)) || (req.user && req.user.sub) || 'Staff';
}
// READ authorization: oversight by authority, or the person holding this request's management task.
async function canRead(user, pid) {
  var roles = (user && user.roles) || [];
  if (OVERSIGHT.some(function (r) { return roles.indexOf(r) !== -1; })) return true;
  var t = await get("SELECT assigned_to FROM tasks WHERE request_id = ? AND type IN ('mrr_management','request_management') ORDER BY created_at DESC LIMIT 1", [pid]);
  if (t && t.assigned_to === (user && user.sub)) return true;
  // ANY task on the TREE, not only on the parent. On an MRR the person working item 3 holds a task on the
  // CHILD; scoping this to the parent row would have locked them out of the ledger for the request they are
  // working, which is the same parent/child scoping defect `paymentStatus` documents at length.
  var any = await get('SELECT COUNT(*)::int AS n FROM tasks t JOIN requests r ON r.id = t.request_id ' +
    'WHERE (r.id = ? OR r.master_request_id = ?) AND t.assigned_to = ?', [pid, pid, user && user.sub]);
  return !!(any && Number(any.n) > 0);
}
function fail(res, e) {
  var status = (e && e.status) || 500;
  res.status(status).json({ error: (e && e.message) || 'error', code: (e && e.code) || null, citation: (e && e.citation) || null });
}

// ── READS ────────────────────────────────────────────────────────────────────────────────────────
// THE SCREEN'S ONE READ. Every figure is computed in the service — the page's job is layout, and a page that
// recomputes a money figure is a second implementation of the rule.
router.get('/:id/view', requireAuth, async function (req, res) {
  try {
    var pid = await PF.parentOf(req.params.id);
    if (!(await canRead(req.user, pid))) return res.status(403).json({ error: 'Not your request.' });
    var v = await PF.financialView(pid);
    v.canAct = canAct(req.user);
    v.actNote = canAct(req.user) ? null
      : 'You can read this ledger. Credits, refunds and the settlement are ORO Finance’s acts — the controls stay ' +
        'visible so you can tell a citizen who to ask, and stay disabled because the authority is not yours.';
    v.refundEnabled = canAct(req.user) && v.netting.refundOutstanding > 0;
    v.canSettle = canAct(req.user) && v.settlement.ready && !v.settlement.settled;
    res.json(v);
  } catch (e) { fail(res, e); }
});

router.get('/:id/quoted-shares', requireAuth, async function (req, res) {
  try {
    var pid = await PF.parentOf(req.params.id);
    if (!(await canRead(req.user, pid))) return res.status(403).json({ error: 'Not your request.' });
    res.json(await PF.quotedShares(pid));
  } catch (e) { fail(res, e); }
});

router.get('/:id/netting', requireAuth, async function (req, res) {
  try {
    var pid = await PF.parentOf(req.params.id);
    if (!(await canRead(req.user, pid))) return res.status(403).json({ error: 'Not your request.' });
    var net = await PF.netting(pid);
    // The refund control's two states, decided server-side so the screen cannot draw a different rule.
    net.refundVisible = true;
    net.refundEnabled = canAct(req.user) && net.refundOutstanding > 0;
    net.refundDisabledReason = canAct(req.user)
      ? (net.refundOutstanding > 0 ? null : 'No refund is due — credits reduce the open balance first.')
      : 'A refund is issued by ORO Finance. You can see what is owed back; the issuing act is theirs.';
    res.json(net);
  } catch (e) { fail(res, e); }
});

router.get('/:id/adjustments', requireAuth, async function (req, res) {
  try {
    var pid = await PF.parentOf(req.params.id);
    if (!(await canRead(req.user, pid))) return res.status(403).json({ error: 'Not your request.' });
    res.json({ rows: await PF.adjustments(pid), canAct: canAct(req.user) });
  } catch (e) { fail(res, e); }
});

// The last-record settlement picture, and the 20% watchdog that caps what a final invoice may collect.
router.get('/:id/settlement', requireAuth, async function (req, res) {
  try {
    var pid = await PF.parentOf(req.params.id);
    if (!(await canRead(req.user, pid))) return res.status(403).json({ error: 'Not your request.' });
    var st = await PF.settlementState(pid);
    st.watchdog = await PF.overageWatchdog(pid);
    st.collectionCap = await PF.collectionCap(pid);
    st.canSettle = canAct(req.user) && st.ready && !st.settled;
    st.settleDisabledReason = canAct(req.user) ? (st.ready && !st.settled ? null : st.reason)
      : 'Settling the request is ORO Finance’s act. You can see whether it is ready.';
    res.json(st);
  } catch (e) { fail(res, e); }
});

// ── ACTS — FINANCE ───────────────────────────────────────────────────────────────────────────────
//
// The service refuses on the same grounds independently of this gate (no cause, no method, no reference, no
// actor, more than is owed back). A rule enforced only in the router is a rule the next caller walks around.
router.post('/:id/credit', requireAuth, FINANCE_ACT, async function (req, res) {
  try {
    var b = req.body || {};
    res.json(await PF.credit(req.params.id, {
      amount: b.amount, causeKind: b.causeKind, causeRef: b.causeRef, reason: b.reason,
      itemRequestId: b.itemRequestId, approver: b.approver,
      actorName: actorName(req), actorId: req.user && req.user.sub }));
  } catch (e) { fail(res, e); }
});

router.post('/:id/refund', requireAuth, FINANCE_ACT, async function (req, res) {
  try {
    var b = req.body || {};
    res.json(await PF.refund(req.params.id, {
      amount: b.amount, method: b.method, reference: b.reference, reason: b.reason, approver: b.approver,
      actorName: actorName(req), actorId: req.user && req.user.sub }));
  } catch (e) { fail(res, e); }
});

// The withholding hook's HTTP door. The same function is callable server-side from the legal-determination
// path with the deciding officer as the actor — this route is for the case where Finance posts it by hand.
router.post('/:id/withholding-credit', requireAuth, FINANCE_ACT, async function (req, res) {
  try {
    var b = req.body || {};
    res.json(await PF.withholdingCredit(req.params.id, {
      itemRequestId: b.itemRequestId, determinationRef: b.determinationRef,
      withheldUnits: b.withheldUnits, totalUnits: b.totalUnits, unitLabel: b.unitLabel, fraction: b.fraction,
      approver: b.approver, actorName: actorName(req), actorId: req.user && req.user.sub }));
  } catch (e) { fail(res, e); }
});

// SETTLE. The one act that re-prices a request, so it is gated hard and refuses hard: not an MRR, more than
// one item still live, or already settled, and it declines. There is no automatic caller anywhere — a person
// settles, and the system runs the engine once.
router.post('/:id/settle', requireAuth, FINANCE_ACT, async function (req, res) {
  try {
    res.json(await PF.settle(req.params.id, { actorName: actorName(req), actorId: req.user && req.user.sub }));
  } catch (e) { fail(res, e); }
});

module.exports = router;
