'use strict';
// ONE canonical stage vocabulary.
// The bug: the frontend carried its own 7-stage list — a DIFFERENT ORDER from the backend, missing
// exemption_review / ag_review / redaction entirely, and containing a GHOST stage `custodian_retrieval`
// that exists nowhere in the backend. The RequestWorkspacePage "Advance" button drove LIVE stage writes
// off that list, so an operator advancing a request walked a pipeline the backend does not have.
// A third list (routes/workflow.js VOCAB.stages, 4 stages) fed the AI workflow-rule builder.
//
// This harness is the thing that keeps them from diverging again: it compares the frontend mirror to the
// backend endpoint, so a future edit to one and not the other FAILS rather than rotting.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var fs = require('fs');
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var stages = require('/opt/optimumq/backend/src/services/stages');
var { chromium } = require('/tmp/claude-998/-opt-optimumq/ca3c2235-853d-497f-915f-725470b8726d/scratchpad/node_modules/playwright');

var FE = '/opt/optimumq/frontend/src';
var TAG = 'STAGES-' + Date.now();
var pass = 0, fail = 0, TOKEN = null, created = [];
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function submit(d) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify({ description: d, requestorName: 'Stage Test', requestorEmail: 'st@example.com' });
    var r = http.request({ host: 'localhost', port: (Number(process.env.API_PORT) || 3101), path: '/api/public/submit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      function (resp) { resp.on('data', function () {}); resp.on('end', function () { res(resp.statusCode); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}
async function api(method, path, body) {
  var r = await fetch('http://localhost:' + (Number(process.env.API_PORT) || 3101) + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async function () {
  await db.initDb();
  var browser;
  try {
    var user = await db.get("SELECT id, email, display_name, department_id FROM users WHERE status='active' AND display_name IS NOT NULL LIMIT 1");
    TOKEN = await auth.signAccessToken(user);

    // ---- 1. THE GHOST IS GONE, everywhere
    var offenders = [];
    (function walk(dir) {
      fs.readdirSync(dir).forEach(function (f) {
        var p = dir + '/' + f;
        if (fs.statSync(p).isDirectory()) return walk(p);
        if (!/\.jsx?$/.test(f)) return;
        var src = fs.readFileSync(p, 'utf8');
        src.split('\n').forEach(function (line, i) {
          // ignore the explanatory comments that name the ghost
          if (/custodian_retrieval/.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(p.replace(FE, '') + ':' + (i + 1));
        });
      });
    })(FE);
    ok('the ghost stage `custodian_retrieval` appears in NO frontend code' + (offenders.length ? ' — found ' + offenders.join(', ') : ''), offenders.length === 0);
    var beOff = [];
    (function walk(dir) {
      fs.readdirSync(dir).forEach(function (f) {
        var p = dir + '/' + f;
        if (fs.statSync(p).isDirectory()) return walk(p);
        if (!/\.js$/.test(f)) return;
        fs.readFileSync(p, 'utf8').split('\n').forEach(function (line, i) {
          // same rule as the frontend scan: a comment NAMING the ghost (to explain why it is gone) is fine;
          // a code reference is not.
          if (/custodian_retrieval/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) beOff.push(p + ':' + (i + 1));
        });
      });
    })('/opt/optimumq/backend/src');
    ok('...and in no backend code either' + (beOff.length ? ' — found ' + beOff.join(', ') : ''), beOff.length === 0);

    // ---- 2. PARITY: the frontend mirror === the backend endpoint. This is the anti-rot test.
    var ep = await api('GET', '/stages');
    ok('GET /api/stages serves the canonical vocabulary', ep.status === 200 && Array.isArray(ep.body.order));
    var beOrder = ep.body.order;
    ok('the endpoint matches services/stages.js', JSON.stringify(beOrder) === JSON.stringify(stages.ORDER));

    var feSrc = fs.readFileSync(FE + '/lib/stages.js', 'utf8');
    var feKeys = (feSrc.match(/\{\s*key:\s*'([a-z_]+)'/g) || []).map(function (m) { return m.match(/'([a-z_]+)'/)[1]; });
    ok('FRONTEND MIRROR PARITY — the frontend stage list is identical, in order, to the backend\'s\n           backend: ' + beOrder.join(' → ') + '\n           frontend: ' + feKeys.join(' → '),
      JSON.stringify(feKeys) === JSON.stringify(beOrder));

    // every stage the frontend can render must have a label and a colour
    var feLabels = (feSrc.match(/label:\s*'[^']+'/g) || []).length;
    var feColors = (feSrc.match(/^\s{2}[a-z_]+:\s*\{ bg:/gm) || []).length;
    ok('every one of the ' + beOrder.length + ' stages has a label (' + feLabels + ') and a colour (' + feColors + ')',
      feLabels === beOrder.length && feColors === beOrder.length);

    // ---- 3. the AI rule builder's vocabulary is the canonical one too (it had 4 stages)
    var wf = fs.readFileSync('/opt/optimumq/backend/src/routes/workflow.js', 'utf8');
    ok('routes/workflow.js no longer hardcodes a 4-stage vocabulary for the AI rule builder',
      !/stages:\s*\['intake','record_search','redaction_review','fee_review'\]/.test(wf) && /require\('\.\.\/services\/stages'\)/.test(wf));

    // ---- 4. no page keeps a private copy of the vocabulary any more
    var dupes = [];
    // MyTasksPage is intentionally NOT here: the task-centric restructure (#8) shows task STATE (Queued/In
    // Process), not request stage, so it no longer imports the stage vocabulary. It also keeps no private copy.
    ['pages/DashboardPage.js', 'pages/ARIAReportsPage.js', 'pages/RequestQueuePage.js',
     'pages/RequestWorkspacePage.js', 'components/ui/WorkflowDecisionPanel.js'].forEach(function (f) {
      var s = fs.readFileSync(FE + '/' + f, 'utf8');
      if (/^(const|var)\s+(STAGES|SC|STAGE_LABELS?|STAGE_COLORS|NEXT_STAGE|NEXT_LABEL)\s*=\s*[[{]/m.test(s)) dupes.push(f);
      if (!/from '\.\.?\/?\.*\/?lib\/stages'/.test(s) && !/lib\/stages/.test(s)) dupes.push(f + ' (no import)');
    });
    ok('all 5 files import the shared vocabulary; none keeps a private copy' + (dupes.length ? ' — ' + dupes.join(', ') : ''), dupes.length === 0);
    // And MyTasksPage keeps NO private stage vocabulary (it dropped stages entirely, not copied them).
    ok('MyTasksPage keeps no private stage vocabulary (task-centric, uses task state not stage)',
      !/^(const|var)\s+(STAGES|SC|STAGE_LABELS?|STAGE_COLORS|NEXT_STAGE|NEXT_LABEL)\s*=\s*[[{]/m.test(fs.readFileSync(FE + '/pages/MyTasksPage.js', 'utf8')));

    // ---- 5. THE LIVE BEHAVIOUR: advancing follows the BACKEND pipeline now.
    // Old frontend said intake → record_search. The backend pipeline says intake → fee_review.
    ok('canonical next(intake) = fee_review (the old frontend said record_search — it skipped the money)',
      stages.next('intake') === 'fee_review');
    // ⚠️ FLIPPED 2026-07-19 (Kevin, brief §5). This used to assert exemption_review — and the old frontend
    // jumping "straight to redaction_review" turns out to have been RIGHT about the destination, for the
    // wrong reason. The legal stages are a conditional BRANCH, not steps on the way to redaction.
    ok('canonical next(record_search) = redaction_review — the legal stages are not on the linear path',
      stages.next('record_search') === 'redaction_review');
    ok('the legal stages are still in the VOCABULARY, just not in the sequence',
      stages.ORDER.indexOf('exemption_review') > 0 && stages.SEQUENCE.indexOf('exemption_review') < 0 &&
      stages.ORDER.indexOf('ag_review') > 0 && stages.SEQUENCE.indexOf('ag_review') < 0);
    // THE POINT: Advance must never offer a legal stage, from anywhere.
    ok('no stage in the sequence advances INTO a legal stage',
      stages.ORDER.every(function (s) { return !stages.isBranch(stages.next(s)); }));
    ok('and a legal stage offers no Advance at all — it is left by a legal decision, with a note',
      stages.next('exemption_review') === null && stages.next('ag_review') === null);
    ok('the pipeline can now REACH the redaction stage at all (it was unreachable from the old list)',
      stages.ORDER.indexOf('redaction') > 0 && stages.next('redaction_review') === 'redaction');
    ok('next(closed) = null — no advance past the end', stages.next('closed') === null);
    ok('next(a ghost/unknown stage) = null, not a guess', stages.next('custodian_retrieval') === null);

    await submit('Stage vocabulary check ' + TAG);
    var req = null;
    // `description` is a CHILD field (requestCreate NULLs it on the parent), so this row is the CHILD and its
    // `request_number` carries the component suffix. The number the WORKSPACE must show is the PARENT's — the
    // one the citizen was given. Resolve both: `citizenNumber` is what the UI is asserted on, `req.request_number`
    // is kept so the suffix can be asserted ABSENT.
    for (var i = 0; i < 60 && !req; i++) { req = await db.get('SELECT id, request_number, stage, master_request_id FROM requests WHERE description LIKE ?', ['%' + TAG + '%']); await sleep(250); }
    ok('a request was created through the real portal path', !!req);
    created.push(req.id);
    var citizenNumber = req.request_number;
    if (req.master_request_id) {
      var par = await db.get('SELECT request_number FROM requests WHERE id = ?', [req.master_request_id]);
      if (par) citizenNumber = par.request_number;
    }

    // ---- 6. THE UI: the Advance button must offer the canonical next stage, not the legacy one.
    browser = await chromium.launch();
    var ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });

    // The frontend is served by nginx on :80, and nginx proxies /api to the LIVE API on :3001. That is fine
    // in production and useless here: the request under test exists only in the TEST database, so the real UI
    // would render a 404 and this assertion would fail for a reason that has nothing to do with stages.
    //
    // Rather than drop the UI coverage, re-point the API underneath the SAME real frontend bundle: intercept
    // every /api call the page makes and fulfil it from the API under test. We proxy it in Node and hand the
    // response back, instead of redirecting the browser, so this does not depend on CORS.
    await ctx.route('**/api/**', async function (route) {
      var reqp = route.request();
      var u = new URL(reqp.url());
      var target = 'http://localhost:' + (Number(process.env.API_PORT) || 3101) + u.pathname + u.search;
      try {
        var r = await fetch(target, {
          method: reqp.method(),
          headers: reqp.headers(),
          body: ['GET', 'HEAD'].indexOf(reqp.method()) >= 0 ? undefined : reqp.postData(),
        });
        var buf = Buffer.from(await r.arrayBuffer());
        await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: buf });
      } catch (e) {
        await route.abort();
      }
    });

    await ctx.addInitScript(function (t) { try { localStorage.setItem('oq_token', t); } catch (e) {} }, TOKEN);
    var page = await ctx.newPage();
    var errs = [];
    page.on('pageerror', function (e) { errs.push(e.message); });

    await page.goto('http://localhost/requests/' + req.id, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=' + citizenNumber, { timeout: 20000 });
    var body = await page.textContent('body');
    // Lock in the parent-fact resolution on GET /requests/:id: the workspace is reached by the CHILD's id
    // (that is the row that carries the stage being tested), and it must still title itself with the citizen's
    // number. Before the fix this page rendered the suffixed child number and the assertion above passed for
    // the wrong reason, so assert the suffix is ABSENT rather than trusting a substring match.
    ok('the workspace shows the CITIZEN\'s request number (' + citizenNumber + '), not the child suffix',
      body.indexOf(citizenNumber) >= 0 &&
      (!req.master_request_id || body.indexOf(req.request_number) < 0));

    var stageNow = (await db.get('SELECT stage FROM requests WHERE id = ?', [req.id])).stage;
    var expectLabel = stages.LABELS[stages.next(stageNow)];
    ok('the request is at "' + stageNow + '"; the UI should offer "Advance to ' + expectLabel + '"', !!expectLabel);
    ok('the Advance button offers the CANONICAL next stage ("' + expectLabel + '")', body.indexOf('Advance to ' + expectLabel) >= 0);
    ok('the UI does NOT offer the legacy destination (Record Search from intake)',
      !(stageNow === 'intake' && body.indexOf('Advance to Record Search') >= 0));
    ok('the page renders no ghost stage', body.indexOf('Custodian Retrieval') < 0);
    ok('no runtime errors on the workspace page' + (errs.length ? ': ' + errs.join('; ') : ''), errs.length === 0);
    await page.screenshot({ path: '/home/optimumq/.claude/jobs/605a0134/tmp/stages_workspace.png' });

    // and the advance actually WORKS end-to-end through the real endpoint
    var adv = await api('PATCH', '/requests/' + req.id + '/stage', { stage: stages.next(stageNow), notes: 'stage vocabulary harness' });
    ok('advancing to the canonical next stage succeeds through the real endpoint', adv.status === 200);
    var after = await db.get('SELECT stage FROM requests WHERE id = ?', [req.id]);
    ok('the request moved to ' + stages.next(stageNow) + ' (backend agreed)', after.stage === stages.next(stageNow));
    var h = await db.get("SELECT stage_from, stage_to FROM request_history WHERE request_id = ? AND stage_to = ? ORDER BY created_at DESC LIMIT 1", [req.id, after.stage]);
    ok('history recorded ' + h.stage_from + ' → ' + h.stage_to, h.stage_from === stageNow && h.stage_to === after.stage);

    console.log('\n  shot: stages_workspace.png');
  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  finally {
    if (browser) await browser.close();
    try {
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t = 0; t < tabs.length; t++) for (var c = 0; c < created.length; c++) {
        try { await db.run('DELETE FROM ' + tabs[t].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c2 = 0; c2 < created.length; c2++) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c2]]); } catch (e) {} }
      var left = await db.get('SELECT COUNT(*) AS n FROM requests WHERE description LIKE ?', ['%' + TAG + '%']);
      ok('cleanup: 0 test requests remain', Number(left.n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
