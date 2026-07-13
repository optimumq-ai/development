'use strict';
// Per-jurisdiction rule store — THE SLOT A RULE LIVES IN.
//
// Before this module, the two clock-relevant configs ('deadline_rules', 'clarification_policy') were
// GLOBAL singletons in system_config. There was nowhere to put a second state's rules:
// clarificationPolicy.read(jid) accepted a jurisdiction id and threw it away, and jurisdiction_profiles
// is seven columns of identity with no room for a rule. Every "per-state behaviour" story — unpaid
// deposit resets the clock in TX vs pauses it in WA, clarification restarts vs tolls — needs this table
// first. See docs/SPEC_parent_child_lifecycle.md §10.
//
// Domain names match the configExtractors adapter keys ('deadline', 'clarification', ...) so the AI
// statute-extraction, config-history and attestation plumbing all keep working unchanged.
//
// READ FALLBACK: if a jurisdiction has no row for a domain, we fall back to the legacy global
// system_config key. That keeps every existing install working while the rows are backfilled, and means
// a fresh jurisdiction inherits the current behaviour rather than silently losing its clock.
var { get, run } = require('../db');

// domain -> the legacy global system_config key it used to live in.
var LEGACY_KEYS = { deadline: 'deadline_rules', clarification: 'clarification_policy' };

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// The city's active jurisdiction. Single-jurisdiction today; the precedence stack (state -> city
// override) is not built — see SPEC_parent_child_lifecycle §10.2.
async function activeJid() {
  var r = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  return (r && r.value) || null;
}

// The effective rule config for (jurisdiction, domain), or null if neither the row nor the legacy key
// exists. Never throws — a missing config must degrade to the caller's defaults, not a 500.
async function read(jid, domain) {
  if (jid) {
    try {
      var row = await get('SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = ?', [jid, domain]);
      if (row && row.config_json) return JSON.parse(row.config_json);
    } catch (e) { /* fall through to the legacy key */ }
  }
  var key = LEGACY_KEYS[domain];
  if (key) {
    try {
      var sc = await get('SELECT value FROM system_config WHERE key = ?', [key]);
      if (sc && sc.value) return JSON.parse(sc.value);
    } catch (e) { /* fall through to null */ }
  }
  return null;
}

// Convenience for engines that have no jurisdiction in hand (the clock engine works off the active one).
async function readActive(domain) { return await read(await activeJid(), domain); }

// Persist a rule config. Returns the store target string for config_history.
async function write(jid, domain, cfg, actor) {
  if (!jid) throw new Error('No active jurisdiction — a rule cannot be saved without one.');
  if (!domain) throw new Error('A rule domain is required.');
  await run(
    'INSERT INTO jurisdiction_rules (id, jurisdiction_id, domain, config_json, updated_by, updated_at) VALUES (?,?,?,?,?,?) ' +
    'ON CONFLICT (jurisdiction_id, domain) DO UPDATE SET config_json = EXCLUDED.config_json, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at',
    ['jr-' + jid + '-' + domain, jid, domain, JSON.stringify(cfg || {}), actor || 'system', nowStr()]
  );
  return { target: 'jurisdiction_rules:' + jid + ':' + domain };
}

module.exports = { activeJid: activeJid, read: read, readActive: readActive, write: write, LEGACY_KEYS: LEGACY_KEYS };
