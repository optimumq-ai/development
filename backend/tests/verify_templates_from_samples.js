'use strict';
// TEMPLATES SEEDED FROM ACTUAL SAMPLES — item 7 slice S1 (2026-09-16). Design: DESIGN_templates_from_samples.md
// §2 (layout / content classes), §3 (content kind), §4 (what Propose writes, who approves — Kevin D1), §6 (the
// inventory row), §7 (the matching rule from findings B and C — Kevin D5), §8 S1.
//
// WHAT THIS PREVENTS: a template seeded from ONE sample keeping the sample's filled-in words and then HOLDING
// its own pile (finding B); a short form's vocabulary burning a different short form's coordinates because the
// two share letterhead and labels (finding C — the census fingerprint veto is the only thing that separates
// them); the task screen's template save posting no record type (finding A); a redaction worker activating a
// template directly; a content profile ever mass-applying; a legacy template pretending it was censused.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var path = require('path');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var { PDFDocument, StandardFonts } = require('/opt/optimumq/backend/node_modules/pdf-lib');
var { v4: uuidv4 } = require('/opt/optimumq/backend/node_modules/uuid');

var pass = 0, fail = 0, TOKEN = null, WORKER = null, STAFF = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'TS' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
var UPLOAD_DIR = '/opt/optimumq/uploads';
async function api(method, p, body, token) {
  var r = await fetch('http://localhost:' + PORT + '/api' + p, { method: method, headers: Object.assign({ Authorization: 'Bearer ' + (token || TOKEN) }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
var WORDS = ['gazebo', 'pergola', 'carport', 'veranda', 'sunroom', 'atrium', 'mezzanine', 'dormer'];
var NAMES = ['Quimby', 'Halloran', 'Petrakis', 'Oyelaran', 'Bexley', 'Marchetti', 'Sorensen', 'Whitlock'];
var NOTES = ['lorem ipsum dolor amet consectetur elit', 'vivamus tortor sagittis lacinia posuere ornare', 'curabitur blandit tempus porttitor nullam quis', 'maecenas faucibus mollis interdum donec ullamcorper', 'aenean lacinia bibendum nulla sed vestibulum', 'praesent commodo cursus magna scelerisque fringilla'];
// A LONG form: letterhead, title, ten labels, and filled-in words that VARY per document (the words a one-file
// fingerprint keeps and a pile vocabulary drops).
async function makePermit(file, i) {
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]); var font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('CITY OF AUTUMN FALLS', { x: 72, y: 750, size: 13, font: font });
  page.drawText('BUILDING PERMIT APPLICATION', { x: 72, y: 722, size: 17, font: font });
  var labels = ['Applicant', 'Parcel', 'Address', 'Contractor', 'Telephone', 'Description', 'Valuation', 'Zoning', 'Inspector', 'Status'];
  var vals = [NAMES[i] + ' ' + NAMES[(i + 3) % 8], '202' + i + '-0' + (100 + i), (100 + i * 7) + ' ' + NAMES[(i + 5) % 8] + ' Lane', NAMES[(i + 2) % 8] + ' Builders', '(555) 010-' + (1000 + i), 'new ' + WORDS[i] + ' with ' + WORDS[(i + 1) % 8] + ' and ' + WORDS[(i + 2) % 8], '$' + (10000 + i * 1234), 'R-' + (i + 1), NAMES[(i + 6) % 8], i % 2 ? 'Approved' : 'Pending'];
  for (var k = 0; k < labels.length; k++) { page.drawText(labels[k] + ':', { x: 72, y: 680 - k * 26, size: 11, font: font }); page.drawText(vals[k], { x: 200, y: 680 - k * 26, size: 11, font: font }); }
  page.drawText('Notes:', { x: 72, y: 400, size: 11, font: font }); page.drawText(NOTES[i % 6], { x: 200, y: 400, size: 11, font: font });
  page.drawText('Permit Office - Development Services Department', { x: 72, y: 60, size: 10, font: font });
  fs.writeFileSync(file, await pdf.save());
}
// Two SHORT forms that share letterhead and every label and differ only in the title line and an extra
// section — finding C's Correction Notice (Standard) vs (Extended).
async function makeNotice(file, i, extended) {
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]); var font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('CITY OF AUTUMN FALLS', { x: 72, y: 750, size: 13, font: font });
  page.drawText(extended ? 'CORRECTION NOTICE EXTENDED' : 'CORRECTION NOTICE STANDARD', { x: 72, y: 722, size: 17, font: font });
  page.drawText('Permit:', { x: 72, y: 680, size: 11, font: font }); page.drawText('BP-' + (4000 + i), { x: 200, y: 680, size: 11, font: font });
  page.drawText('Inspector:', { x: 72, y: 654, size: 11, font: font }); page.drawText(NAMES[i % 8], { x: 200, y: 654, size: 11, font: font });
  page.drawText('Item:', { x: 72, y: 628, size: 11, font: font }); page.drawText('Correct the ' + WORDS[i % 8], { x: 200, y: 628, size: 11, font: font });
  if (extended) { for (var k = 0; k < 6; k++) { page.drawText('Section ' + (k + 1) + ':', { x: 72, y: 590 - k * 24, size: 11, font: font }); page.drawText('Additional finding ' + WORDS[(i + k) % 8], { x: 200, y: 590 - k * 24, size: 11, font: font }); } }
  page.drawText('Permit Office - Development Services Department', { x: 72, y: 60, size: 10, font: font });
  fs.writeFileSync(file, await pdf.save());
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function censusDone(repoId) { for (var k = 0; k < 240; k++) { var st = (await api('GET', '/repositories/' + repoId + '/census')).body; if (!st.current) return st.last; await sleep(400); } return null; }
async function inventory(repoId) { return (await api('GET', '/repositories/' + repoId + '/inventory')).body; }
async function upload(srcPath, requestId) {   // a request file as the task screen / matcher sees it
  var newName = uuidv4() + '.pdf'; fs.copyFileSync(srcPath, path.join(UPLOAD_DIR, newName));
  var fid = uuidv4();
  await db.run('INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, responsive, uploaded_by) VALUES (?,?,?,?,?,?,?,?)', [fid, requestId || null, newName, path.basename(srcPath), 'application/pdf', fs.statSync(srcPath).size, 0, 'u-kruss']);
  return { id: fid, filename: newName };
}
var uploaded = [];
async function up(srcPath, requestId) { var f = await upload(srcPath, requestId); uploaded.push(f); return f.id; }

(async function () {
  await db.initDb();
  TOKEN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var workerId = 'u-ts-worker-' + TAG, staffId = 'u-ts-none-' + TAG;
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [workerId, 'ts-worker-' + TAG + '@test.optimumq.ai', 'TS Worker', 'Test ' + TAG]);
  await db.run('INSERT INTO user_user_types (user_id, user_type_id) VALUES (?,?)', [workerId, 'ut-team_staff']);
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [staffId, 'ts-none-' + TAG + '@test.optimumq.ai', 'TS None', 'Test ' + TAG]);
  WORKER = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [workerId]));
  STAFF = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [staffId]));
  var cat = await db.get('SELECT id FROM categories ORDER BY sort_order LIMIT 1');
  var rSsn = 'rr-ssn-' + TAG, rPhone = 'rr-phone-' + TAG, rAtty = 'rr-atty-' + TAG;
  await db.run("INSERT INTO redaction_rules (id, jurisdiction_id, title, category, is_active) VALUES (?,?,?,?,1)", [rSsn, 'jur-tx', 'Social Security Numbers ' + TAG, 'privacy']);
  await db.run("INSERT INTO redaction_rules (id, jurisdiction_id, title, category, is_active) VALUES (?,?,?,?,1)", [rPhone, 'jur-tx', 'Telephone Numbers ' + TAG, 'privacy']);
  await db.run("INSERT INTO redaction_rules (id, jurisdiction_id, title, category, is_active) VALUES (?,?,?,?,1)", [rAtty, 'jur-tx', 'Attorney-Client Privileged ' + TAG, 'legal']);
  var reqId = 'req-ts-' + TAG;
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id) VALUES (?,?,?,?,?,?,'active',?)", [reqId, reqId, 'TS Harness', 'ts@example.com', 'templates-from-samples fixture ' + TAG, 'processing', null]);

  var root = '/tmp/ts-drive-' + TAG;
  fs.mkdirSync(root + '/Permits', { recursive: true }); fs.mkdirSync(root + '/Notices', { recursive: true });
  for (var i = 0; i < 6; i++) await makePermit(root + '/Permits/permit_' + i + '.pdf', i);
  for (var j = 0; j < 5; j++) { await makeNotice(root + '/Notices/std_' + j + '.pdf', j, false); await makeNotice(root + '/Notices/ext_' + j + '.pdf', j, true); }
  var repoId = 'repo-ts-' + TAG;
  await db.run("INSERT INTO record_repositories (id, name, connector_type, status, config) VALUES (?,?,?,?,?)", [repoId, 'TS Drive ' + TAG, 'filestore', 'active', JSON.stringify({ path: root })]);
  await api('POST', '/repositories/' + repoId + '/census'); await censusDone(repoId);
  var inv = await inventory(repoId);
  var gs = inv.groupings.slice().sort(function (a, b) { return b.member_count - a.member_count; });
  var bucket = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'TS Bucket ' + TAG, code: 'tsb-' + TAG })).body;
  var G = '/repositories/' + repoId + '/groupings/';

  console.log('\n=== A. THE FIXTURE: one long-form pile, two short-form piles the census tells apart by title ===');
  ok('A1 three groupings: 6 permits, 5 standard notices, 5 extended notices', gs.length === 3 && gs[0].member_count === 6 && gs[1].member_count === 5 && gs[2].member_count === 5);
  function pileOf(folderName, fileStart) { return gs.find(function (g) { return g.examples.some(function (e) { return e.filename.indexOf(folderName + '/' + fileStart) === 0; }); }); }
  var permitG = pileOf('Permits', 'permit'), stdG = pileOf('Notices', 'std'), extG = pileOf('Notices', 'ext');
  ok('A2 the two notice forms are SEPARATE groupings (the titleLines veto did its job)', stdG && extG && stdG.id !== extG.id);
  var aP = await api('POST', G + permitG.id + '/associate', { mode: 'new_variant', parent_record_type_id: bucket.id, name: 'TS Permit Applications ' + TAG });
  var aS = await api('POST', G + stdG.id + '/associate', { mode: 'new_variant', parent_record_type_id: bucket.id, name: 'TS Correction Notice Standard ' + TAG });
  var aE = await api('POST', G + extG.id + '/associate', { mode: 'new_variant', parent_record_type_id: bucket.id, name: 'TS Correction Notice Extended ' + TAG });
  var permitRT = aP.body.record_type.id, stdRT = aS.body.record_type.id, extRT = aE.body.record_type.id;
  ok('A3 three variants associated (draft, mass-redaction candidates)', aP.status === 200 && aS.status === 200 && aE.status === 200);
  inv = await inventory(repoId);
  var row = function (gid) { return inv.groupings.find(function (g) { return g.id === gid; }); };
  ok('A4 inventory rows: posture "waiting", layout class UNKNOWN with "static" proposed by the census, estimate "none yet" (§6 second column)',
    row(permitG.id).redaction === 'waiting' && row(permitG.id).layout_class === null && row(permitG.id).layout_class_proposed === 'static' && row(permitG.id).estimate && row(permitG.id).estimate.state === 'none');

  console.log('\n=== B. FINDING A + D1: the task screen\'s save carries the type; a worker PROPOSES, a supervisor approves ===');
  var f0 = await up(root + '/Permits/permit_0.pdf', reqId);
  var zonesSimple = [{ page_no: 1, x: 0.3, y: 0.10, w: 0.3, h: 0.03, rule_id: rSsn, label: 'SSN' }, { page_no: 1, x: 0.3, y: 0.24, w: 0.3, h: 0.03, rule_id: rPhone, label: 'phone' }];
  var b0 = await api('POST', '/redaction-templates', { name: 'TS none ' + TAG, source_file_id: f0, record_type_id: permitRT, zones: zonesSimple, propose: true }, STAFF);
  ok('B1 a user with no redaction menu is refused (403)', b0.status === 403);
  var b1 = await api('POST', '/redaction-templates', { name: 'TS worker direct ' + TAG, source_file_id: f0, record_type_id: permitRT, zones: zonesSimple }, WORKER);
  ok('B2 a redaction worker cannot save DIRECTLY (403 PROPOSE_ONLY)', b1.status === 403 && b1.body.code === 'PROPOSE_ONLY');
  var b2 = await api('POST', '/redaction-templates', { name: 'TS permit proposal ' + TAG, source_file_id: f0, record_type_id: permitRT, source: 'sample', propose: true, request_id: reqId, zones: zonesSimple, layout_class: 'static' }, WORKER);
  var tP = b2.body && b2.body.template;
  ok('B3 the worker\'s save is a PROPOSAL: status proposed, source sample, from the request, by the worker', b2.status === 200 && b2.body.status === 'proposed' && tP && tP.status === 'proposed' && tP.source === 'sample' && tP.proposed_from_request_id === reqId && tP.proposed_by === 'TS Worker');
  var fp = JSON.parse(tP.layout_fingerprint);
  ok('B4 it carries the census: signature stored, vocabulary from the PILE (5 members), no filled-in words (' + fp.tokens.length + ' terms)',
    !!tP.census_signature && tP.vocabulary_source === 'pile' && fp.pile_members === 5 && fp.tokens.indexOf('gazebo') === -1 && fp.tokens.indexOf('quimby') === -1 && fp.tokens.indexOf('applicant') !== -1);
  ok('B5 layout class STATIC came from the census (uniform pile); content class SIMPLE (two detector-backed rules)', b2.body.layout_class === 'static' && tP.content_class === 'simple');
  inv = await inventory(repoId);
  var pr = row(permitG.id);
  ok('B6 the inventory row says "proposed" and names the proposer and the request', pr.redaction === 'proposed' && pr.redaction_detail && pr.redaction_detail.template.id === tP.id && pr.redaction_detail.template.proposed_by === 'TS Worker' && pr.redaction_detail.template.proposed_from_request_id === reqId);
  var lst = (await api('GET', '/redaction-templates')).body.templates.find(function (t) { return t.id === tP.id; });
  ok('B7 Mass Redaction lists it as proposed, not provisional', lst && lst.status === 'proposed' && lst.provisional === false && lst.proposed_by === 'TS Worker');
  var f1 = await up(root + '/Permits/permit_1.pdf', reqId);
  var m0 = await api('POST', '/redaction-templates/match', { file_id: f1 });
  ok('B8 a PROPOSED template never matches (only active ones do)', m0.status === 200 && m0.body.matched === false);
  var ap0 = await api('POST', '/redaction-templates/' + tP.id + '/approve', null, WORKER);
  ok('B9 the worker cannot approve their own proposal (403)', ap0.status === 403);
  var ap1 = await api('POST', '/redaction-templates/' + tP.id + '/approve');
  inv = await inventory(repoId); pr = row(permitG.id);
  var hist = await db.get("SELECT count(*)::int AS n FROM processing_history WHERE entity_id = ? AND action IN ('template_proposed_from_sample','template_approved')", [tP.id]);
  ok('B10 a supervisor approves → active; the row says "Redaction template ready", not provisional; both acts in processing_history', ap1.status === 200 && ap1.body.template.status === 'active' && pr.redaction === 'template_ready' && pr.redaction_detail.template.provisional === false && Number(hist.n) === 2);
  ok('B11 the record type now carries layout_class = static (Kevin D7: census proposed, the human confirmed it in the save)', (await db.get('SELECT layout_class FROM record_types WHERE id = ?', [permitRT])).layout_class === 'static');
  ok('B12 approving twice is refused (409)', (await api('POST', '/redaction-templates/' + tP.id + '/approve')).status === 409);

  console.log('\n=== C. FINDING B: one-sample vocabulary HOLDS the pile; pile vocabulary matches it ===');
  var engine = require('/opt/optimumq/backend/src/routes/redactionTemplates').engine;
  var docProcessing = require('/opt/optimumq/backend/src/services/docProcessing');
  await docProcessing.processFile(f0);   // the engine scores text already extracted; the routes extract on demand
  var oneFile = await engine.buildFingerprint(f0);
  var legacy = { layout_fingerprint: oneFile, census_signature: null, safety_threshold: 80 };
  var sOne = await engine.safetyScore(legacy, f1);
  var tRow = await db.get('SELECT * FROM layout_profiles WHERE id = ?', [tP.id]);
  var sPile = await engine.safetyScore(tRow, f1);
  console.log('      one-sample vocabulary vs permit_1: ' + sOne.score + '   pile vocabulary vs permit_1: ' + sPile.score + ' (gate ' + sPile.gate + ')');
  ok('C1 the one-sample fingerprint scores BELOW the threshold on a same-form document (finding B: the filled-in words)', sOne.score != null && sOne.score < 80);
  ok('C2 the pile vocabulary scores ≥ 80 on the same document AND the fingerprint gate passed', sPile.score >= 80 && sPile.gate === 'fingerprint_match');
  var m1 = await api('POST', '/redaction-templates/match', { file_id: f1 });
  ok('C3 /match now finds the approved template for permit_1', m1.body.matched === true && m1.body.template.id === tP.id && m1.body.template.score >= 80);
  var f5 = await up(root + '/Permits/permit_5.pdf', reqId);
  var chk = await api('POST', '/redaction-templates/' + tP.id + '/apply-batch', { file_ids: [f1, f5], commit: false });
  ok('C4 apply-batch (check only) passes both same-form documents', chk.status === 200 && chk.body.summary.passing === 2);

  console.log('\n=== D. FINDING C: vocabulary cannot tell the two notices apart — the census fingerprint veto can ===');
  var s0 = await up(root + '/Notices/std_0.pdf', reqId), s4 = await up(root + '/Notices/std_4.pdf', reqId), e0 = await up(root + '/Notices/ext_0.pdf', reqId);
  await docProcessing.processFile(s0); await docProcessing.processFile(s4); await docProcessing.processFile(e0);
  var d1 = await api('POST', '/redaction-templates', { name: 'TS standard notice ' + TAG, source_file_id: s0, record_type_id: stdRT, zones: [{ page_no: 1, x: 0.3, y: 0.17, w: 0.3, h: 0.03, rule_id: rPhone, label: 'inspector' }] });
  var tS = d1.body.template;
  ok('D1 a supervisor\'s save is ACTIVE at once, with the standard pile\'s signature + vocabulary', d1.status === 200 && tS.status === 'active' && !!tS.census_signature && tS.vocabulary_source === 'pile');
  ok('D1b a save that names no layout class leaves the variant UNKNOWN — the census only proposes (D7), it never sets silently', (await db.get('SELECT layout_class FROM record_types WHERE id = ?', [stdRT])).layout_class === null && d1.body.layout_class === 'static');
  var tSrow = await db.get('SELECT * FROM layout_profiles WHERE id = ?', [tS.id]);
  var vocabOnly = { layout_fingerprint: tSrow.layout_fingerprint, census_signature: null, safety_threshold: 80 };
  var vExt = await engine.safetyScore(vocabOnly, e0), gExt = await engine.safetyScore(tSrow, e0), gStd = await engine.safetyScore(tSrow, s4);
  console.log('      standard-notice vocabulary vs EXTENDED notice: ' + vExt.score + ' (vocabulary alone)  → gated: ' + gExt.score + ' (' + gExt.gate + ')   vs another STANDARD: ' + gStd.score + ' (' + gStd.gate + ')');
  ok('D2 vocabulary ALONE would have passed the extended notice (≥ 80) — the burn finding C predicts', vExt.score >= 80);
  ok('D3 the gated template VETOES the extended notice (score 0, fingerprint_veto)', gExt.score === 0 && gExt.gate === 'fingerprint_veto');
  ok('D4 and still matches another standard notice (gate passed, ≥ 80)', gStd.gate === 'fingerprint_match' && gStd.score >= 80);
  var mb = (await api('POST', '/redaction-templates/match-batch', { file_ids: [s4, e0] })).body.matches;
  ok('D5 match-batch agrees: standard matched, extended not', mb[s4] && mb[s4].matched === true && mb[s4].template.id === tS.id && mb[e0] && mb[e0].matched === false);
  var ab = await api('POST', '/redaction-templates/' + tS.id + '/apply-batch', { file_ids: [s4, e0], commit: false });
  var rExt = ab.body.results.find(function (r) { return r.file_id === e0; }), rStd = ab.body.results.find(function (r) { return r.file_id === s4; });
  ok('D6 apply-batch check: the extended notice FAILS the safety check, the standard one passes', rExt && rExt.pass === false && rStd && rStd.pass === true);

  console.log('\n=== E. THE CLASSES: content class from rules × layout; layout class editable on the variant; floating HOLDS ===');
  var seeding = require('/opt/optimumq/backend/src/services/templateSeeding');
  var titles = {}; titles[rSsn] = 'Social Security Numbers'; titles[rPhone] = 'Telephone Numbers'; titles[rAtty] = 'Attorney-Client Privileged';
  ok('E1 detector-backed rules → simple; a judgment rule on a non-static layout → complex; the same judgment rule on a STATIC layout → simple (a fixed box needs no reading)',
    seeding.contentClass([{ rule_id: rSsn }, { rule_id: rPhone }], titles, 'floating') === 'simple' && seeding.contentClass([{ rule_id: rSsn }, { rule_id: rAtty }], titles, 'floating') === 'complex' && seeding.contentClass([{ rule_id: rAtty }], titles, 'static') === 'simple' && seeding.contentClass([{ rule_id: null }], titles, null) === 'complex');
  var pe = await api('PATCH', '/taxonomy/record-types/' + extRT, { layout_class: 'bogus' });
  ok('E2 the variant refuses a bogus layout class (422)', pe.status === 422);
  var e1 = await api('POST', '/redaction-templates', { name: 'TS extended floating ' + TAG, source_file_id: e0, record_type_id: extRT, layout_class: 'floating', zones: [{ page_no: 1, x: 0.3, y: 0.17, w: 0.3, h: 0.03, rule_id: rAtty, label: 'privileged' }] });
  inv = await inventory(repoId); var er = row(extG.id);
  ok('E3 a template saved with layout_class floating writes it to the variant; the row reads "holds for review"; content class complex', e1.status === 200 && e1.body.template.content_class === 'complex' && er.layout_class === 'floating' && er.redaction === 'holds');
  var pe2 = await api('PATCH', '/taxonomy/record-types/' + extRT, { layout_class: 'static' });
  inv = await inventory(repoId); er = row(extG.id);
  ok('E4 setting the variant to static turns the row into "template ready" (editable on the variant, §2a)', pe2.status === 200 && er.layout_class === 'static' && er.redaction === 'template_ready');
  var tl = (await api('GET', '/taxonomy/record-types')).body.record_types.find(function (t) { return t.id === extRT; });
  ok('E5 the taxonomy list carries layout_class and the estimate chip ("none yet")', tl && tl.layout_class === 'static' && tl.estimate && tl.estimate.state === 'none');

  console.log('\n=== F. kind=content: an ad-hoc type gets a rule set, never a mass-apply ===');
  var adhoc = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'TS Letters ' + TAG, code: 'tsl-' + TAG, parent_record_type_id: bucket.id })).body;
  var c0 = await api('POST', '/redaction-templates', { name: 'TS letters content ' + TAG, kind: 'content', record_type_id: adhoc.id, rule_ids: [] }, WORKER);
  ok('F1 a content profile needs its rules (400)', c0.status === 400);
  var c1 = await api('POST', '/redaction-templates', { name: 'TS letters content ' + TAG, kind: 'content', record_type_id: adhoc.id, rule_ids: [rAtty, rSsn], source_file_id: f0 }, WORKER);
  var tC = c1.body && c1.body.template;
  ok('F2 a worker\'s content profile activates DIRECTLY (it burns nothing): active, rule_ids kept, complex, layout adhoc', c1.status === 200 && tC && tC.status === 'active' && JSON.parse(tC.rule_ids).length === 2 && tC.content_class === 'complex' && c1.body.layout_class === 'adhoc');
  var m2 = await api('POST', '/redaction-templates/match', { file_id: f5 });
  var m3 = (await api('POST', '/redaction-templates/match-batch', { file_ids: [f5] })).body.matches[f5];
  ok('F3 a content profile is never returned by /match or /match-batch (permit_5 still finds the permit template only)', m2.body.template.id === tP.id && m3.template.id === tP.id);
  var ab2 = await api('POST', '/redaction-templates/' + tC.id + '/apply-batch', { file_ids: [f5], commit: true });
  ok('F4 apply-batch on a content profile is refused (no zones)', ab2.status === 400);
  var detC = await require('/opt/optimumq/backend/src/services/sourceCensus').redactionPosture(await db.get('SELECT * FROM record_types WHERE id = ?', [adhoc.id]));
  ok('F5 the posture for the type reads "assisted"', detC === 'assisted');

  console.log('\n=== G. RETURN a proposal; D5 retroactive adoption for legacy templates; provisional labelling ===');
  var g1 = await api('POST', '/redaction-templates', { name: 'TS second proposal ' + TAG, source_file_id: f5, record_type_id: permitRT, propose: true, zones: zonesSimple }, WORKER);
  var tQ = g1.body.template;
  var rt0 = await api('POST', '/redaction-templates/' + tQ.id + '/return', { note: 'box 2 covers the parcel, not the phone' });
  var tQ2 = await db.get('SELECT status, review_note FROM layout_profiles WHERE id = ?', [tQ.id]);
  inv = await inventory(repoId); pr = row(permitG.id);
  ok('G1 returned with the note; the row is unchanged (the approved template still stands); a returned row never counts', rt0.status === 200 && tQ2.status === 'returned' && /parcel/.test(tQ2.review_note) && pr.redaction === 'template_ready' && pr.redaction_detail.proposed.length === 0);
  var legacyId = 'lp-legacy-' + TAG;
  await db.run("INSERT INTO layout_profiles (id, name, record_type_id, zones, kind, source, status, source_file_id, layout_fingerprint, safety_threshold, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [legacyId, 'TS legacy ' + TAG, permitRT, JSON.stringify(zonesSimple), 'pages', 'manual', 'active', f0, oneFile, 80, 'u-kruss']);
  var before = (await api('GET', '/redaction-templates')).body.templates.find(function (t) { return t.id === legacyId; });
  var bf = await seeding.backfillSignatures();
  var after = await db.get('SELECT * FROM layout_profiles WHERE id = ?', [legacyId]);
  var sAfter = await engine.safetyScore(after, f1);
  ok('G2 a legacy template (one-file vocabulary, no signature) is listed PROVISIONAL; the boot backfill adopts the pile: signature set, vocabulary pile, and it now matches permit_1 ≥ 80',
    before && before.provisional === true && bf.adopted >= 1 && !!after.census_signature && after.vocabulary_source === 'pile' && sAfter.score >= 80 && sAfter.gate === 'fingerprint_match');
  var orphanRT = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'TS Uncensused ' + TAG, code: 'tsu-' + TAG })).body;
  var orphanId = 'lp-orphan-' + TAG;
  await db.run("INSERT INTO layout_profiles (id, name, record_type_id, zones, kind, source, status, source_file_id, layout_fingerprint, safety_threshold, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [orphanId, 'TS orphan ' + TAG, orphanRT.id, JSON.stringify(zonesSimple), 'pages', 'manual', 'active', f0, oneFile, 80, 'u-kruss']);
  await seeding.backfillSignatures();
  var orphan = await db.get('SELECT * FROM layout_profiles WHERE id = ?', [orphanId]);
  var orphanS = await engine.safetyScore(orphan, f0);
  ok('G3 a template whose type was never censused stays provisional (no signature) and matches on vocabulary alone, gate not applied', !orphan.census_signature && orphanS.gate === null && orphanS.score === 100);

  console.log('\n=== H. THE ESTIMATE COLUMN (read-only in S1; S3 teaches it) ===');
  await db.run("INSERT INTO record_type_estimate_profiles (record_type_id, quantities_json, stats_json, sample_size, has_expert_seed, source) VALUES (?,?,?,?,?,?)", [bucket.id, '{}', '{}', 2, 0, 'sample']);
  inv = await inventory(repoId); pr = row(permitG.id);
  var tlist = (await api('GET', '/taxonomy/record-types')).body.record_types;
  var tb = tlist.find(function (t) { return t.id === bucket.id; }), tv = tlist.find(function (t) { return t.id === permitRT; });
  ok('H1 the bucket learned from 2 requests: its own row says so; the variant\'s inventory row and taxonomy chip INHERIT it', tb.estimate.state === 'learned' && tb.estimate.n === 2 && !tb.estimate.inherited && tv.estimate.state === 'learned' && tv.estimate.inherited === true && pr.estimate.state === 'learned' && pr.estimate.n === 2 && pr.estimate.inherited === true);
  await db.run("INSERT INTO record_type_estimate_profiles (record_type_id, quantities_json, stats_json, sample_size, has_expert_seed, source) VALUES (?,?,?,?,?,?)", [permitRT, '{}', '{}', 0, 1, 'expert']);
  inv = await inventory(repoId); pr = row(permitG.id);
  ok('H2 an expert seed on the variant itself reads "seeded", own row', pr.estimate.state === 'seeded' && pr.estimate.inherited === false);

  console.log('\n=== I. LEAVE THE WORLD AS FOUND ===');
  await db.run("DELETE FROM layout_profiles WHERE id IN (?,?,?,?,?,?,?)", [tP.id, tS.id, e1.body.template.id, tC.id, tQ.id, legacyId, orphanId]);
  await db.run("DELETE FROM processing_history WHERE entity_type = 'layout_profile' AND entity_id IN (?,?,?,?,?)", [tP.id, tS.id, e1.body.template.id, tC.id, tQ.id]);
  await db.run('DELETE FROM record_type_estimate_profiles WHERE record_type_id IN (?,?)', [bucket.id, permitRT]);
  for (var u of uploaded) { await db.run('DELETE FROM document_pages WHERE file_id = ?', [u.id]); await db.run('DELETE FROM request_files WHERE id = ?', [u.id]); try { fs.unlinkSync(path.join(UPLOAD_DIR, u.filename)); } catch (e) {} }
  await db.run("DELETE FROM request_history WHERE request_id = ?", [reqId]).catch(function () {});
  await db.run('DELETE FROM requests WHERE id = ?', [reqId]);
  await db.run('DELETE FROM document_fingerprints WHERE repository_id = ?', [repoId]);
  await db.run('DELETE FROM census_groupings WHERE repository_id = ?', [repoId]);
  await db.run('DELETE FROM source_census_runs WHERE repository_id = ?', [repoId]);
  var rts = [permitRT, stdRT, extRT, adhoc.id, orphanRT.id, bucket.id];
  await db.run('DELETE FROM record_type_repositories WHERE record_type_id IN (' + rts.map(function () { return '?'; }).join(',') + ')', rts);
  await db.run('DELETE FROM taxonomy_audit WHERE entity_id IN (' + rts.map(function () { return '?'; }).join(',') + ')', rts);
  await db.run('DELETE FROM record_repositories WHERE id = ?', [repoId]);
  for (var idd of rts) { await api('DELETE', '/taxonomy/record-types/' + idd); }
  await db.run('DELETE FROM redaction_rules WHERE id IN (?,?,?)', [rSsn, rPhone, rAtty]);
  await db.run('DELETE FROM user_user_types WHERE user_id = ?', [workerId]);
  await db.run('DELETE FROM users WHERE id IN (?,?)', [workerId, staffId]);
  fs.rmSync(root, { recursive: true, force: true });
  var l1 = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE '%' || ? OR name LIKE '%' || ?", [TAG, TAG]);
  var l2 = await db.get("SELECT count(*)::int AS n FROM layout_profiles WHERE name LIKE '%' || ?", [TAG]);
  var l3 = await db.get('SELECT count(*)::int AS n FROM document_fingerprints WHERE repository_id = ?', [repoId]);
  ok('I1 all fixture rows and files are gone', Number(l1.n) === 0 && Number(l2.n) === 0 && Number(l3.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
