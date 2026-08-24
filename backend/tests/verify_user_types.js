'use strict';
// THE USER-TYPE MODEL (v3) — SPEC_user_type_model.md §11, S1 parts 1–3 and 6.
//
//   1. The catalog is seeded and matches the spec's tables (§3–§6) EXACTLY — table-driven from the same
//      constants the spec was written from, so a drift in either direction goes red.
//   2. The cutover (§9): legacy assignment tables empty, the seeded admin holds oro_sysadmin + oro_director,
//      and running it twice changes nothing.
//   3. Derived claims (§9.1): every legacy `roles`/`perms` claim comes from user types; NOTHING comes from the
//      legacy tables (a row planted there must not surface); the diff report for every fixture user.
//   6. Token freshness (§7): a user-type change kills the outstanding token within the cache window; a
//      token with no `av` claim is refused.
//
// BREAKS THIS SHOULD CATCH: give oro_sysadmin legal_decision (A red) · read perms from user_permission_roles
// again (C3 red) · drop the av check from requireAuth (F red) · seed a 12th type (A1 red).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ut = require('/opt/optimumq/backend/src/services/userTypes');
var cut = require('/opt/optimumq/backend/src/db/user_types_cutover');
var jwt = require('/opt/optimumq/backend/node_modules/jsonwebtoken');

var pass = 0, fail = 0;
function ok(l, c, extra) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !extra ? '' : '  -> ' + extra)); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'ut' + Date.now().toString().slice(-6);
function sameSet(a, b) { a = a.slice().sort(); b = b.slice().sort(); return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function api(method, path, tok) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
  return r.status;
}

(async function () {
  await db.initDb();

  console.log('\n=== A. THE CATALOG matches the spec (§3–§6) ===');
  var types = await db.all('SELECT * FROM user_types ORDER BY sort_order');
  ok('A1 exactly 11 user types seeded', types.length === 11, types.length);
  ok('A2 keys and order match §3', sameSet(types.map(function (t) { return t.key; }), ut.TYPE_KEYS) &&
    types.every(function (t, i) { return t.key === ut.CATALOG[i].key; }));
  ok('A3 scopes match §3 (8 office, 3 team)', types.every(function (t) { return t.scope === ut.scopeOf(t.key); }) &&
    types.filter(function (t) { return t.scope === 'office'; }).length === 8);
  var drift = [];
  for (var i = 0; i < ut.TYPE_KEYS.length; i++) {
    var k = ut.TYPE_KEYS[i], id = 'ut-' + k;
    var a = (await db.all('SELECT authority_key FROM user_type_authority WHERE user_type_id = ?', [id])).map(function (r) { return r.authority_key; });
    var p = (await db.all('SELECT permission_group FROM user_type_permission WHERE user_type_id = ?', [id])).map(function (r) { return r.permission_group; });
    var m = (await db.all('SELECT task_type FROM user_type_task_menu WHERE user_type_id = ?', [id])).map(function (r) { return r.task_type; });
    var l = (await db.all('SELECT perm FROM legacy_perm_map WHERE user_type_key = ?', [k])).map(function (r) { return r.perm; });
    if (!sameSet(a, ut.AUTHORITY[k])) drift.push(k + ':authority');
    if (!sameSet(p, ut.PERMISSION[k])) drift.push(k + ':permission');
    if (!sameSet(m, ut.TASK_MENU[k])) drift.push(k + ':menu');
    if (!sameSet(l, ut.LEGACY[k].perms)) drift.push(k + ':legacy_perm_map');
  }
  ok('A4 authority / permission / task-menu / legacy-perm tables match the spec for every type', drift.length === 0, drift.join(', '));
  var sa = ut.AUTHORITY.oro_sysadmin, dir = ut.AUTHORITY.oro_director;
  ok('A5 oro_sysadmin holds NO legal_decision and NO legal_rules (§4 rule: technical-only)', sa.indexOf('legal_decision') === -1 && ut.PERMISSION.oro_sysadmin.indexOf('legal_rules') === -1);
  ok('A6 go_live = oro_sysadmin OR oro_director; oro_supervisor lacks it', sa.indexOf('go_live') !== -1 && dir.indexOf('go_live') !== -1 && ut.AUTHORITY.oro_supervisor.indexOf('go_live') === -1);
  ok('A7 oro_director lacks system and legal_decision (§4)', dir.indexOf('system') === -1 && dir.indexOf('legal_decision') === -1);
  var opsHolders = ut.TYPE_KEYS.filter(function (k) { return ut.PERMISSION[k].indexOf('operations_config') !== -1; });
  ok('A8 operations_config = every office type except city_management + team_manager + team_supervisor (§5)',
    sameSet(opsHolders, ['oro_sysadmin', 'oro_director', 'oro_supervisor', 'oro_senior_legal', 'oro_legal_associate', 'oro_associate', 'oro_finance', 'team_manager', 'team_supervisor']));
  ok('A9 legal_rules holders = oro_senior_legal (owner) + oro_director', sameSet(ut.TYPE_KEYS.filter(function (k) { return ut.PERMISSION[k].indexOf('legal_rules') !== -1; }), ['oro_senior_legal', 'oro_director']) && ut.LEGAL_RULES_OWNER === 'oro_senior_legal');
  ok('A10 every authority key in the tables is in the closed §4 set', (await db.all('SELECT DISTINCT authority_key k FROM user_type_authority')).every(function (r) { return ut.AUTHORITY_KEYS.indexOf(r.k) !== -1; }));
  ok('A11 every permission group in the tables is in the closed §5 set', (await db.all('SELECT DISTINCT permission_group g FROM user_type_permission')).every(function (r) { return ut.PERMISSION_GROUPS.indexOf(r.g) !== -1; }));

  console.log('\n=== B. THE CUTOVER (§9): wipe + bootstrap, idempotent ===');
  // Plant legacy rows so the wipe has something to remove even on an already-cut-over fixture.
  var uid = 'u-' + TAG + '-legacy';
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [uid, TAG + '-legacy@test.optimumq.ai', 'UT Legacy', 'Test ' + TAG]);
  await db.run("INSERT INTO user_function_roles (user_id, function_role_id) VALUES (?, 'fr-director')", [uid]);
  await db.run("INSERT INTO user_permission_roles (user_id, permission_role_id) VALUES (?, 'pr-finance')", [uid]);
  var dry = await cut.cutover({ apply: false });
  ok('B1 dry run reports the rows it would remove and writes nothing', dry.dryRun && dry.legacyRowsRemoved >= 2 &&
    Number((await db.get('SELECT COUNT(*) c FROM user_function_roles')).c) >= 1);
  var admin = await db.get('SELECT id, auth_version FROM users WHERE email = ?', [cut.BOOTSTRAP_EMAIL]);
  ok('B2 the bootstrap login exists in the fixture', !!admin);
  var r1 = await cut.cutover({ apply: true });
  var fr = Number((await db.get('SELECT COUNT(*) c FROM user_function_roles')).c);
  var pr = Number((await db.get('SELECT COUNT(*) c FROM user_permission_roles')).c);
  ok('B3 legacy assignment tables are EMPTY after the cutover', fr === 0 && pr === 0, fr + '/' + pr);
  var adminTypes = (await ut.typesOf(admin.id)).map(function (t) { return t.key; });
  ok('B4 seeded admin holds oro_sysadmin + oro_director', adminTypes.indexOf('oro_sysadmin') !== -1 && adminTypes.indexOf('oro_director') !== -1, adminTypes.join(','));
  ok('B5 users are kept (the planted user survives with no types)', !!(await db.get('SELECT 1 FROM users WHERE id = ?', [uid])) && (await ut.typesOf(uid)).length === 0);
  var admin2 = await db.get('SELECT auth_version FROM users WHERE id = ?', [admin.id]);
  ok('B6 every user\'s auth_version bumped (legacy-minted tokens die)', r1.authVersionBumped > 0 && Number(admin2.auth_version) > Number(admin.auth_version || 1));
  var r2 = await cut.cutover({ apply: true });
  var adminTypes2 = await ut.typesOf(admin.id);
  ok('B7 idempotent: second run grants nothing new, admin still holds exactly the same types', r2.granted.length === 0 && adminTypes2.length === adminTypes.length);

  console.log('\n=== C. DERIVED CLAIMS (§9.1): legacy roles/perms come from user types, never from the legacy tables ===');
  var expectRows = [];
  for (var j = 0; j < ut.TYPE_KEYS.length; j++) {
    var key = ut.TYPE_KEYS[j];
    var u = 'u-' + TAG + '-' + key;
    await db.run("INSERT INTO users (id, email, display_name, title, department_id, status) VALUES (?,?,?,?,?, 'active')", [u, TAG + '-' + key + '@test.optimumq.ai', 'UT ' + key, 'Test ' + TAG, 'team-police']);
    await ut.grant(u, key, 'team-police', 'harness');
    var c = await ut.claimsFor(u);
    var want = ut.LEGACY[key];
    if (!sameSet(c.roles, want.roles) || !sameSet(c.perms, want.perms)) expectRows.push(key + ' roles=' + c.roles + ' perms=' + c.perms);
    if (!sameSet(c.authorities, ut.AUTHORITY[key]) || !sameSet(c.permissionGroups, ut.PERMISSION[key])) expectRows.push(key + ':axes');
    if (c.inOro !== (ut.scopeOf(key) === 'office')) expectRows.push(key + ':inOro');
  }
  ok('C1 for each of the 11 types, a holder\'s roles/perms/authorities/groups/inOro match §4–§5 and §9.1', expectRows.length === 0, expectRows.join(' | '));
  var sysTok = jwt.decode(await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', ['u-' + TAG + '-oro_sysadmin'])));
  ok('C2 oro_sysadmin token: SYSTEM_ADMIN role, every perm EXCEPT FINANCE, av present', sysTok.roles.indexOf('SYSTEM_ADMIN') !== -1 && sysTok.perms.indexOf('FINANCE') === -1 && sysTok.perms.length === ut.ALL_PERMS.length - 1 && sysTok.av != null);
  // The anti-regression: a legacy row planted for a TYPELESS user must not surface anywhere.
  await db.run("INSERT INTO user_permission_roles (user_id, permission_role_id) VALUES (?, 'pr-finance')", [uid]);
  await db.run("INSERT INTO user_function_roles (user_id, function_role_id) VALUES (?, 'fr-director')", [uid]);
  var planted = await ut.claimsFor(uid);
  var plantedTok = jwt.decode(await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [uid])));
  ok('C3 a legacy assignment row is IGNORED (typeless user mints no roles, no perms)', planted.roles.length === 0 && planted.perms.length === 0 && plantedTok.roles.length === 0 && plantedTok.perms.length === 0);
  var finHolders = (await ut.usersWithLegacyPerm('FINANCE')).map(function (x) { return x.id; });
  ok('C4 legacy-holder lookup derives from types (oro_finance + oro_director in, planted row out)', finHolders.indexOf('u-' + TAG + '-oro_finance') !== -1 && finHolders.indexOf('u-' + TAG + '-oro_director') !== -1 && finHolders.indexOf(uid) === -1);
  var pool = await db.all('SELECT m.perm FROM user_user_types uut JOIN user_types t ON t.id = uut.user_type_id JOIN legacy_perm_map m ON m.user_type_key = t.key WHERE uut.user_id = ?', ['u-' + TAG + '-team_staff']);
  ok('C5 the task-pool SQL predicate resolves team_staff to SEARCH_AND_TRIAGE/REDACTION_WORKER/FEE_MANAGER', sameSet(pool.map(function (r) { return r.perm; }), ['SEARCH_AND_TRIAGE', 'REDACTION_WORKER', 'FEE_MANAGER']));
  await db.run('DELETE FROM user_permission_roles WHERE user_id = ?', [uid]);
  await db.run('DELETE FROM user_function_roles WHERE user_id = ?', [uid]);
  var menu = await ut.taskMenuFor('u-' + TAG + '-team_staff');
  var menuDir = await ut.taskMenuFor('u-' + TAG + '-oro_director');
  ok('C6 task-menu union: team_staff = the four team types; oro_director = any (null)', sameSet(menu, ['estimate', 'record_search', 'redaction', 'redaction_qa']) && menuDir === null);
  var bad = null; try { await ut.grant(uid, 'team_staff', null); } catch (e) { bad = e.message; }
  ok('C7 a team-scoped type refuses a grant without a team', /teamId required/.test(bad || ''));

  console.log('\n=== D. DIFF REPORT — fixture users, legacy claims before vs derived after (informational) ===');
  var fixtureUsers = await db.all("SELECT id, display_name FROM users WHERE status = 'active' AND title NOT LIKE 'Test %' ORDER BY id");
  var lost = 0;
  for (var f = 0; f < fixtureUsers.length; f++) {
    var fu = fixtureUsers[f];
    var c2 = await ut.claimsFor(fu.id);
    var tl = (await ut.typesOf(fu.id)).map(function (t) { return t.key + (t.teamId ? '@' + t.teamId : ''); });
    if (!tl.length) lost++;
    console.log('        ' + fu.id.padEnd(18) + ' types=[' + tl.join(',') + '] roles=[' + c2.roles.join(',') + '] perms=' + c2.perms.length);
  }
  ok('D1 diff report printed (' + fixtureUsers.length + ' users, ' + lost + ' with no type — expected: real accounts are re-typed by hand per §9)', true);
  ok('D2 no fixture user mints any claim from a legacy table (tables are empty)', Number((await db.get('SELECT COUNT(*) c FROM user_function_roles')).c) === 0 && Number((await db.get('SELECT COUNT(*) c FROM user_permission_roles')).c) === 0);

  console.log('\n=== E. THE API MINTS THE SAME CLAIMS (staff + /auth/me shapes) ===');
  var kTok = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [admin.id]));
  var me = await (await fetch('http://localhost:' + PORT + '/api/auth/me', { headers: { Authorization: 'Bearer ' + kTok } })).json();
  ok('E1 /auth/me carries userTypes, authorities, permissionGroups, inOro and the legacy functionRoles', me.user && Array.isArray(me.user.userTypes) && me.user.userTypes.length >= 2 && me.user.authorities.indexOf('go_live') !== -1 && me.user.permissionGroups.indexOf('system_admin') !== -1 && me.user.inOro === true && me.user.functionRoles.indexOf('SYSTEM_ADMIN') !== -1);
  var one = await (await fetch('http://localhost:' + PORT + '/api/staff/' + admin.id, { headers: { Authorization: 'Bearer ' + kTok } })).json();
  ok('E2 GET /staff/:id lists the user types and no secrets', one.user && one.user.userTypes.length >= 2 && one.user.password_hash === undefined && one.user.mfa_secret === undefined);
  // Account creation grants NO types and NO legacy perms (the grant-all bug, §2 row 4).
  var created = await (await fetch('http://localhost:' + PORT + '/api/staff', { method: 'POST', headers: { Authorization: 'Bearer ' + kTok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'UT New ' + TAG, email: TAG + '-new@test.optimumq.ai', tempPassword: 'Temp!' + TAG, functionRoles: ['SYSTEM_ADMIN'] }) })).json();
  var newC = created.userId ? await ut.claimsFor(created.userId) : null;
  ok('E3 POST /staff creates an account with NO user types, NO roles, NO perms (grant-all bug is dead)', !!newC && newC.userTypes.length === 0 && newC.roles.length === 0 && newC.perms.length === 0);

  console.log('\n=== F. TOKEN FRESHNESS (§7) ===');
  var fu2 = 'u-' + TAG + '-oro_supervisor';
  var tok = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [fu2]));
  ok('F1 a fresh token is accepted', await api('GET', '/auth/me', tok) === 200);
  await ut.grant(fu2, 'oro_finance', null, 'harness');       // any user-type change bumps auth_version
  await sleep(1300);                                           // test API caches auth_version for 1s
  ok('F2 after a user-type change the OLD token is rejected within the cache window', await api('GET', '/auth/me', tok) === 401);
  var tok2 = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [fu2]));
  ok('F3 a re-minted token is accepted again', await api('GET', '/auth/me', tok2) === 200);
  var noAv = jwt.sign({ sub: fu2, email: 'x', roles: ['SYSTEM_ADMIN'], perms: [] }, process.env.JWT_SECRET || 'optimumq-dev-secret', { expiresIn: '1h' });
  ok('F4 a legacy-shaped token with no av claim is refused (even claiming SYSTEM_ADMIN)', await api('GET', '/auth/me', noAv) === 401);
  await sleep(1100);
  var before = await db.get('SELECT auth_version FROM users WHERE id = ?', [fu2]);
  await ut.revoke(fu2, 'oro_finance', null);
  var after = await db.get('SELECT auth_version FROM users WHERE id = ?', [fu2]);
  ok('F5 revoke bumps auth_version too', Number(after.auth_version) === Number(before.auth_version) + 1);

  console.log('\n=== G. CLEANUP ===');
  var ids = ut.TYPE_KEYS.map(function (k) { return 'u-' + TAG + '-' + k; }).concat([uid]);
  if (created.userId) ids.push(created.userId);
  for (var d = 0; d < ids.length; d++) { await ut.revokeAll(ids[d]); await db.run('DELETE FROM users WHERE id = ?', [ids[d]]); }
  var left = await db.get("SELECT count(*)::int AS n FROM users WHERE title = 'Test ' || ? OR email LIKE ?", [TAG, TAG + '-%']);
  ok('G1 harness users removed', left.n === 0);

  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERR', e); fail++; console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail'); process.exit(1); });
