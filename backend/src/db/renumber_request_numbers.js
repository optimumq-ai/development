'use strict';
// RENUMBER CITIZEN REQUEST NUMBERS TO THE FIXED WIDTH (services/requestCreate.js → SEQ_DIGITS).
//
//   node src/db/renumber_request_numbers.js          # dry run — prints the plan, changes nothing
//   node src/db/renumber_request_numbers.js --apply  # writes
//
// WHY: the width must be UNIFORM across the table, not merely correct for new rows. `nextRequestNumber` finds
// the highest number with `ORDER BY request_number DESC`, which is a LEXICAL sort — with two widths in play,
// '2026-9999' sorts ABOVE '2026-010000', the helper reads the wrong maximum, and it re-mints a number that
// already exists (UNIQUE violation → intake 500s). So a width change is not complete until the existing rows
// are reformatted. Leaving two widths in the table is the bug, not a cosmetic wart.
//
// SCOPE — only well-formed CITIZEN numbers (`YYYY-<digits>`) are touched. System and demo rows
// ('SYS-TEMPLATE-SAMPLES', 'DEMO-2026-5069', 'LIBRARY', 'SYS-IMPORT-…') are deliberately left alone: they are
// not citizen numbers and they take no part in sequencing.
//
// SAFE WHILE THE NUMBERS ARE DEMO DATA. A request number is what a citizen quotes back to you — on a receipt,
// in an email, over the phone. Renumbering rows a real requester already holds is a different and much worse
// operation. That window is open now (all rows are seed/demo) and closes on the first live request.
require('dotenv').config({ path: '/opt/optimumq/backend/.env' });
const db = require('../db');
const RC = require('../services/requestCreate');

const APPLY = process.argv.includes('--apply');
const WIDTH = RC.SEQ_DIGITS;

(async () => {
  await db.initDb();

  // `\d+` (not `\d{4}`) so this finds numbers of ANY current width — including any that already slipped past
  // the old 4-digit ceiling.
  const rows = await db.all(
    "SELECT id, request_number FROM requests WHERE request_number ~ '^[0-9]{4}-[0-9]+$' ORDER BY request_number"
  );

  const plan = [];
  for (const r of rows) {
    const [year, seq] = r.request_number.split('-');
    const want = year + '-' + String(parseInt(seq, 10)).padStart(WIDTH, '0');
    if (want !== r.request_number) plan.push({ id: r.id, from: r.request_number, to: want });
  }

  console.log('citizen-numbered requests: ' + rows.length + '  |  target width: ' + WIDTH + ' digits');
  console.log('needing renumber: ' + plan.length + (plan.length ? '' : '  (already uniform — nothing to do)'));
  for (const p of plan.slice(0, 10)) console.log('   ' + p.from + '  ->  ' + p.to);
  if (plan.length > 10) console.log('   … and ' + (plan.length - 10) + ' more');

  // Collisions must be impossible before we write. Re-padding is injective on a set that was already unique
  // (same integer → same string), but assert it rather than assume: a duplicate here would abort mid-way and
  // leave the table in two widths, which is the exact state this script exists to prevent.
  const targets = new Set(plan.map((p) => p.to));
  if (targets.size !== plan.length) throw new Error('ABORT: renumbering would collide — two rows map to one number');
  const untouched = rows.filter((r) => !plan.find((p) => p.id === r.id)).map((r) => r.request_number);
  for (const u of untouched) {
    if (targets.has(u)) throw new Error('ABORT: renumbering would collide with an existing number: ' + u);
  }

  if (!plan.length) { console.log('\nNothing to do.'); process.exit(0); }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to write.'); process.exit(0); }

  for (const p of plan) {
    await db.run('UPDATE requests SET request_number = ? WHERE id = ?', [p.to, p.id]);
  }
  console.log('\nrenumbered ' + plan.length + ' request(s)');

  // Prove uniformity — the property the sort depends on.
  const bad = await db.all(
    "SELECT request_number FROM requests WHERE request_number ~ '^[0-9]{4}-[0-9]+$' " +
    "AND request_number !~ '^[0-9]{4}-[0-9]{" + WIDTH + "}$'"
  );
  if (bad.length) throw new Error('FAILED: ' + bad.length + ' number(s) are still not ' + WIDTH + ' digits');
  console.log('VERIFIED: every citizen number is exactly ' + WIDTH + ' digits.');
  process.exit(0);
})().catch((e) => { console.error('renumber FAILED:', e.message); process.exit(1); });
