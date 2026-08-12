'use strict';
// THE CERTIFICATION SHEET (SPEC_record_verification.md §2.3–§2.4) — the page the intake checkbox has
// promised since the wizard shipped ("Include a page attesting the records are true and accurate") and
// nothing ever generated.
//
// WHEN. Generated when the PARENT derives Complete (disposition.deriveParent hooks here) — i.e. when the
// last open child reaches a terminal state, REGARDLESS of that child's disposition (Kevin's rule: the
// sheet is sent even when the final item closes denied or no-records). n = 1 is not a special case:
// parent completion coincides with the single child's completion.
//
// WHAT. One request-level PDF (pdf-lib, the Vaughn Index builder's idiom):
//   - the attestation: agency, request number, date;
//   - one row per RELEASED record: child marker + title, who released it and when, the typeable
//     verification code (first 16 hex of the SHA-256, grouped) and the full hash in small print;
//   - one row per NON-DELIVERING child: its outcome, honestly — the sheet describes the whole request;
//   - verification instructions naming the portal.
//
// The sheet lands as a request_files row ON THE PARENT (status 'certification') and joins the release
// package the way the withholding log does — delivery of the sheet is delivery of the records.
// Idempotent: a parent that already carries a certification sheet is never given a second one (a reopen
// and re-complete keeps the original; regenerate-on-change is a decision nobody has made).
//
// NOT the "no-record-located certification" (FEE_ESTIMATE_VARIABLE_MAP §8.3) — a different instrument.
// This sheet LISTS a no-records outcome; it does not certify it.
var fs = require('fs');
var path = require('path');
var { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
var { v4: uuidv4 } = require('uuid');
var db = require('../db');
var fileHash = require('./fileHash');

var UPLOAD_DIR = path.join(__dirname, '../../../uploads');

function safe(s) { return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' '); }

// Generate the sheet for a completed parent. Returns
//   { generated: true, fileId, records, outcomes }  — the sheet was written now
//   { skipped: true, reason }                       — not certified / already sheeted / not a parent
async function onParentComplete(parentId) {
  var parent = await db.get(
    "SELECT id, request_number, requestor_name, certification_requested FROM requests " +
    "WHERE id = ? AND master_request_id IS NULL", [parentId]);
  if (!parent) return { skipped: true, reason: 'not_a_parent' };
  if (!Number(parent.certification_requested)) return { skipped: true, reason: 'not_certified' };
  var existing = await db.get(
    "SELECT id FROM request_files WHERE request_id = ? AND status = 'certification' LIMIT 1", [parentId]);
  if (existing) return { skipped: true, reason: 'already_generated', fileId: existing.id };

  var agencyRow = await db.get("SELECT value FROM system_config WHERE key = 'agency_name'");
  var agency = (agencyRow && agencyRow.value) || 'the agency';
  var kids = await db.all(
    'SELECT id, child_no, component_label, description, closure_reason FROM requests ' +
    'WHERE master_request_id = ? ORDER BY child_no', [parentId]);
  if (!kids.length) return { skipped: true, reason: 'no_children' };

  var ENDINGS = require('./disposition').ENDINGS;
  var records = [], outcomes = [];
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    var label = (k.component_label && k.component_label.trim()) ||
                (k.description ? k.description.slice(0, 60) : ('Record item ' + k.child_no));
    var released = await db.all(
      "SELECT title, released_by, released_at, content_sha256 FROM fulfilled_records " +
      "WHERE request_id = ? AND status = 'released' ORDER BY released_at", [k.id]);
    if (released.length) {
      released.forEach(function (fr) {
        records.push({ childNo: k.child_no, label: fr.title || label,
                       releasedBy: fr.released_by || 'Staff', releasedAt: fr.released_at || '',
                       sha256: fr.content_sha256 || null,
                       code: fileHash.verificationCode(fr.content_sha256) });
      });
    } else {
      var def = ENDINGS[k.closure_reason];
      outcomes.push({ childNo: k.child_no, label: label,
                      outcome: (def && def.label) || k.closure_reason || 'Closed without a delivered record' });
    }
  }

  // ---- the PDF ----
  var pdf = await PDFDocument.create();
  var font = await pdf.embedFont(StandardFonts.Helvetica);
  var fontB = await pdf.embedFont(StandardFonts.HelveticaBold);
  var mono = await pdf.embedFont(StandardFonts.Courier);
  var page = pdf.addPage([612, 792]);
  var y = 744;
  function newPage() { page = pdf.addPage([612, 792]); y = 744; }
  function need(h) { if (y - h < 54) newPage(); }
  function text(t, opts) {
    opts = opts || {};
    page.drawText(safe(t), { x: opts.x || 48, y: y, size: opts.size || 10,
      font: opts.bold ? fontB : (opts.mono ? mono : font),
      color: opts.gray ? rgb(0.35, 0.35, 0.35) : rgb(0.1, 0.1, 0.1) });
    y -= (opts.lh || (opts.size || 10) + 5);
  }
  function wrap(t, sz, maxW, f) {
    var words = safe(t).split(/\s+/), lines = [], cur = '';
    for (var w = 0; w < words.length; w++) {
      var trial = cur ? cur + ' ' + words[w] : words[w];
      if (cur && (f || font).widthOfTextAtSize(trial, sz) > maxW) { lines.push(cur); cur = words[w]; }
      else { cur = trial; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  var today = new Date().toISOString().slice(0, 10);
  text('Certification of Records', { size: 18, bold: true, lh: 24 });
  text('Public records request ' + parent.request_number + ' — ' + agency, { size: 11, gray: true, lh: 20 });
  wrap('The Office of Open Records of ' + agency + ' certifies that the records listed below are true and ' +
       'correct copies of the records released in response to public records request ' + parent.request_number +
       (parent.requestor_name ? ', submitted by ' + parent.requestor_name : '') + '. Issued ' + today + '.',
       10, 516).forEach(function (ln) { text(ln, { lh: 14 }); });
  y -= 10;

  if (records.length) {
    need(40);
    text('Certified records', { size: 13, bold: true, lh: 18 });
    records.forEach(function (r) {
      need(56);
      text('–' + r.childNo + '  ' + r.label, { bold: true, lh: 14 });
      text('Released by ' + r.releasedBy + (r.releasedAt ? ' on ' + String(r.releasedAt).slice(0, 10) : ''),
           { x: 66, size: 9, gray: true, lh: 13 });
      if (r.code) {
        text('Verification code: ' + r.code, { x: 66, size: 10, mono: true, lh: 14 });
        text('SHA-256: ' + r.sha256, { x: 66, size: 6.5, mono: true, gray: true, lh: 14 });
      } else {
        text('No digital fingerprint was recorded for this file — verify by visual comparison at the portal.',
             { x: 66, size: 9, gray: true, lh: 14 });
      }
      y -= 4;
    });
  }

  if (outcomes.length) {
    need(40);
    y -= 6;
    text('Items that did not result in a delivered record', { size: 13, bold: true, lh: 18 });
    outcomes.forEach(function (o) {
      need(30);
      text('–' + o.childNo + '  ' + o.label + ' — ' + o.outcome, { size: 10, lh: 15 });
    });
  }

  need(76);
  y -= 10;
  text('How to verify', { size: 13, bold: true, lh: 18 });
  wrap('To verify a certified record, visit the ' + agency + ' website, open the Public Records Portal, and ' +
       'choose Verify a Certified Record. Enter request number ' + parent.request_number + ' and the ' +
       'verification code printed above for the record in hand. A digital file can be checked by its code; ' +
       'a printed copy can be compared visually against the certified original.', 10, 516)
    .forEach(function (ln) { text(ln, { lh: 14 }); });

  var bytes = await pdf.save();
  var outName = uuidv4() + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, outName), bytes);
  var fileId = uuidv4();
  await db.run(
    "INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) " +
    "VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
    [fileId, parentId, outName, 'Certification - ' + parent.request_number + '.pdf', 'application/pdf',
     bytes.length, 'certification', 'System']);
  await db.run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
    [uuidv4(), parentId, 'system', 'System', 'CERTIFICATION_SHEET_GENERATED',
     'Certification sheet generated at completion: ' + records.length + ' certified record(s)' +
     (outcomes.length ? ', ' + outcomes.length + ' item(s) closed without a delivered record (listed on the sheet)' : '') +
     '. The sheet joins the release package.']);
  return { generated: true, fileId: fileId, records: records.length, outcomes: outcomes.length };
}

module.exports = { onParentComplete: onParentComplete };
