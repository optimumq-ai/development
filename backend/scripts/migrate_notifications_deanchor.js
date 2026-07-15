// D4/D9 §4 — eliminate the SYS-IMPORT pseudo-request (2026-07-15). Idempotent, re-runnable.
//
// Imports used to hang files + tasks on a standing fake request `sysimport-<repo>` because tasks.request_id
// and request_files.request_id were NOT NULL. Those are now nullable; import files anchor to their source
// repository; the "no template yet" prompt is a Notification. This migration converts the EXISTING live data:
//   - backfill request_files.repository_id from the sysimport id, then null the request_id;
//   - convert any build_redaction_template task on a pseudo-request into a Notification, then delete the task;
//   - null the request_id on any remaining sysimport-anchored task / doc page / fulfilled record;
//   - delete the sysimport request rows.
require('dotenv').config();
var db = require('../src/db');
var N = require('../src/services/notifications');

async function adminIds() {
  var rows = await db.all("SELECT DISTINCT u.id FROM users u JOIN user_function_roles ufr ON ufr.user_id = u.id JOIN function_roles fr ON fr.id = ufr.function_role_id WHERE fr.name IN ('SYSTEM_ADMIN','DIRECTOR') AND u.status <> 'inactive'");
  return (rows || []).map(function (r) { return r.id; });
}

(async function () {
  await db.initDb();  // applies schema.postgres.sql: nullable request_id + request_files.repository_id + notifications

  // 1) Backfill repository_id from the pseudo-request id ('sysimport-<repoId>'), for raw imports AND redacted outputs.
  await db.run("UPDATE request_files SET repository_id = substring(request_id from 11) WHERE request_id LIKE 'sysimport-%' AND repository_id IS NULL");

  // 2) Convert build_redaction_template tasks (the wart's task) into notifications, then delete them.
  var admins = await adminIds();
  var btTasks = await db.all("SELECT id, request_id, assigned_to FROM tasks WHERE type = 'build_redaction_template' AND request_id LIKE 'sysimport-%'");
  for (var i = 0; i < btTasks.length; i++) {
    var t = btTasks[i];
    var repoId = String(t.request_id).slice('sysimport-'.length);
    var repo = await db.get("SELECT name FROM record_repositories WHERE id = ?", [repoId]);
    var recips = t.assigned_to ? [t.assigned_to] : admins;
    for (var r = 0; r < recips.length; r++) {
      await N.emit({ userId: recips[r], kind: 'import_template', contextType: 'repository', contextId: repoId,
        title: 'Import source needs a redaction template',
        body: 'Files imported from "' + ((repo && repo.name) || repoId) + '" have no matching template — set one up to auto-redact.',
        link: '/mass-redaction', createdBy: 'migration' });
    }
    await db.run("DELETE FROM tasks WHERE id = ?", [t.id]);
  }

  // 3) Any remaining sysimport-anchored task (e.g. review_auto_redaction) keeps existing but loses the fake request.
  await db.run("UPDATE tasks SET request_id = NULL WHERE request_id LIKE 'sysimport-%'");

  // 4) De-anchor files + downstream rows, then delete the pseudo-requests.
  await db.run("UPDATE request_files SET request_id = NULL WHERE request_id LIKE 'sysimport-%'");
  await db.run("UPDATE document_pages SET request_id = NULL WHERE request_id LIKE 'sysimport-%'");
  await db.run("UPDATE fulfilled_records SET request_id = NULL WHERE request_id LIKE 'sysimport-%'");
  await db.run("DELETE FROM requests WHERE id LIKE 'sysimport-%'");

  // Verify.
  var reqs = (await db.get("SELECT COUNT(*)::int c FROM requests WHERE id LIKE 'sysimport-%'")).c;
  var files = (await db.get("SELECT COUNT(*)::int c FROM request_files WHERE request_id LIKE 'sysimport-%'")).c;
  var tasks = (await db.get("SELECT COUNT(*)::int c FROM tasks WHERE request_id LIKE 'sysimport-%'")).c;
  var anchored = (await db.get("SELECT COUNT(*)::int c FROM request_files WHERE repository_id IS NOT NULL AND request_id IS NULL")).c;
  console.log('sysimport requests remaining:      ' + reqs);
  console.log('files still on a sysimport request: ' + files);
  console.log('tasks still on a sysimport request: ' + tasks);
  console.log('import files anchored by repository: ' + anchored);
  if (reqs !== 0 || files !== 0 || tasks !== 0) { console.error('MIGRATION INCOMPLETE'); process.exit(1); }
  console.log('\nMigration complete.');
  process.exit(0);
})().catch(function (e) { console.error('ERROR', e); process.exit(1); });
