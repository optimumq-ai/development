'use strict';
// requireRequestAct(opts) — the per-request ACT gate for routes/requests.js. Sits after requireAuth.
// Delegates the decision to services/requestAccess (acting role OR act permission OR the work is yours);
// this file only maps the answer to HTTP. A request that does not exist is passed THROUGH to the handler,
// which owns its own 404 wording (and, for stage-bearing acts, the parent/child ambiguity refusal).
//
//   opts.perms     permission roles that carry this act (e.g. ['CLARIFICATION_SENDER'])
//   opts.roles     extra acting roles beyond the standard set (e.g. ['ATTORNEY_REVIEWER'] for legal acts)
//   opts.taskTypes if given, only holders of an open task of THESE types count as "the work is theirs"
//   opts.label     plain words for the refusal ("send a clarification")
//   opts.param     the route param carrying the request id/number (default 'id')
var access = require('../services/requestAccess');

function requireRequestAct(opts) {
  opts = opts || {};
  var param = opts.param || 'id';
  return async function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    try {
      var d = await access.decide(req.user, req.params[param], opts);
      if (d.ok || !d.found) return next();
      return res.status(403).json({ error: d.error, code: 'NOT_YOUR_REQUEST' });
    } catch (e) {
      // Fail CLOSED on a broken lookup — a gate that lets everyone through when the DB hiccups is no gate.
      console.error('[requestAct] decision failed:', e && e.message);
      return res.status(500).json({ error: 'Could not verify your access to this request.' });
    }
  };
}

module.exports = { requireRequestAct: requireRequestAct };
