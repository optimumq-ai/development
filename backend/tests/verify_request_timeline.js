'use strict';
// REQUEST TIMELINE / BOTTLENECK (Slice B-breakdown). Stitches the stage backbone (request_history) with the
// task queue/process/review trail (task_events) into ONE gap-free, submit-anchored phase timeline, and names
// the longest ACTIONABLE stretch as the bottleneck (holds — the requester's payment — are excluded).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var RT = require('/opt/optimumq/backend/src/services/requestTimeline');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var H = 3600000, BASE = Date.parse('2026-02-01T00:00:00Z');
function at(h) { return new Date(BASE + h * H).toISOString().slice(0, 19).replace('T', ' '); }
function sum(segs, pred) { return segs.filter(pred || function () { return true; }).reduce(function (a, s) { return a + s.durationMs; }, 0); }

(async function () {
  await db.initDb();

  console.log('\n=== A. coverStretch — a work stretch is made gap-free (uncovered time = sitting/queue) ===');
  var c1 = RT.coverStretch('redaction', 0, 10 * H, [{ phase: 'process', start: 2 * H, end: 5 * H }]);
  ok('A1 a single process interval yields queue → process → queue (gaps filled)',
    c1.length === 3 && c1[0].phase === 'queue' && c1[1].phase === 'process' && c1[2].phase === 'queue' &&
    c1[0].end - c1[0].start === 2 * H && c1[1].end - c1[1].start === 3 * H && c1[2].end - c1[2].start === 5 * H);
  var c2 = RT.coverStretch('redaction', 0, 10 * H, []);
  ok('A2 no task activity → the whole stretch is one queue segment (it sat)', c2.length === 1 && c2[0].phase === 'queue' && c2[0].end - c2[0].start === 10 * H);

  console.log('\n=== B. build() stitches stages + task phases + a hold, and names the bottleneck ===');
  var rid = 'req-RTL-' + Date.now();
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, created_at) VALUES (?,?,?,?,?, 'delivery','active',?)",
    [rid, rid, 'x', 'x@x', 'timeline test', at(0)]);
  async function hist(action, from, to, h) {
    await db.run("INSERT INTO request_history (id, request_id, actor_name, action, stage_from, stage_to, created_at) VALUES (?,?,?,?,?,?,?)",
      ['h-' + rid + '-' + h, rid, 'System', action, from, to, at(h)]);
  }
  await hist('STAGE_ADVANCED', 'intake', 'record_search', 1);
  await hist('STAGE_ADVANCED', 'record_search', 'awaiting_payment', 3);   // hold starts
  await hist('STAGE_ADVANCED', 'awaiting_payment', 'redaction', 6);        // 3h hold
  await hist('STAGE_ADVANCED', 'redaction', 'delivery', 14);
  // task events (direct, with pinned times — no FK on task_events)
  async function ev(taskId, type, to, h) {
    await db.run("INSERT INTO task_events (task_id, request_id, task_type, from_status, to_status, at) VALUES (?,?,?,?,?,?)",
      [taskId, rid, type, null, to, at(h)]);
  }
  await ev('tk-rs', 'record_search', 'open', 1); await ev('tk-rs', 'record_search', 'in_progress', 2);       // RS[1,3]: q 1h, p 1h
  await ev('tk-rd', 'redaction', 'open', 6); await ev('tk-rd', 'redaction', 'in_progress', 8); await ev('tk-rd', 'redaction', 'awaiting_review', 10); // RD[6,14]: q 2h, p 2h, review 4h

  var tl = await RT.build(rid, BASE + 15 * H); // "now" = 15h (delivery [14,15] = 1h)
  ok('B1 the timeline is gap-free from submit to now (segments sum to the total, 15h)',
    Math.abs(sum(tl.segments) - 15 * H) < 1000 && Math.abs(tl.totalMs - 15 * H) < 1000);
  ok('B2 the hold stage becomes a single "hold" segment (3h)', sum(tl.segments, function (s) { return s.phase === 'hold'; }) === 3 * H);
  ok('B3 the redaction stage is split into queue + process + review',
    tl.segments.some(function (s) { return s.stage === 'redaction' && s.phase === 'queue'; }) &&
    tl.segments.some(function (s) { return s.stage === 'redaction' && s.phase === 'process'; }) &&
    tl.segments.some(function (s) { return s.stage === 'redaction' && s.phase === 'review'; }));
  ok('B4 the bottleneck is the longest ACTIONABLE stretch — 4h awaiting review in Redaction',
    tl.bottleneck && tl.bottleneck.phase === 'review' && tl.bottleneck.stage === 'redaction' && tl.bottleneck.durationMs === 4 * H);
  ok('B5 …and it is NOT the hold (holds are the requester’s, excluded)', tl.bottleneck.phase !== 'hold');
  ok('B6 waiting rolls up queue + review + hold (3 + 4 + 3 = 10h); working is the process time (4h)',
    tl.waitingMs === 10 * H && tl.workingMs === 4 * H);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
