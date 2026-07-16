const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const email = require('../services/email');
const { all, get, run } = require('../db');
const { v4: uuidv4 } = require('uuid');
const workflowEngine = require('../services/workflowEngine');
const requestCreate = require('../services/requestCreate');
const scope = require('../services/requestScope');
async function activeExemptionModel() {
  try {
    var jrow = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
    var jid = jrow && jrow.value; if (!jid) return 'self_court';
    var jp = await get('SELECT exemption_model FROM jurisdiction_profiles WHERE id = ?', [jid]);
    return (jp && jp.exemption_model) || 'self_court';
  } catch (e) { return 'self_court'; }
}

async function logHistory(requestId, actorId, actorName, action, notes) {
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), requestId, actorId, actorName, action, notes || null]);
}

router.get('/stats/dashboard', requireAuth, async function(req, res) {
  const userRoles = req.user.roles || [];
  const isElevated = ['SUPERVISOR','DIRECTOR','SYSTEM_ADMIN','DEPT_MANAGER'].some(function(r) { return userRoles.indexOf(r) !== -1; });
  let where = "status = 'active'";
  const params = [];
  if (!isElevated) { where += ' AND (department_id = ? OR assigned_to = ?)'; params.push(req.user.dept, req.user.sub); }
  // total + overdue count what the CITIZEN filed (one per request) -> PARENT rows; the deadline lives there.
  // by-stage counts WORK -> LEAF rows; a parent has no stage. See services/requestScope.js.
  const total = await get('SELECT COUNT(*) as count FROM requests r WHERE ' + where.replace(/\b(status|department_id|assigned_to|deadline_date)\b/g, 'r.$1') + scope.andParent('r'), params);
  const overdue = await get("SELECT COUNT(*) as count FROM requests r WHERE " + where.replace(/\b(status|department_id|assigned_to|deadline_date)\b/g, 'r.$1') + " AND r.deadline_date < date('now')" + scope.andParent('r'), params);
  const byStage = await all('SELECT r.stage, COUNT(*) as count FROM requests r WHERE ' + where.replace(/\b(status|department_id|assigned_to|deadline_date)\b/g, 'r.$1') + scope.andLeaf('r') + ' GROUP BY r.stage', params);
  const stageMap = {};
  byStage.forEach(function(r) { stageMap[r.stage] = r.count; });
  res.json({ total: total ? total.count : 0, overdue: overdue ? overdue.count : 0, byStage: stageMap });
});

router.get('/', requireAuth, async function(req, res) {
  const userRoles = req.user.roles || [];
  const isElevated = ['SUPERVISOR','DIRECTOR','SYSTEM_ADMIN','DEPT_MANAGER','ATTORNEY_REVIEWER'].some(function(r) { return userRoles.indexOf(r) !== -1; });
  let sql = "SELECT r.*, d.name as department_name, d.color as department_color, u.display_name as assigned_to_name, (SELECT t.status FROM tasks t WHERE t.request_id = r.id AND t.status IN ('open','assigned','in_progress','returned','awaiting_review') ORDER BY t.updated_at DESC LIMIT 1) AS active_task_status, (SELECT tu.display_name FROM tasks t2 LEFT JOIN users tu ON tu.id = t2.assigned_to WHERE t2.request_id = r.id AND t2.status IN ('assigned','in_progress','returned','awaiting_review') ORDER BY t2.updated_at DESC LIMIT 1) AS active_task_assignee, (SELECT COUNT(*) FROM objections o WHERE o.request_id = r.id AND o.status IN ('open','tentative')) AS open_objections FROM requests r LEFT JOIN departments d ON d.id = r.department_id LEFT JOIN users u ON u.id = r.assigned_to WHERE 1=1 AND r.request_number != 'LIBRARY' AND r.request_number NOT LIKE 'SYS-%'" + scope.andLeaf('r');
  const params = [];
  if (!isElevated) {
    var orTeam = await get("SELECT id FROM departments WHERE kind='team' AND is_open_records=1 ORDER BY sort_order LIMIT 1");
    var triage = (orTeam && req.user.dept === orTeam.id) ? ' OR r.department_id IS NULL' : '';
    sql += ' AND (r.department_id = ? OR r.assigned_to = ?' + triage + ')';
    params.push(req.user.dept, req.user.sub);
  }
  if (req.query.stage) { sql += ' AND r.stage = ?'; params.push(req.query.stage); }
  if (req.query.status) { sql += ' AND r.status = ?'; params.push(req.query.status); }
  else { sql += " AND r.status != 'closed'"; }
  if (req.query.triage) { sql += " AND r.department_id IS NULL"; } // Needs-triage: Unassigned requests awaiting placement
  if (req.query.objections) { sql += " AND EXISTS (SELECT 1 FROM objections o WHERE o.request_id = r.id AND o.status IN ('open','tentative'))"; }
  if (req.query.search) {
    sql += ' AND (r.request_number LIKE ? OR r.requestor_name LIKE ? OR r.requestor_email LIKE ?)';
    const s = '%' + req.query.search + '%';
    params.push(s, s, s);
  }
  sql += ' ORDER BY r.created_at DESC, r.id DESC LIMIT 200'; // r.id: deterministic tiebreaker — created_at ties were shuffling the queue between reloads
  res.json({ requests: await all(sql, params) });
});

// Per-request timeline / bottleneck breakdown (Slice B): where the request's time went, as gap-free phase
// segments (stage backbone + task queue/process/review), submit-anchored. Feeds the request-detail panel.
router.get('/:id/timeline', requireAuth, async function(req, res) {
  const request = await get('SELECT id FROM requests WHERE id = ? OR request_number = ?', [req.params.id, req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  try { res.json(await require('../services/requestTimeline').build(request.id) || { segments: [] }); }
  catch (e) { res.status(500).json({ error: 'Could not build the timeline.' }); }
});

router.get('/:id', requireAuth, async function(req, res) {
  const request = await get('SELECT r.*, d.name as department_name, d.color as department_color FROM requests r LEFT JOIN departments d ON d.id = r.department_id WHERE r.id = ? OR r.request_number = ?', [req.params.id, req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const history = await all('SELECT * FROM request_history WHERE request_id = ? ORDER BY created_at ASC', [request.id]);
  const components = (request.is_mrr && !request.master_request_id) ? await all('SELECT * FROM requests WHERE master_request_id = ? ORDER BY component_label', [request.id]) : [];
  const selectedRecords = await all('SELECT id, record_id, title, source_system, public_availability, created_at FROM request_selected_records WHERE request_id = ? ORDER BY created_at ASC', [request.id]);
  const avRow = await get("SELECT EXISTS(SELECT 1 FROM record_types rt WHERE rt.id = r.record_type_id AND (rt.formats LIKE '%video%' OR rt.formats LIKE '%audio%')) AS by_type, EXISTS(SELECT 1 FROM request_files f WHERE f.request_id = r.id AND (f.mimetype LIKE 'video/%' OR f.mimetype LIKE 'audio/%')) AS by_file, EXISTS(SELECT 1 FROM av_redaction_tasks t WHERE t.request_id = r.id) AS by_task, EXISTS(SELECT 1 FROM requests c JOIN record_types rt2 ON rt2.id = c.record_type_id WHERE c.master_request_id = r.id AND (rt2.formats LIKE '%video%' OR rt2.formats LIKE '%audio%')) AS by_comp FROM requests r WHERE r.id = ?", [request.id]);
  request.av_applicable = (avRow && (avRow.by_type || avRow.by_file || avRow.by_task || avRow.by_comp)) ? 1 : 0;
  request.exemption_model = await activeExemptionModel();
  res.json({ request: request, history: history, components: components, selectedRecords: selectedRecords });
});

router.post('/', requireAuth, async function(req, res) {
  const b = req.body;
  if (!b.requestorName || !b.requestorEmail || !b.description) return res.status(400).json({ error: 'Name, email, and description required' });
  // ONE creation helper (ARCHITECTURE item 5) — numbering, defaults and the jurisdiction-derived deadline
  // live there once, instead of being re-implemented at every intake path.
  var made = await requestCreate.createRequest(b, {
    actorId: req.user.sub, actorName: req.user.name,
    historyAction: 'REQUEST_CREATED', historyNote: 'Request created by staff.'
  });
  res.status(201).json({ requestId: made.id, requestNumber: made.requestNumber, success: true });
});

router.patch('/:id/stage', requireAuth, async function(req, res) {
  const request = await get('SELECT * FROM requests WHERE id = ?', [req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const stage = req.body.stage;
  // 4d release gate: hold records at delivery until a pre-release balance is settled. Fails open.
  if (stage === 'delivery') {
    try {
      const rg = await require('../services/feeRelease').releaseGate(req.params.id);
      if (rg.hasEstimate && rg.requiresPaymentBeforeRelease && !rg.paidInFull) {
        return res.status(409).json({ error: 'Final payment of $' + rg.balanceDue.toFixed(2) + ' is required before these records can be released. Record the payment (or send the balance-due notice), then advance.', code: 'PAYMENT_REQUIRED_BEFORE_RELEASE', balanceDue: rg.balanceDue });
      }
    } catch (e) { console.error('[release gate]', e.message); }
  }
  // One central stage-transition path (Architecture item 6): UPDATE + STAGE_ADVANCED history + stage task.
  try {
    await require('../services/taskRouting').applyStageTransition(req.params.id, stage, {
      actorId: req.user.sub, actorName: req.user.name, action: 'STAGE_ADVANCED', notes: req.body.notes, createdBy: req.user.sub
    });
  } catch (e) { console.error('[stage transition]', e.message); }
  res.json({ success: true, stage: stage });
});


router.patch('/:id/route', requireAuth, async function(req, res) {
  var userRoles = req.user.roles || [];
  var canRoute = ['SUPERVISOR','DIRECTOR','SYSTEM_ADMIN','DEPT_MANAGER','COORDINATOR'].some(function(r){ return userRoles.indexOf(r) !== -1; });
  if (!canRoute) return res.status(403).json({ error: 'You do not have permission to re-route requests' });
  var request = await get('SELECT * FROM requests WHERE id = ?', [req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var teamId = req.body.departmentId;
  if (!teamId) return res.status(400).json({ error: 'departmentId (a fulfillment team) is required' });
  var team = await get("SELECT id, name FROM departments WHERE id = ? AND kind = 'team' AND active = 1", [teamId]);
  if (!team) return res.status(400).json({ error: 'Invalid fulfillment team' });
  var fromName = 'Unassigned';
  if (request.department_id) {
    var fromRow = await get('SELECT name FROM departments WHERE id = ?', [request.department_id]);
    if (fromRow) fromName = fromRow.name;
  }
  await run("UPDATE requests SET department_id = ?, updated_at = datetime('now') WHERE id = ?", [teamId, req.params.id]);
  var cleared = false;
  if (request.assigned_to) {
    var assignee = await get('SELECT department_id FROM users WHERE id = ?', [request.assigned_to]);
    if (!assignee || assignee.department_id !== teamId) {
      await run('UPDATE requests SET assigned_to = NULL WHERE id = ?', [req.params.id]);
      cleared = true;
    }
  }
  // #3 reassignment symmetry: move the request's active work onto the new team and re-route it there
  // (a specialist on the new team via Smart Routing, else the new team's pool). If none exists yet
  // (e.g. the request was Unassigned/triage), spawn the first work task on the new team and route it.
  try {
    var tr = require('../services/taskRouting');
    // The correction itself resolves any open routing-review task (the ORO Associate just did the review).
    await run("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE request_id = ? AND type = 'routing_review' AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [req.params.id]);
    // Move/re-route the actual WORK tasks onto the new team (exclude the routing-review task, now closed).
    var openTasks = await all("SELECT id, assigned_to FROM tasks WHERE request_id = ? AND type != 'routing_review' AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [req.params.id]);
    for (var oti = 0; oti < openTasks.length; oti++) {
      var ot = openTasks[oti];
      await run("UPDATE tasks SET team_id = ?, updated_at = datetime('now') WHERE id = ?", [teamId, ot.id]);
      if (ot.assigned_to) {
        var au = await get('SELECT department_id FROM users WHERE id = ?', [ot.assigned_to]);
        if (!au || au.department_id !== teamId) await run("UPDATE tasks SET assigned_to = NULL, status = 'open' WHERE id = ?", [ot.id]);
      }
      await tr.autoRouteOrPool(ot.id, request.description, {});
    }
    if (openTasks.length === 0) {
      var ntask = await tr.createTask({ requestId: req.params.id, type: 'estimate', title: 'Create estimate', teamId: teamId, createdBy: req.user.sub });
      await tr.autoRouteOrPool(ntask.id, request.description, {});
    }
  } catch (e) { console.error('[requests] reassignment re-route failed:', e && e.message); }
  await logHistory(req.params.id, req.user.sub, req.user.name, 'REROUTED',
    'Re-routed from ' + fromName + ' to ' + team.name + (cleared ? ' (prior assignment cleared)' : '') + (req.body.notes ? ' - ' + req.body.notes : ''));
  res.json({ success: true, departmentId: teamId, teamName: team.name, assignmentCleared: cleared });
});


router.patch('/:id/assign', requireAuth, async function(req, res) {
  var request = await get('SELECT * FROM requests WHERE id = ?', [req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var assignTo = req.body.assignTo || null;
  await run('UPDATE requests SET assigned_to = ? WHERE id = ?', [assignTo, req.params.id]);
  var actorName = req.user.name || 'Staff';
  var assigneeName = assignTo ? (await get('SELECT display_name FROM users WHERE id = ?', [assignTo]) || {display_name:'Unknown'}).display_name : 'Unassigned';
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [require('uuid').v4(), req.params.id, req.user.sub, actorName, 'ASSIGNED', 'Assigned to: ' + assigneeName]);
  res.json({ success: true });
});


router.get('/public/config', async function(req, res) {
  var { get } = require('../db');
  var name = await get('SELECT value FROM system_config WHERE key = ?', ['agency_name']);
  var phone = await get('SELECT value FROM system_config WHERE key = ?', ['contact_phone']);
  var email = await get('SELECT value FROM system_config WHERE key = ?', ['contact_email']);
  res.json({ agency_name: name ? name.value : 'City', contact_phone: phone ? phone.value : '', contact_email: email ? email.value : '' });
});

router.post('/public', async function(req, res) {
  var { run, get } = require('../db');
  var { v4: uuidv4 } = require('uuid');
  var b = req.body;
  if (!b.requestorName || !b.requestorEmail || !b.description) return res.status(400).json({ error: 'Name, email and description are required' });
  // ONE creation helper (ARCHITECTURE item 5). This path's old numbering read the LAST row by created_at and
  // incremented it — which restarts at 0001 whenever the newest row carries a non-standard number (e.g.
  // 'DEMO-2026-5069'), colliding with an existing request.
  var made = await requestCreate.createRequest(Object.assign({}, b, { submissionChannel: 'portal' }), {
    actorId: 'public', actorName: 'Public Portal',
    historyAction: 'CREATED', historyNote: 'Request submitted via public portal'
  });
  var id = made.id;
  var requestNumber = made.requestNumber;
  res.status(201).json({ success: true, requestNumber: requestNumber, requestId: id });
});

// Fee-waiver decision: grant or deny. Denial sends a mandatory notice, then the request
// continues like any normal inbound request (it is NOT closed). Reasons come from a reusable
// library; a newly typed reason is saved back into that library.
router.post('/:id/assert-exemption', requireAuth, async function(req, res) {
  var request = await get('SELECT * FROM requests WHERE id = ? OR request_number = ?', [req.params.id, req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var T = require('../services/tolling');
  var model = await activeExemptionModel();
  var actor = (req.user && req.user.name) || 'Staff';
  var note = (req.body && req.body.note) || '';
  if (model === 'pre_clearance') {
    try { await T.startClocksForRequest(request.id); } catch (e) {}
    var primary = await get("SELECT id FROM request_clocks WHERE request_id = (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?) AND is_primary = 1 ORDER BY created_at LIMIT 1", [request.id]);
    if (primary) { try { await T.toll(primary.id, 'ag_ruling_pending', 'Awaiting AG pre-clearance ruling' + (note ? ' - ' + note : '')); } catch (e) {} }
    var openAg = await get("SELECT id FROM request_clocks WHERE request_id = (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?) AND clock_type = 'ag_ruling' AND status != 'satisfied' ORDER BY created_at DESC LIMIT 1", [request.id]);
    var agId = openAg && openAg.id;
    if (!agId) { try { agId = await T.startClock(request.id, 'ag_ruling', {}); } catch (e) {} }
    await require('../services/taskRouting').applyStageTransition(request.id, 'ag_review', {
      actorId: req.user.sub, actorName: actor, action: 'AG_PRECLEARANCE_SUBMITTED',
      notes: 'Submitted for Attorney General pre-clearance; response clock tolled.' + (note ? ' ' + note : ''), createdBy: req.user.sub });
    return res.json({ model: model, stage: 'ag_review', tolled: !!primary, agClockId: agId });
  }
  await require('../services/taskRouting').applyStageTransition(request.id, 'exemption_review', {
    actorId: req.user.sub, actorName: actor, action: 'EXEMPTION_ASSERTED',
    notes: 'Exemption asserted (internal review).' + (note ? ' ' + note : ''), createdBy: req.user.sub });
  return res.json({ model: model, stage: 'exemption_review', tolled: false });
});

router.post('/:id/ag-ruling', requireAuth, async function(req, res) {
  var request = await get('SELECT * FROM requests WHERE id = ? OR request_number = ?', [req.params.id, req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var T = require('../services/tolling');
  var actor = (req.user && req.user.name) || 'Staff';
  var outcome = (req.body && req.body.outcome) || 'sustained';
  var note = (req.body && req.body.note) || '';
  var ag = await get("SELECT id FROM request_clocks WHERE request_id = (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?) AND clock_type = 'ag_ruling' AND status != 'satisfied' ORDER BY created_at DESC LIMIT 1", [request.id]);
  if (ag) { try { await T.satisfy(ag.id); } catch (e) {} }
  var primary = await get("SELECT id FROM request_clocks WHERE request_id = (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?) AND is_primary = 1 ORDER BY created_at LIMIT 1", [request.id]);
  // Release ONLY the AG hold. This used to close every open toll, so ruling on an AG matter silently ran the
  // clock even while a clarification was still outstanding. SPEC_parent_child_lifecycle.md §4.2.1.
  if (primary) { try { await T.resume(primary.id, 'ag_ruling_pending'); } catch (e) {} }
  var nextStage = outcome === 'overruled' ? 'delivery' : 'redaction_review';
  var label = outcome === 'sustained' ? 'withholding sustained' : outcome === 'overruled' ? 'must release' : 'partial release';
  // Entering redaction_review spawns the redaction task via the central path (previously left to the reconciler).
  await require('../services/taskRouting').applyStageTransition(request.id, nextStage, {
    actorId: req.user.sub, actorName: actor, action: 'AG_RULING_RECORDED',
    notes: 'AG ruling recorded (' + label + '); response clock resumed.' + (note ? ' ' + note : ''), createdBy: req.user.sub });
  return res.json({ outcome: outcome, stage: nextStage, agSatisfied: !!ag, resumed: !!primary });
});

router.post('/:id/fee-waiver-decision', requireAuth, async function(req, res) {
  // Authorize: managers/admins by function role, OR the FINANCE permission role (the same role the
  // fee-waiver task routes to — so whoever receives the task can act on it). FINANCE is the reconciled
  // financial-authority capability (D4 §8; renamed from FEE_AUTHORITY, retiring the orphan FEE_WAIVER_APPROVER).
  var fRoles = req.user.roles || [], perms = req.user.perms || [];
  var canDecide = ['SYSTEM_ADMIN','DIRECTOR','SUPERVISOR'].some(function(r){ return fRoles.indexOf(r) !== -1; }) || perms.indexOf('FINANCE') !== -1;
  if (!canDecide) return res.status(403).json({ error: 'Insufficient role' });
  var b = req.body || {};
  var decision = b.decision;
  if (decision !== 'grant' && decision !== 'deny') return res.status(400).json({ error: 'decision must be grant or deny' });
  var request = await get('SELECT * FROM requests WHERE id = ? OR request_number = ?', [req.params.id, req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'system';
  // Resolve the approval task (spawned at intake) whichever way the decision lands.
  var closeWaiverTask = "UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE request_id = ? AND type = 'fee_waiver' AND status IN ('open','assigned','in_progress','returned','awaiting_review')";

  if (decision === 'grant') {
    await run("UPDATE requests SET fee_waiver_status='granted', fee_waiver_decided_by=?, fee_waiver_decided_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [actor, request.id]);
    await run(closeWaiverTask, [request.id]);
    await logHistory(request.id, req.user.sub, actor, 'FEE_WAIVER_GRANTED', 'Fee waiver granted');
    return res.json({ decision: 'granted' });
  }

  // deny - resolve the reason (existing id, or new free text added to the library)
  var reasonText = (b.reasonText || '').trim();
  if (b.reasonId) {
    var r = await get('SELECT * FROM decision_reasons WHERE id = ?', [b.reasonId]);
    if (r) { reasonText = r.text; await run('UPDATE decision_reasons SET usage_count = usage_count + 1 WHERE id = ?', [b.reasonId]); }
  } else if (reasonText) {
    var existing = await get("SELECT * FROM decision_reasons WHERE category='fee_waiver_denial' AND lower(text)=lower(?)", [reasonText]);
    if (existing) { await run('UPDATE decision_reasons SET usage_count = usage_count + 1 WHERE id = ?', [existing.id]); }
    else { var nid = 'dr-' + uuidv4().substring(0,8); await run("INSERT INTO decision_reasons (id, category, text, usage_count, created_by) VALUES (?,?,?,1,?)", [nid, 'fee_waiver_denial', reasonText, req.user.sub]); }
  }
  if (!reasonText) return res.status(400).json({ error: 'A denial reason is required' });

  await run("UPDATE requests SET fee_waiver_status='denied', fee_waiver_reason=?, fee_waiver_decided_by=?, fee_waiver_decided_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [reasonText, actor, request.id]);
  await run(closeWaiverTask, [request.id]);
  await logHistory(request.id, req.user.sub, actor, 'FEE_WAIVER_DENIED', 'Denied: ' + reasonText);

  var mail = { sent: false };
  try { mail = await email.sendFeeWaiverDenial(request, reasonText); } catch (e) { console.error('[fee-waiver] denial email failed:', e.message); }

  res.json({ decision: 'denied', reason: reasonText, emailed: !!mail.sent, emailReason: mail.reason || null });
});

// Director escalation: flag a request for legal (advanced) redaction. Sets requests.legal_flag so the
// redaction stage spawns legal_redaction (office-level, routed to legal staff) instead of ordinary
// redaction. If a plain redaction task is already active, it is superseded and re-spawned as legal.
router.post('/:id/legal-escalate', requireAuth, async function(req, res) {
  var fRoles = req.user.roles || [];
  var canEscalate = ['SYSTEM_ADMIN','DIRECTOR'].some(function(r){ return fRoles.indexOf(r) !== -1; });
  if (!canEscalate) return res.status(403).json({ error: 'Only a Director can escalate for legal redaction' });
  var request = await get('SELECT * FROM requests WHERE id = ? OR request_number = ?', [req.params.id, req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'system';
  if (Number(request.legal_flag) === 1) return res.json({ legalFlag: true, alreadyFlagged: true, converted: false });

  var flagType = (req.body && req.body.type) || 'DIRECTOR_ESCALATION';
  var note = (req.body && req.body.note) ? String(req.body.note).slice(0, 500) : '';
  // One shared escalation path (SPEC_redaction_automation.md slice 5): sets legal_flag, logs LEGAL_ESCALATED,
  // and supersedes/respawns any open redaction task as legal_redaction.
  var r = await require('../services/taskRouting').escalateToLegal(request.id, { flagType: flagType, note: note, actorId: req.user.sub, actorName: actor });
  res.json({ legalFlag: true, alreadyFlagged: false, converted: r.converted, task: r.task });
});

// Contact requestor for clarification (record-search task action). Applies the jurisdiction's
// clarification_clock_effect to the response clock via the tolling engine — but ONLY when the
// clarification policy is enabled AND its jurisdiction-profile section is attested (safe-manual
// otherwise). Always records the effort-trail event. See SPEC_record_search_task_screen.md §5b and
// CLARIFICATION_POLICY_SURVEY.md §8 (slice 2). Reply side: POST .../clarification/resolve.
// THE EFFORT TRAIL (SPEC_record_search_task_screen §5a/§5c). The searcher's non-clarification actions —
// conferring with a supervisor, logging a phone call — are pure history entries. They are not decoration:
// they are the evidence that supports a "no responsive records" closure later, when someone asks what the
// city actually DID.
//
// The action is WHITELISTED, and that is deliberate. `request_history.action` is READ by other services —
// clarificationTimeout keys its auto-close sweep off CLARIFICATION_REQUESTED, and the stage machinery writes
// its own rows. An endpoint that accepted an arbitrary action string would let any authenticated caller forge
// a clarification, a stage transition, or a closure into the audit trail. Only these two are writable here.
var EFFORT_ACTIONS = {
  CONSULT_REQUESTED: 'Conferred with a supervisor',
  CALL_LOGGED: 'Logged a phone call'
};
router.post('/:id/effort', requireAuth, async function (req, res) {
  try {
    var b = req.body || {};
    var action = String(b.action || '');
    if (!EFFORT_ACTIONS[action]) return res.status(400).json({ error: 'Unsupported effort action' });
    var r = await get('SELECT id FROM requests WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    var notes = String(b.notes || '').trim() || EFFORT_ACTIONS[action];
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), req.params.id, req.user && req.user.sub, (req.user && req.user.name) || 'Staff', action, notes]);
    res.json({ ok: true, action: action, notes: notes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// R9 — what the portal already searched, grouped by description. The instruction block the record-search
// task screen opens with, and the data behind its "Self Service Portal Search Results" bar
// (SPEC_record_search_task_screen.md §2.3).
//
// requireAuth is NOT incidental here. `notSelected` is the set of records the requestor was shown and
// passed over -- it is invisible to them BY DESIGN and must never be reachable from the public portal.
router.get('/:id/search-intents', requireAuth, async function(req, res) {
  try {
    var SI = require('../services/searchIntents');
    res.json(await SI.forRequest(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// THE UN-GATE (Tier 1 #5). The searcher answers ONE description: "the records I attached answer this"
// (records_added) or "I searched; there is nothing more" (nothing_further, note required).
//
// Until every duty-carrying description is answered, POST /tasks/:id/resolve refuses `found` -- see the
// gate in routes/tasks.js. The answer is written to the intent row AND to request_history, because the
// per-description ledger is the thing the city shows when asked whether the search was diligent.
//
// SEARCH_INTENT_RESOLVED is deliberately NOT in the no-records effort-trail action list: an assertion that
// there is nothing more is a CLAIM, not evidence of a search. Letting it evidence itself would be circular
// -- it would mean a searcher could clear both gates having run no search at all.
router.post('/:id/search-intents/:intentId/resolve', requireAuth, async function(req, res) {
  try {
    var SI = require('../services/searchIntents');
    var b = req.body || {};
    var actorName = (req.user && req.user.name) || 'Staff';

    var row = await SI.resolve(req.params.intentId, {
      outcome: b.outcome, note: b.note, actorName: actorName
    });

    var verb = row.searcher_outcome === 'nothing_further'
      ? 'Searched — nothing further responsive'
      : 'Searched — responsive records attached';
    await logHistory(req.params.id, req.user && req.user.sub, actorName, 'SEARCH_INTENT_RESOLVED',
      verb + ' — "' + row.description + '"' + (row.resolution_note ? ': ' + row.resolution_note : ''));

    res.json({ ok: true, intent: row, openCount: (await SI.openIntents(req.params.id)).length });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

// Draft preview for the "Contact requestor" UI: the templated body + channel/address hints, no side effects.
router.get('/:id/clarification/preview', requireAuth, async function(req, res) {
  try {
    var CA = require('../services/clarificationAction');
    var out = await CA.preview(req.params.id, { channel: req.query.channel });
    res.json(out);
  } catch (e) { res.status(e.message === 'Request not found' ? 404 : 500).json({ error: e.message }); }
});
router.post('/:id/clarification', requireAuth, async function(req, res) {
  try {
    var CA = require('../services/clarificationAction');
    var b = req.body || {};
    // `reason` ('vague' | 'overly_broad') supersedes the old `vague` bool — but the bool is still accepted so
    // existing callers keep working. See clarificationAction: these are two DIFFERENT legal defects.
    var out = await CA.send(req.params.id, { reason: b.reason, vague: !!b.vague, note: b.note, channel: b.channel,
      to: b.to, mailingAddress: b.mailingAddress, subject: b.subject, text: b.text,
      actorId: req.user && req.user.sub, actorName: (req.user && req.user.name) || 'Staff' });
    res.json(out);
  } catch (e) {
    if (e && e.code === 'ADDRESS_REQUIRED') return res.status(400).json({ error: e.message, code: 'ADDRESS_REQUIRED' });
    res.status(e.message === 'Request not found' ? 404 : 500).json({ error: e.message });
  }
});
router.post('/:id/clarification/resolve', requireAuth, async function(req, res) {
  try {
    var CA = require('../services/clarificationAction');
    var b = req.body || {};
    var out = await CA.resolve(req.params.id, { note: b.note, actorId: req.user && req.user.sub, actorName: (req.user && req.user.name) || 'Staff' });
    res.json(out);
  } catch (e) { res.status(e.message === 'Request not found' ? 404 : 500).json({ error: e.message }); }
});

module.exports = router;

