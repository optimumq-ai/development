'use strict';
// ONE-TIME v3 ROUTING CUTOVER SEED (D4 §8, item 9) — mirror the legacy permission-role holders into
// user_task_types grants, 1:1, so task routing runs on ONE catalog (the per-person task-type subset)
// while the permission roles keep their remaining job: capability gates (FINANCE on the fee endpoints).
//
// The mirror is deliberately BEHAVIOR-PRESERVING: for every (team, task type) the v3 eligible set after
// seeding is exactly the legacy eligible set before it. Nobody gains work, nobody loses work — the same
// people are eligible under a different token. Narrowing a person's subset afterwards is a staffing
// decision made in Staff Management, not here.
//
// Grants go through the REAL path — PATCH /api/staff/:id/task-types (replace semantics), authorized as a
// SYSTEM_ADMIN — never direct inserts, so whatever that endpoint enforces (routable-type filter) applies.
// Existing grants are preserved: each user's target set is (current grants ∪ mirrored grants).
//
// Usage:  node src/db/seed_task_type_grants.js            (DRY RUN — prints the plan, changes nothing)
//         node src/db/seed_task_type_grants.js --apply    (executes via the API)
require('dotenv').config();
var db = require('./index');
var auth = require('../services/auth');

// Legacy routing role -> the v3 task-type grant(s) that carry the same eligibility.
// REDACTION_WORKER maps to BOTH redaction and redaction_qa because that is what holding it MEANS today:
// TASK_ROLES routes redaction_qa to REDACTION_WORKER, so every holder is already an eligible reviewer.
var MIRROR = {
  FEE_MANAGER: ['estimate'],
  SEARCH_AND_TRIAGE: ['record_search'],
  REDACTION_WORKER: ['redaction', 'redaction_qa'],
  FINANCE: ['fee_waiver']
};

var APPLY = process.argv.indexOf('--apply') >= 0;
var PORT = Number(process.env.API_PORT) || 3001;

async function plan() {
  var users = await db.all(
    "SELECT u.id, u.display_name FROM users u WHERE u.status = 'active' ORDER BY u.id");
  var out = [];
  for (var u of users) {
    // v3 (S1): legacy permission-role names derive from the user's types (SPEC_user_type_model §9.1).
    var perms = (await require('../services/userTypes').claimsFor(u.id)).perms;
    var current = (await db.all(
      'SELECT task_type FROM user_task_types WHERE user_id = ?', [u.id]))
      .map(function (r) { return r.task_type; });
    // S3 (§6 picker constraint): a grant outside the union of the person's type menus is refused by the API,
    // so the mirror only plans grants the menus cover (office admins mint team perms but carry no team menu).
    var menu = await require('../services/userTypes').taskMenuFor(u.id);
    var target = current.slice();
    for (var p of perms) {
      for (var t of (MIRROR[p] || [])) { if (target.indexOf(t) < 0 && (menu === null || menu.indexOf(t) !== -1)) target.push(t); }
    }
    target.sort();
    var added = target.filter(function (t) { return current.indexOf(t) < 0; });
    if (added.length) out.push({ id: u.id, name: u.display_name, current: current, target: target, added: added });
  }
  return out;
}

async function main() {
  await db.initDb();
  var changes = await plan();
  if (!changes.length) { console.log('Nothing to do — every active user already carries their mirrored grants.'); process.exit(0); }
  console.log((APPLY ? 'APPLYING' : 'DRY RUN') + ' — ' + changes.length + ' user(s) to update:');
  for (var c of changes) console.log('  ' + c.id + ' (' + c.name + '): +[' + c.added.join(', ') + '] -> [' + c.target.join(', ') + ']');
  if (!APPLY) { console.log('\nRe-run with --apply to execute via PATCH /api/staff/:id/task-types.'); process.exit(0); }

  var adminRow = (await require('../services/userTypes').usersWithTypes(['oro_sysadmin']))[0];
  var admin = adminRow ? await db.get('SELECT * FROM users WHERE id = ?', [adminRow.id]) : null;
  if (!admin) { console.error('No active SYSTEM_ADMIN user found — cannot call the staff API.'); process.exit(1); }
  var tok = await auth.signAccessToken(admin);
  for (var c of changes) {
    var r = await fetch('http://localhost:' + PORT + '/api/staff/' + c.id + '/task-types', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ taskTypes: c.target })
    });
    if (!r.ok) { console.error('FAILED ' + c.id + ': HTTP ' + r.status + ' ' + (await r.text())); process.exit(1); }
    console.log('  OK ' + c.id);
  }
  // Verify the mirror invariant end-state: nothing left to add.
  var left = await plan();
  if (left.length) { console.error('VERIFY FAILED: ' + left.length + ' user(s) still missing mirrored grants.'); process.exit(1); }
  console.log('DONE — mirror complete; re-run is a no-op.');
  process.exit(0);
}

if (require.main === module) main().catch(function (e) { console.error(e); process.exit(1); });
module.exports = { MIRROR: MIRROR, plan: plan };
