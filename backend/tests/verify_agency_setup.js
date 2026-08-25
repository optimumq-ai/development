'use strict';
// AGENCY SETUP + "LOCK STATE AND LOAD ITS RULES" — H3 (WORKING_hub_linked_screens §1, decided 2026-08-25).
//
//   A. The screen's API: fields read/write behind the hub's own gate; the state list says which states have a
//      rules file; a lock with no state / no rules file / no permission is refused with a plain reason.
//   B. THE LOCK IS THE LOAD: one click imports the state's rules (jurisdiction_rules rows for jur-<st>), makes
//      it the city's jurisdiction (profile active + system_config.jurisdiction_profile), and records who/when.
//      It happens once — a second lock is 409, and Save can no longer move the state.
//   C. The hub reads it: agency row = in_progress "state not locked" before, ready "<ST> rules loaded" after
//      (with the address + phone now counted); the compliance lane sees the jurisdiction; attest works.
//   D. The old door is gone: the hub points at /setup/agency and the v1 Configuration page has no Agency tab.
//
// BREAKS THIS SHOULD CATCH: let Save change a locked state (B4) · let a non-owner lock (A3) · lock without
// importing (B2) · hub still reading ready off name+state+email alone (C1) · the Agency tab creeping back (D2).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ut = require('/opt/optimumq/backend/src/services/userTypes');

var pass = 0, fail = 0;
function ok(l, c, extra) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !extra ? '' : '  -> ' + extra)); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'agy' + Date.now().toString().slice(-6);
async function mk(key, teamId) {
  var id = 'u-' + TAG + '-' + key;
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [id, id + '@test.optimumq.ai', 'AGY ' + key, 'Test ' + TAG]);
  if (key !== 'none') await ut.grant(id, key, teamId || null, 'harness');
  return id;
}
async function callAs(id, method, path, body) {
  var t = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [id]));
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function cfg(k) { var r = await db.get('SELECT value FROM system_config WHERE key = ?', [k]); return r ? r.value : null; }
async function setCfg(k, v) { await db.run('INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, v]); }
function agencyRow(page) { return (page.top || []).filter(function (x) { return x.key === 'agency'; })[0]; }

(async function () {
  await db.initDb();
  var U = { sa: await mk('oro_sysadmin'), dir: await mk('oro_director'), staff: await mk('team_staff', 'team-police') };

  // Start from an UNLOCKED city with no jurisdiction, whatever the clone of live holds: this is the state the
  // screen exists for. (Test DB only — testEnv.enforce() above refuses live.)
  for (var k of ['state_locked_at', 'state_locked_by', 'jurisdiction_profile']) await db.run('DELETE FROM system_config WHERE key = ?', [k]);
  await db.run("DELETE FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx'");
  await db.run("DELETE FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx'");
  await db.run("DELETE FROM jurisdiction_profiles WHERE id = 'jur-tx'");
  await db.run("DELETE FROM setup_hub_signoffs WHERE item_key = 'agency'");
  await setCfg('agency_name', 'City of Harness'); await setCfg('state', 'TX'); await setCfg('contact_email', 'records@harness.test');

  console.log('\n=== A. THE SCREEN\'S API ===');
  var g = await callAs(U.sa, 'GET', '/agency');
  ok('A1 GET /agency: fields, state, no lock, the state list marks which states have a rules file', g.status === 200 && g.body.fields.agency_name === 'City of Harness' && g.body.state === 'TX' && g.body.lock === null && g.body.canEdit === true &&
    g.body.states.filter(function (s) { return s.code === 'TX'; })[0].rulesAvailable === true && g.body.states.filter(function (s) { return s.code === 'WY'; })[0].rulesAvailable === false, JSON.stringify(g.body).slice(0, 200));
  var gs = await callAs(U.staff, 'GET', '/agency');
  var ps = await callAs(U.staff, 'PUT', '/agency', { agency_name: 'Nope' });
  var ls = await callAs(U.staff, 'POST', '/agency/lock-state', { state: 'TX' });
  ok('A2 team staff can read but not edit: canEdit false, PUT 403, lock 403', gs.status === 200 && gs.body.canEdit === false && ps.status === 403 && ls.status === 403 && (await cfg('agency_name')) === 'City of Harness', ps.status + '/' + ls.status);
  var l0 = await callAs(U.sa, 'POST', '/agency/lock-state', {});
  var l1 = await callAs(U.sa, 'POST', '/agency/lock-state', { state: 'WY' });
  ok('A3 lock refused with a plain reason: no state (422 NO_STATE) · no rules file (422 NO_RULES_FILE)', l0.status === 422 && l0.body.code === 'NO_STATE' && l1.status === 422 && l1.body.code === 'NO_RULES_FILE' && /Wyoming/.test(l1.body.error), l0.status + '/' + l1.status);
  ok('A4 a refused lock wrote nothing', (await cfg('state_locked_at')) === null && (await cfg('jurisdiction_profile')) === null);
  var p = await callAs(U.dir, 'PUT', '/agency', { agency_short_name: 'Harness', jurisdiction_type: 'city', address_line1: '1 Test Way', address_city: 'Harnessville', address_state: 'TX', address_zip: '78701', contact_phone: '(512) 555-0100', state: 'OH' });
  ok('A5 PUT (director, operations_config) persists the fields and, unlocked, may still move the state', p.status === 200 && p.body.fields.address_line1 === '1 Test Way' && p.body.state === 'OH' && (await cfg('address_zip')) === '78701', JSON.stringify(p.body).slice(0, 160));
  await callAs(U.dir, 'PUT', '/agency', { state: 'TX' });

  console.log('\n=== C1. THE HUB BEFORE THE LOCK ===');
  var hub0 = agencyRow((await callAs(U.sa, 'GET', '/setup-hub')).body);
  ok('C1 agency row is in_progress and says "state not locked" even with name+state+email set; door is /setup/agency', hub0 && hub0.state === 'in_progress' && /state not locked/.test(hub0.evidence) && hub0.door === '/setup/agency', hub0 && (hub0.state + ' | ' + hub0.evidence + ' | ' + hub0.door));

  console.log('\n=== B. THE LOCK IS THE LOAD ===');
  var lk = await callAs(U.sa, 'POST', '/agency/lock-state', { state: 'tx' });
  ok('B1 lock TX → 200 with the lock (who/when) and what loaded', lk.status === 200 && lk.body.ok && lk.body.lock.state === 'TX' && /AGY oro_sysadmin/.test(lk.body.lock.by) && Array.isArray(lk.body.loaded.written), JSON.stringify(lk.body).slice(0, 300));
  var domains = (await db.all("SELECT domain FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx'")).map(function (r) { return r.domain; });
  ok('B2 the rules came in: jurisdiction_rules rows for jur-tx include deadline, fee, exemption, clock_matrix, template_import', ['deadline', 'fee', 'exemption', 'clock_matrix', 'template_import'].every(function (d) { return domains.indexOf(d) !== -1; }) && lk.body.loaded.written.indexOf('deadline') !== -1, domains.join(','));
  var prof = await db.get("SELECT status FROM jurisdiction_profiles WHERE id = 'jur-tx'");
  ok('B3 TX became the city\'s jurisdiction: profile active + system_config.jurisdiction_profile = jur-tx; lock recorded', prof && prof.status === 'active' && (await cfg('jurisdiction_profile')) === 'jur-tx' && (await cfg('state')) === 'TX' && !!(await cfg('state_locked_at')) && /AGY oro_sysadmin/.test(await cfg('state_locked_by')), JSON.stringify(prof));
  var lk2 = await callAs(U.sa, 'POST', '/agency/lock-state', { state: 'OH' });
  var mv = await callAs(U.sa, 'PUT', '/agency', { state: 'OH', contact_phone: '(512) 555-0199' });
  var same = await callAs(U.sa, 'PUT', '/agency', { state: 'TX', contact_phone: '(512) 555-0100' });
  ok('B4 once: second lock 409 ALREADY_LOCKED · Save with another state 409 STATE_LOCKED and writes nothing · Save with the locked state is fine', lk2.status === 409 && lk2.body.code === 'ALREADY_LOCKED' && mv.status === 409 && mv.body.code === 'STATE_LOCKED' && (await cfg('contact_phone')) === '(512) 555-0100' && same.status === 200 && (await cfg('state')) === 'TX', lk2.status + '/' + mv.status + '/' + same.status);
  var g2 = await callAs(U.sa, 'GET', '/agency');
  ok('B5 GET now carries the lock', g2.body.lock && g2.body.lock.state === 'TX' && g2.body.lock.name === 'Texas' && !!g2.body.lock.at);

  console.log('\n=== C. THE HUB AFTER THE LOCK ===');
  var page1 = (await callAs(U.sa, 'GET', '/setup-hub')).body;
  var hub1 = agencyRow(page1);
  ok('C2 agency row is ready and says the rules loaded, by whom', hub1 && hub1.state === 'ready' && /TX rules loaded by AGY oro_sysadmin/.test(hub1.evidence), hub1 && (hub1.state + ' | ' + hub1.evidence));
  ok('C3 the compliance lane sees the jurisdiction (page.jurisdiction = jur-tx; "Which state\'s law" is no longer not_started)', page1.jurisdiction === 'jur-tx' && (function () { var j = null; page1.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === 'jurisdiction') j = x; }); }); return j && j.state !== 'not_started' && !/no jurisdiction profile chosen/.test(j.evidence); })(), page1.jurisdiction);
  await db.run("DELETE FROM system_config WHERE key = 'address_zip'");
  var hub2 = agencyRow((await callAs(U.sa, 'GET', '/setup-hub')).body);
  ok('C4 the address is counted: drop the ZIP and the row falls back to in_progress "street address missing"', hub2.state === 'in_progress' && /street address missing/.test(hub2.evidence), hub2.state + ' | ' + hub2.evidence);
  await setCfg('address_zip', '78701');
  var at = await callAs(U.sa, 'POST', '/setup-hub/agency/done');
  var hub3 = agencyRow((await callAs(U.sa, 'GET', '/setup-hub')).body);
  ok('C5 attest from the strip = the hub\'s own mark: row shows marked done by name', at.status === 200 && hub3.signoff && /AGY oro_sysadmin/.test(hub3.signoff.by) && /marked done by/.test(hub3.evidence));
  await callAs(U.sa, 'DELETE', '/setup-hub/agency/done');

  console.log('\n=== D. THE OLD DOOR IS GONE ===');
  var HUB = require('/opt/optimumq/backend/src/services/setupHub');
  ok('D1 no hub item points at the retired Agency tab', HUB.ITEMS.every(function (i) { return i.door !== '/admin?tab=config' || i.key !== 'agency'; }) && HUB.BY_KEY.agency.door === '/setup/agency');
  var cp = fs.readFileSync('/opt/optimumq/frontend/src/pages/ConfigurationPage.js', 'utf8');
  ok('D2 ConfigurationPage has no Agency tab and no agency_name/state field', !/label:\s*'Agency'/.test(cp) && !/agency_name/.test(cp) && !/set\('state'/.test(cp));
  ok('D3 the route and page exist', /path="setup\/agency"/.test(fs.readFileSync('/opt/optimumq/frontend/src/App.js', 'utf8')) && fs.existsSync('/opt/optimumq/frontend/src/pages/AgencySetupPage.js'));

  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(1); });
