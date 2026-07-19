'use strict';
// THE RECORD-SEARCH SURFACE + RESOLUTION (SPEC_record_search_task_screen §4a, §5d).
//
// Three things here are load-bearing, and each one fails SILENTLY if it is wrong:
//
//   1. THE BLOB IS COPIED, NOT SHARED. Attaching a found record could just point the new request_files row
//      at the SAME `filename` on disk. But DELETE /files/:fileId UNLINKS THE FILE. So removing the record
//      from THIS request would destroy it inside the OTHER one -- a released record in a citizen's already
//      fulfilled request, gone, with nothing anywhere saying why.
//
//   2. "FOUND" REFUSES AN EMPTY SEARCH. workflowModel already DECLARES the gate ("enough-to-advance: at
//      least one record marked Include in Response") and nothing enforced it. Advancing an empty search
//      hands redaction a request with nothing in it.
//
//   3. "NO RESPONSIVE RECORDS" REFUSES AN EMPTY EFFORT TRAIL. That closure is a legal act. Per the BWC
//      research up to 40% of dispatches that should have body-cam video HAVE NONE, so it is a MODAL
//      outcome -- which is exactly why it must be EVIDENCED. A closure with nothing logged is
//      indistinguishable from never having looked.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var http = require('http');
var fs = require('fs');
var path = require('path');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');

var PORT = Number(process.env.API_PORT) || 3101;
var UPLOAD_DIR = path.join(__dirname, '../../uploads');
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, p, body) {
  return new Promise(function (res, rej) {
    var b = body ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN };
    if (b) h['Content-Length'] = Buffer.byteLength(b);
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method, headers: h }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j }); });
    });
    r.on('error', rej); if (b) r.write(b); r.end();
  });
}
// Build a request that is genuinely SITTING IN record_search, the way a real one is when the searcher
// opens it. Moving it there through the central transition (rather than minting a bare task against a
// request still parked in `intake`) is what makes the D4 stage_from assertion mean anything.
async function mkTask(desc) {
  var made = await RC.createRequest(
    { requestorName: 'Resolve Test', requestorEmail: 'resolve@example.com', description: desc, deliveryMethod: 'email' },
    { actorId: 'test', actorName: 'Test', historyAction: 'CREATED', kickIntake: false });
  await tr.applyStageTransition(made.id, 'record_search',
    { actorId: 'test', actorName: 'Test', action: 'STAGE_ADVANCED', notes: 'Into record search for the test.' });
  var t = await db.get(
    "SELECT id FROM tasks WHERE request_id = ? AND type = 'record_search' ORDER BY created_at DESC LIMIT 1", [made.id]);
  if (!t) t = await tr.createTask({ requestId: made.id, type: 'record_search', title: 'Record search', createdBy: 'test' });
  return { rid: made.id, tid: t.id };
}
async function stageOf(rid) { return (await db.get('SELECT stage FROM requests WHERE id = ?', [rid])).stage; }

(async function () {
  await db.initDb();
  var u = await db.get('SELECT * FROM users LIMIT 1');
  TOKEN = await auth.signAccessToken(u);

  // Build our OWN source record with a real blob on disk. The deterministic fixture deliberately carries
  // no transactional rows, so leaning on fulfilled_records here would make the harness depend on live-shaped
  // data that the fixture is designed NOT to have. Stand the source up ourselves: it is the "already
  // released record in someone else's fulfilled request" whose blob must survive C9.
  var uuidv4 = require('uuid').v4;
  var donor = await RC.createRequest(
    { requestorName: 'Donor', requestorEmail: 'donor@example.com', description: 'A previously released record.', deliveryMethod: 'email' },
    { actorId: 'test', actorName: 'Test', historyAction: 'CREATED', kickIntake: false });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  var srcDisk = uuidv4() + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, srcDisk), Buffer.from('%PDF-1.4 released record bytes\n'));
  var srcFileId = uuidv4();
  await db.run(
    'INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, responsive, uploaded_by) VALUES (?,?,?,?,?,?,?,?)',
    [srcFileId, donor.id, srcDisk, 'Released - CAD-2025-00001.pdf', 'application/pdf', 31, 1, 'test']);
  var src = { id: 'fr-test', title: 'Released record', file_id: srcFileId, filename: srcDisk,
              original_name: 'Released - CAD-2025-00001.pdf' };
  ok('A1 a source record with a real blob on disk exists to attach',
     !!src.file_id && fs.existsSync(path.join(UPLOAD_DIR, srcDisk)));

  // =============================================================================================
  // B. "FOUND" REFUSES AN EMPTY SEARCH — the declared-but-unenforced gate.
  // =============================================================================================
  var a = await mkTask('Nothing has been included yet.');
  var stage0 = await stageOf(a.rid);
  var r1 = await req('POST', '/api/tasks/' + a.tid + '/resolve', { outcome: 'found' });
  ok('B1 found with 0 records included is REFUSED (422)', r1.status === 422);
  ok('B2 ...with a code the UI can act on', r1.body && r1.body.code === 'NOTHING_INCLUDED');
  ok('B3 ...and THE STAGE DID NOT MOVE', (await stageOf(a.rid)) === stage0);
  var tsk = await db.get('SELECT status FROM tasks WHERE id = ?', [a.tid]);
  ok('B4 ...and the task was NOT completed', tsk.status !== 'done');

  // =============================================================================================
  // C. ATTACH — and THE BLOB MUST BE COPIED, NOT SHARED.
  // =============================================================================================
  var at = await req('POST', '/api/files/attach/' + a.rid, {
    record: { id: 'fulfilled:' + src.id, title: src.title, sourceSystem: 'Fulfilled Request Index', fileId: src.file_id },
    includeInResponse: true
  });
  if (at.status !== 200) console.log('    DEBUG attach ->', at.status, JSON.stringify(at.body));
  ok('C1 attach succeeds', at.status === 200 && at.body && at.body.success);
  var newFile = await db.get('SELECT * FROM request_files WHERE id = ?', [at.body.fileId]);
  ok('C2 the record landed on THIS request', newFile && newFile.request_id === a.rid);
  ok('C3 ...marked Include in Response', Number(newFile.responsive) === 1);
  ok('C4 ...keeping the original name', newFile.original_name === src.original_name);

  // THE ONE THAT MATTERS.
  ok('C5 THE BLOB WAS COPIED — the new row does NOT reuse the source path', newFile.filename !== src.filename);
  var srcPath = path.join(UPLOAD_DIR, src.filename);
  var newPath = path.join(UPLOAD_DIR, newFile.filename);
  ok('C6 ...and both files exist on disk', fs.existsSync(srcPath) && fs.existsSync(newPath));
  ok('C7 ...with identical bytes', fs.readFileSync(srcPath).equals(fs.readFileSync(newPath)));

  // Delete the ATTACHED copy. The SOURCE — a released record in someone else's fulfilled request —
  // must survive. If the path had been shared, this would silently destroy it.
  var del = await req('DELETE', '/api/files/' + at.body.fileId, null);
  ok('C8 deleting the attached copy succeeds', del.status === 200);
  ok('C9 THE SOURCE RECORD SURVIVED — deleting our copy did NOT unlink the released file',
     fs.existsSync(srcPath));

  var histA = await db.get(
    "SELECT count(*)::int AS n FROM request_history WHERE request_id = ? AND action = 'RECORD_ATTACHED'", [a.rid]);
  ok('C10 the attach is on the effort trail', histA.n === 1);

  // A record with no retrievable file cannot be attached — the connectors that would pull it are stubs.
  var noFile = await req('POST', '/api/files/attach/' + a.rid, {
    record: { id: 'tyler:123', title: 'Some record', sourceSystem: 'Tyler Munis' }, includeInResponse: true });
  ok('C11 a record with NO file is refused, not attached as an empty row', noFile.status === 422);
  ok('C12 ...and says WHY (retrieval required)', noFile.body && noFile.body.code === 'RETRIEVAL_REQUIRED');

  // =============================================================================================
  // D. "FOUND" with a record included — advances through the CENTRAL transition.
  // =============================================================================================
  var b2 = await mkTask('Has a record.');
  await req('POST', '/api/files/attach/' + b2.rid, {
    record: { id: 'fulfilled:' + src.id, title: src.title, sourceSystem: 'Fulfilled Request Index', fileId: src.file_id },
    includeInResponse: true });
  var r2 = await req('POST', '/api/tasks/' + b2.tid + '/resolve', { outcome: 'found' });
  ok('D1 found succeeds once a record is included', r2.status === 200 && r2.body.included === 1);
  // Flipped 2026-07-19 (Kevin, brief §5) — finding records is not a claim that anything is exempt.
  ok('D2 the request advanced to redaction_review', (await stageOf(b2.rid)) === 'redaction_review');
  var t2 = await db.get('SELECT status FROM tasks WHERE id = ?', [b2.tid]);
  ok('D3 the search task is done', t2.status === 'done');
  // The central transition is the ONLY thing that writes stage_from/stage_to. Its presence proves we did
  // not sneak a raw `UPDATE requests SET stage` in (ARCHITECTURE item 6).
  var trans = await db.get(
    "SELECT stage_from, stage_to FROM request_history WHERE request_id = ? AND action = 'SEARCH_COMPLETE'", [b2.rid]);
  ok('D4 it went through the CENTRAL stage transition (stage_from/stage_to written)',
     !!trans && trans.stage_from === 'record_search' && trans.stage_to === 'redaction_review');

  // =============================================================================================
  // E. "NO RESPONSIVE RECORDS" REFUSES AN EMPTY EFFORT TRAIL.
  // =============================================================================================
  var c = await mkTask('Nothing was ever done on this one.');
  var stageC = await stageOf(c.rid);
  var r3 = await req('POST', '/api/tasks/' + c.tid + '/resolve', { outcome: 'no_records' });
  ok('E1 closing with an EMPTY effort trail is REFUSED (422)', r3.status === 422);
  ok('E2 ...with a code the UI can act on', r3.body && r3.body.code === 'NO_EFFORT_TRAIL');
  ok('E3 ...and the request was NOT closed', (await stageOf(c.rid)) === stageC);

  // Log ONE action. Now the closure is evidenced, and permitted.
  await req('POST', '/api/requests/' + c.rid + '/effort', { action: 'CALL_LOGGED', notes: 'Called the custodian; no such record.' });
  var r4 = await req('POST', '/api/tasks/' + c.tid + '/resolve', { outcome: 'no_records' });
  ok('E4 with the search EVIDENCED, the closure is permitted', r4.status === 200);
  ok('E5 ...and it reports how much evidence it had', r4.body.effortEntries >= 1);
  ok('E6 the request is CLOSED', (await stageOf(c.rid)) === 'closed');
  var cr = await db.get('SELECT closure_reason FROM requests WHERE id = ?', [c.rid]);
  ok('E7 ...with closure_reason = no_records', cr.closure_reason === 'no_records');
  var trans2 = await db.get(
    "SELECT stage_from, stage_to, notes FROM request_history WHERE request_id = ? AND action = 'CLOSED_NO_RECORDS'", [c.rid]);
  ok('E8 the closure went through the CENTRAL transition', !!trans2 && trans2.stage_to === 'closed');
  ok('E9 ...and the trail RECORDS the diligence it relied on', /evidenced by \d+ logged action/.test(trans2.notes || ''));

  // =============================================================================================
  // F. The effort endpoint will not let a caller forge the audit trail.
  // =============================================================================================
  var forge = await req('POST', '/api/requests/' + c.rid + '/effort',
    { action: 'CLARIFICATION_REQUESTED', notes: 'forged' });
  ok('F1 an arbitrary history action is REFUSED — the audit trail cannot be forged', forge.status === 400);
  var forge2 = await req('POST', '/api/requests/' + c.rid + '/effort', { action: 'STAGE_ADVANCED', notes: 'forged' });
  ok('F2 ...including a stage transition', forge2.status === 400);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
