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

// PHASE 7 / WS2 — WHICH DENIAL PATH DOES THIS STATE ACTUALLY HAVE?
//
// Until now this was decided by ONE hand-set column, `jurisdiction_profiles.exemption_model`: set it to
// `pre_clearance` and asserting an exemption goes to the AG; leave it anything else and it goes to staff
// review. The column has no provenance and nothing checks it against the state's law — a fresh
// jurisdiction defaults to `self_court` simply because that is the fallback string.
//
// The imported branch profile does have provenance: TX carries all eight AG-band nodes with the § 552.301
// rules behind them, OH carries none. So the profile is now the AUTHORITY and the column is the fallback:
//
//   band active + pre_clearance  -> AG referral   (TX: the band REPLACES staff denial)
//   band explicitly inactive     -> staff review  (OH: the AG stage does not exist, whatever the column says)
//   band active, column not set  -> AG referral   (the researched profile beats an unset default)
//   no branch profile at all     -> the column decides, exactly as before
//
// The last line is the compatibility guarantee: nineteen seeded jurisdictions have no profile and are
// unaffected.
async function agBandDecision(jid, model) {
  var BP = require('../services/branchProfile');
  var band = null;
  try { band = await BP.isActive(jid, 'ag_referral'); } catch (e) { band = null; }
  if (band === false) return { stage: 'exemption_review', band: false, source: 'branch_profile' };
  if (band === true) return { stage: 'ag_review', band: true, source: model === 'pre_clearance' ? 'branch_profile+model' : 'branch_profile' };
  return { stage: model === 'pre_clearance' ? 'ag_review' : 'exemption_review', band: null, source: 'exemption_model' };
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
  // THE QUEUE LISTS WORK ROWS — children (§7: "filters, reports and worklists operate on CHILD rows"). But four
  // of the columns it renders are PARENT facts, and reading them off the leaf is wrong now that children exist:
  //
  //   request_number — a child's own number carries the component suffix ('2026-000001-1'). That is a number the
  //                    citizen has never seen and cannot quote on the phone. Resolve it through the parent.
  //   is_mrr         — DERIVED and PARENT-level (§4.1). requestCreate forces `is_mrr = 0` on every child, so
  //                    reading it off the leaf meant the MRR badge could NEVER render. Resolve it through the parent.
  //   parent_id      — the grouping key the queue renders by (parent line, children indented).
  //   child_count    — decides collapse: at 1 the pair renders as a single line and the '-1' is hidden.
  //
  // `r.*` already emits request_number and is_mrr. The explicit aliases below come LATER in the select list and
  // node-pg keeps the LAST column of a duplicated name — that is what makes the parent's value win. This is a
  // real driver behaviour, but it is implicit, so verify_queue_parent_child asserts it rather than trusting it.
  let sql = "SELECT r.*, " +
    scope.numberExpr('r') + " AS request_number, " +   // the CITIZEN's number (the parent's)
    "r.request_number AS component_number, " +          // this child's own suffixed number
    "COALESCE(_p.id, r.id) AS parent_id, " +
    "COALESCE(_p.is_mrr, r.is_mrr) AS is_mrr, " +
    "(SELECT COUNT(*) FROM requests _c2 WHERE _c2.master_request_id = COALESCE(_p.id, r.id)) AS child_count, " +
    "d.name as department_name, d.color as department_color, u.display_name as assigned_to_name, (SELECT t.status FROM tasks t WHERE t.request_id = r.id AND t.status IN ('open','assigned','in_progress','returned','awaiting_review') ORDER BY t.updated_at DESC LIMIT 1) AS active_task_status, (SELECT tu.display_name FROM tasks t2 LEFT JOIN users tu ON tu.id = t2.assigned_to WHERE t2.request_id = r.id AND t2.status IN ('assigned','in_progress','returned','awaiting_review') ORDER BY t2.updated_at DESC LIMIT 1) AS active_task_assignee, (SELECT COUNT(*) FROM objections o WHERE o.request_id = r.id AND o.status IN ('open','tentative')) AS open_objections FROM requests r" + scope.numberJoin('r') + " LEFT JOIN departments d ON d.id = r.department_id LEFT JOIN users u ON u.id = r.assigned_to WHERE 1=1 AND r.request_number != 'LIBRARY' AND r.request_number NOT LIKE 'SYS-%'" + scope.andLeaf('r');
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
    // Search the CITIZEN's number, not the child's suffixed one — staff type the number the requestor quotes.
    // (Matching the parent's number returns every child of it, which is what "find request 2026-000012" means.)
    sql += ' AND (' + scope.numberExpr('r') + ' LIKE ? OR r.requestor_name LIKE ? OR r.requestor_email LIKE ?)';
    const s = '%' + req.query.search + '%';
    params.push(s, s, s);
  }
  // Order by the PARENT's recency, then by child_no ASCENDING within each request — the queue renders a parent
  // line with its children indented beneath (§7), so the children of one request must arrive together and in
  // component order. Ordering by the child's own created_at instead put an MRR's records on screen backwards
  // (-3, -2, -1), because they are inserted in one loop milliseconds apart.
  // COALESCE(_p.id, r.id) keeps a request's children adjacent even when two requests share a created_at;
  // r.id remains the final deterministic tiebreaker — ties were shuffling the queue between reloads.
  sql += ' ORDER BY COALESCE(_p.created_at, r.created_at) DESC, COALESCE(_p.id, r.id), r.child_no NULLS FIRST, r.id LIMIT 200';
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
  // PARENT FACTS COME FROM THE PARENT. A raw `SELECT r.*` here answered "what request is this?" differently
  // depending on which row you addressed: the parent knew the citizen's number and that it was an MRR but
  // carried NO stage, while each child knew its stage but reported a suffixed number the citizen has never
  // seen and `is_mrr = 0` (requestCreate forces that on every child) — so the MRR badge silently vanished.
  // There was no id you could pass that produced a correct, complete picture. Resolve the parent-level facts
  // through the parent; description/stage/routing still come from the row addressed, which is the work.
  const request = await get(
    'SELECT r.*, ' +
    scope.numberExpr('r') + ' AS request_number, ' +
    scope.parentFact('is_mrr', 'r') + ' AS is_mrr, ' +
    'r.master_request_id AS parent_id, ' +
    'd.name as department_name, d.color as department_color ' +
    'FROM requests r' + scope.numberJoin('r') +
    ' LEFT JOIN departments d ON d.id = r.department_id WHERE r.id = ? OR r.request_number = ?',
    [req.params.id, req.params.id]);
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

// ADVANCING IS PROCESSING, SO IT LANDS ON THE CHILD (Kevin's ruling, 2026-07-19 — see requestScope.workRow).
// Stage belongs to the described item; the parent is who asked and whether they paid. This route passed
// `req.params.id` straight through, so advancing a parent-addressed request wrote a work stage onto the
// PARENT and left the child where it was — the same defect fixed on assert-exemption in cbc9e46, and the
// Advance button on the request workspace calls exactly this.
router.patch('/:id/stage', requireAuth, async function(req, res) {
  const resolvedStage = await scope.workRow(req.params.id);
  if (!resolvedStage.addressed) return res.status(404).json({ error: 'Request not found' });
  if (resolvedStage.ambiguous) {
    return res.status(409).json({
      error: 'This request has ' + resolvedStage.ambiguous.length + ' records, each with its own stage. ' +
             'Advance the one you mean.',
      code: 'AMBIGUOUS_WORK_ROW',
      components: resolvedStage.ambiguous.map(function (c) {
        return { id: c.id, requestNumber: c.request_number, label: c.component_label, description: c.description, stage: c.stage };
      })
    });
  }
  const request = resolvedStage.row;
  const workId = request.id;
  const stage = req.body.stage;
  // Without this, a missing stage reached applyStageTransition, threw, was swallowed below, and the route
  // still answered `success: true` — the UI then showed a request as advanced when nothing had moved.
  if (!stage) return res.status(400).json({ error: 'A stage is required.' });
  // 4d release gate: hold records at delivery until a pre-release balance is settled. Fails open.
  if (stage === 'delivery') {
    try {
      // §5.9 COVERAGE TEST — gate on THIS record's own share (`covered`), not the whole request's balance.
      // A child may never be withheld because a SIBLING is unpaid. For a single-record request the two are
      // the same number, so this is an exact no-op there; it only diverges once a request has n > 1 records.
      // The WORK row, not the addressed one: `shareFor` looks for THIS row among the estimate's components,
      // so a parent id finds no share and silently degrades to the whole-request test (stricter, but it
      // would judge a different row than the one being advanced).
      const rg = await require('../services/feeRelease').releaseGate(workId);
      if (rg.hasEstimate && rg.requiresPaymentBeforeRelease && !rg.covered) {
        return res.status(409).json({
          error: 'Payment of $' + rg.balanceDue.toFixed(2) + ' is required before ' +
            (rg.coverageBasis === 'component' ? 'this record' : 'these records') +
            ' can be released. Record the payment (or send the balance-due notice), then advance.',
          code: 'PAYMENT_REQUIRED_BEFORE_RELEASE', balanceDue: rg.balanceDue,
          coverageBasis: rg.coverageBasis, componentCharged: rg.componentCharged
        });
      }
    } catch (e) { console.error('[release gate]', e.message); }
  }
  // One central stage-transition path (Architecture item 6): UPDATE + STAGE_ADVANCED history + stage task.
  //
  // A FAILED ADVANCE MUST NOT REPORT SUCCESS. This used to log the error and fall through to
  // `{ success: true, stage }`, so a transition that threw — bad stage, DB error, a guard refusing — left the
  // UI showing the request as advanced while nothing had moved. A silent no-op that claims to have worked is
  // worse than an error: nobody goes looking for it.
  try {
    await require('../services/taskRouting').applyStageTransition(workId, stage, {
      actorId: req.user.sub, actorName: req.user.name, action: 'STAGE_ADVANCED', notes: req.body.notes, createdBy: req.user.sub
    });
  } catch (e) {
    console.error('[stage transition]', e.message);
    return res.status(500).json({ error: 'The stage could not be advanced. ' + e.message });
  }
  res.json({ success: true, stage: stage, requestId: workId });
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
  // The department write above has already landed, so a failure here is a PARTIAL reassignment, not a failed
  // one: the request reads as the new team while its work may still sit in the old team's pool. A 500 would
  // wrongly imply nothing happened; a bare `success: true` (what this used to do) hides a real divergence.
  // So: report it in the response AND in the REROUTED history note, where the router is already looking.
  var rerouteError = null;
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
  } catch (e) {
    rerouteError = (e && e.message) || 'unknown error';
    console.error('[requests] reassignment re-route failed:', rerouteError);
  }
  await logHistory(req.params.id, req.user.sub, req.user.name, 'REROUTED',
    'Re-routed from ' + fromName + ' to ' + team.name + (cleared ? ' (prior assignment cleared)' : '') + (req.body.notes ? ' - ' + req.body.notes : '')
    + (rerouteError ? ' — WARNING: the request moved teams but its open work did NOT follow. Its tasks may still sit with ' + fromName + '. (' + rerouteError + ')' : ''));
  res.json({
    success: true, departmentId: teamId, teamName: team.name, assignmentCleared: cleared,
    tasksReassigned: !rerouteError,
    warning: rerouteError ? 'The request moved to ' + team.name + ', but its open tasks could not be moved and may still sit with ' + fromName + '.' : undefined
  });
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
// AN EXEMPTION IS ASSERTED ABOUT A DESCRIBED ITEM — so it lands on the CHILD (Kevin, 2026-07-19).
//
// "the exemption applies to processing a request that has a description of item requested. it's a child
//  record level issue. the parent should be thought of as who requested the information and did he pay for
//  it, etc."
//
// This used to hand whatever row the caller named straight to applyStageTransition. Naming the parent moved
// the PARENT into a legal stage and spawned legal_review there, while the child holding the description sat
// at `intake` with its own open routing_review — the request looked untouched and the legal work was
// attached to a row that describes nothing. `scope.workRow` resolves to the row processing belongs to, and
// REFUSES rather than guessing when a multi-record parent leaves it ambiguous.
//
// THE CLOCK STAYS ON THE PARENT and the code below already does that (`COALESCE(master_request_id, id)`),
// which is the same division read from the other side: the statutory deadline is the citizen's, one per
// request, no matter how many described items hang off it.
router.post('/:id/assert-exemption', requireAuth, async function(req, res) {
  var resolved = await scope.workRow(req.params.id);
  if (!resolved.addressed) return res.status(404).json({ error: 'Request not found' });
  if (resolved.ambiguous) {
    return res.status(409).json({
      error: 'This request has ' + resolved.ambiguous.length + ' records. An exemption is asserted about one ' +
             'described record — say which.',
      code: 'AMBIGUOUS_WORK_ROW',
      components: resolved.ambiguous.map(function (c) {
        return { id: c.id, requestNumber: c.request_number, label: c.component_label, description: c.description, stage: c.stage };
      })
    });
  }
  var request = resolved.row;
  var T = require('../services/tolling');
  var model = await activeExemptionModel();
  var actor = (req.user && req.user.name) || 'Staff';
  var note = (req.body && req.body.note) || '';
  var jidNow = (await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value || null;
  var band = await agBandDecision(jidNow, model);
  if (band.stage === 'ag_review') {
    try { await T.startClocksForRequest(request.id); } catch (e) {}
    var primary = await get("SELECT id FROM request_clocks WHERE request_id = (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?) AND is_primary = 1 ORDER BY created_at LIMIT 1", [request.id]);
    if (primary) { try { await T.toll(primary.id, 'ag_ruling_pending', 'Awaiting AG pre-clearance ruling' + (note ? ' - ' + note : '')); } catch (e) {} }
    var openAg = await get("SELECT id FROM request_clocks WHERE request_id = (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?) AND clock_type = 'ag_ruling' AND status != 'satisfied' ORDER BY created_at DESC LIMIT 1", [request.id]);
    var agId = openAg && openAg.id;
    if (!agId) { try { agId = await T.startClock(request.id, 'ag_ruling', {}); } catch (e) {} }
    await require('../services/taskRouting').applyStageTransition(request.id, 'ag_review', {
      actorId: req.user.sub, actorName: actor, action: 'AG_PRECLEARANCE_SUBMITTED',
      notes: 'Submitted for Attorney General pre-clearance; response clock tolled.' + (note ? ' ' + note : ''), createdBy: req.user.sub });
    return res.json({ model: model, stage: 'ag_review', tolled: !!primary, agClockId: agId, agBand: band });
  }
  // Staff denial / internal review. In a state whose branch profile HAS the AG band this line is
  // unreachable — that is what "the band replaces staff denial" means.
  await require('../services/taskRouting').applyStageTransition(request.id, 'exemption_review', {
    actorId: req.user.sub, actorName: actor, action: 'EXEMPTION_ASSERTED',
    notes: 'Exemption asserted (internal review).' + (note ? ' ' + note : '') +
           (band.band === false ? ' This state has no Attorney-General referral band.' : ''), createdBy: req.user.sub });
  return res.json({ model: model, stage: 'exemption_review', tolled: false, agBand: band });
});

// THE TWIN OF assert-exemption, and it must land on the SAME row. A ruling closes the act the assertion
// opened, so if the assertion moved the child, a ruling that moved the parent would leave the child stranded
// in a legal stage forever with nothing able to rule on it.
router.post('/:id/ag-ruling', requireAuth, async function(req, res) {
  var resolvedAg = await scope.workRow(req.params.id);
  if (!resolvedAg.addressed) return res.status(404).json({ error: 'Request not found' });
  if (resolvedAg.ambiguous) {
    return res.status(409).json({
      error: 'This request has ' + resolvedAg.ambiguous.length + ' records. An AG ruling answers the assertion ' +
             'made about one described record — say which.',
      code: 'AMBIGUOUS_WORK_ROW',
      components: resolvedAg.ambiguous.map(function (c) {
        return { id: c.id, requestNumber: c.request_number, label: c.component_label, description: c.description, stage: c.stage };
      })
    });
  }
  var request = resolvedAg.row;
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
    // WS5: a granted waiver removes what was invoiced for this request from the requestor's A/R. Without
    // this the waived amount would keep counting as an unpaid prior balance and could trigger a deposit
    // demand on their NEXT request — for money the city has just decided it is not owed.
    try { await require('../services/requestorLedger').onWaiverGranted(request.id, 'fee waiver granted'); } catch (e) {}
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

  // PHASE 7 / WS4 — a denial does NOT get its own letter by default. DESIGN_fee_waiver_commercial.md
  // decides that "waiver reviewed and not granted + itemized estimate" is ONE communication: the denial
  // folds into the estimate notice (feeNotice.buildNotice), which is also what satisfies the thirteen
  // states' itemized-estimate duties. A separate letter arrives first, says nothing about the amount, and
  // leaves the requester waiting for a second message to learn what it costs. Cities that want the
  // separate letter set `denial_notice: 'separate_letter'`.
  //
  // Either way processing does not stop: the request goes to the ordinary estimate-acceptance gate, where
  // the requester chooses to proceed, narrow, or withdraw.
  var mail = { sent: false, reason: null };
  var amCfg = null;
  try { amCfg = await require('../services/approvalModules').config(null); } catch (e) {}
  var separate = !!(amCfg && amCfg.modules.fee_waiver.denial_notice === 'separate_letter');
  if (separate) {
    try { mail = await email.sendFeeWaiverDenial(request, reasonText); } catch (e) { console.error('[fee-waiver] denial email failed:', e.message); }
  } else {
    mail.reason = 'Folded into the estimate notice (denial_notice = fold_into_estimate).';
  }

  res.json({ decision: 'denied', reason: reasonText, emailed: !!mail.sent, emailReason: mail.reason || null,
    denialNotice: separate ? 'separate_letter' : 'fold_into_estimate', processingContinues: true });
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

