'use strict';
// CENSUS ASSOCIATION + THE THREE DOORS — inventory build slice 3 (2026-09-15). Design: DESIGN_setup_flow_map.md §3
// step 3, mockups/inventory_census (Associate · Sample · NoRedaction), HANDOFF 2026-09-15 (b).
//
// WHAT THIS PREVENTS: a census or a suggestion writing into taxonomy (only the human approval does); an association
// that stamps documents but forgets the source link or the signature; "Redact by hand" being anything other than the
// honest Mass Redaction dismiss; "No redaction needed" opening when the bucket's legal gate is on or the bucket is
// Restricted/Confidential, or without a reason; a decision that cannot be undone; a non-elevated user reaching any door.
// The AI suggestion is probed live, never in the suite.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var { PDFDocument, StandardFonts } = require('/opt/optimumq/backend/node_modules/pdf-lib');

var pass = 0, fail = 0, TOKEN = null, STAFF = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'CA' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function api(method, path, body, token) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: Object.assign({ Authorization: 'Bearer ' + (token || TOKEN) }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function makePermit(file, name, parcel) {
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]); var font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('BUILDING PERMIT APPLICATION', { x: 72, y: 740, size: 16, font: font });
  page.drawText('Applicant:', { x: 72, y: 700, size: 12, font: font }); page.drawText(name, { x: 170, y: 700, size: 12, font: font });
  page.drawText('Parcel:', { x: 72, y: 676, size: 12, font: font }); page.drawText(parcel, { x: 170, y: 676, size: 12, font: font });
  page.drawText('Address:', { x: 72, y: 652, size: 12, font: font }); page.drawText('123 Main St', { x: 170, y: 652, size: 12, font: font });
  page.drawText('City of Autumn Falls - Permit Office', { x: 72, y: 60, size: 10, font: font });
  fs.writeFileSync(file, await pdf.save());
}
async function makeInspection(file, inspector) {
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]); var font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('FIRE INSPECTION REPORT', { x: 180, y: 752, size: 14, font: font });
  page.drawText('Inspector:', { x: 72, y: 690, size: 12, font: font }); page.drawText(inspector, { x: 180, y: 690, size: 12, font: font });
  page.drawText('Date:', { x: 72, y: 664, size: 12, font: font }); page.drawText('01/12/2026', { x: 180, y: 664, size: 12, font: font });
  page.drawText('Findings:', { x: 72, y: 610, size: 12, font: font }); page.drawText('No violations observed during walkthrough.', { x: 72, y: 586, size: 11, font: font });
  page.drawText('Fire Marshal Division', { x: 72, y: 90, size: 10, font: font });
  fs.writeFileSync(file, await pdf.save());
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function censusDone(repoId) { for (var k = 0; k < 240; k++) { var st = (await api('GET', '/repositories/' + repoId + '/census')).body; if (!st.current) return st.last; await sleep(400); } return null; }
async function inventory(repoId) { return (await api('GET', '/repositories/' + repoId + '/inventory')).body; }

(async function () {
  await db.initDb();
  TOKEN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var staffId = 'u-ca-none-' + TAG;
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [staffId, 'ca-none-' + TAG + '@test.optimumq.ai', 'CA none', 'Test ' + TAG]);
  STAFF = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [staffId]));
  var cat = await db.get('SELECT id FROM categories ORDER BY sort_order LIMIT 1');

  var root = '/tmp/ca-drive-' + TAG;
  fs.mkdirSync(root + '/Permits', { recursive: true }); fs.mkdirSync(root + '/Inspections', { recursive: true });
  for (var i = 0; i < 6; i++) await makePermit(root + '/Permits/permit_' + i + '.pdf', 'Applicant ' + i, '202' + i + '-0' + (100 + i));
  for (var j = 0; j < 4; j++) await makeInspection(root + '/Inspections/report_' + j + '.pdf', 'Inspector ' + j);
  var repoId = 'repo-ca-' + TAG;
  await db.run("INSERT INTO record_repositories (id, name, connector_type, status, config) VALUES (?,?,?,?,?)", [repoId, 'CA Drive ' + TAG, 'filestore', 'active', JSON.stringify({ path: root })]);
  await api('POST', '/repositories/' + repoId + '/census'); await censusDone(repoId);
  var inv = await inventory(repoId);
  var gs = inv.groupings.slice().sort(function (a, b) { return b.member_count - a.member_count; });
  var permitG = gs[0], reportG = gs[1];
  var bucket = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'CA Bucket ' + TAG, code: 'cab-' + TAG })).body;
  var rtBefore = await db.get('SELECT count(*)::int AS n FROM record_types');
  var G = '/repositories/' + repoId + '/groupings/';

  console.log('\n=== A. GATES ===');
  ok('A0 the census left two unassociated groupings (6 and 4)', gs.length === 2 && permitG.member_count === 6 && reportG.member_count === 4 && !permitG.record_type && !reportG.record_type);
  var g1 = await api('POST', G + reportG.id + '/associate', { mode: 'existing', record_type_id: bucket.id }, STAFF);
  var g2 = await api('POST', G + reportG.id + '/redact-by-hand', null, STAFF);
  var g3 = await api('POST', G + reportG.id + '/no-redaction', { reason: 'nothing personal in these' }, STAFF);
  var g4 = await api('POST', G + reportG.id + '/suggest', null, STAFF);
  ok('A1 a non-elevated user is refused at every door (403 ×4)', g1.status === 403 && g2.status === 403 && g3.status === 403 && g4.status === 403);
  var c0 = await api('GET', G + reportG.id + '/catalog');
  ok('A2 the catalog for the dropdowns lists buckets and variants', c0.status === 200 && Array.isArray(c0.body.buckets) && c0.body.buckets.some(function (b) { return b.id === bucket.id; }));
  var bad = await api('POST', G + reportG.id + '/associate', { mode: 'existing', record_type_id: 'rt-nope' });
  var bad2 = await api('POST', G + reportG.id + '/associate', { mode: 'new_variant', parent_record_type_id: bucket.id, name: '' });
  var bad3 = await api('POST', G + 'grp-nope/associate', { mode: 'existing', record_type_id: bucket.id });
  ok('A3 garbage is refused: unknown type 422, empty name 422, unknown grouping 404', bad.status === 422 && bad2.status === 422 && bad3.status === 404);
  var rtMid = await db.get('SELECT count(*)::int AS n FROM record_types');
  ok('A4 nothing was written by the refused calls', rtMid.n === rtBefore.n);

  console.log('\n=== B. ASSOCIATE — existing type: the approval writes stamps, link, signature ===');
  var a1 = await api('POST', G + reportG.id + '/associate', { mode: 'existing', record_type_id: bucket.id });
  ok('B1 association accepted, 4 documents', a1.status === 200 && a1.body.documents === 4 && a1.body.record_type.id === bucket.id);
  var stamped = await db.get('SELECT count(*)::int AS n FROM document_fingerprints WHERE grouping_id = ? AND matched_record_type_id = ?', [reportG.id, bucket.id]);
  var link = await db.get('SELECT 1 AS ok FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?', [bucket.id, repoId]);
  var meta = JSON.parse((await db.get('SELECT discovery_meta FROM record_types WHERE id = ?', [bucket.id])).discovery_meta || '{}');
  ok('B2 the 4 documents are stamped, the type↔source link exists, the signature is stored for recognition', Number(stamped.n) === 4 && !!link && !!meta.signature);
  inv = await inventory(repoId);
  var rG = inv.groupings.find(function (g) { return g.id === reportG.id; });
  ok('B3 the inventory shows the grouping associated to the bucket; posture "none" (not a mass-redaction candidate)', rG && rG.record_type && rG.record_type.id === bucket.id && rG.redaction === 'none');
  var aud = await db.get("SELECT count(*)::int AS n FROM taxonomy_audit WHERE entity_id = ? AND action = 'census_associate_existing'", [bucket.id]);
  ok('B4 the decision is in taxonomy_audit', Number(aud.n) === 1);
  var dup = await api('POST', G + reportG.id + '/associate', { mode: 'existing', record_type_id: bucket.id });
  ok('B5 associating an associated grouping is refused (409)', dup.status === 409);
  var un = await api('DELETE', G + reportG.id + '/associate');
  var unst = await db.get('SELECT count(*)::int AS n FROM document_fingerprints WHERE grouping_id = ? AND matched_record_type_id IS NOT NULL', [reportG.id]);
  var link2 = await db.get('SELECT 1 AS ok FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?', [bucket.id, repoId]);
  inv = await inventory(repoId); rG = inv.groupings.find(function (g) { return g.id === reportG.id; });
  ok('B6 undo: documents unstamped, the source link removed (no other documents carry the type here), grouping unassociated — same id', un.status === 200 && Number(unst.n) === 0 && !link2 && rG && !rG.record_type);

  console.log('\n=== C. ASSOCIATE — new draft variant under a bucket ===');
  var a2 = await api('POST', G + permitG.id + '/associate', { mode: 'new_variant', parent_record_type_id: bucket.id, name: 'CA Permit Applications ' + TAG, intent: 'Permit application forms' });
  ok('C1 accepted; a record type came back', a2.status === 200 && a2.body.record_type && a2.body.record_type.parent_record_type_id === bucket.id);
  var variant = await db.get('SELECT * FROM record_types WHERE id = ?', [a2.body.record_type.id]);
  var vmeta = JSON.parse(variant.discovery_meta || '{}');
  ok('C2 the variant is a DRAFT (activation stays the human act), source discovered, mass-redaction candidate, counted 6, signature stored',
    variant.status === 'draft' && variant.source === 'discovered' && variant.mass_redaction_candidate === 1 && vmeta.counted === true && vmeta.estimated_count === 6 && !!vmeta.signature);
  var vst = await db.get('SELECT count(*)::int AS n FROM document_fingerprints WHERE matched_record_type_id = ?', [variant.id]);
  var vlink = await db.get('SELECT repository_id FROM record_type_repositories WHERE record_type_id = ?', [variant.id]);
  ok('C3 6 documents stamped; the variant is linked to exactly this source', Number(vst.n) === 6 && vlink && vlink.repository_id === repoId);
  inv = await inventory(repoId); var pG = inv.groupings.find(function (g) { return g.id === permitG.id; });
  ok('C4 inventory: associated, posture "waiting" (candidate, no redaction template yet), draft', pG && pG.record_type && pG.record_type.id === variant.id && pG.redaction === 'waiting' && pG.record_type.status === 'draft');
  var opp = (await api('GET', '/redaction-templates/opportunities')).body.opportunities;
  ok('C5 Mass Redaction lists it as waiting for a redaction template', opp.some(function (o) { return o.record_type_id === variant.id; }));
  await makePermit(root + '/Permits/permit_new.pdf', 'Late Applicant', '2026-0777');
  await api('POST', '/repositories/' + repoId + '/census'); await censusDone(repoId);
  inv = await inventory(repoId); pG = inv.groupings.find(function (g) { return g.id === permitG.id; });
  ok('C6 the next census recognises the new document by signature: same grouping id, still associated, 7 documents', pG && pG.record_type && pG.record_type.id === variant.id && pG.member_count === 7);

  console.log('\n=== D. REDACT BY HAND — the honest dismiss, reversible ===');
  var rb = await api('POST', G + permitG.id + '/redact-by-hand');
  var v2 = await db.get('SELECT mass_redaction_candidate, discovery_meta FROM record_types WHERE id = ?', [variant.id]);
  inv = await inventory(repoId); pG = inv.groupings.find(function (g) { return g.id === permitG.id; });
  ok('D1 posture "redact_by_hand", the mass-redaction flag cleared, who/when recorded', rb.status === 200 && v2.mass_redaction_candidate === 0 && !!JSON.parse(v2.discovery_meta).redact_by_hand && pG.redaction === 'redact_by_hand' && pG.decisions.redact_by_hand);
  var opp2 = (await api('GET', '/redaction-templates/opportunities')).body.opportunities;
  ok('D2 Mass Redaction no longer lists it', !opp2.some(function (o) { return o.record_type_id === variant.id; }));
  var rbu = await api('DELETE', G + permitG.id + '/redact-by-hand');
  inv = await inventory(repoId); pG = inv.groupings.find(function (g) { return g.id === permitG.id; });
  ok('D3 undo restores "waiting" and the candidate flag', rbu.status === 200 && pG.redaction === 'waiting');
  var rbNo = await api('POST', G + reportG.id + '/redact-by-hand');
  ok('D4 an unassociated grouping cannot be marked (422)', rbNo.status === 422);

  console.log('\n=== E. NO REDACTION NEEDED — a guarded release decision ===');
  var chk = await api('GET', G + permitG.id + '/no-redaction/check');
  ok('E1 the check passes: legal gate off, bucket review_required, not yet decided', chk.status === 200 && chk.body.allowed === true && chk.body.checks.length === 3 && chk.body.checks.every(function (c) { return c.passes; }));
  var nr0 = await api('POST', G + permitG.id + '/no-redaction', { reason: 'short' });
  ok('E2 a missing or one-word reason is refused (400)', nr0.status === 400);
  await db.run('UPDATE record_types SET legal_redaction_required = 1 WHERE id = ?', [bucket.id]);
  var chk2 = await api('GET', G + permitG.id + '/no-redaction/check');
  var nr1 = await api('POST', G + permitG.id + '/no-redaction', { reason: 'Inspection reports carry no personal information at all.' });
  ok('E3 with the PARENT bucket\'s legal gate ON the door is closed: check not allowed, POST 422 naming the gate', chk2.body.allowed === false && nr1.status === 422 && /legal/i.test(nr1.body.error));
  await db.run('UPDATE record_types SET legal_redaction_required = 0, public_availability = ? WHERE id = ?', ['restricted', bucket.id]);
  var nr2 = await api('POST', G + permitG.id + '/no-redaction', { reason: 'Inspection reports carry no personal information at all.' });
  ok('E4 a Restricted bucket closes the door (422)', nr2.status === 422 && /restricted|confidential/i.test(nr2.body.error));
  await db.run('UPDATE record_types SET public_availability = ? WHERE id = ?', ['review_required', bucket.id]);
  var before = await db.get('SELECT public_availability, auto_release_eligible FROM record_types WHERE id = ?', [variant.id]);
  var nr3 = await api('POST', G + permitG.id + '/no-redaction', { reason: 'Permit applications carry no personal information — permit number and address only — and are already published on the permit portal.' });
  var after = await db.get('SELECT public_availability, auto_release_eligible, discovery_meta FROM record_types WHERE id = ?', [variant.id]);
  var am = JSON.parse(after.discovery_meta || '{}');
  ok('E5 confirmed: the variant is Releasable + auto-release on; who/when/reason and the previous posture are recorded', nr3.status === 200 && after.public_availability === 'releasable' && after.auto_release_eligible === 1 && am.no_redaction && am.no_redaction.reason.length > 10 && am.no_redaction.prev.public_availability === before.public_availability);
  inv = await inventory(repoId); pG = inv.groupings.find(function (g) { return g.id === permitG.id; });
  ok('E6 the inventory shows "no_redaction" with the decision', pG.redaction === 'no_redaction' && pG.decisions.no_redaction && pG.decisions.no_redaction.by_name);
  var aud2 = await db.get("SELECT count(*)::int AS n FROM taxonomy_audit WHERE entity_id = ? AND action = 'no_redaction_needed'", [variant.id]);
  ok('E7 recorded in taxonomy_audit', Number(aud2.n) === 1);
  var chk3 = await api('GET', G + permitG.id + '/no-redaction/check');
  ok('E8 the check now reports "already decided" (not allowed twice)', chk3.body.allowed === false && chk3.body.current);
  var undo = await api('DELETE', G + permitG.id + '/no-redaction');
  var restored = await db.get('SELECT public_availability, auto_release_eligible FROM record_types WHERE id = ?', [variant.id]);
  inv = await inventory(repoId); pG = inv.groupings.find(function (g) { return g.id === permitG.id; });
  ok('E9 undo restores the previous posture exactly; grouping back to "waiting"', undo.status === 200 && restored.public_availability === before.public_availability && restored.auto_release_eligible === before.auto_release_eligible && pG.redaction === 'waiting');

  console.log('\n=== G. FIND VARIANTS reads the census store (no scan, no model call when nothing is left to name) ===');
  var fv0 = await api('POST', '/taxonomy/record-types/' + bucket.id + '/discover-variants');
  ok('G1 a bucket linked to no source is refused in words that point at the census', fv0.status === 422 && /No censused documents/.test(fv0.body.error));
  var repoNever = 'repo-ca-never-' + TAG; var rootNever = '/tmp/ca-never-' + TAG; fs.mkdirSync(rootNever);
  await db.run("INSERT INTO record_repositories (id, name, connector_type, status, config) VALUES (?,?,?,?,?)", [repoNever, 'CA Never Censused ' + TAG, 'filestore', 'active', JSON.stringify({ path: rootNever })]);
  await db.run("INSERT INTO record_type_repositories (id, record_type_id, repository_id, format, filter_spec, sort_order) VALUES (?,?,?,?,?,?)", ['rr-ca-n-' + TAG, bucket.id, repoNever, 'document', '{}', 100]);
  var fv1 = await api('POST', '/taxonomy/record-types/' + bucket.id + '/discover-variants');
  ok('G2 a bucket whose only source has never been censused is refused and the source is named', fv1.status === 422 && /never|no census|has had a census/i.test(fv1.body.error) && fv1.body.error.indexOf('CA Never Censused') !== -1);
  // Associate the report grouping to the bucket itself so nothing unassociated remains → no naming call is needed.
  var aG = await api('POST', G + reportG.id + '/associate', { mode: 'existing', record_type_id: bucket.id });
  var fv2 = await api('POST', '/taxonomy/record-types/' + bucket.id + '/discover-variants');
  ok('G3 with the censused source linked (by that approval) the answer comes from the census: method census, exact counts', aG.status === 200 && fv2.status === 200 && fv2.body.method === 'census' && fv2.body.repos.indexOf('CA Drive ' + TAG) !== -1 && fv2.body.sampled === 11 && fv2.body.totalDocuments === 11);
  var recV = (fv2.body.recognized || []).find(function (r) { return r.record_type_id === variant.id; });
  var recB = (fv2.body.recognized || []).find(function (r) { return r.record_type_id === bucket.id; });
  ok('G4 recognized: the variant with 7 documents (no redaction template yet) and the bucket with 4', recV && recV.count === 7 && recV.template_ready === false && recB && recB.count === 4);
  ok('G5 nothing left to name → no groupings proposed (and so no model call); the never-censused source is listed as such', fv2.body.groupings.length === 0 && fv2.body.not_censused.indexOf('CA Never Censused ' + TAG) !== -1);
  ok('G6 the retired Scan source endpoint is gone (404)', (await api('POST', '/taxonomy/discover-scan', { repository_id: repoId })).status === 404);
  await db.run('DELETE FROM record_type_repositories WHERE repository_id = ?', [repoNever]); await db.run('DELETE FROM record_repositories WHERE id = ?', [repoNever]); fs.rmSync(rootNever, { recursive: true, force: true });

  console.log('\n=== F. LEAVE THE WORLD AS FOUND ===');
  await db.run('DELETE FROM document_fingerprints WHERE repository_id = ?', [repoId]);
  await db.run('DELETE FROM census_groupings WHERE repository_id = ?', [repoId]);
  await db.run('DELETE FROM source_census_runs WHERE repository_id = ?', [repoId]);
  await db.run('DELETE FROM record_type_repositories WHERE record_type_id IN (?,?)', [variant.id, bucket.id]);
  await db.run('DELETE FROM taxonomy_audit WHERE entity_id IN (?,?)', [variant.id, bucket.id]);
  await db.run('DELETE FROM record_repositories WHERE id = ?', [repoId]);
  for (var idd of [variant.id, bucket.id]) { await api('DELETE', '/taxonomy/record-types/' + idd); }
  await db.run('DELETE FROM users WHERE id = ?', [staffId]);
  fs.rmSync(root, { recursive: true, force: true });
  var l1 = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE '%' || ? OR name LIKE '%' || ?", [TAG, TAG]);
  var l2 = await db.get('SELECT count(*)::int AS n FROM document_fingerprints WHERE repository_id = ?', [repoId]);
  ok('F1 all fixture rows and files are gone', Number(l1.n) === 0 && Number(l2.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
