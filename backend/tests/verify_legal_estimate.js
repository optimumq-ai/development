'use strict';
// LEGAL HOURS IN THE ESTIMATE — slice 1: the ask + the answer (DESIGN_legal_hours_estimate.md).
//
// WHAT THIS PREVENTS: the ask reaching someone who isn't legal staff (the answer is a legal
// judgment); a ping with no question or an answer with no basis (both are records the city may
// defend); the answer arriving as prose instead of a structured input (the MRR roll-up
// anti-pattern); a finished ask answerable again (the resolve-route lesson); two live asks on one
// request; an open ask BLOCKING the estimate notice (Kevin decided soft-block); the pool claiming
// hand-assigned legal work; and — the lesson this map keeps re-teaching — a spawnable task type
// with no My Tasks screen entry (unreachable work).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var { v4: uuidv4 } = require('/opt/optimumq/backend/node_modules/uuid');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'LE' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function call(token, method, path, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async function () {
  await db.initDb();
  var ADMIN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));

  // Fixture people through the REAL paths: one legal (granted the legal_review token via the same
  // PATCH Staff Management uses), one plain.
  async function mkUser(name, email) {
    var r = await call(ADMIN, 'POST', '/staff', { displayName: name, email: email, tempPassword: 'Tmp!' + TAG });
    if (r.status !== 200 && r.status !== 201) throw new Error('user create failed: ' + JSON.stringify(r.body));
    return await db.get('SELECT * FROM users WHERE email = ?', [email]);
  }
  var legalU = await mkUser('Legal ' + TAG, 'legal-' + TAG + '@example.com');
  var plainU = await mkUser('Plain ' + TAG, 'plain-' + TAG + '@example.com');
  await call(ADMIN, 'PATCH', '/staff/' + legalU.id + '/task-types', { taskTypes: ['legal_review'] });
  var LEGAL = await auth.signAccessToken(legalU);
  var PLAIN = await auth.signAccessToken(plainU);

  // A real request through the portal (single record — still wrapped in a parent).
  var sub = await fetch('http://localhost:' + PORT + '/api/public/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestorName: 'LE Harness', requestorEmail: 'le-' + TAG + '@example.com',
      description: 'legal estimate test ' + TAG, records: [{ label: 'A', description: 'record for ' + TAG }] })
  });
  ok('setup: request submits (' + sub.status + ')', sub.status >= 200 && sub.status < 300);
  var parent = null;
  for (var i = 0; i < 60 && !parent; i++) {
    parent = await db.get("SELECT id, request_number FROM requests WHERE requestor_email = ? AND master_request_id IS NULL", ['le-' + TAG + '@example.com']);
    if (!parent) await new Promise(function (r2) { setTimeout(r2, 500); });
  }
  if (!parent) throw new Error('parent never appeared');

  console.log('\n=== A. THE ASK — a question, to legal staff, by name ===');
  var noNote = await call(ADMIN, 'POST', '/legal-estimate/request/' + parent.id + '/ask', { assignee_id: legalU.id });
  ok('A1 an ask with no question is refused (422 NOTE_REQUIRED)', noNote.status === 422 && noNote.body.code === 'NOTE_REQUIRED');
  var noWho = await call(ADMIN, 'POST', '/legal-estimate/request/' + parent.id + '/ask', { note: 'exemptions?' });
  ok('A2 an ask with no named person is refused (422 ASSIGNEE_REQUIRED)', noWho.status === 422 && noWho.body.code === 'ASSIGNEE_REQUIRED');
  var notLegal = await call(ADMIN, 'POST', '/legal-estimate/request/' + parent.id + '/ask', { assignee_id: plainU.id, note: 'exemptions?' });
  ok('A3 asking someone without the Legal Review token is refused in words (422 NOT_LEGAL)',
    notLegal.status === 422 && notLegal.body.code === 'NOT_LEGAL' && new RegExp(plainU.display_name).test(notLegal.body.error));
  var ask1 = await call(ADMIN, 'POST', '/legal-estimate/request/' + parent.id + '/ask',
    { assignee_id: legalU.id, note: 'PD investigation exemptions on item A' });
  var t1 = ask1.body && await db.get('SELECT * FROM tasks WHERE id = ?', [ask1.body.task_id]);
  ok('A4 the ask is a real assigned task: type legal_estimate, its own unclaimable role key, assigned to the legal person',
    ask1.status === 200 && t1 && t1.type === 'legal_estimate' && t1.role_required === 'legal_estimate' &&
    t1.assigned_to === legalU.id && t1.status === 'assigned');
  var row1 = await db.get('SELECT * FROM legal_estimate_inputs WHERE task_id = ?', [t1.id]);
  ok('A5 the question is stored structured (ask_note, asker, no hours yet)',
    !!row1 && row1.ask_note === 'PD investigation exemptions on item A' && row1.hours == null && row1.superseded === 0);
  var h1 = await db.get("SELECT count(*)::int n FROM request_history WHERE request_id = ? AND action = 'LEGAL_HOURS_REQUESTED'", [parent.id]);
  ok('A6 the ask lands in request_history', h1.n === 1);
  ok('A7 catalog shape: hand-assigned, never routable (no pool can ever claim it)',
    tr.HAND_ASSIGNED_TASK_TYPES.indexOf('legal_estimate') >= 0 && tr.ROUTABLE_TASK_TYPES.indexOf('legal_estimate') === -1);

  console.log('\n=== B. THE ANSWER — hours + basis, by the assignee only ===');
  var wrongPerson = await call(PLAIN, 'POST', '/legal-estimate/task/' + t1.id + '/complete', { hours: 2, note: 'x' });
  ok('B1 a non-assignee cannot answer (403 NOT_YOURS)', wrongPerson.status === 403 && wrongPerson.body.code === 'NOT_YOURS');
  var noHours = await call(LEGAL, 'POST', '/legal-estimate/task/' + t1.id + '/complete', { note: 'basis' });
  ok('B2 an answer without hours is refused (422)', noHours.status === 422 && noHours.body.code === 'HOURS_REQUIRED');
  var noBasis = await call(LEGAL, 'POST', '/legal-estimate/task/' + t1.id + '/complete', { hours: 3.5 });
  ok('B3 an answer without a basis is refused (422 NOTE_REQUIRED)', noBasis.status === 422 && noBasis.body.code === 'NOTE_REQUIRED');
  var ans1 = await call(LEGAL, 'POST', '/legal-estimate/task/' + t1.id + '/complete',
    { hours: 3.5, note: 'Two exemption families to brief; expect redaction consult.' });
  var row1b = await db.get('SELECT * FROM legal_estimate_inputs WHERE id = ?', [row1.id]);
  var t1b = await db.get('SELECT status FROM tasks WHERE id = ?', [t1.id]);
  ok('B4 the answer records structured hours + note and closes the task',
    ans1.status === 200 && Number(row1b.hours) === 3.5 && /exemption families/.test(row1b.note) &&
    row1b.entered_by === legalU.id && t1b.status === 'done');
  var h2 = await db.get("SELECT count(*)::int n FROM request_history WHERE request_id = ? AND action = 'LEGAL_HOURS_ESTIMATED'", [parent.id]);
  ok('B5 the answer lands in request_history', h2.n === 1);
  var again = await call(LEGAL, 'POST', '/legal-estimate/task/' + t1.id + '/complete', { hours: 9, note: 'again' });
  ok('B6 a finished ask cannot be answered again (409, the resolve-route lesson)',
    again.status === 409 && again.body.code === 'TASK_NOT_ACTIONABLE' && Number((await db.get('SELECT hours FROM legal_estimate_inputs WHERE id = ?', [row1.id])).hours) === 3.5);

  console.log('\n=== C. THE PANEL READ + RE-ASK — one live question, one current answer ===');
  var panel1 = await call(ADMIN, 'GET', '/legal-estimate/request/' + parent.id);
  ok('C1 the panel sees the answer (and no open ask)',
    panel1.status === 200 && panel1.body.open === null && panel1.body.answer && Number(panel1.body.answer.hours) === 3.5);
  var ask2 = await call(ADMIN, 'POST', '/legal-estimate/request/' + parent.id + '/ask',
    { assignee_id: legalU.id, note: 'scope changed — item B added' });
  var panel2 = await call(ADMIN, 'GET', '/legal-estimate/request/' + parent.id);
  ok('C2 a re-ask shows BOTH: the standing answer and the new open question (named to its assignee)',
    ask2.status === 200 && panel2.body.open && panel2.body.open.assignee_name === legalU.display_name &&
    panel2.body.answer && Number(panel2.body.answer.hours) === 3.5);
  var ask3 = await call(ADMIN, 'POST', '/legal-estimate/request/' + parent.id + '/ask',
    { assignee_id: legalU.id, note: 'asked twice by mistake' });
  var t2dead = await db.get('SELECT status FROM tasks WHERE id = ?', [ask2.body.task_id]);
  var liveOpen = await db.get('SELECT count(*)::int n FROM legal_estimate_inputs WHERE request_id = ? AND hours IS NULL AND superseded = 0', [parent.id]);
  ok('C3 asking again while one is open CANCELS the old task and supersedes its row — one live question',
    ask3.status === 200 && t2dead.status === 'cancelled' && liveOpen.n === 1);
  var ans2 = await call(LEGAL, 'POST', '/legal-estimate/task/' + ask3.body.task_id + '/complete', { hours: 5, note: 'item B adds a records-hold review' });
  var oldRow = await db.get('SELECT superseded FROM legal_estimate_inputs WHERE id = ?', [row1.id]);
  var panel3 = await call(ADMIN, 'GET', '/legal-estimate/request/' + parent.id);
  ok('C4 a new answer supersedes the old one — the panel shows exactly the current 5 hours',
    ans2.status === 200 && oldRow.superseded === 1 && Number(panel3.body.answer.hours) === 5 && panel3.body.open === null);

  console.log('\n=== D. SOFT BLOCK — an open ask never stops the estimate notice (Kevin, 2026-08-13) ===');
  await call(ADMIN, 'POST', '/legal-estimate/request/' + parent.id + '/ask', { assignee_id: legalU.id, note: 'still checking one statute' });
  await db.run("INSERT INTO request_fee_estimates (id, request_id, kind, input_json, fee_context_json, total, deposit_due, notify_flag, created_by, created_at, seq) " +
    "VALUES (?,?,'estimate','{}','{}',12.5,0,1,'harness',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')," +
    "COALESCE((SELECT MAX(seq) FROM request_fee_estimates WHERE request_id = ?),0)+1)", [uuidv4(), parent.id, parent.id]);
  var send = await call(ADMIN, 'POST', '/fee-estimates/request/' + parent.id + '/notice/send',
    { subject: 'Estimate ' + TAG, text: 'Your estimate is $12.50.' });
  ok('D1 the notice SENDS with a legal ask open — pending legal hours warn, they do not gate',
    send.status === 200);

  console.log('\n=== E. REACHABILITY — the spawned type has a screen (the lesson, locked again) ===');
  var FE = '/opt/optimumq/frontend/src';
  var myTasks = fs.readFileSync(FE + '/pages/MyTasksPage.js', 'utf8');
  var screenMap = (myTasks.match(/var TASK_SCREEN = \{[\s\S]*?\n\};/) || [''])[0];
  var app = fs.readFileSync(FE + '/App.js', 'utf8');
  ok('E1 MyTasksPage routes legal_estimate to its screen and App.js carries the route',
    /legal_estimate:\s*function/.test(screenMap) && /legal-estimate\/:taskId/.test(app) &&
    fs.existsSync(FE + '/pages/LegalEstimateTaskPage.js'));

  console.log('\n=== G. PARENT-LEVEL ON A TRUE MRR (slice 4) — one ask for the whole request ===');
  // Exemption analysis spans items, so the ask is deliberately PARENT-level, never a per-child
  // activity: one ask, one answer, feeding the ONE master estimate.
  var subM = await fetch('http://localhost:' + PORT + '/api/public/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestorName: 'LE MRR Harness', requestorEmail: 'lemrr-' + TAG + '@example.com',
      description: 'IA complaints and dispatch logs ' + TAG,
      records: [{ label: 'IA', description: 'IA complaints ' + TAG }, { label: 'Dispatch', description: 'dispatch logs ' + TAG }] })
  });
  ok('G0 a 2-item MRR submits (' + subM.status + ')', subM.status >= 200 && subM.status < 300);
  var mrrParent = null;
  for (var im = 0; im < 60 && !mrrParent; im++) {
    mrrParent = await db.get('SELECT id, is_mrr FROM requests WHERE requestor_email = ? AND master_request_id IS NULL', ['lemrr-' + TAG + '@example.com']);
    if (!mrrParent) await new Promise(function (r2) { setTimeout(r2, 500); });
  }
  var kids = await db.get('SELECT count(*)::int n FROM requests WHERE master_request_id = ?', [mrrParent.id]);
  ok('G1 the parent is a real MRR (2 children)', Number(mrrParent.is_mrr) === 1 && kids.n === 2);
  var askM = await call(ADMIN, 'POST', '/legal-estimate/request/' + mrrParent.id + '/ask',
    { assignee_id: legalU.id, note: 'exemptions across both items' });
  var ansM = await call(LEGAL, 'POST', '/legal-estimate/task/' + askM.body.task_id + '/complete',
    { hours: 6, note: 'IA exemptions dominate; dispatch adds a CAD-log review' });
  var panelM = await call(ADMIN, 'GET', '/legal-estimate/request/' + mrrParent.id);
  ok('G2 ask -> answer -> read all work against the MRR PARENT, same rails as a single-record request',
    askM.status === 200 && ansM.status === 200 && panelM.body.answer && Number(panelM.body.answer.hours) === 6);
  var childAsk = await db.get("SELECT count(*)::int n FROM legal_estimate_inputs l JOIN requests r ON r.id = l.request_id WHERE r.master_request_id = ?", [mrrParent.id]);
  ok('G3 nothing landed on a CHILD — the exchange is a parent fact', childAsk.n === 0);
  var hubSrc = fs.readFileSync(FE + '/pages/MrrMasterPage.js', 'utf8');
  ok('G4 the hub master carries the parent-level ask control (the reachability lesson, hub edition)',
    /legal-estimate\/request/.test(hubSrc) && /Ask legal for hours/.test(hubSrc));

  console.log('\n=== F. LEAVE THE WORLD AS FOUND ===');
  // Children first by master link (master_request_id carries no FK), then the parents by email.
  await db.run('DELETE FROM requests WHERE master_request_id IN (SELECT id FROM requests WHERE requestor_email = ANY($1::text[]))',
    [['le-' + TAG + '@example.com', 'lemrr-' + TAG + '@example.com']]);
  await db.run('DELETE FROM requests WHERE requestor_email = ANY($1::text[])', [['le-' + TAG + '@example.com', 'lemrr-' + TAG + '@example.com']]); // cascades tasks + inputs + snapshots
  await db.run('DELETE FROM user_task_types WHERE user_id = ANY($1::text[])', [[legalU.id, plainU.id]]);
  await db.run('DELETE FROM user_function_roles WHERE user_id = ANY($1::text[])', [[legalU.id, plainU.id]]);
  await db.run('DELETE FROM users WHERE id = ANY($1::text[])', [[legalU.id, plainU.id]]);
  var left = await db.get(
    "SELECT (SELECT count(*) FROM requests WHERE requestor_email LIKE ?) + (SELECT count(*) FROM users WHERE email LIKE ?) " +
    "+ (SELECT count(*) FROM legal_estimate_inputs l WHERE NOT EXISTS (SELECT 1 FROM requests r WHERE r.id = l.request_id)) AS n",
    ['%' + TAG + '@example.com', '%' + TAG + '@example.com']);
  ok('F1 fixture request family, users, and any orphaned inputs are gone', Number(left.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
