const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all, get, run } = require('../db');

// Live readiness signals per phase, so the wizard shows real state rather than bare checkboxes.
async function signals() {
  const s = {};
  const safe = async (k, fn) => { try { s[k] = await fn(); } catch (e) { s[k] = null; } };
  await safe('jurisdiction', async () => {
    const jp = await get("SELECT name FROM jurisdiction_profiles WHERE id = (SELECT value FROM system_config WHERE key='jurisdiction_profile')");
    return jp ? ('Active profile: ' + jp.name) : 'No jurisdiction profile selected yet';
  });
  await safe('departments', async () => {
    const d = await get("SELECT count(*) AS n FROM departments WHERE kind='department' OR kind IS NULL");
    return (d.n || 0) + ' city department' + (d.n == 1 ? '' : 's') + ' defined';
  });
  await safe('teams', async () => {
    const t = await get("SELECT count(*) AS n FROM departments WHERE kind='team'");
    const tot = await get("SELECT count(*) AS n FROM departments WHERE kind='department' OR kind IS NULL");
    const served = await get("SELECT count(*) AS n FROM departments WHERE (kind='department' OR kind IS NULL) AND processed_by IS NOT NULL");
    return (t.n || 0) + ' team' + (t.n == 1 ? '' : 's') + '; ' + (served.n || 0) + ' of ' + (tot.n || 0) + ' departments have a serving team';
  });
  await safe('ownership', async () => {
    const o = await get("SELECT count(DISTINCT record_type_id) AS n FROM record_type_departments WHERE role='owner'");
    const rt = await get("SELECT count(*) AS n FROM record_types WHERE status='active'");
    return (o.n || 0) + ' of ' + (rt.n || 0) + ' active record types have an owning department';
  });
  await safe('repositories', async () => {
    const r = await get("SELECT count(*) AS n FROM record_repositories");
    const drafts = await get("SELECT count(*) AS n FROM record_types WHERE status='draft' AND source='discovered'");
    return (r.n || 0) + ' repositor' + (r.n == 1 ? 'y' : 'ies') + ' connected' + ((drafts.n || 0) > 0 ? ('; ' + drafts.n + ' discovered type(s) awaiting review') : '');
  });
  await safe('redaction', async () => {
    const lp = await get("SELECT count(*) AS n FROM layout_profiles");
    return (lp.n || 0) + ' redaction layout profile' + (lp.n == 1 ? '' : 's') + ' defined';
  });
  return s;
}

router.get('/', requireAuth, async function (req, res) {
  const phases = await all("SELECT p.*, u.display_name AS completed_by_name FROM onboarding_progress p LEFT JOIN users u ON u.id = p.completed_by ORDER BY p.phase_order");
  const sig = await signals();
  phases.forEach(function (p) { p.signal = sig[p.phase_key] || null; });
  const complete = phases.filter(function (p) { return p.status === 'complete'; }).length;
  const current = phases.find(function (p) { return p.status !== 'complete'; });
  res.json({
    phases: phases,
    currentPhase: current ? current.phase_key : null,
    percentComplete: phases.length ? Math.round(100 * complete / phases.length) : 0
  });
});

router.patch('/:phase', requireAuth, async function (req, res) {
  const phase = req.params.phase;
  const status = req.body.status;
  if (['not_started', 'in_progress', 'complete'].indexOf(status) < 0) return res.status(400).json({ error: 'Invalid status' });
  const row = await get("SELECT phase_key FROM onboarding_progress WHERE phase_key = ?", [phase]);
  if (!row) return res.status(404).json({ error: 'Unknown phase' });
  if (status === 'complete') {
    await run("UPDATE onboarding_progress SET status = ?, completed_by = ?, completed_at = datetime('now'), notes = ?, updated_at = datetime('now') WHERE phase_key = ?", [status, req.user.sub, req.body.notes || null, phase]);
  } else {
    await run("UPDATE onboarding_progress SET status = ?, completed_by = NULL, completed_at = NULL, updated_at = datetime('now') WHERE phase_key = ?", [status, phase]);
  }
  res.json({ success: true, phase: phase, status: status });
});

module.exports = router;
