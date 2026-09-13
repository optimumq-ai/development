const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../db');
const userTypes = require('./userTypes');
const JWT_SECRET = process.env.JWT_SECRET || 'optimumq-dev-secret';

function hashPwd(password) {
  return crypto.createHash('sha256').update(password + 'optimumq_salt_2024').digest('hex');
}
// v3 user-type model (SPEC_user_type_model §7): every claim is DERIVED from the person's user types. The legacy
// roles claim and the legacy tables are gone (S5); `perms` is the per-type act-permission list (§9.1 as built).
async function getAuthVersion(userId) {
  var r = await get('SELECT auth_version FROM users WHERE id = ?', [userId]);
  return r ? (r.auth_version || 1) : null;
}
async function signAccessToken(user) {
  var c = await userTypes.claimsFor(user.id);
  var av = await getAuthVersion(user.id);
  return jwt.sign({
    sub: user.id, email: user.email, name: user.display_name, dept: user.department_id,
    perms: c.perms,
    userTypes: c.userTypes, authorities: c.authorities, permissionGroups: c.permissionGroups, inOro: c.inOro, taskMenu: c.taskMenu,
    av: av,
  }, JWT_SECRET, { expiresIn: '8h' });
}
function verifyAccessToken(token) { return jwt.verify(token, JWT_SECRET); }
async function localLogin(email, password) {
  var user = await get('SELECT * FROM users WHERE email = ? AND status = ?', [email, 'active']);   // inactive AND removed accounts are refused alike
  if (!user) return { error: 'Invalid credentials', code: 401 };
  if (!user.password_hash) return { error: 'Account uses SSO', code: 400 };
  var valid = user.password_hash === hashPwd(password);
  if (!valid) return { error: 'Invalid credentials', code: 401 };
  try { await run("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]); } catch(e) {}
  return { user: sanitizeUser(user), requiresPasswordChange: user.temp_password === 1 };
}
function hashPassword(password) { return hashPwd(password); }
async function changePassword(userId, newPassword) {
  var hash = hashPwd(newPassword);
  await run('UPDATE users SET password_hash = ?, temp_password = 0 WHERE id = ?', [hash, userId]);
}
// Accounts are created with NO user types (§9: nothing is inferred; types are assigned by a manage_users
// holder afterwards). opts.userTypes = [{key, teamId}] is accepted for callers that already know them.
async function createUser(opts) {
  var userId = uuidv4();
  var passwordHash = opts.tempPassword ? hashPwd(opts.tempPassword) : null;
  await run('INSERT INTO users (id, email, display_name, title, department_id, password_hash, temp_password) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, opts.email, opts.displayName, opts.title || '', opts.departmentId || null, passwordHash, opts.tempPassword ? 1 : 0]);
  if (opts.userTypes) for (var t of opts.userTypes) {
    await userTypes.grant(userId, t.key, t.teamId || opts.departmentId || null, opts.actorId || null);
  }
  return userId;
}
function sanitizeUser(user) {
  return { id: user.id, email: user.email, display_name: user.display_name, title: user.title, department_id: user.department_id, status: user.status, last_login: user.last_login, temp_password: user.temp_password, ui_theme: user.ui_theme || 'standard' };
}
async function getUserById(userId) {
  var user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  var c = await userTypes.claimsFor(userId);
  return Object.assign(sanitizeUser(user), {
    permissionRoles: c.perms,
    userTypes: c.userTypes, authorities: c.authorities, permissionGroups: c.permissionGroups, inOro: c.inOro, taskMenu: c.taskMenu,
  });
}
async function getAuthMode() {
  var c = await get('SELECT value FROM system_config WHERE key = ?', ['auth_mode']);
  return c ? c.value : 'local';
}
module.exports = { localLogin, signAccessToken, verifyAccessToken, hashPassword, changePassword, createUser, getUserById, getAuthVersion, getAuthMode, sanitizeUser };
