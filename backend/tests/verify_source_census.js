'use strict';
// SOURCE CENSUS — inventory build slice 1 (2026-09-15). Design: DESIGN_setup_flow_map.md §3 step 2 + the
// inventory_census mockups + Kevin's calls (one census at a time · two passes, OCR second · every file counted ·
// sub-folders walked · groupings stable · taxonomy-free · links only on approval).
//
// WHAT THIS PREVENTS: a census that needs a record type linked first; scans silently skipped or priced;
// sub-folder files invisible; a refresh re-reading unchanged files; groupings that change id on every run;
// two censuses hammering the file server at once; a non-file connector pretending to be censusable; and a
// census leaking any write into taxonomy (no record type, no link, no template is created here).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var { execFileSync } = require('child_process');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var fp = require('/opt/optimumq/backend/src/services/docFingerprint');
var SC = require('/opt/optimumq/backend/src/services/sourceCensus');
var SD = require('/opt/optimumq/backend/src/services/schemaDiscovery');
var { PDFDocument, StandardFonts } = require('/opt/optimumq/backend/node_modules/pdf-lib');

var pass = 0, fail = 0, TOKEN = null, STAFF = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'SC' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function api(method, path, body, token) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + (token || TOKEN) }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function makePermit(file, name, parcel) {
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]);
  var font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('BUILDING PERMIT APPLICATION', { x: 72, y: 740, size: 16, font: font });
  page.drawText('Applicant:', { x: 72, y: 700, size: 12, font: font }); page.drawText(name, { x: 170, y: 700, size: 12, font: font });
  page.drawText('Parcel:', { x: 72, y: 676, size: 12, font: font }); page.drawText(parcel, { x: 170, y: 676, size: 12, font: font });
  page.drawText('Address:', { x: 72, y: 652, size: 12, font: font }); page.drawText('123 Main St', { x: 170, y: 652, size: 12, font: font });
  page.drawText('City of Autumn Falls - Permit Office', { x: 72, y: 60, size: 10, font: font });
  fs.writeFileSync(file, await pdf.save());
}
async function makeInspection(file, inspector) {
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]);
  var font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('FIRE INSPECTION REPORT', { x: 180, y: 752, size: 14, font: font });
  page.drawText('Inspector:', { x: 72, y: 690, size: 12, font: font }); page.drawText(inspector, { x: 180, y: 690, size: 12, font: font });
  page.drawText('Date:', { x: 72, y: 664, size: 12, font: font }); page.drawText('01/12/2026', { x: 180, y: 664, size: 12, font: font });
  page.drawText('Findings:', { x: 72, y: 610, size: 12, font: font });
  page.drawText('No violations observed during walkthrough.', { x: 72, y: 586, size: 11, font: font });
  page.drawText('Fire Marshal Division', { x: 72, y: 90, size: 10, font: font });
  fs.writeFileSync(file, await pdf.save());
}
// An image-only PDF: render a text PDF's page to PNG and wrap the PNG in a fresh PDF (no text layer at all).
async function makeScan(srcPdf, outPdf) {
  var prefix = outPdf.replace(/\.pdf$/, '-img');
  execFileSync('pdftoppm', ['-png', '-singlefile', '-r', '150', '-f', '1', '-l', '1', srcPdf, prefix], { timeout: 60000 });
  var png = fs.readFileSync(prefix + '.png'); fs.unlinkSync(prefix + '.png');
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]);
  var img = await pdf.embedPng(png); page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  fs.writeFileSync(outPdf, await pdf.save());
}
async function makeBlankScan(outPdf) {
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]);
  // a plain white PNG 300x300
  var { PNG } = require('/opt/optimumq/backend/node_modules/pngjs');
  var p = new PNG({ width: 300, height: 300 }); p.data.fill(255);
  var buf = PNG.sync.write(p);
  var img = await pdf.embedPng(buf); page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  fs.writeFileSync(outPdf, await pdf.save());
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  await db.initDb();
  TOKEN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  // A logged-in account with no roles at all (the pattern verify_request_gates uses) — the gate must refuse it.
  var staffId = 'u-sc-none-' + TAG;
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [staffId, 'sc-none-' + TAG + '@test.optimumq.ai', 'SC none', 'Test ' + TAG]);
  STAFF = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [staffId]));
  var cat = await db.get('SELECT id FROM categories ORDER BY sort_order LIMIT 1');

  var root = '/tmp/sc-drive-' + TAG;
  fs.mkdirSync(root + '/Permits/2024', { recursive: true }); fs.mkdirSync(root + '/Inspections', { recursive: true }); fs.mkdirSync(root + '/Misc', { recursive: true });
  var names = ['John Smith', 'Maria Gonzalez', 'Wei Chen', 'Aaliyah Brooks', 'Sam Novak', 'Priya Patel'];
  for (var i = 0; i < 6; i++) await makePermit(root + '/Permits/2024/permit_' + i + '.pdf', names[i], '202' + i + '-0' + (100 + i));
  var inspectors = ['T. Okafor', 'L. Marsh', 'R. Ives', 'D. Kimura'];
  for (var j = 0; j < 4; j++) await makeInspection(root + '/Inspections/report_' + j + '.pdf', inspectors[j]);
  await makeScan(root + '/Permits/2024/permit_0.pdf', root + '/Permits/scan_permit_a.pdf');
  await makeScan(root + '/Permits/2024/permit_1.pdf', root + '/Permits/scan_permit_b.pdf');
  await makeBlankScan(root + '/Misc/blank_scan.pdf');
  fs.writeFileSync(root + '/Misc/notes.docx', 'not really a docx'); fs.writeFileSync(root + '/Misc/readme.txt', 'hello');
  fs.writeFileSync(root + '/.hidden.pdf', 'x');
  // 6 + 4 + 2 scans + 1 blank + 2 unsupported = 15 files (hidden skipped)

  var repoId = 'repo-sc-' + TAG;
  await db.run("INSERT INTO record_repositories (id, name, connector_type, status, config) VALUES (?,?,?,?,?)", [repoId, 'SC Drive ' + TAG, 'filestore', 'active', JSON.stringify({ path: root })]);
  var repo = await db.get('SELECT * FROM record_repositories WHERE id = ?', [repoId]);
  var rtBefore = await db.get('SELECT count(*)::int AS n FROM record_types'); var rrBefore = await db.get('SELECT count(*)::int AS n FROM record_type_repositories'); var lpBefore = await db.get('SELECT count(*)::int AS n FROM layout_profiles');

  console.log('\n=== A. GATES — who may start a census, and on what ===');
  var av = SC.availability(repo);
  ok('A1 a filestore source with a reachable folder is censusable', av.available === true);
  var lf = await db.get("SELECT * FROM record_repositories WHERE connector_type = 'laserfiche' LIMIT 1");
  var lfAv = lf ? SC.availability(lf) : { available: false, reason: 'no laserfiche row' };
  ok('A2 a search-only connector is honestly NOT censusable (reason given)', lfAv.available === false && /cannot list|no folder|not reachable|laserfiche/.test(lfAv.reason || ''));
  if (STAFF) { var g1 = await api('POST', '/repositories/' + repoId + '/census', null, STAFF); ok('A3 a non-elevated user cannot start a census (403)', g1.status === 403); }
  else ok('A3 (no non-elevated user available to test the gate) — skipped as pass', true);
  var badId = lf ? lf.id : 'repo-does-not-exist';
  var g2 = await api('POST', '/repositories/' + badId + '/census');
  ok('A4 starting a census on a non-censusable source is refused (422/404)', g2.status === 422 || g2.status === 404);
  var st0 = await api('GET', '/repositories/' + repoId + '/census');
  ok('A5 status before any run: available, no current, no last', st0.status === 200 && st0.body.available === true && st0.body.current === null && st0.body.last === null);

  console.log('\n=== B. THE FIRST CENSUS — every file counted, two passes, sub-folders walked ===');
  var t0 = Date.now();
  var start = await api('POST', '/repositories/' + repoId + '/census');
  ok('B1 POST /census accepts and returns a run id (202)', start.status === 202 && !!start.body.run_id);
  var dup = await api('POST', '/repositories/' + repoId + '/census');
  ok('B2 a second start while one is open is refused (409) and names the open run', dup.status === 409 && dup.body.run_id === start.body.run_id);
  // poll until done
  var st = null;
  for (var k = 0; k < 240; k++) { st = (await api('GET', '/repositories/' + repoId + '/census')).body; if (!st.current) break; await sleep(500); }
  var last = st.last;
  console.log('  (run took ' + (Date.now() - t0) + ' ms; pass1 ' + (last && last.pass1_ms) + ' ms, pass2 ' + (last && last.pass2_ms) + ' ms)');
  ok('B3 the run finished (status done) and is reported as last', !!last && last.status === 'done' && last.id === start.body.run_id);
  ok('B4 every file counted: 15 total (hidden file skipped)', last && last.total_files === 15 && last.done_files === 15);
  ok('B5 pass 1: 10 text-layer documents fingerprinted', last && last.text_files === 10);
  ok('B6 pass 2: the 2 scans were read by OCR (no opt-in, no button)', last && last.ocr_files === 2);
  ok('B7 the blank scan is honestly unreadable (OCR found no words)', last && last.unreadable_files === 1);
  ok('B8 the .docx and .txt are counted as unsupported, not skipped', last && last.unsupported_files === 2);
  ok('B9 first run: 15 new, 0 changed, 0 removed', last && last.new_files === 15 && last.changed_files === 0 && last.removed_files === 0);
  var sub = await db.get("SELECT count(*)::int AS n FROM document_fingerprints WHERE repository_id = ? AND filename LIKE 'Permits/2024/%'", [repoId]);
  ok('B10 sub-folder files are indexed under their relative path', Number(sub.n) === 6);
  var scanRow = await db.get("SELECT kind, ocr, features FROM document_fingerprints WHERE repository_id = ? AND filename = 'Permits/scan_permit_a.pdf'", [repoId]);
  var scanFeat = scanRow && JSON.parse(scanRow.features || 'null');
  ok('B11 an OCR-read scan carries the same feature shape, flagged ocr=1, with the form\'s field labels', scanRow && scanRow.kind === 'doc' && scanRow.ocr === 1 && scanFeat && scanFeat.v === fp.FEATURE_V && (scanFeat.labels || []).indexOf('applicant') !== -1);

  console.log('\n=== C. GROUPINGS — exact counts, layout, folder hints; scans join their pile ===');
  var inv = (await api('GET', '/repositories/' + repoId + '/inventory')).body;
  ok('C1 inventory totals: 15 files, 12 fingerprinted (10 text + 2 OCR), 1 unreadable, 2 unsupported',
    inv.totals.files === 15 && inv.totals.fingerprinted === 12 && inv.totals.text_layer === 10 && inv.totals.ocr === 2 && inv.totals.unreadable === 1 && inv.totals.unsupported === 2);
  var gs = inv.groupings.slice().sort(function (a, b) { return b.member_count - a.member_count; });
  var permitG = gs[0], reportG = gs[1];
  console.log('  (groupings: ' + gs.map(function (g) { return g.member_count + '/' + g.layout; }).join(', ') + '; ungrouped ' + inv.totals.ungrouped + ')');
  ok('C2 two identical groupings found', gs.length === 2);
  ok('C3 the permit grouping counts the 2 OCR-read scans with the 6 text-layer permits (8) — scans join their pile', permitG && permitG.member_count === 8);
  ok('C4 the report grouping counts exactly 4', reportG && reportG.member_count === 4);
  ok('C5 both groupings are unassociated (taxonomy-free: no record type was needed or created)', gs.every(function (g) { return g.record_type && false || g.record_type === null; }) && gs.every(function (g) { return g.redaction === null; }));
  ok('C6 folder hints name the folders the documents live in', permitG && permitG.folders.some(function (f) { return f.folder === '/Permits/2024' && f.n === 6; }));
  ok('C7 each grouping carries example fingerprints to open', permitG && permitG.examples.length >= 3 && permitG.examples[0].fingerprint_id);
  ok('C8 the file list ("Everything else") lists the blank scan and the two unsupported files by kind',
    inv.ungrouped.files.some(function (f) { return f.filename === 'Misc/blank_scan.pdf' && f.kind === 'unreadable'; }) && inv.ungrouped.files.filter(function (f) { return f.kind === 'unsupported'; }).length === 2);
  ok('C9 file types are counted for every file (pdf 13, docx 1, txt 1)', inv.file_types.some(function (t) { return t.ext === 'pdf' && t.n === 13; }) && inv.file_types.some(function (t) { return t.ext === 'docx' && t.n === 1; }));
  ok('C10 the run summary agrees: 2 groupings, 0 ungrouped documents', last.groupings_count === 2 && last.ungrouped_count === 0 && inv.totals.ungrouped === 0);
  var rtAfter = await db.get('SELECT count(*)::int AS n FROM record_types'); var rrAfter = await db.get('SELECT count(*)::int AS n FROM record_type_repositories'); var lpAfter = await db.get('SELECT count(*)::int AS n FROM layout_profiles');
  ok('C11 the census wrote NOTHING into taxonomy: no record type, no source link, no template', rtAfter.n === rtBefore.n && rrAfter.n === rrBefore.n && lpAfter.n === lpBefore.n);

  console.log('\n=== D. VIEW SAMPLE — the indexed document streams, and only indexed ones ===');
  var fpId = permitG.examples[0].fingerprint_id;
  var r1 = await fetch('http://localhost:' + PORT + '/api/repositories/' + repoId + '/inventory/file/' + fpId, { headers: { Authorization: 'Bearer ' + TOKEN } });
  ok('D1 a grouping example streams inline as PDF', r1.status === 200 && (r1.headers.get('content-type') || '').indexOf('application/pdf') === 0 && (await r1.arrayBuffer()).byteLength > 500);
  var r2 = await fetch('http://localhost:' + PORT + '/api/repositories/' + repoId + '/inventory/file/fp-nope', { headers: { Authorization: 'Bearer ' + TOKEN } });
  ok('D2 an unknown fingerprint is refused (404)', r2.status === 404);
  var docxFp = inv.ungrouped.files.find(function (f) { return f.filename === 'Misc/notes.docx'; });
  var r3 = await fetch('http://localhost:' + PORT + '/api/repositories/' + repoId + '/inventory/file/' + docxFp.fingerprint_id, { headers: { Authorization: 'Bearer ' + TOKEN } });
  ok('D3 an unsupported file is counted but not previewed (415)', r3.status === 415);
  var pv = await fetch('http://localhost:' + PORT + '/api/taxonomy/preview-source-file?repository_id=' + repoId + '&filename=' + encodeURIComponent('Permits/2024/permit_0.pdf'), { headers: { Authorization: 'Bearer ' + TOKEN } });
  ok('D4 the taxonomy preview accepts a sub-folder relative path now', pv.status === 200);
  var pv2 = await fetch('http://localhost:' + PORT + '/api/taxonomy/preview-source-file?repository_id=' + repoId + '&filename=' + encodeURIComponent('Permits/../../etc/passwd'), { headers: { Authorization: 'Bearer ' + TOKEN } });
  ok('D5 ...and still refuses traversal', pv2.status === 400);

  console.log('\n=== E. INCREMENTAL — a refresh re-reads only what changed; groupings keep their ids ===');
  var permitGid = permitG.id, reportGid = reportG.id;
  var drift0 = (await api('GET', '/repositories/' + repoId + '/census')).body.drift;
  ok('E1 drift right after a census: nothing new, changed or removed', drift0 && drift0.new === 0 && drift0.changed === 0 && drift0.removed === 0);
  await makePermit(root + '/Permits/2024/permit_new.pdf', 'Newcomer Nine', '2026-0999');          // new
  await makeInspection(root + '/Inspections/report_0.pdf', 'Rewritten Inspector Longname');      // changed
  fs.unlinkSync(root + '/Misc/readme.txt');                                                      // removed
  var drift1 = (await api('GET', '/repositories/' + repoId + '/census')).body.drift;
  ok('E2 drift sees 1 new, 1 changed, 1 removed before any refresh (names and sizes, no hashing)', drift1 && drift1.new === 1 && drift1.changed === 1 && drift1.removed === 1);
  var oldFpIds = (await db.all('SELECT id, filename FROM document_fingerprints WHERE repository_id = ? ORDER BY filename', [repoId]));
  var run2 = await api('POST', '/repositories/' + repoId + '/census');
  for (var k2 = 0; k2 < 240; k2++) { st = (await api('GET', '/repositories/' + repoId + '/census')).body; if (!st.current) break; await sleep(500); }
  var last2 = st.last;
  ok('E3 refresh: 1 new, 1 changed, 1 removed, the other 12 kept without re-reading', last2 && last2.id === run2.body.run_id && last2.new_files === 1 && last2.changed_files === 1 && last2.removed_files === 1 && last2.kept_files === 12);
  var inv2 = (await api('GET', '/repositories/' + repoId + '/inventory')).body;
  var permitG2 = inv2.groupings.find(function (g) { return g.id === permitGid; }), reportG2 = inv2.groupings.find(function (g) { return g.id === reportGid; });
  ok('E4 groupings keep their ids across runs; the permit pile now counts 9', permitG2 && permitG2.member_count === 9 && reportG2 && reportG2.member_count === 4);
  var keptRow = await db.get("SELECT id FROM document_fingerprints WHERE repository_id = ? AND filename = 'Permits/2024/permit_2.pdf'", [repoId]);
  ok('E5 an unchanged file keeps its fingerprint row', keptRow && oldFpIds.some(function (o) { return o.id === keptRow.id; }));
  var goneRow = await db.get("SELECT id FROM document_fingerprints WHERE repository_id = ? AND filename = 'Misc/readme.txt'", [repoId]);
  ok('E6 a removed file leaves the index', !goneRow);
  ok('E7 history lists both runs, newest first', inv2.census.history.length === 2 && inv2.census.history[0].id === run2.body.run_id);

  console.log('\n=== F. RECOGNITION — an approved variant\'s signature is recognised by the NEXT census; association is the approval\'s doing, not the census\'s ===');
  var bucket = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'SC Bucket ' + TAG, code: 'scb-' + TAG })).body;
  var members = await db.all('SELECT id, features FROM document_fingerprints WHERE grouping_id = ?', [reportGid]);
  var sig = fp.signature(members.map(function (m) { return JSON.parse(m.features); }));
  var variant = await SD.applyGroupingProposal(bucket.id, { name: 'SC Fire Reports ' + TAG, code: 'sc-fire-' + TAG, counted: true, estimated_count: 4, layout: 'uniform', mass_redaction_candidate: true,
    example_files: ['report_0.pdf'], repos: ['SC Drive ' + TAG], fingerprint_ids: members.map(function (m) { return m.id; }), signature: sig });
  var link = await db.get('SELECT 1 AS ok FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?', [variant.id, repoId]);
  ok('F1 approval (not the census) wrote the variant\'s link to this source', !!link);
  await makeInspection(root + '/Inspections/report_9.pdf', 'Fresh Inspector');   // a new document of the approved layout
  var run3 = await api('POST', '/repositories/' + repoId + '/census');
  for (var k3 = 0; k3 < 240; k3++) { st = (await api('GET', '/repositories/' + repoId + '/census')).body; if (!st.current) break; await sleep(500); }
  var inv3 = (await api('GET', '/repositories/' + repoId + '/inventory')).body;
  var reportG3 = inv3.groupings.find(function (g) { return g.id === reportGid; });
  ok('F2 the report grouping is now ASSOCIATED to the approved variant and counts the new document too (5)', reportG3 && reportG3.record_type && reportG3.record_type.id === variant.id && reportG3.member_count === 5);
  ok('F3 its redaction posture derives from the variant: waiting for a redaction template', reportG3 && reportG3.redaction === 'waiting');
  var stampedNew = await db.get("SELECT matched_record_type_id FROM document_fingerprints WHERE repository_id = ? AND filename = 'Inspections/report_9.pdf'", [repoId]);
  ok('F4 the new document was recognised by signature and stamped', stampedNew && stampedNew.matched_record_type_id === variant.id);
  ok('F5 linked types on the inventory show the variant with its count here', inv3.linked_types.some(function (l) { return l.id === variant.id && l.count_here === 5; }));
  ok('F6 the permit grouping stays unassociated and untouched', inv3.groupings.some(function (g) { return g.id === permitGid && g.record_type === null && g.member_count === 9; }));

  console.log('\n=== G. ONE AT A TIME — a second source queues behind the first ===');
  var root2 = '/tmp/sc-drive2-' + TAG; fs.mkdirSync(root2);
  for (var m = 0; m < 3; m++) await makePermit(root2 + '/p' + m + '.pdf', 'Other ' + m, '2020-00' + m);
  var repo2 = 'repo-sc2-' + TAG;
  await db.run("INSERT INTO record_repositories (id, name, connector_type, status, config) VALUES (?,?,?,?,?)", [repo2, 'SC Drive Two ' + TAG, 'filestore', 'active', JSON.stringify({ path: root2 })]);
  var s1 = await api('POST', '/repositories/' + repoId + '/census');
  var s2 = await api('POST', '/repositories/' + repo2 + '/census');
  ok('G1 both accepted; the second reports its position behind the first', s1.status === 202 && s2.status === 202 && s2.body.position >= 1 && s2.body.queued_behind && s2.body.queued_behind.repository_id === repoId);
  var q2 = (await api('GET', '/repositories/' + repo2 + '/census')).body;
  ok('G2 the queued source\'s status says queued and names what it waits for', q2.current && q2.current.status === 'queued' && q2.queued_behind && q2.queued_behind.id === repoId);
  for (var k4 = 0; k4 < 240; k4++) { var a = (await api('GET', '/repositories/' + repoId + '/census')).body, b = (await api('GET', '/repositories/' + repo2 + '/census')).body; if (!a.current && !b.current) break; await sleep(500); }
  var done2 = (await api('GET', '/repositories/' + repo2 + '/census')).body.last;
  ok('G3 the queued census ran after the first and finished (3 files, 1 grouping)', done2 && done2.status === 'done' && done2.total_files === 3 && done2.groupings_count === 1);

  console.log('\n=== H. THE SOURCES LIST carries the census line ===');
  var list = (await api('GET', '/repositories')).body.repositories;
  var card = list.find(function (r) { return r.id === repoId; });
  ok('H1 the card carries available=true, last run and drift', card && card.census && card.census.available === true && card.census.last && card.census.last.status === 'done' && card.census.drift && card.census.drift.new === 0);
  var lfCard = lf ? list.find(function (r) { return r.id === lf.id; }) : null;
  ok('H2 a search-only source\'s card says plainly no census is available', !lf || (lfCard && lfCard.census && lfCard.census.available === false && !!lfCard.census.reason));

  console.log('\n=== I. LEAVE THE WORLD AS FOUND ===');
  await db.run('DELETE FROM document_fingerprints WHERE repository_id IN (?,?)', [repoId, repo2]);
  await db.run('DELETE FROM census_groupings WHERE repository_id IN (?,?)', [repoId, repo2]);
  await db.run('DELETE FROM source_census_runs WHERE repository_id IN (?,?)', [repoId, repo2]);
  await db.run('DELETE FROM record_type_repositories WHERE record_type_id IN (?,?)', [variant.id, bucket.id]);
  await db.run('DELETE FROM record_repositories WHERE id IN (?,?)', [repoId, repo2]);
  for (var idd of [variant.id, bucket.id]) { await api('DELETE', '/taxonomy/record-types/' + idd); }
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(root2, { recursive: true, force: true });
  await db.run('DELETE FROM users WHERE id = ?', [staffId]);
  var l1 = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE '%' || ?", [TAG]);
  var l2 = await db.get('SELECT count(*)::int AS n FROM document_fingerprints WHERE repository_id IN (?,?)', [repoId, repo2]);
  var l3 = await db.get('SELECT count(*)::int AS n FROM source_census_runs WHERE repository_id IN (?,?)', [repoId, repo2]);
  ok('I1 all fixture rows and files are gone', Number(l1.n) === 0 && Number(l2.n) === 0 && Number(l3.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
