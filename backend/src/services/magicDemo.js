'use strict';
// MAGIC DEMO — slice 1: benchmark + reset + the date-shifter (DESIGN_magic_screen.md).
//
// The model (Kevin's magicscreen.doc, refined 2026-08-14): a BENCHMARK is a full SQL snapshot of the
// demo database plus the moment it was taken. RESET rebuilds the database from schema + snapshot and
// shifts EVERY date forward by (now - taken_at), so relative ages hold forever — a request that was
// 9 days in process at benchmark time is 9 days in process after every reset, and "3 days until the
// deposit lapses" stays 3 days.
//
// THE SAFETY SHAPE — build beside, swap last:
//   1. the restored database is built as <db>_magicbuild while the app keeps running against <db>;
//   2. the date shift runs against the build, with nothing connected to it;
//   3. only when the build is complete and shifted do we terminate connections and SWAP names.
// A failure at any step before the swap leaves the live demo database untouched; the failed build is
// dropped. The swap itself is two renames (~ms); app pools reconnect on their next query.
// The pre-reset database survives one generation as <db>_prereset — the undo of last resort.
//
// Restore correctness rides the SAME pathway the test suite proves daily: schema.postgres.sql from
// empty (reset_test_db.js), then an armed-FK SQL load in topological order (gen_fixture_seed.js's
// idiom, generalized to ALL tables). The tasks triggers (trg_tasks_log/stamp) are disabled during
// the load — restored bookmark rows must not be doubled by the trigger re-writing them.
//
// SECRETS: unlike the git-committed fixture, the benchmark file stays in data/benchmarks/ on this
// server and NEVER enters git — password hashes ride along so every login still works after reset.
//
// The date-shifter is exported alone (shiftDates) because the magic clock (slice 2) is the same
// operation with a NEGATIVE delta: "a day passes" = the data ages one day.
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

var SCHEMA = path.join(__dirname, '..', 'db', 'schema.postgres.sql');
var BENCH_DIR = path.join(__dirname, '..', '..', 'data', 'benchmarks');

function dbUrl() { return process.env.DATABASE_URL; }
function dbName(url) { var m = /\/([^/?]+)(\?|$)/.exec(url); return m ? m[1] : null; }
function adminUrl(url) { return url.replace(/\/[^/?]+(\?|$)/, '/postgres$1'); }
function withDb(url, name) { return url.replace(/\/[^/?]+(\?|$)/, '/' + name + '$1'); }
function benchFile(name) { return path.join(BENCH_DIR, name + '.sql'); }
function metaFile(name) { return path.join(BENCH_DIR, name + '.meta.json'); }
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return "'" + v.toISOString() + "'";
  if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// Topological order of every public table by armed foreign keys (parents first). Self-references
// (departments.parent_id, record_types.parent_record_type_id) are not edges — those tables emit
// their rows parent-NULLS-first instead.
async function tableOrder(pool) {
  var tabs = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
    .map(function (r) { return r.tablename; });
  var fks = (await pool.query(
    "SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent " +
    "FROM pg_constraint c WHERE c.contype='f' AND connamespace='public'::regnamespace")).rows;
  var deps = {}; tabs.forEach(function (t) { deps[t] = new Set(); });
  var selfRef = {};
  fks.forEach(function (f) {
    if (f.child === f.parent) { selfRef[f.child] = true; return; }
    if (deps[f.child] && deps[f.parent] !== undefined) deps[f.child].add(f.parent);
  });
  var order = [], placed = {};
  var guard = tabs.length + 5;
  while (order.length < tabs.length && guard-- > 0) {
    tabs.forEach(function (t) {
      if (placed[t]) return;
      var ready = true;
      deps[t].forEach(function (p) { if (!placed[p]) ready = false; });
      if (ready) { order.push(t); placed[t] = true; }
    });
  }
  if (order.length < tabs.length) throw new Error('FK cycle among tables: ' + tabs.filter(function (t) { return !placed[t]; }).join(', '));
  return { order: order, selfRef: selfRef };
}

// Self-referencing parent column per table, for parent-NULLS-first row ordering.
var SELF_REF_COL = { departments: 'parent_id', record_types: 'parent_record_type_id' };

// Tables the schema file creates — the only tables a rebuilt database can hold. A benchmark of a
// database carrying OTHER tables would restore-fail at reset time (found live 2026-08-14: two
// poc_request spike leftovers), so the refusal happens HERE, at benchmark time, in words.
function schemaTables() {
  var sql = fs.readFileSync(SCHEMA, 'utf8');
  var out = {}, re = /CREATE TABLE IF NOT EXISTS\s+"?([a-z0-9_]+)"?/gi, m;
  while ((m = re.exec(sql))) out[m[1].toLowerCase()] = true;
  return out;
}

// A pool whose idle-client errors are logged, not fatal. The swap terminates every connection to the
// old database — including this module's own pools mid-`end()` — and node-pg raises 'error' on the pool;
// with no listener the whole process dies (the test harness did, 4× on 2026-08-30: "terminating connection
// due to administrator command"). src/db's shared pool already guards itself the same way.
function quietPool(cfg) {
  var p = new Pool(cfg);
  p.on('error', function (e) { console.error('[magic pool] idle client error (recovering):', e && e.message); });
  return p;
}

// ── BENCHMARK: dump every table of the CURRENT database to one replayable SQL file ──────────────
async function benchmark(opts) {
  opts = opts || {};
  var url = dbUrl(); var name = dbName(url);
  var pool = quietPool({ connectionString: url });
  try {
    var t = await tableOrder(pool);
    var known = schemaTables();
    var strays = t.order.filter(function (tb) { return !known[tb.toLowerCase()]; });
    if (strays.length) {
      var e = new Error('This database carries tables the schema cannot rebuild: ' + strays.join(', ') +
        '. A benchmark of them could never be restored — migrate them into schema.postgres.sql or drop them, then benchmark.');
      e.code = 'STRAY_TABLES'; e.status = 409; throw e;
    }
    var out = ['-- MAGIC BENCHMARK of ' + name + ' taken ' + new Date().toISOString(),
      '-- Full data snapshot (secrets included) — server-local file, NEVER committed to git.', ''];
    var rowsTotal = 0, counts = {};
    for (var i = 0; i < t.order.length; i++) {
      var table = t.order[i];
      var cols = (await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
        [table])).rows.map(function (c) { return c.column_name; });
      var orderBy = SELF_REF_COL[table]
        ? '"' + SELF_REF_COL[table] + '" NULLS FIRST, 1'
        : cols.map(function (_, ix) { return ix + 1; }).join(', ');
      var rows = (await pool.query('SELECT * FROM "' + table + '" ORDER BY ' + orderBy)).rows;
      counts[table] = rows.length; rowsTotal += rows.length;
      if (!rows.length) { out.push('-- ' + table + ': (empty)'); continue; }
      // One INSERT per 400 rows keeps statements parseable without loading everything at once.
      for (var off = 0; off < rows.length; off += 400) {
        var chunk = rows.slice(off, off + 400).map(function (row) {
          return '  (' + cols.map(function (c) { return lit(row[c]); }).join(', ') + ')';
        });
        out.push('INSERT INTO "' + table + '" (' + cols.map(function (c) { return '"' + c + '"'; }).join(', ') + ') VALUES\n' + chunk.join(',\n') + ';');
      }
    }
    fs.mkdirSync(BENCH_DIR, { recursive: true });
    fs.writeFileSync(benchFile(name), out.join('\n'));
    var meta = { db: name, taken_at: new Date().toISOString(), taken_by: opts.actorName || null,
      label: opts.label || null, tables: t.order.length, rows: rowsTotal, counts: counts };
    fs.writeFileSync(metaFile(name), JSON.stringify(meta, null, 2));
    return meta;
  } finally { await pool.end(); }
}

async function status() {
  var name = dbName(dbUrl());
  var offset = 0;
  try { offset = await clockOffset(); } catch (e) {}
  var out = { db: name, benchmark: null,
    clockOffsetSeconds: offset,
    syntheticNow: new Date(Date.now() + offset * 1000).toISOString() };
  if (!fs.existsSync(metaFile(name))) return out;
  try { out.benchmark = JSON.parse(fs.readFileSync(metaFile(name), 'utf8')); }
  catch (e) { out.error = 'benchmark meta unreadable'; }
  return out;
}

// ── THE DATE-SHIFTER (shared with the magic clock, slice 2) ─────────────────────────────────────
// Shifts every date the schema stores, by seconds (positive = forward). Two populations:
//   1. typed date/timestamp columns — shifted natively;
//   2. TEXT columns whose NAME says date ( *_at, *_date, *_day, at, day ) — shifted with the stored
//      FORMAT preserved (19-char 'YYYY-MM-DD HH24:MI:SS' stays 19-char; 10-char dates stay dates),
//      value-guarded by regex so non-date content in a date-named column is left alone.
// KNOWN LIMITS (recorded in the design doc): dates inside prose (history notes) and inside JSON
// blobs (config confirmed_at, estimate input snapshots) do not shift. Relative displays — days left,
// days in process — all derive from the shifted columns and stay correct.
var TEXT_DATE_NAME_RE = /(_at|_date|_day|_deadline)$|^(at|day|date)$/;
async function shiftDates(pool, seconds) {
  if (!seconds) return { shifted: 0, columns: 0 };
  var cols = (await pool.query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns c " +
    "WHERE table_schema='public' AND EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname='public' AND t.tablename=c.table_name)")).rows;
  var touched = 0, colCount = 0;
  for (var i = 0; i < cols.length; i++) {
    var c = cols[i], sql = null;
    if (/^(timestamp|date)/.test(c.data_type)) {
      sql = 'UPDATE "' + c.table_name + '" SET "' + c.column_name + '" = "' + c.column_name + '" + interval \'' + seconds + ' seconds\' WHERE "' + c.column_name + '" IS NOT NULL';
    } else if ((c.data_type === 'text' || c.data_type === 'character varying') && TEXT_DATE_NAME_RE.test(c.column_name)) {
      // Parse via replace(T,' ') so ISO-T and space-separated forms read with ONE format; re-emit
      // with the ORIGINAL separator (to_char's quoted "T" is output-side, where it is safe) and
      // keep any tail beyond the seconds (millis/zone) verbatim.
      var q = '"' + c.column_name + '"';
      sql = 'UPDATE "' + c.table_name + '" SET ' + q + ' = CASE ' +
        "WHEN " + q + " ~ '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}' " +
        "THEN to_char(to_timestamp(replace(substring(" + q + " from 1 for 19), 'T', ' '), 'YYYY-MM-DD HH24:MI:SS') + interval '" + seconds + " seconds', " +
        "CASE WHEN substring(" + q + " from 11 for 1) = 'T' THEN 'YYYY-MM-DD\"T\"HH24:MI:SS' ELSE 'YYYY-MM-DD HH24:MI:SS' END) " +
        "|| substring(" + q + " from 20) " +
        "WHEN " + q + " ~ '^\\d{4}-\\d{2}-\\d{2}$' " +
        "THEN to_char(to_date(" + q + ", 'YYYY-MM-DD') + interval '" + seconds + " seconds', 'YYYY-MM-DD') " +
        'ELSE ' + q + ' END ' +
        'WHERE ' + q + ' IS NOT NULL';
    }
    if (!sql) continue;
    var r = await pool.query(sql);
    if (r.rowCount) { touched += r.rowCount; colCount++; }
  }
  return { shifted: touched, columns: colCount };
}

// ── RESET: rebuild from schema + benchmark beside the live db, shift, swap ──────────────────────
async function reset(opts) {
  opts = opts || {};
  var url = dbUrl(); var name = dbName(url);
  if (!fs.existsSync(benchFile(name)) || !fs.existsSync(metaFile(name))) {
    var e = new Error('No benchmark exists for ' + name + ' — take one first.'); e.code = 'NO_BENCHMARK'; e.status = 409; throw e;
  }
  var meta = JSON.parse(fs.readFileSync(metaFile(name), 'utf8'));
  var deltaSeconds = (opts.deltaSeconds != null)
    ? Math.round(opts.deltaSeconds)
    : Math.max(0, Math.round((Date.now() - new Date(meta.taken_at).getTime()) / 1000));

  var buildName = name + '_magicbuild';
  var admin = quietPool({ connectionString: adminUrl(url) });
  var build = null;
  try {
    // 1. Fresh build database.
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [buildName]);
    await admin.query('DROP DATABASE IF EXISTS ' + buildName);
    await admin.query('CREATE DATABASE ' + buildName);
    build = quietPool({ connectionString: withDb(url, buildName) });

    // 2. Schema from empty — the same file the app boots from, FKs and guards armed.
    await build.query(fs.readFileSync(SCHEMA, 'utf8'));
    // The schema self-seeds a few tables; the benchmark carries those rows. Clear everything so the
    // snapshot is the single source of truth (reset_test_db.js's exact pattern).
    var allTables = (await build.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    for (var i = 0; i < allTables.length; i++) {
      await build.query('TRUNCATE TABLE "' + allTables[i].tablename + '" CASCADE');
    }

    // 3. The snapshot, with the tasks bookkeeping triggers held off (restored task_events rows must
    //    not be doubled by the trigger observing the restore's own inserts).
    await build.query('ALTER TABLE tasks DISABLE TRIGGER USER');
    await build.query(fs.readFileSync(benchFile(name), 'utf8'));
    await build.query('ALTER TABLE tasks ENABLE TRIGGER USER');

    // 4. Sequences behind serial ids continue after the restored max.
    var seqs = (await build.query(
      "SELECT pg_get_serial_sequence(quote_ident(table_name), column_name) AS seq, table_name, column_name " +
      "FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval%'")).rows;
    for (var s = 0; s < seqs.length; s++) {
      if (!seqs[s].seq) continue;
      await build.query("SELECT setval('" + seqs[s].seq + "', COALESCE((SELECT MAX(\"" + seqs[s].column_name + "\") FROM \"" + seqs[s].table_name + "\"), 0) + 1, false)");
    }

    // 4b. The magic clock zeroes on reset (design rule): whatever offset the snapshot carried, the
    //     restored world is back in sync with real time — absent key = zero.
    await build.query("DELETE FROM system_config WHERE key = 'magic_clock_offset'");

    // 5. The shift — against the build, nothing else connected. Fails here → live untouched.
    var shift = await shiftDates(build, deltaSeconds);
    await build.end(); build = null;

    // 6. The swap. Two renames; the app's pools reconnect on their next query.
    var preswap = name + '_prereset';
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ($1,$2,$3) AND pid <> pg_backend_pid()", [name, buildName, preswap]);
    await admin.query('DROP DATABASE IF EXISTS ' + preswap);
    await admin.query('ALTER DATABASE ' + name + ' RENAME TO ' + preswap);
    try {
      await admin.query('ALTER DATABASE ' + buildName + ' RENAME TO ' + name);
    } catch (e2) {
      // Undo the first rename so the app is never left with NO database under its name.
      await admin.query('ALTER DATABASE ' + preswap + ' RENAME TO ' + name);
      throw e2;
    }
    // A client that reconnected in the terminate→rename gap is now attached to the RENAMED old
    // database and would keep reading the pre-reset world (found 2026-08-14: a baseline read
    // returned a value only the old world held). Sweep the preswap connections once more — those
    // clients die and redial <name>, which is now the restored database.
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [preswap]);
    return { db: name, deltaSeconds: deltaSeconds, shift: shift, benchmark: meta, undo: preswap };
  } finally {
    if (build) { try { await build.end(); } catch (e) {} }
    await admin.end();
  }
}

// ── THE MAGIC CLOCK (slice 2): "a day passes" = the data ages a day ─────────────────────────────
// The inversion the design is built on: system time never moves; every date shifts BACK by the
// advance, then the scheduled workers run IMMEDIATELY so consequences (overdue flags, clarification
// timeouts, nonpayment dunning/closure, nightly batches, scheduled config promotions) land while
// the audience watches instead of on the next interval tick. The accumulated advance lives in
// system_config `magic_clock_offset` (seconds); the synthetic date = real now + offset. Reset is
// the clock's undo — it restores the benchmark and zeroes the offset — so advancing REQUIRES a
// benchmark to exist: aging the world with no way back is not a demo, it is data loss.
async function clockAdvance(opts) {
  opts = opts || {};
  var seconds = Math.round(Number(opts.seconds) || 0);
  if (!(seconds >= 60 && seconds <= 90 * 86400)) {
    var eR = new Error('Advance between one minute and 90 days at a time.'); eR.code = 'BAD_ADVANCE'; eR.status = 422; throw eR;
  }
  var name = dbName(dbUrl());
  if (!fs.existsSync(metaFile(name))) {
    var eB = new Error('The clock’s undo is Reset — take a benchmark before advancing time.');
    eB.code = 'NO_BENCHMARK'; eB.status = 409; throw eB;
  }
  var db = require('../db');
  var pool = db.getDb();
  var shift = await shiftDates(pool, -seconds);
  await db.run(
    "INSERT INTO system_config (key, value) VALUES ('magic_clock_offset', ?) " +
    "ON CONFLICT (key) DO UPDATE SET value = ((COALESCE(NULLIF(system_config.value,''),'0'))::bigint + EXCLUDED.value::bigint)::text",
    [String(seconds)]);
  // Poke every date-driven worker, each isolated — one failing sweep must not hide the others.
  var workers = {};
  try { workers.tickler = (await require('./tickler').runSweep({ trigger: 'magic_clock' })).actions; }
  catch (e) { workers.tickler = { error: e.message }; }
  try { workers.massJobs = await require('./massJobs').tick({}); }
  catch (e) { workers.massJobs = { error: e.message }; }
  try { workers.configPromotions = await require('./effectiveConfig').promoteDue({ trigger: 'magic_clock' }); }
  catch (e) { workers.configPromotions = { error: e.message }; }
  try { await require('./taskRouting').reconcileStageTasks(); workers.stageTasks = 'reconciled'; }
  catch (e) { workers.stageTasks = { error: e.message }; }
  return { advancedSeconds: seconds, offsetSeconds: await clockOffset(), shift: shift, workers: workers };
}

async function clockOffset() {
  var db = require('../db');
  var row = await db.get("SELECT value FROM system_config WHERE key = 'magic_clock_offset'");
  var n = row ? parseInt(row.value, 10) : 0;
  return isFinite(n) ? n : 0;
}

module.exports = { benchmark: benchmark, reset: reset, status: status, shiftDates: shiftDates,
  clockAdvance: clockAdvance, clockOffset: clockOffset,
  _internals: { tableOrder: tableOrder, dbName: dbName } };
