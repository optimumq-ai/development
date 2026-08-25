'use strict';
// THE USER-TYPE MODEL (v3) — SPEC_user_type_model.md §11, S1 parts 1–3 and 6.
//
//   1. The catalog is seeded and matches the spec's tables (§3–§6) EXACTLY — table-driven from the same
//      constants the spec was written from, so a drift in either direction goes red.
//   2. The v1 role catalogs are GONE (S5): no tables, no roles claim, no requireRole; the seeded admin holds
//      oro_sysadmin + oro_director.
//   3. Derived claims (§9.1 as built): act perms / authorities / groups / taskMenu come from user types and
//      nothing else; the diff report for every fixture user.
//   6. Token freshness (§7): a user-type change kills the outstanding token within the cache window; a
//      token with no `av` claim is refused.
//
// BREAKS THIS SHOULD CATCH: give oro_sysadmin legal_decision (A red) · recreate a legacy role table (B1 red) ·
// drop the av check from requireAuth (F red) · seed a 12th type (A1 red) · a requireRole call anywhere (N1 red).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ut = require('/opt/optimumq/backend/src/services/userTypes');
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
    if (!sameSet(l, ut.ACT_PERMS[k])) drift.push(k + ':legacy_perm_map');
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

  console.log('\n=== B. THE LEGACY CATALOGS ARE GONE (S5): no tables, no roles claim, no role gates ===');
  var legacyTables = (await db.all("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('function_roles','permission_roles','user_function_roles','user_permission_roles')")).map(function (r) { return r.tablename; });
  ok('B1 function_roles / permission_roles / user_function_roles / user_permission_roles do not exist', legacyTables.length === 0, legacyTables.join(','));
  var admin = await db.get('SELECT id, auth_version FROM users WHERE email = ?', ['kruss@optimumq.ai']);
  ok('B2 the seeded admin exists and holds oro_sysadmin + oro_director', !!admin && (function (t) { return t.indexOf('oro_sysadmin') !== -1 && t.indexOf('oro_director') !== -1; })((await ut.typesOf(admin.id)).map(function (t) { return t.key; })));
  var midS5 = require('fs').readFileSync('/opt/optimumq/backend/src/middleware/auth.js', 'utf8');
  ok('B3 requireRole / requireRoleOrPerm no longer exist in the middleware', !/function requireRole\b|function requireRoleOrPerm\b/.test(midS5));
  var uid = 'u-' + TAG + '-legacy';
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [uid, TAG + '-legacy@test.optimumq.ai', 'UT Typeless', 'Test ' + TAG]);

  console.log('\n=== C. DERIVED CLAIMS (§9.1): legacy roles/perms come from user types, never from the legacy tables ===');
  var expectRows = [];
  for (var j = 0; j < ut.TYPE_KEYS.length; j++) {
    var key = ut.TYPE_KEYS[j];
    var u = 'u-' + TAG + '-' + key;
    await db.run("INSERT INTO users (id, email, display_name, title, department_id, status) VALUES (?,?,?,?,?, 'active')", [u, TAG + '-' + key + '@test.optimumq.ai', 'UT ' + key, 'Test ' + TAG, 'team-police']);
    await ut.grant(u, key, 'team-police', 'harness');
    var c = await ut.claimsFor(u);
    if (!sameSet(c.perms, ut.ACT_PERMS[key])) expectRows.push(key + ' perms=' + c.perms);
    if (!sameSet(c.authorities, ut.AUTHORITY[key]) || !sameSet(c.permissionGroups, ut.PERMISSION[key])) expectRows.push(key + ':axes');
    if (c.roles !== undefined) expectRows.push(key + ':roles-claim-present');
    if (c.inOro !== (ut.scopeOf(key) === 'office')) expectRows.push(key + ':inOro');
  }
  ok('C1 for each of the 11 types, a holder\'s perms/authorities/groups/inOro match §4–§5 and §9.1, and there is no roles claim', expectRows.length === 0, expectRows.join(' | '));
  var sysTok = jwt.decode(await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', ['u-' + TAG + '-oro_sysadmin'])));
  ok('C2 oro_sysadmin token: no roles claim, every act perm EXCEPT FINANCE, av present', sysTok.roles === undefined && sysTok.perms.indexOf('FINANCE') === -1 && sysTok.perms.length === ut.ALL_PERMS.length - 1 && sysTok.av != null);
  var planted = await ut.claimsFor(uid);
  ok('C3 a typeless user mints no perms, no authorities, no groups', planted.perms.length === 0 && planted.authorities.length === 0 && planted.permissionGroups.length === 0);
  var finHolders = (await ut.usersWithActPerm('FINANCE')).map(function (x) { return x.id; });
  ok('C4 act-perm holder lookup derives from types (oro_finance + oro_director in, typeless out)', finHolders.indexOf('u-' + TAG + '-oro_finance') !== -1 && finHolders.indexOf('u-' + TAG + '-oro_director') !== -1 && finHolders.indexOf(uid) === -1);
  var pool = await db.all('SELECT m.perm FROM user_user_types uut JOIN user_types t ON t.id = uut.user_type_id JOIN legacy_perm_map m ON m.user_type_key = t.key WHERE uut.user_id = ?', ['u-' + TAG + '-team_staff']);
  ok('C5 the task-pool SQL predicate resolves team_staff to SEARCH_AND_TRIAGE/REDACTION_WORKER/FEE_MANAGER', sameSet(pool.map(function (r) { return r.perm; }), ['SEARCH_AND_TRIAGE', 'REDACTION_WORKER', 'FEE_MANAGER']));
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
    console.log('        ' + fu.id.padEnd(18) + ' types=[' + tl.join(',') + '] authorities=' + c2.authorities.length + ' perms=' + c2.perms.length);
  }
  ok('D1 diff report printed (' + fixtureUsers.length + ' users, ' + lost + ' with no type — expected: real accounts are re-typed by hand per §9)', true);
  ok('D2 every claim a fixture user carries is derived (no legacy tables exist to read)', legacyTables.length === 0);

  console.log('\n=== E. THE API MINTS THE SAME CLAIMS (staff + /auth/me shapes) ===');
  var kTok = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [admin.id]));
  var me = await (await fetch('http://localhost:' + PORT + '/api/auth/me', { headers: { Authorization: 'Bearer ' + kTok } })).json();
  ok('E1 /auth/me carries userTypes, authorities, permissionGroups, inOro, taskMenu — and no functionRoles', me.user && Array.isArray(me.user.userTypes) && me.user.userTypes.length >= 2 && me.user.authorities.indexOf('go_live') !== -1 && me.user.permissionGroups.indexOf('system_admin') !== -1 && me.user.inOro === true && me.user.functionRoles === undefined && me.user.taskMenu === '*');
  var one = await (await fetch('http://localhost:' + PORT + '/api/staff/' + admin.id, { headers: { Authorization: 'Bearer ' + kTok } })).json();
  ok('E2 GET /staff/:id lists the user types and no secrets', one.user && one.user.userTypes.length >= 2 && one.user.password_hash === undefined && one.user.mfa_secret === undefined);
  // Account creation grants NO types and NO legacy perms (the grant-all bug, §2 row 4).
  var created = await (await fetch('http://localhost:' + PORT + '/api/staff', { method: 'POST', headers: { Authorization: 'Bearer ' + kTok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'UT New ' + TAG, email: TAG + '-new@test.optimumq.ai', tempPassword: 'Temp!' + TAG, functionRoles: ['SYSTEM_ADMIN'] }) })).json();
  var newC = created.userId ? await ut.claimsFor(created.userId) : null;
  ok('E3 POST /staff creates an account with NO user types and NO perms (grant-all bug is dead)', !!newC && newC.userTypes.length === 0 && newC.perms.length === 0);

  console.log('\n=== F. TOKEN FRESHNESS (§7) ===');
  var fu2 = 'u-' + TAG + '-oro_supervisor';
  var tok = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [fu2]));
  ok('F1 a fresh token is accepted', await api('GET', '/auth/me', tok) === 200);
  await ut.grant(fu2, 'oro_finance', null, 'harness');       // any user-type change bumps auth_version
  await sleep(1300);                                           // test API caches auth_version for 1s
  ok('F2 after a user-type change the OLD token is rejected within the cache window', await api('GET', '/auth/me', tok) === 401);
  var tok2 = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [fu2]));
  ok('F3 a re-minted token is accepted again', await api('GET', '/auth/me', tok2) === 200);
  var noAv = jwt.sign({ sub: fu2, email: 'x', authorities: ['system'], perms: [] }, process.env.JWT_SECRET || 'optimumq-dev-secret', { expiresIn: '1h' });
  ok('F4 a token with no av claim is refused (even one claiming the system authority)', await api('GET', '/auth/me', noAv) === 401);
  await sleep(1100);
  var before = await db.get('SELECT auth_version FROM users WHERE id = ?', [fu2]);
  await ut.revoke(fu2, 'oro_finance', null);
  var after = await db.get('SELECT auth_version FROM users WHERE id = ?', [fu2]);
  ok('F5 revoke bumps auth_version too', Number(after.auth_version) === Number(before.auth_version) + 1);

  // ---------------------------------------------------------------------------------------------------
  // S2 — the gate primitives and the §8 rows 1–9 migrations (hub gaps, go-live, attest).
  // Every harness user below already exists from section C: 'u-<TAG>-<type>' holds exactly ONE type
  // (department team-police). Calls are shaped to be REFUSED by the gate or to fail validation AFTER the
  // gate, so a passing gate is provable without writing config (400/404 = through; 403 = gated).
  // ---------------------------------------------------------------------------------------------------
  async function callAs(key, method, path, body) {
    var uu = await db.get('SELECT * FROM users WHERE id = ?', ['u-' + TAG + '-' + key]);
    var t = await auth.signAccessToken(uu);
    var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    // A 401 right after this user's own auth_version was bumped is the API's 1s freshness cache (§7), not a
    // gate verdict: wait the window out and retry once with a re-minted token.
    if (r.status === 401) { await sleep(1100); t = await auth.signAccessToken(uu); r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
    var j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  }
  function gated(r) { return r.status === 403; }
  function through(r) { return r.status !== 403 && r.status !== 401; }

  console.log('\n=== H. THE GATE PRIMITIVES (§7) read the user-type claims, never legacy roles, no SysAdmin bypass ===');
  // fee_configuration (row 1): PUT /fee-profiles/<nonexistent> is 404 AFTER the gate (writes nothing).
  var feeAssoc = await callAs('oro_associate', 'PUT', '/fee-profiles/no-such-' + TAG, {});
  var feeMgmt = await callAs('city_management', 'PUT', '/fee-profiles/no-such-' + TAG, {});
  var feeStaff = await callAs('team_staff', 'PUT', '/fee-profiles/no-such-' + TAG, {});
  ok('H1 fee-profile write: operations holder (oro_associate) passes the gate; city_management and team_staff are 403', through(feeAssoc) && gated(feeMgmt) && gated(feeStaff), feeAssoc.status + '/' + feeMgmt.status + '/' + feeStaff.status);
  ok('H2 refusal is worded and coded (PERMISSION_REQUIRED, names the group)', feeMgmt.body && feeMgmt.body.code === 'PERMISSION_REQUIRED' && /fee_configuration/.test(feeMgmt.body.error));
  // operations_config (row 2): departments POST with no name -> 400 after the gate.
  var depSup = await callAs('team_supervisor', 'POST', '/departments', {});
  var depMgmt = await callAs('city_management', 'POST', '/departments', {});
  var depStaff = await callAs('team_staff', 'PATCH', '/departments/team-police', { name: 'x' });
  ok('H3 departments/teams write: team_supervisor passes (400 validation); city_management 403; team_staff PATCH 403', depSup.status === 400 && gated(depMgmt) && gated(depStaff));
  // system_admin (row 5): agent rules.
  var arSys = await callAs('oro_sysadmin', 'POST', '/agent-rules', {});
  var arDir = await callAs('oro_director', 'POST', '/agent-rules', {});
  ok('H4 agent rules write: oro_sysadmin passes (400 validation); oro_director 403 (Lane 4 is technical-only)', arSys.status === 400 && gated(arDir));
  // manage_users (rows 3): account creation / user-type assignment.
  var mkSup = await callAs('oro_supervisor', 'POST', '/staff', {});
  var mkDir = await callAs('oro_director', 'POST', '/staff', {});
  var utSup = await callAs('oro_supervisor', 'PATCH', '/staff/u-' + TAG + '-team_staff/user-types', { userTypes: [] });
  ok('H5 create account / assign user types: oro_director passes; oro_supervisor 403 (AUTHORITY_REQUIRED manage_users)', mkDir.status === 400 && gated(mkSup) && gated(utSup) && utSup.body.code === 'AUTHORITY_REQUIRED');
  // operations_config + subset scope (row 4): task-subset PATCH.
  var tsAssoc = await callAs('oro_associate', 'PATCH', '/staff/u-' + TAG + '-team_staff/task-types', { taskTypes: ['estimate'] });
  var tsMgr = await callAs('team_manager', 'PATCH', '/staff/u-' + TAG + '-team_staff/task-types', { taskTypes: ['estimate'] });
  var tsMgrOther = await callAs('team_manager', 'PATCH', '/staff/u-hr-staff/task-types', { taskTypes: ['estimate'] });
  var tsDir = await callAs('oro_director', 'PATCH', '/staff/u-' + TAG + '-team_staff/task-types', { taskTypes: [] });
  ok('H6 task subset: oro_associate has operations_config but no subset authority -> 403; team_manager passes for own team, 403 for another team; oro_director (global) passes',
    gated(tsAssoc) && tsAssoc.body.code === 'AUTHORITY_REQUIRED' && tsMgr.status === 200 && gated(tsMgrOther) && tsDir.status === 200);
  await db.run('DELETE FROM user_task_types WHERE user_id = ?', ['u-' + TAG + '-team_staff']);
  // PATCH /user-types itself (S2 write; S3 UI): director sets a type on the harness user, then clears it.
  var setT = await callAs('oro_director', 'PATCH', '/staff/u-' + TAG + '-team_staff/user-types', { userTypes: [{ key: 'team_staff', teamId: 'team-police' }, { key: 'team_supervisor', teamId: 'team-fire' }] });
  var badT = await callAs('oro_director', 'PATCH', '/staff/u-' + TAG + '-team_staff/user-types', { userTypes: [{ key: 'team_manager' }] });
  var nowT = (await ut.typesOf('u-' + TAG + '-team_staff')).map(function (t) { return t.key + '@' + t.teamId; });
  ok('H7 PATCH /staff/:id/user-types replaces the set (multi-team OK: staff@police + supervisor@fire); team type without teamId -> 400',
    setT.status === 200 && badT.status === 400 && sameSet(nowT, ['team_staff@team-police', 'team_supervisor@team-fire']));
  await callAs('oro_director', 'PATCH', '/staff/u-' + TAG + '-team_staff/user-types', { userTypes: [{ key: 'team_staff', teamId: 'team-police' }] });

  console.log('\n=== I. ATTEST / CONFIRM / PROPOSE by permission group (§8 rows 8–9) ===');
  // Legal section: legal_rules holders only. 'no-such' section fails validation AFTER the gate (400).
  var atLegalSL = await callAs('oro_senior_legal', 'POST', '/jurisdiction-profile/attest', { section: 'exemption' });
  var atLegalSA = await callAs('oro_sysadmin', 'POST', '/jurisdiction-profile/attest', { section: 'exemption' });
  var atLegalDir = await callAs('oro_director', 'POST', '/jurisdiction-profile/unattest', { section: 'exemption' });
  ok('I1 legal section attest: oro_senior_legal passes the gate; oro_sysadmin is REFUSED (no legal_rules); oro_director may',
    through(atLegalSL) && gated(atLegalSA) && /legal_rules/.test(atLegalSA.body.error) && through(atLegalDir), atLegalSL.status + '/' + atLegalSA.status + '/' + atLegalDir.status);
  // If senior legal's attest actually landed, undo it so the fixture is as found.
  if (atLegalSL.status === 200) await callAs('oro_senior_legal', 'POST', '/jurisdiction-profile/unattest', { section: 'exemption' });
  var atNonSL = await callAs('oro_senior_legal', 'POST', '/jurisdiction-profile/unattest', { section: 'fees' });
  var atNonSA = await callAs('oro_sysadmin', 'POST', '/jurisdiction-profile/unattest', { section: 'fees' });
  var atNonSup = await callAs('oro_supervisor', 'POST', '/jurisdiction-profile/unattest', { section: 'fees' });
  ok('I2 non-legal section: oro_sysadmin passes (compliance_policy); oro_senior_legal 403; oro_supervisor 403 (no group at all)',
    through(atNonSA) && gated(atNonSL) && gated(atNonSup), atNonSA.status + '/' + atNonSL.status + '/' + atNonSup.status);
  var cfLegal = await callAs('oro_sysadmin', 'POST', '/jurisdiction-profile/policy-settings/confirm', { domain: 'exemption', path: 'nope', value: 1 });
  var cfNon = await callAs('oro_senior_legal', 'POST', '/jurisdiction-profile/policy-settings/confirm', { domain: 'fee', path: 'nope', value: 1 });
  var cfOk = await callAs('oro_senior_legal', 'POST', '/jurisdiction-profile/policy-settings/confirm', { domain: 'exemption', path: 'no.such.path', value: 1 });
  ok('I3 confirm by domain: sysadmin on a legal domain 403; senior legal on a non-legal domain 403; senior legal on a legal domain passes (400 unknown path)', gated(cfLegal) && gated(cfNon) && cfOk.status === 400);
  var prLegal = await callAs('oro_sysadmin', 'POST', '/jurisdiction-profile/rules/exemption/propose', { domain: 'exemption', config: {} });
  var prNon = await callAs('oro_director', 'POST', '/jurisdiction-profile/rules/fees/propose', { domain: 'fee', config: {} });
  ok('I4 propose by domain: sysadmin on a legal domain 403 ("proposed by"); director on a non-legal domain passes the gate', gated(prLegal) && /proposed by/.test(prLegal.body.error) && through(prNon));

  console.log('\n=== J. GO-LIVE (§4 go_live = oro_sysadmin OR oro_director) ===');
  // POST /enforcement with devMode=true is a no-op on a dev-mode fixture; 200 proves the gate passed.
  var glDir = await callAs('oro_director', 'POST', '/jurisdiction-profile/enforcement', { devMode: true });
  var glSA = await callAs('oro_sysadmin', 'POST', '/jurisdiction-profile/enforcement', { devMode: true });
  var glSup = await callAs('oro_supervisor', 'POST', '/jurisdiction-profile/enforcement', { devMode: true });
  ok('J1 go-live flip: oro_director passes, oro_sysadmin passes, oro_supervisor 403 (AUTHORITY_REQUIRED go_live)',
    glDir.status === 200 && glSA.status === 200 && gated(glSup) && glSup.body.code === 'AUTHORITY_REQUIRED', glDir.status + '/' + glSA.status + '/' + glSup.status);
  var glLegacy = jwt.sign({ sub: 'u-' + TAG + '-oro_supervisor', roles: ['SYSTEM_ADMIN'], perms: [], av: (await db.get('SELECT auth_version FROM users WHERE id = ?', ['u-' + TAG + '-oro_supervisor'])).auth_version }, process.env.JWT_SECRET || 'optimumq-dev-secret', { expiresIn: '1h' });
  var glForged = await fetch('http://localhost:' + PORT + '/api/jurisdiction-profile/enforcement', { method: 'POST', headers: { Authorization: 'Bearer ' + glLegacy, 'Content-Type': 'application/json' }, body: '{"devMode":true}' });
  ok('J2 a token claiming the legacy SYSTEM_ADMIN role but no go_live authority is refused — the new gates never read legacy claims', glForged.status === 403);

  console.log('\n=== K. SETTLEMENT WEBHOOK compare is timing-safe (§8 row 6, unit) ===');
  var SM = require('/opt/optimumq/backend/src/routes/settlement').secretMatches;
  var sm = require('/opt/optimumq/backend/src/routes/settlement.js');
  var src = require('fs').readFileSync('/opt/optimumq/backend/src/routes/settlement.js', 'utf8');
  ok('K1 equal secrets match; different / prefix / empty do not', SM('abc123', 'abc123') && !SM('abc124', 'abc123') && !SM('abc', 'abc123') && !SM('', 'abc123'));
  ok('K2 the compare goes through crypto.timingSafeEqual and the handler no longer uses !== on the secret', /timingSafeEqual/.test(src) && !/\) !== expected\)/.test(src));

  console.log('\n=== L. MULTI-TEAM MEMBERSHIP (§6.1, S2b) — work eligibility follows the teams a type is held against ===');
  var tr = require('/opt/optimumq/backend/src/services/taskRouting');
  var two = 'u-' + TAG + '-two', mis = 'u-' + TAG + '-mis', off = 'u-' + TAG + '-off';
  // two: staff on police AND fire (home dept police). mis: home dept police, but the only team type is on FIRE.
  // off: office-only (oro_associate), home dept police. All three hold the `estimate` subset.
  await db.run("INSERT INTO users (id, email, display_name, title, department_id, status) VALUES (?,?,?,?,?, 'active')", [two, TAG + '-two@test.optimumq.ai', 'UT Two Teams', 'Test ' + TAG, 'team-police']);
  await db.run("INSERT INTO users (id, email, display_name, title, department_id, status) VALUES (?,?,?,?,?, 'active')", [mis, TAG + '-mis@test.optimumq.ai', 'UT Mismatched Home', 'Test ' + TAG, 'team-police']);
  await db.run("INSERT INTO users (id, email, display_name, title, department_id, status) VALUES (?,?,?,?,?, 'active')", [off, TAG + '-off@test.optimumq.ai', 'UT Office Only', 'Test ' + TAG, 'team-police']);
  await ut.grant(two, 'team_staff', 'team-police', 'harness'); await ut.grant(two, 'team_staff', 'team-fire', 'harness');
  await ut.grant(mis, 'team_staff', 'team-fire', 'harness');
  await ut.grant(off, 'oro_associate', null, 'harness');
  var seededBefore = Number((await db.get("SELECT count(*)::int AS n FROM user_task_types WHERE task_type = 'estimate'")).n);
  for (var lu of [two, mis, off]) await db.run("INSERT INTO user_task_types (user_id, task_type) VALUES (?, 'estimate') ON CONFLICT DO NOTHING", [lu]);
  ok('L0 teamsOf reads membership from the types held (two -> police+fire; mis -> fire; off -> none)',
    sameSet(await ut.teamsOf(two), ['team-police', 'team-fire']) && sameSet(await ut.teamsOf(mis), ['team-fire']) && (await ut.teamsOf(off)).length === 0);
  var ePol = (await tr.eligibleUsers('team-police', 'estimate')).map(function (x) { return x.id; });
  var eFire = (await tr.eligibleUsers('team-fire', 'estimate')).map(function (x) { return x.id; });
  var eHr = (await tr.eligibleUsers('team-hr', 'estimate')).map(function (x) { return x.id; });
  ok('L1 two-team person is eligible on BOTH teams and not on a third', ePol.indexOf(two) !== -1 && eFire.indexOf(two) !== -1 && eHr.indexOf(two) === -1);
  ok('L2 home department no longer gates: mis (home police, type on fire) is eligible on FIRE and NOT on police', eFire.indexOf(mis) !== -1 && ePol.indexOf(mis) === -1);
  ok('L3 office-only staff are eligible on no team', ePol.indexOf(off) === -1 && eFire.indexOf(off) === -1);
  var tPol = await tr.createTask({ type: 'estimate', requestId: null, teamId: 'team-police', createdBy: 'harness' });
  var tFire = await tr.createTask({ type: 'estimate', requestId: null, teamId: 'team-fire', createdBy: 'harness' });
  var poolTwo = (await tr.poolForUser(two)).map(function (t) { return t.id; });
  var poolMis = (await tr.poolForUser(mis)).map(function (t) { return t.id; });
  ok('L4 the pool OFFERS both teams\' tasks to the two-team person; only fire\'s to the mismatched-home person',
    poolTwo.indexOf(tPol.id) !== -1 && poolTwo.indexOf(tFire.id) !== -1 && poolMis.indexOf(tFire.id) !== -1 && poolMis.indexOf(tPol.id) === -1);
  var cPol = await tr.claim(tPol.id, two);
  var cMisPol = await tr.claim(tPol.id, mis);
  ok('L5 the claim guard agrees with the pool: two claims police; mis is refused on police', !!cPol.task && cPol.task.assigned_to === two && !!cMisPol.error);
  var cFire = await tr.claim(tFire.id, mis);
  ok('L6 ...and mis claims fire', !!cFire.task && cFire.task.assigned_to === mis);
  // subset scope (§8 row 4) under §6.1: a team_manager of FIRE may set the subset of someone who is a fire member
  // even though that person's home department is police.
  var mgrF = 'u-' + TAG + '-mgrfire';
  await db.run("INSERT INTO users (id, email, display_name, title, department_id, status) VALUES (?,?,?,?,?, 'active')", [mgrF, TAG + '-mgrfire@test.optimumq.ai', 'UT Fire Manager', 'Test ' + TAG, 'team-fire']);
  await ut.grant(mgrF, 'team_manager', 'team-fire', 'harness');
  var mgrTok = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [mgrF]));
  var subOk = await fetch('http://localhost:' + PORT + '/api/staff/' + mis + '/task-types', { method: 'PATCH', headers: { Authorization: 'Bearer ' + mgrTok, 'Content-Type': 'application/json' }, body: JSON.stringify({ taskTypes: ['estimate'] }) });
  var subNo = await fetch('http://localhost:' + PORT + '/api/staff/' + off + '/task-types', { method: 'PATCH', headers: { Authorization: 'Bearer ' + mgrTok, 'Content-Type': 'application/json' }, body: JSON.stringify({ taskTypes: ['estimate'] }) });
  ok('L7 subset scope by membership: fire\'s manager may set a fire member\'s subset (home dept police) — 200; not a non-member — 403', subOk.status === 200 && subNo.status === 403);
  // Leave the world as found: the fixture is UNSEEDED for estimate (verify_qa_routing asserts it).
  await db.run('DELETE FROM tasks WHERE id IN (?, ?)', [tPol.id, tFire.id]);
  await db.run('DELETE FROM user_task_types WHERE user_id IN (?, ?, ?)', [two, mis, off]);
  var seededAfter = Number((await db.get("SELECT count(*)::int AS n FROM user_task_types WHERE task_type = 'estimate'")).n);
  ok('L8 harness grants and tasks removed (estimate seeding back to ' + seededBefore + ')', seededAfter === seededBefore);
  for (var lu2 of [two, mis, off, mgrF]) { await ut.revokeAll(lu2); await db.run('DELETE FROM users WHERE id = ?', [lu2]); }

  console.log('\n=== M. S3 — the catalog endpoint, display-name rename, and the §6 picker constraint ===');
  var cat = await callAs('team_staff', 'GET', '/user-types');
  var catTypes = (cat.body && cat.body.userTypes) || [];
  ok('M1 GET /user-types lists the 11 types with menus / authorities / groups (readable by any signed-in user)', cat.status === 200 && catTypes.length === 11 &&
    catTypes.every(function (t) { return sameSet(t.taskMenu, ut.TASK_MENU[t.key]) && sameSet(t.authorities, ut.AUTHORITY[t.key]) && sameSet(t.permissionGroups, ut.PERMISSION[t.key]); }));
  var rnNo = await callAs('oro_supervisor', 'PATCH', '/user-types/oro_associate', { displayName: 'Records Coordinator' });
  var rnYes = await callAs('oro_director', 'PATCH', '/user-types/oro_associate', { displayName: 'Records Coordinator' });
  var rnBad = await callAs('oro_director', 'PATCH', '/user-types/oro_associate', { displayName: '' });
  var renamed = await db.get("SELECT display_name FROM user_types WHERE key = 'oro_associate'");
  ok('M2 display-name rename: manage_users holder 200 and it lands; supervisor 403; empty name 400', rnYes.status === 200 && renamed.display_name === 'Records Coordinator' && gated(rnNo) && rnBad.status === 400);
  await db.run("UPDATE user_types SET display_name = 'ORO Associate' WHERE key = 'oro_associate'");
  // Picker constraint: team_staff's menu is the four team types; legal_review is outside it.
  var pcOut = await callAs('oro_director', 'PATCH', '/staff/u-' + TAG + '-team_staff/task-types', { taskTypes: ['estimate', 'legal_review'] });
  var pcIn = await callAs('oro_director', 'PATCH', '/staff/u-' + TAG + '-team_staff/task-types', { taskTypes: ['estimate', 'redaction'] });
  var pcNone = await callAs('oro_director', 'PATCH', '/staff/u-' + TAG + '-city_management/task-types', { taskTypes: ['estimate'] });
  var pcDir = await callAs('oro_director', 'PATCH', '/staff/u-' + TAG + '-oro_director/task-types', { taskTypes: ['legal_review', 'estimate'] });
  ok('M3 granting a task type outside the menu union -> 400 OUTSIDE_TASK_MENU naming it; inside -> 200; empty menu refuses everything; oro_director (any) accepts all',
    pcOut.status === 400 && pcOut.body.code === 'OUTSIDE_TASK_MENU' && sameSet(pcOut.body.outside, ['legal_review']) && pcIn.status === 200 && pcNone.status === 400 && pcDir.status === 200);
  await db.run('DELETE FROM user_task_types WHERE user_id IN (?, ?)', ['u-' + TAG + '-team_staff', 'u-' + TAG + '-oro_director']);
  await sleep(1100);   // M3 changed the director's OWN subset (auth_version bump); let the API's 1s auth_version cache expire
  var one = await callAs('oro_director', 'GET', '/staff/u-' + TAG + '-team_staff');
  ok('M4 GET /staff/:id carries taskMenu (the union) and memberTeams for the picker', one.status === 200 && sameSet(one.body.user.taskMenu || [], ['estimate', 'record_search', 'redaction', 'redaction_qa']) && sameSet(one.body.user.memberTeams || [], ['team-police']), one.status + ' ' + JSON.stringify({ taskMenu: one.body.user && one.body.user.taskMenu, memberTeams: one.body.user && one.body.user.memberTeams }));

  console.log('\n=== N. S4 — every remaining gate is on the model; the SysAdmin bypass is gone ===');
  var fs2 = require('fs'), pathN = require('path');
  var legacySites = [];
  (function walk(d) { fs2.readdirSync(d).forEach(function (n) { var p = pathN.join(d, n); if (fs2.statSync(p).isDirectory()) return walk(p); if (!/\.js$/.test(n) || /middleware\/auth\.js$/.test(p)) return; var src = fs2.readFileSync(p, 'utf8'); if (/requireRole\(|requireRoleOrPerm\(/.test(src)) legacySites.push(pathN.relative('/opt/optimumq/backend/src', p)); }); })('/opt/optimumq/backend/src');
  ok('N1 no route or service calls requireRole / requireRoleOrPerm any more', legacySites.length === 0, legacySites.join(', '));
  var rawRoleReads = [];
  (function walk2(d) { fs2.readdirSync(d).forEach(function (n) { var p = pathN.join(d, n); if (fs2.statSync(p).isDirectory()) return walk2(p); if (!/\.js$/.test(n) || /services\/(userTypes|auth)\.js$|middleware\/auth\.js$/.test(p)) return; fs2.readFileSync(p, 'utf8').split('\n').forEach(function (line, i) { if (/^\s*\/\//.test(line)) return; if (/\.roles\b/.test(line) && !/opts\.roles/.test(line)) rawRoleReads.push(pathN.relative('/opt/optimumq/backend/src', p) + ':' + (i + 1)); }); }); })('/opt/optimumq/backend/src');
  ok('N2 no route or service reads req.user.roles directly (the legacy claim is consulted by nothing but the act-permission list)', rawRoleReads.length === 0, rawRoleReads.join(', '));
  var mid = fs2.readFileSync('/opt/optimumq/backend/src/middleware/auth.js', 'utf8');
  ok('N3 the SYSTEM_ADMIN short-circuit is gone (and so are requireRole / requireRoleOrPerm)', !/indexOf\('SYSTEM_ADMIN'\) !== -1\) return next\(\)/.test(mid) && !/function requireRole\b/.test(mid));
  // Migrated gates, by authority:
  var mgSA = await callAs('oro_sysadmin', 'GET', '/magic/status');
  var mgDir = await callAs('oro_director', 'GET', '/magic/status');
  ok('N4 magic demo surface = system authority: oro_sysadmin passes the gate; oro_director 403', !gated(mgSA) && gated(mgDir), mgSA.status + '/' + mgDir.status);
  var asMgr = await callAs('team_manager', 'POST', '/tasks/no-such-task-' + TAG + '/assign', { assigneeId: 'x' });
  var asStaff = await callAs('team_staff', 'POST', '/tasks/no-such-task-' + TAG + '/assign', { assigneeId: 'x' });
  ok('N5 task assign = routing authority: team_manager passes the gate (404 after); team_staff 403', asMgr.status !== 403 && gated(asStaff), asMgr.status + '/' + asStaff.status);
  var roDir = await callAs('oro_director', 'POST', '/requests/no-such-' + TAG + '/reopen', { note: 'x' });
  var roSA = await callAs('oro_sysadmin', 'POST', '/requests/no-such-' + TAG + '/reopen', { note: 'x' });
  var roSup = await callAs('oro_supervisor', 'POST', '/requests/no-such-' + TAG + '/reopen', { note: 'x' });
  ok('N6 reopen = override_stage: oro_director passes the gate; oro_sysadmin 403 (no bypass); oro_supervisor 403', roDir.status !== 403 && gated(roSA) && gated(roSup), roDir.status + '/' + roSA.status + '/' + roSup.status);
  var obFin = await callAs('oro_finance', 'GET', '/objections/pending-approval');
  var obSup = await callAs('oro_supervisor', 'GET', '/objections/pending-approval');
  var obSA = await callAs('oro_sysadmin', 'GET', '/objections/pending-approval');
  ok('N7 fee-objection approvals = financial_approval: oro_finance 200; oro_supervisor 403; oro_sysadmin 403', obFin.status === 200 && gated(obSup) && gated(obSA));
  var esMgr = await callAs('team_manager', 'POST', '/requests/no-such-' + TAG + '/legal-escalate', {});
  var esStaff = await callAs('team_staff', 'POST', '/requests/no-such-' + TAG + '/legal-escalate', {});
  ok('N8 legal escalation = escalate authority: team_manager passes the gate (404 after); team_staff 403', esMgr.status !== 403 && gated(esStaff), esMgr.status + '/' + esStaff.status);
  var inSA = await callAs('oro_sysadmin', 'GET', '/integrations');
  var inDir = await callAs('oro_director', 'GET', '/integrations');
  ok('N9 integrations = system authority: oro_sysadmin through; oro_director 403', !gated(inSA) && gated(inDir), inSA.status + '/' + inDir.status);
  // Work-competence presets on the task-menu claim.
  var rwStaff = await callAs('team_staff', 'POST', '/redaction/rules', {});
  var rwMgmt = await callAs('city_management', 'POST', '/redaction/rules', {});
  var rwLegal = await callAs('oro_legal_associate', 'POST', '/redaction/rules', {});
  ok('N10 requireRedactionWork on the task-menu claim: team_staff and legal associate pass the gate; city_management 403', !gated(rwStaff) && !gated(rwLegal) && gated(rwMgmt), rwStaff.status + '/' + rwLegal.status + '/' + rwMgmt.status);
  var tokSA = jwt.decode(await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', ['u-' + TAG + '-oro_director'])));
  ok('N11 the token carries taskMenu (oro_director = "*"; team_staff = the four team types)', tokSA.taskMenu === '*' && sameSet(jwt.decode(await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', ['u-' + TAG + '-team_staff']))).taskMenu, ['estimate', 'record_search', 'redaction', 'redaction_qa']));
  var cfDirS4 = await callAs('oro_director', 'GET', '/config/dashboard-panes');
  var cfMgrS4 = await callAs('team_manager', 'GET', '/config/dashboard-panes');
  ok('N12 dashboard default panes follow authority: director org-wide (lateByTeam); team_manager team board (teamInProcess)',
    cfDirS4.status === 200 && cfDirS4.body.panes.some(function (p) { return p.key === 'lateByTeam'; }) && cfMgrS4.status === 200 && cfMgrS4.body.panes.some(function (p) { return p.key === 'teamInProcess'; }));

  console.log('\n=== O. S6 — the coverage-gap email goes to EVERY team manager, once per task, with the request named ===');
  var CG = require('/opt/optimumq/backend/src/services/coverageGap');
  var trO = require('/opt/optimumq/backend/src/services/taskRouting');
  var teamO = 'team-' + TAG;
  await db.run("INSERT INTO departments (id, name, code, kind, active) VALUES (?,?,?,'team',1)", [teamO, 'UT Gap Team ' + TAG, 'G' + TAG.slice(-5)]);
  var m1 = 'u-' + TAG + '-gapmgr1', m2 = 'u-' + TAG + '-gapmgr2', sv = 'u-' + TAG + '-gapsup';
  for (var gi of [[m1, 'Gap Manager One'], [m2, 'Gap Manager Two'], [sv, 'Gap Supervisor']]) {
    await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [gi[0], gi[0] + '@test.optimumq.ai', gi[1], 'Test ' + TAG]);
  }
  await ut.grant(m1, 'team_manager', teamO, 'harness'); await ut.grant(m2, 'team_manager', teamO, 'harness'); await ut.grant(sv, 'team_supervisor', teamO, 'harness');
  var reqO = 'req-' + TAG + '-gap';
  await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, stage, status, department_id) VALUES (?,?,?,?,?,?,'active',?)", [reqO, 'UT-' + TAG, 'UT Gap', 'gap-' + TAG + '@example.com', 'coverage gap harness', 'record_search', teamO]);
  var chain = await CG.managersFor(teamO);
  ok('O1 the chain resolves BOTH team managers (types held against the team), not the supervisor', chain.via === 'team_manager@team' && sameSet(chain.users.map(function (u) { return u.id; }), [m1, m2]));
  await ut.revoke(m1, 'team_manager', teamO); await ut.revoke(m2, 'team_manager', teamO);
  var chain2 = await CG.managersFor(teamO);
  ok('O2 with no manager the chain falls to the team supervisor, then (no team types at all) to the Director', chain2.via === 'team_supervisor@team' && chain2.users[0].id === sv &&
    (await (async function () { await ut.revoke(sv, 'team_supervisor', teamO); var c3 = await CG.managersFor(teamO); await ut.grant(sv, 'team_supervisor', teamO, 'harness'); return c3.via === 'oro_director@office' && c3.users.some(function (u) { return u.id === 'u-kruss'; }); })()));
  await ut.grant(m1, 'team_manager', teamO, 'harness'); await ut.grant(m2, 'team_manager', teamO, 'harness');
  var gapTask = await trO.createTask({ type: 'record_search', requestId: reqO, teamId: teamO, createdBy: 'harness' });
  var sent = [];
  var r1 = await CG.notifyEmptyPool(gapTask, { send: async function (m) { sent.push(m); return { sent: true }; } });
  ok('O3 first raise: one email addressed to BOTH managers, subject names the task, body names the request', sent.length === 1 && sent[0].to.indexOf(m1 + '@test.optimumq.ai') !== -1 && sent[0].to.indexOf(m2 + '@test.optimumq.ai') !== -1 && /record_search/.test(sent[0].subject) && sent[0].text.indexOf('UT-' + TAG) !== -1 && r1.emailed === 2 && r1.notified === 2);
  var r2 = await CG.notifyEmptyPool(gapTask, { send: async function (m) { sent.push(m); return { sent: true }; } });
  ok('O4 a second sweep re-raises nothing: no second email, still one notification per manager', sent.length === 1 && r2.emailed === 0 && Number((await db.get('SELECT count(*)::int AS n FROM notifications WHERE kind = ? AND context_id = ?', [CG.KIND, gapTask.id])).n) === 2);
  var srcCG = require('fs').readFileSync('/opt/optimumq/backend/src/services/coverageGap.js', 'utf8');
  ok('O5 the REAL sender is never used under a test database (guard present); injected sender only', /underTest/.test(srcCG) && /opts\.send \|\| !underTest/.test(srcCG));
  await db.run('DELETE FROM notifications WHERE context_id = ?', [gapTask.id]);
  await db.run('DELETE FROM tasks WHERE id = ?', [gapTask.id]);
  await db.run('DELETE FROM requests WHERE id = ?', [reqO]);
  for (var gu of [m1, m2, sv]) { await ut.revokeAll(gu); await db.run('DELETE FROM users WHERE id = ?', [gu]); }
  await db.run('DELETE FROM departments WHERE id = ?', [teamO]);

  console.log('\n=== G. CLEANUP ===');
  var ids = ut.TYPE_KEYS.map(function (k) { return 'u-' + TAG + '-' + k; }).concat([uid]);
  if (created.userId) ids.push(created.userId);
  for (var d = 0; d < ids.length; d++) { await ut.revokeAll(ids[d]); await db.run('DELETE FROM users WHERE id = ?', [ids[d]]); }
  var left = await db.get("SELECT count(*)::int AS n FROM users WHERE title = 'Test ' || ? OR email LIKE ?", [TAG, TAG + '-%']);
  ok('G1 harness users removed', left.n === 0);

  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERR', e); fail++; console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail'); process.exit(1); });
