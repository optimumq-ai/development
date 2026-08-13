'use strict';
// RECORD-TYPE LEGAL-REDACTION GATE (D4 §7, item 10 — the deterministic trigger).
//
// Legal redaction could be reached two ways: a director's escalation (requests.legal_flag) or the
// classifier emitting SENSITIVE/LEGAL_HOLD — an AI judgment on the request TEXT. There was NO way for a
// city to say "this record type's redaction is ALWAYS legal work" (spec §7 said "record type
// sensitive=true (flag to verify)" — verified: no such flag existed). record_types.legal_redaction_required
// is that switch: set in the record-type editor, read by requestNeedsLegalRedaction, so the redaction
// stage spawns legal_redaction (office-level) instead of redaction (team) AND the redaction job's
// disposition resolves 'legal' from the same fact.
//
// WHAT THIS PREVENTS: an internal-affairs file reaching a line redaction clerk because the requester
// worded the request blandly and the classifier didn't flag it.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var tr = require('/opt/optimumq/backend/src/services/taskRouting');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'RTLG-' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;

async function api(method, path, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function mkRequest(id, rtId) {
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id, record_type_id) VALUES (?,?,?,?,?,'redaction','active','team-police',?)",
    [id, id, 'Test', 't@example.com', 'routine copy request ' + TAG, rtId]);
}

(async function () {
  await db.initDb();
  var admin = await db.get("SELECT * FROM users WHERE id = 'u-kruss'");
  TOKEN = await auth.signAccessToken(admin);
  var cat = await db.get('SELECT id FROM categories LIMIT 1');

  console.log('\n=== A. THE FLAG IS A REAL CONFIG FIELD — create, edit, round-trip through the taxonomy API ===');
  var mk = await api('POST', '/taxonomy/record-types', {
    category_id: cat.id, name: 'IA File ' + TAG, code: 'ia-' + TAG, legal_redaction_required: true });
  ok('A1 create carries the flag (not silently dropped)', mk.status === 200 && mk.body && mk.body.legal_redaction_required === 1);
  var rtFlagged = mk.body.id;
  var mk2 = await api('POST', '/taxonomy/record-types', {
    category_id: cat.id, name: 'Plain Minutes ' + TAG, code: 'pm-' + TAG });
  var rtPlain = mk2.body.id;
  ok('A2 an unflagged type defaults to 0', mk2.body.legal_redaction_required === 0);
  var patched = await api('PATCH', '/taxonomy/record-types/' + rtPlain, { legal_redaction_required: true });
  var unpatched = await api('PATCH', '/taxonomy/record-types/' + rtPlain, { legal_redaction_required: false });
  ok('A3 the flag can be turned on and back off by edit', patched.body.legal_redaction_required === 1 && unpatched.body.legal_redaction_required === 0);

  console.log('\n=== B. THE GATE FIRES DETERMINISTICALLY — bland text, no classifier flag, still legal ===');
  var r1 = 'req-' + TAG + '-1';
  await mkRequest(r1, rtFlagged);
  ok('B1 requestNeedsLegalRedaction answers true from the record type alone', (await tr.requestNeedsLegalRedaction(r1)) === true);
  var t1 = await tr.spawnForStage(r1, 'redaction', 'test');
  ok('B2 the redaction stage spawns LEGAL redaction, office-level (team-agnostic)',
    !!t1 && t1.type === 'legal_redaction' && t1.team_id === null);
  var dup = await tr.spawnForStage(r1, 'redaction', 'test');
  ok('B3 the redaction/legal_redaction family stays idempotent (no second task)', dup === null);

  console.log('\n=== C. UNFLAGGED TYPES ARE UNTOUCHED — and the old triggers still work ===');
  var r2 = 'req-' + TAG + '-2';
  await mkRequest(r2, rtPlain);
  ok('C1 an unflagged type does not need legal redaction', (await tr.requestNeedsLegalRedaction(r2)) === false);
  var t2 = await tr.spawnForStage(r2, 'redaction', 'test');
  ok('C2 ...and spawns ordinary team redaction', !!t2 && t2.type === 'redaction' && t2.team_id === 'team-police');
  var r3 = 'req-' + TAG + '-3';
  await mkRequest(r3, rtPlain);
  await db.run('UPDATE requests SET legal_flag = 1 WHERE id = ?', [r3]);
  ok('C3 the director escalation trigger is unchanged', (await tr.requestNeedsLegalRedaction(r3)) === true);
  var r4 = 'req-' + TAG + '-4';
  await mkRequest(r4, null);
  ok('C4 a request with no record type resolved does not throw and does not escalate',
    (await tr.requestNeedsLegalRedaction(r4)) === false);

  console.log('\n=== D. LEAVE THE WORLD AS FOUND ===');
  for (var rid of [r1, r2, r3, r4]) { await db.run('DELETE FROM requests WHERE id = ?', [rid]); }
  for (var rt of [rtFlagged, rtPlain]) { await api('DELETE', '/taxonomy/record-types/' + rt); }
  var leftT = await db.get("SELECT count(*)::int AS n FROM tasks WHERE request_id LIKE 'req-' || ? || '%'", [TAG]);
  var leftR = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE 'ia-' || ? || '%' OR code LIKE 'pm-' || ? || '%'", [TAG, TAG]);
  ok('D1 requests (and their tasks, via cascade), and both record types are gone', Number(leftT.n) === 0 && Number(leftR.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
