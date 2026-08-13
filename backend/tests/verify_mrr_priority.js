'use strict';
// HIGH PRIORITY ON AN MRR (§14.4 item 6 — the last unbuilt piece of Kevin's MRR list).
//
// A PARENT-level management fact: the Request Manager (or oversight) flags an MRR, the act is
// recorded in request_history with the actor's name, the hub master and overview both show it,
// and the high_priority_mrrs report watches every flagged open MRR. Children never carry it.
//
// WHAT THIS PREVENTS: an unrecorded priority (who decided this outranks everything?), a flag any
// bystander can flip, and a watch report that disagrees with the hub.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var reportEngine = require('/opt/optimumq/backend/src/services/reportEngine');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var TAG = 'HP-' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function api(method, path, tok, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async function () {
  await db.initDb();
  var manager = await db.get("SELECT * FROM users WHERE id = 'u-police-staff'");   // plain user — manager only by holding the task
  var bystander = await db.get("SELECT * FROM users WHERE id = 'u-finance-staff'");
  var admin = await db.get("SELECT * FROM users WHERE id = 'u-kruss'");
  var T_MGR = await auth.signAccessToken(manager), T_BYS = await auth.signAccessToken(bystander), T_ADM = await auth.signAccessToken(admin);

  // A real MRR through the real path.
  var sub = await fetch('http://localhost:' + PORT + '/api/public/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestorName: 'HP', requestorEmail: 'hp@example.com', description: 'priority test ' + TAG,
      records: [{ label: 'A', description: 'first record ' + TAG }, { label: 'B', description: 'second record ' + TAG }] })
  });
  ok('setup: a 2-item MRR submits (' + sub.status + ')', sub.status >= 200 && sub.status < 300);
  var parent = null;
  for (var i = 0; i < 60 && !parent; i++) {
    parent = await db.get("SELECT id FROM requests WHERE requestor_email = 'hp@example.com' AND master_request_id IS NULL AND created_at > ?", [new Date(Date.now() - 600000).toISOString().slice(0, 19).replace('T', ' ')]);
    await sleep(250);
  }
  ok('setup: the parent wrapped', !!parent);
  var hub = null;
  for (var j = 0; j < 40 && !hub; j++) {
    hub = await db.get("SELECT id FROM tasks WHERE request_id = ? AND type = 'mrr_management'", [parent.id]);
    await sleep(250);
  }
  await db.run("UPDATE tasks SET assigned_to = ?, status = 'assigned' WHERE id = ?", [manager.id, hub.id]);

  console.log('\n=== A. THE FLAG IS A GATED, RECORDED ACT ===');
  var bys = await api('POST', '/mrr/' + hub.id + '/priority', T_BYS, { on: true });
  ok('A1 a bystander cannot flag it — refused in words, naming the manager',
    bys.status === 403 && /Request Manager/.test(bys.body.error));
  var set = await api('POST', '/mrr/' + hub.id + '/priority', T_MGR, { on: true });
  ok('A2 the manager flags it; the response carries who and when',
    set.status === 200 && set.body.highPriority.on === true && set.body.highPriority.setBy === manager.display_name && !!set.body.highPriority.setAt);
  var hist = await db.get("SELECT count(*)::int AS n FROM request_history WHERE request_id = ? AND action = 'HIGH_PRIORITY_SET'", [parent.id]);
  ok('A3 the act is in request_history', Number(hist.n) === 1);
  var kids = await db.all('SELECT high_priority FROM requests WHERE master_request_id = ?', [parent.id]);
  ok('A4 children never carry the flag (parent-level fact)', kids.every(function (k) { return Number(k.high_priority) !== 1; }));

  console.log('\n=== B. BOTH HUB SURFACES SHOW IT ===');
  var master = await api('GET', '/mrr/' + hub.id + '/master', T_MGR);
  ok('B1 the master view carries the flag with its provenance',
    master.status === 200 && master.body.parent.highPriority.on === true && master.body.parent.highPriority.setBy === manager.display_name);
  var ov = await api('GET', '/mrr/overview', T_MGR);
  var row = (ov.body.rows || []).filter(function (r) { return r.requestId === parent.id; })[0];
  ok('B2 the overview row is tagged', !!row && row.highPriority === true);

  console.log('\n=== C. THE WATCH REPORT ===');
  var rep = await reportEngine.runSpec({ metric: 'high_priority_mrrs' });
  var rrow = (rep.rows || []).filter(function (r) { return new RegExp('2 items').test(r.label) && /flagged by/.test(r.label); })
    .filter(function (r) { return r.label.indexOf(manager.display_name) >= 0; })[0];
  ok('C1 the report lists the flagged MRR with items, readiness, and who flagged it',
    !!rrow && /estimate data 0 of 2 ready/.test(rrow.label));
  // Due dates are computed (started_at + duration), never stored — a query against a stored
  // due_date column silently returned nothing and the report showed no deadline at all.
  ok('C1b the row carries the statutory respond-by date', !!rrow && /respond by \d{4}-\d{2}-\d{2}/.test(rrow.label));
  ok('C2 the row value is the open-item count (what still needs doing)', rrow && rrow.value === 2);

  console.log('\n=== D. CLEARING IS THE SAME RECORDED ACT (oversight may act too) ===');
  var clr = await api('POST', '/mrr/' + hub.id + '/priority', T_ADM, { on: false });
  ok('D1 oversight clears the flag', clr.status === 200 && clr.body.highPriority.on === false);
  var hist2 = await db.get("SELECT count(*)::int AS n FROM request_history WHERE request_id = ? AND action = 'HIGH_PRIORITY_CLEARED'", [parent.id]);
  ok('D2 the clear is recorded too', Number(hist2.n) === 1);
  var rep2 = await reportEngine.runSpec({ metric: 'high_priority_mrrs' });
  ok('D3 the report no longer lists it',
    !(rep2.rows || []).some(function (r) { return r.label.indexOf(manager.display_name) >= 0 && /2 items/.test(r.label); }));

  console.log('\n=== E. LEAVE THE WORLD AS FOUND ===');
  var fam = (await db.all('SELECT id FROM requests WHERE id = ? OR master_request_id = ?', [parent.id, parent.id])).map(function (r) { return r.id; });
  for (var fi = 0; fi < fam.length; fi++) { await db.run('DELETE FROM workflow_decisions WHERE request_id = ?', [fam[fi]]); }
  await db.run('DELETE FROM requests WHERE master_request_id = ?', [parent.id]);
  await db.run('DELETE FROM requests WHERE id = ?', [parent.id]);
  var left = await db.get("SELECT count(*)::int AS n FROM requests WHERE requestor_email = 'hp@example.com'");
  ok('E1 the fixture family is gone', Number(left.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
