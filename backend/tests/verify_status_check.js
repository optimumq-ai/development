'use strict';
// PORTAL STATUS CHECK (SPEC_portal_status_check.md, decided 2026-08-12). What this harness asserts:
//
//   A. The n=1 lookup: found, requestor name, the work row's stage with the queue's own label.
//   B. Forgiveness: a child-suffixed number and stray whitespace both resolve to the parent.
//   C. The no-oracle property: an unknown-but-well-formed number, a malformed one, and (via the same
//      uniform body) every other failure shape answer with BYTE-IDENTICAL JSON — the endpoint never
//      confirms which numbers exist.
//   D. MRR: one line per child in child order, carrying component_label or the generic "Record item n" —
//      NEVER the raw description prose (asserted by marker absence) — each with its stage label; the
//      parent carries the derived two-value process status, flipping to Complete when every child is
//      terminal.
//   E. The PII contract (§6.1): the response body never contains an email address (TX §552.137), phone,
//      or any key outside the spec's allowlist; an anonymous requestor renders as null rather than
//      breaking the lookup.
//   F. The rate limiter is wired (source-scan idiom, like verify_v1_retirement §F — brute-forcing 21
//      calls would poison the shared per-IP buckets for every harness after this one).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var stages = require('/opt/optimumq/backend/src/services/stages');

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'STATUS-' + Date.now();
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function post(p, body) {
  return new Promise(function (res, rej) {
    var payload = JSON.stringify(body || {});
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j, raw: d }); });
    });
    r.on('error', rej);
    r.write(payload); r.end();
  });
}
function lookup(n) { return post('/api/public/request-status', { requestNumber: n }); }

(async function () {
  try {
    await db.initDb();
    console.log('\n=== A. THE n=1 LOOKUP ===');
    var sub1 = await post('/api/public/submit', {
      requestorName: 'Status Harness', requestorEmail: 'status-harness@example.com',
      description: 'fire inspection reports for 12 Main St ' + TAG + ' SENSITIVE-PROSE-MARKER'
    });
    ok('a single-record request submits through the REAL portal path (' + sub1.status + ')', sub1.status === 201 && !!sub1.body.requestNumber);
    var num1 = sub1.body.requestNumber;
    var p1 = await db.get('SELECT id FROM requests WHERE request_number = ?', [num1]);
    // The classifier advances intake -> record_search in the background, so snapshot the work row's stage
    // around the lookup and accept either side of the race — what must hold is agreement + a real label.
    var before = await db.get('SELECT stage FROM requests WHERE master_request_id = ?', [p1.id]);
    var r1 = await lookup(num1);
    var after = await db.get('SELECT stage FROM requests WHERE master_request_id = ?', [p1.id]);
    ok('found, with the requestor\'s name (Kevin\'s §6.1 decision: requests are public records)',
      r1.status === 200 && r1.body.found === true && r1.body.requestorName === 'Status Harness');
    ok('the stage is the WORK ROW\'s stage (' + r1.body.stage + ')',
      r1.body.stage === before.stage || r1.body.stage === after.stage);
    ok('...labelled exactly as the staff queue labels it (' + r1.body.stageLabel + ')',
      r1.body.stageLabel === stages.LABELS[r1.body.stage]);
    ok('a single-record request answers with NO children list — n = 1 is not an MRR to the citizen',
      r1.body.children === undefined && r1.body.isMrr === false);

    console.log('\n=== B. FORGIVENESS ===');
    var rSuffix = await lookup(num1 + '-1');
    ok('a child-suffixed number answers for its PARENT — never "no match" for a request that exists',
      rSuffix.body.found === true && rSuffix.body.requestNumber === num1);
    var rSpace = await lookup('  ' + num1 + '  ');
    ok('stray whitespace is stripped', rSpace.body.found === true);

    console.log('\n=== C. THE NO-ORACLE PROPERTY ===');
    var unknown = await lookup('2091-999999');
    var garbage = await lookup('not-a-number');
    var empty = await lookup('');
    ok('an unknown number answers found:false with the uniform message', unknown.body.found === false && !!unknown.body.message);
    ok('...BYTE-IDENTICAL to a malformed number and an empty one — no failure shape is distinguishable',
      unknown.raw === garbage.raw && unknown.raw === empty.raw);

    console.log('\n=== D. MRR ===');
    var sub2 = await post('/api/public/submit', {
      requestorName: 'MRR Status Harness', requestorEmail: 'status-mrr@example.com',
      records: [
        { label: 'Building permits', description: 'permits for 40 Elm ' + TAG },
        { label: 'Council minutes', description: 'minutes April ' + TAG },
        { description: 'UNLABELED-PROSE-MARKER body cam of the incident ' + TAG }
      ]
    });
    ok('a 3-record request submits (' + sub2.status + ')', sub2.status === 201);
    var num2 = sub2.body.requestNumber;
    var p2 = await db.get('SELECT id FROM requests WHERE request_number = ?', [num2]);
    var r2 = await lookup(num2);
    ok('an MRR answers one line per child, in child order',
      r2.body.found === true && Array.isArray(r2.body.children) && r2.body.children.length === 3 &&
      r2.body.children.map(function (c) { return c.childNo; }).join(',') === '1,2,3');
    ok('children carry the summarized label, or the GENERIC fallback — never request prose (§6.1)',
      r2.body.children[0].label === 'Building permits' && r2.body.children[2].label === 'Record item 3' &&
      r2.raw.indexOf('UNLABELED-PROSE-MARKER') < 0);
    ok('each child carries its own stage with the queue\'s label',
      r2.body.children.every(function (c) { return c.stageLabel === stages.LABELS[c.stage]; }));
    ok('the parent carries the derived process status, not a stage (§6.1 parent/child spec)',
      r2.body.processStatus === 'In Process' && r2.body.stage === undefined && r2.body.isMrr === true);
    // Fixture write, test DB only: park every child terminal to flip the derived status.
    await db.run("UPDATE requests SET stage = 'closed', status = 'closed' WHERE master_request_id = ?", [p2.id]);
    var r2done = await lookup(num2);
    ok('...and flips to Complete when every child is terminal',
      r2done.body.processStatus === 'Complete' &&
      r2done.body.children.every(function (c) { return c.stageLabel === 'Closed'; }));

    console.log('\n=== E. THE PII CONTRACT ===');
    var ALLOWED = ['found', 'requestNumber', 'requestorName', 'isMrr', 'processStatus', 'stage', 'stageLabel', 'children', 'message'];
    var keysOk = [r1, r2, unknown].every(function (r) {
      return Object.keys(r.body).every(function (k) { return ALLOWED.indexOf(k) >= 0; });
    });
    ok('every response key is on the spec\'s allowlist', keysOk);
    ok('no response body ever contains an email address (TX §552.137) — or an @ at all',
      [r1, rSuffix, r2, r2done, unknown].every(function (r) { return r.raw.indexOf('@') < 0; }));
    ok('...or the request prose from either fixture',
      [r1, r2, r2done].every(function (r) { return r.raw.indexOf('SENSITIVE-PROSE-MARKER') < 0 && r.raw.indexOf(TAG) < 0; }));
    // The schema requires a requestor_name value, so anonymity arrives as an EMPTY (or pseudonymous)
    // string — the endpoint normalizes empty to null and the modal renders an em-dash.
    await db.run("UPDATE requests SET requestor_name = '' WHERE id = ?", [p1.id]);
    var rAnon = await lookup(num1);
    ok('an anonymous requestor answers gracefully with a null name (FL/CA/OH allow anonymity)',
      rAnon.body.found === true && rAnon.body.requestorName === null);

    console.log('\n=== F. THE RATE LIMITER IS WIRED (source-scan — bruting 21 calls would poison the shared IP buckets) ===');
    var src = fs.readFileSync('/opt/optimumq/backend/src/routes/publicChat.js', 'utf8');
    var seg = src.slice(src.indexOf("router.post('/request-status'"), src.indexOf("router.post('/request-status'") + 600);
    ok('the route opens with checkRate and answers 429', seg.indexOf('checkRate(req.ip)') >= 0 && seg.indexOf('429') >= 0);
    ok('...and the uniform no-match body is defined ONCE in the route (the no-oracle property is structural)',
      (src.slice(src.indexOf("router.post('/request-status'")).split('NO_MATCH').length - 1) >= 3);
  } catch (e) {
    fail++; console.log('  ERR  ' + (e && e.stack || e));
  } finally {
    console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  }
})();
