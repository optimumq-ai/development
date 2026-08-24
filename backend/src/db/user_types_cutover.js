'use strict';
// THE CUTOVER to the v3 user-type model — SPEC_user_type_model §9 (Kevin, 2026-08-24: NO data migration).
//
//   node src/db/user_types_cutover.js            # dry run: reports what would change, writes nothing
//   node src/db/user_types_cutover.js --apply    # do it
//
// What it does, idempotently:
//   1. EMPTIES user_function_roles and user_permission_roles. Users (names, logins, teams, specialization,
//      task subsets) are KEPT. No user type is inferred for anyone.
//   2. BOOTSTRAPS the seeded admin login (kruss@optimumq.ai) with oro_sysadmin + oro_director so someone can
//      sign in and assign everyone else through Staff Management (S3).
//   3. BUMPS every user's auth_version, so every token minted under the legacy model is dead immediately.
//
// The legacy TABLES stay (dropped in S5); only their assignment rows go. Reads through the shared db module,
// so it runs against whatever DATABASE_URL says — the harness runs it against the test DB.
const BOOTSTRAP_EMAIL = 'kruss@optimumq.ai';
const BOOTSTRAP_TYPES = ['oro_sysadmin', 'oro_director'];

async function cutover(opts) {
  opts = opts || {};
  const db = require('./index');
  const ut = require('../services/userTypes');
  const report = { dryRun: !opts.apply, legacyRowsRemoved: 0, bootstrap: null, granted: [], authVersionBumped: 0 };

  const fr = await db.get('SELECT COUNT(*) AS c FROM user_function_roles');
  const pr = await db.get('SELECT COUNT(*) AS c FROM user_permission_roles');
  report.legacyRowsRemoved = Number(fr.c) + Number(pr.c);

  const admin = await db.get('SELECT id, email, status FROM users WHERE email = ?', [BOOTSTRAP_EMAIL]);
  report.bootstrap = admin ? admin.id : null;
  if (!admin) report.warning = 'bootstrap login ' + BOOTSTRAP_EMAIL + ' not found — nobody will hold a user type';

  if (!opts.apply) return report;

  await db.run('DELETE FROM user_function_roles');
  await db.run('DELETE FROM user_permission_roles');
  if (admin) {
    for (const key of BOOTSTRAP_TYPES) {
      if (await ut.grant(admin.id, key, null, 'cutover')) report.granted.push(key);
    }
    if (admin.status !== 'active') { await db.run("UPDATE users SET status = 'active' WHERE id = ?", [admin.id]); report.reactivated = true; }
  }
  const bumped = await db.run('UPDATE users SET auth_version = COALESCE(auth_version, 1) + 1');
  report.authVersionBumped = bumped.changes;
  return report;
}

module.exports = { cutover, BOOTSTRAP_EMAIL, BOOTSTRAP_TYPES };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
  const apply = process.argv.includes('--apply');
  (async () => {
    const db = require('./index');
    await db.initDb();
    const r = await cutover({ apply });
    console.log((apply ? 'APPLIED' : 'DRY RUN') + ':', JSON.stringify(r, null, 2));
    if (!apply) console.log('\nRe-run with --apply to perform the cutover.');
    process.exit(0);
  })().catch((e) => { console.error('cutover FAILED:', e.message); process.exit(1); });
}
