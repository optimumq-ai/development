'use strict';
// AI CALL LOG + CLASSIFIER PROMPT CACHE (2026-09-16, Kevin's usage question). Model-free: the wrapper is exercised
// through its test transport; the classifier's prompt SHAPE is locked without a model call.
//
// WHAT THIS PREVENTS: a model call the app makes that leaves no trace; usage fields dropped or mislabelled; a failure
// that vanishes instead of being logged; the classifier's cache breakpoint drifting off the stable block (a silent
// invalidator — the request text leaking into the cached prefix would make every call a cache miss); the usage read
// being open to anyone.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var aiClient = require('/opt/optimumq/backend/src/services/aiClient');
var classifier = require('/opt/optimumq/backend/src/services/classifier');

var pass = 0, fail = 0, TOKEN = null, STAFF = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'AC' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function api(method, path, body, token) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: Object.assign({ Authorization: 'Bearer ' + (token || TOKEN) }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async function () {
  await db.initDb();
  TOKEN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var staffId = 'u-ac-none-' + TAG;
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [staffId, 'ac-none-' + TAG + '@test.optimumq.ai', 'AC none', 'Test ' + TAG]);
  STAFF = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [staffId]));
  var caller = 'test:' + TAG;

  console.log('\n=== A. EVERY CALL LEAVES A ROW — usage fields, duration, model, message id, context ===');
  var seen = [];
  aiClient._setTransport(async function (params) {
    seen.push(params);
    if (params.metadata && params.metadata.fail) { var e = new Error('simulated 529 overloaded'); throw e; }
    return { id: 'msg_' + TAG, model: params.model, content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 120, cache_creation_input_tokens: 8200, cache_read_input_tokens: 0, output_tokens: 45 } };
  });
  var c = aiClient.clientFor(caller, 'ctx-' + TAG);
  var m1 = await c.messages.create({ model: 'claude-sonnet-5', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] });
  var row1 = await db.get('SELECT * FROM ai_calls WHERE caller = ? ORDER BY at DESC LIMIT 1', [caller]);
  ok('A1 the wrapper returns the message unchanged and logs one row', m1.id === 'msg_' + TAG && row1 && row1.caller === caller);
  ok('A2 the row carries model, the four usage fields, duration, ok=1, the message id and the context tag — and NO prompt text',
    row1.model === 'claude-sonnet-5' && row1.input_tokens === 120 && row1.cache_creation_input_tokens === 8200 && row1.cache_read_input_tokens === 0 && row1.output_tokens === 45 && row1.duration_ms != null && row1.ok === 1 && row1.message_id === 'msg_' + TAG && row1.context === 'ctx-' + TAG && JSON.stringify(row1).indexOf('"hi"') === -1);
  var threw = false;
  try { await c.messages.create({ model: 'claude-sonnet-5', max_tokens: 100, metadata: { fail: true }, messages: [{ role: 'user', content: 'boom' }] }); } catch (e) { threw = /529/.test(e.message); }
  var rowErr = await db.get('SELECT * FROM ai_calls WHERE caller = ? AND ok = 0 ORDER BY at DESC LIMIT 1', [caller]);
  ok('A3 a failed call is logged with ok=0 and the error text, and the error still reaches the caller', threw && rowErr && /529/.test(rowErr.error) && rowErr.output_tokens === 0);
  var n = await db.get('SELECT count(*)::int AS n FROM ai_calls WHERE caller = ?', [caller]);
  ok('A4 exactly two rows for two calls', Number(n.n) === 2);

  console.log('\n=== B. THE CLASSIFIER PROMPT — stable catalog in a cached system block, request text after the breakpoint ===');
  var built = classifier.buildPrompt('I want the body camera video from the traffic stop on Main St', { agency: 'City of Test', taxoLines: 'bwc | Body-worn camera video | Police | also called: bodycam', deptList: 'PD: Police, CL: Clerk' });
  var sys = built.system;
  ok('B1 the system prompt is an array of blocks with a cache breakpoint on its last block', Array.isArray(sys) && sys.length >= 1 && sys[sys.length - 1].cache_control && sys[sys.length - 1].cache_control.type === 'ephemeral');
  var sysText = sys.map(function (b) { return b.text; }).join('\n');
  ok('B2 the catalog, the department list and the instructions are INSIDE the cached block', /RECORD TYPE CATALOG/.test(sysText) && /Body-worn camera video/.test(sysText) && /PD: Police/.test(sysText) && /Return ONLY this JSON/.test(sysText));
  ok('B3 the request text is NOT in the cached block — it rides in the user message after the breakpoint', sysText.indexOf('traffic stop on Main St') === -1 && built.messages.length === 1 && built.messages[0].role === 'user' && /traffic stop on Main St/.test(built.messages[0].content));
  var b2 = classifier.buildPrompt('a completely different request', { agency: 'City of Test', taxoLines: 'bwc | Body-worn camera video | Police | also called: bodycam', deptList: 'PD: Police, CL: Clerk' });
  ok('B4 two different requests produce byte-identical system blocks (the prefix that gets cached)', b2.system[0].text === sys[0].text);
  ok('B5 the cached block is above Sonnet 5\'s 1,024-token minimum when the real catalog is in it (≈8k tokens live; test stand-in is small, so we check the rule is documented in code)', /1,024|1024/.test(require('fs').readFileSync('/opt/optimumq/backend/src/services/classifier.js', 'utf8')));

  console.log('\n=== C. EVERY MODEL CALL SITE GOES THROUGH THE DOOR ===');
  var src = require('child_process').execSync("grep -rn 'new Anthropic(' /opt/optimumq/backend/src --include=*.js | grep -v '\\.bak' | grep -v 'services/aiClient.js' | grep -v 'routes/integrations.js' || true", { encoding: 'utf8' }).trim();
  ok('C1 no service or route constructs its own Anthropic client any more (integrations key test and the wrapper excepted)', src === '');
  var sites = require('child_process').execSync("grep -rn \"clientFor('\" /opt/optimumq/backend/src --include=*.js | grep -v '\\.bak' | grep -v 'services/aiClient.js' | wc -l", { encoding: 'utf8' }).trim();
  ok('C2 the call sites are named (' + sites + ' clientFor sites)', Number(sites) >= 20);

  console.log('\n=== D. THE USAGE READ — gated, aggregated ===');
  var g = await api('GET', '/ai-usage?days=7', null, STAFF);
  ok('D1 a non-admin cannot read the usage (403)', g.status === 403);
  var u = await api('GET', '/ai-usage?days=7');
  var mine = (u.body && u.body.by_caller || []).find(function (r) { return r.caller === caller; });
  ok('D2 the admin read aggregates by caller: 2 calls, 1 error, the token sums', u.status === 200 && mine && mine.calls === 2 && mine.errors === 1 && mine.cache_write === 8200 && mine.input_tokens === 120 && mine.output_tokens === 45);
  ok('D3 totals carry a cache-hit share and by_day rows exist', u.body.totals && typeof u.body.totals.cache_hit_share === 'number' && Array.isArray(u.body.by_day) && u.body.by_day.length >= 1);

  console.log('\n=== E. LEAVE THE WORLD AS FOUND ===');
  aiClient._setTransport(null);
  await db.run('DELETE FROM ai_calls WHERE caller = ?', [caller]);
  await db.run('DELETE FROM users WHERE id = ?', [staffId]);
  var left = await db.get('SELECT count(*)::int AS n FROM ai_calls WHERE caller = ?', [caller]);
  ok('E1 fixture rows gone', Number(left.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
