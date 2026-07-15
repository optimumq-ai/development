// Slice A backfill (2026-07-15). The schema (task_events + trigger + timestamp columns + discovered_at)
// auto-applies on API boot; this seeds sensible history for tasks/jobs that already existed. Idempotent.
require('dotenv').config();
var db = require('../src/db');

(async function () {
  await db.initDb();

  // 1) Denormalized stamps for existing tasks (best-effort from what we have).
  await db.run("UPDATE tasks SET assigned_at = COALESCE(claimed_at, created_at) WHERE assigned_at IS NULL AND status IN ('assigned','in_progress','returned','awaiting_review','done')");
  await db.run("UPDATE tasks SET done_at = updated_at WHERE done_at IS NULL AND status = 'done'");

  // 2) Seed one bookmark per existing task (its current state, anchored at created_at) so the trail isn't empty.
  await db.run("INSERT INTO task_events (task_id, request_id, task_type, from_status, to_status, at) " +
    "SELECT t.id, t.request_id, t.type, NULL, t.status, t.created_at FROM tasks t " +
    "WHERE NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id)");

  // 3) Any draft redaction job that already has zones has effectively been worked -> mark discovered so the
  //    entry-contract gate never auto-re-scans it.
  await db.run("UPDATE redaction_jobs SET discovered_at = COALESCE(updated_at, created_at) " +
    "WHERE status = 'draft' AND discovered_at IS NULL AND EXISTS (SELECT 1 FROM redaction_zones z WHERE z.job_id = redaction_jobs.id)");

  var ev = (await db.get("SELECT COUNT(*)::int c FROM task_events")).c;
  var stamped = (await db.get("SELECT COUNT(*)::int c FROM tasks WHERE assigned_at IS NOT NULL")).c;
  console.log('task_events rows:        ' + ev);
  console.log('tasks with assigned_at:  ' + stamped);
  console.log('\nBackfill complete.');
  process.exit(0);
})().catch(function (e) { console.error('ERROR', e); process.exit(1); });
