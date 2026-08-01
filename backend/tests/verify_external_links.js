'use strict';
// EXTERNAL-CONTRIBUTOR SECURE LINKS (2026-08-01) — the substrate BW6 refused to fake, now real and pinned.
//
// The claims under test, from the standing design (Draft 5 §2: "secure, expiring, single-use; state on
// the bar") as read by services/externalContributor.js:
//   1. HASH-ONLY STORAGE. The database holds sha256(token); the raw token exists in the emailed URL and
//      the RM's re-send response, nowhere else. A database read cannot mint a working link.
//   2. SINGLE-ASSIGNMENT. Exactly one ACTIVE link per (item, activity): re-issue supersedes, reassigning
//      to a person revokes, completion closes.
//   3. SCOPED PAYLOAD. The page gets the item's verbatim words and the activity — never the requestor's
//      name or email, never money, never sibling items.
//   4. THE CORE MRR RULE HOLDS EXTERNALLY. Completion lands through completeActivity: the hub updates,
//      the STAGE DOES NOT MOVE.
//   5. REFUSALS DO NOT NARRATE. Unknown 404; expired/revoked 410; completed GET is thanks (200) but
//      completed WRITES are 410. Mail never leaves a test run (the coverageGap rule).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var XC = require('/opt/optimumq/backend/src/services/externalContributor');
var HUB = require('/opt/optimumq/backend/src/services/mrrHub');
var uuidv4 = require('uuid').v4;

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'XLINK-' + Date.now();
var EXT = 'custodian@other-agency.example.gov';
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sha(t) { return crypto.createHash('sha256').update(String(t), 'utf8').digest('hex'); }

function req(method, p, body, token) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || TOKEN) } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j, raw: d }); });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}
// A real multipart POST, because the contributor's uploads are the point of the page.
function uploadReq(p, filename, content) {
  return new Promise(function (res, rej) {
    var boundary = '----xlink' + Date.now();
    var body = Buffer.concat([
      Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: text/plain\r\n\r\n'),
      Buffer.from(content),
      Buffer.from('\r\n--' + boundary + '--\r\n')
    ]);
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j }); });
    });
    r.on('error', rej);
    r.write(body); r.end();
  });
}

var created = [];
async function makeRequest(id, fields) {
  fields = fields || {};
  await db.run(
    'INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id, master_request_id, is_mrr, component_label) ' +
    "VALUES (?,?,?,?,?,?,'active',?,?,?,?)",
    [id, id, 'Citizen Requestor', 'citizen-' + TAG + '@example.com',
     fields.description || ('xlink harness ' + TAG), fields.stage || 'record_search',
     fields.departmentId || null, fields.parentId || null, fields.isMrr ? 1 : 0, fields.label || null]);
  created.push(id);
  return id;
}
async function makeMrr(opts) {
  opts = opts || {};
  var pid = await makeRequest('req-' + TAG + '-P', { departmentId: opts.departmentId, isMrr: true,
    description: 'Everything about the Barton Creek trail rebuild.' });
  var kid = await makeRequest('req-' + TAG + '-C1', { departmentId: opts.departmentId, parentId: pid,
    label: 'Item 1', description: 'The drone footage of the rebuild, as the requestor wrote it.' });
  var t = await tr.createTask({ requestId: pid, type: 'mrr_management', teamId: null, createdBy: 'xlink-harness' });
  if (opts.manager) await db.run("UPDATE tasks SET assigned_to = ?, status = 'in_progress' WHERE id = ?", [opts.manager, t.id]);
  return { parentId: pid, kid: kid, taskId: t.id };
}
async function linkRows(childId) {
  return await db.all('SELECT * FROM mrr_external_links WHERE request_id = ? ORDER BY created_at, id', [childId]);
}
function tokenFromUrl(url) { return String(url || '').split('/contribute/')[1]; }

(async function () {
  await db.initDb();
  try {
    var users = await db.all("SELECT * FROM users WHERE status = 'active' AND department_id IS NOT NULL ORDER BY id LIMIT 3");
    var mgr = users[0], worker = users[1] || users[0], stranger = users[2] || users[0];
    TOKEN = await auth.signAccessToken(mgr);
    var STRANGER_TOKEN = await auth.signAccessToken(stranger);
    var fx = await makeMrr({ departmentId: mgr.department_id, manager: mgr.id });

    // ================================================================================================
    console.log('\n=== A. ISSUE — hash-only storage, one active link, no mail from a test run ===');
    var a1 = await req('POST', '/api/mrr/item/' + fx.kid + '/activity/search/assign', { externalEmail: EXT.toUpperCase() });
    var actA = (a1.body.activities || []).filter(function (x) { return x.activity === 'search'; })[0];
    ok('A1 assigning externally answers with the activity queued on an external basis',
      a1.status === 200 && actA && actA.status === 'queued' && actA.assignment_basis === 'external');
    ok('A1b ...and the bar state is REAL now: linkState "sent", never a placeholder',
      actA.external && actA.external.linkState === 'sent' && actA.external.email === EXT.toLowerCase());
    var rows = await linkRows(fx.kid);
    ok('A2 the store holds a sha256 HASH (64 hex), the address lowercased, status active',
      rows.length === 1 && /^[0-9a-f]{64}$/.test(rows[0].token_hash) && rows[0].email === EXT.toLowerCase() && rows[0].status === 'active');
    var a3 = await req('POST', '/api/mrr/item/' + fx.kid + '/activity/search/external-link/resend', {});
    var RAW = tokenFromUrl(a3.body.url);
    rows = await linkRows(fx.kid);
    var active = rows.filter(function (r) { return r.status === 'active'; });
    ok('A3 re-send RE-ISSUES: the returned URL\'s token hashes to the NEW row; exactly one active link; the old one reads "superseded"',
      !!RAW && active.length === 1 && sha(RAW) === active[0].token_hash && rows.length === 2 &&
      rows.some(function (r) { return r.status === 'revoked' && /superseded/.test(r.revoked_by || ''); }));
    ok('A4 no mail leaves a test run (the coverageGap rule) — reason says so',
      a3.body.mail && a3.body.mail.sent === false && a3.body.mail.reason === 'test_db');
    var a5 = await req('POST', '/api/mrr/item/' + fx.kid + '/activity/search/external-link/resend', {}, STRANGER_TOKEN);
    ok('A5 re-send is the manager\'s act — a stranger gets the NOT_THE_MANAGER refusal', a5.status === 403);

    // ================================================================================================
    console.log('\n=== B. THE PAGE — scoped payload, counted opens, honest refusals ===');
    var b1 = await req('GET', '/api/contribute/' + RAW);
    ok('B1 the page answers with the item\'s VERBATIM words and the activity asked',
      b1.status === 200 && /as the requestor wrote it/.test(b1.body.description || '') && b1.body.activity === 'search');
    ok('B1b ...and the payload NEVER carries the requestor\'s identity — scoped to the assignment',
      b1.raw.indexOf('Citizen Requestor') < 0 && b1.raw.indexOf('citizen-' + TAG) < 0);
    ok('B1c ...one voice: the contact offered is the Request Manager',
      b1.body.requestManager && b1.body.requestManager.name === mgr.display_name);
    await req('GET', '/api/contribute/' + RAW);
    var st = await XC.stateFor(fx.kid, 'search');
    ok('B2 every open is counted — two opens, state "opened"', st.openCount === 2 && st.linkState === 'opened');
    var b3 = await req('GET', '/api/contribute/' + 'f'.repeat(64));
    ok('B3 an unknown token is 404 and learns nothing else', b3.status === 404);
    var b4 = await req('POST', '/api/contribute/' + RAW + '/note', { note: 'The footage runs 40 minutes; two files.' });
    var noteRow = await db.get("SELECT * FROM request_history WHERE request_id = ? AND action = 'MRR_EXTERNAL_NOTE'", [fx.kid]);
    ok('B4 a note lands on the item\'s history, attributed to the external address',
      b4.status === 200 && !!noteRow && noteRow.actor_name === EXT.toLowerCase() + ' (external)');
    var b5 = await uploadReq('/api/contribute/' + RAW + '/files', 'drone-footage-index.txt', 'file one of two');
    var fileRow = await db.get('SELECT * FROM request_files WHERE request_id = ? AND uploaded_by = ?', [fx.kid, 'external: ' + EXT.toLowerCase()]);
    ok('B5 an upload lands on the item, marked as the external contributor\'s', b5.status === 201 && !!fileRow);
    var b5b = await req('GET', '/api/contribute/' + RAW);
    ok('B5b ...and the page lists THEIR uploads back to them',
      (b5b.body.yourUploads || []).some(function (f) { return f.name === 'drone-footage-index.txt'; }));
    var b6 = await uploadReq('/api/contribute/' + RAW + '/files', 'malware.exe', 'nope');
    var exeRow = await db.get("SELECT id FROM request_files WHERE request_id = ? AND original_name = 'malware.exe'", [fx.kid]);
    ok('B6 the staff screen\'s file-type envelope holds here too — .exe refused, nothing stored',
      b6.status >= 400 && !exeRow);

    // ================================================================================================
    console.log('\n=== C. COMPLETION — through the same door, and the stage does not move ===');
    var c1 = await req('POST', '/api/contribute/' + RAW + '/complete', { note: 'Both files uploaded.' });
    var actRow = await db.get("SELECT * FROM mrr_tasks WHERE request_id = ? AND activity = 'search'", [fx.kid]);
    ok('C1 completion writes the activity complete on an EXTERNAL basis, by the address',
      c1.status === 200 && actRow.status === 'complete' && actRow.completion_basis === 'external' &&
      actRow.completed_by_name === EXT.toLowerCase() + ' (external)');
    var stage = await db.get('SELECT stage FROM requests WHERE id = ?', [fx.kid]);
    ok('C1b ...and the STAGE DID NOT MOVE — the hub updated, the pipeline stayed the RM\'s',
      stage.stage === 'record_search');
    var c2 = await req('GET', '/api/contribute/' + RAW);
    ok('C2 the completed link still answers — thanks is not an error', c2.status === 200 && c2.body.linkState === 'completed');
    var c3 = await req('POST', '/api/contribute/' + RAW + '/note', { note: 'one more thing' });
    var c3b = await req('POST', '/api/contribute/' + RAW + '/complete', {});
    ok('C3 but a completed assignment accepts nothing more — writes are 410', c3.status === 410 && c3b.status === 410);
    var m = await HUB.master(fx.parentId);
    ok('C4 the master bar shows the truth: external complete',
      m.items[0].external && m.items[0].external.linkState === 'completed');

    // ================================================================================================
    console.log('\n=== D. EXPIRY, REVOCATION, REASSIGNMENT ===');
    await req('POST', '/api/mrr/item/' + fx.kid + '/activity/estimate/assign', { externalEmail: EXT });
    var d1 = await req('POST', '/api/mrr/item/' + fx.kid + '/activity/estimate/external-link/resend', {});
    var RAW2 = tokenFromUrl(d1.body.url);
    await req('POST', '/api/mrr/item/' + fx.kid + '/activity/estimate/external-link/revoke', {});
    var d2 = await req('GET', '/api/contribute/' + RAW2);
    ok('D1 a revoked link is 410, naming the state', d2.status === 410 && d2.body.state === 'revoked');
    var d3issue = await XC.issue(fx.kid, 'estimate', EXT, { send: false });
    var RAW3 = tokenFromUrl(d3issue.url);
    await db.run("UPDATE mrr_external_links SET expires_at = '2020-01-01 00:00:00' WHERE token_hash = ?", [sha(RAW3)]);
    var d3 = await req('GET', '/api/contribute/' + RAW3);
    ok('D2 an expired link is 410, and the bar would say EXPIRED',
      d3.status === 410 && d3.body.state === 'expired' && (await XC.stateFor(fx.kid, 'estimate')).linkState === 'expired');
    var d4issue = await XC.issue(fx.kid, 'estimate', EXT, { send: false });
    await req('POST', '/api/mrr/item/' + fx.kid + '/activity/estimate/assign', { assigneeId: worker.id });
    var d4rows = (await linkRows(fx.kid)).filter(function (r) { return r.activity === 'estimate'; });
    ok('D3 reassigning to a PERSON revokes the outstanding external link — it was cut for someone who no longer holds the work',
      d4rows.every(function (r) { return r.status !== 'active'; }) &&
      d4rows.some(function (r) { return /reassigned to/.test(r.revoked_by || ''); }));
    var d5 = await req('GET', '/api/contribute/' + tokenFromUrl(d4issue.url));
    ok('D3b ...and that link answers 410 revoked to its holder', d5.status === 410 && d5.body.state === 'revoked');

  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack);
    fail++;
  } finally {
    try {
      // Physical upload files first, then rows, then the requests themselves.
      var files = await db.all("SELECT filename FROM request_files WHERE request_id IN (SELECT id FROM requests WHERE request_number LIKE ?)", ['%' + TAG + '%']);
      files.forEach(function (f) {
        try { fs.unlinkSync(path.join('/opt/optimumq/uploads', f.filename)); } catch (e) {}
      });
      for (var c = 0; c < created.length; c++) {
        try { await db.run('DELETE FROM mrr_external_links WHERE request_id = ?', [created[c]]); } catch (e) {}
      }
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t2 = 0; t2 < tabs.length; t2++) for (var c2 = 0; c2 < created.length; c2++) {
        try { await db.run('DELETE FROM ' + tabs[t2].table_name + ' WHERE request_id=?', [created[c2]]); } catch (e) {}
      }
      for (var c3 = 0; c3 < created.length; c3++) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c3]]); } catch (e) {} }
      var left = await db.get('SELECT COUNT(*)::int AS n FROM requests WHERE request_number LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 harness requests left', Number(left.n) === 0);
      var leftL = await db.get('SELECT COUNT(*)::int AS n FROM mrr_external_links WHERE email = ?', [EXT.toLowerCase()]);
      ok('cleanup: 0 harness links left', Number(leftL.n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e && e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
