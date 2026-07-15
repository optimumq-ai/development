const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { all, get, run } = require('../db');
const timeCapture = require('../services/timeCaptureConfig');
const db = { get: get, run: run };

router.get('/', requireAuth, async function(req, res) {
  var rows = await all('SELECT key, value FROM system_config');
  var config = {};
  rows.forEach(function(r) { config[r.key] = r.value; });
  res.json(config);
});

router.post('/', requireAuth, requireRole('SYSTEM_ADMIN'), async function(req, res) {
  var allowed = ['agency_name','agency_short_name','jurisdiction_type','state','contact_email','contact_phone','auth_mode','mfa_mode','session_timeout','min_password_length','fee_threshold','deadline_simple','deadline_standard','deadline_complex','deadline_redaction','cost_per_page','labor_rate','overdue_alert_days','escalation_days','ack_email','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','new_request_alert_email','resend_api_key','resend_from'];
  var body = req.body;
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

router.put('/time-capture', requireAuth, requireRole('SYSTEM_ADMIN', 'DIRECTOR'), async function (req, res) {
  try {
    var next = await timeCapture.set(db, (req.body && req.body.config) || req.body || {});
    res.json({ config: next, uis: timeCapture.UIS, modes: timeCapture.MODES });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
