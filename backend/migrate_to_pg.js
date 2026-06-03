// One-time data copy: SQLite -> Postgres. Non-destructive (reads SQLite read-only).
const Database = require('better-sqlite3');
const { Client } = require('pg');

async function main() {
  const sdb = new Database('./data/optimumq.db', { readonly: true });
  const pg = new Client({
    host: 'localhost', port: 5544,
    user: process.env.POSTGRES_USER,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
  });
  await pg.connect();
  const tbls = sdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(function(r){return r.name;});
  const summary = [];
  let mismatch = 0;
  for (const t of tbls) {
    const rows = sdb.prepare('SELECT * FROM "'+t+'"').all();
    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const collist = cols.map(function(c){return '"'+c+'"';}).join(',');
      const ph = cols.map(function(_,i){return '$'+(i+1);}).join(',');
      const sql = 'INSERT INTO "'+t+'" ('+collist+') VALUES ('+ph+') ON CONFLICT DO NOTHING';
      for (const row of rows) { await pg.query(sql, cols.map(function(c){return row[c];})); }
    }
    const pgCount = (await pg.query('SELECT count(*)::int AS n FROM "'+t+'"')).rows[0].n;
    const ok = rows.length === pgCount;
    if (!ok) mismatch++;
    summary.push(t.padEnd(26)+'sqlite='+rows.length+'  pg='+pgCount+'  '+(ok?'OK':'*** MISMATCH'));
  }
  console.log(summary.join('\n'));
  console.log('\nTABLES: '+tbls.length+'   MISMATCHES: '+mismatch);
  await pg.end(); sdb.close();
  process.exit(mismatch ? 2 : 0);
}
main().catch(function(e){ console.error('ERROR:', e.message); process.exit(1); });
