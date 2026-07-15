'use strict';
// TIME-CAPTURE VISIBILITY CONFIG (Slice E · Fork 1 resolved as a city-owned toggle).
//
// The per-task actual-labor timer (Slice D) ALWAYS runs its heartbeat — raw active time is always recorded in
// tasks.work_measured_seconds regardless of this config. What the city controls here is (a) whether the timer is
// VISIBLE on a task screen and (b) whether the completion flow FINALIZES a billable actual (tasks.work_seconds).
//
// We deliberately do NOT gate capture by jurisdiction statute: a 12-state review found the billability of staff
// labor (search vs. review/redaction vs. programming) too ambiguous and discretionary to encode as a table (no
// consistent "review" concept; several states allow legal-department labor only "in certain circumstances").
// So the decision is the city's, per task UI. This is the UPSTREAM twin of feeEngine's downstream laborGate:
// this decides whether time is even captured; laborGate still decides whether captured time is chargeable.
//
// Modes (per UI):
//   off        — timer hidden; Complete forwards straight through; no billable actual finalized.
//   discretion — timer shown; on Complete the log window appears WITH a Skip option (skip => no billable actual).
//   always     — timer shown; on Complete the log window appears (accept/adjust), a billable actual is finalized.

var KEY = 'time_capture_visibility';

// The task UIs a timer can live on. `available` = the work screen actually exists and is wired to honor the mode.
// MRR and Legal screens are not built yet — listed so the config model is complete/forward-compatible, but shown
// disabled in the panel until their screens land.
var UIS = [
  { key: 'search',          label: 'Record Search',    available: true },
  { key: 'estimate',        label: 'Estimate',         available: true },
  { key: 'legal_redaction', label: 'Legal Redaction',  available: true },
  { key: 'mrr',             label: 'Multi-Record (MRR)', available: false },
  { key: 'legal',           label: 'Legal',            available: false },
];
var MODES = ['off', 'discretion', 'always'];
var KEYS = UIS.map(function (u) { return u.key; });

function defaults() {
  var d = {};
  KEYS.forEach(function (k) { d[k] = 'off'; });   // fresh install: nothing appears until the city opts in
  return d;
}

// Coerce an arbitrary object into a valid config: known keys only, valid modes only, unknowns dropped, missing
// filled from defaults. Never throws — a corrupt stored blob degrades to all-off rather than breaking a screen.
function sanitize(obj) {
  var out = defaults();
  if (obj && typeof obj === 'object') {
    KEYS.forEach(function (k) {
      if (MODES.indexOf(obj[k]) !== -1) out[k] = obj[k];
    });
  }
  return out;
}

module.exports = {
  KEY: KEY, UIS: UIS, MODES: MODES, KEYS: KEYS, defaults: defaults, sanitize: sanitize,

  // Read the effective config (defaults merged under whatever is stored).
  get: async function (db) {
    var row = await db.get('SELECT value FROM system_config WHERE key = ?', [KEY]);
    var parsed = null;
    if (row && row.value) { try { parsed = JSON.parse(row.value); } catch (e) { parsed = null; } }
    return sanitize(parsed);
  },

  // Merge a partial update over the current config and persist the whole blob. Returns the new effective config.
  set: async function (db, partial) {
    var cur = await this.get(db);
    var next = sanitize(Object.assign({}, cur, partial || {}));
    await db.run(
      "INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [KEY, JSON.stringify(next)]
    );
    return next;
  },
};
