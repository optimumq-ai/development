const { verifyAccessToken, getAuthVersion } = require('../services/auth');

// TOKEN FRESHNESS (SPEC_user_type_model §7). Claims ride an 8h JWT; a user-type / subset / status change
// bumps users.auth_version, and a token whose `av` is behind it is rejected — one indexed read per request,
// cached briefly so the check is not a DB round trip on every call. A token minted before the model existed
// (no `av` at all) is rejected outright: its role claims came from the legacy tables.
const AV_TTL_MS = Number(process.env.AUTH_VERSION_CACHE_MS) || (process.env.NODE_ENV === 'test' ? 1000 : 60000);
const avCache = new Map();
async function currentAuthVersion(userId) {
  const hit = avCache.get(userId);
  const now = Date.now();
  if (hit && now - hit.at < AV_TTL_MS) return hit.av;
  const av = await getAuthVersion(userId);
  avCache.set(userId, { av: av, at: now });
  return av;
}
function forgetAuthVersion(userId) { avCache.delete(userId); }

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  let user;
  try { user = verifyAccessToken(header.slice(7)); }
  catch(e) { return res.status(401).json({ error: 'Invalid or expired token' }); }
  if (user.av == null) return res.status(401).json({ error: 'Session is out of date — sign in again' });
  let av;
  try { av = await currentAuthVersion(user.sub); }
  catch(e) { return res.status(500).json({ error: 'Authorization check failed' }); }
  if (av === null || Number(user.av) !== Number(av)) return res.status(401).json({ error: 'Session is out of date — sign in again' });
  req.user = user;
  // The JWT carries the user id as `sub` (JWT convention); routes have repeatedly written
  // `req.user.id` expecting it (found 2026-08-13: every req.user.id in mrr.js was undefined, so
  // manager-by-task-holder and assignee gates never matched and "My MRRs" was empty for its own
  // manager — masked in tests because oversight roles pass every gate). Alias it once, here.
  if (req.user.id == null) req.user.id = req.user.sub;
  next();
}
function requireRole() {
  const roles = Array.prototype.slice.call(arguments);
  return function(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const userRoles = req.user.roles || [];
    if (userRoles.indexOf('SYSTEM_ADMIN') !== -1) return next();
    const hasRole = roles.some(function(r) { return userRoles.indexOf(r) !== -1; });
    if (!hasRole) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}
// Authorize by EITHER a function (job) role OR a permission (capability) role. The financial-authority gate
// (fee-waiver decisions, fee-objection approvals) is a CAPABILITY — FINANCE, a permission role — not a job
// title, and it is the same role the fee_waiver task routes to, so whoever receives the task can act on it.
// SYSTEM_ADMIN always passes, mirroring requireRole. (D4 §8 role reconciliation; replaces the orphan
// FEE_WAIVER_APPROVER function-role gate that no one held.)
function requireRoleOrPerm(roles, perms) {
  roles = roles || []; perms = perms || [];
  return function(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const userRoles = req.user.roles || [];
    const userPerms = req.user.perms || [];
    if (userRoles.indexOf('SYSTEM_ADMIN') !== -1) return next();
    const ok = roles.some(function(r) { return userRoles.indexOf(r) !== -1; }) ||
               perms.some(function(p) { return userPerms.indexOf(p) !== -1; });
    if (!ok) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}
// THE redaction-work gate, shared by every processing-side route (mass jobs, workspace jobs/zones,
// templates apply, rules library, structured/AV apply, publish) so the bar can't drift between files:
// redaction permission-role holders plus the supervising function roles. REDACTION_AUTHORITY is
// accepted but not required — an orphan role nothing else consults yet. Reads stay requireAuth.
const requireRedactionWork = requireRoleOrPerm(['DIRECTOR', 'SUPERVISOR'], ['REDACTION_WORKER', 'REDACTION_AUTHORITY']);
// THE REQUEST-WORK gate — mutations on a request's files (upload, attach a found record, delete,
// mark responsive, render/extract). A work permission role (the searcher, the request manager, the
// redaction worker, delivery) or one of the function roles that ACT on requests by title (the same
// set requests.js `canRoute` uses; SYSTEM_ADMIN passes inside). Reads and compute-only search stay
// requireAuth. Previously requireAuth only — any logged-in account, including a reporting-only or
// finance-only one, could delete a record off someone else's request (and the blob from disk).
const requireRequestWork = requireRoleOrPerm(['DIRECTOR', 'SUPERVISOR', 'DEPT_MANAGER', 'COORDINATOR'],
  ['REQUEST_MANAGER', 'SEARCH_AND_TRIAGE', 'REDACTION_WORKER', 'DELIVERY_AND_CLOSURE']);
// THE TAXONOMY-EDIT gate — categories, record types, their department/routing/source links, and the
// discovery paths that INSERT drafts. "Workflow & Taxonomy" is the System Administrator's and the
// Director's permission group (DESIGN_user_type_role_model §4–5); the redactionConfig / repository
// EDIT precedent. Compute-only discovery (variant scan proposes, inserts nothing) and reads stay
// requireAuth. Previously requireAuth only.
const requireTaxonomyEdit = requireRole('SYSTEM_ADMIN', 'DIRECTOR');
// ---- v3 GATE PRIMITIVES (SPEC_user_type_model §7, S2) ---------------------------------------------------
// These read ONLY the user-type claims minted at login (authorities / permissionGroups). They never consult
// the legacy roles/perms, and there is deliberately NO SYSTEM_ADMIN short-circuit: oro_sysadmin holds exactly
// the authorities and groups the catalog gives it (§4 — in particular not legal_rules / legal_decision).
function hasAuthority(user, key) { return !!(user && Array.isArray(user.authorities) && user.authorities.indexOf(key) !== -1); }
function hasPermission(user, group) { return !!(user && Array.isArray(user.permissionGroups) && user.permissionGroups.indexOf(group) !== -1); }
function requireAuthority(key) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!hasAuthority(req.user, key)) return res.status(403).json({ error: 'This action needs the "' + key + '" authority, which none of your user types carries.', code: 'AUTHORITY_REQUIRED', authority: key });
    next();
  };
}
function requireAnyPermission() {
  const groups = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!groups.some(function (g) { return hasPermission(req.user, g); })) {
      return res.status(403).json({ error: 'Changing this configuration needs the "' + groups.join('" or "') + '" permission group, which none of your user types carries.', code: 'PERMISSION_REQUIRED', permission: groups });
    }
    next();
  };
}
function requirePermission(group) { return requireAnyPermission(group); }

module.exports = { requireAuth, requireRole, requireRoleOrPerm, requireRedactionWork, requireRequestWork, requireTaxonomyEdit, forgetAuthVersion,
  requireAuthority, requirePermission, requireAnyPermission, hasAuthority, hasPermission };
