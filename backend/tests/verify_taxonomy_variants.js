'use strict';
// TAXONOMY VARIANTS — slice 1, the variant backbone (#14, model approved by Kevin 2026-08-13).
//
// A variant IS a record type that names its parent (`record_types.parent_record_type_id`) — one
// level only. Behavioral attachments INHERIT parent-ward when the variant hasn't set its own:
// estimate profile, time budgets, the legal-redaction gate (parent ON binds variants — a legal gate
// never loosens silently), and owner/fulfiller routing in the classifier catalog. Descriptive fields
// are always the variant's own.
//
// WHAT THIS PREVENTS: a variant silently pricing/budgeting/routing as NOTHING because it only set
// what makes it different; grandchildren and cycles sneaking into the catalog; deleting a bucket out
// from under its variants' inheritance.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var taskBudget = require('/opt/optimumq/backend/src/services/taskBudget');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var classifier = require('/opt/optimumq/backend/src/services/classifier');

var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'TV' + Date.now();
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
  var cats = await db.all('SELECT id FROM categories ORDER BY sort_order LIMIT 2');

  console.log('\n=== A. THE SHAPE IS ENFORCED — one level, no cycles, category follows the parent ===');
  var bucket = (await api('POST', '/taxonomy/record-types', { category_id: cats[0].id, name: 'Bucket ' + TAG, code: 'bk-' + TAG })).body;
  var variant = (await api('POST', '/taxonomy/record-types', {
    category_id: cats[1].id, // deliberately wrong — must be aligned to the parent's
    name: 'Variant ' + TAG, code: 'va-' + TAG, parent_record_type_id: bucket.id })).body;
  ok('A1 a variant is created with its parent set', variant && variant.parent_record_type_id === bucket.id);
  ok('A2 the variant lives in its PARENT\'s category, whatever the client sent', variant.category_id === cats[0].id);
  var grand = await api('POST', '/taxonomy/record-types', { category_id: cats[0].id, name: 'Grand ' + TAG, code: 'gr-' + TAG, parent_record_type_id: variant.id });
  ok('A3 a variant cannot be a parent (one level, refused in words)', grand.status === 422 && /one level deep/.test(grand.body.error));
  var selfp = await api('PATCH', '/taxonomy/record-types/' + bucket.id, { parent_record_type_id: bucket.id });
  ok('A4 a type cannot be its own parent', selfp.status === 422);
  var demote = await api('PATCH', '/taxonomy/record-types/' + bucket.id, { parent_record_type_id: null });
  var bucket2 = (await api('POST', '/taxonomy/record-types', { category_id: cats[0].id, name: 'Bucket2 ' + TAG, code: 'bk2-' + TAG })).body;
  var busy = await api('PATCH', '/taxonomy/record-types/' + bucket.id, { parent_record_type_id: bucket2.id });
  ok('A5 a bucket WITH variants cannot itself become a variant', busy.status === 422 && /variants of its own/.test(busy.body.error));
  var delBusy = await api('DELETE', '/taxonomy/record-types/' + bucket.id);
  ok('A6 deleting a bucket with variants is refused in words', delBusy.status === 422 && /variant/.test(delBusy.body.error));

  console.log('\n=== B. INHERITANCE — a variant that only sets what is DIFFERENT still behaves ===');
  await db.run("INSERT INTO record_type_estimate_profiles (record_type_id, quantities_json, has_expert_seed, source, updated_at) VALUES (?,?,1,'expert_seed', now()::text)",
    [bucket.id, JSON.stringify({ bwPages: { mean: 3 } })]);
  var rowVia = await api('GET', '/estimate-profiles/' + variant.id);
  ok('B1 the variant reads its PARENT\'s estimate profile when it has none of its own',
    rowVia.status === 200 && rowVia.body && /bwPages/.test(JSON.stringify(rowVia.body)) && /3/.test(JSON.stringify(rowVia.body)));
  await db.run("INSERT INTO record_type_estimate_profiles (record_type_id, quantities_json, has_expert_seed, source, updated_at) VALUES (?,?,1,'expert_seed', now()::text)",
    [variant.id, JSON.stringify({ bwPages: { mean: 9 } })]);
  var own = await api('GET', '/estimate-profiles/' + variant.id);
  ok('B2 the variant\'s OWN profile wins once it exists',
    own.status === 200 && /9/.test(JSON.stringify(own.body)) && !/"mean":3/.test(JSON.stringify(own.body)));

  await db.run("INSERT INTO time_budgets (id, record_type_id, task_type, budget_days, source) VALUES (?,?,?,?,'supervisor')",
    ['tb-' + TAG, bucket.id, 'record_search', 4]);
  var bmap = await taskBudget.loadBudgetMap();
  var pmap = await taskBudget.loadParentMap();
  ok('B3 time budgets: variant -> parent (4d) -> generic chain',
    taskBudget.lookup(bmap, variant.id, 'record_search', pmap[variant.id]) === 4 &&
    taskBudget.lookup(bmap, bucket2.id, 'record_search', pmap[bucket2.id]) !== 4);
  ok('B4 loadParentMap knows exactly the variants', pmap[variant.id] === bucket.id && pmap[bucket.id] == null);

  await api('PATCH', '/taxonomy/record-types/' + bucket.id, { legal_redaction_required: true });
  var reqId = 'req-' + TAG;
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, record_type_id) VALUES (?,?,?,?,?,'redaction','active',?)",
    [reqId, reqId, 'TV', 'tv@example.com', 'variant legal test ' + TAG, variant.id]);
  ok('B5 the parent\'s legal-redaction gate binds the variant (never loosens at a more specific level)',
    (await tr.requestNeedsLegalRedaction(reqId)) === true);

  console.log('\n=== C. THE CLASSIFIER CATALOG — variants visible, routing inherited ===');
  await api('POST', '/taxonomy/record-types/' + bucket.id + '/departments', { department_id: 'dept-police', role: 'owner' });
  await api('PATCH', '/taxonomy/record-types/' + bucket.id, { status: 'active' });
  await api('PATCH', '/taxonomy/record-types/' + variant.id, { status: 'active' });
  var rows = await classifier.catalogRows();
  var vRow = rows.filter(function (r) { return r.id === variant.id; })[0];
  ok('C1 the variant appears in the catalog with its parent named',
    vRow && vRow.parent_name === 'Bucket ' + TAG);
  ok('C2 the variant INHERITS the parent\'s owner department for routing',
    vRow && vRow.owner_department_id === 'dept-police');
  // Kevin 2026-09-13: a variant has NO routing of its own — the list shows the parent's, and writing one is refused.
  var listedAll = (await api('GET', '/taxonomy/record-types')).body; listedAll = Array.isArray(listedAll) ? listedAll : (listedAll.record_types || listedAll.types || []);
  var listed = listedAll.filter(function (r) { return r.id === variant.id; })[0];
  ok('C3 the taxonomy list shows the variant with its parent\'s routing, marked inherited (was "No owning dept")',
    listed && listed.routing_inherited === true && listed.owner_department_id === 'dept-police');
  var rr = await fetch('http://localhost:' + PORT + '/api/taxonomy/record-types/' + variant.id + '/routing', { method: 'PATCH', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ owning_department_id: 'dept-police' }) });
  var rd = await fetch('http://localhost:' + PORT + '/api/taxonomy/record-types/' + variant.id + '/departments', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ department_id: 'dept-police', role: 'owner' }) });
  var ownLinks = await db.get('SELECT count(*)::int AS n FROM record_type_departments WHERE record_type_id = ?', [variant.id]);
  ok('C4 setting routing ON a variant is refused (422) by both write paths and nothing is written',
    rr.status === 422 && rd.status === 422 && Number(ownLinks.n) === 0);

  console.log('\n=== D. LEAVE THE WORLD AS FOUND ===');
  await db.run('DELETE FROM requests WHERE id = ?', [reqId]);
  await db.run('DELETE FROM record_type_estimate_profiles WHERE record_type_id IN (?,?)', [bucket.id, variant.id]);
  await db.run('DELETE FROM time_budgets WHERE id = ?', ['tb-' + TAG]);
  await api('DELETE', '/taxonomy/record-types/' + variant.id);
  await api('DELETE', '/taxonomy/record-types/' + bucket.id);
  await api('DELETE', '/taxonomy/record-types/' + bucket2.id);
  var left = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE '%' || ?", [TAG]);
  ok('D1 all fixture types are gone (variant first, then its bucket)', Number(left.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
