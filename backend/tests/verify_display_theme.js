'use strict';
// DISPLAY COLOURS — docs/SPEC_display_theme.md (Kevin, 2026-09-13).
//
// The account menu offers three colour schemes (standard, high-contrast light, high-contrast dark). The choice
// follows the PERSON: PUT /auth/me/display saves it on the account, /auth/me returns it as ui_theme, and the
// browser applies it on sign-in. What this harness pins down: the wire values, the 400 on anything else, that
// the default is 'standard' (NULL column reads as standard, so an old account is unchanged), that one user's
// choice never leaks to another, and that the endpoint needs a signed-in user.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var PORT = Number(process.env.API_PORT) || 3101;
async function token(id) { var u = await db.get('SELECT * FROM users WHERE id = ?', [id]); return u ? await auth.signAccessToken(u) : null; }
async function api(method, path, tok, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: Object.assign(tok ? { Authorization: 'Bearer ' + tok } : {}, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
}

(async function () {
  await db.initDb();
  var U = 'u-finance-super', V = 'u-police-staff';
  ok('S0 both test users exist', !!(await db.get('SELECT id FROM users WHERE id = ?', [U])) && !!(await db.get('SELECT id FROM users WHERE id = ?', [V])));
  var tu = await token(U), tv = await token(V);

  console.log('\n=== A. DEFAULT ===');
  await db.run('UPDATE users SET ui_theme = NULL WHERE id IN (?, ?)', [U, V]);
  var me = await api('GET', '/auth/me', tu);
  ok('A1 /auth/me carries ui_theme', me.status === 200 && me.body && me.body.user && 'ui_theme' in me.body.user);
  ok('A2 an account that never chose reads as standard', me.body.user.ui_theme === 'standard');

  console.log('\n=== B. CHOOSING ===');
  var r = await api('PUT', '/auth/me/display', tu, { theme: 'hc-dark' });
  ok('B1 PUT /auth/me/display accepts hc-dark and returns the user', r.status === 200 && r.body && r.body.user && r.body.user.ui_theme === 'hc-dark');
  me = await api('GET', '/auth/me', tu);
  ok('B2 /auth/me now returns hc-dark', me.body.user.ui_theme === 'hc-dark');
  var row = await db.get('SELECT ui_theme FROM users WHERE id = ?', [U]);
  ok('B3 stored on the account (users.ui_theme)', row && row.ui_theme === 'hc-dark');
  r = await api('PUT', '/auth/me/display', tu, { theme: 'hc-light' });
  ok('B4 switching to hc-light', r.status === 200 && r.body.user.ui_theme === 'hc-light');
  r = await api('PUT', '/auth/me/display', tu, { theme: 'standard' });
  ok('B5 back to standard', r.status === 200 && r.body.user.ui_theme === 'standard');

  console.log('\n=== C. REJECTIONS ===');
  for (var bad of ['dark', 'HC-LIGHT', '', null, 42, 'standard; drop table users']) {
    r = await api('PUT', '/auth/me/display', tu, { theme: bad });
    ok('C1 400 for ' + JSON.stringify(bad), r.status === 400 && r.body && /theme must be one of/.test(r.body.error || ''));
  }
  r = await api('PUT', '/auth/me/display', tu, {});
  ok('C2 400 when theme is missing', r.status === 400);
  r = await api('PUT', '/auth/me/display', null, { theme: 'hc-dark' });
  ok('C3 401 without a signed-in user', r.status === 401);
  row = await db.get('SELECT ui_theme FROM users WHERE id = ?', [U]);
  ok('C4 rejected writes changed nothing', row.ui_theme === 'standard');

  console.log('\n=== D. PER PERSON ===');
  await api('PUT', '/auth/me/display', tu, { theme: 'hc-dark' });
  var mv = await api('GET', '/auth/me', tv);
  ok('D1 another user still reads standard', mv.body.user.ui_theme === 'standard');
  await api('PUT', '/auth/me/display', tv, { theme: 'hc-light' });
  var mu = await api('GET', '/auth/me', tu); mv = await api('GET', '/auth/me', tv);
  ok('D2 each account keeps its own choice', mu.body.user.ui_theme === 'hc-dark' && mv.body.user.ui_theme === 'hc-light');
  var login = await db.get('SELECT ui_theme FROM users WHERE id = ?', [V]);
  ok('D3 the login payload path (sanitizeUser) exposes it', auth.sanitizeUser(Object.assign({ id: V }, login)).ui_theme === 'hc-light');
  await db.run('UPDATE users SET ui_theme = NULL WHERE id IN (?, ?)', [U, V]);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
