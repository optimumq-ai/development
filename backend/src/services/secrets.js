'use strict';
// On-premise key handling: customer-provided keys are stored in system_config and loaded into
// process.env so the existing 21 call sites (which read process.env) pick them up unchanged.
// Saved keys override the .env baseline. NOTE: stored plaintext for now - encrypt-at-rest is a
// pre-production hardening item (see backlog).
var db = require('../db');
var MAP = { anthropic_api_key: 'ANTHROPIC_API_KEY', voyage_api_key: 'VOYAGE_API_KEY' };

async function applySecrets() {
  try {
    var rows = await db.all("SELECT key, value FROM system_config WHERE key IN ('anthropic_api_key','voyage_api_key')");
    rows.forEach(function (r) { if (r.value && MAP[r.key]) process.env[MAP[r.key]] = r.value; });
  } catch (e) { console.error('[secrets] applySecrets:', e && e.message); }
}
module.exports = { applySecrets: applySecrets, MAP: MAP };
