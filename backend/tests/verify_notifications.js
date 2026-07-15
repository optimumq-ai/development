'use strict';
// NOTIFICATION MODEL + NULLABLE TASK/FILE LINK — Tasks spec §1-2, Sources spec §4 (Tier 2 #7).
//
// WHAT THIS HARNESS EXISTS TO PREVENT: the SYS-IMPORT pseudo-request wart. Ingestion needed a request to hang
// work on, and tasks.request_id was NOT NULL, so every import source got a standing fake request
// (`sysimport-<repo>`, requestor "File Import", stage delivery). Clicking the resulting task dumped the user
// into a fake request's pipeline. Root cause: a passive heads-up was being modeled as a task-on-a-request.
//
// THE FIX proven here: (A) a first-class Notification model — a request-INDEPENDENT heads-up (title + link, no
// completion UI); (B) tasks.request_id and request_files.request_id made nullable so real request-independent
// work needs no fake request; (C) the import path emits a NOTIFICATION instead of a task-on-a-pseudo-request,
// and anchors files by repository. A future edit that reintroduces the pseudo-request, or drops the nullable
// link, goes RED here.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var N = require('/opt/optimumq/backend/src/services/notifications');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var imp = require('/opt/optimumq/backend/src/services/importIngest');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var PORT = Number(process.env.API_PORT) || 3101;
async function token(id) { var u = await db.get('SELECT * FROM users WHERE id = ?', [id]); return u ? await auth.signAccessToken(u) : null; }
async function api(method, path, tok, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: Object.assign(tok ? { Authorization: 'Bearer ' + tok } : {}, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
}

(async function () {
  await db.initDb();
  var U = 'u-finance-super', V = 'u-police-staff';   // any two distinct seeded users
  ok('S0 both test users exist', !!(await db.get('SELECT id FROM users WHERE id = ?', [U])) && !!(await db.get('SELECT id FROM users WHERE id = ?', [V])));

  console.log('\n=== A. THE NOTIFICATION MODEL (request-independent) ===');
  var TAG = 'ctx-' + Date.now();
  var n1 = await N.emit({ userId: U, kind: 'test', title: 'Heads up', body: 'something happened', link: '/mass-redaction', contextType: 'test', contextId: TAG });
  ok('A1 emit returns a notification with no request dependency', !!n1 && n1.user_id === U && !('request_id' in n1) && !n1.read_at);
  var mine = await N.list(U);
  ok('A2 it appears in the recipient’s list', mine.some(function (x) { return x.id === n1.id; }));
  ok('A3 unread count reflects it', (await N.unreadCount(U)) >= 1);
  var others = await N.list(V);
  ok('A4 it does NOT appear for a different user', !others.some(function (x) { return x.id === n1.id; }));
  // dedupe: same (user, kind, contextId) refreshes in place rather than stacking.
  var n1b = await N.emit({ userId: U, kind: 'test', title: 'Heads up (again)', contextType: 'test', contextId: TAG });
  ok('A5 a duplicate (same user/kind/context) de-dupes to one row', n1b.id === n1.id &&
    (await db.get("SELECT COUNT(*)::int c FROM notifications WHERE user_id = ? AND kind = 'test' AND context_id = ?", [U, TAG])).c === 1);
  await N.markRead(n1.id, U);
  ok('A6 markRead sets read_at', !!(await db.get('SELECT read_at FROM notifications WHERE id = ?', [n1.id])).read_at);
  await N.dismiss(n1.id, U);
  ok('A7 dismiss hides it from the default list', !(await N.list(U)).some(function (x) { return x.id === n1.id; }));

  console.log('\n=== B. THE HTTP SURFACE IS OWNERSHIP-SCOPED ===');
  var tU = await token(U), tV = await token(V);
  var n2 = await N.emit({ userId: U, kind: 'test', title: 'For U only', contextId: 'own-' + Date.now() });
  ok('B1 U sees their notifications over HTTP', (await api('GET', '/notifications', tU)).body.notifications.some(function (x) { return x.id === n2.id; }));
  ok('B2 V cannot read/act on U’s notification (404, ownership-scoped)', (await api('POST', '/notifications/' + n2.id + '/read', tV)).status === 404);
  ok('B3 U can dismiss their own', (await api('POST', '/notifications/' + n2.id + '/dismiss', tU)).status === 200);

  console.log('\n=== C. THE NULLABLE TASK LINK (no fake request needed) ===');
  var t = await tr.createTask({ type: 'review_auto_redaction', title: 'null-request task', createdBy: 'test' });
  ok('C1 a task can be created with NO request_id', !!t && (t.request_id === null || t.request_id === undefined));
  var back = await db.get('SELECT request_id FROM tasks WHERE id = ?', [t.id]);
  ok('C2 …and it persists as NULL, not a placeholder', back && back.request_id === null);

  console.log('\n=== D. THE IMPORT PATH NO LONGER MANUFACTURES A PSEUDO-REQUEST ===');
  var reqBefore = (await db.get("SELECT COUNT(*)::int c FROM requests WHERE id LIKE 'sysimport-%'")).c;
  var btBefore = (await db.get("SELECT COUNT(*)::int c FROM tasks WHERE type = 'build_redaction_template'")).c;
  await imp.routeEndToEnd({ id: 'test-repo-x', name: 'Test Source X' }, { end_to_end: true, review_assignee: U }, ['fa', 'fb']);
  var reqAfter = (await db.get("SELECT COUNT(*)::int c FROM requests WHERE id LIKE 'sysimport-%'")).c;
  var btAfter = (await db.get("SELECT COUNT(*)::int c FROM tasks WHERE type = 'build_redaction_template'")).c;
  ok('D1 ingestion created NO new sysimport pseudo-request', reqAfter === reqBefore);
  ok('D2 …and NO build_redaction_template task', btAfter === btBefore);
  var note = await db.get("SELECT * FROM notifications WHERE user_id = ? AND kind = 'import_template' AND context_id = 'test-repo-x'", [U]);
  ok('D3 instead it emitted an import_template NOTIFICATION to the reviewer', !!note && /Test Source X/.test(note.body || ''));
  ok('D4 …that links to a screen, not a request pipeline', !!note && note.link === '/mass-redaction');
  // Files anchor by repository with a null request_id.
  var fid = 'imp-test-' + Date.now();
  await db.run("INSERT INTO request_files (id, request_id, repository_id, filename, original_name, status) VALUES (?,NULL,?,?,?,?)", [fid, 'test-repo-x', 'x.pdf', 'x.pdf', 'imported']);
  var frow = await db.get('SELECT request_id, repository_id FROM request_files WHERE id = ?', [fid]);
  ok('D5 an import file anchors by repository_id with a NULL request_id', frow && frow.request_id === null && frow.repository_id === 'test-repo-x');

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
