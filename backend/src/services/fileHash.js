'use strict';
// CONTENT HASHING for released records (SPEC_record_verification.md §2.2).
//
// One rule, three writers (redactionApply, structuredRedaction, redactionBypass): every
// `fulfilled_records` insert carries the SHA-256 of the exact output file it points at. The hash is the
// integrity anchor the verification portal compares against; the typeable "verification code" on the
// certification sheet is DERIVED from it (first 16 hex, grouped) and never stored — one source of truth.
//
// FAILS OPEN. A hash is evidence, not a gate: if hashing fails (file missing, disk error) the release
// proceeds with a NULL hash and the failure is logged — a record must never be unreleasable because its
// fingerprint could not be taken. Verification of a hashless record honestly answers "cannot verify".
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var UPLOAD_DIR = path.join(__dirname, '../../../uploads');

function ofBuffer(buf) {
  try { return crypto.createHash('sha256').update(buf).digest('hex'); }
  catch (e) { console.error('[fileHash buffer]', e && e.message); return null; }
}

// Hash a stored file by its request_files id (the reuse/bypass path, where no buffer is in memory).
async function ofRequestFile(fileId) {
  try {
    var db = require('../db');
    var rf = await db.get('SELECT filename FROM request_files WHERE id = ?', [fileId]);
    if (!rf || !rf.filename) return null;
    return ofBuffer(fs.readFileSync(path.join(UPLOAD_DIR, rf.filename)));
  } catch (e) { console.error('[fileHash file ' + fileId + ']', e && e.message); return null; }
}

// The human-typeable form printed on the certification sheet and entered by a verifier:
// first 16 hex characters, uppercase, grouped in fours (A1B2-C3D4-E5F6-0789).
function verificationCode(sha256) {
  if (!sha256 || sha256.length < 16) return null;
  var s = String(sha256).slice(0, 16).toUpperCase();
  return s.replace(/(.{4})(?=.)/g, '$1-');
}

// Normalize a user-entered code for comparison: strip separators/whitespace, lowercase.
function normalizeCode(input) {
  return String(input || '').replace(/[\s-]/g, '').toLowerCase();
}

module.exports = { ofBuffer: ofBuffer, ofRequestFile: ofRequestFile,
                   verificationCode: verificationCode, normalizeCode: normalizeCode };
