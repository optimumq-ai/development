'use strict';
// REQUEST-SIDE ROLE-GATE SWEEP — the two requireAuth-only WRITE surfaces left after the processing
// sweep (verify_processing_gates): the TAXONOMY (categories, record types, department/routing/source
// links, draft-inserting discovery) and a request's FILES (upload, attach, delete, mark responsive,
// render/extract).
//   taxonomy writes  -> middleware/auth.requireTaxonomyEdit  = SYSTEM_ADMIN / DIRECTOR (the "Workflow &
//                       Taxonomy" permission group; the redactionConfig / repository EDIT precedent)
//   file mutations   -> middleware/auth.requireRequestWork   = acting function roles (DIRECTOR/SUPERVISOR/
//                       DEPT_MANAGER/COORDINATOR) OR work perms (REQUEST_MANAGER/SEARCH_AND_TRIAGE/
//                       REDACTION_WORKER/DELIVERY_AND_CLOSURE); SYSTEM_ADMIN passes inside
// Deliberately unchanged: ALL reads; compute-only endpoints (variant scan proposes and inserts nothing;
// staff record search returns results and writes nothing).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var UT = require(__dirname + '/userTypeHelpers');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'RG' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function call(token, method, path2, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path2, {
    method: method,
    headers: Object.assign(token ? { Authorization: 'Bearer ' + token } : {}, { 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined
  });
  return r.status;
}
// The gate answers 403; anything else (404/400/422/500 on garbage fixtures) means the gate LET US
// THROUGH — every "passes" call below targets a nonexistent id or an empty body on purpose, so nothing
// is written. Functional coverage of the real writes lives in the flow harnesses (verify_taxonomy_variants,
// verify_search_resolve, ...).
function gated(s) { return s === 403; }
function through(s) { return s !== 403 && s !== 401; }

var U = {
  none: 'u-rg-none-' + TAG,      // logged in, no roles at all (a reporting-only account)
  search: 'u-rg-search-' + TAG,  // SEARCH_AND_TRIAGE perm only
  super: 'u-rg-super-' + TAG,    // SUPERVISOR function role only, no perms
  dir: 'u-rg-dir-' + TAG         // DIRECTOR function role only, no perms
};

(async function () {
  await db.initDb();
  for (var k in U) {
    await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [U[k], k + '-' + TAG + '@test.optimumq.ai', 'RG ' + k, 'Test ' + TAG]);
  }
  await UT.grantLegacy(U.search, 'pr-searchtriage', 'team-police');
  await UT.grantLegacy(U.super, 'fr-supervisor');
  await UT.grantLegacy(U.dir, 'fr-director');
  var T = {};
  for (var k2 in U) T[k2] = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [U[k2]]));
  T.admin = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var NX = 'rg-nonexistent-' + TAG;

  console.log('\n=== A. TAXONOMY — writes are SYSTEM_ADMIN / DIRECTOR ===');
  ok('A1 create category: no-role 403', gated(await call(T.none, 'POST', '/taxonomy/categories', { name: 'x', code: 'x' })));
  ok('A2 create category: searcher 403 (a work perm is not a config permission)', gated(await call(T.search, 'POST', '/taxonomy/categories', { name: 'x', code: 'x' })));
  ok('A3 create category: team staff 403 (no operations_config — supervisors hold it, §5)', gated(await call(T.search, 'POST', '/taxonomy/categories', { name: 'x', code: 'x' })));
  ok('A4 edit category: DIRECTOR passes the gate', through(await call(T.dir, 'PATCH', '/taxonomy/categories/' + NX, { name: 'x' })));
  ok('A5 edit category: SYSTEM_ADMIN passes the gate', through(await call(T.admin, 'PATCH', '/taxonomy/categories/' + NX, { name: 'x' })));
  ok('A6 delete category: no-role 403', gated(await call(T.none, 'DELETE', '/taxonomy/categories/' + NX)));
  ok('A7 create record type: team staff 403', gated(await call(T.search, 'POST', '/taxonomy/record-types', {})));
  ok('A8 create record type: director passes the gate (400 on an empty body)', through(await call(T.dir, 'POST', '/taxonomy/record-types', {})));
  ok('A9 edit record type: no-role 403', gated(await call(T.none, 'PATCH', '/taxonomy/record-types/' + NX, { name: 'x' })));
  ok('A10 delete record type: searcher 403', gated(await call(T.search, 'DELETE', '/taxonomy/record-types/' + NX)));
  ok('A11 add department link: no-role 403', gated(await call(T.none, 'POST', '/taxonomy/record-types/' + NX + '/departments', { department_id: 'x' })));
  ok('A12 remove department link: no-role 403', gated(await call(T.none, 'DELETE', '/taxonomy/record-types/' + NX + '/departments/' + NX)));
  ok('A13 set routing: team staff 403', gated(await call(T.search, 'PATCH', '/taxonomy/record-types/' + NX + '/routing', {})));
  ok('A14 set routing: director passes the gate', through(await call(T.dir, 'PATCH', '/taxonomy/record-types/' + NX + '/routing', {})));
  ok('A15 set sources: no-role 403', gated(await call(T.none, 'PATCH', '/taxonomy/record-types/' + NX + '/sources', { repository_ids: [] })));
  ok('A16 add repository link: no-role 403', gated(await call(T.none, 'POST', '/taxonomy/record-types/' + NX + '/repositories', { repository_id: 'x' })));
  ok('A17 remove repository link: no-role 403', gated(await call(T.none, 'DELETE', '/taxonomy/record-types/' + NX + '/repositories/' + NX)));
  ok('A18 apply a variant proposal (inserts a draft): team staff 403', gated(await call(T.search, 'POST', '/taxonomy/record-types/' + NX + '/variants', { name: 'x' })));
  ok('A19 apply a variant proposal: director passes the gate', through(await call(T.dir, 'POST', '/taxonomy/record-types/' + NX + '/variants', { name: 'x' })));
  ok('A20 AI discover (inserts a draft): no-role 403', gated(await call(T.none, 'POST', '/taxonomy/discover', { text: 'x' })));
  ok('A21 discover-scan (inserts drafts): team staff 403', gated(await call(T.search, 'POST', '/taxonomy/discover-scan', { repository_id: NX })));
  ok('A22 variant SCAN stays open (compute-only — proposes, inserts nothing)', through(await call(T.none, 'POST', '/taxonomy/record-types/' + NX + '/discover-variants')));

  console.log('\n=== B. REQUEST FILES — mutations need the request-work gate ===');
  ok('B1 upload: no-role 403 (before multer touches disk)', gated(await call(T.none, 'POST', '/files/upload/' + NX, {})));
  ok('B2 upload: searcher passes the gate', through(await call(T.search, 'POST', '/files/upload/' + NX, {})));
  ok('B3 upload: supervisor passes the gate (acting function role)', through(await call(T.super, 'POST', '/files/upload/' + NX, {})));
  ok('B4 attach found record: no-role 403', gated(await call(T.none, 'POST', '/files/attach/' + NX, { record: {} })));
  ok('B5 attach found record: searcher passes the gate', through(await call(T.search, 'POST', '/files/attach/' + NX, { record: {} })));
  ok('B6 delete file: no-role 403', gated(await call(T.none, 'DELETE', '/files/' + NX)));
  ok('B7 delete file: searcher passes the gate', through(await call(T.search, 'DELETE', '/files/' + NX)));
  ok('B8 delete file: director passes the gate', through(await call(T.dir, 'DELETE', '/files/' + NX)));
  ok('B9 mark responsive: no-role 403', gated(await call(T.none, 'PATCH', '/files/' + NX + '/status', { responsive: 1 })));
  ok('B10 mark responsive: searcher passes the gate', through(await call(T.search, 'PATCH', '/files/' + NX + '/status', { responsive: 1 })));
  ok('B11 render/extract: no-role 403', gated(await call(T.none, 'POST', '/files/' + NX + '/process')));
  ok('B12 render/extract: searcher passes the gate', through(await call(T.search, 'POST', '/files/' + NX + '/process')));
  ok('B13 staff record search stays open (compute-only; 400 on an empty query)', through(await call(T.none, 'POST', '/files/search/records', { query: '' })));

  console.log('\n=== C. READS STAY OPEN to any authenticated staffer; auth before role ===');
  ok('C1 categories list 200', (await call(T.none, 'GET', '/taxonomy/categories')) === 200);
  ok('C2 record types list 200', (await call(T.none, 'GET', '/taxonomy/record-types')) === 200);
  ok('C3 taxonomy repositories list 200', (await call(T.none, 'GET', '/taxonomy/repositories')) === 200);
  ok('C4 request files list 200', (await call(T.none, 'GET', '/files/' + NX)) === 200);
  ok('C5 file download reaches the handler (404 on a nonexistent id, not 403)', (await call(T.none, 'GET', '/files/download/' + NX)) === 404);
  ok('C6 no token is 401 not 403 on taxonomy', (await call(null, 'POST', '/taxonomy/categories', {})) === 401);
  ok('C7 no token is 401 not 403 on files', (await call(null, 'DELETE', '/files/' + NX)) === 401);

  console.log('\n=== D. CLEANUP ===');
  var ids = Object.keys(U).map(function (k) { return U[k]; });
  await UT.revokeAll(ids);
  await db.run('DELETE FROM users WHERE id IN (?,?,?,?)', ids);
  var left = await db.get("SELECT count(*)::int AS n FROM users WHERE title = 'Test ' || ?", [TAG]);
  ok('D1 fixture users are gone', Number(left.n) === 0);
  var rtLeft = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code IN ('x') OR name = 'x'");
  ok('D2 no record type or category was written by the pass-through calls', Number(rtLeft.n) === 0 &&
    Number((await db.get("SELECT count(*)::int AS n FROM categories WHERE code = 'x'")).n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
