const { verifyAccessToken } = require('../services/auth');
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = verifyAccessToken(header.slice(7)); next(); }
  catch(e) { return res.status(401).json({ error: 'Invalid or expired token' }); }
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
module.exports = { requireAuth, requireRole };
