'use strict';
// PARENT/CHILD SCOPE PREDICATES (services/requestScope.js).
// The whole codebase is made parent/child-aware BEFORE any row is migrated. The predicates are chosen so
// they are TAUTOLOGIES against today's data (every request is its own parent AND its own child) and become
// discriminating the moment a child row exists. That makes adopting them a PROVABLE no-op — and makes the
// migration itself a data-only change, with no query to rewrite under pressure.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var scope = require('/opt/optimumq/backend/src/services/requestScope');
var reportEngine = require('/opt/optimumq/backend/src/services/reportEngine');
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

(async function () {
  await db.initDb();
  var P = 'scope-probe-parent', C = 'scope-probe-child';
  try {
    // ---- 1. tautology today
    var total = Number((await db.get('SELECT COUNT(*) AS n FROM requests')).n);
    var roots = Number((await db.get('SELECT COUNT(*) AS n FROM requests r WHERE ' + scope.parent('r'))).n);
    var leaves = Number((await db.get('SELECT COUNT(*) AS n FROM requests r WHERE ' + scope.leaf('r'))).n);
    ok('every row is a PARENT today (' + roots + '/' + total + ') — tautology', roots === total);
    ok('every row is a LEAF today (' + leaves + '/' + total + ') — tautology', leaves === total);
    ok('PARENT and LEAF select the same set today — a request IS its own parent and its own child', roots === leaves);

    // ---- 2. discriminating the moment a child exists
    await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status) VALUES (?,?,?,?,?,?,?)", [P, 'SCOPE-P', 'P', 'p@x.com', 'probe parent', 'intake', 'active']);
    await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, master_request_id) VALUES (?,?,?,?,?,?,?,?)", [C, 'SCOPE-P-1', 'P', 'p@x.com', 'probe child', 'intake', 'active', P]);
    ok('with a child present: the PARENT row is selected by parent()', !!(await db.get('SELECT id FROM requests r WHERE r.id = ? AND ' + scope.parent('r'), [P])));
    ok('with a child present: the PARENT row is EXCLUDED from work lists by leaf()', !(await db.get('SELECT id FROM requests r WHERE r.id = ? AND ' + scope.leaf('r'), [P])));
    ok('with a child present: the CHILD row is selected by leaf()', !!(await db.get('SELECT id FROM requests r WHERE r.id = ? AND ' + scope.leaf('r'), [C])));
    ok('with a child present: the CHILD row is EXCLUDED from money/volume by parent()', !(await db.get('SELECT id FROM requests r WHERE r.id = ? AND ' + scope.parent('r'), [C])));

    // ---- 3. the destructive sweeps would NOT see a parent
    var stall = await db.all("SELECT r.id FROM requests r WHERE r.status = 'active' AND r.stage NOT IN ('delivery','closed')" + scope.andLeaf('r'));
    ok('the STALL sweep does not see the parent (it would flag it "stalled" forever)', stall.map(function (x) { return x.id; }).indexOf(P) < 0);
    var dun = await db.all("SELECT r.id FROM requests r WHERE r.status = 'active'" + scope.andParent('r'));
    ok('the DUNNING sweep does not see the child (it would email the citizen twice)', dun.map(function (x) { return x.id; }).indexOf(C) < 0);
    ok('...and the dunning sweep DOES see the parent (money is parent-level)', dun.map(function (x) { return x.id; }).indexOf(P) >= 0);

    // ---- 4. reports do not double-count with a parent+child present
    var vol = await reportEngine.run({ metric: 'request_count', group_by: 'month' });
    var volTotal = vol.rows.reduce(function (s, r) { return s + Number(r.value); }, 0);
    var parentCount = Number((await db.get("SELECT COUNT(*) AS n FROM requests r WHERE r.request_number NOT LIKE 'SYS-%' AND r.request_number <> 'LIBRARY'" + scope.andParent('r'))).n);
    ok('request_count counts each citizen request ONCE, not once per child (' + volTotal + ' = ' + parentCount + ')', volTotal === parentCount);

    // ---- 5. THE CITIZEN-FACING NUMBER: a task on a CHILD must show the PARENT's number.
    // After the migration a child's own number carries a suffix (2026-0045-1). Staff must never be shown a
    // number the citizen has never seen, so it is resolved through the parent.
    var tid = 'scope-probe-task';
    await db.run("INSERT INTO tasks (id, request_id, type, status, title, created_at) VALUES (?,?,?,?,?, datetime('now'))",
      [tid, C, 'record_search', 'open', 'probe task']);
    var row = await db.get("SELECT t.id, " + scope.numberExpr('r') + " AS request_number " +
      "FROM tasks t LEFT JOIN requests r ON r.id = t.request_id" + scope.numberJoin('r') + " WHERE t.id = ?", [tid]);
    ok('a task on the CHILD resolves to the PARENT\'s number ("' + row.request_number + '", not the child\'s "SCOPE-P-1")',
      row.request_number === 'SCOPE-P');
    var own = await db.get('SELECT request_number FROM requests WHERE id = ?', [C]);
    ok('...while the child row still carries its own component number ("' + own.request_number + '") for the record',
      own.request_number === 'SCOPE-P-1');
    await db.run('DELETE FROM tasks WHERE id = ?', [tid]);

    // ---- 6. determinism (ties used to shuffle the queue and report bars between runs)
    var r1 = await reportEngine.run({ metric: 'request_count', group_by: 'department' });
    var r2 = await reportEngine.run({ metric: 'request_count', group_by: 'department' });
    ok('reports are deterministic across runs (tie-break added; bars no longer swap places)', JSON.stringify(r1.rows) === JSON.stringify(r2.rows));
  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      await db.run('DELETE FROM requests WHERE id IN (?,?)', [C, P]);
      ok('cleanup: probe rows removed', Number((await db.get("SELECT COUNT(*) AS n FROM requests WHERE id LIKE 'scope-probe-%'")).n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
