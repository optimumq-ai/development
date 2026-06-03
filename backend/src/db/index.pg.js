const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

// COUNT(*) / bigint (int8, oid 20) -> JS number, matching old driver behavior
types.setTypeParser(20, function (v) { return v === null ? null : parseInt(v, 10); });

const SCHEMA_PATH = path.join(__dirname, 'schema.postgres.sql');
let pool = null;

function connString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const u = process.env.POSTGRES_USER || 'optimumq';
  const p = process.env.POSTGRES_PASSWORD || '';
  const d = process.env.POSTGRES_DB || 'optimumq';
  const h = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT || '5432';
  return 'postgresql://' + u + ':' + p + '@' + h + ':' + port + '/' + d;
}
async function initDb() {
  pool = new Pool({ connectionString: connString() });
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await pool.query(schema);
  console.log('Database initialized (Postgres)');
  return pool;
}
function getDb() { if (!pool) throw new Error('DB not initialized'); return pool; }

function toPg(sql) {
  let out = sql;
  out = out.replace(/datetime\(\s*'now'\s*\)/gi, "to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')");
  out = out.replace(/date\(\s*'now'\s*\)/gi, "to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')");
  let onConflict = false;
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
    onConflict = true;
  }
  let n = 0;
  out = out.replace(/\?/g, function () { n += 1; return '$' + n; });
  if (onConflict) { out = out.replace(/;\s*$/, '') + ' ON CONFLICT DO NOTHING'; }
  return out;
}
function normP(params) {
  if (params === undefined || params === null) return [];
  return Array.isArray(params) ? params : [params];
}
async function all(sql, params) {
  const r = await getDb().query(toPg(sql), normP(params));
  return r.rows;
}
async function get(sql, params) {
  const r = await getDb().query(toPg(sql), normP(params));
  return r.rows[0] || null;
}
async function run(sql, params) {
  const r = await getDb().query(toPg(sql), normP(params));
  return { changes: r.rowCount, rows: r.rows };
}
async function transaction(fn) {
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
function persist() {}
module.exports = { initDb, getDb, all, get, run, transaction, persist };
