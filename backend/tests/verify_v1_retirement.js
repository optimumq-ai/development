'use strict';
// THE v1 REDACTION DUPLICATES ARE RETIRED — AND ONE OF THEM WAS NEVER A DUPLICATE (brief §5.5).
//
// Kevin's call, 2026-07-19: retire them. Investigating found the brief's §2.3 characterization was half
// wrong, and the wrong half is the interesting one:
//
//   `RedactionReviewPage` (/redact/:fileId/review)  — genuinely superseded. `RedactionTaskPage` has its own
//                                                     side-by-side. Its ONLY inbound link was a button on
//                                                     the v1 workspace. DELETED.
//   `RedactionWorkspacePage` (/redact/:fileId)      — NOT a duplicate. It is the canvas that marks up SAMPLE
//                                                     documents for redaction TEMPLATE authoring, uploaded
//                                                     from MassRedactionPage onto `req-template-samples`
//                                                     (`SYS-TEMPLATE-SAMPLES`) — a protected pseudo-request
//                                                     with zero tasks by design. `RedactionTaskPage` is keyed
//                                                     on a taskId and cannot serve it. KEPT, scoped.
//
// WHAT WAS ACTUALLY DUPLICATED WAS THE ENTRY POINT, not the page: the per-record `Redact` button on the
// request workspace sent a CITIZEN record into the task-less canvas. That screen carries no work timer, so
// redaction labour was never measured — and labour is billable, so the city under-billed for it. That button
// is the thing retired here.
//
// This harness is a SOURCE SCAN, in the same idiom as verify_stages' ghost-stage check: the defect is a link
// that exists, so the assertion is that it does not.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var FE = '/opt/optimumq/frontend/src';

// Every .js under the frontend, so a re-introduced link is caught wherever it is added.
function walk(dir, out) {
  out = out || [];
  fs.readdirSync(dir).forEach(function (f) {
    var p = dir + '/' + f;
    if (fs.statSync(p).isDirectory()) return walk(p, out);
    if (/\.js$/.test(f)) out.push(p);
  });
  return out;
}
// A comment NAMING the retired path (to explain why it is gone) is fine; a code reference is not.
function codeHits(re) {
  var hits = [];
  walk(FE).forEach(function (p) {
    fs.readFileSync(p, 'utf8').split('\n').forEach(function (line, i) {
      if (re.test(line) && !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) hits.push(p.replace(FE + '/', '') + ':' + (i + 1));
    });
  });
  return hits;
}

(async function () {
  await db.initDb();

  console.log('\n=== A. THE SUPERSEDED PAGE IS GONE ===');
  ok('A1 pages/RedactionReviewPage.js no longer exists', !fs.existsSync(FE + '/pages/RedactionReviewPage.js'));
  var refs = codeHits(/RedactionReviewPage/);
  ok('A2 nothing imports or routes it' + (refs.length ? ' — found ' + refs.join(', ') : ''), refs.length === 0);
  var reviewRoute = codeHits(/redact\/:fileId\/review|\/redact\/[^']*\+ *'\/review'|'\/review'\)/);
  ok('A3 the /redact/:fileId/review route is gone' + (reviewRoute.length ? ' — found ' + reviewRoute.join(', ') : ''),
    reviewRoute.length === 0);

  console.log('\n=== B. THE DUPLICATED ENTRY POINT IS GONE — this is the one that cost money ===');
  // The v1 canvas has no work timer. A citizen record redacted there produced no labour actuals, and
  // labour is billable — so the city under-billed. Reaching it with a RECORD id is the defect.
  var recordLinks = codeHits(/nav\('\/redact\/' \+ r\.id\)|navigate\('\/redact\/' \+ r\.id\)/);
  ok('B1 no screen sends a citizen RECORD into the task-less canvas' +
     (recordLinks.length ? ' — found ' + recordLinks.join(', ') : ''), recordLinks.length === 0);
  var panel = fs.readFileSync(FE + '/components/ui/RecordsPanel.js', 'utf8');
  ok('B2 the request workspace no longer offers a per-record Redact button',
    !/>\{?\(?matches\[r\.id\][^}]*\?\s*'Auto-redact'\s*:\s*'Redact'/.test(panel));
  // The badge is information, not a way in — retiring the button must not have taken it out.
  ok('B3 …but the template-match BADGE survives (information, not an entry point)',
    /Template match:/.test(panel));

  console.log('\n=== C. THE SURVIVOR IS KEPT, AND SCOPED ===');
  ok('C1 pages/RedactionWorkspacePage.js still exists', fs.existsSync(FE + '/pages/RedactionWorkspacePage.js'));
  var wsSrc = fs.readFileSync(FE + '/pages/RedactionWorkspacePage.js', 'utf8');
  ok('C2 and says, at the top, that it is template authoring rather than a record workstation',
    /TEMPLATE AUTHORING/.test(wsSrc.slice(0, 1200)));
  // Its one legitimate caller: a template SAMPLE upload, which has no task to open instead.
  var sampleLink = codeHits(/navigate\('\/redact\/' \+ fid\)/);
  ok('C3 MassRedactionPage still reaches it for a template sample', sampleLink.length === 1);

  console.log('\n=== D. WHY IT CANNOT BE FOLDED INTO THE TASK SCREEN ===');
  // The premise of keeping it. If the samples ever grew tasks, the survivor would become a real duplicate
  // and this assertion is what would notice.
  var holding = await db.get("SELECT id, request_number FROM requests WHERE id = 'req-template-samples'");
  ok('D1 the template-sample holding area exists and is a SYS pseudo-request',
    !!holding && holding.request_number === 'SYS-TEMPLATE-SAMPLES');
  var tasks = await db.get("SELECT count(*)::int AS n FROM tasks WHERE request_id = 'req-template-samples'");
  ok('D2 it carries ZERO tasks — so a taskId-keyed screen could never open its files', tasks.n === 0);
  var purge = fs.readFileSync('/opt/optimumq/backend/src/db/purge_test_requests.js', 'utf8');
  ok('D3 and it is PROTECTED from purges, so this is a standing arrangement not an accident',
    /PROTECTED[\s\S]{0,120}req-template-samples/.test(purge));

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
