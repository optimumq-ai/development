'use strict';
// FINGERPRINT DISCOVERY — Kevin's deterministic replacement for the AI-digest variant scan
// (designed 2026-08-14). Code reads EVERY document once, stores a persistent feature vector, and
// matching 8-of-10 features finds same-template piles with EXACT counts; approved variants store a
// consensus signature so later scans — including of OTHER locations — RECOGNIZE their documents
// instead of re-proposing them under a near-duplicate AI-chosen name.
//
// WHAT THIS PREVENTS: alphabetical-sampling skew (there is no sample), extrapolated counts dressed
// as facts, re-proposal of known variants when the same template shows up in a second drive
// (Kevin's date-split-storage case), variable data (names, permit numbers) breaking template
// matches, and the fingerprint index re-reading unchanged files on every scan.
//
// Everything here is the MODEL-FREE half: extraction, matching, clustering, census persistence,
// signatures, recognition, and the approve path. Cluster naming (the one remaining AI call) is
// probed live, never in the suite.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var fp = require('/opt/optimumq/backend/src/services/docFingerprint');
var SD = require('/opt/optimumq/backend/src/services/schemaDiscovery');
var { PDFDocument, StandardFonts } = require('/opt/optimumq/backend/node_modules/pdf-lib');
var { v4: uuidv4 } = require('/opt/optimumq/backend/node_modules/uuid');

var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'FD' + Date.now();
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

// Two synthetic form templates: same layout, varying values — exactly the semi-fixed reality.
async function makePermit(file, name, parcel) {
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]);
  var font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('BUILDING PERMIT APPLICATION', { x: 72, y: 740, size: 16, font: font });
  page.drawText('Applicant:', { x: 72, y: 700, size: 12, font: font });
  page.drawText(name, { x: 170, y: 700, size: 12, font: font });
  page.drawText('Parcel:', { x: 72, y: 676, size: 12, font: font });
  page.drawText(parcel, { x: 170, y: 676, size: 12, font: font });
  page.drawText('Address:', { x: 72, y: 652, size: 12, font: font });
  page.drawText('123 Main St', { x: 170, y: 652, size: 12, font: font });
  page.drawText('City of Autumn Falls - Permit Office', { x: 72, y: 60, size: 10, font: font });
  fs.writeFileSync(file, await pdf.save());
}
async function makeInspection(file, inspector) {
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]);
  var font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('FIRE INSPECTION REPORT', { x: 180, y: 752, size: 14, font: font });
  page.drawText('Inspector:', { x: 72, y: 690, size: 12, font: font });
  page.drawText(inspector, { x: 180, y: 690, size: 12, font: font });
  page.drawText('Date:', { x: 72, y: 664, size: 12, font: font });
  page.drawText('01/12/2026', { x: 180, y: 664, size: 12, font: font });
  page.drawText('Findings:', { x: 72, y: 610, size: 12, font: font });
  page.drawText('No violations observed during walkthrough.', { x: 72, y: 586, size: 11, font: font });
  page.drawText('Corrective actions: none required at this time.', { x: 72, y: 562, size: 11, font: font });
  page.drawText('Fire Marshal Division', { x: 72, y: 90, size: 10, font: font });
  fs.writeFileSync(file, await pdf.save());
}

(async function () {
  await db.initDb();
  TOKEN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var cat = await db.get('SELECT id FROM categories ORDER BY sort_order LIMIT 1');

  var dirA = '/tmp/fd-driveA-' + TAG, dirB = '/tmp/fd-driveB-' + TAG;
  fs.mkdirSync(dirA); fs.mkdirSync(dirB);
  var names = ['John Smith', 'Maria Gonzalez', 'Wei Chen', 'Aaliyah Brooks', 'Sam Novak', 'Priya Patel'];
  for (var i = 0; i < 6; i++) await makePermit(dirA + '/permit_' + i + '.pdf', names[i], '202' + i + '-0' + (100 + i));
  var inspectors = ['T. Okafor', 'L. Marsh', 'R. Ives', 'D. Kimura'];
  for (var j = 0; j < 4; j++) await makeInspection(dirA + '/report_' + j + '.pdf', inspectors[j]);

  console.log('\n=== A. THE FEATURE ENGINE — variable data cannot break a template match ===');
  var a1 = fp.extractFeatures(dirA + '/permit_0.pdf');
  var a2 = fp.extractFeatures(dirA + '/permit_1.pdf');
  var b1 = fp.extractFeatures(dirA + '/report_0.pdf');
  ok('A1 a fingerprint carries the template\'s field labels', a1 && a1.labels.join(',') === 'address,applicant,parcel');
  ok('A2 two documents from ONE template match despite different names and numbers', fp.matchScore(a1, a2) >= fp.MATCH_THRESHOLD);
  ok('A3 documents from DIFFERENT templates do not match', fp.matchScore(a1, b1) < fp.MATCH_THRESHOLD);

  console.log('\n=== B. THE CENSUS — every document read once, persisted, exact totals ===');
  var repoA = 'repo-fd-a-' + TAG;
  await db.run("INSERT INTO record_repositories (id, name, connector_type, config) VALUES (?,?,?,?)", [repoA, 'FD Drive A ' + TAG, 'filestore', JSON.stringify({ path: dirA })]);
  var bucket = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'FD Bucket ' + TAG, code: 'fdb-' + TAG })).body;
  var repoRowA = await db.get('SELECT * FROM record_repositories WHERE id = ?', [repoA]);
  var census1 = await SD.fingerprintCensus(bucket, [repoRowA]);
  ok('B1 the census reads EVERY document — 10 of 10, none sampled away', census1.rows.length === 10 && census1.totalFiles === 10);
  var stored = await db.get('SELECT count(*)::int AS n FROM document_fingerprints WHERE repository_id = ?', [repoA]);
  ok('B2 fingerprints persist in the index', Number(stored.n) === 10);
  var ids1 = census1.rows.map(function (r) { return r.id; }).sort().join(',');
  var census2 = await SD.fingerprintCensus(bucket, [repoRowA]);
  var ids2 = census2.rows.map(function (r) { return r.id; }).sort().join(',');
  ok('B3 a re-scan reuses the stored fingerprints (extract once, hash-keyed)', ids1 === ids2);

  console.log('\n=== C. CLUSTERING — exact counts, honest layout judgment ===');
  var rec0 = await SD.recognizeAgainstSignatures(bucket, census1.rows);
  ok('C1 with no signatures stored yet, nothing is falsely recognized', rec0.recognized.length === 0 && rec0.unrecognized.length === 10);
  var clusters = fp.cluster(rec0.unrecognized).map(function (idxs) { return idxs.map(function (i) { return rec0.unrecognized[i]; }); })
    .sort(function (x, y) { return y.length - x.length; });
  ok('C2 clustering finds exactly the two templates, with EXACT counts 6 and 4',
    clusters.length === 2 && clusters[0].length === 6 && clusters[1].length === 4);
  var featsA = clusters[0].map(function (m) { return m.features; });
  ok('C3 a one-template pile measures as uniform layout', fp.layoutConsistency(featsA) === 'uniform');

  console.log('\n=== C4-C6. EXAMPLE PREVIEW — a proposal opens the REAL document, and only that ===');
  var exFile = clusters[0][0].filename;
  async function preview(repoId, fn) {
    var r = await fetch('http://localhost:' + PORT + '/api/taxonomy/preview-source-file?repository_id=' + encodeURIComponent(repoId) + '&filename=' + encodeURIComponent(fn), { headers: { Authorization: 'Bearer ' + TOKEN } });
    return { status: r.status, type: r.headers.get('content-type') || '', bytes: (await r.arrayBuffer()).byteLength };
  }
  var pv1 = await preview(repoA, exFile);
  ok('C4 an indexed example streams inline as a PDF', pv1.status === 200 && pv1.type.indexOf('application/pdf') === 0 && pv1.bytes > 500);
  var pv2 = await preview(repoA, '../' + exFile);
  var pv2b = await preview(repoA, '..%2Fetc%2Fpasswd');
  ok('C5 traversal filenames are refused', pv2.status === 400 && (pv2b.status === 400 || pv2b.status === 404));
  var pv3 = await preview(repoA, 'never-indexed.pdf');
  ok('C6 a file the census never indexed is refused even if it existed on disk', pv3.status === 404);

  console.log('\n=== D. SIGNATURE + APPROVE — the cluster becomes a variant that FUTURE scans recognize ===');
  var sig = fp.signature(featsA);
  ok('D1 the consensus signature matches a member of its own cluster', fp.matchesSignature(featsA[0], sig));
  ok('D2 ...and does NOT match the other template', !fp.matchesSignature(b1, sig));
  var variant = await SD.applyGroupingProposal(bucket.id, {
    name: 'FD Permit Applications ' + TAG, code: 'fd-permits-' + TAG,
    counted: true, estimated_count: 6, sample_share: 0.6, layout: 'uniform', mass_redaction_candidate: true,
    example_files: ['permit_0.pdf'], repos: ['FD Drive A ' + TAG],
    fingerprint_ids: clusters[0].map(function (m) { return m.id; }), signature: sig
  });
  var meta = JSON.parse((await db.get('SELECT discovery_meta FROM record_types WHERE id = ?', [variant.id])).discovery_meta || '{}');
  ok('D3 the approved variant stores the signature and the counted flag', !!meta.signature && meta.counted === true && meta.estimated_count === 6);
  var stamped = await db.get('SELECT count(*)::int AS n FROM document_fingerprints WHERE matched_record_type_id = ?', [variant.id]);
  ok('D4 the cluster\'s documents are stamped as belonging to the variant', Number(stamped.n) === 6);

  console.log('\n=== E. CROSS-LOCATION RECOGNITION — Kevin\'s date-split-storage case ===');
  for (var k = 0; k < 3; k++) await makePermit(dirB + '/newer_permit_' + k + '.pdf', 'Later Applicant ' + k, '2026-0' + (400 + k));
  var repoB = 'repo-fd-b-' + TAG;
  await db.run("INSERT INTO record_repositories (id, name, connector_type, config) VALUES (?,?,?,?)", [repoB, 'FD Drive B ' + TAG, 'filestore', JSON.stringify({ path: dirB })]);
  var repoRowB = await db.get('SELECT * FROM record_repositories WHERE id = ?', [repoB]);
  var census3 = await SD.fingerprintCensus(bucket, [repoRowA, repoRowB]);
  var rec1 = await SD.recognizeAgainstSignatures(bucket, census3.rows);
  var recEntry = rec1.recognized.find(function (r) { return r.record_type_id === variant.id; });
  ok('E1 documents in a DIFFERENT location are RECOGNIZED as the approved variant, not re-proposed',
    !!recEntry && recEntry.count === 9); // 6 original + 3 from the new drive
  ok('E2 the recognized entry says honestly that no redaction template exists yet', recEntry && recEntry.template_ready === false);
  ok('E3 only the other template remains unrecognized', rec1.unrecognized.length === 4);
  var newStamped = await db.get("SELECT count(*)::int AS n FROM document_fingerprints WHERE matched_record_type_id = ? AND repository_id = ?", [variant.id, repoB]);
  ok('E4 the new location\'s documents are stamped in the index too', Number(newStamped.n) === 3);

  console.log('\n=== E5-E6. STAGE A REAL EXAMPLE — Create a Template opens a pile document, no upload ===');
  var stg = await api('POST', '/redaction-templates/opportunities/' + variant.id + '/stage-example');
  console.log('  (stage-example status ' + stg.status + ' ' + JSON.stringify(stg.body).slice(0,120) + ')');
  var stagedRow = stg.body && stg.body.fileId ? await db.get('SELECT request_id, original_name, mimetype FROM request_files WHERE id = ?', [stg.body.fileId]) : null;
  ok('E5 a stamped example is staged into req-template-samples and returns the workspace fileId',
    stg.status === 200 && stagedRow && stagedRow.request_id === 'req-template-samples' && stagedRow.mimetype === 'application/pdf' && /\.pdf$/i.test(stagedRow.original_name || ''));
  if (stg.body && stg.body.fileId) { var sf = await db.get('SELECT filename FROM request_files WHERE id = ?', [stg.body.fileId]); await db.run('DELETE FROM request_files WHERE id = ?', [stg.body.fileId]); try { require('fs').unlinkSync(require('path').join(__dirname, '../../uploads', sf.filename)); } catch (eU) {} }
  var stgBad = await api('POST', '/redaction-templates/opportunities/rt-does-not-exist/stage-example');
  ok('E6 an unknown variant is refused', stgBad.status === 404);

  console.log('\n=== F. LEAVE THE WORLD AS FOUND ===');
  await db.run('DELETE FROM document_fingerprints WHERE repository_id IN (?,?)', [repoA, repoB]);
  await db.run('DELETE FROM record_repositories WHERE id IN (?,?)', [repoA, repoB]);
  for (var idd of [variant.id, bucket.id]) { await api('DELETE', '/taxonomy/record-types/' + idd); }
  fs.rmSync(dirA, { recursive: true, force: true }); fs.rmSync(dirB, { recursive: true, force: true });
  var left1 = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE '%' || ?", [TAG]);
  var left2 = await db.get('SELECT count(*)::int AS n FROM document_fingerprints WHERE repository_id IN (?,?)', [repoA, repoB]);
  ok('F1 all fixture rows and files are gone', Number(left1.n) === 0 && Number(left2.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
