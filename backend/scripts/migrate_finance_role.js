// D4 §8 — financial-authority role reconciliation (2026-07-15). Collapses the fee concept to ONE canonical
// role, the FINANCE permission/capability, and retires the orphan FEE_WAIVER_APPROVER function role.
//
//   BEFORE: fee-waiver task + fee-waiver-decision routed/authorized on permission role FEE_AUTHORITY, while
//           fee-objection approval + the reason library gated on function role FEE_WAIVER_APPROVER — which no
//           user held in the seeds (and only one in live). The financial authority who received the fee-waiver
//           task therefore could NOT approve a fee objection. Two names, two catalogs, one concept, one bug.
//   AFTER:  permission role FEE_AUTHORITY -> FINANCE, gating routing AND every financial gate; the dead
//           FEE_WAIVER_APPROVER function role is dropped. See schema.sql / middleware/auth.js / objections.js.
//
// Reference data, not request data — a direct migration is the right path (the seed rule about "real creation
// paths" is about request/demo rows, not the role catalog). Idempotent: safe to re-run; a second run is a no-op.
require('dotenv').config();
var db = require('../src/db');

(async function () {
  await db.initDb();

  // 1) Rename the permission role FEE_AUTHORITY -> FINANCE (row id pr-feeauth -> pr-finance) and re-point every
  //    user assignment. No FK constraints on these join tables, so order is free.
  await db.run("UPDATE permission_roles SET id = 'pr-finance', name = 'FINANCE' WHERE id = 'pr-feeauth'");
  await db.run("UPDATE user_permission_roles SET permission_role_id = 'pr-finance' WHERE permission_role_id = 'pr-feeauth'");

  // 2) Existing fee_waiver tasks store the role NAME in role_required — carry them onto the new name so an open
  //    task stays routable (there is one done task in live; harmless, kept for consistency + idempotency).
  await db.run("UPDATE tasks SET role_required = 'FINANCE' WHERE role_required = 'FEE_AUTHORITY'");

  // 3) Retire the orphan function role FEE_WAIVER_APPROVER and any assignment of it. (Live has one holder,
  //    Tom Jones, who also holds FEE_AUTHORITY -> FINANCE, so he keeps financial authority via the perm.)
  await db.run("DELETE FROM user_function_roles WHERE function_role_id = 'fr-feewaiver'");
  await db.run("DELETE FROM function_roles WHERE id = 'fr-feewaiver'");

  // Verify the end state.
  var fin = await db.get("SELECT id, name FROM permission_roles WHERE name = 'FINANCE'");
  var oldPerm = await db.get("SELECT id FROM permission_roles WHERE name = 'FEE_AUTHORITY'");
  var oldFn = await db.get("SELECT id FROM function_roles WHERE name = 'FEE_WAIVER_APPROVER'");
  var holders = await db.get("SELECT COUNT(*) AS c FROM user_permission_roles WHERE permission_role_id = 'pr-finance'");
  var staleTasks = await db.get("SELECT COUNT(*) AS c FROM tasks WHERE role_required = 'FEE_AUTHORITY'");

  console.log('FINANCE permission role:      ' + (fin ? fin.id + ' / ' + fin.name : 'MISSING'));
  console.log('FEE_AUTHORITY (should be gone): ' + (oldPerm ? 'STILL PRESENT' : 'gone'));
  console.log('FEE_WAIVER_APPROVER (gone):    ' + (oldFn ? 'STILL PRESENT' : 'gone'));
  console.log('FINANCE holders:              ' + (holders && holders.c));
  console.log('tasks still on FEE_AUTHORITY:  ' + (staleTasks && staleTasks.c));

  if (!fin || oldPerm || oldFn || Number(staleTasks && staleTasks.c) !== 0) {
    console.error('MIGRATION INCOMPLETE'); process.exit(1);
  }
  console.log('\nMigration complete.');
  process.exit(0);
})().catch(function (e) { console.error('ERROR', e); process.exit(1); });
