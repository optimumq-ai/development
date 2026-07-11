'use strict';
// Redaction automation — tunable config (SPEC_redaction_automation.md, slice 6).
//
// Stores the disposition thresholds + category sets (and a master on/off switch) in system_config, so a
// jurisdiction can retune the model — or disable the automation entirely and fall back to manual redaction —
// without a code change. Defaults come from redactionDisposition.DEFAULT_CONFIG (single source of truth).
// Global key (mirrors deadline_rules / clarification_policy).

var { get, run } = require('../db');
var disposition = require('./redactionDisposition');
var STORE_KEY = 'redaction_disposition_config';

function numOr(v, d) { var n = Number(v); return (typeof v !== 'undefined' && v !== null && isFinite(n)) ? n : d; }
function lowerList(v, d) {
  if (!Array.isArray(v)) return d.slice();
  return v.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim().toLowerCase(); });
}

// Full, normalized effective config = stored value merged over DEFAULT_CONFIG (+ the enabled switch).
function normalize(stored) {
  stored = stored || {};
  var d = disposition.DEFAULT_CONFIG;
  return {
    enabled: (typeof stored.enabled === 'boolean') ? stored.enabled : true, // automation ON by default
    elevatedSpanThreshold: numOr(stored.elevatedSpanThreshold, d.elevatedSpanThreshold),
    simpleSpanMax: numOr(stored.simpleSpanMax, d.simpleSpanMax),
    legalCategories: lowerList(stored.legalCategories, d.legalCategories),
    sensitiveCategories: lowerList(stored.sensitiveCategories, d.sensitiveCategories),
    restrictedAvailability: lowerList(stored.restrictedAvailability, d.restrictedAvailability)
  };
}

async function readStore() {
  var r = await get("SELECT value FROM system_config WHERE key = ?", [STORE_KEY]);
  if (!r || !r.value) return {};
  try { return JSON.parse(r.value) || {}; } catch (e) { return {}; }
}

async function read() { return normalize(await readStore()); }

// Convenience: is the automation on? (Missing/invalid config -> on, matching the default.)
async function enabled() { return (await read()).enabled !== false; }

// Throw on an invalid partial update (surfaced as HTTP 400 by the route).
function validate(partial) {
  partial = partial || {};
  if (partial.enabled != null && typeof partial.enabled !== 'boolean') throw new Error('enabled must be true or false');
  if (partial.elevatedSpanThreshold != null && !(isFinite(Number(partial.elevatedSpanThreshold)) && Number(partial.elevatedSpanThreshold) >= 1)) throw new Error('elevatedSpanThreshold must be a number >= 1');
  if (partial.simpleSpanMax != null && !(isFinite(Number(partial.simpleSpanMax)) && Number(partial.simpleSpanMax) >= 0)) throw new Error('simpleSpanMax must be a number >= 0');
  ['legalCategories', 'sensitiveCategories', 'restrictedAvailability'].forEach(function (k) {
    if (partial[k] != null && !Array.isArray(partial[k])) throw new Error(k + ' must be an array of strings');
  });
}

// Merge a partial update over the current stored value and persist the normalized result. Returns it.
async function write(partial) {
  validate(partial);
  var merged = normalize(Object.assign({}, await readStore(), partial || {}));
  await run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = datetime('now')",
    [STORE_KEY, JSON.stringify(merged)]);
  return merged;
}

// Back to defaults (removes the stored override).
async function reset() { await run("DELETE FROM system_config WHERE key = ?", [STORE_KEY]); return await read(); }

module.exports = { read: read, write: write, reset: reset, enabled: enabled, validate: validate, normalize: normalize, STORE_KEY: STORE_KEY };
