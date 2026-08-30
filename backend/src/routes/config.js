const express = require('express');
const router = express.Router();
const { requireAuth, requireAuthority, requirePermission, hasAuthority, hasPermission } = require('../middleware/auth');
const { all, get, run } = require('../db');
const timeCapture = require('../services/timeCaptureConfig');
const db = { get: get, run: run };

router.get('/', requireAuth, async function(req, res) {
  var rows = await all('SELECT key, value FROM system_config');
  var config = {};
  rows.forEach(function(r) { config[r.key] = r.value; });
  res.json(config);
});

// C11 (2026-08-30): the operational keys (notification timing, the requestor acknowledgement, the video
// redaction default) are owned by the operations_config group via their hub rows; everything else here is
// system-authority. av_redaction_mode was READ (routes/avRedaction.js) but never in this list — the v1
// Configuration tab's Save silently dropped it.
var OPERATIONAL = ['overdue_alert_days', 'escalation_days', 'ack_email', 'av_redaction_mode'];
router.post('/', requireAuth, async function(req, res) {
  var body = req.body || {};
  var keys = Object.keys(body);
  var onlyOperational = keys.length && keys.every(function (k) { return OPERATIONAL.indexOf(k) !== -1; });
  var onlyAck = keys.length === 1 && keys[0] === 'ack_email'; // an intake decision (Request rules) — the compliance lane may write it
  if (!(hasAuthority(req.user, 'system') || (onlyOperational && hasPermission(req.user, 'operations_config')) || (onlyAck && (hasPermission(req.user, 'compliance_policy') || hasPermission(req.user, 'legal_rules'))))) {
    return res.status(403).json({ error: onlyOperational ? 'Changing these settings needs the operations_config permission group.' : 'This action needs the "system" authority, which none of your user types carries.', code: onlyOperational ? 'PERMISSION_REQUIRED' : 'AUTHORITY_REQUIRED' });
  }
  var allowed = ['av_redaction_mode','agency_name','agency_short_name','jurisdiction_type','state','contact_email','contact_phone','auth_mode','mfa_mode','session_timeout','min_password_length','overdue_alert_days','escalation_days','ack_email','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','new_request_alert_email','resend_api_key','resend_from'];
  for (var key of allowed) {
    if (body[key] !== undefined) {
      var existing = await get('SELECT key FROM system_config WHERE key = ?', [key]);
      if (existing) {
        await run('UPDATE system_config SET value = ? WHERE key = ?', [String(body[key]), key]);
      } else {
        await run('INSERT INTO system_config (key, value) VALUES (?, ?)', [key, String(body[key])]);
      }
    }
  }
  // Approval model: the items whose settings live in system_config hear about a save (best effort, after the write).
  try {
    var HUBc = require('../services/setupHub'); var whoC = req.user && (req.user.name || req.user.email);
    if (['auth_mode', 'mfa_mode', 'session_timeout', 'min_password_length'].some(function (k) { return body[k] !== undefined; })) await HUBc.afterChange('auth_policy', whoC);
    if (body.new_request_alert_email !== undefined) await HUBc.afterChange('email', whoC);
    if (['overdue_alert_days', 'escalation_days'].some(function (k) { return body[k] !== undefined; })) await HUBc.afterChange('notifications', whoC);
    if (body.ack_email !== undefined) await HUBc.afterChange('intake', whoC);
    if (body.av_redaction_mode !== undefined) await HUBc.afterChange('av_redaction', whoC);
  } catch (eC) { /* notify is best-effort */ }
  res.json({ success: true });
});

// TIME-CAPTURE VISIBILITY (Slice E · Fork 1). City-owned, per task UI. See services/timeCaptureConfig.js.
// GET is readable by any authenticated user — task screens fetch it to decide whether to show the timer and how
// the Complete flow behaves. PUT is limited to admins/directors who own agency configuration.
router.get('/time-capture', requireAuth, async function (req, res) {
  try {
    res.json({ config: await timeCapture.get(db), uis: timeCapture.UIS, modes: timeCapture.MODES });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/time-capture', requireAuth, requirePermission('operations_config'), async function (req, res) {
  try {
    var next = await timeCapture.set(db, (req.body && req.body.config) || req.body || {});
    res.json({ config: next, uis: timeCapture.UIS, modes: timeCapture.MODES });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// TASK TIME BUDGETS (SPEC_operational_dashboard.md §2 slice 1, decided 2026-08-12). The measurement
// machinery has existed since Slice C; the editing surface was "Slice I, the budget brain", deferred and
// never built — so the eight values have only ever been a SQL seed. This is the manual forerunner:
// ONE value per task type (Kevin: simple, attention-catching; the per-record-type dimension stays in the
// schema for the future brain and is deliberately NOT exposed here).
//
// The editor EDITS values; it never adds or removes task types — the catalog-drift guard
// (verify_v1_retirement §E) keeps time_budgets aligned with the task catalogs, and an editor that could
// add rows would be a second, ungoverned catalog door.
router.get('/time-budgets', requireAuth, async function (req, res) {
  try {
    var rows = await all(
      'SELECT task_type, budget_days, source, updated_by, updated_at FROM time_budgets ' +
      'WHERE record_type_id IS NULL ORDER BY task_type');
    res.json({ budgets: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/time-budgets', requireAuth, requirePermission('operations_config'), async function (req, res) {
  try {
    var t = String((req.body && req.body.taskType) || '').trim();
    var d = Number(req.body && req.body.budgetDays);
    var row = await get('SELECT task_type FROM time_budgets WHERE record_type_id IS NULL AND task_type = ?', [t]);
    if (!row) {
      return res.status(404).json({ error: 'There is no budgeted task type called "' + t + '". The editor changes existing budgets; task types are managed by the task catalog.' });
    }
    if (!(d > 0) || d > 365 || !isFinite(d)) {
      return res.status(422).json({ error: 'A budget must be a number of days greater than 0 and at most 365. Fractions are fine (0.5 = half a day).' });
    }
    await run("UPDATE time_budgets SET budget_days = ?, source = 'supervisor', updated_by = ?, updated_at = datetime('now') WHERE record_type_id IS NULL AND task_type = ?",
      [d, (req.user && req.user.name) || req.user.sub, t]);
    var out = await get('SELECT task_type, budget_days, source, updated_by, updated_at FROM time_budgets WHERE record_type_id IS NULL AND task_type = ?', [t]);
    res.json({ ok: true, budget: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DASHBOARD PANES (SPEC_operational_dashboard.md §2 slice 3). Per-user layout — each user edits their
// OWN row, nothing else, so the only gate is authentication. When no row exists, ROLE DEFAULTS are
// computed here (one place), so a fresh user gets a sensible screen without configuring anything:
// team-scoped supervision → their team's panes · org-wide roles → the consolidated attention map ·
// everyone else → the generic KPI view. `scope` on a team pane is 'own' | 'all' (resolved to the
// viewer's department client-side; panes group by team, never name teams).
var PANE_LIBRARY = [
  { key: 'health', label: 'Workload health', scopable: true,
    description: 'One color per team and task type: green means nothing is over its time budget, amber means something is late but contained, red means work is badly stuck and someone should act today.' },
  { key: 'teamInProcess', label: 'Requests in Process', scopable: true,
    description: 'Stage counts for one team, or all teams.' },
  { key: 'taskNodes', label: 'Task Nodes — where the time is going', scopable: true,
    description: 'Per task node: in queue, in process, waiting on requestor, and how late against the task budget (1 day / 2 days / more than 2 days).' },
  { key: 'lateByTeam', label: 'Late by Team — attention map', scopable: false,
    description: 'Every fulfillment team with its late-task counts. Org-wide roles only.' },
  { key: 'finance', label: 'Finance', scopable: false,
    description: 'Outstanding balances, billed and unpaid, collected and waived to date.' },
  { key: 'statutory', label: 'Legal Clock', scopable: false,
    description: 'Requests past their statutory deadline — the legal clock, separate from task budgets.' },
  { key: 'generic', label: 'Overview', scopable: false,
    description: 'The simple agency-wide counts.' }
];
function defaultPanes(user, dept) {
  // S4: org-wide board for org-wide authority (reassign_any / system); team board for team authority.
  var orgWide = hasAuthority(user, 'reassign_any') || hasAuthority(user, 'system');
  var teamLead = hasAuthority(user, 'reassign_team');
  if (orgWide) return [{ key: 'health', scope: 'all' }, { key: 'lateByTeam' }, { key: 'finance' }, { key: 'taskNodes', scope: 'all' }, { key: 'statutory' }];
  if (teamLead && dept) return [{ key: 'health', scope: 'own' }, { key: 'teamInProcess', scope: 'own' }, { key: 'taskNodes', scope: 'own' }, { key: 'statutory' }];
  return [{ key: 'generic' }, { key: 'statutory' }];
}
router.get('/dashboard-panes', requireAuth, async function (req, res) {
  try {
    var row = await get('SELECT panes_json FROM user_dashboard_panes WHERE user_id = ?', [req.user.sub]);
    var panes = null;
    if (row) { try { panes = JSON.parse(row.panes_json); } catch (e) { panes = null; } }
    var defaulted = !Array.isArray(panes) || !panes.length;
    if (defaulted) panes = defaultPanes(req.user, req.user.dept);
    res.json({ panes: panes, defaultsApplied: defaulted, library: PANE_LIBRARY });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/dashboard-panes', requireAuth, async function (req, res) {
  try {
    var known = {}; PANE_LIBRARY.forEach(function (p) { known[p.key] = p; });
    var panes = (Array.isArray(req.body && req.body.panes) ? req.body.panes : [])
      .filter(function (p) { return p && known[p.key]; })
      .map(function (p) {
        var out = { key: p.key };
        if (known[p.key].scopable) out.scope = (p.scope === 'all') ? 'all' : 'own';
        return out;
      });
    if (!panes.length) return res.status(422).json({ error: 'Keep at least one pane — an empty dashboard tells you nothing.' });
    await run('INSERT INTO user_dashboard_panes (user_id, panes_json, updated_at) VALUES (?,?,datetime(\'now\')) ' +
      'ON CONFLICT (user_id) DO UPDATE SET panes_json = EXCLUDED.panes_json, updated_at = EXCLUDED.updated_at',
      [req.user.sub, JSON.stringify(panes)]);
    res.json({ panes: panes, defaultsApplied: false, library: PANE_LIBRARY });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
