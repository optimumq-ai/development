const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const email = require('../services/email');
const { all, get, run } = require('../db');
const { v4: uuidv4 } = require('uuid');
const workflowEngine = require('../services/workflowEngine');
async function activeExemptionModel() {
  try {
    var jrow = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
    var jid = jrow && jrow.value; if (!jid) return 'self_court';
    var jp = await get('SELECT exemption_model FROM jurisdiction_profiles WHERE id = ?', [jid]);
    return (jp && jp.exemption_model) || 'self_court';
  } catch (e) { return 'self_court'; }
}

async function generateRequestNumber() {
  const year = new Date().getFullYear();
  const existing = await all("SELECT request_number FROM requests WHERE request_number LIKE '" + year + "-%' ORDER BY request_number DESC LIMIT 1");
  let seq = 1;
  if (existing.length > 0) seq = parseInt(existing[0].request_number.split('-')[1]) + 1;
  return year + '-' + String(seq).padStart(4, '0');
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
  const total = await get('SELECT COUNT(*) as count FROM requests WHERE ' + where, params);
  const overdue = await get("SELECT COUNT(*) as count FROM requests WHERE " + where + " AND deadline_date < date('now')", params);
  const byStage = await all('SELECT stage, COUNT(*) as count FROM requests WHERE ' + where + ' GROUP BY stage', params);
  const stageMap = {};
  byStage.forEach(function(r) { stageMap[r.stage] = r.count; });
  res.json({ total: total ? total.count : 0, overdue: overdue ? overdue.count : 0, byStage: stageMap });
});

router.get('/', requireAuth, async function(req, res) {
  const userRoles = req.user.roles || [];
  const isElevated = ['SUPERVISOR','DIRECTOR','SYSTEM_ADMIN','DEPT_MANAGER','ATTORNEY_REVIEWER'].some(function(r) { return userRoles.indexOf(r) !== -1; });
  let sql = "SELECT r.*, d.name as department_name, d.color as department_color, u.display_name as assigned_to_name, (SELECT t.status FROM tasks t WHERE t.request_id = r.id AND t.status IN ('open','assigned','in_progress') ORDER BY t.updated_at DESC LIMIT 1) AS active_task_status, (SELECT tu.display_name FROM tasks t2 LEFT JOIN users tu ON tu.id = t2.assigned_to WHERE t2.request_id = r.id AND t2.status IN ('assigned','in_progress') ORDER BY t2.updated_at DESC LIMIT 1) AS active_task_assignee FROM requests r LEFT JOIN departments d ON d.id = r.department_id LEFT JOIN users u ON u.id = r.assigned_to WHERE 1=1 AND r.request_number != 'LIBRARY'";
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
  if (req.query.search) {
    sql += ' AND (r.request_number LIKE ? OR r.requestor_name LIKE ? OR r.requestor_email LIKE ?)';
    const s = '%' + req.query.search + '%';
    params.push(s, s, s);
  }
  sql += ' ORDER BY r.created_at DESC LIMIT 200';
  res.json({ requests: await all(sql, params) });
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
  const requestId = uuidv4();
  const requestNumber = await generateRequestNumber();
  const deadline = new Date();
  const days = b.classification === 'complex' ? 20 : b.classification === 'redaction_required' ? 30 : b.classification === 'simple' ? 5 : 10;
  deadline.setDate(deadline.getDate() + days);
  await run('INSERT INTO requests (id, request_number, requestor_name, requestor_email, requestor_phone, requestor_type, delivery_method, description, record_types, classification, fee_waiver_requested, submission_channel, is_mrr, deadline_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [requestId, requestNumber, b.requestorName, b.requestorEmail, b.requestorPhone || null, b.requestorType || 'individual', b.deliveryMethod || 'email', b.description, JSON.stringify(b.recordTypes || []), b.classification || 'standard', b.feeWaiverRequested ? 1 : 0, b.submissionChannel || 'portal', b.isMrr ? 1 : 0, deadline.toISOString().split('T')[0]]);
  await logHistory(requestId, req.user.sub, req.user.name, 'REQUEST_CREATED');
  workflowEngine.bg(workflowEngine.onIntake(requestId), 'intake ' + requestId);
  res.status(201).json({ requestId: requestId, requestNumber: requestNumber, success: true });
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
  await run("UPDATE requests SET stage = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
    [stage, stage === 'closed' ? 'closed' : 'active', req.params.id]);
  await logHistory(req.params.id, req.user.sub, req.user.name, 'STAGE_ADVANCED', req.body.notes);
  // Entering record_search / redaction spawns the matching task and routes it (shared path).
  try { await require('../services/taskRouting').spawnForStage(req.params.id, stage, req.user.sub); }
  catch (e) { console.error('[stage-task spawn]', e.message); }
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
    var openTasks = await all("SELECT id, assigned_to FROM tasks WHERE request_id = ? AND status IN ('open','assigned','in_progress')", [req.params.id]);
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
  var year = new Date().getFullYear();
  var last = await get('SELECT request_number FROM requests ORDER BY created_at DESC LIMIT 1');
  var nextNum = 1;
  if (last) { var parts = last.request_number.split('-'); if (parts[0] == year) nextNum = parseInt(parts[1]) + 1; }
  var requestNumber = year + '-' + String(nextNum).padStart(4,'0');
  var deadlineDays = { simple:5, standard:10, complex:20, redaction_required:30 };
  var days = deadlineDays[b.classification||'standard'] || 10;
  var deadline = new Date(); deadline.setDate(deadline.getDate() + days);
  var deadlineStr = deadline.toISOString().split('T')[0];
  var id = uuidv4();
  await run('INSERT INTO requests (id, request_number, requestor_name, requestor_email, requestor_phone, requestor_type, delivery_method, description, classification, department_id, fee_waiver_requested, is_mrr, submission_channel, stage, status, deadline_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))',
    [id, requestNumber, b.requestorName, b.requestorEmail, b.requestorPhone||'', b.requestorType||'individual', b.deliveryMethod||'email', b.description, b.classification||'standard', b.departmentId||null, b.feeWaiverRequested?1:0, b.isMrr?1:0, 'portal', 'intake', 'active', deadlineStr]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
    [uuidv4(), id, 'public', 'Public Portal', 'CREATED', 'Request submitted via public portal']);
  workflowEngine.bg(workflowEngine.onIntake(id), 'intake ' + id);
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
    var primary = await get("SELECT id FROM request_clocks WHERE request_id = ? AND is_primary = 1 ORDER BY created_at LIMIT 1", [request.id]);
    if (primary) { try { await T.toll(primary.id, 'ag_ruling_pending', 'Awaiting AG pre-clearance ruling' + (note ? ' - ' + note : '')); } catch (e) {} }
    var openAg = await get("SELECT id FROM request_clocks WHERE request_id = ? AND clock_type = 'ag_ruling' AND status != 'satisfied' ORDER BY created_at DESC LIMIT 1", [request.id]);
    var agId = openAg && openAg.id;
    if (!agId) { try { agId = await T.startClock(request.id, 'ag_ruling', {}); } catch (e) {} }
    await run("UPDATE requests SET stage = 'ag_review', updated_at = datetime('now') WHERE id = ?", [request.id]);
    await logHistory(request.id, req.user.sub, actor, 'AG_PRECLEARANCE_SUBMITTED', 'Submitted for Attorney General pre-clearance; response clock tolled.' + (note ? ' ' + note : ''));
    return res.json({ model: model, stage: 'ag_review', tolled: !!primary, agClockId: agId });
  }
  await run("UPDATE requests SET stage = 'exemption_review', updated_at = datetime('now') WHERE id = ?", [request.id]);
  await logHistory(request.id, req.user.sub, actor, 'EXEMPTION_ASSERTED', 'Exemption asserted (internal review).' + (note ? ' ' + note : ''));
  return res.json({ model: model, stage: 'exemption_review', tolled: false });
});

router.post('/:id/ag-ruling', requireAuth, async function(req, res) {
  var request = await get('SELECT * FROM requests WHERE id = ? OR request_number = ?', [req.params.id, req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var T = require('../services/tolling');
  var actor = (req.user && req.user.name) || 'Staff';
  var outcome = (req.body && req.body.outcome) || 'sustained';
  var note = (req.body && req.body.note) || '';
  var ag = await get("SELECT id FROM request_clocks WHERE request_id = ? AND clock_type = 'ag_ruling' AND status != 'satisfied' ORDER BY created_at DESC LIMIT 1", [request.id]);
  if (ag) { try { await T.satisfy(ag.id); } catch (e) {} }
  var primary = await get("SELECT id FROM request_clocks WHERE request_id = ? AND is_primary = 1 ORDER BY created_at LIMIT 1", [request.id]);
  if (primary) { try { await T.resume(primary.id); } catch (e) {} }
  var nextStage = outcome === 'overruled' ? 'delivery' : 'redaction_review';
  await run("UPDATE requests SET stage = ?, updated_at = datetime('now') WHERE id = ?", [nextStage, request.id]);
  var label = outcome === 'sustained' ? 'withholding sustained' : outcome === 'overruled' ? 'must release' : 'partial release';
  await logHistory(request.id, req.user.sub, actor, 'AG_RULING_RECORDED', 'AG ruling recorded (' + label + '); response clock resumed.' + (note ? ' ' + note : ''));
  return res.json({ outcome: outcome, stage: nextStage, agSatisfied: !!ag, resumed: !!primary });
});

router.post('/:id/fee-waiver-decision', requireAuth, requireRole('SYSTEM_ADMIN','DIRECTOR','SUPERVISOR','FEE_WAIVER_APPROVER'), async function(req, res) {
  var b = req.body || {};
  var decision = b.decision;
  if (decision !== 'grant' && decision !== 'deny') return res.status(400).json({ error: 'decision must be grant or deny' });
  var request = await get('SELECT * FROM requests WHERE id = ? OR request_number = ?', [req.params.id, req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var actor = (req.user && req.user.name) || (req.user && req.user.sub) || 'system';

  if (decision === 'grant') {
    await run("UPDATE requests SET fee_waiver_status='granted', fee_waiver_decided_by=?, fee_waiver_decided_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [actor, request.id]);
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
  await logHistory(request.id, req.user.sub, actor, 'FEE_WAIVER_DENIED', 'Denied: ' + reasonText);

  var mail = { sent: false };
  try { mail = await email.sendFeeWaiverDenial(request, reasonText); } catch (e) { console.error('[fee-waiver] denial email failed:', e.message); }

  res.json({ decision: 'denied', reason: reasonText, emailed: !!mail.sent, emailReason: mail.reason || null });
});

module.exports = router;

