'use strict';
// VARIANT DISCOVERY — #14 slice 2, the deterministic halves (Kevin's counting concept, mockup 3).
//
// The scan half calls the model and is probed live (nondeterministic, costs spend — the suite must
// not depend on it). What the suite CAN lock: the scan's refusals (a variant can't be scanned, no
// scannable sources is an honest 422 BEFORE any model call), the connector's honest counting, and
// applyGroupingProposal — the pure insert of one approved proposal as a DRAFT variant with its
// provenance written into the description.
//
// WHAT THIS PREVENTS: approvals silently creating active types (drafts don't classify — activation
// stays a human act), grandchildren via the apply path, counts presented as facts when they are
// estimates, and a scan burning model spend on a type with nothing to scan.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var SD = require('/opt/optimumq/backend/src/services/schemaDiscovery');
var filestore = require('/opt/optimumq/backend/src/services/connectors/filestore');

var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'VD' + Date.now();
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
  var cat = await db.get('SELECT id FROM categories ORDER BY sort_order LIMIT 1');

  console.log('\n=== A. HONEST COUNTING — the connector reports the REAL holding size ===');
  var dir = '/tmp/vd-count-' + TAG;
  fs.mkdirSync(dir);
  ['a.pdf', 'b.pdf', 'c.pdf', 'not-a-doc.txt'].forEach(function (f) { fs.writeFileSync(dir + '/' + f, 'x'); });
  ok('A1 countAll counts every matching document, not a sample', filestore.countAll({ path: dir }) === 3);
  ok('A2 a missing source counts zero, never throws', filestore.countAll({ path: '/no/such/dir' }) === 0);

  console.log('\n=== B. THE SCAN REFUSES HONESTLY, BEFORE ANY MODEL CALL ===');
  var bucket = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'VD Bucket ' + TAG, code: 'vdb-' + TAG })).body;
  var variant = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'VD Variant ' + TAG, code: 'vdv-' + TAG, parent_record_type_id: bucket.id })).body;
  var onVariant = await api('POST', '/taxonomy/record-types/' + variant.id + '/discover-variants');
  ok('B1 scanning a VARIANT is refused in words (scan the bucket)', onVariant.status === 422 && /parent bucket/.test(onVariant.body.error));
  var noSources = await api('POST', '/taxonomy/record-types/' + bucket.id + '/discover-variants');
  ok('B2 a bucket with no scannable sources is an honest 422', noSources.status === 422 && /No scannable documents/.test(noSources.body.error));

  console.log('\n=== C. APPLYING AN APPROVED PROPOSAL — a DRAFT variant with honest provenance ===');
  var applied = (await api('POST', '/taxonomy/record-types/' + bucket.id + '/variants', {
    name: 'Electrical ' + TAG, code: 'vd-elec-' + TAG, intent: 'Trade permits for electrical work',
    synonyms: ['electric permit'], keywords: ['electrical'], formats: ['document'],
    confidence: 82, sample_share: 0.5, estimated_count: 1204, mass_redaction_candidate: true })).body;
  ok('C1 the approved proposal is a DRAFT variant under the bucket, source=discovered',
    applied && applied.parent_record_type_id === bucket.id && applied.status === 'draft' && applied.source === 'discovered');
  ok('C2 it lives in the bucket\'s category with the AI\'s confidence carried',
    applied.category_id === bucket.category_id && Number(applied.confidence) === 82);
  ok('C3 provenance is written where humans read it — the description names the estimate and the flag',
    /about 1204 documents/.test(applied.description) && /mass-redaction candidate/i.test(applied.description));
  var noCount = (await api('POST', '/taxonomy/record-types/' + bucket.id + '/variants', {
    name: 'Plumbing ' + TAG, code: 'vd-plumb-' + TAG, sample_share: 0.3 })).body;
  ok('C4 without a real total, provenance says "% of the scanned sample" — an estimate never dresses as a fact',
    /30% of the scanned sample/.test(noCount.description) && !/documents in the holdings/.test(noCount.description));
  var onVariant2 = await api('POST', '/taxonomy/record-types/' + variant.id + '/variants', { name: 'Grand ' + TAG });
  ok('C5 applying onto a variant is refused (one level, same rule as everywhere)', onVariant2.status === 422);
  var unnamed = await api('POST', '/taxonomy/record-types/' + bucket.id + '/variants', { code: 'x' });
  ok('C6 a proposal without a name is refused', unnamed.status === 422);
  var draftsDontClassify = await require('/opt/optimumq/backend/src/services/classifier').catalogRows();
  ok('C7 draft variants do NOT enter the classifier catalog (activation stays the human act)',
    !draftsDontClassify.some(function (r) { return r.id === applied.id; }));

  console.log('\n=== D. LEAVE THE WORLD AS FOUND ===');
  for (var idd of [applied.id, noCount.id, variant.id, bucket.id]) { await api('DELETE', '/taxonomy/record-types/' + idd); }
  fs.rmSync(dir, { recursive: true, force: true });
  var left = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE '%' || ?", [TAG]);
  ok('D1 all fixture types are gone', Number(left.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
