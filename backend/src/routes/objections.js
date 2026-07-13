// Fee-estimate objection layer (operational). An objection is an overlay on a request: it never
// changes the request's process stage, and while open (with clock_frozen) the tickler holds its
// clocks. Ownership is manual and person-based (assignee_id), freely reassignable; "escalate" is a
// shortcut that assigns to a SUPERVISOR in the catcher's department. Resolution (financial approval
// via a Fee Authorizer) is a later increment. See FEE_ESTIMATE_OBJECTION_DESIGN.md.
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const scope = require('../services/requestScope');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

async function hist(requestId, actor, action, details) {
  try {
    await run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action, details, created_at) VALUES (?,?,?,?,?,?,?)",
      ['rh-' + uuidv4().slice(0, 8), requestId, actor && actor.sub, (actor && actor.name) || (actor && actor.sub) || 'system', action, details || null, nowStr()]);
  } catch (e) { console.error('[objection hist]', e.message); }
}

async function getUser(id) { if (!id) return null; return await get('SELECT id, display_name FROM users WHERE id = ?', [id]); }

// Escalate: resolve a SUPERVISOR in the caller's department (best-effort). Falls back to any
// SUPERVISOR / DEPT_MANAGER. Returns {id, display_name} or null when none can be found.
async function resolveSupervisor(callerId) {
  var me = await get('SELECT department_id FROM users WHERE id = ?', [callerId]);
  var dept = me && me.department_id;
  var sql = "SELECT u.id, u.display_name FROM users u JOIN user_permission_roles upr ON upr.user_id = u.id JOIN permission_roles pr ON pr.id = upr.permission_role_id WHERE pr.name IN ('SUPERVISOR','DEPT_MANAGER') AND u.status = 'active' AND u.id <> ?";
  if (dept) {
    var inDept = await get(sql + " AND u.department_id = ? ORDER BY CASE WHEN pr.name='SUPERVISOR' THEN 0 ELSE 1 END LIMIT 1", [callerId, dept]);
    if (inDept) return inDept;
  }
  return await get(sql + " ORDER BY CASE WHEN pr.name='SUPERVISOR' THEN 0 ELSE 1 END LIMIT 1", [callerId]);
}

// Whether an open objection tolls the clock for the active jurisdiction (per-jurisdiction policy on
// the active FR fee profile config; default off - most agencies keep the clock running).
async function jurisdictionTolls() {
  try {
    var jrow = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
    var prof = await get("SELECT config_json FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR' ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC LIMIT 1", [jrow && jrow.value]);
    var cfg = prof ? JSON.parse(prof.config_json || '{}') : {};
    return !!cfg.objectionTollsClock;
  } catch (e) { return false; }
}

function shape(o) {
  if (!o) return o;
  return {
    id: o.id, requestId: o.request_id, status: o.status,
    sourceType: o.source_type, evidenceFileId: o.evidence_file_id, recapText: o.recap_text, reason: o.reason,
    assigneeId: o.assignee_id, assigneeName: o.assignee_name,
    raisedBy: o.raised_by, raisedByName: o.raised_by_name, raisedAt: o.raised_at,
    clockFrozen: !!o.clock_frozen,
    resolutionType: o.resolution_type, resolutionDetail: o.resolution_detail, resolutionAmount: o.resolution_amount,
    approvalStatus: o.approval_status, approvedBy: o.approved_by, approvedAt: o.approved_at,
    resolvedBy: o.resolved_by, resolvedAt: o.resolved_at,
    requestNumber: o.request_number, createdAt: o.created_at, updatedAt: o.updated_at
  };
}

// Create an objection on a request. Requires source type, evidence (uploaded file OR typed recap),
// and a reason. Assign to a specific user, or escalate to a supervisor; defaults to the creator.
router.post('/request/:requestId', requireAuth, async function (req, res) {
  try {
    var rid = req.params.requestId;
    var reqRow = await get('SELECT id FROM requests WHERE id = ?', [rid]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found.' });
    var b = req.body || {};
    var sourceType = String(b.sourceType || '').trim();
    if (['letter', 'email', 'phone', 'in_person'].indexOf(sourceType) === -1) return res.status(400).json({ error: 'Choose how the objection was received (letter, email, phone, or in person).' });
    var evidenceFileId = b.evidenceFileId || null;
    var recapText = (b.recapText || '').trim() || null;
    if (!evidenceFileId && !recapText) return res.status(400).json({ error: 'Attach the objection (a scan, photo, or screenshot) or type a recap of what was said.' });
    var reason = (b.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Enter a short reason for the objection.' });

    var assignee = null;
    if (b.assigneeId) { assignee = await getUser(b.assigneeId); if (!assignee) return res.status(400).json({ error: 'The selected assignee was not found.' }); }
    else if (b.escalate) { assignee = await resolveSupervisor(req.user.sub); if (!assignee) return res.status(400).json({ error: 'No supervisor could be found to escalate to - assign a specific person instead.' }); }
    else { assignee = { id: req.user.sub, display_name: req.user.name || req.user.sub }; }

    var frozen = (await jurisdictionTolls()) ? 1 : 0;
    var id = 'obj-' + uuidv4().slice(0, 8);
    var now = nowStr();
    await run('INSERT INTO objections (id, request_id, status, source_type, evidence_file_id, recap_text, reason, assignee_id, assignee_name, raised_by, raised_by_name, raised_at, clock_frozen, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, rid, 'open', sourceType, evidenceFileId, recapText, reason, assignee.id, assignee.display_name, req.user.sub, req.user.name || req.user.sub, now, frozen, now, now]);
    await hist(rid, req.user, 'OBJECTION_RAISED', 'Objection raised (' + sourceType + '), assigned to ' + assignee.display_name + (frozen ? '; clock frozen.' : '.'));
    var row = await get("SELECT o.*, " + scope.numberExpr('r') + " AS request_number FROM objections o LEFT JOIN requests r ON r.id = o.request_id" + scope.numberJoin('r') + " WHERE o.id = ?", [id]);
    res.json({ objection: shape(row) });
  } catch (e) { res.status(500).json({ error: 'Could not raise the objection: ' + (e && e.message) }); }
});

// List objections on a request (most recent first).
router.get('/request/:requestId', requireAuth, async function (req, res) {
  try {
    var rows = await all("SELECT o.*, " + scope.numberExpr('r') + " AS request_number FROM objections o LEFT JOIN requests r ON r.id = o.request_id" + scope.numberJoin('r') + " WHERE o.request_id = ? ORDER BY o.created_at DESC", [req.params.requestId]);
    res.json({ objections: (rows || []).map(shape) });
  } catch (e) { res.status(500).json({ error: 'Could not load objections.' }); }
});

// Reassign an objection to another user, or escalate to a supervisor. Freely reassignable (the amoeba).
router.post('/:id/assign', requireAuth, async function (req, res) {
  try {
    var o = await get('SELECT * FROM objections WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Objection not found.' });
    if (o.status === 'resolved') return res.status(409).json({ error: 'This objection is already resolved.' });
    var b = req.body || {};
    var assignee = null;
    if (b.assigneeId) { assignee = await getUser(b.assigneeId); if (!assignee) return res.status(400).json({ error: 'The selected assignee was not found.' }); }
    else if (b.escalate) { assignee = await resolveSupervisor(req.user.sub); if (!assignee) return res.status(400).json({ error: 'No supervisor could be found to escalate to - assign a specific person instead.' }); }
    else return res.status(400).json({ error: 'Choose a person to assign to, or escalate to a supervisor.' });
    await run("UPDATE objections SET assignee_id = ?, assignee_name = ?, updated_at = ? WHERE id = ?", [assignee.id, assignee.display_name, nowStr(), req.params.id]);
    await hist(o.request_id, req.user, 'OBJECTION_REASSIGNED', 'Objection reassigned to ' + assignee.display_name + '.');
    var row = await get("SELECT o.*, " + scope.numberExpr('r') + " AS request_number FROM objections o LEFT JOIN requests r ON r.id = o.request_id" + scope.numberJoin('r') + " WHERE o.id = ?", [req.params.id]);
    res.json({ objection: shape(row) });
  } catch (e) { res.status(500).json({ error: 'Could not reassign the objection.' }); }
});

// Objections currently assigned to me (for the "Fee Estimate Objections" My Tasks box).
router.get('/mine', requireAuth, async function (req, res) {
  try {
    var rows = await all("SELECT o.*, " + scope.numberExpr('r') + " AS request_number FROM objections o LEFT JOIN requests r ON r.id = o.request_id" + scope.numberJoin('r') + " WHERE o.assignee_id = ? AND o.status IN ('open','tentative') ORDER BY o.created_at DESC", [req.user.sub]);
    res.json({ objections: (rows || []).map(shape) });
  } catch (e) { res.status(500).json({ error: 'Could not load your objections.' }); }
});

// Resolution outcomes split by financial effect.
var FINANCIAL = ['reduction', 'waiver', 'write_off'];
var NONFINANCIAL = ['uphold', 'new_due_date', 'requestor_withdrew'];

// The owner records an outcome. Non-financial clears directly; financial goes TENTATIVE pending a
// Fee Authorizer approval (segregation of duties) and only clears on approval.
router.post('/:id/resolve', requireAuth, async function (req, res) {
  try {
    var o = await get('SELECT * FROM objections WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Objection not found.' });
    if (o.status === 'resolved') return res.status(409).json({ error: 'This objection is already resolved.' });
    var b = req.body || {};
    var rtype = String(b.resolutionType || '');
    var detail = (b.detail || '').trim() || null;
    var now = nowStr();
    if (NONFINANCIAL.indexOf(rtype) >= 0) {
      await run("UPDATE objections SET status = 'resolved', resolution_type = ?, resolution_detail = ?, resolution_amount = NULL, approval_status = NULL, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?",
        [rtype, detail, req.user.name || req.user.sub, now, now, o.id]);
      await hist(o.request_id, req.user, 'OBJECTION_RESOLVED', 'Objection resolved (' + rtype + ')' + (detail ? ': ' + detail : '') + '.');
    } else if (FINANCIAL.indexOf(rtype) >= 0) {
      var amount = Number(b.amount);
      if (!(amount > 0)) return res.status(400).json({ error: 'Enter the adjustment amount.' });
      await run("UPDATE objections SET status = 'tentative', resolution_type = ?, resolution_detail = ?, resolution_amount = ?, approval_status = 'pending', resolved_by = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?",
        [rtype, detail, amount, now, o.id]);
      await hist(o.request_id, req.user, 'OBJECTION_RESOLUTION_PROPOSED', 'Proposed ' + rtype + ' of $' + amount.toFixed(2) + ' \u2014 pending Fee Authorizer approval.');
    } else {
      return res.status(400).json({ error: 'Choose a valid resolution outcome.' });
    }
    var row = await get("SELECT o.*, " + scope.numberExpr('r') + " AS request_number FROM objections o LEFT JOIN requests r ON r.id = o.request_id" + scope.numberJoin('r') + " WHERE o.id = ?", [o.id]);
    res.json({ objection: shape(row) });
  } catch (e) { res.status(500).json({ error: 'Could not resolve the objection: ' + (e && e.message) }); }
});

// Fee Authorizer decision on a tentative financial resolution. Approve -> applies the credit and
// resolves; reject -> returns the objection to the owner. Uses the existing fee-waiver authority.
router.post('/:id/approve', requireAuth, requireRole('FEE_WAIVER_APPROVER', 'SYSTEM_ADMIN', 'DIRECTOR'), async function (req, res) {
  try {
    var o = await get('SELECT * FROM objections WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Objection not found.' });
    if (o.approval_status !== 'pending') return res.status(409).json({ error: 'There is no pending financial resolution to decide on.' });
    var decision = (req.body && req.body.decision) === 'reject' ? 'reject' : 'approve';
    var now = nowStr(); var who = req.user.name || req.user.sub;
    if (decision === 'approve') {
      await run("UPDATE objections SET status = 'resolved', approval_status = 'approved', approved_by = ?, approved_at = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?", [who, now, who, now, now, o.id]);
      await hist(o.request_id, req.user, 'OBJECTION_ADJUSTMENT_APPROVED', 'Approved ' + o.resolution_type + ' of $' + Number(o.resolution_amount || 0).toFixed(2) + ' \u2014 objection resolved and credit applied.');
      try { await require('../services/paymentStatus').recordEvent(o.request_id, { type: 'credit', amount: Number(o.resolution_amount) || 0, reason: 'objection ' + o.resolution_type + ' approved', approver: who }); } catch (e) {}
    } else {
      await run("UPDATE objections SET status = 'open', approval_status = 'rejected', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?", [who, now, now, o.id]);
      await hist(o.request_id, req.user, 'OBJECTION_ADJUSTMENT_REJECTED', 'Rejected the proposed ' + o.resolution_type + ' \u2014 returned to ' + (o.assignee_name || 'the owner') + '.');
    }
    var row = await get("SELECT o.*, " + scope.numberExpr('r') + " AS request_number FROM objections o LEFT JOIN requests r ON r.id = o.request_id" + scope.numberJoin('r') + " WHERE o.id = ?", [o.id]);
    res.json({ objection: shape(row) });
  } catch (e) { res.status(500).json({ error: 'Could not record the decision.' }); }
});

// Pending financial resolutions awaiting a Fee Authorizer (their approval queue).
router.get('/pending-approval', requireAuth, requireRole('FEE_WAIVER_APPROVER', 'SYSTEM_ADMIN', 'DIRECTOR'), async function (req, res) {
  try {
    var rows = await all("SELECT o.*, " + scope.numberExpr('r') + " AS request_number FROM objections o LEFT JOIN requests r ON r.id = o.request_id" + scope.numberJoin('r') + " WHERE o.approval_status = 'pending' AND o.status = 'tentative' ORDER BY o.updated_at DESC");
    res.json({ objections: (rows || []).map(shape) });
  } catch (e) { res.status(500).json({ error: 'Could not load the approval queue.' }); }
});

module.exports = router;
