'use strict';
// THE SETUP & CONFIGURATION HUB — SPEC_setup_hub.md (H1).
//
//   A. The catalog: six lanes, thirty-four items, every item has a name / lane / deps / owner group; every
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
  ok('A1 six lanes in the decided order and names (System Features and Options added 2026-08-29)', HUB.LANES.length === 6 && /^Compliance and Policies Setup$/.test(HUB.LANES[0].title) && /Fees, Estimates and Routing$/.test(HUB.LANES[1].title) && /Redaction and Release$/.test(HUB.LANES[2].title) && /^Organization Departments, Teams, and Staff Setup$/.test(HUB.LANES[3].title) && HUB.LANES[4].title === 'Technical Setup' && HUB.LANES[5].title === 'System Features and Options');
  ok('A2 thirty-four items (10 + 3 + 6 + 4 + 5 + 5 + the agency card on top; C11–C15 2026-08-30: Configuration tabs → /setup screens, av_redaction + process_map added, ai_keys + ai_deployment merged)', HUB.ITEMS.length === 34 && HUB.ITEMS.filter(function (i) { return i.top; }).length === 1 &&
    sameSet(HUB.LANES.map(function (l) { return HUB.ITEMS.filter(function (i) { return i.lane === l.key && !i.top; }).length; }), [10, 3, 6, 4, 5, 5]));
  var badDeps = []; HUB.ITEMS.forEach(function (i) { (i.deps || []).forEach(function (d) { if (!HUB.BY_KEY[d]) badDeps.push(i.key + '->' + d); }); });
  ok('A3 every dependency points at a real item', badDeps.length === 0, badDeps.join(','));
  ok('A4 every lane owner is a permission GROUP from the user-type model (no role names anywhere)', HUB.LANES.every(function (l) { return l.groups.every(function (g) { return ut.PERMISSION_GROUPS.indexOf(g) !== -1; }); }) &&
    !/SYSTEM_ADMIN|DIRECTOR|SUPERVISOR|ATTORNEY_REVIEWER/.test(require('fs').readFileSync('/opt/optimumq/backend/src/services/setupHub.js', 'utf8')));
  ok('A5 every item has a reader', HUB.ITEMS.every(function (i) { return typeof HUB.READERS[i.key] === 'function'; }));
  var noDoor = HUB.ITEMS.filter(function (i) { return !i.door; }).map(function (i) { return i.key; });
  ok('A6 the no-door items are exactly the inventory\'s "no screen yet" set (clarification got its screen 2026-08-27)', sameSet(noDoor, ['redaction_auto', 'release_review', 'decision_reasons', 'mass_schedule', 'settlement']), noDoor.join(','));

  console.log('\n=== B. EVIDENCE IS COUNTED ===');
  var page = (await callAs(U.dir, 'GET', '/setup-hub')).body;
  ok('B1 the page renders for a Director: counts + top card + six lanes', page && page.counts && page.top.length === 1 && page.lanes.length === 6);
  var states = ['ready', 'in_progress', 'not_started', 'waiting', 'needs_attention'];
  var allItems = []; page.lanes.forEach(function (l) { allItems = allItems.concat(l.items); }); allItems = allItems.concat(page.top);
  ok('B2 every row carries a known state and a non-empty evidence line', allItems.every(function (x) { return states.indexOf(x.state) !== -1 && typeof x.evidence === 'string' && x.evidence.length > 0; }));
  ok('B3 header counts add up to 34', states.reduce(function (n, s) { return n + (page.counts[s] || 0); }, 0) === 34);
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

  // C4 (2026-08-30): a prerequisite MARKED done counts as ready for its dependents.
  // (2026-08-31) email is a form now: approval needs its required fields, so configure it first (restored in K).
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail.hub.test', smtp_port: '587', smtp_from: 'records@hub.test' } });
  var emBefore = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  if (emBefore && emBefore.state !== 'needs_attention' && emBefore.state !== 'ready') {
    await callAs(U.sa, 'POST', '/setup-hub/email/done');
    var pg4 = (await callAs(U.sa, 'GET', '/setup-hub')).body; var nt4 = find(pg4, 'notifications'), em4 = find(pg4, 'email');
    ok('C4 marking a prerequisite done releases its dependents (email marked → notifications no longer waiting)', em4.state === 'ready' && nt4.state !== 'waiting', em4.state + ' / ' + nt4.state + ': ' + nt4.evidence);
    await callAs(U.sa, 'DELETE', '/setup-hub/email/done');
  } else ok('C4 (skipped: email row is ' + (emBefore && emBefore.state) + ' on this fixture)', true);

  console.log('\n=== D. MARK IT DONE (Option A) ===');
  // A row with no required set and no list — the gate is what D1/D2/D3 are about, not readiness.
  // (Was `time_budgets` until it became a FORM row on 2026-08-31: approving it now needs its budgets reviewed.)
  var item = 'mass_schedule';   // Redaction and Release: operations_config
  var m1 = await callAs(U.sup, 'POST', '/setup-hub/' + item + '/done');
  var m2 = await callAs(U.staff, 'POST', '/setup-hub/' + item + '/done');
  var m3 = await callAs(U.none, 'POST', '/setup-hub/' + item + '/done');
  ok('D1 a team supervisor (operations_config) may mark an operations item; team staff and a typeless account get 403 PERMISSION_REQUIRED', m1.status === 200 && m2.status === 403 && m2.body.code === 'PERMISSION_REQUIRED' && m3.status === 403, m1.status + '/' + m2.status + '/' + m3.status);
  var after = find((await callAs(U.staff, 'GET', '/setup-hub')).body, item);
  ok('D2 the mark shows by name and date on the row, the row reads ready, and a non-holder sees canEdit=false', after.signoff && /HUB team_supervisor/.test(after.signoff.by) && after.state === 'ready' && /marked done by/.test(after.evidence) && after.canEdit === false);
  var un = await callAs(U.sup, 'DELETE', '/setup-hub/' + item + '/done');
  var after2 = find((await callAs(U.sup, 'GET', '/setup-hub')).body, item);
  ok('D3 the mark is reversible', un.status === 200 && !after2.signoff);
  var lg1 = await callAs(U.dir, 'POST', '/setup-hub/exemptions/done');
  var lg2 = await callAs(U.sa, 'POST', '/setup-hub/exemptions/done');
  var lg3 = await callAs(U.legal, 'POST', '/setup-hub/exemptions/done');
  // (2026-08-31) exemptions is a decision row: the gate lets Director / Senior Legal through (200, or 422 while its
  // choices are undecided), and refuses the SysAdmin outright (403).
  ok('D4 a LEGAL section needs legal_rules: Director may, Senior Legal may (200 or readiness 422), SysAdmin 403', lg1.status !== 403 && lg3.status !== 403 && lg2.status === 403, lg1.status + '/' + lg3.status + '/' + lg2.status);
  await callAs(U.legal, 'DELETE', '/setup-hub/exemptions/done');
  var glm = await callAs(U.dir, 'POST', '/setup-hub/go_live/done');
  ok('D5 go-live cannot be "marked done" (400 NOT_MARKABLE) — it is flipped, not declared', glm.status === 400 && glm.body.code === 'NOT_MARKABLE');
  var t1 = await callAs(U.sa, 'POST', '/setup-hub/settlement/done');
  var t2 = await callAs(U.dir, 'POST', '/setup-hub/settlement/done');
  ok('D6 a Technical Setup item is the system_admin group: SysAdmin may, Director 403', t1.status === 200 && t2.status === 403, t1.status + '/' + t2.status);
  await callAs(U.sa, 'DELETE', '/setup-hub/settlement/done');
  ok('D7 an unknown item is 404', (await callAs(U.dir, 'POST', '/setup-hub/no-such-item/done')).status === 404);

  console.log('\n=== E. THE PAGE ALWAYS RENDERS ===');
  var saved = HUB.READERS.agent_rules;
  HUB.READERS.agent_rules = async function () { throw new Error('boom'); };
  var broken = await HUB.build({ sub: U.dir, permissionGroups: ['compliance_policy'], authorities: [] });
  HUB.READERS.agent_rules = saved;
  var ar = null; broken.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === 'agent_rules') ar = x; }); });
  ok('E1 a reader that throws yields an honest not_started line; the page still builds', ar && ar.state === 'not_started' && /could not read: boom/.test(ar.evidence) && broken.lanes.length === 6);

  console.log('\n=== G. POST /config GATING (C11: operational keys are operations_config; the rest system) ===');
  var ack0 = await db.get("SELECT value FROM system_config WHERE key = 'ack_email'");
  var g1 = await callAs(U.sup, 'POST', '/config', { ack_email: 'off' });
  var g2 = await callAs(U.sup, 'POST', '/config', { auth_mode: 'local' });
  var g3 = await callAs(U.staff, 'POST', '/config', { ack_email: 'on' });
  var g4 = await callAs(U.sa, 'POST', '/config', { av_redaction_mode: 'internal' });
  var ack1 = await db.get("SELECT value FROM system_config WHERE key = 'ack_email'");
  ok('G1 operations_config may write an operational key (ack_email) and it lands', g1.status === 200 && ack1 && ack1.value === 'off', g1.status);
  ok('G2 operations_config is refused on a system key (auth_mode), by name', g2.status === 403 && g2.body && g2.body.code === 'AUTHORITY_REQUIRED', g2.status);
  ok('G3 staff without the group is refused on an operational key', g3.status === 403 && g3.body && g3.body.code === 'PERMISSION_REQUIRED', g3.status);
  ok('G4 system authority writes any key, incl. av_redaction_mode (now in the allow-list)', g4.status === 200, g4.status);
  if (ack0) await db.run("UPDATE system_config SET value = ? WHERE key = 'ack_email'", [ack0.value]); else await db.run("DELETE FROM system_config WHERE key = 'ack_email'");

  console.log('\n=== H. THE APPROVAL MODEL (Kevin 2026-08-31) — red / yellow / green on the agency item ===');
  var AG_KEYS = ['agency_name', 'agency_short_name', 'jurisdiction_type', 'address_line1', 'address_city', 'address_state', 'address_zip', 'contact_email', 'contact_phone', 'state', 'state_locked_at', 'state_locked_by'];
  var agSave = {}; for (var ak of AG_KEYS) { var arow = await db.get('SELECT value FROM system_config WHERE key = ?', [ak]); agSave[ak] = arow ? arow.value : null; }
  var agMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'agency'");
  await callAs(U.sa, 'DELETE', '/setup-hub/agency/done');
  // Every required field but one, through the screen's own route; the lock is simulated (a real lock is one-shot
  // and verify_agency_setup tests it later) — this section is about the approval colours, not the import.
  await callAs(U.sa, 'PUT', '/agency', { agency_name: 'Hub Approval City', jurisdiction_type: 'city', address_line1: '1 Hub St', address_city: 'Hubville', address_state: 'TX', address_zip: '75001', contact_email: 'hub@test.optimumq.ai', contact_phone: '555-0100' });
  for (var lk of [['state', 'TX'], ['state_locked_at', '2026-08-31 00:00:00'], ['state_locked_by', 'harness']]) await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", lk);
  await db.run("DELETE FROM system_config WHERE key = 'agency_short_name'");
  var hA = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'agency');
  ok('H1 a required field empty → RED, naming it', hA.approval === 'red' && /Short name/.test(hA.approvalWhy || ''), hA.approval + ': ' + hA.approvalWhy);
  var mR = await callAs(U.sa, 'POST', '/setup-hub/agency/done');
  ok('H2 approval is REFUSED while red (422 REQUIRED_MISSING, naming the field)', mR.status === 422 && mR.body && mR.body.code === 'REQUIRED_MISSING' && /Short name/.test(mR.body.error), mR.status + ' ' + JSON.stringify(mR.body));
  var pA = await callAs(U.sa, 'PUT', '/agency', { agency_short_name: 'HubTest' });
  var hB = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'agency');
  ok('H3 every required field saved → YELLOW, awaiting approval', pA.status === 200 && hB.approval === 'yellow' && /awaiting approval/.test(hB.approvalWhy || ''), pA.status + ' ' + hB.approval + ': ' + hB.approvalWhy);
  var mG = await callAs(U.sa, 'POST', '/setup-hub/agency/done');
  var hC = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'agency');
  ok('H4 approval → GREEN by name and date', mG.status === 200 && hC.approval === 'green' && /approved by/.test(hC.approvalWhy || ''), mG.status + ' ' + hC.approval + ': ' + hC.approvalWhy);
  var nBefore = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'agency'")).n;
  await callAs(U.sa, 'PUT', '/agency', { contact_phone: '555-0199' });
  var hD = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'agency');
  var nAfter = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'agency'")).n;
  ok('H5 a saved change after approval → YELLOW again ("changed since approval"), and the owners are notified', hD.approval === 'yellow' && /changed since approval/.test(hD.approvalWhy || '') && nAfter > nBefore, hD.approval + ': ' + hD.approvalWhy + ' · notifications ' + nBefore + '→' + nAfter);
  await callAs(U.sa, 'PUT', '/agency', { contact_phone: '555-0198' });
  var nAgain = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'agency'")).n;
  ok('H6 a second change does not pile up notifications (dedupe per item)', nAgain === nAfter, nAfter + '→' + nAgain);
  var pg = (await callAs(U.dir, 'GET', '/setup-hub')).body;
  ok('H7 the page carries the colour counts and a go-live colour (' + pg.goLiveColour + ')', pg.colours && typeof pg.colours.red === 'number' && ['red', 'yellow', 'green'].indexOf(pg.goLiveColour) >= 0);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'agency'"); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'agency'");
  for (var rk in agSave) { if (agSave[rk] == null) await db.run('DELETE FROM system_config WHERE key = ?', [rk]); else await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [rk, agSave[rk]]); }
  await callAs(U.sa, 'DELETE', '/setup-hub/agency/done');
  if (agMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash) VALUES (?,?,?,?,?)', [agMark.item_key, agMark.marked_by, agMark.marked_by_name, agMark.marked_at, agMark.content_hash || null]);

  console.log('\n=== I. THE LIST MODEL (Kevin 2026-08-31) — Record Sources: in progress → ready → approved → changed ===');
  var srcMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'sources'");
  await callAs(U.sa, 'DELETE', '/setup-hub/sources/done'); await callAs(U.sa, 'DELETE', '/setup-hub/sources/ready');
  var sA = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'sources');
  ok('I1 with connectors but no approval → YELLOW "in progress" (quiet — no notification yet)', sA.approvalModel === 'list' && sA.approval === 'yellow' && /in progress/.test(sA.approvalWhy || '') && !sA.ready, sA.approval + ': ' + sA.approvalWhy);
  var rn0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'sources'")).n;
  var rdy = await callAs(U.sa, 'POST', '/setup-hub/sources/ready');
  var sB = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'sources');
  var rn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'sources'")).n;
  ok('I2 "Ready for approval" is recorded by name, the bar says so, and the owners are told once', rdy.status === 200 && sB.ready && sB.approval === 'yellow' && /ready for approval/.test(sB.approvalWhy || '') && rn1 > rn0, rdy.status + ' ' + JSON.stringify(sB.ready) + ' ' + sB.approvalWhy + ' · ' + rn0 + '→' + rn1);
  var rdy2 = await callAs(U.dir, 'POST', '/setup-hub/sources/ready');
  ok('I3 a Director (not the technical lane) may not declare a technical list ready (403)', rdy2.status === 403, rdy2.status);
  var ap1 = await callAs(U.sa, 'POST', '/setup-hub/sources/done');
  var sC = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'sources');
  ok('I4 approval → GREEN and the ready flag is cleared', ap1.status === 200 && sC.approval === 'green' && !sC.ready, ap1.status + ' ' + sC.approval);
  var repo = await db.get("SELECT id, name FROM record_repositories ORDER BY id LIMIT 1");
  var cn0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'sources'")).n;
  var pt = await callAs(U.sa, 'PATCH', '/repositories/' + repo.id, { name: repo.name + ' (hub test)' });
  await new Promise(function (r) { setTimeout(r, 400); });
  var sD = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'sources');
  var cn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'sources'")).n;
  ok('I5 an edit after approval → YELLOW "changed since approval" and the owners are notified', pt.status < 300 && sD.approval === 'yellow' && /changed since approval/.test(sD.approvalWhy || '') && cn1 > cn0, pt.status + ' ' + sD.approval + ': ' + sD.approvalWhy + ' · ' + cn0 + '→' + cn1);
  await callAs(U.sa, 'PATCH', '/repositories/' + repo.id, { name: repo.name });
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'sources'");
  await callAs(U.sa, 'DELETE', '/setup-hub/sources/done'); await callAs(U.sa, 'DELETE', '/setup-hub/sources/ready');
  if (srcMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash) VALUES (?,?,?,?,?)', [srcMark.item_key, srcMark.marked_by, srcMark.marked_by_name, srcMark.marked_at, srcMark.content_hash || null]);

  console.log('\n=== J. THE TABBED SCREEN (Kevin 2026-08-31) — AI configuration: per-tab required sets, one approval ===');
  var AI_KEYS = ['anthropic_api_key', 'voyage_api_key', 'ai_deployment_profile', 'aws_region', 'titan_embed_model', 'bedrock_access_key_id', 'bedrock_secret_key'];
  var aiSave = {}; for (var qk of AI_KEYS) { var qrow = await db.get('SELECT value FROM system_config WHERE key = ?', [qk]); aiSave[qk] = qrow ? qrow.value : null; }
  var aiMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'ai_config'");
  await callAs(U.sa, 'DELETE', '/setup-hub/ai_config/done');
  for (var dk of AI_KEYS) await db.run('DELETE FROM system_config WHERE key = ?', [dk]);
  // The test API inherits the server environment: keys in .env count as set (the screen says so too).
  var envKeys = !!(process.env.ANTHROPIC_API_KEY && process.env.VOYAGE_API_KEY);
  var jA = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'ai_config');
  ok('J1 nothing saved → RED, the line names the tab and the item (keys tab red unless the environment provides keys)', jA.approval === 'red' && /Deployment Model: deployment model not chosen/.test(jA.approvalWhy || '') && jA.tabs && jA.tabs.deployment === 'red' && (envKeys ? jA.tabs.keys !== 'red' : (jA.tabs.keys === 'red' && /AI Service Keys: Anthropic key/.test(jA.approvalWhy || ''))), jA.approval + ': ' + jA.approvalWhy + ' ' + JSON.stringify(jA.tabs) + ' env=' + envKeys);
  var k1 = await callAs(U.sa, 'POST', '/integrations', { ai: { anthropic_api_key: 'sk-ant-hubtest-0000000000', voyage_api_key: 'pa-hubtest-0000000000' } });
  var jB = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'ai_config');
  ok('J2 keys saved → the keys tab is no longer red; the screen stays RED for the deployment tab', k1.status === 200 && jB.approval === 'red' && jB.tabs.keys !== 'red' && jB.tabs.deployment === 'red' && !/AI Service Keys/.test(jB.approvalWhy || ''), k1.status + ' ' + jB.approval + ': ' + jB.approvalWhy);
  var jR = await callAs(U.sa, 'POST', '/setup-hub/ai_config/done');
  ok('J3 approval refused while a tab is red, naming the tab', jR.status === 422 && /Deployment Model/.test(jR.body && jR.body.error || ''), jR.status);
  var d1 = await callAs(U.sa, 'POST', '/integrations', { deployment: { profile: 'standard' } });
  var jC = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'ai_config');
  ok('J4 deployment model chosen → YELLOW, both tab marks yellow', d1.status === 200 && jC.approval === 'yellow' && jC.tabs.keys === 'yellow' && jC.tabs.deployment === 'yellow', jC.approval + ' ' + JSON.stringify(jC.tabs));
  var jG = await callAs(U.sa, 'POST', '/setup-hub/ai_config/done');
  var jD = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'ai_config');
  ok('J5 one approval → GREEN on the screen and every tab', jG.status === 200 && jD.approval === 'green' && jD.tabs.keys === 'green' && jD.tabs.deployment === 'green', jG.status + ' ' + jD.approval);
  var jn0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'ai_config'")).n;
  await callAs(U.sa, 'POST', '/integrations', { deployment: { profile: 'airgapped' } });
  var jE = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'ai_config');
  var jn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'ai_config'")).n;
  ok('J6 a change on one tab after approval → YELLOW again and the owners are notified', jE.approval === 'yellow' && /changed since approval/.test(jE.approvalWhy || '') && jn1 > jn0, jE.approval + ': ' + jE.approvalWhy + ' · ' + jn0 + '→' + jn1);
  await callAs(U.sa, 'POST', '/integrations', { deployment: { profile: 'government' } });
  var jF = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'ai_config');
  ok('J7 Government chosen with no GovCloud connection → RED again, naming the four fields', jF.approval === 'red' && /GovCloud region/.test(jF.approvalWhy || '') && /Bedrock secret key/.test(jF.approvalWhy || ''), jF.approval + ': ' + jF.approvalWhy);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'ai_config'"); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'ai_config'");
  for (var rk2 in aiSave) { if (aiSave[rk2] == null) await db.run('DELETE FROM system_config WHERE key = ?', [rk2]); else await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [rk2, aiSave[rk2]]); }
  await callAs(U.sa, 'DELETE', '/setup-hub/ai_config/done');
  if (aiMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash) VALUES (?,?,?,?,?)', [aiMark.item_key, aiMark.marked_by, aiMark.marked_by_name, aiMark.marked_at, aiMark.content_hash || null]);

  console.log('\n=== K. EMAIL CONFIGURATION (form) — required per provider ===');
  var EM_KEYS = ['email_provider', 'smtp_host', 'smtp_port', 'smtp_from', 'smtp_user', 'smtp_pass', 'resend_api_key', 'resend_from', 'email_from_name'];
  var emSave = {}; for (var ek of EM_KEYS) { var erow = await db.get('SELECT value FROM system_config WHERE key = ?', [ek]); emSave[ek] = erow ? erow.value : null; }
  var emMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'email'");
  await callAs(U.sa, 'DELETE', '/setup-hub/email/done');
  for (var ek2 of EM_KEYS) await db.run('DELETE FROM system_config WHERE key = ?', [ek2]);
  var kA = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  ok('K1 nothing set → RED, "Provider"', kA.approval === 'red' && /Provider/.test(kA.approvalWhy || ''), kA.approval + ': ' + kA.approvalWhy);
  await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'email'"); await db.run("DELETE FROM notifications WHERE kind = 'setup_ready' AND context_id = 'email'"); // C4 configured email earlier; emit() dedupes undismissed notices per user/kind/context
  var kn0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'email'")).n;
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail.hub.test' } });
  var kB = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  ok('K2 SMTP with only a host → RED naming Port and From address', kB.approval === 'red' && /Port/.test(kB.approvalWhy || '') && /From address/.test(kB.approvalWhy || ''), kB.approval + ': ' + kB.approvalWhy);
  var kn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'email'")).n;
  ok('K2b a save that leaves the form red tells nobody', kn1 === kn0, kn0 + '→' + kn1);
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail.hub.test', smtp_port: '587', smtp_from: 'records@hub.test' } });
  var kC = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  ok('K3 host + port + from address → YELLOW (a test send is evidence, not a requirement)', kC.approval === 'yellow', kC.approval + ': ' + kC.approvalWhy);
  var kn2 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'email'")).n;
  ok('K3b the save that filled the last required field is the submission — owners told once, recorded by name', kn2 > kn1 && kC.ready && /approver notified/.test(kC.approvalWhy || ''), kn1 + '→' + kn2 + ' ' + JSON.stringify(kC.ready));
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail.hub.test', smtp_port: '587', smtp_from: 'records@hub.test', email_from_name: 'Records' } });
  var kn3 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'email'")).n;
  ok('K3c a further save while still complete and unapproved does not notify again', kn3 === kn2, kn2 + '→' + kn3);
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail.hub.test', smtp_port: '', smtp_from: 'records@hub.test' } });
  var kR = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  await db.run("UPDATE notifications SET dismissed_at = now() WHERE kind = 'setup_ready' AND context_id = 'email'"); // the owners read the first notice (emit() dedupes against undismissed ones)
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail.hub.test', smtp_port: '587', smtp_from: 'records@hub.test' } });
  var kn4 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'email'")).n;
  ok('K3d back to red (port cleared) then complete again → the submission is re-armed and fires once more', kR.approval === 'red' && !kR.ready && kn4 === kn3 + (kn2 - kn1), kR.approval + ' ' + kn3 + '→' + kn4);
  var kM = await callAs(U.sa, 'POST', '/setup-hub/email/done');
  var kD = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  ok('K4 approval → GREEN', kM.status === 200 && kD.approval === 'green', kM.status + ' ' + kD.approval);
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail2.hub.test' } });
  var kE = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  ok('K5 a changed host after approval → YELLOW "changed since approval"', kE.approval === 'yellow' && /changed since approval/.test(kE.approvalWhy || ''), kE.approval + ': ' + kE.approvalWhy);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'email'"); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'email'");
  for (var rk3 in emSave) { if (emSave[rk3] == null) await db.run('DELETE FROM system_config WHERE key = ?', [rk3]); else await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [rk3, emSave[rk3]]); }
  await callAs(U.sa, 'DELETE', '/setup-hub/email/done');
  if (emMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash) VALUES (?,?,?,?,?)', [emMark.item_key, emMark.marked_by, emMark.marked_by_name, emMark.marked_at, emMark.content_hash || null]);

  console.log('\n=== L. USER AUTHENTICATION SETUP (form) — a shipped default is not a decision ===');
  var AU_KEYS = ['auth_mode', 'mfa_mode', 'session_timeout', 'min_password_length'];
  var auSave = {}; for (var uk of AU_KEYS) { var urow = await db.get('SELECT value FROM system_config WHERE key = ?', [uk]); auSave[uk] = urow ? urow.value : null; }
  var auMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'auth_policy'");
  await callAs(U.sa, 'DELETE', '/setup-hub/auth_policy/done');
  for (var uk2 of AU_KEYS) await db.run('DELETE FROM system_config WHERE key = ?', [uk2]);
  var lA = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'auth_policy');
  ok('L1 nothing saved → RED naming all four', lA.approval === 'red' && /Authentication mode/.test(lA.approvalWhy || '') && /Minimum password length/.test(lA.approvalWhy || ''), lA.approval + ': ' + lA.approvalWhy);
  await callAs(U.sa, 'POST', '/config', { auth_mode: 'local', mfa_mode: 'optional', session_timeout: '8h', min_password_length: '10' });
  var lB = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'auth_policy');
  ok('L2 all four saved (even at their defaults) → YELLOW', lB.approval === 'yellow', lB.approval + ': ' + lB.approvalWhy);
  var lM = await callAs(U.sa, 'POST', '/setup-hub/auth_policy/done');
  await callAs(U.sa, 'POST', '/config', { session_timeout: '4h' });
  var lC = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'auth_policy');
  ok('L3 approved, then a change saved through POST /config → YELLOW again', lM.status === 200 && lC.approval === 'yellow' && /changed since approval/.test(lC.approvalWhy || ''), lM.status + ' ' + lC.approval + ': ' + lC.approvalWhy);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'auth_policy'"); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'auth_policy'");
  for (var rk4 in auSave) { if (auSave[rk4] == null) await db.run('DELETE FROM system_config WHERE key = ?', [rk4]); else await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [rk4, auSave[rk4]]); }
  await callAs(U.sa, 'DELETE', '/setup-hub/auth_policy/done');
  if (auMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash) VALUES (?,?,?,?,?)', [auMark.item_key, auMark.marked_by, auMark.marked_by_name, auMark.marked_at, auMark.content_hash || null]);

  console.log('\n=== M. ORGANIZATION LISTS — departments / teams / staff on the list model ===');
  var mSave = {}; for (var mkey of ['departments', 'teams', 'staff']) { mSave[mkey] = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = ?", [mkey]); await callAs(U.dir, 'DELETE', '/setup-hub/' + mkey + '/done'); await callAs(U.dir, 'DELETE', '/setup-hub/' + mkey + '/ready'); }
  var mp = (await callAs(U.dir, 'GET', '/setup-hub')).body; var mD = find(mp, 'departments'), mT = find(mp, 'teams'), mS = find(mp, 'staff');
  ok('M1 all three are list rows and yellow "in progress" on a populated fixture (counts in the line)', mD.approvalModel === 'list' && mT.approvalModel === 'list' && mS.approvalModel === 'list' && mD.approval === 'yellow' && mT.approval === 'yellow' && mS.approval === 'yellow' && /departments/.test(mD.approvalWhy || '') && /teams/.test(mT.approvalWhy || '') && /people|person/.test(mS.approvalWhy || ''), [mD, mT, mS].map(function (x) { return x.approval + ': ' + x.approvalWhy; }).join(' | '));
  var mR = await callAs(U.sup, 'POST', '/setup-hub/departments/ready');
  var mA = await callAs(U.dir, 'POST', '/setup-hub/departments/done');
  var mD2 = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'departments');
  ok('M2 a supervisor declares departments ready; the Director approves → GREEN', mR.status === 200 && mA.status === 200 && mD2.approval === 'green', mR.status + '/' + mA.status + ' ' + mD2.approval);
  var mn0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'departments'")).n;
  var nd = await callAs(U.dir, 'POST', '/departments', { name: 'Hub Test Dept ' + TAG, code: 'HT' + TAG.slice(-4), kind: 'department' });
  await new Promise(function (r) { setTimeout(r, 400); });
  var mD3 = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'departments');
  var mn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'departments'")).n;
  ok('M3 adding a department after approval → YELLOW "changed since approval" + one notification', nd.status < 300 && mD3.approval === 'yellow' && /changed since approval/.test(mD3.approvalWhy || '') && mn1 > mn0, nd.status + ' ' + mD3.approval + ': ' + mD3.approvalWhy + ' · ' + mn0 + '→' + mn1);
  var ndId = nd.body && (nd.body.id || (nd.body.department && nd.body.department.id));
  if (ndId) await db.run('DELETE FROM departments WHERE id = ?', [ndId]);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id IN ('departments','teams','staff')");
  for (var mk2 of ['departments', 'teams', 'staff']) { await callAs(U.dir, 'DELETE', '/setup-hub/' + mk2 + '/done'); await callAs(U.dir, 'DELETE', '/setup-hub/' + mk2 + '/ready'); if (mSave[mk2]) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash) VALUES (?,?,?,?,?)', [mSave[mk2].item_key, mSave[mk2].marked_by, mSave[mk2].marked_by_name, mSave[mk2].marked_at, mSave[mk2].content_hash || null]); }

  console.log('\n=== N. STAFF ALERTS (tabs) + the acknowledgement decision on Request Intake ===');
  var nSave = {}; for (var nk of ['overdue_alert_days', 'escalation_days', 'ack_email']) { var nrow = await db.get('SELECT value FROM system_config WHERE key = ?', [nk]); nSave[nk] = nrow ? nrow.value : null; await db.run('DELETE FROM system_config WHERE key = ?', [nk]); }
  var nMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'notifications'"); await callAs(U.sa, 'DELETE', '/setup-hub/notifications/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'notifications'");
  var nA = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'notifications');
  ok('N1 the row is "Staff Alerts", doors to /setup/staff-alerts, RED naming both deadline settings, Deadline alerts tab marked red', nA.name === 'Staff Alerts' && nA.door === '/setup/staff-alerts' && nA.approval === 'red' && /Overdue alert/.test(nA.approvalWhy || '') && /Supervisor escalation/.test(nA.approvalWhy || '') && nA.tabs && nA.tabs.deadlines === 'red', nA.name + ' ' + nA.door + ' ' + nA.approval + ': ' + nA.approvalWhy + ' ' + JSON.stringify(nA.tabs));
  var nCat = await callAs(U.staff, 'GET', '/setup-hub/alerts');
  var nKinds = (nCat.body.alerts || []).map(function (a) { return a.kind; });
  ok('N2 the alert catalogue lists every bell alert in plain words (any signed-in user may read it)', nCat.status === 200 && nKinds.indexOf('setup_ready') >= 0 && nKinds.indexOf('work_returned') >= 0 && nKinds.indexOf('coverage_gap') >= 0 && (nCat.body.alerts || []).every(function (a) { return a.title && a.when && a.who; }), nCat.status + ' ' + nKinds.join(','));
  var nR = await callAs(U.sa, 'POST', '/setup-hub/notifications/done');
  await callAs(U.sa, 'POST', '/config', { overdue_alert_days: '1' });
  var nB = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'notifications');
  await callAs(U.sa, 'POST', '/config', { escalation_days: '3' });
  var nC = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'notifications');
  ok('N3 approval refused while red; one setting saved → still RED; both saved → YELLOW, tab mark clears', nR.status === 422 && nB.approval === 'red' && nC.approval === 'yellow' && nC.tabs.deadlines !== 'red', nR.status + ' ' + nB.approval + ' → ' + nC.approval);
  var nI0 = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'intake');
  var nAckBad = await callAs(U.staff, 'POST', '/config', { ack_email: 'off' });
  var nAck = await callAs(U.legal, 'POST', '/config', { ack_email: 'off' });
  var nI1 = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'intake');
  ok('N4 the acknowledgement email is an INTAKE decision: missing there until saved; Senior Legal may record it; plain staff may not (403)', /acknowledgement/.test(nI0.approvalWhy || '') && nAck.status === 200 && nAckBad.status === 403 && !/acknowledgement/.test(nI1.approvalWhy || ''), nAck.status + '/' + nAckBad.status + ' · ' + nI0.approvalWhy + ' → ' + nI1.approvalWhy);
  for (var nk2 in nSave) { if (nSave[nk2] == null) await db.run('DELETE FROM system_config WHERE key = ?', [nk2]); else await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [nk2, nSave[nk2]]); }
  await callAs(U.sa, 'DELETE', '/setup-hub/notifications/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key IN ('notifications','intake')");
  if (nMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (item_key) DO NOTHING', [nMark.item_key, nMark.marked_by, nMark.marked_by_name, nMark.marked_at, nMark.content_hash, nMark.notified_hash]);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id IN ('notifications','intake')");

  console.log('\n=== O. REDACTION RULES LIBRARY (list) — approved AND in effect is the count; waiting-for-approval is health ===');
  var rrMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'redaction_rules'");
  await callAs(U.legal, 'DELETE', '/setup-hub/redaction_rules/done'); await callAs(U.legal, 'DELETE', '/setup-hub/redaction_rules/ready');
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'redaction_rules'");
  var oNew = await callAs(U.legal, 'POST', '/redaction/rules', { title: 'HUB rule ' + TAG, description: 'Harness rule for the approval model — ' + TAG, category: 'privacy' });
  var oRule = oNew.body && oNew.body.id;
  await new Promise(function (r) { setTimeout(r, 400); });
  var oA = find((await callAs(U.legal, 'GET', '/setup-hub')).body, 'redaction_rules');
  ok('O1 the row is a LIST row and a rule still waiting for a supervisor is HEALTH, not a count', oNew.status === 200 && !!oRule && oA.approvalModel === 'list' && /waiting for approval/.test(oA.approvalWhy || ''), oNew.status + ' ' + oA.approvalModel + ' ' + oA.approval + ': ' + oA.approvalWhy);
  var oAp = await callAs(U.legal, 'PATCH', '/redaction/rules/' + oRule + '/approve');
  var oAc = await callAs(U.legal, 'PATCH', '/redaction/rules/' + oRule, { is_active: true });
  await new Promise(function (r) { setTimeout(r, 400); });
  var oB = find((await callAs(U.legal, 'GET', '/setup-hub')).body, 'redaction_rules');
  ok('O2 approved and switched on → the rule counts; YELLOW "in progress" while nobody has declared the library complete (quiet)', oAp.status === 200 && oAc.status === 200 && oB.approval === 'yellow' && /in progress/.test(oB.approvalWhy || '') && /rule/.test(oB.approvalWhy || '') && !oB.ready, oAp.status + '/' + oAc.status + ' ' + oB.approval + ': ' + oB.approvalWhy);
  var on0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'redaction_rules'")).n;
  var oBad = await callAs(U.sa, 'POST', '/setup-hub/redaction_rules/ready');
  var oRdy = await callAs(U.legal, 'POST', '/setup-hub/redaction_rules/ready');
  var oC = find((await callAs(U.legal, 'GET', '/setup-hub')).body, 'redaction_rules');
  var on1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'redaction_rules'")).n;
  ok('O3 "Ready for approval" is a LEGAL act: Senior Legal declares it (recorded by name, owners told once), the SysAdmin gets 403', oBad.status === 403 && oRdy.status === 200 && oC.ready && /ready for approval/.test(oC.approvalWhy || '') && on1 > on0, oBad.status + '/' + oRdy.status + ' ' + JSON.stringify(oC.ready) + ' · ' + on0 + '→' + on1);
  var oApv = await callAs(U.legal, 'POST', '/setup-hub/redaction_rules/done');
  var oD = find((await callAs(U.legal, 'GET', '/setup-hub')).body, 'redaction_rules');
  ok('O4 approval → GREEN and the declaration is cleared', oApv.status === 200 && oD.approval === 'green' && !oD.ready, oApv.status + ' ' + oD.approval + ': ' + oD.approvalWhy);
  var oc0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'redaction_rules'")).n;
  var oDel = await callAs(U.legal, 'DELETE', '/redaction/rules/' + oRule);
  await new Promise(function (r) { setTimeout(r, 400); });
  var oE = find((await callAs(U.legal, 'GET', '/setup-hub')).body, 'redaction_rules');
  var oc1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'redaction_rules'")).n;
  ok('O5 deleting a rule after approval → YELLOW "changed since approval" + one notification (the route\'s finish hook)', oDel.status === 200 && oE.approval === 'yellow' && /changed since approval/.test(oE.approvalWhy || '') && oc1 > oc0, oDel.status + ' ' + oE.approval + ': ' + oE.approvalWhy + ' · ' + oc0 + '→' + oc1);
  if (oRule) { await db.run('DELETE FROM rule_legal_sources WHERE rule_id = ?', [oRule]); await db.run('DELETE FROM redaction_rules WHERE id = ?', [oRule]); }
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'redaction_rules'");
  await callAs(U.legal, 'DELETE', '/setup-hub/redaction_rules/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'redaction_rules'");
  if (rrMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash) VALUES (?,?,?,?,?,?) ON CONFLICT (item_key) DO NOTHING', [rrMark.item_key, rrMark.marked_by, rrMark.marked_by_name, rrMark.marked_at, rrMark.content_hash || null, rrMark.notified_hash || null]);

  console.log('\n=== P. UPDATE CONFIGURATION (form) — an unreviewed proposal is a required item; a shipped reminder default is not a decision ===');
  var UC_KEYS = ['freshness_scan_days', 'freshness_reminder_to'];
  var ucSave = {}; for (var uckey of UC_KEYS) { var ucrow = await db.get('SELECT value FROM system_config WHERE key = ?', [uckey]); ucSave[uckey] = ucrow ? ucrow.value : null; await db.run('DELETE FROM system_config WHERE key = ?', [uckey]); }
  // the fixture may ship pending proposals — park them so this section starts from an empty queue, restored below
  var ucParked = jid ? (await db.all("SELECT id FROM config_proposals WHERE jurisdiction_id = ? AND status = 'pending'", [jid])).map(function (r0) { return r0.id; }) : [];
  for (var ucp of ucParked) await db.run("UPDATE config_proposals SET status = 'dismissed' WHERE id = ?", [ucp]);
  var ucMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'law_updates'");
  await callAs(U.dir, 'DELETE', '/setup-hub/law_updates/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'law_updates'");
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'law_updates'");
  var ucA = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'law_updates');
  ok('P1 nothing saved and no proposals → RED naming both reminder settings', ucA.approval === 'red' && /how often to send the reminder/.test(ucA.approvalWhy || '') && /who receives the reminder/.test(ucA.approvalWhy || ''), ucA.approval + ': ' + ucA.approvalWhy);
  var ucRef = await callAs(U.dir, 'POST', '/setup-hub/law_updates/done');
  ok('P2 approval is refused while red (422 REQUIRED_MISSING)', ucRef.status === 422 && ucRef.body && ucRef.body.code === 'REQUIRED_MISSING', ucRef.status + ' ' + JSON.stringify(ucRef.body && ucRef.body.code));
  var ucn0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'law_updates'")).n;
  var ucSet = await callAs(U.dir, 'POST', '/config-freshness/settings', { cadenceDays: 182, recipient: 'updates@hub.test' });
  await new Promise(function (r) { setTimeout(r, 400); });
  var ucB = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'law_updates');
  var ucn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'law_updates'")).n;
  ok('P3 both reminder settings saved → YELLOW; the completing save submits the screen and tells the owners once', ucSet.status === 200 && ucB.approval === 'yellow' && ucB.ready && ucn1 > ucn0, ucSet.status + ' ' + ucB.approval + ': ' + ucB.approvalWhy + ' · ' + ucn0 + '→' + ucn1);
  var ucApv = await callAs(U.dir, 'POST', '/setup-hub/law_updates/done');
  var ucC = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'law_updates');
  ok('P4 approval → GREEN, and the evidence says the queue is empty', ucApv.status === 200 && ucC.approval === 'green' && /no proposed changes waiting/.test(ucC.evidence || ''), ucApv.status + ' ' + ucC.approval + ': ' + ucC.evidence);
  var ucProp = 'cp-uc-' + TAG, ucPlanted = false;
  if (jid && cols.indexOf('jurisdiction_id') !== -1 && cols.indexOf('status') !== -1) {
    try {
      var ucNeed = cols.filter(function (c) { return ['id', 'jurisdiction_id', 'status', 'domain', 'section', 'proposed_config', 'proposal_json', 'created_at', 'proposed_by', 'citation', 'note', 'source'].indexOf(c) !== -1; });
      var ucVals = ucNeed.map(function (c) { return c === 'id' ? ucProp : c === 'jurisdiction_id' ? jid : c === 'status' ? 'pending' : c === 'created_at' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : (c === 'proposed_config' || c === 'proposal_json') ? '{}' : 'hub-' + TAG; });
      await db.run('INSERT INTO config_proposals (' + ucNeed.join(',') + ') VALUES (' + ucNeed.map(function () { return '?'; }).join(',') + ')', ucVals);
      ucPlanted = true;
    } catch (e) { console.log('        (could not plant a proposal: ' + e.message + ')'); }
  }
  if (ucPlanted) {
    var ucD = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'law_updates');
    ok('P5 a proposal nobody has reviewed re-opens the approved row: RED, naming the change to review', ucD.approval === 'red' && /Review the proposed change/.test(ucD.approvalWhy || '') && ucD.state === 'needs_attention', ucD.approval + '/' + ucD.state + ': ' + ucD.approvalWhy);
    await db.run('DELETE FROM config_proposals WHERE id = ?', [ucProp]);
  } else ok('P5 (skipped: no jurisdiction or proposals table shape unknown)', true);
  for (var ucp2 of ucParked) await db.run("UPDATE config_proposals SET status = 'pending' WHERE id = ?", [ucp2]);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'law_updates'");
  await callAs(U.dir, 'DELETE', '/setup-hub/law_updates/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'law_updates'");
  for (var uck2 in ucSave) { if (ucSave[uck2] == null) await db.run('DELETE FROM system_config WHERE key = ?', [uck2]); else await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [uck2, ucSave[uck2]]); }
  if (ucMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash) VALUES (?,?,?,?,?,?) ON CONFLICT (item_key) DO NOTHING', [ucMark.item_key, ucMark.marked_by, ucMark.marked_by_name, ucMark.marked_at, ucMark.content_hash || null, ucMark.notified_hash || null]);

  console.log('\n=== Q. TAXONOMY / CALIBRATION / RECORD OWNERS (list) — three rows over one screen, three approvals ===');
  var TX_ROWS = ['taxonomy', 'calibration', 'record_owners'];
  var txSave = {};
  for (var txk of TX_ROWS) { txSave[txk] = await db.get('SELECT * FROM setup_hub_signoffs WHERE item_key = ?', [txk]); await callAs(U.dir, 'DELETE', '/setup-hub/' + txk + '/done'); await callAs(U.dir, 'DELETE', '/setup-hub/' + txk + '/ready'); }
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id IN ('taxonomy','calibration','record_owners')");
  var txCat = await db.get('SELECT id FROM categories ORDER BY id LIMIT 1');
  var txDept = await db.get("SELECT id FROM departments WHERE active = 1 ORDER BY id LIMIT 1");
  var txNew = await callAs(U.dir, 'POST', '/taxonomy/record-types', { category_id: txCat && txCat.id, name: 'HUB Type ' + TAG, code: 'HUBT' + TAG.slice(-5) });
  var txId = txNew.body && txNew.body.id;
  await new Promise(function (r) { setTimeout(r, 400); });
  var txPage = (await callAs(U.dir, 'GET', '/setup-hub')).body;
  var txT = find(txPage, 'taxonomy'), txC = find(txPage, 'calibration'), txO = find(txPage, 'record_owners');
  ok('Q1 all three are LIST rows over the same record types, each with its own counted line', txNew.status === 200 && !!txId && txT.approvalModel === 'list' && txC.approvalModel === 'list' && txO.approvalModel === 'list' && /record types/.test(txT.evidence || '') && /calibrated/.test(txC.evidence || '') && /have an owner/.test(txO.evidence || ''), txNew.status + ' | ' + [txT, txC, txO].map(function (x) { return x.approvalModel + '/' + x.approval + ': ' + x.evidence; }).join(' | '));
  ok('Q2 the three doors are the one screen, each with its own ?tab= (the Organization pattern)', txT.door === '/setup/taxonomy' && txC.door === '/setup/taxonomy?tab=calibration' && txO.door === '/setup/taxonomy?tab=owners', [txT.door, txC.door, txO.door].join(' | '));
  var txn0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'taxonomy'")).n;
  var txRdy = await callAs(U.sup, 'POST', '/setup-hub/taxonomy/ready');
  var txApv = await callAs(U.dir, 'POST', '/setup-hub/taxonomy/done');
  var txT2 = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'taxonomy');
  var txn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'taxonomy'")).n;
  ok('Q3 a supervisor declares the taxonomy complete (owners told once); the Director approves → GREEN, declaration cleared', txRdy.status === 200 && txApv.status === 200 && txT2.approval === 'green' && !txT2.ready && txn1 > txn0, txRdy.status + '/' + txApv.status + ' ' + txT2.approval + ' · ' + txn0 + '→' + txn1);
  var txc0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'taxonomy'")).n;
  var txEdit = await callAs(U.dir, 'PATCH', '/taxonomy/record-types/' + txId, { name: 'HUB Type ' + TAG + ' (renamed)' });
  await new Promise(function (r) { setTimeout(r, 400); });
  var txT3 = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'taxonomy');
  var txc1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'taxonomy'")).n;
  ok('Q4 editing a record type after approval → YELLOW "changed since approval" + one notification (routes/taxonomy.js hook)', txEdit.status === 200 && txT3.approval === 'yellow' && /changed since approval/.test(txT3.approvalWhy || '') && txc1 > txc0, txEdit.status + ' ' + txT3.approval + ': ' + txT3.approvalWhy + ' · ' + txc0 + '→' + txc1);
  var txCalApv = await callAs(U.dir, 'POST', '/setup-hub/calibration/done');
  var txcal0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'calibration'")).n;
  var txSeed = await callAs(U.dir, 'PUT', '/estimate-profiles/' + txId, { quantities: { searchHours: 2, reviewHours: 1, bwPages: 40 }, notes: 'hub harness' });
  await new Promise(function (r) { setTimeout(r, 400); });
  var txC2 = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'calibration');
  var txcal1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'calibration'")).n;
  ok('Q5 calibration is its OWN row: approved green, then a seeded profile → YELLOW + one notification (routes/estimateProfiles.js hook)', txCalApv.status === 200 && txSeed.status === 200 && txC2.approval === 'yellow' && /changed since approval/.test(txC2.approvalWhy || '') && txcal1 > txcal0, txCalApv.status + '/' + txSeed.status + ' ' + txC2.approval + ' · ' + txcal0 + '→' + txcal1);
  var txOwnApv = await callAs(U.dir, 'POST', '/setup-hub/record_owners/done');
  var txown0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'record_owners'")).n;
  var txLink = txDept ? await callAs(U.dir, 'POST', '/taxonomy/record-types/' + txId + '/departments', { department_id: txDept.id, role: 'owner' }) : { status: 0 };
  await new Promise(function (r) { setTimeout(r, 400); });
  var txO2 = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'record_owners');
  var txown1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'record_owners'")).n;
  ok('Q6 record ownership is its OWN row: approved green, then a new owner assignment → YELLOW + one notification', txOwnApv.status === 200 && txLink.status === 200 && txO2.approval === 'yellow' && /changed since approval/.test(txO2.approvalWhy || '') && txown1 > txown0, txOwnApv.status + '/' + txLink.status + ' ' + txO2.approval + ' · ' + txown0 + '→' + txown1);
  if (txId) {
    await callAs(U.dir, 'DELETE', '/estimate-profiles/' + txId);
    await callAs(U.dir, 'DELETE', '/taxonomy/record-types/' + txId);
    await db.run('DELETE FROM record_type_estimate_profiles WHERE record_type_id = ?', [txId]);
    await db.run('DELETE FROM record_type_departments WHERE record_type_id = ?', [txId]);
    await db.run('DELETE FROM record_types WHERE id = ?', [txId]);
    await db.run("DELETE FROM taxonomy_audit WHERE entity_id = ? OR details LIKE '%' || ? || '%'", [txId, txId]);
    try { await db.run("DELETE FROM embeddings WHERE owner_type = 'record_type' AND owner_id = ?", [txId]); } catch (e) {}
  }
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id IN ('taxonomy','calibration','record_owners')");
  for (var txk2 of TX_ROWS) {
    await callAs(U.dir, 'DELETE', '/setup-hub/' + txk2 + '/done'); await db.run('DELETE FROM setup_hub_ready WHERE item_key = ?', [txk2]);
    if (txSave[txk2]) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash) VALUES (?,?,?,?,?,?) ON CONFLICT (item_key) DO NOTHING', [txSave[txk2].item_key, txSave[txk2].marked_by, txSave[txk2].marked_by_name, txSave[txk2].marked_at, txSave[txk2].content_hash || null, txSave[txk2].notified_hash || null]);
  }

  console.log('\n=== R. WORKFLOW RULES (list) + PROCESS MAP (acknowledgement — nothing to fill in, reading it is the act) ===');
  var wfMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'routing_rules'");
  var pmMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'process_map'");
  for (var rk5 of ['routing_rules', 'process_map']) { await callAs(U.dir, 'DELETE', '/setup-hub/' + rk5 + '/done'); await callAs(U.dir, 'DELETE', '/setup-hub/' + rk5 + '/ready'); }
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id IN ('routing_rules','process_map')");
  var wfNew = await callAs(U.dir, 'POST', '/workflow/rules', { name: 'HUB rule ' + TAG, description: 'harness', priority: 900, conditions: [], actions: {} });
  var wfId = wfNew.body && wfNew.body.rule && wfNew.body.rule.id;
  await new Promise(function (r) { setTimeout(r, 400); });
  var rA = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'routing_rules');
  ok('R1 Workflow Rules is a LIST row — enabled rules are the count', wfNew.status === 200 && !!wfId && rA.approvalModel === 'list' && rA.approval === 'yellow' && /routing rule/.test(rA.approvalWhy || ''), wfNew.status + ' ' + rA.approvalModel + '/' + rA.approval + ': ' + rA.approvalWhy);
  var wn0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'routing_rules'")).n;
  var wfRdy = await callAs(U.sup, 'POST', '/setup-hub/routing_rules/ready');
  var wfApv = await callAs(U.dir, 'POST', '/setup-hub/routing_rules/done');
  var rB = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'routing_rules');
  var wn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'routing_rules'")).n;
  ok('R2 declared ready (owners told once) then approved → GREEN', wfRdy.status === 200 && wfApv.status === 200 && rB.approval === 'green' && wn1 > wn0, wfRdy.status + '/' + wfApv.status + ' ' + rB.approval + ' · ' + wn0 + '→' + wn1);
  var wc0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'routing_rules'")).n;
  var wfOff = await callAs(U.dir, 'PATCH', '/workflow/rules/' + wfId, { enabled: false });
  await new Promise(function (r) { setTimeout(r, 400); });
  var rC = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'routing_rules');
  var wc1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'routing_rules'")).n;
  ok('R3 switching a rule off after approval → YELLOW "changed since approval", the health line says so, one notification', wfOff.status === 200 && rC.approval === 'yellow' && /changed since approval/.test(rC.approvalWhy || '') && /switched off/.test(rC.approvalWhy || '') && wc1 > wc0, wfOff.status + ' ' + rC.approval + ': ' + rC.approvalWhy + ' · ' + wc0 + '→' + wc1);
  var rD = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'process_map');
  ok('R4 the Process Map counts as READ, not configured: nothing is missing, so it waits at YELLOW for the lane owner', rD.approvalModel === 'fields' && rD.approval === 'yellow' && /awaiting approval/.test(rD.approvalWhy || '') && /decision points/.test(rD.evidence || ''), rD.approvalModel + '/' + rD.approval + ': ' + rD.approvalWhy + ' · ' + rD.evidence);
  var pmApv = await callAs(U.dir, 'POST', '/setup-hub/process_map/done');
  var rE = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'process_map');
  ok('R5 approving the Process Map is never refused (there is nothing to fill in) → GREEN by name and date', pmApv.status === 200 && rE.approval === 'green' && /approved by/.test(rE.approvalWhy || ''), pmApv.status + ' ' + rE.approval + ': ' + rE.approvalWhy);
  if (wfId) await db.run('DELETE FROM workflow_rules WHERE id = ?', [wfId]);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id IN ('routing_rules','process_map')");
  for (var rk6 of ['routing_rules', 'process_map']) { await callAs(U.dir, 'DELETE', '/setup-hub/' + rk6 + '/done'); await db.run('DELETE FROM setup_hub_ready WHERE item_key = ?', [rk6]); }
  for (var rSaved of [wfMark, pmMark]) { if (rSaved) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash) VALUES (?,?,?,?,?,?) ON CONFLICT (item_key) DO NOTHING', [rSaved.item_key, rSaved.marked_by, rSaved.marked_by_name, rSaved.marked_at, rSaved.content_hash || null, rSaved.notified_hash || null]); }

  console.log('\n=== S. TASK TIME BUDGETS (form) — a seeded figure is not a decision; the city has to review each one ===');
  var tbSaved = await db.all('SELECT task_type, budget_days, source, updated_by, updated_at FROM time_budgets WHERE record_type_id IS NULL ORDER BY task_type');
  var tbMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'time_budgets'");
  await callAs(U.dir, 'DELETE', '/setup-hub/time_budgets/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'time_budgets'");
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'time_budgets'");
  await db.run("UPDATE time_budgets SET source = 'seed', updated_by = NULL WHERE record_type_id IS NULL");
  var sA = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'time_budgets');
  ok('S1 every budget still on its provisional default → RED, naming the task types', sA.approval === 'red' && /provisional default, not yet reviewed/.test(sA.approvalWhy || ''), sA.approval + ': ' + sA.approvalWhy);
  var sRef = await callAs(U.dir, 'POST', '/setup-hub/time_budgets/done');
  ok('S2 approval is refused while any budget is unreviewed (422 REQUIRED_MISSING)', sRef.status === 422 && sRef.body && sRef.body.code === 'REQUIRED_MISSING', sRef.status);
  var sFails = [];
  for (var sb of tbSaved) { var sr = await callAs(U.dir, 'PUT', '/config/time-budgets', { taskType: sb.task_type, budgetDays: Number(sb.budget_days) || 3 }); if (sr.status !== 200) sFails.push(sb.task_type + ':' + sr.status); }
  await new Promise(function (r) { setTimeout(r, 400); });
  var sn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'time_budgets'")).n;
  var sB = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'time_budgets');
  ok('S3 saving every budget through the screen → YELLOW, and the completing save submits it (owners told once)', sFails.length === 0 && sB.approval === 'yellow' && sB.ready && sn1 > 0, sFails.join(',') + ' ' + sB.approval + ': ' + sB.approvalWhy + ' · setup_ready ' + sn1);
  var sApv = await callAs(U.dir, 'POST', '/setup-hub/time_budgets/done');
  var sc0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'time_budgets'")).n;
  var sEdit = await callAs(U.dir, 'PUT', '/config/time-budgets', { taskType: tbSaved[0] && tbSaved[0].task_type, budgetDays: (Number(tbSaved[0] && tbSaved[0].budget_days) || 3) + 1 });
  await new Promise(function (r) { setTimeout(r, 400); });
  var sC = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'time_budgets');
  var sc1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'time_budgets'")).n;
  ok('S4 approved, then a changed budget → YELLOW "changed since approval" + one notification', sApv.status === 200 && sEdit.status === 200 && sC.approval === 'yellow' && /changed since approval/.test(sC.approvalWhy || '') && sc1 > sc0, sApv.status + '/' + sEdit.status + ' ' + sC.approval + ' · ' + sc0 + '→' + sc1);
  for (var tbRow of tbSaved) await db.run('UPDATE time_budgets SET budget_days = ?, source = ?, updated_by = ?, updated_at = ? WHERE record_type_id IS NULL AND task_type = ?', [tbRow.budget_days, tbRow.source, tbRow.updated_by, tbRow.updated_at, tbRow.task_type]);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'time_budgets'");
  await callAs(U.dir, 'DELETE', '/setup-hub/time_budgets/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'time_budgets'");
  if (tbMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash) VALUES (?,?,?,?,?,?) ON CONFLICT (item_key) DO NOTHING', [tbMark.item_key, tbMark.marked_by, tbMark.marked_by_name, tbMark.marked_at, tbMark.content_hash || null, tbMark.notified_hash || null]);

  console.log('\n=== T. TASK PROCESSING TIME CAPTURE (form) — "off everywhere" is a decision only once it is SAVED ===');
  var TC_KEY = require('/opt/optimumq/backend/src/services/timeCaptureConfig').KEY;
  var tcRow = await db.get('SELECT value FROM system_config WHERE key = ?', [TC_KEY]);
  var tcMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'time_tracking'");
  await callAs(U.dir, 'DELETE', '/setup-hub/time_tracking/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'time_tracking'");
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'time_tracking'");
  await db.run('DELETE FROM system_config WHERE key = ?', [TC_KEY]);
  var tA = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'time_tracking');
  var tRef = await callAs(U.dir, 'POST', '/setup-hub/time_tracking/done');
  ok('T1 nothing saved → RED ("the shipped default"), and approval is refused 422', tA.approval === 'red' && /not decided/.test(tA.approvalWhy || '') && tRef.status === 422 && tRef.body.code === 'REQUIRED_MISSING', tA.approval + ': ' + tA.approvalWhy + ' · ' + tRef.status);
  var tn0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'time_tracking'")).n;
  var tSave = await callAs(U.dir, 'PUT', '/config/time-capture', { config: { search: 'off', estimate: 'off', legal_redaction: 'off', legal: 'off' } });
  await new Promise(function (r) { setTimeout(r, 400); });
  var tB = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'time_tracking');
  var tn1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'time_tracking'")).n;
  ok('T2 saved as OFF everywhere → YELLOW: off is a valid posture once the city records it; the save submits the screen', tSave.status === 200 && tB.approval === 'yellow' && /off on every task screen — saved/.test(tB.evidence || '') && tB.ready && tn1 > tn0, tSave.status + ' ' + tB.approval + ': ' + tB.evidence + ' · ' + tn0 + '→' + tn1);
  var tApv = await callAs(U.dir, 'POST', '/setup-hub/time_tracking/done');
  var tc0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'time_tracking'")).n;
  var tOn = await callAs(U.dir, 'PUT', '/config/time-capture', { config: { search: 'always' } });
  await new Promise(function (r) { setTimeout(r, 400); });
  var tC = find((await callAs(U.dir, 'GET', '/setup-hub')).body, 'time_tracking');
  var tc1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'time_tracking'")).n;
  ok('T3 approved, then a screen switched on → YELLOW "changed since approval" + one notification', tApv.status === 200 && tOn.status === 200 && tC.approval === 'yellow' && /changed since approval/.test(tC.approvalWhy || '') && tc1 > tc0, tApv.status + '/' + tOn.status + ' ' + tC.approval + ' · ' + tc0 + '→' + tc1);
  if (tcRow) await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [TC_KEY, tcRow.value]); else await db.run('DELETE FROM system_config WHERE key = ?', [TC_KEY]);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'time_tracking'");
  await callAs(U.dir, 'DELETE', '/setup-hub/time_tracking/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'time_tracking'");
  if (tcMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash) VALUES (?,?,?,?,?,?) ON CONFLICT (item_key) DO NOTHING', [tcMark.item_key, tcMark.marked_by, tcMark.marked_by_name, tcMark.marked_at, tcMark.content_hash || null, tcMark.notified_hash || null]);

  console.log('\n=== U. PORTAL AGENT RULES (list) — a system_admin row in the features lane ===');
  var arMark = await db.get("SELECT * FROM setup_hub_signoffs WHERE item_key = 'agent_rules'");
  await callAs(U.sa, 'DELETE', '/setup-hub/agent_rules/done'); await callAs(U.sa, 'DELETE', '/setup-hub/agent_rules/ready');
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'agent_rules'");
  var an0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'agent_rules'")).n;
  var arNew = await callAs(U.sa, 'POST', '/agent-rules', { rule_text: 'HUB harness rule ' + TAG });
  var arId = arNew.body && (arNew.body.id || (arNew.body.rule && arNew.body.rule.id));
  await new Promise(function (r) { setTimeout(r, 400); });
  var uA = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'agent_rules');
  var an1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'agent_rules'")).n;
  ok('U1 a LIST row that stays quiet while it grows — a rule added before anyone declares it complete tells nobody', arNew.status === 200 && !!arId && uA.approvalModel === 'list' && uA.approval === 'yellow' && /rule/.test(uA.approvalWhy || '') && an1 === an0, arNew.status + ' ' + uA.approvalModel + '/' + uA.approval + ': ' + uA.approvalWhy + ' · ' + an0 + '→' + an1);
  var arBad = await callAs(U.dir, 'POST', '/setup-hub/agent_rules/ready');
  var arRdy = await callAs(U.sa, 'POST', '/setup-hub/agent_rules/ready');
  var arApv = await callAs(U.sa, 'POST', '/setup-hub/agent_rules/done');
  var uB = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'agent_rules');
  var an2 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_ready' AND context_id = 'agent_rules'")).n;
  ok('U2 the row is system_admin\'s (its API is): the SysAdmin declares and approves → GREEN; a Director gets 403', arBad.status === 403 && arRdy.status === 200 && arApv.status === 200 && uB.approval === 'green' && an2 > an1, arBad.status + '/' + arRdy.status + '/' + arApv.status + ' ' + uB.approval + ' · ' + an1 + '→' + an2);
  var ac0 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'agent_rules'")).n;
  var arOff = await callAs(U.sa, 'PATCH', '/agent-rules/' + arId, { enabled: 0 });
  await new Promise(function (r) { setTimeout(r, 400); });
  var uC = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'agent_rules');
  var ac1 = (await db.get("SELECT count(*)::int n FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'agent_rules'")).n;
  ok('U3 switching a rule off after approval → YELLOW "changed since approval" + one notification', arOff.status === 200 && uC.approval === 'yellow' && /changed since approval/.test(uC.approvalWhy || '') && ac1 > ac0, arOff.status + ' ' + uC.approval + ': ' + uC.approvalWhy + ' · ' + ac0 + '→' + ac1);
  if (arId) await db.run('DELETE FROM agent_rules WHERE id = ?', [arId]);
  await db.run("DELETE FROM notifications WHERE kind IN ('setup_ready','setup_reapproval') AND context_id = 'agent_rules'");
  await callAs(U.sa, 'DELETE', '/setup-hub/agent_rules/done'); await db.run("DELETE FROM setup_hub_ready WHERE item_key = 'agent_rules'");
  if (arMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash) VALUES (?,?,?,?,?,?) ON CONFLICT (item_key) DO NOTHING', [arMark.item_key, arMark.marked_by, arMark.marked_by_name, arMark.marked_at, arMark.content_hash || null, arMark.notified_hash || null]);

  console.log('\n=== F. CLEANUP ===');
  for (var k in U) { await ut.revokeAll(U[k]); await db.run('DELETE FROM users WHERE id = ?', [U[k]]); }
  await db.run("DELETE FROM setup_hub_signoffs WHERE marked_by LIKE 'u-' || ? || '-%'", [TAG]);
  var left = await db.get("SELECT count(*)::int AS n FROM users WHERE title = 'Test ' || ?", [TAG]);
  ok('F1 harness users and marks removed', left.n === 0);

  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERR', e); fail++; console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail'); process.exit(1); });
