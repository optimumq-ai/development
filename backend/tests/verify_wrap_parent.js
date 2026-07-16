'use strict';
// WRAP-IN-PARENT — every request is a PARENT with 1..n CHILDREN (ARCHITECTURE item 1, ratified 2026-07-16;
// SPEC_parent_child_lifecycle.md §8). A single-record request is a parent with ONE child; there is no
// single-vs-multi mode, which is the entire point.
//
// What this locks down:
//   * the pair is created, linked, and numbered (`2026-000001` / `2026-000001-1`);
//   * the SPLIT is real: description/routing on the child, requestor/money/clock on the parent;
//   * the STATUTORY CLOCK IS THE PARENT's — one legal deadline per citizen request, never one per record.
//     A child carrying its own statutory clock is the failure mode §2 exists to prevent (IL 5 ILCS 140/3(d):
//     one request-level answer date, no installment safe harbor);
//   * work (tasks) hangs off the CHILD, and createRequest RETURNS the child's id;
//   * the scope predicates now DISCRIMINATE against real data instead of being tautologies;
//   * a CHILD's composite number can never take part in citizen-number sequencing — a free consequence of the
//     fixed-width numbering fix (`efe3c57`), asserted here rather than left to luck;
//   * `chk_child_has_description` — the NOT NULL that moved off the row and onto the CHILD, where it belongs.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var scope = require('/opt/optimumq/backend/src/services/requestScope');
var uuidv4 = require('uuid').v4;

var TAG = 'WRAP-' + Date.now();
var pass = 0, fail = 0, made = [];
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  await db.initDb();
  try {
    // ---- 1. The pair
    var r = await RC.createRequest({
      requestorName: 'Wrap Test', requestorEmail: 'wrap@example.com',
      description: 'body-worn camera footage ' + TAG, classification: 'standard'
    }, { kickIntake: false, actorName: 'harness' });
    made.push(r.parentId, r.childId);

    ok('createRequest returns a parentId and a childId', !!r.parentId && !!r.childId);
    ok('...and RETURNS THE CHILD as `id` — work hangs off the work row', r.id === r.childId);
    ok('...and returns the CITIZEN\'s number (the parent\'s), not the child\'s', /^[0-9]{4}-[0-9]{6}$/.test(r.requestNumber));

    var P = await db.get('SELECT * FROM requests WHERE id = ?', [r.parentId]);
    var C = await db.get('SELECT * FROM requests WHERE id = ?', [r.childId]);
    ok('the parent exists and is a ROOT (master_request_id IS NULL)', !!P && P.master_request_id === null);
    ok('the child points at the parent', C.master_request_id === r.parentId);
    ok('child_no is 1, never 0 (a 0 would make single-record a different shape — §5.1)', Number(C.child_no) === 1);
    ok('the parent has NO child_no', P.child_no === null);
    ok('the child number is the parent\'s + "-1" (' + C.request_number + ')', C.request_number === P.request_number + '-1');

    // ---- 2. The split is REAL
    ok('DESCRIPTION lives on the CHILD', (C.description || '').indexOf(TAG) >= 0);
    ok('...and the parent has NONE — a copy would make every description lookup match TWO rows', P.description === null);
    ok('a description lookup finds exactly ONE row, not two', (await db.all('SELECT id FROM requests WHERE description LIKE ?', ['%' + TAG + '%'])).length === 1);
    ok('ROUTING columns are the child\'s only (record_types/department/record_type)',
      P.record_types === null && P.department_id === null && P.record_type_id === null);
    ok('REQUESTOR identity is on the PARENT (the citizen relationship)', P.requestor_email === 'wrap@example.com');
    ok('the parent has NO stage — it has parent_state; a stage would make it visible to work sweeps', P.stage === null);
    ok('the child carries the stage', C.stage === 'intake');
    ok('classification IS copied up — it drives the statutory clock\'s duration', P.classification === C.classification);

    // ---- 3. THE CLOCK IS THE PARENT'S. This is the legal one (§2).
    var pClocks = await db.all('SELECT * FROM request_clocks WHERE request_id = ?', [r.parentId]);
    var cClocks = await db.all('SELECT * FROM request_clocks WHERE request_id = ?', [r.childId]);
    ok('the STATUTORY clock started on the PARENT (' + pClocks.length + ')', pClocks.length >= 1);
    ok('the CHILD has NO statutory clock — one legal deadline per request, never one per record', cClocks.length === 0);
    var pDl = await db.get('SELECT deadline_date FROM requests WHERE id = ?', [r.parentId]);
    ok('the deadline is written back to the PARENT', !!pDl.deadline_date);

    // ---- 4. History exists at BOTH levels — creation happens at both, and neither trail may start empty
    var pHist = await db.all("SELECT action, notes FROM request_history WHERE request_id = ?", [r.parentId]);
    var cHist = await db.all("SELECT action, notes FROM request_history WHERE request_id = ?", [r.childId]);
    ok('the PARENT has a CREATED row (the citizen submitted a request)', pHist.filter(function (h) { return h.action === 'CREATED'; }).length === 1);
    ok('the CHILD has a CREATED row (staff open the child — its trail must not start mid-story)', cHist.filter(function (h) { return h.action === 'CREATED'; }).length === 1);
    ok('...and the two rows say DIFFERENT things — they are different facts, not a duplicate',
      pHist[0].notes !== cHist[0].notes && /received from the requestor/.test(pHist[0].notes));

    // ---- 5. The scope predicates now DISCRIMINATE — they were tautologies before this
    var asParent = await db.get('SELECT id FROM requests r WHERE r.id = ? AND ' + scope.parent('r'), [r.parentId]);
    var childAsParent = await db.get('SELECT id FROM requests r WHERE r.id = ? AND ' + scope.parent('r'), [r.childId]);
    ok('parent() selects the parent', !!asParent);
    ok('parent() EXCLUDES the child — money/volume must not double-count', !childAsParent);
    var asLeaf = await db.get('SELECT id FROM requests r WHERE r.id = ? AND ' + scope.leaf('r'), [r.childId]);
    var parentAsLeaf = await db.get('SELECT id FROM requests r WHERE r.id = ? AND ' + scope.leaf('r'), [r.parentId]);
    ok('leaf() selects the child', !!asLeaf);
    ok('leaf() EXCLUDES the parent — a parent in a work list is a ghost row', !parentAsLeaf);

    // ---- 6. Children can NEVER take part in citizen-number sequencing
    var yr = new Date().getFullYear();
    var seqSet = await db.all("SELECT request_number FROM requests WHERE request_number ~ ('^' || ? || '-[0-9]{" + RC.SEQ_DIGITS + "}$')", [String(yr)]);
    var nums = seqSet.map(function (x) { return x.request_number; });
    ok('the sequencing pattern sees the PARENT\'s number', nums.indexOf(P.request_number) >= 0);
    ok('...and CANNOT see the child\'s composite number — a free consequence of fixed-width numbering',
      nums.indexOf(C.request_number) < 0);
    var next = await RC.nextRequestNumber(yr);
    ok('the next citizen number is not derailed by the child (' + next + ')', /^[0-9]{4}-[0-9]{6}$/.test(next) && next !== C.request_number);

    // ---- 7. The CHECK constraint moved the NOT NULL onto the CHILD, where it belongs
    var threw = null;
    try {
      await db.run("INSERT INTO requests (id, request_number, master_request_id, child_no, requestor_name, requestor_email, description) VALUES (?,?,?,?,?,?,NULL)",
        ['wrapchk-' + uuidv4().slice(0, 8), 'WRAPCHK-' + Date.now(), r.parentId, 2, 'x', 'x@example.com']);
    } catch (e) { threw = e.message; }
    ok('a CHILD with no description is REFUSED by the database', !!threw && /chk_child_has_description/.test(threw));
    var pOk = null;
    try {
      var bareId = 'wrapbare-' + uuidv4().slice(0, 8);
      await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description) VALUES (?,?,?,?,NULL)",
        [bareId, 'WRAPBARE-' + Date.now(), 'x', 'x@example.com']);
      made.push(bareId); pOk = true;
    } catch (e) { pOk = false; }
    ok('...but a ROOT with no description is allowed (parents have none; so do LIBRARY/SYS-* containers)', pOk === true);

    // ---- 8. Work attaches to the CHILD
    // A CONFIDENTLY-classifiable description on purpose. A vague one ("police report") legitimately stays at
    // `intake` for triage and spawns no task — that is the classifier working, not the wrap failing, and an
    // earlier draft of this harness mistook the one for the other.
    var r2 = await RC.createRequest({
      requestorName: 'Wrap Task', requestorEmail: 'wrap2@example.com',
      description: 'building permit records for 100 Main St ' + TAG
    }, { actorName: 'harness' }); // kickIntake ON — routing runs on the description, which is the child's
    made.push(r2.parentId, r2.childId);
    var t = null;
    for (var i = 0; i < 40 && !t; i++) { t = await db.get('SELECT id, request_id FROM tasks WHERE request_id = ?', [r2.childId]); await sleep(250); }
    ok('intake routing spawned a task ON THE CHILD (work hangs off the work row)', !!t && t.request_id === r2.childId);
    var pt = await db.get('SELECT id FROM tasks WHERE request_id = ?', [r2.parentId]);
    ok('...and NOT on the parent — a task on a parent is unworkable, it has no stage', !pt);
    // The routing DECISION is written for every request, confident or not — the sharper proof that the
    // classifier ran against the CHILD's description.
    // THE REGRESSION THIS HARNESS MISSED THE FIRST TIME. The clock assertions above ran with kickIntake:false,
    // so the INTAKE path never executed — and intake is exactly what broke it. workflowEngine.onIntake runs
    // against the CHILD (routing comes from the description) and called startClocksForRequest with the child's
    // id, so every wrapped request came out of the real portal with TWO respond clocks, one on a child. The
    // suite was green; LIVE was wrong. Assert it on the path that actually runs.
    var c2Clocks = await db.all('SELECT id FROM request_clocks WHERE request_id = ?', [r2.childId]);
    var p2Clocks = await db.all('SELECT id FROM request_clocks WHERE request_id = ?', [r2.parentId]);
    ok('AFTER FULL INTAKE: the child STILL has no statutory clock (' + c2Clocks.length + ') — N children must never mean N legal deadlines', c2Clocks.length === 0);
    ok('AFTER FULL INTAKE: the parent has exactly one respond clock (' + p2Clocks.length + ')', p2Clocks.length === 1);
    var c2Dl = await db.get('SELECT deadline_date FROM requests WHERE id = ?', [r2.childId]);
    var p2Dl = await db.get('SELECT deadline_date FROM requests WHERE id = ?', [r2.parentId]);
    ok('the child DISPLAYS the deadline (work lists are LEAF-scoped and would show a blank without it)', !!c2Dl.deadline_date);
    ok('...and it is the SAME date as the parent\'s — a derived copy, never a second deadline', c2Dl.deadline_date === p2Dl.deadline_date);

    var wd = await db.all('SELECT id FROM workflow_decisions WHERE request_id = ?', [r2.childId]);
    var wdP = await db.all('SELECT id FROM workflow_decisions WHERE request_id = ?', [r2.parentId]);
    ok('the routing decision is recorded on the CHILD (' + wd.length + ')', wd.length >= 1);
    ok('...and never on the parent (' + wdP.length + ')', wdP.length === 0);
    var advanced = await db.get('SELECT stage, department_id FROM requests WHERE id = ?', [r2.childId]);
    ok('the CHILD advanced past intake and was stamped with its team (' + advanced.stage + ')',
      advanced.stage !== 'intake' && !!advanced.department_id);
    var pStage = await db.get('SELECT stage FROM requests WHERE id = ?', [r2.parentId]);
    ok('...while the parent still has NO stage — work moved, the citizen relationship did not', pStage.stage === null);
    var num = await db.get('SELECT ' + scope.numberExpr('r') + ' AS n FROM requests r' + scope.numberJoin('r') + ' WHERE r.id = ?', [r2.childId]);
    ok('a task on the child resolves to the CITIZEN\'s number (' + num.n + '), never the child\'s suffix', num.n === r2.requestNumber);

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t2 = 0; t2 < tabs.length; t2++) for (var c = 0; c < made.length; c++) {
        try { await db.run('DELETE FROM ' + tabs[t2].table_name + ' WHERE request_id=?', [made[c]]); } catch (e) {}
      }
      // children first — the parent is referenced by master_request_id
      for (var c2 = 0; c2 < made.length; c2++) { try { await db.run('DELETE FROM requests WHERE id=? AND master_request_id IS NOT NULL', [made[c2]]); } catch (e) {} }
      for (var c3 = 0; c3 < made.length; c3++) { try { await db.run('DELETE FROM requests WHERE id=?', [made[c3]]); } catch (e) {} }
      var left = await db.get('SELECT COUNT(*) AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 test rows remain', Number(left.n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
