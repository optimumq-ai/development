'use strict';
// RECORD VERIFICATION, PART A — certification finished (SPEC_record_verification.md §2, §5, §6).
// What this harness asserts:
//
//   A. CERTIFICATION IS A PARENT FACT (§2.1). A certified portal submission writes the opt-in on the
//      PARENT and a forced 0 on every child (exactly like is_mrr) — the copy-down that let per-child
//      estimates price certification once per child is gone.
//   B. THE ESTIMATE READS THROUGH THE PARENT. A child-keyed estimate context still reports
//      certification.requested — the opt-in is never silently dropped from a work-row estimate.
//   C. THE INTEGRITY ANCHOR (§2.2). A release through the real bypass writer records content_sha256 =
//      the SHA-256 of the exact stored file (asserted against an independent hash), and the derived
//      verification code has the typeable form. All three fulfilled_records writers name the column
//      (source-scan completeness — the other two writers need the full page-image pipeline to invoke).
//   D. THE SHEET (§2.3–§2.4). Generated at parent-Complete, exactly once, listing certified records AND
//      non-delivering children; sent regardless of the last child's disposition; never generated for an
//      uncertified request.
//   E. THE PUBLISHED GATE (§5). GET /api/public/file/:id refuses a released-but-unpublished record
//      (released-to-requestor ≠ public) and serves it once published.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var fileHash = require('/opt/optimumq/backend/src/services/fileHash');
var bypass = require('/opt/optimumq/backend/src/services/redactionBypass');
var disposition = require('/opt/optimumq/backend/src/services/disposition');
var sheet = require('/opt/optimumq/backend/src/services/certificationSheet');
var uuidv4 = require('/opt/optimumq/backend/node_modules/uuid').v4;

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'RV-' + Date.now();
var UPLOADS = '/opt/optimumq/uploads';
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, p, body, raw) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method, headers: headers }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j, raw: d }); });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

(async function () {
  var cleanupFiles = [];
  try {
    await db.initDb();
    var user = await db.get("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);

    console.log('\n=== A. CERTIFICATION IS A PARENT FACT ===');
    var sub = await req('POST', '/api/public/submit', {
      requestorName: 'Cert Harness', requestorEmail: 'rv-harness@example.com', certificationRequested: true,
      records: [
        { label: 'Permit file', description: 'building permit ' + TAG },
        { label: 'Council minutes', description: 'minutes ' + TAG }
      ]
    });
    ok('a certified 2-record request submits through the REAL portal path (' + sub.status + ')', sub.status === 201);
    var P = await db.get('SELECT id, certification_requested FROM requests WHERE request_number = ?', [sub.body.requestNumber]);
    var kids = await db.all('SELECT id, child_no, certification_requested FROM requests WHERE master_request_id = ? ORDER BY child_no', [P.id]);
    ok('the PARENT carries the opt-in', Number(P.certification_requested) === 1);
    ok('every child carries a forced 0 — the copy-down that priced certification per child is gone (§2.1)',
      kids.length === 2 && kids.every(function (k) { return Number(k.certification_requested) === 0; }));

    console.log('\n=== B. THE ESTIMATE READS THROUGH THE PARENT ===');
    var est = await req('GET', '/api/fee-estimates/request/' + kids[0].id);
    ok('a CHILD-keyed estimate context still reports the certification the citizen asked for',
      est.status === 200 && est.body.certification && est.body.certification.requested === true &&
      est.body.certification.suggestedCount === 1);

    console.log('\n=== C. THE INTEGRITY ANCHOR ===');
    // A real one-page PDF on disk, then the REAL bypass writer over it.
    var { PDFDocument } = require('/opt/optimumq/backend/node_modules/pdf-lib');
    var doc = await PDFDocument.create(); doc.addPage([612, 792]);
    var bytes = Buffer.from(await doc.save());
    var expected = crypto.createHash('sha256').update(bytes).digest('hex');
    var outName = 'rv-' + TAG + '.pdf';
    fs.writeFileSync(path.join(UPLOADS, outName), bytes);
    cleanupFiles.push(path.join(UPLOADS, outName));
    var outId = 'rf-' + uuidv4().slice(0, 8), srcId = 'rf-' + uuidv4().slice(0, 8);
    await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_at) VALUES (?,?,?,?,?,?,?,datetime('now'))",
      [outId, kids[0].id, outName, 'Permit file.pdf', 'application/pdf', bytes.length, 'redacted']);
    await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_at) VALUES (?,?,?,?,?,?,?,datetime('now'))",
      [srcId, kids[0].id, outName, 'Permit file.pdf', 'application/pdf', bytes.length, 'uploaded']);
    var bp = await bypass.recordBypass(
      { id: srcId, request_id: kids[0].id, original_name: 'Permit file.pdf' },
      { rule: 'clean' },
      { outputFileId: outId, title: 'Permit file', pageCount: 1, published: false },
      { actorName: 'RV Harness' });
    var fr = await db.get('SELECT id, content_sha256, status FROM fulfilled_records WHERE source_file_id = ?', [srcId]);
    ok('the release writer records content_sha256 — and it IS the SHA-256 of the stored file',
      !!bp && !bp.skipped && fr && fr.content_sha256 === expected);
    ok('the derived verification code is the typeable form (first 16 hex, grouped)',
      fileHash.verificationCode(expected) === expected.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-'));
    ok('...and code comparison is dash/case/space-insensitive',
      fileHash.normalizeCode(fileHash.verificationCode(expected)) === expected.slice(0, 16));
    var writers = ['redactionApply', 'structuredRedaction', 'redactionBypass'].map(function (n) {
      return fs.readFileSync('/opt/optimumq/backend/src/services/' + n + '.js', 'utf8');
    });
    ok('all THREE fulfilled_records writers carry the column (source-scan completeness)',
      writers.every(function (s) { return /INSERT INTO fulfilled_records[^;]*content_sha256/.test(s); }));
    // THE TRIAGE RACE (smoke run 5): the triage sweep and a manual apply interleaved within one second and
    // one source file carried TWO released records. One-per-source is a database constraint now.
    var dupHit = false;
    try {
      await db.run("INSERT INTO fulfilled_records (id, request_id, source_file_id, output_file_id, title, status) VALUES (?,?,?,?,?,'released')",
        ['fr-dup-' + TAG, kids[0].id, srcId, outId, 'dup attempt']);
    } catch (eD) { dupHit = /duplicate key|unique/i.test(String(eD && eD.message)); }
    ok('one fulfilled record per source file is a database CONSTRAINT (the smoke run-5 triage race)', dupHit);
    ok('...and every writer upserts on conflict rather than duplicating (source-scan)',
      writers.every(function (s) { return /ON CONFLICT \(source_file_id\)/.test(s); }));

    console.log('\n=== D. THE SHEET, AT PARENT-COMPLETE, REGARDLESS OF THE LAST DISPOSITION ===');
    // The portal submit advances each child through intake IN THE BACKGROUND (classifier → workflow
    // engine). Closing a child while that advance is mid-flight is a stage-transition race that flapped
    // the suite once (1935/1936, 2026-08-12) — so wait for the engine's per-child decision to land first,
    // the verify_mrr_children idiom. The decision row is the deterministic witness that intake finished.
    for (var wD = 0; wD < 80; wD++) {
      var decs = await db.all('SELECT request_id FROM workflow_decisions WHERE request_id = ANY($1::text[])',
        [kids.map(function (k) { return k.id; })]);
      if (decs.length >= 2) break;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    await disposition.close(kids[0].id, 'withdrawn', { skipGate: true, actorName: 'RV Harness', payload: { note: 'harness' } });
    var midSheet = await db.get("SELECT id FROM request_files WHERE request_id = ? AND status = 'certification'", [P.id]);
    ok('no sheet while a child is still open — the sheet covers the WHOLE request', !midSheet);
    await disposition.close(kids[1].id, 'no_records', { skipGate: true, actorName: 'RV Harness', payload: { note: 'harness' } });
    var pRow = await db.get('SELECT status FROM requests WHERE id = ?', [P.id]);
    ok('the parent derived Complete off the last close', pRow.status === 'closed');
    var sheetRow = await db.get("SELECT id, original_name, filename, size FROM request_files WHERE request_id = ? AND status = 'certification'", [P.id]);
    ok('the certification sheet exists on the PARENT — generated even though the LAST child closed no-records',
      !!sheetRow && sheetRow.original_name === 'Certification - ' + sub.body.requestNumber + '.pdf' && Number(sheetRow.size) > 500);
    if (sheetRow) cleanupFiles.push(path.join(UPLOADS, sheetRow.filename));
    var hist = await db.get("SELECT notes FROM request_history WHERE request_id = ? AND action = 'CERTIFICATION_SHEET_GENERATED'", [P.id]);
    ok('...with the act in history, counting certified records AND non-delivering items',
      !!hist && /1 certified record/.test(hist.notes) && /1 item\(s\) closed without/.test(hist.notes));
    var again = await sheet.onParentComplete(P.id);
    var sheetCount = await db.all("SELECT id FROM request_files WHERE request_id = ? AND status = 'certification'", [P.id]);
    ok('idempotent: a second completion never writes a second sheet',
      again.skipped === true && again.reason === 'already_generated' && sheetCount.length === 1);

    // The uncertified control: same path, no opt-in, no sheet.
    var sub2 = await req('POST', '/api/public/submit', {
      requestorName: 'Uncert Harness', requestorEmail: 'rv-uncert@example.com',
      description: 'fire inspection ' + TAG
    });
    var P2 = await db.get('SELECT id FROM requests WHERE request_number = ?', [sub2.body.requestNumber]);
    var k2 = await db.get('SELECT id FROM requests WHERE master_request_id = ?', [P2.id]);
    for (var wD2 = 0; wD2 < 80; wD2++) { // same submit-vs-close race guard as section D
      if ((await db.all('SELECT 1 FROM workflow_decisions WHERE request_id = ?', [k2.id])).length) break;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    await disposition.close(k2.id, 'no_records', { skipGate: true, actorName: 'RV Harness', payload: { note: 'harness' } });
    var noSheet = await db.get("SELECT id FROM request_files WHERE request_id = ? AND status = 'certification'", [P2.id]);
    ok('an UNCERTIFIED request completes with no sheet — certification gates presentation', !noSheet);

    console.log('\n=== F. THE VERIFY LOOKUP STATE MACHINE (§3) ===');
    var fUnknown = await req('POST', '/api/public/verify/lookup', { requestNumber: '2091-999999' });
    ok('an unknown number: "' + fUnknown.body.message + '"',
      fUnknown.body.state === 'no_match' && fUnknown.body.message === 'The number entered has no matching request.');
    var fUncert = await req('POST', '/api/public/verify/lookup', { requestNumber: sub2.body.requestNumber });
    ok('a real but UNCERTIFIED request: "' + fUncert.body.message + '"',
      fUncert.body.state === 'not_certified' && fUncert.body.message === 'Verification is available only for certified records.');
    // A second released record on child 1, a NON-document kind, for the visual gate below.
    var vidRfId = 'rf-' + uuidv4().slice(0, 8);
    var vidSha = crypto.createHash('sha256').update('video-bytes-' + TAG).digest('hex');
    await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_at) VALUES (?,?,?,?,?,?,?,datetime('now'))",
      [vidRfId, kids[0].id, 'rv-video-' + TAG + '.mp4', 'Body camera clip.mp4', 'video/mp4', 100, 'redacted']);
    await db.run("INSERT INTO fulfilled_records (id, request_id, source_file_id, output_file_id, title, status, released_by, released_at, content_sha256) VALUES (?,?,?,?,?,?,?,datetime('now'),?)",
      ['fr-' + uuidv4().slice(0, 8), kids[0].id, vidRfId, vidRfId, 'Body camera clip', 'released', 'RV Harness', vidSha]);
    var fCert = await req('POST', '/api/public/verify/lookup', { requestNumber: sub.body.requestNumber });
    ok('a certified request answers its released records — markers, labels, file kinds',
      fCert.body.state === 'certified' && fCert.body.records.length === 2 &&
      fCert.body.records.some(function (r) { return r.fileKind === 'document'; }) &&
      fCert.body.records.some(function (r) { return r.fileKind === 'other'; }));
    ok('...and never a hash, a file id, or an email',
      fCert.raw.indexOf(expected.slice(0, 12)) < 0 && fCert.raw.indexOf(outId) < 0 && fCert.raw.indexOf('@') < 0);

    console.log('\n=== G. CODE VERIFICATION AND THE CODE-GATED VIEWER (§3, §8.1) ===');
    var goodCode = fileHash.verificationCode(expected);
    var gRight = await req('POST', '/api/public/verify/code', { requestNumber: sub.body.requestNumber, childNo: 1, code: goodCode });
    ok('the right code verifies: "' + gRight.body.message + '"',
      gRight.body.verified === true && gRight.body.fileKind === 'document');
    var gLoose = await req('POST', '/api/public/verify/code', { requestNumber: sub.body.requestNumber, childNo: 1, code: expected.slice(0, 16) });
    ok('entry is dash/case-insensitive (raw lowercase hex verifies too)', gLoose.body.verified === true);
    var gWrong = await req('POST', '/api/public/verify/code', { requestNumber: sub.body.requestNumber, childNo: 1, code: 'AAAA-BBBB-CCCC-DDDD' });
    ok('a wrong code does not: "' + gWrong.body.message + '"',
      gWrong.body.verified === false && gWrong.body.message === 'The code entered does not match this record.');
    var gCross = await req('POST', '/api/public/verify/code', { requestNumber: sub.body.requestNumber, childNo: 2, code: goodCode });
    ok('the right code against the WRONG record does not — the match is scoped', gCross.body.verified === false);
    var vOk = await req('GET', '/api/public/verify-view?number=' + sub.body.requestNumber + '&childNo=1&code=' + goodCode, null);
    ok('number + code opens the visual viewer (the code IS the access key, §8.1)',
      vOk.status === 200 && vOk.raw.slice(0, 4) === '%PDF');
    var vBad = await req('GET', '/api/public/verify-view?number=' + sub.body.requestNumber + '&childNo=1&code=AAAA-BBBB-CCCC-DDDD', null);
    ok('number alone (a wrong code) NEVER opens record content', vBad.status === 404);
    var vVid = await req('GET', '/api/public/verify-view?number=' + sub.body.requestNumber + '&childNo=1&code=' + fileHash.verificationCode(vidSha), null);
    ok('a non-document kind answers in words and points at file verification (Kevin\'s body-cam case)',
      vVid.status === 415 && /documents only/.test(vVid.raw) && /digital file verification/.test(vVid.raw));
    var srcPC = fs.readFileSync('/opt/optimumq/backend/src/routes/publicChat.js', 'utf8');
    ok('all three verify doors open with the rate limiter (source-scan)',
      ["router.post('/verify/lookup'", "router.post('/verify/code'", "router.get('/verify-view'"].every(function (a) {
        var seg = srcPC.slice(srcPC.indexOf(a), srcPC.indexOf(a) + 300);
        return seg.indexOf('checkRate(req.ip)') >= 0;
      }));

    console.log('\n=== E. THE PUBLISHED GATE ON THE PUBLIC FILE DOOR (§5) ===');
    var unpub = await req('GET', '/api/public/file/' + outId, null);
    ok('a released-but-UNPUBLISHED record answers 404 — released-to-requestor is not public', unpub.status === 404);
    await db.run("UPDATE fulfilled_records SET published = 1, published_at = datetime('now'), published_by = 'harness' WHERE id = ?", [fr.id]);
    var pub = await req('GET', '/api/public/file/' + outId, null);
    ok('...and 200 once the city publishes it', pub.status === 200);
  } catch (e) {
    fail++; console.log('  ERR  ' + (e && e.stack || e));
  } finally {
    cleanupFiles.forEach(function (f) { try { fs.unlinkSync(f); } catch (e) {} });
    console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  }
})();
