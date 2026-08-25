'use strict';
// Snapshot / wipe / restore the jurisdiction-and-rules CONFIGURATION so setup can be walked from zero.
//
//   node scripts/config_reset.js backup   [--tag=YYYYMMDD]   copy every affected table into schema backup_<tag>
//                                                           and write ~/exchange/config_backup_<tag>.json
//   node scripts/config_reset.js wipe     --tag=<tag>        DELETE the config rows (refuses unless backup_<tag> exists)
//   node scripts/config_reset.js restore  --tag=<tag>        put every table back exactly as snapshotted
//   node scripts/config_reset.js status                      row counts of the affected tables
//   node scripts/config_reset.js activate --jid=jur-tx       make an imported state the city's active jurisdiction
//
// Touches CONFIG only. Requests, tasks, users, departments, record types are never read or written.
// Prints query results only — never the connection string.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
var fs = require('fs');
var os = require('os');
var path = require('path');
var { Pool } = require('pg');

// Whole tables that are snapshotted and emptied.
var TABLES = [
  'setup_hub_signoffs',           // "Mark it done" — forces a hub row to ready regardless of evidence
  'jurisdiction_profile_sections',// attestation index (self-heals to not_configured on next read)
  'jurisdiction_rules',           // the rule store (one JSON blob per jurisdiction × domain)
  'config_proposals', 'config_history', 'config_sources', 'config_source_snapshots',
  'config_freshness_runs', 'scheduled_config_changes',
  'jurisdiction_profiles',        // state identity rows (jur-tx …)
  'fee_profiles',                 // the city's rate table read by feeEngine
  'record_type_estimate_profiles',// estimate calibration per record type
  'redaction_rules', 'rule_legal_sources', 'legal_sources', 'redaction_categories',
  'layout_profiles',              // redaction layout templates
  'onboarding_progress'           // old wizard + fee-test result; schema re-seeds it clean on the next API boot
];
// system_config is snapshotted WHOLE but only these keys are removed. deadline_rules / clarification_policy
// must go or schema.postgres.sql backfills jurisdiction_rules from them on the next boot.
var SYSTEM_CONFIG_KEYS = ['jurisdiction_profile', 'deadline_rules', 'clarification_policy', 'redaction_disposition_config'];

var args = process.argv.slice(2);
var mode = args[0];
var tagArg = args.filter(function (a) { return a.indexOf('--tag=') === 0; })[0];
var tag = tagArg ? tagArg.split('=')[1] : null;
var schema = tag ? 'backup_' + tag : null;
if (schema && !/^backup_[a-z0-9_]+$/.test(schema)) { console.error('bad tag'); process.exit(2); }

var pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function q(sql, params) { return (await pool.query(sql, params)).rows; }
async function exists(table, sch) {
  var r = await q('SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2', [sch || 'public', table]);
  return r.length > 0;
}
async function counts(sch) {
  var out = {};
  for (var t of TABLES.concat(['system_config'])) {
    out[t] = (await exists(t, sch)) ? Number((await q('SELECT COUNT(*) n FROM ' + (sch || 'public') + '.' + t))[0].n) : null;
  }
  return out;
}
function show(label, c) {
  console.log(label);
  Object.keys(c).forEach(function (t) { console.log('  ' + t.padEnd(32) + (c[t] === null ? '(no table)' : c[t])); });
}

async function backup() {
  if (!schema) { console.error('--tag required'); process.exit(2); }
  if ((await q('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [schema])).length) {
    console.error(schema + ' already exists — refusing to overwrite a backup'); process.exit(2);
  }
  await q('CREATE SCHEMA ' + schema);
  var json = { tag: tag, taken_at: new Date().toISOString(), tables: {} };
  for (var t of TABLES.concat(['system_config'])) {
    if (!(await exists(t))) { console.log('  skip ' + t + ' (no such table)'); continue; }
    await q('CREATE TABLE ' + schema + '.' + t + ' AS SELECT * FROM public.' + t);
    json.tables[t] = await q('SELECT * FROM public.' + t);
  }
  // The JSON copy is for reading, not restore (restore uses the schema): keep secrets out of it.
  json.tables.system_config = (json.tables.system_config || []).map(function (r) {
    return /key|secret|password|token/i.test(r.key) ? Object.assign({}, r, { value: '[redacted]' }) : r;
  });
  var file = path.join(os.homedir(), 'exchange', 'config_backup_' + tag + '.json');
  fs.writeFileSync(file, JSON.stringify(json, null, 1));
  show('snapshot ' + schema + ':', await counts(schema));
  console.log('json: ' + file);
}

async function wipe() {
  if (!schema) { console.error('--tag required'); process.exit(2); }
  var live = await counts();
  var snap = await counts(schema);
  for (var t of TABLES.concat(['system_config'])) {
    if (live[t] !== null && snap[t] !== live[t]) {
      console.error('refusing: ' + t + ' live=' + live[t] + ' snapshot=' + snap[t] + ' — take a fresh backup first');
      process.exit(2);
    }
  }
  await q('BEGIN');
  try {
    for (var t2 of TABLES) if (live[t2] !== null) await q('DELETE FROM public.' + t2);
    var removed = await q('DELETE FROM public.system_config WHERE key = ANY($1) RETURNING key', [SYSTEM_CONFIG_KEYS]);
    await q('COMMIT');
    console.log('system_config keys removed: ' + removed.map(function (r) { return r.key; }).join(' '));
  } catch (e) { await q('ROLLBACK'); throw e; }
  show('after wipe:', await counts());
}

async function restore() {
  if (!schema) { console.error('--tag required'); process.exit(2); }
  await q('BEGIN');
  try {
    for (var t of TABLES.concat(['system_config'])) {
      if (!(await exists(t, schema))) continue;
      await q('DELETE FROM public.' + t);
      await q('INSERT INTO public.' + t + ' SELECT * FROM ' + schema + '.' + t);
    }
    await q('COMMIT');
  } catch (e) { await q('ROLLBACK'); throw e; }
  show('after restore:', await counts());
}

// The importer files a state as status=library and nothing in the UI switches the city over — the seed did
// that by hand. This is that hand step: node scripts/config_reset.js activate --jid=jur-tx
async function activate() {
  var jidArg = args.filter(function (a) { return a.indexOf('--jid=') === 0; })[0];
  var jid = jidArg ? jidArg.split('=')[1] : null;
  if (!jid) { console.error('--jid required (e.g. --jid=jur-tx; run the importer first)'); process.exit(2); }
  var row = await q('SELECT id, code, status FROM jurisdiction_profiles WHERE id=$1', [jid]);
  if (!row.length) { console.error('no jurisdiction_profiles row ' + jid + ' — import the state first'); process.exit(2); }
  await q("UPDATE jurisdiction_profiles SET status='active' WHERE id=$1", [jid]);
  await q("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [jid]);
  console.log('active jurisdiction: ' + jid + ' (' + row[0].code + ') — was status=' + row[0].status);
}

(async function () {
  try {
    if (mode === 'backup') await backup();
    else if (mode === 'activate') await activate();
    else if (mode === 'wipe') await wipe();
    else if (mode === 'restore') await restore();
    else if (mode === 'status') show('live:', await counts());
    else { console.error('usage: backup|wipe|restore|status [--tag=]'); process.exit(2); }
  } catch (e) { console.error('ERROR ' + e.message); process.exit(1); }
  finally { await pool.end(); }
})();
