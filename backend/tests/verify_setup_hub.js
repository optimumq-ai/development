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
  var item = 'time_budgets';   // System Features and Options: operations_config
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
  await db.run("DELETE FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'agency'");
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
  await db.run("DELETE FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'ai_config'");
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
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail.hub.test' } });
  var kB = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  ok('K2 SMTP with only a host → RED naming Port and From address', kB.approval === 'red' && /Port/.test(kB.approvalWhy || '') && /From address/.test(kB.approvalWhy || ''), kB.approval + ': ' + kB.approvalWhy);
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail.hub.test', smtp_port: '587', smtp_from: 'records@hub.test' } });
  var kC = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  ok('K3 host + port + from address → YELLOW (a test send is evidence, not a requirement)', kC.approval === 'yellow', kC.approval + ': ' + kC.approvalWhy);
  var kM = await callAs(U.sa, 'POST', '/setup-hub/email/done');
  var kD = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  ok('K4 approval → GREEN', kM.status === 200 && kD.approval === 'green', kM.status + ' ' + kD.approval);
  await callAs(U.sa, 'POST', '/integrations', { email: { provider: 'smtp', smtp_host: 'mail2.hub.test' } });
  var kE = find((await callAs(U.sa, 'GET', '/setup-hub')).body, 'email');
  ok('K5 a changed host after approval → YELLOW "changed since approval"', kE.approval === 'yellow' && /changed since approval/.test(kE.approvalWhy || ''), kE.approval + ': ' + kE.approvalWhy);
  await db.run("DELETE FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'email'");
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
  await db.run("DELETE FROM notifications WHERE kind = 'setup_reapproval' AND context_id = 'auth_policy'");
  for (var rk4 in auSave) { if (auSave[rk4] == null) await db.run('DELETE FROM system_config WHERE key = ?', [rk4]); else await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [rk4, auSave[rk4]]); }
  await callAs(U.sa, 'DELETE', '/setup-hub/auth_policy/done');
  if (auMark) await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash) VALUES (?,?,?,?,?)', [auMark.item_key, auMark.marked_by, auMark.marked_by_name, auMark.marked_at, auMark.content_hash || null]);

  console.log('\n=== F. CLEANUP ===');
  for (var k in U) { await ut.revokeAll(U[k]); await db.run('DELETE FROM users WHERE id = ?', [U[k]]); }
  await db.run("DELETE FROM setup_hub_signoffs WHERE marked_by LIKE 'u-' || ? || '-%'", [TAG]);
  var left = await db.get("SELECT count(*)::int AS n FROM users WHERE title = 'Test ' || ?", [TAG]);
  ok('F1 harness users and marks removed', left.n === 0);

  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERR', e); fail++; console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail'); process.exit(1); });
