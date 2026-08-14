// Audit trail for request-less processing work (mass jobs, connector pulls). request_history is
// request-anchored (request_id NOT NULL); this is the parallel trail for work with no parent request.
// Insert-only. record() never throws: a failed audit write is logged loudly but must not abort the
// work it describes (same advisory posture as redactionAudit flags). details must be SHAPE FACTS
// ONLY — counts, ids, names — never document content.
const { run } = require('../db');
const { v4: uuidv4 } = require('uuid');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// actor: a req.user (id/sub + name), or { id, name }, or a plain string name ('Scheduled Batch').
async function record(entityType, entityId, action, actor, details) {
  try {
    var actorId = null, actorName = 'system';
    if (typeof actor === 'string') { actorName = actor; }
    else if (actor) { actorId = actor.id || actor.sub || null; actorName = actor.name || actor.display_name || String(actorId || 'system'); }
    await run(
      'INSERT INTO processing_history (id, entity_type, entity_id, action, actor_id, actor_name, details, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), entityType, entityId || null, action, actorId, actorName, details ? JSON.stringify(details) : null, nowStr()]);
  } catch (e) { console.error('[processingHistory] audit write failed:', e && e.message); }
}

module.exports = { record };
