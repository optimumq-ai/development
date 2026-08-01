'use strict';
// FORM BUILD (2026-08-01) — intake-parity for the paper channel.
//
// The claim under test: a 10-item paper form logged by staff produces EXACTLY the shape a 10-item
// portal submission produces — parent + one child per described record (§5.1) — because the staff
// create route now accepts children[]. Before this build the staff UI could only send one description,
// so a multi-item paper form flattened into one child and broke everything downstream that leans on
// one-description-per-record (per-item search, per-item defects, the MRR hub).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'FORM-' + Date.now();
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, p, body) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j }); });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}
var created = [];
async function cluster(childId) {
  var child = await db.get('SELECT * FROM requests WHERE id = ?', [childId]);
  var parent = child && child.master_request_id ? await db.get('SELECT * FROM requests WHERE id = ?', [child.master_request_id]) : null;
  var kids = parent ? await db.all('SELECT * FROM requests WHERE master_request_id = ? ORDER BY child_no', [parent.id]) : [child];
  if (parent) created.push(parent.id);
  kids.forEach(function (k) { created.push(k.id); });
  return { child: child, parent: parent, kids: kids };
}

(async function () {
  await db.initDb();
  try {
    var users = await db.all("SELECT * FROM users WHERE status = 'active' ORDER BY id LIMIT 1");
    TOKEN = await auth.signAccessToken(users[0]);

    // ---- 1. The paper form's shape: n described records → parent + n children
    var r1 = await req('POST', '/api/requests', {
      requestorName: 'Paper Requestor', requestorEmail: 'paper-' + TAG + '@example.com',
      description: 'Record 1: the crossing-guard schedule ' + TAG,
      children: [
        { description: 'Record 1: the crossing-guard schedule ' + TAG },
        { description: 'Record 2: the intersection camera footage ' + TAG },
        { description: 'Record 3: the maintenance log ' + TAG }
      ],
      identityConfirmed: true
    });
    ok('1  staff create with children[] answers 201', r1.status === 201 && !!r1.body.requestId);
    var c1 = await cluster(r1.body.requestId);
    ok('1b PARENT + THREE CHILDREN — one per described record, child_no 1..3',
      !!c1.parent && c1.kids.length === 3 && c1.kids.map(function (k) { return k.child_no; }).join(',') === '1,2,3');
    ok('1c the citizen number is the parent\'s; children carry the component suffixes',
      /^\d{4}-\d{6}$/.test(c1.parent.request_number) &&
      c1.kids.every(function (k, i) { return k.request_number === c1.parent.request_number + '-' + (i + 1); }));
    ok('1d is_mrr is DERIVED from what was described — parent 1, children 0',
      Number(c1.parent.is_mrr) === 1 && c1.kids.every(function (k) { return Number(k.is_mrr) === 0; }));
    ok('1e each child keeps ITS OWN verbatim description; the parent\'s is NULL (§5.1 — no double-count)',
      c1.parent.description === null &&
      /camera footage/.test(c1.kids[1].description) && /maintenance log/.test(c1.kids[2].description));
    ok('1f citizen identity is copied to every child — the children agree who asked',
      c1.kids.every(function (k) { return k.requestor_email === c1.parent.requestor_email; }));
    ok('1g the walk-in identity anchor marks the WHOLE cluster',
      Number(c1.parent.identity_confirmed) === 1 && c1.kids.every(function (k) { return Number(k.identity_confirmed) === 1; }));

    // ---- 2. The n=1 path is unchanged — a single description is not a special case
    var r2 = await req('POST', '/api/requests', {
      requestorName: 'Single Item', requestorEmail: 'single-' + TAG + '@example.com',
      description: 'Just the one record ' + TAG
    });
    var c2 = await cluster(r2.body.requestId);
    ok('2  a single description still creates parent + ONE child, is_mrr 0',
      r2.status === 201 && c2.kids.length === 1 && Number(c2.parent.is_mrr) === 0);

    // ---- 3. Refusals
    var r3 = await req('POST', '/api/requests', { requestorName: 'No Records', requestorEmail: 'none-' + TAG + '@example.com' });
    ok('3  no description and no children is a 400, not a row', r3.status === 400);
    var r4 = await req('POST', '/api/requests', {
      requestorName: 'Blank Records', requestorEmail: 'blank-' + TAG + '@example.com',
      children: [{ description: '   ' }, { description: '' }]
    });
    ok('3b children that describe NOTHING do not count — still a 400', r4.status === 400);

  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack);
    fail++;
  } finally {
    try {
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t = 0; t < tabs.length; t++) for (var c = 0; c < created.length; c++) {
        try { await db.run('DELETE FROM ' + tabs[t].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c2i = 0; c2i < created.length; c2i++) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c2i]]); } catch (e) {} }
      // The anchors this harness minted ride requestor_profiles keyed by the harness emails.
      await db.run("DELETE FROM requestor_request_links WHERE profile_id IN (SELECT id FROM requestor_profiles WHERE primary_email LIKE ?)", ['%' + TAG + '%']);
      await db.run('DELETE FROM requestor_profiles WHERE primary_email LIKE ?', ['%' + TAG + '%']);
      var left = await db.get('SELECT COUNT(*)::int AS n FROM requests WHERE requestor_email LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 harness requests left', Number(left.n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e && e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
