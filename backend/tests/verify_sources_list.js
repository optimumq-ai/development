'use strict';
// SOURCES REDESIGN (#15, approved by Kevin 2026-08-13) — the list endpoint's new card data.
//
// The redesigned screen says what each source HOLDS (linked record types by name) and how big a
// paper location's index is. Both ride the one GET /repositories read as grouped queries. This
// harness locks that contract; the grouping/wording itself is presentation, verified by screenshot.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'SL' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function api(method, path, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async function () {
  await db.initDb();
  TOKEN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));

  console.log('\n=== A. THE LIST CARRIES WHAT EACH SOURCE HOLDS ===');
  var list = await api('GET', '/repositories');
  ok('A1 every source row carries linked_types and paper_index_count',
    list.status === 200 && (list.body.repositories || []).length > 0 &&
    list.body.repositories.every(function (r) { return Array.isArray(r.linked_types) && typeof r.paper_index_count === 'number'; }));
  var laser = list.body.repositories.filter(function (r) { return r.connector_type === 'laserfiche'; })[0];
  ok('A2 a linked source lists its record types BY NAME (' + (laser ? laser.linked_types.length : 0) + ' on Laserfiche)',
    laser && laser.linked_types.length > 0 && typeof laser.linked_types[0] === 'string');

  console.log('\n=== B. PAPER INDEX SIZES ARE REAL COUNTS ===');
  var paperRepo = list.body.repositories.filter(function (r) { return r.connector_type === 'paper-index'; })[0];
  if (paperRepo) {
    var direct = await db.get('SELECT COUNT(*)::int AS n FROM paper_index_items WHERE repository_id = ?', [paperRepo.id]);
    ok('B1 the list count equals the table count for ' + paperRepo.name,
      Number(paperRepo.paper_index_count) === Number(direct.n));
  } else {
    var mk = await api('POST', '/repositories', { name: 'Paper ' + TAG, connector_type: 'paper-index' });
    var again = await api('GET', '/repositories');
    var made = again.body.repositories.filter(function (r) { return r.id === mk.body.id || r.name === 'Paper ' + TAG; })[0];
    ok('B1 a fresh paper location reports an honest zero-entry index', made && made.paper_index_count === 0);
    await api('DELETE', '/repositories/' + made.id);
  }

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
