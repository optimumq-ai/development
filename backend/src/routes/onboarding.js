const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all, get, run } = require('../db');
const email = require('../services/email');

async function cfg(key) { const r = await get("SELECT value FROM system_config WHERE key = ?", [key]); return r ? r.value : null; }

// Live readiness signals per phase, so the wizard shows real state rather than bare checkboxes.
async function signals() {
  const s = {};
  const safe = async (k, fn) => { try { s[k] = await fn(); } catch (e) { s[k] = null; } };
  await safe('jurisdiction', async () => {
    const jp = await get("SELECT name FROM jurisdiction_profiles WHERE id = (SELECT value FROM system_config WHERE key='jurisdiction_profile')");
    return jp ? ('Active profile: ' + jp.name + ' (sets deadlines, tolling, and exemption basis)') : 'No jurisdiction profile selected yet';
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
  await safe('fees', async () => {
    const fp = await get("SELECT count(*) AS n FROM fee_profiles");
    const ep = await get("SELECT count(DISTINCT record_type_id) AS n FROM record_type_estimate_profiles");
    const rt = await get("SELECT count(*) AS n FROM record_types WHERE status='active'");
    return (fp.n || 0) + ' fee profile' + (fp.n == 1 ? '' : 's') + '; ' + (ep.n || 0) + ' of ' + (rt.n || 0) + ' record types have estimate calibration';
  });
  await safe('redaction', async () => {
    const lp = await get("SELECT count(*) AS n FROM layout_profiles");
    return (lp.n || 0) + ' redaction layout profile' + (lp.n == 1 ? '' : 's') + ' defined';
  });
  return s;
}

function reviewEmailBody(agencyName, phaseTitle, reviewerName, link) {
  return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">' +
    '<div style="background:#1F4E79;color:white;padding:18px 22px;border-radius:10px 10px 0 0;font-size:18px;font-weight:700">' + agencyName + ' &mdash; Setup Review</div>' +
    '<div style="background:#F9FAFB;padding:24px 22px;border-radius:0 0 10px 10px;border:1px solid #E5E7EB;border-top:none">' +
      '<h2 style="margin:0 0 10px;color:#1F4E79;font-size:18px">Your review is needed: ' + phaseTitle + '</h2>' +
      '<p style="font-size:14px;line-height:1.55;color:#374151">Hi ' + (reviewerName || 'there') + ',</p>' +
      '<p style="font-size:14px;line-height:1.55;color:#374151">You have been designated to review the <strong>' + phaseTitle + '</strong> configuration for ' + agencyName + '. Please review the settings, make any edits needed, and approve them. Onboarding cannot proceed past this step until it is approved.</p>' +
      '<p style="text-align:center;margin:22px 0"><a href="' + link + '" style="display:inline-block;background:#1F4E79;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600">Review &amp; approve ' + phaseTitle + ' &rarr;</a></p>' +
      '<p style="font-size:12px;color:#6B7280">If the button does not work, paste this link into your browser:<br>' + link + '</p>' +
    '</div>' +
  '</div>';
}

// Progress + live signals + reviewer info
router.get('/', requireAuth, async function (req, res) {
  const phases = await all("SELECT p.*, u.display_name AS completed_by_name, r.display_name AS reviewer_name, r.email AS reviewer_email FROM onboarding_progress p LEFT JOIN users u ON u.id = p.completed_by LEFT JOIN users r ON r.id = p.reviewer_id ORDER BY p.phase_order");
  const sig = await signals();
  phases.forEach(function (p) { p.signal = sig[p.phase_key] || null; });
  const complete = phases.filter(function (p) { return p.status === 'complete'; }).length;
  const current = phases.find(function (p) { return p.status !== 'complete'; });
  res.json({ phases: phases, currentPhase: current ? current.phase_key : null, percentComplete: phases.length ? Math.round(100 * complete / phases.length) : 0 });
});

// Assign the designated reviewer for a phase
router.patch('/:phase/reviewer', requireAuth, async function (req, res) {
  const p = await get("SELECT phase_key FROM onboarding_progress WHERE phase_key = ?", [req.params.phase]);
  if (!p) return res.status(404).json({ error: 'Unknown phase' });
  const reviewerId = req.body.reviewerId || null;
  if (reviewerId) {
    const u = await get("SELECT id FROM users WHERE id = ?", [reviewerId]);
    if (!u) return res.status(400).json({ error: 'Unknown reviewer' });
  }
  await run("UPDATE onboarding_progress SET reviewer_id = ?, updated_at = datetime('now') WHERE phase_key = ?", [reviewerId, req.params.phase]);
  res.json({ success: true, phase: req.params.phase, reviewerId: reviewerId });
});

// Submit a gated phase for review -> email the designated reviewer a deep-link
router.post('/:phase/request-review', requireAuth, async function (req, res) {
  const p = await get("SELECT p.*, r.display_name AS reviewer_name, r.email AS reviewer_email FROM onboarding_progress p LEFT JOIN users r ON r.id = p.reviewer_id WHERE p.phase_key = ?", [req.params.phase]);
  if (!p) return res.status(404).json({ error: 'Unknown phase' });
  if (!p.requires_review) return res.status(400).json({ error: 'This phase does not require review' });
  if (!p.reviewer_id || !p.reviewer_email) return res.status(400).json({ error: 'Assign a reviewer with an email address first' });
  await run("UPDATE onboarding_progress SET status = 'review_requested', review_requested_at = datetime('now'), updated_at = datetime('now') WHERE phase_key = ?", [req.params.phase]);
  const agencyName = await cfg('agency_name') || 'Public Records';
  const appUrl = await cfg('app_url') || '';
  const link = appUrl + '/setup?phase=' + p.phase_key + '&review=1';
  const r = await email.send({
    to: p.reviewer_email,
    subject: agencyName + ' setup: please review "' + p.title + '"',
    text: 'You have been asked to review and approve the ' + p.title + ' configuration for ' + agencyName + '. Open the setup wizard to review, edit, and approve: ' + link,
    html: reviewEmailBody(agencyName, p.title, p.reviewer_name, link)
  });
  res.json({ success: true, phase: p.phase_key, emailed: !!(r && r.sent), emailResult: r });
});

// Approve a phase (designated reviewer or an administrator) -> mark complete
router.post('/:phase/approve', requireAuth, async function (req, res) {
  const p = await get("SELECT * FROM onboarding_progress WHERE phase_key = ?", [req.params.phase]);
  if (!p) return res.status(404).json({ error: 'Unknown phase' });
  const roles = req.user.roles || [];
  const isAdmin = ['SYSTEM_ADMIN', 'SUPERVISOR', 'DIRECTOR'].some(function (x) { return roles.indexOf(x) >= 0; });
  if (p.requires_review && p.reviewer_id && p.reviewer_id !== req.user.sub && !isAdmin) {
    return res.status(403).json({ error: 'Only the designated reviewer or an administrator can approve this phase' });
  }
  await run("UPDATE onboarding_progress SET status = 'complete', completed_by = ?, completed_at = datetime('now'), notes = ?, updated_at = datetime('now') WHERE phase_key = ?", [req.user.sub, req.body.notes || null, req.params.phase]);
  res.json({ success: true, phase: req.params.phase, status: 'complete' });
});

// Generic status change: non-gated completion, in_progress, or reset. Gated 'complete' must use /approve.
router.patch('/:phase', requireAuth, async function (req, res) {
  const status = req.body.status;
  if (['not_started', 'in_progress', 'complete'].indexOf(status) < 0) return res.status(400).json({ error: 'Invalid status' });
  const p = await get("SELECT requires_review FROM onboarding_progress WHERE phase_key = ?", [req.params.phase]);
  if (!p) return res.status(404).json({ error: 'Unknown phase' });
  if (status === 'complete' && p.requires_review) {
    return res.status(400).json({ error: 'This phase requires reviewer approval - use the approve action' });
  }
  if (status === 'complete') {
    await run("UPDATE onboarding_progress SET status = ?, completed_by = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE phase_key = ?", [status, req.user.sub, req.params.phase]);
  } else {
    await run("UPDATE onboarding_progress SET status = ?, completed_by = NULL, completed_at = NULL, review_requested_at = NULL, updated_at = datetime('now') WHERE phase_key = ?", [status, req.params.phase]);
  }
  res.json({ success: true, phase: req.params.phase, status: status });
});

module.exports = router;
