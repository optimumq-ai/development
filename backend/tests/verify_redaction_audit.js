'use strict';
// REDACTION CONTENT AUDIT — Kevin's per-item reliability check (2026-08-14): after zones are
// placed, code verifies that each box covers the KIND of thing its rule names (the words under the
// box are known from the text layer), and that nothing of the redacted kinds is left visible
// OUTSIDE every box (the leak scan — the under-redaction direction that actually hurts citizens).
//
// WHAT THIS PREVENTS: a drifted box silently covering a label while the phone number sits exposed
// beside it; a box covering only PART of a value; a "clean" mass batch that left a pattern-shaped
// value uncovered; and — critically — audit flags that leak the covered PII into logs.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var path = require('path');
var db = require('/opt/optimumq/backend/src/db');
var audit = require('/opt/optimumq/backend/src/services/redactionAudit');
var docProcessing = require('/opt/optimumq/backend/src/services/docProcessing');
var redactionApply = require('/opt/optimumq/backend/src/services/redactionApply');
var { PDFDocument, StandardFonts } = require('/opt/optimumq/backend/node_modules/pdf-lib');
var { v4: uuidv4 } = require('/opt/optimumq/backend/node_modules/uuid');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'RA' + Date.now();
var UPLOAD_DIR = docProcessing.UPLOAD_DIR;

(async function () {
  await db.initDb();

  console.log('\n=== A. RULE -> DATUM-KIND MAPPING ===');
  ok('A1 Social Security rule maps to the SSN detector', audit.detectorForRule('Social Security Numbers') === 'ssn');
  ok('A2 the addresses-and-telephone rule maps to the phone detector', audit.detectorForRule('Home Addresses and Telephone Numbers') === 'phone');
  ok('A3 email / card / DOB rules map to their detectors',
    audit.detectorForRule('Email Addresses of the Public') === 'email' &&
    audit.detectorForRule('Card and Access Device Numbers') === 'card' &&
    audit.detectorForRule('Dates of Birth') === 'dob');
  ok('A4 a legal-privilege rule maps to no detector (coverage check only)', audit.detectorForRule('Attorney-Client Privileged Communications') === null);

  console.log('\n=== B. END-TO-END THROUGH THE REAL APPLY ===');
  // A one-page document with a labeled SSN and phone number at known positions.
  var pdf = await PDFDocument.create(); var page = pdf.addPage([612, 792]);
  var font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Applicant: John Smith', { x: 72, y: 720, size: 12, font: font });
  page.drawText('SSN: 123-45-6789', { x: 72, y: 690, size: 12, font: font });
  page.drawText('Phone: (555) 123-4567', { x: 72, y: 660, size: 12, font: font });
  var bytes = Buffer.from(await pdf.save());
  var fid = uuidv4(); var fname = 'ra_' + TAG + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), bytes);
  await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) VALUES (?,NULL,?,?,?,?,?,?,datetime('now'))",
    [fid, fname, fname, 'application/pdf', bytes.length, 'uploaded', 'RA Harness']);
  await docProcessing.processFile(fid);
  var pageRow = await db.get('SELECT * FROM document_pages WHERE file_id = ? AND page_no = 1', [fid]);
  var words = JSON.parse(pageRow.words || '[]');
  ok('B0 the text layer extracted (harness precondition)', words.length >= 6);

  function boxOver(predicate) {
    var hits = words.filter(predicate);
    var x0 = Math.min.apply(null, hits.map(function (w) { return w.x; }));
    var y0 = Math.min.apply(null, hits.map(function (w) { return w.y; }));
    var x1 = Math.max.apply(null, hits.map(function (w) { return w.x + w.w; }));
    var y1 = Math.max.apply(null, hits.map(function (w) { return w.y + w.h; }));
    return { page_no: 1, x: x0 - 0.004, y: y0 - 0.004, w: (x1 - x0) + 0.008, h: (y1 - y0) + 0.008 };
  }

  // Two throwaway rules with real-world titles so the detector mapping engages.
  var rSsn = 'ra-ssn-' + TAG, rPhone = 'ra-phone-' + TAG;
  await db.run("INSERT INTO redaction_rules (id, jurisdiction_id, title, category, is_active) VALUES (?,?,?,?,1)", [rSsn, 'jur-tx', 'Social Security Numbers', 'privacy']);
  await db.run("INSERT INTO redaction_rules (id, jurisdiction_id, title, category, is_active) VALUES (?,?,?,?,1)", [rPhone, 'jur-tx', 'Home Addresses and Telephone Numbers', 'privacy']);

  var jobId = uuidv4();
  await db.run("INSERT INTO redaction_jobs (id, file_id, request_id, status, created_by) VALUES (?,?,NULL,'draft','ra-harness')", [jobId, fid]);
  function zoneRow(z, ruleId) {
    return db.run('INSERT INTO redaction_zones (id, job_id, file_id, page_no, x, y, w, h, rule_id, zone_type, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [uuidv4(), jobId, fid, z.page_no, z.x, z.y, z.w, z.h, ruleId, 'template', 'ra-harness']);
  }
  // z1: correctly covers the full SSN value -> clean.
  await zoneRow(boxOver(function (w) { return w.t === '123-45-6789'; }), rSsn);
  // z2: cites the SSN rule but covers only the "Applicant:" label -> pattern mismatch.
  await zoneRow(boxOver(function (w) { return w.t === 'Applicant:'; }), rSsn);
  // z3: cites the PHONE rule but covers only the "Phone:" label -> mismatch AND the number leaks.
  await zoneRow(boxOver(function (w) { return w.t === 'Phone:'; }), rPhone);
  // z4: a box over blank paper, no rule -> covers-no-text flag.
  await zoneRow({ page_no: 1, x: 0.7, y: 0.08, w: 0.12, h: 0.03 }, null);

  var result = await redactionApply.applyRedaction(jobId, 'RA Harness');
  var flags = result.auditFlags || [];
  var ssnMismatches = flags.filter(function (f) { return f.kind === 'pattern_mismatch' && f.expected === 'ssn'; });
  ok('B1 the correctly-placed SSN box raises NO flag (only the mis-placed one does)', ssnMismatches.length === 1);
  ok('B2 the label-covering SSN box is flagged as a mismatch', flags.some(function (f) { return f.kind === 'pattern_mismatch' && f.expected === 'ssn'; }));
  ok('B3 the label-covering PHONE box is flagged as a mismatch', flags.some(function (f) { return f.kind === 'pattern_mismatch' && f.expected === 'phone'; }));
  ok('B4 the UNCOVERED phone number is flagged as a possible leak', flags.some(function (f) { return f.kind === 'possible_leak' && f.expected === 'phone'; }));
  ok('B5 no SSN leak is claimed — the real SSN IS covered', !flags.some(function (f) { return f.kind === 'possible_leak' && f.expected === 'ssn'; }));
  ok('B6 the box over blank paper is flagged as covering no text', flags.some(function (f) { return f.kind === 'no_text'; }));
  var allText = JSON.stringify(flags);
  ok('B7 flags NEVER contain the covered values themselves (no PII in logs)', allText.indexOf('123-45-6789') < 0 && allText.indexOf('123-4567') < 0 && allText.indexOf('John') < 0);
  var jobRow = await db.get('SELECT audit_flags FROM redaction_jobs WHERE id = ?', [jobId]);
  var storedFlags = JSON.parse(jobRow.audit_flags || '[]');
  ok('B8 the flags persist on the redaction job for later review', storedFlags.length === flags.length && flags.length >= 4);

  console.log('\n=== C. LEAVE THE WORLD AS FOUND ===');
  var outFiles = await db.all("SELECT filename FROM request_files WHERE id = ? OR uploaded_by = 'RA Harness'", [fid]);
  await db.run('DELETE FROM fulfilled_records WHERE source_file_id = ?', [fid]);
  await db.run('DELETE FROM redaction_zones WHERE job_id = ?', [jobId]);
  await db.run('DELETE FROM redaction_jobs WHERE id = ?', [jobId]);
  await db.run('DELETE FROM document_pages WHERE file_id = ?', [fid]);
  await db.run("DELETE FROM request_files WHERE id = ? OR uploaded_by = 'RA Harness'", [fid]);
  await db.run('DELETE FROM redaction_rules WHERE id IN (?,?)', [rSsn, rPhone]);
  outFiles.forEach(function (f) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)); } catch (e) {} });
  try { fs.rmSync(path.join(docProcessing.PROCESSED_DIR, fid), { recursive: true, force: true }); } catch (e) {}
  var left = await db.get("SELECT count(*)::int AS n FROM request_files WHERE filename LIKE 'ra_%' || ? || '%'", [TAG]);
  ok('C1 all fixture rows and files are gone', Number(left.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
