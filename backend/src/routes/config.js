const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { all, get, run } = require('../db');

router.get('/', requireAuth, function(req, res) {
  var rows = all('SELECT key, value FROM system_config');
  var config = {};
  rows.forEach(function(r) { config[r.key] = r.value; });
  res.json(config);
});

router.post('/', requireAuth, requireRole('SYSTEM_ADMIN'), function(req, res) {
  var allowed = ['agency_name','agency_short_name','jurisdiction_type','state','contact_email','contact_phone','auth_mode','mfa_mode','session_timeout','min_password_length','fee_threshold','deadline_simple','deadline_standard','deadline_complex','deadline_redaction','cost_per_page','labor_rate','overdue_alert_days','escalation_days','ack_email','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','new_request_alert_email','resend_api_key','resend_from'];
  var body = req.body;
  allowed.forEach(function(key) {
    if (body[key] !== undefined) {
      var existing = get('SELECT key FROM system_config WHERE key = ?', [key]);
      if (existing) {
        run('UPDATE system_config SET value = ? WHERE key = ?', [String(body[key]), key]);
      } else {
        run('INSERT INTO system_config (key, value) VALUES (?, ?)', [key, String(body[key])]);
      }
    }
  });
  res.json({ success: true });
});

module.exports = router;
