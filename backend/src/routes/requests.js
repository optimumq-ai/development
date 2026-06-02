const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all, get, run } = require('../db');
const { v4: uuidv4 } = require('uuid');

function generateRequestNumber() {
  const year = new Date().getFullYear();
  const existing = all("SELECT request_number FROM requests WHERE request_number LIKE '" + year + "-%' ORDER BY request_number DESC LIMIT 1");
  let seq = 1;
  if (existing.length > 0) seq = parseInt(existing[0].request_number.split('-')[1]) + 1;
  return year + '-' + String(seq).padStart(4, '0');
}

function logHistory(requestId, actorId, actorName, action, notes) {
  run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), requestId, actorId, actorName, action, notes || null]);
}

router.get('/stats/dashboard', requireAuth, function(req, res) {
  const userRoles = req.user.roles || [];
  const isElevated = ['SUPERVISOR','DIRECTOR','SYSTEM_ADMIN','DEPT_MANAGER'].some(function(r) { return userRoles.indexOf(r) !== -1; });
  let where = "status = 'active'";
  const params = [];
  if (!isElevated) { where += ' AND (department_id = ? OR assigned_to = ?)'; params.push(req.user.dept, req.user.sub); }
  const total = get('SELECT COUNT(*) as count FROM requests WHERE ' + where, params);
  const overdue = get("SELECT COUNT(*) as count FROM requests WHERE " + where + " AND deadline_date < date('now')", params);
  const byStage = all('SELECT stage, COUNT(*) as count FROM requests WHERE ' + where + ' GROUP BY stage', params);
  const stageMap = {};
  byStage.forEach(function(r) { stageMap[r.stage] = r.count; });
  res.json({ total: total ? total.count : 0, overdue: overdue ? overdue.count : 0, byStage: stageMap });
});

router.get('/', requireAuth, function(req, res) {
  const userRoles = req.user.roles || [];
  const isElevated = ['SUPERVISOR','DIRECTOR','SYSTEM_ADMIN','DEPT_MANAGER','ATTORNEY_REVIEWER'].some(function(r) { return userRoles.indexOf(r) !== -1; });
  let sql = "SELECT r.*, d.name as department_name, d.color as department_color, u.display_name as assigned_to_name FROM requests r LEFT JOIN departments d ON d.id = r.department_id LEFT JOIN users u ON u.id = r.assigned_to WHERE 1=1";
  const params = [];
  if (!isElevated) { sql += ' AND (r.department_id = ? OR r.assigned_to = ?)'; params.push(req.user.dept, req.user.sub); }
  if (req.query.stage) { sql += ' AND r.stage = ?'; params.push(req.query.stage); }
  if (req.query.status) { sql += ' AND r.status = ?'; params.push(req.query.status); }
  else { sql += " AND r.status != 'closed'"; }
  if (req.query.search) {
    sql += ' AND (r.request_number LIKE ? OR r.requestor_name LIKE ? OR r.requestor_email LIKE ?)';
    const s = '%' + req.query.search + '%';
    params.push(s, s, s);
  }
  sql += ' ORDER BY r.created_at DESC LIMIT 200';
  res.json({ requests: all(sql, params) });
});

router.get('/:id', requireAuth, function(req, res) {
  const request = get('SELECT r.*, d.name as department_name, d.color as department_color FROM requests r LEFT JOIN departments d ON d.id = r.department_id WHERE r.id = ? OR r.request_number = ?', [req.params.id, req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const history = all('SELECT * FROM request_history WHERE request_id = ? ORDER BY created_at ASC', [request.id]);
  const components = (request.is_mrr && !request.master_request_id) ? all('SELECT * FROM requests WHERE master_request_id = ? ORDER BY component_label', [request.id]) : [];
  const selectedRecords = all('SELECT id, record_id, title, source_system, public_availability, created_at FROM request_selected_records WHERE request_id = ? ORDER BY created_at ASC', [request.id]);
  res.json({ request: request, history: history, components: components, selectedRecords: selectedRecords });
});

router.post('/', requireAuth, function(req, res) {
  const b = req.body;
  if (!b.requestorName || !b.requestorEmail || !b.description) return res.status(400).json({ error: 'Name, email, and description required' });
  const requestId = uuidv4();
  const requestNumber = generateRequestNumber();
  const deadline = new Date();
  const days = b.classification === 'complex' ? 20 : b.classification === 'redaction_required' ? 30 : b.classification === 'simple' ? 5 : 10;
  deadline.setDate(deadline.getDate() + days);
  run('INSERT INTO requests (id, request_number, requestor_name, requestor_email, requestor_phone, requestor_type, delivery_method, description, record_types, classification, fee_waiver_requested, submission_channel, is_mrr, deadline_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [requestId, requestNumber, b.requestorName, b.requestorEmail, b.requestorPhone || null, b.requestorType || 'individual', b.deliveryMethod || 'email', b.description, JSON.stringify(b.recordTypes || []), b.classification || 'standard', b.feeWaiverRequested ? 1 : 0, b.submissionChannel || 'portal', b.isMrr ? 1 : 0, deadline.toISOString().split('T')[0]]);
  logHistory(requestId, req.user.sub, req.user.name, 'REQUEST_CREATED');
  res.status(201).json({ requestId: requestId, requestNumber: requestNumber, success: true });
});

router.patch('/:id/stage', requireAuth, function(req, res) {
  const request = get('SELECT * FROM requests WHERE id = ?', [req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const stage = req.body.stage;
  run("UPDATE requests SET stage = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
    [stage, stage === 'closed' ? 'closed' : 'active', req.params.id]);
  logHistory(req.params.id, req.user.sub, req.user.name, 'STAGE_ADVANCED', req.body.notes);
  res.json({ success: true, stage: stage });
});


router.patch('/:id/assign', requireAuth, function(req, res) {
  var request = get('SELECT * FROM requests WHERE id = ?', [req.params.id]);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  var assignTo = req.body.assignTo || null;
  run('UPDATE requests SET assigned_to = ? WHERE id = ?', [assignTo, req.params.id]);
  var actorName = req.user.name || 'Staff';
  var assigneeName = assignTo ? (get('SELECT display_name FROM users WHERE id = ?', [assignTo]) || {display_name:'Unknown'}).display_name : 'Unassigned';
  run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [require('uuid').v4(), req.params.id, req.user.sub, actorName, 'ASSIGNED', 'Assigned to: ' + assigneeName]);
  res.json({ success: true });
});


router.get('/public/config', function(req, res) {
  var { get } = require('../db');
  var name = get('SELECT value FROM system_config WHERE key = ?', ['agency_name']);
  var phone = get('SELECT value FROM system_config WHERE key = ?', ['contact_phone']);
  var email = get('SELECT value FROM system_config WHERE key = ?', ['contact_email']);
  res.json({ agency_name: name ? name.value : 'City', contact_phone: phone ? phone.value : '', contact_email: email ? email.value : '' });
});

router.post('/public', function(req, res) {
  var { run, get } = require('../db');
  var { v4: uuidv4 } = require('uuid');
  var b = req.body;
  if (!b.requestorName || !b.requestorEmail || !b.description) return res.status(400).json({ error: 'Name, email and description are required' });
  var year = new Date().getFullYear();
  var last = get('SELECT request_number FROM requests ORDER BY created_at DESC LIMIT 1');
  var nextNum = 1;
  if (last) { var parts = last.request_number.split('-'); if (parts[0] == year) nextNum = parseInt(parts[1]) + 1; }
  var requestNumber = year + '-' + String(nextNum).padStart(4,'0');
  var deadlineDays = { simple:5, standard:10, complex:20, redaction_required:30 };
  var days = deadlineDays[b.classification||'standard'] || 10;
  var deadline = new Date(); deadline.setDate(deadline.getDate() + days);
  var deadlineStr = deadline.toISOString().split('T')[0];
  var id = uuidv4();
  run('INSERT INTO requests (id, request_number, requestor_name, requestor_email, requestor_phone, requestor_type, delivery_method, description, classification, department_id, fee_waiver_requested, is_mrr, submission_channel, stage, status, deadline_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))',
    [id, requestNumber, b.requestorName, b.requestorEmail, b.requestorPhone||'', b.requestorType||'individual', b.deliveryMethod||'email', b.description, b.classification||'standard', b.departmentId||null, b.feeWaiverRequested?1:0, b.isMrr?1:0, 'portal', 'intake', 'active', deadlineStr]);
  run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
    [uuidv4(), id, 'public', 'Public Portal', 'CREATED', 'Request submitted via public portal']);
  res.status(201).json({ success: true, requestNumber: requestNumber, requestId: id });
});

module.exports = router;
