'use strict';
// LIBRARY DESTINATION ("shelf") — released records that never had a parent request must still land
// somewhere a citizen can find them. The public library browses on fulfilled_records.record_type_id
// + department_id, which used to come ONLY from the parent request: an ad-hoc mass batch produced
// records with NULL in both, i.e. an unbrowsable "Other/Uncategorized" pile, and auto_publish could
// never fire for them.
//
// The design (Kevin, 2026-08-14): the shelf is decided at the point of work — the mass job / batch
// carries a destination (defaulted from the template's linked record type + its owner department),
// the apply path stamps it onto request-less outputs (request values always win when present), the
// publish toggle refuses unshelved records unless the call shelves them, and the public browse
// rolls variant-stamped records up to the parent bucket the citizen knows.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var path = require('path');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var { v4: uuidv4 } = require('/opt/optimumq/backend/node_modules/uuid');

var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'LD' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
var UPLOAD_DIR = require('/opt/optimumq/backend/src/services/docProcessing').UPLOAD_DIR;
async function call(token, method, path2, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path2, {
    method: method,
    headers: Object.assign(token ? { Authorization: 'Bearer ' + token } : {}, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
function api(method, path2, body) { return call(TOKEN, method, path2, body); }

// A request-less file with one blank processed page — enough for the apply pipeline end-to-end.
async function mkFile(name) {
  var fid = uuidv4();
  await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) VALUES (?,NULL,?,?,?,?,?,?,datetime('now'))",
    [fid, name, name, 'application/pdf', 1000, 'uploaded', 'LD Harness']);
  await db.run('INSERT INTO document_pages (id, file_id, page_no, width, height) VALUES (?,?,?,?,?)', [uuidv4(), fid, 1, 612, 792]);
  return fid;
}
async function mkApplyJob(fid, requestId) {
  var jid = uuidv4();
  await db.run('INSERT INTO redaction_jobs (id, file_id, request_id, status, created_by) VALUES (?,?,?,?,?)', [jid, fid, requestId || null, 'draft', 'ld-harness']);
  return jid;
}

(async function () {
  await db.initDb();
  TOKEN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var redactionApply = require('/opt/optimumq/backend/src/services/redactionApply');
  var cat = await db.get('SELECT id FROM categories ORDER BY sort_order LIMIT 1');
  var deptRows = await db.all("SELECT id, name FROM departments WHERE COALESCE(kind,'department') = 'department' ORDER BY name LIMIT 2");
  var dept1 = deptRows[0], dept2 = deptRows[1];

  // Fixture: a bucket with an owner department, a variant under it (NO routing of its own), and a
  // template linked to the VARIANT — the shape the discovery -> template hand-off produces.
  var bucket = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'LD Bucket ' + TAG, code: 'ldb-' + TAG })).body;
  var variant = (await api('POST', '/taxonomy/record-types/' + bucket.id + '/variants', { name: 'LD Variant ' + TAG, code: 'ldv-' + TAG, sample_share: 0.5, layout: 'uniform' })).body;
  await db.run("INSERT INTO record_type_departments (id, record_type_id, department_id, role, sort_order) VALUES (?,?,?,?,0)", [uuidv4(), bucket.id, dept1.id, 'owner']);
  var tpl = (await api('POST', '/redaction-templates', { name: 'LD Template ' + TAG, record_type_id: variant.id, zones: [{ page_no: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] })).body.template;

  console.log('\n=== A. A MASS JOB CARRIES ITS SHELF — defaulted from the template, overridable ===');
  var job1 = (await api('POST', '/mass-jobs', { name: 'LD default ' + TAG, template_id: tpl.id, file_ids: ['ld-nonexistent'] })).body;
  var j1 = await db.get('SELECT record_type_id, department_id FROM mass_redaction_jobs WHERE id = ?', [job1.id]);
  ok('A1 no destination given: the job takes the template\'s linked record type', j1.record_type_id === variant.id);
  ok('A2 the department defaults via the owner walk-up (variant has none; parent bucket owns)', j1.department_id === dept1.id);
  var job2 = (await api('POST', '/mass-jobs', { name: 'LD explicit ' + TAG, template_id: tpl.id, file_ids: ['ld-nonexistent'], record_type_id: bucket.id, department_id: dept2.id })).body;
  var j2 = await db.get('SELECT record_type_id, department_id FROM mass_redaction_jobs WHERE id = ?', [job2.id]);
  ok('A3 an explicit destination wins over the template default', j2.record_type_id === bucket.id && j2.department_id === dept2.id);
  var listed = (await api('GET', '/mass-jobs')).body || [];
  var card = (Array.isArray(listed) ? listed : []).find(function (j) { return j.id === job2.id; });
  ok('A4 the job list names the shelf in plain words for the card', !!card && card.record_type_name === 'LD Bucket ' + TAG && card.department_name === dept2.name);

  console.log('\n=== B. THE APPLY PATH STAMPS THE SHELF — request-less stamped, request wins ===');
  var f1 = await mkFile('ld_adhoc_' + TAG + '.pdf');
  var aj1 = await mkApplyJob(f1, null);
  await redactionApply.applyRedaction(aj1, 'LD Harness', { destination: { record_type_id: variant.id, department_id: dept1.id } });
  var fr1 = await db.get('SELECT * FROM fulfilled_records WHERE source_file_id = ?', [f1]);
  ok('B1 a request-less file lands in the fulfilled index WITH the job\'s shelf', !!fr1 && fr1.record_type_id === variant.id && fr1.department_id === dept1.id);
  ok('B2 it is released but NOT auto-published (variant has no auto_publish)', fr1 && fr1.status === 'released' && !Number(fr1.published || 0));
  var RC = require('/opt/optimumq/backend/src/services/requestCreate');
  var reqR = await RC.createRequest({
    requestorName: 'LD Test', requestorEmail: 'ld@example.com', description: 'ld request ' + TAG,
    classification: 'standard', departmentId: dept2.id, recordTypeId: bucket.id
  }, { kickIntake: false, actorName: 'harness' });
  var f2 = await mkFile('ld_reqfile_' + TAG + '.pdf');
  await db.run('UPDATE request_files SET request_id = ? WHERE id = ?', [reqR.id, f2]);
  var aj2 = await mkApplyJob(f2, reqR.id);
  await redactionApply.applyRedaction(aj2, 'LD Harness', { destination: { record_type_id: variant.id, department_id: dept1.id } });
  var fr2 = await db.get('SELECT record_type_id, department_id FROM fulfilled_records WHERE source_file_id = ?', [f2]);
  ok('B3 a request-attached file keeps the REQUEST\'s shelf even against a conflicting destination', !!fr2 && fr2.record_type_id === bucket.id && fr2.department_id === dept2.id);

  console.log('\n=== C. AUTO_PUBLISH IS ALIVE FOR REQUEST-LESS RECORDS ===');
  await db.run('UPDATE record_types SET auto_publish = 1 WHERE id = ?', [variant.id]);
  var f3 = await mkFile('ld_autopub_' + TAG + '.pdf');
  var aj3 = await mkApplyJob(f3, null);
  await redactionApply.applyRedaction(aj3, 'LD Harness', { destination: { record_type_id: variant.id, department_id: dept1.id } });
  var fr3 = await db.get('SELECT published FROM fulfilled_records WHERE source_file_id = ?', [f3]);
  ok('C1 with auto_publish on the shelf\'s type, a request-less release publishes itself', !!fr3 && Number(fr3.published) === 1);

  console.log('\n=== D. THE PUBLISH GATE — no shelf, no library ===');
  var bare = uuidv4();
  await db.run("INSERT INTO fulfilled_records (id, source_file_id, title, summary, status, released_at) VALUES (?,?,?,?,?,datetime('now'))", [bare, uuidv4(), 'LD Bare ' + TAG, 'LD Bare', 'released']);
  var refuse = await api('POST', '/redaction-jobs/released/' + bare + '/publish', { published: true });
  ok('D1 publishing an unshelved record is refused with a plain-words reason', refuse.status === 400 && /public library/i.test((refuse.body || {}).error || ''));
  var half = await api('POST', '/redaction-jobs/released/' + bare + '/publish', { published: true, record_type_id: bucket.id });
  var halfRow = await db.get('SELECT published FROM fulfilled_records WHERE id = ?', [bare]);
  ok('D2 a record type alone still resolves the department via the owner walk (shelve-and-publish)', half.status === 200 && Number(halfRow.published) === 1);
  var shelved = await db.get('SELECT record_type_id, department_id FROM fulfilled_records WHERE id = ?', [bare]);
  ok('D3 the shelve-and-publish call stamped both shelf fields onto the record', shelved.record_type_id === bucket.id && shelved.department_id === dept1.id);
  var unpub = await api('POST', '/redaction-jobs/released/' + bare + '/publish', { published: false });
  ok('D4 unpublishing never needs a shelf', unpub.status === 200);
  var releasedList = (await api('GET', '/redaction-jobs/released')).body.records || [];
  var anyIds = releasedList.find(function (r) { return r.id === bare; });
  ok('D5 the released list exposes the raw shelf ids so the UI can tell shelved from unshelved', !!anyIds && 'record_type_id' in anyIds && 'department_id' in anyIds);

  console.log('\n=== E. THE PUBLIC LIBRARY ROLLS VARIANTS UP TO THE PARENT BUCKET ===');
  var pubIt = await api('POST', '/redaction-jobs/released/' + fr1.id + '/publish', { published: true });
  ok('E1 the shelved ad-hoc record publishes cleanly', pubIt.status === 200);
  var tree = (await call(null, 'GET', '/public/browse')).body.tree || [];
  var deptNode = tree.find(function (d) { return d.id === dept1.id; });
  var types = (deptNode && deptNode.types) || [];
  var asParent = types.find(function (t) { return t.id === bucket.id; });
  var asVariant = types.find(function (t) { return t.id === variant.id; });
  ok('E2 the variant-stamped record browses under the PARENT bucket\'s name', !!asParent && asParent.name === 'LD Bucket ' + TAG);
  ok('E3 the variant never appears as its own public shelf', !asVariant);
  var recs = (await call(null, 'GET', '/public/browse/records?recordType=' + bucket.id + '&department=' + dept1.id)).body.records || [];
  ok('E4 drilling into the parent shelf returns the variant-stamped record', recs.some(function (r) { return r.id === fr1.id; }));

  console.log('\n=== F. LEAVE THE WORLD AS FOUND ===');
  var outFiles = await db.all("SELECT filename FROM request_files WHERE uploaded_by IN ('LD Harness') OR original_name LIKE 'Redacted - ld_%' || ? || '%'", [TAG]);
  await db.run("DELETE FROM fulfilled_records WHERE source_file_id IN (SELECT id FROM request_files WHERE original_name LIKE 'ld_%' || ? || '%')", [TAG]);
  await db.run('DELETE FROM fulfilled_records WHERE id = ?', [bare]);
  await db.run("DELETE FROM redaction_zones WHERE job_id IN (SELECT id FROM redaction_jobs WHERE created_by = 'ld-harness')");
  await db.run("DELETE FROM redaction_jobs WHERE created_by = 'ld-harness'");
  await db.run("DELETE FROM document_pages WHERE file_id IN (SELECT id FROM request_files WHERE original_name LIKE 'ld_%' || ? || '%')", [TAG]);
  await db.run("DELETE FROM request_files WHERE original_name LIKE 'ld_%' || ? || '%' OR original_name LIKE 'Redacted - ld_%' || ? || '%'", [TAG, TAG]);
  await db.run('DELETE FROM mass_redaction_jobs WHERE id IN (?,?)', [job1.id, job2.id]);
  await db.run('DELETE FROM layout_profiles WHERE id = ?', [tpl.id]);
  await db.run('DELETE FROM record_type_departments WHERE record_type_id = ?', [bucket.id]);
  for (var idd of [variant.id, bucket.id]) { await api('DELETE', '/taxonomy/record-types/' + idd); }
  outFiles.forEach(function (f) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)); } catch (e) {} });
  await db.run('DELETE FROM request_history WHERE request_id IN (?,?)', [reqR.childId, reqR.parentId]);
  await db.run('DELETE FROM requests WHERE id = ?', [reqR.childId]);
  await db.run('DELETE FROM requests WHERE id = ?', [reqR.parentId]);
  var left1 = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE '%' || ?", [TAG]);
  var left2 = await db.get("SELECT count(*)::int AS n FROM request_files WHERE original_name LIKE '%' || ? || '%'", [TAG]);
  var left3 = await db.get("SELECT count(*)::int AS n FROM mass_redaction_jobs WHERE name LIKE '%' || ?", [TAG]);
  ok('F1 all fixture rows are gone', Number(left1.n) === 0 && Number(left2.n) === 0 && Number(left3.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
