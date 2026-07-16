'use strict';
// THE REQUEST QUEUE UNDER PARENT/CHILD (SPEC_parent_child_lifecycle.md §7).
//
// §7: "every request renders as a parent line with its children indented beneath it. When `child_count = 1`,
// the pair collapses to a single line and the `-1` suffix is hidden." The queue lists CHILD rows — that is the
// requirement that decided the whole model ("a report of all requests in redaction should include single-request
// child records as well as MRR child records") — and reassembles them for display.
//
// THE BUG CLASS THIS LOCKS DOWN. Listing children is right; READING PARENT FACTS OFF THEM is wrong. Before this
// slice `GET /requests` selected `r.*` from the leaf and rendered four parent-level columns straight out of it:
//
//   * `request_number` — a child's own number carries the component suffix ('2026-000001-1'). The queue showed
//     staff a number the CITIZEN HAS NEVER SEEN and cannot quote on the phone.
//   * `is_mrr`         — DERIVED and PARENT-level (§4.1); requestCreate forces `is_mrr = 0` on EVERY child. So
//     the MRR badge could never render — not "rarely", never. This test is why that was found.
//
// It also pins the two things the display depends on that are not obvious from the schema:
//   * CHILD ORDER. The children of one request are inserted in a single loop, milliseconds apart. Ordering by
//     the child's own created_at put an MRR's records on screen BACKWARDS (-3, -2, -1). The ORDER BY must key
//     on the PARENT's recency, then child_no ascending.
//   * DUPLICATE-COLUMN LAST-WINS. `r.*` already emits request_number and is_mrr; the parent-resolved aliases
//     come later in the select list and node-pg keeps the LAST column of a duplicated name. That is real driver
//     behaviour but it is IMPLICIT — if it ever changed, the queue would silently show child numbers again.
//     Asserted here rather than trusted.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');

var pass = 0, fail = 0, made = [];
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var PORT = Number(process.env.API_PORT) || 3101, TAG = 'QPC-' + Date.now();

async function api(method, path, tok) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method, headers: tok ? { Authorization: 'Bearer ' + tok } : {}
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async function () {
  await db.initDb();
  try {
    // An ELEVATED user: the queue scopes non-elevated staff to their own department, which would hide the
    // fixtures for reasons that have nothing to do with parent/child and make this test lie.
    var u = null;
    var us = await db.all('SELECT id FROM users');
    for (var i = 0; i < us.length; i++) {
      var full = await auth.getUserById(us[i].id);
      var fr = (full && full.functionRoles) || [];
      if (fr.some(function (r) { return ['SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN'].indexOf(r) !== -1; })) { u = full; break; }
    }
    if (!u) throw new Error('no elevated user to authenticate as');
    var TOKEN = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [u.id]));

    // ---- fixtures: one n=1 request and one n=3 MRR, both through the ONE creation helper.
    // kickIntake:false — the classifier calls Anthropic, so routing/confidence is NONDETERMINISTIC. This test
    // asserts SHAPE, which is true on every path; asserting on a classifier outcome is what made an earlier
    // harness pass 39/39 and then fail on identical code.
    var single = await RC.createRequest({
      requestorName: 'Queue Single', requestorEmail: 'qs@example.com',
      description: 'single permit record ' + TAG, classification: 'standard'
    }, { kickIntake: false, actorName: 'harness' });
    made.push(single.parentId); made = made.concat(single.childIds);

    var mrr = await RC.createRequest({
      requestorName: 'Queue Mrr', requestorEmail: 'qm@example.com',
      children: [
        { description: 'body-cam footage ' + TAG, componentLabel: 'Body-cam' },
        { description: 'use-of-force reports ' + TAG, componentLabel: 'Use of force' },
        { description: 'overtime payroll ' + TAG, componentLabel: 'Overtime' }
      ]
    }, { kickIntake: false, actorName: 'harness' });
    made.push(mrr.parentId); made = made.concat(mrr.childIds);

    var res = await api('GET', '/requests', TOKEN);
    ok('GET /requests returns 200', res.status === 200);
    var rows = (res.body && res.body.requests) || [];
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });

    // ---- 1. The queue lists WORK ROWS — children, never parents (§7).
    ok('the n=1 request\'s CHILD is in the queue', !!byId[single.childId]);
    ok('...and its PARENT is NOT — a parent in a work queue is the double-count scope predicates exist to prevent',
      !byId[single.parentId]);
    ok('all three MRR CHILDREN are in the queue',
      mrr.childIds.every(function (id) { return !!byId[id]; }));
    ok('...and the MRR PARENT is not', !byId[mrr.parentId]);

    // ---- 2. request_number is the CITIZEN's, resolved through the parent (last-wins over r.*).
    var s = byId[single.childId];
    ok('the n=1 child reports the CITIZEN\'s number (' + s.request_number + '), not its own suffixed one',
      s.request_number === single.requestNumber);
    ok('...and /^YYYY-NNNNNN$/ — no "-1" leaks into the column staff read',
      /^[0-9]{4}-[0-9]{6}$/.test(s.request_number));
    ok('...while `component_number` still carries the child\'s own number for anyone who needs it',
      s.component_number === single.requestNumber + '-1');
    var m1 = byId[mrr.childIds[0]];
    ok('every MRR child reports the SAME citizen number (' + m1.request_number + ')',
      mrr.childIds.every(function (id) { return byId[id].request_number === mrr.requestNumber; }));
    ok('...and each keeps its OWN component_number',
      mrr.childIds.every(function (id, k) { return byId[id].component_number === mrr.requestNumber + '-' + (k + 1); }));

    // ---- 3. is_mrr is the PARENT's. The table says 0 on every child; the API must say what the REQUEST is.
    var rawChild = await db.get('SELECT is_mrr FROM requests WHERE id = ?', [mrr.childIds[0]]);
    ok('sanity: the MRR child row itself stores is_mrr = 0 (it is a component, never "an MRR")',
      Number(rawChild.is_mrr) === 0);
    ok('...but the API resolves is_mrr = 1 from the PARENT — without this the MRR badge can NEVER render',
      mrr.childIds.every(function (id) { return Number(byId[id].is_mrr) === 1; }));
    ok('the n=1 request is NOT an MRR', Number(s.is_mrr) === 0);

    // ---- 4. child_count drives the collapse (§7).
    ok('the n=1 child reports child_count = 1 -> the queue collapses the pair to one line',
      Number(s.child_count) === 1);
    ok('every MRR child reports child_count = 3 -> a parent line + 3 indented children',
      mrr.childIds.every(function (id) { return Number(byId[id].child_count) === 3; }));

    // ---- 5. parent_id is the grouping key.
    ok('the MRR children all share one parent_id',
      mrr.childIds.every(function (id) { return byId[id].parent_id === mrr.parentId; }));
    ok('...which is the parent, not any child', mrr.childIds.indexOf(mrr.parentId) === -1);

    // ---- 6. ORDER: children adjacent, and child_no ASCENDING. This is the '-3, -2, -1' bug.
    var idx = mrr.childIds.map(function (id) { return rows.findIndex(function (r) { return r.id === id; }); });
    ok('the MRR\'s children arrive ADJACENT — grouping never has to reorder the server\'s decision',
      Math.max.apply(null, idx) - Math.min.apply(null, idx) === 2);
    ok('...in child_no ASCENDING order (-1, -2, -3), not the insertion-time order that showed them backwards',
      idx[0] < idx[1] && idx[1] < idx[2]);

    // ---- 7. Search matches the CITIZEN's number and returns the whole request.
    var f = await api('GET', '/requests?search=' + encodeURIComponent(mrr.requestNumber), TOKEN);
    var got = (f.body && f.body.requests) || [];
    ok('searching the citizen\'s number returns all 3 of its records, not 0 (' + got.length + ')',
      mrr.childIds.every(function (id) { return got.some(function (r) { return r.id === id; }); }));

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    try {
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t = 0; t < tabs.length; t++) for (var c = 0; c < made.length; c++) {
        try { await db.run('DELETE FROM ' + tabs[t].table_name + ' WHERE request_id=?', [made[c]]); } catch (e) {}
      }
      // children first — the parent is referenced by master_request_id
      for (var a = 0; a < made.length; a++) { try { await db.run('DELETE FROM requests WHERE id=? AND master_request_id IS NOT NULL', [made[a]]); } catch (e) {} }
      for (var b = 0; b < made.length; b++) { try { await db.run('DELETE FROM requests WHERE id=?', [made[b]]); } catch (e) {} }
      var left = await db.get('SELECT COUNT(*) AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 test rows remain', Number(left.n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
