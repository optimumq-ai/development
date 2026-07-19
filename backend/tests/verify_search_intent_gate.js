'use strict';
// THE R9 GATE — Tier 1 #5, the ENFORCEMENT half of the search-completeness intent.
//
// R9 taught the system to record what the requestor MEANT ("these match, but ALSO search for more"). The
// record-search screen showed it in amber. And nothing enforced it, which made the amber a decoration:
//
//   The records the requestor picked in the portal are ALREADY attached to the request. So "at least one
//   record marked Include in Response" -- the only gate `found` had -- was satisfied by the requestor's OWN
//   PICKS, before the searcher did anything at all. A request whose requestor explicitly asked the team to
//   keep searching could be advanced to redaction, fulfilled, and CLOSED AS COMPLETE. The system would have
//   closed, as answered, a request the requestor still considered OPEN -- and the intent column, sitting
//   right there in the database, said so the whole time.
//
// A gate needs an un-gate. This one's is a sentence: "I searched; there is nothing more."
//
// WHAT THIS HARNESS PROVES:
//   A. The duty is intent-derived: search_more / no_match_search / not_searchable BLOCK; `complete` does not.
//   B. `found` is refused (422 UNRESOLVED_SEARCH_INTENT) while any duty description is unanswered --
//      EVEN WITH RECORDS ATTACHED. That is the whole point: attaching is not searching.
//   C. Answering un-gates it, and the answer is written to the per-description ledger AND to history.
//   D. "Nothing more" REQUIRES A NOTE. An unevidenced claim that nothing exists is indistinguishable from
//      never having looked -- the same reasoning that makes a no-records closure refuse an empty trail.
//   E. SEARCH_INTENT_RESOLVED is NOT effort-trail evidence. Otherwise the claim would evidence ITSELF: a
//      searcher could answer "nothing more" and use that answer to satisfy the no-records evidence gate,
//      closing a request having run no search at all. The two gates must not feed each other.
//   F. A no-records closure ANSWERS every open description (the blanket form of the same sentence), so the
//      ledger is never left half-written.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var SI = require('/opt/optimumq/backend/src/services/searchIntents');

var PORT = Number(process.env.API_PORT) || 3101;
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

// A request genuinely SITTING IN record_search, with intake provenance on it -- the state a searcher
// actually opens. Built through the real creation path and the ONE central stage transition.
async function mkTask(desc, intents) {
  var made = await RC.createRequest(
    { requestorName: 'Gate Test', requestorEmail: 'gate@example.com', description: desc, deliveryMethod: 'email' },
    { actorId: 'test', actorName: 'Test', historyAction: 'CREATED', kickIntake: false });
  if (intents && intents.length) await SI.persist(made.id, intents);
  await tr.applyStageTransition(made.id, 'record_search',
    { actorId: 'test', actorName: 'Test', action: 'STAGE_ADVANCED', notes: 'Into record search for the test.' });
  var t = await db.get(
    "SELECT id FROM tasks WHERE request_id = ? AND type = 'record_search' ORDER BY created_at DESC LIMIT 1", [made.id]);
  if (!t) t = await tr.createTask({ requestId: made.id, type: 'record_search', title: 'Record search', createdBy: 'test' });
  return { rid: made.id, tid: t.id };
}

// The requestor's OWN portal pick, already on the request before the searcher lifts a finger. This is the
// row that used to be enough to satisfy `found` all by itself.
async function attachRecord(rid, title) {
  var { v4: uuidv4 } = require('/opt/optimumq/backend/node_modules/uuid');
  await db.run(
    'INSERT INTO request_files (id, request_id, filename, original_name, responsive) VALUES (?,?,?,?,1)',
    [uuidv4(), rid, 'gate-test-' + Date.now() + '.pdf', title || 'A record the requestor picked']);
}

async function intentsOf(rid) {
  return await db.all('SELECT * FROM request_search_intents WHERE request_id = ? ORDER BY seq ASC', [rid]);
}

(async function () {
  await db.initDb();
  var u = await db.get('SELECT * FROM users LIMIT 1');
  TOKEN = await auth.signAccessToken(u);

  console.log('\n=== A. THE DUTY IS INTENT-DERIVED ===');
  ok('A1 search_more carries a search duty', SI.hasDuty('search_more') === true);
  ok('A2 no_match_search carries a search duty (an instruction to search, NOT abandonment)', SI.hasDuty('no_match_search') === true);
  ok('A3 not_searchable carries a search duty (the portal never searched it)', SI.hasDuty('not_searchable') === true);
  ok('A4 complete carries NO duty — the requestor said the selection is everything', SI.hasDuty('complete') === false);

  console.log('\n=== B. `found` IS REFUSED WHILE A DESCRIPTION IS UNANSWERED — WITH RECORDS ATTACHED ===');
  var b = await mkTask('Body-cam from the 3rd St stop', [
    { seq: 0, description: 'Body-cam from the 3rd St stop', intent: 'search_more',
      queriesTried: ['3rd st bodycam'], selected: [{ id: 'rec-1', title: 'BWC clip' }], notSelected: [] }
  ]);
  await attachRecord(b.rid, 'BWC clip the requestor picked');

  var inc = await db.get('SELECT count(*)::int AS n FROM request_files WHERE request_id = ? AND responsive = 1', [b.rid]);
  ok('B1 the requestor\'s own pick is attached and Included — the OLD gate is already satisfied', inc.n === 1);

  var r1 = await req('POST', '/api/tasks/' + b.tid + '/resolve', { outcome: 'found' });
  ok('B2 …and `found` is REFUSED anyway (422). Attaching is not searching.', r1.status === 422);
  ok('B3 …with a code the UI can act on', r1.body && r1.body.code === 'UNRESOLVED_SEARCH_INTENT');
  ok('B4 …naming the description the requestor asked us to search',
    r1.body && /3rd St stop/.test(r1.body.error || ''));
  ok('B5 …and returning the open intent(s) so the screen can point at them',
    r1.body && Array.isArray(r1.body.openIntents) && r1.body.openIntents.length === 1);

  var stillOpen = await db.get('SELECT stage FROM requests WHERE id = ?', [b.rid]);
  ok('B6 THE REQUEST DID NOT MOVE — it is still in record_search, not handed to redaction',
    stillOpen.stage === 'record_search');
  var taskStill = await db.get('SELECT status FROM tasks WHERE id = ?', [b.tid]);
  ok('B7 …and the task is NOT done', taskStill.status !== 'done');

  console.log('\n=== C. ANSWERING UN-GATES IT ===');
  var openBefore = await SI.openIntents(b.rid);
  ok('C1 one description is open before the answer', openBefore.length === 1);

  var rAns = await req('POST', '/api/requests/' + b.rid + '/search-intents/' + openBefore[0].id + '/resolve',
    { outcome: 'nothing_further', note: 'Searched Axon by unit + date range 03-01 to 03-08. Nothing beyond the clip.' });
  ok('C2 the answer is accepted', rAns.status === 200);
  ok('C3 …and reports zero descriptions left open', rAns.body && rAns.body.openCount === 0);

  var ledger = await intentsOf(b.rid);
  ok('C4 the answer is on the per-description ledger', ledger[0].searcher_outcome === 'nothing_further');
  ok('C5 …with the note that evidences it', /Axon by unit/.test(ledger[0].resolution_note || ''));
  ok('C6 …stamped with who said it and when', !!ledger[0].resolved_by && !!ledger[0].resolved_at);

  var hist = await db.all(
    "SELECT * FROM request_history WHERE request_id = ? AND action = 'SEARCH_INTENT_RESOLVED'", [b.rid]);
  ok('C7 …and written to the audit trail', hist.length === 1);
  ok('C8 …quoting the description it answers', /3rd St stop/.test(hist[0].notes || ''));

  var r2 = await req('POST', '/api/tasks/' + b.tid + '/resolve', { outcome: 'found' });
  ok('C9 NOW `found` is allowed', r2.status === 200);
  var moved = await db.get('SELECT stage FROM requests WHERE id = ?', [b.rid]);
  // Destination flipped 2026-07-19 (Kevin, brief §5): a completed search goes to redaction_review, not
  // into a legal stage. The legal stages are entered only by asserting an exemption.
  ok('C10 …and the request advanced through the central transition', moved.stage === 'redaction_review');

  console.log('\n=== D. "NOTHING MORE" REQUIRES A NOTE ===');
  var d = await mkTask('Every email about the levy', [
    { seq: 0, description: 'Every email about the levy', intent: 'no_match_search', queriesTried: [], selected: [], notSelected: [] }
  ]);
  var dOpen = await SI.openIntents(d.rid);
  var rNoNote = await req('POST', '/api/requests/' + d.rid + '/search-intents/' + dOpen[0].id + '/resolve',
    { outcome: 'nothing_further', note: '   ' });
  ok('D1 an unevidenced "there is nothing more" is REFUSED (422)', rNoNote.status === 422);
  ok('D2 …with NOTE_REQUIRED', rNoNote.body && rNoNote.body.code === 'NOTE_REQUIRED');
  var dLedger = await intentsOf(d.rid);
  ok('D3 …and nothing was written to the ledger', !dLedger[0].searcher_outcome);

  var rAdded = await req('POST', '/api/requests/' + d.rid + '/search-intents/' + dOpen[0].id + '/resolve',
    { outcome: 'records_added' });
  ok('D4 "the attached records answer this" needs no note — the records ARE the evidence', rAdded.status === 200);

  var rBad = await req('POST', '/api/requests/' + d.rid + '/search-intents/' + dOpen[0].id + '/resolve',
    { outcome: 'i_gave_up' });
  ok('D5 an unknown outcome is refused', rBad.status === 400 && rBad.body.code === 'BAD_OUTCOME');

  console.log('\n=== E. THE CLAIM MUST NOT EVIDENCE ITSELF ===');
  // If SEARCH_INTENT_RESOLVED counted as effort, a searcher could assert "nothing more" and then use THAT
  // assertion to satisfy the no-records evidence gate -- closing a request having searched nothing at all.
  var e = await mkTask('Dashcam, 5th and Main', [
    { seq: 0, description: 'Dashcam, 5th and Main', intent: 'search_more', queriesTried: [], selected: [], notSelected: [] }
  ]);
  var eOpen = await SI.openIntents(e.rid);
  await req('POST', '/api/requests/' + e.rid + '/search-intents/' + eOpen[0].id + '/resolve',
    { outcome: 'nothing_further', note: 'Nothing found.' });
  var rClose = await req('POST', '/api/tasks/' + e.tid + '/resolve', { outcome: 'no_records' });
  ok('E1 answering the description does NOT by itself evidence a no-records closure (422)', rClose.status === 422);
  ok('E2 …the closure still demands a real effort trail', rClose.body && rClose.body.code === 'NO_EFFORT_TRAIL');
  var eStage = await db.get('SELECT stage FROM requests WHERE id = ?', [e.rid]);
  ok('E3 …and the request is NOT closed', eStage.stage !== 'closed');

  console.log('\n=== F. A NO-RECORDS CLOSURE ANSWERS EVERY OPEN DESCRIPTION ===');
  var f = await mkTask('All incident reports, June', [
    { seq: 0, description: 'All incident reports, June', intent: 'search_more', queriesTried: [], selected: [], notSelected: [] },
    { seq: 1, description: 'The 911 audio', intent: 'not_searchable', queriesTried: [], selected: [], notSelected: [] },
    { seq: 2, description: 'The two reports I picked', intent: 'complete', queriesTried: [], selected: [], notSelected: [] }
  ]);
  var fOpen = await SI.openIntents(f.rid);
  ok('F1 two of the three descriptions carry a duty (`complete` does not)', fOpen.length === 2);

  await req('POST', '/api/requests/' + f.rid + '/effort', { action: 'CALL_LOGGED', notes: 'Called Records; nothing on file.' });
  var rClosed = await req('POST', '/api/tasks/' + f.tid + '/resolve', { outcome: 'no_records' });
  ok('F2 with a real effort trail, the closure goes through', rClosed.status === 200);
  ok('F3 …and reports the descriptions it answered', rClosed.body && rClosed.body.intentsClosed === 2);

  var fLedger = await intentsOf(f.rid);
  var duty = fLedger.filter(function (i) { return SI.hasDuty(i.intent); });
  ok('F4 EVERY duty description is answered — the ledger is not left half-written',
    duty.length === 2 && duty.every(function (i) { return i.searcher_outcome === 'nothing_further'; }));
  var untouched = fLedger.filter(function (i) { return i.intent === 'complete'; })[0];
  ok('F5 …and `complete` was NOT touched — the requestor already answered it', !untouched.searcher_outcome);
  ok('F6 the request is closed, for the recorded reason',
    (await db.get('SELECT stage, closure_reason FROM requests WHERE id = ?', [f.rid])).closure_reason === 'no_records');

  console.log('\n=== G. A REQUEST WITH NO INTAKE PROVENANCE IS UNAFFECTED ===');
  // Pre-R9 requests, and every request that never went through the portal, have no intents at all. The gate
  // must be silent for them -- a gate that blocks work it has nothing to say about is just an outage.
  var g = await mkTask('Walk-in request, no portal', []);
  await attachRecord(g.rid, 'A record the clerk found');
  var rG = await req('POST', '/api/tasks/' + g.tid + '/resolve', { outcome: 'found' });
  ok('G1 no intents → `found` still works', rG.status === 200);
  ok('G2 …and it advanced', (await db.get('SELECT stage FROM requests WHERE id = ?', [g.rid])).stage === 'redaction_review');

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
