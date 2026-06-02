const express = require('express');
const router = express.Router();
const { localLogin, signAccessToken, changePassword, getUserById, getAuthMode } = require('../services/auth');
const { requireAuth } = require('../middleware/auth');
const { get, run } = require('../db');

router.post('/login', function(req, res) {
  const email = req.body.email;
  const password = req.body.password;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (getAuthMode() !== 'local') return res.status(400).json({ error: 'This deployment uses SSO' });
  const result = localLogin(email, password);
  if (result.error) return res.status(result.code).json({ error: result.error });
  const accessToken = signAccessToken(result.user);
  // Re-fetch the full user (with roles) so the response shape matches /auth/me
  const fullUser = getUserById(result.user.id) || result.user;
  return res.json({ accessToken: accessToken, user: fullUser, requiresPasswordChange: result.requiresPasswordChange });
});

router.get('/me', requireAuth, function(req, res) {
  const user = getUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: user });
});

router.post('/password/change', requireAuth, async function(req, res) {
  const newPassword = req.body.newPassword;
  if (!newPassword || newPassword.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
  await changePassword(req.user.sub, newPassword);
  return res.json({ success: true });
});

router.post('/logout', function(req, res) {
  return res.json({ success: true });
});

router.get('/config', function(req, res) {
  const mode = get('SELECT value FROM system_config WHERE key = ?', ['auth_mode']);
  const mfa = get('SELECT value FROM system_config WHERE key = ?', ['mfa_mode']);
  const agency = get('SELECT value FROM system_config WHERE key = ?', ['agency_name']);
  return res.json({
    authMode: mode ? mode.value : 'local',
    mfaMode: mfa ? mfa.value : 'off',
    agencyName: agency ? agency.value : 'Optimum Q'
  });
});

module.exports = router;
