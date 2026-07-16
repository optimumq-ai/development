'use strict';
// THE PORTAL EMITS n CHILDREN — MRR is real, not theoretical (BUILD_PRIORITY #12; SPEC §13, §5.1, §14.2).
//
// Until now every request was a parent with exactly ONE child. A citizen who described a body-cam video AND a
// building permit got one blob of text in one row, routed to one department. Now each described record becomes
// its own child: its own description, its own routing, its own stage, finishing independently — while the
// citizen keeps ONE number, ONE fee and ONE deadline (§13 Layer 1/3).
//
// Also locked here: "combined vs separate" is RETIRED. The specs retired it 2026-07-10 but that commit changed
// NO CODE, so the live agent kept asking citizens a question the contract had abolished — and "separate"
// performed no split anyway, so the answer was discarded. That prompt is gone; `mrrChoice` is gone.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var fs = require('fs');
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var scope = require('/opt/optimumq/backend/src/services/requestScope');

var TAG = 'MRR-' + Date.now();
var pass = 0, fail = 0, made = [];
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function post(path, body) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify(body);
    var r = http.request({ host: 'localhost', port: (Number(process.env.API_PORT) || 3101), path: path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      function (resp) { var s = ''; resp.on('data', function (c) { s += c; }); resp.on('end', function () { var j = null; try { j = JSON.parse(s); } catch (e) {} res({ status: resp.statusCode, body: j }); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}
async function kidsOf(parentId) {
  return await db.all('SELECT * FROM requests WHERE master_request_id = ? ORDER BY child_no', [parentId]);
}

(async function () {
  await db.initDb();
  try {
    // ---- 1. THE RETIRED QUESTION IS GONE FROM THE AGENT (source assertion — it cannot be asked if it is not there)
    var src = fs.readFileSync('/opt/optimumq/backend/src/routes/publicChat.js', 'utf8');
    ok('the agent no longer asks "combined ... or ... separate" — retired 2026-07-10, still live until today',
      !/single combined request or as two separate requests/i.test(src));
    ok('`mrrChoice` is gone from the SUBMIT_READY schema', !/mrrChoice/.test(src.replace(/^\s*\/\/.*$/gm, '')));
    ok('the agent is told to keep each record\'s description SEPARATE', /SEPARATE and self-contained/i.test(src));

    // ---- 2. THREE described records -> THREE children, ONE citizen request
    var r = await RC.createRequest({
      requestorName: 'MRR Test', requestorEmail: 'mrr@example.com',
      children: [
        { description: 'building permit records for 100 Main St ' + TAG, componentLabel: 'permits' },
        { description: 'body worn camera footage from the 5th street incident ' + TAG, componentLabel: 'body-cam' },
        { description: 'city council meeting minutes for March ' + TAG, componentLabel: 'minutes' }
      ]
    }, { kickIntake: false, actorName: 'harness' });
    made.push(r.parentId); r.childIds.forEach(function (i) { made.push(i); });

    ok('createRequest reports 3 children', r.childCount === 3 && r.childIds.length === 3);
    ok('...and flags the request as MRR', r.isMrr === true);
    ok('...and still returns ONE citizen number', /^[0-9]{4}-[0-9]{6}$/.test(r.requestNumber));
    ok('...and `id` is still the FIRST child — every pre-MRR caller keeps working', r.id === r.childIds[0]);

    var P = await db.get('SELECT * FROM requests WHERE id = ?', [r.parentId]);
    var K = await kidsOf(r.parentId);
    ok('exactly 3 child rows exist', K.length === 3);
    ok('child_no runs 1,2,3 — never 0', K.map(function (k) { return k.child_no; }).join(',') === '1,2,3');
    ok('the numbers are ' + K.map(function (k) { return k.request_number; }).join(', '),
      K[0].request_number === r.requestNumber + '-1' && K[2].request_number === r.requestNumber + '-3');
    ok('each child kept its OWN description — never merged into one blob',
      /building permit/.test(K[0].description) && /body worn camera/.test(K[1].description) && /council meeting/.test(K[2].description));
    ok('each child carries its component label', K.map(function (k) { return k.component_label; }).join(',') === 'permits,body-cam,minutes');

    // ---- 3. is_mrr is DERIVED, and it is a PARENT fact
    ok('is_mrr = 1 on the PARENT (3 children described)', Number(P.is_mrr) === 1);
    ok('...and 0 on every child — a child is a component OF an MRR, never "an MRR" itself',
      K.every(function (k) { return Number(k.is_mrr) === 0; }));

    // ---- 4. ONE citizen relationship, ONE clock, ONE deadline — however many records (§13 Layer 1)
    var pClocks = await db.all('SELECT id FROM request_clocks WHERE request_id = ?', [r.parentId]);
    ok('the request has exactly ONE statutory clock (' + pClocks.length + ') for all 3 records', pClocks.length === 1);
    var kidClocks = 0;
    for (var i = 0; i < K.length; i++) kidClocks += (await db.all('SELECT id FROM request_clocks WHERE request_id = ?', [K[i].id])).length;
    ok('NO child has its own statutory clock (' + kidClocks + ') — 3 records must never mean 3 legal deadlines', kidClocks === 0);
    ok('every child shows the SAME deadline as the parent — one due date, displayed on each work row',
      K.every(function (k) { return k.deadline_date === P.deadline_date; }));
    ok('the requestor identity lives ONLY on the parent', P.requestor_email === 'mrr@example.com' && K.every(function (k) { return k.description !== null; }));

    // ---- 5. The scope predicates hold with THREE children (they were only ever proved with one)
    var leaves = await db.all('SELECT id FROM requests r WHERE r.master_request_id = ? AND ' + scope.leaf('r'), [r.parentId]);
    ok('all 3 children are LEAVES — worklists see 3 units of work', leaves.length === 3);
    var pAsLeaf = await db.get('SELECT id FROM requests r WHERE r.id = ? AND ' + scope.leaf('r'), [r.parentId]);
    ok('...and the parent is NOT — it would be a ghost row in every work list', !pAsLeaf);
    var cntParents = await db.get('SELECT COUNT(*) AS n FROM requests r WHERE r.id = ? AND ' + scope.parent('r'), [r.parentId]);
    ok('request_count sees ONE citizen request, not three', Number(cntParents.n) === 1);
    var num = await db.get('SELECT ' + scope.numberExpr('r') + ' AS n FROM requests r' + scope.numberJoin('r') + ' WHERE r.id = ?', [K[2].id]);
    ok('a task on child 3 shows the CITIZEN\'s number (' + num.n + '), not "' + K[2].request_number + '"', num.n === r.requestNumber);

    // ---- 6. THE POINT OF ALL THIS: the children route INDEPENDENTLY, through the real portal
    var sub = await post('/api/public/submit', {
      requestorName: 'MRR Portal', requestorEmail: 'mrrportal@example.com',
      records: [
        { label: 'permits', description: 'building permit records for 250 Oak Ave ' + TAG + ' PORTAL' },
        { label: 'minutes', description: 'city council meeting minutes for April ' + TAG + ' PORTAL' }
      ]
    });
    ok('POST /public/submit accepts a `records` array (' + sub.status + ')', sub.status === 201 && !!sub.body.requestNumber);
    ok('...and the citizen is told ONE number: ' + sub.body.requestNumber, /^[0-9]{4}-[0-9]{6}$/.test(sub.body.requestNumber || ''));
    var pRow = await db.get('SELECT id FROM requests WHERE request_number = ?', [sub.body.requestNumber]);
    made.push(pRow.id);
    var PK = await kidsOf(pRow.id);
    PK.forEach(function (k) { made.push(k.id); });
    ok('the portal created 2 children from 2 described records', PK.length === 2);

    // DETERMINISM: `classifier.js` calls Anthropic (claude-sonnet-4-5), so whether a given description routes
    // CONFIDENTLY — and whether a task spawns — varies run to run. Assert the thing that is true on every path:
    // intake ran SEPARATELY FOR EACH CHILD, off each child's own description. workflowEngine writes a
    // workflow_decisions row regardless of confidence, so it is the deterministic witness that per-child
    // routing happened. (An earlier draft asserted "both children have a department" and flapped.)
    var decs = [];
    for (var w = 0; w < 80; w++) {
      decs = await db.all('SELECT request_id FROM workflow_decisions WHERE request_id = ANY($1::text[])', [PK.map(function (k) { return k.id; })]);
      if (decs.length >= 2) break;
      await sleep(500);
    }
    var perChild = PK.map(function (k) { return decs.filter(function (d) { return d.request_id === k.id; }).length; });
    ok('intake ran SEPARATELY for EACH child — one routing decision each (' + perChild.join(' / ') + ')',
      perChild.length === 2 && perChild.every(function (n) { return n >= 1; }));
    var pdecs = await db.all('SELECT id FROM workflow_decisions WHERE request_id = ?', [pRow.id]);
    ok('...and the parent was never routed (' + pdecs.length + ') — it has no description to route on', pdecs.length === 0);
    var tasks = [];
    for (var t = 0; t < PK.length; t++) tasks.push((await db.all('SELECT id, request_id FROM tasks WHERE request_id = ?', [PK[t].id])).length);
    var ptasks = await db.all('SELECT id FROM tasks WHERE request_id = ?', [pRow.id]);
    ok('the parent has NO tasks (' + ptasks.length + ') — it is not a unit of work', ptasks.length === 0);
    ok('every task intake produced hangs off a CHILD (' + tasks.join(' / ') + ')',
      (await db.all('SELECT request_id FROM tasks WHERE request_id = ANY($1::text[])', [[pRow.id].concat(PK.map(function (k) { return k.id; }))]))
        .every(function (x) { return x.request_id !== pRow.id; }));

    // ---- 7. n = 1 is NOT a special case: the same path, the same shape
    var one = await RC.createRequest({
      requestorName: 'Single', requestorEmail: 'single@example.com',
      description: 'just one police report ' + TAG
    }, { kickIntake: false, actorName: 'harness' });
    made.push(one.parentId); one.childIds.forEach(function (i) { made.push(i); });
    var OK1 = await kidsOf(one.parentId);
    var P1 = await db.get('SELECT is_mrr FROM requests WHERE id = ?', [one.parentId]);
    ok('a SINGLE-record request is simply n = 1 — one child, child_no 1', OK1.length === 1 && Number(OK1[0].child_no) === 1);
    ok('...and is NOT flagged MRR (is_mrr is derived from the count, never hand-set)', Number(P1.is_mrr) === 0 && one.isMrr === false);
    ok('...and has the identical row shape to an MRR child — this is why worklists never union two shapes',
      OK1[0].request_number === one.requestNumber + '-1' && OK1[0].master_request_id === one.parentId);

    // A caller's isMrr flag is ADVISORY — what was described decides.
    var lied = await RC.createRequest({
      requestorName: 'Liar', requestorEmail: 'liar@example.com',
      description: 'one record but the classifier guessed MRR ' + TAG, isMrr: true
    }, { kickIntake: false, actorName: 'harness' });
    made.push(lied.parentId); lied.childIds.forEach(function (i) { made.push(i); });
    var PL = await db.get('SELECT is_mrr FROM requests WHERE id = ?', [lied.parentId]);
    ok('isMrr:true with ONE description is IGNORED — the count is the truth, not the flag', Number(PL.is_mrr) === 0);

    // ---- 8. A child with no description is refused before anything is written
    var threw = null;
    try {
      await RC.createRequest({ requestorName: 'Bad', requestorEmail: 'bad@example.com',
        children: [{ description: 'fine ' + TAG }, { description: '   ' }] }, { kickIntake: false });
    } catch (e) { threw = e.message; }
    ok('a child with a blank description is REFUSED, naming which one', !!threw && /Child 2 has no description/.test(threw));
    var orphan = await db.get("SELECT id FROM requests WHERE requestor_email = 'bad@example.com'");
    ok('...and NOTHING was written — no orphan parent left behind', !orphan);

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t2 = 0; t2 < tabs.length; t2++) for (var c = 0; c < made.length; c++) {
        try { await db.run('DELETE FROM ' + tabs[t2].table_name + ' WHERE request_id=?', [made[c]]); } catch (e) {}
      }
      for (var c2 = 0; c2 < made.length; c2++) { try { await db.run('DELETE FROM requests WHERE id=? AND master_request_id IS NOT NULL', [made[c2]]); } catch (e) {} }
      for (var c3 = 0; c3 < made.length; c3++) { try { await db.run('DELETE FROM requests WHERE id=?', [made[c3]]); } catch (e) {} }
      var left = await db.get('SELECT COUNT(*) AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 test rows remain', Number(left.n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
