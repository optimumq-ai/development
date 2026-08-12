'use strict';
// ONE-TIME BACKFILL (SPEC_record_verification.md §6): content_sha256 for fulfilled_records rows released
// BEFORE 2026-08-12, by hashing the stored output file on disk. Idempotent — only rows whose hash is NULL
// are touched, so re-running is harmless. A row whose file is missing is reported and left NULL (verification
// of it honestly answers "cannot verify"); nothing else about the row is modified.
//
// Run as: node scripts/backfill_content_hash.js   (against the live DB, deliberately — this is a deploy
// migration, not a test. It writes exactly one previously-NULL column per row.)
require('dotenv').config({ path: __dirname + '/../.env' });
var db = require('../src/db');
var fileHash = require('../src/services/fileHash');

(async function () {
  await db.initDb();
  var rows = await db.all(
    'SELECT fr.id, fr.output_file_id, rf.filename FROM fulfilled_records fr ' +
    'LEFT JOIN request_files rf ON rf.id = fr.output_file_id WHERE fr.content_sha256 IS NULL');
  console.log(rows.length + ' released row(s) carry no hash.');
  var done = 0, missing = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var sha = r.output_file_id ? await fileHash.ofRequestFile(r.output_file_id) : null;
    if (!sha) { missing++; console.log('  MISSING file for fulfilled_record ' + r.id + ' (' + (r.filename || 'no output file') + ') — left NULL'); continue; }
    await db.run('UPDATE fulfilled_records SET content_sha256 = ? WHERE id = ? AND content_sha256 IS NULL', [sha, r.id]);
    done++;
  }
  console.log('Backfilled ' + done + ' row(s); ' + missing + ' left NULL (file missing).');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
