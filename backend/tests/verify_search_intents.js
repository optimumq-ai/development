'use strict';
// R9 — search-completeness intent + the refine loop.  DESIGN_split_canvas_intake.md §R9 + §4b.
//
// What this harness is really guarding:
//
//   1. SELECTION WINS, ACROSS THE WHOLE REQUEST. A record the requestor passed over while refining
//      description 1 and then SELECTED under description 3 must be SELECTED ONLY. If it also lands in
//      the not-selected pile, the searcher reads "the requestor declined this" about a record the
//      requestor actually asked for. That is the precise failure the not-selected table exists to
//      prevent, so it must not be able to CAUSE it.
//
//   2. THE NOT-SELECTED SET IS INVISIBLE TO THE REQUESTOR. It must not be reachable from any public
//      route. It is recorded for the searcher, and only the searcher.
//
//   3. no_match_search IS NOT ABANDONMENT, and not_searchable IS NOT no_match_search. The searcher has
//      to be able to tell "the portal searched and found nothing you wanted" from "the portal never
//      searched at all" -- they lead to different work.
//
//   4. THE PRE-R9 FLAT PATH STILL WORKS. The manual form still posts selectedRecords[]. Dropping it
//      would silently lose selections on a LIVE path.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var SI = require('/opt/optimumq/backend/src/services/searchIntents');

var PORT = Number(process.env.API_PORT) || 3101;
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, path, body, token) {
  return new Promise(function (res, rej) {
    var b = body ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json' };
    if (b) h['Content-Length'] = Buffer.byteLength(b);
    if (token) h['Authorization'] = 'Bearer ' + token;
    var r = http.request({ host: 'localhost', port: PORT, path: path, method: method, headers: h }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () {
        var j = null; try { j = JSON.parse(d); } catch (e) {}
        res({ status: resp.statusCode, body: j, raw: d });
      });
    });
    r.on('error', rej); if (b) r.write(b); r.end();
  });
}
function rec(id, title) { return { id: id, title: title || ('Record ' + id), sourceSystem: 'Tyler Munis', publicAvailability: '' }; }

(async function () {
  await db.initDb();
  var u = await db.get('SELECT * FROM users LIMIT 1');
  TOKEN = await auth.signAccessToken(u);   // NOTE: signAccessToken is ASYNC. Forgetting await mints "[object Promise]".

  // =========================================================================================
  // A. THE REFINE LOOP — one description, three searches, selections accumulating
  // =========================================================================================
  var r1 = await req('POST', '/api/public/submit', {
    requestorName: 'R9 Test', requestorEmail: 'r9@example.com',
    description: 'Body camera footage from the traffic stop on West Lamar',
    searchIntents: [{
      seq: 0,
      description: 'Body camera footage from the traffic stop on West Lamar',
      intent: 'search_more',
      queriesTried: ['lamar traffic stop', 'body cam west lamar', 'BWC 2025-12-03'],
      // Took 2 across three searches...
      selected: [rec('BWC-1'), rec('BWC-2')],
      // ...and was shown 4 others they passed over. NOTE 'BWC-2' appears here too: the requestor
      // saw it in search 1, skipped it, and selected it in search 3. SELECTION MUST WIN.
      notSelected: [
        Object.assign(rec('CAR-9'), { shownInQuery: 'lamar traffic stop' }),
        Object.assign(rec('BWC-2'), { shownInQuery: 'lamar traffic stop' }),
        Object.assign(rec('DOC-4'), { shownInQuery: 'body cam west lamar' }),
        Object.assign(rec('CAR-9'), { shownInQuery: 'BWC 2025-12-03' })  // shown twice -> still ONE row
      ]
    }]
  });
  ok('A1 submit with searchIntents returns 200/201', r1.status === 200 || r1.status === 201);
  var id1 = r1.body && (r1.body.id || r1.body.requestId);
  ok('A2 request id returned', !!id1);

  var g = await req('GET', '/api/requests/' + id1 + '/search-intents', null, TOKEN);
  ok('A3 search-intents readable by staff', g.status === 200);
  var grp = g.body.groups[0];
  ok('A4 one intent row for one description', g.body.groups.length === 1);
  ok('A5 intent recorded as search_more', grp.intent === 'search_more');
  ok('A6 all 3 queries_tried persisted, in order',
     grp.queriesTried.length === 3 && grp.queriesTried[0] === 'lamar traffic stop' && grp.queriesTried[2] === 'BWC 2025-12-03');

  // ---- THE LOAD-BEARING ASSERTION -------------------------------------------------------
  var selIds = grp.selected.map(function (s) { return s.record_id; }).sort();
  var notIds = grp.notSelected.map(function (n) { return n.record_id; }).sort();
  ok('A7 both selections kept (accumulated across searches)', selIds.join(',') === 'BWC-1,BWC-2');
  ok('A8 SELECTION WINS — BWC-2 is NOT in the not-selected pile', notIds.indexOf('BWC-2') === -1);
  ok('A9 not-selected deduped — CAR-9 shown by 2 queries is ONE row',
     notIds.filter(function (x) { return x === 'CAR-9'; }).length === 1);
  ok('A10 the genuinely-passed-over records survive', notIds.join(',') === 'CAR-9,DOC-4');
  ok('A11 bar counts: shown = selected + notSelected', g.body.totals.shown === 4 && g.body.totals.selected === 2 && g.body.totals.notSelected === 2);

  // =========================================================================================
  // B. THE NOT-SELECTED SET IS INVISIBLE TO THE REQUESTOR
  // =========================================================================================
  var anon = await req('GET', '/api/requests/' + id1 + '/search-intents', null, null);
  ok('B1 search-intents REFUSES an unauthenticated caller', anon.status === 401 || anon.status === 403);
  var pub = await req('GET', '/api/public/request/' + id1, null, null);
  var leaked = pub.raw && (pub.raw.indexOf('CAR-9') >= 0 || pub.raw.indexOf('DOC-4') >= 0);
  ok('B2 no public route leaks a passed-over record back to the requestor', !leaked);

  // =========================================================================================
  // C. THE FOUR INTENTS ARE DISTINGUISHABLE — they lead to different work
  // =========================================================================================
  var r2 = await req('POST', '/api/public/submit', {
    requestorName: 'R9 Test', requestorEmail: 'r9@example.com',
    description: 'Multi',
    searchIntents: [
      { seq: 0, description: 'The incident report', intent: 'complete',
        queriesTried: ['incident report'], selected: [rec('IR-1')], notSelected: [] },
      { seq: 1, description: 'Any dashcam from that night', intent: 'no_match_search',
        queriesTried: ['dashcam'], selected: [], notSelected: [Object.assign(rec('X-1'), { shownInQuery: 'dashcam' })] },
      { seq: 2, description: 'All emails between the chief and the mayor', intent: 'not_searchable',
        queriesTried: [], selected: [], notSelected: [] }
    ]
  });
  var id2 = r2.body && (r2.body.id || r2.body.requestId);
  var g2 = await req('GET', '/api/requests/' + id2 + '/search-intents', null, TOKEN);
  var by = {}; g2.body.groups.forEach(function (x) { by[x.intent] = x; });
  ok('C1 three descriptions -> three intent rows', g2.body.groups.length === 3);
  ok('C2 seq order preserved', g2.body.groups[0].seq === 0 && g2.body.groups[2].seq === 2);
  ok('C3 complete captured', !!by.complete && by.complete.selected.length === 1);
  ok('C4 no_match_search: the portal SEARCHED (queries recorded) and found nothing they wanted',
     !!by.no_match_search && by.no_match_search.queriesTried.length === 1 && by.no_match_search.selected.length === 0);
  ok('C5 not_searchable: the portal NEVER searched (zero queries) — distinct from no_match_search',
     !!by.not_searchable && by.not_searchable.queriesTried.length === 0);
  ok('C6 an empty selection is NOT abandonment — it carries an explicit search instruction',
     by.no_match_search.intent === 'no_match_search');

  // =========================================================================================
  // D. THE PRE-R9 FLAT PATH STILL WORKS (the manual form still posts this)
  // =========================================================================================
  var r3 = await req('POST', '/api/public/submit', {
    requestorName: 'R9 Test', requestorEmail: 'r9@example.com', description: 'Legacy flat',
    submissionChannel: 'manual_form',
    selectedRecords: [{ id: 'OLD-1', title: 'Old', sourceSystem: 'Tyler Munis' }]
  });
  var id3 = r3.body && (r3.body.id || r3.body.requestId);
  ok('D1 legacy flat submit still 200/201', r3.status === 200 || r3.status === 201);
  var rows = await db.all('SELECT * FROM request_selected_records WHERE request_id = ?', [id3]);
  ok('D2 legacy selection still persisted (not silently dropped)', rows.length === 1 && rows[0].record_id === 'OLD-1');
  ok('D3 legacy row has NULL intent_id — a selection with no recorded meaning', !rows[0].intent_id);
  var g3 = await req('GET', '/api/requests/' + id3 + '/search-intents', null, TOKEN);
  ok('D4 legacy selection surfaces as ungrouped rather than vanishing',
     g3.body.groups.length === 0 && g3.body.ungroupedSelected.length === 1);

  // =========================================================================================
  // E. HOSTILE INPUT — /api/public/submit is UNAUTHENTICATED. Everything off it is untrusted.
  // =========================================================================================
  var bad = SI.normalize([
    { seq: 0, description: 'ok', intent: 'DROP TABLE requests', queriesTried: 'not-an-array', selected: null, notSelected: [{}] },
    { seq: 1, description: '   ', intent: 'complete' },      // blank description -> no row
    null, 'nonsense', 42
  ]);
  ok('E1 a garbage intent value falls back to no_match_search (never stored raw)', bad[0].intent === 'no_match_search');
  ok('E2 a non-array queriesTried becomes []', Array.isArray(bad[0].queriesTried) && bad[0].queriesTried.length === 0);
  ok('E3 a record with no id is dropped', bad[0].notSelected.length === 0);
  ok('E4 a blank description yields NO row (a description IS the row)', bad.length === 1);

  var r4 = await req('POST', '/api/public/submit', {
    requestorName: 'R9 Test', requestorEmail: 'r9@example.com', description: 'Hostile',
    searchIntents: [{ seq: 0, description: 'x', intent: 'not_a_real_intent', queriesTried: [], selected: [], notSelected: [] }]
  });
  var id4 = r4.body && (r4.body.id || r4.body.requestId);
  var g4 = await req('GET', '/api/requests/' + id4 + '/search-intents', null, TOKEN);
  ok('E5 a forged intent never reaches the DB — it is coerced, and the submit still succeeds',
     r4.status < 300 && g4.body.groups[0].intent === 'no_match_search');
  ok('E6 the coerced value is one of the four legal intents', SI.INTENTS.indexOf(g4.body.groups[0].intent) >= 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
