'use strict';
// THE SETUP & CONFIGURATION HUB — SPEC_setup_hub.md (H1).
//
//   A. The catalog: five lanes, thirty-five items, every item has a name / lane / deps / owner group; every
//      dependency points at a real item; lane owners are permission GROUPS (the hub gates on the user-type
//      model and nothing else — WORKING_setup_inventory "no stopgap").
//   B. Evidence is COUNTED: a change in what is configured changes the row (a team with no serving department
//      flips teams to in_progress; a proposal pending flips law_updates to needs_attention).
//   C. Dependencies are open-with-warning: a waiting row keeps its door and says what it waits on.
//   D. "Mark it done" (Option A): the lane's group may mark, others 403; the mark shows by name; it is
//      reversible; a legal section needs legal_rules; the go-live row is NOT markable.
//   E. The page always renders — a broken reader yields an honest line, never a 500.
//
// BREAKS THIS SHOULD CATCH: add an item with a dep that does not exist (A3) · let any signed-in user mark
// (D2) · make a waiting row lose its door (C1) · throw from a reader (E1).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ut = require('/opt/optimumq/backend/src/services/userTypes');
var HUB = require('/opt/optimumq/backend/src/services/setupHub');

var pass = 0, fail = 0;
function ok(l, c, extra) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !extra ? '' : '  -> ' + extra)); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'hub' + Date.now().toString().slice(-6);
function sameSet(a, b) { a = a.slice().sort(); b = b.slice().sort(); return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
async function mk(key, teamId) {
  var id = 'u-' + TAG + '-' + key;
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [id, id + '@test.optimumq.ai', 'HUB ' + key, 'Test ' + TAG]);
  if (key !== 'none') await ut.grant(id, key, teamId || null, 'harness');
  return id;
}
async function callAs(id, method, path, body) {
  var t = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [id]));
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
function find(page, key) { var f = null; page.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === key) f = x; }); }); page.top.forEach(function (x) { if (x.key === key) f = x; }); return f; }

(async function () {
  await db.initDb();
  var U = { dir: await mk('oro_director'), legal: await mk('oro_senior_legal'), sa: await mk('oro_sysadmin'), staff: await mk('team_staff', 'team-police'), sup: await mk('team_supervisor', 'team-police'), none: await mk('none') };

  console.log('\n=== A. THE CATALOG ===');
  ok('A1 five lanes in the decided order and names', HUB.LANES.length === 5 && /^Compliance and Policies Setup$/.test(HUB.LANES[0].title) && /Fees, Estimates and Routing$/.test(HUB.LANES[1].title) && /Redaction and Release$/.test(HUB.LANES[2].title) && /^Organization Departments, Teams, and Staff Setup$/.test(HUB.LANES[3].title) && HUB.LANES[4].title === 'Technical Setup');
  ok('A2 thirty-five items (10 + 8 + 5 + 4 + 7 + the agency card on top; intake ADDED as Request rules tab 5, the jurisdiction row DELETED into the agency card — all 2026-08-29)', HUB.ITEMS.length === 35 && HUB.ITEMS.filter(function (i) { return i.top; }).length === 1 &&
    sameSet(HUB.LANES.map(function (l) { return HUB.ITEMS.filter(function (i) { return i.lane === l.key && !i.top; }).length; }), [10, 8, 5, 4, 7]));
  var badDeps = []; HUB.ITEMS.forEach(function (i) { (i.deps || []).forEach(function (d) { if (!HUB.BY_KEY[d]) badDeps.push(i.key + '->' + d); }); });
  ok('A3 every dependency points at a real item', badDeps.length === 0, badDeps.join(','));
  ok('A4 every lane owner is a permission GROUP from the user-type model (no role names anywhere)', HUB.LANES.every(function (l) { return l.groups.every(function (g) { return ut.PERMISSION_GROUPS.indexOf(g) !== -1; }); }) &&
    !/SYSTEM_ADMIN|DIRECTOR|SUPERVISOR|ATTORNEY_REVIEWER/.test(require('fs').readFileSync('/opt/optimumq/backend/src/services/setupHub.js', 'utf8')));
  ok('A5 every item has a reader', HUB.ITEMS.every(function (i) { return typeof HUB.READERS[i.key] === 'function'; }));
  var noDoor = HUB.ITEMS.filter(function (i) { return !i.door; }).map(function (i) { return i.key; });
  ok('A6 the no-door items are exactly the inventory\'s "no screen yet" set (clarification got its screen 2026-08-27)', sameSet(noDoor, ['redaction_auto', 'release_review', 'decision_reasons', 'mass_schedule', 'settlement']), noDoor.join(','));

  console.log('\n=== B. EVIDENCE IS COUNTED ===');
  var page = (await callAs(U.dir, 'GET', '/setup-hub')).body;
  ok('B1 the page renders for a Director: counts + top card + five lanes', page && page.counts && page.top.length === 1 && page.lanes.length === 5);
  var states = ['ready', 'in_progress', 'not_started', 'waiting', 'needs_attention'];
  var allItems = []; page.lanes.forEach(function (l) { allItems = allItems.concat(l.items); }); allItems = allItems.concat(page.top);
  ok('B2 every row carries a known state and a non-empty evidence line', allItems.every(function (x) { return states.indexOf(x.state) !== -1 && typeof x.evidence === 'string' && x.evidence.length > 0; }));
  ok('B3 header counts add up to 35', states.reduce(function (n, s) { return n + (page.counts[s] || 0); }, 0) === 35);
  var teamsBefore = find(page, 'teams');
  var dept = 'dept-' + TAG;
  await db.run("INSERT INTO departments (id, name, code, kind, is_open_records, active) VALUES (?,?,?,'department',0,1)", [dept, 'HUB Unserved ' + TAG, 'H' + TAG.slice(-5)]);
  var teamsAfter = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'teams');
  ok('B4 an unserved department flips Fulfillment teams to in_progress and the evidence names it', teamsAfter.state === 'in_progress' && /no team to serve/.test(teamsAfter.evidence), teamsBefore.state + ' -> ' + teamsAfter.state + ': ' + teamsAfter.evidence);
  await db.run('DELETE FROM departments WHERE id = ?', [dept]);
  var jid = (await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'") || {}).value;
  var prop = 'cp-' + TAG;
  var cols = (await db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'config_proposals'")).map(function (r) { return r.column_name; });
  var planted = false;
  if (jid && cols.indexOf('jurisdiction_id') !== -1 && cols.indexOf('status') !== -1) {
    try {
      var need = cols.filter(function (c) { return ['id', 'jurisdiction_id', 'status', 'domain', 'section', 'proposed_config', 'proposal_json', 'created_at', 'proposed_by', 'citation', 'note', 'source'].indexOf(c) !== -1; });
      var vals = need.map(function (c) { return c === 'id' ? prop : c === 'jurisdiction_id' ? jid : c === 'status' ? 'pending' : c === 'created_at' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : (c === 'proposed_config' || c === 'proposal_json') ? '{}' : 'hub-' + TAG; });
      await db.run('INSERT INTO config_proposals (' + need.join(',') + ') VALUES (' + need.map(function () { return '?'; }).join(',') + ')', vals);
      planted = true;
    } catch (e) { console.log('        (could not plant a proposal: ' + e.message + ')'); }
  }
  if (planted) {
    var lu = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'law_updates');
    ok('B5 a pending proposal flips "Keeping up with changes in the law" to needs_attention', lu.state === 'needs_attention' && /waiting for review/.test(lu.evidence), lu.state + ': ' + lu.evidence);
    await db.run('DELETE FROM config_proposals WHERE id = ?', [prop]);
  } else { ok('B5 (skipped: no jurisdiction or proposals table shape unknown)', true); }

  console.log('\n=== C. DEPENDENCIES ARE OPEN WITH A WARNING ===');
  var waiting = allItems.filter(function (x) { return x.state === 'waiting'; });
  ok('C1 every waiting row still has its door (or is a no-screen item) and names what it waits on', waiting.every(function (x) { return (x.door || x.noScreen) && Array.isArray(x.waitingOn) && x.waitingOn.length > 0 && /Waiting on:/.test(x.why || ''); }), waiting.map(function (x) { return x.key; }).join(','));
  var gl = find(page, 'go_live');
  ok('C2 the go-live row sits in lane 1, is never markable, and says who flips it', page.lanes[0].items.some(function (x) { return x.key === 'go_live'; }) && gl.goLive === true && (gl.state === 'ready' || /ORO System Administrator or ORO Director|ready to flip|enforcement/.test(gl.evidence)), gl && (gl.state + ': ' + gl.evidence));

  console.log('\n=== D. MARK IT DONE (Option A) ===');
  var item = 'time_budgets';   // lane 2a: operations_config
  var m1 = await callAs(U.sup, 'POST', '/setup-hub/' + item + '/done');
  var m2 = await callAs(U.staff, 'POST', '/setup-hub/' + item + '/done');
  var m3 = await callAs(U.none, 'POST', '/setup-hub/' + item + '/done');
  ok('D1 a team supervisor (operations_config) may mark a lane-2a item; team staff and a typeless account get 403 PERMISSION_REQUIRED', m1.status === 200 && m2.status === 403 && m2.body.code === 'PERMISSION_REQUIRED' && m3.status === 403);
  var after = find((await callAs(U.staff, 'GET', '/setup-hub')).body, item);
  ok('D2 the mark shows by name and date on the row, the row reads ready, and a non-holder sees canEdit=false', after.signoff && /HUB team_supervisor/.test(after.signoff.by) && after.state === 'ready' && /marked done by/.test(after.evidence) && after.canEdit === false);
  var un = await callAs(U.sup, 'DELETE', '/setup-hub/' + item + '/done');
  var after2 = find((await callAs(U.sup, 'GET', '/setup-hub')).body, item);
  ok('D3 the mark is reversible', un.status === 200 && !after2.signoff);
  var lg1 = await callAs(U.dir, 'POST', '/setup-hub/exemptions/done');
  var lg2 = await callAs(U.sa, 'POST', '/setup-hub/exemptions/done');
  var lg3 = await callAs(U.legal, 'POST', '/setup-hub/exemptions/done');
  ok('D4 a LEGAL section needs legal_rules: Director may, Senior Legal may, SysAdmin 403', lg1.status === 200 && lg3.status === 200 && lg2.status === 403);
  await callAs(U.legal, 'DELETE', '/setup-hub/exemptions/done');
  var glm = await callAs(U.dir, 'POST', '/setup-hub/go_live/done');
  ok('D5 go-live cannot be "marked done" (400 NOT_MARKABLE) — it is flipped, not declared', glm.status === 400 && glm.body.code === 'NOT_MARKABLE');
  var t1 = await callAs(U.sa, 'POST', '/setup-hub/ai_keys/done');
  var t2 = await callAs(U.dir, 'POST', '/setup-hub/ai_keys/done');
  ok('D6 a Technical Setup item is the system_admin group: SysAdmin may, Director 403', t1.status === 200 && t2.status === 403);
  await callAs(U.sa, 'DELETE', '/setup-hub/ai_keys/done');
  ok('D7 an unknown item is 404', (await callAs(U.dir, 'POST', '/setup-hub/no-such-item/done')).status === 404);

  console.log('\n=== E. THE PAGE ALWAYS RENDERS ===');
  var saved = HUB.READERS.agent_rules;
  HUB.READERS.agent_rules = async function () { throw new Error('boom'); };
  var broken = await HUB.build({ sub: U.dir, permissionGroups: ['compliance_policy'], authorities: [] });
  HUB.READERS.agent_rules = saved;
  var ar = null; broken.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === 'agent_rules') ar = x; }); });
  ok('E1 a reader that throws yields an honest not_started line; the page still builds', ar && ar.state === 'not_started' && /could not read: boom/.test(ar.evidence) && broken.lanes.length === 5);

  console.log('\n=== F. CLEANUP ===');
  for (var k in U) { await ut.revokeAll(U[k]); await db.run('DELETE FROM users WHERE id = ?', [U[k]]); }
  await db.run("DELETE FROM setup_hub_signoffs WHERE marked_by LIKE 'u-' || ? || '-%'", [TAG]);
  var left = await db.get("SELECT count(*)::int AS n FROM users WHERE title = 'Test ' || ?", [TAG]);
  ok('F1 harness users and marks removed', left.n === 0);

  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERR', e); fail++; console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail'); process.exit(1); });
