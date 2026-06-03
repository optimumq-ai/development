const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../db');
const JWT_SECRET = process.env.JWT_SECRET || 'optimumq-dev-secret';

function hashPwd(password) {
  return crypto.createHash('sha256').update(password + 'optimumq_salt_2024').digest('hex');
}
async function getFunctionRoles(userId) {
  return (await all('SELECT fr.name FROM user_function_roles ufr JOIN function_roles fr ON fr.id = ufr.function_role_id WHERE ufr.user_id = ?', [userId])).map(function(r) { return r.name; });
}
async function getPermissionRoles(userId) {
  return (await all('SELECT pr.name FROM user_permission_roles upr JOIN permission_roles pr ON pr.id = upr.permission_role_id WHERE upr.user_id = ?', [userId])).map(function(r) { return r.name; });
}
async function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.display_name, dept: user.department_id, roles: await getFunctionRoles(user.id), perms: await getPermissionRoles(user.id) }, JWT_SECRET, { expiresIn: '8h' });
}
function verifyAccessToken(token) { return jwt.verify(token, JWT_SECRET); }
async function localLogin(email, password) {
  var user = await get('SELECT * FROM users WHERE email = ? AND status != ?', [email, 'inactive']);
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
async function createUser(opts) {
  var userId = uuidv4();
  var passwordHash = opts.tempPassword ? hashPwd(opts.tempPassword) : null;
  await run('INSERT INTO users (id, email, display_name, title, department_id, password_hash, temp_password) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, opts.email, opts.displayName, opts.title || '', opts.departmentId || null, passwordHash, opts.tempPassword ? 1 : 0]);
  if (opts.functionRoles) for (var roleId of opts.functionRoles) {
    await run('INSERT OR IGNORE INTO user_function_roles (user_id, function_role_id) VALUES (?, ?)', [userId, roleId]);
  }
  if (opts.permissionRoles) for (var permId of opts.permissionRoles) {
    await run('INSERT OR IGNORE INTO user_permission_roles (user_id, permission_role_id) VALUES (?, ?)', [userId, permId]);
  }
  return userId;
}
function sanitizeUser(user) {
  return { id: user.id, email: user.email, display_name: user.display_name, title: user.title, department_id: user.department_id, status: user.status, last_login: user.last_login, temp_password: user.temp_password };
}
async function getUserById(userId) {
  var user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  return Object.assign(sanitizeUser(user), { functionRoles: await getFunctionRoles(userId), permissionRoles: await getPermissionRoles(userId) });
}
async function getAuthMode() {
  var c = await get('SELECT value FROM system_config WHERE key = ?', ['auth_mode']);
  return c ? c.value : 'local';
}
module.exports = { localLogin, signAccessToken, verifyAccessToken, hashPassword, changePassword, createUser, getUserById, getFunctionRoles, getPermissionRoles, getAuthMode, sanitizeUser };
