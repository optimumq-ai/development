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
// (requireRole / requireRoleOrPerm — the legacy role gates — were DELETED in S5. Every gate is an authority,
// a permission group, or a request act. See SPEC_user_type_model §7.)
// THE redaction-work gate, shared by every processing-side route (mass jobs, workspace jobs/zones,
// templates apply, rules library, structured/AV apply, publish) so the bar can't drift between files:
// redaction permission-role holders plus the supervising function roles. REDACTION_AUTHORITY is
// accepted but not required — an orphan role nothing else consults yet. Reads stay requireAuth.
// S4: redaction competence = a user type whose task menu carries redaction work, or an acting authority.
const requireRedactionWork = function (req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (canRoute(req.user) || hasAuthority(req.user, 'legal_decision') || menuHas(req.user, ['redaction', 'redaction_qa', 'legal_redaction'])) return next();
  return res.status(403).json({ error: 'Redaction work needs a user type whose task menu includes redaction (fulfillment staff, legal), or an acting authority.', code: 'AUTHORITY_REQUIRED' });
};
// THE REQUEST-WORK gate — mutations on a request's files (upload, attach a found record, delete,
// mark responsive, render/extract). A work permission role (the searcher, the request manager, the
// redaction worker, delivery) or one of the function roles that ACT on requests by title (the same
// set requests.js `canRoute` uses; SYSTEM_ADMIN passes inside). Reads and compute-only search stay
// requireAuth. Previously requireAuth only — any logged-in account, including a reporting-only or
// finance-only one, could delete a record off someone else's request (and the blob from disk).
// S4: request work = anyone the router can hand work to (a non-empty task menu), or an acting authority.
const requireRequestWork = function (req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (canRoute(req.user) || req.user.taskMenu === '*' || (Array.isArray(req.user.taskMenu) && req.user.taskMenu.length > 0)) return next();
  return res.status(403).json({ error: 'Working a request\'s records needs a user type the router can hand work to, or an acting authority.', code: 'AUTHORITY_REQUIRED' });
};
// THE TAXONOMY-EDIT gate — categories, record types, their department/routing/source links, and the
// discovery paths that INSERT drafts. "Workflow & Taxonomy" is the System Administrator's and the
// Director's permission group (DESIGN_user_type_role_model §4–5); the redactionConfig / repository
// EDIT precedent. Compute-only discovery (variant scan proposes, inserts nothing) and reads stay
// requireAuth. Previously requireAuth only.
const requireTaxonomyEdit = function (req, res, next) { return requirePermission('operations_config')(req, res, next); };
// ---- v3 GATE PRIMITIVES (SPEC_user_type_model §7, S2) ---------------------------------------------------
// These read ONLY the user-type claims minted at login (authorities / permissionGroups). They never consult
// the legacy roles/perms, and there is deliberately NO SYSTEM_ADMIN short-circuit: oro_sysadmin holds exactly
// the authorities and groups the catalog gives it (§4 — in particular not legal_rules / legal_decision).
function hasAuthority(user, key) { return !!(user && Array.isArray(user.authorities) && user.authorities.indexOf(key) !== -1); }
function hasAnyAuthority(user, keys) { return (keys || []).some(function (k) { return hasAuthority(user, k); }); }
// "Elevated" — may SEE across teams (queue, dashboards, ops summary, rule libraries): any oversight, routing,
// legal or technical authority. Replaces the SUPERVISOR/DIRECTOR/SYSTEM_ADMIN/DEPT_MANAGER/ATTORNEY role lists.
const ELEVATED = ['act_any_request', 'reassign_any', 'reassign_team', 'override_stage', 'legal_decision', 'system'];
function isElevated(user) { return hasAnyAuthority(user, ELEVATED); }
// "May route" — may act on / re-route / assign work that is not theirs (the old canRoute / mayRoute / ACTING_ROLES set).
const ROUTING = ['act_any_request', 'reassign_any', 'reassign_team'];
function canRoute(user) { return hasAnyAuthority(user, ROUTING); }
// Task-menu competence from the token ('*' = any).
function menuHas(user, types) { if (!user) return false; if (user.taskMenu === '*') return true; var m = Array.isArray(user.taskMenu) ? user.taskMenu : []; return types.some(function (t) { return m.indexOf(t) !== -1; }); }
function requireAnyAuthority() {
  const keys = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!hasAnyAuthority(req.user, keys)) return res.status(403).json({ error: 'This action needs the "' + keys.join('" or "') + '" authority, which none of your user types carries.', code: 'AUTHORITY_REQUIRED', authority: keys });
    next();
  };
}
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

module.exports = { requireAuth, requireRedactionWork, requireRequestWork, requireTaxonomyEdit, forgetAuthVersion,
  requireAuthority, requireAnyAuthority, requirePermission, requireAnyPermission, hasAuthority, hasAnyAuthority, hasPermission, isElevated, canRoute, menuHas, ELEVATED, ROUTING };
